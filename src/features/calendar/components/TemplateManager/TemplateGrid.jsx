import { useMemo } from 'react';
import { Clock, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DAY_OPTIONS } from '@/lib/day-of-week.js';
import { getAvailabilityDayTokens } from '@/lib/instructor-availability.js';
import { Badge } from '@/components/ui/badge';

function formatTime(timeString) {
  if (!timeString) return '';
  // time_of_day can be "HH:MM:SS" or "HH:MM"
  const parts = String(timeString).split(':');
  return `${parts[0]}:${parts[1]}`;
}

function getStudentName(student) {
  if (!student) return '—';
  return [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(' ');
}

function getInstructorName(instructor) {
  if (!instructor) return '—';
  return [instructor.first_name, instructor.middle_name, instructor.last_name].filter(Boolean).join(' ');
}

/**
 * Single template card inside the grid cell
 */
function TemplateCard({ template, onClick, isHighlighted = false, matchBucket = null, onMatchClick = null }) {
  const studentName = getStudentName(template.student);
  const serviceName = template.service?.name || '—';
  const serviceColor = template.service?.color || '#6B7280';
  const time = formatTime(template.time_of_day);
  const duration = template.duration_minutes;
  const isInactive = !template.is_active;
  const waitingCount = Number(matchBucket?.count) || 0;

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'w-full text-end rounded-md px-2 py-1.5 text-xs border transition-shadow cursor-pointer',
        'hover:shadow-md hover:border-white/60',
        isInactive && 'opacity-50 line-through',
        isHighlighted && 'ring-2 ring-primary/60 shadow-md',
      )}
      style={{
        backgroundColor: `${serviceColor}22`,
        borderColor: `${serviceColor}55`,
      }}
      onClick={(event) => {
        event.stopPropagation();
        onClick(template);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          onClick(template);
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1 font-medium text-gray-900 truncate">
            <User className="h-3 w-3 shrink-0 text-gray-500" />
            <span className="truncate">{studentName}</span>
          </div>
          <div className="flex items-center gap-1 text-gray-600 mt-0.5">
            <Clock className="h-3 w-3 shrink-0" />
            <span>{time}</span>
            <span className="text-gray-400">({duration} דק׳)</span>
          </div>
        </div>
        {waitingCount > 0 ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              onMatchClick?.(matchBucket, template);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                onMatchClick?.(matchBucket, template);
              }
            }}
          >
            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50">
              {waitingCount} ממתינים
            </Badge>
          </span>
        ) : null}
      </div>
      <div
        className="mt-0.5 truncate"
        style={{ color: serviceColor }}
      >
        {serviceName}
      </div>
    </div>
  );
}

/**
 * TemplateGrid component
 * Columns = Instructors, Rows = Days of week (Sunday-Saturday)
 * Each cell shows templates for that instructor/day pair
 */
