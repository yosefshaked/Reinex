import React from 'react';
import { Eye, Play, Square } from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import StatusBadge from '../ui/StatusBadge.jsx';

const PAGE_SIZE = 25;
const SCOPES = [
  { value: 'hmo_claim_unresolved', label: 'Lessons still flagged hmo_claim_unresolved' },
  { value: 'open_reasons', label: 'Every open lesson with stored open reasons' },
];
const STATUS_TONES = { would_change: 'warning', changed: 'success', error: 'danger', missing: 'danger' };

function shortId(value) {
  const text = String(value || '');
  return text ? `…${text.slice(-8)}` : '—';
}

function reasonsText(reasons) {
  if (!Array.isArray(reasons)) return '—';
  return reasons.length ? reasons.join(', ') : 'nothing open';
}

function countItems(items) {
  const count = (status) => items.filter((item) => item.status === status).length;
  return {
    would_change: count('would_change'),
    changed: count('changed'),
    unchanged: count('unchanged'),
    closes: items.filter((item) => item.closes).length,
    failed: count('error') + count('missing'),
  };
}

/**
 * Admin Tools → lesson closure re-sync. Re-evaluates stored lesson closure state with the current
 * rules (POST system-admin-admin-tools, tool=lesson_closure_resync), one page per request.
 * Preview never writes; Apply is only offered after a preview of the same scope.
 */
