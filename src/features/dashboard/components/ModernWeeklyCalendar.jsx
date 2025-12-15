import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Calendar, dateFnsLocalizer } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { he } from 'date-fns/locale'

import Card from '@/components/ui/CustomCard.jsx'
import { Button } from '@/components/ui/button.jsx'
import { fetchWeeklyComplianceView } from '@/api/weekly-compliance.js'
import InstructorLegend from './InstructorLegend.jsx'

import 'react-big-calendar/lib/css/react-big-calendar.css'
import './modern-calendar.css'

// Configure date-fns localizer
const locales = {
  he,
}

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 0 }), // Sunday
  getDay,
  locales,
})

// Status icons
const STATUS_ICONS = {
  complete: '✓',
  missing: '✕',
  upcoming: '○',
}

// Build chip style based on instructor color
function buildChipStyle(instructorColor, { inactive = false } = {}) {
  if (inactive) {
    return {
      background: 'linear-gradient(135deg, #94a3b8 0%, #64748b 100%)',
      opacity: 0.6,
    }
  }

  if (!instructorColor) {
    return {
      background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
    }
  }

  // Parse color (solid or gradient)
  const trimmed = instructorColor.trim()
  if (trimmed.startsWith('linear-gradient')) {
    return { background: trimmed }
  }
  
  // Solid color - create gradient
  return {
    background: `linear-gradient(135deg, ${trimmed} 0%, ${trimmed}dd 100%)`,
  }
}

// Custom event component for modern styling
function ModernEvent({ event }) {
  const chipStyle = buildChipStyle(event.instructorColor, {
    inactive: event.instructorIsActive === false,
  })

  const statusIcon = STATUS_ICONS[event.status]

  return (
    <div
      className="modern-event-content"
      style={chipStyle}
    >
      <span className="event-student-name">{event.studentName || '—'}</span>
      {statusIcon && (
        <span className="event-status-icon">{statusIcon}</span>
      )}
    </div>
  )
}

