import React from 'react';
import { Mail, Search, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ModuleShell from '../ui/ModuleShell.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import MetricCard from '../ui/MetricCard.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import Drawer from '../ui/Drawer.jsx';
import { useAdminModuleView } from '../lib/admin-analytics.js';

/**
 * Email Log — read-only view of every outbound Brevo email + Supabase
 * auth emails sent by the platform.
 *
 * Backed by the email_log table (service-role only). Supports filtering
 * by email type, delivery status, and recipient search.
 */

const PAGE_SIZE = 50;

const TYPE_LABEL = {
  invitation_existing_user: 'Invitation (existing user)',
  invitation_auth_invite: 'Invitation (new user)',
  password_reset: 'Password reset',
  form_submission: 'Form submission OTP',
  waiting_list: 'Waiting list invite',
};

const TYPE_TONE = {
  invitation_existing_user: 'info',
  invitation_auth_invite: 'info',
  password_reset: 'warning',
  form_submission: 'accent',
  waiting_list: 'accent',
};

function useEmailLog({ emailType, status, search, offset }) {
  const [state, setState] = React.useState({ loading: true, emails: [], total: 0, error: null });

  React.useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    const params = { limit: PAGE_SIZE, offset };
    if (emailType) params.email_type = emailType;
    if (status) params.status = status;
    if (search) params.search = search;

    authenticatedFetch('system-admin-email-log', { method: 'GET', params })
      .then((data) => {
        if (cancelled) return;
        if (data?.message === 'table_not_found') {
          setState({ loading: false, emails: [], total: 0, error: 'table_not_found' });
          return;
        }
        setState({
          loading: false,
          emails: Array.isArray(data?.emails) ? data.emails : [],
          total: data?.total ?? 0,
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ loading: false, emails: [], total: 0, error: err?.message || 'fetch_failed' });
      });

    return () => { cancelled = true; };
  }, [emailType, status, search, offset]);

  return state;
}

export default function EmailLogView() {
  useAdminModuleView('email-log');

  const [emailType, setEmailType] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [offset, setOffset] = React.useState(0);
  const [selected, setSelected] = React.useState(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  // Debounce search
  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setOffset(0);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  // Reset offset when filters change
  React.useEffect(() => { setOffset(0); }, [emailType, status]);

  const { loading, emails, total, error } = useEmailLog({
    emailType,
    status,
    search: debouncedSearch,
    offset,
    _refreshKey: refreshKey,
  });

  const sentCount = emails.filter((e) => e.status === 'sent').length;
  const failedCount = emails.filter((e) => e.status === 'failed').length;

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <ModuleShell
      title="Email Log"
      subtitle="Communications"
      description="Every outbound email sent by the platform — invitations, password resets, form OTPs, and waiting-list links. Written at send time; failed attempts are recorded too."
      actions={
        <Button size="sm" variant="outline" onClick={() => setRefreshKey((k) => k + 1)}>
          <RefreshCw className="mr-1.5 h-4 w-4" />
          Refresh
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Total (page)" value={emails.length} />
        <MetricCard label="Sent" value={sentCount} />
        <MetricCard label="Failed" value={failedCount} />
        <MetricCard label="Total matching" value={total} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by recipient email…"
            className="h-9 pl-9"
          />
        </div>
        <select
          value={emailType}
          onChange={(e) => setEmailType(e.target.value)}
          className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
        >
          <option value="">All types</option>
          {Object.entries(TYPE_LABEL).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Error states */}
      {error === 'table_not_found' ? (
        <EmptyState
          icon={<Mail className="h-6 w-6" />}
          title="Email log table not set up"
          description="Re-run setup-sql.js against this environment to create the email_log table, then trigger a new email to see it appear here."
        />
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          Failed to load email log: {error}
        </div>
      ) : loading ? (
        <div className="py-12 text-center text-sm text-slate-500">Loading…</div>
      ) : emails.length === 0 ? (
        <EmptyState
          icon={<Mail className="h-6 w-6" />}
          title="No emails match"
          description={
            emailType || status || debouncedSearch
              ? 'Try clearing the filters.'
              : 'No emails have been logged yet. Each outbound email will appear here once the table is in place.'
          }
        />
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {emails.map((email) => (
            <button
              key={email.id}
              type="button"
              onClick={() => setSelected(email)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
            >
              {email.status === 'sent' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-900">
                  {email.to_email}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {email.subject || '—'}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusBadge tone={TYPE_TONE[email.email_type] || 'neutral'} size="sm">
                  {TYPE_LABEL[email.email_type] || email.email_type}
                </StatusBadge>
                <span className="text-[11px] text-slate-400">
                  {new Date(email.sent_at).toLocaleString()}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Page {currentPage} of {totalPages} ({total} total)</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      {/* Detail drawer */}
      <Drawer
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        title={selected ? (TYPE_LABEL[selected.email_type] || selected.email_type) : 'Email'}
        description={selected?.to_email || null}
        width="lg"
      >
        {selected ? (
          <div className="space-y-4">
            <section className="grid grid-cols-2 gap-3">
              <Field label="Status">
                <StatusBadge tone={selected.status === 'sent' ? 'success' : 'danger'} size="sm" dot>
                  {selected.status}
                </StatusBadge>
              </Field>
              <Field label="Type" value={TYPE_LABEL[selected.email_type] || selected.email_type} />
              <Field label="Recipient" value={selected.to_email} />
              <Field label="Sent at" value={new Date(selected.sent_at).toLocaleString()} />
              {selected.org_id ? <Field label="Org ID" value={selected.org_id} /> : null}
              {selected.actor_user_id ? <Field label="Actor user ID" value={selected.actor_user_id} /> : null}
            </section>
            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Subject</h4>
              <p className="text-sm text-slate-700">{selected.subject || '—'}</p>
            </section>
            {selected.error_message ? (
              <section>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Error</h4>
                <p className="rounded-md bg-rose-50 p-3 font-mono text-xs text-rose-900">
                  {selected.error_message}
                </p>
              </section>
            ) : null}
            {selected.metadata && Object.keys(selected.metadata).length > 0 ? (
              <section>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Metadata</h4>
                <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 font-mono text-xs text-slate-700">
                  {JSON.stringify(selected.metadata, null, 2)}
                </pre>
              </section>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </ModuleShell>
  );
}

function Field({ label, value, children }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-900">{children ?? value ?? '—'}</div>
    </div>
  );
}
