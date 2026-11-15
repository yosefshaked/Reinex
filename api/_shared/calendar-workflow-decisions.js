/* eslint-env node */
import { normalizeString } from './org-bff.js';

const RESOLVED_PARTICIPANT_STATUSES = new Set(['attended', 'no_show', 'cancelled_student', 'cancelled_clinic']);

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeWorkflowDecision(value, fallback = 'unknown') {
  const normalized = normalizeString(value).toLowerCase();
  if (['unknown', 'not_applicable', 'pending', 'resolved', 'compensated', 'not_compensated', 'required', 'not_required'].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

export function readParticipantWorkflowMetadata(metadata) {
  const root = isPlainObject(metadata) ? metadata : {};
  const workflow = isPlainObject(root.workflow) ? root.workflow : {};
  const studentBilling = isPlainObject(workflow.student_billing) ? workflow.student_billing : {};
  const instructorCompensation = isPlainObject(workflow.instructor_compensation) ? workflow.instructor_compensation : {};
  const hmoClaim = isPlainObject(workflow.hmo_claim) ? workflow.hmo_claim : {};

  return {
    root,
    student_billing: {
      decision: normalizeWorkflowDecision(studentBilling.decision, 'unknown'),
      decided_at: studentBilling.decided_at || null,
      decided_by: studentBilling.decided_by || null,
      reason: normalizeString(studentBilling.reason) || null,
    },
    instructor_compensation: {
      decision: normalizeWorkflowDecision(instructorCompensation.decision, 'unknown'),
      decided_at: instructorCompensation.decided_at || null,
      decided_by: instructorCompensation.decided_by || null,
      reason: normalizeString(instructorCompensation.reason) || null,
    },
    hmo_claim: {
      decision: normalizeWorkflowDecision(hmoClaim.decision, 'unknown'),
      decided_at: hmoClaim.decided_at || null,
      decided_by: hmoClaim.decided_by || null,
      reason: normalizeString(hmoClaim.reason) || null,
    },
  };
}

/**
 * The pay decision written on a participant when someone marks the outcome.
 *
 * It is stored as an explicit 'compensated' / 'not_compensated', never left to the org policy, so a
 * later change of the policy does not change what past lessons paid. An attended participant always
 * pays; a choice made in the absence form wins; otherwise the policy in force at the mark decides.
 * `instructorEarningsApplies` is that policy for the status (null when it was not read, which keeps
 * the old 'unknown' and with it the live policy).
 *
 * A re-mark that keeps the status (a notes edit, a re-confirm) and carries no explicit choice keeps
 * the decision already stored (`previous.decision`), so a policy changed since the first mark does
 * not rewrite what that lesson paid. A changed status is a new outcome and is decided afresh.
 */
export function resolveMarkedInstructorCompensationDecision(
  participantStatus,
  requestedDecision,
  instructorEarningsApplies = null,
  previous = null,
) {
  const status = normalizeString(participantStatus).toLowerCase();
  if (!RESOLVED_PARTICIPANT_STATUSES.has(status)) {
    return 'unknown';
  }
  if (status === 'attended') {
    return 'compensated';
  }
  const requested = normalizeWorkflowDecision(requestedDecision, 'unknown');
  if (requested === 'compensated' || requested === 'not_compensated') {
    return requested;
  }
  const kept = readKeptInstructorCompensationDecision(status, previous);
  if (kept) {
    return kept;
  }
  if (typeof instructorEarningsApplies === 'boolean') {
    return instructorEarningsApplies ? 'compensated' : 'not_compensated';
  }
  return 'unknown';
}

function readKeptInstructorCompensationDecision(status, previous) {
  const previousStatus = normalizeString(previous?.status).toLowerCase();
  const previousDecision = normalizeWorkflowDecision(previous?.decision, 'unknown');
  if (previousStatus !== status) return null;
  return previousDecision === 'compensated' || previousDecision === 'not_compensated' ? previousDecision : null;
}

/**
 * Whether a mark leaves the stored pay decision as it is (see resolveMarkedInstructorCompensationDecision):
 * same resolved non-attended status, no explicit choice in the request, and an explicit decision on file.
 * The endpoint then also keeps when and by whom it was decided.
 */
export function isStoredInstructorCompensationDecisionKept(participantStatus, requestedDecision, previous = null) {
  const status = normalizeString(participantStatus).toLowerCase();
  if (!RESOLVED_PARTICIPANT_STATUSES.has(status) || status === 'attended') return false;
  const requested = normalizeWorkflowDecision(requestedDecision, 'unknown');
  if (requested === 'compensated' || requested === 'not_compensated') return false;
  return Boolean(readKeptInstructorCompensationDecision(status, previous));
}

/**
 * The previous status and pay decision of a participant row, in the shape the two functions above take.
 */
export function readPreviousInstructorCompensation(participant) {
  const stored = readParticipantWorkflowMetadata(participant?.metadata).instructor_compensation;
  return {
    status: normalizeString(participant?.participant_status).toLowerCase() || null,
    decision: stored.decision,
    decided_at: stored.decided_at,
    decided_by: stored.decided_by,
  };
}

export function shouldParticipantTriggerInstructorCompensation(participant, policies) {
  const status = normalizeString(participant?.participant_status).toLowerCase();
  const workflow = readParticipantWorkflowMetadata(participant?.metadata);
  const explicitDecision = workflow.instructor_compensation.decision;

  if (!RESOLVED_PARTICIPANT_STATUSES.has(status)) {
    return false;
  }
  if (explicitDecision === 'compensated') {
    return true;
  }
  if (explicitDecision === 'not_compensated' || explicitDecision === 'not_applicable') {
    return false;
  }
  return Boolean(policies?.instructorEarningsPolicy?.[status]);
}
