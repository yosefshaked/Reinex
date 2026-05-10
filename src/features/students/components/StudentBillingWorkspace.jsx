import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, CornerUpLeft, Info, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet.jsx';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import ConfirmLedgerEntryDialog from '@/components/ui/ConfirmLedgerEntryDialog.jsx';
import LedgerEntriesTable from '@/features/finance/components/LedgerEntriesTable.jsx';
import ManualEntryForm from '@/features/finance/components/ManualEntryForm.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { useServices } from '@/hooks/useOrgData.js';
import HmoAuthorizationManager from '@/features/students/components/HmoAuthorizationManager.jsx';
import { isAdminOrOffice, isAdminRole, normalizeMembershipRole } from '@/features/students/utils/endpoints.js';
import { coerceAgorot, formatCurrency, toAgorot } from '@/lib/currency.js';

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

function shortId(id) {
  return id ? String(id).slice(-8) : '';
}

function getHmoApprovalStatusLabel(status) {
  switch (status) {
    case 'send_separately':
      return 'האישור יישלח בנפרד';
    case 'no_approval_yet':
      return 'אין אישור עדיין';
    default:
      return '';
  }
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
  const [manualEntrySheetOpen, setManualEntrySheetOpen] = useState(false);
  const [manualEntryResetVersion, setManualEntryResetVersion] = useState(0);
  const [confirmEntry, setConfirmEntry] = useState(null);
  const [dismissedIntakeNoticeKey, setDismissedIntakeNoticeKey] = useState('');

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

  const notifyDataChanged = useCallback(async () => {
    if (typeof onDataChanged === 'function') {
      await onDataChanged();
    }
  }, [onDataChanged]);

  function handleRequestAppendEntry(formData) {
    setConfirmEntry({
      type: formData.mode === 'adjustment' ? 'debit' : 'credit',
      amount: toAgorot(formData.amount),
      accountName: studentName,
      effectiveAt: formData.effectiveAt,
      notes: formData.notes,
      _formData: { ...formData },
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
      await loadData();
      await notifyDataChanged();
      setManualEntryResetVersion((current) => current + 1);
      setManualEntrySheetOpen(false);
      toast.success(confirmEntry.type === 'debit' ? 'ההתאמה נשמרה.' : 'התשלום נשמר.');
    } catch (error) {
      console.error('Failed to append manual student ledger entry', error);
      toast.error(error?.message || 'שמירת התנועה נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  const handleReverseEntry = useCallback(async (entryId) => {
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
  }, [activeOrgId, canMutateBilling, loadData, notifyDataChanged, session]);

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
  const intakeFinanceNotice = snapshot?.intake_finance_notice || null;
  const intakeFinanceNoticeStorageKey = useMemo(() => {
    if (!activeOrgId || !studentId || !intakeFinanceNotice?.waiting_list_entry_id) {
      return '';
    }
    return [
      'student-finance-intake-notice-dismissed',
      activeOrgId,
      studentId,
      intakeFinanceNotice.waiting_list_entry_id,
      intakeFinanceNotice.expires_at || '',
    ].join(':');
  }, [activeOrgId, intakeFinanceNotice?.expires_at, intakeFinanceNotice?.waiting_list_entry_id, studentId]);

  useEffect(() => {
    if (!intakeFinanceNoticeStorageKey) {
      setDismissedIntakeNoticeKey('');
      return;
    }
    try {
      setDismissedIntakeNoticeKey(
        localStorage.getItem(intakeFinanceNoticeStorageKey) === '1'
          ? intakeFinanceNoticeStorageKey
          : '',
      );
    } catch {
      setDismissedIntakeNoticeKey('');
    }
  }, [intakeFinanceNoticeStorageKey]);

  const showIntakeFinanceNotice = Boolean(
    intakeFinanceNotice
    && intakeFinanceNoticeStorageKey
    && dismissedIntakeNoticeKey !== intakeFinanceNoticeStorageKey,
  );

  const studentName = useMemo(() => {
    const source = snapshot?.student || student;
    return source?.full_name || [source?.first_name, source?.middle_name, source?.last_name].filter(Boolean).join(' ') || 'תלמיד';
  }, [snapshot, student]);
  const manualEntryDraftStorageKey = useMemo(
    () => (activeOrgId && studentId ? `manual-entry:${activeOrgId}:student:${studentId}` : ''),
    [activeOrgId, studentId],
  );

  function dismissIntakeFinanceNotice() {
    if (!intakeFinanceNoticeStorageKey) return;
    try {
      localStorage.setItem(intakeFinanceNoticeStorageKey, '1');
    } catch {
      // localStorage is best-effort here; the backend still controls the notice lifecycle.
    }
    setDismissedIntakeNoticeKey(intakeFinanceNoticeStorageKey);
  }

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
    const coverageBadge = getCoverageBadge(entry?.metadata || {});
    const coverageReasonLabel = getCoverageReasonLabel(entry?.metadata?.coverage_reason);
    const direction = String(entry?.direction || '').toUpperCase();
    const descriptionLines = [
      entry.notes ? `הערות: ${entry.notes}` : '',
      entry.external_reference ? `אסמכתא: ${entry.external_reference}` : '',
      coverageReasonLabel || '',
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
        ...(coverageBadge ? [coverageBadge] : []),
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
        ...(canMutateBilling && !isReversed && ['manual_payment', 'manual_adjustment'].includes(entry.source_type) ? [{
          label: 'בצע היפוך',
          icon: <CornerUpLeft className="h-4 w-4" />,
          onSelect: () => handleReverseEntry(entry.id),
          disabled: saving,
          className: 'text-amber-700 focus:text-amber-700',
        }] : []),
      ],
    };
  }), [canMutateBilling, displayedBalances, handleReverseEntry, ledgerEntries, reversalMap, saving]);

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

        {showIntakeFinanceNotice ? (
          <section className="rounded-2xl border border-sky-200 bg-sky-50/80 p-4 shadow-sm shadow-sky-100">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Info className="h-4 w-4 text-sky-700" />
                  <span className="text-sm font-semibold text-sky-950">מסלול מימון מטופס ההמתנה</span>
                  <Badge variant="outline" className="border-sky-300 bg-white text-sky-900">
                    {intakeFinanceNotice.label}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-sky-800">
                  {intakeFinanceNotice.hmo_provider_name ? (
                    <Badge variant="outline" className="border-sky-200 bg-white text-sky-800">
                      {intakeFinanceNotice.hmo_provider_name}
                    </Badge>
                  ) : null}
                  {getHmoApprovalStatusLabel(intakeFinanceNotice.hmo_approval_status) ? (
                    <Badge variant="outline" className="border-sky-200 bg-white text-sky-800">
                      {getHmoApprovalStatusLabel(intakeFinanceNotice.hmo_approval_status)}
                    </Badge>
                  ) : null}
                  <span>
                    זה מסלול המימון שבחר הלקוח בטופס רשימת ההמתנה. יוצג עד שתירשם תנועה כספית, ייווצר אישור גורם מממן, או שיעברו 30 ימים מהשיבוץ.
                  </span>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-sky-700 hover:bg-sky-100 hover:text-sky-900"
                onClick={dismissIntakeFinanceNotice}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">הסתר מסלול מימון מטופס ההמתנה</span>
              </Button>
            </div>
          </section>
        ) : null}

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
            <div className="text-xs text-indigo-700">חיוב מול גורם מממן</div>
            <div className="mt-1 text-xl font-bold text-indigo-950">{formatCurrency(summary.hmo_charge_total)}</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-xs text-amber-700">תשלומים ידניים</div>
            <div className="mt-1 text-xl font-bold text-amber-950">{formatCurrency(summary.payment_total)}</div>
          </div>
        </section>

        {/* ── Manual entry form trigger ── */}
        {canMutateBilling ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-950">תנועות ידניות</h3>
                <p className="text-sm text-slate-500">תשלום מגדיל יתרה, התאמה ידנית מקטינה אותה. כל תנועה נרשמת לצמיתות.</p>
              </div>
              <Button type="button" onClick={() => setManualEntrySheetOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                <span>תנועה ידנית</span>
              </Button>
            </div>
          </section>
        ) : null}

        <Sheet
          open={manualEntrySheetOpen}
          modal={false}
          onOpenChange={(open) => {
            if (saving) return;
            setManualEntrySheetOpen(open);
          }}
        >
          <SheetContent side="left" showOverlay={false} className="w-[92vw] overflow-hidden border-slate-200 p-0 sm:max-w-[460px]">
            <div className="flex h-full flex-col p-6">
              <SheetHeader className="shrink-0 text-right">
                <SheetTitle>הוספת תנועה ידנית</SheetTitle>
                <SheetDescription>
                  רושמים תשלום או התאמה ידנית בלדר, ואז מאשרים את הפעולה לפני השמירה הסופית.
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 min-h-0 flex-1 overflow-y-auto pe-1">
                <ManualEntryForm
                  open={manualEntrySheetOpen}
                  resetVersion={manualEntryResetVersion}
                  saving={saving}
                  availableServices={services}
                  showCreditCalculator
                  draftStorageKey={manualEntryDraftStorageKey}
                  onSubmit={handleRequestAppendEntry}
                  onCancel={() => setManualEntrySheetOpen(false)}
                />
              </div>
            </div>
          </SheetContent>
        </Sheet>

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
            description={`${studentName} • הלדר הוא מקור האמת היחיד. תנועות לא נמחקות, רק נרשמות מולן פעולות היפוך.`}
            rows={ledgerRows}
            emptyLabel="אין תנועות להצגה בטווח הנבחר."
          />
        )}

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
