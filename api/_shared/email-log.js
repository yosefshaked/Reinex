/* eslint-env node */
import { sendBrevoEmail } from './brevo.js';

/**
 * logEmailSent — insert a row into email_log.
 * Fire-and-forget: swallows errors so a logging failure never blocks delivery.
 */
export async function logEmailSent(supabase, {
  emailType,
  toEmail,
  subject = null,
  status = 'sent',
  errorMessage = null,
  orgId = null,
  actorUserId = null,
  metadata = {},
}) {
  if (!supabase) return;
  await supabase
    .from('email_log')
    .insert({
      email_type: emailType,
      to_email: String(toEmail || '').trim(),
      subject: subject ? String(subject).trim() : null,
      status,
      error_message: errorMessage || null,
      org_id: orgId || null,
      actor_user_id: actorUserId || null,
      metadata: metadata || {},
    })
    .catch(() => {});
}

/**
 * sendAndLogBrevoEmail — drop-in replacement for sendBrevoEmail that also
 * writes an email_log row after the attempt (sent or failed).
 *
 * @param {object} supabase       - Service-role Supabase client (null = skip logging)
 * @param {object} emailParams    - Same shape as sendBrevoEmail first arg
 * @param {*}      source         - Env / context source passed through to sendBrevoEmail
 * @param {object} azureContext   - Azure Functions context (logging)
 * @param {object} logParams      - { emailType, orgId, actorUserId, metadata }
 */
export async function sendAndLogBrevoEmail(
  supabase,
  emailParams,
  source,
  azureContext,
  logParams = {},
) {
  let status = 'sent';
  let errorMessage = null;

  try {
    const result = await sendBrevoEmail(emailParams, source, azureContext);
    return result;
  } catch (err) {
    status = 'failed';
    errorMessage = err?.message || 'unknown_error';
    throw err;
  } finally {
    await logEmailSent(supabase, {
      emailType: logParams.emailType || 'unknown',
      toEmail: emailParams.to,
      subject: emailParams.subject,
      status,
      errorMessage,
      orgId: logParams.orgId || null,
      actorUserId: logParams.actorUserId || null,
      metadata: logParams.metadata || {},
    });
  }
}
