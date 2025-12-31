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
import { isUUID, parseJsonBodyWithLimit, validateSessionWrite } from '../_shared/validation.js';
import { buildSessionMetadata } from '../_shared/session-metadata.js';
import { mergeMetadata } from '../_shared/metadata-utils.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';

const MAX_BODY_BYTES = 128 * 1024; // observe-only for now

// validation moved to _shared/validation.js (SOT)

function isMemberRole(role) {
  const normalized = normalizeString(role).toLowerCase();
  return normalized === 'member';
}

export default async function (context, req) {
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('sessions missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('sessions missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('sessions failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const userEmail = authResult.data.user.email;
  const body = parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'sessions' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('sessions failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const validation = validateSessionWrite(body);
  if (validation.error) {
    const message =
      validation.error === 'invalid_student_id'
        ? 'invalid student id'
        : validation.error === 'invalid_date'
          ? 'invalid date'
          : validation.error === 'missing_content'
            ? 'missing session content'
            : validation.error === 'invalid_service_context'
              ? 'invalid service context'
              : validation.error === 'missing_service_context'
                ? 'missing service context'
                : validation.error === 'missing_time'
                  ? 'missing time'
                  : validation.error === 'invalid_time'
                    ? 'invalid time'
                    : validation.error === 'missing_unassigned_name'
                      ? 'missing unassigned name'
                      : validation.error === 'missing_unassigned_reason'
                        ? 'missing unassigned reason'
                        : validation.error === 'missing_unassigned_reason_detail'
                          ? 'missing unassigned reason detail'
                          : 'invalid content';
    return respond(context, 400, { message });
  }

  const isLoose = !validation.studentId;

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  let assignedInstructor = '';
  const normalizedUserId = normalizeString(userId);

  let studentRecord = null;
  if (!isLoose) {
    const studentResult = await tenantClient
      .from('Students')
      .select('id, assigned_instructor_id, default_service')
      .eq('id', validation.studentId)
      .maybeSingle();

    if (studentResult.error) {
      context.log?.error?.('sessions failed to load student', { message: studentResult.error.message });
      return respond(context, 500, { message: 'failed_to_load_student' });
    }

    if (!studentResult.data) {
      return respond(context, 404, { message: 'student_not_found' });
    }

    assignedInstructor = normalizeString(studentResult.data.assigned_instructor_id) || '';
    studentRecord = studentResult.data;

    if (isMemberRole(role) && assignedInstructor && assignedInstructor !== normalizedUserId) {
      return respond(context, 403, { message: 'student_not_assigned_to_user' });
    }

    if (isMemberRole(role) && !assignedInstructor) {
      return respond(context, 403, { message: 'student_not_assigned_to_user' });
    }
  }

  // Resolve which instructor id should be written on the session.
  // PERMISSION RULES:
  // - Non-admin members: can only submit for their assigned students (verified above)
  // - Admin members (instructors): can submit as themselves OR on behalf of other instructors (loose reports)
  // - Admin non-instructors: MUST specify an instructor for loose reports (cannot submit in their own name)
  let sessionInstructorId = assignedInstructor;
  if (isLoose) {
    // For loose reports, admin MUST specify which instructor is submitting
    if (validation.instructorId) {
      // Admin specified an instructor - verify they have admin permission
      if (!isAdminRole(role)) {
        return respond(context, 403, { message: 'members_cannot_specify_instructor' });
      }
      sessionInstructorId = validation.instructorId;
    } else {
      // No instructor specified - can only use logged-in user if they're an instructor
      // Members always submit as themselves (already verified as instructor via student assignment)
      // Admins can only submit as themselves if they're also an instructor
      if (!isMemberRole(role)) {
        // Admin without specified instructor - must be an instructor themselves
        const adminInstructorCheck = await tenantClient
          .from('Instructors')
          .select('id, is_active')
          .eq('id', normalizedUserId)
          .maybeSingle();

        if (adminInstructorCheck.error) {
          context.log?.error?.('sessions failed to verify admin is instructor', { message: adminInstructorCheck.error.message });
          return respond(context, 500, { message: 'failed_to_verify_instructor' });
        }

        if (!adminInstructorCheck.data) {
          // Admin is not an instructor - cannot submit loose report without specifying instructor
          return respond(context, 400, { message: 'admin_must_specify_instructor' });
        }

        sessionInstructorId = adminInstructorCheck.data.id;
      } else {
        // Member instructor submitting in their own name
        sessionInstructorId = normalizedUserId;
      }
    }
  }

  if (!sessionInstructorId && !isMemberRole(role) && normalizedUserId) {
    const instructorLookup = await tenantClient
      .from('Instructors')
      .select('id, is_active')
      .eq('id', normalizedUserId)
      .maybeSingle();

    if (instructorLookup.error) {
      context.log?.error?.('sessions failed to verify acting user is instructor', { message: instructorLookup.error.message });
      return respond(context, 500, { message: 'failed_to_verify_instructor' });
    }

    if (instructorLookup.data && instructorLookup.data.id) {
      sessionInstructorId = instructorLookup.data.id;
    }
  }

  // For loose reports, or when attributing to the acting user, ensure the instructor exists to avoid FK errors
  if (sessionInstructorId && (isLoose || sessionInstructorId === normalizedUserId)) {
    const instructorCheck = await tenantClient
      .from('Instructors')
      .select('id')
      .eq('id', sessionInstructorId)
      .maybeSingle();

    if (instructorCheck.error) {
      context.log?.error?.('sessions failed to verify instructor existence', { message: instructorCheck.error.message });
      return respond(context, 500, { message: 'failed_to_verify_instructor' });
    }

    if (!instructorCheck.data) {
      return respond(context, 400, { message: 'instructor_not_found' });
    }
  }

  // If after resolution there's still no instructor to attribute to, block with a specific message.
  if (!sessionInstructorId) {
    return respond(context, 400, { message: 'student_missing_instructor' });
  }

  const { metadata } = await buildSessionMetadata({
    tenantClient,
    userId: normalizedUserId,
    role,
    logger: context.log,
  });

  const metadataAdditions = validation.unassignedDetails
    ? { unassigned_details: validation.unassignedDetails }
    : {};

  const mergedMetadata = mergeMetadata(metadata, metadataAdditions);

  // Allow-list user-provided metadata additions for loose report resubmissions.
  // Never allow overriding server metadata; merge additively.
  let clientMetadataAdditions = {};
  const rawClientMetadata = body?.metadata;
  if (isLoose && rawClientMetadata && typeof rawClientMetadata === 'object' && !Array.isArray(rawClientMetadata)) {
    const resubmittedFrom = normalizeString(rawClientMetadata.resubmitted_from);
    if (resubmittedFrom && isUUID(resubmittedFrom)) {
      clientMetadataAdditions.resubmitted_from = resubmittedFrom;
    }

    if (rawClientMetadata.original_rejection && typeof rawClientMetadata.original_rejection === 'object') {
      clientMetadataAdditions.original_rejection = rawClientMetadata.original_rejection;
    }

    const instructorNotes = normalizeString(rawClientMetadata.instructor_notes);
    if (instructorNotes) {
      clientMetadataAdditions.instructor_notes = instructorNotes;
    }
  }

  const finalMetadata = Object.keys(clientMetadataAdditions).length
    ? mergeMetadata(mergedMetadata, clientMetadataAdditions)
    : mergedMetadata;

  const { data, error } = await tenantClient
    .from('SessionRecords')
    .insert([
      {
        student_id: validation.studentId,
        date: validation.date,
        content: validation.content,
        instructor_id: sessionInstructorId || null,
        service_context: validation.hasExplicitService
          ? validation.serviceContext
          : validation.serviceContext ?? studentRecord?.default_service ?? null,
        metadata: finalMetadata,
      },
    ])
    .select()
    .single();

  if (error) {
    context.log?.error?.('sessions failed to create session record', { message: error.message });
    return respond(context, 500, { message: 'failed_to_create_session' });
  }

  // If this is a resubmission of a previously rejected loose report, mark the original as resubmitted.
  // This allows instructor UIs to remove it from the "Rejected" list after a new submission is sent.
  if (isLoose && clientMetadataAdditions.resubmitted_from) {
    const originalId = normalizeString(clientMetadataAdditions.resubmitted_from);
    const now = new Date().toISOString();

    try {
      const originalResult = await tenantClient
        .from('SessionRecords')
        .select('id, instructor_id, deleted, metadata')
        .eq('id', originalId)
        .maybeSingle();

      const original = originalResult?.data;
      const sameInstructor = normalizeString(original?.instructor_id) === normalizeString(sessionInstructorId);
      const hasRejection = Boolean(original?.metadata?.rejection);

      if (!originalResult.error && original && original.deleted && sameInstructor && hasRejection) {
        const nextMetadata = mergeMetadata(original.metadata || {}, {
          rejection: {
            ...(original.metadata?.rejection || {}),
            resubmitted_at: now,
            resubmitted_to: data.id,
          },
        });

        const updateResult = await tenantClient
          .from('SessionRecords')
          .update({ metadata: nextMetadata })
          .eq('id', originalId);

        if (updateResult.error) {
          context.log?.warn?.('sessions failed to mark original rejected report as resubmitted', {
            message: updateResult.error.message,
          });
        }
      }
    } catch (markError) {
      context.log?.warn?.('sessions failed while marking resubmitted_from', { message: markError?.message });
    }
  }

  try {
    await logAuditEvent(supabase, {
      orgId,
      userId: normalizedUserId,
      userEmail: normalizeString(userEmail),
      userRole: role,
      actionType: AUDIT_ACTIONS.SESSION_CREATED,
      actionCategory: AUDIT_CATEGORIES.SESSIONS,
      resourceType: 'session_record',
      resourceId: data.id,
      details: {
        student_id: validation.studentId,
        is_loose: isLoose,
        instructor_id: data.instructor_id,
        service_context: data.service_context,
      },
      metadata: { created_at: data.created_at },
    });
  } catch (auditError) {
    context.log?.error?.('sessions failed to log audit event', { message: auditError?.message });
  }

  return respond(context, 201, data);
}
