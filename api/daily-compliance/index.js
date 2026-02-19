/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js'
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js'
import {
  ensureMembership,
  isAdminRole,
  normalizeString,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js'
import { ensureInstructorColors, resolveInstructorColor } from '../_shared/instructor-colors.js'

const DAY_LABELS = Object.freeze([
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
])

function startOfUtcDay(dateLike) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function formatUtcDate(dateLike) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeDateString(value) {
  if (!value) {
    return ''
  }
  const trimmed = String(value).trim()
  if (!trimmed) {
    return ''
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }
  if (trimmed.length >= 10) {
    return trimmed.slice(0, 10)
  }
  return ''
}

function parseDateParam(value) {
  const normalized = normalizeDateString(value)
  if (!normalized) {
    return null
  }
  try {
    const parsed = new Date(`${normalized}T00:00:00Z`)
    if (Number.isNaN(parsed.getTime())) {
      return null
    }
    return startOfUtcDay(parsed)
  } catch {
    return null
  }
}

function parseTimeToMinutes(value) {
  if (!value) {
    return null
  }
  const raw = String(value).trim()
  if (!raw) {
    return null
  }
  const match = raw.match(/^(\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!match) {
    return null
  }
  const hours = Number.parseInt(match[1], 10)
  const minutes = Number.parseInt(match[2], 10)
  const seconds = match[3] ? Number.parseInt(match[3], 10) : 0
  if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds)) {
    return null
  }
  return hours * 60 + minutes + Math.floor(seconds / 60)
}

function minutesToTimeString(totalMinutes) {
  const minutes = Math.max(0, Number(totalMinutes) || 0)
  const hoursPart = Math.floor(minutes / 60)
  const minutesPart = minutes % 60
  return `${String(hoursPart).padStart(2, '0')}:${String(minutesPart).padStart(2, '0')}`
}

function determineStatus(hasRecord, isoDate, todayIso) {
  if (!isoDate || !todayIso) {
    return hasRecord ? 'complete' : 'upcoming'
  }
  if (isoDate <= todayIso) {
    return hasRecord ? 'complete' : 'missing'
  }
  return hasRecord ? 'complete' : 'upcoming'
}

