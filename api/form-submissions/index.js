/* eslint-env node */
import { createHash, randomInt } from 'node:crypto';
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  UUID_PATTERN,
  ensureMembership,
  isAdminOrOffice,
  isAdminRole,
  normalizeString,
  parseRequestBody,
  readEnv,
  resolveOrgId,
  resolveTenantClient,
  respond,
} from '../_shared/org-bff.js';
import { sendBrevoEmail } from '../_shared/brevo.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';

const OTP_DIGITS = 6;
const OTP_TTL_MINUTES = 15;
const ROUTING_CATEGORY = 'form_submission';
const RATE_LIMIT_CATEGORY = 'form_submission_rate_limit';
const MAX_VERIFY_FAILURES = 5;
const RATE_LIMIT_BLOCK_MINUTES = 60;
const INVALID_VERIFY_MESSAGE = 'מזהה או קוד אימות שגויים';

function normalizeDeliveryMethod(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === 'whatsapp' || normalized === 'email' ? normalized : '';
}

function normalizeOtp(value) {
  return String(value || '').replace(/\D/g, '').slice(0, OTP_DIGITS);
}

function hashOtp(otp) {
  return createHash('sha256').update(String(otp || '')).digest('hex');
}

function generateOtp() {
  const min = 10 ** (OTP_DIGITS - 1);
  const max = (10 ** OTP_DIGITS) - 1;
  return String(randomInt(min, max + 1));
}

function normalizeIdentityNumber(value) {
  return String(value || '').replace(/\D/g, '').trim();
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '').trim();
}

function normalizeJsonObject(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }
  return value;
}

function getNowIso() {
  return new Date().toISOString();
}

function getFutureIso(minutes) {
  return new Date(Date.now() + (minutes * 60 * 1000)).toISOString();
}

function parseLimit(value, fallback = 50, max = 200) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
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

  return raw
    .split(',')
    .map((item) => normalizeOriginRule(item))
    .filter(Boolean);
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
      const parsed = new URL(normalizedOrigin);
      return parsed.hostname.toLowerCase().endsWith(suffix);
    } catch {
      return false;
    }
  }

  if (normalizedRule.includes('://')) {
    return normalizedOrigin === normalizedRule;
  }

  try {
    const parsed = new URL(normalizedOrigin);
    return parsed.hostname.toLowerCase() === normalizedRule;
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

  if (!isProtocolAllowedForOrigin(parsed)) {
    return false;
  }

  const rules = parseAllowedOriginRules(env);
  if (!rules.length) {
    // Without an explicit allow-list we accept any valid browser origin.
    return true;
  }

  return rules.some((rule) => matchesAllowedRule(normalizedOrigin, rule));
}

function resolveSubmitBaseUrl(req, env) {
  const origin = toUrlOrigin(readHeader(req, 'origin'));
  if (isAllowedSubmitOrigin(origin, env)) {
    return origin;
  }

  const referer = toUrlOrigin(readHeader(req, 'referer'));
  if (isAllowedSubmitOrigin(referer, env)) {
    return referer;
  }

  const originalUrl = toUrlOrigin(readHeader(req, 'x-ms-original-url'));
  if (isAllowedSubmitOrigin(originalUrl, env)) {
    return originalUrl;
  }

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
    if (isAllowedSubmitOrigin(forwardedOrigin, env)) {
      return forwardedOrigin;
    }
  }

  return 'https://reinex.app';
}

function resolveClientIp(req) {
  const headers = req?.headers || {};
  const xf = headers['x-forwarded-for'] || headers['X-Forwarded-For'] || '';
  if (typeof xf === 'string' && xf.trim()) {
    return xf.split(',')[0].trim();
  }
  return '';
}

