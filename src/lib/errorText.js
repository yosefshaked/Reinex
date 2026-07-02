// Front-facing error text helper.
//
// Our API client (`authenticatedFetch`) already maps known error codes to plain
// Hebrew, so an Error's `message` is usually Hebrew. But raw Supabase/auth errors
// and network failures ("Failed to fetch", "Password should be…") arrive in
// English. This surfaces the message only when it already reads as Hebrew, so our
// good Hebrew messages pass through while English never reaches the user.

const HEBREW_CHAR = /[֐-׿]/;

/**
 * @param {unknown} message  candidate message (e.g. error.message)
 * @param {string} fallback  plain-Hebrew fallback shown when message isn't Hebrew
 * @returns {string}
 */
export function hebrewMessageOrFallback(message, fallback) {
  const text = typeof message === 'string' ? message.trim() : '';
  return text && HEBREW_CHAR.test(text) ? text : fallback;
}
