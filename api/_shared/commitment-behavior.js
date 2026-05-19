// @ts-check
/* eslint-env node */
import { normalizeString } from './org-bff.js';
import { coerceAgorot, BILLING_THRESHOLDS } from './currency.js';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Coerce a non-money integer count (lessons, etc.) — not for currency values. */
function coerceCount(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizeId(value) {
  return normalizeString(value);
}

function normalizeMetadata(metadata) {
  return isPlainObject(metadata) ? metadata : {};
}

function createPackageLine(rawLine, index) {
  const serviceId = normalizeId(rawLine?.service_id);
  const lessonsCount = Math.max(0, Math.round(coerceCount(rawLine?.lessons_count, 0)));
  const chargeAmount = coerceAgorot(rawLine?.charge_amount);
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
    const lessonsCount = Math.max(0, Math.round(coerceCount(metadata?.subscription?.lessons_count, 0)));
    const chargeAmount = Number.isFinite(Number(metadata?.subscription?.charge_amount))
      ? coerceAgorot(metadata.subscription.charge_amount)
      : coerceAgorot(commitment?.default_charge_amount);

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
    const authorization = isPlainObject(commitment?.hmo_authorization) ? commitment.hmo_authorization : null;
    const providerTrack = isPlainObject(commitment?.hmo_provider_track)
      ? commitment.hmo_provider_track
      : isPlainObject(authorization?.provider_track)
        ? authorization.provider_track
        : null;
    const provider = isPlainObject(commitment?.hmo_provider)
      ? commitment.hmo_provider
      : isPlainObject(authorization?.provider)
        ? authorization.provider
        : null;
    const paymentMode = normalizeString(
      authorization?.resolved_payment_mode
      || authorization?.payment_mode_override
      || providerTrack?.payment_mode
      || metadata?.hmo?.payment_mode,
    ).toLowerCase() || 'partially_paid_by_hmo';
    const authorizedLessons = Math.max(0, Math.round(coerceCount(
      authorization?.authorized_lessons ?? metadata?.hmo?.authorized_lessons,
      0,
    )));
    const rawCustomerCharge =
      authorization?.resolved_customer_charge_amount
      ?? authorization?.customer_charge_amount_override
      ?? providerTrack?.default_customer_charge_amount
      ?? metadata?.hmo?.customer_charge_amount
      ?? commitment?.default_charge_amount;
    const customerChargeAmount = coerceAgorot(rawCustomerCharge);
    const rawInsurerClaim =
      authorization?.resolved_insurer_claim_amount
      ?? authorization?.insurer_claim_amount_override
      ?? providerTrack?.default_insurer_claim_amount
      ?? metadata?.hmo?.insurer_claim_amount;
    const insurerClaimAmount = coerceAgorot(rawInsurerClaim);
    const workflowNotes = normalizeString(
      authorization?.resolved_workflow_notes
      || authorization?.workflow_notes_override
      || providerTrack?.default_workflow_notes
      || metadata?.hmo?.workflow_notes,
    );

    return {
      type: 'hmo',
      package_items: [],
      subscription: null,
      hmo: {
        provider_id: provider?.id || commitment?.hmo_provider_id || null,
        provider_track_id: providerTrack?.id || commitment?.hmo_provider_track_id || null,
        authorization_id: authorization?.id || commitment?.hmo_authorization_id || null,
        suggestion_id: normalizeString(metadata?.hmo?.suggestion_id) || 'custom',
        provider_name: normalizeString(provider?.name || authorization?.provider?.name || metadata?.hmo?.provider_name) || 'גורם מממן',
        provider_track_name: normalizeString(providerTrack?.name) || '',
        payment_mode: paymentMode,
        customer_charge_amount: customerChargeAmount,
        insurer_claim_amount: insurerClaimAmount,
        authorization_reference: normalizeString(authorization?.authorization_reference || metadata?.hmo?.authorization_reference) || '',
        authorized_lessons: authorizedLessons,
        reminder_date: normalizeString(authorization?.reminder_date || metadata?.hmo?.reminder_date) || '',
        valid_from: normalizeString(authorization?.valid_from) || '',
        expires_at: normalizeString(authorization?.expires_at || commitment?.expires_at) || '',
        status: normalizeString(authorization?.status) || '',
        workflow_notes: workflowNotes || '',
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

const LESSON_USAGE_TYPES = new Set(['standard', 'double', 'cross_service']);
const COMMITMENT_LESSON_TYPES = new Set(['package', 'subscription']);

export function buildLessonCountBuckets({
  totalAuthorizedLessons = null,
  consumedLessons = 0,
  reservedLessons = 0,
} = {}) {
  const normalizedTotal = Number.isFinite(Number(totalAuthorizedLessons))
    ? Math.max(0, Math.round(Number(totalAuthorizedLessons)))
    : null;
  const normalizedConsumed = Math.max(0, Math.round(coerceCount(consumedLessons, 0)));
  const normalizedReserved = Math.max(0, Math.round(coerceCount(reservedLessons, 0)));
  const availableLessonsToBook = normalizedTotal == null
    ? null
    : Math.max(0, normalizedTotal - normalizedConsumed - normalizedReserved);

  return {
    total_authorized_lessons: normalizedTotal,
    consumed_lessons: normalizedConsumed,
    reserved_lessons: normalizedReserved,
    available_lessons_to_book: availableLessonsToBook,
    remaining_lessons: availableLessonsToBook,
  };
}

export function resolveEntitlementUsageDelta({
  entitlementType = '',
  participantStatus = '',
  isFutureLesson = false,
  isBillable = false,
  coverageStatus = '',
} = {}) {
  const normalizedEntitlementType = normalizeString(entitlementType).toLowerCase();
  const normalizedStatus = normalizeString(participantStatus).toLowerCase();
  const normalizedCoverageStatus = normalizeString(coverageStatus).toLowerCase();

  if (normalizedEntitlementType === 'hmo') {
    if (normalizedStatus === 'scheduled' && isFutureLesson) {
      return normalizedCoverageStatus === 'covered'
        ? { consumed_lessons: 0, reserved_lessons: 1 }
        : { consumed_lessons: 0, reserved_lessons: 0 };
    }
    if (normalizedStatus === 'attended' && normalizedCoverageStatus === 'covered') {
      return { consumed_lessons: 1, reserved_lessons: 0 };
    }
    return { consumed_lessons: 0, reserved_lessons: 0 };
  }

  if (COMMITMENT_LESSON_TYPES.has(normalizedEntitlementType)) {
    if (normalizedStatus === 'scheduled' && isFutureLesson) {
      return { consumed_lessons: 0, reserved_lessons: 1 };
    }
    if (normalizedStatus === 'attended') {
      return { consumed_lessons: 1, reserved_lessons: 0 };
    }
    if (normalizedStatus === 'no_show' && isBillable) {
      return { consumed_lessons: 1, reserved_lessons: 0 };
    }
    if (normalizedStatus === 'cancelled_student' && isBillable && !isFutureLesson) {
      return { consumed_lessons: 1, reserved_lessons: 0 };
    }
  }

  return { consumed_lessons: 0, reserved_lessons: 0 };
}

export function buildLiveCommitmentLessonCounts({
  commitment,
  lessons = [],
  billingConsumptionPolicy = {},
} = {}) {
  const behavior = normalizeCommitmentBehavior(commitment);
  const normalizedLessons = Array.isArray(lessons) ? lessons : [];

  if (behavior.type === 'package') {
    const packageItems = behavior.package_items.map((line) => {
      const lineLessons = normalizedLessons.filter((lesson) => normalizeId(lesson?.service_id) === line.service_id);
      const totals = lineLessons.reduce((accumulator, lesson) => {
        const participantStatus = normalizeString(lesson?.participant_status).toLowerCase();
        const delta = resolveEntitlementUsageDelta({
          entitlementType: 'package',
          participantStatus,
          isFutureLesson: Boolean(lesson?.is_future_lesson),
          isBillable: Boolean(billingConsumptionPolicy?.[participantStatus]),
          coverageStatus: normalizeString(lesson?.coverage_status).toLowerCase(),
        });
        accumulator.consumed_lessons += delta.consumed_lessons;
        accumulator.reserved_lessons += delta.reserved_lessons;
        return accumulator;
      }, { consumed_lessons: 0, reserved_lessons: 0 });

      return {
        service_id: line.service_id,
        ...buildLessonCountBuckets({
          totalAuthorizedLessons: line.lessons_count,
          consumedLessons: totals.consumed_lessons,
          reservedLessons: totals.reserved_lessons,
        }),
      };
    });

    return {
      package_items_by_service: Object.fromEntries(packageItems.map((item) => [item.service_id, item])),
      totals: buildLessonCountBuckets({
        totalAuthorizedLessons: packageItems.reduce((sum, item) => sum + Number(item.total_authorized_lessons || 0), 0),
        consumedLessons: packageItems.reduce((sum, item) => sum + Number(item.consumed_lessons || 0), 0),
        reservedLessons: packageItems.reduce((sum, item) => sum + Number(item.reserved_lessons || 0), 0),
      }),
    };
  }

  if (behavior.type === 'subscription') {
    const matchingLessons = normalizedLessons.filter((lesson) => (
      normalizeId(lesson?.service_id) === normalizeId(commitment?.service_id)
    ));
    const totals = matchingLessons.reduce((accumulator, lesson) => {
      const participantStatus = normalizeString(lesson?.participant_status).toLowerCase();
      const delta = resolveEntitlementUsageDelta({
        entitlementType: 'subscription',
        participantStatus,
        isFutureLesson: Boolean(lesson?.is_future_lesson),
        isBillable: Boolean(billingConsumptionPolicy?.[participantStatus]),
        coverageStatus: normalizeString(lesson?.coverage_status).toLowerCase(),
      });
      accumulator.consumed_lessons += delta.consumed_lessons;
      accumulator.reserved_lessons += delta.reserved_lessons;
      return accumulator;
    }, { consumed_lessons: 0, reserved_lessons: 0 });

    return buildLessonCountBuckets({
      totalAuthorizedLessons: behavior.subscription?.lessons_count ?? 0,
      consumedLessons: totals.consumed_lessons,
      reservedLessons: totals.reserved_lessons,
    });
  }

  if (behavior.type === 'hmo') {
    const matchingLessons = normalizedLessons.filter((lesson) => (
      normalizeId(lesson?.service_id) === normalizeId(commitment?.service_id)
    ));
    const totals = matchingLessons.reduce((accumulator, lesson) => {
      const delta = resolveEntitlementUsageDelta({
        entitlementType: 'hmo',
        participantStatus: normalizeString(lesson?.participant_status).toLowerCase(),
        isFutureLesson: Boolean(lesson?.is_future_lesson),
        isBillable: Boolean(billingConsumptionPolicy?.[normalizeString(lesson?.participant_status).toLowerCase()]),
        coverageStatus: normalizeString(lesson?.coverage_status).toLowerCase(),
      });
      accumulator.consumed_lessons += delta.consumed_lessons;
      accumulator.reserved_lessons += delta.reserved_lessons;
      return accumulator;
    }, { consumed_lessons: 0, reserved_lessons: 0 });

    return buildLessonCountBuckets({
      totalAuthorizedLessons: behavior.hmo?.authorized_lessons ?? 0,
      consumedLessons: totals.consumed_lessons,
      reservedLessons: totals.reserved_lessons,
    });
  }

  return buildLessonCountBuckets({
    totalAuthorizedLessons: null,
    consumedLessons: 0,
    reservedLessons: 0,
  });
}

function groupLessonUsage(entries = []) {
  const usageByService = new Map();
  let totalCredits = 0;
  let totalDebits = 0;
  let consumedLessons = 0;

  for (const entry of entries) {
    const txType = normalizeString(entry?.transaction_type).toUpperCase();
    const amount = coerceAgorot(entry?.amount ?? entry?.amount_charged);

    if (txType === 'CREDIT') {
      totalCredits += amount;
    } else {
      totalDebits += amount;
    }

    const usageType = normalizeString(entry?.usage_type).toLowerCase();
    const sourceType = normalizeString(entry?.source_type).toLowerCase();
    const isLesson = LESSON_USAGE_TYPES.has(usageType) || sourceType === 'lesson';
    if (!isLesson) {
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
    total_credits: Math.round(totalCredits),
    total_debits: Math.round(totalDebits),
    consumed_amount: Math.round(totalDebits),
    consumed_lessons: consumedLessons,
    usage_by_service: usageByService,
  };
}

export function buildCommitmentRuntime(commitment, entries = [], liveLessonCounts = null) {
  const behavior = normalizeCommitmentBehavior(commitment);
  const usage = groupLessonUsage(entries);
  const ledgerBalance = Math.round(usage.total_credits - usage.total_debits);
  const defaultChargeAmount = Number.isFinite(Number(commitment?.default_charge_amount))
    ? coerceAgorot(commitment.default_charge_amount)
    : null;

  if (behavior.type === 'package') {
    const packageItems = behavior.package_items.map((line) => {
      const liveLineCounts = liveLessonCounts?.package_items_by_service?.[line.service_id] || null;
      const lineBuckets = buildLessonCountBuckets({
        totalAuthorizedLessons: line.lessons_count,
        consumedLessons: liveLineCounts?.consumed_lessons ?? usage.usage_by_service.get(line.service_id) ?? 0,
        reservedLessons: liveLineCounts?.reserved_lessons ?? 0,
      });
      return {
        ...line,
        consumed_lessons: lineBuckets.consumed_lessons,
        reserved_lessons: lineBuckets.reserved_lessons,
        available_lessons_to_book: lineBuckets.available_lessons_to_book,
        remaining_lessons: lineBuckets.remaining_lessons,
        total_amount: line.lessons_count * coerceAgorot(line.charge_amount),
        consumed_amount: lineBuckets.consumed_lessons * coerceAgorot(line.charge_amount),
        remaining_amount: lineBuckets.remaining_lessons * coerceAgorot(line.charge_amount),
      };
    });
    const totals = buildLessonCountBuckets({
      totalAuthorizedLessons: packageItems.reduce((sum, item) => sum + item.lessons_count, 0),
      consumedLessons: packageItems.reduce((sum, item) => sum + item.consumed_lessons, 0),
      reservedLessons: packageItems.reduce((sum, item) => sum + item.reserved_lessons, 0),
    });

    return {
      type: behavior.type,
      default_charge_amount: defaultChargeAmount,
      package_items: packageItems,
      subscription: null,
      hmo: null,
      remaining_lessons: totals.remaining_lessons,
      consumed_lessons: totals.consumed_lessons,
      reserved_lessons: totals.reserved_lessons,
      available_lessons_to_book: totals.available_lessons_to_book,
      total_authorized_lessons: totals.total_authorized_lessons,
      consumed_amount: usage.consumed_amount,
      remaining_amount: ledgerBalance,
      reminder: null,
    };
  }

  if (behavior.type === 'subscription') {
    const lessonBuckets = buildLessonCountBuckets({
      totalAuthorizedLessons: Math.max(0, behavior.subscription?.lessons_count || 0),
      consumedLessons: liveLessonCounts?.consumed_lessons ?? usage.consumed_lessons,
      reservedLessons: liveLessonCounts?.reserved_lessons ?? 0,
    });
    return {
      type: behavior.type,
      default_charge_amount: behavior.subscription?.charge_amount ?? defaultChargeAmount,
      package_items: [],
      subscription: {
        ...behavior.subscription,
        consumed_lessons: lessonBuckets.consumed_lessons,
        reserved_lessons: lessonBuckets.reserved_lessons,
        available_lessons_to_book: lessonBuckets.available_lessons_to_book,
        remaining_lessons: lessonBuckets.remaining_lessons,
      },
      hmo: null,
      remaining_lessons: lessonBuckets.remaining_lessons,
      consumed_lessons: lessonBuckets.consumed_lessons,
      reserved_lessons: lessonBuckets.reserved_lessons,
      available_lessons_to_book: lessonBuckets.available_lessons_to_book,
      total_authorized_lessons: lessonBuckets.total_authorized_lessons,
      consumed_amount: usage.consumed_amount,
      remaining_amount: ledgerBalance,
      reminder: null,
    };
  }

  if (behavior.type === 'hmo') {
    const lessonBuckets = buildLessonCountBuckets({
      totalAuthorizedLessons: Math.max(0, behavior.hmo?.authorized_lessons || 0),
      consumedLessons: liveLessonCounts?.consumed_lessons ?? usage.consumed_lessons,
      reservedLessons: liveLessonCounts?.reserved_lessons ?? 0,
    });
    const pendingClaimAmount = lessonBuckets.consumed_lessons * coerceAgorot(behavior.hmo?.insurer_claim_amount);

    return {
      type: behavior.type,
      default_charge_amount: behavior.hmo?.customer_charge_amount ?? defaultChargeAmount,
      package_items: [],
      subscription: null,
      hmo: {
        ...behavior.hmo,
        consumed_lessons: lessonBuckets.consumed_lessons,
        reserved_lessons: lessonBuckets.reserved_lessons,
        available_lessons_to_book: lessonBuckets.available_lessons_to_book,
        remaining_lessons: lessonBuckets.remaining_lessons,
        pending_claim_amount: pendingClaimAmount,
      },
      remaining_lessons: lessonBuckets.remaining_lessons,
      consumed_lessons: lessonBuckets.consumed_lessons,
      reserved_lessons: lessonBuckets.reserved_lessons,
      available_lessons_to_book: lessonBuckets.available_lessons_to_book,
      total_authorized_lessons: lessonBuckets.total_authorized_lessons,
      consumed_amount: usage.consumed_amount,
      remaining_amount: ledgerBalance,
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
    reserved_lessons: 0,
    available_lessons_to_book: null,
    total_authorized_lessons: null,
    consumed_amount: usage.consumed_amount,
    remaining_amount: ledgerBalance,
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
      student_charge_amount: coerceAgorot(resolvedRuntime.subscription?.charge_amount ?? resolvedRuntime.default_charge_amount),
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
    const baseStudentCharge = coerceAgorot(resolvedRuntime.hmo?.customer_charge_amount ?? resolvedRuntime.default_charge_amount);
    const studentChargeAmount = paymentMode === 'fully_paid_by_hmo'
      ? 0
      : baseStudentCharge;

    return {
      eligible: true,
      covered_service_id: normalizedServiceId,
      student_charge_amount: studentChargeAmount,
      insurer_claim_amount: coerceAgorot(resolvedRuntime.hmo?.insurer_claim_amount),
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
    student_charge_amount: coerceAgorot(resolvedRuntime.default_charge_amount),
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
    ? Math.ceil((expiryDate.getTime() - now.getTime()) / 86400000) <= BILLING_THRESHOLDS.EXPIRING_SOON_DAYS && expiryDate.getTime() >= now.getTime()
    : false;
  const remainingLessons = runtime?.remaining_lessons;
  const remainingAmountAgorot = coerceAgorot(runtime?.remaining_amount);
  const defaultChargeAgorot   = coerceAgorot(runtime?.default_charge_amount);
  const totalAmountAgorot     = coerceAgorot(commitment?.total_amount);
  const lowBalance = Number.isFinite(Number(remainingLessons))
    ? Number(remainingLessons) < BILLING_THRESHOLDS.LOW_BALANCE_LESSONS
    : remainingAmountAgorot > 0 && remainingAmountAgorot < defaultChargeAgorot * BILLING_THRESHOLDS.LOW_BALANCE_LESSONS;
  const exhausted = Number.isFinite(Number(remainingLessons))
    ? Number(remainingLessons) <= 0 && Number(runtime?.total_authorized_lessons ?? 0) > 0
    : remainingAmountAgorot <= 0 && totalAmountAgorot > 0;

  return {
    expired,
    exhausted,
    low_balance: lowBalance,
    expiring_soon: expiringSoon,
    remaining_lessons: Number.isFinite(Number(remainingLessons)) ? Number(remainingLessons) : null,
  };
}
