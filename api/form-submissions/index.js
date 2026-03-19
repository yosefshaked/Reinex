/* eslint-env node */
import { createHash, randomInt } from 'node:crypto';
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  UUID_PATTERN,
  ensureMembership,
  isAdminRole,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';

const OTP_DIGITS = 6;
const OTP_TTL_MINUTES = 15;

function normalizeDeliveryMethod(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === 'whatsapp' || normalized === 'email' ? normalized : '';
}

function normalizeOtp(value) {
  return String(value || '').replace(/\D/g, '').slice(0, OTP_DIGITS);
}

function hashOtp(otp) {
  return createHash('sha256').update(String(otp)).digest('hex');
}

function generateOtp() {
  const min = 10 ** (OTP_DIGITS - 1);
  const max = (10 ** OTP_DIGITS) - 1;
  return String(randomInt(min, max + 1));
}

function normalizeJsonObject(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }
  return value;
}

function normalizeIdentityNumber(value) {
  return String(value || '').replace(/\D/g, '').trim();
}

function normalizePhoneNumber(value) {
  return String(value || '').replace(/[^\d]/g, '').trim();
}

async function resolveDestinationFromStudentAndGuardians(tenantClient, studentId, fieldName) {
  const { data: student, error: studentError } = await tenantClient
    .from('students')
    .select(`id, ${fieldName}`)
    .eq('id', studentId)
    .maybeSingle();

  if (studentError) {
    throw studentError;
  }

  const studentValue = normalizeString(student?.[fieldName]);
  if (studentValue) {
    return studentValue;
  }

  const { data: links, error: linksError } = await tenantClient
    .from('student_guardians')
    .select('guardian_id, is_primary')
    .eq('student_id', studentId)
    .order('is_primary', { ascending: false });

  if (linksError) {
    throw linksError;
  }

  const guardianIds = (Array.isArray(links) ? links : [])
    .map((row) => row?.guardian_id)
    .filter(Boolean);

  if (!guardianIds.length) {
    return '';
  }

  const { data: guardians, error: guardiansError } = await tenantClient
    .from('guardians')
    .select(`id, ${fieldName}`)
    .in('id', guardianIds);

  if (guardiansError) {
    throw guardiansError;
  }

  const byId = new Map((Array.isArray(guardians) ? guardians : []).map((g) => [g.id, g]));
  for (const link of links || []) {
    const value = normalizeString(byId.get(link.guardian_id)?.[fieldName]);
    if (value) {
      return value;
    }
  }

  return '';
}

async function findActiveOtpChallenge(tenantClient, { studentId, otp, submissionId = '' }) {
  const tokenHash = hashOtp(otp);
  const nowIso = new Date().toISOString();

  const { data, error } = await tenantClient
    .from('otp_challenges')
    .select('id, status, expires_at, metadata, attempts')
    .eq('student_id', studentId)
    .eq('token_hash', tokenHash)
    .in('status', ['pending', 'verified'])
    .gt('expires_at', nowIso)
    .order('expires_at', { ascending: false })
    .limit(10);

  if (error) {
    throw error;
  }

  let candidates = Array.isArray(data) ? data : [];
  if (submissionId) {
    candidates = candidates.filter((item) => String(item?.metadata?.submission_id || '') === submissionId);
  }

  return candidates[0] || null;
}

