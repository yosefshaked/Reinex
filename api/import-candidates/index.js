/* eslint-env node */
// import-candidates — GET (list with filters) + PATCH (decisions + status)
// GET  /api/import-candidates?workspace_id=:id&entity_type=...&status=...&page=1
// PATCH /api/import-candidates/:candidateId
import { resolveBearerAuthorization } from '../_shared/http.js';
import {
  UUID_PATTERN,
  createSingleClient,
  ensureMembership,
  isAdminOrOffice,
  normalizeString,
  parseRequestBody,
  readEnv,
  resolveOrgId,
  respond,
  withOrgScope,
} from '../_shared/org-bff.js';
import { attachErrorTracking, respondTracked } from '../_shared/error-events.js';
import {
  validateIsraeliPhone,
  coerceIdentityNumber,
  coerceEmail,
  coerceOptionalText,
  coerceOptionalDate,
  coerceBooleanFlag,
} from '../_shared/student-validation.js';
import { normalizeFieldSource } from '../_shared/import-mapping.js';
import { buildRelationGroups } from '../_shared/import-relations.js';

// Internal (500-level) failures persist an error_events row and return the
// support code; validation/auth/not-found/conflict stay on plain respond().
function respondCandidatesError(context, status, message, error, metadata = {}) {
  return respondTracked(context, status, { message }, undefined, { error, metadata });
}

const PAGE_SIZE = 50;

const ALLOWED_CANDIDATE_STATUSES = new Set([
  'needs_review', 'ready', 'blocked', 'blocked_by_dependency',
  'skipped', 'committed', 'failed',
]);

const PATCH_ALLOWED_CANDIDATE_STATUSES = new Set([
  'needs_review', 'ready', 'skipped', 'blocked',
]);

const ALLOWED_ENTITY_TYPES = new Set([
  'customer', 'guardian', 'guardian_link', 'service',
  'instructor', 'lesson', 'lesson_participant',
]);

const VALID_CUSTOMER_TYPES = new Set(['student', 'one_time_customer']);

const EDITABLE_FIELDS_BY_ENTITY = {
  customer: ['first_name', 'last_name', 'identity_number', 'customer_type', 'is_active', 'phone', 'email', 'date_of_birth', 'note_text'],
  guardian: ['guardian_first_name', 'guardian_last_name', 'guardian_phone', 'guardian_email'],
  guardian_link: ['identity_number', 'guardian_phone', 'guardian_email', 'relationship', 'is_primary'],
  service: ['source_system', 'source_service_id', 'service_name', 'duration_minutes', 'description'],
  instructor: ['source_system', 'source_instructor_id', 'first_name', 'middle_name', 'last_name', 'is_active'],
  lesson: ['source_system', 'source_lesson_id', 'datetime_start', 'source_instructor_id', 'service_name', 'lesson_status', 'duration_minutes', 'legacy_note'],
  lesson_participant: ['source_system', 'source_lesson_id', 'identity_number', 'participant_status', 'legacy_attendance_note', 'status_inference'],
};

const REQUIRED_FIELDS_BY_ENTITY = {
  customer: ['first_name', 'last_name', 'identity_number', 'customer_type'],
  guardian: ['guardian_first_name', 'guardian_last_name'],
  guardian_link: ['identity_number', 'guardian_phone'],
  service: ['service_name', 'duration_minutes'],
  instructor: ['source_system', 'source_instructor_id', 'first_name'],
  lesson: ['source_system', 'source_lesson_id', 'datetime_start', 'source_instructor_id', 'service_name', 'lesson_status'],
  lesson_participant: ['source_system', 'source_lesson_id', 'identity_number', 'participant_status'],
};

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function countBlockingIssues(issues) {
  return (Array.isArray(issues) ? issues : []).filter((issue) => issue?.severity === 'blocker').length;
}

function hasValidPhone(value) {
  return Boolean(validateIsraeliPhone(value).value);
}

// DB duplicate (duplicate_identity_number) is resolved only by skipping or linking
// to the existing record — never by create_as_new (see decision #4).
function shouldClearDuplicateIdentityIssue(decisionsPatch) {
  const action = normalizeString(decisionsPatch?.action);
  return action === 'skip' || (action === 'link_to_existing' && Boolean(normalizeUuid(decisionsPatch?.linked_id)));
}

// In-file duplicate (same identity twice in this workspace) is resolved by any
// deliberate choice about the row, including create_as_new ("keep this copy").
function shouldClearInFileDuplicateIssue(decisionsPatch) {
  const action = normalizeString(decisionsPatch?.action);
  return action === 'skip'
    || action === 'create_as_new'
    || (action === 'link_to_existing' && Boolean(normalizeUuid(decisionsPatch?.linked_id)));
}

function hasResolvedDuplicateIdentityDecision(decisions) {
  const action = normalizeString(decisions?.action);
  if (action === 'skip') return true;
  return action === 'link_to_existing' && Boolean(normalizeUuid(decisions?.linked_id));
}

