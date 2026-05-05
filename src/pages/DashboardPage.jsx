import React, { useEffect, useState } from "react"
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Loader2, UsersRound } from 'lucide-react'

import Card from "@/components/ui/CustomCard.jsx"
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAccount } from '@/account/AccountContext.jsx'
import { useAuth } from "@/auth/AuthContext.jsx"
import { useOrg } from "@/org/OrgContext.jsx"
import { useInstructors } from "@/hooks/useOrgData.js"
import { authenticatedFetch } from '@/lib/api-client.js'

const TASK_PRIORITY_RANK = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

const TASK_PRIORITY_LABEL = {
  low: 'נמוכה',
  medium: 'בינונית',
  high: 'גבוהה',
  critical: 'קריטית',
}

function resolveTaskKindLabel(task) {
  const taskType = typeof task?.task_type === 'string' ? task.task_type.trim().toLowerCase() : ''
  switch (taskType) {
    case 'hmo_claim_submission':
      return 'הגשת תביעות גורם מממן'
    case 'calendar_correction_paid_claim_block':
      return 'תיקוני יומן חסומים'
    default:
      return task?.title?.trim() || taskType || 'משימות מערכת'
  }
}

function formatTaskTimestamp(value) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function groupDashboardTasks(tasks = []) {
  const groups = new Map()

  for (const task of Array.isArray(tasks) ? tasks : []) {
    const taskType = typeof task?.task_type === 'string' ? task.task_type.trim().toLowerCase() : ''
    const groupKey = taskType || `fallback:${task?.title || task?.id || Math.random()}`
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        key: groupKey,
        taskType,
        label: resolveTaskKindLabel(task),
        count: 0,
        topPriority: 'low',
        latestCreatedAt: null,
        latestDescription: '',
        actionPath: task?.action_path || '',
      })
    }

    const group = groups.get(groupKey)
    group.count += 1

    const priority = typeof task?.priority === 'string' ? task.priority.trim().toLowerCase() : 'low'
    if ((TASK_PRIORITY_RANK[priority] || 0) > (TASK_PRIORITY_RANK[group.topPriority] || 0)) {
      group.topPriority = priority
    }

    const createdAt = task?.created_at || null
    if (!group.latestCreatedAt || new Date(createdAt).getTime() > new Date(group.latestCreatedAt).getTime()) {
      group.latestCreatedAt = createdAt
      group.latestDescription = task?.description || ''
    }

    if (!group.actionPath && task?.action_path) {
      group.actionPath = task.action_path
    }
  }

  return Array.from(groups.values()).sort((left, right) => {
    const priorityDiff = (TASK_PRIORITY_RANK[right.topPriority] || 0) - (TASK_PRIORITY_RANK[left.topPriority] || 0)
    if (priorityDiff !== 0) return priorityDiff
    return new Date(right.latestCreatedAt || 0).getTime() - new Date(left.latestCreatedAt || 0).getTime()
  })
}

/**
 * Build greeting with proper fallback chain:
 * 1. Instructor name (from tenant DB Instructors table)
 * 2. Account profile name (from control DB profiles table)
 * 3. Auth metadata display name (from Supabase Auth user_metadata)
 * 4. Email address 
 */
function buildGreeting(instructorName, profileName, authName, email) {
  // Priority 1: Instructor name from tenant DB
  if (instructorName && typeof instructorName === "string") {
    const name = instructorName.trim()
    if (name) {
      return `ברוכים הבאים, ${name}!`
    }
  }

  // Priority 2: Profile name from control DB
  if (profileName && typeof profileName === "string") {
    const name = profileName.trim()
    if (name) {
      return `ברוכים הבאים, ${name}!`
    }
  }

  // Priority 3: Auth metadata display name
  if (authName && typeof authName === "string") {
    const name = authName.trim()
    if (name) {
      return `ברוכים הבאים, ${name}!`
    }
  }

  // Priority 4: Email fallback
  if (email && typeof email === "string") {
    return `ברוכים הבאים, ${email}!`
  }

  return "ברוכים הבאים!"
}