// Custom toolbar with modern design
function ModernToolbar({ label, onNavigate, onView, view, views }) {
  return (
    <div className="modern-calendar-toolbar">
      <div className="toolbar-navigation">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onNavigate('PREV')}
          aria-label="שבוע קודם"
        >
          ‹
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onNavigate('TODAY')}
        >
          היום
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onNavigate('NEXT')}
          aria-label="שבוע הבא"
        >
          ›
        </Button>
      </div>
      
      <div className="toolbar-label">
        <h3 className="text-lg font-semibold text-foreground">{label}</h3>
      </div>

      {views && views.length > 1 && (
        <div className="toolbar-views">
          {views.map(viewName => (
            <Button
              key={viewName}
              type="button"
              size="sm"
              variant={view === viewName ? 'default' : 'ghost'}
              onClick={() => onView(viewName)}
            >
              {viewName === 'week' ? 'שבוע' : viewName === 'day' ? 'יום' : viewName}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

// Custom header component to show full dates
function CustomHeader({ date, label }) {
  void label
  const dayName = format(date, 'EEEE', { locale: he })
  const fullDate = format(date, 'dd.MM.yyyy')
  const isToday = format(new Date(), 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
  
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className={isToday ? 'font-bold' : 'font-semibold'}>
        {dayName}
      </div>
      <div className={`text-xs ${isToday ? 'font-semibold' : 'font-normal text-muted-foreground'}`}>
        {fullDate}
      </div>
    </div>
  )
}

export default function ModernWeeklyCalendar({ orgId }) {
  const navigate = useNavigate()
  const [date, setDate] = useState(new Date())
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [view, setView] = useState('week')

  // Fetch data based on current date
  useEffect(() => {
    if (!orgId) {
      setData(null)
      return
    }

    // Calculate week start (Sunday)
    const weekStart = startOfWeek(date, { weekStartsOn: 0 })
    const weekStartIso = format(weekStart, 'yyyy-MM-dd')

    const controller = new AbortController()
    let isMounted = true
    setIsLoading(true)
    setError(null)

    fetchWeeklyComplianceView({ orgId, weekStart: weekStartIso, signal: controller.signal })
      .then(response => {
        if (!isMounted) return
        setData(response)
      })
      .catch(fetchError => {
        if (fetchError.name === 'AbortError') return
        if (!isMounted) return
        console.error('Failed to load weekly compliance data', fetchError)
        setError(fetchError)
        setData(null)
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false)
        }
      })

    return () => {
      isMounted = false
      controller.abort()
    }
  }, [orgId, date])

  // Transform data to React Big Calendar event format
  const events = useMemo(() => {
    if (!data?.days) return []

    const calendarEvents = []

    for (const day of data.days) {
      if (!day.date || !Array.isArray(day.sessions)) continue

      for (const session of day.sessions) {
        if (!session.time) continue

        // Parse time (HH:MM)
        const [hours, minutes] = session.time.split(':').map(Number)
        
        // Create date objects
        const startDate = new Date(day.date)
        startDate.setHours(hours, minutes, 0, 0)
        
        const endDate = new Date(startDate)
        endDate.setMinutes(endDate.getMinutes() + 30) // 30-minute sessions

        calendarEvents.push({
          id: `${session.studentId}-${day.date}-${session.time}`,
          title: session.studentName || '—',
          start: startDate,
          end: endDate,
          studentName: session.studentName,
          studentId: session.studentId,
          instructorName: session.instructorName,
          instructorColor: session.instructorColor,
          instructorIsActive: session.instructorIsActive,
          status: session.status,
          time: session.time,
        })
      }
    }

    return calendarEvents
  }, [data])

  // Get time range for calendar view
  const { minTime, maxTime } = useMemo(() => {
    if (!data?.timeWindow) {
      return {
        minTime: new Date(2025, 0, 1, 8, 0), // 8:00 AM default
        maxTime: new Date(2025, 0, 1, 20, 0), // 8:00 PM default
      }
    }

    const start = data.timeWindow.startMinutes ?? data.timeWindow.start ?? 480 // 8:00 default
    const end = data.timeWindow.endMinutes ?? data.timeWindow.end ?? 1200 // 20:00 default

    const minHours = Math.floor(start / 60)
    const minMinutes = start % 60
    const maxHours = Math.floor(end / 60)
    const maxMinutes = end % 60

    return {
      minTime: new Date(2025, 0, 1, minHours, minMinutes),
      maxTime: new Date(2025, 0, 1, maxHours, maxMinutes),
    }
  }, [data])

  const handleSelectEvent = useCallback(
    event => {
      if (event.studentId) {
        navigate(`/students/${event.studentId}`)
      }
    },
    [navigate],
  )

  const handleNavigate = useCallback(newDate => {
    setDate(newDate)
  }, [])

  const handleViewChange = useCallback(newView => {
    setView(newView)
  }, [])

  return (
    <Card className="relative overflow-visible rounded-2xl border border-border bg-surface p-lg shadow-sm">
      <div className="relative min-w-0" dir="rtl">
        <div className="mb-lg">
          <h2 className="text-2xl font-semibold text-foreground">מעקב מצב התיעודים</h2>
          <p className="mt-xs text-sm text-muted-foreground">
            מעקב חזותי אחר השיעורים המתוכננים והסטטוס של התיעוד שלהם.
          </p>
        </div>

        {/* Instructor Legend */}
        <div className="mb-md">
          <InstructorLegend orgId={orgId} />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-xl">
            <span className="text-sm text-muted-foreground">טוען נתוני שיעורים...</span>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-lg text-destructive">
            <p className="text-base font-semibold">אירעה שגיאה בטעינת הנתונים.</p>
            <p className="mt-xs text-sm">נסו לרענן את הדף או לחזור מאוחר יותר.</p>
          </div>
        ) : null}

        {!isLoading && !error && events.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין מפגשים מתוכננים לשבוע זה.</p>
        ) : null}

        {!isLoading && !error && events.length > 0 && (
          <div className="modern-calendar-wrapper">
            <Calendar
              localizer={localizer}
              events={events}
              date={date}
              view={view}
              views={['week', 'day']}
              onNavigate={handleNavigate}
              onView={handleViewChange}
              onSelectEvent={handleSelectEvent}
              min={minTime}
              max={maxTime}
              step={30}
              timeslots={1}
              culture="he"
              rtl
              components={{
                toolbar: ModernToolbar,
                event: ModernEvent,
                week: {
                  header: CustomHeader,
                },
                day: {
                  header: CustomHeader,
                },
              }}
              eventPropGetter={() => ({
                className: 'modern-calendar-event',
              })}
              dayPropGetter={() => ({
                className: 'modern-calendar-day',
              })}
              slotPropGetter={() => ({
                className: 'modern-calendar-slot',
              })}
            />
          </div>
        )}
      </div>
    </Card>
  )
}
