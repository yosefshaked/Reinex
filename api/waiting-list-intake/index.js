/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  UUID_PATTERN,
  ensureMembership,
  isAdminOrOffice,
  normalizeString,
  parseRequestBody,
  readEnv,
  resolveOrgId,
  resolveTenantClient,
  respond,
} from '../_shared/org-bff.js';
import { sendBrevoEmail } from '../_shared/brevo.js';

const ROUTING_CATEGORY = 'waiting_list_intake';
const DEFAULT_INVITE_TTL_MINUTES = 10080;
const MAX_INVITE_TTL_MINUTES = 20160;
const DELIVERY_METHODS = new Set(['whatsapp', 'email']);
const PAYMENT_PATH_INTENTS = new Set(['private', 'hmo', 'unsure']);
const HMO_APPROVAL_STATUSES = new Set(['has_approval', 'no_approval_yet', 'send_separately']);
const REVIEWABLE_WAITING_LIST_STATUSES = ['new', 'open'];

function normalizeIdentityNumber(value) {
  return String(value || '').replace(/\D/g, '').trim();
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '').trim();
}

function normalizeEmail(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized || '';
}

function normalizeDeliveryMethod(value) {
  const normalized = normalizeString(value).toLowerCase();
  return DELIVERY_METHODS.has(normalized) ? normalized : '';
}

function normalizePaymentPathIntent(value) {
  const normalized = normalizeString(value).toLowerCase();
  return PAYMENT_PATH_INTENTS.has(normalized) ? normalized : 'unsure';
}

function normalizeHmoApprovalStatus(value) {
  const normalized = normalizeString(value).toLowerCase();
  return HMO_APPROVAL_STATUSES.has(normalized) ? normalized : 'no_approval_yet';
}

function normalizeBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return defaultValue;
}

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function normalizePreferredDays(value) {
  if (!Array.isArray(value)) return null;
  const unique = new Set();
  value.forEach((entry) => {
    const day = Number(entry);
    if (Number.isInteger(day) && day >= 0 && day <= 6) unique.add(day);
  });
  if (!unique.size) return null;
  return Array.from(unique).sort((a, b) => a - b);
}

function isValidTime(value) {
  if (!value) return false;
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(value).trim());
}

function normalizePreferredTimes(value) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;

  const normalized = [];
  for (const entry of value) {
    const day = Number(entry?.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;

    const ranges = Array.isArray(entry?.ranges) ? entry.ranges : [];
    const normalizedRanges = ranges
      .map((range) => ({
        start: typeof range?.start === 'string' ? range.start.trim() : '',
        end: typeof range?.end === 'string' ? range.end.trim() : '',
      }))
      .filter((range) => isValidTime(range.start) && isValidTime(range.end));

    if (normalizedRanges.length) normalized.push({ day, ranges: normalizedRanges });
  }

  return normalized.length ? normalized : [];
}

function readHeader(req, key) {
  const headers = req?.headers || {};
  return headers[key] || headers[String(key || '').toLowerCase()] || headers[String(key || '').toUpperCase()] || '';
}

