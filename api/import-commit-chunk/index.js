/* eslint-env node */
/**
 * import-commit-chunk — POST /api/import-workspaces/:id/commit/chunk
 *
 * JS-orchestrated commit engine. Calls the same domain helpers used by the rest of the
 * product (createOrReuseClientProfile, ensureStudentForClientProfile, …) so the import
 * follows identical business rules and fill-empty merge logic.
 *
 * Per-row try/catch: a per-row failure does NOT abort the chunk. Failed candidates are
 * marked 'failed' and returned in failures[]; the caller can retry only those IDs.
 *
 * Commit wave order: customer → guardian / service → guardian_link
 *
 * Body:    { candidate_ids: string[], org_id: string }
 * Returns: { committed, failed, workspace_id, results, failures }
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
  createOrReuseClientProfile,
  ensureStudentForClientProfile,
  createOrReuseGuardianByParts,
  upsertClientGuardianLink,
  findClientProfileByIdentityNumber,
} from '../_shared/client-profiles.js';
import { validateIsraeliPhone, coerceEmail, coerceOptionalDate } from '../_shared/student-validation.js';
import { attachErrorTracking, respondTracked } from '../_shared/error-events.js';
import { mergeMetadata } from '../_shared/metadata-utils.js';

const MAX_CANDIDATES_PER_CALL = 25;

const ENTITY_WAVE = {
  customer:      0,
  guardian:      1,
  service:       1,
  guardian_link: 2,
};

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function respondCommitError(context, status, message, error, metadata = {}) {
  return respondTracked(context, status, { message }, undefined, { error, metadata });
}

async function writeLedgerRow(supabase, orgId, workspaceId, candidateId, resourceType, resourceId, actionTaken) {
  const { error } = await withOrgScope(supabase, 'import_commit_ledger', orgId)
    .insert({
      org_id: orgId,
      workspace_id: workspaceId,
      candidate_id: candidateId,
      live_resource_type: resourceType,
      live_resource_id: resourceId,
      action_taken: actionTaken,
    });
  if (error) {
    // Ledger write is best-effort audit; real work already landed — do not abort
  }
}

// ─── Per-entity commit helpers ────────────────────────────────────────────────

async function commitCustomer(supabase, orgId, candidate) {
  const { candidate_data: data = {}, decisions = {} } = candidate;
  const action = normalizeString(decisions?.action);

  const customerType = normalizeString(data?.customer_type);
  if (!customerType || !['student', 'one_time_customer'].includes(customerType)) {
    throw new Error('customer_type_required');
  }

  const isActive = data?.is_active !== false;

  // Optional contact fields are kept raw in candidate_data so a bad value stays
  // visible/editable in review. Re-clean them here before writing: a still-invalid
  // optional value is dropped (null) rather than written to the live table or
  // causing createOrReuseClientProfile's payload validation to reject the whole
  // record. Required fields (names, identity_number) are blocker-validated, so they
  // are already valid by the time a candidate is committable.
  const cleanPhone = validateIsraeliPhone(data.phone);
  const cleanEmail = coerceEmail(data.email);
  const cleanDob = coerceOptionalDate(data.date_of_birth);
  const phone = cleanPhone.valid ? cleanPhone.value : null;
  const email = cleanEmail.valid ? cleanEmail.value : null;
  const dateOfBirth = cleanDob.valid ? cleanDob.value : null;

  let clientProfileId;
  let profileLedgerAction;

  if (action === 'link_to_existing') {
    const linkedId = normalizeUuid(String(decisions.linked_id || ''));
    if (!linkedId) throw new Error('link_to_existing_missing_linked_id');

    // Verify the target profile exists and belongs to this org
    const { data: profile, error: profileError } = await withOrgScope(supabase, 'client_profiles', orgId)
      .select('id, phone, email, date_of_birth')
      .eq('id', linkedId)
      .maybeSingle();
    if (profileError) throw new Error(`failed_to_load_linked_profile:${profileError.message}`);
    if (!profile) throw new Error('linked_profile_not_found');

    // Fill-empty — only populate blank fields; is_active and customer_type are intentionally
    // NOT updated on linked profiles until a future "prefer file" option is added
    const safeUpdates = {};
    if (!profile.phone && phone) safeUpdates.phone = phone;
    if (!profile.email && email) safeUpdates.email = email;
    if (!profile.date_of_birth && dateOfBirth) safeUpdates.date_of_birth = dateOfBirth;

    if (Object.keys(safeUpdates).length) {
      safeUpdates.updated_at = new Date().toISOString();
      const { error: updateError } = await withOrgScope(supabase, 'client_profiles', orgId)
        .update(safeUpdates)
        .eq('id', linkedId);
      if (updateError) throw new Error(`failed_to_fill_linked_profile:${updateError.message}`);
      profileLedgerAction = 'update';
    } else {
      profileLedgerAction = 'link';
    }
    clientProfileId = linkedId;
  } else {
    // Default and create_as_new both go through create-or-reuse.
    // A duplicate_identity_number blocker prevents a candidate from reaching 'ready',
    // so if we arrive here the identity is either unique or the user corrected it.
    const result = await createOrReuseClientProfile(supabase, {
      org_id: orgId,
      first_name: data.first_name,
      last_name: data.last_name,
      identity_number: data.identity_number,
      phone,
      email,
      date_of_birth: dateOfBirth,
      is_active: isActive,
    });
    clientProfileId = result.clientProfileId;
    profileLedgerAction = result.action === 'created' ? 'create' : 'update';
  }

  let studentId = null;
  let studentLedgerAction = null;
  let noteSaved = false;
  if (customerType === 'student') {
    const { student, created, error: studentError } = await ensureStudentForClientProfile(supabase, clientProfileId);
    if (studentError) throw new Error(`failed_to_ensure_student:${studentError}`);
    if (student?.id) {
      studentId = student.id;
      studentLedgerAction = created ? 'create' : 'link';

      const noteText = normalizeString(data.note_text);
      if (noteText) {
        const { data: currentStudent, error: currentStudentError } = await withOrgScope(supabase, 'students', orgId)
          .select('id, notes_internal, metadata')
          .eq('id', student.id)
          .maybeSingle();
        if (currentStudentError) throw new Error(`failed_to_load_student_note:${currentStudentError.message}`);

        const importedNoteCandidates = Array.isArray(currentStudent?.metadata?.import_note_candidate_ids)
          ? currentStudent.metadata.import_note_candidate_ids
          : [];
        if (!importedNoteCandidates.includes(candidate.id)) {
          const existingNotes = normalizeString(currentStudent?.notes_internal);
          const { error: noteError } = await withOrgScope(supabase, 'students', orgId)
            .update({
              notes_internal: existingNotes ? `${existingNotes}\n${noteText}` : noteText,
              metadata: mergeMetadata(currentStudent?.metadata, {
                import_note_candidate_ids: [...importedNoteCandidates, candidate.id],
              }),
              updated_at: new Date().toISOString(),
            })
            .eq('id', student.id);
          if (noteError) throw new Error(`failed_to_save_student_note:${noteError.message}`);
          noteSaved = true;
          if (!created) studentLedgerAction = 'update';
        }
      }
    }
  }

  return { clientProfileId, profileLedgerAction, studentId, studentLedgerAction, noteSaved };
}

async function commitGuardian(supabase, orgId, candidate) {
  const { candidate_data: data = {} } = candidate;
  const result = await createOrReuseGuardianByParts(supabase, {
    orgId,
    firstName: normalizeString(data.guardian_first_name),
    lastName: normalizeString(data.guardian_last_name),
    phone: data.guardian_phone,
    email: data.guardian_email,
  });
  return {
    guardianId: result.guardianId,
    ledgerAction: result.action === 'created' ? 'create' : 'link',
  };
}

async function commitGuardianLink(supabase, orgId, candidate, committedProfilesByIdentity) {
  const { candidate_data: data = {} } = candidate;
  const studentIdentity = normalizeString(data.identity_number);
  const guardianPhone = normalizeString(data.guardian_phone);

  if (!studentIdentity) throw new Error('student_identity_number_required');
  if (!guardianPhone) throw new Error('guardian_phone_required');

  // Try this batch first (student committed in wave 0), then fall back to DB
  let clientProfileId = committedProfilesByIdentity.get(studentIdentity);
  if (!clientProfileId) {
    const { data: profile, error } = await findClientProfileByIdentityNumber(supabase, studentIdentity, { orgId });
    if (error) throw new Error(`failed_to_find_student_profile:${error.message}`);
    clientProfileId = profile?.id || null;
  }
  if (!clientProfileId) throw new Error('guardian_link_student_not_found');

  const phoneResult = validateIsraeliPhone(guardianPhone);
  if (!phoneResult.valid || !phoneResult.value) throw new Error('invalid_guardian_phone');

  const { data: guardian, error: guardianError } = await withOrgScope(supabase, 'guardians', orgId)
    .select('id')
    .eq('phone', phoneResult.value)
    .limit(1)
    .maybeSingle();
  if (guardianError) throw new Error(`failed_to_find_guardian:${guardianError.message}`);
  if (!guardian?.id) throw new Error('guardian_link_guardian_not_found');

  await upsertClientGuardianLink(supabase, {
    orgId,
    clientProfileId,
    guardianId: guardian.id,
    relationship: normalizeString(data.relationship) || null,
  });

  return { clientProfileId, guardianId: guardian.id };
}

async function commitService(supabase, orgId, candidate) {
  const { candidate_data: data = {} } = candidate;
  const serviceName = normalizeString(data.service_name);
  if (!serviceName) throw new Error('service_name_required');

  const { data: existing, error: lookupError } = await withOrgScope(supabase, 'Services', orgId)
    .select('id')
    .ilike('name', serviceName)
    .limit(1)
    .maybeSingle();
  if (lookupError) throw new Error(`failed_to_lookup_service:${lookupError.message}`);
  if (existing?.id) return { serviceId: existing.id, ledgerAction: 'link' };

  const { data: created, error: createError } = await withOrgScope(supabase, 'Services', orgId)
    .insert({ org_id: orgId, name: serviceName, is_active: true })
    .select('id')
    .single();
  if (createError || !created?.id) throw new Error(`failed_to_create_service:${createError?.message || 'unknown_error'}`);

  return { serviceId: created.id, ledgerAction: 'create' };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function importCommitChunk(context, req) {
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
    context.log?.error?.('import-commit-chunk: auth failed', { message: err?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  const userId = authResult.data.user.id;

  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);
  if (!orgId) return respond(context, 400, { message: 'invalid_org_id' });

  const workspaceId = normalizeUuid(req.params?.workspaceId);
  if (!workspaceId) return respond(context, 400, { message: 'workspace_id_required' });

  attachErrorTracking(context, req, supabase, {
    orgId,
    userId,
    metadata: { endpoint: 'import-commit-chunk', workspaceId },
  });

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (err) {
    context.log?.error?.('import-commit-chunk: membership check failed', { message: err?.message });
    return respondCommitError(context, 500, 'failed_to_verify_membership', err, { action: 'verify_membership' });
  }
  if (!role) return respond(context, 403, { message: 'forbidden' });
  if (!isAdminOrOffice(role)) return respond(context, 403, { message: 'forbidden' });

  const rawIds = body?.candidate_ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return respond(context, 400, { message: 'candidate_ids_required' });
  }
  if (rawIds.length > MAX_CANDIDATES_PER_CALL) {
    return respond(context, 400, { message: 'too_many_candidates', max: MAX_CANDIDATES_PER_CALL });
  }

  const candidateIds = rawIds.map(id => normalizeUuid(String(id ?? ''))).filter(Boolean);
  if (candidateIds.length === 0) return respond(context, 400, { message: 'no_valid_candidate_ids' });

  const { data: workspace, error: wsError } = await withOrgScope(supabase, 'import_workspaces', orgId)
    .select('id, status')
    .eq('id', workspaceId)
    .maybeSingle();
  if (wsError) {
    context.log?.error?.('import-commit-chunk: workspace lookup failed', { message: wsError.message });
    return respondCommitError(context, 500, 'failed_to_load_workspace', wsError, {
      action: 'load_workspace', workspaceId,
    });
  }
  if (!workspace) return respond(context, 404, { message: 'workspace_not_found' });
  if (workspace.status === 'committed') return respond(context, 409, { message: 'workspace_already_committed' });

  const { data: candidates, error: candidatesError } = await withOrgScope(supabase, 'import_candidates', orgId)
    .select('id, entity_type, status, candidate_data, decisions, blocking_issues_count')
    .eq('workspace_id', workspaceId)
    .in('id', candidateIds);
  if (candidatesError) {
    context.log?.error?.('import-commit-chunk: candidates load failed', { message: candidatesError.message });
    return respondCommitError(context, 500, 'failed_to_load_candidates', candidatesError, {
      action: 'load_candidates', workspaceId,
    });
  }
  if (!candidates || candidates.length === 0) return respond(context, 404, { message: 'no_candidates_found' });

  // Sort into wave order so customers always precede guardians/links
  const sorted = [...candidates].sort((a, b) => {
    const wa = ENTITY_WAVE[a.entity_type] ?? 99;
    const wb = ENTITY_WAVE[b.entity_type] ?? 99;
    return wa - wb;
  });

  const now = new Date().toISOString();
  const results = [];
  const failures = [];
  const committedProfilesByIdentity = new Map();
  let committedCount = 0;

  for (const candidate of sorted) {
    const { entity_type, status, blocking_issues_count, decisions = {} } = candidate;
    const action = normalizeString(decisions?.action);

    // Skipped — mark and continue
    if (status === 'skipped' || action === 'skip') {
      await withOrgScope(supabase, 'import_candidates', orgId)
        .update({ status: 'skipped', updated_at: now })
        .eq('id', candidate.id);
      results.push({ candidate_id: candidate.id, outcome: 'skipped' });
      continue;
    }

    // Already committed (re-entrant call)
    if (status === 'committed') {
      results.push({ candidate_id: candidate.id, outcome: 'already_committed' });
      committedCount++;
      continue;
    }

    // Pre-flight: must be 'ready' (or 'failed' for retry) with no blockers
    if (status !== 'ready' && status !== 'failed') {
      const reason = `candidate_not_ready:${status}`;
      await withOrgScope(supabase, 'import_candidates', orgId)
        .update({ status: 'failed', updated_at: now })
        .eq('id', candidate.id);
      failures.push({ candidate_id: candidate.id, error: reason });
      results.push({ candidate_id: candidate.id, outcome: 'failed', error: reason });
      continue;
    }
    if (Number(blocking_issues_count) > 0) {
      const reason = 'candidate_has_blockers';
      await withOrgScope(supabase, 'import_candidates', orgId)
        .update({ status: 'failed', updated_at: now })
        .eq('id', candidate.id);
      failures.push({ candidate_id: candidate.id, error: reason });
      results.push({ candidate_id: candidate.id, outcome: 'failed', error: reason });
      continue;
    }

    // Dependency resolution: guardian_link depends on its customer/student and
    // guardian already existing. Enforced structurally by the commit wave order
    // (customers in wave 0, guardians in wave 1) plus per-row identity/phone
    // lookup in commitGuardianLink. A missing dependency surfaces as a per-row
    // failure, not a pre-flight block.

    try {
      const ledgerEntries = [];

      if (entity_type === 'customer') {
        const result = await commitCustomer(supabase, orgId, candidate);
        ledgerEntries.push({
          resourceType: 'client_profiles',
          resourceId: result.clientProfileId,
          action: result.profileLedgerAction,
        });
        if (result.studentId) {
          ledgerEntries.push({
            resourceType: 'students',
            resourceId: result.studentId,
            action: result.studentLedgerAction,
          });
        }
        const identity = normalizeString(candidate.candidate_data?.identity_number);
        if (identity && result.clientProfileId) {
          committedProfilesByIdentity.set(identity, result.clientProfileId);
        }
      } else if (entity_type === 'guardian') {
        const result = await commitGuardian(supabase, orgId, candidate);
        ledgerEntries.push({ resourceType: 'guardians', resourceId: result.guardianId, action: result.ledgerAction });
      } else if (entity_type === 'guardian_link') {
        const result = await commitGuardianLink(supabase, orgId, candidate, committedProfilesByIdentity);
        ledgerEntries.push({ resourceType: 'client_guardians', resourceId: result.guardianId, action: 'link' });
      } else if (entity_type === 'service') {
        const result = await commitService(supabase, orgId, candidate);
        ledgerEntries.push({ resourceType: 'Services', resourceId: result.serviceId, action: result.ledgerAction });
      } else {
        throw new Error(`unsupported_entity_type:${entity_type}`);
      }

      for (const entry of ledgerEntries) {
        await writeLedgerRow(
          supabase, orgId, workspaceId, candidate.id,
          entry.resourceType, entry.resourceId, entry.action,
        );
      }

      await withOrgScope(supabase, 'import_candidates', orgId)
        .update({ status: 'committed', updated_at: now })
        .eq('id', candidate.id);

      committedCount++;
      results.push({ candidate_id: candidate.id, outcome: 'committed' });
    } catch (err) {
      context.log?.error?.('import-commit-chunk: candidate commit failed', {
        candidateId: candidate.id,
        entity_type,
        message: err?.message,
      });

      await withOrgScope(supabase, 'import_candidates', orgId)
        .update({ status: 'failed', updated_at: now })
        .eq('id', candidate.id);

      failures.push({ candidate_id: candidate.id, error: err?.message || 'unknown_error' });
      results.push({ candidate_id: candidate.id, outcome: 'failed', error: err?.message });
    }
  }

  // Flip workspace status: 'committed' only when no non-terminal candidates remain
  const nonTerminalStatuses = ['needs_review', 'ready', 'blocked', 'blocked_by_dependency', 'failed'];
  const { count: remainingCount } = await withOrgScope(supabase, 'import_candidates', orgId)
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .in('status', nonTerminalStatuses);

  const newWorkspaceStatus = (remainingCount ?? 1) === 0 ? 'committed' : 'needs_review';
  await withOrgScope(supabase, 'import_workspaces', orgId)
    .update({ status: newWorkspaceStatus, updated_at: now })
    .eq('id', workspaceId);

  return respond(context, 200, {
    committed: committedCount,
    failed: failures.length,
    workspace_id: workspaceId,
    results,
    failures,
  });
}
