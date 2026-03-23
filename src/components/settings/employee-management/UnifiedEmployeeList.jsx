import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar.jsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Mail, MailPlus, MessageCircle, Phone, Search, Settings, UserPlus, UserX, RotateCcw, FileText, CalendarDays } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '@/lib/api-client';
import { useInstructors, useServices } from '@/hooks/useOrgData.js';
import { cn } from '@/lib/utils';
import EmployeeWizardDialog from './EmployeeWizardDialog.jsx';
import EditEmployeeDialog from './EditEmployeeDialog.jsx';

const REQUEST = { idle: 'idle', loading: 'loading' };
const DIRECTORY_FILTERS = { all: 'הכל', instructor: 'מדריכים', office: 'משרד', no_user: 'ללא משתמש' };

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

function formatCurrency(value) {
  if (value == null || value === '') return '—';
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(Number(value));
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

function DetailRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-slate-100 py-3 last:border-b-0">
      <div className="shrink-0 text-sm font-medium text-slate-900">{label}</div>
      <div className="min-w-0 flex-1 text-sm text-slate-600">{value || '—'}</div>
    </div>
  );
}

function MetricCard({ value, label, tone = 'default' }) {
  return (
    <div className={cn('rounded-[1.6rem] border px-5 py-5 shadow-sm', tone === 'primary' && 'border-blue-200 bg-blue-50/70', tone === 'warning' && 'border-amber-200 bg-amber-50/80', tone === 'default' && 'border-slate-200 bg-white')}>
      <div className="text-3xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}

function SectionCard({ title, subtitle, children, className }) {
  return (
    <section className={cn('rounded-[1.8rem] border border-slate-200 bg-white p-5 shadow-sm', className)}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function InstanceList({ instances, services, emptyMessage }) {
  if (!instances.length) return <div className="rounded-[1.3rem] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-5 text-sm text-slate-500">{emptyMessage}</div>;
  return (
    <div className="space-y-3">
      {instances.map((instance) => (
        <div key={instance.id} className="rounded-[1.3rem] border border-slate-200 bg-slate-50/60 px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="shrink-0 text-sm font-medium text-blue-700">{formatDate(instance.datetime_start, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-900">{instance.participants?.[0]?.student?.full_name || 'ללא תלמיד'}</div>
              <div className="mt-1 text-xs text-slate-500">{instance.service?.service_name || services.find((service) => service.id === instance.service_id)?.service_name || 'שירות'}</div>
            </div>
          </div>
        </div>
      ))}
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
  const [directoryFilter, setDirectoryFilter] = useState('all');
  const [actionState, setActionState] = useState(REQUEST.idle);
  const [overviewInstances, setOverviewInstances] = useState([]);
  const [employeeInstances, setEmployeeInstances] = useState([]);
  const [instancesLoading, setInstancesLoading] = useState(false);

  const { instructors, unlinkedMembers, loadingInstructors, instructorsError, refetchInstructors } = useInstructors({ includeInactive: true, includeUnlinked: true, orgId, session, enabled: canLoad });
  const { services } = useServices({ enabled: canLoad, orgId, session });

  const filteredEmployees = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return instructors.filter((employee) => showInactive || employee.is_active).filter((employee) => {
      if (directoryFilter === 'instructor') return getEmployeeType(employee) === 'instructor';
      if (directoryFilter === 'office') return getEmployeeType(employee) === 'office';
      if (directoryFilter === 'no_user') return !employee.user_id;
      return true;
    }).filter((employee) => {
      if (!query) return true;
      return [getEmployeeName(employee), employee.email, employee.phone, employee.employee_id].filter(Boolean).join(' ').toLowerCase().includes(query);
    });
  }, [directoryFilter, instructors, searchTerm, showInactive]);

  const currentEmployee = useMemo(() => {
    if (!filteredEmployees.length) return null;
    return filteredEmployees.find((employee) => employee.id === selectedEmployeeId) || filteredEmployees[0];
  }, [filteredEmployees, selectedEmployeeId]);

  useEffect(() => {
    if (currentEmployee?.id && currentEmployee.id !== selectedEmployeeId) setSelectedEmployeeId(currentEmployee.id);
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

  useEffect(() => { void fetchOverviewInstances(); }, [fetchOverviewInstances]);

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

  const currentActivity = useMemo(() => employeeActivities.get(currentEmployee?.id) || { scheduled: 0, completed: 0 }, [currentEmployee?.id, employeeActivities]);
  const currentServices = useMemo(() => {
    if (!currentEmployee) return [];
    return (currentEmployee.service_capabilities || []).map((capability) => services.find((service) => service.id === capability.service_id)?.service_name).filter(Boolean).slice(0, 4);
  }, [currentEmployee, services]);
  const upcomingInstances = useMemo(() => employeeInstances.filter((instance) => instance.status === 'scheduled').slice(0, 8), [employeeInstances]);
  const completedInstances = useMemo(() => employeeInstances.filter((instance) => instance.status === 'completed').slice(0, 8), [employeeInstances]);

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
      await authenticatedFetch('instructors', { session, method: 'POST', body: { org_id: orgId, user_id: member.user_id, employee_id: member.user_id, employee_type: 'office', first_name: parts[0] || member?.profile?.email || 'משתמש', last_name: parts.length > 1 ? parts.slice(1).join(' ') : '', email: member?.profile?.email || undefined } });
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
      if (nextIsActive) await authenticatedFetch('instructors', { session, method: 'PUT', body: { org_id: orgId, instructor_id: employee.id, is_active: true } });
      else await authenticatedFetch('instructors', { session, method: 'DELETE', body: { org_id: orgId, instructor_id: employee.id } });
      toast.success(nextIsActive ? 'העובד הופעל מחדש.' : 'העובד הושבת.');
      await refetchInstructors();
    } catch (error) {
      console.error('Failed to update employee active state', error);
      toast.error('עדכון סטטוס העובד נכשל.');
    } finally {
      setActionState(REQUEST.idle);
    }
  };

  if (!canLoad) return <div className="rounded-[1.8rem] border border-slate-200 bg-white p-6 text-sm text-slate-600">נדרש חיבור Supabase פעיל כדי לנהל עובדים.</div>;
  if (loadingInstructors && instructors.length === 0) return <div className="flex items-center justify-center gap-3 rounded-[1.8rem] border border-slate-200 bg-white p-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /><span className="text-sm text-slate-600">טוען עובדים...</span></div>;
  if (instructorsError) return <div className="rounded-[1.8rem] border border-red-200 bg-red-50 p-4 text-sm text-red-700">{instructorsError}</div>;

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 2xl:flex-row 2xl:items-start 2xl:justify-between">
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold text-slate-950">ניהול עובדים</h2>
            <p className="max-w-3xl text-sm text-slate-500">תמונת מצב רחבה של העובדים בארגון, חוסרים תפעוליים וכניסה ישירה לסביבת עבודה מלאה לכל עובד.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setShowWizard(true)} size="sm"><UserPlus className="me-2 h-4 w-4" />עובד חדש</Button>
            <Button variant="outline" size="sm" onClick={() => setShowInactive((prev) => !prev)}>{showInactive ? 'הסתר מושבתים' : 'הצג מושבתים'}</Button>
            <Button variant="outline" size="sm"><FileText className="me-2 h-4 w-4" />יצוא לרו״ח</Button>
          </div>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          <MetricCard value={summary.activeEmployees} label="עובדים פעילים" tone="primary" />
          <MetricCard value={summary.upcomingLessons} label="שיעורים מתוכננים השבוע" />
          <MetricCard value={summary.missingUser} label="ללא משתמש מקושר" tone={summary.missingUser ? 'warning' : 'default'} />
          <MetricCard value={summary.missingDetails} label="חוסרים בפרטים" tone={summary.missingDetails ? 'warning' : 'default'} />
        </div>
        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex items-center justify-between gap-4"><div className="text-sm font-medium text-slate-900">מוקדי תשומת לב</div><Badge variant="outline">{unlinkedMembers.length} ללא כרטיס</Badge></div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {filteredEmployees.slice(0, 4).map((employee) => {
                const activity = employeeActivities.get(employee.id) || { scheduled: 0, completed: 0 };
                return <button key={employee.id} type="button" onClick={() => setSelectedEmployeeId(employee.id)} className={cn('rounded-[1.4rem] border px-4 py-4 transition', selectedEmployeeId === employee.id ? 'border-blue-200 bg-blue-50/70' : 'border-slate-200 bg-white hover:border-slate-300')}><div className="flex items-start justify-between gap-4"><div className="flex items-center gap-3"><Avatar className="h-11 w-11"><AvatarFallback className="bg-blue-100 text-blue-700">{getInitials(employee)}</AvatarFallback></Avatar><div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-900">{getEmployeeName(employee)}</div><div className="truncate text-xs text-slate-500">{getEmployeeTypeLabel(employee)}</div></div></div><div className="shrink-0 text-xs text-slate-500">{activity.scheduled} מתוכננים</div></div></button>;
              })}
            </div>
          </div>
          <div className="rounded-[1.6rem] border border-amber-200 bg-amber-50/70 p-4">
            <div className="flex items-center justify-between gap-4"><div className="text-sm font-medium text-amber-900">חברי ארגון ללא כרטיס עובד</div><Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">{unlinkedMembers.length}</Badge></div>
            <div className="mt-2 text-sm text-amber-800">משתמשים שכבר קיימים בארגון אך עדיין לא משויכים לכרטיס עובד.</div>
            <div className="mt-4 space-y-3">
              {unlinkedMembers.length === 0 ? <div className="rounded-[1.2rem] border border-dashed border-amber-200 bg-white/70 px-4 py-4 text-sm text-amber-900">אין משתמשים שממתינים ליצירת כרטיס עובד.</div> : unlinkedMembers.slice(0, 3).map((member) => <div key={member.user_id} className="flex items-center justify-between gap-3 rounded-[1.2rem] border border-amber-200 bg-white/80 px-4 py-3"><Button size="sm" variant="outline" onClick={() => handleCreateEmployeeForMember(member)} disabled={actionState === REQUEST.loading}><UserPlus className="me-2 h-4 w-4" />צור עובד</Button><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-slate-900">{member.profile?.full_name || member.profile?.email || member.user_id}</div><div className="truncate text-xs text-slate-500">{member.profile?.email || 'ללא דוא״ל'}</div></div></div>)}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-6 xl:self-start">
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="text-base font-semibold text-slate-950">רשימת עובדים</div>
              <div className="relative"><Search className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="חיפוש לפי שם, דוא״ל, טלפון או מספר עובד" className="pe-9" /></div>
              <div className="flex flex-wrap gap-2">{Object.entries(DIRECTORY_FILTERS).map(([key, label]) => <Button key={key} type="button" size="sm" variant={directoryFilter === key ? 'default' : 'outline'} onClick={() => setDirectoryFilter(key)}>{label}</Button>)}</div>
            </div>
            <div className="space-y-3">
              {filteredEmployees.map((employee) => {
                const activity = employeeActivities.get(employee.id) || { scheduled: 0, completed: 0 };
                return <button key={employee.id} type="button" onClick={() => setSelectedEmployeeId(employee.id)} className={cn('w-full rounded-[1.6rem] border px-4 py-4 transition', selectedEmployeeId === employee.id ? 'border-blue-200 bg-blue-50/80 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300')}><div className="flex items-start justify-between gap-4"><Avatar className="h-12 w-12"><AvatarFallback className={employee.is_active ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'}>{getInitials(employee)}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-slate-900">{getEmployeeName(employee)}</div><div className="mt-1 truncate text-xs text-slate-500">{employee.email || employee.phone || employee.employee_id || 'ללא פרטי קשר'}</div><div className="mt-3 flex flex-wrap gap-2"><Badge variant={employee.is_active ? 'default' : 'secondary'}>{employee.is_active ? 'פעיל' : 'מושבת'}</Badge><Badge variant="outline">{getEmployeeTypeLabel(employee)}</Badge>{!employee.user_id ? <Badge variant="outline">ללא משתמש</Badge> : null}</div><div className="mt-3 text-xs text-slate-500">{activity.scheduled} מתוכננים • {activity.completed} הושלמו</div></div></div></button>;
              })}
              {filteredEmployees.length === 0 ? <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-sm text-slate-500">לא נמצאו עובדים תואמים לחיפוש או לסינון שנבחר.</div> : null}
            </div>
          </div>
        </aside>

        <div className="space-y-5">
          {!currentEmployee ? <div className="rounded-[2rem] border border-dashed border-slate-200 bg-white p-10 text-sm text-slate-500">בחר עובד כדי לפתוח סביבת עבודה מלאה.</div> : <>
            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[360px_minmax(0,1fr)]">
                <div className="rounded-[1.7rem] border border-slate-200 bg-slate-50/70 p-4">
                  <div className="text-sm font-medium text-slate-900">פעולות מהירות</div>
                  <div className="mt-4 grid gap-2">
                    {!currentEmployee.user_id ? <Button size="sm" variant="outline" onClick={() => handleLinkUser(currentEmployee)} disabled={actionState === REQUEST.loading}><MailPlus className="me-2 h-4 w-4" />הזמן משתמש</Button> : null}
                    {currentEmployee.phone ? <Button size="sm" variant="outline" onClick={() => window.open(getWhatsAppLink(currentEmployee), '_blank', 'noopener,noreferrer')}><MessageCircle className="me-2 h-4 w-4" />WhatsApp</Button> : null}
                    {currentEmployee.phone ? <Button size="sm" variant="outline" asChild><a href={`tel:${currentEmployee.phone}`}><Phone className="me-2 h-4 w-4" />התקשר</a></Button> : null}
                    {currentEmployee.email ? <Button size="sm" variant="outline" asChild><a href={`mailto:${currentEmployee.email}`}><Mail className="me-2 h-4 w-4" />דוא״ל</a></Button> : null}
                    <Button size="sm" variant="outline" onClick={() => { setSelectedEmployee(currentEmployee); setShowEditDialog(true); }}><Settings className="me-2 h-4 w-4" />עריכת פרטים</Button>
                    {currentEmployee.is_active ? <Button size="sm" variant="outline" onClick={() => handleToggleActive(currentEmployee, false)} disabled={actionState === REQUEST.loading}><UserX className="me-2 h-4 w-4 text-red-600" />השבת</Button> : <Button size="sm" variant="outline" onClick={() => handleToggleActive(currentEmployee, true)} disabled={actionState === REQUEST.loading}><RotateCcw className="me-2 h-4 w-4 text-green-600" />הפעל מחדש</Button>}
                  </div>
                </div>
                <div className="rounded-[1.7rem] border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-5">
                  <div className="flex items-start justify-between gap-6">
                    <Avatar className="h-20 w-20"><AvatarFallback className="bg-blue-100 text-xl font-semibold text-blue-700">{getInitials(currentEmployee)}</AvatarFallback></Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap gap-2"><Badge variant={currentEmployee.is_active ? 'default' : 'secondary'}>{currentEmployee.is_active ? 'פעיל' : 'מושבת'}</Badge><Badge variant="outline">{getEmployeeTypeLabel(currentEmployee)}</Badge>{!currentEmployee.user_id ? <Badge variant="outline">ללא משתמש</Badge> : <Badge variant="outline">משתמש מחובר</Badge>}</div>
                      <h2 className="mt-3 text-3xl font-semibold text-slate-950">{getEmployeeName(currentEmployee)}</h2>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-500"><span>{currentEmployee.phone || 'ללא טלפון'}</span><span>{currentEmployee.email || 'ללא דוא״ל'}</span><span>התחלה: {formatDate(currentEmployee.start_date)}</span></div>
                      <div className="mt-4 flex flex-wrap gap-2">{currentEmployee.employee_id ? <Badge variant="outline">עובד #{currentEmployee.employee_id}</Badge> : null}{currentServices.length > 0 ? currentServices.map((serviceName) => <Badge key={serviceName} variant="outline">{serviceName}</Badge>) : <Badge variant="outline">ללא שירותים משויכים</Badge>}</div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
              <MetricCard value={currentActivity.scheduled} label="שיעורים מתוכננים בשבוע הקרוב" tone="primary" />
              <MetricCard value={currentActivity.completed} label="שיעורים שהושלמו השבוע" />
              <MetricCard value={currentEmployee.annual_leave_days != null ? currentEmployee.annual_leave_days : '—'} label="ימי חופשה שנתיים" />
              <MetricCard value={currentEmployee.user_id ? 'מחובר' : 'ידני'} label="סטטוס משתמש" tone={!currentEmployee.user_id ? 'warning' : 'default'} />
            </div>

            <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
              <div className="space-y-5">
                <div className="grid gap-5 xl:grid-cols-2">
                  <SectionCard title="פרטי עובד וניהול משתמש" subtitle="נתוני הליבה של העובד, כפי שהם נדרשים לניהול השוטף.">
                    <DetailRow label="מספר עובד / תעודה" value={currentEmployee.employee_id} />
                    <DetailRow label="סוג עובד" value={getEmployeeTypeLabel(currentEmployee)} />
                    <DetailRow label="תאריך התחלה" value={formatDate(currentEmployee.start_date)} />
                    <DetailRow label="היקף העסקה" value={currentEmployee.employment_scope} />
                    <DetailRow label="תעריף נוכחי" value={formatCurrency(currentEmployee.current_rate)} />
                    <DetailRow label="הערות" value={currentEmployee.notes} />
                  </SectionCard>
                  <SectionCard title="תקשורת וחופשות" subtitle="פרטי קשר ונתוני מסגרת לחופשות ולניהול שוטף.">
                    <DetailRow label="דוא״ל" value={currentEmployee.email} />
                    <DetailRow label="טלפון" value={currentEmployee.phone} />
                    <DetailRow label="משתמש מקושר" value={currentEmployee.user_id ? 'כן' : 'לא'} />
                    <DetailRow label="ימי חופשה שנתיים" value={currentEmployee.annual_leave_days != null ? `${currentEmployee.annual_leave_days}` : '—'} />
                    <DetailRow label="שיטת תשלום חופשה" value={currentEmployee.leave_pay_method} />
                    <DetailRow label="ערך יום חופשה" value={formatCurrency(currentEmployee.leave_fixed_day_rate)} />
                  </SectionCard>
                </div>

                <SectionCard title="מופעים מתוכננים והושלמו" subtitle="הפעילות המשויכת לעובד בטווח של 30 יום אחורה ו-30 יום קדימה.">
                  {instancesLoading ? <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />טוען מופעים...</div> : <div className="grid gap-5 xl:grid-cols-2"><div><div className="mb-3 text-sm font-medium text-slate-900">מתוכננים</div><InstanceList instances={upcomingInstances} services={services} emptyMessage="אין מופעים מתוכננים בטווח שנבדק." /></div><div><div className="mb-3 text-sm font-medium text-slate-900">הושלמו</div><InstanceList instances={completedInstances} services={services} emptyMessage="אין מופעים שהושלמו בטווח שנבדק." /></div></div>}
                </SectionCard>
              </div>

              <div className="space-y-5">
                <SectionCard title="מרכז פעולות" subtitle="הפעולות המרכזיות שכנראה יידרשו עבורך לפני צלילה לפרטים.">
                  <div className="space-y-3">
                    <div className="rounded-[1.3rem] border border-slate-200 bg-slate-50/60 px-4 py-4"><div className="flex items-center justify-between gap-4"><CalendarDays className="h-4 w-4 text-blue-700" /><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-slate-900">שיעורים היום</div><div className="mt-1 text-xs text-slate-500">{currentActivity.scheduled} שיעורים מתוכננים לשבוע הקרוב</div></div></div></div>
                    <div className="rounded-[1.3rem] border border-slate-200 bg-slate-50/60 px-4 py-4"><div className="flex items-center justify-between gap-4"><MessageCircle className="h-4 w-4 text-green-700" /><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-slate-900">תקשורת מהירה</div><div className="mt-1 text-xs text-slate-500">{currentEmployee.phone ? 'אפשר לשלוח WhatsApp או לבצע חיוג מיידי.' : 'יש להוסיף מספר טלפון כדי לאפשר WhatsApp וטלפון.'}</div></div></div></div>
                    <div className="rounded-[1.3rem] border border-dashed border-slate-200 bg-slate-50/50 px-4 py-4 text-sm text-slate-500">שכבת דוחות שכר, שעות וייצוא לרו״ח תתווסף בשלב הבא על בסיס `RateHistory`, `WorkSessions` ו-`LeaveBalances`.</div>
                  </div>
                </SectionCard>
                <SectionCard title="כיסוי מנהלתי" subtitle="מצב עובד, גישה למערכת, שירותים וזיהוי של חוסרים מיידיים.">
                  <DetailRow label="סטטוס פעילות" value={currentEmployee.is_active ? 'פעיל' : 'מושבת'} />
                  <DetailRow label="קישור משתמש" value={currentEmployee.user_id ? 'מחובר לחשבון קיים' : 'ללא חשבון מחובר'} />
                  <DetailRow label="מספר שירותים" value={currentEmployee.service_capabilities?.length != null ? `${currentEmployee.service_capabilities.length}` : '0'} />
                  <DetailRow label="חוסרים עיקריים" value={!currentEmployee.phone || !currentEmployee.start_date ? 'חסר טלפון או תאריך התחלה' : 'אין חוסרים קריטיים'} />
                </SectionCard>
              </div>
            </div>
          </>}
        </div>
      </div>

      <EmployeeWizardDialog open={showWizard} onOpenChange={setShowWizard} orgId={orgId} session={session} onSuccess={async () => { await refetchInstructors(); await fetchOverviewInstances(); }} />
      <EditEmployeeDialog open={showEditDialog} onOpenChange={setShowEditDialog} employee={selectedEmployee} orgId={orgId} session={session} onSaved={async () => { await refetchInstructors(); await fetchOverviewInstances(); }} />
    </div>
  );
}
