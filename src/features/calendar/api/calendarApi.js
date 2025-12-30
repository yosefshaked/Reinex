import { authenticatedFetch } from '@/lib/api-client.js';

/**
 * Fetch all instructors (Employees) from the public schema
 */
export async function fetchInstructors(orgId, { signal } = {}) {
  const payload = await authenticatedFetch('/api/instructors', {
    method: 'GET',
    params: { org_id: orgId },
    signal,
  });

  return payload?.data || [];
}

/**
 * Fetch all services from the public schema
 */
export async function fetchServices(orgId, { signal } = {}) {
  const payload = await authenticatedFetch('/api/services', {
    method: 'GET',
    params: { org_id: orgId },
    signal,
  });

  return payload?.data || [];
}

/**
 * Fetch lesson instances for a date range
 * @param {string|Date} startDate - Start date (YYYY-MM-DD or Date object)
 * @param {string|Date} endDate - End date (YYYY-MM-DD or Date object)
 */
export async function fetchDailyLessons(orgId, startDate, endDate, { signal } = {}) {
  // Normalize dates to ISO strings (backend can filter timestamptz accurately)
  const formatDate = (date) => {
    if (typeof date === 'string') {
      return date;
    }
    if (date instanceof Date) {
      return date.toISOString();
    }
    return String(date);
  };

  const start = formatDate(startDate);
  const end = formatDate(endDate);

  const payload = await authenticatedFetch('/api/lessons', {
    method: 'GET',
    params: { 
      org_id: orgId,
      startDate: start,
      endDate: end,
    },
    signal,
  });

  return payload?.data || [];
}
