/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminOrOffice,
  isAdminRole,
  normalizeString,
  readEnv,
  respond,
  resolveOrgId,
  withOrgScope,
} from '../_shared/org-bff.js';
import { parseJsonBodyWithLimit, validateInstructorCreate, validateInstructorUpdate } from '../_shared/validation.js';
import { ensureInstructorColors } from '../_shared/instructor-colors.js';
import { AUDIT_ACTIONS, AUDIT_CATEGORIES, logAuditEvent } from '../_shared/audit-log.js';
import { normalizeAvailabilityWindows, hasConfiguredAvailability } from '../_shared/instructor-availability.js';
import { logTenantAuditEvent, TENANT_AUDIT_RETENTION } from '../_shared/tenant-audit.js';
import { getAuthUserById } from '../_shared/auth-users.js';

const EMPLOYEE_SELECT_COLUMNS = 'id, user_id, first_name, middle_name, last_name, employee_id, employee_type, payroll_model, current_rate, monthly_salary_amount, phone, email, start_date, is_active, notes, working_days, annual_leave_days, leave_pay_method, leave_fixed_day_rate, employment_scope, metadata, instructor_types';

function resolveDefaultPayrollModel(employeeType) {
  if (employeeType === 'instructor') {
    return 'lesson_based';
  }
  return 'hourly';
}

function validatePayrollModelForEmployeeType(employeeType, payrollModel) {
  if (!employeeType || !payrollModel) {
    return true;
  }
  if (employeeType === 'instructor') {
    return payrollModel === 'lesson_based';
  }
  if (employeeType === 'office') {
    return payrollModel === 'hourly' || payrollModel === 'monthly_salary';
  }
  return true;
}

function normalizeWorkingDaysInput(value) {
  if (value === undefined) {
    return { provided: false, valid: true, value: null };
  }
  if (value === null) {
    return { provided: true, valid: true, value: null };
  }
  if (!Array.isArray(value)) {
    return { provided: true, valid: false, value: null };
  }

  const normalized = value
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  const unique = Array.from(new Set(normalized)).sort((left, right) => left - right);

  if (unique.length !== value.length) {
    return { provided: true, valid: false, value: null };
  }

  return { provided: true, valid: true, value: unique };
}

const CAPABILITY_COMPENSATION_MODES = new Set(['hourly', 'duration_based']);

function normalizeCapabilityCompensationInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, value: null };
  }

  const mode = normalizeString(raw?.mode).toLowerCase();
  if (!CAPABILITY_COMPENSATION_MODES.has(mode)) {
    return { valid: false, value: null };
  }

  const amountAgorot = Number(raw?.amount_agorot);
  if (!Number.isFinite(amountAgorot) || amountAgorot < 0) {
    return { valid: false, value: null };
  }

  if (mode === 'duration_based') {
    const durationMinutes = Number(raw?.duration_minutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return { valid: false, value: null };
    }

    return {
      valid: true,
      value: {
        mode,
        amount_agorot: Math.round(amountAgorot),
        duration_minutes: Math.round(durationMinutes),
      },
    };
  }

  return {
    valid: true,
    value: {
      mode,
      amount_agorot: Math.round(amountAgorot),
      duration_minutes: null,
    },
  };
}

