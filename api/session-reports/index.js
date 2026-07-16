/* eslint-env node */
// session-reports — internal, tokenless report write path (Session Reports Phase 2/4/5)
// A "report" is a form_submissions row: source='internal', is_legacy=false, bound to
// exactly one lesson_participant_id. See
// implementations/session-reports/implementation-plan.md (Invariants block) and
// implementations/session-reports/phase0-delta-audit.md (§2, §3).
//
// GET   /api/session-reports?student_id=:id
// GET   /api/session-reports?lesson_instance_id=:id
// GET   /api/session-reports?lesson_participant_id=:id&mode=context
//         -> { participant, lesson, service, form, existing_report_id } for the report drawer
// GET   /api/session-reports?mode=pending&scope=mine|all&page=1
//         -> { items, documented_unconfirmed, page, page_size, has_more } (Phase 5)
// POST  /api/session-reports                body: { lesson_participant_id, answers, notes? }
// POST  /api/session-reports/preanswers     body: { field_key, answers } (Phase 4 — caller's
//         own Employees.metadata.report_preanswers bank; narrow, self-row-only)
// PATCH /api/session-reports/{reportId}     body: { answers?, notes?, mark_reviewed? }
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
import { ensureOrgPermissions } from '../_shared/permissions-utils.js';
import {
  buildSharedBlockMap,
  collectSharedBlockIds,
  evaluateAlertFlags,
  findMissingSharedBlockIds,
  getQuestionsInOrder,
  materializeSchemaForSnapshot,
  normalizeFormSchema,
  prepareAnswersForStorage,
  resolvePublicFormState,
  resolveSchemaWithSharedBlocks,
} from '../_shared/forms-runtime.js';

const NON_ARRIVAL_STATUSES = new Set(['no_show', 'cancelled_student', 'cancelled_clinic']);
const PENDING_PAGE_SIZE = 50;

function respondReportsError(context, status, message, error, metadata = {}) {
  return respondTracked(context, status, { message }, undefined, { error, metadata });
}

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function normalizeJsonObject(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }
  return value;
}

