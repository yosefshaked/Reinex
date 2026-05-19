import React, { useRef, useCallback, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import EditStudentForm, { EditStudentFormFooter } from './EditStudentForm.jsx';
import SuspendStudentDialog from '@/features/students/components/SuspendStudentDialog.jsx';

export default function EditStudentModal({
  open,
  onClose,
  student,
  onSubmit,
  isSubmitting = false,
  error = '',
  orgId = '',
  session = null,
  onSuspendSuccess,
}) {
  const [editSubmitDisabled, setEditSubmitDisabled] = useState(false);
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [pendingSuspendPayload, setPendingSuspendPayload] = useState(null);
  // Mobile fix: prevent Dialog close when Select is open/closing
  const openSelectCountRef = useRef(0);
  const isClosingSelectRef = useRef(false);

  const handleSelectOpenChange = useCallback((isOpen) => {
    if (!isOpen && openSelectCountRef.current > 0) {
      isClosingSelectRef.current = true;
      setTimeout(() => {
        openSelectCountRef.current -= 1;
        if (openSelectCountRef.current < 0) {
          openSelectCountRef.current = 0;
        }
        isClosingSelectRef.current = false;
      }, 100);
    } else if (isOpen) {
      openSelectCountRef.current += 1;
    }
  }, []);

  const handleDialogInteractOutside = useCallback((event) => {
    if (openSelectCountRef.current > 0 || isClosingSelectRef.current) {
      event.preventDefault();
    }
  }, []);

  const handleCancel = () => {
    if (!isSubmitting) onClose();
  };

  const handleSubmit = useCallback((payload) => {
    const wasActive = student?.is_active !== false;
    const shouldSuspend = wasActive && payload?.isActive === false;

    if (shouldSuspend) {
      setPendingSuspendPayload(payload);
      setSuspendDialogOpen(true);
      return;
    }

    onSubmit?.(payload);
  }, [onSubmit, student?.is_active]);

  const handleSuspendDialogChange = useCallback((nextOpen) => {
    setSuspendDialogOpen(nextOpen);
    if (!nextOpen) {
      setPendingSuspendPayload(null);
    }
  }, []);

  const handleSuspendSuccess = useCallback(async () => {
    setPendingSuspendPayload(null);
    setSuspendDialogOpen(false);
    onClose?.();
    await onSuspendSuccess?.();
  }, [onClose, onSuspendSuccess]);

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
        <DialogContent 
          className="sm:max-w-xl"
          onInteractOutside={handleDialogInteractOutside}
          footer={
            <EditStudentFormFooter
              onSubmit={() => document.getElementById('edit-student-form')?.requestSubmit()}
              onCancel={handleCancel}
              isSubmitting={isSubmitting}
              disableSubmit={editSubmitDisabled}
            />
          }
        >
          <DialogHeader>
            <DialogTitle>עריכת תלמיד</DialogTitle>
          </DialogHeader>
          <EditStudentForm
            student={student}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isSubmitting={isSubmitting}
            error={error}
            renderFooterOutside={true}
            onSelectOpenChange={handleSelectOpenChange}
            onSubmitDisabledChange={setEditSubmitDisabled}
          />
        </DialogContent>
      </Dialog>

      <SuspendStudentDialog
        open={suspendDialogOpen}
        onOpenChange={handleSuspendDialogChange}
        student={student}
        orgId={orgId}
        session={session}
        onSuccess={handleSuspendSuccess}
        studentUpdatePayload={pendingSuspendPayload}
      />
    </>
  );
}
