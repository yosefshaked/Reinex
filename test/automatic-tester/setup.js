#!/usr/bin/env node
/**
 * setup.js — Reinex Automatic Tester: One-Command Setup
 *
 * Connects to Docker / Supabase to discover credentials automatically,
 * creates isolated test accounts, builds a test organisation, and writes
 * test/automatic-tester/.env so you never have to fill it in manually.
 *
 * Prerequisites:
 *   • Node 18+  (uses built-in fetch)
 *   • Supabase local stack running  (supabase start)
 *   • The Reinex app running        (npm run dev  or  swa start)
 *
 * Usage:
 *   node setup.js                  — auto-discover + create everything
 *   node setup.js --dry-run        — show what would happen, write nothing
 *   node setup.js --reset          — delete existing test data first, then re-create
 *   node setup.js --password <pw>  — override default test password
 */

import { execSync, spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { writeFile as writeFileAsync } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import os from 'os';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT   = join(__dirname, '..', '..');
const ENV_PATH    = join(__dirname, '.env');

// ─── CLI flags ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry-run');
const RESET    = args.includes('--reset');
const PW_IDX   = args.indexOf('--password');
const PASSWORD = PW_IDX !== -1 && args[PW_IDX + 1]
  ? args[PW_IDX + 1]
  : 'TestReinex!1';

const TEST_ORG_NAME    = 'Reinex Test Org (auto)';
const TEST_USER_SUFFIX = '@reinex-test.local';
const TEST_USERS = [
  { key: 'admin',      email: `admin-test${TEST_USER_SUFFIX}`,      role: 'admin',  firstName: 'Admin',      lastName: 'Test', phone: '0500000001', identityNumber: '000000001' },
  { key: 'office',     email: `office-test${TEST_USER_SUFFIX}`,     role: 'office', firstName: 'Office',     lastName: 'Test', phone: '0500000002', identityNumber: '000000002' },
  { key: 'instructor', email: `instructor-test${TEST_USER_SUFFIX}`, role: 'member', firstName: 'Instructor', lastName: 'Test', phone: '0500000003', identityNumber: '000000003' },
];

// ─── Colours ──────────────────────────────────────────────────────────────

const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  grey:   s => `\x1b[90m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
};

function step(msg)   { console.log(`  ${C.cyan('→')} ${msg}`); }
function ok(msg)     { console.log(`  ${C.green('✓')} ${msg}`); }
function warn(msg)   { console.log(`  ${C.yellow('⚠')} ${msg}`); }
function fail(msg)   { console.error(`  ${C.red('✗')} ${msg}`); }
function section(msg){ console.log(`\n${C.bold(msg)}`); }

// ─── HTTP helpers (no extra deps — just fetch) ────────────────────────────

function supabaseHeaders(key, extra = {}) {
  return {
    'Authorization': `Bearer ${key}`,
    'apikey': key,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function supabaseGet(url, key, path, params = {}) {
  const qs = Object.entries(params).length
    ? '?' + new URLSearchParams(params).toString()
    : '';
  const res = await fetch(`${url}${path}${qs}`, {
    headers: supabaseHeaders(key),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function supabasePost(url, key, path, body, extraHeaders = {}) {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: supabaseHeaders(key, extraHeaders),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function supabaseUpsert(url, key, path, body, conflictCols) {
  const separator = path.includes('?') ? '&' : '?';
  const upsertPath = conflictCols
    ? `${path}${separator}on_conflict=${encodeURIComponent(conflictCols)}`
    : path;
  const res = await fetch(`${url}${upsertPath}`, {
    method: 'POST',
    headers: supabaseHeaders(key, {
      'Prefer': `return=representation,resolution=merge-duplicates`,
    }),
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 409) {
    const text = await res.text();
    throw new Error(`UPSERT ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  const text = await res.text();
  try { return JSON.parse(text); } catch { return {}; }
}

async function supabaseDelete(url, key, path, filterParam) {
  const res = await fetch(`${url}${path}?${filterParam}`, {
    method: 'DELETE',
    headers: supabaseHeaders(key),
  });
  return res.ok;
}

// ─── 1. Discover Supabase config ──────────────────────────────────────────

