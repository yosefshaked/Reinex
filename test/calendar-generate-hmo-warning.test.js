import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildHmoCoverageWarning } from '../api/calendar-generate/index.js';

describe('calendar generate HMO coverage warnings', () => {
  it('returns no warning when active authorization covers target date', () => {
    const candidate = {
      template_id: 'tpl-1',
      student_id: 'st-1',
      service_id: 'svc-1',
      target_date: '2026-04-20',
      datetime_start: '2026-04-20T15:00:00',
    };
    const authorizations = [{
      id: 'auth-1',
      student_id: 'st-1',
      service_id: 'svc-1',
      status: 'active',
      valid_from: '2026-04-01',
      expires_at: '2026-04-30',
    }];

    const warning = buildHmoCoverageWarning(candidate, authorizations);
    assert.equal(warning, null);
  });

  it('returns warning when no authorization exists for student/service', () => {
    const candidate = {
      template_id: 'tpl-2',
      student_id: 'st-2',
      service_id: 'svc-2',
      target_date: '2026-04-20',
      datetime_start: '2026-04-20T15:00:00',
    };

    const warning = buildHmoCoverageWarning(candidate, []);
    assert.ok(warning);
    assert.equal(warning.type, 'hmo_authorization_gap');
    assert.equal(warning.reason, 'no_authorization_found');
  });

  it('returns warning when authorization exists but is not active', () => {
    const candidate = {
      template_id: 'tpl-3',
      student_id: 'st-3',
      service_id: 'svc-3',
      target_date: '2026-04-20',
      datetime_start: '2026-04-20T15:00:00',
    };
    const authorizations = [{
      id: 'auth-3',
      student_id: 'st-3',
      service_id: 'svc-3',
      status: 'cancelled',
      valid_from: '2026-04-01',
      expires_at: '2026-04-30',
    }];

    const warning = buildHmoCoverageWarning(candidate, authorizations);
    assert.ok(warning);
    assert.equal(warning.reason, 'no_active_authorization');
  });

  it('returns warning when active authorization is out of date range', () => {
    const candidate = {
      template_id: 'tpl-4',
      student_id: 'st-4',
      service_id: 'svc-4',
      target_date: '2026-05-10',
      datetime_start: '2026-05-10T15:00:00',
    };
    const authorizations = [{
      id: 'auth-4',
      student_id: 'st-4',
      service_id: 'svc-4',
      status: 'active',
      valid_from: '2026-04-01',
      expires_at: '2026-04-30',
    }];

    const warning = buildHmoCoverageWarning(candidate, authorizations);
    assert.ok(warning);
    assert.equal(warning.reason, 'no_active_authorization_for_date');
  });
});
