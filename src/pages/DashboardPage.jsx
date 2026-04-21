import React, { useEffect, useState } from "react"
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CheckCheck, Loader2 } from 'lucide-react'

import Card from "@/components/ui/CustomCard.jsx"
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAccount } from '@/account/AccountContext.jsx'
import { useAuth } from "@/auth/AuthContext.jsx"
import { useOrg } from "@/org/OrgContext.jsx"
import { useInstructors } from "@/hooks/useOrgData.js"
import { ComplianceHeatmap } from "@/features/dashboard/components/ComplianceHeatmap.jsx"
import { authenticatedFetch } from '@/lib/api-client.js'

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
  const [isLoadingTasks, setIsLoadingTasks] = useState(false)
  const [tasksError, setTasksError] = useState(null)
  const [resolvingTaskId, setResolvingTaskId] = useState(null)

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

  async function handleResolveTask(taskId) {
    if (!taskId || !activeOrgId) return
    setResolvingTaskId(taskId)
    try {
      await authenticatedFetch('dashboard-tasks', {
        method: 'PUT',
        body: {
          id: taskId,
          org_id: activeOrgId,
        },
        session,
      })
      setDashboardTasks((prev) => prev.filter((task) => task.id !== taskId))
    } catch (error) {
      setTasksError(error?.message || 'פתרון המשימה נכשל.')
    } finally {
      setResolvingTaskId(null)
    }
  }

  function renderDashboardTasks() {
    if (!canManageAll) {
      return null
    }

    if (!activeOrgId || !session) {
      return null
    }

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
            {dashboardTasks.map((task) => (
              <div key={task.id} className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-amber-950">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="font-medium">{task.title}</span>
                      <Badge className="bg-white text-amber-900 border-amber-200">{task.priority}</Badge>
                    </div>
                    <p className="text-sm text-amber-900/80">{task.description}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {task.action_path && (
                      <Button variant="outline" size="sm" onClick={() => navigate(task.action_path)}>
                        <ArrowLeft className="ms-1 h-4 w-4" />
                        פתח
                      </Button>
                    )}
                    <Button size="sm" onClick={() => handleResolveTask(task.id)} disabled={resolvingTaskId === task.id}>
                      {resolvingTaskId === task.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="ms-1 h-4 w-4" />}
                      סמן כטופל
                    </Button>
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

          {/* Weekly compliance - mobile */}
          {activeOrgId && session ? (
          <ComplianceHeatmap />
          ) : (
            <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
              <p className="text-sm text-muted-foreground">
                לוח מעקב התיעודים השבועי יהיה זמין לאחר בחירת ארגון והתחברות.
              </p>
            </Card>
          )}
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

          {activeOrgId && session ? (
          <ComplianceHeatmap />
          ) : (
            <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
              <p className="text-sm text-muted-foreground">
                לוח מעקב התיעודים השבועי יהיה זמין לאחר בחירת ארגון והתחברות.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
