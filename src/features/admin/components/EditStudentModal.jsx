import React, { useRef, useCallback, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import EditStudentForm, { EditStudentFormFooter } from './EditStudentForm.jsx';

export default function EditStudentModal({ open, onClose, student, onSubmit, isSubmitting = false, error = '' }) {
  const [editSubmitDisabled, setEditSubmitDisabled] = useState(false);
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

  return (
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
          onSubmit={onSubmit}
          onCancel={handleCancel}
          isSubmitting={isSubmitting}
          error={error}
          renderFooterOutside={true}
          onSelectOpenChange={handleSelectOpenChange}
          onSubmitDisabledChange={setEditSubmitDisabled}
        />
      </DialogContent>
    </Dialog>
  );
}
