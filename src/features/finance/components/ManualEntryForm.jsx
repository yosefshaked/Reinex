import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import CurrencyInput from '@/components/ui/CurrencyInput.jsx';
import { coerceAgorot, formatCurrency, isValidCurrencyInput } from '@/lib/currency.js';

function buildEntryForm() {
  return {
    mode: 'payment',
    amount: '',
    effectiveAt: new Date().toISOString().slice(0, 10),
    notes: '',
    externalReference: '',
    calculatorServiceId: '',
    calculatorLessonCount: '1',
  };
}

function buildInitialErrors() {
  return {
    amount: '',
    notes: '',
    calculator: '',
  };
}

function getServiceName(services, serviceId) {
  return services.find((service) => service.id === serviceId)?.service_name
    || services.find((service) => service.id === serviceId)?.name
    || 'שירות';
}

export default function ManualEntryForm({
  open = false,
  resetVersion = 0,
  saving = false,
  availableServices = [],
  showCreditCalculator = false,
  onSubmit,
  onCancel,
}) {
  const [form, setForm] = useState(() => buildEntryForm());
  const [errors, setErrors] = useState(() => buildInitialErrors());

  useEffect(() => {
    if (open) {
      setForm(buildEntryForm());
      setErrors(buildInitialErrors());
    }
  }, [open]);

  useEffect(() => {
    setForm(buildEntryForm());
    setErrors(buildInitialErrors());
  }, [resetVersion]);

  const calculatorServices = useMemo(() => (
    Array.isArray(availableServices)
      ? availableServices
        .filter((service) => service?.is_active !== false)
        .filter((service) => Number.isFinite(Number(service?.default_customer_charge_amount)))
        .sort((left, right) => getServiceName(availableServices, left?.id).localeCompare(getServiceName(availableServices, right?.id), 'he'))
      : []
  ), [availableServices]);

  const selectedCalculatorService = useMemo(
    () => calculatorServices.find((service) => service.id === form.calculatorServiceId) || null,
    [calculatorServices, form.calculatorServiceId],
  );

  const calculatorLessonCount = useMemo(() => {
    const parsed = Number.parseInt(form.calculatorLessonCount, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [form.calculatorLessonCount]);

  const calculatorAmountAgorot = useMemo(() => {
    const serviceRate = Number.isFinite(Number(selectedCalculatorService?.default_customer_charge_amount))
      ? coerceAgorot(selectedCalculatorService.default_customer_charge_amount)
      : null;
    if (!serviceRate || !calculatorLessonCount) {
      return 0;
    }
    return serviceRate * calculatorLessonCount;
  }, [calculatorLessonCount, selectedCalculatorService]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: '' }));
    }
  }

  function validate() {
    const nextErrors = buildInitialErrors();

    if (!isValidCurrencyInput(form.amount)) {
      nextErrors.amount = 'יש להזין סכום חוקי וחיובי.';
    }

    if (form.mode === 'adjustment' && !form.notes.trim()) {
      nextErrors.notes = 'יש להוסיף הערה לתנועת חיוב ידני.';
    }

    setErrors(nextErrors);
    return !nextErrors.amount && !nextErrors.notes;
  }

  function handleApplyCalculatorAmount() {
    if (!selectedCalculatorService || !calculatorLessonCount || !calculatorAmountAgorot) {
      setErrors((current) => ({
        ...current,
        calculator: 'יש לבחור שירות וכמות שיעורים חוקית.',
      }));
      return;
    }

    const serviceLabel = getServiceName(availableServices, selectedCalculatorService.id);
    const suggestedNote = `זיכוי ידני לפי ${calculatorLessonCount} שיעורים של ${serviceLabel}`;

    setErrors((current) => ({ ...current, calculator: '', amount: '' }));
    setForm((current) => ({
      ...current,
      amount: (calculatorAmountAgorot / 100).toFixed(2),
      notes: current.notes.trim() ? current.notes : suggestedNote,
    }));
  }

  function handleSubmit() {
    if (!validate()) return;
    onSubmit?.({ ...form });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto pe-1">
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label>סוג תנועה</Label>
            <Select value={form.mode} onValueChange={(value) => updateField('mode', value)} disabled={saving}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="payment">תשלום ידני</SelectItem>
                <SelectItem value="adjustment">התאמה ידנית</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>סכום</Label>
            <CurrencyInput
              value={form.amount}
              onChange={(value) => updateField('amount', value)}
              disabled={saving}
            />
            {errors.amount ? (
              <p className="text-xs text-red-600">{errors.amount}</p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>תאריך</Label>
              <Input
                type="date"
                value={form.effectiveAt}
                onChange={(event) => updateField('effectiveAt', event.target.value)}
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label>אסמכתא</Label>
              <Input
                value={form.externalReference}
                onChange={(event) => updateField('externalReference', event.target.value)}
                disabled={saving}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>
              הערות
              {form.mode === 'adjustment' ? <span className="ms-1 text-red-600">*</span> : null}
            </Label>
            <Input
              value={form.notes}
              onChange={(event) => updateField('notes', event.target.value)}
              placeholder={form.mode === 'adjustment' ? 'חובה לציין סיבה לחיוב ידני' : ''}
              disabled={saving}
            />
            {errors.notes ? (
              <p className="text-xs text-red-600">{errors.notes}</p>
            ) : form.mode === 'adjustment' ? (
              <p className="text-xs text-slate-500">הסבר לחיוב חובה, כי הלדר הוא מסמך קבוע.</p>
            ) : null}
          </div>
        </div>

        {showCreditCalculator && form.mode === 'payment' ? (
          <section className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4">
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-indigo-950">מחשבון זיכוי מהיר לפי שיעורים</h4>
              <p className="text-xs text-indigo-800">
                בחרו שירות וכמות שיעורים. המערכת תחשב את הזיכוי לפי מחיר השירות ותעביר אותו לשדה הסכום.
              </p>
            </div>

            <div className="mt-4 grid gap-4">
              <div className="space-y-2">
                <Label>שירות לחישוב</Label>
                <Select
                  value={form.calculatorServiceId}
                  onValueChange={(value) => {
                    setErrors((current) => ({ ...current, calculator: '' }));
                    updateField('calculatorServiceId', value);
                  }}
                  disabled={saving}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="בחירת שירות" />
                  </SelectTrigger>
                  <SelectContent>
                    {calculatorServices.map((service) => (
                      <SelectItem key={service.id} value={service.id}>
                        {getServiceName(availableServices, service.id)} • {formatCurrency(service.default_customer_charge_amount)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>כמות שיעורים</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    value={form.calculatorLessonCount}
                    onChange={(event) => {
                      setErrors((current) => ({ ...current, calculator: '' }));
                      updateField('calculatorLessonCount', event.target.value);
                    }}
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label>זיכוי מחושב</Label>
                  <div className="flex h-10 items-center rounded-md border border-indigo-200 bg-white px-3 text-sm font-semibold text-indigo-950">
                    {calculatorAmountAgorot > 0 ? formatCurrency(calculatorAmountAgorot) : '—'}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-indigo-100 bg-white/80 p-3">
                <div className="text-xs text-indigo-900">
                  {selectedCalculatorService ? (
                    <>מחיר שירות: {formatCurrency(selectedCalculatorService.default_customer_charge_amount)} לכל שיעור</>
                  ) : 'יש לבחור שירות פעיל עם מחיר מוגדר.'}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-indigo-800">החישוב הוא עזר בלבד. בפועל נשמרת תנועת זיכוי רגילה בלדר.</p>
                <Button
                  type="button"
                  variant="outline"
                  className="border-indigo-300 bg-white text-indigo-950 hover:bg-indigo-100"
                  onClick={handleApplyCalculatorAmount}
                  disabled={!selectedCalculatorService || calculatorLessonCount <= 0 || saving}
                >
                  העבר לסכום
                </Button>
              </div>

              {errors.calculator ? (
                <p className="text-xs text-red-600">{errors.calculator}</p>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      <div className="mt-5 flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-start">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          ביטול
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={saving}>
          {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
          שמור תנועה
        </Button>
      </div>
    </div>
  );
}
