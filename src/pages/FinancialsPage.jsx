import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Loader2, Send, Settings2 } from 'lucide-react';
import PageLayout from '@/components/ui/PageLayout.jsx';
import Card from '@/components/ui/CustomCard.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog.jsx';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useStudents } from '@/hooks/useOrgData.js';
import { upsertSetting } from '@/features/settings/api/settings.js';
import StudentBillingWorkspace from '@/features/students/components/StudentBillingWorkspace.jsx';
import BillingSettingsWorkspace from '@/features/finance/components/BillingSettingsWorkspace.jsx';
import { isAdminOrOffice, isAdminRole, normalizeMembershipRole } from '@/features/students/utils/endpoints.js';
import { toast } from 'sonner';
import { formatCurrency, toAgorot } from '@/lib/currency.js';
import { getHmoClaimFeedback, getHmoClaimValidationFeedback } from '@/features/finance/lib/hmo-claim-feedback.js';

const DEFAULT_BILLING_POLICY = {
  attended: true,
  no_show: false,
  cancelled_student: false,
  cancelled_clinic: false,
};

const DEFAULT_INSTRUCTOR_EARNINGS_POLICY = {
  attended: true,
  no_show: true,
  cancelled_student: false,
  cancelled_clinic: false,
};

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function toLocalDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatMonth(date) {
  return new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' }).format(date);
}

function formatHour(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatClaimDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'ללא תאריך';
  return parsed.toLocaleDateString('he-IL');
}

function formatClaimTimeRange(claim) {
  if (!claim?.lesson_date) return 'ללא שעה';
  const start = new Date(claim.lesson_date);
  if (Number.isNaN(start.getTime())) return 'ללא שעה';
  const durationMinutes = Number(claim.lesson_duration_minutes) || 0;
  const end = new Date(start.getTime() + durationMinutes * 60000);
  const startLabel = formatHour(start.toISOString());
  const endLabel = formatHour(end.toISOString());
  if (!startLabel || !endLabel) return 'ללא שעה';
  return `${startLabel} - ${endLabel}`;
}

function resolveClaimWorkflowState(claim) {
  const participantStatus = `${claim?.participant_status || ''}`.toLowerCase();
  const claimStatus = `${claim?.status || ''}`.toLowerCase();
  if (participantStatus === 'scheduled') {
    return {
      key: 'cancelled',
      label: 'בוטל',
      className: 'bg-slate-200 text-slate-800',
    };
  }
  if (claimStatus === 'resolved') {
    return {
      key: 'resolved',
      label: 'טופל',
      className: 'bg-emerald-100 text-emerald-900',
    };
  }
  return {
    key: 'open',
    label: 'פתוח',
    className: 'bg-amber-100 text-amber-900',
  };
}

function formatBatchStatus(status) {
  switch (`${status || ''}`.toLowerCase()) {
    case 'draft': return 'טיוטה';
    case 'issued':
    case 'submitted': return 'נשלח';
    case 'acknowledged': return 'אושר קבלה';
    case 'partially_paid': return 'שולם חלקית';
    case 'paid': return 'שולם';
    case 'disputed': return 'במחלוקת';
    case 'closed': return 'סגור';
    case 'cancelled': return 'בוטל';
    default: return status || 'לא ידוע';
  }
}

function showHmoClaimToast(error, options = {}) {
  const feedback = getHmoClaimFeedback(error, options);
  toast.error(feedback.title, {
    description: feedback.description,
    duration: 7000,
  });
}

function showHmoClaimValidationToast(kind) {
  const feedback = getHmoClaimValidationFeedback(kind);
  toast.error(feedback.title, {
    description: feedback.description,
    duration: 7000,
  });
}

function groupClaimsByStudent(claims = []) {
  const grouped = new Map();
  for (const claim of Array.isArray(claims) ? claims : []) {
    const studentId = claim?.student_id || claim?.lesson_participant_id || claim?.id;
    const studentName = claim?.student_name || 'לקוח/ה';
    if (!grouped.has(studentId)) {
      grouped.set(studentId, {
        studentId,
        studentName,
        claims: [],
      });
    }
    grouped.get(studentId).claims.push(claim);
  }

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      claims: group.claims.slice().sort((left, right) => new Date(left?.lesson_date || 0).getTime() - new Date(right?.lesson_date || 0).getTime()),
    }))
    .sort((left, right) => left.studentName.localeCompare(right.studentName, 'he'));
}

function buildClaimSubmitForm() {
  return {
    externalReference: '',
    externalLink: '',
    notes: '',
  };
}

function buildStudentName(student) {
  const explicitName = typeof student?.full_name === 'string' ? student.full_name.trim() : '';
  if (explicitName) return explicitName;
  return [student?.first_name, student?.middle_name, student?.last_name].filter(Boolean).join(' ').trim() || 'תלמיד';
}

function buildOverview(snapshot) {
  const summaries = Array.isArray(snapshot?.student_summaries) ? snapshot.student_summaries : [];
  return summaries.reduce((accumulator, row) => ({
    studentCount: accumulator.studentCount + 1,
    balanceTotal: accumulator.balanceTotal + Number(row?.balance || 0),
    lessonChargeTotal: accumulator.lessonChargeTotal + Number(row?.lesson_charge_total || 0),
    hmoChargeTotal: accumulator.hmoChargeTotal + Number(row?.hmo_charge_total || 0),
    activeAuthorizationCount: accumulator.activeAuthorizationCount + (Array.isArray(row?.authorizations) ? row.authorizations.length : 0),
  }), {
    studentCount: 0,
    balanceTotal: 0,
    lessonChargeTotal: 0,
    hmoChargeTotal: 0,
    activeAuthorizationCount: 0,
  });
}

