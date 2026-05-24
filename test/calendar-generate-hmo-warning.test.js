import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildHmoCoverageWarning } from '../api/calendar-generate/hmo-warning.js';

const ACTIVE_AUTH = {
  id: 'auth-1',
  student_id: 'st-1',
  service_id: 'svc-1',
  status: 'active',
  valid_from: '2026-04-01',
  expires_at: '2026-04-30',
};

describe('buildHmoCoverageWarning — early return on missing fields', () => {
  it('returns null when student_id is missing', () => {
    assert.equal(buildHmoCoverageWarning({ service_id: 'svc-1', target_date: '2026-04-20' }, []), null);
  });

  it('returns null when service_id is missing', () => {
    assert.equal(buildHmoCoverageWarning({ student_id: 'st-1', target_date: '2026-04-20' }, []), null);
  });

  it('returns null when both target_date and datetime_start are missing', () => {
    assert.equal(buildHmoCoverageWarning({ student_id: 'st-1', service_id: 'svc-1' }, []), null);
  });

  it('returns null when candidate itself is null', () => {
    assert.equal(buildHmoCoverageWarning(null, []), null);
  });
});

describe('buildHmoCoverageWarning — target_date fallback from datetime_start', () => {
  it('uses datetime_start date part when target_date is absent', () => {
    const candidate = { student_id: 'st-1', service_id: 'svc-1', datetime_start: '2026-04-20T15:00:00' };
    const warning = buildHmoCoverageWarning(candidate, []);
    assert.ok(warning);
    assert.equal(warning.target_date, '2026-04-20');
  });
});

describe('buildHmoCoverageWarning — no authorization found', () => {
  it('returns warning when authorization list is empty', () => {
    const candidate = { student_id: 'st-2', service_id: 'svc-2', target_date: '2026-04-20' };
    const warning = buildHmoCoverageWarning(candidate, []);
    assert.ok(warning);
    assert.equal(warning.type, 'hmo_authorization_gap');
    assert.equal(warning.reason, 'no_authorization_found');
    assert.equal(warning.severity, 'warning');
    assert.equal(warning.student_id, 'st-2');
    assert.equal(warning.service_id, 'svc-2');
  });

  it('returns warning when no auth matches student+service combination', () => {
    const candidate = { student_id: 'st-A', service_id: 'svc-A', target_date: '2026-04-20' };
    const otherAuth = { ...ACTIVE_AUTH, student_id: 'st-B', service_id: 'svc-B' };
    const warning = buildHmoCoverageWarning(candidate, [otherAuth]);
    assert.ok(warning);
    assert.equal(warning.reason, 'no_authorization_found');
  });
});

describe('buildHmoCoverageWarning — authorization found but not active', () => {
  it('returns warning when authorization status is cancelled', () => {
    const candidate = { student_id: 'st-3', service_id: 'svc-3', target_date: '2026-04-20' };
    const auth = { ...ACTIVE_AUTH, student_id: 'st-3', service_id: 'svc-3', status: 'cancelled' };
    const warning = buildHmoCoverageWarning(candidate, [auth]);
    assert.ok(warning);
    assert.equal(warning.reason, 'no_active_authorization');
    assert.equal(warning.severity, 'warning');
  });

  it('returns warning when authorization status is expired', () => {
    const candidate = { student_id: 'st-3', service_id: 'svc-3', target_date: '2026-04-20' };
    const auth = { ...ACTIVE_AUTH, student_id: 'st-3', service_id: 'svc-3', status: 'expired' };
    const warning = buildHmoCoverageWarning(candidate, [auth]);
    assert.ok(warning);
    assert.equal(warning.reason, 'no_active_authorization');
  });
});

describe('buildHmoCoverageWarning — active authorization outside date range', () => {
  it('returns warning when target date is before valid_from', () => {
    const candidate = { student_id: 'st-4', service_id: 'svc-4', target_date: '2026-03-31' };
    const auth = { ...ACTIVE_AUTH, student_id: 'st-4', service_id: 'svc-4' };
    const warning = buildHmoCoverageWarning(candidate, [auth]);
    assert.ok(warning);
    assert.equal(warning.reason, 'no_active_authorization_for_date');
  });

  it('returns warning when target date is after expires_at', () => {
    const candidate = { student_id: 'st-4', service_id: 'svc-4', target_date: '2026-05-01' };
    const auth = { ...ACTIVE_AUTH, student_id: 'st-4', service_id: 'svc-4' };
    const warning = buildHmoCoverageWarning(candidate, [auth]);
    assert.ok(warning);
    assert.equal(warning.reason, 'no_active_authorization_for_date');
  });
});

describe('buildHmoCoverageWarning — active authorization covers date (no warning)', () => {
  it('returns null when active authorization covers target date', () => {
    const candidate = {
      template_id: 'tpl-1',
      student_id: 'st-1',
      service_id: 'svc-1',
      target_date: '2026-04-20',
      datetime_start: '2026-04-20T15:00:00',
    };
    const warning = buildHmoCoverageWarning(candidate, [ACTIVE_AUTH]);
    assert.equal(warning, null);
  });

  it('returns null on valid_from boundary (inclusive)', () => {
    const candidate = { student_id: 'st-1', service_id: 'svc-1', target_date: '2026-04-01' };
    assert.equal(buildHmoCoverageWarning(candidate, [ACTIVE_AUTH]), null);
  });

  it('returns null on expires_at boundary (inclusive)', () => {
    const candidate = { student_id: 'st-1', service_id: 'svc-1', target_date: '2026-04-30' };
    assert.equal(buildHmoCoverageWarning(candidate, [ACTIVE_AUTH]), null);
  });

  it('returns null when one auth is expired but another active auth covers the date', () => {
    const candidate = { student_id: 'st-1', service_id: 'svc-1', target_date: '2026-05-15' };
    const expired = { ...ACTIVE_AUTH, id: 'auth-old', expires_at: '2026-04-30' };
    const current = { ...ACTIVE_AUTH, id: 'auth-new', valid_from: '2026-05-01', expires_at: '2026-05-31' };
    assert.equal(buildHmoCoverageWarning(candidate, [expired, current]), null);
  });

  it('returns warning when multiple auths exist but none cover the target date', () => {
    const candidate = { student_id: 'st-1', service_id: 'svc-1', target_date: '2026-06-15' };
    const auth1 = { ...ACTIVE_AUTH, id: 'a1', expires_at: '2026-04-30' };
    const auth2 = { ...ACTIVE_AUTH, id: 'a2', valid_from: '2026-05-01', expires_at: '2026-05-31' };
    const warning = buildHmoCoverageWarning(candidate, [auth1, auth2]);
    assert.ok(warning);
    assert.equal(warning.reason, 'no_active_authorization_for_date');
  });
});
