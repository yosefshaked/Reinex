import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { DAY_NAMES, formatDefaultTime } from '@/features/students/utils/schedule.js';
import DayOfWeekSelect from '@/components/ui/DayOfWeekSelect.jsx';
import { normalizeTagIdsForWrite } from '@/features/students/utils/tags.js';
import { useStudentTags } from '@/features/students/hooks/useStudentTags.js';
import { STUDENT_SORT_OPTIONS } from '@/features/students/utils/sorting.js';
import { saveFilterState, loadFilterState } from '@/features/students/utils/filter-state.js';
import { normalizeMembershipRole, isAdminRole } from '@/features/students/utils/endpoints.js';
import { fetchLooseSessions } from '@/features/sessions/api/loose-sessions.js';
import MyPendingReportsCard from '@/features/sessions/components/MyPendingReportsCard.jsx';
import { formatStudentName } from '@/features/students/utils/name-utils.js';

export default function StudentsPage() {
  const { activeOrg, activeOrgId, activeOrgHasConnection, tenantClientReady } = useOrg();
  const { session, loading: supabaseLoading } = useSupabase();
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
  const [tagFilter, setTagFilter] = useState('');
  const [sortBy, setSortBy] = useState(STUDENT_SORT_OPTIONS.SCHEDULE); // Default sort by schedule
  const [statusFilter, setStatusFilter] = useState('active'); // 'active' | 'inactive' | 'all'
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
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
    enabled: canFetch && isAdmin,
    orgId: activeOrgId,
  });

  // Determine effective status for API call
  const effectiveStatus = isAdmin 
    ? (statusFilter === 'all' ? 'all' : statusFilter)
    : (canViewInactive ? statusFilter : 'active');

  const pageOffset = useMemo(() => (Math.max(currentPage, 1) - 1) * pageSize, [currentPage, pageSize]);

  const { students, studentsPagination, loadingStudents, studentsError: hookStudentsError, refetchStudents } = useStudents({
    status: effectiveStatus,
    enabled: canFetch && filtersRestored,
    orgId: activeOrgId,
    session,
    pagination: true,
    limit: pageSize,
    offset: pageOffset,
    search: searchQuery.trim(),
    tag: tagFilter,
    day: dayFilter ?? '',
    sortBy,
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
      if (savedFilters.pageSize !== undefined) setPageSize(savedFilters.pageSize);
      if (savedFilters.currentPage !== undefined) setCurrentPage(savedFilters.currentPage);
      
      // Admin-only filters
      if (isAdmin && savedFilters.statusFilter !== undefined) {
        setStatusFilter(savedFilters.statusFilter);
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

  // Save filter state whenever it changes
  useEffect(() => {
    if (activeOrgId) {
      const filterState = {
        searchQuery,
        dayFilter,
        tagFilter,
        sortBy,
        statusFilter,
        pageSize,
        currentPage,
      };

      saveFilterState(activeOrgId, filterMode, filterState);
    }
  }, [activeOrgId, filterMode, isAdmin, searchQuery, dayFilter, tagFilter, sortBy, statusFilter, pageSize, currentPage]);

  // Server handles search/tag/day/sort. Just mirror the response.
  useEffect(() => {
    setFilteredStudents([...students]);
  }, [students]);

  const handleResetFilters = () => {
    setSearchQuery('');
    setDayFilter(null);
    setTagFilter('');
    setSortBy(STUDENT_SORT_OPTIONS.SCHEDULE);
    setStatusFilter('active');
    setCurrentPage(1);
    
  };

  const handleSearchQueryChange = (value) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const handleDayFilterChange = (value) => {
    setDayFilter(value);
    setCurrentPage(1);
  };

  const handleTagFilterChange = (value) => {
    setTagFilter(value);
    setCurrentPage(1);
  };

  const handleStatusFilterChange = (value) => {
    setStatusFilter(value);
    setCurrentPage(1);
  };

  const handlePageSizeChange = (value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }
    setPageSize(parsed);
    setCurrentPage(1);
  };

  const totalStudents = Number.isFinite(studentsPagination?.total) ? studentsPagination.total : filteredStudents.length;
  const totalPages = Math.max(1, Math.ceil(totalStudents / Math.max(pageSize, 1)));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    const commonFilters = (
      searchQuery.trim() !== '' ||
      dayFilter !== null ||
      tagFilter !== ''
    );
    
    if (isAdmin) {
      return commonFilters || statusFilter !== 'active';
    }
    return commonFilters || (canViewInactive && statusFilter !== 'active');
  }, [isAdmin, searchQuery, dayFilter, tagFilter, statusFilter, canViewInactive]);

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

    // AddStudentForm submits Reinex camelCase structure
    const body = {
      org_id: activeOrgId,
      // Reinex structure: separate name fields
      first_name: formData.firstName,
      middle_name: formData.middleName,
      last_name: formData.lastName,
      identity_number: formData.identityNumber,
      date_of_birth: formData.dateOfBirth,
      guardian_id: formData.guardianId,
      guardian_relationship: formData.guardianRelationship,
      phone: formData.phone,
      email: formData.email,
      medical_provider: formData.medicalProvider,
      default_notification_method: formData.notificationMethod,
      special_rate: formData.specialRate,
      medical_flags: formData.medicalFlags,
      onboarding_status: formData.onboardingStatus,
      notes_internal: formData.notesInternal,
      tags: formData.tags,
      is_active: formData.isActive,
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

  const handleEditSubmit = async (payload) => {
    if (!payload?.id || !session || !activeOrgId || !tenantClientReady || !activeOrgHasConnection) {
      setUpdateError('חיבור לא זמין. ודא את החיבור וניסיון מחדש.');
      return;
    }

    setIsUpdatingStudent(true);
    setUpdateError('');

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
      tags: normalizeTagIdsForWrite(payload.tags),
      isActive: payload.isActive,
      guardianId: payload.guardianId,
      guardianRelationship: payload.guardianRelationship,
    };

    try {
      await authenticatedFetch(`students-list/${payload.id}`, {
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
              onSearchChange={handleSearchQueryChange}
              dayFilter={dayFilter}
              onDayFilterChange={handleDayFilterChange}
              tagFilter={tagFilter}
              onTagFilterChange={handleTagFilterChange}
              statusFilter={statusFilter}
              onStatusFilterChange={handleStatusFilterChange}
              sortBy={sortBy}
              onSortChange={setSortBy}
              hasActiveFilters={hasActiveFilters}
              onResetFilters={handleResetFilters}
              tags={tagOptions}
              showInstructorFilter={false}
              showStatusFilter={isAdmin || canViewInactive}
            />
          </CardHeader>

          <CardContent className="p-0">
            {hasNoResults ? (
              <div className="p-lg text-center text-neutral-600">
                לא נמצאו תלמידים התואמים את הסינון.
              </div>
            ) : (
              <div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">שם</TableHead>
                        <TableHead className="text-right">יום מפגש</TableHead>
                        <TableHead className="text-right">שעת מפגש</TableHead>
                        <TableHead className="text-right">סטטוס</TableHead>
                        <TableHead className="text-right">פעולות</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredStudents.map((student) => {
                        const isInactive = student.is_active === false;
                        const missingIdentityNumber = !(student.identity_number || student.national_id)?.trim();
                        const summary = complianceSummary[student.id] || {};
                        const hasExpiredDocs = summary.expiredDocuments > 0;
                        const additionalTemplates = Array.isArray(student?.additional_templates)
                          ? student.additional_templates
                          : [];
                        const activeTemplateCount = Number.parseInt(student?.active_template_count, 10);
                        const extraTemplateCount = Number.isInteger(activeTemplateCount) && activeTemplateCount > 1
                          ? activeTemplateCount - 1
                          : 0;
                        const additionalTemplatesTitle = additionalTemplates.length
                          ? additionalTemplates
                            .map((template) => {
                              const dayLabel = DAY_NAMES[template?.day_of_week] || 'יום לא מוגדר';
                              const timeLabel = template?.time_of_day ? formatDefaultTime(template.time_of_day) : 'שעה לא מוגדרת';
                              return `${dayLabel} • ${timeLabel}`;
                            })
                            .join('\n')
                          : '';

                        return (
                          <TableRow key={student.id}>
                            <TableCell className="text-right">
                              <div className="flex flex-col gap-1">
                                <Link
                                  to={`/students/${student.id}`}
                                  className="font-medium text-primary hover:underline"
                                >
                                  {formatStudentName(student)}
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
                              <div className="flex items-center justify-end gap-2" dir="ltr">
                                {extraTemplateCount > 0 ? (
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-6 min-w-6 rounded-full px-2 text-[10px]"
                                        title={additionalTemplatesTitle || 'תבניות נוספות'}
                                      >
                                        +{extraTemplateCount}
                                      </Button>
                                    </PopoverTrigger>
                                    <PopoverContent align="end" className="w-64 text-right" dir="rtl">
                                      <div className="space-y-2">
                                        <p className="text-xs font-semibold text-neutral-700">
                                          תבניות נוספות לתלמיד
                                        </p>
                                        {additionalTemplates.length ? (
                                          <ul className="space-y-1 text-xs text-neutral-600">
                                            {additionalTemplates.map((template, index) => {
                                              const dayLabel = DAY_NAMES[template?.day_of_week] || 'יום לא מוגדר';
                                              const timeLabel = template?.time_of_day
                                                ? formatDefaultTime(template.time_of_day)
                                                : 'שעה לא מוגדרת';

                                              return (
                                                <li key={`${student.id}-additional-template-${index}`} className="rounded border px-2 py-1">
                                                  {dayLabel}
                                                  {' '}
                                                  •
                                                  {' '}
                                                  {timeLabel}
                                                </li>
                                              );
                                            })}
                                          </ul>
                                        ) : (
                                          <p className="text-xs text-neutral-500">לא נמצאו תבניות נוספות.</p>
                                        )}
                                      </div>
                                    </PopoverContent>
                                  </Popover>
                                ) : null}
                                <span>
                                  {student.default_day_of_week
                                    ? DAY_NAMES[student.default_day_of_week] || '—'
                                    : '—'}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              {student.default_session_time
                                ? formatDefaultTime(student.default_session_time)
                                : '—'}
                            </TableCell>
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

                <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-muted-foreground">
                    מציג
                    {' '}
                    {totalStudents === 0 ? 0 : pageOffset + 1}
                    {' '}
                    -
                    {' '}
                    {Math.min(pageOffset + filteredStudents.length, totalStudents)}
                    {' '}
                    מתוך
                    {' '}
                    {totalStudents}
                  </div>

                  <div className="flex items-center gap-2">
                    <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                      <SelectTrigger className="w-[110px]">
                        <SelectValue placeholder="כמות" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="25">25</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                      </SelectContent>
                    </Select>

                    <Button
                      type="button"
                      variant="outline"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    >
                      הקודם
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      עמוד {currentPage} מתוך {totalPages}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!studentsPagination?.hasMore}
                      onClick={() => setCurrentPage((prev) => prev + 1)}
                    >
                      הבא
                    </Button>
                  </div>
                </div>
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
              <DialogDescription>
                הזן את פרטי התלמיד. מספר זהות וטלפון (או אפוטרופוס) הם שדות חובה.
              </DialogDescription>
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
