/* eslint-env node */
import { UUID_PATTERN, normalizeString, respond, withOrgScope } from './org-bff.js';

export function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '';
  }
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

export function parseExpectedVersion(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') {
      continue;
    }
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

export function normalizeEntityVersion(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function usesLegacyNullVersion(value) {
  return value === null || value === undefined || value === '';
}

function requireOrgId(orgId, helperName) {
  const normalized = normalizeString(orgId);
  if (!normalized) {
    throw new Error(`${helperName} needs the organisation id`);
  }
  return normalized;
}

/**
 * The signed-in user's employee row in this organisation. The same person can be an instructor in
 * several organisations, each with its own row, so the lookup is by user and organisation.
 */
export async function resolveActorInstructorId(tenantClient, orgId, userId) {
  const scopedOrgId = requireOrgId(orgId, 'resolveActorInstructorId');
  const normalizedUserId = normalizeUuid(userId);
  if (!normalizedUserId) {
    return { instructorId: '', error: null };
  }

  const { data, error } = await withOrgScope(tenantClient, 'Employees', scopedOrgId)
    .select('id')
    .eq('user_id', normalizedUserId)
    .limit(1)
    .maybeSingle();

  return {
    instructorId: data?.id || '',
    error,
  };
}

/** A lesson and its locks before a change, read in this organisation only (another org's id is not found). */
export async function fetchLessonMutationState(tenantClient, orgId, options) {
  const scopedOrgId = requireOrgId(orgId, 'fetchLessonMutationState');
  const instanceId = normalizeUuid(options?.instanceId);
  const participantId = normalizeUuid(options?.participantId);

  const result = {
    instance: null,
    participant: null,
    instanceLocks: [],
    participantLocks: [],
  };

  if (instanceId) {
    const { data: instance, error } = await withOrgScope(tenantClient, 'lesson_instances', scopedOrgId)
      .select('id, datetime_start, duration_minutes, instructor_employee_id, service_id, status, documentation_status, is_closed, version, metadata')
      .eq('id', instanceId)
      .maybeSingle();

    if (error) {
      return { error, result };
    }

    result.instance = instance
      ? {
          ...instance,
          version: normalizeEntityVersion(instance.version),
          legacy_null_version: usesLegacyNullVersion(instance.version),
        }
      : null;

    const { data: instanceLocks, error: instanceLocksError } = await withOrgScope(tenantClient, 'instance_locks', scopedOrgId)
      .select('id, lock_source_type, lock_source_id, lock_reason, created_at, metadata')
      .eq('lesson_instance_id', instanceId)
      .order('created_at', { ascending: false });

    if (instanceLocksError) {
      return { error: instanceLocksError, result };
    }

    result.instanceLocks = Array.isArray(instanceLocks) ? instanceLocks : [];
  }

  if (participantId) {
    const { data: participant, error } = await withOrgScope(tenantClient, 'lesson_participants', scopedOrgId)
      .select('id, lesson_instance_id, client_profile_id, student_id, participant_status, version, locked_at, updated_by, metadata')
      .eq('id', participantId)
      .maybeSingle();

    if (error) {
      return { error, result };
    }

    result.participant = participant
      ? {
          ...participant,
          version: normalizeEntityVersion(participant.version),
          legacy_null_version: usesLegacyNullVersion(participant.version),
        }
      : null;

    const { data: participantLocks, error: participantLocksError } = await withOrgScope(tenantClient, 'participant_locks', scopedOrgId)
      .select('id, lock_source_type, lock_source_id, lock_reason, created_at, metadata')
      .eq('lesson_participant_id', participantId)
      .order('created_at', { ascending: false });

    if (participantLocksError) {
      return { error: participantLocksError, result };
    }

    result.participantLocks = Array.isArray(participantLocks) ? participantLocks : [];
  }

  return { error: null, result };
}

export function respondWithLockedMutation(context, options) {
  const locks = [
    ...(Array.isArray(options?.participantLocks) ? options.participantLocks : []),
    ...(Array.isArray(options?.instanceLocks) ? options.instanceLocks : []),
  ];
  const lockScope = Array.isArray(options?.participantLocks) && options.participantLocks.length > 0
    ? 'participant'
    : 'instance';

  return respond(context, 423, {
    message: lockScope === 'participant' ? 'lesson_participant_locked' : 'lesson_instance_locked',
    code: lockScope === 'participant' ? 'lesson_participant_locked' : 'lesson_instance_locked',
    lock_scope: lockScope,
    lesson_instance_id: options?.instanceId || null,
    participant_id: options?.participantId || null,
    locks,
  });
}

export function respondWithVersionConflict(context, options) {
  return respond(context, 409, {
    message: 'version_conflict',
    code: 'version_conflict',
    resource_type: options?.resourceType || 'lesson_instance',
    resource_id: options?.resourceId || null,
    expected_version: options?.expectedVersion ?? null,
    current_version: options?.currentVersion ?? null,
  });
}

export function isLockedState(state) {
  const isFinanceLock = (lock) => normalizeString(lock?.lock_source_type) === 'claim_batch';
  const hasInstanceFinanceLocks = Array.isArray(state?.instanceLocks) && state.instanceLocks.some(isFinanceLock);
  const hasParticipantFinanceLocks = Array.isArray(state?.participantLocks) && state.participantLocks.some(isFinanceLock);
  return Boolean(
    hasInstanceFinanceLocks
      || hasParticipantFinanceLocks
  );
}
