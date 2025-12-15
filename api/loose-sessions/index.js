/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminRole,
  normalizeString,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';
import { isUUID, parseJsonBodyWithLimit } from '../_shared/validation.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';

const MAX_BODY_BYTES = 64 * 1024; // observe-only

export default async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('loose-sessions missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('loose-sessions missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('loose-sessions failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = normalizeString(authResult.data.user.id);
  const userEmail = normalizeString(authResult.data.user.email);
  const body = method === 'POST' ? parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'loose-sessions' }) : {};
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('loose-sessions failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  // For GET: allow instructors to view their own reports, admins to view all
  // For POST: admin-only
  const isAdmin = isAdminRole(role);
  
  if (method === 'POST' && !isAdmin) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  if (method === 'GET') {
    // Two modes controlled by query parameter:
    // 1. ?view=mine (default for non-admin, available to all): User's own loose reports (pending, rejected, accepted)
    // 2. ?view=pending (default for admin, admin-only): All pending unassigned reports
    
    const viewMode = req.query?.view || (isAdmin ? 'pending' : 'mine');
    
    if (viewMode === 'mine') {
      // Fetch user's own loose reports (originally submitted without student_id)
      // This includes: pending (student_id=null, deleted=false), 
      //                rejected (deleted=true with rejection metadata),
      //                accepted (student_id set by admin)
      // Filter by metadata.unassigned_details existence to identify loose reports
      const query = tenantClient
        .from('SessionRecords')
        .select(`
          id, 
          date, 
          content, 
          service_context, 
          instructor_id, 
          metadata, 
          created_at, 
          updated_at, 
          student_id, 
          deleted,
          deleted_at,
          Instructors!SessionRecords_instructor_id_fkey(name, email),
          Students!SessionRecords_student_id_fkey(name)
        `)
        .eq('instructor_id', userId)
        .not('metadata->unassigned_details', 'is', null) // Only loose reports
        .order('date', { ascending: false }); // Most recent first

      const { data, error } = await query;

      if (error) {
        context.log?.error?.('loose-sessions failed to list instructor records', { message: error.message });
        return respond(context, 500, { message: 'failed_to_load_sessions' });
      }

      // Mark rejected reports for easy identification
      const finalData = (Array.isArray(data) ? data : []).map(report => ({
        ...report,
        isRejected: report.deleted && report.metadata?.rejection ? true : false,
      }));

      return respond(context, 200, finalData);
    } else if (viewMode === 'pending') {
      // Admin-only: see all pending unassigned reports (not rejected, not accepted)
      if (!isAdmin) {
        return respond(context, 403, { message: 'forbidden' });
      }
      
      const query = tenantClient
        .from('SessionRecords')
        .select(`
          id, 
          date, 
          content, 
          service_context, 
          instructor_id, 
          metadata, 
          created_at, 
          updated_at, 
          student_id, 
          deleted,
          deleted_at,
          Instructors!SessionRecords_instructor_id_fkey(name, email)
        `)
        .is('student_id', null)
        .eq('deleted', false)
        .order('date', { ascending: true }); // Oldest session dates first

      const { data, error } = await query;

      if (error) {
        context.log?.error?.('loose-sessions failed to list pending records', { message: error.message });
        return respond(context, 500, { message: 'failed_to_load_sessions' });
      }

      return respond(context, 200, Array.isArray(data) ? data : []);
    }
  }

  if (method !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET, POST' });
  }

  const action = normalizeString(body?.action || '').toLowerCase();
  const sessionId = normalizeString(body?.session_id || body?.sessionId);

  if (!isUUID(sessionId)) {
    return respond(context, 400, { message: 'invalid_session_id' });
  }

  if (action !== 'assign_existing' && action !== 'create_and_assign' && action !== 'reject') {
    return respond(context, 400, { message: 'invalid_action' });
  }

  const { data: sessionRow, error: sessionError } = await tenantClient
    .from('SessionRecords')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();

  if (sessionError) {
    context.log?.error?.('loose-sessions failed to load session', { message: sessionError.message });
    return respond(context, 500, { message: 'failed_to_load_session' });
  }

  if (!sessionRow) {
    return respond(context, 404, { message: 'session_not_found' });
  }

  if (sessionRow.student_id) {
    return respond(context, 400, { message: 'session_already_assigned' });
  }

  if (sessionRow.deleted) {
    return respond(context, 400, { message: 'session_deleted' });
  }

  // For assignment: preserve all metadata including unassigned_details for tracking
  // For rejection: start fresh from the original metadata

  if (action === 'reject') {
    const rejectReason = normalizeString(body?.reject_reason || body?.rejectReason || '');
    if (!rejectReason) {
      return respond(context, 400, { message: 'missing_reject_reason' });
    }

    // Keep all metadata intact, just add rejection info
    const rejectionMetadata = {
      ...sessionRow.metadata,
      rejection: {
        reason: rejectReason,
        rejected_by: userId,
        rejected_at: new Date().toISOString(),
      },
    };

    const now = new Date().toISOString();
    const { error: deleteError } = await tenantClient
      .from('SessionRecords')
      .update({ deleted: true, deleted_at: now, metadata: rejectionMetadata })
      .eq('id', sessionId);

    if (deleteError) {
      context.log?.error?.('loose-sessions failed to reject session', { message: deleteError.message });
      return respond(context, 500, { message: 'failed_to_reject_session' });
    }

    try {
      await logAuditEvent(supabase, {
        orgId,
        userId,
        userEmail,
        userRole: role,
        actionType: AUDIT_ACTIONS.SESSION_DELETED,
        actionCategory: AUDIT_CATEGORIES.SESSIONS,
        resourceType: 'session_record',
        resourceId: sessionId,
        details: {
          mode: 'reject_loose_report',
          reject_reason: rejectReason,
        },
      });
    } catch (auditError) {
      context.log?.error?.('loose-sessions failed to log rejection audit', { message: auditError?.message });
    }

    return respond(context, 200, { message: 'session_rejected' });
  }

  if (action === 'assign_existing') {
    const studentId = normalizeString(body?.student_id || body?.studentId);
    if (!isUUID(studentId)) {
      return respond(context, 400, { message: 'invalid_student_id' });
    }

    const { data: studentRow, error: studentError } = await tenantClient
      .from('Students')
      .select('id, default_service, is_active')
      .eq('id', studentId)
      .maybeSingle();

    if (studentError) {
      context.log?.error?.('loose-sessions failed to load student', { message: studentError.message });
      return respond(context, 500, { message: 'failed_to_load_student' });
    }

    if (!studentRow) {
      return respond(context, 404, { message: 'student_not_found' });
    }

    const newServiceContext = sessionRow.service_context ?? studentRow.default_service ?? null;

    // Preserve all metadata including unassigned_details for tracking purposes
    const assignmentMetadata = {
      ...sessionRow.metadata,
      assignment: {
        assigned_by: userId,
        assigned_by_role: role,
        assigned_at: new Date().toISOString(),
      },
    };

    const { data: updatedSession, error: updateError } = await tenantClient
      .from('SessionRecords')
      .update({
        student_id: studentRow.id,
        service_context: newServiceContext,
        metadata: assignmentMetadata,
      })
      .eq('id', sessionId)
      .select()
      .maybeSingle();

    if (updateError) {
      context.log?.error?.('loose-sessions failed to assign session', { message: updateError.message });
      return respond(context, 500, { message: 'failed_to_assign_session' });
    }

    try {
      await logAuditEvent(supabase, {
        orgId,
        userId,
        userEmail,
        userRole: role,
        actionType: AUDIT_ACTIONS.SESSION_RESOLVED,
        actionCategory: AUDIT_CATEGORIES.SESSIONS,
        resourceType: 'session_record',
        resourceId: sessionId,
        details: {
          mode: 'assign_existing',
          student_id: studentRow.id,
        },
      });
    } catch (auditError) {
      context.log?.error?.('loose-sessions failed to log audit event', { message: auditError?.message });
    }

    return respond(context, 200, { session: updatedSession });
  }

  // create_and_assign
  const name = normalizeString(body?.name);
  if (!name) {
    return respond(context, 400, { message: 'missing_student_name' });
  }

  const assignedInstructorId = normalizeString(
    body?.assigned_instructor_id || body?.instructor_id || body?.instructorId,
  );
  if (!isUUID(assignedInstructorId)) {
    return respond(context, 400, { message: 'invalid_instructor_id' });
  }

  const { data: instructorRow, error: instructorError } = await tenantClient
    .from('Instructors')
    .select('id, is_active')
    .eq('id', assignedInstructorId)
    .maybeSingle();

  if (instructorError) {
    context.log?.error?.('loose-sessions failed to load instructor', { message: instructorError.message });
    return respond(context, 500, { message: 'failed_to_load_instructor' });
  }

  if (!instructorRow) {
    return respond(context, 404, { message: 'instructor_not_found' });
  }

  if (instructorRow.is_active === false) {
    return respond(context, 400, { message: 'instructor_inactive' });
  }

  const defaultService = normalizeString(body?.default_service || body?.service);
  const nationalId = normalizeString(body?.national_id || body?.nationalId);

  // Validate national_id is provided
  if (!nationalId) {
    return respond(context, 400, { message: 'missing_national_id' });
  }

  // Check for duplicate national_id
  const { data: existingStudent, error: checkError } = await tenantClient
    .from('Students')
    .select('id, name')
    .eq('national_id', nationalId)
    .maybeSingle();

  if (checkError && checkError.code !== 'PGRST116') {
    context.log?.error?.('loose-sessions failed to check national_id', { message: checkError.message });
    return respond(context, 500, { message: 'failed_to_check_national_id' });
  }

  if (existingStudent) {
    return respond(context, 409, { 
      message: 'duplicate_national_id',
      details: { existing_student_id: existingStudent.id, existing_student_name: existingStudent.name }
    });
  }

  const nowIso = new Date().toISOString();

  const studentInsert = {
    name,
    national_id: nationalId,
    assigned_instructor_id: assignedInstructorId,
    default_service: defaultService || null,
    is_active: true,
    metadata: {
      created_by: userId,
      created_at: nowIso,
      created_role: role,
    },
  };

  const { data: newStudent, error: createError } = await tenantClient
    .from('Students')
    .insert([studentInsert])
    .select('id, name, assigned_instructor_id, default_service')
    .single();

  if (createError) {
    context.log?.error?.('loose-sessions failed to create student', { message: createError.message });
    return respond(context, 500, { message: 'failed_to_create_student' });
  }

  const newServiceContext = sessionRow.service_context ?? newStudent.default_service ?? null;

  // Preserve all metadata including unassigned_details for tracking purposes
  const assignmentMetadata = {
    ...sessionRow.metadata,
    assignment: {
      assigned_by: userId,
      assigned_by_role: role,
      assigned_at: new Date().toISOString(),
    },
  };

  const { data: resolvedSession, error: resolveError } = await tenantClient
    .from('SessionRecords')
    .update({
      student_id: newStudent.id,
      service_context: newServiceContext,
      metadata: assignmentMetadata,
    })
    .eq('id', sessionId)
    .select()
    .maybeSingle();

  if (resolveError) {
    context.log?.error?.('loose-sessions failed to assign new student', { message: resolveError.message });
    return respond(context, 500, { message: 'failed_to_assign_session' });
  }

  try {
    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail,
      userRole: role,
      actionType: AUDIT_ACTIONS.STUDENT_CREATED,
      actionCategory: AUDIT_CATEGORIES.STUDENTS,
      resourceType: 'student',
      resourceId: newStudent.id,
      details: {
        name: newStudent.name,
        assigned_instructor_id: newStudent.assigned_instructor_id,
        source: 'loose_session_resolution',
        session_id: sessionId,
      },
    });

    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail,
      userRole: role,
      actionType: AUDIT_ACTIONS.SESSION_RESOLVED,
      actionCategory: AUDIT_CATEGORIES.SESSIONS,
      resourceType: 'session_record',
      resourceId: sessionId,
      details: {
        mode: 'create_and_assign',
        student_id: newStudent.id,
      },
    });
  } catch (auditError) {
    context.log?.error?.('loose-sessions failed to log audit event', { message: auditError?.message });
  }

  return respond(context, 200, { session: resolvedSession, student: newStudent });
}
