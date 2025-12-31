import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Link, NavLink, Outlet, useLocation, matchPath } from "react-router-dom"
import { Plus, LayoutDashboard, Users, BarChart3, Settings, LogOut, Megaphone, CalendarDays } from "lucide-react"
import { Toaster, toast } from "sonner"

import OrgConfigBanner from "@/components/OrgConfigBanner.jsx"
import OrgSelectionBanner from "@/components/OrgSelectionBanner.jsx"
import ChangelogModal from "@/components/ChangelogModal"
import PageLayout from "@/components/ui/PageLayout.jsx"
import { useAuth } from "@/auth/AuthContext.jsx"
import { useOrg } from "@/org/OrgContext.jsx"
import { cn } from "@/lib/utils"
import NewSessionModal from "@/features/sessions/components/NewSessionModal.jsx"
import { SessionModalContext } from "@/features/sessions/context/SessionModalContext.jsx"
import useKeyboardAwareBottomOffset from "@/hooks/useKeyboardAwareBottomOffset.js"
import OrgLogo from "@/components/layout/OrgLogo.jsx"
import { WelcomeTour } from "@/features/onboarding/components/WelcomeTour.jsx"
import CustomTourRenderer from "@/features/onboarding/components/CustomTourRenderer.jsx"
import { useUserRole } from "@/features/onboarding/hooks/useUserRole.js"
import { AccessibilityProvider } from "@/features/accessibility/AccessibilityProvider.jsx"
import AccessibilityButton from "@/features/accessibility/AccessibilityButton.jsx"
import SkipLink from "@/features/accessibility/SkipLink.jsx"

const REPORTS_COMING_SOON_MESSAGE = "יכולות דוחות וסטטיסטיקה יגיעו בקרוב!"

function buildNavItems(role) {
  // role is already normalized (lowercase) from useUserRole
  const isAdminRole = role === "admin" || role === "owner"

  return [
    {
      label: "ראשי",
      to: "/dashboard",
      icon: LayoutDashboard,
      end: true,
      tourKey: "dashboard",
    },
    {
      label: "תלמידים",
      to: "/students-list",
      icon: Users,
      tourKey: isAdminRole ? "admin-students" : "my-students",
    },
    {
      label: "לוח שנה",
      to: "/calendar",
      icon: CalendarDays,
      tourKey: "calendar",
    },
    {
      label: "דוחות",
      icon: BarChart3,
      disabled: true,
      tooltip: REPORTS_COMING_SOON_MESSAGE,
    },
    {
      label: "הגדרות",
      to: "/Settings",
      icon: Settings,
      tourKey: "settings",
    },
  ]
}

