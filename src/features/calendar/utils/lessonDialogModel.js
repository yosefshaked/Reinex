// Pure helpers for the calendar lesson dialog (LessonInstanceDialog and its sub-components).
// Keep this module free of React and '@/...' path aliases so node:test can import it directly.
import { toShekel } from '../../../lib/currency.js';
import { formatDateDisplay, formatTimeDisplay } from './timeGrid.js';
import { buildSchedulingOverrideReasonDetails } from './schedulingOverride.js';
import { getParticipantDisplayName } from './participantDisplay.js';
import { extractSupportCode, resolveApiErrorMessage, resolveUserErrorMessage, serverPublicMessage } from '../../../lib/error-support.js';
import { dateKeyFromCalendarDate } from '../../../lib/local-time.js';
import { describeLessonStartClockChange } from '../../../lib/clock-change.js';

export const DEFAULT_BILLING_POLICY = {
  attended: true,
  no_show: false,
  cancelled_student: false,
  cancelled_clinic: false,
};

export const DEFAULT_INSTRUCTOR_EARNINGS_POLICY = {
  attended: true,
  no_show: true,
  cancelled_student: false,
  cancelled_clinic: false,
};

export function normalizeInstanceStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'cancelled_student' || normalized === 'cancelled_clinic' || normalized === 'no_show') {
    return 'cancelled';
  }
  return normalized;
}

export function toLocalDateString(dateObj) {
  return dateKeyFromCalendarDate(dateObj);
}

export function toUtcIsoString(dateString, timeString) {
  if (!dateString || !timeString) {
    return null;
  }

  const [year, month, day] = String(dateString).split('-').map(Number);
  const [hours, minutes] = String(timeString).split(':').map(Number);
  const localDate = new Date(year, (month || 1) - 1, day || 1, hours || 0, minutes || 0, 0, 0);

  if (Number.isNaN(localDate.getTime())) {
    return null;
  }

  return localDate.toISOString();
}

/**
 * The clock-change notice for the edit form: only when the date or time was changed, so an
 * existing lesson at a repeated hour does not nag when another field is edited.
 */
export function resolveEditClockChangeNotice(formData, baseline) {
  if (!formData?.date || !formData?.time) return null;
  if (baseline && formData.date === baseline.date && formData.time === baseline.time) return null;
  return describeLessonStartClockChange(formData.date, formData.time);
}

export function buildSchedulingOverrideMetadata(baseMetadata, { enabled, selectedReasonCode, customReason }) {
  const nextMetadata = baseMetadata && typeof baseMetadata === 'object' && !Array.isArray(baseMetadata)
    ? { ...baseMetadata }
    : {};

  if (!enabled) {
    delete nextMetadata.scheduling_override;
    return nextMetadata;
  }

  const { reasonCode, reason } = buildSchedulingOverrideReasonDetails(selectedReasonCode, customReason);
  const existingOverride = nextMetadata.scheduling_override && typeof nextMetadata.scheduling_override === 'object'
    ? nextMetadata.scheduling_override
    : {};

  nextMetadata.scheduling_override = {
    type: 'one_time_exception',
    reason,
    reason_code: reasonCode,
    created_by_ui: true,
    created_at: existingOverride.created_at || new Date().toISOString(),
  };

  return nextMetadata;
}

export function isCancellationStatus(status) {
  return normalizeInstanceStatus(status) === 'cancelled';
}

export function isGraceEligibleStatus(status) {
  return ['no_show', 'cancelled_student', 'cancelled_clinic'].includes(String(status || '').trim().toLowerCase());
}

export function shouldShowGraceWaiver(policy, status) {
  const normalizedStatus = String(status || '').trim().toLowerCase();
  return isGraceEligibleStatus(normalizedStatus) && Boolean(policy?.[normalizedStatus]);
}

export function getCancellationStatusLabel(status) {
  if (normalizeInstanceStatus(status) === 'cancelled') return 'שיעור בוטל';
  return 'ביטול';
}

