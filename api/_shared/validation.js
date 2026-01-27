/* eslint-env node */
import { Buffer } from 'node:buffer';
import { UUID_PATTERN, normalizeString } from './org-bff.js';

// Utility: estimate bytes of a JS value by JSON stringification
function estimateBytes(value) {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    return typeof s === 'string' ? Buffer.byteLength(s, 'utf8') : 0;
  } catch {
    return 0;
  }
}

export function isUUID(value) {
  const v = normalizeString(value);
  return Boolean(v && UUID_PATTERN.test(v));
}

export function isYMDDate(value) {
  const v = normalizeString(value);
  return Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
}

export function isEmail(value) {
  const v = normalizeString(value).toLowerCase();
  if (!v) return false;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

// Safe JSON parsing with body length awareness. Mode "observe" never rejects; "enforce" throws 413.
export function parseJsonBodyWithLimit(req, maxBytes = 131072, { mode = 'observe', context, endpoint } = {}) { // 128KB default
  let raw = null;
  if (typeof req?.rawBody === 'string') raw = req.rawBody;
  else if (typeof req?.body === 'string') raw = req.body;

  const length = raw ? Buffer.byteLength(raw, 'utf8') : estimateBytes(req?.body);

  if (length > maxBytes) {
    const msg = `${endpoint || 'api'} payload exceeded soft limit: ${length} > ${maxBytes}`;
    if (context?.log?.warn) context.log.warn(msg);
    else if (context?.log) context.log(msg);
    if (mode === 'enforce') {
      const err = new Error('payload_too_large');
      err.status = 413;
      throw err;
    }
  }

  if (raw) {
    try {
      const obj = JSON.parse(raw);
      return typeof obj === 'object' && obj ? obj : {};
    } catch {
      // Fall back to object body or empty
    }
  }

  return (req?.body && typeof req.body === 'object') ? req.body : {};
}

// ----- Sessions write validation (SOT) -----
function sanitizeAnswerValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' ? null : t;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((e) => (typeof e === 'string' ? (e.trim() || null) : e));
  if (typeof value === 'object') {
    const nested = {};
    for (const [k, v] of Object.entries(value)) {
      const nk = typeof k === 'string' ? k.trim() : '';
      if (!nk) continue;
      nested[nk] = sanitizeAnswerValue(v);
    }
    return nested;
  }
  return null;
}

function coerceSessionContent(source) {
  if (source === null || source === undefined) {
    return { error: 'missing_content' };
  }

  let payload = source;
  if (typeof payload === 'string') {
    const t = payload.trim();
    if (!t) return { value: {} };
    try { payload = JSON.parse(t); } catch { return { error: 'invalid_content' }; }
  }

  if (typeof payload !== 'object' || Array.isArray(payload)) return { error: 'invalid_content' };

  const normalized = {};
  for (const [k, v] of Object.entries(payload)) {
    const nk = typeof k === 'string' ? k.trim() : '';
    if (!nk) continue;
    if (v === undefined) continue;
    normalized[nk] = sanitizeAnswerValue(v);
  }
  return { value: normalized };
}

export function coerceOptionalText(value) {
  if (value === null || value === undefined) return { value: null, valid: true };
  if (typeof value === 'string') return { value: value.trim() || null, valid: true };
  return { value: null, valid: false };
}

function resolveContentCandidate(body) {
  if (!body || typeof body !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(body, 'content')) return body.content;
  if (Object.prototype.hasOwnProperty.call(body, 'answers')) return body.answers;
  return undefined;
}

function coerceSessionTime(value) {
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

  const hhmmPattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (hhmmPattern.test(trimmed)) {
    return { value: trimmed, valid: true };
  }

  // Accept HH:MM:SS (with optional timezone) by truncating to HH:MM
  const hhmmssPattern = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:([+-]\d{2}:?\d{2})|Z)?$/;
  if (hhmmssPattern.test(trimmed)) {
    const parts = trimmed.split(':');
    if (parts.length >= 2) {
      return { value: `${parts[0]}:${parts[1]}`, valid: true };
    }
  }

  return { value: null, valid: false };
}

