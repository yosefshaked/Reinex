/**
 * A YYYY-MM-DD date key as the office reads it: 15.09.2026. One formatter for every screen that
 * shows when a rate or a record applies, so the wording cannot drift between them.
 */
export function formatDateKey(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-');
  return year && month && day ? `${day}.${month}.${year}` : '';
}
