import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageLayout from '@/components/ui/PageLayout';
import { Button } from '@/components/ui/button';
import { Plus, ArrowRight, Loader2, Eye, EyeOff, Sparkles } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TemplateGrid } from '../components/TemplateManager/TemplateGrid';
import { AddTemplateDialog } from '../components/TemplateManager/AddTemplateDialog';
import { TemplateEditDialog } from '../components/TemplateManager/TemplateEditDialog';
import { useTemplates } from '../hooks/useTemplates';
import { useCalendarInstructors } from '../hooks/useCalendar';
import EditServiceCapabilitiesDialog from '@/components/settings/employee-management/EditServiceCapabilitiesDialog.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { useAuth } from '@/auth/AuthContext.jsx';

export default function TemplateManagerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { activeOrgId } = useOrg();
  const { session } = useAuth();

  const [showInactive, setShowInactive] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addDefaults, setAddDefaults] = useState({
    instructorId: null,
    dayOfWeek: null,
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
    studentId: '',
    studentName: '',
    serviceName: '',
    fixType: '',
    source: 'add',
  });
  const consumedSeedRef = useRef('');

  const { templates, isLoading: templatesLoading, error: templatesError, refetch: refetchTemplates } = useTemplates({ showInactive });
  const { instructors, isLoading: instructorsLoading, error: instructorsError } = useCalendarInstructors();

  const isLoading = templatesLoading || instructorsLoading;
  const errorMsg = templatesError || instructorsError;

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
      studentId: searchParams.get('student_id') || '',
      studentName: searchParams.get('student_name') || '',
      serviceName: searchParams.get('service_name') || '',
      fixType: searchParams.get('fix_type') || '',
    };
  }, [searchParams]);

  useEffect(() => {
    if (!waitingListSeed?.waitingListEntryId) return;
    if (consumedSeedRef.current === waitingListSeed.seedKey) return;

    consumedSeedRef.current = waitingListSeed.seedKey;
    setAddDefaults({
      instructorId: waitingListSeed.instructorId,
      dayOfWeek: waitingListSeed.dayOfWeek,
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
      studentId: fixAvailabilitySeed.studentId,
      studentName: fixAvailabilitySeed.studentName,
      serviceName: fixAvailabilitySeed.serviceName,
      fixType: fixAvailabilitySeed.fixType,
      source: 'waiting_list',
    });
    setShowCapabilitiesDialog(true);
  }, [fixAvailabilitySeed]);

  const currentAvailabilityInstructor = useMemo(
    () => instructors.find((instructor) => instructor.id === availabilityContext.instructorId) || null,
    [instructors, availabilityContext.instructorId],
  );

  function handleCellClick(instructor, dayOfWeek) {
    setAddDefaults({
      instructorId: instructor.id,
      dayOfWeek,
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
  }

  function handleFixAvailability({
    instructorId,
    serviceId,
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
    </PageLayout>
  );
}