export function validateSessionWrite(body) {
  const studentIdRaw = normalizeString(body?.student_id || body?.studentId);
  const hasStudentId = Boolean(studentIdRaw);
  if (hasStudentId && !isUUID(studentIdRaw)) {
    return { error: 'invalid_student_id' };
  }

  const date = normalizeString(body?.date);
  if (!isYMDDate(date)) {
    return { error: 'invalid_date' };
  }

  const isLoose = !hasStudentId;

  // Admin can optionally specify which instructor is submitting the loose report
  const instructorIdRaw = normalizeString(body?.instructor_id || body?.instructorId);
  if (instructorIdRaw && !isUUID(instructorIdRaw)) {
    return { error: 'invalid_instructor_id' };
  }

  const contentSource = resolveContentCandidate(body);
  const contentResult = coerceSessionContent(contentSource);
  if (contentResult.error) return { error: contentResult.error };

  const hasServiceField =
    Object.prototype.hasOwnProperty.call(body ?? {}, 'service_context') ||
    Object.prototype.hasOwnProperty.call(body ?? {}, 'serviceContext');

  const serviceResult = coerceOptionalText(body?.service_context ?? body?.serviceContext);
  if (!serviceResult.valid) return { error: 'invalid_service_context' };
  if (isLoose && !serviceResult.value) return { error: 'missing_service_context' };

  const timeRaw = normalizeString(body?.time || body?.session_time || body?.sessionTime);
  if (isLoose && !timeRaw) return { error: 'missing_time' };
  const timeResult = coerceSessionTime(timeRaw);
  if (!timeResult.valid) return { error: 'invalid_time' };
  if (isLoose && !timeResult.value) return { error: 'missing_time' };

  let unassignedDetails = null;
  if (isLoose) {
    const details = body?.unassigned_details || body?.unassignedDetails || {};
    const name = normalizeString(details?.name || body?.unassigned_name || body?.unassignedName);
    const reason = normalizeString(details?.reason || body?.unassigned_reason || body?.unassignedReason);
    const otherReason = normalizeString(details?.reason_other || details?.other_reason || body?.unassigned_reason_other || body?.unassignedReasonOther);

    if (!name) return { error: 'missing_unassigned_name' };

    const allowedReasons = ['substitute', 'new_student', 'other'];
    const hasValidReason = reason && allowedReasons.includes(reason);
    if (!hasValidReason) return { error: 'missing_unassigned_reason' };
    if (reason === 'other' && !otherReason) return { error: 'missing_unassigned_reason_detail' };

    unassignedDetails = {
      name,
      reason,
      ...(reason === 'other' ? { reason_other: otherReason } : {}),
      time: timeResult.value,
    };
  }

  return {
    studentId: hasStudentId ? studentIdRaw : null,
    date,
    content: contentResult.value,
    serviceContext: serviceResult.value,
    hasExplicitService: hasServiceField,
    time: timeResult.value,
    unassignedDetails,
    instructorId: instructorIdRaw || null,
  };
}

// ----- Instructors write validation (SOT) -----
const PHONE_PATTERN = /^[0-9+\-()\s]{6,20}$/;

export function validateInstructorCreate(body) {
  const userId = normalizeString(body?.user_id || body?.userId);
  if (!isUUID(userId)) {
    return { error: 'missing_user_id' };
  }

  // Support both camelCase and snake_case for name fields
  const firstName = normalizeString(body?.first_name || body?.firstName) || '';
  const middleName = normalizeString(body?.middle_name || body?.middleName) || '';
  const lastName = normalizeString(body?.last_name || body?.lastName) || '';
  const emailRaw = normalizeString(body?.email).toLowerCase();
  const email = emailRaw ? (isEmail(emailRaw) ? emailRaw : null) : '';
  const phoneRaw = normalizeString(body?.phone);
  const phone = phoneRaw ? (PHONE_PATTERN.test(phoneRaw) ? phoneRaw : null) : '';
  const notesResult = coerceOptionalText(body?.notes);
  if (!notesResult.valid) {
    return { error: 'invalid_notes' };
  }

  return {
    userId,
    // empty strings mean "not provided"; nulls mean "provided but invalid"
    firstName,
    middleName,
    lastName,
    email,
    phone,
    notes: notesResult.value,
  };
}

