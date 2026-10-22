/**
 * How a service pays the instructor: once per lesson, or per compensation-eligible participant.
 *
 * This is a property of the SERVICE, not of the instructor, and it is not dated. The rate itself
 * lives in RateHistory (see api/_shared/rate-history.js) and is written only through
 * api/employee-rates — never derived from a capability, and never converted between units.
 */
export const SERVICE_PAYMENT_MODELS = Object.freeze({
  fixedRate: 'fixed_rate',
  perStudent: 'per_student',
});

function normalizeServicePaymentModel(value) {
  return value === SERVICE_PAYMENT_MODELS.perStudent
    ? SERVICE_PAYMENT_MODELS.perStudent
    : SERVICE_PAYMENT_MODELS.fixedRate;
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
