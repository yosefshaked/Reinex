/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';

/**
 * GET /api/students/compliance-summary
 * 
 * Returns a map of student_id -> { expiredDocuments: number }
 * Efficiently batches document queries to avoid N+1 problem
 * 
 * Query params:
 * - org_id (required)
 * - student_ids (optional, comma-separated UUIDs) - if omitted, returns for all students
 */
export default async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('students-compliance-summary missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('students-compliance-summary missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('students-compliance-summary failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = parseRequestBody(null);
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('students-compliance-summary failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  // Parse optional student_ids filter
  const studentIdsParam = normalizeString(req?.query?.student_ids || '');
  const studentIdsFilter = studentIdsParam
    ? studentIdsParam.split(',').map(id => id.trim()).filter(Boolean)
    : null;

  try {
    // Query Documents table for all expired documents
    // This is a single optimized query instead of N queries
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today
    const todayString = today.toISOString().split('T')[0]; // YYYY-MM-DD format
    
    context.log?.('students-compliance-summary query details', {
      orgId,
      todayString,
      studentIdsFilter: studentIdsFilter || 'all students',
      filterCount: studentIdsFilter?.length || 0,
    });
    
    let query = tenantClient
      .from('Documents')
      .select('entity_id, expiration_date, resolved')
      .eq('entity_type', 'student')
      .not('expiration_date', 'is', null)
      .lt('expiration_date', todayString);

    // Apply student_ids filter if provided
    if (studentIdsFilter && studentIdsFilter.length > 0) {
      query = query.in('entity_id', studentIdsFilter);
    }

    const { data: documents, error: documentsError} = await query;

    if (documentsError) {
      context.log?.error?.('students-compliance-summary failed to fetch documents', {
        message: documentsError.message,
        code: documentsError.code,
        details: documentsError.details,
        hint: documentsError.hint,
        orgId,
      });
      return respond(context, 500, { 
        message: 'failed_to_fetch_documents',
        error: documentsError.message,
        code: documentsError.code
      });
    }

    // Build summary map: student_id -> { expiredDocuments: count }
    const summary = {};

    // Process documents and count expired (excluding resolved)
    if (Array.isArray(documents)) {
      for (const doc of documents) {
        // Skip resolved documents
        if (doc.resolved === true) {
          continue;
        }

        const studentId = doc.entity_id;
        if (!summary[studentId]) {
          summary[studentId] = { expiredDocuments: 0 };
        }
        summary[studentId].expiredDocuments += 1;
      }
    }

    return respond(context, 200, summary);
  } catch (error) {
    context.log?.error?.('students-compliance-summary unexpected error', {
      message: error?.message,
      stack: error?.stack,
    });
    return respond(context, 500, { message: 'internal_server_error' });
  }
}
