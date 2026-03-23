import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar.jsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Loader2, Mail, MailPlus, MessageCircle, Phone,
  Search, Settings, UserPlus, UserX, RotateCcw,
  FileText, Calendar,
} from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '@/lib/api-client';
import { useInstructors, useServices } from '@/hooks/useOrgData.js';
import { cn } from '@/lib/utils';
import EmployeeWizardDialog from './EmployeeWizardDialog.jsx';
import EditEmployeeDialog from './EditEmployeeDialog.jsx';

/* ── helpers (unchanged) ────────────────────────────────── */

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

/* ── tiny sub-components ────────────────────────────────── */

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2.5 last:border-b-0">
      <div className="shrink-0 text-xs font-medium text-slate-500">{label}</div>
      <div className="min-w-0 flex-1 text-sm text-slate-900">{value || '—'}</div>
    </div>
  );
}

function StatCard({ value, label }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <div className="text-2xl font-extrabold text-slate-900">{value}</div>
      <div className="mt-1 text-[13px] text-slate-500">{label}</div>
    </div>
  );
}

const FILTER_ALL = 'all';
const FILTER_INSTRUCTORS = 'instructor';
const FILTER_OFFICE = 'office';
const FILTER_NO_USER = 'no-user';

const FILTERS = [
  { key: FILTER_ALL, label: 'הכל' },
  { key: FILTER_INSTRUCTORS, label: 'מדריכים' },
  { key: FILTER_OFFICE, label: 'משרד' },
  { key: FILTER_NO_USER, label: 'ללא משתמש' },
];

/* ════════════════════════════════════════════════════════
   UnifiedEmployeeList  –  Option A directory + workspace
   ════════════════════════════════════════════════════════ */