async function discoverSupabaseConfig() {
  section('── Step 1 / 5  Discover Supabase Configuration');

  // ── Priority 1: api/local.settings.json ──────────────────────────────

  const localSettings = join(REPO_ROOT, 'api', 'local.settings.json');
  if (existsSync(localSettings)) {
    try {
      const parsed = JSON.parse(readFileSync(localSettings, 'utf8'));
      const vals = parsed.Values || {};
      if (vals.SUPABASE_URL && vals.SUPABASE_SERVICE_ROLE_KEY) {
        ok(`Found api/local.settings.json`);
        return {
          supabaseUrl:    vals.SUPABASE_URL,
          serviceRoleKey: vals.SUPABASE_SERVICE_ROLE_KEY,
          anonKey:        vals.SUPABASE_ANON_KEY || '',
          source:         'local.settings.json',
        };
      }
    } catch (e) {
      warn(`Could not parse api/local.settings.json: ${e.message}`);
    }
  }

  // ── Priority 2: supabase CLI ──────────────────────────────────────────

  step('Trying `supabase status` CLI...');
  try {
    const raw = execSync('supabase status --output json 2>/dev/null || supabase status 2>/dev/null', {
      encoding: 'utf8',
      timeout: 8000,
      cwd: REPO_ROOT,
    });

    // Try JSON parse first
    try {
      const json = JSON.parse(raw.trim());
      const supabaseUrl = json.API_URL || json.api_url || json.SUPABASE_URL;
      const serviceRoleKey = json.SERVICE_ROLE_KEY || json.service_role_key;
      const anonKey = json.ANON_KEY || json.anon_key || '';
      if (supabaseUrl && serviceRoleKey) {
        ok('Discovered via `supabase status` (JSON)');
        return { supabaseUrl, serviceRoleKey, anonKey, source: 'supabase-cli' };
      }
    } catch { /* not JSON — try text parsing */ }

    // Parse text output — handles both old format ("service_role key: <jwt>")
    // and new format ("Secret: sb_secret_..." / "Project URL: http://...")
    const apiMatch    = raw.match(/Project URL[:\s]+(https?:\/\/[^\s\n]+)/im)
                     || raw.match(/API URL[:\s]+(https?:\/\/[^\s\n]+)/im);
    // New key format (Supabase CLI v2+): "Secret      │ sb_secret_..."
    const srkNewMatch = raw.match(/Secret\s*[│|]\s*(sb_secret_\S+)/i)
                     || raw.match(/\bsb_secret_(\S+)/i);
    // Old key format: "service_role key: <jwt>"
    const srkOldMatch = raw.match(/service_role key[:\s]+([^\s\n]+)/i);
    const srkMatch    = srkNewMatch || srkOldMatch;
    const anonMatch   = raw.match(/Publishable\s*[│|]\s*(sb_publishable_\S+)/i)
                     || raw.match(/anon key[:\s]+([^\s\n]+)/i);

    if (apiMatch && srkMatch) {
      ok('Discovered via `supabase status` (text)');
      const serviceRoleKey = srkNewMatch
        ? (srkNewMatch[0].match(/sb_secret_\S+/)?.[0] ?? srkNewMatch[1])
        : srkOldMatch[1];
      return {
        supabaseUrl:    apiMatch[1].trim(),
        serviceRoleKey: serviceRoleKey.trim(),
        anonKey:        anonMatch
          ? (anonMatch[0].match(/sb_publishable_\S+/)?.[0] ?? anonMatch[1]).trim()
          : '',
        source:         'supabase-cli',
      };
    }
  } catch { /* CLI not installed or not running */ }

  // ── Priority 3: Docker container inspection ───────────────────────────

  step('Trying Docker container inspection...');
  try {
    const psOut = execSync('docker ps --format "{{.Names}}" 2>/dev/null', {
      encoding: 'utf8',
      timeout: 5000,
    });

    const containers = psOut.split('\n').filter(Boolean);
    const kongContainer = containers.find(n => n.includes('supabase_kong') || n.includes('supabase-kong'));
    const dbContainer   = containers.find(n => n.includes('supabase_db') || n.includes('supabase-db'));

    if (!kongContainer && !dbContainer) {
      warn('No Supabase Docker containers found running');
    } else {
      // Try to extract env from Kong container
      const target = kongContainer || dbContainer;
      const inspectRaw = execSync(`docker inspect ${target} 2>/dev/null`, {
        encoding: 'utf8', timeout: 5000
      });
      const inspect = JSON.parse(inspectRaw);
      const envVars = (inspect[0]?.Config?.Env || []).reduce((acc, kv) => {
        const [k, ...v] = kv.split('=');
        acc[k] = v.join('=');
        return acc;
      }, {});

      // Try to get port bindings for the API
      const portBindings = inspect[0]?.NetworkSettings?.Ports || {};
      const apiPort = Object.entries(portBindings)
        .filter(([p]) => p.startsWith('8000') || p.startsWith('8080') || p.startsWith('9000'))
        .map(([, bindings]) => bindings?.[0]?.HostPort)
        .find(Boolean);

      const supabaseUrl = apiPort ? `http://127.0.0.1:${apiPort}` : null;
      const serviceRoleKey = envVars.SUPABASE_SERVICE_ROLE_KEY || envVars.SERVICE_ROLE_KEY;
      const anonKey = envVars.SUPABASE_ANON_KEY || envVars.ANON_KEY || '';

      if (supabaseUrl && serviceRoleKey) {
        ok(`Discovered via Docker container: ${target}`);
        return { supabaseUrl, serviceRoleKey, anonKey, source: 'docker' };
      }

      warn('Docker containers found but could not extract Supabase config from them');
    }
  } catch (e) {
    warn(`Docker inspection failed: ${e.message.split('\n')[0]}`);
  }

  // ── Failed ────────────────────────────────────────────────────────────

  fail('Could not auto-discover Supabase configuration.');
  console.log(`
  Manual fix options:
    1. Ensure Supabase is running:  supabase start
    2. Or check that api/local.settings.json contains SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
    3. Or run: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node setup.js
  `);
  return null;
}

// ─── 2. Probe app URL ─────────────────────────────────────────────────────

async function probeAppUrl() {
  section('── Step 2 / 5  Detect Running App');

  // Detect the React app by checking that the root URL serves the Reinex HTML shell
  // (contains <div id="root">). This works whether Vite (5173) or SWA (4280) is running,
  // and does NOT depend on the /api proxy being configured — that's irrelevant for navigation.
  // Try IPv6 variants because Vite on Windows often binds to [::1] only.
  const candidates = [
    'http://localhost:5173',   // Vite dev server — preferred (faster)
    'http://127.0.0.1:5173',
    'http://[::1]:5173',       // Vite on IPv6-only
    'http://localhost:5174',   // Vite alternate port
    'http://127.0.0.1:5174',
    'http://[::1]:5174',
    'http://localhost:4280',   // SWA emulator — fallback (serves app + API on one port)
    'http://127.0.0.1:4280',
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(`${url}/`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('text/html')) {
          const body = await res.text();
          // Confirm this is the Reinex React app shell, not some other server
          if (body.includes('<div id="root">')) {
            const friendly = url.replace('http://[::1]:', 'http://localhost:');
            ok(`App is running at ${friendly}`);
            return friendly;
          }
        }
      }
    } catch { /* not available */ }
  }

  warn('Reinex app (React shell) not found on any common port.');
  warn('Start it:  npm run dev   (in the repo root)');
  warn('Then re-run setup.js. Writing .env with default URL for now.');
  return 'http://localhost:5173';
}

// ─── 3. Schema check and apply ────────────────────────────────────────────

// Tables that must exist after setup-sql.js runs (both tenant and control tables).
const SCHEMA_PROBE_TABLES = [
  'client_profiles',
  'lesson_instances',
  'lesson_templates',
  'commitments',
  'ledger_transactions',
  'profiles',
  'organizations',
  'org_memberships',
  'instructor_breaks',
];

// Specific columns that were added in later versions of setup-sql.js.
// If any are missing the SQL needs to re-run even if the table exists.
const SCHEMA_PROBE_COLUMNS = [
  { table: 'profiles', column: 'account_status' },
  { table: 'profiles', column: 'setup_completed_at' },
  { table: 'profiles', column: 'is_system_admin' },
];