async function resolveStudentDestination(tenantClient, studentId, fieldName) {
  const { data: student, error: studentError } = await tenantClient
    .from('students')
    .select(`id, ${fieldName}`)
    .eq('id', studentId)
    .maybeSingle();

  if (studentError) throw studentError;

  const direct = normalizeString(student?.[fieldName]);
  if (direct) return direct;

  const { data: links, error: linksError } = await tenantClient
    .from('student_guardians')
    .select('guardian_id, is_primary')
    .eq('student_id', studentId)
    .order('is_primary', { ascending: false });

  if (linksError) throw linksError;

  const guardianIds = (Array.isArray(links) ? links : [])
    .map((row) => row?.guardian_id)
    .filter(Boolean);

  if (!guardianIds.length) return '';

  const { data: guardians, error: guardiansError } = await tenantClient
    .from('guardians')
    .select(`id, ${fieldName}`)
    .in('id', guardianIds);

  if (guardiansError) throw guardiansError;

  const byId = new Map((Array.isArray(guardians) ? guardians : []).map((g) => [g.id, g]));

  for (const link of links || []) {
    const value = normalizeString(byId.get(link.guardian_id)?.[fieldName]);
    if (value) return value;
  }

  return '';
}

async function findTenantOtpChallenge(tenantClient, { studentId, submissionId, otp }) {
  const tokenHash = hashOtp(otp);
  const nowIso = getNowIso();

  const { data, error } = await tenantClient
    .from('otp_challenges')
    .select('id, status, expires_at, metadata, attempts')
    .eq('student_id', studentId)
    .eq('token_hash', tokenHash)
    .in('status', ['pending', 'verified'])
    .gt('expires_at', nowIso)
    .order('expires_at', { ascending: false })
    .limit(10);

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.find((row) => String(row?.metadata?.submission_id || '') === submissionId) || null;
}

async function findActiveRoutingByIdentity(controlClient, identityNumber, otp) {
  const nowIso = getNowIso();
  const { data, error } = await controlClient
    .from('active_routing')
    .select('id, org_id, routing_info, expires_at, metadata')
    .eq('category', ROUTING_CATEGORY)
    .contains('routing_info', {
      student_identity_number: identityNumber,
      otp_code: otp,
    })
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return rows[0] || null;
}

async function findActiveRoutingBySubmission(controlClient, submissionId, otp) {
  const nowIso = getNowIso();
  const { data, error } = await controlClient
    .from('active_routing')
    .select('id, org_id, routing_info, expires_at, created_by, metadata')
    .eq('category', ROUTING_CATEGORY)
    .contains('routing_info', {
      submission_id: submissionId,
      otp_code: otp,
    })
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return rows[0] || null;
}

function parseRateLimitMetadata(value) {
  const metadata = normalizeJsonObject(value, {});
  const failedAttempts = Number.isFinite(Number(metadata.failed_attempts)) ? Number(metadata.failed_attempts) : 0;
  const blockedUntil = normalizeString(metadata.blocked_until);
  return { metadata, failedAttempts, blockedUntil };
}

function isStillBlocked(blockedUntilIso) {
  if (!blockedUntilIso) return false;
  const until = new Date(blockedUntilIso).getTime();
  if (Number.isNaN(until)) return false;
  return until > Date.now();
}

async function findRateLimitRow(controlClient, identityNumber) {
  const nowIso = getNowIso();
  const { data, error } = await controlClient
    .from('active_routing')
    .select('id, metadata, expires_at')
    .eq('category', RATE_LIMIT_CATEGORY)
    .contains('routing_info', { student_identity_number: identityNumber })
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return rows[0] || null;
}

