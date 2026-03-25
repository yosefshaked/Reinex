import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Settings2 } from 'lucide-react';
import PageLayout from '@/components/ui/PageLayout.jsx';
import Card from '@/components/ui/CustomCard.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useStudents } from '@/hooks/useOrgData.js';
import { upsertSetting } from '@/features/settings/api/settings.js';
import StudentBillingWorkspace from '@/features/students/components/StudentBillingWorkspace.jsx';
import { isAdminOrOffice, isAdminRole, normalizeMembershipRole } from '@/features/students/utils/endpoints.js';
import { toast } from 'sonner';

const DEFAULT_BILLING_POLICY = {
  attended: true,
  no_show: false,
  cancelled_student: false,
  cancelled_clinic: false,
};

const BILLING_POLICY_FIELDS = [
  {
    key: 'attended',
    label: 'נכח',
    description: 'השיעור יחויב כאשר התלמיד הגיע בפועל.',
  },
  {
    key: 'no_show',
    label: 'לא הגיע',
    description: 'השיעור יחויב כאשר התלמיד לא הגיע ללא ביטול תקין.',
  },
  {
    key: 'cancelled_student',
    label: 'בוטל על ידי תלמיד',
    description: 'השיעור יחויב גם כאשר הביטול הגיע מצד התלמיד.',
  },
  {
    key: 'cancelled_clinic',
    label: 'בוטל על ידי המכון',
    description: 'השיעור יחויב גם כאשר המכון ביטל את השיעור.',
  },
];

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

function formatDate(dateString) {
  if (!dateString) return '—';
  return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(dateString));
}

