// @ts-check
/* eslint-env node */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import BillingLedgerService from '../api/_shared/BillingLedgerService.js';
import { fetchBillingSnapshot } from '../api/_shared/student-billing.js';
import { auditFinanceCalendarInvariants } from '../scripts/audit-finance-calendar-invariants.js';
import { createMockSupabaseClient } from './support/mock-supabase-client.js';

const ORG_ID = 'org-workflow';
const SERVICE_ID = 'svc-therapy';
const STUDENT_ID = 'student-1';
const CLIENT_PROFILE_ID = 'client-1';
const INSTANCE_ID = 'instance-1';
const PARTICIPANT_ID = 'participant-1';
const AUTHORIZATION_ID = 'auth-1';
const ACTOR_USER_ID = 'user-admin';
const LESSON_START = '2026-04-26T13:30:00.000Z';
const CLOCK = () => '2026-04-26T14:00:00.000Z';

function makeWorkflowClient({ settings = [], participantStatus = 'scheduled', serviceAmount = 9500 } = {}) {
  const clientProfile = {
    id: CLIENT_PROFILE_ID,
    org_id: ORG_ID,
    first_name: 'בדיקה',
    middle_name: null,
    last_name: 'שגב',
  };
  const instance = {
    id: INSTANCE_ID,
    org_id: ORG_ID,
    template_id: 'template-1',
    instructor_employee_id: 'employee-1',
    service_id: SERVICE_ID,
    datetime_start: LESSON_START,
    duration_minutes: 30,
    status: 'scheduled',
    is_closed: false,
    metadata: { generated_from_template: true },
  };
  const participant = {
    id: PARTICIPANT_ID,
    org_id: ORG_ID,
    lesson_instance_id: INSTANCE_ID,
    client_profile_id: CLIENT_PROFILE_ID,
    student_id: STUDENT_ID,
    participant_status: participantStatus,
    metadata: {},
    client_profile: clientProfile,
    lesson_instance: instance,
  };

  const seededSettings = [
    {
      key: 'billing_consumption_policy',
      settings_value: {
        attended: true,
        no_show: true,
        cancelled_student: true,
        cancelled_clinic: true,
      },
    },
    ...settings,
  ];

  return createMockSupabaseClient({
    Settings: seededSettings.map((row) => ({ org_id: ORG_ID, ...row })),
    Services: [{
      id: SERVICE_ID,
      org_id: ORG_ID,
      name: 'בדיקה טיפולית',
      color: '#16a34a',
      duration_minutes: 30,
      default_customer_charge_amount: serviceAmount,
      is_active: true,
    }],
    Employees: [{
      id: 'employee-1',
      org_id: ORG_ID,
      first_name: 'מטפל',
      last_name: 'בדיקה',
      employee_type: 'instructor',
    }],
    client_profiles: [clientProfile],
    students: [{
      id: STUDENT_ID,
      org_id: ORG_ID,
      client_profile_id: CLIENT_PROFILE_ID,
      client_profile: clientProfile,
    }],
    lesson_templates: [{
      id: 'template-1',
      org_id: ORG_ID,
      instructor_employee_id: 'employee-1',
      service_id: SERVICE_ID,
      day_of_week: 0,
      time_of_day: '16:30',
      duration_minutes: 30,
      status: 'active',
    }],
    lesson_instances: [instance],
    lesson_participants: [participant],
    hmo_providers: [{
      id: 'hmo-1',
      org_id: ORG_ID,
      name: 'קופת בדיקה',
      is_active: true,
    }],
    hmo_provider_tracks: [{
      id: 'track-1',
      org_id: ORG_ID,
      provider_id: 'hmo-1',
      name: 'מסלול בדיקה',
      is_active: true,
      default_customer_charge_amount: 4500,
      default_insurer_claim_amount: 5000,
      default_post_coverage_policy: 'service_default',
      default_post_coverage_customer_charge_amount: null,
    }],
    hmo_authorizations: [{
      id: AUTHORIZATION_ID,
      org_id: ORG_ID,
      student_id: STUDENT_ID,
      service_id: SERVICE_ID,
      provider_id: 'hmo-1',
      provider_track_id: 'track-1',
      authorization_reference: 'AUTH-WORKFLOW',
      authorized_lessons: 10,
      valid_from: '2026-04-01',
      expires_at: '2026-05-31',
      covered_customer_charge_amount: 4500,
      covered_insurer_claim_amount: 5000,
      post_coverage_policy: 'service_default',
      post_coverage_customer_charge_amount: null,
      status: 'active',
      metadata: {},
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-01T00:00:00.000Z',
      student: { client_profile_id: CLIENT_PROFILE_ID },
    }],
  });
}