async function initiateSubmission(context, req, supabase, tenantClient, orgId, role) {
  if (!isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const body = parseRequestBody(req);
  const formId = normalizeString(body?.form_id || body?.formId);
  const studentId = normalizeString(body?.student_id || body?.studentId);
  const deliveryMethod = normalizeDeliveryMethod(body?.delivery_method || body?.deliveryMethod);

  if (!UUID_PATTERN.test(formId)) {
    return respond(context, 400, { message: 'invalid_form_id' });
  }

  if (!UUID_PATTERN.test(studentId)) {
    return respond(context, 400, { message: 'invalid_student_id' });
  }

  if (!deliveryMethod) {
    return respond(context, 400, { message: 'invalid_delivery_method' });
  }

  const [{ data: form, error: formError }, { data: student, error: studentError }] = await Promise.all([
    tenantClient
      .from('forms')
      .select('id, name, is_active')
      .eq('id', formId)
      .maybeSingle(),
    tenantClient
      .from('students')
      .select('id, first_name, last_name, phone, email')
      .eq('id', studentId)
      .maybeSingle(),
  ]);

  if (formError) {
    context.log?.error?.('form-submissions failed to load form', { message: formError?.message, formId });
    return respond(context, 500, { message: 'failed_to_load_form' });
  }

  if (!form || !form.is_active) {
    return respond(context, 404, { message: 'form_not_found' });
  }

  if (studentError) {
    context.log?.error?.('form-submissions failed to load student', { message: studentError?.message, studentId });
    return respond(context, 500, { message: 'failed_to_load_student' });
  }

  if (!student) {
    return respond(context, 404, { message: 'student_not_found' });
  }

  let destination = '';
  if (deliveryMethod === 'whatsapp') {
    const rawPhone = await resolveDestinationFromStudentAndGuardians(tenantClient, studentId, 'phone');
    destination = normalizePhoneNumber(rawPhone);
    if (!destination) {
      return respond(context, 400, { message: 'student_phone_missing' });
    }
  } else {
    destination = normalizeString(await resolveDestinationFromStudentAndGuardians(tenantClient, studentId, 'email')).toLowerCase();
    if (!destination) {
      return respond(context, 400, { message: 'student_email_missing' });
    }
  }

  const nowIso = new Date().toISOString();
  const submissionMetadata = {
    workflow_status: 'pending',
    delivery_method: deliveryMethod,
    org_id: orgId,
    initiated_at: nowIso,
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
      metadata: submissionMetadata,
      submitted_at: nowIso,
    })
    .select('id')
    .single();

  if (submissionError || !submission?.id) {
    context.log?.error?.('form-submissions failed to create submission', {
      message: submissionError?.message,
      studentId,
      formId,
    });
    return respond(context, 500, { message: 'failed_to_create_submission' });
  }

  const otp = generateOtp();
  const otpExpiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();
  const otpMetadata = {
    submission_id: submission.id,
    form_id: formId,
    org_id: orgId,
  };

  const { error: otpError } = await tenantClient
    .from('otp_challenges')
    .insert({
      student_id: studentId,
      channel: deliveryMethod,
      destination,
      token_hash: hashOtp(otp),
      status: 'pending',
      expires_at: otpExpiresAt,
      metadata: otpMetadata,
    });

  if (otpError) {
    context.log?.error?.('form-submissions failed to create otp challenge', {
      message: otpError?.message,
      submissionId: submission.id,
    });
    return respond(context, 500, { message: 'failed_to_create_otp' });
  }

  if (deliveryMethod === 'email') {
    console.log('[MOCK BREVO EMAIL SEND]', {
      to: destination,
      studentId,
      formId,
      submissionId: submission.id,
      otp,
      expiresAt: otpExpiresAt,
    });
  }

  const responseBody = {
    submission_id: submission.id,
  };

  if (deliveryMethod === 'whatsapp') {
    responseBody.otp = otp;
    responseBody.phone = destination;
  }

  return respond(context, 201, responseBody);
}

