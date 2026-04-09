import { coerceAgorot } from '@/lib/currency.js';

export const COMMITMENT_TYPE_OPTIONS = [
  {
    value: 'package',
    label: 'חבילה',
    description: 'כמה שירותים בתוך התחייבות אחת, עם הקצאה נפרדת לכל שירות.',
  },
  {
    value: 'subscription',
    label: 'מנוי',
    description: 'כמות שיעורים לשירות אחד בלבד.',
  },
  {
    value: 'hmo',
    label: 'גורם מממן',
    description: 'המשתמש מגדיר מי משלם, כמה משלם הלקוח, כמה נתבע מהגורם המממן, ומה פעולת ההמשך.',
  },
  {
    value: 'manual_credit',
    label: 'הוספת יתרה מותאמת אישית',
    description: 'יתרה מותאמת אישית ללא לוגיקה מיוחדת.',
  },
];

export const HMO_PAYMENT_MODE_OPTIONS = [
  { value: 'fully_paid_by_hmo', label: 'ממומן במלואו על ידי הגורם המממן' },
  { value: 'partially_paid_by_hmo', label: 'ממומן חלקית על ידי הגורם המממן והיתרה על ידי הלקוח' },
  { value: 'fully_paid_by_customer', label: 'משולם במלואו על ידי הלקוח' },
];

export const HMO_SUGGESTION_OPTIONS = [
  {
    value: 'clalit',
    label: 'כללית',
    providerName: 'כללית',
    paymentMode: 'partially_paid_by_hmo',
    workflowNotes: 'הלקוח משלם השתתפות עצמית, ובסוף חודש שולחים לקופה את תאריכי המפגשים עבור יתרת החיוב.',
  },
  {
    value: 'meuhedet',
    label: 'מאוחדת',
    providerName: 'מאוחדת',
    paymentMode: 'fully_paid_by_hmo',
    workflowNotes: 'עובדים מול טופס 17, הלקוח לא משלם, ובסוף חודש שולחים לקופה את תאריכי המפגשים לתשלום.',
  },
  {
    value: 'leumit',
    label: 'לאומית',
    providerName: 'לאומית',
    paymentMode: 'fully_paid_by_customer',
    workflowNotes: 'הלקוח משלם מלא, מקבל חשבונית, ופונה עצמאית לקופה לצורך ההחזר.',
  },
  {
    value: 'custom',
    label: 'מותאם אישית',
    providerName: '',
    paymentMode: 'partially_paid_by_hmo',
    workflowNotes: '',
  },
];

export function getCommitmentTypeLabel(type) {
  return COMMITMENT_TYPE_OPTIONS.find((option) => option.value === type)?.label || type || 'התחייבות';
}

function createId() {
  return crypto.randomUUID();
}

function roundCurrency(value) {
  return coerceAgorot(value);
}

export function createEmptyPackageItem() {
  return {
    id: createId(),
    serviceId: '',
    lessonsCount: '',
    chargeAmount: '',
  };
}

export function buildInitialCommitmentForm() {
  const defaultSuggestion = HMO_SUGGESTION_OPTIONS[0];
  return {
    id: '',
    serviceId: '',
    commitmentType: 'package',
    totalAmount: '',
    defaultChargeAmount: '',
    expiresAt: '',
    notes: '',
    isActive: true,
    packageItems: [createEmptyPackageItem()],
    subscriptionLessonsCount: '',
    subscriptionChargeAmount: '',
    hmoSuggestionId: defaultSuggestion.value,
    hmoProviderName: defaultSuggestion.providerName,
    hmoPaymentMode: defaultSuggestion.paymentMode,
    hmoAuthorizedLessons: '',
    hmoCustomerChargeAmount: '',
    hmoInsurerClaimAmount: '',
    hmoAuthorizationReference: '',
    hmoReminderDate: '',
    hmoWorkflowNotes: defaultSuggestion.workflowNotes,
  };
}

export function normalizePackageItems(items = []) {
  return (items || [])
    .map((item) => ({
      key: item.id || createId(),
      service_id: item.serviceId || '',
      lessons_count: Number(item.lessonsCount || 0),
      charge_amount: coerceAgorot(item.chargeAmount),
    }))
    .filter((item) => item.service_id && Number.isFinite(item.lessons_count) && item.lessons_count > 0 && Number.isFinite(item.charge_amount) && item.charge_amount >= 0);
}

