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
import { logAuditEvent, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import { logTenantAuditEvent, TENANT_AUDIT_RETENTION } from '../_shared/tenant-audit.js';
import { normalizeSharedBlockContent } from '../_shared/forms-runtime.js';

const SELECT_FIELDS = 'id, block_type, name, content_schema, is_active, created_by, created_at, updated_at, metadata';
const QUESTION_TYPES_WITH_OPTIONS = new Set(['single_select', 'multi_select', 'approval']);
const VALID_QUESTION_TYPES = new Set([
  'short_text',
  'long_text',
  'number',
  'date',
  'phone',
  'email',
  'israeli_id',
  'single_select',
  'multi_select',
  'yes_no',
  'approval',
  'signature',
]);

function normalizeRequiredText(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized;
}

function normalizeOptionalJson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function normalizeBlockType(value) {
  return value === 'text' ? 'text' : value === 'question' ? 'question' : '';
}

function validateSharedBlockContent(blockType, contentSchema) {
  if (blockType === 'text') {
    if (!normalizeRequiredText(contentSchema?.content)) {
      return 'missing_text_content';
    }
    return '';
  }

  const questionType = normalizeRequiredText(contentSchema?.question_type || contentSchema?.questionType || contentSchema?.type);
  if (!questionType || !VALID_QUESTION_TYPES.has(questionType)) {
    return 'invalid_question_type';
  }
  if (!normalizeRequiredText(contentSchema?.label || contentSchema?.title)) {
    return 'missing_question_label';
  }

  if (QUESTION_TYPES_WITH_OPTIONS.has(questionType)) {
    const options = Array.isArray(contentSchema?.options) ? contentSchema.options : [];
    if (!options.length) {
      return 'missing_question_options';
    }
    if ((questionType === 'single_select' || questionType === 'multi_select') && options.length < 2) {
      return 'insufficient_question_options';
    }
  }

  return '';
}

async function writeTenantBlockAudit(tenantClient, context, params) {
  try {
    await logTenantAuditEvent(tenantClient, params);
  } catch (error) {
    context.log?.warn?.('form-blocks failed to write tenant audit event', {
      message: error?.message,
      eventType: params?.eventType,
      resourceId: params?.resourceId,
    });
  }
}

async function loadUsage(tenantClient, blockId) {
  const { data, error } = await tenantClient
    .from('form_shared_block_links')
    .select('form_id, section_id, item_id, schema_scope')
    .eq('shared_block_id', blockId)
    .order('form_id');

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];
  const formIds = Array.from(new Set(rows.map((row) => row.form_id).filter(Boolean)));
  let formMap = {};
  if (formIds.length) {
    const { data: forms, error: formsError } = await tenantClient
      .from('forms')
      .select('id, name, is_active, updated_at, version')
      .in('id', formIds);

    if (formsError) {
      throw formsError;
    }

    formMap = (Array.isArray(forms) ? forms : []).reduce((accumulator, form) => {
      accumulator[form.id] = form;
      return accumulator;
    }, {});
  }

  const usageByForm = rows.reduce((accumulator, row) => {
    if (!row?.form_id) return accumulator;
    const current = accumulator[row.form_id] || {
      form_id: row.form_id,
      form: formMap[row.form_id] || null,
      draft_placement_count: 0,
      published_placement_count: 0,
      section_ids: new Set(),
      item_ids: new Set(),
    };
    if (row.schema_scope === 'published') {
      current.published_placement_count += 1;
    } else {
      current.draft_placement_count += 1;
    }
    if (row.section_id) current.section_ids.add(row.section_id);
    if (row.item_id) current.item_ids.add(row.item_id);
    accumulator[row.form_id] = current;
    return accumulator;
  }, {});

  return Object.values(usageByForm).map((entry) => ({
    form_id: entry.form_id,
    form: entry.form,
    usage_scope: entry.draft_placement_count > 0 && entry.published_placement_count > 0
      ? 'draft_and_published'
      : entry.published_placement_count > 0
        ? 'published'
        : 'draft',
    placement_count: entry.draft_placement_count + entry.published_placement_count,
    draft_placement_count: entry.draft_placement_count,
    published_placement_count: entry.published_placement_count,
    section_ids: Array.from(entry.section_ids),
    item_ids: Array.from(entry.item_ids),
  }));
}

