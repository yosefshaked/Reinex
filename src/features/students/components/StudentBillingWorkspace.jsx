import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { useServices } from '@/hooks/useOrgData.js';
import { isAdminOrOffice, isAdminRole, normalizeMembershipRole } from '@/features/students/utils/endpoints.js';
import HmoAuthorizationManager from '@/features/students/components/HmoAuthorizationManager.jsx';
import {
  buildCommitmentMetadataPayload,
  buildInitialCommitmentForm,
  commitmentSupportsService,
  computeCommitmentAmounts,
  createCommitmentFormFromCommitment,
  createEmptyPackageItem,
  getCommitmentActionHint,
  getCommitmentCoverageSummary,
  getCommitmentTypeLabel,
  COMMITMENT_TYPE_OPTIONS,
} from '@/features/students/components/student-billing-helpers.js';

function formatCurrency(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `₪${Number(value).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateString) {
  if (!dateString) return '—';
  return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(dateString));
}

function formatDateTime(dateString) {
  if (!dateString) return '—';
  return new Intl.DateTimeFormat('he-IL', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateString));
}

function getServiceName(services, serviceId) {
  return services.find((service) => service.id === serviceId)?.service_name
    || services.find((service) => service.id === serviceId)?.name
    || 'שירות';
}

function getCommitmentLabel(commitment, services) {
  if (!commitment) return 'ללא התחייבות';
  return `${getCommitmentTypeLabel(commitment.commitment_type)} • ${getCommitmentCoverageSummary(commitment, services)} • ${formatCurrency(commitment.remaining_amount)}`;
}

function getBillingStatusLabel(status) {
  switch (status) {
    case 'charged':
      return 'מחויב';
    case 'not_chargeable':
      return 'לא מחויב';
    case 'pending_commitment':
      return 'ממתין להתחייבות';
    case 'pending_commitment_configuration':
      return 'חסרה הגדרת מחיר';
    case 'invalid_commitment':
      return 'התחייבות לא תקינה';
    case 'pending_attendance':
      return 'ממתין לנוכחות';
    default:
      return status || 'לא ידוע';
  }
}

function getBillingReasonLabel(reason) {
  switch (reason) {
    case 'missing_commitment':
      return 'לא נבחרה התחייבות.';
    case 'missing_default_charge_amount':
      return 'להתחייבות אין מחיר ברירת מחדל לשיעור.';
    case 'service_mismatch':
      return 'ההתחייבות שייכת לשירות אחר.';
    case 'inactive_commitment':
      return 'ההתחייבות אינה פעילה.';
    case 'expired_commitment':
      return 'תוקף ההתחייבות פג לפני השיעור.';
    case 'policy_excluded_status':
      return 'מדיניות הארגון לא מחייבת בסטטוס הזה.';
    case 'lesson_cancelled_by_clinic':
      return 'שיעור שבוטל על ידי המכון אינו מחויב.';
    case 'participant_not_resolved':
      return 'יש להשלים נוכחות לפני חיוב.';
    case 'chargeable':
      return 'החיוב בוצע לפי ההתחייבות שנבחרה.';
    case 'commitment_belongs_to_different_student':
      return 'ההתחייבות שייכת לתלמיד אחר.';
    case 'commitment_service_exhausted':
      return 'השירות הזה כבר מוצה בתוך ההתחייבות.';
    case 'authorization_exhausted':
      return 'כמות האישורים של הגורם המממן כבר נוצלה.';
    default:
      return '—';
  }
}

function getEntryTypeLabel(sourceType) {
  switch (sourceType) {
    case 'adjustment':
      return 'התאמה';
    case 'transfer':
      return 'העברה';
    case 'lesson':
      return 'שיעור';
    default:
      return sourceType || 'תנועה';
  }
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

function escapeCsvCell(value) {
  const stringValue = `${value ?? ''}`.replace(/"/g, '""');
  return `"${stringValue}"`;
}

function exportBillingCsv({ student, commitments, lessonHistory, entries, transfers }) {
  const rows = [
    ['record_type', 'student', 'date', 'service', 'status', 'amount', 'remaining', 'notes'],
    ...commitments.map((commitment) => ([
      'commitment',
      student?.full_name || '',
      commitment.expires_at || '',
      commitment.service?.service_name || '',
      commitment.commitment_type || '',
      commitment.total_amount ?? '',
      commitment.remaining_amount ?? '',
      commitment.notes || '',
    ])),
    ...lessonHistory.map((row) => ([
      'lesson',
      row.student?.full_name || student?.full_name || '',
      row.lesson_instance?.datetime_start || '',
      row.service?.service_name || '',
      row.billing_status || '',
      row.resolved_charge_amount ?? row.price_charged ?? '',
      row.commitment?.remaining_amount ?? '',
      getBillingReasonLabel(row.billing_reason),
    ])),
    ...entries.map((entry) => ([
      'entry',
      entry.student?.full_name || student?.full_name || '',
      entry.effective_date || entry.created_at || '',
      entry.commitment?.service?.service_name || '',
      getEntryTypeLabel(entry.source_type),
      entry.amount_charged ?? '',
      entry.commitment?.remaining_amount ?? '',
      entry.notes || '',
    ])),
    ...transfers.map((transfer) => ([
      'transfer',
      student?.full_name || '',
      transfer.created_at || '',
      transfer.target_commitments.map((commitment) => commitment.service?.service_name || '').join(', '),
      'transfer',
      transfer.amount ?? '',
      '',
      transfer.source_entry?.notes || '',
    ])),
  ];

  const csv = ['\uFEFF', ...rows.map((row) => row.map(escapeCsvCell).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `student-billing-${student?.full_name || 'student'}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
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
  const [reconciling, setReconciling] = useState(false);
  const [summary, setSummary] = useState(null);
  const [commitments, setCommitments] = useState([]);
  const [billingQueue, setBillingQueue] = useState([]);
  const [lessonHistory, setLessonHistory] = useState([]);
  const [entries, setEntries] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [commitmentForm, setCommitmentForm] = useState(() => buildInitialCommitmentForm());
  const [entryForm, setEntryForm] = useState({
    id: '',
    sourceType: 'adjustment',
    commitmentId: '',
    amountCharged: '',
    effectiveDate: '',
    notes: '',
  });
  const [transferForm, setTransferForm] = useState({
    sourceCommitmentId: '',
    amount: '',
    targetServiceId: '',
    targetCommitmentType: 'manual_credit',
    targetDefaultChargeAmount: '',
    expiresAt: '',
    notes: '',
  });
  const [assignmentValues, setAssignmentValues] = useState({});

  const actionableHistory = useMemo(
    () => billingQueue.filter((item) => item.student_id === studentId),
    [billingQueue, studentId],
  );

  const transferMap = useMemo(
    () => new Map(transfers.map((transfer) => [transfer.transfer_ref, transfer])),
    [transfers],
  );
  const editableCommitmentTypeOptions = useMemo(
    () => COMMITMENT_TYPE_OPTIONS.filter((option) => option.value !== 'hmo'),
    [],
  );
  const currentCommitmentAmounts = useMemo(
    () => computeCommitmentAmounts(commitmentForm),
    [commitmentForm],
  );

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

      setSummary(payload?.summary || null);
      setCommitments(Array.isArray(payload?.commitments) ? payload.commitments : []);
      setBillingQueue(Array.isArray(payload?.billing_queue) ? payload.billing_queue : []);
      setLessonHistory(Array.isArray(payload?.lesson_history) ? payload.lesson_history : []);
      setEntries(Array.isArray(payload?.entries) ? payload.entries : []);
      setTransfers(Array.isArray(payload?.transfers) ? payload.transfers : []);
    } catch (error) {
      console.error('Failed to load student billing workspace', error);
      toast.error(error?.message || 'טעינת נתוני החיוב נכשלה.');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, canViewBilling, endDate, session, startDate, studentId]);

  useEffect(() => {
    if (!canViewBilling) {
      return undefined;
    }
    void loadData();
    return undefined;
  }, [canViewBilling, loadData]);

  async function notifyDataChanged() {
    if (typeof onDataChanged === 'function') {
      await onDataChanged();
    }
  }

  function resetCommitmentForm() {
    setCommitmentForm(buildInitialCommitmentForm());
  }

  function startEditingCommitment(commitment) {
    setCommitmentForm(createCommitmentFormFromCommitment(commitment));
  }

  function handleCommitmentTypeChange(value) {
    setCommitmentForm((current) => {
      const resolvedValue = value === 'hmo' ? 'package' : value;
      const next = {
        ...buildInitialCommitmentForm(),
        ...current,
        commitmentType: resolvedValue,
        id: current.id,
        notes: current.notes,
        expiresAt: current.expiresAt,
        isActive: current.isActive,
      };
      if (resolvedValue === 'manual_credit') {
        next.serviceId = current.serviceId;
      }
      return next;
    });
  }

  function updatePackageItem(itemId, field, value) {
    setCommitmentForm((current) => ({
      ...current,
      packageItems: current.packageItems.map((item) => (
        item.id === itemId ? { ...item, [field]: value } : item
      )),
    }));
  }

  function addPackageItem() {
    setCommitmentForm((current) => ({
      ...current,
      packageItems: [...current.packageItems, createEmptyPackageItem()],
    }));
  }

  function removePackageItem(itemId) {
    setCommitmentForm((current) => {
      const nextItems = current.packageItems.filter((item) => item.id !== itemId);
      return {
        ...current,
        packageItems: nextItems.length > 0 ? nextItems : [createEmptyPackageItem()],
      };
    });
  }

  async function handleSaveCommitment() {
    if (!studentId || !activeOrgId || !canMutateBilling) return;
    if (commitmentForm.commitmentType === 'hmo') {
      toast.error('התחייבות HMO נוצרת רק דרך אישור גורם מממן.');
      return;
    }
    const computedAmounts = computeCommitmentAmounts(commitmentForm);
    const metadata = buildCommitmentMetadataPayload(commitmentForm);
    const resolvedServiceId = commitmentForm.commitmentType === 'package'
      ? (metadata.package_items?.[0]?.service_id || '')
      : commitmentForm.serviceId;

    if (commitmentForm.commitmentType === 'package' && (!Array.isArray(metadata.package_items) || metadata.package_items.length === 0)) {
      toast.error('יש להגדיר לפחות שורת שירות אחת לחבילה.');
      return;
    }
    if (commitmentForm.commitmentType === 'subscription' && (!resolvedServiceId || Number(commitmentForm.subscriptionLessonsCount || 0) <= 0)) {
      toast.error('למנוי נדרש שירות וכמות שיעורים.');
      return;
    }
    if (commitmentForm.commitmentType === 'hmo' && (!resolvedServiceId || Number(commitmentForm.hmoAuthorizedLessons || 0) <= 0)) {
      toast.error('לגורם מממן נדרשים שירות וכמות אישורים.');
      return;
    }

    setSaving(true);
    try {
      await authenticatedFetch('commitments', {
        session,
        method: commitmentForm.id ? 'PUT' : 'POST',
        body: {
          id: commitmentForm.id || undefined,
          org_id: activeOrgId,
          student_id: studentId,
          service_id: resolvedServiceId,
          commitment_type: commitmentForm.commitmentType,
          total_amount: computedAmounts.totalAmount,
          default_charge_amount: computedAmounts.defaultChargeAmount,
          expires_at: commitmentForm.expiresAt || null,
          notes: commitmentForm.notes || null,
          is_active: commitmentForm.isActive,
          metadata,
        },
      });
      resetCommitmentForm();
      await loadData();
      await notifyDataChanged();
      toast.success(commitmentForm.id ? 'ההתחייבות עודכנה.' : 'ההתחייבות נוצרה.');
    } catch (error) {
      console.error('Failed to save commitment', error);
      toast.error(error?.message || 'שמירת ההתחייבות נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCommitment(commitmentId) {
    if (!activeOrgId || !commitmentId || !canMutateBilling) return;
    setSaving(true);
    try {
      await authenticatedFetch('commitments', {
        session,
        method: 'DELETE',
        body: {
          org_id: activeOrgId,
          id: commitmentId,
        },
      });
      if (commitmentForm.id === commitmentId) {
        resetCommitmentForm();
      }
      await loadData();
      await notifyDataChanged();
      toast.success('ההתחייבות הוסרה.');
    } catch (error) {
      console.error('Failed to delete commitment', error);
      toast.error(error?.message || 'מחיקת ההתחייבות נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  function resolveAssignmentValue(row) {
    return assignmentValues[row.id] ?? row.commitment_id ?? '__none__';
  }

  function getCandidateCommitments(row) {
    const candidates = commitments.filter((commitment) => (
      commitment.student_id === row.student_id
      && commitmentSupportsService(commitment, row.lesson_instance?.service_id)
      && commitment.is_active !== false
    ));

    if (row.commitment && !candidates.some((candidate) => candidate.id === row.commitment.id)) {
      return [row.commitment, ...candidates];
    }
    return candidates;
  }

  async function handleApplyAssignment(row) {
    if (!activeOrgId || !canMutateBilling) return;
    const selectedValue = resolveAssignmentValue(row);
    setSaving(true);
    try {
      if (!selectedValue || selectedValue === '__none__') {
        await authenticatedFetch('billing', {
          session,
          method: 'POST',
          body: {
            org_id: activeOrgId,
            action: 'clear_lesson_commitment',
            lesson_participant_id: row.id,
          },
        });
      } else {
        await authenticatedFetch('billing', {
          session,
          method: 'POST',
          body: {
            org_id: activeOrgId,
            action: 'assign_lesson_commitment',
            lesson_participant_id: row.id,
            commitment_id: selectedValue,
          },
        });
      }
      await loadData();
      await notifyDataChanged();
      toast.success('שיוך החיוב עודכן.');
    } catch (error) {
      console.error('Failed to update lesson commitment assignment', error);
      toast.error(error?.message || 'עדכון שיוך החיוב נכשל.');
    } finally {
      setSaving(false);
    }
  }

  function resetEntryForm() {
    setEntryForm({
      id: '',
      sourceType: 'adjustment',
      commitmentId: '',
      amountCharged: '',
      effectiveDate: '',
      notes: '',
    });
  }

  function startEditingEntry(entry) {
    if (entry.source_type !== 'adjustment') return;
    setEntryForm({
      id: entry.id,
      sourceType: entry.source_type || 'adjustment',
      commitmentId: entry.commitment_id || '',
      amountCharged: entry.amount_charged ?? '',
      effectiveDate: entry.effective_date || '',
      notes: entry.notes || '',
    });
  }

  async function handleSaveManualEntry() {
    if (!activeOrgId || !canMutateBilling) return;
    if (!entryForm.notes.trim()) {
      toast.error('לתנועה ידנית חייבת להיות הערה.');
      return;
    }
    setSaving(true);
    try {
      await authenticatedFetch('consumption-entries', {
        session,
        method: entryForm.id ? 'PUT' : 'POST',
        body: {
          id: entryForm.id || undefined,
          org_id: activeOrgId,
          student_id: studentId,
          source_type: entryForm.sourceType,
          commitment_id: entryForm.commitmentId || null,
          amount_charged: Number(entryForm.amountCharged),
          effective_date: entryForm.effectiveDate || null,
          notes: entryForm.notes || null,
        },
      });
      resetEntryForm();
      await loadData();
      await notifyDataChanged();
      toast.success(entryForm.id ? 'התאמת החיוב עודכנה.' : 'התאמת החיוב נשמרה.');
    } catch (error) {
      console.error('Failed to save manual billing entry', error);
      toast.error(error?.message || 'שמירת התאמת החיוב נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteEntry(entryId) {
    if (!activeOrgId || !entryId || !canMutateBilling) return;
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
      if (entryForm.id === entryId) {
        resetEntryForm();
      }
      await loadData();
      await notifyDataChanged();
      toast.success('התאמת החיוב הוסרה.');
    } catch (error) {
      console.error('Failed to delete manual billing entry', error);
      toast.error(error?.message || 'מחיקת ההתאמה נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  async function handleTransferBalance() {
    if (!activeOrgId || !canMutateBilling || !transferForm.sourceCommitmentId || transferForm.amount === '') return;
    setSaving(true);
    try {
      await authenticatedFetch('billing', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          action: 'transfer_commitment_balance',
          source_commitment_id: transferForm.sourceCommitmentId,
          amount: Number(transferForm.amount),
          target_student_id: studentId,
          target_service_id: transferForm.targetServiceId || undefined,
          target_commitment_type: transferForm.targetCommitmentType,
          target_default_charge_amount: transferForm.targetDefaultChargeAmount === '' ? null : Number(transferForm.targetDefaultChargeAmount),
          expires_at: transferForm.expiresAt || null,
          notes: transferForm.notes || null,
        },
      });
      setTransferForm({
        sourceCommitmentId: '',
        amount: '',
        targetServiceId: '',
        targetCommitmentType: 'manual_credit',
        targetDefaultChargeAmount: '',
        expiresAt: '',
        notes: '',
      });
      await loadData();
      await notifyDataChanged();
      toast.success('היתרה הועברה להתחייבות חדשה.');
    } catch (error) {
      console.error('Failed to transfer commitment balance', error);
      toast.error(error?.message || 'העברת היתרה נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  async function handleReconcileBilling() {
    if (!activeOrgId || !studentId || !canMutateBilling) return;
    setReconciling(true);
    try {
      await authenticatedFetch('billing', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          action: 'reconcile_student_billing',
          student_id: studentId,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
        },
      });
      await loadData();
      await notifyDataChanged();
      toast.success('חיובי השיעורים חושבו מחדש.');
    } catch (error) {
      console.error('Failed to reconcile student billing', error);
      toast.error(error?.message || 'חישוב החיובים מחדש נכשל.');
    } finally {
      setReconciling(false);
    }
  }

  if (!studentId) {
    return null;
  }

  if (!canViewBilling) {
    return (
      <section className="rounded-xl border border-border bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-zinc-900">כספי תלמיד</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          למסך החיובים יש הרשאת צפייה רק למנהלים ולאנשי משרד.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="h-1.5 bg-zinc-900" />
        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-zinc-900">תמונת מצב כספית</h3>
              <p className="text-sm text-muted-foreground">
                חיובי שיעורים, התחייבויות, התאמות ידניות והעברות.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {Number.isFinite(Number(student?.special_rate)) ? (
                <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-900">
                  תעריף מיוחד {formatCurrency(student.special_rate)}
                </Badge>
              ) : null}
              {canMutateBilling ? (
                <Button type="button" variant="outline" onClick={handleReconcileBilling} disabled={reconciling || loading}>
                  {reconciling ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                  חשב מחדש
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                onClick={() => exportBillingCsv({ student, commitments, lessonHistory, entries, transfers })}
                disabled={loading}
              >
                ייצוא CSV
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-xs text-emerald-700">יתרה כוללת</div>
              <div className="mt-1 text-xl font-bold text-emerald-950">{formatCurrency(summary?.total_remaining)}</div>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <div className="text-xs text-blue-700">התחייבויות פעילות</div>
              <div className="mt-1 text-xl font-bold text-blue-950">{summary?.active_commitments_count ?? 0}</div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-xs text-amber-700">שיעורים ממתינים לחיוב</div>
              <div className="mt-1 text-xl font-bold text-amber-950">{summary?.pending_queue_count ?? 0}</div>
            </div>
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
              <div className="text-xs text-violet-700">העברות / התאמות</div>
              <div className="mt-1 text-xl font-bold text-violet-950">{(summary?.transfer_count ?? 0) + (summary?.manual_entry_count ?? 0)}</div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="h-1.5 bg-emerald-500" />
          <div className="p-5 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-zinc-800">התחייבויות ויתרות</h3>
              <p className="text-sm text-muted-foreground">כאן מנוהלות היתרות שמזינות את חיובי השיעורים.</p>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                טוען התחייבויות...
              </div>
            ) : (
              <div className="space-y-3">
                {commitments.map((commitment) => (
                  <div key={commitment.id} className="rounded-xl border border-border bg-slate-50/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-zinc-900">{getCommitmentTypeLabel(commitment.commitment_type)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {getCommitmentCoverageSummary(commitment, services)}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{getCommitmentActionHint(commitment)}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{formatCurrency(commitment.remaining_amount)}</Badge>
                        {commitment.is_active === false ? (
                          <Badge variant="outline" className="border-slate-300 bg-slate-100 text-slate-700">לא פעיל</Badge>
                        ) : null}
                        {commitment.transfer_ref ? (
                          <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-900">הועבר</Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-3 text-sm">
                      <div className="rounded-lg bg-white p-3">
                        <div className="text-[11px] text-muted-foreground">סך התחייבות</div>
                        <div className="mt-1 font-semibold">{formatCurrency(commitment.total_amount)}</div>
                      </div>
                      <div className="rounded-lg bg-white p-3">
                        <div className="text-[11px] text-muted-foreground">נצרך</div>
                        <div className="mt-1 font-semibold">{formatCurrency(commitment.consumed_amount)}</div>
                      </div>
                      <div className="rounded-lg bg-white p-3">
                        <div className="text-[11px] text-muted-foreground">
                          {commitment.runtime?.remaining_lessons != null ? 'יתרת מפגשים' : 'תוקף'}
                        </div>
                        <div className="mt-1 font-semibold">
                          {commitment.runtime?.remaining_lessons != null ? commitment.runtime.remaining_lessons : formatDate(commitment.expires_at)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {commitment.attention?.low_balance ? (
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-900">פחות משני שיעורים ביתרה</Badge>
                      ) : null}
                      {commitment.attention?.expiring_soon ? (
                        <Badge variant="outline" className="border-red-200 bg-red-50 text-red-900">התוקף קרוב</Badge>
                      ) : null}
                      {commitment.runtime?.hmo?.pending_claim_amount > 0 ? (
                        <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-900">
                          תביעות פתוחות {formatCurrency(commitment.runtime.hmo.pending_claim_amount)}
                        </Badge>
                      ) : null}
                      {commitment.commitment_type === 'hmo' && commitment.hmo_authorization_id ? (
                        <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-900">מנוהל דרך אישור</Badge>
                      ) : null}
                    </div>
                    {canMutateBilling ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {commitment.commitment_type !== 'hmo' ? (
                          <Button type="button" size="sm" variant="outline" onClick={() => startEditingCommitment(commitment)} disabled={saving}>
                            ערוך
                          </Button>
                        ) : null}
                        {Number(commitment.consumed_amount || 0) === 0 && !commitment.transfer_ref && commitment.commitment_type !== 'hmo' ? (
                          <Button type="button" size="sm" variant="outline" onClick={() => handleDeleteCommitment(commitment.id)} disabled={saving}>
                            מחק
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
                {commitments.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-muted-foreground">
                    אין התחייבויות לתלמיד הזה עדיין.
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </section>

        {canMutateBilling ? (
          <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
            <div className="h-1.5 bg-blue-500" />
            <div className="p-5 space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-zinc-800">{commitmentForm.id ? 'עריכת התחייבות' : 'התחייבות חדשה'}</h3>
                <p className="text-sm text-muted-foreground">כל סוג התחייבות מייצר התנהגות אחרת בבילינג, לכן ההגדרות כאן תלויות סוג.</p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs text-slate-600">סוג התחייבות</Label>
                    <Select value={commitmentForm.commitmentType} onValueChange={handleCommitmentTypeChange} disabled={saving}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                      {editableCommitmentTypeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                      </SelectContent>
                    </Select>
                  </div>
                <div className="space-y-2">
                  <Label className="text-xs text-slate-600">משמעות הסוג</Label>
                  <div className="rounded-xl border border-border bg-slate-50 px-3 py-2 text-sm text-muted-foreground">
                    {editableCommitmentTypeOptions.find((option) => option.value === commitmentForm.commitmentType)?.description}
                  </div>
                </div>
              </div>

              {commitmentForm.commitmentType === 'package' ? (
                <div className="space-y-3 rounded-xl border border-border bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-zinc-900">שורות חבילה</div>
                      <div className="text-xs text-muted-foreground">כל שורה מגדירה שירות, כמות מפגשים ומחיר חיוב לשיעור.</div>
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={addPackageItem} disabled={saving}>הוסף שורה</Button>
                  </div>
                  {commitmentForm.packageItems.map((item) => (
                    <div key={item.id} className="grid gap-3 rounded-xl border border-border bg-white p-3 md:grid-cols-[minmax(0,1.4fr)_120px_140px_auto]">
                      <div className="space-y-2">
                        <Label className="text-xs text-slate-600">שירות</Label>
                        <Select value={item.serviceId || '__none__'} onValueChange={(value) => updatePackageItem(item.id, 'serviceId', value === '__none__' ? '' : value)} disabled={saving}>
                          <SelectTrigger>
                            <SelectValue placeholder="בחר שירות" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">בחר שירות</SelectItem>
                            {services.map((service) => (
                              <SelectItem key={service.id} value={service.id}>{service.service_name || service.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-slate-600">מספר מפגשים</Label>
                        <Input type="number" min="0" step="1" value={item.lessonsCount} onChange={(event) => updatePackageItem(item.id, 'lessonsCount', event.target.value)} disabled={saving} />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-slate-600">מחיר לשיעור</Label>
                        <Input type="number" min="0" step="0.01" value={item.chargeAmount} onChange={(event) => updatePackageItem(item.id, 'chargeAmount', event.target.value)} disabled={saving} />
                      </div>
                      <div className="flex items-end">
                        <Button type="button" size="sm" variant="ghost" onClick={() => removePackageItem(item.id)} disabled={saving || commitmentForm.packageItems.length === 1}>
                          הסר
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {commitmentForm.commitmentType === 'subscription' ? (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-600">שירות</Label>
                    <Select value={commitmentForm.serviceId || '__none__'} onValueChange={(value) => setCommitmentForm((current) => ({ ...current, serviceId: value === '__none__' ? '' : value }))} disabled={saving}>
                      <SelectTrigger>
                        <SelectValue placeholder="בחר שירות" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">בחר שירות</SelectItem>
                        {services.map((service) => (
                          <SelectItem key={service.id} value={service.id}>{service.service_name || service.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="subscription-lessons-count" className="text-xs text-slate-600">כמות שיעורים</Label>
                      <Input id="subscription-lessons-count" type="number" min="0" step="1" value={commitmentForm.subscriptionLessonsCount} onChange={(event) => setCommitmentForm((current) => ({ ...current, subscriptionLessonsCount: event.target.value }))} disabled={saving} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="subscription-charge-amount" className="text-xs text-slate-600">מחיר לשיעור</Label>
                      <Input id="subscription-charge-amount" type="number" min="0" step="0.01" value={commitmentForm.subscriptionChargeAmount} onChange={(event) => setCommitmentForm((current) => ({ ...current, subscriptionChargeAmount: event.target.value }))} disabled={saving} />
                    </div>
                  </div>
                </>
              ) : null}

              {commitmentForm.commitmentType === 'manual_credit' ? (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-600">שירות</Label>
                    <Select value={commitmentForm.serviceId || '__none__'} onValueChange={(value) => setCommitmentForm((current) => ({ ...current, serviceId: value === '__none__' ? '' : value }))} disabled={saving}>
                      <SelectTrigger>
                        <SelectValue placeholder="בחר שירות" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">בחר שירות</SelectItem>
                        {services.map((service) => (
                          <SelectItem key={service.id} value={service.id}>{service.service_name || service.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="billing-total-amount" className="text-xs text-slate-600">סך יתרה</Label>
                      <Input id="billing-total-amount" type="number" min="0" step="0.01" value={commitmentForm.totalAmount} onChange={(event) => setCommitmentForm((current) => ({ ...current, totalAmount: event.target.value }))} disabled={saving} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="billing-default-charge" className="text-xs text-slate-600">מחיר לשיעור</Label>
                      <Input id="billing-default-charge" type="number" min="0" step="0.01" value={commitmentForm.defaultChargeAmount} onChange={(event) => setCommitmentForm((current) => ({ ...current, defaultChargeAmount: event.target.value }))} disabled={saving} />
                    </div>
                  </div>
                </>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs text-slate-600">סך התחייבות מחושב</Label>
                  <div className="rounded-xl border border-border bg-slate-50 px-3 py-2 text-sm font-semibold text-zinc-900">
                    {formatCurrency(currentCommitmentAmounts.totalAmount)}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="billing-expires-at" className="text-xs text-slate-600">תוקף</Label>
                  <Input id="billing-expires-at" type="date" value={commitmentForm.expiresAt} onChange={(event) => setCommitmentForm((current) => ({ ...current, expiresAt: event.target.value }))} disabled={saving} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="billing-commitment-notes" className="text-xs text-slate-600">הערות</Label>
                <Input id="billing-commitment-notes" value={commitmentForm.notes} onChange={(event) => setCommitmentForm((current) => ({ ...current, notes: event.target.value }))} disabled={saving} />
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-slate-600">סטטוס</Label>
                <Select value={commitmentForm.isActive ? 'active' : 'inactive'} onValueChange={(value) => setCommitmentForm((current) => ({ ...current, isActive: value === 'active' }))} disabled={saving}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">פעיל</SelectItem>
                    <SelectItem value="inactive">לא פעיל</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleSaveCommitment} disabled={saving}>
                  {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                  {commitmentForm.id ? 'עדכן התחייבות' : 'צור התחייבות'}
                </Button>
                <Button type="button" variant="ghost" onClick={resetCommitmentForm} disabled={saving}>נקה טופס</Button>
              </div>
            </div>
          </section>
        ) : (
          <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
            <div className="h-1.5 bg-blue-500" />
            <div className="p-5">
              <h3 className="text-lg font-semibold text-zinc-800">ניהול התחייבויות</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                הרשאת שינוי התחייבויות שמורה למנהלי הארגון.
              </p>
            </div>
          </section>
        )}
      </div>

      <HmoAuthorizationManager
        studentId={studentId}
        services={services}
        canMutateBilling={canMutateBilling}
        onChanged={async () => {
          await loadData();
          await notifyDataChanged();
        }}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="h-1.5 bg-amber-500" />
          <div className="p-5 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-zinc-800">תור חיוב</h3>
              <p className="text-sm text-muted-foreground">שיעורים שמחכים לשיוך התחייבות תקינה או להגדרת מחיר.</p>
            </div>

            {actionableHistory.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-muted-foreground">
                אין שיעורים שממתינים לטיפול.
              </div>
            ) : (
              <div className="space-y-3">
                {actionableHistory.map((row) => {
                  const candidates = getCandidateCommitments(row);
                  const selectedValue = resolveAssignmentValue(row);
                  return (
                    <div key={row.id} className="rounded-xl border border-border bg-slate-50/70 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-zinc-900">{formatDateTime(row.lesson_instance?.datetime_start)}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {getServiceName(services, row.lesson_instance?.service_id)} • {getParticipantStatusLabel(row.participant_status)}
                          </div>
                        </div>
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-900">
                          {getBillingStatusLabel(row.billing_status)}
                        </Badge>
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">{getBillingReasonLabel(row.billing_reason)}</div>
                      {canMutateBilling ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Select value={selectedValue} onValueChange={(value) => setAssignmentValues((current) => ({ ...current, [row.id]: value }))} disabled={saving}>
                            <SelectTrigger className="min-w-[240px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">ללא התחייבות</SelectItem>
                              {candidates.map((commitment) => (
                                <SelectItem key={commitment.id} value={commitment.id}>
                                  {getCommitmentLabel(commitment, services)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button onClick={() => handleApplyAssignment(row)} disabled={saving}>
                            {selectedValue === '__none__' ? 'נקה שיוך' : (row.commitment_id ? 'עדכן שיוך' : 'שייך')}
                          </Button>
                        </div>
                      ) : (
                        <div className="mt-3 text-sm text-zinc-700">
                          התחייבות נוכחית: {row.commitment ? getCommitmentLabel(row.commitment, services) : 'ללא התחייבות'}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {canMutateBilling ? (
          <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="h-1.5 bg-violet-500" />
          <div className="p-5 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-zinc-800">העברת יתרה</h3>
              <p className="text-sm text-muted-foreground">מעביר סכום מהתחייבות קיימת להתחייבות חדשה עבור אותו תלמיד.</p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-slate-600">התחייבות מקור</Label>
              <Select
                value={transferForm.sourceCommitmentId || '__none__'}
                onValueChange={(value) => {
                  if (value === '__none__') {
                    setTransferForm((current) => ({ ...current, sourceCommitmentId: '' }));
                    return;
                  }
                  const sourceCommitment = commitments.find((item) => item.id === value);
                  setTransferForm((current) => ({
                    ...current,
                    sourceCommitmentId: value,
                    targetServiceId: current.targetServiceId || sourceCommitment?.service_id || '',
                    targetDefaultChargeAmount: current.targetDefaultChargeAmount === '' ? (sourceCommitment?.default_charge_amount ?? '') : current.targetDefaultChargeAmount,
                    expiresAt: current.expiresAt || (sourceCommitment?.expires_at ? `${sourceCommitment.expires_at}`.slice(0, 10) : ''),
                  }));
                }}
                disabled={saving}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">בחר התחייבות</SelectItem>
                  {commitments.filter((commitment) => Number(commitment.remaining_amount || 0) > 0).map((commitment) => (
                    <SelectItem key={commitment.id} value={commitment.id}>
                      {getCommitmentLabel(commitment, services)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="transfer-amount" className="text-xs text-slate-600">סכום להעברה</Label>
                <Input id="transfer-amount" type="number" step="0.01" min="0" value={transferForm.amount} onChange={(event) => setTransferForm((current) => ({ ...current, amount: event.target.value }))} disabled={saving} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-slate-600">שירות יעד</Label>
                <Select value={transferForm.targetServiceId || '__none__'} onValueChange={(value) => setTransferForm((current) => ({ ...current, targetServiceId: value === '__none__' ? '' : value }))} disabled={saving}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">בחר שירות</SelectItem>
                    {services.map((service) => (
                      <SelectItem key={service.id} value={service.id}>{service.service_name || service.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs text-slate-600">סוג התחייבות יעד</Label>
                  <Select value={transferForm.targetCommitmentType} onValueChange={(value) => setTransferForm((current) => ({ ...current, targetCommitmentType: value }))} disabled={saving}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual_credit">הוספת יתרה מותאמת אישית</SelectItem>
                      <SelectItem value="package">חבילה</SelectItem>
                      <SelectItem value="subscription">מנוי</SelectItem>
                    </SelectContent>
                  </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="transfer-default-charge" className="text-xs text-slate-600">מחיר ברירת מחדל ביעד</Label>
                <Input id="transfer-default-charge" type="number" step="0.01" min="0" value={transferForm.targetDefaultChargeAmount} onChange={(event) => setTransferForm((current) => ({ ...current, targetDefaultChargeAmount: event.target.value }))} disabled={saving} />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="transfer-expires-at" className="text-xs text-slate-600">תוקף התחייבות יעד</Label>
                <Input id="transfer-expires-at" type="date" value={transferForm.expiresAt} onChange={(event) => setTransferForm((current) => ({ ...current, expiresAt: event.target.value }))} disabled={saving} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="transfer-notes" className="text-xs text-slate-600">הערות</Label>
                <Input id="transfer-notes" value={transferForm.notes} onChange={(event) => setTransferForm((current) => ({ ...current, notes: event.target.value }))} disabled={saving} />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleTransferBalance} disabled={saving || !transferForm.sourceCommitmentId || transferForm.amount === ''}>
                {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                צור העברה
              </Button>
            </div>
          </div>
          </section>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {canMutateBilling ? (
          <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
            <div className="h-1.5 bg-zinc-800" />
            <div className="p-5 space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-zinc-800">{entryForm.id ? 'עריכת התאמה ידנית' : 'התאמה ידנית'}</h3>
                <p className="text-sm text-muted-foreground">תנועה כספית שאינה מגיעה משיעור, למשל זיכוי או חיוב ידני.</p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs text-slate-600">סוג תנועה</Label>
                  <Select value={entryForm.sourceType} onValueChange={(value) => setEntryForm((current) => ({ ...current, sourceType: value }))} disabled={saving}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="adjustment">התאמה</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manual-entry-amount" className="text-xs text-slate-600">סכום</Label>
                  <Input id="manual-entry-amount" type="number" step="0.01" value={entryForm.amountCharged} onChange={(event) => setEntryForm((current) => ({ ...current, amountCharged: event.target.value }))} disabled={saving} />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-slate-600">התחייבות משויכת</Label>
                <Select value={entryForm.commitmentId || '__none__'} onValueChange={(value) => setEntryForm((current) => ({ ...current, commitmentId: value === '__none__' ? '' : value }))} disabled={saving}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">ללא התחייבות</SelectItem>
                    {commitments.map((commitment) => (
                      <SelectItem key={commitment.id} value={commitment.id}>
                        {getCommitmentLabel(commitment, services)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="manual-entry-date" className="text-xs text-slate-600">תאריך</Label>
                  <Input id="manual-entry-date" type="date" value={entryForm.effectiveDate} onChange={(event) => setEntryForm((current) => ({ ...current, effectiveDate: event.target.value }))} disabled={saving} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manual-entry-notes" className="text-xs text-slate-600">הערות חובה</Label>
                  <Input id="manual-entry-notes" value={entryForm.notes} onChange={(event) => setEntryForm((current) => ({ ...current, notes: event.target.value }))} disabled={saving} />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleSaveManualEntry} disabled={saving || entryForm.amountCharged === '' || !entryForm.notes.trim()}>
                  {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                  {entryForm.id ? 'עדכן התאמה' : 'שמור התאמה'}
                </Button>
                <Button type="button" variant="ghost" onClick={resetEntryForm} disabled={saving}>נקה</Button>
              </div>
            </div>
          </section>
        ) : null}

        <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="h-1.5 bg-purple-500" />
          <div className="p-5 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-zinc-800">היסטוריית תנועות</h3>
              <p className="text-sm text-muted-foreground">התאמות ידניות והעברות שכבר נרשמו.</p>
            </div>

            <div className="space-y-3">
              {entries.map((entry) => {
                const linkedTransfer = entry.transfer_ref ? transferMap.get(entry.transfer_ref) || null : null;
                return (
                  <div key={entry.id} className="rounded-xl border border-border bg-slate-50/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-zinc-900">
                          {getEntryTypeLabel(entry.source_type)} • {formatCurrency(entry.amount_charged)}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {formatDate(entry.effective_date || entry.created_at)}
                          {entry.commitment ? ` • ${getCommitmentLabel(entry.commitment, services)}` : ''}
                          {linkedTransfer?.target_commitments?.length ? ` • יעד: ${linkedTransfer.target_commitments.map((commitment) => getServiceName(services, commitment.service_id)).join(', ')}` : ''}
                          {entry.notes ? ` • ${entry.notes}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{entry.commitment_id ? 'משויך להתחייבות' : 'ללא התחייבות'}</Badge>
                        {entry.source_type === 'adjustment' && canMutateBilling ? (
                          <Button type="button" size="sm" variant="outline" onClick={() => startEditingEntry(entry)} disabled={saving}>
                            ערוך
                          </Button>
                        ) : null}
                        {entry.source_type === 'adjustment' && canMutateBilling ? (
                          <Button type="button" size="sm" variant="outline" onClick={() => handleDeleteEntry(entry.id)} disabled={saving}>
                            מחק
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
              {entries.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-muted-foreground">
                  אין תנועות להצגה.
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="h-1.5 bg-orange-500" />
        <div className="p-5 space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-zinc-800">היסטוריית חיוב שיעורים</h3>
            <p className="text-sm text-muted-foreground">כאן רואים מה חויב, מה לא חויב, ומה עדיין דורש טיפול.</p>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              טוען שיעורים...
            </div>
          ) : (
            <div className="space-y-3">
              {lessonHistory.map((row) => {
                const candidates = getCandidateCommitments(row);
                const selectedValue = resolveAssignmentValue(row);
                return (
                  <div key={row.id} className="rounded-xl border border-border bg-slate-50/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-zinc-900">{formatDateTime(row.lesson_instance?.datetime_start)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {getServiceName(services, row.lesson_instance?.service_id)} • {getParticipantStatusLabel(row.participant_status)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{getBillingStatusLabel(row.billing_status)}</Badge>
                        <Badge variant="outline">{formatCurrency(row.resolved_charge_amount ?? row.price_charged)}</Badge>
                      </div>
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">{getBillingReasonLabel(row.billing_reason)}</div>
                    <div className="mt-2 text-sm text-zinc-700">
                      התחייבות נוכחית: {row.commitment ? getCommitmentLabel(row.commitment, services) : 'ללא התחייבות'}
                    </div>
                    {canMutateBilling ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Select value={selectedValue} onValueChange={(value) => setAssignmentValues((current) => ({ ...current, [row.id]: value }))} disabled={saving}>
                          <SelectTrigger className="min-w-[240px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">ללא התחייבות</SelectItem>
                            {candidates.map((commitment) => (
                              <SelectItem key={commitment.id} value={commitment.id}>
                                {getCommitmentLabel(commitment, services)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button onClick={() => handleApplyAssignment(row)} disabled={saving}>
                          {selectedValue === '__none__' ? 'נקה שיוך' : (row.commitment_id ? 'עדכן שיוך' : 'שייך')}
                        </Button>
                      </div>
                    ) : null}
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
    </div>
  );
}
