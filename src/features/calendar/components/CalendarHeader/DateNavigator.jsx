import { ChevronRight, ChevronLeft, Calendar } from 'lucide-react';
import { Button } from '../../../../components/ui/button';
import { addLocalDays, getTodayLocalDateString, getWeekRangeDateStrings, parseLocalDateString } from '../../utils/localDate.js';

/**
 * DateNavigator component - navigate between days/weeks and select date
 */
export function DateNavigator({ currentDate, onDateChange, onNavigate, viewMode = 'day' }) {
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

  const formatDate = (dateString) => {
    const date = parseLocalDateString(dateString);
    if (!date) return dateString;
    return date.toLocaleDateString('he-IL', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  const getWeekRange = (dateString) => {
    const { start, end } = getWeekRangeDateStrings(dateString);
    return `${formatDate(start)} - ${formatDate(end)}`;
  };

  const displayText = viewMode === 'week' 
    ? getWeekRange(currentDate)
    : formatDate(currentDate);

  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-2 sm:gap-3">
      <div className="inline-flex items-center rounded-2xl border border-slate-200 bg-slate-50 p-1 shadow-sm">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-xl border border-transparent text-slate-700 hover:border-slate-200 hover:bg-white hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-500/40"
          onClick={handlePrev}
          aria-label="לתאריך קודם"
          title="לתאריך קודם"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        <Button
          type="button"
          variant="ghost"
          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
          onClick={handleToday}
          aria-label="חזרה להיום"
          title="חזרה להיום"
        >
          <Calendar className="me-1 h-4 w-4" />
          היום
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-xl border border-transparent text-slate-700 hover:border-slate-200 hover:bg-white hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-500/40"
          onClick={handleNext}
          aria-label="לתאריך הבא"
          title="לתאריך הבא"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      <span className="order-last w-full truncate text-center text-base font-semibold text-slate-900 sm:order-none sm:w-auto sm:min-w-[18rem] sm:text-lg">
        {displayText}
      </span>
    </div>
  );
}
