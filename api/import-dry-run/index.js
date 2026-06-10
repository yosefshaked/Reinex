/* eslint-env node */
/**
 * import-dry-run — POST /api/import-workspaces/:id/dry-run/chunk
 *
 * Simulation engine: reads live tables (read-only) and writes dry_run_summary
 * into import_candidates.candidate_data. No live table is ever mutated.
 *
 * Body: { candidate_ids: string[], org_id: string }
 * Returns: { results: [{ candidate_id, outcome, ... }], processed: number }
 *
 * Safety invariant:
 *   - Reads from: client_profiles, students, guardians, "Services", import_candidates
 *   - Writes to:  import_candidates.candidate_data (dry_run_summary key only)
 *   - Never writes to: client_profiles, students, guardians, or any other live table
 */
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
import {
  findClientProfileByIdentityNumber,
} from '../_shared/client-profiles.js';
import { coerceIdentityNumber, validateIsraeliPhone, coerceEmail } from '../_shared/student-validation.js';

const MAX_CANDIDATES_PER_CALL = 50;

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function nowIso() {
  return new Date().toISOString();
}

// ─── Per-entity simulators (all read-only for live tables) ─────────────────

async function simulateClientProfile(supabase, orgId, candidateData) {
  const rawIdentity = normalizeString(
    candidateData?.identity_number ?? candidateData?.student_identity_number,
  );
  const identityResult = coerceIdentityNumber(rawIdentity);

  if (identityResult.valid && identityResult.value) {
    const { data: existing, error } = await findClientProfileByIdentityNumber(
      supabase, identityResult.value, { orgId },
    );
    if (error) {
      return {
        outcome: 'error',
        action_description: 'שגיאה בבדיקת פרופיל קיים',
        target_table: 'client_profiles',
        matched_record_id: null,
        matched_record_summary: null,
        fields_that_would_change: [],
        simulated_at: nowIso(),
      };
    }
    if (existing?.id) {
      const fieldsChanged = [];
      if (!normalizeString(existing.phone) && normalizeString(candidateData?.phone)) {
        fieldsChanged.push('phone');
      }
      if (!normalizeString(existing.email) && normalizeString(candidateData?.email)) {
        fieldsChanged.push('email');
      }
      if (!existing.tags?.length && Array.isArray(candidateData?.tags) && candidateData.tags.length) {
        fieldsChanged.push('tags');
      }

      return {
        outcome: fieldsChanged.length ? 'update' : 'reuse_existing',
        action_description: fieldsChanged.length
          ? `עדכון פרופיל קיים (${fieldsChanged.join(', ')})`
          : 'שימוש חוזר בפרופיל קיים ללא שינויים',
        target_table: 'client_profiles',
        matched_record_id: existing.id,
        matched_record_summary: {
          name: [existing.first_name, existing.last_name].filter(Boolean).join(' '),
          identity_number: existing.identity_number,
        },
        fields_that_would_change: fieldsChanged,
        simulated_at: nowIso(),
      };
    }
  }

  return {
    outcome: 'create',
    action_description: 'יצירת פרופיל לקוח חדש',
    target_table: 'client_profiles',
    matched_record_id: null,
    matched_record_summary: null,
    fields_that_would_change: [],
    simulated_at: nowIso(),
  };
}

