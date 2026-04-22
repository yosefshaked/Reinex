/* eslint-env node */
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

function buildDirectInvitationRedirect(redirectTo, invitationToken) {
  const url = new URL(String(redirectTo || '').trim());
  const hashValue = String(url.hash || '#').replace(/^#/, '');
  const [rawHashPath, rawHashQuery = ''] = hashValue.split('?');
  const hashPath = rawHashPath || '/';
  const params = new URLSearchParams(rawHashQuery);
  params.set('invitation_token', invitationToken);
  url.hash = `#${hashPath}${params.toString() ? `?${params.toString()}` : ''}`;
  return url.toString();
}

function buildInvitationEmailSubject({ organizationName, mode = 'auth_invite' }) {
  const orgName = String(organizationName || '').trim();
  if (mode === 'existing_user_org_invite') {
    return orgName ? `ממתינה לך הזמנה לארגון ${orgName}` : 'ממתינה לך הזמנה חדשה ב-Reinex';
  }
  return orgName ? `הוזמנת להצטרף ל-${orgName}` : 'הוזמנת להצטרף ל-Reinex';
}

function buildInvitationEmailText({
  inviterName,
  organizationName,
  inviteUrl,
  expiresAt,
  mode = 'auth_invite',
}) {
  const orgName = String(organizationName || '').trim() || 'הארגון';
  const inviter = String(inviterName || '').trim() || 'מנהל המערכת';
  const formattedExpiry = formatInvitationExpiry(expiresAt);
  const actionCopy = mode === 'existing_user_org_invite'
    ? 'כדי לקבל את ההזמנה ולהצטרף לארגון עם החשבון הקיים שלך, יש לפתוח את הקישור הבא:'
    : 'כדי לקבל את ההזמנה וליצור את החשבון, יש לפתוח את הקישור הבא:';

  return [
    'שלום,',
    '',
    `${inviter} הזמין אותך להצטרף לארגון "${orgName}".`,
    '',
    actionCopy,
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
  mode = 'auth_invite',
}) {
  const orgName = escapeHtml(String(organizationName || '').trim() || 'הארגון');
  const inviter = escapeHtml(String(inviterName || '').trim() || 'מנהל המערכת');
  const safeInviteUrl = escapeHtml(inviteUrl);
  const formattedExpiry = escapeHtml(formatInvitationExpiry(expiresAt));
  const preheader = escapeHtml(
    mode === 'existing_user_org_invite'
      ? `ממתינה לך הזמנה לארגון ${String(organizationName || '').trim() || 'ב-Reinex'}`
      : `הוזמנת להצטרף לארגון ${String(organizationName || '').trim() || 'ב-Reinex'}`,
  );
  const intro = mode === 'existing_user_org_invite'
    ? 'כדי לקבל את ההזמנה ולהצטרף לארגון עם החשבון הקיים שלך, יש ללחוץ על הכפתור הבא.'
    : 'כדי לקבל את ההזמנה וליצור את החשבון, יש ללחוץ על הכפתור הבא.';
  const buttonLabel = mode === 'existing_user_org_invite'
    ? 'צפייה בהזמנה והצטרפות'
    : 'קבלה והצטרפות לארגון';

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
  <body style="margin:0;padding:0;background:#f7fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1a202c;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7fafc;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
            <tr>
              <td style="padding:32px 40px 16px;text-align:right;">
                <h1 style="margin:0 0 16px;font-size:24px;line-height:1.4;">הוזמנת להצטרף</h1>
                <p style="margin:0 0 12px;font-size:16px;line-height:1.7;">${inviter} הזמין אותך להצטרף לארגון <strong>${orgName}</strong>.</p>
                <p style="margin:0;font-size:16px;line-height:1.7;">${escapeHtml(intro)}</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:12px 40px 24px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="border-radius:8px;background:#2c5282;">
                      <a href="${safeInviteUrl}" target="_blank" style="display:inline-block;background:#2c5282;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:16px;font-weight:600;border:1px solid #2c5282;">${escapeHtml(buttonLabel)}</a>
                    </td>
                  </tr>
                </table>
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
  mode = 'auth_invite',
}) {
  if (!canSendBrevoInvitation(env)) {
    throw new Error('brevo_not_configured');
  }

  if (mode === 'existing_user_org_invite') {
    const inviteUrl = buildDirectInvitationRedirect(redirectTo, invitationToken);
    const subject = buildInvitationEmailSubject({ organizationName, mode });
    const textContent = buildInvitationEmailText({
      inviterName,
      organizationName,
      inviteUrl,
      expiresAt,
      mode,
    });
    const htmlContent = buildInvitationEmailHtml({
      inviterName,
      organizationName,
      inviteUrl,
      expiresAt,
      mode,
    });

    await sendAndLogBrevoEmail(
      supabase,
      {
        to: email,
        subject,
        htmlContent,
        textContent,
        senderName: organizationName || 'Reinex',
      },
      env,
      context,
      { emailType: 'invitation_existing_user', metadata: { organizationName, mode } },
    );

    return {
      deliveryProvider: 'brevo_existing_user',
      emailSent: true,
      fallbackUsed: false,
      fallbackReason: null,
    };
  }

  const inviteOptions = {
    redirectTo,
    data: inviteMetadata,
  };

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
  const subject = buildInvitationEmailSubject({ organizationName, mode });
  const textContent = buildInvitationEmailText({
    inviterName,
    organizationName,
    inviteUrl,
    expiresAt,
    mode,
  });
  const htmlContent = buildInvitationEmailHtml({
    inviterName,
    organizationName,
    inviteUrl,
    expiresAt,
    mode,
  });

  await sendAndLogBrevoEmail(
    supabase,
    {
      to: email,
      subject,
      htmlContent,
      textContent,
      senderName: organizationName || 'Reinex',
    },
    env,
    context,
    { emailType: 'invitation_auth_invite', metadata: { organizationName, mode } },
  );

  return {
    deliveryProvider: 'brevo_auth_invite',
    emailSent: true,
    fallbackUsed: false,
    fallbackReason: null,
  };
}
