import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Loader2, Settings2 } from 'lucide-react';
import PageLayout from '@/components/ui/PageLayout.jsx';
import Card from '@/components/ui/CustomCard.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { formatCurrency } from '@/lib/currency.js';

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
  const [recordingClaimPayment, setRecordingClaimPayment] = useState(false);
  const [claimPaymentForm, setClaimPaymentForm] = useState({
    hmoProviderId: '',
    amount: '',
    effectiveAt: '',
    notes: '',
    resolveOpenTasks: true,
  });
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

  useEffect(() => {
    if (!Array.isArray(claimsReadModel?.provider_receivables) || claimsReadModel.provider_receivables.length === 0) {
      setClaimPaymentForm((prev) => ({
        ...prev,
        hmoProviderId: '',
      }));
      return;
    }
    if (claimPaymentForm.hmoProviderId && claimsReadModel.provider_receivables.some((row) => row.hmo_provider_id === claimPaymentForm.hmoProviderId)) {
      return;
    }
    setClaimPaymentForm((prev) => ({
      ...prev,
      hmoProviderId: claimsReadModel.provider_receivables[0]?.hmo_provider_id || '',
    }));
  }, [claimPaymentForm.hmoProviderId, claimsReadModel]);

  const overview = useMemo(() => buildOverview(billingSnapshot), [billingSnapshot]);

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

  async function handleRecordClaimPayment() {
    if (!activeOrgId || !canMutateClaims) {
      return;
    }

    const amount = Number(claimPaymentForm.amount || 0);
    if (!claimPaymentForm.hmoProviderId) {
      toast.error('יש לבחור גורם מממן.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('יש להזין סכום חיובי תקין.');
      return;
    }

    setRecordingClaimPayment(true);
    try {
      await authenticatedFetch('billing', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          action: 'record_hmo_claim_payment',
          hmo_provider_id: claimPaymentForm.hmoProviderId,
          amount: Math.round(amount * 100),
          effective_at: claimPaymentForm.effectiveAt || null,
          notes: claimPaymentForm.notes || null,
          resolve_open_claim_tasks: claimPaymentForm.resolveOpenTasks === true,
        },
      });

      toast.success('תשלום גורם מממן נרשם בהצלחה.');
      setClaimPaymentForm((prev) => ({
        ...prev,
        amount: '',
        notes: '',
      }));
      await loadHmoClaimsOverview();
    } catch (error) {
      console.error('Failed to record HMO claim payment', error);
      toast.error(error?.message || 'רישום תשלום גורם מממן נכשל.');
    } finally {
      setRecordingClaimPayment(false);
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
                <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
                  <h3 className="text-lg font-semibold text-zinc-900">רישום תשלום גורם מממן</h3>
                  <p className="text-sm text-muted-foreground">פעולה מבוקרת: זיכוי לדר לגורם מממן וסגירת תביעות פתוחות משויכות.</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-4">
                    <div>
                      <label className="text-xs text-muted-foreground">גורם מממן</label>
                      <select
                        className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
                        value={claimPaymentForm.hmoProviderId}
                        onChange={(event) => setClaimPaymentForm((prev) => ({ ...prev, hmoProviderId: event.target.value }))}
                      >
                        {(claimsReadModel?.provider_receivables || []).map((provider) => (
                          <option key={provider.hmo_provider_id} value={provider.hmo_provider_id}>
                            {provider.hmo_provider_name || provider.hmo_provider_id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">סכום (₪)</label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={claimPaymentForm.amount}
                        onChange={(event) => setClaimPaymentForm((prev) => ({ ...prev, amount: event.target.value }))}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">תאריך אפקטיבי</label>
                      <Input
                        type="date"
                        value={claimPaymentForm.effectiveAt}
                        onChange={(event) => setClaimPaymentForm((prev) => ({ ...prev, effectiveAt: event.target.value }))}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button type="button" onClick={handleRecordClaimPayment} disabled={recordingClaimPayment}>
                        {recordingClaimPayment && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                        רשום תשלום
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
                    <Input
                      value={claimPaymentForm.notes}
                      onChange={(event) => setClaimPaymentForm((prev) => ({ ...prev, notes: event.target.value }))}
                      placeholder="הערת תשלום (אופציונלי)"
                    />
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={claimPaymentForm.resolveOpenTasks === true}
                        onChange={(event) => setClaimPaymentForm((prev) => ({ ...prev, resolveOpenTasks: event.target.checked }))}
                      />
                      סגור תביעות פתוחות משויכות
                    </label>
                  </div>
                </Card>
              )}

              <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
                  <h3 className="text-lg font-semibold text-zinc-900">משימות תביעות HMO</h3>
                  <p className="text-sm text-muted-foreground">מבט ריכוזי על תביעות פתוחות/שטופלו לפי תלמיד ושירות.</p>
                  <div className="mt-3 max-h-[420px] overflow-y-auto space-y-2">
                    {(claimsReadModel?.claims || []).map((claim) => (
                      <div key={claim.id} className="rounded-xl border border-border bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-zinc-900">{claim.student_name || 'לקוח/ה'}</div>
                          <div className={`rounded-full px-2 py-0.5 text-xs ${claim.status === 'open' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}>
                            {claim.status === 'open' ? 'פתוח' : 'טופל'}
                          </div>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {claim.service_name || 'שירות'} • {claim.lesson_date ? new Date(claim.lesson_date).toLocaleDateString('he-IL') : 'ללא תאריך'}
                        </div>
                        <div className="mt-1 text-xs text-slate-700">
                          גורם מממן: {claim.hmo_provider_name || 'לא משויך'}
                          {claim.hmo_authorization_reference ? ` • אסמכתא: ${claim.hmo_authorization_reference}` : ''}
                        </div>
                      </div>
                    ))}
                    {(claimsReadModel?.claims || []).length === 0 && (
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
            <DialogTitle className="text-end">הגדרות חיוב שיעורים</DialogTitle>
            <DialogDescription className="text-end">
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