export function computeCommitmentAmounts(form) {
  if (form.commitmentType === 'package') {
    const packageItems = normalizePackageItems(form.packageItems);
    const totalAmount = packageItems.reduce((sum, item) => sum + (item.lessons_count * item.charge_amount), 0);
    return {
      totalAmount: roundCurrency(totalAmount),
      defaultChargeAmount: packageItems[0]?.charge_amount ?? null,
    };
  }

  if (form.commitmentType === 'subscription') {
    const lessonsCount = Number(form.subscriptionLessonsCount || 0);
    const chargeAmount = coerceAgorot(form.subscriptionChargeAmount);
    return {
      totalAmount: lessonsCount > 0 && Number.isFinite(chargeAmount) ? roundCurrency(lessonsCount * chargeAmount) : 0,
      defaultChargeAmount: Number.isFinite(chargeAmount) ? roundCurrency(chargeAmount) : null,
    };
  }

  if (form.commitmentType === 'hmo') {
    const authorizedLessons = Number(form.hmoAuthorizedLessons || 0);
    const customerCharge = coerceAgorot(form.hmoCustomerChargeAmount);
    return {
      totalAmount: authorizedLessons > 0 && Number.isFinite(customerCharge) ? roundCurrency(authorizedLessons * customerCharge) : 0,
      defaultChargeAmount: Number.isFinite(customerCharge) ? roundCurrency(customerCharge) : null,
    };
  }

  return {
    totalAmount: coerceAgorot(form.totalAmount),
    defaultChargeAmount: form.defaultChargeAmount === '' ? null : roundCurrency(Number(form.defaultChargeAmount)),
  };
}

export function buildCommitmentMetadataPayload(form) {
  if (form.commitmentType === 'package') {
    return {
      package_items: normalizePackageItems(form.packageItems),
    };
  }

  if (form.commitmentType === 'subscription') {
    return {
      subscription: {
        lessons_count: Number(form.subscriptionLessonsCount || 0),
        charge_amount: coerceAgorot(form.subscriptionChargeAmount),
      },
    };
  }

  if (form.commitmentType === 'hmo') {
    return {
      hmo: {
        suggestion_id: form.hmoSuggestionId || 'custom',
        provider_name: form.hmoProviderName || '',
        payment_mode: form.hmoPaymentMode || 'partially_paid_by_hmo',
        authorized_lessons: Number(form.hmoAuthorizedLessons || 0),
        customer_charge_amount: coerceAgorot(form.hmoCustomerChargeAmount),
        insurer_claim_amount: coerceAgorot(form.hmoInsurerClaimAmount),
        authorization_reference: form.hmoAuthorizationReference || '',
        reminder_date: form.hmoReminderDate || '',
        workflow_notes: form.hmoWorkflowNotes || '',
      },
    };
  }

  return {};
}

export function createCommitmentFormFromCommitment(commitment) {
  const form = buildInitialCommitmentForm();
  const metadata = commitment?.metadata && typeof commitment.metadata === 'object' ? commitment.metadata : {};
  const type = commitment?.commitment_type || 'package';
  const packageItems = Array.isArray(metadata.package_items) && metadata.package_items.length > 0
    ? metadata.package_items.map((item) => ({
      id: item.key || createId(),
      serviceId: item.service_id || '',
      lessonsCount: item.lessons_count ?? '',
      chargeAmount: item.charge_amount ?? '',
    }))
    : [createEmptyPackageItem()];

  return {
    ...form,
    id: commitment?.id || '',
    serviceId: commitment?.service_id || '',
    commitmentType: type,
    totalAmount: commitment?.total_amount ?? '',
    defaultChargeAmount: commitment?.default_charge_amount ?? '',
    expiresAt: commitment?.expires_at ? `${commitment.expires_at}`.slice(0, 10) : '',
    notes: commitment?.notes || '',
    isActive: commitment?.is_active !== false,
    packageItems,
    subscriptionLessonsCount: metadata?.subscription?.lessons_count ?? '',
    subscriptionChargeAmount: metadata?.subscription?.charge_amount ?? commitment?.default_charge_amount ?? '',
    hmoSuggestionId: metadata?.hmo?.suggestion_id || 'custom',
    hmoProviderName: metadata?.hmo?.provider_name || '',
    hmoPaymentMode: metadata?.hmo?.payment_mode || 'partially_paid_by_hmo',
    hmoAuthorizedLessons: metadata?.hmo?.authorized_lessons ?? '',
    hmoCustomerChargeAmount: metadata?.hmo?.customer_charge_amount ?? commitment?.default_charge_amount ?? '',
    hmoInsurerClaimAmount: metadata?.hmo?.insurer_claim_amount ?? '',
    hmoAuthorizationReference: metadata?.hmo?.authorization_reference || '',
    hmoReminderDate: metadata?.hmo?.reminder_date || '',
    hmoWorkflowNotes: metadata?.hmo?.workflow_notes || '',
  };
}