// Resolves the acting user's Employees row (if any) — used to decide whether
// they are "the instructor" for a given lesson_instances.instructor_employee_id.
async function resolveActingEmployee(supabase, orgId, userId) {
  const { data, error } = await withOrgScope(supabase, 'Employees', orgId)
    .select('id, is_active')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function resolveSessionReportFormState(supabase, orgId, formRecord) {
  const initialState = resolvePublicFormState(formRecord, {
    allowDraftFallback: false,
    sharedBlocksById: {},
  });
  const rawSchema = initialState.raw_form_schema || initialState.form_schema;
  const blockIds = collectSharedBlockIds(rawSchema);
  if (!blockIds.length) {
    return initialState;
  }

  const { data, error } = await withOrgScope(supabase, 'shared_form_blocks', orgId)
    .select('id, block_type, name, content_schema, is_active, metadata')
    .eq('is_active', true)
    .in('id', blockIds);

  if (error) throw error;

  const sharedBlocksById = buildSharedBlockMap(data);
  const missingBlockIds = findMissingSharedBlockIds(rawSchema, sharedBlocksById);
  if (missingBlockIds.length) {
    throw new Error(`missing_shared_blocks:${missingBlockIds.join(',')}`);
  }

  return {
    ...initialState,
    form_schema: resolveSchemaWithSharedBlocks(rawSchema, sharedBlocksById),
  };
}

// ---------------------------------------------------------------------------
// POST /session-reports/preanswers — Phase 4 personal (per-employee) bank.
// Caller may only ever write their OWN Employees row's metadata.report_preanswers
// (resolved via Employees.user_id = caller, never via a supplied employee id).
// Body: { field_key: string, answers: string[] }. Replaces the whole list for
// that field key (add/remove is done client-side then the full list is sent).
// ---------------------------------------------------------------------------
async function updatePersonalPreanswers(context, req, { supabase, orgId, userId }) {
  const body = parseRequestBody(req);
  const fieldKey = normalizeString(body?.field_key);
  if (!fieldKey) {
    return respond(context, 400, { message: 'invalid_field_key' });
  }
  if (!Array.isArray(body?.answers) || body.answers.some((entry) => typeof entry !== 'string')) {
    return respond(context, 400, { message: 'invalid_answers' });
  }

  let permissions;
  try {
    permissions = await ensureOrgPermissions(supabase, orgId);
  } catch (err) {
    context.log?.error?.('session-reports: failed to resolve permissions for preanswers', { message: err?.message });
    return respondReportsError(context, 500, 'failed_to_verify_membership', err, { action: 'resolve_permissions_preanswers' });
  }
  if (permissions?.session_form_preanswers_enabled !== true) {
    return respond(context, 403, { message: 'session_form_preanswers_disabled' });
  }
  const cap = normalizePositiveInt(permissions?.session_form_preanswers_cap, 50);
  const answers = body.answers.map((entry) => entry.trim()).filter(Boolean).slice(0, cap);

  const { data: employee, error: employeeError } = await withOrgScope(supabase, 'Employees', orgId)
    .select('id, metadata')
    .eq('user_id', userId)
    .maybeSingle();

  if (employeeError) {
    context.log?.error?.('session-reports: failed to load employee for preanswers', { message: employeeError.message });
    return respondReportsError(context, 500, 'failed_to_load_employee', employeeError, { action: 'load_employee_preanswers' });
  }
  if (!employee?.id) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const currentMetadata = normalizeJsonObject(employee.metadata, {});
  const currentBank = normalizeJsonObject(currentMetadata.report_preanswers, {});
  const nextBank = { ...currentBank, [fieldKey]: answers };
  if (answers.length === 0) {
    delete nextBank[fieldKey];
  }
  const nextMetadata = { ...currentMetadata, report_preanswers: nextBank };

  const { data: updated, error: updateError } = await withOrgScope(supabase, 'Employees', orgId)
    .update({ metadata: nextMetadata })
    .eq('id', employee.id)
    .select('id, metadata')
    .single();

  if (updateError) {
    context.log?.error?.('session-reports: failed to update personal preanswers', { message: updateError.message });
    return respondReportsError(context, 500, 'failed_to_update_preanswers', updateError, { action: 'update_personal_preanswers' });
  }

  return respond(context, 200, { report_preanswers: normalizeJsonObject(updated.metadata, {}).report_preanswers || {} });
}

// ---------------------------------------------------------------------------
// POST — create a report
// ---------------------------------------------------------------------------
async function createReport(context, req, { supabase, orgId, userId, role }) {
  const body = parseRequestBody(req);
  const lessonParticipantId = normalizeUuid(body?.lesson_participant_id);
  const answersInput = normalizeJsonObject(body?.answers, {});
  const notes = normalizeString(body?.notes);

  if (!lessonParticipantId) {
    return respond(context, 400, { message: 'invalid_lesson_participant_id' });
  }

  // Load the participant.
  const { data: participant, error: participantError } = await withOrgScope(supabase, 'lesson_participants', orgId)
    .select('id, lesson_instance_id, client_profile_id, student_id, participant_status')
    .eq('id', lessonParticipantId)
    .maybeSingle();

  if (participantError) {
    context.log?.error?.('session-reports: failed to load participant', { message: participantError.message });
    return respondReportsError(context, 500, 'failed_to_load_participant', participantError, {
      action: 'load_participant',
      lesson_participant_id: lessonParticipantId,
    });
  }
  if (!participant) {
    return respond(context, 404, { message: 'participant_not_found' });
  }

  if (NON_ARRIVAL_STATUSES.has(normalizeString(participant.participant_status))) {
    return respond(context, 409, { message: 'participant_did_not_attend' });
  }

  // Load the lesson instance.
  const { data: lesson, error: lessonError } = await withOrgScope(supabase, 'lesson_instances', orgId)
    .select('id, datetime_start, status, instructor_employee_id, service_id')
    .eq('id', participant.lesson_instance_id)
    .maybeSingle();

  if (lessonError) {
    context.log?.error?.('session-reports: failed to load lesson', { message: lessonError.message });
    return respondReportsError(context, 500, 'failed_to_load_lesson', lessonError, {
      action: 'load_lesson',
      lesson_instance_id: participant.lesson_instance_id,
    });
  }
  if (!lesson) {
    return respond(context, 404, { message: 'lesson_instance_not_found' });
  }

  if (normalizeString(lesson.status) === 'cancelled') {
    return respond(context, 409, { message: 'lesson_cancelled' });
  }

  const now = new Date();
  const lessonStart = new Date(lesson.datetime_start);
  if (Number.isNaN(lessonStart.getTime()) || lessonStart.getTime() > now.getTime()) {
    return respond(context, 409, { message: 'lesson_not_started' });
  }

  // Caller must be admin/office OR the lesson's instructor.
  let callerIsInstructor = false;
  if (!isAdminOrOffice(role)) {
    let actingEmployee;
    try {
      actingEmployee = await resolveActingEmployee(supabase, orgId, userId);
    } catch (employeeError) {
      context.log?.error?.('session-reports: failed to resolve acting employee', { message: employeeError.message });
      return respondReportsError(context, 500, 'failed_to_verify_instructor', employeeError, {
        action: 'resolve_acting_employee',
      });
    }
    callerIsInstructor = Boolean(actingEmployee?.id) && actingEmployee.id === lesson.instructor_employee_id;
    if (!callerIsInstructor) {
      return respond(context, 403, { message: 'forbidden' });
    }
  }

  // Pre-check: existing non-legacy report for this participant.
  const { data: existingReport, error: existingReportError } = await withOrgScope(supabase, 'form_submissions', orgId)
    .select('id')
    .eq('lesson_participant_id', lessonParticipantId)
    .eq('is_legacy', false)
    .maybeSingle();

  if (existingReportError) {
    context.log?.error?.('session-reports: failed to check existing report', { message: existingReportError.message });
    return respondReportsError(context, 500, 'failed_to_check_existing_report', existingReportError, {
      action: 'check_existing_report',
      lesson_participant_id: lessonParticipantId,
    });
  }
  if (existingReport) {
    return respond(context, 409, { message: 'report_already_exists' });
  }

  // Resolve the report form via the lesson's service.
  const serviceId = lesson.service_id;
  const { data: service, error: serviceError } = await withOrgScope(supabase, 'Services', orgId)
    .select('id, report_form_id')
    .eq('id', serviceId)
    .maybeSingle();

  if (serviceError) {
    context.log?.error?.('session-reports: failed to load service', { message: serviceError.message });
    return respondReportsError(context, 500, 'failed_to_load_service', serviceError, {
      action: 'load_service',
      service_id: serviceId,
    });
  }
  if (!service?.report_form_id) {
    return respond(context, 409, { message: 'service_has_no_report_form' });
  }

  const { data: form, error: formError } = await withOrgScope(supabase, 'forms', orgId)
    .select('id, form_usage, form_schema, alert_rules, visibility_rules, version, published_at, archived_at, is_active, metadata')
    .eq('id', service.report_form_id)
    .maybeSingle();

  if (formError) {
    context.log?.error?.('session-reports: failed to load form', { message: formError.message });
    return respondReportsError(context, 500, 'failed_to_load_form', formError, {
      action: 'load_form',
      form_id: service.report_form_id,
    });
  }
  if (!form) {
    return respond(context, 404, { message: 'form_not_found' });
  }
  if (normalizeString(form.form_usage) !== 'session_report') {
    return respond(context, 409, { message: 'form_not_session_report' });
  }
  if (form.is_active === false || form.archived_at) {
    return respond(context, 409, { message: 'report_form_not_published' });
  }

  let publicFormState;
  try {
    publicFormState = await resolveSessionReportFormState(supabase, orgId, form);
  } catch (formStateError) {
    context.log?.error?.('session-reports: failed to resolve published form state', { message: formStateError?.message });
    return respondReportsError(context, 500, 'failed_to_load_form', formStateError, {
      action: 'resolve_published_form_state',
      form_id: form.id,
    });
  }
  if (!publicFormState.is_published) {
    return respond(context, 409, { message: 'report_form_not_published' });
  }

  const formSchema = materializeSchemaForSnapshot(publicFormState.form_schema);
  const preparedAnswers = prepareAnswersForStorage({
    formSchema,
    answers: answersInput,
    env: readEnv(context),
  });
  const alertFlags = evaluateAlertFlags({
    formSchema,
    alertRules: publicFormState.alert_rules,
    answers: preparedAnswers,
  });

  const nowIso = now.toISOString();
  const insertPayload = {
    form_id: form.id,
    form_version: publicFormState.published_version || form.version,
    client_profile_id: participant.client_profile_id,
    student_id: participant.student_id,
    service_id: serviceId,
    lesson_participant_id: lessonParticipantId,
    answers: preparedAnswers,
    alert_flags: alertFlags,
    otp_metadata: {},
    source: 'internal',
    is_legacy: false,
    submitted_at: nowIso,
    metadata: {
      authored_by: userId,
      authored_role: role,
      // Rendering contract: the report must always render against the exact
      // schema it was filled with, even after the form is edited/republished
      // later. `forms` only keeps the CURRENT schema, so snapshot it here,
      // untrimmed, at create time. See implementations/session-reports/
      // implementation-plan.md ("The report entity" section).
      form_schema_snapshot: formSchema,
      visibility_rules_snapshot: publicFormState.visibility_rules,
      alert_rules_snapshot: publicFormState.alert_rules,
      ...(notes ? { notes } : {}),
    },
  };

  const { data: created, error: insertError } = await withOrgScope(supabase, 'form_submissions', orgId)
    .insert(insertPayload)
    .select()
    .single();

  if (insertError) {
    // Unique-violation race: another request created the report between our
    // pre-check and this insert. Map to the same 409 rather than a raw 23505.
    if (insertError.code === '23505') {
      return respond(context, 409, { message: 'report_already_exists' });
    }
    context.log?.error?.('session-reports: failed to create report', { message: insertError.message });
    return respondReportsError(context, 500, 'failed_to_create_report', insertError, {
      action: 'create_report',
      lesson_participant_id: lessonParticipantId,
    });
  }

  return respond(context, 201, created);
}

// ---------------------------------------------------------------------------
// PATCH — edit a report
// ---------------------------------------------------------------------------
async function updateReport(context, req, { supabase, orgId, userId, role, reportId }) {
  if (!reportId) {
    return respond(context, 400, { message: 'invalid_report_id' });
  }

  const body = parseRequestBody(req);

  const { data: report, error: reportError } = await withOrgScope(supabase, 'form_submissions', orgId)
    .select('id, form_id, answers, alert_flags, metadata, locked_at, is_legacy, source, lesson_participant_id')
    .eq('id', reportId)
    .eq('source', 'internal')
    .not('lesson_participant_id', 'is', null)
    .maybeSingle();

  if (reportError) {
    context.log?.error?.('session-reports: failed to load report for edit', { message: reportError.message });
    return respondReportsError(context, 500, 'failed_to_load_report', reportError, {
      action: 'load_report_for_edit',
      report_id: reportId,
    });
  }
  if (!report) {
    return respond(context, 404, { message: 'report_not_found' });
  }
  if (report.locked_at) {
    return respond(context, 409, { message: 'report_locked' });
  }

  const currentMetadata = normalizeJsonObject(report.metadata, {});
  const authoredBy = normalizeString(currentMetadata.authored_by);
  const isAuthor = authoredBy && authoredBy === userId;

  if (!isAdminOrOffice(role) && !isAuthor) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const updates = {};
  const nowIso = new Date().toISOString();
  let nextMetadata = { ...currentMetadata };

  if (Object.prototype.hasOwnProperty.call(body || {}, 'answers')) {
    const answersInput = normalizeJsonObject(body.answers, {});
    const schemaSnapshot = normalizeJsonObject(currentMetadata.form_schema_snapshot, null);
    if (schemaSnapshot && !report.is_legacy) {
      const normalizedSnapshot = normalizeFormSchema(schemaSnapshot);
      updates.answers = prepareAnswersForStorage({
        formSchema: normalizedSnapshot,
        answers: answersInput,
        env: readEnv(context),
      });
      updates.alert_flags = evaluateAlertFlags({
        formSchema: normalizedSnapshot,
        alertRules: currentMetadata.alert_rules_snapshot,
        answers: updates.answers,
      });
    } else {
      updates.answers = answersInput;
    }
  }

  const notes = normalizeString(body?.notes);
  if (Object.prototype.hasOwnProperty.call(body || {}, 'notes')) {
    nextMetadata = { ...nextMetadata, notes: notes || null };
  }

  if (Object.keys(updates).length > 0 || Object.prototype.hasOwnProperty.call(body || {}, 'notes')) {
    nextMetadata = {
      ...nextMetadata,
      last_edited_by: userId,
      last_edited_at: nowIso,
    };
  }

  if (body?.mark_reviewed === true) {
    if (!isAdminOrOffice(role)) {
      return respond(context, 403, { message: 'forbidden' });
    }
    updates.reviewed_by = userId;
    updates.reviewed_at = nowIso;
  }

  updates.metadata = nextMetadata;

  const { data: updated, error: updateError } = await withOrgScope(supabase, 'form_submissions', orgId)
    .update(updates)
    .eq('id', reportId)
    .select()
    .single();

  if (updateError) {
    context.log?.error?.('session-reports: failed to update report', { message: updateError.message });
    return respondReportsError(context, 500, 'failed_to_update_report', updateError, {
      action: 'update_report',
      report_id: reportId,
    });
  }

  return respond(context, 200, updated);
}

// ---------------------------------------------------------------------------
// GET (?mode=context) — resolve what the report drawer needs to render a fill
// form for one lesson_participant_id: the participant/lesson/service plus the
// service's report form (id, version, schema). Same permission/role guards as
// POST createReport (admin/office, or the lesson's instructor), so a caller
// who couldn't create a report for this participant can't peek at its form
// either.
// ---------------------------------------------------------------------------
async function resolveReportContext(context, req, { supabase, orgId, userId, role }) {
  const lessonParticipantId = normalizeUuid(req.query?.lesson_participant_id);
  if (!lessonParticipantId) {
    return respond(context, 400, { message: 'invalid_lesson_participant_id' });
  }

  let permissions;
  try {
    permissions = await ensureOrgPermissions(supabase, orgId);
  } catch (err) {
    context.log?.error?.('session-reports: failed to resolve permissions for context', { message: err?.message });
    permissions = null;
  }
  const preanswersEnabled = permissions?.session_form_preanswers_enabled === true;

  const { data: participant, error: participantError } = await withOrgScope(supabase, 'lesson_participants', orgId)
    .select('id, lesson_instance_id, client_profile_id, student_id, participant_status')
    .eq('id', lessonParticipantId)
    .maybeSingle();

  if (participantError) {
    context.log?.error?.('session-reports: failed to load participant for context', { message: participantError.message });
    return respondReportsError(context, 500, 'failed_to_load_participant', participantError, {
      action: 'load_participant_context',
      lesson_participant_id: lessonParticipantId,
    });
  }
  if (!participant) {
    return respond(context, 404, { message: 'participant_not_found' });
  }

  const { data: lesson, error: lessonError } = await withOrgScope(supabase, 'lesson_instances', orgId)
    .select('id, datetime_start, status, instructor_employee_id, service_id')
    .eq('id', participant.lesson_instance_id)
    .maybeSingle();

  if (lessonError) {
    context.log?.error?.('session-reports: failed to load lesson for context', { message: lessonError.message });
    return respondReportsError(context, 500, 'failed_to_load_lesson', lessonError, {
      action: 'load_lesson_context',
      lesson_instance_id: participant.lesson_instance_id,
    });
  }
  if (!lesson) {
    return respond(context, 404, { message: 'lesson_instance_not_found' });
  }

  // Same authorization rule as POST createReport: admin/office, or the
  // lesson's own instructor. Deliberately checked before returning any
  // form/schema data.
  if (!isAdminOrOffice(role)) {
    let actingEmployee;
    try {
      actingEmployee = await resolveActingEmployee(supabase, orgId, userId);
    } catch (employeeError) {
      context.log?.error?.('session-reports: failed to resolve acting employee for context', { message: employeeError.message });
      return respondReportsError(context, 500, 'failed_to_verify_instructor', employeeError, {
        action: 'resolve_acting_employee_context',
      });
    }
    const callerIsInstructor = Boolean(actingEmployee?.id) && actingEmployee.id === lesson.instructor_employee_id;
    if (!callerIsInstructor) {
      return respond(context, 403, { message: 'forbidden' });
    }
  }

  const { data: clientProfile, error: clientProfileError } = await withOrgScope(supabase, 'client_profiles', orgId)
    .select('id, first_name, last_name')
    .eq('id', participant.client_profile_id)
    .maybeSingle();

  if (clientProfileError) {
    context.log?.error?.('session-reports: failed to load client profile for context', { message: clientProfileError.message });
    return respondReportsError(context, 500, 'failed_to_load_client_profile', clientProfileError, {
      action: 'load_client_profile_context',
      client_profile_id: participant.client_profile_id,
    });
  }

  const { data: service, error: serviceError } = await withOrgScope(supabase, 'Services', orgId)
    .select('id, name, report_form_id, metadata')
    .eq('id', lesson.service_id)
    .maybeSingle();

  if (serviceError) {
    context.log?.error?.('session-reports: failed to load service for context', { message: serviceError.message });
    return respondReportsError(context, 500, 'failed_to_load_service', serviceError, {
      action: 'load_service_context',
      service_id: lesson.service_id,
    });
  }

  let form = null;
  if (service?.report_form_id) {
    const { data: formRow, error: formError } = await withOrgScope(supabase, 'forms', orgId)
      .select('id, name, form_usage, form_schema, alert_rules, visibility_rules, version, published_at, archived_at, is_active, metadata')
      .eq('id', service.report_form_id)
      .maybeSingle();

    if (formError) {
      context.log?.error?.('session-reports: failed to load form for context', { message: formError.message });
      return respondReportsError(context, 500, 'failed_to_load_form', formError, {
        action: 'load_form_context',
        form_id: service.report_form_id,
      });
    }

    if (formRow && normalizeString(formRow.form_usage) === 'session_report' && formRow.is_active !== false && !formRow.archived_at) {
      let publicFormState;
      try {
        publicFormState = await resolveSessionReportFormState(supabase, orgId, formRow);
      } catch (formStateError) {
        context.log?.error?.('session-reports: failed to resolve published form state for context', { message: formStateError?.message });
        return respondReportsError(context, 500, 'failed_to_load_form', formStateError, {
          action: 'resolve_published_form_state_context',
          form_id: formRow.id,
        });
      }
      if (publicFormState.is_published) {
        form = {
          id: formRow.id,
          name: formRow.name,
          version: publicFormState.published_version || formRow.version,
          form_schema: materializeSchemaForSnapshot(publicFormState.form_schema),
          alert_rules: publicFormState.alert_rules,
          visibility_rules: publicFormState.visibility_rules,
        };
      }
    }
  }

  // Pre-check: does a non-legacy report already exist for this participant?
  const { data: existingReport, error: existingReportError } = await withOrgScope(supabase, 'form_submissions', orgId)
    .select('id')
    .eq('lesson_participant_id', lessonParticipantId)
    .eq('is_legacy', false)
    .maybeSingle();

  if (existingReportError) {
    context.log?.error?.('session-reports: failed to check existing report for context', { message: existingReportError.message });
    return respondReportsError(context, 500, 'failed_to_check_existing_report', existingReportError, {
      action: 'check_existing_report_context',
      lesson_participant_id: lessonParticipantId,
    });
  }

  const now = new Date();
  const lessonStart = new Date(lesson.datetime_start);
  const lessonHasStarted = !Number.isNaN(lessonStart.getTime()) && lessonStart.getTime() <= now.getTime();

  // Phase 4 — preanswers banks (service-universal + caller's personal bank).
  // Only resolved when the org has the feature on, to avoid unnecessary reads.
  let preanswers = null;
  let lastReportAnswers = null;
  if (preanswersEnabled && form) {
    const servicePreanswers = normalizeJsonObject(
      normalizeJsonObject(service?.metadata, {}).report_preanswers,
      {},
    );

    // Personal bank is always the caller's own — resolved regardless of role,
    // since admin/office users filling a report also get their own personal bank.
    let personalPreanswers = {};
    const { data: actingEmployee, error: actingEmployeeError } = await withOrgScope(supabase, 'Employees', orgId)
      .select('id, metadata')
      .eq('user_id', userId)
      .maybeSingle();
    if (!actingEmployeeError && actingEmployee) {
      personalPreanswers = normalizeJsonObject(
        normalizeJsonObject(actingEmployee.metadata, {}).report_preanswers,
        {},
      );
    }

    preanswers = {
      cap: Number.isFinite(Number(permissions?.session_form_preanswers_cap))
        ? Number(permissions.session_form_preanswers_cap)
        : 50,
      service: servicePreanswers,
      personal: personalPreanswers,
    };

    // Bonus (Phase 4 task 4): "copy from my last report for this student+service".
    // Reuse the same student_id+service_id filter client-side would use; here we
    // do it server-side since we already have both ids.
    if (participant.student_id) {
      const { data: priorReports, error: priorReportsError } = await withOrgScope(supabase, 'form_submissions', orgId)
        .select('id, answers, submitted_at, lesson_participant_id')
        .eq('student_id', participant.student_id)
        .eq('service_id', service.id)
        .eq('is_legacy', false)
        .eq('source', 'internal')
        .neq('lesson_participant_id', lessonParticipantId)
        .order('submitted_at', { ascending: false })
        .limit(1);
      if (!priorReportsError && priorReports?.[0]) {
        const copyableQuestionIds = new Set(
          getQuestionsInOrder(form.form_schema)
            .filter((question) => !['signature', 'approval'].includes(question.type))
            .map((question) => question.id),
        );
        const priorAnswers = normalizeJsonObject(priorReports[0].answers, {});
        lastReportAnswers = Object.fromEntries(
          Object.entries(priorAnswers).filter(([questionId]) => copyableQuestionIds.has(questionId)),
        );
        if (!Object.keys(lastReportAnswers).length) {
          lastReportAnswers = null;
        }
      }
    }
  }

  return respond(context, 200, {
    participant: {
      id: participant.id,
      lesson_instance_id: participant.lesson_instance_id,
      client_profile_id: participant.client_profile_id,
      student_id: participant.student_id,
      participant_status: participant.participant_status,
      student_name: clientProfile ? [clientProfile.first_name, clientProfile.last_name].filter(Boolean).join(' ') : null,
    },
    lesson: {
      id: lesson.id,
      datetime_start: lesson.datetime_start,
      status: lesson.status,
      instructor_employee_id: lesson.instructor_employee_id,
      has_started: lessonHasStarted,
    },
    service: service ? { id: service.id, name: service.name, report_form_id: service.report_form_id || null } : null,
    form,
    existing_report_id: existingReport?.id || null,
    preanswers,
    last_report_answers: lastReportAnswers,
  });
}

// ---------------------------------------------------------------------------
// GET (?mode=pending) — Phase 5: participants awaiting documentation.
//
// "Pending" = lesson_participants with participant_status IN ('attended','scheduled')
// on past lessons (datetime_start <= now(), lesson not cancelled), whose service has
// a report_form_id, with NO non-legacy report yet. scope=mine (default for
// non-admin/office callers) restricts to lessons where the caller is the
// instructor; scope=all is admin/office only.
//
// Also returns documented_unconfirmed (E7 drift signal, admin/office only): the
// inverse join — participants that DO have a non-legacy report but whose
// participant_status is still 'scheduled' (attendance never confirmed).
// ---------------------------------------------------------------------------
async function resolvePendingReports(context, req, { supabase, orgId, userId, role }) {
  const requestedScope = normalizeString(req.query?.scope).toLowerCase();
  const callerIsAdminOrOffice = isAdminOrOffice(role);
  const scopeIsAll = callerIsAdminOrOffice && requestedScope === 'all';

  let instructorEmployeeId = null;
  if (!callerIsAdminOrOffice) {
    // Instructors can only ever see their own lessons — scope=all is rejected.
    if (requestedScope === 'all') {
      return respond(context, 403, { message: 'forbidden' });
    }
    let actingEmployee;
    try {
      actingEmployee = await resolveActingEmployee(supabase, orgId, userId);
    } catch (employeeError) {
      context.log?.error?.('session-reports: failed to resolve acting employee for pending', { message: employeeError.message });
      return respondReportsError(context, 500, 'failed_to_verify_instructor', employeeError, { action: 'resolve_acting_employee_pending' });
    }
    if (!actingEmployee?.id) {
      return respond(context, 403, { message: 'forbidden' });
    }
    instructorEmployeeId = actingEmployee.id;
  } else if (requestedScope !== 'all') {
    // Default for everyone (including admin/office, unless they explicitly ask
    // for scope=all) is "mine" — resolve their own Employees row if they have one.
    let actingEmployee;
    try {
      actingEmployee = await resolveActingEmployee(supabase, orgId, userId);
    } catch (employeeError) {
      context.log?.error?.('session-reports: failed to resolve acting employee for pending (admin mine)', { message: employeeError.message });
      return respondReportsError(context, 500, 'failed_to_verify_instructor', employeeError, { action: 'resolve_acting_employee_pending_admin' });
    }
    instructorEmployeeId = actingEmployee?.id || null;
  }

  const page = normalizePositiveInt(req.query?.page, 1);
  const from = (page - 1) * PENDING_PAGE_SIZE;
  if (callerIsAdminOrOffice && !scopeIsAll && !instructorEmployeeId) {
    return respond(context, 200, {
      items: [],
      documented_unconfirmed: [],
      page,
      page_size: PENDING_PAGE_SIZE,
      total: 0,
      has_more: false,
    });
  }

  const { data: pendingRows, error: pendingError } = await supabase.rpc('list_pending_session_reports', {
    p_org_id: orgId,
    p_instructor_employee_id: scopeIsAll ? null : instructorEmployeeId,
    p_limit: PENDING_PAGE_SIZE,
    p_offset: from,
  });

  if (pendingError) {
    context.log?.error?.('session-reports: failed to load exact pending page', { message: pendingError.message });
    return respondReportsError(context, 500, 'failed_to_load_participants', pendingError, {
      action: 'list_pending_session_reports',
      page,
      scope: scopeIsAll ? 'all' : 'mine',
    });
  }

  const totalCount = Number(pendingRows?.[0]?.total_count || 0);
  const items = (pendingRows || []).map((row) => Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== 'total_count'),
  ));

  // For the E7 drift signal (documented_unconfirmed), we need a broader set:
  // ALL scheduled participants on in-scope lessons (not just this page), so it
  // isn't silently paginated away. Admin/office only, and only computed once
  // (page 1) to avoid repeating an unbounded scan per page.
  let documentedUnconfirmed = [];
  if (callerIsAdminOrOffice && page === 1) {
    const { data: services, error: servicesError } = await withOrgScope(supabase, 'Services', orgId)
      .select('id, name, report_form_id')
      .not('report_form_id', 'is', null);

    if (servicesError) {
      context.log?.error?.('session-reports: failed to load services for drift signal', { message: servicesError.message });
      return respondReportsError(context, 500, 'failed_to_load_services', servicesError, { action: 'load_services_drift' });
    }
    const serviceMap = new Map((services || []).map((service) => [service.id, service]));
    const serviceIds = Array.from(serviceMap.keys());
    const nowIso = new Date().toISOString();

    let lessons = [];
    if (serviceIds.length) {
      let lessonsQuery = withOrgScope(supabase, 'lesson_instances', orgId)
        .select('id, datetime_start, status, instructor_employee_id, service_id')
        .in('service_id', serviceIds)
        .neq('status', 'cancelled')
        .lte('datetime_start', nowIso)
        .order('datetime_start', { ascending: false });
      if (!scopeIsAll && instructorEmployeeId) {
        lessonsQuery = lessonsQuery.eq('instructor_employee_id', instructorEmployeeId);
      }
      const lessonsResult = await lessonsQuery;
      if (lessonsResult.error) {
        context.log?.error?.('session-reports: failed to load lessons for drift signal', { message: lessonsResult.error.message });
        return respondReportsError(context, 500, 'failed_to_load_lessons', lessonsResult.error, { action: 'load_lessons_drift' });
      }
      lessons = lessonsResult.data || [];
    }

    const lessonMap = new Map(lessons.map((lesson) => [lesson.id, lesson]));
    const lessonIds = lessons.map((lesson) => lesson.id);
    if (!lessonIds.length) {
      return respond(context, 200, {
        items,
        documented_unconfirmed: [],
        page,
        page_size: PENDING_PAGE_SIZE,
        total: totalCount,
        has_more: from + items.length < totalCount,
      });
    }

    const { data: scheduledParticipants, error: scheduledError } = await withOrgScope(supabase, 'lesson_participants', orgId)
      .select('id, lesson_instance_id, client_profile_id, student_id, participant_status')
      .in('lesson_instance_id', lessonIds)
      .eq('participant_status', 'scheduled');

    if (scheduledError) {
      context.log?.error?.('session-reports: failed to load scheduled participants for drift signal', { message: scheduledError.message });
    } else if (scheduledParticipants?.length) {
      const scheduledIds = scheduledParticipants.map((row) => row.id);
      const { data: reportedRows, error: reportedError } = await withOrgScope(supabase, 'form_submissions', orgId)
        .select('id, lesson_participant_id, submitted_at')
        .in('lesson_participant_id', scheduledIds)
        .eq('is_legacy', false)
        .eq('source', 'internal');

      if (reportedError) {
        context.log?.error?.('session-reports: failed to load reports for drift signal', { message: reportedError.message });
      } else {
        const reportByParticipant = new Map((reportedRows || []).map((row) => [row.lesson_participant_id, row]));
        const driftParticipants = scheduledParticipants.filter((row) => reportByParticipant.has(row.id));
        documentedUnconfirmed = await enrichParticipants(supabase, orgId, driftParticipants, lessonMap, serviceMap, {
          reportByParticipant,
        });
      }
    }
  }

  return respond(context, 200, {
    items,
    documented_unconfirmed: documentedUnconfirmed,
    page,
    page_size: PENDING_PAGE_SIZE,
    total: totalCount,
    has_more: from + items.length < totalCount,
  });
}

