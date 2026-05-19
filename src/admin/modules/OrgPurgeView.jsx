import React from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCopy, ClipboardCheck, Skull, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '@/lib/api-client.js';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import ModuleShell from '../ui/ModuleShell.jsx';
import { useAdminModuleView } from '../lib/admin-analytics.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function SectionCard({ children, className = '' }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function formatAdminDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

function PrepareChecksNotice({ checks }) {
  if (!Array.isArray(checks) || checks.length === 0) return null;

  return (
    <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-700">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Prepare was blocked by {checks.length} drift check{checks.length !== 1 ? 's' : ''}
      </p>
      <div className="space-y-2">
        {checks.map((check, index) => {
          const lastBackupLabel = formatAdminDateTime(check?.last_backup_at);
          return (
            <div key={`${check?.check || 'check'}-${index}`} className="rounded-md border border-rose-100 bg-white/70 px-3 py-2">
              <p className="font-mono text-[11px] font-semibold text-rose-700">
                {check?.check || 'DRIFT_CHECK'}
              </p>
              <p className="mt-1 text-xs font-medium text-rose-800">
                {check?.message || 'Prepare failed.'}
              </p>
              {Object.prototype.hasOwnProperty.call(check || {}, 'last_backup_at') ? (
                <p className="mt-1 text-[11px] text-rose-700">
                  Last known backup: {lastBackupLabel || 'No recorded backups found'}
                </p>
              ) : null}
              {check?.hint ? (
                <p className="mt-1 text-[11px] text-rose-600">{check.hint}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RowCountsTable({ rowCounts }) {
  const entries = Object.entries(rowCounts || {});
  if (entries.length === 0) {
    return <p className="text-xs text-slate-500 italic">No rows found in any tracked table.</p>;
  }
  return (
    <div className="overflow-auto rounded-xl border border-slate-200">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left">
            <th className="px-3 py-2 font-semibold text-slate-600">Table</th>
            <th className="px-3 py-2 text-right font-semibold text-slate-600">Rows to delete</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([table, count]) => (
            <tr key={table} className="border-b border-slate-100 last:border-0">
              <td className="px-3 py-1.5 font-mono text-slate-700">{table}</td>
              <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${count > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                {count.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChallengeTokenBox({ token }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast.error('Failed to copy — please select and copy the token manually.');
    }
  }, [token]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">
          Challenge Token — copy before proceeding
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="gap-1.5 text-xs text-amber-800 hover:bg-amber-100 hover:text-amber-900"
        >
          {copied
            ? <><ClipboardCheck className="h-3.5 w-3.5" /> Copied!</>
            : <><ClipboardCopy className="h-3.5 w-3.5" /> Copy token</>}
        </Button>
      </div>
      <pre className="select-all break-all rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 font-mono text-[11px] leading-5 text-amber-900 shadow-inner">
        {token}
      </pre>
      <p className="text-[11px] text-amber-700">
        This token expires in 15 minutes. Paste it into the Execute step below — it cannot be re-generated without running Prepare again.
      </p>
    </div>
  );
}

// ── Step 1: Prepare ───────────────────────────────────────────────────────────

function PrepareStep({ onSuccess }) {
  const [orgId, setOrgId] = React.useState('');
  const [forceSkipBackupCheck, setForceSkipBackupCheck] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [prepareChecks, setPrepareChecks] = React.useState([]);

  const handlePrepare = React.useCallback(async () => {
    const trimmed = orgId.trim();
    if (!trimmed) {
      setError('Organization ID is required.');
      return;
    }
    setLoading(true);
    setError('');
    setPrepareChecks([]);
    try {
      const data = await authenticatedFetch('org-purge/prepare', {
        method: 'POST',
        body: {
          org_id: trimmed,
          force_skip_backup_check: forceSkipBackupCheck,
        },
      });
      onSuccess(data);
    } catch (err) {
      const checks = Array.isArray(err?.data?.checks) ? err.data.checks : [];
      const reason = err?.data?.reason || err?.data?.error || err?.message || 'Prepare failed.';
      setPrepareChecks(checks);
      setError(reason);
      toast.error(`Prepare failed: ${reason}`);
    } finally {
      setLoading(false);
    }
  }, [forceSkipBackupCheck, orgId, onSuccess]);

  return (
    <SectionCard>
      <h3 className="mb-4 text-sm font-semibold text-slate-800">Step 1 — Generate purge plan</h3>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-slate-500">Organization UUID</Label>
          <Input
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            disabled={loading}
            className="font-mono text-sm"
          />
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-3">
            <Checkbox
              id="force-skip-backup-check"
              checked={forceSkipBackupCheck}
              onCheckedChange={(checked) => setForceSkipBackupCheck(checked === true)}
              disabled={loading}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <Label htmlFor="force-skip-backup-check" className="text-xs font-semibold text-amber-900">
                Bypass the recent-backup guard for this purge
              </Label>
              <p className="text-[11px] leading-5 text-amber-800">
                Only enable this when you explicitly accept that no backup was found in the last 30 days.
                This does not skip any other drift checks.
              </p>
            </div>
          </div>
        </div>
        {error ? (
          <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        ) : null}
        <PrepareChecksNotice checks={prepareChecks} />
        <Button
          onClick={handlePrepare}
          disabled={loading || !orgId.trim()}
          className="w-full sm:w-auto"
        >
          {loading ? 'Running drift checks…' : 'Prepare Purge Plan'}
        </Button>
        <p className="text-[11px] text-slate-400">
          This step is non-destructive. It runs drift checks and generates a time-limited challenge token — no data is modified.
        </p>
      </div>
    </SectionCard>
  );
}

// ── Step 2: Review ────────────────────────────────────────────────────────────

function ReviewStep({ plan, onProceed, onCancel }) {
  const expiresAt = plan?.challenge_expires_at
    ? new Date(plan.challenge_expires_at).toLocaleTimeString()
    : '—';

  const totalRows = Object.values(plan?.row_counts || {}).reduce((sum, n) => sum + n, 0);
  const warnings = Array.isArray(plan?.drift_warnings) ? plan.drift_warnings : [];

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Step 2 — Review purge plan</h3>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
            Manifest {plan?.manifest_version}
          </span>
        </div>

        <dl className="mb-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <dt className="text-slate-500">Organization</dt>
            <dd className="mt-0.5 font-semibold text-slate-800 truncate">{plan?.org_name ?? '—'}</dd>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <dt className="text-slate-500">Plan ID</dt>
            <dd className="mt-0.5 font-mono text-[10px] text-slate-700 break-all">{plan?.plan_id ?? '—'}</dd>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <dt className="text-slate-500">Total rows</dt>
            <dd className={`mt-0.5 font-semibold tabular-nums ${totalRows > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
              {totalRows.toLocaleString()}
            </dd>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <dt className="text-slate-500">Storage files</dt>
            <dd className={`mt-0.5 font-semibold tabular-nums ${(plan?.storage_file_count ?? 0) > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
              {(plan?.storage_file_count ?? 0).toLocaleString()}
            </dd>
          </div>
        </dl>

        {warnings.length > 0 ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-800">
              <TriangleAlert className="h-3.5 w-3.5" />
              {warnings.length} drift warning{warnings.length !== 1 ? 's' : ''}
            </p>
            <ul className="space-y-0.5">
              {warnings.map((w, i) => (
                <li key={i} className="font-mono text-[11px] text-amber-700">{typeof w === 'string' ? w : JSON.stringify(w)}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mb-4 flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            No drift warnings — schema is consistent with manifest.
          </div>
        )}

        <div className="mb-4">
          <p className="mb-1.5 text-xs font-semibold text-slate-600">Rows by table</p>
          <RowCountsTable rowCounts={plan?.row_counts} />
        </div>
      </SectionCard>

      <SectionCard className="border-amber-200 bg-amber-50">
        <ChallengeTokenBox token={plan?.challenge ?? ''} />
        <p className="mt-3 text-[11px] font-medium text-amber-800">
          Token expires at <strong>{expiresAt}</strong>. Scroll down to the Execute step and paste it there.
        </p>
      </SectionCard>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          className="text-slate-600"
        >
          Cancel — start over
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={onProceed}
        >
          I have copied the token — proceed to Execute
        </Button>
      </div>
    </div>
  );
}

// ── Step 3: Execute ───────────────────────────────────────────────────────────

function ExecuteStep({ plan, onSuccess, onCancel }) {
  const [challenge, setChallenge] = React.useState('');
  const [orgNameConfirm, setOrgNameConfirm] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  const orgName = plan?.org_name ?? '';
  const planId = plan?.plan_id ?? '';

  const formValid =
    challenge.trim() &&
    orgNameConfirm === orgName &&
    reason.trim().length >= 3;

  const handleExecute = React.useCallback(async () => {
    if (!formValid) return;
    setLoading(true);
    setError('');
    try {
      const data = await authenticatedFetch('org-purge/execute', {
        method: 'POST',
        body: {
          plan_id: planId,
          challenge: challenge.trim(),
          org_name_confirm: orgNameConfirm,
          reason: reason.trim(),
        },
      });
      onSuccess(data);
      toast.success(`Purge complete. "${orgName}" has been tombstoned.`);
    } catch (err) {
      const reason = err?.data?.reason || err?.data?.error || err?.message || 'Execute failed.';
      setError(reason);
      toast.error(`Execute failed: ${reason}`);
    } finally {
      setLoading(false);
    }
  }, [formValid, planId, challenge, orgNameConfirm, reason, orgName, onSuccess]);

  return (
    <div className="space-y-4">
      {/* Danger banner */}
      <div className="rounded-2xl border-2 border-rose-500 bg-rose-50 p-5 shadow-md">
        <div className="mb-3 flex items-start gap-3">
          <Skull className="mt-0.5 h-6 w-6 shrink-0 text-rose-600" />
          <div>
            <p className="text-sm font-bold text-rose-800 uppercase tracking-wide">
              Step 3 — IRREVERSIBLE PURGE
            </p>
            <p className="mt-1 text-xs text-rose-700 leading-5">
              This will permanently delete all data for <strong>{orgName}</strong> across all 14 phases,
              including storage files, billing records, and user associations.
              This action <strong>cannot be undone</strong>.
              The organization row will be tombstoned (not deleted) for audit purposes.
            </p>
          </div>
        </div>
      </div>

      <SectionCard className="border-rose-200">
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-rose-700">
              Paste challenge token
            </Label>
            <Textarea
              value={challenge}
              onChange={(e) => setChallenge(e.target.value)}
              placeholder="Paste the challenge token you copied in Step 2"
              rows={3}
              disabled={loading}
              className="font-mono text-[11px] leading-5"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-rose-700">
              Type the exact organization name to confirm
            </Label>
            <Input
              value={orgNameConfirm}
              onChange={(e) => setOrgNameConfirm(e.target.value)}
              placeholder={orgName}
              disabled={loading}
              className={`font-mono text-sm ${orgNameConfirm && orgNameConfirm !== orgName ? 'border-rose-400 ring-1 ring-rose-400' : ''}`}
            />
            {orgNameConfirm && orgNameConfirm !== orgName ? (
              <p className="text-[11px] text-rose-600">Name does not match — must be exactly: {orgName}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">
              Reason / ticket reference <span className="text-slate-400">(required)</span>
            </Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. JIRA-1234 or 'customer requested account deletion'"
              disabled={loading}
            />
          </div>

          {error ? (
            <p className="flex items-center gap-1.5 rounded-lg bg-rose-100 px-3 py-2 text-xs font-medium text-rose-800">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={loading}
              className="text-slate-600"
            >
              Cancel
            </Button>
            <Button
              onClick={handleExecute}
              disabled={!formValid || loading}
              className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500 disabled:opacity-50"
            >
              {loading
                ? 'Purging — do not close this tab…'
                : 'EXECUTE PERMANENT PURGE'}
            </Button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

// ── Step 4: Done ──────────────────────────────────────────────────────────────

function DoneStep({ result, onReset }) {
  const deletedTotal = Object.values(result?.deleted_counts || {}).reduce((s, n) => s + n, 0);
  const phaseErrors = Array.isArray(result?.phase_errors) ? result.phase_errors : [];
  const storage = result?.storage;

  return (
    <SectionCard className="border-emerald-300 bg-emerald-50">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-emerald-800">Purge complete</p>
          <p className="mt-1 text-xs text-emerald-700">
            {deletedTotal.toLocaleString()} rows deleted across all phases.
            {storage ? ` Storage: ${storage.deleted ?? 0} files deleted, ${storage.failed ?? 0} failed.` : ''}
          </p>
          {phaseErrors.length > 0 ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-amber-700">{phaseErrors.length} non-fatal phase error{phaseErrors.length !== 1 ? 's' : ''}:</p>
              <ul className="mt-1 space-y-0.5">
                {phaseErrors.map((e, i) => (
                  <li key={i} className="font-mono text-[11px] text-amber-700">{typeof e === 'string' ? e : JSON.stringify(e)}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            className="mt-4"
          >
            Purge another organization
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function OrgPurgeView() {
  useAdminModuleView('org_purge');

  const [phase, setPhase] = React.useState('prepare');
  const [plan, setPlan] = React.useState(null);
  const [result, setResult] = React.useState(null);

  const handlePrepareSuccess = React.useCallback((data) => {
    setPlan(data);
    setPhase('review');
  }, []);

  const handleProceedToExecute = React.useCallback(() => {
    setPhase('execute');
  }, []);

  const handleExecuteSuccess = React.useCallback((data) => {
    setResult(data);
    setPhase('done');
  }, []);

  const handleReset = React.useCallback(() => {
    setPhase('prepare');
    setPlan(null);
    setResult(null);
  }, []);

  return (
    <ModuleShell
      title="Org Purge"
      subtitle="Operations"
      description="Permanently delete all data for a customer organization. Two-step challenge-response flow with drift checks, advisory locking, and full audit trail."
      banner={
        <div className="flex items-center gap-2 rounded-2xl border border-rose-300 bg-rose-100 px-4 py-3 text-xs font-semibold text-rose-800">
          <Skull className="h-4 w-4 shrink-0" />
          This module performs irreversible data deletion. Every execution is logged in the audit trail.
          Confirm authorization before proceeding.
        </div>
      }
    >
      {phase === 'prepare' && (
        <PrepareStep onSuccess={handlePrepareSuccess} />
      )}
      {phase === 'review' && plan && (
        <ReviewStep
          plan={plan}
          onProceed={handleProceedToExecute}
          onCancel={handleReset}
        />
      )}
      {phase === 'execute' && plan && (
        <ExecuteStep
          plan={plan}
          onSuccess={handleExecuteSuccess}
          onCancel={handleReset}
        />
      )}
      {phase === 'done' && result && (
        <DoneStep result={result} onReset={handleReset} />
      )}
    </ModuleShell>
  );
}