function normalizeServiceCapabilitiesInput(value) {
  if (value === undefined) {
    return { provided: false, valid: true, value: [] };
  }
  if (!Array.isArray(value)) {
    return { provided: true, valid: false, value: [] };
  }

  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    const serviceId = normalizeString(item?.service_id);
    if (!serviceId || seen.has(serviceId)) {
      return { provided: true, valid: false, value: [] };
    }
    seen.add(serviceId);
    const metadata = item?.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
      ? { ...item.metadata }
      : {};
    if (item?.metadata !== undefined && (typeof item.metadata !== 'object' || Array.isArray(item.metadata) || item.metadata === null)) {
      return { provided: true, valid: false, value: [] };
    }

    const hasCompensationInput = Object.prototype.hasOwnProperty.call(metadata, 'compensation_input');
    const normalizedCompensationInput = hasCompensationInput
      ? normalizeCapabilityCompensationInput(metadata.compensation_input)
      : { valid: true, value: null };

    if (!normalizedCompensationInput.valid) {
      return { provided: true, valid: false, value: [] };
    }

    const rawBaseRate = item?.base_rate;
    const parsedBaseRate = rawBaseRate === '' || rawBaseRate == null ? 0 : Number(rawBaseRate);
    if (!hasCompensationInput && (!Number.isFinite(parsedBaseRate) || parsedBaseRate < 0)) {
      return { provided: true, valid: false, value: [] };
    }

    if (normalizedCompensationInput.value) {
      metadata.compensation_input = normalizedCompensationInput.value;
    }

    const normalizedBaseRate = normalizedCompensationInput.value
      ? (normalizedCompensationInput.value.mode === 'duration_based'
          ? Math.round((normalizedCompensationInput.value.amount_agorot * 60) / normalizedCompensationInput.value.duration_minutes)
          : normalizedCompensationInput.value.amount_agorot)
      : Math.round(parsedBaseRate);

    normalized.push({
      service_id: serviceId,
      max_students: Number.isFinite(Number(item?.max_students)) ? Math.max(1, Number(item.max_students)) : 1,
      base_rate: normalizedBaseRate,
      availability_windows: [],
      metadata,
    });
  }

  for (let index = 0; index < normalized.length; index += 1) {
    const availabilityResult = normalizeAvailabilityWindows(value[index]?.availability_windows ?? value[index]?.availabilityWindows);
    if (!availabilityResult.valid) {
      return { provided: true, valid: false, value: [] };
    }
    normalized[index].availability_windows = availabilityResult.value;
  }

  return { provided: true, valid: true, value: normalized };
}

async function buildRosterQuery(client, orgId, includeInactive, includeInstructorTypes, isAdmin, userId) {
  const selectColumns = includeInstructorTypes
    ? EMPLOYEE_SELECT_COLUMNS
    : EMPLOYEE_SELECT_COLUMNS.replace(', instructor_types', '');

  let query = withOrgScope(client, 'Employees', orgId)
    .select(selectColumns)
    .order('first_name', { ascending: true });

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  if (!isAdmin) {
    query = query.eq('user_id', userId);
  }

  return query;
}

function hasIncompleteInstructorSetup(employee, profile, capabilities) {
  const employeeType = normalizeString(employee?.employee_type).toLowerCase();
  if (employeeType !== 'instructor') {
    return false;
  }
  const capabilityRows = Array.isArray(capabilities) ? capabilities : [];
  return capabilityRows.length === 0 || capabilityRows.some((capability) => !hasConfiguredAvailability(capability?.availability_windows));
}

async function enrichEmployees({ client, orgId, employees }) {
  if (!Array.isArray(employees) || employees.length === 0) {
    return [];
  }

  const employeeIds = employees.map((employee) => employee.id);
  const [{ data: profiles }, { data: capabilities }] = await Promise.all([
    withOrgScope(client, 'instructor_profiles', orgId)
      .select('employee_id, break_time_minutes, metadata')
      .in('employee_id', employeeIds),
    withOrgScope(client, 'instructor_service_capabilities', orgId)
      .select('employee_id, service_id, max_students, base_rate, availability_windows, metadata')
      .in('employee_id', employeeIds),
  ]);

  const profileMap = new Map((profiles || []).map((profile) => [profile.employee_id, profile]));
  const capabilitiesMap = new Map();
  (capabilities || []).forEach((capability) => {
    if (!capabilitiesMap.has(capability.employee_id)) {
      capabilitiesMap.set(capability.employee_id, []);
    }
    capabilitiesMap.get(capability.employee_id).push(capability);
  });

  return employees.map((employee) => {
    const profile = profileMap.get(employee.id) || null;
    const capabilityRows = (capabilitiesMap.get(employee.id) || []).map((capability) => ({
      ...capability,
      setup_incomplete: !hasConfiguredAvailability(capability?.availability_windows),
    }));
    return {
      ...employee,
      instructor_profile: profile,
      service_capabilities: capabilityRows,
      setup_incomplete: hasIncompleteInstructorSetup(employee, profile, capabilityRows),
    };
  });
}