// Shared enrichment: attaches student display name, service name, instructor
// display name, and lesson datetime to a list of lesson_participants rows for
// the pending-reports UI.
async function enrichParticipants(supabase, orgId, participantRows, lessonMap, serviceMap, { reportByParticipant } = {}) {
  if (!participantRows?.length) return [];

  const clientProfileIds = Array.from(new Set(participantRows.map((row) => row.client_profile_id).filter(Boolean)));
  let clientProfileMap = new Map();
  if (clientProfileIds.length) {
    const { data: clientProfiles, error: clientProfilesError } = await withOrgScope(supabase, 'client_profiles', orgId)
      .select('id, first_name, last_name')
      .in('id', clientProfileIds);
    if (!clientProfilesError && clientProfiles) {
      clientProfileMap = new Map(clientProfiles.map((row) => [row.id, row]));
    }
  }

  const instructorIds = Array.from(new Set(
    participantRows
      .map((row) => lessonMap.get(row.lesson_instance_id)?.instructor_employee_id)
      .filter(Boolean),
  ));
  let employeeMap = new Map();
  if (instructorIds.length) {
    const { data: employees, error: employeesError } = await withOrgScope(supabase, 'Employees', orgId)
      .select('id, first_name, last_name')
      .in('id', instructorIds);
    if (!employeesError && employees) {
      employeeMap = new Map(employees.map((row) => [row.id, row]));
    }
  }

  return participantRows.map((participant) => {
    const lesson = lessonMap.get(participant.lesson_instance_id) || null;
    const service = lesson ? serviceMap.get(lesson.service_id) || null : null;
    const clientProfile = clientProfileMap.get(participant.client_profile_id) || null;
    const instructor = lesson?.instructor_employee_id ? employeeMap.get(lesson.instructor_employee_id) || null : null;
    const report = reportByParticipant?.get(participant.id) || null;
    return {
      lesson_participant_id: participant.id,
      participant_status: participant.participant_status,
      student_id: participant.student_id,
      student_name: clientProfile ? [clientProfile.first_name, clientProfile.last_name].filter(Boolean).join(' ') : null,
      lesson_instance_id: participant.lesson_instance_id,
      lesson_datetime_start: lesson?.datetime_start || null,
      instructor_employee_id: lesson?.instructor_employee_id || null,
      instructor_name: instructor ? [instructor.first_name, instructor.last_name].filter(Boolean).join(' ') : null,
      service_id: service?.id || null,
      service_name: service?.name || null,
      ...(report ? { report_id: report.id, report_submitted_at: report.submitted_at } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// GET — list reports
// ---------------------------------------------------------------------------
async function listReports(context, req, { supabase, orgId, userId, role }) {
  const studentId = normalizeUuid(req.query?.student_id);
  const lessonInstanceId = normalizeUuid(req.query?.lesson_instance_id);

  if (!studentId && !lessonInstanceId) {
    return respond(context, 400, { message: 'missing_query_filter' });
  }

  let instructorEmployeeId = null;
  if (!isAdminOrOffice(role)) {
    let actingEmployee;
    try {
      actingEmployee = await resolveActingEmployee(supabase, orgId, userId);
    } catch (employeeError) {
      context.log?.error?.('session-reports: failed to resolve acting employee for list', { message: employeeError.message });
      return respondReportsError(context, 500, 'failed_to_verify_instructor', employeeError, {
        action: 'resolve_acting_employee_list',
      });
    }
    if (!actingEmployee?.id) {
      return respond(context, 403, { message: 'forbidden' });
    }
    instructorEmployeeId = actingEmployee.id;
  }

  const selectColumns = 'id, form_id, form_version, answers, submitted_at, metadata, lesson_participant_id, student_id, client_profile_id, service_id, is_legacy, reviewed_by, reviewed_at, locked_at';

  if (studentId) {
    let query = withOrgScope(supabase, 'form_submissions', orgId)
      .select(`${selectColumns}, lesson_participants!inner(id, lesson_instance_id, lesson_instances!inner(id, datetime_start, instructor_employee_id))`)
      .eq('student_id', studentId)
      .eq('source', 'internal')
      .not('lesson_participant_id', 'is', null)
      .order('submitted_at', { ascending: false });

    if (instructorEmployeeId) {
      query = query.eq('lesson_participants.lesson_instances.instructor_employee_id', instructorEmployeeId);
    }

    const { data, error } = await query;
    if (error) {
      context.log?.error?.('session-reports: failed to list reports by student', { message: error.message });
      return respondReportsError(context, 500, 'failed_to_list_reports', error, {
        action: 'list_reports_by_student',
        student_id: studentId,
      });
    }
    return respond(context, 200, { reports: data || [] });
  }

  // lessonInstanceId branch: reports for that lesson's participants.
  const { data: participantRows, error: participantsError } = await withOrgScope(supabase, 'lesson_participants', orgId)
    .select('id')
    .eq('lesson_instance_id', lessonInstanceId);

  if (participantsError) {
    context.log?.error?.('session-reports: failed to load participants for lesson', { message: participantsError.message });
    return respondReportsError(context, 500, 'failed_to_load_participants', participantsError, {
      action: 'load_participants_for_lesson',
      lesson_instance_id: lessonInstanceId,
    });
  }

  const participantIds = (participantRows || []).map((row) => row.id);
  if (!participantIds.length) {
    return respond(context, 200, { reports: [] });
  }

  if (instructorEmployeeId) {
    const { data: lessonRow, error: lessonRowError } = await withOrgScope(supabase, 'lesson_instances', orgId)
      .select('id, instructor_employee_id')
      .eq('id', lessonInstanceId)
      .maybeSingle();
    if (lessonRowError) {
      context.log?.error?.('session-reports: failed to load lesson for instructor scope', { message: lessonRowError.message });
      return respondReportsError(context, 500, 'failed_to_load_lesson', lessonRowError, {
        action: 'load_lesson_for_instructor_scope',
        lesson_instance_id: lessonInstanceId,
      });
    }
    if (!lessonRow || lessonRow.instructor_employee_id !== instructorEmployeeId) {
      return respond(context, 200, { reports: [] });
    }
  }

  const { data, error } = await withOrgScope(supabase, 'form_submissions', orgId)
    .select(selectColumns)
    .in('lesson_participant_id', participantIds)
    .eq('source', 'internal')
    .order('submitted_at', { ascending: false });

  if (error) {
    context.log?.error?.('session-reports: failed to list reports by lesson', { message: error.message });
    return respondReportsError(context, 500, 'failed_to_list_reports', error, {
      action: 'list_reports_by_lesson',
      lesson_instance_id: lessonInstanceId,
    });
  }

  return respond(context, 200, { reports: data || [] });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export default async function sessionReports(context, req) {
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
    context.log?.error?.('session-reports: auth failed', { message: err?.message });
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
    metadata: { endpoint: 'session-reports' },
  });

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (err) {
    context.log?.error?.('session-reports: membership check failed', { message: err?.message });
    return respondReportsError(context, 500, 'failed_to_verify_membership', err, { action: 'verify_membership' });
  }
  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  // Server-side permission gate — every method. Registry default is false, so
  // a missing key must be treated as disabled (fail-closed).
  let permissions;
  try {
    permissions = await ensureOrgPermissions(supabase, orgId);
  } catch (err) {
    context.log?.error?.('session-reports: failed to resolve permissions', { message: err?.message });
    return respondReportsError(context, 500, 'failed_to_verify_membership', err, { action: 'resolve_permissions' });
  }
  if (permissions?.session_reports_enabled !== true) {
    return respond(context, 403, { message: 'session_reports_disabled' });
  }

  const method = req.method?.toUpperCase();
  const rawReportIdSegment = normalizeString(req.params?.reportId);
  const reportId = normalizeUuid(rawReportIdSegment);

  if (method === 'POST' && rawReportIdSegment.toLowerCase() === 'preanswers') {
    return updatePersonalPreanswers(context, req, { supabase, orgId, userId });
  }
  if (method === 'POST') {
    return createReport(context, req, { supabase, orgId, userId, role });
  }
  if (method === 'PATCH') {
    return updateReport(context, req, { supabase, orgId, userId, role, reportId });
  }
  if (method === 'GET') {
    const mode = normalizeString(req.query?.mode);
    if (mode === 'context') {
      return resolveReportContext(context, req, { supabase, orgId, userId, role });
    }
    if (mode === 'pending') {
      return resolvePendingReports(context, req, { supabase, orgId, userId, role });
    }
    return listReports(context, req, { supabase, orgId, userId, role });
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
