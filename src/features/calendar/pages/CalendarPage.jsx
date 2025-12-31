import React, { useState, useEffect } from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { useOrg } from '@/org/OrgContext.jsx';
import { fetchInstructors, fetchServices, fetchDailyLessons } from '../api/calendarApi.js';
import DailyCalendar from '../components/DailyCalendar.jsx';
import PageLayout from '@/components/ui/PageLayout.jsx';
import { Button } from '@/components/ui/button.jsx';

/**
 * Format date for display (Hebrew)
 */
function formatDateDisplay(date) {
  const options = { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  };
  return date.toLocaleDateString('he-IL', options);
}

/**
 * Get start and end of day (00:00:00 to 23:59:59)
 */
function getDayBounds(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  
  return { start, end };
}

export default function CalendarPage() {
  const { activeOrgId } = useOrg();
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [instructors, setInstructors] = useState([]);
  const [services, setServices] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch data when date or org changes
  useEffect(() => {
    if (!activeOrgId) {
      setLoading(false);
      return;
    }

    const abortController = new AbortController();
    setLoading(true);
    setError(null);

    const { start, end } = getDayBounds(currentDate);

    Promise.all([
      fetchInstructors(activeOrgId, { signal: abortController.signal }),
      fetchServices(activeOrgId, { signal: abortController.signal }),
      fetchDailyLessons(activeOrgId, start, end, { signal: abortController.signal }),
    ])
      .then(([instructorsData, servicesData, lessonsData]) => {
        setInstructors(instructorsData);
        setServices(servicesData);
        setLessons(lessonsData);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('Failed to fetch calendar data:', err);
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      abortController.abort();
    };
  }, [activeOrgId, currentDate]);

  const goToPreviousDay = () => {
    setCurrentDate(prevDate => {
      const newDate = new Date(prevDate);
      newDate.setDate(newDate.getDate() - 1);
      return newDate;
    });
  };

  const goToNextDay = () => {
    setCurrentDate(prevDate => {
      const newDate = new Date(prevDate);
      newDate.setDate(newDate.getDate() + 1);
      return newDate;
    });
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  if (!activeOrgId) {
    return (
      <PageLayout title="לוח שנה">
        <div className="flex items-center justify-center h-64 text-neutral-500">
          אנא בחר ארגון כדי להציג את לוח השנה
        </div>
      </PageLayout>
    );
  }

  if (loading) {
    return (
      <PageLayout title="לוח שנה">
        <div className="flex items-center justify-center h-64 text-neutral-500">
          טוען נתונים...
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout title="לוח שנה">
        <div className="flex items-center justify-center h-64 text-red-500">
          שגיאה בטעינת הנתונים: {error}
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout 
      title="לוח שנה"
      subtitle={formatDateDisplay(currentDate)}
    >
      {/* Date navigation */}
      <div className="flex items-center justify-between mb-4 gap-4" dir="rtl">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={goToPreviousDay}
            title="יום קודם"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={goToToday}
          >
            היום
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={goToNextDay}
            title="יום הבא"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>

        <div className="text-sm text-neutral-600">
          {lessons.length} שיעורים מתוכננים
        </div>
      </div>

      {/* Calendar grid */}
      <div className="border border-border rounded-lg overflow-hidden bg-white" style={{ height: 'calc(100vh - 250px)' }}>
        <DailyCalendar
          instructors={instructors}
          lessons={lessons}
          currentDate={currentDate}
        />
      </div>
    </PageLayout>
  );
}
