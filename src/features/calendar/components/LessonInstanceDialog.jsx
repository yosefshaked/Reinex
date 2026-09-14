import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/label';
import { Input } from '../../../components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../../components/ui/select';
import { formatTimeDisplay } from '../utils/timeGrid';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../components/ui/dropdown-menu';
import { useOrg } from '@/org/OrgContext';
import { useServices } from '@/hooks/useOrgData';
import { useCalendarInstructors } from '../hooks/useCalendar';
import { authenticatedFetch } from '@/lib/api-client.js';
import { toast } from '@/lib/toast.jsx';
import { AlertCircle, AlertTriangle, Check, Clock, Loader2, Lock, MoreHorizontal, Pencil, Search, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Textarea } from '../../../components/ui/textarea';
import { Checkbox } from '../../../components/ui/checkbox';
import { LockedCorrectionPanel } from './LockedCorrectionPanel';
import { LessonParticipantRoster } from './LessonParticipantRoster.jsx';
import { LessonDialogHeader } from './LessonDialogHeader.jsx';
import { LessonHistoryTab } from './LessonHistoryTab.jsx';
import { useVersionConflictResolver } from './useVersionConflictResolver';
import { dayTokenForJsDay } from '@/lib/day-of-week.js';
import { hasConfiguredAvailability, isWithinAvailabilityWindows } from '@/lib/instructor-availability.js';
import {
  hasValidSchedulingOverrideReason,
  resolveSchedulingOverrideFormState,
  SCHEDULING_OVERRIDE_REASON_OPTIONS,
} from '../utils/schedulingOverride.js';
import { getParticipantDisplayName, resolveParticipantReminderContact } from '../utils/participantDisplay.js';
import { useSessionModal } from '@/features/sessions/context/SessionModalContext.jsx';
import { useSessionReportsEnabled } from '@/features/sessions/config/session-reports-permission.js';
import { buildLessonReminderWhatsAppMessage } from '@/lib/whatsapp-message-templates.js';
import {
  toLocalDateString,
  toUtcIsoString,
  buildSchedulingOverrideMetadata,
  isCancellationStatus,
  shouldShowGraceWaiver,
  getDisplayInstance,
  getDisplayParticipants,
  resolveMutationError,
  getParticipantStatusLabel,
  getWorkflowReasonLabel,
  resolveLatestWorkflowState,
  getPreviewImpactClass,
  buildConflictLines,
} from '../utils/lessonDialogModel.js';
import {
  useAbsenceRequirements,
  useLessonFinancePolicies,
  useLessonSessionReports,
  useLessonVersions,
} from '../hooks/useLessonDialogData.js';

