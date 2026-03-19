import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { normalizeMembershipRole, isAdminRole } from '@/features/students/utils/endpoints.js';
import { toast } from 'sonner';
import EditStudentModal from '@/features/admin/components/EditStudentModal.jsx';
import StudentHeader from '@/features/students/components/StudentHeader.jsx';
import StudentOverviewTab from '@/features/students/components/StudentOverviewTab.jsx';
import StudentScheduleTab from '@/features/students/components/StudentScheduleTab.jsx';
import StudentHistoryTab from '@/features/students/components/StudentHistoryTab.jsx';
import StudentDocumentsTab from '@/features/students/components/StudentDocumentsTab.jsx';
import StudentFinancialTab from '@/features/students/components/StudentFinancialTab.jsx';
import StudentFormsTab from '@/features/students/components/StudentFormsTab.jsx';

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
  const { activeOrg, activeOrgHasConnection, tenantClientReady } = useOrg();

  // Student data state
  const [studentState, setStudentState] = useState(REQUEST_STATE.idle);
  const [student, setStudent] = useState(null);
  const [studentError, setStudentError] = useState('');

  // Edit modal
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isUpdatingStudent, setIsUpdatingStudent] = useState(false);
  const [updateError, setUpdateError] = useState('');

  const activeOrgId = activeOrg?.id || null;
  const membershipRole = normalizeMembershipRole(activeOrg?.membership?.role);
  const canEdit = isAdminRole(membershipRole);

  const canFetch = Boolean(
    studentId &&
    activeOrgId &&
    activeOrgHasConnection &&
    tenantClientReady &&
    !supabaseLoading
  );

  // Fetch core student data with guardian
  const loadStudent = useCallback(async () => {
    if (!canFetch) return;

    setStudentState(REQUEST_STATE.loading);
    setStudentError('');

    try {
      const params = new URLSearchParams();
      if (activeOrgId) params.set('org_id', activeOrgId);
      const endpoint = `students-list/${studentId}${params ? `?${params}` : ''}`;

      const match = await authenticatedFetch(endpoint, { session });
      if (!match || !match.id) {
        setStudent(null);
        setStudentState(REQUEST_STATE.error);
        setStudentError('התלמיד לא נמצא.');
        return;
      }

      setStudent(match);
      setStudentState(REQUEST_STATE.idle);
    } catch (error) {
      console.error('Failed to load student', error);
      setStudent(null);
      setStudentState(REQUEST_STATE.error);
      setStudentError(error?.message || 'טעינת פרטי התלמיד נכשלה.');
    }
  }, [canFetch, studentId, activeOrgId, session]);

  useEffect(() => {
    if (canFetch) {
      void loadStudent();
    }
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
      const body = {
        org_id: activeOrgId,
        firstName: payload.firstName,
        middleName: payload.middleName,
        lastName: payload.lastName,
        identityNumber: payload.identityNumber,
        dateOfBirth: payload.dateOfBirth,
        phone: payload.phone,
        email: payload.email,
        medicalProvider: payload.medicalProvider,
        notificationMethod: payload.notificationMethod,
        specialRate: payload.specialRate,
        notesInternal: payload.notesInternal,
        tags: payload.tags,
        isActive: payload.isActive,
        guardianId: payload.guardianId,
        guardianRelationship: payload.guardianRelationship,
      };

      await authenticatedFetch(`students-list/${payload.id}`, { method: 'PUT', body, session });
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

  if (!activeOrg || !activeOrgHasConnection) {
    return <div className="text-sm text-amber-700">דרוש חיבור מאומת לארגון.</div>;
  }

  // Error state
  if (studentState === REQUEST_STATE.error) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
        {studentError}
      </div>
    );
  }

  // Loading state
  if (studentState === REQUEST_STATE.loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>טוען פרטי תלמיד...</span>
      </div>
    );
  }

  // No student
  if (!student) {
    return <div className="text-sm text-neutral-600">לא נמצא תלמיד.</div>;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header with actions */}
      <StudentHeader
        student={student}
        canEdit={canEdit}
        isUpdating={isUpdatingStudent}
        onEdit={handleOpenEdit}
        onSuspend={loadStudent}
      />

      {/* Tabbed content */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <div className="border-b border-border">
          <TabsList className="bg-transparent h-auto p-0 gap-1">
            <TabsTrigger value="overview" className="rounded-none border-b-2 border-transparent data-[state=active]:border-zinc-900 data-[state=active]:shadow-none px-4 py-2.5 font-medium">סקירה</TabsTrigger>
            <TabsTrigger value="schedule" className="rounded-none border-b-2 border-transparent data-[state=active]:border-zinc-900 data-[state=active]:shadow-none px-4 py-2.5 font-medium">לוח שיעורים</TabsTrigger>
            <TabsTrigger value="history" className="rounded-none border-b-2 border-transparent data-[state=active]:border-zinc-900 data-[state=active]:shadow-none px-4 py-2.5 font-medium">היסטוריה</TabsTrigger>
            <TabsTrigger value="documents" className="rounded-none border-b-2 border-transparent data-[state=active]:border-zinc-900 data-[state=active]:shadow-none px-4 py-2.5 font-medium">מסמכים</TabsTrigger>
            <TabsTrigger value="financial" className="rounded-none border-b-2 border-transparent data-[state=active]:border-zinc-900 data-[state=active]:shadow-none px-4 py-2.5 font-medium">כספים</TabsTrigger>
            <TabsTrigger value="forms" className="rounded-none border-b-2 border-transparent data-[state=active]:border-zinc-900 data-[state=active]:shadow-none px-4 py-2.5 font-medium">טפסים</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-4">
          <StudentOverviewTab student={student} />
        </TabsContent>

        <TabsContent value="schedule" className="space-y-4">
          <StudentScheduleTab studentId={studentId} />
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <StudentHistoryTab studentId={studentId} />
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <StudentDocumentsTab
            student={student}
            session={session}
            orgId={activeOrgId}
            onRefresh={loadStudent}
          />
        </TabsContent>

        <TabsContent value="financial" className="space-y-4">
          <StudentFinancialTab />
        </TabsContent>

        <TabsContent value="forms" className="space-y-4">
          <StudentFormsTab />
        </TabsContent>
      </Tabs>

      {/* Edit modal */}
      <EditStudentModal
        open={isEditOpen}
        student={student}
        isSubmitting={isUpdatingStudent}
        error={updateError}
        onClose={handleCloseEdit}
        onSubmit={handleUpdateStudent}
      />
    </div>
  );
}
