import { useMemo, useState } from 'react';
import { he } from 'date-fns/locale';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../../../components/ui/button';
import { Calendar as CalendarPicker } from '../../../../components/ui/calendar.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../../../components/ui/popover.jsx';
import { cn } from '../../../../lib/utils.js';
import {
  addLocalDays,
  getTodayLocalDateString,
  getWeekRangeDateStrings,
  parseLocalDateString,
  toLocalDateString,
} from '../../utils/localDate.js';

function formatLongDate(dateString) {
  const date = parseLocalDateString(dateString);
  if (!date) return dateString;
  return date.toLocaleDateString('he-IL', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatShortDate(dateString) {
  const date = parseLocalDateString(dateString);
  if (!date) return dateString;
  return date.toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
  });
}

function buildWeekRangeLabel(dateString) {
  const { start, end } = getWeekRangeDateStrings(dateString);
  if (!start || !end) return '';
  return `${formatLongDate(start)} - ${formatLongDate(end)}`;
}

function buildWeekPreview(dateString) {
  const { start, end } = getWeekRangeDateStrings(dateString);
  if (!start || !end) {
    return { start: null, end: null, label: '' };
  }

  return {
    start,
    end,
    label: `${formatShortDate(start)} - ${formatShortDate(end)}`,
  };
}

/**
 * DateNavigator component - navigate between days/weeks and select date
 */
export function DateNavigator({ currentDate, onDateChange, onNavigate, viewMode = 'day' }) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const selectedDate = useMemo(() => parseLocalDateString(currentDate), [currentDate]);
  const weekPreview = useMemo(() => buildWeekPreview(currentDate), [currentDate]);

  const handlePrev = () => {
    if (typeof onNavigate === 'function') {
      onNavigate('prev');
      return;
    }

    const days = viewMode === 'week' ? 7 : 1;
    const date = addLocalDays(currentDate, -days);
    if (date) {
      onDateChange(date);
    }
  };

  const handleNext = () => {
    if (typeof onNavigate === 'function') {
      onNavigate('next');
      return;
    }

    const days = viewMode === 'week' ? 7 : 1;
    const date = addLocalDays(currentDate, days);
    if (date) {
      onDateChange(date);
    }
  };

  const handleToday = () => {
    if (typeof onNavigate === 'function') {
      onNavigate('today');
      return;
    }

    onDateChange(getTodayLocalDateString());
  };

  const handleCalendarSelect = (date) => {
    const nextDateString = toLocalDateString(date);
    if (!nextDateString) {
      return;
    }

    onDateChange(nextDateString);
    setPickerOpen(false);
  };

  const displayText = viewMode === 'week'
    ? buildWeekRangeLabel(currentDate)
    : formatLongDate(currentDate);

  const subtitle = viewMode === 'week'
    ? `בחירת יום תציג את השבוע: ${weekPreview.label || '—'}`
    : 'בחירת יום מדויקת מהלוח';

  const calendarSelected = viewMode === 'week'
    ? {
        from: parseLocalDateString(weekPreview.start),
        to: parseLocalDateString(weekPreview.end),
      }
    : selectedDate;

  return (
    <div className="flex w-full justify-center">
      <div className="flex w-full max-w-[46rem] flex-wrap items-center justify-center gap-2 rounded-[1.75rem] border border-slate-200 bg-slate-50/90 p-1.5 shadow-sm">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-2xl border border-transparent text-slate-700 hover:border-slate-200 hover:bg-white hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-500/40"
          onClick={handlePrev}
          aria-label="לתאריך קודם"
          title="לתאריך קודם"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        <Button
          type="button"
          variant="ghost"
          className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
          onClick={handleToday}
          aria-label="חזרה להיום"
          title="חזרה להיום"
        >
          <CalendarIcon className="me-1 h-4 w-4" />
          היום
        </Button>

        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="order-last flex h-auto min-h-12 w-full flex-1 flex-col items-center justify-center rounded-[1.2rem] border border-blue-100 bg-gradient-to-b from-white to-blue-50 px-4 py-2 text-center text-slate-900 shadow-sm hover:border-blue-200 hover:bg-blue-50 sm:order-none sm:min-w-[22rem]"
            >
              <span className="truncate text-sm font-semibold sm:text-[0.95rem]">{displayText}</span>
              <span className="mt-0.5 truncate text-[11px] font-medium text-slate-500 sm:text-xs">{subtitle}</span>
            </Button>
          </PopoverTrigger>

          <PopoverContent
            align="center"
            side="bottom"
            sideOffset={12}
            className="w-[24rem] rounded-[1.6rem] border border-slate-200 bg-white p-0 shadow-2xl"
          >
            <div className="border-b border-slate-100 bg-gradient-to-b from-white to-slate-50 px-4 py-4">
              <div className="inline-flex rounded-full border border-slate-200 bg-slate-100 p-1 text-xs font-medium text-slate-500">
                <span className={cn(
                  'rounded-full px-3 py-1 transition',
                  viewMode === 'day' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
                )}
                >
                  יום מדויק
                </span>
                <span className={cn(
                  'rounded-full px-3 py-1 transition',
                  viewMode === 'week' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
                )}
                >
                  שבוע סביב התאריך
                </span>
              </div>

              <div className="mt-3">
                <div className="text-sm font-semibold text-slate-900">
                  {viewMode === 'week' ? 'בחירת תאריך לשבוע' : 'בחירת תאריך ליום'}
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {viewMode === 'week'
                    ? `התאריך שתבחרו יפתח את השבוע שבו הוא נמצא. הטווח שיוצג: ${weekPreview.label || '—'}.`
                    : 'בחירת תאריך תעביר את הלוח ישירות לאותו יום.'}
                </p>
              </div>

              {viewMode === 'week' ? (
                <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-right">
                  <div className="text-[11px] font-medium text-emerald-700">השבוע שיוצג</div>
                  <div className="mt-1 text-sm font-semibold text-emerald-950">{weekPreview.label || '—'}</div>
                </div>
              ) : null}
            </div>

            <div className="p-3">
              <CalendarPicker
                locale={he}
                weekStartsOn={0}
                showOutsideDays
                fixedWeeks
                mode={viewMode === 'week' ? 'range' : 'single'}
                selected={calendarSelected}
                defaultMonth={selectedDate || undefined}
                onSelect={viewMode === 'day' ? handleCalendarSelect : undefined}
                onDayClick={viewMode === 'week' ? handleCalendarSelect : undefined}
                className="mx-auto"
                classNames={{
                  month_caption: 'flex h-9 w-full items-center justify-center px-9',
                  caption_label: 'text-sm font-semibold text-slate-900',
                  weekday: 'flex-1 select-none rounded-md text-[0.78rem] font-medium text-slate-400',
                  day: 'group/day relative aspect-square h-full w-full select-none p-0 text-center',
                  today: 'rounded-xl bg-blue-50 text-blue-700 data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground',
                  outside: 'text-slate-300 aria-selected:text-slate-300',
                }}
              />
            </div>
          </PopoverContent>
        </Popover>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-2xl border border-transparent text-slate-700 hover:border-slate-200 hover:bg-white hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-500/40"
          onClick={handleNext}
          aria-label="לתאריך הבא"
          title="לתאריך הבא"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
