import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import CurrencyInput from '@/components/ui/CurrencyInput.jsx';
import ConfirmLedgerEntryDialog from '@/components/ui/ConfirmLedgerEntryDialog.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { useServices } from '@/hooks/useOrgData.js';
import HmoAuthorizationManager from '@/features/students/components/HmoAuthorizationManager.jsx';
import { isAdminOrOffice, isAdminRole, normalizeMembershipRole } from '@/features/students/utils/endpoints.js';
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
      return 'נכח';
    case 'no_show':
      return 'לא הגיע';
    case 'cancelled_student':
      return 'בוטל על ידי תלמיד';
    case 'cancelled_clinic':
      return 'בוטל על ידי המכון';
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
    case 'hmo_invoice_payment':
      return 'תשלום גורם מממן';
    default:
      return entry?.source_type || 'תנועה';
  }
}

function getCoverageBadge(row) {
  switch (row?.coverage_status) {
    case 'covered':
      return { label: 'כיסוי פעיל', className: 'border-indigo-200 bg-indigo-50 text-indigo-900' };
    case 'post_coverage':
      return { label: 'אחרי מיצוי זכאות', className: 'border-amber-200 bg-amber-50 text-amber-900' };
    case 'standard_uncovered':
      return { label: 'ללא כיסוי', className: 'border-slate-200 bg-slate-50 text-slate-700' };
    default:
      return null;
  }
}

function getCoverageReasonLabel(reason) {
  switch (reason) {
    case 'authorization_applies':
      return 'השיעור חויב לפי האישור הפעיל.';
    case 'authorization_exhausted':
      return 'מכסת האישור נוצלה במלואה.';
    case 'no_authorization_found':
      return 'לא נמצא אישור תואם לשירות.';
    case 'no_active_authorization':
      return 'קיימים אישורים לשירות, אבל אף אחד מהם אינו פעיל.';
    case 'no_active_authorization_for_date':
      return 'יש אישור פעיל, אבל טווח התוקף שלו לא מכסה את מועד השיעור.';
    case 'authorization_conflict':
      return 'קיימים שני אישורים חופפים ולכן החיוב נחסם.';
    case 'missing_authorization_pricing':
      return 'האישור חסר מחירי כיסוי מפורשים.';
    case 'missing_post_coverage_policy':
      return 'אחרי מיצוי הזכאות אין מדיניות המשך מלאה.';
    case 'authorization_exhausted_manual_block':
      return 'הזכאות נוצלה במלואה והוגדרה חסימה להחלטה ידנית.';
    default:
      return '';
  }
}

function buildEntryForm() {
  return {
    mode: 'payment',
    amount: '',
    effectiveAt: new Date().toISOString().slice(0, 10),
    notes: '',
    externalReference: '',
    calculatorServiceId: '',
    calculatorLessonCount: '1',
  };
}

function shortId(id) {
  return id ? String(id).slice(-8) : '';
}

