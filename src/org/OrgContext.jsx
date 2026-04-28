import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { getAuthClient } from '@/lib/supabase-manager.js';
import { useRuntimeConfig } from '@/runtime/RuntimeConfigContext.jsx';
import { useAuth } from '@/auth/AuthContext.jsx';
import { createOrganization as createOrganizationRpc } from '@/api/organizations.js';
import { mapSupabaseError } from '@/org/errors.js';

const ACTIVE_ORG_STORAGE_KEY = 'active_org_id';
const LEGACY_STORAGE_PREFIX = 'employee-management:last-org';

function readStoredOrgId(userId) {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(ACTIVE_ORG_STORAGE_KEY);
    if (stored) {
      return stored;
    }
    if (!userId) {
      return null;
    }
    const legacyKeyWithUser = `${LEGACY_STORAGE_PREFIX}:${userId}`;
    const legacyValueWithUser = window.localStorage.getItem(legacyKeyWithUser);
    if (legacyValueWithUser) {
      return legacyValueWithUser;
    }
    const legacyFallback = window.localStorage.getItem(LEGACY_STORAGE_PREFIX);
    return legacyFallback;
  } catch {
    return null;
  }
}

function writeStoredOrgId(userId, orgId) {
  if (typeof window === 'undefined') return;
  try {
    if (!orgId) {
      window.localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
    } else {
      window.localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, orgId);
    }
    if (userId) {
      window.localStorage.removeItem(`${LEGACY_STORAGE_PREFIX}:${userId}`);
    }
    window.localStorage.removeItem(LEGACY_STORAGE_PREFIX);
  } catch {
    // ignore storage failures silently
  }
}

const OrgContext = createContext(null);

function normalizeInvite(record, organizationOverride) {
  if (!record) return null;
  const organization = organizationOverride || record.organizations || record.organization;
  return {
    id: record.id,
    org_id: record.org_id || organization?.id || null,
    email: (record.email || '').toLowerCase(),
    token: record.token || null,
    status: record.status || 'pending',
    invited_by: record.invited_by || null,
    created_at: record.created_at,
    expires_at: record.expires_at || null,
    organization: organization
      ? {
          id: organization.id,
          name: organization.name,
        }
      : null,
  };
}

function normalizeMember(record) {
  if (!record) return null;
  const profile = record.profiles || record.profile || record.user_profile || null;
  return {
    id: record.id,
    org_id: record.org_id,
    user_id: record.user_id,
    role: record.role || 'member',
    created_at: record.created_at,
    email: profile?.email || record.email || null,
    name: profile?.full_name || profile?.name || null,
    profile: profile ? {
      id: profile.id || record.user_id || null,
      first_name: profile.first_name || null,
      last_name: profile.last_name || null,
      full_name: profile.full_name || profile.name || null,
      email: profile.email || record.email || null,
      phone: profile.phone || null,
    } : null,
    invited_at: record.invited_at || null,
    joined_at: record.joined_at || record.created_at || null,
    status: record.status || 'active',
  };
}

