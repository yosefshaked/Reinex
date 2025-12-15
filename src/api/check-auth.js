import { authenticatedFetch } from '@/lib/api-client.js';

function normalizeEmail(email) {
  if (typeof email !== 'string') {
    throw new Error('יש להזין כתובת אימייל.');
  }
  const normalized = email.trim().toLowerCase();
  const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  if (!emailPattern.test(normalized)) {
    throw new Error('כתובת האימייל שסופקה אינה תקינה.');
  }
  return normalized;
}

/**
 * Check authentication state for a user by email.
 * Requires admin role in at least one organization.
 * 
 * @param {string} email - Email address to check
 * @param {object} options - Options with session and optional signal
 * @returns {Promise<{email: string, auth: {exists: boolean, emailConfirmed: boolean, lastSignInAt: string|null}}>}
 */
export async function checkAuthByEmail(email, { session, signal } = {}) {
  if (!session) {
    throw new Error('נדרשת התחברות כדי לבדוק מצב אימות.');
  }

  const normalizedEmail = normalizeEmail(email);
  const searchParams = new URLSearchParams({ email: normalizedEmail });

  try {
    const response = await authenticatedFetch(`invitations/check-auth?${searchParams.toString()}`, {
      method: 'GET',
      session,
      signal,
    });

    if (!response || typeof response !== 'object') {
      throw new Error('השרת לא החזיר תשובה תקינה.');
    }

    const authState = response.auth || null;
    if (!authState || typeof authState !== 'object') {
      throw new Error('מצב האימות חסר מהתשובה.');
    }

    return {
      email: response.email || normalizedEmail,
      auth: {
        exists: !!authState.exists,
        emailConfirmed: !!(authState.emailConfirmed ?? authState.email_confirmed),
        lastSignInAt: authState.lastSignInAt || authState.last_sign_in_at || null,
      },
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error;
    }
    if (error?.status === 403) {
      error.message = 'נדרשות הרשאות מנהל לבדוק מצב אימות של משתמשים.';
    } else if (!error?.message) {
      error.message = 'בדיקת מצב האימות נכשלה. נסה שוב מאוחר יותר.';
    }
    throw error;
  }
}
