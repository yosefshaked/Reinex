/* eslint-env node */
/**
 * announcement — public endpoint that serves the active platform banner.
 *
 * GET /api/announcement
 *   → { active: boolean, text: string }
 *
 * No auth required — every signed-in user's AppShell calls this on mount.
 * Reads admin_data where module='announcements' AND record_id='active-banner'.
 * Returns { active: false } on any error so the UI fails silently.
 */
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { readEnv, respond } from '../_shared/org-bff.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

export default async function run(context, req) {
  if (req.method === 'OPTIONS') {
    return respond(context, 204, null, CORS_HEADERS);
  }

  try {
    const env = readEnv(context);
    const config = readSupabaseAdminConfig(env);
    const supabase = createSupabaseAdminClient(config);

    const { data, error } = await supabase
      .from('admin_data')
      .select('data')
      .eq('module', 'announcements')
      .eq('record_id', 'active-banner')
      .maybeSingle();

    if (error || !data) {
      return respond(context, 200, { active: false, text: '' }, CORS_HEADERS);
    }

    const record = data.data ?? {};
    return respond(context, 200, {
      active: Boolean(record.active),
      text: typeof record.text === 'string' ? record.text : '',
    }, CORS_HEADERS);
  } catch {
    return respond(context, 200, { active: false, text: '' }, CORS_HEADERS);
  }
}
