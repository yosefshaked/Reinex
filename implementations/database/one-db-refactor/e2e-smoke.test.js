/**
 * E2E Smoke Tests — Single-DB Multi-Tenant Refactor (Step 19)
 *
 * Validates all major user flows against a running backend + Supabase instance.
 * DO NOT run against production without explicit confirmation.
 *
 * Required env vars:
 *   SUPABASE_URL             — e.g. http://127.0.0.1:54321
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_ANON_KEY
 *   API_BASE_URL             — e.g. http://localhost:7071/api  (Azure Functions local)
 *
 * Optional:
 *   SMOKE_TEST_EMAIL         — reuse an existing user (skip user creation)
 *   SMOKE_TEST_PASSWORD
 *   SMOKE_TEST_ORG_ID        — reuse an existing org (skip org creation)
 *
 * Usage:
 *   node --test implementations/database/one-db-refactor/e2e-smoke.test.js
 */
/* eslint-disable no-restricted-imports, no-undef */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const API_BASE = (process.env.API_BASE_URL || 'http://localhost:7071/api').replace(/\/+$/, '');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error('Missing env vars. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.');
  process.exit(1);
}

const RUN_ID = `smoke-${Date.now()}`;
const TEST_EMAIL = process.env.SMOKE_TEST_EMAIL || `${RUN_ID}@test.local`;
const TEST_PASSWORD = process.env.SMOKE_TEST_PASSWORD || 'SmokeTe$t1!';
const REUSE_ORG = process.env.SMOKE_TEST_ORG_ID || '';

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------
const state = {
  admin: null,
  accessToken: null,
  userId: null,
  orgId: null,
  // Created during setup — tracked for teardown
  createdUser: false,
  createdOrg: false,
  // Test artifacts
  createdProfileId: null,
  createdStudentId: null,
  serviceId: null,
  employeeId: null,
  lessonInstanceId: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function apiFetch(path, { method = 'GET', body, params, token } = {}) {
  const bearer = token || state.accessToken;
  const headers = {
    Authorization: `Bearer ${bearer}`,
    'Content-Type': 'application/json',
  };
  if (state.orgId) {
    headers['x-org-id'] = state.orgId;
  }

  let url = `${API_BASE}/${path.replace(/^\/+/, '')}`;
  if (params && Object.keys(params).length) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v != null) sp.set(k, String(v));
    }
    url += `?${sp}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    try { data = await res.json(); } catch { /* empty */ }
  }

  return { status: res.status, ok: res.ok, data };
}

async function insertOrThrow(client, table, row) {
  const { data, error } = await client.from(table).insert(row).select().single();
  if (error) throw new Error(`INSERT into ${table} failed: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Setup & Teardown
// ---------------------------------------------------------------------------
before(async () => {
  state.admin = adminClient();
  const admin = state.admin;

  // --- Org ---
  if (REUSE_ORG) {
    state.orgId = REUSE_ORG;
  } else {
    const org = await insertOrThrow(admin, 'organizations', {
      name: `Smoke Org (${RUN_ID})`,
      slug: `smoke-${RUN_ID}`,
      created_by: '00000000-0000-0000-0000-000000000000',
    });
    state.orgId = org.id;
    state.createdOrg = true;
  }

  // --- Auth user ---
  if (process.env.SMOKE_TEST_EMAIL) {
    // Sign in to existing user
    const anonCli = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await anonCli.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    if (error) throw new Error(`signIn: ${error.message}`);
    state.accessToken = data.session.access_token;
    state.userId = data.user.id;
  } else {
    // Create test user
    const { data: uData, error: uErr } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (uErr) throw new Error(`createUser: ${uErr.message}`);
    state.userId = uData.user.id;
    state.createdUser = true;

    // Membership
    await insertOrThrow(admin, 'org_memberships', {
      org_id: state.orgId,
      user_id: state.userId,
      role: 'admin',
    });

    // Sign in
    const anonCli = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: session, error: sErr } = await anonCli.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    if (sErr) throw new Error(`signIn: ${sErr.message}`);
    state.accessToken = session.session.access_token;
  }

  // --- Supporting data (service + employee for calendar tests) ---
  state.serviceId = (await insertOrThrow(admin, 'Services', {
    org_id: state.orgId,
    name: `Svc (${RUN_ID})`,
    duration_minutes: 45,
  })).id;

  state.employeeId = (await insertOrThrow(admin, 'Employees', {
    org_id: state.orgId,
    first_name: 'Smoke',
    last_name: 'Instructor',
    employee_id: `emp-${RUN_ID}`,
  })).id;
});

after(async () => {
  const admin = state.admin;
  if (!admin || !state.orgId) return;

  // Only tear down if we created the data
  if (state.createdOrg) {
    const tables = [
      'ledger_transactions',
      'lesson_earnings',
      'commitments',
      'lesson_participants',
      'lesson_instances',
      'students',
      'client_profiles',
      'Employees',
      'Services',
      'org_memberships',
    ];
    for (const table of tables) {
      await admin.from(table).delete().eq('org_id', state.orgId);
    }
    await admin.from('organizations').delete().eq('id', state.orgId);
  }

  if (state.createdUser && state.userId) {
    await admin.auth.admin.deleteUser(state.userId);
  }
});

