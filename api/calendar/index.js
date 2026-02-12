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
import { parseJsonBodyWithLimit } from '../_shared/validation.js';

const MAX_BODY_BYTES = 128 * 1024;

/**
 * GET /api/calendar/instances
 * Query params:
 *   - org_id (required)
 *   - date (YYYY-MM-DD, optional, defaults to today)
 *   - start_date (YYYY-MM-DD, optional, for range queries)
 *   - end_date (YYYY-MM-DD, optional, for range queries)
 *   - instructor_id (UUID, optional, filter by instructor)
 *
 * Returns: Array of lesson instances with embedded participants, students, services, and instructors
 */
export default async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase();

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('calendar/instances missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('calendar/instances missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('calendar/instances failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'calendar/instances' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('calendar/instances failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const isAdmin = isAdminRole(role);

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  if (method === 'GET') {
    return await handleGetInstances(context, req, tenantClient, userId, isAdmin);
  }

  if (method === 'POST') {
    return await handleCreateInstance(context, body, tenantClient, userId, isAdmin);
  }

  if (method === 'PUT') {
    return await handleUpdateInstance(context, body, tenantClient, userId, isAdmin);
  }

  return respond(context, 405, { message: 'method not allowed' });
}

async function handleGetInstances(context, req, tenantClient, userId, isAdmin) {
  const queryParams = req.query || {};
  
  // Parse date parameters
  const dateParam = normalizeString(queryParams.date);
  const startDateParam = normalizeString(queryParams.start_date);
  const endDateParam = normalizeString(queryParams.end_date);
  const instructorIdParam = normalizeString(queryParams.instructor_id);

  // Determine date range
  let startDate, endDate;
  
  if (startDateParam && endDateParam) {
    // Range query
    startDate = startDateParam;
    endDate = endDateParam;
  } else if (dateParam) {
    // Single date query (day view)
    startDate = dateParam;
    endDate = dateParam;
  } else {
    // Default to today
    const today = new Date().toISOString().split('T')[0];
    startDate = today;
    endDate = today;
  }

  // Validate date format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
    return respond(context, 400, { message: 'invalid date format, use YYYY-MM-DD' });
  }

  // Build query
  let instancesQuery = tenantClient
    .from('lesson_instances')
    .select(`
      id,
      template_id,
      datetime_start,
      duration_minutes,
      instructor_employee_id,
      service_id,
      status,
      documentation_status,
      created_source,
      metadata,
      created_at,
      updated_at,
      lesson_participants!inner (
        id,
        student_id,
        participant_status,
        price_charged,
        pricing_breakdown,
        commitment_id,
        documentation_ref,
        metadata,
        students (
          id,
          first_name,
          middle_name,
          last_name,
          metadata
        )
      ),
      Services (
        id,
        service_name,
        color,
        is_active,
        metadata
      ),
      Employees (
        id,
        first_name,
        middle_name,
        last_name,
        email,
        metadata
      )
    `)
    .gte('datetime_start', `${startDate}T00:00:00`)
    .lte('datetime_start', `${endDate}T23:59:59`)
    .order('datetime_start', { ascending: true });

  // Filter by instructor if provided
  if (instructorIdParam) {
    instancesQuery = instancesQuery.eq('instructor_employee_id', instructorIdParam);
  }

  // Non-admin users: filter by their instructor record
  if (!isAdmin) {
    // Find instructor record for this user
    const { data: instructors, error: instructorError } = await tenantClient
      .from('Employees')
      .select('id')
      .eq('user_id', userId)
      .limit(1);

    if (instructorError) {
      context.log?.error?.('calendar/instances failed to find instructor', { message: instructorError.message });
      return respond(context, 500, { message: 'failed_to_load_instructor' });
    }

    if (!instructors || instructors.length === 0) {
      // User is not an instructor, return empty array
      return respond(context, 200, []);
    }

    instancesQuery = instancesQuery.eq('instructor_employee_id', instructors[0].id);
  }

  const { data: instances, error } = await instancesQuery;

  if (error) {
    context.log?.error?.('calendar/instances failed to fetch instances', { 
      message: error.message,
      code: error.code,
      details: error.details,
    });
    return respond(context, 500, { message: 'failed_to_load_instances' });
  }

  // Transform data for frontend consumption
  const transformedInstances = (instances || []).map(instance => {
    const participants = Array.isArray(instance.lesson_participants) 
      ? instance.lesson_participants.map(p => ({
          id: p.id,
          student_id: p.student_id,
          participant_status: p.participant_status,
          price_charged: p.price_charged,
          pricing_breakdown: p.pricing_breakdown,
          commitment_id: p.commitment_id,
          documentation_ref: p.documentation_ref,
          metadata: p.metadata,
          student: p.students ? {
            id: p.students.id,
            first_name: p.students.first_name,
            middle_name: p.students.middle_name,
            last_name: p.students.last_name,
            full_name: [p.students.first_name, p.students.middle_name, p.students.last_name]
              .filter(Boolean)
              .join(' '),
            metadata: p.students.metadata,
          } : null,
        }))
      : [];

    return {
      id: instance.id,
      template_id: instance.template_id,
      datetime_start: instance.datetime_start,
      duration_minutes: instance.duration_minutes,
      instructor_employee_id: instance.instructor_employee_id,
      service_id: instance.service_id,
      status: instance.status,
      documentation_status: instance.documentation_status,
      created_source: instance.created_source,
      metadata: instance.metadata,
      created_at: instance.created_at,
      updated_at: instance.updated_at,
      participants,
      service: instance.Services ? {
        id: instance.Services.id,
        service_name: instance.Services.service_name,
        color: instance.Services.color,
        is_active: instance.Services.is_active,
        metadata: instance.Services.metadata,
      } : null,
      instructor: instance.Employees ? {
        id: instance.Employees.id,
        first_name: instance.Employees.first_name,
        middle_name: instance.Employees.middle_name,
        last_name: instance.Employees.last_name,
        full_name: [instance.Employees.first_name, instance.Employees.middle_name, instance.Employees.last_name]
          .filter(Boolean)
          .join(' '),
        email: instance.Employees.email,
        metadata: instance.Employees.metadata,
      } : null,
    };
  });

  return respond(context, 200, transformedInstances);
}