// ── Direct DB probes via psql (bypasses PostgREST cache) ─────────────────

function psqlQuery(dbContainer, sql) {
  const result = spawnSync(
    'docker',
    ['exec', '-i', dbContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql],
    { encoding: 'utf8', timeout: 10_000 }
  );
  if (result.status !== 0) throw new Error(result.stderr || 'psql failed');
  return result.stdout.trim();
}

function checkTableExistsPsql(dbContainer, table) {
  try {
    const out = psqlQuery(
      dbContainer,
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='${table}';`
    );
    return out === '1';
  } catch { return false; }
}

function checkColumnExistsPsql(dbContainer, table, column) {
  try {
    const out = psqlQuery(
      dbContainer,
      `SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' AND column_name='${column}';`
    );
    return out === '1';
  } catch { return false; }
}

// ── PostgREST probes (fallback when Docker is unavailable) ────────────────

async function checkTableExistsREST(supabaseUrl, serviceKey, table) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/${table}?limit=0`, {
      headers: supabaseHeaders(serviceKey),
      signal: AbortSignal.timeout(4000),
    });
    return res.status !== 404 && res.status !== 400;
  } catch {
    return false;
  }
}

async function checkColumnExistsREST(supabaseUrl, serviceKey, table, column) {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/${table}?select=${column}&limit=0`,
      { headers: supabaseHeaders(serviceKey), signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      // PGRST204 = column not found in schema cache
      // 42703 = PostgreSQL undefined_column
      return !(body?.code === 'PGRST204' || body?.code === 'PGRST116' || body?.code === '42703');
    }
    return true;
  } catch {
    return false;
  }
}

async function checkSchemaApplied(supabaseUrl, serviceKey) {
  // Prefer direct psql check — immune to PostgREST cache staleness
  const dbContainer = findDbContainer(supabaseUrl);

  let missingTables, missingColumns;

  if (dbContainer) {
    missingTables = SCHEMA_PROBE_TABLES.filter(t => !checkTableExistsPsql(dbContainer, t));
    missingColumns = SCHEMA_PROBE_COLUMNS
      .filter(({ table, column }) => !checkColumnExistsPsql(dbContainer, table, column))
      .map(({ table, column }) => `${table}.${column}`);
  } else {
    // Fallback: query PostgREST
    const tableResults = await Promise.all(
      SCHEMA_PROBE_TABLES.map(t => checkTableExistsREST(supabaseUrl, serviceKey, t))
    );
    missingTables = SCHEMA_PROBE_TABLES.filter((_, i) => !tableResults[i]);

    const columnResults = await Promise.all(
      SCHEMA_PROBE_COLUMNS.map(({ table, column }) =>
        checkColumnExistsREST(supabaseUrl, serviceKey, table, column)
      )
    );
    missingColumns = SCHEMA_PROBE_COLUMNS
      .filter((_, i) => !columnResults[i])
      .map(({ table, column }) => `${table}.${column}`);
  }

  const missing = [
    ...missingTables,
    ...missingColumns.map(c => `column:${c}`),
  ];
  return { applied: missing.length === 0, missing };
}

function findDbContainer(supabaseUrl = null) {
  try {
    // Fetch names + port bindings in one call
    const psOut = execSync('docker ps --format "{{.Names}}\\t{{.Ports}}"', { encoding: 'utf8', timeout: 5000 });
    const lines = psOut.split('\n').filter(Boolean);
    const names = lines.map(l => l.split('\t')[0].trim());

    // When we know the Supabase URL, match via Kong container port → project name → DB container
    if (supabaseUrl) {
      try {
        const urlPort = new URL(supabaseUrl).port;
        if (urlPort) {
          const kongLine = lines.find(l =>
            /supabase[_-]kong/i.test(l.split('\t')[0]) &&
            l.includes(`:${urlPort}->`)
          );
          if (kongLine) {
            const kongName = kongLine.split('\t')[0].trim();
            // supabase_kong_<project>  →  <project>
            const projectName = kongName.replace(/^supabase[_-]kong[_-]/i, '');
            const dbName = names.find(n =>
              n === `supabase_db_${projectName}` || n === `supabase-db-${projectName}`
            );
            if (dbName) return dbName;
          }
        }
      } catch { /* URL parse failed — fall through */ }
    }

    // Fallback: first supabase_db container found
    return names.find(n => /supabase[_-]db/i.test(n)) || null;
  } catch {
    return null;
  }
}

