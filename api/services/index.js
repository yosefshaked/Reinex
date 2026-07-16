/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { attachErrorTracking, respondTracked } from '../_shared/error-events.js';
import { ensureOrgPermissions } from '../_shared/permissions-utils.js';
import {
  UUID_PATTERN,
  ensureMembership,
  isAdminRole,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  withOrgScope,
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
  return { value: numberValue, valid: numberValue >= 0 };
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

const PAYMENT_MODELS = new Set(['fixed_rate', 'per_student']);
const REQUIRED_FORM_ENFORCEMENT_VALUES = new Set(['warn', 'block']);

function respondServicesError(context, status, message, error, metadata = {}) {
  return respondTracked(context, status, { message }, undefined, { error, metadata });
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function capReportPreanswers(metadata, cap) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata;
  if (!Object.prototype.hasOwnProperty.call(metadata, 'report_preanswers')) return metadata;

  const bank = metadata.report_preanswers && typeof metadata.report_preanswers === 'object' && !Array.isArray(metadata.report_preanswers)
    ? metadata.report_preanswers
    : {};
  const normalizedBank = {};
  for (const [fieldKey, entries] of Object.entries(bank)) {
    if (!normalizeString(fieldKey) || !Array.isArray(entries)) continue;
    const normalizedEntries = Array.from(new Set(
      entries
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean),
    )).slice(0, cap);
    if (normalizedEntries.length) normalizedBank[fieldKey] = normalizedEntries;
  }

  return { ...metadata, report_preanswers: normalizedBank };
}

async function loadAssignableReportForm(supabase, orgId, formId) {
  if (!formId) return { form: null, error: null };
  const { data, error } = await withOrgScope(supabase, 'forms', orgId)
    .select('id, form_usage, is_active, archived_at, metadata')
    .eq('id', formId)
    .maybeSingle();
  return { form: data || null, error };
}

function normalizeRequiredForms(value) {
  if (value === null || value === undefined) {
    return { value: null, valid: true };
  }
  if (!Array.isArray(value)) {
    return { value: null, valid: false };
  }
  const normalized = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { value: null, valid: false };
    }
    const formId = String(entry.form_id || '').trim();
    if (!UUID_PATTERN.test(formId)) {
      return { value: null, valid: false };
    }
    const label = String(entry.label || '').trim();
    if (!label) {
      return { value: null, valid: false };
    }
    const enforcement = String(entry.enforcement || 'warn').trim().toLowerCase();
    if (!REQUIRED_FORM_ENFORCEMENT_VALUES.has(enforcement)) {
      return { value: null, valid: false };
    }
    const allowResubmit = entry.allow_resubmit !== false;
    normalized.push({ form_id: formId, label, enforcement, allow_resubmit: allowResubmit });
  }
  return { value: normalized, valid: true };
}

