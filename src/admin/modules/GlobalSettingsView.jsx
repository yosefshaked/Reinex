import React from 'react';
import { authenticatedFetch } from '@/lib/api-client.js';
import SystemAdminModuleShell from './SystemAdminModuleShell.jsx';

const DEFAULT_FLAGS = [
  { key: 'enable_advanced_billing', label: 'Advanced Billing Engine', enabled: false },
  { key: 'enable_calendar_drag_drop_v2', label: 'Calendar Drag/Drop V2', enabled: true },
  { key: 'enable_waiting_list_ai_suggestions', label: 'AI Waiting-List Suggestions', enabled: true },
];

export default function GlobalSettingsView() {
  const [announcement, setAnnouncement] = React.useState('');
  const [flags, setFlags] = React.useState(DEFAULT_FLAGS);
  const [savedAt, setSavedAt] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  const loadSettings = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await authenticatedFetch('system-admin-global-settings', { method: 'GET' });
      const incomingFlags = payload?.flags && typeof payload.flags === 'object' ? payload.flags : {};

      const mergedFlags = [
        ...DEFAULT_FLAGS,
        ...Object.entries(incomingFlags)
          .filter(([key]) => !DEFAULT_FLAGS.some((existing) => existing.key === key))
          .map(([key, enabled]) => ({
            key,
            label: key
              .split(/[_.-]/)
              .filter(Boolean)
              .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
              .join(' '),
            enabled: Boolean(enabled),
          })),
      ].map((flag) => ({
        ...flag,
        enabled: Object.prototype.hasOwnProperty.call(incomingFlags, flag.key)
          ? Boolean(incomingFlags[flag.key])
          : Boolean(flag.enabled),
      }));

      setFlags(mergedFlags);
      setAnnouncement(typeof payload?.announcement === 'string' ? payload.announcement : '');
      setSavedAt(payload?.requested_at || '');
    } catch (requestError) {
      setError(requestError?.message || 'Failed to load global settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const toggleFlag = React.useCallback((flagKey) => {
    setFlags((previous) =>
      previous.map((flag) => (flag.key === flagKey ? { ...flag, enabled: !flag.enabled } : flag)),
    );
  }, []);

  const saveDraft = React.useCallback(() => {
    const run = async () => {
      setSaving(true);
      setError('');
      try {
        const payload = await authenticatedFetch('system-admin-global-settings', {
          method: 'POST',
          body: {
            flags: flags.reduce((acc, flag) => {
              acc[flag.key] = Boolean(flag.enabled);
              return acc;
            }, {}),
            announcement,
          },
        });
        setSavedAt(payload?.requested_at || new Date().toISOString());
      } catch (requestError) {
        setError(requestError?.message || 'Failed to save global settings.');
      } finally {
        setSaving(false);
      }
    };

    run();
  }, [announcement, flags]);

  return (
    <SystemAdminModuleShell
      title="Global Settings"
      subtitle="System-wide controls for rollout flags and announcements."
      actions={
        <button
          type="button"
          onClick={saveDraft}
          disabled={loading || saving}
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Save Draft'}
        </button>
      }
    >
      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Feature Flags</h3>
        <div className="mt-4 space-y-3">
          {flags.map((flag) => (
            <label
              key={flag.key}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <span className="text-sm font-medium text-slate-800">{flag.label}</span>
              <input
                type="checkbox"
                checked={flag.enabled}
                onChange={() => toggleFlag(flag.key)}
                disabled={loading || saving}
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
              />
            </label>
          ))}
        </div>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">System Announcement</h3>
        <textarea
          value={announcement}
          onChange={(event) => setAnnouncement(event.target.value)}
          rows={5}
          placeholder="Write a platform-wide announcement for all organizations..."
          disabled={loading || saving}
          className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none ring-0 transition focus:border-slate-500"
        />
        <p className="mt-2 text-xs text-slate-500">
          {savedAt ? `Last draft save: ${new Date(savedAt).toLocaleString()}` : 'No draft saved yet.'}
        </p>
      </article>
    </SystemAdminModuleShell>
  );
}