function formatCurrency(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `₪${Number(value).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildStudentName(student) {
  const explicitName = typeof student?.full_name === 'string' ? student.full_name.trim() : '';
  if (explicitName) {
    return explicitName;
  }
  const composite = [student?.first_name, student?.middle_name, student?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (composite) {
    return composite;
  }
  const fallbackName = typeof student?.name === 'string' ? student.name.trim() : '';
  return fallbackName || 'תלמיד';
}

function getBillingReasonLabel(reason) {
  switch (reason) {
    case 'missing_commitment':
      return 'חסר שיוך להתחייבות.';
    case 'missing_default_charge_amount':
      return 'להתחייבות אין מחיר ברירת מחדל.';
    case 'service_mismatch':
      return 'השירות של ההתחייבות לא תואם לשיעור.';
    case 'inactive_commitment':
      return 'ההתחייבות שסומנה אינה פעילה.';
    case 'expired_commitment':
      return 'תוקף ההתחייבות פג.';
    case 'commitment_belongs_to_different_student':
      return 'ההתחייבות שייכת לתלמיד אחר.';
    case 'commitment_service_exhausted':
      return 'השירות הזה כבר מוצה בהתחייבות.';
    case 'authorization_exhausted':
      return 'כמות האישורים של הגורם המממן נוצלה.';
    default:
      return 'דורש טיפול.';
  }
}

function getBreakdownTypeLabel(row) {
  const type = row?.commitment?.commitment_type || row?.commitment?.runtime?.type || 'manual_credit';
  if (type === 'package') return 'חבילה';
  if (type === 'subscription') return 'מנוי';
  if (type === 'hmo') {
    const providerName = row?.commitment?.runtime?.hmo?.provider_name || 'גורם מממן';
    return `גורם מממן: ${providerName}`;
  }
  return 'הוספת יתרה מותאמת אישית';
}

function buildQueueByStudent(billingQueue = []) {
  const grouped = new Map();

  for (const row of billingQueue) {
    const studentId = row?.student_id || row?.student?.id || '';
    if (!studentId) {
      continue;
    }

    const existing = grouped.get(studentId) || {
      student_id: studentId,
      student: row.student || null,
      count: 0,
      latest_date: '',
      reasons: new Set(),
      services: new Set(),
    };

    existing.count += 1;
    existing.student = existing.student || row.student || null;
    existing.latest_date = String(row.lesson_instance?.datetime_start || '') > String(existing.latest_date || '')
      ? row.lesson_instance?.datetime_start || ''
      : existing.latest_date;
    if (row.billing_reason) {
      existing.reasons.add(row.billing_reason);
    }
    if (row.service?.service_name) {
      existing.services.add(row.service.service_name);
    }

    grouped.set(studentId, existing);
  }

  return Array.from(grouped.values())
    .map((row) => ({
      ...row,
      reasons: Array.from(row.reasons),
      services: Array.from(row.services),
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return String(right.latest_date || '').localeCompare(String(left.latest_date || ''));
    });
}

function buildBillingOverview(snapshot) {
  const lessonHistory = Array.isArray(snapshot?.lesson_history) ? snapshot.lesson_history : [];
  const commitments = Array.isArray(snapshot?.commitments) ? snapshot.commitments : [];
  const manualEntries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];

  const chargedLessons = lessonHistory.filter((row) => row.billing_status === 'charged');
  const pendingQueueCount = snapshot?.summary?.pending_queue_count ?? 0;
  const expiredOrExhaustedCount = commitments.filter((row) => row?.attention?.expired || row?.attention?.exhausted).length;
  const monthRevenue = chargedLessons.reduce((sum, row) => sum + Number(row?.resolved_charge_amount ?? row?.price_charged ?? 0), 0)
    + manualEntries
      .filter((row) => row.source_type === 'adjustment')
      .reduce((sum, row) => sum + Number(row?.amount_charged ?? 0), 0);

  return {
    charged_lessons_count: chargedLessons.length,
    consumed_lessons_count: chargedLessons.length,
    pending_queue_count: pendingQueueCount,
    expired_or_exhausted_commitments_count: expiredOrExhaustedCount,
    month_revenue: monthRevenue,
  };
}

function buildConsumedLessonsBreakdown(snapshot) {
  const chargedLessons = (Array.isArray(snapshot?.lesson_history) ? snapshot.lesson_history : [])
    .filter((row) => row.billing_status === 'charged');
  const serviceMap = new Map();

  for (const row of chargedLessons) {
    const serviceName = row?.service?.service_name || 'שירות';
    const typeLabel = getBreakdownTypeLabel(row);
    const serviceBucket = serviceMap.get(serviceName) || {
      service_name: serviceName,
      total_count: 0,
      total_amount: 0,
      by_type: new Map(),
    };

    serviceBucket.total_count += 1;
    serviceBucket.total_amount += Number(row?.resolved_charge_amount ?? row?.price_charged ?? 0);

    const typeBucket = serviceBucket.by_type.get(typeLabel) || {
      type_label: typeLabel,
      count: 0,
      amount: 0,
    };
    typeBucket.count += 1;
    typeBucket.amount += Number(row?.resolved_charge_amount ?? row?.price_charged ?? 0);
    serviceBucket.by_type.set(typeLabel, typeBucket);
    serviceMap.set(serviceName, serviceBucket);
  }

  return Array.from(serviceMap.values())
    .map((service) => ({
      service_name: service.service_name,
      total_count: service.total_count,
      total_amount: service.total_amount,
      by_type: Array.from(service.by_type.values()).sort((left, right) => right.count - left.count),
    }))
    .sort((left, right) => right.total_count - left.total_count);
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
  const [payroll, setPayroll] = useState(null);
  const [billingSnapshot, setBillingSnapshot] = useState(null);
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [billingPolicy, setBillingPolicy] = useState(DEFAULT_BILLING_POLICY);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [isBillingPolicyOpen, setIsBillingPolicyOpen] = useState(false);
  const [isConsumedLessonsOpen, setIsConsumedLessonsOpen] = useState(false);

  const monthStart = useMemo(() => toLocalDateString(startOfMonth(monthDate)), [monthDate]);
  const monthEnd = useMemo(() => toLocalDateString(endOfMonth(monthDate)), [monthDate]);
  const loading = loadingPayroll || loadingBilling;

  const { students } = useStudents({
    enabled: Boolean(activeOrgId && canViewFinancials),
    orgId: activeOrgId,
    session,
    search: studentSearch,
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
    } catch (error) {
      console.error('Failed to load billing overview', error);
      toast.error(error?.message || 'טעינת נתוני החיובים נכשלה.');
      setBillingSnapshot(null);
      setBillingPolicy(DEFAULT_BILLING_POLICY);
    } finally {
      setLoadingBilling(false);
    }
  }, [activeOrgId, canViewFinancials, monthEnd, monthStart, session]);

  useEffect(() => {
    if (!canViewFinancials) {
      return undefined;
    }

    void loadPayroll();
    void loadBillingOverview();
    return undefined;
  }, [canViewFinancials, loadBillingOverview, loadPayroll]);

  const queueByStudent = useMemo(() => buildQueueByStudent(billingSnapshot?.billing_queue || []), [billingSnapshot]);
  const queueByStudentMap = useMemo(() => new Map(queueByStudent.map((row) => [row.student_id, row])), [queueByStudent]);
  const overviewStats = useMemo(() => buildBillingOverview(billingSnapshot), [billingSnapshot]);
  const consumedLessonsBreakdown = useMemo(() => buildConsumedLessonsBreakdown(billingSnapshot), [billingSnapshot]);

  const studentOptions = useMemo(() => {
    const map = new Map();

    const addStudent = (candidate) => {
      const id = candidate?.id || candidate?.student_id || '';
      if (!id) {
        return;
      }
      const existing = map.get(id) || {};
      const merged = {
        ...existing,
        ...candidate,
        id,
      };
      merged.full_name = buildStudentName(merged);
      map.set(id, merged);
    };

    for (const student of students || []) {
      addStudent(student);
    }

    for (const row of billingSnapshot?.commitments || []) {
      addStudent(row.student || { id: row.student_id });
    }

    for (const row of billingSnapshot?.lesson_history || []) {
      addStudent(row.student || { id: row.student_id });
    }

    for (const row of billingSnapshot?.entries || []) {
      addStudent(row.student || { id: row.student_id });
    }

    return Array.from(map.values()).sort((left, right) => left.full_name.localeCompare(right.full_name, 'he'));
  }, [billingSnapshot, students]);

  useEffect(() => {
    if (selectedStudentId && studentOptions.some((student) => student.id === selectedStudentId)) {
      return;
    }

    if (queueByStudent.length > 0) {
      setSelectedStudentId(queueByStudent[0].student_id);
      return;
    }

    if (studentOptions.length > 0) {
      setSelectedStudentId(studentOptions[0].id);
      return;
    }

    setSelectedStudentId('');
  }, [queueByStudent, selectedStudentId, studentOptions]);

  const selectedStudent = useMemo(
    () => studentOptions.find((student) => student.id === selectedStudentId) || null,
    [selectedStudentId, studentOptions],
  );
  const studentCards = useMemo(() => (
    studentOptions
      .map((student) => {
        const queueInfo = queueByStudentMap.get(student.id);
        return {
          ...student,
          awaiting_count: queueInfo?.count ?? 0,
          latest_date: queueInfo?.latest_date || '',
          reasons: queueInfo?.reasons || [],
          services: queueInfo?.services || [],
        };
      })
      .sort((left, right) => {
        if (right.awaiting_count !== left.awaiting_count) {
          return right.awaiting_count - left.awaiting_count;
        }
        return left.full_name.localeCompare(right.full_name, 'he');
      })
  ), [queueByStudentMap, studentOptions]);

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
      await loadBillingOverview();
      toast.success('מדיניות החיוב נשמרה.');
    } catch (error) {
      console.error('Failed to save billing policy', error);
      toast.error(error?.message || 'שמירת מדיניות החיוב נכשלה.');
    } finally {
      setSavingPolicy(false);
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
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
              <div className="text-xs text-emerald-700">שיעורים שחויבו</div>
              <div className="mt-1 text-2xl font-bold text-emerald-950">{overviewStats.charged_lessons_count}</div>
              <p className="mt-2 text-sm text-muted-foreground">שיעורים שהחיוב שלהם כבר הוכרע ונרשם בחודש הזה.</p>
            </Card>
            <button
              type="button"
              onClick={() => setIsConsumedLessonsOpen(true)}
              className="rounded-2xl border border-border bg-surface p-lg text-start shadow-sm transition hover:border-zinc-400"
            >
              <div className="text-xs text-violet-700">סך שיעורים שנצרכו</div>
              <div className="mt-1 text-2xl font-bold text-violet-950">{overviewStats.consumed_lessons_count}</div>
              <p className="mt-2 text-sm text-muted-foreground">לחיצה תציג פירוט לפי שירות ולפי סוג התחייבות, כולל פירוט נפרד לכל גורם מממן.</p>
            </button>
            <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
              <div className="text-xs text-amber-700">ממתינים לטיפול</div>
              <div className="mt-1 text-2xl font-bold text-amber-950">{overviewStats.pending_queue_count}</div>
              <p className="mt-2 text-sm text-muted-foreground">שיעורים שחסרה להם התחייבות תקינה או הגדרת חיוב.</p>
            </Card>
            <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
              <div className="text-xs text-red-700">התחייבויות שפגו / נגמר התקציב</div>
              <div className="mt-1 text-2xl font-bold text-red-950">{overviewStats.expired_or_exhausted_commitments_count}</div>
              <p className="mt-2 text-sm text-muted-foreground">כולל התחייבויות שפגו בפועל או כאלה שמיצו את יתרת המפגשים או התקציב שלהן.</p>
            </Card>
            <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
              <div className="text-xs text-blue-700">רווח החודש</div>
              <div className="mt-1 text-2xl font-bold text-blue-950">{formatCurrency(overviewStats.month_revenue)}</div>
              <p className="mt-2 text-sm text-muted-foreground">חיובי שיעורים בחודש בתוספת התאמות ידניות, ללא העברות פנימיות.</p>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold text-zinc-900">מוקד טיפול</h3>
                  <p className="text-sm text-muted-foreground">בחירת תלמיד לעבודה וסקירת שיעורים שממתינים להכרעה.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="billing-student-search" className="text-xs text-slate-600">חיפוש תלמיד</Label>
                  <Input
                    id="billing-student-search"
                    value={studentSearch}
                    onChange={(event) => setStudentSearch(event.target.value)}
                    placeholder="חיפוש לפי שם תלמיד"
                  />
                </div>

                <div className="space-y-3">
                  {studentCards.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setSelectedStudentId(row.id)}
                      className={`w-full rounded-xl border p-4 text-start transition ${
                        row.id === selectedStudentId
                          ? 'border-zinc-900 bg-zinc-900 text-white'
                          : 'border-border bg-slate-50 hover:border-zinc-400'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">
                          {row.full_name}
                        </div>
                        <div className={`rounded-full px-2 py-0.5 text-xs ${row.id === selectedStudentId ? 'bg-white/15 text-white' : row.awaiting_count > 0 ? 'bg-amber-100 text-amber-900' : 'bg-slate-200 text-slate-700'}`}>
                          {row.awaiting_count > 0 ? `${row.awaiting_count} ממתינים` : 'ללא המתנה'}
                        </div>
                      </div>
                      <div className={`mt-2 text-xs ${row.id === selectedStudentId ? 'text-white/80' : 'text-muted-foreground'}`}>
                        {row.awaiting_count > 0 ? (row.reasons.slice(0, 2).map(getBillingReasonLabel).join(' • ') || 'דורש טיפול') : 'אין פעולות פתוחות כרגע'}
                      </div>
                      <div className={`mt-1 text-xs ${row.id === selectedStudentId ? 'text-white/70' : 'text-muted-foreground'}`}>
                        {row.services.length > 0 ? row.services.join(', ') : 'ללא שיעורים ממתינים'}{row.latest_date ? ` • שיעור אחרון ${formatDate(row.latest_date)}` : ''}
                      </div>
                    </button>
                  ))}
                  {!loadingBilling && studentCards.length === 0 ? (
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
                  {loading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      טוען נתוני חיוב...
                    </div>
                  ) : (
                    <>
                      <h3 className="text-lg font-semibold text-zinc-900">בחר תלמיד לעבודה</h3>
                      <p className="mt-2 text-sm text-muted-foreground">
                        בחר תלמיד מרשימת התלמידים או מאזור הטיפול כדי לנהל התחייבויות, חיובים, העברות והתאמות.
                      </p>
                    </>
                  )}
                </Card>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={isBillingPolicyOpen} onOpenChange={setIsBillingPolicyOpen}>
        <DialogContent footer={(
          <DialogFooter>
            {canMutateBillingPolicy ? (
              <Button onClick={handleSaveBillingPolicy} disabled={savingPolicy || loadingBilling}>
                {savingPolicy ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                שמור מדיניות
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => setIsBillingPolicyOpen(false)}>
              סגור
            </Button>
          </DialogFooter>
        )}>
          <DialogHeader>
            <DialogTitle>הגדרות חיוב שיעורים</DialogTitle>
            <DialogDescription>
              המדיניות כאן קובעת באילו סטטוסים שיעור ייצר צריכה מהתחייבות. המסך הראשי נשאר ממוקד בעבודה ולא בהגדרות.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {BILLING_POLICY_FIELDS.map((field) => (
              <div key={field.key} className="flex items-start justify-between gap-4 rounded-xl border border-border bg-slate-50 p-4">
                <div>
                  <div className="text-sm font-semibold text-zinc-900">{field.label}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{field.description}</div>
                </div>
                <div className="flex items-center gap-3">
                  <Label className="text-xs text-slate-600">{billingPolicy[field.key] ? 'מחויב' : 'לא מחויב'}</Label>
                  <Switch
                    checked={Boolean(billingPolicy[field.key])}
                    onCheckedChange={(checked) => setBillingPolicy((current) => ({ ...current, [field.key]: checked }))}
                    disabled={!canMutateBillingPolicy || savingPolicy}
                  />
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isConsumedLessonsOpen} onOpenChange={setIsConsumedLessonsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>פירוט שיעורים שנצרכו</DialogTitle>
            <DialogDescription>
              הפירוט מוצג לפי שירות, ובתוך כל שירות לפי סוג התחייבות. גורמים מממנים מפורטים לפי שם הגורם ולא כקבוצה אחת.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {consumedLessonsBreakdown.map((service) => (
              <div key={service.service_name} className="rounded-xl border border-border bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900">{service.service_name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {service.total_count} שיעורים • {formatCurrency(service.total_amount)}
                    </div>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {service.by_type.map((typeRow) => (
                    <div key={typeRow.type_label} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-white px-3 py-2 text-sm">
                      <div className="font-medium text-zinc-900">{typeRow.type_label}</div>
                      <div className="text-muted-foreground">{typeRow.count} שיעורים • {formatCurrency(typeRow.amount)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {consumedLessonsBreakdown.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-muted-foreground">
                אין שיעורים שנצרכו בחודש הנבחר.
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
