/* eslint-env node */
import { findAuthUserByEmail } from './auth-users.js';
import { readBrevoConfig } from './brevo.js';
import { sendAndLogBrevoEmail } from './email-log.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildRecoveryRedirect(redirectTo, tokenHash) {
  const url = new URL(String(redirectTo || '').trim());
  const hashValue = String(url.hash || '#').replace(/^#/, '');
  const [rawHashPath, rawHashQuery = ''] = hashValue.split('?');
  const hashPath = rawHashPath || '/';
  const params = new URLSearchParams(rawHashQuery);
  params.set('token_hash', tokenHash);
  params.set('type', 'recovery');
  url.hash = `#${hashPath}${params.toString() ? `?${params.toString()}` : ''}`;
  return url.toString();
}

function buildPasswordResetHtml({ resetUrl }) {
  const safeResetUrl = escapeHtml(resetUrl);
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
  <body style="margin:0;padding:0;background:#f7fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1a202c;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">קישור מאובטח לעדכון הסיסמה שלך ב-Reinex</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7fafc;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
            <tr>
              <td style="padding:32px 40px 16px;text-align:right;">
                <h1 style="margin:0 0 16px;font-size:24px;line-height:1.4;">איפוס סיסמה</h1>
                <p style="margin:0 0 12px;font-size:16px;line-height:1.7;">התקבלה בקשה לעדכון הסיסמה שלך ב-Reinex.</p>
                <p style="margin:0;font-size:16px;line-height:1.7;">אם זו הייתה בקשה שלך, אפשר ללחוץ על הכפתור הבא כדי לבחור סיסמה חדשה.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:12px 40px 24px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="border-radius:8px;background:#2c5282;">
                      <a href="${safeResetUrl}" target="_blank" style="display:inline-block;background:#2c5282;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:16px;font-weight:600;border:1px solid #2c5282;">בחירת סיסמה חדשה</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 40px 16px;text-align:right;font-size:12px;line-height:1.8;color:#718096;">
                <p style="margin:0 0 8px;">אם הכפתור לא עובד, ניתן להעתיק את הקישור הבא לדפדפן:</p>
                <p dir="ltr" style="margin:0;word-break:break-all;color:#4a5568;">${safeResetUrl}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 40px 32px;text-align:right;font-size:12px;line-height:1.8;color:#718096;">
                <p style="margin:0;">אם לא ביקשת לאפס את הסיסמה, ניתן להתעלם מההודעה בבטחה.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildPasswordResetText({ resetUrl }) {
  return [
    'שלום,',
    '',
    'התקבלה בקשה לעדכון הסיסמה שלך ב-Reinex.',
    '',
    'אם זו הייתה בקשה שלך, אפשר לפתוח את הקישור הבא כדי לבחור סיסמה חדשה:',
    resetUrl,
    '',
    'אם לא ביקשת לאפס את הסיסמה, ניתן להתעלם מההודעה בבטחה.',
  ].join('\n');
}

export function canSendPasswordResetEmail(env) {
  const config = readBrevoConfig(env);
  return Boolean(config.apiKey && config.senderEmail);
}

export async function deliverPasswordResetEmail({
  supabase,
  env,
  context,
  email,
  redirectTo,
}) {
  if (!canSendPasswordResetEmail(env)) {
    throw new Error('brevo_not_configured');
  }

  const authUser = await findAuthUserByEmail(supabase, email);
  if (!authUser?.id) {
    return {
      emailSent: false,
      userExists: false,
      deliveryProvider: 'none',
    };
  }

  const linkResult = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: {
      redirectTo,
    },
  });

  if (linkResult.error) {
    throw linkResult.error;
  }

  const hashedToken = linkResult.data?.properties?.hashed_token;
  if (!hashedToken) {
    throw new Error('generate_link_missing_hashed_token');
  }

  const resetUrl = buildRecoveryRedirect(redirectTo, hashedToken);
  await sendAndLogBrevoEmail(
    supabase,
    {
      to: email,
      subject: 'איפוס סיסמה ב-Reinex',
      htmlContent: buildPasswordResetHtml({ resetUrl }),
      textContent: buildPasswordResetText({ resetUrl }),
      senderName: 'Reinex',
    },
    env,
    context,
    { emailType: 'password_reset' },
  );

  return {
    emailSent: true,
    userExists: true,
    deliveryProvider: 'brevo_password_recovery',
  };
}
