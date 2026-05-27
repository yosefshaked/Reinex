import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageLayout from '@/components/ui/PageLayout';
import { Button } from '@/components/ui/button';
import { Plus, ArrowRight, Coffee, Loader2, SlidersHorizontal, Sparkles, UsersRound } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import ErrorSupportCode from '@/components/ui/ErrorSupportCode.jsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.jsx';
import { DAY_OPTIONS } from '@/lib/day-of-week.js';
import { TemplateScheduleCalendar } from '../components/TemplateManager/TemplateScheduleCalendar';
import { AddTemplateDialog } from '../components/TemplateManager/AddTemplateDialog';
import { TemplateEditDialog } from '../components/TemplateManager/TemplateEditDialog';
import TemplateMissingFormsDialog from '../components/TemplateManager/TemplateMissingFormsDialog';
import { AddBreakTemplateDialog } from '../components/TemplateManager/AddBreakTemplateDialog';
import { EditBreakTemplateDialog } from '../components/TemplateManager/EditBreakTemplateDialog';
import CalendarServicePalette from '../components/CalendarServicePalette.jsx';
import { useTemplates, useTemplateMutations } from '../hooks/useTemplates';
import { useInstructorBreakTemplates } from '../hooks/useInstructorBreakTemplates';
import { useCalendarInstructors } from '../hooks/useCalendar';
import EditServiceCapabilitiesDialog from '@/components/settings/employee-management/EditServiceCapabilitiesDialog.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { useAuth } from '@/auth/AuthContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { ceilClockTimeToGrid } from '@/lib/time-grid.js';

const EMPTY_WAITING_MATCHES = {
  summary: { matchable_entries: 0, priority_entries: 0, oldest_wait_days: 0, services: [] },
  template_matches: {},
  cell_matches: {},
  candidates: [],
};

function formatWaitDays(days) {
  const value = Number(days) || 0;
  if (value <= 0) return 'נוסף היום';
  if (value === 1) return 'ממתין יום אחד';
  return `ממתין ${value} ימים`;
}

function formatMaxWaitDays(days) {
  const value = Number(days) || 0;
  if (value <= 0) return 'אין התאמות כרגע';
  if (value === 1) return 'המתנה מירבית: יום אחד';
  return `המתנה מירבית: ${value} ימים`;
}

function normalizeWaitingMatchPayload(payload) {
  return {
    summary: payload?.summary || EMPTY_WAITING_MATCHES.summary,
    template_matches: payload?.template_matches || {},
    cell_matches: payload?.cell_matches || {},
    candidates: Array.isArray(payload?.candidates) ? payload.candidates : [],
  };
}

function buildCombinedWaitingSummary(waitingMatches) {
  const seenEntries = new Set();
  let priorityEntries = 0;
  let oldestWaitDays = 0;

  for (const modePayload of [waitingMatches.capacity, waitingMatches.clear_space]) {
    for (const candidate of modePayload?.candidates || []) {
      const entryId = candidate?.waiting_list_entry_id || candidate?.entry_id;
      if (!entryId || seenEntries.has(entryId)) continue;
      seenEntries.add(entryId);
      if (candidate.priority_flag) priorityEntries += 1;
      oldestWaitDays = Math.max(oldestWaitDays, Number(candidate.wait_days) || 0);
    }

    const summary = modePayload?.summary || {};
    oldestWaitDays = Math.max(oldestWaitDays, Number(summary.oldest_wait_days) || 0);
  }

  return {
    matchableEntries: seenEntries.size,
    priorityEntries,
    oldestWaitDays,
  };
}

function preferenceLabel(value) {
  switch (value) {
    case 'exact':
      return 'תואם יום ושעה';
    case 'day_only':
      return 'תואם יום';
    default:
      return 'התאמת שירות';
  }
}