function getDayTokenForDateString(dateString) {
  if (!dateString) return null;

  const [year, month, day] = String(dateString).split('-').map(Number);
  const localDate = new Date(year, (month || 1) - 1, day || 1, 0, 0, 0, 0);
  if (Number.isNaN(localDate.getTime())) {
    return null;
  }

  return dayTokenForJsDay(localDate.getDay());
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

function EmptyTabState({ title, description }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-5 text-center">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-1 text-sm text-slate-600">{description}</div>
    </div>
  );
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

  const sessionReportsEnabled = useSessionReportsEnabled();
  const { openSessionReportModal } = useSessionModal();
  const {
    reportsByParticipant,
    loading: sessionReportsLoading,
    loadFailed: sessionReportsLoadFailed,
    reload: loadSessionReports,
    recordReport,
  } = useLessonSessionReports({
    enabled: sessionReportsEnabled,
    open,
    orgId: org?.id,
    instanceId: instance?.id,
  });
  const { billingPolicy, instructorEarningsPolicy } = useLessonFinancePolicies(org?.id);
  const {
    getCurrentInstanceVersion,
    getCurrentParticipantVersion,
    syncVersionsFromServer,
    resetVersions,
  } = useLessonVersions({
    instance,
    displayParticipants,
    scopeKey: dialogScopeKey,
    enabled: Boolean(org?.id && instance?.id),
    fetchLatest: fetchLatestInstance,
  });
  
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
  const { requirements: absenceRequirements, loading: absenceRequirementsLoading } = useAbsenceRequirements({
    orgId: org?.id,
    instanceId: instance?.id,
    participantId: absenceForm?.participantId,
    status: absenceForm?.status,
    onError: (loadError) => setAbsenceFormError(resolveMutationError(loadError) || 'לא ניתן היה לטעון את דרישות אי-ההגעה.'),
  });
  // { participantId, targetStatus } of the one-line confirm strip currently shown under a row.
  const [attendancePreviewTarget, setAttendancePreviewTarget] = useState(null);
  const [isCorrectionMode, setIsCorrectionMode] = useState(false);
  // 'close' | 'edit' while asking whether to discard unsaved edit-mode changes.
  const [discardConfirm, setDiscardConfirm] = useState(null);
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
  const [addingParticipantId, setAddingParticipantId] = useState(null);
  const studentSearchTimerRef = useRef(null);
  const [activeViewTab, setActiveViewTab] = useState('lesson');
  const latestPreviewRequestIdRef = useRef(0);
  const latestCancelPreviewRequestIdRef = useRef(0);
  const latestStudentSearchRequestIdRef = useRef(0);
  
  const [formData, setFormData] = useState({
    instructor_employee_id: '',
    service_id: '',
    date: '',
    time: '',
    duration_minutes: 60,
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

  const handleOpenSessionReport = useCallback((participant) => {
    if (!participant?.id) return;
    openSessionReportModal({
      lessonParticipantId: participant.id,
      studentName: getParticipantDisplayName(participant, ''),
      serviceName: displayInstance?.service_name || '',
      lessonDateTime: displayInstance?.datetime_start || '',
      onCreated: (report) => {
        recordReport(report);
        void loadSessionReports();
      },
    });
  }, [openSessionReportModal, displayInstance?.service_name, displayInstance?.datetime_start, loadSessionReports, recordReport]);

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

  // Reset transient dialog state when a different lesson (or correction) is shown, and on every reopen:
  // the component stays mounted between opens, so edit mode / errors would otherwise leak across lessons.
  const resetTransientState = useCallback(() => {
    setLocalReminderState({});
    setIsEditMode(false);
    setError(null);
    setAttendancePreviewTarget(null);
    setIsCorrectionMode(false);
    setDiscardConfirm(null);
    setAddingParticipantId(null);
    resetVersions();
    window.clearTimeout(studentSearchTimerRef.current);
    setBillingWarnings([]);
    setIsAddingParticipant(false);
    setAddStudentQuery('');
    setAddStudentResults([]);
    setIsSearchingStudents(false);
    setAbsenceForm(null);
    setAbsenceFormError('');
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
    setActiveViewTab('lesson');
    latestPreviewRequestIdRef.current += 1;
    latestCancelPreviewRequestIdRef.current += 1;
    latestStudentSearchRequestIdRef.current += 1;
  }, [resetVersions]);

  useEffect(() => {
    resetTransientState();
  }, [instance?.id, instance?.latest_correction?.id, resetTransientState]);

  useEffect(() => {
    if (open) {
      resetTransientState();
    }
  }, [open, resetTransientState]);

  useEffect(() => () => window.clearTimeout(studentSearchTimerRef.current), []);


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
    return buildLessonReminderWhatsAppMessage({
      studentName,
      serviceName: service,
      dayDate,
      time,
      organizationName: org?.name,
    });
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

  const startTime = displayInstance?.datetime_start ? formatTimeDisplay(displayInstance.datetime_start) : '';
  const endDate = displayInstance?.datetime_start
    ? new Date(new Date(displayInstance.datetime_start).getTime() + Number(displayInstance.duration_minutes || 0) * 60000)
    : null;
  const endTime = endDate ? formatTimeDisplay(endDate.toISOString()) : '';

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

  useEffect(() => {
    if (open) {
      clearConflict();
    }
  }, [open, clearConflict]);

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
        await syncVersionsFromServer();
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
      expected_version: getCurrentInstanceVersion(),
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
        instance_version: getCurrentInstanceVersion(),
        participant_version: getCurrentParticipantVersion(participantId),
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
      await syncVersionsFromServer();
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
  }

  function closeAbsenceForm() {
    setAbsenceForm(null);
    setAbsenceFormError('');
  }

  async function confirmAbsenceForm() {
    if (!absenceForm) return;
    setAbsenceFormError('');
    if (absenceRequirementsLoading) {
      setAbsenceFormError('טוענים את דרישות הסטטוס, נסו שוב בעוד רגע.');
      return;
    }
    if (!absenceRequirements) {
      setAbsenceFormError('לא ניתן להמשיך לפני טעינת דרישות הסטטוס מהשרת.');
      return;
    }
    if (absenceRequirements.requires_instructor_compensation_decision && !absenceForm.instructorCompensationDecision) {
      setAbsenceFormError('יש לבחור אם המדריך/ה יקבל/תקבל שכר על המפגש.');
      return;
    }
    const currentParticipant = displayParticipants.find((entry) => entry.id === absenceForm.participantId);
    if (!currentParticipant) {
      setAbsenceFormError('לא ניתן למצוא את המשתתף/ת לעדכון.');
      return;
    }
    const applyGraceWaiver = shouldShowGraceWaiver(billingPolicy, absenceForm.status) && absenceForm.waiveFee === true;
    // Every absence is previewed by the server (the one-line confirm strip) before it is saved.
    await openAttendancePreview(currentParticipant, absenceForm.status, {
      notes: absenceForm.notes,
      instructorCompensationDecision: absenceForm.instructorCompensationDecision || null,
      isExcused: applyGraceWaiver,
    });
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
          expected_version: getCurrentInstanceVersion(),
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
          expected_version: getCurrentInstanceVersion(),
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
          expected_version: getCurrentInstanceVersion(),
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
    setAttendancePreviewTarget({ participantId: participant.id, targetStatus });
    setRestorePreview(null);
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
      if (targetStatus !== 'scheduled' && absenceForm?.participantId === participant.id) {
        // Keep the user in the absence form and show the problem there.
        setAttendancePreviewTarget(null);
        setAbsenceFormError(resolvedError);
      } else {
        setRestorePreviewError(resolvedError);
      }
    } finally {
      if (requestId === latestPreviewRequestIdRef.current) {
        setRestorePreviewLoading(false);
      }
    }
  }

  async function openRestorePreview(participant) {
    await openAttendancePreview(participant, 'scheduled');
  }

  async function handleAddParticipant(studentId, studentName = '') {
    if (!org?.id || !instance?.id || addingParticipantId) return;
    setAddingParticipantId(studentId);
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
      await syncVersionsFromServer();
      onUpdate?.();
      toast.success(studentName ? `${studentName} נוסף/ה לשיעור.` : 'המשתתף/ת נוסף/ה לשיעור.');
    } catch (err) {
      setError(resolveMutationError(err));
    } finally {
      setAddingParticipantId(null);
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
      await syncVersionsFromServer();
      onUpdate?.();
    } catch (err) {
      console.error('Error marking reminder sent:', err);
      toast.error('ההודעה נפתחה, אך לא הצלחנו לסמן שהתזכורת נשלחה. נסו לשלוח שוב.');
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

  async function handleSendEmailReminder(participant) {
    const contact = resolveReminderContact(participant);
    const href = buildEmailReminderHref(displayInstance, contact);
    if (!href) return;
    window.open(href, '_blank', 'noopener,noreferrer');
    await markReminderSent(participant.id);
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
        await syncVersionsFromServer();
      } else {
        openAbsenceForm(participant.id, { status: 'cancelled_student' });
        return;
      }
      onUpdate?.();
    } catch (err) {
      console.error('Error setting reminder confirmation:', err);
      setError(resolveMutationError(err));
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
  const isReportable = displayInstance?.status === 'scheduled';
  const isOperationallyOpen = !instance?.is_locked && !displayInstance?.is_closed;
  const displayWorkflowState = displayInstance?.metadata?.workflow_state && typeof displayInstance.metadata.workflow_state === 'object'
    ? displayInstance.metadata.workflow_state
    : null;
  const rawWorkflowState = instance?.metadata?.workflow_state && typeof instance.metadata.workflow_state === 'object'
    ? instance.metadata.workflow_state
    : null;
  const workflowState = resolveLatestWorkflowState(displayWorkflowState, rawWorkflowState);
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
  const lessonStarted = displayInstance?.datetime_start
    ? new Date(displayInstance.datetime_start).getTime() <= Date.now()
    : false;

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

  // Prefill the instructor-pay decision from the org's earnings policy when the server says a decision
  // is needed; the user can still change it (the form marks it "לפי הגדרות השכר").
  useEffect(() => {
    if (!absenceForm || absenceForm.instructorCompensationDecision) return;
    if (!absenceRequirements?.requires_instructor_compensation_decision) return;
    const policyValue = instructorEarningsPolicy?.[absenceForm.status];
    if (typeof policyValue !== 'boolean') return;
    setAbsenceForm((prev) => (prev && !prev.instructorCompensationDecision
      ? { ...prev, instructorCompensationDecision: policyValue ? 'compensated' : 'not_compensated', compensationFromPolicy: true }
      : prev));
  }, [absenceForm, absenceRequirements, instructorEarningsPolicy]);

  const editBaseline = useMemo(() => {
    if (!displayInstance?.datetime_start) return null;
    const dateTime = new Date(displayInstance.datetime_start);
    const overrideState = resolveSchedulingOverrideFormState(displayInstance?.metadata?.scheduling_override);
    return {
      instructor_employee_id: displayInstance.instructor_employee_id || '',
      service_id: displayInstance.service_id || '',
      date: toLocalDateString(dateTime),
      time: dateTime.toTimeString().slice(0, 5),
      useSchedulingOverride: overrideState.enabled,
      selectedOverrideReasonCode: overrideState.selectedReasonCode,
      customOverrideReason: overrideState.customReason,
    };
  }, [displayInstance]);
  const isEditDirty = Boolean(isEditMode && editBaseline && (
    formData.instructor_employee_id !== editBaseline.instructor_employee_id
    || formData.service_id !== editBaseline.service_id
    || formData.date !== editBaseline.date
    || formData.time !== editBaseline.time
    || useSchedulingOverride !== editBaseline.useSchedulingOverride
    || selectedOverrideReasonCode !== editBaseline.selectedOverrideReasonCode
    || customOverrideReason !== editBaseline.customOverrideReason
  ));

  function cancelStatusStrip() {
    latestPreviewRequestIdRef.current += 1;
    setAttendancePreviewTarget(null);
    setRestorePreview(null);
    setRestorePreviewError('');
    setRestorePreviewLoading(false);
  }

  async function confirmStatusStrip() {
    const target = attendancePreviewTarget;
    const pending = restorePreview;
    if (!target || !pending || pending.participantId !== target.participantId) return;
    const result = await handleMarkAttendance(target.participantId, pending.targetStatus, pending.notes || '', {
      instructorCompensationDecision: pending.instructorCompensationDecision || null,
      isExcused: pending.isExcused === true,
    });
    if (result?.ok) {
      setAttendancePreviewTarget(null);
      // Keep the keyboard flow going: focus the next participant still waiting for attendance.
      window.requestAnimationFrame(() => {
        document.querySelector('[data-mark-attended]:not([disabled])')?.focus();
      });
    } else if (result?.error) {
      setRestorePreviewError(result.error);
    }
  }

  function requestClose() {
    if (isEditDirty) {
      setDiscardConfirm('close');
      return;
    }
    onClose();
  }

  function requestExitEdit() {
    if (isEditDirty) {
      setDiscardConfirm('edit');
      return;
    }
    resetEditState();
    setIsEditMode(false);
  }

  function confirmDiscard() {
    const target = discardConfirm;
    setDiscardConfirm(null);
    resetEditState();
    setIsEditMode(false);
    if (target === 'close') onClose();
  }

  if (!instance || !displayInstance) return null;

  const LOCK_SOURCE_LABELS = { payroll_run: 'הרצת שכר', claim_batch: 'אצוות תביעות', manual_compliance_lock: 'נעילת ציות ידנית' };
  const REMAINING_LABELS = {
    student_billing_unresolved: 'חיוב לקוחות',
    instructor_compensation_unresolved: 'שכר מדריך/ה',
    hmo_claim_unresolved: 'תביעת גורם מממן',
  };
  const isLessonLocked = Boolean(instance.is_locked || hardBlockedByPaidClaim);
  const canOpenCorrection = canManageAll && !hardBlockedByPaidClaim && Boolean(instance.is_locked || instance.latest_correction);
  const isCancelled = isCancellationStatus(displayInstance.status);
  const headerStatusLabel = displayInstance.status === 'completed' ? 'הושלם' : isCancelled ? 'בוטל' : null;
  const lessonDate = displayInstance.datetime_start ? new Date(displayInstance.datetime_start) : null;
  const headerDateLabel = lessonDate && !Number.isNaN(lessonDate.getTime())
    ? new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(lessonDate)
    : 'מועד לא ידוע';
  const lockSourceLabels = [...new Set(lockRows.map((lock) => LOCK_SOURCE_LABELS[lock.lock_source_type] || 'נעילה פיננסית'))];
  const headerTabs = !isEditMode && !isCorrectionMode && canManageAll
    ? [{ value: 'lesson', label: 'משתתפים' }, { value: 'history', label: 'היסטוריה' }]
    : null;
  const headerModeLabel = isEditMode ? 'עריכת מועד ושיבוץ' : (isCorrectionMode ? 'תיקון שיעור' : null);
  const HeaderModeIcon = isEditMode ? Pencil : (isCorrectionMode ? ShieldCheck : null);
  const hasEdgeControl = Boolean(headerTabs || headerModeLabel);
  const showHistory = canManageAll && activeViewTab === 'history' && !isEditMode && !isCorrectionMode;

  let headerNotice = null;
  if (!isEditMode && !isCorrectionMode) {
    if (hardBlockedByPaidClaim) {
      headerNotice = (
        <div className="flex items-center gap-2.5 rounded-xl bg-red-50 px-3 py-2.5 text-[13px] text-red-800">
          <Lock className="h-4 w-4 shrink-0" />
          <span><b className="font-bold">השיעור חסום לתיקון בגלל תביעה ששולמה.</b> יש להעביר את האירוע לטיפול ידני.</span>
        </div>
      );
    } else if (instance.is_locked) {
      headerNotice = (
        <div className="flex flex-wrap items-center gap-2.5 rounded-xl bg-red-50 px-3 py-2.5 text-[13px] text-red-800">
          <Lock className="h-4 w-4 shrink-0" />
          <span>
            <b className="font-bold">השיעור נעול לשינוי ישיר.</b>
            {lockSourceLabels.length ? ' ' + lockSourceLabels.join(' · ') + '.' : ''}
            {canOpenCorrection ? '' : ' לשינוי יש לפנות למשרד.'}
          </span>
          {canOpenCorrection ? (
            <Button type="button" size="sm" variant="outline" className="ms-auto h-8 bg-white text-xs" onClick={() => setIsCorrectionMode(true)}>
              פתיחת תיקון
            </Button>
          ) : null}
        </div>
      );
    } else if (instance.latest_correction && canOpenCorrection) {
      headerNotice = (
        <div className="flex flex-wrap items-center gap-2.5 rounded-xl bg-sky-50 px-3 py-2.5 text-[13px] text-sky-800">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          <span>השיעור תוקן בעבר. הערכים המוצגים כוללים את התיקון.</span>
          <Button type="button" size="sm" variant="outline" className="ms-auto h-8 bg-white text-xs" onClick={() => setIsCorrectionMode(true)}>
            תיקון נוסף
          </Button>
        </div>
      );
    }
  }

  // Participants header: count + free seats (cancelled / absent participants don't take a seat).
  const lessonCapability = (instructors || [])
    .find((entry) => String(entry.id) === String(displayInstance.instructor_employee_id))
    ?.service_capabilities?.find((capability) => String(capability.service_id) === String(displayInstance.service_id));
  const capacity = Number(lessonCapability?.max_students) || 0;
  const seatedCount = displayParticipants.filter((participant) => ['scheduled', 'attended'].includes(participant.participant_status)).length;
  const freeSeats = capacity > 0 && isReportable ? capacity - seatedCount : null;
  const participantsLabel = displayParticipants.length === 0
    ? 'אין משתתפים'
    : (displayParticipants.length === 1 ? 'משתתף/ת אחד/ת' : displayParticipants.length + ' משתתפים');
  const seatsLabel = freeSeats == null
    ? ''
    : (freeSeats <= 0 ? ' · השיעור מלא' : (freeSeats === 1 ? ' · מקום פנוי אחד' : ' · ' + freeSeats + ' מקומות פנויים'));
  const canAddParticipant = canManageAll && isReportable && !instance.is_locked;

  // One-line confirm strip state for the row it belongs to.
  const pendingPreview = restorePreview && attendancePreviewTarget && restorePreview.participantId === attendancePreviewTarget.participantId
    ? restorePreview
    : null;
  const statusStrip = attendancePreviewTarget ? {
    participantId: attendancePreviewTarget.participantId,
    targetStatus: attendancePreviewTarget.targetStatus,
    loading: restorePreviewLoading,
    preview: pendingPreview?.preview || null,
    error: restorePreviewError,
    note: [
      pendingPreview?.isExcused ? 'ויתור על חיוב' : '',
      pendingPreview?.instructorCompensationDecision === 'compensated' ? 'המדריך/ה יקבל/תקבל שכר' : '',
      pendingPreview?.instructorCompensationDecision === 'not_compensated' ? 'ללא שכר למדריך/ה' : '',
    ].filter(Boolean).join(' · '),
  } : null;

  // Footer: one quiet line that says what is still open (details on hover).
  const missingReportNames = sessionReportsEnabled && lessonStarted && !sessionReportsLoading && !sessionReportsLoadFailed
    ? attendedParticipants
      .filter((participant) => !reportsByParticipant?.[participant.id])
      .map((participant) => getParticipantDisplayName(participant, 'לקוח/ה'))
    : [];
  const remainingItems = [
    ...workflowReasonsOpen
      .filter((reason) => REMAINING_LABELS[reason])
      .map((reason) => ({ label: REMAINING_LABELS[reason], detail: getWorkflowReasonLabel(reason) })),
    ...(missingReportNames.length ? [{ label: 'דיווחי מפגש', detail: 'חסר דיווח מפגש עבור: ' + missingReportNames.join(', ') }] : []),
  ];
  let footNote = null;
  if (isLessonLocked) {
    footNote = { tone: 'muted', Icon: Lock, text: 'שינויים בשיעור נעול נעשים דרך תיקון בלבד.' };
  } else if (isCancelled) {
    footNote = { tone: 'muted', Icon: null, text: 'השיעור בוטל.' };
  } else if (canQuickReport && hasUnsetParticipants) {
    footNote = {
      tone: 'warn',
      Icon: AlertTriangle,
      text: scheduledParticipantsCount === 1 ? 'משתתף/ת אחד/ת טרם סומן/ה' : scheduledParticipantsCount + ' משתתפים טרם סומנו',
    };
  } else if (remainingItems.length) {
    footNote = {
      tone: 'muted',
      Icon: Clock,
      text: 'נותר לסגירה: ' + remainingItems.map((item) => item.label).join(' · '),
      tooltip: remainingItems.map((item) => item.label + ': ' + item.detail).join('\n'),
    };
  } else if (displayInstance.is_closed) {
    footNote = { tone: 'ok', Icon: Check, text: 'השיעור סגור — אין משימות פתוחות.' };
  } else if (displayInstance.status === 'completed') {
    footNote = { tone: 'ok', Icon: Check, text: 'השיעור הושלם.' };
  }
  const FOOT_TONES = { warn: 'text-amber-700', ok: 'text-emerald-700', muted: 'text-slate-500' };
  const footNoteContent = footNote ? (
    <span className={'inline-flex items-center gap-1.5 text-[13px] font-medium ' + FOOT_TONES[footNote.tone]} tabIndex={footNote.tooltip ? 0 : undefined}>
      {footNote.Icon ? <footNote.Icon className="h-3.5 w-3.5 shrink-0" /> : null}
      {footNote.text}
    </span>
  ) : null;
  const footNoteNode = footNote?.tooltip ? (
    <Tooltip>
      <TooltipTrigger asChild>{footNoteContent}</TooltipTrigger>
      <TooltipContent className="max-w-sm whitespace-pre-line text-start text-xs leading-relaxed">{footNote.tooltip}</TooltipContent>
    </Tooltip>
  ) : footNoteContent;

  // Edit mode: before → after summary next to the save button.
  const findServiceName = (serviceId) => (services || []).find((service) => String(service.id) === String(serviceId))?.service_name || '—';
  const findInstructorName = (instructorId) => (instructors || []).find((entry) => String(entry.id) === String(instructorId))?.full_name || '—';
  const formatShortDateKey = (value) => {
    const [year, month, day] = String(value || '').split('-').map(Number);
    return year && month && day ? day + '.' + month : '—';
  };
  const editChanges = isEditMode && editBaseline ? [
    formData.date !== editBaseline.date ? { label: 'תאריך', before: formatShortDateKey(editBaseline.date), after: formatShortDateKey(formData.date) } : null,
    formData.time !== editBaseline.time ? { label: 'שעה', before: editBaseline.time, after: formData.time || '—' } : null,
    formData.service_id !== editBaseline.service_id ? { label: 'שירות', before: findServiceName(editBaseline.service_id), after: findServiceName(formData.service_id) } : null,
    formData.instructor_employee_id !== editBaseline.instructor_employee_id
      ? { label: 'מדריך/ה', before: findInstructorName(editBaseline.instructor_employee_id), after: findInstructorName(formData.instructor_employee_id) }
      : null,
    useSchedulingOverride !== editBaseline.useSchedulingOverride
      ? { label: 'שיבוץ חריג', before: editBaseline.useSchedulingOverride ? 'כן' : 'לא', after: useSchedulingOverride ? 'כן' : 'לא' }
      : null,
  ].filter(Boolean) : [];
  const editEndTime = (() => {
    const [hours, minutes] = String(formData.time || '').split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return '';
    const total = hours * 60 + minutes + (Number(formData.duration_minutes) || 0);
    return String(Math.floor(total / 60) % 24).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  })();
  const invalidServiceDuration = Boolean(selectedEditService && !selectedEditServiceHasValidDuration);
  const availabilityTone = invalidServiceDuration
    ? 'bad'
    : (schedulingAvailabilityState.status === 'within_availability'
      ? 'ok'
      : (schedulingAvailabilityState.status === 'outside_instructor_service_availability' ? 'warn' : 'bad'));
  const availabilityText = invalidServiceDuration
    ? 'לשירות שנבחר אין משך תקין. יש לעדכן את משך השירות לפני השמירה.'
    : (schedulingAvailabilityState.status === 'within_availability'
      ? 'בתוך חלונות הזמינות של המדריך/ה לשירות הזה.'
      : (useSchedulingOverride && schedulingAvailabilityState.status === 'outside_instructor_service_availability'
        ? 'מחוץ לזמינות — יישמר כשיבוץ חד-פעמי חריג.'
        : schedulingAvailabilityState.message));
  const NOTE_TONES = {
    ok: 'bg-emerald-50 text-emerald-800',
    warn: 'bg-amber-50 text-amber-800',
    bad: 'bg-red-50 text-red-800',
  };
  const changedFieldClass = (current, baseline) => (editBaseline && current !== baseline ? 'border-primary ring-2 ring-primary/20' : '');
  const fieldLabelClass = 'text-xs font-bold text-slate-600';

  const billingWarningAlert = billingWarnings.length > 0 ? (() => {
    const participantMap = new Map(
      displayParticipants.flatMap((participant) => {
        const displayName = getParticipantDisplayName(participant, 'לקוח/ה');
        return [
          participant?.student_id ? ['student:' + participant.student_id, displayName] : null,
          participant?.client_profile_id ? ['client:' + participant.client_profile_id, displayName] : null,
          participant?.student?.client_profile_id ? ['client:' + participant.student.client_profile_id, displayName] : null,
        ].filter(Boolean);
      })
    );
    const names = billingWarnings
      .map((warning) => (
        participantMap.get(warning?.student_id ? 'student:' + warning.student_id : '')
        || participantMap.get(warning?.client_profile_id ? 'client:' + warning.client_profile_id : '')
        || 'לקוח/ה'
      ))
      .filter((value, index, all) => all.indexOf(value) === index)
      .join(', ');
    return (
      <Alert variant="warning" className="border-amber-300 bg-amber-50 text-amber-900">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertDescription className="flex items-start justify-between gap-3">
          <span>
            <strong>החיוב לא נוצר</strong>
            <br />
            {'לא נמצאה מסגרת חיוב תקינה עבור: ' + names + '. יש להסדיר זאת בכרטיס הלקוח כדי שהחיוב יתבצע.'}
          </span>
          <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 px-2" onClick={() => setBillingWarnings([])} aria-label="סגירת ההתראה">
            <X className="h-4 w-4" />
          </Button>
        </AlertDescription>
      </Alert>
    );
  })() : null;

  const conflictAlert = conflictState ? (
    <Alert className="border-amber-300 bg-amber-50 text-amber-950">
      <AlertTriangle className="h-4 w-4 text-amber-700" />
      <AlertDescription className="space-y-3">
        <div className="font-medium">{conflictState.title}</div>
        <div className="text-sm">הפעולה שביקשתם: {conflictState.actionLabel}.</div>
        <div className="text-sm">המצב הנוכחי בשרת:</div>
        <ul className="list-disc space-y-1 pe-5 text-sm">
          {(conflictState.diffLines || []).map((line, index) => (
            <li key={line + '-' + index}>{line}</li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="outline" onClick={clearConflict} disabled={isResolvingConflict}>ביטול</Button>
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
            {isResolvingConflict ? (<><Loader2 className="me-2 h-4 w-4 animate-spin" />מחיל...</>) : 'החל בכל זאת'}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  ) : null;

  const addParticipantPanel = isAddingParticipant ? (
    <div className="flex flex-col gap-2 rounded-2xl border border-primary/20 bg-primary/5 p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-slate-400" />
        <Input
          placeholder="חיפוש לקוח/ה לפי שם או טלפון (2 תווים לפחות)"
          value={addStudentQuery}
          onChange={(e) => {
            const nextQuery = e.target.value;
            setAddStudentQuery(nextQuery);
            window.clearTimeout(studentSearchTimerRef.current);
            studentSearchTimerRef.current = window.setTimeout(() => searchStudents(nextQuery), 250);
          }}
          className="h-9 bg-white ps-9 text-sm"
          aria-label="חיפוש לקוח/ה להוספה"
          autoFocus
        />
      </div>
      {isSearchingStudents ? (
        <div className="flex items-center gap-1.5 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" /> מחפשים...</div>
      ) : null}
      {!isSearchingStudents && addStudentResults.length > 0 ? (() => {
        const enrolledIds = new Set(displayParticipants.map((participant) => participant.student_id));
        const filtered = addStudentResults.filter((student) => !enrolledIds.has(student.id));
        return filtered.length === 0 ? (
          <p className="text-xs text-slate-500">כל הלקוחות שנמצאו כבר רשומים לשיעור.</p>
        ) : (
          <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
            {filtered.map((student) => {
              const studentName = [student.first_name, student.last_name].filter(Boolean).join(' ');
              return (
                <button
                  key={student.id}
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-lg bg-white px-2.5 py-2 text-start text-sm hover:ring-1 hover:ring-primary/30 disabled:opacity-60"
                  onClick={() => handleAddParticipant(student.id, studentName)}
                  disabled={Boolean(addingParticipantId)}
                >
                  {addingParticipantId === student.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5 text-slate-400" />}
                  <span className="font-bold">{studentName}</span>
                  {student.phone ? <span className="ms-auto text-xs text-slate-500"><bdi dir="ltr">{student.phone}</bdi></span> : null}
                </button>
              );
            })}
          </div>
        );
      })() : null}
      {!isSearchingStudents && addStudentQuery.length >= 2 && addStudentResults.length === 0 ? (
        <p className="text-xs text-slate-500">לא נמצאו לקוחות.</p>
      ) : null}
    </div>
  ) : null;

  const lessonTabBody = (
    <div className="flex flex-col gap-3">
      {isCancelled ? (
        <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2.5 text-[13px] text-slate-600">
          <X className="h-4 w-4 shrink-0" /> השיעור בוטל.
        </div>
      ) : null}
      <div className="flex min-h-[30px] items-center gap-2 px-1">
        <span className="text-[13px] text-slate-500"><b className="font-bold text-slate-900">{participantsLabel}</b>{seatsLabel}</span>
        {canAddParticipant ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ms-auto h-8 gap-1.5 text-xs"
            onClick={() => {
              if (isAddingParticipant) {
                setIsAddingParticipant(false);
                setAddStudentQuery('');
                setAddStudentResults([]);
              } else {
                setIsAddingParticipant(true);
              }
            }}
          >
            {isAddingParticipant ? <X className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
            {isAddingParticipant ? 'סגירת החיפוש' : 'הוספת משתתף/ת'}
          </Button>
        ) : null}
      </div>
      {addParticipantPanel}
      {displayParticipants.length > 0 ? (
        <LessonParticipantRoster
          participants={displayParticipants}
          localReminderState={localReminderState}
          lessonStarted={lessonStarted}
          canMarkAttendance={canMarkAttendance}
          canManageAll={canManageAll}
          isLocked={isLessonLocked}
          isOperationallyOpen={isOperationallyOpen}
          isMarkingAttendance={isMarkingAttendance}
          reminderUpdating={reminderUpdating}
          sessionReportsEnabled={sessionReportsEnabled}
          reportsByParticipant={reportsByParticipant}
          sessionReportsLoading={sessionReportsLoading}
          sessionReportsLoadFailed={sessionReportsLoadFailed}
          onOpenSessionReport={handleOpenSessionReport}
          onRetrySessionReports={() => void loadSessionReports()}
          resolveReminderContact={resolveReminderContact}
          formatPhoneForWhatsApp={formatPhoneForWhatsApp}
          onMarkAttended={(participant) => {
            closeAbsenceForm();
            void openAttendancePreview(participant, 'attended');
          }}
          onOpenAbsence={(participantId, options) => {
            cancelStatusStrip();
            openAbsenceForm(participantId, options);
          }}
          onRestore={(participant) => {
            closeAbsenceForm();
            void openRestorePreview(participant);
          }}
          onSendWhatsApp={handleSendWaReminder}
          onSendEmail={handleSendEmailReminder}
          onConfirmArrival={(participant) => void handleSetReminderConfirmation(participant, true)}
          onDeclineArrival={(participant) => void handleSetReminderConfirmation(participant, false)}
          absenceForm={absenceForm}
          setAbsenceForm={setAbsenceForm}
          absenceFormError={absenceFormError}
          absenceRequirements={absenceRequirements}
          absenceRequirementsLoading={absenceRequirementsLoading}
          billingPolicy={billingPolicy}
          instructorName={displayInstance.instructor?.full_name}
          onAbsenceStatusChange={handleAbsenceStatusChange}
          onCloseAbsence={closeAbsenceForm}
          onContinueAbsence={confirmAbsenceForm}
          statusStrip={statusStrip}
          onConfirmStrip={() => void confirmStatusStrip()}
          onCancelStrip={cancelStatusStrip}
        />
      ) : (
        <EmptyTabState
          title="אין משתתפים בשיעור"
          description="כשיתווספו משתתפים, סימון הנוכחות והתזכורות שלהם יופיעו כאן."
        />
      )}
    </div>
  );

  const editBody = (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 sm:p-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lesson-edit-date" className={fieldLabelClass}>תאריך</Label>
          <Input
            id="lesson-edit-date"
            type="date"
            value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
            className={changedFieldClass(formData.date, editBaseline?.date)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lesson-edit-time" className={fieldLabelClass}>שעת התחלה</Label>
          <Input
            id="lesson-edit-time"
            type="time"
            value={formData.time}
            onChange={(e) => setFormData({ ...formData, time: e.target.value })}
            className={changedFieldClass(formData.time, editBaseline?.time)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lesson-edit-service" className={fieldLabelClass}>שירות</Label>
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
            <SelectTrigger id="lesson-edit-service" className={changedFieldClass(formData.service_id, editBaseline?.service_id)}>
              <SelectValue placeholder="בחרו שירות" />
            </SelectTrigger>
            <SelectContent>
              {activeServices.map((service) => (
                <SelectItem key={service.id} value={service.id}>{service.service_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lesson-edit-instructor" className={fieldLabelClass}>מדריך/ה</Label>
          <Select
            value={formData.instructor_employee_id || ''}
            onValueChange={(value) => setFormData({ ...formData, instructor_employee_id: value })}
            disabled={instructorsLoading}
          >
            <SelectTrigger id="lesson-edit-instructor" className={changedFieldClass(formData.instructor_employee_id, editBaseline?.instructor_employee_id)}>
              <SelectValue placeholder="בחרו מדריך/ה" />
            </SelectTrigger>
            <SelectContent>
              {instructors.map((instructor) => (
                <SelectItem key={instructor.id} value={instructor.id}>{instructor.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className={'flex items-start gap-2 rounded-lg px-3 py-2 text-xs font-semibold sm:col-span-2 ' + NOTE_TONES[availabilityTone]}>
          {availabilityTone === 'ok' ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>
            <bdi dir="ltr">{(formData.time || '—') + '–' + (editEndTime || '—')}</bdi>
            {' · ' + (formData.duration_minutes || 0) + ' דקות לפי השירות · ' + (availabilityText || '')}
          </span>
        </div>
      </div>

      {(schedulingAvailabilityState.status === 'outside_instructor_service_availability' || useSchedulingOverride) ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="lesson-scheduling-override"
              checked={useSchedulingOverride}
              onCheckedChange={(checked) => setUseSchedulingOverride(checked === true)}
              disabled={schedulingAvailabilityState.status === 'missing_capability' || schedulingAvailabilityState.status === 'missing_availability'}
            />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="lesson-scheduling-override" className="text-sm font-bold text-amber-900">שיבוץ חד-פעמי מחוץ לזמינות</Label>
              <p className="text-xs text-amber-900/80">אפשר לשמור את המועד הזה כחריגה. הסיבה תוצג בשיעור ותישמר ביומן הביקורת.</p>
            </div>
          </div>
          {useSchedulingOverride ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lesson-override-reason-code" className={fieldLabelClass}>סיבת החריגה</Label>
                <Select value={selectedOverrideReasonCode || ''} onValueChange={setSelectedOverrideReasonCode}>
                  <SelectTrigger id="lesson-override-reason-code" className="bg-white">
                    <SelectValue placeholder="בחרו סיבה" />
                  </SelectTrigger>
                  <SelectContent>
                    {SCHEDULING_OVERRIDE_REASON_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedOverrideReasonCode === 'custom' ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lesson-override-custom-reason" className={fieldLabelClass}>פירוט</Label>
                  <Textarea
                    id="lesson-override-custom-reason"
                    rows={2}
                    value={customOverrideReason}
                    onChange={(event) => setCustomOverrideReason(event.target.value)}
                    placeholder="למה נדרש המועד הזה?"
                    className="bg-white"
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="px-1 text-xs text-slate-500">
        סטטוס השיעור לא נערך כאן: השלמה דרך "סמן כהושלם", וביטול דרך תפריט הפעולות.
      </p>
    </div>
  );

  const editFooter = (
    <div className="flex flex-col gap-2.5">
      {(editChanges.length || editPreview || editPreviewError) ? (
        <div className="flex max-h-[32vh] flex-col gap-2 overflow-y-auto">
          {editChanges.length ? (
            <div className="flex flex-wrap gap-1.5">
              {editChanges.map((change) => (
                <span key={change.label} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2 py-1 text-xs">
                  <span className="font-bold text-primary">{change.label}</span>
                  <span className="text-slate-500 line-through">{change.before}</span>
                  <span aria-hidden="true" className="text-slate-400">←</span>
                  <span className="font-bold text-slate-900">{change.after}</span>
                </span>
              ))}
            </div>
          ) : null}
          {editPreviewError ? (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs font-medium text-red-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{editPreviewError}</span>
            </div>
          ) : null}
          {editPreview ? (
            <>
              {(editPreview.impacts || []).map((impact, index) => (
                <div key={(impact.type || 'impact') + '-' + index} className={'rounded-lg border px-2.5 py-2 text-xs ' + getPreviewImpactClass(impact.severity)}>
                  <span className="font-bold">{impact.label || 'השפעה'}</span>
                  {impact.message ? <span className="opacity-85"> · {impact.message}</span> : null}
                </div>
              ))}
              {editPreview.can_apply === false ? (
                <div className="text-xs font-bold text-red-700">השמירה חסומה — יש לתקן את מה שמסומן למעלה.</div>
              ) : (
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                  <Check className="h-3.5 w-3.5" /> נבדק מול השרת — אפשר לשמור
                </div>
              )}
            </>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center gap-2.5">
        {!isEditDirty ? <span className="text-[13px] text-slate-500">לא בוצעו שינויים</span> : null}
        <div className="ms-auto flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={requestExitEdit} disabled={isSaving || editPreviewLoading}>ביטול עריכה</Button>
          {editPreview && pendingEditBody ? (
            <Button
              type="button"
              onClick={confirmEditPreview}
              disabled={isSaving || editPreviewLoading || editPreview.can_apply === false}
              className="min-w-32 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {isSaving ? 'שומרים...' : 'אישור ושמירה'}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleSave}
              disabled={!isEditDirty || isSaving || editPreviewLoading || invalidServiceDuration}
              className="min-w-32 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {editPreviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editPreviewLoading ? 'בודקים...' : 'בדיקת השפעה'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  const viewFooter = (
    <div className="flex items-center gap-2.5">
      {footNoteNode}
      <div className="ms-auto flex items-center gap-2">
        {canQuickReport ? (
          <Button
            type="button"
            onClick={() => handleReportStatus('completed')}
            disabled={isSaving || hasUnsetParticipants}
            className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
          >
            <Check className="h-4 w-4" /> סמן כהושלם
          </Button>
        ) : null}
        {canEdit ? (
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              resetEditState();
              setIsEditMode(true);
            }}
          >
            <Pencil className="h-4 w-4" /> עריכה
          </Button>
        ) : null}
        {canEdit && !isCancelled ? (
          <DropdownMenu dir="rtl">
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" className="h-10 w-10 p-0" aria-label="פעולות נוספות">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuItem
                className="gap-2 text-red-700 focus:text-red-800"
                onSelect={() => {
                  setCancelDialogOpen(true);
                  void openCancelPreview();
                }}
              >
                <X className="h-3.5 w-3.5" /> ביטול השיעור...
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {!canQuickReport && !canEdit ? (
          <Button type="button" variant="outline" onClick={requestClose}>סגירה</Button>
        ) : null}
      </div>
    </div>
  );

  const correctionFooter = (
    <div className="flex items-center gap-2.5">
      <span className="text-[13px] text-slate-500">התיקון נשמר כרשומה נוספת ביומן הביקורת.</span>
      <Button type="button" variant="ghost" className="ms-auto" onClick={() => setIsCorrectionMode(false)}>חזרה לשיעור</Button>
    </div>
  );

  let body;
  if (isCorrectionMode) {
    body = (
      <LockedCorrectionPanel
        instance={instance}
        orgId={org?.id}
        forceOpen
        onApplied={() => {
          onUpdate?.();
          setIsCorrectionMode(false);
        }}
      />
    );
  } else if (isEditMode) {
    body = editBody;
  } else if (showHistory) {
    body = (
      <LessonHistoryTab
        orgId={org?.id}
        instanceId={instance.id}
        version={instance.version}
        exceptionReason={schedulingOverrideReason}
        createdSource={displayInstance.created_source}
        lessonId={displayInstance.id}
      />
    );
  } else {
    body = lessonTabBody;
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) requestClose(); }}>
        <DialogContent
          bare
          hideDefaultClose
          className="max-w-[860px] overflow-visible rounded-[22px] border-slate-200 bg-background p-0 shadow-2xl sm:rounded-[22px]"
        >
          <LessonDialogHeader
            serviceName={displayInstance.service?.service_name || 'שירות לא ידוע'}
            serviceColor={displayInstance.service?.color}
            status={isCancelled ? 'cancelled' : displayInstance.status}
            statusLabel={headerStatusLabel}
            exceptionReason={schedulingOverrideReason}
            corrected={Boolean(instance.latest_correction)}
            dateLabel={headerDateLabel}
            timeRange={startTime && endTime ? startTime + '–' + endTime : '—'}
            instructorName={displayInstance.instructor?.full_name || 'לא ידוע'}
            notice={headerNotice}
            tabs={headerTabs}
            activeTab={activeViewTab}
            onTabChange={setActiveViewTab}
            modeLabel={headerModeLabel}
            ModeIcon={HeaderModeIcon}
            onClose={requestClose}
          />

          <div className={'dialog-scroll-content flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pb-5 sm:px-7 ' + (hasEdgeControl ? 'pt-9' : 'pt-5')}>
            {error ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {conflictAlert}
            {billingWarningAlert}
            {body}
          </div>

          <div className="rounded-b-[22px] border-t border-slate-200 bg-white px-5 py-3.5 sm:px-7">
            {isCorrectionMode ? correctionFooter : (isEditMode ? editFooter : viewFooter)}
          </div>
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
              <DialogTitle>ביטול השיעור</DialogTitle>
              <DialogDescription>
                המשתתפים שעדיין מתוכננים יסומנו "ביטול ע״י המכון". ההשפעה מחושבת מול מצב השרת הנוכחי.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {cancelPreviewLoading ? (
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                  טוענים את ההשפעה מהשרת...
                </div>
              ) : null}
              {cancelPreviewError ? (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{cancelPreviewError}</AlertDescription>
                </Alert>
              ) : null}
              {!cancelPreviewLoading && !cancelPreviewError && cancelPreviewBlocked ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                  <div className="flex items-start gap-2 text-sm text-red-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <div>
                      <div className="font-semibold">אי אפשר לבטל את השיעור כרגע</div>
                      <div className="mt-0.5">נוכחות כבר סומנה עבור: {cancelPreviewAttendedNames.join(', ')}. החזירו אותם למתוכנן, ואז בטלו.</div>
                    </div>
                  </div>
                </div>
              ) : null}
              {!cancelPreviewLoading && !cancelPreviewError && !cancelPreviewBlocked && cancelPreview ? (
                <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="flex items-start gap-3 px-4 py-3 text-sm">
                    <Users className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <div className="text-slate-700">
                      {cancelPreviewScheduledCount > 0 ? (
                        <>
                          <span className="font-medium text-slate-900">{cancelPreviewScheduledCount} משתתפים</span> יסומנו "ביטול ע״י המכון"
                          {cancelPreviewResolvedCount > 0 ? (
                            <span className="text-slate-400"> · {cancelPreviewResolvedCount} שכבר הוכרעו לא ישתנו</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-slate-500">אין משתתפים מתוכננים — יעודכן סטטוס השיעור בלבד</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 px-4 py-3 text-sm">
                    {clinicCancellationChargesClients ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" /> : <Check className="h-4 w-4 shrink-0 text-emerald-500" />}
                    <span className="text-slate-700">
                      {clinicCancellationChargesClients ? 'הלקוחות יחויבו לפי מדיניות הארגון' : 'ללא חיוב ללקוחות'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 px-4 py-3 text-sm">
                    {clinicCancellationPaysInstructor ? <Check className="h-4 w-4 shrink-0 text-emerald-500" /> : <X className="h-4 w-4 shrink-0 text-slate-400" />}
                    <span className="text-slate-700">
                      {clinicCancellationPaysInstructor ? 'המדריך/ה יקבל/תקבל שכר לפי מדיניות הארגון' : 'ללא שכר למדריך/ה'}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCancelDialogOpen(false)} disabled={isSaving || cancelPreviewLoading}>
                חזרה
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => handleCancelSelection('cancelled')}
                disabled={isSaving || cancelPreviewLoading || Boolean(cancelPreviewError) || cancelPreviewBlocked || !cancelPreview}
              >
                ביטול השיעור
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(discardConfirm)} onOpenChange={(openValue) => { if (!openValue) setDiscardConfirm(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>לבטל את השינויים?</DialogTitle>
              <DialogDescription>
                השינויים במועד ובשיבוץ ({editChanges.map((change) => change.label).join(', ') || 'עריכה'}) עדיין לא נשמרו.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDiscardConfirm(null)}>המשך עריכה</Button>
              <Button type="button" variant="destructive" onClick={confirmDiscard}>ביטול השינויים</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Dialog>
    </TooltipProvider>
  );
}