export default function FinancialsPage() {
  const { session } = useAuth();
  const { activeOrg, activeOrgId } = useOrg();
  const membershipRole = normalizeMembershipRole(activeOrg?.membership?.role);
  const canViewFinancials = isAdminOrOffice(membershipRole);
  const canMutateBillingPolicy = isAdminRole(membershipRole);

  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()));
  const [loadingPayroll, setLoadingPayroll] = useState(false);
  const [loadingBilling, setLoadingBilling] = useState(false);
  const [loadingClaims, setLoadingClaims] = useState(false);
  const [payroll, setPayroll] = useState(null);
  const [billingSnapshot, setBillingSnapshot] = useState(null);
  const [claimsReadModel, setClaimsReadModel] = useState(null);
  const [studentSearch, setStudentSearch] = useState('');
  const deferredStudentSearch = useDeferredValue(studentSearch);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [billingPolicy, setBillingPolicy] = useState(DEFAULT_BILLING_POLICY);
  const [instructorEarningsPolicy, setInstructorEarningsPolicy] = useState(DEFAULT_INSTRUCTOR_EARNINGS_POLICY);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [processingClaimBatch, setProcessingClaimBatch] = useState(false);
  const [savingProviderPolicy, setSavingProviderPolicy] = useState(false);
  const [selectedClaimLedgerIds, setSelectedClaimLedgerIds] = useState(() => new Set());
  const [batchPaymentForms, setBatchPaymentForms] = useState({});
  const [providerPolicyForms, setProviderPolicyForms] = useState({});
  const [submitClaimBatchDialog, setSubmitClaimBatchDialog] = useState(null);
  const [submitClaimBatchForm, setSubmitClaimBatchForm] = useState(() => buildClaimSubmitForm());
  const [isBillingPolicyOpen, setIsBillingPolicyOpen] = useState(false);
  const [confirmPolicySave, setConfirmPolicySave] = useState(false);

  const monthStart = useMemo(() => toLocalDateString(startOfMonth(monthDate)), [monthDate]);
  const monthEnd = useMemo(() => toLocalDateString(endOfMonth(monthDate)), [monthDate]);

  const canMutateClaims = canMutateBillingPolicy;

  const { students } = useStudents({
    enabled: Boolean(activeOrgId && canViewFinancials),
    orgId: activeOrgId,
    session,
    search: deferredStudentSearch,
  });

  const loadPayroll = useCallback(async () => {
    if (!activeOrgId || !canViewFinancials) {
      setPayroll(null);
      return;
    }

    setLoadingPayroll(true);
    try {
      const payload = await authenticatedFetch('payroll', {
        session,
        params: { org_id: activeOrgId, start_date: monthStart, end_date: monthEnd },
      });
      setPayroll(payload || null);
    } catch (error) {
      console.error('Failed to load payroll page data', error);
      toast.error(error?.message || 'טעינת נתוני השכר נכשלה.');
      setPayroll(null);
    } finally {
      setLoadingPayroll(false);
    }
  }, [activeOrgId, canViewFinancials, monthEnd, monthStart, session]);

  const loadBillingOverview = useCallback(async () => {
    if (!activeOrgId || !canViewFinancials) {
      setBillingSnapshot(null);
      setBillingPolicy(DEFAULT_BILLING_POLICY);
      setInstructorEarningsPolicy(DEFAULT_INSTRUCTOR_EARNINGS_POLICY);
      return;
    }

    setLoadingBilling(true);
    try {
      const payload = await authenticatedFetch('billing', {
        session,
        params: { org_id: activeOrgId, start_date: monthStart, end_date: monthEnd },
      });
      setBillingSnapshot(payload || null);
      setBillingPolicy({
        ...DEFAULT_BILLING_POLICY,
        ...(payload?.policies?.billing_consumption_policy || {}),
      });
      setInstructorEarningsPolicy({
        ...DEFAULT_INSTRUCTOR_EARNINGS_POLICY,
        ...(payload?.policies?.instructor_earnings_policy || {}),
      });
    } catch (error) {
      console.error('Failed to load billing overview', error);
      toast.error(error?.message || 'טעינת נתוני החיובים נכשלה.');
      setBillingSnapshot(null);
      setBillingPolicy(DEFAULT_BILLING_POLICY);
      setInstructorEarningsPolicy(DEFAULT_INSTRUCTOR_EARNINGS_POLICY);
    } finally {
      setLoadingBilling(false);
    }
  }, [activeOrgId, canViewFinancials, monthEnd, monthStart, session]);

  const loadHmoClaimsOverview = useCallback(async () => {
    if (!activeOrgId || !canViewFinancials) {
      setClaimsReadModel(null);
      return;
    }

    setLoadingClaims(true);
    try {
      const payload = await authenticatedFetch('billing', {
        session,
        params: {
          org_id: activeOrgId,
          view: 'hmo_claims',
          start_date: monthStart,
          end_date: monthEnd,
        },
      });
      setClaimsReadModel(payload || null);
    } catch (error) {
      console.error('Failed to load HMO claims overview', error);
      toast.error(error?.message || 'טעינת נתוני תביעות HMO נכשלה.');
      setClaimsReadModel(null);
    } finally {
      setLoadingClaims(false);
    }
  }, [activeOrgId, canViewFinancials, monthEnd, monthStart, session]);

  useEffect(() => {
    if (!canViewFinancials) {
      return undefined;
    }
    void loadPayroll();
    void loadBillingOverview();
    void loadHmoClaimsOverview();
    return undefined;
  }, [canViewFinancials, loadBillingOverview, loadHmoClaimsOverview, loadPayroll]);

  const overview = useMemo(() => buildOverview(billingSnapshot), [billingSnapshot]);

  const groupedClaims = useMemo(
    () => groupClaimsByStudent(claimsReadModel?.claims || []),
    [claimsReadModel],
  );

  const claimableClaims = useMemo(() => (
    (claimsReadModel?.claims || []).filter((claim) => (
      claim?.ledger_transaction_id
      && claim?.hmo_provider_id
      && claim?.hmo_authorization_id
      && !claim?.hmo_invoice_batch_id
      && String(claim?.participant_status || '').toLowerCase() === 'attended'
      && String(claim?.claim_workflow_status || 'claimable').toLowerCase() === 'claimable'
    ))
  ), [claimsReadModel]);

  const claimableLedgerIds = useMemo(
    () => new Set(claimableClaims.map((claim) => claim.ledger_transaction_id)),
    [claimableClaims],
  );

  const claimableClaimsByProvider = useMemo(() => {
    const groups = new Map();
    for (const claim of claimableClaims) {
      const providerId = claim?.hmo_provider_id || '';
      if (!providerId) continue;
      if (!groups.has(providerId)) {
        groups.set(providerId, {
          providerId,
          providerName: claim?.hmo_provider_name || 'גורם מממן',
          claims: [],
        });
      }
      groups.get(providerId).claims.push(claim);
    }
    return Array.from(groups.values()).sort((left, right) => left.providerName.localeCompare(right.providerName, 'he'));
  }, [claimableClaims]);

  const providerReceivableById = useMemo(() => new Map((claimsReadModel?.provider_receivables || [])
    .map((provider) => [provider.hmo_provider_id, provider])), [claimsReadModel]);

  useEffect(() => {
    setSelectedClaimLedgerIds((prev) => {
      const allowed = new Set(claimableClaims.map((claim) => claim.ledger_transaction_id));
      const next = new Set(Array.from(prev).filter((id) => allowed.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [claimableClaims]);

  useEffect(() => {
    const next = {};
    for (const provider of claimsReadModel?.provider_receivables || []) {
      const policy = provider?.claim_policy || {};
      next[provider.hmo_provider_id] = {
        claim_submission_mode: policy.submission_mode || 'amount',
        claim_payment_timing: policy.payment_timing || 'after_submission',
        claim_reference_required: policy.reference_required === true,
        claim_period_granularity: policy.period_granularity || 'monthly',
        claim_payment_matching_mode: policy.payment_matching_mode || 'batch_amount',
      };
    }
    setProviderPolicyForms(next);
  }, [claimsReadModel]);

  const studentOptions = useMemo(() => {
    const normalizedSearch = deferredStudentSearch.trim().toLowerCase();
    const map = new Map();

    const addStudent = (candidate) => {
      const id = candidate?.id || candidate?.student_id || '';
      if (!id) return;
      const existing = map.get(id) || {};
      const merged = {
        ...existing,
        ...candidate,
        id,
      };
      merged.full_name = buildStudentName(merged);
      map.set(id, merged);
    };

    for (const row of students || []) {
      addStudent(row);
    }

    for (const row of billingSnapshot?.student_summaries || []) {
      addStudent({ ...(row.student || {}), id: row.student_id || row?.student?.id, summary: row });
    }

    return Array.from(map.values())
      .filter((row) => !normalizedSearch || row.full_name.toLowerCase().includes(normalizedSearch))
      .sort((left, right) => left.full_name.localeCompare(right.full_name, 'he'));
  }, [billingSnapshot, deferredStudentSearch, students]);

  useEffect(() => {
    if (selectedStudentId && studentOptions.some((student) => student.id === selectedStudentId)) {
      return;
    }
    setSelectedStudentId(studentOptions[0]?.id || '');
  }, [selectedStudentId, studentOptions]);

  const selectedStudent = useMemo(
    () => studentOptions.find((student) => student.id === selectedStudentId) || null,
    [selectedStudentId, studentOptions],
  );

  async function handleSaveBillingPolicy() {
    if (!activeOrgId || !canMutateBillingPolicy) {
      return;
    }

    setSavingPolicy(true);
    try {
      await upsertSetting({
        session,
        orgId: activeOrgId,
        key: 'billing_consumption_policy',
        value: billingPolicy,
      });
      await upsertSetting({
        session,
        orgId: activeOrgId,
        key: 'instructor_earnings_policy',
        value: instructorEarningsPolicy,
      });
      await loadBillingOverview();
      toast.success('מדיניות החיוב נשמרה.');
    } catch (error) {
      console.error('Failed to save billing policy', error);
      toast.error(error?.message || 'שמירת מדיניות החיוב נכשלה.');
    } finally {
      setSavingPolicy(false);
    }
  }

  function toggleClaimSelection(ledgerTransactionId, checked) {
    const normalizedId = String(ledgerTransactionId || '');
    if (!normalizedId) return;
    setSelectedClaimLedgerIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(normalizedId);
      } else {
        next.delete(normalizedId);
      }
      return next;
    });
  }

  function selectProviderClaimLines(providerId) {
    const providerClaims = claimableClaims.filter((claim) => claim.hmo_provider_id === providerId);
    setSelectedClaimLedgerIds(new Set(providerClaims.map((claim) => claim.ledger_transaction_id)));
  }

  function updateBatchPaymentForm(batchId, patch) {
    setBatchPaymentForms((prev) => ({
      ...prev,
      [batchId]: {
        amount: '',
        effectiveAt: '',
        externalReference: '',
        notes: '',
        ...(prev[batchId] || {}),
        ...patch,
      },
    }));
  }

  function updateProviderPolicyForm(providerId, patch) {
    setProviderPolicyForms((prev) => ({
      ...prev,
      [providerId]: {
        claim_submission_mode: 'amount',
        claim_payment_timing: 'after_submission',
        claim_reference_required: false,
        claim_period_granularity: 'monthly',
        claim_payment_matching_mode: 'batch_amount',
        ...(prev[providerId] || {}),
        ...patch,
      },
    }));
  }

  async function handleCreateClaimBatch() {
    if (!activeOrgId || !canMutateClaims) return;
    const selectedClaims = claimableClaims.filter((claim) => selectedClaimLedgerIds.has(claim.ledger_transaction_id));
    const ledgerTransactionIds = selectedClaims.map((claim) => claim.ledger_transaction_id);
    if (ledgerTransactionIds.length === 0) {
      showHmoClaimValidationToast('no_selection');
      return;
    }
    if (ledgerTransactionIds.length !== selectedClaimLedgerIds.size) {
      const feedback = getHmoClaimValidationFeedback('stale_selection');
      toast.info(feedback.title, { description: feedback.description, duration: 7000 });
    }
    const providerIds = Array.from(new Set(selectedClaims.map((claim) => claim.hmo_provider_id).filter(Boolean)));
    if (providerIds.length !== 1) {
      showHmoClaimValidationToast('mixed_providers');
      return;
    }

    setProcessingClaimBatch(true);
    try {
      const result = await authenticatedFetch('billing', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          action: 'create_hmo_claim_batch',
          hmo_provider_id: providerIds[0],
          ledger_transaction_ids: ledgerTransactionIds,
        },
      });
      setSelectedClaimLedgerIds(new Set());
      await loadHmoClaimsOverview();
      toast.success(`נוצרה טיוטת דרישה עם ${result?.claimCount || ledgerTransactionIds.length} שורות.`);
    } catch (error) {
      console.error('Failed to create HMO claim batch', error);
      showHmoClaimToast(error, { scope: 'claim' });
    } finally {
      setProcessingClaimBatch(false);
    }
  }

  function handleOpenSubmitClaimBatch(batch) {
    if (!batch?.id || !canMutateClaims) return;
    setSubmitClaimBatchDialog(batch);
    setSubmitClaimBatchForm({
      externalReference: batch?.external_reference || '',
      externalLink: batch?.external_link || '',
      notes: batch?.notes || '',
    });
  }

  async function handleSubmitClaimBatch() {
    if (!activeOrgId || !canMutateClaims || !submitClaimBatchDialog?.id) return;
    setProcessingClaimBatch(true);
    try {
      await authenticatedFetch('billing', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          action: 'submit_hmo_claim_batch',
          batch_id: submitClaimBatchDialog.id,
          external_reference: submitClaimBatchForm.externalReference || null,
          external_link: submitClaimBatchForm.externalLink || null,
          notes: submitClaimBatchForm.notes || null,
        },
      });
      setSubmitClaimBatchDialog(null);
      setSubmitClaimBatchForm(buildClaimSubmitForm());
      await loadHmoClaimsOverview();
      toast.success('הדרישה סומנה כנשלחה וננעלה לעריכה רגילה.');
    } catch (error) {
      console.error('Failed to submit HMO claim batch', error);
      showHmoClaimToast(error, { scope: 'submit' });
    } finally {
      setProcessingClaimBatch(false);
    }
  }

  async function handleCancelClaimBatch(batch) {
    if (!activeOrgId || !canMutateClaims || !batch?.id) return;
    const approved = window.confirm('לבטל את הדרישה? השורות יחזרו להיות זמינות ליצירת דרישה חדשה. לא ניתן לבטל דרישה שכבר שולם עליה.');
    if (!approved) return;

    setProcessingClaimBatch(true);
    try {
      await authenticatedFetch('billing', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          action: 'cancel_hmo_claim_batch',
          batch_id: batch.id,
          reason: 'cancelled_from_financials_page',
        },
      });
      await loadHmoClaimsOverview();
      toast.success('הדרישה בוטלה והשורות שוחררו.');
    } catch (error) {
      console.error('Failed to cancel HMO claim batch', error);
      showHmoClaimToast(error, { scope: 'cancel' });
    } finally {
      setProcessingClaimBatch(false);
    }
  }

  async function handleRecordBatchPayment(batch) {
    if (!activeOrgId || !canMutateClaims || !batch?.id) return;
    const form = batchPaymentForms[batch.id] || {};
    const amountAgorot = toAgorot(form.amount);
    const remainingAmount = Math.max(0, Number(batch.total_amount || 0) - Number(batch.paid_amount || 0));
    const provider = providerReceivableById.get(batch.hmo_provider_id);
    const requiresReference = provider?.claim_policy?.reference_required === true;

    if (!Number.isFinite(amountAgorot) || amountAgorot <= 0) {
      showHmoClaimValidationToast('invalid_payment_amount');
      return;
    }
    if (amountAgorot > remainingAmount) {
      showHmoClaimValidationToast('payment_above_balance');
      return;
    }
    if (requiresReference && !String(form.externalReference || '').trim()) {
      showHmoClaimValidationToast('missing_payment_reference');
      return;
    }

    setProcessingClaimBatch(true);
    try {
      await authenticatedFetch('billing', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          action: 'record_hmo_batch_payment',
          batch_id: batch.id,
          amount: amountAgorot,
          effective_at: form.effectiveAt || null,
          external_reference: form.externalReference || null,
          notes: form.notes || null,
        },
      });
      setBatchPaymentForms((prev) => ({
        ...prev,
        [batch.id]: { amount: '', effectiveAt: '', externalReference: '', notes: '' },
      }));
      await loadHmoClaimsOverview();
      toast.success('התשלום נרשם מול הדרישה.');
    } catch (error) {
      console.error('Failed to record HMO batch payment', error);
      showHmoClaimToast(error, { scope: 'payment' });
    } finally {
      setProcessingClaimBatch(false);
    }
  }

  async function handleSaveProviderPolicy(providerId) {
    if (!activeOrgId || !canMutateClaims || !providerId) return;
    const form = providerPolicyForms[providerId] || {};
    setSavingProviderPolicy(true);
    try {
      await authenticatedFetch('billing', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          action: 'update_hmo_provider_claim_policy',
          hmo_provider_id: providerId,
          ...form,
        },
      });
      await loadHmoClaimsOverview();
      toast.success('הגדרות הגורם המממן נשמרו.');
    } catch (error) {
      console.error('Failed to save HMO provider policy', error);
      toast.error(error?.message || 'שמירת הגדרות הגורם המממן נכשלה.');
    } finally {
      setSavingProviderPolicy(false);
    }
  }

  if (!canViewFinancials) {
    return (
      <PageLayout title="כספים" description="שכר עובדים וחיובי תלמידים">
        <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-900">אין הרשאה למסך הכספים</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            למסך זה יש הרשאת גישה רק למנהלי הארגון ולאנשי משרד.
          </p>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="כספים" description="שכר עובדים וחיובי תלמידים">
      <Dialog
        open={Boolean(submitClaimBatchDialog)}
        onOpenChange={(open) => {
          if (processingClaimBatch) return;
          if (!open) {
            setSubmitClaimBatchDialog(null);
            setSubmitClaimBatchForm(buildClaimSubmitForm());
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>שליחת דרישת HMO</DialogTitle>
            <DialogDescription>
              משלימים את פרטי השליחה לדרישה ורק אז מסמנים אותה כנשלחה. לאחר מכן הדרישה ננעלת לשימוש רגיל.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-slate-50 p-3 text-sm">
              <div className="font-semibold text-zinc-900">{submitClaimBatchDialog?.hmo_provider_name || 'גורם מממן'}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {submitClaimBatchDialog ? `${submitClaimBatchDialog.item_count || 0} שורות • ${formatCurrency(submitClaimBatchDialog.total_amount)}` : ''}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-900" htmlFor="submit-claim-reference">אסמכתא חיצונית</label>
              <Input
                id="submit-claim-reference"
                value={submitClaimBatchForm.externalReference}
                onChange={(event) => setSubmitClaimBatchForm((prev) => ({ ...prev, externalReference: event.target.value }))}
                placeholder="מספר דרישה / אסמכתא"
                disabled={processingClaimBatch}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-900" htmlFor="submit-claim-link">קישור חיצוני</label>
              <Input
                id="submit-claim-link"
                dir="ltr"
                type="url"
                placeholder="https://"
                value={submitClaimBatchForm.externalLink}
                onChange={(event) => setSubmitClaimBatchForm((prev) => ({ ...prev, externalLink: event.target.value }))}
                disabled={processingClaimBatch}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-900" htmlFor="submit-claim-notes">הערות</label>
              <Input
                id="submit-claim-notes"
                value={submitClaimBatchForm.notes}
                onChange={(event) => setSubmitClaimBatchForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="הערה פנימית או תיעוד אופציונלי"
                disabled={processingClaimBatch}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="button" onClick={handleSubmitClaimBatch} disabled={processingClaimBatch}>
              {processingClaimBatch && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              סמן כנשלח
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSubmitClaimBatchDialog(null);
                setSubmitClaimBatchForm(buildClaimSubmitForm());
              }}
              disabled={processingClaimBatch}
            >
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setMonthDate(addMonths(monthDate, -1))}>הקודם</Button>
          <div className="min-w-[160px] text-center text-sm font-semibold text-zinc-700">{formatMonth(monthDate)}</div>
          <Button size="sm" variant="outline" onClick={() => setMonthDate(addMonths(monthDate, 1))}>הבא</Button>
        </div>
        <Button type="button" variant="outline" onClick={() => setIsBillingPolicyOpen(true)}>
          <Settings2 className="me-2 h-4 w-4" />
          הגדרות חיוב
        </Button>
      </div>

      <Tabs defaultValue="payroll" className="space-y-4">
        <TabsList className="h-auto rounded-2xl bg-slate-100 p-1">
          <TabsTrigger value="payroll" className="rounded-xl px-4 py-2">שכר</TabsTrigger>
          <TabsTrigger value="billing" className="rounded-xl px-4 py-2">חיובי תלמידים</TabsTrigger>
          <TabsTrigger value="claims" className="rounded-xl px-4 py-2">תביעות HMO</TabsTrigger>
        </TabsList>

        <TabsContent value="payroll">
          <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
            {loadingPayroll ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                טוען נתוני שכר...
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                    <div className="text-xs text-blue-700">בסיס</div>
                    <div className="mt-1 text-xl font-bold text-blue-950">{formatCurrency(payroll?.totals?.base_amount)}</div>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="text-xs text-emerald-700">חופשה בתשלום</div>
                    <div className="mt-1 text-xl font-bold text-emerald-950">{formatCurrency(payroll?.totals?.paid_leave_amount)}</div>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <div className="text-xs text-amber-700">תיקונים</div>
                    <div className="mt-1 text-xl font-bold text-amber-950">{formatCurrency(payroll?.totals?.correction_amount)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-900 bg-slate-900 p-4 text-white">
                    <div className="text-xs text-slate-300">סה״כ</div>
                    <div className="mt-1 text-xl font-bold">{formatCurrency(payroll?.totals?.total_amount)}</div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="pb-2 text-start font-medium">עובד</th>
                        <th className="pb-2 text-start font-medium">מודל</th>
                        <th className="pb-2 text-start font-medium">בסיס</th>
                        <th className="pb-2 text-start font-medium">חופשה</th>
                        <th className="pb-2 text-start font-medium">תיקונים</th>
                        <th className="pb-2 text-start font-medium">סה״כ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(payroll?.employees || []).map((row) => (
                        <tr key={row.employee_id} className="border-b border-border/60">
                          <td className="py-3 font-medium">{row.employee_name}</td>
                          <td className="py-3">{row.payroll_model}</td>
                          <td className="py-3">{formatCurrency(row.base_amount)}</td>
                          <td className="py-3">{formatCurrency(row.paid_leave_amount)}</td>
                          <td className="py-3">{formatCurrency(row.correction_amount)}</td>
                          <td className="py-3 font-semibold">{formatCurrency(row.total_amount)}</td>
                        </tr>
                      ))}
                      {(payroll?.employees || []).length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                            אין נתוני שכר להצגה בטווח החודש הנבחר.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="billing" className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
              <div className="text-xs text-slate-600">תלמידים במעקב</div>
              <div className="mt-1 text-2xl font-bold text-zinc-900">{overview.studentCount}</div>
            </Card>
            <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
              <div className="text-xs text-blue-700">יתרת ספרים מצטברת</div>
              <div className="mt-1 text-2xl font-bold text-blue-950">{formatCurrency(overview.balanceTotal)}</div>
            </Card>
            <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
              <div className="text-xs text-emerald-700">חיובי תלמידים בחודש</div>
              <div className="mt-1 text-2xl font-bold text-emerald-950">{formatCurrency(overview.lessonChargeTotal)}</div>
            </Card>
            <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
              <div className="text-xs text-indigo-700">חיובי גורמים מממנים בחודש</div>
              <div className="mt-1 text-2xl font-bold text-indigo-950">{formatCurrency(overview.hmoChargeTotal)}</div>
              <div className="mt-2 text-xs text-muted-foreground">{overview.activeAuthorizationCount} אישורים פעילים בתצוגה</div>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
            <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold text-zinc-900">בחירת תלמיד</h3>
                  <p className="text-sm text-muted-foreground">רשימת העבודה בנויה ישירות מסיכומי הלדר.</p>
                </div>

                <Input
                  value={studentSearch}
                  onChange={(event) => setStudentSearch(event.target.value)}
                  placeholder="חיפוש לפי שם תלמיד"
                />

                <div className="space-y-3">
                  {studentOptions.map((row) => {
                    const summary = row.summary || {};
                    const isSelected = row.id === selectedStudentId;
                    return (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => setSelectedStudentId(row.id)}
                        className={`w-full rounded-xl border p-4 text-start transition ${
                          isSelected
                            ? 'border-zinc-900 bg-zinc-900 text-white'
                            : 'border-border bg-slate-50 hover:border-zinc-400'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold">{row.full_name}</div>
                          <div className={`rounded-full px-2 py-0.5 text-xs ${isSelected ? 'bg-white/15 text-white' : 'bg-slate-200 text-slate-700'}`}>
                            {formatCurrency(summary.balance)}
                          </div>
                        </div>
                        <div className={`mt-2 text-xs ${isSelected ? 'text-white/80' : 'text-muted-foreground'}`}>
                          חיובי תלמיד {formatCurrency(summary.lesson_charge_total)} • חיובי HMO {formatCurrency(summary.hmo_charge_total)}
                        </div>
                        <div className={`mt-1 text-xs ${isSelected ? 'text-white/70' : 'text-muted-foreground'}`}>
                          {Array.isArray(summary.authorizations) && summary.authorizations.length > 0
                            ? `${summary.authorizations.length} אישורי HMO פעילים`
                            : 'ללא אישור HMO פעיל'}
                        </div>
                      </button>
                    );
                  })}

                  {!loadingBilling && studentOptions.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-muted-foreground">
                      אין תלמידים להצגה עבור החיפוש הנוכחי.
                    </div>
                  ) : null}
                </div>
              </div>
            </Card>

            <div className="space-y-4">
              {selectedStudentId ? (
                <StudentBillingWorkspace
                  studentId={selectedStudentId}
                  student={selectedStudent}
                  startDate={monthStart}
                  endDate={monthEnd}
                  onDataChanged={loadBillingOverview}
                />
              ) : (
                <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
                  {loadingBilling ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      טוען נתוני חיוב...
                    </div>
                  ) : (
                    <>
                      <h3 className="text-lg font-semibold text-zinc-900">בחר תלמיד לעבודה</h3>
                      <p className="mt-2 text-sm text-muted-foreground">
                        מסך זה עובר ללדר מרכזי בלבד. כל יתרה, תשלום וחיוב משוקפים מהלדר ולא ממטמון נפרד.
                      </p>
                    </>
                  )}
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="claims" className="space-y-4">
          {loadingClaims ? (
            <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                טוען נתוני תביעות HMO...
              </div>
            </Card>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-5">
                <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
                  <div className="text-xs text-slate-600">סה״כ משימות תביעה</div>
                  <div className="mt-1 text-2xl font-bold text-zinc-900">{claimsReadModel?.summary?.total_claim_tasks ?? 0}</div>
                </Card>
                <Card className="rounded-2xl border border-amber-200 bg-amber-50 p-lg shadow-sm">
                  <div className="text-xs text-amber-700">משימות פתוחות</div>
                  <div className="mt-1 text-2xl font-bold text-amber-950">{claimsReadModel?.summary?.open_claim_tasks ?? 0}</div>
                </Card>
                <Card className="rounded-2xl border border-emerald-200 bg-emerald-50 p-lg shadow-sm">
                  <div className="text-xs text-emerald-700">משימות שטופלו</div>
                  <div className="mt-1 text-2xl font-bold text-emerald-950">{claimsReadModel?.summary?.resolved_claim_tasks ?? 0}</div>
                </Card>
                <Card className="rounded-2xl border border-indigo-200 bg-indigo-50 p-lg shadow-sm">
                  <div className="text-xs text-indigo-700">תלמידים עם תביעות</div>
                  <div className="mt-1 text-2xl font-bold text-indigo-950">{claimsReadModel?.summary?.unique_students ?? 0}</div>
                </Card>
                <Card className="rounded-2xl border border-blue-200 bg-blue-50 p-lg shadow-sm">
                  <div className="text-xs text-blue-700">גורמים מממנים בתצוגה</div>
                  <div className="mt-1 text-2xl font-bold text-blue-950">{claimsReadModel?.summary?.provider_count ?? 0}</div>
                </Card>
              </div>

              {Array.isArray(claimsReadModel?.notices) && claimsReadModel.notices.length > 0 && (
                <Card className="rounded-2xl border border-amber-300 bg-amber-50 p-lg shadow-sm">
                  <p className="text-sm font-semibold text-amber-900">הערות מערכת</p>
                  <ul className="mt-2 list-disc pe-5 text-xs text-amber-800 space-y-1">
                    {claimsReadModel.notices.map((notice) => (
                      <li key={notice}>{notice}</li>
                    ))}
                  </ul>
                </Card>
              )}

              {canMutateClaims && (
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
                    <h3 className="text-lg font-semibold text-zinc-900">יצירת דרישת HMO</h3>
                    <p className="text-sm text-muted-foreground">
                      בוחרים שורות פתוחות מאותו גורם מממן, יוצרים טיוטה, ואז שולחים אותה. שורה שנכנסה לטיוטה לא תיכנס בטעות לדרישה נוספת.
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        onClick={handleCreateClaimBatch}
                        disabled={processingClaimBatch || selectedClaimLedgerIds.size === 0}
                      >
                        {processingClaimBatch && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                        צור טיוטה מ־{selectedClaimLedgerIds.size} שורות
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={claimableClaims.length === 0}
                        onClick={() => {
                          if (claimableClaimsByProvider.length === 1) {
                            selectProviderClaimLines(claimableClaimsByProvider[0].providerId);
                          } else {
                            toast.error('בחר גורם מממן אחד מהרשימה למטה. לא מערבבים גורמים מממנים באותה דרישה.');
                          }
                        }}
                      >
                        בחר שורות פתוחות
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setSelectedClaimLedgerIds(new Set())}>
                        נקה בחירה
                      </Button>
                    </div>
                    {claimableClaimsByProvider.length > 0 && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {claimableClaimsByProvider.map((group) => (
                          <button
                            key={group.providerId}
                            type="button"
                            className="rounded-xl border border-border bg-slate-50 px-3 py-2 text-right text-sm hover:bg-slate-100"
                            onClick={() => selectProviderClaimLines(group.providerId)}
                          >
                            <span className="block font-semibold text-zinc-900">{group.providerName}</span>
                            <span className="text-xs text-muted-foreground">{group.claims.length} שורות פתוחות לבחירה</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="mt-3 text-xs text-slate-500">
                      טיפ תפעולי: אם יש כמה קופות/גורמים מממנים, יוצרים דרישה נפרדת לכל אחד כדי למנוע ערבוב בתשלום ובבקרה.
                    </p>
                  </Card>

                  <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
                    <h3 className="text-lg font-semibold text-zinc-900">טיוטות ודרישות שנוצרו</h3>
                    <p className="text-sm text-muted-foreground">דרישה בסטטוס טיוטה עדיין לא ננעלה. לאחר שליחה היא משמשת לבקרה מול התשלום.</p>
                    <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                      {(claimsReadModel?.invoice_batches || []).map((batch) => (
                        <div key={batch.id} className="rounded-xl border border-border bg-slate-50 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-zinc-900">{batch.hmo_provider_name || 'גורם מממן'}</div>
                              <div className="text-xs text-muted-foreground">
                                {batch.item_count || 0} שורות • {formatCurrency(batch.total_amount)} • סטטוס: {formatBatchStatus(batch.status)}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {batch.status === 'draft' && (
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => handleOpenSubmitClaimBatch(batch)}
                                  disabled={processingClaimBatch}
                                >
                                  <Send className="me-2 h-4 w-4" />
                                  סמן כנשלח
                                </Button>
                              )}
                              {['draft', 'submitted', 'issued', 'acknowledged'].includes(batch.status) && Number(batch.paid_amount || 0) === 0 && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleCancelClaimBatch(batch)}
                                  disabled={processingClaimBatch}
                                >
                                  בטל
                                </Button>
                              )}
                            </div>
                          </div>
                          {['submitted', 'issued', 'acknowledged', 'partially_paid'].includes(batch.status) && Number(batch.paid_amount || 0) < Number(batch.total_amount || 0) && (
                            <div className="mt-3 rounded-lg border border-blue-100 bg-white p-3">
                              <div className="text-xs font-semibold text-zinc-900">
                                רישום תשלום לדרישה הזאת בלבד
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                יתרה פתוחה: {formatCurrency(Math.max(0, Number(batch.total_amount || 0) - Number(batch.paid_amount || 0)))}
                              </div>
                              <div className="mt-2 grid gap-2 md:grid-cols-4">
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={batchPaymentForms[batch.id]?.amount || ''}
                                  onChange={(event) => updateBatchPaymentForm(batch.id, { amount: event.target.value })}
                                  placeholder="סכום בש״ח"
                                />
                                <Input
                                  type="date"
                                  value={batchPaymentForms[batch.id]?.effectiveAt || ''}
                                  onChange={(event) => updateBatchPaymentForm(batch.id, { effectiveAt: event.target.value })}
                                />
                                <Input
                                  value={batchPaymentForms[batch.id]?.externalReference || ''}
                                  onChange={(event) => updateBatchPaymentForm(batch.id, { externalReference: event.target.value })}
                                  placeholder="אסמכתא"
                                />
                                <Button
                                  type="button"
                                  onClick={() => handleRecordBatchPayment(batch)}
                                  disabled={processingClaimBatch}
                                >
                                  רשום תשלום
                                </Button>
                              </div>
                              <Input
                                className="mt-2"
                                value={batchPaymentForms[batch.id]?.notes || ''}
                                onChange={(event) => updateBatchPaymentForm(batch.id, { notes: event.target.value })}
                                placeholder="הערת תשלום (אופציונלי)"
                              />
                            </div>
                          )}
                        </div>
                      ))}
                      {(claimsReadModel?.invoice_batches || []).length === 0 && (
                        <div className="rounded-xl border border-dashed border-border bg-slate-50 p-4 text-center text-sm text-muted-foreground">
                          עדיין לא נוצרו דרישות בטווח הזה.
                        </div>
                      )}
                    </div>
                  </Card>
                </div>
              )}

              <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
                  <h3 className="text-lg font-semibold text-zinc-900">משימות תביעות HMO</h3>
                  <p className="text-sm text-muted-foreground">מבט ריכוזי על תביעות פתוחות/שטופלו, מקובצות לפי תלמיד עם טווח שעות לכל מפגש.</p>
                  <div className="mt-3 max-h-[420px] overflow-y-auto space-y-2">
                    {groupedClaims.map((group) => (
                      <div key={group.studentId} className="rounded-xl border border-border bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-zinc-900">{group.studentName}</div>
                          <div className="text-xs text-muted-foreground">{group.claims.length} מופעים</div>
                        </div>
                        <div className="mt-2 space-y-2">
                          {group.claims.map((claim) => {
                            const workflowState = resolveClaimWorkflowState(claim);
                            return (
                              <div key={claim.id} className="rounded-lg border border-border bg-white p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    {canMutateClaims && claimableLedgerIds.has(claim.ledger_transaction_id) && (
                                      <input
                                        type="checkbox"
                                        aria-label="בחר שורת תביעה"
                                        checked={selectedClaimLedgerIds.has(claim.ledger_transaction_id)}
                                        onChange={(event) => toggleClaimSelection(claim.ledger_transaction_id, event.target.checked)}
                                      />
                                    )}
                                    <div className="text-xs font-medium text-zinc-900">{claim.service_name || 'שירות'}</div>
                                  </div>
                                  <div className={`rounded-full px-2 py-0.5 text-xs ${workflowState.className}`}>
                                    {claim.hmo_invoice_batch_status ? `דרישה: ${formatBatchStatus(claim.hmo_invoice_batch_status)}` : workflowState.label}
                                  </div>
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {formatClaimDate(claim.lesson_date)} • {formatClaimTimeRange(claim)}
                                </div>
                                <div className="mt-1 text-xs text-slate-700">
                                  גורם מממן: {claim.hmo_provider_name || 'לא משויך'}
                                  {claim.hmo_authorization_reference ? ` • אסמכתא: ${claim.hmo_authorization_reference}` : ''}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    {groupedClaims.length === 0 && (
                      <div className="rounded-xl border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-muted-foreground">
                        אין משימות תביעת HMO להצגה בטווח הנבחר.
                      </div>
                    )}
                  </div>
                </Card>

                <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
                  <h3 className="text-lg font-semibold text-zinc-900">יתרות גורמים מממנים</h3>
                  <p className="text-sm text-muted-foreground">לקריאה בלבד: מבוסס לדר וחשבוניות שנוצרו.</p>
                  <div className="mt-3 space-y-2 max-h-[420px] overflow-y-auto">
                    {(claimsReadModel?.provider_receivables || []).map((provider) => (
                      <div key={provider.hmo_provider_id} className="rounded-xl border border-border bg-slate-50 p-3">
                        <div className="text-sm font-semibold text-zinc-900">{provider.hmo_provider_name || 'גורם מממן'}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          יתרה: {formatCurrency(provider?.summary?.balance)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          חיובים: {formatCurrency(provider?.summary?.receivable_total)} • תשלומים: {formatCurrency(provider?.summary?.payment_total)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          חשבוניות פתוחות: {provider.open_invoice_batch_count || 0}
                        </div>
                        {canMutateClaims && (
                          <div className="mt-3 rounded-lg border border-border bg-white p-3">
                            <div className="text-xs font-semibold text-zinc-900">הגדרות תביעה לגורם מממן</div>
                            <div className="mt-2 grid gap-2">
                              <label className="text-xs text-muted-foreground">
                                צורת דרישה
                                <select
                                  className="mt-1 w-full rounded-md border border-border bg-white px-2 py-2 text-xs"
                                  value={providerPolicyForms[provider.hmo_provider_id]?.claim_submission_mode || 'amount'}
                                  onChange={(event) => updateProviderPolicyForm(provider.hmo_provider_id, { claim_submission_mode: event.target.value })}
                                >
                                  <option value="amount">לפי סכום</option>
                                  <option value="unit_count">לפי מספר שיעורים</option>
                                  <option value="hybrid">סכום + מספר שיעורים</option>
                                </select>
                              </label>
                              <label className="text-xs text-muted-foreground">
                                תדירות טיפול
                                <select
                                  className="mt-1 w-full rounded-md border border-border bg-white px-2 py-2 text-xs"
                                  value={providerPolicyForms[provider.hmo_provider_id]?.claim_payment_timing || 'after_submission'}
                                  onChange={(event) => updateProviderPolicyForm(provider.hmo_provider_id, { claim_payment_timing: event.target.value })}
                                >
                                  <option value="after_submission">אחרי שליחת דרישה</option>
                                  <option value="monthly">חודשי</option>
                                  <option value="quarterly">רבעוני</option>
                                  <option value="custom">מותאם ידנית</option>
                                </select>
                              </label>
                              <label className="text-xs text-muted-foreground">
                                התאמת תשלום
                                <select
                                  className="mt-1 w-full rounded-md border border-border bg-white px-2 py-2 text-xs"
                                  value={providerPolicyForms[provider.hmo_provider_id]?.claim_payment_matching_mode || 'batch_amount'}
                                  onChange={(event) => updateProviderPolicyForm(provider.hmo_provider_id, { claim_payment_matching_mode: event.target.value })}
                                >
                                  <option value="batch_amount">לפי סכום הדרישה</option>
                                  <option value="line_amount">לפי שורות</option>
                                  <option value="unit_count">לפי מספר שיעורים</option>
                                  <option value="manual_reconciliation">התאמה ידנית</option>
                                </select>
                              </label>
                              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                <input
                                  type="checkbox"
                                  checked={providerPolicyForms[provider.hmo_provider_id]?.claim_reference_required === true}
                                  onChange={(event) => updateProviderPolicyForm(provider.hmo_provider_id, { claim_reference_required: event.target.checked })}
                                />
                                חובה להזין אסמכתת תשלום
                              </label>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => handleSaveProviderPolicy(provider.hmo_provider_id)}
                                disabled={savingProviderPolicy}
                              >
                                שמור הגדרות
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    {(claimsReadModel?.provider_receivables || []).length === 0 && (
                      <div className="rounded-xl border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-muted-foreground">
                        אין נתוני יתרות גורמים מממנים בטווח הנבחר.
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={isBillingPolicyOpen} onOpenChange={setIsBillingPolicyOpen}>
        <DialogContent className="w-[min(96vw,88rem)] max-w-6xl">
          <DialogHeader>
            <DialogTitle>הגדרות חיוב שיעורים</DialogTitle>
            <DialogDescription>
              המדיניות כאן מגדירה אילו סטטוסים של שיעור מייצרים חיוב ושכר. החיובים עצמם נרשמים רק דרך הלדר.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-6 max-h-[78vh] overflow-y-auto pe-4">
            <BillingSettingsWorkspace
              billingPolicy={billingPolicy}
              setBillingPolicy={setBillingPolicy}
              instructorPolicy={instructorEarningsPolicy}
              setInstructorPolicy={setInstructorEarningsPolicy}
              canMutateBillingPolicy={canMutateBillingPolicy}
              savingPolicy={savingPolicy}
              loadingPolicy={loadingBilling}
              onSaveBillingPolicy={() => setConfirmPolicySave(true)}
              onChanged={loadBillingOverview}
            />
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmPolicySave} onOpenChange={setConfirmPolicySave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>שמירת מדיניות חיוב</AlertDialogTitle>
            <AlertDialogDescription>
              שינוי מדיניות החיוב ישפיע על חיובי שיעורים עתידיים ועל חישובי בנייה מחדש. להמשיך?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleSaveBillingPolicy}>שמור</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageLayout>
  );
}
