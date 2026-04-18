/* eslint-env node */
import { randomUUID } from 'node:crypto';
import { UUID_PATTERN, normalizeString } from './org-bff.js';
import {
  coerceEmail,
  coerceIdentityNumber,
  coerceNotificationMethod,
  coerceOptionalDate,
  coerceTags,
  validateIsraeliPhone,
} from './student-validation.js';

function nowIso() {
  return new Date().toISOString();
}

function splitContactName(value) {
  const normalized = normalizeString(value);
  if (!normalized) return { firstName: '', lastName: '' };
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || normalized, lastName: '' };
  return { firstName: parts.shift() || normalized, lastName: parts.join(' ') };
}

function normalizeProfilePayload(payload = {}) {
  const rawOrgId = normalizeString(payload.org_id ?? payload.orgId);
  const orgId = rawOrgId && UUID_PATTERN.test(rawOrgId) ? rawOrgId : '';
  const firstName = normalizeString(payload.first_name ?? payload.firstName ?? payload.student_first_name ?? payload.studentFirstName);
  const middleName = normalizeString(payload.middle_name ?? payload.middleName);
  const lastName = normalizeString(payload.last_name ?? payload.lastName ?? payload.student_last_name ?? payload.studentLastName);
  const identityResult = coerceIdentityNumber(payload.identity_number ?? payload.identityNumber);
  const phoneResult = validateIsraeliPhone(payload.phone);
  const emailResult = coerceEmail(payload.email);
  const dateOfBirthResult = coerceOptionalDate(payload.date_of_birth ?? payload.dateOfBirth);
  const notificationMethodResult = coerceNotificationMethod(payload.default_notification_method ?? payload.defaultNotificationMethod ?? payload.delivery_method ?? payload.deliveryMethod);
  const tagsResult = coerceTags(payload.tags);
  const metadataResult = typeof payload.metadata === 'object' && payload.metadata !== null && !Array.isArray(payload.metadata)
    ? { value: payload.metadata, valid: true }
    : payload.metadata == null
      ? { value: null, valid: true }
      : { value: null, valid: false };
  const onboardingStatus = normalizeString(payload.onboarding_status ?? payload.onboardingStatus) || 'not_started';
  const isActive = typeof payload.is_active === 'boolean'
    ? payload.is_active
    : typeof payload.isActive === 'boolean'
      ? payload.isActive
      : true;

  return {
    valid: Boolean(
      firstName
      && lastName
      && identityResult.valid
      && phoneResult.valid
      && emailResult.valid
      && dateOfBirthResult.valid
      && notificationMethodResult.valid
      && tagsResult.valid
      && metadataResult.valid
      && (!rawOrgId || Boolean(orgId))
    ),
    payload: {
      org_id: orgId || null,
      first_name: firstName,
      middle_name: middleName || null,
      last_name: lastName,
      identity_number: identityResult.value,
      phone: phoneResult.value,
      email: emailResult.value,
      date_of_birth: dateOfBirthResult.value,
      default_notification_method: notificationMethodResult.value || 'whatsapp',
      tags: tagsResult.value,
      onboarding_status: onboardingStatus,
      is_active: isActive,
      metadata: metadataResult.value,
    },
  };
}

export async function findClientProfileByIdentityNumber(tenantClient, identityNumber, { excludeId, orgId } = {}) {
  const normalizedOrgId = normalizeString(orgId);
  const normalized = coerceIdentityNumber(identityNumber);
  if (!normalized.valid || !normalized.value) {
    return { data: null, error: null };
  }

  let query = tenantClient
    .from('client_profiles')
    .select('*')
    .eq('identity_number', normalized.value)
    .limit(1);

  if (normalizedOrgId && UUID_PATTERN.test(normalizedOrgId)) {
    query = query.eq('org_id', normalizedOrgId);
  }

  if (excludeId) {
    query = query.neq('id', excludeId);
  }

  const { data, error } = await query.maybeSingle();
  return { data, error };
}

