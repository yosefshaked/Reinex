/* eslint-env node */
/**
 * announcement — public endpoint that returns the active platform banner.
 *
 * Called by AnnouncementBanner in AppShell (no auth required — all signed-in
 * and anonymous users need to see it). Uses service_role to read admin_data
 * since app_user has no access to that table.
 *
 * GET /api/announcement
 *   → { active: true, text: "..." }  — if a banner is live
 *   → { active: false, text: "" }    — if no banner is set
 */
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { readEnv, respond } from '../_shared/org-bff.js';

const RECORD_ID = 'active-banner';

export default async function announcementHandler(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    // Fail silently — a missing banner is acceptable; a 500 is not.
    return respond(context, 200, { active: false, text: '' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  const { data, error } = await supabase
    .from('admin_data')
    .select('data')
    .eq('module', 'announcements')
    .eq('record_id', RECORD_ID)
    .maybeSingle();

  if (error) {
    context.log?.warn?.('announcement: failed to fetch banner', { message: error.message });
    return respond(context, 200, { active: false, text: '' });
  }

  const record = data?.data;
  const text = typeof record?.text === 'string' ? record.text.trim() : '';
  const active = Boolean(record?.active) && text.length > 0;

  return respond(context, 200, { active, text: active ? text : '' });
}
