import { authenticatedFetch } from '@/lib/api-client.js'

function buildWeeklyCompliancePath({ orgId, weekStart, instructorId } = {}) {
  const params = new URLSearchParams()
  if (orgId) {
    params.set('org_id', orgId)
  }
  if (weekStart) {
    params.set('week_start', weekStart)
  }
  if (instructorId) {
    params.set('instructor_id', instructorId)
  }

  const query = params.toString()
  return query ? `weekly-compliance?${query}` : 'weekly-compliance'
}

async function requestWeeklyCompliance({ orgId, weekStart, instructorId, signal } = {}) {
  const path = buildWeeklyCompliancePath({ orgId, weekStart, instructorId })
  return authenticatedFetch(path, { signal })
}

export async function fetchWeeklyComplianceView({ orgId, weekStart, instructorId, signal } = {}) {
  return requestWeeklyCompliance({ orgId, weekStart, instructorId, signal })
}

export async function fetchInstructorLegend({ orgId, weekStart, signal } = {}) {
  const response = await requestWeeklyCompliance({ orgId, weekStart, signal })
  if (response && Array.isArray(response.legend)) {
    return response.legend
  }
  return []
}
