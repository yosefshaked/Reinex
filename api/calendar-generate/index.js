/* eslint-env node */
import crypto from 'node:crypto';
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import {
  ensureMembership,
  isAdminOrOffice,
  normalizeString,
  readEnv,
  respond,
  resolveOrgId,
  withOrgScope,
} from '../_shared/org-bff.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';
import { dayTokenForDate, normalizeDayToken } from '../_shared/day-of-week.js';
import { breakTemplateMatchesDate, normalizeBreakTemplateTime } from '../_shared/break-template-schedule.js';
import {
  buildUtcBoundsForTimezoneDateRange,
  buildUtcIsoForTimezoneDateTime,
  extractScheduleSlotFromIso,
  getDateKeyInTimezone,
} from '../_shared/instructor-availability.js';
import { resolveLessonCoverageDecision } from '../_shared/hmo.js';
import { attachErrorTracking, respondTracked } from '../_shared/error-events.js';


const MAX_BODY_BYTES = 128 * 1024;
const MAX_GENERATION_DAYS = 31;

function isIsoDate(value) {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim());
}

function enumerateDates(startDate, endDate) {
  const dates = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function normalizeTimeHms(timeValue) {
  const raw = normalizeString(timeValue);
  if (!raw) return '';

  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return '';

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);

  if (
    !Number.isInteger(hour)
    || !Number.isInteger(minute)
    || !Number.isInteger(second)
    || hour < 0
    || hour > 23
    || minute < 0
    || minute > 59
    || second < 0
    || second > 59
  ) {
    return '';
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

function extractDatePart(dateTimeValue) {
  const raw = String(dateTimeValue || '');
  if (raw.length >= 10) {
    return raw.slice(0, 10);
  }
  return '';
}

function extractTimePart(dateTimeValue) {
  const raw = String(dateTimeValue || '');
  const match = raw.match(/T(\d{2}:\d{2}:\d{2})/);
  if (match?.[1]) {
    return match[1];
  }
  return '';
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function isCancelledStatus(statusValue) {
  const status = String(statusValue || '').trim().toLowerCase();
  return status.startsWith('cancelled');
}

function templateRangeContainsDate(template, dateString) {
  const validFrom = normalizeString(template?.valid_from) || '0001-01-01';
  const validUntil = normalizeString(template?.valid_until) || '9999-12-31';
  return validFrom <= dateString && dateString <= validUntil;
}

function buildInstanceInterval(instanceRow) {
  const start = new Date(instanceRow.datetime_start);
  const durationMinutes = Number(instanceRow.duration_minutes || 0);
  const end = new Date(start.getTime() + durationMinutes * 60000);

  return {
    id: instanceRow.id,
    template_id: instanceRow.template_id || null,
    instructor_employee_id: instanceRow.instructor_employee_id || null,
    service_id: instanceRow.service_id || null,
    status: instanceRow.status || null,
    startMs: start.getTime(),
    endMs: end.getTime(),
    studentIds: Array.isArray(instanceRow.participants)
      ? instanceRow.participants.map((p) => p.student_id).filter(Boolean)
      : [],
    participantCount: Array.isArray(instanceRow.participants) ? instanceRow.participants.length : 0,
  };
}

function candidateInterval(candidate) {
  const start = new Date(candidate.datetime_start);
  const end = new Date(start.getTime() + Number(candidate.duration_minutes) * 60000);

  return {
    id: null,
    template_id: candidate.template_id,
    instructor_employee_id: candidate.instructor_employee_id,
    service_id: candidate.service_id,
    status: 'scheduled',
    startMs: start.getTime(),
    endMs: end.getTime(),
    studentIds: [candidate.student_id],
    participantCount: 1,
  };
}

function resolveOverrideMap(overridesRows) {
  const map = new Map();
  for (const row of overridesRows || []) {
    if (!row?.template_id || !row?.target_date) continue;
    map.set(`${row.template_id}|${row.target_date}`, row);
  }
  return map;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

function generateRunId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function buildStudentName(profile) {
  if (!profile || typeof profile !== 'object') {
    return '';
  }
  return [profile.first_name, profile.middle_name, profile.last_name].filter(Boolean).join(' ').trim();
}

function buildServiceName(service) {
  return normalizeString(service?.name) || normalizeString(service?.service_name) || '';
}

function normalizeRetryItems(value) {
  if (!Array.isArray(value)) {
    return { items: [], valid: value == null };
  }

  const seen = new Set();
  const items = [];

  for (const entry of value) {
    const templateId = normalizeString(entry?.template_id || entry?.templateId);
    const targetDate = normalizeString(entry?.target_date || entry?.targetDate);
    if (!templateId || !targetDate || !isIsoDate(targetDate)) {
      return { items: [], valid: false };
    }

    const key = `${templateId}|${targetDate}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push({ template_id: templateId, target_date: targetDate });
  }

  return { items, valid: true };
}

function buildRetryLookup(items) {
  const map = new Map();
  for (const item of items || []) {
    if (!item?.template_id || !item?.target_date) continue;
    if (!map.has(item.template_id)) {
      map.set(item.template_id, new Set());
    }
    map.get(item.template_id).add(item.target_date);
  }
  return map;
}

function buildRetryItem(templateId, targetDate) {
  return {
    template_id: templateId || null,
    target_date: targetDate || null,
  };
}

function buildTemplateSlotKey(templateId, targetDate, timeOfDay) {
  const normalizedTemplateId = normalizeString(templateId);
  const normalizedTargetDate = normalizeString(targetDate);
  const normalizedTime = normalizeTimeHms(timeOfDay);
  if (!normalizedTemplateId || !normalizedTargetDate || !normalizedTime) {
    return '';
  }
  return `${normalizedTemplateId}|${normalizedTargetDate}|${normalizedTime}`;
}

function buildRepairTargets(entry) {
  const targets = [];
  const studentId = normalizeString(entry?.student_id);
  const templateId = normalizeString(entry?.template_id);

  if (studentId) {
    targets.push({
      type: 'student_profile',
      label: 'student_profile',
      student_id: studentId,
      path: `/students/${studentId}/overview`,
    });
  }

  if (templateId) {
    targets.push({
      type: 'template_edit',
      label: 'template_edit',
      template_id: templateId,
      path: `/calendar/templates?edit_template_id=${templateId}`,
    });
  }

  return targets;
}

function buildIssueMessage(entry) {
  const directMessage = normalizeString(entry?.message);
  if (directMessage) {
    return directMessage;
  }

  if (Array.isArray(entry?.issues) && entry.issues.length > 0) {
    const issueMessages = entry.issues
      .map((issue) => normalizeString(issue?.message) || normalizeString(issue?.type))
      .filter(Boolean);
    if (issueMessages.length > 0) {
      return issueMessages.join(' | ');
    }
  }

  return normalizeString(entry?.type) || 'generation_issue';
}

function buildActionableIssues({ conflicts, applied }) {
  const conflictIssues = Array.isArray(conflicts)
    ? conflicts.map((entry) => ({
      source: 'preview_conflict',
      issue_type: normalizeString(entry?.type) || normalizeString(entry?.issues?.[0]?.type) || 'generation_conflict',
      issue_types: Array.isArray(entry?.issues)
        ? entry.issues.map((issue) => normalizeString(issue?.type)).filter(Boolean)
        : [],
      message: buildIssueMessage(entry),
      template_id: normalizeString(entry?.template_id) || null,
      student_id: normalizeString(entry?.student_id) || null,
      student_name: normalizeString(entry?.student_name) || '',
      client_profile_id: normalizeString(entry?.client_profile_id) || null,
      service_name: normalizeString(entry?.service_name) || '',
      datetime_start: normalizeString(entry?.datetime_start) || null,
      target_date: normalizeString(entry?.target_date) || null,
      time_of_day: normalizeString(entry?.time_of_day) || extractTimePart(entry?.datetime_start) || null,
      retry_item: entry?.retry_item?.template_id && entry?.retry_item?.target_date
        ? {
          template_id: entry.retry_item.template_id,
          target_date: entry.retry_item.target_date,
        }
        : null,
      repair_targets: Array.isArray(entry?.repair_targets) && entry.repair_targets.length > 0
        ? entry.repair_targets
        : buildRepairTargets(entry),
    }))
    : [];

  const applyIssues = Array.isArray(applied?.errors)
    ? applied.errors.map((entry) => ({
      source: 'apply_error',
      issue_type: normalizeString(entry?.type) || 'apply_error',
      issue_types: [normalizeString(entry?.type) || 'apply_error'],
      message: buildIssueMessage(entry),
      template_id: normalizeString(entry?.template_id) || null,
      student_id: normalizeString(entry?.student_id) || null,
      student_name: normalizeString(entry?.student_name) || '',
      client_profile_id: normalizeString(entry?.client_profile_id) || null,
      service_name: normalizeString(entry?.service_name) || '',
      datetime_start: normalizeString(entry?.datetime_start) || null,
      target_date: normalizeString(entry?.target_date) || null,
      time_of_day: normalizeString(entry?.time_of_day) || extractTimePart(entry?.datetime_start) || null,
      retry_item: entry?.retry_item?.template_id && entry?.retry_item?.target_date
        ? {
          template_id: entry.retry_item.template_id,
          target_date: entry.retry_item.target_date,
        }
        : null,
      repair_targets: buildRepairTargets(entry),
    }))
    : [];

  // HMO warnings (source: 'hmo_warning') are intentionally excluded from actionable_issues.
  // They are informational — the lesson slot was already added to proposals before the HMO
  // coverage check runs, so no lesson creation was blocked.  They are surfaced via the
  // dedicated `warnings` array and the hmo_coverage_warnings summary counter.

  return [...conflictIssues, ...applyIssues];
}

function buildCoverageWarningFromDecision(candidate, coverageDecision) {
  if (!coverageDecision || coverageDecision.status === 'covered') {
    return null;
  }

  const targetDate = normalizeString(candidate?.target_date) || extractDatePart(candidate?.datetime_start);
  const reason = normalizeString(coverageDecision.reason) || 'coverage_warning';
  if (reason === 'no_authorization_found') {
    return null;
  }

  let message = 'קיים סיכון שהחיוב האוטומטי לא יתבצע לפי כיסוי גורם מממן.';
  if (reason === 'no_active_authorization') {
    message = 'קיימת הרשאה לשירות אך היא אינה פעילה. החיוב יתבצע כחיוב רגיל.';
  } else if (reason === 'no_active_authorization_for_date') {
    message = 'קיימת הרשאה פעילה לשירות אך טווח התאריכים שלה אינו מכסה את המועד שנוצר.';
  } else if (reason === 'authorization_conflict') {
    message = 'נמצאו שתי הרשאות חופפות לאותו שיעור. החיוב ייחסם עד לסידור ההתנגשות.';
  } else if (reason === 'authorization_exhausted') {
    message = coverageDecision.post_coverage_policy === 'manual_block'
      ? 'מכסת ההרשאה נוצלה במלואה והמסלול מוגדר לחסימה ידנית אחרי מיצוי הזכאות.'
      : 'מכסת ההרשאה נוצלה במלואה, והשיעור הבא יעבור אוטומטית למדיניות המשך.';
  } else if (reason === 'missing_authorization_pricing') {
    message = 'האישור חסר מחירי כיסוי מפורשים ולכן החיוב ייחסם.';
  } else if (reason === 'missing_post_coverage_policy') {
    message = 'האישור חסר מדיניות המשך מלאה לאחר מיצוי הזכאות.';
  }

  return {
    type: 'hmo_authorization_gap',
    severity: coverageDecision.status === 'blocked' ? 'error' : 'warning',
    reason,
    student_id: candidate.student_id,
    student_name: candidate.student_name || '',
    client_profile_id: candidate.client_profile_id || null,
    service_id: candidate.service_id,
    service_name: candidate.service_name || '',
    template_id: candidate.template_id || null,
    target_date: targetDate,
    time_of_day: normalizeString(candidate.time_of_day) || extractTimePart(candidate.datetime_start) || null,
    datetime_start: candidate.datetime_start,
    authorization_id: coverageDecision.authorization_id || null,
    message,
    retry_item: candidate.retry_item || null,
    repair_targets: [
      ...(candidate.student_id ? [{
        type: 'student_profile',
        label: 'student_finance',
        student_id: candidate.student_id,
        path: `/students/${candidate.student_id}/financial`,
      }] : []),
      ...(candidate.template_id ? [{
        type: 'template_edit',
        label: 'template_edit',
        template_id: candidate.template_id,
        path: `/calendar/templates?edit_template_id=${candidate.template_id}`,
      }] : []),
    ],
  };
}

function collectCandidateConflicts(candidate, candidateIntervalValue, intervals, maxStudents) {
  const found = [];

  for (const interval of intervals) {
    if (isCancelledStatus(interval.status)) {
      continue;
    }

    if (!overlaps(candidateIntervalValue.startMs, candidateIntervalValue.endMs, interval.startMs, interval.endMs)) {
      continue;
    }

    if (interval.instructor_employee_id === candidate.instructor_employee_id) {
      found.push({
        type: 'instructor_overlap',
        instance_id: interval.id,
        message: 'המדריך כבר משובץ בשיעור אחר בזמן זה.',
      });
    }

    // Check all template participants — any student already booked is a conflict.
    const participantIds = Array.isArray(candidate.template_participants)
      ? candidate.template_participants.map((p) => p.student_id).filter(Boolean)
      : (candidate.student_id ? [candidate.student_id] : []);
    for (const sid of participantIds) {
      if (interval.studentIds.includes(sid)) {
        found.push({
          type: 'student_overlap',
          instance_id: interval.id,
          student_id: sid,
          message: 'התלמיד כבר משובץ בשיעור אחר בזמן זה.',
        });
      }
    }
  }

  if (Number.isFinite(maxStudents) && maxStudents > 0) {
    const overlappingCount = intervals
      .filter((interval) => {
        if (isCancelledStatus(interval.status)) return false;
        if (interval.instructor_employee_id !== candidate.instructor_employee_id) return false;
        if (interval.service_id !== candidate.service_id) return false;
        return overlaps(candidateIntervalValue.startMs, candidateIntervalValue.endMs, interval.startMs, interval.endMs);
      })
      .reduce((sum, interval) => sum + Number(interval.participantCount || 0), 0);

    if (overlappingCount + 1 > maxStudents) {
      found.push({
        type: 'capacity_exceeded',
        message: `הקיבולת חורגת מהמקסימום לשירות זה (${overlappingCount + 1}/${maxStudents}).`,
        current_count: overlappingCount + 1,
        max_capacity: maxStudents,
      });
    }
  }

  return found;
}

function buildDiffResponse({
  generationRunId,
  startDate,
  endDate,
  requestMode,
  templatesConsidered,
  candidateSlots,
  proposals,
  conflicts,
  warnings,
  warningsNotice,
  skippedExisting,
  skippedOverrides,
  applied,
}) {
  const actionableIssues = buildActionableIssues({ conflicts, applied });
  return {
    generation_run_id: generationRunId,
    start_date: startDate,
    end_date: endDate,
    request_mode: requestMode || 'full_range',
    dry_run: !applied,
    summary: {
      templates_considered: templatesConsidered,
      candidate_slots: candidateSlots,
      to_insert_instances: proposals.length,
      skipped_existing: skippedExisting.length,
      skipped_overrides: skippedOverrides.length,
      conflicts: conflicts.length,
      hmo_coverage_warnings: Array.isArray(warnings) ? warnings.length : 0,
      applied_instances: applied ? applied.createdInstances.length : 0,
      applied_participants: applied ? applied.createdParticipants.length : 0,
      apply_errors: applied ? applied.errors.length : 0,
    },
    to_insert_instances: proposals,
    conflicts,
    warnings: warnings || [],
    warnings_notice: warningsNotice || null,
    skipped_existing: skippedExisting,
    skipped_overrides: skippedOverrides,
    applied: applied || null,
    actionable_issues: actionableIssues,
    retryable_failures: applied
      ? applied.errors
        .filter((entry) => entry?.retry_item?.template_id && entry?.retry_item?.target_date)
        .map((entry) => ({
          type: entry.type,
          message: entry.message,
          template_id: entry.template_id || null,
          student_id: entry.student_id || null,
          student_name: entry.student_name || '',
          client_profile_id: entry.client_profile_id || null,
          service_name: entry.service_name || '',
          datetime_start: entry.datetime_start || null,
          target_date: entry.target_date || null,
          time_of_day: entry.time_of_day || null,
          retry_item: entry.retry_item,
          repair_targets: buildRepairTargets(entry),
        }))
      : [],
  };
}

export default async function calendarGenerate(context, req) {
  const method = String(req.method || 'POST').toUpperCase();
  if (method !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('calendar/generate missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('calendar/generate failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const userId = authResult.data.user.id;
  const userEmail = normalizeString(authResult.data.user.email) || `missing-email-${userId}`;

  const body = parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'calendar/generate' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }
  attachErrorTracking(context, req, supabase, { orgId, userId, metadata: { endpoint: 'calendar-generate' } });

  const { items: retryItems, valid: retryItemsValid } = normalizeRetryItems(body?.retry_items || body?.retryItems);
  if (!retryItemsValid) {
    return respond(context, 400, { message: 'invalid_retry_items' });
  }

  let startDate = normalizeString(body?.start_date || body?.startDate);
  let endDate = normalizeString(body?.end_date || body?.endDate);
  const dryRun = parseBoolean(body?.dry_run ?? body?.dryRun, true);
  const requestMode = retryItems.length > 0 ? 'retry_failed' : 'full_range';

  if ((!isIsoDate(startDate) || !isIsoDate(endDate)) && retryItems.length > 0) {
    const sortedRetryDates = retryItems.map((item) => item.target_date).sort();
    startDate = sortedRetryDates[0] || '';
    endDate = sortedRetryDates[sortedRetryDates.length - 1] || '';
  }

  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    return respond(context, 400, { message: 'invalid_date_range' });
  }

  if (endDate < startDate) {
    return respond(context, 400, { message: 'invalid_date_range' });
  }

  const rangeDays = enumerateDates(startDate, endDate).length;
  if (rangeDays > MAX_GENERATION_DAYS) {
    return respond(context, 400, { message: 'date_range_too_large' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('calendar/generate failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respondTracked(context, 500, { message: 'failed_to_verify_membership' }, undefined, { error: membershipError });
  }

  if (!role || !isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const generationRunId = generateRunId();
  const retryLookup = buildRetryLookup(retryItems);
  const retryTemplateIds = retryItems.map((item) => item.template_id);

  let templatesQuery = withOrgScope(supabase, 'lesson_templates', orgId)
    .select('id, student_id, instructor_employee_id, service_id, day_of_week, time_of_day, duration_minutes, valid_from, valid_until, is_active')
    .eq('is_active', true)
    .lte('valid_from', endDate)
    .or(`valid_until.is.null,valid_until.gte.${startDate}`)
    .order('day_of_week', { ascending: true })
    .order('time_of_day', { ascending: true });

  if (retryTemplateIds.length > 0) {
    templatesQuery = templatesQuery.in('id', retryTemplateIds);
  }

  const { data: templates, error: templatesError } = await templatesQuery;

  if (templatesError) {
    context.log?.error?.('calendar/generate failed to load templates', { message: templatesError.message });
    return respondTracked(context, 500, { message: 'failed_to_load_templates' }, undefined, { error: templatesError });
  }

  const templateRows = Array.isArray(templates) ? templates : [];
  if (templateRows.length === 0) {
    return respond(context, 200, buildDiffResponse({
      generationRunId,
      startDate,
      endDate,
      templatesConsidered: 0,
      candidateSlots: 0,
      proposals: [],
      conflicts: [],
      warnings: [],
      warningsNotice: null,
      skippedExisting: [],
      skippedOverrides: [],
      applied: dryRun ? null : { createdInstances: [], createdParticipants: [], errors: [] },
    }));
  }

  // Load lesson_template_participants for all templates (new SSOT for multi-student).
  // Fall back to template.student_id for old records not yet migrated.
  const { data: templateParticipantRows, error: templateParticipantsError } = await withOrgScope(supabase, 'lesson_template_participants', orgId)
    .select('template_id, student_id')
    .in('template_id', templateRows.map((r) => r.id));

  if (templateParticipantsError) {
    context.log?.error?.('calendar/generate failed to load template participants', { message: templateParticipantsError.message });
    return respondTracked(context, 500, { message: 'failed_to_load_students' }, undefined, { error: templateParticipantsError });
  }

  // Build templateId -> [student_id, ...] map.
  // If a template has no rows in lesson_template_participants, fall back to student_id column.
  const participantsByTemplateId = new Map();
  for (const row of templateParticipantRows || []) {
    if (!row?.template_id || !row?.student_id) continue;
    const existing = participantsByTemplateId.get(row.template_id) || [];
    existing.push(row.student_id);
    participantsByTemplateId.set(row.template_id, existing);
  }
  // Apply fallback for templates with no participant rows (pre-migration)
  for (const template of templateRows) {
    if (!participantsByTemplateId.has(template.id) && template.student_id) {
      participantsByTemplateId.set(template.id, [template.student_id]);
    }
  }

  const templateStudentIds = Array.from(new Set(
    [...participantsByTemplateId.values()].flat().filter(Boolean),
  ));
  const { data: templateStudentRows, error: templateStudentsError } = templateStudentIds.length > 0
    ? await withOrgScope(supabase, 'students', orgId)
      .select('id, client_profile_id')
      .in('id', templateStudentIds)
    : { data: [], error: null };

  if (templateStudentsError) {
    context.log?.error?.('calendar/generate failed to load template students', { message: templateStudentsError.message });
    return respondTracked(context, 500, { message: 'failed_to_load_students' }, undefined, { error: templateStudentsError });
  }

  const templateClientProfileIds = Array.from(new Set((templateStudentRows || []).map((row) => normalizeString(row?.client_profile_id)).filter(Boolean)));
  const { data: templateClientProfiles, error: templateClientProfilesError } = templateClientProfileIds.length > 0
    ? await withOrgScope(supabase, 'client_profiles', orgId)
      .select('id, first_name, middle_name, last_name')
      .in('id', templateClientProfileIds)
    : { data: [], error: null };

  if (templateClientProfilesError) {
    context.log?.error?.('calendar/generate failed to load template client profiles', { message: templateClientProfilesError.message });
    return respondTracked(context, 500, { message: 'failed_to_load_students' }, undefined, { error: templateClientProfilesError });
  }

  const clientProfileIdByStudentId = new Map(
    (templateStudentRows || []).map((row) => [row.id, row.client_profile_id || null]),
  );
  const clientProfileById = new Map(
    (templateClientProfiles || []).map((row) => [row.id, row]),
  );
  const studentNameByStudentId = new Map(
    (templateStudentRows || []).map((row) => [
      row.id,
      buildStudentName(clientProfileById.get(row.client_profile_id || '')) || '',
    ]),
  );
  const serviceIds = Array.from(new Set(templateRows.map((row) => normalizeString(row?.service_id)).filter(Boolean)));
  const { data: serviceRows, error: servicesError } = serviceIds.length > 0
    ? await withOrgScope(supabase, 'Services', orgId)
      .select('id, name')
      .in('id', serviceIds)
    : { data: [], error: null };

  if (servicesError) {
    context.log?.error?.('calendar/generate failed to load services', { message: servicesError.message });
    return respondTracked(context, 500, { message: 'failed_to_load_services' }, undefined, { error: servicesError });
  }

  const serviceNameById = new Map(
    (serviceRows || []).map((row) => [row.id, buildServiceName(row)]),
  );
  let hmoWarningsNotice = templateStudentIds.length > 0 ? null : null;

  const templateIds = templateRows.map((row) => row.id);
  const instanceRangeBounds = buildUtcBoundsForTimezoneDateRange(startDate, endDate);
  if (!instanceRangeBounds?.startIso || !instanceRangeBounds?.endExclusiveIso) {
    return respond(context, 400, { message: 'invalid_generation_date_range' });
  }

  const [{ data: overridesRows, error: overridesError }, { data: existingRows, error: existingError }, { data: capabilitiesRows, error: capabilitiesError }] = await Promise.all([
    withOrgScope(supabase, 'lesson_template_overrides', orgId)
      .select('id, template_id, target_date, override_type, new_instructor_employee_id, new_service_id, new_time_of_day, new_duration_minutes, note')
      .in('template_id', templateIds)
      .gte('target_date', startDate)
      .lte('target_date', endDate),
    withOrgScope(supabase, 'lesson_instances', orgId)
      .select('id, template_id, datetime_start, duration_minutes, instructor_employee_id, service_id, status, participants:lesson_participants(student_id)')
      .gte('datetime_start', instanceRangeBounds.startIso)
      .lt('datetime_start', instanceRangeBounds.endExclusiveIso),
    withOrgScope(supabase, 'instructor_service_capabilities', orgId)
      .select('employee_id, service_id, max_students'),
  ]);

  if (overridesError) {
    context.log?.error?.('calendar/generate failed to load overrides', { message: overridesError.message });
    return respondTracked(context, 500, { message: 'failed_to_load_template_overrides' }, undefined, { error: overridesError });
  }

  if (existingError) {
    context.log?.error?.('calendar/generate failed to load existing instances', { message: existingError.message });
    return respondTracked(context, 500, { message: 'failed_to_load_instances' }, undefined, { error: existingError });
  }

  if (capabilitiesError) {
    context.log?.error?.('calendar/generate failed to load instructor capabilities', { message: capabilitiesError.message });
    return respondTracked(context, 500, { message: 'failed_to_load_capabilities' }, undefined, { error: capabilitiesError });
  }

  const overrideServiceIds = Array.from(new Set(
    (overridesRows || [])
      .map((row) => normalizeString(row?.new_service_id))
      .filter((serviceId) => serviceId && !serviceNameById.has(serviceId)),
  ));
  if (overrideServiceIds.length > 0) {
    const { data: overrideServiceRows, error: overrideServicesError } = await withOrgScope(supabase, 'Services', orgId)
      .select('id, name')
      .in('id', overrideServiceIds);
    if (overrideServicesError) {
      context.log?.error?.('calendar/generate failed to load override services', { message: overrideServicesError.message });
      return respondTracked(context, 500, { message: 'failed_to_load_services' }, undefined, { error: overrideServicesError });
    }
    for (const row of overrideServiceRows || []) {
      serviceNameById.set(row.id, buildServiceName(row));
    }
  }

  const overrideMap = resolveOverrideMap(overridesRows);

  const existingIntervals = (Array.isArray(existingRows) ? existingRows : [])
    .map((row) => buildInstanceInterval(row))
    .filter((interval) => Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs));

  const planningIntervals = [...existingIntervals];

  const existingTemplateSlotKeys = new Set(
    (Array.isArray(existingRows) ? existingRows : [])
      .map((row) => {
        const templateId = normalizeString(row?.template_id);
        const targetDate = getDateKeyInTimezone(row?.datetime_start);
        const slot = extractScheduleSlotFromIso(row?.datetime_start);
        return buildTemplateSlotKey(templateId, targetDate, slot?.startTime || '');
      })
      .filter(Boolean),
  );

  const capabilityMap = new Map();
  for (const row of capabilitiesRows || []) {
    if (!row?.employee_id || !row?.service_id) continue;
    capabilityMap.set(`${row.employee_id}|${row.service_id}`, Number(row.max_students || 0));
  }

  const dates = enumerateDates(startDate, endDate);
  const proposals = [];
  const conflicts = [];
  const warnings = [];
  const projectedCoveredUsageOffsets = new Map();
  const skippedExisting = [];
  const skippedOverrides = [];
  let candidateSlots = 0;

  for (const template of templateRows) {
    const templateTime = normalizeTimeHms(template.time_of_day);
    if (!templateTime) {
      continue;
    }

    for (const date of dates) {
      if (retryItems.length > 0) {
        const allowedDates = retryLookup.get(template.id);
        if (!allowedDates || !allowedDates.has(date)) {
          continue;
        }
      }

      if (dayTokenForDate(date) !== normalizeDayToken(template.day_of_week)) {
        continue;
      }

      if (!templateRangeContainsDate(template, date)) {
        continue;
      }

      candidateSlots += 1;
      const override = overrideMap.get(`${template.id}|${date}`) || null;

      if (override?.override_type === 'cancel') {
        skippedOverrides.push({
          template_id: template.id,
          student_id: template.student_id,
          target_date: date,
          reason: 'override_cancel',
          override_id: override.id,
        });
        continue;
      }

      const finalInstructorId = override?.new_instructor_employee_id || template.instructor_employee_id;
      const finalServiceId = override?.new_service_id || template.service_id;
      const finalServiceName = serviceNameById.get(finalServiceId) || '';
      const finalTime = normalizeTimeHms(override?.new_time_of_day || template.time_of_day);
      const finalDuration = Number(override?.new_duration_minutes || template.duration_minutes);

      // Resolve all participants for this template.
      const templateStudentList = participantsByTemplateId.get(template.id) || [];
      const resolvedParticipants = templateStudentList.map((sid) => ({
        student_id: sid,
        client_profile_id: clientProfileIdByStudentId.get(sid) || null,
        student_name: studentNameByStudentId.get(sid) || '',
      }));

      // For backward-compat display fields on errors, use the first participant.
      const primaryStudentId = resolvedParticipants[0]?.student_id || template.student_id || null;
      const primaryClientProfileId = resolvedParticipants[0]?.client_profile_id || null;
      const primaryStudentName = resolvedParticipants[0]?.student_name || '';

      if (!finalInstructorId || !finalServiceId || !finalTime || !Number.isFinite(finalDuration) || finalDuration <= 0) {
        conflicts.push({
          type: 'invalid_template_data',
          template_id: template.id,
          student_id: primaryStudentId,
          student_name: primaryStudentName,
          client_profile_id: primaryClientProfileId,
          service_name: finalServiceName,
          target_date: date,
          message: 'נתוני תבנית/חריגה לא תקינים ולכן הדור לא בוצע עבור המופע הזה.',
          retry_item: buildRetryItem(template.id, date),
        });
        continue;
      }

      // Every participant must have a client_profile_id to be inserted as a lesson_participant.
      const participantsMissingProfile = resolvedParticipants.filter((p) => !p.client_profile_id);
      if (participantsMissingProfile.length > 0) {
        for (const missing of participantsMissingProfile) {
          conflicts.push({
            type: 'missing_client_profile_link',
            template_id: template.id,
            student_id: missing.student_id,
            student_name: missing.student_name,
            client_profile_id: null,
            service_name: finalServiceName,
            target_date: date,
            message: 'לתלמיד/ה בתבנית אין client_profile_id ולכן אי אפשר ליצור משתתף לשיעור.',
            retry_item: buildRetryItem(template.id, date),
          });
        }
        continue;
      }

      const slotKey = buildTemplateSlotKey(template.id, date, finalTime);
      if (existingTemplateSlotKeys.has(slotKey)) {
        skippedExisting.push({
          template_id: template.id,
          student_id: primaryStudentId,
          student_name: primaryStudentName,
          client_profile_id: primaryClientProfileId,
          service_name: finalServiceName,
          target_date: date,
          time_of_day: finalTime,
          reason: 'matching_template_instance_exists',
          retry_item: buildRetryItem(template.id, date),
        });
        continue;
      }

      const datetimeStartIso = buildUtcIsoForTimezoneDateTime(date, finalTime);
      if (!datetimeStartIso) {
        conflicts.push({
          type: 'invalid_datetime',
          template_id: template.id,
          student_id: primaryStudentId,
          student_name: primaryStudentName,
          client_profile_id: primaryClientProfileId,
          service_name: finalServiceName,
          target_date: date,
          time_of_day: finalTime,
          message: 'תאריך/שעה לא תקינים עבור יצירת מופע.',
          retry_item: buildRetryItem(template.id, date),
        });
        continue;
      }

      const candidate = {
        template_id: template.id,
        // Legacy single-student display fields (first participant)
        student_id: primaryStudentId,
        student_name: primaryStudentName,
        client_profile_id: primaryClientProfileId,
        // All participants for this template slot
        template_participants: resolvedParticipants,
        service_name: finalServiceName,
        instructor_employee_id: finalInstructorId,
        service_id: finalServiceId,
        datetime_start: datetimeStartIso,
        duration_minutes: finalDuration,
        target_date: date,
        time_of_day: finalTime,
        override_id: override?.id || null,
        override_type: override?.override_type || null,
        retry_item: buildRetryItem(template.id, date),
      };

      const interval = candidateInterval(candidate);
      if (!Number.isFinite(interval.startMs) || !Number.isFinite(interval.endMs)) {
        conflicts.push({
          type: 'invalid_datetime',
          template_id: template.id,
          student_id: primaryStudentId,
          student_name: primaryStudentName,
          client_profile_id: primaryClientProfileId,
          service_name: finalServiceName,
          target_date: date,
          message: 'תאריך/שעה לא תקינים עבור יצירת מופע.',
          retry_item: buildRetryItem(template.id, date),
        });
        continue;
      }

      const maxStudents = capabilityMap.get(`${candidate.instructor_employee_id}|${candidate.service_id}`) || null;
      const candidateConflicts = collectCandidateConflicts(candidate, interval, planningIntervals, maxStudents);

      if (candidateConflicts.length > 0) {
        conflicts.push({
          template_id: template.id,
          student_id: primaryStudentId,
          student_name: primaryStudentName,
          client_profile_id: primaryClientProfileId,
          service_name: finalServiceName,
          datetime_start: candidate.datetime_start,
          target_date: candidate.target_date,
          time_of_day: candidate.time_of_day,
          duration_minutes: candidate.duration_minutes,
          issues: candidateConflicts,
          retry_item: candidate.retry_item,
        });
        continue;
      }

      proposals.push(candidate);
      // Check HMO coverage for every participant.
      const participantsForCoverage = Array.isArray(candidate.template_participants) && candidate.template_participants.length > 0
        ? candidate.template_participants
        : (candidate.student_id ? [{ student_id: candidate.student_id }] : []);
      for (const participant of participantsForCoverage) {
        if (!participant.student_id) continue;
        const coverageDecision = await resolveLessonCoverageDecision(supabase, {
          orgId,
          studentId: participant.student_id,
          serviceId: candidate.service_id,
          lessonDate: candidate.datetime_start,
          usageOffsetsByAuthorizationId: projectedCoveredUsageOffsets,
        });
        const hmoWarning = buildCoverageWarningFromDecision(
          { ...candidate, student_id: participant.student_id },
          coverageDecision,
        );
        if (hmoWarning) {
          warnings.push(hmoWarning);
        }
        if (coverageDecision?.status === 'covered' && coverageDecision.authorization_id) {
          projectedCoveredUsageOffsets.set(
            coverageDecision.authorization_id,
            Number(projectedCoveredUsageOffsets.get(coverageDecision.authorization_id) || 0) + 1,
          );
        }
      }
      planningIntervals.push(interval);
    }
  }

  const applied = {
    createdInstances: [],
    createdParticipants: [],
    errors: [],
  };

  if (!dryRun && proposals.length > 0) {
    for (const proposal of proposals) {
      const instanceMetadata = {
        generation_run_id: generationRunId,
        generation_mode: 'manual',
        generated_from_template: true,
      };

      if (proposal.override_id) {
        instanceMetadata.applied_override_id = proposal.override_id;
      }

      const { data: insertedInstance, error: insertInstanceError } = await withOrgScope(supabase, 'lesson_instances', orgId)
        .insert({
          template_id: proposal.template_id,
          datetime_start: proposal.datetime_start,
          duration_minutes: proposal.duration_minutes,
          instructor_employee_id: proposal.instructor_employee_id,
          service_id: proposal.service_id,
          status: 'scheduled',
          documentation_status: 'undocumented',
          created_source: 'weekly_generation',
          created_by: userId,
          metadata: instanceMetadata,
          applied_override_id: proposal.override_id || null,
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single();

        if (insertInstanceError || !insertedInstance?.id) {
        applied.errors.push({
          type: 'instance_insert_failed',
          template_id: proposal.template_id,
          student_id: proposal.student_id,
          student_name: proposal.student_name || '',
          client_profile_id: proposal.client_profile_id || null,
          service_name: proposal.service_name || '',
          datetime_start: proposal.datetime_start,
          target_date: proposal.target_date,
          time_of_day: proposal.time_of_day,
          message: insertInstanceError?.message || 'failed_to_insert_instance',
          retry_item: proposal.retry_item,
        });
        continue;
      }

      // Insert one lesson_participant per template participant.
      const participantsToInsert = Array.isArray(proposal.template_participants) && proposal.template_participants.length > 0
        ? proposal.template_participants
        : (proposal.student_id ? [{ student_id: proposal.student_id, client_profile_id: proposal.client_profile_id }] : []);

      let instanceHadError = false;
      for (const participant of participantsToInsert) {
        const participantClientProfileId = participant.client_profile_id || null;
        if (!participantClientProfileId) {
          applied.errors.push({
            type: 'participant_insert_failed',
            template_id: proposal.template_id,
            student_id: participant.student_id,
            student_name: participant.student_name || '',
            client_profile_id: null,
            service_name: proposal.service_name || '',
            datetime_start: proposal.datetime_start,
            target_date: proposal.target_date,
            time_of_day: proposal.time_of_day,
            message: 'missing_client_profile_link',
            retry_item: proposal.retry_item,
          });
          instanceHadError = true;
          continue;
        }

        const { data: insertedParticipant, error: insertParticipantError } = await withOrgScope(supabase, 'lesson_participants', orgId)
          .insert({
            lesson_instance_id: insertedInstance.id,
            client_profile_id: participantClientProfileId,
            student_id: participant.student_id,
            participant_status: 'scheduled',
            metadata: {
              generation_run_id: generationRunId,
              generation_mode: 'manual',
            },
          })
          .select('id')
          .single();

        if (insertParticipantError || !insertedParticipant?.id) {
          applied.errors.push({
            type: 'participant_insert_failed',
            template_id: proposal.template_id,
            student_id: participant.student_id,
            student_name: participant.student_name || '',
            client_profile_id: participantClientProfileId,
            service_name: proposal.service_name || '',
            datetime_start: proposal.datetime_start,
            target_date: proposal.target_date,
            time_of_day: proposal.time_of_day,
            message: insertParticipantError?.message || 'failed_to_insert_participant',
            retry_item: proposal.retry_item,
          });
          instanceHadError = true;
          continue;
        }

        applied.createdParticipants.push({
          id: insertedParticipant.id,
          lesson_instance_id: insertedInstance.id,
          student_id: participant.student_id,
          student_name: participant.student_name || '',
          client_profile_id: participantClientProfileId,
        });
      } // end for participant

      if (!instanceHadError) {
        applied.createdInstances.push({
          id: insertedInstance.id,
          template_id: proposal.template_id,
          student_id: proposal.student_id,
          student_name: proposal.student_name || '',
          datetime_start: proposal.datetime_start,
          target_date: proposal.target_date,
          time_of_day: proposal.time_of_day,
        });
      }
    }
  }

  // --- Break template generation pass ---
  if (!dryRun) {
    const { data: breakTemplateRows } = await withOrgScope(supabase, 'instructor_break_templates', orgId)
      .select('id, instructor_employee_id, day_of_week, time_of_day, duration_minutes, break_type, note, valid_from, valid_until')
      .eq('is_active', true);

    const dates = enumerateDates(startDate, endDate);
    for (const template of breakTemplateRows || []) {
      for (const date of dates) {
        if (!breakTemplateMatchesDate(template, date)) continue;
        const timeHhMm = normalizeBreakTemplateTime(template.time_of_day);
        const datetimeStartIso = buildUtcIsoForTimezoneDateTime(date, timeHhMm);
        if (!datetimeStartIso) continue;
        // Idempotency: skip if a break already exists at this time for this instructor
        const { data: existingBreak } = await withOrgScope(supabase, 'instructor_breaks', orgId)
          .select('id')
          .eq('instructor_employee_id', template.instructor_employee_id)
          .eq('datetime_start', datetimeStartIso)
          .maybeSingle();
        if (existingBreak) continue;
        await withOrgScope(supabase, 'instructor_breaks', orgId).insert({
          org_id: orgId,
          instructor_employee_id: template.instructor_employee_id,
          datetime_start: datetimeStartIso,
          duration_minutes: template.duration_minutes,
          break_type: template.break_type || 'break',
          note: template.note || null,
          break_template_id: template.id,
          created_by: userId,
        });
      }
    }
  }

  const responsePayload = buildDiffResponse({
    generationRunId,
    startDate,
    endDate,
    requestMode,
    templatesConsidered: templateRows.length,
    candidateSlots,
    proposals,
    conflicts,
    warnings,
    warningsNotice: hmoWarningsNotice,
    skippedExisting,
    skippedOverrides,
    applied: dryRun ? null : applied,
  });

  try {
    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail,
      userRole: role,
      actionType: dryRun ? AUDIT_ACTIONS.CALENDAR_GENERATION_DRY_RUN : AUDIT_ACTIONS.CALENDAR_GENERATION_APPLIED,
      actionCategory: AUDIT_CATEGORIES.CALENDAR,
      resourceType: 'calendar_generation',
      resourceId: generationRunId,
      details: {
        start_date: startDate,
        end_date: endDate,
        summary: responsePayload.summary,
      },
    });
  } catch (auditError) {
    context.log?.error?.('calendar/generate failed to write audit event', {
      message: auditError?.message,
      generationRunId,
    });
  }

  return respond(context, 200, responsePayload);
}
