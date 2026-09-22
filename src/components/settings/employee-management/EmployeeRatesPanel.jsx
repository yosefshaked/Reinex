import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, ChevronDown, Loader2, Plus, TriangleAlert } from 'lucide-react';
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
import { toast } from '@/lib/toast.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { formatCurrency, toAgorot } from '@/lib/currency.js';

const LESSON_BASES = ['lesson_hourly', 'lesson_flat'];

const BASIS_SUFFIX = {
  lesson_hourly: 'לשעה',
  lesson_flat: 'למפגש',
  attendance_hourly: 'לשעה',
  monthly_salary: 'לחודש',
  leave_day: 'ליום',
};

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatDate(dateKey) {
  if (!dateKey) return '';
  const [year, month, day] = dateKey.split('-');
  return `${day}.${month}.${year}`;
}

function isLessonBasis(basis) {
  return LESSON_BASES.includes(basis);
}

// Rates carried over from before rate history existed start at 2000-01-01; showing that date confuses.
const BACKFILL_DATE = '2000-01-01';

function effectiveFromLabel(row) {
  if (!row) return '';
  return row.effective_date <= BACKFILL_DATE ? 'בתוקף מאז תחילת ההעסקה' : `בתוקף מ-${formatDate(row.effective_date)}`;
}

function historyFromLabel(row) {
  if (!row) return '';
  return row.effective_date <= BACKFILL_DATE ? 'מאז תחילת ההעסקה' : `מ-${formatDate(row.effective_date)}`;
}

/** The rows of one card: a service's lesson rates, or one of the employee-level kinds. */
function rowsForCard(rates, card) {
  return rates
    .filter((row) => (card.serviceId
      ? (isLessonBasis(row.pay_basis) && row.service_id === card.serviceId)
      : (row.pay_basis === card.payBasis && !row.service_id)))
    .sort((left, right) => right.effective_date.localeCompare(left.effective_date));
}

function describeRate(row) {
  if (!row) return null;
  return `${formatCurrency(row.rate)} ${BASIS_SUFFIX[row.pay_basis] || ''}`.trim();
}