async function registerVerifyFailure(controlClient, identityNumber, ipAddress) {
  const nowIso = getNowIso();
  const existing = await findRateLimitRow(controlClient, identityNumber);

  const existingMeta = parseRateLimitMetadata(existing?.metadata);
  const nextAttempts = existingMeta.failedAttempts + 1;
  const blockedUntil = nextAttempts >= MAX_VERIFY_FAILURES ? getFutureIso(RATE_LIMIT_BLOCK_MINUTES) : null;

  const metadata = {
    failed_attempts: nextAttempts,
    blocked_until: blockedUntil,
    last_failed_at: nowIso,
    ip: ipAddress || null,
  };

  const expiresAt = blockedUntil || getFutureIso(RATE_LIMIT_BLOCK_MINUTES);

  if (existing?.id) {
    const { error } = await controlClient
      .from('active_routing')
      .update({
        metadata,
        expires_at: expiresAt,
      })
      .eq('id', existing.id);

    if (error) throw error;
    return { blockedUntil };
  }

  const { error } = await controlClient
    .from('active_routing')
    .insert({
      org_id: null,
      category: RATE_LIMIT_CATEGORY,
      routing_info: { student_identity_number: identityNumber },
      expires_at: expiresAt,
      created_by: null,
      metadata,
    });

  if (error) throw error;
  return { blockedUntil };
}

async function clearVerifyFailures(controlClient, identityNumber) {
  const { error } = await controlClient
    .from('active_routing')
    .delete()
    .eq('category', RATE_LIMIT_CATEGORY)
    .contains('routing_info', { student_identity_number: identityNumber });

  if (error) throw error;
}

async function resolveOrganizationSenderName(controlClient, orgId, context) {
  try {
    const { data, error } = await controlClient
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .maybeSingle();

    if (error) throw error;
    return normalizeString(data?.name);
  } catch (error) {
    context.log?.warn?.('form-submissions failed to resolve organization sender name', {
      orgId,
      message: error?.message,
    });
    return '';
  }
}

async function fetchStudentIdsByInstructor(tenantClient, instructorEmployeeId) {
  if (!instructorEmployeeId) {
    return { studentIds: [], error: null };
  }

  const { data, error } = await tenantClient
    .from('lesson_templates')
    .select('student_id')
    .eq('instructor_employee_id', instructorEmployeeId)
    .eq('is_active', true);

  if (error) {
    return { studentIds: [], error };
  }

  const studentIds = Array.from(new Set((data || []).map((row) => row.student_id).filter(Boolean)));
  return { studentIds, error: null };
}

