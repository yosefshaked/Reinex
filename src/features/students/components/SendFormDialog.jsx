import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';

function normalizeWaPhone(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return `972${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith('5')) return `972${digits}`;
  return digits;
}

function buildSubmissionLink({ accessIdentifier = '', otp = '' } = {}) {
  const origin = window?.location?.origin || '';
  const params = new URLSearchParams();
  const normalizedIdentifier = String(accessIdentifier || '').trim();
  const normalizedOtp = String(otp || '').trim();

  if (normalizedIdentifier) params.set('identity_number', normalizedIdentifier);
  if (normalizedOtp) params.set('otp', normalizedOtp);

  const query = params.toString();
  return `${origin}/#/submit${query ? `?${query}` : ''}`;
}

function buildWhatsAppLink(phone, otp, submitLink, accessIdentifier, formName) {
  const normalizedPhone = normalizeWaPhone(phone);
  const message = [
    'שלום,',
    '',
    `שם הטופס למילוי: ${formName || 'טופס'}`,
    '',
    'מצורף קישור למילוי טופס:',
    submitLink,
    '',
    `מזהה גישה: ${accessIdentifier}`,
    `קוד אימות: ${otp}`,
    '',
    'אפשר לפתוח את הקישור ולשלוח את הטופס.',
  ].join('\n');
  return {
    normalizedPhone,
    url: `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`,
  };
}

export default function SendFormDialog({ open, onOpenChange, student, onSent }) {
  const { session } = useSupabase();
  const { activeOrgId, activeOrgHasConnection, tenantClientReady } = useOrg();

  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedFormId, setSelectedFormId] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState('whatsapp');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const canFetch = Boolean(open && session && activeOrgId && activeOrgHasConnection && tenantClientReady);

  const loadTemplates = useCallback(async () => {
    if (!canFetch) return;

    setLoadingTemplates(true);
    try {
      const data = await authenticatedFetch('forms', {
        session,
        params: { org_id: activeOrgId },
      });
      const activeTemplates = (Array.isArray(data) ? data : []).filter((form) => form?.is_active !== false);
      setTemplates(activeTemplates);
      if (!selectedFormId && activeTemplates.length > 0) {
        setSelectedFormId(activeTemplates[0].id);
      }
    } catch (error) {
      console.error('Failed to load form templates', error);
      toast.error(error?.message || 'טעינת תבניות טפסים נכשלה');
    } finally {
      setLoadingTemplates(false);
    }
  }, [activeOrgId, canFetch, selectedFormId, session]);

  useEffect(() => {
    if (open) {
      setResult(null);
      void loadTemplates();
    }
  }, [open, loadTemplates]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedFormId) || null,
    [templates, selectedFormId],
  );

  const handleSend = async () => {
    if (!student?.id || !selectedFormId || !activeOrgId) {
      toast.error('חסרים נתונים לשליחת הטופס');
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      const response = await authenticatedFetch('form-submissions', {
        method: 'POST',
        session,
        body: {
          org_id: activeOrgId,
          form_id: selectedFormId,
          student_id: student.id,
          delivery_method: deliveryMethod,
        },
      });

      if (deliveryMethod === 'email') {
        setResult({ mode: 'email' });
        toast.success('נשלח בהצלחה למייל');
        onSent?.({ mode: 'email', response });
        return;
      }

      const otp = String(response?.otp || '');
      const phone = String(response?.phone || '');
      if (!otp || !phone) {
        throw new Error('response_missing_whatsapp_payload');
      }

      const accessIdentifier = String(response?.access_identifier || student?.identity_number || student?.national_id || '');
      const submitLink = buildSubmissionLink({ accessIdentifier, otp });
      const wa = buildWhatsAppLink(phone, otp, submitLink, accessIdentifier, selectedTemplate?.name || 'טופס');
      setResult({
        mode: 'whatsapp',
        otp,
        phone: wa.normalizedPhone,
        submitLink,
        waLink: wa.url,
      });
      onSent?.({ mode: 'whatsapp', response, whatsapp: wa });
      toast.success('קוד אימות נוצר. אפשר לשלוח בוואטסאפ.');
    } catch (error) {
      console.error('Failed to initiate form submission', error);
      toast.error(error?.message || 'שליחת הטופס נכשלה');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>שלח טופס</DialogTitle>
          <DialogDescription>
            בחר תבנית טופס וערוץ שליחה עבור {student?.first_name || 'התלמיד'}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>תבנית טופס</Label>
            <Select value={selectedFormId} onValueChange={setSelectedFormId} disabled={loadingTemplates || submitting}>
              <SelectTrigger>
                <SelectValue placeholder="בחר תבנית" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {loadingTemplates && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                <Loader2 className="h-3 w-3 animate-spin" />
                טוען תבניות...
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>שיטת שליחה</Label>
            <Select value={deliveryMethod} onValueChange={setDeliveryMethod} disabled={submitting}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="whatsapp">וואטסאפ</SelectItem>
                <SelectItem value="email">אימייל</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {selectedTemplate && (
            <Alert>
              <AlertDescription>
                טופס נבחר: <strong>{selectedTemplate.name}</strong>
              </AlertDescription>
            </Alert>
          )}

          {result?.mode === 'email' && (
            <Alert>
              <AlertDescription className="text-emerald-700">נשלח בהצלחה למייל</AlertDescription>
            </Alert>
          )}

          {result?.mode === 'whatsapp' && (
            <div className="space-y-3">
              <Alert>
                <AlertDescription className="space-y-1">
                  <p>קוד אימות: <strong>{result.otp}</strong></p>
                  <p>טלפון יעד: <strong>{result.phone}</strong></p>
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
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            סגור
          </Button>
          <Button
            type="button"
            onClick={handleSend}
            disabled={submitting || !selectedFormId || loadingTemplates || !templates.length}
            className="gap-2"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : deliveryMethod === 'email' ? <Mail className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
            שלח טופס
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