async function verifyOtp(context, req, tenantClient) {
  const body = parseRequestBody(req);
  const identityNumber = normalizeIdentityNumber(body?.identity_number || body?.identityNumber);
  const otp = normalizeOtp(body?.otp);
  const providedSubmissionId = normalizeString(body?.submission_id || body?.submissionId);

  if (!identityNumber) {
    return respond(context, 400, { message: 'missing_identity_number' });
  }

  if (otp.length !== OTP_DIGITS) {
    return respond(context, 400, { message: 'invalid_otp' });
  }

  const { data: student, error: studentError } = await tenantClient
    .from('students')
    .select('id, identity_number')
    .eq('identity_number', identityNumber)
    .maybeSingle();

  if (studentError) {
    context.log?.error?.('form-submissions verify failed to load student', { message: studentError?.message });
    return respond(context, 500, { message: 'failed_to_verify_otp' });
  }

  if (!student) {
    return respond(context, 401, { message: 'invalid_credentials' });
  }

  let otpChallenge;
  try {
    otpChallenge = await findActiveOtpChallenge(tenantClient, {
      studentId: student.id,
      otp,
      submissionId: providedSubmissionId,
    });
  } catch (error) {
    context.log?.error?.('form-submissions verify failed to query otp', { message: error?.message });
    return respond(context, 500, { message: 'failed_to_verify_otp' });
  }

  if (!otpChallenge) {
    return respond(context, 401, { message: 'invalid_credentials' });
  }

  const submissionId = normalizeString(otpChallenge?.metadata?.submission_id || providedSubmissionId);
  if (!UUID_PATTERN.test(submissionId)) {
    return respond(context, 400, { message: 'invalid_submission_id' });
  }

  const { data: submission, error: submissionError } = await tenantClient
    .from('form_submissions')
    .select('id, student_id, form_id')
    .eq('id', submissionId)
    .eq('student_id', student.id)
    .maybeSingle();

  if (submissionError) {
    context.log?.error?.('form-submissions verify failed to load submission', {
      message: submissionError?.message,
      submissionId,
    });
    return respond(context, 500, { message: 'failed_to_load_submission' });
  }

  if (!submission) {
    return respond(context, 404, { message: 'submission_not_found' });
  }

  const { data: formData, error: formError } = await tenantClient
    .from('forms')
    .select('id, form_schema')
    .eq('id', submission.form_id)
    .maybeSingle();

  if (formError) {
    context.log?.error?.('form-submissions verify failed to load form schema', {
      message: formError?.message,
      formId: submission.form_id,
    });
    return respond(context, 500, { message: 'failed_to_load_form' });
  }

  if (!formData) {
    return respond(context, 404, { message: 'form_not_found' });
  }

  if (otpChallenge.status === 'pending') {
    const verifyMetadata = {
      ...normalizeJsonObject(otpChallenge.metadata, {}),
      verified_at: new Date().toISOString(),
    };

    const { error: updateOtpError } = await tenantClient
      .from('otp_challenges')
      .update({
        status: 'verified',
        verified_at: verifyMetadata.verified_at,
        attempts: Number(otpChallenge.attempts || 0) + 1,
        metadata: verifyMetadata,
      })
      .eq('id', otpChallenge.id)
      .eq('status', 'pending');

    if (updateOtpError) {
      context.log?.error?.('form-submissions verify failed to mark otp as verified', {
        message: updateOtpError?.message,
      });
      return respond(context, 500, { message: 'failed_to_verify_otp' });
    }
  }

  return respond(context, 200, {
    submission_id: submission.id,
    form_schema: normalizeJsonObject(formData.form_schema, { type: 'object', properties: {}, required: [] }),
  });
}