function MobileNavigation({ navItems = [], onOpenSessionModal }) {
  const keyboardOffset = useKeyboardAwareBottomOffset()
  const location = useLocation()
  const studentsRouteActive = React.useMemo(() => {
    const p = location.pathname
    return Boolean(
      matchPath('/students-list/*', p) ||
      matchPath('/students/:id', p)
    )
  }, [location.pathname])
  
  return (
    <nav
      role="navigation"
      aria-label="ניווט ראשי"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-border bg-surface px-lg pb-sm pt-xs shadow-lg md:hidden"
      style={keyboardOffset > 0 
        ? { position: 'fixed', transform: `translateY(-${keyboardOffset}px) translateZ(0)`, willChange: 'transform', isolation: 'isolate' } 
        : { position: 'fixed', transform: 'translateZ(0)', willChange: 'transform', isolation: 'isolate' }}
    >
      <div className="relative mx-auto grid max-w-md grid-cols-5 items-center gap-md">
        {navItems.slice(0, 2).map((item) => {
          const Icon = item.icon

          if (item.disabled) {
            return (
              <button
                key={item.label}
                type="button"
                aria-label={item.label}
                aria-disabled="true"
                title={item.tooltip}
                onClick={() => toast.info(item.tooltip ?? REPORTS_COMING_SOON_MESSAGE)}
                className="relative mobile-nav-item flex cursor-not-allowed flex-col items-center gap-1 h-12 text-sm font-medium text-neutral-400 opacity-70"
              >
                  <Icon className="h-6 w-6" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            )
          }

          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              data-tour={item.tourKey}
              aria-label={item.label}
              className={({ isActive }) => {
                const isStudentsItem = item.tourKey === 'admin-students' || item.tourKey === 'my-students'
                const active = isActive || (isStudentsItem && studentsRouteActive)
                return cn(
                  "relative mobile-nav-item flex flex-col items-center gap-1 h-12 text-sm font-medium",
                  active ? "text-primary" : "text-neutral-500",
                )
              }}
            >
              <Icon className="h-6 w-6" aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          )
        })}
        
        {/* Middle column placeholder for FAB button */}
        <div className="relative flex items-center justify-center" aria-hidden="true">
          <button
            type="button"
            onClick={() => onOpenSessionModal?.()}
            data-tour="fab-button"
            className="absolute -top-12 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl ring-2 ring-background"
            aria-label="יצירת רישום פגישה חדש"
          >
            <Plus className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        {navItems.slice(2).map((item) => {
          const Icon = item.icon

          if (item.disabled) {
            return (
              <button
                key={item.label}
                type="button"
                aria-label={item.label}
                aria-disabled="true"
                title={item.tooltip}
                onClick={() => toast.info(item.tooltip ?? REPORTS_COMING_SOON_MESSAGE)}
                className="relative mobile-nav-item flex cursor-not-allowed flex-col items-center gap-1 h-12 text-sm font-medium text-neutral-400 opacity-70"
              >
                  <Icon className="h-6 w-6" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            )
          }

          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              data-tour={item.tourKey}
              aria-label={item.label}
              className={({ isActive }) => {
                const isStudentsItem = item.tourKey === 'admin-students' || item.tourKey === 'my-students'
                const active = isActive || (isStudentsItem && studentsRouteActive)
                return cn(
                  "relative mobile-nav-item flex flex-col items-center gap-1 h-12 text-sm font-medium",
                  active ? "text-primary" : "text-neutral-500",
                )
              }}
            >
              <Icon className="h-6 w-6" aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}

function DesktopNavigation({ navItems = [], onSignOut, onOpenSessionModal }) {
  const location = useLocation()
  const studentsRouteActive = React.useMemo(() => {
    const p = location.pathname
    return Boolean(
      matchPath('/students-list/*', p) ||
      matchPath('/students/:id', p)
    )
  }, [location.pathname])
  return (
    <aside
      className="hidden md:flex md:h-screen md:w-72 md:flex-col md:border-l md:border-border md:bg-surface"
      dir="rtl"
    >
      <div className="flex h-full flex-col">
        <div className="flex flex-col gap-md px-lg pt-lg">
          <Link to="/dashboard" className="flex items-center justify-end gap-sm text-right flex-row-reverse">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">Reinex</p>
              <p className="text-xs text-neutral-500">ניהול וארגון</p>
            </div>
            <div className="flex items-center justify-center">
              <OrgLogo />
            </div>
          </Link>
          <button
            type="button"
            onClick={() => onOpenSessionModal?.()}
            data-tour="fab-button"
            className="inline-flex items-center justify-center gap-sm rounded-full bg-primary px-lg py-sm text-sm font-semibold text-primary-foreground shadow-lg transition hover:shadow-xl"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>רישום מפגש חדש</span>
          </button>
        </div>
        <nav className="mt-md flex-1 space-y-1 px-lg" aria-label="ניווט ראשי">
          {navItems.map((item) => {
            const Icon = item.icon

            if (item.disabled) {
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => toast.info(item.tooltip ?? REPORTS_COMING_SOON_MESSAGE)}
                  className="flex w-full cursor-not-allowed items-center justify-between gap-sm rounded-xl px-md py-sm text-right text-sm font-medium text-neutral-400 opacity-70"
                  aria-disabled="true"
                  title={item.tooltip}
                >
                  <div className="flex items-center gap-sm">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                    <span>{item.label}</span>
                  </div>
                  <Megaphone className="h-4 w-4" aria-hidden="true" />
                </button>
              )
            }

            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                data-tour={item.tourKey}
                className={({ isActive }) => {
                  const isStudentsItem = item.tourKey === 'admin-students' || item.tourKey === 'my-students'
                  const active = isActive || (isStudentsItem && studentsRouteActive)
                  return cn(
                    "flex items-center justify-between gap-sm rounded-xl px-md py-sm text-sm font-medium transition",
                    active ? "bg-primary/10 text-primary" : "text-neutral-600 hover:bg-neutral-100",
                  )
                }}
              >
                <div className="flex items-center gap-sm">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  <span>{item.label}</span>
                </div>
              </NavLink>
            )
          })}
        </nav>
        <div className="mt-auto space-y-sm border-t border-border px-lg py-lg">
          <button
            type="button"
            onClick={onSignOut}
            className="flex w-full items-center justify-center gap-sm rounded-xl border border-border px-md py-sm text-sm font-semibold text-neutral-600 transition hover:bg-neutral-100"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            התנתקות
          </button>
        </div>
      </div>
    </aside>
  )
}

