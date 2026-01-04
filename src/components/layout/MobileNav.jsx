import React, { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Calendar,
  Users,
  Menu,
  UserCog,
  Coins,
  Settings,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from '@/components/ui/sheet.jsx';
import useKeyboardAwareBottomOffset from '@/hooks/useKeyboardAwareBottomOffset.js';

const PRIMARY_ITEMS = [
  { key: 'dashboard', label: 'דשבורד', to: '/dashboard', icon: LayoutDashboard, end: true },
  { key: 'calendar', label: 'יומן', to: '/calendar', icon: Calendar },
  { key: 'students', label: 'תלמידים', to: '/students-list', icon: Users },
];

const DRAWER_ITEMS = [
  { key: 'employees', label: 'עובדים', to: '/employees', icon: UserCog },
  { key: 'financials', label: 'כספים', to: '/financials', icon: Coins },
  { key: 'settings', label: 'הגדרות', to: '/Settings', icon: Settings },
];

function NavItem({ to, end, label, icon: Icon }) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={label}
      className={({ isActive }) =>
        cn(
          'flex flex-col items-center justify-center gap-1 px-2 py-1 text-xs font-medium',
          isActive ? 'text-primary' : 'text-neutral-500'
        )
      }
    >
      {React.createElement(Icon, { className: 'h-6 w-6', 'aria-hidden': true })}
      <span className="leading-tight">{label}</span>
    </NavLink>
  );
}

export default function MobileNav() {
  const keyboardOffset = useKeyboardAwareBottomOffset();

  const primaryItems = useMemo(() => PRIMARY_ITEMS, []);
  const drawerItems = useMemo(() => DRAWER_ITEMS, []);

  return (
    <nav
      role="navigation"
      aria-label="ניווט ראשי"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-border bg-surface px-lg pb-sm pt-xs md:hidden"
      style={
        keyboardOffset > 0
          ? {
              position: 'fixed',
              transform: `translateY(-${keyboardOffset}px) translateZ(0)`,
              willChange: 'transform',
              isolation: 'isolate',
            }
          : { position: 'fixed', transform: 'translateZ(0)', willChange: 'transform', isolation: 'isolate' }
      }
    >
      <div className="mx-auto grid max-w-md grid-cols-4 items-center gap-md" dir="rtl">
        {primaryItems.map((item) => (
          <NavItem key={item.key} {...item} />
        ))}

        <Sheet>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="תפריט"
              className="flex flex-col items-center justify-center gap-1 px-2 py-1 text-xs font-medium text-neutral-500"
            >
              <Menu className="h-6 w-6" aria-hidden="true" />
              <span className="leading-tight">תפריט</span>
            </button>
          </SheetTrigger>

          <SheetContent side="bottom" className="bg-surface border-t border-border" dir="rtl">
            <SheetHeader className="text-right">
              <SheetTitle className="text-right">תפריט</SheetTitle>
            </SheetHeader>

            <div className="mt-4 space-y-2">
              {drawerItems.map((item) => {
                return (
                  <SheetClose asChild key={item.key}>
                    <NavLink
                      to={item.to}
                      aria-label={item.label}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center justify-between gap-sm rounded-xl px-md py-sm text-sm font-medium transition',
                          isActive ? 'bg-primary/10 text-primary' : 'text-neutral-600 hover:bg-neutral-100'
                        )
                      }
                    >
                      <div className="flex items-center gap-sm">
                        {React.createElement(item.icon, { className: 'h-5 w-5', 'aria-hidden': true })}
                        <span>{item.label}</span>
                      </div>
                    </NavLink>
                  </SheetClose>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