async function simulateGuardian(supabase, orgId, candidateData) {
  const phoneResult = validateIsraeliPhone(candidateData?.phone);
  const emailResult = coerceEmail(candidateData?.email);

  let existing = null;

  if (phoneResult.valid && phoneResult.value) {
    const { data, error } = await withOrgScope(supabase, 'guardians', orgId)
      .select('id, first_name, last_name, phone, email')
      .eq('phone', phoneResult.value)
      .limit(1)
      .maybeSingle();
    if (!error && data) existing = data;
  }

  if (!existing && emailResult.valid && emailResult.value) {
    const { data, error } = await withOrgScope(supabase, 'guardians', orgId)
      .select('id, first_name, last_name, phone, email')
      .eq('email', emailResult.value)
      .limit(1)
      .maybeSingle();
    if (!error && data) existing = data;
  }

  if (existing?.id) {
    const fieldsChanged = [];
    if (!normalizeString(existing.phone) && phoneResult.value) fieldsChanged.push('phone');
    if (!normalizeString(existing.email) && emailResult.value) fieldsChanged.push('email');

    return {
      outcome: fieldsChanged.length ? 'update' : 'reuse_existing',
      action_description: fieldsChanged.length
        ? `עדכון הורה קיים (${fieldsChanged.join(', ')})`
        : 'שימוש חוזר בהורה קיים ללא שינויים',
      target_table: 'guardians',
      matched_record_id: existing.id,
      matched_record_summary: {
        name: [existing.first_name, existing.last_name].filter(Boolean).join(' '),
        phone: existing.phone,
      },
      fields_that_would_change: fieldsChanged,
      simulated_at: nowIso(),
    };
  }

  return {
    outcome: 'create',
    action_description: 'יצירת הורה חדש',
    target_table: 'guardians',
    matched_record_id: null,
    matched_record_summary: null,
    fields_that_would_change: [],
    simulated_at: nowIso(),
  };
}

async function simulateGuardianLink(supabase, orgId, candidateData) {
  // Resolve student side
  const studentIdentity = normalizeString(
    candidateData?.student_identity_number ?? candidateData?.student_identity,
  );
  const guardianPhone = normalizeString(candidateData?.guardian_phone ?? candidateData?.phone);

  const studentIdentityResult = coerceIdentityNumber(studentIdentity);
  let studentProfile = null;
  let guardianRecord = null;

  if (studentIdentityResult.valid && studentIdentityResult.value) {
    const { data } = await findClientProfileByIdentityNumber(
      supabase, studentIdentityResult.value, { orgId },
    );
    studentProfile = data || null;
  }

  const phoneResult = validateIsraeliPhone(guardianPhone);
  if (phoneResult.valid && phoneResult.value) {
    const { data } = await withOrgScope(supabase, 'guardians', orgId)
      .select('id, first_name, last_name, phone')
      .eq('phone', phoneResult.value)
      .limit(1)
      .maybeSingle();
    guardianRecord = data || null;
  }

  if (!studentProfile) {
    return {
      outcome: 'blocked',
      action_description: 'תלמיד/ה לא נמצא בפרופילי לקוח — לא ניתן לקשר',
      target_table: 'client_guardians',
      matched_record_id: null,
      matched_record_summary: null,
      fields_that_would_change: [],
      simulated_at: nowIso(),
    };
  }

  if (!guardianRecord) {
    return {
      outcome: 'blocked',
      action_description: 'הורה לא נמצא — קישור ידרוש יצירת הורה תחילה',
      target_table: 'client_guardians',
      matched_record_id: null,
      matched_record_summary: null,
      fields_that_would_change: [],
      simulated_at: nowIso(),
    };
  }

  // Check if link already exists
  const { data: existingLink } = await withOrgScope(supabase, 'client_guardians', orgId)
    .select('id')
    .eq('client_profile_id', studentProfile.id)
    .eq('guardian_id', guardianRecord.id)
    .limit(1)
    .maybeSingle();

  if (existingLink?.id) {
    return {
      outcome: 'noop',
      action_description: 'קישור הורה-תלמיד כבר קיים',
      target_table: 'client_guardians',
      matched_record_id: existingLink.id,
      matched_record_summary: {
        student_name: [studentProfile.first_name, studentProfile.last_name].filter(Boolean).join(' '),
        guardian_name: [guardianRecord.first_name, guardianRecord.last_name].filter(Boolean).join(' '),
      },
      fields_that_would_change: [],
      simulated_at: nowIso(),
    };
  }

  return {
    outcome: 'create',
    action_description: 'יצירת קישור הורה-תלמיד',
    target_table: 'client_guardians',
    matched_record_id: null,
    matched_record_summary: {
      student_name: [studentProfile.first_name, studentProfile.last_name].filter(Boolean).join(' '),
      guardian_name: [guardianRecord.first_name, guardianRecord.last_name].filter(Boolean).join(' '),
    },
    fields_that_would_change: [],
    simulated_at: nowIso(),
  };
}

