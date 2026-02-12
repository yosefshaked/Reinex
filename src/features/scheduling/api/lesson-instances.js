import { authenticatedFetch } from '@/lib/api-client.js'

export async function fetchLessonInstances({ orgId, date, instructorId } = {}) {
  const params = {
    orgId,
    date,
  }

  if (instructorId) {
    params.instructor_id = instructorId
  }

  return authenticatedFetch('lesson-instances', { params })
}
