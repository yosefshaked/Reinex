import { ChevronRight, ChevronLeft, Calendar } from 'lucide-react';
import { Button } from '../../../../components/ui/button';
import { addLocalDays, getTodayLocalDateString, getWeekRangeDateStrings, parseLocalDateString } from '../../utils/localDate.js';

/**
 * DateNavigator component - navigate between days/weeks and select date
 */
export function DateNavigator({ currentDate, onDateChange, viewMode = 'day' }) {
  const handlePrev = () => {
    const days = viewMode === 'week' ? 7 : 1;
    const date = addLocalDays(currentDate, -days);
    if (date) {
      onDateChange(date);
    }
  };

  const handleNext = () => {
    const days = viewMode === 'week' ? 7 : 1;
    const date = addLocalDays(currentDate, days);
    if (date) {
      onDateChange(date);
    }
  };

  const handleToday = () => {
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
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={handleToday}>
        <Calendar className="w-4 h-4 ms-1" />
        היום
      </Button>
      
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={handleNext}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={handlePrev}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      <span className="text-lg font-medium min-w-[250px] text-center">
        {displayText}
      </span>
    </div>
  );
}
