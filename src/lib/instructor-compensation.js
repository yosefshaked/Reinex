import { coerceAgorot, formatCurrency, toAgorot, toShekel } from '@/lib/currency.js';

export const COMPENSATION_INPUT_MODES = Object.freeze({
  hourly: 'hourly',
  durationBased: 'duration_based',
});

export const SERVICE_PAYMENT_MODELS = Object.freeze({
  fixedRate: 'fixed_rate',
  perStudent: 'per_student',
});

function normalizeCompensationMode(value) {
  return value === COMPENSATION_INPUT_MODES.durationBased
    ? COMPENSATION_INPUT_MODES.durationBased
    : COMPENSATION_INPUT_MODES.hourly;
}

function normalizeServicePaymentModel(value) {
  return value === SERVICE_PAYMENT_MODELS.perStudent
    ? SERVICE_PAYMENT_MODELS.perStudent
    : SERVICE_PAYMENT_MODELS.fixedRate;
}

function normalizeCompensationInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const mode = normalizeCompensationMode(raw.mode);
  const amountAgorot = coerceAgorot(raw.amount_agorot);
  const rawDuration = raw.duration_minutes;
  const durationMinutes = Number.isFinite(Number(rawDuration)) ? Math.max(0, Math.round(Number(rawDuration))) : null;

  if (mode === COMPENSATION_INPUT_MODES.durationBased && (!durationMinutes || durationMinutes <= 0)) {
    return null;
  }

  return {
    mode,
    amountAgorot,
    durationMinutes: mode === COMPENSATION_INPUT_MODES.durationBased ? durationMinutes : null,
  };
}

function formatShekelInput(agorot) {
  if (agorot == null) return '';
  return String(toShekel(coerceAgorot(agorot)));
}

function buildDurationState(durationMinutes) {
  const safeDuration = Math.max(0, Math.round(Number(durationMinutes) || 0));
  const totalHours = Math.floor(safeDuration / 60);
  const minutes = safeDuration % 60;
  const useCustom = totalHours > 24 || minutes % 5 !== 0;

  return {
    defaultHours: String(Math.min(24, totalHours)),
    defaultMinutes: String(Math.min(55, minutes - (minutes % 5))).padStart(2, '0'),
    customHours: String(totalHours),
    customMinutes: String(minutes).padStart(2, '0'),
    customEnabled: useCustom,
  };
}

export function hydrateCapabilityCompensationForm(capability = {}) {
  const compensationInput = normalizeCompensationInput(capability?.metadata?.compensation_input);
  const mode = compensationInput?.mode || COMPENSATION_INPUT_MODES.hourly;
  const amountAgorot = compensationInput?.amountAgorot ?? coerceAgorot(capability?.base_rate);
  const durationMinutes = compensationInput?.durationMinutes ?? 60;
  const durationState = buildDurationState(durationMinutes);

  return {
    mode,
    amountInput: formatShekelInput(amountAgorot),
    defaultDurationHours: durationState.defaultHours,
    defaultDurationMinutes: durationState.defaultMinutes,
    customDurationHours: durationState.customHours,
    customDurationMinutes: durationState.customMinutes,
    customDurationEnabled: durationState.customEnabled,
  };
}

export function resolveCompensationDurationMinutes(payConfig = {}) {
  const mode = normalizeCompensationMode(payConfig?.mode);
  if (mode !== COMPENSATION_INPUT_MODES.durationBased) {
    return null;
  }

  if (payConfig?.customDurationEnabled) {
    const hours = Math.max(0, Math.round(Number(payConfig?.customDurationHours) || 0));
    const minutes = Math.max(0, Math.min(59, Math.round(Number(payConfig?.customDurationMinutes) || 0)));
    return (hours * 60) + minutes;
  }

  const hours = Math.max(0, Math.min(24, Math.round(Number(payConfig?.defaultDurationHours) || 0)));
  const minutes = Math.max(0, Math.min(55, Math.round(Number(payConfig?.defaultDurationMinutes) || 0)));
  return (hours * 60) + minutes;
}

