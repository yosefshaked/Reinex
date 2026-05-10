import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Info, Loader2, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import CurrencyInput from '@/components/ui/CurrencyInput.jsx';
import ConfirmLedgerEntryDialog from '@/components/ui/ConfirmLedgerEntryDialog.jsx';
import LedgerEntriesTable from '@/features/finance/components/LedgerEntriesTable.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { useMedicalProviders } from '@/features/students/hooks/useMedicalProviders.js';
import { isAdminRole } from '@/features/students/utils/endpoints.js';
import { coerceAgorot, formatCurrency, isValidCurrencyInput, toAgorot } from '@/lib/currency.js';
import { getHmoClaimFeedback, getHmoClaimValidationFeedback } from '@/features/finance/lib/hmo-claim-feedback.js';
import { groupLedgerEntries, sumByDirection } from '@/features/finance/utils/ledgerGrouping.js';

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime()) || d.getTime() <= 0) return '—';
  return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(d);
}

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime()) || d.getTime() <= 0) return '—';
  return new Intl.DateTimeFormat('he-IL', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function shortId(id) {
  return id ? String(id).slice(-8) : '';
}

function getEntryTypeLabel(sourceType) {
  switch (sourceType) {
    case 'lesson_charge': return 'חיוב שיעור';
    case 'hmo_invoice_payment': return 'תשלום חשבונית';
    case 'reversal': return 'פעולת היפוך';
    case 'manual_adjustment': return 'התאמה ידנית';
    default: return sourceType || 'תנועה';
  }
}

function getBatchStatusLabel(status) {
  switch (status) {
    case 'draft': return 'טיוטה';
    case 'issued':
    case 'submitted': return 'נשלחה';
    case 'acknowledged': return 'אושרה קבלה';
    case 'partially_paid': return 'שולמה חלקית';
    case 'paid': return 'שולמה';
    case 'disputed': return 'במחלוקת';
    case 'closed': return 'סגורה';
    case 'cancelled': return 'בוטלה';
    default: return status || 'לא ידוע';
  }
}

function getBatchStatusClass(status) {
  switch (status) {
    case 'draft': return 'border-slate-200 bg-slate-50 text-slate-700';
    case 'issued':
    case 'submitted': return 'border-amber-200 bg-amber-50 text-amber-800';
    case 'acknowledged': return 'border-blue-200 bg-blue-50 text-blue-800';
    case 'partially_paid': return 'border-indigo-200 bg-indigo-50 text-indigo-800';
    case 'paid': return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    case 'disputed': return 'border-red-200 bg-red-50 text-red-800';
    case 'closed': return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    case 'cancelled': return 'border-slate-200 bg-slate-100 text-slate-400';
    default: return 'border-slate-200 bg-slate-50 text-slate-700';
  }
}

function BatchMetaTags({ externalReference = '', externalLink = '', notes = '' }) {
  const hasRef = Boolean(String(externalReference || '').trim());
  const hasLink = Boolean(String(externalLink || '').trim());
  const hasNotes = Boolean(String(notes || '').trim());
  if (!hasRef && !hasLink && !hasNotes) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {hasRef ? (
        <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
          אסמכתא: {externalReference}
        </span>
      ) : null}
      {hasLink ? (
        <a
          href={externalLink}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700 hover:bg-sky-100"
        >
          קישור חיצוני
        </a>
      ) : null}
      {hasNotes ? (
        <span
          className="inline-flex max-w-full items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700"
          title={notes}
        >
          הערה: {notes}
        </span>
      ) : null}
    </div>
  );
}

function showHmoBillingError(error, options = {}) {
  const feedback = getHmoClaimFeedback(error, options);
  toast.error(feedback.title, { description: feedback.description, duration: 7000 });
}

function showHmoBillingValidation(kind) {
  const feedback = getHmoClaimValidationFeedback(kind);
  toast.error(feedback.title, { description: feedback.description, duration: 7000 });
}

function buildBatchForm() {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';
  return {
    periodStart: monthStart,
    periodEnd: today,
    externalReference: '',
    externalLink: '',
    notes: '',
  };
}

function buildPaymentForm() {
  return {
    amount: '',
    effectiveAt: new Date().toISOString().slice(0, 10),
    externalReference: '',
    notes: '',
  };
}

