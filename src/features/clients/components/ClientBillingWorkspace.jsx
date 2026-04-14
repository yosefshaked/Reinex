import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useServices } from '@/hooks/useOrgData.js';
import { formatCurrency } from '@/lib/currency.js';

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

function getEntryTypeLabel(entry) {
  switch (entry?.source_type) {
    case 'manual_payment':
      return 'תשלום ידני';
    case 'manual_adjustment':
      return 'התאמה ידנית';
    case 'lesson_charge':
      return 'חיוב שיעור';
    case 'reversal':
      return 'פעולת היפוך';
    default:
      return entry?.source_type || 'תנועה';
  }
}

function buildEntryForm() {
  return {
    mode: 'payment',
    amount: '',
    effectiveAt: new Date().toISOString().slice(0, 10),
    notes: '',
    externalReference: '',
  };
}

export default function ClientBillingWorkspace({ clientProfile }) {
  const { activeOrgId } = useOrg();
  const { session } = useSupabase();
  const { services } = useServices({ enabled: Boolean(activeOrgId), orgId: activeOrgId, session });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [entryForm, setEntryForm] = useState(() => buildEntryForm());

  const clientProfileId = clientProfile?.id || '';

  const loadData = useCallback(async () => {
    if (!activeOrgId || !session || !clientProfileId) return;
    setLoading(true);
    try {
      const payload = await authenticatedFetch('billing', {
        session,
        params: {
          org_id: activeOrgId,
          client_profile_id: clientProfileId,
        },
      });
      setSnapshot(payload || null);
    } catch (error) {
      console.error('Failed to load one-time customer billing workspace', error);
      toast.error(error?.message || 'טעינת נתוני החיוב נכשלה.');
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, clientProfileId, session]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleAppendEntry() {
    if (!activeOrgId || !clientProfileId) return;
    if (!entryForm.amount) {
      toast.error('יש להזין סכום.');
      return;
    }

    setSaving(true);
    try {
      await authenticatedFetch('billing', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          action: entryForm.mode === 'adjustment' ? 'append_manual_debit' : 'append_manual_credit',
          account_type: 'client_profile',
          account_ref_id: clientProfileId,
          amount: entryForm.amount,
          effective_at: entryForm.effectiveAt || null,
          source_type: entryForm.mode === 'adjustment' ? 'manual_adjustment' : 'manual_payment',
          notes: entryForm.notes || null,
          external_reference: entryForm.externalReference || null,
        },
      });
      setEntryForm(buildEntryForm());
      await loadData();
      toast.success(entryForm.mode === 'adjustment' ? 'ההתאמה נשמרה.' : 'התשלום נשמר.');
    } catch (error) {
      console.error('Failed to append manual client ledger entry', error);
      toast.error(error?.message || 'שמירת התנועה נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  async function handleReverseEntry(entryId) {
    if (!activeOrgId || !entryId) return;
    setSaving(true);
    try {
      await authenticatedFetch('billing', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          action: 'reverse_transaction',
          transaction_id: entryId,
          reason_code: 'manual_reversal',
        },
      });
      await loadData();
      toast.success('נרשמה פעולת היפוך.');
    } catch (error) {
      console.error('Failed to reverse client ledger transaction', error);
      toast.error(error?.message || 'יצירת פעולת ההיפוך נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  const summary = snapshot?.summary || {};
  const ledgerEntries = Array.isArray(snapshot?.ledger_entries) ? snapshot.ledger_entries : [];
  const lessonHistory = Array.isArray(snapshot?.lesson_history) ? snapshot.lesson_history : [];
  const clientName = useMemo(
    () => clientProfile?.full_name || [clientProfile?.first_name, clientProfile?.middle_name, clientProfile?.last_name].filter(Boolean).join(' ') || 'לקוח/ה',
    [clientProfile],
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">יתרה נוכחית</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-foreground">{formatCurrency(summary.balance)}</div>
            <div className="mt-2 text-sm text-muted-foreground">
              {clientName} מחויב/ת ישירות מהלדר. אין מסלול התחייבויות ואין יתרה חיצונית.
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">חיובי שיעורים</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-foreground">{formatCurrency(summary.lesson_charge_total)}</div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">תשלומים ידניים</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-foreground">{formatCurrency(summary.payment_total)}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">הוספת תנועה ידנית</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-2">
              <Label>סוג תנועה</Label>
              <Select value={entryForm.mode} onValueChange={(value) => setEntryForm((current) => ({ ...current, mode: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="payment">תשלום ידני</SelectItem>
                  <SelectItem value="adjustment">התאמה ידנית</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>סכום</Label>
              <Input type="number" min="0" step="0.01" value={entryForm.amount} onChange={(event) => setEntryForm((current) => ({ ...current, amount: event.target.value }))} disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label>תאריך</Label>
              <Input type="date" value={entryForm.effectiveAt} onChange={(event) => setEntryForm((current) => ({ ...current, effectiveAt: event.target.value }))} disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label>אסמכתא</Label>
              <Input value={entryForm.externalReference} onChange={(event) => setEntryForm((current) => ({ ...current, externalReference: event.target.value }))} disabled={saving} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>הערות</Label>
            <Input value={entryForm.notes} onChange={(event) => setEntryForm((current) => ({ ...current, notes: event.target.value }))} disabled={saving} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleAppendEntry} disabled={saving}>
              {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
              שמור תנועה
            </Button>
            <Button type="button" variant="outline" onClick={() => setEntryForm(buildEntryForm())} disabled={saving}>
              נקה
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">פנקס תנועות</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              טוען תנועות...
            </div>
          ) : ledgerEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              אין תנועות להצגה.
            </div>
          ) : ledgerEntries.map((entry) => (
            <div key={entry.id} className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    {getEntryTypeLabel(entry)} • {entry.direction === 'CREDIT' ? '+' : '-'}{formatCurrency(entry.amount)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(entry.effective_at || entry.posted_at)}
                    {entry.notes ? ` • ${entry.notes}` : ''}
                    {entry.external_reference ? ` • ${entry.external_reference}` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={entry.direction === 'CREDIT' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}>
                    {entry.direction === 'CREDIT' ? 'זיכוי' : 'חיוב'}
                  </Badge>
                  {entry.source_type !== 'reversal' ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => handleReverseEntry(entry.id)} disabled={saving}>
                      היפוך
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">היסטוריית שיעורים</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              טוען שיעורים...
            </div>
          ) : lessonHistory.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              אין שיעורים להצגה.
            </div>
          ) : lessonHistory.map((row) => (
            <div key={row.id} className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">{formatDateTime(row.lesson_instance?.datetime_start)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {getServiceName(services, row.lesson_instance?.service_id)} • {getParticipantStatusLabel(row.participant_status)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{row.billing_status === 'charged' ? 'חויב' : 'לא לחיוב'}</Badge>
                  <Badge variant="outline">{formatCurrency(row.billed_amount || 0)}</Badge>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
