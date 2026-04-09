import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useOrg } from '@/org/OrgContext';
import { useStudents, useClientProfiles } from '@/hooks/useOrgData';
import { useCalendarInstructors } from '../hooks/useCalendar';
import { Loader2, AlertCircle, Users, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ComboBoxField } from '@/components/ui/forms-ui';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useAuth } from '@/auth/AuthContext.jsx';
import CreateClientProfileDialog from '@/features/clients/components/CreateClientProfileDialog.jsx';
import { dayTokenForJsDay } from '@/lib/day-of-week.js';
import {
  buildAvailabilityTimeSlots,
  getAvailabilityWindowsForDay,
  hasConfiguredAvailability,
  isWithinAvailabilityWindows,
} from '@/lib/instructor-availability.js';
import {
  buildSchedulingOverrideReasonDetails,
  hasValidSchedulingOverrideReason,
  SCHEDULING_OVERRIDE_REASON_OPTIONS,
} from '../utils/schedulingOverride.js';
import { parseLocalDateString } from '../utils/localDate.js';
import { toAgorot } from '@/lib/currency.js';

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

function buildPersonFullName(person, fallback = 'ללא שם') {
  const fullName = [
    person?.first_name,
    person?.middle_name,
    person?.last_name,
  ]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');

  return fullName || fallback;
}

function buildParticipantToken(kind, id) {
  return `${kind}:${id}`;
}

function parseParticipantToken(token) {
  const [kind, id] = String(token || '').split(':');
  if (!id) return null;
  if (kind !== 'student' && kind !== 'client') return null;
  return { kind, id };
}

