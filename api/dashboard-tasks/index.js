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
import { listDashboardTasks, resolveDashboardTask } from '../_shared/dashboard-tasks.js';
import { logTenantAuditEvent, TENANT_AUDIT_RETENTION } from '../_shared/tenant-audit.js';
import { syncLessonClosureState } from '../_shared/calendar-workflow.js';

const MAX_BODY_BYTES = 48 * 1024;

export default async function dashboardTasks(context, req) {
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
    context.log?.error?.('dashboard-tasks failed to validate token', { message: authError?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = method === 'GET'
    ? {}
    : parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'dashboard-tasks' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role = null;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('dashboard-tasks failed to verify membership', { message: membershipError?.message });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (!isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (method === 'GET') {
    try {
      const entries = await listDashboardTasks(supabase, {
        status: normalizeString(req?.query?.status) || 'open',
        resourceType: normalizeString(req?.query?.resource_type),
        resourceId: normalizeString(req?.query?.resource_id),
      });
      return respond(context, 200, { entries });
    } catch (error) {
      context.log?.error?.('dashboard-tasks failed to list tasks', { message: error?.message });
      return respond(context, 500, { message: 'failed_to_load_dashboard_tasks' });
    }
  }

  if (method === 'PUT') {
    const taskId = normalizeString(body?.id || body?.task_id || body?.taskId);
    if (!taskId) {
      return respond(context, 400, { message: 'missing_task_id' });
    }

    try {
      const resolvedTask = await resolveDashboardTask(supabase, {
        taskId,
        resolvedBy: userId,
        metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      });

      if (!resolvedTask) {
        return respond(context, 404, { message: 'dashboard_task_not_found' });
      }

      await logAuditEvent(supabase, {
        orgId,
        userId,
        userEmail: authResult.data.user.email || '',
        userRole: role,
        actionType: 'dashboard_task.resolved',
        actionCategory: AUDIT_CATEGORIES.CALENDAR,
        resourceType: 'dashboard_task',
        resourceId: taskId,
        details: {
          task_type: resolvedTask.task_type,
          resource_type: resolvedTask.resource_type,
          resource_id: resolvedTask.resource_id,
        },
      });

      await logTenantAuditEvent(supabase, {
        actorUserId: userId,
        eventType: 'dashboard.task.resolved',
        retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
        resourceType: 'dashboard_task',
        resourceId: taskId,
        afterState: resolvedTask,
      });

      try {
        const resourceType = normalizeString(resolvedTask.resource_type);
        if (resourceType === 'lesson_instance' && resolvedTask.resource_id) {
          await syncLessonClosureState(supabase, resolvedTask.resource_id, userId);
        } else if (resourceType === 'lesson_participant' && resolvedTask.resource_id) {
          const { data: participantRow, error: participantError } = await withOrgScope(supabase, 'lesson_participants', orgId)
            .select('lesson_instance_id')
            .eq('id', resolvedTask.resource_id)
            .maybeSingle();

          if (participantError) {
            throw participantError;
          }

          if (participantRow?.lesson_instance_id) {
            await syncLessonClosureState(supabase, participantRow.lesson_instance_id, userId);
          }
        }
      } catch (closureError) {
        context.log?.warn?.('dashboard-tasks failed to sync lesson closure after resolve', {
          message: closureError?.message,
          taskId,
        });
      }

      return respond(context, 200, resolvedTask);
    } catch (error) {
      context.log?.error?.('dashboard-tasks failed to resolve task', { message: error?.message, taskId });
      return respond(context, 500, { message: 'failed_to_resolve_dashboard_task' });
    }
  }

  return respond(context, 405, { message: 'method not allowed' });
}