function toUrlOrigin(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

function normalizeOriginRule(rule) {
  return String(rule || '').trim().toLowerCase().replace(/\/$/, '');
}

function parseAllowedOriginRules(env) {
  const raw = normalizeString(
    env?.APP_ALLOWED_PUBLIC_ORIGINS ||
    env?.ALLOWED_PUBLIC_ORIGINS ||
    env?.PUBLIC_APP_ALLOWED_ORIGINS,
  );
  if (!raw) return [];
  return raw.split(',').map((item) => normalizeOriginRule(item)).filter(Boolean);
}

function isProtocolAllowedForOrigin(parsed) {
  const protocol = String(parsed?.protocol || '').toLowerCase();
  const hostname = String(parsed?.hostname || '').toLowerCase();
  const isLocalhost = hostname === 'localhost' || hostname.endsWith('.localhost');
  if (protocol === 'https:') return true;
  return protocol === 'http:' && isLocalhost;
}

function matchesAllowedRule(origin, rule) {
  const normalizedOrigin = normalizeOriginRule(origin);
  const normalizedRule = normalizeOriginRule(rule);
  if (!normalizedOrigin || !normalizedRule) return false;

  if (normalizedRule.startsWith('*.')) {
    const suffix = normalizedRule.slice(1);
    try {
      return new URL(normalizedOrigin).hostname.toLowerCase().endsWith(suffix);
    } catch {
      return false;
    }
  }

  if (normalizedRule.includes('://')) return normalizedOrigin === normalizedRule;

  try {
    return new URL(normalizedOrigin).hostname.toLowerCase() === normalizedRule;
  } catch {
    return false;
  }
}

function isAllowedSubmitOrigin(origin, env) {
  const normalizedOrigin = normalizeOriginRule(origin);
  if (!normalizedOrigin) return false;

  let parsed;
  try {
    parsed = new URL(normalizedOrigin);
  } catch {
    return false;
  }

  if (!isProtocolAllowedForOrigin(parsed)) return false;

  const rules = parseAllowedOriginRules(env);
  if (!rules.length) return true;
  return rules.some((rule) => matchesAllowedRule(normalizedOrigin, rule));
}

function resolveSubmitBaseUrl(req, env) {
  const origin = toUrlOrigin(readHeader(req, 'origin'));
  if (isAllowedSubmitOrigin(origin, env)) return origin;

  const referer = toUrlOrigin(readHeader(req, 'referer'));
  if (isAllowedSubmitOrigin(referer, env)) return referer;

  const originalUrl = toUrlOrigin(readHeader(req, 'x-ms-original-url'));
  if (isAllowedSubmitOrigin(originalUrl, env)) return originalUrl;

  const configuredBaseUrl = normalizeString(
    env?.APP_PUBLIC_APP_URL ||
    env?.PUBLIC_APP_URL ||
    env?.VITE_PUBLIC_APP_URL ||
    env?.VITE_APP_BASE_URL ||
    env?.VITE_SITE_URL ||
    env?.SITE_URL ||
    env?.FRONTEND_URL,
  );
  if (configuredBaseUrl && isAllowedSubmitOrigin(configuredBaseUrl, env)) {
    return configuredBaseUrl.replace(/\/$/, '');
  }

  const proto = readHeader(req, 'x-forwarded-proto') || 'https';
  const host = readHeader(req, 'x-forwarded-host') || readHeader(req, 'host');
  if (typeof host === 'string' && host.trim()) {
    const forwardedOrigin = `${String(proto).trim()}://${host.trim()}`;
    if (isAllowedSubmitOrigin(forwardedOrigin, env)) return forwardedOrigin;
  }

  return 'https://reinex.app';
}

function buildInviteLink(req, env, inviteToken) {
  const baseUrl = resolveSubmitBaseUrl(req, env);
  const params = new URLSearchParams();
  params.set('invite', inviteToken);
  return `${baseUrl}/#/submit?${params.toString()}`;
}

function getNowIso() {
  return new Date().toISOString();
}

function getFutureIso(minutes) {
  return new Date(Date.now() + (minutes * 60 * 1000)).toISOString();
}

function parseInviteTtlMinutes(raw) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_INVITE_TTL_MINUTES;
  return Math.min(parsed, MAX_INVITE_TTL_MINUTES);
}

function splitContactName(value) {
  const normalized = normalizeString(value);
  if (!normalized) return { firstName: '', lastName: '' };
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || normalized, lastName: '' };
  return { firstName: parts.shift() || normalized, lastName: parts.join(' ') };
}

async function findStudentByIdentityNumber(tenantClient, identityNumber, { excludeId } = {}) {
  if (!identityNumber) return { data: null, error: null };
  let query = tenantClient
    .from('students')
    .select('id, first_name, last_name, identity_number, phone, email, onboarding_status, is_active')
    .eq('identity_number', identityNumber)
    .limit(1);
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query.maybeSingle();
  return { data, error };
}

async function requireWaitingListIntakeForm(tenantClient, formId) {
  const { data, error } = await tenantClient
    .from('forms')
    .select('id, name, description, form_usage, form_schema, is_active')
    .eq('id', formId)
    .maybeSingle();
  if (error) throw new Error(`failed_to_load_form:${error.message}`);
  if (!data || data.is_active === false || data.form_usage !== 'waiting_list_intake') return null;
  return data;
}

async function requireActiveService(tenantClient, serviceId) {
  const { data, error } = await tenantClient
    .from('Services')
    .select('id, name, is_active')
    .eq('id', serviceId)
    .maybeSingle();
  if (error) throw new Error(`failed_to_load_service:${error.message}`);
  if (!data || data.is_active === false) return null;
  return data;
}

