import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Loader2, Pencil, X, User, FileWarning, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useInstructors, useStudents } from '@/hooks/useOrgData.js';
import AddStudentForm, { AddStudentFormFooter } from '@/features/admin/components/AddStudentForm.jsx';
import EditStudentModal from '@/features/admin/components/EditStudentModal.jsx';
import DataMaintenanceModal from '@/features/admin/components/DataMaintenanceModal.jsx';
import { DataMaintenanceMenu } from '@/features/admin/components/DataMaintenanceMenu.jsx';
import { StudentFilterSection } from '@/features/students/components/StudentFilterSection.jsx';
import PageLayout from '@/components/ui/PageLayout.jsx';
import { DAY_NAMES, formatDefaultTime, dayMatches } from '@/features/students/utils/schedule.js';
import DayOfWeekSelect from '@/components/ui/DayOfWeekSelect.jsx';
import { normalizeTagIdsForWrite } from '@/features/students/utils/tags.js';
import { useStudentTags } from '@/features/students/hooks/useStudentTags.js';
import { getStudentComparator, STUDENT_SORT_OPTIONS } from '@/features/students/utils/sorting.js';
import { saveFilterState, loadFilterState } from '@/features/students/utils/filter-state.js';
import { normalizeMembershipRole, isAdminRole } from '@/features/students/utils/endpoints.js';
import { fetchLooseSessions } from '@/features/sessions/api/loose-sessions.js';
import MyPendingReportsCard from '@/features/sessions/components/MyPendingReportsCard.jsx';

