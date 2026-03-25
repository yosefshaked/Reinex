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
import { Pencil, X, Check, XCircle, Loader2, AlertCircle, MessageCircle, ThumbsUp, ThumbsDown } from 'lucide-react';
import { Alert, AlertDescription } from '../../../components/ui/alert';

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
  
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isMarkingAttendance, setIsMarkingAttendance] = useState(false);
  const [reminderUpdating, setReminderUpdating] = useState(false);
  const [localReminderState, setLocalReminderState] = useState({});
  const [error, setError] = useState(null);
  
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
    if (instance) {
      const dateTime = new Date(instance.datetime_start);
      setFormData({
        instructor_employee_id: instance.instructor_employee_id || '',
        service_id: instance.service_id || '',
        date: toLocalDateString(dateTime),
        time: dateTime.toTimeString().slice(0, 5),
        duration_minutes: instance.duration_minutes || 60,
        status: instance.status || 'scheduled',
        closed_reason: instance.closed_reason || '',
      });
    }
  }, [instance]);

  // Reset local reminder optimistic state when a different instance is opened
  useEffect(() => {
    setLocalReminderState({});
  }, [instance?.id]);

  if (!instance) return null;

  function formatPhoneForWhatsApp(phone) {
    if (!phone) return null;
    const digits = String(phone).replace(/\D/g, '');
    if (!digits) return null;
    if (digits.startsWith('972')) return digits;
    if (digits.startsWith('0')) return '972' + digits.slice(1);
    return '972' + digits;
  }

  function buildReminderMessage(lessonInstance, studentName) {
    const date = formatDateDisplay(lessonInstance.datetime_start);
    const time = formatTimeDisplay(lessonInstance.datetime_start);
    const service = lessonInstance.service?.service_name || 'שיעור';
    return `שלום ${studentName} 😊\nרצינו להזכיר לך שיש לך ${service} ב-${date} בשעה ${time}.\nנשמח לאישור הגעתך 🙏`;
  }

  const statusInfo = getInstanceStatusIcon(instance.status, instance.documentation_status);
  const startTime = formatTimeDisplay(instance.datetime_start);
  const endDate = new Date(new Date(instance.datetime_start).getTime() + instance.duration_minutes * 60000);
  const endTime = formatTimeDisplay(endDate.toISOString());
  const dateDisplay = formatDateDisplay(instance.datetime_start);

  async function handleSave() {
    if (!org?.id) {
      setError('Organization not found');
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
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleMarkAttendance(participantId, status) {
    if (!org?.id) {
      setError('Organization not found');
      return;
    }
    setIsMarkingAttendance(true);
    setError(null);

    try {
      await authenticatedFetch('calendar/attendance', {
        method: 'POST',
        body: {
          org_id: org.id,
          instance_id: instance.id,
          participant_id: participantId,
          participant_status: status,
        },
      });

      onUpdate?.();
    } catch (err) {
      console.error('Error marking attendance:', err);
      setError(err.message);
    } finally {
      setIsMarkingAttendance(false);
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
        },
      });

      onUpdate?.();
      onClose();
    } catch (err) {
      console.error('Error cancelling lesson:', err);
      setError(err.message);
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

    try {
      await authenticatedFetch('calendar/instances', {
        method: 'PUT',
        body: {
          id: instance.id,
          org_id: org.id,
          status,
        },
      });

      onUpdate?.();
      onClose();
    } catch (err) {
      console.error('Error reporting lesson status:', err);
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSendReminder(participant) {
    const waPhone = formatPhoneForWhatsApp(participant.student?.phone);
    if (!waPhone || !org?.id) return;

    const studentName = participant.student?.full_name
      || [participant.student?.first_name, participant.student?.last_name].filter(Boolean).join(' ')
      || 'תלמיד';

    const message = buildReminderMessage(instance, studentName);
    window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');

    setReminderUpdating(true);
    try {
      await authenticatedFetch('calendar/attendance', {
        method: 'POST',
        body: {
          org_id: org.id,
          instance_id: instance.id,
          participant_id: participant.id,
          action: 'update-reminder',
          reminder_sent: true,
        },
      });
      setLocalReminderState((prev) => ({
        ...prev,
        [participant.id]: { ...(prev[participant.id] || {}), reminder_sent: true },
      }));
      onUpdate?.();
    } catch (err) {
      console.error('Error marking reminder sent:', err);
    } finally {
      setReminderUpdating(false);
    }
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
  const isReportable = instance.status === 'scheduled';
  const canEdit = canManageAll && isReportable;
  const canMarkAttendance = isReportable;
  const canQuickReport = isReportable;

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
              <Badge variant={instance.status === 'completed' ? 'default' : 'secondary'}>
                {statusInfo.label}
              </Badge>
              {canQuickReport && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleReportStatus('completed')}
                    disabled={isSaving}
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
                {instance.service?.color && (
                  <div
                    className="w-4 h-4 rounded"
                    style={{ backgroundColor: instance.service.color }}
                  />
                )}
                <span className="text-lg">{instance.service?.service_name || 'לא ידוע'}</span>
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
                  {startTime} - {endTime} ({instance.duration_minutes} דקות)
                </p>
              </div>
            </div>

            {/* Instructor */}
            <div>
              <label className="text-sm font-medium text-gray-700">מדריך</label>
              <p className="mt-1 text-lg">{instance.instructor?.full_name || 'לא ידוע'}</p>
            </div>

            {/* Participants with Attendance */}
            <div>
              <label className="text-sm font-medium text-gray-700">
                משתתפים ({instance.participants?.length || 0})
              </label>
              <div className="mt-2 space-y-2">
                {(instance.participants || []).map((participant) => {
                  const rs = localReminderState[participant.id] || {};
                  const hasSent = rs.reminder_sent ?? participant.reminder_sent ?? false;
                  const hasConfirmed = rs.reminder_seen ?? participant.reminder_seen ?? false;
                  const waPhone = formatPhoneForWhatsApp(participant.student?.phone);
                  const isScheduled = participant.participant_status === 'scheduled';
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
                        </div>
                        {participant.price_charged && (
                          <Badge variant="outline" className="ms-2">₪{participant.price_charged}</Badge>
                        )}
                        {canMarkAttendance && isScheduled && (
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
                              onClick={() => handleMarkAttendance(participant.id, 'no_show')}
                              disabled={isMarkingAttendance}
                              title="לא הגיע"
                            >
                              <XCircle className="h-4 w-4 text-red-600" />
                            </Button>
                          </div>
                        )}
                      </div>
                      {/* Reminder row — admins only, scheduled participants only */}
                      {isScheduled && canManageAll && (
                        <div className="flex items-center gap-2 pt-1.5 border-t border-gray-200 flex-wrap">
                          <Button
                            size="sm"
                            variant={hasSent ? 'outline' : 'secondary'}
                            onClick={() => handleSendReminder(participant)}
                            disabled={reminderUpdating || !waPhone}
                            title={!waPhone ? 'לא נמצא טלפון לתלמיד' : 'שלח תזכורת ב-WhatsApp'}
                            className="h-7 text-xs gap-1"
                          >
                            <MessageCircle className="h-3 w-3" />
                            {hasSent ? 'שלח שוב' : 'תזכורת WA'}
                          </Button>
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
                          {!waPhone && (
                            <span className="text-xs text-gray-400">אין מספר טלפון</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Documentation Status */}
            {instance.documentation_status && (
              <div>
                <label className="text-sm font-medium text-gray-700">סטטוס תיעוד</label>
                <p className="mt-1">
                  <Badge
                    variant={instance.documentation_status === 'documented' ? 'default' : 'secondary'}
                  >
                    {instance.documentation_status === 'documented' ? 'תועד' : 'ממתין לתיעוד'}
                  </Badge>
                </p>
              </div>
            )}

            {/* Cancellation Reason */}
            {instance.closed_reason && (
              <div>
                <label className="text-sm font-medium text-gray-700">
                  {getCancellationStatusLabel(instance.status)}
                </label>
                <p className="mt-1 text-gray-900">{instance.closed_reason}</p>
              </div>
            )}

            {/* Created Source */}
            {instance.created_source && (
              <div className="text-sm text-gray-600">
                מקור: {instance.created_source}
              </div>
            )}

            {/* Cancel Button */}
            {canEdit && !isCancellationStatus(instance.status) && instance.status !== 'no_show' && (
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
