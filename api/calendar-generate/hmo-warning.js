/* eslint-env node */
import { localDateKey } from '../_shared/local-time.js';

function normalizeString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

// The lesson's local date in the org's zone (datetime_start is a UTC instant).
function extractDatePart(dateTimeValue) {
  return localDateKey(dateTimeValue);
}

function isAuthorizationDateCovered(row, dateString) {
  const validFrom = normalizeString(row?.valid_from) || '0001-01-01';
  const expiresAt = normalizeString(row?.expires_at) || '9999-12-31';
  return validFrom <= dateString && dateString <= expiresAt;
}

export function buildHmoCoverageWarning(candidate, authorizationRows = []) {
  const studentId = normalizeString(candidate?.student_id);
  const serviceId = normalizeString(candidate?.service_id);
  const targetDate = normalizeString(candidate?.target_date) || extractDatePart(candidate?.datetime_start);
  if (!studentId || !serviceId || !targetDate) {
    return null;
  }

  const matchingRows = (authorizationRows || []).filter((row) => (
    normalizeString(row?.student_id) === studentId
    && normalizeString(row?.service_id) === serviceId
  ));

  if (matchingRows.length === 0) {
    return {
      type: 'hmo_authorization_gap',
      severity: 'warning',
      reason: 'no_authorization_found',
      student_id: studentId,
      service_id: serviceId,
      template_id: candidate.template_id || null,
      target_date: targetDate,
      datetime_start: candidate.datetime_start,
      message: 'לא נמצאה הרשאת גורם מממן לתלמיד/ה עבור השירות במועד זה. החיוב עלול להתבצע כחיוב רגיל.',
    };
  }

  const activeRows = matchingRows.filter((row) => normalizeString(row?.status).toLowerCase() === 'active');
  if (activeRows.length === 0) {
    return {
      type: 'hmo_authorization_gap',
      severity: 'warning',
      reason: 'no_active_authorization',
      student_id: studentId,
      service_id: serviceId,
      template_id: candidate.template_id || null,
      target_date: targetDate,
      datetime_start: candidate.datetime_start,
      message: 'קיימת הרשאת גורם מממן לשירות אך אינה פעילה במועד זה. החיוב עלול להתבצע כחיוב רגיל.',
    };
  }

  const activeInRangeRows = activeRows.filter((row) => isAuthorizationDateCovered(row, targetDate));
  if (activeInRangeRows.length > 0) {
    return null;
  }

  return {
    type: 'hmo_authorization_gap',
    severity: 'warning',
    reason: 'no_active_authorization_for_date',
    student_id: studentId,
    service_id: serviceId,
    template_id: candidate.template_id || null,
    target_date: targetDate,
    datetime_start: candidate.datetime_start,
    message: 'קיימת הרשאה פעילה לשירות אך טווח התאריכים אינו מכסה את המועד שנוצר. החיוב עלול להתבצע כחיוב רגיל.',
  };
}
