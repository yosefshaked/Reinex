export function mapSupabaseError(error) {
  const hasDetails = error && typeof error.details === 'string';
  const details = hasDetails ? error.details.toLowerCase() : '';
  const code = error && typeof error.code === 'string' ? error.code : undefined;
  let statusValue;
  if (error && typeof error.status === 'number') {
    statusValue = error.status;
  } else if (error && typeof error.statusCode === 'number') {
    statusValue = error.statusCode;
  } else if (error && typeof error.statusCode !== 'undefined') {
    const numeric = Number(error.statusCode);
    statusValue = Number.isFinite(numeric) ? numeric : undefined;
  } else {
    statusValue = undefined;
  }

  if (code === '23505') {
    if (details.includes('org_memberships')) {
      return 'את/ה כבר משויך/ת לארגון שנוצר. נסה/י לרענן.';
    }
    if (details.includes('organizations')) {
      return 'ארגון בשם זה כבר קיים.';
    }
    return 'פריט קיים כבר במערכת.';
  }

  if (code === '42501' || statusValue === 403) {
    return 'אין הרשאה לביצוע הפעולה.';
  }

  // Pass the message through only when it's already Hebrew (our mapped API errors);
  // raw English Supabase text falls back to the generic Hebrew message.
  const trimmed = error && typeof error.message === 'string' ? error.message.trim() : '';
  if (trimmed && /[֐-׿]/.test(trimmed)) {
    return trimmed;
  }

  return 'קרתה תקלה ביצירת הארגון.';
}
