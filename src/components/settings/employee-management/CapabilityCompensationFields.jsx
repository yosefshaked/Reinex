import React from 'react';
import { Button } from '@/components/ui/button';
import CurrencyInput from '@/components/ui/CurrencyInput.jsx';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils.js';
import {
  COMPENSATION_INPUT_MODES,
  formatCompensationDurationLong,
  getServiceCompensationHint,
  resolveCapabilityEffectiveHourlyRate,
  resolveCompensationDurationMinutes,
} from '@/lib/instructor-compensation.js';
import { formatCurrency } from '@/lib/currency.js';

const DEFAULT_HOUR_OPTIONS = Array.from({ length: 25 }, (_, index) => String(index));
const DEFAULT_MINUTE_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, '0'));

function ToggleButton({ active, onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-xl border px-3 py-2 text-sm font-medium transition',
        active
          ? 'border-blue-600 bg-blue-600 text-white'
          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
        disabled ? 'cursor-not-allowed opacity-60' : '',
      )}
    >
      {children}
    </button>
  );
}

export default function CapabilityCompensationFields({
  capability,
  service = null,
  disabled = false,
  onChange,
}) {
  const payConfig = capability?.pay_config || {};
  const durationMinutes = resolveCompensationDurationMinutes(payConfig);
  const effectiveHourlyRate = resolveCapabilityEffectiveHourlyRate(capability);

  const updatePayConfig = (patch) => {
    onChange?.({
      ...payConfig,
      ...patch,
    });
  };

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
      <div className="space-y-1">
        <Label className="text-xs text-slate-600">אופן הגדרת שכר</Label>
        <div className="grid gap-2 md:grid-cols-2">
          <ToggleButton
            active={payConfig.mode === COMPENSATION_INPUT_MODES.hourly}
            onClick={() => updatePayConfig({ mode: COMPENSATION_INPUT_MODES.hourly })}
            disabled={disabled}
          >
            לשעה
          </ToggleButton>
          <ToggleButton
            active={payConfig.mode === COMPENSATION_INPUT_MODES.durationBased}
            onClick={() => updatePayConfig({ mode: COMPENSATION_INPUT_MODES.durationBased })}
            disabled={disabled}
          >
            סכום עבור משך
          </ToggleButton>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-slate-600">סכום</Label>
        <CurrencyInput
          value={payConfig.amountInput || ''}
          onChange={(value) => updatePayConfig({ amountInput: value })}
          disabled={disabled}
          allowZero
        />
      </div>

      {payConfig.mode === COMPENSATION_INPUT_MODES.durationBased ? (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-slate-700">משך ייחוס</div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => updatePayConfig({ customDurationEnabled: !payConfig.customDurationEnabled })}
              disabled={disabled}
            >
              {payConfig.customDurationEnabled ? 'חזור לבחירה רגילה' : 'משך מותאם'}
            </Button>
          </div>

          {payConfig.customDurationEnabled ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">שעות</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={payConfig.customDurationHours || ''}
                  onChange={(event) => updatePayConfig({ customDurationHours: event.target.value })}
                  disabled={disabled}
                  dir="ltr"
                  className="text-end"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">דקות</Label>
                <Input
                  type="number"
                  min="0"
                  max="59"
                  step="1"
                  value={payConfig.customDurationMinutes || ''}
                  onChange={(event) => updatePayConfig({ customDurationMinutes: event.target.value })}
                  disabled={disabled}
                  dir="ltr"
                  className="text-end"
                />
              </div>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">שעות</Label>
                <Select
                  value={String(payConfig.defaultDurationHours || '0')}
                  onValueChange={(value) => updatePayConfig({ defaultDurationHours: value })}
                  disabled={disabled}
                >
                  <SelectTrigger className="text-end">
                    <SelectValue placeholder="בחר שעות" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEFAULT_HOUR_OPTIONS.map((hours) => (
                      <SelectItem key={hours} value={hours}>
                        {hours}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">דקות</Label>
                <Select
                  value={String(payConfig.defaultDurationMinutes || '00').padStart(2, '0')}
                  onValueChange={(value) => updatePayConfig({ defaultDurationMinutes: value })}
                  disabled={disabled}
                >
                  <SelectTrigger className="text-end">
                    <SelectValue placeholder="בחר דקות" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEFAULT_MINUTE_OPTIONS.map((minutes) => (
                      <SelectItem key={minutes} value={minutes}>
                        {minutes}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            {durationMinutes > 0 ? `משך נבחר: ${formatCompensationDurationLong(durationMinutes)}` : 'יש לבחור משך גדול מאפס.'}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-600">
          יחושב לפי משך המפגש בפועל
        </div>
      )}

      <div className="space-y-1 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-xs text-blue-900">
        <div>תעריף אפקטיבי לשעה: {formatCurrency(effectiveHourlyRate)}</div>
        {service?.id ? (
          <div className="text-blue-800/80">{getServiceCompensationHint(service?.payment_model)}</div>
        ) : null}
      </div>
    </div>
  );
}
