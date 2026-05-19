import { DateNavigator } from './DateNavigator';

/**
 * CalendarHeader component - contains date navigation and action buttons
 */
export function CalendarHeader({ currentDate, onDateChange, onNavigate, viewMode, actions }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <DateNavigator currentDate={currentDate} onDateChange={onDateChange} onNavigate={onNavigate} viewMode={viewMode} />
      
      {actions && (
        <div className="flex items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
