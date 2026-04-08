import { normalizeString } from './org-bff.js';

export const ACTIVE_LESSON_INSTANCE_STATUSES = new Set(['scheduled', 'completed', 'cancelled']);

export function normalizeLessonInstanceStatus(status) {
  const normalized = normalizeString(status).toLowerCase();
  if (
    normalized === 'cancelled_student'
    || normalized === 'cancelled_clinic'
    || normalized === 'no_show'
  ) {
    return 'cancelled';
  }
  return normalized;
}

function normalizeAttendedParticipants(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((participant) => ({
      id: normalizeString(participant?.id),
      name: normalizeString(participant?.name) || 'לקוח/ה',
    }))
    .filter((participant) => participant.id);
}

function normalizeParticipantAuditRows(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((row) => (row && typeof row === 'object' ? row : null))
    .filter(Boolean);
}

function normalizeBlockingParticipants(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((participant) => ({
      id: normalizeString(participant?.id),
      name: normalizeString(participant?.name) || 'לקוח/ה',
      participant_status: normalizeString(participant?.participant_status).toLowerCase() || 'scheduled',
    }))
    .filter((participant) => participant.id);
}

export async function completeLessonInstanceWithParticipants(tenantClient, {
  instanceId,
  userId,
  expectedVersion = null,
  documentationStatus = null,
}) {
  const { data, error } = await tenantClient.rpc('complete_lesson_instance_with_participants', {
    p_instance_id: instanceId,
    p_actor_user_id: userId,
    p_expected_version: Number.isInteger(Number(expectedVersion)) ? Number(expectedVersion) : null,
    p_documentation_status: normalizeString(documentationStatus) || null,
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    outcome: normalizeString(row?.outcome),
    instanceVersion: Number.isInteger(Number(row?.instance_version)) ? Number(row.instance_version) : null,
    instanceMetadata: row?.instance_metadata && typeof row.instance_metadata === 'object'
      ? row.instance_metadata
      : {},
    promotedParticipantIds: Array.isArray(row?.promoted_participant_ids)
      ? row.promoted_participant_ids.filter(Boolean)
      : [],
    promotedParticipantAuditRows: normalizeParticipantAuditRows(row?.promoted_participant_audit_rows),
    instanceBeforeState: row?.instance_before_state && typeof row.instance_before_state === 'object'
      ? row.instance_before_state
      : null,
    instanceAfterState: row?.instance_after_state && typeof row.instance_after_state === 'object'
      ? row.instance_after_state
      : null,
  };
}

export async function cancelLessonInstanceWithParticipants(tenantClient, {
  instanceId,
  userId,
  expectedVersion = null,
  documentationStatus = null,
}) {
  const { data, error } = await tenantClient.rpc('cancel_lesson_instance_with_participants', {
    p_instance_id: instanceId,
    p_actor_user_id: userId,
    p_expected_version: Number.isInteger(Number(expectedVersion)) ? Number(expectedVersion) : null,
    p_documentation_status: normalizeString(documentationStatus) || null,
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    outcome: normalizeString(row?.outcome),
    instanceVersion: Number.isInteger(Number(row?.instance_version)) ? Number(row.instance_version) : null,
    instanceMetadata: row?.instance_metadata && typeof row.instance_metadata === 'object'
      ? row.instance_metadata
      : {},
    cancelledParticipantIds: Array.isArray(row?.cancelled_participant_ids)
      ? row.cancelled_participant_ids.filter(Boolean)
      : [],
    attendedParticipants: normalizeAttendedParticipants(row?.attended_participants),
    cancelledParticipantAuditRows: normalizeParticipantAuditRows(row?.cancelled_participant_audit_rows),
    instanceBeforeState: row?.instance_before_state && typeof row.instance_before_state === 'object'
      ? row.instance_before_state
      : null,
    instanceAfterState: row?.instance_after_state && typeof row.instance_after_state === 'object'
      ? row.instance_after_state
      : null,
  };
}

export async function cancelSelectedScheduledParticipantsAndReconcileInstance(tenantClient, {
  instanceId,
  participantIds,
  userId,
}) {
  const { data, error } = await tenantClient.rpc('cancel_selected_scheduled_participants_and_reconcile_instance', {
    p_instance_id: instanceId,
    p_participant_ids: Array.isArray(participantIds) ? participantIds.filter(Boolean) : [],
    p_actor_user_id: userId,
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    outcome: normalizeString(row?.outcome),
    instanceVersion: Number.isInteger(Number(row?.instance_version)) ? Number(row.instance_version) : null,
    instanceStatus: normalizeLessonInstanceStatus(row?.instance_status),
    instanceMetadata: row?.instance_metadata && typeof row.instance_metadata === 'object'
      ? row.instance_metadata
      : {},
    cancelledParticipantIds: Array.isArray(row?.cancelled_participant_ids)
      ? row.cancelled_participant_ids.filter(Boolean)
      : [],
    cancelledParticipantAuditRows: normalizeParticipantAuditRows(row?.cancelled_participant_audit_rows),
    blockingParticipants: normalizeBlockingParticipants(row?.blocking_participants),
    instanceBeforeState: row?.instance_before_state && typeof row.instance_before_state === 'object'
      ? row.instance_before_state
      : null,
    instanceAfterState: row?.instance_after_state && typeof row.instance_after_state === 'object'
      ? row.instance_after_state
      : null,
  };
}

export async function listAttendedParticipantsForCancelledInstance(tenantClient, instanceId) {
  const { data, error } = await tenantClient
    .from('lesson_participants')
    .select(`
      id,
      participant_status,
      client_profile:client_profiles(first_name, middle_name, last_name),
      student:students(
        client_profile:client_profiles(first_name, middle_name, last_name)
      )
    `)
    .eq('lesson_instance_id', instanceId)
    .eq('participant_status', 'attended');

  if (error) {
    throw error;
  }

  return normalizeAttendedParticipants((data || []).map((participant) => {
    const profile = participant?.client_profile || participant?.student?.client_profile || null;
    const name = [profile?.first_name, profile?.middle_name, profile?.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();

    return {
      id: participant.id,
      name: name || 'לקוח/ה',
    };
  }));
}
