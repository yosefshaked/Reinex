/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { readEnv, respond } from '../_shared/org-bff.js';
import { getPermissionRegistry, getDefaultPermissions } from '../_shared/permissions-utils.js';

/**
 * GET /api/permissions-registry
 * 
 * Query params:
 *   - category: Optional filter by category (backup, branding, features, etc.)
 *   - defaults_only: If true, returns only the default values as JSON object
 * 
 * Returns:
 *   - Array of permission objects with metadata (default)
 *   - OR simple key-value object of defaults (if defaults_only=true)
 */
export default async function (context, req) {
  context.log?.info?.('permissions-registry API invoked');

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('permissions-registry missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('permissions-registry missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  // Validate token
  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('permissions-registry failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    context.log?.warn?.('permissions-registry token did not resolve to user');
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const query = req?.query ?? {};
  const category = query.category || null;
  const defaultsOnly = query.defaults_only === 'true' || query.defaults_only === '1';

  try {
    if (defaultsOnly) {
      const defaults = await getDefaultPermissions(supabase);
      
      if (defaults === null) {
        return respond(context, 500, { message: 'failed_to_fetch_defaults' });
      }
      
      return respond(context, 200, { defaults });
    }

    const registry = await getPermissionRegistry(supabase, category);
    
    return respond(context, 200, { 
      permissions: registry,
      count: registry.length,
    });
  } catch (error) {
    context.log?.error?.('permissions-registry query failed', { message: error?.message });
    return respond(context, 500, { message: 'failed_to_fetch_registry' });
  }
}