async function handleCreateInstance(context, body, tenantClient, userId, isAdmin) {
  // Validate required fields
  if (!body.datetime_start) {
    return respond(context, 400, { message: 'missing datetime_start' });
  }
  if (!body.duration_minutes || body.duration_minutes <= 0) {
    return respond(context, 400, { message: 'missing or invalid duration_minutes' });
  }
  if (!body.instructor_employee_id) {
    return respond(context, 400, { message: 'missing instructor_employee_id' });
  }
  if (!body.service_id) {
    return respond(context, 400, { message: 'missing service_id' });
  }
  if (!body.student_ids || !Array.isArray(body.student_ids) || body.student_ids.length === 0) {
    return respond(context, 400, { message: 'missing or invalid student_ids array' });
  }

  // Non-admin users can only create lessons for themselves
  if (!isAdmin) {
    const { data: instructors } = await tenantClient
      .from('Employees')
      .select('id')
      .eq('user_id', userId)
      .limit(1);
    
    if (!instructors || instructors.length === 0 || instructors[0].id !== body.instructor_employee_id) {
      return respond(context, 403, { message: 'forbidden: can only create lessons for yourself' });
    }
  }

  // Verify instructor exists
  const { data: instructor, error: instructorError } = await tenantClient
    .from('Employees')
    .select('id')
    .eq('id', body.instructor_employee_id)
    .eq('is_active', true)
    .single();

  if (instructorError || !instructor) {
    return respond(context, 400, { message: 'invalid instructor_employee_id' });
  }

  // Verify service exists
  const { data: service, error: serviceError } = await tenantClient
    .from('Services')
    .select('id')
    .eq('id', body.service_id)
    .eq('is_active', true)
    .single();

  if (serviceError || !service) {
    return respond(context, 400, { message: 'invalid service_id' });
  }

  // Create lesson instance
  const instanceData = {
    template_id: body.template_id || null,
    datetime_start: body.datetime_start,
    duration_minutes: body.duration_minutes,
    instructor_employee_id: body.instructor_employee_id,
    service_id: body.service_id,
    status: body.status || 'scheduled',
    documentation_status: body.documentation_status || 'undocumented',
    created_source: body.created_source || 'manual',
    metadata: body.metadata || {},
  };

  const { data: instance, error: instanceError } = await tenantClient
    .from('lesson_instances')
    .insert(instanceData)
    .select()
    .single();

  if (instanceError) {
    context.log?.error?.('calendar/instances failed to create instance', { 
      message: instanceError.message,
      code: instanceError.code,
      details: instanceError.details,
      hint: instanceError.hint,
    });
    return respond(context, 500, {
      message: 'failed_to_create_instance',
      error: instanceError.code || 'instance_insert_failed',
      details: instanceError.message,
    });
  }

  // Create participants
  const participantData = body.student_ids.map(studentId => ({
    lesson_instance_id: instance.id,
    student_id: studentId,
    participant_status: 'pending',
    price_charged: null,
    pricing_breakdown: null,
    commitment_id: null,
    documentation_ref: null,
    metadata: {},
  }));

  const { error: participantsError } = await tenantClient
    .from('lesson_participants')
    .insert(participantData);

  if (participantsError) {
    context.log?.error?.('calendar/instances failed to create participants', { 
      message: participantsError.message,
      code: participantsError.code,
      details: participantsError.details,
      hint: participantsError.hint,
    });
    // Rollback instance creation
    await tenantClient.from('lesson_instances').delete().eq('id', instance.id);
    return respond(context, 500, {
      message: 'failed_to_create_participants',
      error: participantsError.code || 'participants_insert_failed',
      details: participantsError.message,
    });
  }

  return respond(context, 201, { id: instance.id, message: 'instance created successfully' });
}

