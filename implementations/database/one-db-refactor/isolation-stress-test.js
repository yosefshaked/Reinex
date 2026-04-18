/**
 * Multi-Tenant Isolation Stress Test (Red Team)
 *
 * Objective:
 * - Prove that authenticated users from ORG_ALPHA cannot read/write ORG_OMEGA data,
 *   even with ID guessing, forged x-org-id header, payload org_id tampering,
 *   and direct RPC invocation attempts.
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_ANON_KEY
 *
 * Optional env vars:
 *   API_BASE_URL (defaults to http://localhost:7071/api)
 *
 * Run:
 *   node --test implementations/database/one-db-refactor/isolation-stress-test.js
 */

/* eslint-disable no-restricted-imports */

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const API_BASE_URL = (process.env.API_BASE_URL || 'http://localhost:7071/api').replace(/\/+$/, '');
const API_HEALTH_URL = `${API_BASE_URL}/health`;
const API_DIR = path.resolve(process.cwd(), 'api');
const HOST_STARTUP_TIMEOUT_MS = 30_000;
const HOST_POLL_INTERVAL_MS = 2_000;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  console.error('Missing env vars. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.');
  process.exit(1);
}

const RUN_ID = `isolation-${Date.now()}`;
const ALPHA_EMAIL = `${RUN_ID}-alpha@test.local`;
const ALPHA_PASSWORD = 'IsoStressP@ssw0rd!';
const SECRET_NAME = 'TOP_SECRET_USER';

const state = {
  admin: null,
  alphaClient: null,
  alphaAccessToken: null,
  alphaUserId: null,
  orgAlpha: null,
  orgOmega: null,
  alphaServiceId: null,
  omegaServiceId: null,
  alphaEmployeeIds: [],
  alphaStudentIds: [],
  alphaClientProfileIds: [],
  alphaLessonInstanceIds: [],
  omegaEmployeeId: null,
  omegaSecretClientProfileId: null,
  omegaSecretStudentId: null,
  startedHostProcess: null,
  startedHostAutomatically: false,
};

function makeAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function makeAnonClient(orgId) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { 'x-org-id': orgId } },
  });
}

async function insertOneOrThrow(client, table, row) {
  const { data, error } = await client.from(table).insert(row).select().single();
  if (error) {
    throw new Error(`INSERT into ${table} failed: ${error.message}`);
  }
  return data;
}

function randomIdentityNumber(seed) {
  const numeric = String(seed).replace(/\D/g, '');
  return numeric.padStart(9, '0').slice(-9);
}