export async function findClientProfileById(tenantClient, clientProfileId) {
  if (!UUID_PATTERN.test(String(clientProfileId || ''))) {
    return { data: null, error: null };
  }
  const { data, error } = await tenantClient
    .from('client_profiles')
    .select('*')
    .eq('id', clientProfileId)
    .maybeSingle();
  return { data, error };
}

export async function createOrReuseClientProfile(tenantClient, payload = {}) {
  const normalized = normalizeProfilePayload(payload);
  if (!normalized.valid) {
    throw new Error('invalid_client_profile_payload');
  }

  const orgId = normalizeString(normalized.payload.org_id);

  const identityNumber = normalized.payload.identity_number;
  if (identityNumber) {
    const { data: existingProfile, error } = await findClientProfileByIdentityNumber(tenantClient, identityNumber, { orgId });
    if (error) throw new Error(`failed_to_lookup_client_profile:${error.message}`);

    if (existingProfile) {
      const safeUpdates = {};
      if (!normalizeString(existingProfile.phone) && normalized.payload.phone) safeUpdates.phone = normalized.payload.phone;
      if (!normalizeString(existingProfile.email) && normalized.payload.email) safeUpdates.email = normalized.payload.email;
      if (!Array.isArray(existingProfile.tags) && normalized.payload.tags) safeUpdates.tags = normalized.payload.tags;
      if (!normalizeString(existingProfile.onboarding_status) && normalized.payload.onboarding_status) {
        safeUpdates.onboarding_status = normalized.payload.onboarding_status;
      }
      if (Object.keys(safeUpdates).length) {
        safeUpdates.updated_at = nowIso();
        let updateQuery = tenantClient
          .from('client_profiles')
          .update(safeUpdates)
          .eq('id', existingProfile.id);
        if (orgId && UUID_PATTERN.test(orgId)) {
          updateQuery = updateQuery.eq('org_id', orgId);
        }
        const { data: updatedProfile, error: updateError } = await updateQuery.select('*').single();
        if (updateError || !updatedProfile?.id) {
          throw new Error(`failed_to_update_client_profile:${updateError?.message || 'unknown_error'}`);
        }
        return {
          clientProfileId: updatedProfile.id,
          action: 'updated_existing',
          beforeState: existingProfile,
          afterState: updatedProfile,
        };
      }

      return {
        clientProfileId: existingProfile.id,
        action: 'reused_existing',
        beforeState: existingProfile,
        afterState: existingProfile,
      };
    }
  }

  const { data, error } = await tenantClient
    .from('client_profiles')
    .insert({
      ...normalized.payload,
      org_id: orgId || undefined,
      created_at: nowIso(),
      updated_at: nowIso(),
    })
    .select('*')
    .single();

  if (error || !data?.id) {
    throw new Error(`failed_to_create_client_profile:${error?.message || 'unknown_error'}`);
  }

  return {
    clientProfileId: data.id,
    action: 'created',
    beforeState: null,
    afterState: data,
  };
}

