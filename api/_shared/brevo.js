/* eslint-env node */
import process from 'node:process';

function pick(source, keys) {
  if (!source || typeof source !== 'object') return '';
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function readSource(source) {
  if (source?.env && typeof source.env === 'object') {
    return source.env;
  }
  return source || {};
}

export function readBrevoConfig(source = {}) {
  const env = readSource(source);
  const procEnv = process?.env || {};

  const apiKey =
    pick(env, ['BREVO_API_KEY', 'APP_BREVO_API_KEY']) ||
    pick(procEnv, ['BREVO_API_KEY', 'APP_BREVO_API_KEY']);

  const senderEmail =
    pick(env, ['BREVO_SENDER_EMAIL', 'APP_BREVO_SENDER_EMAIL']) ||
    pick(procEnv, ['BREVO_SENDER_EMAIL', 'APP_BREVO_SENDER_EMAIL']);

  const senderName =
    pick(env, ['BREVO_SENDER_NAME', 'APP_BREVO_SENDER_NAME']) ||
    pick(procEnv, ['BREVO_SENDER_NAME', 'APP_BREVO_SENDER_NAME']) ||
    'Reinex';

  const baseUrl =
    pick(env, ['BREVO_BASE_URL', 'APP_BREVO_BASE_URL']) ||
    pick(procEnv, ['BREVO_BASE_URL', 'APP_BREVO_BASE_URL']) ||
    'https://api.brevo.com/v3';

  return {
    apiKey,
    senderEmail,
    senderName,
    baseUrl,
  };
}

export async function sendBrevoEmail({ to, subject, htmlContent, textContent, senderName }, source = {}, context = null) {
  const config = readBrevoConfig(source);

  if (!config.apiKey || !config.senderEmail) {
    throw new Error('brevo_not_configured');
  }

  const resolvedSenderName = String(senderName || '').trim() || config.senderName;

  const payload = {
    sender: {
      email: config.senderEmail,
      name: resolvedSenderName,
    },
    to: [{ email: String(to || '').trim() }],
    subject: String(subject || '').trim() || 'Reinex Notification',
    htmlContent: String(htmlContent || '').trim() || undefined,
    textContent: String(textContent || '').trim() || undefined,
  };

  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/smtp/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': config.apiKey,
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();
  let jsonData = null;
  try {
    jsonData = rawText ? JSON.parse(rawText) : null;
  } catch {
    jsonData = null;
  }

  if (!response.ok) {
    context?.log?.error?.('brevo send failed', {
      status: response.status,
      body: jsonData || rawText,
    });
    throw new Error(`brevo_send_failed_${response.status}`);
  }

  return jsonData || { success: true };
}
