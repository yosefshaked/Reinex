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
  resolveTenantClient,
} from '../_shared/org-bff.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import { logTenantAuditEvent, TENANT_AUDIT_RETENTION } from '../_shared/tenant-audit.js';
import {
  normalizeAlertRules,
  normalizeFormSchema,
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
  return normalized === 'waiting_list_intake' ? normalized : normalized === 'general' ? normalized : '';
}

function resolveUpdatedMetadata(existingMetadata, updates = {}) {
  return {
    ...(existingMetadata && typeof existingMetadata === 'object' && !Array.isArray(existingMetadata) ? existingMetadata : {}),
    ...updates,
  };
}

async function writeTenantFormAudit(tenantClient, context, params) {
  try {
    await logTenantAuditEvent(tenantClient, params);
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
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('forms failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const userEmail = authResult.data.user.email || '';

  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('forms failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const isAdmin = isAdminRole(role);

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  // ── GET: Fetch form templates ──
  if (method === 'GET') {
    const formId = context?.bindingData?.formId;
    const usageFilter = normalizeFormUsage(req?.query?.usage ?? req?.query?.form_usage ?? body?.usage ?? body?.form_usage);

    if (formId) {
      if (!UUID_PATTERN.test(formId)) {
        return respond(context, 400, { message: 'invalid_form_id' });
      }

      const { data, error } = await tenantClient
        .from('forms')
        .select(SELECT_FIELDS)
        .eq('id', formId)
        .maybeSingle();

      if (error) {
        context.log?.error?.('forms failed to load template', { message: error.message, formId });
        return respond(context, 500, { message: 'failed_to_load_form' });
      }

      if (!data) {
        return respond(context, 404, { message: 'form_not_found' });
      }

      return respond(context, 200, data);
    }

    // List all — admins see all, non-admins see only active
    const query = tenantClient
      .from('forms')
      .select(SELECT_FIELDS)
      .order('created_at', { ascending: false });

    if (!isAdmin) {
      query.eq('is_active', true);
    }
    if (usageFilter) {
      query.eq('form_usage', usageFilter);
    }

    const { data, error } = await query;

    if (error) {
      context.log?.error?.('forms failed to load templates', { message: error.message });
      return respond(context, 500, { message: 'failed_to_load_forms' });
    }

    return respond(context, 200, Array.isArray(data) ? data : []);
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

    const { data, error } = await tenantClient
      .from('forms')
      .insert({
        name,
        description,
        form_usage: formUsage,
        form_schema: formSchema,
        alert_rules: alertRules,
        visibility_rules: visibilityRules,
        created_by: userId,
        metadata: {
          published_form_schema: formSchema,
          published_alert_rules: alertRules,
          published_visibility_rules: visibilityRules,
          published_version: 1,
          draft_saved_at: new Date().toISOString(),
        },
        published_at: new Date().toISOString(),
      })
      .select(SELECT_FIELDS)
      .single();

    if (error) {
      context.log?.error?.('forms failed to create template', { message: error.message });
      return respond(context, 500, { message: 'failed_to_create_form' });
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
    await writeTenantFormAudit(tenantClient, context, {
      actorUserId: userId,
      eventType: 'form.template_created',
      retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
      resourceType: 'form',
      resourceId: data.id,
      afterState: { name: data.name, version: data.version, form_usage: data.form_usage, is_active: data.is_active },
    });

    return respond(context, 201, data);
  }

  // ── PUT: Update an existing form template (increments version) ──
  if (method === 'PUT') {
    const formId = normalizeString(context?.bindingData?.formId || body?.id);
    if (!formId || !UUID_PATTERN.test(formId)) {
      return respond(context, 400, { message: 'invalid_form_id' });
    }

    // Fetch existing to get current version
    const { data: existing, error: fetchError } = await tenantClient
      .from('forms')
      .select('version, metadata, form_schema, alert_rules, visibility_rules, published_at')
      .eq('id', formId)
      .maybeSingle();

    if (fetchError) {
      context.log?.error?.('forms failed to fetch template for update', { message: fetchError.message, formId });
      return respond(context, 500, { message: 'failed_to_fetch_form' });
    }

    if (!existing) {
      return respond(context, 404, { message: 'form_not_found' });
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

    const { data, error } = await tenantClient
      .from('forms')
      .update(updates)
      .eq('id', formId)
      .select(SELECT_FIELDS)
      .maybeSingle();

    if (error) {
      context.log?.error?.('forms failed to update template', { message: error.message, formId });
      return respond(context, 500, { message: 'failed_to_update_form' });
    }

    if (!data) {
      return respond(context, 404, { message: 'form_not_found' });
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
    await writeTenantFormAudit(tenantClient, context, {
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

    return respond(context, 200, data);
  }

  // ── DELETE: Soft-delete (is_active = false) ──
  if (method === 'DELETE') {
    const formId = normalizeString(context?.bindingData?.formId || body?.id);
    if (!formId || !UUID_PATTERN.test(formId)) {
      return respond(context, 400, { message: 'invalid_form_id' });
    }

    const { data, error } = await tenantClient
      .from('forms')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', formId)
      .select('id, name, is_active')
      .maybeSingle();

    if (error) {
      context.log?.error?.('forms failed to deactivate template', { message: error.message, formId });
      return respond(context, 500, { message: 'failed_to_delete_form' });
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
    await writeTenantFormAudit(tenantClient, context, {
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