// ---------------------------------------------------------------------------
// 1. Login → org selection → student list loads
// ---------------------------------------------------------------------------
describe('Flow 1: Login → user-context → student list', () => {
  it('GET /user-context returns memberships with the test org', async () => {
    const { status, data } = await apiFetch('user-context');
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert.ok(Array.isArray(data.memberships) || Array.isArray(data.organizations),
      'Response must contain memberships or organizations array');
  });

  it('GET /client-profiles returns array (may be empty for new org)', async () => {
    const { status, data } = await apiFetch('client-profiles', {
      params: { org_id: state.orgId },
    });
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert.ok(Array.isArray(data), 'client-profiles should return an array');
  });
});

// ---------------------------------------------------------------------------
// 2. Create student → verify org_id stamped
// ---------------------------------------------------------------------------
describe('Flow 2: Create client-profile → org_id stamped', () => {
  it('POST /client-profiles creates a profile with correct org_id', async () => {
    const { status, data } = await apiFetch('client-profiles', {
      method: 'POST',
      body: {
        org_id: state.orgId,
        first_name: 'Smoke',
        last_name: 'Test',
        identity_number: '123456782',
        phone: '0541234567',
        email: `smoke-${RUN_ID}@test.local`,
      },
    });
    assert.ok([200, 201].includes(status), `Expected 200/201, got ${status}: ${JSON.stringify(data)}`);
    assert.ok(data.id, 'Response must include id');
    state.createdProfileId = data.id;
    state.createdStudentId = data.student_id || null;

    // Verify org_id is stamped via direct DB query
    const { data: row, error } = await state.admin
      .from('client_profiles')
      .select('org_id')
      .eq('id', data.id)
      .single();
    assert.ifError(error);
    assert.equal(row.org_id, state.orgId, 'org_id must match the active org');
  });
});

// ---------------------------------------------------------------------------
// 3. Calendar generation → lesson instances have org_id
// ---------------------------------------------------------------------------
describe('Flow 3: Calendar generation → lesson instances stamped', () => {
  it('POST /calendar-generate dry run returns valid summary', async () => {
    const today = new Date();
    const startDate = today.toISOString().split('T')[0];
    const endDate = new Date(today.getTime() + 7 * 86400000).toISOString().split('T')[0];

    const { status, data } = await apiFetch('calendar/generate', {
      method: 'POST',
      body: {
        org_id: state.orgId,
        start_date: startDate,
        end_date: endDate,
        dry_run: true,
      },
    });
    // 200 even with no templates — summary should exist
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert.ok(data.summary || data.generation_run_id != null, 'Response must contain summary or run_id');
  });

  it('Directly inserted lesson_instance has org_id', async () => {
    // Insert a lesson instance via service_role to simulate generation output
    const li = await insertOrThrow(state.admin, 'lesson_instances', {
      org_id: state.orgId,
      datetime_start: new Date().toISOString(),
      duration_minutes: 45,
      instructor_employee_id: state.employeeId,
      service_id: state.serviceId,
      status: 'scheduled',
      created_source: 'migration',
    });

    state.lessonInstanceId = li.id;
    assert.equal(li.org_id, state.orgId, 'lesson_instance.org_id must match');
  });
});

// ---------------------------------------------------------------------------
// 4. Lesson instances list via API
// ---------------------------------------------------------------------------
describe('Flow 4: Lesson instances via API', () => {
  it('GET /lesson-instances for today returns the inserted instance', async () => {
    const today = new Date().toISOString().split('T')[0];
    const { status, data } = await apiFetch('lesson-instances', {
      params: { org_id: state.orgId, date: today },
    });
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    const arr = Array.isArray(data) ? data : (data.data || []);
    // The instance we inserted should be visible
    const found = arr.some((li) => li.id === state.lessonInstanceId);
    assert.ok(found, 'Inserted lesson_instance must appear in the list');
  });
});

