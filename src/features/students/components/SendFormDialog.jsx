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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from '@/lib/toast.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { resolveApiErrorMessage } from '@/lib/error-support.js';

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

function buildWhatsAppLink(phone, otp, submitLink, accessIdentifier, formName, expiresAt) {
  const normalizedPhone = normalizeWaPhone(phone);
  const expiryText = formatDateTime(expiresAt);
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
    `תוקף הקישור עד: ${expiryText}`,
    '',
    'אפשר לפתוח את הקישור ולשלוח את הטופס.',
  ].join('\n');
  return {
    normalizedPhone,
    url: `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`,
  };
}

function buildSubjectName(subject) {
  return [subject?.first_name, subject?.middle_name, subject?.last_name].filter(Boolean).join(' ').trim() || 'הלקוח/ה';
}

function mapSendFormErrorMessage(code) {
  switch (String(code || '').trim()) {
    case 'form_not_found':
      return 'הטופס שנבחר אינו זמין כרגע. אפשר לרענן ולנסות שוב.';
    case 'form_requires_publish_migration':
      return 'מבנה הפרסום של הטופס ישן ודורש מיגרציה. לחצו על "בצע מיגרציה" ואז נסו שוב.';
    case 'form_not_published':
      return 'הטופס קיים אך לא פורסם למילוי. יש לפרסם אותו במסך הטפסים ואז לנסות שוב.';
    case 'form_unavailable':
      return 'הטופס אינו זמין כרגע (רכיב משותף חסר). יש להשלים את הרכיב החסר ולנסות שוב.';
    case 'failed_to_create_otp':
      return 'לא הצלחנו ליצור קוד אימות כרגע. נסו שוב בעוד כמה דקות.';
    case 'failed_to_create_active_routing':
      return 'לא הצלחנו להכין קישור מילוי כרגע. נסו שוב בעוד כמה דקות.';
    case 'failed_to_send_email':
      return 'שליחת האימייל נכשלה כרגע. אפשר לנסות שוב או לבחור וואטסאפ.';
    default:
      return String(code || '').trim() || 'שליחת הטופס נכשלה';
  }
}

