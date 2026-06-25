import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '@/components/ui/PageLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, ArrowLeft, FolderInput, Trash2 } from 'lucide-react';
import { listImportWorkspaces, createImportWorkspace, deleteImportWorkspace } from '../api/importWorkspacesApi.js';

// Once live data has been written we keep the staging + audit trail, so these
// statuses can't be deleted (the backend rejects them too).
const NON_DELETABLE_STATUSES = new Set(['committed', 'partially_committed']);

const STATUS_LABEL = {
  draft:      'טיוטה',
  profiling:  'פרופיל',
  mapping:    'מיפוי',
  ingesting:  'קליטה',
  analyzing:  'ניתוח',
  review:     'סקירה',
  committing: 'ביצוע',
  done:       'הושלם',
  error:      'שגיאה',
};

const STATUS_VARIANT = {
  done:   'default',
  error:  'destructive',
  draft:  'secondary',
};

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function ImportWorkspacesListPage() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);

  // Create dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName]       = useState('');
  const [newDesc, setNewDesc]       = useState('');
  const [creating, setCreating]     = useState(false);
  const [createError, setCreateError] = useState(null);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting]         = useState(false);
  const [deleteError, setDeleteError]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listImportWorkspaces();
      setWorkspaces(data || []);
    } catch (err) {
      setError(err.message || 'שגיאה בטעינה');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const ws = await createImportWorkspace({ name: newName.trim(), description: newDesc.trim() || undefined });
      setDialogOpen(false);
      setNewName('');
      setNewDesc('');
      navigate(`/import-workspaces/${ws.id}`);
    } catch (err) {
      setCreateError(err.message || 'שגיאה ביצירה');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteImportWorkspace(deleteTarget.id);
      setWorkspaces((prev) => prev.filter((w) => w.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err.message || 'שגיאה במחיקה');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <PageLayout
      title="סביבות ייבוא"
      description="נהל ייבואי נתונים מאורגנות"
      actions={
        <Button onClick={() => setDialogOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          סביבה חדשה
        </Button>
      }
    >
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!loading && error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {!loading && !error && workspaces.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
          <FolderInput className="h-12 w-12 opacity-30" />
          <p className="text-sm">אין סביבות ייבוא עדיין</p>
          <Button variant="outline" onClick={() => setDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            צור סביבה ראשונה
          </Button>
        </div>
      )}

      {!loading && !error && workspaces.length > 0 && (
        <div className="grid gap-3">
          {workspaces.map(ws => (
            <Card
              key={ws.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate(`/import-workspaces/${ws.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && navigate(`/import-workspaces/${ws.id}`)}
              aria-label={`פתח סביבת ייבוא: ${ws.name}`}
            >
              <CardHeader className="pb-2 flex-row items-start justify-between">
                <div>
                  <CardTitle className="text-base">{ws.name}</CardTitle>
                  {ws.description && (
                    <CardDescription className="mt-0.5">{ws.description}</CardDescription>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={STATUS_VARIANT[ws.status] || 'secondary'}>
                    {STATUS_LABEL[ws.status] || ws.status}
                  </Badge>
                  {!NON_DELETABLE_STATUSES.has(ws.status) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); setDeleteError(null); setDeleteTarget(ws); }}
                      aria-label={`מחק סביבת ייבוא: ${ws.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                  <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">נוצר: {formatDate(ws.created_at)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>סביבת ייבוא חדשה</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="ws-name">שם *</Label>
              <Input
                id="ws-name"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="לדוגמה: ייבוא תלמידים מאוגוסט 2025"
                dir="rtl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ws-desc">תיאור</Label>
              <Input
                id="ws-desc"
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                placeholder="תיאור אופציונלי"
                dir="rtl"
              />
            </div>
            {createError && (
              <p className="text-xs text-destructive">{createError}</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={creating}>
              ביטול
            </Button>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? 'יוצר…' : 'צור'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>מחיקת סביבת ייבוא</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2 text-sm">
            <p>
              למחוק לצמיתות את <span className="font-medium">{deleteTarget?.name}</span> ואת כל נתוני הייבוא שלה
              (שורות, מועמדים וקבצי הגיבוי הזמניים)?
            </p>
            <p className="text-muted-foreground">
              הפעולה אינה משפיעה על נתונים שכבר יובאו למערכת — רק על סביבת הייבוא עצמה. לא ניתן לשחזר.
            </p>
            {deleteError && <p className="text-destructive">{deleteError}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              ביטול
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'מוחק…' : 'מחק לצמיתות'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
