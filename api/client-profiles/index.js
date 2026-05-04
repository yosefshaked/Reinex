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
  resolveOrgId,
  respond,
  withOrgScope,
} from '../_shared/org-bff.js';
import { logTenantAuditEvent, TENANT_AUDIT_RETENTION } from '../_shared/tenant-audit.js';
import {
  coerceBooleanFlag,
  coerceEmail,
  coerceIdentityNumber,
  coerceNotificationMethod,
  coerceOnboardingStatus,
  coerceOptionalDate,
  coerceTags,
  validateIsraeliPhone,
} from '../_shared/student-validation.js';
import { createOrReuseClientProfile, fetchPrimaryGuardianForClientProfile, maskIfAnonymized } from '../_shared/client-profiles.js';

function buildDisplayName(row) {
  return [row?.first_name, row?.middle_name, row?.last_name].filter(Boolean).join(' ').trim() || 'ללא שם';
}

function mergeClientProfile(profile, studentId = null, guardian = null) {
  const masked = maskIfAnonymized(profile) || {};
  return {
    ...masked,
    full_name: buildDisplayName(masked),
    student_id: studentId || null,
    guardian: guardian || null,
    is_student: Boolean(studentId),
  };
}

function parsePagination(query) {
  const rawLimit = Number.parseInt(normalizeString(query?.limit) || '', 10);
  const rawOffset = Number.parseInt(normalizeString(query?.offset) || '', 10);
  return {
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 25,
    offset: Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0,
  };
}

function isPaginationRequested(query) {
  const parsed = coerceBooleanFlag(query?.pagination ?? query?.paginated, { defaultValue: false, allowUndefined: true });
  return Boolean(parsed.valid && parsed.value);
}

function buildSearchOrClause(searchTerm) {
  const normalized = normalizeString(searchTerm);
  if (!normalized) return '';
  return [
    `first_name.ilike.%${normalized}%`,
    `middle_name.ilike.%${normalized}%`,
    `last_name.ilike.%${normalized}%`,
    `identity_number.ilike.%${normalized}%`,
    `phone.ilike.%${normalized}%`,
    `email.ilike.%${normalized}%`,
  ].join(',');
}

function buildUpdatePayload(body) {
  const updates = {};
  let hasAny = false;

  if (Object.prototype.hasOwnProperty.call(body, 'first_name') || Object.prototype.hasOwnProperty.call(body, 'firstName')) {
    const firstName = normalizeString(body.first_name ?? body.firstName);
    if (!firstName) return { error: 'invalid_first_name' };
    updates.first_name = firstName;
    hasAny = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'middle_name') || Object.prototype.hasOwnProperty.call(body, 'middleName')) {
    updates.middle_name = normalizeString(body.middle_name ?? body.middleName) || null;
    hasAny = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'last_name') || Object.prototype.hasOwnProperty.call(body, 'lastName')) {
    const lastName = normalizeString(body.last_name ?? body.lastName);
    if (!lastName) return { error: 'invalid_last_name' };
    updates.last_name = lastName;
    hasAny = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'identity_number') || Object.prototype.hasOwnProperty.call(body, 'identityNumber')) {
    const result = coerceIdentityNumber(body.identity_number ?? body.identityNumber);
    if (!result.valid) return { error: 'invalid_identity_number' };
    updates.identity_number = result.value;
    hasAny = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
    const result = validateIsraeliPhone(body.phone);
    if (!result.valid) return { error: 'invalid_phone' };
    updates.phone = result.value;
    hasAny = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'email')) {
    const result = coerceEmail(body.email);
    if (!result.valid) return { error: 'invalid_email' };
    updates.email = result.value;
    hasAny = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'date_of_birth') || Object.prototype.hasOwnProperty.call(body, 'dateOfBirth')) {
    const result = coerceOptionalDate(body.date_of_birth ?? body.dateOfBirth);
    if (!result.valid) return { error: 'invalid_date_of_birth' };
    updates.date_of_birth = result.value;
    hasAny = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'default_notification_method') || Object.prototype.hasOwnProperty.call(body, 'defaultNotificationMethod')) {
    const result = coerceNotificationMethod(body.default_notification_method ?? body.defaultNotificationMethod);
    if (!result.valid) return { error: 'invalid_notification_method' };
    updates.default_notification_method = result.value;
    hasAny = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'tags')) {
    const result = coerceTags(body.tags);
    if (!result.valid) return { error: 'invalid_tags' };
    updates.tags = result.value;
    hasAny = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'onboarding_status') || Object.prototype.hasOwnProperty.call(body, 'onboardingStatus')) {
    const result = coerceOnboardingStatus(body.onboarding_status ?? body.onboardingStatus);
    if (!result.valid) return { error: 'invalid_onboarding_status' };
    updates.onboarding_status = result.value;
    hasAny = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'is_active') || Object.prototype.hasOwnProperty.call(body, 'isActive')) {
    const result = coerceBooleanFlag(body.is_active ?? body.isActive, { defaultValue: true, allowUndefined: false });
    if (!result.valid) return { error: 'invalid_is_active' };
    updates.is_active = Boolean(result.value);
    hasAny = true;
  }

  if (!hasAny) return { error: 'missing_updates' };
  return { updates };
}