export default function SendFormDialog({ open, onOpenChange, student = null, clientProfile = null, onSent }) {
  const { session } = useSupabase();
  const { activeOrgId } = useOrg();
  const subject = clientProfile || student;

  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedFormId, setSelectedFormId] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState('whatsapp');
  const [validityOption, setValidityOption] = useState('10080');
  const [customDays, setCustomDays] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [result, setResult] = useState(null);

  const canFetch = Boolean(open && session && activeOrgId);

  const loadTemplates = useCallback(async () => {
    if (!canFetch) return;

    setLoadingTemplates(true);
    try {
      const data = await authenticatedFetch('forms', {
        session,
        params: { org_id: activeOrgId, selection_mode: 'delivery' },
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
      setValidityOption('10080');
      setCustomDays(1);
      void loadTemplates();
    }
  }, [open, loadTemplates]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedFormId) || null,
    [templates, selectedFormId],
  );

  const handleSend = async () => {
    if (!subject?.id || !selectedFormId || !activeOrgId) {
      toast.error('חסרים נתונים לשליחת הטופס');
      return;
    }
    if (selectedTemplate?.requires_publish_migration) {
      toast.error('הטופס דורש מיגרציית פרסום לפני שליחה');
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      const expiresInMinutes = validityOption === 'custom'
        ? Math.min(20160, Math.max(15, (Number(customDays) || 1) * 24 * 60))
        : Number(validityOption) || 10080;

      const response = await authenticatedFetch('form-submissions', {
        method: 'POST',
        session,
        body: {
          org_id: activeOrgId,
          form_id: selectedFormId,
          client_profile_id: clientProfile?.id || subject?.client_profile_id || subject?.id,
          student_id: student?.id || null,
          delivery_method: deliveryMethod,
          expires_in_minutes: expiresInMinutes,
        },
      });

      if (deliveryMethod === 'email') {
        setResult({ mode: 'email', expiresAt: String(response?.expires_at || '') });
        toast.success('נשלח בהצלחה למייל');
        onSent?.({ mode: 'email', response });
        return;
      }

      const otp = String(response?.otp || '');
      const phone = String(response?.phone || '');
      if (!otp || !phone) {
        throw new Error('response_missing_whatsapp_payload');
      }

      const accessIdentifier = String(response?.access_identifier || subject?.identity_number || subject?.national_id || '');
      const expiresAt = String(response?.expires_at || '');
      const submitLink = buildSubmissionLink({ accessIdentifier, otp });
      const wa = buildWhatsAppLink(phone, otp, submitLink, accessIdentifier, selectedTemplate?.name || 'טופס', expiresAt);
      setResult({
        mode: 'whatsapp',
        otp,
        phone: wa.normalizedPhone,
        expiresAt,
        submitLink,
        waLink: wa.url,
      });
      onSent?.({ mode: 'whatsapp', response, whatsapp: wa });
      toast.success('קוד אימות נוצר. אפשר לשלוח בוואטסאפ.');
    } catch (error) {
      console.error('Failed to initiate form submission', error);
      const errorCode = resolveApiErrorMessage(error);
      toast.error(mapSendFormErrorMessage(errorCode));
    } finally {
      setSubmitting(false);
    }
  };

  const handleMigrateTemplate = async () => {
    if (!selectedFormId || !activeOrgId || !session) {
      toast.error('חסרים נתונים לביצוע מיגרציה');
      return;
    }

    setMigrating(true);
    try {
      await authenticatedFetch(`forms/${selectedFormId}`, {
        method: 'PUT',
        session,
        body: {
          org_id: activeOrgId,
          action: 'migrate_publish_structure',
        },
      });
      toast.success('מיגרציית מבנה הפרסום הושלמה');
      await loadTemplates();
    } catch (error) {
      console.error('Failed to migrate publish structure', error);
      const errorCode = resolveApiErrorMessage(error);
      toast.error(mapSendFormErrorMessage(errorCode));
    } finally {
      setMigrating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>שלח טופס</DialogTitle>
          <DialogDescription>
            בחר תבנית טופס וערוץ שליחה עבור {buildSubjectName(subject)}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>תבנית טופס</Label>
            <Select value={selectedFormId} onValueChange={setSelectedFormId} disabled={loadingTemplates || submitting || migrating}>
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
            <Select value={deliveryMethod} onValueChange={setDeliveryMethod} disabled={submitting || migrating}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="whatsapp">וואטסאפ</SelectItem>
                <SelectItem value="email">אימייל</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>תוקף הקישור</Label>
            <Select value={validityOption} onValueChange={setValidityOption} disabled={submitting || migrating}>
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
                  disabled={submitting || migrating}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">ימים (מקסימום 14)</span>
              </div>
            )}
          </div>

          {selectedTemplate && (
            <Alert>
              <AlertDescription>
                טופס נבחר: <strong>{selectedTemplate.name}</strong>
              </AlertDescription>
            </Alert>
          )}

          {selectedTemplate?.requires_publish_migration && (
            <Alert>
              <AlertDescription className="space-y-2">
                <p>הטופס נבחר אך מבנה הפרסום שלו ישן, ולכן אי אפשר לשלוח אותו עד ביצוע מיגרציה.</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleMigrateTemplate}
                  disabled={submitting || migrating}
                  className="gap-2"
                >
                  {migrating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  בצע מיגרציה למבנה הפרסום
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {result?.mode === 'email' && (
            <Alert>
              <AlertDescription className="text-emerald-700">
                <p>נשלח בהצלחה למייל</p>
                <p>תוקף הקישור עד: <strong>{formatDateTime(result?.expiresAt)}</strong></p>
              </AlertDescription>
            </Alert>
          )}

          {result?.mode === 'whatsapp' && (
            <div className="space-y-3">
              <Alert>
                <AlertDescription className="space-y-1">
                  <p>קוד אימות: <strong>{result.otp}</strong></p>
                  <p>טלפון יעד: <strong>{result.phone}</strong></p>
                  <p>תוקף הקישור עד: <strong>{formatDateTime(result?.expiresAt)}</strong></p>
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
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting || migrating}>
            סגור
          </Button>
          {!result && (
            <Button
              type="button"
              onClick={handleSend}
              disabled={submitting || migrating || !selectedFormId || loadingTemplates || !templates.length || Boolean(selectedTemplate?.requires_publish_migration)}
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
