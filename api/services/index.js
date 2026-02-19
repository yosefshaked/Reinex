/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  UUID_PATTERN,
  ensureMembership,
  isAdminRole,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';

function normalizeServiceName(value) {
  const name = normalizeString(value);
  return name || '';
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === '') {
    return { value: null, valid: true };
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return { value: null, valid: false };
  }
  return { value: numberValue, valid: numberValue > 0 };
}

function normalizeOptionalText(value) {
  if (value === null || value === undefined || value === '') {
    return { value: null, valid: true };
  }
  if (typeof value !== 'string') {
    return { value: null, valid: false };
  }
  const trimmed = value.trim();
  return { value: trimmed || null, valid: true };
}

function normalizeOptionalJson(value) {
  if (value === null || value === undefined) {
    return { value: null, valid: true };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { value: null, valid: false };
  }
  return { value, valid: true };
}

function normalizeOptionalBoolean(value) {
  if (value === null || value === undefined || value === '') {
    return { value: null, valid: true };
  }
  if (typeof value === 'boolean') {
    return { value, valid: true };
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return { value: true, valid: true };
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return { value: false, valid: true };
    }
  }
  if (typeof value === 'number') {
    return { value: value === 1, valid: true };
  }
  return { value: null, valid: false };
}

export default async function services(context, req) {
  const method = String(req.method || 'GET').toUpperCase();

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('services missing Supabase admin credentials');
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
    context.log?.error?.('services failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, authResult.data.user.id);
  } catch (membershipError) {
    context.log?.error?.('services failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId: authResult.data.user.id,
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
    const { data, error } = await tenantClient
      .from('Services')
      .select('id, name, duration_minutes, payment_model, color, is_active, metadata')
      .order('name', { ascending: true });

    if (error) {
      context.log?.error?.('services failed to load catalog', { message: error.message });
      return respond(context, 500, { message: 'failed_to_load_services' });
    }

    return respond(context, 200, Array.isArray(data) ? data : []);
  }

  if (!isAdmin) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (method === 'POST') {
    const name = normalizeServiceName(body?.name);
    if (!name) {
      return respond(context, 400, { message: 'missing_service_name' });
    }

    const durationResult = normalizeOptionalNumber(body?.duration_minutes ?? body?.durationMinutes);
    if (!durationResult.valid) {
      return respond(context, 400, { message: 'invalid_duration_minutes' });
    }

    const paymentModelResult = normalizeOptionalText(body?.payment_model ?? body?.paymentModel);
    if (!paymentModelResult.valid) {
      return respond(context, 400, { message: 'invalid_payment_model' });
    }

    const colorResult = normalizeOptionalText(body?.color);
    if (!colorResult.valid) {
      return respond(context, 400, { message: 'invalid_color' });
    }

    const isActiveResult = normalizeOptionalBoolean(body?.is_active ?? body?.isActive);
    if (!isActiveResult.valid) {
      return respond(context, 400, { message: 'invalid_is_active' });
    }

    const metadataResult = normalizeOptionalJson(body?.metadata);
    if (!metadataResult.valid) {
      return respond(context, 400, { message: 'invalid_metadata' });
    }

    const { data, error } = await tenantClient
      .from('Services')
      .insert({
        name,
        duration_minutes: durationResult.value,
        payment_model: paymentModelResult.value,
        color: colorResult.value,
        is_active: isActiveResult.value === null ? true : isActiveResult.value,
        metadata: metadataResult.value,
      })
      .select('id, name, duration_minutes, payment_model, color, is_active, metadata')
      .single();

    if (error) {
      context.log?.error?.('services failed to create service', { message: error.message });
      return respond(context, 500, { message: 'failed_to_create_service' });
    }

    return respond(context, 201, data);
  }

  if (method === 'PUT') {
    const serviceId = normalizeString(context?.bindingData?.serviceId || body?.id);
    if (!serviceId || !UUID_PATTERN.test(serviceId)) {
      return respond(context, 400, { message: 'invalid_service_id' });
    }

    const updates = {};

    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      const name = normalizeServiceName(body?.name);
      if (!name) {
        return respond(context, 400, { message: 'missing_service_name' });
      }
      updates.name = name;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'duration_minutes') || Object.prototype.hasOwnProperty.call(body, 'durationMinutes')) {
      const durationResult = normalizeOptionalNumber(body?.duration_minutes ?? body?.durationMinutes);
      if (!durationResult.valid) {
        return respond(context, 400, { message: 'invalid_duration_minutes' });
      }
      updates.duration_minutes = durationResult.value;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'payment_model') || Object.prototype.hasOwnProperty.call(body, 'paymentModel')) {
      const paymentModelResult = normalizeOptionalText(body?.payment_model ?? body?.paymentModel);
      if (!paymentModelResult.valid) {
        return respond(context, 400, { message: 'invalid_payment_model' });
      }
      updates.payment_model = paymentModelResult.value;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'color')) {
      const colorResult = normalizeOptionalText(body?.color);
      if (!colorResult.valid) {
        return respond(context, 400, { message: 'invalid_color' });
      }
      updates.color = colorResult.value;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'metadata')) {
      const metadataResult = normalizeOptionalJson(body?.metadata);
      if (!metadataResult.valid) {
        return respond(context, 400, { message: 'invalid_metadata' });
      }
      updates.metadata = metadataResult.value;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'is_active') || Object.prototype.hasOwnProperty.call(body, 'isActive')) {
      const isActiveResult = normalizeOptionalBoolean(body?.is_active ?? body?.isActive);
      if (!isActiveResult.valid || isActiveResult.value === null) {
        return respond(context, 400, { message: 'invalid_is_active' });
      }
      updates.is_active = isActiveResult.value;
    }

    if (Object.keys(updates).length === 0) {
      return respond(context, 400, { message: 'missing_updates' });
    }

    const { data, error } = await tenantClient
      .from('Services')
      .update(updates)
      .eq('id', serviceId)
      .select('id, name, duration_minutes, payment_model, color, is_active, metadata')
      .maybeSingle();

    if (error) {
      context.log?.error?.('services failed to update service', { message: error.message, serviceId });
      return respond(context, 500, { message: 'failed_to_update_service' });
    }

    if (!data) {
      return respond(context, 404, { message: 'service_not_found' });
    }

    return respond(context, 200, data);
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
