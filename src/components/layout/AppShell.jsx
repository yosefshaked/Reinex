import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Outlet } from "react-router-dom"
import { Megaphone, LogOut, PanelRightOpen, PanelRightClose } from "lucide-react"
import { Toaster, toast } from "sonner"

import OrgConfigBanner from "@/components/OrgConfigBanner.jsx"
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

export default function AppShell({ children }) {
  const { signOut } = useAuth()
  const { activeOrg } = useOrg()
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
        <div className="relative flex min-h-screen flex-1 flex-col pb-[88px] md:h-screen md:pb-0">
          <header
            ref={headerRef}
            className="sticky top-0 z-20 border-b border-border bg-surface/80 px-sm py-sm backdrop-blur md:border-none md:bg-transparent md:px-md md:py-sm"
          >
            <div className="flex items-center justify-between gap-xs">
              <div className="flex items-center gap-xs sm:gap-sm">
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

        <Sidebar hidden={isSidebarHidden} onToggleHidden={() => setIsSidebarHidden((prev) => !prev)} />
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
  )
}
