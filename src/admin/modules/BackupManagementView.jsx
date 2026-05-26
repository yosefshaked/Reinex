import React from 'react';
import { toast } from '@/lib/toast.jsx';
import { ArchiveRestore, Loader2, RotateCw, ShieldCheck, Upload } from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client.js';
import SystemAdminModuleShell from './SystemAdminModuleShell.jsx';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('he-IL');
  } catch {
    return value;
  }
}

function formatBytes(size) {
  const value = Number(size) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function sortBackups(entries) {
  return [...(Array.isArray(entries) ? entries : [])].sort((left, right) => {
    const leftValue = new Date(left?.timestamp || 0).getTime();
    const rightValue = new Date(right?.timestamp || 0).getTime();
    return rightValue - leftValue;
  });
}

export default function BackupManagementView() {
  const [organizations, setOrganizations] = React.useState([]);
  const [selectedOrgId, setSelectedOrgId] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState('');
  const [restoreTarget, setRestoreTarget] = React.useState(null);

  const selectedOrg = React.useMemo(
    () => organizations.find((org) => org.id === selectedOrgId) || null,
    [organizations, selectedOrgId],
  );

  const loadData = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await authenticatedFetch('system-admin-backups', { method: 'GET' });
      const orgs = Array.isArray(payload?.organizations) ? payload.organizations : [];
      setOrganizations(orgs);
      setSelectedOrgId((previous) => previous || orgs[0]?.id || '');
    } catch (requestError) {
      setError(requestError?.message || 'failed_to_load_backup_data');
      setOrganizations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  const updateBackupGate = React.useCallback(
    async (orgId, enabled) => {
      setSaving(true);
      try {
        await authenticatedFetch('system-admin-backups', {
          method: 'POST',
          body: {
            action: 'set_backup_local_enabled',
            org_id: orgId,
            enabled,
          },
        });
        toast.success(enabled ? 'Backup enabled for org.' : 'Backup disabled for org.');
        await loadData();
      } catch (requestError) {
        toast.error(requestError?.message || 'Failed to update backup gate.');
      } finally {
        setSaving(false);
      }
    },
    [loadData],
  );

  const runBackupNow = React.useCallback(async () => {
    setRunning(true);
    try {
      const payload = await authenticatedFetch('system-admin-backups', {
        method: 'POST',
        body: { action: 'run_backup_now' },
      });
      const succeeded = Number(payload?.succeeded || 0);
      const failed = Number(payload?.failed || 0);
      const firstError = Array.isArray(payload?.errors)
        ? payload.errors.find((entry) => typeof entry?.message === 'string' && entry.message.trim().length > 0)?.message
        : '';

      if (failed > 0) {
        toast.warning(
          firstError
            ? `Backup run completed with ${failed} failures and ${succeeded} successes. First error: ${firstError}`
            : `Backup run completed with ${failed} failures and ${succeeded} successes.`
        );
      } else {
        toast.success(`Backup run completed with ${succeeded} successful org backups.`);
      }
      await loadData();
    } catch (requestError) {
      toast.error(requestError?.message || 'Failed to run backup job.');
    } finally {
      setRunning(false);
    }
  }, [loadData]);

  const restoreSelectedBackup = React.useCallback(async () => {
    if (!restoreTarget?.orgId || !restoreTarget?.filename) {
      return;
    }

    setRunning(true);
    try {
      const payload = await authenticatedFetch('system-admin-backups', {
        method: 'POST',
        body: {
          action: 'restore_backup',
          org_id: restoreTarget.orgId,
          filename: restoreTarget.filename,
        },
      });
      toast.success(`Restored ${Number(payload?.restored || 0)} records from backup.`);
      setRestoreTarget(null);
      await loadData();
    } catch (requestError) {
      toast.error(requestError?.message || 'Failed to restore backup.');
    } finally {
      setRunning(false);
    }
  }, [loadData, restoreTarget]);

  const backupHistory = React.useMemo(() => sortBackups(selectedOrg?.backup_history), [selectedOrg]);

  return (
    <SystemAdminModuleShell
      title="Backup Management"
      subtitle="Inspect backup health, toggle org backup availability, and restore encrypted snapshots."
      actions={
        <Button onClick={runBackupNow} disabled={loading || running} className="gap-2">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Run backup now
        </Button>
      }
    >
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-200">
            <CardTitle className="flex items-center gap-2 text-base text-slate-900">
              <ShieldCheck className="h-5 w-5 text-slate-700" />
              Organizations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="animate-pulse rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="h-4 w-40 rounded bg-slate-200" />
                    <div className="mt-3 h-3 w-24 rounded bg-slate-200" />
                  </div>
                ))}
              </div>
            ) : organizations.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
                No organizations found.
              </p>
            ) : (
              organizations.map((org) => (
                <button
                  key={org.id}
                  type="button"
                  onClick={() => setSelectedOrgId(org.id)}
                  className={`w-full rounded-2xl border px-4 py-3 text-right transition ${
                    selectedOrgId === org.id
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-900 hover:border-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{org.name || org.slug || org.id}</span>
                    <Badge variant={org.backup_local_enabled ? 'default' : 'secondary'} className="text-xs">
                      {org.backup_local_enabled ? 'enabled' : 'disabled'}
                    </Badge>
                  </div>
                  <div className={`mt-2 text-xs ${selectedOrgId === org.id ? 'text-slate-200' : 'text-slate-500'}`}>
                    {org.slug || org.id}
                  </div>
                  <div className={`mt-1 text-xs ${selectedOrgId === org.id ? 'text-slate-200' : 'text-slate-500'}`}>
                    Last backup: {org.last_backup?.timestamp ? formatDate(org.last_backup.timestamp) : 'none'}
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base text-slate-900">
                  {selectedOrg ? selectedOrg.name || selectedOrg.slug || selectedOrg.id : 'Select an organization'}
                </CardTitle>
                <p className="mt-1 text-sm text-slate-600">
                  {selectedOrg ? `${selectedOrg.slug || selectedOrg.id} · ${selectedOrg.backup_history_count} backups` : 'Choose an organization to inspect its backup history.'}
                </p>
              </div>
              {selectedOrg ? (
                <label className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedOrg.backup_local_enabled)}
                    disabled={saving}
                    onChange={(event) => updateBackupGate(selectedOrg.id, event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                  />
                  backup_local_enabled
                </label>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-4">
            {selectedOrg ? (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.12em] text-slate-500">Gate</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {selectedOrg.backup_local_enabled ? 'Enabled' : 'Disabled'}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.12em] text-slate-500">Latest</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {selectedOrg.last_backup?.timestamp ? formatDate(selectedOrg.last_backup.timestamp) : 'No backups yet'}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.12em] text-slate-500">Files</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {selectedOrg.backup_history_count}
                    </div>
                  </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 text-right font-medium">Time</th>
                        <th className="px-4 py-3 text-right font-medium">File</th>
                        <th className="px-4 py-3 text-right font-medium">Size</th>
                        <th className="px-4 py-3 text-right font-medium">Status</th>
                        <th className="px-4 py-3 text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backupHistory.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                            No backup history available.
                          </td>
                        </tr>
                      ) : (
                        backupHistory.map((entry, index) => (
                          <tr key={`${entry.filename || 'entry'}-${index}`} className="border-t border-slate-100">
                            <td className="px-4 py-3 text-slate-700">{formatDate(entry.timestamp)}</td>
                            <td className="px-4 py-3 font-mono text-xs text-slate-600">{entry.filename || '—'}</td>
                            <td className="px-4 py-3 text-slate-700">{formatBytes(entry.size_bytes)}</td>
                            <td className="px-4 py-3 text-slate-700">
                              <span className={entry.status === 'failed' ? 'font-medium text-rose-700' : ''}>
                                {entry.status || '—'}
                              </span>
                              {entry.error_message ? (
                                <div className="mt-1 max-w-md break-words text-xs text-rose-600" title={entry.error_message}>
                                  {entry.error_message}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-4 py-3">
                              {entry.filename ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="gap-2"
                                  onClick={() => setRestoreTarget({ orgId: selectedOrg.id, filename: entry.filename })}
                                >
                                  <ArchiveRestore className="h-4 w-4" />
                                  Restore
                                </Button>
                              ) : (
                                <span
                                  className="text-slate-400"
                                  title={entry.error_message || 'No backup file was created for this failed run.'}
                                >
                                  No file
                                </span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(restoreTarget)} onOpenChange={(open) => { if (!open) setRestoreTarget(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Restore backup</DialogTitle>
            <DialogDescription>
              This system-admin restore bypasses the org backup gate and restores the selected encrypted snapshot into the chosen organization.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm text-slate-700">
            <div>Organization: <span className="font-medium text-slate-900">{selectedOrg?.name || selectedOrg?.id || '—'}</span></div>
            <div className="break-all">File: <span className="font-mono text-xs text-slate-900">{restoreTarget?.filename || '—'}</span></div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setRestoreTarget(null)} disabled={running}>
              Cancel
            </Button>
            <Button onClick={restoreSelectedBackup} disabled={running} className="gap-2">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
              Restore
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </SystemAdminModuleShell>
  );
}