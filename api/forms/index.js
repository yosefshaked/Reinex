/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  UUID_PATTERN,
  ensureMembership,
  isAdminRole,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  withOrgScope,
} from '../_shared/org-bff.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import { logTenantAuditEvent, TENANT_AUDIT_RETENTION } from '../_shared/tenant-audit.js';
import { attachErrorTracking, respondTracked, respondTrackedError } from '../_shared/error-events.js';
import {
  buildSharedBlockMap,
  collectSharedBlockIds,
  findMissingSharedBlockIds,
  normalizeAlertRules,
  normalizeFormSchema,
  resolveSchemaWithSharedBlocks,
  validateNormalizedFormSchemaIntegrity,
  normalizeVisibilityRules,
} from '../_shared/forms-runtime.js';

const SELECT_FIELDS = 'id, name, description, form_usage, form_schema, alert_rules, visibility_rules, is_active, version, created_by, created_at, updated_at, metadata';

function normalizeString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeOptionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

function normalizeOptionalJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function normalizeFormUsage(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return '';
  return ['general', 'waiting_list_intake', 'required_form'].includes(normalized) ? normalized : '';
}

function normalizeSelectionMode(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'delivery' || normalized === 'waiting_list_invite') {
    return normalized;
  }
  return '';
}

function isPublishedMetadata(metadata) {
  return Boolean(metadata && typeof metadata === 'object' && !Array.isArray(metadata) && metadata.published_form_schema && typeof metadata.published_form_schema === 'object');
}

function requiresPublishMigration(formRecord) {
  if (isPublishedMetadata(formRecord?.metadata)) return false;
  const publishedAt = normalizeString(formRecord?.published_at);
  const hasDraftSchema = Boolean(formRecord?.form_schema && typeof formRecord.form_schema === 'object' && !Array.isArray(formRecord.form_schema));
  return Boolean(publishedAt) && hasDraftSchema;
}

function isPublishedFormRecord(formRecord) {
  return isPublishedMetadata(formRecord?.metadata);
}

function resolveUpdatedMetadata(existingMetadata, updates = {}) {
  return {
    ...(existingMetadata && typeof existingMetadata === 'object' && !Array.isArray(existingMetadata) ? existingMetadata : {}),
    ...updates,
  };
}

