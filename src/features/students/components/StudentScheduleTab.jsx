import React, { useState, useEffect } from 'react';
import { Loader2, BookOpen, CalendarDays } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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

/**
 * Schedule tab: fetches its own lesson templates and upcoming lesson instances.
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

  const activeOrgId = activeOrg?.id;

  // Fetch lesson templates for this student
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

  // Fetch lesson instances for next 14 days
  useEffect(() => {
    if (!studentId || !activeOrgId) return;

    const fetchInstances = async () => {
      setIsLoadingInstances(true);
      setInstanceError(null);
      try {
        const today = new Date();
        const allInstances = [];

        // Fetch day-by-day for 14 days (API requires a date param)
        for (let d = 0; d < 14; d++) {
          const date = new Date(today);
          date.setDate(today.getDate() + d);
          const dateStr = date.toISOString().split('T')[0];

          const dayData = await authenticatedFetch('lesson-instances', {
            session,
            params: { date: dateStr, student_id: studentId, org_id: activeOrgId },
          });

          if (Array.isArray(dayData)) {
            allInstances.push(...dayData);
          }
        }

        // Sort by datetime_start ascending
        allInstances.sort((a, b) => {
          const aTime = new Date(a.datetime_start || 0).getTime();
          const bTime = new Date(b.datetime_start || 0).getTime();
          return aTime - bTime;
        });

        // Keep a stable, deduplicated list in case backend returns the same instance more than once.
        const deduped = Array.from(
          new Map(allInstances.map((item) => [item.id, item])).values()
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

  return (
    <div className="space-y-6">
      {/* Lesson Templates Card */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="h-1.5 bg-blue-500" />
        <div className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center text-lg">📚</div>
            <h3 className="font-semibold text-zinc-800">מפגשים קבועים</h3>
            <span className="me-auto text-sm text-muted-foreground">
              {isLoadingTemplates ? 'טוען...' : `${templates.length} מפגשים קבועים פעילים`}
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
                      {template.instructor?.first_name && (
                        <span>
                          מדריך: {template.instructor.first_name} {template.instructor.last_name || ''}
                        </span>
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
              <p className="text-sm">אין מפגשים קבועים פעילים</p>
            </div>
          )}
        </div>
      </div>

      {/* Upcoming Lesson Instances Table */}
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
                  {instances.map((inst) => (
                    <TableRow key={inst.id}>
                      <TableCell className="font-medium">{formatDate(inst.datetime_start)}</TableCell>
                      <TableCell>{formatTime(inst.datetime_start)}</TableCell>
                      <TableCell>{inst.service?.name || inst.lesson_name || 'שיעור'}</TableCell>
                      <TableCell>
                        {inst.instructor?.first_name
                          ? `${inst.instructor.first_name} ${inst.instructor.last_name || ''}`
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={inst.status === 'completed' ? 'secondary' : 'default'}
                          className="text-xs"
                        >
                          {inst.status === 'completed' ? 'הושלם' : inst.status === 'cancelled' ? 'בוטל' : 'מתוכנן'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
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
    </div>
  );
}
