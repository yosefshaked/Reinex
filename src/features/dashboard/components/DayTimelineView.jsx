import React, { useState, useEffect, useMemo } from 'react'
import { format, startOfDay, parseISO, startOfWeek } from 'date-fns'
import { he } from 'date-fns/locale'
import { useNavigate } from 'react-router-dom'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { fetchWeeklyComplianceView } from '@/api/weekly-compliance'

export function DayTimelineView({ orgId, date, onBack }) {
  const [data, setData] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    ;(async () => {
      setIsLoading(true)
      setError(null)
      try {
        const weekStart = startOfWeek(startOfDay(parseISO(date)))
        const result = await fetchWeeklyComplianceView({
          orgId,
          weekStart: format(weekStart, 'yyyy-MM-dd'),
        })
        setData(result)
      } catch (err) {
        console.error('Failed to load day data:', err)
        setError(err.message)
      } finally {
        setIsLoading(false)
      }
    })()
  }, [orgId, date])

  const timelineData = useMemo(() => {
    if (!data?.days) return null

    const targetDay = data.days.find(d => d.date === date)
    if (!targetDay) return null

    // Group sessions by instructor
    const instructorMap = new Map()
    
    targetDay.sessions.forEach(session => {
      const instructorId = session.instructorId || 'unassigned'
      const instructorName = session.instructorName || 'לא משויך'
      
      if (!instructorMap.has(instructorId)) {
        instructorMap.set(instructorId, {
          id: instructorId,
          name: instructorName,
          color: session.instructorColor,
          sessions: []
        })
      }
      
      instructorMap.get(instructorId).sessions.push(session)
    })

    // Convert to array and sort sessions by time
    const instructors = Array.from(instructorMap.values())
    instructors.forEach(inst => {
      inst.sessions.sort((a, b) => a.timeMinutes - b.timeMinutes)
    })

    // Sort instructors by name
    instructors.sort((a, b) => a.name.localeCompare(b.name, 'he'))

    // Calculate time range (using minutes-based positioning)
    const minutesArray = targetDay.sessions
      .map(s => (typeof s.timeMinutes === 'number' ? s.timeMinutes : null))
      .filter(m => m !== null)

    const minHour = minutesArray.length > 0 ? Math.floor(Math.min(...minutesArray) / 60) : 8
    const maxHour = minutesArray.length > 0 ? Math.ceil(Math.max(...minutesArray) / 60) : 18

    // Build hours array forward for LTR timeline (earliest hour first)
    const hours = []
    for (let h = minHour; h <= maxHour; h++) {
      hours.push(`${String(h).padStart(2, '0')}:00`)
    }

    return { instructors, hours, minHour, maxHour }
  }, [data, date])

  function calculatePosition(timeMinutes, minHour) {
    // For LTR: calculate from the left (min hour)
    const minutesFromStart = timeMinutes - (minHour * 60)
    return (minutesFromStart / 60) * 120 // 120px per hour
  }

  // Smart stacking: find the first available row for a session based on time overlap
  function calculateStackPosition(sessions, currentIndex) {
    const current = sessions[currentIndex]
    const currentStart = current.timeMinutes
    const currentEnd = currentStart + 30 // 30-minute sessions
    
    // Track which rows (vertical positions) are occupied at each time range
    const rows = []
    
    // Check all previous sessions to find overlaps
    for (let i = 0; i < currentIndex; i++) {
      const prev = sessions[i]
      const prevStart = prev.timeMinutes
      const prevEnd = prevStart + 30
      
      // Check if there's time overlap
      if (currentStart < prevEnd && currentEnd > prevStart) {
        // Find which row this session is in
        const prevRow = prev._stackRow || 0
        rows[prevRow] = true
      }
    }
    
    // Find first available row
    let targetRow = 0
    while (rows[targetRow]) {
      targetRow++
    }
    
    return targetRow
  }

  function getStatusColor(session) {
    if (session.status === 'upcoming') return 'bg-muted border-muted-foreground/30'
    if (session.status === 'missing') return 'bg-red-100 dark:bg-red-950 border-red-400 dark:border-red-700'
    return 'bg-green-100 dark:bg-green-950 border-green-400 dark:border-green-700'
  }

  function getStatusIcon(session) {
    if (session.status === 'upcoming') return '⚠'
    if (session.status === 'missing') return '✗'
    return '✓'
  }

  const dateObj = parseISO(date)
  const dayName = format(dateObj, 'EEEE', { locale: he })
  const fullDate = format(dateObj, 'dd.MM.yyyy', { locale: he })

  return (
    <Card className="w-full">
      <div className="p-lg">
        {/* Header */}
        <div className="flex items-center justify-between mb-md">
          <div>
            <h2 className="text-2xl font-semibold text-foreground">
              {dayName} - {fullDate}
            </h2>
            <p className="mt-xs text-sm text-muted-foreground">
              תצוגת ציר זמן מפורט לפי מדריכים
            </p>
          </div>
          <Button variant="outline" onClick={onBack}>
            ← חזרה לתצוגת שבוע
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-xl">
            <span className="text-sm text-muted-foreground">טוען נתוני יום...</span>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-lg text-destructive">
            <p className="text-base font-semibold">אירעה שגיאה בטעינת הנתונים.</p>
            <p className="mt-xs text-sm">{error}</p>
          </div>
        ) : !timelineData ? (
          <p className="text-sm text-muted-foreground">אין נתונים להצגה ליום זה</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              {/* Timeline Grid */}
              <div className="relative">
                {/* Time Header */}
                <div className="flex border-b-2 border-border mb-2 pb-2">
                  <div className="w-32 flex-shrink-0 pl-4 font-semibold text-sm text-right">
                    מדריך
                  </div>
                  <div className="flex-1 flex">
                    {timelineData.hours.map(hour => (
                      <div
                        key={hour}
                        className="flex-shrink-0 w-[120px] text-center text-sm font-medium text-muted-foreground border-l border-border"
                      >
                        {hour}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Instructor Rows */}
                <div className="space-y-1">
                  {timelineData.instructors.map(instructor => (
                    <div
                      key={instructor.id}
                      className="flex items-start border-b border-border py-1 hover:bg-muted/30 transition-colors"
                      dir="rtl"
                    >
                      {/* Instructor Name */}
                      <div className="w-32 flex-shrink-0 pl-4 py-1 text-right">
                        <div className="font-medium text-xs truncate">
                          {instructor.name}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {instructor.sessions.length} שיעורים
                        </div>
                      </div>

                      {/* Timeline Lane */}
                      <div className="flex-1 relative overflow-hidden" style={{ minHeight: '60px' }}>
                        {/* Hour Grid Lines */}
                        <div className="absolute inset-0 flex">
                          {timelineData.hours.map(hour => (
                            <div
                              key={hour}
                              className="flex-shrink-0 w-[120px] border-l border-border/50"
                            />
                          ))}
                        </div>

                        {/* Sessions */}
                        {instructor.sessions.map((session, idx) => {
                          // Calculate smart stack position
                          const stackRow = calculateStackPosition(instructor.sessions, idx)
                          session._stackRow = stackRow // Store for overlap detection
                          
                          const left = calculatePosition(session.timeMinutes, timelineData.minHour)
                          const width = 60 // 30 minutes = 60px (120px per hour = 1 hour)
                          const top = stackRow * 36 // 36px per row for proper spacing
                          const timeLabel = session.time || `${String(Math.floor(session.timeMinutes / 60)).padStart(2, '0')}:${String(session.timeMinutes % 60).padStart(2, '0')}`

                          return (
                            <button
                              key={session.id}
                              onClick={() => navigate(`/students/${session.studentId}`)}
                              className={`absolute rounded-md border-2 px-2 py-2 text-xs font-semibold shadow-sm hover:shadow-lg transition-all cursor-pointer ${getStatusColor(session)}`}
                              style={{
                                left: `${left}px`,
                                width: `${width}px`,
                                top: `${top}px`,
                                zIndex: 10
                              }}
                              title={`${session.studentName} - ${timeLabel}`}
                              dir="rtl"
                            >
                              <div className="flex items-center gap-1 truncate">
                                <span className="text-sm">{getStatusIcon(session)}</span>
                                <span className="truncate">{session.studentName}</span>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {timelineData.instructors.length === 0 && (
                  <div className="text-center py-xl text-muted-foreground">
                    אין שיעורים מתוכננים ליום זה
                  </div>
                )}
              </div>

              {/* Legend */}
              <div className="mt-md flex items-center justify-center gap-4 text-xs border-t pt-md">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-green-100 dark:bg-green-950 border-2 border-green-400"></div>
                  <span>✓ מתועד</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-red-100 dark:bg-red-950 border-2 border-red-400"></div>
                  <span>✗ חסר תיעוד</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-muted border-2 border-muted-foreground/30"></div>
                  <span>⚠ קרוב</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