export default async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase()
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET' })
  }

  const env = readEnv(context)
  const adminConfig = readSupabaseAdminConfig(env)

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('daily-compliance missing Supabase admin credentials')
    return respond(context, 500, { message: 'server_misconfigured' })
  }

  const authorization = resolveBearerAuthorization(req)
  if (!authorization?.token) {
    context.log?.warn?.('daily-compliance missing bearer token')
    return respond(context, 401, { message: 'missing bearer' })
  }

  const supabase = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  })

  let authResult
  try {
    authResult = await supabase.auth.getUser(authorization.token)
  } catch (error) {
    context.log?.error?.('daily-compliance failed to validate token', { message: error?.message })
    return respond(context, 401, { message: 'invalid or expired token' })
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' })
  }

  const userId = authResult.data.user.id
  const orgId = resolveOrgId(req, null)

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' })
  }

  let role
  try {
    role = await ensureMembership(supabase, orgId, userId)
  } catch (membershipError) {
    context.log?.error?.('daily-compliance failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    })
    return respond(context, 500, { message: 'failed_to_verify_membership' })
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' })
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId)
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body)
  }

  const dateQuery = normalizeString(req?.query?.date || req?.query?.day || req?.query?.target_date)
  const targetDay = parseDateParam(dateQuery)
  if (!targetDay) {
    return respond(context, 400, { message: 'invalid_date' })
  }

  const todayIso = formatUtcDate(startOfUtcDay(new Date()))
  const isoDate = formatUtcDate(targetDay)
  const jsDayIndex = targetDay.getUTCDay()
  const dayOfWeek = jsDayIndex + 1 // Convert to 1-7 with Sunday=1
  const dayLabel = DAY_LABELS[jsDayIndex] || ''

  const colorsResult = await ensureInstructorColors(tenantClient, {
    context,
    columns: 'id, name, metadata, is_active',
  })

  if (colorsResult?.error) {
    context.log?.error?.('daily-compliance failed to ensure instructor colors', {
      message: colorsResult.error.message,
    })
    return respond(context, 500, { message: 'failed_to_prepare_instructors' })
  }

  const instructors = Array.isArray(colorsResult?.data) ? colorsResult.data : []
  const instructorMap = new Map()
  for (const instructor of instructors) {
    const id = normalizeString(instructor?.id)
    const name = normalizeString(instructor?.name) || instructor?.name || ''
    const color = resolveInstructorColor(instructor?.metadata)
    if (id && color) {
      instructorMap.set(id, {
        id,
        name: name || id,
        color,
        isActive: instructor?.is_active !== false,
      })
    }
  }

  let studentQuery = tenantClient
    .from('Students')
    .select('id, name, assigned_instructor_id, default_day_of_week, default_session_time, is_active')
    .eq('is_active', true)

  if (!isAdminRole(role)) {
    studentQuery = studentQuery.eq('assigned_instructor_id', userId)
  }

  const { data: studentRows, error: studentError } = await studentQuery

  if (studentError) {
    context.log?.error?.('daily-compliance failed to load students', { message: studentError.message })
    return respond(context, 500, { message: 'failed_to_load_students' })
  }

  const students = Array.isArray(studentRows) ? studentRows : []
  const relevantStudents = students.filter(student => {
    const studentDay = Number.parseInt(student?.default_day_of_week, 10)
    const timeMinutes = parseTimeToMinutes(student?.default_session_time)
    return studentDay === dayOfWeek && timeMinutes !== null
  })

  const studentIdSet = new Set()
  for (const student of relevantStudents) {
    const id = normalizeString(student?.id)
    if (id) {
      studentIdSet.add(id)
    }
  }

  const recordsByStudent = new Map()
  if (studentIdSet.size > 0) {
    let recordsQuery = tenantClient
      .from('SessionRecords')
      .select('id, student_id, date')
      .eq('deleted', false)
      .eq('date', isoDate)

    recordsQuery = recordsQuery.in('student_id', Array.from(studentIdSet))

    const { data: recordRows, error: recordError } = await recordsQuery
    if (recordError) {
      context.log?.error?.('daily-compliance failed to load session records', { message: recordError.message })
      return respond(context, 500, { message: 'failed_to_load_sessions' })
    }

    if (Array.isArray(recordRows)) {
      for (const record of recordRows) {
        const id = normalizeString(record?.student_id)
        if (id && !recordsByStudent.has(id)) {
          recordsByStudent.set(id, record?.id || true)
        }
      }
    }
  }

  const sessions = []
  const usedInstructorIds = new Set()
  const slots = new Map()

  for (const student of relevantStudents) {
    const studentId = normalizeString(student?.id)
    if (!studentId) {
      continue
    }
    const timeMinutes = parseTimeToMinutes(student?.default_session_time)
    if (timeMinutes === null) {
      continue
    }

    const hasRecord = recordsByStudent.has(studentId)
    const status = determineStatus(hasRecord, isoDate, todayIso)

    const instructorId = normalizeString(student?.assigned_instructor_id)
    const instructor = instructorId ? instructorMap.get(instructorId) : null
    if (instructor) {
      usedInstructorIds.add(instructor.id)
    }

    const color = instructor?.color || '#6B7280'
    const instructorName = instructor?.name || 'לא משויך'

    const session = {
      studentId,
      studentName: student?.name || '',
      instructorId: instructor?.id || null,
      instructorName,
      instructorColor: color,
      instructorIsActive: instructor?.isActive !== false,
      time: minutesToTimeString(timeMinutes),
      timeMinutes,
      status,
      hasRecord,
      recordId: hasRecord ? recordsByStudent.get(studentId) || null : null,
    }

    sessions.push(session)

    if (!slots.has(timeMinutes)) {
      slots.set(timeMinutes, [])
    }
    slots.get(timeMinutes).push(session)
  }

  sessions.sort((a, b) => {
    if (a.timeMinutes !== b.timeMinutes) {
      return a.timeMinutes - b.timeMinutes
    }
    return (a.studentName || '').localeCompare(b.studentName || '', 'he')
  })

  for (const group of slots.values()) {
    group.sort((a, b) => (a.studentName || '').localeCompare(b.studentName || '', 'he'))
  }

  const legend = []
  for (const instructorId of usedInstructorIds) {
    const instructor = instructorMap.get(instructorId)
    if (instructor) {
      legend.push({
        id: instructor.id,
        name: instructor.name,
        color: instructor.color,
        isActive: instructor.isActive,
      })
    }
  }

  const includesUnassigned = sessions.some(session => !session.instructorId)
  if (includesUnassigned) {
    legend.push({
      id: 'unassigned',
      name: 'לא משויך',
      color: '#6B7280',
      isActive: true,
    })
  }

  legend.sort((a, b) => a.name.localeCompare(b.name, 'he'))

  const totalSessions = sessions.length
  const documentedSessions = sessions.filter(session => session.hasRecord).length
  const missingSessions = sessions.filter(session => session.status === 'missing').length
  const upcomingSessions = sessions.filter(session => session.status === 'upcoming').length

  const timeSlots = Array.from(slots.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([minutes, slotSessions]) => ({
      timeMinutes: minutes,
      time: minutesToTimeString(minutes),
      students: slotSessions,
    }))

  return respond(context, 200, {
    date: isoDate,
    dayOfWeek,
    dayLabel,
    today: todayIso,
    summary: {
      totalSessions,
      documentedSessions,
      missingSessions,
      upcomingSessions,
    },
    sessions,
    timeSlots,
    legend,
  })
}
