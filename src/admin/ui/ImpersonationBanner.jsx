import React from 'react';
import { LogOut, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useImpersonation } from '../impersonation/ImpersonationContext.jsx';

/**
 * Persistent banner shown across every admin page (and ideally the product
 * surface too, once the provider is mounted at the app root) whenever the
 * current tab is impersonating another user.
 *
 * State is sourced from ImpersonationContext. Clicking "Exit" ends the
 * session server-side, restores the admin session via Supabase setSession,
 * and clears the stash.
 */
export default function ImpersonationBanner({ className }) {
  const { active, session, exit, refreshing } = useImpersonation();
  if (!active || !session) return null;

  const { targetEmail, targetName, targetOrgName, startedAt } = session;

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
          {targetOrgName ? <> at <span className="font-semibold">{targetOrgName}</span></> : null}.
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
        disabled={refreshing}
        className="border-amber-400 bg-white text-amber-900 hover:bg-amber-50"
        onClick={exit}
      >
        <LogOut className="mr-1.5 h-3.5 w-3.5" />
        {refreshing ? 'Exiting…' : 'Exit impersonation'}
      </Button>
    </div>
  );
}
