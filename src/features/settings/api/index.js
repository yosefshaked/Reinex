import { fetchSettingsValue as fetchSettingsValueApi, fetchSettingsValueWithMeta } from '@/features/settings/api/settings.js';

function normalizeOrgId(options) {
  if (!options) {
    return '';
  }
  const candidate = options.orgId
    ?? options.organizationId
    ?? options.org_id
    ?? options.organization_id
    ?? null;
  if (typeof candidate !== 'string') {
    return '';
  }
  return candidate.trim();
}

function normalizeOptions(options) {
  if (!options || typeof options !== 'object') {
    throw new Error('נדרש להעביר פרטי Session וזיהוי ארגון לקריאת הגדרות.');
  }

  const session = options.session ?? options.accessToken ?? options.token ?? null;
  if (!session) {
    throw new Error('נדרשת התחברות פעילה כדי לקרוא הגדרות ארגון.');
  }

  const orgId = normalizeOrgId(options);
  if (!orgId) {
    throw new Error('נדרש מזהה ארגון תקף לקריאת הגדרות.');
  }

  const signal = options.signal ?? null;

  return { session, orgId, signal };
}

async function fetchSettingsValueInternal(options, key) {
  if (!key) {
    throw new Error('נדרש מפתח הגדרה לקריאה.');
  }
  const normalized = normalizeOptions(options);
  return fetchSettingsValueApi({ ...normalized, key });
}

export async function fetchLeavePolicySettings(_options) {
  void _options;
  // Removed: unused in current app; uncomment when needed
  // return fetchSettingsValueInternal(options, 'leave_policy');
  throw new Error('fetchLeavePolicySettings is currently unused and has been disabled.');
}

export async function fetchLeavePayPolicySettings(_options) {
  void _options;
  // Removed: unused in current app; uncomment when needed
  // return fetchSettingsValueInternal(options, 'leave_pay_policy');
  throw new Error('fetchLeavePayPolicySettings is currently unused and has been disabled.');
}

export async function fetchEmploymentScopePolicySettings(options) {
  return fetchSettingsValueInternal(options, 'employment_scope_policy');
}

export async function fetchSessionFormConfig(options) {
  const normalized = normalizeOptions(options);
  return fetchSettingsValueWithMeta({ ...normalized, key: 'session_form_config' });
}
