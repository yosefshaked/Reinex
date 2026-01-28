import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import EditInstructorProfileDialog from './EditInstructorProfileDialog.jsx';

export default function EditEmployeeDialog({ open, onOpenChange, employee, orgId, session, onSaved }) {
  // Reuse existing profile editor for now
  return (
    <EditInstructorProfileDialog
      open={open}
      onOpenChange={onOpenChange}
      instructor={employee}
      orgId={orgId}
      session={session}
      onSaved={onSaved}
    />
  );
}
