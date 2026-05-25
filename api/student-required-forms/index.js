/* eslint-env node */
import { randomUUID } from 'node:crypto';
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { logAuditEvent, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import { logTenantAuditEvent, TENANT_AUDIT_RETENTION } from '../_shared/tenant-audit.js';
import {
  UUID_PATTERN,
  ensureMembership,
  isAdminOrOffice,
  normalizeString,
  parseRequestBody,
  readEnv,
  resolveOrgId,
  respond,
  withOrgScope,
} from '../_shared/org-bff.js';
import {
  buildSharedBlockMap,
  collectSharedBlockIds,
  evaluateAlertFlags,
  findMissingSharedBlockIds,
  materializeSchemaForSnapshot,
  prepareAnswersForStorage,
  resolvePublicFormState,
  resolveSchemaWithSharedBlocks,
} from '../_shared/forms-runtime.js';
import { attachErrorTracking } from '../_shared/error-events.js';
import {
  getNowIso,
  buildInviteLink,
  loadInviteRoutingByCategory,
  findActiveRoutingBySubmission,
  createInviteRouting,
  sendInviteEmail,
} from '../_shared/form-routing.js';
import { resolveClientProfileDeliveryDestination } from '../_shared/form-delivery-destination.js';

const ROUTING_CATEGORY = 'required_form';
const WORKFLOW_KIND = 'required_form';
const DEFAULT_INVITE_TTL_MINUTES = 10080;  // 7 days
const MAX_INVITE_TTL_MINUTES = 20160;      // 14 days
const DELIVERY_METHODS = new Set(['whatsapp', 'email']);

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function normalizeDeliveryMethod(value) {
  const normalized = normalizeString(value).toLowerCase();
  return DELIVERY_METHODS.has(normalized) ? normalized : '';
}

function normalizeEmail(value) {
  return normalizeString(value).toLowerCase();
}

function parseInviteTtlMinutes(raw) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_INVITE_TTL_MINUTES;
  return Math.min(parsed, MAX_INVITE_TTL_MINUTES);
}

function isPublishedFormRecord(form) {
  const metadata = form?.metadata && typeof form.metadata === 'object' && !Array.isArray(form.metadata)
    ? form.metadata
    : {};
  return Boolean(metadata.published_form_schema && typeof metadata.published_form_schema === 'object');
}

function requiresPublishMigration(form) {
  if (!form || typeof form !== 'object') return false;
  if (isPublishedFormRecord(form)) return false;
  const publishedAt = normalizeString(form?.published_at);
  const hasDraftSchema = Boolean(form?.form_schema && typeof form.form_schema === 'object' && !Array.isArray(form.form_schema));
  return Boolean(publishedAt) && hasDraftSchema;
}

async function resolvePublicFormStateWithSharedBlocks(client, orgId, formRecord, options = {}) {
  const initialState = resolvePublicFormState(formRecord, { ...options, sharedBlocksById: {} });
  const blockIds = collectSharedBlockIds(initialState.raw_form_schema || initialState.form_schema);
  if (!blockIds.length) return initialState;
  const { data, error } = await withOrgScope(client, 'shared_form_blocks', orgId)
    .select('id, block_type, name, content_schema, is_active, metadata')
    .eq('is_active', true)
    .in('id', blockIds);
  if (error) throw error;
  const sharedBlocksById = buildSharedBlockMap(data);
  const missingSharedBlockIds = findMissingSharedBlockIds(initialState.raw_form_schema || initialState.form_schema, sharedBlocksById);
  if (missingSharedBlockIds.length) {
    throw new Error(`missing_shared_blocks:${missingSharedBlockIds.join(',')}`);
  }
  return {
    ...initialState,
    form_schema: resolveSchemaWithSharedBlocks(initialState.raw_form_schema || initialState.form_schema, sharedBlocksById),
  };
}

async function requireRequiredFormRecord(client, orgId, formId) {
  const { data, error } = await withOrgScope(client, 'forms', orgId)
    .select('id, name, description, form_usage, form_schema, alert_rules, visibility_rules, metadata, is_active, published_at')
    .eq('id', formId)
    .maybeSingle();
  if (error) throw new Error(`failed_to_load_form:${error.message}`);
  const isPublished = isPublishedFormRecord(data);
  if (!data || data.is_active === false || data.form_usage !== 'required_form') return null;
  if (!isPublished) {
    if (requiresPublishMigration(data)) throw new Error('form_requires_publish_migration');
    throw new Error('form_not_published');
  }
  return data;
}

