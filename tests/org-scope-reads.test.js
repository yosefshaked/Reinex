// Everything is read in the organisation the request is signed in to. The API uses the service-role
// client (RLS is bypassed), so each helper must filter by org_id itself: a row of another
// organisation is "not found", even when its id is passed in, and the same person can have
// different rows in different organisations.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_INSTRUCTOR_EARNINGS_POLICY,
  DEFAULT_LEAVE_PAY_POLICY,
  assertNoLeaveForAttendance,
  assertNoLeaveForLesson,
  assertNoOperationalConflictsForLeave,
  checkInstructorRateForLesson,
  fetchApprovedLeaveDays,
  fetchAttendanceRecords,
  listFinanceCorrections,
  loadGraceCancellationParticipantIds,
  resolveEmployeeRecord,
  validateInstructorRateForLesson,
} from '../api/_shared/employee-finance.js';
import { computeEmployeePay, loadWorkedDates } from '../api/_shared/pay-calculation.js';
import { fetchLessonMutationState, resolveActorInstructorId } from '../api/_shared/calendar-editing.js';
import { buildInstanceCorrectionPreview, enrichInstancesWithCorrectionState } from '../api/_shared/calendar-corrections.js';
import {
  ensureStudentForClientProfile,
  fetchPrimaryGuardianForClientProfile,
  findClientProfileById,
  findClientProfileByIdentityNumber,
} from '../api/_shared/client-profiles.js';
import { fetchMatchingStudentClientProfileIds } from '../api/_shared/student-search.js';
import { fetchStudentIdsByInstructor } from '../api/_shared/instructor-student-scope.js';
import { ensureInstructorColors } from '../api/_shared/instructor-colors.js';
import { resolveSessionFormVersion } from '../api/_shared/session-metadata.js';
import BillingLedgerService from '../api/_shared/BillingLedgerService.js';
import { PAY_BASIS } from '../api/_shared/rate-history.js';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER = '99999999-9999-4999-8999-999999999999';
const EMP_A = '11111111-1111-4111-8111-111111111111';
const EMP_B = '22222222-2222-4222-8222-222222222222';
const LESSON_B = '33333333-3333-4333-8333-333333333333';
const PARTICIPANT_B = '44444444-4444-4444-8444-444444444444';
const PROFILE_A = '55555555-5555-4555-8555-555555555555';
const PROFILE_B = '66666666-6666-4666-8666-666666666666';

const POLICIES = {
  instructorEarningsPolicy: { ...DEFAULT_INSTRUCTOR_EARNINGS_POLICY },
  leavePayPolicy: { ...DEFAULT_LEAVE_PAY_POLICY },
};

