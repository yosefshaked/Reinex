import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, Plus, User2, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import ModuleShell from '../ui/ModuleShell.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import MetricCard from '../ui/MetricCard.jsx';
import Drawer from '../ui/Drawer.jsx';
import ConfirmActionDialog from '../ui/ConfirmActionDialog.jsx';
import { useAdminModuleView, captureAdminEvent } from '../lib/admin-analytics.js';
import { useAdminStore } from '../lib/useAdminStore.js';


const SEVERITY_TONE = {
  sev1: 'danger',
  sev2: 'warning',
  sev3: 'info',
  sev4: 'neutral',
};

const SEVERITY_LABEL = {
  sev1: 'Sev 1 · Customer-facing outage',
  sev2: 'Sev 2 · Major degradation',
  sev3: 'Sev 3 · Minor degradation',
  sev4: 'Sev 4 · Internal / informational',
};

export default function IncidentsView() {
  useAdminModuleView('incidents');

  const { items, upsert, remove: removeItem } = useAdminStore('incidents');
  const [openDraft, setOpenDraft] = React.useState(false);
  const [selected, setSelected] = React.useState(null);
  const [resolveOpen, setResolveOpen] = React.useState(false);

  const active = items.filter((i) => i.status !== 'resolved');
  const resolved = items.filter((i) => i.status === 'resolved');

  const sev1Count = active.filter((i) => i.severity === 'sev1').length;
  const withoutOwner = active.filter((i) => !i.owner).length;

  const createIncident = (draft) => {
    const record = {
      id: `inc-${Date.now().toString(36)}`,
      title: draft.title,
      severity: draft.severity,
      owner: draft.owner,
      customer_impact: draft.customer_impact,
      summary: draft.summary,
      status: 'active',
      created_at: new Date().toISOString(),
      resolved_at: null,
      resolution_notes: '',
    };
    upsert(record);
    captureAdminEvent('incident_opened', { severity: draft.severity });
  };

  const resolveIncident = (id, notes) => {
    const incident = items.find((i) => i.id === id);
    if (!incident) return;
    upsert({ ...incident, status: 'resolved', resolved_at: new Date().toISOString(), resolution_notes: notes });
    captureAdminEvent('incident_resolved', { id });
  };

  return (
    <ModuleShell
      title="Incidents"
      subtitle="Operations"
      description="Track in-flight production incidents. Stored locally until the dedicated incidents schema lands — open a parking-lot idea if you want to prioritise that."
      actions={
        <Button size="sm" onClick={() => setOpenDraft(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          New incident
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Active" value={active.length} />
        <MetricCard label="Sev 1 open" value={sev1Count} />
        <MetricCard label="Unassigned" value={withoutOwner} />
        <MetricCard label="Resolved" value={resolved.length} />
      </div>

      <IncidentList
        heading="Active incidents"
        items={active}
        emptyTitle="No active incidents"
        emptyDescription="If you are handling something customer-facing, open it here so other admins have context."
        onSelect={setSelected}
      />

      {resolved.length > 0 ? (
        <IncidentList
          heading="Recently resolved"
          items={resolved.slice(0, 10)}
          onSelect={setSelected}
        />
      ) : null}

      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Timeline &amp; post-mortem</h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          Incidents draw their timeline from the audit log. Filter by the affected
          org, actor, or the <code className="font-mono">admin_control</code> category to
          reconstruct what happened.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/system-admin/audit-log">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Open Audit Log
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/system-admin/system-health">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              System Health
            </Link>
          </Button>
        </div>
      </div>

      <IncidentDraftDialog
        open={openDraft}
        onOpenChange={setOpenDraft}
        onSubmit={(draft) => { createIncident(draft); setOpenDraft(false); }}
      />

      <Drawer
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        title={selected?.title || 'Incident'}
        description={selected ? SEVERITY_LABEL[selected.severity] : null}
        width="lg"
        badge={
          selected ? (
            <StatusBadge
              tone={selected.status === 'resolved' ? 'success' : SEVERITY_TONE[selected.severity] || 'warning'}
              size="sm"
              dot
            >
              {selected.status === 'resolved' ? 'resolved' : selected.severity}
            </StatusBadge>
          ) : null
        }
        footer={
          selected && selected.status !== 'resolved' ? (
            <div className="flex w-full justify-end">
              <Button
                size="sm"
                onClick={() => setResolveOpen(true)}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
                Mark resolved
              </Button>
            </div>
          ) : null
        }
      >
        {selected ? (
          <div className="space-y-4">
            <section className="grid grid-cols-2 gap-3">
              <Field label="Owner" value={selected.owner || 'unassigned'} />
              <Field label="Opened" value={new Date(selected.created_at).toLocaleString()} />
              <Field label="Customer impact" value={selected.customer_impact || '—'} />
              {selected.resolved_at ? (
                <Field label="Resolved" value={new Date(selected.resolved_at).toLocaleString()} />
              ) : null}
            </section>
            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Summary</h4>
              <p className="whitespace-pre-wrap text-sm text-slate-700">
                {selected.summary || '—'}
              </p>
            </section>
            {selected.resolution_notes ? (
              <section>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Resolution notes</h4>
                <p className="whitespace-pre-wrap rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
                  {selected.resolution_notes}
                </p>
              </section>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <ConfirmActionDialog
        open={resolveOpen}
        onOpenChange={setResolveOpen}
        severity="info"
        title={`Resolve ${selected?.title || 'incident'}?`}
        description="Capture what fixed it — this becomes the seed of the post-mortem. Resolution notes are permanent."
        confirmLabel="Mark resolved"
        requireReason
        reasonLabel="Resolution notes"
        reasonPlaceholder="Root cause, mitigation, follow-up actions…"
        onConfirm={async ({ reason }) => {
          if (!selected) return;
          resolveIncident(selected.id, reason);
          setResolveOpen(false);
          setSelected(null);
        }}
      />
    </ModuleShell>
  );
}

function IncidentList({ heading, items, emptyTitle = null, emptyDescription = null, onSelect }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-slate-900">{heading}</h3>
      {items.length === 0 ? (
        emptyTitle ? (
          <EmptyState
            icon={<AlertTriangle className="h-6 w-6" />}
            title={emptyTitle}
            description={emptyDescription}
          />
        ) : null
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {items.map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => onSelect(i)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
            >
              <StatusBadge
                tone={i.status === 'resolved' ? 'success' : SEVERITY_TONE[i.severity] || 'warning'}
                size="sm"
                dot
              >
                {i.status === 'resolved' ? 'resolved' : i.severity}
              </StatusBadge>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-900">{i.title}</div>
                <div className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <User2 className="h-3 w-3" />
                    {i.owner || 'unassigned'}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(i.resolved_at || i.created_at).toLocaleString()}
                  </span>
                </div>
              </div>
              {i.customer_impact ? (
                <span className="hidden text-[11px] text-slate-500 md:inline">
                  Impact: {i.customer_impact}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function IncidentDraftDialog({ open, onOpenChange, onSubmit }) {
  const [form, setForm] = React.useState({
    title: '',
    severity: 'sev3',
    owner: '',
    customer_impact: '',
    summary: '',
  });

  React.useEffect(() => {
    if (!open) setForm({ title: '', severity: 'sev3', owner: '', customer_impact: '', summary: '' });
  }, [open]);

  const valid = form.title.trim().length > 3 && form.severity;

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
        <h3 className="text-base font-semibold text-slate-900">Open a new incident</h3>
        <p className="mt-1 text-xs text-slate-500">Keep it short — you can always add context after.</p>
        <div className="mt-4 space-y-3">
          <div>
            <Label className="text-xs text-slate-500">Title</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Logins failing for org acme"
              className="h-9"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-slate-500">Severity</Label>
              <select
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value })}
                className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
              >
                <option value="sev1">Sev 1 · Outage</option>
                <option value="sev2">Sev 2 · Major</option>
                <option value="sev3">Sev 3 · Minor</option>
                <option value="sev4">Sev 4 · Info</option>
              </select>
            </div>
            <div>
              <Label className="text-xs text-slate-500">Owner</Label>
              <Input
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
                placeholder="name@reinex.com"
                className="h-9"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs text-slate-500">Customer impact</Label>
            <Input
              value={form.customer_impact}
              onChange={(e) => setForm({ ...form, customer_impact: e.target.value })}
              placeholder="Scope — single org, region, or platform-wide"
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-xs text-slate-500">Summary</Label>
            <Textarea
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              placeholder="What's happening, what you've tried, and where to find the signal…"
              rows={4}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!valid} onClick={() => onSubmit(form)}>Open incident</Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-900">{value || '—'}</div>
    </div>
  );
}