export default function StudentsPage() {
  const { activeOrg, activeOrgId, activeOrgHasConnection, tenantClientReady } = useOrg();
  const { session, user, loading: supabaseLoading } = useSupabase();
  const navigate = useNavigate();

  // All hooks must be called before any conditional returns
  const { tagOptions, loadTags } = useStudentTags();
  const [studentsError, setStudentsError] = useState('');
  const [complianceSummary, setComplianceSummary] = useState({}); // Map of student_id -> { expiredDocuments: number }
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isCreatingStudent, setIsCreatingStudent] = useState(false);
  const [createError, setCreateError] = useState('');
  const [studentForEdit, setStudentForEdit] = useState(null);
  const [isUpdatingStudent, setIsUpdatingStudent] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const [addSubmitDisabled, setAddSubmitDisabled] = useState(false);
  const [isMaintenanceOpen, setIsMaintenanceOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dayFilter, setDayFilter] = useState(null);
  const [instructorFilterId, setInstructorFilterId] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [sortBy, setSortBy] = useState(STUDENT_SORT_OPTIONS.SCHEDULE); // Default sort by schedule
  const [statusFilter, setStatusFilter] = useState('active'); // 'active' | 'inactive' | 'all'
  const [filteredStudents, setFilteredStudents] = useState([]); // Local client-side filtered list
  const [filtersRestored, setFiltersRestored] = useState(false); // Track when filters have been restored from sessionStorage
  const [pendingReportsCount, setPendingReportsCount] = useState(0); // Count of loose reports awaiting assignment
  const [pendingReportsDialogOpen, setPendingReportsDialogOpen] = useState(false); // For instructor's pending reports dialog
  const [canViewInactive, setCanViewInactive] = useState(false); // For instructors - permission to view inactive students

  // Mobile fix: prevent Dialog close when Select is open/closing
  const openSelectCountRef = useRef(0);
  const isClosingSelectRef = useRef(false);

  // Determine user role
  const membershipRole = activeOrg?.membership?.role;
  const normalizedRole = useMemo(() => normalizeMembershipRole(membershipRole), [membershipRole]);
  const isAdmin = isAdminRole(normalizedRole);

  // Filter mode for state persistence
  const filterMode = isAdmin ? 'admin' : 'instructor';

  const canFetch = Boolean(
    session &&
      activeOrgId &&
      tenantClientReady &&
      activeOrgHasConnection,
  );

  // Instructors need to load visibility permission
  const canFetchVisibility = canFetch && !isAdmin;

  const { instructors } = useInstructors({
    enabled: canFetch && isAdmin, // Only admins need the full instructor list
    orgId: activeOrgId,
  });

  const instructorMap = useMemo(() => {
    return instructors.reduce((map, instructor) => {
      if (instructor?.id) {
        map.set(instructor.id, instructor);
      }
      return map;
    }, new Map());
  }, [instructors]);

  // Determine effective status for API call
  const effectiveStatus = isAdmin 
    ? (statusFilter === 'all' ? 'all' : statusFilter)
    : (canViewInactive ? statusFilter : 'active');

  const { students, loadingStudents, studentsError: hookStudentsError, refetchStudents } = useStudents({
    status: effectiveStatus,
    enabled: canFetch && filtersRestored,
    orgId: activeOrgId,
    session,
  });

  const fetchComplianceSummary = useCallback(async () => {
    if (!canFetch || !isAdmin) {
      return;
    }

    try {
      const searchParams = new URLSearchParams({ org_id: activeOrgId });
      const payload = await authenticatedFetch(`students/compliance-summary?${searchParams.toString()}`, { session });
      setComplianceSummary(payload || {});
    } catch (error) {
      console.error('Failed to load compliance summary', error);
      // Don't show error toast - this is supplementary data
      setComplianceSummary({});
    }
  }, [canFetch, isAdmin, activeOrgId, session]);

  const fetchPendingReportsCount = useCallback(async () => {
    if (!canFetch) {
      return;
    }

    try {
      const reports = await fetchLooseSessions({ orgId: activeOrgId, session });
      // Count only pending reports (not rejected, not accepted)
      const pendingOnly = Array.isArray(reports) 
        ? reports.filter(r => !r.student_id && !r.deleted && !r.isRejected)
        : [];
      setPendingReportsCount(pendingOnly.length);
    } catch (error) {
      console.error('Failed to load pending reports count', error);
      // Don't show error toast - this is supplementary data
      setPendingReportsCount(0);
    }
  }, [canFetch, activeOrgId, session]);

  const refreshRoster = useCallback(async () => {
    const promises = [
      refetchStudents(),
      // Compliance summary is optional - don't let it block the main data load
      ...(isAdmin ? [fetchComplianceSummary().catch(() => {})] : []),
    ];
    
    await Promise.all(promises);
  }, [refetchStudents, fetchComplianceSummary, isAdmin]);

  useEffect(() => {
    if (hookStudentsError) {
      setStudentsError(hookStudentsError || 'טעינת רשימת התלמידים נכשלה.');
      toast.error('טעינת רשימת התלמידים נכשלה.');
    } else {
      setStudentsError('');
    }
  }, [hookStudentsError]);

  const handleMaintenanceCompleted = useCallback(async () => {
    await refreshRoster();
  }, [refreshRoster]);

  // Load saved filter state on mount FIRST, before any fetching happens
  useEffect(() => {
    if (!activeOrgId) {
      setFiltersRestored(false);
      return;
    }
    
    const savedFilters = loadFilterState(activeOrgId, filterMode);
    if (savedFilters) {
      if (savedFilters.searchQuery !== undefined) setSearchQuery(savedFilters.searchQuery);
      if (savedFilters.dayFilter !== undefined) setDayFilter(savedFilters.dayFilter);
      if (savedFilters.tagFilter !== undefined) setTagFilter(savedFilters.tagFilter);
      if (savedFilters.sortBy !== undefined) setSortBy(savedFilters.sortBy);
      
      // Admin-only filters
      if (isAdmin) {
        if (savedFilters.instructorFilterId !== undefined) setInstructorFilterId(savedFilters.instructorFilterId);
        if (savedFilters.statusFilter !== undefined) setStatusFilter(savedFilters.statusFilter);
      }
      // Instructor statusFilter will be restored after permission check
    }
    
    // Mark filters as restored so fetching can proceed
    setFiltersRestored(true);
  }, [activeOrgId, filterMode, isAdmin]);

  // Load visibility setting for instructors and handle statusFilter restoration
  useEffect(() => {
    if (!canFetchVisibility || !filtersRestored) {
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
          
          // If permission is not available, force to 'active'
          if (!allowed) {
            setStatusFilter('active');
          } else {
            // Permission is available - restore saved filter if exists
            const savedFilters = loadFilterState(activeOrgId, filterMode);
            if (savedFilters?.statusFilter && savedFilters.statusFilter !== 'active') {
              setStatusFilter(savedFilters.statusFilter);
            }
          }
        }
      } catch (error) {
        if (error?.name === 'AbortError') {
          return;
        }
        console.error('Failed to load instructor visibility setting', error);
        if (!cancelled) {
          setCanViewInactive(false);
          setStatusFilter('active');
        }
      }
    };

    void loadVisibilitySetting();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [canFetchVisibility, activeOrgId, filterMode, filtersRestored]);

  // Separate effect: force statusFilter to 'active' when permission is revoked (instructors only)
  useEffect(() => {
    if (!isAdmin && !canViewInactive && statusFilter !== 'active') {
      setStatusFilter('active');
    }
  }, [isAdmin, canViewInactive, statusFilter]);

  // Fetch students and instructors only AFTER filters have been restored
  useEffect(() => {
    if (canFetch && filtersRestored) {
      // Refetch when statusFilter changes to get the right subset from server
      refreshRoster();
      void loadTags();
      void fetchPendingReportsCount();
    } else {
      setPendingReportsCount(0);
    }
  }, [canFetch, filtersRestored, refreshRoster, loadTags, fetchPendingReportsCount]);

  // Listen for session creation events to refetch pending reports count
  useEffect(() => {
    const handleSessionCreated = () => {
      void fetchPendingReportsCount();
    };
    
    window.addEventListener('session-created', handleSessionCreated);
    
    return () => {
      window.removeEventListener('session-created', handleSessionCreated);
    };
  }, [fetchPendingReportsCount]);

  // Default the view for admins/owners who are also instructors to "mine" on first visit
  useEffect(() => {
    if (!isAdmin || !user || !Array.isArray(instructors) || instructors.length === 0 || !activeOrgId) return;
    
    // Check if this admin is also an instructor
    const isInstructor = instructors.some((i) => i?.id === user.id);
    if (!isInstructor) return;
    
    // Only set default if no saved 'admin' filter exists for this org at all (truly first visit)
    const savedFilters = loadFilterState(activeOrgId, 'admin');
    const isFirstVisit = !savedFilters || Object.keys(savedFilters).length === 0;
    
    if (isFirstVisit) {
      setInstructorFilterId(user.id);
    }
  }, [isAdmin, user, instructors, activeOrgId]);

  // Save filter state whenever it changes
  useEffect(() => {
    if (activeOrgId) {
      const filterState = {
        searchQuery,
        dayFilter,
        tagFilter,
        sortBy,
        statusFilter,
      };
      
      // Admin-only filter
      if (isAdmin) {
        filterState.instructorFilterId = instructorFilterId;
      }
      
      saveFilterState(activeOrgId, filterMode, filterState);
    }
  }, [activeOrgId, filterMode, isAdmin, searchQuery, dayFilter, instructorFilterId, tagFilter, sortBy, statusFilter]);

  // Client-side filtering and sorting - applied to all fetched students
  useEffect(() => {
    let result = [...students]; // Always copy to prevent mutation

    // Filter by status
    if (isAdmin && statusFilter !== 'all') {
      result = result.filter((s) => {
        const isActive = s.is_active !== false;
        return statusFilter === 'active' ? isActive : !isActive;
      });
    } else if (!isAdmin && canViewInactive && statusFilter !== 'all') {
      result = result.filter((s) => {
        const isActive = s.is_active !== false;
        return statusFilter === 'active' ? isActive : !isActive;
      });
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((s) => {
        const name = (s.name || '').toLowerCase();
        const phone = (s.contact_phone || '').toLowerCase();
        const identityNumber = (s.identity_number || s.national_id || '').toLowerCase();
        const studentPhone = (s.phone || '').toLowerCase();
        return name.includes(query) || phone.includes(query) || studentPhone.includes(query) || identityNumber.includes(query);
      });
    }

    // Filter by day of week
    if (dayFilter !== null) {
      result = result.filter((s) => dayMatches(s.default_day_of_week, dayFilter));
    }

    // Filter by instructor (admin only)
    if (isAdmin && instructorFilterId) {
      result = result.filter((s) => s.assigned_instructor_id === instructorFilterId);
    }

    // Filter by tag
    if (tagFilter) {
      result = result.filter((s) => {
        const studentTags = s.tags || [];
        return studentTags.includes(tagFilter);
      });
    }

    // Sort
    const comparator = getStudentComparator(sortBy);
    result.sort(comparator);

    setFilteredStudents(result);
  }, [students, isAdmin, statusFilter, searchQuery, dayFilter, instructorFilterId, tagFilter, sortBy, canViewInactive]);

  const handleResetFilters = () => {
    setSearchQuery('');
    setDayFilter(null);
    setTagFilter('');
    setSortBy(STUDENT_SORT_OPTIONS.SCHEDULE);
    setStatusFilter('active');
    
    // Admin-only filter
    if (isAdmin) {
      setInstructorFilterId('');
    }
  };

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    const commonFilters = (
      searchQuery.trim() !== '' ||
      dayFilter !== null ||
      tagFilter !== ''
    );
    
    if (isAdmin) {
      return commonFilters || instructorFilterId !== '' || statusFilter !== 'active';
    } else {
      return commonFilters || (canViewInactive && statusFilter !== 'active');
    }
  }, [isAdmin, searchQuery, dayFilter, instructorFilterId, tagFilter, statusFilter, canViewInactive]);

  const handleOpenAddDialog = () => {
    setCreateError('');
    setIsAddDialogOpen(true);
  };

  const handleAddDialogOpenChange = (open) => {
    if (!open) {
      openSelectCountRef.current = 0;
      isClosingSelectRef.current = false;
      setIsAddDialogOpen(false);
      setCreateError('');
    } else {
      setIsAddDialogOpen(true);
    }
  };

  const handleAddSubmit = async (formData) => {
    if (!session || !activeOrgId || !tenantClientReady || !activeOrgHasConnection) {
      setCreateError('חיבור לא זמין. ודא את החיבור וניסיון מחדש.');
      return;
    }

    setIsCreatingStudent(true);
    setCreateError('');

    // AddStudentForm submits camelCase; keep snake_case compatibility as well.
    const body = {
      org_id: activeOrgId,
      name: formData.name,
      assigned_instructor_id: formData.assigned_instructor_id ?? formData.assignedInstructorId,
      tags: normalizeTagIdsForWrite(formData.tags),
      default_service: formData.default_service ?? formData.defaultService ?? '',
      default_day_of_week: formData.default_day_of_week ?? formData.defaultDayOfWeek,
      default_session_time: formData.default_session_time ?? formData.defaultSessionTime ?? '',
      identity_number: (formData.identity_number ?? formData.identityNumber ?? '').trim(),
      phone: (formData.phone ?? '').trim(),
      email: (formData.email ?? '').trim(),
      contact_name: (formData.contact_name ?? formData.contactName ?? '').trim(),
      contact_phone: (formData.contact_phone ?? formData.contactPhone ?? '').trim(),
      notes: (formData.notes ?? '').trim(),
      is_active: formData.is_active ?? formData.isActive,
    };

    try {
      await authenticatedFetch('students-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        session,
      });
      toast.success('התלמיד נוסף בהצלחה');
      await refreshRoster();
      setIsAddDialogOpen(false);
    } catch (error) {
      const apiMessage = error?.data?.message || error?.message;
      const apiCode = error?.data?.error || error?.data?.code || error?.code;
      console.error('[students-list][POST] Failed to create student', {
        status: error?.status,
        code: apiCode,
        message: apiMessage,
      });
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

  const handleEditStudent = (student) => {
    setStudentForEdit(student);
  };

  const handleEditModalClose = () => {
    setStudentForEdit(null);
    setUpdateError('');
  };

  const handleEditSubmit = async (studentId, updates) => {
    if (!session || !activeOrgId || !tenantClientReady || !activeOrgHasConnection) {
      setUpdateError('חיבור לא זמין. ודא את החיבור וניסיון מחדש.');
      return;
    }

    setIsUpdatingStudent(true);
    setUpdateError('');

    const body = {
      org_id: activeOrgId,
      ...updates,
      tags: normalizeTagIdsForWrite(updates.tags),
    };

    try {
      await authenticatedFetch(`students-list/${studentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        session,
      });
      toast.success('פרטי התלמיד עודכנו בהצלחה');
      await refreshRoster();
      handleEditModalClose();
    } catch (error) {
      const apiMessage = error?.data?.message || error?.message;
      const apiCode = error?.data?.error || error?.data?.code || error?.code;
      console.error('[students-list][PUT] Failed to update student', {
        status: error?.status,
        code: apiCode,
        message: apiMessage,
      });
      let message = 'עדכון פרטי התלמיד נכשל.';
      if (apiCode === 'identity_number_duplicate' || apiMessage === 'duplicate_identity_number') {
        message = 'תעודת זהות קיימת כבר במערכת.';
      } else if (apiMessage === 'invalid national id') {
        message = 'מספר זהות לא תקין. יש להזין 5–12 ספרות.';
      } else if (apiCode === 'schema_upgrade_required') {
        message = 'נדרשת שדרוג לסכמת מסד הנתונים.';
      }
      setUpdateError(message);
      toast.error(message);
    } finally {
      setIsUpdatingStudent(false);
    }
  };

  const isLoading = loadingStudents && canFetch && filtersRestored;
  const isError = Boolean(studentsError);
  const isSuccess = !isLoading && !isError && canFetch && filtersRestored;
  const errorMessage = studentsError || 'טעינת רשימת התלמידים נכשלה.';
  const hasNoResults = isSuccess && filteredStudents.length === 0;

  // Page title and description based on role
  const pageTitle = isAdmin ? 'ניהול תלמידים' : 'התלמידים שלי';
  const pageDescription = isAdmin 
    ? 'ניהול רשימת התלמידים, הוספת תלמידים חדשים, ושיוך תלמידים למדריכים.'
    : 'רשימת התלמידים שהוקצו לך בארגון הנוכחי.';

  return (
    <PageLayout
      title={pageTitle}
      description={pageDescription}
      fullHeight={false}
    >
      {supabaseLoading ? (
        <div className="flex items-center justify-center gap-sm rounded-xl bg-neutral-50 p-lg text-neutral-600" role="status">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span>טוען חיבור מאובטח...</span>
        </div>
      ) : !activeOrg ? (
        <div className="rounded-xl bg-neutral-50 p-lg text-center text-neutral-600" role="status">
          בחרו ארגון כדי להציג את רשימת התלמידים.
        </div>
      ) : !activeOrgHasConnection ? (
        <div className="rounded-xl bg-amber-50 p-lg text-center text-amber-800" role="status">
          דרוש חיבור מאומת למסד הנתונים של הארגון כדי להציג את רשימת התלמידים.
        </div>
      ) : isError ? (
        <div className="rounded-xl bg-red-50 p-lg text-center text-red-700" role="alert">
          {errorMessage || 'טעינת רשימת התלמידים נכשלה. נסו שוב מאוחר יותר.'}
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center gap-sm rounded-xl bg-neutral-50 p-lg text-neutral-600" role="status">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span>טוען את רשימת התלמידים...</span>
        </div>
      ) : isSuccess ? (
        <Card className="w-full">
          <CardHeader className="space-y-sm">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-foreground">
                {isAdmin ? 'רשימת תלמידים' : 'רשימת התלמידים שלי'}
              </CardTitle>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2 border-amber-500 text-amber-700 hover:bg-amber-50"
                    onClick={() => navigate('/pending-reports')}
                  >
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    <span>דיווחים ממתינים</span>
                    {pendingReportsCount > 0 && (
                      <Badge variant="secondary" className="bg-amber-500 text-white hover:bg-amber-600">
                        {pendingReportsCount}
                      </Badge>
                    )}
                  </Button>
                )}
                {!isAdmin && (
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2 border-amber-500 text-amber-700 hover:bg-amber-50"
                    onClick={() => setPendingReportsDialogOpen(true)}
                  >
                    <FileWarning className="h-4 w-4" />
                    <span>דיווחים ממתינים</span>
                    {pendingReportsCount > 0 && (
                      <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                        {pendingReportsCount}
                      </Badge>
                    )}
                  </Button>
                )}
                {isAdmin && (
                  <>
                    <DataMaintenanceMenu
                      instructors={instructors}
                      tags={tagOptions}
                      onImportClick={() => setIsMaintenanceOpen(true)}
                      onImportCompleted={handleMaintenanceCompleted}
                    />
                    <Button onClick={handleOpenAddDialog} className="gap-2">
                      <Plus className="h-4 w-4" />
                      <span>הוספת תלמיד</span>
                    </Button>
                  </>
                )}
              </div>
            </div>

            <StudentFilterSection
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              dayFilter={dayFilter}
              onDayFilterChange={setDayFilter}
              instructorFilterId={instructorFilterId}
              onInstructorFilterChange={setInstructorFilterId}
              tagFilter={tagFilter}
              onTagFilterChange={setTagFilter}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              sortBy={sortBy}
              onSortChange={setSortBy}
              hasActiveFilters={hasActiveFilters}
              onResetFilters={handleResetFilters}
              instructors={instructors}
              tags={tagOptions}
              showInstructorFilter={isAdmin}
              canViewInactive={isAdmin || canViewInactive}
            />
          </CardHeader>

          <CardContent className="p-0">
            {hasNoResults ? (
              <div className="p-lg text-center text-neutral-600">
                לא נמצאו תלמידים התואמים את הסינון.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">שם</TableHead>
                      <TableHead className="text-right">יום מפגש</TableHead>
                      <TableHead className="text-right">שעת מפגש</TableHead>
                      {isAdmin && <TableHead className="text-right">מדריך</TableHead>}
                      <TableHead className="text-right">סטטוס</TableHead>
                      <TableHead className="text-right">פעולות</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredStudents.map((student) => {
                      const instructor = isAdmin ? instructorMap.get(student.assigned_instructor_id) : null;
                      const isInactive = student.is_active === false;
                      const missingIdentityNumber = !(student.identity_number || student.national_id)?.trim();
                      const summary = complianceSummary[student.id] || {};
                      const hasExpiredDocs = summary.expiredDocuments > 0;

                      return (
                        <TableRow key={student.id}>
                          <TableCell className="text-right">
                            <div className="flex flex-col gap-1">
                              <Link
                                to={`/students/${student.id}`}
                                className="font-medium text-primary hover:underline"
                              >
                                {student.name}
                              </Link>
                              {isInactive && (
                                <Badge variant="secondary" className="w-fit bg-neutral-200 text-neutral-700">
                                  לא פעיל
                                </Badge>
                              )}
                              {missingIdentityNumber && (
                                <Badge variant="destructive" className="w-fit gap-1">
                                  <AlertCircle className="h-3 w-3" />
                                  <span>חסרה תעודת זהות</span>
                                </Badge>
                              )}
                              {hasExpiredDocs && (
                                <Badge variant="destructive" className="w-fit gap-1">
                                  <FileWarning className="h-3 w-3" />
                                  <span>{summary.expiredDocuments} מסמכים שפג תוקפם</span>
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {student.default_day_of_week
                              ? DAY_NAMES[student.default_day_of_week]
                              : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            {student.default_session_time
                              ? formatDefaultTime(student.default_session_time)
                              : '—'}
                          </TableCell>
                          {isAdmin && (
                            <TableCell className="text-right">
                              {instructor ? (
                                <span>{instructor.name || instructor.email}</span>
                              ) : (
                                <span className="text-amber-600">לא משוייך</span>
                              )}
                            </TableCell>
                          )}
                          <TableCell className="text-right">
                            {isInactive ? (
                              <Badge variant="secondary">לא פעיל</Badge>
                            ) : (
                              <Badge variant="success">פעיל</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center gap-2">
                              <Link to={`/students/${student.id}`}>
                                <Button variant="ghost" size="icon">
                                  <User className="h-4 w-4" />
                                </Button>
                              </Link>
                              {isAdmin && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleEditStudent(student)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
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
      ) : null}

      {/* Admin-only: Add Student Dialog */}
      {isAdmin && (
        <Dialog open={isAddDialogOpen} onOpenChange={handleAddDialogOpenChange}>
          <DialogContent
            className="sm:max-w-2xl"
            onInteractOutside={(e) => {
              if (openSelectCountRef.current > 0 || isClosingSelectRef.current) {
                e.preventDefault();
              }
            }}
            footer={
              <AddStudentFormFooter
                isSubmitting={isCreatingStudent}
                disableSubmit={addSubmitDisabled}
                onCancel={() => setIsAddDialogOpen(false)}
                onSubmit={() => {
                  document.getElementById('add-student-form')?.requestSubmit();
                }}
              />
            }
          >
            <DialogHeader>
              <DialogTitle>הוספת תלמיד חדש</DialogTitle>
            </DialogHeader>
            <AddStudentForm
              onSubmit={handleAddSubmit}
              onCancel={() => setIsAddDialogOpen(false)}
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

      {/* Admin-only: Edit Student Modal */}
      {isAdmin && studentForEdit && (
        <EditStudentModal
          open={Boolean(studentForEdit)}
          student={studentForEdit}
          isSubmitting={isUpdatingStudent}
          error={updateError}
          onClose={handleEditModalClose}
          onSubmit={handleEditSubmit}
        />
      )}

      {/* Admin-only: Data Maintenance Modal */}
      {isAdmin && (
        <DataMaintenanceModal
          open={isMaintenanceOpen}
          onOpenChange={setIsMaintenanceOpen}
          instructors={instructors}
          tags={tagOptions}
          onImportCompleted={handleMaintenanceCompleted}
        />
      )}

      {/* Instructor-only: Pending Reports Dialog */}
      {!isAdmin && (
        <Dialog open={pendingReportsDialogOpen} onOpenChange={setPendingReportsDialogOpen}>
          <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>דיווחים ממתינים</DialogTitle>
            </DialogHeader>
            <MyPendingReportsCard onResolve={() => void fetchPendingReportsCount()} />
          </DialogContent>
        </Dialog>
      )}
    </PageLayout>
  );
}