function RateCard({ card, rates, today, onSave, saving }) {
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [form, setForm] = useState({ amount: '', basis: card.payBasis, effectiveDate: today, notes: '' });

  const history = useMemo(() => rowsForCard(rates, card), [rates, card]);
  const current = history.find((row) => row.effective_date <= today) || null;
  const scheduled = history.filter((row) => row.effective_date > today).slice(-1)[0] || null;
  const existingOnDate = history.find((row) => row.effective_date === form.effectiveDate) || null;

  const warnings = [];
  if (form.effectiveDate && form.effectiveDate < today) {
    warnings.push('התעריף יחול על ימים שכבר עברו. שכר של חודשים פתוחים יחושב מחדש.');
  }
  if (current && form.effectiveDate && form.effectiveDate < current.effective_date) {
    warnings.push(`התעריף ייכנס לפני התעריף הנוכחי (מ-${formatDate(current.effective_date)}) ויהיה בתוקף רק עד אליו.`);
  }
  if (existingOnDate) {
    warnings.push(`כבר קיים תעריף בתאריך הזה (${describeRate(existingOnDate)}). השמירה תחליף אותו.`);
  }

  function resetForm() {
    setForm({ amount: '', basis: card.payBasis, effectiveDate: today, notes: '' });
  }

  async function handleSave() {
    const saved = await onSave({
      payBasis: isLessonBasis(card.payBasis) ? form.basis : card.payBasis,
      serviceId: card.serviceId || null,
      rate: toAgorot(form.amount),
      effectiveDate: form.effectiveDate,
      notes: form.notes || null,
      replaceExisting: Boolean(existingOnDate),
    });
    if (saved) {
      resetForm();
      setOpen(false);
    }
  }

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-slate-900">{card.title}</h4>
          {current ? (
            <>
              <div className="mt-1 text-xl font-bold text-slate-900">{describeRate(current)}</div>
              <div className="text-xs text-slate-500">{effectiveFromLabel(current)}</div>
            </>
          ) : (
            <div className="mt-1 flex items-center gap-1.5 text-sm font-bold text-amber-700">
              <TriangleAlert className="h-4 w-4" /> לא הוגדר תעריף
            </div>
          )}
          {scheduled ? (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2 py-1 text-xs font-bold text-primary">
              <CalendarClock className="h-3.5 w-3.5" />
              מ-{formatDate(scheduled.effective_date)}: {describeRate(scheduled)}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {history.length > 0 ? (
            <Button type="button" size="sm" variant="ghost" className="gap-1 text-xs" onClick={() => setShowHistory((value) => !value)}>
              היסטוריה ({history.length})
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showHistory ? 'rotate-180' : ''}`} />
            </Button>
          ) : null}
          <Button type="button" size="sm" variant={current ? 'outline' : 'default'} className="gap-1" onClick={() => setOpen((value) => !value)} disabled={saving}>
            <Plus className="h-3.5 w-3.5" />
            {current ? 'עדכון תעריף' : 'הגדרת תעריף'}
          </Button>
        </div>
      </div>

      {showHistory && history.length > 0 ? (
        <ol className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {history.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="font-bold text-slate-900">{describeRate(row)}</span>
              <span className="text-xs text-slate-500">
                {historyFromLabel(row)}
                {row.effective_date > today ? ' (עתידי)' : ''}
                {row.notes ? ` · ${row.notes}` : ''}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {open ? (
        <div className="mt-4 grid gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`rate-amount-${card.key}`} className="text-xs text-slate-600">סכום בשקלים</Label>
              <Input
                id={`rate-amount-${card.key}`}
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(event) => setForm((value) => ({ ...value, amount: event.target.value }))}
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`rate-date-${card.key}`} className="text-xs text-slate-600">בתוקף מתאריך</Label>
              <Input
                id={`rate-date-${card.key}`}
                type="date"
                value={form.effectiveDate}
                onChange={(event) => setForm((value) => ({ ...value, effectiveDate: event.target.value }))}
                disabled={saving}
              />
            </div>
          </div>

          {isLessonBasis(card.payBasis) ? (
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">אופן החישוב</Label>
              <Select value={form.basis} onValueChange={(value) => setForm((current2) => ({ ...current2, basis: value }))} disabled={saving}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lesson_hourly">לפי שעה (הסכום מוכפל במשך המפגש)</SelectItem>
                  <SelectItem value="lesson_flat">למפגש (אותו סכום בכל אורך מפגש)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor={`rate-notes-${card.key}`} className="text-xs text-slate-600">הערה (לא חובה)</Label>
            <Input
              id={`rate-notes-${card.key}`}
              value={form.notes}
              onChange={(event) => setForm((value) => ({ ...value, notes: event.target.value }))}
              disabled={saving}
            />
          </div>

          {warnings.length > 0 ? (
            <ul className="space-y-1 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {warnings.map((warning) => (
                <li key={warning} className="flex items-start gap-1.5">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={handleSave} disabled={saving || form.amount === '' || !form.effectiveDate}>
              {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
              שמירת תעריף
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { resetForm(); setOpen(false); }} disabled={saving}>
              ביטול
            </Button>
            <span className="text-xs text-slate-500">התעריף הקודם נשמר בהיסטוריה ומפגשים שקדמו לתאריך לא ישתנו.</span>
          </div>
        </div>
      ) : null}
    </article>
  );
}

/**
 * Pay rates of one employee: what they earn per service, and from when (RateHistory).
 * Rates are never edited in place; saving adds a rate that applies from the date you choose.
 */
export default function EmployeeRatesPanel({ employee, orgId, session, services = [] }) {
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const today = todayKey();

  const loadRates = useCallback(async () => {
    if (!employee?.id || !orgId) return;
    setLoading(true);
    try {
      const payload = await authenticatedFetch('employee-rates', {
        session,
        params: { org_id: orgId, employee_id: employee.id },
      });
      setRates(Array.isArray(payload?.rates) ? payload.rates : []);
    } catch (error) {
      console.error('Failed to load employee rates', error);
      toast.error(error?.message || 'טעינת התעריפים נכשלה.');
    } finally {
      setLoading(false);
    }
  }, [employee?.id, orgId, session]);

  useEffect(() => {
    void loadRates();
  }, [loadRates]);

  const cards = useMemo(() => {
    const serviceCards = (employee?.service_capabilities || []).map((capability) => ({
      key: `service-${capability.service_id}`,
      title: services.find((service) => service.id === capability.service_id)?.name || 'שירות',
      payBasis: 'lesson_hourly',
      serviceId: capability.service_id,
    }));

    const employeeLevel = [
      { key: 'attendance_hourly', title: 'שכר שעתי (שעות עבודה)', payBasis: 'attendance_hourly', serviceId: null },
      { key: 'monthly_salary', title: 'שכר חודשי', payBasis: 'monthly_salary', serviceId: null },
      { key: 'leave_day', title: 'ערך יום חופשה קבוע', payBasis: 'leave_day', serviceId: null },
    ].filter((card) => {
      if (rates.some((row) => row.pay_basis === card.payBasis && !row.service_id)) return true;
      if (card.payBasis === 'attendance_hourly') return employee?.payroll_model === 'hourly';
      if (card.payBasis === 'monthly_salary') return employee?.payroll_model === 'monthly_salary';
      return employee?.leave_pay_method === 'fixed_rate';
    });

    return [...serviceCards, ...employeeLevel];
  }, [employee, rates, services]);

  async function handleSave({ payBasis, serviceId, rate, effectiveDate, notes, replaceExisting }) {
    setSaving(true);
    try {
      await authenticatedFetch('employee-rates', {
        session,
        method: 'POST',
        body: {
          org_id: orgId,
          employee_id: employee.id,
          pay_basis: payBasis,
          service_id: serviceId,
          rate,
          effective_date: effectiveDate,
          notes,
          replace_existing: replaceExisting,
        },
      });
      await loadRates();
      toast.success(effectiveDate > today ? 'התעריף נשמר ויחול מהתאריך שנבחר.' : 'התעריף נשמר.');
      return true;
    } catch (error) {
      console.error('Failed to save rate', error);
      toast.error(error?.message || 'שמירת התעריף נכשלה.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900">תעריפי שכר</h3>
          <p className="text-xs text-slate-500">
            כל תעריף חל מהתאריך שנבחר ועד לשינוי הבא. מפגשים וימי עבודה מחושבים לפי התעריף שהיה בתוקף באותו יום.
          </p>
        </div>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
      </div>

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
          אין שירותים משויכים לעובד/ת. הוספת שירות בכרטיס העובד/ת תאפשר להגדיר תעריף.
        </div>
      ) : (
        <div className="grid gap-3">
          {cards.map((card) => (
            <RateCard
              key={card.key}
              card={card}
              rates={rates}
              today={today}
              saving={saving}
              onSave={handleSave}
            />
          ))}
        </div>
      )}
    </section>
  );
}