function assertNoLeak(payload, forbiddenMarkers, label) {
  const serialized = JSON.stringify(payload ?? null).toLowerCase();
  for (const marker of forbiddenMarkers) {
    if (!marker) continue;
    assert.equal(
      serialized.includes(String(marker).toLowerCase()),
      false,
      `${label}: detected leaked marker in response payload (${marker})`,
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function checkHealth() {
  try {
    const response = await fetch(API_HEALTH_URL, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

function startFunctionsHost() {
  const command = process.platform === 'win32' ? 'func.cmd' : 'func';
  const child = spawn(command, ['host', 'start'], {
    cwd: API_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  child.stdout?.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (text) {
      console.log(`[func host] ${text}`);
    }
  });

  child.stderr?.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (text) {
      console.warn(`[func host][stderr] ${text}`);
    }
  });

  child.on('exit', (code, signal) => {
    if (!state.startedHostAutomatically) {
      return;
    }
    console.log(`[func host] exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
  });

  return child;
}

async function ensureFunctionsHostReady() {
  if (await checkHealth()) {
    return;
  }

  console.log("Azure Functions host not detected. Attempting to start 'func host start' automatically...");
  const child = startFunctionsHost();
  state.startedHostProcess = child;
  state.startedHostAutomatically = true;

  const deadline = Date.now() + HOST_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await checkHealth()) {
      return;
    }

    if (child.exitCode !== null) {
      throw new Error(`Failed to start Azure Functions host automatically. Process exited with code ${child.exitCode}.`);
    }

    await sleep(HOST_POLL_INTERVAL_MS);
  }

  throw new Error('Failed to start Azure Functions host automatically.');
}

async function apiRequest(path, { method = 'GET', token, orgIdHeader, query, body } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    authorization: `Bearer ${token}`,
    'x-supabase-authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  if (orgIdHeader) {
    headers['x-org-id'] = orgIdHeader;
  }

  let url = `${API_BASE_URL}/${String(path || '').replace(/^\/+/, '')}`;
  if (query && typeof query === 'object' && Object.keys(query).length > 0) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }
    const queryString = params.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = response.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  return {
    status: response.status,
    ok: response.ok,
    data,
  };
}

before(async () => {
  await ensureFunctionsHostReady();

  state.admin = makeAdminClient();
  const admin = state.admin;

  // Create ORG_ALPHA and ORG_OMEGA
  state.orgAlpha = await insertOneOrThrow(admin, 'organizations', {
    name: `ORG_ALPHA (${RUN_ID})`,
    slug: `org-alpha-${RUN_ID}`,
    created_by: '00000000-0000-0000-0000-000000000000',
  });

  state.orgOmega = await insertOneOrThrow(admin, 'organizations', {
    name: `ORG_OMEGA (${RUN_ID})`,
    slug: `org-omega-${RUN_ID}`,
    created_by: '00000000-0000-0000-0000-000000000000',
  });

  // Create ORG_ALPHA auth user and membership
  const { data: alphaUserData, error: alphaUserError } = await admin.auth.admin.createUser({
    email: ALPHA_EMAIL,
    password: ALPHA_PASSWORD,
    email_confirm: true,
  });
  if (alphaUserError || !alphaUserData?.user?.id) {
    throw new Error(`Failed creating ORG_ALPHA test user: ${alphaUserError?.message || 'unknown_error'}`);
  }
  state.alphaUserId = alphaUserData.user.id;

  await insertOneOrThrow(admin, 'org_memberships', {
    org_id: state.orgAlpha.id,
    user_id: state.alphaUserId,
    role: 'admin',
  });

  // Seed shared services
  state.alphaServiceId = (await insertOneOrThrow(admin, 'Services', {
    org_id: state.orgAlpha.id,
    name: `Alpha Service (${RUN_ID})`,
    duration_minutes: 45,
  })).id;

  state.omegaServiceId = (await insertOneOrThrow(admin, 'Services', {
    org_id: state.orgOmega.id,
    name: `Omega Service (${RUN_ID})`,
    duration_minutes: 45,
  })).id;

  // ORG_ALPHA: 2 employees
  for (let index = 0; index < 2; index += 1) {
    const employee = await insertOneOrThrow(admin, 'Employees', {
      org_id: state.orgAlpha.id,
      first_name: `AlphaEmp${index + 1}`,
      last_name: 'Isolation',
      employee_id: `alpha-emp-${RUN_ID}-${index + 1}`,
    });
    state.alphaEmployeeIds.push(employee.id);
  }

  // ORG_ALPHA: 5 students (with client_profiles)
  for (let index = 0; index < 5; index += 1) {
    const clientProfile = await insertOneOrThrow(admin, 'client_profiles', {
      org_id: state.orgAlpha.id,
      first_name: `AlphaStudent${index + 1}`,
      last_name: 'Dummy',
      identity_number: randomIdentityNumber(`${Date.now()}${index + 1}`),
      phone: `05400000${String(index + 1).padStart(2, '0')}`,
      email: `${RUN_ID}.alpha.student.${index + 1}@test.local`,
      default_notification_method: 'whatsapp',
      is_active: true,
    });

    const student = await insertOneOrThrow(admin, 'students', {
      org_id: state.orgAlpha.id,
      client_profile_id: clientProfile.id,
    });

    state.alphaClientProfileIds.push(clientProfile.id);
    state.alphaStudentIds.push(student.id);
  }

  // ORG_ALPHA: 10 lesson instances
  for (let index = 0; index < 10; index += 1) {
    const startsAt = new Date(Date.now() + (index * 3600_000)).toISOString();
    const lessonInstance = await insertOneOrThrow(admin, 'lesson_instances', {
      org_id: state.orgAlpha.id,
      datetime_start: startsAt,
      duration_minutes: 45,
      instructor_employee_id: state.alphaEmployeeIds[index % state.alphaEmployeeIds.length],
      service_id: state.alphaServiceId,
      status: 'scheduled',
      created_source: 'migration',
      metadata: { seed_run_id: RUN_ID, seed_org: 'ORG_ALPHA' },
    });
    state.alphaLessonInstanceIds.push(lessonInstance.id);
  }

  // ORG_OMEGA: 1 employee (for cross-org write probe payload)
  state.omegaEmployeeId = (await insertOneOrThrow(admin, 'Employees', {
    org_id: state.orgOmega.id,
    first_name: 'OmegaEmp1',
    last_name: 'Isolation',
    employee_id: `omega-emp-${RUN_ID}-1`,
  })).id;

  // ORG_OMEGA: single secret student named TOP_SECRET_USER
  const omegaSecretProfile = await insertOneOrThrow(admin, 'client_profiles', {
    org_id: state.orgOmega.id,
    first_name: SECRET_NAME,
    last_name: 'LeakTarget',
    identity_number: randomIdentityNumber(`${Date.now()}999`),
    phone: '0549999999',
    email: `${RUN_ID}.omega.secret@test.local`,
    default_notification_method: 'whatsapp',
    is_active: true,
  });
  state.omegaSecretClientProfileId = omegaSecretProfile.id;

  const omegaSecretStudent = await insertOneOrThrow(admin, 'students', {
    org_id: state.orgOmega.id,
    client_profile_id: omegaSecretProfile.id,
  });
  state.omegaSecretStudentId = omegaSecretStudent.id;

  // Authenticate ORG_ALPHA user
  state.alphaClient = makeAnonClient(state.orgAlpha.id);
  const { data: signInData, error: signInError } = await state.alphaClient.auth.signInWithPassword({
    email: ALPHA_EMAIL,
    password: ALPHA_PASSWORD,
  });

  if (signInError || !signInData?.session?.access_token) {
    throw new Error(`Failed sign in for ORG_ALPHA test user: ${signInError?.message || 'unknown_error'}`);
  }

  state.alphaAccessToken = signInData.session.access_token;
});

after(async () => {
  const admin = state.admin;
  if (!admin) return;

  // Cleanup by org scope first (respects foreign key dependencies)
  const scopedTables = [
    'ledger_transactions',
    'commitments',
    'lesson_participants',
    'lesson_instances',
    'students',
    'client_profiles',
    'Employees',
    'Services',
    'org_memberships',
  ];

  for (const table of scopedTables) {
    await admin
      .from(table)
      .delete()
      .in('org_id', [state.orgAlpha?.id, state.orgOmega?.id].filter(Boolean));
  }

  if (state.orgAlpha?.id) {
    await admin.from('organizations').delete().eq('id', state.orgAlpha.id);
  }
  if (state.orgOmega?.id) {
    await admin.from('organizations').delete().eq('id', state.orgOmega.id);
  }

  if (state.alphaUserId) {
    await admin.auth.admin.deleteUser(state.alphaUserId);
  }

  if (state.startedHostAutomatically && state.startedHostProcess) {
    console.log('Isolation stress test started the Azure Functions host; attempting graceful shutdown...');
    state.startedHostProcess.kill('SIGTERM');
    await sleep(1_500);

    if (state.startedHostProcess.exitCode === null) {
      console.warn('Azure Functions host is still running after SIGTERM; forcing shutdown.');
      state.startedHostProcess.kill('SIGKILL');
    }
  }
});

describe('Multi-Tenant Isolation Stress Test (Red Team)', () => {
  it('Test 1 (ID Guessing): ORG_ALPHA cannot fetch ORG_OMEGA secret student by direct UUID', async () => {
    const response = await apiRequest(`students-list/${state.omegaSecretStudentId}`, {
      method: 'GET',
      token: state.alphaAccessToken,
      orgIdHeader: state.orgAlpha.id,
      query: { org_id: state.orgAlpha.id },
    });

    assert.equal(
      response.status,
      404,
      `Expected 404 for direct UUID probing, got ${response.status}: ${JSON.stringify(response.data)}`,
    );

    assertNoLeak(response.data, [
      SECRET_NAME,
      state.omegaSecretStudentId,
      state.omegaSecretClientProfileId,
      'LeakTarget',
    ], 'ID Guessing');
  });

  it('Test 2 (Header Manipulation): forged x-org-id must be rejected for ORG_ALPHA token', async () => {
    const response = await apiRequest('students-list', {
      method: 'GET',
      token: state.alphaAccessToken,
      // Deliberately forged org header (user belongs only to ORG_ALPHA)
      orgIdHeader: state.orgOmega.id,
      // Intentionally no org_id query/body so header is the resolved org
    });

    assert.equal(
      response.status,
      403,
      `Expected 403 for forged org header, got ${response.status}: ${JSON.stringify(response.data)}`,
    );

    assertNoLeak(response.data, [
      SECRET_NAME,
      state.omegaSecretStudentId,
      state.omegaSecretClientProfileId,
    ], 'Header Manipulation');
  });

  it('Test 3 (Cross-Org Write): ORG_ALPHA cannot POST lesson instance into ORG_OMEGA', async () => {
    const { count: beforeCount, error: beforeError } = await state.admin
      .from('lesson_instances')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', state.orgOmega.id);

    assert.ifError(beforeError);

    const response = await apiRequest('lesson-instances', {
      method: 'POST',
      token: state.alphaAccessToken,
      orgIdHeader: state.orgAlpha.id,
      body: {
        // Malicious payload claims ORG_OMEGA ownership
        org_id: state.orgOmega.id,
        datetime_start: new Date(Date.now() + 86_400_000).toISOString(),
        duration_minutes: 45,
        instructor_employee_id: state.omegaEmployeeId,
        service_id: state.omegaServiceId,
        status: 'scheduled',
        created_source: 'red_team_probe',
        metadata: { run_id: RUN_ID, probe: 'cross_org_write' },
      },
    });

    assert.equal(
      response.status,
      403,
      `Expected 403 for cross-org write attempt, got ${response.status}: ${JSON.stringify(response.data)}`,
    );

    const { count: afterCount, error: afterError } = await state.admin
      .from('lesson_instances')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', state.orgOmega.id);

    assert.ifError(afterError);
    assert.equal(afterCount, beforeCount, 'Cross-org write changed ORG_OMEGA row count; isolation failure');

    assertNoLeak(response.data, [SECRET_NAME, state.omegaSecretStudentId], 'Cross-Org Write');
  });

  it('Test 4 (RPC Leak): ORG_ALPHA cannot read ORG_OMEGA secret balance via get_student_remaining_balance', async () => {
    const { data, error } = await state.alphaClient.rpc('get_student_remaining_balance', {
      p_org_id: state.orgOmega.id,
      p_student_id: state.omegaSecretStudentId,
    });

    // Either explicit denial (error) or safely non-leaking value is acceptable.
    // Returning any non-zero result here is treated as leak signal.
    if (error) {
      assert.ok(true, `RPC call was blocked as expected: ${error.message}`);
      return;
    }

    assert.ok(
      data === null || Number(data) === 0,
      `Expected non-leaking RPC result (null/0), got: ${JSON.stringify(data)}`,
    );
  });
});