async function applySchema(supabaseUrl) {
  // Load the SQL from the repo's SSOT
  const sqlModulePath = join(REPO_ROOT, 'src', 'lib', 'setup-sql.js');
  if (!existsSync(sqlModulePath)) {
    throw new Error(`setup-sql.js not found at ${sqlModulePath}`);
  }

  // Dynamically import the module to get SETUP_SQL_SCRIPT
  step('Loading SQL from src/lib/setup-sql.js ...');
  let sql;
  try {
    const mod = await import(pathToFileURL(sqlModulePath).href);
    sql = mod.SETUP_SQL_SCRIPT;
    if (typeof sql !== 'string' || sql.length < 100) {
      throw new Error('SETUP_SQL_SCRIPT is empty or not a string');
    }
  } catch (e) {
    throw new Error(`Failed to import setup-sql.js: ${e.message}`);
  }
  ok(`SQL loaded (${Math.round(sql.length / 1024)} KB)`);

  // ── Try method 1: Docker exec into the Supabase postgres container ──────
  const dbContainer = findDbContainer(supabaseUrl);
  if (dbContainer) {
    step(`Applying schema via Docker container: ${dbContainer} ...`);
    try {
      const result = spawnSync(
        'docker',
        ['exec', '-i', dbContainer, 'psql', '-U', 'postgres', '-d', 'postgres'],
        {
          input: sql,
          encoding: 'utf8',
          timeout: 120_000,   // 2 min — the script is large
          maxBuffer: 64 * 1024 * 1024,
        }
      );
      if (result.status === 0) {
        const stdout = (result.stdout || '').trim();
        if (stdout) {
          // Print last few lines of psql output so errors are visible
          const lines = stdout.split('\n').filter(Boolean);
          const tail = lines.slice(-10).join('\n');
          step(`psql output (last 10 lines):\n${tail}`);
        }
        ok('Schema applied via Docker');
        return;
      }
      const errText = (result.stderr || result.stdout || '').slice(0, 500);
      warn(`Docker exec returned code ${result.status}: ${errText}`);
    } catch (e) {
      warn(`Docker exec failed: ${e.message}`);
    }
  }

  // ── Try method 2: supabase CLI ────────────────────────────────────────
  step('Trying Supabase CLI ...');
  try {
    // Write SQL to a temp file so the CLI can read it
    const tmpPath = join(os.tmpdir(), `reinex-schema-${Date.now()}.sql`);
    await writeFileAsync(tmpPath, sql, 'utf8');

    const result = spawnSync(
      'supabase',
      ['db', 'execute', '--local', '--file', tmpPath],
      { encoding: 'utf8', timeout: 120_000, cwd: REPO_ROOT }
    );

    // Cleanup temp file
    try { rmSync(tmpPath, { force: true }); } catch { /* ignore cleanup errors */ }

    if (result.status === 0) {
      ok('Schema applied via Supabase CLI');
      return;
    }
    warn(`supabase db execute returned code ${result.status}: ${(result.stderr || '').slice(0, 300)}`);
  } catch (e) {
    warn(`Supabase CLI not available: ${e.message.split('\n')[0]}`);
  }

  // ── Fallback: save file + instructions ────────────────────────────────
  const fallbackPath = join(os.tmpdir(), 'reinex-schema.sql');
  await writeFileAsync(fallbackPath, sql, 'utf8');

  throw new Error(
    `Could not apply schema automatically.\n\n` +
    `  SQL has been saved to: ${fallbackPath}\n\n` +
    `  Run it manually with one of:\n` +
    `    docker exec -i <supabase_db_container> psql -U postgres -d postgres < "${fallbackPath}"\n` +
    `    supabase db execute --local --file "${fallbackPath}"\n` +
    `    psql $DATABASE_URL -f "${fallbackPath}"\n\n` +
    `  Then re-run: node setup.js`
  );
}

async function checkAndApplySchema(supabaseUrl, serviceKey) {
  section('── Step 2 / 7  Verify Tenant Database Schema');

  const { applied, missing } = await checkSchemaApplied(supabaseUrl, serviceKey);

  if (applied) {
    ok(`Schema is up to date (all ${SCHEMA_PROBE_TABLES.length} core tables present)`);
    return;
  }

  warn(`Missing tables: ${missing.join(', ')}`);
  step('Running setup-sql.js against the database...');

  if (DRY_RUN) {
    warn('[dry-run] Would apply schema from src/lib/setup-sql.js');
    return;
  }

  await applySchema(supabaseUrl);

  // Tell PostgREST to reload its schema cache so new columns are visible immediately
  step('Reloading PostgREST schema cache...');
  const dbContainer = findDbContainer(supabaseUrl);
  if (dbContainer) {
    try {
      spawnSync(
        'docker',
        ['exec', '-i', dbContainer, 'psql', '-U', 'postgres', '-d', 'postgres',
         '-c', "NOTIFY pgrst, 'reload schema';"],
        { encoding: 'utf8', timeout: 10_000 }
      );
      ok('PostgREST schema cache reloaded');
    } catch {
      warn('Could not reload PostgREST cache via Docker — waiting 6s for auto-reload');
    }
  } else {
    warn('No DB container found — waiting 6s for PostgREST auto-reload');
  }

  // Give PostgREST time to process the NOTIFY and reload its schema cache
  step('Waiting 6s for PostgREST to reload...');
  await new Promise(r => setTimeout(r, 6000));

  // Verify after applying — retry up to 3 times in case PostgREST is slow
  let after = { applied: false, missing: [] };
  for (let attempt = 1; attempt <= 3; attempt++) {
    after = await checkSchemaApplied(supabaseUrl, serviceKey);
    if (after.applied) break;
    if (attempt < 3) {
      step(`Probe attempt ${attempt}/3 — still missing: ${after.missing.join(', ')} — retrying in 3s...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  if (!after.applied) {
    throw new Error(
      `Schema was applied but these items are still missing: ${after.missing.join(', ')}\n` +
      `Check the psql output above for SQL errors.`
    );
  }
  ok('Schema verified after apply');
}

// ─── 4. Manage test users ─────────────────────────────────────────────────

async function listAuthUsers(supabaseUrl, serviceKey) {
  try {
    const data = await supabaseGet(supabaseUrl, serviceKey, '/auth/v1/admin/users', { per_page: 1000 });
    return Array.isArray(data?.users) ? data.users : (Array.isArray(data) ? data : []);
  } catch {
    return [];
  }
}

async function createOrFindUser(supabaseUrl, serviceKey, { email, firstName, lastName }) {
  const existing = await listAuthUsers(supabaseUrl, serviceKey);
  const found = existing.find(u => u.email?.toLowerCase() === email.toLowerCase());

  if (found) {
    ok(`User already exists: ${email}  ${C.grey('(id: ' + found.id.slice(0, 8) + '...)')}`);
    return found.id;
  }

  const { ok: created, status, data } = await supabasePost(
    supabaseUrl, serviceKey,
    '/auth/v1/admin/users',
    {
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName },
    }
  );

  if (!created || !data?.id) {
    throw new Error(`Failed to create user ${email}: ${status} ${JSON.stringify(data)}`);
  }

  ok(`Created user: ${email}  ${C.grey('(id: ' + data.id.slice(0, 8) + '...)')}`);
  return data.id;
}

async function deleteTestUsers(supabaseUrl, serviceKey) {
  const existing = await listAuthUsers(supabaseUrl, serviceKey);
  for (const user of TEST_USERS) {
    const found = existing.find(u => u.email?.toLowerCase() === user.email.toLowerCase());
    if (found) {
      const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${found.id}`, {
        method: 'DELETE',
        headers: supabaseHeaders(serviceKey),
      });
      if (res.ok) {
        ok(`Deleted user: ${found.email}`);
      }
    }
  }
}

