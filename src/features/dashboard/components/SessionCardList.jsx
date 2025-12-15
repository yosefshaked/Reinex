import React, { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { normalizeColorIdentifier } from './color-utils.js'

const STATUS_META = Object.freeze({
  complete: {
    icon: '✓',
    label: 'מתועד',
    text: 'מתועד',
    className: 'text-green-600 dark:text-green-400',
  },
  missing: {
    icon: '✗',
    label: 'חסר תיעוד',
    text: 'חסר תיעוד',
    className: 'text-red-600 dark:text-red-400',
  },
  upcoming: {
    icon: '⚠',
    label: 'קרוב',
    text: 'קרוב',
    className: 'text-muted-foreground',
  },
})

function toMinutes(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (!value) {
    return null
  }
  const match = String(value).trim().match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) {
    return null
  }
  const hours = Number.parseInt(match[1], 10)
  const minutes = Number.parseInt(match[2], 10)
  const seconds = match[3] ? Number.parseInt(match[3], 10) : 0
  if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds)) {
    return null
  }
  return hours * 60 + minutes + Math.floor(seconds / 60)
}

function formatTimeLabel(minutes) {
  if (!Number.isFinite(minutes)) {
    return ''
  }
  const hoursPart = Math.floor(minutes / 60)
  const minutesPart = minutes % 60
  return `${String(hoursPart).padStart(2, '0')}:${String(minutesPart).padStart(2, '0')}`
}

function normalizeSlots({ sessions, timeSlots }) {
  const fallbackSessions = Array.isArray(sessions) ? sessions : []
  const slots = Array.isArray(timeSlots) ? timeSlots : []

  if (slots.length) {
    return slots
      .map(slot => {
        const timeMinutes = typeof slot.timeMinutes === 'number' ? slot.timeMinutes : toMinutes(slot.time)
        const timeLabel = slot.time || formatTimeLabel(timeMinutes)
        return {
          timeMinutes,
          timeLabel,
          sessions: Array.isArray(slot.students) ? slot.students : [],
        }
      })
      .filter(slot => slot.sessions.length)
      .sort((a, b) => (a.timeMinutes ?? 0) - (b.timeMinutes ?? 0))
  }

  const grouped = new Map()
  for (const session of fallbackSessions) {
    const timeMinutes = typeof session?.timeMinutes === 'number' ? session.timeMinutes : toMinutes(session?.time)
    const timeLabel = session?.time || formatTimeLabel(timeMinutes)
    const key = Number.isFinite(timeMinutes) ? timeMinutes : timeLabel
    if (!grouped.has(key)) {
      grouped.set(key, { timeMinutes, timeLabel, sessions: [] })
    }
    grouped.get(key).sessions.push(session)
  }

  return Array.from(grouped.values()).sort((a, b) => (a.timeMinutes ?? 0) - (b.timeMinutes ?? 0))
}

function buildBarStyle(identifier) {
  const colors = normalizeColorIdentifier(identifier)
  if (!colors.length) {
    return { background: '#6B7280' }
  }
  if (colors.length === 1) {
    return { background: colors[0] }
  }
  return { background: `linear-gradient(135deg, ${colors.join(', ')})` }
}

export default function SessionCardList({
  sessions,
  timeSlots,
  onOpenStudent,
  onDocumentNow,
  emptyMessage = 'אין שיעורים מתוכננים ליום זה.',
  className = '',
}) {
  const normalizedSlots = useMemo(() => normalizeSlots({ sessions, timeSlots }), [sessions, timeSlots])

  if (!normalizedSlots.length) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>
  }

  return (
    <div className={cn('space-y-6', className)} dir="rtl">
      {normalizedSlots.map(slot => (
        <section key={`${slot.timeLabel}-${slot.timeMinutes ?? 'na'}`} className="space-y-3">
          <h3 className="sticky top-0 bg-background py-2 text-sm font-semibold text-muted-foreground">
            {slot.timeLabel || '—'}
          </h3>
          <div className="space-y-3">
            {slot.sessions.map(session => {
              const status = STATUS_META[session?.status] || STATUS_META.upcoming
              const barStyle = buildBarStyle(session?.instructorColor)
              const canOpenStudent = typeof onOpenStudent === 'function'
              const canDocument = typeof onDocumentNow === 'function' && session?.status === 'missing'

              return (
                <article
                  key={`${slot.timeLabel}-${session?.studentId}-${session?.id || ''}`}
                  className="relative flex flex-col gap-4 rounded-lg border-2 border-border bg-card p-4 text-foreground shadow-sm transition-all hover:bg-muted/50 hover:shadow-md sm:flex-row sm:items-center"
                  dir="rtl"
                >
                  {session?.instructorColor && (
                    <div className="absolute right-0 top-0 bottom-0 w-1.5 rounded-r-lg" style={barStyle} aria-hidden />
                  )}
                  <div className="flex-1 min-w-0 pr-3 text-right">
                    <p className="text-base font-semibold truncate">{session?.studentName || '—'}</p>
                    <div className="mt-1 flex items-center justify-between gap-3 text-sm text-muted-foreground sm:justify-start">
                      <div className="flex min-h-[1.5rem] min-w-0 items-center gap-2">
                        {session?.instructorColor && (
                          <span
                            className="inline-flex h-3 w-3 flex-shrink-0 rounded-full border border-border shadow-sm"
                            style={barStyle}
                            aria-hidden
                          />
                        )}
                        {session?.instructorName && <span className="truncate">{session?.instructorName}</span>}
                      </div>
                      <div
                        className={cn(
                          'text-2xl font-semibold flex flex-shrink-0 items-center justify-center text-left sm:hidden',
                          status.className,
                        )}
                        aria-label={status.label}
                        dir="ltr"
                      >
                        {status.icon}
                      </div>
                    </div>
                    <p className={cn('mt-1 text-xs font-medium', status.className)}>{status.text}</p>
                  </div>
                  <div
                    className={cn(
                      'text-2xl font-semibold hidden w-full justify-start sm:flex sm:w-auto sm:justify-center',
                      status.className,
                    )}
                    aria-label={status.label}
                    dir="ltr"
                  >
                    {status.icon}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!canOpenStudent}
                      onClick={() => canOpenStudent && onOpenStudent(session)}
                    >
                      פתח
                    </Button>
                    {canDocument && (
                      <Button type="button" size="sm" onClick={() => onDocumentNow(session)}>
                        תעד עכשיו
                      </Button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
