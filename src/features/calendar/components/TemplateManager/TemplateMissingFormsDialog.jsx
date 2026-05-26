import { useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Mail, MessageCircle, Send } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import SendRequiredFormDialog from '@/features/students/components/SendRequiredFormDialog.jsx';
import { resolveSubjectFormDeliveryContact } from '@/features/forms/lib/delivery-contact.js';

function formatDateTime(value) {
  if (!value) return null;
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

function DeliveryMethodIcon({ method }) {
  if (method === 'email') return <Mail className="h-3.5 w-3.5 shrink-0" />;
  if (method === 'whatsapp') return <MessageCircle className="h-3.5 w-3.5 shrink-0" />;
  return <Send className="h-3.5 w-3.5 shrink-0" />;
}

function StatusBadge({ status }) {
  if (status === 'submitted') {
    return (
      <Badge className="gap-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
        <CheckCircle2 className="h-3 w-3" />
        הוגש
      </Badge>
    );
  }
  if (status === 'pending') {
    return (
      <Badge className="gap-1 bg-amber-100 text-amber-800 hover:bg-amber-100">
        <Clock className="h-3 w-3" />
        ממתין
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 bg-red-100 text-red-800 hover:bg-red-100">
      <AlertCircle className="h-3 w-3" />
      חסר
    </Badge>
  );
}

/**
 * Dialog showing required-form compliance status for a calendar template card.
 *
 * Props:
 *   open: boolean
 *   onClose: () => void
 *   template: template object (with participants having student.phone/email)
 *   missingFormsEntries: array of compliance entries filtered to this template
 *   onSent: () => void  — called after a form is sent (triggers compliance refresh)
 */
export default function TemplateMissingFormsDialog({
  open,
  onClose,
  template = null,
  missingFormsEntries = [],
  onSent,
}) {
  const [sendTarget, setSendTarget] = useState(null);
  const [sentPending, setSentPending] = useState(false);

  function handleClose() {
    setSendTarget(null);
    onClose?.();
  }

  // Build a lookup from client_profile_id to the full participant contact shape.
  const participantsByClientProfile = {};
  for (const p of template?.participants || []) {
    const cpId = p?.client_profile_id || p?.student?.client_profile_id || p?.client_profile?.id;
    if (cpId) participantsByClientProfile[cpId] = p;
  }

  const serviceName = template?.service?.name || '';

  return (
    <>
      <Dialog open={open && !sendTarget} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              טפסי חובה חסרים
            </DialogTitle>
            <DialogDescription>
              {serviceName ? `שירות: ${serviceName} · ` : ''}
              {missingFormsEntries.length} {missingFormsEntries.length === 1 ? 'טופס' : 'טפסים'} דורשים טיפול
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {missingFormsEntries.map((entry, i) => {
              const participant = participantsByClientProfile[entry.client_profile_id] || null;
              const contact = resolveSubjectFormDeliveryContact({ participant });
              const studentName = contact.name || '—';

              return (
                <div
                  key={`${entry.client_profile_id}-${entry.form_id}-${i}`}
                  className="rounded-lg border border-border bg-muted/30 p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">{studentName}</div>
                      <div className="text-xs text-muted-foreground">{entry.required_form_label || entry.form_name}</div>
                    </div>
                    <StatusBadge status={entry.status} />
                  </div>

                  {/* Last delivery info */}
                  {entry.last_sent_at ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>נשלח לאחרונה: <strong className="text-foreground">{formatDateTime(entry.last_sent_at)}</strong></span>
                      {entry.delivery_method && (
                        <span className="flex items-center gap-1">
                          <DeliveryMethodIcon method={entry.delivery_method} />
                          {entry.delivery_method === 'whatsapp' ? 'וואטסאפ' : 'אימייל'}
                          {entry.delivery_to ? ` · ${entry.delivery_to}` : ''}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">טרם נשלח</div>
                  )}

                  {/* Action */}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs h-7"
                    onClick={() => setSendTarget({ entry, participant })}
                  >
                    <Send className="h-3 w-3" />
                    {entry.last_sent_at ? 'שלח שוב' : 'שלח טופס'}
                  </Button>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {sendTarget && (
        <SendRequiredFormDialog
          open={Boolean(sendTarget)}
          onClose={() => {
            const wasSent = sentPending;
            setSendTarget(null);
            setSentPending(false);
            if (wasSent) onSent?.();
          }}
          onSent={() => {
            setSentPending(true);
          }}
          student={sendTarget.participant?.student || null}
          clientProfile={sendTarget.participant?.client_profile || null}
          participant={sendTarget.participant || null}
          serviceId={sendTarget.entry.service_id}
          formId={sendTarget.entry.form_id}
          requiredFormLabel={sendTarget.entry.required_form_label || sendTarget.entry.form_name}
          serviceName={serviceName}
        />
      )}
    </>
  );
}
