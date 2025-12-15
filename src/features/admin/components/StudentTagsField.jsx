import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { SelectField, TextField } from '@/components/ui/forms-ui';
import { Loader2, Plus } from 'lucide-react';
import { useStudentTags } from '@/features/students/hooks/useStudentTags.js';

const NONE_VALUE = '__none__';

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

  const handleSelectChange = useCallback((nextValue) => {
    onChange(nextValue === NONE_VALUE ? '' : nextValue);
  }, [onChange]);

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
        onChange(resolvedId);
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
  }, [createTag, loadTags, newTagName, onChange]);

  const options = useMemo(() => {
    const base = tagOptions.map((tag) => ({ value: tag.id, label: tag.name }));
    
    // Only show "deleted tag" if tags have finished loading and tag is still not found
    if (!loadingTags && value && value !== NONE_VALUE && !tagOptions.some((tag) => tag.id === value)) {
      base.push({ value, label: `${value.slice(0, 8)}... (תגית שנמחקה)` });
    }
    
    return [
      { value: NONE_VALUE, label: 'ללא תגית' },
      ...base,
    ];
  }, [tagOptions, value, loadingTags]);

  const placeholder = loadingTags ? 'טוען תגיות...' : 'בחר תגית';
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
        <SelectField
          id="student-tags"
          label="תגיות"
          value={value || NONE_VALUE}
          onChange={handleSelectChange}
          options={options}
          placeholder={placeholder}
          disabled={disabled || loadingTags}
          description={fieldDescription}
          error={tagsError}
        />
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
