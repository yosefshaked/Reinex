/* eslint-env node */
import { normalizeString } from './org-bff.js';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function coerceNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function roundCurrency(value) {
  return Number(Number(value || 0).toFixed(2));
}

function normalizeId(value) {
  return normalizeString(value);
}

function normalizeMetadata(metadata) {
  return isPlainObject(metadata) ? metadata : {};
}

function createPackageLine(rawLine, index) {
  const serviceId = normalizeId(rawLine?.service_id);
  const lessonsCount = Math.max(0, Math.round(coerceNumber(rawLine?.lessons_count, 0)));
  const chargeAmount = roundCurrency(coerceNumber(rawLine?.charge_amount, 0));
  if (!serviceId || lessonsCount <= 0 || chargeAmount < 0) {
    return null;
  }

  return {
    key: normalizeId(rawLine?.key) || `${serviceId}:${index}`,
    service_id: serviceId,
    lessons_count: lessonsCount,
    charge_amount: chargeAmount,
  };
}

export function normalizeCommitmentBehavior(commitment) {
  const metadata = normalizeMetadata(commitment?.metadata);
  const commitmentType = normalizeString(commitment?.commitment_type).toLowerCase();

  if (commitmentType === 'package') {
    const packageLines = Array.isArray(metadata.package_items)
      ? metadata.package_items.map(createPackageLine).filter(Boolean)
      : [];

    return {
      type: 'package',
      package_items: packageLines,
      subscription: null,
      hmo: null,
      manual_credit: null,
    };
  }

  if (commitmentType === 'subscription') {
    const lessonsCount = Math.max(0, Math.round(coerceNumber(metadata?.subscription?.lessons_count, 0)));
    const chargeAmount = Number.isFinite(Number(metadata?.subscription?.charge_amount))
      ? roundCurrency(Number(metadata.subscription.charge_amount))
      : (Number.isFinite(Number(commitment?.default_charge_amount)) ? roundCurrency(Number(commitment.default_charge_amount)) : 0);

    return {
      type: 'subscription',
      package_items: [],
      subscription: {
        lessons_count: lessonsCount,
        charge_amount: chargeAmount,
      },
      hmo: null,
      manual_credit: null,
    };
  }

  if (commitmentType === 'hmo') {
    const paymentMode = normalizeString(metadata?.hmo?.payment_mode).toLowerCase() || 'partially_paid_by_hmo';
    const authorizedLessons = Math.max(0, Math.round(coerceNumber(metadata?.hmo?.authorized_lessons, 0)));
    const customerChargeAmount = Number.isFinite(Number(metadata?.hmo?.customer_charge_amount))
      ? roundCurrency(Number(metadata.hmo.customer_charge_amount))
      : (Number.isFinite(Number(commitment?.default_charge_amount)) ? roundCurrency(Number(commitment.default_charge_amount)) : 0);
    const insurerClaimAmount = Number.isFinite(Number(metadata?.hmo?.insurer_claim_amount))
      ? roundCurrency(Number(metadata.hmo.insurer_claim_amount))
      : 0;

    return {
      type: 'hmo',
      package_items: [],
      subscription: null,
      hmo: {
        suggestion_id: normalizeString(metadata?.hmo?.suggestion_id) || 'custom',
        provider_name: normalizeString(metadata?.hmo?.provider_name) || 'גורם מממן',
        payment_mode: paymentMode,
        customer_charge_amount: customerChargeAmount,
        insurer_claim_amount: insurerClaimAmount,
        authorization_reference: normalizeString(metadata?.hmo?.authorization_reference) || '',
        authorized_lessons: authorizedLessons,
        reminder_date: normalizeString(metadata?.hmo?.reminder_date) || '',
        workflow_notes: normalizeString(metadata?.hmo?.workflow_notes) || '',
      },
      manual_credit: null,
    };
  }

  return {
    type: 'manual_credit',
    package_items: [],
    subscription: null,
    hmo: null,
    manual_credit: {},
  };
}

function groupLessonUsage(entries = []) {
  const usageByService = new Map();
  let consumedAmount = 0;
  let consumedLessons = 0;

  for (const entry of entries) {
    consumedAmount += coerceNumber(entry?.amount_charged, 0);
    if (normalizeString(entry?.source_type).toLowerCase() !== 'lesson') {
      continue;
    }
    consumedLessons += 1;
    const metadata = normalizeMetadata(entry?.metadata);
    const serviceId = normalizeId(
      metadata.covered_service_id
      || metadata.package_item_service_id
      || metadata.lesson_service_id,
    );
    if (!serviceId) {
      continue;
    }
    usageByService.set(serviceId, (usageByService.get(serviceId) || 0) + 1);
  }

  return {
    consumed_amount: roundCurrency(consumedAmount),
    consumed_lessons: consumedLessons,
    usage_by_service: usageByService,
  };
}

