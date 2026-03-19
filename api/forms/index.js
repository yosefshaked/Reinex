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

const SELECT_FIELDS = 'id, name, description, form_schema, alert_rules, visibility_rules, is_active, version, created_by, created_at, updated_at, metadata';

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
    const formSchema = normalizeOptionalJson(body?.form_schema ?? body?.formSchema);

    const { data, error } = await tenantClient
      .from('forms')
      .insert({
        name,
        description,
        form_schema: formSchema || {},
        created_by: userId,
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
      .select('version')
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

    if (Object.prototype.hasOwnProperty.call(body, 'form_schema') || Object.prototype.hasOwnProperty.call(body, 'formSchema')) {
      const formSchema = normalizeOptionalJson(body?.form_schema ?? body?.formSchema);
      if (formSchema === null && (body?.form_schema !== null && body?.formSchema !== null)) {
        return respond(context, 400, { message: 'invalid_form_schema' });
      }
      updates.form_schema = formSchema || {};
      schemaChanged = true;
    }

    // Increment version when form schema is modified
    if (schemaChanged) {
      updates.version = existing.version + 1;
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

    return respond(context, 200, data);
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
