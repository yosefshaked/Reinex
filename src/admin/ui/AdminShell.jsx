import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Home } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { ADMIN_NAV, flattenNav } from './navConfig.js';
import ImpersonationBanner from './ImpersonationBanner.jsx';
import StatusBadge from './StatusBadge.jsx';
import { ImpersonationProvider } from '../impersonation/ImpersonationContext.jsx';

function AdminSidebar() {
  const location = useLocation();
  const current = location.pathname;

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1 py-1.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-white">
            <Home className="h-4 w-4" />
          </div>
          <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              System Console
            </span>
            <span className="truncate text-sm font-semibold text-slate-900">
              Reinex Admin
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {ADMIN_NAV.map((group) => (
          <SidebarGroup key={group.group}>
            <SidebarGroupLabel>{group.group}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = current === item.to || current.startsWith(`${item.to}/`);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.label}
                      >
                        <Link to={item.to}>
                          <Icon />
                          <span className="truncate">{item.label}</span>
                          {item.status === 'coming-soon' ? (
                            <span className="ml-auto text-[10px] font-medium uppercase tracking-wider text-violet-500 group-data-[collapsible=icon]:hidden">
                              soon
                            </span>
                          ) : null}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <div className="px-2 py-1 text-[11px] text-slate-500 group-data-[collapsible=icon]:hidden">
          Press <kbd className="rounded border border-slate-300 bg-white px-1 font-mono text-[10px]">⌘B</kbd> to toggle
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

function Topbar() {
  const location = useLocation();
  const flat = React.useMemo(() => flattenNav(), []);
  const current = flat.find((i) => location.pathname === i.to || location.pathname.startsWith(`${i.to}/`));

  return (
    <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-slate-200 bg-white/90 px-3 backdrop-blur">
      <SidebarTrigger className="h-8 w-8" />
      <Separator orientation="vertical" className="mx-1 h-6" />
      <div className="flex min-w-0 items-center gap-2 text-xs text-slate-500">
        <span>Reinex Admin</span>
        {current ? (
          <>
            <span className="text-slate-300">/</span>
            <span className="text-slate-500">{current.group}</span>
            <span className="text-slate-300">/</span>
            <span className="truncate font-medium text-slate-800">{current.label}</span>
          </>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <StatusBadge tone="success" dot size="sm">Live</StatusBadge>
      </div>
    </header>
  );
}

/**
 * Full admin shell: collapsible sidebar + top bar + impersonation banner slot
 * + outlet for the current module. Replaces the old AdminLayout.
 */
export default function AdminShell({ children }) {
  const defaultOpen = React.useMemo(() => {
    if (typeof document === 'undefined') return true;
    const cookie = document.cookie.split('; ').find((c) => c.startsWith('sidebar_state='));
    if (!cookie) return true;
    return cookie.split('=')[1] !== 'false';
  }, []);

  return (
    <ImpersonationProvider>
      <SidebarProvider defaultOpen={defaultOpen}>
        <AdminSidebar />
        <SidebarInset className="bg-slate-50">
          <ImpersonationBanner />
          <Topbar />
          <main className={cn('mx-auto w-full max-w-[1600px] p-5')}>
            {children ?? <Outlet />}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </ImpersonationProvider>
  );
}
