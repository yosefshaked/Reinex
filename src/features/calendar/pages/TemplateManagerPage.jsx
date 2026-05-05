import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageLayout from '@/components/ui/PageLayout';
import { Button } from '@/components/ui/button';
import { Plus, ArrowRight, Loader2, Eye, EyeOff, Sparkles, UsersRound } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TemplateGrid } from '../components/TemplateManager/TemplateGrid';
import { AddTemplateDialog } from '../components/TemplateManager/AddTemplateDialog';
import { TemplateEditDialog } from '../components/TemplateManager/TemplateEditDialog';
import { useTemplates } from '../hooks/useTemplates';
import { useCalendarInstructors } from '../hooks/useCalendar';
import EditServiceCapabilitiesDialog from '@/components/settings/employee-management/EditServiceCapabilitiesDialog.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { useAuth } from '@/auth/AuthContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';

const MATCH_MODE_OPTIONS = [
  { value: 'capacity', label: 'מקום פנוי בקבוצה' },
  { value: 'clear_space', label: 'חלון פנוי לשיבוץ נפרד' },
];

function normalizeMatchMode(value) {
  return value === 'clear_space' ? 'clear_space' : 'capacity';
}

function formatWaitDays(days) {
  const value = Number(days) || 0;
  if (value <= 0) return 'נוסף היום';
  if (value === 1) return 'ממתין יום אחד';
  return `ממתין ${value} ימים`;
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
  const [matchMode, setMatchMode] = useState(() => normalizeMatchMode(searchParams.get('mode')));
  const [waitingMatches, setWaitingMatches] = useState({
    summary: { matchable_entries: 0, priority_entries: 0, oldest_wait_days: 0, services: [] },
    template_matches: {},
    cell_matches: {},
    candidates: [],
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
  const { instructors, isLoading: instructorsLoading, error: instructorsError } = useCalendarInstructors();

  const isLoading = templatesLoading || instructorsLoading;
  const errorMsg = templatesError || instructorsError;

  useEffect(() => {
    const nextMode = normalizeMatchMode(searchParams.get('mode'));
    setMatchMode(nextMode);
  }, [searchParams]);

  useEffect(() => {
    if (!activeOrgId || !session || isLoading || errorMsg) {
      setWaitingMatches({
        summary: { matchable_entries: 0, priority_entries: 0, oldest_wait_days: 0, services: [] },
        template_matches: {},
        cell_matches: {},
        candidates: [],
      });
      return;
    }

    let cancelled = false;
    async function fetchWaitingMatches() {
      setWaitingMatchesLoading(true);
      setWaitingMatchesError('');
      try {
        const payload = await authenticatedFetch('waiting-list-matches', {
          session,
          params: {
            org_id: activeOrgId,
            scope: 'template_manager',
            mode: matchMode,
          },
        });
        if (!cancelled) {
          setWaitingMatches({
            summary: payload?.summary || { matchable_entries: 0, priority_entries: 0, oldest_wait_days: 0, services: [] },
            template_matches: payload?.template_matches || {},
            cell_matches: payload?.cell_matches || {},
            candidates: Array.isArray(payload?.candidates) ? payload.candidates : [],
          });
        }
      } catch (error) {
        if (!cancelled) {
          setWaitingMatchesError(error?.message || 'טעינת התאמות רשימת ההמתנה נכשלה.');
          setWaitingMatches({
            summary: { matchable_entries: 0, priority_entries: 0, oldest_wait_days: 0, services: [] },
            template_matches: {},
            cell_matches: {},
            candidates: [],
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
  }, [activeOrgId, session, matchMode, isLoading, errorMsg]);

  const waitingListSeed = useMemo(() => {
    const waitingListEntryId = searchParams.get('waiting_list_entry_id') || '';
    if (!waitingListEntryId) return null;

    return {
      seedKey: searchParams.toString(),
      waitingListEntryId,
      suggestionMode: searchParams.get('suggestion_mode') || '',
      instructorId: searchParams.get('instructor_id') || null,
      dayOfWeek: searchParams.get('day_of_week') || null,
      timeOfDay: searchParams.get('time_of_day') || '09:00',
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

  function handleCellClick(instructor, dayOfWeek) {
    setAddDefaults({
      instructorId: instructor.id,
      dayOfWeek,
      clientProfileId: '',
      studentId: '',
      serviceId: '',
      timeOfDay: '09:00',
      durationMinutes: 60,
      waitingListEntryId: '',
      waitingListContext: null,
    });
    setShowAddDialog(true);
  }

  function handleTemplateClick(template) {
    setSelectedTemplate(template);
  }

  function handleAddSuccess() {
    refetchTemplates();
    setSelectedMatchContext(null);
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

    if (availabilityContext.source !== 'edit' && availabilityContext.instructorId && availabilityContext.serviceId) {
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

  function handleMatchModeChange(nextMode) {
    const normalizedMode = normalizeMatchMode(nextMode);
    setMatchMode(normalizedMode);
    const params = new URLSearchParams(searchParams);
    if (params.get('waiting_matches') === '1' || params.has('mode')) {
      params.set('waiting_matches', '1');
      params.set('mode', normalizedMode);
      navigate(`/calendar/templates?${params.toString()}`, { replace: true });
    }
  }

  function handleWaitingListMatchClick(context) {
    const candidates = Array.isArray(context?.bucket?.candidates) ? context.bucket.candidates : [];
    if (!candidates.length) return;
    setSelectedMatchContext({
      ...context,
      candidates,
    });
  }

  function handleAssignWaitingCandidate(candidate) {
    if (!candidate) return;
    setAddDefaults({
      instructorId: candidate.instructor_id || null,
      dayOfWeek: candidate.day_of_week || null,
      clientProfileId: candidate.client_profile_id || '',
      studentId: candidate.student_id || '',
      serviceId: candidate.service_id || '',
      timeOfDay: candidate.time_of_day || '09:00',
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

  return (
    <PageLayout
      title="ניהול תבניות"
      description="תבניות שיעורים שבועיות קבועות — לחצו על תא ריק להוספה או על תבנית לעריכה"
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowInactive(!showInactive)}
            className="gap-1"
          >
            {showInactive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {showInactive ? 'הסתר לא פעילים' : 'הצג לא פעילים'}
          </Button>
          <Button
            onClick={() => {
              setAddDefaults({
                instructorId: null,
                dayOfWeek: null,
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
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          שגיאה בטעינת הנתונים: {errorMsg}
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
        <div className="mb-4 rounded-lg border border-border bg-background p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <UsersRound className="h-4 w-4 text-primary" />
                התאמות מרשימת ההמתנה
                {waitingMatchesLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
              </div>
              <div className="text-xs text-muted-foreground">
                {waitingMatchesError
                  ? waitingMatchesError
                  : `נמצאו ${waitingMatches.summary.matchable_entries || 0} רשומות מתאימות במצב הנוכחי.`}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-full bg-muted p-1">
                {MATCH_MODE_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    size="sm"
                    variant={matchMode === option.value ? 'default' : 'ghost'}
                    className="h-8 rounded-full px-3 text-xs"
                    onClick={() => handleMatchModeChange(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              {waitingMatches.summary.priority_entries > 0 ? (
                <Badge variant="destructive">{waitingMatches.summary.priority_entries} דחופים</Badge>
              ) : null}
              {waitingMatches.summary.oldest_wait_days > 0 ? (
                <Badge variant="outline">{formatWaitDays(waitingMatches.summary.oldest_wait_days)}</Badge>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Grid */}
      {!isLoading && !errorMsg && (
        <TemplateGrid
          templates={templates}
          instructors={instructors}
          onTemplateClick={handleTemplateClick}
          onCellClick={handleCellClick}
          showInactive={showInactive}
          highlightedInstructorId={waitingListSeed?.instructorId || null}
          highlightedDayOfWeek={waitingListSeed?.dayOfWeek || null}
          highlightedTemplateId={waitingListSeed?.sourceTemplateId || null}
          waitingListMatchMode={matchMode}
          waitingListTemplateMatches={waitingMatches.template_matches}
          waitingListCellMatches={waitingMatches.cell_matches}
          onWaitingListMatchClick={handleWaitingListMatchClick}
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

      <Dialog open={Boolean(selectedMatchContext)} onOpenChange={(open) => !open && setSelectedMatchContext(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {matchMode === 'capacity' ? 'ממתינים שמתאימים לקבוצה קיימת' : 'ממתינים שמתאימים לשיבוץ נפרד'}
            </DialogTitle>
            <DialogDescription>
              בחרו מתעניין/ת לשיבוץ. השמירה תעבור דרך יצירת תבנית ותמיר לקוח/ה לתלמיד/ה בצד השרת.
            </DialogDescription>
          </DialogHeader>
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
                      {matchMode === 'capacity' ? (
                        <Badge variant="secondary">{candidate.current_students}/{candidate.capacity} בקבוצה</Badge>
                      ) : (
                        <Badge variant="secondary">חלון נפרד</Badge>
                      )}
                    </div>
                  </div>
                  <Button type="button" onClick={() => handleAssignWaitingCandidate(candidate)}>
                    שבץ
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
