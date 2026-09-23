import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, CalendarDays, ChevronDown, Clock, GraduationCap, Loader2, Plus, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

/**
 * The kinds of pay for work the office can set, in the order they are offered.
 *
 * Leave pay is not one of them: it is a method on the employee (legal average, historical average
 * or a fixed value), set with the other leave settings in the employee card.
 */
const RATE_KINDS = [
  { key: 'lesson', payBasis: 'lesson_hourly', title: 'לפי מפגש', hint: 'תעריף לכל שירות', icon: GraduationCap, payrollModel: 'lesson_based' },
  { key: 'attendance_hourly', payBasis: 'attendance_hourly', title: 'שעתי', hint: 'לפי שעות עבודה', icon: Clock, payrollModel: 'hourly' },
  { key: 'monthly_salary', payBasis: 'monthly_salary', title: 'חודשי', hint: 'משכורת קבועה', icon: CalendarDays, payrollModel: 'monthly_salary' },
];

/** Whether the employee already has a rate of this kind. Every kind they have is paid. */
function hasRateOfKind(kind, rates) {
  return (Array.isArray(rates) ? rates : []).some((row) => (kind.key === 'lesson'
    ? LESSON_BASES.includes(row.pay_basis)
    : row.pay_basis === kind.payBasis && !row.service_id));
}

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

/** The warnings shown before saving: what the chosen date does to rates that already exist. */
function buildWarnings({ history, current, existingOnDate, effectiveDate, today, isLesson }) {
  const warnings = [];
  if (effectiveDate && effectiveDate < today) {
    warnings.push('התעריף יחול על ימים שכבר עברו. שכר של חודשים פתוחים יחושב מחדש.');
  }
  if (current && effectiveDate && effectiveDate < current.effective_date) {
    warnings.push(`התעריף ייכנס לפני התעריף הנוכחי (מ-${formatDate(current.effective_date)}) ויהיה בתוקף רק עד אליו.`);
  }
  if (existingOnDate) {
    warnings.push(`כבר קיים תעריף בתאריך הזה (${describeRate(existingOnDate)}). השמירה תחליף אותו.`);
  }
  if (!existingOnDate && history.length === 0) {
    warnings.push(isLesson
      ? 'זהו התעריף הראשון בשירות הזה. מפגשים לפני התאריך שנבחר יישארו ללא תעריף.'
      : 'זהו התעריף הראשון מסוג זה. ימים לפני התאריך שנבחר לא יחושבו.');
  }
  return warnings;
}

function createEmptyForm(payBasis, today) {
  return { amount: '', basis: payBasis, effectiveDate: today, notes: '' };
}

/** The fields of a rate: amount, date, how a lesson is counted, and a note. Shared by the card and the dialog. */
function RateFields({ idPrefix, form, setForm, allowBasisChoice, warnings, saving, unitBasis }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`rate-amount-${idPrefix}`} className="text-xs text-slate-600">
            סכום בשקלים
            {BASIS_SUFFIX[unitBasis] ? <span className="text-slate-400"> · {BASIS_SUFFIX[unitBasis]}</span> : null}
          </Label>
          <Input
            id={`rate-amount-${idPrefix}`}
            type="number"
            min="0"
            step="0.01"
            value={form.amount}
            onChange={(event) => setForm((value) => ({ ...value, amount: event.target.value }))}
            disabled={saving}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`rate-date-${idPrefix}`} className="text-xs text-slate-600">בתוקף מתאריך</Label>
          <Input
            id={`rate-date-${idPrefix}`}
            type="date"
            value={form.effectiveDate}
            onChange={(event) => setForm((value) => ({ ...value, effectiveDate: event.target.value }))}
            disabled={saving}
          />
        </div>
      </div>

      {allowBasisChoice ? (
        <div className="space-y-1.5">
          <Label className="text-xs text-slate-600">אופן החישוב</Label>
          <Select value={form.basis} onValueChange={(value) => setForm((current) => ({ ...current, basis: value }))} disabled={saving}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="lesson_hourly">לפי שעה (הסכום מוכפל במשך המפגש)</SelectItem>
              <SelectItem value="lesson_flat">למפגש (אותו סכום בכל אורך מפגש)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor={`rate-notes-${idPrefix}`} className="text-xs text-slate-600">הערה (לא חובה)</Label>
        <Input
          id={`rate-notes-${idPrefix}`}
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
    </>
  );
}

