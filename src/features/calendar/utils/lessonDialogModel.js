// Pure helpers for the calendar lesson dialog (LessonInstanceDialog and its sub-components).
// Keep this module free of React and '@/...' path aliases so node:test can import it directly.
import { formatDateDisplay, formatTimeDisplay } from './timeGrid.js';
import { buildSchedulingOverrideReasonDetails } from './schedulingOverride.js';
import { getParticipantDisplayName } from './participantDisplay.js';
import { extractSupportCode, resolveApiErrorMessage } from '../../../lib/error-support.js';

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
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

export function resolveMutationError(error) {
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
  if (error?.message === 'missing_instructor_service_capability') {
    return 'למדריך/ה שנבחר/ה אין יכולת שירות פעילה עבור השירות הזה.';
  }
  if (error?.message === 'missing_instructor_service_availability') {
    return 'לשירות הזה עדיין לא הוגדרה זמינות אצל המדריך/ה שנבחר/ה.';
  }
  if (error?.message === 'outside_instructor_service_availability') {
    return 'המועד שנבחר נמצא מחוץ לחלונות הזמינות של השירות אצל המדריך/ה.';
  }
  if (error?.message === 'failed_to_validate_instructor_availability') {
    return 'לא הצלחנו לבדוק את זמינות המדריך/ה כרגע. נסו שוב.';
  }
  if (error?.message === 'invalid_service_duration') {
    return 'לשירות שנבחר אין משך תקין. יש לעדכן את משך השירות לפני שמירת השיעור.';
  }
  if (error?.message === 'failed_to_load_service') {
    return 'לא ניתן היה לטעון את פרטי השירות כרגע. נסו שוב.';
  }
  if (error?.data?.code === 'missing_instructor_compensation_decision') {
    return 'יש לבחור אם המדריך אמור לקבל פיצוי לפני שמאשרים אי-הגעה מחויבת.';
  }
  if (error?.message === 'failed_to_build_status_change_preview') {
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
  return error?.message || 'הפעולה נכשלה.';
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
  if (reason === 'instructor_compensation_unresolved') return 'שכר המדריך עדיין לא נסגר דרך הרצת שכר.';
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
  }).format(amount / 100);
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
  if (['documentation', 'billing', 'payroll', 'hmo', 'closure'].includes(actionId)) return 'workflow';
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
  if (['instructor_attendance_remove', 'instructor_attendance_update', 'instructor_attendance_add'].includes(type)) {
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
  }).format(Math.abs(amount) / 100);
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