export function buildCommitmentRuntime(commitment, entries = []) {
  const behavior = normalizeCommitmentBehavior(commitment);
  const usage = groupLessonUsage(entries);
  const totalAmount = roundCurrency(coerceNumber(commitment?.total_amount, 0));
  const defaultChargeAmount = Number.isFinite(Number(commitment?.default_charge_amount))
    ? roundCurrency(Number(commitment.default_charge_amount))
    : null;

  if (behavior.type === 'package') {
    const packageItems = behavior.package_items.map((line) => {
      const consumedLessons = usage.usage_by_service.get(line.service_id) || 0;
      const remainingLessons = Math.max(0, line.lessons_count - consumedLessons);
      return {
        ...line,
        consumed_lessons: consumedLessons,
        remaining_lessons: remainingLessons,
        total_amount: roundCurrency(line.lessons_count * line.charge_amount),
        consumed_amount: roundCurrency(consumedLessons * line.charge_amount),
        remaining_amount: roundCurrency(remainingLessons * line.charge_amount),
      };
    });

    return {
      type: behavior.type,
      default_charge_amount: defaultChargeAmount,
      package_items: packageItems,
      subscription: null,
      hmo: null,
      remaining_lessons: packageItems.reduce((sum, item) => sum + item.remaining_lessons, 0),
      consumed_lessons: usage.consumed_lessons,
      total_authorized_lessons: packageItems.reduce((sum, item) => sum + item.lessons_count, 0),
      consumed_amount: usage.consumed_amount,
      remaining_amount: roundCurrency(totalAmount - usage.consumed_amount),
      reminder: null,
    };
  }

  if (behavior.type === 'subscription') {
    const totalLessons = Math.max(0, behavior.subscription?.lessons_count || 0);
    const consumedLessons = usage.consumed_lessons;
    const remainingLessons = Math.max(0, totalLessons - consumedLessons);
    return {
      type: behavior.type,
      default_charge_amount: behavior.subscription?.charge_amount ?? defaultChargeAmount,
      package_items: [],
      subscription: {
        ...behavior.subscription,
        consumed_lessons: consumedLessons,
        remaining_lessons: remainingLessons,
      },
      hmo: null,
      remaining_lessons: remainingLessons,
      consumed_lessons: consumedLessons,
      total_authorized_lessons: totalLessons,
      consumed_amount: usage.consumed_amount,
      remaining_amount: roundCurrency(totalAmount - usage.consumed_amount),
      reminder: null,
    };
  }

  if (behavior.type === 'hmo') {
    const totalLessons = Math.max(0, behavior.hmo?.authorized_lessons || 0);
    const consumedLessons = usage.consumed_lessons;
    const remainingLessons = Math.max(0, totalLessons - consumedLessons);
    const pendingClaimAmount = roundCurrency(consumedLessons * coerceNumber(behavior.hmo?.insurer_claim_amount, 0));

    return {
      type: behavior.type,
      default_charge_amount: behavior.hmo?.customer_charge_amount ?? defaultChargeAmount,
      package_items: [],
      subscription: null,
      hmo: {
        ...behavior.hmo,
        consumed_lessons: consumedLessons,
        remaining_lessons: remainingLessons,
        pending_claim_amount: pendingClaimAmount,
      },
      remaining_lessons: remainingLessons,
      consumed_lessons: consumedLessons,
      total_authorized_lessons: totalLessons,
      consumed_amount: usage.consumed_amount,
      remaining_amount: roundCurrency(totalAmount - usage.consumed_amount),
      reminder: {
        type: 'hmo_follow_up',
        provider_name: behavior.hmo?.provider_name || 'גורם מממן',
        pending_claim_amount: pendingClaimAmount,
        reminder_date: behavior.hmo?.reminder_date || '',
      },
    };
  }

  return {
    type: behavior.type,
    default_charge_amount: defaultChargeAmount,
    package_items: [],
    subscription: null,
    hmo: null,
    remaining_lessons: null,
    consumed_lessons: usage.consumed_lessons,
    total_authorized_lessons: null,
    consumed_amount: usage.consumed_amount,
    remaining_amount: roundCurrency(totalAmount - usage.consumed_amount),
    reminder: null,
  };
}

