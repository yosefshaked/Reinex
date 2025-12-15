/* eslint-env node */
import { Buffer } from 'node:buffer';
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
  UUID_PATTERN,
} from '../_shared/org-bff.js';
import { parseCsv } from '../_shared/csv.js';
import { coerceOptionalText, parseJsonBodyWithLimit } from '../_shared/validation.js';
import { buildSessionMetadata } from '../_shared/session-metadata.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function parsePermissions(raw) {
  if (!raw) {
    return {};
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function extractCsvText(body) {
  const csvText = normalizeString(body?.csv_text);
  if (csvText) {
    return csvText;
  }

  const base64Value = normalizeString(body?.file_base64);
  if (!base64Value) {
    return '';
  }

  let payload = base64Value;
  if (payload.startsWith('data:')) {
    const commaIndex = payload.indexOf(',');
    if (commaIndex !== -1) {
      payload = payload.slice(commaIndex + 1);
    }
  }

  try {
    return Buffer.from(payload, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function buildIsoDate(year, month, day) {
  const normalizedYear = Number(year);
  const normalizedMonth = Number(month);
  const normalizedDay = Number(day);

  if (
    !Number.isInteger(normalizedYear)
    || !Number.isInteger(normalizedMonth)
    || !Number.isInteger(normalizedDay)
  ) {
    return null;
  }

  if (normalizedMonth < 1 || normalizedMonth > 12 || normalizedDay < 1 || normalizedDay > 31) {
    return null;
  }

  const date = new Date(Date.UTC(normalizedYear, normalizedMonth - 1, normalizedDay));
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (
    date.getUTCFullYear() !== normalizedYear
    || date.getUTCMonth() + 1 !== normalizedMonth
    || date.getUTCDate() !== normalizedDay
  ) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function parseExcelSerial(value) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return null;
  }

  const excelEpoch = Date.UTC(1899, 11, 30);
  const millis = excelEpoch + numeric * 24 * 60 * 60 * 1000;
  const date = new Date(millis);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function normalizeDate(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }

  const excelSerialMatch = /^-?\d+(?:\.\d+)?$/.test(trimmed) ? parseExcelSerial(trimmed) : null;
  if (excelSerialMatch) {
    return excelSerialMatch;
  }

  const isoLikeMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s|T|$)/);
  if (isoLikeMatch) {
    return buildIsoDate(isoLikeMatch[1], isoLikeMatch[2], isoLikeMatch[3]);
  }

  const dmyMatch = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s|$)/);
  if (dmyMatch) {
    const year = dmyMatch[3].length === 2 ? `20${dmyMatch[3]}` : dmyMatch[3];
    return buildIsoDate(year, dmyMatch[2], dmyMatch[1]);
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

function parseColumnMappings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [normalizeString(key), normalizeString(value)]),
  );
}

function normalizeServiceStrategy(raw) {
  const normalized = normalizeString(raw);
  if (!normalized) {
    return '';
  }

  if (normalized === 'fixed' || normalized === 'single' || normalized === 'global') {
    return 'fixed';
  }

  if (normalized === 'column' || normalized === 'per_row' || normalized === 'csv_column') {
    return 'column';
  }

  return '';
}

function coerceServiceValue(value) {
  if (value === null || value === undefined) {
    return { value: null, valid: true };
  }

  if (typeof value === 'string') {
    return { value: value.trim() || null, valid: true };
  }

  try {
    const stringified = String(value);
    return { value: stringified.trim() || null, valid: true };
  } catch {
    return { value: null, valid: false };
  }
}

