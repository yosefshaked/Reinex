/* eslint-env node */
import { sendBrevoEmail, readBrevoConfig } from './brevo.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInvitationExpiry(value) {
  if (!value) {
    return '';
  }

  try {
    return new Intl.DateTimeFormat('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jerusalem',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function buildInvitationHashRedirect(redirectTo, invitationToken, tokenHash) {
  const url = new URL(String(redirectTo || '').trim());
  const hashValue = String(url.hash || '#').replace(/^#/, '');
  const [rawHashPath, rawHashQuery = ''] = hashValue.split('?');
  const hashPath = rawHashPath || '/';
  const params = new URLSearchParams(rawHashQuery);
  params.set('token_hash', tokenHash);
  params.set('invitation_token', invitationToken);
  url.hash = `#${hashPath}${params.toString() ? `?${params.toString()}` : ''}`;
  return url.toString();
}

function buildInvitationEmailSubject({ organizationName }) {
  const orgName = String(organizationName || '').trim();
  return orgName ? `הוזמנת להצטרף ל-${orgName}` : 'הוזמנת להצטרף ל-Reinex';
}

function buildInvitationEmailText({
  inviterName,
  organizationName,
  inviteUrl,
  expiresAt,
}) {
  const orgName = String(organizationName || '').trim() || 'הארגון';
  const inviter = String(inviterName || '').trim() || 'מנהל המערכת';
  const formattedExpiry = formatInvitationExpiry(expiresAt);

  return [
    'שלום,',
    '',
    `${inviter} הזמין אותך להצטרף לארגון "${orgName}".`,
    '',
    'כדי לקבל את ההזמנה וליצור את החשבון, יש לפתוח את הקישור הבא:',
    inviteUrl,
    '',
    formattedExpiry ? `הקישור תקף עד ${formattedExpiry}.` : '',
    '',
    'אם לא ציפית לקבל הזמנה זו, ניתן להתעלם מההודעה בבטחה.',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildInvitationEmailHtml({
  inviterName,
  organizationName,
  inviteUrl,
  expiresAt,
}) {
  const orgName = escapeHtml(String(organizationName || '').trim() || 'הארגון');
  const inviter = escapeHtml(String(inviterName || '').trim() || 'מנהל המערכת');
  const safeInviteUrl = escapeHtml(inviteUrl);
  const formattedExpiry = escapeHtml(formatInvitationExpiry(expiresAt));

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
  <body style="margin:0;padding:0;background:#f7fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a202c;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7fafc;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
            <tr>
              <td style="padding:32px 40px 16px;text-align:right;">
                <h1 style="margin:0 0 16px;font-size:24px;line-height:1.4;">הוזמנת להצטרף</h1>
                <p style="margin:0 0 12px;font-size:16px;line-height:1.7;">${inviter} הזמין אותך להצטרף לארגון <strong>${orgName}</strong>.</p>
                <p style="margin:0;font-size:16px;line-height:1.7;">כדי לקבל את ההזמנה וליצור את החשבון, יש ללחוץ על הכפתור הבא.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:12px 40px 24px;">
                <a href="${safeInviteUrl}" target="_blank" style="display:inline-block;background:#2c5282;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:16px;font-weight:600;">קבלה והצטרפות לארגון</a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 40px 16px;text-align:right;font-size:12px;line-height:1.8;color:#718096;">
                <p style="margin:0 0 8px;">אם הכפתור לא עובד, ניתן להעתיק את הקישור הבא לדפדפן:</p>
                <p dir="ltr" style="margin:0;word-break:break-all;color:#4a5568;">${safeInviteUrl}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 40px 32px;text-align:right;font-size:12px;line-height:1.8;color:#718096;">
                <p style="margin:0;">${formattedExpiry ? `הקישור תקף עד ${formattedExpiry}. ` : ''}אם לא ציפית לקבל הזמנה זו, ניתן להתעלם מההודעה בבטחה.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function normalizeSupabaseGenerateLinkError(error) {
  if (!error) {
    return new Error('generate_link_failed');
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error?.message || error));
}

export function canSendBrevoInvitation(env) {
  const config = readBrevoConfig(env);
  return Boolean(config.apiKey && config.senderEmail);
}

export async function deliverInvitationEmail({
  supabase,
  env,
  context,
  email,
  redirectTo,
  invitationToken,
  inviteMetadata = {},
  inviterName = '',
  organizationName = '',
  expiresAt = '',
}) {
  const inviteOptions = {
    redirectTo,
    data: inviteMetadata,
  };

  const inviteResult = await supabase.auth.admin.inviteUserByEmail(email, inviteOptions);
  if (!inviteResult.error) {
    return {
      deliveryProvider: 'supabase',
      emailSent: true,
      fallbackUsed: false,
      fallbackReason: null,
    };
  }

  const fallbackReason = String(inviteResult.error.message || 'invite_user_by_email_failed');
  if (!canSendBrevoInvitation(env)) {
    throw inviteResult.error;
  }

  const linkResult = await supabase.auth.admin.generateLink({
    type: 'invite',
    email,
    options: inviteOptions,
  });

  if (linkResult.error) {
    throw normalizeSupabaseGenerateLinkError(linkResult.error);
  }

  const hashedToken = linkResult.data?.properties?.hashed_token;
  if (!hashedToken) {
    throw new Error('generate_link_missing_hashed_token');
  }

  const inviteUrl = buildInvitationHashRedirect(redirectTo, invitationToken, hashedToken);
  const subject = buildInvitationEmailSubject({ organizationName });
  const textContent = buildInvitationEmailText({
    inviterName,
    organizationName,
    inviteUrl,
    expiresAt,
  });
  const htmlContent = buildInvitationEmailHtml({
    inviterName,
    organizationName,
    inviteUrl,
    expiresAt,
  });

  await sendBrevoEmail(
    {
      to: email,
      subject,
      htmlContent,
      textContent,
      senderName: organizationName || 'Reinex',
    },
    env,
    context,
  );

  return {
    deliveryProvider: 'brevo_fallback',
    emailSent: true,
    fallbackUsed: true,
    fallbackReason,
  };
}
