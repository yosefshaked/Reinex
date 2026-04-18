import React from 'react';
import { Megaphone, Save, Trash2 } from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client.js';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import ModuleShell from '../ui/ModuleShell.jsx';
import ConfirmActionDialog from '../ui/ConfirmActionDialog.jsx';
import ErrorState from '../ui/ErrorState.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import { useAdminModuleView, captureAdminEvent } from '../lib/admin-analytics.js';

/**
 * Announcements — manage the single platform-wide banner persisted via
 * system-admin-global-settings. Scheduled banners, per-plan targeting, and
 * acknowledgement tracking are listed as planned follow-ups below.
 */

export default function AnnouncementsView() {
  useAdminModuleView('announcements');

  const [current, setCurrent] = React.useState('');
  const [draft, setDraft] = React.useState('');
  const [savedAt, setSavedAt] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [clearOpen, setClearOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await authenticatedFetch('system-admin-global-settings', { method: 'GET' });
      const value = typeof payload?.announcement === 'string' ? payload.announcement : '';
      setCurrent(value);
      setDraft(value);
      setSavedAt(payload?.requested_at || '');
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const save = React.useCallback(async (next) => {
    setSaving(true);
    try {
      const payload = await authenticatedFetch('system-admin-global-settings', {
        method: 'POST',
        body: { announcement: next },
      });
      setCurrent(next);
      setDraft(next);
      setSavedAt(payload?.requested_at || new Date().toISOString());
      captureAdminEvent('announcement_saved', { length: next.length, cleared: !next });
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }, []);

  const dirty = draft !== current;
  const length = draft.length;
  const atLimit = length > 500;

  if (error) {
    return (
      <ModuleShell title="Announcements" subtitle="Content">
        <ErrorState error={error} onRetry={load} />
      </ModuleShell>
    );
  }

  return (
    <ModuleShell
      title="Announcements"
      subtitle="Content"
      description="The active banner shows up in every signed-in user's app shell. Keep it short — this is for platform events (maintenance windows, outages, release notes)."
    >
      <article className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Megaphone className="h-4 w-4 text-slate-500" />
            Active banner
          </h3>
          {current ? (
            <StatusBadge tone="success" size="sm" dot>live</StatusBadge>
          ) : (
            <StatusBadge tone="neutral" size="sm">no active banner</StatusBadge>
          )}
        </div>
        {current ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 whitespace-pre-wrap">
            {current}
          </div>
        ) : (
          <p className="text-xs text-slate-500">Nothing is currently shown to users.</p>
        )}
        <p className="mt-2 text-[11px] text-slate-400">
          {savedAt ? `Last saved ${new Date(savedAt).toLocaleString()}` : ''}
        </p>
      </article>

      <article className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Compose</h3>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Scheduled maintenance tonight 22:00–23:00 UTC. Expect brief downtime…"
          rows={5}
          disabled={loading || saving}
          className="mt-3"
        />
        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
          <span className={atLimit ? 'text-rose-600' : ''}>{length} / 500 characters</span>
          {dirty ? <span className="text-amber-700">Unsaved changes</span> : <span>Up to date</span>}
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setClearOpen(true)}
            disabled={loading || saving || !current}
            className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            Clear banner
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDraft(current)}
            disabled={loading || saving || !dirty}
          >
            Revert
          </Button>
          <Button
            size="sm"
            onClick={() => save(draft)}
            disabled={loading || saving || !dirty || atLimit}
          >
            <Save className="mr-1.5 h-4 w-4" />
            {saving ? 'Saving…' : 'Publish'}
          </Button>
        </div>
      </article>

      <article className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Coming soon</h3>
        <ul className="mt-2 list-disc pl-5 text-xs leading-5 text-slate-600">
          <li>Schedule banners with start/end windows</li>
          <li>Target by plan, region, or org list</li>
          <li>Acknowledgement tracking per user</li>
          <li>Channel split: in-product + email (via Brevo)</li>
        </ul>
        <EmptyState
          className="mt-4 bg-white"
          icon={<Megaphone className="h-6 w-6" />}
          title="Scheduling not wired yet"
          description="Today the banner is a single active message. Scheduling & targeting arrive when the announcements schema lands."
        />
      </article>

      <ConfirmActionDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        severity="warning"
        title="Clear the active banner?"
        description="This removes the platform-wide banner for all signed-in users immediately."
        confirmLabel="Clear banner"
        onConfirm={async () => {
          await save('');
          setClearOpen(false);
        }}
      />
    </ModuleShell>
  );
}
