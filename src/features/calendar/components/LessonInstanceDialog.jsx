import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/label';
import { Input } from '../../../components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../../components/ui/select';
import { formatTimeDisplay, formatDateDisplay, getInstanceStatusIcon } from '../utils/timeGrid';
import { Badge } from '../../../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { useOrg } from '@/org/OrgContext';
import { useServices } from '@/hooks/useOrgData';
import { useCalendarInstructors } from '../hooks/useCalendar';
import { authenticatedFetch } from '@/lib/api-client.js';
import { toast } from 'sonner';
import { Pencil, X, Check, XCircle, Loader2, AlertCircle, AlertTriangle, UserPlus, RotateCcw } from 'lucide-react';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Textarea } from '../../../components/ui/textarea';
import { Checkbox } from '../../../components/ui/checkbox';
import { LockedCorrectionPanel } from './LockedCorrectionPanel';
import { LessonParticipantRoster } from './LessonParticipantRoster.jsx';
import { LessonResolutionStatus } from './LessonResolutionStatus.jsx';
import { useVersionConflictResolver } from './useVersionConflictResolver';
import { dayTokenForJsDay } from '@/lib/day-of-week.js';
import { hasConfiguredAvailability, isWithinAvailabilityWindows } from '@/lib/instructor-availability.js';
import {
  buildSchedulingOverrideReasonDetails,
  hasValidSchedulingOverrideReason,
  resolveSchedulingOverrideFormState,
  SCHEDULING_OVERRIDE_REASON_OPTIONS,
} from '../utils/schedulingOverride.js';
import { getParticipantDisplayName, resolveParticipantReminderContact } from '../utils/participantDisplay.js';
import { getLessonOpenActions } from '../utils/calendarWorkspace.js';

const DEFAULT_BILLING_POLICY = {
  attended: true,
  no_show: false,
  cancelled_student: false,
  cancelled_clinic: false,
};

const DEFAULT_INSTRUCTOR_EARNINGS_POLICY = {
  attended: true,
  no_show: true,
  cancelled_student: false,
  cancelled_clinic: false,
};

function normalizeInstanceStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'cancelled_student' || normalized === 'cancelled_clinic' || normalized === 'no_show') {
    return 'cancelled';
  }
  return normalized;
}