async function requireActiveServiceWithRequiredForms(client, orgId, serviceId) {
  const { data, error } = await withOrgScope(client, 'Services', orgId)
    .select('id, name, is_active, required_forms')
    .eq('id', serviceId)
    .maybeSingle();
  if (error) throw new Error(`failed_to_load_service:${error.message}`);
  if (!data || data.is_active === false) return null;
  return data;
}

async function findPendingRequiredFormSubmission(client, orgId, { clientProfileId, formId, serviceId }) {
  if (!UUID_PATTERN.test(String(clientProfileId || '')) || !UUID_PATTERN.test(String(formId || '')) || !UUID_PATTERN.test(String(serviceId || ''))) {
    return null;
  }
  const { data, error } = await withOrgScope(client, 'form_submissions', orgId)
    .select('id, otp_metadata, metadata, submitted_at')
    .eq('client_profile_id', clientProfileId)
    .eq('form_id', formId)
    .eq('service_id', serviceId)
    .contains('metadata', { workflow_kind: WORKFLOW_KIND, workflow_status: 'pending' })
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function writeTenantAudit(context, client, params) {
  try {
    await logTenantAuditEvent(client, params);
  } catch (auditError) {
    context.log?.warn?.('student-required-forms failed to write tenant audit event', {
      message: auditError?.message,
      eventType: params?.eventType,
    });
  }
}

async function writeControlAudit(context, controlClient, params) {
  try {
    await logAuditEvent(controlClient, params);
  } catch (auditError) {
    context.log?.warn?.('student-required-forms failed to write control audit event', {
      message: auditError?.message,
      actionType: params?.actionType,
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Action: send (POST, authenticated)
// ─────────────────────────────────────────────────────────────

async function sendRequiredForm(context, req, { controlClient, env, orgId, userId, userEmail, role }) {
  const body = parseRequestBody(req);
  const serviceId = normalizeUuid(body?.service_id || body?.serviceId);
  const formId = normalizeUuid(body?.form_id || body?.formId);
  const clientProfileId = normalizeUuid(body?.client_profile_id || body?.clientProfileId);
  const studentId = normalizeUuid(body?.student_id || body?.studentId) || null;
  const deliveryMethod = normalizeDeliveryMethod(body?.delivery_method || body?.deliveryMethod);
  const requestedPhone = body?.phone;
  const requestedEmail = normalizeEmail(body?.email);
  const ttlMinutes = parseInviteTtlMinutes(body?.expires_in_minutes ?? body?.expiresInMinutes);

  if (!serviceId) return respond(context, 400, { message: 'invalid_service_id' });
  if (!formId) return respond(context, 400, { message: 'invalid_form_id' });
  if (!clientProfileId) return respond(context, 400, { message: 'invalid_client_profile_id' });
  if (!deliveryMethod) return respond(context, 400, { message: 'invalid_delivery_method' });

  const client = controlClient;

  let service;
  let form;
  try {
    [service, form] = await Promise.all([
      requireActiveServiceWithRequiredForms(client, orgId, serviceId),
      requireRequiredFormRecord(client, orgId, formId),
    ]);
  } catch (error) {
    const message = String(error?.message || '');
    if (message === 'form_requires_publish_migration') return respond(context, 409, { message: 'form_requires_publish_migration' });
    if (message === 'form_not_published') return respond(context, 409, { message: 'form_not_published' });
    context.log?.error?.('student-required-forms failed to load dependencies for send', { message });
    return respond(context, 500, { message: 'failed_to_load_dependencies' });
  }

  if (!service) return respond(context, 404, { message: 'service_not_found' });
  if (!form) return respond(context, 404, { message: 'form_not_found' });

  const requiredForms = Array.isArray(service.required_forms) ? service.required_forms : [];
  const rfEntry = requiredForms.find((rf) => rf.form_id === formId);
  if (!rfEntry) return respond(context, 409, { message: 'form_not_required_for_service' });

  // Load client profile for pre-fill
  const { data: clientProfile, error: cpError } = await withOrgScope(client, 'client_profiles', orgId)
    .select('id, first_name, last_name, identity_number, phone, email')
    .eq('id', clientProfileId)
    .maybeSingle();
  if (cpError || !clientProfile) {
    context.log?.error?.('student-required-forms failed to load client profile', { message: cpError?.message, clientProfileId });
    return respond(context, 404, { message: 'client_profile_not_found' });
  }

  let phone = '';
  let email = '';
  try {
    const resolvedDestination = await resolveClientProfileDeliveryDestination(client, orgId, clientProfileId, deliveryMethod, {
      preferredPhone: requestedPhone,
      preferredEmail: requestedEmail,
      clientProfile,
    });
    if (deliveryMethod === 'whatsapp') {
      phone = resolvedDestination.destination;
    } else {
      email = resolvedDestination.destination;
    }
  } catch (destinationError) {
    context.log?.error?.('student-required-forms failed resolving delivery destination', {
      message: destinationError?.message,
      clientProfileId,
      deliveryMethod,
    });
    return respond(context, 500, { message: 'failed_to_resolve_destination' });
  }

  if (deliveryMethod === 'whatsapp' && !phone) return respond(context, 400, { message: 'missing_phone' });
  if (deliveryMethod === 'email' && !email) return respond(context, 400, { message: 'missing_email' });

  const nowIso = getNowIso();
  const correlationId = randomUUID();

  // Re-use existing pending submission if available (avoid duplicate pending)
  let submissionId = '';
  try {
    const existingSubmission = await findPendingRequiredFormSubmission(client, orgId, { clientProfileId, formId, serviceId });
    if (existingSubmission?.id) {
      const existingRouting = await findActiveRoutingBySubmission(controlClient, existingSubmission.id, ROUTING_CATEGORY);
      if (existingRouting?.id) {
        const inviteUrl = buildInviteLink(req, env, existingRouting.id);
        const responseBody = {
          invite_token: existingRouting.id,
          invite_url: inviteUrl,
          expires_at: existingRouting.expires_at || null,
          client_profile_id: clientProfileId,
          student_id: studentId,
          submission_id: existingSubmission.id,
          form_name: form.name,
          required_form_label: rfEntry.label,
          service_name: service.name,
          delivery_method: deliveryMethod,
          delivery_status: 'ready',
          phone: phone || '',
          email: email || '',
          reused_existing_invite: true,
        };
        if (deliveryMethod === 'email') {
          try {
            await sendInviteEmail(controlClient, env, context, {
              toEmail: email,
              formName: rfEntry.label || form.name,
              inviteUrl,
              expiresAt: existingRouting.expires_at || null,
              emailType: 'required_form',
              orgId,
            });
            responseBody.delivery_status = 'sent';
          } catch {
            responseBody.delivery_status = 'email_failed';
            responseBody.message = 'email_send_failed_manual_fallback';
          }
        }
        // Sync expires_at into otp_metadata so the list UI can display the expiry date.
        // Only patch if not already present; non-fatal on error.
        const existingOtpMeta = existingSubmission.otp_metadata && typeof existingSubmission.otp_metadata === 'object'
          ? existingSubmission.otp_metadata
          : {};
        if (!existingOtpMeta.expires_at && existingRouting.expires_at) {
          const { error: syncExpiresError } = await withOrgScope(client, 'form_submissions', orgId)
            .update({ otp_metadata: { ...existingOtpMeta, expires_at: existingRouting.expires_at } })
            .eq('id', existingSubmission.id);
          if (syncExpiresError) {
            context.log?.warn?.('student-required-forms failed to sync otp_metadata.expires_at on reused submission', {
              message: syncExpiresError?.message,
              submissionId: existingSubmission.id,
            });
          }
        }
        return respond(context, 200, responseBody);
      }
    }
  } catch (error) {
    context.log?.warn?.('student-required-forms failed to check for reusable invite; proceeding with new one', { message: error?.message });
  }

  // Create new form_submission shell
  const { data: submission, error: submissionError } = await withOrgScope(client, 'form_submissions', orgId)
    .insert({
      form_id: formId,
      client_profile_id: clientProfileId,
      student_id: studentId,
      service_id: serviceId,
      answers: {},
      alert_flags: { has_red_flags: false, highest_severity: null, hits: [] },
      otp_metadata: {
        access_mode: 'invite_token',
        delivery_method: deliveryMethod,
        invite_status: 'pending',
      },
      source: deliveryMethod,
      submitted_at: nowIso,
      metadata: {
        workflow_status: 'pending',
        workflow_kind: WORKFLOW_KIND,
        delivery_method: deliveryMethod,
        delivery_to: deliveryMethod === 'whatsapp' ? (phone || '') : (email || ''),
        initiated_at: nowIso,
        initiated_by: userId,
        service_id: serviceId,
        required_form_label: rfEntry.label,
      },
    })
    .select('id')
    .single();

  if (submissionError || !submission?.id) {
    context.log?.error?.('student-required-forms failed to create submission shell', { message: submissionError?.message });
    return respond(context, 500, { message: 'failed_to_create_submission' });
  }
  submissionId = submission.id;

  await writeTenantAudit(context, client, {
    correlationId,
    actorUserId: userId,
    eventType: 'form_submission.required_form.prepared',
    retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
    resourceType: 'form_submission',
    resourceId: submissionId,
    afterState: {
      id: submissionId,
      client_profile_id: clientProfileId,
      student_id: studentId,
      form_id: formId,
      service_id: serviceId,
      workflow_status: 'pending',
      workflow_kind: WORKFLOW_KIND,
    },
    details: { origin: 'api/student-required-forms', delivery_method: deliveryMethod },
  });

  let routingId;
  let expiresAt;
  try {
    const routing = await createInviteRouting(controlClient, {
      orgId,
      category: ROUTING_CATEGORY,
      routingInfo: { submission_id: submissionId, client_profile_id: clientProfileId },
      ttlMinutes,
      createdBy: userId,
      metadata: {
        student_id: studentId,
        client_profile_id: clientProfileId,
        form_id: formId,
        service_id: serviceId,
        delivery_method: deliveryMethod,
        required_form_label: rfEntry.label,
      },
    });
    routingId = routing.id;
    expiresAt = routing.expires_at;
  } catch (routingError) {
    // Clean up the submission shell
    await withOrgScope(client, 'form_submissions', orgId).delete().eq('id', submissionId);
    context.log?.error?.('student-required-forms failed to create active routing', { message: routingError?.message, submissionId });
    return respond(context, 500, { message: 'failed_to_create_active_routing' });
  }

  // Write expires_at back into otp_metadata so the list UI can display the expiry date. Non-fatal.
  const { error: patchExpiresError } = await withOrgScope(client, 'form_submissions', orgId)
    .update({
      otp_metadata: {
        access_mode: 'invite_token',
        delivery_method: deliveryMethod,
        invite_status: 'pending',
        expires_at: expiresAt,
      },
    })
    .eq('id', submissionId);
  if (patchExpiresError) {
    context.log?.warn?.('student-required-forms failed to patch otp_metadata.expires_at on new submission', {
      message: patchExpiresError?.message,
      submissionId,
    });
  }

  const inviteUrl = buildInviteLink(req, env, routingId);
  const responseBody = {
    invite_token: routingId,
    invite_url: inviteUrl,
    expires_at: expiresAt,
    client_profile_id: clientProfileId,
    student_id: studentId,
    submission_id: submissionId,
    form_name: form.name,
    required_form_label: rfEntry.label,
    service_name: service.name,
    delivery_method: deliveryMethod,
    delivery_status: 'ready',
    phone: phone || '',
    email: email || '',
  };

  if (deliveryMethod === 'email') {
    try {
      await sendInviteEmail(controlClient, env, context, {
        toEmail: email,
        formName: rfEntry.label || form.name,
        inviteUrl,
        expiresAt,
        emailType: 'required_form',
        orgId,
      });
      responseBody.delivery_status = 'sent';
    } catch {
      responseBody.delivery_status = 'email_failed';
      responseBody.message = 'email_send_failed_manual_fallback';
    }
  }

  await writeControlAudit(context, controlClient, {
    orgId,
    userId,
    userEmail,
    userRole: role,
    actionType: 'required_form.invite_sent',
    actionCategory: AUDIT_CATEGORIES.FORMS,
    resourceType: 'required_form_invite',
    resourceId: routingId,
    details: {
      submission_id: submissionId,
      client_profile_id: clientProfileId,
      student_id: studentId,
      form_id: formId,
      service_id: serviceId,
      delivery_method: deliveryMethod,
    },
  });

  return respond(context, 200, responseBody);
}

// ─────────────────────────────────────────────────────────────
// Action: load (GET, public)
// ─────────────────────────────────────────────────────────────

async function loadPublicInvite(context, req, { controlClient }) {
  const inviteToken = normalizeUuid(req?.query?.invite || req?.query?.invite_token);
  if (!inviteToken) return respond(context, 400, { message: 'invalid_invite_token' });

  let routingRow;
  try {
    routingRow = await loadInviteRoutingByCategory(controlClient, inviteToken, ROUTING_CATEGORY);
  } catch (error) {
    context.log?.error?.('student-required-forms failed to load routing', { message: error?.message, inviteToken });
    return respond(context, 500, { message: 'failed_to_load_invite' });
  }

  if (!routingRow?.org_id) return respond(context, 404, { message: 'invite_not_found' });

  const client = controlClient;
  const orgId = routingRow.org_id;
  const submissionId = normalizeUuid(routingRow?.routing_info?.submission_id);
  if (!submissionId) return respond(context, 404, { message: 'invite_not_found' });

  attachErrorTracking(context, req, controlClient, {
    orgId,
    metadata: { public_flow: 'load_required_form_invite', submission_id: submissionId, invite_token: inviteToken },
  });

  const { data: submission, error: submissionError } = await withOrgScope(client, 'form_submissions', orgId)
    .select('id, client_profile_id, student_id, form_id, service_id, answers, metadata, submitted_at')
    .eq('id', submissionId)
    .maybeSingle();

  if (submissionError) {
    context.log?.error?.('student-required-forms failed to load submission for load', { message: submissionError?.message, submissionId });
    return respond(context, 500, { message: 'failed_to_load_invite' });
  }
  if (!submission) return respond(context, 404, { message: 'invite_not_found' });

  const submissionMetadata = submission?.metadata && typeof submission.metadata === 'object' ? submission.metadata : {};
  if (String(submissionMetadata.workflow_status || '').toLowerCase() === 'submitted') {
    return respond(context, 409, { message: 'invite_already_completed' });
  }

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
    context.log?.error?.('student-required-forms failed to load invite dependencies', { message: error?.message, submissionId });
    return respond(context, 500, { message: 'failed_to_load_invite' });
  }

  if (!form || form.form_usage !== 'required_form') return respond(context, 404, { message: 'form_not_found' });

  let publicFormState;
  try {
    publicFormState = await resolvePublicFormStateWithSharedBlocks(client, orgId, form, { allowDraftFallback: false });
  } catch (error) {
    if (String(error?.message || '').startsWith('missing_shared_blocks:')) {
      return respond(context, 409, { message: 'form_unavailable' });
    }
    context.log?.error?.('student-required-forms failed resolving public form state', { message: error?.message, submissionId });
    return respond(context, 500, { message: 'failed_to_load_invite' });
  }
  if (!publicFormState.is_published) return respond(context, 409, { message: 'form_not_published' });

  return respond(context, 200, {
    flow: ROUTING_CATEGORY,
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
  });
}

// ─────────────────────────────────────────────────────────────
// Action: submit (POST, public — authenticated by invite token)
// ─────────────────────────────────────────────────────────────

async function submitPublicInvite(context, req, { controlClient }) {
  const body = parseRequestBody(req);
  const inviteToken = normalizeUuid(body?.invite_token || body?.inviteToken || body?.invite);
  if (!inviteToken) return respond(context, 400, { message: 'invalid_invite_token' });

  let routingRow;
  try {
    routingRow = await loadInviteRoutingByCategory(controlClient, inviteToken, ROUTING_CATEGORY);
  } catch (error) {
    context.log?.error?.('student-required-forms failed to resolve invite token on submit', { message: error?.message, inviteToken });
    return respond(context, 500, { message: 'failed_to_submit' });
  }

  if (!routingRow?.org_id) return respond(context, 404, { message: 'invite_not_found' });

  const client = controlClient;
  const orgId = routingRow.org_id;
  const submissionId = normalizeUuid(routingRow?.routing_info?.submission_id);
  if (!submissionId) return respond(context, 404, { message: 'invite_not_found' });

  attachErrorTracking(context, req, controlClient, {
    orgId,
    metadata: { public_flow: 'submit_required_form_invite', submission_id: submissionId, invite_token: inviteToken },
  });

  const { data: submission, error: submissionError } = await withOrgScope(client, 'form_submissions', orgId)
    .select('id, client_profile_id, student_id, form_id, service_id, answers, metadata')
    .eq('id', submissionId)
    .maybeSingle();

  if (submissionError) {
    context.log?.error?.('student-required-forms failed to load submission for submit', { message: submissionError?.message, submissionId });
    return respond(context, 500, { message: 'failed_to_submit' });
  }
  if (!submission) return respond(context, 404, { message: 'invite_not_found' });

  const currentMetadata = submission?.metadata && typeof submission.metadata === 'object' ? submission.metadata : {};
  if (String(currentMetadata.workflow_status || '').toLowerCase() === 'submitted') {
    return respond(context, 409, { message: 'invite_already_completed' });
  }

  let form;
  try {
    const { data: formData, error: formError } = await withOrgScope(client, 'forms', orgId)
      .select('id, name, version, form_schema, alert_rules, visibility_rules, metadata, form_usage, published_at')
      .eq('id', submission.form_id)
      .maybeSingle();
    if (formError) throw new Error(`failed_to_load_form:${formError.message}`);
    form = formData;
  } catch (error) {
    context.log?.error?.('student-required-forms failed to load form for submit', { message: error?.message, submissionId });
    return respond(context, 500, { message: 'failed_to_submit' });
  }

  if (!form || form.form_usage !== 'required_form') return respond(context, 404, { message: 'form_not_found' });

  let publicFormState;
  try {
    publicFormState = await resolvePublicFormStateWithSharedBlocks(client, orgId, form, { allowDraftFallback: false });
  } catch (error) {
    context.log?.error?.('student-required-forms failed resolving public form state for submit', { message: error?.message, submissionId });
    return respond(context, 500, { message: 'failed_to_submit' });
  }

  const rawAnswers = body?.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? body.answers : {};
  const preparedAnswers = prepareAnswersForStorage(rawAnswers, publicFormState.form_schema);
  const alertFlags = evaluateAlertFlags(preparedAnswers, form.alert_rules);
  const schemaSnapshot = materializeSchemaForSnapshot(publicFormState.form_schema, {
    version: form.version,
    formId: form.id,
  });

  const nowIso = getNowIso();
  const { error: updateError } = await withOrgScope(client, 'form_submissions', orgId)
    .update({
      answers: preparedAnswers,
      alert_flags: alertFlags,
      submitted_at: nowIso,
      metadata: {
        ...currentMetadata,
        workflow_status: 'submitted',
        submitted_at: nowIso,
        schema_snapshot: schemaSnapshot,
      },
      otp_metadata: {
        ...(submission.otp_metadata && typeof submission.otp_metadata === 'object' ? submission.otp_metadata : {}),
        invite_status: 'submitted',
        consumed_at: nowIso,
      },
    })
    .eq('id', submissionId);

  if (updateError) {
    context.log?.error?.('student-required-forms failed to update submission on submit', { message: updateError?.message, submissionId });
    return respond(context, 500, { message: 'failed_to_submit' });
  }

  // Delete the routing row (one-time use)
  await controlClient.from('active_routing').delete().eq('id', inviteToken);

  await writeTenantAudit(context, client, {
    correlationId: randomUUID(),
    actorUserId: null,
    eventType: 'form_submission.required_form.submitted',
    retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
    resourceType: 'form_submission',
    resourceId: submissionId,
    afterState: { id: submissionId, workflow_status: 'submitted', workflow_kind: WORKFLOW_KIND },
    details: { origin: 'api/student-required-forms', invite_token: inviteToken },
  });

  return respond(context, 200, {
    message: 'submitted',
    submission_id: submissionId,
    client_profile_id: submission.client_profile_id,
    student_id: submission.student_id,
  });
}

// ─────────────────────────────────────────────────────────────
// Action: compliance (GET, authenticated)
// ─────────────────────────────────────────────────────────────

async function getCompliance(context, req, { controlClient, orgId }) {
  const client = controlClient;
  const studentId = normalizeUuid(req?.query?.student_id || req?.query?.studentId);
  let clientProfileId = normalizeUuid(req?.query?.client_profile_id || req?.query?.clientProfileId);

  if (!clientProfileId && studentId) {
    const { data: studentRow, error: studentError } = await withOrgScope(client, 'students', orgId)
      .select('client_profile_id')
      .eq('id', studentId)
      .maybeSingle();
    if (studentError || !studentRow) {
      return respond(context, 404, { message: 'student_not_found' });
    }
    clientProfileId = normalizeUuid(studentRow.client_profile_id);
  }

  if (!clientProfileId) return respond(context, 400, { message: 'missing_client_profile_id_or_student_id' });

  // Load active lesson templates to discover enrolled service_ids
  // Legacy path: lesson_templates.student_id (old single-student templates)
  let enrolledServiceIds = new Set();
  if (studentId) {
    const { data: legacyTemplates } = await withOrgScope(client, 'lesson_templates', orgId)
      .select('service_id')
      .eq('is_active', true)
      .eq('student_id', studentId);
    if (Array.isArray(legacyTemplates)) {
      legacyTemplates.forEach((t) => { if (t.service_id) enrolledServiceIds.add(t.service_id); });
    }
    // New path: lesson_template_participants (current SSOT)
    const { data: participantRows } = await withOrgScope(client, 'lesson_template_participants', orgId)
      .select('template:lesson_templates(service_id, is_active)')
      .eq('student_id', studentId);
    if (Array.isArray(participantRows)) {
      participantRows.forEach((p) => {
        if (p.template?.is_active !== false && p.template?.service_id) {
          enrolledServiceIds.add(p.template.service_id);
        }
      });
    }
  }

  if (enrolledServiceIds.size === 0 && clientProfileId) {
    // Try to find via student record
    const { data: studentRows } = await withOrgScope(client, 'students', orgId)
      .select('id')
      .eq('client_profile_id', clientProfileId)
      .eq('is_active', true)
      .limit(5);
    if (Array.isArray(studentRows) && studentRows.length > 0) {
      for (const sr of studentRows) {
        // Legacy: lesson_templates.student_id (old single-student style)
        const { data: tRows } = await withOrgScope(client, 'lesson_templates', orgId)
          .select('service_id')
          .eq('is_active', true)
          .eq('student_id', sr.id);
        if (Array.isArray(tRows)) {
          tRows.forEach((t) => { if (t.service_id) enrolledServiceIds.add(t.service_id); });
        }
        // New: lesson_template_participants (current SSOT)
        const { data: pRows } = await withOrgScope(client, 'lesson_template_participants', orgId)
          .select('template:lesson_templates(service_id, is_active)')
          .eq('student_id', sr.id);
        if (Array.isArray(pRows)) {
          pRows.forEach((p) => {
            if (p.template?.is_active !== false && p.template?.service_id) {
              enrolledServiceIds.add(p.template.service_id);
            }
          });
        }
      }
    }
  }

  if (enrolledServiceIds.size === 0) {
    return respond(context, 200, []);
  }

  // Load services that have required_forms configured
  const { data: services, error: servicesError } = await withOrgScope(client, 'Services', orgId)
    .select('id, name, required_forms')
    .in('id', Array.from(enrolledServiceIds));

  if (servicesError) {
    context.log?.error?.('student-required-forms compliance failed to load services', { message: servicesError?.message });
    return respond(context, 500, { message: 'failed_to_load_services' });
  }

  const result = [];
  for (const service of (services || [])) {
    const requiredForms = Array.isArray(service.required_forms) ? service.required_forms : [];
    for (const rf of requiredForms) {
      if (!rf?.form_id) continue;

      // Find the most recent submission for this client + form + service
      const { data: latestSubmission } = await withOrgScope(client, 'form_submissions', orgId)
        .select('id, submitted_at, metadata')
        .eq('client_profile_id', clientProfileId)
        .eq('form_id', rf.form_id)
        .eq('service_id', service.id)
        .contains('metadata', { workflow_kind: WORKFLOW_KIND })
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const submissionMeta = latestSubmission?.metadata && typeof latestSubmission.metadata === 'object'
        ? latestSubmission.metadata
        : {};
      const submissionStatus = String(submissionMeta.workflow_status || '');

      let status;
      if (!latestSubmission) {
        status = 'missing';
      } else if (submissionStatus === 'submitted') {
        status = 'submitted';
      } else {
        status = 'pending';
      }

      // Load form name
      const { data: formRow } = await withOrgScope(client, 'forms', orgId)
        .select('name')
        .eq('id', rf.form_id)
        .maybeSingle();

      result.push({
        service_id: service.id,
        service_name: service.name,
        form_id: rf.form_id,
        form_name: formRow?.name || rf.form_id,
        required_form_label: rf.label,
        enforcement: rf.enforcement || 'warn',
        allow_resubmit: rf.allow_resubmit !== false,
        status,
        submission_id: latestSubmission?.id || null,
        last_submitted_at: submissionStatus === 'submitted' ? latestSubmission.submitted_at : null,
        delivery_method: submissionMeta.delivery_method || null,
        delivery_to: submissionMeta.delivery_to || null,
        last_sent_at: submissionMeta.initiated_at || null,
      });
    }
  }

  return respond(context, 200, result);
}

// ─────────────────────────────────────────────────────────────
// Action: compliance-bulk (GET, authenticated)
// Returns all missing/pending required forms across all active templates
// for the org, grouped by template_id. Single call replaces per-student polls.
// ─────────────────────────────────────────────────────────────

async function getComplianceBulk(context, req, { controlClient, orgId }) {
  const client = controlClient;

  // 1. Load all services that have required_forms configured
  const { data: services, error: servicesError } = await withOrgScope(client, 'Services', orgId)
    .select('id, name, required_forms');

  if (servicesError) {
    context.log?.error?.('compliance-bulk failed to load services', { message: servicesError?.message });
    return respond(context, 500, { message: 'failed_to_load_services' });
  }

  const servicesWithForms = (services || []).filter(
    (s) => Array.isArray(s.required_forms) && s.required_forms.length > 0,
  );
  if (!servicesWithForms.length) return respond(context, 200, {});

  const serviceIds = servicesWithForms.map((s) => s.id);
  const serviceMap = Object.fromEntries(servicesWithForms.map((s) => [s.id, s]));

  // 2. Load active templates for those services
  const { data: templates } = await withOrgScope(client, 'lesson_templates', orgId)
    .select('id, service_id')
    .in('service_id', serviceIds)
    .eq('is_active', true);

  if (!templates?.length) return respond(context, 200, {});

  const templateIds = templates.map((t) => t.id);
  const templateServiceMap = Object.fromEntries(templates.map((t) => [t.id, t.service_id]));

  // 3. Load participants for those templates (current SSOT)
  const { data: participants } = await withOrgScope(client, 'lesson_template_participants', orgId)
    .select('template_id, student_id, student:students(id, client_profile_id)')
    .in('template_id', templateIds);

  if (!participants?.length) return respond(context, 200, {});

  // 4. Build (templateId, serviceId, clientProfileId, studentId, rf) check list
  const checks = [];
  for (const p of participants) {
    const templateId = p.template_id;
    const serviceId = templateServiceMap[templateId];
    const clientProfileId = p.student?.client_profile_id;
    const studentId = p.student_id;
    if (!serviceId || !clientProfileId) continue;
    const service = serviceMap[serviceId];
    for (const rf of (service.required_forms || [])) {
      if (!rf?.form_id) continue;
      checks.push({ templateId, serviceId, clientProfileId, studentId, rf, service });
    }
  }

  if (!checks.length) return respond(context, 200, {});

  // 5. Batch-load all relevant form submissions in one query
  const uniqueClientIds = [...new Set(checks.map((c) => c.clientProfileId))];
  const uniqueFormIds = [...new Set(checks.map((c) => c.rf.form_id))];
  const uniqueServiceIds = [...new Set(checks.map((c) => c.serviceId))];

  const { data: submissions } = await withOrgScope(client, 'form_submissions', orgId)
    .select('id, client_profile_id, form_id, service_id, submitted_at, metadata')
    .in('client_profile_id', uniqueClientIds)
    .in('form_id', uniqueFormIds)
    .in('service_id', uniqueServiceIds)
    .contains('metadata', { workflow_kind: WORKFLOW_KIND })
    .order('submitted_at', { ascending: false });

  // Latest submission per (client_profile_id, form_id, service_id)
  const submissionMap = {};
  for (const sub of (submissions || [])) {
    const key = `${sub.client_profile_id}|${sub.form_id}|${sub.service_id}`;
    if (!submissionMap[key]) submissionMap[key] = sub; // first = latest (ordered desc)
  }

  // 6. Load form names
  const { data: forms } = await withOrgScope(client, 'forms', orgId)
    .select('id, name')
    .in('id', uniqueFormIds);
  const formNameMap = Object.fromEntries((forms || []).map((f) => [f.id, f.name]));

  // 7. Build result: { [templateId]: [...non-submitted entries] }
  const result = {};
  for (const { templateId, serviceId, clientProfileId, studentId, rf, service } of checks) {
    const subKey = `${clientProfileId}|${rf.form_id}|${serviceId}`;
    const sub = submissionMap[subKey];
    const submissionMeta = sub?.metadata && typeof sub.metadata === 'object' ? sub.metadata : {};
    const workflowStatus = String(submissionMeta.workflow_status || '');
    if (workflowStatus === 'submitted') continue; // already done — skip

    const status = !sub ? 'missing' : 'pending';
    if (!result[templateId]) result[templateId] = [];
    result[templateId].push({
      service_id: serviceId,
      service_name: service.name,
      form_id: rf.form_id,
      form_name: formNameMap[rf.form_id] || rf.form_id,
      required_form_label: rf.label,
      enforcement: rf.enforcement || 'warn',
      allow_resubmit: rf.allow_resubmit !== false,
      status,
      client_profile_id: clientProfileId,
      student_id: studentId,
      submission_id: sub?.id || null,
      delivery_method: submissionMeta.delivery_method || null,
      delivery_to: submissionMeta.delivery_to || null,
      last_sent_at: submissionMeta.initiated_at || null,
    });
  }

  return respond(context, 200, result);
}

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────

export default async function studentRequiredForms(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  const action = normalizeString(context?.bindingData?.action).toLowerCase();

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('student-required-forms missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const controlClient = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  attachErrorTracking(context, req, controlClient, {
    metadata: { endpoint: 'student-required-forms', action: action || null },
  });

  // Public actions (no auth required)
  if (method === 'GET' && (!action || action === 'load')) {
    return loadPublicInvite(context, req, { controlClient });
  }
  if (method === 'POST' && action === 'submit') {
    return submitPublicInvite(context, req, { controlClient });
  }

  // Authenticated actions
  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) return respond(context, 401, { message: 'missing_bearer' });

  let authResult;
  try {
    authResult = await controlClient.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('student-required-forms failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);
  if (!orgId) return respond(context, 400, { message: 'invalid_org_id' });

  const userId = authResult.data.user.id;
  const userEmail = authResult.data.user.email || '';

  let role;
  try {
    role = await ensureMembership(controlClient, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('student-required-forms failed to verify membership', { message: membershipError?.message });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }
  if (!role || !isAdminOrOffice(role)) return respond(context, 403, { message: 'forbidden' });

  if (method === 'GET' && action === 'compliance') {
    return getCompliance(context, req, { controlClient, orgId });
  }

  if (method === 'GET' && action === 'compliance-bulk') {
    return getComplianceBulk(context, req, { controlClient, orgId });
  }

  if (method === 'POST' && action === 'send') {
    return sendRequiredForm(context, req, { controlClient, env, orgId, userId, userEmail, role });
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
