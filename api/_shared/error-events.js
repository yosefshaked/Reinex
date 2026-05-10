/* eslint-env node */
import { randomBytes } from 'node:crypto';
import { respond } from './org-bff.js';

const RETENTION_DAYS = 90;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let lastCleanupAt = 0;

function normalizeStatus(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 500;
  return Math.min(599, Math.max(400, Math.floor(parsed)));
}

function normalizeString(value, fallback = '') {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

export function generateSupportCode(now = new Date()) {
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `ERR-${stamp}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function readHeader(req, name) {
  const headers = req?.headers || {};
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key];
  }
  return null;
}

function routeFromRequest(req) {
  const rawUrl = String(req?.url || req?.originalUrl || '');
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl, 'https://reinex.local');
    return parsed.pathname.replace(/^\/api\/?/, '') || parsed.pathname;
  } catch {
    return rawUrl.split('?')[0].replace(/^\/api\/?/, '');
  }
}

function sanitizeRequestContext(req) {
  return {
    path: routeFromRequest(req) || null,
    method: String(req?.method || '').toUpperCase() || null,
    user_agent: readHeader(req, 'user-agent') || null,
    forwarded_for: readHeader(req, 'x-forwarded-for') || null,
    request_id: readHeader(req, 'x-ms-client-request-id') || readHeader(req, 'x-request-id') || null,
  };
}

function serializeError(error) {
  if (!error) return {};
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || '',
      stack: error.stack || null,
      code: error.code || null,
      details: error.details || null,
      hint: error.hint || null,
    };
  }
  if (typeof error === 'object') {
    return {
      name: error.name || null,
      message: error.message || null,
      stack: error.stack || null,
      code: error.code || null,
      details: error.details || null,
      hint: error.hint || null,
      raw: error,
    };
  }
  return { message: String(error) };
}

function severityForStatus(status) {
  if (status >= 500) return 'error';
  if (status === 401 || status === 403) return 'warning';
  return 'info';
}

async function cleanupExpiredErrorEvents(context, supabase, now = new Date()) {
  const current = now.getTime();
  if (current - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = current;

  try {
    await supabase
      .from('error_events')
      .delete()
      .lt('expires_at', now.toISOString());
  } catch (error) {
    context?.log?.warn?.('error-events cleanup failed', { message: error?.message });
  }
}

export async function trackErrorEvent(context, req, supabase, options = {}) {
  const status = normalizeStatus(options.status);
  const now = options.now instanceof Date ? options.now : new Date();
  const supportCode = options.supportCode || generateSupportCode(now);
  const route = normalizeString(options.route, routeFromRequest(req));
  const method = normalizeString(options.method, String(req?.method || '').toUpperCase());
  const publicMessage = normalizeString(options.message, 'internal_error');
  const expiresAt = new Date(now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  if (!supabase?.from) {
    context?.log?.warn?.('error-events missing supabase client', { supportCode, publicMessage, status });
    return supportCode;
  }

  try {
    await cleanupExpiredErrorEvents(context, supabase, now);
    const { error } = await supabase.from('error_events').insert({
      support_code: supportCode,
      status,
      public_message: publicMessage,
      route: route || null,
      method: method || null,
      org_id: options.orgId || null,
      actor_user_id: options.userId || null,
      severity: options.severity || severityForStatus(status),
      request_context: {
        ...sanitizeRequestContext(req),
        ...(options.requestContext && typeof options.requestContext === 'object' ? options.requestContext : {}),
      },
      internal_error: serializeError(options.error),
      metadata: options.metadata && typeof options.metadata === 'object' ? options.metadata : {},
      created_at: now.toISOString(),
      expires_at: expiresAt,
    });
    if (error) throw error;
  } catch (error) {
    context?.log?.warn?.('error-events insert failed', {
      message: error?.message,
      supportCode,
      publicMessage,
      status,
    });
  }

  return supportCode;
}

export async function respondTrackedError(context, req, supabase, options = {}) {
  const status = normalizeStatus(options.status);
  const message = normalizeString(options.message, 'internal_error');
  const errorId = await trackErrorEvent(context, req, supabase, {
    ...options,
    status,
    message,
  });
  return respond(context, status, { message, error_id: errorId });
}

