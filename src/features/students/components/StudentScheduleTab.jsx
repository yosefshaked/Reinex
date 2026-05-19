import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, BookOpen, CalendarDays, History, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';

const DAY_NAMES_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function formatDate(isoString) {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleDateString('he-IL', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
    });
  } catch {
    return isoString;
  }
}

function formatTime(isoString) {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleTimeString('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

function formatDayOfWeek(dayToken) {
  if (dayToken == null) return '';
  const idx = Number(dayToken);
  if (idx >= 0 && idx < DAY_NAMES_HE.length) return DAY_NAMES_HE[idx];
  const lower = String(dayToken).toLowerCase();
  const map = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  if (lower in map) return DAY_NAMES_HE[map[lower]];
  return String(dayToken);
}

function getServiceName(instance) {
  return instance?.service?.service_name || instance?.service?.name || instance?.lesson_name || 'שיעור';
}

function getInstructorName(instance) {
  const instructor = instance?.instructor;
  if (!instructor) return '—';
  const fromParts = [instructor.first_name, instructor.last_name].filter(Boolean).join(' ').trim();
  if (fromParts) return fromParts;
  return instructor.name || '—';
}

function getTemplateInstructorName(template) {
  const instructor = template?.instructor;
  if (!instructor) return '—';
  return [instructor.first_name, instructor.middle_name, instructor.last_name].filter(Boolean).join(' ') || instructor.name || '—';
}

const HISTORY_WINDOW_DAYS = 90;

function getParticipantForStudent(instance, studentId) {
  return (instance?.participants || []).find((p) => p.student_id === studentId) || null;
}

function getDisplayInstance(instance) {
  return instance?.latest_correction?.effective_state?.instance
    ? { ...instance, ...instance.latest_correction.effective_state.instance }
    : instance;
}

function getDisplayParticipantForStudent(instance, studentId) {
  const baseParticipant = getParticipantForStudent(instance, studentId);
  const effectiveParticipants = Array.isArray(instance?.latest_correction?.effective_state?.participants)
    ? instance.latest_correction.effective_state.participants
    : [];
  const effectiveParticipant = effectiveParticipants.find((participant) => participant.student_id === studentId);
  if (baseParticipant && effectiveParticipant) {
    return { ...baseParticipant, ...effectiveParticipant };
  }
  return effectiveParticipant || baseParticipant;
}

function getInstanceStatusConfig(status) {
  switch (status) {
    case 'completed': return { label: 'הושלם', className: 'bg-green-100 text-green-800 border-green-200' };
    case 'cancelled_student': return { label: 'בוטל ע"י תלמיד', className: 'bg-orange-100 text-orange-800 border-orange-200' };
    case 'cancelled_clinic': return { label: 'בוטל ע"י המכון', className: 'bg-red-100 text-red-800 border-red-200' };
    case 'no_show': return { label: 'אי הגעה', className: 'bg-red-100 text-red-800 border-red-200' };
    case 'scheduled': return { label: 'מתוכנן', className: 'bg-blue-100 text-blue-800 border-blue-200' };
    default: return { label: status || '—', className: 'bg-gray-100 text-gray-700 border-gray-200' };
  }
}

function getParticipantStatusConfig(status) {
  switch (status) {
    case 'attended': return { label: '✓ נכח', className: 'bg-green-100 text-green-800 border-green-200' };
    case 'no_show': return { label: '✗ לא הגיע', className: 'bg-red-100 text-red-800 border-red-200' };
    case 'cancelled_student': return { label: 'בוטל ע"י תלמיד', className: 'bg-orange-100 text-orange-800 border-orange-200' };
    case 'cancelled_clinic': return { label: 'בוטל ע"י המכון', className: 'bg-red-100 text-red-800 border-red-200' };
    case 'scheduled': return { label: 'מתוכנן', className: 'bg-blue-100 text-blue-800 border-blue-200' };
    default: return { label: status || '—', className: 'bg-gray-100 text-gray-700 border-gray-200' };
  }
}

function getClosedReasonLabel(reason) {
  const map = {
    student_request: 'בקשת תלמיד',
    clinic_closure: 'סגירת מרפאה',
    instructor_unavailable: 'מדריך לא זמין',
    doctor_note: 'אישור רופא',
    no_show: 'אי הגעה',
    other: 'אחר',
  };
  return map[reason] || reason || null;
}

/**
 * Schedule tab: lesson templates, upcoming instances, and lesson history.
 *
 * @param {Object} props
 * @param {string} props.studentId
 */
export default function StudentScheduleTab({ studentId }) {
  const { session } = useSupabase();
  const { activeOrg } = useOrg();

  const [templates, setTemplates] = useState([]);
  const [instances, setInstances] = useState([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [isLoadingInstances, setIsLoadingInstances] = useState(true);
  const [templateError, setTemplateError] = useState(null);
  const [instanceError, setInstanceError] = useState(null);

  const [historyItems, setHistoryItems] = useState([]);
  const [historyWindowCount, setHistoryWindowCount] = useState(1);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isLoadingMoreHistory, setIsLoadingMoreHistory] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);

  const activeOrgId = activeOrg?.id;

  useEffect(() => {
    if (!studentId || !activeOrgId) return;
    const fetchTemplates = async () => {
      setIsLoadingTemplates(true);
      setTemplateError(null);
      try {
        const data = await authenticatedFetch('lesson-templates', {
          session,
          params: { student_id: studentId, org_id: activeOrgId },
        });
        setTemplates(Array.isArray(data) ? data.filter((t) => t?.is_active !== false) : []);
      } catch (err) {
        console.error('Failed to load lesson templates', err);
        setTemplateError(err?.message || 'טעינת קורסים נכשלה');
      } finally {
        setIsLoadingTemplates(false);
      }
    };
    void fetchTemplates();
  }, [studentId, activeOrgId, session]);

  useEffect(() => {
    if (!studentId || !activeOrgId) return;
    const fetchInstances = async () => {
      setIsLoadingInstances(true);
      setInstanceError(null);
      try {
        const today = new Date();
        const endDate = new Date(today);
        endDate.setDate(today.getDate() + 13);
        const startStr = today.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];
        const data = await authenticatedFetch('calendar/instances', {
          session,
          params: {
            org_id: activeOrgId,
            student_id: studentId,
            start_date: startStr,
            end_date: endStr,
          },
        });
        const allInstances = Array.isArray(data) ? data : [];
        const sortedInstances = allInstances.sort((a, b) =>
          new Date(a.datetime_start || 0).getTime() - new Date(b.datetime_start || 0).getTime()
        );
        const deduped = Array.from(
          new Map(sortedInstances.map((item) => [item.id, item])).values()
        );
        setInstances(deduped);
      } catch (err) {
        console.error('Failed to load lesson instances', err);
        setInstanceError(err?.message || 'טעינת שיעורים נכשלה');
      } finally {
        setIsLoadingInstances(false);
      }
    };
    void fetchInstances();
  }, [studentId, activeOrgId, session]);

  const fetchHistoryWindow = useCallback(async (windowIndex, append) => {
    if (!studentId || !activeOrgId) return;
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(today.getDate() - windowIndex * HISTORY_WINDOW_DAYS - 1);
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - (HISTORY_WINDOW_DAYS - 1));
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];
    try {
      const data = await authenticatedFetch('calendar/instances', {
        session,
        params: { org_id: activeOrgId, student_id: studentId, start_date: startStr, end_date: endStr },
      });
      const results = Array.isArray(data) ? data : [];
      results.sort((a, b) => new Date(b.datetime_start).getTime() - new Date(a.datetime_start).getTime());
      if (append) {
        setHistoryItems((prev) => [...prev, ...results]);
      } else {
        setHistoryItems(results);
      }
      setHistoryHasMore(results.length >= 1);
    } catch (err) {
      console.error('Failed to load lesson history', err);
      setHistoryError(err?.message || 'טעינת היסטוריה נכשלה');
    }
  }, [studentId, activeOrgId, session]);

  useEffect(() => {
    if (!studentId || !activeOrgId) return;
    setHistoryItems([]);
    setHistoryWindowCount(1);
    setHistoryError(null);
    setHistoryHasMore(false);
    setIsLoadingHistory(true);
    fetchHistoryWindow(0, false).finally(() => setIsLoadingHistory(false));
  }, [studentId, activeOrgId, fetchHistoryWindow]);

  async function handleLoadMoreHistory() {
    if (isLoadingMoreHistory) return;
    setIsLoadingMoreHistory(true);
    const nextWindow = historyWindowCount;
    await fetchHistoryWindow(nextWindow, true);
    setHistoryWindowCount((c) => c + 1);
    setIsLoadingMoreHistory(false);
  }

  return (
    <div className="space-y-6">
      {/* Lesson Templates Card */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="h-1.5 bg-blue-500" />
        <div className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center text-lg">📚</div>
            <h3 className="font-semibold text-zinc-800">תבניות קבועות</h3>
            <span className="me-auto text-sm text-muted-foreground">
              {isLoadingTemplates ? 'טוען...' : `${templates.length} תבניות קבועות פעילות`}
            </span>
          </div>
          {isLoadingTemplates ? (
            <div className="space-y-3">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : templateError ? (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {templateError}
            </div>
          ) : templates.length > 0 ? (
            <div className="space-y-2">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className="flex items-center justify-between rounded-md border px-4 py-3 hover:bg-neutral-50/50"
                >
                  <div className="flex-1 space-y-1">
                    <p className="font-semibold text-sm">
                      {template.service?.name || template.lesson_name || 'קורס'}
                    </p>
                    <div className="flex flex-wrap gap-2 items-center text-xs text-neutral-600">
                      {getTemplateInstructorName(template) !== '—' && (
                        <span>מדריך: {getTemplateInstructorName(template)}</span>
                      )}
                      {template.day_of_week != null && (
                        <>
                          <span className="text-neutral-300">|</span>
                          <span>יום {formatDayOfWeek(template.day_of_week)}</span>
                        </>
                      )}
                      {template.time_of_day && (
                        <>
                          <span className="text-neutral-300">|</span>
                          <span>{template.time_of_day}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <Badge variant="secondary" className="ms-2">פעיל</Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-neutral-500">
              <BookOpen className="h-10 w-10 mb-2 text-neutral-300" />
              <p className="text-sm">אין תבניות קבועות פעילות</p>
            </div>
          )}
        </div>
      </div>

      {/* Upcoming Lesson Instances */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="h-1.5 bg-green-500" />
        <div className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-lg bg-green-100 text-green-600 flex items-center justify-center text-lg">📅</div>
            <h3 className="font-semibold text-zinc-800">שיעורים ב-14 ימים הקרובים</h3>
            <span className="me-auto text-sm text-muted-foreground">
              {isLoadingInstances ? 'טוען...' : `${instances.length} שיעורים מתוכננים`}
            </span>
          </div>
          {isLoadingInstances ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : instanceError ? (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {instanceError}
            </div>
          ) : instances.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>תאריך</TableHead>
                    <TableHead>שעה</TableHead>
                    <TableHead>שיעור</TableHead>
                    <TableHead>מדריך</TableHead>
                    <TableHead>סטטוס</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instances.map((inst) => {
                    const displayInstance = getDisplayInstance(inst);
                    return (
                    <TableRow key={inst.id}>
                      <TableCell className="font-medium">{formatDate(displayInstance.datetime_start)}</TableCell>
                      <TableCell>{formatTime(displayInstance.datetime_start)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{getServiceName(displayInstance)}</span>
                          {inst.latest_correction && <Badge className="bg-sky-100 text-sky-800 border-sky-200">מתוקן</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>{getInstructorName(displayInstance)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={displayInstance.status === 'completed' ? 'secondary' : 'default'}
                          className="text-xs"
                        >
                          {displayInstance.status === 'completed' ? 'הושלם' : displayInstance.status === 'cancelled' ? 'בוטל' : 'מתוכנן'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )})}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-neutral-500">
              <CalendarDays className="h-10 w-10 mb-2 text-neutral-300" />
              <p className="text-sm">אין שיעורים מתוכננים</p>
            </div>
          )}
        </div>
      </div>

      {/* Lesson History */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="h-1.5 bg-violet-500" />
        <div className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-lg bg-violet-100 text-violet-600 flex items-center justify-center">
              <History className="h-5 w-5" />
            </div>
            <h3 className="font-semibold text-zinc-800">היסטוריית שיעורים</h3>
            {!isLoadingHistory && !historyError && (
              <span className="me-auto text-sm text-muted-foreground">
                {historyItems.length === 0
                  ? 'אין היסטוריה'
                  : `${historyItems.length} שיעורים (${historyWindowCount * HISTORY_WINDOW_DAYS} ימים אחרונים)`}
              </span>
            )}
          </div>
          {isLoadingHistory ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : historyError ? (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {historyError}
            </div>
          ) : historyItems.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">תאריך</TableHead>
                      <TableHead className="w-16">שעה</TableHead>
                      <TableHead>שירות</TableHead>
                      <TableHead>מדריך</TableHead>
                      <TableHead>סטטוס שיעור</TableHead>
                      <TableHead>נוכחות</TableHead>
                      <TableHead>סיבה / הערה</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyItems.map((inst) => {
                      const displayInstance = getDisplayInstance(inst);
                      const participant = getDisplayParticipantForStudent(inst, studentId);
                      const instStatusCfg = getInstanceStatusConfig(displayInstance.status);
                      const partStatusCfg = participant
                        ? getParticipantStatusConfig(participant.participant_status)
                        : null;
                      const closedReason = getClosedReasonLabel(displayInstance.closed_reason);
                      const participantNote = participant?.metadata?.notes || null;
                      const reasonOrNote = participantNote || closedReason;
                      return (
                        <TableRow key={inst.id}>
                          <TableCell className="font-medium text-sm">{formatDate(displayInstance.datetime_start)}</TableCell>
                          <TableCell className="text-sm">{formatTime(displayInstance.datetime_start)}</TableCell>
                          <TableCell className="text-sm">
                            <div className="flex items-center gap-2">
                              <span>{getServiceName(displayInstance)}</span>
                              {inst.latest_correction && <Badge className="bg-sky-100 text-sky-800 border-sky-200">מתוקן</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{getInstructorName(displayInstance)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-xs font-normal ${instStatusCfg.className}`}>
                              {instStatusCfg.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {partStatusCfg ? (
                              <Badge variant="outline" className={`text-xs font-normal ${partStatusCfg.className}`}>
                                {partStatusCfg.label}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate" title={reasonOrNote || ''}>
                            {reasonOrNote || '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {historyHasMore && (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLoadMoreHistory}
                    disabled={isLoadingMoreHistory}
                  >
                    {isLoadingMoreHistory ? (
                      <Loader2 className="h-4 w-4 animate-spin me-2" />
                    ) : (
                      <ChevronDown className="h-4 w-4 me-2" />
                    )}
                    הצג 90 ימים נוספים
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-neutral-500">
              <History className="h-10 w-10 mb-2 text-neutral-300" />
              <p className="text-sm">אין היסטוריית שיעורים ב-{HISTORY_WINDOW_DAYS} הימים האחרונים</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
