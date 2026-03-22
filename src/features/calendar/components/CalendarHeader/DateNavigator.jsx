import { ChevronRight, ChevronLeft, Calendar } from 'lucide-react';
import { Button } from '../../../../components/ui/button';

function toLocalDateString(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getWeekStart(dateString) {
  const date = new Date(dateString);
  const day = date.getDay();
  date.setDate(date.getDate() - day);
  return date;
}

/**
 * DateNavigator component - navigate between days/weeks and select date
 */
export function DateNavigator({ currentDate, onDateChange, viewMode = 'day' }) {
  const handlePrev = () => {
    const date = new Date(currentDate);
    const days = viewMode === 'week' ? 7 : 1;
    date.setDate(date.getDate() - days);
    onDateChange(toLocalDateString(date));
  };

  const handleNext = () => {
    const date = new Date(currentDate);
    const days = viewMode === 'week' ? 7 : 1;
    date.setDate(date.getDate() + days);
    onDateChange(toLocalDateString(date));
  };

  const handleToday = () => {
    onDateChange(toLocalDateString(new Date()));
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('he-IL', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  const getWeekRange = (dateString) => {
    const weekStart = getWeekStart(dateString);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    
    return `${formatDate(toLocalDateString(weekStart))} - ${formatDate(toLocalDateString(weekEnd))}`;
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