function RateCard({ card, rates, today, onSave, saving }) {
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const history = useMemo(() => rowsForCard(rates, card), [rates, card]);
  const current = history.find((row) => row.effective_date <= today) || null;
  // A raise should not silently change the agreement: the form opens on the unit that is in effect,
  // so updating a per-session rate stays per-session unless the office deliberately switches it.
  const currentBasis = current?.pay_basis || card.payBasis;
  const [form, setForm] = useState(() => createEmptyForm(currentBasis, today));

  useEffect(() => {
    if (!open) setForm(createEmptyForm(currentBasis, today));
  }, [currentBasis, open, today]);
  const scheduled = history.filter((row) => row.effective_date > today).slice(-1)[0] || null;
  const existingOnDate = history.find((row) => row.effective_date === form.effectiveDate) || null;
  const warnings = buildWarnings({
    history,
    current,
    existingOnDate,
    effectiveDate: form.effectiveDate,
    today,
    isLesson: isLessonBasis(card.payBasis),
  });

  function resetForm() {
    setForm(createEmptyForm(currentBasis, today));
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
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="text-sm font-bold text-slate-900">{card.title}</h4>
            {card.unassigned ? (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">שירות לא משויך</span>
            ) : null}
          </div>
          {card.hint ? <p className="mt-0.5 text-xs text-slate-500">{card.hint}</p> : null}
          {current ? (
            <>
              <div className="mt-1 flex flex-wrap items-baseline gap-1.5">
                <span className="text-xs font-bold text-slate-500">נוכחי:</span>
                <span className="text-xl font-bold text-slate-900">{describeRate(current)}</span>
              </div>
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
          <RateFields
            idPrefix={card.key}
            form={form}
            setForm={setForm}
            allowBasisChoice={isLessonBasis(card.payBasis)}
            unitBasis={isLessonBasis(card.payBasis) ? form.basis : card.payBasis}
            warnings={warnings}
            saving={saving}
          />

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
 * One way in for every kind of rate: pick what the rate is (per service, hourly, monthly, leave day),
 * then set it. A kind the employee's pay model doesn't read is offered too, and saving it switches
 * the employee to that model, so the rate actually pays.
 */
function AddRateDialog({ open, onOpenChange, services, rates, today, onSave, saving }) {
  const [kindKey, setKindKey] = useState(RATE_KINDS[0].key);
  const [serviceId, setServiceId] = useState('');
  const [form, setForm] = useState(() => createEmptyForm('lesson_hourly', today));

  const kind = RATE_KINDS.find((item) => item.key === kindKey) || RATE_KINDS[0];
  const isLessonKind = kind.key === 'lesson';

  useEffect(() => {
    if (!open) return;
    const initial = RATE_KINDS.find((item) => hasRateOfKind(item, rates)) || RATE_KINDS[0];
    setKindKey(initial.key);
    setServiceId('');
    setForm(createEmptyForm(initial.payBasis, today));
  }, [open, rates, today]);

  function chooseKind(nextKind) {
    setKindKey(nextKind.key);
    setServiceId('');
    setForm((current) => ({ ...current, basis: nextKind.payBasis }));
  }

  const card = isLessonKind
    ? { serviceId, payBasis: 'lesson_hourly' }
    : { serviceId: null, payBasis: kind.payBasis };
  const history = useMemo(
    () => ((isLessonKind && !serviceId) ? [] : rowsForCard(rates, card)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rates, isLessonKind, serviceId, kind.payBasis],
  );
  const current = history.find((row) => row.effective_date <= today) || null;
  const existingOnDate = history.find((row) => row.effective_date === form.effectiveDate) || null;
  const ready = isLessonKind ? Boolean(serviceId) : true;
  const warnings = ready
    ? buildWarnings({ history, current, existingOnDate, effectiveDate: form.effectiveDate, today, isLesson: isLessonKind })
    : [];

  async function handleSave() {
    const saved = await onSave({
      payBasis: isLessonKind ? form.basis : kind.payBasis,
      serviceId: isLessonKind ? serviceId : null,
      rate: toAgorot(form.amount),
      effectiveDate: form.effectiveDate,
      notes: form.notes || null,
      replaceExisting: Boolean(existingOnDate),
    });
    if (saved) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>הוספת תעריף</DialogTitle>
          <DialogDescription>כל תעריף חל מהתאריך שנבחר ועד לשינוי הבא.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            {RATE_KINDS.map((item) => {
              const Icon = item.icon;
              const selected = item.key === kind.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => chooseKind(item)}
                  disabled={saving}
                  aria-pressed={selected}
                  className={`flex items-start gap-2 rounded-2xl border p-3 text-start transition ${
                    selected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? 'text-primary' : 'text-slate-400'}`} />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold text-slate-900">{item.title}</span>
                      {hasRateOfKind(item, rates) ? (
                        <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">בשימוש</span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">{item.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {isLessonKind ? (
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">שירות</Label>
              <Select value={serviceId} onValueChange={setServiceId} disabled={saving}>
                <SelectTrigger><SelectValue placeholder="בחירת שירות" /></SelectTrigger>
                <SelectContent>
                  {services.map((service) => (
                    <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {current ? (
            <p className="text-xs text-slate-500">כרגע: {describeRate(current)} ({effectiveFromLabel(current)}).</p>
          ) : null}

          <RateFields
            idPrefix="add-rate"
            form={form}
            setForm={setForm}
            allowBasisChoice={isLessonKind}
            unitBasis={isLessonKind ? form.basis : kind.payBasis}
            warnings={warnings}
            saving={saving}
          />

        </div>

        <DialogFooter className="gap-2 sm:justify-start">
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || !ready || form.amount === '' || !form.effectiveDate}
          >
            {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
            שמירת תעריף
          </Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>ביטול</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Pay rates of one employee: what they earn per service, and from when (RateHistory).
 * Rates are never edited in place; saving adds a rate that applies from the date you choose.
 */
export default function EmployeeRatesPanel({ employee, orgId, session, services = [], onEmployeeChanged }) {
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addRateOpen, setAddRateOpen] = useState(false);
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

  const groups = useMemo(() => {
    const capabilities = employee?.service_capabilities || [];
    const capabilityServiceIds = capabilities.map((capability) => capability.service_id).filter(Boolean);
    const ratedServiceIds = rates.map((row) => row.service_id).filter(Boolean);
    const serviceIds = [];
    [...capabilityServiceIds, ...ratedServiceIds].forEach((serviceId) => {
      if (serviceId && !serviceIds.includes(serviceId)) serviceIds.push(serviceId);
    });

    const lessonCards = serviceIds.map((serviceId) => ({
      key: `service-${serviceId}`,
      title: services.find((service) => service.id === serviceId)?.name || 'שירות',
      payBasis: 'lesson_hourly',
      serviceId,
      unassigned: !capabilities.some((capability) => capability.service_id === serviceId),
    }));

    const otherCards = RATE_KINDS.slice(1)
      .filter((kind) => (
        hasRateOfKind(kind, rates)
      ))
      // leave_day rows are never listed here: leave pay lives with the leave settings
      .map((kind) => ({
        key: kind.key,
        title: kind.title,
        hint: kind.hint,
        payBasis: kind.payBasis,
        serviceId: null,
      }));

    return [
      { key: 'lesson', title: 'לפי מפגש', hint: 'תעריף לכל שירות', cards: lessonCards },
      { key: 'employee', title: 'שכר עבודה', hint: 'שעות או משכורת', cards: otherCards },
    ].filter((group) => group.cards.length > 0);
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
      await onEmployeeChanged?.();
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
        <div className="flex items-center gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
          <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setAddRateOpen(true)} disabled={saving}>
            <Plus className="h-3.5 w-3.5" />
            הוספת תעריף
          </Button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
          עדיין לא הוגדרו תעריפים.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.key} className="space-y-2">
              <div className="flex items-baseline gap-2 px-1">
                <h4 className="text-xs font-bold text-slate-700">{group.title}</h4>
                <span className="text-[11px] text-slate-400">{group.hint}</span>
              </div>
              <div className="grid gap-3">
                {group.cards.map((card) => (
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
            </div>
          ))}
        </div>
      )}

      <AddRateDialog
        open={addRateOpen}
        onOpenChange={setAddRateOpen}
        services={services}
        rates={rates}
        today={today}
        saving={saving}
        onSave={handleSave}
      />
    </section>
  );
}
