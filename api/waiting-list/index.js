/* eslint-env node */
import { randomUUID } from 'node:crypto';
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { logTenantAuditEvent, TENANT_AUDIT_RETENTION } from '../_shared/tenant-audit.js';
import {
  UUID_PATTERN,
  ensureMembership,
  isAdminOrOffice,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  withOrgScope,
} from '../_shared/org-bff.js';
import { normalizePreferredTimesToGrid } from '../_shared/time-grid.js';
import {
  hydrateAnswersForReview,
  normalizeFormSchema,
  normalizeVisibilityRules,
} from '../_shared/forms-runtime.js';

const STATUS_OPTIONS = new Set(['new', 'open', 'matched', 'closed', 'active', 'all']);

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function normalizeStatus(value, { allowAll = false } = {}) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return '';
  if (normalized === 'canceled' || normalized === 'cancelled' || normalized === 'cancel') {
    return 'closed';
  }
  if (normalized === 'active') {
    return 'active';
  }
  if (allowAll && normalized === 'all') {
    return 'all';
  }
  return STATUS_OPTIONS.has(normalized) && normalized !== 'all' ? normalized : '';
}

function normalizePreferredDays(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const unique = new Set();
  value.forEach((entry) => {
    const day = Number(entry);
    if (Number.isInteger(day) && day >= 0 && day <= 6) {
      unique.add(day);
    }
  });
  if (!unique.size) {
    return null;
  }
  return Array.from(unique).sort((a, b) => a - b);
}

function normalizePreferredTimes(value) {
  return normalizePreferredTimesToGrid(value);
}

function normalizeBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  return defaultValue;
}

function normalizeJsonObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function hasReviewableAnswer(value) {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    if (value._type === 'signature') {
      return Boolean(
        value.encrypted_payload
        || (Array.isArray(value.preview_strokes) && value.preview_strokes.length > 0)
        || (Array.isArray(value.strokes) && value.strokes.length > 0),
      );
    }
    return Object.keys(value).length > 0;
  }
  return true;
}

function serializeAnswerForSearch(value) {
  if (!hasReviewableAnswer(value)) return '';
  if (Array.isArray(value)) return value.map(serializeAnswerForSearch).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    if (value._type === 'signature') return 'חתימה';
    return Object.values(value).map(serializeAnswerForSearch).filter(Boolean).join(' ');
  }
  return String(value);
}

async function enrichWaitingListEntriesWithIntakeSubmissions(client, orgId, entries, env) {
  const rows = Array.isArray(entries) ? entries : [];
  const submissionIds = Array.from(new Set(
    rows
      .map((entry) => normalizeUuid(entry?.latest_submission_id || entry?.metadata?.form_submission_id))
      .filter(Boolean),
  ));

  if (submissionIds.length === 0) {
    return rows;
  }

  const { data: submissions, error } = await withOrgScope(client, 'form_submissions', orgId)
    .select('id, form_id, answers, alert_flags, metadata, submitted_at')
    .in('id', submissionIds);

  if (error) {
    throw error;
  }

  const submissionRows = Array.isArray(submissions) ? submissions : [];
  const formIds = Array.from(new Set(submissionRows.map((row) => normalizeUuid(row?.form_id)).filter(Boolean)));
  let formsById = new Map();
  if (formIds.length > 0) {
    const { data: forms, error: formsError } = await withOrgScope(client, 'forms', orgId)
      .select('id, name')
      .in('id', formIds);

    if (formsError) {
      throw formsError;
    }
    formsById = new Map((Array.isArray(forms) ? forms : []).map((form) => [form.id, form]));
  }

  const submissionsById = new Map(submissionRows.map((submission) => [submission.id, submission]));

  return rows.map((entry) => {
    const submissionId = normalizeUuid(entry?.latest_submission_id || entry?.metadata?.form_submission_id);
    const submission = submissionsById.get(submissionId);
    if (!submission) {
      return entry;
    }

    const metadata = normalizeJsonObject(submission.metadata, {});
    const answers = normalizeJsonObject(submission.answers, {});
    const customAnswers = normalizeJsonObject(answers.custom_answers, {});
    const schemaSnapshot = normalizeFormSchema(normalizeJsonObject(metadata.schema_snapshot, {}));
    const hydratedCustomAnswers = hydrateAnswersForReview({
      formSchema: schemaSnapshot,
      answers: customAnswers,
      env,
    });
    const answerCount = Object.values(hydratedCustomAnswers).filter(hasReviewableAnswer).length;
    const alertFlags = normalizeJsonObject(submission.alert_flags, {});
    const alertHits = Array.isArray(alertFlags.hits) ? alertFlags.hits : [];

    return {
      ...entry,
      intake_submission: {
        id: submission.id,
        form_id: submission.form_id || null,
        form_name: formsById.get(submission.form_id)?.name || null,
        submitted_at: submission.submitted_at || metadata.submitted_at || null,
        published_version: Number.isFinite(Number(metadata.published_version_at_submission))
          ? Number(metadata.published_version_at_submission)
          : Number.isFinite(Number(metadata.published_version))
            ? Number(metadata.published_version)
            : null,
        schema_snapshot: schemaSnapshot,
        visibility_rules_snapshot: normalizeVisibilityRules(metadata.visibility_rules_snapshot),
        alert_flags: alertFlags,
        alert_count: alertHits.length || (alertFlags.has_red_flags ? 1 : 0),
        answer_count: answerCount,
        custom_answers: hydratedCustomAnswers,
        answer_search_text: Object.values(hydratedCustomAnswers).map(serializeAnswerForSearch).filter(Boolean).join(' '),
      },
    };
  });
}

