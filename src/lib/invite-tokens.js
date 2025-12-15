export const INVITATION_TOKEN_KEYS = ['invitation_token', 'invitationToken', 'invite_token', 'inviteToken'];

function selectToken(params) {
  let tokenKey = null;
  let tokenValue = '';

  for (const key of INVITATION_TOKEN_KEYS) {
    if (!params.has(key)) {
      continue;
    }
    const candidate = params.get(key) ?? '';
    if (candidate) {
      tokenKey = key;
      tokenValue = candidate;
      break;
    }
    if (!tokenKey) {
      tokenKey = key;
      tokenValue = '';
    }
  }

  return {
    tokenKey,
    tokenValue: typeof tokenValue === 'string' ? tokenValue.trim() : '',
  };
}

function mergeSearchParams(primarySearch, fallbackSearch) {
  const primary = new URLSearchParams(primarySearch);
  if (!fallbackSearch || typeof fallbackSearch !== 'string') {
    return primary;
  }
  const fallback = new URLSearchParams(fallbackSearch);
  for (const [key, value] of fallback.entries()) {
    if (!primary.has(key) && typeof value === 'string') {
      primary.set(key, value);
    }
  }
  return primary;
}

export function extractRegistrationTokens(search) {
  let params = new URLSearchParams(search);
  const missingTokenHash = !(params.has('token_hash') || params.has('tokenHash'));
  const missingInviteToken = !INVITATION_TOKEN_KEYS.some((key) => params.has(key));

  if ((missingTokenHash || missingInviteToken) && typeof window !== 'undefined') {
    const globalSearch = window.location?.search ?? '';
    if (globalSearch && globalSearch !== search) {
      params = mergeSearchParams(params, globalSearch);
    }
  }

  const tokenHash = params.get('token_hash') ?? params.get('tokenHash') ?? '';
  const { tokenKey, tokenValue } = selectToken(params);
  return {
    tokenHash: typeof tokenHash === 'string' ? tokenHash.trim() : '',
    invitationTokenKey: tokenKey,
    invitationTokenValue: tokenValue,
  };
}

export function extractInvitationToken(search) {
  const params = new URLSearchParams(search);
  const { tokenKey, tokenValue } = selectToken(params);
  return {
    invitationTokenKey: tokenKey,
    invitationTokenValue: tokenValue,
  };
}

export function buildInvitationSearch(invitationTokenValue, invitationTokenKey) {
  const params = new URLSearchParams();
  if (invitationTokenValue) {
    params.set(invitationTokenKey ?? 'invitation_token', invitationTokenValue);
  }
  const search = params.toString();
  return search ? `?${search}` : '';
}
