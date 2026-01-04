import React, { useMemo, useState } from 'react';
import { NavLink, useLocation, matchPath } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Calendar,
  Users,
  UserCog,
  Coins,
  Settings,
  Pin,
  PinOff,
} from 'lucide-react';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'דשבורד', to: '/dashboard', icon: LayoutDashboard, end: true },
  { key: 'calendar', label: 'יומן', to: '/calendar', icon: Calendar },
  { key: 'students', label: 'תלמידים', to: '/students-list', icon: Users },
  { key: 'instructors', label: 'מדריכים', to: '/instructors', icon: UserCog },
  { key: 'financials', label: 'כספים', to: '/financials', icon: Coins },
  { key: 'settings', label: 'הגדרות', to: '/Settings', icon: Settings },
];

function isStudentsRoute(pathname) {
  return Boolean(matchPath('/students-list/*', pathname) || matchPath('/students/:id', pathname));
}

export default function Sidebar() {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const expanded = pinned || hovered;
  const location = useLocation();

  const items = useMemo(() => NAV_ITEMS, []);

  return (
    <aside
      dir="rtl"
      className={cn(
        'hidden md:flex md:h-screen md:flex-col md:border-l md:border-border md:bg-surface',
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
              className={({ isActive }) => {
                const active =
                  isActive || (item.key === 'students' && isStudentsRoute(location.pathname));
                return cn(
                  'flex items-center rounded-xl px-sm py-sm text-sm font-medium transition',
                  expanded ? 'justify-between' : 'justify-center',
                  active ? 'bg-primary/10 text-primary' : 'text-neutral-600 hover:bg-neutral-100'
                );
              }}
            >
              <div className={cn('flex items-center gap-sm', expanded ? '' : 'justify-center')}>
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span
                  className={cn(
                    'whitespace-nowrap transition-opacity duration-150',
                    expanded ? 'opacity-100' : 'pointer-events-none opacity-0'
                  )}
                >
                  {item.label}
                </span>
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
          onClick={() => setPinned((prev) => !prev)}
          aria-label={pinned ? 'ביטול נעילת סרגל צד' : 'נעילת סרגל צד'}
        >
          {pinned ? <PinOff className="h-4 w-4" aria-hidden="true" /> : <Pin className="h-4 w-4" aria-hidden="true" />}
          <span
            className={cn(
              'whitespace-nowrap transition-opacity duration-150',
              expanded ? 'opacity-100' : 'pointer-events-none opacity-0'
            )}
          >
            {pinned ? 'בטל נעילה' : 'נעילה'}
          </span>
        </Button>
      </div>
    </aside>
  );
}
