import { useState, useEffect } from 'react';
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
import { Pencil, X, Check, XCircle, Loader2, AlertCircle, AlertTriangle, MessageCircle, Mail, ThumbsUp, ThumbsDown } from 'lucide-react';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Textarea } from '../../../components/ui/textarea';
import { LockedCorrectionPanel } from './LockedCorrectionPanel';

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
  return error?.message || 'הפעולה נכשלה.';
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
  
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isMarkingAttendance, setIsMarkingAttendance] = useState(false);
  const [reminderUpdating, setReminderUpdating] = useState(false);
  const [localReminderState, setLocalReminderState] = useState({});
  const [error, setError] = useState(null);
  const [billingWarnings, setBillingWarnings] = useState([]);
  // absenceForm: { participantId, status, notes } | null
  const [absenceForm, setAbsenceForm] = useState(null);
  
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
  }, [instance?.id, instance?.latest_correction?.id]);

  if (!instance) return null;

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

  const statusInfo = getInstanceStatusIcon(displayInstance.status, displayInstance.documentation_status);
  const startTime = formatTimeDisplay(displayInstance.datetime_start);
  const endDate = new Date(new Date(displayInstance.datetime_start).getTime() + displayInstance.duration_minutes * 60000);
  const endTime = formatTimeDisplay(endDate.toISOString());
  const dateDisplay = formatDateDisplay(displayInstance.datetime_start);

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
      setError(resolveMutationError(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleMarkAttendance(participantId, status, notes) {
    if (!org?.id) {
      setError('Organization not found');
      return;
    }
    setIsMarkingAttendance(true);
    setError(null);

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
      const result = await authenticatedFetch('calendar/attendance', {
        method: 'POST',
        body,
      });

      if (result?.billing_warnings?.length > 0) {
        setBillingWarnings(result.billing_warnings);
      }
      onUpdate?.();
    } catch (err) {
      console.error('Error marking attendance:', err);
      setError(resolveMutationError(err));
    } finally {
      setIsMarkingAttendance(false);
    }
  }

  function openAbsenceForm(participantId) {
    setAbsenceForm({ participantId, status: 'no_show', notes: '' });
  }

  function closeAbsenceForm() {
    setAbsenceForm(null);
  }

  async function confirmAbsenceForm() {
    if (!absenceForm) return;
    await handleMarkAttendance(absenceForm.participantId, absenceForm.status, absenceForm.notes);
    setAbsenceForm(null);
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
      setError(resolveMutationError(err));
    } finally {
      setIsSaving(false);
    }
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
      setError(resolveMutationError(err));
    } finally {
      setIsSaving(false);
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
        await authenticatedFetch('calendar/attendance', {
          method: 'POST',
          body: {
            org_id: org.id,
            instance_id: instance.id,
            participant_id: participant.id,
            participant_status: 'cancelled_student',
          },
        });
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
  const isReportable = displayInstance.status === 'scheduled';
  const canEdit = canManageAll && isReportable && !instance.is_locked;
  const canMarkAttendance = isReportable && !instance.is_locked;
  const canQuickReport = isReportable && !instance.is_locked;

  const scheduledParticipantsCount = displayParticipants.filter(
    (p) => p.participant_status === 'scheduled'
  ).length;
  // Block completing an instance when at least one participant still has no resolved attendance status.
  // An instance with zero participants is exempt (e.g. template-generated shells before enrolment).
  const hasUnsetParticipants =
    displayParticipants.length > 0 && scheduledParticipantsCount > 0;

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

        {(instance.is_locked || instance.latest_correction) && canManageAll && (
          <LockedCorrectionPanel
            instance={instance}
            orgId={org?.id}
            forceOpen={Boolean(error && instance.is_locked)}
            onApplied={() => onUpdate?.()}
          />
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
                  const participantNotes = participant.metadata?.notes || null;
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
                        </div>
                        {participant.price_charged && (
                          <Badge variant="outline" className="ms-2">₪{participant.price_charged}</Badge>
                        )}
                        {canMarkAttendance && isScheduled && !isAbsenceFormOpen && (
                          <div className="flex gap-1 ms-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleMarkAttendance(participant.id, 'attended')}
                              disabled={isMarkingAttendance}
                              title="נכח"
                            >
                              <Check className="h-4 w-4 text-green-600" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openAbsenceForm(participant.id)}
                              disabled={isMarkingAttendance}
                              title="לא הגיע / ביטול"
                            >
                              <XCircle className="h-4 w-4 text-red-600" />
                            </Button>
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
                              onValueChange={(value) => setAbsenceForm((prev) => ({ ...prev, status: value }))}
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
                          <div className="flex gap-2 justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={closeAbsenceForm}
                              disabled={isMarkingAttendance}
                            >
                              ביטול
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={confirmAbsenceForm}
                              disabled={isMarkingAttendance}
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
                  onClick={() => {
                    const selection = prompt('בחר סטטוס:\n\n1. בוטל ע"י תלמיד\n2. בוטל ע"י המרפאה\n3. אי הגעה\n\nהכנס מספר (1-3):');
                    const statusMap = {
                      '1': { status: 'cancelled_student', closed_reason: 'student_request' },
                      '2': { status: 'cancelled_clinic', closed_reason: 'clinic_closure' },
                      '3': { status: 'no_show', closed_reason: 'no_show' },
                    };
                    if (selection && statusMap[selection]) {
                      handleCancel(statusMap[selection].status, statusMap[selection].closed_reason);
                    }
                  }}
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
    </Dialog>
  );
}
