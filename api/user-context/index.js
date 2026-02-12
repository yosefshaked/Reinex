/* eslint-env node */
import process from 'node:process';
import { json, resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';

function readEnv(context) {
  return (context?.env && typeof context.env === 'object') ? context.env : (process.env ?? {});
}

function respond(context, status, body, extraHeaders = {}) {
  const response = json(status, body, { 'Cache-Control': 'no-store', ...extraHeaders });
  context.res = response;
  return response;
}

function mapOrganizationRecord(record, membership, connection) {
  if (!record || !membership) {
    return null;
  }

  // Strip sensitive credentials from storage profile for non-admin users
  let storageProfile = connection?.storageProfile ?? null;
  const userRole = membership?.role || 'member';
  const isAdmin = userRole === 'admin' || userRole === 'owner';
  
  if (storageProfile && !isAdmin && storageProfile.mode === 'byos' && storageProfile.byos) {
    // Non-admin: Remove sensitive credentials
    storageProfile = {
      ...storageProfile,
      byos: {
        provider: storageProfile.byos.provider,
        endpoint: storageProfile.byos.endpoint,
        bucket: storageProfile.byos.bucket,
        region: storageProfile.byos.region,
        validated_at: storageProfile.byos.validated_at,
        // Credentials intentionally omitted for non-admin users
      },
    };
    // Remove encrypted credentials marker if present
    delete storageProfile.byos._encrypted;
    delete storageProfile.byos._credentials;
  }

  return {
    id: record.id,
    name: record.name,
    slug: record.slug || null,
    policy_links: Array.isArray(record.policy_links) ? record.policy_links : [],
    legal_settings: record.legal_settings || {},
    setup_completed: Boolean(record.setup_completed),
    verified_at: record.verified_at || null,
    created_at: record.created_at,
    updated_at: record.updated_at,
    dedicated_key_saved_at: record.dedicated_key_saved_at || null,
    has_connection: Boolean(connection?.supabaseUrl && connection?.supabaseAnonKey),
    membership: {
      id: membership.id,
      org_id: membership.org_id,
      role: membership.role || 'member',
      user_id: membership.user_id,
      created_at: membership.created_at,
    },
    permissions: connection?.permissions ?? {},
    org_settings_metadata: connection?.metadata ?? null,
    org_settings_updated_at: connection?.updatedAt ?? null,
    storage_profile: storageProfile,
  };
}

function mapInviteRecord(record, organization) {
  if (!record) {
    return null;
  }

  const normalizedOrganization = organization
    ? {
        id: organization.id,
        name: organization.name,
      }
    : null;

  return {
    id: record.id,
    org_id: record.org_id || organization?.id || null,
    email: typeof record.email === 'string' ? record.email.toLowerCase() : null,
    token: record.token || null,
    status: record.status || 'pending',
    invited_by: record.invited_by || null,
    created_at: record.created_at,
    expires_at: record.expires_at || null,
    organization: normalizedOrganization,
  };
}

export default async function userContext(context, req) {
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  const { supabaseUrl, serviceRoleKey } = adminConfig;

  if (!supabaseUrl || !serviceRoleKey) {
    context.log?.error?.('user-context missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  if (String(req.method || 'GET').toUpperCase() !== 'GET') {
    return respond(context, 405, { message: 'method not allowed' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('user-context missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('user-context getUser failed', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    context.log?.warn?.('user-context token could not be resolved');
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const userEmail = typeof authResult.data.user.email === 'string'
    ? authResult.data.user.email.toLowerCase()
    : null;

  let membershipsResponse;
  let invitesResponse;
  try {
    membershipsResponse = await supabase
      .from('org_memberships')
      .select('id, org_id, user_id, role, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (userEmail) {
      invitesResponse = await supabase
        .from('org_invitations')
        .select('id, org_id, email, token, status, invited_by, created_at, expires_at')
        .eq('email', userEmail)
        .in('status', ['pending', 'sent'])
        .order('created_at', { ascending: true });
    } else {
      invitesResponse = { data: [], error: null };
    }
  } catch (error) {
    context.log?.error?.('user-context primary queries failed', { message: error?.message, userId });
    return respond(context, 500, { message: 'failed to load memberships' });
  }

  if (membershipsResponse.error) {
    const status = membershipsResponse.error.status || 500;
    context.log?.error?.('user-context memberships query error', { status, userId });
    return respond(context, status, { message: 'failed to load memberships' });
  }

  if (invitesResponse.error) {
    const status = invitesResponse.error.status || 500;
    context.log?.error?.('user-context invites query error', { status, userId });
    return respond(context, status, { message: 'failed to load invitations' });
  }

  const memberships = Array.isArray(membershipsResponse.data) ? membershipsResponse.data : [];
  const invites = Array.isArray(invitesResponse.data) ? invitesResponse.data : [];

  const orgIds = new Set();
  for (const membership of memberships) {
    if (membership?.org_id) {
      orgIds.add(membership.org_id);
    }
  }
  for (const invite of invites) {
    if (invite?.org_id) {
      orgIds.add(invite.org_id);
    }
  }

  let organizationsResponse = { data: [], error: null };
  let settingsResponse = { data: [], error: null };

  if (orgIds.size > 0) {
    const idsArray = Array.from(orgIds);
    try {
      organizationsResponse = await supabase
        .from('organizations')
        .select(
          'id, name, slug, policy_links, legal_settings, setup_completed, verified_at, created_at, updated_at, dedicated_key_saved_at, dedicated_key_encrypted',
        )
        .in('id', idsArray);

      // DEBUG LOG 2: Show encrypted key data from database
      if (organizationsResponse.data && organizationsResponse.data.length > 0) {
        for (const org of organizationsResponse.data) {
          if (org.dedicated_key_encrypted) {
            const encrypted = org.dedicated_key_encrypted;
            context.log?.('[DEBUG] User-context fetched encrypted credentials', {
              orgId: org.id,
              orgName: org.name,
              encryptedFirst20: encrypted.substring(0, 20),
              encryptedLast20: encrypted.substring(encrypted.length - 20),
              encryptedLength: encrypted.length,
              format: encrypted.split(':').length === 5 ? 'valid_v1_gcm' : 'invalid_format',
            });
          } else {
            context.log?.warn?.('[DEBUG] Org has no encrypted key', {
              orgId: org.id,
              orgName: org.name,
            });
          }
        }
      }

      settingsResponse = await supabase
        .from('org_settings')
        .select('org_id, supabase_url, anon_key, metadata, updated_at, permissions, storage_profile')
        .in('org_id', idsArray);
    } catch (error) {
      context.log?.error?.('user-context enrichment queries failed', { message: error?.message, userId });
      return respond(context, 500, { message: 'failed to load organizations' });
    }

    if (organizationsResponse.error) {
      const status = organizationsResponse.error.status || 500;
      context.log?.error?.('user-context organizations query error', { status, userId });
      return respond(context, status, { message: 'failed to load organizations' });
    }

    if (settingsResponse.error) {
      context.log?.warn?.('user-context settings query error', {
        status: settingsResponse.error.status || 500,
        userId,
      });
    }
  }

  const organizationsData = Array.isArray(organizationsResponse.data) ? organizationsResponse.data : [];
  const settingsData = Array.isArray(settingsResponse.data) ? settingsResponse.data : [];

  const organizationMap = new Map(organizationsData.map((org) => [org.id, org]));
  const connectionMap = new Map(
    settingsData
      .filter((record) => record?.org_id)
      .map((record) => [
        record.org_id,
        {
          supabaseUrl: record.supabase_url || '',
          supabaseAnonKey: record.anon_key || '',
          metadata: record.metadata ?? null,
          updatedAt: record.updated_at || null,
          permissions: record.permissions ?? {},
          storageProfile: record.storage_profile ?? null,
        },
      ]),
  );

  const normalizedOrganizations = memberships
    .map((membership) => {
      const organization = organizationMap.get(membership.org_id);
      const connection = connectionMap.get(membership.org_id);
      return mapOrganizationRecord(organization, membership, connection);
    })
    .filter(Boolean);

  const normalizedInvites = invites
    .map((invite) => {
      const organization = organizationMap.get(invite.org_id);
      return mapInviteRecord(invite, organization);
    })
    .filter(Boolean);

  const connectionsPayload = Object.fromEntries(connectionMap.entries());

  context.log?.info?.('user-context loaded memberships', {
    userId,
    membershipCount: normalizedOrganizations.length,
    inviteCount: normalizedInvites.length,
  });

  return respond(context, 200, {
    organizations: normalizedOrganizations,
    incomingInvites: normalizedInvites,
    connections: connectionsPayload,
  });
}
