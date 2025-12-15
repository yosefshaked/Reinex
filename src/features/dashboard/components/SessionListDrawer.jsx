import React, { useState } from 'react'
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
import NewSessionModal from '@/features/sessions/components/NewSessionModal'
import SessionCardList from './SessionCardList.jsx'

export function SessionListDrawer({ isOpen, onClose, cellData, orgId, onSessionCreated }) {
  const navigate = useNavigate()
  const [quickDocModal, setQuickDocModal] = useState(null) // { studentId, date }
  // Intentionally unused for now; keep in signature for future enhancements
  void orgId

  if (!cellData) return null

  const dateObj = new Date(cellData.date)
  const dayName = format(dateObj, 'EEEE', { locale: he })
  const fullDate = format(dateObj, 'dd.MM.yyyy', { locale: he })

  function handleDocumentNow(studentId, date) {
    setQuickDocModal({ studentId, date })
  }

  function handleQuickDocComplete() {
    // Modal now stays open with success state - no need to close it here
    // Data refresh will happen when user finally closes the modal
    // Trigger parent heatmap refresh to show updated compliance data
    if (onSessionCreated) {
      onSessionCreated()
    }
  }

  function handleViewStudent(studentId) {
    navigate(`/students/${studentId}`)
    onClose()
  }

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="left" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-right">
            {dayName} {fullDate} | {cellData.timeSlot}
          </SheetTitle>
          <SheetDescription className="text-right">
            {cellData.documented} מתועדים מתוך {cellData.total} שיעורים
            {cellData.upcoming > 0 && ` (${cellData.upcoming} קרובים)`}
          </SheetDescription>
        </SheetHeader>

        <div className="h-[calc(100vh-180px)] mt-6 overflow-y-auto pr-4">
          <SessionCardList
            sessions={cellData.sessions}
            onOpenStudent={session => handleViewStudent(session.studentId)}
            onDocumentNow={session => handleDocumentNow(session.studentId, cellData.date)}
          />
        </div>
      </SheetContent>

      {/* Quick Documentation Modal */}
      {quickDocModal && (
        <NewSessionModal
          open={!!quickDocModal}
          onClose={() => {
            setQuickDocModal(null)
            // Don't close the drawer - let it stay open after modal closes
          }}
          initialStudentId={quickDocModal.studentId}
          initialDate={quickDocModal.date}
          onCreated={handleQuickDocComplete}
        />
      )}
    </Sheet>
  )
}