export function getDisplayInstance(instance) {
  const resolved = instance?.latest_correction?.effective_state?.instance
    ? { ...instance, ...instance.latest_correction.effective_state.instance }
    : instance;
  if (!resolved || typeof resolved !== 'object') {
    return resolved;
  }
  return {
    ...resolved,
    status: normalizeInstanceStatus(resolved.status) || resolved.status,
  };
}

export function getDisplayParticipants(instance) {
  const baseParticipants = Array.isArray(instance?.participants) ? instance.participants : [];
  const effectiveParticipants = Array.isArray(instance?.latest_correction?.effective_state?.participants)
    ? instance.latest_correction.effective_state.participants
    : [];
  const effectiveById = new Map(effectiveParticipants.map((participant) => [participant.id, participant]));
  return baseParticipants.map((participant) => ({
    ...participant,
    ...(effectiveById.get(participant.id) || {}),
  }));
}

/**
 * The "instructor has no rate for this service on this date" refusal from a lesson or template save,
 * as { instructorEmployeeId, serviceId, rateDate, message }, or null for any other error. The form
 * uses it to offer adding the rate there and then. The server's explanation (who, which service, the
 * dates and where to add the rate) is used only when the body carries the user-message marker, like
 * every other server text (docs/project-rules/20, "Showing an error").
 */
export function readMissingLessonRate(error) {
  const data = error?.data;
  if (!data || data.code !== 'instructor_rate_not_configured' || !data.instructor_employee_id || !data.service_id) {
    return null;
  }
  return {
    instructorEmployeeId: String(data.instructor_employee_id),
    serviceId: String(data.service_id),
    rateDate: typeof data.rate_date === 'string' ? data.rate_date : '',
    message: serverPublicMessage(data, error?.status) || 'למדריך/ה אין תעריף על השירות הזה בתאריך הזה.',
  };
}

/**
 * The instructor, service and date a missing-rate notice is about, as one comparable key. The forms
 * show a refusal only while the fields still hold that combination: once the user picks another
 * instructor, service or date the notice (and its "הוספת תעריף") would be for the wrong one.
 *
 * @param {{ instructorId?: unknown, serviceId?: unknown, date?: unknown }} [selection]
 */
export function buildRateSelectionKey({ instructorId, serviceId, date } = {}) {
  return [instructorId, serviceId, date].map((value) => String(value ?? '').trim()).join('|');
}

/**
 * The notice to show for the current fields: the stored one when it was recorded for this same
 * combination (`buildRateSelectionKey`), otherwise null.
 */
export function pickMissingRateForSelection(stored, selectionKey) {
  if (!stored?.missingRate) return null;
  return stored.selectionKey === selectionKey ? stored.missingRate : null;
}

/**
 * The dialog's message for a failed request. `fallback` is the wording for this action; it can also
 * travel on the error itself (withErrorContext), so the display and the support copy agree.
 */