async function submitAnswers(context, req, tenantClient) {
  const body = parseRequestBody(req);
  const submissionId = normalizeString(body?.submission_id || body?.submissionId);
  const otp = normalizeOtp(body?.otp);
  const answers = normalizeJsonObject(body?.answers, {});
  const formSchema = normalizeJsonObject(body?.form_schema || body?.formSchema, {});

  if (!UUID_PATTERN.test(submissionId)) {
    return respond(context, 400, { message: 'invalid_submission_id' });
  }

  if (otp.length !== OTP_DIGITS) {
    return respond(context, 400, { message: 'invalid_otp' });
  }

  const { data: submission, error: submissionError } = await tenantClient
    .from('form_submissions')
    .select('id, student_id, metadata')
    .eq('id', submissionId)
    .maybeSingle();

  if (submissionError) {
    context.log?.error?.('form-submissions submit failed to load submission', { message: submissionError?.message, submissionId });
    return respond(context, 500, { message: 'failed_to_submit_form' });
  }

  if (!submission) {
    return respond(context, 404, { message: 'submission_not_found' });
  }

  const currentMetadata = normalizeJsonObject(submission.metadata, {});
  if (currentMetadata.workflow_status === 'submitted') {
    return respond(context, 409, { message: 'submission_already_completed' });
  }

  let otpChallenge;
  try {
    otpChallenge = await findActiveOtpChallenge(tenantClient, {
      studentId: submission.student_id,
      otp,
      submissionId,
    });
  } catch (error) {
    context.log?.error?.('form-submissions submit failed to query otp', { message: error?.message });
    return respond(context, 500, { message: 'failed_to_submit_form' });
  }

  if (!otpChallenge) {
    return respond(context, 401, { message: 'invalid_otp' });
  }

  const submittedAt = new Date().toISOString();
  const metadata = {
    ...currentMetadata,
    workflow_status: 'submitted',
    submitted_at: submittedAt,
    schema_snapshot: formSchema,
  };

  const { error: updateSubmissionError } = await tenantClient
    .from('form_submissions')
    .update({
      answers,
      submitted_at: submittedAt,
      metadata,
    })
    .eq('id', submissionId);

  if (updateSubmissionError) {
    context.log?.error?.('form-submissions submit failed to update submission', {
      message: updateSubmissionError?.message,
      submissionId,
    });
    return respond(context, 500, { message: 'failed_to_submit_form' });
  }

  const otpUpdateMetadata = {
    ...normalizeJsonObject(otpChallenge.metadata, {}),
    consumed_at: submittedAt,
  };

  const { error: updateOtpError } = await tenantClient
    .from('otp_challenges')
    .update({
      status: 'expired',
      verified_at: submittedAt,
      metadata: otpUpdateMetadata,
    })
    .eq('id', otpChallenge.id);

  if (updateOtpError) {
    context.log?.error?.('form-submissions submit failed to consume otp', { message: updateOtpError?.message });
    return respond(context, 500, { message: 'failed_to_consume_otp' });
  }

  return respond(context, 200, { message: 'submitted', submission_id: submissionId });
}

export default async function formSubmissions(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  const action = normalizeString(context?.bindingData?.action).toLowerCase();

  if (method !== 'POST' && method !== 'PUT') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('form-submissions missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const supabase = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  if (method === 'POST' && !action) {
    const authorization = resolveBearerAuthorization(req);
    if (!authorization?.token) {
      return respond(context, 401, { message: 'missing_bearer' });
    }

    let authResult;
    try {
      authResult = await supabase.auth.getUser(authorization.token);
    } catch (error) {
      context.log?.error?.('form-submissions failed to validate token', { message: error?.message });
      return respond(context, 401, { message: 'invalid_or_expired_token' });
    }

    if (authResult.error || !authResult.data?.user?.id) {
      return respond(context, 401, { message: 'invalid_or_expired_token' });
    }

    const userId = authResult.data.user.id;

    let role;
    try {
      role = await ensureMembership(supabase, orgId, userId);
    } catch (membershipError) {
      context.log?.error?.('form-submissions failed to verify membership', {
        message: membershipError?.message,
        orgId,
        userId,
      });
      return respond(context, 500, { message: 'failed_to_verify_membership' });
    }

    if (!role) {
      return respond(context, 403, { message: 'forbidden' });
    }

    return initiateSubmission(context, req, supabase, tenantClient, orgId, role);
  }

  if (method === 'POST' && action === 'verify') {
    return verifyOtp(context, req, tenantClient);
  }

  if (method === 'PUT' && action === 'submit') {
    return submitAnswers(context, req, tenantClient);
  }

  return respond(context, 404, { message: 'not_found' });
}