function setParticipantStatus(client, status) {
  const participant = client._store.lesson_participants.find((row) => row.id === PARTICIPANT_ID);
  assert.ok(participant, 'seeded participant missing');
  participant.participant_status = status;
  participant.lesson_instance = {
    ...participant.lesson_instance,
    status: status === 'scheduled' ? 'scheduled' : 'completed',
  };
  const instance = client._store.lesson_instances.find((row) => row.id === INSTANCE_ID);
  assert.ok(instance, 'seeded instance missing');
  instance.status = participant.lesson_instance.status;
}

function activeLessonCharges(client) {
  const reversedIds = new Set(client._store.ledger_transactions
    .map((row) => row.reverses_transaction_id)
    .filter(Boolean));
  return client._store.ledger_transactions.filter((row) => (
    row.source_type === 'lesson_charge'
    && !row.reverses_transaction_id
    && !reversedIds.has(row.id)
  ));
}

function sumActiveCharges(client, predicate) {
  return activeLessonCharges(client)
    .filter(predicate)
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

async function syncParticipant(client, reasonCode) {
  const service = new BillingLedgerService({ tenantClient: client, orgId: ORG_ID, clock: CLOCK });
  return service.syncLessonParticipantCharge({
    lessonParticipantId: PARTICIPANT_ID,
    actorUserId: ACTOR_USER_ID,
    reasonCode,
  });
}

async function fetchStudentSnapshot(client) {
  return fetchBillingSnapshot(client, {
    orgId: ORG_ID,
    studentId: STUDENT_ID,
    startDate: '2026-04-01',
    endDate: '2026-04-30',
  });
}

describe('finance/calendar self-seeded workflows', () => {
  it('created template instance -> no-show -> private student charge, no HMO claim, profile snapshot updated', async () => {
    const client = makeWorkflowClient();

    setParticipantStatus(client, 'no_show');
    const result = await syncParticipant(client, 'attendance_marked_no_show');
    assert.equal(result.status, 'debited');

    assert.equal(sumActiveCharges(client, (row) => row.student_id === STUDENT_ID), 9500);
    assert.equal(sumActiveCharges(client, (row) => row.hmo_provider_id === 'hmo-1'), 0);
    assert.equal(activeLessonCharges(client).length, 1);

    const snapshot = await fetchStudentSnapshot(client);
    assert.equal(snapshot.summary.lesson_charge_total, 9500);
    assert.equal(snapshot.summary.hmo_charge_total, 0);
    assert.equal(snapshot.summary.balance, -9500);
    assert.equal(snapshot.lesson_history[0].participant_status, 'no_show');
    assert.equal(snapshot.lesson_history[0].student_charge_amount, 9500);
    assert.equal(snapshot.lesson_history[0].hmo_charge_amount, 0);
    assert.equal(snapshot.lesson_history[0].hmo_authorization_usage.authorization_id, AUTHORIZATION_ID);
    assert.equal(snapshot.lesson_history[0].hmo_authorization_usage.authorization_reference, 'AUTH-WORKFLOW');
    assert.equal(snapshot.lesson_history[0].hmo_authorization_usage.usage_bucket, 'not_counted');
    assert.equal(snapshot.lesson_history[0].hmo_authorization_usage.counts_toward_authorization, false);
    assert.equal(snapshot.authorizations[0].lesson_counts.consumed_lessons, 0);

    const audit = auditFinanceCalendarInvariants({
      participants: client._store.lesson_participants,
      ledgerTransactions: client._store.ledger_transactions,
    });
    assert.deepEqual(audit.findings, []);
  });

  it('calendar restore workflow reverses the no-show charge instead of charging again', async () => {
    const client = makeWorkflowClient();

    setParticipantStatus(client, 'no_show');
    await syncParticipant(client, 'attendance_marked_no_show');
    setParticipantStatus(client, 'scheduled');
    const restoreResult = await syncParticipant(client, 'attendance_restored_scheduled');

    assert.equal(restoreResult.status, 'reversed_only');
    assert.equal(activeLessonCharges(client).length, 0);
    assert.equal(client._store.ledger_transactions.filter((row) => row.source_type === 'lesson_charge').length, 1);
    assert.equal(client._store.ledger_transactions.filter((row) => row.source_type === 'reversal').length, 1);

    const snapshot = await fetchStudentSnapshot(client);
    assert.equal(snapshot.summary.lesson_charge_total, 0);
    assert.equal(snapshot.summary.payment_total, 0);
    assert.equal(snapshot.summary.balance, 0);
    assert.equal(snapshot.lesson_history[0].billing_status, 'not_chargeable');

    const audit = auditFinanceCalendarInvariants({
      participants: client._store.lesson_participants,
      ledgerTransactions: client._store.ledger_transactions,
    });
    assert.deepEqual(audit.findings, []);
  });

  it('org policy switch from HMO coverage to private non-attendance resyncs active rows without stale HMO claims', async () => {
    const client = makeWorkflowClient({
      settings: [{
        key: 'hmo_non_attendance_billing_policy',
        settings_value: JSON.stringify('hmo_coverage'),
      }],
    });

    setParticipantStatus(client, 'no_show');
    await syncParticipant(client, 'attendance_marked_no_show');
    assert.equal(sumActiveCharges(client, (row) => row.student_id === STUDENT_ID), 4500);
    assert.equal(sumActiveCharges(client, (row) => row.hmo_provider_id === 'hmo-1'), 5000);

    client._store.Settings = [{
      id: 'setting-billing-policy',
      org_id: ORG_ID,
      key: 'billing_consumption_policy',
      settings_value: {
        attended: true,
        no_show: true,
        cancelled_student: true,
        cancelled_clinic: true,
      },
    }, {
      id: 'setting-hmo-non-attendance',
      org_id: ORG_ID,
      key: 'hmo_non_attendance_billing_policy',
      settings_value: JSON.stringify('student_private_rate'),
    }];

    const service = new BillingLedgerService({ tenantClient: client, orgId: ORG_ID, clock: CLOCK });
    const resyncResult = await service.resyncBillingPolicyParticipants({
      actorUserId: ACTOR_USER_ID,
      reasonCode: 'policy_changed_to_private_non_attendance',
    });

    assert.equal(resyncResult.syncedParticipantCount, 1);
    assert.equal(resyncResult.reversedTransactionCount, 2);
    assert.equal(resyncResult.createdTransactionCount, 1);
    assert.equal(sumActiveCharges(client, (row) => row.student_id === STUDENT_ID), 9500);
    assert.equal(sumActiveCharges(client, (row) => row.hmo_provider_id === 'hmo-1'), 0);
    assert.equal(activeLessonCharges(client).length, 1);

    const snapshot = await fetchStudentSnapshot(client);
    assert.equal(snapshot.summary.lesson_charge_total, 9500);
    assert.equal(snapshot.summary.hmo_charge_total, 0);
    assert.equal(snapshot.authorizations[0].lesson_counts.consumed_lessons, 0);

    const audit = auditFinanceCalendarInvariants({
      participants: client._store.lesson_participants,
      ledgerTransactions: client._store.ledger_transactions,
      hmoNonAttendanceBillingPolicy: 'student_private_rate',
    });
    assert.deepEqual(audit.findings, []);
  });

  it('manual student payment and attended HMO split appear together in the same student finance snapshot', async () => {
    const client = makeWorkflowClient();

    setParticipantStatus(client, 'attended');
    await syncParticipant(client, 'attendance_marked_attended');

    const service = new BillingLedgerService({ tenantClient: client, orgId: ORG_ID, clock: CLOCK });
    await service.appendManualCredit({
      accountType: 'student',
      accountRefId: STUDENT_ID,
      amount: 4500,
      effectiveAt: LESSON_START,
      actorUserId: ACTOR_USER_ID,
      sourceType: 'manual_payment',
      notes: 'receipt 123456',
    });

    const snapshot = await fetchStudentSnapshot(client);
    assert.equal(snapshot.summary.lesson_charge_total, 4500);
    assert.equal(snapshot.summary.hmo_charge_total, 5000);
    assert.equal(snapshot.summary.payment_total, 4500);
    assert.equal(snapshot.summary.balance, 0);
    assert.equal(snapshot.lesson_history[0].student_charge_amount, 4500);
    assert.equal(snapshot.lesson_history[0].hmo_charge_amount, 5000);
    assert.equal(snapshot.lesson_history[0].hmo_authorization_usage.authorization_id, AUTHORIZATION_ID);
    assert.equal(snapshot.lesson_history[0].hmo_authorization_usage.authorization_reference, 'AUTH-WORKFLOW');
    assert.equal(snapshot.lesson_history[0].hmo_authorization_usage.provider_name, 'קופת בדיקה');
    assert.equal(snapshot.lesson_history[0].hmo_authorization_usage.provider_track_name, 'מסלול בדיקה');
    assert.equal(snapshot.lesson_history[0].hmo_authorization_usage.usage_bucket, 'consumed');
    assert.equal(snapshot.lesson_history[0].hmo_authorization_usage.counts_toward_authorization, true);
    assert.equal(snapshot.authorizations[0].lesson_counts.consumed_lessons, 1);
  });
});
