/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantPublicClient,
} from '../_shared/org-bff.js';

export default async function (context, req) {
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  const supabase = createSupabaseAdminClient(adminConfig);

  const authorization = resolveBearerAuthorization(req);
  const orgId = resolveOrgId(req);

  if (!authorization?.token) {
    return respond(context, 401, { error: 'missing_auth' });
  }

  if (!orgId) {
    return respond(context, 400, { error: 'missing_org_id' });
  }

  const authResult = await supabase.auth.getUser(authorization.token);
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { error: 'invalid_token' });
  }

  const userId = authResult.data.user.id;

  const membership = await ensureMembership(supabase, orgId, userId);
  if (!membership) {
    return respond(context, 403, { error: 'forbidden' });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantPublicClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  const { data, error } = await tenantClient
    .from('Services')
    .select('*')
    .order('name');

  if (error) {
    context.log.error('Failed to fetch services', error);
    return respond(context, 500, { error: 'database_error' });
  }

  return respond(context, 200, { data });
}
