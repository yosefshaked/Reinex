import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import LedgerEntriesTable from '@/features/finance/components/LedgerEntriesTable.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { useMedicalProviders } from '@/features/students/hooks/useMedicalProviders.js';
import { coerceAgorot, formatCurrency } from '@/lib/currency.js';
import { groupLedgerEntries, sumByDirection } from '@/features/finance/utils/ledgerGrouping.js';
import { formatLedgerNote } from '@/features/finance/utils/ledgerPresentation.js';

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
    default: return 'תנועה';
  }
}

export default function HmoProviderBillingWorkspace({ providerId = '' }) {
  const { session } = useAuth();
  const { activeOrgId } = useOrg();
  const { providers, loadingProviders } = useMedicalProviders();

  const [selectedProviderId, setSelectedProviderId] = useState(providerId);
  const [, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState(null);

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
        },
      });
      setSnapshot(payload || null);
    } catch (error) {
      console.error('Failed to load HMO provider billing snapshot', error);
      toast.error(error?.message || 'טעינת נתוני הגורם המממן נכשלה.');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, session, selectedProviderId]);

  useEffect(() => {
    if (selectedProviderId) void loadSnapshot();
    else setSnapshot(null);
  }, [selectedProviderId, loadSnapshot]);

  const summary = snapshot?.summary || {};
  const ledgerEntries = useMemo(
    () => (Array.isArray(snapshot?.ledger_entries) ? snapshot.ledger_entries : []),
    [snapshot?.ledger_entries],
  );

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
      if (direction === 'CREDIT') rollingBalance -= amount;
      else if (direction === 'DEBIT') rollingBalance += amount;
      return balanceAtRow;
    });
  }, [ledgerEntries, summary.balance]);

  const ledgerRows = useMemo(() => {
    function buildRowFromEntry(entry, index) {
      const direction = String(entry?.direction || '').toUpperCase();
      const isReversal = entry.source_type === 'reversal';
      return {
        key: entry.id,
        entryId: shortId(entry.id),
        date: formatDateTime(entry.effective_at || entry.posted_at),
        primaryText: getEntryTypeLabel(entry.source_type),
        detailLines: [
          formatLedgerNote(entry.notes),
          entry.external_reference ? `אסמכתא: ${entry.external_reference}` : '',
          isReversal && entry.reverses_transaction_id
            ? `היפוך של תנועה #${shortId(entry.reverses_transaction_id)}`
            : '',
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
      const reversalIndex = ledgerIndexById.get(reversal.id) || originalIndex;
      const pairAnchorIndex = Math.min(originalIndex, reversalIndex);
      const pairEntries = [original, reversal];
      const totalDebit = sumByDirection(pairEntries, 'DEBIT');
      const totalCredit = sumByDirection(pairEntries, 'CREDIT');
      const netImpact = totalDebit - totalCredit;

      return {
        key: group.key,
        date: formatDateTime(original.effective_at || original.posted_at),
        primaryText: `${getEntryTypeLabel(original.source_type)} • בוצע היפוך`,
        detailLines: [
          reversal.notes ? `סיבת היפוך: ${formatLedgerNote(reversal.notes)}` : '',
        ].filter(Boolean),
        statusBadges: [
          { label: 'צמד היפוך', className: 'border-amber-200 bg-amber-50 text-amber-800' },
          {
            label: netImpact === 0 ? 'השפעה נטו: 0' : `השפעה נטו: ${formatCurrency(netImpact)}`,
            className: 'border-slate-200 bg-slate-50 text-slate-700',
          },
        ],
        debit: totalDebit > 0 ? formatCurrency(totalDebit) : '—',
        credit: totalCredit > 0 ? formatCurrency(totalCredit) : '—',
        balance: formatCurrency(displayedBalances[pairAnchorIndex] || 0),
        childRows: [
          buildRowFromEntry(original, originalIndex),
          buildRowFromEntry(reversal, reversalIndex),
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

        {/* ── Provider selector (standalone use only) ── */}
        {!providerId ? (
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
        ) : null}

        {!selectedProviderId ? (
          providerId ? null : (
            <div className="rounded-xl border border-dashed border-border bg-slate-50 p-8 text-center text-sm text-muted-foreground">
              בחר גורם מממן כדי לצפות בחשבון שלו.
            </div>
          )
        ) : (
          <div className="space-y-5">

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
