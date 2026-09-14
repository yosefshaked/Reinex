import { getAuthClient } from '@/lib/supabase-manager.js';

async function getAuthenticatorAssuranceLevel(authClient) {
  if (typeof authClient?.auth?.getAuthenticatorAssuranceLevel === 'function') {
    return authClient.auth.getAuthenticatorAssuranceLevel();
  }

  if (typeof authClient?.auth?.mfa?.getAuthenticatorAssuranceLevel === 'function') {
    return authClient.auth.mfa.getAuthenticatorAssuranceLevel();
  }

  return { data: null, error: null };
}

let mfaOptionalPromise = null;

// Local development only: /api/config reports `systemAdminMfaOptional` when the API lets system admins in
// without MFA (SYSTEM_ADMIN_ALLOW_WITHOUT_MFA + local Supabase + non-Production). The API enforces it anyway.
function isSystemAdminMfaOptional() {
  if (!mfaOptionalPromise) {
    mfaOptionalPromise = fetch('/api/config', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => payload?.systemAdminMfaOptional === true)
      .catch(() => false);
  }
  return mfaOptionalPromise;
}

async function getSystemAdminPermission(authClient, userId) {
  const { data, error } = await authClient
    .from('profiles')
    .select('is_system_admin')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data?.is_system_admin) {
    return null;
  }

  return { role: 'super_admin' };
}

export const adminAuthProvider = {
  login: async () => ({ success: true }),

  logout: async () => {
    const authClient = getAuthClient();
    await authClient.auth.signOut();
    return {
      success: true,
      redirectTo: '/login',
    };
  },

  check: async (params = {}) => {
    let authClient;
    try {
      authClient = getAuthClient();
    } catch {
      return {
        authenticated: false,
        redirectTo: '/login',
      };
    }

    const { data: sessionData, error: sessionError } = await authClient.auth.getSession();
    if (sessionError || !sessionData?.session) {
      return {
        authenticated: false,
        redirectTo: '/login',
      };
    }

    const userId = sessionData.session.user?.id;
    if (!userId) {
      return {
        authenticated: false,
        redirectTo: '/login',
      };
    }

    const permission = await getSystemAdminPermission(authClient, userId);
    if (!permission) {
      return {
        authenticated: false,
        redirectTo: '/dashboard',
      };
    }

    const { data: aalData } = await getAuthenticatorAssuranceLevel(authClient);
    const currentLevel = aalData?.currentLevel || aalData?.current_level || 'aal1';

    const pathname = typeof params?.pathname === 'string' ? params.pathname : '';
    const isMfaRoute = pathname.startsWith('/system-admin/mfa');

    if (currentLevel !== 'aal2' && !isMfaRoute && !(await isSystemAdminMfaOptional())) {
      return {
        authenticated: true,
        redirectTo: '/system-admin/mfa',
      };
    }

    return {
      authenticated: true,
    };
  },

  getPermissions: async () => {
    let authClient;
    try {
      authClient = getAuthClient();
    } catch {
      return null;
    }

    const { data: sessionData, error: sessionError } = await authClient.auth.getSession();
    if (sessionError || !sessionData?.session?.user?.id) {
      return null;
    }

    return getSystemAdminPermission(authClient, sessionData.session.user.id);
  },

  getIdentity: async () => {
    let authClient;
    try {
      authClient = getAuthClient();
    } catch {
      return null;
    }

    const { data, error } = await authClient.auth.getUser();
    if (error || !data?.user) {
      return null;
    }

    const user = data.user;
    return {
      id: user.id,
      name: user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'System Admin',
      avatar: user.user_metadata?.avatar_url || null,
      email: user.email || null,
    };
  },

  onError: async () => ({ error: null }),
};
