/* eslint-env node */
/**
 * Public unified invite resolver.
 * GET /api/invite-load?invite=<token>
 *
 * Looks up active_routing by token (any category), then dispatches to the
 * appropriate load logic based on active_routing.category and returns a
 * unified response shape with a `flow` field so the frontend knows how to render.
 *
 * Supported flows: 'waiting_list_intake', 'required_form'
 */
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  UUID_PATTERN,
  normalizeString,
  readEnv,
  respond,
  withOrgScope,
} from '../_shared/org-bff.js';
import {
  buildSharedBlockMap,
  collectSharedBlockIds,
  findMissingSharedBlockIds,
  resolvePublicFormState,
  resolveSchemaWithSharedBlocks,
} from '../_shared/forms-runtime.js';
import { attachErrorTracking } from '../_shared/error-events.js';
import { loadInviteRoutingAny } from '../_shared/form-routing.js';

const SUPPORTED_CATEGORIES = new Set(['waiting_list_intake', 'required_form']);

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function normalizeGuardianRelationship(value) {
  const normalized = normalizeString(value).toLowerCase();
  const GUARDIAN_RELATIONSHIPS = new Set(['father', 'mother', 'self', 'caretaker', 'other']);
  return GUARDIAN_RELATIONSHIPS.has(normalized) ? normalized : '';
}

async function resolvePublicFormStateWithSharedBlocks(client, orgId, formRecord) {
  const initialState = resolvePublicFormState(formRecord, { allowDraftFallback: false, sharedBlocksById: {} });
  const blockIds = collectSharedBlockIds(initialState.raw_form_schema || initialState.form_schema);
  if (!blockIds.length) return initialState;

  const { data, error } = await withOrgScope(client, 'shared_form_blocks', orgId)
    .select('id, block_type, name, content_schema, is_active, metadata')
    .eq('is_active', true)
    .in('id', blockIds);
  if (error) throw error;

  const sharedBlocksById = buildSharedBlockMap(data);
  const missingSharedBlockIds = findMissingSharedBlockIds(
    initialState.raw_form_schema || initialState.form_schema,
    sharedBlocksById,
  );
  if (missingSharedBlockIds.length) {
    throw new Error(`missing_shared_blocks:${missingSharedBlockIds.join(',')}`);
  }
  return {
    ...initialState,
    form_schema: resolveSchemaWithSharedBlocks(
      initialState.raw_form_schema || initialState.form_schema,
      sharedBlocksById,
    ),
  };
}

