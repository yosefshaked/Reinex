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

function formatCurrency(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `₪${Number(value).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateString) {
  if (!dateString) return '—';
  return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(dateString));
}

function getServiceName(services, serviceId) {
  return services.find((service) => service.id === serviceId)?.service_name || services.find((service) => service.id === serviceId)?.name || 'שירות';
}

export default function StudentFinancialTab({ studentId }) {
  const { session } = useAuth();
  const { activeOrgId } = useOrg();
  const { services } = useServices({ enabled: Boolean(activeOrgId), orgId: activeOrgId, session });

  const [loading, setLoading] = useState(false);
  const [commitments, setCommitments] = useState([]);
  const [billingQueue, setBillingQueue] = useState([]);
  const [entries, setEntries] = useState([]);
  const [saving, setSaving] = useState(false);
  const [commitmentForm, setCommitmentForm] = useState({
    serviceId: '',
    commitmentType: 'package',
    totalAmount: '',
    defaultChargeAmount: '',
    expiresAt: '',
    notes: '',
  });
  const [entryForm, setEntryForm] = useState({
    sourceType: 'adjustment',
    amountCharged: '',
    effectiveDate: '',
    notes: '',
  });
  const [assignmentValues, setAssignmentValues] = useState({});

  const filteredQueue = useMemo(() => billingQueue.filter((item) => item.student_id === studentId), [billingQueue, studentId]);

  const loadData = useCallback(async () => {
    if (!studentId || !activeOrgId) return;
    setLoading(true);
    try {
      const [commitmentsPayload, entriesPayload] = await Promise.all([
        authenticatedFetch('commitments', {
          session,
          params: { org_id: activeOrgId, student_id: studentId },
        }),
        authenticatedFetch('consumption-entries', {
          session,
          params: { org_id: activeOrgId, student_id: studentId },
        }),
      ]);

      setCommitments(Array.isArray(commitmentsPayload?.commitments) ? commitmentsPayload.commitments : []);
      setBillingQueue(Array.isArray(commitmentsPayload?.billing_queue) ? commitmentsPayload.billing_queue : []);
      setEntries(Array.isArray(entriesPayload?.entries) ? entriesPayload.entries : []);
    } catch (error) {
      console.error('Failed to load student finance data', error);
      toast.error(error?.message || 'טעינת נתוני הכספים נכשלה.');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, session, studentId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleCreateCommitment() {
    if (!studentId || !activeOrgId) return;
    setSaving(true);
    try {
      await authenticatedFetch('commitments', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          student_id: studentId,
          service_id: commitmentForm.serviceId,
          commitment_type: commitmentForm.commitmentType,
          total_amount: Number(commitmentForm.totalAmount),
          default_charge_amount: commitmentForm.defaultChargeAmount === '' ? null : Number(commitmentForm.defaultChargeAmount),
          expires_at: commitmentForm.expiresAt || null,
          notes: commitmentForm.notes || null,
        },
      });
      setCommitmentForm({
        serviceId: '',
        commitmentType: 'package',
        totalAmount: '',
        defaultChargeAmount: '',
        expiresAt: '',
        notes: '',
      });
      await loadData();
      toast.success('התחייבות נשמרה.');
    } catch (error) {
      console.error('Failed to create commitment', error);
      toast.error(error?.message || 'שמירת ההתחייבות נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignCommitment(queueItem) {
    const selectedCommitmentId = assignmentValues[queueItem.id];
    if (!selectedCommitmentId || !activeOrgId) return;
    setSaving(true);
    try {
      await authenticatedFetch('consumption-entries', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          action: 'assign_participant_commitment',
          lesson_participant_id: queueItem.id,
          commitment_id: selectedCommitmentId,
        },
      });
      await loadData();
      toast.success('ההתחייבות קושרה לשיעור.');
    } catch (error) {
      console.error('Failed to assign commitment', error);
      toast.error(error?.message || 'שיוך ההתחייבות נכשל.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateManualEntry() {
    if (!activeOrgId) return;
    setSaving(true);
    try {
      await authenticatedFetch('consumption-entries', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          student_id: studentId,
          source_type: entryForm.sourceType,
          amount_charged: Number(entryForm.amountCharged),
          effective_date: entryForm.effectiveDate || null,
          notes: entryForm.notes || null,
        },
      });
      setEntryForm({
        sourceType: 'adjustment',
        amountCharged: '',
        effectiveDate: '',
        notes: '',
      });
      await loadData();
      toast.success('תנועת חיוב נשמרה.');
    } catch (error) {
      console.error('Failed to create manual entry', error);
      toast.error(error?.message || 'שמירת תנועת החיוב נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  if (!studentId) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="h-1.5 bg-emerald-500" />
          <div className="p-5 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-zinc-800">התחייבויות ויתרות</h3>
              <p className="text-sm text-muted-foreground">מקור המחיר לשיעורים ומאגר היתרה של התלמיד.</p>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                טוען נתוני התחייבויות...
              </div>
            ) : (
              <div className="space-y-3">
                {commitments.map((commitment) => (
                  <div key={commitment.id} className="rounded-xl border border-border bg-slate-50/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-zinc-900">{getServiceName(services, commitment.service_id)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {commitment.commitment_type} • חיוב ברירת מחדל {formatCurrency(commitment.default_charge_amount)}
                        </div>
                      </div>
                      <Badge variant="outline">{formatCurrency(commitment.remaining_amount)}</Badge>
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
                        <div className="text-[11px] text-muted-foreground">פג תוקף</div>
                        <div className="mt-1 font-semibold">{formatDate(commitment.expires_at)}</div>
                      </div>
                    </div>
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

        <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="h-1.5 bg-blue-500" />
          <div className="p-5 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-zinc-800">התחייבות חדשה</h3>
              <p className="text-sm text-muted-foreground">יצירת יתרה כספית חדשה עם מחיר ברירת מחדל לשיעור.</p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-slate-600">שירות</Label>
              <Select value={commitmentForm.serviceId} onValueChange={(value) => setCommitmentForm((current) => ({ ...current, serviceId: value }))} disabled={saving}>
                <SelectTrigger>
                  <SelectValue placeholder="בחר שירות" />
                </SelectTrigger>
                <SelectContent>
                  {services.map((service) => (
                    <SelectItem key={service.id} value={service.id}>{service.service_name || service.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs text-slate-600">סוג התחייבות</Label>
                <Select value={commitmentForm.commitmentType} onValueChange={(value) => setCommitmentForm((current) => ({ ...current, commitmentType: value }))} disabled={saving}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="package">חבילה</SelectItem>
                    <SelectItem value="subscription">מנוי</SelectItem>
                    <SelectItem value="hmo">קופה / גורם מממן</SelectItem>
                    <SelectItem value="manual_credit">זיכוי ידני</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="total-amount" className="text-xs text-slate-600">סך התחייבות</Label>
                <Input id="total-amount" type="number" min="0" step="0.01" value={commitmentForm.totalAmount} onChange={(event) => setCommitmentForm((current) => ({ ...current, totalAmount: event.target.value }))} disabled={saving} />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="default-charge" className="text-xs text-slate-600">מחיר ברירת מחדל לשיעור</Label>
                <Input id="default-charge" type="number" min="0" step="0.01" value={commitmentForm.defaultChargeAmount} onChange={(event) => setCommitmentForm((current) => ({ ...current, defaultChargeAmount: event.target.value }))} disabled={saving} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expires-at" className="text-xs text-slate-600">תוקף</Label>
                <Input id="expires-at" type="date" value={commitmentForm.expiresAt} onChange={(event) => setCommitmentForm((current) => ({ ...current, expiresAt: event.target.value }))} disabled={saving} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="commitment-notes" className="text-xs text-slate-600">הערות</Label>
              <Input id="commitment-notes" value={commitmentForm.notes} onChange={(event) => setCommitmentForm((current) => ({ ...current, notes: event.target.value }))} disabled={saving} />
            </div>

            <Button onClick={handleCreateCommitment} disabled={saving || !commitmentForm.serviceId || commitmentForm.totalAmount === ''}>
              {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
              צור התחייבות
            </Button>
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="h-1.5 bg-amber-500" />
        <div className="p-5 space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-zinc-800">תור חיוב לשיעורים</h3>
            <p className="text-sm text-muted-foreground">שיעורים בלי התחייבות משויכת נשארים ממתינים לחיוב.</p>
          </div>

          {filteredQueue.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-muted-foreground">
              אין שיעורים ממתינים לחיוב.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredQueue.map((item) => {
                const candidateCommitments = commitments.filter((commitment) => !item.lesson_instance?.service_id || commitment.service_id === item.lesson_instance.service_id);
                return (
                  <div key={item.id} className="rounded-xl border border-border bg-slate-50/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-zinc-900">{formatDate(item.lesson_instance?.datetime_start)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{getServiceName(services, item.lesson_instance?.service_id)} • {item.participant_status}</div>
                      </div>
                      <div className="flex gap-2">
                        <Select value={assignmentValues[item.id] || ''} onValueChange={(value) => setAssignmentValues((current) => ({ ...current, [item.id]: value }))} disabled={saving}>
                          <SelectTrigger className="min-w-[220px]">
                            <SelectValue placeholder="בחר התחייבות" />
                          </SelectTrigger>
                          <SelectContent>
                            {candidateCommitments.map((commitment) => (
                              <SelectItem key={commitment.id} value={commitment.id}>
                                {getServiceName(services, commitment.service_id)} • {formatCurrency(commitment.remaining_amount)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button onClick={() => handleAssignCommitment(item)} disabled={saving || !assignmentValues[item.id]}>
                          שיוך
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="h-1.5 bg-zinc-800" />
          <div className="p-5 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-zinc-800">תנועה ידנית</h3>
              <p className="text-sm text-muted-foreground">הוספת התאמה או העברה שלא מגיעה משיעור.</p>
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
                <Label htmlFor="entry-amount" className="text-xs text-slate-600">סכום</Label>
                <Input id="entry-amount" type="number" step="0.01" value={entryForm.amountCharged} onChange={(event) => setEntryForm((current) => ({ ...current, amountCharged: event.target.value }))} disabled={saving} />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="entry-date" className="text-xs text-slate-600">תאריך</Label>
                <Input id="entry-date" type="date" value={entryForm.effectiveDate} onChange={(event) => setEntryForm((current) => ({ ...current, effectiveDate: event.target.value }))} disabled={saving} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="entry-notes" className="text-xs text-slate-600">הערות</Label>
                <Input id="entry-notes" value={entryForm.notes} onChange={(event) => setEntryForm((current) => ({ ...current, notes: event.target.value }))} disabled={saving} />
              </div>
            </div>

            <Button onClick={handleCreateManualEntry} disabled={saving || entryForm.amountCharged === ''}>
              {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
              הוסף תנועה
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="h-1.5 bg-purple-500" />
          <div className="p-5 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-zinc-800">היסטוריית חיובים</h3>
              <p className="text-sm text-muted-foreground">תנועות שנצרכו מהתחייבויות או נוספו ידנית.</p>
            </div>

            <div className="space-y-3">
              {entries.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-border bg-slate-50/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-zinc-900">{entry.source_type} • {formatCurrency(entry.amount_charged)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{formatDate(entry.effective_date || entry.created_at)} • {entry.notes || 'ללא הערות'}</div>
                    </div>
                    <Badge variant="outline">{entry.commitment_id ? 'משויך להתחייבות' : 'ללא התחייבות'}</Badge>
                  </div>
                </div>
              ))}
              {entries.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-muted-foreground">
                  אין תנועות חיוב להצגה.
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
