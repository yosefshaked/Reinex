import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Send, Settings2 } from 'lucide-react';
import PageLayout from '@/components/ui/PageLayout.jsx';
import Card from '@/components/ui/CustomCard.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet.jsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import HmoProviderBillingWorkspace from '@/features/finance/components/HmoProviderBillingWorkspace.jsx';
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

function resolveClaimBatchState(batchStatus) {
  switch (`${batchStatus || ''}`.toLowerCase()) {
    case 'draft':
      return {
        key: 'draft',
        label: 'דרישה: טיוטה',
        className: 'bg-sky-100 text-sky-900',
      };
    case 'issued':
    case 'submitted':
      return {
        key: 'submitted',
        label: 'דרישה: נשלח',
        className: 'bg-amber-100 text-amber-900',
      };
    case 'acknowledged':
      return {
        key: 'acknowledged',
        label: 'דרישה: אושר קבלה',
        className: 'bg-indigo-100 text-indigo-900',
      };
    case 'partially_paid':
      return {
        key: 'partially_paid',
        label: 'דרישה: שולם חלקית',
        className: 'bg-emerald-100 text-emerald-900',
      };
    case 'paid':
      return {
        key: 'paid',
        label: 'דרישה: שולם',
        className: 'bg-emerald-100 text-emerald-900',
      };
    case 'disputed':
      return {
        key: 'disputed',
        label: 'דרישה: במחלוקת',
        className: 'bg-rose-100 text-rose-900',
      };
    case 'closed':
      return {
        key: 'closed',
        label: 'דרישה: סגור',
        className: 'bg-slate-200 text-slate-800',
      };
    case 'cancelled':
      return {
        key: 'cancelled',
        label: 'דרישה: בוטל',
        className: 'bg-slate-200 text-slate-800',
      };
    default:
      return null;
  }
}

