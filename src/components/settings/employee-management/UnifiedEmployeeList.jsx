import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar.jsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import {
  Briefcase,
  Calendar,
  Clock,
  HelpCircle,
  Link2,
  Loader2,
  MailPlus,
  MessageCircle,
  Phone,
  RotateCcw,
  Search,
  Settings,
  Shield,
  UserPlus,
  UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '@/lib/api-client';
import { useInstructors, useServices } from '@/hooks/useOrgData.js';
import { cn } from '@/lib/utils';
import { useOrg } from '@/org/OrgContext.jsx';
import EmployeeWizardDialog from './EmployeeWizardDialog.jsx';
import EmployeeActivityTimeline from './EmployeeActivityTimeline.jsx';
import EmployeeAttendancePanel from './EmployeeAttendancePanel.jsx';
import EditEmployeeDialog from './EditEmployeeDialog.jsx';
import EditServiceCapabilitiesDialog from './EditServiceCapabilitiesDialog.jsx';
import EmployeeFinancePanel from './EmployeeFinancePanel.jsx';
import EmployeeLeavePanel from './EmployeeLeavePanel.jsx';
import LinkEmployeeMemberDialog from './LinkEmployeeMemberDialog.jsx';
import { getAvailabilitySummary } from '@/lib/instructor-availability.js';
import { buildCapabilityCompensationSummary } from '@/lib/instructor-compensation.js';

const REQUEST = { idle: 'idle', loading: 'loading' };
const TAB_KEYS = {
  overview: 'overview',
  schedule: 'schedule',
  attendance: 'attendance',
  finance: 'finance',
  leaves: 'leaves',
  documents: 'documents',
  activity: 'activity',
};

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

const DAY_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function toLocalDateString(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftDate(dateString, deltaDays) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + deltaDays);
  return toLocalDateString(date);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
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

function normalizeComparableValue(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function getLinkedProfileName(profile) {
  if (!profile) return '';
  return [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim() || profile.full_name || '';
}

function getEmployeeProfileDifferences(employee, profile) {
  if (!employee || !profile) return [];

  const differences = [];
  const employeeName = getEmployeeName(employee);
  const profileName = getLinkedProfileName(profile);
  if (normalizeComparableValue(employeeName) !== normalizeComparableValue(profileName)) {
    differences.push('name');
  }
  if (normalizeComparableValue(employee.phone) !== normalizeComparableValue(profile.phone)) {
    differences.push('phone');
  }
  if (normalizeComparableValue(employee.email) !== normalizeComparableValue(profile.email)) {
    differences.push('email');
  }

  return differences;
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

function getStudentName(instance) {
  const student = instance?.participants?.[0]?.student;
  if (!student) return 'ללא תלמיד';
  return [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(' ') || 'ללא תלמיד';
}

function getServiceName(services, serviceId, fallbackName) {
  return fallbackName || services.find((service) => service.id === serviceId)?.name || 'שירות';
}

function getWorkingDaysSummary(employee) {
  const workingDays = Array.isArray(employee?.working_days) ? employee.working_days : [];
  if (!Array.isArray(workingDays) || workingDays.length === 0) return 'לא הוגדרו ימי עבודה';
  return workingDays
    .slice()
    .sort((a, b) => a - b)
    .map((day) => DAY_LABELS[day] || day)
    .join(', ');
}

function getInstanceOutcomeStatus(instance) {
  if (instance?.status === 'no_show') return 'no_show';
  const hasParticipantNoShow = Array.isArray(instance?.participants)
    && instance.participants.some((participant) => participant?.participant_status === 'no_show');
  if (hasParticipantNoShow) return 'no_show';
  return instance?.status || '';
}

function groupInstancesByMonth(instances, descending = false) {
  const sorted = [...instances].sort((left, right) => {
    const leftTime = new Date(left.datetime_start).getTime();
    const rightTime = new Date(right.datetime_start).getTime();
    return descending ? rightTime - leftTime : leftTime - rightTime;
  });

  const groups = new Map();
  sorted.forEach((instance) => {
    const date = new Date(instance.datetime_start);
    if (Number.isNaN(date.getTime())) return;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' }).format(date),
        items: [],
      });
    }
    groups.get(key).items.push(instance);
  });

  return Array.from(groups.values()).sort((left, right) => (
    descending ? right.key.localeCompare(left.key) : left.key.localeCompare(right.key)
  ));
}

function Row({ label, value, muted = false }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-b-0">
      <div className="shrink-0 text-[12px] font-medium text-slate-500">{label}</div>
      <div className={cn('min-w-0 flex-1 text-[13px] text-slate-900', muted && 'text-slate-500')}>{value || '—'}</div>
    </div>
  );
}

function DenseStat({ label, value, accent = 'slate' }) {
  const accentClasses = {
    slate: 'border-slate-200 bg-white text-slate-900',
    blue: 'border-blue-200 bg-blue-50/70 text-blue-950',
    emerald: 'border-emerald-200 bg-emerald-50/70 text-emerald-950',
    amber: 'border-amber-200 bg-amber-50/70 text-amber-950',
  };

  return (
    <div className={cn('rounded-2xl border px-3 py-3 shadow-sm', accentClasses[accent] || accentClasses.slate)}>
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-extrabold leading-none">{value}</div>
    </div>
  );
}

function SectionCard({ title, description, action, children, className }) {
  return (
    <section className={cn('rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm', className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          {description ? <p className="mt-1 text-xs text-slate-500">{description}</p> : null}
        </div>
        {action || null}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ title, body }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-5 text-center">
      <div className="text-sm font-medium text-slate-700">{title}</div>
      <div className="mt-1 text-xs text-slate-500">{body}</div>
    </div>
  );
}

function LessonRow({ instance, services }) {
  const outcome = getInstanceOutcomeStatus(instance);
  const isNoShow = outcome === 'no_show';
  const statusLabel = isNoShow ? 'לא הגיע' : (instance.status === 'scheduled' ? 'מתוכנן' : 'בוצע');
  const statusClassName = isNoShow
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : instance.status === 'scheduled'
      ? 'border-blue-200 bg-blue-50 text-blue-800'
      : 'border-emerald-200 bg-emerald-50 text-emerald-800';

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900">{getStudentName(instance)}</div>
          <div className="mt-1 text-xs text-slate-500">
            {getServiceName(services, instance.service_id, instance.service?.name || instance.service?.service_name)} • {formatDate(instance.datetime_start, {
              weekday: 'short',
              day: 'numeric',
              month: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        </div>
        <span className={cn('rounded-full border px-2.5 py-1 text-[11px] font-bold', statusClassName)}>
          {statusLabel}
        </span>
      </div>
    </div>
  );
}

function MonthGroup({ groups, services, emptyTitle, emptyBody }) {
  if (groups.length === 0) {
    return <EmptyState title={emptyTitle} body={emptyBody} />;
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.key} className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">{group.label}</h4>
            <span className="text-[11px] text-slate-400">{group.items.length}</span>
          </div>
          <div className="space-y-2">
            {group.items.map((instance) => (
              <LessonRow key={instance.id} instance={instance} services={services} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function UnifiedEmployeeList({ session, orgId, canLoad }) {
  const { members, updateMemberRole, enableDirectory, disableDirectory } = useOrg();
  const sessionAccessToken = session?.access_token || null;
  const authSession = useMemo(() => (sessionAccessToken ? { access_token: sessionAccessToken } : null), [sessionAccessToken]);

  const [showWizard, setShowWizard] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showCapabilitiesDialog, setShowCapabilitiesDialog] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [inviteUserDialogOpen, setInviteUserDialogOpen] = useState(false);
  const [inviteUserEmployee, setInviteUserEmployee] = useState(null);
  const [inviteUserEmail, setInviteUserEmail] = useState('');
  const [inviteUserPendingConflict, setInviteUserPendingConflict] = useState(null);
  const [showRoleDialog, setShowRoleDialog] = useState(false);
  const [targetOrgRole, setTargetOrgRole] = useState('member');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterKey, setFilterKey] = useState(FILTER_ALL);
  const [activeTab, setActiveTab] = useState(TAB_KEYS.overview);
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

  useEffect(() => {
    if (!canLoad) return undefined;
    enableDirectory();
    return () => {
      disableDirectory();
    };
  }, [canLoad, disableDirectory, enableDirectory]);

  const filteredEmployees = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return instructors
      .filter((employee) => showInactive || employee.is_active)
      .filter((employee) => {
        if (filterKey === FILTER_INSTRUCTORS) return getEmployeeType(employee) === 'instructor';
        if (filterKey === FILTER_OFFICE) return getEmployeeType(employee) === 'office';
        if (filterKey === FILTER_NO_USER) return !employee.user_id;
        return true;
      })
      .filter((employee) => {
        if (!query) return true;
        return [getEmployeeName(employee), employee.email, employee.phone, employee.employee_id]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query);
      });
  }, [filterKey, instructors, searchTerm, showInactive]);

  const currentEmployee = useMemo(() => {
    if (!filteredEmployees.length) return null;
    return filteredEmployees.find((employee) => employee.id === selectedEmployeeId) || filteredEmployees[0];
  }, [filteredEmployees, selectedEmployeeId]);

  const membersByUserId = useMemo(() => {
    const map = new Map();
    (Array.isArray(members) ? members : []).forEach((member) => {
      if (member?.user_id) {
        map.set(member.user_id, member);
      }
    });
    return map;
  }, [members]);

  const currentEmployeeMembership = useMemo(() => {
    if (!currentEmployee?.user_id) return null;
    return membersByUserId.get(currentEmployee.user_id) || null;
  }, [currentEmployee, membersByUserId]);

  const currentEmployeeLinkedProfile = currentEmployeeMembership?.profile || null;
  const currentEmployeeProfileDifferences = useMemo(
    () => getEmployeeProfileDifferences(currentEmployee, currentEmployeeLinkedProfile),
    [currentEmployee, currentEmployeeLinkedProfile],
  );

  const currentEmployeeOrgRole = String(currentEmployeeMembership?.role || 'member').toLowerCase();
  const currentEmployeeRoleLabel = currentEmployeeOrgRole === 'owner'
    ? 'בעלים'
    : currentEmployeeOrgRole === 'admin'
      ? 'מנהל/ת ארגון'
      : 'חבר/ת ארגון';
  const canManageCurrentEmployeeRole = Boolean(currentEmployeeMembership?.id && currentEmployeeOrgRole !== 'owner');

  useEffect(() => {
    if (currentEmployee?.id && currentEmployee.id !== selectedEmployeeId) {
      setSelectedEmployeeId(currentEmployee.id);
    }
  }, [currentEmployee, selectedEmployeeId]);

  useEffect(() => {
    if (!showRoleDialog) return;
    setTargetOrgRole(currentEmployeeOrgRole === 'admin' ? 'admin' : 'member');
  }, [currentEmployeeOrgRole, showRoleDialog]);

  const openEmployeeEditor = useCallback((employee) => {
    setSelectedEmployee(employee);
    setShowEditDialog(true);
  }, []);

  const handleSyncFromLinkedProfile = useCallback(async () => {
    if (!currentEmployee?.id || !currentEmployeeLinkedProfile) return;

    setActionState(REQUEST.loading);
    try {
      await authenticatedFetch('instructors', {
        session,
        method: 'PUT',
        body: {
          org_id: orgId,
          instructor_id: currentEmployee.id,
          first_name: currentEmployeeLinkedProfile.first_name || currentEmployee.first_name || '',
          last_name: currentEmployeeLinkedProfile.last_name || currentEmployee.last_name || null,
          email: currentEmployeeLinkedProfile.email || null,
          phone: currentEmployeeLinkedProfile.phone || null,
        },
      });
      toast.success('פרטי העובד סונכרנו מפרופיל המשתמש.');
      await refetchInstructors();
      await fetchOverviewInstances();
    } catch (error) {
      console.error('Failed to sync employee from linked profile', error);
      toast.error(error?.message || 'סנכרון מפרופיל המשתמש נכשל.');
    } finally {
      setActionState(REQUEST.idle);
    }
  }, [currentEmployee, currentEmployeeLinkedProfile, fetchOverviewInstances, orgId, refetchInstructors, session]);

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
        const today = new Date();
        const startDate = toLocalDateString(startOfMonth(addMonths(today, -5)));
        const endDate = toLocalDateString(endOfMonth(addMonths(today, 2)));
        const payload = await authenticatedFetch(
          `calendar/instances?org_id=${orgId}&start_date=${startDate}&end_date=${endDate}&instructor_id=${currentEmployee.id}`,
          { session: authSession },
        );
        if (isActive) {
          setEmployeeInstances(Array.isArray(payload) ? payload : []);
        }
      } catch (error) {
        console.error('Failed to load employee instances', error);
        if (isActive) setEmployeeInstances([]);
      } finally {
        if (isActive) setInstancesLoading(false);
      }
    };

    void load();
    return () => {
      isActive = false;
    };
  }, [authSession, canLoad, currentEmployee, orgId]);

  const summary = useMemo(() => ({
    activeEmployees: instructors.filter((employee) => employee.is_active).length,
    missingUser: instructors.filter((employee) => employee.is_active && !employee.user_id).length,
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

  const todayStart = useMemo(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }, []);

  const upcomingInstances = useMemo(() => employeeInstances.filter((instance) => {
    if (instance.status !== 'scheduled') return false;
    const start = new Date(instance.datetime_start);
    return !Number.isNaN(start.getTime()) && start >= todayStart;
  }), [employeeInstances, todayStart]);

  const historyInstances = useMemo(() => employeeInstances.filter((instance) => {
    const outcome = getInstanceOutcomeStatus(instance);
    return outcome === 'completed' || outcome === 'no_show';
  }), [employeeInstances]);

  const upcomingMonthGroups = useMemo(() => groupInstancesByMonth(upcomingInstances, false), [upcomingInstances]);
  const historyMonthGroups = useMemo(() => groupInstancesByMonth(historyInstances, true), [historyInstances]);

  const currentEmployeeServices = useMemo(() => (
    (currentEmployee?.service_capabilities || []).map((capability) => ({
      ...capability,
      service: services.find((service) => service.id === capability.service_id) || null,
      name: getServiceName(services, capability.service_id),
      availabilitySummary: getAvailabilitySummary(capability.availability_windows),
      compensationSummary: buildCapabilityCompensationSummary(
        capability,
        services.find((service) => service.id === capability.service_id) || null,
      ),
    }))
  ), [currentEmployee, services]);

  const currentEmployeeMissingItems = useMemo(() => {
    if (!currentEmployee) return [];
    const items = [];
    if (!currentEmployee.phone) items.push('טלפון');
    if (!currentEmployee.email) items.push('דוא״ל');
    if (!currentEmployee.start_date) items.push('תאריך התחלה');
    if (!currentEmployee.employee_id) items.push('מספר עובד');
    return items;
  }, [currentEmployee]);

  const currentEmployeeMissingCount = useMemo(() => currentEmployeeMissingItems.length, [currentEmployeeMissingItems]);

  const currentEmployeeSetupIncomplete = Boolean(currentEmployee?.setup_incomplete);

  const handleLinkUser = useCallback((employee) => {
    setInviteUserEmployee(employee);
    setInviteUserEmail(employee?.email || '');
    setInviteUserPendingConflict(null);
    setInviteUserDialogOpen(true);
  }, []);

  const handleInviteUserSubmit = useCallback(async ({ resendPending = false } = {}) => {
    if (!inviteUserEmployee?.id || !inviteUserEmail.trim()) return;
    setActionState(REQUEST.loading);
    try {
      const result = await authenticatedFetch('instructors-link-user', {
        session,
        method: 'POST',
        body: {
          org_id: orgId,
          instructor_id: inviteUserEmployee.id,
          email: inviteUserEmail.trim(),
          resend_pending: resendPending,
        },
      });
      if (result?.user_exists) {
        toast.success(resendPending
          ? 'ההזמנה חודשה. למשתמש כבר יש חשבון והוא יכול להתחבר כדי לאשר את ההזמנה.'
          : 'ההזמנה נוצרה. למשתמש כבר יש חשבון והוא יכול להתחבר כדי לאשר את ההזמנה.');
      } else {
        toast.success(resendPending ? 'ההזמנה נשלחה מחדש בהצלחה.' : 'ההזמנה נשלחה בהצלחה.');
      }
      setInviteUserPendingConflict(null);
      setInviteUserDialogOpen(false);
      setInviteUserEmployee(null);
      setInviteUserEmail('');
      await refetchInstructors();
    } catch (error) {
      console.error('Failed to link user', error);
      if (error?.message === 'invitation_already_pending') {
        setInviteUserPendingConflict({
          email: inviteUserEmail.trim(),
          expiresAt: error?.data?.expires_at || null,
        });
      } else {
        toast.error(error?.message || 'שליחת ההזמנה נכשלה.');
      }
    } finally {
      setActionState(REQUEST.idle);
    }
  }, [inviteUserEmail, inviteUserEmployee, orgId, refetchInstructors, session]);

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

  const handleLinkDialogSuccess = async () => {
    await refetchInstructors();
  };

  const handleToggleActive = async (employee, nextIsActive) => {
    setActionState(REQUEST.loading);
    try {
      if (nextIsActive) {
        await authenticatedFetch('instructors', {
          session,
          method: 'PUT',
          body: { org_id: orgId, instructor_id: employee.id, is_active: true },
        });
      } else {
        await authenticatedFetch('instructors', {
          session,
          method: 'DELETE',
          body: { org_id: orgId, instructor_id: employee.id },
        });
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

  const handleSaveOrgRole = useCallback(async () => {
    if (!currentEmployeeMembership?.id) return;
    if (targetOrgRole === currentEmployeeOrgRole) {
      setShowRoleDialog(false);
      return;
    }

    setActionState(REQUEST.loading);
    try {
      await updateMemberRole(currentEmployeeMembership.id, targetOrgRole);
      toast.success(targetOrgRole === 'admin' ? 'העובד קודם למנהל ארגון.' : 'הרשאת המנהל הוסרה.');
      setShowRoleDialog(false);
    } catch (error) {
      console.error('Failed to update employee org role', error);
      toast.error(error?.message || 'עדכון הרשאת הארגון נכשל.');
    } finally {
      setActionState(REQUEST.idle);
    }
  }, [currentEmployeeMembership, currentEmployeeOrgRole, targetOrgRole, updateMemberRole]);

  if (!canLoad) {
    return <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600">נדרש חיבור Supabase פעיל כדי לנהל עובדים.</div>;
  }

  if (loadingInstructors && instructors.length === 0) {
    return (
      <div className="flex items-center justify-center gap-3 rounded-3xl border border-slate-200 bg-white p-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="text-sm text-slate-600">טוען עובדים...</span>
      </div>
    );
  }

  if (instructorsError) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{instructorsError}</div>;
  }

  return (
    <div className="antialiased text-foreground">
      <div className="grid gap-3 lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-slate-200 bg-blue-50/30 shadow-sm lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-hidden lg:flex lg:flex-col">
          <div className="shrink-0 space-y-2 border-b border-slate-200/80 p-3">
            <div className="grid grid-cols-2 gap-2">
              <DenseStat label="פעילים" value={summary.activeEmployees} accent="blue" />
              <DenseStat label="חסרי משתמש" value={summary.missingUser} accent="amber" />
            </div>
            <DenseStat label="שיעורים השבוע" value={summary.upcomingLessons} accent="emerald" />
            <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
              <div className="grid gap-2">
                <Button onClick={() => setShowWizard(true)} size="sm" className="w-full justify-center">
                  <UserPlus className="me-2 h-4 w-4" />
                  עובד חדש
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowInactive((prev) => !prev)} className="w-full">
                  {showInactive ? 'הסתר מושבתים' : 'הצג מושבתים'}
                </Button>
              </div>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="חיפוש עובד, טלפון, תפקיד..."
                className="bg-white pe-9"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setFilterKey(filter.key)}
                  className={cn(
                    'rounded-xl border px-3 py-1.5 text-xs font-bold transition',
                    filterKey === filter.key
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1 overflow-y-auto px-2.5 py-2.5 lg:flex-1 lg:min-h-0">
            {filteredEmployees.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 p-4 text-center text-sm text-slate-500">
                לא נמצאו עובדים.
              </div>
            )}
            {filteredEmployees.map((employee) => {
              const isSelected = employee.id === (currentEmployee?.id ?? null);
              const activity = employeeActivities.get(employee.id);
              const primaryService = (employee.service_capabilities || [])[0];
              const primaryServiceName = primaryService ? getServiceName(services, primaryService.service_id) : null;

              return (
                <button
                  key={employee.id}
                  type="button"
                  onClick={() => setSelectedEmployeeId(employee.id)}
                  className={cn(
                    'w-full rounded-2xl border px-3 py-2 text-start transition',
                    isSelected
                      ? 'border-blue-300/70 bg-gradient-to-b from-white to-blue-50/60 shadow-[0_12px_28px_-20px_rgba(15,23,42,0.28)]'
                      : 'border-slate-200 bg-white shadow-sm hover:border-slate-300',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-bold text-slate-900">{getEmployeeName(employee)}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {getEmployeeTypeLabel(employee)} • {employee.is_active ? 'פעיל' : 'מושבת'}
                      </div>
                    </div>
                    {!employee.user_id ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                        הזמנה
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1">
                    {primaryServiceName ? (
                      <span className="rounded-full bg-blue-100/90 px-2 py-px text-[10px] font-bold text-blue-700">
                        {primaryServiceName}
                      </span>
                    ) : null}
                    {activity?.scheduled ? (
                      <span className="rounded-full bg-emerald-100/90 px-2 py-px text-[10px] font-bold text-emerald-700">
                        היום {activity.scheduled}
                      </span>
                    ) : null}
                    {(employee.service_capabilities || []).length > 1 ? (
                      <span className="rounded-full bg-slate-100 px-2 py-px text-[10px] font-bold text-slate-600">
                        +{employee.service_capabilities.length - 1} שירותים
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}

            {unlinkedMembers.length > 0 && (
              <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-2.5 py-2.5">
                <div className="text-[11px] font-bold text-amber-900">{unlinkedMembers.length} חברי ארגון ללא כרטיס עובד</div>
                <div className="mt-2 space-y-1">
                  {unlinkedMembers.slice(0, 3).map((member) => (
                    <div key={member.user_id} className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-white/80 px-2.5 py-2">
                      <div className="min-w-0 flex-1 truncate text-xs font-medium text-slate-900">
                        {member.profile?.full_name || member.profile?.email || member.user_id}
                      </div>
                      <Button size="sm" variant="outline" onClick={() => handleCreateEmployeeForMember(member)} disabled={actionState === REQUEST.loading}>
                        <UserPlus className="me-1.5 h-3.5 w-3.5" />
                        צור
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        <div className="min-w-0 space-y-3">
          {!currentEmployee ? (
            <div className="flex min-h-[40vh] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-8">
              <p className="text-sm text-slate-500">בחר עובד מהרשימה כדי לצפות בפרטים.</p>
            </div>
          ) : (
            <>
              <section className="rounded-2xl border border-slate-200 bg-gradient-to-bl from-white to-blue-50/40 px-4 py-4 shadow-sm">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="flex items-start gap-3">
                    <Avatar className="h-14 w-14 shrink-0 rounded-2xl">
                      <AvatarFallback className="rounded-2xl bg-gradient-to-br from-blue-500 to-blue-400 text-lg font-bold tracking-tight text-white">
                        {getInitials(currentEmployee)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <Badge>{getEmployeeTypeLabel(currentEmployee)}</Badge>
                        <Badge variant={currentEmployee.is_active ? 'default' : 'secondary'}>
                          {currentEmployee.is_active ? 'פעיל' : 'מושבת'}
                        </Badge>
                        {currentEmployee.user_id ? <Badge variant="outline">משתמש מחובר</Badge> : <Badge variant="outline">ללא משתמש</Badge>}
                      </div>
                      <h2 className="text-2xl font-bold leading-tight text-slate-950">{getEmployeeName(currentEmployee)}</h2>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                        {currentEmployee.employee_id ? <span>עובד #{currentEmployee.employee_id}</span> : null}
                        {currentEmployee.phone ? <span>{currentEmployee.phone}</span> : null}
                        {currentEmployee.email ? <span>{currentEmployee.email}</span> : null}
                        {currentEmployee.start_date ? <span>התחלה: {formatDate(currentEmployee.start_date)}</span> : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {currentEmployeeServices.map((capability) => (
                          <span key={capability.service_id} className="rounded-full bg-blue-100/80 px-2.5 py-1 text-[10px] font-bold text-blue-700">
                            {capability.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => openEmployeeEditor(currentEmployee)}>
                      <Settings className="me-2 h-4 w-4" />
                      עריכת עובד
                    </Button>
                    {currentEmployee.phone ? (
                      <Button size="sm" variant="outline" onClick={() => window.open(getWhatsAppLink(currentEmployee), '_blank', 'noopener,noreferrer')}>
                        <MessageCircle className="me-2 h-4 w-4" />
                        WhatsApp
                      </Button>
                    ) : null}
                    {!currentEmployee.user_id ? (
                      <Button size="sm" variant="outline" onClick={() => setShowLinkDialog(true)} disabled={actionState === REQUEST.loading || unlinkedMembers.length === 0}>
                        <Link2 className="me-2 h-4 w-4" />
                        קשר לחבר ארגון
                      </Button>
                    ) : null}
                    {!currentEmployee.user_id ? (
                      <Button size="sm" variant="outline" onClick={() => handleLinkUser(currentEmployee)} disabled={actionState === REQUEST.loading}>
                        <MailPlus className="me-2 h-4 w-4" />
                        הזמן משתמש
                      </Button>
                    ) : null}
                    {currentEmployee.is_active ? (
                      <Button size="sm" variant="outline" onClick={() => handleToggleActive(currentEmployee, false)} disabled={actionState === REQUEST.loading}>
                        <UserX className="me-2 h-4 w-4 text-red-600" />
                        השבת
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => handleToggleActive(currentEmployee, true)} disabled={actionState === REQUEST.loading}>
                        <RotateCcw className="me-2 h-4 w-4 text-green-600" />
                        הפעל מחדש
                      </Button>
                    )}
                  </div>
                </div>
              </section>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <DenseStat label="שיעורים היום" value={employeeActivities.get(currentEmployee.id)?.scheduled ?? 0} accent="blue" />
                <DenseStat label="שיעורים עתידיים" value={upcomingInstances.length} accent="emerald" />
                <DenseStat label="שיעורי עבר" value={historyInstances.length} accent="slate" />
                <Popover>
                  <PopoverTrigger asChild>
                    <div
                      role={currentEmployeeMissingCount > 0 ? 'button' : undefined}
                      className={cn(
                        'rounded-2xl border px-3 py-3 shadow-sm transition-all duration-150',
                        currentEmployeeMissingCount > 0
                          ? 'cursor-pointer border-amber-200 bg-amber-50/70 text-amber-950 hover:shadow-md hover:scale-[1.02] active:scale-[0.99]'
                          : 'pointer-events-none border-slate-200 bg-white text-slate-900'
                      )}
                    >
                      <div className="text-[11px] font-medium text-slate-500">חוסרים בכרטיס</div>
                      <div className="mt-1">
                        <span className="text-xl font-extrabold leading-none">{currentEmployeeMissingCount}</span>
                      </div>
                    </div>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-56 space-y-3 p-3">
                    <p className="text-xs font-semibold text-slate-700">שדות חסרים בכרטיס:</p>
                    <ul className="space-y-1">
                      {currentEmployeeMissingItems.map((item) => (
                        <li key={item} className="flex items-center gap-2 text-xs text-slate-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          {item}
                        </li>
                      ))}
                    </ul>
                    <Button size="sm" className="w-full" onClick={() => openEmployeeEditor(currentEmployee)}>
                      <Settings className="me-2 h-3 w-3" />
                      ערוך כרטיס עובד
                    </Button>
                  </PopoverContent>
                </Popover>
              </div>

              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl bg-slate-100/80 p-1">
                  <TabsTrigger value={TAB_KEYS.overview} className="rounded-xl px-4 py-2 text-xs">סקירה</TabsTrigger>
                  <TabsTrigger value={TAB_KEYS.schedule} className="rounded-xl px-4 py-2 text-xs">לו״ז</TabsTrigger>
                  <TabsTrigger value={TAB_KEYS.attendance} className="rounded-xl px-4 py-2 text-xs">נוכחות</TabsTrigger>
                  <TabsTrigger value={TAB_KEYS.finance} className="rounded-xl px-4 py-2 text-xs">פיננסים</TabsTrigger>
                  <TabsTrigger value={TAB_KEYS.leaves} className="rounded-xl px-4 py-2 text-xs">חופשות</TabsTrigger>
                  <TabsTrigger value={TAB_KEYS.documents} className="rounded-xl px-4 py-2 text-xs">מסמכים</TabsTrigger>
                  <TabsTrigger value={TAB_KEYS.activity} className="rounded-xl px-4 py-2 text-xs">פעילות</TabsTrigger>
                </TabsList>
                <TabsContent value={TAB_KEYS.overview} className="space-y-3">
                  {currentEmployeeSetupIncomplete ? (
                    <SectionCard title="השלמת הגדרת מדריך" description="העובד מסומן כמדריך אבל חסרים לו חלונות זמינות או שירותים פעילים">
                      <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-3 py-3 text-sm text-amber-900">
                        כדי שהעובד יהיה מוכן לשיבוץ, יש להשלים לפחות שירות אחד וחלונות זמינות לשירות.
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => setShowCapabilitiesDialog(true)}>
                          <Clock className="me-2 h-4 w-4" />
                          השלם זמינות
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setShowCapabilitiesDialog(true)}>
                          <Briefcase className="me-2 h-4 w-4" />
                          השלם שירותים
                        </Button>
                      </div>
                    </SectionCard>
                  ) : null}
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
                    <SectionCard
                      title="כרטיס עובד"
                      description="זהות, קישור משתמש ופרטי העסקה בסיסיים"
                      action={(
                        <div className="flex flex-wrap gap-2">
                          {canManageCurrentEmployeeRole ? (
                            <Button size="sm" variant="outline" onClick={() => setShowRoleDialog(true)}>
                              <Shield className="me-2 h-4 w-4" />
                              הרשאות ארגון
                            </Button>
                          ) : null}
                          <Button size="sm" variant="outline" onClick={() => openEmployeeEditor(currentEmployee)}>
                            <Settings className="me-2 h-4 w-4" />
                            ערוך
                          </Button>
                        </div>
                      )}
                    >
                      <div className="grid gap-x-4 gap-y-0 md:grid-cols-2">
                        <Row label="שם מלא" value={getEmployeeName(currentEmployee)} />
                        <Row label="קישור משתמש" value={currentEmployee.user_id ? 'מחובר לחשבון פעיל' : 'ללא משתמש מקושר'} />
                        <Row
                          label="הרשאת ארגון"
                          value={currentEmployee.user_id ? currentEmployeeRoleLabel : 'אין משתמש מקושר'}
                          muted={!currentEmployee.user_id || !currentEmployeeMembership}
                        />
                        <Row label="טלפון" value={currentEmployee.phone} />
                        <Row label="דוא״ל" value={currentEmployee.email} />
                        <Row label="תאריך התחלה" value={formatDate(currentEmployee.start_date)} />
                        {getEmployeeType(currentEmployee) === 'office' ? <Row label="היקף העסקה" value={currentEmployee.employment_scope} /> : null}
                        <Row label="מספר עובד" value={currentEmployee.employee_id} />
                        <Row label="סוג עובד" value={getEmployeeTypeLabel(currentEmployee)} />
                      </div>
                    </SectionCard>

                    <div className="space-y-3">
                      {currentEmployee.user_id && currentEmployeeLinkedProfile ? (
                        <SectionCard
                          title="פרופיל משתמש מקושר"
                          description="נתוני החשבון האישי של המשתמש נשמרים בנפרד מכרטיס העובד הארגוני"
                          action={currentEmployeeProfileDifferences.length > 0 ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleSyncFromLinkedProfile}
                              disabled={actionState === REQUEST.loading}
                            >
                              {actionState === REQUEST.loading ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <RotateCcw className="me-2 h-4 w-4" />}
                              סנכרן לפרטי העובד
                            </Button>
                          ) : null}
                        >
                          <div className="space-y-3">
                            <div className="grid gap-x-4 gap-y-0 md:grid-cols-2">
                              <Row label="שם בחשבון" value={getLinkedProfileName(currentEmployeeLinkedProfile)} />
                              <Row label="טלפון בחשבון" value={currentEmployeeLinkedProfile.phone} />
                              <Row label="דוא״ל בחשבון" value={currentEmployeeLinkedProfile.email} />
                              <Row
                                label="סטטוס התאמה"
                                value={currentEmployeeProfileDifferences.length === 0 ? 'תואם לכרטיס העובד' : 'נמצאו הבדלים מול כרטיס העובד'}
                                muted={currentEmployeeProfileDifferences.length === 0}
                              />
                            </div>
                            {currentEmployeeProfileDifferences.length > 0 ? (
                              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-3 py-3 text-xs text-amber-900">
                                נמצאו הבדלים ב-{currentEmployeeProfileDifferences.includes('name') ? 'שם' : ''}
                                {currentEmployeeProfileDifferences.includes('name') && currentEmployeeProfileDifferences.length > 1 ? ', ' : ''}
                                {currentEmployeeProfileDifferences.includes('phone') ? 'טלפון' : ''}
                                {currentEmployeeProfileDifferences.includes('phone') && currentEmployeeProfileDifferences.includes('email') ? ', ' : ''}
                                {currentEmployeeProfileDifferences.includes('email') ? 'דוא״ל' : ''}.
                                אפשר לסנכרן ידנית את פרטי פרופיל המשתמש אל כרטיס העובד.
                              </div>
                            ) : (
                              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3 py-3 text-xs text-emerald-900">
                                פרטי כרטיס העובד כבר תואמים לפרופיל המשתמש המקושר.
                              </div>
                            )}
                          </div>
                        </SectionCard>
                      ) : null}

                      <SectionCard title="תקשורת" description="פעולות מיידיות מול העובד">
                        <div className="grid gap-2">
                          {currentEmployee.phone ? (
                            <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/60 px-3 py-2">
                              <div className="min-w-0">
                                <div className="text-sm font-bold text-slate-900">טלפון</div>
                                <div className="text-xs text-slate-500">{currentEmployee.phone}</div>
                              </div>
                              <Button size="sm" variant="outline" asChild>
                                <a href={`tel:${currentEmployee.phone}`}><Phone className="me-2 h-4 w-4" />התקשר</a>
                              </Button>
                            </div>
                          ) : null}
                          {currentEmployee.phone ? (
                            <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/60 px-3 py-2">
                              <div className="min-w-0">
                                <div className="text-sm font-bold text-slate-900">WhatsApp</div>
                                <div className="text-xs text-slate-500">שלח הודעה מהירה</div>
                              </div>
                              <Button size="sm" variant="outline" onClick={() => window.open(getWhatsAppLink(currentEmployee), '_blank', 'noopener,noreferrer')}>
                                <MessageCircle className="me-2 h-4 w-4" />
                                שלח
                              </Button>
                            </div>
                          ) : null}
                          {currentEmployee.email ? (
                            <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/60 px-3 py-2">
                              <div className="min-w-0">
                                <div className="text-sm font-bold text-slate-900">דוא״ל</div>
                                <div className="text-xs text-slate-500">{currentEmployee.email}</div>
                              </div>
                              <Button size="sm" variant="outline" asChild>
                                <a href={`mailto:${currentEmployee.email}`}>פתח</a>
                              </Button>
                            </div>
                          ) : null}
                          {!currentEmployee.phone && !currentEmployee.email ? (
                            <EmptyState title="אין פרטי קשר" body="השלם טלפון או דוא״ל בכרטיס העובד." />
                          ) : null}
                        </div>
                      </SectionCard>

                      <SectionCard title="הערות" description="מידע תפעולי פנימי">
                        <div className="min-h-[72px] rounded-2xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm text-slate-700">
                          {currentEmployee.notes || 'אין הערות פנימיות.'}
                        </div>
                      </SectionCard>

                      {currentEmployee.user_id ? (
                        <SectionCard title="גישה לארגון" description="סוג העובד והרשאת הארגון הם שני צירים שונים">
                          <div className="space-y-2">
                            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-3 py-3">
                              <div className="text-sm font-bold text-slate-900">{currentEmployeeRoleLabel}</div>
                              <div className="mt-1 text-xs text-slate-500">
                                {currentEmployeeMembership
                                  ? 'הרשאה זו קובעת אם למשתמש יש ניהול ארגון, בלי לשנות את סוג העובד שלו.'
                                  : 'לעובד יש משתמש מקושר, אבל לא נמצאה לו חברות ארגונית תואמת.'}
                              </div>
                            </div>
                            {canManageCurrentEmployeeRole ? (
                              <Button size="sm" variant="outline" onClick={() => setShowRoleDialog(true)}>
                                <Shield className="me-2 h-4 w-4" />
                                נהל הרשאות ארגון
                              </Button>
                            ) : currentEmployeeOrgRole === 'owner' ? (
                              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-3 py-3 text-xs text-amber-900">
                                הרשאת בעלים מנוהלת מחוץ למסך זה ואינה ניתנת לשינוי מתוך עמוד העובדים.
                              </div>
                            ) : null}
                          </div>
                        </SectionCard>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-3 xl:grid-cols-2">
                    <SectionCard
                      title="זמינות"
                      description={getEmployeeType(currentEmployee) === 'instructor' ? 'חלונות זמינות לפי שירות' : 'ימי עבודה שבועיים של העובד'}
                      action={getEmployeeType(currentEmployee) === 'instructor' ? (
                        <Button size="sm" variant="outline" onClick={() => setShowCapabilitiesDialog(true)}>
                          <Clock className="me-2 h-4 w-4" />
                          נהל זמינות
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => openEmployeeEditor(currentEmployee)}>
                          <Clock className="me-2 h-4 w-4" />
                          ערוך זמינות
                        </Button>
                      )}
                    >
                      {getEmployeeType(currentEmployee) === 'instructor' ? (
                        <div className="space-y-2">
                          {currentEmployeeServices.length > 0 ? currentEmployeeServices.map((capability) => (
                            <div key={capability.service_id} className="rounded-2xl border border-slate-200 bg-slate-50/60 px-3 py-3">
                              <div className="text-sm font-bold text-slate-900">{capability.name}</div>
                              <div className="mt-1 text-xs text-slate-500">
                                {capability.setup_incomplete ? 'נדרשת הגדרת זמינות' : `ימי זמינות ${capability.availabilitySummary || '—'}`}
                              </div>
                            </div>
                          )) : (
                            <EmptyState title="אין שירותים מוגדרים" body="הוסף שירותים כדי לנהל זמינות לפי שירות." />
                          )}
                        </div>
                      ) : (
                        <div className="space-y-0">
                          <Row label="ימי עבודה" value={getWorkingDaysSummary(currentEmployee)} />
                          <Row label="מקור הנתונים" value="Employees.working_days" muted />
                        </div>
                      )}
                    </SectionCard>

                    <SectionCard
                      title="שירותים ויכולות"
                      description="שירותים זמינים, קיבולת ואופן תשלום"
                      action={getEmployeeType(currentEmployee) === 'instructor' ? (
                        <Button size="sm" variant="outline" onClick={() => setShowCapabilitiesDialog(true)}>
                          <Briefcase className="me-2 h-4 w-4" />
                          נהל שירותים
                        </Button>
                      ) : null}
                    >
                      {currentEmployeeServices.length > 0 ? (
                        <div className="space-y-2">
                          {currentEmployeeServices.map((capability) => (
                            <div key={capability.service_id} className="rounded-2xl border border-slate-200 bg-slate-50/60 px-3 py-3">
                              <div className="text-sm font-bold text-slate-900">{capability.name}</div>
                              <div className="mt-1 text-xs text-slate-500">
                                קיבולת {capability.max_students || 1} • {capability.compensationSummary.valueLabel} • {capability.compensationSummary.basisLabel} • {capability.setup_incomplete ? 'זמינות חסרה' : `ימי זמינות ${capability.availabilitySummary || '—'}`}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <EmptyState title="אין שירותים מוגדרים" body="הוסף שירותים לעובד כדי לנהל קיבולת ותעריפי בסיס." />
                      )}
                    </SectionCard>
                  </div>
                </TabsContent>

                <TabsContent value={TAB_KEYS.schedule} className="space-y-3">
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                    <SectionCard
                      title="שיעורים קרובים"
                      description="שיעורים ב-2 החודשים הקרובים"
                      action={getEmployeeType(currentEmployee) === 'instructor' ? (
                        <Button size="sm" variant="outline" onClick={() => setShowCapabilitiesDialog(true)}>
                          <Calendar className="me-2 h-4 w-4" />
                          זמינות
                        </Button>
                      ) : null}
                    >
                      {instancesLoading ? (
                        <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />טוען שיעורים...</div>
                      ) : getEmployeeType(currentEmployee) !== 'instructor' ? (
                        <EmptyState title="אין לו״ז למשרה משרדית" body="כרטיס זה לא משויך ללוח שיעורים של מדריך." />
                      ) : (
                        <MonthGroup groups={upcomingMonthGroups} services={services} emptyTitle="אין שיעורים מתוכננים" emptyBody="לא נמצאו מופעי lesson_instances עתידיים בטווח הטעינה הנוכחי." />
                      )}
                    </SectionCard>

                    <SectionCard title="הגדרות תזמון" description="זמינות לפי שירות, שירותים פעילים וסטטוס ההשלמה">
                      {getEmployeeType(currentEmployee) === 'instructor' ? (
                        <div className="space-y-0">
                          <Row label="מספר שירותים" value={`${currentEmployeeServices.length}`} />
                          <Row label="שירות ראשון" value={currentEmployeeServices[0]?.name || '—'} />
                          <Row label="סטטוס זמינות" value={currentEmployeeSetupIncomplete ? 'נדרשת השלמה' : 'תקין'} />
                        </div>
                      ) : (
                        <EmptyState title="אין הגדרות מדריך" body="רק מדריכים משתמשים בשירותים וזמינות לפי שירות." />
                      )}
                    </SectionCard>
                  </div>

                  <SectionCard
                    title="היסטוריית שיעורים"
                    action={
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" className="flex h-5 w-5 items-center justify-center rounded-full text-slate-400 hover:text-slate-600">
                            <HelpCircle className="h-4 w-4" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent side="top" align="end" className="max-w-[220px] p-2 text-center text-xs text-slate-700">
                          כולל שיעורים שהתקיימו ושיעורים שהתלמיד לא הגיע אליהם, מחולקים לפי חודש
                        </PopoverContent>
                      </Popover>
                    }
                  >
                    {instancesLoading ? (
                      <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />טוען היסטוריה...</div>
                    ) : getEmployeeType(currentEmployee) !== 'instructor' ? (
                      <EmptyState title="אין היסטוריית שיעורים" body="כרטיס זה אינו משויך ל-history של lesson_instances." />
                    ) : (
                      <MonthGroup groups={historyMonthGroups} services={services} emptyTitle="אין היסטוריית שיעורים" emptyBody="לא נמצאו completed / no_show בטווח הטעינה הנוכחי." />
                    )}
                  </SectionCard>
                </TabsContent>

                <TabsContent value={TAB_KEYS.attendance} className="space-y-3">
                  <EmployeeAttendancePanel
                    employee={currentEmployee}
                    orgId={orgId}
                    session={session}
                  />
                </TabsContent>

                <TabsContent value={TAB_KEYS.finance} className="space-y-3">
                  <EmployeeFinancePanel
                    employee={currentEmployee}
                    orgId={orgId}
                    session={session}
                    onEditEmployee={() => openEmployeeEditor(currentEmployee)}
                  />
                </TabsContent>

                <TabsContent value={TAB_KEYS.leaves} className="space-y-3">
                  <EmployeeLeavePanel
                    employee={currentEmployee}
                    orgId={orgId}
                    session={session}
                  />
                </TabsContent>

                <TabsContent value={TAB_KEYS.documents} className="space-y-3">
                  <SectionCard title="מסמכים" description="תשתית למסמכי עובד, חוזים ואישורים">
                    <EmptyState title="מרכז מסמכים לעובד עדיין לא חובר" body="הטאב נשאר יציב במבנה החדש, אבל מסמכים אישיים עדיין לא משויכים לכרטיס העובד הנוכחי." />
                  </SectionCard>
                </TabsContent>

                <TabsContent value={TAB_KEYS.activity} className="space-y-3">
                  <SectionCard title="ציר פעילות" description="אירועים תפעוליים ומערכתיים שלא מוצגים במלואם בטאבים האחרים">
                    <EmployeeActivityTimeline
                      employeeId={currentEmployee.id}
                      orgId={orgId}
                      session={authSession}
                      enabled={Boolean(canLoad && currentEmployee?.id)}
                    />
                  </SectionCard>
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </div>

      <EmployeeWizardDialog
        open={showWizard}
        onOpenChange={setShowWizard}
        orgId={orgId}
        session={session}
        onSuccess={async () => {
          await refetchInstructors();
          await fetchOverviewInstances();
        }}
      />
      <EditEmployeeDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        employee={selectedEmployee}
        orgId={orgId}
        session={session}
        availableServices={services}
        onSaved={async () => {
          await refetchInstructors();
          await fetchOverviewInstances();
        }}
      />
      <EditServiceCapabilitiesDialog
        open={showCapabilitiesDialog}
        onOpenChange={setShowCapabilitiesDialog}
        instructor={currentEmployee}
        orgId={orgId}
        session={session}
        onSaved={async () => {
          await refetchInstructors();
          await fetchOverviewInstances();
        }}
      />
      <LinkEmployeeMemberDialog
        open={showLinkDialog}
        onOpenChange={setShowLinkDialog}
        employee={currentEmployee}
        members={unlinkedMembers}
        orgId={orgId}
        session={session}
        onLinked={handleLinkDialogSuccess}
      />
      <Dialog
        open={showRoleDialog}
        onOpenChange={(open) => {
          setShowRoleDialog(open);
          if (!open) {
            setTargetOrgRole(currentEmployeeOrgRole === 'admin' ? 'admin' : 'member');
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>הרשאות ארגון</DialogTitle>
            <DialogDescription>
              פעולה זו משנה את הרשאת המשתמש בארגון, לא את סוג העובד שלו. היא נשמרת בנפרד מכרטיס העובד.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
              <div className="text-sm font-bold text-slate-900">{getEmployeeName(currentEmployee)}</div>
              <div className="mt-1 text-xs text-slate-500">
                מצב נוכחי: {currentEmployeeRoleLabel}
              </div>
            </div>
            <div className="space-y-2">
              <Label>הרשאה חדשה</Label>
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => setTargetOrgRole('member')}
                  className={cn(
                    'rounded-2xl border px-4 py-3 text-start transition',
                    targetOrgRole === 'member'
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300',
                  )}
                >
                  <div className="text-sm font-bold">חבר/ת ארגון</div>
                  <div className={cn('mt-1 text-xs', targetOrgRole === 'member' ? 'text-slate-200' : 'text-slate-500')}>
                    ללא הרשאות ניהול ארגון. ההרשאה מתאימה למדריכים ולעובדי משרד רגילים.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setTargetOrgRole('admin')}
                  className={cn(
                    'rounded-2xl border px-4 py-3 text-start transition',
                    targetOrgRole === 'admin'
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300',
                  )}
                >
                  <div className="text-sm font-bold">מנהל/ת ארגון</div>
                  <div className={cn('mt-1 text-xs', targetOrgRole === 'admin' ? 'text-blue-100' : 'text-slate-500')}>
                    הרשאה זו מאפשרת ניהול צוות, עובדים, כספים והגדרות ארגוניות. יש להעניק אותה במכוון בלבד.
                  </div>
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowRoleDialog(false)}
              disabled={actionState === REQUEST.loading}
            >
              ביטול
            </Button>
            <Button
              type="button"
              onClick={handleSaveOrgRole}
              disabled={actionState === REQUEST.loading || !canManageCurrentEmployeeRole || targetOrgRole === currentEmployeeOrgRole}
            >
              {actionState === REQUEST.loading ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Shield className="me-2 h-4 w-4" />}
              {targetOrgRole === 'admin' ? 'הענק הרשאת מנהל' : 'שמור כחבר ארגון'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={inviteUserDialogOpen}
        onOpenChange={(open) => {
          setInviteUserDialogOpen(open);
          if (!open) {
            setInviteUserEmployee(null);
            setInviteUserEmail('');
            setInviteUserPendingConflict(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>הזמן משתמש</DialogTitle>
            <DialogDescription>
              שליחת הזמנה לקישור עובד לחשבון משתמש.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="invite-user-email">כתובת דוא"ל</Label>
            <Input
              id="invite-user-email"
              type="email"
              dir="ltr"
              value={inviteUserEmail}
              onChange={(event) => {
                setInviteUserEmail(event.target.value);
                setInviteUserPendingConflict(null);
              }}
              placeholder="user@example.com"
            />
          </div>
          {inviteUserPendingConflict ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 text-end">
              כבר קיימת הזמנה פעילה לכתובת הזו. אפשר לשלוח הזמנה חדשה שתבטל את הקישור הקודם.
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setInviteUserDialogOpen(false);
                setInviteUserEmployee(null);
                setInviteUserEmail('');
                setInviteUserPendingConflict(null);
              }}
              disabled={actionState === REQUEST.loading}
            >
              ביטול
            </Button>
            {inviteUserPendingConflict ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleInviteUserSubmit({ resendPending: true })}
                disabled={actionState === REQUEST.loading || !inviteUserEmail.trim()}
              >
                {actionState === REQUEST.loading ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <RotateCcw className="me-2 h-4 w-4" />}
                שלח מחדש
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={() => handleInviteUserSubmit()}
              disabled={actionState === REQUEST.loading || !inviteUserEmail.trim()}
            >
              {actionState === REQUEST.loading ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
              שלח הזמנה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
