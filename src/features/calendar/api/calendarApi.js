import { authenticatedFetch } from '@/lib/api-client.js';

/**
 * Fetch all instructors (Employees) from the public schema
 */
export async function fetchInstructors(orgId, { signal } = {}) {
  const response = await authenticatedFetch('/api/instructors', {
    method: 'GET',
    params: { org_id: orgId },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch instructors: ${response.status}`);
  }

  const json = await response.json();
  return json.data || [];
}

/**
 * Fetch all services from the public schema
 */
export async function fetchServices(orgId, { signal } = {}) {
  const response = await authenticatedFetch('/api/services', {
    method: 'GET',
    params: { org_id: orgId },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch services: ${response.status}`);
  }

  const json = await response.json();
  return json.data || [];
}

/**
 * Fetch lesson instances for a date range
 * @param {string|Date} startDate - Start date (YYYY-MM-DD or Date object)
 * @param {string|Date} endDate - End date (YYYY-MM-DD or Date object)
 */
export async function fetchDailyLessons(orgId, startDate, endDate, { signal } = {}) {
  // Normalize dates to YYYY-MM-DD strings
  const formatDate = (date) => {
    if (typeof date === 'string') {
      return date;
    }
    if (date instanceof Date) {
      return date.toISOString().split('T')[0];
    }
    return String(date);
  };

  const start = formatDate(startDate);
  const end = formatDate(endDate);

  const response = await authenticatedFetch('/api/lessons', {
    method: 'GET',
    params: { 
      org_id: orgId,
      startDate: start,
      endDate: end,
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch lessons: ${response.status}`);
  }

  const json = await response.json();
  return json.data || [];
}