function buildWaitingListSelect() {
  return [
    'id',
    'client_profile_id',
    'student_id',
    'latest_submission_id',
    'desired_service_id',
    'preferred_days',
    'preferred_times',
    'priority_flag',
    'notes',
    'status',
    'created_at',
    'metadata',
    'student:students(id, client_profile_id)',
    'client_profile:client_profiles(id, first_name, middle_name, last_name, identity_number, phone, email, onboarding_status, is_active, tags)',
    'service:Services(id, name)',
  ].join(',');
}

async function writeTenantAudit(context, client, params) {
  try {
    await logTenantAuditEvent(client, params);
  } catch (auditError) {
    context.log?.warn?.('waiting-list failed to write tenant audit event', {
      message: auditError?.message,
      eventType: params?.eventType,
      resourceType: params?.resourceType,
      resourceId: params?.resourceId,
    });
  }
}

export default async function waitingList(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT'].includes(method)) {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET,POST,PUT' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('waiting-list missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('waiting-list failed to validate token', { message: error?.message });
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
  } catch (membershipError) {
    context.log?.error?.('waiting-list failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (!isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (method === 'GET') {
    const rawStatus = req?.query?.status ?? body?.status ?? 'active';
    const statusFilter = normalizeStatus(rawStatus, { allowAll: true }) || 'active';

    if (!statusFilter) {
      return respond(context, 400, { message: 'invalid_status_filter' });
    }

    let builder = withOrgScope(supabase, 'waiting_list_entries', orgId)
      .select(buildWaitingListSelect())
      .order('priority_flag', { ascending: false })
      .order('created_at', { ascending: false });

    if (statusFilter === 'active') {
      builder = builder.in('status', ['new', 'open']);
    } else if (statusFilter !== 'all') {
      builder = builder.eq('status', statusFilter);
    }

    const { data, error } = await builder;
    if (error) {
      context.log?.error?.('waiting-list failed to fetch entries', { message: error.message });
      return respond(context, 500, { message: 'failed_to_load_waiting_list' });
    }

    try {
      const enrichedRows = await enrichWaitingListEntriesWithIntakeSubmissions(supabase, orgId, data, env);
      return respond(context, 200, enrichedRows);
    } catch (submissionError) {
      context.log?.error?.('waiting-list failed to enrich intake submissions', { message: submissionError?.message });
      return respond(context, 500, { message: 'failed_to_load_waiting_list' });
    }
  }

  if (method === 'POST') {
    const clientProfileId = normalizeUuid(body?.client_profile_id || body?.clientProfileId);
    const studentId = normalizeUuid(body?.student_id || body?.studentId);
    const serviceId = normalizeUuid(body?.desired_service_id || body?.desiredServiceId || body?.service_id || body?.serviceId);
    const preferredDays = normalizePreferredDays(body?.preferred_days ?? body?.preferredDays);
    const preferredTimes = normalizePreferredTimes(body?.preferred_times ?? body?.preferredTimes);
    const priorityFlag = normalizeBoolean(body?.priority_flag ?? body?.priorityFlag ?? body?.priority, false);
    const notes = normalizeString(body?.notes) || null;
    const rawStatus = normalizeString(body?.status);
    const status = rawStatus ? normalizeStatus(rawStatus) : 'open';

    if (!clientProfileId && !studentId) {
      return respond(context, 400, { message: 'invalid_client_profile_id' });
    }

    if (!serviceId) {
      return respond(context, 400, { message: 'invalid_service_id' });
    }

    if (!status) {
      return respond(context, 400, { message: 'invalid_status' });
    }

    const payload = {
      client_profile_id: clientProfileId || null,
      student_id: studentId || null,
      desired_service_id: serviceId,
      preferred_days: preferredDays,
      preferred_times: preferredTimes,
      priority_flag: priorityFlag,
      notes,
      status,
    };

    const { data, error } = await withOrgScope(supabase, 'waiting_list_entries', orgId)
      .insert(payload)
      .select(buildWaitingListSelect())
      .single();

    if (error) {
      context.log?.error?.('waiting-list failed to create entry', { message: error.message });
      return respond(context, 500, { message: 'failed_to_create_waiting_list' });
    }

    await writeTenantAudit(context, supabase, {
      correlationId: randomUUID(),
      actorUserId: userId,
      eventType: 'waiting_list.entry.created',
      retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
      resourceType: 'waiting_list_entry',
      resourceId: data.id,
      afterState: data,
      details: {
        origin: 'api/waiting-list',
      },
    });

    return respond(context, 200, data);
  }

  const entryId = normalizeUuid(req?.params?.entryId || body?.id || body?.entry_id || body?.entryId);
  if (!entryId) {
    return respond(context, 400, { message: 'invalid_entry_id' });
  }

  const updates = {};

  if ('student_id' in body || 'studentId' in body) {
    const studentId = normalizeUuid(body?.student_id || body?.studentId);
    if ((body?.student_id || body?.studentId) && !studentId) {
      return respond(context, 400, { message: 'invalid_student_id' });
    }
    updates.student_id = studentId || null;
  }

  if ('client_profile_id' in body || 'clientProfileId' in body) {
    const clientProfileId = normalizeUuid(body?.client_profile_id || body?.clientProfileId);
    if ((body?.client_profile_id || body?.clientProfileId) && !clientProfileId) {
      return respond(context, 400, { message: 'invalid_client_profile_id' });
    }
    updates.client_profile_id = clientProfileId;
  }

  if ('desired_service_id' in body || 'desiredServiceId' in body || 'service_id' in body || 'serviceId' in body) {
    const serviceId = normalizeUuid(body?.desired_service_id || body?.desiredServiceId || body?.service_id || body?.serviceId);
    if (!serviceId) {
      return respond(context, 400, { message: 'invalid_service_id' });
    }
    updates.desired_service_id = serviceId;
  }

  if ('preferred_days' in body || 'preferredDays' in body) {
    const preferredDays = normalizePreferredDays(body?.preferred_days ?? body?.preferredDays);
    updates.preferred_days = preferredDays;
  }

  if ('preferred_times' in body || 'preferredTimes' in body) {
    const preferredTimes = normalizePreferredTimes(body?.preferred_times ?? body?.preferredTimes);
    updates.preferred_times = preferredTimes;
  }

  if ('priority_flag' in body || 'priorityFlag' in body || 'priority' in body) {
    updates.priority_flag = normalizeBoolean(body?.priority_flag ?? body?.priorityFlag ?? body?.priority, false);
  }

  if ('notes' in body) {
    updates.notes = normalizeString(body?.notes) || null;
  }

  if ('status' in body) {
    const status = normalizeStatus(body?.status);
    if (!status) {
      return respond(context, 400, { message: 'invalid_status' });
    }
    updates.status = status;
  }

  if (Object.keys(updates).length === 0) {
    return respond(context, 400, { message: 'missing_updates' });
  }

  const { data: existingEntry, error: existingEntryError } = await withOrgScope(supabase, 'waiting_list_entries', orgId)
    .select(buildWaitingListSelect())
    .eq('id', entryId)
    .maybeSingle();

  if (existingEntryError) {
    context.log?.error?.('waiting-list failed to load entry before update', { message: existingEntryError.message });
    return respond(context, 500, { message: 'failed_to_load_waiting_list' });
  }

  if (!existingEntry) {
    return respond(context, 404, { message: 'waiting_list_entry_not_found' });
  }

  const { data, error } = await withOrgScope(supabase, 'waiting_list_entries', orgId)
    .update(updates)
    .eq('id', entryId)
    .select(buildWaitingListSelect())
    .single();

  if (error) {
    context.log?.error?.('waiting-list failed to update entry', { message: error.message });
    return respond(context, 500, { message: 'failed_to_update_waiting_list' });
  }

  const auditEventType = updates.status === 'open' && existingEntry.status === 'new'
    ? 'waiting_list.entry.reviewed'
    : updates.status === 'new' && existingEntry.status === 'open'
      ? 'waiting_list.entry.marked_unreviewed'
      : 'waiting_list.entry.updated';

  await writeTenantAudit(context, supabase, {
    correlationId: randomUUID(),
    actorUserId: userId,
    eventType: auditEventType,
    retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
    resourceType: 'waiting_list_entry',
    resourceId: entryId,
    beforeState: existingEntry,
    afterState: data,
    details: {
      origin: 'api/waiting-list',
      updated_fields: Object.keys(updates),
      status_transition: Object.prototype.hasOwnProperty.call(updates, 'status')
        ? { from: existingEntry.status, to: updates.status }
        : null,
    },
  });

  return respond(context, 200, data);
}
