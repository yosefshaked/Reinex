import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/label';
import { Input } from '../../../components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../../components/ui/select';
import { formatTimeDisplay, formatDateDisplay, getInstanceStatusIcon } from '../utils/timeGrid';
import { Badge } from '../../../components/ui/badge';
import { useOrg } from '@/org/OrgContext';
import { useServices } from '@/hooks/useOrgData';
import { useCalendarInstructors } from '../hooks/useCalendar';
import { authenticatedFetch } from '@/lib/api-client.js';
import { toast } from 'sonner';
import { Pencil, X, Check, XCircle, Loader2, AlertCircle, AlertTriangle, MessageCircle, Mail, ThumbsUp, ThumbsDown, UserPlus, RotateCcw } from 'lucide-react';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Textarea } from '../../../components/ui/textarea';
import { LockedCorrectionPanel } from './LockedCorrectionPanel';
import { useVersionConflictResolver } from './useVersionConflictResolver';

const DEFAULT_BILLING_POLICY = {
  attended: true,
  no_show: false,
  cancelled_student: false,
  cancelled_clinic: false,
};

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

function isCancellationStatus(status) {
  return status === 'cancelled_student' || status === 'cancelled_clinic';
}

function getCancellationStatusLabel(status) {
  if (status === 'cancelled_student') return 'בוטל ע"י תלמיד';
  if (status === 'cancelled_clinic') return 'בוטל ע"י המרפאה';
  if (status === 'no_show') return 'אי הגעה';
  return 'ביטול';
}

function getDisplayInstance(instance) {
  return instance?.latest_correction?.effective_state?.instance
    ? { ...instance, ...instance.latest_correction.effective_state.instance }
    : instance;
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
  return error?.message || 'הפעולה נכשלה.';
}

function getParticipantStatusLabel(status) {
  if (status === 'attended') return 'נכח';
  if (status === 'no_show') return 'לא הגיע';
  if (status === 'cancelled_student') return 'בוטל ע"י תלמיד';
  if (status === 'cancelled_clinic') return 'בוטל ע"י המכון';
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
    if (decision === 'pending') return 'ממתין להגשת תביעה';
    if (decision === 'required') return 'נדרשת תביעה';
    if (decision === 'not_required') return 'לא נדרשת תביעה';
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
  const studentBillingDecision = workflow.student_billing?.decision || 'unknown';
  const compensationDecision = workflow.instructor_compensation?.decision || 'unknown';
  const hmoDecision = workflow.hmo_claim?.decision || 'unknown';
  const hasResolvedStatus = ['attended', 'no_show', 'cancelled_student', 'cancelled_clinic'].includes(status);
  const hasChargeArtifact = Number(participant?.price_charged || 0) > 0
    || participant?.pricing_breakdown?.billing_status === 'charged';
  const persistedBillingStatus = String(participant?.pricing_breakdown?.billing_status || '').trim().toLowerCase();
  let resolvedStudentBillingDecision = studentBillingDecision;
  if (persistedBillingStatus === 'charged') {
    resolvedStudentBillingDecision = 'resolved';
  } else if (persistedBillingStatus === 'not_chargeable') {
    resolvedStudentBillingDecision = 'not_applicable';
  } else if (studentBillingDecision === 'pending' && !billingPolicy?.[status]) {
    resolvedStudentBillingDecision = 'not_applicable';
  }

  return {
    studentBillingDecision: resolvedStudentBillingDecision !== 'unknown'
      ? resolvedStudentBillingDecision
      : (!hasResolvedStatus
        ? 'unknown'
        : (hasChargeArtifact
          ? 'resolved'
          : (billingPolicy?.[status] ? 'pending' : 'not_applicable'))),
    compensationDecision: compensationDecision !== 'unknown'
      ? compensationDecision
      : (status === 'attended'
        ? 'compensated'
        : 'unknown'),
    hmoDecision: hmoDecision !== 'unknown'
      ? hmoDecision
      : (status === 'scheduled' ? 'not_required' : 'unknown'),
  };
}

function getWorkflowReasonLabel(reason) {
  if (reason === 'attendance_unresolved') return 'יש משתתפים שטרם קיבלו סטטוס סופי.';
  if (reason === 'student_billing_unresolved') return 'יש חיוב תלמיד שעדיין לא הושלם.';
  if (reason === 'instructor_compensation_unresolved') return 'שכר המדריך עדיין לא נסגר דרך הרצת שכר.';
  if (reason === 'hmo_claim_unresolved') return 'יש תביעת גורם מממן שעדיין לא הושלמה.';
  if (reason === 'missing_instance') return 'פרטי השיעור אינם זמינים.';
  return reason || 'קיים שלב פתוח בתהליך הסגירה.';
}

