const REVERSAL_REASON_LABELS = {
  attendance_changed: 'שינוי נוכחות',
  manual_reversal: 'היפוך ידני',
  status_changed: 'שינוי סטטוס',
  calendar_sync: 'סנכרון יומן',
  cancelled: 'ביטול',
};

function prettifyCode(code) {
  const normalized = String(code || '').trim().toLowerCase();
  if (!normalized) return '';
  if (REVERSAL_REASON_LABELS[normalized]) return REVERSAL_REASON_LABELS[normalized];
  return normalized.replace(/_/g, ' ');
}

export function formatLedgerNote(note) {
  const value = String(note || '').trim();
  if (!value) return '';

  if (value.startsWith('Reversal:')) {
    const reason = value.slice('Reversal:'.length).trim();
    const label = prettifyCode(reason);
    return label ? `היפוך עקב: ${label}` : 'היפוך';
  }

  return value;
}