function extractCreatedClientProfile(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (payload.id) {
    return payload;
  }

  if (payload.client_profile && typeof payload.client_profile === 'object' && payload.client_profile.id) {
    return {
      ...payload.client_profile,
      ...(payload.student_id ? { student_id: payload.student_id } : {}),
    };
  }

  return null;
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
    client_profile_ids: [],
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
  const { clientProfiles, loadingClientProfiles, refetchClientProfiles } = useClientProfiles({
    status: 'non_student',
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
  const [selectedOverrideReasonCode, setSelectedOverrideReasonCode] = useState('');
  const [customOverrideReason, setCustomOverrideReason] = useState('');
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [createdClientProfiles, setCreatedClientProfiles] = useState([]);
  const [directClientChargeAmount, setDirectClientChargeAmount] = useState('');

  const participantTokens = useMemo(() => ([
    ...(formData.student_ids || []).map((id) => `student:${id}`),
    ...(formData.client_profile_ids || []).map((id) => `client:${id}`),
  ]), [formData.client_profile_ids, formData.student_ids]);

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
    setSelectedOverrideReasonCode('');
    setCustomOverrideReason('');
    setCreatedClientProfiles([]);
    setDirectClientChargeAmount('');
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
  const selectedService = useMemo(
    () => activeServices.find((service) => String(service.id) === String(formData.service_id || '')) || null,
    [activeServices, formData.service_id],
  );
  const selectedDayToken = useMemo(() => getDayTokenForLocalDate(formData.date), [formData.date]);
  const selectedInstructor = useMemo(
    () => (instructors || []).find((instructor) => String(instructor.id) === String(formData.instructor_employee_id || '')) || null,
    [formData.instructor_employee_id, instructors],
  );
  const studentRegularInstructor = useMemo(
    () => (instructors || []).find((instructor) => String(instructor.id) === String(studentDetails?.instructor_employee_id || '')) || null,
    [instructors, studentDetails?.instructor_employee_id],
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
    () => {
      const baseOptions = useSchedulingOverride ? serviceQualifiedInstructors : dateAvailableInstructors;
      if (!formData.instructor_employee_id) {
        return baseOptions;
      }

      const hasSelectedInstructor = baseOptions.some(
        (instructor) => String(instructor.id) === String(formData.instructor_employee_id),
      );
      if (hasSelectedInstructor) {
        return baseOptions;
      }

      const selectedInstructorOption = serviceQualifiedInstructors.find(
        (instructor) => String(instructor.id) === String(formData.instructor_employee_id),
      );
      if (!selectedInstructorOption) {
        return baseOptions;
      }

      return [...baseOptions, selectedInstructorOption];
    },
    [dateAvailableInstructors, formData.instructor_employee_id, serviceQualifiedInstructors, useSchedulingOverride],
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
  const selectedTimeOutsideAvailability = useMemo(() => {
    if (
      useSchedulingOverride
      || !selectedCapability
      || !selectedDayToken
      || !formData.time
      || missingCapability
      || missingAvailability
    ) {
      return false;
    }

    return !isWithinAvailabilityWindows({
      availabilityWindows: selectedCapability.availability_windows,
      day: selectedDayToken,
      startTime: formData.time,
      durationMinutes: Number(formData.duration_minutes) || 0,
    });
  }, [
    formData.duration_minutes,
    formData.time,
    missingAvailability,
    missingCapability,
    selectedCapability,
    selectedDayToken,
    useSchedulingOverride,
  ]);
  const showSchedulingOverrideCta = Boolean(
    formData.instructor_employee_id
    && formData.service_id
    && formData.time
    && !useSchedulingOverride
    && selectedTimeOutsideAvailability,
  );
  const hasDirectClientParticipants = formData.client_profile_ids.length > 0;
  const requiresDirectClientChargeAmount = Boolean(
    hasDirectClientParticipants
    && selectedService
    && (selectedService.default_customer_charge_amount == null || selectedService.default_customer_charge_amount === '')
  );
  const hasValidDirectClientChargeAmount = directClientChargeAmount !== ''
    && Number.isFinite(Number(directClientChargeAmount))
    && Number(directClientChargeAmount) >= 0;
  const showsRegularInstructorNotice = Boolean(
    formData.student_ids.length === 1
    && formData.client_profile_ids.length === 0
    && studentRegularInstructor?.id
    && formData.instructor_employee_id
    && String(studentRegularInstructor.id) !== String(formData.instructor_employee_id),
  );
  const displayedTimeOptions = useMemo(() => {
    if (!formData.time || availableTimeSlots.includes(formData.time)) {
      return availableTimeSlots.map((time) => ({
        value: time,
        label: formatTimeLabel(time),
      }));
    }

    return [
      {
        value: formData.time,
        label: `${formatTimeLabel(formData.time)} · נבחר מחוץ לזמינות`,
      },
      ...availableTimeSlots.map((time) => ({
        value: time,
        label: formatTimeLabel(time),
      })),
    ];
  }, [availableTimeSlots, formData.time]);

  useEffect(() => {
    const serviceDuration = Number(selectedService?.duration_minutes) || 0;
    if (!selectedService?.id || serviceDuration <= 0) {
      return;
    }

    setFormData((prev) => (
      String(prev.service_id || '') === String(selectedService.id)
      && Number(prev.duration_minutes) !== serviceDuration
        ? { ...prev, duration_minutes: serviceDuration }
        : prev
    ));
  }, [selectedService]);

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
      if (!formData.time) {
        setFormData((prev) => ({ ...prev, time: availableTimeSlots[0] }));
      }
      return;
    }

    if (!formData.time) {
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

  const participantOptions = useMemo(() => {
    const studentOptions = (students || []).map((student) => ({
      value: buildParticipantToken('student', student.id),
      kind: 'student',
      id: student.id,
      label: buildPersonFullName(student),
      searchText: `${buildPersonFullName(student, '')} ${student.identity_number || ''}`.toLowerCase(),
      raw: student,
    }));

    const uniqueClientProfiles = [
      ...(clientProfiles || []),
      ...createdClientProfiles.filter((createdProfile) => !(clientProfiles || []).some((profile) => profile.id === createdProfile.id)),
    ];

    const clientOptions = uniqueClientProfiles.map((profile) => ({
      value: buildParticipantToken('client', profile.id),
      kind: 'client',
      id: profile.id,
      label: buildPersonFullName(profile),
      searchText: `${buildPersonFullName(profile, '')} ${profile.identity_number || ''}`.toLowerCase(),
      raw: profile,
    }));

    return [...studentOptions, ...clientOptions];
  }, [clientProfiles, createdClientProfiles, students]);
  const participantOptionByToken = useMemo(
    () => new Map(participantOptions.map((option) => [option.value, option])),
    [participantOptions],
  );

  const firstParticipant = useMemo(() => {
    const [firstToken] = participantTokens;
    if (!firstToken) return null;
    const parsed = parseParticipantToken(firstToken);
    if (!parsed) return null;
    if (parsed.kind === 'student') {
      return students.find((student) => student.id === parsed.id) || null;
    }
    return clientProfiles.find((profile) => profile.id === parsed.id)
      || createdClientProfiles.find((profile) => profile.id === parsed.id)
      || null;
  }, [clientProfiles, createdClientProfiles, participantTokens, students]);

  // When first student is selected, auto-populate service and only fill instructor if the form does not already have one.
  useEffect(() => {
    if (!requiresDirectClientChargeAmount) {
      setDirectClientChargeAmount('');
    }
  }, [requiresDirectClientChargeAmount]);

  useEffect(() => {
    if (participantTokens.length === 0) {
      setStudentDetails(null);
      setFormData(prev => ({ ...prev, service_id: '' }));
      return;
    }

    const parsed = parseParticipantToken(participantTokens[0]);
    if (!parsed || parsed.kind !== 'student') {
      setStudentDetails(null);
      return;
    }

    const student = students.find(s => s.id === parsed.id);

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
        instructor_employee_id: prev.instructor_employee_id || nextInstructorId || '',
      }));
    }
  }, [participantTokens, students, services, instructors]);

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
          client_profile_ids: formData.client_profile_ids,
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
    if (!formData.instructor_employee_id || !formData.date || !formData.time || participantTokens.length === 0) {
      setConflicts([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      await checkConflicts();
    }, 500); // Debounce

    return () => clearTimeout(timeoutId);
  }, [formData, activeOrgId, checkConflicts, participantTokens.length]);

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
      if (useSchedulingOverride && !hasValidSchedulingOverrideReason(selectedOverrideReasonCode, customOverrideReason)) {
        setError('יש למלא סיבת חריגה לפני יצירת שיעור חד-פעמי מחוץ לזמינות.');
        return;
      }
      if (requiresDirectClientChargeAmount && !hasValidDirectClientChargeAmount) {
        setError('יש להזין מחיר לשיעור הזה לפני יצירת לקוח/ה חד-פעמי/ת ללא מחיר שירות ברירת מחדל.');
        return;
      }
      const datetime_start = toUtcIsoString(formData.date, formData.time);
      if (!datetime_start) {
        setError('תאריך או שעה אינם תקינים.');
        return;
      }
      const overrideReasonDetails = buildSchedulingOverrideReasonDetails(selectedOverrideReasonCode, customOverrideReason);

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
          client_profile_ids: formData.client_profile_ids,
          ...(requiresDirectClientChargeAmount
            ? { direct_client_charge_amount: toAgorot(directClientChargeAmount) }
            : {}),
          created_source: 'one_time',
          metadata: useSchedulingOverride
            ? {
                scheduling_override: {
                  type: 'one_time_exception',
                  reason: overrideReasonDetails.reason,
                  reason_code: overrideReasonDetails.reasonCode,
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
              : apiError === 'missing_direct_client_charge_amount'
                ? 'לשירות הזה אין מחיר ברירת מחדל ללקוח/ה חד-פעמי/ת, ולכן צריך להזין מחיר עבור השיעור הזה.'
                : apiError === 'invalid_direct_client_charge_amount'
                  ? 'המחיר שנבחר לשיעור אינו תקין.'
              : apiError === 'failed_to_validate_instructor_availability'
                ? 'לא הצלחנו לבדוק את זמינות המדריך/ה כרגע. אפשר לנסות שוב.'
                : err?.message || 'יצירת השיעור נכשלה.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>שיעור חדש</DialogTitle>
          <DialogDescription className="sr-only">יצירת שיעור חדש עבור תלמידים נבחרים.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">משתתפים</p>
                <p className="text-xs text-slate-500">בחרו לקוח/ה ראשי/ת, ובמידת הצורך הוסיפו משתתפים נוספים.</p>
              </div>
              <div className="ms-auto flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCreateClientOpen(true)}
                >
                  לקוח/ה חדש/ה
                </Button>
                {participantTokens.length > 0 && !isGroupSession ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsGroupSession(true)}
                    className="gap-1"
                  >
                    <Users className="h-4 w-4" />
                    להוסיף משתתפים נוספים
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="students">לקוח/ה *</Label>
              {studentsLoading || loadingClientProfiles ? (
                <div className="text-sm text-gray-500 mb-2 flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  טוען לקוחות...
                </div>
              ) : null}
              {studentsError && !studentsLoading ? (
                <div className="text-sm text-red-600 mb-2">
                  {studentsError}
                </div>
              ) : null}
              {!studentsLoading && !loadingClientProfiles && !studentsError && participantOptions.length === 0 ? (
                <div className="text-sm text-amber-600 mb-2">
                  לא נמצאו לקוחות
                </div>
              ) : null}

              <ComboBoxField
                key={participantTokens[0] || 'no-primary-participant'}
                id="primary-student"
                name="primary-student"
                options={participantOptions}
                value={participantOptionByToken.get(participantTokens[0])?.label || ''}
                onChange={(value) => {
                  const participant = participantOptions.find((option) => option.label.trim() === value.trim());
                  const nextState = { student_ids: [], client_profile_ids: [] };
                  if (participant?.kind === 'student') {
                    nextState.student_ids = [participant.id];
                  } else if (participant?.kind === 'client') {
                    nextState.client_profile_ids = [participant.id];
                  }
                  if (isGroupSession) {
                    setFormData({
                      ...formData,
                      student_ids: [...nextState.student_ids, ...formData.student_ids.slice(1)],
                      client_profile_ids: [...nextState.client_profile_ids, ...formData.client_profile_ids.slice(1)],
                    });
                  } else {
                    setFormData({ ...formData, ...nextState });
                  }
                }}
                onOptionSelect={(participant) => {
                  const resolvedParticipant = participant?.raw || participant;
                  const nextState = { student_ids: [], client_profile_ids: [] };
                  if (resolvedParticipant?.kind === 'student') {
                    nextState.student_ids = [resolvedParticipant.id];
                  } else if (resolvedParticipant?.kind === 'client') {
                    nextState.client_profile_ids = [resolvedParticipant.id];
                  }
                  if (isGroupSession) {
                    setFormData((prev) => ({
                      ...prev,
                      student_ids: [...nextState.student_ids, ...prev.student_ids.slice(1)],
                      client_profile_ids: [...nextState.client_profile_ids, ...prev.client_profile_ids.slice(1)],
                    }));
                  } else {
                    setFormData((prev) => ({ ...prev, ...nextState }));
                  }
                }}
                placeholder={studentsLoading || loadingClientProfiles ? "טוען..." : "בחר לקוח/ה"}
                disabled={studentsLoading || loadingClientProfiles || participantOptions.length === 0}
                emptyMessage="לא נמצאו לקוחות"
              />
            </div>

            {isGroupSession ? (
              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <Label>משתתפים נוספים</Label>
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
                  onValueChange={(token) => {
                    const parsed = parseParticipantToken(token);
                    if (!parsed || participantTokens.includes(token)) {
                      return;
                    }
                    setFormData((prev) => ({
                      ...prev,
                      student_ids: parsed.kind === 'student' ? [...prev.student_ids, parsed.id] : prev.student_ids,
                      client_profile_ids: parsed.kind === 'client' ? [...prev.client_profile_ids, parsed.id] : prev.client_profile_ids,
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="הוסף משתתף/ת" />
                  </SelectTrigger>
                  <SelectContent>
                    {participantOptions
                      .filter((option) => !participantTokens.includes(option.value))
                      .map((participant) => (
                        <SelectItem key={participant.value} value={participant.value}>
                          {participant.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>

                {participantTokens.length > 1 ? (
                  <div className="mt-3 space-y-2">
                    {participantTokens.slice(1).map((token) => {
                      const option = participantOptionByToken.get(token);
                      const parsed = parseParticipantToken(token);
                      return (
                        <div key={token} className="flex items-center justify-between rounded border bg-white p-2">
                          <span>{option?.label}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (!parsed) return;
                              setFormData((prev) => ({
                                ...prev,
                                student_ids: parsed.kind === 'student' ? prev.student_ids.filter((id) => id !== parsed.id) : prev.student_ids,
                                client_profile_ids: parsed.kind === 'client' ? prev.client_profile_ids.filter((id) => id !== parsed.id) : prev.client_profile_ids,
                              }));
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            {!isGroupSession && participantTokens.length > 0 && firstParticipant ? (
              <div className="mt-3 rounded-xl bg-blue-50 p-2 text-sm">
                <p className="font-medium">{participantOptionByToken.get(participantTokens[0])?.label || buildPersonFullName(firstParticipant)}</p>
              </div>
            ) : null}

            {showsRegularInstructorNotice ? (
              <Alert className="mt-3 border-blue-200 bg-blue-50 text-blue-950">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="space-y-3">
                  <div>
                    לתלמיד/ה משויך/ת בדרך כלל <strong>{studentRegularInstructor.full_name}</strong>, אבל השעה שבחרתם בלוח משויכת כרגע ל-<strong>{selectedInstructor?.full_name || 'מדריך/ה אחר/ת'}</strong>.
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setFormData((prev) => ({
                        ...prev,
                        instructor_employee_id: String(studentRegularInstructor.id),
                      }))}
                    >
                      החלף למדריך/ה הרגיל/ה
                    </Button>
                    <div className="flex items-center text-xs text-blue-800">
                      אפשר גם להמשיך עם המדריך/ה שנבחר/ה מהלוח.
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4">
              <p className="text-sm font-semibold text-slate-900">פרטי שיבוץ</p>
              <p className="text-xs text-slate-500">הגדירו את השירות, התאריך ופרטי המפגש. לאחר מכן יוצגו המדריכים והשעות הרלוונטיים.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="service">שירות *</Label>
                {servicesError ? (
                  <div className="text-sm text-red-600">{servicesError}</div>
                ) : null}
                <Select
                  value={formData.service_id || ''}
                  onValueChange={(value) => {
                    const nextSelectedService = activeServices.find((service) => String(service.id) === String(value));
                    setFormData((prev) => ({
                      ...prev,
                      service_id: String(value),
                      duration_minutes: Number(nextSelectedService?.duration_minutes) || prev.duration_minutes,
                    }));
                  }}
                  disabled={servicesLoading || participantTokens.length === 0}
                >
                  <SelectTrigger id="service">
                    <SelectValue placeholder={participantTokens.length ? "בחר שירות" : "בחר לקוח/ה תחילה"} />
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

              <div className="space-y-2">
                <Label htmlFor="date">תאריך *</Label>
                <Input
                  id="date"
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="instructor">מדריך *</Label>
                {instructorsError ? (
                  <div className="text-sm text-red-600">{instructorsError}</div>
                ) : null}
                {!useSchedulingOverride && formData.service_id && selectedDayToken && instructorOptions.length === 0 ? (
                  <div className="text-sm text-amber-700">
                    אין כרגע מדריכים זמינים עבור השירות והתאריך שנבחרו.
                  </div>
                ) : null}
                <Select
                  value={formData.instructor_employee_id || ''}
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

              <div className="space-y-2">
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

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="time">שעה *</Label>
                {!formData.instructor_employee_id || !formData.service_id || !selectedDayToken ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                    בחרו שירות, תאריך ומדריך/ה כדי לראות את השעות הזמינות.
                  </div>
                ) : !useSchedulingOverride && !hasAvailableSlots ? (
                  <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    אין שעות פנויות התואמות את חלונות הזמינות עבור היום הזה.
                  </div>
                ) : !useSchedulingOverride ? (
                  <Select
                    value={formData.time || ''}
                    onValueChange={(value) => setFormData((prev) => ({ ...prev, time: value }))}
                  >
                    <SelectTrigger id="time">
                      <SelectValue placeholder="בחר שעה" />
                    </SelectTrigger>
                    <SelectContent>
                      {displayedTimeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="time"
                    type="time"
                    value={formData.time}
                    onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                    required
                  />
                )}
              </div>
            </div>
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

          {formData.instructor_employee_id && formData.service_id && !useSchedulingOverride && selectedTimeOutsideAvailability ? (
            <Alert className="border-amber-300 bg-amber-50 text-amber-950">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                השעה שנבחרה נמצאת מחוץ לזמינות המוגדרת של המדריך/ה עבור השירות הזה. אפשר לעבור ל״שיבוץ חד-פעמי חריג״ כדי להמשיך עם סיבת חריגה.
              </AlertDescription>
            </Alert>
          ) : null}

          {requiresDirectClientChargeAmount ? (
            <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-blue-950">מחיר לשיעור זה</p>
                <p className="text-xs text-blue-800">
                  לשירות הזה אין מחיר ברירת מחדל ללקוח/ה חד-פעמי/ת. כדי לאפשר תמחור גמיש, יש להזין כאן את המחיר עבור השיעור הספציפי.
                </p>
              </div>
              <div className="mt-3 max-w-xs space-y-2">
                <Label htmlFor="direct-client-charge-amount">מחיר לשיעור *</Label>
                <Input
                  id="direct-client-charge-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={directClientChargeAmount}
                  onChange={(event) => setDirectClientChargeAmount(event.target.value)}
                  placeholder="למשל 180"
                />
              </div>
            </div>
          ) : null}

          {(showSchedulingOverrideCta || useSchedulingOverride) ? (
            <div className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-amber-950">שיבוץ חד-פעמי חריג</p>
                  <p className="text-xs text-amber-800">
                    הפעילו את האפשרות הזו רק אם רוצים לקבוע שיעור מחוץ לחלונות הזמינות של המדריך/ה.
                  </p>
                </div>
                <Button
                  type="button"
                  variant={useSchedulingOverride ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setUseSchedulingOverride((prev) => !prev);
                    setSelectedOverrideReasonCode('');
                    setCustomOverrideReason('');
                    setError(null);
                  }}
                >
                  {useSchedulingOverride ? 'בטל שיבוץ חריג' : 'הפעל שיבוץ חד-פעמי חריג'}
                </Button>
              </div>
              {useSchedulingOverride ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="override-reason-code">סיבת החריגה *</Label>
                    <Select value={selectedOverrideReasonCode || ''} onValueChange={setSelectedOverrideReasonCode}>
                      <SelectTrigger id="override-reason-code">
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
                  </div>
                  {selectedOverrideReasonCode === 'custom' ? (
                    <div className="space-y-2">
                      <Label htmlFor="override-custom-reason">פירוט נוסף *</Label>
                      <Textarea
                        id="override-custom-reason"
                        rows={3}
                        value={customOverrideReason}
                        onChange={(event) => setCustomOverrideReason(event.target.value)}
                        placeholder="כתבו סיבה מותאמת אישית רק אם היא לא קיימת ברשימה."
                      />
                    </div>
                  ) : null}
                  <div>
                    <p className="text-xs text-amber-800">
                      בחרו את הסיבה הקרובה ביותר. השתמשו ב״אחר״ רק כשאין התאמה ברשימה.
                    </p>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

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
                || participantTokens.length === 0
                || (requiresDirectClientChargeAmount && !hasValidDirectClientChargeAmount)
                || (!useSchedulingOverride && selectedTimeOutsideAvailability)
                || (useSchedulingOverride
                  ? !hasValidSchedulingOverrideReason(selectedOverrideReasonCode, customOverrideReason)
                  : (!hasAvailableSlots && !formData.time))
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
      <CreateClientProfileDialog
        open={createClientOpen}
        onOpenChange={setCreateClientOpen}
        session={session}
        orgId={activeOrgId}
        createdFrom="calendar_add_lesson"
        title="יצירת לקוח/ה חד-פעמי/ת לשיעור"
        description="יוצרים כרטיס לקוח/ה חד-פעמי/ת ואז ממשיכים ישירות לשיבוץ השיעור שבחרתם."
        onSuccess={(payload) => {
          const profile = extractCreatedClientProfile(payload);
          setCreatedClientProfiles((prev) => (
            profile?.id && !prev.some((row) => row.id === profile.id)
              ? [...prev, profile]
              : prev
          ));
          void refetchClientProfiles();
          setIsGroupSession(false);
          setStudentDetails(null);
          setFormData((prev) => ({
            ...prev,
            student_ids: [],
            client_profile_ids: profile?.id ? [profile.id] : [],
          }));
          setCreateClientOpen(false);
        }}
      />
    </>
  );
}
