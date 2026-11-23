import { authenticatedFetch } from '@/lib/api-client.js';

/**
 * Cancels one rate that has not started yet (DELETE /api/employee-rates). The server refuses a
 * current or past rate (400 dated_version_not_in_future): months were priced by it.
 */
export async function cancelEmployeeRate({ orgId, employeeId, rateId, session }) {
  return authenticatedFetch('employee-rates', {
    session,
    method: 'DELETE',
    body: { org_id: orgId, employee_id: employeeId, rate_id: rateId },
  });
}