export function resolveMutationError(error, fallback = '') {
  const supportMessage = resolveApiErrorMessage(error);
  if (extractSupportCode(supportMessage)) {
    return supportMessage;
  }
  if (supportMessage === 'capacity_exceeded') {
    const maxCapacity = Number(error?.data?.max_capacity) || 0;
    return maxCapacity > 0
      ? `השיעור מלא — כל ${maxCapacity} המקומות תפוסים. אפשר לפנות מקום אם משתתף/ת ביטל/ה.`
      : 'השיעור מלא — אין מקום פנוי למשתתף/ת נוסף/ת.';
  }
  if (supportMessage === 'cancel_instance_requires_dedicated_action') {
    return 'ביטול שיעור נעשה דרך "בטל שיעור" ולא דרך העריכה.';
  }
  if (supportMessage === 'missing_instructor_service_capability') {
    return 'למדריך/ה שנבחר/ה אין יכולת שירות פעילה עבור השירות הזה.';
  }
  if (supportMessage === 'missing_instructor_service_availability') {
    return 'לשירות הזה עדיין לא הוגדרה זמינות אצל המדריך/ה שנבחר/ה.';
  }
  if (supportMessage === 'outside_instructor_service_availability') {
    return 'המועד שנבחר נמצא מחוץ לחלונות הזמינות של השירות אצל המדריך/ה.';
  }
  if (supportMessage === 'failed_to_validate_instructor_availability') {
    return 'לא הצלחנו לבדוק את זמינות המדריך/ה כרגע. נסו שוב.';
  }
  if (supportMessage === 'invalid_service_duration') {
    return 'לשירות שנבחר אין משך תקין. יש לעדכן את משך השירות לפני שמירת השיעור.';
  }
  if (supportMessage === 'failed_to_load_service') {
    return 'לא ניתן היה לטעון את פרטי השירות כרגע. נסו שוב.';
  }
  if (supportMessage === 'failed_to_build_status_change_preview') {
    return 'לא ניתן היה לבנות תצוגה מקדימה לשינוי הסטטוס.';
  }
  const cancellationConflictMessage = resolveApiErrorMessage(error);
  if (cancellationConflictMessage === 'instance_cancelled_has_attended_participants') {
    const names = Array.isArray(error?.data?.attended_participants)
      ? error.data.attended_participants.map((participant) => participant?.name).filter(Boolean)
      : (Array.isArray(error?.attended_participants)
        ? error.attended_participants.map((participant) => participant?.name).filter(Boolean)
        : []);
    if (names.length > 0) {
      return `לא ניתן לבטל שיעור שבו כבר סומנה נוכחות. יש להסדיר קודם את: ${names.join(', ')}.`;
    }
    return 'לא ניתן לבטל שיעור שבו כבר סומנה נוכחות לאחד המשתתפים.';
  }
  // Status fallbacks run after every specific code above: several distinct 409s (attended
  // participants, a documented session report) must not collapse into the version-conflict text.
  if (error?.status === 423) {
    return 'השיעור נעול לשינוי ישיר. יש להשתמש בזרימת התיקון.';
  }
  if (error?.status === 409) {
    const hasTranslatedMessage = typeof error?.message === 'string' && error.message && error.message !== supportMessage;
    return hasTranslatedMessage ? error.message : 'השיעור עודכן על ידי משתמש אחר. רעננו את התצוגה ונסו שוב.';
  }
  // Anything not explained above: a general Hebrew message with the public code or HTTP status in
  // parentheses, or the connection message when the request got no response (docs/project-rules/20).
  return resolveUserErrorMessage(error, fallback || error?.displayFallback || 'הפעולה נכשלה.');
}

export const ATTENDANCE_MARK_UNCHANGED_REASON = 'אין שינוי לשמור';

/**
 * The instructor-pay choice the absence form sends: what a person clicked ("לשלם" / "לא לשלם"), or
 * null while the form still shows the earnings policy's preset ("לפי הגדרות השכר"). Null stores no
 * decision, so the policy in force on the lesson's date decides, now and after a dated change.
 *
 * @param {{ instructorCompensationDecision?: string|null, compensationFromPolicy?: boolean } | null} form
 */
export function absenceCompensationChoice(form) {
  if (!form || form.compensationFromPolicy) return null;
  const decision = String(form.instructorCompensationDecision || '').trim().toLowerCase();
  return decision === 'compensated' || decision === 'not_compensated' ? decision : null;
}

/**
 * The attendance mark stored on a participant row, in the shape the save sends: status, notes, the
 * instructor pay decision and whether the fee was waived.
 */
export function readStoredAttendanceMark(participant) {
  const metadata = participant?.metadata && typeof participant.metadata === 'object' ? participant.metadata : {};
  const workflow = metadata.workflow && typeof metadata.workflow === 'object' ? metadata.workflow : {};
  return {
    status: String(participant?.participant_status || '').trim().toLowerCase() || 'scheduled',
    notes: typeof metadata.notes === 'string' ? metadata.notes : '',
    instructorCompensationDecision: String(workflow.instructor_compensation?.decision || '').trim().toLowerCase(),
    isExcused: workflow.is_excused === true,
  };
}

