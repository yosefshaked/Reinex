import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { format, startOfWeek, addDays } from 'date-fns'
import { he } from 'date-fns/locale'
import { useNavigate } from 'react-router-dom'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fetchWeeklyComplianceView } from '@/api/weekly-compliance'
import { fetchDailyCompliance } from '@/api/daily-compliance.js'
import { useIsMobile } from '@/hooks/use-mobile.jsx'
import { useOrg } from '@/org/OrgContext.jsx'
import { useInstructors } from '@/hooks/useOrgData.js'
import { isAdminRole, normalizeMembershipRole } from '@/features/students/utils/endpoints.js'
import SessionCardList from './SessionCardList.jsx'
import { SessionListDrawer } from './SessionListDrawer'
import NewSessionModal from '@/features/sessions/components/NewSessionModal'

function formatFullHebrewDate(isoDate) {
  if (!isoDate) {
    return ''
  }
  try {
    const formatter = new Intl.DateTimeFormat('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    return formatter.format(new Date(`${isoDate}T00:00:00Z`))
  } catch {
    return isoDate
  }
}

function buildDetailSummary(summary) {
  if (!summary || !summary.totalSessions) {
    return ''
  }
  const documented = summary.documentedSessions || 0
  return `${documented} תלמידים מתוך ${summary.totalSessions} מפגשים מתועדים`
}

export function ComplianceHeatmap() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const { activeOrg } = useOrg()
  const [data, setData] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedCell, setSelectedCell] = useState(null)
  const [viewMode, setViewMode] = useState('heatmap')
  const [detailedDayData, setDetailedDayData] = useState(null)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(null)
  const [detailRequestDate, setDetailRequestDate] = useState(null)
  const [currentWeekStart, setCurrentWeekStart] = useState(() =>
    startOfWeek(new Date(), { locale: he, weekStartsOn: 0 })
  )
  const [mobileSelectedDate, setMobileSelectedDate] = useState(() =>
    format(new Date(), 'yyyy-MM-dd')
  )
  const [detailQuickDoc, setDetailQuickDoc] = useState(null)
  const [selectedInstructorId, setSelectedInstructorId] = useState('all')

  // Check if user is admin/owner
  // Membership role can come from the nested membership object or legacy shape on activeOrg
  const membershipRole =
    activeOrg?.membership?.role ??
    activeOrg?.membership_role ??
    activeOrg?.role ??
    null
  const normalizedRole = useMemo(() => normalizeMembershipRole(membershipRole), [membershipRole])
  const isAdmin = isAdminRole(normalizedRole)

  // Fetch instructors list for admin users
  const { instructors, loadingInstructors } = useInstructors({
    enabled: Boolean(isAdmin && activeOrg?.id),
  })

  // Map instructors list to ensure it's always an array
  const normalizedInstructors = useMemo(() => {
    if (!instructors) return []
    if (Array.isArray(instructors)) return instructors
    if (Array.isArray(instructors?.instructors)) return instructors.instructors
    if (Array.isArray(instructors?.data)) return instructors.data
    return []
  }, [instructors])

  // Normalize a session object to its hour slot string (HH:00)
  const getHourSlot = useCallback((session) => {
    if (!session) return null
    const t = session.time
    if (typeof t === 'string' && /^\d{2}:\d{2}/.test(t)) {
      return `${t.slice(0, 2)}:00`
    }
    const m = Number(session.timeMinutes)
    if (Number.isFinite(m)) {
      const h = Math.floor(m / 60)
      return `${String(h).padStart(2, '0')}:00`
    }
    return null
  }, [])

  // Rebuild the selected cell from fresh data so the drawer reflects current status
  const rebuildSelectedCell = useCallback((days, targetDate, targetTimeSlot) => {
    if (!days || !targetDate || !targetTimeSlot) return null
    const day = days.find(d => d?.date === targetDate)
    if (!day) return null
    const sessionsInSlot = day.sessions?.filter(s => getHourSlot(s) === targetTimeSlot) || []
    const total = sessionsInSlot.length
    const documented = sessionsInSlot.filter(s => s.status === 'complete').length
    const upcoming = sessionsInSlot.filter(s => s.status === 'upcoming').length
    const missing = sessionsInSlot.filter(s => s.status === 'missing').length

    return {
      date: targetDate,
      timeSlot: targetTimeSlot,
      total,
      documented,
      upcoming,
      missing,
      sessions: sessionsInSlot,
      complianceRate: total - upcoming > 0 ? (documented / (total - upcoming)) * 100 : null,
    }
  }, [getHourSlot])

  useEffect(() => {
    const now = new Date()
    const actualWeekStart = startOfWeek(now, { locale: he, weekStartsOn: 0 })
    setCurrentWeekStart(prev =>
      prev?.getTime?.() === actualWeekStart.getTime() ? prev : actualWeekStart
    )
    setMobileSelectedDate(format(now, 'yyyy-MM-dd'))
  }, [])

  const detailDateLabel = useMemo(() => {
    return formatFullHebrewDate(detailedDayData?.date || detailRequestDate)
  }, [detailedDayData, detailRequestDate])

  useEffect(() => {
    ;(async () => {
      setIsLoading(true)
      setError(null)
      try {
        const result = await fetchWeeklyComplianceView({
          orgId: activeOrg?.id,
          weekStart: format(currentWeekStart, 'yyyy-MM-dd'),
          instructorId: selectedInstructorId === 'all' ? undefined : selectedInstructorId,
        })
        setData(result)
      } catch (err) {
        console.error('Failed to load compliance data:', err)
        setError(err.message)
      } finally {
        setIsLoading(false)
      }
    })()
  }, [activeOrg?.id, currentWeekStart, selectedInstructorId])

  // Separate effect: rebuild selected cell when data changes (but drawer is still open)
  useEffect(() => {
    if (selectedCell && data?.days && selectedCell.date && selectedCell.timeSlot) {
      const refreshed = rebuildSelectedCell(data.days, selectedCell.date, selectedCell.timeSlot)
      if (refreshed && JSON.stringify(refreshed) !== JSON.stringify(selectedCell)) {
        setSelectedCell(refreshed)
      }
    }
  }, [data, selectedCell, rebuildSelectedCell])

  useEffect(() => {
    if (!isMobile) {
      return
    }
    const targetDate = mobileSelectedDate
      ? new Date(`${mobileSelectedDate}T00:00:00`)
      : new Date()
    const desiredWeekStart = startOfWeek(targetDate, { locale: he, weekStartsOn: 0 })
    if (desiredWeekStart.getTime() !== currentWeekStart.getTime()) {
      setCurrentWeekStart(desiredWeekStart)
    }
  }, [isMobile, mobileSelectedDate, currentWeekStart])

  useEffect(() => {
    if (isMobile) {
      return
    }
    setMobileSelectedDate(format(currentWeekStart, 'yyyy-MM-dd'))
  }, [isMobile, currentWeekStart])

  const displayedDays = useMemo(() => {
    if (!data?.days) {
      return []
    }
    if (!isMobile) {
      return data.days
    }
    if (!mobileSelectedDate) {
      return []
    }
    const match = data.days.find(day => day.date === mobileSelectedDate)
    return match ? [match] : []
  }, [data, isMobile, mobileSelectedDate])

  const heatmapData = useMemo(() => {
    if (!data?.days) return null

    const allTimeSlots = new Set()
    const getHourString = (s) => {
      if (!s) return null
      const t = s.time
      if (typeof t === 'string' && /^\d{2}:\d{2}/.test(t)) {
        return `${t.slice(0, 2)}:00`
      }
      const m = Number(s.timeMinutes)
      if (Number.isFinite(m)) {
        const h = Math.floor(m / 60)
        return `${String(h).padStart(2, '0')}:00`
      }
      return null
    }
    data.days.forEach(day => {
      day.sessions.forEach(session => {
        const hourSlot = getHourString(session)
        if (hourSlot) allTimeSlots.add(hourSlot)
      })
    })

    const sortedSlots = Array.from(allTimeSlots).sort()

    const grid = sortedSlots.map(timeSlot => {
      const row = { timeSlot, days: [] }

      data.days.forEach(day => {
        const sessionsInSlot = day.sessions.filter(s => {
          const hourSlot = getHourString(s)
          return hourSlot === timeSlot
        })

        const total = sessionsInSlot.length
        const documented = sessionsInSlot.filter(s => s.status === 'complete').length
        const upcoming = sessionsInSlot.filter(s => s.status === 'upcoming').length
        const missing = sessionsInSlot.filter(s => s.status === 'missing').length

        row.days.push({
          date: day.date,
          total,
          documented,
          upcoming,
          missing,
          sessions: sessionsInSlot,
          complianceRate: total - upcoming > 0 ? (documented / (total - upcoming)) * 100 : null
        })
      })

      return row
    })

    return { grid, sortedSlots }
  }, [data])

  function getStripeColor(complianceRate, total) {
    if (total === 0 || complianceRate === null || isNaN(complianceRate)) {
      return '#E5E7EB'
    }
    if (complianceRate === 100) return '#22C55E'
    if (complianceRate >= 76) return '#FACC15'
    return '#F97316'
  }

  function handleCellClick(timeSlot, dayData) {
    if (dayData.total === 0) return
    setSelectedCell({ timeSlot, ...dayData })
  }

  const loadDetailDay = useCallback(async (date, { preserveView = false, keepData = false } = {}) => {
    if (!date || !activeOrg?.id) {
      return
    }
    if (!keepData) {
      setDetailedDayData(null)
    }
    setViewMode(prev => (preserveView ? prev : 'day-detail'))
    setDetailRequestDate(date)
    setDetailError(null)
    setIsDetailLoading(true)
    try {
      const result = await fetchDailyCompliance({ orgId: activeOrg?.id, date })
      setDetailedDayData(result)
    } catch (detailErr) {
      console.error('Failed to load detailed day view:', detailErr)
      setDetailError(detailErr?.message || 'אירעה שגיאה בעת טעינת נתוני היום.')
    } finally {
      setIsDetailLoading(false)
    }
  }, [activeOrg?.id])

  function handleShowDetailedDay(date) {
    loadDetailDay(date)
  }

  function handleBackToHeatmap() {
    setViewMode('heatmap')
    setDetailError(null)
    setDetailedDayData(null)
    setDetailRequestDate(null)
  }

  function navigateWeek(direction) {
    setCurrentWeekStart(prev => addDays(prev, direction === 'next' ? 7 : -7))
  }

  function handleDetailViewStudent(session) {
    if (!session?.studentId) {
      return
    }
    navigate(`/students/${session.studentId}`)
  }

  function handleDetailDocumentNow(session) {
    if (!session?.studentId) {
      return
    }
    setDetailQuickDoc({ studentId: session.studentId, date: detailedDayData?.date || detailRequestDate })
  }

  const handleDrawerSessionCreated = useCallback(async () => {
    // Refetch the heatmap data when a session is created through the drawer
    if (!activeOrg?.id) return
    setIsLoading(true)
    setError(null)
    try {
      const result = await fetchWeeklyComplianceView({
        orgId: activeOrg?.id,
        weekStart: format(currentWeekStart, 'yyyy-MM-dd'),
      })
      setData(result)

      // If drawer is open, refresh its cell data from the new payload
      if (selectedCell && result?.days) {
        const refreshed = rebuildSelectedCell(result.days, selectedCell.date, selectedCell.timeSlot)
        setSelectedCell(refreshed)
      }
    } catch (err) {
      console.error('Failed to refresh compliance data:', err)
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }, [activeOrg?.id, currentWeekStart, selectedCell, rebuildSelectedCell])

  function handleDetailDocCreated() {
    // Modal now stays open with success state - refresh data but don't close modal
    if (detailRequestDate) {
      loadDetailDay(detailRequestDate, { preserveView: true, keepData: true })
    }
  }

  return (
    <Card className="w-full">
      <div className="p-lg space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-foreground">מעקב מצב התיעודים</h2>
            <p className="mt-xs text-sm text-muted-foreground">
              מעקב אחר מילוי תיעוד שיעורים לפי שעות
            </p>
          </div>
          {viewMode === 'heatmap' ? (
            isMobile ? (
              <div className="flex flex-col gap-3 w-full max-w-xs text-right">
                <div>
                  <label htmlFor="heatmap-date-picker" className="mb-2 block text-sm font-medium text-foreground">
                    בחר יום להצגה
                  </label>
                  <Input
                    id="heatmap-date-picker"
                    type="date"
                    value={mobileSelectedDate}
                    onChange={event => setMobileSelectedDate(event.target.value || format(new Date(), 'yyyy-MM-dd'))}
                  />
                </div>
                {isAdmin && (loadingInstructors || normalizedInstructors) && (
                  <div dir="rtl">
                    <label htmlFor="instructor-filter" className="mb-2 block text-sm font-medium text-foreground">
                      סינון לפי מדריך
                    </label>
                    <Select value={selectedInstructorId} onValueChange={setSelectedInstructorId} disabled={loadingInstructors}>
                      <SelectTrigger id="instructor-filter">
                        <SelectValue placeholder="בחר מדריך" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">כל המדריכים</SelectItem>
                        {normalizedInstructors
                          ?.filter(instructor => instructor.is_active !== false)
                          .map(instructor => (
                            <SelectItem key={instructor.id} value={instructor.id}>
                              {instructor.name || instructor.email || instructor.id}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigateWeek('prev')}
                >
                  ‹ שבוע קודם
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentWeekStart(startOfWeek(new Date(), { locale: he, weekStartsOn: 0 }))}
                >
                  השבוע
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigateWeek('next')}
                >
                  שבוע הבא ›
                </Button>
              </div>
            )
          ) : null}
          {viewMode === 'heatmap' && isAdmin && !isMobile && (loadingInstructors || normalizedInstructors) && (
            <div className="w-48" dir="rtl">
              <Select value={selectedInstructorId} onValueChange={setSelectedInstructorId} disabled={loadingInstructors}>
                <SelectTrigger>
                  <SelectValue placeholder="בחר מדריך" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל המדריכים</SelectItem>
                  {normalizedInstructors
                    ?.filter(instructor => instructor.is_active !== false)
                    .map(instructor => (
                      <SelectItem key={instructor.id} value={instructor.id}>
                        {instructor.name || instructor.email || instructor.id}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {viewMode === 'heatmap' ? (
          isLoading ? (
            <div className="flex justify-center py-xl">
              <span className="text-sm text-muted-foreground">טוען נתוני תיעוד...</span>
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-lg text-destructive">
              <p className="text-base font-semibold">אירעה שגיאה בטעינת הנתונים.</p>
              <p className="mt-xs text-sm">{error}</p>
            </div>
          ) : !heatmapData ? (
            <p className="text-sm text-muted-foreground">אין נתונים להצגה</p>
          ) : isMobile && displayedDays.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין נתונים עבור היום שנבחר. נסו לבחור תאריך אחר.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b-2 border-border">
                      <th className="sticky right-0 bg-surface px-4 py-3 text-right font-semibold text-sm">
                        שעה
                      </th>
                      {displayedDays.map(day => {
                        const dateObj = new Date(day.date)
                        const dayName = format(dateObj, 'EEEE', { locale: he })
                        const shortDate = format(dateObj, 'dd.MM', { locale: he })
                        return (
                          <th key={day.date} className="px-3 py-3 text-center border-r border-border min-w-[150px]">
                            <div className="flex flex-col gap-2">
                              <div className="font-semibold text-base">{dayName}</div>
                              <div className="text-xs text-muted-foreground">{shortDate}</div>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 text-xs mt-1 bg-primary/5 hover:bg-primary/10 border-primary/30 hover:border-primary/50 font-semibold"
                                onClick={() => handleShowDetailedDay(day.date)}
                              >
                                📊 תצוגה מפורטת
                              </Button>
                            </div>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {heatmapData.grid.map((row, idx) => (
                      <tr key={row.timeSlot} className={idx % 2 === 0 ? 'bg-muted/20' : ''}>
                        <td className="sticky right-0 bg-surface px-4 py-3 text-right font-medium text-sm border-b border-border">
                          {row.timeSlot}
                        </td>
                        {displayedDays.map(day => {
                          const dayCell = row.days.find(cell => cell.date === day.date)
                          if (!dayCell || dayCell.total === 0) {
                            return (
                              <td key={`${row.timeSlot}-${day.date}`} className="px-3 py-3 text-center border-r border-b border-border">
                                <div className="text-muted-foreground text-sm py-4">-</div>
                              </td>
                            )
                          }
                          return (
                            <td
                              key={`${row.timeSlot}-${day.date}`}
                              className="px-3 py-3 text-center border-r border-b border-border"
                            >
                              <button
                                onClick={() => handleCellClick(row.timeSlot, dayCell)}
                                className="relative w-full rounded-lg border-2 p-4 transition-all hover:scale-105 hover:shadow-lg cursor-pointer bg-card text-foreground"
                              >
                                <div
                                  className="absolute right-0 top-0 bottom-0 w-1.5 rounded-r-lg"
                                  style={{ backgroundColor: getStripeColor(dayCell.complianceRate, dayCell.total) }}
                                  aria-hidden
                                />
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center justify-center gap-2 text-xs font-semibold leading-tight opacity-90">
                                    {dayCell.documented > 0 && (
                                      <span>
                                        ✓×{dayCell.documented}
                                      </span>
                                    )}
                                    {dayCell.missing > 0 && (
                                      <span>
                                        ✗×{dayCell.missing}
                                      </span>
                                    )}
                                    {dayCell.upcoming > 0 && (
                                      <span>
                                        ⚠×{dayCell.upcoming}
                                      </span>
                                    )}
                                  </div>
                                  <div className="font-bold text-base leading-tight">
                                    {dayCell.documented}/{dayCell.total}
                                  </div>
                                  {dayCell.complianceRate !== null && !isNaN(dayCell.complianceRate) && (
                                    <div className="text-sm font-bold leading-tight">
                                      {Math.round(dayCell.complianceRate)}%
                                    </div>
                                  )}
                                </div>
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/30">
                      <td className="sticky right-0 bg-muted/30 px-4 py-3 text-right font-semibold text-sm">
                        סה"כ יומי
                      </td>
                      {displayedDays.map(day => {
                        const totalSessions = day.sessions.length
                        const documented = day.sessions.filter(s => s.status === 'complete').length
                        const upcoming = day.sessions.filter(s => s.status === 'upcoming').length
                        const rate = totalSessions - upcoming > 0
                          ? Math.round((documented / (totalSessions - upcoming)) * 100)
                          : null

                        return (
                          <td key={day.date} className="px-4 py-3 text-center border-r border-border font-semibold text-sm">
                            <div className="flex flex-col gap-1">
                              <div>{documented}/{totalSessions}</div>
                              {rate !== null && <div className="text-xs">{rate}%</div>}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="mt-md flex flex-wrap items-center justify-center gap-6 text-xs font-medium">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-[#22C55E] border border-[#22C55E]"></div>
                  <span>100% תיעודים הושלמו</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-[#FACC15] border border-[#FACC15]"></div>
                  <span>76-99% נדרש להשלים</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-[#F97316] border border-[#F97316]"></div>
                  <span>0-75% דורש טיפול</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-[#E5E7EB] border border-gray-300"></div>
                  <span>ללא שיעורים/טרם התרחש</span>
                </div>
              </div>
            </>
          )
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 text-right md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm text-muted-foreground">תצוגת יום מפורטת</p>
                <h3 className="text-2xl font-bold text-foreground">{detailDateLabel || '—'}</h3>
                {buildDetailSummary(detailedDayData?.summary) ? (
                  <p className="text-sm text-muted-foreground">{buildDetailSummary(detailedDayData?.summary)}</p>
                ) : null}
              </div>
              <Button variant="outline" size="sm" onClick={handleBackToHeatmap}>
                ← חזרה לתצוגת שבוע
              </Button>
            </div>
            {isDetailLoading ? (
              <div className="text-center text-sm text-muted-foreground" role="status">
                טוען נתוני יום מפורט{detailDateLabel ? ` (${detailDateLabel})` : ''}...
              </div>
            ) : detailError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                {detailError}
              </div>
            ) : detailedDayData ? (
              <SessionCardList
                sessions={detailedDayData.sessions}
                timeSlots={detailedDayData.timeSlots}
                onOpenStudent={handleDetailViewStudent}
                onDocumentNow={handleDetailDocumentNow}
                emptyMessage="אין שיעורים מתוכננים ליום זה."
              />
            ) : (
              <p className="text-sm text-muted-foreground">בחרו יום להצגה מפורטת.</p>
            )}
          </div>
        )}
      </div>

      {selectedCell && (
        <SessionListDrawer
          isOpen={!!selectedCell}
          onClose={() => setSelectedCell(null)}
          cellData={selectedCell}
          orgId={activeOrg?.id}
          onSessionCreated={handleDrawerSessionCreated}
        />
      )}

      {detailQuickDoc && (
        <NewSessionModal
          open={!!detailQuickDoc}
          onClose={() => {
            setDetailQuickDoc(null)
            // Refresh data one final time when modal closes
            if (detailRequestDate) {
              loadDetailDay(detailRequestDate, { preserveView: true, keepData: false })
            }
          }}
          initialStudentId={detailQuickDoc.studentId}
          initialDate={detailQuickDoc.date}
          onCreated={handleDetailDocCreated}
        />
      )}
    </Card>
  )
}
