import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Info, Loader2 } from 'lucide-react';
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
import CurrencyInput from '@/components/ui/CurrencyInput.jsx';
import ConfirmLedgerEntryDialog from '@/components/ui/ConfirmLedgerEntryDialog.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { useMedicalProviders } from '@/features/students/hooks/useMedicalProviders.js';
import { isAdminRole } from '@/features/students/utils/endpoints.js';
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

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(value));
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
    case 'issued': return 'הופקה';
    case 'partially_paid': return 'שולמה חלקית';
    case 'paid': return 'שולמה';
    case 'cancelled': return 'בוטלה';
    default: return status || 'לא ידוע';
  }
}

function getBatchStatusClass(status) {
  switch (status) {
    case 'draft': return 'border-slate-200 bg-slate-50 text-slate-700';
    case 'issued': return 'border-amber-200 bg-amber-50 text-amber-800';
    case 'partially_paid': return 'border-indigo-200 bg-indigo-50 text-indigo-800';
    case 'paid': return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    case 'cancelled': return 'border-slate-200 bg-slate-100 text-slate-500';
    default: return 'border-slate-200 bg-slate-50 text-slate-700';
  }
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

export default function HmoProviderBillingWorkspace() {
  const { session } = useAuth();
  const { activeOrgId, activeOrg } = useOrg();
  const { providers, loadingProviders } = useMedicalProviders();

  const membershipRole = activeOrg?.membership?.role || '';
  const canMutate = isAdminRole(membershipRole);

  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [periodStart, setPeriodStart] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return today.slice(0, 8) + '01';
  });
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snapshot, setSnapshot] = useState(null);

  const [batchForm, setBatchForm] = useState(() => buildBatchForm());
  const [showBatchForm, setShowBatchForm] = useState(false);

  const [paymentTarget, setPaymentTarget] = useState(null); // { batchId, providerName }
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
    if (selectedProviderId) {
      void loadSnapshot();
    } else {
      setSnapshot(null);
    }
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
      setShowBatchForm(false);
      await loadSnapshot();
      const total = formatCurrency(result?.totalAmount);
      const count = result?.ledgerTransactionIds?.length ?? 0;
      toast.success(`חשבונית נוצרה: ${total} עבור ${count} תנועות.`);
    } catch (error) {
      console.error('Failed to create HMO invoice batch', error);
      toast.error(error?.message || 'יצירת החשבונית נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  function handleOpenPayment(batch) {
    setPaymentTarget({ batchId: batch.id, providerName: selectedProvider?.name || 'גורם מממן' });
    setPaymentForm(buildPaymentForm());
  }

  function handleConfirmPayment() {
    if (!isValidCurrencyInput(paymentForm.amount)) {
      toast.error('יש להזין סכום חוקי.');
      return;
    }
    setConfirmPayment({
      type: 'credit',
      amount: toAgorot(paymentForm.amount),
      accountName: selectedProvider?.name || 'גורם מממן',
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
      toast.error(error?.message || 'רישום התשלום נכשל.');
    } finally {
      setSaving(false);
    }
  }

  const summary = snapshot?.summary || {};
  const ledgerEntries = Array.isArray(snapshot?.ledger_entries) ? snapshot.ledger_entries : [];
  const invoiceBatches = Array.isArray(snapshot?.invoice_batches) ? snapshot.invoice_batches : [];

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

        <div className="rounded-xl border border-border bg-slate-50 p-4">
          <h3 className="text-base font-semibold text-zinc-900">חיובי גורמים מממנים</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            צפייה בחשבון הלדר של הגורם המממן, הפקת חשבוניות ורישום תשלומים.
          </p>
        </div>

        {/* ── Provider selector ── */}
        <div className="grid gap-3 md:grid-cols-3 items-end">
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

        {selectedProviderId ? (
          <Button type="button" variant="outline" onClick={loadSnapshot} disabled={loading}>
            {loading ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
            טען נתונים
          </Button>
        ) : null}

        {!selectedProviderId ? (
          <div className="rounded-xl border border-dashed border-border bg-slate-50 p-8 text-center text-sm text-muted-foreground">
            בחר גורם מממן כדי לצפות בחשבון שלו.
          </div>
        ) : loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> טוען...
          </div>
        ) : (
          <div className="space-y-5">
            {/* ── Summary cards ── */}
            <section className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                <div className="text-xs text-blue-700">חשבון לגביה</div>
                <div className="mt-1 text-xl font-bold text-blue-950">{formatCurrency(summary.receivable_total)}</div>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="text-xs text-emerald-700">תשלומים שהתקבלו</div>
                <div className="mt-1 text-xl font-bold text-emerald-950">{formatCurrency(summary.payment_total)}</div>
              </div>
              <div className={['rounded-xl border p-4', balanceIsPositive ? 'border-emerald-200 bg-emerald-50' : balanceIsNegative ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'].join(' ')}>
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs font-medium ${balanceIsPositive ? 'text-emerald-700' : balanceIsNegative ? 'text-amber-700' : 'text-slate-600'}`}>יתרת חשבון</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 cursor-help text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs">
                      יתרה חיובית = כסף שהגורם המממן חייב למכון (חוב פתוח). יתרה שלילית = המכון חייב לגורם המממן.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className={`mt-1 text-xl font-bold ${balanceIsPositive ? 'text-emerald-900' : balanceIsNegative ? 'text-amber-900' : 'text-slate-800'}`}>
                  {formatCurrency(summary.balance)}
                </div>
              </div>
            </section>

            {/* ── Invoice batches ── */}
            <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
              <div className="h-1.5 bg-indigo-500" />
              <div className="p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-lg font-semibold text-zinc-900">חשבוניות</h4>
                    <p className="text-sm text-muted-foreground">חשבוניות הם מטא-דאטה בלבד — היתרה זזה רק עם רישום תשלום.</p>
                  </div>
                  {canMutate ? (
                    <Button type="button" variant="outline" onClick={() => setShowBatchForm((v) => !v)} disabled={saving}>
                      {showBatchForm ? 'סגור' : 'צור חשבונית חדשה'}
                    </Button>
                  ) : null}
                </div>

                {/* Create batch form */}
                {showBatchForm && canMutate ? (
                  <div className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
                    <p className="text-sm text-muted-foreground">
                      יוצר חשבונית עבור כל חיובי השיעורים שטרם שויכו לחשבונית בתקופה הנבחרת.
                    </p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>מ-תאריך</Label>
                        <Input type="date" value={batchForm.periodStart} onChange={(e) => setBatchForm((f) => ({ ...f, periodStart: e.target.value }))} />
                      </div>
                      <div className="space-y-2">
                        <Label>עד-תאריך</Label>
                        <Input type="date" value={batchForm.periodEnd} onChange={(e) => setBatchForm((f) => ({ ...f, periodEnd: e.target.value }))} />
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>מספר חשבונית / אסמכתא</Label>
                        <Input value={batchForm.externalReference} onChange={(e) => setBatchForm((f) => ({ ...f, externalReference: e.target.value }))} />
                      </div>
                      <div className="space-y-2">
                        <Label>קישור לחשבונית</Label>
                        <Input dir="ltr" type="url" placeholder="https://" value={batchForm.externalLink} onChange={(e) => setBatchForm((f) => ({ ...f, externalLink: e.target.value }))} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>הערות</Label>
                      <Input value={batchForm.notes} onChange={(e) => setBatchForm((f) => ({ ...f, notes: e.target.value }))} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" onClick={handleCreateBatch} disabled={saving}>
                        {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                        צור חשבונית
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setShowBatchForm(false)} disabled={saving}>ביטול</Button>
                    </div>
                  </div>
                ) : null}

                {/* Batch list */}
                <div className="space-y-3">
                  {invoiceBatches.map((batch) => {
                    const isOpen = paymentTarget?.batchId === batch.id;
                    const canPay = canMutate && !['paid', 'cancelled'].includes(batch.status);
                    return (
                      <div key={batch.id} className="rounded-xl border border-border bg-slate-50/70 p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-zinc-900">
                                {formatDate(batch.period_start)} – {formatDate(batch.period_end)}
                              </span>
                              <Badge variant="outline" className={getBatchStatusClass(batch.status)}>
                                {getBatchStatusLabel(batch.status)}
                              </Badge>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              סה&quot;כ {formatCurrency(batch.total_amount)} • שולם {formatCurrency(batch.paid_amount)}
                              {batch.external_reference ? ` • ${batch.external_reference}` : ''}
                            </div>
                          </div>
                          {canPay ? (
                            <Button type="button" size="sm" variant="outline" onClick={() => handleOpenPayment(batch)} disabled={saving}>
                              רשום תשלום
                            </Button>
                          ) : null}
                        </div>

                        {/* Inline payment form */}
                        {isOpen ? (
                          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
                            <div className="grid gap-3 md:grid-cols-3">
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
                                <Input type="date" value={paymentForm.effectiveAt} onChange={(e) => setPaymentForm((f) => ({ ...f, effectiveAt: e.target.value }))} disabled={saving} />
                              </div>
                              <div className="space-y-2">
                                <Label>אסמכתא</Label>
                                <Input value={paymentForm.externalReference} onChange={(e) => setPaymentForm((f) => ({ ...f, externalReference: e.target.value }))} disabled={saving} />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label>הערות</Label>
                              <Input value={paymentForm.notes} onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))} disabled={saving} />
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" onClick={handleConfirmPayment} disabled={saving}>
                                {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                                רשום תשלום
                              </Button>
                              <Button type="button" variant="outline" onClick={() => setPaymentTarget(null)} disabled={saving}>ביטול</Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {invoiceBatches.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-muted-foreground">
                      עדיין לא הופקו חשבוניות לגורם מממן זה.
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            {/* ── Ledger entries ── */}
            <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
              <div className="h-1.5 bg-violet-500" />
              <div className="p-5 space-y-4">
                <div>
                  <h4 className="text-lg font-semibold text-zinc-900">פנקס תנועות</h4>
                  <p className="text-sm text-muted-foreground">{selectedProvider?.name} • כל תנועות הלדר בתקופה הנבחרת.</p>
                </div>
                <div className="space-y-3">
                  {ledgerEntries.map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-border bg-slate-50/70 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-zinc-900">
                            {getEntryTypeLabel(entry.source_type)} • {entry.direction === 'CREDIT' ? '+' : '-'}{formatCurrency(entry.amount)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {formatDateTime(entry.effective_at || entry.posted_at)}
                            {entry.notes ? ` • ${entry.notes}` : ''}
                            {entry.external_reference ? ` • ${entry.external_reference}` : ''}
                          </div>
                        </div>
                        <Badge variant="outline" className={entry.direction === 'CREDIT' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}>
                          {entry.direction === 'CREDIT' ? 'זיכוי' : 'חיוב'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                  {ledgerEntries.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-muted-foreground">
                      אין תנועות להצגה בטווח הנבחר.
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
