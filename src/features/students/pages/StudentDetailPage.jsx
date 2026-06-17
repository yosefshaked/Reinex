import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { normalizeMembershipRole, isAdminRole } from '@/features/students/utils/endpoints.js';
import { toast } from '@/lib/toast.jsx';
import { updateStudentFromForm } from '@/features/students/api/students.js';
import EditStudentModal from '@/features/admin/components/EditStudentModal.jsx';
import StudentHeader from '@/features/students/components/StudentHeader.jsx';
import StudentOverviewTab from '@/features/students/components/StudentOverviewTab.jsx';
import StudentScheduleTab from '@/features/students/components/StudentScheduleTab.jsx';
import StudentHistoryTab from '@/features/students/components/StudentHistoryTab.jsx';
import StudentDocumentsTab from '@/features/students/components/StudentDocumentsTab.jsx';
import StudentFinancialTab from '@/features/students/components/StudentFinancialTab.jsx';
import StudentFormsTab from '@/features/students/components/StudentFormsTab.jsx';
import DetailTabsShell from '@/components/ui/DetailTabsShell.jsx';

const REQUEST_STATE = {
  idle: 'idle',
  loading: 'loading',
  error: 'error',
};

/**
 * StudentDetailPage: Lightweight Shell
 * 
 * Responsibilities:
 * - Fetch & hold core student + guardian data
 * - Route tab parameter and delegate to specific tab components
 * - Manage student edit modal
 * - Each tab fetches its own data independently
 * 
 * Key: Keep this <200 lines. All specific fetching moves to tabs.
 */
