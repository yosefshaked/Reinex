/* eslint-env node */
/**
 * Storage Cleanup Job
 * 
 * Finds organizations with expired grace periods and deletes their files from R2.
 * Should be run periodically (e.g., daily via timer trigger).
 * 
 * POST /api/storage-cleanup-expired (manual trigger)
 * Timer: Daily at 2 AM UTC
 */
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { readEnv, respond } from '../_shared/org-bff.js';
import { getStorageDriver } from '../cross-platform/storage-drivers/index.js';
import { AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';

export default async function (context) {
  context.log('storage-cleanup-expired: job started');

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log.error('storage-cleanup-expired missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  try {
    // Find all orgs with expired grace periods
    const { data: expiredOrgs, error: fetchError } = await supabase
      .from('org_settings')
      .select('org_id, storage_profile, storage_grace_ends_at')
      .not('storage_grace_ends_at', 'is', null)
      .lt('storage_grace_ends_at', new Date().toISOString());

    if (fetchError) {
      context.log.error('Failed to fetch expired orgs', { message: fetchError.message });
      return respond(context, 500, { message: 'failed_to_fetch_expired_orgs' });
    }

    if (!expiredOrgs || expiredOrgs.length === 0) {
      context.log('No expired grace periods found');
      return respond(context, 200, { 
        message: 'no_expired_grace_periods',
        processed: 0 
      });
    }

    context.log(`Found ${expiredOrgs.length} orgs with expired grace periods`);

    const results = [];

    // Process each expired org
    for (const org of expiredOrgs) {
      const { org_id: orgId, storage_profile: storageProfile, storage_grace_ends_at: graceEndsAt } = org;

      try {
        // Only process managed storage (user owns BYOS data)
        if (storageProfile?.mode === 'managed') {
          context.log(`Deleting files for org ${orgId}`);

          // Get R2 driver
          const driver = getStorageDriver('managed', {}, env);

          // Delete all files for this org
          const prefix = `managed/${orgId}/`;
          
          if (typeof driver.deletePrefix === 'function') {
            await driver.deletePrefix(prefix);
            context.log(`Deleted files with prefix ${prefix}`);
          } else {
            context.log.warn(`Driver doesn't support deletePrefix, skipping file deletion for ${orgId}`);
          }

          // Update org settings: clear storage config and grace period
          const { error: updateError } = await supabase
            .from('org_settings')
            .update({
              storage_profile: null,
              storage_grace_ends_at: null,
              permissions: supabase.raw(`
                jsonb_set(
                  COALESCE(permissions, '{}'::jsonb),
                  '{storage_access_level}',
                  'false'::jsonb
                )
              `),
              updated_at: new Date().toISOString(),
            })
            .eq('org_id', orgId);

          if (updateError) {
            context.log.error(`Failed to update org ${orgId}`, { message: updateError.message });
            results.push({ org_id: orgId, status: 'update_failed', error: updateError.message });
            continue;
          }

          results.push({ 
            org_id: orgId, 
            status: 'deleted', 
            grace_ended_at: graceEndsAt 
          });

          // Log audit event for file deletion (system action)
          try {
            await supabase.rpc('log_audit_event', {
              p_org_id: orgId,
              p_user_id: '00000000-0000-0000-0000-000000000000', // System user
              p_user_email: 'system@reinex.app',
              p_user_role: 'system_admin',
              p_action_type: AUDIT_ACTIONS.STORAGE_FILES_DELETED,
              p_action_category: AUDIT_CATEGORIES.STORAGE,
              p_resource_type: 'files',
              p_resource_id: orgId,
              p_details: {
                grace_ended_at: graceEndsAt,
                storage_mode: 'managed',
                deleted_prefix: prefix,
              },
            });
          } catch (auditError) {
            context.log.error(`Failed to log audit event for ${orgId}`, { message: auditError.message });
          }

          context.log(`Successfully processed org ${orgId}`);
        } else {
          // BYOS or no storage - just clear grace period
          const { error: updateError } = await supabase
            .from('org_settings')
            .update({
              storage_grace_ends_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq('org_id', orgId);

          if (updateError) {
            context.log.error(`Failed to clear grace period for ${orgId}`, { message: updateError.message });
          }

          results.push({ 
            org_id: orgId, 
            status: 'byos_skipped', 
            grace_ended_at: graceEndsAt 
          });
        }
      } catch (orgError) {
        context.log.error(`Error processing org ${orgId}`, {
          message: orgError?.message,
          stack: orgError?.stack,
        });
        results.push({ 
          org_id: orgId, 
          status: 'error', 
          error: orgError?.message 
        });
      }
    }

    const deletedCount = results.filter(r => r.status === 'deleted').length;
    const failedCount = results.filter(r => r.status === 'error' || r.status === 'update_failed').length;

    context.log('Cleanup job completed', {
      total: expiredOrgs.length,
      deleted: deletedCount,
      failed: failedCount,
    });

    return respond(context, 200, {
      message: 'cleanup_completed',
      processed: expiredOrgs.length,
      deleted: deletedCount,
      failed: failedCount,
      results,
    });
  } catch (error) {
    context.log.error('Cleanup job failed', {
      message: error?.message,
      stack: error?.stack,
    });
    return respond(context, 500, {
      message: 'cleanup_job_failed',
      error: error?.message,
    });
  }
}
