/* eslint-env node */
import { UUID_PATTERN, normalizeString, respond } from './org-bff.js';

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

export async function resolveActorInstructorId(tenantClient, userId) {
  const normalizedUserId = normalizeUuid(userId);
  if (!normalizedUserId) {
    return { instructorId: '', error: null };
  }

  const { data, error } = await tenantClient
    .from('Employees')
    .select('id')
    .eq('user_id', normalizedUserId)
    .limit(1)
    .maybeSingle();

  return {
    instructorId: data?.id || '',
    error,
  };
}

export async function fetchLessonMutationState(tenantClient, options) {
  const instanceId = normalizeUuid(options?.instanceId);
  const participantId = normalizeUuid(options?.participantId);

  const result = {
    instance: null,
    participant: null,
    instanceLocks: [],
    participantLocks: [],
  };

  if (instanceId) {
    const { data: instance, error } = await tenantClient
      .from('lesson_instances')
      .select('id, instructor_employee_id, service_id, status, is_closed, version, metadata')
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

    const { data: instanceLocks, error: instanceLocksError } = await tenantClient
      .from('instance_locks')
      .select('id, lock_source_type, lock_source_id, lock_reason, created_at, metadata')
      .eq('lesson_instance_id', instanceId)
      .order('created_at', { ascending: false });

    if (instanceLocksError) {
      return { error: instanceLocksError, result };
    }

    result.instanceLocks = Array.isArray(instanceLocks) ? instanceLocks : [];
  }

  if (participantId) {
    const { data: participant, error } = await tenantClient
      .from('lesson_participants')
      .select('id, lesson_instance_id, student_id, participant_status, version, locked_at, updated_by, metadata')
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

    const { data: participantLocks, error: participantLocksError } = await tenantClient
      .from('participant_locks')
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
  const lockScope = options?.participantLocks?.length ? 'participant' : 'instance';
  const locks = [
    ...(Array.isArray(options?.participantLocks) ? options.participantLocks : []),
    ...(Array.isArray(options?.instanceLocks) ? options.instanceLocks : []),
  ];
  if (locks.length === 0 && options?.closed) {
    locks.push({
      id: null,
      lock_source_type: 'workflow_closed',
      lock_source_id: null,
      lock_reason: 'lesson_instance_closed',
      metadata: {
        workflow_closed: true,
      },
    });
  }

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
  return Boolean(
    state?.instance?.is_closed
      || state?.instanceLocks?.length
      || state?.participantLocks?.length
      || state?.participant?.locked_at
  );
}
