import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Pencil, Send, ExternalLink, Mail, MessageCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageLayout from '@/components/ui/PageLayout.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ComboBoxField, SelectField, TextAreaField, TextField } from '@/components/ui/forms-ui';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { normalizeMembershipRole, isAdminOrOffice, isAdminRole } from '@/features/students/utils/endpoints.js';
import AddStudentForm, { AddStudentFormFooter } from '@/features/admin/components/AddStudentForm.jsx';
import { toast } from 'sonner';

const DAYS_OF_WEEK = [
  { value: 0, label: 'ראשון', labelShort: 'א' },
  { value: 1, label: 'שני', labelShort: 'ב' },
  { value: 2, label: 'שלישי', labelShort: 'ג' },
  { value: 3, label: 'רביעי', labelShort: 'ד' },
  { value: 4, label: 'חמישי', labelShort: 'ה' },
  { value: 5, label: 'שישי', labelShort: 'ו' },
  { value: 6, label: 'שבת', labelShort: 'ש' },
];

const STATUS_OPTIONS = [
  { value: 'new', label: 'חדש' },
  { value: 'open', label: 'פתוח' },
  { value: 'matched', label: 'שובץ' },
  { value: 'closed', label: 'בוטל' },
];

const STATUS_FILTER_OPTIONS = [
  { value: 'active', label: 'חדשים ופתוחים' },
  { value: 'new', label: 'חדשים בלבד' },
  { value: 'open', label: 'פתוחים בלבד' },
  { value: 'matched', label: 'שובצו בלבד' },
  { value: 'closed', label: 'בוטלו בלבד' },
  { value: 'all', label: 'כולל שובצו/בוטלו' },
];

const STATUS_BADGE_VARIANTS = {
  new: 'default',
  open: 'secondary',
  matched: 'default',
  closed: 'outline',
};

const EMPTY_RANGE = { start: '', end: '' };
const FORM_USAGE_WAITING_LIST = 'waiting_list_intake';

function buildInitialInviteForm() {
  return {
    formId: '',
    studentFirstName: '',
    studentLastName: '',
    identityNumber: '',
    phone: '',
    email: '',
    deliveryMethod: 'whatsapp',
    serviceId: '',
    allowAdditionalServices: false,
    internalNote: '',
  };
}

function formatInviteExpiry(expiresAt) {
  if (!expiresAt) return '';
  try {
    return new Intl.DateTimeFormat('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jerusalem',
    }).format(new Date(expiresAt));
  } catch {
    return String(expiresAt);
  }
}

function buildInviteWhatsappMessage({ inviteUrl, expiresAt, serviceName, studentName }) {
  const formattedExpiry = formatInviteExpiry(expiresAt);
  return [
    `שלום${studentName ? ` ${studentName}` : ''},`,
    '',
    'שמחים שיצרתם קשר איתנו.',
    serviceName
      ? `כדי שנוכל לקדם את הבקשה להצטרפות לשירות ${serviceName}, נשמח שתמלאו את טופס ההצטרפות לרשימת ההמתנה בקישור הבא:`
      : 'כדי שנוכל לקדם את הבקשה להצטרפות לרשימת ההמתנה, נשמח שתמלאו את הטופס בקישור הבא:',
    inviteUrl,
    '',
    formattedExpiry ? `הקישור זמין עד ${formattedExpiry}.` : '',
    'אם יש שאלות, אפשר לחזור אלינו בהודעה חוזרת.',
  ].filter(Boolean).join('\n');
}

function buildStudentName(student) {
  if (!student) return '';
  const name = [student.first_name, student.middle_name, student.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  return name || 'ללא שם';
}

function buildStudentOption(student) {
  const name = buildStudentName(student);
  if (student?.identity_number) {
    return `${name} • ${student.identity_number}`;
  }
  return name;
}

function formatPreferredDays(days = []) {
  if (!Array.isArray(days) || days.length === 0) {
    return '—';
  }
  return days
    .map((day) => DAYS_OF_WEEK.find((entry) => entry.value === day)?.labelShort)
    .filter(Boolean)
    .join(', ');
}

function buildPreferredTimesMap(preferredTimes) {
  const map = {};
  if (!Array.isArray(preferredTimes)) {
    return map;
  }
  preferredTimes.forEach((entry) => {
    const day = Number(entry?.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      return;
    }
    const ranges = Array.isArray(entry?.ranges) ? entry.ranges : [];
    const normalizedRanges = ranges
      .map((range) => ({
        start: typeof range?.start === 'string' ? range.start : '',
        end: typeof range?.end === 'string' ? range.end : '',
      }))
      .filter((range) => range.start || range.end);
    if (normalizedRanges.length) {
      map[day] = normalizedRanges;
    }
  });
  return map;
}

function serializePreferredTimes(preferredTimesByDay) {
  if (!preferredTimesByDay || typeof preferredTimesByDay !== 'object') {
    return [];
  }

  return Object.entries(preferredTimesByDay)
    .map(([dayKey, ranges]) => {
      const day = Number(dayKey);
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        return null;
      }
      const normalizedRanges = Array.isArray(ranges)
        ? ranges
            .map((range) => ({
              start: typeof range?.start === 'string' ? range.start.trim() : '',
              end: typeof range?.end === 'string' ? range.end.trim() : '',
            }))
            .filter((range) => range.start && range.end)
        : [];
      if (!normalizedRanges.length) {
        return null;
      }
      return { day, ranges: normalizedRanges };
    })
    .filter(Boolean);
}