export default function UnifiedEmployeeList({ session, orgId, canLoad }) {
  const sessionAccessToken = session?.access_token || null;
  const authSession = useMemo(() => (sessionAccessToken ? { access_token: sessionAccessToken } : null), [sessionAccessToken]);

  /* state --------------------------------------------------------- */
  const [showWizard, setShowWizard] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterKey, setFilterKey] = useState(FILTER_ALL);
  const [actionState, setActionState] = useState(REQUEST.idle);
  const [overviewInstances, setOverviewInstances] = useState([]);
  const [employeeInstances, setEmployeeInstances] = useState([]);
  const [instancesLoading, setInstancesLoading] = useState(false);

  /* data ---------------------------------------------------------- */
  const { instructors, unlinkedMembers, loadingInstructors, instructorsError, refetchInstructors } = useInstructors({
    includeInactive: true,
    includeUnlinked: true,
    orgId,
    session,
    enabled: canLoad,
  });
  const { services } = useServices({ enabled: canLoad, orgId, session });

  /* filtering ----------------------------------------------------- */
  const filteredEmployees = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return instructors
      .filter((e) => showInactive || e.is_active)
      .filter((e) => {
        if (filterKey === FILTER_INSTRUCTORS) return getEmployeeType(e) === 'instructor';
        if (filterKey === FILTER_OFFICE) return getEmployeeType(e) === 'office';
        if (filterKey === FILTER_NO_USER) return !e.user_id;
        return true;
      })
      .filter((e) => {
        if (!query) return true;
        return [getEmployeeName(e), e.email, e.phone, e.employee_id]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query);
      });
  }, [instructors, searchTerm, showInactive, filterKey]);

  const currentEmployee = useMemo(() => {
    if (!filteredEmployees.length) return null;
    return filteredEmployees.find((e) => e.id === selectedEmployeeId) || filteredEmployees[0];
  }, [filteredEmployees, selectedEmployeeId]);

  useEffect(() => {
    if (currentEmployee?.id && currentEmployee.id !== selectedEmployeeId) {
      setSelectedEmployeeId(currentEmployee.id);
    }
  }, [currentEmployee, selectedEmployeeId]);

  /* fetch calendar instances (overview + per-employee) ------------ */
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

  /* derived ------------------------------------------------------- */
  const summary = useMemo(() => ({
    activeEmployees: instructors.filter((e) => e.is_active).length,
    missingUser: instructors.filter((e) => e.is_active && !e.user_id).length,
    missingDetails: instructors.filter((e) => !e.phone || !e.start_date).length,
    upcomingLessons: overviewInstances.filter((i) => i.status === 'scheduled').length,
  }), [instructors, overviewInstances]);

  const upcomingInstances = useMemo(() => employeeInstances.filter((i) => i.status === 'scheduled').slice(0, 6), [employeeInstances]);
  const completedInstances = useMemo(() => employeeInstances.filter((i) => i.status === 'completed').slice(0, 6), [employeeInstances]);

  const employeeActivities = useMemo(() => {
    const map = new Map();
    overviewInstances.forEach((inst) => {
      const current = map.get(inst.instructor_employee_id) || { scheduled: 0, completed: 0 };
      if (inst.status === 'scheduled') current.scheduled += 1;
      if (inst.status === 'completed') current.completed += 1;
      map.set(inst.instructor_employee_id, current);
    });
    return map;
  }, [overviewInstances]);

  /* actions ------------------------------------------------------- */
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

  /* ── guard states ──────────────────────────────────────── */
  if (!canLoad) {
    return <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600">נדרש חיבור Supabase פעיל כדי לנהל עובדים.</div>;
  }
  if (loadingInstructors && instructors.length === 0) {
    return <div className="flex items-center justify-center gap-3 rounded-3xl border border-slate-200 bg-white p-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /><span className="text-sm text-slate-600">טוען עובדים...</span></div>;
  }
  if (instructorsError) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{instructorsError}</div>;
  }

  /* ═══════════════════════════════════════════════════════
     RENDER  –  Option A: directory sidebar + workspace
     ═══════════════════════════════════════════════════════ */
  return (
    <div className="space-y-4">
      {/* ── Page header + toolbar ──────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-950 sm:text-2xl">עובדים</h1>
          <p className="text-sm text-slate-500">רוסטר ארגוני + סביבת עבודה לעובד</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setShowWizard(true)} size="sm">
            <UserPlus className="me-2 h-4 w-4" />עובד חדש
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowInactive((prev) => !prev)}>
            {showInactive ? 'הסתר מושבתים' : 'הצג מושבתים'}
          </Button>
        </div>
      </div>

      {/* ── Master-detail grid ─────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)]">

        {/* ════ SIDEBAR ════ */}
        <aside className="rounded-[1.5rem] border border-slate-200 bg-blue-50/30 shadow-sm lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-hidden lg:flex lg:flex-col">
          <div className="p-4 space-y-3">
            {/* search */}
            <div className="relative">
              <Search className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="חיפוש עובד, טלפון, תפקיד..."
                className="pe-9 bg-white"
              />
            </div>

            {/* filter pills */}
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilterKey(f.key)}
                  className={cn(
                    'rounded-xl border px-3 py-1.5 text-xs font-bold transition',
                    filterKey === f.key
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* employee rows (scrollable on desktop) */}
          <div className="px-4 pb-4 space-y-2 lg:overflow-y-auto lg:flex-1 lg:min-h-0">
            {filteredEmployees.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 p-4 text-center text-sm text-slate-500">
                לא נמצאו עובדים.
              </div>
            )}
            {filteredEmployees.map((employee) => {
              const isSelected = employee.id === (currentEmployee?.id ?? null);
              const activity = employeeActivities.get(employee.id);
              const typeLabel = getEmployeeTypeLabel(employee);
              const statusParts = [typeLabel];
              if (employee.user_id) statusParts.push('משתמש מחובר');
              if (!employee.is_active) statusParts.push('מושבת');
              else statusParts.push('פעיל');

              return (
                <button
                  key={employee.id}
                  type="button"
                  onClick={() => setSelectedEmployeeId(employee.id)}
                  className={cn(
                    'w-full rounded-2xl border p-3.5 text-start transition',
                    isSelected
                      ? 'border-blue-300/60 bg-gradient-to-b from-white to-blue-50/40 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.25)]'
                      : 'border-slate-200 bg-white hover:border-slate-300 shadow-sm',
                  )}
                >
                  <div className="font-extrabold text-sm text-slate-900">{getEmployeeName(employee)}</div>
                  <div className="mt-0.5 text-[13px] text-slate-500">{statusParts.join(' • ')}</div>

                  {/* chips row */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(employee.service_capabilities || []).slice(0, 2).map((cap) => {
                      const svc = services.find((s) => s.id === cap.service_id);
                      return svc ? (
                        <span key={cap.service_id} className="rounded-full bg-blue-100/80 px-2.5 py-0.5 text-[11px] font-bold text-blue-700">
                          {svc.service_name}
                        </span>
                      ) : null;
                    })}
                    {activity && activity.scheduled > 0 && (
                      <span className="rounded-full bg-green-100/80 px-2.5 py-0.5 text-[11px] font-bold text-green-700">
                        היום {activity.scheduled} שיעורים
                      </span>
                    )}
                    {!employee.user_id && (
                      <span className="rounded-full bg-amber-100/80 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">
                        צריך הזמנה
                      </span>
                    )}
                    {!employee.is_active && (
                      <span className="rounded-full bg-red-100/80 px-2.5 py-0.5 text-[11px] font-bold text-red-700">
                        מושבת
                      </span>
                    )}
                  </div>
                </button>
              );
            })}

            {/* unlinked members banner */}
            {unlinkedMembers.length > 0 && (
              <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="text-xs font-bold text-amber-900">{unlinkedMembers.length} חברי ארגון ללא כרטיס עובד</div>
                <div className="mt-2 space-y-1.5">
                  {unlinkedMembers.slice(0, 3).map((member) => (
                    <div key={member.user_id} className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-white/70 px-3 py-1.5">
                      <Button size="sm" variant="outline" onClick={() => handleCreateEmployeeForMember(member)} disabled={actionState === REQUEST.loading}>
                        <UserPlus className="me-1.5 h-3.5 w-3.5" />צור
                      </Button>
                      <div className="min-w-0 flex-1 text-end">
                        <div className="truncate text-xs font-medium text-slate-900">{member.profile?.full_name || member.profile?.email || member.user_id}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* ════ WORKSPACE ════ */}
        <div className="min-w-0 space-y-5">
          {!currentEmployee ? (
            <div className="flex min-h-[50vh] items-center justify-center rounded-[1.5rem] border border-dashed border-slate-200 bg-white p-10">
              <p className="text-sm text-slate-500">בחר עובד מהרשימה כדי לצפות בפרטים.</p>
            </div>
          ) : (
            <>
              {/* ── Hero card ─────────────────────── */}
              <section className="rounded-[1.5rem] border border-slate-200 bg-gradient-to-bl from-white to-blue-50/30 p-5 shadow-sm sm:p-6">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="flex items-start gap-4">
                    <Avatar className="h-[68px] w-[68px] rounded-2xl">
                      <AvatarFallback className="rounded-2xl bg-gradient-to-br from-blue-500 to-blue-400 text-xl font-extrabold text-white">
                        {getInitials(currentEmployee)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        <Badge variant="default">{getEmployeeTypeLabel(currentEmployee)}</Badge>
                        <Badge variant={currentEmployee.is_active ? 'default' : 'secondary'}>{currentEmployee.is_active ? 'פעיל' : 'מושבת'}</Badge>
                        {currentEmployee.user_id ? <Badge variant="outline">משתמש מחובר</Badge> : null}
                      </div>
                      <h2 className="text-2xl font-extrabold text-slate-950 sm:text-[32px] leading-tight">{getEmployeeName(currentEmployee)}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {currentEmployee.phone || ''}{currentEmployee.phone && currentEmployee.email ? ' • ' : ''}{currentEmployee.email || ''}{(currentEmployee.phone || currentEmployee.email) && currentEmployee.start_date ? ' • ' : ''}{currentEmployee.start_date ? `התחלה: ${formatDate(currentEmployee.start_date)}` : ''}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {currentEmployee.employee_id && (
                          <span className="rounded-full bg-blue-100/80 px-2.5 py-0.5 text-[11px] font-bold text-blue-700">
                            עובד #{currentEmployee.employee_id}
                          </span>
                        )}
                        {(currentEmployee.service_capabilities || []).map((cap) => {
                          const svc = services.find((s) => s.id === cap.service_id);
                          return svc ? (
                            <span key={cap.service_id} className="rounded-full bg-blue-100/80 px-2.5 py-0.5 text-[11px] font-bold text-blue-700">
                              {svc.service_name}
                            </span>
                          ) : null;
                        })}
                      </div>
                    </div>
                  </div>

                  {/* quick actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => { setSelectedEmployee(currentEmployee); setShowEditDialog(true); }}>
                      <Settings className="me-2 h-4 w-4" />עריכת פרטים
                    </Button>
                    {currentEmployee.phone ? (
                      <Button size="sm" variant="outline" onClick={() => window.open(getWhatsAppLink(currentEmployee), '_blank', 'noopener,noreferrer')}>
                        <MessageCircle className="me-2 h-4 w-4" />WhatsApp
                      </Button>
                    ) : null}
                    {!currentEmployee.user_id ? (
                      <Button size="sm" variant="outline" onClick={() => handleLinkUser(currentEmployee)} disabled={actionState === REQUEST.loading}>
                        <MailPlus className="me-2 h-4 w-4" />הזמן משתמש
                      </Button>
                    ) : null}
                    {currentEmployee.is_active ? (
                      <Button size="sm" variant="outline" onClick={() => handleToggleActive(currentEmployee, false)} disabled={actionState === REQUEST.loading}>
                        <UserX className="me-2 h-4 w-4 text-red-600" />השבת
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => handleToggleActive(currentEmployee, true)} disabled={actionState === REQUEST.loading}>
                        <RotateCcw className="me-2 h-4 w-4 text-green-600" />הפעל מחדש
                      </Button>
                    )}
                  </div>
                </div>
              </section>

              {/* ── Stats row ─────────────────────── */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard value={employeeActivities.get(currentEmployee.id)?.scheduled ?? 0} label="שיעורים היום" />
                <StatCard value={upcomingInstances.length} label="מופעים מתוכננים" />
                <StatCard value={completedInstances.length} label="מופעים שהושלמו" />
                <StatCard value={summary.missingDetails > 0 ? summary.missingDetails : '—'} label="חוסרים בפרטים" />
              </div>

              {/* ── Two-column detail panels ──────── */}
              <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
                {/* LEFT column */}
                <div className="space-y-5">
                  {/* Employee details */}
                  <section className="rounded-[1.25rem] border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="mb-3 text-lg font-extrabold text-slate-900">פרטי עובד וניהול משתמש</h3>
                    <div className="space-y-0">
                      <Row label="שם מלא" value={getEmployeeName(currentEmployee)} />
                      <Row label="טלפון" value={currentEmployee.phone} />
                      <Row label="דוא״ל" value={currentEmployee.email} />
                      <Row label="קישור משתמש" value={currentEmployee.user_id ? 'מחובר לחשבון פעיל' : 'ללא משתמש מקושר'} />
                      <Row label="תאריך התחלה" value={formatDate(currentEmployee.start_date)} />
                      <Row label="סוג עובד" value={getEmployeeTypeLabel(currentEmployee)} />
                      <Row label="מספר עובד" value={currentEmployee.employee_id} />
                      <Row label="היקף העסקה" value={currentEmployee.employment_scope} />
                      <Row label="תעריף נוכחי" value={currentEmployee.current_rate != null ? `₪${currentEmployee.current_rate}` : '—'} />
                      <Row label="הערות" value={currentEmployee.notes} />
                    </div>
                  </section>

                  {/* Leave & absence */}
                  <section className="rounded-[1.25rem] border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="mb-3 text-lg font-extrabold text-slate-900">חופשות והיעדרויות</h3>
                    <Row label="ימי חופשה שנתיים" value={currentEmployee.annual_leave_days != null ? `${currentEmployee.annual_leave_days}` : '—'} />
                    <Row label="שיטת תשלום חופשה" value={currentEmployee.leave_pay_method} />
                    <Row label="ערך יום חופשה" value={currentEmployee.leave_fixed_day_rate != null ? `₪${currentEmployee.leave_fixed_day_rate}` : '—'} />
                    <div className="mt-4 rounded-2xl border border-amber-200/80 bg-amber-50/60 px-4 py-3 text-[13px] text-amber-800">
                      כאן כדאי להוסיף בעתיד גם יתרות חופשה, אישורים ומסמכים.
                    </div>
                  </section>

                  {/* Scheduled lessons */}
                  <section className="rounded-[1.25rem] border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="mb-3 text-lg font-extrabold text-slate-900">שיעורים מתוזמנים</h3>
                    {instancesLoading ? (
                      <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />טוען מופעים...</div>
                    ) : upcomingInstances.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-500">אין מופעים מתוכננים.</div>
                    ) : (
                      <div className="space-y-2">
                        {upcomingInstances.map((inst) => (
                          <div key={inst.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3">
                            <span className="text-xs text-slate-500">פתח שיעור</span>
                            <div className="min-w-0 flex-1 text-end">
                              <div className="text-sm font-bold text-slate-900">
                                {formatDate(inst.datetime_start, { hour: '2-digit', minute: '2-digit' })}
                              </div>
                              <div className="text-xs text-slate-500">
                                {inst.participants?.[0]?.student?.full_name || 'ללא תלמיד'} • {inst.service?.service_name || services.find((s) => s.id === inst.service_id)?.service_name || 'שירות'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                {/* RIGHT column */}
                <div className="space-y-5">
                  {/* Quick communication */}
                  <section className="rounded-[1.25rem] border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="mb-3 text-lg font-extrabold text-slate-900">תקשורת מהירה</h3>
                    {currentEmployee.phone ? (
                      <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 mb-2">
                        <Button size="sm" variant="outline" onClick={() => window.open(getWhatsAppLink(currentEmployee), '_blank', 'noopener,noreferrer')}>
                          שלח
                        </Button>
                        <div className="min-w-0 flex-1 text-end">
                          <div className="text-sm font-bold text-slate-900">WhatsApp</div>
                          <div className="text-xs text-slate-500">שלח הודעה מהירה</div>
                        </div>
                      </div>
                    ) : null}
                    {currentEmployee.phone ? (
                      <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 mb-2">
                        <Button size="sm" variant="outline" asChild>
                          <a href={`tel:${currentEmployee.phone}`}>התקשר</a>
                        </Button>
                        <div className="min-w-0 flex-1 text-end">
                          <div className="text-sm font-bold text-slate-900">טלפון</div>
                          <div className="text-xs text-slate-500">{currentEmployee.phone}</div>
                        </div>
                      </div>
                    ) : null}
                    {currentEmployee.email ? (
                      <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3">
                        <Button size="sm" variant="outline" asChild>
                          <a href={`mailto:${currentEmployee.email}`}>פתח</a>
                        </Button>
                        <div className="min-w-0 flex-1 text-end">
                          <div className="text-sm font-bold text-slate-900">דוא״ל</div>
                          <div className="text-xs text-slate-500">{currentEmployee.email}</div>
                        </div>
                      </div>
                    ) : null}
                    {!currentEmployee.phone && !currentEmployee.email ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-500">אין פרטי קשר.</div>
                    ) : null}
                  </section>

                  {/* Completed lessons & finances */}
                  <section className="rounded-[1.25rem] border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="mb-3 text-lg font-extrabold text-slate-900">פיננסים ודיווחים</h3>
                    {completedInstances.length > 0 ? (
                      <div className="space-y-2 mb-4">
                        {completedInstances.slice(0, 3).map((inst) => (
                          <div key={inst.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3">
                            <span className="text-xs text-slate-500">פתח</span>
                            <div className="min-w-0 flex-1 text-end">
                              <div className="text-sm font-bold text-slate-900">
                                {inst.participants?.[0]?.student?.full_name || 'שיעור'}
                              </div>
                              <div className="text-xs text-slate-500">
                                {inst.service?.service_name || services.find((s) => s.id === inst.service_id)?.service_name || 'שירות'} • {formatDate(inst.datetime_start, { day: 'numeric', month: 'numeric' })}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="rounded-2xl border border-amber-200/80 bg-amber-50/60 px-4 py-3 text-[13px] text-amber-800">
                      כאן נכון לשלב בעתיד דוח תשלומים, שעות, ביטולים, no-show וחריגים לחשבונאות.
                    </div>
                  </section>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Dialogs ────────────────────────────────────────── */}
      <EmployeeWizardDialog open={showWizard} onOpenChange={setShowWizard} orgId={orgId} session={session} onSuccess={async () => { await refetchInstructors(); await fetchOverviewInstances(); }} />
      <EditEmployeeDialog open={showEditDialog} onOpenChange={setShowEditDialog} employee={selectedEmployee} orgId={orgId} session={session} onSaved={async () => { await refetchInstructors(); await fetchOverviewInstances(); }} />
    </div>
  );
}
