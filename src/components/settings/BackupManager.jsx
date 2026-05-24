import React from 'react';
import { toast } from '@/lib/toast.jsx';
import { AlertTriangle, HardDrive, Loader2, RotateCw, ShieldCheck } from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client.js';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function formatBytes(size) {
  const value = Number(size) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateLabel(date) {
  if (!date) return '—';
  try {
    return new Date(date).toLocaleDateString('he-IL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return date;
  }
}

function LoadingRows() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="animate-pulse rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="h-4 w-36 rounded bg-slate-200" />
            <div className="h-8 w-24 rounded bg-slate-200" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function BackupManager({ session, orgId }) {
  const [backups, setBackups] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [selectedBackup, setSelectedBackup] = React.useState(null);
  const [restoring, setRestoring] = React.useState(false);

  const loadBackups = React.useCallback(async () => {
    if (!session || !orgId) {
      setBackups([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const payload = await authenticatedFetch('backup-list', { method: 'GET' });
      setBackups(Array.isArray(payload) ? payload : []);
    } catch (requestError) {
      setError(requestError?.message || 'failed_to_load_backups');
      setBackups([]);
    } finally {
      setLoading(false);
    }
  }, [orgId, session]);

  React.useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const recentBackup = backups[0] || null;

  const handleRestore = React.useCallback(async () => {
    if (!selectedBackup?.filename || restoring) {
      return;
    }

    setRestoring(true);
    try {
      const payload = await authenticatedFetch('restore', {
        method: 'POST',
        body: {
          org_id: orgId,
          filename: selectedBackup.filename,
        },
      });

      const restored = Number(payload?.restored || 0);
      const warnings = Array.isArray(payload?.errors) ? payload.errors : [];
      if (warnings.length > 0) {
        toast.warning(`השחזור הושלם עם ${warnings.length} אזהרות. שוחזרו ${restored} רשומות.`);
      } else {
        toast.success(`השחזור הושלם בהצלחה. שוחזרו ${restored} רשומות.`);
      }
      setSelectedBackup(null);
      await loadBackups();
    } catch (requestError) {
      setError('restore_failed');
      toast.error(requestError?.message || 'שחזור הגיבוי נכשל');
    } finally {
      setRestoring(false);
    }
  }, [loadBackups, orgId, restoring, selectedBackup]);

  return (
    <Card className="w-full border-0 bg-white/90 shadow-lg">
      <CardHeader className="border-b border-slate-200 space-y-xs">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-xs">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900 sm:text-lg md:text-xl">
              <ShieldCheck className="h-5 w-5 text-slate-700" />
              גיבויים ושחזור
            </CardTitle>
            <p className="text-xs text-slate-600 sm:text-sm">
              ניהול גיבויים מוצפנים של הארגון. השחזור מצרף נתונים חדשים בלבד ואינו מוחק מידע קיים.
            </p>
          </div>
          <Badge variant="outline" className="border-slate-300 text-slate-700">
            {backups.length} קבצים
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-6">
        {recentBackup ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">הגיבוי האחרון</div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-800">
              <span className="font-semibold">{formatDateLabel(recentBackup.date)}</span>
              <span className="text-slate-500">{recentBackup.filename}</span>
              <span className="text-slate-500">{formatBytes(recentBackup.size_bytes)}</span>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" />
              לא ניתן לטעון את רשימת הגיבויים
            </div>
            <div className="mt-1 text-xs text-rose-600">{error}</div>
          </div>
        ) : null}

        {loading ? (
          <LoadingRows />
        ) : backups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-600">
            No backups available yet. The first backup will run automatically tonight.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-right font-medium">תאריך</th>
                  <th className="px-4 py-3 text-right font-medium">גודל</th>
                  <th className="px-4 py-3 text-right font-medium">קובץ</th>
                  <th className="px-4 py-3 text-right font-medium">שחזור</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.filename} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-900">{formatDateLabel(backup.date)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatBytes(backup.size_bytes)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{backup.filename}</td>
                    <td className="px-4 py-3">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        onClick={() => setSelectedBackup(backup)}
                      >
                        <RotateCw className="h-4 w-4" />
                        Restore
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <Dialog open={Boolean(selectedBackup)} onOpenChange={(open) => { if (!open) setSelectedBackup(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>אישור שחזור גיבוי</DialogTitle>
            <DialogDescription>
              שחזור הגיבוי {selectedBackup ? formatDateLabel(selectedBackup.date) : ''} יוסיף נתונים לארגון הנוכחי ולא ימחק מידע קיים. לא ניתן לבטל את הפעולה.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-slate-700">
            <div>קובץ: <span className="font-mono text-xs text-slate-900">{selectedBackup?.filename}</span></div>
            <div>גודל: {selectedBackup ? formatBytes(selectedBackup.size_bytes) : '—'}</div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              השחזור יתבצע במצב additive בלבד, עם upsert על בסיס המזהים הקיימים.
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setSelectedBackup(null)} disabled={restoring}>
              ביטול
            </Button>
            <Button onClick={handleRestore} disabled={restoring} className="gap-2">
              {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
              שחזור
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}