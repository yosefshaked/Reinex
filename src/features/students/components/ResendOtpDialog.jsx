import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * Dialog for choosing link validity before re-sending an OTP for an existing submission.
 *
 * Props:
 *   open           – boolean, dialog visibility
 *   onOpenChange   – (open: boolean) => void
 *   submission     – the form_submission row (used for display text)
 *   deliveryMethod – 'whatsapp' | 'email'
 *   onConfirm      – (expiresInMinutes: number) => void  called when user confirms
 *   loading        – boolean, shows spinner on confirm button and disables inputs
 */
export default function ResendOtpDialog({ open, onOpenChange, submission, deliveryMethod, onConfirm, loading = false }) {
  const [validityOption, setValidityOption] = useState('10080');
  const [customDays, setCustomDays] = useState(1);

  // Reset selections each time the dialog opens.
  useEffect(() => {
    if (open) {
      setValidityOption('10080');
      setCustomDays(1);
    }
  }, [open]);

  const expiresInMinutes =
    validityOption === 'custom'
      ? Math.min(20160, Math.max(15, (Number(customDays) || 1) * 24 * 60))
      : Number(validityOption) || 10080;

  const channelLabel = deliveryMethod === 'email' ? 'במייל' : 'בוואטסאפ';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>שלח OTP מחדש</DialogTitle>
          <DialogDescription>
            {`בחר תוקף לקישור החדש עבור ${submission?.form_name || 'הטופס'} — שליחה ${channelLabel}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>תוקף הקישור</Label>
            <Select value={validityOption} onValueChange={setValidityOption} disabled={loading}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 דקות</SelectItem>
                <SelectItem value="60">שעה</SelectItem>
                <SelectItem value="720">12 שעות</SelectItem>
                <SelectItem value="1440">24 שעות</SelectItem>
                <SelectItem value="10080">7 ימים</SelectItem>
                <SelectItem value="custom">מותאם אישית</SelectItem>
              </SelectContent>
            </Select>
            {validityOption === 'custom' && (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={14}
                  value={customDays}
                  onChange={(e) => setCustomDays(Math.min(14, Math.max(1, Number(e.target.value) || 1)))}
                  disabled={loading}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">ימים (מקסימום 14)</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-start">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            ביטול
          </Button>
          <Button
            type="button"
            onClick={() => onConfirm?.(expiresInMinutes)}
            disabled={loading}
            className="gap-2"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            שלח שוב
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
