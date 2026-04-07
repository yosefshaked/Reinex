import React, { useMemo, useState } from 'react';
import { NavLink, useLocation, matchPath } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { authenticatedFetch } from '@/lib/api-client.js';
import HiddenUatAdminToolsDialog from '@/features/admin/components/HiddenUatAdminToolsDialog.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { normalizeMembershipRole, isAdminOrOffice } from '@/features/students/utils/endpoints.js';
import {
  LayoutDashboard,
  Calendar,
  Users,
  UserRound,
  UserCog,
  ListChecks,
  ClipboardList,
  Coins,
  FileText,
  Settings,
  Pin,
  PinOff,
  PanelRightClose,
  Loader2,
  Shield,
} from 'lucide-react';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'דשבורד', to: '/dashboard', icon: LayoutDashboard, end: true },
  { key: 'calendar', label: 'יומן', to: '/calendar', icon: Calendar },
  { key: 'students', label: 'תלמידים', to: '/students-list', icon: Users },
  { key: 'one-time-customers', label: 'לקוחות חד-פעמיים', to: '/one-time-customers', icon: UserRound },
  { key: 'waiting-list', label: 'רשימת המתנה', to: '/waiting-list', icon: ClipboardList },
  { key: 'employees', label: 'עובדים', to: '/employees', icon: UserCog },
  { key: 'services', label: 'שירותים', to: '/services', icon: ListChecks },
  { key: 'financials', label: 'כספים', to: '/financials', icon: Coins },
  { key: 'forms', label: 'טפסים', to: '/forms', icon: FileText },
  { key: 'settings', label: 'הגדרות', to: '/Settings', icon: Settings },
];

function isStudentsRoute(pathname) {
  return Boolean(matchPath('/students-list/*', pathname) || matchPath('/students/:id', pathname));
}