/** An in-memory database with enough of the query builder for these helpers; it records writes. */
function createFakeClient(tables) {
  const writes = [];
  function builder(table) {
    const filters = [];
    let window = null;
    let limitCount = null;
    let pendingWrite = null;
    const rowsNow = () => {
      const rows = (tables[table] || []).filter((row) => filters.every((filter) => filter(row)));
      const windowed = window ? rows.slice(window[0], window[1] + 1) : rows;
      return limitCount === null ? windowed : windowed.slice(0, limitCount);
    };
    const api = {
      select() { return api; },
      insert(payload) { pendingWrite = { op: 'insert', table, payload }; writes.push(pendingWrite); return api; },
      update(payload) { pendingWrite = { op: 'update', table, payload }; writes.push(pendingWrite); return api; },
      upsert(payload) { pendingWrite = { op: 'upsert', table, payload }; writes.push(pendingWrite); return api; },
      delete() { pendingWrite = { op: 'delete', table }; writes.push(pendingWrite); return api; },
      eq(column, value) { filters.push((row) => row[column] === value); return api; },
      neq(column, value) { filters.push((row) => row[column] !== value); return api; },
      in(column, values) { filters.push((row) => values.includes(row[column])); return api; },
      is(column, value) { filters.push((row) => (row[column] ?? null) === value); return api; },
      gt(column, value) { filters.push((row) => String(row[column]) > String(value)); return api; },
      gte(column, value) { filters.push((row) => String(row[column]) >= String(value)); return api; },
      lte(column, value) { filters.push((row) => String(row[column]) <= String(value)); return api; },
      lt(column, value) { filters.push((row) => String(row[column]) < String(value)); return api; },
      contains() { return api; },
      or() { return api; },
      ilike() { return api; },
      order() { return api; },
      limit(count) { limitCount = count; return api; },
      range(from, to) { window = [from, to]; return api; },
      maybeSingle() {
        if (pendingWrite) return Promise.resolve({ data: null, error: null });
        return Promise.resolve({ data: rowsNow()[0] || null, error: null });
      },
      single() {
        if (pendingWrite) return Promise.resolve({ data: { id: 'new-row', ...(pendingWrite.payload || {}) }, error: null });
        const row = rowsNow()[0] || null;
        return Promise.resolve({ data: row, error: row ? null : { message: 'no rows' } });
      },
      then(resolve, reject) {
        const data = pendingWrite ? [] : rowsNow();
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  return { from: builder, writes };
}

/** Org A and org B, each with an employee for the same person (USER), and B's data around B's employee. */
function twoOrgTables(extra = {}) {
  return {
    // B's row is listed first, so a lookup without the org filter would pick it.
    Employees: [
      { id: EMP_B, org_id: ORG_B, user_id: USER, first_name: 'Bella', last_name: 'B', annual_leave_days: 30 },
      { id: EMP_A, org_id: ORG_A, user_id: USER, first_name: 'Anna', last_name: 'A', annual_leave_days: 12 },
    ],
    employee_attendance_records: [
      { id: 'att-b', org_id: ORG_B, employee_id: EMP_B, attendance_date: '2026-10-05', status: 'present', other_minutes: 480 },
    ],
    employee_leave_days: [
      { id: 'leave-day-b', org_id: ORG_B, employee_id: EMP_B, leave_entry_id: 'leave-b', leave_date: '2026-10-06', leave_type: 'employee_paid', pay_fraction: 1 },
    ],
    employee_leave_entries: [
      { id: 'leave-b', org_id: ORG_B, employee_id: EMP_B, status: 'approved' },
    ],
    finance_corrections: [
      { id: 'bonus-b', org_id: ORG_B, employee_id: EMP_B, correction_type: 'bonus', amount: 50000, effective_date: '2026-10-10' },
    ],
    grace_cancellation_requests: [
      { id: 'grace-b', org_id: ORG_B, lesson_participant_id: PARTICIPANT_B },
    ],
    lesson_instances: [
      { id: LESSON_B, org_id: ORG_B, instructor_employee_id: EMP_B, service_id: 'riding-b', datetime_start: '2026-10-07T08:00:00Z', duration_minutes: 60, status: 'scheduled', version: 1 },
    ],
    lesson_participants: [
      { id: PARTICIPANT_B, org_id: ORG_B, lesson_instance_id: LESSON_B, student_id: 'student-b', participant_status: 'attended', version: 1 },
    ],
    instance_locks: [],
    participant_locks: [],
    calendar_instance_corrections: [],
    ledger_transactions: [],
    claim_batches: [],
    Services: [{ id: 'riding-b', org_id: ORG_B, name: 'Riding B', payment_model: 'fixed_rate' }],
    RateHistory: [
      { id: 'rate-b', org_id: ORG_B, employee_id: EMP_B, service_id: 'riding-b', pay_basis: PAY_BASIS.LESSON_HOURLY, rate: 10000, effective_date: '2026-01-01' },
    ],
    Settings: [],
    SettingsHistory: [],
    ...extra,
  };
}

describe('employee pay and leave helpers read one organisation', () => {
  it('an employee id of another organisation is not found', async () => {
    const client = createFakeClient(twoOrgTables());
    assert.deepEqual(
      await resolveEmployeeRecord(client, ORG_A, { employeeId: EMP_B, userId: USER, canManageAll: true }),
      { error: 'employee_not_found' },
    );
    const own = await resolveEmployeeRecord(client, ORG_B, { employeeId: EMP_B, userId: USER, canManageAll: true });
    assert.equal(own.employee.id, EMP_B);
  });

  it('the same person signed in to org A gets their org A employee row, not the one in org B', async () => {
    const client = createFakeClient(twoOrgTables());
    const result = await resolveEmployeeRecord(client, ORG_A, { userId: USER, canManageAll: false });
    assert.equal(result.employee.id, EMP_A);
    assert.equal(result.employee.annual_leave_days, 12);
  });

  it('attendance, leave, bonuses and grace requests of org B are not returned to org A', async () => {
    const client = createFakeClient(twoOrgTables());
    const range = { employeeId: EMP_B, startDate: '2026-10-01', endDate: '2026-10-31' };
    assert.deepEqual(await fetchAttendanceRecords(client, ORG_A, range), []);
    assert.deepEqual(await fetchApprovedLeaveDays(client, ORG_A, range), []);
    assert.deepEqual(await listFinanceCorrections(client, ORG_A, { employeeId: EMP_B }), []);
    assert.equal((await loadGraceCancellationParticipantIds(client, ORG_A, [PARTICIPANT_B])).size, 0);

    // The same reads in org B do find them, so the empty answers above are the org filter.
    assert.equal((await fetchAttendanceRecords(client, ORG_B, range)).length, 1);
    assert.equal((await fetchApprovedLeaveDays(client, ORG_B, range)).length, 1);
    assert.equal((await listFinanceCorrections(client, ORG_B, { employeeId: EMP_B })).length, 1);
    assert.equal((await loadGraceCancellationParticipantIds(client, ORG_B, [PARTICIPANT_B])).size, 1);
  });

  it('conflict checks in org A see nothing of org B (no 409 that reveals B\'s leave or lessons)', async () => {
    const client = createFakeClient(twoOrgTables());
    assert.equal(await assertNoLeaveForAttendance(client, ORG_A, { employeeId: EMP_B, date: '2026-10-06' }), null);
    assert.equal(await assertNoOperationalConflictsForLeave(client, ORG_A, {
      employeeId: EMP_B, startDate: '2026-10-01', endDate: '2026-10-31',
    }), null);
    assert.equal((await assertNoLeaveForAttendance(client, ORG_B, { employeeId: EMP_B, date: '2026-10-06' })).code, 'leave_conflict');
  });

  it('pay computed in org A for an employee of org B has nothing in it', async () => {
    const client = createFakeClient(twoOrgTables());
    const pay = await computeEmployeePay(client, ORG_A, {
      employee: { id: EMP_B },
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      policies: POLICIES,
      now: new Date('2026-11-01T00:00:00Z'),
    });
    assert.equal(pay.total_amount, 0);
    assert.equal(pay.attendance_minutes, 0);
    assert.equal(pay.lesson_count, 0);
    assert.deepEqual(pay.corrections, []);
    assert.equal(pay.leave_breakdown.employee_paid_days, 0);
    assert.deepEqual(await loadWorkedDates(client, ORG_A, {
      employeeId: EMP_B, startDate: '2026-10-01', endDate: '2026-10-31', policies: POLICIES,
    }), []);
  });

  it('the lesson-rate check reads the instructor and service in the request\'s organisation only', async () => {
    const client = createFakeClient(twoOrgTables());
    const blocked = await validateInstructorRateForLesson(client, {
      orgId: ORG_A, instructorEmployeeId: EMP_B, serviceId: 'riding-b', lessonDate: '2026-10-07T08:00:00Z',
    });
    assert.equal(blocked.code, 'instructor_rate_not_configured', 'B\'s rate does not count in org A');
    assert.doesNotMatch(blocked.message, /Bella|Riding B/, 'B\'s names are not revealed');

    // The org is never taken from the lesson row: without it the check fails closed.
    const noOrg = await checkInstructorRateForLesson(client, { lessonInstanceId: LESSON_B });
    assert.equal(noOrg.status, 500);
  });

  it('every helper refuses to run without an organisation id', async () => {
    const client = createFakeClient(twoOrgTables());
    await assert.rejects(resolveEmployeeRecord(client, '', { employeeId: EMP_B, userId: USER, canManageAll: true }));
    await assert.rejects(fetchAttendanceRecords(client, undefined, { employeeId: EMP_B, startDate: '2026-10-01', endDate: '2026-10-31' }));
    await assert.rejects(fetchApprovedLeaveDays(client, null, { employeeId: EMP_B, startDate: '2026-10-01', endDate: '2026-10-31' }));
    await assert.rejects(listFinanceCorrections(client, '', {}));
    await assert.rejects(loadGraceCancellationParticipantIds(client, '', [PARTICIPANT_B]));
  });
});

describe('calendar helpers read one organisation', () => {
  it('a lesson of org B is not found when editing from org A', async () => {
    const client = createFakeClient(twoOrgTables());
    const { error, result } = await fetchLessonMutationState(client, ORG_A, { instanceId: LESSON_B, participantId: PARTICIPANT_B });
    assert.equal(error, null);
    assert.equal(result.instance, null);
    assert.equal(result.participant, null);
    const inB = await fetchLessonMutationState(client, ORG_B, { instanceId: LESSON_B });
    assert.equal(inB.result.instance.id, LESSON_B);
  });

  it('the signed-in instructor is their employee row in this organisation', async () => {
    const client = createFakeClient(twoOrgTables());
    assert.equal((await resolveActorInstructorId(client, ORG_A, USER)).instructorId, EMP_A);
    assert.equal((await resolveActorInstructorId(client, ORG_B, USER)).instructorId, EMP_B);
  });

  it('a correction preview of org B\'s lesson from org A is "not found" (null), not B\'s lesson and pay', async () => {
    const client = createFakeClient(twoOrgTables());
    assert.equal(await buildInstanceCorrectionPreview(client, { orgId: ORG_A, originalInstanceId: LESSON_B }), null);
    await assert.rejects(buildInstanceCorrectionPreview(client, { originalInstanceId: LESSON_B }));
  });

  it('correction state for a calendar is read in the calendar\'s organisation', async () => {
    const client = createFakeClient(twoOrgTables({
      calendar_instance_corrections: [{ id: 'corr-b', org_id: ORG_B, original_instance_id: LESSON_B, status: 'applied', effective_state: {} }],
    }));
    const [row] = await enrichInstancesWithCorrectionState(client, ORG_A, [{ id: LESSON_B, participants: [] }]);
    assert.ok(!row.latest_correction && !row.correction, 'no correction of org B is attached');
  });
});

describe('client, student and billing helpers read one organisation', () => {
  const profileTables = () => twoOrgTables({
    client_profiles: [
      { id: PROFILE_B, org_id: ORG_B, identity_number: '123456782', first_name: 'B-profile' },
      { id: PROFILE_A, org_id: ORG_A, identity_number: '123456782', first_name: 'A-profile' },
    ],
    client_guardians: [{ org_id: ORG_B, client_profile_id: PROFILE_B, guardian_id: 'guardian-b', relationship: 'parent', is_primary: true }],
    guardians: [{ id: 'guardian-b', org_id: ORG_B, first_name: 'Guardian', last_name: 'B', phone: '0500000000' }],
    students: [],
  });

  it('the same identity number in two organisations finds this organisation\'s profile', async () => {
    const client = createFakeClient(profileTables());
    const { data } = await findClientProfileByIdentityNumber(client, '123456782', { orgId: ORG_A });
    assert.equal(data.id, PROFILE_A);
    const withoutOrg = await findClientProfileByIdentityNumber(client, '123456782');
    assert.equal(withoutOrg.data, null);
    assert.ok(withoutOrg.error, 'a lookup without the organisation is an error, not a search of every organisation');
  });

  it('a profile, guardian or search hit of org B is not visible from org A', async () => {
    const client = createFakeClient(profileTables());
    assert.equal((await findClientProfileById(client, ORG_A, PROFILE_B)).data, null);
    assert.equal((await fetchPrimaryGuardianForClientProfile(client, ORG_A, PROFILE_B)).guardian, null);
    assert.equal((await fetchPrimaryGuardianForClientProfile(client, ORG_B, PROFILE_B)).guardian.id, 'guardian-b');
    const { ids } = await fetchMatchingStudentClientProfileIds(client, ORG_A, 'B-profile');
    assert.ok(!ids.includes(PROFILE_B));
  });

  it('a student is never created (or returned) in org A for a profile of org B', async () => {
    const client = createFakeClient(profileTables());
    const result = await ensureStudentForClientProfile(client, ORG_A, PROFILE_B);
    assert.deepEqual(result, { student: null, created: false, error: 'client_profile_not_found' });
    assert.equal(client.writes.length, 0);
  });

  it('org B\'s ledger transaction cannot be reversed from org A', async () => {
    const client = createFakeClient(twoOrgTables({
      ledger_transactions: [{ id: 'tx-b', org_id: ORG_B, source_type: 'manual_payment', direction: 'credit', amount: 10000 }],
    }));
    const service = new BillingLedgerService({ tenantClient: client, orgId: ORG_A });
    await assert.rejects(service.reverseTransaction({ transactionId: 'tx-b', actorUserId: USER, reasonCode: 'manual_reversal' }), /transaction_not_reversible/);
    assert.equal(client.writes.length, 0);
  });

  it('instructor-scoped students, instructor colours and the session form version need the organisation', async () => {
    const client = createFakeClient(twoOrgTables({
      lesson_templates: [{ id: 'tpl-b', org_id: ORG_B, instructor_employee_id: EMP_B, student_id: 'student-b', is_active: true }],
      lesson_template_participants: [],
      Settings: [{ org_id: ORG_B, key: 'session_form_config', settings_value: { version: 7 } }],
    }));
    assert.deepEqual((await fetchStudentIdsByInstructor(client, EMP_B, { orgId: ORG_A })).studentIds, []);
    assert.deepEqual((await fetchStudentIdsByInstructor(client, EMP_B, { orgId: ORG_B })).studentIds, ['student-b']);
    assert.ok((await fetchStudentIdsByInstructor(client, EMP_B)).error);
    assert.equal((await resolveSessionFormVersion(client, ORG_A)).version, null);
    assert.equal((await resolveSessionFormVersion(client, ORG_B)).version, 7);

    // Colours are assigned among one organisation's employees; org B's rows are never rewritten.
    const colours = await ensureInstructorColors(client, { orgId: ORG_A, table: 'Employees', columns: 'id, metadata' });
    assert.ok(!colours.error);
    const touchedB = client.writes.some((write) => write.table === 'Employees' && write.op === 'update'
      && JSON.stringify(write).includes(EMP_B));
    assert.equal(touchedB, false);
    assert.ok((await ensureInstructorColors(client, { table: 'Employees' })).error);
  });
});

describe('a half-day leave shares the day with work; a full-day leave does not', () => {
  const DAY = '2026-10-06';
  const tablesWithLeave = ({ dayPortion, entryDuration = 'full_day', leaveType = 'employee_paid', payFraction = 1 }) => twoOrgTables({
    employee_leave_days: [
      { id: 'ld', org_id: ORG_A, employee_id: EMP_A, leave_entry_id: 'le', leave_date: DAY, day_portion: dayPortion, leave_type: leaveType, pay_fraction: payFraction },
    ],
    employee_leave_entries: [
      { id: 'le', org_id: ORG_A, employee_id: EMP_A, status: 'approved', duration_mode: entryDuration, leave_type: leaveType },
    ],
    employee_attendance_records: [
      { id: 'att-a', org_id: ORG_A, employee_id: EMP_A, attendance_date: DAY, status: 'present', other_minutes: 240 },
    ],
    lesson_instances: [
      { id: 'lesson-a', org_id: ORG_A, instructor_employee_id: EMP_A, service_id: 'riding-b', datetime_start: '2026-10-06T08:00:00Z', duration_minutes: 60, status: 'scheduled' },
    ],
  });

  it('a full leave day refuses hours and lessons', async () => {
    const client = createFakeClient(tablesWithLeave({ dayPortion: 'full_day' }));
    assert.equal((await assertNoLeaveForAttendance(client, ORG_A, { employeeId: EMP_A, date: DAY })).code, 'leave_conflict');
    assert.equal((await assertNoLeaveForLesson(client, ORG_A, { employeeId: EMP_A, date: DAY })).message, 'lesson_conflicts_with_leave');
  });

  it('a half leave day (day portion, entry mode or legacy type) allows hours and lessons', async () => {
    for (const tables of [
      tablesWithLeave({ dayPortion: 'first_half', entryDuration: 'half_day', payFraction: 0.5 }),
      tablesWithLeave({ dayPortion: 'full_day', entryDuration: 'half_day' }),
      tablesWithLeave({ dayPortion: 'full_day', leaveType: 'half_day', payFraction: 0.5 }),
    ]) {
      const client = createFakeClient(tables);
      assert.equal(await assertNoLeaveForAttendance(client, ORG_A, { employeeId: EMP_A, date: DAY }), null);
      assert.equal(await assertNoLeaveForLesson(client, ORG_A, { employeeId: EMP_A, date: DAY }), null);
    }
  });

  it('a full leave over a day with hours or lessons is refused; a half leave there is allowed', async () => {
    const client = createFakeClient(tablesWithLeave({ dayPortion: 'full_day' }));
    const range = { employeeId: EMP_A, startDate: DAY, endDate: DAY };
    assert.equal((await assertNoOperationalConflictsForLeave(client, ORG_A, range)).code, 'attendance_conflict');
    assert.equal(await assertNoOperationalConflictsForLeave(client, ORG_A, { ...range, halfDay: true }), null);
    const lessonsOnly = createFakeClient({ ...tablesWithLeave({ dayPortion: 'full_day' }), employee_attendance_records: [] });
    assert.equal((await assertNoOperationalConflictsForLeave(lessonsOnly, ORG_A, range)).code, 'lesson_conflict');
    assert.equal(await assertNoOperationalConflictsForLeave(lessonsOnly, ORG_A, { ...range, halfDay: true }), null);
  });

  it('the day counts as worked and pay includes both the half leave and the hours', async () => {
    const client = createFakeClient(tablesWithLeave({ dayPortion: 'first_half', entryDuration: 'half_day', payFraction: 0.5 }));
    const worked = await loadWorkedDates(client, ORG_A, { employeeId: EMP_A, startDate: '2026-10-01', endDate: '2026-10-31' });
    assert.deepEqual(worked, [DAY]);
    const pay = await computeEmployeePay(client, ORG_A, {
      employee: { id: EMP_A, working_days: { days: [0, 1, 2, 3, 4] } },
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      policies: POLICIES,
      now: new Date('2026-11-01T00:00:00Z'),
    });
    assert.equal(pay.attendance_minutes, 240);
    assert.equal(pay.leave_breakdown.employee_paid_days, 1);
  });
});
