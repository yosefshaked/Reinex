/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { logAuditEvent, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
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
import { parseExpectedVersion, respondWithVersionConflict } from '../_shared/calendar-editing.js';
import { buildInstanceCorrectionPreview } from '../_shared/calendar-corrections.js';
import { createDashboardTask } from '../_shared/dashboard-tasks.js';
import { syncLessonClosureState } from '../_shared/calendar-workflow.js';
import { logTenantAuditEvent, TENANT_AUDIT_RETENTION } from '../_shared/tenant-audit.js';
import { ACTIVE_LESSON_INSTANCE_STATUSES, normalizeLessonInstanceStatus } from '../_shared/lesson-instance-status.js';
import BillingLedgerService from '../_shared/BillingLedgerService.js';

const MAX_BODY_BYTES = 128 * 1024;

function normalizeCorrectionMode(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (['value_only', 'replacement_instance', 'participant_adjustment'].includes(normalized)) {
    return normalized;
  }
  return 'value_only';
}

function normalizeReasonCode(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized || 'unspecified';
}

function normalizePatchObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeParticipantPatches(value) {
  return Array.isArray(value)
    ? value.filter((patch) => patch && typeof patch === 'object' && !Array.isArray(patch))
    : [];
}

async function createBlockedCorrectionArtifacts({ client, orgId, userId, preview, reasonCode, reasonText }) {
  const { data: correction, error: correctionError } = await withOrgScope(client, 'calendar_instance_corrections', orgId)
    .insert({
      original_instance_id: preview.original_instance_id,
      correction_mode: preview.correction_mode,
      reason_code: reasonCode,
      reason_text: reasonText,
      status: 'blocked',
      instance_patch: preview.instance_patch,
      participant_patches: preview.participant_patches,
      effective_state: preview.effective_state,
      impact_snapshot: preview.impact_snapshot,
      blocked_by_paid_claim: true,
      created_by: userId,
      updated_by: userId,
      metadata: {
        paid_claim_batch_ids: preview.paid_claim_batch_ids,
      },
    })
    .select('*')
    .single();

  if (correctionError) {
    throw correctionError;
  }

  const task = await createDashboardTask(client, {
    orgId,
    taskType: 'calendar_correction_paid_claim_block',
    title: 'נדרשת בדיקה ידנית לתיקון שיעור חסום',
    description: 'התיקון נחסם כי השיעור קשור לאצוות תביעה שסומנה כשולמה. נדרשת בדיקה ידנית לפני המשך טיפול.',
    priority: 'high',
    resourceType: 'lesson_instance',
    resourceId: preview.original_instance_id,
    actionPath: '/financials',
    createdBy: userId,
    metadata: {
      correction_id: correction.id,
      paid_claim_batch_ids: preview.paid_claim_batch_ids,
      reason_code: reasonCode,
    },
  });

  return { correction, task };
}

async function createAppliedCorrectionArtifacts({ client, orgId, billingService, userId, preview, reasonCode, reasonText }) {
  const { data: correction, error: correctionError } = await withOrgScope(client, 'calendar_instance_corrections', orgId)
    .insert({
      original_instance_id: preview.original_instance_id,
      correction_mode: preview.correction_mode,
      reason_code: reasonCode,
      reason_text: reasonText,
      status: 'applied',
      instance_patch: preview.instance_patch,
      participant_patches: preview.participant_patches,
      effective_state: preview.effective_state,
      impact_snapshot: preview.impact_snapshot,
      blocked_by_paid_claim: false,
      created_by: userId,
      updated_by: userId,
      metadata: {
        requires_impact_warning: true,
      },
    })
    .select('*')
    .single();

  if (correctionError) {
    throw correctionError;
  }

  const createdArtifacts = {
    correction,
    finance_corrections: [],
    attendance_corrections: [],
    ledger_adjustments: [],
  };

  const payrollDelta = Number(preview.impact_snapshot?.payroll?.delta_amount || 0);
  if (payrollDelta !== 0) {
    const { data: financeCorrection, error: financeError } = await withOrgScope(client, 'finance_corrections', orgId)
      .insert({
        employee_id: preview.effective_state?.instance?.instructor_employee_id || preview.effective_state?.instance?.instructor_id,
        correction_type: 'correction',
        amount: payrollDelta,
        effective_date: preview.impact_snapshot?.operational?.attendance_date,
        notes: reasonText,
        created_by: userId,
        updated_by: userId,
        metadata: {
          source_type: 'calendar_instance_correction',
          source_id: correction.id,
          original_instance_id: preview.original_instance_id,
        },
      })
      .select('*')
      .single();

    if (financeError) {
      throw financeError;
    }
    createdArtifacts.finance_corrections.push(financeCorrection);
  }

  const workedMinutesDelta = Number(preview.impact_snapshot?.operational?.delta_minutes || 0);
  if (workedMinutesDelta !== 0) {
    const { data: attendanceCorrection, error: attendanceError } = await withOrgScope(client, 'employee_attendance_records', orgId)
      .insert({
        employee_id: preview.effective_state?.instance?.instructor_employee_id,
        attendance_date: preview.impact_snapshot?.operational?.attendance_date,
        status: workedMinutesDelta >= 0 ? 'present' : 'partial',
        worked_minutes: workedMinutesDelta,
        source_type: 'correction',
        notes: reasonText,
        created_by: userId,
        updated_by: userId,
        metadata: {
          source_type: 'calendar_instance_correction',
          source_id: correction.id,
          original_instance_id: preview.original_instance_id,
        },
      })
      .select('*')
      .single();

    if (attendanceError) {
      throw attendanceError;
    }
    createdArtifacts.attendance_corrections.push(attendanceCorrection);
  }

  for (const participantImpact of preview.impact_snapshot?.billing?.affected_participants || []) {
    const delta = Number(participantImpact.delta_amount || 0);
    if (delta === 0 || !participantImpact.client_profile_id) {
      continue;
    }

    const accountType = participantImpact.student_id ? 'student' : 'client_profile';
    const accountRefId = participantImpact.student_id || participantImpact.client_profile_id;
    const sharedPayload = {
      accountType,
      accountRefId,
      amount: Math.abs(delta),
      effectiveAt: preview.impact_snapshot?.operational?.attendance_date || null,
      actorUserId: userId,
      sourceType: 'manual_adjustment',
      sourceId: correction.id,
      notes: reasonText,
      metadata: {
        correction_reason_code: reasonCode,
        correction_mode: preview.correction_mode,
        source_type: 'calendar_instance_correction',
        source_id: correction.id,
        original_instance_id: preview.original_instance_id,
        original_participant_id: participantImpact.participant_id,
      },
    };

    const ledgerAdjustment = delta > 0
      ? await billingService.appendManualDebit(sharedPayload)
      : await billingService.appendManualCredit(sharedPayload);

    createdArtifacts.ledger_adjustments.push(ledgerAdjustment);
  }

  return createdArtifacts;
}

export default async function calendarCorrections(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
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
  } catch (authError) {
    context.log?.error?.('calendar-corrections failed to validate token', { message: authError?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = method === 'GET'
    ? {}
    : parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'calendar-corrections' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role = null;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('calendar-corrections failed to verify membership', { message: membershipError?.message });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (!isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const billingService = new BillingLedgerService({ tenantClient: supabase, orgId });

  if (method !== 'POST') {
    return respond(context, 405, { message: 'method not allowed' });
  }

  const action = normalizeString(body?.action).toLowerCase();
  if (!['preview', 'apply', 'register_blocked_attempt'].includes(action)) {
    return respond(context, 400, { message: 'invalid_action' });
  }

  const originalInstanceId = normalizeString(body?.original_instance_id || body?.originalInstanceId || body?.instance_id || body?.instanceId);
  if (!originalInstanceId) {
    return respond(context, 400, { message: 'missing_original_instance_id' });
  }

  const expectedVersion = parseExpectedVersion(body?.expected_version, body?.expectedVersion, body?.version);
  const correctionMode = normalizeCorrectionMode(body?.correction_mode || body?.correctionMode);
  const reasonCode = normalizeReasonCode(body?.reason_code || body?.reasonCode);
  const reasonText = normalizeString(body?.reason_text || body?.reasonText);
  const instancePatch = normalizePatchObject(body?.instance_patch || body?.instancePatch);
  const participantPatches = normalizeParticipantPatches(body?.participant_patches || body?.participantPatches);

  if (Object.prototype.hasOwnProperty.call(instancePatch, 'status')) {
    const normalizedStatus = normalizeLessonInstanceStatus(instancePatch.status);
    if (!ACTIVE_LESSON_INSTANCE_STATUSES.has(normalizedStatus)) {
      return respond(context, 400, { message: 'invalid_instance_patch_status' });
    }
    instancePatch.status = normalizedStatus;
  }

  if (action === 'apply' && !reasonText) {
    return respond(context, 400, { message: 'missing_reason_text' });
  }

  let preview;
  try {
    preview = await buildInstanceCorrectionPreview(supabase, {
      originalInstanceId,
      correctionMode,
      instancePatch,
      participantPatches,
    });
  } catch (error) {
    if (error?.code === 'cancelled_instance_has_attended_participants'
      || error?.code === 'completed_instance_has_scheduled_participants'
      || error?.code === 'invalid_participant_patch_status') {
      return respond(context, 422, {
        message: error.code,
        details: error.details || {},
      });
    }
    context.log?.error?.('calendar-corrections failed to build preview', { message: error?.message, originalInstanceId });
    return respond(context, 500, { message: 'failed_to_build_correction_preview' });
  }

  if (!preview) {
    return respond(context, 404, { message: 'lesson_instance_not_found' });
  }

  if (action === 'preview') {
    // Preview is intentionally read-only: no writes, no side effects, no optimistic-lock enforcement.
    return respond(context, 200, preview);
  }

  if (action === 'register_blocked_attempt') {
    if (!preview.blocked_by_paid_claim) {
      return respond(context, 409, { message: 'correction_not_blocked_by_paid_claim', preview });
    }

    try {
      const task = await createDashboardTask(supabase, {
        orgId,
        taskType: 'calendar_correction_paid_claim_block',
        title: 'נדרשת בדיקה ידנית לתיקון שיעור חסום',
        description: 'ניסיון תיקון נחסם כי השיעור קשור לאצוות תביעה שסומנה כשולמה. נדרשת בדיקה ידנית.',
        priority: 'high',
        resourceType: 'lesson_instance',
        resourceId: preview.original_instance_id,
        actionPath: '/financials',
        createdBy: userId,
        metadata: {
          paid_claim_batch_ids: preview.paid_claim_batch_ids,
          source: 'blocked_attempt',
        },
      });

      await logAuditEvent(supabase, {
        orgId,
        userId,
        userEmail: authResult.data.user.email || '',
        userRole: role,
        actionType: 'locked_correction.blocked_attempt_task_created',
        actionCategory: AUDIT_CATEGORIES.CALENDAR,
        resourceType: 'lesson_instance',
        resourceId: originalInstanceId,
        details: {
          dashboard_task_id: task?.id || null,
          paid_claim_batch_ids: preview.paid_claim_batch_ids,
        },
      });

      await logTenantAuditEvent(supabase, {
        actorUserId: userId,
        eventType: 'calendar.instance.blocked_attempt_task_created',
        retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
        resourceType: 'lesson_instance',
        resourceId: originalInstanceId,
        details: {
          dashboard_task_id: task?.id || null,
          paid_claim_batch_ids: preview.paid_claim_batch_ids,
        },
      });

      return respond(context, 201, {
        message: 'blocked_attempt_task_created',
        dashboard_task: task,
        preview,
      });
    } catch (error) {
      context.log?.error?.('calendar-corrections failed to register blocked attempt', {
        message: error?.message,
        originalInstanceId,
      });
      return respond(context, 500, { message: 'failed_to_register_blocked_attempt' });
    }
  }

  if (expectedVersion !== null && preview.instance_version !== expectedVersion) {
    return respondWithVersionConflict(context, {
      resourceType: 'lesson_instance',
      resourceId: originalInstanceId,
      expectedVersion,
      currentVersion: preview.instance_version,
    });
  }

  if (body?.impact_warning_acknowledged !== true) {
    return respond(context, 400, { message: 'impact_warning_not_acknowledged' });
  }

  try {
    if (preview.blocked_by_paid_claim) {
      const { correction, task } = await createBlockedCorrectionArtifacts({
        client: supabase,
        orgId,
        userId,
        preview,
        reasonCode,
        reasonText,
      });

      await logAuditEvent(supabase, {
        orgId,
        userId,
        userEmail: authResult.data.user.email || '',
        userRole: role,
        actionType: 'locked_correction.blocked_paid_claim',
        actionCategory: AUDIT_CATEGORIES.CALENDAR,
        resourceType: 'lesson_instance',
        resourceId: originalInstanceId,
        details: {
          correction_id: correction.id,
          dashboard_task_id: task?.id || null,
          paid_claim_batch_ids: preview.paid_claim_batch_ids,
        },
      });

      await logTenantAuditEvent(supabase, {
        actorUserId: userId,
        eventType: 'calendar.instance.correction_blocked_paid_claim',
        retentionCategory: TENANT_AUDIT_RETENTION.CRITICAL,
        resourceType: 'lesson_instance',
        resourceId: originalInstanceId,
        details: {
          correction_id: correction.id,
          dashboard_task_id: task?.id || null,
          paid_claim_batch_ids: preview.paid_claim_batch_ids,
        },
      });

      return respond(context, 423, {
        message: 'correction_blocked_paid_claim',
        correction,
        dashboard_task: task,
        preview,
      });
    }

    const result = await createAppliedCorrectionArtifacts({
      client: supabase,
      orgId,
      billingService,
      userId,
      preview,
      reasonCode,
      reasonText,
    });

    try {
      await syncLessonClosureState(supabase, originalInstanceId, userId);
    } catch (closureError) {
      context.log?.warn?.('calendar-corrections failed to sync lesson closure after correction', {
        message: closureError?.message,
        originalInstanceId,
      });
    }

    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail: authResult.data.user.email || '',
      userRole: role,
      actionType: 'locked_correction.applied',
      actionCategory: AUDIT_CATEGORIES.CALENDAR,
      resourceType: 'lesson_instance',
      resourceId: originalInstanceId,
      details: {
        correction_id: result.correction.id,
        finance_correction_ids: result.finance_corrections.map((entry) => entry.id),
        attendance_correction_ids: result.attendance_corrections.map((entry) => entry.id),
        ledger_adjustment_ids: result.ledger_adjustments.map((entry) => entry.transactionId || entry.id),
      },
    });

    await logTenantAuditEvent(supabase, {
      actorUserId: userId,
      eventType: 'calendar.instance.corrected',
      retentionCategory: TENANT_AUDIT_RETENTION.CRITICAL,
      resourceType: 'lesson_instance',
      resourceId: originalInstanceId,
      afterState: result.correction,
      details: {
        finance_correction_ids: result.finance_corrections.map((entry) => entry.id),
        attendance_correction_ids: result.attendance_corrections.map((entry) => entry.id),
        ledger_adjustment_ids: result.ledger_adjustments.map((entry) => entry.transactionId || entry.id),
      },
    });

    return respond(context, 201, {
      message: 'correction_applied',
      preview,
      ...result,
    });
  } catch (error) {
    context.log?.error?.('calendar-corrections failed to apply correction', { message: error?.message, originalInstanceId });
    return respond(context, 500, { message: 'failed_to_apply_correction' });
  }
}