export default async function legacyImport(context, req) {
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('legacy-import missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('legacy-import missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('legacy-import failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const body = parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'legacy-import' }) || {};
  const orgId = resolveOrgId(req, body);
  const studentId = normalizeString(req.params?.id || body?.student_id);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  if (!studentId || !UUID_PATTERN.test(studentId)) {
    return respond(context, 400, { message: 'invalid student id' });
  }

  let role;
  const userId = authResult.data.user.id;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('legacy-import failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role || !isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const { data: orgSettings, error: settingsError } = await supabase
    .from('org_settings')
    .select('permissions')
    .eq('org_id', orgId)
    .maybeSingle();

  if (settingsError) {
    context.log?.error?.('legacy-import failed to load org settings', { message: settingsError.message });
    return respond(context, 500, { message: 'failed_to_load_settings' });
  }

  const permissions = parsePermissions(orgSettings?.permissions);
  const canReupload = permissions.can_reupload_legacy_reports === true;

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  const { data: studentRecord, error: studentError } = await tenantClient
    .from('Students')
    .select('id, assigned_instructor_id')
    .eq('id', studentId)
    .maybeSingle();

  if (studentError) {
    context.log?.error?.('legacy-import failed to load student', { message: studentError.message });
    return respond(context, 500, { message: 'failed_to_load_student' });
  }

  if (!studentRecord) {
    return respond(context, 404, { message: 'student_not_found' });
  }

  const assignedInstructorId = normalizeString(studentRecord.assigned_instructor_id);
  if (!assignedInstructorId) {
    return respond(context, 400, { message: 'student_missing_instructor' });
  }

  const { count: legacyCount, error: legacyCheckError } = await tenantClient
    .from('SessionRecords')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .eq('is_legacy', true);

  if (legacyCheckError) {
    context.log?.error?.('legacy-import failed to check existing legacy records', { message: legacyCheckError.message });
    return respond(context, 500, { message: 'failed_to_check_legacy_records' });
  }

  if (!canReupload && legacyCount && legacyCount > 0) {
    return respond(context, 409, { message: 'legacy_import_already_exists' });
  }

  const structureChoice = normalizeString(body?.structure_choice);
  const isMatchFlow = structureChoice === 'match' || structureChoice === 'yes' || structureChoice === 'structured';
  const isCustomFlow = structureChoice === 'custom' || structureChoice === 'no' || structureChoice === 'unstructured';

  if (!isMatchFlow && !isCustomFlow) {
    return respond(context, 400, { message: 'invalid_structure_choice' });
  }

  const sessionDateColumn = normalizeString(body?.session_date_column);
  if (!sessionDateColumn) {
    return respond(context, 400, { message: 'missing_session_date_column' });
  }

  const serviceStrategy = normalizeServiceStrategy(
    body?.service_strategy
      || body?.service_mode
      || body?.service_mapping,
  );

  if (!serviceStrategy) {
    return respond(context, 400, { message: 'invalid_service_strategy' });
  }

  let serviceContextValue = null;
  let serviceContextColumn = '';

  if (serviceStrategy === 'fixed') {
    const serviceResult = coerceOptionalText(
      body?.service_context_value
        || body?.service_value
        || body?.service_context
        || body?.service,
    );

    if (!serviceResult.valid) {
      return respond(context, 400, { message: 'invalid_service_context' });
    }

    serviceContextValue = serviceResult.value;
  }

  if (serviceStrategy === 'column') {
    serviceContextColumn = normalizeString(body?.service_context_column || body?.service_column);

    if (!serviceContextColumn) {
      return respond(context, 400, { message: 'missing_service_column' });
    }
  }

  const csvText = extractCsvText(body);
  if (!csvText) {
    return respond(context, 400, { message: 'missing_csv' });
  }

  const parsedCsv = parseCsv(csvText);
  if (!parsedCsv.columns.length || !parsedCsv.rows.length) {
    return respond(context, 400, { message: 'empty_csv' });
  }

  if (!parsedCsv.columns.includes(sessionDateColumn)) {
    return respond(context, 400, { message: 'session_date_column_not_found' });
  }

  if (serviceStrategy === 'column' && !parsedCsv.columns.includes(serviceContextColumn)) {
    return respond(context, 400, { message: 'service_column_not_found' });
  }

  const columnMappings = isMatchFlow ? parseColumnMappings(body?.column_mappings) : {};
  const customLabels = isCustomFlow ? parseColumnMappings(body?.custom_labels) : {};

  const metadataResult = await buildSessionMetadata({
    tenantClient,
    userId,
    role,
    source: 'legacy_import',
    logger: context.log,
  });

  let metadata = metadataResult.metadata;

  if (!isMatchFlow && metadata && Object.prototype.hasOwnProperty.call(metadata, 'form_version')) {
    const { form_version: _formVersion, ...rest } = metadata;
    metadata = Object.keys(rest).length ? rest : null;
  }

  const records = [];
  for (let index = 0; index < parsedCsv.rows.length; index += 1) {
    const row = parsedCsv.rows[index];
    const dateValue = row[sessionDateColumn];
    const normalizedDate = normalizeDate(dateValue);

    if (!normalizedDate) {
      return respond(context, 400, { message: 'invalid_session_date', row: index + 1 });
    }

    const content = {};
    let serviceContext = serviceContextValue;

    if (isMatchFlow) {
      Object.entries(columnMappings).forEach(([column, target]) => {
        if (!target || column === sessionDateColumn) {
          return;
        }
        const value = row[column];
        if (value === undefined || value === null) {
          return;
        }
        const normalizedValue = normalizeString(value);
        if (!normalizedValue) {
          return;
        }
        content[target] = normalizedValue;
      });
    }

    if (isCustomFlow) {
      Object.entries(customLabels).forEach(([column, label]) => {
        if (!label || column === sessionDateColumn) {
          return;
        }
        const value = row[column];
        if (value === undefined || value === null) {
          return;
        }
        const normalizedValue = normalizeString(value);
        if (!normalizedValue) {
          return;
        }
        content[label] = normalizedValue;
      });
    }

    if (serviceStrategy === 'column') {
      const rowServiceResult = coerceServiceValue(row[serviceContextColumn]);
      if (!rowServiceResult.valid) {
        return respond(context, 400, { message: 'invalid_service_context', row: index + 1 });
      }
      serviceContext = rowServiceResult.value;
    }

    records.push({
      student_id: studentId,
      instructor_id: assignedInstructorId,
      date: normalizedDate,
      content: Object.keys(content).length ? content : null,
      is_legacy: true,
      service_context: serviceContext,
      metadata,
    });
  }

  if (!records.length) {
    return respond(context, 400, { message: 'no_rows_to_import' });
  }

  const replaced = legacyCount || 0;

  const { error: deleteError } = await tenantClient
    .from('SessionRecords')
    .delete()
    .eq('student_id', studentId)
    .eq('is_legacy', true);

  if (deleteError) {
    context.log?.error?.('legacy-import failed to delete existing legacy rows', { message: deleteError.message });
    return respond(context, 500, { message: 'failed_to_clear_legacy_records' });
  }

  const { error: insertError } = await tenantClient.from('SessionRecords').insert(records);

  if (insertError) {
    context.log?.error?.('legacy-import failed to insert legacy rows', { message: insertError.message });
    return respond(context, 500, { message: 'failed_to_insert_legacy_records' });
  }

  return respond(context, 201, { imported: records.length, replaced, can_reupload: canReupload });
}
