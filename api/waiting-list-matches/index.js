/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminOrOffice,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  withOrgScope,
} from '../_shared/org-bff.js';
import {
  buildCapabilityMap,
  buildInstructorMap,
  buildLiveWaitingListMatches,
  buildTemplatesByInstructorDay,
  buildWaitingListEntrySelect,
  isTemplateValidOn,
  normalizeMatchMode,
  parseIsoDateInTimezone,
} from '../_shared/waiting-list-matching.js';

const VALID_SCOPES = new Set(['dashboard', 'template_manager']);

function normalizeScope(value) {
  const normalized = normalizeString(value).toLowerCase();
  return VALID_SCOPES.has(normalized) ? normalized : 'dashboard';
}

function mergeSummaries(capacity, clearSpace) {
  return {
    capacity: capacity.summary,
    clear_space: clearSpace.summary,
    total_matchable_entries: Math.max(
      Number(capacity.summary?.matchable_entries) || 0,
      Number(clearSpace.summary?.matchable_entries) || 0,
    ),
    priority_entries: Math.max(
      Number(capacity.summary?.priority_entries) || 0,
      Number(clearSpace.summary?.priority_entries) || 0,
    ),
    oldest_wait_days: Math.max(
      Number(capacity.summary?.oldest_wait_days) || 0,
      Number(clearSpace.summary?.oldest_wait_days) || 0,
    ),
  };
}

export default async function waitingListMatches(context, req) {
  if (String(req.method || 'GET').toUpperCase() !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('waiting-list-matches missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('waiting-list-matches failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);
  const scope = normalizeScope(req?.query?.scope || body?.scope);
  const mode = normalizeMatchMode(req?.query?.mode || body?.mode, 'capacity');

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('waiting-list-matches failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role || !isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const { data: entries, error: entriesError } = await withOrgScope(supabase, 'waiting_list_entries', orgId)
    .select(buildWaitingListEntrySelect())
    .in('status', ['new', 'open']);

  if (entriesError) {
    context.log?.error?.('waiting-list-matches failed to load waiting-list entries', { message: entriesError.message });
    return respond(context, 500, { message: 'failed_to_load_waiting_list' });
  }

  const activeEntries = Array.isArray(entries) ? entries.filter((entry) => entry.desired_service_id) : [];
  if (!activeEntries.length) {
    return respond(context, 200, {
      scope,
      mode,
      summary: scope === 'dashboard'
        ? mergeSummaries(
            { summary: { matchable_entries: 0, priority_entries: 0, oldest_wait_days: 0, services: [] } },
            { summary: { matchable_entries: 0, priority_entries: 0, oldest_wait_days: 0, services: [] } },
          )
        : { matchable_entries: 0, priority_entries: 0, oldest_wait_days: 0, services: [] },
      template_matches: {},
      cell_matches: {},
      candidates: [],
    });
  }

  const [{ data: instructorRows, error: instructorError }] = await Promise.all([
    withOrgScope(supabase, 'Employees', orgId)
      .select('id, first_name, middle_name, last_name, is_active')
      .eq('is_active', true),
  ]);

  if (instructorError) {
    context.log?.error?.('waiting-list-matches failed to load instructors', { message: instructorError.message });
    return respond(context, 500, { message: 'failed_to_load_instructors' });
  }

  const instructorIds = Array.isArray(instructorRows) ? instructorRows.map((row) => row.id).filter(Boolean) : [];
  if (!instructorIds.length) {
    return respond(context, 200, {
      scope,
      mode,
      summary: { matchable_entries: 0, priority_entries: 0, oldest_wait_days: 0, services: [] },
      template_matches: {},
      cell_matches: {},
      candidates: [],
    });
  }

  const serviceDurationMap = new Map(
    activeEntries.map((entry) => [entry.desired_service_id, Number(entry?.service?.duration_minutes) || 60]),
  );
  const serviceIds = Array.from(serviceDurationMap.keys()).filter(Boolean);

  const [capabilityResult, templateResult] = await Promise.all([
    withOrgScope(supabase, 'instructor_service_capabilities', orgId)
      .select('employee_id, service_id, max_students, availability_windows')
      .in('service_id', serviceIds)
      .in('employee_id', instructorIds),
    withOrgScope(supabase, 'lesson_templates', orgId)
      .select('id, student_id, instructor_employee_id, service_id, day_of_week, time_of_day, duration_minutes, valid_from, valid_until, is_active')
      .eq('is_active', true)
      .in('instructor_employee_id', instructorIds),
  ]);

  if (capabilityResult.error) {
    context.log?.error?.('waiting-list-matches failed to load service capabilities', { message: capabilityResult.error.message });
    return respond(context, 500, { message: 'failed_to_load_instructor_capabilities' });
  }

  if (templateResult.error) {
    context.log?.error?.('waiting-list-matches failed to load lesson templates', { message: templateResult.error.message });
    return respond(context, 500, { message: 'failed_to_load_lesson_templates' });
  }

  const today = parseIsoDateInTimezone();
  const instructorMap = buildInstructorMap(instructorRows || []);
  const capabilityMap = buildCapabilityMap(capabilityResult.data || [], serviceDurationMap);
  const validTemplates = (templateResult.data || []).filter((template) => isTemplateValidOn(template, today));
  const templatesByInstructorDay = buildTemplatesByInstructorDay(validTemplates);

  if (scope === 'dashboard') {
    const capacity = buildLiveWaitingListMatches({
      entries: activeEntries,
      mode: 'capacity',
      capabilityMap,
      instructorMap,
      validTemplates,
      templatesByInstructorDay,
    });
    const clearSpace = buildLiveWaitingListMatches({
      entries: activeEntries,
      mode: 'clear_space',
      capabilityMap,
      instructorMap,
      validTemplates,
      templatesByInstructorDay,
    });

    return respond(context, 200, {
      scope,
      mode: 'combined',
      summary: mergeSummaries(capacity, clearSpace),
      modes: {
        capacity,
        clear_space: clearSpace,
      },
    });
  }

  const matches = buildLiveWaitingListMatches({
    entries: activeEntries,
    mode,
    capabilityMap,
    instructorMap,
    validTemplates,
    templatesByInstructorDay,
  });

  return respond(context, 200, {
    scope,
    ...matches,
  });
}
