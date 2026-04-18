import React from 'react';
import { UserCheck } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { startImpersonation } from './impersonation-client.js';
import { captureAdminEvent } from '../lib/admin-analytics.js';

const TYPED_CONFIRM_PHRASE = 'log in as user';

const IMPERSONATION_ERRORS = {
  target_email_required: 'Target email is missing. Please enter the email of the user to impersonate.',
  reason_required: 'Reason must be at least 3 characters.',
  cannot_impersonate_self: 'You cannot impersonate your own account. Use a different user\'s email.',
  target_user_not_found: 'No user with that email exists in the database.',
  generate_link_failed: 'Failed to generate a login token. Check that the user\'s auth record is active in Supabase.',
  generate_link_missing_token: 'The server returned a token-generation response with no token — check Supabase Auth settings.',
  session_insert_failed: 'Could not create the impersonation session row. Run the setup SQL (src/lib/setup-sql.js) against your database.',
  impersonation_table_missing: 'The impersonation_sessions table is missing. Run the setup SQL against your Supabase project.',
  server_misconfigured: 'Server is missing Supabase credentials. Check Azure application settings.',
  mfa_required: 'Your admin session does not have MFA (AAL2). Re-authenticate with TOTP before impersonating.',
  forbidden: 'Your account is not marked as a system administrator.',
};

/**
 * Dialog that captures reason + duration + typed-confirm, then starts the
 * impersonation session. On success, the dialog itself triggers a
 * navigation back to the root of the product so the admin sees the target
 * user's experience with the ImpersonationBanner pinned across the top.
 */
export default function ImpersonateUserDialog({
  open,
  onOpenChange,
  targetUser,
  targetOrg = null,
  onStarted = null,
}) {
  const [reason, setReason] = React.useState('');
  const [duration, setDuration] = React.useState(30);
  const [typed, setTyped] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!open) {
      setReason('');
      setDuration(30);
      setTyped('');
      setError('');
      setSubmitting(false);
    }
  }, [open]);

  const reasonOk = reason.trim().length >= 3;
  const typedOk = typed.trim().toLowerCase() === TYPED_CONFIRM_PHRASE;
  const durationOk = Number.isFinite(Number(duration)) && Number(duration) > 0;
  const canSubmit = reasonOk && typedOk && durationOk && !submitting;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit || !targetUser?.email) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await startImpersonation({
        targetEmail: targetUser.email,
        reason: reason.trim(),
        durationMinutes: Number(duration),
        targetOrgId: targetOrg?.id || undefined,
      });
      captureAdminEvent('impersonation_started', {
        session_id: result.sessionId,
        target_email: result.targetEmail,
        duration_minutes: Number(duration),
      });
      onStarted?.(result);
      onOpenChange?.(false);
      // After swapping the session, route to the product root so the admin
      // sees the target user's default landing.
      window.location.assign('/');
    } catch (err) {
      const code = err?.message || '';
      const humanMessage = IMPERSONATION_ERRORS[code] || code || 'Failed to start impersonation.';
      setError(humanMessage);
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200">
              <UserCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <AlertDialogTitle>Log in as {targetUser?.full_name || targetUser?.email}</AlertDialogTitle>
              <AlertDialogDescription className="text-sm leading-6">
                You will take over this user's session in the current tab. Every action you
                take will be recorded in the audit log under your admin account.
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs uppercase tracking-wider text-slate-500">Target</div>
            <div className="mt-1 font-medium text-slate-900">
              {targetUser?.email}
            </div>
            {targetOrg?.name ? (
              <div className="text-xs text-slate-600">at {targetOrg.name}</div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="imp-reason" className="text-xs font-medium text-slate-700">
              Reason (visible to you in the audit log) <span className="text-rose-500">*</span>
            </Label>
            <Textarea
              id="imp-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Ticket #1234 — customer reports schedule not saving"
              rows={3}
              className="resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="imp-duration" className="text-xs font-medium text-slate-700">
              Duration (minutes) — max 240
            </Label>
            <Input
              id="imp-duration"
              type="number"
              min={1}
              max={240}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="imp-typed" className="text-xs font-medium text-slate-700">
              Type <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] font-mono text-slate-900">
                {TYPED_CONFIRM_PHRASE}
              </code> to confirm
            </Label>
            <Input
              id="imp-typed"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>

          {error ? (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800 ring-1 ring-rose-200">
              {error}
            </p>
          ) : null}

          <AlertDialogFooter className="!mt-2">
            <AlertDialogCancel disabled={submitting} type="button">
              Cancel
            </AlertDialogCancel>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="min-w-[8rem] bg-amber-600 text-white hover:bg-amber-700"
            >
              {submitting ? 'Starting…' : 'Start session'}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