function formatPreferredTimes(preferredTimes = []) {
  if (!Array.isArray(preferredTimes) || preferredTimes.length === 0) {
    return '—';
  }
  return preferredTimes
    .map((entry) => {
      const dayLabel = DAYS_OF_WEEK.find((day) => day.value === entry.day)?.labelShort;
      if (!dayLabel || !Array.isArray(entry.ranges) || entry.ranges.length === 0) {
        return null;
      }
      const ranges = entry.ranges
        .map((range) => `${range.start}-${range.end}`)
        .filter(Boolean)
        .join(', ');
      return ranges ? `${dayLabel}: ${ranges}` : null;
    })
    .filter(Boolean)
    .join(' · ');
}

function buildInitialForm(entry, studentMap) {
  const studentOption = entry?.student_id && studentMap?.get(entry.student_id)
    ? studentMap.get(entry.student_id)
    : buildStudentOption(entry?.student);

  return {
    id: entry?.id || '',
    studentId: entry?.student_id || '',
    studentSearch: studentOption || '',
    serviceId: entry?.desired_service_id || '',
    preferredDays: Array.isArray(entry?.preferred_days) ? entry.preferred_days : [],
    preferredTimesByDay: buildPreferredTimesMap(entry?.preferred_times),
    priorityFlag: Boolean(entry?.priority_flag),
    notes: entry?.notes || '',
    status: entry?.status || 'open',
  };
}

