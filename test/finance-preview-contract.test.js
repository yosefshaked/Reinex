import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDesiredChargeDescriptors } from '../api/_shared/BillingLedgerService.js';
import { buildAttendanceTransitionAuditChanges } from '../api/calendar-attendance/index.js';

const BASE_POLICIES = {
  billingConsumptionPolicy: {
    attended: true,
    no_show: false,
    cancelled_student: false,
    cancelled_clinic: false,
  },
};

function service(amount) {
  return { default_customer_charge_amount: amount };
}

describe('finance preview contract - billing descriptors', () => {
  it('builds HMO split charges for attended with active authorization', () => {
    const participant = {
      participant_status: 'attended',
      client_profile_id: 'cp-1',
      student_id: 'st-1',
    };
    const authorization = {
      id: 'auth-1',
      provider_id: 'hmo-1',
      contracted_rate_amount: 12000,
    };

    const result = buildDesiredChargeDescriptors({
      participant,
      service: service(18000),
      authorization,
      policies: BASE_POLICIES,
    });

    assert.equal(result.status, 'debited');
    assert.equal(result.billingReason, 'hmo_split_charge');
    assert.equal(result.entries.length, 2);

    const studentEntry = result.entries.find((entry) => entry.accountType === 'student');
    const hmoEntry = result.entries.find((entry) => entry.accountType === 'hmo_provider');

    assert.ok(studentEntry, 'expected student split entry');
    assert.ok(hmoEntry, 'expected hmo split entry');
    assert.equal(studentEntry.amount, 6000);
    assert.equal(hmoEntry.amount, 12000);
    assert.equal(studentEntry.hmoAuthorizationId, 'auth-1');
    assert.equal(hmoEntry.hmoAuthorizationId, 'auth-1');
  });

  it('returns not chargeable for no_show when policy excludes no_show', () => {
    const participant = {
      participant_status: 'no_show',
      client_profile_id: 'cp-1',
      student_id: 'st-1',
    };

    const result = buildDesiredChargeDescriptors({
      participant,
      service: service(18000),
      authorization: null,
      policies: BASE_POLICIES,
    });

    assert.equal(result.status, 'noop');
    assert.equal(result.billingStatus, 'not_chargeable');
    assert.equal(result.entries.length, 0);
  });

  it('charges cancelled_student when policy includes cancelled_student', () => {
    const participant = {
      participant_status: 'cancelled_student',
      client_profile_id: 'cp-1',
      student_id: 'st-1',
    };
    const policies = {
      billingConsumptionPolicy: {
        ...BASE_POLICIES.billingConsumptionPolicy,
        cancelled_student: true,
      },
    };

    const result = buildDesiredChargeDescriptors({
      participant,
      service: service(18000),
      authorization: null,
      policies,
    });

    assert.equal(result.status, 'debited');
    assert.equal(result.billingReason, 'service_rate_charge');
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].accountType, 'student');
    assert.equal(result.entries[0].amount, 18000);
  });

  it('returns not chargeable for scheduled status (restore baseline)', () => {
    const participant = {
      participant_status: 'scheduled',
      client_profile_id: 'cp-1',
      student_id: 'st-1',
    };

    const result = buildDesiredChargeDescriptors({
      participant,
      service: service(18000),
      authorization: null,
      policies: BASE_POLICIES,
    });

    assert.equal(result.status, 'noop');
    assert.equal(result.billingStatus, 'not_chargeable');
    assert.equal(result.entries.length, 0);
  });
});

describe('finance preview contract - attendance transition audit changes', () => {
  it('includes hmo_task_resolved when restore preview has hmo task to resolve', async () => {
    const preview = {
      participant_status_before: 'attended',
      participant_status_after: 'scheduled',
      lesson_status_before: 'completed',
      lesson_status_after: 'scheduled',
      impacts: [{ type: 'hmo_task_resolve', task_id: 'task-1', message: 'resolve task' }],
      projected: {
        billing_amount_reversed: 18000,
        billing_amount_added: 0,
        instructor_earning_removed: 0,
        instructor_earning_added: 0,
        instructor_earning_before: 0,
        instructor_earning_after: 0,
        instructor_attendance_worked_minutes_before: 45,
        instructor_attendance_worked_minutes: null,
        hmo_task_id_to_resolve: 'task-1',
      },
    };

    const changes = await buildAttendanceTransitionAuditChanges(preview);
    assert.ok(changes.some((change) => change.field === 'hmo_task_resolved' && change.after === true));
  });

  it('does not include hmo_task_resolved when restore preview has no hmo task', async () => {
    const preview = {
      participant_status_before: 'attended',
      participant_status_after: 'scheduled',
      lesson_status_before: 'completed',
      lesson_status_after: 'scheduled',
      impacts: [],
      projected: {
        billing_amount_reversed: 18000,
        billing_amount_added: 0,
        instructor_earning_removed: 0,
        instructor_earning_added: 0,
        instructor_earning_before: 0,
        instructor_earning_after: 0,
        instructor_attendance_worked_minutes_before: 45,
        instructor_attendance_worked_minutes: null,
        hmo_task_id_to_resolve: null,
      },
    };

    const changes = await buildAttendanceTransitionAuditChanges(preview);
    assert.ok(!changes.some((change) => change.field === 'hmo_task_resolved'));
  });
});