/**
 * Whether saving `draft` would change the attendance mark stored on `participant`. A save with no
 * change is not offered.
 * - status: any difference.
 * - notes: compared trimmed, only when the draft sends notes (a string).
 * - instructor pay: only an explicit "compensated"/"not_compensated" that differs (pass
 *   absenceCompensationChoice(form): the policy's preset is no choice).
 * - fee waiver: the draft's choice against the stored one.
 *
 * @param {object} participant the stored participant row
 * @param {{ status?: string, notes?: string, instructorCompensationDecision?: string|null, isExcused?: boolean }} draft
 */
export function hasAttendanceMarkChanged(participant, draft) {
  if (!participant || !draft) return true;
  const stored = readStoredAttendanceMark(participant);
  const status = String(draft.status || '').trim().toLowerCase();
  if (!status || status !== stored.status) return true;
  if (typeof draft.notes === 'string' && draft.notes.trim() !== stored.notes.trim()) return true;
  const decision = String(draft.instructorCompensationDecision || '').trim().toLowerCase();
  if ((decision === 'compensated' || decision === 'not_compensated') && decision !== stored.instructorCompensationDecision) {
    return true;
  }
  return (draft.isExcused === true) !== stored.isExcused;
}

export function getParticipantStatusLabel(status) {
  if (status === 'attended') return 'נכח';
  if (status === 'no_show') return 'לא הגיע';
  if (status === 'cancelled') return 'בוטל';
  if (status === 'cancelled_student') return 'בוטל ע"י תלמיד';
  if (status === 'cancelled_clinic') return 'בוטל ע"י המכון';
  if (status === 'completed') return 'הושלם';
  return 'מתוכנן';
}

export function getCompensationDecisionLabel(decision) {
  if (decision === 'compensated') return 'כן, לפצות את המדריך';
  if (decision === 'not_compensated') return 'לא, אין לפצות את המדריך';
  return 'יש לבחור';
}

export function getWorkflowDecisionLabel(decision, kind = 'generic') {
  if (kind === 'student_billing') {
    if (decision === 'pending') return 'ממתין לחיוב';
    if (decision === 'unknown') return 'טרם נקבע';
    if (decision === 'resolved') return 'החיוב טופל';
    if (decision === 'not_applicable') return 'לא רלוונטי';
  }
  if (kind === 'hmo_claim') {
    if (decision === 'expected') return 'צפויה תביעה';
    if (decision === 'pending') return 'ממתין להגשת תביעה';
    if (decision === 'required') return 'נדרשת תביעה';
    if (decision === 'not_required') return 'לא נדרשת תביעה';
    if (decision === 'blocked') return 'דורש בדיקת גורם מממן';
    if (decision === 'unknown') return 'טרם נקבע';
  }
  if (kind === 'instructor_compensation') {
    if (decision === 'compensated') return 'המדריך מתוגמל';
    if (decision === 'not_compensated') return 'המדריך לא מתוגמל';
    if (decision === 'pending') return 'ממתין להחלטת שכר';
    if (decision === 'unknown') return 'טרם נקבע';
    if (decision === 'not_applicable') return 'לא רלוונטי';
  }
  if (decision === 'resolved') return 'טופל';
  if (decision === 'pending') return 'ממתין';
  if (decision === 'unknown') return 'לא נקבע';
  return decision || 'לא נקבע';
}