async function resolveAuditActorContext(controlClient, orgId, userId) {
  if (!UUID_PATTERN.test(String(userId || ''))) {
    return null;
  }

  let userEmail = 'unknown@reinex.local';
  let userRole = 'member';

  try {
    const authResult = await controlClient.auth.admin.getUserById(userId);
    if (!authResult.error && authResult.data?.user?.email) {
      userEmail = authResult.data.user.email;
    }
  } catch {
    // non-blocking
  }

  try {
    const { data: membership } = await controlClient
      .from('org_memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();
    if (membership?.role) {
      userRole = String(membership.role);
    }
  } catch {
    // non-blocking
  }

  return { userId, userEmail, userRole };
}

async function listStudentSubmissions(context, req, { controlClient, env, orgId, userId, role }) {
  const canManageRoster = isAdminOrOffice(role);
  const studentId = normalizeString(req?.query?.student_id || req?.query?.studentId);
  const limit = parseLimit(req?.query?.limit, 50, 200);

  if (!UUID_PATTERN.test(studentId)) {
    return respond(context, 400, { message: 'invalid_student_id' });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, controlClient, env, orgId);
  if (tenantError) return respond(context, tenantError.status, tenantError.body);

  if (!canManageRoster) {
    const { studentIds, error: lessonError } = await fetchStudentIdsByInstructor(tenantClient, userId);
    if (lessonError) {
      context.log?.error?.('form-submissions failed to resolve instructor student access', {
        message: lessonError?.message,
        userId,
      });
      return respond(context, 500, { message: 'failed_to_check_student_access' });
    }
    if (!studentIds.includes(studentId)) {
      return respond(context, 403, { message: 'forbidden' });
    }
  }

  const { data: submissions, error: submissionsError } = await tenantClient
    .from('form_submissions')
    .select('id, form_id, student_id, answers, alert_flags, otp_metadata, source, submitted_at, metadata')
    .eq('student_id', studentId)
    .order('submitted_at', { ascending: false })
    .limit(limit);

  if (submissionsError) {
    context.log?.error?.('form-submissions failed loading student submissions', {
      message: submissionsError?.message,
      studentId,
    });
    return respond(context, 500, { message: 'failed_to_load_form_submissions' });
  }

  const rows = Array.isArray(submissions) ? submissions : [];
  const formIds = Array.from(new Set(rows.map((row) => row.form_id).filter((id) => UUID_PATTERN.test(String(id || '')))));

  let formsById = new Map();
  if (formIds.length > 0) {
    const { data: forms, error: formsError } = await tenantClient
      .from('forms')
      .select('id, name')
      .in('id', formIds);

    if (formsError) {
      context.log?.warn?.('form-submissions failed loading form names for student submissions', {
        message: formsError?.message,
      });
    } else {
      formsById = new Map((forms || []).map((item) => [item.id, item]));
    }
  }

  const payload = rows.map((row) => ({
    ...row,
    form_name: formsById.get(row.form_id)?.name || null,
  }));

  return respond(context, 200, payload);
}

async function initiateSubmission(context, req, { controlClient, env, orgId, userId, userEmail, role }) {
  if (!isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const body = parseRequestBody(req);
  const formId = normalizeString(body?.form_id || body?.formId);
  const studentId = normalizeString(body?.student_id || body?.studentId);
  const deliveryMethod = normalizeDeliveryMethod(body?.delivery_method || body?.deliveryMethod);

  if (!UUID_PATTERN.test(formId)) return respond(context, 400, { message: 'invalid_form_id' });
  if (!UUID_PATTERN.test(studentId)) return respond(context, 400, { message: 'invalid_student_id' });
  if (!deliveryMethod) return respond(context, 400, { message: 'invalid_delivery_method' });

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, controlClient, env, orgId);
  if (tenantError) return respond(context, tenantError.status, tenantError.body);

  const [{ data: form, error: formError }, { data: student, error: studentError }] = await Promise.all([
    tenantClient
      .from('forms')
      .select('id, name, is_active')
      .eq('id', formId)
      .maybeSingle(),
    tenantClient
      .from('students')
      .select('id, first_name, last_name, identity_number, phone, email')
      .eq('id', studentId)
      .maybeSingle(),
  ]);

  if (formError) {
    context.log?.error?.('form-submissions failed to load form', { message: formError?.message, formId });
    return respond(context, 500, { message: 'failed_to_load_form' });
  }
  if (!form || !form.is_active) return respond(context, 404, { message: 'form_not_found' });

  if (studentError) {
    context.log?.error?.('form-submissions failed to load student', { message: studentError?.message, studentId });
    return respond(context, 500, { message: 'failed_to_load_student' });
  }
  if (!student) return respond(context, 404, { message: 'student_not_found' });

  const identityNumber = normalizeIdentityNumber(student.identity_number);
  if (!identityNumber) {
    return respond(context, 400, { message: 'student_identity_number_missing' });
  }

  let destination = '';
  try {
    if (deliveryMethod === 'whatsapp') {
      destination = normalizePhone(await resolveStudentDestination(tenantClient, studentId, 'phone'));
      if (!destination) return respond(context, 400, { message: 'student_phone_missing' });
    } else {
      destination = normalizeString(await resolveStudentDestination(tenantClient, studentId, 'email')).toLowerCase();
      if (!destination) return respond(context, 400, { message: 'student_email_missing' });
    }
  } catch (error) {
    context.log?.error?.('form-submissions failed resolving destination', { message: error?.message, studentId });
    return respond(context, 500, { message: 'failed_to_resolve_destination' });
  }

  const nowIso = getNowIso();
  const submissionMetadata = {
    workflow_status: 'pending',
    delivery_method: deliveryMethod,
    initiated_at: nowIso,
    initiated_by: userId,
  };

  const { data: submission, error: submissionError } = await tenantClient
    .from('form_submissions')
    .insert({
      form_id: formId,
      student_id: studentId,
      answers: {},
      alert_flags: {},
      otp_metadata: { delivery_method: deliveryMethod, otp_status: 'pending' },
      source: deliveryMethod,
      submitted_at: nowIso,
      metadata: submissionMetadata,
    })
    .select('id')
    .single();

  if (submissionError || !submission?.id) {
    context.log?.error?.('form-submissions failed to create submission', {
      message: submissionError?.message,
      formId,
      studentId,
    });
    return respond(context, 500, { message: 'failed_to_create_submission' });
  }

  const otpCode = generateOtp();
  const expiresAt = getFutureIso(OTP_TTL_MINUTES);

  const { error: otpError } = await tenantClient
    .from('otp_challenges')
    .insert({
      student_id: studentId,
      channel: deliveryMethod,
      destination,
      token_hash: hashOtp(otpCode),
      status: 'pending',
      expires_at: expiresAt,
      metadata: {
        submission_id: submission.id,
        form_id: formId,
        org_id: orgId,
      },
    });

  if (otpError) {
    context.log?.error?.('form-submissions failed to create otp challenge', {
      message: otpError?.message,
      submissionId: submission.id,
    });
    return respond(context, 500, { message: 'failed_to_create_otp' });
  }

  const { error: routingError } = await controlClient
    .from('active_routing')
    .insert({
      org_id: orgId,
      category: ROUTING_CATEGORY,
      routing_info: {
        student_identity_number: identityNumber,
        otp_code: otpCode,
        submission_id: submission.id,
      },
      expires_at: expiresAt,
      created_by: userId,
      metadata: {
        student_id: studentId,
        form_id: formId,
        delivery_method: deliveryMethod,
      },
    });

  if (routingError) {
    context.log?.error?.('form-submissions failed to create active routing row', {
      message: routingError?.message,
      orgId,
      submissionId: submission.id,
    });
    return respond(context, 500, { message: 'failed_to_create_active_routing' });
  }

  if (deliveryMethod === 'email') {
    try {
      const organizationSenderName = await resolveOrganizationSenderName(controlClient, orgId, context);
      const submitLink = `${resolveSubmitBaseUrl(req, env)}/#/submit`;
      const text = `שלום, מצורף קישור למילוי טופס: ${submitLink}. קוד האימות שלך הוא: ${otpCode}`;
      const html = `<p>שלום,</p><p>מצורף קישור למילוי טופס: <a href="${submitLink}">${submitLink}</a></p><p>קוד האימות שלך הוא: <strong>${otpCode}</strong></p>`;

      await sendBrevoEmail(
        {
          to: destination,
          subject: `קישור למילוי טופס - ${form.name || 'Reinex'}`,
          textContent: text,
          htmlContent: html,
          senderName: organizationSenderName || undefined,
        },
        env,
        context,
      );
    } catch (emailError) {
      context.log?.error?.('form-submissions failed sending email via smtp connector', {
        message: emailError?.message,
      });
      return respond(context, 502, { message: 'failed_to_send_email' });
    }
  }

  const responseBody = {
    submission_id: submission.id,
  };

  if (deliveryMethod === 'whatsapp') {
    responseBody.otp = otpCode;
    responseBody.phone = destination;
  }

  await logAuditEvent(controlClient, {
    orgId,
    userId,
    userEmail,
    userRole: role,
    actionType: AUDIT_ACTIONS.FORM_SUBMISSION_INITIATED,
    actionCategory: AUDIT_CATEGORIES.FORMS,
    resourceType: 'form_submission',
    resourceId: submission.id,
    details: {
      student_id: studentId,
      form_id: formId,
      delivery_method: deliveryMethod,
      source: deliveryMethod,
    },
  });

  return respond(context, 201, responseBody);
}

async function verifySubmissionAccess(context, req, { controlClient, env }) {
  const body = parseRequestBody(req);
  const identityNumber = normalizeIdentityNumber(body?.identity_number || body?.identityNumber);
  const otpCode = normalizeOtp(body?.otp);

  if (!identityNumber || otpCode.length !== OTP_DIGITS) {
    return respond(context, 401, { message: INVALID_VERIFY_MESSAGE });
  }

  const ipAddress = resolveClientIp(req);

  let rateLimitRow;
  try {
    rateLimitRow = await findRateLimitRow(controlClient, identityNumber);
  } catch (error) {
    context.log?.error?.('form-submissions verify failed reading rate limit', { message: error?.message });
    return respond(context, 500, { message: 'failed_to_verify_otp' });
  }

  const rateMeta = parseRateLimitMetadata(rateLimitRow?.metadata);
  if (isStillBlocked(rateMeta.blockedUntil)) {
    return respond(context, 429, { message: 'בוצעו יותר מדי נסיונות. נסו שוב בעוד שעה.' });
  }

  let routingRow;
  try {
    routingRow = await findActiveRoutingByIdentity(controlClient, identityNumber, otpCode);
  } catch (error) {
    context.log?.error?.('form-submissions verify failed querying active_routing', { message: error?.message });
    return respond(context, 500, { message: 'failed_to_verify_otp' });
  }

  if (!routingRow) {
    try {
      await registerVerifyFailure(controlClient, identityNumber, ipAddress);
    } catch (rateError) {
      context.log?.warn?.('form-submissions verify failed to register rate-limit failure', {
        message: rateError?.message,
      });
    }
    return respond(context, 401, { message: INVALID_VERIFY_MESSAGE });
  }

  const orgId = normalizeString(routingRow.org_id);
  const submissionId = normalizeString(routingRow?.routing_info?.submission_id);

  if (!UUID_PATTERN.test(orgId) || !UUID_PATTERN.test(submissionId)) {
    try {
      await registerVerifyFailure(controlClient, identityNumber, ipAddress);
    } catch {
      // noop
    }
    return respond(context, 401, { message: INVALID_VERIFY_MESSAGE });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, controlClient, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  const { data: submission, error: submissionError } = await tenantClient
    .from('form_submissions')
    .select('id, student_id, form_id, metadata')
    .eq('id', submissionId)
    .maybeSingle();

  if (submissionError || !submission) {
    try {
      await registerVerifyFailure(controlClient, identityNumber, ipAddress);
    } catch {
      // noop
    }
    return respond(context, 401, { message: INVALID_VERIFY_MESSAGE });
  }

  const { data: student, error: studentError } = await tenantClient
    .from('students')
    .select('id, identity_number')
    .eq('id', submission.student_id)
    .maybeSingle();

  if (studentError || !student || normalizeIdentityNumber(student.identity_number) !== identityNumber) {
    try {
      await registerVerifyFailure(controlClient, identityNumber, ipAddress);
    } catch {
      // noop
    }
    return respond(context, 401, { message: INVALID_VERIFY_MESSAGE });
  }

  let otpChallenge;
  try {
    otpChallenge = await findTenantOtpChallenge(tenantClient, {
      studentId: submission.student_id,
      submissionId,
      otp: otpCode,
    });
  } catch (error) {
    context.log?.error?.('form-submissions verify failed querying tenant otp', { message: error?.message });
    return respond(context, 500, { message: 'failed_to_verify_otp' });
  }

  if (!otpChallenge) {
    try {
      await registerVerifyFailure(controlClient, identityNumber, ipAddress);
    } catch {
      // noop
    }
    return respond(context, 401, { message: INVALID_VERIFY_MESSAGE });
  }

  if (otpChallenge.status === 'pending') {
    const nowIso = getNowIso();
    const { error: updateOtpError } = await tenantClient
      .from('otp_challenges')
      .update({
        status: 'verified',
        verified_at: nowIso,
        attempts: Number(otpChallenge.attempts || 0) + 1,
        metadata: {
          ...normalizeJsonObject(otpChallenge.metadata, {}),
          verified_at: nowIso,
          verify_ip: ipAddress || null,
        },
      })
      .eq('id', otpChallenge.id)
      .eq('status', 'pending');

    if (updateOtpError) {
      context.log?.error?.('form-submissions verify failed marking otp as verified', {
        message: updateOtpError?.message,
      });
      return respond(context, 500, { message: 'failed_to_verify_otp' });
    }
  }

  try {
    await clearVerifyFailures(controlClient, identityNumber);
  } catch {
    // non-blocking cleanup
  }

  const verifyMetadata = normalizeJsonObject(submission.metadata, {});
  const verifyNowIso = getNowIso();
  const { error: updateVerifyMetaError } = await tenantClient
    .from('form_submissions')
    .update({
      metadata: {
        ...verifyMetadata,
        verify_ip: ipAddress || null,
        verify_ip_at: verifyNowIso,
      },
    })
    .eq('id', submission.id);

  if (updateVerifyMetaError) {
    context.log?.error?.('form-submissions verify failed updating submission verify metadata', {
      message: updateVerifyMetaError?.message,
      submissionId: submission.id,
    });
    return respond(context, 500, { message: 'failed_to_verify_otp' });
  }

  const { data: form, error: formError } = await tenantClient
    .from('forms')
    .select('id, form_schema')
    .eq('id', submission.form_id)
    .maybeSingle();

  if (formError || !form) {
    return respond(context, 404, { message: 'form_not_found' });
  }

  return respond(context, 200, {
    submission_id: submission.id,
    org_id: orgId,
    form_schema: normalizeJsonObject(form.form_schema, { type: 'object', properties: {}, required: [] }),
  });
}

async function finalizeSubmission(context, req, { controlClient, env }) {
  const body = parseRequestBody(req);
  const submissionId = normalizeString(body?.submission_id || body?.submissionId);
  const otpCode = normalizeOtp(body?.otp);
  const answers = normalizeJsonObject(body?.answers, {});
  const formSchema = normalizeJsonObject(body?.form_schema || body?.formSchema, {});
  const ipAddress = resolveClientIp(req);

  if (!UUID_PATTERN.test(submissionId) || otpCode.length !== OTP_DIGITS) {
    return respond(context, 401, { message: INVALID_VERIFY_MESSAGE });
  }

  let routingRow;
  try {
    routingRow = await findActiveRoutingBySubmission(controlClient, submissionId, otpCode);
  } catch (error) {
    context.log?.error?.('form-submissions submit failed querying active_routing', { message: error?.message });
    return respond(context, 500, { message: 'failed_to_submit_form' });
  }

  if (!routingRow) {
    return respond(context, 401, { message: INVALID_VERIFY_MESSAGE });
  }

  const orgId = normalizeString(routingRow.org_id);
  if (!UUID_PATTERN.test(orgId)) {
    return respond(context, 401, { message: INVALID_VERIFY_MESSAGE });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, controlClient, env, orgId);
  if (tenantError) return respond(context, tenantError.status, tenantError.body);

  const { data: submission, error: submissionError } = await tenantClient
    .from('form_submissions')
    .select('id, student_id, metadata')
    .eq('id', submissionId)
    .maybeSingle();

  if (submissionError || !submission) {
    return respond(context, 404, { message: 'submission_not_found' });
  }

  let otpChallenge;
  try {
    otpChallenge = await findTenantOtpChallenge(tenantClient, {
      studentId: submission.student_id,
      submissionId,
      otp: otpCode,
    });
  } catch (error) {
    context.log?.error?.('form-submissions submit failed querying tenant otp', { message: error?.message });
    return respond(context, 500, { message: 'failed_to_submit_form' });
  }

  if (!otpChallenge) {
    return respond(context, 401, { message: INVALID_VERIFY_MESSAGE });
  }

  const nowIso = getNowIso();
  const currentMetadata = normalizeJsonObject(submission.metadata, {});

  const { error: updateSubmissionError } = await tenantClient
    .from('form_submissions')
    .update({
      answers,
      submitted_at: nowIso,
      metadata: {
        ...currentMetadata,
        workflow_status: 'submitted',
        submitted_at: nowIso,
        schema_snapshot: formSchema,
        submit_ip: ipAddress || null,
        submit_ip_at: nowIso,
      },
    })
    .eq('id', submissionId);

  if (updateSubmissionError) {
    context.log?.error?.('form-submissions submit failed updating submission', {
      message: updateSubmissionError?.message,
      submissionId,
    });
    return respond(context, 500, { message: 'failed_to_submit_form' });
  }

  const { error: updateOtpError } = await tenantClient
    .from('otp_challenges')
    .update({
      status: 'verified',
      verified_at: nowIso,
      attempts: Number(otpChallenge.attempts || 0) + 1,
      metadata: {
        ...normalizeJsonObject(otpChallenge.metadata, {}),
        consumed_at: nowIso,
        submit_ip: ipAddress || null,
      },
    })
    .eq('id', otpChallenge.id);

  if (updateOtpError) {
    context.log?.error?.('form-submissions submit failed updating otp status', {
      message: updateOtpError?.message,
      challengeId: otpChallenge.id,
    });
    return respond(context, 500, { message: 'failed_to_submit_form' });
  }

  const { error: cleanupError } = await controlClient
    .from('active_routing')
    .delete()
    .eq('id', routingRow.id);

  if (cleanupError) {
    context.log?.error?.('form-submissions submit failed cleaning active_routing', {
      message: cleanupError?.message,
      routingId: routingRow.id,
    });
    return respond(context, 500, { message: 'failed_to_cleanup_routing' });
  }

  const actorContext = await resolveAuditActorContext(controlClient, orgId, routingRow.created_by);
  if (actorContext) {
    await logAuditEvent(controlClient, {
      orgId,
      userId: actorContext.userId,
      userEmail: actorContext.userEmail,
      userRole: actorContext.userRole,
      actionType: AUDIT_ACTIONS.FORM_SUBMISSION_COMPLETED,
      actionCategory: AUDIT_CATEGORIES.FORMS,
      resourceType: 'form_submission',
      resourceId: submissionId,
      details: {
        student_id: submission.student_id,
        form_id: routingRow?.metadata?.form_id || null,
        delivery_method: routingRow?.metadata?.delivery_method || null,
      },
    });
  }

  return respond(context, 200, {
    message: 'submitted',
    submission_id: submissionId,
  });
}

export default async function formSubmissions(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  const action = normalizeString(context?.bindingData?.action).toLowerCase();

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('form-submissions missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const controlClient = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  if ((method === 'POST' && !action) || (method === 'GET' && !action)) {
    const authorization = resolveBearerAuthorization(req);
    if (!authorization?.token) return respond(context, 401, { message: 'missing_bearer' });

    let authResult;
    try {
      authResult = await controlClient.auth.getUser(authorization.token);
    } catch (error) {
      context.log?.error?.('form-submissions failed to validate token', { message: error?.message });
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
      context.log?.error?.('form-submissions failed to verify membership', {
        message: membershipError?.message,
        orgId,
        userId,
      });
      return respond(context, 500, { message: 'failed_to_verify_membership' });
    }

    if (!role) return respond(context, 403, { message: 'forbidden' });

    if (method === 'GET') {
      return listStudentSubmissions(context, req, {
        controlClient,
        env,
        orgId,
        userId,
        role,
      });
    }

    return initiateSubmission(context, req, {
      controlClient,
      env,
      orgId,
      userId,
      userEmail,
      role,
    });
  }

  if (method === 'POST' && action === 'verify') {
    return verifySubmissionAccess(context, req, {
      controlClient,
      env,
    });
  }

  if (method === 'PUT' && action === 'submit') {
    return finalizeSubmission(context, req, {
      controlClient,
      env,
    });
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