export default function StudentDetailPage() {
  const { id: studentIdParam, tab: tabParam } = useParams();
  const navigate = useNavigate();
  const studentId = typeof studentIdParam === 'string' ? studentIdParam : '';
  const activeTab = tabParam || 'overview';

  const { loading: supabaseLoading, session } = useSupabase();
  const { activeOrg } = useOrg();
  // Student data state
  const [studentState, setStudentState] = useState(REQUEST_STATE.idle);
  const [student, setStudent] = useState(null);
  const [studentError, setStudentError] = useState('');

  // Required forms compliance
  const [requiredFormsCompliance, setRequiredFormsCompliance] = useState([]);

  // Edit modal
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isUpdatingStudent, setIsUpdatingStudent] = useState(false);
  const [updateError, setUpdateError] = useState('');

  const activeOrgId = activeOrg?.id || null;
  const membershipRole = normalizeMembershipRole(activeOrg?.membership?.role);
  const canEdit = isAdminRole(membershipRole);
  const isFetchingStudent = studentState === REQUEST_STATE.loading;

  const canFetch = Boolean(
    studentId &&
    session &&
    activeOrgId &&
    !supabaseLoading
  );

  const loadCompliance = useCallback(async (resolvedStudentId) => {
    if (!resolvedStudentId || !canFetch) return;
    try {
      const params = new URLSearchParams();
      params.set('org_id', activeOrgId);
      params.set('student_id', resolvedStudentId);
      const data = await authenticatedFetch(`student-required-forms/compliance?${params}`, { session });
      setRequiredFormsCompliance(Array.isArray(data) ? data : []);
    } catch {
      // Non-critical — don't block UI on compliance fetch failure
      setRequiredFormsCompliance([]);
    }
  }, [activeOrgId, canFetch, session]);

  // Fetch core student data with guardian
  const loadStudent = useCallback(async ({ shouldApply = () => true } = {}) => {
    if (!canFetch) return;
    if (!shouldApply()) return null;

    setStudentState(REQUEST_STATE.loading);
    setStudentError('');

    try {
      const params = new URLSearchParams();
      if (activeOrgId) params.set('org_id', activeOrgId);
      const endpoint = `students-list/${studentId}${params ? `?${params}` : ''}`;

      const match = await authenticatedFetch(endpoint, { session });
      if (!shouldApply()) return match ?? null;

      if (!match || !match.id) {
        setStudent(null);
        setStudentState(REQUEST_STATE.error);
        setStudentError('התלמיד לא נמצא.');
        return null;
      }

      setStudent(match);
      setStudentState(REQUEST_STATE.idle);
      void loadCompliance(match.id);
      return match;
    } catch (error) {
      if (!shouldApply()) return null;

      console.error('Failed to load student', error);
      setStudent(null);
      setStudentState(REQUEST_STATE.error);
      setStudentError(error?.message || 'טעינת פרטי התלמיד נכשלה.');
      return null;
    }
  }, [canFetch, studentId, activeOrgId, session, loadCompliance]);

  useEffect(() => {
    let isMounted = true;

    if (canFetch) {
      void loadStudent({ shouldApply: () => isMounted });
    }

    return () => {
      isMounted = false;
    };
  }, [canFetch, loadStudent]);

  // Handle edit modal
  const handleOpenEdit = () => {
    if (student && canEdit) {
      setUpdateError('');
      setIsEditOpen(true);
    }
  };

  const handleCloseEdit = () => {
    if (!isUpdatingStudent) {
      setIsEditOpen(false);
      setUpdateError('');
    }
  };

  const handleUpdateStudent = async (payload) => {
    if (!payload?.id || !activeOrgId) return;
    setIsUpdatingStudent(true);
    setUpdateError('');

    try {
      await updateStudentFromForm(payload, { orgId: activeOrgId, session });
      setIsEditOpen(false);
      toast.success('התלמיד עודכן בהצלחה');
      await loadStudent();
    } catch (error) {
      console.error('Failed to update student', error);
      setUpdateError(error?.message || 'עדכון התלמיד נכשל.');
    } finally {
      setIsUpdatingStudent(false);
    }
  };

  // Handle tab navigation
  const handleTabChange = (newTab) => {
    navigate(`/students/${studentId}/${newTab}`);
  };

  const tabs = [
    { key: 'overview', label: 'סקירה', content: <StudentOverviewTab student={student} /> },
    { key: 'schedule', label: 'לוח שיעורים', content: <StudentScheduleTab studentId={studentId} /> },
    { key: 'history', label: 'היסטוריה', content: <StudentHistoryTab studentId={studentId} student={student} /> },
    {
      key: 'documents',
      label: 'מסמכים',
      content: (
        <StudentDocumentsTab
          student={student}
          session={session}
          orgId={activeOrgId}
          onRefresh={loadStudent}
        />
      ),
    },
    { key: 'financial', label: 'כספים', content: <StudentFinancialTab studentId={studentId} student={student} /> },
    { key: 'forms', label: 'טפסים', content: <StudentFormsTab studentId={studentId} student={student} canEdit={canEdit} requiredFormsCompliance={requiredFormsCompliance} onComplianceRefresh={() => loadCompliance(studentId)} /> },
  ];

  // Loading states
  if (!studentId) {
    return <div className="text-sm text-neutral-600">לא נבחר תלמיד להצגה.</div>;
  }

  if (supabaseLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>טוען...</span>
      </div>
    );
  }

  if (!session) {
    return <div className="text-sm text-amber-700">נדרשת התחברות כדי לצפות בפרטי תלמיד.</div>;
  }

  if (!activeOrg) {
    return <div className="text-sm text-amber-700">דרוש ארגון פעיל להצגת פרטי תלמיד.</div>;
  }

  // Error state
  if (studentState === REQUEST_STATE.error) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
        {studentError}
      </div>
    );
  }

  if (!canFetch || isFetchingStudent) {
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // No student
  if (!student) {
    return <div className="text-sm text-neutral-600">לא נמצא תלמיד.</div>;
  }

  return (
    <>
      <DetailTabsShell
        header={(
          <StudentHeader
            student={student}
            canEdit={canEdit}
            isUpdating={isUpdatingStudent}
            onEdit={handleOpenEdit}
            onSuspend={loadStudent}
            requiredFormsCompliance={requiredFormsCompliance}
          />
        )}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        tabs={tabs}
      />

      {/* Edit modal */}
      <EditStudentModal
        open={isEditOpen}
        student={student}
        isSubmitting={isUpdatingStudent}
        error={updateError}
        onClose={handleCloseEdit}
        onSubmit={handleUpdateStudent}
        orgId={activeOrgId}
        session={session}
        onSuspendSuccess={loadStudent}
      />
    </>
  );
}