export default function StudentBillingWorkspace({
  studentId,
  student = null,
  startDate = '',
  endDate = '',
  onDataChanged = null,
}) {
  const { session } = useAuth();
  const { activeOrg, activeOrgId } = useOrg();
  const { services } = useServices({ enabled: Boolean(activeOrgId), orgId: activeOrgId, session });
  const membershipRole = normalizeMembershipRole(activeOrg?.membership?.role);
  const canViewBilling = isAdminOrOffice(membershipRole);
  const canMutateBilling = isAdminRole(membershipRole);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [entryForm, setEntryForm] = useState(() => buildEntryForm());
  const [confirmEntry, setConfirmEntry] = useState(null);

  const loadData = useCallback(async () => {
    if (!studentId || !activeOrgId || !canViewBilling) return;
    setLoading(true);
    try {
      const payload = await authenticatedFetch('billing', {
        session,
        params: {
          org_id: activeOrgId,
          student_id: studentId,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
        },
      });
      setSnapshot(payload || null);
    } catch (error) {
      console.error('Failed to load student billing workspace', error);
      toast.error(error?.message || 'טעינת נתוני החיוב נכשלה.');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, canViewBilling, endDate, session, startDate, studentId]);

  useEffect(() => {
    if (!canViewBilling) return undefined;
    void loadData();
    return undefined;
  }, [canViewBilling, loadData]);

  async function notifyDataChanged() {
    if (typeof onDataChanged === 'function') {
      await onDataChanged();
    }
  }

  // Step 1: validate and show confirmation dialog — no API call yet.
  function handleAppendEntry() {
    if (!activeOrgId || !studentId || !canMutateBilling) return;

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
      accountName: studentName,
      effectiveAt: entryForm.effectiveAt,
      notes: entryForm.notes,
      _formData: { ...entryForm },
    });
  }

  // Step 2: user confirmed — perform the API call.
  async function executeAppendEntry() {
    if (!activeOrgId || !studentId || !canMutateBilling || !confirmEntry) return;
    const formData = confirmEntry._formData;
    setSaving(true);
    try {
      await authenticatedFetch('billing', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          action: confirmEntry.type === 'debit' ? 'append_manual_debit' : 'append_manual_credit',
          account_type: 'student',
          account_ref_id: studentId,
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
      await notifyDataChanged();
      toast.success(confirmEntry.type === 'debit' ? 'ההתאמה נשמרה.' : 'התשלום נשמר.');
    } catch (error) {
      console.error('Failed to append manual student ledger entry', error);
      toast.error(error?.message || 'שמירת התנועה נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  async function handleReverseEntry(entryId) {
    if (!activeOrgId || !entryId || !canMutateBilling) return;
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
      await notifyDataChanged();
      toast.success('נרשמה פעולת היפוך.');
    } catch (error) {
      console.error('Failed to reverse ledger transaction', error);
      toast.error(error?.message || 'יצירת פעולת ההיפוך נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  const summary = snapshot?.summary || {};
  const ledgerEntries = useMemo(
    () => (Array.isArray(snapshot?.ledger_entries) ? snapshot.ledger_entries : []),
    [snapshot?.ledger_entries],
  );
  const lessonHistory = useMemo(
    () => (Array.isArray(snapshot?.lesson_history) ? snapshot.lesson_history : []),
    [snapshot?.lesson_history],
  );
  const authorizations = useMemo(
    () => (Array.isArray(snapshot?.authorizations) ? snapshot.authorizations : []),
    [snapshot?.authorizations],
  );

  const calculatorServices = useMemo(() => (
    Array.isArray(services)
      ? services
        .filter((service) => service?.is_active !== false)
        .filter((service) => Number.isFinite(Number(service?.default_customer_charge_amount)))
        .sort((left, right) => getServiceName(services, left?.id).localeCompare(getServiceName(services, right?.id), 'he'))
      : []
  ), [services]);

  const selectedCalculatorService = useMemo(
    () => calculatorServices.find((service) => service.id === entryForm.calculatorServiceId) || null,
    [calculatorServices, entryForm.calculatorServiceId],
  );

  const calculatorLessonCount = useMemo(() => {
    const parsed = Number.parseInt(entryForm.calculatorLessonCount, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [entryForm.calculatorLessonCount]);

  const calculatorAmountAgorot = useMemo(() => {
    const serviceRate = Number.isFinite(Number(selectedCalculatorService?.default_customer_charge_amount))
      ? coerceAgorot(selectedCalculatorService.default_customer_charge_amount)
      : null;
    if (!serviceRate || !calculatorLessonCount) {
      return 0;
    }
    return serviceRate * calculatorLessonCount;
  }, [calculatorLessonCount, selectedCalculatorService]);

  const studentName = useMemo(() => {
    const source = snapshot?.student || student;
    return source?.full_name || [source?.first_name, source?.middle_name, source?.last_name].filter(Boolean).join(' ') || 'תלמיד';
  }, [snapshot, student]);

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

  function applyCalculatorAmount() {
    if (!selectedCalculatorService || !calculatorLessonCount || !calculatorAmountAgorot) {
      toast.error('יש לבחור שירות וכמות שיעורים חוקית.');
      return;
    }

    const serviceLabel = getServiceName(services, selectedCalculatorService.id);
    const suggestedNote = `זיכוי ידני לפי ${calculatorLessonCount} שיעורים של ${serviceLabel}`;

    setEntryForm((current) => ({
      ...current,
      amount: (calculatorAmountAgorot / 100).toFixed(2),
      notes: current.notes.trim() ? current.notes : suggestedNote,
    }));
  }

  if (!canViewBilling) {
    return (
      <div className="rounded-xl border border-border bg-white p-6 text-sm text-muted-foreground shadow-sm">
        אין הרשאה לצפייה בחיובים.
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <ConfirmLedgerEntryDialog
          open={Boolean(confirmEntry)}
          onOpenChange={(open) => { if (!open) setConfirmEntry(null); }}
          onConfirm={executeAppendEntry}
          saving={saving}
          entry={confirmEntry}
        />

        {/* ── Summary cards ── */}
        <section className="grid gap-3 md:grid-cols-4">
          {/* Balance card — semantics-aware */}
          <div className={[
            'rounded-xl border p-4',
            balanceIsPositive ? 'border-emerald-200 bg-emerald-50' : balanceIsNegative ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50',
          ].join(' ')}>
            <div className="flex items-center gap-1.5">
              <span className={`text-xs font-medium ${balanceIsPositive ? 'text-emerald-700' : balanceIsNegative ? 'text-amber-700' : 'text-slate-600'}`}>
                יתרה נוכחית
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3 w-3 cursor-help text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs">
                  יתרה חיובית = תשלום מראש. יתרה שלילית = סכום שהתלמיד חייב למכון.
                </TooltipContent>
              </Tooltip>
            </div>
            <div className={`mt-1 text-xl font-bold ${balanceIsPositive ? 'text-emerald-900' : balanceIsNegative ? 'text-amber-900' : 'text-slate-800'}`}>
              {formatCurrency(summary.balance)}
            </div>
            <Badge
              variant="outline"
              className={`mt-2 text-[10px] ${balanceIsPositive ? 'border-emerald-300 bg-emerald-100 text-emerald-800' : balanceIsNegative ? 'border-amber-300 bg-amber-100 text-amber-800' : 'border-slate-300 bg-slate-100 text-slate-600'}`}
            >
              {balanceIsPositive ? 'זיכוי — שולם מראש' : balanceIsNegative ? 'חוב — חייב למכון' : 'מאוזן'}
            </Badge>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-xs text-emerald-700">חיובי שיעורים</div>
            <div className="mt-1 text-xl font-bold text-emerald-950">{formatCurrency(summary.lesson_charge_total)}</div>
          </div>
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
            <div className="text-xs text-indigo-700">חיובי גורם מממן</div>
            <div className="mt-1 text-xl font-bold text-indigo-950">{formatCurrency(summary.hmo_charge_total)}</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-xs text-amber-700">תשלומים ידניים</div>
            <div className="mt-1 text-xl font-bold text-amber-950">{formatCurrency(summary.payment_total)}</div>
          </div>
        </section>

        {/* ── Manual entry form ── */}
        {canMutateBilling ? (
          <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
            <div className="h-1.5 bg-slate-900" />
            <div className="p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-zinc-900">הוספת תנועה ידנית</h3>
                  <p className="text-sm text-muted-foreground">תשלום מגדיל יתרה, התאמה ידנית מקטינה אותה. כל תנועה נרשמת לצמיתות.</p>
                </div>
                <div className="max-w-sm text-xs text-muted-foreground">
                  חיובי שיעורים מתעדכנים אוטומטית כשמשנים נוכחות, שיעור או אישור גורם מממן במקומם הטבעי.
                </div>
              </div>

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
                  <Input type="date" value={entryForm.effectiveAt} onChange={(event) => setEntryForm((current) => ({ ...current, effectiveAt: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>אסמכתא</Label>
                  <Input value={entryForm.externalReference} onChange={(event) => setEntryForm((current) => ({ ...current, externalReference: event.target.value }))} />
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
                  placeholder={entryForm.mode === 'adjustment' ? 'חובה לציין סיבה לחיוב ידני' : ''}
                />
                {entryForm.mode === 'adjustment' ? (
                  <p className="text-xs text-muted-foreground">הסבר לחיוב חובה — הלדר לא ניתן למחיקה.</p>
                ) : null}
              </div>

              {entryForm.mode === 'payment' ? (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-indigo-950">מחשבון זיכוי מהיר לפי שיעורים</h4>
                      <p className="text-xs text-indigo-800">
                        בחרו שירות וכמות שיעורים. המערכת תחשב את הזיכוי לפי מחיר השירות ותעביר אותו לשדה הסכום.
                      </p>
                    </div>
                    <Badge variant="outline" className="border-indigo-200 bg-white text-indigo-900">
                      עדיין נשמר כזיכוי רגיל בלדר
                    </Badge>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <div className="space-y-2 md:col-span-2">
                      <Label>שירות לחישוב</Label>
                      <Select
                        value={entryForm.calculatorServiceId}
                        onValueChange={(value) => setEntryForm((current) => ({ ...current, calculatorServiceId: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="בחירת שירות" />
                        </SelectTrigger>
                        <SelectContent>
                          {calculatorServices.map((service) => (
                            <SelectItem key={service.id} value={service.id}>
                              {getServiceName(services, service.id)} • {formatCurrency(service.default_customer_charge_amount)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>כמות שיעורים</Label>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        value={entryForm.calculatorLessonCount}
                        onChange={(event) => setEntryForm((current) => ({ ...current, calculatorLessonCount: event.target.value }))}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>זיכוי מחושב</Label>
                      <div className="flex h-10 items-center rounded-md border border-indigo-200 bg-white px-3 text-sm font-semibold text-indigo-950">
                        {calculatorAmountAgorot > 0 ? formatCurrency(calculatorAmountAgorot) : '—'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-indigo-900">
                      {selectedCalculatorService ? (
                        <>
                          מחיר שירות: {formatCurrency(selectedCalculatorService.default_customer_charge_amount)} לכל שיעור
                        </>
                      ) : 'יש לבחור שירות פעיל עם מחיר מוגדר.'}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="border-indigo-300 bg-white text-indigo-950 hover:bg-indigo-100"
                      onClick={applyCalculatorAmount}
                      disabled={!selectedCalculatorService || calculatorLessonCount <= 0 || saving}
                    >
                      העבר לסכום
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleAppendEntry} disabled={saving}>
                  {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                  שמור תנועה
                </Button>
                <Button type="button" variant="outline" onClick={() => setEntryForm(buildEntryForm())} disabled={saving}>
                  נקה
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        {/* ── HMO Authorizations ── */}
        <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="h-1.5 bg-indigo-500" />
          <div className="p-5">
            <HmoAuthorizationManager
              studentId={studentId}
              services={services}
              canMutateBilling={canMutateBilling}
              onChanged={loadData}
              embedded={false}
            />
          </div>
        </section>

        {/* ── Ledger entries ── */}
        <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="h-1.5 bg-violet-500" />
          <div className="p-5 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-zinc-900">פנקס תנועות</h3>
              <p className="text-sm text-muted-foreground">{studentName} • הלדר הוא מקור האמת היחיד — תנועות לא נמחקות, רק מהופכות.</p>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                טוען תנועות...
              </div>
            ) : (
              <div className="space-y-3">
                {ledgerEntries.map((entry) => {
                  const isReversed = reversalMap.has(entry.id);
                  const isReversal = entry.source_type === 'reversal';
                  const coverageBadge = getCoverageBadge(entry?.metadata || {});
                  const coverageReasonLabel = getCoverageReasonLabel(entry?.metadata?.coverage_reason);
                  return (
                    <div
                      key={entry.id}
                      className={[
                        'rounded-xl border border-border bg-slate-50/70 p-4',
                        isReversed ? 'opacity-55' : '',
                      ].join(' ')}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-zinc-900">
                              {getEntryTypeLabel(entry)} • {entry.direction === 'CREDIT' ? '+' : '-'}{formatCurrency(entry.amount)}
                            </span>
                            {isReversed ? (
                              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800 text-[10px]">
                                הופך
                              </Badge>
                            ) : null}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {formatDateTime(entry.effective_at || entry.posted_at)}
                            {entry.notes ? ` • ${entry.notes}` : ''}
                            {entry.external_reference ? ` • ${entry.external_reference}` : ''}
                          </div>
                          {coverageReasonLabel ? (
                            <div className="mt-0.5 text-xs text-muted-foreground">{coverageReasonLabel}</div>
                          ) : null}
                          {isReversal && entry.reverses_transaction_id ? (
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              היפוך של תנועה #{shortId(entry.reverses_transaction_id)}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={entry.direction === 'CREDIT' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}>
                            {entry.direction === 'CREDIT' ? 'זיכוי' : 'חיוב'}
                          </Badge>
                          {coverageBadge ? (
                            <Badge variant="outline" className={coverageBadge.className}>
                              {coverageBadge.label}
                            </Badge>
                          ) : null}
                          {canMutateBilling && !isReversed && ['manual_payment', 'manual_adjustment', 'lesson_charge'].includes(entry.source_type) ? (
                            <Button type="button" size="sm" variant="outline" onClick={() => handleReverseEntry(entry.id)} disabled={saving}>
                              היפוך
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {ledgerEntries.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-muted-foreground">
                    אין תנועות להצגה בטווח הנבחר.
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </section>

        {/* ── Lesson history ── */}
        <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="h-1.5 bg-orange-500" />
          <div className="p-5 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-zinc-900">היסטוריית שיעורים</h3>
              <p className="text-sm text-muted-foreground">חיוב תלמיד מוצג בנפרד מחיוב הגורם המממן. שינויים בנוכחות, בשיעור או באישור גורם מממן מעדכנים את החיוב אוטומטית.</p>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                טוען שיעורים...
              </div>
            ) : (
              <div className="space-y-3">
                {lessonHistory.map((row) => {
                  const isUnbilled = row.billing_status === 'not_chargeable'
                    && !coerceAgorot(row.student_charge_amount)
                    && !coerceAgorot(row.hmo_charge_amount);
                  const coverageBadge = getCoverageBadge(row);
                  const coverageReasonLabel = getCoverageReasonLabel(row.coverage_reason || row.billing_reason);
                  return (
                    <div key={row.id} className="rounded-xl border border-border bg-slate-50/70 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-zinc-900">{formatDateTime(row.lesson_instance?.datetime_start)}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {getServiceName(services, row.lesson_instance?.service_id)} • {getParticipantStatusLabel(row.participant_status)}
                          </div>
                          {coverageReasonLabel ? (
                            <div className="mt-1 text-xs text-muted-foreground">{coverageReasonLabel}</div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {isUnbilled ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="cursor-help border-slate-200 bg-slate-50 text-slate-500">
                                  לא חויב
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                לשיעור זה לא נוצר חיוב. סיבות אפשריות: תעריף השירות לא הוגדר, סטטוס הנוכחות אינו מחויב לפי המדיניות, או שאין אישור גורם מממן פעיל. כדי ליצור חיוב, יש לעדכן את הנתון הרלוונטי במקור שלו.
                              </TooltipContent>
                            </Tooltip>
                          ) : null}
                          {coverageBadge ? (
                            <Badge variant="outline" className={coverageBadge.className}>
                              {coverageBadge.label}
                            </Badge>
                          ) : null}
                          <Badge variant="outline">{formatCurrency(row.student_charge_amount || 0)}</Badge>
                          {row.hmo_charge_amount ? (
                            <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-900">
                              גורם מממן {formatCurrency(row.hmo_charge_amount)}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {lessonHistory.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-muted-foreground">
                    אין שיעורים להצגה בטווח הנבחר.
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </section>

        {authorizations.length === 0 ? null : (
          <section className="rounded-xl border border-border bg-white p-4 text-xs text-muted-foreground shadow-sm">
            שיעורים עם אישור פעיל יחויבו לפי מחירי הכיסוי ששמורים על האישור. אחרי מיצוי הזכאות, המערכת תעבור אוטומטית למדיניות ההמשך שהוגדרה על האישור או תחסום חיוב אם כך הוגדר.
          </section>
        )}
      </div>
    </TooltipProvider>
  );
}
