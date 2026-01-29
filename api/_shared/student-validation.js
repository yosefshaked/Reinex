/* eslint-env node */
/**
 * Shared student validation and coercion utilities
 * Used by /api/students and /api/students-maintenance-import
 * 
 * Note: These functions return {value, valid, provided?} objects for consistency
 * with the maintenance import CSV processing flow.
 */

import { UUID_PATTERN } from './org-bff.js';

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)?$/;
const ISRAELI_PHONE_PATTERN = /^(?:0(?:5[0-9]|[2-4|8-9][0-9])-?\d{7}|(?:\+?972-?)?5[0-9]-?\d{7})$/;
const NATIONAL_ID_PATTERN = /^\d{5,12}$/;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateIsraeliPhone(value) {
  if (value === null || value === undefined) {
    return { value: null, valid: true };
  }
  
  if (typeof value !== 'string') {
    return { value: null, valid: false };
  }
  
  let trimmed = value.trim();
  if (!trimmed) {
    return { value: null, valid: true };
  }
  
  // Handle Excel text formula format: ="0546341150"
  // Strip the formula wrapper before validation AND storage
  if (trimmed.startsWith('="') && trimmed.endsWith('"')) {
    trimmed = trimmed.slice(2, -1);
  }
  
  const normalized = trimmed.replace(/[\s-]/g, '');
  
  // Auto-add leading 0 if missing (Excel often strips it)
  // Israeli phone numbers are 9-10 digits
  // Mobile: 05X-XXXXXXX (10 digits, starts with 05)
  // Landline: 0[2-4,8-9]-XXXXXXX (9-10 digits, starts with 02/03/04/08/09)
  // If we get 9 digits without leading 0, prepend it
  let finalValue = trimmed;
  if (/^[2-5|8-9]\d{7,8}$/.test(normalized)) {
    finalValue = '0' + trimmed;
  }
  
  // Re-normalize after potential 0 addition
  const finalNormalized = finalValue.replace(/[\s-]/g, '');
  if (ISRAELI_PHONE_PATTERN.test(finalNormalized)) {
    // Return the corrected value (with leading 0, without Excel formula)
    return { value: finalValue, valid: true };
  }
  
  return { value: null, valid: false };
}

export function coerceNationalId(raw) {
  if (raw === null || raw === undefined) {
    return { value: null, valid: true, provided: false };
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { value: null, valid: true, provided: false };
    }
    if (NATIONAL_ID_PATTERN.test(trimmed)) {
      return { value: trimmed, valid: true, provided: true };
    }
  }

  return { value: null, valid: false, provided: true };
}

export function coerceIdentityNumber(raw) {
  // Identity number semantics are identical to legacy national_id for now.
  return coerceNationalId(raw);
}

export function coerceEmail(raw) {
  if (raw === null || raw === undefined) {
    return { value: null, valid: true };
  }

  if (typeof raw !== 'string') {
    return { value: null, valid: false };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { value: null, valid: true };
  }

  if (EMAIL_PATTERN.test(trimmed)) {
    return { value: trimmed, valid: true };
  }

  return { value: null, valid: false };
}

export function coerceOptionalText(value) {
  if (value === null || value === undefined) {
    return { value: null, valid: true };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return { value: trimmed || null, valid: true };
  }
  return { value: null, valid: false };
}

export function coerceBooleanFlag(raw, { defaultValue = null, allowUndefined = true } = {}) {
  if (raw === undefined) {
    return { value: defaultValue, valid: allowUndefined, provided: false };
  }

  if (raw === null) {
    return { value: defaultValue, valid: false, provided: true };
  }

  if (typeof raw === 'boolean') {
    return { value: raw, valid: true, provided: true };
  }

  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) {
      return { value: defaultValue, valid: false, provided: true };
    }
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y' || normalized === 'on' || normalized === 'כן') {
      return { value: true, valid: true, provided: true };
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'n' || normalized === 'off' || normalized === 'לא') {
      return { value: false, valid: true, provided: true };
    }
    return { value: defaultValue, valid: false, provided: true };
  }

  if (typeof raw === 'number') {
    if (raw === 1) {
      return { value: true, valid: true, provided: true };
    }
    if (raw === 0) {
      return { value: false, valid: true, provided: true };
    }
  }

  return { value: defaultValue, valid: false, provided: true };
}

export function coerceDayOfWeek(value) {
  if (value === null || value === undefined || value === '') {
    return { value: null, valid: true };
  }

  // Hebrew day name mapping (database stores 1-7)
  const hebrewDays = {
    'ראשון': 1,
    'שני': 2,
    'שלישי': 3,
    'רביעי': 4,
    'חמישי': 5,
    'שישי': 6,
    'שבת': 7,
  };

  const str = String(value).trim();
  
  // Try Hebrew day name first
  if (hebrewDays[str] !== undefined) {
    return { value: hebrewDays[str], valid: true };
  }

  // Try numeric (1-7 is the canonical format)
  const numeric = typeof value === 'number' ? value : Number.parseInt(str, 10);

  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 7) {
    return { value: numeric, valid: true };
  }
  
  // Also accept 0-6 for backward compatibility (convert to 1-7)
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 6) {
    return { value: numeric === 0 ? 7 : numeric, valid: true }; // 0 → 7 (Sunday), 1-6 → 1-6
  }

  return { value: null, valid: false };
}