async function loadWaitingListIntake(context, client, { orgId, submission, routingRow, inviteToken }) {
  const submissionMetadata = submission?.metadata && typeof submission.metadata === 'object'
    ? submission.metadata
    : {};

  let form;
  let clientProfile;
  let services;
  try {
    const [formResult, clientProfileResult, servicesResult] = await Promise.all([
      withOrgScope(client, 'forms', orgId)
        .select('id, name, description, form_schema, alert_rules, visibility_rules, metadata, form_usage')
        .eq('id', submission.form_id)
        .maybeSingle(),
      withOrgScope(client, 'client_profiles', orgId)
        .select('id, first_name, last_name, identity_number, phone, email')
        .eq('id', submission.client_profile_id)
        .maybeSingle(),
      withOrgScope(client, 'Services', orgId)
        .select('id, name')
        .eq('is_active', true)
        .order('name', { ascending: true }),
    ]);
    if (formResult.error) throw new Error(`failed_to_load_form:${formResult.error.message}`);
    if (clientProfileResult.error) throw new Error(`failed_to_load_client_profile:${clientProfileResult.error.message}`);
    if (servicesResult.error) throw new Error(`failed_to_load_services:${servicesResult.error.message}`);
    form = formResult.data;
    clientProfile = clientProfileResult.data;
    services = Array.isArray(servicesResult.data) ? servicesResult.data : [];
  } catch (error) {
    context.log?.error?.('invite-load waiting_list_intake failed to load dependencies', {
      message: error?.message,
      submissionId: submission.id,
    });
    return { error: 'failed_to_load_invite' };
  }

  if (!form || form.form_usage !== 'waiting_list_intake') {
    return { error: 'form_not_found' };
  }

  let publicFormState;
  try {
    publicFormState = await resolvePublicFormStateWithSharedBlocks(client, orgId, form);
  } catch (error) {
    if (String(error?.message || '').startsWith('missing_shared_blocks:')) {
      return { error: 'form_unavailable' };
    }
    context.log?.error?.('invite-load waiting_list_intake failed resolving public form state', {
      message: error?.message,
      submissionId: submission.id,
    });
    return { error: 'failed_to_load_invite' };
  }
  if (!publicFormState.is_published) {
    return { error: 'form_not_published' };
  }

  const primaryServiceId = normalizeUuid(submissionMetadata.primary_service_id);

  return {
    data: {
      flow: 'waiting_list_intake',
      invite_token: inviteToken,
      submission_id: submission.id,
      expires_at: routingRow.expires_at || null,
      form_name: form.name || 'טופס רשימת המתנה',
      form_description: form.description || '',
      form_schema: publicFormState.form_schema,
      visibility_rules: publicFormState.visibility_rules,
      prospect: {
        client_profile_id: clientProfile?.id || null,
        student_id: submission.student_id || null,
        student_first_name: normalizeString(routingRow?.metadata?.student_first_name) || clientProfile?.first_name || '',
        student_last_name: normalizeString(routingRow?.metadata?.student_last_name) || clientProfile?.last_name || '',
        contact_name: normalizeString(submissionMetadata.contact_name) || '',
        contact_last_name: normalizeString(submissionMetadata.contact_last_name) || '',
        contact_relationship: normalizeGuardianRelationship(submissionMetadata.contact_relationship),
        identity_number: clientProfile?.identity_number || '',
        phone: clientProfile?.phone || '',
        email: clientProfile?.email || '',
      },
      intake_config: {
        primary_service_id: primaryServiceId || null,
        allow_additional_services: Boolean(submissionMetadata.allow_additional_services),
        service_options: services.map((s) => ({ id: s.id, name: s.name })),
      },
    },
  };
}

