import React from 'react';
import { Megaphone, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import ModuleShell from '../ui/ModuleShell.jsx';
import ConfirmActionDialog from '../ui/ConfirmActionDialog.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import { useAdminModuleView, captureAdminEvent } from '../lib/admin-analytics.js';
import { useAdminStore } from '../lib/useAdminStore.js';

/**
 * Announcements — manage the platform-wide banner persisted in admin_data.
 *
 * The active banner is stored as a single record with id='active-banner'.
 * The public /api/announcement endpoint reads it and serves it to AppShell.
 */

const BANNER_ID = 'active-banner';

export default function AnnouncementsView() {
  useAdminModuleView('announcements');

  const { items, upsert, loading } = useAdminStore('announcements');
  const [draft, setDraft] = React.useState('');
  const [clearOpen, setClearOpen] = React.useState(false);

  const banner = items.find((i) => i.id === BANNER_ID);
  const current = banner?.active ? (banner?.text || '') : '';

  // Sync draft when banner loads
  const [seeded, setSeeded] = React.useState(false);
  React.useEffect(() => {
    if (!loading && !seeded) {
      setDraft(current);
      setSeeded(true);
    }
  }, [loading, seeded, current]);

  const dirty = draft !== current;
  const length = draft.length;
  const atLimit = length > 500;

  const publish = () => {
    upsert({ id: BANNER_ID, active: true, text: draft.trim(), updated_at: new Date().toISOString() });
    captureAdminEvent('announcement_saved', { length: draft.length });
  };

  const clear = () => {
    upsert({ id: BANNER_ID, active: false, text: '', updated_at: new Date().toISOString() });
    setDraft('');
    captureAdminEvent('announcement_saved', { length: 0, cleared: true });
  };

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
        {banner?.updated_at ? (
          <p className="mt-2 text-[11px] text-slate-400">
            Last updated {new Date(banner.updated_at).toLocaleString()}
          </p>
        ) : null}
      </article>

      <article className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Compose</h3>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Scheduled maintenance tonight 22:00–23:00 UTC. Expect brief downtime…"
          rows={5}
          disabled={loading}
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
            disabled={loading || !current}
            className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            Clear banner
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDraft(current)}
            disabled={loading || !dirty}
          >
            Revert
          </Button>
          <Button
            size="sm"
            onClick={publish}
            disabled={loading || !dirty || atLimit || !draft.trim()}
          >
            <Save className="mr-1.5 h-4 w-4" />
            Publish
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
          description="Today the banner is a single active message. Scheduling & targeting arrive in a future iteration."
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
          clear();
          setClearOpen(false);
        }}
      />
    </ModuleShell>
  );
}
