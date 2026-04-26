import React from 'react';
import { Search, ShieldAlert, ShieldCheck, AlertTriangle } from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import ModuleShell from '../ui/ModuleShell.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import { useAdminModuleView } from '../lib/admin-analytics.js';

function JsonBlock({ value }) {
  let text = 'null';
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return (
    <pre className="max-h-96 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-5 text-slate-800">
      {text}
    </pre>
  );
}

function CheckRow({ check }) {
  const status = String(check?.status || 'neutral').toLowerCase();
  const tone = status === 'ok' ? 'success' : status === 'warning' ? 'warning' : 'danger';
  const Icon = status === 'ok' ? ShieldCheck : status === 'warning' ? AlertTriangle : ShieldAlert;

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-slate-700" />
            <h3 className="text-sm font-semibold text-slate-900">{check?.title || check?.name || 'Check'}</h3>
          </div>
          {check?.name ? (
            <p className="mt-1 font-mono text-[11px] text-slate-500">{check.name}</p>
          ) : null}
        </div>
        <StatusBadge tone={tone} size="sm">{status}</StatusBadge>
      </div>
      {check?.details ? (
        <div className="mt-3">
          <JsonBlock value={check.details} />
        </div>
      ) : null}
    </article>
  );
}

function SummaryBanner({ summary }) {
  const ready = Boolean(summary?.claim_ready);
  return (
    <div className={`rounded-2xl border px-4 py-4 shadow-sm ${
      ready
        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
        : 'border-amber-200 bg-amber-50 text-amber-900'
    }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">
            {ready ? 'Claim is currently ready.' : 'Claim is not currently ready.'}
          </p>
          <p className="mt-1 font-mono text-xs">
            Primary reason: {summary?.primary_reason || 'unknown'}
          </p>
        </div>
        <StatusBadge tone={ready ? 'success' : 'warning'}>
          {ready ? 'ready' : 'blocked'}
        </StatusBadge>
      </div>
    </div>
  );
}

export default function AdminToolsView() {
  useAdminModuleView('admin_tools');

  const [form, setForm] = React.useState({
    org_id: '',
    lesson_participant_id: '',
    hmo_provider_id: '',
    claim_ids: '',
  });
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [payload, setPayload] = React.useState(null);

  const updateField = React.useCallback((key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const runInspection = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authenticatedFetch('system-admin-admin-tools', {
        method: 'GET',
        params: {
          tool: 'hmo_claim_readiness',
          org_id: form.org_id,
          lesson_participant_id: form.lesson_participant_id || undefined,
          hmo_provider_id: form.hmo_provider_id || undefined,
          claim_ids: form.claim_ids || undefined,
        },
      });
      setPayload(data);
    } catch (requestError) {
      setError(requestError?.message || 'Failed to run admin tool.');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [form]);

  const checkedAt = payload?.checked_at
    ? new Date(payload.checked_at).toLocaleString()
    : '';
  const checks = Array.isArray(payload?.checks) ? payload.checks : [];

  return (
    <ModuleShell
      title="Admin Tools"
      subtitle="Operations"
      description="Focused system-admin diagnostics for finance and workflow issues. The first tool inspects HMO claim readiness using the same ledger service and batch validations the product flow uses."
      actions={checkedAt ? <span className="text-xs text-slate-500">Last checked: {checkedAt}</span> : null}
    >
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs text-slate-500">Organization ID</Label>
            <Input
              value={form.org_id}
              onChange={(event) => updateField('org_id', event.target.value)}
              placeholder="cee23c01-876d-425b-8d72-91536a75e93a"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-slate-500">Lesson Participant ID</Label>
            <Input
              value={form.lesson_participant_id}
              onChange={(event) => updateField('lesson_participant_id', event.target.value)}
              placeholder="Optional but recommended for full lifecycle checks"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-slate-500">HMO Provider ID</Label>
            <Input
              value={form.hmo_provider_id}
              onChange={(event) => updateField('hmo_provider_id', event.target.value)}
              placeholder="Use when checking a specific batch request"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-slate-500">Claim IDs</Label>
            <Textarea
              value={form.claim_ids}
              onChange={(event) => updateField('claim_ids', event.target.value)}
              rows={4}
              placeholder="Paste one or more ledger transaction ids or legacy dashboard task ids, separated by comma, space, or line break"
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={runInspection} disabled={loading}>
            <Search className="mr-2 h-4 w-4" />
            {loading ? 'Running…' : 'Run HMO Claim Readiness Check'}
          </Button>
          <p className="text-xs text-slate-500">
            Minimal input: org + participant. Add provider and claim ids when you want to validate a specific batch request.
          </p>
        </div>
        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </section>

      {payload?.summary ? <SummaryBanner summary={payload.summary} /> : null}

      {checks.length > 0 ? (
        <section className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Checks</div>
          <div className="grid gap-3 xl:grid-cols-2">
            {checks.map((check) => (
              <CheckRow key={`${check.name}-${check.status}`} check={check} />
            ))}
          </div>
        </section>
      ) : null}

      {payload ? (
        <section className="grid gap-4 xl:grid-cols-2">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Participant Context</h3>
            <div className="mt-3">
              <JsonBlock value={payload.participant} />
            </div>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Coverage Decision</h3>
            <div className="mt-3">
              <JsonBlock value={payload.coverage_decision} />
            </div>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Desired Billing Result</h3>
            <div className="mt-3">
              <JsonBlock value={payload.desired_result} />
            </div>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Provider + Ledger Account</h3>
            <div className="mt-3">
              <JsonBlock value={payload.hmo_provider} />
            </div>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Ledger State</h3>
            <div className="mt-3">
              <JsonBlock value={payload.ledger} />
            </div>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Workflow State</h3>
            <div className="mt-3">
              <JsonBlock value={payload.workflow} />
            </div>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
            <h3 className="text-sm font-semibold text-slate-900">Claim Request Resolution</h3>
            <div className="mt-3">
              <JsonBlock value={payload.claim_request} />
            </div>
          </article>
        </section>
      ) : null}
    </ModuleShell>
  );
}
