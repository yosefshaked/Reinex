import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Mail, MessageCircle, ExternalLink } from 'lucide-react';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from '@/lib/toast.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { resolveApiErrorMessage } from '@/lib/error-support.js';
import { normalizeFormDeliveryPhone, resolveSubjectFormDeliveryContact } from '@/features/forms/lib/delivery-contact.js';
import { buildRequiredFormInviteWhatsAppMessage } from '@/lib/whatsapp-message-templates.js';

function formatDateTime(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('he-IL', {
      timeZone: 'Asia/Jerusalem',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function buildWhatsAppInviteLink(phone, inviteUrl, formLabel, organizationName) {
  const normalizedPhone = normalizeFormDeliveryPhone(phone);
  const message = buildRequiredFormInviteWhatsAppMessage({
    inviteUrl,
    formLabel,
    organizationName,
  });
  return {
    normalizedPhone,
    url: `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`,
  };
}

function mapSendErrorMessage(code) {
  switch (String(code || '').trim()) {
    case 'service_not_found': return 'השירות לא נמצא. נסו לרענן את הדף ולנסות שוב.';
    case 'form_not_found': return 'הטופס לא נמצא. ודאו שהטופס פעיל ופורסם.';
    case 'form_not_published': return 'הטופס קיים אך לא פורסם למילוי. יש לפרסם אותו ואז לנסות שוב.';
    case 'form_not_required_for_service': return 'הטופס אינו מוגדר כטופס חובה לשירות זה.';
    case 'client_profile_not_found': return 'פרופיל הלקוח לא נמצא. נסו לרענן את הדף.';
    case 'email_send_failed_manual_fallback': return 'שליחת האימייל נכשלה. אפשר לשלוח ידנית דרך וואטסאפ.';
    default: return String(code || '').trim() || 'שליחת הטופס נכשלה. נסו שוב.';
  }
}

/**
 * Dialog for sending a required form to a student.
 * The form is fixed by service config — no form picker.
 *
 * Props:
 *   open: boolean
 *   onClose: () => void
 *   onSent: (result) => void
 *   student: { id, ... }
 *   clientProfile: { id, first_name, last_name, phone, email, ... }
 *   serviceId: string
 *   formId: string
 *   requiredFormLabel: string  (e.g. "טופס קבלה")
 *   serviceName: string
 */
export default function SendRequiredFormDialog({
  open,
  onClose,
  onSent,
  student = null,
  clientProfile = null,
  participant = null,
  serviceId = '',
  formId = '',
  requiredFormLabel = 'טופס חובה',
  serviceName = '',
}) {
  const { session } = useSupabase();
  const { activeOrg, activeOrgId } = useOrg();

  const [deliveryMethod, setDeliveryMethod] = useState('whatsapp');
  const [validityOption, setValidityOption] = useState('10080');
  const [customDays, setCustomDays] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (open) {
      setResult(null);
      setDeliveryMethod('whatsapp');
      setValidityOption('10080');
      setCustomDays(1);
    }
  }, [open]);

  const deliveryContact = useMemo(
    () => resolveSubjectFormDeliveryContact({ student, clientProfile, participant }),
    [clientProfile, participant, student],
  );
  const phone = String(deliveryContact.phone || '');
  const email = String(deliveryContact.email || '');
  const clientProfileId = String(clientProfile?.id || participant?.client_profile_id || participant?.student?.client_profile_id || student?.client_profile_id || '');
  const studentId = String(student?.id || participant?.student_id || participant?.student?.id || '');

  const canSend = Boolean(clientProfileId && serviceId && formId && activeOrgId && session);

  const handleSend = async () => {
    if (!canSend) {
      toast.error('חסרים נתונים לשליחת הטופס');
      return;
    }
    if (deliveryMethod === 'whatsapp' && !phone) {
      toast.error('לא נמצא מספר טלפון לשליחה בוואטסאפ');
      return;
    }
    if (deliveryMethod === 'email' && !email) {
      toast.error('לא נמצאה כתובת אימייל לשליחה');
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      const expiresInMinutes = validityOption === 'custom'
        ? Math.min(20160, Math.max(15, (Number(customDays) || 1) * 24 * 60))
        : Number(validityOption) || 10080;

      const response = await authenticatedFetch('student-required-forms/send', {
        method: 'POST',
        session,
        body: {
          org_id: activeOrgId,
          service_id: serviceId,
          form_id: formId,
          client_profile_id: clientProfileId,
          student_id: studentId || undefined,
          delivery_method: deliveryMethod,
          phone: phone || undefined,
          email: email || undefined,
          expires_in_minutes: expiresInMinutes,
        },
      });

      const inviteUrl = String(response?.invite_url || '');
      const expiresAt = String(response?.expires_at || '');
      const deliveryStatus = String(response?.delivery_status || '');

      if (deliveryMethod === 'email') {
        if (deliveryStatus === 'email_failed') {
          toast.error('שליחת האימייל נכשלה — הקישור מוכן לשליחה ידנית');
        } else {
          toast.success('נשלח בהצלחה למייל');
        }
        setResult({ mode: 'email', inviteUrl, expiresAt, deliveryStatus });
        onSent?.({ mode: 'email', response });
        return;
      }

      // WhatsApp
      const wa = buildWhatsAppInviteLink(phone, inviteUrl, requiredFormLabel, activeOrg?.name);
      setResult({
        mode: 'whatsapp',
        phone: wa.normalizedPhone,
        inviteUrl,
        expiresAt,
        waLink: wa.url,
      });
      onSent?.({ mode: 'whatsapp', response, whatsapp: wa });
      toast.success('קישור הוכן. אפשר לשלוח בוואטסאפ.');
    } catch (error) {
      console.error('Failed to send required form', error);
      const errorCode = resolveApiErrorMessage(error);
      toast.error(mapSendErrorMessage(errorCode));
    } finally {
      setSubmitting(false);
    }
  };

  const subjectName = deliveryContact.name || 'הלקוח/ה';

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose?.(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>שלח טופס חובה</DialogTitle>
          <DialogDescription>
            שליחת <strong>{requiredFormLabel}</strong>
            {serviceName ? <> עבור שירות <strong>{serviceName}</strong></> : null}
            {' '}ל{subjectName}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            טופס: <strong>{requiredFormLabel}</strong>
            {serviceName ? <span className="text-amber-700"> · {serviceName}</span> : null}
          </div>

          <div className="space-y-2">
            <Label>שיטת שליחה</Label>
            <Select value={deliveryMethod} onValueChange={setDeliveryMethod} disabled={submitting}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="whatsapp">וואטסאפ{phone ? ` (${phone})` : ''}</SelectItem>
                <SelectItem value="email">אימייל{email ? ` (${email})` : ''}</SelectItem>
              </SelectContent>
            </Select>
            {deliveryMethod === 'whatsapp' && !phone && (
              <p className="text-xs text-red-600">לא נמצא מספר טלפון — לא ניתן לשלוח בוואטסאפ</p>
            )}
            {deliveryMethod === 'email' && !email && (
              <p className="text-xs text-red-600">לא נמצאה כתובת אימייל — לא ניתן לשלוח למייל</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>תוקף הקישור</Label>
            <Select value={validityOption} onValueChange={setValidityOption} disabled={submitting}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1440">24 שעות</SelectItem>
                <SelectItem value="10080">7 ימים</SelectItem>
                <SelectItem value="20160">14 ימים</SelectItem>
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
                  disabled={submitting}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">ימים (מקסימום 14)</span>
              </div>
            )}
          </div>

          {result?.mode === 'email' && (
            <Alert>
              <AlertDescription className="space-y-1">
                {result.deliveryStatus === 'email_failed' ? (
                  <p className="text-amber-700">שליחת האימייל נכשלה. הקישור מוכן לשליחה ידנית:</p>
                ) : (
                  <p className="text-emerald-700">נשלח בהצלחה למייל</p>
                )}
                <p>תוקף הקישור עד: <strong>{formatDateTime(result.expiresAt)}</strong></p>
                {result.deliveryStatus === 'email_failed' && result.inviteUrl && (
                  <a href={result.inviteUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-primary underline">
                    <ExternalLink className="h-3 w-3" />
                    {result.inviteUrl}
                  </a>
                )}
              </AlertDescription>
            </Alert>
          )}

          {result?.mode === 'whatsapp' && (
            <div className="space-y-3">
              <Alert>
                <AlertDescription className="space-y-1">
                  <p>טלפון יעד: <strong>{result.phone}</strong></p>
                  <p>תוקף הקישור עד: <strong>{formatDateTime(result.expiresAt)}</strong></p>
                </AlertDescription>
              </Alert>
              <a
                href={result.waLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-95"
              >
                <MessageCircle className="h-4 w-4" />
                שלח הודעת וואטסאפ
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-start">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            סגור
          </Button>
          {!result && (
            <Button
              type="button"
              onClick={handleSend}
              disabled={submitting || !canSend || (deliveryMethod === 'whatsapp' && !phone) || (deliveryMethod === 'email' && !email)}
              className="gap-2"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : deliveryMethod === 'email' ? <Mail className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
              שלח טופס
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