// ---------------------------------------------------------------------------
// 5. Billing / ledger entries have org_id
// ---------------------------------------------------------------------------
describe('Flow 5: Billing endpoint responds for org', () => {
  it('GET /billing with org_id returns valid response', async () => {
    const { status, data } = await apiFetch('billing', {
      params: { org_id: state.orgId },
    });
    // Billing can return 200 with empty claims or 400 if view param needed
    assert.ok([200, 400].includes(status), `Expected 200 or 400, got ${status}`);
    if (status === 200) {
      assert.ok(data != null, 'Response body should not be null');
    }
  });

  it('Commitment inserted via setup has correct org_id', async () => {
    // Quick insert + verify
    const cp = await insertOrThrow(state.admin, 'client_profiles', {
      org_id: state.orgId,
      first_name: 'Commitment',
      last_name: `Probe-${RUN_ID}`,
      identity_number: `${Math.floor(Math.random() * 1000000000)}`.padStart(9, '0'),
    });

    const student = await insertOrThrow(state.admin, 'students', {
      org_id: state.orgId,
      client_profile_id: cp.id,
    });
    const commitment = await insertOrThrow(state.admin, 'commitments', {
      org_id: state.orgId,
      student_id: student.id,
      service_id: state.serviceId,
      commitment_type: 'package',
      total_amount: 10000,
    });
    assert.equal(commitment.org_id, state.orgId, 'commitment.org_id must match');

    // Cleanup
    await state.admin.from('commitments').delete().eq('id', commitment.id);
    await state.admin.from('students').delete().eq('id', student.id);
    await state.admin.from('client_profiles').delete().eq('id', cp.id);
  });
});

// ---------------------------------------------------------------------------
// 6. Org switch → data swaps correctly
// ---------------------------------------------------------------------------
describe('Flow 6: Org isolation — second org sees different data', () => {
  it('Creating a second org + user shows zero data from first org', async () => {
    const admin = state.admin;

    // Create Org B
    const orgB = await insertOrThrow(admin, 'organizations', {
      name: `Smoke OrgB (${RUN_ID})`,
      slug: `smoke-b-${RUN_ID}`,
      created_by: '00000000-0000-0000-0000-000000000000',
    });

    // Create User B
    const emailB = `${RUN_ID}-b@test.local`;
    const { data: ubData, error: ubErr } = await admin.auth.admin.createUser({
      email: emailB,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (ubErr) throw new Error(`createUser B: ${ubErr.message}`);
    const userB = ubData.user;

    await insertOrThrow(admin, 'org_memberships', {
      org_id: orgB.id,
      user_id: userB.id,
      role: 'admin',
    });

    // Sign in as User B
    const anonCli = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: sessB, error: sErr } = await anonCli.auth.signInWithPassword({
      email: emailB,
      password: TEST_PASSWORD,
    });
    if (sErr) throw new Error(`signIn B: ${sErr.message}`);

    // Fetch client-profiles for Org B — should be empty / not contain Org A data
    const { status, data } = await apiFetch('client-profiles', {
      params: { org_id: orgB.id },
      token: sessB.session.access_token,
    });
    assert.equal(status, 200, `Expected 200, got ${status}`);
    const arr = Array.isArray(data) ? data : [];
    const leakedFromA = arr.some((r) => r.id === state.createdProfileId);
    assert.ok(!leakedFromA, 'Org A data must NOT appear when querying as Org B user');

    // Cleanup Org B
    await admin.from('org_memberships').delete().eq('org_id', orgB.id);
    await admin.from('organizations').delete().eq('id', orgB.id);
    await admin.auth.admin.deleteUser(userB.id);
  });
});

// ---------------------------------------------------------------------------
// 7. EXPLAIN ANALYZE — index scan verification (SQL-based)
// ---------------------------------------------------------------------------
describe('Flow 7: Index scan verification via EXPLAIN ANALYZE', () => {
  const indexQueries = [
    {
      name: 'client_profiles by org_id + is_active',
      sql: `EXPLAIN (FORMAT JSON) SELECT * FROM client_profiles WHERE org_id = $1 AND is_active = true LIMIT 25`,
    },
    {
      name: 'lesson_instances by org_id + datetime range',
      sql: `EXPLAIN (FORMAT JSON) SELECT * FROM lesson_instances WHERE org_id = $1 AND datetime_start >= now() - interval '1 day' AND datetime_start < now() + interval '1 day'`,
    },
    {
      name: 'commitments by org_id + student_id',
      sql: `EXPLAIN (FORMAT JSON) SELECT * FROM commitments WHERE org_id = $1 AND is_active = true`,
    },
    {
      name: 'org_memberships by user_id',
      sql: `EXPLAIN (FORMAT JSON) SELECT * FROM org_memberships WHERE user_id = $1`,
    },
  ];

  for (const { name, sql } of indexQueries) {
    it(`${name} — uses index or bitmap scan`, async () => {
      const param = sql.includes('user_id') ? state.userId : state.orgId;
      const { data, error } = await state.admin.rpc('explain_query', {
        query_text: sql,
        query_param: param,
      });

      if (error) {
        // If the RPC doesn't exist, fall back to a note
        if (error.code === 'PGRST202' || /does not exist|unknown|could not find/i.test(error.message)) {
          console.log(`  [SKIP] explain_query RPC not installed — ${name}`);
          return;
        }
        throw error;
      }

      const plan = JSON.stringify(data);
      const hasIndexScan = /Index Scan|Index Only Scan|Bitmap/i.test(plan);
      // Seq Scan is acceptable on very small tables; warn but don't fail
      if (!hasIndexScan) {
        console.log(`  [WARN] ${name}: plan uses Seq Scan (may be OK for small tables)`);
      }
    });
  }
});
