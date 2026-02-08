import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { TextField } from '@/components/ui/forms-ui';
import FormField from '@/components/ui/forms-ui/FormField.jsx';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Plus } from 'lucide-react';
import { useStudentTags } from '@/features/students/hooks/useStudentTags.js';

export default function StudentTagsField({ value, onChange, disabled = false, description }) {
  const { tagOptions, loadingTags, tagsError, loadTags, createTag, canManageTags } = useStudentTags();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [isSavingTag, setIsSavingTag] = useState(false);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  useEffect(() => {
    // Only check if tag exists AFTER tags have finished loading
    if (loadingTags || !value) {
      return;
    }
    const exists = tagOptions.some((tag) => tag.id === value);
    if (!exists && tagOptions.length > 0) {
      // Tag was deleted from catalog but still assigned to student
      // Keep the value so user can see something is selected and choose to clear it
      console.warn(`Tag "${value}" is assigned to student but not found in catalog`);
    }
  }, [value, tagOptions, loadingTags]);

  const selectedTags = useMemo(() => {
    if (Array.isArray(value)) {
      return value.filter(Boolean);
    }
    if (typeof value === 'string' && value.trim()) {
      return [value.trim()];
    }
    return [];
  }, [value]);

  const toggleTag = useCallback((tagId) => {
    if (disabled) {
      return;
    }
    const next = new Set(selectedTags);
    if (next.has(tagId)) {
      next.delete(tagId);
    } else {
      next.add(tagId);
    }
    onChange(Array.from(next));
  }, [disabled, onChange, selectedTags]);

  const handleDialogToggle = useCallback((open) => {
    setIsDialogOpen(open);
    if (!open) {
      setNewTagName('');
      setDialogError('');
    }
  }, []);

  const handleTagNameChange = useCallback((event) => {
    setNewTagName(event.target.value);
    if (dialogError) {
      setDialogError('');
    }
  }, [dialogError]);

  const handleCreateTag = useCallback(async (event) => {
    event.preventDefault();
    const trimmed = newTagName.trim();
    if (!trimmed) {
      setDialogError('יש להזין שם תגית.');
      return;
    }

    setIsSavingTag(true);
    setDialogError('');

    try {
      const payload = await createTag(trimmed);
      const createdId = payload?.created?.id || null;
      const updated = await loadTags();
      const resolvedId = createdId || updated.find((tag) => tag.name === trimmed)?.id || '';
      if (resolvedId) {
        onChange(Array.from(new Set([...selectedTags, resolvedId])));
      }
      setIsDialogOpen(false);
      setNewTagName('');
    } catch (error) {
      console.error('Failed to create student tag', error);
      let message = error?.message || 'יצירת התגית נכשלה.';
      if (message === 'tag_already_exists') {
        message = 'תגית בשם זה כבר קיימת.';
      }
      setDialogError(message);
    } finally {
      setIsSavingTag(false);
    }
  }, [createTag, loadTags, newTagName, onChange, selectedTags]);

  const options = useMemo(() => {
    return tagOptions.map((tag) => ({ id: tag.id, name: tag.name }));
  }, [tagOptions]);

  const fieldDescription = useMemo(() => {
    if (tagsError) {
      return description || '';
    }
    if (!loadingTags && tagOptions.length === 0) {
      return 'לא קיימות תגיות זמינות. ניתן להוסיף תגית חדשה.';
    }
    return description || 'תגיות מסייעות בסינון וארגון תלמידים.';
  }, [tagsError, loadingTags, tagOptions.length, description]);

  const footer = (
    <DialogFooter>
      <Button
        type="button"
        onClick={handleCreateTag}
        disabled={isSavingTag}
        className="gap-2"
      >
        {isSavingTag && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        שמירת תגית
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => handleDialogToggle(false)}
        disabled={isSavingTag}
      >
        ביטול
      </Button>
    </DialogFooter>
  );

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <FormField
          id="student-tags"
          label="תגיות"
          description={fieldDescription}
          error={tagsError}
        >
          <div className="rounded-md border border-input bg-background px-3 py-2">
            {loadingTags ? (
              <p className="text-sm text-muted-foreground">טוען תגיות...</p>
            ) : options.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין תגיות זמינות.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {options.map((tag) => (
                  <label key={tag.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedTags.includes(tag.id)}
                      onCheckedChange={() => toggleTag(tag.id)}
                      disabled={disabled}
                    />
                    <span>{tag.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </FormField>
      </div>
      {canManageTags && (
        <Dialog open={isDialogOpen} onOpenChange={handleDialogToggle}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="mb-6"
              disabled={disabled}
              aria-label="הוספת תגית חדשה"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md" footer={footer}>
            <DialogHeader>
              <DialogTitle>הוספת תגית חדשה</DialogTitle>
              <DialogDescription>
                צרו תגית לשימוש חוזר עבור תלמידים בארגון.
              </DialogDescription>
            </DialogHeader>
            <form id="student-tag-create-form" onSubmit={handleCreateTag} className="space-y-4" dir="rtl">
              <TextField
                id="new-student-tag-name"
                name="newTagName"
                label="שם תגית"
                value={newTagName}
                onChange={handleTagNameChange}
                required
                disabled={isSavingTag}
                placeholder="לדוגמה: תלמיד חדש"
                error={dialogError}
              />
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