async function loadRequiredForm(context, client, { orgId, submission, routingRow, inviteToken }) {
  const submissionMetadata = submission?.metadata && typeof submission.metadata === 'object'
    ? submission.metadata
    : {};

  let form;
  let clientProfile;
  let service;
  try {
    const [formResult, clientProfileResult, serviceResult] = await Promise.all([
      withOrgScope(client, 'forms', orgId)
        .select('id, name, description, form_schema, alert_rules, visibility_rules, metadata, form_usage')
        .eq('id', submission.form_id)
        .maybeSingle(),
      withOrgScope(client, 'client_profiles', orgId)
        .select('id, first_name, last_name, identity_number, phone, email')
        .eq('id', submission.client_profile_id)
        .maybeSingle(),
      submission.service_id
        ? withOrgScope(client, 'Services', orgId).select('id, name').eq('id', submission.service_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (formResult.error) throw new Error(`failed_to_load_form:${formResult.error.message}`);
    if (clientProfileResult.error) throw new Error(`failed_to_load_client_profile:${clientProfileResult.error.message}`);
    form = formResult.data;
    clientProfile = clientProfileResult.data;
    service = serviceResult.data;
  } catch (error) {
    context.log?.error?.('invite-load required_form failed to load dependencies', {
      message: error?.message,
      submissionId: submission.id,
    });
    return { error: 'failed_to_load_invite' };
  }

  if (!form || form.form_usage !== 'required_form') {
    return { error: 'form_not_found' };
  }

  let publicFormState;
  try {
    publicFormState = await resolvePublicFormStateWithSharedBlocks(client, orgId, form);
  } catch (error) {
    if (String(error?.message || '').startsWith('missing_shared_blocks:')) {
      return { error: 'form_unavailable' };
    }
    context.log?.error?.('invite-load required_form failed resolving public form state', {
      message: error?.message,
      submissionId: submission.id,
    });
    return { error: 'failed_to_load_invite' };
  }
  if (!publicFormState.is_published) {
    return { error: 'form_not_published' };
  }

  return {
    data: {
      flow: 'required_form',
      invite_token: inviteToken,
      submission_id: submission.id,
      expires_at: routingRow.expires_at || null,
      form_name: form.name || 'טופס חובה',
      form_description: form.description || '',
      form_schema: publicFormState.form_schema,
      visibility_rules: publicFormState.visibility_rules,
      required_form_label: normalizeString(submissionMetadata.required_form_label) || form.name || 'טופס חובה',
      service_name: service?.name || '',
      prospect: {
        client_profile_id: clientProfile?.id || null,
        student_id: submission.student_id || null,
        first_name: clientProfile?.first_name || '',
        last_name: clientProfile?.last_name || '',
        identity_number: clientProfile?.identity_number || '',
        phone: clientProfile?.phone || '',
        email: clientProfile?.email || '',
      },
    },
  };
}

export default async function inviteLoad(context, req) {
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('invite-load missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const inviteToken = normalizeUuid(req?.query?.invite || req?.query?.invite_token);
  if (!inviteToken) return respond(context, 400, { message: 'invalid_invite_token' });

  const controlClient = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  let routingRow;
  try {
    routingRow = await loadInviteRoutingAny(controlClient, inviteToken);
  } catch (error) {
    context.log?.error?.('invite-load failed to load routing row', { message: error?.message, inviteToken });
    return respond(context, 500, { message: 'failed_to_load_invite' });
  }

  if (!routingRow?.org_id) return respond(context, 404, { message: 'invite_not_found' });

  if (!SUPPORTED_CATEGORIES.has(routingRow.category)) {
    context.log?.warn?.('invite-load unsupported routing category', { category: routingRow.category, inviteToken });
    return respond(context, 404, { message: 'invite_not_found' });
  }

  const orgId = routingRow.org_id;
  const submissionId = normalizeUuid(routingRow?.routing_info?.submission_id);
  if (!submissionId) return respond(context, 404, { message: 'invite_not_found' });

  attachErrorTracking(context, req, controlClient, {
    orgId,
    metadata: {
      public_flow: `load_invite_${routingRow.category}`,
      submission_id: submissionId,
      invite_token: inviteToken,
    },
  });

  const selectColumns = routingRow.category === 'required_form'
    ? 'id, client_profile_id, student_id, form_id, service_id, answers, metadata, submitted_at'
    : 'id, client_profile_id, student_id, form_id, answers, metadata, submitted_at';

  const { data: submission, error: submissionError } = await withOrgScope(controlClient, 'form_submissions', orgId)
    .select(selectColumns)
    .eq('id', submissionId)
    .maybeSingle();

  if (submissionError) {
    context.log?.error?.('invite-load failed to load submission', { message: submissionError?.message, submissionId });
    return respond(context, 500, { message: 'failed_to_load_invite' });
  }
  if (!submission) return respond(context, 404, { message: 'invite_not_found' });

  const submissionMetadata = submission?.metadata && typeof submission.metadata === 'object'
    ? submission.metadata
    : {};
  if (String(submissionMetadata.workflow_status || '').toLowerCase() === 'submitted') {
    return respond(context, 409, { message: 'invite_already_completed' });
  }

  const args = { orgId, submission, routingRow, inviteToken };

  let result;
  if (routingRow.category === 'waiting_list_intake') {
    result = await loadWaitingListIntake(context, controlClient, args);
  } else {
    result = await loadRequiredForm(context, controlClient, args);
  }

  if (result.error) {
    const status = (result.error === 'form_not_found' || result.error === 'invite_not_found') ? 404
      : (result.error === 'invite_already_completed' || result.error === 'form_not_published' || result.error === 'form_unavailable') ? 409
      : 500;
    return respond(context, status, { message: result.error });
  }

  return respond(context, 200, result.data);
}