function uniqueIds(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

async function loadSharedBlocksForSchemas(client, orgId, schemas = []) {
  const sharedBlockIds = uniqueIds(
    schemas.flatMap((schema) => collectSharedBlockIds(schema)),
  );

  if (!sharedBlockIds.length) {
    return [];
  }

  const { data, error } = await withOrgScope(client, 'shared_form_blocks', orgId)
    .select('id, block_type, name, content_schema, is_active, metadata, created_at, updated_at')
    .eq('is_active', true)
    .in('id', sharedBlockIds);

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data : [];
}

function buildSharedBlockLinkRows(formId, formSchema, schemaScope) {
  const normalized = normalizeFormSchema(formSchema);
  return normalized.sections.flatMap((section) =>
    section.items
      .filter((item) => item.type === 'shared_question' || item.type === 'shared_text')
      .map((item) => ({
        form_id: formId,
        shared_block_id: item.shared_block_id || item.shared_block?.id,
        section_id: section.id,
        item_id: item.id,
        schema_scope: schemaScope,
      }))
      .filter((row) => row.shared_block_id && row.item_id),
  );
}

async function syncFormSharedBlockLinks(client, orgId, formId, { draftSchema, publishedSchema }) {
  const rows = [
    ...buildSharedBlockLinkRows(formId, draftSchema, 'draft'),
    ...buildSharedBlockLinkRows(formId, publishedSchema, 'published'),
  ];

  const { error: deleteError } = await withOrgScope(client, 'form_shared_block_links', orgId)
    .delete()
    .eq('form_id', formId);

  if (deleteError) {
    throw deleteError;
  }

  if (!rows.length) {
    return;
  }

  const { error: insertError } = await withOrgScope(client, 'form_shared_block_links', orgId)
    .insert(rows);

  if (insertError) {
    throw insertError;
  }
}

async function revertFormAfterFailedLinkSync(client, orgId, context, formId, previousRecord) {
  try {
    await withOrgScope(client, 'forms', orgId)
      .update({
        name: previousRecord.name,
        description: previousRecord.description,
        form_usage: previousRecord.form_usage,
        form_schema: previousRecord.form_schema,
        alert_rules: previousRecord.alert_rules,
        visibility_rules: previousRecord.visibility_rules,
        is_active: previousRecord.is_active,
        version: previousRecord.version,
        metadata: previousRecord.metadata,
        published_at: previousRecord.published_at,
        updated_at: previousRecord.updated_at,
      })
      .eq('id', formId);

    await syncFormSharedBlockLinks(client, orgId, formId, {
      draftSchema: previousRecord.form_schema || {},
      publishedSchema: previousRecord?.metadata?.published_form_schema || {},
    });
  } catch (revertError) {
    context.log?.error?.('forms failed to revert after shared block sync failure', {
      message: revertError?.message,
      formId,
    });
  }
}

async function deleteCreatedFormAfterFailedLinkSync(client, orgId, context, formId) {
  const { error } = await withOrgScope(client, 'forms', orgId)
    .delete()
    .eq('id', formId);

  if (error) {
    context.log?.error?.('forms failed to delete created form after shared block sync failure', {
      message: error?.message,
      formId,
    });
    throw error;
  }
}

async function buildFormResponse(client, orgId, formRecord) {
  const metadata = formRecord?.metadata && typeof formRecord.metadata === 'object' && !Array.isArray(formRecord.metadata)
    ? formRecord.metadata
    : {};
  const rawSchema = normalizeFormSchema(formRecord?.form_schema || {});
  const publishedSchema = normalizeFormSchema(metadata?.published_form_schema || {});
  const sharedBlocks = await loadSharedBlocksForSchemas(client, orgId, [rawSchema, publishedSchema]);
  const sharedBlockMap = buildSharedBlockMap(sharedBlocks);
  const missingSharedBlockIds = findMissingSharedBlockIds(rawSchema, sharedBlockMap);

  return {
    ...formRecord,
    shared_blocks: sharedBlocks,
    resolved_form_schema: resolveSchemaWithSharedBlocks(rawSchema, sharedBlockMap),
    missing_shared_block_ids: missingSharedBlockIds,
    is_published: isPublishedFormRecord(formRecord),
    requires_publish_migration: requiresPublishMigration(formRecord),
  };
}

async function writeTenantFormAudit(client, context, params) {
  try {
    await logTenantAuditEvent(client, params);
  } catch (auditError) {
    context.log?.warn?.('forms failed to write tenant audit event', {
      message: auditError?.message,
      eventType: params?.eventType,
      resourceId: params?.resourceId,
    });
  }
}

export default async function forms(context, req) {
  const method = String(req.method || 'GET').toUpperCase();

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('forms missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('forms failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const userId = authResult.data.user.id;
  const userEmail = authResult.data.user.email || '';

  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  attachErrorTracking(context, req, supabase, {
    orgId,
    userId,
    metadata: { endpoint: 'forms' },
  });

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('forms failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respondTracked(context, 500, { message: 'failed_to_verify_membership' }, undefined, {
      error: membershipError,
      metadata: { action: 'verify_membership' },
    });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const isAdmin = isAdminRole(role);

  // ── GET: Fetch form templates ──
  if (method === 'GET') {
    const formId = context?.bindingData?.formId;
    const usageFilter = normalizeFormUsage(req?.query?.usage ?? req?.query?.form_usage ?? body?.usage ?? body?.form_usage);
    const selectionMode = normalizeSelectionMode(req?.query?.selection_mode ?? req?.query?.selectionMode ?? body?.selection_mode ?? body?.selectionMode);

    if (formId) {
      if (!isAdmin) {
        return respond(context, 403, { message: 'forbidden' });
      }

      if (!UUID_PATTERN.test(formId)) {
        return respond(context, 400, { message: 'invalid_form_id' });
      }

      const { data, error } = await withOrgScope(supabase, 'forms', orgId)
        .select(SELECT_FIELDS)
        .eq('id', formId)
        .maybeSingle();

      if (error) {
        context.log?.error?.('forms failed to load template', { message: error.message, formId });
        return respondTracked(context, 500, { message: 'failed_to_load_form' }, undefined, {
          error,
          metadata: { action: 'load_form', form_id: formId },
        });
      }

      if (!data) {
        return respond(context, 404, { message: 'form_not_found' });
      }

      try {
        const responseBody = await buildFormResponse(supabase, orgId, data);
        return respond(context, 200, responseBody);
      } catch (sharedBlocksError) {
        context.log?.error?.('forms failed to resolve shared blocks for template', {
          message: sharedBlocksError?.message,
          formId,
        });
        return respondTracked(context, 500, { message: 'failed_to_load_form' }, undefined, {
          error: sharedBlocksError,
          metadata: { action: 'resolve_shared_blocks', form_id: formId },
        });
      }
    }

    if (!isAdmin && !selectionMode) {
      return respond(context, 403, { message: 'forbidden' });
    }

    const selectFields = selectionMode
      ? 'id, name, description, form_usage, form_schema, is_active, metadata, published_at'
      : SELECT_FIELDS;
    const query = withOrgScope(supabase, 'forms', orgId)
      .select(selectFields)
      .order('created_at', { ascending: false });

    if (selectionMode || !isAdmin) {
      query.eq('is_active', true);
    }
    if (usageFilter) {
      query.eq('form_usage', usageFilter);
    }

    const { data, error } = await query;

    if (error) {
      context.log?.error?.('forms failed to load templates', { message: error.message });
      return respondTracked(context, 500, { message: 'failed_to_load_forms' }, undefined, {
        error,
        metadata: { action: 'load_forms', usage_filter: usageFilter || null, selection_mode: selectionMode || null },
      });
    }

    let rows = Array.isArray(data) ? data : [];
    if (selectionMode) {
      rows = rows
        .filter((row) => isPublishedFormRecord(row) || requiresPublishMigration(row))
        .map((row) => ({
          ...row,
          is_published: isPublishedFormRecord(row),
          requires_publish_migration: requiresPublishMigration(row),
        }));
      if (selectionMode === 'waiting_list_invite') {
        rows = rows.filter((row) => row?.form_usage === 'waiting_list_intake');
      }
    }

    return respond(context, 200, rows);
  }

  // All write operations require admin
  if (!isAdmin) {
    return respond(context, 403, { message: 'forbidden' });
  }

  // ── POST: Create a new form template ──
  if (method === 'POST') {
    const name = normalizeString(body?.name);
    if (!name) {
      return respond(context, 400, { message: 'missing_form_name' });
    }

    const description = normalizeOptionalText(body?.description);
    const formUsage = normalizeFormUsage(body?.form_usage ?? body?.formUsage) || 'general';
    const formSchema = normalizeFormSchema(normalizeOptionalJson(body?.form_schema ?? body?.formSchema) || {});
    const alertRules = normalizeAlertRules(body?.alert_rules ?? body?.alertRules);
    const visibilityRules = normalizeVisibilityRules(body?.visibility_rules ?? body?.visibilityRules);
    const schemaIssues = validateNormalizedFormSchemaIntegrity({
      formSchema,
      visibilityRules,
      alertRules,
    });
    if (schemaIssues.length) {
      return respond(context, 400, { message: 'invalid_form_schema_structure', details: schemaIssues });
    }

    const { data, error } = await withOrgScope(supabase, 'forms', orgId)
      .insert({
        name,
        description,
        form_usage: formUsage,
        form_schema: formSchema,
        alert_rules: alertRules,
        visibility_rules: visibilityRules,
        created_by: userId,
        metadata: {
          draft_saved_at: new Date().toISOString(),
        },
      })
      .select(SELECT_FIELDS)
      .single();

    if (error) {
      context.log?.error?.('forms failed to create template', { message: error.message });
      return respondTracked(context, 500, { message: 'failed_to_create_form' }, undefined, {
        error,
        metadata: { action: 'create_form', form_usage: formUsage },
      });
    }

    try {
      await syncFormSharedBlockLinks(supabase, orgId, data.id, {
        draftSchema: formSchema,
        publishedSchema: {},
      });
    } catch (linksError) {
      context.log?.error?.('forms failed to sync shared block links after create', {
        message: linksError?.message,
        formId: data.id,
      });
      try {
        await deleteCreatedFormAfterFailedLinkSync(supabase, orgId, context, data.id);
      } catch {
        return respondTrackedError(context, req, supabase, {
          status: 500,
          message: 'failed_to_create_form',
          orgId,
          userId,
          error: linksError,
          metadata: { form_id: data.id, cleanup_failed: true },
        });
      }
      return respondTracked(context, 500, { message: 'failed_to_create_form' }, undefined, {
        error: linksError,
        metadata: { action: 'sync_shared_block_links_after_create', form_id: data.id, cleanup_failed: false },
      });
    }

    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail,
      userRole: role,
      actionType: AUDIT_ACTIONS.FORM_TEMPLATE_CREATED,
      actionCategory: AUDIT_CATEGORIES.FORMS,
      resourceType: 'form',
      resourceId: data.id,
      details: { name },
    });
    await writeTenantFormAudit(supabase, context, {
      orgId,
      actorUserId: userId,
      eventType: 'form.template_created',
      retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
      resourceType: 'form',
      resourceId: data.id,
      afterState: { name: data.name, version: data.version, form_usage: data.form_usage, is_active: data.is_active },
    });

    try {
      const responseBody = await buildFormResponse(supabase, orgId, data);
      return respond(context, 201, responseBody);
    } catch (sharedBlocksError) {
      context.log?.error?.('forms failed to resolve shared blocks after create', {
        message: sharedBlocksError?.message,
        formId: data.id,
      });
      return respondTracked(context, 500, { message: 'failed_to_create_form' }, undefined, {
        error: sharedBlocksError,
        metadata: { action: 'resolve_shared_blocks_after_create', form_id: data.id },
      });
    }
  }

  // ── PUT: Update an existing form template (increments version) ──
  if (method === 'PUT') {
    const formId = normalizeString(context?.bindingData?.formId || body?.id);
    if (!formId || !UUID_PATTERN.test(formId)) {
      return respond(context, 400, { message: 'invalid_form_id' });
    }

    // Fetch existing to get current version
    const { data: existing, error: fetchError } = await withOrgScope(supabase, 'forms', orgId)
      .select('id, name, description, form_usage, form_schema, alert_rules, visibility_rules, is_active, version, metadata, published_at, updated_at')
      .eq('id', formId)
      .maybeSingle();

    if (fetchError) {
      context.log?.error?.('forms failed to fetch template for update', { message: fetchError.message, formId });
      return respondTracked(context, 500, { message: 'failed_to_fetch_form' }, undefined, {
        error: fetchError,
        metadata: { action: 'fetch_form_for_update', form_id: formId },
      });
    }

    if (!existing) {
      return respond(context, 404, { message: 'form_not_found' });
    }

    if (body?.action === 'migrate_publish_structure') {
      if (isPublishedMetadata(existing?.metadata)) {
        try {
          const responseBody = await buildFormResponse(supabase, orgId, {
            ...existing,
            metadata: existing.metadata,
          });
          return respond(context, 200, {
            ...responseBody,
            migration_status: 'already_migrated',
          });
        } catch (sharedBlocksError) {
          context.log?.error?.('forms failed to resolve shared blocks for migrated publish structure', {
            message: sharedBlocksError?.message,
            formId,
          });
          return respondTracked(context, 500, { message: 'failed_to_migrate_publish_structure' }, undefined, {
            error: sharedBlocksError,
            metadata: { action: 'resolve_shared_blocks_for_existing_publish_migration', form_id: formId },
          });
        }
      }

      if (!requiresPublishMigration(existing)) {
        return respond(context, 409, { message: 'form_not_published' });
      }

      const updatedAt = new Date().toISOString();
      const normalizedSchema = normalizeFormSchema(existing.form_schema || {});
      const normalizedAlertRules = normalizeAlertRules(existing.alert_rules);
      const normalizedVisibilityRules = normalizeVisibilityRules(existing.visibility_rules);
      const schemaIssues = validateNormalizedFormSchemaIntegrity({
        formSchema: normalizedSchema,
        visibilityRules: normalizedVisibilityRules,
        alertRules: normalizedAlertRules,
      });
      if (schemaIssues.length) {
        return respond(context, 409, { message: 'invalid_form_schema_structure', details: schemaIssues });
      }

      const migratedMetadata = resolveUpdatedMetadata(existing.metadata, {
        published_form_schema: normalizedSchema,
        published_alert_rules: normalizedAlertRules,
        published_visibility_rules: normalizedVisibilityRules,
        published_version: Number.isFinite(Number(existing.version)) ? Number(existing.version) : 1,
        published_by: userId,
        published_at: normalizeString(existing.published_at) || updatedAt,
        publish_structure_migrated_at: updatedAt,
        publish_structure_migrated_by: userId,
      });

      const { data: migrated, error: migratedError } = await withOrgScope(supabase, 'forms', orgId)
        .update({
          metadata: migratedMetadata,
          published_at: normalizeString(existing.published_at) || updatedAt,
          updated_at: updatedAt,
        })
        .eq('id', formId)
        .select(SELECT_FIELDS)
        .maybeSingle();

      if (migratedError || !migrated) {
        context.log?.error?.('forms failed to migrate publish structure', {
          message: migratedError?.message,
          formId,
        });
        return respondTracked(context, 500, { message: 'failed_to_migrate_publish_structure' }, undefined, {
          error: migratedError || new Error('migrate_publish_structure returned no row'),
          metadata: { action: 'migrate_publish_structure', form_id: formId, returned_row: Boolean(migrated) },
        });
      }

      try {
        await syncFormSharedBlockLinks(supabase, orgId, formId, {
          draftSchema: normalizedSchema,
          publishedSchema: normalizedSchema,
        });
      } catch (linksError) {
        context.log?.error?.('forms failed to sync shared block links after publish migration', {
          message: linksError?.message,
          formId,
        });
        return respondTracked(context, 500, { message: 'failed_to_migrate_publish_structure' }, undefined, {
          error: linksError,
          metadata: { action: 'sync_shared_block_links_after_publish_migration', form_id: formId },
        });
      }

      await logAuditEvent(supabase, {
        orgId,
        userId,
        userEmail,
        userRole: role,
        actionType: AUDIT_ACTIONS.FORM_TEMPLATE_PUBLISHED,
        actionCategory: AUDIT_CATEGORIES.FORMS,
        resourceType: 'form',
        resourceId: formId,
        details: {
          migration_only: true,
          published_version: migrated?.metadata?.published_version || migrated.version,
        },
      });

      await writeTenantFormAudit(supabase, context, {
        orgId,
        actorUserId: userId,
        eventType: 'form.template_publish_structure_migrated',
        retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
        resourceType: 'form',
        resourceId: formId,
        beforeState: {
          published_at: existing.published_at,
          had_published_form_schema: isPublishedMetadata(existing.metadata),
        },
        afterState: {
          published_at: migrated.published_at,
          has_published_form_schema: isPublishedMetadata(migrated.metadata),
        },
      });

      try {
        const responseBody = await buildFormResponse(supabase, orgId, migrated);
        return respond(context, 200, {
          ...responseBody,
          migration_status: 'migrated',
        });
      } catch (sharedBlocksError) {
        context.log?.error?.('forms failed to resolve shared blocks after publish migration', {
          message: sharedBlocksError?.message,
          formId,
        });
        return respondTracked(context, 500, { message: 'failed_to_migrate_publish_structure' }, undefined, {
          error: sharedBlocksError,
          metadata: { action: 'resolve_shared_blocks_after_publish_migration', form_id: formId },
        });
      }
    }

    const updates = {
      updated_at: new Date().toISOString(),
    };

    let schemaChanged = false;
    const publishRequested = body?.publish === true || body?.action === 'publish';

    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      const name = normalizeString(body.name);
      if (!name) {
        return respond(context, 400, { message: 'missing_form_name' });
      }
      updates['name'] = name;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'description')) {
      updates.description = normalizeOptionalText(body.description);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'form_usage') || Object.prototype.hasOwnProperty.call(body, 'formUsage')) {
      const formUsage = normalizeFormUsage(body?.form_usage ?? body?.formUsage);
      if (!formUsage) {
        return respond(context, 400, { message: 'invalid_form_usage' });
      }
      updates.form_usage = formUsage;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'form_schema') || Object.prototype.hasOwnProperty.call(body, 'formSchema')) {
      const formSchema = normalizeOptionalJson(body?.form_schema ?? body?.formSchema);
      if (formSchema === null && (body?.form_schema !== null && body?.formSchema !== null)) {
        return respond(context, 400, { message: 'invalid_form_schema' });
      }
      updates.form_schema = normalizeFormSchema(formSchema || {});
      schemaChanged = true;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'alert_rules') || Object.prototype.hasOwnProperty.call(body, 'alertRules')) {
      updates.alert_rules = normalizeAlertRules(body?.alert_rules ?? body?.alertRules);
      schemaChanged = true;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'visibility_rules') || Object.prototype.hasOwnProperty.call(body, 'visibilityRules')) {
      updates.visibility_rules = normalizeVisibilityRules(body?.visibility_rules ?? body?.visibilityRules);
      schemaChanged = true;
    }

    // Increment version when form schema is modified
    if (schemaChanged) {
      updates.version = existing.version + 1;
    }

    const nextSchema = updates.form_schema || normalizeFormSchema(existing.form_schema || {});
    const nextAlertRules = Object.prototype.hasOwnProperty.call(updates, 'alert_rules')
      ? updates.alert_rules
      : normalizeAlertRules(existing.alert_rules);
    const nextVisibilityRules = Object.prototype.hasOwnProperty.call(updates, 'visibility_rules')
      ? updates.visibility_rules
      : normalizeVisibilityRules(existing.visibility_rules);
    const schemaIssues = validateNormalizedFormSchemaIntegrity({
      formSchema: nextSchema,
      visibilityRules: nextVisibilityRules,
      alertRules: nextAlertRules,
    });
    if (schemaIssues.length) {
      return respond(context, 400, { message: 'invalid_form_schema_structure', details: schemaIssues });
    }
    const existingMetadata = existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
      ? existing.metadata
      : {};
    const nextPublishedSchema = publishRequested
      ? nextSchema
      : normalizeFormSchema(existingMetadata.published_form_schema || {});

    updates.metadata = resolveUpdatedMetadata(existing.metadata, {
      draft_saved_at: updates.updated_at,
    });

    if (publishRequested) {
      const publishVersion = updates.version || existing.version;
      updates.metadata = resolveUpdatedMetadata(updates.metadata, {
        published_form_schema: nextSchema,
        published_alert_rules: nextAlertRules,
        published_visibility_rules: nextVisibilityRules,
        published_version: publishVersion,
        published_by: userId,
        published_at: updates.updated_at,
      });
      updates.published_at = updates.updated_at;
    }

    if (Object.keys(updates).length <= 1) {
      return respond(context, 400, { message: 'missing_updates' });
    }

    const { data, error } = await withOrgScope(supabase, 'forms', orgId)
      .update(updates)
      .eq('id', formId)
      .select(SELECT_FIELDS)
      .maybeSingle();

    if (error) {
      context.log?.error?.('forms failed to update template', { message: error.message, formId });
      return respondTracked(context, 500, { message: 'failed_to_update_form' }, undefined, {
        error,
        metadata: { action: 'update_form', form_id: formId, updated_fields: Object.keys(updates).filter((k) => k !== 'updated_at') },
      });
    }

    if (!data) {
      return respond(context, 404, { message: 'form_not_found' });
    }

    try {
      await syncFormSharedBlockLinks(supabase, orgId, formId, {
        draftSchema: nextSchema,
        publishedSchema: nextPublishedSchema,
      });
    } catch (linksError) {
      context.log?.error?.('forms failed to sync shared block links after update', {
        message: linksError?.message,
        formId,
      });
      await revertFormAfterFailedLinkSync(supabase, orgId, context, formId, existing);
      return respondTracked(context, 500, { message: 'failed_to_update_form' }, undefined, {
        error: linksError,
        metadata: { action: 'sync_shared_block_links_after_update', form_id: formId, rollback_attempted: true },
      });
    }

    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail,
      userRole: role,
      actionType: AUDIT_ACTIONS.FORM_TEMPLATE_UPDATED,
      actionCategory: AUDIT_CATEGORIES.FORMS,
      resourceType: 'form',
      resourceId: formId,
      details: {
        updated_fields: Object.keys(updates).filter((k) => k !== 'updated_at'),
        new_version: data.version,
      },
    });
    await writeTenantFormAudit(supabase, context, {
      orgId,
      actorUserId: userId,
      eventType: publishRequested ? 'form.template_published' : 'form.template_updated',
      retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
      resourceType: 'form',
      resourceId: formId,
      beforeState: {
        version: existing.version,
        published_at: existing.published_at,
      },
      afterState: {
        version: data.version,
        published_at: data.published_at,
      },
      details: {
        updated_fields: Object.keys(updates).filter((k) => k !== 'updated_at'),
        published: publishRequested,
      },
    });

    if (publishRequested) {
      await logAuditEvent(supabase, {
        orgId,
        userId,
        userEmail,
        userRole: role,
        actionType: AUDIT_ACTIONS.FORM_TEMPLATE_PUBLISHED,
        actionCategory: AUDIT_CATEGORIES.FORMS,
        resourceType: 'form',
        resourceId: formId,
        details: {
          published_version: data?.metadata?.published_version || data.version,
        },
      });
    }

    try {
      const responseBody = await buildFormResponse(supabase, orgId, data);
      return respond(context, 200, responseBody);
    } catch (sharedBlocksError) {
      context.log?.error?.('forms failed to resolve shared blocks after update', {
        message: sharedBlocksError?.message,
        formId,
      });
      return respondTracked(context, 500, { message: 'failed_to_update_form' }, undefined, {
        error: sharedBlocksError,
        metadata: { action: 'resolve_shared_blocks_after_update', form_id: formId },
      });
    }
  }

  // ── DELETE: Soft-delete (is_active = false) ──
  if (method === 'DELETE') {
    const formId = normalizeString(context?.bindingData?.formId || body?.id);
    if (!formId || !UUID_PATTERN.test(formId)) {
      return respond(context, 400, { message: 'invalid_form_id' });
    }

    const { data, error } = await withOrgScope(supabase, 'forms', orgId)
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', formId)
      .select('id, name, is_active')
      .maybeSingle();

    if (error) {
      context.log?.error?.('forms failed to deactivate template', { message: error.message, formId });
      return respondTracked(context, 500, { message: 'failed_to_delete_form' }, undefined, {
        error,
        metadata: { action: 'deactivate_form', form_id: formId },
      });
    }

    if (!data) {
      return respond(context, 404, { message: 'form_not_found' });
    }

    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail,
      userRole: role,
      actionType: AUDIT_ACTIONS.FORM_TEMPLATE_DELETED,
      actionCategory: AUDIT_CATEGORIES.FORMS,
      resourceType: 'form',
      resourceId: formId,
      details: { name: data.name },
    });
    await writeTenantFormAudit(supabase, context, {
      orgId,
      actorUserId: userId,
      eventType: 'form.template_deactivated',
      retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
      resourceType: 'form',
      resourceId: formId,
      afterState: { is_active: data.is_active, name: data.name },
    });

    return respond(context, 200, data);
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
