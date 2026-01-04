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

function classifyTenantDbError(error, { resource, tenantAuth } = {}) {
  const message = typeof error?.message === 'string' ? error.message : null;
  const code = typeof error?.code === 'string' ? error.code : null;
  const details = typeof error?.details === 'string' ? error.details : null;
  const hint = typeof error?.hint === 'string' ? error.hint : null;
  const status = typeof error?.status === 'number' ? error.status : (typeof error?.statusCode === 'number' ? error.statusCode : null);

  if (code === 'PGRST301') {
    return {
      status: 428,
      body: {
        error: 'invalid_tenant_dedicated_key',
        message: 'Tenant API rejected tenant auth material (PGRST301). This usually means org_settings.anon_key is not the tenant anon/service key (apikey) OR the stored dedicated app_user JWT is not valid for the tenant. Verify: anonKey role=anon (or service_role) and dedicatedKey role=app_user. See details.tenant_auth for the roles/shapes actually used by this request.',
        details: {
          resource: resource || null,
          code,
          message,
          details,
          hint,
          tenant_auth: tenantAuth || null,
        },
      },
    };
  }

  if (status === 401) {
    return {
      status: 428,
      body: {
        error: 'invalid_tenant_dedicated_key',
        message: 'Tenant API returned 401. This usually means the dedicated app_user JWT is not signed with the tenant JWT secret, OR org_settings.anon_key is wrong for the tenant. See details.tenant_auth for the roles/shapes used by this request.',
        details: {
          resource: resource || null,
          status,
          code,
          message,
          details,
          hint,
          tenant_auth: tenantAuth || null,
        },
      },
    };
  }

  const text = `${code || ''} ${message || ''} ${details || ''}`.toLowerCase();
  const looksLikeMissingTable =
    code === '42P01' ||
    code === 'PGRST205' ||
    text.includes('schema cache') ||
    text.includes('does not exist') ||
    text.includes('could not find the table');

  const looksLikeMissingRelationship =
    text.includes('relationship') && (text.includes('could not find') || text.includes('no relationship'));

  if (looksLikeMissingTable || looksLikeMissingRelationship) {
    return {
      status: 424,
      body: {
        error: 'schema_upgrade_required',
        message: 'Tenant scheduling schema is missing or incomplete.',
        details: {
          resource: resource || null,
          code,
          message,
          details,
          hint,
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: 'database_error',
      message: message || 'Tenant database query failed.',
      details: {
        resource: resource || null,
        code,
        details,
        hint,
      },
    },
  };
}

function isMissingTenantTableError(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  const code = typeof error?.code === 'string' ? error.code : '';
  const details = typeof error?.details === 'string' ? error.details : '';
  const text = `${code} ${message} ${details}`.toLowerCase();

  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    text.includes('schema cache') ||
    text.includes('does not exist') ||
    text.includes('could not find the table')
  );
}

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

  let { data, error } = await tenantClient
    .from('Employees')
    .select('*')
    .order('name');

  if (error && isMissingTenantTableError(error)) {
    ({ data, error } = await tenantClient
      .from('employees')
      .select('*')
      .order('name'));
  }

  if (error) {
    context.log.error('Failed to fetch instructors', error);
    const classified = classifyTenantDbError(error, { resource: 'Employees', tenantAuth: context.__tenantAuthDiagnostics });
    return respond(context, classified.status, classified.body);
  }

  return respond(context, 200, { data });
}
