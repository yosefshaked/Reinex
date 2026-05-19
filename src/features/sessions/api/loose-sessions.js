import { authenticatedFetch } from '@/lib/api-client.js';
import { isSessionRecordsEnabled } from '@/features/sessions/config/session-records.js';

export async function fetchLooseSessions({ orgId, view, signal } = {}) {
  if (!isSessionRecordsEnabled()) {
    return [];
  }
  const params = new URLSearchParams();
  if (orgId) params.set('org_id', orgId);
  if (view) params.set('view', view); // 'mine' or 'pending'
  
  const endpoint = params.toString() ? `loose-sessions?${params}` : 'loose-sessions';
  return authenticatedFetch(endpoint, { signal });
}

export async function assignLooseSession({ sessionId, studentId, orgId, signal } = {}) {
  if (!isSessionRecordsEnabled()) {
    throw new Error('session_records_disabled');
  }
  const body = {
    action: 'assign_existing',
    session_id: sessionId,
    student_id: studentId,
    org_id: orgId,
  };
  
  return authenticatedFetch('loose-sessions', {
    method: 'POST',
    body,
    signal,
  });
}

export async function createAndAssignLooseSession({
  sessionId,
  name,
  assignedInstructorId,
  identityNumber,
  defaultService,
  orgId,
  signal,
} = {}) {
  if (!isSessionRecordsEnabled()) {
    throw new Error('session_records_disabled');
  }
  const body = {
    action: 'create_and_assign',
    session_id: sessionId,
    name,
    identity_number: identityNumber,
    assigned_instructor_id: assignedInstructorId,
    ...(defaultService ? { default_service: defaultService } : {}),
    org_id: orgId,
  };
  
  return authenticatedFetch('loose-sessions', {
    method: 'POST',
    body,
    signal,
  });
}

export async function rejectLooseSession({ sessionId, rejectReason, orgId, signal } = {}) {
  if (!isSessionRecordsEnabled()) {
    throw new Error('session_records_disabled');
  }
  const body = {
    action: 'reject',
    session_id: sessionId,
    reject_reason: rejectReason,
    org_id: orgId,
  };
  
  return authenticatedFetch('loose-sessions', {
    method: 'POST',
    body,
    signal,
  });
}