export function deriveDisplayWorkflowDecisions(participant, billingPolicy) {
  const workflow = participant?.metadata?.workflow && typeof participant.metadata.workflow === 'object'
    ? participant.metadata.workflow
    : {};
  const status = String(participant?.participant_status || '').trim().toLowerCase();
  const hmoCoverageStatus = String(participant?.hmo_coverage?.status || '').trim().toLowerCase();
  const studentBillingDecision = workflow.student_billing?.decision || 'unknown';
  const compensationDecision = workflow.instructor_compensation?.decision || 'unknown';
  const hmoDecision = workflow.hmo_claim?.decision || 'unknown';
  const hasResolvedStatus = ['attended', 'no_show', 'cancelled_student', 'cancelled_clinic'].includes(status);
  const hasCoveredHmoAuthorization = hmoCoverageStatus === 'covered';
  let resolvedStudentBillingDecision = studentBillingDecision;
  if (studentBillingDecision === 'pending' && !billingPolicy?.[status]) {
    resolvedStudentBillingDecision = 'not_applicable';
  }
  let resolvedHmoDecision = hmoDecision;
  if (resolvedHmoDecision === 'unknown') {
    if (hmoCoverageStatus === 'blocked') {
      resolvedHmoDecision = 'blocked';
    } else if (hasCoveredHmoAuthorization && status === 'scheduled') {
      resolvedHmoDecision = 'expected';
    } else if (hasCoveredHmoAuthorization && status === 'attended') {
      resolvedHmoDecision = 'pending';
    } else if (['no_show', 'cancelled_student', 'cancelled_clinic'].includes(status)) {
      resolvedHmoDecision = 'not_required';
    }
  }

  return {
    studentBillingDecision: resolvedStudentBillingDecision !== 'unknown'
      ? resolvedStudentBillingDecision
      : (!hasResolvedStatus
        ? 'unknown'
        : (billingPolicy?.[status] ? 'pending' : 'not_applicable')),
    compensationDecision: compensationDecision !== 'unknown'
      ? compensationDecision
      : (status === 'attended'
        ? 'compensated'
        : 'unknown'),
    hmoDecision: resolvedHmoDecision,
  };
}

export function getWorkflowReasonLabel(reason) {
  if (reason === 'attendance_unresolved') return 'יש משתתפים שטרם קיבלו סטטוס סופי.';
  if (reason === 'student_billing_unresolved') return 'יש חיוב שעדיין לא הושלם.';
  if (reason === 'hmo_claim_unresolved') return 'יש תביעת גורם מממן שעדיין לא הושלמה.';
  if (reason === 'missing_instance') return 'פרטי השיעור אינם זמינים.';
  return reason || 'קיים שלב פתוח בתהליך הסגירה.';
}

