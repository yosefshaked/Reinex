import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast.jsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';

export default function LedgerInvoiceDialog({
  open,
  onOpenChange,
  entry = null,
  onSave,
  saving = false,
  title = 'עדכון פרטי חשבונית',
  description = 'אפשר לקשר לחשבון התנועה מספר חשבונית וקישור למסמך.',
}) {
  const [invoiceId, setInvoiceId] = useState('');
  const [invoiceLink, setInvoiceLink] = useState('');

  useEffect(() => {
    if (!open) {
      setInvoiceId('');
      setInvoiceLink('');
      return;
    }
    setInvoiceId(entry?.invoice_id || '');
    setInvoiceLink(entry?.invoice_link || '');
  }, [open, entry]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!entry?.id || !onSave) {
      return;
    }
    const trimmedLink = invoiceLink.trim();
    if (trimmedLink) {
      try {
        const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmedLink) ? trimmedLink : `https://${trimmedLink}`;
        const parsed = new URL(candidate);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new Error('invalid protocol');
        }
      } catch {
        toast.error('קישור החשבונית אינו תקין. יש להזין כתובת URL בפורמט נכון.');
        return;
      }
    }
    await onSave({
      id: entry.id,
      invoice_id: invoiceId.trim() || null,
      invoice_link: trimmedLink || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ledger-invoice-id">מספר חשבונית</Label>
            <Input
              id="ledger-invoice-id"
              value={invoiceId}
              onChange={(event) => setInvoiceId(event.target.value)}
              disabled={saving}
              placeholder="למשל 2026-104"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ledger-invoice-link">קישור לחשבונית</Label>
            <Input
              id="ledger-invoice-link"
              value={invoiceLink}
              onChange={(event) => setInvoiceLink(event.target.value)}
              disabled={saving}
              placeholder="https://..."
              dir="ltr"
            />
          </div>

          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
              שמור פרטי חשבונית
            </Button>
            <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
              ביטול
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