export function getCommitmentCoverageSummary(commitment, services = []) {
  const runtime = commitment?.runtime || {};
  const type = commitment?.commitment_type || runtime?.type;

  if (type === 'package') {
    const items = Array.isArray(runtime.package_items) ? runtime.package_items : [];
    if (items.length === 0) {
      return 'חבילה ללא שורות שירות מוגדרות';
    }
    return items.map((item) => {
      const serviceName = services.find((service) => service.id === item.service_id)?.service_name
        || services.find((service) => service.id === item.service_id)?.name
        || 'שירות';
      return `${serviceName}: ${item.remaining_lessons}/${item.lessons_count}`;
    }).join(' • ');
  }

  if (type === 'subscription') {
    const serviceName = services.find((service) => service.id === commitment?.service_id)?.service_name
      || services.find((service) => service.id === commitment?.service_id)?.name
      || 'שירות';
    const totalLessons = runtime?.subscription?.lessons_count ?? 0;
    const remainingLessons = runtime?.subscription?.remaining_lessons ?? 0;
    return `${serviceName} • נותרו ${remainingLessons} מתוך ${totalLessons}`;
  }

  if (type === 'hmo') {
    const providerName = runtime?.hmo?.provider_name || 'גורם מממן';
    const trackName = runtime?.hmo?.provider_track_name || '';
    const remainingLessons = runtime?.hmo?.remaining_lessons ?? 0;
    const authorizedLessons = runtime?.hmo?.authorized_lessons ?? 0;
    return `${providerName}${trackName ? ` • ${trackName}` : ''} • נותרו ${remainingLessons} מתוך ${authorizedLessons}`;
  }

  return 'יתרה מותאמת אישית ללא לוגיקה מיוחדת';
}

export function getCommitmentActionHint(commitment) {
  const type = commitment?.commitment_type || commitment?.runtime?.type;
  if (type === 'hmo') {
    const authorizationReference = commitment?.runtime?.hmo?.authorization_reference || '';
    const workflowNotes = commitment?.runtime?.hmo?.workflow_notes || 'אישור גורם מממן פעיל מנהל את ההתחייבות הזו.';
    return authorizationReference ? `${workflowNotes} • מס׳ אישור ${authorizationReference}` : workflowNotes;
  }
  if (type === 'package') {
    return 'החיוב ייקבע לפי השירות של השיעור והשורה המתאימה בחבילה.';
  }
  if (type === 'subscription') {
    return 'החיוב יתבצע רק מול השירות שנבחר למנוי.';
  }
  return 'היתרה תשמש כיתרה כללית לשירות שנבחר.';
}

export function commitmentSupportsService(commitment, serviceId) {
  if (!commitment || !serviceId) {
    return false;
  }
  if (commitment.commitment_type === 'package') {
    return Array.isArray(commitment?.runtime?.package_items) && commitment.runtime.package_items.some((item) => item.service_id === serviceId && item.remaining_lessons > 0);
  }
  if (commitment.commitment_type === 'subscription') {
    return commitment.service_id === serviceId && ((commitment?.runtime?.subscription?.remaining_lessons ?? 1) > 0);
  }
  if (commitment.commitment_type === 'hmo') {
    return commitment.service_id === serviceId && ((commitment?.runtime?.hmo?.remaining_lessons ?? 1) > 0);
  }
  return commitment.service_id === serviceId;
}