export function coerceSessionTime(value) {
  if (value === null || value === undefined || value === '') {
    return { value: null, valid: true };
  }

  if (typeof value !== 'string') {
    return { value: null, valid: false };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { value: null, valid: true };
  }

  // Accept HH:MM format (store as-is without seconds)
  const hhmmPattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const hhmmMatch = trimmed.match(hhmmPattern);
  if (hhmmMatch) {
    return { value: trimmed, valid: true };
  }

  // Accept full time format (HH:MM:SS with optional timezone) - extract just HH:MM
  if (TIME_PATTERN.test(trimmed)) {
    // Extract HH:MM from formats like "16:30:00", "16:30:00+00", "16:30:00Z"
    const timeOnly = trimmed.split('+')[0].split('Z')[0];
    const parts = timeOnly.split(':');
    if (parts.length >= 2) {
      return { value: `${parts[0]}:${parts[1]}`, valid: true };
    }
    return { value: trimmed, valid: true };
  }

  return { value: null, valid: false };
}

export function coerceTags(value) {
  if (value === null || value === undefined) {
    return { value: null, valid: true };
  }

  if (Array.isArray(value)) {
    const normalized = value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean);
    return { value: normalized.length ? normalized : null, valid: true };
  }

  if (typeof value === 'string') {
    const normalized = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    return { value: normalized.length ? normalized : null, valid: true };
  }

  return { value: null, valid: false };
}

export function validateAssignedInstructor(candidate) {
  if (candidate === null) {
    return { value: null, valid: true };
  }
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (!trimmed) {
      return { value: null, valid: true };
    }
    if (UUID_PATTERN.test(trimmed)) {
      return { value: trimmed, valid: true };
    }
  }
  return { value: null, valid: false };
}

/**
 * Coerce optional date string (YYYY-MM-DD format)
 * @param {*} raw 
 * @returns {{ value: string | null, valid: boolean }}
 */
export function coerceOptionalDate(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return { value: null, valid: true };
  }
  if (typeof raw !== 'string') {
    return { value: null, valid: false };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { value: null, valid: true };
  }
  // Basic date format validation (YYYY-MM-DD)
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(trimmed)) {
    return { value: null, valid: false };
  }
  // Validate it's a real date
  const date = new Date(trimmed);
  if (isNaN(date.getTime())) {
    return { value: null, valid: false };
  }
  return { value: trimmed, valid: true };
}

/**
 * Coerce notification method (whatsapp or email)
 * @param {*} raw 
 * @returns {{ value: string, valid: boolean }}
 */
export function coerceNotificationMethod(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return { value: 'whatsapp', valid: true }; // Default
  }
  if (typeof raw !== 'string') {
    return { value: 'whatsapp', valid: false };
  }
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'whatsapp' || trimmed === 'email') {
    return { value: trimmed, valid: true };
  }
  return { value: 'whatsapp', valid: false };
}

/**
 * Coerce optional numeric field (for special_rate, etc.)
 * @param {*} raw 
 * @returns {{ value: number | null, valid: boolean }}
 */
export function coerceOptionalNumeric(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return { value: null, valid: true };
  }
  const num = parseFloat(raw);
  if (isNaN(num)) {
    return { value: null, valid: false };
  }
  return { value: num, valid: true };
}

/**
 * Coerce optional JSONB field
 * @param {*} raw 
 * @returns {{ value: any | null, valid: boolean }}
 */
export function coerceOptionalJsonb(raw) {
  if (raw === null || raw === undefined) {
    return { value: null, valid: true };
  }
  // If it's already an object, return it
  if (typeof raw === 'object') {
    return { value: raw, valid: true };
  }
  // If it's a string, try to parse it
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { value: null, valid: true };
    }
    try {
      const parsed = JSON.parse(trimmed);
      return { value: parsed, valid: true };
    } catch {
      return { value: null, valid: false };
    }
  }
  return { value: null, valid: false };
}

/**
 * Coerce onboarding status enum
 * @param {*} raw 
 * @returns {{ value: string, valid: boolean }}
 */
export function coerceOnboardingStatus(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return { value: 'not_started', valid: true }; // Default
  }
  if (typeof raw !== 'string') {
    return { value: 'not_started', valid: false };
  }
  const trimmed = raw.trim().toLowerCase();
  const validStatuses = ['not_started', 'in_progress', 'completed'];
  if (validStatuses.includes(trimmed)) {
    return { value: trimmed, valid: true };
  }
  return { value: 'not_started', valid: false };
}

/**
 * Coerce optional email (alias for coerceEmail for consistency)
 * @param {*} raw 
 * @returns {{ value: string | null, valid: boolean }}
 */
export function coerceOptionalEmail(raw) {
  return coerceEmail(raw);
}

/**
 * Coerce optional string (consistent interface)
 * @param {*} raw 
 * @returns {{ value: string | null, valid: boolean }}
 */
export function coerceOptionalString(raw) {
  return coerceOptionalText(raw);
}