function toLocalDateString(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toUtcIsoString(dateString, timeString) {
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

function getDayTokenForDateString(dateString) {
  if (!dateString) return null;

  const [year, month, day] = String(dateString).split('-').map(Number);
  const localDate = new Date(year, (month || 1) - 1, day || 1, 0, 0, 0, 0);
  if (Number.isNaN(localDate.getTime())) {
    return null;
  }

  return dayTokenForJsDay(localDate.getDay());
}

function buildSchedulingOverrideMetadata(baseMetadata, { enabled, selectedReasonCode, customReason }) {
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

function resolveLessonSchedulingAvailability({ capability, date, time, durationMinutes }) {
  if (!capability) {
    return {
      status: 'missing_capability',
      message: 'למדריך/ה שנבחר/ה אין יכולת שירות פעילה עבור השירות הזה.',
    };
  }

  if (!hasConfiguredAvailability(capability.availability_windows)) {
    return {
      status: 'missing_availability',
      message: 'לשירות הזה עדיין לא הוגדרה זמינות אצל המדריך/ה שנבחר/ה.',
    };
  }

  const day = getDayTokenForDateString(date);
  if (!day || !time || !isWithinAvailabilityWindows({
    availabilityWindows: capability.availability_windows,
    day,
    startTime: time,
    durationMinutes,
  })) {
    return {
      status: 'outside_instructor_service_availability',
      message: 'המועד שנבחר נמצא מחוץ לחלונות הזמינות של השירות אצל המדריך/ה.',
    };
  }

  return {
    status: 'within_availability',
    message: '',
  };
}

function isCancellationStatus(status) {
  return normalizeInstanceStatus(status) === 'cancelled';
}

function isGraceEligibleStatus(status) {
  return ['no_show', 'cancelled_student', 'cancelled_clinic'].includes(String(status || '').trim().toLowerCase());
}

function shouldShowGraceWaiver(policy, status) {
  const normalizedStatus = String(status || '').trim().toLowerCase();
  return isGraceEligibleStatus(normalizedStatus) && Boolean(policy?.[normalizedStatus]);
}

function getCancellationStatusLabel(status) {
  if (normalizeInstanceStatus(status) === 'cancelled') return 'שיעור בוטל';
  return 'ביטול';
}

function getDisplayInstance(instance) {
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

function getDisplayParticipants(instance) {
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

function resolveMutationError(error) {
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
  if (error?.status === 423) {
    return 'השיעור נעול לשינוי ישיר. יש להשתמש בזרימת התיקון.';
  }
  if (error?.status === 409) {
    return 'השיעור עודכן על ידי משתמש אחר. רעננו את התצוגה ונסו שוב.';
  }
  if (error?.data?.code === 'missing_instructor_compensation_decision') {
    return 'יש לבחור אם המדריך אמור לקבל פיצוי לפני שמאשרים אי-הגעה מחויבת.';
  }
  if (error?.message === 'failed_to_build_status_change_preview') {
    return 'לא ניתן היה לבנות תצוגה מקדימה לשינוי הסטטוס.';
  }
  const cancellationConflictMessage = error?.data?.message || error?.message;
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
  return error?.message || 'הפעולה נכשלה.';
}

function getParticipantStatusLabel(status) {
  if (status === 'attended') return 'נכח';
  if (status === 'no_show') return 'לא הגיע';
  if (status === 'cancelled') return 'בוטל';
  if (status === 'cancelled_student') return 'בוטל ע"י תלמיד';
  if (status === 'cancelled_clinic') return 'בוטל ע"י המכון';
  if (status === 'completed') return 'הושלם';
  return 'מתוכנן';
}

function getCompensationDecisionLabel(decision) {
  if (decision === 'compensated') return 'כן, לפצות את המדריך';
  if (decision === 'not_compensated') return 'לא, אין לפצות את המדריך';
  return 'יש לבחור';
}

function getWorkflowDecisionLabel(decision, kind = 'generic') {
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

function deriveDisplayWorkflowDecisions(participant, billingPolicy) {
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

function getWorkflowReasonLabel(reason) {
  if (reason === 'attendance_unresolved') return 'יש משתתפים שטרם קיבלו סטטוס סופי.';
  if (reason === 'student_billing_unresolved') return 'יש חיוב שעדיין לא הושלם.';
  if (reason === 'instructor_compensation_unresolved') return 'שכר המדריך עדיין לא נסגר דרך הרצת שכר.';
  if (reason === 'hmo_claim_unresolved') return 'יש תביעת גורם מממן שעדיין לא הושלמה.';
  if (reason === 'missing_instance') return 'פרטי השיעור אינם זמינים.';
  return reason || 'קיים שלב פתוח בתהליך הסגירה.';
}

function parseIsoDateSafe(value) {
  if (typeof value !== 'string' || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveLatestWorkflowState(preferredState, fallbackState) {
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

function resolveClosureStepState(summary, key, isClosed) {
  if (summary && typeof summary[key] === 'boolean') {
    return summary[key];
  }
  if (isClosed === true) {
    return true;
  }
  return null;
}

function formatAgorotPreview(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

function getPreviewImpactClass(severity) {
  if (severity === 'blocking') {
    return 'border-red-200 bg-red-50 text-red-950';
  }
  if (severity === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-950';
  }
  return 'border-slate-200 bg-slate-50 text-slate-800';
}

function shortId(value) {
  return value ? String(value).slice(-8) : '';
}

function DetailField({ label, children, className = '' }) {
  return (
    <div className={className}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-base font-medium text-slate-950">{children}</div>
    </div>
  );
}

function EmptyTabState({ title, description }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-5 text-center">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-1 text-sm text-slate-600">{description}</div>
    </div>
  );
}

function getOpenActionToneClass(tone) {
  if (tone === 'warn') {
    return 'border-amber-200 bg-amber-50 text-amber-950';
  }
  if (tone === 'danger') {
    return 'border-red-200 bg-red-50 text-red-950';
  }
  return 'border-slate-200 bg-white text-slate-900';
}

function getOpenActionTab(actionId) {
  if (actionId === 'attendance') return 'participants';
  if (actionId === 'reminders') return 'participants';
  if (['documentation', 'billing', 'payroll', 'hmo', 'closure'].includes(actionId)) return 'workflow';
  if (actionId === 'exception') return 'overview';
  return 'overview';
}

function isResolvedParticipantStatus(status) {
  return ['attended', 'no_show', 'cancelled_student', 'cancelled_clinic'].includes(String(status || '').trim().toLowerCase());
}

function getImpactGroupMeta(type) {
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

function groupPreviewImpacts(impacts) {
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

function buildConflictLines(baseInstance, latestInstance, participantId) {
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

/**
 * LessonInstanceDialog component - displays and edits lesson instance details
 */
export function LessonInstanceDialog({ instance, open, onClose, onUpdate }) {
  const { currentOrg, activeOrg } = useOrg();
  const { services, isLoading: servicesLoading } = useServices();
  const { instructors, isLoading: instructorsLoading } = useCalendarInstructors();
  const org = currentOrg ?? activeOrg;
  const role = typeof org?.membership?.role === 'string' ? org.membership.role.trim().toLowerCase() : 'member';
  const canManageAll = role === 'admin' || role === 'owner' || role === 'office';
  const displayInstance = useMemo(() => getDisplayInstance(instance), [instance]);
  const displayParticipants = useMemo(() => getDisplayParticipants(instance), [instance]);
  const dialogScopeKey = `${instance?.id || ''}:${instance?.latest_correction?.id || ''}`;
  
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isMarkingAttendance, setIsMarkingAttendance] = useState(false);
  const [reminderUpdating, setReminderUpdating] = useState(false);
  const [localReminderState, setLocalReminderState] = useState({});
  const [error, setError] = useState(null);
  const [billingWarnings, setBillingWarnings] = useState([]);
  const [isAddingParticipant, setIsAddingParticipant] = useState(false);
  const [addStudentQuery, setAddStudentQuery] = useState('');
  const [addStudentResults, setAddStudentResults] = useState([]);
  const [isSearchingStudents, setIsSearchingStudents] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  // absenceForm: { participantId, status, notes } | null
  const [absenceForm, setAbsenceForm] = useState(null);
  const [absenceFormError, setAbsenceFormError] = useState('');
  const [absenceRequirements, setAbsenceRequirements] = useState(null);
  const [absenceRequirementsLoading, setAbsenceRequirementsLoading] = useState(false);
  const [feeWaiverConfirmOpen, setFeeWaiverConfirmOpen] = useState(false);
  const [restorePreview, setRestorePreview] = useState(null);
  const [restorePreviewError, setRestorePreviewError] = useState('');
  const [restorePreviewLoading, setRestorePreviewLoading] = useState(false);
  const [cancelPreview, setCancelPreview] = useState(null);
  const [cancelPreviewError, setCancelPreviewError] = useState('');
  const [cancelPreviewLoading, setCancelPreviewLoading] = useState(false);
  const [editPreview, setEditPreview] = useState(null);
  const [editPreviewError, setEditPreviewError] = useState('');
  const [editPreviewLoading, setEditPreviewLoading] = useState(false);
  const [pendingEditBody, setPendingEditBody] = useState(null);
  const [activeViewTab, setActiveViewTab] = useState('overview');
  const [billingPolicy, setBillingPolicy] = useState(DEFAULT_BILLING_POLICY);
  const [instructorEarningsPolicy, setInstructorEarningsPolicy] = useState(DEFAULT_INSTRUCTOR_EARNINGS_POLICY);
  const latestPreviewRequestIdRef = useRef(0);
  const latestCancelPreviewRequestIdRef = useRef(0);
  const latestStudentSearchRequestIdRef = useRef(0);
  
  const [formData, setFormData] = useState({
    instructor_employee_id: '',
    service_id: '',
    date: '',
    time: '',
    duration_minutes: 60,
    status: 'scheduled',
  });
  const [useSchedulingOverride, setUseSchedulingOverride] = useState(false);
  const [selectedOverrideReasonCode, setSelectedOverrideReasonCode] = useState('');
  const [customOverrideReason, setCustomOverrideReason] = useState('');

  useEffect(() => {
    setEditPreview(null);
    setEditPreviewError('');
    setEditPreviewLoading(false);
    setPendingEditBody(null);
  }, [formData, useSchedulingOverride, selectedOverrideReasonCode, customOverrideReason]);

  const resetEditState = useCallback((instanceValue = displayInstance) => {
    if (!instanceValue) {
      return;
    }

    const dateTime = new Date(instanceValue.datetime_start);
    setFormData({
      instructor_employee_id: instanceValue.instructor_employee_id || '',
      service_id: instanceValue.service_id || '',
      date: toLocalDateString(dateTime),
      time: dateTime.toTimeString().slice(0, 5),
      duration_minutes: instanceValue.duration_minutes || 60,
      status: normalizeInstanceStatus(instanceValue.status) || 'scheduled',
    });
    const overrideState = resolveSchedulingOverrideFormState(instanceValue?.metadata?.scheduling_override);
    setUseSchedulingOverride(overrideState.enabled);
    setSelectedOverrideReasonCode(overrideState.selectedReasonCode);
    setCustomOverrideReason(overrideState.customReason);
    setEditPreview(null);
    setEditPreviewError('');
    setEditPreviewLoading(false);
    setPendingEditBody(null);
  }, [displayInstance]);

  // Initialize form data when instance changes
  useEffect(() => {
    resetEditState(displayInstance);
  }, [displayInstance, resetEditState]);

  // Reset local reminder optimistic state when a different instance is opened
  useEffect(() => {
    setLocalReminderState({});
    setBillingWarnings([]);
    setIsAddingParticipant(false);
    setAddStudentQuery('');
    setAddStudentResults([]);
    setIsSearchingStudents(false);
    setAbsenceForm(null);
    setAbsenceFormError('');
    setAbsenceRequirements(null);
    setAbsenceRequirementsLoading(false);
    setRestorePreview(null);
    setRestorePreviewError('');
    setRestorePreviewLoading(false);
    setCancelDialogOpen(false);
    setCancelPreview(null);
    setCancelPreviewError('');
    setCancelPreviewLoading(false);
    setEditPreview(null);
    setEditPreviewError('');
    setEditPreviewLoading(false);
    setPendingEditBody(null);
    setActiveViewTab('overview');
    latestPreviewRequestIdRef.current += 1;
    latestCancelPreviewRequestIdRef.current += 1;
    latestStudentSearchRequestIdRef.current += 1;
  }, [instance?.id, instance?.latest_correction?.id]);

  useEffect(() => {
    if (!org?.id) {
      setBillingPolicy(DEFAULT_BILLING_POLICY);
      setInstructorEarningsPolicy(DEFAULT_INSTRUCTOR_EARNINGS_POLICY);
      return undefined;
    }

    let cancelled = false;
    const loadPolicies = async () => {
      try {
        const response = await authenticatedFetch('settings', {
          params: {
            org_id: org.id,
            key: 'billing_consumption_policy,instructor_earnings_policy',
          },
        });
        const settings = response?.settings && typeof response.settings === 'object'
          ? response.settings
          : {};
        if (!cancelled) {
          setBillingPolicy({
            ...DEFAULT_BILLING_POLICY,
            ...(settings.billing_consumption_policy && typeof settings.billing_consumption_policy === 'object'
              ? settings.billing_consumption_policy
              : {}),
          });
          setInstructorEarningsPolicy({
            ...DEFAULT_INSTRUCTOR_EARNINGS_POLICY,
            ...(settings.instructor_earnings_policy && typeof settings.instructor_earnings_policy === 'object'
              ? settings.instructor_earnings_policy
              : {}),
          });
        }
      } catch (loadError) {
        console.error('Failed to load finance policies for attendance dialog:', loadError);
        if (!cancelled) {
          setBillingPolicy(DEFAULT_BILLING_POLICY);
          setInstructorEarningsPolicy(DEFAULT_INSTRUCTOR_EARNINGS_POLICY);
        }
      }
    };

    void loadPolicies();
    return () => {
      cancelled = true;
    };
  }, [org?.id]);

  useEffect(() => {
    if (!org?.id || !absenceForm?.status || !absenceForm?.participantId) {
      setAbsenceRequirements(null);
      setAbsenceRequirementsLoading(false);
      return undefined;
    }

    let cancelled = false;
    const loadAbsenceRequirements = async () => {
      setAbsenceRequirementsLoading(true);
      try {
        const response = await authenticatedFetch('calendar/attendance', {
          method: 'POST',
          body: {
            action: 'status-requirements',
            org_id: org.id,
            instance_id: instance.id,
            participant_id: absenceForm.participantId,
            participant_status: absenceForm.status,
          },
        });
        if (!cancelled) {
          setAbsenceRequirements(response && typeof response === 'object' ? response : null);
        }
      } catch (loadError) {
        console.error('Failed to load absence requirements:', loadError);
        if (!cancelled) {
          setAbsenceRequirements(null);
          setAbsenceFormError(resolveMutationError(loadError) || 'לא ניתן היה לטעון את דרישות אי-ההגעה.');
        }
      } finally {
        if (!cancelled) {
          setAbsenceRequirementsLoading(false);
        }
      }
    };

    void loadAbsenceRequirements();
    return () => {
      cancelled = true;
    };
  }, [org?.id, instance?.id, absenceForm?.participantId, absenceForm?.status]);


  function formatPhoneForWhatsApp(phone) {
    if (!phone) return null;
    const digits = String(phone).replace(/\D/g, '');
    if (!digits) return null;
    if (digits.startsWith('972')) return digits;
    if (digits.startsWith('0')) return '972' + digits.slice(1);
    return '972' + digits;
  }

  function formatReminderDayDate(dateTimeValue) {
    if (!dateTimeValue) return '';
    const date = new Date(dateTimeValue);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('he-IL', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
    }).format(date);
  }

  function buildReminderMessage(lessonInstance, studentName) {
    const dayDate = formatReminderDayDate(lessonInstance.datetime_start);
    const time = formatTimeDisplay(lessonInstance.datetime_start);
    const service = lessonInstance.service?.service_name || 'אצלנו';
    return [
      `שלום,`,
      `רצינו להזכיר שיש ל${studentName} מפגש ${service}.`,
      `ניפגש ב${dayDate} בשעה ${time}.`,
      'נשמח לאישור הגעתך.',
      'תודה רבה!',
    ].join('\n');
  }

  function resolveReminderContact(participant) {
    return resolveParticipantReminderContact(participant);
  }

  function buildEmailReminderHref(lessonInstance, contact) {
    if (!contact?.email) return null;
    const dayDate = formatReminderDayDate(lessonInstance.datetime_start);
    const service = lessonInstance.service?.service_name || 'שיעור';
    const studentName = contact.name || 'לקוח/ה';
    const subject = encodeURIComponent(`תזכורת: ${service} – ${dayDate}`);
    const reminderText = buildReminderMessage(lessonInstance, studentName);
    const rtlBody = reminderText
      .split('\n')
      .map((line) => `\u202B${line}\u202C`)
      .join('\n');
    const body = encodeURIComponent(rtlBody);
    return `mailto:${contact.email}?subject=${subject}&body=${body}`;
  }

  const statusInfo = getInstanceStatusIcon(displayInstance?.status, displayInstance?.documentation_status);
  const startTime = displayInstance?.datetime_start ? formatTimeDisplay(displayInstance.datetime_start) : '';
  const endDate = displayInstance?.datetime_start
    ? new Date(new Date(displayInstance.datetime_start).getTime() + Number(displayInstance.duration_minutes || 0) * 60000)
    : null;
  const endTime = endDate ? formatTimeDisplay(endDate.toISOString()) : '';
  const dateDisplay = displayInstance?.datetime_start ? formatDateDisplay(displayInstance.datetime_start) : '';

  async function fetchLatestInstance() {
    return authenticatedFetch(`lesson-instances/${instance.id}`, {
      params: { org_id: org.id },
    });
  }
  const {
    conflictState,
    isResolvingConflict,
    handleVersionConflict,
    applyConflictOverride,
    clearConflict,
  } = useVersionConflictResolver({
    fetchLatestValue: fetchLatestInstance,
    clearError: () => setError(null),
    scopeKey: dialogScopeKey,
  });

  function createAttendanceConflictAdapter() {
    return {
      buildConflictState: ({ payload, latestValue }) => ({
        title: 'השיעור השתנה מאז שפתחתם אותו.',
        actionLabel: `סימון משתתף/ת כ-${getParticipantStatusLabel(payload.requestedStatus)}`,
        diffLines: buildConflictLines(instance, latestValue, payload.participantId),
        participantId: payload.participantId,
      }),
      retry: async ({ latestValue, payload }) => {
        const latestParticipants = getDisplayParticipants(latestValue);
        const latestParticipant = latestParticipants.find((participant) => participant.id === payload.participantId);
        const body = {
          org_id: org.id,
          instance_id: latestValue.id,
          participant_id: payload.participantId,
          participant_status: payload.requestedStatus,
          instance_version: latestValue.version,
          participant_version: latestParticipant?.version,
        };
        if (typeof payload.notes === 'string') {
          body.notes = payload.notes.trim();
        }
        if (payload.instructorCompensationDecision) {
          body.instructor_compensation_decision = payload.instructorCompensationDecision;
        }
        if (payload.isExcused === true) {
          body.is_excused = true;
          body.reason = payload.notes || null;
        }
        const result = await authenticatedFetch('calendar/attendance', {
          method: 'POST',
          body,
        });
        if (result?.billing_warnings?.length > 0) {
          setBillingWarnings(result.billing_warnings);
        }
        if (absenceForm?.participantId === payload.participantId) {
          setAbsenceForm(null);
        }
        onUpdate?.();
      },
    };
  }

  function createSaveConflictAdapter() {
    return {
      buildConflictState: ({ latestValue }) => ({
        title: 'השיעור השתנה מאז שפתחתם אותו.',
        actionLabel: 'שמירת שינויים בשיעור',
        diffLines: buildConflictLines(instance, latestValue),
      }),
      retry: async ({ latestValue, payload }) => {
        const datetime_start = toUtcIsoString(payload.formData.date, payload.formData.time);
        const body = {
          id: latestValue.id,
          org_id: org.id,
          datetime_start,
          duration_minutes: payload.formData.duration_minutes,
          instructor_employee_id: payload.formData.instructor_employee_id,
          service_id: payload.formData.service_id,
          status: payload.formData.status,
          expected_version: latestValue.version,
          metadata: buildSchedulingOverrideMetadata(latestValue.metadata, {
            enabled: payload.useSchedulingOverride,
            selectedReasonCode: payload.selectedOverrideReasonCode,
            customReason: payload.customOverrideReason,
          }),
        };
        await authenticatedFetch('calendar/instances', { method: 'PUT', body });
        setIsEditMode(false);
        onUpdate?.();
      },
    };
  }

  function createCancelConflictAdapter() {
    return {
      buildConflictState: ({ latestValue }) => ({
        title: 'השיעור השתנה מאז שפתחתם אותו.',
        actionLabel: 'ביטול שיעור',
        diffLines: buildConflictLines(instance, latestValue),
      }),
      retry: async ({ latestValue, payload }) => {
        await authenticatedFetch('calendar/instances', {
          method: 'PUT',
          body: {
            id: latestValue.id,
            org_id: org.id,
            status: payload.requestedStatus,
            expected_version: latestValue.version,
          },
        });
        onUpdate?.();
        onClose();
      },
    };
  }

  function createReportConflictAdapter() {
    return {
      buildConflictState: ({ payload, latestValue }) => ({
        title: 'השיעור השתנה מאז שפתחתם אותו.',
        actionLabel: `עדכון סטטוס שיעור ל-${getParticipantStatusLabel(payload.requestedStatus)}`,
        diffLines: buildConflictLines(instance, latestValue),
      }),
      retry: async ({ latestValue, payload }) => {
        const result = await authenticatedFetch('calendar/instances', {
          method: 'PUT',
          body: {
            id: latestValue.id,
            org_id: org.id,
            status: payload.requestedStatus,
            expected_version: latestValue.version,
          },
        });
        onUpdate?.();
        if (result?.billing_warnings?.length > 0) {
          setBillingWarnings(result.billing_warnings);
        } else {
          onClose();
        }
      },
    };
  }

  function buildEditUpdateBody() {
    if (!org?.id) {
      throw new Error('Organization not found');
    }

    if (formData.status === 'completed' && hasUnsetParticipants) {
      throw new Error(
        `יש לסמן נוכחות לכל התלמידים לפני השלמת השיעור (${scheduledParticipantsCount} ${scheduledParticipantsCount === 1 ? 'תלמיד ממתין' : 'תלמידים ממתינים'})`
      );
    }

    if (selectedEditService && !selectedEditServiceHasValidDuration) {
      throw new Error('לשירות שנבחר אין משך תקין. יש לעדכן את משך השירות לפני שמירת השיעור.');
    }
    if (schedulingAvailabilityState.status === 'missing_capability') {
      throw new Error('missing_instructor_service_capability');
    }
    if (schedulingAvailabilityState.status === 'missing_availability') {
      throw new Error('missing_instructor_service_availability');
    }
    if (schedulingAvailabilityState.status === 'outside_instructor_service_availability' && !useSchedulingOverride) {
      throw new Error('outside_instructor_service_availability');
    }
    if (useSchedulingOverride && !hasValidSchedulingOverrideReason(selectedOverrideReasonCode, customOverrideReason)) {
      throw new Error('יש למלא סיבת חריגה לפני שמירת שיבוץ מחוץ לזמינות.');
    }

    const datetime_start = toUtcIsoString(formData.date, formData.time);
    if (!datetime_start) {
      throw new Error('תאריך או שעה אינם תקינים.');
    }

    return {
      id: instance.id,
      org_id: org.id,
      datetime_start,
      duration_minutes: formData.duration_minutes,
      instructor_employee_id: formData.instructor_employee_id,
      service_id: formData.service_id,
      status: formData.status,
      expected_version: instance.version,
      metadata: buildSchedulingOverrideMetadata(displayInstance?.metadata, {
        enabled: useSchedulingOverride,
        selectedReasonCode: selectedOverrideReasonCode,
        customReason: customOverrideReason,
      }),
    };
  }

  async function commitEditUpdate(body) {
    setIsSaving(true);
    setError(null);

    try {
      await authenticatedFetch('calendar/instances', {
        method: 'PUT',
        body,
      });

      setEditPreview(null);
      setEditPreviewError('');
      setPendingEditBody(null);
      setIsEditMode(false);
      onUpdate?.();
    } catch (err) {
      console.error('Error updating lesson:', err);
      const handled = await handleVersionConflict(err, createSaveConflictAdapter(), {
        formData: { ...formData },
        useSchedulingOverride,
        selectedOverrideReasonCode,
        customOverrideReason,
      });
      if (!handled) {
        setError(resolveMutationError(err));
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSave() {
    setError(null);
    setEditPreviewError('');
    setEditPreview(null);
    setPendingEditBody(null);

    let body;
    try {
      body = buildEditUpdateBody();
    } catch (err) {
      setError(resolveMutationError(err));
      return;
    }

    setEditPreviewLoading(true);
    try {
      const payload = await authenticatedFetch('calendar/instances', {
        method: 'PUT',
        body: {
          ...body,
          action: 'preview-update-instance',
        },
      });

      setEditPreview(payload?.preview || null);
      setPendingEditBody(body);
    } catch (err) {
      setEditPreview(null);
      setPendingEditBody(null);
      setEditPreviewError(resolveMutationError(err));
    } finally {
      setEditPreviewLoading(false);
    }
  }

  async function confirmEditPreview() {
    if (!pendingEditBody) {
      setEditPreviewError('אין פעולה מוכנה לשמירה.');
      return;
    }
    if (editPreview?.can_apply === false) {
      setEditPreviewError('התצוגה המקדימה חסמה את השמירה.');
      return;
    }
    await commitEditUpdate(pendingEditBody);
  }

  async function handleMarkAttendance(participantId, status, notes, options = {}) {
    if (!org?.id) {
      setError('Organization not found');
      return false;
    }
    setIsMarkingAttendance(true);
    setError(null);
    setAbsenceFormError('');
    setRestorePreviewError('');

    try {
      const body = {
        org_id: org.id,
        instance_id: instance.id,
        participant_id: participantId,
        participant_status: status,
        instance_version: instance.version,
        participant_version: displayParticipants.find((participant) => participant.id === participantId)?.version,
      };
      if (typeof notes === 'string') {
        body.notes = notes.trim();
      }
      if (options.instructorCompensationDecision) {
        body.instructor_compensation_decision = options.instructorCompensationDecision;
      }
      if (options.isExcused === true) {
        body.is_excused = true;
        body.reason = typeof notes === 'string' ? notes.trim() : null;
      }
      const result = await authenticatedFetch('calendar/attendance', {
        method: 'POST',
        body,
      });

      if (result?.billing_warnings?.length > 0) {
        setBillingWarnings(result.billing_warnings);
      }
      setRestorePreview(null);
      setRestorePreviewError('');
      if (status === 'scheduled') {
        setLocalReminderState((prev) => ({
          ...prev,
          [participantId]: {
            ...(prev[participantId] || {}),
            reminder_sent: false,
            reminder_seen: false,
          },
        }));
      }
      onUpdate?.();
      toast.success(
        status === 'scheduled'
          ? 'סטטוס המשתתף/ת שוחזר למתוכנן.'
          : `סטטוס המשתתף/ת עודכן ל-${getParticipantStatusLabel(status)}.`
      );
      return { ok: true, error: null };
    } catch (err) {
      console.error('Error marking attendance:', err);
      const participant = displayParticipants.find((entry) => entry.id === participantId);
      const handled = await handleVersionConflict(err, createAttendanceConflictAdapter(), {
        participantId,
        participantName: getParticipantDisplayName(participant, 'לקוח/ה'),
        requestedStatus: status,
        notes: typeof notes === 'string' ? notes : '',
        instructorCompensationDecision: options.instructorCompensationDecision || null,
        isExcused: options.isExcused === true,
      });
      if (!handled) {
        const resolvedError = resolveMutationError(err) || 'עדכון הסטטוס נכשל.';
        setError(resolvedError);
        toast.error(resolvedError);
        return { ok: false, error: resolvedError };
      }
      return { ok: false, error: null };
    } finally {
      setIsMarkingAttendance(false);
    }
  }

  function openAbsenceForm(participantId, options = {}) {
    const participant = displayParticipants.find((entry) => entry.id === participantId);
    const existingStatus = participant?.participant_status;
    const existingNotes = typeof participant?.metadata?.notes === 'string' ? participant.metadata.notes : '';
    const existingCompensationDecision = participant?.metadata?.workflow?.instructor_compensation?.decision;
    const requestedStatus = typeof options?.status === 'string' ? options.status : '';
    const nextStatus = ['no_show', 'cancelled_student', 'cancelled_clinic'].includes(requestedStatus)
      ? requestedStatus
      : (['no_show', 'cancelled_student', 'cancelled_clinic'].includes(existingStatus)
      ? existingStatus
      : 'no_show');

    setAbsenceForm({
      participantId,
      status: nextStatus,
      notes: existingNotes,
      waiveFee: false,
      instructorCompensationDecision:
        existingCompensationDecision === 'compensated' || existingCompensationDecision === 'not_compensated'
          ? existingCompensationDecision
          : '',
    });
    setAbsenceFormError('');
    setAbsenceRequirements(null);
  }

  function handleAbsenceStatusChange(nextStatus) {
    setAbsenceForm((prev) => {
      if (!prev) return prev;
      if (prev.status === nextStatus) {
        return prev;
      }
      return {
        ...prev,
        status: nextStatus,
        waiveFee: shouldShowGraceWaiver(billingPolicy, nextStatus) ? prev.waiveFee : false,
        instructorCompensationDecision: '',
      };
    });
    setAbsenceFormError('');
    setAbsenceRequirements(null);
  }

  function closeAbsenceForm() {
    setAbsenceForm(null);
    setAbsenceFormError('');
    setAbsenceRequirements(null);
    setAbsenceRequirementsLoading(false);
    setFeeWaiverConfirmOpen(false);
  }

  async function confirmAbsenceForm({ feeWaiverConfirmed = false } = {}) {
    if (!absenceForm) return;
    const graceWaiverEligible = shouldShowGraceWaiver(billingPolicy, absenceForm.status);
    const shouldApplyGraceWaiver = graceWaiverEligible && absenceForm.waiveFee === true;
    if (
      shouldApplyGraceWaiver
      && !feeWaiverConfirmed
    ) {
      setFeeWaiverConfirmOpen(true);
      return;
    }

    setFeeWaiverConfirmOpen(false);
    setAbsenceFormError('');
    const requiresCompensationDecision = Boolean(absenceRequirements?.requires_instructor_compensation_decision);
    const selectedCompensationDecision = absenceForm.instructorCompensationDecision || null;
    if (absenceRequirementsLoading) {
      const loadingMessage = 'טוען את דרישות הסטטוס, נסו שוב בעוד רגע.';
      setAbsenceFormError(loadingMessage);
      setError(loadingMessage);
      return;
    }
    if (!absenceRequirements) {
      const requirementsMessage = 'לא ניתן לאשר אי-הגעה לפני טעינת דרישות הסטטוס מהשרת.';
      setAbsenceFormError(requirementsMessage);
      setError(requirementsMessage);
      toast.error(requirementsMessage);
      return;
    }
    if (requiresCompensationDecision && !absenceForm.instructorCompensationDecision) {
      const validationMessage = 'יש לבחור אם המדריך אמור לקבל פיצוי עבור אי-ההגעה המחויבת.';
      setAbsenceFormError(validationMessage);
      setError(validationMessage);
      toast.error(validationMessage);
      return;
    }
    const currentParticipant = displayParticipants.find((entry) => entry.id === absenceForm.participantId);
    if (!currentParticipant) {
      const missingParticipantMessage = 'לא ניתן למצוא את המשתתף/ת לעדכון.';
      setAbsenceFormError(missingParticipantMessage);
      setError(missingParticipantMessage);
      toast.error(missingParticipantMessage);
      return;
    }
    const currentStatus = currentParticipant?.participant_status || 'scheduled';
    if (currentStatus !== 'scheduled' && currentStatus !== absenceForm.status) {
      await openAttendancePreview(currentParticipant, absenceForm.status, {
        notes: absenceForm.notes,
        instructorCompensationDecision: selectedCompensationDecision,
        isExcused: shouldApplyGraceWaiver,
      });
      return;
    }
    const attendanceResult = await handleMarkAttendance(
      absenceForm.participantId,
      absenceForm.status,
      absenceForm.notes,
      {
        instructorCompensationDecision: selectedCompensationDecision,
        isExcused: shouldApplyGraceWaiver,
      },
    );
    if (attendanceResult?.ok) {
      setAbsenceForm(null);
      setAbsenceFormError('');
    } else {
      setAbsenceFormError(attendanceResult?.error || 'עדכון סטטוס אי-הגעה נכשל.');
    }
  }

  async function handleCancel(status) {
    if (!org?.id) {
      setError('Organization not found');
      return;
    }
    setIsSaving(true);
    setError(null);

    try {
      await authenticatedFetch('calendar/instances', {
        method: 'PUT',
        body: {
          id: instance.id,
          org_id: org.id,
          status,
          expected_version: instance.version,
        },
      });

      onUpdate?.();
      onClose();
    } catch (err) {
      console.error('Error cancelling lesson:', err);
      const handled = await handleVersionConflict(err, createCancelConflictAdapter(), {
        requestedStatus: status,
      });
      if (!handled) {
        setError(resolveMutationError(err));
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function openCancelPreview() {
    if (!org?.id || !instance?.id) return;
    const requestId = latestCancelPreviewRequestIdRef.current + 1;
    latestCancelPreviewRequestIdRef.current = requestId;
    setCancelPreviewLoading(true);
    setCancelPreviewError('');
    setError(null);

    try {
      const result = await authenticatedFetch('calendar/instances', {
        method: 'PUT',
        body: {
          action: 'preview-cancel-instance',
          id: instance.id,
          org_id: org.id,
          expected_version: instance.version,
        },
      });
      if (requestId !== latestCancelPreviewRequestIdRef.current) {
        return;
      }
      setCancelPreview(result?.preview || null);
      setCancelPreviewError('');
    } catch (err) {
      if (requestId !== latestCancelPreviewRequestIdRef.current) {
        return;
      }
      console.error('Error building cancel preview:', err);
      const resolvedError = resolveMutationError(err) || 'טעינת תצוגת ההשפעה לביטול נכשלה.';
      setCancelPreview(null);
      setCancelPreviewError(resolvedError);
      setError(resolvedError);
    } finally {
      if (requestId === latestCancelPreviewRequestIdRef.current) {
        setCancelPreviewLoading(false);
      }
    }
  }

  async function handleCancelSelection(status) {
    if (cancelPreviewLoading) {
      return;
    }
    if (!cancelPreview) {
      await openCancelPreview();
      return;
    }
    if (cancelPreview.can_cancel === false) {
      return;
    }
    setCancelDialogOpen(false);
    await handleCancel(status);
  }

  async function handleReportStatus(status) {
    if (!org?.id) {
      setError('Organization not found');
      return;
    }
    setIsSaving(true);
    setError(null);
    setBillingWarnings([]);

    try {
      const result = await authenticatedFetch('calendar/instances', {
        method: 'PUT',
        body: {
          id: instance.id,
          org_id: org.id,
          status,
          expected_version: instance.version,
        },
      });

      onUpdate?.();
      if (result?.billing_warnings?.length > 0) {
        // Keep dialog open so the user sees the billing warning
        setBillingWarnings(result.billing_warnings);
      } else {
        onClose();
      }
    } catch (err) {
      console.error('Error reporting lesson status:', err);
      const handled = await handleVersionConflict(err, createReportConflictAdapter(), {
        requestedStatus: status,
      });
      if (!handled) {
        setError(resolveMutationError(err));
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function searchStudents(query) {
    if (!org?.id || query.length < 2) {
      latestStudentSearchRequestIdRef.current += 1;
      setAddStudentResults([]);
      setIsSearchingStudents(false);
      return;
    }
    const requestId = latestStudentSearchRequestIdRef.current + 1;
    latestStudentSearchRequestIdRef.current = requestId;
    setIsSearchingStudents(true);
    setError(null);
    try {
      const results = await authenticatedFetch('students-search', {
        params: { q: query, org_id: org.id },
      });
      if (requestId !== latestStudentSearchRequestIdRef.current) {
        return;
      }
      setAddStudentResults(Array.isArray(results) ? results : []);
    } catch (err) {
      if (requestId !== latestStudentSearchRequestIdRef.current) {
        return;
      }
      setAddStudentResults([]);
      setError(resolveMutationError(err) || 'חיפוש תלמידים נכשל');
    } finally {
      if (requestId === latestStudentSearchRequestIdRef.current) {
        setIsSearchingStudents(false);
      }
    }
  }

  async function openAttendancePreview(participant, targetStatus, options = {}) {
    if (!org?.id || !instance?.id || !participant?.id) return;
    const requestId = latestPreviewRequestIdRef.current + 1;
    latestPreviewRequestIdRef.current = requestId;
    setRestorePreviewLoading(true);
    setError(null);
    setRestorePreviewError('');
    try {
      const isRestore = targetStatus === 'scheduled';
      const preview = await authenticatedFetch('calendar/attendance', {
        method: 'POST',
        body: {
          action: isRestore ? 'preview-restore-to-scheduled' : 'preview-participant-status-change',
          org_id: org.id,
          instance_id: instance.id,
          participant_id: participant.id,
          ...(isRestore ? {} : { target_participant_status: targetStatus }),
          ...(options.instructorCompensationDecision
            ? { instructor_compensation_decision: options.instructorCompensationDecision }
            : {}),
          ...(options.isExcused === true ? { is_excused: true } : {}),
        },
      });
      if (requestId !== latestPreviewRequestIdRef.current) {
        return;
      }
      setRestorePreview({
        participantId: participant.id,
        participantName: getParticipantDisplayName(participant, 'לקוח/ה'),
        targetStatus,
        notes: options.notes || '',
        instructorCompensationDecision: options.instructorCompensationDecision || null,
        isExcused: options.isExcused === true,
        preview,
      });
      if (targetStatus !== 'scheduled') {
        setAbsenceForm(null);
        setAbsenceFormError('');
      }
    } catch (err) {
      if (requestId !== latestPreviewRequestIdRef.current) {
        return;
      }
      console.error('Error building attendance preview:', err);
      const resolvedError = resolveMutationError(err) || 'טעינת תצוגת ההשפעה נכשלה.';
      setRestorePreviewError(resolvedError);
      setError(resolvedError);
      toast.error(resolvedError);
    } finally {
      if (requestId === latestPreviewRequestIdRef.current) {
        setRestorePreviewLoading(false);
      }
    }
  }

  async function openRestorePreview(participant) {
    await openAttendancePreview(participant, 'scheduled');
  }

  async function handleAddParticipant(studentId) {
    if (!org?.id || !instance?.id) return;
    setError(null);
    try {
      await authenticatedFetch('lesson-instances', {
        method: 'PATCH',
        body: {
          action: 'add-participant',
          org_id: org.id,
          instance_id: instance.id,
          student_id: studentId,
        },
      });
      setIsAddingParticipant(false);
      setAddStudentQuery('');
      setAddStudentResults([]);
      onUpdate?.();
    } catch (err) {
      setError(resolveMutationError(err));
    }
  }

  async function markReminderSent(participantId) {
    if (!org?.id) return;
    setReminderUpdating(true);
    try {
      await authenticatedFetch('calendar/attendance', {
        method: 'POST',
        body: {
          org_id: org.id,
          instance_id: instance.id,
          participant_id: participantId,
          action: 'update-reminder',
          reminder_sent: true,
        },
      });
      setLocalReminderState((prev) => ({
        ...prev,
        [participantId]: { ...(prev[participantId] || {}), reminder_sent: true },
      }));
      onUpdate?.();
    } catch (err) {
      console.error('Error marking reminder sent:', err);
    } finally {
      setReminderUpdating(false);
    }
  }

  async function handleSendWaReminder(participant) {
    const contact = resolveReminderContact(participant);
    const waPhone = formatPhoneForWhatsApp(contact.phone);
    if (!waPhone || !org?.id) return;
    const studentName = contact.name || 'לקוח/ה';
    const message = buildReminderMessage(displayInstance, studentName);
    window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
    await markReminderSent(participant.id);
  }

  function handleSendEmailReminder(participant) {
    const contact = resolveReminderContact(participant);
    const href = buildEmailReminderHref(displayInstance, contact);
    if (!href) return;
    window.open(href, '_blank', 'noopener,noreferrer');
    markReminderSent(participant.id);
  }

  async function handleSetReminderConfirmation(participant, approved) {
    if (!org?.id) return;
    setReminderUpdating(true);
    setError(null);
    try {
      if (approved) {
        await authenticatedFetch('calendar/attendance', {
          method: 'POST',
          body: {
            org_id: org.id,
            instance_id: instance.id,
            participant_id: participant.id,
            action: 'update-reminder',
            reminder_seen: true,
          },
        });
        setLocalReminderState((prev) => ({
          ...prev,
          [participant.id]: { ...(prev[participant.id] || {}), reminder_seen: true },
        }));
      } else {
        openAbsenceForm(participant.id, { status: 'cancelled_student' });
        return;
      }
      onUpdate?.();
    } catch (err) {
      console.error('Error setting reminder confirmation:', err);
      setError(err.message);
    } finally {
      setReminderUpdating(false);
    }
  }

  const schedulingOverrideState = useMemo(
    () => resolveSchedulingOverrideFormState(displayInstance?.metadata?.scheduling_override),
    [displayInstance?.metadata?.scheduling_override],
  );
  const schedulingOverrideReason = schedulingOverrideState.resolvedReason || '';
  const selectedInstructorCapability = useMemo(() => {
    const selectedInstructor = (instructors || []).find(
      (instructor) => String(instructor.id) === String(formData.instructor_employee_id || ''),
    );
    return (selectedInstructor?.service_capabilities || []).find(
      (capability) => String(capability.service_id) === String(formData.service_id || ''),
    ) || null;
  }, [formData.instructor_employee_id, formData.service_id, instructors]);
  const schedulingAvailabilityState = useMemo(() => resolveLessonSchedulingAvailability({
    capability: selectedInstructorCapability,
    date: formData.date,
    time: formData.time,
    durationMinutes: Number(formData.duration_minutes) || 0,
  }), [formData.date, formData.duration_minutes, formData.time, selectedInstructorCapability]);
  const activeServices = services?.filter(s => s.is_active) || [];
  const selectedEditService = useMemo(
    () => (services || []).find((service) => String(service.id) === String(formData.service_id || '')) || null,
    [formData.service_id, services],
  );
  const selectedEditServiceDurationMinutes = useMemo(
    () => Number(selectedEditService?.duration_minutes) || 0,
    [selectedEditService?.duration_minutes],
  );
  const selectedEditServiceHasValidDuration = selectedEditServiceDurationMinutes > 0;
  const formatEditPreviewValue = useCallback((field, value) => {
    if (value == null || value === '') {
      return '—';
    }

    if (field === 'datetime_start') {
      return `${formatDateDisplay(value)} ${formatTimeDisplay(value)}`;
    }

    if (field === 'duration_minutes') {
      return `${value} דקות`;
    }

    if (field === 'instructor_employee_id') {
      const instructor = (instructors || []).find((entry) => String(entry.id) === String(value));
      return instructor?.full_name || String(value);
    }

    if (field === 'service_id') {
      const service = (services || []).find((entry) => String(entry.id) === String(value));
      return service?.service_name || service?.name || String(value);
    }

    if (field === 'status') {
      return getParticipantStatusLabel(value);
    }

    if (field === 'documentation_status') {
      return value === 'documented' ? 'תועד' : 'ממתין לתיעוד';
    }

    return String(value);
  }, [instructors, services]);
  const isReportable = displayInstance?.status === 'scheduled';
  const isOperationallyOpen = !instance?.is_locked && !displayInstance?.is_closed;
  const displayWorkflowState = displayInstance?.metadata?.workflow_state && typeof displayInstance.metadata.workflow_state === 'object'
    ? displayInstance.metadata.workflow_state
    : null;
  const rawWorkflowState = instance?.metadata?.workflow_state && typeof instance.metadata.workflow_state === 'object'
    ? instance.metadata.workflow_state
    : null;
  const workflowState = resolveLatestWorkflowState(displayWorkflowState, rawWorkflowState);
  const workflowSummary = workflowState.summary && typeof workflowState.summary === 'object'
    ? workflowState.summary
    : {};
  const workflowReasonsOpen = Array.isArray(workflowState.reasons_open) ? workflowState.reasons_open : [];
  const computedAttendanceResolved = displayParticipants.length > 0
    ? displayParticipants.every((participant) => isResolvedParticipantStatus(participant?.participant_status))
    : null;
  const closureAttendanceResolved = computedAttendanceResolved !== null
    ? computedAttendanceResolved
    : resolveClosureStepState(workflowSummary, 'all_attendance_resolved', displayInstance?.is_closed === true);
  const studentBillingRequired = workflowSummary?.student_billing_required === true;
  const instructorCompensationRequired = workflowSummary?.instructor_compensation_required === true;
  const hmoClaimRequired = workflowSummary?.hmo_claim_required === true;
  const closureBillingResolved = closureAttendanceResolved === true
    ? resolveClosureStepState(workflowSummary, 'all_student_billing_resolved', displayInstance?.is_closed === true)
    : null;
  const closureCompensationResolved = closureAttendanceResolved === true
    ? resolveClosureStepState(workflowSummary, 'instructor_compensation_resolved', displayInstance?.is_closed === true)
    : null;
  const closureHmoResolved = closureAttendanceResolved === true
    ? resolveClosureStepState(workflowSummary, 'all_hmo_resolved', displayInstance?.is_closed === true)
    : null;
  const closureTotalCount = 1
    + (closureAttendanceResolved === true && studentBillingRequired ? 1 : 0)
    + (closureAttendanceResolved === true && instructorCompensationRequired ? 1 : 0)
    + (closureAttendanceResolved === true && hmoClaimRequired ? 1 : 0);
  const closureDoneCount = (closureAttendanceResolved === true ? 1 : 0)
    + (closureAttendanceResolved === true && studentBillingRequired && closureBillingResolved === true ? 1 : 0)
    + (closureAttendanceResolved === true && instructorCompensationRequired && closureCompensationResolved === true ? 1 : 0)
    + (closureAttendanceResolved === true && hmoClaimRequired && closureHmoResolved === true ? 1 : 0);
  const workflowEvaluatedAt = parseIsoDateSafe(workflowState?.evaluated_at) > 0
    ? new Intl.DateTimeFormat('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(workflowState.evaluated_at))
    : '';
  const lockRows = [
    ...(Array.isArray(instance?.locks?.instance) ? instance.locks.instance : []),
    ...(Array.isArray(instance?.locks?.participants) ? instance.locks.participants : []),
  ];
  const paidClaimBatchIds = Array.isArray(instance?.paid_claim_batch_ids) ? instance.paid_claim_batch_ids : [];
  const hardBlockedByPaidClaim = Boolean(
    instance?.hard_blocked_by_paid_claim
      || paidClaimBatchIds.length > 0
      || lockRows.some((lock) => lock.lock_source_type === 'claim_batch' && lock.claim_batch_status === 'paid'),
  );

  const canEdit = canManageAll && isOperationallyOpen;
  const canMarkAttendance = isOperationallyOpen;
  const canQuickReport = isReportable && isOperationallyOpen;

  const scheduledParticipantsCount = displayParticipants.filter(
    (p) => p.participant_status === 'scheduled'
  ).length;
  const attendedParticipants = displayParticipants.filter((participant) => participant.participant_status === 'attended');
  const resolvedParticipantsCount = displayParticipants.length - scheduledParticipantsCount;
  const clinicCancellationChargesClients = Boolean(billingPolicy?.cancelled_clinic);
  const clinicCancellationPaysInstructor = Boolean(instructorEarningsPolicy?.cancelled_clinic);
  const attendedParticipantNames = attendedParticipants
    .map((participant) => getParticipantDisplayName(participant, 'לקוח/ה'))
    .filter(Boolean);
  const cancelPreviewScheduledCount = typeof cancelPreview?.scheduled_participants_count === 'number'
    ? cancelPreview.scheduled_participants_count
    : scheduledParticipantsCount;
  const cancelPreviewResolvedCount = typeof cancelPreview?.resolved_participants_count === 'number'
    ? cancelPreview.resolved_participants_count
    : resolvedParticipantsCount;
  const cancelPreviewAttendedNames = Array.isArray(cancelPreview?.attended_participants)
    ? cancelPreview.attended_participants.map((participant) => participant?.name).filter(Boolean)
    : attendedParticipantNames;
  const cancelPreviewBlocked = cancelPreview?.can_cancel === false;
  // Block completing an instance when at least one participant still has no resolved attendance status.
  // An instance with zero participants is exempt (e.g. template-generated shells before enrolment).
  const hasUnsetParticipants =
    displayParticipants.length > 0 && scheduledParticipantsCount > 0;

  if (!instance || !displayInstance) return null;

  const openActions = getLessonOpenActions({
    ...displayInstance,
    participants: displayParticipants,
  });
  const participantCountLabel = displayParticipants.length === 1
    ? 'משתתף אחד'
    : `${displayParticipants.length} משתתפים`;
  const lessonIsBlocked = Boolean(instance.is_locked || hardBlockedByPaidClaim);
  const participantRosterPanel = (
    <LessonParticipantRoster
      displayParticipants={displayParticipants}
      localReminderState={localReminderState}
      absenceForm={absenceForm}
      setAbsenceForm={setAbsenceForm}
      absenceFormError={absenceFormError}
      absenceRequirements={absenceRequirements}
      absenceRequirementsLoading={absenceRequirementsLoading}
      restorePreview={restorePreview}
      restorePreviewLoading={restorePreviewLoading}
      restorePreviewError={restorePreviewError}
      setRestorePreview={setRestorePreview}
      setRestorePreviewError={setRestorePreviewError}
      billingPolicy={billingPolicy}
      canQuickReport={canQuickReport}
      hasUnsetParticipants={hasUnsetParticipants}
      scheduledParticipantsCount={scheduledParticipantsCount}
      canMarkAttendance={canMarkAttendance}
      canManageAll={canManageAll}
      reminderUpdating={reminderUpdating}
      isMarkingAttendance={isMarkingAttendance}
      isOperationallyOpen={isOperationallyOpen}
      openAttendancePreview={openAttendancePreview}
      openAbsenceForm={openAbsenceForm}
      handleAbsenceStatusChange={handleAbsenceStatusChange}
      closeAbsenceForm={closeAbsenceForm}
      confirmAbsenceForm={confirmAbsenceForm}
      openRestorePreview={openRestorePreview}
      handleMarkAttendance={handleMarkAttendance}
      handleSendWaReminder={handleSendWaReminder}
      handleSendEmailReminder={handleSendEmailReminder}
      handleSetReminderConfirmation={handleSetReminderConfirmation}
      showReminderActions={true}
      resolveReminderContact={resolveReminderContact}
      formatPhoneForWhatsApp={formatPhoneForWhatsApp}
      deriveDisplayWorkflowDecisions={deriveDisplayWorkflowDecisions}
      getWorkflowDecisionLabel={getWorkflowDecisionLabel}
      shouldShowGraceWaiver={shouldShowGraceWaiver}
      getCancellationStatusLabel={getCancellationStatusLabel}
      getCompensationDecisionLabel={getCompensationDecisionLabel}
      getParticipantStatusLabel={getParticipantStatusLabel}
      groupPreviewImpacts={groupPreviewImpacts}
      shortId={shortId}
      formatAgorotPreview={formatAgorotPreview}
    />
  );
  const openActionsPanel = openActions.length > 0 ? (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-amber-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">דורש תשומת לב לפני סגירה</div>
          <div className="mt-1 text-sm">
            נמצאו {openActions.length} פעולות פתוחות. טפלו בהן לפי הסדר כדי לשמור על רצף עבודה תקין.
          </div>
        </div>
        <Badge className="border-amber-300 bg-white text-amber-900">
          {openActions.length}
        </Badge>
      </div>
      <div className="mt-3 space-y-2">
        {openActions.map((action, index) => {
          const targetTab = getOpenActionTab(action.id);
          return (
            <div
              key={`${action.id}-${index}`}
              className={`rounded-xl border px-3 py-2 ${getOpenActionToneClass(action.tone)}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{index + 1}. {action.label}</div>
                  <div className="mt-1 text-sm opacity-85">{action.description}</div>
                </div>
                {targetTab !== 'overview' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setActiveViewTab(targetTab)}
                  >
                    פתח אזור מתאים
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  ) : (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-950">
      אין פעולות פתוחות כרגע. לפי הנתונים הנוכחיים אין משימה תפעולית שמונעת המשך עבודה.
    </div>
  );
  const resolutionPanel = (
    <LessonResolutionStatus
      metadata={displayInstance.metadata}
      isClosed={displayInstance.is_closed}
      workflowEvaluatedAt={workflowEvaluatedAt}
      closureDoneCount={closureDoneCount}
      closureTotalCount={closureTotalCount}
      closureAttendanceResolved={closureAttendanceResolved}
      closureBillingResolved={closureBillingResolved}
      closureCompensationResolved={closureCompensationResolved}
      closureHmoResolved={closureHmoResolved}
      studentBillingRequired={studentBillingRequired}
      instructorCompensationRequired={instructorCompensationRequired}
      hmoClaimRequired={hmoClaimRequired}
      workflowReasonsOpen={workflowReasonsOpen}
      getWorkflowReasonLabel={getWorkflowReasonLabel}
    />
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden p-0">
        <div className="shrink-0 space-y-4 border-b border-slate-200 bg-white p-6 pb-4">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>פרטי שיעור</span>
              {!isEditMode && canEdit && (
                <Button variant="ghost" size="sm" onClick={() => {
                  resetEditState();
                  setIsEditMode(true);
                }}>
                  <Pencil className="h-4 w-4 ms-2" />
                  עריכה
                </Button>
              )}
            </DialogTitle>
            <DialogDescription className="sr-only">צפייה ועריכת פרטי שיעור קיים.</DialogDescription>
          </DialogHeader>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {conflictState && (
            <Alert className="border-amber-400 bg-amber-50 text-amber-950">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              <AlertDescription className="space-y-3">
                <div className="font-medium">{conflictState.title}</div>
                <div className="text-sm">הפעולה שביקשתם: {conflictState.actionLabel}.</div>
                <div className="text-sm">המצב הנוכחי בשרת:</div>
                <ul className="list-disc pe-5 text-sm space-y-1">
                  {(conflictState.diffLines || []).map((line, index) => (
                    <li key={`${line}-${index}`}>{line}</li>
                  ))}
                </ul>
                <div className="flex gap-2 justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={clearConflict}
                    disabled={isResolvingConflict}
                  >
                    ביטול
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => applyConflictOverride({
                      onUnhandledError: (err) => {
                        console.error('Error overriding conflict:', err);
                        setError(resolveMutationError(err));
                      },
                    })}
                    disabled={isResolvingConflict}
                  >
                    {isResolvingConflict ? (
                      <>
                        <Loader2 className="me-2 h-4 w-4 animate-spin" />
                        מחיל...
                      </>
                    ) : (
                      'החל בכל זאת'
                    )}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {billingWarnings.length > 0 && (() => {
            const participantMap = new Map(
              displayParticipants.flatMap((participant) => {
                const displayName = getParticipantDisplayName(participant, 'לקוח/ה');
                return [
                  participant?.student_id ? [`student:${participant.student_id}`, displayName] : null,
                  participant?.client_profile_id ? [`client:${participant.client_profile_id}`, displayName] : null,
                  participant?.student?.client_profile_id ? [`client:${participant.student.client_profile_id}`, displayName] : null,
                ].filter(Boolean);
              })
            );
            const names = billingWarnings
              .map((warning) => (
                participantMap.get(warning?.student_id ? `student:${warning.student_id}` : '')
                || participantMap.get(warning?.client_profile_id ? `client:${warning.client_profile_id}` : '')
                || 'לקוח/ה'
              ))
              .filter((v, i, a) => a.indexOf(v) === i)
              .join(', ');
            return (
              <Alert variant="warning" className="border-amber-400 bg-amber-50 text-amber-900">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription>
                  <strong>שיעור הושלם — אך ישנה בעיית חיוב</strong>
                  <br />
                  {`לא נמצאה מסגרת חיוב תקינה עבור: ${names}. יש לסדר זאת במסך הניהול המתאים כדי שהחיוב יתבצע.`}
                </AlertDescription>
              </Alert>
            );
          })()}

          {(instance.is_locked || instance.latest_correction) && canManageAll && !hardBlockedByPaidClaim && (
            <LockedCorrectionPanel
              instance={instance}
              orgId={org?.id}
              forceOpen={Boolean(error && instance.is_locked)}
              onApplied={() => onUpdate?.()}
            />
          )}

          {hardBlockedByPaidClaim && canManageAll && (
            <Alert className="border-red-300 bg-red-50 text-red-950">
              <AlertTriangle className="h-4 w-4 text-red-700" />
              <AlertDescription>
                <div className="font-medium">השיעור חסום לתיקון בגלל תביעה ששולמה.</div>
                <div className="text-sm">לא ניתן לפתוח תיקון לשיעור זה. יש להעביר את האירוע לטיפול ידני.</div>
              </AlertDescription>
            </Alert>
          )}

          {schedulingOverrideReason && !isEditMode && (
            <Alert className="border-amber-300 bg-amber-50 text-amber-950">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              <AlertDescription>
                <div className="font-medium">שיעור זה מסומן כחריגה חד-פעמית.</div>
                <div className="mt-1 text-sm">הסיבה שנשמרה: {schedulingOverrideReason}</div>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">

        {isEditMode ? (
          // Edit Mode
          <div className="space-y-4">
            {/* Service */}
            <div>
              <Label htmlFor="service">שירות *</Label>
              <Select
                value={formData.service_id || ''}
                onValueChange={(value) => {
                  const nextService = (services || []).find((service) => String(service.id) === String(value)) || null;
                  setFormData({
                    ...formData,
                    service_id: value,
                    duration_minutes: Number(nextService?.duration_minutes) || formData.duration_minutes,
                  });
                }}
                disabled={servicesLoading}
              >
                <SelectTrigger id="service">
                  <SelectValue placeholder="בחר שירות" />
                </SelectTrigger>
                <SelectContent>
                  {activeServices.map((service) => (
                    <SelectItem key={service.id} value={service.id}>
                      {service.service_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Instructor */}
            <div>
              <Label htmlFor="instructor">מדריך *</Label>
              <Select
                value={formData.instructor_employee_id || ''}
                onValueChange={(value) => setFormData({ ...formData, instructor_employee_id: value })}
                disabled={instructorsLoading}
              >
                <SelectTrigger id="instructor">
                  <SelectValue placeholder="בחר מדריך" />
                </SelectTrigger>
                <SelectContent>
                  {instructors.map((instructor) => (
                    <SelectItem key={instructor.id} value={instructor.id}>
                      {instructor.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date */}
            <div>
              <Label htmlFor="date">תאריך *</Label>
              <Input
                id="date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                required
              />
            </div>

            {/* Time */}
            <div>
              <Label htmlFor="time">שעה *</Label>
              <Input
                id="time"
                type="time"
                value={formData.time}
                onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                required
              />
            </div>

            {/* Duration */}
            <div>
              <Label htmlFor="duration">משך (דקות)</Label>
              <div id="duration" className="flex min-h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">
                {selectedEditService
                  ? (selectedEditServiceHasValidDuration ? `${formData.duration_minutes} דקות` : 'לשירות אין משך תקין')
                  : `${formData.duration_minutes || 0} דקות`}
              </div>
            </div>

            {selectedEditService && !selectedEditServiceHasValidDuration ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>לשירות שנבחר אין משך תקין. יש לעדכן את משך השירות לפני שמירת השיעור.</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="lesson-scheduling-override"
                  checked={useSchedulingOverride}
                  onCheckedChange={(checked) => setUseSchedulingOverride(checked === true)}
                  disabled={schedulingAvailabilityState.status === 'missing_capability' || schedulingAvailabilityState.status === 'missing_availability'}
                />
                <div className="space-y-1">
                  <Label htmlFor="lesson-scheduling-override">שיבוץ חד-פעמי חריג</Label>
                  <p className="text-sm text-slate-600">
                    מאפשר לשמור שיעור מחוץ לחלונות הזמינות של המדריך/ה כשיש צורך תפעולי נקודתי.
                  </p>
                </div>
              </div>

              {(schedulingAvailabilityState.status === 'missing_capability' || schedulingAvailabilityState.status === 'missing_availability') && (
                <Alert className="border-red-300 bg-red-50 text-red-950">
                  <AlertTriangle className="h-4 w-4 text-red-700" />
                  <AlertDescription>{schedulingAvailabilityState.message}</AlertDescription>
                </Alert>
              )}

              {schedulingAvailabilityState.status === 'outside_instructor_service_availability' && (
                <Alert className="border-amber-300 bg-amber-50 text-amber-950">
                  <AlertTriangle className="h-4 w-4 text-amber-700" />
                  <AlertDescription>
                    {useSchedulingOverride
                      ? 'השיעור יישמר כחריגה חד-פעמית מחלונות הזמינות.'
                      : 'המועד שנבחר מחוץ לזמינות. כדי לשמור אותו יש לסמן חריגה חד-פעמית ולציין סיבה.'}
                  </AlertDescription>
                </Alert>
              )}

              {useSchedulingOverride && (
                <div className="space-y-2">
                  <Label htmlFor="lesson-override-reason-code">סיבת החריגה *</Label>
                  <Select value={selectedOverrideReasonCode || ''} onValueChange={setSelectedOverrideReasonCode}>
                    <SelectTrigger id="lesson-override-reason-code">
                      <SelectValue placeholder="בחרו סיבה" />
                    </SelectTrigger>
                    <SelectContent>
                      {SCHEDULING_OVERRIDE_REASON_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedOverrideReasonCode === 'custom' ? (
                    <Textarea
                      id="lesson-override-custom-reason"
                      rows={3}
                      value={customOverrideReason}
                      onChange={(event) => setCustomOverrideReason(event.target.value)}
                      placeholder="כתבו סיבה מותאמת אישית רק אם היא לא קיימת ברשימה."
                    />
                  ) : null}
                </div>
              )}
            </div>

            {/* Status */}
            <div>
              <Label htmlFor="status">סטטוס</Label>
              <Select
                value={formData.status || 'scheduled'}
                onValueChange={(value) => setFormData({ ...formData, status: value })}
              >
                <SelectTrigger id="status">
                  <SelectValue placeholder="בחר סטטוס" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="scheduled">מתוכנן</SelectItem>
                  <SelectItem value="cancelled">בוטל</SelectItem>
                  <SelectItem value="completed">הושלם</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(editPreviewLoading || editPreviewError || editPreview) ? (
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">תצוגה מקדימה לשמירה</div>
                  <div className="mt-1 text-xs text-slate-500">
                    הבדיקה מתבצעת מול מצב השרת הנוכחי לפני שמירה בפועל.
                  </div>
                </div>

                {editPreviewLoading ? (
                  <Alert>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <AlertDescription>בונה תצוגה מקדימה...</AlertDescription>
                  </Alert>
                ) : null}

                {editPreviewError ? (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{editPreviewError}</AlertDescription>
                  </Alert>
                ) : null}

                {editPreview ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium text-slate-800">שינויים שיישמרו</div>
                      <Badge variant={editPreview.can_apply ? 'outline' : 'destructive'}>
                        {editPreview.can_apply ? 'ניתן לשמור' : 'חסום'}
                      </Badge>
                    </div>

                    {(editPreview.changes || []).length > 0 ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {editPreview.changes.map((change) => (
                          <div key={change.field} className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs">
                            <div className="font-semibold text-slate-800">{change.label}</div>
                            <div className="mt-1 grid gap-1 text-slate-600">
                              <div>לפני: {formatEditPreviewValue(change.field, change.before)}</div>
                              <div>אחרי: {formatEditPreviewValue(change.field, change.after)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700">
                        לא זוהו שינויים לשמירה.
                      </div>
                    )}

                    {(editPreview.impacts || []).length > 0 ? (
                      <div className="space-y-2">
                        {(editPreview.impacts || []).map((impact, index) => (
                          <div key={`${impact.type || 'impact'}-${index}`} className={`rounded-xl border px-3 py-2 text-sm ${getPreviewImpactClass(impact.severity)}`}>
                            <div className="font-semibold">{impact.label || 'השפעה'}</div>
                            <div className="mt-0.5 text-xs opacity-85">{impact.message}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

          </div>
        ) : (
          // View Mode
          <Tabs value={activeViewTab} onValueChange={setActiveViewTab} dir="rtl" className="space-y-5">
            <TabsList className="sticky top-0 z-10 grid h-auto w-full grid-cols-2 gap-1 border-b border-slate-200 bg-slate-100 p-1 text-slate-600 shadow-sm md:grid-cols-4">
              <TabsTrigger value="overview" className="py-2">
                סקירה
                {openActions.length > 0 ? (
                  <Badge variant="secondary" className="ms-2 h-5 min-w-5 rounded-full px-1 text-[11px]">
                    {openActions.length}
                  </Badge>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="participants" className="py-2">משתתפים</TabsTrigger>
              <TabsTrigger value="workflow" className="py-2">סגירה ותיעוד</TabsTrigger>
              <TabsTrigger value="admin" className="py-2">ניהול</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-5">
              {openActionsPanel}

              <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className={`text-3xl ${statusInfo.color}`}>{statusInfo.icon}</span>
                    <div>
                      <div className="text-lg font-semibold text-slate-950">
                        {displayInstance.service?.service_name || 'שירות לא ידוע'}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge variant={displayInstance.status === 'completed' ? 'default' : 'secondary'}>
                          {statusInfo.label}
                        </Badge>
                        <Badge variant={displayInstance.is_closed ? 'default' : 'outline'}>
                          {displayInstance.is_closed ? 'סגור תפעולית' : 'פתוח תפעולית'}
                        </Badge>
                        {instance.latest_correction && (
                          <Badge className="bg-sky-100 text-sky-800 border-sky-200">מציג ערך מתוקן</Badge>
                        )}
                        {schedulingOverrideReason && (
                          <Badge className="border-amber-200 bg-amber-100 text-amber-900">חריגה חד-פעמית</Badge>
                        )}
                        {lessonIsBlocked && (
                          <Badge variant="destructive">חסום לשינוי</Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {canQuickReport && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleReportStatus('completed')}
                      disabled={isSaving || hasUnsetParticipants}
                      title={
                        hasUnsetParticipants
                          ? `יש לסמן נוכחות ל-${scheduledParticipantsCount} תלמיד/ים לפני השלמת השיעור`
                          : 'סמן את השיעור כהושלם'
                      }
                    >
                      <Check className="h-4 w-4 ms-1" />
                      הושלם
                    </Button>
                  )}
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <DetailField label="תאריך">{dateDisplay || 'לא ידוע'}</DetailField>
                  <DetailField label="שעה">
                    {startTime && endTime ? `${startTime} - ${endTime}` : 'לא ידוע'}
                  </DetailField>
                  <DetailField label="משך">{displayInstance.duration_minutes || 0} דקות</DetailField>
                  <DetailField label="משתתפים">{participantCountLabel}</DetailField>
                  <DetailField label="מדריך" className="sm:col-span-2">
                    {displayInstance.instructor?.full_name || 'לא ידוע'}
                  </DetailField>
                  <DetailField label="שירות" className="sm:col-span-2">
                    <span className="inline-flex items-center gap-2">
                      {displayInstance.service?.color && (
                        <span
                          className="h-3 w-3 rounded"
                          style={{ backgroundColor: displayInstance.service.color }}
                        />
                      )}
                      {displayInstance.service?.service_name || 'לא ידוע'}
                    </span>
                  </DetailField>
                </div>
              </div>

              {schedulingOverrideReason ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700" />
                    <div>
                      <div className="text-sm font-semibold">חריגה חד-פעמית</div>
                      <div className="mt-1 text-sm">הסיבה שנשמרה: {schedulingOverrideReason}</div>
                    </div>
                  </div>
                </div>
              ) : null}

              {lessonIsBlocked ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-950">
                  <div className="text-sm font-semibold">השיעור מוגבל לשינוי ישיר</div>
                  <div className="mt-1 text-sm">
                    שינוי ישיר אינו זמין כאשר שיעור נעול או חסום פיננסית. פרטי הנעילה והפעולות האפשריות מוצגים מעל הטאבים.
                  </div>
                </div>
              ) : null}
            </TabsContent>

            <TabsContent value="participants" className="space-y-4">
              {/* Section header: participant count + add button */}
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-700">
                  {displayParticipants.length === 0
                    ? 'אין משתתפים'
                    : displayParticipants.length === 1
                      ? 'משתתף אחד'
                      : `${displayParticipants.length} משתתפים`}
                </p>
                {canManageAll && isReportable && !instance?.is_locked && !isAddingParticipant && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsAddingParticipant(true)}
                  >
                    <UserPlus className="h-4 w-4 ms-1.5" />
                    הוסף תלמיד
                  </Button>
                )}
              </div>

              {/* Add participant search — shown inline when active */}
              {isAddingParticipant && (
                <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 space-y-2">
                  <div className="flex gap-2">
                    <Input
                      placeholder="חפש תלמיד (2 תווים לפחות)..."
                      value={addStudentQuery}
                      onChange={(e) => {
                        setAddStudentQuery(e.target.value);
                        searchStudents(e.target.value);
                      }}
                      className="flex-1 h-8 text-sm"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2"
                      onClick={() => {
                        setIsAddingParticipant(false);
                        setAddStudentQuery('');
                        setAddStudentResults([]);
                      }}
                      aria-label="סגור חיפוש"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  {isSearchingStudents && (
                    <div className="flex items-center gap-1 text-sm text-slate-500">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      מחפש...
                    </div>
                  )}
                  {!isSearchingStudents && addStudentResults.length > 0 && (() => {
                    const enrolledIds = new Set(displayParticipants.map((p) => p.student_id));
                    const filtered = addStudentResults.filter((s) => !enrolledIds.has(s.id));
                    return filtered.length === 0 ? (
                      <p className="text-xs text-slate-400">כל התלמידים שנמצאו כבר רשומים לשיעור</p>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {filtered.map((student) => (
                          <button
                            key={student.id}
                            type="button"
                            className="w-full text-start text-sm px-2 py-1.5 rounded-lg hover:bg-blue-100 flex items-center justify-between"
                            onClick={() => handleAddParticipant(student.id)}
                          >
                            <span className="font-medium">
                              {[student.first_name, student.last_name].filter(Boolean).join(' ')}
                            </span>
                            {student.phone && (
                              <span className="text-xs text-slate-500">{student.phone}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                  {!isSearchingStudents && addStudentQuery.length >= 2 && addStudentResults.length === 0 && (
                    <p className="text-sm text-slate-500">לא נמצאו תלמידים</p>
                  )}
                  {addStudentQuery.length === 1 && (
                    <p className="text-xs text-slate-400">הקלד לפחות 2 תווים לחיפוש</p>
                  )}
                </div>
              )}

              {/* Participant roster */}
              {displayParticipants.length > 0 ? participantRosterPanel : (
                <EmptyTabState
                  title="אין משתתפים בשיעור"
                  description="כאשר יתווספו תלמידים, ניהול הנוכחות והסטטוסים שלהם יופיע כאן."
                />
              )}
            </TabsContent>

            <TabsContent value="workflow" className="space-y-4">
              {resolutionPanel}
              {displayInstance.documentation_status ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-900">סטטוס תיעוד</div>
                  <div className="mt-2">
                    <Badge
                      variant={displayInstance.documentation_status === 'documented' ? 'default' : 'secondary'}
                    >
                      {displayInstance.documentation_status === 'documented' ? 'תועד' : 'ממתין לתיעוד'}
                    </Badge>
                  </div>
                </div>
              ) : (
                <EmptyTabState
                  title="אין סטטוס תיעוד לשיעור"
                  description="כאשר השיעור ידרוש תיעוד או יסומן כמתועד, הסטטוס יוצג כאן."
                />
              )}
            </TabsContent>

            <TabsContent value="admin" className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-semibold text-slate-900">פרטי מקור ובקרה</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <DetailField label="מקור יצירה">{displayInstance.created_source || 'לא ידוע'}</DetailField>
                  <DetailField label="מזהה שיעור">{shortId(displayInstance.id) || 'לא זמין'}</DetailField>
                  <DetailField label="גרסה">{displayInstance.version ?? 'לא זמין'}</DetailField>
                  <DetailField label="מצב נעילה">{lessonIsBlocked ? 'מוגבל לשינוי' : 'לא נעול'}</DetailField>
                </div>
              </div>

              {canEdit && !isCancellationStatus(displayInstance.status) ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                  <div className="mb-3">
                    <div className="text-sm font-semibold text-red-950">פעולה רגישה</div>
                    <div className="mt-1 text-sm text-red-900">
                      ביטול שיעור פותח תצוגת השפעה מקדימה מהשרת לפני ביצוע הפעולה.
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    onClick={() => setCancelDialogOpen(true)}
                    disabled={isSaving}
                  >
                    <X className="me-2 h-4 w-4" />
                    בטל שיעור
                  </Button>
                </div>
              ) : (
                <EmptyTabState
                  title="אין פעולות ניהול זמינות"
                  description="אין פעולה ניהולית זמינה לשיעור במצבו הנוכחי או לפי ההרשאות שלך."
                />
              )}
            </TabsContent>
          </Tabs>
        )}
        </div>
        {isEditMode ? (
          <div className="shrink-0 border-t border-slate-200 bg-white p-4">
            {editPreview && pendingEditBody ? (
              <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
                השינויים נבדקו — ניתן לאשר
              </div>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  resetEditState();
                  setIsEditMode(false);
                }}
                disabled={isSaving || editPreviewLoading}
              >
                ביטול
              </Button>
              {editPreview && pendingEditBody ? (
                <Button
                  onClick={confirmEditPreview}
                  disabled={isSaving || editPreviewLoading || editPreview.can_apply === false}
                  className="min-w-36 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 focus-visible:ring-emerald-600"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="me-2 h-4 w-4 animate-spin" />
                      שומר...
                    </>
                  ) : (
                    <>
                      <Check className="me-2 h-4 w-4" />
                      אשר ושמור
                    </>
                  )}
                </Button>
              ) : (
                <Button onClick={handleSave} disabled={isSaving || editPreviewLoading || (selectedEditService && !selectedEditServiceHasValidDuration)}>
                  {editPreviewLoading ? (
                    <>
                      <Loader2 className="me-2 h-4 w-4 animate-spin" />
                      בודק...
                    </>
                  ) : isSaving ? (
                    <>
                      <Loader2 className="me-2 h-4 w-4 animate-spin" />
                      שומר...
                    </>
                  ) : (
                    'בדוק שינויים'
                  )}
                </Button>
              )}
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
      <Dialog
        open={cancelDialogOpen}
        onOpenChange={(openValue) => {
          setCancelDialogOpen(openValue);
          if (!openValue) {
            latestCancelPreviewRequestIdRef.current += 1;
            setCancelPreview(null);
            setCancelPreviewError('');
            setCancelPreviewLoading(false);
            return;
          }
          void openCancelPreview();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ביטול שיעור</DialogTitle>
            <DialogDescription>
              הפעולה תסמן את השיעור כמבוטל ותעדכן את המשתתפים שעדיין מתוכננים לביטול ע"י המרפאה.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {cancelPreviewLoading && (
              <Alert>
                <Loader2 className="h-4 w-4 animate-spin" />
                <AlertDescription>טוען תצוגה מקדימה עדכנית מהשרת...</AlertDescription>
              </Alert>
            )}
            {cancelPreviewError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{cancelPreviewError}</AlertDescription>
              </Alert>
            )}
            {!cancelPreviewLoading && !cancelPreviewError && cancelPreviewBlocked ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  לא ניתן לבטל שיעור שבו כבר סומנה נוכחות. יש להסדיר קודם את: {cancelPreviewAttendedNames.join(', ')}.
                </AlertDescription>
              </Alert>
            ) : null}
            {!cancelPreviewLoading && !cancelPreviewError && !cancelPreviewBlocked ? (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {cancelPreviewScheduledCount > 0
                    ? `${cancelPreviewScheduledCount} משתתפים/ות שעדיין במצב מתוכנן יסומנו כ-"בוטל ע"י המרפאה". ${cancelPreviewResolvedCount > 0 ? `${cancelPreviewResolvedCount} משתתפים/ות שכבר הוכרעו יישארו ללא שינוי.` : ''}`
                    : 'לשיעור הזה אין משתתפים במצב מתוכנן, ולכן הפעולה תעדכן רק את סטטוס השיעור עצמו.'}
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div className="font-medium text-slate-900">השפעת מדיניות הארגון</div>
              <ul className="mt-3 space-y-2">
                <li>
                  {clinicCancellationChargesClients
                    ? 'חיוב לקוח/ה: לפי מדיניות הארגון, ביטול ע"י המרפאה עדיין מסומן כחיוב רלוונטי.'
                    : 'חיוב לקוח/ה: לפי מדיניות הארגון, ביטול ע"י המרפאה לא יחייב את הלקוח/ה.'}
                </li>
                <li>
                  {clinicCancellationPaysInstructor
                    ? 'שכר מדריך/ה: לפי מדיניות הארגון, ביטול ע"י המרפאה עדיין מזכה את המדריך/ה.'
                    : 'שכר מדריך/ה: לפי מדיניות הארגון, ביטול ע"י המרפאה לא מזכה את המדריך/ה.'}
                </li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCancelDialogOpen(false)} disabled={isSaving || cancelPreviewLoading}>
              חזרה
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => handleCancelSelection('cancelled')}
              disabled={isSaving || cancelPreviewLoading || Boolean(cancelPreviewError) || cancelPreviewBlocked}
            >
              בטל שיעור
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={feeWaiverConfirmOpen} onOpenChange={setFeeWaiverConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>אישור ויתור חיוב</DialogTitle>
            <DialogDescription>
              אישור ויתור החיוב ימנע מיצירת חיוב עבור התלמיד, גם אם הגדרת הארגון היא לחייב במקרה זה.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFeeWaiverConfirmOpen(false)} disabled={isMarkingAttendance}>
              חזרה
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => { void confirmAbsenceForm({ feeWaiverConfirmed: true }); }}
              disabled={isMarkingAttendance}
            >
              אשר ויתור חיוב
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
