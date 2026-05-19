/* eslint-env node */
import crypto from 'node:crypto';
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureSystemAdmin,
  readEnv,
  respond,
  parseRequestBody,
  UUID_PATTERN,
  normalizeString,
} from '../_shared/org-bff.js';
import { fetchBillingSnapshot } from '../_shared/student-billing.js';
import { logAuditEvent } from '../_shared/audit-log.js';

// The caller must type this phrase exactly to prevent accidental execution.
const CONFIRMATION_PHRASE = 'I confirm this action is irreversible';

// ── Bucket field definitions (schema-verified 2026-05-04c) ──────────────────
// Sensitive columns are collected into a single JSON bucket, encrypted as one
// AES-256-GCM ciphertext, stored in pii_encrypted_data, then NULLed at source.
// Names (first_name, last_name, middle_name) are NEVER included — they stay
// plaintext for roster searchability. Existing column types are unchanged.

const STUDENTS_BUCKET_FIELDS = ['notes_internal', 'medical_provider', 'metadata'];

const CLIENT_PROFILE_BUCKET_FIELDS = [
  'identity_number',
  'phone',
  'email',
  'date_of_birth',
  'metadata',
];

const GUARDIAN_BUCKET_FIELDS = ['phone', 'email', 'metadata'];

// ── Encryption helpers ───────────────────────────────────────────────────────

/**
 * AES-256-GCM encrypt a UTF-8 string.
 * Returns "base64(iv):base64(ciphertext):base64(authtag)".
 */
