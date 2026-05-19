import { useMemo } from 'react';
import { MessageCircle, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { validateIsraeliPhone } from '@/components/ui/helpers/phone.js';
import { buildWhatsAppLink } from '../utils/instructor-whatsapp.js';

export default function InstructorWhatsAppDialog({
  open,
  onOpenChange,
  mode,
  title,
  description,
  phone,
  onPhoneChange,
  message,
  onMessageChange,
}) {
  const trimmedPhone = String(phone || '').trim();
  const phoneError = useMemo(() => {
    if (!trimmedPhone) return 'יש להזין מספר טלפון כדי להמשיך.';
    if (!validateIsraeliPhone(trimmedPhone)) return 'מספר הטלפון אינו בפורמט תקין.';
    return '';
  }, [trimmedPhone]);

  const waLink = useMemo(() => {
    if (phoneError || !message.trim()) {
      return '';
    }
    return buildWhatsAppLink(trimmedPhone, message);
  }, [message, phoneError, trimmedPhone]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast.success('ההודעה הועתקה ללוח.');
    } catch (error) {
      toast.error(error?.message || 'העתקת ההודעה נכשלה.');
    }
  };

  const handleOpenWhatsApp = () => {
    if (!waLink) {
      toast.error(phoneError || 'לא ניתן לפתוח את WhatsApp כרגע.');
      return;
    }
    window.open(waLink, '_blank', 'noopener,noreferrer');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description || (mode === 'week' ? 'שליחה שבועית למדריך.' : 'שליחה יומית למדריך.')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="instructor-whatsapp-phone">מספר טלפון</Label>
            <Input
              id="instructor-whatsapp-phone"
              dir="ltr"
              placeholder="0501234567"
              value={phone}
              onChange={(event) => onPhoneChange?.(event.target.value)}
            />
            {phoneError ? <p className="text-sm text-red-600">{phoneError}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="instructor-whatsapp-message">הודעה</Label>
            <Textarea
              id="instructor-whatsapp-message"
              value={message}
              onChange={(event) => onMessageChange?.(event.target.value)}
              className="min-h-[240px] leading-6"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleCopy} disabled={!message.trim()}>
            <Copy className="ms-2 h-4 w-4" />
            העתק
          </Button>
          <Button type="button" onClick={handleOpenWhatsApp} disabled={!waLink}>
            <MessageCircle className="ms-2 h-4 w-4" />
            פתח ב-WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
