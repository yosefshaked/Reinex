/* eslint-env node */
import { createHash, randomInt } from 'node:crypto';
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  UUID_PATTERN,
  ensureMembership,
  isAdminOrOffice,
  normalizeNullableId,
  normalizeString,
  parseRequestBody,
  readEnv,
  resolveOrgId,
  withOrgScope,
  respond,
} from '../_shared/org-bff.js';
import { sendAndLogBrevoEmail } from '../_shared/email-log.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import { logTenantAuditEvent, TENANT_AUDIT_RETENTION } from '../_shared/tenant-audit.js';
import {
  buildSharedBlockMap,
  collectSharedBlockIds,
  evaluateAlertFlags,
  findMissingSharedBlockIds,
  hydrateAnswersForReview,
  materializeSchemaForSnapshot,
  normalizeFormSchema,
  prepareAnswersForStorage,
  resolvePublicFormState,
  resolveSchemaWithSharedBlocks,
} from '../_shared/forms-runtime.js';
import { resolvePublicAppBaseUrl } from '../_shared/public-app-url.js';
const OTP_DIGITS = 6;
const OTP_TTL_MINUTES = 15;
const ROUTING_CATEGORY = 'form_submission';
const FAILED_VERIFY_WINDOW_MINUTES = 5;
const MAX_VERIFY_FAILURES = 5;
const INVALID_VERIFY_MESSAGE = 'מזהה או קוד אימות שגויים';
const OTP_INVALID_OR_EXPIRED_MESSAGE = 'קוד האימות שגוי או שפג תוקפו';
const VERIFY_LOCKDOWN_MESSAGE = 'מטעמי אבטחה, כל הקישורים הפעילים עבור תלמיד זה בוטלו עקב יותר מדי נסיונות כושלים. יש ליצור קשר עם המרפאה לקבלת קוד חדש.';
const WAITING_LIST_ROUTING_CATEGORY = 'waiting_list_intake';

function normalizeDeliveryMethod(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === 'whatsapp' || normalized === 'email' ? normalized : '';
}

function hasLegacyPublishedMarker(form) {
  const publishedAt = normalizeString(form?.published_at);
  const hasDraftSchema = Boolean(form?.form_schema && typeof form.form_schema === 'object' && !Array.isArray(form.form_schema));
  return Boolean(publishedAt) && hasDraftSchema;
}

