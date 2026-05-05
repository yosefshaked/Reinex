import { authenticatedFetch } from '@/lib/api-client.js';
import { toAgorot, toShekel } from '@/lib/currency.js';
import { normalizeTagIdsForWrite } from '@/features/students/utils/tags.js';

function normalizeSpecialRate(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  return toAgorot(value);
}

export function buildStudentUpdateBody(payload, orgId, overrides = {}) {
  return {
    org_id: orgId,
    firstName: payload.firstName,
    middleName: payload.middleName,
    lastName: payload.lastName,
    identityNumber: payload.identityNumber,
    dateOfBirth: payload.dateOfBirth,
    phone: payload.phone,
    email: payload.email,
    medicalProvider: payload.medicalProvider,
    notificationMethod: payload.notificationMethod,
    specialRate: normalizeSpecialRate(payload.specialRate),
    notesInternal: payload.notesInternal,
    tags: normalizeTagIdsForWrite(payload.tags),
    isActive: payload.isActive,
    guardianId: payload.guardianId,
    guardianRelationship: payload.guardianRelationship,
    ...overrides,
  };
}

export async function updateStudentFromForm(payload, { orgId, session, overrides = {} } = {}) {
  if (!payload?.id || !orgId) {
    throw new Error('missing_student_update_context');
  }

  return authenticatedFetch(`students-list/${payload.id}`, {
    method: 'PUT',
    body: buildStudentUpdateBody(payload, orgId, overrides),
    session,
  });
}

function buildStudentFormPayloadFromRecord(student, isActive) {
  return {
    id: student.id,
    firstName: student.first_name || '',
    middleName: student.middle_name || null,
    lastName: student.last_name || '',
    identityNumber: student.identity_number || '',
    dateOfBirth: student.date_of_birth || null,
    phone: student.phone || null,
    email: student.email || null,
    medicalProvider: student.medical_provider || null,
    notificationMethod: student.default_notification_method || 'whatsapp',
    specialRate: student.special_rate == null ? null : toShekel(student.special_rate),
    notesInternal: student.notes_internal || null,
    tags: Array.isArray(student.tags) ? student.tags : [],
    isActive,
    guardianId: student.guardian?.id || null,
    guardianRelationship: student.guardian?.relationship || null,
  };
}

export async function updateStudentStatus(student, isActive, { orgId, session } = {}) {
  if (!student?.id || !orgId) {
    throw new Error('missing_student_update_context');
  }

  const updatedStudent = await authenticatedFetch(`students-list/${student.id}`, {
    method: 'PATCH',
    body: {
      org_id: orgId,
      isActive,
    },
    session,
  });

  if (updatedStudent?.is_active !== isActive) {
    throw new Error('student_status_update_not_persisted');
  }

  const verifiedStudent = await fetchStudentById(student.id, { orgId, session });
  if (verifiedStudent?.is_active === isActive) {
    return verifiedStudent;
  }

  await updateStudentFromForm(buildStudentFormPayloadFromRecord(student, isActive), { orgId, session });
  const retriedStudent = await fetchStudentById(student.id, { orgId, session });
  if (retriedStudent?.is_active !== isActive) {
    throw new Error('student_status_update_not_persisted');
  }

  return retriedStudent;
}

export async function fetchStudentById(studentId, { orgId, session } = {}) {
  if (!studentId || !orgId) {
    throw new Error('missing_student_update_context');
  }

  return authenticatedFetch(`students-list/${studentId}`, {
    session,
    params: {
      org_id: orgId,
      _: Date.now(),
    },
  });
}