function getImpactGroupMeta(type) {
  if (['billing_reversal', 'billing_charge', 'billing_update'].includes(type)) {
    return { key: 'billing', label: 'חיוב תלמיד', borderClass: 'border-amber-200', bgClass: 'bg-amber-50/70' };
  }
  if (['instructor_earning_reversal', 'instructor_earning_add', 'instructor_earning_update'].includes(type)) {
    return { key: 'payroll', label: 'שכר מדריך', borderClass: 'border-emerald-200', bgClass: 'bg-emerald-50/70' };
  }
  if (['instructor_attendance_remove', 'instructor_attendance_update', 'instructor_attendance_add'].includes(type)) {
    return { key: 'attendance', label: 'נוכחות מדריך', borderClass: 'border-sky-200', bgClass: 'bg-sky-50/70' };
  }
  if (type === 'hmo_task_resolve') {
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
      const participantName = latestParticipant.student?.full_name || beforeParticipant?.student?.full_name || 'התלמיד';
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
  const displayInstance = getDisplayInstance(instance);
  const displayParticipants = getDisplayParticipants(instance);
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
  const [restorePreview, setRestorePreview] = useState(null);
  const [restorePreviewError, setRestorePreviewError] = useState('');
  const [restorePreviewLoading, setRestorePreviewLoading] = useState(false);
  const [billingPolicy, setBillingPolicy] = useState(DEFAULT_BILLING_POLICY);
  const latestPreviewRequestIdRef = useRef(0);
  const latestStudentSearchRequestIdRef = useRef(0);
  
  const [formData, setFormData] = useState({
    instructor_employee_id: '',
    service_id: '',
    date: '',
    time: '',
    duration_minutes: 60,
    status: 'scheduled',
    closed_reason: '',
  });

  // Initialize form data when instance changes
  useEffect(() => {
    if (displayInstance) {
      const dateTime = new Date(displayInstance.datetime_start);
      setFormData({
        instructor_employee_id: displayInstance.instructor_employee_id || '',
        service_id: displayInstance.service_id || '',
        date: toLocalDateString(dateTime),
        time: dateTime.toTimeString().slice(0, 5),
        duration_minutes: displayInstance.duration_minutes || 60,
        status: displayInstance.status || 'scheduled',
        closed_reason: displayInstance.closed_reason || '',
      });
    }
  }, [displayInstance]);

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
    latestPreviewRequestIdRef.current += 1;
    latestStudentSearchRequestIdRef.current += 1;
  }, [instance?.id, instance?.latest_correction?.id]);

  useEffect(() => {
    if (!org?.id) {
      setBillingPolicy(DEFAULT_BILLING_POLICY);
      return undefined;
    }

    let cancelled = false;
    const loadBillingPolicy = async () => {
      try {
        const response = await authenticatedFetch('settings', {
          params: { org_id: org.id, key: 'billing_consumption_policy' },
        });
        if (!cancelled) {
          setBillingPolicy({
            ...DEFAULT_BILLING_POLICY,
            ...(response?.value && typeof response.value === 'object' ? response.value : {}),
          });
        }
      } catch (loadError) {
        console.error('Failed to load billing policy for attendance dialog:', loadError);
        if (!cancelled) {
          setBillingPolicy(DEFAULT_BILLING_POLICY);
        }
      }
    };

    void loadBillingPolicy();
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
    const student = participant?.student || null;
    const guardian = student?.primary_guardian || null;

    if (guardian) {
      return {
        source: 'guardian',
        name: [guardian.first_name, guardian.middle_name, guardian.last_name].filter(Boolean).join(' ') || 'הורה/אפוטרופוס',
        phone: guardian.phone || null,
        email: guardian.email || null,
      };
    }

    return {
      source: 'student',
      name: student?.full_name || [student?.first_name, student?.last_name].filter(Boolean).join(' ') || 'תלמיד',
      phone: student?.phone || null,
      email: student?.email || null,
    };
  }

  function buildEmailReminderHref(lessonInstance, contact) {
    if (!contact?.email) return null;
    const dayDate = formatReminderDayDate(lessonInstance.datetime_start);
    const service = lessonInstance.service?.service_name || 'שיעור';
    const studentName = contact.name || 'תלמיד';
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
        actionLabel: `סימון תלמיד כ-${getParticipantStatusLabel(payload.requestedStatus)}`,
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
        };
        if (isCancellationStatus(payload.formData.status) || payload.formData.status === 'no_show') {
          body.closed_reason = payload.formData.closed_reason || null;
        }
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
        actionLabel: 'עדכון סטטוס ביטול',
        diffLines: buildConflictLines(instance, latestValue),
      }),
      retry: async ({ latestValue, payload }) => {
        await authenticatedFetch('calendar/instances', {
          method: 'PUT',
          body: {
            id: latestValue.id,
            org_id: org.id,
            status: payload.requestedStatus,
            closed_reason: payload.closedReason || null,
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

  async function handleSave() {
    if (!org?.id) {
      setError('Organization not found');
      return;
    }

    if (formData.status === 'completed' && hasUnsetParticipants) {
      setError(
        `יש לסמן נוכחות לכל התלמידים לפני השלמת השיעור (${scheduledParticipantsCount} ${scheduledParticipantsCount === 1 ? 'תלמיד ממתין' : 'תלמידים ממתינים'})`
      );
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const datetime_start = toUtcIsoString(formData.date, formData.time);
      if (!datetime_start) {
        throw new Error('תאריך או שעה אינם תקינים.');
      }

      const body = {
        id: instance.id,
        org_id: org.id,
        datetime_start,
        duration_minutes: formData.duration_minutes,
        instructor_employee_id: formData.instructor_employee_id,
        service_id: formData.service_id,
        status: formData.status,
        expected_version: instance.version,
      };

      if (isCancellationStatus(formData.status) || formData.status === 'no_show') {
        body.closed_reason = formData.closed_reason || null;
      }

      await authenticatedFetch('calendar/instances', {
        method: 'PUT',
        body,
      });

      setIsEditMode(false);
      onUpdate?.();
    } catch (err) {
      console.error('Error updating lesson:', err);
      const handled = await handleVersionConflict(err, createSaveConflictAdapter(), {
        formData: { ...formData },
      });
      if (!handled) {
        setError(resolveMutationError(err));
      }
    } finally {
      setIsSaving(false);
    }
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
      const result = await authenticatedFetch('calendar/attendance', {
        method: 'POST',
        body,
      });

      if (result?.billing_warnings?.length > 0) {
        setBillingWarnings(result.billing_warnings);
      }
      if (status === 'scheduled') {
        setRestorePreview(null);
        setRestorePreviewError('');
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
          ? 'סטטוס התלמיד שוחזר למתוכנן.'
          : `סטטוס התלמיד עודכן ל-${getParticipantStatusLabel(status)}.`
      );
      return { ok: true, error: null };
    } catch (err) {
      console.error('Error marking attendance:', err);
      const participant = displayParticipants.find((entry) => entry.id === participantId);
      const handled = await handleVersionConflict(err, createAttendanceConflictAdapter(), {
        participantId,
        participantName: participant?.student?.full_name || 'תלמיד',
        requestedStatus: status,
        notes: typeof notes === 'string' ? notes : '',
        instructorCompensationDecision: options.instructorCompensationDecision || null,
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
  }

  async function confirmAbsenceForm() {
    if (!absenceForm) return;
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
      const missingParticipantMessage = 'לא ניתן למצוא את התלמיד לעדכון.';
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
      });
      return;
    }
    const attendanceResult = await handleMarkAttendance(
      absenceForm.participantId,
      absenceForm.status,
      absenceForm.notes,
      {
        instructorCompensationDecision: selectedCompensationDecision,
      },
    );
    if (attendanceResult?.ok) {
      setAbsenceForm(null);
      setAbsenceFormError('');
    } else {
      setAbsenceFormError(attendanceResult?.error || 'עדכון סטטוס אי-הגעה נכשל.');
    }
  }

  async function handleCancel(status, closedReason) {
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
          closed_reason: closedReason || null,
          expected_version: instance.version,
        },
      });

      onUpdate?.();
      onClose();
    } catch (err) {
      console.error('Error cancelling lesson:', err);
      const handled = await handleVersionConflict(err, createCancelConflictAdapter(), {
        requestedStatus: status,
        closedReason: closedReason || null,
      });
      if (!handled) {
        setError(resolveMutationError(err));
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCancelSelection(status, closedReason) {
    setCancelDialogOpen(false);
    await handleCancel(status, closedReason);
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
        },
      });
      if (requestId !== latestPreviewRequestIdRef.current) {
        return;
      }
      setRestorePreview({
        participantId: participant.id,
        participantName: participant.student?.full_name || 'תלמיד',
        targetStatus,
        notes: options.notes || '',
        instructorCompensationDecision: options.instructorCompensationDecision || null,
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
    const studentName = contact.name || 'תלמיד';
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

  const activeServices = services?.filter(s => s.is_active) || [];
  const isReportable = displayInstance?.status === 'scheduled';
  const isOperationallyOpen = !instance?.is_locked && !displayInstance?.is_closed;
  const workflowState = displayInstance?.metadata?.workflow_state && typeof displayInstance.metadata.workflow_state === 'object'
    ? displayInstance.metadata.workflow_state
    : {};
  const workflowSummary = workflowState.summary && typeof workflowState.summary === 'object'
    ? workflowState.summary
    : {};
  const workflowReasonsOpen = Array.isArray(workflowState.reasons_open) ? workflowState.reasons_open : [];
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
  // Block completing an instance when at least one participant still has no resolved attendance status.
  // An instance with zero participants is exempt (e.g. template-generated shells before enrolment).
  const hasUnsetParticipants =
    displayParticipants.length > 0 && scheduledParticipantsCount > 0;

  if (!instance || !displayInstance) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>פרטי שיעור</span>
            {!isEditMode && canEdit && (
              <Button variant="ghost" size="sm" onClick={() => setIsEditMode(true)}>
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
            displayParticipants.map((p) => [p.student_id, p.student?.full_name || p.student?.first_name || 'תלמיד'])
          );
          const names = billingWarnings
            .map((w) => participantMap.get(w.student_id) || 'תלמיד')
            .filter((v, i, a) => a.indexOf(v) === i)
            .join(', ');
          return (
            <Alert variant="warning" className="border-amber-400 bg-amber-50 text-amber-900">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription>
                <strong>שיעור הושלם — אך ישנה בעיית חיוב</strong>
                <br />
                {`לא נמצאה התחייבות / אישור ביטוח עבור: ${names}. יש לסדר זאת בניהול הסטודנטים כדי שהחיוב יתבצע.`}
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

        {isEditMode ? (
          // Edit Mode
          <div className="space-y-4">
            {/* Service */}
            <div>
              <Label htmlFor="service">שירות *</Label>
              <Select
                value={formData.service_id}
                onValueChange={(value) => setFormData({ ...formData, service_id: value })}
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
                value={formData.instructor_employee_id}
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
              <Label htmlFor="duration">משך (דקות) *</Label>
              <Input
                id="duration"
                type="number"
                min="15"
                step="15"
                value={formData.duration_minutes}
                onChange={(e) => setFormData({ ...formData, duration_minutes: parseInt(e.target.value) })}
                required
              />
            </div>

            {/* Status */}
            <div>
              <Label htmlFor="status">סטטוס</Label>
              <Select
                value={formData.status}
                onValueChange={(value) => setFormData({ ...formData, status: value })}
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="scheduled">מתוכנן</SelectItem>
                  <SelectItem value="cancelled_student">בוטל ע"י תלמיד</SelectItem>
                  <SelectItem value="cancelled_clinic">בוטל ע"י המרפאה</SelectItem>
                  <SelectItem value="completed">הושלם</SelectItem>
                  {canManageAll && <SelectItem value="no_show">אי הגעה</SelectItem>}
                </SelectContent>
              </Select>
            </div>

            {/* Closed Reason (if cancelled / no-show) */}
            {(isCancellationStatus(formData.status) || formData.status === 'no_show') && (
              <div>
                <Label htmlFor="closed_reason">פירוט</Label>
                <Select
                  value={formData.closed_reason}
                  onValueChange={(value) => setFormData({ ...formData, closed_reason: value })}
                >
                  <SelectTrigger id="closed_reason">
                    <SelectValue placeholder="בחר סיבה" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="student_request">בקשת תלמיד</SelectItem>
                    <SelectItem value="clinic_closure">סגירת מרפאה</SelectItem>
                    <SelectItem value="instructor_unavailable">מדריך לא זמין</SelectItem>
                    <SelectItem value="doctor_note">אישור רופא</SelectItem>
                    <SelectItem value="no_show">אי הגעה</SelectItem>
                    <SelectItem value="other">אחר</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditMode(false)}
                disabled={isSaving}
              >
                ביטול
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    שומר...
                  </>
                ) : (
                  'שמור שינויים'
                )}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          // View Mode
          <div className="space-y-6">{/* Status Badge */}
            <div className="flex items-center gap-2">
              <span className={`text-2xl ${statusInfo.color}`}>{statusInfo.icon}</span>
              <Badge variant={displayInstance.status === 'completed' ? 'default' : 'secondary'}>
                {statusInfo.label}
              </Badge>
              <Badge variant={displayInstance.is_closed ? 'default' : 'outline'}>
                {displayInstance.is_closed ? 'סגור תפעולית' : 'פתוח תפעולית'}
              </Badge>
              {instance.latest_correction && (
                <Badge className="bg-sky-100 text-sky-800 border-sky-200">מציג ערך מתוקן</Badge>
              )}
              {canQuickReport && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleReportStatus('completed')}
                    disabled={isSaving || hasUnsetParticipants}
                    title={
                      hasUnsetParticipants
                        ? `יש לסמן נוכחות ל-${scheduledParticipantsCount} תלמיד/ים לפני השלמת השיעור`
                        : undefined
                    }
                  >
                    <Check className="h-4 w-4 ms-1" />
                    הושלם
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleReportStatus('no_show')}
                    disabled={isSaving}
                  >
                    <XCircle className="h-4 w-4 ms-1" />
                    אי הגעה
                  </Button>
                </div>
              )}
            </div>

            {/* Service Info */}
            <div>
              <label className="text-sm font-medium text-gray-700">שירות</label>
              <div className="mt-1 flex items-center gap-2">
                {displayInstance.service?.color && (
                  <div
                    className="w-4 h-4 rounded"
                    style={{ backgroundColor: displayInstance.service.color }}
                  />
                )}
                <span className="text-lg">{displayInstance.service?.service_name || 'לא ידוע'}</span>
              </div>
            </div>

            {/* Date & Time */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">תאריך</label>
                <p className="mt-1 text-lg">{dateDisplay}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">שעה</label>
                <p className="mt-1 text-lg">
                  {startTime} - {endTime} ({displayInstance.duration_minutes} דקות)
                </p>
              </div>
            </div>

            {/* Instructor */}
            <div>
              <label className="text-sm font-medium text-gray-700">מדריך</label>
              <p className="mt-1 text-lg">{displayInstance.instructor?.full_name || 'לא ידוע'}</p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-800">מצב סגירה</div>
                  <div className="text-xs text-slate-600">
                    {displayInstance.is_closed
                      ? 'כל החיובים, השכר וההתחייבויות התפעוליות סגורים.'
                      : 'השיעור עדיין פתוח עד להשלמת כל ההתחייבויות.'}
                  </div>
                </div>
                <Badge variant={displayInstance.is_closed ? 'default' : 'outline'}>
                  {displayInstance.is_closed ? 'סגור' : 'פתוח'}
                </Badge>
              </div>
              <div className="grid grid-cols-1 gap-1 text-xs text-slate-700 sm:grid-cols-2">
                <div>נוכחות הוכרעה: {workflowSummary.all_attendance_resolved ? 'כן' : 'לא'}</div>
                <div>חיובי תלמידים: {workflowSummary.all_student_billing_resolved ? 'סגורים' : 'עדיין פתוחים'}</div>
                <div>שכר מדריך: {workflowSummary.instructor_compensation_resolved ? 'נסגר' : 'טרם נסגר'}</div>
                <div>תביעות גורם מממן: {workflowSummary.all_hmo_resolved ? 'סגורות' : 'עדיין פתוחות'}</div>
              </div>
              {!displayInstance.is_closed && workflowReasonsOpen.length > 0 && (
                <div className="pt-1">
                  <div className="text-xs font-medium text-slate-700">מה עדיין מונע סגירה:</div>
                  <ul className="mt-1 list-disc pe-5 text-xs text-slate-600 space-y-1">
                    {workflowReasonsOpen.map((reason) => (
                      <li key={reason}>{getWorkflowReasonLabel(reason)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Participants with Attendance */}
            <div>
              <label className="text-sm font-medium text-gray-700">
                משתתפים ({displayParticipants.length || 0})
              </label>
              {canQuickReport && hasUnsetParticipants && (
                <Alert className="mt-2 border-amber-400 bg-amber-50">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-amber-900 text-sm">
                    {'יש לסמן נוכחות לכל התלמידים לפני השלמת השיעור'}
                    {` (${scheduledParticipantsCount} ${scheduledParticipantsCount === 1 ? 'תלמיד ממתין' : 'תלמידים ממתינים'})`}
                  </AlertDescription>
                </Alert>
              )}
              <div className="mt-2 space-y-2">
                {displayParticipants.map((participant) => {
                  const rs = localReminderState[participant.id] || {};
                  const hasSent = rs.reminder_sent ?? participant.reminder_sent ?? false;
                  const hasConfirmed = rs.reminder_seen ?? participant.reminder_seen ?? false;
                  const reminderContact = resolveReminderContact(participant);
                  const waPhone = formatPhoneForWhatsApp(reminderContact.phone);
                  const emailAddress = reminderContact.email;
                  const isScheduled = participant.participant_status === 'scheduled';
                  const isAbsenceFormOpen = absenceForm?.participantId === participant.id;
                  const isRestorePreviewOpen = restorePreview?.participantId === participant.id;
                  const participantNotes = participant.metadata?.notes || null;
                  const {
                    studentBillingDecision,
                    compensationDecision,
                    hmoDecision,
                  } = deriveDisplayWorkflowDecisions(participant, billingPolicy);
                  const absenceRequiresCompensationDecision = isAbsenceFormOpen && Boolean(absenceRequirements?.requires_instructor_compensation_decision);
                  const absenceShowsCompensationDecision = isAbsenceFormOpen
                    && !absenceRequirementsLoading
                    && Boolean(absenceRequirements?.requires_instructor_compensation_decision)
                    && ['no_show', 'cancelled_student', 'cancelled_clinic'].includes(absenceForm.status);
                  const previewImpactGroups = isRestorePreviewOpen
                    ? groupPreviewImpacts(restorePreview.preview?.impacts || [])
                    : [];
                  return (
                    <div key={participant.id} className="p-3 bg-gray-50 rounded-lg space-y-2">
                      {/* Main info + attendance buttons */}
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <p className="font-medium">{participant.student?.full_name || 'לא ידוע'}</p>
                          <div className="text-sm text-gray-600">
                            {participant.participant_status === 'attended' && '✓ נכח'}
                            {participant.participant_status === 'no_show' && '✗ לא הגיע'}
                            {participant.participant_status === 'scheduled' && 'מתוכנן'}
                            {participant.participant_status === 'cancelled_student' && 'בוטל ע"י תלמיד'}
                            {participant.participant_status === 'cancelled_clinic' && 'בוטל ע"י המכון'}
                          </div>
                          {participantNotes && (
                            <p className="text-xs text-gray-500 mt-0.5 italic">{participantNotes}</p>
                          )}
                          <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                            <Badge variant="outline">{getWorkflowDecisionLabel(studentBillingDecision, 'student_billing')}</Badge>
                            <Badge variant="outline">{getWorkflowDecisionLabel(compensationDecision, 'instructor_compensation')}</Badge>
                            <Badge variant="outline">{getWorkflowDecisionLabel(hmoDecision, 'hmo_claim')}</Badge>
                          </div>
                        </div>
                        {participant.price_charged && (
                          <Badge variant="outline" className="ms-2">₪{participant.price_charged}</Badge>
                        )}
                        {canMarkAttendance && !isAbsenceFormOpen && (
                          <div className="flex gap-1 ms-2">
                            {isScheduled && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openAttendancePreview(participant, 'attended')}
                                disabled={isMarkingAttendance}
                                title="נכח"
                              >
                                <Check className="h-4 w-4 text-green-600" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openAbsenceForm(participant.id)}
                              disabled={isMarkingAttendance}
                              title="לא הגיע / ביטול"
                            >
                              <XCircle className="h-4 w-4 text-red-600" />
                            </Button>
                            {!isScheduled && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openRestorePreview(participant)}
                                disabled={isMarkingAttendance || restorePreviewLoading}
                                title="שחזר לתוכנן"
                              >
                                <RotateCcw className="h-4 w-4 text-blue-600" />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                      {/* Inline absence form */}
                      {isAbsenceFormOpen && (
                        <div className="pt-2 border-t border-red-200 space-y-2">
                          <div>
                            <Label className="text-xs text-gray-600">סוג אי-הגעה</Label>
                            <Select
                              value={absenceForm.status}
                              onValueChange={handleAbsenceStatusChange}
                            >
                              <SelectTrigger className="h-8 text-sm mt-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="no_show">לא הגיע</SelectItem>
                                <SelectItem value="cancelled_student">ביטול ע"י תלמיד</SelectItem>
                                <SelectItem value="cancelled_clinic">ביטול ע"י המכון</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs text-gray-600">הערה (אופציונלי)</Label>
                            <Textarea
                              className="mt-1 text-sm resize-none"
                              rows={2}
                              placeholder="הוסף הערה..."
                              value={absenceForm.notes}
                              onChange={(e) => setAbsenceForm((prev) => ({ ...prev, notes: e.target.value }))}
                            />
                          </div>
                          {absenceRequirementsLoading && (
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              טוען את דרישות הסטטוס...
                            </div>
                          )}
                          {absenceShowsCompensationDecision && (
                            <div>
                              <Label className="text-xs text-gray-600">פיצוי למדריך עבור אי-הגעה מחויבת</Label>
                              <Select
                                value={absenceForm.instructorCompensationDecision || ''}
                                onValueChange={(value) => setAbsenceForm((prev) => ({
                                  ...prev,
                                  instructorCompensationDecision: value,
                                }))}
                              >
                                <SelectTrigger className="h-8 text-sm mt-1">
                                  <SelectValue placeholder="בחרו אם המדריך אמור לקבל פיצוי" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="compensated">{getCompensationDecisionLabel('compensated')}</SelectItem>
                                  <SelectItem value="not_compensated">{getCompensationDecisionLabel('not_compensated')}</SelectItem>
                                </SelectContent>
                              </Select>
                              <p className="mt-1 text-[11px] text-gray-500">
                                {absenceRequiresCompensationDecision
                                  ? `הסטודנט מחויב לפי המדיניות עבור "${getCancellationStatusLabel(absenceForm.status)}", ולכן צריך להחליט בנפרד אם המדריך מקבל פיצוי.`
                                  : `אפשר לבחור מראש אם המדריך יקבל פיצוי עבור "${getCancellationStatusLabel(absenceForm.status)}". אם אין צורך, אפשר להשאיר ללא בחירה.`}
                              </p>
                            </div>
                          )}
                          {absenceFormError && (
                            <Alert className="border-red-300 bg-red-50 text-red-950">
                              <AlertTriangle className="h-4 w-4 text-red-700" />
                              <AlertDescription>{absenceFormError}</AlertDescription>
                            </Alert>
                          )}
                          <div className="flex gap-2 justify-end">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={closeAbsenceForm}
                              disabled={isMarkingAttendance}
                            >
                              ביטול
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={confirmAbsenceForm}
                              disabled={
                                isMarkingAttendance
                                || absenceRequirementsLoading
                                || !absenceRequirements
                                || (absenceRequiresCompensationDecision && !absenceForm.instructorCompensationDecision)
                              }
                            >
                              {isMarkingAttendance ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                'אישור'
                              )}
                            </Button>
                          </div>
                        </div>
                      )}
                      {isRestorePreviewOpen && (
                        <div className="pt-2 border-t border-blue-200 space-y-2">
                          <div className="text-sm font-medium text-slate-800">
                            {restorePreview?.targetStatus === 'scheduled'
                              ? 'השפעות השחזור לתוכנן'
                              : `השפעות שינוי הסטטוס ל-${getParticipantStatusLabel(restorePreview?.targetStatus)}`}
                          </div>
                          {previewImpactGroups.length > 0 ? (
                            <div className="space-y-2">
                              {previewImpactGroups.map((group) => (
                                <div key={group.key} className={`rounded-md border p-2 ${group.borderClass} ${group.bgClass}`}>
                                  <div className="text-xs font-medium text-slate-800">{group.label}</div>
                                  <ul className="mt-1 list-disc pe-5 text-sm text-slate-700 space-y-1">
                                    {group.impacts.map((impact, index) => (
                                      <li key={`${impact.type || group.key}-${index}`}>{impact.message}</li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <ul className="list-disc pe-5 text-sm text-slate-700 space-y-1">
                              <li>
                                {restorePreview?.targetStatus === 'scheduled'
                                  ? 'לא זוהו השפעות נוספות מעבר להחזרת התלמיד לסטטוס "מתוכנן".'
                                  : 'לא זוהו השפעות נוספות מעבר לעדכון הסטטוס המבוקש.'}
                              </li>
                            </ul>
                          )}
                          {restorePreviewError && (
                            <Alert className="border-red-300 bg-red-50 text-red-950">
                              <AlertTriangle className="h-4 w-4 text-red-700" />
                              <AlertDescription>{restorePreviewError}</AlertDescription>
                            </Alert>
                          )}
                          <div className="flex gap-2 justify-end">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setRestorePreview(null);
                                setRestorePreviewError('');
                              }}
                              disabled={isMarkingAttendance}
                            >
                              ביטול
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                const attendanceResult = await handleMarkAttendance(
                                  participant.id,
                                  restorePreview?.targetStatus || 'scheduled',
                                  restorePreview?.notes || '',
                                  {
                                    instructorCompensationDecision: restorePreview?.instructorCompensationDecision || null,
                                  },
                                );
                                if (!attendanceResult?.ok) {
                                  setRestorePreviewError(attendanceResult?.error || 'שחזור הסטטוס נכשל.');
                                }
                              }}
                              disabled={isMarkingAttendance}
                            >
                              {isMarkingAttendance ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                restorePreview?.targetStatus === 'scheduled' ? 'אשר שחזור' : 'אשר שינוי'
                              )}
                            </Button>
                          </div>
                        </div>
                      )}
                      {/* Reminder row — admins only, scheduled participants only */}
                      {isScheduled && canManageAll && (
                        <div className="flex items-center gap-2 pt-1.5 border-t border-gray-200 flex-wrap">
                          <span className="text-[11px] text-gray-500">
                            {reminderContact.source === 'guardian' ? 'איש קשר: הורה' : 'איש קשר: תלמיד'}
                          </span>
                          {waPhone && (
                            <Button
                              size="sm"
                              variant={hasSent ? 'outline' : 'secondary'}
                              onClick={() => handleSendWaReminder(participant)}
                              disabled={reminderUpdating}
                              title="שלח תזכורת ב-WhatsApp"
                              className="h-7 text-xs gap-1"
                            >
                              <MessageCircle className="h-3 w-3" />
                              {hasSent ? 'שלח שוב WA' : 'תזכורת WA'}
                            </Button>
                          )}
                          {emailAddress && (
                            <Button
                              size="sm"
                              variant={hasSent ? 'outline' : 'secondary'}
                              onClick={() => handleSendEmailReminder(participant)}
                              disabled={reminderUpdating}
                              title="שלח תזכורת באימייל"
                              className="h-7 text-xs gap-1"
                            >
                              <Mail className="h-3 w-3" />
                              {hasSent ? 'שלח שוב מייל' : 'תזכורת מייל'}
                            </Button>
                          )}
                          {hasSent && !hasConfirmed && (
                            <>
                              <span className="text-xs text-gray-500">ממתין לאישור</span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs gap-1 text-green-700 hover:text-green-800 hover:bg-green-50"
                                onClick={() => handleSetReminderConfirmation(participant, true)}
                                disabled={reminderUpdating}
                                title="אישר הגעה"
                              >
                                <ThumbsUp className="h-3 w-3" />
                                אישר
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs gap-1 text-red-700 hover:text-red-800 hover:bg-red-50"
                                onClick={() => handleSetReminderConfirmation(participant, false)}
                                disabled={reminderUpdating}
                                title="לא יגיע — יבטל השתתפות"
                              >
                                <ThumbsDown className="h-3 w-3" />
                                לא יגיע
                              </Button>
                            </>
                          )}
                          {hasSent && hasConfirmed && (
                            <Badge className="text-xs bg-green-100 text-green-800 border-green-200 font-normal">
                              ✓ אישר הגעה
                            </Badge>
                          )}
                          {!waPhone && !emailAddress && (
                            <span className="text-xs text-gray-400">אין פרטי קשר</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Add Student — admin only, scheduled unlocked instances */}
              {canManageAll && isReportable && !instance?.is_locked && (
                <div className="mt-3">
                  {!isAddingParticipant ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsAddingParticipant(true)}
                    >
                      <UserPlus className="h-4 w-4 ms-1" />
                      הוסף תלמיד
                    </Button>
                  ) : (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
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
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      {isSearchingStudents && (
                        <div className="flex items-center gap-1 text-sm text-gray-500">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          מחפש...
                        </div>
                      )}
                      {!isSearchingStudents && addStudentResults.length > 0 && (() => {
                        const enrolledIds = new Set(displayParticipants.map((p) => p.student_id));
                        const filtered = addStudentResults.filter((s) => !enrolledIds.has(s.id));
                        return filtered.length === 0 ? (
                          <p className="text-xs text-gray-400">כל התלמידים שנמצאו כבר רשומים לשיעור</p>
                        ) : (
                          <div className="space-y-1 max-h-48 overflow-y-auto">
                            {filtered.map((student) => (
                              <button
                                key={student.id}
                                type="button"
                                className="w-full text-start text-sm px-2 py-1.5 rounded hover:bg-blue-100 flex items-center justify-between"
                                onClick={() => handleAddParticipant(student.id)}
                              >
                                <span className="font-medium">
                                  {[student.first_name, student.last_name].filter(Boolean).join(' ')}
                                </span>
                                {student.phone && (
                                  <span className="text-xs text-gray-500">{student.phone}</span>
                                )}
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                      {!isSearchingStudents && addStudentQuery.length >= 2 && addStudentResults.length === 0 && (
                        <p className="text-sm text-gray-500">לא נמצאו תלמידים</p>
                      )}
                      {addStudentQuery.length === 1 && (
                        <p className="text-xs text-gray-400">הקלד לפחות 2 תווים לחיפוש</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Documentation Status */}
            {displayInstance.documentation_status && (
              <div>
                <label className="text-sm font-medium text-gray-700">סטטוס תיעוד</label>
                <p className="mt-1">
                  <Badge
                    variant={displayInstance.documentation_status === 'documented' ? 'default' : 'secondary'}
                  >
                    {displayInstance.documentation_status === 'documented' ? 'תועד' : 'ממתין לתיעוד'}
                  </Badge>
                </p>
              </div>
            )}

            {/* Cancellation Reason */}
            {displayInstance.closed_reason && (
              <div>
                <label className="text-sm font-medium text-gray-700">
                  {getCancellationStatusLabel(displayInstance.status)}
                </label>
                <p className="mt-1 text-gray-900">{displayInstance.closed_reason}</p>
              </div>
            )}

            {/* Created Source */}
            {displayInstance.created_source && (
              <div className="text-sm text-gray-600">
                מקור: {displayInstance.created_source}
              </div>
            )}

            {/* Cancel Button */}
            {canEdit && !isCancellationStatus(displayInstance.status) && displayInstance.status !== 'no_show' && (
              <div className="pt-4 border-t">
                <Button
                  variant="destructive"
                  onClick={() => setCancelDialogOpen(true)}
                  disabled={isSaving}
                >
                  <X className="me-2 h-4 w-4" />
                  בטל שיעור
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ביטול שיעור</DialogTitle>
            <DialogDescription>
              בחר את הסטטוס שיירשם לשיעור.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Button type="button" variant="outline" className="justify-start" onClick={() => handleCancelSelection('cancelled_student', 'student_request')} disabled={isSaving}>
              בוטל ע"י תלמיד
            </Button>
            <Button type="button" variant="outline" className="justify-start" onClick={() => handleCancelSelection('cancelled_clinic', 'clinic_closure')} disabled={isSaving}>
              בוטל ע"י המרפאה
            </Button>
            <Button type="button" variant="outline" className="justify-start" onClick={() => handleCancelSelection('no_show', 'no_show')} disabled={isSaving}>
              אי הגעה
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCancelDialogOpen(false)} disabled={isSaving}>
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
