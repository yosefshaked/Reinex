import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import { Megaphone, LogOut, PanelRightOpen, PanelRightClose, RefreshCw, UserCog, X } from "lucide-react"
import { Toaster } from "@/components/ui/sonner.jsx"
import { toast } from "@/lib/toast.jsx"

import OrgSelectionBanner from "@/components/OrgSelectionBanner.jsx"
import ChangelogModal from "@/components/ChangelogModal"
import PageLayout from "@/components/ui/PageLayout.jsx"
import { useAuth } from "@/auth/AuthContext.jsx"
import { useOrg } from "@/org/OrgContext.jsx"
import NewSessionModal from "@/features/sessions/components/NewSessionModal.jsx"
import { SessionModalContext } from "@/features/sessions/context/SessionModalContext.jsx"
import OrgLogo from "@/components/layout/OrgLogo.jsx"
import { WelcomeTour } from "@/features/onboarding/components/WelcomeTour.jsx"
import CustomTourRenderer from "@/features/onboarding/components/CustomTourRenderer.jsx"
import { AccessibilityProvider } from "@/features/accessibility/AccessibilityProvider.jsx"
import AccessibilityButton from "@/features/accessibility/AccessibilityButton.jsx"
import SkipLink from "@/features/accessibility/SkipLink.jsx"

import Sidebar from "@/components/layout/Sidebar.jsx"
import MobileNav from "@/components/layout/MobileNav.jsx"
import { ImpersonationProvider } from "@/admin/impersonation/ImpersonationContext.jsx"
import ImpersonationBanner from "@/admin/ui/ImpersonationBanner.jsx"
import AnnouncementBanner from "@/components/AnnouncementBanner.jsx"

const INACTIVE_REFRESH_PROMPT_MS = 5 * 60 * 1000

export default function AppShell({ children }) {
  const { signOut } = useAuth()
  const { activeOrg } = useOrg()
  const navigate = useNavigate()
  const [isChangelogOpen, setIsChangelogOpen] = useState(false)
  const [isSidebarHidden, setIsSidebarHidden] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('app:sidebarHidden') === 'true'
  })
  const [sessionModalState, setSessionModalState] = useState({
    isOpen: false,
    studentId: '',
    studentStatus: 'active',
    onCreated: null,
  })
  const [showRefreshSuggestion, setShowRefreshSuggestion] = useState(false)
  const hiddenAtRef = useRef(null)

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('app:sidebarHidden', isSidebarHidden ? 'true' : 'false')
  }, [isSidebarHidden])

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

  const location = useLocation()
  const isCalendarPage = location.pathname === '/calendar'

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now()
        return
      }

      if (document.visibilityState !== 'visible') {
        return
      }

      if (!hiddenAtRef.current) {
        return
      }

      const hiddenDuration = Date.now() - hiddenAtRef.current
      hiddenAtRef.current = null

      if (hiddenDuration >= INACTIVE_REFRESH_PROMPT_MS) {
        setShowRefreshSuggestion(true)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  const handleRefreshSuggestion = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }, [])

  const content = children ?? <Outlet />
  const pageLayoutMode = React.isValidElement(content) ? content.props?.["data-page-layout"] : null
  const useCustomLayout = pageLayoutMode === "dashboard" || isCalendarPage

  return (
    <ImpersonationProvider>
    <SessionModalContext.Provider value={sessionModalContextValue}>
      <AccessibilityProvider>
      <div ref={shellRef} className="flex min-h-screen bg-background text-foreground overflow-x-hidden">
        <SkipLink />
        <Sidebar hidden={isSidebarHidden} onToggleHidden={() => setIsSidebarHidden((prev) => !prev)} />
        <div className="relative flex flex-1 flex-col pb-[88px] md:h-screen md:overflow-hidden md:pb-0">
          <header
            ref={headerRef}
            className="sticky top-0 z-20 border-b border-border bg-surface/80 px-sm py-sm backdrop-blur md:border-none md:bg-transparent md:px-md md:py-sm"
          >
            <div className="flex items-center gap-xs">
              <div className="flex shrink-0 items-center gap-xs sm:gap-sm">
                <button
                  type="button"
                  onClick={() => setIsSidebarHidden((prev) => !prev)}
                  className="hidden md:inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-border bg-surface p-2 text-neutral-600 transition hover:bg-neutral-100"
                  aria-label={isSidebarHidden ? 'הצג סרגל צד' : 'הסתר סרגל צד'}
                >
                  {isSidebarHidden ? (
                    <PanelRightOpen className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <PanelRightClose className="h-5 w-5" aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/select-org')}
                  className="rounded-2xl transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  aria-label="בחירת ארגון"
                >
                  <OrgLogo />
                </button>
                <div className="inline-flex min-h-[44px] items-center rounded-full border border-border bg-surface px-sm py-xs text-xs font-semibold text-foreground sm:px-md sm:text-sm">
                  {activeOrg?.name ? `ארגון: ${activeOrg.name}` : "בחרו ארגון לעבודה"}
                </div>
              </div>
              <div className="flex min-w-0 flex-1 items-center justify-center px-xs">
                <AnnouncementBanner />
              </div>
              <div className="flex shrink-0 items-center gap-xs">
                <AccessibilityButton />
                <button
                  type="button"
                  onClick={() => navigate('/account')}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-border bg-surface p-2 text-neutral-600 transition hover:bg-neutral-100"
                  aria-label="הגדרות אישיות"
                >
                  <UserCog className="h-5 w-5" aria-hidden="true" />
                </button>
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

          <ImpersonationBanner />
          <OrgSelectionBanner />
          {showRefreshSuggestion ? (
            <div className="mx-sm mt-2 rounded-2xl border border-blue-200 bg-blue-50 px-sm py-sm text-sm text-blue-950 md:mx-md">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  חזרתם אחרי כמה דקות. כדי לראות את השינויים האחרונים במערכת, מומלץ לרענן את המסך.
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleRefreshSuggestion}
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-blue-300 bg-white px-3 py-2 text-xs font-semibold text-blue-900 transition hover:bg-blue-100"
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    רענון עכשיו
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowRefreshSuggestion(false)}
                    className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full border border-blue-200 bg-blue-100 text-blue-800 transition hover:bg-blue-200"
                    aria-label="סגור הצעת רענון"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <main id="main-content" role="main" className={cn("flex-1", isCalendarPage ? "overflow-hidden flex flex-col" : "overflow-y-auto")}>
            {useCustomLayout ? (
              content
            ) : (
              <PageLayout
                fullHeight={false}
                className="min-h-full pb-0"
                contentClassName="pb-md"
                headerClassName="pb-sm"
              >
                {content}
              </PageLayout>
            )}
          </main>
        </div>
        <MobileNav />
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
    </ImpersonationProvider>
  )
}
