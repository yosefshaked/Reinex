import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import PageLayout from '@/components/ui/PageLayout.jsx';
import Card from '@/components/ui/CustomCard.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';

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

function formatCurrency(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `₪${Number(value).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function FinancialsPage() {
  const { session } = useAuth();
  const { activeOrgId } = useOrg();
  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()));
  const [loading, setLoading] = useState(false);
  const [payroll, setPayroll] = useState(null);
  const [commitments, setCommitments] = useState([]);
  const [billingQueue, setBillingQueue] = useState([]);
  const [entries, setEntries] = useState([]);

  const monthStart = useMemo(() => toLocalDateString(startOfMonth(monthDate)), [monthDate]);
  const monthEnd = useMemo(() => toLocalDateString(endOfMonth(monthDate)), [monthDate]);

  useEffect(() => {
    if (!activeOrgId) return;
    let active = true;
    setLoading(true);
    Promise.all([
      authenticatedFetch('payroll', {
        session,
        params: { org_id: activeOrgId, start_date: monthStart, end_date: monthEnd },
      }),
      authenticatedFetch('commitments', {
        session,
        params: { org_id: activeOrgId, start_date: monthStart, end_date: monthEnd },
      }),
      authenticatedFetch('consumption-entries', {
        session,
        params: { org_id: activeOrgId },
      }),
    ])
      .then(([payrollPayload, commitmentsPayload, entriesPayload]) => {
        if (!active) return;
        setPayroll(payrollPayload || null);
        setCommitments(Array.isArray(commitmentsPayload?.commitments) ? commitmentsPayload.commitments : []);
        setBillingQueue(Array.isArray(commitmentsPayload?.billing_queue) ? commitmentsPayload.billing_queue : []);
        setEntries(Array.isArray(entriesPayload?.entries) ? entriesPayload.entries : []);
      })
      .catch((error) => {
        console.error('Failed to load financials page', error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [activeOrgId, monthEnd, monthStart, session]);

  return (
    <PageLayout title="כספים" description="שכר עובדים וחיובי תלמידים">
      <div className="mb-4 flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setMonthDate(addMonths(monthDate, -1))}>הקודם</Button>
        <div className="min-w-[140px] text-center text-sm font-semibold text-zinc-700">{formatMonth(monthDate)}</div>
        <Button size="sm" variant="outline" onClick={() => setMonthDate(addMonths(monthDate, 1))}>הבא</Button>
      </div>

      <Tabs defaultValue="payroll" className="space-y-4">
        <TabsList className="h-auto rounded-2xl bg-slate-100 p-1">
          <TabsTrigger value="payroll" className="rounded-xl px-4 py-2">שכר</TabsTrigger>
          <TabsTrigger value="billing" className="rounded-xl px-4 py-2">חיובים</TabsTrigger>
        </TabsList>

        <TabsContent value="payroll">
          <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
            {loading ? (
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
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="billing">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
              <h3 className="mb-3 text-lg font-semibold text-zinc-800">התחייבויות</h3>
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  טוען התחייבויות...
                </div>
              ) : (
                <div className="space-y-3">
                  {commitments.map((commitment) => (
                    <div key={commitment.id} className="rounded-xl border border-border bg-slate-50/70 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-zinc-900">{commitment.commitment_type}</div>
                          <div className="text-xs text-muted-foreground">שירות: {commitment.service_id}</div>
                        </div>
                        <div className="text-sm font-semibold">{formatCurrency(commitment.remaining_amount)}</div>
                      </div>
                    </div>
                  ))}
                  {commitments.length === 0 ? <p className="text-sm text-muted-foreground">אין התחייבויות להצגה.</p> : null}
                </div>
              )}
            </Card>

            <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
              <h3 className="mb-3 text-lg font-semibold text-zinc-800">תור חיוב</h3>
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  טוען תור חיוב...
                </div>
              ) : (
                <div className="space-y-3">
                  {billingQueue.map((item) => (
                    <div key={item.id} className="rounded-xl border border-border bg-slate-50/70 p-4">
                      <div className="font-semibold text-zinc-900">{item.lesson_instance?.datetime_start || item.id}</div>
                      <div className="text-xs text-muted-foreground">{item.participant_status}</div>
                    </div>
                  ))}
                  {billingQueue.length === 0 ? <p className="text-sm text-muted-foreground">אין שיעורים ממתינים לחיוב.</p> : null}
                </div>
              )}
            </Card>

            <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm xl:col-span-2">
              <h3 className="mb-3 text-lg font-semibold text-zinc-800">היסטוריית תנועות</h3>
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  טוען תנועות...
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="pb-2 text-start font-medium">מקור</th>
                        <th className="pb-2 text-start font-medium">סכום</th>
                        <th className="pb-2 text-start font-medium">תאריך</th>
                        <th className="pb-2 text-start font-medium">הערות</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => (
                        <tr key={entry.id} className="border-b border-border/60">
                          <td className="py-3">{entry.source_type}</td>
                          <td className="py-3">{formatCurrency(entry.amount_charged)}</td>
                          <td className="py-3">{entry.effective_date || entry.created_at}</td>
                          <td className="py-3">{entry.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
