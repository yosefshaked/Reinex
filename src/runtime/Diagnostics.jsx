import React, { useCallback, useEffect, useState } from 'react';
import { useRuntimeConfig } from './RuntimeConfigContext.jsx';
import { getRuntimeConfigDiagnostics } from './config.js';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';

// ─── Helpers ───────────────────────────────────────────────────────────────

function maskValue(value) {
  if (!value) return '—';
  const s = String(value).trim();
  if (s.length <= 4) return s;
  return `••••${s.slice(-4)}`;
}

function StatusPill({ status }) {
  const map = {
    ok:      { label: 'OK',      cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
    error:   { label: 'שגיאה',  cls: 'bg-red-100 text-red-800 border-red-300' },
    loading: { label: '...',     cls: 'bg-slate-100 text-slate-600 border-slate-300 animate-pulse' },
    skip:    { label: 'דולג',   cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  };
  const { label, cls } = map[status] ?? map.skip;
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function Row({ label, value, mono = false, status }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0">
      <dt className="shrink-0 text-sm text-slate-500">{label}</dt>
      <dd className={`text-end text-sm font-medium text-slate-900 ${mono ? 'font-mono' : ''}`}>
        {status !== undefined ? <StatusPill status={status} /> : null}
        {value !== undefined ? <span className="mr-2">{value}</span> : null}
      </dd>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-1">
      <h2 className="text-base font-semibold text-slate-800 mb-3">{title}</h2>
      <dl>{children}</dl>
    </section>
  );
}

// ─── Live check runner ──────────────────────────────────────────────────────

async function runChecks(token) {
  const base = '';           // relative — works both locally and on SWA
  const results = {};

  // 1. Health endpoint
  try {
    const r = await fetch(`${base}/api/health`, { cache: 'no-store' });
    const body = r.ok ? await r.json() : null;
    results.health = {
      status: r.ok ? 'ok' : 'error',
      httpStatus: r.status,
      timestamp: body?.timestamp || null,
      env: body?.env || null,
    };
  } catch (e) {
    results.health = { status: 'error', error: e.message };
  }

  // 2. Config endpoint
  try {
    const r = await fetch(`${base}/api/config`, { cache: 'no-store' });
    results.config = {
      status: r.ok ? 'ok' : 'error',
      httpStatus: r.status,
    };
  } catch (e) {
    results.config = { status: 'error', error: e.message };
  }

  // 3. Authenticated ping - only if we have a token
  if (token) {
    try {
      const r = await fetch(`${base}/api/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      results.authPing = {
        status: r.ok || r.status === 404 ? 'ok' : 'error',
        httpStatus: r.status,
      };
    } catch (e) {
      results.authPing = { status: 'error', error: e.message };
    }
  } else {
    results.authPing = { status: 'skip' };
  }

  return results;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Diagnostics() {
  const config = useRuntimeConfig();
  const diagSnapshot = getRuntimeConfigDiagnostics();
  const { user, session } = useAuth();
  const { activeOrgId, configStatus, tenantClientReady } = useOrg();

  const [checks, setChecks] = useState(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    try {
      const result = await runChecks(session?.access_token || null);
      setChecks(result);
    } finally {
      setRunning(false);
    }
  }, [session?.access_token]);

  // Auto-run once on mount
  useEffect(() => { run(); }, [run]);

  const isDev = Boolean(import.meta?.env?.DEV);
  const envChecks = checks?.health?.env || null;

  const REQUIRED_ENV = [
    { key: 'APP_SUPABASE_URL',               label: 'Supabase URL (control)' },
    { key: 'APP_SUPABASE_ANON_KEY',          label: 'Supabase anon key (control)' },
    { key: 'SUPABASE_SERVICE_ROLE_KEY',      label: 'Service role key' },
    { key: 'SECURITY_ENCRYPTION_SECRET',     label: 'הצפנת מפתחות ארגון (ראשי)' },
    { key: 'SECURITY_ENCRYPTION_SECRET_OLD', label: 'הצפנת מפתחות ארגון (סיבוב/גיבוי)' },
  ];

  return (
    <div className="max-w-2xl mx-auto py-10 px-4 space-y-5" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">אבחון מערכת</h1>
          <p className="text-sm text-slate-500 mt-0.5">בדיקות חיבור ותצורה בזמן ריצה</p>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {running ? 'בודק...' : '↻ הרץ בדיקות'}
        </button>
      </div>

      {/* ── Live checks ── */}
      <Section title="בדיקות חיות">
        <Row
          label="/api/health"
          status={checks ? checks.health?.status : 'loading'}
          value={checks?.health?.httpStatus ? `HTTP ${checks.health.httpStatus}` : undefined}
        />
        <Row
          label="/api/config"
          status={checks ? checks.config?.status : 'loading'}
          value={checks?.config?.httpStatus ? `HTTP ${checks.config.httpStatus}` : undefined}
        />
        <Row
          label="פינג מאומת (users/me)"
          status={checks ? checks.authPing?.status : 'loading'}
          value={checks?.authPing?.httpStatus ? `HTTP ${checks.authPing.httpStatus}` : undefined}
        />
        {checks?.health?.timestamp && (
          <Row label="שרת זמן" value={new Date(checks.health.timestamp).toLocaleString('he-IL')} />
        )}
      </Section>

      {/* ── Env vars checklist ── */}
      <Section title="משתני סביבה (Azure App Settings)">
        {REQUIRED_ENV.map(({ key, label }) => {
          const present = envChecks ? envChecks[key] : null;
          return (
            <Row
              key={key}
              label={label}
              mono
              status={
                envChecks === null
                  ? 'loading'
                  : present
                    ? 'ok'
                    : 'error'
              }
              value={key}
            />
          );
        })}
        {!envChecks && !running && checks && (
          <p className="text-xs text-slate-400 pt-1">
            הנתונים נטענים מ-/api/health — ייתכן שהפונקציה ישנה ולא מחזירה env עדיין.
          </p>
        )}
      </Section>

      {/* ── Runtime config ── */}
      <Section title="תצורת זמן ריצה">
        <Row
          label="מקור"
          value={config?.source === 'api' ? '/api/config' : config?.source === 'org-api' ? '/api/org/:id/keys' : '—'}
        />
        <Row label="Supabase URL" value={maskValue(config?.supabaseUrl)} mono />
        <Row label="Supabase anon key" value={maskValue(config?.supabaseAnonKey)} mono />
        {isDev && (
          <>
            <Row label="org_id בבקשה האחרונה" value={diagSnapshot.orgId || '—'} mono />
            <Row
              label="סטטוס HTTP אחרון (/api/org/:id/keys)"
              value={diagSnapshot.status !== null ? String(diagSnapshot.status) : '—'}
            />
          </>
        )}
      </Section>

      {/* ── Auth & Org ── */}
      <Section title="משתמש וארגון">
        <Row label="מחובר" value={user ? 'כן' : 'לא'} />
        {user && <Row label="אימייל" value={user.email || '—'} />}
        {user && <Row label="מזהה משתמש" value={user.id} mono />}
        <Row label="ארגון פעיל" value={activeOrgId || '—'} mono />
        <Row
          label="טעינת תצורת ארגון"
          status={
            configStatus === 'success'
              ? 'ok'
              : configStatus === 'error'
                ? 'error'
                : configStatus === 'loading'
                  ? 'loading'
                  : 'skip'
          }
          value={configStatus || '—'}
        />
        <Row label="לקוח Supabase ארגוני מוכן" value={tenantClientReady ? 'כן' : 'לא'} />
      </Section>

      {/* ── Build info ── */}
      <Section title="סביבת build">
        <Row label="סביבה" value={import.meta?.env?.MODE || '—'} />
        <Row label="dev mode" value={isDev ? 'כן' : 'לא'} />
        <Row label="BASE_URL" value={import.meta?.env?.BASE_URL || '/'} mono />
      </Section>

      <p className="text-xs text-center text-slate-400">
        דף זה נגיש רק לאחר התחברות אך לא דורש ארגון פעיל.
      </p>
    </div>
  );
}
