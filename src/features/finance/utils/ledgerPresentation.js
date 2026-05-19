const REVERSAL_REASON_LABELS = {
  attendance_changed: 'שינוי נוכחות',
  manual_reversal: 'היפוך ידני',
  status_changed: 'שינוי סטטוס',
  calendar_sync: 'סנכרון יומן',
  cancelled: 'ביטול',
};

const PARTICIPANT_STATUS_LABELS = {
  attended: 'נכח/ה',
  no_show: 'לא הגיע/ה',
  cancelled_student: 'בוטל על ידי הלקוח/ה',
  cancelled_clinic: 'בוטל על ידי הארגון',
  scheduled: 'מתוכנן',
};

const NON_ATTENDANCE_CHARGE_LABELS = {
  no_show: 'חיוב בגין אי הגעה',
  cancelled_student: 'חיוב בגין ביטול לקוח',
  cancelled_clinic: 'חיוב בגין ביטול ארגון',
};

const NON_ATTENDANCE_BADGE_CLASSES = {
  no_show: 'border-amber-200 bg-amber-50 text-amber-900',
  cancelled_student: 'border-orange-200 bg-orange-50 text-orange-900',
  cancelled_clinic: 'border-slate-200 bg-slate-50 text-slate-700',
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

export function getParticipantStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return PARTICIPANT_STATUS_LABELS[normalized] || normalized || 'לא ידוע';
}

export function isNonAttendanceStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(NON_ATTENDANCE_CHARGE_LABELS, normalized);
}

export function getLessonChargePresentation(row = {}) {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const participantStatus = String(row?.participant_status || metadata.participant_status || '').trim().toLowerCase();
  if (row?.source_type === 'lesson_charge' && isNonAttendanceStatus(participantStatus)) {
    return {
      label: NON_ATTENDANCE_CHARGE_LABELS[participantStatus],
      statusBadge: {
        label: getParticipantStatusLabel(participantStatus),
        className: NON_ATTENDANCE_BADGE_CLASSES[participantStatus],
      },
    };
  }

  return {
    label: row?.source_type === 'lesson_charge' ? 'חיוב שיעור' : '',
    statusBadge: null,
  };
}

export function getCoveragePresentation(row = {}) {
  const participantStatus = String(row?.participant_status || '').trim().toLowerCase();
  if (isNonAttendanceStatus(participantStatus) && row?.billing_status !== 'not_chargeable') {
    return {
      label: NON_ATTENDANCE_CHARGE_LABELS[participantStatus],
      className: NON_ATTENDANCE_BADGE_CLASSES[participantStatus],
    };
  }

  switch (row?.coverage_status) {
    case 'covered':
      return { label: 'כיסוי פעיל', className: 'border-indigo-200 bg-indigo-50 text-indigo-900' };
    case 'post_coverage':
      return { label: 'אחרי מיצוי זכאות', className: 'border-amber-200 bg-amber-50 text-amber-900' };
    case 'standard_uncovered':
      return { label: 'ללא כיסוי', className: 'border-slate-200 bg-slate-50 text-slate-700' };
    default:
      return null;
  }
}