export default function Sidebar({ hidden = false, onToggleHidden }) {
  const SEQUENCE_WINDOW_MS = 5000;

  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [sequenceState, setSequenceState] = useState({ step: 0, startedAt: 0 });
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [adminToolsOpen, setAdminToolsOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [authPasswordInput, setAuthPasswordInput] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState('');
  const expanded = pinned || hovered;
  const location = useLocation();
  const { activeOrgId, activeOrg } = useOrg();
  const membershipRole = normalizeMembershipRole(activeOrg?.membership?.role || '');
  const canManageClients = isAdminOrOffice(membershipRole);

  const items = useMemo(
    () => NAV_ITEMS.filter((item) => (
      canManageClients || !['one-time-customers', 'waiting-list'].includes(item.key)
    )),
    [canManageClients],
  );

  function resetSequence() {
    setSequenceState({ step: 0, startedAt: 0 });
  }

  async function attemptHiddenAdminTrigger() {
    if (!activeOrgId) {
      return;
    }

    try {
      const payload = await authenticatedFetch('debug/uat-tools', {
        method: 'GET',
        params: {
          org_id: activeOrgId,
        },
      });

      if (payload?.enabled !== true) {
        return;
      }

      setAuthPasswordInput('');
      setAuthError('');
      setAuthDialogOpen(true);
    } catch {
      // Intentionally silent (fail-closed).
    }
  }

  function trackSidebarSequence(action) {
    const now = Date.now();
    const step = sequenceState.step;
    const startedAt = sequenceState.startedAt;
    const expired = startedAt > 0 && now - startedAt > SEQUENCE_WINDOW_MS;

    if (expired) {
      if (action === 'pin') {
        setSequenceState({ step: 1, startedAt: now });
      } else {
        resetSequence();
      }
      return;
    }

    if (action === 'pin') {
      if (step >= 0 && step < 4) {
        setSequenceState({
          step: step + 1,
          startedAt: step === 0 ? now : startedAt,
        });
        return;
      }

      setSequenceState({ step: 1, startedAt: now });
      return;
    }

    if (action === 'settings') {
      if (step === 4) {
        resetSequence();
        void attemptHiddenAdminTrigger();
        return;
      }
      resetSequence();
      return;
    }

    resetSequence();
  }

  async function handleAuthenticateAdminTool() {
    if (!activeOrgId) {
      setAuthError('אין ארגון פעיל.');
      return;
    }

    if (!authPasswordInput.trim()) {
      setAuthError('יש להזין סיסמה.');
      return;
    }

    setIsAuthenticating(true);
    setAuthError('');

    try {
      await authenticatedFetch('debug/uat-tools', {
        method: 'POST',
        body: {
          action: 'authenticate',
          org_id: activeOrgId,
          password: authPasswordInput,
        },
      });

      setAdminPassword(authPasswordInput);
      setAuthPasswordInput('');
      setAuthDialogOpen(false);
      setAdminToolsOpen(true);
    } catch (error) {
      setAuthError(error?.data?.message || error?.message || 'אימות נכשל.');
    } finally {
      setIsAuthenticating(false);
    }
  }

  function handleCancelAuthDialog() {
    setAuthDialogOpen(false);
    setAuthPasswordInput('');
    setAuthError('');
  }

  if (hidden) {
    return null;
  }

  return (
    <aside
     
      className={cn(
        'hidden md:flex md:h-screen md:flex-col md:border-s md:border-border md:bg-surface',
        'transition-[width] duration-200 ease-out',
        expanded ? 'md:w-64' : 'md:w-16'
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <nav className="flex flex-1 flex-col gap-1 p-sm" aria-label="ניווט ראשי">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.key}
              to={item.to}
              end={item.end}
              aria-label={item.label}
              onClick={() => trackSidebarSequence(item.key === 'settings' ? 'settings' : 'other')}
              className={({ isActive }) => {
                const active =
                  isActive || (item.key === 'students' && isStudentsRoute(location.pathname));
                return cn(
                  'flex items-center rounded-xl px-sm py-sm text-sm font-medium transition',
                  expanded ? 'justify-start' : 'justify-center',
                  active ? 'bg-primary/10 text-primary' : 'text-neutral-600 hover:bg-neutral-100'
                );
              }}
            >
              <div className={cn('flex items-center gap-sm', expanded ? '' : 'justify-center')}>
                <Icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
                {expanded ? <span className="whitespace-nowrap">{item.label}</span> : null}
              </div>
            </NavLink>
          );
        })}
      </nav>

      <div className="border-t border-border p-sm">
        <Button
          type="button"
          variant="ghost"
          className={cn('w-full justify-center', expanded ? 'gap-sm' : '')}
          onClick={() => {
            setPinned((prev) => !prev);
            trackSidebarSequence('pin');
          }}
          aria-label={pinned ? 'ביטול נעילת סרגל צד' : 'נעילת סרגל צד'}
        >
          {pinned ? <PinOff className="h-4 w-4" aria-hidden="true" /> : <Pin className="h-4 w-4" aria-hidden="true" />}
          {expanded ? <span className="whitespace-nowrap">{pinned ? 'בטל נעילה' : 'נעילה'}</span> : null}
        </Button>

        <Button
          type="button"
          variant="ghost"
          className={cn('mt-xs w-full justify-center', expanded ? 'gap-sm' : '')}
          onClick={() => {
            trackSidebarSequence('other');
            onToggleHidden?.();
          }}
          aria-label="הסתר סרגל צד"
        >
          <PanelRightClose className="h-4 w-4" aria-hidden="true" />
          {expanded ? <span className="whitespace-nowrap">הסתר</span> : null}
        </Button>
      </div>

      <Dialog
        open={authDialogOpen}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            setAuthDialogOpen(true);
          }
        }}
      >
        <DialogContent
          hideDefaultClose
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Admin Authentication
            </DialogTitle>
            <DialogDescription>
              יש להזין סיסמת מנהל כדי לפתוח את כלי ה-UAT המוסתר.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="hidden-admin-tool-password">סיסמה</Label>
            <Input
              id="hidden-admin-tool-password"
              type="password"
              autoComplete="off"
              value={authPasswordInput}
              onChange={(event) => setAuthPasswordInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleAuthenticateAdminTool();
                }
              }}
            />
            {authError ? (
              <p className="text-sm text-red-600">{authError}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCancelAuthDialog} disabled={isAuthenticating}>
              ביטול
            </Button>
            <Button type="button" onClick={handleAuthenticateAdminTool} disabled={isAuthenticating}>
              {isAuthenticating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'אימות'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HiddenUatAdminToolsDialog
        open={adminToolsOpen}
        onOpenChange={(nextOpen) => {
          setAdminToolsOpen(nextOpen);
          if (!nextOpen) {
            setAdminPassword('');
          }
        }}
        orgId={activeOrgId}
        password={adminPassword}
      />
    </aside>
  );
}