export function validateInstructorUpdate(body, orgPermissions = {}) {
  const instructorId = normalizeString(body?.id || body?.instructor_id || body?.instructorId);
  if (!isUUID(instructorId)) {
    return { error: 'missing_instructor_id' };
  }

  const updates = {};
  const metadataUpdates = {};

  const normalizePreanswersMap = (raw, orgPermissions) => {
    const capRaw = orgPermissions?.session_form_preanswers_cap;
    const cap = typeof capRaw === 'number' && capRaw > 0 ? capRaw : 50;
    if (!raw || typeof raw !== 'object') return {};
    const normalized = {};
    for (const [key, list] of Object.entries(raw)) {
      if (!key || !Array.isArray(list)) continue;
      const unique = [];
      const seen = new Set();
      for (const rawEntry of list) {
        if (typeof rawEntry !== 'string') continue;
        const trimmed = rawEntry.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        unique.push(trimmed);
        if (unique.length >= cap) break;
      }
      normalized[key] = unique;
    }
    return normalized;
  };

  if (Object.prototype.hasOwnProperty.call(body, 'first_name') || Object.prototype.hasOwnProperty.call(body, 'firstName')) {
    const v = normalizeString(
      Object.prototype.hasOwnProperty.call(body, 'first_name') ? body.first_name : body.firstName
    );
    updates['first_name'] = v || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'middle_name') || Object.prototype.hasOwnProperty.call(body, 'middleName')) {
    const v = normalizeString(
      Object.prototype.hasOwnProperty.call(body, 'middle_name') ? body.middle_name : body.middleName
    );
    updates['middle_name'] = v || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'last_name') || Object.prototype.hasOwnProperty.call(body, 'lastName')) {
    const v = normalizeString(
      Object.prototype.hasOwnProperty.call(body, 'last_name') ? body.last_name : body.lastName
    );
    updates['last_name'] = v || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'email')) {
    const v = normalizeString(body.email).toLowerCase();
    updates.email = v ? (isEmail(v) ? v : null) : null;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
    const v = normalizeString(body.phone);
    updates.phone = v ? (PHONE_PATTERN.test(v) ? v : null) : null;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
    const notesResult = coerceOptionalText(body.notes);
    if (!notesResult.valid) {
      return { error: 'invalid_notes' };
    }
    updates.notes = notesResult.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'is_active')) {
    updates.is_active = Boolean(body.is_active);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'instructor_types')) {
    const raw = body.instructor_types;
    if (Array.isArray(raw)) {
      const validated = raw
        .map((id) => normalizeString(id))
        .filter((id) => isUUID(id));
      updates.instructor_types = validated.length > 0 ? validated : null;
    } else {
      updates.instructor_types = null;
    }
  }

  if (body && typeof body === 'object') {
    const rawMeta = body.metadata && typeof body.metadata === 'object' ? body.metadata : null;
    const rawCustom = rawMeta && typeof rawMeta.custom_preanswers === 'object'
      ? rawMeta.custom_preanswers
      : null;
    if (rawCustom) {
      metadataUpdates.custom_preanswers = normalizePreanswersMap(rawCustom, orgPermissions);
    }

    const rawAlias = body.custom_preanswers && typeof body.custom_preanswers === 'object'
      ? body.custom_preanswers
      : null;
    if (rawAlias) {
      metadataUpdates.custom_preanswers = normalizePreanswersMap(rawAlias, orgPermissions);
    }
  }

  if (Object.keys(metadataUpdates).length > 0) {
    updates.__metadata_custom_preanswers = metadataUpdates.custom_preanswers || {};
  }

  return { instructorId, updates };
}
