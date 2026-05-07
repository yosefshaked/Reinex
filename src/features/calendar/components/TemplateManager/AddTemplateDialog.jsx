import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useState, useEffect } from 'react';
import { useOrg } from '@/org/OrgContext';
import { useStudents } from '@/hooks/useOrgData';
import { useCalendarInstructors } from '../../hooks/useCalendar';
import { useTemplateMutations } from '../../hooks/useTemplates';
import { Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ComboBoxField } from '@/components/ui/forms-ui';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useAuth } from '@/auth/AuthContext.jsx';
import { DAY_OPTIONS, normalizeDayToken } from '@/lib/day-of-week.js';
import { toast } from 'sonner';
import {
  buildAvailabilityTimeSlots,
  getAvailabilityDayTokens,
  hasConfiguredAvailability,
  isWithinAvailabilityWindows,
} from '@/lib/instructor-availability.js';
import { ceilClockTimeToGrid } from '@/lib/time-grid.js';

function formatTemplateTime(timeString) {
  if (!timeString) return '—';
  const [hours = '00', minutes = '00'] = String(timeString).split(':');
  return `${hours}:${minutes}`;
}

function dayLabel(day) {
  const normalized = normalizeDayToken(day);
  return DAY_OPTIONS.find((entry) => entry.value === normalized)?.label || '—';
}

function personName(person) {
  if (!person) return '—';
  return [person.first_name, person.middle_name, person.last_name].filter(Boolean).join(' ') || '—';
}

function normalizeTemplateTimeForCompare(timeString) {
  if (!timeString) return '';
  const [hours = '00', minutes = '00'] = String(timeString).split(':');
  return `${hours}:${minutes}`;
}

