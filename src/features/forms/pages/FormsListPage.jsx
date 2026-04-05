import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FileText, Loader2, AlertCircle, MoreHorizontal, Trash2, Eye } from 'lucide-react';
import PageLayout from '@/components/ui/PageLayout.jsx';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { normalizeMembershipRole, isAdminRole } from '@/features/students/utils/endpoints.js';

export default function FormsListPage() {
  const navigate = useNavigate();
  const { activeOrg, activeOrgId, activeOrgHasConnection, tenantClientReady } = useOrg();
  const { session } = useSupabase();

  const membershipRole = normalizeMembershipRole(activeOrg?.membership?.role || null);
  const isAdmin = isAdminRole(membershipRole);

  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newUsage, setNewUsage] = useState('general');

  const canFetch = Boolean(session && activeOrgId && tenantClientReady && activeOrgHasConnection);

  const loadForms = useCallback(async () => {
    if (!canFetch) return;

    setLoading(true);
    setError('');

    try {
      const data = await authenticatedFetch('forms', {
        session,
        params: { org_id: activeOrgId },
      });
      setForms(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load forms', err);
      setError(err?.message || 'שגיאה בטעינת הטפסים');
    } finally {
      setLoading(false);
    }
  }, [canFetch, session, activeOrgId]);

  useEffect(() => {
    if (canFetch) {
      void loadForms();
    }
  }, [canFetch, loadForms]);

  const handleCreate = async () => {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      toast.error('יש להזין שם לטופס');
      return;
    }

    setIsSubmitting(true);
    try {
      await authenticatedFetch('forms', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          name: trimmedName,
          description: newDescription.trim() || null,
          form_usage: newUsage,
        },
      });
      toast.success('הטופס נוצר בהצלחה');
      setDialogOpen(false);
      setNewName('');
      setNewDescription('');
      setNewUsage('general');
      void loadForms();
    } catch (err) {
      console.error('Failed to create form', err);
      toast.error(err?.message || 'שגיאה ביצירת הטופס');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeactivate = async (form) => {
    try {
      await authenticatedFetch(`forms/${form.id}`, {
        session,
        method: 'DELETE',
        body: { org_id: activeOrgId },
      });
      toast.success(`הטופס "${form.name}" הושבת`);
      void loadForms();
    } catch (err) {
      console.error('Failed to deactivate form', err);
      toast.error(err?.message || 'שגיאה בהשבתת הטופס');
    }
  };

  function formatDate(dateString) {
    if (!dateString) return '—';
    try {
      return new Date(dateString).toLocaleDateString('he-IL');
    } catch {
      return '—';
    }
  }

  function getUsageLabel(value) {
    return value === 'waiting_list_intake' ? 'טופס רשימת המתנה' : 'טופס כללי';
  }

  if (loading && forms.length === 0) {
    return (
      <PageLayout title="טפסים">
        <Card>
          <CardContent className="flex items-center justify-center p-12">
            <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
            <span className="ms-2 text-sm text-neutral-500">טוען טפסים...</span>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  if (error && forms.length === 0) {
    return (
      <PageLayout title="טפסים">
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 p-12 text-center">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <p className="text-sm text-red-600">{error}</p>
            <Button variant="outline" size="sm" onClick={loadForms}>
              נסה שוב
            </Button>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="טפסים"
      description="ניהול טפסים ושאלונים עבור תלמידי הארגון"
      actions={
        isAdmin ? (
          <Button className="gap-2" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            צור טופס חדש
          </Button>
        ) : null
      }
    >
      {forms.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <FileText className="h-12 w-12 text-neutral-300" />
            <p className="text-neutral-500">לא נמצאו טפסים</p>
            {isAdmin && (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4" />
                צור טופס ראשון
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>שם</TableHead>
                <TableHead>תיאור</TableHead>
                <TableHead className="text-center">שימוש</TableHead>
                <TableHead className="text-center">גרסה</TableHead>
                <TableHead className="text-center">סטטוס</TableHead>
                <TableHead>נוצר</TableHead>
                {isAdmin && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {forms.map((form) => (
                <TableRow key={form.id}>
                  <TableCell className="font-medium">{form.name}</TableCell>
                  <TableCell className="text-neutral-500 max-w-xs truncate">
                    {form.description || '—'}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={form.form_usage === 'waiting_list_intake' ? 'default' : 'outline'}>
                      {getUsageLabel(form.form_usage)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline">v{form.version}</Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    {form.is_active ? (
                      <Badge variant="secondary">פעיל</Badge>
                    ) : (
                      <Badge variant="destructive">מושבת</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-neutral-500 text-sm">
                    {formatDate(form.created_at)}
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem className="gap-2" onClick={() => navigate(`/forms/${form.id}`)}>
                            <Eye className="h-4 w-4" />
                            עריכת שאלון
                          </DropdownMenuItem>
                          {form.is_active && (
                            <DropdownMenuItem
                              className="gap-2 text-red-600 focus:text-red-600"
                              onClick={() => handleDeactivate(form)}
                            >
                              <Trash2 className="h-4 w-4" />
                              השבת טופס
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Create form dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>צור טופס חדש</DialogTitle>
            <DialogDescription>הגדר שם ותיאור לטופס. לאחר היצירה תוכל לערוך את שאלון הטופס.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="form-name">שם הטופס</Label>
              <Input
                id="form-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="לדוגמה: שאלון בריאות ראשוני"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="form-description">תיאור (אופציונלי)</Label>
              <Textarea
                id="form-description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="תיאור קצר של מטרת הטופס"
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="form-usage">סוג הטופס</Label>
              <Select value={newUsage} onValueChange={setNewUsage}>
                <SelectTrigger id="form-usage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">טופס כללי</SelectItem>
                  <SelectItem value="waiting_list_intake">טופס רשימת המתנה</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSubmitting}>
              ביטול
            </Button>
            <Button onClick={handleCreate} disabled={isSubmitting || !newName.trim()} className="gap-2">
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              צור טופס
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
