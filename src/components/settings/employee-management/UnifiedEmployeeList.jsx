import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar.jsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Mail, MailPlus, MessageCircle, Phone, Search, Settings, UserPlus, UserX, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '@/lib/api-client';
import { useInstructors, useServices } from '@/hooks/useOrgData.js';
import { cn } from '@/lib/utils';
import EmployeeWizardDialog from './EmployeeWizardDialog.jsx';
import EditEmployeeDialog from './EditEmployeeDialog.jsx';

const REQUEST = { idle: 'idle', loading: 'loading' };

function toLocalDateString(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftDate(dateString, deltaDays) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + deltaDays);
  return toLocalDateString(date);
}

function formatDate(dateString, options = { day: 'numeric', month: 'numeric', year: 'numeric' }) {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('he-IL', options).format(date);
}

function getInitials(employee) {
  const first = employee?.first_name || '';
  const last = employee?.last_name || '';
  if (first && last) return `${first[0]}${last[0]}`.toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  return (employee?.email || '?').slice(0, 2).toUpperCase();
}

function getEmployeeName(employee) {
  return `${employee?.first_name || ''} ${employee?.last_name || ''}`.trim() || employee?.email || employee?.employee_id || 'עובד';
}

function getEmployeeType(employee) {
  if (employee?.employee_type) return employee.employee_type;
  if (employee?.instructor_profile || (employee?.service_capabilities || []).length > 0) return 'instructor';
  return 'office';
}

function getEmployeeTypeLabel(employee) {
  return getEmployeeType(employee) === 'instructor' ? 'מדריך/ה' : 'עובד/ת משרד';
}

