import { authenticatedFetch } from '@/lib/api-client.js'

function buildDailyCompliancePath({ orgId, date } = {}) {
  const params = new URLSearchParams()
  if (orgId) {
    params.set('org_id', orgId)
  }
  if (date) {
    params.set('date', date)
  }
  const query = params.toString()
  return query ? `daily-compliance?${query}` : 'daily-compliance'
}

export async function fetchDailyCompliance({ orgId, date, signal } = {}) {
  if (!orgId || !date) {
    throw new Error('orgId and date are required to load day details')
  }
  const path = buildDailyCompliancePath({ orgId, date })
  return authenticatedFetch(path, { signal })
}
