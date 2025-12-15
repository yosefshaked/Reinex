import React, { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"

import Card from "@/components/ui/CustomCard.jsx"
import { useAuth } from "@/auth/AuthContext.jsx"
import { useOrg } from "@/org/OrgContext.jsx"
import { useSupabase } from "@/context/SupabaseContext.jsx"
import { useSessionModal } from "@/features/sessions/context/SessionModalContext.jsx"
import { useInstructors } from "@/hooks/useOrgData.js"
import { ComplianceHeatmap } from "@/features/dashboard/components/ComplianceHeatmap.jsx"

/**
 * Build greeting with proper fallback chain:
 * 1. Instructor name (from tenant DB Instructors table)
 * 2. Profile full_name (from control DB profiles table)
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
  const { activeOrg, activeOrgId, activeOrgHasConnection, tenantClientReady } = useOrg()
  const { authClient } = useSupabase()
  const { openSessionModal } = useSessionModal()
  const [instructorName, setInstructorName] = useState(null)
  const [profileName, setProfileName] = useState(null)

  const { instructors } = useInstructors({
    enabled: Boolean(user?.id && activeOrgId && tenantClientReady && activeOrgHasConnection && session),
    orgId: activeOrgId,
    session,
  })

  const membershipRole = activeOrg?.membership?.role
  const { studentsLink, studentsTitle, studentsDescription } = useMemo(() => {
    const normalizedRole = typeof membershipRole === "string" ? membershipRole.toLowerCase() : "member"
    const isAdminRole = normalizedRole === "admin" || normalizedRole === "owner"

    if (isAdminRole) {
      return {
        studentsLink: "/admin/students",
        studentsTitle: "ניהול תלמידים",
        studentsDescription: "מעבר לרשימת כלל התלמידים בארגון",
      }
    }

    return {
      studentsLink: "/my-students",
      studentsTitle: "התלמידים שלי",
      studentsDescription: "מעבר לרשימת התלמידים המשויכים אליך",
    }
  }, [membershipRole])

  // Resolve instructor name from hook data
  useEffect(() => {
    if (!user?.id) return
    if (!Array.isArray(instructors)) return
    const instructor = instructors.find((i) => i?.id === user.id)
    if (instructor?.name) {
      setInstructorName(instructor.name)
    }
  }, [user?.id, instructors])

  // Fetch profile name from control DB profiles table
  useEffect(() => {
    if (!user?.id || !authClient) {
      return
    }

    let isMounted = true

    async function fetchProfileName() {
      try {
        const { data, error } = await authClient
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .maybeSingle()
        
        if (!isMounted) return

        if (error) {
          console.error('Failed to fetch profile name:', error)
          return
        }

        if (data?.full_name) {
          setProfileName(data.full_name)
        }
      } catch (error) {
        console.error('Failed to fetch profile name:', error)
        // Silently fail - will fall back to auth name or email
      }
    }

    fetchProfileName()

    return () => {
      isMounted = false
    }
  }, [user?.id, authClient])

  const greeting = buildGreeting(instructorName, profileName, user?.name, user?.email)

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

          {/* Quick action cards */}
          <div className="grid grid-cols-1 gap-lg pb-xl md:grid-cols-2">
            <Link to={studentsLink} className="group focus-visible:outline-none">
              <Card
                className="group h-full cursor-pointer rounded-2xl border border-border bg-surface p-lg text-right shadow-sm transition hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg group-focus-visible:ring-2 group-focus-visible:ring-primary/40"
              >
                <h2 className="text-2xl font-semibold text-foreground group-hover:text-primary">
                  {studentsTitle}
                </h2>
                <p className="mt-sm text-neutral-600">
                  {studentsDescription}
                </p>
              </Card>
            </Link>

            <button
              type="button"
              onClick={() => openSessionModal?.()}
              className="group focus-visible:outline-none"
              aria-label="פתיחת טופס רישום מפגש חדש"
            >
              <Card
                className="group h-full cursor-pointer rounded-2xl border border-border bg-surface p-lg text-right shadow-sm transition hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg group-focus-visible:ring-2 group-focus-visible:ring-primary/40"
              >
                <h2 className="text-2xl font-semibold text-foreground group-hover:text-primary">
                  תיעוד מפגש חדש
                </h2>
                <p className="mt-sm text-neutral-600">
                  פתיחת טופס התיעוד בדיוק כמו לחצן הפלוס המרכזי.
                </p>
              </Card>
            </button>
          </div>

          {/* Weekly compliance - mobile */}
          {tenantClientReady && activeOrgHasConnection ? (
          <ComplianceHeatmap />
          ) : (
            <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
              <p className="text-sm text-muted-foreground">
                לוח מעקב התיעודים השבועי יהיה זמין לאחר יצירת חיבור למסד הנתונים של הארגון.
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

          <div className="grid grid-cols-2 gap-lg">
            <Link to={studentsLink} className="group focus-visible:outline-none">
              <Card
                className="group h-full cursor-pointer rounded-2xl border border-border bg-surface p-lg text-right shadow-sm transition hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg group-focus-visible:ring-2 group-focus-visible:ring-primary/40"
              >
                <h2 className="text-2xl font-semibold text-foreground group-hover:text-primary">
                  {studentsTitle}
                </h2>
                <p className="mt-sm text-neutral-600">
                  {studentsDescription}
                </p>
              </Card>
            </Link>

            <button
              type="button"
              onClick={() => openSessionModal?.()}
              className="group focus-visible:outline-none"
              aria-label="פתיחת טופס רישום מפגש חדש"
            >
              <Card
                className="group h-full cursor-pointer rounded-2xl border border-border bg-surface p-lg text-right shadow-sm transition hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg group-focus-visible:ring-2 group-focus-visible:ring-primary/40"
              >
                <h2 className="text-2xl font-semibold text-foreground group-hover:text-primary">
                  תיעוד מפגש חדש
                </h2>
                <p className="mt-sm text-neutral-600">
                  פתיחת טופס התיעוד בדיוק כמו לחצן הפלוס המרכזי.
                </p>
              </Card>
            </button>
          </div>

          {tenantClientReady && activeOrgHasConnection ? (
          <ComplianceHeatmap />
          ) : (
            <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
              <p className="text-sm text-muted-foreground">
                לוח מעקב התיעודים השבועי יהיה זמין לאחר יצירת חיבור למסד הנתונים של הארגון.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