async function simulateService(supabase, orgId, candidateData) {
  const name = normalizeString(candidateData?.name);
  if (!name) {
    return {
      outcome: 'blocked',
      action_description: 'שם שירות חסר',
      target_table: 'Services',
      matched_record_id: null,
      matched_record_summary: null,
      fields_that_would_change: [],
      simulated_at: nowIso(),
    };
  }

  const { data: existing } = await withOrgScope(supabase, '"Services"', orgId)
    .select('id, name, is_active')
    .ilike('name', name)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return {
      outcome: 'reuse_existing',
      action_description: 'שימוש חוזר בשירות קיים',
      target_table: 'Services',
      matched_record_id: existing.id,
      matched_record_summary: { name: existing.name, is_active: existing.is_active },
      fields_that_would_change: [],
      simulated_at: nowIso(),
    };
  }

  return {
    outcome: 'create',
    action_description: 'יצירת שירות חדש',
    target_table: 'Services',
    matched_record_id: null,
    matched_record_summary: null,
    fields_that_would_change: [],
    simulated_at: nowIso(),
  };
}

/**
 * Main simulation dispatcher for a single candidate.
 * @param {object} supabase
 * @param {string} orgId
 * @param {object} candidate  — row from import_candidates
 * @returns {Promise<object>} dry_run_summary
 */
async function simulateCandidate(supabase, orgId, candidate) {
  const { entity_type, candidate_data = {}, decisions = {}, status, blocking_issues_count = 0 } = candidate;

  if (Number(blocking_issues_count || 0) > 0) {
    return {
      outcome: 'blocked',
      is_blocked: true,
      action_description: 'This candidate has unresolved blocking issues.',
      target_table: null,
      matched_record_id: null,
      matched_record_summary: null,
      fields_that_would_change: [],
      simulated_at: nowIso(),
    };
  }

  if (!['ready', 'skipped'].includes(status)) {
    return {
      outcome: 'blocked',
      is_blocked: true,
      action_description: `This candidate is not ready for import. Current status: ${status || 'unknown'}.`,
      target_table: null,
      matched_record_id: null,
      matched_record_summary: null,
      fields_that_would_change: [],
      simulated_at: nowIso(),
    };
  }

  if (entity_type === 'inactive_student') {
    const identity = normalizeString(candidate_data?.identity_number);
    const firstName = normalizeString(candidate_data?.first_name);
    const lastName = normalizeString(candidate_data?.last_name);
    if (!identity || (!firstName && !lastName)) {
      return {
        outcome: 'blocked',
        is_blocked: true,
        action_description: 'This inactive student fails the minimum archive policy: identity number and at least one name are required.',
        target_table: 'client_profiles',
        matched_record_id: null,
        matched_record_summary: null,
        fields_that_would_change: [],
        simulated_at: nowIso(),
      };
    }
  }

  // Short-circuit: already skipped
  if (status === 'skipped' || decisions?.action === 'skip') {
    return {
      outcome: 'skip',
      action_description: 'רשומה מדולגת — לא יבוצע שינוי',
      target_table: null,
      matched_record_id: null,
      matched_record_summary: null,
      fields_that_would_change: [],
      simulated_at: nowIso(),
    };
  }

  // User chose "link to existing" and provided a target id
  if (decisions?.action === 'link_to_existing' && decisions?.linked_id) {
    return {
      outcome: 'link',
      action_description: 'קישור לרשומה קיימת (בחירת משתמש)',
      target_table: null,
      matched_record_id: decisions.linked_id,
      matched_record_summary: null,
      fields_that_would_change: [],
      simulated_at: nowIso(),
    };
  }

  switch (entity_type) {
    case 'active_student':
    case 'inactive_student':
      return simulateClientProfile(supabase, orgId, candidate_data);

    case 'guardian':
      return simulateGuardian(supabase, orgId, candidate_data);

    case 'guardian_link':
      return simulateGuardianLink(supabase, orgId, candidate_data);

    case 'service':
      return simulateService(supabase, orgId, candidate_data);

    case 'student_note':
      return {
        outcome: 'create',
        action_description: 'יצירת הערה חדשה',
        target_table: 'student_notes',
        matched_record_id: null,
        matched_record_summary: null,
        fields_that_would_change: [],
        simulated_at: nowIso(),
      };

    default:
      return {
        outcome: 'noop',
        action_description: `סוג ישות לא מוכר: ${entity_type}`,
        target_table: null,
        matched_record_id: null,
        matched_record_summary: null,
        fields_that_would_change: [],
        simulated_at: nowIso(),
      };
  }
}

