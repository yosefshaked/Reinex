import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { useServices } from '@/hooks/useOrgData.js';
import HmoAuthorizationManager from '@/features/students/components/HmoAuthorizationManager.jsx';
import { isAdminOrOffice, isAdminRole, normalizeMembershipRole } from '@/features/students/utils/endpoints.js';
import { formatCurrency } from '@/lib/currency.js';

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

function buildEntryForm() {
  return {
    mode: 'payment',
    amount: '',
    effectiveAt: new Date().toISOString().slice(0, 10),
    notes: '',
    externalReference: '',
  };
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
  const [snapshot, setSnapshot] = useState(null);
  const [entryForm, setEntryForm] = useState(() => buildEntryForm());

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

  async function handleAppendEntry() {
    if (!activeOrgId || !studentId || !canMutateBilling) return;
    if (!entryForm.amount) {
      toast.error('יש להזין סכום.');
      return;
    }

    setSaving(true);
    try {
      await authenticatedFetch('billing', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          action: entryForm.mode === 'adjustment' ? 'append_manual_debit' : 'append_manual_credit',
          account_type: 'student',
          account_ref_id: studentId,
          amount: entryForm.amount,
          effective_at: entryForm.effectiveAt || null,
          source_type: entryForm.mode === 'adjustment' ? 'manual_adjustment' : 'manual_payment',
          notes: entryForm.notes || null,
          external_reference: entryForm.externalReference || null,
        },
      });
      setEntryForm(buildEntryForm());
      await loadData();
      await notifyDataChanged();
      toast.success(entryForm.mode === 'adjustment' ? 'ההתאמה נשמרה.' : 'התשלום נשמר.');
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

  async function handleReconcile() {
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
        },
      });
      await loadData();
      await notifyDataChanged();
      toast.success('חיובי השיעורים נבנו מחדש מהלדר.');
    } catch (error) {
      console.error('Failed to reconcile student billing', error);
      toast.error(error?.message || 'חישוב החיובים נכשל.');
    } finally {
      setReconciling(false);
    }
  }

  const summary = snapshot?.summary || {};
  const ledgerEntries = Array.isArray(snapshot?.ledger_entries) ? snapshot.ledger_entries : [];
  const lessonHistory = Array.isArray(snapshot?.lesson_history) ? snapshot.lesson_history : [];
  const authorizations = Array.isArray(snapshot?.authorizations) ? snapshot.authorizations : [];
  const studentName = useMemo(() => {
    const source = snapshot?.student || student;
    return source?.full_name || [source?.first_name, source?.middle_name, source?.last_name].filter(Boolean).join(' ') || 'תלמיד';
  }, [snapshot, student]);

  if (!canViewBilling) {
    return (
      <div className="rounded-xl border border-border bg-white p-6 text-sm text-muted-foreground shadow-sm">
        אין הרשאה לצפייה בחיובים.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="text-xs text-blue-700">יתרה נוכחית</div>
          <div className="mt-1 text-xl font-bold text-blue-950">{formatCurrency(summary.balance)}</div>
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

      {canMutateBilling ? (
        <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="h-1.5 bg-slate-900" />
          <div className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-zinc-900">הוספת תנועה ידנית</h3>
                <p className="text-sm text-muted-foreground">תשלום מגדיל יתרה, התאמה ידנית מקטינה אותה.</p>
              </div>
              <Button type="button" variant="outline" onClick={handleReconcile} disabled={reconciling}>
                {reconciling ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                בנה מחדש חיובי שיעורים
              </Button>
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
                <Input type="number" min="0" step="0.01" value={entryForm.amount} onChange={(event) => setEntryForm((current) => ({ ...current, amount: event.target.value }))} />
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
              <Label>הערות</Label>
              <Input value={entryForm.notes} onChange={(event) => setEntryForm((current) => ({ ...current, notes: event.target.value }))} />
            </div>

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

      <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="h-1.5 bg-violet-500" />
        <div className="p-5 space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-zinc-900">פנקס תנועות</h3>
            <p className="text-sm text-muted-foreground">{studentName} • הלדר הוא מקור האמת היחיד.</p>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              טוען תנועות...
            </div>
          ) : (
            <div className="space-y-3">
              {ledgerEntries.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-border bg-slate-50/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-zinc-900">
                        {getEntryTypeLabel(entry)} • {entry.direction === 'CREDIT' ? '+' : '-'}{formatCurrency(entry.amount)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatDateTime(entry.effective_at || entry.posted_at)}
                        {entry.notes ? ` • ${entry.notes}` : ''}
                        {entry.external_reference ? ` • ${entry.external_reference}` : ''}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={entry.direction === 'CREDIT' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}>
                        {entry.direction === 'CREDIT' ? 'זיכוי' : 'חיוב'}
                      </Badge>
                      {canMutateBilling && ['manual_payment', 'manual_adjustment', 'lesson_charge'].includes(entry.source_type) ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => handleReverseEntry(entry.id)} disabled={saving}>
                          היפוך
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
              {ledgerEntries.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-muted-foreground">
                  אין תנועות להצגה בטווח הנבחר.
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="h-1.5 bg-orange-500" />
        <div className="p-5 space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-zinc-900">היסטוריית שיעורים</h3>
            <p className="text-sm text-muted-foreground">חיוב תלמיד מוצג בנפרד מחיוב הגורם המממן.</p>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              טוען שיעורים...
            </div>
          ) : (
            <div className="space-y-3">
              {lessonHistory.map((row) => (
                <div key={row.id} className="rounded-xl border border-border bg-slate-50/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-zinc-900">{formatDateTime(row.lesson_instance?.datetime_start)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {getServiceName(services, row.lesson_instance?.service_id)} • {getParticipantStatusLabel(row.participant_status)}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{formatCurrency(row.student_charge_amount || 0)}</Badge>
                      {row.hmo_charge_amount ? (
                        <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-900">
                          גורם מממן {formatCurrency(row.hmo_charge_amount)}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
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
          שיעורים עם אישור HMO פעיל יחויבו אוטומטית לפי התעריף החוזי של האישור ולפי תעריף השירות הכללי עבור ההשתתפות העצמית.
        </section>
      )}
    </div>
  );
}
