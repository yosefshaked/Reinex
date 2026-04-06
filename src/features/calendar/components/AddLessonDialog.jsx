import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useOrg } from '@/org/OrgContext';
import { useStudents } from '@/hooks/useOrgData';
import { useCalendarInstructors } from '../hooks/useCalendar';
import { Loader2, AlertCircle, Users, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ComboBoxField } from '@/components/ui/forms-ui';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useAuth } from '@/auth/AuthContext.jsx';
import { dayTokenForJsDay } from '@/lib/day-of-week.js';
import {
  buildAvailabilityTimeSlots,
  getAvailabilityWindowsForDay,
  hasConfiguredAvailability,
} from '@/lib/instructor-availability.js';
import { parseLocalDateString } from '../utils/localDate.js';

function toLocalDateString(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toLocalTimeString(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
  const hours = String(dateObj.getHours()).padStart(2, '0');
  const minutes = String(dateObj.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
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

function getDayTokenForLocalDate(dateString) {
  const parsed = parseLocalDateString(dateString);
  if (!parsed) {
    return null;
  }
  return dayTokenForJsDay(parsed.getDay());
}

function formatTimeLabel(timeString) {
  const [hours = '00', minutes = '00'] = String(timeString || '').split(':');
  return `${hours}:${minutes}`;
}

function buildInitialFormData(defaultDate, defaultSelection) {
  const baseDate = defaultSelection?.start instanceof Date
    ? toLocalDateString(defaultSelection.start)
    : (defaultDate || toLocalDateString(new Date()));
  const baseTime = defaultSelection?.start instanceof Date
    ? toLocalTimeString(defaultSelection.start)
    : '09:00';
  const durationMinutes = defaultSelection?.start instanceof Date && defaultSelection?.end instanceof Date
    ? Math.max(15, Math.round((defaultSelection.end.getTime() - defaultSelection.start.getTime()) / 60000))
    : 60;

  return {
    student_ids: [],
    instructor_employee_id: defaultSelection?.resourceId ? String(defaultSelection.resourceId) : '',
    service_id: '',
    date: baseDate,
    time: baseTime,
    duration_minutes: durationMinutes,
  };
}

/**
 * AddLessonDialog - Create new lesson instance
 * Flow: Select student → Auto-fetch their service/instructor → Add more students if group session → Set date/time
 */
export function AddLessonDialog({ open, onClose, onSuccess, defaultDate, defaultSelection = null }) {
  const { activeOrgId } = useOrg();
  const { session } = useAuth();
  const { instructors, isLoading: instructorsLoading, error: instructorsError } = useCalendarInstructors();

  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesError, setServicesError] = useState('');

  const { students, loadingStudents: studentsLoading, studentsError } = useStudents({
    status: 'active',
    enabled: open && !!activeOrgId,
    orgId: activeOrgId,
  });
  const [isGroupSession, setIsGroupSession] = useState(false);
  
  const [formData, setFormData] = useState(() => buildInitialFormData(defaultDate, defaultSelection));

  const [conflicts, setConflicts] = useState([]);
  const [isCheckingConflicts, setIsCheckingConflicts] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [studentDetails, setStudentDetails] = useState(null); // Cache first student details
  const [useSchedulingOverride, setUseSchedulingOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  useEffect(() => {
    if (!open) {
      return;
    }

    setFormData(buildInitialFormData(defaultDate, defaultSelection));
    setConflicts([]);
    setError(null);
    setStudentDetails(null);
    setIsGroupSession(false);
    setUseSchedulingOverride(false);
    setOverrideReason('');
  }, [open, defaultDate, defaultSelection]);

  useEffect(() => {
    if (!open || !activeOrgId || !session) return;

    let isMounted = true;
    async function fetchServices() {
      setServicesLoading(true);
      setServicesError('');
      try {
        const payload = await authenticatedFetch('services', {
          session,
          params: { org_id: activeOrgId },
        });
        if (!isMounted) return;
        setServices(Array.isArray(payload) ? payload : []);
      } catch (err) {
        if (!isMounted) return;
        setServices([]);
        setServicesError(err?.message || 'טעינת השירותים נכשלה.');
      } finally {
        if (isMounted) setServicesLoading(false);
      }
    }

    fetchServices();
    return () => {
      isMounted = false;
    };
  }, [open, activeOrgId, session]);

  useEffect(() => {
    if (studentsError) {
      console.error('Error fetching students:', studentsError);
    }
  }, [studentsError]);

  const activeServices = useMemo(
    () => (services || []).filter((service) => service?.is_active === true),
    [services],
  );
  const selectedDayToken = useMemo(() => getDayTokenForLocalDate(formData.date), [formData.date]);
  const selectedInstructor = useMemo(
    () => (instructors || []).find((instructor) => String(instructor.id) === String(formData.instructor_employee_id || '')) || null,
    [formData.instructor_employee_id, instructors],
  );
  const selectedCapability = useMemo(
    () => (selectedInstructor?.service_capabilities || []).find((capability) => String(capability.service_id) === String(formData.service_id || '')) || null,
    [selectedInstructor, formData.service_id],
  );

  const serviceQualifiedInstructors = useMemo(() => {
    if (!formData.service_id) {
      return instructors || [];
    }
    return (instructors || []).filter((instructor) =>
      (instructor.service_capabilities || []).some((capability) => String(capability.service_id) === String(formData.service_id)),
    );
  }, [formData.service_id, instructors]);

  const dateAvailableInstructors = useMemo(() => {
    if (!formData.service_id || !selectedDayToken) {
      return serviceQualifiedInstructors;
    }

    return serviceQualifiedInstructors.filter((instructor) => {
      const capability = (instructor.service_capabilities || []).find((item) => String(item.service_id) === String(formData.service_id));
      return capability && getAvailabilityWindowsForDay(capability.availability_windows, selectedDayToken).length > 0;
    });
  }, [formData.service_id, selectedDayToken, serviceQualifiedInstructors]);

  const instructorOptions = useMemo(
    () => (useSchedulingOverride ? serviceQualifiedInstructors : dateAvailableInstructors),
    [dateAvailableInstructors, serviceQualifiedInstructors, useSchedulingOverride],
  );

  const availableTimeSlots = useMemo(() => {
    if (useSchedulingOverride || !selectedCapability || !selectedDayToken) {
      return [];
    }
    return buildAvailabilityTimeSlots({
      availabilityWindows: selectedCapability.availability_windows,
      day: selectedDayToken,
      durationMinutes: Number(formData.duration_minutes) || 0,
    });
  }, [formData.duration_minutes, selectedCapability, selectedDayToken, useSchedulingOverride]);

  const missingCapability = Boolean(formData.instructor_employee_id && formData.service_id && !selectedCapability);
  const missingAvailability = Boolean(selectedCapability && !hasConfiguredAvailability(selectedCapability.availability_windows));
  const hasAvailableSlots = availableTimeSlots.length > 0;

  useEffect(() => {
    if (useSchedulingOverride) {
      return;
    }

    if (formData.instructor_employee_id && !instructorOptions.some((instructor) => String(instructor.id) === String(formData.instructor_employee_id))) {
      setFormData((prev) => ({ ...prev, instructor_employee_id: '' }));
    }
  }, [formData.instructor_employee_id, instructorOptions, useSchedulingOverride]);

  useEffect(() => {
    if (useSchedulingOverride) {
      return;
    }

    if (!formData.service_id || !selectedDayToken || missingCapability || missingAvailability) {
      return;
    }

    if (hasAvailableSlots) {
      if (!availableTimeSlots.includes(formData.time)) {
        setFormData((prev) => ({ ...prev, time: availableTimeSlots[0] }));
      }
      return;
    }

    if (formData.time) {
      setFormData((prev) => ({ ...prev, time: '' }));
    }
  }, [
    availableTimeSlots,
    formData.service_id,
    formData.time,
    hasAvailableSlots,
    missingAvailability,
    missingCapability,
    selectedDayToken,
    useSchedulingOverride,
  ]);

  // When first student is selected, auto-populate service and instructor (only if valid)
  useEffect(() => {
    if (formData.student_ids.length === 0) {
      setStudentDetails(null);
      setFormData(prev => ({ ...prev, service_id: '' }));
      return;
    }

    const firstStudentId = formData.student_ids[0];
    const student = students.find(s => s.id === firstStudentId);

    if (student) {
      setStudentDetails(student);

      const serviceIds = new Set((services || []).map(svc => String(svc?.id || '')));
      const instructorIds = new Set((instructors || []).map(inst => String(inst?.id || '')));

      const nextServiceId = student.service_id && serviceIds.has(String(student.service_id))
        ? String(student.service_id)
        : '';
      const nextInstructorId = student.instructor_employee_id && instructorIds.has(String(student.instructor_employee_id))
        ? String(student.instructor_employee_id)
        : '';

      setFormData(prev => ({
        ...prev,
        service_id: nextServiceId || prev.service_id,
        instructor_employee_id: nextInstructorId || prev.instructor_employee_id,
      }));
    }
  }, [formData.student_ids, students, services, instructors]);

  // Check conflicts when form data changes
  const checkConflicts = useCallback(async () => {
    if (!activeOrgId) return;
    setIsCheckingConflicts(true);
    try {
      const datetime_start = toUtcIsoString(formData.date, formData.time);
      if (!datetime_start) {
        setConflicts([]);
        return;
      }
      const serviceIds = new Set(
        (services || [])
          .filter((svc) => svc?.is_active === true)
          .map((svc) => String(svc?.id || ''))
      );
      if (formData.service_id && !serviceIds.has(String(formData.service_id))) {
        setConflicts([]);
        return;
      }
      const data = await authenticatedFetch('calendar/conflicts/check', {
        method: 'POST',
        session,
        body: {
          org_id: activeOrgId,
          datetime_start,
          duration_minutes: formData.duration_minutes,
          instructor_employee_id: formData.instructor_employee_id,
          student_ids: formData.student_ids,
          service_id: formData.service_id,
        },
      });

      setConflicts(data?.conflicts || []);
    } catch (err) {
      console.error('Error checking conflicts:', err);
    } finally {
      setIsCheckingConflicts(false);
    }
  }, [formData, activeOrgId, session, services]);

  useEffect(() => {
    if (!formData.instructor_employee_id || !formData.date || !formData.time || formData.student_ids.length === 0) {
      setConflicts([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      await checkConflicts();
    }, 500); // Debounce

    return () => clearTimeout(timeoutId);
  }, [formData, activeOrgId, checkConflicts]);

  async function handleSubmit(e) {
    if (!activeOrgId) {
      setError('Organization not found');
      return;
    }
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const serviceIds = new Set(
        (services || [])
          .filter((svc) => svc?.is_active === true)
          .map((svc) => String(svc?.id || ''))
      );
      if (!formData.service_id || !serviceIds.has(String(formData.service_id))) {
        setError('יש לבחור שירות מהרשימה.');
        return;
      }
      if (!formData.instructor_employee_id) {
        setError('יש לבחור מדריך/ה.');
        return;
      }
      if (!useSchedulingOverride && missingCapability) {
        setError('למדריך/ה שנבחר/ה אין יכולת שירות פעילה עבור השירות הזה.');
        return;
      }
      if (!useSchedulingOverride && missingAvailability) {
        setError('לשירות הזה אין זמינות מוגדרת אצל המדריך/ה שנבחר/ה.');
        return;
      }
      if (!useSchedulingOverride && !hasAvailableSlots) {
        setError('לא נמצאה שעה זמינה ביום שנבחר עבור השירות והמדריך/ה.');
        return;
      }
      if (useSchedulingOverride && !overrideReason.trim()) {
        setError('יש למלא סיבת חריגה לפני יצירת שיעור חד-פעמי מחוץ לזמינות.');
        return;
      }
      const datetime_start = toUtcIsoString(formData.date, formData.time);
      if (!datetime_start) {
        setError('תאריך או שעה אינם תקינים.');
        return;
      }

      await authenticatedFetch('calendar/instances', {
        method: 'POST',
        session,
        body: {
          org_id: activeOrgId,
          datetime_start,
          duration_minutes: formData.duration_minutes,
          instructor_employee_id: formData.instructor_employee_id,
          service_id: formData.service_id,
          student_ids: formData.student_ids,
          created_source: 'one_time',
          metadata: useSchedulingOverride
            ? {
                scheduling_override: {
                  type: 'one_time_exception',
                  reason: overrideReason.trim(),
                  created_by_ui: true,
                },
              }
            : {},
        },
      });

      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('Error creating lesson:', err);
      const apiError = err?.message || '';
      setError(
        apiError === 'missing_instructor_service_capability'
          ? 'למדריך/ה שנבחר/ה אין יכולת שירות פעילה עבור השירות הזה.'
          : apiError === 'missing_instructor_service_availability'
            ? 'לשירות הזה אין זמינות מוגדרת אצל המדריך/ה שנבחר/ה.'
            : apiError === 'outside_instructor_service_availability'
              ? 'השעה שנבחרה נמצאת מחוץ לחלונות הזמינות שהוגדרו. כדי לשבץ חריג יש להפעיל שיבוץ חד-פעמי חריג ולציין סיבה.'
              : apiError === 'failed_to_validate_instructor_availability'
                ? 'לא הצלחנו לבדוק את זמינות המדריך/ה כרגע. אפשר לנסות שוב.'
                : err?.message || 'יצירת השיעור נכשלה.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const studentOptions = students.map(s => ({
    value: s.id,
    label: `${s.first_name || ''} ${s.middle_name || ''} ${s.last_name || ''}`.trim() || 'ללא שם',
    searchText: `${s.first_name || ''} ${s.middle_name || ''} ${s.last_name || ''} ${s.identity_number || ''}`.toLowerCase(),
  }));

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>שיעור חדש</DialogTitle>
          <DialogDescription className="sr-only">יצירת שיעור חדש עבור תלמידים נבחרים.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Student - FIRST FIELD */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor="students">תלמיד *</Label>
              {formData.student_ids.length > 0 && !isGroupSession && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsGroupSession(true)}
                  className="gap-1 ms-auto"
                >
                  <Users className="h-4 w-4" />
                  להוסיף תלמידים נוספים
                </Button>
              )}
            </div>
            {studentsLoading && (
              <div className="text-sm text-gray-500 mb-2 flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                טוען תלמידים...
              </div>
            )}
            {studentsError && !studentsLoading && (
              <div className="text-sm text-red-600 mb-2">
                {studentsError}
              </div>
            )}
            {!studentsLoading && !studentsError && studentOptions.length === 0 && (
              <div className="text-sm text-amber-600 mb-2">
                לא נמצאו תלמידים
              </div>
            )}
            
            {/* Primary student selection */}
            <ComboBoxField
              id="primary-student"
              name="primary-student"
              options={studentOptions}
              value={formData.student_ids[0] ? students.find(s => s.id === formData.student_ids[0])?.label || '' : ''}
              onChange={(value) => {
                const student = students.find(s => 
                  `${s.first_name || ''} ${s.middle_name || ''} ${s.last_name || ''}`.trim() === value.trim()
                );
                const newIds = student ? [student.id] : [];
                if (isGroupSession) {
                  // Keep existing secondary students
                  const otherIds = formData.student_ids.slice(1);
                  setFormData({ ...formData, student_ids: [...newIds, ...otherIds] });
                } else {
                  setFormData({ ...formData, student_ids: newIds });
                }
              }}
              placeholder={studentsLoading ? "טוען..." : "בחר תלמיד"}
              disabled={studentsLoading || studentOptions.length === 0}
              emptyMessage="לא נמצאו תלמידים"
            />

            {/* Additional students for group sessions */}
            {isGroupSession && (
              <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <Label>תלמידים נוספים</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsGroupSession(false)}
                  >
                    סגור
                  </Button>
                </div>
                <Select
                  value=""
                  onValueChange={(studentId) => {
                    if (!formData.student_ids.includes(studentId)) {
                      setFormData({ ...formData, student_ids: [...formData.student_ids, studentId] });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="הוסף תלמיד נוסף" />
                  </SelectTrigger>
                  <SelectContent>
                    {students
                      .filter(s => !formData.student_ids.includes(s.id))
                      .map((student) => (
                        <SelectItem key={student.id} value={student.id}>
                          {student.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>

                {/* List of added students */}
                {formData.student_ids.length > 1 && (
                  <div className="mt-3 space-y-2">
                    {formData.student_ids.slice(1).map((studentId) => {
                      const student = students.find(s => s.id === studentId);
                      return (
                        <div key={studentId} className="flex items-center justify-between p-2 bg-white rounded border">
                          <span>{student?.label}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setFormData({
                                ...formData,
                                student_ids: formData.student_ids.filter(id => id !== studentId)
                              });
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {!isGroupSession && formData.student_ids.length > 0 && studentDetails && (
              <div className="mt-2 p-2 bg-blue-50 rounded text-sm">
                <p className="font-medium">{studentDetails.first_name} {studentDetails.last_name}</p>
              </div>
            )}
          </div>

          {/* Service - AUTO-POPULATED */}
          <div>
            <Label htmlFor="service">שירות *</Label>
            {servicesError && (
              <div className="text-sm text-red-600 mb-2">{servicesError}</div>
            )}
            <Select
              value={formData.service_id}
              onValueChange={(value) => {
                const selectedService = activeServices.find((service) => String(service.id) === String(value));
                setFormData((prev) => ({
                  ...prev,
                  service_id: String(value),
                  duration_minutes: selectedService?.duration_minutes || prev.duration_minutes,
                }));
              }}
              disabled={servicesLoading || !formData.student_ids.length}
            >
              <SelectTrigger id="service">
                <SelectValue placeholder={formData.student_ids.length ? "בחר שירות" : "בחר תלמיד תחילה"} />
              </SelectTrigger>
              <SelectContent>
                {activeServices.map((service) => (
                  <SelectItem key={service.id} value={String(service.id)}>
                    {service.name || service.service_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">שיבוץ לפי זמינות</p>
                <p className="text-xs text-slate-600">
                  ברירת המחדל מציגה רק מדריכים ושעות זמינים לשירות ולתאריך שנבחרו.
                </p>
              </div>
              <Button
                type="button"
                variant={useSchedulingOverride ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setUseSchedulingOverride((prev) => !prev);
                  setError(null);
                }}
              >
                {useSchedulingOverride ? 'בטל שיבוץ חריג' : 'שיבוץ חד-פעמי חריג'}
              </Button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              שיבוץ חריג מיועד לחגים, שירות מיוחד או חלון זמני פנוי, ואינו משנה את הזמינות הקבועה של המדריך/ה.
            </p>
          </div>

          {/* Instructor - AUTO-POPULATED */}
          <div>
            <Label htmlFor="instructor">מדריך *</Label>
            {instructorsError && (
              <div className="text-sm text-red-600 mb-2">{instructorsError}</div>
            )}
            {!useSchedulingOverride && formData.service_id && selectedDayToken && instructorOptions.length === 0 ? (
              <div className="mb-2 text-sm text-amber-700">
                אין כרגע מדריכים זמינים עבור השירות והתאריך שנבחרו. אפשר לעבור לשיבוץ חד-פעמי חריג במקרה חריג.
              </div>
            ) : null}
            <Select
              value={formData.instructor_employee_id}
              onValueChange={(value) => setFormData({ ...formData, instructor_employee_id: String(value) })}
              disabled={instructorsLoading || instructorOptions.length === 0}
            >
              <SelectTrigger id="instructor">
                <SelectValue placeholder={useSchedulingOverride ? 'בחר מדריך/ה בעל/ת יכולת שירות' : 'בחר מדריך/ה זמין/ה'} />
              </SelectTrigger>
              <SelectContent>
                {instructorOptions.map((instructor) => (
                  <SelectItem key={instructor.id} value={String(instructor.id)}>
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

          {/* Duration */}
          <div>
            <Label htmlFor="duration">משך (דקות) *</Label>
            <Input
              id="duration"
              type="number"
              min="15"
              step="15"
              value={formData.duration_minutes}
              onChange={(e) => setFormData({ ...formData, duration_minutes: parseInt(e.target.value, 10) || 60 })}
              required
            />
          </div>

          {formData.instructor_employee_id && formData.service_id && !useSchedulingOverride && missingCapability ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>למדריך/ה שנבחר/ה אין יכולת שירות פעילה עבור השירות הזה.</AlertDescription>
            </Alert>
          ) : null}

          {formData.instructor_employee_id && formData.service_id && !useSchedulingOverride && missingAvailability ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>לשירות הזה עדיין לא הוגדרה זמינות אצל המדריך/ה שנבחר/ה.</AlertDescription>
            </Alert>
          ) : null}

          {!useSchedulingOverride ? (
            <div>
              <Label htmlFor="time">שעה *</Label>
              {!formData.instructor_employee_id || !formData.service_id || !selectedDayToken ? (
                <div className="mt-1 text-sm text-slate-500">בחרו מדריך/ה, שירות ותאריך כדי לראות את השעות הזמינות.</div>
              ) : !hasAvailableSlots ? (
                <div className="mt-1 text-sm text-amber-700">אין שעות פנויות התואמות את חלונות הזמינות עבור היום הזה.</div>
              ) : (
                <Select
                  value={formData.time || undefined}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, time: value }))}
                >
                  <SelectTrigger id="time">
                    <SelectValue placeholder="בחר שעה זמינה" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTimeSlots.map((time) => (
                      <SelectItem key={time} value={time}>
                        {formatTimeLabel(time)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : (
            <div className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50/70 p-4">
              <div>
                <Label htmlFor="time">שעה חריגה *</Label>
                <Input
                  id="time"
                  type="time"
                  value={formData.time}
                  onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="override-reason">סיבת החריגה *</Label>
                <Textarea
                  id="override-reason"
                  rows={3}
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  placeholder="למשל: חופשה, תגבור חד-פעמי, חלון זמני פנוי, שירות מיוחד"
                />
              </div>
            </div>
          )}

          {/* Conflicts Warning */}
          {isCheckingConflicts && (
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertDescription>בודק התנגשויות...</AlertDescription>
            </Alert>
          )}

          {conflicts.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="font-medium mb-2">נמצאו התנגשויות:</div>
                <ul className="list-disc list-inside space-y-1">
                  {conflicts.map((conflict, index) => (
                    <li key={index} className="text-sm">{conflict.message}</li>
                  ))}
                </ul>
                <div className="mt-2 text-sm">ניתן להמשיך ולשמור בכל זאת.</div>
              </AlertDescription>
            </Alert>
          )}

          {/* Error Message */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              ביטול
            </Button>
            <Button
              type="submit"
              disabled={
                isSubmitting
                || !formData.service_id
                || !formData.instructor_employee_id
                || !formData.date
                || !formData.time
                || formData.student_ids.length === 0
                || (useSchedulingOverride ? !overrideReason.trim() : (!hasAvailableSlots && !formData.time))
              }
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  שומר...
                </>
              ) : (
                'צור שיעור'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