function resolveClaimBadgeState(claim) {
  const batchState = resolveClaimBatchState(claim?.hmo_invoice_batch_status);
  if (batchState) {
    return batchState;
  }
  return resolveClaimWorkflowState(claim);
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


function buildClaimSubmitForm() {
  return {
    externalReference: '',
    externalLink: '',
    notes: '',
  };
}

function buildBatchPaymentForm() {
  return {
    amount: '',
    effectiveAt: '',
    externalReference: '',
    notes: '',
  };
}

function buildStudentName(student) {
  const explicitName = typeof student?.full_name === 'string' ? student.full_name.trim() : '';
  if (explicitName) return explicitName;
  return [student?.first_name, student?.middle_name, student?.last_name].filter(Boolean).join(' ').trim() || 'תלמיד';
}

function BatchMetaTags({ externalReference = '', externalLink = '', notes = '' }) {
  const hasExternalReference = Boolean(String(externalReference || '').trim());
  const hasExternalLink = Boolean(String(externalLink || '').trim());
  const hasNotes = Boolean(String(notes || '').trim());
  if (!hasExternalReference && !hasExternalLink && !hasNotes) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {hasExternalReference ? (
        <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700">
          אסמכתא: {externalReference}
        </span>
      ) : null}
      {hasExternalLink ? (
        <a
          href={externalLink}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] text-sky-800 hover:bg-sky-100"
        >
          קישור חיצוני
        </a>
      ) : null}
      {hasNotes ? (
        <span
          className="inline-flex max-w-full items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-800"
          title={notes}
        >
          הערה: {notes}
        </span>
      ) : null}
    </div>
  );
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [providerBillingSheetId, setProviderBillingSheetId] = useState('');
  const [cancelBatchConfirmDialog, setCancelBatchConfirmDialog] = useState(null);
  const [expandedProviderGroups, setExpandedProviderGroups] = useState(() => new Set());
  const [expandedStudentGroups, setExpandedStudentGroups] = useState(() => new Set());
  const [expandedBatchIds, setExpandedBatchIds] = useState(() => new Set());
  const [providerSettingsDialogId, setProviderSettingsDialogId] = useState('');

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
      toast.error(error?.message || 'טעינת נתוני תביעות גורם מממן נכשלה.');
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
    const providerGroups = new Map();
    for (const claim of claimableClaims) {
      const providerId = claim?.hmo_provider_id || '';
      if (!providerId) continue;
      if (!providerGroups.has(providerId)) {
        providerGroups.set(providerId, {
          providerId,
          providerName: claim?.hmo_provider_name || 'גורם מממן',
          studentGroups: new Map(),
        });
      }
      const provider = providerGroups.get(providerId);
      const studentId = claim?.student_id || claim?.student_name || '';
      const studentName = claim?.student_name || 'לקוח/ה';
      const studentKey = `${providerId}:${studentId}`;
      if (!provider.studentGroups.has(studentKey)) {
        provider.studentGroups.set(studentKey, { studentKey, studentName, claims: [] });
      }
      provider.studentGroups.get(studentKey).claims.push(claim);
    }
    return Array.from(providerGroups.values())
      .map((provider) => ({
        ...provider,
        studentGroups: Array.from(provider.studentGroups.values())
          .map((sg) => ({
            ...sg,
            claims: sg.claims.slice().sort((a, b) => new Date(a?.lesson_date || 0) - new Date(b?.lesson_date || 0)),
          }))
          .sort((a, b) => a.studentName.localeCompare(b.studentName, 'he')),
      }))
      .sort((a, b) => a.providerName.localeCompare(b.providerName, 'he'));
  }, [claimableClaims]);

  const providerReceivableById = useMemo(() => new Map((claimsReadModel?.provider_receivables || [])
    .map((provider) => [provider.hmo_provider_id, provider])), [claimsReadModel]);

  const batchClaimsMap = useMemo(() => {
    const map = new Map();
    for (const claim of (claimsReadModel?.claims || [])) {
      if (!claim.hmo_invoice_batch_id) continue;
      if (!map.has(claim.hmo_invoice_batch_id)) map.set(claim.hmo_invoice_batch_id, []);
      map.get(claim.hmo_invoice_batch_id).push(claim);
    }
    return map;
  }, [claimsReadModel]);

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
        ...buildBatchPaymentForm(),
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

  async function handleCancelClaimBatch() {
    const batch = cancelBatchConfirmDialog;
    if (!activeOrgId || !canMutateClaims || !batch?.id) return;
    setCancelBatchConfirmDialog(null);
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

  async function handleRecordBatchPayment(batch, formOverride = null) {
    if (!activeOrgId || !canMutateClaims || !batch?.id) return;
    const form = formOverride || batchPaymentForms[batch.id] || buildBatchPaymentForm();
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
            <DialogTitle>שליחת דרישת גורם מממן</DialogTitle>
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

      <AlertDialog open={Boolean(cancelBatchConfirmDialog)} onOpenChange={(open) => { if (!open) setCancelBatchConfirmDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ביטול דרישת גורם מממן</AlertDialogTitle>
            <AlertDialogDescription>
              לבטל את הדרישה? השורות יחזרו להיות זמינות ליצירת דרישה חדשה. לא ניתן לבטל דרישה שכבר שולם עליה.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={processingClaimBatch}>חזרה</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelClaimBatch} disabled={processingClaimBatch}>
              {processingClaimBatch ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
              בטל דרישה
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Provider claim settings dialog ── */}
      <Dialog
        open={Boolean(providerSettingsDialogId)}
        onOpenChange={(open) => { if (!open) setProviderSettingsDialogId(''); }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              הגדרות תביעה — {providerReceivableById.get(providerSettingsDialogId)?.hmo_provider_name || 'גורם מממן'}
            </DialogTitle>
            <DialogDescription>
              הגדרות אלו קובעות כיצד דרישות נשלחות ותשלומים מסוכמים עבור ספק זה.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>צורת דרישה</Label>
              <Select
                value={providerPolicyForms[providerSettingsDialogId]?.claim_submission_mode || 'amount'}
                onValueChange={(value) => updateProviderPolicyForm(providerSettingsDialogId, { claim_submission_mode: value })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="amount">לפי סכום</SelectItem>
                  <SelectItem value="unit_count">לפי מספר שיעורים</SelectItem>
                  <SelectItem value="hybrid">סכום + מספר שיעורים</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>תדירות טיפול</Label>
              <Select
                value={providerPolicyForms[providerSettingsDialogId]?.claim_payment_timing || 'after_submission'}
                onValueChange={(value) => updateProviderPolicyForm(providerSettingsDialogId, { claim_payment_timing: value })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="after_submission">אחרי שליחת דרישה</SelectItem>
                  <SelectItem value="monthly">חודשי</SelectItem>
                  <SelectItem value="quarterly">רבעוני</SelectItem>
                  <SelectItem value="custom">מותאם ידנית</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>התאמת תשלום</Label>
              <Select
                value={providerPolicyForms[providerSettingsDialogId]?.claim_payment_matching_mode || 'batch_amount'}
                onValueChange={(value) => updateProviderPolicyForm(providerSettingsDialogId, { claim_payment_matching_mode: value })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="batch_amount">לפי סכום הדרישה</SelectItem>
                  <SelectItem value="line_amount">לפי שורות</SelectItem>
                  <SelectItem value="unit_count">לפי מספר שיעורים</SelectItem>
                  <SelectItem value="manual_reconciliation">התאמה ידנית</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={providerPolicyForms[providerSettingsDialogId]?.claim_reference_required === true}
                onCheckedChange={(checked) => updateProviderPolicyForm(providerSettingsDialogId, { claim_reference_required: checked })}
              />
              <Label>חובה להזין אסמכתת תשלום</Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              onClick={async () => {
                await handleSaveProviderPolicy(providerSettingsDialogId);
                setProviderSettingsDialogId('');
              }}
              disabled={savingProviderPolicy}
            >
              {savingProviderPolicy ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
              שמור הגדרות
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
          <TabsTrigger value="claims" className="rounded-xl px-4 py-2">תביעות גורם מממן</TabsTrigger>
        </TabsList>

        <TabsContent value="payroll" className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-slate-900 bg-slate-900 p-4 text-white">
              <div className="text-xs text-slate-300">סה״כ שכר</div>
              <div className="mt-1 text-xl font-bold">{formatCurrency(payroll?.totals?.total_amount)}</div>
            </div>
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
          </div>

          <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
            {loadingPayroll ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                טוען נתוני שכר...
              </div>
            ) : (
              <div className="space-y-4">
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
          <div className={`grid gap-4 ${sidebarCollapsed ? '' : 'xl:grid-cols-[340px_minmax(0,1fr)]'}`}>
            {sidebarCollapsed ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setSidebarCollapsed(false)}
                  title="הצג רשימת תלמידים"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {selectedStudent ? (
                  <span className="text-sm font-medium text-zinc-700">{selectedStudent.full_name}</span>
                ) : null}
              </div>
            ) : (
              <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-zinc-900">בחירת תלמיד</h3>
                      <p className="text-sm text-muted-foreground">רשימת העבודה בנויה ישירות מסיכומי הלדר.</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => setSidebarCollapsed(true)}
                      title="הסתר רשימת תלמידים"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
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
                            חיובי תלמיד {formatCurrency(summary.lesson_charge_total)} • חיוב מול גורם מממן {formatCurrency(summary.hmo_charge_total)}
                          </div>
                          <div className={`mt-1 text-xs ${isSelected ? 'text-white/70' : 'text-muted-foreground'}`}>
                            {Array.isArray(summary.authorizations) && summary.authorizations.length > 0
                              ? `${summary.authorizations.length} אישורי גורם מממן פעילים`
                              : 'ללא אישור גורם מממן פעיל'}
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
            )}

            <div className="space-y-4">
              {selectedStudentId ? (
                <StudentBillingWorkspace
                  studentId={selectedStudentId}
                  student={selectedStudent}
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
          {/* ── KPIs ── */}
          <div className="grid gap-3 md:grid-cols-5">
            <Card className="rounded-2xl border border-amber-200 bg-amber-50 p-lg shadow-sm">
              <div className="text-xs text-amber-700">משימות פתוחות</div>
              <div className="mt-1 text-2xl font-bold text-amber-950">{claimsReadModel?.summary?.open_claim_tasks ?? 0}</div>
            </Card>
            <Card className="rounded-2xl border border-emerald-200 bg-emerald-50 p-lg shadow-sm">
              <div className="text-xs text-emerald-700">ממתינות לאישור תשלום</div>
              <div className="mt-1 text-2xl font-bold text-emerald-950">{claimsReadModel?.summary?.pending_payment_followup_batches ?? 0}</div>
            </Card>
            <Card className="rounded-2xl border border-indigo-200 bg-indigo-50 p-lg shadow-sm">
              <div className="text-xs text-indigo-700">תשלום צפוי מדרישות שנשלחו</div>
              <div className="mt-1 text-2xl font-bold text-indigo-950">{formatCurrency(claimsReadModel?.summary?.expected_payment_from_submitted_batches ?? 0)}</div>
            </Card>
            <Card className="rounded-2xl border border-blue-200 bg-blue-50 p-lg shadow-sm">
              <div className="text-xs text-blue-700">תשלום שהתקבל</div>
              <div className="mt-1 text-2xl font-bold text-blue-950">{formatCurrency(claimsReadModel?.summary?.payment_received_total ?? 0)}</div>
            </Card>
            <Card className="rounded-2xl border border-violet-200 bg-violet-50 p-lg shadow-sm">
              <div className="text-xs text-violet-700">תלמידים פעילים עם אישור גורם מממן</div>
              <div className="mt-1 text-2xl font-bold text-violet-950">{claimsReadModel?.summary?.active_students_with_hmo_eligibility ?? 0}</div>
            </Card>
          </div>

          {loadingClaims ? (
            <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                טוען נתוני תביעות גורם מממן...
              </div>
            </Card>
          ) : (
            <>
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

              {/* ── Section A: Open claim lines (Provider → Student → Claim tree) ── */}
              <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-zinc-900">שורות מוכנות לדרישה</h3>
                    <p className="text-sm text-muted-foreground">בוחרים שורות מאותו גורם מממן ויוצרים טיוטת דרישה. שורה שנכנסה לטיוטה לא תיכנס בטעות לדרישה נוספת.</p>
                  </div>
                  {canMutateClaims && selectedClaimLedgerIds.size > 0 && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        onClick={handleCreateClaimBatch}
                        disabled={processingClaimBatch}
                      >
                        {processingClaimBatch && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                        צור טיוטה מ־{selectedClaimLedgerIds.size} שורות
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedClaimLedgerIds(new Set())}>
                        נקה בחירה
                      </Button>
                    </div>
                  )}
                </div>

                {claimableClaimsByProvider.length === 0 ? (
                  <div className="mt-4 rounded-xl border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-muted-foreground">
                    כל השורות בטווח זה כבר שויכו לדרישה.
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {claimableClaimsByProvider.map((providerGroup) => {
                      const isProviderExpanded = expandedProviderGroups.has(providerGroup.providerId);
                      const totalClaims = providerGroup.studentGroups.reduce((sum, sg) => sum + sg.claims.length, 0);
                      const selectedInProvider = providerGroup.studentGroups
                        .flatMap((sg) => sg.claims)
                        .filter((c) => selectedClaimLedgerIds.has(c.ledger_transaction_id)).length;
                      return (
                        <div key={providerGroup.providerId} className="rounded-xl border border-border bg-slate-50 overflow-hidden">
                          {/* Provider header */}
                          <div className="flex items-center justify-between gap-3 p-3">
                            <button
                              type="button"
                              className="flex items-center gap-2 text-start"
                              onClick={() => setExpandedProviderGroups((prev) => {
                                const next = new Set(prev);
                                if (next.has(providerGroup.providerId)) next.delete(providerGroup.providerId);
                                else next.add(providerGroup.providerId);
                                return next;
                              })}
                            >
                              <ChevronRight className={`h-4 w-4 text-zinc-500 transition-transform ${isProviderExpanded ? 'rotate-90' : ''}`} />
                              <span className="text-sm font-semibold text-zinc-900">{providerGroup.providerName}</span>
                              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700">
                                {totalClaims} שורות
                              </span>
                              {selectedInProvider > 0 && (
                                <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs text-white">
                                  {selectedInProvider} נבחרו
                                </span>
                              )}
                            </button>
                            {canMutateClaims && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => selectProviderClaimLines(providerGroup.providerId)}
                              >
                                בחר הכל
                              </Button>
                            )}
                          </div>

                          {/* Student groups (expanded) */}
                          {isProviderExpanded && (
                            <div className="border-t border-border bg-white divide-y divide-border/60">
                              {providerGroup.studentGroups.map((studentGroup) => {
                                const isStudentExpanded = expandedStudentGroups.has(studentGroup.studentKey);
                                return (
                                  <div key={studentGroup.studentKey}>
                                    <button
                                      type="button"
                                      className="flex w-full items-center gap-2 px-5 py-2.5 text-start hover:bg-slate-50"
                                      onClick={() => setExpandedStudentGroups((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(studentGroup.studentKey)) next.delete(studentGroup.studentKey);
                                        else next.add(studentGroup.studentKey);
                                        return next;
                                      })}
                                    >
                                      <ChevronRight className={`h-3.5 w-3.5 text-zinc-400 transition-transform ${isStudentExpanded ? 'rotate-90' : ''}`} />
                                      <span className="text-sm text-zinc-800">{studentGroup.studentName}</span>
                                      <span className="text-xs text-muted-foreground">{studentGroup.claims.length} שיעורים</span>
                                    </button>
                                    {isStudentExpanded && (
                                      <div className="divide-y divide-border/40 bg-slate-50/50">
                                        {studentGroup.claims.map((claim) => (
                                          <div key={claim.id} className="flex items-center gap-3 px-8 py-2">
                                            {canMutateClaims && claimableLedgerIds.has(claim.ledger_transaction_id) && (
                                              <input
                                                type="checkbox"
                                                aria-label="בחר שורת תביעה"
                                                checked={selectedClaimLedgerIds.has(claim.ledger_transaction_id)}
                                                onChange={(event) => toggleClaimSelection(claim.ledger_transaction_id, event.target.checked)}
                                              />
                                            )}
                                            <div className="min-w-0 flex-1">
                                              <span className="text-xs font-medium text-zinc-800">{formatClaimDate(claim.lesson_date)}</span>
                                              <span className="mx-1.5 text-xs text-muted-foreground">·</span>
                                              <span className="text-xs text-muted-foreground">{formatClaimTimeRange(claim)}</span>
                                              <span className="mx-1.5 text-xs text-muted-foreground">·</span>
                                              <span className="text-xs text-zinc-700">{claim.service_name || 'שירות'}</span>
                                            </div>
                                            <span className="text-xs font-medium text-zinc-900">{formatCurrency(claim.hmo_charge_amount || 0)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* ── Section B: Batches pipeline ── */}
              <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
                <h3 className="text-lg font-semibold text-zinc-900">דרישות</h3>
                <p className="text-sm text-muted-foreground">דרישה בטיוטה עדיין לא ננעלה. אחרי שליחה, רשמו תשלום כשמגיע מהגורם המממן.</p>
                <div className="mt-4 space-y-3">
                  {(claimsReadModel?.invoice_batches || []).map((batch) => {
                    const batchState = resolveClaimBatchState(batch.status);
                    const remainingAmount = Math.max(0, Number(batch.total_amount || 0) - Number(batch.paid_amount || 0));
                    const canPayInline = canMutateClaims
                      && ['submitted', 'issued', 'acknowledged', 'partially_paid'].includes(batch.status)
                      && remainingAmount > 0;
                    const canCancel = canMutateClaims
                      && ['draft', 'submitted', 'issued', 'acknowledged'].includes(batch.status)
                      && Number(batch.paid_amount || 0) === 0;
                    const isPaidOrClosed = ['paid', 'closed'].includes(batch.status);

                    const batchClaims = batchClaimsMap.get(batch.id) || [];
                    const isExpanded = expandedBatchIds.has(batch.id);

                    // Group by student for the drill-down tree
                    const studentGroupMap = new Map();
                    for (const claim of batchClaims) {
                      const key = claim.student_id || claim.student_name || '';
                      if (!studentGroupMap.has(key)) {
                        studentGroupMap.set(key, { name: claim.student_name || 'לקוח/ה', claims: [] });
                      }
                      studentGroupMap.get(key).claims.push(claim);
                    }
                    const studentGroups = Array.from(studentGroupMap.values())
                      .map((sg) => ({
                        ...sg,
                        claims: sg.claims.slice().sort(
                          (a, b) => new Date(a.lesson_date || 0) - new Date(b.lesson_date || 0),
                        ),
                      }))
                      .sort((a, b) => a.name.localeCompare(b.name, 'he'));

                    return (
                      <div key={batch.id} className="rounded-xl border border-border bg-slate-50/70 overflow-hidden">
                        {/* Batch header */}
                        <div className="p-4 space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-zinc-900">{batch.hmo_provider_name || 'גורם מממן'}</span>
                                {batchState && (
                                  <span className={`rounded-full px-2 py-0.5 text-xs ${batchState.className}`}>
                                    {batchState.label}
                                  </span>
                                )}
                                {isPaidOrClosed && (
                                  <span className="text-xs text-emerald-700">✓ טופל</span>
                                )}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {batch.item_count || 0} שורות • {formatCurrency(batch.total_amount)}
                                {Number(batch.paid_amount || 0) > 0 ? ` • שולם ${formatCurrency(batch.paid_amount)}` : ''}
                              </div>
                              <BatchMetaTags
                                externalReference={batch.external_reference}
                                externalLink={batch.external_link}
                                notes={batch.notes}
                              />
                            </div>
                            <div className="flex flex-wrap items-start gap-2 shrink-0">
                              {!isPaidOrClosed && (
                                <>
                                  {batch.status === 'draft' && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      onClick={() => handleOpenSubmitClaimBatch(batch)}
                                      disabled={processingClaimBatch}
                                    >
                                      <Send className="me-2 h-4 w-4" />
                                      שלח לגורם מממן
                                    </Button>
                                  )}
                                  {canCancel && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setCancelBatchConfirmDialog(batch)}
                                      disabled={processingClaimBatch}
                                    >
                                      בטל
                                    </Button>
                                  )}
                                </>
                              )}
                              {batchClaims.length > 0 && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0"
                                  aria-label={isExpanded ? 'כווץ' : 'הרחב'}
                                  onClick={() => setExpandedBatchIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(batch.id)) next.delete(batch.id);
                                    else next.add(batch.id);
                                    return next;
                                  })}
                                >
                                  <ChevronRight className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                </Button>
                              )}
                            </div>
                          </div>

                          {/* Inline payment form */}
                          {canPayInline && (
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
                              <div className="text-xs font-semibold text-zinc-900">
                                רישום תשלום — יתרה פתוחה: {formatCurrency(remainingAmount)}
                              </div>
                              <div className="grid gap-3 md:grid-cols-3">
                                <div className="space-y-1.5">
                                  <Label className="text-xs">סכום</Label>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={batchPaymentForms[batch.id]?.amount || ''}
                                    onChange={(e) => updateBatchPaymentForm(batch.id, { amount: e.target.value })}
                                    placeholder="סכום בש״ח"
                                    disabled={processingClaimBatch}
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label className="text-xs">תאריך תשלום</Label>
                                  <Input
                                    type="date"
                                    value={batchPaymentForms[batch.id]?.effectiveAt || ''}
                                    onChange={(e) => updateBatchPaymentForm(batch.id, { effectiveAt: e.target.value })}
                                    disabled={processingClaimBatch}
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label className="text-xs">אסמכתא</Label>
                                  <Input
                                    value={batchPaymentForms[batch.id]?.externalReference || ''}
                                    onChange={(e) => updateBatchPaymentForm(batch.id, { externalReference: e.target.value })}
                                    disabled={processingClaimBatch}
                                  />
                                </div>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => handleRecordBatchPayment(batch)}
                                disabled={processingClaimBatch}
                              >
                                {processingClaimBatch && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                                רשום תשלום
                              </Button>
                            </div>
                          )}
                        </div>

                        {/* Expanded: Student → Lesson instance tree */}
                        {isExpanded && (
                          <div className="border-t border-border bg-white">
                            {studentGroups.length === 0 ? (
                              <div className="px-4 py-3 text-xs text-muted-foreground">
                                אין שורות מפורטות לדרישה זו.
                              </div>
                            ) : (
                              <div className="divide-y divide-border/50">
                                {studentGroups.map((sg) => (
                                  <div key={sg.name} className="px-4 py-3">
                                    <div className="mb-2 text-xs font-semibold text-zinc-700">{sg.name}</div>
                                    <div className="space-y-1.5">
                                      {sg.claims.map((claim) => (
                                        <div
                                          key={claim.ledger_transaction_id || claim.id}
                                          className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs"
                                        >
                                          <span className="font-medium text-zinc-800">
                                            {formatClaimDate(claim.lesson_date)}
                                          </span>
                                          <span className="text-muted-foreground">
                                            {formatClaimTimeRange(claim)}
                                          </span>
                                          <span className="text-muted-foreground">·</span>
                                          <span className="flex-1 text-zinc-700">
                                            {claim.service_name || 'שירות'}
                                          </span>
                                          <span className="font-medium text-zinc-900">
                                            {formatCurrency(claim.hmo_contracted_rate_amount || 0)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {(claimsReadModel?.invoice_batches || []).length === 0 && (
                    <div className="rounded-xl border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-muted-foreground">
                      עדיין לא נוצרו דרישות בטווח הזה.
                    </div>
                  )}
                </div>
              </Card>

              {/* ── Section C: Provider balances ── */}
              <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
                <h3 className="text-lg font-semibold text-zinc-900">יתרות גורמים מממנים</h3>
                <p className="text-sm text-muted-foreground">סיכום לדר לפי גורם מממן. לניהול מלא של חשבוניות ותשלומים פתח את הגורם המממן.</p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {(claimsReadModel?.provider_receivables || []).map((provider) => (
                    <div key={provider.hmo_provider_id} className="rounded-xl border border-border bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-zinc-900">{provider.hmo_provider_name || 'גורם מממן'}</div>
                          <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                            <div>לגביה: {formatCurrency(provider?.summary?.receivable_total)} • שולם: {formatCurrency(provider?.summary?.payment_total)}</div>
                            <div>יתרה: <span className="font-medium text-zinc-800">{formatCurrency(provider?.summary?.balance)}</span></div>
                            {(provider.open_invoice_batch_count || 0) > 0 && (
                              <div>חשבוניות פתוחות: {provider.open_invoice_batch_count}</div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {canMutateClaims ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground"
                              aria-label="הגדרות"
                              onClick={() => setProviderSettingsDialogId(provider.hmo_provider_id)}
                            >
                              <Settings2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setProviderBillingSheetId(provider.hmo_provider_id)}
                          >
                            פנקס תנועות
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {(claimsReadModel?.provider_receivables || []).length === 0 && (
                    <div className="col-span-2 rounded-xl border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-muted-foreground">
                      אין נתוני יתרה מגורם מממן בטווח הנבחר.
                    </div>
                  )}
                </div>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Provider billing Sheet ── */}
      <Sheet
        open={Boolean(providerBillingSheetId)}
        onOpenChange={(open) => { if (!open) setProviderBillingSheetId(''); }}
      >
        <SheetContent side="left" className="w-[min(96vw,720px)] overflow-hidden p-0 flex flex-col">
          <SheetHeader className="shrink-0 border-b border-border px-6 py-5 text-right">
            <SheetTitle>
              {providerReceivableById.get(providerBillingSheetId)?.hmo_provider_name || 'גורם מממן'}
            </SheetTitle>
            <SheetDescription>פנקס תנועות לדר — היסטוריית חיובים ותשלומים.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-6">
            <HmoProviderBillingWorkspace providerId={providerBillingSheetId} />
          </div>
        </SheetContent>
      </Sheet>

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