export default async function formBlocks(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('form-blocks missing Supabase admin credentials');
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
    context.log?.error?.('form-blocks failed to validate token', { message: error?.message });
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
    context.log?.error?.('form-blocks failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role || !isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  const blockId = normalizeRequiredText(context?.bindingData?.blockId || body?.id);

  if (method === 'GET') {
    if (blockId) {
      if (!UUID_PATTERN.test(blockId)) {
        return respond(context, 400, { message: 'invalid_block_id' });
      }

      const { data, error } = await tenantClient
        .from('shared_form_blocks')
        .select(SELECT_FIELDS)
        .eq('id', blockId)
        .maybeSingle();

      if (error) {
        context.log?.error?.('form-blocks failed to load shared block', { message: error?.message, blockId });
        return respond(context, 500, { message: 'failed_to_load_form_block' });
      }

      if (!data) {
        return respond(context, 404, { message: 'form_block_not_found' });
      }

      try {
        const usage = await loadUsage(tenantClient, blockId);
        return respond(context, 200, {
          ...data,
          usage,
          usage_count: usage.length,
        });
      } catch (usageError) {
        context.log?.error?.('form-blocks failed to load usage', { message: usageError?.message, blockId });
        return respond(context, 500, { message: 'failed_to_load_form_block' });
      }
    }

    const typeFilter = normalizeBlockType(req?.query?.block_type || req?.query?.blockType || body?.block_type || body?.blockType);
    const includeInactive = String(req?.query?.include_inactive || body?.include_inactive || '').toLowerCase() === 'true';

    let query = tenantClient
      .from('shared_form_blocks')
      .select(SELECT_FIELDS)
      .order('updated_at', { ascending: false });

    if (typeFilter) {
      query = query.eq('block_type', typeFilter);
    }
    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) {
      context.log?.error?.('form-blocks failed to list shared blocks', { message: error?.message });
      return respond(context, 500, { message: 'failed_to_load_form_blocks' });
    }

    const blocks = Array.isArray(data) ? data : [];
    const ids = blocks.map((block) => block.id);
    let usageCounts = {};
    if (ids.length) {
      const { data: usageRows, error: usageError } = await tenantClient
        .from('form_shared_block_links')
        .select('shared_block_id, form_id')
        .in('shared_block_id', ids);
      if (usageError) {
        context.log?.error?.('form-blocks failed to count usage', { message: usageError?.message });
        return respond(context, 500, { message: 'failed_to_load_form_blocks' });
      }
      usageCounts = (Array.isArray(usageRows) ? usageRows : []).reduce((accumulator, row) => {
        const key = row?.shared_block_id;
        if (!key) return accumulator;
        if (!accumulator[key]) {
          accumulator[key] = new Set();
        }
        if (row?.form_id) {
          accumulator[key].add(row.form_id);
        }
        return accumulator;
      }, {});
    }

    return respond(context, 200, blocks.map((block) => ({
      ...block,
      usage_count: usageCounts[block.id]?.size || 0,
    })));
  }

  if (method === 'POST') {
    const blockType = normalizeBlockType(body?.block_type || body?.blockType);
    const name = normalizeRequiredText(body?.name);
    if (!blockType || !name) {
      return respond(context, 400, { message: 'missing_block_fields' });
    }

    const contentSchema = normalizeSharedBlockContent(blockType, body?.content_schema || body?.contentSchema || {});
    const validationError = validateSharedBlockContent(blockType, contentSchema);
    if (validationError) {
      return respond(context, 400, { message: validationError });
    }
    const metadata = normalizeOptionalJson(body?.metadata);

    const { data, error } = await tenantClient
      .from('shared_form_blocks')
      .insert({
        block_type: blockType,
        name,
        content_schema: contentSchema,
        metadata,
        created_by: userId,
      })
      .select(SELECT_FIELDS)
      .single();

    if (error) {
      context.log?.error?.('form-blocks failed to create shared block', { message: error?.message });
      return respond(context, 500, { message: 'failed_to_create_form_block' });
    }

    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail,
      userRole: role,
      actionType: 'form_block.created',
      actionCategory: AUDIT_CATEGORIES.FORMS,
      resourceType: 'shared_form_block',
      resourceId: data.id,
      details: { name: data.name, block_type: data.block_type },
    });
    await writeTenantBlockAudit(tenantClient, context, {
      actorUserId: userId,
      eventType: 'form_block.created',
      retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
      resourceType: 'shared_form_block',
      resourceId: data.id,
      afterState: {
        name: data.name,
        block_type: data.block_type,
        is_active: data.is_active,
      },
    });

    return respond(context, 201, { ...data, usage: [], usage_count: 0 });
  }

  if (method === 'PUT') {
    if (!blockId || !UUID_PATTERN.test(blockId)) {
      return respond(context, 400, { message: 'invalid_block_id' });
    }

    const { data: existing, error: existingError } = await tenantClient
      .from('shared_form_blocks')
      .select(SELECT_FIELDS)
      .eq('id', blockId)
      .maybeSingle();

    if (existingError) {
      context.log?.error?.('form-blocks failed to fetch shared block for update', { message: existingError?.message, blockId });
      return respond(context, 500, { message: 'failed_to_update_form_block' });
    }

    if (!existing) {
      return respond(context, 404, { message: 'form_block_not_found' });
    }

    const updates = {
      updated_at: new Date().toISOString(),
    };

    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      const name = normalizeRequiredText(body?.name);
      if (!name) {
        return respond(context, 400, { message: 'missing_block_name' });
      }
      updates['name'] = name;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'content_schema') || Object.prototype.hasOwnProperty.call(body, 'contentSchema')) {
      updates.content_schema = normalizeSharedBlockContent(existing.block_type, body?.content_schema || body?.contentSchema || {});
      const validationError = validateSharedBlockContent(existing.block_type, updates.content_schema);
      if (validationError) {
        return respond(context, 400, { message: validationError });
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, 'metadata')) {
      updates.metadata = normalizeOptionalJson(body?.metadata);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'is_active')) {
      updates.is_active = body?.is_active !== false;
    }

    const { data, error } = await tenantClient
      .from('shared_form_blocks')
      .update(updates)
      .eq('id', blockId)
      .select(SELECT_FIELDS)
      .single();

    if (error) {
      context.log?.error?.('form-blocks failed to update shared block', { message: error?.message, blockId });
      return respond(context, 500, { message: 'failed_to_update_form_block' });
    }

    let usage = [];
    try {
      usage = await loadUsage(tenantClient, blockId);
    } catch (usageError) {
      context.log?.error?.('form-blocks failed to load usage after update', { message: usageError?.message, blockId });
      return respond(context, 500, { message: 'failed_to_update_form_block' });
    }

    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail,
      userRole: role,
      actionType: 'form_block.updated',
      actionCategory: AUDIT_CATEGORIES.FORMS,
      resourceType: 'shared_form_block',
      resourceId: data.id,
      details: {
        name: data.name,
        block_type: data.block_type,
        affected_forms_count: usage.length,
        affected_form_ids: usage.map((entry) => entry.form_id),
        before_content_schema: existing.content_schema,
        after_content_schema: data.content_schema,
      },
    });
    await writeTenantBlockAudit(tenantClient, context, {
      actorUserId: userId,
      eventType: 'form_block.updated',
      retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
      resourceType: 'shared_form_block',
      resourceId: data.id,
      beforeState: {
        name: existing.name,
        block_type: existing.block_type,
        is_active: existing.is_active,
        content_schema: existing.content_schema,
      },
      afterState: {
        name: data.name,
        block_type: data.block_type,
        is_active: data.is_active,
        content_schema: data.content_schema,
      },
      details: {
        affected_forms_count: usage.length,
        affected_form_ids: usage.map((entry) => entry.form_id),
      },
    });

    return respond(context, 200, { ...data, usage, usage_count: usage.length });
  }

  if (method === 'DELETE') {
    if (!blockId || !UUID_PATTERN.test(blockId)) {
      return respond(context, 400, { message: 'invalid_block_id' });
    }

    const { data, error } = await tenantClient
      .from('shared_form_blocks')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', blockId)
      .select(SELECT_FIELDS)
      .maybeSingle();

    if (error) {
      context.log?.error?.('form-blocks failed to deactivate shared block', { message: error?.message, blockId });
      return respond(context, 500, { message: 'failed_to_update_form_block' });
    }

    if (!data) {
      return respond(context, 404, { message: 'form_block_not_found' });
    }

    let usage = [];
    try {
      usage = await loadUsage(tenantClient, blockId);
    } catch (usageError) {
      context.log?.error?.('form-blocks failed to load usage after deactivate', { message: usageError?.message, blockId });
      return respond(context, 500, { message: 'failed_to_update_form_block' });
    }

    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail,
      userRole: role,
      actionType: 'form_block.deactivated',
      actionCategory: AUDIT_CATEGORIES.FORMS,
      resourceType: 'shared_form_block',
      resourceId: data.id,
      details: { name: data.name, usage_count: usage.length },
    });
    await writeTenantBlockAudit(tenantClient, context, {
      actorUserId: userId,
      eventType: 'form_block.deactivated',
      retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
      resourceType: 'shared_form_block',
      resourceId: data.id,
      afterState: { is_active: data.is_active, name: data.name },
      details: { usage_count: usage.length },
    });

    return respond(context, 200, { ...data, usage, usage_count: usage.length });
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