function getWhatsAppLink(employee) {
  const phone = String(employee?.phone || '').replace(/[^\d]/g, '');
  if (!phone) return '';
  const normalized = phone.startsWith('0') ? `972${phone.slice(1)}` : phone;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(`שלום ${getEmployeeName(employee)},`)}`;
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0">
      <div className="text-sm text-slate-900">{value || '—'}</div>
      <div className="shrink-0 text-xs font-medium text-slate-500">{label}</div>
    </div>
  );
}

export default function UnifiedEmployeeList({ session, orgId, canLoad }) {
  const sessionAccessToken = session?.access_token || null;
  const authSession = useMemo(() => (sessionAccessToken ? { access_token: sessionAccessToken } : null), [sessionAccessToken]);
  const [showWizard, setShowWizard] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionState, setActionState] = useState(REQUEST.idle);
  const [overviewInstances, setOverviewInstances] = useState([]);
  const [employeeInstances, setEmployeeInstances] = useState([]);
  const [instancesLoading, setInstancesLoading] = useState(false);

  const { instructors, unlinkedMembers, loadingInstructors, instructorsError, refetchInstructors } = useInstructors({
    includeInactive: true,
    includeUnlinked: true,
    orgId,
    session,
    enabled: canLoad,
  });
  const { services } = useServices({ enabled: canLoad, orgId, session });

  const filteredEmployees = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return instructors
      .filter((employee) => showInactive || employee.is_active)
      .filter((employee) => {
        if (!query) return true;
        return [getEmployeeName(employee), employee.email, employee.phone, employee.employee_id]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query);
      });
  }, [instructors, searchTerm, showInactive]);

  const currentEmployee = useMemo(() => {
    if (!filteredEmployees.length) return null;
    return filteredEmployees.find((employee) => employee.id === selectedEmployeeId) || filteredEmployees[0];
  }, [filteredEmployees, selectedEmployeeId]);

  useEffect(() => {
    if (currentEmployee?.id && currentEmployee.id !== selectedEmployeeId) {
      setSelectedEmployeeId(currentEmployee.id);
    }
  }, [currentEmployee, selectedEmployeeId]);

  const fetchOverviewInstances = useCallback(async () => {
    if (!canLoad || !orgId) return;
    try {
      const today = toLocalDateString(new Date());
      const endDate = shiftDate(today, 6);
      const payload = await authenticatedFetch(`calendar/instances?org_id=${orgId}&start_date=${today}&end_date=${endDate}`, { session: authSession });
      setOverviewInstances(Array.isArray(payload) ? payload : []);
    } catch (error) {
      console.error('Failed to load employee overview instances', error);
      setOverviewInstances([]);
    }
  }, [authSession, canLoad, orgId]);

  useEffect(() => {
    void fetchOverviewInstances();
  }, [fetchOverviewInstances]);

  useEffect(() => {
    if (!canLoad || !orgId || !currentEmployee?.id || getEmployeeType(currentEmployee) !== 'instructor') {
      setEmployeeInstances([]);
      return;
    }
    let isActive = true;
    const load = async () => {
      setInstancesLoading(true);
      try {
        const today = toLocalDateString(new Date());
        const startDate = shiftDate(today, -30);
        const endDate = shiftDate(today, 30);
        const payload = await authenticatedFetch(`calendar/instances?org_id=${orgId}&start_date=${startDate}&end_date=${endDate}&instructor_id=${currentEmployee.id}`, { session: authSession });
        if (isActive) setEmployeeInstances(Array.isArray(payload) ? payload : []);
      } catch (error) {
        console.error('Failed to load employee instances', error);
        if (isActive) setEmployeeInstances([]);
      } finally {
        if (isActive) setInstancesLoading(false);
      }
    };
    void load();
    return () => { isActive = false; };
  }, [authSession, canLoad, currentEmployee, orgId]);

  const summary = useMemo(() => ({
    activeEmployees: instructors.filter((employee) => employee.is_active).length,
    missingUser: instructors.filter((employee) => employee.is_active && !employee.user_id).length,
    missingDetails: instructors.filter((employee) => !employee.phone || !employee.start_date).length,
    upcomingLessons: overviewInstances.filter((instance) => instance.status === 'scheduled').length,
  }), [instructors, overviewInstances]);

  const upcomingInstances = useMemo(() => employeeInstances.filter((instance) => instance.status === 'scheduled').slice(0, 6), [employeeInstances]);
  const completedInstances = useMemo(() => employeeInstances.filter((instance) => instance.status === 'completed').slice(0, 6), [employeeInstances]);

  const employeeActivities = useMemo(() => {
    const map = new Map();
    overviewInstances.forEach((instance) => {
      const current = map.get(instance.instructor_employee_id) || { scheduled: 0, completed: 0 };
      if (instance.status === 'scheduled') current.scheduled += 1;
      if (instance.status === 'completed') current.completed += 1;
      map.set(instance.instructor_employee_id, current);
    });
    return map;
  }, [overviewInstances]);

  const handleLinkUser = async (employee) => {
    const email = window.prompt('הזן כתובת דוא"ל להזמנת משתמש:', employee.email || '');
    if (!email?.trim()) return;
    setActionState(REQUEST.loading);
    try {
      await authenticatedFetch('instructors-link-user', { session, method: 'POST', body: { org_id: orgId, instructor_id: employee.id, email: email.trim() } });
      toast.success('ההזמנה נשלחה בהצלחה.');
      await refetchInstructors();
    } catch (error) {
      console.error('Failed to link user', error);
      toast.error('שליחת ההזמנה נכשלה.');
    } finally {
      setActionState(REQUEST.idle);
    }
  };

  const handleCreateEmployeeForMember = async (member) => {
    setActionState(REQUEST.loading);
    try {
      const fullName = member?.profile?.full_name || '';
      const parts = fullName.split(' ').filter(Boolean);
      await authenticatedFetch('instructors', {
        session,
        method: 'POST',
        body: {
          org_id: orgId,
          user_id: member.user_id,
          employee_id: member.user_id,
          employee_type: 'office',
          first_name: parts[0] || member?.profile?.email || 'משתמש',
          last_name: parts.length > 1 ? parts.slice(1).join(' ') : '',
          email: member?.profile?.email || undefined,
        },
      });
      toast.success('נוצר עובד חדש עבור חבר הארגון.');
      await refetchInstructors();
    } catch (error) {
      console.error('Failed to create employee for member', error);
      toast.error('יצירת עובד עבור חבר הארגון נכשלה.');
    } finally {
      setActionState(REQUEST.idle);
    }
  };

  const handleToggleActive = async (employee, nextIsActive) => {
    setActionState(REQUEST.loading);
    try {
      if (nextIsActive) {
        await authenticatedFetch('instructors', { session, method: 'PUT', body: { org_id: orgId, instructor_id: employee.id, is_active: true } });
      } else {
        await authenticatedFetch('instructors', { session, method: 'DELETE', body: { org_id: orgId, instructor_id: employee.id } });
      }
      toast.success(nextIsActive ? 'העובד הופעל מחדש.' : 'העובד הושבת.');
      await refetchInstructors();
    } catch (error) {
      console.error('Failed to update employee active state', error);
      toast.error('עדכון סטטוס העובד נכשל.');
    } finally {
      setActionState(REQUEST.idle);
    }
  };

  if (!canLoad) {
    return <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600">נדרש חיבור Supabase פעיל כדי לנהל עובדים.</div>;
  }

  if (loadingInstructors && instructors.length === 0) {
    return <div className="flex items-center justify-center gap-3 rounded-3xl border border-slate-200 bg-white p-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /><span className="text-sm text-slate-600">טוען עובדים...</span></div>;
  }

  if (instructorsError) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{instructorsError}</div>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setShowWizard(true)} size="sm"><UserPlus className="me-2 h-4 w-4" />עובד חדש</Button>
            <Button variant="outline" size="sm" onClick={() => setShowInactive((prev) => !prev)}>{showInactive ? 'הסתר מושבתים' : 'הצג מושבתים'}</Button>
          </div>
          <div className="text-end">
            <h2 className="text-xl font-semibold text-slate-950">ניהול עובדים</h2>
            <p className="text-sm text-slate-500">מבט מהיר על עובדים, חוסרים תפעוליים וכניסה ישירה לכרטיס עובד מלא.</p>
          </div>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[['עובדים פעילים', summary.activeEmployees], ['ללא משתמש מקושר', summary.missingUser], ['אירועים קרובים השבוע', summary.upcomingLessons], ['חוסרים בפרטים', summary.missingDetails]].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4"><div className="text-2xl font-semibold text-slate-900">{value}</div><div className="mt-1 text-sm text-slate-500">{label}</div></div>
          ))}
        </div>
        <div className="mt-6 grid gap-3 lg:grid-cols-2">
          {filteredEmployees.slice(0, 6).map((employee) => {
            const activity = employeeActivities.get(employee.id) || { scheduled: 0, completed: 0 };
            return (
              <button key={employee.id} type="button" onClick={() => setSelectedEmployeeId(employee.id)} className={cn('rounded-2xl border px-4 py-4 text-start transition', selectedEmployeeId === employee.id ? 'border-blue-200 bg-blue-50/70' : 'border-slate-200 bg-white hover:border-slate-300')}>
                <div className="flex items-center justify-between gap-4">
                  <div className="text-xs text-slate-500">{activity.scheduled} מתוכננים • {activity.completed} הושלמו</div>
                  <div className="flex items-center gap-3">
                    <div className="text-end">
                      <div className="text-sm font-semibold text-slate-900">{getEmployeeName(employee)}</div>
                      <div className="text-xs text-slate-500">{getEmployeeTypeLabel(employee)} • {employee.email || employee.phone || 'ללא פרטי קשר'}</div>
                    </div>
                    <Avatar className="h-11 w-11"><AvatarFallback className="bg-blue-100 text-blue-700">{getInitials(employee)}</AvatarFallback></Avatar>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {unlinkedMembers.length > 0 ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
            <div className="text-end text-sm font-medium text-amber-900">חברי ארגון ללא כרטיס עובד</div>
            <div className="mt-1 text-end text-sm text-amber-800">יש {unlinkedMembers.length} משתמשים שטרם קיבלו כרטיס עובד.</div>
            <div className="mt-3 space-y-2">
              {unlinkedMembers.slice(0, 3).map((member) => (
                <div key={member.user_id} className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white/70 px-3 py-2">
                  <Button size="sm" variant="outline" onClick={() => handleCreateEmployeeForMember(member)} disabled={actionState === REQUEST.loading}>
                    <UserPlus className="me-2 h-4 w-4" />
                    צור עובד
                  </Button>
                  <div className="text-end">
                    <div className="text-sm font-medium text-slate-900">{member.profile?.full_name || member.profile?.email || member.user_id}</div>
                    <div className="text-xs text-slate-500">{member.profile?.email || 'ללא דוא״ל'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 xl:grid-cols-[320px,minmax(0,1fr)]">
        <aside className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="חיפוש לפי שם, דוא״ל, טלפון או מספר עובד" className="pe-9 text-end" />
            </div>
            <div className="space-y-2">
              {filteredEmployees.map((employee) => (
                <button key={employee.id} type="button" onClick={() => setSelectedEmployeeId(employee.id)} className={cn('flex w-full items-center gap-3 rounded-2xl border p-3 text-start transition', selectedEmployeeId === employee.id ? 'border-blue-200 bg-blue-50/70' : 'border-slate-200 bg-white hover:border-slate-300')}>
                  <Avatar className="h-11 w-11"><AvatarFallback className={employee.is_active ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'}>{getInitials(employee)}</AvatarFallback></Avatar>
                  <div className="min-w-0 flex-1 text-end">
                    <div className="truncate text-sm font-semibold text-slate-900">{getEmployeeName(employee)}</div>
                    <div className="truncate text-xs text-slate-500">{employee.email || employee.phone || employee.employee_id || 'ללא פרטי קשר'}</div>
                    <div className="mt-2 flex flex-wrap justify-end gap-2">
                      <Badge variant={employee.is_active ? 'default' : 'secondary'}>{employee.is_active ? 'פעיל' : 'מושבת'}</Badge>
                      {!employee.user_id ? <Badge variant="outline">ידני</Badge> : null}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div className="space-y-5">
          {!currentEmployee ? <div className="rounded-[2rem] border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500">בחר עובד כדי לצפות בכרטיס המלא.</div> : (
            <>
              <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    {!currentEmployee.user_id ? <Button size="sm" variant="outline" onClick={() => handleLinkUser(currentEmployee)} disabled={actionState === REQUEST.loading}><MailPlus className="me-2 h-4 w-4" />הזמן משתמש</Button> : null}
                    {currentEmployee.phone ? <Button size="sm" variant="outline" onClick={() => window.open(getWhatsAppLink(currentEmployee), '_blank', 'noopener,noreferrer')}><MessageCircle className="me-2 h-4 w-4" />WhatsApp</Button> : null}
                    {currentEmployee.phone ? <Button size="sm" variant="outline" asChild><a href={`tel:${currentEmployee.phone}`}><Phone className="me-2 h-4 w-4" />התקשר</a></Button> : null}
                    {currentEmployee.email ? <Button size="sm" variant="outline" asChild><a href={`mailto:${currentEmployee.email}`}><Mail className="me-2 h-4 w-4" />מייל</a></Button> : null}
                    <Button size="sm" variant="outline" onClick={() => { setSelectedEmployee(currentEmployee); setShowEditDialog(true); }}><Settings className="me-2 h-4 w-4" />ערוך</Button>
                    {currentEmployee.is_active ? <Button size="sm" variant="outline" onClick={() => handleToggleActive(currentEmployee, false)} disabled={actionState === REQUEST.loading}><UserX className="me-2 h-4 w-4 text-red-600" />השבת</Button> : <Button size="sm" variant="outline" onClick={() => handleToggleActive(currentEmployee, true)} disabled={actionState === REQUEST.loading}><RotateCcw className="me-2 h-4 w-4 text-green-600" />הפעל מחדש</Button>}
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="text-end">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Badge variant={currentEmployee.is_active ? 'default' : 'secondary'}>{currentEmployee.is_active ? 'פעיל' : 'מושבת'}</Badge>
                        <Badge variant="outline">{getEmployeeTypeLabel(currentEmployee)}</Badge>
                        {!currentEmployee.user_id ? <Badge variant="outline">ללא משתמש</Badge> : null}
                      </div>
                      <h2 className="mt-2 text-2xl font-semibold text-slate-950">{getEmployeeName(currentEmployee)}</h2>
                      <p className="text-sm text-slate-500">{currentEmployee.email || 'אין כתובת דוא״ל'} • התחלה: {formatDate(currentEmployee.start_date)}</p>
                    </div>
                    <Avatar className="h-16 w-16"><AvatarFallback className="bg-blue-100 text-lg font-semibold text-blue-700">{getInitials(currentEmployee)}</AvatarFallback></Avatar>
                  </div>
                </div>
              </section>

              <div className="grid gap-5 xl:grid-cols-2">
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="mb-4 text-base font-semibold text-slate-900 text-end">פרטי עובד</h3>
                  <Row label="מספר עובד / תעודה" value={currentEmployee.employee_id} />
                  <Row label="סוג עובד" value={getEmployeeTypeLabel(currentEmployee)} />
                  <Row label="תאריך התחלה" value={formatDate(currentEmployee.start_date)} />
                  <Row label="היקף העסקה" value={currentEmployee.employment_scope} />
                  <Row label="תעריף נוכחי" value={currentEmployee.current_rate != null ? `₪${currentEmployee.current_rate}` : '—'} />
                  <Row label="הערות" value={currentEmployee.notes} />
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="mb-4 text-base font-semibold text-slate-900 text-end">תקשורת וחופשות</h3>
                  <Row label="דוא״ל" value={currentEmployee.email} />
                  <Row label="טלפון" value={currentEmployee.phone} />
                  <Row label="משתמש מקושר" value={currentEmployee.user_id ? 'כן' : 'לא'} />
                  <Row label="ימי חופשה שנתיים" value={currentEmployee.annual_leave_days != null ? `${currentEmployee.annual_leave_days}` : '—'} />
                  <Row label="שיטת תשלום חופשה" value={currentEmployee.leave_pay_method} />
                  <Row label="ערך יום חופשה" value={currentEmployee.leave_fixed_day_rate != null ? `₪${currentEmployee.leave_fixed_day_rate}` : '—'} />
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="mb-4 text-base font-semibold text-slate-900 text-end">מופעים מתוכננים</h3>
                  {instancesLoading ? <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />טוען מופעים...</div> : upcomingInstances.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-500">אין מופעים מתוכננים בטווח שנבדק.</div> : (
                    <div className="space-y-3">
                      {upcomingInstances.map((instance) => <div key={instance.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-end"><div className="text-sm font-semibold text-slate-900">{instance.participants?.[0]?.student?.full_name || 'ללא תלמיד'}</div><div className="text-xs text-slate-500">{instance.service?.service_name || services.find((service) => service.id === instance.service_id)?.service_name || 'שירות'} • {formatDate(instance.datetime_start, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</div></div>)}
                    </div>
                  )}
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="mb-4 text-base font-semibold text-slate-900 text-end">מופעים שהושלמו ופיננסים</h3>
                  {completedInstances.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-500">אין מופעים שהושלמו בטווח שנבדק.</div> : (
                    <div className="space-y-3">
                      {completedInstances.map((instance) => <div key={instance.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-end"><div className="text-sm font-semibold text-slate-900">{instance.participants?.[0]?.student?.full_name || 'ללא תלמיד'}</div><div className="text-xs text-slate-500">{instance.service?.service_name || services.find((service) => service.id === instance.service_id)?.service_name || 'שירות'} • {formatDate(instance.datetime_start, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</div></div>)}
                    </div>
                  )}
                  <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-500">שכבת דוחות שכר וייצוא לרו״ח תתווסף בשלב הבא על בסיס `RateHistory`, `WorkSessions` ו-`LeaveBalances`.</div>
                </section>
              </div>
            </>
          )}
        </div>
      </div>

      <EmployeeWizardDialog open={showWizard} onOpenChange={setShowWizard} orgId={orgId} session={session} onSuccess={async () => { await refetchInstructors(); await fetchOverviewInstances(); }} />
      <EditEmployeeDialog open={showEditDialog} onOpenChange={setShowEditDialog} employee={selectedEmployee} orgId={orgId} session={session} onSaved={async () => { await refetchInstructors(); await fetchOverviewInstances(); }} />
    </div>
  );
}
