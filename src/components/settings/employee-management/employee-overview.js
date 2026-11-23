// What the employee overview shows in its availability section: the weekly working days and the
// employment scope, each only when it is set.
const DAY_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const EMPLOYMENT_SCOPE_LABELS = {
  global: 'גלובלי',
  hourly: 'שעתי',
  instructor: 'מדריך',
};

/** "ראשון, שני, רביעי", or '' when no working days are set. */
export function workingDaysText(workingDays) {
  const source = workingDays && typeof workingDays === 'object' && Array.isArray(workingDays.days) ? workingDays.days : workingDays;
  const days = Array.from(new Set((Array.isArray(source) ? source : [])
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)))
    .sort((left, right) => left - right);
  return days.map((day) => DAY_LABELS[day]).join(', ');
}

/** The scope in words ("שעתי"), or '' when none is set. An unknown value is shown as it is. */
export function employmentScopeText(scope) {
  const value = String(scope ?? '').trim();
  return value ? (EMPLOYMENT_SCOPE_LABELS[value] || value) : '';
}

/** The rows of the availability section: [{ key, label, value }], empty when neither is set. */
export function availabilityFacts(employee) {
  const facts = [];
  const days = workingDaysText(employee?.working_days);
  if (days) facts.push({ key: 'working_days', label: 'ימי עבודה', value: days });
  const scope = employmentScopeText(employee?.employment_scope);
  if (scope) facts.push({ key: 'employment_scope', label: 'היקף העסקה', value: scope });
  return facts;
}
