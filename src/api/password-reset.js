function normalizeEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  if (!emailPattern.test(normalized)) {
    throw new Error('נא להזין כתובת דוא"ל תקינה.');
  }
  return normalized;
}

export async function requestPasswordReset(email, { signal } = {}) {
  const normalizedEmail = normalizeEmail(email);

  const response = await fetch('/api/password-reset', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ email: normalizedEmail }),
  });

  let payload = null;
  const contentType = response.headers?.get?.('content-type') || response.headers?.get?.('Content-Type') || '';
  if (typeof contentType === 'string' && contentType.toLowerCase().includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message = payload?.message === 'failed_to_send_password_reset'
      ? 'שליחת הודעת איפוס הסיסמה נכשלה. נסו שוב מאוחר יותר.'
      : payload?.message || 'שליחת בקשת איפוס הסיסמה נכשלה. נסו שוב מאוחר יותר.';
    const error = new Error(message);
    error.status = response.status;
    if (payload) {
      error.data = payload;
    }
    throw error;
  }

  return payload || { message: 'password_reset_requested' };
}