async function handleUpdateInstance(context, body, tenantClient, userId, isAdmin) {
  if (!body.id) {
    return respond(context, 400, { message: 'missing instance id' });
  }

  // Fetch existing instance
  const { data: existingInstance, error: fetchError } = await tenantClient
    .from('lesson_instances')
    .select('id, instructor_employee_id, status')
    .eq('id', body.id)
    .single();

  if (fetchError || !existingInstance) {
    return respond(context, 404, { message: 'instance not found' });
  }

  // Non-admin users can only update their own lessons
  if (!isAdmin) {
    const { data: instructors } = await tenantClient
      .from('Employees')
      .select('id')
      .eq('user_id', userId)
      .limit(1);
    
    if (!instructors || instructors.length === 0 || instructors[0].id !== existingInstance.instructor_employee_id) {
      return respond(context, 403, { message: 'forbidden: can only update your own lessons' });
    }
  }

  // Build update object (only update provided fields)
  const updateData = {};
  
  if (body.datetime_start !== undefined) updateData.datetime_start = body.datetime_start;
  if (body.duration_minutes !== undefined) updateData.duration_minutes = body.duration_minutes;
  if (body.instructor_employee_id !== undefined) updateData.instructor_employee_id = body.instructor_employee_id;
  if (body.service_id !== undefined) updateData.service_id = body.service_id;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.cancellation_reason !== undefined) updateData.cancellation_reason = body.cancellation_reason;
  if (body.documentation_status !== undefined) updateData.documentation_status = body.documentation_status;
  if (body.metadata !== undefined) updateData.metadata = body.metadata;
  
  updateData.updated_at = new Date().toISOString();

  // Update instance
  const { error: updateError } = await tenantClient
    .from('lesson_instances')
    .update(updateData)
    .eq('id', body.id);

  if (updateError) {
    context.log?.error?.('calendar/instances failed to update instance', { 
      message: updateError.message,
      code: updateError.code,
    });
    return respond(context, 500, { message: 'failed_to_update_instance' });
  }

  return respond(context, 200, { message: 'instance updated successfully' });
}
