import { DateNavigator } from './DateNavigator';

/**
 * CalendarHeader component - contains date navigation and action buttons
 */
export function CalendarHeader({ currentDate, onDateChange, actions }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <DateNavigator currentDate={currentDate} onDateChange={onDateChange} />
      
      {actions && (
        <div className="flex items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