export default async function handler(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PATCH'].includes(method)) {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET,POST,PATCH' });
  }

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
  } catch {
    return respond(context, 401, { message: 'invalid or expired token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = method === 'GET' ? parseRequestBody(null) : parseRequestBody(req);
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  const role = await ensureMembership(supabase, orgId, userId);
  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const clientProfileId = normalizeString(context?.bindingData?.clientProfileId);

  if (method === 'GET') {
    if (!isAdminOrOffice(role)) {
      return respond(context, 403, { message: 'forbidden' });
    }

    if (clientProfileId && UUID_PATTERN.test(clientProfileId)) {
      const { data: profile, error } = await withOrgScope(supabase, 'client_profiles', orgId)
        .select('*')
        .eq('id', clientProfileId)
        .maybeSingle();
      if (error) return respond(context, 500, { message: 'failed_to_load_client_profile' });
      if (!profile) return respond(context, 404, { message: 'client_profile_not_found' });
      const { data: student } = await withOrgScope(supabase, 'students', orgId).select('id').eq('client_profile_id', clientProfileId).maybeSingle();
      const { guardian } = await fetchPrimaryGuardianForClientProfile(supabase, clientProfileId);
      return respond(context, 200, mergeClientProfile(profile, student?.id || null, guardian || null));
    }

    const paginationRequested = isPaginationRequested(req?.query);
    const { limit, offset } = parsePagination(req?.query);
    const status = normalizeString(req?.query?.status) || 'non_student';
    const segment = normalizeString(req?.query?.segment || req?.query?.kind);
    const search = normalizeString(req?.query?.search);

    let query = withOrgScope(supabase, 'client_profiles', orgId)
      .select('*', { count: 'exact' })
      .order('first_name', { ascending: true })
      .order('last_name', { ascending: true });

    const searchClause = buildSearchOrClause(search);
    if (searchClause) {
      query = query.or(searchClause);
    }

    const { data: profiles, error } = await query;
    if (error) return respond(context, 500, { message: 'failed_to_load_client_profiles' });

    let rows = Array.isArray(profiles) ? profiles : [];

    const profileIds = rows.map((row) => row.id);
    const { data: students } = profileIds.length > 0
      ? await withOrgScope(supabase, 'students', orgId)
        .select('id, client_profile_id')
        .in('client_profile_id', profileIds)
      : { data: [] };

    const studentMap = new Map((students || []).map((row) => [row.client_profile_id, row.id]));
    if (status === 'non_student') {
      rows = rows.filter((row) => !studentMap.has(row.id));
    } else if (status === 'student') {
      rows = rows.filter((row) => studentMap.has(row.id));
    }

    if (segment === 'one_time_customers' && rows.length > 0) {
      const currentProfileIds = rows.map((row) => row.id);
      const [{ data: lessonParticipants }, { data: formSubmissions }, { data: waitingListEntries }] = await Promise.all([
        withOrgScope(supabase, 'lesson_participants', orgId)
          .select('client_profile_id')
          .in('client_profile_id', currentProfileIds),
        withOrgScope(supabase, 'form_submissions', orgId)
          .select('client_profile_id')
          .in('client_profile_id', currentProfileIds),
        withOrgScope(supabase, 'waiting_list_entries', orgId)
          .select('client_profile_id, status')
          .in('client_profile_id', currentProfileIds),
      ]);

      const historyIds = new Set([
        ...(lessonParticipants || []).map((row) => row.client_profile_id).filter(Boolean),
        ...(formSubmissions || []).map((row) => row.client_profile_id).filter(Boolean),
      ]);
      const activeWaitingListIds = new Set(
        (waitingListEntries || [])
          .filter((row) => ['new', 'open'].includes(String(row?.status || '').toLowerCase()))
          .map((row) => row.client_profile_id)
          .filter(Boolean),
      );

      rows = rows.filter((row) => historyIds.has(row.id) && !activeWaitingListIds.has(row.id));
    }

    const totalRows = rows.length;
    const pagedRows = paginationRequested ? rows.slice(offset, offset + limit) : rows;

    const mergedRows = [];
    for (const row of pagedRows) {
      const { guardian } = await fetchPrimaryGuardianForClientProfile(supabase, row.id);
      mergedRows.push(mergeClientProfile(row, studentMap.get(row.id) || null, guardian || null));
    }

    if (!paginationRequested) {
      return respond(context, 200, mergedRows);
    }

    return respond(context, 200, {
      data: mergedRows,
      total: totalRows,
      page_size: limit,
      page: Math.floor(offset / limit) + 1,
      offset,
      has_more: offset + mergedRows.length < totalRows,
    });
  }

  if (!isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (method === 'POST') {
    const firstName = normalizeString(body?.first_name ?? body?.firstName);
    const middleName = normalizeString(body?.middle_name ?? body?.middleName) || null;
    const lastName = normalizeString(body?.last_name ?? body?.lastName);

    if (!firstName) {
      return respond(context, 400, { message: 'invalid_first_name' });
    }
    if (!lastName) {
      return respond(context, 400, { message: 'invalid_last_name' });
    }

    const identityNumberResult = coerceIdentityNumber(body?.identity_number ?? body?.identityNumber);
    if (!identityNumberResult.valid) {
      return respond(context, 400, { message: 'invalid_identity_number' });
    }

    const phoneResult = validateIsraeliPhone(body?.phone);
    if (!phoneResult.valid) {
      return respond(context, 400, { message: 'invalid_phone' });
    }

    const emailResult = coerceEmail(body?.email);
    if (!emailResult.valid) {
      return respond(context, 400, { message: 'invalid_email' });
    }

    const dateOfBirthResult = coerceOptionalDate(body?.date_of_birth ?? body?.dateOfBirth);
    if (!dateOfBirthResult.valid) {
      return respond(context, 400, { message: 'invalid_date_of_birth' });
    }

    const notificationMethodResult = coerceNotificationMethod(body?.default_notification_method ?? body?.defaultNotificationMethod);
    if (!notificationMethodResult.valid) {
      return respond(context, 400, { message: 'invalid_notification_method' });
    }

    let result;
    try {
      result = await createOrReuseClientProfile(supabase, {
        org_id: orgId,
        first_name: firstName,
        middle_name: middleName,
        last_name: lastName,
        identity_number: identityNumberResult.value,
        phone: phoneResult.value,
        email: emailResult.value,
        date_of_birth: dateOfBirthResult.value,
        default_notification_method: notificationMethodResult.value || 'whatsapp',
        onboarding_status: 'not_started',
        is_active: true,
        metadata: {
          source: 'one_time_customer_manual_create',
          created_from: normalizeString(body?.created_from ?? body?.createdFrom) || 'ui',
        },
      });
    } catch (createError) {
      context.log?.error?.('client-profiles failed to create profile', {
        message: createError?.message,
        orgId,
        userId,
      });
      return respond(context, 500, { message: 'failed_to_create_client_profile' });
    }

    const { data: profile, error: profileError } = await withOrgScope(supabase, 'client_profiles', orgId)
      .select('*')
      .eq('id', result.clientProfileId)
      .maybeSingle();

    if (profileError || !profile) {
      return respond(context, 500, { message: 'failed_to_load_client_profile' });
    }

    const { data: student } = await withOrgScope(supabase, 'students', orgId)
      .select('id')
      .eq('client_profile_id', result.clientProfileId)
      .maybeSingle();
    const { guardian } = await fetchPrimaryGuardianForClientProfile(supabase, result.clientProfileId);
    const merged = mergeClientProfile(profile, student?.id || null, guardian || null);

    try {
      await logTenantAuditEvent(supabase, {
        actorUserId: userId,
        eventType: result.action === 'created' ? 'client_profile.created' : 'client_profile.reused_for_one_time_customer',
        retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
        resourceType: 'client_profile',
        resourceId: result.clientProfileId,
        beforeState: result.beforeState,
        afterState: profile,
        details: {
          origin: 'api/client-profiles',
          action: result.action,
          created_from: normalizeString(body?.created_from ?? body?.createdFrom) || 'ui',
        },
      });
    } catch (auditError) {
      context.log?.warn?.('client-profiles failed to write create audit event', {
        message: auditError?.message,
        clientProfileId: result.clientProfileId,
      });
    }

    return respond(context, result.action === 'created' ? 201 : 200, {
      ...merged,
      action: result.action,
    });
  }

  if (!clientProfileId || !UUID_PATTERN.test(clientProfileId)) {
    return respond(context, 400, { message: 'invalid_client_profile_id' });
  }

  const normalized = buildUpdatePayload(body);
  if (normalized.error) {
    return respond(context, 400, { message: normalized.error });
  }

  const { data: beforeProfile, error: beforeError } = await withOrgScope(supabase, 'client_profiles', orgId)
    .select('*')
    .eq('id', clientProfileId)
    .maybeSingle();

  if (beforeError) return respond(context, 500, { message: 'failed_to_load_client_profile' });
  if (!beforeProfile) return respond(context, 404, { message: 'client_profile_not_found' });

  const { data: updated, error } = await withOrgScope(supabase, 'client_profiles', orgId)
    .update({
      ...normalized.updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', clientProfileId)
    .select('*')
    .maybeSingle();

  if (error) return respond(context, 500, { message: 'failed_to_update_client_profile' });
  if (!updated) return respond(context, 404, { message: 'client_profile_not_found' });

  const { data: student } = await withOrgScope(supabase, 'students', orgId).select('id').eq('client_profile_id', clientProfileId).maybeSingle();
  const { guardian } = await fetchPrimaryGuardianForClientProfile(supabase, clientProfileId);

  try {
    await logTenantAuditEvent(supabase, {
      actorUserId: userId,
      eventType: 'client_profile.updated',
      retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
      resourceType: 'client_profile',
      resourceId: clientProfileId,
      beforeState: beforeProfile,
      afterState: updated,
      details: {
        updated_fields: Object.keys(normalized.updates),
      },
    });
  } catch (auditError) {
    context.log?.warn?.('client-profiles failed to write tenant audit event', {
      message: auditError?.message,
      clientProfileId,
    });
  }

  return respond(context, 200, mergeClientProfile(updated, student?.id || null, guardian || null));
}
