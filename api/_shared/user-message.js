// @ts-check
/**
 * The marker that approves a server `message` for display (docs/project-rules/20, "Showing an
 * error"; docs/project-rules/30). Isomorphic and dependency-free, so a shared rule module that the
 * frontend also imports (for example `clock-change-rules.js`) can mark the body it builds.
 */

export const USER_MESSAGE_KIND = 'user';

/**
 * Marks a 4xx response body whose `message` is Hebrew business copy written for users. The frontend
 * shows a server `message` as it is only with this marker; without it, the message is treated as
 * internal and the user gets a safe default.
 *
 * Mark the body where the wording is written (the helper that composes it), never in a generic
 * error path: DB, provider, `catch` or exception text must never pass through it.
 *
 * @template {Record<string, any>} T
 * @param {T} body
 * @returns {T & { message_kind: 'user' }}
 */
export function withUserMessage(body) {
  return { ...body, message_kind: USER_MESSAGE_KIND };
}
