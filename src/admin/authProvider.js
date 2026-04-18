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

  check: async () => {
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

    if (currentLevel !== 'aal2') {
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