function hasResolvedInFileDuplicateDecision(decisions) {
  const action = normalizeString(decisions?.action);
  return action === 'skip'
    || action === 'create_as_new'
    || (action === 'link_to_existing' && Boolean(normalizeUuid(decisions?.linked_id)));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function issue(code, severity, field, extra = {}) {
  const message = code === 'guardian_primary_contact_required'
    ? 'נמצאו כמה אנשי קשר לאותו תלמיד — יש לבחור איש קשר ראשי אחד.'
    : undefined;
  return {
    code,
    severity,
    field,
    is_blocking: severity === 'blocker',
    ...(message ? { message } : {}),
    ...extra,
  };
}

function compactName(parts) {
  return (parts || []).map(normalizeString).filter(Boolean).join(' ');
}

function candidateDisplayName(candidateData) {
  return compactName([candidateData?.first_name, candidateData?.last_name])
    || compactName([candidateData?.guardian_first_name, candidateData?.guardian_last_name])
    || normalizeString(candidateData?.name)
    || '';
}

function buildGuardianLinkImportKey(candidateData = {}, fallback = '') {
  const identity = normalizeString(candidateData.identity_number);
  const guardianContact = normalizeString(candidateData.guardian_phone || candidateData.guardian_email);
  const joinValue = Object.values(candidateData.__import?.join?.values || {}).map(normalizeString).filter(Boolean)[0] || '';
  return [
    'guardian_link',
    identity || 'missing_identity',
    guardianContact || 'missing_guardian',
    joinValue || fallback || 'manual',
  ].join(':');
}

function normalizeRelatedCandidate(candidate) {
  if (!candidate) return null;
  const clean = { ...candidate };
  delete clean.import_rows;
  delete clean.related_candidates;
  return clean;
}

function normalizeRelationship(raw) {
  const value = coerceOptionalText(raw).value;
  if (!value) return { value: null, valid: true };
  const normalized = value.trim().toLowerCase();
  const map = {
    אבא: 'father',
    אב: 'father',
    father: 'father',
    אמא: 'mother',
    אם: 'mother',
    mother: 'mother',
    עצמי: 'self',
    self: 'self',
    מטפל: 'caretaker',
    caretaker: 'caretaker',
    אחר: 'other',
    other: 'other',
  };
  if (map[normalized]) return { value: map[normalized], valid: true };
  return { value: 'other', valid: false };
}

function normalizeCandidateDataPatch(entityType, existingData, patch) {
  const editableFields = new Set(EDITABLE_FIELDS_BY_ENTITY[entityType] || []);
  const nextData = { ...(existingData || {}) };
  if (!nextData.identity_number && nextData.student_identity_number) {
    nextData.identity_number = nextData.student_identity_number;
  }
  delete nextData.student_identity_number;
  if (entityType === 'service' && !nextData.service_name && nextData.name) {
    nextData.service_name = nextData.name;
  }
  delete nextData.name;
  delete nextData.dry_run_summary;
  const fieldIssues = [];
  const changedFields = [];

  for (const [field, rawValue] of Object.entries(patch || {})) {
    if (!editableFields.has(field)) continue;

    let normalizedValue = rawValue;
    let valid = true;
    let invalidSeverity = 'blocker';

    if (['first_name', 'middle_name', 'last_name', 'guardian_first_name', 'guardian_last_name', 'service_name', 'description', 'note_text', 'source_system', 'source_service_id', 'source_instructor_id', 'source_lesson_id', 'legacy_note', 'legacy_attendance_note', 'status_inference'].includes(field)) {
      const result = coerceOptionalText(rawValue);
      normalizedValue = result.value;
      valid = result.valid;
    } else if (field === 'identity_number') {
      // Keep the raw value when invalid so it stays visible/editable (the
      // invalid-format blocker prevents commit until it is corrected).
      const result = coerceIdentityNumber(rawValue);
      normalizedValue = result.valid ? result.value : rawValue;
      valid = result.valid;
      invalidSeverity = 'blocker';
    } else if (['phone', 'guardian_phone'].includes(field)) {
      const result = validateIsraeliPhone(rawValue);
      normalizedValue = result.valid ? result.value : rawValue;
      valid = result.valid;
    } else if (['email', 'guardian_email'].includes(field)) {
      const result = coerceEmail(rawValue);
      normalizedValue = result.valid ? result.value : rawValue;
      valid = result.valid;
    } else if (field === 'date_of_birth') {
      const result = coerceOptionalDate(rawValue);
      normalizedValue = result.valid ? result.value : rawValue;
      valid = result.valid;
    } else if (field === 'datetime_start') {
      const text = normalizeString(rawValue);
      const parsed = new Date(text);
      const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
      normalizedValue = text;
      valid = Boolean(text) && hasExplicitZone && !Number.isNaN(parsed.getTime());
      if (valid) normalizedValue = parsed.toISOString();
    } else if (field === 'duration_minutes') {
      const parsed = Number.parseInt(rawValue, 10);
      normalizedValue = parsed;
      valid = Number.isInteger(parsed) && parsed > 0 && parsed <= 1440;
    } else if (field === 'lesson_status') {
      const normalized = normalizeString(rawValue).toLowerCase();
      normalizedValue = normalized || null;
      valid = !normalized || ['scheduled', 'completed', 'cancelled'].includes(normalized);
    } else if (field === 'participant_status') {
      const normalized = normalizeString(rawValue).toLowerCase();
      normalizedValue = normalized || null;
      valid = !normalized || ['scheduled', 'attended', 'cancelled_student', 'cancelled_clinic', 'no_show'].includes(normalized);
    } else if (field === 'customer_type') {
      const ct = normalizeString(String(rawValue ?? '')).toLowerCase().replace(/\s+/g, '_');
      if (ct === '') {
        normalizedValue = null; // empty → missing_required_field handles it
        valid = true;
      } else if (VALID_CUSTOMER_TYPES.has(ct)) {
        normalizedValue = ct;
        valid = true;
      } else {
        normalizedValue = null;
        valid = false;
        invalidSeverity = 'blocker';
      }
    } else if (field === 'is_active') {
      const result = coerceBooleanFlag(rawValue, { defaultValue: true, allowUndefined: true });
      normalizedValue = result.value === false ? false : true;
      valid = true;
    } else if (field === 'is_primary') {
      const result = coerceBooleanFlag(rawValue, { defaultValue: null, allowUndefined: true });
      normalizedValue = result.valid ? result.value : null;
      valid = result.valid;
    } else if (field === 'relationship') {
      const result = normalizeRelationship(rawValue);
      normalizedValue = result.value;
      valid = result.valid;
    }

    if (!valid) {
      fieldIssues.push(issue('invalid_field_format', invalidSeverity, field));
    }

    const oldValue = nextData[field] ?? null;
    const newValue = normalizedValue ?? null;
    if (String(oldValue ?? '') !== String(newValue ?? '')) {
      changedFields.push({ field, from: oldValue, to: newValue });
    }
    nextData[field] = newValue;
  }

  return { nextData, fieldIssues, changedFields };
}

function generateStructuralIssues(candidateData, entityType, options = {}) {
  const requiredFields = REQUIRED_FIELDS_BY_ENTITY[entityType] || [];
  const issues = [];
  for (const field of requiredFields) {
    const value = candidateData?.[field];
    if (
      entityType === 'guardian_link'
      && field === 'guardian_phone'
      && normalizeString(candidateData?.guardian_email)
    ) {
      continue;
    }
    if (value === null || value === undefined || value === '') {
      issues.push(issue('missing_required_field', 'blocker', field));
    }
  }
  if (entityType === 'guardian_link') {
    const hasGuardianPhone = hasValidPhone(candidateData?.guardian_phone);
    const hasGuardianEmail = Boolean(normalizeString(candidateData?.guardian_email));
    if (!hasGuardianPhone && !hasGuardianEmail && !issues.some((item) => item.field === 'guardian_phone')) {
      issues.push(issue('missing_required_field', 'blocker', 'guardian_phone'));
    }
  }
  const isStudentEntity = entityType === 'customer' && candidateData?.customer_type === 'student';
  if (isStudentEntity) {
    // Require a valid phone on the student profile or a related guardian path.
    const hasStudentPhone = hasValidPhone(candidateData?.phone);
    if (!hasStudentPhone && !options.hasRelatedGuardianContact) {
      issues.push(issue('missing_contact_path', 'blocker', 'phone'));
    }
  }
  return issues;
}

function isRelatedGuardianContactCandidate(customerContext, guardianCandidate) {
  if (!guardianCandidate || normalizeString(guardianCandidate.status) === 'skipped') return false;
  const hasGuardianContact = hasValidPhone(guardianCandidate.candidate_data?.guardian_phone)
    || Boolean(normalizeString(guardianCandidate.candidate_data?.guardian_email));
  if (!hasGuardianContact) return false;
  if (customerContext.sourceRowId && guardianCandidate.source_row_id === customerContext.sourceRowId) return true;
  return Boolean(
    customerContext.identityNumber
    && normalizeString(guardianCandidate.candidate_data?.identity_number) === customerContext.identityNumber
  );
}

async function hasRelatedGuardianContactForCustomer(supabase, orgId, { workspaceId, candidateId, sourceRowId, candidateData, extraGuardianCandidate = null }) {
  const identityNumber = normalizeString(candidateData?.identity_number);
  const customerContext = { sourceRowId, identityNumber };
  if (isRelatedGuardianContactCandidate(customerContext, extraGuardianCandidate)) return true;

  const { data, error } = await withOrgScope(supabase, 'import_candidates', orgId)
    .select('id, source_row_id, entity_type, candidate_data, status')
    .eq('workspace_id', workspaceId)
    .in('entity_type', ['guardian', 'guardian_link']);
  if (error) throw error;

  return (data || []).some((candidate) => {
    if (candidate.id === candidateId || normalizeString(candidate.status) === 'skipped') return false;
    return isRelatedGuardianContactCandidate(customerContext, candidate);
  });
}

// Fields the review UI (queue rows + drawer tabs) renders. Cross-candidate
// refreshes return rows with this shape so the client can patch its caches
// locally instead of refetching the workspace (Approach A).
const AFFECTED_CANDIDATE_SELECT = 'id, entity_type, status, candidate_data, issues, blocking_issues_count, decisions, source_row_id, merged_from_row_ids, updated_at';

async function recomputeCustomerContactIssue(supabase, orgId, customerCandidate, options = {}) {
  const data = customerCandidate?.candidate_data || {};
  const existingIssues = Array.isArray(customerCandidate?.issues) ? customerCandidate.issues : [];
  const withoutContactIssue = existingIssues.filter((item) => item?.code !== 'missing_contact_path');
  const hasRelatedGuardianContact = await hasRelatedGuardianContactForCustomer(supabase, orgId, {
    workspaceId: customerCandidate.workspace_id,
    candidateId: customerCandidate.id,
    sourceRowId: customerCandidate.source_row_id,
    candidateData: data,
    extraGuardianCandidate: options.extraGuardianCandidate || null,
  });

  const shouldBlockForContact = data.customer_type === 'student'
    && !hasValidPhone(data.phone)
    && !hasRelatedGuardianContact;
  const nextIssues = shouldBlockForContact
    ? [...withoutContactIssue, issue('missing_contact_path', 'blocker', 'phone')]
    : withoutContactIssue;
  const blockingCount = countBlockingIssues(nextIssues);

  const updates = {
    issues: nextIssues,
    blocking_issues_count: blockingCount,
    updated_at: new Date().toISOString(),
  };
  if (!['committed', 'skipped'].includes(normalizeString(customerCandidate.status))) {
    updates.status = blockingCount > 0 ? 'blocked' : 'ready';
  }

  const { data: updatedRow, error } = await withOrgScope(supabase, 'import_candidates', orgId)
    .update(updates)
    .eq('id', customerCandidate.id)
    .select(AFFECTED_CANDIDATE_SELECT)
    .single();
  if (error) throw error;
  return updatedRow;
}

async function refreshRelatedCustomerContactIssues(supabase, orgId, guardianCandidate) {
  const identityNumber = normalizeString(guardianCandidate?.candidate_data?.identity_number);
  const query = withOrgScope(supabase, 'import_candidates', orgId)
    .select('id, workspace_id, source_row_id, entity_type, status, candidate_data, issues')
    .eq('workspace_id', guardianCandidate.workspace_id)
    .eq('entity_type', 'customer');

  const { data, error } = await query;
  if (error) throw error;

  const relatedCustomers = (data || []).filter((candidate) => (
    candidate.source_row_id === guardianCandidate.source_row_id
    || (
      identityNumber
      && normalizeString(candidate.candidate_data?.identity_number) === identityNumber
    )
  ));

  const affected = [];
  for (const customerCandidate of relatedCustomers) {
    const row = await recomputeCustomerContactIssue(supabase, orgId, customerCandidate, {
      extraGuardianCandidate: guardianCandidate,
    });
    if (row) affected.push(row);
  }
  return affected;
}

function isTruthyPrimary(value) {
  if (value === true) return true;
  const normalized = normalizeString(value).toLowerCase();
  return ['true', '1', 'yes', 'כן', 'y'].includes(normalized);
}

async function refreshGuardianPrimaryIssues(supabase, orgId, workspaceId, options = {}) {
  const overrideCandidate = options.overrideCandidate || null;
  const identityNumber = normalizeString(
    options.identityNumber
    || overrideCandidate?.candidate_data?.identity_number
    || overrideCandidate?.candidateData?.identity_number,
  );
  if (!identityNumber) return [];

  const { data, error } = await withOrgScope(supabase, 'import_candidates', orgId)
    .select('id, status, candidate_data, issues')
    .eq('workspace_id', workspaceId)
    .eq('entity_type', 'guardian_link');
  if (error) throw error;

  const candidates = (data || [])
    .map((candidate) => (
      overrideCandidate?.id === candidate.id
        ? { ...candidate, candidate_data: overrideCandidate.candidate_data, status: overrideCandidate.status || candidate.status }
        : candidate
    ))
    .filter((candidate) => (
      normalizeString(candidate.status) !== 'skipped'
      && normalizeString(candidate.candidate_data?.identity_number) === identityNumber
    ));
  const primaryCount = candidates.filter((candidate) => isTruthyPrimary(candidate.candidate_data?.is_primary)).length;
  const needsIssue = candidates.length >= 2 && primaryCount !== 1;

  const affected = [];
  for (const candidate of candidates) {
    const existingIssues = Array.isArray(candidate.issues) ? candidate.issues : [];
    const withoutPrimaryIssue = existingIssues.filter((item) => item?.code !== 'guardian_primary_contact_required');
    const nextIssues = needsIssue
      ? [...withoutPrimaryIssue, issue('guardian_primary_contact_required', 'blocker', 'is_primary')]
      : withoutPrimaryIssue;
    const blockingCount = countBlockingIssues(nextIssues);
    const updates = {
      issues: nextIssues,
      blocking_issues_count: blockingCount,
      updated_at: new Date().toISOString(),
    };
    if (!['committed', 'skipped'].includes(normalizeString(candidate.status))) {
      updates.status = blockingCount > 0 ? 'blocked' : 'ready';
    }
    const { data: updatedRow, error: updateError } = await withOrgScope(supabase, 'import_candidates', orgId)
      .update(updates)
      .eq('id', candidate.id)
      .select(AFFECTED_CANDIDATE_SELECT)
      .single();
    if (updateError) throw updateError;
    if (updatedRow) affected.push(updatedRow);
  }
  return affected;
}

// Duplicate flags are cross-candidate: whether candidate B is flagged depends on
// candidate A. So when A's identity changes (or A is skipped/un-skipped), the
// SIBLINGS that shared A's old/new identity must be re-checked too — otherwise B
// keeps a stale duplicate_identity_* flag until it is edited itself. Strictly
// scoped to the same org (withOrgScope) and workspace, and reuses
// generateDuplicateIssues so the rule stays identical to first-pass analysis.
async function refreshRelatedDuplicateIssues(supabase, orgId, workspaceId, identityNumbers, excludeCandidateId) {
  const targets = [...new Set((identityNumbers || []).map(normalizeString).filter(Boolean))];
  if (!workspaceId || targets.length === 0) return;

  const { data, error } = await withOrgScope(supabase, 'import_candidates', orgId)
    .select('id, status, candidate_data, issues, decisions')
    .eq('workspace_id', workspaceId)
    .eq('entity_type', 'customer');
  if (error) throw error;

  const DUPLICATE_CODES = new Set(['duplicate_identity_number', 'duplicate_identity_in_file']);
  const siblings = (data || []).filter((candidate) => (
    candidate.id !== excludeCandidateId
    && targets.includes(normalizeString(candidate.candidate_data?.identity_number))
  ));

  const affected = [];
  for (const sibling of siblings) {
    // Recompute only the identity-duplicate codes; leave every other issue (email
    // duplicate, missing fields, format) and the sibling's own decisions intact.
    const freshDuplicateIssues = (await generateDuplicateIssues(
      supabase,
      orgId,
      sibling.candidate_data,
      sibling.decisions,
      { workspaceId, candidateId: sibling.id, entityType: 'customer' },
    )).filter((iss) => DUPLICATE_CODES.has(iss.code));

    const existingIssues = Array.isArray(sibling.issues) ? sibling.issues : [];
    const nextIssues = [
      ...existingIssues.filter((iss) => !DUPLICATE_CODES.has(iss?.code)),
      ...freshDuplicateIssues,
    ];
    const blockingCount = countBlockingIssues(nextIssues);
    const updates = {
      issues: nextIssues,
      blocking_issues_count: blockingCount,
      updated_at: new Date().toISOString(),
    };
    if (!['committed', 'skipped'].includes(normalizeString(sibling.status))) {
      updates.status = blockingCount > 0 ? 'blocked' : 'ready';
    }
    const { data: updatedRow, error: updateError } = await withOrgScope(supabase, 'import_candidates', orgId)
      .update(updates)
      .eq('id', sibling.id)
      .select(AFFECTED_CANDIDATE_SELECT)
      .single();
    if (updateError) throw updateError;
    if (updatedRow) affected.push(updatedRow);
  }
  return affected;
}

async function generateDuplicateIssues(supabase, orgId, candidateData, decisions, { workspaceId, candidateId, entityType } = {}) {
  const issues = [];
  // Only the customer entity creates a client_profile, so it is the only one whose
  // identity_number can be a duplicate. For guardian_link the identity_number is a
  // *reference* to an existing student and must never be flagged. Mirrors the entity
  // gating in import-workspaces-analyze-chunk.
  if (entityType !== 'customer') return issues;

  const identityNumber = normalizeString(candidateData?.identity_number);
  const email = normalizeString(candidateData?.email);

  // DB duplicate — only cleared by skip / link_to_existing.
  if (identityNumber && !hasResolvedDuplicateIdentityDecision(decisions)) {
    const { data, error } = await withOrgScope(supabase, 'client_profiles', orgId)
      .select('id, first_name, middle_name, last_name')
      .eq('identity_number', identityNumber)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) {
      const duplicateName = compactName([data.first_name, data.middle_name, data.last_name]);
      issues.push(issue('duplicate_identity_number', 'blocker', 'identity_number', {
        existing_client_profile_id: data.id,
        duplicate_name: duplicateName,
      }));
    }
  }

  // In-file duplicate — also cleared by create_as_new ("keep this copy"). The user
  // picks which copy to keep; commit de-duplicates so only one client is created.
  if (identityNumber && workspaceId && !hasResolvedInFileDuplicateDecision(decisions)) {
    const { data: importCandidates, error: importError } = await withOrgScope(supabase, 'import_candidates', orgId)
      .select('id, candidate_data, status')
      .eq('workspace_id', workspaceId)
      .eq('entity_type', 'customer');
    if (importError) throw importError;
    const duplicateNames = (importCandidates || [])
      .filter((candidate) => (
        candidate.id !== candidateId
        && normalizeString(candidate.status) !== 'skipped'
        && normalizeString(candidate.candidate_data?.identity_number) === identityNumber
      ))
      .map((candidate) => candidateDisplayName(candidate.candidate_data))
      .filter(Boolean);
    const hasImportDuplicate = (importCandidates || []).some((candidate) => (
      candidate.id !== candidateId
      && normalizeString(candidate.status) !== 'skipped'
      && normalizeString(candidate.candidate_data?.identity_number) === identityNumber
    ));
    if (hasImportDuplicate) {
      issues.push(issue('duplicate_identity_in_file', 'blocker', 'identity_number', {
        duplicate_names: [...new Set(duplicateNames)],
      }));
    }
  }

  if (email) {
    const { data, error } = await withOrgScope(supabase, 'client_profiles', orgId)
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) {
      issues.push(issue('duplicate_email', 'warning', 'email', {
        existing_client_profile_id: data.id,
      }));
    }
  }

  return issues;
}

