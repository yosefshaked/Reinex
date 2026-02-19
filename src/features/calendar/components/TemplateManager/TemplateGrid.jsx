import { useMemo } from 'react';
import { Clock, User } from 'lucide-react';
import { cn } from '@/lib/utils';

const DAYS_OF_WEEK = [
  { value: 0, label: 'ראשון', labelShort: 'א׳' },
  { value: 1, label: 'שני', labelShort: 'ב׳' },
  { value: 2, label: 'שלישי', labelShort: 'ג׳' },
  { value: 3, label: 'רביעי', labelShort: 'ד׳' },
  { value: 4, label: 'חמישי', labelShort: 'ה׳' },
  { value: 5, label: 'שישי', labelShort: 'ו׳' },
  { value: 6, label: 'שבת', labelShort: 'ש׳' },
];

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
function TemplateCard({ template, onClick }) {
  const studentName = getStudentName(template.student);
  const serviceName = template.service?.name || '—';
  const serviceColor = template.service?.color || '#6B7280';
  const time = formatTime(template.time_of_day);
  const duration = template.duration_minutes;
  const isInactive = !template.is_active;

  return (
    <button
      type="button"
      className={cn(
        'w-full text-right rounded-md px-2 py-1.5 text-xs border transition-shadow cursor-pointer',
        'hover:shadow-md hover:border-white/60',
        isInactive && 'opacity-50 line-through',
      )}
      style={{
        backgroundColor: `${serviceColor}22`,
        borderColor: `${serviceColor}55`,
      }}
      onClick={() => onClick(template)}
    >
      <div className="flex items-center gap-1 font-medium text-gray-900 truncate">
        <User className="h-3 w-3 shrink-0 text-gray-500" />
        <span className="truncate">{studentName}</span>
      </div>
      <div className="flex items-center gap-1 text-gray-600 mt-0.5">
        <Clock className="h-3 w-3 shrink-0" />
        <span>{time}</span>
        <span className="text-gray-400">({duration} דק׳)</span>
      </div>
      <div
        className="mt-0.5 truncate"
        style={{ color: serviceColor }}
      >
        {serviceName}
      </div>
    </button>
  );
}

/**
 * TemplateGrid component
 * Columns = Instructors, Rows = Days of week (Sunday-Saturday)
 * Each cell shows templates for that instructor/day pair
 */
export function TemplateGrid({ templates, instructors, onTemplateClick, onCellClick, showInactive }) {
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
            <th className="border-b border-l border-gray-200 px-3 py-2 text-right text-sm font-semibold text-gray-700 bg-gray-50 sticky right-0 z-10 w-20">
              יום
            </th>
            {/* Instructor column headers */}
            {instructors.map((instructor) => (
              <th
                key={instructor.id}
                className="border-b border-l border-gray-200 px-3 py-2 text-center text-sm font-semibold text-gray-700 bg-gray-50 min-w-[180px]"
              >
                {getInstructorName(instructor)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS_OF_WEEK.map((day) => (
            <tr key={day.value} className="group">
              {/* Day label */}
              <td className="border-b border-l border-gray-200 px-3 py-2 text-right text-sm font-medium text-gray-700 bg-gray-50/50 sticky right-0 z-10">
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-gray-500">{day.labelShort}</span>
                  <span>{day.label}</span>
                </div>
              </td>
              {/* Template cells per instructor */}
              {instructors.map((instructor) => {
                const cellKey = `${instructor.id}|${day.value}`;
                const cellTemplates = grouped.get(cellKey) || [];

                return (
                  <td
                    key={cellKey}
                    className="border-b border-l border-gray-200 px-2 py-1.5 align-top min-h-[60px] hover:bg-blue-50/30 cursor-pointer transition-colors"
                    onClick={(e) => {
                      // Only fire cell click if they didn't click a template card
                      if (e.target === e.currentTarget || e.target.closest('td') === e.currentTarget) {
                        onCellClick?.(instructor, day.value);
                      }
                    }}
                  >
                    <div className="flex flex-col gap-1 min-h-[48px]">
                      {cellTemplates.map((t) => (
                        <TemplateCard
                          key={t.id}
                          template={t}
                          onClick={(tmpl) => {
                            // Prevent cell click
                            onTemplateClick?.(tmpl);
                          }}
                        />
                      ))}
                      {cellTemplates.length === 0 && (
                        <div className="text-gray-300 text-xs text-center py-3 opacity-0 group-hover:opacity-100 transition-opacity">
                          + הוסף תבנית
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