// ─── 4. Ensure profile rows are marked setup-complete ─────────────────────

async function ensureProfileComplete(supabaseUrl, serviceKey, userId, { firstName, lastName, phone, identityNumber }) {
  const now = new Date().toISOString();
  await supabaseUpsert(supabaseUrl, serviceKey, '/rest/v1/profiles', {
    id: userId,
    first_name: firstName,
    last_name: lastName,
    phone,
    identity_number: identityNumber,
    setup_completed_at: now,
    account_status: 'active',
    updated_at: now,
  }, 'id');
}

// ─── 5. Create test org and memberships ───────────────────────────────────

async function findExistingTestOrg(supabaseUrl, serviceKey) {
  try {
    const data = await supabaseGet(
      supabaseUrl, serviceKey,
      '/rest/v1/organizations',
      { name: `eq.${TEST_ORG_NAME}`, select: 'id,name' }
    );
    const arr = Array.isArray(data) ? data : [];
    return arr[0]?.id || null;
  } catch {
    return null;
  }
}

async function ensureOrgVerified(supabaseUrl, serviceKey, orgId) {
  const now = new Date().toISOString();
  const res = await fetch(`${supabaseUrl}/rest/v1/organizations?id=eq.${orgId}`, {
    method: 'PATCH',
    headers: supabaseHeaders(serviceKey, { 'Prefer': 'return=minimal' }),
    body: JSON.stringify({ verified_at: now, updated_at: now }),
  });
  if (!res.ok) {
    const text = await res.text();
    warn(`Could not set verified_at on org: ${res.status} ${text.slice(0, 200)}`);
  } else {
    ok('Organisation verified_at set');
  }
}

async function createOrg(supabaseUrl, serviceKey, adminUserId) {
  const existing = await findExistingTestOrg(supabaseUrl, serviceKey);
  if (existing) {
    ok(`Organisation already exists  ${C.grey('(id: ' + existing.slice(0, 8) + '...)')}`);
    await ensureOrgVerified(supabaseUrl, serviceKey, existing);
    return existing;
  }

  const now = new Date().toISOString();
  const slug = TEST_ORG_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const res = await supabaseUpsert(supabaseUrl, serviceKey, '/rest/v1/organizations', {
    name: TEST_ORG_NAME,
    slug,
    verified_at: now,
    created_by: adminUserId,
    created_at: now,
    updated_at: now,
  });

  const orgId = Array.isArray(res) ? res[0]?.id : res?.id;
  if (!orgId) {
    throw new Error(`Failed to create organisation. Response: ${JSON.stringify(res)}`);
  }

  ok(`Created organisation: "${TEST_ORG_NAME}"  ${C.grey('(id: ' + orgId.slice(0, 8) + '...)')}`);
  return orgId;
}

async function ensureMembership(supabaseUrl, serviceKey, orgId, userId, role) {
  const now = new Date().toISOString();
  await supabaseUpsert(supabaseUrl, serviceKey, '/rest/v1/org_memberships', {
    org_id: orgId,
    user_id: userId,
    role,
    created_at: now,
  });
}

async function deleteTestOrg(supabaseUrl, serviceKey) {
  const orgId = await findExistingTestOrg(supabaseUrl, serviceKey);
  if (!orgId) return;

  // Clean up dependent tables first
  const deps = [
    'ledger_transactions', 'lesson_earnings', 'commitments',
    'lesson_instances', 'lesson_templates', 'students',
    'client_profiles', 'Employees', 'Services', 'forms',
    'org_memberships',
  ];
  for (const table of deps) {
    await supabaseDelete(supabaseUrl, serviceKey, `/rest/v1/${table}`, `org_id=eq.${orgId}`).catch(() => { /* ignore cleanup errors */ });
  }
  await supabaseDelete(supabaseUrl, serviceKey, '/rest/v1/organizations', `id=eq.${orgId}`).catch(() => { /* ignore cleanup errors */ });
  ok(`Deleted test organisation`);
}

// ─── HTTP API availability check ─────────────────────────────────────────