export default function WaitingListPage() {
  const { activeOrg, activeOrgId, activeOrgHasConnection, tenantClientReady } = useOrg();
  const { session } = useSupabase();

  const membershipRole = normalizeMembershipRole(activeOrg?.membership?.role || null);
  const canManage = isAdminOrOffice(membershipRole);

  const [entries, setEntries] = useState([]);
  const [students, setStudents] = useState([]);
  const [services, setServices] = useState([]);
  const [waitingListForms, setWaitingListForms] = useState([]);
  const [loadingWaitingListForms, setLoadingWaitingListForms] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active');
  const [loading, setLoading] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [listError, setListError] = useState('');
  const [formError, setFormError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formValues, setFormValues] = useState(buildInitialForm());
  const [touched, setTouched] = useState({});
  const [timeEditorDay, setTimeEditorDay] = useState(null);
  const [timeEditorOpen, setTimeEditorOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteFormValues, setInviteFormValues] = useState(buildInitialInviteForm());
  const [inviteError, setInviteError] = useState('');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const [isAddStudentOpen, setIsAddStudentOpen] = useState(false);
  const [isCreatingStudent, setIsCreatingStudent] = useState(false);
  const [createError, setCreateError] = useState('');
  const [addSubmitDisabled, setAddSubmitDisabled] = useState(false);

  const openSelectCountRef = useRef(0);
  const isClosingSelectRef = useRef(false);

  const canFetch = Boolean(session && activeOrgId && tenantClientReady && activeOrgHasConnection && canManage);
  const canCreateStudent = isAdminRole(membershipRole);

  const studentOptionMap = useMemo(() => {
    const map = new Map();
    students.forEach((student) => {
      map.set(student.id, buildStudentOption(student));
    });
    return map;
  }, [students]);

  const studentLabelToId = useMemo(() => {
    const map = new Map();
    students.forEach((student) => {
      const label = buildStudentOption(student);
      map.set(label.toLowerCase(), student.id);
    });
    return map;
  }, [students]);

  const studentOptions = useMemo(() => students.map(buildStudentOption), [students]);

  const serviceOptions = useMemo(
    () => (services || []).map((service) => ({ value: service.id, label: service.name })),
    [services]
  );
  const waitingListFormOptions = useMemo(
    () => (waitingListForms || []).map((form) => ({ value: form.id, label: form.name })),
    [waitingListForms]
  );

  const loadWaitingListForms = useCallback(async () => {
    if (!canFetch) return;

    setLoadingWaitingListForms(true);
    try {
      const formsPayload = await authenticatedFetch('forms', {
        session,
        params: { org_id: activeOrgId, usage: FORM_USAGE_WAITING_LIST },
      });
      setWaitingListForms(Array.isArray(formsPayload) ? formsPayload : []);
    } catch (err) {
      setListError(err?.message || 'טעינת הנתונים נכשלה.');
    } finally {
      setLoadingWaitingListForms(false);
    }
  }, [canFetch, session, activeOrgId]);

  const loadReferenceData = useCallback(async () => {
    if (!canFetch) return;

    setLoadingMeta(true);
    setListError('');

    try {
      const [studentsPayload, servicesPayload] = await Promise.all([
        authenticatedFetch('students-list', {
          session,
          params: { org_id: activeOrgId, status: 'active' },
        }),
        authenticatedFetch('services', {
          session,
          params: { org_id: activeOrgId },
        }),
      ]);

      setStudents(Array.isArray(studentsPayload) ? studentsPayload : []);
      setServices(Array.isArray(servicesPayload) ? servicesPayload : []);
    } catch (err) {
      setListError(err?.message || 'טעינת הנתונים נכשלה.');
    } finally {
      setLoadingMeta(false);
    }
  }, [canFetch, session, activeOrgId]);

  const loadEntries = useCallback(async () => {
    if (!canFetch) return;

    setLoading(true);
    setListError('');

    try {
      const payload = await authenticatedFetch('waiting-list', {
        session,
        params: { org_id: activeOrgId, status: statusFilter },
      });
      setEntries(Array.isArray(payload) ? payload : []);
    } catch (err) {
      setEntries([]);
      setListError(err?.message || 'טעינת רשימת ההמתנה נכשלה.');
    } finally {
      setLoading(false);
    }
  }, [canFetch, session, activeOrgId, statusFilter]);

  useEffect(() => {
    void loadReferenceData();
  }, [loadReferenceData]);

  useEffect(() => {
    void loadWaitingListForms();
  }, [loadWaitingListForms]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const openCreateDialog = () => {
    setFormValues(buildInitialForm(null, studentOptionMap));
    setTouched({});
    setFormError('');
    setDialogOpen(true);
  };

  const openEditDialog = (entry) => {
    setFormValues(buildInitialForm(entry, studentOptionMap));
    setTouched({});
    setFormError('');
    setDialogOpen(true);
  };

  const handleStudentChange = (value) => {
    const normalized = String(value || '').trim();
    const matchId = studentLabelToId.get(normalized.toLowerCase()) || '';
    setFormValues((prev) => ({
      ...prev,
      studentSearch: normalized,
      studentId: matchId,
    }));
  };

  const handleServiceChange = (value) => {
    setFormValues((prev) => ({ ...prev, serviceId: value }));
  };

  const togglePreferredDay = (dayValue) => {
    setFormValues((prev) => {
      const isSelected = prev.preferredDays.includes(dayValue);
      const nextDays = isSelected
        ? prev.preferredDays.filter((day) => day !== dayValue)
        : [...prev.preferredDays, dayValue].sort((a, b) => a - b);
      const nextPreferredTimes = { ...prev.preferredTimesByDay };
      if (isSelected) {
        delete nextPreferredTimes[dayValue];
      }
      return { ...prev, preferredDays: nextDays, preferredTimesByDay: nextPreferredTimes };
    });

    const currentlySelected = formValues.preferredDays.includes(dayValue);
    if (!currentlySelected) {
      const ranges = formValues.preferredTimesByDay?.[dayValue] || [];
      if (ranges.length === 0) {
        setTimeEditorDay(dayValue);
        setTimeEditorOpen(true);
      }
    }
  };

  const openTimeEditor = (dayValue) => {
    setTimeEditorDay(dayValue);
    setTimeEditorOpen(true);
  };

  const closeTimeEditor = () => {
    setTimeEditorOpen(false);
    setTimeEditorDay(null);
  };

  const handleOpenAddStudentDialog = () => {
    setCreateError('');
    setIsAddStudentOpen(true);
  };

  const resetInviteComposer = useCallback(() => {
    const defaultFormId = waitingListForms.length === 1 ? waitingListForms[0].id : '';
    setInviteFormValues({
      ...buildInitialInviteForm(),
      formId: defaultFormId,
    });
    setInviteError('');
    setInviteResult(null);
  }, [waitingListForms]);

  const openInviteDialog = () => {
    resetInviteComposer();
    setInviteDialogOpen(true);
    if (!waitingListForms.length) {
      void loadWaitingListForms();
    }
  };

  useEffect(() => {
    if (!inviteDialogOpen) return;
    if (waitingListForms.length !== 1) return;
    setInviteFormValues((prev) => (
      prev.formId ? prev : { ...prev, formId: waitingListForms[0].id }
    ));
  }, [inviteDialogOpen, waitingListForms]);

  const handleInviteSubmit = async (event) => {
    event.preventDefault();

    if (!inviteFormValues.formId || !inviteFormValues.studentFirstName.trim() || !inviteFormValues.studentLastName.trim() || !inviteFormValues.identityNumber.trim() || !inviteFormValues.serviceId) {
      setInviteError('יש לבחור טופס, למלא שם פרטי, שם משפחה ומספר זהות של התלמיד/ה ולבחור שירות.');
      return;
    }

    if (inviteFormValues.deliveryMethod === 'whatsapp' && !inviteFormValues.phone.trim()) {
      setInviteError('יש להזין מספר טלפון לשליחת WhatsApp.');
      return;
    }

    if (inviteFormValues.deliveryMethod === 'email' && !inviteFormValues.email.trim()) {
      setInviteError('יש להזין כתובת אימייל לשליחה.');
      return;
    }

    setInviteSubmitting(true);
    setInviteError('');
    setInviteResult(null);

    try {
      const payload = await authenticatedFetch('waiting-list-intake/send', {
        method: 'POST',
        session,
        body: {
          org_id: activeOrgId,
          form_id: inviteFormValues.formId,
          student_first_name: inviteFormValues.studentFirstName,
          student_last_name: inviteFormValues.studentLastName,
          identity_number: inviteFormValues.identityNumber || null,
          phone: inviteFormValues.phone || null,
          email: inviteFormValues.email || null,
          delivery_method: inviteFormValues.deliveryMethod,
          desired_service_id: inviteFormValues.serviceId,
          allow_additional_services: inviteFormValues.allowAdditionalServices,
          internal_note: inviteFormValues.internalNote || null,
        },
      });

      setInviteResult(payload);
      if (payload?.delivery_status === 'email_failed') {
        toast.warning('שליחת האימייל נכשלה. אפשר להשתמש בקישור הידני.');
      } else if (inviteFormValues.deliveryMethod === 'email') {
        toast.success('קישור הטופס נשלח באימייל.');
      } else {
        toast.success('קישור הטופס מוכן לשליחה בוואטסאפ.');
      }
      await loadEntries();
    } catch (error) {
      setInviteError(error?.message || 'שליחת טופס ההמתנה נכשלה.');
    } finally {
      setInviteSubmitting(false);
    }
  };

  const handlePrepareAdditionalInvite = () => {
    resetInviteComposer();
  };

  const inviteWhatsappLink = useMemo(() => {
    if (!inviteResult?.invite_url || !inviteResult?.phone) return '';
    const digits = String(inviteResult.phone).replace(/[^\d]/g, '');
    const normalizedPhone = digits.startsWith('972')
      ? digits
      : digits.startsWith('0')
        ? `972${digits.slice(1)}`
        : digits;
    const serviceName = inviteResult?.desired_service?.name || '';
    const studentName = [inviteResult?.student_first_name, inviteResult?.student_last_name].filter(Boolean).join(' ').trim();
    const message = buildInviteWhatsappMessage({
      inviteUrl: inviteResult.invite_url,
      expiresAt: inviteResult?.expires_at,
      serviceName,
      studentName,
    });
    return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
  }, [inviteResult]);

  const handleAddStudentDialogOpenChange = (open) => {
    if (!open) {
      openSelectCountRef.current = 0;
      isClosingSelectRef.current = false;
      setIsAddStudentOpen(false);
      setCreateError('');
    } else {
      setIsAddStudentOpen(true);
    }
  };

  const handleAddStudentSubmit = async (formData) => {
    if (!session || !activeOrgId || !tenantClientReady || !activeOrgHasConnection) {
      setCreateError('חיבור לא זמין. ודא את החיבור וניסיון מחדש.');
      return;
    }

    setIsCreatingStudent(true);
    setCreateError('');

    const body = {
      org_id: activeOrgId,
      first_name: formData.firstName,
      middle_name: formData.middleName,
      last_name: formData.lastName,
      identity_number: formData.identityNumber,
      date_of_birth: formData.dateOfBirth,
      guardian_id: formData.guardianId,
      guardian_relationship: formData.guardianRelationship,
      phone: formData.phone,
      email: formData.email,
      medical_provider: formData.medicalProvider,
      default_notification_method: formData.notificationMethod,
      special_rate: formData.specialRate,
      medical_flags: formData.medicalFlags,
      onboarding_status: formData.onboardingStatus,
      notes_internal: formData.notesInternal,
      tags: formData.tags,
      is_active: formData.isActive,
    };

    try {
      const createdStudent = await authenticatedFetch('students-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        session,
      });
      toast.success('התלמיד נוסף בהצלחה');
      setStudents((prev) => {
        if (!createdStudent?.id) return prev;
        if (prev.some((student) => student.id === createdStudent.id)) return prev;
        return [createdStudent, ...prev];
      });
      if (createdStudent?.id) {
        setFormValues((prev) => ({
          ...prev,
          studentId: createdStudent.id,
          studentSearch: buildStudentOption(createdStudent),
        }));
      }
      setIsAddStudentOpen(false);
    } catch (error) {
      const apiMessage = error?.data?.message || error?.message;
      const apiCode = error?.data?.error || error?.data?.code || error?.code;
      let message = 'הוספת תלמיד נכשלה.';
      if (apiCode === 'identity_number_duplicate' || apiMessage === 'duplicate_identity_number') {
        message = 'תעודת זהות קיימת כבר במערכת.';
      } else if (apiMessage === 'missing national id') {
        message = 'יש להזין מספר זהות.';
      } else if (apiMessage === 'invalid national id') {
        message = 'מספר זהות לא תקין. יש להזין 5–12 ספרות.';
      } else if (apiCode === 'schema_upgrade_required') {
        message = 'נדרשת שדרוג לסכמת מסד הנתונים.';
      }
      setCreateError(message);
      toast.error(message);
    } finally {
      setIsCreatingStudent(false);
    }
  };

  const addPreferredTime = (dayValue) => {
    setFormValues((prev) => {
      const currentRanges = prev.preferredTimesByDay?.[dayValue] || [];
      const nextRanges = [...currentRanges, { ...EMPTY_RANGE }];
      return {
        ...prev,
        preferredTimesByDay: {
          ...prev.preferredTimesByDay,
          [dayValue]: nextRanges,
        },
      };
    });
  };

  const updatePreferredTime = (dayValue, index, field, value) => {
    setFormValues((prev) => {
      const currentRanges = prev.preferredTimesByDay?.[dayValue] || [];
      const nextRanges = currentRanges.map((range, idx) => (
        idx === index ? { ...range, [field]: value } : range
      ));
      return {
        ...prev,
        preferredTimesByDay: {
          ...prev.preferredTimesByDay,
          [dayValue]: nextRanges,
        },
      };
    });
  };

  const removePreferredTime = (dayValue, index) => {
    setFormValues((prev) => {
      const currentRanges = prev.preferredTimesByDay?.[dayValue] || [];
      const nextRanges = currentRanges.filter((_, idx) => idx !== index);
      const nextPreferredTimes = { ...prev.preferredTimesByDay };
      if (nextRanges.length) {
        nextPreferredTimes[dayValue] = nextRanges;
      } else {
        delete nextPreferredTimes[dayValue];
      }
      return {
        ...prev,
        preferredTimesByDay: nextPreferredTimes,
      };
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const nextTouched = {
      studentId: true,
      serviceId: true,
    };
    setTouched(nextTouched);

    if (!formValues.studentId || !formValues.serviceId) {
      return;
    }

    setIsSubmitting(true);
    setFormError('');

    const payload = {
      org_id: activeOrgId,
      student_id: formValues.studentId,
      desired_service_id: formValues.serviceId,
      preferred_days: formValues.preferredDays.length ? formValues.preferredDays : [],
      preferred_times: serializePreferredTimes(formValues.preferredTimesByDay),
      priority_flag: formValues.priorityFlag,
      notes: formValues.notes.trim() || null,
      status: formValues.status,
    };

    const endpoint = formValues.id ? `waiting-list/${formValues.id}` : 'waiting-list';
    const method = formValues.id ? 'PUT' : 'POST';

    try {
      await authenticatedFetch(endpoint, {
        method,
        session,
        body: payload,
      });
      setDialogOpen(false);
      await loadEntries();
    } catch (err) {
      setFormError(err?.message || 'שמירת רשומת ההמתנה נכשלה.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const studentError = touched.studentId && !formValues.studentId ? 'בחרו תלמיד מהרשימה.' : '';
  const serviceError = touched.serviceId && !formValues.serviceId ? 'בחרו שירות.' : '';

  const pageActions = canManage ? (
    <div className="flex items-center gap-2">
      <Button onClick={openInviteDialog} className="gap-2" size="sm" variant="outline">
        <Send className="h-4 w-4" />
        {inviteResult ? 'שלח טופס נוסף' : 'שלח טופס המתנה'}
      </Button>
      <Button onClick={openCreateDialog} className="gap-2" size="sm">
        <Plus className="h-4 w-4" />
        רשומה חדשה
      </Button>
    </div>
  ) : null;

  if (!activeOrgId) {
    return (
      <PageLayout title="רשימת המתנה">
        <Card>
          <CardContent className="p-4 text-sm text-neutral-600">
            בחרו ארגון כדי לצפות ברשימת ההמתנה.
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  if (!activeOrgHasConnection) {
    return (
      <PageLayout title="רשימת המתנה">
        <Card>
          <CardContent className="p-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md">
            דרוש חיבור מאומת למסד הנתונים של הארגון כדי לנהל את רשימת ההמתנה.
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  if (!canManage) {
    return (
      <PageLayout title="רשימת המתנה">
        <Card>
          <CardContent className="p-4 text-sm text-neutral-600">
            אין לך הרשאה לנהל את רשימת ההמתנה.
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="רשימת המתנה" description="ניהול תלמידים הממתינים לשיבוץ" actions={pageActions}>
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="max-w-xs">
              <SelectField
                id="waiting-list-status-filter"
                label="תצוגה"
                value={statusFilter}
                onChange={setStatusFilter}
                options={STATUS_FILTER_OPTIONS}
              />
            </div>
            {loadingMeta && (
              <div className="text-xs text-neutral-500">טוען רשימות נתונים...</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">רשומות בהמתנה</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-neutral-500">טוען רשומות...</div>
          ) : listError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{listError}</div>
          ) : entries.length === 0 ? (
            <div className="text-sm text-neutral-500">לא נמצאו רשומות.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>תלמיד</TableHead>
                    <TableHead>יצירת קשר</TableHead>
                    <TableHead>שירות מבוקש</TableHead>
                    <TableHead>ימי זמינות</TableHead>
                    <TableHead>זמני העדפה</TableHead>
                    <TableHead>עדיפות</TableHead>
                    <TableHead>סטטוס</TableHead>
                    <TableHead>פרטי קליטה</TableHead>
                    <TableHead>פעולות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => {
                    const isPriority = Boolean(entry.priority_flag);
                    const statusLabel = STATUS_OPTIONS.find((option) => option.value === entry.status)?.label || '—';
                    const intakeMeta = entry?.metadata && typeof entry.metadata === 'object' ? entry.metadata : {};
                    const isProspect = entry?.student?.onboarding_status === 'pending_wl_form';
                    const paymentPathLabel = intakeMeta.payment_path_intent === 'hmo'
                      ? 'קופת חולים'
                      : intakeMeta.payment_path_intent === 'private'
                        ? 'פרטי'
                        : intakeMeta.payment_path_intent === 'unsure'
                          ? 'צריך עזרה'
                          : '';
                    const hmoProviderName = intakeMeta.payment_path_intent === 'hmo'
                      ? String(intakeMeta.hmo_provider_name || '').trim()
                      : '';
                    const contactRelationshipLabel = intakeMeta.contact_relationship === 'mother'
                      ? 'אם'
                      : intakeMeta.contact_relationship === 'father'
                        ? 'אב'
                        : intakeMeta.contact_relationship === 'caretaker'
                          ? 'מטפל/ת'
                          : intakeMeta.contact_relationship === 'other'
                            ? 'אחר'
                            : intakeMeta.contact_relationship === 'self'
                              ? 'התלמיד/ה עצמו/ה'
                              : '';
                    const hmoApprovalLabel = intakeMeta.payment_path_intent === 'hmo' && (intakeMeta.hmo_approval_status === 'send_separately' || intakeMeta.hmo_approval_status === 'has_approval')
                      ? 'יישלח בנפרד'
                        : intakeMeta.payment_path_intent === 'hmo' && intakeMeta.hmo_approval_status === 'no_approval_yet'
                          ? 'ללא אישור'
                          : '';
                    return (
                      <TableRow
                        key={entry.id}
                        className={cn(
                          isPriority && 'border-s-4 border-red-400 bg-red-50/40'
                        )}
                      >
                        <TableCell className="font-medium">
                          <div className="flex flex-col gap-1">
                            <Link to={`/students/${entry.student_id}`} className="font-medium text-primary hover:underline">
                              {buildStudentName(entry.student)}
                            </Link>
                            {isProspect ? (
                              <Badge variant="outline" className="w-fit">מתעניין / טופס המתנה</Badge>
                            ) : null}
                            {intakeMeta.source === 'waiting_list_intake' ? (
                              <Badge variant="secondary" className="w-fit">נוצר מטופס</Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-neutral-600">
                          <div className="flex flex-col gap-1">
                            <span>{entry?.student?.phone || '—'}</span>
                            <span>{entry?.student?.email || '—'}</span>
                          </div>
                        </TableCell>
                        <TableCell>{entry.service?.name || '—'}</TableCell>
                        <TableCell>{formatPreferredDays(entry.preferred_days)}</TableCell>
                        <TableCell className="text-sm text-neutral-600">
                          {formatPreferredTimes(entry.preferred_times)}
                        </TableCell>
                        <TableCell>
                          {isPriority ? (
                            <Badge variant="destructive">דחוף</Badge>
                          ) : (
                            <Badge variant="secondary">רגיל</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_BADGE_VARIANTS[entry.status] || 'outline'}>{statusLabel}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-neutral-600">
                          <div className="flex flex-col gap-1">
                            {intakeMeta.contact_relationship && intakeMeta.contact_relationship !== 'self' && intakeMeta.contact_name ? <span>איש קשר: {intakeMeta.contact_name}</span> : null}
                            {intakeMeta.contact_relationship && intakeMeta.contact_relationship !== 'self' && contactRelationshipLabel ? <span>קשר לתלמיד/ה: {contactRelationshipLabel}</span> : null}
                            {paymentPathLabel ? <span>מסלול תשלום: {paymentPathLabel}</span> : null}
                            {hmoProviderName ? <span>גורם מממן: {hmoProviderName}</span> : null}
                            {hmoApprovalLabel ? <span>אישור גורם מממן: {hmoApprovalLabel}</span> : null}
                            {entry.notes ? <span>הערות: {entry.notes}</span> : null}
                            {!intakeMeta.contact_name && !contactRelationshipLabel && !paymentPathLabel && !hmoProviderName && !hmoApprovalLabel && !entry.notes ? <span>—</span> : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => openEditDialog(entry)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>שליחת טופס הצטרפות לרשימת המתנה</DialogTitle>
            <DialogDescription>
              יוצרים או מקשרים מתעניין קיים, ושולחים קישור ציבורי קצר וברור למילוי הפרטים הראשוניים.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInviteSubmit}>
            <div className="space-y-5 py-4">
              <div className="rounded-2xl border border-border/70 bg-gradient-to-br from-primary/5 via-background to-background p-4">
                <div className="mb-4 space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">פרטי שליחה בסיסיים</h3>
                  <p className="text-xs text-muted-foreground">מספיקים כמה פרטים כדי ליצור מתעניין ולהכין עבורו קישור מסודר.</p>
                </div>

                <div className="space-y-4">
                  <SelectField
                    id="waiting-list-intake-form"
                    label="טופס *"
                    value={inviteFormValues.formId}
                    onChange={(value) => setInviteFormValues((prev) => ({ ...prev, formId: value }))}
                    options={waitingListFormOptions}
                    placeholder="בחרו טופס רשימת המתנה"
                    required
                    disabled={loadingWaitingListForms}
                  />
                  {loadingWaitingListForms ? (
                    <p className="text-xs text-neutral-500">טוען טפסי רשימת המתנה...</p>
                  ) : null}

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <TextField
                      id="waiting-list-student-first-name"
                      name="studentFirstName"
                      label="שם פרטי של התלמיד/ה *"
                      value={inviteFormValues.studentFirstName}
                      onChange={(event) => setInviteFormValues((prev) => ({ ...prev, studentFirstName: event.target.value }))}
                      required
                    />
                    <TextField
                      id="waiting-list-student-last-name"
                      name="studentLastName"
                      label="שם משפחה של התלמיד/ה *"
                      value={inviteFormValues.studentLastName}
                      onChange={(event) => setInviteFormValues((prev) => ({ ...prev, studentLastName: event.target.value }))}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <TextField
                      id="waiting-list-identity"
                      name="identityNumber"
                      label="מספר זהות *"
                      value={inviteFormValues.identityNumber}
                      onChange={(event) => setInviteFormValues((prev) => ({ ...prev, identityNumber: event.target.value.replace(/\D/g, '') }))}
                      required
                    />
                    <SelectField
                      id="waiting-list-primary-service"
                      label="שירות ראשי *"
                      value={inviteFormValues.serviceId}
                      onChange={(value) => setInviteFormValues((prev) => ({ ...prev, serviceId: value }))}
                      options={serviceOptions}
                      placeholder="בחרו שירות"
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-background p-4">
                <div className="mb-4 space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">פרטי מסירה</h3>
                  <p className="text-xs text-muted-foreground">הקישור יכול להישלח בוואטסאפ או באימייל, בהתאם לפרטי הקשר הזמינים.</p>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <SelectField
                    id="waiting-list-delivery-method"
                    label="אופן שליחה"
                    value={inviteFormValues.deliveryMethod}
                    onChange={(value) => setInviteFormValues((prev) => ({ ...prev, deliveryMethod: value }))}
                    options={[
                      { value: 'whatsapp', label: 'וואטסאפ' },
                      { value: 'email', label: 'אימייל' },
                    ]}
                  />
                  <TextField
                    id="waiting-list-phone"
                    name="phone"
                    label={inviteFormValues.deliveryMethod === 'whatsapp' ? 'טלפון *' : 'טלפון'}
                    value={inviteFormValues.phone}
                    onChange={(event) => setInviteFormValues((prev) => ({ ...prev, phone: event.target.value }))}
                    required={inviteFormValues.deliveryMethod === 'whatsapp'}
                  />
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <TextField
                    id="waiting-list-email"
                    name="email"
                    label={inviteFormValues.deliveryMethod === 'email' ? 'אימייל *' : 'אימייל'}
                    value={inviteFormValues.email}
                    onChange={(event) => setInviteFormValues((prev) => ({ ...prev, email: event.target.value }))}
                    required={inviteFormValues.deliveryMethod === 'email'}
                  />
                  <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-3 py-3">
                    <div>
                      <Label className="block">לאפשר בקשה לשירותים נוספים</Label>
                      <p className="text-xs text-neutral-500">המתעניין יוכל לציין בטופס שירותים נוספים שמעניינים אותו.</p>
                    </div>
                    <Switch
                      checked={inviteFormValues.allowAdditionalServices}
                      onCheckedChange={(checked) => setInviteFormValues((prev) => ({ ...prev, allowAdditionalServices: checked }))}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-background p-4">
                <TextAreaField
                  id="waiting-list-internal-note"
                  name="internalNote"
                  label="הערה פנימית"
                  value={inviteFormValues.internalNote}
                  onChange={(event) => setInviteFormValues((prev) => ({ ...prev, internalNote: event.target.value }))}
                  rows={3}
                  placeholder="מידע פנימי לצוות: רגישות בשעות, פרטי פנייה קודמים, דגשים לשיחה ראשונה"
                />
              </div>

              {inviteError ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
                  {inviteError}
                </div>
              ) : null}

              {inviteResult ? (
                <div className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  <div className="space-y-1">
                    <div className="font-semibold">הקישור נוצר בהצלחה</div>
                    <p className="text-emerald-800/90">
                      הקישור מוכן לשיתוף ויישאר זמין
                      {inviteResult?.expires_at ? ` עד ${formatInviteExpiry(inviteResult.expires_at)}` : ''}.
                    </p>
                  </div>
                  <a
                    href={inviteResult.invite_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-primary underline"
                  >
                    <ExternalLink className="h-4 w-4" />
                    פתח קישור
                  </a>
                  {inviteWhatsappLink ? (
                    <a
                      href={inviteWhatsappLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 text-primary underline"
                    >
                      <MessageCircle className="h-4 w-4" />
                      שלח בוואטסאפ
                    </a>
                  ) : null}
                  {inviteResult?.email ? (
                    <div className="flex items-center gap-2 text-neutral-700">
                      <Mail className="h-4 w-4" />
                      <span>{inviteResult.email}</span>
                    </div>
                  ) : null}
                  {inviteResult?.reused_existing_invite ? (
                    <p className="text-xs text-emerald-800/80">כבר היה קישור פעיל לבקשה הזאת, ולכן נעשה שימוש בקישור הקיים.</p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex flex-row-reverse gap-2 pt-4">
              <Button
                type={inviteResult ? 'button' : 'submit'}
                onClick={inviteResult ? handlePrepareAdditionalInvite : undefined}
                disabled={inviteSubmitting || waitingListFormOptions.length === 0}
              >
                {inviteSubmitting ? 'שולח...' : inviteResult ? 'שלח טופס נוסף' : 'שלח טופס'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setInviteDialogOpen(false)} disabled={inviteSubmitting}>
                ביטול
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{formValues.id ? 'עריכת רשומה' : 'רשומה חדשה'}</DialogTitle>
            <DialogDescription>
              הגדירו את צרכי התלמיד כדי שנוכל לשבץ אותו בשיעור קבוע.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <ComboBoxField
                id="waiting-student"
                name="student"
                label="תלמיד"
                value={formValues.studentSearch}
                onChange={handleStudentChange}
                options={studentOptions}
                placeholder="בחרו תלמיד מהרשימה"
                required
                error={studentError}
              />
              {canCreateStudent ? (
                <div className="flex justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={handleOpenAddStudentDialog}>
                    + תלמיד חדש
                  </Button>
                </div>
              ) : null}

              <SelectField
                id="waiting-service"
                label="שירות מבוקש"
                value={formValues.serviceId}
                onChange={handleServiceChange}
                options={serviceOptions}
                placeholder="בחרו שירות"
                required
                error={serviceError}
              />

              <div className="space-y-3">
                <Label className="block">ימי זמינות</Label>
                <div className="flex items-start gap-4 overflow-x-auto pb-2">
                  {DAYS_OF_WEEK.map((day) => {
                    const ranges = formValues.preferredTimesByDay?.[day.value] || [];
                    const isSelected = formValues.preferredDays.includes(day.value);
                    return (
                      <div key={day.value} className="flex min-w-[120px] flex-col items-center gap-2">
                        <button
                          type="button"
                          onClick={() => togglePreferredDay(day.value)}
                          className={cn(
                            'flex flex-col items-center justify-center min-w-[3rem] h-[3rem] rounded-lg border-2 transition-colors',
                            isSelected
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background hover:bg-muted border-muted-foreground/20'
                          )}
                        >
                          <span className="text-xs font-medium">{day.labelShort}</span>
                          <span className="text-[0.65rem] opacity-80">{day.label}</span>
                        </button>
                        {isSelected ? (
                          <button
                            type="button"
                            onClick={() => openTimeEditor(day.value)}
                            className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs text-primary hover:bg-primary/10"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            עריכה
                          </button>
                        ) : null}
                        {ranges.length > 0 ? (
                          <span className="text-[0.65rem] text-neutral-500">טווחים: {ranges.length}</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-neutral-600">
                  {formValues.preferredDays.length === 0
                    ? 'לא נבחרו ימים.'
                    : `נבחרו ${formValues.preferredDays.length} ימים: ${formatPreferredDays(formValues.preferredDays)}`}
                </p>
                <p className="text-xs text-neutral-500">אפשר להוסיף כמה טווחים לכל יום (לדוגמה: 14:00-16:00, 17:00-18:00).</p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
                <div>
                  <Label className="block">עדיפות גבוהה</Label>
                  <p className="text-xs text-neutral-500">סמנו אם נדרש שיבוץ דחוף.</p>
                </div>
                <Switch
                  checked={formValues.priorityFlag}
                  onCheckedChange={(checked) => setFormValues((prev) => ({ ...prev, priorityFlag: checked }))}
                />
              </div>

              <SelectField
                id="waiting-status"
                label="סטטוס"
                value={formValues.status}
                onChange={(value) => setFormValues((prev) => ({ ...prev, status: value }))}
                options={STATUS_OPTIONS}
              />

              <TextAreaField
                id="waiting-notes"
                name="notes"
                label="הערות"
                value={formValues.notes}
                onChange={(event) => setFormValues((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="דוגמה: מדריכה אישה בלבד, 30 דקות"
                rows={3}
              />
            </div>

            {formError ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
                {formError}
              </div>
            ) : null}

            <div className="flex flex-row-reverse gap-2 pt-4">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'שומר...' : 'שמירה'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={isSubmitting}>
                ביטול
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={timeEditorOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeTimeEditor();
            return;
          }
          setTimeEditorOpen(true);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>עריכת זמינות</DialogTitle>
            <DialogDescription>
              {timeEditorDay !== null
                ? `הגדירו טווחי זמן ליום ${DAYS_OF_WEEK.find((day) => day.value === timeEditorDay)?.label || ''}`
                : 'בחרו יום כדי לערוך זמינות.'}
            </DialogDescription>
          </DialogHeader>

          {timeEditorDay !== null ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">טווחים זמינים</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => addPreferredTime(timeEditorDay)}>
                  הוספת טווח
                </Button>
              </div>
              {(formValues.preferredTimesByDay?.[timeEditorDay] || []).length === 0 ? (
                <p className="text-xs text-neutral-500">לא הוגדרו טווחים.</p>
              ) : (
                <div className="space-y-2">
                  {(formValues.preferredTimesByDay?.[timeEditorDay] || []).map((range, index) => (
                    <div key={`${timeEditorDay}-${index}`} className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-neutral-500">התחלה</span>
                      <input
                        type="time"
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={range.start}
                        onChange={(event) => updatePreferredTime(timeEditorDay, index, 'start', event.target.value)}
                      />
                      <span className="text-sm text-neutral-500">–</span>
                      <span className="text-xs text-neutral-500">סיום</span>
                      <input
                        type="time"
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={range.end}
                        onChange={(event) => updatePreferredTime(timeEditorDay, index, 'end', event.target.value)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removePreferredTime(timeEditorDay, index)}
                      >
                        הסר
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <div className="flex flex-row-reverse gap-2 pt-4">
            <Button type="button" onClick={closeTimeEditor}>
              שמירה
            </Button>
            <Button type="button" variant="outline" onClick={closeTimeEditor}>
              דלג
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {canCreateStudent && (
        <Dialog open={isAddStudentOpen} onOpenChange={handleAddStudentDialogOpenChange}>
          <DialogContent
            className="sm:max-w-2xl"
            onInteractOutside={(event) => {
              if (openSelectCountRef.current > 0 || isClosingSelectRef.current) {
                event.preventDefault();
              }
            }}
            footer={
              <AddStudentFormFooter
                isSubmitting={isCreatingStudent}
                disableSubmit={addSubmitDisabled}
                onCancel={() => setIsAddStudentOpen(false)}
                onSubmit={() => {
                  document.getElementById('add-student-form')?.requestSubmit();
                }}
              />
            }
          >
            <DialogHeader>
              <DialogTitle>הוספת תלמיד חדש</DialogTitle>
              <DialogDescription>
                הזן את פרטי התלמיד. מספר זהות וטלפון (או אפוטרופוס) הם שדות חובה.
              </DialogDescription>
            </DialogHeader>
            <AddStudentForm
              onSubmit={handleAddStudentSubmit}
              onCancel={() => setIsAddStudentOpen(false)}
              isSubmitting={isCreatingStudent}
              error={createError}
              onSubmitDisabledChange={setAddSubmitDisabled}
              renderFooterOutside
              onSelectOpenChange={(open) => {
                if (open) {
                  openSelectCountRef.current++;
                } else {
                  isClosingSelectRef.current = true;
                  setTimeout(() => {
                    openSelectCountRef.current = Math.max(0, openSelectCountRef.current - 1);
                    isClosingSelectRef.current = false;
                  }, 100);
                }
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </PageLayout>
  );
}
