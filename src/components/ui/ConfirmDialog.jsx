import React from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction
} from '@/components/ui/alert-dialog';

/**
 * `confirmLabel` defaults to the delete wording. Pass a verb for actions that are not deletions —
 * a reversible one should not ask the office to confirm deleting something.
 */
export default function ConfirmDialog({ open, onOpenChange, onConfirm, title, description, confirmLabel, destructive = true }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>בטל</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className={destructive ? 'bg-red-600 hover:bg-red-700' : undefined}>
            {confirmLabel || 'אני מבין/ה, מחק'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