async function fetchWithTimeout(url, options = {}, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Quick check: can we reach the Supabase HTTP API paths used by setup?
 * On Windows with Docker Desktop + WSL2, port-forwarding sometimes silently
 * drops HTTP traffic even though the port appears open in netstat.
 *
 * PostgREST may be healthy while Auth is degraded. In that case the setup user
 * creation step would fail later, so include an Auth admin probe up front.
 *
 * @returns {Promise<boolean>}
 */
async function isHttpApiWorking(supabaseUrl, serviceKey) {
  try {
    await fetchWithTimeout(`${supabaseUrl}/rest/v1/`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
  } catch (error) {
    warn(`PostgREST probe failed: ${error?.message || error}`);
    return false;
  }

  try {
    const res = await fetchWithTimeout(`${supabaseUrl}/auth/v1/admin/users?per_page=1`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (res.ok) return true;

    const body = await res.text().catch(() => '');
    warn(`Auth admin probe failed: HTTP ${res.status} ${body.slice(0, 160)}`);
    return false;
  } catch (error) {
    warn(`Auth admin probe failed: ${error?.message || error}`);
    return false;
  }
}

// ─── SQL-based fallback helpers ───────────────────────────────────────────
//
// These functions bypass the HTTP API entirely by running SQL directly
// inside the Supabase PostgreSQL Docker container via `docker exec`.
// Used automatically when Kong/HTTP is not reachable from the host (common
// on Windows + Docker Desktop + WSL2 due to port-forwarding limitations).

function escapeSql(s) {
  return String(s ?? '').replace(/'/g, "''");
}

/**
 * Create (or find) an auth user by running SQL inside the DB container.
 * Returns the user's UUID string.
 */
function createOrFindUserViaSQL(dbContainer, { email, password, firstName, lastName }) {
  const e = escapeSql;

  // Check if user already exists
  const existingId = psqlQuery(
    dbContainer,
    `SELECT id::text FROM auth.users WHERE email = '${e(email)}' LIMIT 1;`
  ).trim();

  if (existingId) {
    ok(`User already exists: ${email}  ${C.grey('(id: ' + existingId.slice(0, 8) + '...)')}`);
    return existingId;
  }

  // Insert into auth.users
  const userId = psqlQuery(
    dbContainer,
    `INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data
      ) VALUES (
        gen_random_uuid(),
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated',
        '${e(email)}',
        crypt('${e(password)}', gen_salt('bf')),
        NOW(), NOW(), NOW(),
        '{"provider":"email","providers":["email"]}',
        '{"first_name":"${e(firstName)}","last_name":"${e(lastName)}"}'
      ) RETURNING id::text;`
  ).trim();

  if (!userId) throw new Error(`SQL user creation returned no id for ${email}`);

  // Insert into auth.identities (required for email/password login)
  psqlQuery(
    dbContainer,
    `INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
      VALUES (
        gen_random_uuid(), '${e(userId)}', '${e(email)}', 'email',
        ('{"sub":"' || '${e(userId)}' || '","email":"${e(email)}"}')::jsonb,
        NOW(), NOW()
      ) ON CONFLICT DO NOTHING;`
  );

  ok(`Created user: ${email}  ${C.grey('(id: ' + userId.slice(0, 8) + '...)')}`);
  return userId;
}

/**
 * Upsert a profile row to mark the user's account setup as complete.
 */
function ensureProfileCompleteViaSQL(dbContainer, userId, { firstName, lastName, phone, identityNumber }) {
  const e = escapeSql;
  psqlQuery(
    dbContainer,
    `INSERT INTO public.profiles (id, first_name, last_name, phone, identity_number,
        setup_completed_at, account_status, updated_at)
      VALUES (
        '${e(userId)}', '${e(firstName)}', '${e(lastName)}', '${e(phone)}', '${e(identityNumber)}',
        NOW(), 'active', NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        first_name          = EXCLUDED.first_name,
        last_name           = EXCLUDED.last_name,
        phone               = EXCLUDED.phone,
        identity_number     = EXCLUDED.identity_number,
        setup_completed_at  = COALESCE(profiles.setup_completed_at, NOW()),
        account_status      = 'active',
        updated_at          = NOW();`
  );
  ok(`Profile ready: ${firstName} ${lastName}`);
}

/**
 * Find or create the test organisation.  Returns the org UUID string.
 */
function findOrCreateOrgViaSQL(dbContainer, adminUserId) {
  const e = escapeSql;

  let orgId = psqlQuery(
    dbContainer,
    `SELECT id::text FROM public.organizations WHERE name = '${e(TEST_ORG_NAME)}' LIMIT 1;`
  ).trim();

  if (orgId) {
    ok(`Organisation already exists  ${C.grey('(id: ' + orgId.slice(0, 8) + '...)')}`);
    // Ensure the org is marked ready with the current verified_at flag.
    psqlQuery(dbContainer,
      `UPDATE public.organizations SET verified_at = NOW(), updated_at = NOW()
        WHERE id = '${e(orgId)}';`
    );
    ok('Organisation verified_at set');
    return orgId;
  }

  const slug = TEST_ORG_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  orgId = psqlQuery(
    dbContainer,
    `INSERT INTO public.organizations (name, slug, verified_at, created_by, created_at, updated_at)
      VALUES (
        '${e(TEST_ORG_NAME)}', '${e(slug)}', NOW(),
        '${e(adminUserId)}', NOW(), NOW()
      ) RETURNING id::text;`
  ).trim();

  if (!orgId) throw new Error('SQL org creation returned no id');
  ok(`Created organisation: "${TEST_ORG_NAME}"  ${C.grey('(id: ' + orgId.slice(0, 8) + '...)')}`);
  return orgId;
}

/**
 * Insert or update an org_memberships row.
 */
function ensureMembershipViaSQL(dbContainer, orgId, userId, role) {
  const e = escapeSql;
  psqlQuery(
    dbContainer,
    `INSERT INTO public.org_memberships (org_id, user_id, role, created_at)
      VALUES ('${e(orgId)}', '${e(userId)}', '${e(role)}', NOW())
      ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role;`
  );
}

/**
 * Ensure at least one active service exists for the test org.
 */
function ensureTestServiceViaSQL(dbContainer, orgId) {
  const e = escapeSql;

  const existing = psqlQuery(
    dbContainer,
    `SELECT id FROM public."Services" WHERE org_id = '${e(orgId)}' AND is_active = true LIMIT 1;`
  ).trim();

  if (existing) {
    ok('Service already exists');
    return;
  }

  psqlQuery(
    dbContainer,
    `INSERT INTO public."Services" (org_id, name, duration_minutes, is_active)
      VALUES ('${e(orgId)}', 'שיעור ניסיון', 45, true);`
  );
  ok('Created test service: "שיעור ניסיון"');
}

/**
 * Remove test students (by known identity numbers) so deduplication guards
 * do not block the student-lifecycle test script on re-runs.
 */
function ensureTestStudentCleanViaSQL(dbContainer, orgId) {
  const e = escapeSql;
  const testIdentityNumbers = ['999000001', '999000002', '999000005'];

  for (const identityNumber of testIdentityNumbers) {
    const rows = psqlQuery(
      dbContainer,
      `SELECT id::text FROM public.students
        WHERE org_id = '${e(orgId)}' AND identity_number = '${identityNumber}';`
    ).trim();

    const studentIds = rows.split('\n').filter(Boolean);
    for (const sid of studentIds) {
      for (const table of ['waiting_list_entries', 'form_submissions', 'hmo_authorizations', 'commitments', 'lesson_templates']) {
        try {
          psqlQuery(dbContainer, `DELETE FROM public.${table} WHERE student_id = '${e(sid)}';`);
        } catch { /* table may not exist — not critical */ }
      }
      psqlQuery(dbContainer, `DELETE FROM public.students WHERE id = '${e(sid)}';`);
    }
    if (studentIds.length > 0) {
      ok(`Cleaned up test student (identity_number: ${identityNumber})`);
    }
  }
}

// ─── 6. Ensure test service exists ────────────────────────────────────────

async function ensureTestService(supabaseUrl, serviceKey, orgId) {
  let data;
  try {
    data = await supabaseGet(supabaseUrl, serviceKey, '/rest/v1/Services', {
      org_id: `eq.${orgId}`,
      is_active: 'eq.true',
      select: 'id,name',
      limit: '1',
    });
  } catch {
    warn('Could not check for existing services — skipping service creation');
    return;
  }

  if (Array.isArray(data) && data.length > 0) {
    ok(`Service already exists: "${data[0].name}"`);
    return;
  }

  await supabaseUpsert(supabaseUrl, serviceKey, '/rest/v1/Services', {
    org_id: orgId,
    name: 'שיעור ניסיון',
    duration_minutes: 45,
    is_active: true,
  });
  ok('Created test service: "שיעור ניסיון"');
}

// ─── 7. Clean up test student data ────────────────────────────────────────

// Ensures that students with the test identity numbers are removed before each
// test run so that the deduplication guard in AddStudentForm does not block.
async function ensureTestStudentClean(supabaseUrl, serviceKey, orgId) {
  const testIdentityNumbers = ['999000001', '999000002', '999000005'];

  for (const identityNumber of testIdentityNumbers) {
    let students;
    try {
      students = await supabaseGet(supabaseUrl, serviceKey, '/rest/v1/students', {
        org_id: `eq.${orgId}`,
        identity_number: `eq.${identityNumber}`,
        select: 'id',
      });
    } catch {
      continue;
    }

    if (!Array.isArray(students) || students.length === 0) continue;

    for (const student of students) {
      const sid = student.id;
      await supabaseDelete(supabaseUrl, serviceKey, '/rest/v1/waiting_list_entries', `student_id=eq.${sid}`).catch(() => {});
      await supabaseDelete(supabaseUrl, serviceKey, '/rest/v1/form_submissions',     `student_id=eq.${sid}`).catch(() => {});
      await supabaseDelete(supabaseUrl, serviceKey, '/rest/v1/hmo_authorizations',   `student_id=eq.${sid}`).catch(() => {});
      await supabaseDelete(supabaseUrl, serviceKey, '/rest/v1/commitments',          `student_id=eq.${sid}`).catch(() => {});
      await supabaseDelete(supabaseUrl, serviceKey, '/rest/v1/lesson_templates',     `student_id=eq.${sid}`).catch(() => {});
      await supabaseDelete(supabaseUrl, serviceKey, '/rest/v1/students',             `id=eq.${sid}`).catch(() => {});
    }
    ok(`Cleaned up test student (identity_number: ${identityNumber})`);
  }
}

// ─── 8. Write .env ────────────────────────────────────────────────────────

/**
 * Read BACKUP_SERVICE_KEY from api/local.settings.json.
 * If absent, generate a random 64-hex-char key and write it back so the
 * Azure Function can use the same value the tester will send.
 */
function resolveBackupServiceKey(repoRoot) {
  const settingsPath = join(repoRoot, 'api', 'local.settings.json');

  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const existing = settings.Values?.BACKUP_SERVICE_KEY;
      if (existing && existing.trim()) {
        ok('BACKUP_SERVICE_KEY read from api/local.settings.json');
        return existing.trim();
      }

      // Not set — generate and persist so both sides share the same key.
      const key = randomBytes(32).toString('hex');
      settings.Values = settings.Values || {};
      settings.Values.BACKUP_SERVICE_KEY = key;
      if (!DRY_RUN) {
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
        ok('Generated BACKUP_SERVICE_KEY and wrote it to api/local.settings.json');
      } else {
        ok('[dry-run] Would generate and write BACKUP_SERVICE_KEY to api/local.settings.json');
      }
      return key;
    } catch (e) {
      warn(`Could not read/write api/local.settings.json for BACKUP_SERVICE_KEY: ${e.message}`);
    }
  }

  // Fallback: generate a key but cannot persist it — warn the operator.
  const key = randomBytes(32).toString('hex');
  warn('api/local.settings.json not found — generated a BACKUP_SERVICE_KEY for .env only.');
  warn('Add it to api/local.settings.json manually under Values.BACKUP_SERVICE_KEY so the API trusts it.');
  return key;
}

function writeEnvFile(config) {
  const lines = [
    '# Auto-generated by setup.js — do not edit manually',
    `# Generated: ${new Date().toISOString()}`,
    `# Source: ${config.source}`,
    '',
    `BASE_URL=${config.baseUrl}`,
    '',
    `ADMIN_EMAIL=${config.adminEmail}`,
    `ADMIN_PASSWORD=${config.password}`,
    '',
    `OFFICE_EMAIL=${config.officeEmail}`,
    `OFFICE_PASSWORD=${config.password}`,
    '',
    `INSTRUCTOR_EMAIL=${config.instructorEmail}`,
    `INSTRUCTOR_PASSWORD=${config.password}`,
    '',
    `TEST_ORG_ID=${config.orgId}`,
    '',
    `SUPABASE_URL=${config.supabaseUrl}`,
    `SERVICE_ROLE_KEY=${config.serviceRoleKey}`,
    `BACKUP_SERVICE_KEY=${config.backupServiceKey}`,
    '',
    `DEFAULT_BROWSER=chromium`,
    `DEFAULT_TIMEOUT_MS=12000`,
  ];

  if (DRY_RUN) {
    console.log('\n  Would write .env:\n');
    console.log(lines.map(l => `  ${C.grey(l)}`).join('\n'));
    return;
  }

  writeFileSync(ENV_PATH, lines.join('\n') + '\n', 'utf8');
  ok(`.env written to ${ENV_PATH}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(C.bold('\n  Reinex Automatic Tester — Setup\n'));

  if (DRY_RUN)  console.log(C.yellow('  [DRY RUN] No changes will be made.\n'));
  if (RESET)    console.log(C.yellow('  [RESET] Existing test data will be deleted first.\n'));

  // 1. Discover Supabase config
  const supabaseCfg = await discoverSupabaseConfig();
  if (!supabaseCfg) process.exit(1);

  const { supabaseUrl, serviceRoleKey, source } = supabaseCfg;
  step(`Supabase URL: ${supabaseUrl}  ${C.grey('(source: ' + source + ')')}`);

  // 2. Check & apply schema
  await checkAndApplySchema(supabaseUrl, serviceRoleKey);

  // 3. Probe app URL
  const baseUrl = await probeAppUrl();

  // ── Detect whether the Supabase HTTP API is reachable from this machine ──
  //
  // On Windows + Docker Desktop + WSL2 the port-forwarding layer sometimes
  // accepts TCP connections but never forwards HTTP traffic, causing every
  // fetch() to throw "other side closed / UND_ERR_SOCKET".  When that
  // happens we fall back to running SQL directly inside the DB container
  // (the same mechanism the schema-check step already uses reliably).

  section('── Checking Supabase HTTP API Accessibility');
  const httpWorks = !DRY_RUN && await isHttpApiWorking(supabaseUrl, serviceRoleKey);

  let dbContainer = null;
  if (!DRY_RUN) {
    if (httpWorks) {
      ok('Supabase HTTP API is reachable — using REST/Auth endpoints.');
    } else {
      warn('Supabase HTTP API is NOT reachable from this host.');
      warn('This is common on Windows + Docker Desktop (WSL2 port-forwarding issue).');
      step('Falling back to direct SQL via Docker exec psql...');

      dbContainer = findDbContainer(supabaseUrl);
      if (!dbContainer) {
        fail('Could not find the Supabase database Docker container for SQL fallback.');
        fail('Make sure Docker is running:  docker ps | grep supabase_db');
        process.exit(1);
      }
      ok(`Using container: ${dbContainer}`);
    }
  }

  // Resolve backup service key (reads from api/local.settings.json, generates if absent).
  section('── Resolving BACKUP_SERVICE_KEY');
  const backupServiceKey = resolveBackupServiceKey(REPO_ROOT);

  // Write .env now with what we know — so credentials are saved even if later steps fail.
  // TEST_ORG_ID will be blank until org creation succeeds; re-running setup fills it in.
  section('── Writing .env (early — updated again after org creation)');
  writeEnvFile({
    source,
    baseUrl,
    adminEmail:      TEST_USERS.find(u => u.key === 'admin').email,
    officeEmail:     TEST_USERS.find(u => u.key === 'office').email,
    instructorEmail: TEST_USERS.find(u => u.key === 'instructor').email,
    password:        PASSWORD,
    orgId:           '',
    supabaseUrl,
    serviceRoleKey,
    backupServiceKey,
  });

  // 4. (Optional) Reset existing test data
  if (RESET && !DRY_RUN) {
    section('── Resetting Existing Test Data');
    if (httpWorks) {
      await deleteTestOrg(supabaseUrl, serviceRoleKey);
      await deleteTestUsers(supabaseUrl, serviceRoleKey);
    } else {
      warn('[SQL fallback] Reset via SQL is not yet implemented — skipping reset.');
      warn('To fully reset, run:  supabase db reset --local  (in the supabase-tenant directory)');
    }
  }

  // 5. Create test users
  section('── Step 4 / 6  Create Test Users');
  const userIds = {};
  for (const user of TEST_USERS) {
    if (DRY_RUN) {
      ok(`[dry-run] Would create/find: ${user.email}`);
      userIds[user.key] = `dry-run-${user.key}-id`;
    } else if (httpWorks) {
      userIds[user.key] = await createOrFindUser(supabaseUrl, serviceRoleKey, user);
    } else {
      userIds[user.key] = createOrFindUserViaSQL(dbContainer, {
        email:     user.email,
        password:  PASSWORD,
        firstName: user.firstName,
        lastName:  user.lastName,
      });
    }
  }

  // 6. Ensure account profiles are setup-complete
  section('── Step 5 / 6  Configure Account Profiles');
  for (const user of TEST_USERS) {
    if (DRY_RUN) {
      ok(`[dry-run] Would mark profile complete: ${user.email}`);
    } else if (httpWorks) {
      await ensureProfileComplete(supabaseUrl, serviceRoleKey, userIds[user.key], user);
      ok(`Profile ready: ${user.email}`);
    } else {
      ensureProfileCompleteViaSQL(dbContainer, userIds[user.key], user);
    }
  }

  // 7. Create org + memberships
  section('── Step 6 / 6  Create Test Organisation');
  let orgId = 'dry-run-org-id';

  if (!DRY_RUN) {
    if (httpWorks) {
      orgId = await createOrg(supabaseUrl, serviceRoleKey, userIds.admin);
      for (const user of TEST_USERS) {
        await ensureMembership(supabaseUrl, serviceRoleKey, orgId, userIds[user.key], user.role);
        ok(`${user.role.padEnd(12)} membership: ${user.email}`);
      }
      await ensureTestService(supabaseUrl, serviceRoleKey, orgId);
      await ensureTestStudentClean(supabaseUrl, serviceRoleKey, orgId);
    } else {
      orgId = findOrCreateOrgViaSQL(dbContainer, userIds.admin);
      for (const user of TEST_USERS) {
        ensureMembershipViaSQL(dbContainer, orgId, userIds[user.key], user.role);
        ok(`${user.role.padEnd(12)} membership: ${user.email}`);
      }
      ensureTestServiceViaSQL(dbContainer, orgId);
      ensureTestStudentCleanViaSQL(dbContainer, orgId);
    }
  } else {
    ok('[dry-run] Would create org and 3 memberships');
  }

  // 8. Write .env (final — now with TEST_ORG_ID)
  section('── Writing .env (final)');
  writeEnvFile({
    source,
    baseUrl,
    adminEmail:      TEST_USERS.find(u => u.key === 'admin').email,
    officeEmail:     TEST_USERS.find(u => u.key === 'office').email,
    instructorEmail: TEST_USERS.find(u => u.key === 'instructor').email,
    password:        PASSWORD,
    orgId,
    supabaseUrl,
    serviceRoleKey,
    backupServiceKey,
  });

  // Done
  console.log(C.bold('\n  ── All done! ────────────────────────────────────────\n'));
  console.log(`  ${C.green('Test org ID')}  : ${orgId}`);
  console.log(`  ${C.green('Admin')}        : ${TEST_USERS.find(u => u.key === 'admin').email}`);
  console.log(`  ${C.green('Password')}     : ${PASSWORD}`);
  console.log(`  ${C.green('App URL')}      : ${baseUrl}`);
  console.log('');
  console.log(`  Now run:  ${C.cyan('node runner.js --all --headed')}`);
  console.log('');
}

main().catch(err => {
  fail(`Fatal: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
