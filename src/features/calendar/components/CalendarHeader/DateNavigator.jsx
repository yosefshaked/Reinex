import { ChevronRight, ChevronLeft, Calendar } from 'lucide-react';
import { Button } from '../../../../components/ui/button';

/**
 * DateNavigator component - navigate between days and select date
 */
export function DateNavigator({ currentDate, onDateChange }) {
  const handlePrevDay = () => {
    const date = new Date(currentDate);
    date.setDate(date.getDate() - 1);
    onDateChange(date.toISOString().split('T')[0]);
  };

  const handleNextDay = () => {
    const date = new Date(currentDate);
    date.setDate(date.getDate() + 1);
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

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={handleToday}>
        <Calendar className="w-4 h-4 ml-1" />
        היום
      </Button>
      
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={handleNextDay}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={handlePrevDay}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      <span className="text-lg font-medium min-w-[250px] text-center">
        {formatDate(currentDate)}
      </span>
    </div>
  );
}
