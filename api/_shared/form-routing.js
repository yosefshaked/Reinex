/* eslint-env node */
/**
 * Shared helpers for invite-based form routing.
 * Used by waiting-list-intake, student-required-forms, and invite-load.
 */
import { normalizeString, UUID_PATTERN } from './org-bff.js';
import { resolvePublicAppBaseUrl } from './public-app-url.js';
import { sendAndLogBrevoEmail } from './email-log.js';

export function getNowIso() {
  return new Date().toISOString();
}

export function getFutureIso(minutes) {
  return new Date(Date.now() + (minutes * 60 * 1000)).toISOString();
}

export function formatInviteDeadline(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jerusalem',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

/**
 * Build the public invite URL for a given token.
 * → {baseUrl}/#/submit?invite=<token>
 */
export function buildInviteLink(req, env, inviteToken) {
  const baseUrl = resolvePublicAppBaseUrl(req, env, { fallback: 'https://reinex.app' });
  const params = new URLSearchParams();
  params.set('invite', inviteToken);
  return `${baseUrl}/#/submit?${params.toString()}`;
}

/**
 * Load an active_routing invite row by token + category.
 * Returns null if not found or expired.
 */
export async function loadInviteRoutingByCategory(controlClient, inviteToken, category) {
  const normalizedToken = normalizeString(inviteToken);
  if (!normalizedToken || !UUID_PATTERN.test(normalizedToken)) return null;
  const nowIso = getNowIso();
  const { data, error } = await controlClient
    .from('active_routing')
    .select('id, org_id, category, routing_info, expires_at, metadata')
    .eq('id', normalizedToken)
    .eq('category', category)
    .gt('expires_at', nowIso)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Load an active_routing invite row by token without category filtering.
 * Returns the row (including category) so the caller can dispatch by flow.
 */
export async function loadInviteRoutingAny(controlClient, inviteToken) {
  const normalizedToken = normalizeString(inviteToken);
  if (!normalizedToken || !UUID_PATTERN.test(normalizedToken)) return null;
  const nowIso = getNowIso();
  const { data, error } = await controlClient
    .from('active_routing')
    .select('id, org_id, category, routing_info, expires_at, metadata')
    .eq('id', normalizedToken)
    .gt('expires_at', nowIso)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Find the most recent active routing row for a given submission_id + category.
 */
export async function findActiveRoutingBySubmission(controlClient, submissionId, category) {
  const normalizedId = normalizeString(submissionId);
  if (!normalizedId || !UUID_PATTERN.test(normalizedId)) return null;
  const nowIso = getNowIso();
  const { data, error } = await controlClient
    .from('active_routing')
    .select('id, org_id, category, routing_info, expires_at, metadata')
    .eq('category', category)
    .contains('routing_info', { submission_id: normalizedId })
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Create an active_routing invite row.
 * Returns { id, expires_at } on success; throws on error.
 */
export async function createInviteRouting(controlClient, {
  orgId,
  category,
  routingInfo,
  ttlMinutes,
  createdBy,
  metadata = {},
}) {
  const expiresAt = getFutureIso(ttlMinutes);
  const { data, error } = await controlClient
    .from('active_routing')
    .insert({
      org_id: orgId,
      category,
      expires_at: expiresAt,
      created_by: createdBy || null,
      routing_info: routingInfo,
      metadata,
    })
    .select('id')
    .single();
  if (error) throw error;
  return { id: data.id, expires_at: expiresAt };
}

/**
 * Build plain-text email body for an invite.
 */
export function buildInviteEmailText({ formName, inviteUrl, expiresAt, introLine = null }) {
  const formattedDeadline = formatInviteDeadline(expiresAt);
  return [
    'שלום,',
    '',
    introLine || `שמחים שיצרתם איתנו קשר.`,
    '',
    `כדי שנוכל לקדם את ההצטרפות, נשמח שתמלאו את ${formName || 'הטופס'} בקישור הבא:`,
    inviteUrl,
    '',
    formattedDeadline ? `הקישור זמין עד ${formattedDeadline}.` : '',
    '',
    'אם יש שאלות, אפשר להשיב להודעה הזו ונשמח לעזור.',
  ].filter((line) => line !== null).join('\n');
}

/**
 * Build HTML email body for an invite.
 */
export function buildInviteEmailHtml({ formName, inviteUrl, expiresAt, introLine = null }) {
  const formattedDeadline = formatInviteDeadline(expiresAt);
  const intro = introLine || 'שמחים שיצרתם איתנו קשר.';
  return [
    '<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.7;color:#0f172a">',
    '<p>שלום,</p>',
    `<p>${intro}</p>`,
    `<p>כדי שנוכל לקדם את ההצטרפות, נשמח שתמלאו את <strong>${formName || 'הטופס'}</strong> בקישור הבא:</p>`,
    `<p><a href="${inviteUrl}" style="color:#2563eb">${inviteUrl}</a></p>`,
    formattedDeadline ? `<p>הקישור זמין עד <strong>${formattedDeadline}</strong>.</p>` : '',
    '<p>אם יש שאלות, אפשר להשיב להודעה הזו ונשמח לעזור.</p>',
    '</div>',
  ].filter(Boolean).join('');
}

/**
 * Send an invite via email using Brevo.
 * Throws on error so callers can handle delivery fallback.
 */
export async function sendInviteEmail(controlClient, env, context, {
  toEmail,
  formName,
  inviteUrl,
  expiresAt,
  emailType = 'form_invite',
  orgId = null,
  introLine = null,
}) {
  await sendAndLogBrevoEmail(controlClient, {
    to: toEmail,
    subject: `${formName || 'טופס'} - קישור למילוי`,
    textContent: buildInviteEmailText({ formName, inviteUrl, expiresAt, introLine }),
    htmlContent: buildInviteEmailHtml({ formName, inviteUrl, expiresAt, introLine }),
  }, { env }, context, { emailType, orgId });
}