export default function AppShell({ children }) {
  const { signOut } = useAuth()
  const { activeOrg } = useOrg()
  const { role } = useUserRole()
  const [isChangelogOpen, setIsChangelogOpen] = useState(false)
  const [sessionModalState, setSessionModalState] = useState({
    isOpen: false,
    studentId: '',
    studentStatus: 'active',
    onCreated: null,
  })

  // Use the same role source used by the onboarding system to keep targets stable
  const navItems = useMemo(() => buildNavItems(role), [role])

  const openSessionModal = useCallback((options = {}) => {
    const { studentId = '', studentStatus = 'active', onCreated = null } = options
    const normalizedStatus = studentStatus === 'inactive' ? 'inactive' : 'active'
    setSessionModalState({
      isOpen: true,
      studentId,
      studentStatus: normalizedStatus,
      onCreated: typeof onCreated === 'function' ? onCreated : null,
    })
  }, [])

  const closeSessionModal = useCallback(() => {
    setSessionModalState({
      isOpen: false,
      studentId: '',
      studentStatus: 'active',
      onCreated: null,
    })
  }, [])

  const sessionModalContextValue = useMemo(() => ({
    openSessionModal,
    closeSessionModal,
    isSessionModalOpen: sessionModalState.isOpen,
    sessionModalStudentId: sessionModalState.studentId,
    sessionModalStudentStatus: sessionModalState.studentStatus,
  }), [openSessionModal, closeSessionModal, sessionModalState.isOpen, sessionModalState.studentId, sessionModalState.studentStatus])

  const handleOrgClick = () => {
    toast.info("בקרוב: בחירת ארגון נוסף")
  }

  const handleSignOut = async () => {
    try {
      await signOut()
      toast.success("התנתקת בהצלחה")
    } catch (error) {
      console.error("Sign-out failed", error)
      toast.error("אירעה שגיאה בהתנתקות. נסה שוב.")
    }
  }

  const shellRef = useRef(null)
  const headerRef = useRef(null)

  useLayoutEffect(() => {
    const shellElement = shellRef.current
    const headerElement = headerRef.current

    if (!shellElement || !headerElement) {
      return
    }

    const updateHeaderHeight = () => {
      const rect = headerElement.getBoundingClientRect()
      const height = Math.max(0, Math.round(rect.height))
      shellElement.style.setProperty("--app-shell-header-height", `${height}px`)
    }

    let frameId = null
    const scheduleUpdate = () => {
      if (frameId) {
        cancelAnimationFrame(frameId)
      }
      frameId = requestAnimationFrame(updateHeaderHeight)
    }

    scheduleUpdate()

    if (typeof ResizeObserver !== "undefined") {
      const resizeObserver = new ResizeObserver(scheduleUpdate)
      resizeObserver.observe(headerElement)
      const cleanupObserver = () => resizeObserver.disconnect()
      const cleanupResize = () => {
        if (typeof window !== "undefined") {
          window.removeEventListener("resize", scheduleUpdate)
        }
      }

      if (typeof window !== "undefined") {
        window.addEventListener("resize", scheduleUpdate)
      }

      return () => {
        if (frameId) {
          cancelAnimationFrame(frameId)
        }
        cleanupResize()
        cleanupObserver()
      }
    }

    if (typeof window !== "undefined") {
      window.addEventListener("resize", scheduleUpdate)
    }

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId)
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", scheduleUpdate)
      }
    }
  }, [])

  const content = children ?? <Outlet />
  const pageLayoutMode = React.isValidElement(content) ? content.props?.["data-page-layout"] : null
  const useCustomLayout = pageLayoutMode === "dashboard"

  return (
    <SessionModalContext.Provider value={sessionModalContextValue}>
      <AccessibilityProvider>
      <div ref={shellRef} className="flex min-h-screen bg-background text-foreground overflow-x-hidden" dir="rtl">
        <SkipLink />
        <DesktopNavigation navItems={navItems} onSignOut={handleSignOut} onOpenSessionModal={openSessionModal} />

        <div className="relative flex min-h-screen flex-1 flex-col pb-[88px] md:h-screen md:pb-0">
          <header
            ref={headerRef}
            className="sticky top-0 z-20 border-b border-border bg-surface/80 px-sm py-sm backdrop-blur md:border-none md:bg-transparent md:px-md md:py-sm"
          >
            <div className="flex items-center justify-between gap-xs">
              <div className="flex items-center gap-xs sm:gap-sm">
                <OrgLogo />
                <button
                  type="button"
                  onClick={handleOrgClick}
                  className="inline-flex min-h-[44px] items-center rounded-full border border-border bg-surface px-sm py-xs text-xs font-semibold text-foreground transition hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:px-md sm:text-sm"
                >
                  {activeOrg?.name ? `ארגון: ${activeOrg.name}` : "בחרו ארגון לעבודה"}
                </button>
              </div>
              <div className="flex items-center gap-xs">
                <AccessibilityButton />
                <button
                  type="button"
                  onClick={() => setIsChangelogOpen(true)}
                  className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-border px-xs py-xs text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 sm:px-sm"
                >
                  <Megaphone className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">עדכונים</span>
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-neutral-100 p-2 text-neutral-600 transition hover:bg-neutral-200"
                  aria-label="התנתקות"
                >
                  <LogOut className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </header>

          <OrgSelectionBanner />
          <OrgConfigBanner />

          <main id="main-content" role="main" className="flex-1 overflow-y-auto">
            {useCustomLayout ? (
              content
            ) : (
              <PageLayout
                fullHeight={false}
                className="min-h-full pb-0"
                contentClassName="pb-xl"
                headerClassName="pb-sm"
              >
                {content}
              </PageLayout>
            )}
          </main>
        </div>
        <MobileNavigation navItems={navItems} onOpenSessionModal={openSessionModal} />
        <WelcomeTour />
        <CustomTourRenderer />

        <ChangelogModal open={isChangelogOpen} onClose={() => setIsChangelogOpen(false)} />
        <Toaster richColors position="top-right" closeButton />
        <NewSessionModal
          open={sessionModalState.isOpen}
          onClose={closeSessionModal}
          initialStudentId={sessionModalState.studentId}
          initialStudentStatus={sessionModalState.studentStatus}
          onCreated={sessionModalState.onCreated}
        />
      </div>
      </AccessibilityProvider>
    </SessionModalContext.Provider>
  )
}