async function listActiveServices(tenantClient) {
  const { data, error } = await tenantClient
    .from('Services')
    .select('id, name, is_active')
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function buildEmailText({ formName, inviteUrl, expiresAt }) {
  return [
    'שלום,',
    '',
    `נשלח אליך קישור למילוי ${formName || 'טופס רשימת המתנה'}.`,
    '',
    inviteUrl,
    '',
    `תוקף הקישור עד: ${expiresAt}`,
    '',
    'ניתן לפתוח את הקישור ולמלא את הפרטים ישירות.',
  ].join('\n');
}

function buildEmailHtml({ formName, inviteUrl, expiresAt }) {
  return `<p>שלום,</p><p>נשלח אליך קישור למילוי <strong>${formName || 'טופס רשימת המתנה'}</strong>.</p><p><a href="${inviteUrl}">${inviteUrl}</a></p><p>תוקף הקישור עד: <strong>${expiresAt}</strong></p>`;
}

async function loadInviteRouting(controlClient, inviteToken) {
  if (!UUID_PATTERN.test(inviteToken)) return null;
  const nowIso = getNowIso();
  const { data, error } = await controlClient
    .from('active_routing')
    .select('id, org_id, routing_info, expires_at, metadata')
    .eq('id', inviteToken)
    .eq('category', ROUTING_CATEGORY)
    .gt('expires_at', nowIso)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function findActiveInviteRoutingBySubmission(controlClient, submissionId) {
  if (!UUID_PATTERN.test(String(submissionId || ''))) return null;
  const nowIso = getNowIso();
  const { data, error } = await controlClient
    .from('active_routing')
    .select('id, org_id, routing_info, expires_at, metadata')
    .eq('category', ROUTING_CATEGORY)
    .contains('routing_info', { submission_id: submissionId })
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function findPendingIntakeSubmission(tenantClient, { studentId, formId, primaryServiceId, allowAdditionalServices }) {
  if (!UUID_PATTERN.test(String(studentId || '')) || !UUID_PATTERN.test(String(formId || '')) || !UUID_PATTERN.test(String(primaryServiceId || ''))) {
    return null;
  }

  const { data, error } = await tenantClient
    .from('form_submissions')
    .select('id, metadata, submitted_at')
    .eq('student_id', studentId)
    .eq('form_id', formId)
    .contains('metadata', {
      workflow_kind: 'waiting_list_intake',
      workflow_status: 'pending',
      primary_service_id: primaryServiceId,
      allow_additional_services: allowAdditionalServices,
    })
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function normalizeCustomAnswers(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function createOrReuseProspectStudent(tenantClient, payload) {
  const identityNumber = normalizeIdentityNumber(payload.identity_number);

  if (identityNumber) {
    const { data: existingStudent, error } = await findStudentByIdentityNumber(tenantClient, identityNumber);
    if (error) throw new Error(`failed_to_lookup_student:${error.message}`);

    if (existingStudent) {
      const safeUpdates = {};
      const phone = normalizePhone(payload.phone);
      const email = normalizeEmail(payload.email);
      if (!normalizeString(existingStudent.phone) && phone) safeUpdates.phone = phone;
      if (!normalizeString(existingStudent.email) && email) safeUpdates.email = email;
      if (Object.keys(safeUpdates).length) {
        await tenantClient.from('students').update({ ...safeUpdates, updated_at: getNowIso() }).eq('id', existingStudent.id);
      }
      return existingStudent.id;
    }
  }

  const { firstName, lastName } = splitContactName(payload.contact_name);
  const { data, error } = await tenantClient
    .from('students')
    .insert({
      first_name: firstName || 'ללא שם',
      last_name: lastName,
      identity_number: identityNumber || null,
      phone: normalizePhone(payload.phone) || null,
      email: normalizeEmail(payload.email) || null,
      default_notification_method: normalizeDeliveryMethod(payload.delivery_method) || 'whatsapp',
      notes_internal: normalizeString(payload.internal_note) || null,
      onboarding_status: 'pending_wl_form',
      is_active: false,
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`failed_to_create_student:${error?.message || 'unknown_error'}`);
  }

  return data.id;
}

async function sendInvite(context, req, { controlClient, env, orgId, userId }) {
  const body = parseRequestBody(req);
  const formId = normalizeUuid(body?.form_id || body?.formId);
  const desiredServiceId = normalizeUuid(body?.desired_service_id || body?.desiredServiceId || body?.service_id || body?.serviceId);
  const deliveryMethod = normalizeDeliveryMethod(body?.delivery_method || body?.deliveryMethod);
  const contactName = normalizeString(body?.contact_name || body?.contactName);
  const phone = normalizePhone(body?.phone);
  const email = normalizeEmail(body?.email);
  const allowAdditionalServices = normalizeBoolean(body?.allow_additional_services ?? body?.allowAdditionalServices, false);
  const identityNumber = normalizeIdentityNumber(body?.identity_number || body?.identityNumber);
  const internalNote = normalizeString(body?.internal_note || body?.internalNote) || null;
  const ttlMinutes = parseInviteTtlMinutes(body?.expires_in_minutes ?? body?.expiresInMinutes);

  if (!formId) return respond(context, 400, { message: 'invalid_form_id' });
  if (!desiredServiceId) return respond(context, 400, { message: 'invalid_service_id' });
  if (!deliveryMethod) return respond(context, 400, { message: 'invalid_delivery_method' });
  if (!contactName) return respond(context, 400, { message: 'missing_contact_name' });
  if (deliveryMethod === 'whatsapp' && !phone) return respond(context, 400, { message: 'missing_phone' });
  if (deliveryMethod === 'email' && !email) return respond(context, 400, { message: 'missing_email' });

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, controlClient, env, orgId);
  if (tenantError) return respond(context, tenantError.status, tenantError.body);

  let form;
  let service;
  try {
    [form, service] = await Promise.all([
      requireWaitingListIntakeForm(tenantClient, formId),
      requireActiveService(tenantClient, desiredServiceId),
    ]);
  } catch (error) {
    const message = String(error?.message || '');
    if (message.startsWith('failed_to_load_form:')) {
      context.log?.error?.('waiting-list-intake failed to load form', { message: message.slice('failed_to_load_form:'.length), formId });
      return respond(context, 500, { message: 'failed_to_load_form' });
    }
    if (message.startsWith('failed_to_load_service:')) {
      context.log?.error?.('waiting-list-intake failed to load service', { message: message.slice('failed_to_load_service:'.length), desiredServiceId });
      return respond(context, 500, { message: 'failed_to_load_service' });
    }
    throw error;
  }

  if (!form) return respond(context, 404, { message: 'form_not_found' });
  if (!service) return respond(context, 404, { message: 'service_not_found' });

  let studentId = '';
  try {
    studentId = await createOrReuseProspectStudent(tenantClient, {
      contact_name: contactName,
      phone,
      email,
      identity_number: identityNumber,
      delivery_method: deliveryMethod,
      internal_note: internalNote,
    });
  } catch (error) {
    const message = String(error?.message || '');
    if (message.startsWith('failed_to_lookup_student:')) {
      context.log?.error?.('waiting-list-intake failed to lookup student', { message: message.slice('failed_to_lookup_student:'.length), orgId });
      return respond(context, 500, { message: 'failed_to_lookup_student' });
    }
    if (message.startsWith('failed_to_create_student:')) {
      context.log?.error?.('waiting-list-intake failed to create student', { message: message.slice('failed_to_create_student:'.length), orgId });
      return respond(context, 500, { message: 'failed_to_create_student' });
    }
    throw error;
  }

  const nowIso = getNowIso();
  let submissionId = '';

  try {
    const existingSubmission = await findPendingIntakeSubmission(tenantClient, {
      studentId,
      formId,
      primaryServiceId: desiredServiceId,
      allowAdditionalServices,
    });

    if (existingSubmission?.id) {
      const existingRouting = await findActiveInviteRoutingBySubmission(controlClient, existingSubmission.id);
      if (existingRouting?.id) {
        const inviteUrl = buildInviteLink(req, env, existingRouting.id);
        const responseBody = {
          invite_token: existingRouting.id,
          invite_url: inviteUrl,
          expires_at: existingRouting.expires_at || null,
          student_id: studentId,
          submission_id: existingSubmission.id,
          form_name: form.name,
          desired_service: { id: service.id, name: service.name },
          delivery_method: deliveryMethod,
          delivery_status: 'ready',
          phone: phone || '',
          email: email || '',
          reused_existing_invite: true,
        };

        if (deliveryMethod === 'email') {
          try {
            await sendBrevoEmail({
              to: email,
              subject: `${form.name || 'טופס רשימת המתנה'} - קישור למילוי`,
              textContent: buildEmailText({ formName: form.name, inviteUrl, expiresAt: existingRouting.expires_at || null }),
              htmlContent: buildEmailHtml({ formName: form.name, inviteUrl, expiresAt: existingRouting.expires_at || null }),
            }, { env }, context);
            responseBody.delivery_status = 'sent';
          } catch (error) {
            context.log?.warn?.('waiting-list-intake email resend failed for reused invite; returning manual fallback', {
              message: error?.message,
              studentId,
              submissionId: existingSubmission.id,
            });
            responseBody.delivery_status = 'email_failed';
            responseBody.message = 'email_send_failed_manual_fallback';
          }
        }

        return respond(context, 200, responseBody);
      }
    }
  } catch (error) {
    context.log?.error?.('waiting-list-intake failed to resolve reusable invite state', {
      message: error?.message,
      studentId,
      formId,
      desiredServiceId,
    });
    return respond(context, 500, { message: 'failed_to_prepare_invite' });
  }

  const { data: submission, error: submissionError } = await tenantClient
    .from('form_submissions')
    .insert({
      form_id: formId,
      student_id: studentId,
      answers: {},
      alert_flags: {},
      otp_metadata: {
        access_mode: 'invite_token',
        delivery_method: deliveryMethod,
        invite_status: 'pending',
      },
      source: deliveryMethod,
      submitted_at: nowIso,
      metadata: {
        workflow_status: 'pending',
        workflow_kind: 'waiting_list_intake',
        delivery_method: deliveryMethod,
        initiated_at: nowIso,
        initiated_by: userId,
        primary_service_id: desiredServiceId,
        allow_additional_services: allowAdditionalServices,
        internal_note: internalNote,
      },
    })
    .select('id')
    .single();

  if (submissionError || !submission?.id) {
    context.log?.error?.('waiting-list-intake failed to create submission shell', {
      message: submissionError?.message,
      studentId,
      formId,
    });
    return respond(context, 500, { message: 'failed_to_create_submission' });
  }
  submissionId = submission.id;

  const expiresAt = getFutureIso(ttlMinutes);
  const { data: routingRow, error: routingError } = await controlClient
    .from('active_routing')
    .insert({
      org_id: orgId,
      category: ROUTING_CATEGORY,
      expires_at: expiresAt,
      created_by: userId,
      routing_info: { submission_id: submission.id },
      metadata: {
        student_id: studentId,
        form_id: formId,
        delivery_method: deliveryMethod,
        primary_service_id: desiredServiceId,
        allow_additional_services: allowAdditionalServices,
      },
    })
    .select('id')
    .single();

  if (routingError || !routingRow?.id) {
    if (submissionId) {
      const { error: cleanupSubmissionError } = await tenantClient
        .from('form_submissions')
        .delete()
        .eq('id', submissionId);

      if (cleanupSubmissionError) {
        context.log?.warn?.('waiting-list-intake failed cleaning pending submission after routing failure', {
          message: cleanupSubmissionError.message,
          submissionId,
        });
      }
    }
    context.log?.error?.('waiting-list-intake failed to create active routing row', {
      message: routingError?.message,
      submissionId,
      orgId,
    });
    return respond(context, 500, { message: 'failed_to_create_active_routing' });
  }

  const inviteUrl = buildInviteLink(req, env, routingRow.id);
  const responseBody = {
    invite_token: routingRow.id,
    invite_url: inviteUrl,
    expires_at: expiresAt,
    student_id: studentId,
    submission_id: submissionId,
    form_name: form.name,
    desired_service: { id: service.id, name: service.name },
    delivery_method: deliveryMethod,
    delivery_status: 'ready',
    phone: phone || '',
    email: email || '',
  };

  if (deliveryMethod === 'email') {
    try {
      await sendBrevoEmail({
        to: email,
        subject: `${form.name || 'טופס רשימת המתנה'} - קישור למילוי`,
        textContent: buildEmailText({ formName: form.name, inviteUrl, expiresAt }),
        htmlContent: buildEmailHtml({ formName: form.name, inviteUrl, expiresAt }),
      }, { env }, context);
      responseBody.delivery_status = 'sent';
    } catch (error) {
      context.log?.warn?.('waiting-list-intake email send failed; returning invite for manual fallback', {
        message: error?.message,
        studentId,
        submissionId,
      });
      responseBody.delivery_status = 'email_failed';
      responseBody.message = 'email_send_failed_manual_fallback';
    }
  }

  return respond(context, 200, responseBody);
}

async function loadPublicInvite(context, req, { controlClient, env }) {
  const inviteToken = normalizeUuid(req?.query?.invite || req?.query?.invite_token || req?.query?.inviteToken);
  if (!inviteToken) return respond(context, 400, { message: 'invalid_invite_token' });

  let routingRow;
  try {
    routingRow = await loadInviteRouting(controlClient, inviteToken);
  } catch (error) {
    context.log?.error?.('waiting-list-intake failed to load active routing row', { message: error?.message, inviteToken });
    return respond(context, 500, { message: 'failed_to_load_invite' });
  }

  if (!routingRow?.org_id) return respond(context, 404, { message: 'invite_not_found' });

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, controlClient, env, routingRow.org_id);
  if (tenantError) return respond(context, tenantError.status, tenantError.body);

  const submissionId = normalizeUuid(routingRow?.routing_info?.submission_id);
  if (!submissionId) return respond(context, 404, { message: 'invite_not_found' });

  const { data: submission, error: submissionError } = await tenantClient
    .from('form_submissions')
    .select('id, student_id, form_id, answers, metadata, submitted_at')
    .eq('id', submissionId)
    .maybeSingle();

  if (submissionError) {
    context.log?.error?.('waiting-list-intake failed to load submission shell', { message: submissionError?.message, submissionId });
    return respond(context, 500, { message: 'failed_to_load_invite' });
  }
  if (!submission) return respond(context, 404, { message: 'invite_not_found' });
  const submissionMetadata = submission?.metadata && typeof submission.metadata === 'object' ? submission.metadata : {};
  if (String(submissionMetadata.workflow_status || '').toLowerCase() === 'submitted') {
    return respond(context, 409, { message: 'invite_already_completed' });
  }

  const [{ data: form }, { data: student }, services] = await Promise.all([
    tenantClient.from('forms').select('id, name, description, form_schema, form_usage').eq('id', submission.form_id).maybeSingle(),
    tenantClient.from('students').select('id, first_name, last_name, identity_number, phone, email').eq('id', submission.student_id).maybeSingle(),
    listActiveServices(tenantClient),
  ]);

  if (!form || form.form_usage !== 'waiting_list_intake') {
    return respond(context, 404, { message: 'form_not_found' });
  }

  const primaryServiceId = normalizeUuid(submissionMetadata.primary_service_id);

  return respond(context, 200, {
    mode: 'waiting_list_intake',
    invite_token: inviteToken,
    submission_id: submission.id,
    expires_at: routingRow.expires_at || null,
    form_name: form.name || 'טופס רשימת המתנה',
    form_description: form.description || '',
    form_schema: form.form_schema && typeof form.form_schema === 'object' ? form.form_schema : { type: 'object', properties: {}, required: [] },
    prospect: {
      student_id: student?.id || null,
      contact_name: [student?.first_name, student?.last_name].filter(Boolean).join(' ').trim(),
      identity_number: student?.identity_number || '',
      phone: student?.phone || '',
      email: student?.email || '',
    },
    intake_config: {
      primary_service_id: primaryServiceId || null,
      allow_additional_services: Boolean(submissionMetadata.allow_additional_services),
      service_options: services.map((service) => ({ id: service.id, name: service.name })),
    },
  });
}

async function submitPublicInvite(context, req, { controlClient, env }) {
  const body = parseRequestBody(req);
  const inviteToken = normalizeUuid(body?.invite_token || body?.inviteToken || body?.invite);
  if (!inviteToken) return respond(context, 400, { message: 'invalid_invite_token' });

  let routingRow;
  try {
    routingRow = await loadInviteRouting(controlClient, inviteToken);
  } catch (error) {
    context.log?.error?.('waiting-list-intake failed to resolve invite token on submit', { message: error?.message, inviteToken });
    return respond(context, 500, { message: 'failed_to_submit_intake' });
  }

  if (!routingRow?.org_id) return respond(context, 404, { message: 'invite_not_found' });

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, controlClient, env, routingRow.org_id);
  if (tenantError) return respond(context, tenantError.status, tenantError.body);

  const submissionId = normalizeUuid(routingRow?.routing_info?.submission_id);
  if (!submissionId) return respond(context, 404, { message: 'invite_not_found' });

  const { data: submission, error: submissionError } = await tenantClient
    .from('form_submissions')
    .select('id, student_id, form_id, answers, metadata, submitted_at')
    .eq('id', submissionId)
    .maybeSingle();

  if (submissionError) {
    context.log?.error?.('waiting-list-intake failed to load submission for submit', { message: submissionError?.message, submissionId });
    return respond(context, 500, { message: 'failed_to_submit_intake' });
  }
  if (!submission) return respond(context, 404, { message: 'invite_not_found' });
  const currentSubmissionMetadata = submission?.metadata && typeof submission.metadata === 'object' ? submission.metadata : {};
  if (String(currentSubmissionMetadata.workflow_status || '').toLowerCase() === 'submitted') {
    return respond(context, 409, { message: 'invite_already_completed' });
  }

  const [{ data: form }, services] = await Promise.all([
    tenantClient.from('forms').select('id, form_schema, form_usage').eq('id', submission.form_id).maybeSingle(),
    listActiveServices(tenantClient),
  ]);

  if (!form || form.form_usage !== 'waiting_list_intake') {
    return respond(context, 404, { message: 'form_not_found' });
  }

  const intake = body?.intake && typeof body.intake === 'object' && !Array.isArray(body.intake) ? body.intake : {};
  const customAnswers = normalizeCustomAnswers(body?.custom_answers ?? body?.customAnswers);

  const contactName = normalizeString(intake?.contact_name || intake?.contactName);
  const phone = normalizePhone(intake?.phone);
  const email = normalizeEmail(intake?.email);
  const identityNumber = normalizeIdentityNumber(intake?.identity_number || intake?.identityNumber);
  const preferredDays = normalizePreferredDays(intake?.preferred_days ?? intake?.preferredDays);
  const preferredTimes = normalizePreferredTimes(intake?.preferred_times ?? intake?.preferredTimes);
  const paymentPathIntent = normalizePaymentPathIntent(intake?.payment_path_intent ?? intake?.paymentPathIntent);
  const hmoApprovalStatus = normalizeHmoApprovalStatus(intake?.hmo_approval_status ?? intake?.hmoApprovalStatus);
  const prospectNotes = normalizeString(intake?.notes);

  if (!contactName) return respond(context, 400, { message: 'missing_contact_name' });

  const serviceById = new Map(services.map((service) => [service.id, service]));
  const primaryServiceId = normalizeUuid(currentSubmissionMetadata.primary_service_id);
  if (!primaryServiceId || !serviceById.has(primaryServiceId)) {
    return respond(context, 400, { message: 'invalid_primary_service' });
  }

  const allowAdditionalServices = Boolean(currentSubmissionMetadata.allow_additional_services);
  const requestedAdditionalServices = Array.isArray(intake?.requested_additional_service_ids ?? intake?.requestedAdditionalServiceIds)
    ? (intake?.requested_additional_service_ids ?? intake?.requestedAdditionalServiceIds)
    : [];

  const additionalServiceIds = allowAdditionalServices
    ? Array.from(new Set(
        requestedAdditionalServices
          .map((value) => normalizeUuid(value))
          .filter((value) => value && value !== primaryServiceId && serviceById.has(value)),
      ))
    : [];

  const requestedServiceIds = [primaryServiceId, ...additionalServiceIds];
  const nowIso = getNowIso();

  let identityConflictStudentId = '';
  if (identityNumber) {
    const { data: conflictStudent, error } = await findStudentByIdentityNumber(tenantClient, identityNumber, {
      excludeId: submission.student_id,
    });
    if (error) {
      context.log?.error?.('waiting-list-intake failed to validate submitted identity number', {
        message: error.message,
        studentId: submission.student_id,
      });
      return respond(context, 500, { message: 'failed_to_validate_identity_number' });
    }
    if (conflictStudent?.id) identityConflictStudentId = conflictStudent.id;
  }

  const { firstName, lastName } = splitContactName(contactName);
  const studentUpdates = {
    first_name: firstName || 'ללא שם',
    last_name: lastName,
    phone: phone || null,
    email: email || null,
    updated_at: nowIso,
  };
  if (identityNumber && !identityConflictStudentId) {
    studentUpdates.identity_number = identityNumber;
  }

  const { error: updateStudentError } = await tenantClient
    .from('students')
    .update(studentUpdates)
    .eq('id', submission.student_id);

  if (updateStudentError) {
    context.log?.error?.('waiting-list-intake failed to update prospect student from submission', {
      message: updateStudentError.message,
      studentId: submission.student_id,
    });
    return respond(context, 500, { message: 'failed_to_update_student' });
  }

  const { error: updateSubmissionError } = await tenantClient
    .from('form_submissions')
    .update({
      answers: {
        intake: {
          contact_name: contactName,
          phone: phone || null,
          email: email || null,
          identity_number: identityNumber || null,
          preferred_days: preferredDays,
          preferred_times: preferredTimes,
          payment_path_intent: paymentPathIntent,
          hmo_approval_status: hmoApprovalStatus,
          notes: prospectNotes || null,
          primary_service_id: primaryServiceId,
          requested_additional_service_ids: additionalServiceIds,
        },
        custom_answers: customAnswers,
      },
      submitted_at: nowIso,
      metadata: {
        ...currentSubmissionMetadata,
        workflow_status: 'submitted',
        submitted_at: nowIso,
        workflow_kind: 'waiting_list_intake',
        identity_number_conflict_student_id: identityConflictStudentId || null,
        schema_snapshot: form.form_schema && typeof form.form_schema === 'object' ? form.form_schema : {},
      },
      otp_metadata: {
        access_mode: 'invite_token',
        invite_status: 'submitted',
        submitted_at: nowIso,
      },
    })
    .eq('id', submissionId);

  if (updateSubmissionError) {
    context.log?.error?.('waiting-list-intake failed to finalize submission', {
      message: updateSubmissionError.message,
      submissionId,
    });
    return respond(context, 500, { message: 'failed_to_submit_intake' });
  }

  for (const serviceId of requestedServiceIds) {
    const intakeMetadata = {
      source: 'waiting_list_intake',
      form_submission_id: submissionId,
      payment_path_intent: paymentPathIntent,
      hmo_approval_status: hmoApprovalStatus,
      allow_additional_services: allowAdditionalServices,
      identity_number_conflict_student_id: identityConflictStudentId || null,
      submitted_at: nowIso,
    };

    const { data: existingEntry, error: existingEntryError } = await tenantClient
      .from('waiting_list_entries')
      .select('id, metadata')
      .eq('student_id', submission.student_id)
      .eq('desired_service_id', serviceId)
      .in('status', REVIEWABLE_WAITING_LIST_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingEntryError) {
      context.log?.error?.('waiting-list-intake failed to load existing waiting-list entry', {
        message: existingEntryError.message,
        studentId: submission.student_id,
        serviceId,
      });
      return respond(context, 500, { message: 'failed_to_create_waiting_list' });
    }

    if (existingEntry?.id) {
      const mergedMetadata = existingEntry.metadata && typeof existingEntry.metadata === 'object'
        ? { ...existingEntry.metadata, ...intakeMetadata }
        : intakeMetadata;
      const { error: updateEntryError } = await tenantClient
        .from('waiting_list_entries')
        .update({
          preferred_days: preferredDays,
          preferred_times: preferredTimes,
          notes: prospectNotes || null,
          status: 'new',
          metadata: mergedMetadata,
        })
        .eq('id', existingEntry.id);

      if (updateEntryError) {
        context.log?.error?.('waiting-list-intake failed to update waiting-list entry', {
          message: updateEntryError.message,
          entryId: existingEntry.id,
        });
        return respond(context, 500, { message: 'failed_to_create_waiting_list' });
      }
    } else {
      const { error: insertEntryError } = await tenantClient
        .from('waiting_list_entries')
        .insert({
          student_id: submission.student_id,
          desired_service_id: serviceId,
          preferred_days: preferredDays,
          preferred_times: preferredTimes,
          notes: prospectNotes || null,
          status: 'new',
          metadata: intakeMetadata,
        });

      if (insertEntryError) {
        context.log?.error?.('waiting-list-intake failed to insert waiting-list entry', {
          message: insertEntryError.message,
          studentId: submission.student_id,
          serviceId,
        });
        return respond(context, 500, { message: 'failed_to_create_waiting_list' });
      }
    }
  }

  const { error: cleanupError } = await controlClient
    .from('active_routing')
    .delete()
    .eq('id', inviteToken);

  if (cleanupError) {
    context.log?.error?.('waiting-list-intake failed cleaning active routing row after submit', {
      message: cleanupError.message,
      inviteToken,
    });
    return respond(context, 500, { message: 'failed_to_submit_intake' });
  }

  return respond(context, 200, {
    message: 'submitted',
    submission_id: submissionId,
    student_id: submission.student_id,
    requested_service_ids: requestedServiceIds,
    identity_number_conflict_student_id: identityConflictStudentId || null,
  });
}

export default async function waitingListIntake(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  const action = normalizeString(context?.bindingData?.action).toLowerCase();

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('waiting-list-intake missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const controlClient = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  if (method === 'GET' && (!action || action === 'load')) {
    return loadPublicInvite(context, req, { controlClient, env });
  }

  if (method === 'POST' && action === 'submit') {
    return submitPublicInvite(context, req, { controlClient, env });
  }

  if (method !== 'POST' || action !== 'send') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) return respond(context, 401, { message: 'missing_bearer' });

  let authResult;
  try {
    authResult = await controlClient.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('waiting-list-intake failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);
  if (!orgId) return respond(context, 400, { message: 'invalid_org_id' });

  const userId = authResult.data.user.id;

  let role;
  try {
    role = await ensureMembership(controlClient, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('waiting-list-intake failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role || !isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  return sendInvite(context, req, { controlClient, env, orgId, userId });
}