export default async function importCandidates(context, req) {
  const env = readEnv(context);

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const supabase = createSingleClient(env);
  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (err) {
    context.log?.error?.('import-candidates: auth failed', { message: err?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  const userId = authResult.data.user.id;

  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  attachErrorTracking(context, req, supabase, {
    orgId,
    userId,
    metadata: { endpoint: 'import-candidates' },
  });

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (err) {
    context.log?.error?.('import-candidates: membership check failed', { message: err?.message });
    return respondCandidatesError(context, 500, 'failed_to_verify_membership', err, { action: 'verify_membership' });
  }
  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }
  if (!isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const method = req.method?.toUpperCase();

  // ── GET: list candidates (with optional filters) OR relations view ──────────
  if (method === 'GET') {
    const workspaceId = normalizeUuid(req.query?.workspace_id);
    if (!workspaceId) {
      return respond(context, 400, { message: 'workspace_id_required' });
    }

    // ── view=relations: one-pass connected-components grouping ──────────────
    if (normalizeString(req.query?.view) === 'relations') {
      // Load EVERY candidate in the workspace. A single query is capped at the
      // PostgREST max-rows limit (1000), which silently drops members of large
      // imports — an orphaned guardian_link with no guardian is the tell. Page
      // through with .range() (same pattern as analyze-chunk) so the union-find
      // sees the whole graph and no family member is left behind.
      const RELATIONS_PAGE = 1000;
      const allCandidates = [];
      for (let from = 0; ; from += RELATIONS_PAGE) {
        const { data: pageRows, error: allError } = await withOrgScope(supabase, 'import_candidates', orgId)
          .select('id, entity_type, status, candidate_data, issues, blocking_issues_count, decisions, source_row_id, merged_from_row_ids, depends_on_candidate_id, created_at, updated_at')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: true })
          .range(from, from + RELATIONS_PAGE - 1);

        if (allError) {
          context.log?.error?.('import-candidates: relations load failed', { message: allError.message });
          return respondCandidatesError(context, 500, 'failed_to_load_relations', allError, { action: 'load_relations' });
        }

        allCandidates.push(...(pageRows || []));
        if (!pageRows || pageRows.length < RELATIONS_PAGE) break;
      }

      const allCandidatesClean = allCandidates.map(normalizeRelatedCandidate);
      const { groups } = buildRelationGroups(allCandidatesClean);

      // Build response: one entry per group, members split by entity_type
      const candidateById = new Map(allCandidatesClean.map((c) => [c.id, c]));
      const responseGroups = [];
      for (const [groupId, { memberIds, group_key }] of groups) {
        const members = memberIds.map((id) => candidateById.get(id)).filter(Boolean);
        responseGroups.push({
          id: groupId,
          group_key,
          customer: members.filter((m) => m.entity_type === 'customer'),
          guardian: members.filter((m) => m.entity_type === 'guardian'),
          guardian_link: members.filter((m) => m.entity_type === 'guardian_link'),
        });
      }

      return respond(context, 200, { groups: responseGroups });
    }

    // ── Normal paginated list (no related_candidates embedding) ────────────
    const entityType = normalizeString(req.query?.entity_type);
    const status = normalizeString(req.query?.status);
    const sourceReference = normalizeString(req.query?.source_reference);
    const page = Math.max(1, Number.parseInt(req.query?.page || '1', 10));

    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const selectColumns = sourceReference
      ? 'id, entity_type, status, candidate_data, issues, blocking_issues_count, decisions, source_row_id, merged_from_row_ids, depends_on_candidate_id, created_at, updated_at, import_rows!inner(source_reference)'
      : 'id, entity_type, status, candidate_data, issues, blocking_issues_count, decisions, source_row_id, merged_from_row_ids, depends_on_candidate_id, created_at, updated_at';

    let query = withOrgScope(supabase, 'import_candidates', orgId)
      .select(selectColumns, { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
      .range(from, to);

    if (sourceReference) {
      query = query.eq('import_rows.source_reference', sourceReference);
    }
    if (entityType && ALLOWED_ENTITY_TYPES.has(entityType)) {
      query = query.eq('entity_type', entityType);
    }
    if (status && ALLOWED_CANDIDATE_STATUSES.has(status)) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;

    if (error) {
      context.log?.error?.('import-candidates: list failed', { message: error.message });
      return respondCandidatesError(context, 500, 'failed_to_list_candidates', error, { action: 'list' });
    }

    const candidates = (data || []).map((candidate) => normalizeRelatedCandidate(candidate));

    return respond(context, 200, {
      candidates,
      total: count ?? 0,
      page,
      pageSize: PAGE_SIZE,
    });
  }

  // ── POST: create a missing guardian_link candidate from related rows ───────
  if (method === 'POST') {
    const workspaceId = normalizeUuid(body?.workspace_id || req.query?.workspace_id);
    const customerCandidateId = normalizeUuid(body?.customer_candidate_id);
    const guardianCandidateId = normalizeUuid(body?.guardian_candidate_id);
    if (!workspaceId) {
      return respond(context, 400, { message: 'workspace_id_required' });
    }
    if (!customerCandidateId || !guardianCandidateId) {
      return respond(context, 400, { message: 'customer_and_guardian_candidates_required' });
    }

    const { data: sourceCandidates, error: sourceError } = await withOrgScope(supabase, 'import_candidates', orgId)
      .select('id, workspace_id, source_row_id, entity_type, candidate_data, status')
      .eq('workspace_id', workspaceId)
      .in('id', [customerCandidateId, guardianCandidateId]);
    if (sourceError) {
      context.log?.error?.('import-candidates: missing relation source load failed', { message: sourceError.message });
      return respondCandidatesError(context, 500, 'failed_to_create_relation_candidate', sourceError, { action: 'load_relation_sources' });
    }

    const customer = (sourceCandidates || []).find((candidate) => candidate.id === customerCandidateId && candidate.entity_type === 'customer');
    const guardian = (sourceCandidates || []).find((candidate) => candidate.id === guardianCandidateId && candidate.entity_type === 'guardian');
    if (!customer || !guardian) {
      return respond(context, 400, { message: 'customer_or_guardian_candidate_not_found' });
    }

    const customerData = customer.candidate_data || {};
    const guardianData = guardian.candidate_data || {};
    const identityNumber = normalizeString(customerData.identity_number || customerData.student_identity_number);
    const guardianPhone = normalizeString(guardianData.guardian_phone);
    const guardianEmail = normalizeString(guardianData.guardian_email);
    const join = customerData.__import?.join || guardianData.__import?.join || null;
    const candidateData = {
      identity_number: identityNumber || null,
      guardian_phone: guardianPhone || null,
      guardian_email: guardianEmail || null,
      relationship: normalizeString(body?.relationship) || null,
      is_primary: typeof body?.is_primary === 'boolean' ? body.is_primary : null,
      ...(join ? { __import: { join } } : {}),
    };
    const importKey = buildGuardianLinkImportKey(candidateData, `${customer.id}:${guardian.id}`);

    const nextIssues = generateStructuralIssues(candidateData, 'guardian_link');
    const blockingCount = countBlockingIssues(nextIssues);
    const now = new Date().toISOString();
    const payload = {
      org_id: orgId,
      workspace_id: workspaceId,
      source_row_id: customer.source_row_id || guardian.source_row_id,
      import_key: importKey,
      entity_type: 'guardian_link',
      status: blockingCount > 0 ? 'blocked' : 'ready',
      candidate_data: candidateData,
      merged_from_row_ids: [customer.source_row_id, guardian.source_row_id].filter(Boolean),
      issues: nextIssues,
      blocking_issues_count: blockingCount,
      decisions: {
        created_from_drawer: true,
        customer_candidate_id: customer.id,
        guardian_candidate_id: guardian.id,
        created_by: userId,
        created_at: now,
      },
      updated_at: now,
    };

    const { data: created, error: createError } = await withOrgScope(supabase, 'import_candidates', orgId)
      .upsert(payload, { onConflict: 'workspace_id,entity_type,import_key' })
      .select('id, entity_type, status, candidate_data, issues, blocking_issues_count, decisions, source_row_id, merged_from_row_ids, updated_at')
      .single();
    if (createError || !created) {
      context.log?.error?.('import-candidates: missing relation create failed', { message: createError?.message });
      return respondCandidatesError(context, 500, 'failed_to_create_relation_candidate', createError || new Error('missing_created_candidate'), {
        action: 'create_relation_candidate',
      });
    }

    try {
      await refreshGuardianPrimaryIssues(supabase, orgId, workspaceId, {
        overrideCandidate: {
          ...created,
          candidate_data: created.candidate_data,
        },
      });
      const { data: refreshed, error: refreshError } = await withOrgScope(supabase, 'import_candidates', orgId)
        .select('id, entity_type, status, candidate_data, issues, blocking_issues_count, decisions, source_row_id, merged_from_row_ids, updated_at')
        .eq('id', created.id)
        .single();
      if (refreshError) throw refreshError;
      return respond(context, 200, { candidate: normalizeRelatedCandidate(refreshed || created) });
    } catch (err) {
      context.log?.error?.('import-candidates: missing relation refresh failed', { message: err?.message });
      return respondCandidatesError(context, 500, 'failed_to_create_relation_candidate', err, { action: 'refresh_created_relation' });
    }
  }

  // ── PATCH: update decisions and/or status on a specific candidate ────────────
  if (method === 'PATCH') {
    const candidateId = normalizeUuid(req.params?.candidateId);
    if (!candidateId) {
      return respond(context, 400, { message: 'candidate_id_required' });
    }

    // Fetch existing record first so we can merge decisions and preserve provenance.
    const { data: existing, error: fetchErr } = await withOrgScope(supabase, 'import_candidates', orgId)
      .select('id, workspace_id, source_row_id, entity_type, candidate_data, decisions, status, issues')
      .eq('id', candidateId)
      .single();

    if (fetchErr || !existing) {
      return respond(context, 404, { message: 'candidate_not_found' });
    }

    const updates = {};
    // Rows the server also corrects as a side effect of this edit (siblings). They
    // ride back on the response so the client patches its caches locally (Approach A)
    // instead of refetching the workspace.
    const affectedCandidates = [];
    let nextDecisions = existing.decisions && typeof existing.decisions === 'object'
      ? { ...existing.decisions }
      : {};

    // Merge decision patch into existing decisions (non-destructive)
    if (body?.decisions_patch && typeof body.decisions_patch === 'object') {
      nextDecisions = { ...nextDecisions, ...body.decisions_patch };
      updates.decisions = nextDecisions;
      const clearedCodes = new Set();
      if (shouldClearDuplicateIdentityIssue(body.decisions_patch)) clearedCodes.add('duplicate_identity_number');
      if (shouldClearInFileDuplicateIssue(body.decisions_patch)) clearedCodes.add('duplicate_identity_in_file');
      if (clearedCodes.size > 0) {
        const filteredIssues = (Array.isArray(existing.issues) ? existing.issues : [])
          .filter((issue) => !clearedCodes.has(issue?.code));
        updates.issues = filteredIssues;
        updates.blocking_issues_count = countBlockingIssues(filteredIssues);
      }
    }

    if (body?.candidate_data_patch !== undefined) {
      if (!isPlainObject(body.candidate_data_patch)) {
        return respond(context, 400, { message: 'candidate_data_patch_must_be_object' });
      }
      if (existing.status === 'committed') {
        return respond(context, 409, { message: 'candidate_already_committed' });
      }

      const { data: workspace, error: workspaceError } = await withOrgScope(supabase, 'import_workspaces', orgId)
        .select('id, config')
        .eq('id', existing.workspace_id)
        .maybeSingle();
      if (workspaceError || !workspace) {
        context.log?.error?.('import-candidates: workspace fetch for edit failed', { message: workspaceError?.message });
        return respondCandidatesError(context, 500, 'failed_to_load_workspace', workspaceError || new Error('workspace_not_found'), {
          action: 'load_workspace_for_candidate_edit',
          candidateId,
        });
      }

      const { nextData, fieldIssues, changedFields } = normalizeCandidateDataPatch(
        existing.entity_type,
        existing.candidate_data || {},
        body.candidate_data_patch,
      );

      if (changedFields.length > 0) {
        const now = new Date().toISOString();
        const existingChanges = isPlainObject(nextDecisions.field_changes)
          ? { ...nextDecisions.field_changes }
          : {};
        for (const change of changedFields) {
          const source = normalizeFieldSource(
            workspace.config?.mappings?.entities?.[existing.entity_type]?.field_map?.[change.field],
          );
          existingChanges[change.field] = {
            from: change.from,
            to: change.to,
            source_row_id: existing.source_row_id,
            source_column: source ? `${source.sourceReference} · ${source.column}` : null,
            updated_at: now,
            updated_by: userId,
          };
        }
        nextDecisions = {
          ...nextDecisions,
          field_changes: existingChanges,
        };
      }

      let duplicateIssues = [];
      try {
        duplicateIssues = await generateDuplicateIssues(supabase, orgId, nextData, nextDecisions, {
          workspaceId: existing.workspace_id,
          candidateId: existing.id,
          entityType: existing.entity_type,
        });
      } catch (err) {
        context.log?.error?.('import-candidates: duplicate validation after edit failed', { message: err?.message });
        return respondCandidatesError(context, 500, 'failed_to_validate_candidate_edit', err, {
          action: 'validate_candidate_edit',
          candidateId,
        });
      }

      let hasRelatedGuardianContact = false;
      if (existing.entity_type === 'customer' && nextData.customer_type === 'student') {
        try {
          hasRelatedGuardianContact = await hasRelatedGuardianContactForCustomer(supabase, orgId, {
            workspaceId: existing.workspace_id,
            candidateId: existing.id,
            sourceRowId: existing.source_row_id,
            candidateData: nextData,
          });
        } catch (err) {
          context.log?.error?.('import-candidates: guardian contact validation after edit failed', { message: err?.message });
          return respondCandidatesError(context, 500, 'failed_to_validate_candidate_edit', err, {
            action: 'validate_guardian_contact_path',
            candidateId,
          });
        }
      }

      const nextIssues = [
        ...fieldIssues,
        ...generateStructuralIssues(nextData, existing.entity_type, { hasRelatedGuardianContact }),
        ...duplicateIssues,
      ];
      if (
        existing.entity_type === 'guardian_link'
        && !Object.prototype.hasOwnProperty.call(body.candidate_data_patch, 'is_primary')
        && !Object.prototype.hasOwnProperty.call(body.candidate_data_patch, 'identity_number')
      ) {
        const existingPrimaryIssue = (Array.isArray(existing.issues) ? existing.issues : [])
          .find((item) => item?.code === 'guardian_primary_contact_required');
        if (existingPrimaryIssue) nextIssues.push(existingPrimaryIssue);
      }
      // A required field that is present but invalid must block (we keep the raw
      // value for editing, but an unusable required value can't commit).
      const requiredFields = new Set(REQUIRED_FIELDS_BY_ENTITY[existing.entity_type] || []);
      for (const iss of nextIssues) {
        if (iss.code === 'invalid_field_format' && requiredFields.has(iss.field)) {
          iss.severity = 'blocker';
          iss.is_blocking = true;
        }
      }
      const blockingCount = countBlockingIssues(nextIssues);
      updates.candidate_data = nextData;
      updates.decisions = nextDecisions;
      updates.issues = nextIssues;
      updates.blocking_issues_count = blockingCount;
      updates.status = blockingCount > 0 ? 'blocked' : 'ready';

      if (
        ['guardian', 'guardian_link'].includes(existing.entity_type)
        && (
          Object.prototype.hasOwnProperty.call(body.candidate_data_patch, 'guardian_phone')
          || Object.prototype.hasOwnProperty.call(body.candidate_data_patch, 'guardian_email')
        )
      ) {
        try {
          const contactAffected = await refreshRelatedCustomerContactIssues(supabase, orgId, {
            ...existing,
            candidate_data: nextData,
          });
          affectedCandidates.push(...(contactAffected || []));
        } catch (err) {
          context.log?.error?.('import-candidates: related customer contact refresh failed', { message: err?.message });
          return respondCandidatesError(context, 500, 'failed_to_validate_candidate_edit', err, {
            action: 'refresh_related_customer_contact_issues',
            candidateId,
          });
        }
      }
    }

    // Status update — validate against allowed values
    if (body?.status) {
      const newStatus = normalizeString(body.status);
      if (existing.status === 'committed') {
        return respond(context, 409, { message: 'candidate_already_committed' });
      }
      if (!PATCH_ALLOWED_CANDIDATE_STATUSES.has(newStatus)) {
        return respond(context, 400, { message: 'status_not_allowed' });
      }
      if (newStatus === 'ready') {
        const effectiveIssues = updates.issues || existing.issues || [];
        if (countBlockingIssues(effectiveIssues) > 0) {
          updates.status = 'blocked';
        } else {
          updates.status = newStatus;
        }
      } else {
        updates.status = newStatus;
      }
    }

    if (Object.keys(updates).length === 0) {
      return respond(context, 400, { message: 'no_updates_provided' });
    }

    updates.updated_at = new Date().toISOString();

    const { data: updated, error: updateErr } = await withOrgScope(supabase, 'import_candidates', orgId)
      .update(updates)
      .eq('id', candidateId)
      .select('id, entity_type, status, candidate_data, issues, blocking_issues_count, decisions, source_row_id, merged_from_row_ids, updated_at')
      .single();

    if (updateErr) {
      context.log?.error?.('import-candidates: patch failed', { message: updateErr.message });
      return respondCandidatesError(context, 500, 'failed_to_patch_candidate', updateErr, { action: 'patch', candidateId });
    }

    // Cross-candidate duplicate flags can now be stale on OTHER candidates: fixing
    // this customer's identity (or skipping it) may resolve a sibling's
    // duplicate_identity_* flag. Re-validate the siblings that shared the old/new
    // identity. Runs AFTER the save so generateDuplicateIssues reads this
    // candidate's new state; scoped to this workspace + org only.
    if (existing.entity_type === 'customer') {
      const identityBefore = normalizeString(existing.candidate_data?.identity_number);
      const identityAfter = normalizeString(updated.candidate_data?.identity_number);
      const skipChanged = (normalizeString(existing.status) === 'skipped')
        !== (normalizeString(updated.status) === 'skipped');
      if (identityBefore !== identityAfter || skipChanged) {
        try {
          const dupAffected = await refreshRelatedDuplicateIssues(
            supabase,
            orgId,
            existing.workspace_id,
            [identityBefore, identityAfter],
            candidateId,
          );
          affectedCandidates.push(...(dupAffected || []));
        } catch (err) {
          context.log?.error?.('import-candidates: related duplicate refresh after edit failed', { message: err?.message });
          return respondCandidatesError(context, 500, 'failed_to_validate_candidate_edit', err, {
            action: 'refresh_related_duplicate_issues',
            candidateId,
          });
        }
      }
    }

    let candidateForResponse = updated;
    if (
      updated.entity_type === 'guardian_link'
      && (
        Object.prototype.hasOwnProperty.call(body?.candidate_data_patch || {}, 'is_primary')
        || Object.prototype.hasOwnProperty.call(body?.candidate_data_patch || {}, 'identity_number')
      )
    ) {
      try {
        const primaryAffected = await refreshGuardianPrimaryIssues(supabase, orgId, existing.workspace_id, {
          overrideCandidate: {
            ...updated,
            candidate_data: updated.candidate_data,
          },
        });
        affectedCandidates.push(...(primaryAffected || []));
        const { data: refreshed, error: refreshFetchError } = await withOrgScope(supabase, 'import_candidates', orgId)
          .select('id, entity_type, status, candidate_data, issues, blocking_issues_count, decisions, source_row_id, merged_from_row_ids, updated_at')
          .eq('id', candidateId)
          .single();
        if (refreshFetchError) throw refreshFetchError;
        candidateForResponse = refreshed || updated;
      } catch (err) {
        context.log?.error?.('import-candidates: guardian primary validation after edit failed', { message: err?.message });
        return respondCandidatesError(context, 500, 'failed_to_validate_candidate_edit', err, {
          action: 'validate_guardian_primary_contact',
          candidateId,
        });
      }
    }

    // Dedupe the side-effected rows and exclude the edited candidate (already
    // returned as `candidate`). The client merges these into its queue + relations
    // caches with no extra fetch.
    const affectedById = new Map();
    for (const row of affectedCandidates) {
      if (row?.id && row.id !== candidateId) affectedById.set(row.id, normalizeRelatedCandidate(row));
    }

    return respond(context, 200, {
      candidate: normalizeRelatedCandidate(candidateForResponse),
      affected_candidates: [...affectedById.values()],
    });
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
