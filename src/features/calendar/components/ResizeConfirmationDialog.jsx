import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { formatDateDisplay, formatTimeDisplay } from '../utils/timeGrid';

/**
 * ResizeConfirmationDialog - confirms rescheduling of lesson instances
 */
export function ResizeConfirmationDialog({
  open,
  instance,
  pendingReschedule,
  conflictWarnings = [],
  isLoading,
  onConfirm,
  onCancel,
}) {
  if (!instance || !pendingReschedule) return null;

  const firstStudentName = instance.participants?.[0]?.student?.full_name || 'לא ידוע';
  const newDateTime = pendingReschedule.newDateTime;
  const newDate = formatDateDisplay(newDateTime.toISOString());
  const newTime = formatTimeDisplay(newDateTime.toISOString());
  const newInstructor = pendingReschedule.newInstructor;

  return (
    <Dialog open={open} onOpenChange={onCancel}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>העברת שיעור</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Confirmation Details */}
          <div className="bg-slate-50 p-3 rounded-lg space-y-2">
            <p className="text-sm text-slate-700">
              <span className="font-semibold">תלמיד:</span> {firstStudentName}
            </p>
            <p className="text-sm text-slate-700">
              <span className="font-semibold">שירות:</span> {instance.service?.service_name || 'לא צוין'}
            </p>
            <p className="text-sm text-slate-700">
              <span className="font-semibold">תאריך ושעה:</span> {newDate} בשעה {newTime}
            </p>
            <p className="text-sm text-slate-700">
              <span className="font-semibold">מדריך:</span> {newInstructor?.full_name || 'לא צוין'}
            </p>
          </div>

          {/* Conflict Warnings */}
          {conflictWarnings.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-semibold mb-2">אזהרות:</p>
                <ul className="list-disc list-inside space-y-1">
                  {conflictWarnings.map((warning, idx) => (
                    <li key={idx} className="text-sm">
                      {warning.message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <p className="text-sm text-slate-600 text-center">
            האם ברצונך להעביר את השיעור?
          </p>
        </div>

        <DialogFooter className="flex gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
          >
            ביטול
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isLoading}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isLoading ? 'טוען...' : 'אישור'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
