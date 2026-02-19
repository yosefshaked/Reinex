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
import { Pencil, X, Check, XCircle, Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '../../../components/ui/alert';

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
  const [error, setError] = useState(null);
  
  const [formData, setFormData] = useState({
    instructor_employee_id: '',
    service_id: '',
    date: '',
    time: '',
    duration_minutes: 60,
    status: 'scheduled',
    cancellation_reason: '',
  });

  // Initialize form data when instance changes
  useEffect(() => {
    if (instance) {
      const dateTime = new Date(instance.datetime_start);
      setFormData({
        instructor_employee_id: instance.instructor_employee_id || '',
        service_id: instance.service_id || '',
        date: dateTime.toISOString().split('T')[0],
        time: dateTime.toTimeString().slice(0, 5),
        duration_minutes: instance.duration_minutes || 60,
        status: instance.status || 'scheduled',
        cancellation_reason: instance.cancellation_reason || '',
      });
    }
  }, [instance]);

  if (!instance) return null;

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
      const datetime_start = `${formData.date}T${formData.time}:00`;
      
      const response = await fetch('/api/calendar/instances', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        },
        body: JSON.stringify({
          id: instance.id,
          org_id: org.id,
          datetime_start,
          duration_minutes: formData.duration_minutes,
          instructor_employee_id: formData.instructor_employee_id,
          service_id: formData.service_id,
          status: formData.status,
          cancellation_reason: formData.cancellation_reason || null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update lesson');
      }

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
      const response = await fetch('/api/calendar/attendance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        },
        body: JSON.stringify({
          org_id: org.id,
          instance_id: instance.id,
          participant_id: participantId,
          participant_status: status,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to mark attendance');
      }

      onUpdate?.();
    } catch (err) {
      console.error('Error marking attendance:', err);
      setError(err.message);
    } finally {
      setIsMarkingAttendance(false);
    }
  }

  async function handleCancel(reason) {
    if (!org?.id) {
      setError('Organization not found');
      return;
    }
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/calendar/instances', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        },
        body: JSON.stringify({
          id: instance.id,
          org_id: org.id,
          status: 'cancelled',
          cancellation_reason: reason,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to cancel lesson');
      }

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
      const response = await fetch('/api/calendar/instances', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        },
        body: JSON.stringify({
          id: instance.id,
          org_id: org.id,
          status,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update status');
      }

      onUpdate?.();
      onClose();
    } catch (err) {
      console.error('Error reporting lesson status:', err);
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  const activeServices = services?.filter(s => s.is_active) || [];
  const isReportable = instance.status === 'scheduled' || instance.status === 'rescheduled';
  const canEdit = canManageAll && isReportable;
  const canMarkAttendance = isReportable;
  const canReportStatus = !canManageAll && isReportable;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>פרטי שיעור</span>
            {!isEditMode && canEdit && (
              <Button variant="ghost" size="sm" onClick={() => setIsEditMode(true)}>
                <Pencil className="h-4 w-4 ml-2" />
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
                  <SelectItem value="rescheduled">נדחה</SelectItem>
                  <SelectItem value="cancelled">בוטל</SelectItem>
                  <SelectItem value="completed">הושלם</SelectItem>
                  {canManageAll && <SelectItem value="no_show">אי הגעה</SelectItem>}
                </SelectContent>
              </Select>
            </div>

            {/* Cancellation Reason (if cancelled) */}
            {formData.status === 'cancelled' && (
              <div>
                <Label htmlFor="cancellation_reason">סיבת ביטול</Label>
                <Select
                  value={formData.cancellation_reason}
                  onValueChange={(value) => setFormData({ ...formData, cancellation_reason: value })}
                >
                  <SelectTrigger id="cancellation_reason">
                    <SelectValue placeholder="בחר סיבה" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="student_request">בקשת תלמיד</SelectItem>
                    <SelectItem value="clinic_closure">סגירת מרפאה</SelectItem>
                    <SelectItem value="instructor_unavailable">מדריך לא זמין</SelectItem>
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
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
              {canReportStatus && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleReportStatus('completed')}
                    disabled={isSaving}
                  >
                    <Check className="h-4 w-4 ml-1" />
                    הושלם
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleReportStatus('no_show')}
                    disabled={isSaving}
                  >
                    <XCircle className="h-4 w-4 ml-1" />
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
                {(instance.participants || []).map((participant) => (
                  <div
                    key={participant.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{participant.student?.full_name || 'לא ידוע'}</p>
                      <p className="text-sm text-gray-600">
                        {participant.participant_status === 'attended' && '✓ נכח'}
                        {participant.participant_status === 'no_show' && '✗ לא הגיע'}
                        {participant.participant_status === 'pending' && 'ממתין'}
                      </p>
                    </div>
                    {participant.price_charged && (
                      <Badge variant="outline" className="ml-2">₪{participant.price_charged}</Badge>
                    )}
                    {canMarkAttendance && participant.participant_status === 'pending' && (
                      <div className="flex gap-1 mr-2">
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
                ))}
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
            {instance.cancellation_reason && (
              <div>
                <label className="text-sm font-medium text-gray-700">סיבת ביטול</label>
                <p className="mt-1 text-gray-900">{instance.cancellation_reason}</p>
              </div>
            )}

            {/* Created Source */}
            {instance.created_source && (
              <div className="text-sm text-gray-600">
                מקור: {instance.created_source}
              </div>
            )}

            {/* Cancel Button */}
            {canEdit && instance.status !== 'cancelled' && (
              <div className="pt-4 border-t">
                <Button
                  variant="destructive"
                  onClick={() => {
                    const reason = prompt('סיבת ביטול:\n\n1. בקשת תלמיד\n2. סגירת מרפאה\n3. מדריך לא זמין\n4. אי הגעה\n5. אחר\n\nהכנס מספר (1-5):');
                    const reasonMap = {
                      '1': 'student_request',
                      '2': 'clinic_closure',
                      '3': 'instructor_unavailable',
                      '4': 'no_show',
                      '5': 'other',
                    };
                    if (reason && reasonMap[reason]) {
                      handleCancel(reasonMap[reason]);
                    }
                  }}
                  disabled={isSaving}
                >
                  <X className="mr-2 h-4 w-4" />
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
