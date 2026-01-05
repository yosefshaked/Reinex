import React, { useEffect, useMemo, useState } from 'react'
import { fetchLessonInstances } from '@/features/scheduling/api/lesson-instances.js'
import Card from '@/components/ui/CustomCard.jsx'
import { Button } from '@/components/ui/button'

function formatDateInputValue(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatTime(isoString) {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
}

function buildStudentDisplayName(student) {
  if (!student) return ''
  const tokens = [student.first_name, student.middle_name, student.last_name].filter(Boolean)
  return tokens.join(' ').trim()
}

function statusDotClass({ status, documentationStatus }) {
  if (status === 'completed') return 'bg-success'
  if (status === 'no_show') return 'bg-error'
  if (status.startsWith('cancelled')) return 'bg-muted'
  if (documentationStatus === 'undocumented') return 'bg-foreground'
  return 'bg-warning'
}

export default function DayScheduleView({ orgId }) {
  const [date, setDate] = useState(() => formatDateInputValue(new Date()))
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [rows, setRows] = useState([])

  useEffect(() => {
    let cancelled = false

    async function run() {
      if (!orgId || !date) {
        setRows([])
        return
      }

      setStatus('loading')
      setError(null)

      try {
        const payload = await fetchLessonInstances({ orgId, date })
        if (cancelled) return
        setRows(Array.isArray(payload) ? payload : [])
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setStatus('error')
        setError(err?.data?.message || err?.message || 'שגיאה בטעינת היומן')
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [orgId, date])

  const grouped = useMemo(() => {
    const map = new Map()
    for (const item of rows) {
      const instructor = item?.instructor ?? null
      const instructorId = item?.instructor_employee_id || instructor?.id || 'unknown'
      const instructorName = instructor?.name || 'עובד'
      const existing = map.get(instructorId) || { instructorId, instructorName, items: [] }
      existing.items.push(item)
      map.set(instructorId, existing)
    }

    return Array.from(map.values()).sort((a, b) => a.instructorName.localeCompare(b.instructorName, 'he'))
  }, [rows])

  return (
    <div className="space-y-md" dir="rtl">
      <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
        <div className="flex flex-col gap-sm sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium text-foreground">תאריך</div>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="h-10 rounded-lg border border-input bg-surface px-3 text-sm text-foreground"
            />
          </div>
          <div className="flex items-center gap-sm">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDate(formatDateInputValue(new Date()))}
              className="h-10"
            >
              היום
            </Button>
          </div>
        </div>
      </Card>

      {status === 'loading' && (
        <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
          <p className="text-sm text-muted-foreground">טוען יומן...</p>
        </Card>
      )}

      {status === 'error' && (
        <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
          <p className="text-sm text-error">{error}</p>
        </Card>
      )}

      {status === 'ready' && grouped.length === 0 && (
        <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
          <p className="text-sm text-muted-foreground">אין שיעורים בתאריך שנבחר.</p>
        </Card>
      )}

      {status === 'ready' && grouped.length > 0 && (
        <div className="grid gap-md lg:grid-cols-2">
          {grouped.map((group) => (
            <Card
              key={group.instructorId}
              className="rounded-2xl border border-border bg-surface p-lg shadow-sm"
            >
              <div className="mb-sm flex items-center justify-between gap-sm">
                <div className="text-base font-semibold text-foreground truncate">{group.instructorName}</div>
                <div className="text-xs text-muted-foreground">{group.items.length} שיעורים</div>
              </div>

              <div className="space-y-sm">
                {group.items
                  .slice()
                  .sort((a, b) => new Date(a.datetime_start).getTime() - new Date(b.datetime_start).getTime())
                  .map((item) => {
                    const serviceName = item?.service?.name || 'שירות'
                    const participants = Array.isArray(item?.participants) ? item.participants : []
                    const studentNames = participants
                      .map((p) => buildStudentDisplayName(p?.student))
                      .filter(Boolean)

                    const dot = statusDotClass({
                      status: item?.status || '',
                      documentationStatus: item?.documentation_status || item?.documentationStatus || '',
                    })

                    return (
                      <div
                        key={item.id}
                        className="flex items-start gap-sm rounded-xl border border-border bg-card px-md py-sm"
                      >
                        <div className={`mt-1 h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-sm">
                            <div className="text-sm font-medium text-foreground">
                              {formatTime(item.datetime_start)} · {serviceName}
                            </div>
                            <div className="text-xs text-muted-foreground">{item.duration_minutes} דק׳</div>
                          </div>
                          {studentNames.length > 0 ? (
                            <div className="mt-1 text-sm text-muted-foreground truncate">
                              {studentNames.join(' · ')}
                            </div>
                          ) : (
                            <div className="mt-1 text-sm text-muted-foreground">ללא משתתפים</div>
                          )}
                        </div>
                      </div>
                    )
                  })}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