export async function createOrReuseGuardian(tenantClient, { contactName, phone, email }) {
  const normalizedContactName = normalizeString(contactName);
  if (!normalizedContactName) return null;

  const { firstName, lastName } = splitContactName(normalizedContactName);
  const normalizedPhone = validateIsraeliPhone(phone);
  const normalizedEmail = coerceEmail(email);

  let existingGuardian = null;

  if (normalizedPhone.valid && normalizedPhone.value) {
    const { data, error } = await tenantClient
      .from('guardians')
      .select('id, first_name, last_name, phone, email')
      .eq('phone', normalizedPhone.value)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`failed_to_lookup_guardian:${error.message}`);
    existingGuardian = data || null;
  }

  if (!existingGuardian && normalizedEmail.valid && normalizedEmail.value) {
    const { data, error } = await tenantClient
      .from('guardians')
      .select('id, first_name, last_name, phone, email')
      .eq('email', normalizedEmail.value)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`failed_to_lookup_guardian:${error.message}`);
    existingGuardian = data || null;
  }

  if (existingGuardian?.id) {
    const updates = {};
    if (!normalizeString(existingGuardian.phone) && normalizedPhone.value) updates.phone = normalizedPhone.value;
    if (!normalizeString(existingGuardian.email) && normalizedEmail.value) updates.email = normalizedEmail.value;

    if (Object.keys(updates).length) {
      const { data: updatedGuardian, error } = await tenantClient
        .from('guardians')
        .update(updates)
        .eq('id', existingGuardian.id)
        .select('id, first_name, last_name, phone, email')
        .single();
      if (error || !updatedGuardian?.id) throw new Error(`failed_to_update_guardian:${error?.message || 'unknown_error'}`);
      return {
        guardianId: updatedGuardian.id,
        action: 'updated_existing',
        beforeState: existingGuardian,
        afterState: updatedGuardian,
      };
    }

    return {
      guardianId: existingGuardian.id,
      action: 'reused_existing',
      beforeState: existingGuardian,
      afterState: existingGuardian,
    };
  }

  const { data, error } = await tenantClient
    .from('guardians')
    .insert({
      first_name: firstName || normalizedContactName,
      last_name: lastName || null,
      phone: normalizedPhone.value || null,
      email: normalizedEmail.value || null,
    })
    .select('id, first_name, last_name, phone, email')
    .single();

  if (error || !data?.id) {
    throw new Error(`failed_to_create_guardian:${error?.message || 'unknown_error'}`);
  }

  return {
    guardianId: data.id,
    action: 'created',
    beforeState: null,
    afterState: data,
  };
}

export async function upsertClientGuardianLink(tenantClient, { orgId, clientProfileId, guardianId, relationship }) {
  if (!UUID_PATTERN.test(String(orgId || '')) || !UUID_PATTERN.test(String(clientProfileId || '')) || !UUID_PATTERN.test(String(guardianId || ''))) return;
  const { error } = await tenantClient
    .from('client_guardians')
    .upsert({
      org_id: orgId,
      client_profile_id: clientProfileId,
      guardian_id: guardianId,
      relationship,
      is_primary: true,
    }, { onConflict: 'org_id,client_profile_id,guardian_id' });

  if (error) throw new Error(`failed_to_link_guardian:${error.message}`);
}

export async function fetchPrimaryGuardianForClientProfile(tenantClient, clientProfileId) {
  if (!UUID_PATTERN.test(String(clientProfileId || ''))) return { guardian: null, error: null };

  const { data, error } = await tenantClient
    .from('client_guardians')
    .select('guardian_id, relationship, is_primary')
    .eq('client_profile_id', clientProfileId)
    .order('is_primary', { ascending: false })
    .limit(1);

  if (error) return { guardian: null, error };
  if (!data || !data.length) return { guardian: null, error: null };

  const link = data[0];
  const { data: guardianRow, error: guardianError } = await tenantClient
    .from('guardians')
    .select('id, first_name, middle_name, last_name, phone, email')
    .eq('id', link.guardian_id)
    .maybeSingle();

  if (guardianError) return { guardian: null, error: guardianError };
  if (!guardianRow) return { guardian: null, error: null };

  return {
    guardian: {
      id: guardianRow.id,
      first_name: guardianRow.first_name,
      middle_name: guardianRow.middle_name || null,
      last_name: guardianRow.last_name,
      phone: guardianRow.phone || null,
      email: guardianRow.email || null,
      relationship: link.relationship,
      is_primary: link.is_primary ?? true,
    },
    error: null,
  };
}

