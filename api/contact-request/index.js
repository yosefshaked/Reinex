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
  const preheader = escapeHtml(`בקשת גישה חדשה מ-${orgName}`);
  const safeEmail = escapeHtml(email);
  const safePhone = escapeHtml(phone);
  const safeName = escapeHtml(name);
  const safeOrg = escapeHtml(orgName);
  const safeMessage = escapeHtml(message);

  function fieldRow(label, value, ltr = false) {
    const cellStyle = `padding:14px 0;border-bottom:1px solid #edf2f7;font-size:15px;line-height:1.6;`;
    const valueAttr = ltr ? ' dir="ltr"' : '';
    return `<tr>
      <td style="${cellStyle}font-weight:600;color:#4a5568;width:110px;vertical-align:top;">${label}</td>
      <td style="${cellStyle}color:#1a202c;"${valueAttr}>${value || '—'}</td>
    </tr>`;
  }

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1a202c;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${preheader}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Brand header -->
          <tr>
            <td style="background:#2c5282;border-radius:12px 12px 0 0;padding:24px 40px;text-align:right;">
              <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">ריינקס</span>
              <span style="font-size:14px;color:#bee3f8;margin-right:10px;">מערכת ניהול מפגשים</span>
            </td>
          </tr>

          <!-- Card body -->
          <tr>
            <td style="background:#ffffff;padding:32px 40px 8px;text-align:right;">
              <!-- Badge + title -->
              <div style="margin-bottom:20px;">
                <span style="display:inline-block;background:#ebf8ff;color:#2b6cb0;font-size:12px;font-weight:600;padding:4px 12px;border-radius:20px;letter-spacing:0.3px;">בקשת גישה חדשה</span>
              </div>
              <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#1a202c;line-height:1.3;">${safeOrg}</h1>
              <p style="margin:0 0 24px;font-size:14px;color:#718096;">התקבלה בקשת גישה דרך טופס האתר</p>

              <!-- Fields table -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                ${fieldRow('שם', safeName)}
                ${fieldRow('ארגון', safeOrg)}
                ${fieldRow('אימייל', `<a href="mailto:${safeEmail}" style="color:#2b6cb0;text-decoration:none;">${safeEmail}</a>`, true)}
                ${fieldRow('טלפון', safePhone, true)}
                ${fieldRow('הודעה', safeMessage ? safeMessage.replace(/\n/g, '<br>') : '')}
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#ffffff;border-radius:0 0 12px 12px;padding:20px 40px 28px;border-top:1px solid #edf2f7;text-align:right;">
              <p style="margin:0;font-size:12px;color:#a0aec0;line-height:1.7;">
                הודעה זו נשלחה אוטומטית ממערכת ריינקס. אין להשיב למייל זה.
              </p>
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