function normalizePaymentModel(value) {
  if (value === null || value === undefined || value === '') {
    return { value: null, valid: true };
  }
  if (typeof value !== 'string') {
    return { value: null, valid: false };
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return { value: null, valid: true };
  }

  if (!PAYMENT_MODELS.has(normalized)) {
    return { value: null, valid: false };
  }

  return { value: normalized, valid: true };
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

function normalizeOptionalUuid(value) {
  if (value === null || value === undefined || value === '') {
    return { value: null, valid: true };
  }
  if (typeof value !== 'string') {
    return { value: null, valid: false };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { value: null, valid: true };
  }
  if (!UUID_PATTERN.test(trimmed)) {
    return { value: null, valid: false };
  }
  return { value: trimmed, valid: true };
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
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('services failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
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

  attachErrorTracking(context, req, supabase, {
    orgId,
    userId: authResult.data.user.id,
    metadata: { endpoint: 'services' },
  });

  const isAdmin = isAdminRole(role);

  if (method === 'GET') {
    const { data, error } = await withOrgScope(supabase, 'Services', orgId)
      .select('id, name, duration_minutes, payment_model, default_customer_charge_amount, color, is_active, metadata, required_forms, report_form_id')
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

  let preanswersCap = 50;
  if (method === 'POST' || method === 'PUT') {
    try {
      const permissions = await ensureOrgPermissions(supabase, orgId);
      preanswersCap = normalizePositiveInt(permissions?.session_form_preanswers_cap, 50);
    } catch (permissionsError) {
      context.log?.error?.('services failed to load permissions for report preanswers', { message: permissionsError?.message });
      return respondServicesError(context, 500, 'failed_to_verify_membership', permissionsError, {
        action: 'resolve_report_preanswers_cap',
      });
    }
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

    const paymentModelResult = normalizePaymentModel(body?.payment_model ?? body?.paymentModel);
    if (!paymentModelResult.valid) {
      return respond(context, 400, { message: 'invalid_payment_model' });
    }

    const colorResult = normalizeOptionalText(body?.color);
    if (!colorResult.valid) {
      return respond(context, 400, { message: 'invalid_color' });
    }

    const defaultCustomerChargeAmountResult = normalizeOptionalNumber(
      body?.default_customer_charge_amount ?? body?.defaultCustomerChargeAmount
    );
    if (!defaultCustomerChargeAmountResult.valid) {
      return respond(context, 400, { message: 'invalid_default_customer_charge_amount' });
    }

    const isActiveResult = normalizeOptionalBoolean(body?.is_active ?? body?.isActive);
    if (!isActiveResult.valid) {
      return respond(context, 400, { message: 'invalid_is_active' });
    }

    const metadataResult = normalizeOptionalJson(body?.metadata);
    if (!metadataResult.valid) {
      return respond(context, 400, { message: 'invalid_metadata' });
    }

    const requiredFormsResult = normalizeRequiredForms(body?.required_forms ?? body?.requiredForms ?? []);
    if (!requiredFormsResult.valid) {
      return respond(context, 400, { message: 'invalid_required_forms' });
    }

    const reportFormIdResult = normalizeOptionalUuid(body?.report_form_id ?? body?.reportFormId);
    if (!reportFormIdResult.valid) {
      return respond(context, 400, { message: 'invalid_report_form_id' });
    }

    if (reportFormIdResult.value) {
      const { form: reportForm, error: reportFormError } = await loadAssignableReportForm(supabase, orgId, reportFormIdResult.value);
      if (reportFormError) {
        return respondServicesError(context, 500, 'failed_to_load_form', reportFormError, {
          action: 'validate_report_form_assignment',
          form_id: reportFormIdResult.value,
        });
      }
      if (!reportForm) return respond(context, 400, { message: 'invalid_report_form_id' });
      if (normalizeString(reportForm.form_usage) !== 'session_report') {
        return respond(context, 409, { message: 'form_not_session_report' });
      }
      if (reportForm.is_active === false || reportForm.archived_at || !reportForm.metadata?.published_form_schema) {
        return respond(context, 409, { message: 'report_form_not_published' });
      }
    }

    const { data, error } = await withOrgScope(supabase, 'Services', orgId)
      .insert({
        name,
        duration_minutes: durationResult.value,
        payment_model: paymentModelResult.value,
        default_customer_charge_amount: defaultCustomerChargeAmountResult.value,
        color: colorResult.value,
        is_active: isActiveResult.value === null ? true : isActiveResult.value,
        metadata: capReportPreanswers(metadataResult.value, preanswersCap),
        required_forms: requiredFormsResult.value ?? [],
        report_form_id: reportFormIdResult.value,
      })
      .select('id, name, duration_minutes, payment_model, default_customer_charge_amount, color, is_active, metadata, required_forms, report_form_id')
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
      updates['name'] = name;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'duration_minutes') || Object.prototype.hasOwnProperty.call(body, 'durationMinutes')) {
      const durationResult = normalizeOptionalNumber(body?.duration_minutes ?? body?.durationMinutes);
      if (!durationResult.valid) {
        return respond(context, 400, { message: 'invalid_duration_minutes' });
      }
      updates.duration_minutes = durationResult.value;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'payment_model') || Object.prototype.hasOwnProperty.call(body, 'paymentModel')) {
      const paymentModelResult = normalizePaymentModel(body?.payment_model ?? body?.paymentModel);
      if (!paymentModelResult.valid) {
        return respond(context, 400, { message: 'invalid_payment_model' });
      }
      updates.payment_model = paymentModelResult.value;
    }

    if (
      Object.prototype.hasOwnProperty.call(body, 'default_customer_charge_amount')
      || Object.prototype.hasOwnProperty.call(body, 'defaultCustomerChargeAmount')
    ) {
      const defaultCustomerChargeAmountResult = normalizeOptionalNumber(
        Object.prototype.hasOwnProperty.call(body, 'default_customer_charge_amount')
          ? body.default_customer_charge_amount
          : body.defaultCustomerChargeAmount
      );
      if (!defaultCustomerChargeAmountResult.valid) {
        return respond(context, 400, { message: 'invalid_default_customer_charge_amount' });
      }
      updates.default_customer_charge_amount = defaultCustomerChargeAmountResult.value;
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
      updates.metadata = capReportPreanswers(metadataResult.value, preanswersCap);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'is_active') || Object.prototype.hasOwnProperty.call(body, 'isActive')) {
      const isActiveResult = normalizeOptionalBoolean(body?.is_active ?? body?.isActive);
      if (!isActiveResult.valid || isActiveResult.value === null) {
        return respond(context, 400, { message: 'invalid_is_active' });
      }
      updates.is_active = isActiveResult.value;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'required_forms') || Object.prototype.hasOwnProperty.call(body, 'requiredForms')) {
      const requiredFormsResult = normalizeRequiredForms(body?.required_forms ?? body?.requiredForms);
      if (!requiredFormsResult.valid) {
        return respond(context, 400, { message: 'invalid_required_forms' });
      }
      updates.required_forms = requiredFormsResult.value ?? [];
    }

    if (Object.prototype.hasOwnProperty.call(body, 'report_form_id') || Object.prototype.hasOwnProperty.call(body, 'reportFormId')) {
      const reportFormIdResult = normalizeOptionalUuid(body?.report_form_id ?? body?.reportFormId);
      if (!reportFormIdResult.valid) {
        return respond(context, 400, { message: 'invalid_report_form_id' });
      }
      if (reportFormIdResult.value) {
        const { form: reportForm, error: reportFormError } = await loadAssignableReportForm(supabase, orgId, reportFormIdResult.value);
        if (reportFormError) {
          return respondServicesError(context, 500, 'failed_to_load_form', reportFormError, {
            action: 'validate_report_form_assignment',
            form_id: reportFormIdResult.value,
          });
        }
        if (!reportForm) return respond(context, 400, { message: 'invalid_report_form_id' });
        if (normalizeString(reportForm.form_usage) !== 'session_report') {
          return respond(context, 409, { message: 'form_not_session_report' });
        }
        if (reportForm.is_active === false || reportForm.archived_at || !reportForm.metadata?.published_form_schema) {
          return respond(context, 409, { message: 'report_form_not_published' });
        }
      }
      updates.report_form_id = reportFormIdResult.value;
    }

    if (Object.keys(updates).length === 0) {
      return respond(context, 400, { message: 'missing_updates' });
    }

    const { data, error } = await withOrgScope(supabase, 'Services', orgId)
      .update(updates)
      .eq('id', serviceId)
      .select('id, name, duration_minutes, payment_model, default_customer_charge_amount, color, is_active, metadata, required_forms, report_form_id')
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
