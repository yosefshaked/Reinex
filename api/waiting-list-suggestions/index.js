/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
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
import { hasConfiguredAvailability } from '../_shared/instructor-availability.js';
import {
  buildCapabilityMap,
  buildInstructorMap,
  buildSuggestionsForEntry,
  buildTemplatesByInstructorDay,
  buildWaitingListEntrySelect,
  formatWaitingListPersonName,
  isTemplateValidOn,
  normalizeMatchMode,
  parseIsoDateInTimezone,
} from '../_shared/waiting-list-matching.js';
import { attachErrorTracking, respondTracked } from '../_shared/error-events.js';

const MAX_SUGGESTIONS = 18;

function respondWaitingListSuggestionError(context, status, message, error, metadata = {}) {
  return respondTracked(context, status, { message }, undefined, {
    error,
    metadata,
  });
}

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

export default async function waitingListSuggestions(context, req) {
  if (String(req.method || 'GET').toUpperCase() !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('waiting-list-suggestions missing Supabase admin credentials');
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
    context.log?.error?.('waiting-list-suggestions failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const userId = authResult.data.user.id;
  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);
  const entryId = normalizeUuid(req?.query?.entry_id || body?.entry_id || body?.entryId);
  const rawMode = normalizeString(req?.query?.mode || body?.mode);
  const mode = rawMode === 'empty_slots'
    ? 'clear_space'
    : normalizeMatchMode(rawMode, 'capacity');

  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  if (!entryId) {
    return respond(context, 400, { message: 'invalid_entry_id' });
  }

  attachErrorTracking(context, req, supabase, {
    orgId,
    userId,
    metadata: { endpoint: 'waiting-list-suggestions', entry_id: entryId, mode },
  });

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('waiting-list-suggestions failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respondWaitingListSuggestionError(context, 500, 'failed_to_verify_membership', membershipError, {
      action: 'verify_membership',
    });
  }

  if (!role || !isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const { data: entry, error: entryError } = await withOrgScope(supabase, 'waiting_list_entries', orgId)
    .select(buildWaitingListEntrySelect())
    .eq('id', entryId)
    .maybeSingle();

  if (entryError) {
    context.log?.error?.('waiting-list-suggestions failed to load entry', { message: entryError.message, entryId });
    return respondWaitingListSuggestionError(context, 500, 'failed_to_load_waiting_list_entry', entryError, {
      action: 'load_waiting_list_entry',
      entry_id: entryId,
    });
  }

  if (!entry) {
    return respond(context, 404, { message: 'waiting_list_entry_not_found' });
  }

  if (!entry.desired_service_id) {
    return respond(context, 400, { message: 'waiting_list_entry_missing_service' });
  }

  const today = parseIsoDateInTimezone();

  const { data: instructorRows, error: instructorError } = await withOrgScope(supabase, 'Employees', orgId)
    .select('id, first_name, middle_name, last_name, is_active')
    .eq('is_active', true);

  if (instructorError) {
    context.log?.error?.('waiting-list-suggestions failed to load instructors', { message: instructorError.message });
    return respondWaitingListSuggestionError(context, 500, 'failed_to_load_instructors', instructorError, {
      action: 'load_active_instructors',
      entry_id: entryId,
    });
  }

  const instructorIds = Array.isArray(instructorRows) ? instructorRows.map((row) => row.id).filter(Boolean) : [];
  if (!instructorIds.length) {
    return respond(context, 200, {
      mode,
      entry_id: entry.id,
      suggestions: [],
      blocking_reason: 'missing_service_capability',
      fix_availability_targets: [],
    });
  }

  const [
    capabilityResult,
    templateResult,
  ] = await Promise.all([
    withOrgScope(supabase, 'instructor_service_capabilities', orgId)
      .select('employee_id, service_id, max_students, availability_windows')
      .eq('service_id', entry.desired_service_id)
      .in('employee_id', instructorIds),
    withOrgScope(supabase, 'lesson_templates', orgId)
      .select('id, student_id, instructor_employee_id, service_id, day_of_week, time_of_day, duration_minutes, valid_from, valid_until, is_active')
      .eq('is_active', true)
      .in('instructor_employee_id', instructorIds),
  ]);

  if (capabilityResult.error) {
    context.log?.error?.('waiting-list-suggestions failed to load service capabilities', { message: capabilityResult.error.message });
    return respondWaitingListSuggestionError(context, 500, 'failed_to_load_instructor_capabilities', capabilityResult.error, {
      action: 'load_instructor_capabilities',
      entry_id: entryId,
      service_id: entry.desired_service_id,
      instructor_ids: instructorIds,
    });
  }

  if (templateResult.error) {
    context.log?.error?.('waiting-list-suggestions failed to load lesson templates', { message: templateResult.error.message });
    return respondWaitingListSuggestionError(context, 500, 'failed_to_load_lesson_templates', templateResult.error, {
      action: 'load_lesson_templates',
      entry_id: entryId,
      instructor_ids: instructorIds,
    });
  }

  const instructorMap = buildInstructorMap(instructorRows || []);
  const serviceDurationMap = new Map([[entry.desired_service_id, Number(entry?.service?.duration_minutes) || 60]]);
  const capabilityMap = buildCapabilityMap(capabilityResult.data || [], serviceDurationMap);
  const validTemplates = (templateResult.data || []).filter((template) => isTemplateValidOn(template, today));
  const templatesByInstructorDay = buildTemplatesByInstructorDay(validTemplates);

  const suggestions = buildSuggestionsForEntry({
    entry,
    mode,
    capabilityMap,
    instructorMap,
    validTemplates,
    templatesByInstructorDay,
  });

  const incompleteTargets = (capabilityResult.data || [])
    .filter((row) => !hasConfiguredAvailability(row.availability_windows))
    .map((row) => ({
      instructor_id: row.employee_id,
      instructor_name: formatWaitingListPersonName(instructorMap.get(row.employee_id)),
      service_id: row.service_id,
      entry_id: entry.id,
      origin: 'waiting_list',
      fix_type: 'missing_service_availability',
    }));
  const missingCapabilityTargets = (capabilityResult.data || []).length === 0
    ? (instructorRows || []).map((row) => ({
        instructor_id: row.id,
        instructor_name: formatWaitingListPersonName(instructorMap.get(row.id)),
        service_id: entry.desired_service_id,
        entry_id: entry.id,
        origin: 'waiting_list',
        fix_type: 'missing_service_capability',
      }))
    : [];
  const hasConfiguredCapability = (capabilityResult.data || []).some((row) => hasConfiguredAvailability(row.availability_windows));
  const blockingReason = suggestions.length > 0
    ? null
    : incompleteTargets.length > 0
      ? 'missing_service_availability'
      : hasConfiguredCapability
        ? 'no_matching_slots'
        : 'missing_service_capability';

  return respond(context, 200, {
    mode: mode === 'clear_space' ? 'empty_slots' : mode,
    canonical_mode: mode,
    entry_id: entry.id,
    suggestions: suggestions.slice(0, MAX_SUGGESTIONS),
    blocking_reason: blockingReason,
    fix_availability_targets: suggestions.length === 0
      ? (blockingReason === 'missing_service_capability' ? missingCapabilityTargets : incompleteTargets)
      : [],
  });
}
