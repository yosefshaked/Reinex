/* eslint-env node */
import { normalizeString } from './org-bff.js';
import { resolveLessonCoverageDecision } from './hmo.js';

export async function buildParticipantCoverageById(client, orgId, instances = []) {
  const coverageByParticipantId = new Map();
  const coverageRequests = [];

  for (const instance of Array.isArray(instances) ? instances : []) {
    const serviceId = normalizeString(instance?.service_id);
    if (!serviceId) continue;

    for (const participant of Array.isArray(instance?.participants) ? instance.participants : []) {
      const participantId = normalizeString(participant?.id);
      const studentId = normalizeString(participant?.student_id);
      if (!participantId || !studentId) continue;

      coverageRequests.push({
        participantId,
        studentId,
        serviceId,
        lessonDate: instance?.datetime_start || '',
      });
    }
  }

  await Promise.all(coverageRequests.map(async (request) => {
    try {
      const decision = await resolveLessonCoverageDecision(client, {
        orgId,
        studentId: request.studentId,
        serviceId: request.serviceId,
        lessonDate: request.lessonDate,
        lessonParticipantId: request.participantId,
      });
      const authorization = decision?.authorization || null;
      coverageByParticipantId.set(request.participantId, {
        status: decision?.status || 'standard_uncovered',
        reason: decision?.reason || null,
        authorization_id: decision?.authorization_id || null,
        remaining_authorized_lessons: decision?.remaining_authorized_lessons ?? null,
        covered_customer_charge_amount: decision?.covered_customer_charge_amount ?? null,
        covered_insurer_claim_amount: decision?.covered_insurer_claim_amount ?? null,
        hmo_provider_id: authorization?.provider_id || authorization?.provider?.id || null,
        hmo_provider_name: authorization?.provider?.name || null,
        hmo_provider_track_id: authorization?.provider_track_id || authorization?.provider_track?.id || null,
        hmo_provider_track_name: authorization?.provider_track?.name || null,
      });
    } catch (coverageError) {
      coverageByParticipantId.set(request.participantId, {
        status: 'unknown',
        reason: coverageError?.message || 'failed_to_resolve_hmo_coverage',
        authorization_id: null,
      });
    }
  }));

  return coverageByParticipantId;
}

export async function enrichLessonInstancesWithHmoCoverage(client, orgId, instances = []) {
  const normalizedInstances = Array.isArray(instances) ? instances : [];
  if (normalizedInstances.length === 0) {
    return [];
  }

  const coverageByParticipantId = await buildParticipantCoverageById(client, orgId, normalizedInstances);
  if (coverageByParticipantId.size === 0) {
    return normalizedInstances.map((instance) => ({
      ...instance,
      participants: Array.isArray(instance?.participants)
        ? instance.participants.map((participant) => ({
            ...participant,
            hmo_coverage: participant?.hmo_coverage || null,
          }))
        : [],
    }));
  }

  return normalizedInstances.map((instance) => ({
    ...instance,
    participants: Array.isArray(instance?.participants)
      ? instance.participants.map((participant) => ({
          ...participant,
          hmo_coverage: coverageByParticipantId.get(participant?.id) || participant?.hmo_coverage || null,
        }))
      : [],
  }));
}