export default function DashboardPage() {
  const { user, session } = useAuth()
  const { account } = useAccount()
  const { activeOrgId, activeOrg } = useOrg()
  const navigate = useNavigate()
  const [instructorName, setInstructorName] = useState(null)
  const [dashboardTasks, setDashboardTasks] = useState([])
  const [waitingListMatches, setWaitingListMatches] = useState(null)
  const [isLoadingTasks, setIsLoadingTasks] = useState(false)
  const [isLoadingWaitingMatches, setIsLoadingWaitingMatches] = useState(false)
  const [tasksError, setTasksError] = useState(null)
  const [waitingMatchesError, setWaitingMatchesError] = useState(null)

  const membershipRole = typeof activeOrg?.membership?.role === 'string'
    ? activeOrg.membership.role.trim().toLowerCase()
    : 'member'
  const canManageAll = membershipRole === 'admin' || membershipRole === 'owner' || membershipRole === 'office'

  const { instructors } = useInstructors({
    enabled: Boolean(user?.id && activeOrgId && session),
    orgId: activeOrgId,
    session,
  })

  // Resolve instructor name from hook data
  useEffect(() => {
    if (!user?.id) return
    if (!Array.isArray(instructors)) return
    const instructor = instructors.find((i) => i?.id === user.id)
    if (instructor?.name) {
      setInstructorName(instructor.name)
    }
  }, [user?.id, instructors])

  useEffect(() => {
    if (!canManageAll || !activeOrgId || !session) {
      setDashboardTasks([])
      return
    }

    let isMounted = true

    async function fetchDashboardTasks() {
      setIsLoadingTasks(true)
      setTasksError(null)
      try {
        const payload = await authenticatedFetch('dashboard-tasks', {
          params: {
            org_id: activeOrgId,
            status: 'open',
          },
          session,
        })
        if (!isMounted) return
        setDashboardTasks(Array.isArray(payload?.entries) ? payload.entries : [])
      } catch (error) {
        if (!isMounted) return
        setTasksError(error?.message || 'טעינת משימות הדשבורד נכשלה.')
      } finally {
        if (isMounted) {
          setIsLoadingTasks(false)
        }
      }
    }

    fetchDashboardTasks()

    return () => {
      isMounted = false
    }
  }, [activeOrgId, canManageAll, session])

  useEffect(() => {
    if (!canManageAll || !activeOrgId || !session) {
      setWaitingListMatches(null)
      return
    }

    let isMounted = true

    async function fetchWaitingListMatches() {
      setIsLoadingWaitingMatches(true)
      setWaitingMatchesError(null)
      try {
        const payload = await authenticatedFetch('waiting-list-matches', {
          params: {
            org_id: activeOrgId,
            scope: 'dashboard',
          },
          session,
        })
        if (!isMounted) return
        setWaitingListMatches(payload || null)
      } catch (error) {
        if (!isMounted) return
        setWaitingMatchesError(error?.message || 'טעינת התאמות רשימת ההמתנה נכשלה.')
      } finally {
        if (isMounted) {
          setIsLoadingWaitingMatches(false)
        }
      }
    }

    fetchWaitingListMatches()

    return () => {
      isMounted = false
    }
  }, [activeOrgId, canManageAll, session])

  function renderWaitingListMatches() {
    if (!canManageAll || !activeOrgId || !session) {
      return null
    }

    const capacityCount = Number(waitingListMatches?.summary?.capacity?.matchable_entries) || 0
    const clearSpaceCount = Number(waitingListMatches?.summary?.clear_space?.matchable_entries) || 0
    const urgentCount = Number(waitingListMatches?.summary?.priority_entries) || 0
    const oldestWaitDays = Number(waitingListMatches?.summary?.oldest_wait_days) || 0

    return (
      <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <UsersRound className="h-4 w-4 text-emerald-700" />
              <h2 className="text-base font-semibold text-neutral-900">התאמות מרשימת ההמתנה</h2>
            </div>
            <p className="mt-1 text-sm text-neutral-600">התאמות חיות לשיבוץ ידני בתבניות.</p>
          </div>
          {urgentCount > 0 ? <Badge variant="destructive">{urgentCount} דחופים</Badge> : null}
        </div>

        {waitingMatchesError && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {waitingMatchesError}
          </div>
        )}

        {isLoadingWaitingMatches ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            בודק התאמות...
          </div>
        ) : capacityCount === 0 && clearSpaceCount === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-neutral-200 p-4 text-sm text-neutral-500">
            אין כרגע התאמות זמינות מרשימת ההמתנה.
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
              <div className="text-sm font-medium text-emerald-950">ממתינים שאפשר לצרף לקבוצה קיימת</div>
              <div className="mt-2 text-2xl font-semibold text-emerald-950">{capacityCount}</div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => navigate('/calendar/templates?waiting_matches=1&mode=capacity')}
              >
                <ArrowLeft className="ms-1 h-4 w-4" />
                פתח
              </Button>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-4">
              <div className="text-sm font-medium text-sky-950">ממתינים שמתאימים לשיבוץ נפרד</div>
              <div className="mt-2 text-2xl font-semibold text-sky-950">{clearSpaceCount}</div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => navigate('/calendar/templates?waiting_matches=1&mode=clear_space')}
              >
                <ArrowLeft className="ms-1 h-4 w-4" />
                פתח
              </Button>
            </div>
          </div>
        )}

        {oldestWaitDays > 0 ? (
          <p className="mt-3 text-xs text-neutral-500">ההמתנה הארוכה ביותר עם התאמה: {oldestWaitDays} ימים.</p>
        ) : null}
      </Card>
    )
  }

  function renderDashboardTasks() {
    if (!canManageAll) {
      return null
    }

    if (!activeOrgId || !session) {
      return null
    }

    const groupedTasks = groupDashboardTasks(dashboardTasks)

    return (
      <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">משימות פעולה</h2>
            <p className="text-sm text-neutral-600">פעולות שנפתחו אוטומטית ודורשות טיפול אנושי.</p>
          </div>
          <Badge variant="outline">{dashboardTasks.length} פתוחות</Badge>
        </div>

        {tasksError && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {tasksError}
          </div>
        )}

        {isLoadingTasks ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            טוען משימות...
          </div>
        ) : dashboardTasks.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-neutral-200 p-4 text-sm text-neutral-500">
            אין כרגע משימות פתוחות.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {groupedTasks.map((group) => (
              <div key={group.key} className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-amber-950">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="font-medium">{group.label}</span>
                      <Badge className="bg-white text-amber-900 border-amber-200">{TASK_PRIORITY_LABEL[group.topPriority] || group.topPriority}</Badge>
                    </div>
                    <p className="text-sm text-amber-900/85">
                      יש {group.count} משימות פתוחות עבור {group.label}.
                    </p>
                    {group.latestDescription && (
                      <p className="text-xs text-amber-900/75">
                        דוגמה אחרונה: {group.latestDescription}
                      </p>
                    )}
                    {group.latestCreatedAt && (
                      <p className="text-xs text-amber-900/65">
                        עדכון אחרון: {formatTaskTimestamp(group.latestCreatedAt)}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.actionPath && (
                      <Button variant="outline" size="sm" onClick={() => navigate(group.actionPath)}>
                        <ArrowLeft className="ms-1 h-4 w-4" />
                        פתח
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    )
  }

  const greeting = buildGreeting(instructorName, account?.displayName, user?.name, user?.email)

  return (
    <div
      data-page-layout="dashboard"
      className="min-h-full w-full bg-background text-neutral-900"
    >
      {/* Mobile: stacked layout */}
      <div className="xl:hidden">
        <div
          className="mx-auto flex w-full flex-col px-sm py-md sm:px-md sm:py-lg lg:px-xl"
          style={{ maxWidth: "min(1280px, 100vw)" }}
        >
          {/* Header */}
          <header className="flex flex-col gap-sm pb-sm sm:flex-row sm:items-end sm:justify-between sm:pb-md">
            <div className="space-y-xs">
              <h1 className="text-xl font-semibold text-neutral-900 sm:text-title-lg">{greeting}</h1>
              <p className="max-w-2xl text-sm text-neutral-600 sm:text-body-md">מה תרצו לעשות כעת?</p>
            </div>
          </header>

          {renderDashboardTasks()}
          {renderWaitingListMatches()}

          <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
            <p className="text-sm text-muted-foreground">
              אזור מפת המעקב הוסר זמנית מהדשבורד עד להחזרת המודול בגרסה מעודכנת.
            </p>
          </Card>
        </div>
      </div>

      {/* Desktop xl+: simple centered layout */}
      <div className="hidden xl:block">
        <div
          className="mx-auto flex w-full max-w-[1280px] flex-col gap-xl px-lg py-xl"
        >
          <header className="flex flex-col gap-sm sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-xs">
              <h1 className="text-xl font-semibold text-neutral-900 sm:text-title-lg">{greeting}</h1>
              <p className="max-w-2xl text-sm text-neutral-600 sm:text-body-md">מה תרצו לעשות כעת?</p>
            </div>
          </header>

          {renderDashboardTasks()}
          {renderWaitingListMatches()}

          <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
            <p className="text-sm text-muted-foreground">
              אזור מפת המעקב הוסר זמנית מהדשבורד עד להחזרת המודול בגרסה מעודכנת.
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
