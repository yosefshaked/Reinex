/* eslint-env node */

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

export async function getAuthUserById(supabase, userId) {
  if (typeof userId !== 'string' || !userId.trim()) {
    return null;
  }

  const { data, error } = await supabase.auth.admin.getUserById(userId.trim());
  if (error) {
    throw error;
  }

  return data?.user ?? null;
}

export async function getAuthUsersByIds(supabase, userIds = []) {
  const normalizedIds = Array.from(new Set(
    (Array.isArray(userIds) ? userIds : [])
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  ));

  const pairs = await Promise.all(normalizedIds.map(async (userId) => [userId, await getAuthUserById(supabase, userId)]));
  return new Map(pairs);
}

export async function findAuthUserByEmail(supabase, email, { maxPages = 5, perPage = 200 } = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
      filter: normalizedEmail,
    });

    if (error) {
      throw error;
    }

    const users = Array.isArray(data?.users) ? data.users : [];
    const match = users.find((user) => normalizeEmail(user?.email) === normalizedEmail) || null;
    if (match) {
      return match;
    }

    if (users.length < perPage) {
      break;
    }
  }

  return null;
}
