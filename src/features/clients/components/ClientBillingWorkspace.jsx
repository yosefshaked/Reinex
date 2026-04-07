import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, WalletCards } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useServices } from '@/hooks/useOrgData.js';
import LedgerInvoiceDialog from '@/features/finance/components/LedgerInvoiceDialog.jsx';

function formatCurrency(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `₪${Number(value).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('he-IL', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getServiceName(services, serviceId) {
  return services.find((service) => service.id === serviceId)?.service_name
    || services.find((service) => service.id === serviceId)?.name
    || 'שירות';
}

function getEntryTypeLabel(entry) {
  switch (entry?.usage_type) {
    case 'manual_topup':
      return 'הוספת יתרה';
    case 'manual_adjustment':
      return 'התאמה ידנית';
    case 'standard':
      return 'חיוב שיעור';
    case 'double':
      return 'חיוב כפול';
    case 'cross_service':
      return 'חיוב חוצה שירות';
    default:
      return entry?.usage_type || 'תנועה';
  }
}

function getBillingStatusLabel(status) {
  switch (status) {
    case 'charged':
      return 'חויב';
    case 'not_chargeable':
      return 'לא לחיוב';
    case 'pending_service_default_charge_amount':
      return 'חסר מחיר שירות';
    case 'pending_attendance':
      return 'ממתין לנוכחות';
    default:
      return status || 'לא ידוע';
  }
}

function getParticipantStatusLabel(status) {
  switch (status) {
    case 'attended':
      return 'נכח/ה';
    case 'no_show':
      return 'לא הגיע/ה';
    case 'cancelled_student':
      return 'בוטל על ידי הלקוח/ה';
    case 'cancelled_clinic':
      return 'בוטל על ידי הארגון';
    case 'scheduled':
      return 'מתוכנן';
    default:
      return status || 'לא ידוע';
  }
}

function buildDefaultTopupForm() {
  return {
    amount: '',
    effectiveDate: new Date().toISOString().slice(0, 10),
    notes: '',
    invoiceId: '',
    invoiceLink: '',
  };
}

export default function ClientBillingWorkspace({ clientProfile }) {
  const { activeOrgId } = useOrg();
  const { session } = useSupabase();
  const { services } = useServices({ enabled: Boolean(activeOrgId), orgId: activeOrgId, session });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [entries, setEntries] = useState([]);
  const [instances, setInstances] = useState([]);
  const [invoiceDialogEntry, setInvoiceDialogEntry] = useState(null);
  const [topupForm, setTopupForm] = useState(buildDefaultTopupForm);

  const clientProfileId = clientProfile?.id || '';

  const balance = useMemo(() => entries.reduce((sum, entry) => {
    const amount = Number(entry?.amount || 0);
    return entry?.transaction_type === 'CREDIT' ? sum + amount : sum - amount;
  }, 0), [entries]);

  const lessonHistory = useMemo(() => {
    const rows = [];
    for (const instance of instances) {
      for (const participant of Array.isArray(instance?.participants) ? instance.participants : []) {
        const participantClientProfileId = participant?.client_profile_id
          || participant?.client_profile?.id
          || participant?.student?.client_profile_id
          || participant?.student?.client_profile?.id
          || null;

        if (participantClientProfileId === clientProfileId) {
          rows.push({
            lesson_instance_id: instance.id,
            datetime_start: instance.datetime_start,
            participant_status: participant.participant_status,
            billing_status: participant?.pricing_breakdown?.billing_status || '',
            billing_reason: participant?.pricing_breakdown?.billing_reason || '',
            price_charged: participant?.price_charged,
            service_id: instance.service_id,
          });
        }
      }
    }
    return rows.sort((left, right) => String(right.datetime_start || '').localeCompare(String(left.datetime_start || '')));
  }, [clientProfileId, instances]);

  const loadData = useCallback(async () => {
    if (!activeOrgId || !session || !clientProfileId) return;
    setLoading(true);
    try {
      const [entriesPayload, instancesPayload] = await Promise.all([
        authenticatedFetch('consumption-entries', {
          session,
          params: {
            org_id: activeOrgId,
            client_profile_id: clientProfileId,
          },
        }),
        authenticatedFetch('calendar/instances', {
          session,
          params: {
            org_id: activeOrgId,
            client_profile_id: clientProfileId,
            start_date: new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().slice(0, 10),
            end_date: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10),
          },
        }),
      ]);

      setEntries(Array.isArray(entriesPayload?.entries) ? entriesPayload.entries : []);
      setInstances(Array.isArray(instancesPayload) ? instancesPayload : []);
    } catch (error) {
      console.error('Failed to load one-time customer billing workspace', error);
      toast.error(error?.message || 'טעינת נתוני החיוב נכשלה.');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, clientProfileId, session]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSaveTopup() {
    if (!activeOrgId || !clientProfileId) return;
    const amount = Number(topupForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('יש להזין סכום תקין.');
      return;
    }

    setSaving(true);
    try {
      await authenticatedFetch('consumption-entries', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          client_profile_id: clientProfileId,
          direction: 'credit',
          usage_type: 'manual_topup',
          amount,
          effective_date: topupForm.effectiveDate || null,
          notes: topupForm.notes || null,
          invoice_id: topupForm.invoiceId || null,
          invoice_link: topupForm.invoiceLink || null,
        },
      });
      setTopupForm(buildDefaultTopupForm());
      await loadData();
      toast.success('היתרה נוספה בהצלחה.');
    } catch (error) {
      console.error('Failed to add one-time customer balance', error);
      toast.error(error?.message || 'הוספת היתרה נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteEntry(entryId) {
    if (!activeOrgId || !entryId) return;
    setSaving(true);
    try {
      await authenticatedFetch('consumption-entries', {
        session,
        method: 'DELETE',
        body: {
          org_id: activeOrgId,
          id: entryId,
        },
      });
      await loadData();
      toast.success('התנועה נמחקה.');
    } catch (error) {
      console.error('Failed to delete one-time billing entry', error);
      toast.error(error?.message || 'מחיקת התנועה נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveInvoiceFields({ id, invoice_id, invoice_link }) {
    if (!activeOrgId || !id) return;
    setSaving(true);
    try {
      await authenticatedFetch('consumption-entries', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          action: 'update_invoice_fields',
          id,
          invoice_id,
          invoice_link,
        },
      });
      setInvoiceDialogEntry(null);
      await loadData();
      toast.success('פרטי החשבונית עודכנו.');
    } catch (error) {
      console.error('Failed to update one-time billing invoice fields', error);
      toast.error(error?.message || 'עדכון פרטי החשבונית נכשל.');
    } finally {
      setSaving(false);
    }
  }

  const manualEntryIds = useMemo(() => new Set(
    entries
      .filter((entry) => ['manual_topup', 'manual_adjustment'].includes(entry?.usage_type))
      .map((entry) => entry.id)
  ), [entries]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <WalletCards className="h-5 w-5 text-primary" />
              יתרה ותשלום מראש
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3">
              <div className="text-sm text-muted-foreground">יתרה זמינה</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">{formatCurrency(balance)}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                שיעור חד-פעמי יחויב רק אחרי סימון הגעה. אפשר להטעין יתרה כבר עכשיו.
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-4">
              <div className="text-sm font-semibold text-foreground">הוספת יתרה ידנית</div>
              <div className="space-y-2">
                <Label htmlFor="client-topup-amount">סכום</Label>
                <Input
                  id="client-topup-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={topupForm.amount}
                  onChange={(event) => setTopupForm((current) => ({ ...current, amount: event.target.value }))}
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client-topup-effective-date">תאריך תוקף</Label>
                <Input
                  id="client-topup-effective-date"
                  type="date"
                  value={topupForm.effectiveDate}
                  onChange={(event) => setTopupForm((current) => ({ ...current, effectiveDate: event.target.value }))}
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client-topup-notes">הערות</Label>
                <Input
                  id="client-topup-notes"
                  value={topupForm.notes}
                  onChange={(event) => setTopupForm((current) => ({ ...current, notes: event.target.value }))}
                  disabled={saving}
                  placeholder="למשל: תשלום מראש עבור שיעור חד-פעמי"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="client-topup-invoice-id">מספר חשבונית</Label>
                  <Input
                    id="client-topup-invoice-id"
                    value={topupForm.invoiceId}
                    onChange={(event) => setTopupForm((current) => ({ ...current, invoiceId: event.target.value }))}
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client-topup-invoice-link">קישור לחשבונית</Label>
                  <Input
                    id="client-topup-invoice-link"
                    value={topupForm.invoiceLink}
                    onChange={(event) => setTopupForm((current) => ({ ...current, invoiceLink: event.target.value }))}
                    disabled={saving}
                    dir="ltr"
                    placeholder="https://..."
                  />
                </div>
              </div>
              <Button type="button" onClick={handleSaveTopup} disabled={saving || !topupForm.amount}>
                {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                הוסף יתרה
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">יומן כספי</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                טוען תנועות...
              </div>
            ) : entries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                עדיין אין תנועות כספיות ללקוח/ה הזה/ו.
              </div>
            ) : entries.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-border bg-muted/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {getEntryTypeLabel(entry)} • {entry.transaction_type === 'CREDIT' ? '+' : '-'}{formatCurrency(entry.amount)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatDateTime(entry.effective_date || entry.metadata?.effective_date || entry.created_at)}
                      {entry.invoice_id ? ` • חשבונית ${entry.invoice_id}` : ''}
                      {entry.notes ? ` • ${entry.notes}` : ''}
                    </div>
                    {entry.invoice_link ? (
                      <div className="mt-1 text-xs">
                        <a href={entry.invoice_link} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                          פתח קישור לחשבונית
                        </a>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={entry.transaction_type === 'CREDIT' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}>
                      {entry.transaction_type === 'CREDIT' ? 'זיכוי' : 'חיוב'}
                    </Badge>
                    <Button type="button" size="sm" variant="outline" onClick={() => setInvoiceDialogEntry(entry)} disabled={saving}>
                      חשבונית
                    </Button>
                    {manualEntryIds.has(entry.id) ? (
                      <Button type="button" size="sm" variant="outline" onClick={() => handleDeleteEntry(entry.id)} disabled={saving}>
                        מחק
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">היסטוריית חיוב שיעורים</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              טוען שיעורים...
            </div>
          ) : lessonHistory.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              עדיין אין שיעורים להצגה.
            </div>
          ) : lessonHistory.map((row) => (
            <div key={`${row.lesson_instance_id}-${row.datetime_start}`} className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">{formatDateTime(row.datetime_start)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {getServiceName(services, row.service_id)} • {getParticipantStatusLabel(row.participant_status)}
                  </div>
                  {row.billing_reason ? (
                    <div className="mt-1 text-xs text-muted-foreground">{row.billing_reason}</div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{getBillingStatusLabel(row.billing_status)}</Badge>
                  <Badge variant="outline">{row.price_charged == null ? 'טרם חויב' : formatCurrency(row.price_charged)}</Badge>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <LedgerInvoiceDialog
        open={Boolean(invoiceDialogEntry)}
        onOpenChange={(open) => {
          if (!open) {
            setInvoiceDialogEntry(null);
          }
        }}
        entry={invoiceDialogEntry}
        saving={saving}
        onSave={handleSaveInvoiceFields}
      />
    </div>
  );
}
