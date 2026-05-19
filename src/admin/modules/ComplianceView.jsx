import React from 'react';
import { ShieldCheck, Plus, ExternalLink, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import ModuleShell from '../ui/ModuleShell.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import MetricCard from '../ui/MetricCard.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import Drawer from '../ui/Drawer.jsx';
import ConfirmActionDialog from '../ui/ConfirmActionDialog.jsx';
import { useAdminModuleView, captureAdminEvent } from '../lib/admin-analytics.js';
import { useAdminStore } from '../lib/useAdminStore.js';

/**
 * Compliance Requests — intake tracker for DSAR / data access / deletion asks.
 *
 * Requests land here (for now) via manual entry; the medium-term plan is to
 * wire a PostHog Survey to auto-create rows. SLAs are derived from request
 * type so admins can see what's hot.
 *
 * Persisted in localStorage until a real compliance_requests schema lands.
 */


const TYPE_META = {
  access: { label: 'Data access', sla_days: 30, tone: 'info' },
  deletion: { label: 'Deletion / right to be forgotten', sla_days: 30, tone: 'danger' },
  export: { label: 'Data export (portability)', sla_days: 30, tone: 'info' },
  rectification: { label: 'Rectification', sla_days: 30, tone: 'warning' },
  objection: { label: 'Objection to processing', sla_days: 30, tone: 'warning' },
};

const STATUS_TONE = {
  new: 'warning',
  in_progress: 'info',
  awaiting_customer: 'accent',
  closed: 'success',
};


function daysUntil(iso) {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export default function ComplianceView() {
  useAdminModuleView('compliance');

  const { items, upsert } = useAdminStore('compliance');
  const [openDraft, setOpenDraft] = React.useState(false);
  const [selected, setSelected] = React.useState(null);
  const [closeOpen, setCloseOpen] = React.useState(false);

  const create = (draft) => {
    const meta = TYPE_META[draft.request_type] || { sla_days: 30 };
    const deadline = new Date(Date.now() + meta.sla_days * 24 * 60 * 60 * 1000).toISOString();
    upsert({
      id: `req-${Date.now().toString(36)}`,
      request_type: draft.request_type,
      subject_email: draft.subject_email,
      subject_org: draft.subject_org,
      source: draft.source,
      summary: draft.summary,
      status: 'new',
      created_at: new Date().toISOString(),
      deadline_at: deadline,
      closed_at: null,
      closure_notes: '',
    });
    captureAdminEvent('compliance_request_created', { type: draft.request_type });
  };

  const advance = (id, status) => {
    const req = items.find((r) => r.id === id);
    if (!req) return;
    const updated = { ...req, status };
    upsert(updated);
    setSelected((prev) => prev?.id === id ? updated : prev);
  };

  const close = (id, notes) => {
    const req = items.find((r) => r.id === id);
    if (!req) return;
    upsert({ ...req, status: 'closed', closed_at: new Date().toISOString(), closure_notes: notes });
  };

  const open = items.filter((r) => r.status !== 'closed');
  const overdue = open.filter((r) => {
    const days = daysUntil(r.deadline_at);
    return days !== null && days < 0;
  }).length;
  const dueSoon = open.filter((r) => {
    const days = daysUntil(r.deadline_at);
    return days !== null && days >= 0 && days <= 7;
  }).length;

  return (
    <ModuleShell
      title="Compliance Requests"
      subtitle="Insights"
      description="Track DSARs and other data-subject requests against their regulatory SLA. Intake is manual for now; wiring a PostHog Survey as an auto-intake source is planned."
      actions={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" asChild>
            <a
              href="https://posthog.com/docs/surveys"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="mr-1.5 h-4 w-4" />
              PostHog Surveys docs
            </a>
          </Button>
          <Button size="sm" onClick={() => setOpenDraft(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New request
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Open" value={open.length} />
        <MetricCard label="Overdue" value={overdue} />
        <MetricCard label="Due ≤7 days" value={dueSoon} />
        <MetricCard label="Closed" value={items.length - open.length} />
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-6 w-6" />}
          title="No compliance requests yet"
          description="Log the first request to start the SLA clock. For DSARs, attach the proof-of-identity separately — do not paste PII into the summary."
          action={<Button size="sm" onClick={() => setOpenDraft(true)}><Plus className="mr-1.5 h-4 w-4" />New request</Button>}
        />
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {items.map((r) => {
            const typeMeta = TYPE_META[r.request_type] || { label: r.request_type, tone: 'neutral' };
            const days = daysUntil(r.deadline_at);
            const daysTone = days === null
              ? 'neutral'
              : r.status === 'closed' ? 'success'
                : days < 0 ? 'danger'
                  : days <= 7 ? 'warning'
                    : 'info';
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(r)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
              >
                <StatusBadge tone={STATUS_TONE[r.status] || 'neutral'} size="sm" dot>
                  {r.status.replace('_', ' ')}
                </StatusBadge>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">
                    {typeMeta.label} · {r.subject_email || 'no subject'}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {r.subject_org || 'no org attached'} · logged {new Date(r.created_at).toLocaleDateString()}
                  </div>
                </div>
                <StatusBadge tone={daysTone} size="sm">
                  <Clock className="h-3 w-3" />
                  {r.status === 'closed'
                    ? 'closed'
                    : days === null
                      ? 'no deadline'
                      : days < 0 ? `${Math.abs(days)}d overdue`
                        : `${days}d left`}
                </StatusBadge>
              </button>
            );
          })}
        </div>
      )}

      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
        <h3 className="text-sm font-semibold text-slate-900">Evidence gathering</h3>
        <p className="mt-1">
          When a data-access request lands, pull the evidence bundle from adjacent
          modules — the Audit Log supports per-user CSV export, and Users surfaces
          sessions &amp; MFA factors.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link to="/system-admin/audit-log">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Audit Log
            </Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/system-admin/users">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Users
            </Link>
          </Button>
        </div>
      </div>

      <ComplianceDraftDialog
        open={openDraft}
        onOpenChange={setOpenDraft}
        onSubmit={(draft) => { create(draft); setOpenDraft(false); }}
      />

      <Drawer
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        title={selected ? (TYPE_META[selected.request_type]?.label || selected.request_type) : 'Request'}
        description={selected?.subject_email || null}
        width="lg"
        footer={
          selected && selected.status !== 'closed' ? (
            <div className="flex w-full items-center justify-between">
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => advance(selected.id, 'in_progress')}>
                  Mark in progress
                </Button>
                <Button size="sm" variant="outline" onClick={() => advance(selected.id, 'awaiting_customer')}>
                  Awaiting customer
                </Button>
              </div>
              <Button
                size="sm"
                onClick={() => setCloseOpen(true)}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Close request
              </Button>
            </div>
          ) : null
        }
      >
        {selected ? (
          <div className="space-y-4">
            <section className="grid grid-cols-2 gap-3">
              <Info label="Status" value={selected.status.replace('_', ' ')} />
              <Info label="Type" value={TYPE_META[selected.request_type]?.label || selected.request_type} />
              <Info label="Subject email" value={selected.subject_email || '—'} />
              <Info label="Subject org" value={selected.subject_org || '—'} />
              <Info label="Source" value={selected.source || '—'} />
              <Info label="Logged" value={new Date(selected.created_at).toLocaleString()} />
              <Info
                label="Deadline"
                value={selected.deadline_at ? new Date(selected.deadline_at).toLocaleDateString() : '—'}
              />
              {selected.closed_at ? (
                <Info label="Closed" value={new Date(selected.closed_at).toLocaleString()} />
              ) : null}
            </section>
            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Summary</h4>
              <p className="whitespace-pre-wrap text-sm text-slate-700">
                {selected.summary || '—'}
              </p>
            </section>
            {selected.closure_notes ? (
              <section>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Closure notes</h4>
                <p className="whitespace-pre-wrap rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
                  {selected.closure_notes}
                </p>
              </section>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <ConfirmActionDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        severity="info"
        title="Close compliance request?"
        description="Record a short note describing the resolution — this becomes the closure evidence for the audit bundle."
        confirmLabel="Close request"
        requireReason
        reasonLabel="Closure notes"
        reasonPlaceholder="Data bundle delivered on 2026-04-20, ticket #123."
        onConfirm={async ({ reason }) => {
          if (!selected) return;
          close(selected.id, reason);
          setCloseOpen(false);
          setSelected(null);
        }}
      />
    </ModuleShell>
  );
}

function ComplianceDraftDialog({ open, onOpenChange, onSubmit }) {
  const [form, setForm] = React.useState({
    request_type: 'access',
    subject_email: '',
    subject_org: '',
    source: 'email',
    summary: '',
  });

  React.useEffect(() => {
    if (!open) setForm({ request_type: 'access', subject_email: '', subject_org: '', source: 'email', summary: '' });
  }, [open]);

  const valid = form.subject_email.trim().length > 3;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-slate-900">Log a compliance request</h3>
        <p className="mt-1 text-xs text-slate-500">
          Do not paste PII here — keep the summary factual. Attach evidence via the audit-bundle workflow.
        </p>
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-slate-500">Type</Label>
              <select
                value={form.request_type}
                onChange={(e) => setForm({ ...form, request_type: e.target.value })}
                className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
              >
                {Object.entries(TYPE_META).map(([key, meta]) => (
                  <option key={key} value={key}>{meta.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs text-slate-500">Source</Label>
              <select
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
              >
                <option value="email">Email</option>
                <option value="support_ticket">Support ticket</option>
                <option value="posthog_survey">PostHog Survey</option>
                <option value="legal_team">Legal team</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div>
            <Label className="text-xs text-slate-500">Subject email</Label>
            <Input
              type="email"
              value={form.subject_email}
              onChange={(e) => setForm({ ...form, subject_email: e.target.value })}
              placeholder="user@example.com"
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-xs text-slate-500">Subject org (optional)</Label>
            <Input
              value={form.subject_org}
              onChange={(e) => setForm({ ...form, subject_org: e.target.value })}
              placeholder="Acme Inc."
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-xs text-slate-500">Summary</Label>
            <Textarea
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              placeholder="What was requested, any jurisdictional context, and where the intake lives…"
              rows={3}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!valid} onClick={() => onSubmit(form)}>Log request</Button>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-900">{value || '—'}</div>
    </div>
  );
}
