import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Copy, Loader2, Pause, Pencil, Play, Send } from 'lucide-react';
import { toast } from 'sonner';
import ProfileMasterStrip from '@/components/ui/ProfileMasterStrip.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { fetchStudentById, updateStudentStatus } from '@/features/students/api/students.js';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import SuspendStudentDialog from '@/features/students/components/SuspendStudentDialog.jsx';
import SendFormDialog from '@/features/students/components/SendFormDialog.jsx';
import { formatStudentName } from '@/features/students/utils/name-utils.js';
import { coerceAgorot, formatCurrency } from '@/lib/currency.js';

function getInitials(student) {
  const first = student?.first_name?.[0] || '';
  const last = student?.last_name?.[0] || '';
  return (first + last) || '?';
}

function isStudentActive(student) {
  const value = student?.is_active;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'לא') {
      return false;
    }
  }
  return true;
}

export default function StudentHeader({
  student,
  canEdit = false,
  isUpdating = false,
  onEdit,
  onSuspend,
}) {
  const navigate = useNavigate();
  const { session } = useSupabase();
  const { activeOrg } = useOrg();
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [sendFormDialogOpen, setSendFormDialogOpen] = useState(false);
  const [isSuspendingOrDeleting, setIsSuspendingOrDeleting] = useState(false);
  const [localStudentOverride, setLocalStudentOverride] = useState(null);
  const [summary, setSummary] = useState({ lessonsCount: null, balance: 0, debt: 0 });

  const displayStudent = localStudentOverride?.id === student?.id ? localStudentOverride : student;
  const activeOrgId = activeOrg?.id || '';
  const isSuspended = !isStudentActive(displayStudent);
  const medicalFlags = useMemo(
    () => (Array.isArray(displayStudent?.medical_flags) ? displayStudent.medical_flags : []),
    [displayStudent?.medical_flags],
  );

  const alertPills = useMemo(
    () => medicalFlags.map((flag, index) => ({
      key: `${flag}-${index}`,
      label: flag,
      icon: <AlertCircle className="h-3 w-3" />,
    })),
    [medicalFlags],
  );

  const loadSummary = useCallback(async () => {
    if (!student?.id || !session || !activeOrgId) return;

    try {
      const [billingPayload, lessonTemplates] = await Promise.all([
        authenticatedFetch('billing', {
          session,
          params: {
            org_id: activeOrgId,
            student_id: student.id,
          },
        }),
        authenticatedFetch('lesson-templates', {
          session,
          params: {
            org_id: activeOrgId,
            student_id: student.id,
          },
        }),
      ]);

      const balanceAgorot = coerceAgorot(billingPayload?.summary?.balance);
      const activeTemplates = Array.isArray(lessonTemplates)
        ? lessonTemplates.filter((template) => template?.is_active !== false)
        : [];

      setSummary({
        lessonsCount: activeTemplates.length,
        balance: balanceAgorot > 0 ? balanceAgorot : 0,
        debt: balanceAgorot < 0 ? Math.abs(balanceAgorot) : 0,
      });
    } catch (error) {
      console.error('Failed to load student header summary', error);
      setSummary({ lessonsCount: null, balance: 0, debt: 0 });
    }
  }, [activeOrgId, session, student?.id]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    setLocalStudentOverride(null);
  }, [student?.id, student?.is_active]);

  if (!displayStudent) return null;

  const handleReactivate = async () => {
    if (!activeOrgId || isSuspendingOrDeleting) return;

    setIsSuspendingOrDeleting(true);
    const toastId = toast.loading('מפעיל את התלמיד...');
    try {
      const newStatus = true;
      const updatedStudent = await updateStudentStatus(displayStudent, newStatus, { orgId: activeOrgId, session });

      if (updatedStudent?.is_active !== newStatus) {
        throw new Error('עדכון סטטוס התלמיד לא נשמר.');
      }

      const refreshedStudent = await onSuspend?.();
      const verifiedStudent = refreshedStudent?.id
        ? refreshedStudent
        : await fetchStudentById(displayStudent.id, { orgId: activeOrgId, session });

      if (verifiedStudent?.is_active !== newStatus) {
        throw new Error('עדכון סטטוס התלמיד לא נשמר.');
      }

      setLocalStudentOverride(verifiedStudent);
      toast.success('התלמיד הופעל בהצלחה', { id: toastId });
      void loadSummary();
    } catch (error) {
      console.error('Failed to reactivate student', error);
      toast.error(error?.message || 'שגיאה בעדכון סטטוס התלמיד', { id: toastId });
    } finally {
      setIsSuspendingOrDeleting(false);
    }
  };

  const handleCopyId = () => {
    if (displayStudent?.id) {
      navigator.clipboard.writeText(displayStudent.id);
      toast.success('מזהה הועתק');
    }
  };

  const age = displayStudent?.date_of_birth
    ? Math.floor((Date.now() - new Date(displayStudent.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null;

  const subtitleParts = [];
  if (displayStudent?.identity_number) subtitleParts.push(`ת.ז. ${displayStudent.identity_number}`);
  if (age != null && age > 0) subtitleParts.push(`גיל ${age}`);

  const kpis = [
    {
      label: 'סה״כ שיעורים',
      value: summary.lessonsCount ?? '—',
      className: 'text-slate-900',
    },
    {
      label: 'יתרה',
      value: formatCurrency(summary.balance),
      className: summary.balance > 0 ? 'text-emerald-700' : 'text-slate-900',
    },
    {
      label: 'חוב',
      value: formatCurrency(summary.debt),
      className: summary.debt > 0 ? 'text-red-600' : 'text-slate-900',
    },
  ];

  const primaryActions = canEdit ? [
    {
      label: 'עריכה',
      icon: <Pencil className="h-4 w-4" />,
      onClick: onEdit,
      disabled: isUpdating || isSuspendingOrDeleting,
    },
    {
      label: 'שלח טופס',
      icon: <Send className="h-4 w-4" />,
      onClick: () => setSendFormDialogOpen(true),
      disabled: isUpdating || isSuspendingOrDeleting,
    },
  ] : [];

  const moreActions = canEdit ? [
    {
      label: 'העתק מזהה',
      icon: <Copy className="h-4 w-4" />,
      onClick: handleCopyId,
    },
    { separator: true },
    {
      label: isSuspended ? 'ביטול השהיה' : 'השהיה',
      icon: isSuspendingOrDeleting
        ? <Loader2 className="h-4 w-4 animate-spin" />
        : isSuspended
          ? <Play className="h-4 w-4" />
          : <Pause className="h-4 w-4" />,
      onClick: () => {
        if (isSuspended) {
          void handleReactivate();
        } else {
          setSuspendDialogOpen(true);
        }
      },
      disabled: isUpdating || isSuspendingOrDeleting,
      className: 'text-amber-600 focus:text-amber-600',
    },
  ] : [
    {
      label: 'העתק מזהה',
      icon: <Copy className="h-4 w-4" />,
      onClick: handleCopyId,
    },
  ];

  return (
    <>
      <ProfileMasterStrip
        onBack={() => navigate('/students-list')}
        backLabel="חזרה לרשימת התלמידים"
        avatarFallback={getInitials(displayStudent)}
        name={formatStudentName(displayStudent)}
        status={isSuspended
          ? { label: 'לא פעיל', className: 'border-red-200 bg-red-50 text-red-700' }
          : { label: 'פעיל', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' }}
        subtitle={subtitleParts.join(' · ')}
        alertPills={alertPills}
        kpis={kpis}
        primaryActions={primaryActions}
        moreActions={moreActions}
      />

      <SuspendStudentDialog
        open={suspendDialogOpen}
        onOpenChange={setSuspendDialogOpen}
        student={displayStudent}
        orgId={activeOrgId}
        session={session}
        onSuccess={async () => {
          await onSuspend?.();
          await loadSummary();
        }}
      />

      <SendFormDialog
        open={sendFormDialogOpen}
        onOpenChange={setSendFormDialogOpen}
        student={displayStudent}
      />
    </>
  );
}
