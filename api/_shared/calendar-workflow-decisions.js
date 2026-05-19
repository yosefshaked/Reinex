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