export function resolveCommitmentCoverage(commitment, serviceId, runtime = null) {
  const normalizedServiceId = normalizeId(serviceId);
  const resolvedRuntime = runtime || buildCommitmentRuntime(commitment, []);
  const type = resolvedRuntime.type;

  if (type === 'package') {
    const matchedLine = (resolvedRuntime.package_items || []).find((item) => item.service_id === normalizedServiceId);
    if (!matchedLine) {
      return { eligible: false, code: 'service_mismatch' };
    }
    if (matchedLine.remaining_lessons <= 0) {
      return { eligible: false, code: 'commitment_service_exhausted' };
    }
    return {
      eligible: true,
      covered_service_id: matchedLine.service_id,
      student_charge_amount: matchedLine.charge_amount,
      insurer_claim_amount: 0,
      metadata: {
        coverage_type: 'package_item',
        package_item_service_id: matchedLine.service_id,
      },
    };
  }

  if (type === 'subscription') {
    if (normalizeId(commitment?.service_id) !== normalizedServiceId) {
      return { eligible: false, code: 'service_mismatch' };
    }
    if ((resolvedRuntime.subscription?.remaining_lessons ?? 0) <= 0 && resolvedRuntime.subscription?.lessons_count > 0) {
      return { eligible: false, code: 'commitment_service_exhausted' };
    }
    return {
      eligible: true,
      covered_service_id: normalizedServiceId,
      student_charge_amount: roundCurrency(resolvedRuntime.subscription?.charge_amount ?? resolvedRuntime.default_charge_amount ?? 0),
      insurer_claim_amount: 0,
      metadata: {
        coverage_type: 'subscription',
      },
    };
  }

  if (type === 'hmo') {
    if (normalizeId(commitment?.service_id) !== normalizedServiceId) {
      return { eligible: false, code: 'service_mismatch' };
    }
    if ((resolvedRuntime.hmo?.remaining_lessons ?? 0) <= 0 && resolvedRuntime.hmo?.authorized_lessons > 0) {
      return { eligible: false, code: 'authorization_exhausted' };
    }

    const paymentMode = normalizeString(resolvedRuntime.hmo?.payment_mode).toLowerCase();
    const baseStudentCharge = roundCurrency(resolvedRuntime.hmo?.customer_charge_amount ?? resolvedRuntime.default_charge_amount ?? 0);
    const studentChargeAmount = paymentMode === 'fully_paid_by_hmo'
      ? 0
      : baseStudentCharge;

    return {
      eligible: true,
      covered_service_id: normalizedServiceId,
      student_charge_amount: studentChargeAmount,
      insurer_claim_amount: roundCurrency(resolvedRuntime.hmo?.insurer_claim_amount ?? 0),
      metadata: {
        coverage_type: 'hmo',
        hmo_provider_name: resolvedRuntime.hmo?.provider_name || 'גורם מממן',
        hmo_payment_mode: paymentMode,
        authorization_reference: resolvedRuntime.hmo?.authorization_reference || '',
      },
    };
  }

  if (normalizeId(commitment?.service_id) && normalizedServiceId && normalizeId(commitment.service_id) !== normalizedServiceId) {
    return { eligible: false, code: 'service_mismatch' };
  }

  return {
    eligible: true,
    covered_service_id: normalizedServiceId || normalizeId(commitment?.service_id),
    student_charge_amount: roundCurrency(resolvedRuntime.default_charge_amount ?? 0),
    insurer_claim_amount: 0,
    metadata: {
      coverage_type: 'manual_credit',
    },
  };
}

export function computeCommitmentAttention(commitment, runtime) {
  const expiryDate = commitment?.expires_at ? new Date(commitment.expires_at) : null;
  const now = new Date();
  const expired = expiryDate ? expiryDate.getTime() < now.getTime() : false;
  const expiringSoon = expiryDate
    ? Math.ceil((expiryDate.getTime() - now.getTime()) / 86400000) <= 30 && expiryDate.getTime() >= now.getTime()
    : false;
  const remainingLessons = runtime?.remaining_lessons;
  const lowBalance = Number.isFinite(Number(remainingLessons))
    ? Number(remainingLessons) < 2
    : roundCurrency(runtime?.remaining_amount ?? 0) > 0 && roundCurrency(runtime?.remaining_amount ?? 0) < roundCurrency((runtime?.default_charge_amount ?? 0) * 2);
  const exhausted = Number.isFinite(Number(remainingLessons))
    ? Number(remainingLessons) <= 0 && Number(runtime?.total_authorized_lessons ?? 0) > 0
    : roundCurrency(runtime?.remaining_amount ?? 0) <= 0 && roundCurrency(commitment?.total_amount ?? 0) > 0;

  return {
    expired,
    exhausted,
    low_balance: lowBalance,
    expiring_soon: expiringSoon,
    remaining_lessons: Number.isFinite(Number(remainingLessons)) ? Number(remainingLessons) : null,
  };
}
