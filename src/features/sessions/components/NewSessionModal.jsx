import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Calendar, CalendarCheck, CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import NewSessionForm, { NewSessionFormFooter } from './NewSessionForm.jsx';
import { ensureSessionFormFallback, parseSessionFormConfig } from '@/features/sessions/utils/form-config.js';
import { normalizeMembershipRole, isAdminRole } from '@/features/students/utils/endpoints.js';
import { useInstructors, useServices } from '@/hooks/useOrgData.js';

const REQUEST_STATE = Object.freeze({
  idle: 'idle',
  loading: 'loading',
  error: 'error',
});

/**
 * Format date as DD/MM/YYYY for display
 */
function formatDateForDisplay(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function DateChoiceFooter({ lastReportDate, studentName, onClose, onNewReport, onNewReportSameStudent, allowSameStudent = true }) {
  const [selectedDate, setSelectedDate] = useState(null);
  const [mode, setMode] = useState(allowSameStudent ? 'choose' : 'other-student'); // 'choose' | 'same-student' | 'other-student'
  const todayDate = getTodayDate();
  const showSameDate = lastReportDate && lastReportDate !== todayDate;

  const handleChooseSameStudent = () => {
    setMode('same-student');
    setSelectedDate(null);
  };

  const handleChooseOtherStudent = () => {
    setMode('other-student');
    setSelectedDate(null);
  };

  const handleBack = () => {
    setMode('choose');
    setSelectedDate(null);
  };

  const handleContinue = () => {
    if (!selectedDate) return;
    
    const dateValue = selectedDate === 'same' ? lastReportDate : 
                     selectedDate === 'today' ? todayDate : 
                     null; // 'other' - let user pick in form
    
    if (mode === 'same-student') {
      onNewReportSameStudent({ date: dateValue });
    } else {
      onNewReport({ date: dateValue });
    }
  };

  // Initial choice: same student or other student
  if (mode === 'choose') {
    return (
      <div className="flex flex-col gap-3" dir="rtl">
        <p className="text-sm font-medium text-center text-neutral-700">
          מה תרצו לעשות?
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button 
            onClick={handleChooseSameStudent}
            className="flex-1 gap-xs shadow-md hover:shadow-lg transition-shadow"
          >
            דיווח נוסף - {studentName}
          </Button>
          <Button 
            onClick={handleChooseOtherStudent}
            className="flex-1 gap-xs shadow-md hover:shadow-lg transition-shadow"
          >
            דיווח נוסף - תלמיד אחר
          </Button>
        </div>
        <Button 
          onClick={onClose}
          variant="outline"
          className="hover:shadow-sm"
        >
          סגור
        </Button>
      </div>
    );
  }

  // Date selection for chosen mode
  return (
    <div className="flex flex-col gap-4" dir="rtl">
      <div className="space-y-3">
        <p className="text-sm font-medium text-center text-neutral-700">
          בחרו תאריך לדיווח הבא:
        </p>
        
        <div className="grid gap-2">
          {showSameDate && (
            <Button
              variant={selectedDate === 'same' ? 'default' : 'outline'}
              onClick={() => setSelectedDate('same')}
              className="justify-start gap-2 h-auto py-3"
            >
              <CalendarCheck className="h-4 w-4 shrink-0" />
              <div className="flex flex-col items-start text-right">
                <span className="font-medium">אותו התאריך</span>
                <span className="text-xs opacity-80">{formatDateForDisplay(lastReportDate)}</span>
              </div>
            </Button>
          )}
          
          <Button
            variant={selectedDate === 'today' ? 'default' : 'outline'}
            onClick={() => setSelectedDate('today')}
            className="justify-start gap-2 h-auto py-3"
          >
            <CalendarClock className="h-4 w-4 shrink-0" />
            <div className="flex flex-col items-start text-right">
              <span className="font-medium">היום</span>
              <span className="text-xs opacity-80">{formatDateForDisplay(todayDate)}</span>
            </div>
          </Button>
          
          <Button
            variant={selectedDate === 'other' ? 'default' : 'outline'}
            onClick={() => setSelectedDate('other')}
            className="justify-start gap-2 h-auto py-3"
          >
            <Calendar className="h-4 w-4 shrink-0" />
            <div className="flex flex-col items-start text-right">
              <span className="font-medium">תאריך אחר</span>
              <span className="text-xs opacity-80">בחירה חופשית</span>
            </div>
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <Button 
          onClick={handleContinue}
          disabled={!selectedDate}
          className="flex-1"
        >
          המשך לדיווח
        </Button>
        {allowSameStudent ? (
          <Button 
            onClick={handleBack}
            variant="outline"
            className="flex-1"
          >
            חזור
          </Button>
        ) : null}
        <Button 
          onClick={onClose}
          variant="outline"
          className="flex-1"
        >
          סגור
        </Button>
      </div>
    </div>
  );
}

function SuccessFooter({ studentName, onClose, onNewReport, onNewReportSameStudent }) {
  return (
    <div className="flex flex-col gap-sm items-center">
      <div className="flex flex-col sm:flex-row gap-sm w-full sm:w-auto sm:justify-center">
        <Button 
          onClick={onNewReportSameStudent}
          className="gap-xs shadow-md hover:shadow-lg transition-shadow"
        >
          דיווח נוסף - {studentName}
        </Button>
        <Button 
          onClick={onNewReport}
        >
          דיווח נוסף - תלמיד אחר
        </Button>
      </div>
      <Button 
        onClick={onClose}
        variant="outline"
        className="hover:shadow-sm w-full sm:w-auto"
      >
        סגור
      </Button>
    </div>
  );
}

export default function NewSessionModal({
  open,
  onClose,
  initialStudentId = '',
  initialStudentStatus = 'active',
  initialDate = '', // YYYY-MM-DD format
  onCreated,
}) {
  const { loading: supabaseLoading } = useSupabase();
  const { user } = useAuth();
  const { activeOrg, activeOrgHasConnection, tenantClientReady } = useOrg();
  const [studentsState, setStudentsState] = useState(REQUEST_STATE.idle);
  const [studentsError, setStudentsError] = useState('');
  const [students, setStudents] = useState([]);
  const [questionsState, setQuestionsState] = useState(REQUEST_STATE.idle);
  const [questionError, setQuestionError] = useState('');
  const [questions, setQuestions] = useState([]);
  const [suggestions, setSuggestions] = useState({});
  const [submitState, setSubmitState] = useState(REQUEST_STATE.idle);
  const [submitError, setSubmitError] = useState('');
  const [studentScope, setStudentScope] = useState('all'); // 'all' | 'mine' | `inst:<id>`
  const [statusFilter, setStatusFilter] = useState('active'); // 'active' | 'inactive' | 'all'
  const [canViewInactive, setCanViewInactive] = useState(false);
  const [visibilityLoaded, setVisibilityLoaded] = useState(false);
  const [initialStatusApplied, setInitialStatusApplied] = useState(false);
  const [successState, setSuccessState] = useState(null); // { studentId, studentName, date }
  const formResetRef = useRef(null); // Will hold the form's reset function
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false); // Track advanced filter visibility

  // Fix for mobile: prevent Dialog close when Select is open/closing
  const openSelectCountRef = useRef(0);
  const isClosingSelectRef = useRef(false);

  const activeOrgId = activeOrg?.id || null;
  const membershipRole = normalizeMembershipRole(activeOrg?.membership?.role);
  const canAdmin = isAdminRole(membershipRole);
  const userId = user?.id || null;
  
  const canFetchStudents = useMemo(() => {
    return (
      open &&
      Boolean(activeOrgId) &&
      activeOrgHasConnection &&
      tenantClientReady &&
      !supabaseLoading
    );
  }, [open, activeOrgId, activeOrgHasConnection, tenantClientReady, supabaseLoading]);

  const { instructors } = useInstructors({
    enabled: open && canFetchStudents && canAdmin,
    orgId: activeOrgId,
  });

  const { services } = useServices({
    enabled: open && canFetchStudents,
    orgId: activeOrgId,
  });

  // Check if the logged-in user is an instructor (must be after instructors is defined)
  const userIsInstructor = useMemo(() => {
    if (!userId || !instructors || instructors.length === 0) return false;
    return instructors.some(inst => inst.id === userId);
  }, [userId, instructors]);

  useEffect(() => {
    if (!open) {
      setStatusFilter('active');
      setCanViewInactive(canAdmin);
      setVisibilityLoaded(false);
      setInitialStatusApplied(false);
      return;
    }

    if (canAdmin) {
      setCanViewInactive(true);
      setVisibilityLoaded(true);
      return;
    }

    if (!activeOrgId || !activeOrgHasConnection || !tenantClientReady) {
      setCanViewInactive(false);
      setVisibilityLoaded(false);
      if (statusFilter !== 'active') {
        setStatusFilter('active');
      }
      setInitialStatusApplied(false);
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();

    const loadVisibilitySetting = async () => {
      try {
        const searchParams = new URLSearchParams({ org_id: activeOrgId, keys: 'instructors_can_view_inactive_students' });
        const payload = await authenticatedFetch(`settings?${searchParams.toString()}`, {
          signal: abortController.signal,
        });
        const entry = payload?.settings?.instructors_can_view_inactive_students;
        const value = entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'value')
          ? entry.value
          : entry;
        const allowed = value === true;
        if (!cancelled) {
          setCanViewInactive(allowed);
          setVisibilityLoaded(true);
          if (!allowed && statusFilter !== 'active') {
            setStatusFilter('active');
          }
          if (!allowed) {
            setInitialStatusApplied(false);
          }
        }
      } catch (error) {
        if (error?.name === 'AbortError') {
          return;
        }
        console.error('Failed to load inactive visibility setting for session modal', error);
        if (!cancelled) {
          setCanViewInactive(false);
          setVisibilityLoaded(true);
          if (statusFilter !== 'active') {
            setStatusFilter('active');
          }
          setInitialStatusApplied(false);
        }
      }
    };

    void loadVisibilitySetting();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [open, membershipRole, activeOrgId, activeOrgHasConnection, tenantClientReady, statusFilter, canAdmin]);

  useEffect(() => {
    if (!open) {
      setSubmitState(REQUEST_STATE.idle);
      setSubmitError('');
      setSuccessState(null);
      setShowAdvancedFilters(false); // Reset advanced filters visibility when modal closes
    }
  }, [open]);

  const loadStudents = useCallback(async (options = {}) => {
    if (!canFetchStudents) {
      return;
    }

    setStudentsState(REQUEST_STATE.loading);
    setStudentsError('');

    try {
      // Use unified students-list endpoint for all scenarios
      const overrideStatus = typeof options.status === 'string' ? options.status : null;
      const statusParam = canViewInactive ? (overrideStatus || statusFilter) : 'active';
      
      const searchParams = new URLSearchParams();
      if (activeOrgId) searchParams.set('org_id', activeOrgId);
      if (statusParam) searchParams.set('status', statusParam);
      
      // Admin can filter by instructor via assigned_instructor_id parameter
      if (canAdmin && studentScope.startsWith('inst:')) {
        const instructorId = studentScope.slice(5);
        if (instructorId) searchParams.set('assigned_instructor_id', instructorId);
      }
      
      const endpoint = searchParams.toString() ? `students-list?${searchParams}` : 'students-list';
      const payload = await authenticatedFetch(endpoint);
      setStudents(Array.isArray(payload) ? payload : []);
      setStudentsState(REQUEST_STATE.idle);
    } catch (error) {
      console.error('Failed to load session students', error);
      setStudents([]);
      setStudentsState(REQUEST_STATE.error);
      setStudentsError(error?.message || 'טעינת רשימת התלמידים נכשלה.');
    }
  }, [activeOrgId, canFetchStudents, studentScope, statusFilter, canViewInactive, canAdmin]);

  const loadQuestions = useCallback(async () => {
    if (!open || !canFetchStudents) {
      return;
    }

    setQuestionsState(REQUEST_STATE.loading);
    setQuestionError('');

    try {
      const searchParams = new URLSearchParams({ keys: 'session_form_config', include_metadata: '1' });
      if (activeOrgId) {
        searchParams.set('org_id', activeOrgId);
      }
      const payload = await authenticatedFetch(`settings?${searchParams.toString()}`);
      const entry = payload?.settings?.session_form_config ?? null;
      const settingsValue = entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'value') ? entry.value : entry;
      const normalized = ensureSessionFormFallback(parseSessionFormConfig(settingsValue));
      const metadata = entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'metadata') ? entry.metadata : null;
      const preanswers = metadata && typeof metadata === 'object' && metadata.preconfigured_answers && typeof metadata.preconfigured_answers === 'object'
        ? metadata.preconfigured_answers
        : {};
      setQuestions(normalized);
      setSuggestions(preanswers);
      setQuestionsState(REQUEST_STATE.idle);
    } catch (error) {
      console.error('Failed to load session form configuration', error);
      setQuestions(ensureSessionFormFallback([]));
      setQuestionsState(REQUEST_STATE.error);
      setQuestionError(error?.message || 'טעינת שאלות המפגש נכשלה.');
    }
  }, [open, canFetchStudents, activeOrgId]);

  useEffect(() => {
    if (open) {
      void loadQuestions();
    } else {
      setStudentsState(REQUEST_STATE.idle);
      setStudentsError('');
      setStudents([]);
      setInitialStatusApplied(false);
      setQuestionsState(REQUEST_STATE.idle);
      setQuestionError('');
      setQuestions([]);
      setSuggestions({});
      setStudentScope('all');
    }
  }, [open, loadQuestions]);

  useEffect(() => {
    if (!open || !canFetchStudents) {
      return;
    }

    if (!canViewInactive && statusFilter !== 'active') {
      setStatusFilter('active');
      setInitialStatusApplied(false);
      return;
    }

    const shouldForceInactive = (
      canViewInactive &&
      initialStudentId &&
      initialStudentStatus === 'inactive' &&
      !initialStatusApplied
    );

    if (shouldForceInactive && statusFilter !== 'inactive') {
      setStatusFilter('inactive');
      setInitialStatusApplied(true);
      return;
    }

    if (shouldForceInactive && statusFilter === 'inactive') {
      setInitialStatusApplied(true);
    }

    const effectiveStatus = canViewInactive ? statusFilter : 'active';
    void loadStudents({ status: effectiveStatus });
  }, [
    open,
    canFetchStudents,
    canViewInactive,
    statusFilter,
    initialStudentId,
    initialStudentStatus,
    initialStatusApplied,
    loadStudents,
  ]);

  // Mobile fix: Track Select open/close state to prevent Dialog from closing
  const handleSelectOpenChange = useCallback((isOpen) => {
    if (!isOpen && openSelectCountRef.current > 0) {
      isClosingSelectRef.current = true;
      setTimeout(() => {
        openSelectCountRef.current -= 1;
        if (openSelectCountRef.current < 0) {
          openSelectCountRef.current = 0;
        }
        isClosingSelectRef.current = false;
      }, 100);
    } else if (isOpen) {
      openSelectCountRef.current += 1;
    }
  }, []);

  // Mobile fix: Prevent Dialog close if Select is open or closing
  const handleDialogInteractOutside = useCallback((event) => {
    if (openSelectCountRef.current > 0 || isClosingSelectRef.current) {
      event.preventDefault();
    }
  }, []);

  const handleSubmit = async ({ studentId, date, time, serviceContext, answers, unassignedDetails, instructorId }) => {
    setSubmitState(REQUEST_STATE.loading);
    setSubmitError('');

    try {
      const body = {
        student_id: studentId,
        date,
        time,
        service_context: serviceContext,
        content: answers,
        org_id: activeOrgId,
        ...(unassignedDetails ? { unassigned_details: unassignedDetails } : {}),
        ...(instructorId ? { instructor_id: instructorId } : {}),
      };
      const record = await authenticatedFetch('sessions', {
        method: 'POST',
        body,
      });
      
      // Enhanced toast with longer duration for mobile visibility
      toast.success('המפגש נשמר בהצלחה.', { 
        duration: 2500,
        position: 'top-center',
      });
      
      // Wait for the onCreated callback to complete
      // This ensures any data refresh in the parent component completes
      await Promise.resolve(onCreated?.(record));
      
      // Dispatch global event for pages that need to refetch data
      window.dispatchEvent(new CustomEvent('session-created', { detail: { record } }));
      
      const isLoose = !studentId;
      const student = students.find(s => s.id === studentId);
      const studentName = isLoose ? (unassignedDetails?.name || 'תלמיד/ה') : (student?.name || 'תלמיד');
      
      // Show success state instead of closing, preserving loose report metadata for additional reports
      setSuccessState({
        studentId,
        studentName,
        date,
        allowSameStudent: Boolean(studentId),
        // Preserve loose report metadata if creating a loose report
        ...(isLoose && {
          looseName: unassignedDetails?.name,
          looseReason: unassignedDetails?.reason,
          looseReasonOther: unassignedDetails?.reason_other,
          looseService: serviceContext,
        }),
      });
      setSubmitState(REQUEST_STATE.idle);
    } catch (error) {
      console.error('Failed to save session record', error);
      setSubmitState(REQUEST_STATE.error);
      // Map known server messages to clear, localized explanations
      const serverMessage = error?.data?.message || error?.message || '';
      let friendly = 'שמירת המפגש נכשלה.';
      if (serverMessage === 'student_missing_instructor') {
        friendly = 'לא ניתן לתעד מפגש: לתלמיד זה לא משויך מדריך פעיל. נא לשייך מדריך תחילה.';
      } else if (serverMessage === 'student_not_assigned_to_user') {
        friendly = 'לא ניתן לתעד: תלמיד זה לא משויך אליך.';
      } else if (serverMessage === 'missing_unassigned_name') {
        friendly = 'יש למלא שם תלמיד עבור דיווח לא משויך.';
      } else if (serverMessage === 'missing_unassigned_reason') {
        friendly = 'בחרו סיבת דיווח לא משויך.';
      } else if (serverMessage === 'missing_unassigned_reason_detail') {
        friendly = 'השלימו פירוט עבור סיבת "אחר".';
      } else if (serverMessage === 'missing_time') {
        friendly = 'יש להזין שעה עבור דיווח לא משויך.';
      }
      setSubmitError(friendly);
    }
  };

  const handleCloseAfterSuccess = useCallback(() => {
    setSuccessState(null);
    onClose?.();
  }, [onClose]);

  const handleNewReport = useCallback(({ date = null } = {}) => {
    setSuccessState(null);
    // Reset form using the ref, clearing student but preserving date selection
    if (formResetRef.current) {
      formResetRef.current({ 
        date,
      });
    }
  }, []);

  const handleNewReportSameStudent = useCallback(({ date = null } = {}) => {
    if (!successState) return;
    setSuccessState(null);
    // Reset form but keep the same student and optionally set date
    // For loose reports, also preserve name, reason, and service
    if (formResetRef.current) {
      formResetRef.current({ 
        keepStudent: true, 
        studentId: successState.studentId,
        date,
        // Preserve loose report metadata for follow-up loose reports
        ...(successState.looseName && {
          looseName: successState.looseName,
          looseReason: successState.looseReason,
          looseReasonOther: successState.looseReasonOther,
          looseService: successState.looseService,
        }),
      });
    }
  }, [successState]);

  const dialogTitle = canFetchStudents
    ? 'רישום מפגש חדש'
    : 'לא ניתן ליצור מפגש חדש';

  const isLoadingStudents = studentsState === REQUEST_STATE.loading;
  const isLoadingQuestions = questionsState === REQUEST_STATE.loading;
  const showLoading = isLoadingStudents || isLoadingQuestions;

  const [isFormValid, setIsFormValid] = useState(false);

  const footer = canFetchStudents && !showLoading && studentsState !== REQUEST_STATE.error ? (
    successState ? (
      <DateChoiceFooter
        lastReportDate={successState.date}
        studentName={successState.studentName}
        onClose={handleCloseAfterSuccess}
        onNewReport={handleNewReport}
        onNewReportSameStudent={handleNewReportSameStudent}
      />
    ) : (
      <NewSessionFormFooter
        onSubmit={() => {
          // Trigger form submission via form id
          document.getElementById('new-session-form')?.requestSubmit();
        }}
        onCancel={onClose}
        isSubmitting={submitState === REQUEST_STATE.loading}
        isFormValid={isFormValid}
      />
    )
  ) : null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { onClose?.(); } }}>
      <DialogContent 
        className="sm:max-w-xl" 
        footer={footer}
        onInteractOutside={handleDialogInteractOutside}
      >
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>

        {!canFetchStudents ? (
          <div className="space-y-sm text-sm text-neutral-600">
            <p>יש לבחור ארגון בעל חיבור פעיל כדי ליצור מפגש חדש.</p>
          </div>
        ) : showLoading ? (
          <div className="flex items-center justify-center gap-sm py-lg text-neutral-600" role="status">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            <span>טוען נתונים...</span>
          </div>
        ) : studentsState === REQUEST_STATE.error ? (
          <div className="rounded-lg bg-red-50 p-md text-sm text-red-700" role="alert">
            {studentsError || 'טעינת רשימת התלמידים נכשלה.'}
          </div>
        ) : (
          <NewSessionForm
            students={students}
            questions={questions}
            suggestions={suggestions}
            services={services}
            instructors={instructors}
            canFilterByInstructor={isAdminRole(membershipRole)}
            userIsInstructor={userIsInstructor}
            studentScope={studentScope}
            onScopeChange={(next) => setStudentScope(next)}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            canViewInactive={canViewInactive}
            visibilityLoaded={visibilityLoaded}
            initialStudentId={initialStudentId}
            initialDate={initialDate}
            isLoadingStudents={isLoadingStudents}
            onSubmit={handleSubmit}
            onCancel={onClose}
            isSubmitting={submitState === REQUEST_STATE.loading}
            error={submitError || (questionsState === REQUEST_STATE.error ? questionError : '')}
            renderFooterOutside={true}
            onFormValidityChange={setIsFormValid}
            onSelectOpenChange={handleSelectOpenChange}
            formResetRef={formResetRef}
            successState={successState}
            showAdvancedFilters={showAdvancedFilters}
            onShowAdvancedFiltersChange={setShowAdvancedFilters}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
