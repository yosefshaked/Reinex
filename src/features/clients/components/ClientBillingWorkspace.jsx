import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, CornerUpLeft, Info, Loader2 } from 'lucide-react';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import CurrencyInput from '@/components/ui/CurrencyInput.jsx';
import ConfirmLedgerEntryDialog from '@/components/ui/ConfirmLedgerEntryDialog.jsx';
import LedgerEntriesTable from '@/features/finance/components/LedgerEntriesTable.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useServices } from '@/hooks/useOrgData.js';
import { coerceAgorot, formatCurrency, isValidCurrencyInput, toAgorot } from '@/lib/currency.js';

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

function shortId(id) {
  return id ? String(id).slice(-8) : '';
}

function computeDisplayedRowBalances(entries, currentBalanceAgorot) {
  let rollingBalance = coerceAgorot(currentBalanceAgorot);
  return entries.map((entry) => {
    const balanceAtRow = rollingBalance;
    const direction = String(entry?.direction || '').toUpperCase();
    const amount = coerceAgorot(entry?.amount);
    if (direction === 'CREDIT') {
      rollingBalance -= amount;
    } else if (direction === 'DEBIT') {
      rollingBalance += amount;
    }
    return balanceAtRow;
  });
}

export default function ClientBillingWorkspace({ clientProfile }) {
  const { activeOrgId } = useOrg();
  const { session } = useSupabase();
  const { services } = useServices({ enabled: Boolean(activeOrgId), orgId: activeOrgId, session });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [entryForm, setEntryForm] = useState(() => buildEntryForm());
  const [confirmEntry, setConfirmEntry] = useState(null);

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

  // Step 1: validate and open confirmation dialog.
  function handleAppendEntry() {
    if (!activeOrgId || !clientProfileId) return;

    if (!isValidCurrencyInput(entryForm.amount)) {
      toast.error('יש להזין סכום חוקי וחיובי.');
      return;
    }

    if (entryForm.mode === 'adjustment' && !entryForm.notes.trim()) {
      toast.error('יש להוסיף הערה לתנועת חיוב ידני — הלדר הוא מסמך קבוע.');
      return;
    }

    setConfirmEntry({
      type: entryForm.mode === 'adjustment' ? 'debit' : 'credit',
      amount: toAgorot(entryForm.amount),
      accountName: clientName,
      effectiveAt: entryForm.effectiveAt,
      notes: entryForm.notes,
      _formData: { ...entryForm },
    });
  }

  // Step 2: user confirmed — perform the API call.
  async function executeAppendEntry() {
    if (!activeOrgId || !clientProfileId || !confirmEntry) return;
    const formData = confirmEntry._formData;
    setSaving(true);
    try {
      await authenticatedFetch('billing', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          action: confirmEntry.type === 'debit' ? 'append_manual_debit' : 'append_manual_credit',
          account_type: 'client_profile',
          account_ref_id: clientProfileId,
          amount: confirmEntry.amount,
          effective_at: formData.effectiveAt || null,
          source_type: confirmEntry.type === 'debit' ? 'manual_adjustment' : 'manual_payment',
          notes: formData.notes || null,
          external_reference: formData.externalReference || null,
        },
      });
      setConfirmEntry(null);
      setEntryForm(buildEntryForm());
      await loadData();
      toast.success(confirmEntry.type === 'debit' ? 'ההתאמה נשמרה.' : 'התשלום נשמר.');
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

  // Map: original entry id → reversal entry id (for visual linkage)
  const reversalMap = useMemo(() => {
    const map = new Map();
    for (const entry of ledgerEntries) {
      if (entry.reverses_transaction_id) {
        map.set(entry.reverses_transaction_id, entry.id);
      }
    }
    return map;
  }, [ledgerEntries]);

  // Balance semantics
  const balanceAgorot = coerceAgorot(summary.balance);
  const balanceIsPositive = balanceAgorot > 0;
  const balanceIsNegative = balanceAgorot < 0;
  const displayedBalances = useMemo(
    () => computeDisplayedRowBalances(ledgerEntries, balanceAgorot),
    [balanceAgorot, ledgerEntries],
  );
  const ledgerRows = useMemo(() => ledgerEntries.map((entry, index) => {
    const isReversed = reversalMap.has(entry.id);
    const isReversal = entry.source_type === 'reversal';
    const direction = String(entry?.direction || '').toUpperCase();
    const descriptionLines = [
      entry.notes ? `הערות: ${entry.notes}` : '',
      entry.external_reference ? `אסמכתא: ${entry.external_reference}` : '',
      isReversal && entry.reverses_transaction_id ? `היפוך של תנועה #${shortId(entry.reverses_transaction_id)}` : '',
    ].filter(Boolean);

    return {
      key: entry.id,
      date: formatDateTime(entry.effective_at || entry.posted_at),
      primaryText: getEntryTypeLabel(entry),
      detailLines: descriptionLines,
      statusBadges: [
        {
          label: direction === 'CREDIT' ? 'זיכוי' : 'חיוב',
          className: direction === 'CREDIT'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-red-200 bg-red-50 text-red-700',
        },
        ...(isReversed ? [{
          label: 'הופך',
          className: 'border-amber-200 bg-amber-50 text-amber-800',
        }] : []),
      ],
      debit: direction === 'DEBIT' ? formatCurrency(entry.amount) : '—',
      credit: direction === 'CREDIT' ? formatCurrency(entry.amount) : '—',
      balance: formatCurrency(displayedBalances[index] || 0),
      dimmed: isReversed,
      actions: [
        {
          label: 'העתק מזהה תנועה',
          icon: <Copy className="h-4 w-4" />,
          onSelect: () => {
            navigator.clipboard.writeText(entry.id);
            toast.success('מזהה תנועה הועתק');
          },
        },
        ...(!isReversed && entry.source_type !== 'reversal' ? [{
          label: 'בצע היפוך',
          icon: <CornerUpLeft className="h-4 w-4" />,
          onSelect: () => handleReverseEntry(entry.id),
          disabled: saving,
          className: 'text-amber-700 focus:text-amber-700',
        }] : []),
      ],
    };
  }), [displayedBalances, ledgerEntries, reversalMap, saving]);

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <ConfirmLedgerEntryDialog
          open={Boolean(confirmEntry)}
          onOpenChange={(open) => { if (!open) setConfirmEntry(null); }}
          onConfirm={executeAppendEntry}
          saving={saving}
          entry={confirmEntry}
        />

        {/* ── Summary cards ── */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Balance card — semantics-aware */}
          <Card className={[
            'shadow-sm',
            balanceIsPositive ? 'border-emerald-200' : balanceIsNegative ? 'border-amber-200' : 'border-border/70',
          ].join(' ')}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-1.5 text-lg">
                יתרה נוכחית
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    יתרה חיובית = תשלום מראש. יתרה שלילית = סכום שהלקוח/ה חייב/ת לארגון.
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-semibold ${balanceIsPositive ? 'text-emerald-700' : balanceIsNegative ? 'text-amber-700' : 'text-foreground'}`}>
                {formatCurrency(summary.balance)}
              </div>
              <Badge
                variant="outline"
                className={`mt-2 text-[10px] ${balanceIsPositive ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : balanceIsNegative ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-300 bg-slate-50 text-slate-600'}`}
              >
                {balanceIsPositive ? 'זיכוי — שולם מראש' : balanceIsNegative ? 'חוב — חייב/ת לארגון' : 'מאוזן'}
              </Badge>
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

        {/* ── Manual entry form ── */}
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
                <CurrencyInput
                  value={entryForm.amount}
                  onChange={(value) => setEntryForm((current) => ({ ...current, amount: value }))}
                  disabled={saving}
                />
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
              <Label>
                הערות
                {entryForm.mode === 'adjustment' ? <span className="ms-1 text-destructive">*</span> : null}
              </Label>
              <Input
                value={entryForm.notes}
                onChange={(event) => setEntryForm((current) => ({ ...current, notes: event.target.value }))}
                disabled={saving}
                placeholder={entryForm.mode === 'adjustment' ? 'חובה לציין סיבה לחיוב ידני' : ''}
              />
              {entryForm.mode === 'adjustment' ? (
                <p className="text-xs text-muted-foreground">הסבר לחיוב חובה — הלדר לא ניתן למחיקה.</p>
              ) : null}
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

        {/* ── Ledger entries ── */}
        {loading ? (
          <section className="rounded-3xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500 shadow-sm shadow-slate-200/70 sm:px-6">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              טוען תנועות...
            </div>
          </section>
        ) : (
          <LedgerEntriesTable
            title="פנקס תנועות"
            description={`${clientName} • הלדר הוא מקור האמת היחיד. תשלומים, חיובים והיפוכים מוצגים כאן בסדר כרונולוגי.`}
            rows={ledgerRows}
            emptyLabel="אין תנועות להצגה."
          />
        )}

        {/* ── Lesson history ── */}
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
    </TooltipProvider>
  );
}
