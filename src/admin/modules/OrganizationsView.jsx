import React from 'react';
import { Ban, RefreshCw, UserCheck, ExternalLink, Trash2 } from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client.js';
import { Button } from '@/components/ui/button';
import ModuleShell from '../ui/ModuleShell.jsx';
import DataTable from '../ui/DataTable.jsx';
import FilterBar from '../ui/FilterBar.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import Drawer from '../ui/Drawer.jsx';
import MetricCard from '../ui/MetricCard.jsx';
import ConfirmActionDialog from '../ui/ConfirmActionDialog.jsx';
import ImpersonateUserDialog from '../impersonation/ImpersonateUserDialog.jsx';
import { useAdminModuleView, captureAdminEvent } from '../lib/admin-analytics.js';

function useOrgDetail(orgId) {
  const [detail, setDetail] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!orgId) { setDetail(null); return; }
    let cancelled = false;
    setLoading(true);
    authenticatedFetch('system-admin-org-detail', { method: 'GET', params: { org_id: orgId } })
      .then((data) => { if (!cancelled) setDetail(data); })
      .catch(() => { if (!cancelled) setDetail(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orgId]);

  return { detail, loading };
}

function useOrgImportCandidates(orgId) {
  const [payload, setPayload] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  const load = React.useCallback(async () => {
    if (!orgId) {
      setPayload(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await authenticatedFetch('system-admin-import-candidates', {
        method: 'GET',
        params: { org_id: orgId },
      });
      setPayload(data);
    } catch (err) {
      setError(err);
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  React.useEffect(() => {
    load();
  }, [load]);

  return {
    payload,
    loading,
    error,
    reload: load,
  };
}

const IMPORT_ENTITY_LABELS = {
  active_student: 'Active student',
  inactive_student: 'Inactive student',
  guardian: 'Guardian',
  guardian_link: 'Guardian link',
  service: 'Service',
  student_note: 'Student note',
};

/**
 * Organizations — canonical customer-facing module. Reads the same
 * system-admin-users-orgs endpoint the legacy aggregate view uses, but
 * presents orgs as the primary entity with a detail drawer, action
 * rail, and impersonation entry point.
 *
 * Destructive actions (suspend, reactivate) are reason-gated via
 * ConfirmActionDialog and enqueued through system-admin-user-org-actions.
 */
export default function OrganizationsView() {
  useAdminModuleView('organizations');

  const [query, setQuery] = React.useState('');
  const [payload, setPayload] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [selected, setSelected] = React.useState(null);

  const [suspendOpen, setSuspendOpen] = React.useState(false);
  const [reactivateOpen, setReactivateOpen] = React.useState(false);
  const [impersonateOpen, setImpersonateOpen] = React.useState(false);
  const [impersonateEmail, setImpersonateEmail] = React.useState('');
  const [cleanupOpen, setCleanupOpen] = React.useState(null); // null | 'selected' | 'all'
  const [selectedCandidateIds, setSelectedCandidateIds] = React.useState(() => new Set());

  const [flash, setFlash] = React.useState(null);
  const { detail: orgDetail, loading: detailLoading } = useOrgDetail(selected?.id ?? null);
  const {
    payload: importCandidatePayload,
    loading: importCandidatesLoading,
    error: importCandidatesError,
    reload: reloadImportCandidates,
  } = useOrgImportCandidates(selected?.id ?? null);
  const importCandidates = React.useMemo(() => (
    Array.isArray(importCandidatePayload?.candidates) ? importCandidatePayload.candidates : []
  ), [importCandidatePayload?.candidates]);

  React.useEffect(() => {
    setSelectedCandidateIds(new Set());
    setCleanupOpen(null);
  }, [selected?.id]);

  const load = React.useCallback(async (search = '') => {
    setLoading(true);
    setError(null);
    try {
      const data = await authenticatedFetch('system-admin-users-orgs', {
        method: 'GET',
        params: search ? { q: search, limit: 100 } : { limit: 100 },
      });
      setPayload(data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(''); }, [load]);

  const organizations = React.useMemo(() => (
    Array.isArray(payload?.organizations) ? payload.organizations : []
  ), [payload?.organizations]);
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return organizations;
    return organizations.filter((o) =>
      (o.name || '').toLowerCase().includes(q) ||
      (o.slug || '').toLowerCase().includes(q) ||
      (o.id || '').toLowerCase().includes(q),
    );
  }, [organizations, query]);

  const totalMemberships = organizations.reduce((sum, o) => sum + Number(o.membership_count || 0), 0);

  const submitOrgAction = React.useCallback(async (actionType, org, { reason, targetEmail }) => {
    const payload = await authenticatedFetch('system-admin-user-org-actions', {
      method: 'POST',
      body: {
        action_type: actionType,
        org_id: org.id,
        reason,
        target_user_email: targetEmail || undefined,
      },
    });
    captureAdminEvent(`org_action_${actionType}`, { has_org_id: Boolean(org.id) });
    setFlash({
      tone: 'success',
      message: `Request queued: ${payload?.request?.request_id || actionType}`,
    });
    setTimeout(() => setFlash(null), 6000);
    return payload;
  }, []);

  const submitCandidateCleanup = React.useCallback(async ({ mode, reason }) => {
    if (!selected?.id) return null;
    const candidateIds = Array.from(selectedCandidateIds);
    const payload = await authenticatedFetch('system-admin-import-candidates', {
      method: 'POST',
      body: {
        org_id: selected.id,
        mode,
        reason,
        candidate_ids: mode === 'selected' ? candidateIds : undefined,
      },
    });
    captureAdminEvent('org_import_candidates_deleted', {
      mode,
      selected_count: candidateIds.length,
      deleted_count: payload?.deleted_count ?? 0,
    });
    setSelectedCandidateIds(new Set());
    await reloadImportCandidates();
    setFlash({
      tone: 'success',
      message: `Deleted ${payload?.deleted_count ?? 0} import candidate${payload?.deleted_count === 1 ? '' : 's'}.`,
    });
    setTimeout(() => setFlash(null), 6000);
    return payload;
  }, [reloadImportCandidates, selected?.id, selectedCandidateIds]);

  const toggleCandidateSelection = React.useCallback((candidateId) => {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(candidateId)) {
        next.delete(candidateId);
      } else {
        next.add(candidateId);
      }
      return next;
    });
  }, []);

  const selectVisibleCandidates = React.useCallback(() => {
    setSelectedCandidateIds(new Set(importCandidates.map((candidate) => candidate.id)));
  }, [importCandidates]);

  const columns = [
    {
      key: 'name',
      header: 'Organization',
      cell: (org) => (
        <div className="flex flex-col">
          <span className="font-medium text-slate-900">{org.name || '—'}</span>
          <span className="font-mono text-[11px] text-slate-500">{org.slug || org.id?.slice(0, 8)}</span>
        </div>
      ),
    },
    {
      key: 'members',
      header: 'Members',
      cell: (org) => (
        <StatusBadge tone={Number(org.membership_count) > 0 ? 'info' : 'neutral'} size="sm">
          {Number(org.membership_count) || 0}
        </StatusBadge>
      ),
    },
    {
      key: 'created',
      header: 'Created',
      cell: (org) => (
        <span className="text-xs text-slate-600">
          {org.created_at ? new Date(org.created_at).toLocaleDateString() : '—'}
        </span>
      ),
    },
    {
      key: 'updated',
      header: 'Updated',
      cell: (org) => (
        <span className="text-xs text-slate-600">
          {org.updated_at ? new Date(org.updated_at).toLocaleDateString() : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (org) => (
        <Button
          size="sm"
          variant="outline"
          onClick={(event) => {
            event.stopPropagation();
            setSelected(org);
          }}
        >
          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
          Open
        </Button>
      ),
    },
  ];

  return (
    <ModuleShell
      title="Organizations"
      subtitle="Customers"
      description="Inspect any organization on the platform, queue reason-gated actions, and launch impersonation with org context. Suspending an org enqueues a review request; nothing is applied synchronously."
    >
      {flash ? (
        <div
          className={
            flash.tone === 'success'
              ? 'rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800'
              : 'rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800'
          }
        >
          {flash.message}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total orgs" value={organizations.length} />
        <MetricCard label="Total memberships" value={totalMemberships} />
        <MetricCard
          label="Avg seats / org"
          value={organizations.length ? Math.round(totalMemberships / organizations.length) : 0}
        />
        <MetricCard
          label="Loaded at"
          value={payload?.requested_at ? new Date(payload.requested_at).toLocaleTimeString() : '—'}
        />
      </div>

      <FilterBar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search by name, slug, or id…"
        onSubmit={() => load(query)}
        onClear={() => { setQuery(''); load(''); }}
      />

      <DataTable
        columns={columns}
        rows={filtered}
        loading={loading}
        error={error}
        onRetry={() => load(query)}
        onRowClick={(row) => setSelected(row)}
        emptyTitle="No organizations match this search"
        emptyDescription="Try a broader query or clear the filter."
      />

      <Drawer
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        title={selected?.name || 'Organization'}
        description={selected?.slug ? `Slug: ${selected.slug}` : selected?.id}
        width="lg"
        footer={
          selected ? (
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setSuspendOpen(true)}
                className="border-amber-300 text-amber-800 hover:bg-amber-50"
              >
                <Ban className="mr-1.5 h-4 w-4" />
                Suspend
              </Button>
              <Button
                variant="outline"
                onClick={() => setReactivateOpen(true)}
                className="border-emerald-300 text-emerald-800 hover:bg-emerald-50"
              >
                <RefreshCw className="mr-1.5 h-4 w-4" />
                Reactivate
              </Button>
              <Button
                onClick={() => setImpersonateOpen(true)}
                className="bg-amber-600 text-white hover:bg-amber-700"
              >
                <UserCheck className="mr-1.5 h-4 w-4" />
                Log in as a user here
              </Button>
            </div>
          ) : null
        }
      >
        {selected ? (
          <div className="space-y-4">
            <section className="grid grid-cols-2 gap-3">
              <InfoCell label="Name" value={selected.name} />
              <InfoCell label="Slug" value={selected.slug} mono />
              <InfoCell label="Members" value={String(selected.membership_count ?? 0)} />
              <InfoCell
                label="Created"
                value={selected.created_at ? new Date(selected.created_at).toLocaleString() : '—'}
              />
              <InfoCell
                label="Updated"
                value={selected.updated_at ? new Date(selected.updated_at).toLocaleString() : '—'}
              />
              <InfoCell label="ID" value={selected.id} mono small />
            </section>

            {/* Members roster */}
            <section>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Members {orgDetail && !detailLoading ? `(${orgDetail.members?.length ?? 0})` : ''}
              </div>
              {detailLoading ? (
                <div className="space-y-1.5">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-8 animate-pulse rounded-md bg-slate-100" />
                  ))}
                </div>
              ) : orgDetail?.members?.length ? (
                <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
                  {orgDetail.members.map((m) => (
                    <div key={m.user_id} className="flex items-center justify-between px-3 py-2">
                      <div className="flex flex-col min-w-0">
                        <span className="truncate text-sm font-medium text-slate-900">
                          {m.full_name || m.email || m.user_id}
                        </span>
                        {m.full_name && m.email ? (
                          <span className="truncate text-xs text-slate-500">{m.email}</span>
                        ) : null}
                      </div>
                      <StatusBadge
                        tone={m.role === 'owner' ? 'accent' : m.role === 'admin' ? 'warning' : 'neutral'}
                        size="sm"
                      >
                        {m.role || 'member'}
                      </StatusBadge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">No members found.</p>
              )}
            </section>

            {/* Recent audit events */}
            <section>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Recent activity
              </div>
              {detailLoading ? (
                <div className="space-y-1.5">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-6 animate-pulse rounded bg-slate-100" />
                  ))}
                </div>
              ) : orgDetail?.recent_audit?.length ? (
                <div className="space-y-1">
                  {orgDetail.recent_audit.map((ev) => (
                    <div key={ev.id} className="flex items-start gap-2 rounded-md bg-slate-50 px-2 py-1.5">
                      <span className="mt-0.5 shrink-0 font-mono text-[10px] text-slate-400 whitespace-nowrap">
                        {ev.created_at ? new Date(ev.created_at).toLocaleString() : '—'}
                      </span>
                      <div className="min-w-0">
                        <span className="font-mono text-[11px] text-slate-800">{ev.event_type}</span>
                        {ev.actor_email ? (
                          <span className="ml-1 text-[10px] text-slate-500">by {ev.actor_email}</span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">No recent activity for this org.</p>
              )}
            </section>

            {/* Import candidate cleanup */}
            <section className="rounded-lg border border-rose-200 bg-rose-50/50 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-rose-700">
                    Import candidates cleanup
                  </div>
                  <p className="mt-1 text-xs leading-5 text-rose-900/75">
                    Removes staged import candidates for this organization only. Live students, guardians, rows, and workspaces are not deleted.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={selectVisibleCandidates}
                    disabled={importCandidates.length === 0}
                  >
                    Select visible
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCleanupOpen('selected')}
                    disabled={selectedCandidateIds.size === 0}
                    className="border-rose-300 text-rose-800 hover:bg-rose-100"
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Remove selected ({selectedCandidateIds.size})
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setCleanupOpen('all')}
                    disabled={(importCandidatePayload?.total ?? 0) === 0}
                    className="bg-rose-600 text-white hover:bg-rose-700"
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Remove all ({importCandidatePayload?.total ?? 0})
                  </Button>
                </div>
              </div>

              {importCandidatesLoading ? (
                <div className="mt-3 space-y-1.5">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-8 animate-pulse rounded-md bg-white/70" />
                  ))}
                </div>
              ) : importCandidatesError ? (
                <div className="mt-3 rounded-md bg-white px-3 py-2 text-xs text-rose-800 ring-1 ring-rose-200">
                  Failed to load import candidates.
                  <button type="button" className="ml-2 underline" onClick={reloadImportCandidates}>
                    Retry
                  </button>
                </div>
              ) : importCandidates.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">No import candidates found for this organization.</p>
              ) : (
                <div className="mt-3 max-h-72 overflow-auto rounded-md border border-rose-100 bg-white">
                  {importCandidatePayload?.total > importCandidates.length ? (
                    <div className="border-b border-rose-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      Showing latest {importCandidates.length} of {importCandidatePayload.total}. “Remove all” deletes every candidate in the organization.
                    </div>
                  ) : null}
                  <div className="divide-y divide-slate-100">
                    {importCandidates.map((candidate) => (
                      <label
                        key={candidate.id}
                        className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-slate-300"
                          checked={selectedCandidateIds.has(candidate.id)}
                          onChange={() => toggleCandidateSelection(candidate.id)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-slate-900">
                              {candidate.display_name}
                            </span>
                            <StatusBadge tone={candidate.status === 'blocked' ? 'danger' : 'neutral'} size="sm">
                              {candidate.status}
                            </StatusBadge>
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                            <span>{IMPORT_ENTITY_LABELS[candidate.entity_type] || candidate.entity_type}</span>
                            <span>{candidate.workspace_name}</span>
                            {candidate.source_reference ? (
                              <span className="font-mono">{candidate.source_reference}:{candidate.row_index ?? '—'}</span>
                            ) : null}
                            {candidate.blocking_issues_count > 0 ? (
                              <span className="text-rose-700">{candidate.blocking_issues_count} blockers</span>
                            ) : null}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>
        ) : null}
      </Drawer>

      <ConfirmActionDialog
        open={suspendOpen}
        onOpenChange={setSuspendOpen}
        severity="warning"
        title={`Suspend ${selected?.name || 'organization'}?`}
        description="This enqueues a suspend request for review. Nothing is applied immediately — the request appears in the operations queue with the reason you provide."
        confirmLabel="Queue suspend"
        requireReason
        reasonLabel="Reason for suspension"
        reasonPlaceholder="e.g. Payment delinquent 60+ days; customer notified on 2026-04-10."
        onConfirm={async ({ reason }) => {
          await submitOrgAction('org_suspend', selected, { reason });
          setSuspendOpen(false);
        }}
      />

      <ConfirmActionDialog
        open={reactivateOpen}
        onOpenChange={setReactivateOpen}
        severity="info"
        title={`Reactivate ${selected?.name || 'organization'}?`}
        description="This enqueues a reactivate request for review. Use this when a previously suspended org is ready to come back online."
        confirmLabel="Queue reactivate"
        requireReason
        reasonLabel="Reason for reactivation"
        reasonPlaceholder="e.g. Payment received; ticket #1234 resolved."
        onConfirm={async ({ reason }) => {
          await submitOrgAction('org_reactivate', selected, { reason });
          setReactivateOpen(false);
        }}
      />

      <ConfirmActionDialog
        open={impersonateOpen && !impersonateEmail}
        onOpenChange={(open) => { if (!open) setImpersonateOpen(false); }}
        severity="warning"
        title={`Log in as a user at ${selected?.name || 'this org'}`}
        description="Enter the email of the user you want to impersonate. You'll be asked for a reason and duration in the next step."
        confirmLabel="Continue"
        extraFields={[
          {
            key: 'email',
            label: 'Target user email',
            placeholder: 'user@example.com',
            required: true,
            type: 'email',
          },
        ]}
        onConfirm={async ({ fields }) => {
          const email = String(fields.email || '').trim();
          if (!email) return;
          setImpersonateEmail(email);
        }}
      />

      <ImpersonateUserDialog
        open={impersonateOpen && Boolean(impersonateEmail)}
        onOpenChange={(open) => {
          if (!open) {
            setImpersonateOpen(false);
            setImpersonateEmail('');
          }
        }}
        targetUser={impersonateEmail ? { email: impersonateEmail } : null}
        targetOrg={selected ? { id: selected.id, name: selected.name } : null}
      />

      <ConfirmActionDialog
        open={cleanupOpen === 'selected'}
        onOpenChange={(open) => { if (!open) setCleanupOpen(null); }}
        severity="destructive"
        title={`Remove ${selectedCandidateIds.size} selected import candidates?`}
        description="This deletes only staged import candidate rows for the selected organization. It does not delete live customer data, import rows, or workspaces."
        confirmLabel="Remove selected"
        requireReason
        reasonLabel="Reason for cleanup"
        reasonPlaceholder="e.g. Stale duplicate candidates from re-parsing the same import workspace."
        onConfirm={async ({ reason }) => {
          await submitCandidateCleanup({ mode: 'selected', reason });
          setCleanupOpen(null);
        }}
      />

      <ConfirmActionDialog
        open={cleanupOpen === 'all'}
        onOpenChange={(open) => { if (!open) setCleanupOpen(null); }}
        severity="destructive"
        title={`Remove all import candidates for ${selected?.name || 'this organization'}?`}
        description="This deletes every staged import candidate in the selected organization, including candidates not visible in the limited preview. Live customer data is not deleted."
        confirmLabel="Remove all candidates"
        requireReason
        reasonLabel="Reason for cleanup"
        reasonPlaceholder="e.g. Resetting stale import candidate state before rerunning onboarding import."
        requireTypedConfirm={selected?.slug || selected?.name || selected?.id || 'REMOVE'}
        onConfirm={async ({ reason }) => {
          await submitCandidateCleanup({ mode: 'all', reason });
          setCleanupOpen(null);
        }}
      />
    </ModuleShell>
  );
}

function InfoCell({ label, value, mono = false, small = false }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div
        className={
          'mt-1 break-words text-slate-900 ' +
          (mono ? 'font-mono ' : '') +
          (small ? 'text-[11px]' : 'text-sm')
        }
      >
        {value || '—'}
      </div>
    </div>
  );
}
