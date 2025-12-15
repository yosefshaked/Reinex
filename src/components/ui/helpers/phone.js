const ISRAELI_PHONE_PATTERN = /^(?:0(?:5[0-9]|[2-4|8-9][0-9])-?\d{7}|(?:\+?972-?)?5[0-9]-?\d{7})$/;

export function validateIsraeliPhone(value) {
  if (!value) return true; // Empty is valid if not required
  const normalized = value.replace(/[\s-]/g, '');
  return ISRAELI_PHONE_PATTERN.test(normalized);
}

export default validateIsraeliPhone;