function requiresPublishMigration(form) {
  if (!form || typeof form !== 'object') return false;
  const metadata = form?.metadata && typeof form.metadata === 'object' && !Array.isArray(form.metadata)
    ? form.metadata
    : {};
  const hasPublishedSchema = Boolean(metadata.published_form_schema && typeof metadata.published_form_schema === 'object');
  return !hasPublishedSchema && hasLegacyPublishedMarker(form);
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

function appendDeliveryMethod(value, deliveryMethod) {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? [value.trim()]
      : [];

  const normalizedItems = items
    .map((item) => normalizeDeliveryMethod(item))
    .filter(Boolean);

  const normalizedDeliveryMethod = normalizeDeliveryMethod(deliveryMethod);
  if (normalizedDeliveryMethod) {
    normalizedItems.push(normalizedDeliveryMethod);
  }

  return Array.from(new Set(normalizedItems));
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

function resolveSubmitBaseUrl(req, env) {
  return resolvePublicAppBaseUrl(req, env, { fallback: 'https://reinex.app' });
}

function buildSubmissionLink(req, env, { identityNumber = '', otpCode = '' } = {}) {
  const baseUrl = resolveSubmitBaseUrl(req, env);
  const params = new URLSearchParams();
  const normalizedIdentityNumber = normalizeIdentityNumber(identityNumber);
  const normalizedOtp = normalizeOtp(otpCode);

  if (normalizedIdentityNumber) params.set('identity_number', normalizedIdentityNumber);
  if (normalizedOtp) params.set('otp', normalizedOtp);

  const query = params.toString();
  return `${baseUrl}/#/submit${query ? `?${query}` : ''}`;
}

function resolveClientIp(req) {
  const headers = req?.headers || {};
  const xf = headers['x-forwarded-for'] || headers['X-Forwarded-For'] || '';
  if (typeof xf === 'string' && xf.trim()) {
    return xf.split(',')[0].trim();
  }
  return '';
}

async function resolveSubmissionSubject(client, orgId, { clientProfileId, studentId }) {
  let profile = null;
  let student = null;

  if (UUID_PATTERN.test(String(studentId || ''))) {
    const { data, error } = await withOrgScope(client, 'students', orgId)
      .select('id, client_profile_id')
      .eq('id', studentId)
      .maybeSingle();
    if (error) {
      return { clientProfileId: null, studentId: null, profile: null, student: null, identityNumber: '', error };
    }
    student = data || null;
    if (!clientProfileId && student?.client_profile_id) {
      clientProfileId = student.client_profile_id;
    }
  }

  if (UUID_PATTERN.test(String(clientProfileId || ''))) {
    const { data, error } = await withOrgScope(client, 'client_profiles', orgId)
      .select('*')
      .eq('id', clientProfileId)
      .maybeSingle();
    if (error) {
      return { clientProfileId: null, studentId: null, profile: null, student: null, identityNumber: '', error };
    }
    profile = data || null;
  }

  if (!student && profile?.id) {
    const { data, error } = await withOrgScope(client, 'students', orgId)
      .select('id, client_profile_id')
      .eq('client_profile_id', profile.id)
      .maybeSingle();
    if (error) {
      return { clientProfileId: profile?.id || null, studentId: null, profile, student: null, identityNumber: '', error };
    }
    student = data || null;
  }

  return {
    clientProfileId: profile?.id || student?.client_profile_id || null,
    studentId: student?.id || null,
    profile,
    student,
    identityNumber: normalizeIdentityNumber(profile?.identity_number),
    error: null,
  };
}

async function resolvePublicFormStateWithSharedBlocks(client, orgId, formRecord, options = {}) {
  const initialState = resolvePublicFormState(formRecord, { ...options, sharedBlocksById: {} });
  const blockIds = collectSharedBlockIds(initialState.raw_form_schema || initialState.form_schema);
  if (!blockIds.length) {
    return initialState;
  }

  const { data, error } = await withOrgScope(client, 'shared_form_blocks', orgId)
    .select('id, block_type, name, content_schema, is_active, metadata')
    .eq('is_active', true)
    .in('id', blockIds);

  if (error) {
    throw error;
  }

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

function isPublishedFormRecord(form) {
  const metadata = form?.metadata && typeof form.metadata === 'object' && !Array.isArray(form.metadata)
    ? form.metadata
    : {};
  const hasPublishedSchema = Boolean(metadata.published_form_schema && typeof metadata.published_form_schema === 'object');
  return hasPublishedSchema;
}

function resolveFormVersionMetadata(formRecord, { suffix = '' } = {}) {
  const metadata = normalizeJsonObject(formRecord?.metadata, {});
  const formVersion = Number(formRecord?.version);
  const publishedVersion = Number(metadata.published_version);
  const keySuffix = suffix ? `_${suffix}` : '';

  return {
    [`form_name_snapshot${keySuffix}`]: normalizeString(formRecord?.name),
    [`form_version${keySuffix}`]: Number.isFinite(formVersion) ? formVersion : null,
    [`published_version${keySuffix}`]: Number.isFinite(publishedVersion) ? publishedVersion : null,
    [`published_at_snapshot${keySuffix}`]: normalizeString(metadata.published_at || formRecord?.published_at) || null,
  };
}

async function resolveSubmissionDestination(client, orgId, clientProfileId, deliveryMethod) {
  if (!UUID_PATTERN.test(String(clientProfileId || ''))) {
    return '';
  }

  const { data: clientProfile, error: profileError } = await withOrgScope(client, 'client_profiles', orgId)
    .select('id, phone, email')
    .eq('id', clientProfileId)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!clientProfile) return '';

  const { data: guardianLink, error: guardianLinkError } = await withOrgScope(client, 'client_guardians', orgId)
    .select('guardian_id, is_primary')
    .eq('client_profile_id', clientProfileId)
    .order('is_primary', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (guardianLinkError) throw guardianLinkError;

  let guardian = null;
  if (guardianLink?.guardian_id) {
    const { data: guardianRow, error: guardianError } = await withOrgScope(client, 'guardians', orgId)
      .select('id, phone, email')
      .eq('id', guardianLink.guardian_id)
      .maybeSingle();
    if (guardianError) throw guardianError;
    guardian = guardianRow || null;
  }

  if (deliveryMethod === 'whatsapp') {
    return normalizePhone(clientProfile.phone) || normalizePhone(guardian?.phone);
  }

  return normalizeString(clientProfile.email || guardian?.email).toLowerCase();
}

function withOtpSubjectFilter(query, { clientProfileId, studentId }) {
  if (UUID_PATTERN.test(String(clientProfileId || ''))) {
    return query.eq('client_profile_id', clientProfileId);
  }
  if (UUID_PATTERN.test(String(studentId || ''))) {
    return query.eq('student_id', studentId);
  }
  return query.eq('id', '__no_match__');
}

async function findTenantOtpChallenge(client, orgId, { clientProfileId, studentId, submissionId, otp }) {
  const tokenHash = hashOtp(otp);
  const nowIso = getNowIso();

  const { data, error } = await withOtpSubjectFilter(
    withOrgScope(client, 'otp_challenges', orgId)
    .select('id, status, expires_at, metadata')
    .eq('token_hash', tokenHash)
    .in('status', ['pending', 'verified'])
    .gt('expires_at', nowIso)
    .order('expires_at', { ascending: false })
    .limit(10),
    { clientProfileId, studentId },
  );

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.find((row) => String(row?.metadata?.submission_id || '') === submissionId) || null;
}

async function findTenantPendingOtpChallenge(client, orgId, { clientProfileId, studentId, submissionId, otp }) {
  const tokenHash = hashOtp(otp);
  const nowIso = getNowIso();

  const { data, error } = await withOtpSubjectFilter(
    withOrgScope(client, 'otp_challenges', orgId)
    .select('id, status, expires_at, metadata')
    .eq('token_hash', tokenHash)
    .eq('status', 'pending')
    .gt('expires_at', nowIso)
    .order('expires_at', { ascending: false })
    .limit(10),
    { clientProfileId, studentId },
  );

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.find((row) => String(row?.metadata?.submission_id || '') === submissionId) || null;
}

async function findActiveRoutingRowsBySubmission(controlClient, submissionId) {
  const nowIso = getNowIso();
  const { data, error } = await controlClient
    .from('active_routing')
    .select('id, org_id, routing_info, expires_at, created_by, metadata')
    .eq('category', ROUTING_CATEGORY)
    .contains('routing_info', { submission_id: submissionId })
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function findReusableSubmissionAccess(client, controlClient, { orgId, clientProfileId, studentId, submissionId }) {
  const routingRows = await findActiveRoutingRowsBySubmission(controlClient, submissionId);

  for (const routingRow of routingRows) {
    if (normalizeString(routingRow?.org_id) !== orgId) {
      continue;
    }

    const otpCode = normalizeOtp(routingRow?.routing_info?.otp_code);
    if (otpCode.length !== OTP_DIGITS) {
      continue;
    }

    const otpChallenge = await findTenantPendingOtpChallenge(client, orgId, {
      clientProfileId,
      studentId,
      submissionId,
      otp: otpCode,
    });

    if (!otpChallenge) {
      continue;
    }

    return {
      otpCode,
      expiresAt: normalizeString(otpChallenge.expires_at || routingRow.expires_at),
      routingRow,
      otpChallenge,
    };
  }

  return null;
}

async function expirePendingOtps(client, orgId, controlClient, logger) {
  const nowIso = getNowIso();
  const { data: expiredRows, error: expireError } = await withOrgScope(client, 'otp_challenges', orgId)
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('expires_at', nowIso)
    .select('metadata');

  if (expireError) {
    throw expireError;
  }

  const submissionIds = Array.from(
    new Set(
      (Array.isArray(expiredRows) ? expiredRows : [])
        .map((row) => normalizeString(row?.metadata?.submission_id))
        .filter((id) => UUID_PATTERN.test(id)),
    ),
  );

  if (submissionIds.length) {
    const { data: submissions, error: submissionsError } = await withOrgScope(client, 'form_submissions', orgId)
      .select('id, otp_metadata, metadata')
      .in('id', submissionIds);

    if (submissionsError) {
      throw submissionsError;
    }

    await Promise.all((submissions || []).map(async (submission) => {
      const currentOtpMetadata = normalizeJsonObject(submission?.otp_metadata, {});
      if (String(currentOtpMetadata.otp_status || '').toLowerCase() === 'expired') {
        return;
      }

      const { error: updateError } = await withOrgScope(client, 'form_submissions', orgId)
        .update({
          otp_metadata: {
            ...currentOtpMetadata,
            otp_status: 'expired',
            expired_at: nowIso,
          },
          metadata: {
            ...normalizeJsonObject(submission?.metadata, {}),
            otp_expired_at: nowIso,
          },
        })
        .eq('id', submission.id);

      if (updateError) {
        throw updateError;
      }
    }));
  }

  if (!controlClient) {
    return;
  }

  try {
    const { error: controlCleanupError } = await controlClient
      .from('active_routing')
      .delete()
      .eq('category', ROUTING_CATEGORY)
      .lt('expires_at', nowIso);

    if (controlCleanupError) {
      throw controlCleanupError;
    }
  } catch (controlCleanupError) {
    const message = controlCleanupError?.message || String(controlCleanupError || 'unknown_control_cleanup_error');
    if (logger?.warn) {
      logger.warn('form-submissions non-blocking control routing cleanup failed', { message });
    } else {
      console.warn('form-submissions non-blocking control routing cleanup failed', message);
    }
  }
}

async function findActiveRoutingByIdentity(controlClient, identityNumber, otp) {
  const nowIso = getNowIso();
  const { data, error } = await controlClient
    .from('active_routing')
    .select('id, org_id, routing_info, expires_at, metadata')
    .eq('category', ROUTING_CATEGORY)
    .contains('routing_info', {
      access_identity_number: identityNumber,
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



function parseFailedAttemptMetadata(value) {
  const metadata = normalizeJsonObject(value, {});
  const failedAttempts = Array.isArray(metadata.failed_attempts)
    ? metadata.failed_attempts
      .map((item) => normalizeString(item))
      .filter(Boolean)
    : [];
  return { metadata, failedAttempts };
}

function filterRecentFailedAttempts(attempts, nowMs = Date.now()) {
  const windowStart = nowMs - (FAILED_VERIFY_WINDOW_MINUTES * 60 * 1000);
  return attempts
    .map((item) => normalizeString(item))
    .filter(Boolean)
    .filter((item) => {
      const parsed = new Date(item).getTime();
      return !Number.isNaN(parsed) && parsed >= windowStart && parsed <= nowMs;
    })
    .sort();
}

async function findActiveRoutingRowsByIdentity(controlClient, identityNumber) {
  const nowIso = getNowIso();
  const { data, error } = await controlClient
    .from('active_routing')
    .select('id, org_id, routing_info, expires_at, metadata')
    .eq('category', ROUTING_CATEGORY)
    .contains('routing_info', { access_identity_number: identityNumber })
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function appendFailedAttemptToActiveRoutes(controlClient, identityNumber, ipAddress) {
  const nowIso = getNowIso();
  const nowMs = Date.now();
  const routingRows = await findActiveRoutingRowsByIdentity(controlClient, identityNumber);

  if (!routingRows.length) {
    return { routingRows: [], failedAttempts: [], shouldLockDown: false };
  }

  const combinedFailedAttempts = Array.from(
    new Set(
      routingRows.flatMap((row) => parseFailedAttemptMetadata(row?.metadata).failedAttempts),
    ),
  );
  const failedAttempts = filterRecentFailedAttempts([...combinedFailedAttempts, nowIso], nowMs);

  await Promise.all(routingRows.map(async (row) => {
    const currentMetadata = normalizeJsonObject(row?.metadata, {});
    const { error } = await controlClient
      .from('active_routing')
      .update({
        metadata: {
          ...currentMetadata,
          failed_attempts: failedAttempts,
          last_failed_at: nowIso,
          last_failed_ip: ipAddress || null,
        },
      })
      .eq('id', row.id);

    if (error) throw error;
  }));

  return {
    routingRows,
    failedAttempts,
    shouldLockDown: failedAttempts.length >= MAX_VERIFY_FAILURES,
  };
}

async function deleteActiveRoutingRowsByIdentity(controlClient, identityNumber) {
  const { error } = await controlClient
    .from('active_routing')
    .delete()
    .eq('category', ROUTING_CATEGORY)
    .contains('routing_info', { access_identity_number: identityNumber });

  if (error) throw error;
}

async function cancelPendingOtpsForLockdown(context, controlClient, routingRows) {
  const targetsByOrg = new Map();

  for (const row of routingRows || []) {
    const orgId = normalizeString(row?.org_id);
    const clientProfileId = normalizeString(row?.metadata?.client_profile_id);
    if (!UUID_PATTERN.test(orgId) || !UUID_PATTERN.test(clientProfileId)) {
      continue;
    }

    const orgTargets = targetsByOrg.get(orgId) || new Set();
    orgTargets.add(clientProfileId);
    targetsByOrg.set(orgId, orgTargets);
  }

  for (const [orgId, clientProfileIds] of targetsByOrg.entries()) {
    const { error } = await withOrgScope(controlClient, 'otp_challenges', orgId)
      .update({ status: 'cancelled' })
      .in('client_profile_id', Array.from(clientProfileIds))
      .eq('status', 'pending');

    if (error) {
      context.log?.warn?.('form-submissions lockdown failed cancelling tenant otp challenges', {
        orgId,
        message: error?.message,
      });
    }
  }
}

async function processFailedVerifyAttempt(context, { controlClient, identityNumber, ipAddress }) {
  const result = await appendFailedAttemptToActiveRoutes(controlClient, identityNumber, ipAddress);

  if (!result.shouldLockDown) {
    return { shouldLockDown: false };
  }

  await deleteActiveRoutingRowsByIdentity(controlClient, identityNumber);
  await cancelPendingOtpsForLockdown(context, controlClient, result.routingRows);

  return { shouldLockDown: true };
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

function formatExpirationForDelivery(expiresAt) {
  if (!expiresAt) return '';
  try {
    return new Intl.DateTimeFormat('he-IL', {
      timeZone: 'Asia/Jerusalem',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(expiresAt));
  } catch {
    return String(expiresAt);
  }
}

function buildSubmissionAccessText(submitLink, otpCode, identityNumber, formName, expiresAt) {
  const expiresText = formatExpirationForDelivery(expiresAt);
  return [
    'שלום,',
    `שם הטופס למילוי: ${formName || 'טופס'}`,
    '',
    'מצורף קישור למילוי טופס:',
    submitLink,
    '',
    `מזהה גישה: ${identityNumber}`,
    `קוד אימות: ${otpCode}`,
    ...(expiresText ? [`תוקף הקישור עד: ${expiresText}`] : []),
  ].join('\n');
}

function buildSubmissionAccessHtml(submitLink, otpCode, identityNumber, formName, expiresAt) {
  const expiresText = formatExpirationForDelivery(expiresAt);
  return `<p>שלום,</p><p>שם הטופס למילוי: <strong>${formName || 'טופס'}</strong></p><p>מצורף קישור למילוי טופס: <a href="${submitLink}">${submitLink}</a></p><p>מזהה גישה: <strong>${identityNumber}</strong></p><p>קוד אימות: <strong>${otpCode}</strong></p>${expiresText ? `<p>תוקף הקישור עד: <strong>${expiresText}</strong></p>` : ''}`;
}

function buildWaitingListInviteText(inviteUrl, formName, expiresAt) {
  const expiresText = formatExpirationForDelivery(expiresAt);
  return [
    'שלום,',
    '',
    'שמחים שיצרתם איתנו קשר.',
    '',
    `כדי שנוכל לקדם את ההצטרפות, נשמח שתמלאו את ${formName || 'טופס רשימת המתנה'} בקישור הבא:`,
    inviteUrl,
    '',
    ...(expiresText ? [`הקישור זמין עד ${expiresText}.`] : []),
    '',
    'אם יש שאלות, אפשר להשיב להודעה הזו ונשמח לעזור.',
  ].join('\n');
}

function buildWaitingListInviteHtml(inviteUrl, formName, expiresAt) {
  const expiresText = formatExpirationForDelivery(expiresAt);
  return [
    '<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.7;color:#0f172a">',
    '<p>שלום,</p>',
    '<p>שמחים שיצרתם איתנו קשר.</p>',
    `<p>כדי שנוכל לקדם את ההצטרפות, נשמח שתמלאו את <strong>${formName || 'טופס רשימת המתנה'}</strong> בקישור הבא:</p>`,
    `<p><a href="${inviteUrl}" style="color:#2563eb">${inviteUrl}</a></p>`,
    expiresText ? `<p>הקישור זמין עד <strong>${expiresText}</strong>.</p>` : '',
    '<p>אם יש שאלות, אפשר להשיב להודעה הזו ונשמח לעזור.</p>',
    '</div>',
  ].filter(Boolean).join('');
}

async function sendSubmissionDelivery(context, {
  controlClient,
  env,
  orgId,
  req,
  deliveryMethod,
  destination,
  otpCode,
  identityNumber,
  formName,
  expiresAt,
}) {
  if (deliveryMethod !== 'email') {
    return;
  }

  const organizationSenderName = await resolveOrganizationSenderName(controlClient, orgId, context);
  const submitLink = buildSubmissionLink(req, env, { identityNumber, otpCode });
  const text = buildSubmissionAccessText(submitLink, otpCode, identityNumber, formName, expiresAt);
  const html = buildSubmissionAccessHtml(submitLink, otpCode, identityNumber, formName, expiresAt);

  await sendAndLogBrevoEmail(
    controlClient,
    {
      to: destination,
      subject: `קישור למילוי טופס - ${formName || 'Reinex'}`,
      textContent: text,
      htmlContent: html,
      senderName: organizationSenderName || undefined,
    },
    env,
    context,
    { emailType: 'form_submission', orgId },
  );
}

function buildWaitingListInviteLink(req, env, inviteToken) {
  const baseUrl = resolveSubmitBaseUrl(req, env);
  const params = new URLSearchParams();
  params.set('invite', inviteToken);
  return `${baseUrl}/#/submit?${params.toString()}`;
}

async function findActiveWaitingListInviteRoutingBySubmission(controlClient, submissionId) {
  if (!UUID_PATTERN.test(String(submissionId || ''))) return null;
  const nowIso = getNowIso();
  const { data, error } = await controlClient
    .from('active_routing')
    .select('id, org_id, routing_info, expires_at, metadata')
    .eq('category', WAITING_LIST_ROUTING_CATEGORY)
    .contains('routing_info', { submission_id: submissionId })
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function replaceWaitingListInviteRouting(controlClient, {
  orgId,
  userId,
  submissionId,
  clientProfileId,
  studentId,
  metadata,
  expiresAt,
}) {
  const { error: deleteError } = await controlClient
    .from('active_routing')
    .delete()
    .eq('category', WAITING_LIST_ROUTING_CATEGORY)
    .contains('routing_info', { submission_id: submissionId });

  if (deleteError) {
    throw new Error(`failed_to_replace_waiting_list_routing:${deleteError.message}`);
  }

  const { data, error } = await controlClient
    .from('active_routing')
    .insert({
      org_id: orgId,
      category: WAITING_LIST_ROUTING_CATEGORY,
      expires_at: expiresAt,
      created_by: userId,
      routing_info: {
        submission_id: submissionId,
        client_profile_id: clientProfileId,
      },
      metadata: {
        ...(metadata || {}),
        client_profile_id: clientProfileId,
        student_id: studentId || null,
      },
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`failed_to_create_waiting_list_routing:${error?.message || 'missing_routing_id'}`);
  }

  return data.id;
}

async function resendWaitingListIntakeSubmission(context, req, {
  controlClient,
  env,
  orgId,
  userId,
  userEmail,
  role,
  submission,
  form,
  subject,
  deliveryMethod,
  destination,
  ttlMinutes,
}) {
  const currentMetadata = normalizeJsonObject(submission.metadata, {});
  const existingOtpMetadata = normalizeJsonObject(submission.otp_metadata, {});
  const nowIso = getNowIso();
  const priorResendCount = Number(existingOtpMetadata.resend_count || currentMetadata.resend_count || 0);
  const nextResendCount = priorResendCount + 1;
  let routingId = '';
  let expiresAt = '';
  let reusedExistingInvite = false;

  try {
    const existingRouting = await findActiveWaitingListInviteRoutingBySubmission(controlClient, submission.id);
    if (existingRouting?.id) {
      routingId = existingRouting.id;
      expiresAt = normalizeString(existingRouting.expires_at);
      reusedExistingInvite = true;
    }
  } catch (routingLookupError) {
    context.log?.error?.('form-submissions failed checking reusable waiting-list invite during resend', {
      message: routingLookupError?.message,
      submissionId: submission.id,
    });
    return respond(context, 500, { message: 'failed_to_prepare_resend' });
  }

  if (!reusedExistingInvite) {
    expiresAt = getFutureIso(ttlMinutes);
    try {
      routingId = await replaceWaitingListInviteRouting(controlClient, {
        orgId,
        userId,
        submissionId: submission.id,
        clientProfileId: subject.clientProfileId,
        studentId: submission.student_id,
        metadata: {
          form_id: submission.form_id,
          student_first_name: normalizeString(currentMetadata.student_first_name || subject.profile?.first_name),
          student_last_name: normalizeString(currentMetadata.student_last_name || subject.profile?.last_name),
          primary_service_id: normalizeString(currentMetadata.primary_service_id),
          allow_additional_services: Boolean(currentMetadata.allow_additional_services),
        },
        expiresAt,
      });
    } catch (routingError) {
      const message = String(routingError?.message || '');
      context.log?.error?.('form-submissions failed creating waiting-list routing during resend', {
        message,
        submissionId: submission.id,
      });
      return respond(context, 500, { message: 'failed_to_create_active_routing' });
    }
  }

  const inviteUrl = buildWaitingListInviteLink(req, env, routingId);
  const sentVia = appendDeliveryMethod(
    existingOtpMetadata.sent_via || currentMetadata.sent_via,
    deliveryMethod,
  );

  const { error: updateSubmissionError } = await withOrgScope(controlClient, 'form_submissions', orgId)
    .update({
      source: deliveryMethod,
      otp_metadata: {
        ...existingOtpMetadata,
        access_mode: 'invite_token',
        delivery_method: deliveryMethod,
        invite_status: 'pending',
        sent_via: sentVia,
        expires_at: expiresAt,
        resent_at: nowIso,
        resend_count: nextResendCount,
      },
      metadata: {
        ...currentMetadata,
        workflow_kind: 'waiting_list_intake',
        workflow_status: 'pending',
        delivery_method: deliveryMethod,
        sent_via: sentVia,
        otp_expires_at: expiresAt,
        resent_at: nowIso,
        resent_by: userId,
        resend_count: nextResendCount,
      },
    })
    .eq('id', submission.id);

  if (updateSubmissionError) {
    context.log?.error?.('form-submissions failed updating waiting-list submission during resend', {
      message: updateSubmissionError?.message,
      submissionId: submission.id,
    });
    return respond(context, 500, { message: 'failed_to_update_submission' });
  }

  if (deliveryMethod === 'email') {
    const organizationSenderName = await resolveOrganizationSenderName(controlClient, orgId, context);
    try {
      await sendAndLogBrevoEmail(
        controlClient,
        {
          to: destination,
          subject: `${form.name || 'טופס רשימת המתנה'} - קישור למילוי`,
          textContent: buildWaitingListInviteText(inviteUrl, form.name, expiresAt),
          htmlContent: buildWaitingListInviteHtml(inviteUrl, form.name, expiresAt),
          senderName: organizationSenderName || undefined,
        },
        env,
        context,
        { emailType: 'waiting_list', orgId },
      );
    } catch (emailError) {
      context.log?.error?.('form-submissions failed sending waiting-list resend email', {
        message: emailError?.message,
        submissionId: submission.id,
      });
      return respond(context, 502, { message: 'failed_to_send_email' });
    }
  }

  await logAuditEvent(controlClient, {
    orgId,
    userId,
    userEmail,
    userRole: role,
    actionType: AUDIT_ACTIONS.FORM_SUBMISSION_RESENT,
    actionCategory: AUDIT_CATEGORIES.FORMS,
    resourceType: 'form_submission',
    resourceId: submission.id,
    details: {
      client_profile_id: subject.clientProfileId,
      student_id: submission.student_id,
      form_id: submission.form_id,
      delivery_method: deliveryMethod,
      source: deliveryMethod,
      workflow_kind: 'waiting_list_intake',
      reused_existing_invite: reusedExistingInvite,
    },
  });

  return respond(context, 200, {
    mode: 'waiting_list_intake',
    access_mode: 'invite_token',
    submission_id: submission.id,
    invite_token: routingId,
    invite_url: inviteUrl,
    expires_at: expiresAt,
    expires_at_display: formatExpirationForDelivery(expiresAt),
    client_profile_id: subject.clientProfileId,
    student_id: submission.student_id || null,
    student_first_name: normalizeString(currentMetadata.student_first_name || subject.profile?.first_name),
    student_last_name: normalizeString(currentMetadata.student_last_name || subject.profile?.last_name),
    desired_service_id: normalizeString(currentMetadata.primary_service_id),
    desired_service_name: normalizeString(currentMetadata.primary_service_name),
    form_name: form.name || '',
    reused_existing_invite: reusedExistingInvite,
    delivery_method: deliveryMethod,
    phone: deliveryMethod === 'whatsapp' ? destination : '',
    email: deliveryMethod === 'email' ? destination : '',
  });
}

async function createSubmissionAccessArtifacts({
  client,
  controlClient,
  orgId,
  userId,
  submissionId,
  clientProfileId,
  studentId,
  formId,
  identityNumber,
  deliveryMethod,
  destination,
  ttlMinutes = OTP_TTL_MINUTES,
}) {
  const otpCode = generateOtp();
  const expiresAt = getFutureIso(ttlMinutes);

  const { error: otpError } = await withOrgScope(client, 'otp_challenges', orgId)
    .insert({
      client_profile_id: clientProfileId,
      student_id: studentId,
      channel: deliveryMethod,
      destination,
      token_hash: hashOtp(otpCode),
      status: 'pending',
      expires_at: expiresAt,
      metadata: {
        submission_id: submissionId,
        form_id: formId,
        org_id: orgId,
      },
    });

  if (otpError) {
    throw new Error(`failed_to_create_otp:${otpError.message}`);
  }

  const { error: routingError } = await controlClient
    .from('active_routing')
    .insert({
      org_id: orgId,
      category: ROUTING_CATEGORY,
      routing_info: {
        access_identity_number: identityNumber,
        client_profile_id: clientProfileId,
        otp_code: otpCode,
        submission_id: submissionId,
      },
      expires_at: expiresAt,
      created_by: userId,
      metadata: {
        client_profile_id: clientProfileId,
        student_id: studentId,
        form_id: formId,
        delivery_method: deliveryMethod,
        sent_via: [deliveryMethod],
      },
    });

  if (routingError) {
    throw new Error(`failed_to_create_active_routing:${routingError.message}`);
  }

  return { otpCode, expiresAt };
}

async function fetchStudentIdsByInstructor(client, orgId, instructorEmployeeId) {
  if (!instructorEmployeeId) {
    return { studentIds: [], error: null };
  }

  const { data, error } = await withOrgScope(client, 'lesson_templates', orgId)
    .select('student_id')
    .eq('instructor_employee_id', instructorEmployeeId)
    .eq('is_active', true);

  if (error) {
    return { studentIds: [], error };
  }

  const studentIds = Array.from(new Set((data || []).map((row) => row.student_id).filter(Boolean)));
  return { studentIds, error: null };
}

async function listStudentSubmissions(context, req, { controlClient, env, orgId, userId, role }) {
  const canManageRoster = isAdminOrOffice(role);
  const requestedStudentId = normalizeString(req?.query?.student_id || req?.query?.studentId);
  const requestedClientProfileId = normalizeString(req?.query?.client_profile_id || req?.query?.clientProfileId);
  const limit = parseLimit(req?.query?.limit, 50, 200);

  if (!UUID_PATTERN.test(requestedStudentId) && !UUID_PATTERN.test(requestedClientProfileId)) {
    return respond(context, 400, { message: 'invalid_client_profile_or_student_id' });
  }

  try {
    await expirePendingOtps(controlClient, orgId, controlClient, context.log);
  } catch (cleanupError) {
    context.log?.error?.('form-submissions failed cleanup before listing submissions', {
      message: cleanupError?.message,
      orgId,
    });
    return respond(context, 500, { message: 'failed_to_load_form_submissions' });
  }

  let studentId = UUID_PATTERN.test(requestedStudentId) ? requestedStudentId : '';
  let clientProfileId = UUID_PATTERN.test(requestedClientProfileId) ? requestedClientProfileId : '';

  if (studentId && !clientProfileId) {
    const { data: student, error: studentError } = await withOrgScope(controlClient, 'students', orgId)
      .select('id, client_profile_id')
      .eq('id', studentId)
      .maybeSingle();
    if (studentError) {
      context.log?.error?.('form-submissions failed resolving student client profile', {
        message: studentError?.message,
        studentId,
      });
      return respond(context, 500, { message: 'failed_to_load_form_submissions' });
    }
    clientProfileId = student?.client_profile_id || '';
  }

  if (!canManageRoster) {
    const { studentIds, error: lessonError } = await fetchStudentIdsByInstructor(controlClient, orgId, userId);
    if (lessonError) {
      context.log?.error?.('form-submissions failed to resolve instructor student access', {
        message: lessonError?.message,
        userId,
      });
      return respond(context, 500, { message: 'failed_to_check_student_access' });
    }
    if (!studentId || !studentIds.includes(studentId)) {
      return respond(context, 403, { message: 'forbidden' });
    }
  }

  let submissionsQuery = withOrgScope(controlClient, 'form_submissions', orgId)
    .select('id, form_id, client_profile_id, student_id, answers, alert_flags, otp_metadata, source, submitted_at, metadata')
    .order('submitted_at', { ascending: false })
    .limit(limit);

  if (clientProfileId) {
    submissionsQuery = submissionsQuery.eq('client_profile_id', clientProfileId);
  } else {
    submissionsQuery = submissionsQuery.eq('student_id', studentId);
  }

  const { data: submissions, error: submissionsError } = await submissionsQuery;

  if (submissionsError) {
    context.log?.error?.('form-submissions failed loading student submissions', {
      message: submissionsError?.message,
      studentId,
      clientProfileId,
    });
    return respond(context, 500, { message: 'failed_to_load_form_submissions' });
  }

  const rows = Array.isArray(submissions) ? submissions : [];
  const formIds = Array.from(new Set(rows.map((row) => row.form_id).filter((id) => UUID_PATTERN.test(String(id || '')))));

  let formsById = new Map();
  if (formIds.length > 0) {
    const { data: forms, error: formsError } = await withOrgScope(controlClient, 'forms', orgId)
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

  const payload = rows.map((row) => {
    const schemaSnapshot = normalizeFormSchema(normalizeJsonObject(row?.metadata?.schema_snapshot, {}));
    const baseAnswers = normalizeJsonObject(row.answers, {});
    const hydratedAnswers = baseAnswers?.custom_answers && typeof baseAnswers.custom_answers === 'object' && !Array.isArray(baseAnswers.custom_answers)
      ? {
          ...baseAnswers,
          custom_answers: hydrateAnswersForReview({
            formSchema: schemaSnapshot,
            answers: baseAnswers.custom_answers,
            env,
          }),
        }
      : hydrateAnswersForReview({
          formSchema: schemaSnapshot,
          answers: baseAnswers,
          env,
        });

    return {
      ...row,
      answers: hydratedAnswers,
      form_name: formsById.get(row.form_id)?.name || null,
    };
  });

  return respond(context, 200, payload);
}

async function initiateSubmission(context, req, { controlClient, env, orgId, userId, userEmail, role }) {
  if (!isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const body = parseRequestBody(req);
  const formId = normalizeString(body?.form_id || body?.formId);
  const requestedStudentId = normalizeNullableId(body?.student_id || body?.studentId);
  const requestedClientProfileId = normalizeNullableId(body?.client_profile_id || body?.clientProfileId);
  const deliveryMethod = normalizeDeliveryMethod(body?.delivery_method || body?.deliveryMethod);

  const rawTtl = Number(body?.expires_in_minutes ?? body?.expiresInMinutes);
  const ttlMinutes = (Number.isFinite(rawTtl) && rawTtl > 0) ? Math.min(rawTtl, 20160) : 10080;

  if (!UUID_PATTERN.test(formId)) return respond(context, 400, { message: 'invalid_form_id' });
  if (!UUID_PATTERN.test(requestedStudentId) && !UUID_PATTERN.test(requestedClientProfileId)) {
    return respond(context, 400, { message: 'invalid_client_profile_or_student_id' });
  }
  if (!deliveryMethod) return respond(context, 400, { message: 'invalid_delivery_method' });

  const [{ data: form, error: formError }, subject] = await Promise.all([
    withOrgScope(controlClient, 'forms', orgId)
      .select('id, name, is_active, version, form_schema, metadata, published_at')
      .eq('id', formId)
      .maybeSingle(),
    resolveSubmissionSubject(controlClient, orgId, {
      clientProfileId: requestedClientProfileId,
      studentId: requestedStudentId,
    }),
  ]);

  if (formError) {
    context.log?.error?.('form-submissions failed to load form', { message: formError?.message, formId });
    return respond(context, 500, { message: 'failed_to_load_form' });
  }
  if (!form || !form.is_active) return respond(context, 404, { message: 'form_not_found' });
  if (!isPublishedFormRecord(form)) {
    if (requiresPublishMigration(form)) return respond(context, 409, { message: 'form_requires_publish_migration' });
    return respond(context, 409, { message: 'form_not_published' });
  }
  if (subject.error) {
    context.log?.error?.('form-submissions failed to load submission subject', {
      message: subject.error?.message,
      formId,
      clientProfileId: requestedClientProfileId,
      studentId: requestedStudentId,
    });
    return respond(context, 500, { message: 'failed_to_load_client_profile' });
  }
  if (!subject.profile) return respond(context, 404, { message: 'client_profile_not_found' });

  const identityNumber = subject.identityNumber;
  if (!identityNumber) {
    return respond(context, 400, { message: 'client_profile_identity_number_missing' });
  }

  let destination = '';
  try {
    destination = await resolveSubmissionDestination(controlClient, orgId, subject.clientProfileId, deliveryMethod);
    if (!destination) {
      return respond(context, 400, { message: deliveryMethod === 'whatsapp' ? 'client_phone_missing' : 'client_email_missing' });
    }
  } catch (error) {
    context.log?.error?.('form-submissions failed resolving destination', { message: error?.message, clientProfileId: subject.clientProfileId });
    return respond(context, 500, { message: 'failed_to_resolve_destination' });
  }

  const nowIso = getNowIso();
  const submissionMetadata = {
    workflow_status: 'pending',
    delivery_method: deliveryMethod,
    sent_via: [deliveryMethod],
    initiated_at: nowIso,
    initiated_by: userId,
    ...resolveFormVersionMetadata(form, { suffix: 'at_initiation' }),
  };

  const { data: submission, error: submissionError } = await withOrgScope(controlClient, 'form_submissions', orgId)
    .insert({
      form_id: formId,
      client_profile_id: subject.clientProfileId,
      student_id: subject.studentId,
      answers: {},
      alert_flags: { has_red_flags: false, highest_severity: null, hits: [] },
      otp_metadata: { delivery_method: deliveryMethod, otp_status: 'pending', sent_via: [deliveryMethod] },
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
      studentId: subject.studentId,
      clientProfileId: subject.clientProfileId,
    });
    return respond(context, 500, { message: 'failed_to_create_submission' });
  }

  let otpCode;
  let expiresAt;
  try {
    ({ otpCode, expiresAt } = await createSubmissionAccessArtifacts({
      client: controlClient,
      controlClient,
      orgId,
      userId,
      submissionId: submission.id,
      clientProfileId: subject.clientProfileId,
      studentId: subject.studentId,
      formId,
      identityNumber,
      deliveryMethod,
      destination,
      ttlMinutes,
    }));
  } catch (artifactError) {
    const message = String(artifactError?.message || '');
    if (message.startsWith('failed_to_create_otp:')) {
      context.log?.error?.('form-submissions failed to create otp challenge', {
        message: message.slice('failed_to_create_otp:'.length),
        submissionId: submission.id,
      });
      return respond(context, 500, { message: 'failed_to_create_otp' });
    }

    context.log?.error?.('form-submissions failed to create active routing row', {
      message: message.startsWith('failed_to_create_active_routing:') ? message.slice('failed_to_create_active_routing:'.length) : message,
      orgId,
      submissionId: submission.id,
    });
    return respond(context, 500, { message: 'failed_to_create_active_routing' });
  }

  const { error: updateSubmissionExpirationError } = await withOrgScope(controlClient, 'form_submissions', orgId)
    .update({
      otp_metadata: {
        delivery_method: deliveryMethod,
        otp_status: 'pending',
        sent_via: [deliveryMethod],
        expires_at: expiresAt,
      },
      metadata: {
        ...submissionMetadata,
        otp_expires_at: expiresAt,
      },
    })
    .eq('id', submission.id);

  if (updateSubmissionExpirationError) {
    context.log?.warn?.('form-submissions failed to persist otp expiration metadata on initiate', {
      message: updateSubmissionExpirationError?.message,
      submissionId: submission.id,
    });
  }

  if (deliveryMethod === 'email') {
    try {
      await sendSubmissionDelivery(context, {
        controlClient,
        env,
        orgId,
        req,
        deliveryMethod,
        destination,
        otpCode,
        identityNumber,
        formName: form.name,
        expiresAt,
      });
    } catch (emailError) {
      context.log?.error?.('form-submissions failed sending email via smtp connector', {
        message: emailError?.message,
      });
      return respond(context, 502, { message: 'failed_to_send_email' });
    }
  }

  const responseBody = {
    submission_id: submission.id,
    access_identifier: identityNumber,
    expires_at: expiresAt,
    expires_at_display: formatExpirationForDelivery(expiresAt),
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
      client_profile_id: subject.clientProfileId,
      student_id: subject.studentId,
      form_id: formId,
      delivery_method: deliveryMethod,
      source: deliveryMethod,
    },
  });

  return respond(context, 201, responseBody);
}

async function resendSubmission(context, req, { controlClient, env, orgId, userId, userEmail, role }) {
  if (!isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const body = parseRequestBody(req);
  const submissionId = normalizeString(body?.submission_id || body?.submissionId);
  const deliveryMethod = normalizeDeliveryMethod(body?.delivery_method || body?.deliveryMethod);

  const rawTtl = Number(body?.expires_in_minutes ?? body?.expiresInMinutes);
  const ttlMinutes = (Number.isFinite(rawTtl) && rawTtl > 0) ? Math.min(rawTtl, 20160) : 10080;

  if (!UUID_PATTERN.test(submissionId)) return respond(context, 400, { message: 'invalid_submission_id' });
  if (!deliveryMethod) return respond(context, 400, { message: 'invalid_delivery_method' });

  const { data: submission, error: submissionError } = await withOrgScope(controlClient, 'form_submissions', orgId)
    .select('id, form_id, client_profile_id, student_id, metadata, otp_metadata')
    .eq('id', submissionId)
    .maybeSingle();

  if (submissionError) {
    context.log?.error?.('form-submissions failed loading submission for resend', {
      message: submissionError?.message,
      submissionId,
    });
    return respond(context, 500, { message: 'failed_to_load_submission' });
  }
  if (!submission) return respond(context, 404, { message: 'submission_not_found' });

  const currentMetadata = normalizeJsonObject(submission.metadata, {});
  if (String(currentMetadata.workflow_status || '').toLowerCase() === 'submitted') {
    return respond(context, 409, { message: 'submission_already_completed' });
  }

  const [{ data: form, error: formError }, subject] = await Promise.all([
    withOrgScope(controlClient, 'forms', orgId).select('id, name, is_active, version, form_schema, metadata, published_at').eq('id', submission.form_id).maybeSingle(),
    resolveSubmissionSubject(controlClient, orgId, {
      clientProfileId: submission.client_profile_id,
      studentId: submission.student_id,
    }),
  ]);

  if (formError) {
    context.log?.error?.('form-submissions failed loading form for resend', {
      message: formError?.message,
      submissionId,
      formId: submission.form_id,
    });
    return respond(context, 500, { message: 'failed_to_load_form' });
  }
  if (!form || !form.is_active) return respond(context, 404, { message: 'form_not_found' });
  if (!isPublishedFormRecord(form)) {
    if (requiresPublishMigration(form)) return respond(context, 409, { message: 'form_requires_publish_migration' });
    return respond(context, 409, { message: 'form_not_published' });
  }
  if (subject.error) {
    context.log?.error?.('form-submissions failed loading submission subject for resend', {
      message: subject.error?.message,
      submissionId,
      clientProfileId: submission.client_profile_id,
      studentId: submission.student_id,
    });
    return respond(context, 500, { message: 'failed_to_load_client_profile' });
  }
  if (!subject.profile) return respond(context, 404, { message: 'client_profile_not_found' });

  const identityNumber = subject.identityNumber;
  const workflowKind = normalizeString(currentMetadata.workflow_kind).toLowerCase();
  const isWaitingListIntake = workflowKind === 'waiting_list_intake';

  if (!isWaitingListIntake && !identityNumber) {
    return respond(context, 400, { message: 'client_profile_identity_number_missing' });
  }

  let destination = '';
  try {
    destination = await resolveSubmissionDestination(controlClient, orgId, subject.clientProfileId, deliveryMethod);
    if (!destination) {
      return respond(context, 400, { message: deliveryMethod === 'whatsapp' ? 'client_phone_missing' : 'client_email_missing' });
    }
  } catch (destinationError) {
    context.log?.error?.('form-submissions failed resolving destination for resend', {
      message: destinationError?.message,
      submissionId,
      clientProfileId: subject.clientProfileId,
    });
    return respond(context, 500, { message: 'failed_to_resolve_destination' });
  }

  if (isWaitingListIntake) {
    const primaryServiceId = normalizeString(currentMetadata.primary_service_id);
    if (primaryServiceId && !currentMetadata.primary_service_name) {
      const { data: primaryService, error: primaryServiceError } = await withOrgScope(controlClient, 'Services', orgId)
        .select('id, name')
        .eq('id', primaryServiceId)
        .maybeSingle();

      if (primaryServiceError) {
        context.log?.warn?.('form-submissions failed loading waiting-list service name during resend', {
          message: primaryServiceError?.message,
          submissionId,
          primaryServiceId,
        });
      } else if (primaryService?.name) {
        currentMetadata.primary_service_name = primaryService.name;
      }
    }

    return resendWaitingListIntakeSubmission(context, req, {
      controlClient,
      env,
      orgId,
      userId,
      userEmail,
      role,
      submission,
      form,
      subject,
      deliveryMethod,
      destination,
      ttlMinutes,
    });
  }

  try {
    await expirePendingOtps(controlClient, orgId, controlClient, context.log);
  } catch (cleanupError) {
    context.log?.error?.('form-submissions failed cleanup before resend', {
      message: cleanupError?.message,
      orgId,
      submissionId,
    });
    return respond(context, 500, { message: 'failed_to_prepare_resend' });
  }

  const existingOtpMetadata = normalizeJsonObject(submission.otp_metadata, {});
  const existingSentVia = appendDeliveryMethod(
    existingOtpMetadata.sent_via || currentMetadata.sent_via,
    deliveryMethod,
  );

  let otpCode;
  let expiresAt;
  let reusedExistingOtp = false;

  try {
    const reusableAccess = await findReusableSubmissionAccess(controlClient, controlClient, {
      orgId,
      clientProfileId: subject.clientProfileId,
      studentId: submission.student_id,
      submissionId,
    });

    if (reusableAccess) {
      otpCode = reusableAccess.otpCode;
      expiresAt = reusableAccess.expiresAt;
      reusedExistingOtp = true;
    }
  } catch (reuseLookupError) {
    context.log?.error?.('form-submissions failed checking reusable otp during resend', {
      message: reuseLookupError?.message,
      orgId,
      submissionId,
    });
    return respond(context, 500, { message: 'failed_to_prepare_resend' });
  }

  if (!reusedExistingOtp) {
    const { error: expireOtpError } = await withOrgScope(controlClient, 'otp_challenges', orgId)
      .update({ status: 'expired' })
      .eq('status', 'pending')
      .contains('metadata', { submission_id: submissionId });

    if (expireOtpError) {
      context.log?.warn?.('form-submissions failed expiring old otp challenges during resend', {
        message: expireOtpError?.message,
        submissionId,
      });
    }
  }

  // Reuse the existing active OTP when possible; only rotate when no active pending OTP exists.
  if (!reusedExistingOtp) {
    try {
      ({ otpCode, expiresAt } = await createSubmissionAccessArtifacts({
        client: controlClient,
        controlClient,
        orgId,
        userId,
        submissionId,
        clientProfileId: subject.clientProfileId,
        studentId: submission.student_id,
        formId: submission.form_id,
        identityNumber,
        deliveryMethod,
        destination,
        ttlMinutes,
      }));
    } catch (artifactError) {
      const message = String(artifactError?.message || '');
      if (message.startsWith('failed_to_create_otp:')) {
        context.log?.error?.('form-submissions failed to create otp challenge during resend', {
          message: message.slice('failed_to_create_otp:'.length),
          submissionId,
        });
        return respond(context, 500, { message: 'failed_to_create_otp' });
      }
      context.log?.error?.('form-submissions failed to create active routing row during resend', {
        message: message.startsWith('failed_to_create_active_routing:') ? message.slice('failed_to_create_active_routing:'.length) : message,
        orgId,
        submissionId,
      });
      return respond(context, 500, { message: 'failed_to_create_active_routing' });
    }
  }

  const nowIso = getNowIso();
  const priorResendCount = Number(existingOtpMetadata.resend_count || currentMetadata.resend_count || 0);
  const nextResendCount = priorResendCount + 1;

  const { error: updateSubmissionError } = await withOrgScope(controlClient, 'form_submissions', orgId)
    .update({
      source: deliveryMethod,
      otp_metadata: {
        ...existingOtpMetadata,
        delivery_method: deliveryMethod,
        otp_status: 'pending',
        sent_via: existingSentVia,
        expires_at: expiresAt,
        verified_at: reusedExistingOtp ? existingOtpMetadata.verified_at || null : null,
        consumed_at: reusedExistingOtp ? existingOtpMetadata.consumed_at || null : null,
        resent_at: nowIso,
        resend_count: nextResendCount,
      },
      metadata: {
        ...currentMetadata,
        workflow_status: 'pending',
        delivery_method: deliveryMethod,
        sent_via: existingSentVia,
        otp_expires_at: expiresAt,
        resent_at: nowIso,
        resent_by: userId,
        resend_count: nextResendCount,
      },
    })
    .eq('id', submissionId);

  if (updateSubmissionError) {
    context.log?.error?.('form-submissions failed updating submission during resend', {
      message: updateSubmissionError?.message,
      submissionId,
    });
    return respond(context, 500, { message: 'failed_to_update_submission' });
  }

  if (deliveryMethod === 'email') {
    try {
      await sendSubmissionDelivery(context, {
        controlClient,
        env,
        orgId,
        req,
        deliveryMethod,
        destination,
        otpCode,
        identityNumber,
        formName: form.name,
        expiresAt,
      });
    } catch (emailError) {
      context.log?.error?.('form-submissions failed sending resend email via smtp connector', {
        message: emailError?.message,
        submissionId,
      });
      return respond(context, 502, { message: 'failed_to_send_email' });
    }
  }

  await logAuditEvent(controlClient, {
    orgId,
    userId,
    userEmail,
    userRole: role,
    actionType: AUDIT_ACTIONS.FORM_SUBMISSION_RESENT,
    actionCategory: AUDIT_CATEGORIES.FORMS,
    resourceType: 'form_submission',
    resourceId: submissionId,
    details: {
      client_profile_id: subject.clientProfileId,
      student_id: submission.student_id,
      form_id: submission.form_id,
      delivery_method: deliveryMethod,
      source: deliveryMethod,
    },
  });

  const responseBody = {
    submission_id: submissionId,
    access_identifier: identityNumber,
    expires_at: expiresAt,
    expires_at_display: formatExpirationForDelivery(expiresAt),
  };

  if (deliveryMethod === 'whatsapp') {
    responseBody.otp = otpCode;
    responseBody.phone = destination;
  }

  return respond(context, 200, responseBody);
}

async function verifySubmissionAccess(context, req, { controlClient }) {
  const body = parseRequestBody(req);
  const identityNumber = normalizeIdentityNumber(body?.identity_number || body?.identityNumber);
  const otpCode = normalizeOtp(body?.otp);

  if (!identityNumber || otpCode.length !== OTP_DIGITS) {
    return respond(context, 401, { message: INVALID_VERIFY_MESSAGE });
  }

  const ipAddress = resolveClientIp(req);

  let routingRow;
  try {
    routingRow = await findActiveRoutingByIdentity(controlClient, identityNumber, otpCode);
  } catch (error) {
    context.log?.error?.('form-submissions verify failed querying active_routing', { message: error?.message });
    return respond(context, 500, { message: 'failed_to_verify_otp' });
  }

  if (!routingRow) {
    try {
      const result = await processFailedVerifyAttempt(context, {
        controlClient,
        identityNumber,
        ipAddress,
      });
      if (result.shouldLockDown) {
        return respond(context, 429, { message: VERIFY_LOCKDOWN_MESSAGE });
      }
    } catch (rateError) {
      context.log?.warn?.('form-submissions verify failed to process failed attempt', {
        message: rateError?.message,
      });
    }
    return respond(context, 401, { message: INVALID_VERIFY_MESSAGE });
  }

  const orgId = normalizeString(routingRow.org_id);
  const submissionId = normalizeString(routingRow?.routing_info?.submission_id);

  if (!UUID_PATTERN.test(orgId) || !UUID_PATTERN.test(submissionId)) {
    try {
      const result = await processFailedVerifyAttempt(context, {
        controlClient,
        identityNumber,
        ipAddress,
      });
      if (result.shouldLockDown) {
        return respond(context, 429, { message: VERIFY_LOCKDOWN_MESSAGE });
      }
    } catch (rateError) {
      context.log?.warn?.('form-submissions verify failed to process invalid routing attempt', {
        message: rateError?.message,
      });
    }
    return respond(context, 401, { message: INVALID_VERIFY_MESSAGE });
  }

  try {
    await expirePendingOtps(controlClient, orgId, controlClient, context.log);
  } catch (cleanupError) {
    context.log?.error?.('form-submissions verify failed cleanup before otp verification', {
      message: cleanupError?.message,
      orgId,
      submissionId,
    });
    return respond(context, 500, { message: 'failed_to_verify_otp' });
  }

  const { data: submission, error: submissionError } = await withOrgScope(controlClient, 'form_submissions', orgId)
    .select('id, client_profile_id, student_id, form_id, metadata, otp_metadata')
    .eq('id', submissionId)
    .maybeSingle();

  if (submissionError || !submission) {
    try {
      const result = await processFailedVerifyAttempt(context, {
        controlClient,
        identityNumber,
        ipAddress,
      });
      if (result.shouldLockDown) {
        return respond(context, 429, { message: VERIFY_LOCKDOWN_MESSAGE });
      }
    } catch (rateError) {
      context.log?.warn?.('form-submissions verify failed to process missing submission attempt', {
        message: rateError?.message,
      });
    }
    return respond(context, 401, { message: INVALID_VERIFY_MESSAGE });
  }

  const subject = await resolveSubmissionSubject(controlClient, orgId, {
    clientProfileId: submission.client_profile_id,
    studentId: submission.student_id,
  });

  if (subject.error) {
    context.log?.error?.('form-submissions verify failed loading submission subject', {
      message: subject.error?.message,
      submissionId,
      clientProfileId: submission.client_profile_id,
    });
    return respond(context, 500, { message: 'failed_to_verify_otp' });
  }

  if (!subject.profile || subject.identityNumber !== identityNumber) {
    try {
      const result = await processFailedVerifyAttempt(context, {
        controlClient,
        identityNumber,
        ipAddress,
      });
      if (result.shouldLockDown) {
        return respond(context, 429, { message: VERIFY_LOCKDOWN_MESSAGE });
      }
    } catch (rateError) {
      context.log?.warn?.('form-submissions verify failed to process student mismatch attempt', {
        message: rateError?.message,
      });
    }
    return respond(context, 401, { message: INVALID_VERIFY_MESSAGE });
  }

  let otpChallenge;
  try {
    otpChallenge = await findTenantPendingOtpChallenge(controlClient, orgId, {
      clientProfileId: submission.client_profile_id,
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
      const result = await processFailedVerifyAttempt(context, {
        controlClient,
        identityNumber,
        ipAddress,
      });
      if (result.shouldLockDown) {
        return respond(context, 429, { message: VERIFY_LOCKDOWN_MESSAGE });
      }
    } catch (rateError) {
      context.log?.warn?.('form-submissions verify failed to process invalid otp attempt', {
        message: rateError?.message,
      });
    }
    return respond(context, 401, { message: OTP_INVALID_OR_EXPIRED_MESSAGE });
  }

  const verifyMetadata = normalizeJsonObject(submission.metadata, {});
  const verifyNowIso = getNowIso();
  const { error: updateVerifyMetaError } = await withOrgScope(controlClient, 'form_submissions', orgId)
    .update({
      metadata: {
        ...verifyMetadata,
        verify_ip: ipAddress || null,
        verify_ip_at: verifyNowIso,
        form_accessed_at: verifyNowIso,
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

  const { data: form, error: formError } = await withOrgScope(controlClient, 'forms', orgId)
    .select('id, name, description, is_active, version, form_schema, alert_rules, visibility_rules, metadata, published_at')
    .eq('id', submission.form_id)
    .maybeSingle();

  if (formError || !form || !form.is_active) {
    return respond(context, 404, { message: 'form_not_found' });
  }

  let publicFormState;
  try {
    publicFormState = await resolvePublicFormStateWithSharedBlocks(controlClient, orgId, form, { allowDraftFallback: false });
  } catch (error) {
    if (String(error?.message || '').startsWith('missing_shared_blocks:')) {
      return respond(context, 409, { message: 'form_unavailable' });
    }
    throw error;
  }
  if (!publicFormState.is_published) {
    return respond(context, 409, { message: 'form_not_published' });
  }

  return respond(context, 200, {
    submission_id: submission.id,
    org_id: orgId,
    form_name: form.name || '',
    form_description: form.description || '',
    form_schema: publicFormState.form_schema,
    visibility_rules: publicFormState.visibility_rules,
  });
}

async function finalizeSubmission(context, req, { controlClient, env }) {
  const body = parseRequestBody(req);
  const submissionId = normalizeString(body?.submission_id || body?.submissionId);
  const otpCode = normalizeOtp(body?.otp);
  const answers = normalizeJsonObject(body?.answers, {});
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

  const { data: submission, error: submissionError } = await withOrgScope(controlClient, 'form_submissions', orgId)
    .select('id, client_profile_id, student_id, form_id, metadata, otp_metadata, submitted_at')
    .eq('id', submissionId)
    .maybeSingle();

  if (submissionError || !submission) {
    return respond(context, 404, { message: 'submission_not_found' });
  }

  // Idempotency guard: prevent re-finalization of already-submitted forms
  const workflowStatus = normalizeString(submission?.metadata?.workflow_status).toLowerCase();
  if (workflowStatus === 'submitted' || (!workflowStatus && submission.submitted_at)) {
    return respond(context, 409, { message: 'submission_already_finalized' });
  }

  let otpChallenge;
  try {
    otpChallenge = await findTenantOtpChallenge(controlClient, orgId, {
      clientProfileId: submission.client_profile_id,
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

  let publicFormState = {
    form_schema: normalizeFormSchema({}),
    visibility_rules: [],
    alert_rules: [],
  };
  let formVersionMetadataAtSubmission = {};
  if (submission.form_id && UUID_PATTERN.test(String(submission.form_id))) {
    const { data: formRecord } = await withOrgScope(controlClient, 'forms', orgId)
      .select('id, name, is_active, version, form_schema, alert_rules, visibility_rules, metadata, published_at')
      .eq('id', submission.form_id)
      .maybeSingle();
    if (formRecord) {
      if (!formRecord.is_active) {
        return respond(context, 404, { message: 'form_not_found' });
      }
      formVersionMetadataAtSubmission = resolveFormVersionMetadata(formRecord, { suffix: 'at_submission' });
      try {
        publicFormState = await resolvePublicFormStateWithSharedBlocks(controlClient, orgId, formRecord, { allowDraftFallback: false });
      } catch (error) {
        if (String(error?.message || '').startsWith('missing_shared_blocks:')) {
          return respond(context, 409, { message: 'form_unavailable' });
        }
        throw error;
      }
      if (!publicFormState.is_published) {
        return respond(context, 409, { message: 'form_not_published' });
      }
    }
  }

  const preparedAnswers = prepareAnswersForStorage({
    formSchema: publicFormState.form_schema,
    answers,
    env,
  });
  const alertFlags = evaluateAlertFlags({
    formSchema: publicFormState.form_schema,
    alertRules: publicFormState.alert_rules,
    answers: preparedAnswers,
  });

  const { error: updateSubmissionError } = await withOrgScope(controlClient, 'form_submissions', orgId)
    .update({
      answers: preparedAnswers,
      alert_flags: alertFlags,
      submitted_at: nowIso,
      otp_metadata: {
        ...normalizeJsonObject(submission.otp_metadata, {}),
        otp_status: 'verified',
        verified_at: nowIso,
        consumed_at: nowIso,
        submit_ip: ipAddress || null,
      },
      metadata: {
        ...currentMetadata,
        workflow_status: 'submitted',
        submitted_at: nowIso,
        ...formVersionMetadataAtSubmission,
        schema_snapshot: materializeSchemaForSnapshot(publicFormState.form_schema),
        visibility_rules_snapshot: publicFormState.visibility_rules,
        alert_rules_snapshot: publicFormState.alert_rules,
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

  const { error: updateOtpError } = await withOrgScope(controlClient, 'otp_challenges', orgId)
    .update({
      status: 'verified',
      verified_at: nowIso,
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
    .eq('id', routingRow.id)
    .eq('category', ROUTING_CATEGORY)
    .contains('routing_info', { submission_id: submissionId });

  if (cleanupError) {
    context.log?.error?.('form-submissions submit failed cleaning active_routing', {
      message: cleanupError?.message,
      routingId: routingRow.id,
    });
    return respond(context, 500, { message: 'failed_to_cleanup_routing' });
  }

  try {
    await logTenantAuditEvent(controlClient, {
      orgId,
      actorUserId: null,
      eventType: 'form_submission.completed',
      retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
      resourceType: 'form_submission',
      resourceId: submissionId,
      beforeState: {
        workflow_status: currentMetadata.workflow_status || null,
      },
      afterState: {
        workflow_status: 'submitted',
        submitted_at: nowIso,
      },
      details: {
        origin: 'public_form_submission',
        form_id: routingRow?.metadata?.form_id || null,
        client_profile_id: submission.client_profile_id,
        student_id: submission.student_id,
        delivery_method: routingRow?.metadata?.delivery_method || null,
        has_red_flags: alertFlags.has_red_flags,
      },
    });
  } catch (auditError) {
    context.log?.warn?.('form-submissions failed to write tenant audit event (complete)', {
      message: auditError?.message,
      submissionId,
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

  if ((method === 'POST' && (!action || action === 'resend')) || (method === 'GET' && !action)) {
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

    if (method === 'POST' && action === 'resend') {
      return resendSubmission(context, req, {
        controlClient,
        env,
        orgId,
        userId,
        userEmail,
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
