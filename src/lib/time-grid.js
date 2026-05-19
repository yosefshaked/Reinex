export const DEFAULT_TIME_GRID_STEP_MINUTES = 15;

export function parseClockTimeToMinutes(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (
    !Number.isInteger(hours)
    || !Number.isInteger(minutes)
    || !Number.isInteger(seconds)
    || hours < 0
    || hours > 23
    || minutes < 0
    || minutes > 59
    || seconds < 0
    || seconds > 59
  ) {
    return null;
  }
  return (hours * 60) + minutes + (seconds > 0 ? 1 : 0);
}

export function formatClockMinutes(totalMinutes) {
  const safeMinutes = Math.max(0, Math.min((24 * 60) - DEFAULT_TIME_GRID_STEP_MINUTES, Number(totalMinutes) || 0));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function ceilClockTimeToGrid(value, stepMinutes = DEFAULT_TIME_GRID_STEP_MINUTES) {
  const minutes = parseClockTimeToMinutes(value);
  if (minutes == null) return '';
  const safeStep = Math.max(1, Number(stepMinutes) || DEFAULT_TIME_GRID_STEP_MINUTES);
  const rounded = Math.ceil(minutes / safeStep) * safeStep;
  if (rounded > (24 * 60) - safeStep) return '';
  return formatClockMinutes(rounded);
}

export function normalizePreferredTimeRangeToGrid(range, stepMinutes = DEFAULT_TIME_GRID_STEP_MINUTES) {
  const start = ceilClockTimeToGrid(range?.start, stepMinutes);
  const end = ceilClockTimeToGrid(range?.end, stepMinutes);
  if (!start || !end) return null;
  const startMinutes = parseClockTimeToMinutes(start);
  const endMinutes = parseClockTimeToMinutes(end);
  if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) return null;
  return { start, end };
}
