import React from 'react';
import { LogOut, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Persistent banner shown across every admin page (and ideally across the
 * product surface) whenever the current session is impersonating another user.
 *
 * Reads impersonation state from window.__IMPERSONATION__ if present.
 * This is a placeholder signal — the Organizations/Users redesign will wire
 * the real state in via context once the impersonation API lands.
 */
export function useImpersonationState() {
  const [state, setState] = React.useState(() => {
    if (typeof window === 'undefined') return null;
    return window.__IMPERSONATION__ || null;
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = () => setState(window.__IMPERSONATION__ || null);
    window.addEventListener('reinex:impersonation-changed', handler);
    return () => window.removeEventListener('reinex:impersonation-changed', handler);
  }, []);

  return state;
}

export default function ImpersonationBanner({ className }) {
  const state = useImpersonationState();
  if (!state || !state.active) return null;

  const { targetEmail, targetName, orgName, startedAt, onExit } = state;

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-center gap-3 border-b border-amber-300 bg-amber-100/90 px-4 py-2 text-sm text-amber-900',
        className,
      )}
    >
      <UserCheck className="h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          You are impersonating <span className="font-semibold">{targetName || targetEmail}</span>
          {orgName ? <> at <span className="font-semibold">{orgName}</span></> : null}.
        </p>
        {startedAt ? (
          <p className="text-xs text-amber-800/80">
            Session started {new Date(startedAt).toLocaleString()}. Every action is written to the audit log.
          </p>
        ) : null}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="border-amber-400 bg-white text-amber-900 hover:bg-amber-50"
        onClick={() => {
          if (typeof onExit === 'function') {
            onExit();
          } else if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('reinex:impersonation-exit-requested'));
          }
        }}
      >
        <LogOut className="mr-1.5 h-3.5 w-3.5" />
        Exit impersonation
      </Button>
    </div>
  );
}