export async function resolveClientProfileDestination(tenantClient, clientProfileId, deliveryMethod) {
  const { data: clientProfile, error } = await findClientProfileById(tenantClient, clientProfileId);
  if (error) throw error;
  if (!clientProfile) return '';

  const { guardian } = await fetchPrimaryGuardianForClientProfile(tenantClient, clientProfileId);
  if (String(deliveryMethod || '').trim().toLowerCase() === 'email') {
    return normalizeString(clientProfile.email) || normalizeString(guardian?.email) || '';
  }

  return normalizeString(clientProfile.phone) || normalizeString(guardian?.phone) || '';
}

export async function ensureStudentForClientProfile(tenantClient, clientProfileId, {
  medicalProvider = null,
  notesInternal = null,
  specialRate = null,
  medicalFlags = null,
  metadata = null,
} = {}) {
  if (!UUID_PATTERN.test(String(clientProfileId || ''))) {
    return { student: null, created: false, error: 'invalid_client_profile_id' };
  }

  const { data: existingStudent, error: existingStudentError } = await tenantClient
    .from('students')
    .select('*')
    .eq('client_profile_id', clientProfileId)
    .limit(1)
    .maybeSingle();

  if (existingStudentError) {
    throw existingStudentError;
  }
  if (existingStudent) {
    return { student: existingStudent, created: false, error: null };
  }

  const { data: profile, error: profileError } = await tenantClient
    .from('client_profiles')
    .select('*')
    .eq('id', clientProfileId)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }
  if (!profile) {
    return { student: null, created: false, error: 'client_profile_not_found' };
  }

  const createdAt = nowIso();
  const { data: createdStudent, error: createError } = await tenantClient
    .from('students')
    .insert({
      client_profile_id: clientProfileId,
      medical_provider: medicalProvider,
      notes_internal: notesInternal,
      special_rate: specialRate,
      medical_flags: medicalFlags,
      metadata: metadata,
      created_at: createdAt,
      updated_at: createdAt,
    })
    .select('*')
    .single();

  if (createError || !createdStudent?.id) {
    throw createError || new Error('failed_to_create_student');
  }

  await Promise.all([
    tenantClient.from('form_submissions').update({ student_id: createdStudent.id }).eq('client_profile_id', clientProfileId).is('student_id', null),
    tenantClient.from('otp_challenges').update({ student_id: createdStudent.id }).eq('client_profile_id', clientProfileId).is('student_id', null),
    tenantClient.from('waiting_list_entries').update({ student_id: createdStudent.id }).eq('client_profile_id', clientProfileId).is('student_id', null),
    tenantClient.from('lesson_participants').update({ student_id: createdStudent.id }).eq('client_profile_id', clientProfileId).is('student_id', null),
  ]);

  const { data: refreshedStudent } = await tenantClient
    .from('students')
    .select('*')
    .eq('id', createdStudent.id)
    .maybeSingle();

  return { student: refreshedStudent || createdStudent, created: true, error: null };
}

export function buildClientProfileDisplayName(row) {
  return [row?.first_name, row?.middle_name, row?.last_name].filter(Boolean).join(' ').trim() || 'ללא שם';
}

export function buildClientProfileMetadataPatch(metadata = {}, patch = {}) {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  return {
    ...base,
    ...patch,
  };
}

export function buildClientProfileReference(row = {}) {
  return {
    id: row.id || randomUUID(),
    client_profile_id: row.id || null,
    first_name: row.first_name || '',
    middle_name: row.middle_name || null,
    last_name: row.last_name || '',
    full_name: buildClientProfileDisplayName(row),
    identity_number: row.identity_number || null,
    phone: row.phone || null,
    email: row.email || null,
    date_of_birth: row.date_of_birth || null,
    default_notification_method: row.default_notification_method || 'whatsapp',
    tags: Array.isArray(row.tags) ? row.tags : [],
    onboarding_status: row.onboarding_status || 'not_started',
    is_active: row.is_active !== false,
    metadata: row.metadata || null,
  };
}