async function authenticatedFetch(path, { params, ...options } = {}) {
  const authClient = getAuthClient();
  const { data, error } = await authClient.auth.getSession();

  if (error) {
    throw new Error('Authentication token not found.');
  }

  const token = data?.session?.access_token || null;

  if (!token) {
    throw new Error('Authentication token not found.');
  }

  const bearer = `Bearer ${token}`;

  const { headers: customHeaders = {}, body, ...rest } = options || {};
  const headers = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };

  headers.Authorization = bearer;
  headers.authorization = bearer;
  headers['X-Supabase-Authorization'] = bearer;
  headers['x-supabase-authorization'] = bearer;
  headers['x-supabase-auth'] = bearer;

  const storedOrgId = readStoredOrgId();
  if (storedOrgId) {
    headers['x-org-id'] = storedOrgId;
  }

  let requestBody = body;
  if (requestBody && typeof requestBody === 'object' && !(requestBody instanceof FormData)) {
    requestBody = JSON.stringify(requestBody);
  }

  let normalizedPath = String(path || '');
  if (!normalizedPath.startsWith('/api/')) {
    normalizedPath = `/api/${normalizedPath.replace(/^\/+/, '')}`;
  }

  if (params && typeof params === 'object' && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (item !== undefined && item !== null) {
            searchParams.append(key, String(item));
          }
        });
        return;
      }
      searchParams.set(key, String(value));
    });

    const queryString = searchParams.toString();
    if (queryString) {
      normalizedPath = `${normalizedPath.split('?')[0]}?${queryString}`;
    }
  }

  const response = await fetch(normalizedPath, {
    ...rest,
    headers,
    body: requestBody,
  });

  let payload = null;
  const contentType = response.headers?.get?.('content-type') || response.headers?.get?.('Content-Type') || '';
  const isJson = typeof contentType === 'string' && contentType.toLowerCase().includes('application/json');
  if (isJson) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message = payload?.message || 'An API error occurred';
    const error = new Error(message);
    if (payload) {
      error.data = payload;
    }
    throw error;
  }

  return payload;
}

