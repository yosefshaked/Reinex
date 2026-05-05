import { authenticatedFetch } from '@/lib/api-client.js';
import { toAgorot } from '@/lib/currency.js';
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

export async function updateStudentStatus(student, isActive, { orgId, session } = {}) {
  if (!student?.id || !orgId) {
    throw new Error('missing_student_update_context');
  }

  return authenticatedFetch(`students-list/${student.id}`, {
    method: 'PUT',
    body: {
      org_id: orgId,
      isActive,
    },
    session,
  });
}
