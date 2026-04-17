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
import { buildUtcBoundsForTimezoneDateRange } from '../_shared/instructor-availability.js';
import { buildHmoCoverageWarning } from './hmo-warning.js';

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

    if (interval.studentIds.includes(candidate.student_id)) {
      found.push({
        type: 'student_overlap',
        instance_id: interval.id,
        student_id: candidate.student_id,
        message: 'התלמיד כבר משובץ בשיעור אחר בזמן זה.',
      });
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
  return {
    generation_run_id: generationRunId,
    start_date: startDate,
    end_date: endDate,
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
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('calendar/generate failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const userEmail = normalizeString(authResult.data.user.email) || `missing-email-${userId}`;

  const body = parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'calendar/generate' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  const startDate = normalizeString(body?.start_date || body?.startDate);
  const endDate = normalizeString(body?.end_date || body?.endDate);
  const dryRun = parseBoolean(body?.dry_run ?? body?.dryRun, true);

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
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role || !isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const generationRunId = generateRunId();

  const { data: templates, error: templatesError } = await withOrgScope(supabase, 'lesson_templates', orgId)
    .select('id, student_id, instructor_employee_id, service_id, day_of_week, time_of_day, duration_minutes, valid_from, valid_until, is_active')
    .eq('is_active', true)
    .lte('valid_from', endDate)
    .or(`valid_until.is.null,valid_until.gte.${startDate}`)
    .order('day_of_week', { ascending: true })
    .order('time_of_day', { ascending: true });

  if (templatesError) {
    context.log?.error?.('calendar/generate failed to load templates', { message: templatesError.message });
    return respond(context, 500, { message: 'failed_to_load_templates' });
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

  const templateStudentIds = Array.from(new Set(templateRows.map((row) => normalizeString(row?.student_id)).filter(Boolean)));
  const templateServiceIds = Array.from(new Set(templateRows.map((row) => normalizeString(row?.service_id)).filter(Boolean)));
  let hmoAuthorizationRows = [];
  let hmoWarningsNotice = null;
  if (templateStudentIds.length > 0 && templateServiceIds.length > 0) {
    const { data: authorizationRows, error: authorizationError } = await withOrgScope(supabase, 'hmo_authorizations', orgId)
      .select('id, student_id, service_id, status, valid_from, expires_at, provider_id, provider_track_id')
      .in('student_id', templateStudentIds)
      .in('service_id', templateServiceIds);

    if (authorizationError) {
      if (authorizationError.code === '42P01') {
        hmoWarningsNotice = 'hmo_authorization_schema_missing';
      } else {
        context.log?.warn?.('calendar/generate failed to load hmo authorization coverage; proceeding without warnings', {
          message: authorizationError?.message,
          code: authorizationError?.code,
        });
      }
    } else {
      hmoAuthorizationRows = Array.isArray(authorizationRows) ? authorizationRows : [];
    }
  }

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
    return respond(context, 500, { message: 'failed_to_load_template_overrides' });
  }

  if (existingError) {
    context.log?.error?.('calendar/generate failed to load existing instances', { message: existingError.message });
    return respond(context, 500, { message: 'failed_to_load_instances' });
  }

  if (capabilitiesError) {
    context.log?.error?.('calendar/generate failed to load instructor capabilities', { message: capabilitiesError.message });
    return respond(context, 500, { message: 'failed_to_load_capabilities' });
  }

  const overrideMap = resolveOverrideMap(overridesRows);

  const existingIntervals = (Array.isArray(existingRows) ? existingRows : [])
    .map((row) => buildInstanceInterval(row))
    .filter((interval) => Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs));

  const planningIntervals = [...existingIntervals];

  const existingTemplateSlotKeys = new Set(
    (Array.isArray(existingRows) ? existingRows : [])
      .filter((row) => row?.template_id)
      .map((row) => `${row.template_id}|${extractDatePart(row.datetime_start)}|${extractTimePart(row.datetime_start)}`),
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
  const skippedExisting = [];
  const skippedOverrides = [];
  let candidateSlots = 0;

  for (const template of templateRows) {
    const templateTime = normalizeTimeHms(template.time_of_day);
    if (!templateTime) {
      continue;
    }

    for (const date of dates) {
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
      const finalTime = normalizeTimeHms(override?.new_time_of_day || template.time_of_day);
      const finalDuration = Number(override?.new_duration_minutes || template.duration_minutes);

      if (!finalInstructorId || !finalServiceId || !finalTime || !Number.isFinite(finalDuration) || finalDuration <= 0) {
        conflicts.push({
          type: 'invalid_template_data',
          template_id: template.id,
          student_id: template.student_id,
          target_date: date,
          message: 'נתוני תבנית/חריגה לא תקינים ולכן הדור לא בוצע עבור המופע הזה.',
        });
        continue;
      }

      const slotKey = `${template.id}|${date}|${finalTime}`;
      if (existingTemplateSlotKeys.has(slotKey)) {
        skippedExisting.push({
          template_id: template.id,
          student_id: template.student_id,
          target_date: date,
          time_of_day: finalTime,
          reason: 'matching_template_instance_exists',
        });
        continue;
      }

      const candidate = {
        template_id: template.id,
        student_id: template.student_id,
        instructor_employee_id: finalInstructorId,
        service_id: finalServiceId,
        datetime_start: `${date}T${finalTime}`,
        duration_minutes: finalDuration,
        target_date: date,
        time_of_day: finalTime,
        override_id: override?.id || null,
        override_type: override?.override_type || null,
      };

      const interval = candidateInterval(candidate);
      if (!Number.isFinite(interval.startMs) || !Number.isFinite(interval.endMs)) {
        conflicts.push({
          type: 'invalid_datetime',
          template_id: template.id,
          student_id: template.student_id,
          target_date: date,
          message: 'תאריך/שעה לא תקינים עבור יצירת מופע.',
        });
        continue;
      }

      const maxStudents = capabilityMap.get(`${candidate.instructor_employee_id}|${candidate.service_id}`) || null;
      const candidateConflicts = collectCandidateConflicts(candidate, interval, planningIntervals, maxStudents);

      if (candidateConflicts.length > 0) {
        conflicts.push({
          template_id: template.id,
          student_id: template.student_id,
          datetime_start: candidate.datetime_start,
          duration_minutes: candidate.duration_minutes,
          issues: candidateConflicts,
        });
        continue;
      }

      proposals.push(candidate);
      const hmoWarning = buildHmoCoverageWarning(candidate, hmoAuthorizationRows);
      if (hmoWarning) {
        warnings.push(hmoWarning);
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
          datetime_start: proposal.datetime_start,
          message: insertInstanceError?.message || 'failed_to_insert_instance',
        });
        continue;
      }

      const { data: insertedParticipant, error: insertParticipantError } = await withOrgScope(supabase, 'lesson_participants', orgId)
        .insert({
          lesson_instance_id: insertedInstance.id,
          student_id: proposal.student_id,
          participant_status: 'scheduled',
          metadata: {
            generation_run_id: generationRunId,
            generation_mode: 'manual',
          },
        })
        .select('id')
        .single();

      if (insertParticipantError || !insertedParticipant?.id) {
        await withOrgScope(supabase, 'lesson_instances', orgId)
          .delete()
          .eq('id', insertedInstance.id);

        applied.errors.push({
          type: 'participant_insert_failed',
          template_id: proposal.template_id,
          student_id: proposal.student_id,
          datetime_start: proposal.datetime_start,
          message: insertParticipantError?.message || 'failed_to_insert_participant',
        });
        continue;
      }

      applied.createdInstances.push({ id: insertedInstance.id, template_id: proposal.template_id, datetime_start: proposal.datetime_start });
      applied.createdParticipants.push({ id: insertedParticipant.id, lesson_instance_id: insertedInstance.id, student_id: proposal.student_id });
    }
  }

  const responsePayload = buildDiffResponse({
    generationRunId,
    startDate,
    endDate,
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
