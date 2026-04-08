import { AlertTriangle, CalendarDays, Clock3, ExternalLink, FileText, MessageCircle, Plus, Sparkles, UserRound, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { getWeekRangeDateStrings, parseLocalDateString } from '../utils/localDate.js';
import { getParticipantDisplayNames } from '../utils/participantDisplay.js';

function formatDateLabel(dateString) {
  const date = parseLocalDateString(dateString);
  if (!date) return '';
  return date.toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function formatDateRange(currentDate, viewMode) {
  if (viewMode === 'week') {
    const { start, end } = getWeekRangeDateStrings(currentDate);
    if (!start || !end) return '';
    return `${formatDateLabel(start)} - ${formatDateLabel(end)}`;
  }
  return formatDateLabel(currentDate);
}

function formatTimeRange(startDate, endDate) {
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) return '';
  const startLabel = startDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) {
    return startLabel;
  }
  const endLabel = endDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${startLabel} - ${endLabel}`;
}

function buildParticipantLabel(instance) {
  return getParticipantDisplayNames(instance?.participants, 'ללא משתתפים').join(', ');
}

function SummaryMetric({ label, value, tone = 'default' }) {
  const toneClass = tone === 'warn'
    ? 'border-amber-200 bg-amber-50 text-amber-950'
    : 'border-slate-200 bg-slate-50 text-slate-900';

  return (
    <div className={`rounded-2xl border px-3 py-3 ${toneClass}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

export default function CalendarWorkspaceDock({
  currentDate,
  viewMode,
  summary,
  selectedInstance,
  selectedSlot,
  onClearSelection,
  onOpenCreateLesson,
  onOpenManualGeneration,
  onOpenTemplates,
  onOpenSelectedLesson,
  onOpenInstructorWhatsApp,
  onFixAvailabilityIssue,
}) {
  const dateRangeLabel = formatDateRange(currentDate, viewMode);
  const selectedLessonHasException = Boolean(selectedInstance?.metadata?.scheduling_override?.reason);
  const selectedLessonInstructor = selectedInstance?.instructor?.full_name || selectedInstance?.instructor_name || 'מדריך/ה';
  const selectedLessonService = selectedInstance?.service?.service_name || 'שיעור';
  const selectedLessonStart = selectedInstance?.datetime_start ? new Date(selectedInstance.datetime_start) : null;
  const selectedLessonEnd = selectedLessonStart instanceof Date && !Number.isNaN(selectedLessonStart.getTime())
    ? new Date(selectedLessonStart.getTime() + (Number(selectedInstance?.duration_minutes) || 0) * 60000)
    : null;
  const hasAttentionContent = summary.attentionLessons.length > 0
    || summary.availabilityIssues.length > 0;

  return (
    <aside className="space-y-4">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">מרכז תפעול</CardTitle>
          <p className="text-sm text-slate-500">{dateRangeLabel || '—'}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <SummaryMetric label="מתוכננים" value={summary.scheduledCount} />
            <SummaryMetric label="חריגות" value={summary.exceptionLessons.length} tone={summary.exceptionLessons.length ? 'warn' : 'default'} />
            <SummaryMetric label="לא תועדו" value={summary.undocumentedCompleted.length} tone={summary.undocumentedCompleted.length ? 'warn' : 'default'} />
            <SummaryMetric label="דורש תשומת לב" value={summary.attentionCount} tone={summary.attentionCount ? 'warn' : 'default'} />
          </div>

          <div className="grid gap-2">
            <Button className="justify-between" onClick={onOpenCreateLesson}>
              <span className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                שיעור חדש
              </span>
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button variant="outline" className="justify-between" onClick={onOpenManualGeneration}>
              <span className="flex items-center gap-2">
                <Wand2 className="h-4 w-4" />
                יצירה מתבניות
              </span>
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button variant="outline" className="justify-between" onClick={onOpenTemplates}>
              <span className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4" />
                תבניות
              </span>
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {selectedSlot ? (
        <Card className="border-primary/20 bg-primary/[0.03] shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              חריץ שנבחר
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2 text-sm text-slate-700">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-slate-400" />
                <span>{formatDateLabel(selectedSlot.startDateString)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-slate-400" />
                <span>{formatTimeRange(selectedSlot.start, selectedSlot.end)}</span>
              </div>
              <div className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-slate-400" />
                <span>{selectedSlot.instructorName}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={onOpenCreateLesson}>
                פתח יצירת שיעור
              </Button>
              <Button variant="outline" onClick={onClearSelection}>
                נקה
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {selectedInstance ? (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-slate-500" />
              שיעור נבחר
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <div className="font-medium text-slate-900">{selectedLessonService}</div>
              <div className="text-sm text-slate-600">{buildParticipantLabel(selectedInstance)}</div>
            </div>

            <div className="space-y-2 text-sm text-slate-700">
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-slate-400" />
                <span>{formatTimeRange(selectedLessonStart, selectedLessonEnd)}</span>
              </div>
              <div className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-slate-400" />
                <span>{selectedLessonInstructor}</span>
              </div>
            </div>

            {selectedLessonHasException ? (
              <Badge variant="secondary" className="bg-amber-100 text-amber-950 hover:bg-amber-100">
                חריגה חד-פעמית
              </Badge>
            ) : null}

            <div className="grid gap-2">
              <Button className="justify-between" onClick={onOpenSelectedLesson}>
                <span>פתח פרטי שיעור</span>
                <ExternalLink className="h-4 w-4" />
              </Button>
              <Button variant="ghost" onClick={onClearSelection}>
                נקה בחירה
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!selectedInstance && !selectedSlot && hasAttentionContent ? (
        <Card className="border-amber-200 bg-amber-50/70 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-amber-950">
              <AlertTriangle className="h-4 w-4" />
              דורש תשומת לב
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.attentionLessons.slice(0, 3).map((item) => (
              <div key={item.id} className="rounded-xl border border-amber-200 bg-white/70 px-3 py-2 text-sm text-amber-950">
                <div className="font-medium">{item.instance?.service?.service_name || 'שיעור'}</div>
                <div className="space-y-1 text-xs text-amber-800">
                  {item.hasException ? <div>שיעור זה נשמר כחריגה חד-פעמית עבור {buildParticipantLabel(item.instance)}</div> : null}
                  {item.needsDocumentation ? <div>השיעור הושלם ועדיין חסר תיעוד.</div> : null}
                </div>
              </div>
            ))}

            {summary.availabilityIssues.slice(0, 2).map((issue) => (
              <div key={issue.instructorId} className="rounded-xl border border-amber-200 bg-white/70 px-3 py-2 text-sm text-amber-950">
                <div className="font-medium">{issue.instructorName}</div>
                <div className="text-xs text-amber-800">
                  {issue.blocksVisibility
                    ? `חסרה זמינות ב-${issue.missingCount} שירותים ולכן המדריך/ה לא זמין/ה כרגע בלוח`
                    : `חסרה זמינות ב-${issue.missingCount} שירותים`}
                </div>
                {typeof onFixAvailabilityIssue === 'function' ? (
                  <div className="mt-2">
                    <Button size="sm" variant="outline" onClick={() => onFixAvailabilityIssue(issue)}>
                      תקן זמינות
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {!selectedInstance && !selectedSlot && viewMode === 'week' && summary.visibleInstructors.length > 0 ? (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">סיכומי מדריכים</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {summary.visibleInstructors.slice(0, 5).map((instructor) => (
              <Button
                key={instructor.id}
                variant="outline"
                className="w-full justify-between"
                onClick={() => onOpenInstructorWhatsApp(instructor)}
              >
                <span>{instructor.full_name}</span>
                <MessageCircle className="h-4 w-4" />
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </aside>
  );
}