async function fetchUnlinkedMembers({ supabase, orgId, enrichedEmployees }) {
  const employeeUserIds = new Set(enrichedEmployees.map((employee) => employee.user_id).filter(Boolean));

  const { data: memberships, error: membershipError } = await supabase
    .from('org_memberships')
    .select('user_id, role')
    .eq('org_id', orgId);

  if (membershipError) {
    throw membershipError;
  }

  const missingMembers = (memberships || []).filter((membership) => !employeeUserIds.has(membership.user_id));
  let profiles = [];

  if (missingMembers.length > 0) {
    const { data: profileRows, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', missingMembers.map((member) => member.user_id));

    if (!profileError) {
      profiles = profileRows || [];
    }
  }

  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));

  return missingMembers.map((member) => ({
    user_id: member.user_id,
    role: member.role,
    profile: profileMap.get(member.user_id) || null,
  }));
}

async function writeServiceCapabilities(client, orgId, instructorId, serviceCapabilities) {
  const normalizedCapabilities = Array.isArray(serviceCapabilities) ? serviceCapabilities : [];
  const { data: previousRows, error: previousError } = await withOrgScope(client, 'instructor_service_capabilities', orgId)
    .select('employee_id, service_id, max_students, base_rate, availability_windows, metadata')
    .eq('employee_id', instructorId);

  if (previousError) {
    throw previousError;
  }

  const previousCapabilities = Array.isArray(previousRows) ? previousRows : [];
  const nextPayload = normalizedCapabilities.map((capability) => ({
    employee_id: instructorId,
    service_id: capability.service_id,
    max_students: capability.max_students || 1,
    base_rate: capability.base_rate || 0,
    availability_windows: capability.availability_windows || [],
    metadata: capability.metadata || {},
  }));

  const rollbackToPrevious = async () => {
    const previousPayload = previousCapabilities.map((capability) => ({
      employee_id: instructorId,
      service_id: capability.service_id,
      max_students: capability.max_students || 1,
      base_rate: capability.base_rate || 0,
      availability_windows: capability.availability_windows || [],
      metadata: capability.metadata || {},
    }));

    if (previousPayload.length > 0) {
      const { error: restoreError } = await withOrgScope(client, 'instructor_service_capabilities', orgId)
        .upsert(previousPayload, { onConflict: 'org_id,employee_id,service_id' });
      if (restoreError) {
        throw restoreError;
      }
    }

    const previousServiceIds = previousCapabilities
      .map((capability) => capability.service_id)
      .filter(Boolean);
    const previousServiceSet = new Set(previousServiceIds);
    const restoredRowsToDelete = normalizedCapabilities
      .map((capability) => capability.service_id)
      .filter((serviceId) => serviceId && !previousServiceSet.has(serviceId));

    if (restoredRowsToDelete.length > 0) {
      const { error: cleanupError } = await withOrgScope(client, 'instructor_service_capabilities', orgId)
        .delete()
        .eq('employee_id', instructorId)
        .in('service_id', restoredRowsToDelete);
      if (cleanupError) {
        throw cleanupError;
      }
    }
  };

  try {
    if (nextPayload.length > 0) {
      const { error: upsertError } = await withOrgScope(client, 'instructor_service_capabilities', orgId)
        .upsert(nextPayload, { onConflict: 'org_id,employee_id,service_id' });

      if (upsertError) {
        throw upsertError;
      }
    }

    const nextServiceIds = nextPayload
      .map((capability) => capability.service_id)
      .filter(Boolean);
    const nextServiceSet = new Set(nextServiceIds);
    const removedServiceIds = previousCapabilities
      .map((capability) => capability.service_id)
      .filter((serviceId) => serviceId && !nextServiceSet.has(serviceId));

    if (removedServiceIds.length > 0) {
      const { error: deleteError } = await withOrgScope(client, 'instructor_service_capabilities', orgId)
        .delete()
        .eq('employee_id', instructorId)
        .in('service_id', removedServiceIds);
      if (deleteError) {
        throw deleteError;
      }
    }
  } catch (error) {
    try {
      await rollbackToPrevious();
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
}

async function writeTenantAudit(context, client, params) {
  try {
    await logTenantAuditEvent(client, params);
  } catch (error) {
    context.log?.warn?.('instructors failed to write tenant audit', {
      message: error?.message,
      eventType: params?.eventType,
      resourceType: params?.resourceType,
      resourceId: params?.resourceId,
    });
  }
}

export default async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('instructors missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('instructors missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('instructors failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = parseJsonBodyWithLimit(req, 96 * 1024, { mode: 'observe', context, endpoint: 'instructors' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('instructors failed to verify membership', {
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
  const isOffice = !isAdmin && isAdminOrOffice(role);

  if (method === 'GET') {
    const colorResult = await ensureInstructorColors(supabase, {
      context,
      table: 'Employees',
      columns: 'id, metadata',
    });
    if (colorResult?.error) {
      context.log?.error?.('instructors failed to ensure color assignments', { message: colorResult.error.message });
    }

    const includeInactive = normalizeString(req?.query?.include_inactive).toLowerCase() === 'true';
    const includeUnlinkedMembers = normalizeString(req?.query?.include_unlinked_members).toLowerCase() === 'true';

    let rosterResult = await buildRosterQuery(supabase, orgId, includeInactive, true, isAdmin, userId);
    if (rosterResult.error && rosterResult.error?.code === '42703') {
      rosterResult = await buildRosterQuery(supabase, orgId, includeInactive, false, isAdmin, userId);
    }

    if (rosterResult.error) {
      context.log?.error?.('instructors failed to fetch roster', { message: rosterResult.error.message });
      return respond(context, 500, { message: 'failed_to_load_instructors' });
    }

    const employees = Array.isArray(rosterResult.data) ? rosterResult.data : [];
    const enrichedEmployees = await enrichEmployees({ client: supabase, orgId, employees });

    if (includeUnlinkedMembers) {
      if (!isAdmin) {
        return respond(context, 403, { message: 'forbidden' });
      }

      try {
        const unlinkedMembers = await fetchUnlinkedMembers({ supabase, orgId, enrichedEmployees });
        return respond(context, 200, {
          employees: enrichedEmployees,
          unlinked_members: unlinkedMembers,
        });
      } catch (error) {
        context.log?.error?.('instructors failed to load unlinked members', { message: error.message });
        return respond(context, 500, { message: 'failed_to_load_org_members' });
      }
    }

    return respond(context, 200, enrichedEmployees);
  }

  if (method === 'POST') {
    if (!isAdmin) {
      return respond(context, 403, { message: 'forbidden' });
    }

    const validation = validateInstructorCreate(body);
    if (validation.error) {
      return respond(context, 400, { message: validation.error });
    }

    const workingDaysInput = normalizeWorkingDaysInput(body?.working_days);
    if (!workingDaysInput.valid) {
      return respond(context, 400, { message: 'invalid_working_days' });
    }

    const serviceCapabilitiesInput = normalizeServiceCapabilitiesInput(body?.service_capabilities);
    if (!serviceCapabilitiesInput.valid) {
      return respond(context, 400, { message: 'invalid_service_capabilities' });
    }

    if (validation.userId) {
      const { data: membership, error: membershipError } = await supabase
        .from('org_memberships')
        .select('user_id')
        .eq('org_id', orgId)
        .eq('user_id', validation.userId)
        .maybeSingle();

      if (membershipError) {
        context.log?.error?.('instructors failed to verify target membership', { message: membershipError.message });
        return respond(context, 500, { message: 'failed_to_verify_target_membership' });
      }

      if (!membership) {
        return respond(context, 400, { message: 'user_not_in_organization' });
      }
    }

    let profileName = '';
    let profileEmail = '';
    if (validation.userId) {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, full_name')
          .eq('id', validation.userId)
          .maybeSingle();
        const authUser = await getAuthUserById(supabase, validation.userId);
        profileName = normalizeString(profile?.full_name);
        profileEmail = normalizeString(authUser?.email).toLowerCase();
      } catch {
        // Best-effort only.
      }
    }

    const nameParts = profileName ? profileName.split(' ') : [];
    const fallbackFirst = nameParts[0] || validation.email || profileEmail || 'משתמש';
    const fallbackLast = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

    const employeeType = validation.employeeType || 'instructor';
    const payrollModel = validation.payrollModel || resolveDefaultPayrollModel(employeeType);
    if (!validatePayrollModelForEmployeeType(employeeType, payrollModel)) {
      return respond(context, 400, { message: 'invalid_payroll_model_for_employee_type' });
    }
    const insertPayload = {
      ...(validation.userId ? { user_id: validation.userId } : {}),
      first_name: validation.firstName || fallbackFirst,
      middle_name: validation.middleName || (nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : null),
      last_name: validation.lastName || fallbackLast || (validation.isManual ? '' : validation.userId),
      employee_id: validation.employeeId,
      employee_type: employeeType,
      payroll_model: payrollModel,
      current_rate: validation.currentRate,
      monthly_salary_amount: validation.monthlySalaryAmount,
      email: validation.email || profileEmail || null,
      phone: validation.phone || null,
      start_date: validation.startDate,
      is_active: true,
      notes: validation.notes || null,
      working_days: employeeType === 'office' ? workingDaysInput.value : null,
      annual_leave_days: validation.annualLeaveDays,
      leave_pay_method: validation.leavePayMethod || null,
      leave_fixed_day_rate: validation.leaveFixedDayRate,
      employment_scope: validation.employmentScope || null,
    };

    const { data, error } = await withOrgScope(supabase, 'Employees', orgId)
      .insert(insertPayload)
      .select(EMPLOYEE_SELECT_COLUMNS)
      .single();

    if (error) {
      context.log?.error?.('instructors failed to insert employee', { message: error.message });
      return respond(context, 500, { message: 'failed_to_save_instructor' });
    }

    if (employeeType === 'instructor' && body?.break_time_minutes !== undefined) {
      const profilePayload = { employee_id: data.id };
      if (body?.break_time_minutes !== undefined) {
        profilePayload.break_time_minutes = body.break_time_minutes;
      }

      const { error: profileError } = await withOrgScope(supabase, 'instructor_profiles', orgId)
        .upsert(profilePayload, { onConflict: 'employee_id' });

      if (profileError) {
        context.log?.error?.('instructors failed to create instructor profile', { message: profileError.message });
        return respond(context, 500, { message: 'failed_to_save_instructor_profile' });
      }
    }

    if (employeeType === 'instructor' && serviceCapabilitiesInput.provided) {
      try {
        const beforeCapabilities = [];
        await writeServiceCapabilities(supabase, orgId, data.id, serviceCapabilitiesInput.value);
        await writeTenantAudit(context, supabase, {
          actorUserId: userId,
          eventType: 'instructor.service_capabilities.updated',
          retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
          resourceType: 'employee',
          resourceId: data.id,
          beforeState: beforeCapabilities,
          afterState: serviceCapabilitiesInput.value,
          details: {
            origin: 'api/instructors',
            action: 'create',
          },
        });
      } catch (serviceError) {
        context.log?.error?.('instructors failed to save instructor services', { message: serviceError.message });
        return respond(context, 500, { message: 'failed_to_save_service_capabilities' });
      }
    }

    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail: authResult.data.user.email || '',
      userRole: role,
      actionType: AUDIT_ACTIONS.INSTRUCTOR_CREATED,
      actionCategory: AUDIT_CATEGORIES.INSTRUCTORS,
      resourceType: 'instructor',
      resourceId: data.id,
      details: {
        instructor_name: `${data.first_name} ${data.last_name || ''}`.trim(),
        instructor_email: data.email,
        employee_type: data.employee_type,
      },
    });

    const [enriched] = await enrichEmployees({ client: supabase, orgId, employees: [data] });
    return respond(context, 200, enriched || data);
  }

  if (method === 'PUT') {
    const { data: orgSettings, error: permError } = await supabase
      .from('organizations')
      .select('permissions')
      .eq('id', orgId)
      .maybeSingle();

    if (permError) {
      context.log?.error?.('instructors failed to load permissions', { message: permError.message });
      return respond(context, 500, { message: 'failed_to_load_permissions' });
    }

    let permissions = orgSettings?.permissions;
    if (typeof permissions === 'string') {
      try {
        permissions = JSON.parse(permissions);
      } catch {
        permissions = {};
      }
    }
    if (!permissions || typeof permissions !== 'object') {
      permissions = {};
    }

    const validation = validateInstructorUpdate(body, permissions);
    if (validation.error) {
      return respond(context, 400, { message: validation.error });
    }

    const instructorId = validation.instructorId;
    const updates = { ...validation.updates };
    const workingDaysInput = normalizeWorkingDaysInput(body?.working_days);
    const serviceCapabilitiesInput = normalizeServiceCapabilitiesInput(body?.service_capabilities);

    if (!workingDaysInput.valid) {
      return respond(context, 400, { message: 'invalid_working_days' });
    }
    if (!serviceCapabilitiesInput.valid) {
      return respond(context, 400, { message: 'invalid_service_capabilities' });
    }

    const { data: existingEmployee, error: fetchError } = await withOrgScope(supabase, 'Employees', orgId)
      .select('*')
      .eq('id', instructorId)
      .maybeSingle();

    if (fetchError) {
      context.log?.error?.('instructors failed to fetch existing employee', { message: fetchError.message, instructorId });
      return respond(context, 500, { message: 'failed_to_fetch_instructor' });
    }
    if (!existingEmployee) {
      return respond(context, 404, { message: 'instructor_not_found' });
    }

    const isSelf = existingEmployee.user_id === userId;
    if (!isAdmin) {
      if (isOffice) {
        const officeAllowedKeys = ['__metadata_custom_preanswers'];
        const officeDisallowed = Object.keys(updates).filter((key) => !officeAllowedKeys.includes(key));
        const officeConfigOnly = officeDisallowed.length === 0
          && (serviceCapabilitiesInput.provided || body?.break_time_minutes !== undefined || Boolean(updates.__metadata_custom_preanswers));

        if (!officeConfigOnly) {
          return respond(context, 403, { message: 'forbidden' });
        }
      } else {
        const allowedKeys = ['__metadata_custom_preanswers'];
        const disallowed = Object.keys(updates).filter((key) => !allowedKeys.includes(key));
        if (disallowed.length > 0 || !isSelf) {
          return respond(context, 403, { message: 'forbidden' });
        }
      }
    }

    const existingMetadata = existingEmployee.metadata && typeof existingEmployee.metadata === 'object'
      ? existingEmployee.metadata
      : {};
    const metadataPatch = updates.__metadata_custom_preanswers;
    if (metadataPatch) {
      delete updates.__metadata_custom_preanswers;
      updates.metadata = {
        ...existingMetadata,
        custom_preanswers: metadataPatch,
      };
    }

    const targetEmployeeType = normalizeString(updates.employee_type ?? existingEmployee.employee_type).toLowerCase();
    const existingEmployeeType = normalizeString(existingEmployee.employee_type).toLowerCase();
    const targetPayrollModel = normalizeString(
      updates.payroll_model ?? existingEmployee.payroll_model ?? resolveDefaultPayrollModel(targetEmployeeType || existingEmployeeType)
    ).toLowerCase();
    const isRoleConversionToInstructor = existingEmployeeType !== 'instructor' && targetEmployeeType === 'instructor';

    if (targetEmployeeType && targetPayrollModel && !validatePayrollModelForEmployeeType(targetEmployeeType, targetPayrollModel)) {
      return respond(context, 400, { message: 'invalid_payroll_model_for_employee_type' });
    }

    if (!existingEmployee.payroll_model && !updates.payroll_model) {
      updates.payroll_model = resolveDefaultPayrollModel(targetEmployeeType || existingEmployeeType || 'office');
    }

    if (isRoleConversionToInstructor) {
      if (!serviceCapabilitiesInput.provided || serviceCapabilitiesInput.value.length === 0) {
        return respond(context, 400, { message: 'instructor_service_capabilities_required' });
      }
    }

    if (targetEmployeeType === 'office' && workingDaysInput.provided) {
      updates.working_days = workingDaysInput.value;
    } else if (targetEmployeeType === 'instructor' && Object.prototype.hasOwnProperty.call(updates, 'working_days')) {
      delete updates.working_days;
    }

    if (Object.keys(updates).length === 0 && !workingDaysInput.provided && !serviceCapabilitiesInput.provided && body?.break_time_minutes === undefined) {
      return respond(context, 400, { message: 'no updates provided' });
    }

    const changedFields = [];
    for (const [key, value] of Object.entries(updates)) {
      const previous = existingEmployee[key] === undefined ? null : existingEmployee[key];
      const next = value === undefined ? null : value;
      if (JSON.stringify(previous) !== JSON.stringify(next)) {
        changedFields.push(key);
      }
    }

    let employeeRecord = existingEmployee;
    if (Object.keys(updates).length > 0) {
      const { data, error } = await withOrgScope(supabase, 'Employees', orgId)
        .update(updates)
        .eq('id', instructorId)
        .select(EMPLOYEE_SELECT_COLUMNS)
        .maybeSingle();

      if (error) {
        context.log?.error?.('instructors failed to update employee', { message: error.message, instructorId });
        return respond(context, 500, { message: 'failed_to_update_instructor' });
      }
      if (!data) {
        return respond(context, 404, { message: 'instructor_not_found' });
      }
      employeeRecord = data;
    }

    if (targetEmployeeType === 'instructor' && body?.break_time_minutes !== undefined) {
      const profilePayload = { employee_id: instructorId };
      if (body?.break_time_minutes !== undefined) {
        profilePayload.break_time_minutes = body.break_time_minutes;
      }

      const { error: profileError } = await withOrgScope(supabase, 'instructor_profiles', orgId)
        .upsert(profilePayload, { onConflict: 'employee_id' });

      if (profileError) {
        context.log?.error?.('instructors failed to upsert instructor profile', { message: profileError.message, instructorId });
        return respond(context, 500, { message: 'failed_to_update_instructor_profile' });
      }
      changedFields.push('instructor_profile');
    }

    if (serviceCapabilitiesInput.provided) {
      try {
        const { data: previousCapabilities } = await withOrgScope(supabase, 'instructor_service_capabilities', orgId)
          .select('employee_id, service_id, max_students, base_rate, availability_windows, metadata')
          .eq('employee_id', instructorId);
        await writeServiceCapabilities(supabase, orgId, instructorId, serviceCapabilitiesInput.value);
        changedFields.push('service_capabilities');
        await writeTenantAudit(context, supabase, {
          actorUserId: userId,
          eventType: 'instructor.service_capabilities.updated',
          retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
          resourceType: 'employee',
          resourceId: instructorId,
          beforeState: previousCapabilities || [],
          afterState: serviceCapabilitiesInput.value,
          details: {
            origin: 'api/instructors',
            action: 'update',
          },
        });
      } catch (serviceError) {
        context.log?.error?.('instructors failed to update service capabilities', { message: serviceError.message, instructorId });
        if (serviceError?.rollbackError) {
          context.log?.error?.('instructors failed to rollback service capabilities', {
            message: serviceError.rollbackError.message,
            instructorId,
          });
          return respond(context, 500, { message: 'failed_to_restore_service_capabilities' });
        }
        return respond(context, 500, { message: 'failed_to_update_service_capabilities' });
      }
    }

    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail: authResult.data.user.email || '',
      userRole: role,
      actionType: AUDIT_ACTIONS.INSTRUCTOR_UPDATED,
      actionCategory: AUDIT_CATEGORIES.INSTRUCTORS,
      resourceType: 'instructor',
      resourceId: instructorId,
      details: {
        updated_fields: Array.from(new Set(changedFields)),
        instructor_name: `${employeeRecord.first_name} ${employeeRecord.last_name || ''}`.trim(),
      },
    });

    const [{ data: refreshedEmployee, error: refreshedEmployeeError }] = await Promise.all([
      withOrgScope(supabase, 'Employees', orgId)
        .select(EMPLOYEE_SELECT_COLUMNS)
        .eq('id', instructorId)
        .maybeSingle(),
    ]);

    if (refreshedEmployeeError || !refreshedEmployee) {
      context.log?.error?.('instructors failed to refresh employee after update', {
        message: refreshedEmployeeError?.message,
        instructorId,
      });
      return respond(context, 500, { message: 'failed_to_refresh_instructor' });
    }

    const [enriched] = await enrichEmployees({ client: supabase, orgId, employees: [refreshedEmployee] });
    return respond(context, 200, enriched || refreshedEmployee);
  }

  if (method === 'DELETE') {
    if (!isAdmin) {
      return respond(context, 403, { message: 'forbidden' });
    }

    const instructorId = normalizeString(body?.id || body?.instructor_id || body?.instructorId || '');
    if (!instructorId) {
      return respond(context, 400, { message: 'missing instructor id' });
    }

    const { data, error } = await withOrgScope(supabase, 'Employees', orgId)
      .update({ is_active: false })
      .eq('id', instructorId)
      .select(EMPLOYEE_SELECT_COLUMNS)
      .maybeSingle();

    if (error) {
      context.log?.error?.('instructors failed to disable instructor', { message: error.message, instructorId });
      return respond(context, 500, { message: 'failed_to_disable_instructor' });
    }
    if (!data) {
      return respond(context, 404, { message: 'instructor_not_found' });
    }

    return respond(context, 200, data);
  }

  return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET,POST,PUT,DELETE' });
}
