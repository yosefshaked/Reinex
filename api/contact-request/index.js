/* eslint-env node */
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { readEnv, respond, parseRequestBody } from '../_shared/org-bff.js';
import { readBrevoConfig } from '../_shared/brevo.js';
import { sendAndLogBrevoEmail } from '../_shared/email-log.js';

const MAX_BODY_BYTES = 16 * 1024;

function normalizeString(value) {
  return String(value ?? '').trim();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildNotificationHtml({ name, orgName, email, phone, message }) {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<body style="margin:0;padding:0;background:#f7fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1a202c;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7fafc;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
          <tr>
            <td style="padding:32px 40px 16px;text-align:right;">
              <h2 style="margin:0 0 16px;font-size:20px;">בקשת גישה חדשה — ריינקס</h2>
              <table style="width:100%;border-collapse:collapse;font-size:15px;line-height:1.8;">
                <tr><td style="padding:6px 0;font-weight:600;width:100px;">שם:</td><td style="padding:6px 0;">${escapeHtml(name)}</td></tr>
                <tr><td style="padding:6px 0;font-weight:600;">ארגון:</td><td style="padding:6px 0;">${escapeHtml(orgName)}</td></tr>
                <tr><td style="padding:6px 0;font-weight:600;">אימייל:</td><td style="padding:6px 0;" dir="ltr">${escapeHtml(email)}</td></tr>
                <tr><td style="padding:6px 0;font-weight:600;">טלפון:</td><td style="padding:6px 0;" dir="ltr">${escapeHtml(phone) || '—'}</td></tr>
                <tr><td style="padding:6px 0;font-weight:600;vertical-align:top;">הודעה:</td><td style="padding:6px 0;">${escapeHtml(message) || '—'}</td></tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export default async function contactRequest(context, req) {
  if (String(req.method || 'POST').toUpperCase() !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'POST' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('contact-request missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  const contentLength = parseInt(req.headers?.['content-length'] || '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    return respond(context, 413, { message: 'payload_too_large' });
  }

  const body = parseRequestBody(req);

  // Honeypot — bots fill this field, humans never see it. Silent success to avoid detection.
  if (normalizeString(body?.website)) {
    return respond(context, 200, { message: 'submitted' });
  }

  const name = normalizeString(body?.name);
  const orgName = normalizeString(body?.org_name);
  const email = normalizeString(body?.email).toLowerCase();
  const phone = normalizeString(body?.phone);
  const message = normalizeString(body?.message);

  if (!name || !orgName || !email) {
    return respond(context, 400, { message: 'missing_required_fields' });
  }
  if (!isValidEmail(email)) {
    return respond(context, 400, { message: 'invalid_email' });
  }

  // Rate limit: reject if same email submitted in last 24 hours
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await supabase
    .from('contact_requests')
    .select('id')
    .eq('email', email)
    .gte('created_at', cutoff)
    .maybeSingle();

  if (existing) {
    return respond(context, 429, { message: 'rate_limited' });
  }

  // Persist the request
  const { error: insertError } = await supabase
    .from('contact_requests')
    .insert({ name, org_name: orgName, email, phone: phone || null, message: message || null });

  if (insertError) {
    context.log?.error?.('contact-request failed to insert', { message: insertError.message });
    return respond(context, 500, { message: 'failed_to_save_request' });
  }

  // Send notification email — best-effort; failure does not block the response
  try {
    const brevoConfig = readBrevoConfig(env);
    const notificationEmail =
      normalizeString(env?.CONTACT_NOTIFICATION_EMAIL || env?.APP_CONTACT_NOTIFICATION_EMAIL) ||
      brevoConfig.senderEmail;

    if (brevoConfig.apiKey && notificationEmail) {
      await sendAndLogBrevoEmail(
        supabase,
        {
          to: notificationEmail,
          subject: `בקשת גישה חדשה מ-${orgName}`,
          htmlContent: buildNotificationHtml({ name, orgName, email, phone, message }),
          textContent: `בקשת גישה חדשה\n\nשם: ${name}\nארגון: ${orgName}\nאימייל: ${email}\nטלפון: ${phone || '—'}\nהודעה: ${message || '—'}`,
          senderName: 'ריינקס',
        },
        env,
        context,
        { emailType: 'contact_request', metadata: { org_name: orgName, submitter_email: email } },
      );
    }
  } catch (emailError) {
    context.log?.warn?.('contact-request notification email failed', { message: emailError?.message });
  }

  return respond(context, 200, { message: 'submitted' });
}