export function OrgProvider({ children }) {
  const { status: authStatus, user, session } = useAuth();
  const userId = user?.id || null;
  const userName = user?.name || null;
  const {
    authClient,
  } = useSupabase();
  const runtimeConfig = useRuntimeConfig();
  const requireAuthClient = useCallback(() => {
    if (!authClient) {
      throw new Error('לקוח Supabase אינו זמין. נסו שוב לאחר שהחיבור הושלם.');
    }
    return authClient;
  }, [authClient]);
  const [status, setStatus] = useState('idle');
  const [organizations, setOrganizations] = useState([]);
  const [activeOrgId, setActiveOrgId] = useState(null);
  const [activeOrg, setActiveOrg] = useState(null);
  const [incomingInvites, setIncomingInvites] = useState([]);
  const [canCreateOrganizations, setCanCreateOrganizations] = useState(false);
  const [maxOwnedOrganizations, setMaxOwnedOrganizations] = useState(null);
  const [orgMembers, setOrgMembers] = useState([]);
  const [orgInvites, setOrgInvites] = useState([]);
  const [error, setError] = useState(null);
  const [directoryEnabled, setDirectoryEnabled] = useState(false);
  const sessionRef = useRef(session);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Stable toggles for directory fetching lifecycle
  const enableDirectory = useCallback(() => {
    setDirectoryEnabled((prev) => (prev ? prev : true));
  }, []);
  const disableDirectory = useCallback(() => {
    setDirectoryEnabled((prev) => (prev ? false : prev));
    setOrgMembers([]);
    setOrgInvites([]);
  }, []);
  const loadingRef = useRef(false);
  const lastUserIdRef = useRef(null);
  const hasRuntimeConfig = Boolean(runtimeConfig?.supabaseUrl && runtimeConfig?.supabaseAnonKey);

  const resetState = useCallback(() => {
    setStatus('idle');
    setOrganizations([]);
    setActiveOrgId(null);
    setActiveOrg(null);
    setIncomingInvites([]);
    setCanCreateOrganizations(false);
    setMaxOwnedOrganizations(null);
    setOrgMembers([]);
    setOrgInvites([]);
    setError(null);
    setDirectoryEnabled(false);
  }, []);

  const loadMemberships = useCallback(async () => {
    if (!userId) {
      resetState();
      return { organizations: [], invites: [] };
    }

    if (!authClient) {
      return { organizations: [], invites: [] };
    }

    if (!sessionRef.current) {
      return { organizations: [], invites: [] };
    }

    loadingRef.current = true;
    setStatus((prev) => (prev === 'idle' ? 'loading' : prev));
    setError(null);

    try {
      const bootstrapName = userName || null;
      await authClient.rpc('ensure_my_profile_exists', {
        p_full_name: bootstrapName,
        p_locale: 'he',
      });

      const payload = await authenticatedFetch('user-context');

      const organizationsPayload = Array.isArray(payload?.organizations)
        ? payload.organizations.filter((org) => org && org.id)
        : [];

      const invitesPayload = Array.isArray(payload?.incomingInvites)
        ? payload.incomingInvites.filter(Boolean)
        : [];

      const canCreate = Boolean(payload?.canCreateOrganizations);
      const maxOwned = Number.isInteger(payload?.maxOwnedOrganizations)
        ? payload.maxOwnedOrganizations
        : null;

      setOrganizations(organizationsPayload);
      setIncomingInvites(invitesPayload);
      setCanCreateOrganizations(canCreate);
      setMaxOwnedOrganizations(maxOwned);

      return { organizations: organizationsPayload, invites: invitesPayload };
    } catch (loadError) {
      console.error('Failed to load organization memberships', loadError);
      setError(loadError);
      setOrganizations([]);
      setIncomingInvites([]);
      setCanCreateOrganizations(false);
      setMaxOwnedOrganizations(null);
      throw loadError;
    } finally {
      loadingRef.current = false;
    }
  }, [authClient, userId, userName, resetState]);

  const loadOrgDirectory = useCallback(
    async (orgId, { signal } = {}) => {
      if (!orgId) {
        setOrgMembers([]);
        setOrgInvites([]);
        return;
      }

      if (!sessionRef.current) {
        return;
      }

      try {
        const directoryData = await authenticatedFetch('directory', {
          params: { orgId },
          signal,
        });

        const rawMembers = Array.isArray(directoryData?.members)
          ? directoryData.members
          : Array.isArray(directoryData?.orgMembers)
            ? directoryData.orgMembers
            : Array.isArray(directoryData?.data)
              ? directoryData.data
              : [];
        const normalizedMembers = rawMembers.map((member) => normalizeMember(member)).filter(Boolean);

        const rawInvites = Array.isArray(directoryData?.invites)
          ? directoryData.invites
          : Array.isArray(directoryData?.invitations)
            ? directoryData.invitations
            : [];
        const normalizedInvites = rawInvites
          .map((invite) => normalizeInvite(invite, invite?.organization))
          .filter(Boolean);

        setOrgMembers(normalizedMembers);
        setOrgInvites(normalizedInvites);
      } catch (directoryError) {
        if (directoryError?.name === 'AbortError') {
          return;
        }
        console.error('Failed to load organization directory', directoryError);
        setOrgMembers([]);
        setOrgInvites([]);
      }
    },
    [],
  );

  const determineStatus = useCallback(
    (orgList, currentOrgId = activeOrgId) => {
      if (!userId) return 'idle';
      if (loadingRef.current) return 'loading';
      if (!orgList.length) return 'needs-org';
      if (!currentOrgId) return 'needs-selection';
      return 'ready';
    },
    [activeOrgId, userId],
  );

  const applyActiveOrg = useCallback(
    (org) => {
      if (!org) {
        setActiveOrgId(null);
        setActiveOrg(null);
        return;
      }

      setActiveOrgId(org.id);
      setActiveOrg(org);
    },
    [],
  );

  useEffect(() => {
    if (!hasRuntimeConfig) {
      return;
    }

    if (authStatus === 'loading') {
      return;
    }

    if (!authClient) {
      return;
    }

    if (!userId) {
      resetState();
      lastUserIdRef.current = null;
      return;
    }

    if (lastUserIdRef.current !== userId) {
      lastUserIdRef.current = userId;
    }

    let isActive = true;

    const initialize = async () => {
      try {
        const { organizations: orgList } = await loadMemberships();
        if (!isActive) return;

        const storedOrgId = readStoredOrgId(userId);
        const existing = orgList.find((item) => item.id === storedOrgId) || orgList[0] || null;
        const currentOrgId = existing?.id || null;
        if (existing) {
          applyActiveOrg(existing);
          writeStoredOrgId(userId, existing.id);
          setOrgMembers([]);
          setOrgInvites([]);
        } else {
          applyActiveOrg(null);
          setOrgMembers([]);
          setOrgInvites([]);
        }
        setStatus(determineStatus(orgList, currentOrgId));
      } catch (initError) {
        if (!isActive) return;
        console.error('Failed to initialize organization context', initError);
        setStatus('error');
      }
    };

    initialize();

    return () => {
      isActive = false;
    };
  }, [authStatus, authClient, userId, loadMemberships, determineStatus, resetState, applyActiveOrg, hasRuntimeConfig]);

  useEffect(() => {
    // Directory (members + invites) lives in the control DB and does not depend on tenant runtime config
    if (!hasRuntimeConfig) {
      return;
    }

    if (!activeOrgId) {
      setOrgMembers([]);
      setOrgInvites([]);
      return;
    }

    if (!sessionRef.current) {
      return;
    }

    // Only fetch directory when explicitly enabled (e.g., Settings → Team Members open)
    if (!directoryEnabled) {
      return;
    }

    const abortController = new AbortController();

    const run = async () => {
      try {
        await loadOrgDirectory(activeOrgId, { signal: abortController.signal });
      } catch (error) {
        if (error?.name === 'AbortError') {
          return;
        }
        console.error('Failed to refresh organization directory', error);
      }
    };

    run();

    return () => {
      abortController.abort();
    };
  }, [activeOrgId, loadOrgDirectory, hasRuntimeConfig, directoryEnabled]);

  const selectOrg = useCallback(
    async (orgId) => {
      if (!orgId) {
        applyActiveOrg(null);
        writeStoredOrgId(userId, '');
        setStatus(determineStatus(organizations, null));
        return;
      }

      const next = organizations.find((org) => org.id === orgId);
      if (!next) {
        toast.error('הארגון שנבחר אינו זמין.');
        return;
      }

      applyActiveOrg(next);
      writeStoredOrgId(userId, orgId);
      await loadOrgDirectory(orgId);
      setStatus(determineStatus(organizations, orgId));
    },
    [organizations, userId, determineStatus, applyActiveOrg, loadOrgDirectory],
  );

  const refreshOrganizations = useCallback(
    async ({ keepSelection = true } = {}) => {
      if (!userId) return;
      const previousOrgId = keepSelection ? activeOrgId : null;
      const { organizations: orgList } = await loadMemberships();
      const nextActive = keepSelection && previousOrgId
        ? orgList.find((org) => org.id === previousOrgId)
        : orgList[0] || null;
      const nextActiveOrgId = nextActive?.id || null;

      if (nextActive) {
        applyActiveOrg(nextActive);
        writeStoredOrgId(userId, nextActive.id);
        await loadOrgDirectory(nextActive.id);
      } else {
        applyActiveOrg(null);
        setOrgMembers([]);
        setOrgInvites([]);
      }
      setStatus(determineStatus(orgList, nextActiveOrgId));
    },
    [userId, activeOrgId, loadMemberships, applyActiveOrg, loadOrgDirectory, determineStatus],
  );

  const createOrganization = useCallback(
    async ({ name, policyLinks = [], legalSettings = {} }) => {
      const client = requireAuthClient();
      if (!userId && !sessionRef.current?.user?.id) {
        const { data: authUser, error: authError } = await client.auth.getUser();
        if (authError) {
          console.error('Failed to resolve authenticated user for organization creation', authError);
          throw new Error('לא ניתן היה לאמת את המשתמש. נסה להתחבר מחדש.');
        }

        if (!authUser?.user?.id) {
          throw new Error('אין משתמש מחובר.');
        }
      }

      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        throw new Error('יש להזין שם ארגון.');
      }

      const payload = {};

      if (Array.isArray(policyLinks)) {
        payload.policyLinks = policyLinks
          .map((item) => {
            if (!item) return '';
            if (typeof item === 'string') return item.trim();
            if (typeof item.url === 'string') return item.url.trim();
            if (typeof item.href === 'string') return item.href.trim();
            return '';
          })
          .filter(Boolean);
      }

      if (legalSettings && typeof legalSettings === 'object' && !Array.isArray(legalSettings)) {
        payload.legalSettings = legalSettings;
      }

      const now = new Date().toISOString();

      try {
        const effectiveOrgId = await createOrganizationRpc(trimmedName);

        const updates = {};

        if (Object.prototype.hasOwnProperty.call(payload, 'policyLinks')) {
          updates.policy_links = payload.policyLinks || [];
        }

        if (Object.prototype.hasOwnProperty.call(payload, 'legalSettings')) {
          updates.legal_settings = payload.legalSettings || {};
        }

        if (Object.keys(updates).length) {
          updates.updated_at = now;

          const { error: updateError } = await client
            .from('organizations')
            .update(updates)
            .eq('id', effectiveOrgId);

          if (updateError) {
            console.error('Failed to update organization metadata after creation', updateError);
            throw updateError;
          }
        }

        await refreshOrganizations({ keepSelection: false });
        await selectOrg(effectiveOrgId);
        toast.success('הארגון נוצר בהצלחה.');
        return effectiveOrgId;
      } catch (error) {
        console.error('Failed to create organization', error);
        const message = mapSupabaseError(error);
        throw new Error(message);
      }
    },
    [requireAuthClient, userId, refreshOrganizations, selectOrg],
  );

  const updateOrganizationMetadata = useCallback(
    async (orgId, updates) => {
      if (!orgId) throw new Error('זיהוי ארגון חסר.');
      const client = requireAuthClient();
      const payload = { ...updates, updated_at: new Date().toISOString() };
      const { error } = await client
        .from('organizations')
        .update(payload)
        .eq('id', orgId);
      if (error) throw error;
      await refreshOrganizations();
    },
    [requireAuthClient, refreshOrganizations],
  );

  const updateConnection = useCallback(
    async (orgId, { policyLinks, legalSettings }) => {
      const updates = {};
      if (Array.isArray(policyLinks)) {
        updates.policy_links = policyLinks;
      }
      if (legalSettings && typeof legalSettings === 'object') {
        updates.legal_settings = legalSettings;
      }
      await updateOrganizationMetadata(orgId, updates);
    },
    [updateOrganizationMetadata],
  );

  const recordVerification = useCallback(
    async (orgId, verifiedAt) => {
      await updateOrganizationMetadata(orgId, {
        setup_completed: true,
        verified_at: verifiedAt,
      });
    },
    [updateOrganizationMetadata],
  );

  const inviteMember = useCallback(
    async (orgId, email) => {
      if (!orgId) throw new Error('יש לבחור ארגון להזמנה.');
      const normalizedEmail = (email || '').trim().toLowerCase();
      if (!normalizedEmail) throw new Error('יש להזין כתובת אימייל תקינה.');

      const client = requireAuthClient();
      const { data, error } = await client
        .from('org_invitations')
        .insert({
          org_id: orgId,
          email: normalizedEmail,
          status: 'pending',
          invited_by: user?.id || null,
        })
        .select('id')
        .single();

      if (error) throw error;
      await loadOrgDirectory(orgId);
      toast.success('הזמנה נשלחה.');
      return data;
    },
    [requireAuthClient, user, loadOrgDirectory],
  );

  const revokeInvite = useCallback(
    async (inviteId) => {
      if (!inviteId) return;
      const client = requireAuthClient();
      const { error } = await client
        .from('org_invitations')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('id', inviteId);
      if (error) throw error;
      if (activeOrgId) await loadOrgDirectory(activeOrgId);
    },
    [requireAuthClient, activeOrgId, loadOrgDirectory],
  );

  const removeMember = useCallback(
    async (membershipId) => {
      if (!membershipId) return;
      // Use server endpoint (service role) to bypass RLS and enforce admin checks
      await authenticatedFetch(`/api/org-memberships/${membershipId}`, { method: 'DELETE' });
      if (activeOrgId) {
        await loadOrgDirectory(activeOrgId);
        await refreshOrganizations();
      }
    },
    [activeOrgId, loadOrgDirectory, refreshOrganizations],
  );

  const updateMemberRole = useCallback(
    async (membershipId, role) => {
      if (!membershipId) throw new Error('membership id required');
      const normalized = typeof role === 'string' ? role.trim().toLowerCase() : '';
      if (!normalized || (normalized !== 'member' && normalized !== 'admin')) {
        throw new Error('תפקיד לא חוקי');
      }
      await authenticatedFetch(`/api/org-memberships/${membershipId}`, {
        method: 'PATCH',
        body: { role: normalized },
      });
      if (activeOrgId) {
        await loadOrgDirectory(activeOrgId);
      }
    },
    [activeOrgId, loadOrgDirectory],
  );

  const updateMemberName = useCallback(
    async (membershipId, name) => {
      if (!membershipId) throw new Error('membership id required');
      const normalized = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
      if (!normalized) {
        throw new Error('יש להזין שם מלא תקין.');
      }
      await authenticatedFetch(`/api/org-memberships/${membershipId}`, {
        method: 'PATCH',
        body: { fullName: normalized },
      });
      if (activeOrgId) {
        await loadOrgDirectory(activeOrgId);
      }
    },
    [activeOrgId, loadOrgDirectory],
  );

  const acceptInvite = useCallback(
    async (inviteId) => {
      if (!inviteId || !user) throw new Error('הזמנה אינה זמינה.');

      const client = requireAuthClient();
      const { data: inviteData, error: inviteError } = await client
        .from('org_invitations')
        .select('id, org_id, status')
        .eq('id', inviteId)
        .maybeSingle();

      if (inviteError) throw inviteError;
      if (!inviteData) throw new Error('ההזמנה אינה קיימת או פגה.');

      if (inviteData.status !== 'pending' && inviteData.status !== 'sent') {
        throw new Error('ההזמנה כבר טופלה.');
      }

      const now = new Date().toISOString();

      const { error: membershipError } = await client
        .from('org_memberships')
        .insert({
          org_id: inviteData.org_id,
          user_id: user.id,
          role: 'member',
          created_at: now,
        });

      if (membershipError && membershipError.code !== '23505') {
        throw membershipError;
      }

      const { error: updateError } = await client
        .from('org_invitations')
        .update({ status: 'accepted', accepted_at: now })
        .eq('id', inviteId);

      if (updateError) throw updateError;

      await refreshOrganizations({ keepSelection: false });
      await selectOrg(inviteData.org_id);
      toast.success('הצטרפת לארגון בהצלחה.');
    },
    [requireAuthClient, user, refreshOrganizations, selectOrg],
  );

  // Expose org settings (permissions and storage profile) for the active org
  const orgSettings = useMemo(() => {
    if (!activeOrg) {
      return { permissions: {}, storageProfile: null };
    }
    return {
      permissions: activeOrg.permissions ?? {},
      storageProfile: activeOrg.storage_profile ?? null,
    };
  }, [activeOrg]);

  const value = useMemo(
    () => ({
      status,
      error,
      organizations,
      activeOrg,
      activeOrgId,
      incomingInvites,
      canCreateOrganizations,
      maxOwnedOrganizations,
      members: orgMembers,
      pendingInvites: orgInvites,
      selectOrg,
      refreshOrganizations,
      createOrganization,
      updateOrganizationMetadata,
      updateConnection,
      recordVerification,
      inviteMember,
      revokeInvite,
      removeMember,
      updateMemberRole,
      updateMemberName,
      acceptInvite,
      enableDirectory,
      disableDirectory,
      orgSettings,
    }),
    [
      status,
      error,
      organizations,
      activeOrg,
      activeOrgId,
      incomingInvites,
      canCreateOrganizations,
      maxOwnedOrganizations,
      orgMembers,
      orgInvites,
      selectOrg,
      refreshOrganizations,
      createOrganization,
      updateOrganizationMetadata,
      updateConnection,
      recordVerification,
      inviteMember,
      revokeInvite,
      removeMember,
      updateMemberRole,
      updateMemberName,
      acceptInvite,
      enableDirectory,
      disableDirectory,
      orgSettings,
    ],
  );

  return (
    <OrgContext.Provider value={value}>
      {children}
    </OrgContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOrg() {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error('useOrg must be used within an OrgProvider');
  }
  return context;
}
