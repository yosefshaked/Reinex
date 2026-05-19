import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useMemo, useState, useEffect, useRef } from 'react';
import { useOrg } from '@/org/OrgContext';
import { useStudents } from '@/hooks/useOrgData';
import { useCalendarInstructors } from '../../hooks/useCalendar';
import { useTemplateMutations } from '../../hooks/useTemplates';
import { Loader2, AlertCircle, UserPlus, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useAuth } from '@/auth/AuthContext.jsx';
import { DAY_OPTIONS, normalizeDayToken } from '@/lib/day-of-week.js';
import { toast } from 'sonner';
import {
  buildAvailabilityTimeSlots,
  getAvailabilityDayTokens,
  hasConfiguredAvailability,
  isWithinAvailabilityWindows,
  timeToMinutes,
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

function rangeOverlap(startA, endA, startB, endB) {
  const aStart = startA || '0001-01-01';
  const aEnd = endA || '9999-12-31';
  const bStart = startB || '0001-01-01';
  const bEnd = endB || '9999-12-31';
  return aStart <= bEnd && bStart <= aEnd;
}

function timeRangesOverlap(startA, durationA, startB, durationB) {
  const startMinutesA = timeToMinutes(startA);
  const startMinutesB = timeToMinutes(startB);
  const safeDurationA = Number(durationA) || 0;
  const safeDurationB = Number(durationB) || 0;
  if (startMinutesA == null || startMinutesB == null || safeDurationA <= 0 || safeDurationB <= 0) {
    return false;
  }
  return startMinutesA < startMinutesB + safeDurationB && startMinutesB < startMinutesA + safeDurationA;
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
  templates = [],
}) {
  const { activeOrgId } = useOrg();
  const { session } = useAuth();
  const { instructors, isLoading: instructorsLoading } = useCalendarInstructors();
  const { createTemplate, isSubmitting } = useTemplateMutations();

  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [existingTemplatesByStudentId, setExistingTemplatesByStudentId] = useState({});
  const [existingTemplatesLoading, setExistingTemplatesLoading] = useState(false);

  const { students, loadingStudents: studentsLoading } = useStudents({
    status: waitingListEntryId ? 'all' : 'active',
    enabled: open && !!activeOrgId,
    orgId: activeOrgId,
  });
  const [waitingListProfile, setWaitingListProfile] = useState(null);

  // Multi-student state
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [isAddingStudent, setIsAddingStudent] = useState(false);
  const [addStudentQuery, setAddStudentQuery] = useState('');
  const addStudentInputRef = useRef(null);

  const [formData, setFormData] = useState({
    client_profile_id: defaultClientProfileId || '',
    instructor_employee_id: defaultInstructorId || '',
    service_id: defaultServiceId || '',
    day_of_week: normalizeDayToken(defaultDayOfWeek) || '',
    time_of_day: ceilClockTimeToGrid(defaultTimeOfDay) || '09:00',
    duration_minutes: Number(defaultDurationMinutes) || 60,
    valid_from: new Date().toISOString().split('T')[0],
    valid_until: '',
  });

  const [error, setError] = useState(null);
  const activeServices = useMemo(
    () => (services || []).filter((s) => s?.is_active === true),
    [services],
  );
  const selectedService = useMemo(
    () => activeServices.find((service) => String(service.id) === String(formData.service_id || '')) || null,
    [activeServices, formData.service_id],
  );
  const selectedServiceDurationMinutes = Number(selectedService?.duration_minutes) || 0;
  const selectedServiceHasValidDuration = selectedServiceDurationMinutes > 0;
  // For waiting-list client profile display
  const selectedClientProfile = selectedStudents[0] || (waitingListProfile?.id === formData.client_profile_id ? waitingListProfile : null);
  const selectedInstructor = (instructors || []).find((instructor) => instructor.id === formData.instructor_employee_id) || null;
  const selectedCapability = (selectedInstructor?.service_capabilities || []).find((capability) => capability.service_id === formData.service_id) || null;
  const availableDayTokens = getAvailabilityDayTokens(selectedCapability?.availability_windows || []);
  const availableTimeSlots = buildAvailabilityTimeSlots({
    availabilityWindows: selectedCapability?.availability_windows || [],
    day: formData.day_of_week,
    durationMinutes: selectedServiceDurationMinutes,
  });
  const missingCapability = Boolean(formData.instructor_employee_id && formData.service_id && !selectedCapability);
  const missingAvailability = Boolean(selectedCapability && !hasConfiguredAvailability(selectedCapability.availability_windows));
  const outsideAvailability = Boolean(
    selectedCapability
    && hasConfiguredAvailability(selectedCapability.availability_windows)
    && formData.day_of_week
    && formData.time_of_day
    && selectedServiceDurationMinutes > 0
    && !isWithinAvailabilityWindows({
      availabilityWindows: selectedCapability.availability_windows,
      day: formData.day_of_week,
      startTime: formData.time_of_day,
      durationMinutes: selectedServiceDurationMinutes,
    }),
  );
  const occupiedTemplate = useMemo(() => {
    if (
      !formData.instructor_employee_id
      || !formData.day_of_week
      || !formData.time_of_day
      || !formData.valid_from
      || !selectedServiceHasValidDuration
    ) {
      return null;
    }

    return (templates || []).find((template) => (
      template?.is_active !== false
      && String(template?.instructor_employee_id || '') === String(formData.instructor_employee_id)
      && normalizeDayToken(template?.day_of_week) === normalizeDayToken(formData.day_of_week)
      && rangeOverlap(template?.valid_from, template?.valid_until, formData.valid_from, formData.valid_until || null)
      && timeRangesOverlap(template?.time_of_day, template?.duration_minutes, formData.time_of_day, selectedServiceDurationMinutes)
    )) || null;
  }, [
    formData.day_of_week,
    formData.instructor_employee_id,
    formData.time_of_day,
    formData.valid_from,
    formData.valid_until,
    selectedServiceDurationMinutes,
    selectedServiceHasValidDuration,
    templates,
  ]);

  useEffect(() => {
    if (!selectedService?.id || !selectedServiceHasValidDuration) {
      return;
    }

    setFormData((prev) => (
      Number(prev.duration_minutes) === selectedServiceDurationMinutes
        ? prev
        : { ...prev, duration_minutes: selectedServiceDurationMinutes }
    ));
  }, [selectedService?.id, selectedServiceDurationMinutes, selectedServiceHasValidDuration]);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedStudents([]);
      setIsAddingStudent(false);
      setAddStudentQuery('');
      setFormData({
        client_profile_id: defaultClientProfileId || '',
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

  // Once students load, pre-populate defaultStudentId
  useEffect(() => {
    if (!open || !defaultStudentId || !students.length || selectedStudents.length > 0) return;
    const match = students.find((s) => s.id === defaultStudentId);
    if (match) {
      setSelectedStudents([match]);
    }
  }, [open, defaultStudentId, students, selectedStudents.length]);

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

  // Auto-fill service/instructor from first selected student's defaults
  const firstStudentId = selectedStudents[0]?.id;
  useEffect(() => {
    if (!firstStudentId) return;
    const student = students.find((s) => s.id === firstStudentId);
    if (!student) return;

    const serviceIds = new Set((services || []).map((s) => String(s?.id || '')));
    const instructorIds = new Set((instructors || []).map((i) => String(i?.id || '')));

    setFormData((prev) => ({
      ...prev,
      service_id:
        !prev.service_id && student.service_id && serviceIds.has(String(student.service_id))
          ? String(student.service_id)
          : prev.service_id,
      instructor_employee_id:
        !prev.instructor_employee_id && student.instructor_employee_id && instructorIds.has(String(student.instructor_employee_id))
          ? String(student.instructor_employee_id)
          : prev.instructor_employee_id,
    }));
  }, [firstStudentId, students, services, instructors]);

  // Warn when any selected student already has active templates
  const selectedStudentIds = selectedStudents.map((s) => s.id).join(',');
  useEffect(() => {
    if (!open || !activeOrgId || !selectedStudents.length) {
      setExistingTemplatesByStudentId({});
      setExistingTemplatesLoading(false);
      return;
    }

    let isMounted = true;
    setExistingTemplatesLoading(true);

    async function fetchAll() {
      const results = {};
      await Promise.all(
        selectedStudents.map(async (student) => {
          try {
            const payload = await authenticatedFetch('lesson-templates', {
              session,
              params: { org_id: activeOrgId, student_id: student.id },
            });
            results[student.id] = Array.isArray(payload) ? payload : [];
          } catch {
            results[student.id] = [];
          }
        }),
      );
      if (isMounted) {
        setExistingTemplatesByStudentId(results);
        setExistingTemplatesLoading(false);
      }
    }

    fetchAll();
    return () => { isMounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeOrgId, selectedStudentIds, session]);

  // Filtered student options for the inline search
  const selectedStudentIdSet = useMemo(
    () => new Set(selectedStudents.map((s) => s.id)),
    [selectedStudents],
  );
  const addStudentResults = useMemo(() => {
    const query = addStudentQuery.trim().toLowerCase();
    return (students || [])
      .filter((s) => !selectedStudentIdSet.has(s.id))
      .filter((s) => {
        if (!query) return true;
        return `${s.first_name || ''} ${s.middle_name || ''} ${s.last_name || ''} ${s.identity_number || ''}`.toLowerCase().includes(query);
      })
      .slice(0, 12);
  }, [students, selectedStudentIdSet, addStudentQuery]);

  function handleAddStudent(student) {
    setSelectedStudents((prev) => [...prev, student]);
    setAddStudentQuery('');
    setIsAddingStudent(false);
  }

  function handleRemoveStudent(studentId) {
    setSelectedStudents((prev) => prev.filter((s) => s.id !== studentId));
    setExistingTemplatesByStudentId((prev) => {
      const next = { ...prev };
      delete next[studentId];
      return next;
    });
  }

  // Aggregate active existing templates across all selected students
  const activeExistingTemplatesByStudentId = useMemo(() => {
    const result = {};
    for (const [sid, tpls] of Object.entries(existingTemplatesByStudentId)) {
      const active = (tpls || []).filter((t) => t.is_active);
      if (active.length > 0) result[sid] = active;
    }
    return result;
  }, [existingTemplatesByStudentId]);
  const hasExistingTemplatesWarning = Object.keys(activeExistingTemplatesByStudentId).length > 0;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const hasStudents = selectedStudents.length > 0;
    const hasClientProfile = Boolean(formData.client_profile_id && !hasStudents);

    if (!hasStudents && !hasClientProfile) {
      setError('יש לבחור לפחות תלמיד/ה אחד/ת');
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
    if (!selectedServiceHasValidDuration) {
      setError('לשירות שנבחר אין משך תקין. יש לעדכן את משך השירות לפני יצירת תבנית.');
      return;
    }
    if (formData.day_of_week === '' || formData.day_of_week === null) {
      setError('יש לבחור יום');
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

    if (occupiedTemplate) {
      setError('למדריך/ה כבר קיימת תבנית שחופפת ליום ולשעה האלה. בחרו חלון פנוי אחר או ערכו את התבנית הקיימת.');
      return;
    }

    const { data: createdTemplate, error: apiError } = await createTemplate({
      client_profile_id: formData.client_profile_id || null,
      student_ids: hasStudents ? selectedStudents.map((s) => s.id) : undefined,
      instructor_employee_id: formData.instructor_employee_id,
      service_id: formData.service_id,
      day_of_week: formData.day_of_week,
      time_of_day: formData.time_of_day,
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
          : apiError === 'invalid_service_duration'
            ? 'לשירות שנבחר אין משך תקין. יש לעדכן את משך השירות לפני יצירת תבנית.'
          : apiError === 'instructor_template_time_conflict'
            ? 'למדריך/ה כבר קיימת תבנית שחופפת לשעה הזאת. בחרו חלון פנוי אחר או ערכו את התבנית הקיימת.'
          : apiError === 'template_group_capacity_exceeded'
            ? 'למדריך/ה כבר קיימת תבנית שחופפת לשעה הזאת. בחרו חלון פנוי אחר או ערכו את התבנית הקיימת.'
          : apiError === 'student_template_conflict'
            ? 'אחד/ת מהתלמידים כבר משובץ/ת בתבנית אחרת באותו יום ושעה.'
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
                {selectedStudents.length > 0
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
                      studentId: selectedStudents[0]?.id || '',
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

          {occupiedTemplate ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                למדריך/ה כבר קיימת תבנית שחופפת ליום ולשעה האלה:
                {' '}
                {dayLabel(occupiedTemplate.day_of_week)}
                {' '}
                {formatTemplateTime(occupiedTemplate.time_of_day)}
                {' · '}
                {occupiedTemplate.service?.name || 'שירות'}
                . בחרו חלון פנוי אחר או ערכו את התבנית הקיימת.
              </AlertDescription>
            </Alert>
          ) : null}

          {/* Student / Client */}
          {formData.client_profile_id && selectedStudents.length === 0 ? (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <Label className="mb-2 block">לקוח/ה להמרה</Label>
              <div className="text-sm font-medium">{personName(selectedClientProfile)}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                יצירת תבנית קבועה תהפוך את רשומת הלקוח/ה לתלמיד/ה כחלק מהאישור.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>תלמידים *</Label>

              {/* Selected students list */}
              {selectedStudents.length > 0 && (
                <div className="space-y-1">
                  {selectedStudents.map((student) => (
                    <div
                      key={student.id}
                      className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
                    >
                      <span className="font-medium">{personName(student)}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveStudent(student.id)}
                        className="ms-2 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={`הסר ${personName(student)}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Existing templates warning */}
              {existingTemplatesLoading ? (
                <div className="text-sm text-gray-500 flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  בודק תבניות קיימות...
                </div>
              ) : hasExistingTemplatesWarning ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                  <p className="text-sm font-medium text-amber-900">
                    לחלק מהתלמידים שנבחרו כבר קיימות תבניות פעילות.
                  </p>
                  <p className="text-xs text-amber-800 mt-1">
                    ניתן להמשיך וליצור תבנית נוספת, אבל חשוב לוודא שאין כפילויות לא רצויות.
                  </p>
                  <div className="mt-2 space-y-2 max-h-40 overflow-y-auto pe-1">
                    {Object.entries(activeExistingTemplatesByStudentId).map(([sid, tpls]) => {
                      const student = selectedStudents.find((s) => s.id === sid);
                      return (
                        <div key={sid}>
                          <p className="text-xs font-semibold text-amber-900 mb-1">{personName(student)}:</p>
                          {tpls.map((template) => (
                            <div key={template.id} className="text-xs bg-white/70 border border-amber-200 rounded px-2 py-1 mb-1">
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
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Add student inline search */}
              {isAddingStudent ? (
                <div className="relative">
                  <Input
                    ref={addStudentInputRef}
                    autoFocus
                    placeholder="חפש תלמיד לפי שם..."
                    value={addStudentQuery}
                    onChange={(e) => setAddStudentQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setIsAddingStudent(false);
                        setAddStudentQuery('');
                      }
                    }}
                  />
                  {studentsLoading ? (
                    <div className="mt-1 rounded-md border border-border bg-background shadow-md p-3 text-sm text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      טוען תלמידים...
                    </div>
                  ) : addStudentResults.length > 0 ? (
                    <div className="mt-1 rounded-md border border-border bg-background shadow-md max-h-48 overflow-y-auto">
                      {addStudentResults.map((student) => (
                        <button
                          key={student.id}
                          type="button"
                          className="w-full text-start px-3 py-2 text-sm hover:bg-muted transition-colors border-b border-border last:border-0"
                          onClick={() => handleAddStudent(student)}
                        >
                          <span className="font-medium">{personName(student)}</span>
                          {student.identity_number ? (
                            <span className="text-muted-foreground"> • {student.identity_number}</span>
                          ) : null}
                          {student.is_active === false ? (
                            <span className="text-muted-foreground"> • לא פעיל/ה</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : addStudentQuery.trim() ? (
                    <div className="mt-1 rounded-md border border-border bg-background shadow-md p-3 text-sm text-muted-foreground">
                      לא נמצאו תלמידים
                    </div>
                  ) : null}
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAddingStudent(true)}
                  className="gap-1.5"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  הוסף תלמיד
                </Button>
              )}
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
                  setFormData((prev) => ({
                    ...prev,
                    service_id: value,
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
              <div
                id="template-duration"
                className="flex min-h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700"
              >
                {selectedService
                  ? (selectedServiceHasValidDuration ? `${selectedServiceDurationMinutes} דקות` : 'לשירות אין משך תקין')
                  : 'המשך ייקבע לפי השירות'}
              </div>
              {selectedService && !selectedServiceHasValidDuration ? (
                <p className="mt-1 text-sm text-red-600">יש לעדכן את משך השירות לפני יצירת תבנית.</p>
              ) : null}
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
              disabled={
                isSubmitting
                || !formData.day_of_week
                || !formData.time_of_day
                || !selectedServiceHasValidDuration
                || availableTimeSlots.length === 0
                || missingCapability
                || missingAvailability
                || outsideAvailability
              }
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
