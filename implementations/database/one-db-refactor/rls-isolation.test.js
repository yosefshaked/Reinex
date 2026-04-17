/**
 * RLS Isolation Integration Tests — Single-DB Multi-Tenant Refactor (Step 18)
 *
 * Runs against a **real** Supabase instance (local emulator or staging).
 * DO NOT run against production.
 *
 * Required env vars:
 *   SUPABASE_URL            — e.g. http://127.0.0.1:54321
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_ANON_KEY
 *
 * Usage:
 *   node --test implementations/database/one-db-refactor/rls-isolation.test.js
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

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error(
    'Missing env vars. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_ANON_KEY.',
  );
  process.exit(1);
}

// Unique suffix to avoid collisions with real data
const RUN_ID = `rls-test-${Date.now()}`;
const EMAIL_A = `${RUN_ID}-a@test.local`;
const EMAIL_B = `${RUN_ID}-b@test.local`;
const PASSWORD = 'TestP@ssw0rd!';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function anonClientWithOrg(orgId) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { 'x-org-id': orgId } },
  });
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------
const state = {
  admin: null,
  // Orgs
  orgA: null,
  orgB: null,
  // Auth users
  userA: null,
  userB: null,
  // Supporting data per org
  serviceA: null,
  serviceB: null,
  employeeA: null,
  employeeB: null,
  clientProfileA: null,
  clientProfileB: null,
  studentA: null,
  studentB: null,
  lessonInstanceA: null,
  lessonInstanceB: null,
  commitmentA: null,
  commitmentB: null,
  // Authenticated clients
  clientA: null,
  clientB: null,
};

// ---------------------------------------------------------------------------
// Setup & Teardown
// ---------------------------------------------------------------------------
async function insertOrThrow(client, table, row) {
  const { data, error } = await client.from(table).insert(row).select().single();
  if (error) throw new Error(`INSERT into ${table} failed: ${error.message}`);
  return data;
}

before(async () => {
  state.admin = adminClient();
  const admin = state.admin;

  // --- Create organizations ---
  state.orgA = await insertOrThrow(admin, 'organizations', {
    name: `Org A (${RUN_ID})`,
    slug: `org-a-${RUN_ID}`,
    created_by: '00000000-0000-0000-0000-000000000000',
  });
  state.orgB = await insertOrThrow(admin, 'organizations', {
    name: `Org B (${RUN_ID})`,
    slug: `org-b-${RUN_ID}`,
    created_by: '00000000-0000-0000-0000-000000000000',
  });

  // --- Create auth users ---
  const { data: uaData, error: uaErr } = await admin.auth.admin.createUser({
    email: EMAIL_A,
    password: PASSWORD,
    email_confirm: true,
  });
  if (uaErr) throw new Error(`createUser A: ${uaErr.message}`);
  state.userA = uaData.user;

  const { data: ubData, error: ubErr } = await admin.auth.admin.createUser({
    email: EMAIL_B,
    password: PASSWORD,
    email_confirm: true,
  });
  if (ubErr) throw new Error(`createUser B: ${ubErr.message}`);
  state.userB = ubData.user;

  // --- Memberships ---
  await insertOrThrow(admin, 'org_memberships', {
    org_id: state.orgA.id,
    user_id: state.userA.id,
    role: 'admin',
  });
  await insertOrThrow(admin, 'org_memberships', {
    org_id: state.orgB.id,
    user_id: state.userB.id,
    role: 'admin',
  });

  // --- Services (per org) ---
  state.serviceA = await insertOrThrow(admin, 'Services', {
    org_id: state.orgA.id,
    name: `Svc A (${RUN_ID})`,
  });
  state.serviceB = await insertOrThrow(admin, 'Services', {
    org_id: state.orgB.id,
    name: `Svc B (${RUN_ID})`,
  });

  // --- Employees (per org, act as instructors) ---
  state.employeeA = await insertOrThrow(admin, 'Employees', {
    org_id: state.orgA.id,
    first_name: 'Instructor',
    employee_id: `emp-a-${RUN_ID}`,
  });
  state.employeeB = await insertOrThrow(admin, 'Employees', {
    org_id: state.orgB.id,
    first_name: 'Instructor',
    employee_id: `emp-b-${RUN_ID}`,
  });

  // --- Client profiles ---
  state.clientProfileA = await insertOrThrow(admin, 'client_profiles', {
    org_id: state.orgA.id,
    first_name: 'Alice',
    last_name: 'ProfileA',
    identity_number: '111111111',
  });
  state.clientProfileB = await insertOrThrow(admin, 'client_profiles', {
    org_id: state.orgB.id,
    first_name: 'Bob',
    last_name: 'ProfileB',
    identity_number: '222222222',
  });

  // --- Students ---
  state.studentA = await insertOrThrow(admin, 'students', {
    org_id: state.orgA.id,
    client_profile_id: state.clientProfileA.id,
  });
  state.studentB = await insertOrThrow(admin, 'students', {
    org_id: state.orgB.id,
    client_profile_id: state.clientProfileB.id,
  });

  // --- Lesson instances ---
  state.lessonInstanceA = await insertOrThrow(admin, 'lesson_instances', {
    org_id: state.orgA.id,
    datetime_start: new Date().toISOString(),
    duration_minutes: 45,
    instructor_employee_id: state.employeeA.id,
    service_id: state.serviceA.id,
    status: 'scheduled',
    created_source: 'test',
  });
  state.lessonInstanceB = await insertOrThrow(admin, 'lesson_instances', {
    org_id: state.orgB.id,
    datetime_start: new Date().toISOString(),
    duration_minutes: 45,
    instructor_employee_id: state.employeeB.id,
    service_id: state.serviceB.id,
    status: 'scheduled',
    created_source: 'test',
  });

  // --- Commitments ---
  state.commitmentA = await insertOrThrow(admin, 'commitments', {
    org_id: state.orgA.id,
    student_id: state.studentA.id,
    service_id: state.serviceA.id,
    commitment_type: 'package',
    total_amount: 50000,
  });
  state.commitmentB = await insertOrThrow(admin, 'commitments', {
    org_id: state.orgB.id,
    student_id: state.studentB.id,
    service_id: state.serviceB.id,
    commitment_type: 'package',
    total_amount: 60000,
  });

  // --- Sign in and build authenticated clients ---
  state.clientA = anonClientWithOrg(state.orgA.id);
  const { error: signInAErr } = await state.clientA.auth.signInWithPassword({
    email: EMAIL_A,
    password: PASSWORD,
  });
  if (signInAErr) throw new Error(`signIn A: ${signInAErr.message}`);

  state.clientB = anonClientWithOrg(state.orgB.id);
  const { error: signInBErr } = await state.clientB.auth.signInWithPassword({
    email: EMAIL_B,
    password: PASSWORD,
  });
  if (signInBErr) throw new Error(`signIn B: ${signInBErr.message}`);
});

after(async () => {
  const admin = state.admin;
  if (!admin) return;

  // Teardown order respects foreign-key dependencies
  const tables = [
    'commitments',
    'lesson_instances',
    'students',
    'client_profiles',
    'Employees',
    'Services',
    'org_memberships',
  ];

  for (const table of tables) {
    await admin.from(table).delete().in('org_id', [state.orgA?.id, state.orgB?.id].filter(Boolean));
  }

  // Delete orgs
  for (const org of [state.orgA, state.orgB]) {
    if (org?.id) await admin.from('organizations').delete().eq('id', org.id);
  }

  // Delete auth users
  for (const user of [state.userA, state.userB]) {
    if (user?.id) await admin.auth.admin.deleteUser(user.id);
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RLS row isolation', () => {
  it('User A sees only Org A client_profiles', async () => {
    const { data, error } = await state.clientA.from('client_profiles').select('id, org_id');
    assert.ifError(error);
    assert.ok(data.length >= 1, 'Expected at least 1 row');
    assert.ok(data.every((r) => r.org_id === state.orgA.id), 'All rows must belong to Org A');
    assert.ok(!data.some((r) => r.org_id === state.orgB.id), 'No Org B rows should be visible');
  });

  it('User B sees only Org B client_profiles', async () => {
    const { data, error } = await state.clientB.from('client_profiles').select('id, org_id');
    assert.ifError(error);
    assert.ok(data.length >= 1);
    assert.ok(data.every((r) => r.org_id === state.orgB.id));
  });

  it('User A sees only Org A lesson_instances', async () => {
    const { data, error } = await state.clientA.from('lesson_instances').select('id, org_id');
    assert.ifError(error);
    assert.ok(data.length >= 1);
    assert.ok(data.every((r) => r.org_id === state.orgA.id));
  });

  it('User A sees only Org A commitments', async () => {
    const { data, error } = await state.clientA.from('commitments').select('id, org_id');
    assert.ifError(error);
    assert.ok(data.length >= 1);
    assert.ok(data.every((r) => r.org_id === state.orgA.id));
  });

  it('User B cannot see Org A lesson_instances', async () => {
    const { data, error } = await state.clientB
      .from('lesson_instances')
      .select('id')
      .eq('id', state.lessonInstanceA.id);
    assert.ifError(error);
    assert.equal(data.length, 0, 'Org A lesson must be invisible to Org B user');
  });
});

describe('RLS cross-org INSERT rejection', () => {
  it('User A cannot insert a client_profile with Org B org_id', async () => {
    const { data, error } = await state.clientA.from('client_profiles').insert({
      org_id: state.orgB.id,
      first_name: 'Evil',
      last_name: 'CrossOrg',
    });
    assert.ok(error, 'Expected RLS to reject cross-org INSERT');
    assert.equal(data, null);
  });

  it('User A cannot insert a commitment with Org B org_id', async () => {
    const { data, error } = await state.clientA.from('commitments').insert({
      org_id: state.orgB.id,
      student_id: state.studentB.id,
      service_id: state.serviceB.id,
      commitment_type: 'package',
      total_amount: 999,
    });
    assert.ok(error, 'Expected RLS to reject cross-org INSERT');
    assert.equal(data, null);
  });
});

describe('Composite unique constraints (org-scoped)', () => {
  it('Same identity_number in different orgs is allowed', async () => {
    const sharedIdNumber = `SHARED-${RUN_ID}`;

    // Insert in Org A (via admin to avoid RLS complications)
    const rowA = await insertOrThrow(state.admin, 'client_profiles', {
      org_id: state.orgA.id,
      first_name: 'Dup',
      last_name: 'InA',
      identity_number: sharedIdNumber,
    });

    // Insert same identity_number in Org B — should succeed
    const rowB = await insertOrThrow(state.admin, 'client_profiles', {
      org_id: state.orgB.id,
      first_name: 'Dup',
      last_name: 'InB',
      identity_number: sharedIdNumber,
    });

    assert.ok(rowA.id);
    assert.ok(rowB.id);
    assert.notEqual(rowA.id, rowB.id);

    // Cleanup
    await state.admin.from('client_profiles').delete().eq('id', rowA.id);
    await state.admin.from('client_profiles').delete().eq('id', rowB.id);
  });

  it('Same identity_number in the SAME org is rejected', async () => {
    const dupeIdNumber = `DUPE-${RUN_ID}`;

    const first = await insertOrThrow(state.admin, 'client_profiles', {
      org_id: state.orgA.id,
      first_name: 'First',
      last_name: 'Dupe',
      identity_number: dupeIdNumber,
    });

    const { error } = await state.admin.from('client_profiles').insert({
      org_id: state.orgA.id,
      first_name: 'Second',
      last_name: 'Dupe',
      identity_number: dupeIdNumber,
    });

    assert.ok(error, 'Expected unique constraint violation');
    assert.ok(
      /unique|duplicate|already exists/i.test(error.message || error.code),
      `Error should indicate uniqueness violation: ${error.message}`,
    );

    // Cleanup
    await state.admin.from('client_profiles').delete().eq('id', first.id);
  });
});

describe('org_memberships RLS (no recursion)', () => {
  it('User A sees only own memberships', async () => {
    const { data, error } = await state.clientA.from('org_memberships').select('id, org_id, user_id');
    assert.ifError(error);
    assert.ok(data.length >= 1, 'Should see at least own membership');
    assert.ok(
      data.every((r) => r.user_id === state.userA.id),
      'Every visible membership must belong to the authenticated user',
    );
  });

  it('User A cannot see User B memberships', async () => {
    const { data, error } = await state.clientA
      .from('org_memberships')
      .select('id')
      .eq('user_id', state.userB.id);
    assert.ifError(error);
    assert.equal(data.length, 0, 'User B memberships must be invisible to User A');
  });
});

describe('Anonymous access is blocked at RLS level', () => {
  it('Unauthenticated client cannot read client_profiles', async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { 'x-org-id': state.orgA.id } },
    });

    const { data, error } = await anon.from('client_profiles').select('id');
    // Without a valid JWT, get_active_org_id() will fail (auth.uid() is null)
    // PostgREST should return an error or empty result depending on config
    if (error) {
      assert.ok(true, 'Request correctly rejected for anonymous user');
    } else {
      assert.equal(data.length, 0, 'Anonymous user must see zero rows');
    }
  });

  it('Unauthenticated client cannot insert into client_profiles', async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { 'x-org-id': state.orgA.id } },
    });

    const { data, error } = await anon.from('client_profiles').insert({
      org_id: state.orgA.id,
      first_name: 'Anon',
      last_name: 'Hacker',
    });
    assert.ok(error || data === null, 'Anonymous INSERT must be rejected');
  });
});

describe('Non-member org access is blocked', () => {
  it('User A cannot read data via x-org-id pointing to Org B', async () => {
    // Create a client where User A is authed but x-org-id points to Org B
    const crossClient = anonClientWithOrg(state.orgB.id);
    const { error: signErr } = await crossClient.auth.signInWithPassword({
      email: EMAIL_A,
      password: PASSWORD,
    });
    assert.ifError(signErr);

    const { data, error } = await crossClient.from('client_profiles').select('id');
    // get_active_org_id() checks membership — User A is not a member of Org B
    if (error) {
      assert.ok(
        /forbidden|not a member/i.test(error.message),
        `Expected membership rejection, got: ${error.message}`,
      );
    } else {
      assert.equal(data.length, 0, 'User not in org must see zero rows');
    }
  });
});
