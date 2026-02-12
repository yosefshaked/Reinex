import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import PageLayout from '@/components/ui/PageLayout.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ComboBoxField, SelectField, TextAreaField } from '@/components/ui/forms-ui';
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
  { value: 'open', label: 'פתוח' },
  { value: 'matched', label: 'שובץ' },
  { value: 'closed', label: 'בוטל' },
];

const STATUS_FILTER_OPTIONS = [
  { value: 'open', label: 'פתוחים בלבד' },
  { value: 'all', label: 'כולל שובצו/בוטלו' },
];

const STATUS_BADGE_VARIANTS = {
  open: 'secondary',
  matched: 'default',
  closed: 'outline',
};

const EMPTY_RANGE = { start: '', end: '' };

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
  const [statusFilter, setStatusFilter] = useState('open');
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
    <Button onClick={openCreateDialog} className="gap-2" size="sm">
      <Plus className="h-4 w-4" />
      רשומה חדשה
    </Button>
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
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between" dir="rtl">
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
                    <TableHead className="text-right">תלמיד</TableHead>
                    <TableHead className="text-right">שירות מבוקש</TableHead>
                    <TableHead className="text-right">ימי זמינות</TableHead>
                    <TableHead className="text-right">זמני העדפה</TableHead>
                    <TableHead className="text-right">עדיפות</TableHead>
                    <TableHead className="text-right">סטטוס</TableHead>
                    <TableHead className="text-right">הערות</TableHead>
                    <TableHead className="text-right">פעולות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => {
                    const isPriority = Boolean(entry.priority_flag);
                    const statusLabel = STATUS_OPTIONS.find((option) => option.value === entry.status)?.label || '—';
                    return (
                      <TableRow
                        key={entry.id}
                        className={cn(
                          isPriority && 'border-l-4 border-red-400 bg-red-50/40'
                        )}
                      >
                        <TableCell className="text-right font-medium">
                          {buildStudentName(entry.student)}
                        </TableCell>
                        <TableCell className="text-right">{entry.service?.name || '—'}</TableCell>
                        <TableCell className="text-right">{formatPreferredDays(entry.preferred_days)}</TableCell>
                        <TableCell className="text-right text-sm text-neutral-600">
                          {formatPreferredTimes(entry.preferred_times)}
                        </TableCell>
                        <TableCell className="text-right">
                          {isPriority ? (
                            <Badge variant="destructive">דחוף</Badge>
                          ) : (
                            <Badge variant="secondary">רגיל</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={STATUS_BADGE_VARIANTS[entry.status] || 'outline'}>{statusLabel}</Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm text-neutral-600">
                          {entry.notes || '—'}
                        </TableCell>
                        <TableCell className="text-right">
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-3xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>{formValues.id ? 'עריכת רשומה' : 'רשומה חדשה'}</DialogTitle>
            <DialogDescription className="text-right">
              הגדירו את צרכי התלמיד כדי שנוכל לשבץ אותו בשיעור קבוע.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} dir="rtl">
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
                <Label className="block text-right">ימי זמינות</Label>
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
                  <Label className="block text-right">עדיפות גבוהה</Label>
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
        <DialogContent className="sm:max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>עריכת זמינות</DialogTitle>
            <DialogDescription className="text-right">
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