export default function LessonClosureResyncTool() {
  const [form, setForm] = React.useState({ org_id: '', scope: 'hmo_claim_unresolved' });
  const [running, setRunning] = React.useState(null);
  const [items, setItems] = React.useState([]);
  const [scanned, setScanned] = React.useState(0);
  const [lastRun, setLastRun] = React.useState(null);
  const [error, setError] = React.useState('');
  const [showUnchanged, setShowUnchanged] = React.useState(false);
  const stopRef = React.useRef(false);

  const totals = React.useMemo(() => countItems(items), [items]);
  const orgId = form.org_id.trim();
  const previewMatchesForm = lastRun?.mode === 'preview'
    && !lastRun.stopped
    && lastRun.scope === form.scope
    && lastRun.orgId === orgId;
  const canApply = !running && previewMatchesForm && lastRun.wouldChange > 0;

  const updateField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const run = async (mode) => {
    if (mode === 'apply') {
      const target = orgId ? 'this organization' : 'ALL organizations';
      const confirmed = window.confirm(
        `Apply the closure re-sync to ${target}?\n\n`
        + `Each changed lesson gets a new version, so anyone who has one of those lessons open will see a "lesson changed" prompt. Prefer running this outside working hours.`,
      );
      if (!confirmed) return;
    }

    stopRef.current = false;
    setRunning(mode);
    setError('');
    setItems([]);
    setScanned(0);
    setLastRun(null);

    const collected = [];
    let scannedTotal = 0;
    let cursor = null;
    let auditMissed = false;
    try {
      do {
        const page = await authenticatedFetch('system-admin-admin-tools', {
          method: 'POST',
          body: {
            tool: 'lesson_closure_resync',
            mode,
            scope: form.scope,
            org_id: orgId || undefined,
            cursor: cursor || undefined,
            limit: PAGE_SIZE,
          },
        });
        collected.push(...(Array.isArray(page?.items) ? page.items : []));
        scannedTotal += Number(page?.scanned) || 0;
        setItems([...collected]);
        setScanned(scannedTotal);
        if (page?.audit_logged === false) auditMissed = true;
        cursor = page?.next_cursor || null;
      } while (cursor && !stopRef.current);

      setLastRun({
        mode,
        scope: form.scope,
        orgId,
        stopped: stopRef.current,
        wouldChange: countItems(collected).would_change,
        auditMissed,
      });
    } catch (requestError) {
      setError(requestError?.message || 'The re-sync request failed.');
    } finally {
      setRunning(null);
    }
  };

  const visibleItems = showUnchanged ? items : items.filter((item) => item.status !== 'unchanged');

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="text-sm font-semibold text-slate-900">Lesson closure re-sync</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Stored lesson closure state is only recalculated when a lesson is written to, so rule fixes leave older lessons
            stale (for example the HMO fix: lessons without HMO coverage that kept "hmo_claim_unresolved"). Preview shows what would
            change without writing. Apply writes only the lessons that change and records each run in the audit log.
          </p>
        </div>
        {lastRun ? (
          <StatusBadge tone={lastRun.stopped ? 'warning' : 'success'} size="sm">
            {lastRun.mode} {lastRun.stopped ? 'stopped' : 'complete'}
          </StatusBadge>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-xs text-slate-500">Organization ID (leave empty for all organizations)</Label>
          <Input
            value={form.org_id}
            onChange={(event) => updateField('org_id', event.target.value)}
            placeholder="All organizations"
            disabled={Boolean(running)}
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-xs text-slate-500">Scope</legend>
          {SCOPES.map((scope) => (
            <label key={scope.value} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="lesson-closure-resync-scope"
                value={scope.value}
                checked={form.scope === scope.value}
                onChange={() => updateField('scope', scope.value)}
                disabled={Boolean(running)}
              />
              {scope.label}
            </label>
          ))}
        </fieldset>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => void run('preview')} disabled={Boolean(running)}>
          <Eye className="mr-2 h-4 w-4" />
          {running === 'preview' ? 'Previewing…' : 'Preview'}
        </Button>
        <Button onClick={() => void run('apply')} disabled={!canApply}>
          <Play className="mr-2 h-4 w-4" />
          {running === 'apply' ? 'Applying…' : `Apply${previewMatchesForm ? ` to ${lastRun.wouldChange} lesson(s)` : ''}`}
        </Button>
        {running ? (
          <Button variant="ghost" onClick={() => { stopRef.current = true; }}>
            <Square className="mr-2 h-4 w-4" /> Stop after this page
          </Button>
        ) : null}
        <p className="text-xs text-slate-500">
          {previewMatchesForm || running ? null : 'Run a preview of this scope first; Apply unlocks when it finds lessons to change.'}
        </p>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      ) : null}
      {lastRun?.auditMissed ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          The changes were applied, but at least one page could not be written to the audit log. Check Error Events.
        </div>
      ) : null}

      {running || items.length || lastRun ? (
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
          <span>Scanned: <b className="text-slate-900">{scanned}</b></span>
          <span>Would change: <b className="text-slate-900">{totals.would_change}</b></span>
          <span>Changed: <b className="text-slate-900">{totals.changed}</b></span>
          <span>Unchanged: <b className="text-slate-900">{totals.unchanged}</b></span>
          <span>Will close / closed: <b className="text-slate-900">{totals.closes}</b></span>
          <span>Failed: <b className={totals.failed ? 'text-rose-700' : 'text-slate-900'}>{totals.failed}</b></span>
        </div>
      ) : null}

      {items.length ? (
        <div className="mt-4">
          <label className="mb-2 flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={showUnchanged} onChange={(event) => setShowUnchanged(event.target.checked)} />
            Show unchanged lessons
          </label>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Lesson</th>
                  <th className="px-3 py-2 font-semibold">Org</th>
                  <th className="px-3 py-2 font-semibold">Stored reasons</th>
                  <th className="px-3 py-2 font-semibold">Re-evaluated</th>
                  <th className="px-3 py-2 font-semibold">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleItems.map((item) => (
                  <tr key={item.lesson_instance_id}>
                    <td className="px-3 py-2 font-mono" title={item.lesson_instance_id}>{shortId(item.lesson_instance_id)}</td>
                    <td className="px-3 py-2 font-mono" title={item.org_id || ''}>{shortId(item.org_id)}</td>
                    <td className="px-3 py-2 font-mono text-slate-600">{reasonsText(item.before_reasons)}</td>
                    <td className="px-3 py-2 font-mono text-slate-900">{reasonsText(item.after_reasons)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {STATUS_TONES[item.status]
                          ? <StatusBadge tone={STATUS_TONES[item.status]} size="sm">{item.status.replace('_', ' ')}</StatusBadge>
                          : <span className="text-slate-500">{item.status}</span>}
                        {item.closes ? <StatusBadge tone="success" size="sm">closes</StatusBadge> : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {visibleItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-slate-500">Nothing to change in the lessons scanned so far.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
