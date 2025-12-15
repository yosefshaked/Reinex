import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, Briefcase, Edit2, Loader2, Plus, Tag, Trash2, X } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { useOrg } from '@/org/OrgContext';
import { authenticatedFetch } from '@/lib/api-client';
import { useInstructorTypes } from '@/features/instructors/hooks/useInstructorTypes';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function TagsManager() {
  const { session } = useAuth();
  const { activeOrgId } = useOrg();
  const [mode, setMode] = useState('tags'); // 'tags' or 'types'
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  // Instructor types hook
  const { types, loadingTypes, loadTypes, createType, updateType, deleteType } = useInstructorTypes();

  // Add/Edit dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTag, setEditingTag] = useState(null);
  const [tagName, setTagName] = useState('');
  const inputRef = useRef(null);

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [tagToDelete, setTagToDelete] = useState(null);
  const [deleteError, setDeleteError] = useState('');

  const loadTags = useCallback(async () => {
    if (!session || !activeOrgId) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ keys: 'student_tags', org_id: activeOrgId });
      const response = await authenticatedFetch(`settings?${params.toString()}`, { session });
      const settingsValue = response?.settings?.student_tags;
      setTags(Array.isArray(settingsValue) ? settingsValue : []);
    } catch (err) {
      console.error('Failed to load tags', err);
      setError('טעינת התגיות נכשלה.');
      setTags([]);
    } finally {
      setLoading(false);
    }
  }, [session, activeOrgId]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  // Load instructor types when switching to types mode
  useEffect(() => {
    if (mode === 'types') {
      loadTypes();
    }
  }, [mode, loadTypes]);

  const openAddDialog = () => {
    setEditingTag(null);
    setTagName('');
    setActionError('');
    setIsDialogOpen(true);
  };

  const openEditDialog = (tag) => {
    setEditingTag(tag);
    setTagName(tag.name);
    setActionError('');
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    if (!actionLoading) {
      setIsDialogOpen(false);
      setEditingTag(null);
      setTagName('');
      setActionError('');
    }
  };

  // Auto-focus the input when the dialog opens
  useEffect(() => {
    if (isDialogOpen) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isDialogOpen]);

  const handleSaveTag = async (e) => {
    e.preventDefault();
    const trimmedName = tagName.trim();
    if (!trimmedName) {
      setActionError(mode === 'tags' ? 'יש להזין שם תגית.' : 'יש להזין שם סוג.');
      return;
    }

    if (mode === 'types') {
      // Instructor types mode
      setActionLoading(true);
      setActionError('');
      try {
        if (editingTag) {
          await updateType(editingTag.id, trimmedName);
        } else {
          await createType(trimmedName);
        }
        closeDialog();
      } catch (err) {
        console.error('Failed to save type', err);
        setActionError(err?.message || 'שמירת הסוג נכשלה.');
      } finally {
        setActionLoading(false);
      }
      return;
    }

    // Student tags mode
    const duplicate = tags.find(
      (t) => t.name.toLowerCase() === trimmedName.toLowerCase() && t.id !== editingTag?.id
    );
    if (duplicate) {
      setActionError('תגית בשם זה כבר קיימת.');
      return;
    }

    setActionLoading(true);
    setActionError('');

    try {
      if (editingTag) {
        // Update existing tag
        const updatedTags = tags.map((t) => (t.id === editingTag.id ? { ...t, name: trimmedName } : t));
        await authenticatedFetch('settings', { 
          method: 'POST', 
          body: { 
            org_id: activeOrgId,
            settings: {
              student_tags: updatedTags
            }
          }, 
          session 
        });
        setTags(updatedTags);
      } else {
        // Create new tag
        const body = { org_id: activeOrgId, name: trimmedName };
        const response = await authenticatedFetch('settings/student-tags', { method: 'POST', body, session });
        const newTag = response?.created;
        if (newTag) {
          setTags((prev) => [...prev, newTag]);
        } else {
          // Fallback: reload all tags
          await loadTags();
        }
      }
      closeDialog();
    } catch (err) {
      console.error('Failed to save tag', err);
      setActionError(err?.message || 'שמירת התגית נכשלה.');
    } finally {
      setActionLoading(false);
    }
  };

  const openDeleteDialog = (tag) => {
    setTagToDelete(tag);
    setDeleteError('');
    setDeleteDialogOpen(true);
  };

  const closeDeleteDialog = () => {
    if (!actionLoading) {
      setDeleteDialogOpen(false);
      setTagToDelete(null);
      setDeleteError('');
    }
  };

  const handleDeleteTag = async () => {
    if (!tagToDelete) return;

    setActionLoading(true);
    setDeleteError('');

    if (mode === 'types') {
      // Instructor types mode
      try {
        await deleteType(tagToDelete.id);
        closeDeleteDialog();
      } catch (err) {
        console.error('Failed to delete type', err);
        setDeleteError(err?.message || 'מחיקת הסוג נכשלה.');
      } finally {
        setActionLoading(false);
      }
      return;
    }

    // Student tags mode
    try {
      // First remove tag from all students who have it
      await authenticatedFetch('students-remove-tag', {
        method: 'POST',
        body: { org_id: activeOrgId, tag_id: tagToDelete.id },
        session,
      });

      // Then remove tag from catalog
      const updatedTags = tags.filter((t) => t.id !== tagToDelete.id);
      await authenticatedFetch('settings', { 
        method: 'POST', 
        body: { 
          org_id: activeOrgId,
          settings: {
            student_tags: updatedTags
          }
        }, 
        session 
      });

      setTags(updatedTags);
      closeDeleteDialog();
    } catch (err) {
      console.error('Failed to delete tag', err);
      setDeleteError(err?.message || 'מחיקת התגית נכשלה.');
    } finally {
      setActionLoading(false);
    }
  };

  const isLoading = mode === 'tags' ? loading : loadingTypes;
  const items = mode === 'tags' ? tags : types;
  const Icon = mode === 'tags' ? Tag : Briefcase;
  const entityLabel = mode === 'tags' ? 'תגית' : 'סוג';
  const entityLabelPlural = mode === 'tags' ? 'תגיות' : 'סוגים';
  const entityContext = mode === 'tags' ? 'תלמידים' : 'מדריכים';

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            ניהול תגיות וסיווגים
          </CardTitle>
          <CardDescription>ניהול תגיות לתלמידים וסיווגים למדריכים</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>טוען {entityLabelPlural}...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-row-reverse items-center justify-between gap-4">
            <div className="flex-1 text-right">
              <CardTitle className="flex items-center gap-2 justify-end mb-1">
                <span>ניהול תגיות וסיווגים</span>
                <Icon className="h-5 w-5" />
              </CardTitle>
              <CardDescription className="text-right">ניהול תגיות לתלמידים וסיווגים למדריכים</CardDescription>
            </div>
            <Button onClick={openAddDialog} size="sm" className="gap-2 shrink-0">
              <Plus className="h-4 w-4" />
              {entityLabel} חדש{mode === 'tags' ? 'ה' : ''}
            </Button>
          </div>
          
          {/* Mode toggle buttons */}
          <div className="flex gap-2 mt-4" dir="rtl">
            <Button
              variant={mode === 'tags' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('tags')}
              className="gap-2"
            >
              <Tag className="h-4 w-4" />
              תגיות תלמידים
            </Button>
            <Button
              variant={mode === 'types' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('types')}
              className="gap-2"
            >
              <Briefcase className="h-4 w-4" />
              סוגי מדריכים
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2" role="alert" dir="rtl">
              <span className="flex-1 text-right">{error}</span>
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            </div>
          )}

          {items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Icon className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">לא קיימים {entityLabelPlural}. צור {entityLabel} ראשון{mode === 'tags' ? 'ה' : ''} כדי להתחיל.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="group flex items-center justify-between p-3 rounded-lg border bg-card/90 hover:bg-accent/40 transition-colors focus-within:ring-2 focus-within:ring-primary/30"
                  dir="rtl"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <span className="font-medium select-text">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditDialog(item)}
                      className="h-8 px-2"
                      title={`עריכת ${entityLabel}`}
                      aria-label={`עריכת ${entityLabel} ${item.name}`}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openDeleteDialog(item)}
                      className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                      title={`מחיקת ${entityLabel}`}
                      aria-label={`מחיקת ${entityLabel} ${item.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={closeDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingTag ? `עריכת ${entityLabel}` : `${entityLabel} חדש${mode === 'tags' ? 'ה' : ''}`}</DialogTitle>
            <DialogDescription>
              {editingTag 
                ? `ערוך את שם ה${entityLabel}. השינוי יחול על כל ה${entityContext} ${mode === 'tags' ? 'המתויגים' : 'המסווגים'}.` 
                : `צור ${entityLabel} חדש${mode === 'tags' ? 'ה' : ''} לסיווג ${entityContext}.`}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveTag} className="space-y-4" dir="rtl">
            <div className="space-y-2">
              <Label htmlFor="tag-name" className="text-right block">
                שם {entityLabel}
              </Label>
              <Input
                id="tag-name"
                ref={inputRef}
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                placeholder={mode === 'tags' ? 'לדוגמה: תלמיד חדש' : 'לדוגמה: מטפל'}
                required
                disabled={actionLoading}
                dir="rtl"
                className="text-right"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSaveTag(e);
                  }
                }}
              />
              <p className="text-xs text-muted-foreground text-right">השם יוצג בתפריטים ושדות בחירת {entityLabelPlural}.</p>
            </div>

            {actionError && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 text-right flex items-start gap-2" role="alert">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{actionError}</span>
              </div>
            )}
          </form>
          <DialogFooter className="flex-row-reverse gap-2">
            <Button type="submit" onClick={handleSaveTag} disabled={actionLoading} className="gap-2">
              {actionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingTag ? 'שמירת שינויים' : `יצירת ${entityLabel}`}
            </Button>
            <Button type="button" variant="outline" onClick={closeDialog} disabled={actionLoading}>
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={closeDeleteDialog}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-right">האם למחוק את ה{entityLabel} "{tagToDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription className="text-right">
              פעולה זו תמחק את ה{entityLabel} מהמערכת ותסיר {mode === 'tags' ? 'אותה מכל התלמידים שמתויגים בה' : 'אותו מכל המדריכים המסווגים בו'}. לא ניתן לשחזר את הפעולה.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {deleteError && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 text-right flex items-start gap-2" role="alert">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{deleteError}</span>
            </div>
          )}
          
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogAction
              onClick={handleDeleteTag}
              disabled={actionLoading}
              className="bg-destructive hover:bg-destructive/90 gap-2"
            >
              {actionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              מחיקת {entityLabel}
            </AlertDialogAction>
            <AlertDialogCancel disabled={actionLoading}>ביטול</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
