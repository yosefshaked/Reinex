/* eslint-env node */
import { resolveAuthorizationHeader } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';
import { isValidOrgId, readEnv, respond, resolveTenantClient } from '../_shared/org-bff.js';

const SETTINGS_MAPPING_KEY = 'intake_field_mapping';
const SETTINGS_SECRET_KEY = 'external_intake_secret';
const SETTINGS_TAGS_KEY = 'student_tags';

function normalizeString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return String(value).trim();
}

function normalizePhone(value) {
  const raw = normalizeString(value);
  if (!raw) {
    return '';
  }

  let cleaned = raw.replace(/[\s-]/g, '');
  if (cleaned.startsWith('5')) {
    cleaned = `0${cleaned}`;
  }
  return cleaned;
}

const QA_PAIR_REGEX = /<div class="qa-pair">.*?<p class="question">(.*?)<\/p>.*?<p class="answer">(.*?)<\/p>.*?<\/div>/gs;

function decodeHtmlEntities(value) {
  const raw = normalizeString(value);
  if (!raw) {
    return '';
  }

  return raw
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractQaPairs(htmlContent) {
  const payload = {};
  if (!htmlContent) {
    return payload;
  }

  for (const match of htmlContent.matchAll(QA_PAIR_REGEX)) {
    const question = decodeHtmlEntities(match?.[1]);
    const answer = decodeHtmlEntities(match?.[2]);
    if (!question || !answer) {
      continue;
    }
    payload[question] = answer;
  }

  return payload;
}


function isSchemaError(error) {
  if (!error) {
    return false;
  }
  const code = error.code || error.details;
  if (code === '42703' || code === '42P01') {
    return true;
  }
  const message = String(error.message || error.details || '').toLowerCase();
  return message.includes('column') || message.includes('relation');
}

function buildSchemaResponse(error) {
  return {
    status: 424,
    body: {
      message: 'schema_upgrade_required',
      details: error?.message || 'missing_intake_columns',
      hint: 'Run the latest setup SQL to add intake_responses and needs_intake_approval.',
    },
  };
}

async function loadSettingValue(tenantClient, key) {
  const { data, error } = await tenantClient
    .from('Settings')
    .select('settings_value')
    .eq('key', key)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data?.settings_value ?? null;
}

function buildIntakeResponses(existing, incoming) {
  const history = Array.isArray(existing?.history) ? [...existing.history] : [];
  const current = existing?.current ?? null;
  if (current !== null && current !== undefined) {
    history.push(current);
  }
  return {
    current: incoming,
    history,
  };
}

function resolveMappedValue(mapping, body, key) {
  if (!mapping || typeof mapping !== 'object') {
    return null;
  }
  const sourceKey = normalizeString(mapping[key]);
  if (!sourceKey) {
    return null;
  }
  if (!body || typeof body !== 'object') {
    return null;
  }
  return body[sourceKey];
}

function normalizeTagEntries(candidate) {
  if (!Array.isArray(candidate)) {
    return [];
  }
  const normalized = [];
  const seen = new Set();

  for (const entry of candidate) {
    if (!entry) {
      continue;
    }

    if (typeof entry === 'object') {
      const id = normalizeString(entry.id);
      const name = normalizeString(entry.name);
      if (id && name && !seen.has(id)) {
        seen.add(id);
        normalized.push({ id, name });
      }
      continue;
    }

    if (typeof entry === 'string') {
      const value = normalizeString(entry);
      if (value && !seen.has(value)) {
        seen.add(value);
        normalized.push({ id: value, name: value });
      }
    }
  }

  return normalized;
}

function findTagId(tags, name) {
  if (!name) {
    return null;
  }
  const normalizedName = name.toLowerCase();
  const match = tags.find((tag) => tag.name.toLowerCase() === normalizedName);
  return match?.id || null;
}

export default async function handler(context, req) {
  const method = String(req.method || 'POST').toUpperCase();
  if (method !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'POST' });
  }

  const orgIdHeader = normalizeString(resolveAuthorizationHeader(req, ['x-org-id']));
  const providedSecret = normalizeString(resolveAuthorizationHeader(req, ['x-intake-secret']));

  if (!orgIdHeader || !isValidOrgId(orgIdHeader) || !providedSecret) {
    return respond(context, 401, { message: 'invalid_credentials' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('intake missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);
  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgIdHeader);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  let storedSecret;
  let intakeMapping;
  try {
    [storedSecret, intakeMapping] = await Promise.all([
      loadSettingValue(tenantClient, SETTINGS_SECRET_KEY),
      loadSettingValue(tenantClient, SETTINGS_MAPPING_KEY),
    ]);
  } catch (error) {
    context.log?.error?.('intake failed to load settings', { message: error?.message });
    return respond(context, 500, { message: 'failed_to_load_settings' });
  }

  if (normalizeString(storedSecret) !== providedSecret) {
    return respond(context, 401, { message: 'invalid_credentials' });
  }

  if (!intakeMapping || typeof intakeMapping !== 'object' || Array.isArray(intakeMapping)) {
    return respond(context, 400, { message: 'missing_intake_mapping' });
  }

  const body = parseJsonBodyWithLimit(req, 64 * 1024, { mode: 'observe', context, endpoint: 'intake' });
  if (!body || typeof body !== 'object') {
    return respond(context, 400, { message: 'invalid_payload' });
  }

  const htmlContent = normalizeString(body?.html_content);
  if (!htmlContent) {
    return respond(context, 400, { message: 'missing_html_content' });
  }

  const responses = extractQaPairs(htmlContent);
  const studentNameRaw = resolveMappedValue(intakeMapping, responses, 'student_name');
  const firstNameRaw = resolveMappedValue(intakeMapping, responses, 'first_name') || responses['שם פרטי'];
  const lastNameRaw = resolveMappedValue(intakeMapping, responses, 'last_name') || responses['שם משפחה'];
  const nationalIdRaw = resolveMappedValue(intakeMapping, responses, 'national_id');
  const phoneRaw = resolveMappedValue(intakeMapping, responses, 'phone');
  const parentNameRaw = resolveMappedValue(intakeMapping, responses, 'parent_name');
  const parentPhoneRaw = resolveMappedValue(intakeMapping, responses, 'parent_phone');
  const healthProviderRaw = resolveMappedValue(intakeMapping, responses, 'health_provider_tag');

  const firstName = normalizeString(firstNameRaw);
  const lastName = normalizeString(lastNameRaw);
  const combinedName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const studentName = combinedName || normalizeString(studentNameRaw);
  const nationalId = normalizeString(nationalIdRaw);
  const studentPhone = normalizePhone(phoneRaw) || null;
  const contactName = normalizeString(parentNameRaw) || null;
  const contactPhone = normalizePhone(parentPhoneRaw) || null;
  const healthProviderTag = normalizeString(healthProviderRaw);

  if (!nationalId) {
    return respond(context, 400, { message: 'missing_national_id' });
  }

  const { data: existingStudent, error: lookupError } = await tenantClient
    .from('Students')
    .select('id, name, tags, intake_responses')
    .eq('national_id', nationalId)
    .maybeSingle();

  if (lookupError) {
    if (isSchemaError(lookupError)) {
      const schemaResponse = buildSchemaResponse(lookupError);
      return respond(context, schemaResponse.status, schemaResponse.body);
    }
    context.log?.error?.('intake failed to lookup student', { message: lookupError.message });
    return respond(context, 500, { message: 'failed_to_lookup_student' });
  }

  const incomingPayload = {
    ...responses,
    intake_html_source: htmlContent,
  };

  if (!existingStudent) {
    if (!studentName) {
      return respond(context, 400, { message: 'missing_student_name' });
    }

    let tagId = null;
    if (healthProviderTag) {
      try {
        const tagsValue = await loadSettingValue(tenantClient, SETTINGS_TAGS_KEY);
        const tags = normalizeTagEntries(tagsValue);
        tagId = findTagId(tags, healthProviderTag);
      } catch (error) {
        context.log?.warn?.('intake failed to load student tags', { message: error?.message });
        tagId = null;
      }
    }

    const intakeResponses = buildIntakeResponses(null, incomingPayload);
    const recordToInsert = {
      name: studentName,
      national_id: nationalId,
      contact_info: studentPhone,
      contact_name: contactName,
      contact_phone: contactPhone,
      intake_responses: intakeResponses,
      needs_intake_approval: true,
      is_active: true,
      tags: tagId ? [tagId] : null,
    };

    const { data, error } = await tenantClient
      .from('Students')
      .insert([recordToInsert])
      .select()
      .single();

    if (error) {
      if (isSchemaError(error)) {
        const schemaResponse = buildSchemaResponse(error);
        return respond(context, schemaResponse.status, schemaResponse.body);
      }
      context.log?.error?.('intake failed to insert student', { message: error.message });
      return respond(context, 500, { message: 'failed_to_create_student' });
    }

    return respond(context, 201, { status: 'created', student: data });
  }

  const intakeResponses = buildIntakeResponses(existingStudent.intake_responses, incomingPayload);
  const { data, error } = await tenantClient
    .from('Students')
    .update({
      intake_responses: intakeResponses,
      needs_intake_approval: true,
    })
    .eq('id', existingStudent.id)
    .select()
    .maybeSingle();

  if (error) {
    if (isSchemaError(error)) {
      const schemaResponse = buildSchemaResponse(error);
      return respond(context, schemaResponse.status, schemaResponse.body);
    }
    context.log?.error?.('intake failed to update student', { message: error.message });
    return respond(context, 500, { message: 'failed_to_update_student' });
  }

  return respond(context, 200, { status: 'updated', student: data });
}