export function TemplateGrid({
  templates,
  instructors,
  onTemplateClick,
  onCellClick,
  showInactive,
  highlightedInstructorId = null,
  highlightedDayOfWeek = null,
  highlightedTemplateId = null,
  waitingListMatchMode = 'capacity',
  waitingListTemplateMatches = {},
  waitingListCellMatches = {},
  onWaitingListMatchClick,
}) {
  // Group templates by instructor_employee_id + day_of_week
  const grouped = useMemo(() => {
    const map = new Map(); // key: `${instructorId}|${dayOfWeek}` → template[]
    for (const t of templates) {
      if (!showInactive && !t.is_active) continue;
      const key = `${t.instructor_employee_id}|${t.day_of_week}`;
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(t);
    }
    // Sort each cell by time_of_day
    for (const [, list] of map) {
      list.sort((a, b) => (a.time_of_day || '').localeCompare(b.time_of_day || ''));
    }
    return map;
  }, [templates, showInactive]);

  const availabilityDaysByInstructor = useMemo(() => {
    const map = new Map();
    for (const instructor of instructors || []) {
      const days = new Set();
      for (const capability of instructor?.service_capabilities || []) {
        for (const day of getAvailabilityDayTokens(capability?.availability_windows)) {
          days.add(day);
        }
      }
      map.set(String(instructor?.id || ''), days);
    }
    return map;
  }, [instructors]);

  if (!instructors || instructors.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        אין מדריכים להצגה
      </div>
    );
  }

  return (
    <div className="border border-gray-300 rounded-lg bg-white overflow-x-auto">
      <table className="w-full border-collapse min-w-[600px]">
        <thead>
          <tr>
            {/* Day column header (right side in RTL) */}
            <th className="border-b border-s border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 bg-gray-50 sticky end-0 z-10 w-20">
              יום
            </th>
            {/* Instructor column headers */}
            {instructors.map((instructor) => (
              <th
                key={instructor.id}
                className="border-b border-s border-gray-200 px-3 py-2 text-center text-sm font-semibold text-gray-700 bg-gray-50 min-w-[180px]"
              >
                {getInstructorName(instructor)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAY_OPTIONS.map((day) => (
            <tr key={day.value} className="group">
              {/* Day label */}
              <td className="border-b border-s border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-50/50 sticky end-0 z-10">
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-gray-500">{day.labelShort}</span>
                  <span>{day.label}</span>
                </div>
              </td>
              {/* Template cells per instructor */}
              {instructors.map((instructor) => {
                const cellKey = `${instructor.id}|${day.value}`;
                const cellTemplates = grouped.get(cellKey) || [];
                const hasAvailabilityOnDay = availabilityDaysByInstructor.get(String(instructor.id))?.has(day.value) === true;
                const isUnavailableCell = !hasAvailabilityOnDay && cellTemplates.length === 0;
                const cellMatchBucket = waitingListMatchMode === 'clear_space'
                  ? waitingListCellMatches?.[cellKey] || null
                  : null;
                const cellWaitingCount = Number(cellMatchBucket?.count) || 0;

                return (
                  <td
                    key={cellKey}
                    className={cn(
                      'border-b border-s border-gray-200 px-2 py-1.5 align-top min-h-[60px] transition-colors',
                      !isUnavailableCell && 'hover:bg-blue-50/30 cursor-pointer',
                      isUnavailableCell && 'bg-slate-50 text-slate-400',
                      String(highlightedInstructorId || '') === String(instructor.id || '') &&
                        String(highlightedDayOfWeek || '') === String(day.value) &&
                        'bg-primary/5 ring-2 ring-inset ring-primary/40',
                    )}
                    onClick={(e) => {
                      if (isUnavailableCell) {
                        return;
                      }
                      // Only fire cell click if they didn't click a template card
                      if (e.target === e.currentTarget || e.target.closest('td') === e.currentTarget) {
                        onCellClick?.(instructor, day.value);
                      }
                    }}
                  >
                    <div className="flex flex-col gap-1 min-h-[48px]">
                      {cellWaitingCount > 0 ? (
                        <button
                          type="button"
                          className="self-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                          onClick={(event) => {
                            event.stopPropagation();
                            onWaitingListMatchClick?.({
                              mode: 'clear_space',
                              bucket: cellMatchBucket,
                              template: null,
                              instructor,
                              dayOfWeek: day.value,
                            });
                          }}
                        >
                          יש ממתינים לחלון פנוי
                        </button>
                      ) : null}
                      {cellTemplates.map((t) => (
                        <TemplateCard
                          key={t.id}
                          template={t}
                          isHighlighted={String(highlightedTemplateId || '') === String(t.id || '')}
                          matchBucket={waitingListMatchMode === 'capacity' ? waitingListTemplateMatches?.[t.id] || null : null}
                          onMatchClick={(bucket, template) => onWaitingListMatchClick?.({
                            mode: 'capacity',
                            bucket,
                            template,
                            instructor,
                            dayOfWeek: day.value,
                          })}
                          onClick={(tmpl) => {
                            // Prevent cell click
                            onTemplateClick?.(tmpl);
                          }}
                        />
                      ))}
                      {cellTemplates.length === 0 && !isUnavailableCell && (
                        <div className="flex flex-col items-center gap-2 py-3 text-center">
                          <div className="text-gray-300 text-xs opacity-0 transition-opacity group-hover:opacity-100">
                            + הוסף תבנית
                          </div>
                        </div>
                      )}
                      {cellTemplates.length === 0 && isUnavailableCell && (
                        <div className="text-xs text-center py-3">
                          אין זמינות
                        </div>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
