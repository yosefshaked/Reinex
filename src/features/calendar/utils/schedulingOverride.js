export const SCHEDULING_OVERRIDE_REASON_OPTIONS = [
  { value: 'holiday_or_special_activity', label: 'חג / פעילות מיוחדת' },
  { value: 'temporary_instructor_window', label: 'חלון זמני פנוי אצל המדריך/ה' },
  { value: 'special_service_need', label: 'צורך טיפולי / שירות חריג' },
  { value: 'urgent_schedule_adjustment', label: 'שינוי תפעולי דחוף' },
  { value: 'custom', label: 'אחר' },
];

export function getSchedulingOverrideReasonLabel(reasonCode) {
  return SCHEDULING_OVERRIDE_REASON_OPTIONS.find((option) => option.value === reasonCode)?.label || '';
}

export function resolveSchedulingOverrideFormState(overrideMetadata) {
  const reasonCode = typeof overrideMetadata?.reason_code === 'string'
    ? overrideMetadata.reason_code.trim()
    : '';
  const reason = typeof overrideMetadata?.reason === 'string'
    ? overrideMetadata.reason.trim()
    : '';

  if (!reason && !reasonCode) {
    return {
      enabled: false,
      selectedReasonCode: '',
      customReason: '',
      resolvedReason: '',
    };
  }

  if (reasonCode && getSchedulingOverrideReasonLabel(reasonCode)) {
    return {
      enabled: true,
      selectedReasonCode: reasonCode,
      customReason: reasonCode === 'custom' ? reason : '',
      resolvedReason: reason || getSchedulingOverrideReasonLabel(reasonCode),
    };
  }

  const matchedOption = SCHEDULING_OVERRIDE_REASON_OPTIONS.find((option) => option.value !== 'custom' && option.label === reason);
  if (matchedOption) {
    return {
      enabled: true,
      selectedReasonCode: matchedOption.value,
      customReason: '',
      resolvedReason: matchedOption.label,
    };
  }

  return {
    enabled: true,
    selectedReasonCode: 'custom',
    customReason: reason,
    resolvedReason: reason,
  };
}

export function buildSchedulingOverrideReasonDetails(selectedReasonCode, customReason = '') {
  const normalizedCode = typeof selectedReasonCode === 'string' ? selectedReasonCode.trim() : '';
  if (!normalizedCode) {
    return { reasonCode: '', reason: '' };
  }

  if (normalizedCode === 'custom') {
    const trimmedCustomReason = String(customReason || '').trim();
    return {
      reasonCode: trimmedCustomReason ? 'custom' : '',
      reason: trimmedCustomReason,
    };
  }

  const reasonLabel = getSchedulingOverrideReasonLabel(normalizedCode);
  return {
    reasonCode: reasonLabel ? normalizedCode : '',
    reason: reasonLabel,
  };
}

export function hasValidSchedulingOverrideReason(selectedReasonCode, customReason = '') {
  const { reasonCode, reason } = buildSchedulingOverrideReasonDetails(selectedReasonCode, customReason);
  return Boolean(reasonCode && reason);
}
