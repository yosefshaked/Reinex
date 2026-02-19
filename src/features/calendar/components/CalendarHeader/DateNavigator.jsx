import { ChevronRight, ChevronLeft, Calendar } from 'lucide-react';
import { Button } from '../../../../components/ui/button';

/**
 * DateNavigator component - navigate between days/weeks and select date
 */
export function DateNavigator({ currentDate, onDateChange, viewMode = 'day' }) {
  const handlePrev = () => {
    const date = new Date(currentDate);
    const days = viewMode === 'week' ? 7 : 1;
    date.setDate(date.getDate() - days);
    onDateChange(date.toISOString().split('T')[0]);
  };

  const handleNext = () => {
    const date = new Date(currentDate);
    const days = viewMode === 'week' ? 7 : 1;
    date.setDate(date.getDate() + days);
    onDateChange(date.toISOString().split('T')[0]);
  };

  const handleToday = () => {
    onDateChange(new Date().toISOString().split('T')[0]);
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
    const date = new Date(dateString);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const weekStart = new Date(date.setDate(diff));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    
    return `${formatDate(weekStart.toISOString().split('T')[0])} - ${formatDate(weekEnd.toISOString().split('T')[0])}`;
  };

  const displayText = viewMode === 'week' 
    ? getWeekRange(currentDate)
    : formatDate(currentDate);

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={handleToday}>
        <Calendar className="w-4 h-4 ml-1" />
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
