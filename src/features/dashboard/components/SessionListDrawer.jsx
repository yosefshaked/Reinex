import React from 'react'
import { format } from 'date-fns'
import { he } from 'date-fns/locale'
import { useNavigate } from 'react-router-dom'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import SessionCardList from './SessionCardList.jsx'

// NOTE: this heatmap's "quick documentation" affordance predates the
// anchored report model (Session Reports Phase 3). NewSessionModal now
// requires an anchored lessonParticipantId and no longer accepts loose
// student/date fill (see implementations/session-reports/
// implementation-plan.md, Decision #4). This drawer only carries a
// studentId/date pair, not a lesson_participant_id, so it cannot supply a
// valid anchor today. Rewiring this heatmap to real lesson/participant data
// is Phase 5 scope ("pending reports" redefinition) — until then the
// "document now" trigger is disabled here rather than mounting a modal that
// could never resolve a report to fill.

export function SessionListDrawer({ isOpen, onClose, cellData, orgId, onSessionCreated }) {
  const navigate = useNavigate()
  // Intentionally unused for now; keep in signature for future enhancements
  void orgId
  void onSessionCreated

  if (!cellData) return null

  const dateObj = new Date(cellData.date)
  const dayName = format(dateObj, 'EEEE', { locale: he })
  const fullDate = format(dateObj, 'dd.MM.yyyy', { locale: he })

  function handleViewStudent(studentId) {
    navigate(`/students/${studentId}`)
    onClose()
  }

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="left" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-end">
            {dayName} {fullDate} | {cellData.timeSlot}
          </SheetTitle>
          <SheetDescription className="text-end">
            {cellData.documented} מתועדים מתוך {cellData.total} שיעורים
            {cellData.upcoming > 0 && ` (${cellData.upcoming} קרובים)`}
          </SheetDescription>
        </SheetHeader>

        <div className="h-[calc(100vh-180px)] mt-6 overflow-y-auto pe-4">
          <SessionCardList
            sessions={cellData.sessions}
            onOpenStudent={session => handleViewStudent(session.studentId)}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
