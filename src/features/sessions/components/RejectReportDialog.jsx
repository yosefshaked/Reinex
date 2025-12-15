import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertTriangle } from 'lucide-react';

const REJECT_REASONS = [
  { value: 'duplicate', label: 'דיווח כפול' },
  { value: 'wrong_filling', label: 'מילוי שגוי' },
  { value: 'error', label: 'טעות במערכת' },
  { value: 'other', label: 'אחר (פרט בהערות)' },
];

export function RejectReportDialog({ open, onClose, onReject, reportName, isBulk = false }) {
  const [selectedReason, setSelectedReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!selectedReason) return;
    if (selectedReason === 'other' && !customReason.trim()) return;

    setIsSubmitting(true);
    try {
      const finalReason =
        selectedReason === 'other'
          ? customReason.trim()
          : REJECT_REASONS.find((r) => r.value === selectedReason)?.label || selectedReason;

      await onReject(finalReason);
      handleClose();
    } finally {
      // Reset loading state if promise settles
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setSelectedReason('');
    setCustomReason('');
    setIsSubmitting(false);
    onClose();
  };

  const canSubmit = selectedReason && (selectedReason !== 'other' || customReason.trim());

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-right">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            דחיית דיווח
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {reportName && (
            <div className="rounded-lg bg-muted p-3">
              <p className="text-sm text-muted-foreground text-right">
                {isBulk ? 'מספר דיווחים:' : 'שם התלמיד בדיווח:'}
              </p>
              <p className="font-medium text-right">{reportName}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reject-reason" className="text-right block">
              סיבת הדחייה <span className="text-destructive">*</span>
            </Label>
            <Select value={selectedReason} onValueChange={setSelectedReason} dir="rtl">
              <SelectTrigger id="reject-reason">
                <SelectValue placeholder="בחר סיבה..." />
              </SelectTrigger>
              <SelectContent>
                {REJECT_REASONS.map((reason) => (
                  <SelectItem key={reason.value} value={reason.value}>
                    {reason.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedReason === 'other' && (
            <div className="space-y-2">
              <Label htmlFor="custom-reason" className="text-right block">
                פרט את הסיבה <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="custom-reason"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="הזן סיבה מפורטת לדחיית הדיווח..."
                rows={3}
                dir="rtl"
                className="resize-none"
              />
            </div>
          )}

          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 p-3 border border-amber-200 dark:border-amber-900">
            <p className="text-sm text-amber-900 dark:text-amber-200 text-right">
              <strong>שים לב:</strong> {isBulk 
                ? 'דיווחים שנדחו יישמרו במערכת למעקב אך לא יהיו זמינים לפתרון.' 
                : 'דיווח שנדחה יישמר במערכת למעקב אך לא יהיה זמין לפתרון.'}
            </p>
          </div>
        </div>

        <DialogFooter className="flex-row-reverse gap-2">
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={!canSubmit || isSubmitting}
          >
            {isSubmitting ? 'דוחה...' : isBulk ? 'דחה דיווחים' : 'דחה דיווח'}
          </Button>
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
            ביטול
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