export function parseIsoDateSafe(value) {
  if (typeof value !== 'string' || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolveLatestWorkflowState(preferredState, fallbackState) {
  const hasPreferred = preferredState && typeof preferredState === 'object';
  const hasFallback = fallbackState && typeof fallbackState === 'object';

  if (!hasPreferred && !hasFallback) {
    return {};
  }
  if (!hasPreferred) {
    return fallbackState;
  }
  if (!hasFallback) {
    return preferredState;
  }

  const preferredTs = parseIsoDateSafe(preferredState.evaluated_at);
  const fallbackTs = parseIsoDateSafe(fallbackState.evaluated_at);
  return fallbackTs > preferredTs ? fallbackState : preferredState;
}

export function resolveClosureStepState(summary, key, isClosed) {
  if (summary && typeof summary[key] === 'boolean') {
    return summary[key];
  }
  if (isClosed === true) {
    return true;
  }
  return null;
}

export function formatAgorotPreview(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toShekel(amount));
}

export function getPreviewImpactClass(severity) {
  if (severity === 'blocking') {
    return 'border-red-200 bg-red-50 text-red-950';
  }
  if (severity === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-950';
  }
  return 'border-slate-200 bg-slate-50 text-slate-800';
}

export function shortId(value) {
  return value ? String(value).slice(-8) : '';
}

export function getOpenActionToneClass(tone) {
  if (tone === 'warn') {
    return 'border-amber-200 bg-amber-50 text-amber-950';
  }
  if (tone === 'danger') {
    return 'border-red-200 bg-red-50 text-red-950';
  }
  return 'border-slate-200 bg-white text-slate-900';
}

export function getOpenActionTab(actionId) {
  if (actionId === 'attendance') return 'participants';
  if (actionId === 'reminders') return 'participants';
  if (['documentation', 'billing', 'hmo', 'closure'].includes(actionId)) return 'workflow';
  if (actionId === 'exception') return 'overview';
  return 'overview';
}

export function isResolvedParticipantStatus(status) {
  return ['attended', 'no_show', 'cancelled_student', 'cancelled_clinic'].includes(String(status || '').trim().toLowerCase());
}

export function getImpactGroupMeta(type) {
  if (['billing_reversal', 'billing_charge', 'billing_update', 'billing_blocked', 'post_coverage_charge'].includes(type)) {
    return { key: 'billing', label: 'חיוב כספי', borderClass: 'border-amber-200', bgClass: 'bg-amber-50/70' };
  }
  if (['instructor_earning_reversal', 'instructor_earning_add', 'instructor_earning_update'].includes(type)) {
    return { key: 'payroll', label: 'שכר מדריך', borderClass: 'border-emerald-200', bgClass: 'bg-emerald-50/70' };
  }
  if (type === 'instructor_attendance_update') {
    return { key: 'attendance', label: 'נוכחות מדריך', borderClass: 'border-sky-200', bgClass: 'bg-sky-50/70' };
  }
  if (['hmo_task_resolve', 'hmo_split_detail'].includes(type)) {
    return { key: 'hmo', label: 'גורם מממן', borderClass: 'border-fuchsia-200', bgClass: 'bg-fuchsia-50/70' };
  }
  return { key: 'workflow', label: 'זרימת שיעור', borderClass: 'border-slate-200', bgClass: 'bg-slate-50/70' };
}

export function groupPreviewImpacts(impacts) {
  const groups = [];
  for (const impact of Array.isArray(impacts) ? impacts : []) {
    const meta = getImpactGroupMeta(impact?.type);
    let group = groups.find((entry) => entry.key === meta.key);
    if (!group) {
      group = { ...meta, impacts: [] };
      groups.push(group);
    }
    group.impacts.push(impact);
  }
  return groups;
}

export function buildConflictLines(baseInstance, latestInstance, participantId) {
  const lines = [];
  if (!latestInstance) return lines;

  const baseDisplayInstance = getDisplayInstance(baseInstance);
  const latestDisplayInstance = getDisplayInstance(latestInstance);
  const baseParticipants = getDisplayParticipants(baseInstance);
  const latestParticipants = getDisplayParticipants(latestInstance);

  if (baseDisplayInstance?.status !== latestDisplayInstance?.status) {
    lines.push(`סטטוס השיעור כעת הוא "${getParticipantStatusLabel(latestDisplayInstance?.status)}" במקום "${getParticipantStatusLabel(baseDisplayInstance?.status)}".`);
  }

  if (baseDisplayInstance?.datetime_start !== latestDisplayInstance?.datetime_start) {
    lines.push(`מועד השיעור השתנה ל-${formatDateDisplay(latestDisplayInstance?.datetime_start)} ${formatTimeDisplay(latestDisplayInstance?.datetime_start)}.`);
  }

  if (baseDisplayInstance?.duration_minutes !== latestDisplayInstance?.duration_minutes) {
    lines.push(`משך השיעור עודכן ל-${latestDisplayInstance?.duration_minutes || 0} דקות.`);
  }

  if (participantId) {
    const beforeParticipant = baseParticipants.find((participant) => participant.id === participantId);
    const latestParticipant = latestParticipants.find((participant) => participant.id === participantId);
    if (latestParticipant && beforeParticipant?.participant_status !== latestParticipant.participant_status) {
      const participantName = getParticipantDisplayName(latestParticipant, getParticipantDisplayName(beforeParticipant, 'הלקוח/ה'));
      lines.push(`${participantName} מסומן כרגע כ-"${getParticipantStatusLabel(latestParticipant.participant_status)}".`);
    }
    const latestNotes = latestParticipant?.metadata?.notes || '';
    const previousNotes = beforeParticipant?.metadata?.notes || '';
    if (latestNotes !== previousNotes && latestNotes) {
      lines.push(`הערת המשתתף עודכנה ל-"${latestNotes}".`);
    }
  }

  if (lines.length === 0) {
    lines.push('קיימת גרסה חדשה יותר של השיעור בשרת, גם אם לא זוהה שינוי גלוי בשדות המוצגים כאן.');
  }

  return lines;
}

// One display map for participant attendance statuses, shared by the roster, confirm strip and
// correction panel. `tone` is mapped to classes by the component.
export const PARTICIPANT_STATUS_DISPLAY = {
  scheduled: { label: 'מתוכנן', tone: 'neutral' },
  attended: { label: 'נכח/ה', tone: 'ok' },
  no_show: { label: 'לא הגיע/ה', tone: 'bad' },
  cancelled_student: { label: 'ביטול ע"י הלקוח', tone: 'neutral' },
  cancelled_clinic: { label: 'ביטול ע"י המכון', tone: 'neutral' },
};

export function getParticipantStatusDisplay(status) {
  return PARTICIPANT_STATUS_DISPLAY[String(status || '').trim().toLowerCase()] || { label: 'לא ידוע', tone: 'neutral' };
}

// The app runs on a hash router, so a link opened in a new tab must carry the "#/" prefix
// (a plain "/students/..." lands on the site root instead of the profile).
export function getParticipantCardHref(participant) {
  if (participant?.student_id) return `#/students/${participant.student_id}`;
  if (participant?.client_profile_id) return `#/one-time-customers/${participant.client_profile_id}`;
  return null;
}

export function formatAgorotCompact(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(toShekel(Math.abs(amount)));
}

const STRIP_DETAIL_EXCLUDED_TYPES = new Set(['participant_status', 'lesson_status']);

/**
 * Money-first summary of a participant status-change preview for the one-line confirm strip.
 * Built from the server's typed impacts (see api/calendar-attendance preview builder). Amounts are
 * phrased with Hebrew verbs instead of +/- signs, which reorder badly inside RTL text.
 */
export function summarizePreviewImpacts(preview) {
  const impacts = Array.isArray(preview?.impacts) ? preview.impacts : [];
  const segments = [];
  const warnings = [];

  for (const impact of impacts) {
    switch (impact?.type) {
      case 'billing_charge':
        segments.push({ key: 'billing', label: 'חיוב', value: `${formatAgorotCompact(impact.amount)} יחויבו` });
        break;
      case 'billing_reversal':
        segments.push({ key: 'billing', label: 'חיוב', value: `${formatAgorotCompact(impact.amount)} יזוכו` });
        break;
      case 'billing_update':
        segments.push({ key: 'billing', label: 'חיוב', value: `${formatAgorotCompact(impact.amount_before)} ← ${formatAgorotCompact(impact.amount_after)}` });
        break;
      case 'post_coverage_charge':
        segments.push({ key: 'billing', label: 'חיוב', value: `${formatAgorotCompact(impact.amount)} אחרי ניצול הזכאות` });
        break;
      case 'hmo_split_detail':
        segments.push({
          key: 'hmo',
          label: impact.hmo_provider_name || 'גורם מממן',
          value: `השתתפות ${formatAgorotCompact(impact.hmo_student_copay_amount)} · תביעה ${formatAgorotCompact(impact.hmo_insurer_claim_amount)}`,
        });
        break;
      case 'hmo_task_resolve':
        segments.push({ key: 'hmo', label: 'גורם מממן', value: 'משימת התביעה תבוטל' });
        break;
      case 'instructor_earning_add':
        segments.push({ key: 'payroll', label: 'שכר', value: `${formatAgorotCompact(impact.amount)} יתווספו` });
        break;
      case 'instructor_earning_reversal':
        segments.push({ key: 'payroll', label: 'שכר', value: `${formatAgorotCompact(impact.amount)} יוסרו` });
        break;
      case 'instructor_earning_update':
        segments.push({ key: 'payroll', label: 'שכר', value: `${formatAgorotCompact(impact.amount_before)} ← ${formatAgorotCompact(impact.amount_after)}` });
        break;
      case 'billing_blocked':
        warnings.push(impact.message || 'החיוב דורש בדיקה לפני שיתבצע.');
        break;
      default:
        break;
    }
  }

  const details = impacts
    .filter((impact) => impact?.message && !STRIP_DETAIL_EXCLUDED_TYPES.has(impact.type))
    .map((impact) => ({ type: impact.type, group: getImpactGroupMeta(impact.type).label, message: impact.message }));

  return { segments, warnings, details, quiet: segments.length === 0 && warnings.length === 0 };
}