export function resolveCapabilityEffectiveHourlyRate(capability = {}) {
  const payConfig = capability?.pay_config || hydrateCapabilityCompensationForm(capability);
  const amountAgorot = payConfig?.amountInput === '' ? 0 : toAgorot(payConfig.amountInput);
  const mode = normalizeCompensationMode(payConfig?.mode);
  if (mode === COMPENSATION_INPUT_MODES.hourly) {
    return coerceAgorot(amountAgorot);
  }

  const durationMinutes = resolveCompensationDurationMinutes(payConfig);
  if (!durationMinutes || durationMinutes <= 0) {
    return 0;
  }

  return Math.round(coerceAgorot(amountAgorot) * 60 / durationMinutes);
}

export function serializeCapabilityCompensation(capability = {}) {
  const payConfig = capability?.pay_config || hydrateCapabilityCompensationForm(capability);
  const mode = normalizeCompensationMode(payConfig?.mode);
  const amountAgorot = payConfig?.amountInput === '' ? 0 : toAgorot(payConfig.amountInput);
  const durationMinutes = mode === COMPENSATION_INPUT_MODES.durationBased
    ? resolveCompensationDurationMinutes(payConfig)
    : null;

  return {
    base_rate: mode === COMPENSATION_INPUT_MODES.durationBased && durationMinutes > 0
      ? Math.round(coerceAgorot(amountAgorot) * 60 / durationMinutes)
      : coerceAgorot(amountAgorot),
    metadata: {
      ...(capability?.metadata && typeof capability.metadata === 'object' && !Array.isArray(capability.metadata)
        ? capability.metadata
        : {}),
      compensation_input: {
        mode,
        amount_agorot: coerceAgorot(amountAgorot),
        duration_minutes: mode === COMPENSATION_INPUT_MODES.durationBased ? durationMinutes : null,
      },
    },
  };
}

export function formatCompensationDurationLong(durationMinutes) {
  const safeDuration = Math.max(0, Math.round(Number(durationMinutes) || 0));
  const hours = Math.floor(safeDuration / 60);
  const minutes = safeDuration % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours} ${hours === 1 ? 'שעה' : 'שעות'} ו-${minutes} דקות`;
  }
  if (hours > 0) {
    return `${hours} ${hours === 1 ? 'שעה' : 'שעות'}`;
  }
  return `${minutes} דקות`;
}

export function formatCompensationDurationCompact(durationMinutes) {
  const safeDuration = Math.max(0, Math.round(Number(durationMinutes) || 0));
  const hours = Math.floor(safeDuration / 60);
  const minutes = safeDuration % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours} ש׳ ${minutes} דק׳`;
  }
  if (hours > 0) {
    return `${hours} ש׳`;
  }
  return `${minutes} דק׳`;
}

export function getServiceCompensationHint(paymentModel) {
  const normalizedModel = normalizeServicePaymentModel(paymentModel);
  return normalizedModel === SERVICE_PAYMENT_MODELS.perStudent
    ? 'השכר יחושב לפי משך המפגש ולפי מספר המשתתפים המזכים'
    : 'השכר יחושב פעם אחת עבור המפגש';
}

export function getServiceCompensationBasisLabel(paymentModel) {
  const normalizedModel = normalizeServicePaymentModel(paymentModel);
  return normalizedModel === SERVICE_PAYMENT_MODELS.perStudent ? 'למשתתף' : 'למפגש';
}

export function buildCapabilityCompensationSummary(capability = {}, service = null) {
  const compensationInput = normalizeCompensationInput(capability?.metadata?.compensation_input);
  const mode = compensationInput?.mode || COMPENSATION_INPUT_MODES.hourly;
  const amountAgorot = compensationInput?.amountAgorot ?? coerceAgorot(capability?.base_rate);
  const durationMinutes = compensationInput?.durationMinutes ?? null;

  return {
    valueLabel: mode === COMPENSATION_INPUT_MODES.durationBased && durationMinutes
      ? `${formatCurrency(amountAgorot)} / ${formatCompensationDurationCompact(durationMinutes)}`
      : `${formatCurrency(amountAgorot)} / שעה`,
    basisLabel: getServiceCompensationBasisLabel(service?.payment_model),
  };
}
