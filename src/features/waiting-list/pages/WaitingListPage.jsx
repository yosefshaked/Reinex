import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { normalizeMembershipRole, isAdminOrOffice } from '@/features/students/utils/endpoints.js';

const DAYS_OF_WEEK = [
  { value: 0, label: 'ראשון', labelShort: 'א' },
  { value: 1, label: 'שני', labelShort: 'ב' },
  { value: 2, label: 'שלישי', labelShort: 'ג' },
  { value: 3, label: 'רביעי', labelShort: 'ד' },
  { value: 4, label: 'חמישי', labelShort: 'ה' },
  { value: 5, label: 'שישי', labelShort: 'ו' },
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

  const canFetch = Boolean(session && activeOrgId && tenantClientReady && activeOrgHasConnection && canManage);

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
      const nextDays = prev.preferredDays.includes(dayValue)
        ? prev.preferredDays.filter((day) => day !== dayValue)
        : [...prev.preferredDays, dayValue].sort((a, b) => a - b);
      return { ...prev, preferredDays: nextDays };
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
        <DialogContent className="sm:max-w-lg" dir="rtl">
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
                <div className="flex flex-wrap gap-2">
                  {DAYS_OF_WEEK.map((day) => (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => togglePreferredDay(day.value)}
                      className={cn(
                        'flex flex-col items-center justify-center min-w-[3rem] h-[3rem] rounded-lg border-2 transition-colors',
                        formValues.preferredDays.includes(day.value)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background hover:bg-muted border-muted-foreground/20'
                      )}
                    >
                      <span className="text-xs font-medium">{day.labelShort}</span>
                      <span className="text-[0.65rem] opacity-80">{day.label}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-neutral-600">
                  {formValues.preferredDays.length === 0
                    ? 'לא נבחרו ימים.'
                    : `נבחרו ${formValues.preferredDays.length} ימים: ${formatPreferredDays(formValues.preferredDays)}`}
                </p>
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
    </PageLayout>
  );
}
