import { normalizeString } from './org-bff.js';

export function extractSessionFormVersion(settingsValue) {
  if (settingsValue === null || settingsValue === undefined) {
    return null;
  }

  let payload = settingsValue;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) {
      return null;
    }
    try {
      payload = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  if (Array.isArray(payload)) {
    return null;
  }

  if (payload && typeof payload === 'object') {
    let candidate = null;

    if (
      payload.current
      && typeof payload.current === 'object'
      && Object.prototype.hasOwnProperty.call(payload.current, 'version')
    ) {
      candidate = payload.current.version;
    }

    if (candidate === null && Object.prototype.hasOwnProperty.call(payload, 'version')) {
      candidate = payload.version;
    }

    if (candidate !== null && candidate !== undefined) {
      const normalizedCandidate = typeof candidate === 'number'
        ? candidate
        : Number.parseInt(String(candidate).trim(), 10);

      if (Number.isInteger(normalizedCandidate) && normalizedCandidate >= 0) {
        return normalizedCandidate;
      }
    }
  }

  return null;
}

export async function resolveSessionFormVersion(tenantClient) {
  const result = await tenantClient
    .from('Settings')
    .select('settings_value')
    .eq('key', 'session_form_config')
    .maybeSingle();

  if (result.error) {
    return { version: null, error: result.error };
  }

  return { version: extractSessionFormVersion(result.data?.settings_value) ?? null, error: null };
}

export async function buildSessionMetadata({ tenantClient, userId, role, source, logger }) {
  let formVersion = null;
  let versionError = null;

  if (tenantClient) {
    const versionResult = await resolveSessionFormVersion(tenantClient);
    formVersion = versionResult.version ?? null;
    versionError = versionResult.error;
  }

  const metadataPayload = {};
  if (formVersion !== null && formVersion !== undefined) {
    metadataPayload.form_version = formVersion;
  }

  const normalizedUserId = normalizeString(userId);
  if (normalizedUserId) {
    metadataPayload.created_by = normalizedUserId;
  }

  const normalizedRole = normalizeString(role);
  if (normalizedRole) {
    metadataPayload.created_role = normalizedRole.toLowerCase();
  }

  if (source) {
    metadataPayload.source = source;
  }

  if (versionError && logger?.error) {
    logger.error('failed to resolve session form version', { message: versionError.message });
  }

  return { metadata: Object.keys(metadataPayload).length ? metadataPayload : null, error: versionError };
}