export default function HmoProviderBillingWorkspace({ providerId = '' }) {
  const { session } = useAuth();
  const { activeOrgId, activeOrg } = useOrg();
  const { providers, loadingProviders } = useMedicalProviders();

  const membershipRole = activeOrg?.membership?.role || '';
  const canMutate = isAdminRole(membershipRole);

  const [selectedProviderId, setSelectedProviderId] = useState(providerId);
  const [periodStart, setPeriodStart] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return today.slice(0, 8) + '01';
  });
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snapshot, setSnapshot] = useState(null);

  const [createBatchOpen, setCreateBatchOpen] = useState(false);
  const [batchForm, setBatchForm] = useState(() => buildBatchForm());

  const [paymentTarget, setPaymentTarget] = useState(null);
  const [paymentForm, setPaymentForm] = useState(() => buildPaymentForm());
  const [confirmPayment, setConfirmPayment] = useState(null);

  const activeProviders = useMemo(
    () => providers.filter((p) => p.is_active !== false),
    [providers],
  );

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId) || null,
    [providers, selectedProviderId],
  );

  const loadSnapshot = useCallback(async () => {
    if (!activeOrgId || !session || !selectedProviderId) return;
    setLoading(true);
    try {
      const payload = await authenticatedFetch('billing', {
        session,
        params: {
          org_id: activeOrgId,
          hmo_provider_id: selectedProviderId,
          start_date: periodStart || undefined,
          end_date: periodEnd || undefined,
        },
      });
      setSnapshot(payload || null);
    } catch (error) {
      console.error('Failed to load HMO provider billing snapshot', error);
      toast.error(error?.message || 'טעינת נתוני הגורם המממן נכשלה.');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, session, selectedProviderId, periodStart, periodEnd]);

  useEffect(() => {
    if (selectedProviderId) void loadSnapshot();
    else setSnapshot(null);
  }, [selectedProviderId, loadSnapshot]);

  async function handleCreateBatch() {
    if (!activeOrgId || !selectedProviderId || !canMutate) return;
    setSaving(true);
    try {
      const result = await authenticatedFetch('billing', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          action: 'create_hmo_invoice_batch',
          hmo_provider_id: selectedProviderId,
          period_start: batchForm.periodStart || null,
          period_end: batchForm.periodEnd || null,
          external_reference: batchForm.externalReference || null,
          external_link: batchForm.externalLink || null,
          notes: batchForm.notes || null,
        },
      });
      setBatchForm(buildBatchForm());
      setCreateBatchOpen(false);
      await loadSnapshot();
      const total = formatCurrency(result?.totalAmount);
      const count = result?.ledgerTransactionIds?.length ?? 0;
      toast.success(`טיוטת דרישה נוצרה: ${total} עבור ${count} תנועות.`);
    } catch (error) {
      console.error('Failed to create HMO invoice batch', error);
      showHmoBillingError(error, { scope: 'claim' });
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitBatch(batch) {
    if (!activeOrgId || !batch?.id || !canMutate) return;
    setSaving(true);
    try {
      await authenticatedFetch('billing', {
        session,
        method: 'POST',
        body: { org_id: activeOrgId, action: 'submit_hmo_claim_batch', batch_id: batch.id },
      });
      await loadSnapshot();
      toast.success('הדרישה סומנה כנשלחה.');
    } catch (error) {
      console.error('Failed to submit HMO invoice batch', error);
      showHmoBillingError(error, { scope: 'submit' });
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelBatch(batch) {
    if (!activeOrgId || !batch?.id || !canMutate) return;
    const approved = window.confirm('לבטל את הדרישה? השורות יחזרו להיות זמינות ליצירת דרישה חדשה.');
    if (!approved) return;
    setSaving(true);
    try {
      await authenticatedFetch('billing', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          action: 'cancel_hmo_claim_batch',
          batch_id: batch.id,
          reason: 'cancelled_from_provider_billing_workspace',
        },
      });
      await loadSnapshot();
      toast.success('הדרישה בוטלה.');
    } catch (error) {
      console.error('Failed to cancel HMO invoice batch', error);
      showHmoBillingError(error, { scope: 'cancel' });
    } finally {
      setSaving(false);
    }
  }

  function handleOpenPayment(batch) {
    setPaymentTarget({
      batchId: batch.id,
      totalAmount: batch.total_amount,
      paidAmount: batch.paid_amount,
      providerName: selectedProvider?.name || 'גורם מממן',
    });
    setPaymentForm(buildPaymentForm());
  }

  function handleConfirmPayment() {
    if (!isValidCurrencyInput(paymentForm.amount)) {
      showHmoBillingValidation('invalid_payment_amount');
      return;
    }
    const remaining = Math.max(
      0,
      coerceAgorot(paymentTarget?.totalAmount) - coerceAgorot(paymentTarget?.paidAmount),
    );
    const amount = toAgorot(paymentForm.amount);
    if (amount > remaining) {
      showHmoBillingValidation('payment_above_balance');
      return;
    }
    setConfirmPayment({
      type: 'credit',
      amount,
      accountName: paymentTarget?.providerName || 'גורם מממן',
      effectiveAt: paymentForm.effectiveAt,
      notes: paymentForm.notes,
      _formData: { ...paymentForm },
      _batchId: paymentTarget?.batchId,
    });
  }

  async function executePayment() {
    if (!activeOrgId || !confirmPayment || !canMutate) return;
    const formData = confirmPayment._formData;
    setSaving(true);
    try {
      await authenticatedFetch('billing', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          action: 'record_hmo_invoice_batch_payment',
          batch_id: confirmPayment._batchId,
          amount: confirmPayment.amount,
          effective_at: formData.effectiveAt || null,
          external_reference: formData.externalReference || null,
          notes: formData.notes || null,
        },
      });
      setConfirmPayment(null);
      setPaymentTarget(null);
      setPaymentForm(buildPaymentForm());
      await loadSnapshot();
      toast.success(`תשלום של ${formatCurrency(confirmPayment.amount)} נרשם.`);
    } catch (error) {
      console.error('Failed to record HMO invoice batch payment', error);
      showHmoBillingError(error, { scope: 'payment' });
    } finally {
      setSaving(false);
    }
  }

  const summary = snapshot?.summary || {};
  const ledgerEntries = useMemo(
    () => (Array.isArray(snapshot?.ledger_entries) ? snapshot.ledger_entries : []),
    [snapshot?.ledger_entries],
  );
  const invoiceBatches = Array.isArray(snapshot?.invoice_batches) ? snapshot.invoice_batches : [];
  const ledgerIndexById = useMemo(
    () => new Map(ledgerEntries.map((entry, index) => [entry.id, index])),
    [ledgerEntries],
  );
  const ledgerGroups = useMemo(() => groupLedgerEntries(ledgerEntries), [ledgerEntries]);
  const displayedBalances = useMemo(() => {
    let rollingBalance = coerceAgorot(summary.balance);
    return ledgerEntries.map((entry) => {
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
  }, [ledgerEntries, summary.balance]);

  const ledgerRows = useMemo(() => {
    function buildRowFromEntry(entry, index) {
      const direction = String(entry?.direction || '').toUpperCase();
      const isReversal = entry.source_type === 'reversal';
      return {
        key: entry.id,
        date: formatDateTime(entry.effective_at || entry.posted_at),
        primaryText: getEntryTypeLabel(entry.source_type),
        detailLines: [
          entry.notes || '',
          entry.external_reference ? `אסמכתא: ${entry.external_reference}` : '',
          isReversal && entry.reverses_transaction_id ? `היפוך של תנועה #${shortId(entry.reverses_transaction_id)}` : '',
        ].filter(Boolean),
        statusBadges: [{
          label: direction === 'CREDIT' ? 'זיכוי' : 'חיוב',
          className: direction === 'CREDIT'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-red-200 bg-red-50 text-red-700',
        }],
        debit: direction === 'DEBIT' ? formatCurrency(entry.amount) : '—',
        credit: direction === 'CREDIT' ? formatCurrency(entry.amount) : '—',
        balance: formatCurrency(displayedBalances[index] || 0),
        actions: [{
          label: 'העתק מזהה תנועה',
          icon: <Copy className="h-4 w-4" />,
          onSelect: () => {
            navigator.clipboard.writeText(entry.id);
            toast.success('מזהה תנועה הועתק');
          },
        }],
      };
    }

    return ledgerGroups.map((group) => {
      if (group.kind !== 'reversal_pair') {
        const entry = group.entry;
        const index = ledgerIndexById.get(entry.id) || 0;
        return buildRowFromEntry(entry, index);
      }

      const original = group.originalEntry;
      const reversal = group.reversalEntry;
      const originalIndex = ledgerIndexById.get(original.id) || 0;
      const pairEntries = [original, reversal];
      const totalDebit = sumByDirection(pairEntries, 'DEBIT');
      const totalCredit = sumByDirection(pairEntries, 'CREDIT');
      const netImpact = totalDebit - totalCredit;

      return {
        key: group.key,
        date: formatDateTime(original.effective_at || original.posted_at),
        primaryText: `${getEntryTypeLabel(original.source_type)} • בוצע היפוך`,
        detailLines: [
          `תנועה מקורית #${shortId(original.id)}`,
          `תנועת היפוך #${shortId(reversal.id)}`,
          reversal.notes ? `סיבת היפוך: ${reversal.notes}` : '',
        ].filter(Boolean),
        statusBadges: [
          {
            label: 'צמד היפוך',
            className: 'border-amber-200 bg-amber-50 text-amber-800',
          },
          {
            label: netImpact === 0 ? 'השפעה נטו: 0' : `השפעה נטו: ${formatCurrency(netImpact)}`,
            className: 'border-slate-200 bg-slate-50 text-slate-700',
          },
        ],
        debit: totalDebit > 0 ? formatCurrency(totalDebit) : '—',
        credit: totalCredit > 0 ? formatCurrency(totalCredit) : '—',
        balance: formatCurrency(displayedBalances[originalIndex] || 0),
        childRows: [
          buildRowFromEntry(original, originalIndex),
          buildRowFromEntry(reversal, ledgerIndexById.get(reversal.id) || originalIndex),
        ],
        actions: [{
          label: 'העתק מזהה תנועה מקורית',
          icon: <Copy className="h-4 w-4" />,
          onSelect: () => {
            navigator.clipboard.writeText(original.id);
            toast.success('מזהה תנועה הועתק');
          },
        }],
      };
    });
  }, [displayedBalances, ledgerGroups, ledgerIndexById]);

  const balanceAgorot = coerceAgorot(summary.balance);
  const balanceIsPositive = balanceAgorot > 0;
  const balanceIsNegative = balanceAgorot < 0;

  return (
    <TooltipProvider>
      <div className="space-y-5">
        <ConfirmLedgerEntryDialog
          open={Boolean(confirmPayment)}
          onOpenChange={(open) => { if (!open) setConfirmPayment(null); }}
          onConfirm={executePayment}
          saving={saving}
          entry={confirmPayment}
        />

        {/* ── Create batch dialog ── */}
        <Dialog open={createBatchOpen} onOpenChange={(open) => { if (!saving) setCreateBatchOpen(open); }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>צור טיוטת דרישה</DialogTitle>
              <DialogDescription>
                יוצר טיוטה עבור כל חיובי השיעורים שטרם שויכו לדרישה בתקופה הנבחרת.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>מ-תאריך</Label>
                  <Input
                    type="date"
                    value={batchForm.periodStart}
                    onChange={(e) => setBatchForm((f) => ({ ...f, periodStart: e.target.value }))}
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label>עד-תאריך</Label>
                  <Input
                    type="date"
                    value={batchForm.periodEnd}
                    onChange={(e) => setBatchForm((f) => ({ ...f, periodEnd: e.target.value }))}
                    disabled={saving}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>אסמכתא חיצונית</Label>
                  <Input
                    value={batchForm.externalReference}
                    onChange={(e) => setBatchForm((f) => ({ ...f, externalReference: e.target.value }))}
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label>קישור חיצוני</Label>
                  <Input
                    dir="ltr"
                    type="url"
                    placeholder="https://"
                    value={batchForm.externalLink}
                    onChange={(e) => setBatchForm((f) => ({ ...f, externalLink: e.target.value }))}
                    disabled={saving}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>הערות</Label>
                <Input
                  value={batchForm.notes}
                  onChange={(e) => setBatchForm((f) => ({ ...f, notes: e.target.value }))}
                  disabled={saving}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateBatchOpen(false)} disabled={saving}>
                ביטול
              </Button>
              <Button onClick={handleCreateBatch} disabled={saving}>
                {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                צור טיוטה
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Record payment dialog ── */}
        <Dialog
          open={Boolean(paymentTarget)}
          onOpenChange={(open) => { if (!open && !saving) setPaymentTarget(null); }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>רשום תשלום</DialogTitle>
              {paymentTarget ? (
                <DialogDescription>
                  {paymentTarget.providerName}
                  {' • '}
                  נותר לתשלום:{' '}
                  {formatCurrency(
                    Math.max(0, coerceAgorot(paymentTarget.totalAmount) - coerceAgorot(paymentTarget.paidAmount)),
                  )}
                </DialogDescription>
              ) : null}
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>סכום</Label>
                  <CurrencyInput
                    value={paymentForm.amount}
                    onChange={(value) => setPaymentForm((f) => ({ ...f, amount: value }))}
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label>תאריך תשלום</Label>
                  <Input
                    type="date"
                    value={paymentForm.effectiveAt}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, effectiveAt: e.target.value }))}
                    disabled={saving}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>אסמכתא</Label>
                <Input
                  value={paymentForm.externalReference}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, externalReference: e.target.value }))}
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label>הערות</Label>
                <Input
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
                  disabled={saving}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPaymentTarget(null)} disabled={saving}>
                ביטול
              </Button>
              <Button onClick={handleConfirmPayment} disabled={saving}>
                {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                המשך
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Provider selector (standalone / no pre-selected provider) ── */}
        {!providerId ? (
          <div className="grid gap-3 items-end md:grid-cols-3">
            <div className="space-y-2">
              <Label>גורם מממן</Label>
              {loadingProviders ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> טוען...
                </div>
              ) : (
                <Select
                  value={selectedProviderId || '__none__'}
                  onValueChange={(value) => setSelectedProviderId(value === '__none__' ? '' : value)}
                >
                  <SelectTrigger><SelectValue placeholder="בחר גורם מממן" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">בחר גורם מממן</SelectItem>
                    {activeProviders.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <Label>מ-תאריך</Label>
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>עד-תאריך</Label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
          </div>
        ) : null}

        {!selectedProviderId ? (
          providerId ? null : (
            <div className="rounded-xl border border-dashed border-border bg-slate-50 p-8 text-center text-sm text-muted-foreground">
              בחר גורם מממן כדי לצפות בחשבון שלו.
            </div>
          )
        ) : (
          <div className="space-y-5">

            {/* ── Toolbar: period filter + refresh + create ── */}
            {providerId ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5 flex-1 min-w-[110px]">
                  <Label className="text-xs text-muted-foreground">מ-תאריך</Label>
                  <Input
                    type="date"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5 flex-1 min-w-[110px]">
                  <Label className="text-xs text-muted-foreground">עד-תאריך</Label>
                  <Input
                    type="date"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 shrink-0 p-0"
                  onClick={loadSnapshot}
                  disabled={loading}
                  aria-label="רענן"
                >
                  {loading
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RefreshCw className="h-3.5 w-3.5" />}
                </Button>
                {canMutate ? (
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 gap-1.5 shrink-0"
                    onClick={() => setCreateBatchOpen(true)}
                    disabled={saving || loading}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    צור דרישה
                  </Button>
                ) : null}
              </div>
            ) : null}

            {/* ── Summary metrics ── */}
            {snapshot ? (
              <div className="flex flex-wrap gap-3">
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 min-w-[120px]">
                  <div className="text-[11px] font-medium text-blue-600">חשבון לגביה</div>
                  <div className="mt-0.5 text-base font-bold text-blue-950">
                    {formatCurrency(summary.receivable_total)}
                  </div>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 min-w-[120px]">
                  <div className="text-[11px] font-medium text-emerald-600">שולם</div>
                  <div className="mt-0.5 text-base font-bold text-emerald-950">
                    {formatCurrency(summary.payment_total)}
                  </div>
                </div>
                <div className={[
                  'rounded-lg border px-4 py-2.5 min-w-[120px]',
                  balanceIsPositive ? 'border-emerald-200 bg-emerald-50'
                    : balanceIsNegative ? 'border-amber-200 bg-amber-50'
                      : 'border-slate-200 bg-slate-50',
                ].join(' ')}>
                  <div className="flex items-center gap-1">
                    <span className={`text-[11px] font-medium ${balanceIsPositive ? 'text-emerald-600' : balanceIsNegative ? 'text-amber-600' : 'text-slate-500'}`}>
                      יתרת חשבון
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3 w-3 cursor-help text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs text-xs">
                        יתרה חיובית = כסף שהגורם המממן חייב למכון. יתרה שלילית = המכון חייב לגורם המממן.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className={`mt-0.5 text-base font-bold ${balanceIsPositive ? 'text-emerald-900' : balanceIsNegative ? 'text-amber-900' : 'text-slate-800'}`}>
                    {formatCurrency(summary.balance)}
                  </div>
                </div>
              </div>
            ) : null}

            {/* ── Invoice batches ── */}
            <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
              <div className="h-1 bg-indigo-500" />
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-900">דרישות</h4>
                    <p className="text-xs text-muted-foreground">היתרה זזה רק עם רישום תשלום.</p>
                  </div>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
                </div>

                <div className="space-y-2.5">
                  {invoiceBatches.map((batch) => {
                    const remainingAmount = Math.max(
                      0,
                      coerceAgorot(batch.total_amount) - coerceAgorot(batch.paid_amount),
                    );
                    const canPay = canMutate
                      && ['issued', 'submitted', 'acknowledged', 'partially_paid'].includes(batch.status)
                      && remainingAmount > 0;
                    const canCancel = canMutate
                      && ['draft', 'issued', 'submitted', 'acknowledged'].includes(batch.status)
                      && coerceAgorot(batch.paid_amount) === 0;
                    const isCancelled = batch.status === 'cancelled';

                    return (
                      <div
                        key={batch.id}
                        className={[
                          'rounded-xl border p-4 space-y-2.5',
                          isCancelled
                            ? 'border-border bg-slate-50/60 opacity-60'
                            : 'border-border bg-white',
                        ].join(' ')}
                      >
                        {/* Status + date range + actions */}
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className={getBatchStatusClass(batch.status)}>
                              {getBatchStatusLabel(batch.status)}
                            </Badge>
                            <span className="text-sm font-medium text-zinc-800">
                              {formatDate(batch.period_start)} – {formatDate(batch.period_end)}
                            </span>
                          </div>
                          {!isCancelled ? (
                            <div className="flex gap-2 flex-wrap shrink-0">
                              {batch.status === 'draft' ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => handleSubmitBatch(batch)}
                                  disabled={saving}
                                >
                                  סמן כנשלח
                                </Button>
                              ) : null}
                              {canPay ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleOpenPayment(batch)}
                                  disabled={saving}
                                >
                                  רשום תשלום
                                </Button>
                              ) : null}
                              {canCancel ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="text-muted-foreground hover:text-destructive"
                                  onClick={() => handleCancelBatch(batch)}
                                  disabled={saving}
                                >
                                  בטל
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>

                        {/* Amounts */}
                        <div className="flex flex-wrap gap-4 text-xs">
                          <span className="text-muted-foreground">
                            סה&quot;כ{' '}
                            <span className="font-semibold text-zinc-900">
                              {formatCurrency(batch.total_amount)}
                            </span>
                          </span>
                          <span className="text-muted-foreground">
                            שולם{' '}
                            <span className="font-semibold text-zinc-900">
                              {formatCurrency(batch.paid_amount)}
                            </span>
                          </span>
                          {remainingAmount > 0 ? (
                            <span className="text-muted-foreground">
                              נותר{' '}
                              <span className="font-semibold text-amber-700">
                                {formatCurrency(remainingAmount)}
                              </span>
                            </span>
                          ) : null}
                        </div>

                        {/* Meta tags */}
                        <BatchMetaTags
                          externalReference={batch.external_reference}
                          externalLink={batch.external_link}
                          notes={batch.notes}
                        />
                      </div>
                    );
                  })}

                  {!loading && invoiceBatches.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-muted-foreground">
                      עדיין לא נוצרו דרישות לגורם מממן זה.
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            {/* ── Ledger entries ── */}
            <LedgerEntriesTable
              title="פנקס תנועות"
              description={`${selectedProvider?.name || 'גורם מממן'} • כל תנועות הלדר בתקופה הנבחרת.`}
              rows={ledgerRows}
              emptyLabel="אין תנועות להצגה בטווח הנבחר."
            />
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