// ─── Azure Function handler ─────────────────────────────────────────────────

export default async function importDryRun(context, req) {
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
    context.log?.error?.('import-dry-run: auth failed', { message: err?.message });
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

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (err) {
    context.log?.error?.('import-dry-run: membership check failed', { message: err?.message });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }
  if (!role) return respond(context, 403, { message: 'forbidden' });
  if (!isAdminOrOffice(role)) return respond(context, 403, { message: 'forbidden' });

  const workspaceId = normalizeUuid(req.params?.workspaceId);
  if (!workspaceId) {
    return respond(context, 400, { message: 'workspace_id_required' });
  }

  // Validate body
  const rawIds = body?.candidate_ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return respond(context, 400, { message: 'candidate_ids_required' });
  }
  if (rawIds.length > MAX_CANDIDATES_PER_CALL) {
    return respond(context, 400, {
      message: 'too_many_candidates',
      max: MAX_CANDIDATES_PER_CALL,
    });
  }

  const candidateIds = rawIds
    .map(id => normalizeUuid(String(id ?? '')))
    .filter(Boolean);

  if (candidateIds.length === 0) {
    return respond(context, 400, { message: 'no_valid_candidate_ids' });
  }

  // Verify workspace belongs to org
  const { data: workspace, error: wsError } = await withOrgScope(supabase, 'import_workspaces', orgId)
    .select('id, status')
    .eq('id', workspaceId)
    .maybeSingle();
  if (wsError) {
    context.log?.error?.('import-dry-run: workspace lookup failed', { message: wsError.message });
    return respond(context, 500, { message: 'failed_to_load_workspace' });
  }
  if (!workspace) {
    return respond(context, 404, { message: 'workspace_not_found' });
  }

  // Fetch the requested candidates (org-scoped, workspace-scoped)
  const { data: candidates, error: candidatesError } = await withOrgScope(supabase, 'import_candidates', orgId)
    .select('id, entity_type, status, candidate_data, decisions, issues, blocking_issues_count')
    .eq('workspace_id', workspaceId)
    .in('id', candidateIds);

  if (candidatesError) {
    context.log?.error?.('import-dry-run: fetch candidates failed', { message: candidatesError.message });
    return respond(context, 500, { message: 'failed_to_fetch_candidates' });
  }

  const foundCandidates = candidates ?? [];
  const results = [];

  for (const candidate of foundCandidates) {
    let summary;
    try {
      summary = await simulateCandidate(supabase, orgId, candidate);
    } catch (err) {
      context.log?.error?.('import-dry-run: simulation error', {
        candidateId: candidate.id,
        message: err?.message,
      });
      summary = {
        outcome: 'error',
        action_description: 'שגיאה בסימולציה',
        target_table: null,
        matched_record_id: null,
        matched_record_summary: null,
        fields_that_would_change: [],
        simulated_at: nowIso(),
      };
    }

    // Write dry_run_summary into candidate_data (only mutation allowed in this endpoint)
    const mergedData = {
      ...(candidate.candidate_data ?? {}),
      dry_run_summary: summary,
    };

    const { error: updateError } = await withOrgScope(supabase, 'import_candidates', orgId)
      .update({ candidate_data: mergedData, updated_at: nowIso() })
      .eq('id', candidate.id)
      .eq('workspace_id', workspaceId);

    if (updateError) {
      context.log?.error?.('import-dry-run: failed to save summary', {
        candidateId: candidate.id,
        message: updateError.message,
      });
    }

    results.push({
      candidate_id: candidate.id,
      entity_type: candidate.entity_type,
      outcome: summary.outcome,
      action_description: summary.action_description,
      matched_record_id: summary.matched_record_id,
      fields_that_would_change: summary.fields_that_would_change,
    });
  }

  return respond(context, 200, {
    results,
    processed: results.length,
    workspace_id: workspaceId,
  });
}
