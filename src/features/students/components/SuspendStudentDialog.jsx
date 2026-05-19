import React, { useState } from 'react';
import { Loader2, Calendar as CalendarIcon } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { toast } from 'sonner';
import { formatStudentName } from '@/features/students/utils/name-utils.js';
import { authenticatedFetch } from '@/lib/api-client.js';
import { updateStudentFromForm, updateStudentStatus } from '@/features/students/api/students.js';

/**
 * Suspend Student Dialog with two modes:
 * 1. "Immediately" — suspends student and cancels all future lessons from today
 * 2. "From Date..." — shows date picker, cancels all lessons from selected date
 */
export default function SuspendStudentDialog({
  open,
  onOpenChange,
  student,
  orgId,
  session,
  onSuccess,
  studentUpdatePayload = null,
}) {
  const [mode, setMode] = useState('immediate'); // 'immediate' | 'from-date'
  const [selectedDate, setSelectedDate] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  if (!student) return null;

  const handleConfirm = async () => {
    if (!orgId || isProcessing) return;

    const fromDate = mode === 'immediate'
      ? new Date().toISOString().split('T')[0]
      : selectedDate
        ? selectedDate.toISOString().split('T')[0]
        : null;

    if (!fromDate) {
      toast.error('יש לבחור תאריך');
      return;
    }

    setIsProcessing(true);
    try {
      // Step 1: Suspend the student, optionally with a full edit payload
      if (studentUpdatePayload && typeof studentUpdatePayload === 'object') {
        await updateStudentFromForm(studentUpdatePayload, {
          orgId,
          session,
          overrides: { isActive: false },
        });
      } else {
        await updateStudentStatus(student, false, { orgId, session });
      }

      // Step 2: Bulk-cancel future lessons
      const cancelResult = await authenticatedFetch('lesson-instances', {
        method: 'PATCH',
        body: {
          action: 'bulk-cancel',
          student_id: student.id,
          from_date: fromDate,
          org_id: orgId,
        },
        session,
      });

      const cancelledCount = cancelResult?.cancelled_count || 0;
      const msg = cancelledCount > 0
        ? `התלמיד הושהה ו-${cancelledCount} שיעורים בוטלו`
        : 'התלמיד הושהה בהצלחה';
      toast.success(msg);

      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error('Failed to suspend student', error);
      toast.error(error?.message || 'שגיאה בהשהיית התלמיד');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    if (!isProcessing) {
      setMode('immediate');
      setSelectedDate(null);
      onOpenChange(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <AlertDialogContent className="text-end max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>השהיית תלמיד</AlertDialogTitle>
          <AlertDialogDescription>
            השהיית <strong>{formatStudentName(student)}</strong> תבטל את כל השיעורים העתידיים.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 py-2">
          {/* Option 1: Immediately */}
          <button
            type="button"
            onClick={() => setMode('immediate')}
            className={`w-full text-end rounded-lg border p-3 transition ${
              mode === 'immediate'
                ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-200'
                : 'border-border hover:bg-accent'
            }`}
          >
            <div className="flex items-center gap-2">
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                mode === 'immediate' ? 'border-amber-500' : 'border-muted-foreground'
              }`}>
                {mode === 'immediate' && <div className="w-2 h-2 rounded-full bg-amber-500" />}
              </div>
              <span className="font-medium text-sm">באופן מיידי</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 me-6">
              בטל את כל השיעורים מהיום והלאה
            </p>
          </button>

          {/* Option 2: From Date */}
          <button
            type="button"
            onClick={() => setMode('from-date')}
            className={`w-full text-end rounded-lg border p-3 transition ${
              mode === 'from-date'
                ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-200'
                : 'border-border hover:bg-accent'
            }`}
          >
            <div className="flex items-center gap-2">
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                mode === 'from-date' ? 'border-amber-500' : 'border-muted-foreground'
              }`}>
                {mode === 'from-date' && <div className="w-2 h-2 rounded-full bg-amber-500" />}
              </div>
              <span className="font-medium text-sm">מתאריך מסוים...</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 me-6">
              בטל שיעורים מתאריך שתבחר
            </p>
          </button>

          {/* Date Picker (shown when from-date mode) */}
          {mode === 'from-date' && (
            <div className="me-6">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2 w-full justify-start">
                    <CalendarIcon className="h-4 w-4" />
                    {selectedDate
                      ? selectedDate.toLocaleDateString('he-IL')
                      : 'בחר תאריך'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                    disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                   
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>

        <div className="flex gap-2 sm:flex-row">
          <AlertDialogCancel disabled={isProcessing}>בטול</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isProcessing || (mode === 'from-date' && !selectedDate)}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin ms-2" />
                מעבד...
              </>
            ) : (
              'השהה תלמיד'
            )}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