function encryptString(keyBuf, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${ct.toString('base64')}:${tag.toString('base64')}`;
}

/**
 * Build the encrypted bucket for a row.
 *
 * Collects the listed fields into a plain object (null/undefined fields skipped).
 * Serializes values before bucket assembly:
 *   - jsonb objects   → JSON.stringify
 *   - Date instances  → ISO date string (YYYY-MM-DD)
 * JSON.stringifies the assembled object, then AES-256-GCM encrypts it.
 *
 * Returns the complete Supabase UPDATE payload:
 *   { pii_encrypted_data: ciphertext, <field>: null, ... }
 */
function buildBucketUpdate(keyBuf, row, fields) {
  const bucket = {};
  for (const field of fields) {
    const raw = row[field];
    if (raw === null || raw === undefined) continue;
    if (raw instanceof Date) {
      bucket[field] = raw.toISOString().split('T')[0];
    } else if (typeof raw === 'object') {
      // jsonb arrives from Supabase as a parsed JS object
      bucket[field] = JSON.stringify(raw);
    } else {
      bucket[field] = String(raw);
    }
  }

  const ciphertext = encryptString(keyBuf, JSON.stringify(bucket));

  const nulls = {};
  for (const field of fields) {
    nulls[field] = null;
  }

  return { pii_encrypted_data: ciphertext, ...nulls };
}

// ── Main handler ─────────────────────────────────────────────────────────────

export default async function systemAdminPseudonymize(context, req) {
  const method = String(req.method || '').toUpperCase();
  if (method !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('system-admin-pseudonymize: missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer_token' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let admin;
  try {
    admin = await ensureSystemAdmin(req, supabase, authorization, { context });
  } catch (error) {
    return respond(context, error?.statusCode || 403, { message: error?.message || 'forbidden' });
  }

  // ── Input validation ──────────────────────────────────────────────────────
  const body = parseRequestBody(req);
  const { student_id, org_id, reason, actor_confirmation } = body;

  if (!UUID_PATTERN.test(student_id || '')) {
    return respond(context, 400, { message: 'invalid_student_id' });
  }
  if (!UUID_PATTERN.test(org_id || '')) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }
  if (!normalizeString(reason)) {
    return respond(context, 400, { message: 'reason_required' });
  }
  if (actor_confirmation !== CONFIRMATION_PHRASE) {
    return respond(context, 400, {
      message: 'confirmation_phrase_required',
      required: CONFIRMATION_PHRASE,
    });
  }

  // ── Encryption key ────────────────────────────────────────────────────────
  const keyHex = normalizeString(env.STUDENT_PII_ENCRYPTION_KEY || '');
  if (!keyHex || keyHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(keyHex)) {
    context.log?.error?.('system-admin-pseudonymize: STUDENT_PII_ENCRYPTION_KEY missing or invalid');
    return respond(context, 500, { message: 'server_misconfigured', detail: 'encryption_key_invalid' });
  }
  const keyBuf = Buffer.from(keyHex, 'hex');

  // ── Load student + client_profile ─────────────────────────────────────────
  const { data: student, error: studentError } = await supabase
    .from('students')
    .select(`
      id,
      org_id,
      privacy_status,
      notes_internal,
      medical_provider,
      metadata,
      client_profile_id,
      client_profile:client_profiles(
        id,
        org_id,
        first_name,
        last_name,
        is_active,
        privacy_status,
        identity_number,
        phone,
        email,
        date_of_birth,
        metadata
      )
    `)
    .eq('id', student_id)
    .eq('org_id', org_id)
    .maybeSingle();

  if (studentError) {
    context.log?.error?.('system-admin-pseudonymize: student load failed', {
      message: studentError.message,
    });
    return respond(context, 500, { message: 'database_error' });
  }
  if (!student) {
    return respond(context, 404, { message: 'student_not_found' });
  }

  const profile = student.client_profile;

  // ── Eligibility gates (strictly enforced) ─────────────────────────────────

  if (student.privacy_status === 'anonymized') {
    return respond(context, 409, { message: 'already_anonymized' });
  }

  // Active student gate — client_profiles.is_active must be false (locked decision)
  if (profile?.is_active !== false) {
    return respond(context, 409, {
      message: 'student_is_active',
      detail: 'Set client_profiles.is_active = false before requesting erasure.',
    });
  }

  let snapshot;
  try {
    snapshot = await fetchBillingSnapshot(supabase, { orgId: org_id, studentId: student_id });
  } catch (err) {
    context.log?.error?.('system-admin-pseudonymize: billing snapshot failed', {
      message: err?.message,
    });
    return respond(context, 500, { message: 'billing_check_failed' });
  }
  if (snapshot?.summary?.balance !== 0) {
    return respond(context, 409, {
      message: 'outstanding_balance',
      balance: snapshot?.summary?.balance,
    });
  }

  // Capture real name before any writes — for audit log compliance record only.
  // Names are plaintext and will remain so after anonymization.
  const originalName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');

  let partialFailure = false;
  const guardians_anonymized = [];
  const guardians_skipped = [];

  // ── Step 1: Encrypt students row ──────────────────────────────────────────
  const studentUpdate = {
    ...buildBucketUpdate(keyBuf, student, STUDENTS_BUCKET_FIELDS),
    privacy_status: 'anonymized',
  };

  const { error: studentUpdateError } = await supabase
    .from('students')
    .update(studentUpdate)
    .eq('id', student_id)
    .eq('org_id', org_id);

  if (studentUpdateError) {
    context.log?.error?.('system-admin-pseudonymize: students update failed', {
      message: studentUpdateError.message,
    });
    // students failed — abort before touching any other row
    return respond(context, 500, { message: 'student_update_failed' });
  }

  // ── Step 2: Encrypt client_profiles row ───────────────────────────────────
  // first_name / last_name / middle_name are excluded from the bucket.
  // date_of_birth (date) and metadata (jsonb) are included as serialized strings;
  // their source columns are NULLed — types are never changed.
  const profileUpdate = {
    ...buildBucketUpdate(keyBuf, profile, CLIENT_PROFILE_BUCKET_FIELDS),
    privacy_status: 'anonymized',
  };

  const { error: profileUpdateError } = await supabase
    .from('client_profiles')
    .update(profileUpdate)
    .eq('id', profile.id)
    .eq('org_id', org_id);

  if (profileUpdateError) {
    context.log?.error?.('system-admin-pseudonymize: client_profiles update failed', {
      message: profileUpdateError.message,
    });
    partialFailure = true;
  }

  // ── Step 3: Handle guardians ──────────────────────────────────────────────
  if (!partialFailure && profile?.id) {
    const { data: guardianLinks, error: guardianLinkError } = await supabase
      .from('client_guardians')
      .select('guardian_id, guardian:guardians(id, org_id, phone, email, metadata)')
      .eq('client_profile_id', profile.id)
      .eq('org_id', org_id);

    if (guardianLinkError) {
      context.log?.warn?.('system-admin-pseudonymize: guardian link load failed', {
        message: guardianLinkError.message,
      });
      partialFailure = true;
    } else {
      for (const link of guardianLinks || []) {
        const guardian = link.guardian;
        if (!guardian) continue;

        const { data: otherLinks } = await supabase
          .from('client_guardians')
          .select('client_profile_id, client_profile:client_profiles(privacy_status)')
          .eq('guardian_id', guardian.id)
          .eq('org_id', org_id)
          .neq('client_profile_id', profile.id);

        const hasOtherActiveLinks = (otherLinks || []).some(
          (l) => l.client_profile?.privacy_status === 'active',
        );

        if (hasOtherActiveLinks) {
          guardians_skipped.push({
            guardian_id: guardian.id,
            reason: 'guardian_has_other_active_links',
          });
          continue;
        }

        // Sole link — encrypt guardian bucket. Names stay plaintext.
        const guardianUpdate = buildBucketUpdate(keyBuf, guardian, GUARDIAN_BUCKET_FIELDS);

        const { error: guardianUpdateError } = await supabase
          .from('guardians')
          .update(guardianUpdate)
          .eq('id', guardian.id)
          .eq('org_id', org_id);

        if (guardianUpdateError) {
          context.log?.warn?.('system-admin-pseudonymize: guardian update failed', {
            id: guardian.id,
            message: guardianUpdateError.message,
          });
          guardians_skipped.push({ guardian_id: guardian.id, reason: 'update_failed' });
          partialFailure = true;
        } else {
          guardians_anonymized.push(guardian.id);
        }
      }
    }
  }

  // ── Audit log ─────────────────────────────────────────────────────────────
  try {
    await logAuditEvent(supabase, {
      orgId: org_id,
      userId: admin.userId,
      userEmail: admin.email,
      userRole: 'system_admin',
      actionType: 'student.pseudonymized',
      actionCategory: 'admin_control',
      resourceType: 'student',
      resourceId: student_id,
      details: {
        original_name: originalName,
        client_profile_id: profile?.id,
        reason,
        guardians_anonymized,
        guardians_skipped,
        partial_failure: partialFailure,
      },
    });
  } catch (auditErr) {
    context.log?.warn?.('system-admin-pseudonymize: audit log failed', {
      message: auditErr?.message,
    });
  }

  return respond(context, 200, {
    student_id,
    status: 'anonymized',
    partial_failure: partialFailure,
    guardians_anonymized,
    guardians_skipped,
  });
}