export default function TemplateManagerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { activeOrgId } = useOrg();
  const { session } = useAuth();

  const [showInactive, setShowInactive] = useState(false);
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [showWaitingMatches, setShowWaitingMatches] = useState(() => searchParams.get('waiting_matches') !== '0');
  const [templateViewMode, setTemplateViewMode] = useState(() => (searchParams.get('view') === 'day' ? 'day' : 'week'));
  const [selectedDay, setSelectedDay] = useState(() => searchParams.get('day') || 'sunday');
  const [waitingMatches, setWaitingMatches] = useState({
    capacity: EMPTY_WAITING_MATCHES,
    clear_space: EMPTY_WAITING_MATCHES,
  });
  const [waitingMatchesLoading, setWaitingMatchesLoading] = useState(false);
  const [waitingMatchesError, setWaitingMatchesError] = useState('');
  const [selectedMatchContext, setSelectedMatchContext] = useState(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addDefaults, setAddDefaults] = useState({
    instructorId: null,
    dayOfWeek: null,
    clientProfileId: '',
    studentId: '',
    serviceId: '',
    timeOfDay: '09:00',
    durationMinutes: 60,
    waitingListEntryId: '',
    waitingListContext: null,
  });
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [showAddBreakTemplateDialog, setShowAddBreakTemplateDialog] = useState(false);
  const [addBreakTemplateDefaults, setAddBreakTemplateDefaults] = useState({ instructorId: null, dayOfWeek: null, timeOfDay: '09:00', durationMinutes: 30 });
  const [selectedBreakTemplate, setSelectedBreakTemplate] = useState(null);
  const [showCapabilitiesDialog, setShowCapabilitiesDialog] = useState(false);
  const [availabilityContext, setAvailabilityContext] = useState({
    instructorId: '',
    serviceId: '',
    waitingListEntryId: '',
    clientProfileId: '',
    studentId: '',
    studentName: '',
    serviceName: '',
    fixType: '',
    source: 'add',
  });
  const consumedSeedRef = useRef('');
  const consumedTemplateEditSeedRef = useRef('');

  const { templates, isLoading: templatesLoading, error: templatesError, refetch: refetchTemplates } = useTemplates({ showInactive });
  const { breakTemplates, refetch: refetchBreakTemplates } = useInstructorBreakTemplates({ showInactive });
  const { instructors, isLoading: instructorsLoading, error: instructorsError } = useCalendarInstructors();
  const { matchWaitingEntryToTemplate, isSubmitting: isAssigning } = useTemplateMutations();
  const [capacityAssignError, setCapacityAssignError] = useState('');
  const [missingFormsMap, setMissingFormsMap] = useState({});
  const [missingFormsRefetch, setMissingFormsRefetch] = useState(0);
  const [missingFormsDialogTemplate, setMissingFormsDialogTemplate] = useState(null);
  const [missingFormsDialogEntries, setMissingFormsDialogEntries] = useState([]);

  const isLoading = templatesLoading || instructorsLoading;
  const errorMsg = templatesError || instructorsError;
  const combinedWaitingSummary = useMemo(
    () => buildCombinedWaitingSummary(waitingMatches),
    [waitingMatches],
  );

  useEffect(() => {
    if (searchParams.has('waiting_matches')) {
      setShowWaitingMatches(searchParams.get('waiting_matches') !== '0');
    }
    setTemplateViewMode(searchParams.get('view') === 'day' ? 'day' : 'week');
    const nextDay = searchParams.get('day') || 'sunday';
    setSelectedDay(DAY_OPTIONS.some((day) => day.value === nextDay) ? nextDay : 'sunday');
  }, [searchParams]);

  useEffect(() => {
    if (!activeOrgId || !session || isLoading || errorMsg) {
      setWaitingMatches({
        capacity: EMPTY_WAITING_MATCHES,
        clear_space: EMPTY_WAITING_MATCHES,
      });
      return;
    }

    let cancelled = false;
    async function fetchWaitingMatches() {
      setWaitingMatchesLoading(true);
      setWaitingMatchesError('');
      try {
        const [capacityPayload, clearSpacePayload] = await Promise.all([
          authenticatedFetch('waiting-list-matches', {
            session,
            params: {
              org_id: activeOrgId,
              scope: 'template_manager',
              mode: 'capacity',
            },
          }),
          authenticatedFetch('waiting-list-matches', {
            session,
            params: {
              org_id: activeOrgId,
              scope: 'template_manager',
              mode: 'clear_space',
            },
          }),
        ]);
        if (!cancelled) {
          setWaitingMatches({
            capacity: normalizeWaitingMatchPayload(capacityPayload),
            clear_space: normalizeWaitingMatchPayload(clearSpacePayload),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setWaitingMatchesError(error?.message || 'טעינת התאמות רשימת ההמתנה נכשלה.');
          setWaitingMatches({
            capacity: EMPTY_WAITING_MATCHES,
            clear_space: EMPTY_WAITING_MATCHES,
          });
        }
      } finally {
        if (!cancelled) {
          setWaitingMatchesLoading(false);
        }
      }
    }

    void fetchWaitingMatches();
    return () => {
      cancelled = true;
    };
  }, [activeOrgId, session, isLoading, errorMsg]);

  // Fetch required-form compliance for all templates in a single bulk call
  useEffect(() => {
    if (isLoading || !activeOrgId || !session) {
      setMissingFormsMap({});
      return;
    }

    let cancelled = false;

    async function fetchRequiredFormsCompliance() {
      try {
        const params = new URLSearchParams();
        params.set('org_id', activeOrgId);
        const data = await authenticatedFetch(`student-required-forms/compliance-bulk?${params}`, { session });
        if (!cancelled) {
          setMissingFormsMap(data && typeof data === 'object' && !Array.isArray(data) ? data : {});
        }
      } catch {
        if (!cancelled) setMissingFormsMap({});
      }
    }

    void fetchRequiredFormsCompliance();
    return () => { cancelled = true; };
  }, [activeOrgId, session, isLoading, missingFormsRefetch]);

  const waitingListSeed = useMemo(() => {
    const waitingListEntryId = searchParams.get('waiting_list_entry_id') || '';
    if (!waitingListEntryId) return null;

    return {
      seedKey: searchParams.toString(),
      waitingListEntryId,
      suggestionMode: searchParams.get('suggestion_mode') || '',
      instructorId: searchParams.get('instructor_id') || null,
      dayOfWeek: searchParams.get('day_of_week') || null,
      timeOfDay: ceilClockTimeToGrid(searchParams.get('time_of_day')) || '09:00',
      durationMinutes: Number(searchParams.get('duration_minutes')) || 60,
      clientProfileId: searchParams.get('client_profile_id') || '',
      studentId: searchParams.get('student_id') || '',
      studentName: searchParams.get('student_name') || '',
      serviceId: searchParams.get('service_id') || '',
      serviceName: searchParams.get('service_name') || '',
      sourceTemplateId: searchParams.get('source_template_id') || '',
    };
  }, [searchParams]);

  const fixAvailabilitySeed = useMemo(() => {
    if (searchParams.get('fix_availability') !== '1') return null;
    const instructorId = searchParams.get('instructor_id') || '';
    const serviceId = searchParams.get('service_id') || '';
    if (!instructorId || !serviceId) return null;

    return {
      seedKey: searchParams.toString(),
      instructorId,
      serviceId,
      waitingListEntryId: searchParams.get('waiting_list_entry_id') || '',
      clientProfileId: searchParams.get('client_profile_id') || '',
      studentId: searchParams.get('student_id') || '',
      studentName: searchParams.get('student_name') || '',
      serviceName: searchParams.get('service_name') || '',
      fixType: searchParams.get('fix_type') || '',
    };
  }, [searchParams]);

  const templateEditSeed = useMemo(() => {
    const templateId = searchParams.get('edit_template_id') || '';
    if (!templateId) return null;

    return {
      seedKey: searchParams.toString(),
      templateId,
    };
  }, [searchParams]);

  useEffect(() => {
    if (!waitingListSeed?.waitingListEntryId) return;
    if (consumedSeedRef.current === waitingListSeed.seedKey) return;

    consumedSeedRef.current = waitingListSeed.seedKey;
    if (DAY_OPTIONS.some((day) => day.value === waitingListSeed.dayOfWeek)) {
      setSelectedDay(waitingListSeed.dayOfWeek);
      setTemplateViewMode('day');
    }
    setAddDefaults({
      instructorId: waitingListSeed.instructorId,
      dayOfWeek: waitingListSeed.dayOfWeek,
      clientProfileId: waitingListSeed.clientProfileId,
      studentId: waitingListSeed.studentId,
      serviceId: waitingListSeed.serviceId,
      timeOfDay: waitingListSeed.timeOfDay,
      durationMinutes: waitingListSeed.durationMinutes,
      waitingListEntryId: waitingListSeed.waitingListEntryId,
      waitingListContext: {
        studentName: waitingListSeed.studentName,
        serviceName: waitingListSeed.serviceName,
      },
    });
    setShowAddDialog(true);
  }, [waitingListSeed]);

  useEffect(() => {
    if (!fixAvailabilitySeed?.instructorId || !fixAvailabilitySeed?.serviceId) return;
    if (consumedSeedRef.current === fixAvailabilitySeed.seedKey) return;

    consumedSeedRef.current = fixAvailabilitySeed.seedKey;
    setAvailabilityContext({
      instructorId: fixAvailabilitySeed.instructorId,
      serviceId: fixAvailabilitySeed.serviceId,
      waitingListEntryId: fixAvailabilitySeed.waitingListEntryId,
      clientProfileId: fixAvailabilitySeed.clientProfileId,
      studentId: fixAvailabilitySeed.studentId,
      studentName: fixAvailabilitySeed.studentName,
      serviceName: fixAvailabilitySeed.serviceName,
      fixType: fixAvailabilitySeed.fixType,
      source: 'waiting_list',
    });
    setShowCapabilitiesDialog(true);
  }, [fixAvailabilitySeed]);

  useEffect(() => {
    if (!templateEditSeed?.templateId || templates.length === 0) return;
    if (consumedTemplateEditSeedRef.current === templateEditSeed.seedKey) return;

    const matchedTemplate = templates.find((template) => String(template.id) === String(templateEditSeed.templateId));
    if (!matchedTemplate) return;

    consumedTemplateEditSeedRef.current = templateEditSeed.seedKey;
    setSelectedTemplate(matchedTemplate);
  }, [templateEditSeed, templates]);

  const currentAvailabilityInstructor = useMemo(
    () => instructors.find((instructor) => instructor.id === availabilityContext.instructorId) || null,
    [instructors, availabilityContext.instructorId],
  );

  function handleCellClick(instructor, dayOfWeek, timeOfDay = '09:00') {
    setAddDefaults({
      instructorId: instructor.id,
      dayOfWeek,
      clientProfileId: '',
      studentId: '',
      serviceId: '',
      timeOfDay,
      durationMinutes: 60,
      waitingListEntryId: '',
      waitingListContext: null,
    });
    setShowAddDialog(true);
  }

  function handleTemplateClick(template) {
    setSelectedTemplate(template);
  }

  function handleMissingFormsClick(template, entries) {
    setMissingFormsDialogTemplate(template);
    setMissingFormsDialogEntries(entries || []);
  }

  function handleAddSuccess() {
    refetchTemplates();
    setSelectedMatchContext(null);
  }

  function handleBreakTemplateClick(breakTemplate) {
    setSelectedBreakTemplate(breakTemplate);
  }

  function handleBreakTemplateAddSuccess() {
    refetchBreakTemplates();
    setShowAddBreakTemplateDialog(false);
  }

  function handleBreakTemplateUpdateSuccess() {
    refetchBreakTemplates();
    setSelectedBreakTemplate(null);
  }

  function handleFixAvailability({
    instructorId,
    serviceId,
    clientProfileId = '',
    studentId = '',
    waitingListEntryId = '',
    waitingListContext = null,
    fixType = '',
    source = 'add',
  }) {
    setAvailabilityContext({
      instructorId: instructorId || '',
      serviceId: serviceId || '',
      waitingListEntryId: waitingListEntryId || '',
      clientProfileId: clientProfileId || '',
      studentId: studentId || '',
      studentName: waitingListContext?.studentName || '',
      serviceName: waitingListContext?.serviceName || '',
      fixType: fixType || '',
      source,
    });
    if (source !== 'edit') {
      setShowAddDialog(false);
    }
    setShowCapabilitiesDialog(true);
  }

  async function handleAvailabilitySaved() {
    refetchTemplates();
    setShowCapabilitiesDialog(false);

    if (!['edit', 'calendar'].includes(availabilityContext.source) && availabilityContext.instructorId && availabilityContext.serviceId) {
      setAddDefaults((prev) => ({
        ...prev,
        instructorId: availabilityContext.instructorId,
        serviceId: availabilityContext.serviceId,
        studentId: availabilityContext.studentId || prev.studentId,
        clientProfileId: availabilityContext.clientProfileId || prev.clientProfileId,
        waitingListEntryId: availabilityContext.waitingListEntryId || prev.waitingListEntryId,
        waitingListContext: availabilityContext.studentName || availabilityContext.serviceName
          ? {
              studentName: availabilityContext.studentName,
              serviceName: availabilityContext.serviceName,
            }
          : prev.waitingListContext,
      }));
      setShowAddDialog(true);
    }
  }

  function handleUpdateSuccess() {
    refetchTemplates();
    setSelectedTemplate(null);
  }

  function handleWaitingMatchesVisibilityChange() {
    const nextValue = !showWaitingMatches;
    setShowWaitingMatches(nextValue);
    const params = new URLSearchParams(searchParams);
    params.set('waiting_matches', nextValue ? '1' : '0');
    params.delete('mode');
    navigate(`/calendar/templates?${params.toString()}`, { replace: true });
  }

  function handleTemplateViewModeChange(nextViewMode) {
    const normalizedViewMode = nextViewMode === 'week' ? 'week' : 'day';
    setTemplateViewMode(normalizedViewMode);
    const params = new URLSearchParams(searchParams);
    params.set('view', normalizedViewMode);
    if (normalizedViewMode === 'day') {
      params.set('day', selectedDay);
    }
    navigate(`/calendar/templates?${params.toString()}`, { replace: true });
  }

  function handleSelectedDayChange(dayValue) {
    const normalizedDay = DAY_OPTIONS.some((day) => day.value === dayValue) ? dayValue : 'sunday';
    setSelectedDay(normalizedDay);
    const params = new URLSearchParams(searchParams);
    params.set('view', 'day');
    params.set('day', normalizedDay);
    navigate(`/calendar/templates?${params.toString()}`, { replace: true });
  }

  function handleWaitingListMatchClick(context) {
    const candidates = Array.isArray(context?.bucket?.candidates) ? context.bucket.candidates : [];
    if (!candidates.length) return;
    setSelectedMatchContext({
      ...context,
      candidates,
    });
  }

  async function handleCapacityAssign(candidate) {
    setCapacityAssignError('');
    const templateId = candidate.source_template_id;
    const waitingListEntryId = candidate.waiting_list_entry_id || candidate.entry_id || '';

    const { error } = await matchWaitingEntryToTemplate(templateId, waitingListEntryId);
    if (error) {
      setCapacityAssignError('אירעה שגיאה בשיבוץ התלמיד/ה. נסו שנית.');
      return;
    }
    setSelectedMatchContext(null);
    setCapacityAssignError('');
    refetchTemplates();
  }

  function handleAssignWaitingCandidate(candidate) {
    if (!candidate) return;

    // Capacity mode — always add directly to the existing template (backend resolves the student)
    if (selectedMatchContext?.mode === 'capacity' && candidate.source_template_id) {
      handleCapacityAssign(candidate);
      return;
    }

    // Clear-space mode or missing data — open AddTemplateDialog to create a new template
    setAddDefaults({
      instructorId: candidate.instructor_id || null,
      dayOfWeek: candidate.day_of_week || null,
      clientProfileId: candidate.client_profile_id || '',
      studentId: candidate.student_id || '',
      serviceId: candidate.service_id || '',
      timeOfDay: ceilClockTimeToGrid(candidate.time_of_day) || '09:00',
      durationMinutes: Number(candidate.duration_minutes) || 60,
      waitingListEntryId: candidate.waiting_list_entry_id || candidate.entry_id || '',
      waitingListContext: {
        studentName: candidate.student_name || '',
        serviceName: candidate.service_name || '',
      },
    });
    setSelectedMatchContext(null);
    setShowAddDialog(true);
  }

  function handleExternalServiceDrop({ serviceId, resourceId, dayOfWeek, timeOfDay, durationMinutes }) {
    if (!serviceId || !resourceId || !dayOfWeek || !timeOfDay) {
      return;
    }

    setAddDefaults({
      instructorId: resourceId,
      dayOfWeek,
      clientProfileId: '',
      studentId: '',
      serviceId,
      timeOfDay: ceilClockTimeToGrid(timeOfDay) || '09:00',
      durationMinutes: Number(durationMinutes) || 60,
      waitingListEntryId: '',
      waitingListContext: null,
    });
    setShowAddDialog(true);
  }

  function handleUnavailableTemplateSlot({ instructorId = '', serviceId = '', dayOfWeek = '', timeOfDay = '' } = {}) {
    setAvailabilityContext({
      instructorId: instructorId || '',
      serviceId: serviceId || '',
      waitingListEntryId: '',
      clientProfileId: '',
      studentId: '',
      studentName: '',
      serviceName: '',
      fixType: serviceId ? 'outside_instructor_service_availability' : 'missing_instructor_availability_day',
      source: 'calendar',
      dayOfWeek,
      timeOfDay,
    });
    setShowCapabilitiesDialog(true);
  }

  return (
    <PageLayout
      title="ניהול תבניות"
      headerClassName="pb-2 sm:pb-3"
      contentClassName="space-y-3"
      actions={
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              setAddDefaults({
                instructorId: null,
                dayOfWeek: null,
                clientProfileId: '',
                studentId: '',
                serviceId: '',
                timeOfDay: '09:00',
                durationMinutes: 60,
                waitingListEntryId: '',
                waitingListContext: null,
              });
              setShowAddDialog(true);
            }}
            className="gap-1"
          >
            <Plus className="h-4 w-4" />
            תבנית חדשה
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setAddBreakTemplateDefaults({ instructorId: null, dayOfWeek: null, timeOfDay: '09:00', durationMinutes: 30 });
              setShowAddBreakTemplateDialog(true);
            }}
            className="gap-1"
          >
            <Coffee className="h-4 w-4" />
            הפסקה חדשה
          </Button>
          <Button variant="outline" onClick={() => navigate('/calendar')} className="gap-1">
            <ArrowRight className="h-4 w-4" />
            חזרה ללוח
          </Button>
        </div>
      }
    >
      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      )}

      {/* Error */}
      {errorMsg && !isLoading && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-destructive">
          <p className="text-base font-semibold">אירעה שגיאה בטעינת הנתונים.</p>
          <p className="mt-1 text-sm">נסו לרענן את הדף. אם הבעיה חוזרת, פנו לתמיכה.</p>
          <ErrorSupportCode error={errorMsg} />
        </div>
      )}

      {!isLoading && !errorMsg && (waitingListSeed || fixAvailabilitySeed) ? (
        <Alert className="mb-4 border-primary/30 bg-primary/5">
          <Sparkles className="h-4 w-4" />
          <AlertDescription>
            {fixAvailabilitySeed
              ? 'מצב תיקון זמינות פעיל.'
              : 'מצב שיבוץ מרשימת ההמתנה פעיל.'}
            {(fixAvailabilitySeed?.studentName || waitingListSeed?.studentName)
              ? ` ${fixAvailabilitySeed?.studentName || waitingListSeed?.studentName} נמצא/ת בהקשר הפעולה הנוכחי.`
              : ''}
            {(fixAvailabilitySeed?.serviceName || waitingListSeed?.serviceName)
              ? ` השירות המבוקש: ${fixAvailabilitySeed?.serviceName || waitingListSeed?.serviceName}.`
              : ''}
          </AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && !errorMsg ? (
        <div className="rounded-lg border border-border bg-background px-3 py-2">
          <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-between">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
                <Button
                  type="button"
                  size="sm"
                  variant={templateViewMode === 'day' ? 'default' : 'ghost'}
                  className="h-8 rounded-md px-3 text-xs"
                  onClick={() => handleTemplateViewModeChange('day')}
                >
                  יום
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={templateViewMode === 'week' ? 'default' : 'ghost'}
                  className="h-8 rounded-md px-3 text-xs"
                  onClick={() => handleTemplateViewModeChange('week')}
                >
                  שבוע
                </Button>
              </div>
              {templateViewMode === 'day' ? (
                <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
                  {DAY_OPTIONS.map((day) => (
                    <Button
                      key={day.value}
                      type="button"
                      size="sm"
                      variant={selectedDay === day.value ? 'default' : 'ghost'}
                      className="h-8 rounded-md px-2.5 text-xs"
                      onClick={() => handleSelectedDayChange(day.value)}
                    >
                      {day.labelShort}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <div className="min-w-[13rem]">
                <CalendarServicePalette />
              </div>
              <Button
                type="button"
                variant={showWaitingMatches ? 'default' : 'outline'}
                className="h-12 min-w-[10.5rem] flex-col gap-0 rounded-lg px-3 leading-tight"
                onClick={handleWaitingMatchesVisibilityChange}
                title={waitingMatchesError || undefined}
              >
                <span className="flex items-center gap-1 text-sm font-semibold">
                  <UsersRound className="h-4 w-4" />
                  {showWaitingMatches ? 'הסתר ממתינים' : 'הצג ממתינים'} ({combinedWaitingSummary.matchableEntries})
                  {waitingMatchesLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                </span>
                <span className={showWaitingMatches ? 'text-xs text-primary-foreground/80' : 'text-xs text-muted-foreground'}>
                  {waitingMatchesError ? 'שגיאה בטעינת ממתינים' : formatMaxWaitDays(combinedWaitingSummary.oldestWaitDays)}
                </span>
              </Button>
              {combinedWaitingSummary.priorityEntries > 0 ? (
                <Badge variant="destructive">{combinedWaitingSummary.priorityEntries} דחופים</Badge>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-12 gap-1 rounded-lg">
                    <SlidersHorizontal className="h-4 w-4" />
                    אפשרויות תצוגה
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>תצוגת תבניות</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={showInactive}
                    onCheckedChange={(checked) => setShowInactive(Boolean(checked))}
                  >
                    הצג לא פעילים
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showUnavailable}
                    onCheckedChange={(checked) => setShowUnavailable(Boolean(checked))}
                  >
                    הצג מדריכים ללא זמינות
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      ) : null}

      {/* Grid */}
      {!isLoading && !errorMsg && (
        <TemplateScheduleCalendar
          templates={templates}
          breakTemplates={breakTemplates}
          instructors={instructors}
          onTemplateClick={handleTemplateClick}
          onBreakTemplateClick={handleBreakTemplateClick}
          onSlotClick={handleCellClick}
          onExternalServiceDrop={handleExternalServiceDrop}
          onUnavailableSlot={handleUnavailableTemplateSlot}
          showInactive={showInactive}
          showUnavailable={showUnavailable}
          viewMode={templateViewMode}
          selectedDay={selectedDay}
          showWaitingListMatches={showWaitingMatches}
          waitingListTemplateMatches={waitingMatches.capacity.template_matches}
          waitingListCandidates={waitingMatches.clear_space.candidates}
          missingFormsMap={missingFormsMap}
          isLoading={waitingMatchesLoading}
          onWaitingListMatchClick={handleWaitingListMatchClick}
          onMissingFormsClick={handleMissingFormsClick}
        />
      )}

      {/* Empty state */}
      {!isLoading && !errorMsg && templates.length === 0 && instructors.length > 0 && (
        <div className="text-center text-gray-500 py-8">
          <p className="text-lg mb-2">אין תבניות עדיין</p>
          <p className="text-sm">לחצו על &quot;תבנית חדשה&quot; או על תא ריק בטבלה כדי להתחיל</p>
        </div>
      )}

      {/* Dialogs */}
      <AddTemplateDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onSuccess={handleAddSuccess}
        defaultInstructorId={addDefaults.instructorId}
        defaultDayOfWeek={addDefaults.dayOfWeek}
        defaultClientProfileId={addDefaults.clientProfileId}
        defaultStudentId={addDefaults.studentId}
        defaultServiceId={addDefaults.serviceId}
        defaultTimeOfDay={addDefaults.timeOfDay}
        defaultDurationMinutes={addDefaults.durationMinutes}
        waitingListEntryId={addDefaults.waitingListEntryId}
        waitingListContext={addDefaults.waitingListContext}
        onFixAvailability={handleFixAvailability}
        templates={templates}
      />

      <EditServiceCapabilitiesDialog
        open={showCapabilitiesDialog}
        onOpenChange={setShowCapabilitiesDialog}
        instructor={currentAvailabilityInstructor}
        orgId={activeOrgId}
        session={session}
        onSaved={handleAvailabilitySaved}
        focusServiceId={availabilityContext.serviceId}
        introMessage={
          availabilityContext.fixType === 'missing_service_capability'
            ? (availabilityContext.serviceName
                ? `הגדירו את השירות ${availabilityContext.serviceName} ואת חלונות הזמינות שלו עבור המדריך/ה.`
                : 'הגדירו שירות וחלונות זמינות עבור המדריך/ה.')
            : availabilityContext.fixType === 'outside_instructor_service_availability'
              ? (availabilityContext.serviceName
                  ? `עדכנו את חלונות הזמינות של ${availabilityContext.serviceName} או התאימו את שעת התבנית.`
                  : 'עדכנו את חלונות הזמינות או התאימו את שעת התבנית.')
            : availabilityContext.fixType === 'missing_instructor_availability_day'
              ? 'עדכנו את חלונות הזמינות של המדריך/ה ליום שנבחר, או בחרו יום אחר בלוח התבניות.'
              : availabilityContext.serviceName
                ? `השלימו חלונות זמינות עבור השירות ${availabilityContext.serviceName}.`
                : 'השלימו חלונות זמינות עבור השירות הנבחר.'
        }
      />

      <TemplateEditDialog
        template={selectedTemplate}
        open={!!selectedTemplate}
        onClose={() => setSelectedTemplate(null)}
        onUpdate={handleUpdateSuccess}
        onFixAvailability={handleFixAvailability}
      />

      <AddBreakTemplateDialog
        open={showAddBreakTemplateDialog}
        onClose={() => setShowAddBreakTemplateDialog(false)}
        onSuccess={handleBreakTemplateAddSuccess}
        instructors={instructors}
        defaultInstructorId={addBreakTemplateDefaults.instructorId}
        defaultDayOfWeek={addBreakTemplateDefaults.dayOfWeek}
        defaultTimeOfDay={addBreakTemplateDefaults.timeOfDay}
        defaultDurationMinutes={addBreakTemplateDefaults.durationMinutes}
      />

      <EditBreakTemplateDialog
        open={!!selectedBreakTemplate}
        onClose={() => setSelectedBreakTemplate(null)}
        breakTemplate={selectedBreakTemplate}
        instructors={instructors}
        onSuccess={handleBreakTemplateUpdateSuccess}
      />

      <TemplateMissingFormsDialog
        open={Boolean(missingFormsDialogTemplate)}
        onClose={() => setMissingFormsDialogTemplate(null)}
        template={missingFormsDialogTemplate}
        missingFormsEntries={missingFormsDialogEntries}
        onSent={() => {
          setMissingFormsDialogTemplate(null);
          setMissingFormsRefetch((n) => n + 1);
        }}
      />

      <Dialog
        open={Boolean(selectedMatchContext)}
        onOpenChange={(open) => { if (!open) { setSelectedMatchContext(null); setCapacityAssignError(''); } }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedMatchContext?.mode === 'capacity' ? 'ממתינים שמתאימים לקבוצה קיימת' : 'ממתינים שמתאימים לשיבוץ נפרד'}
            </DialogTitle>
            <DialogDescription>
              {selectedMatchContext?.mode === 'capacity'
                ? 'לחצו "שבץ" כדי להוסיף את הממתין/ת ישירות לקבוצה הקיימת.'
                : 'בחרו מתעניין/ת לשיבוץ. השמירה תעבור דרך יצירת תבנית ותמיר לקוח/ה לתלמיד/ה בצד השרת.'}
            </DialogDescription>
          </DialogHeader>
          {capacityAssignError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {capacityAssignError}
            </div>
          )}
          <div className="max-h-[60vh] space-y-3 overflow-y-auto py-2">
            {(selectedMatchContext?.candidates || []).map((candidate) => (
              <div key={`${candidate.waiting_list_entry_id}-${candidate.instructor_id}-${candidate.day_of_week}-${candidate.time_of_day}`} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="font-medium text-foreground">{candidate.student_name || 'ללא שם'}</div>
                    <div className="text-sm text-muted-foreground">
                      {candidate.service_name || 'שירות'} · {candidate.day_label} · {candidate.time_of_day} · {candidate.duration_minutes} דק׳
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{preferenceLabel(candidate.preference_match)}</Badge>
                      <Badge variant="outline">{formatWaitDays(candidate.wait_days)}</Badge>
                      {candidate.priority_flag ? <Badge variant="destructive">דחוף</Badge> : null}
                      {selectedMatchContext?.mode === 'capacity' ? (
                        <Badge variant="secondary">{candidate.current_students}/{candidate.capacity} בקבוצה</Badge>
                      ) : (
                        <Badge variant="secondary">חלון נפרד</Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    disabled={isAssigning}
                    onClick={() => handleAssignWaitingCandidate(candidate)}
                  >
                    {isAssigning ? <Loader2 className="h-4 w-4 animate-spin" /> : 'שבץ'}
                  </Button>
                </div>
                <div className="mt-3 rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
                  {candidate.match_reason}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