function rangeOverlap(startA, endA, startB, endB) {
  const aStart = startA || '0001-01-01';
  const aEnd = endA || '9999-12-31';
  const bStart = startB || '0001-01-01';
  const bEnd = endB || '9999-12-31';
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * AddTemplateDialog — Create a new lesson template
 */
export function AddTemplateDialog({
  open,
  onClose,
  onSuccess,
  defaultInstructorId,
  defaultDayOfWeek,
  defaultClientProfileId = '',
  defaultStudentId = '',
  defaultServiceId = '',
  defaultTimeOfDay = '09:00',
  defaultDurationMinutes = 60,
  waitingListEntryId = '',
  waitingListContext = null,
  onFixAvailability,
}) {
  const { activeOrgId } = useOrg();
  const { session } = useAuth();
  const { instructors, isLoading: instructorsLoading } = useCalendarInstructors();
  const { createTemplate, isSubmitting } = useTemplateMutations();

  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [existingTemplates, setExistingTemplates] = useState([]);
  const [existingTemplatesLoading, setExistingTemplatesLoading] = useState(false);

  const { students, loadingStudents: studentsLoading } = useStudents({
    status: waitingListEntryId ? 'all' : 'active',
    enabled: open && !!activeOrgId,
    orgId: activeOrgId,
  });
  const [waitingListProfile, setWaitingListProfile] = useState(null);

  const [studentLabel, setStudentLabel] = useState('');
  const [formData, setFormData] = useState({
    client_profile_id: defaultClientProfileId || '',
    student_id: defaultStudentId || '',
    instructor_employee_id: defaultInstructorId || '',
    service_id: defaultServiceId || '',
    day_of_week: normalizeDayToken(defaultDayOfWeek) || '',
    time_of_day: ceilClockTimeToGrid(defaultTimeOfDay) || '09:00',
    duration_minutes: Number(defaultDurationMinutes) || 60,
    valid_from: new Date().toISOString().split('T')[0],
    valid_until: '',
  });

  const [error, setError] = useState(null);
  const selectedStudent = students.find((student) => student.id === formData.student_id) || null;
  const selectedClientProfile = selectedStudent || (waitingListProfile?.id === formData.client_profile_id ? waitingListProfile : null);
  const selectedInstructor = (instructors || []).find((instructor) => instructor.id === formData.instructor_employee_id) || null;
  const selectedCapability = (selectedInstructor?.service_capabilities || []).find((capability) => capability.service_id === formData.service_id) || null;
  const availableDayTokens = getAvailabilityDayTokens(selectedCapability?.availability_windows || []);
  const availableTimeSlots = buildAvailabilityTimeSlots({
    availabilityWindows: selectedCapability?.availability_windows || [],
    day: formData.day_of_week,
    durationMinutes: Number(formData.duration_minutes) || 0,
  });
  const missingCapability = Boolean(formData.instructor_employee_id && formData.service_id && !selectedCapability);
  const missingAvailability = Boolean(selectedCapability && !hasConfiguredAvailability(selectedCapability.availability_windows));
  const outsideAvailability = Boolean(
    selectedCapability
    && hasConfiguredAvailability(selectedCapability.availability_windows)
    && formData.day_of_week
    && formData.time_of_day
    && Number(formData.duration_minutes) > 0
    && !isWithinAvailabilityWindows({
      availabilityWindows: selectedCapability.availability_windows,
      day: formData.day_of_week,
      startTime: formData.time_of_day,
      durationMinutes: Number(formData.duration_minutes),
    }),
  );

  useEffect(() => {
    if (!selectedCapability || availableDayTokens.length === 0) {
      return;
    }

    if (!availableDayTokens.includes(formData.day_of_week)) {
      setFormData((prev) => ({
        ...prev,
        day_of_week: availableDayTokens[0],
      }));
    }
  }, [availableDayTokens, formData.day_of_week, selectedCapability]);

  useEffect(() => {
    if (!selectedCapability || !formData.day_of_week) {
      return;
    }

    if (availableTimeSlots.length === 0) {
      if (formData.time_of_day) {
        setFormData((prev) => ({ ...prev, time_of_day: '' }));
      }
      return;
    }

    if (!availableTimeSlots.includes(formData.time_of_day)) {
      setFormData((prev) => ({ ...prev, time_of_day: availableTimeSlots[0] }));
    }
  }, [availableTimeSlots, formData.day_of_week, formData.time_of_day, selectedCapability]);

  // Reset form when dialog opens with defaults
  useEffect(() => {
    if (open) {
      setStudentLabel('');
      setFormData({
        client_profile_id: defaultClientProfileId || '',
        student_id: defaultStudentId || '',
        instructor_employee_id: defaultInstructorId || '',
        service_id: defaultServiceId || '',
        day_of_week: normalizeDayToken(defaultDayOfWeek) || '',
        time_of_day: ceilClockTimeToGrid(defaultTimeOfDay) || '09:00',
        duration_minutes: Number(defaultDurationMinutes) || 60,
        valid_from: new Date().toISOString().split('T')[0],
        valid_until: '',
      });
      setError(null);
    }
  }, [open, defaultInstructorId, defaultDayOfWeek, defaultClientProfileId, defaultStudentId, defaultServiceId, defaultTimeOfDay, defaultDurationMinutes]);

  useEffect(() => {
    if (!open || !activeOrgId || !session || !defaultClientProfileId || defaultStudentId) {
      setWaitingListProfile(null);
      return;
    }

    let cancelled = false;
    async function fetchWaitingListProfile() {
      try {
        const payload = await authenticatedFetch(`client-profiles/${defaultClientProfileId}`, {
          session,
          params: { org_id: activeOrgId },
        });
        if (!cancelled) {
          setWaitingListProfile(payload || null);
        }
      } catch {
        if (!cancelled) {
          setWaitingListProfile(null);
        }
      }
    }

    void fetchWaitingListProfile();
    return () => {
      cancelled = true;
    };
  }, [open, activeOrgId, session, defaultClientProfileId, defaultStudentId]);

  // Fetch services
  useEffect(() => {
    if (!open || !activeOrgId || !session) return;
    let isMounted = true;

    async function fetchServices() {
      setServicesLoading(true);
      try {
        const payload = await authenticatedFetch('services', {
          session,
          params: { org_id: activeOrgId },
        });
        if (isMounted) setServices(Array.isArray(payload) ? payload : []);
      } catch {
        if (isMounted) setServices([]);
      } finally {
        if (isMounted) setServicesLoading(false);
      }
    }

    fetchServices();
    return () => { isMounted = false; };
  }, [open, activeOrgId, session]);

  // Auto-fill service/instructor from student defaults
  useEffect(() => {
    if (!formData.student_id) return;
    const student = students.find((s) => s.id === formData.student_id);
    if (!student) return;

    const serviceIds = new Set((services || []).map((s) => String(s?.id || '')));
    const instructorIds = new Set((instructors || []).map((i) => String(i?.id || '')));

    setFormData((prev) => ({
      ...prev,
      service_id:
        student.service_id && serviceIds.has(String(student.service_id))
          ? String(student.service_id)
          : prev.service_id,
      instructor_employee_id:
        !prev.instructor_employee_id && student.instructor_employee_id && instructorIds.has(String(student.instructor_employee_id))
          ? String(student.instructor_employee_id)
          : prev.instructor_employee_id,
    }));
  }, [formData.student_id, students, services, instructors]);

  // Warn when selected student already has templates
  useEffect(() => {
    if (!open || !activeOrgId || !formData.student_id) {
      setExistingTemplates([]);
      setExistingTemplatesLoading(false);
      return;
    }

    let isMounted = true;

    async function fetchExistingTemplates() {
      setExistingTemplatesLoading(true);
      try {
        const payload = await authenticatedFetch('lesson-templates', {
          session,
          params: {
            org_id: activeOrgId,
            student_id: formData.student_id,
          },
        });

        if (isMounted) {
          setExistingTemplates(Array.isArray(payload) ? payload : []);
        }
      } catch {
        if (isMounted) {
          setExistingTemplates([]);
        }
      } finally {
        if (isMounted) {
          setExistingTemplatesLoading(false);
        }
      }
    }

    fetchExistingTemplates();

    return () => {
      isMounted = false;
    };
  }, [open, activeOrgId, formData.student_id, session]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!formData.student_id && !formData.client_profile_id) {
      setError('יש לבחור תלמיד/ה או רשומת לקוח/ה להמרה');
      return;
    }
    if (!formData.instructor_employee_id) {
      setError('יש לבחור מדריך');
      return;
    }
    if (!formData.service_id) {
      setError('יש לבחור שירות');
      return;
    }
    if (formData.day_of_week === '' || formData.day_of_week === null) {
      setError('יש לבחור יום');
      return;
    }

    const localConflict = activeExistingTemplates.find((template) => {
      if (template.student_id !== formData.student_id) return false;
      if (template.instructor_employee_id !== formData.instructor_employee_id) return false;
      if (normalizeDayToken(template.day_of_week) !== normalizeDayToken(formData.day_of_week)) return false;
      if (normalizeTemplateTimeForCompare(template.time_of_day) !== normalizeTemplateTimeForCompare(formData.time_of_day)) return false;
      return rangeOverlap(template.valid_from, template.valid_until, formData.valid_from, formData.valid_until || null);
    });

    if (localConflict) {
      setError('קיימת כבר תבנית פעילה זהה (תלמיד+מדריך+יום+שעה) בטווח תאריכים חופף.');
      return;
    }

    if (missingCapability) {
      setError('לא הוגדרה יכולת שירות מתאימה למדריך/ה עבור השירות שנבחר.');
      return;
    }

    if (missingAvailability) {
      setError('לא הוגדרה זמינות לשירות הזה אצל המדריך/ה שנבחר/ה.');
      return;
    }

    if (outsideAvailability) {
      setError('השיבוץ שנבחר נמצא מחוץ לחלונות הזמינות שהוגדרו עבור השירות הזה.');
      return;
    }

    const { data: createdTemplate, error: apiError } = await createTemplate({
      client_profile_id: formData.client_profile_id || null,
      student_id: formData.student_id,
      instructor_employee_id: formData.instructor_employee_id,
      service_id: formData.service_id,
      day_of_week: formData.day_of_week,
      time_of_day: formData.time_of_day,
      duration_minutes: Number(formData.duration_minutes),
      valid_from: formData.valid_from,
      valid_until: formData.valid_until || null,
      waiting_list_entry_id: waitingListEntryId || null,
    });

    if (apiError) {
      setError(
        apiError === 'duplicate_template_conflict'
          ? 'לא ניתן ליצור תבנית זהה וחופפת (תלמיד+מדריך+יום+שעה) כאשר כבר קיימת תבנית פעילה.'
          : apiError === 'waiting_list_entry_not_found'
            ? 'רשומת ההמתנה כבר אינה זמינה. אפשר לחזור לרשימת ההמתנה ולרענן את הנתונים.'
          : apiError === 'waiting_list_entry_not_open'
            ? 'רשומת ההמתנה כבר אינה פתוחה לשיבוץ.'
          : apiError === 'waiting_list_student_mismatch' || apiError === 'waiting_list_service_mismatch'
            ? 'נתוני השיבוץ אינם תואמים עוד לרשומת ההמתנה. אפשר לחזור לרשימת ההמתנה ולבחור שוב.'
          : apiError === 'missing_instructor_service_capability'
            ? 'למדריך/ה שנבחר/ה אין יכולת שירות פעילה לשירות הזה.'
          : apiError === 'missing_instructor_service_availability'
            ? 'לשירות הזה עדיין לא הוגדרה זמינות אצל המדריך/ה שנבחר/ה.'
          : apiError === 'outside_instructor_service_availability'
            ? 'השיבוץ שנבחר נמצא מחוץ לחלונות הזמינות שהוגדרו עבור השירות הזה.'
          : apiError === 'failed_to_activate_student_from_waiting_list'
            ? 'התבנית לא נשמרה כי לא הצלחנו להפעיל את התלמיד/ה מתוך רשומת ההמתנה. אפשר לנסות שוב.'
          : apiError === 'failed_to_link_waiting_list_entry'
            ? 'התבנית לא נשמרה כי לא הצלחנו לעדכן את רשומת ההמתנה. אפשר לנסות שוב.'
          : apiError === 'failed_to_finalize_waiting_list_match'
            ? 'השיבוץ לא הושלם עד הסוף. לא פרסמנו את התבנית ורצוי לנסות שוב.'
          : apiError,
      );
      return;
    }

    if (createdTemplate?.waiting_list_match?.student_created) {
      toast.success('התבנית נשמרה ונוצר כרטיס תלמיד/ה מתוך רשומת הלקוח/ה.');
    } else if (waitingListEntryId) {
      toast.success('התבנית נשמרה ורשומת ההמתנה עודכנה לשיבוץ.');
    } else {
      toast.success('התבנית נשמרה בהצלחה.');
    }

    onSuccess?.();
    onClose();
  }

  const studentOptions = (students || []).map((s) => ({
    value: s.id,
    label: `${`${s.first_name || ''} ${s.middle_name || ''} ${s.last_name || ''}`.trim() || 'ללא שם'}${s.identity_number ? ` • ${s.identity_number}` : ''}${s.is_active === false ? ' • לא פעיל/ה' : ''}`,
    searchText: `${s.first_name || ''} ${s.middle_name || ''} ${s.last_name || ''} ${s.identity_number || ''}`.toLowerCase(),
  }));

  useEffect(() => {
    if (!open || !formData.student_id || studentLabel) return;
    const match = studentOptions.find((option) => option.value === formData.student_id);
    if (match?.label) {
      setStudentLabel(match.label);
    }
  }, [open, formData.student_id, studentLabel, studentOptions]);

  const activeExistingTemplates = existingTemplates.filter((template) => template.is_active);
  const activeServices = (services || []).filter((s) => s?.is_active === true);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>תבנית חדשה</DialogTitle>
          <DialogDescription className="sr-only">יצירת תבנית שיעור שבועית קבועה.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {waitingListContext ? (
            <Alert>
              <AlertDescription>
                השדות מולאו מתוך רשומת ההמתנה של {waitingListContext.studentName || 'המתעניין/ת'}
                {waitingListContext.serviceName ? ` עבור השירות ${waitingListContext.serviceName}` : ''}.
              </AlertDescription>
            </Alert>
          ) : null}

          {waitingListEntryId && selectedClientProfile ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {formData.student_id
                  ? 'שמירת התבנית תעדכן את רשומת ההמתנה לשיבוץ. אפשר עדיין לשנות את פרטי התבנית לפני השמירה.'
                  : 'שמירת התבנית תיצור כרטיס תלמיד/ה מתוך רשומת הלקוח/ה ותעדכן את רשומת ההמתנה לשיבוץ.'}
              </AlertDescription>
            </Alert>
          ) : null}

          {(missingCapability || missingAvailability || outsideAvailability) && formData.instructor_employee_id && formData.service_id ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="space-y-3">
                <div>
                  {missingCapability
                    ? 'למדריך/ה שנבחר/ה אין יכולת שירות מוגדרת עבור השירות הזה.'
                    : missingAvailability
                      ? 'לשירות הזה עדיין לא הוגדרה זמינות אצל המדריך/ה שנבחר/ה.'
                      : 'יום/שעת התבנית נמצאים מחוץ לחלונות הזמינות שהוגדרו עבור השירות הזה.'}
                </div>
                {typeof onFixAvailability === 'function' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onFixAvailability({
                      instructorId: formData.instructor_employee_id,
                      serviceId: formData.service_id,
                      clientProfileId: formData.client_profile_id,
                      studentId: formData.student_id,
                      waitingListEntryId,
                      waitingListContext,
                      fixType: missingCapability
                        ? 'missing_service_capability'
                        : missingAvailability
                          ? 'missing_instructor_service_availability'
                          : 'outside_instructor_service_availability',
                      source: 'add',
                    })}
                  >
                    תקן זמינות
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {/* Student / Client */}
          {formData.client_profile_id && !formData.student_id ? (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <Label className="mb-2 block">לקוח/ה להמרה</Label>
              <div className="text-sm font-medium">{personName(selectedClientProfile)}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                יצירת תבנית קבועה תהפוך את רשומת הלקוח/ה לתלמיד/ה כחלק מהאישור.
              </div>
            </div>
          ) : (
            <div>
              <Label htmlFor="template-student">תלמיד *</Label>
              {studentsLoading ? (
                <div className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  טוען תלמידים...
                </div>
              ) : (
                <ComboBoxField
                  id="template-student"
                  options={studentOptions}
                  value={studentLabel}
                  onChange={(value) => {
                    setStudentLabel(value);
                    const exactMatches = studentOptions.filter((opt) => opt.label === value);
                    setFormData((prev) => ({
                      ...prev,
                      student_id: exactMatches.length === 1 ? exactMatches[0].value : '',
                    }));
                  }}
                  onOptionSelect={(option) => {
                    setStudentLabel(option?.label || '');
                    setFormData((prev) => ({
                      ...prev,
                      student_id: option?.value || '',
                    }));
                  }}
                  allowCustomValue={false}
                  placeholder="חפש תלמיד..."
                  emptyMessage="לא נמצאו תלמידים"
                />
              )}
            </div>
          )}

          {formData.student_id && (
            <div className="space-y-2">
              {existingTemplatesLoading ? (
                <div className="text-sm text-gray-500 flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  בודק תבניות קיימות...
                </div>
              ) : activeExistingTemplates.length > 0 ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                  <p className="text-sm font-medium text-amber-900">
                    לתלמיד זה כבר קיימות {activeExistingTemplates.length} תבניות פעילות.
                  </p>
                  <p className="text-xs text-amber-800 mt-1">
                    ניתן להמשיך וליצור תבנית נוספת, אבל חשוב לוודא שאין כפילויות לא רצויות.
                  </p>
                  <div className="mt-2 space-y-1.5 max-h-36 overflow-y-auto pe-1">
                    {activeExistingTemplates.map((template) => (
                      <div key={template.id} className="text-xs bg-white/70 border border-amber-200 rounded px-2 py-1">
                        <span className="font-medium">{dayLabel(template.day_of_week)}</span>
                        <span> • </span>
                        <span>{formatTemplateTime(template.time_of_day)}</span>
                        <span> • </span>
                        <span>{template.duration_minutes} דק׳</span>
                        <span> • </span>
                        <span>{template.service?.name || 'ללא שירות'}</span>
                        <span> • </span>
                        <span>{personName(template.instructor)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Instructor */}
          <div>
            <Label htmlFor="template-instructor">מדריך *</Label>
            {instructorsLoading ? (
              <div className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                <Loader2 className="h-3 w-3 animate-spin" />
              </div>
            ) : (
              <Select
                value={formData.instructor_employee_id}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, instructor_employee_id: value }))}
              >
                <SelectTrigger id="template-instructor">
                  <SelectValue placeholder="בחר מדריך" />
                </SelectTrigger>
                <SelectContent>
                  {(instructors || []).map((inst) => (
                    <SelectItem key={inst.id} value={inst.id}>
                      {[inst.first_name, inst.middle_name, inst.last_name].filter(Boolean).join(' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Service */}
          <div>
            <Label htmlFor="template-service">שירות *</Label>
            {servicesLoading ? (
              <div className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                <Loader2 className="h-3 w-3 animate-spin" />
              </div>
            ) : (
              <Select
                value={formData.service_id}
                onValueChange={(value) => {
                  const svc = activeServices.find((s) => s.id === value);
                  setFormData((prev) => ({
                    ...prev,
                    service_id: value,
                    duration_minutes: svc?.duration_minutes || prev.duration_minutes,
                  }));
                }}
              >
                <SelectTrigger id="template-service">
                  <SelectValue placeholder="בחר שירות" />
                </SelectTrigger>
                <SelectContent>
                  {activeServices.map((svc) => (
                    <SelectItem key={svc.id} value={svc.id}>
                      {svc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Day of week */}
          <div>
            <Label htmlFor="template-day">יום בשבוע *</Label>
            <Select
              value={formData.day_of_week ? String(formData.day_of_week) : undefined}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, day_of_week: value }))}
            >
              <SelectTrigger id="template-day">
                <SelectValue placeholder="בחר יום" />
              </SelectTrigger>
              <SelectContent>
                {DAY_OPTIONS.map((day) => (
                  <SelectItem
                    key={day.value}
                    value={day.value}
                    disabled={selectedCapability ? !availableDayTokens.includes(day.value) : false}
                  >
                    {day.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCapability && availableDayTokens.length === 0 ? (
              <p className="mt-1 text-sm text-amber-700">לשירות הזה עדיין לא הוגדרו ימים זמינים.</p>
            ) : null}
          </div>

          {/* Time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="template-time">שעה *</Label>
              <Select
                value={formData.time_of_day || undefined}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, time_of_day: value }))}
                disabled={!selectedCapability || !formData.day_of_week || availableTimeSlots.length === 0}
              >
                <SelectTrigger id="template-time">
                  <SelectValue placeholder="בחר שעה זמינה" />
                </SelectTrigger>
                <SelectContent>
                  {availableTimeSlots.map((time) => (
                    <SelectItem key={time} value={time}>
                      {formatTemplateTime(time)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCapability && formData.day_of_week && availableTimeSlots.length === 0 ? (
                <p className="mt-1 text-sm text-amber-700">אין שעות זמינות עבור היום והמשך שנבחרו.</p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="template-duration">משך (דקות) *</Label>
              <Input
                id="template-duration"
                type="number"
                min={15}
                max={480}
                step={15}
                value={formData.duration_minutes}
                onChange={(e) => setFormData((prev) => ({ ...prev, duration_minutes: Number(e.target.value) || 60 }))}
                required
              />
            </div>
          </div>

          {/* Validity range */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="template-valid-from">תוקף מ- *</Label>
              <Input
                id="template-valid-from"
                type="date"
                value={formData.valid_from}
                onChange={(e) => setFormData((prev) => ({ ...prev, valid_from: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label htmlFor="template-valid-until">תוקף עד (אופציונלי)</Label>
              <Input
                id="template-valid-until"
                type="date"
                value={formData.valid_until}
                onChange={(e) => setFormData((prev) => ({ ...prev, valid_until: e.target.value }))}
              />
            </div>
          </div>

          {/* Error */}
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
              disabled={isSubmitting || !formData.day_of_week || !formData.time_of_day || availableTimeSlots.length === 0}
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin ms-2" />}
              צור תבנית
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
