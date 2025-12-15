import React, { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar.jsx';
import { Loader2, Search, ChevronLeft, Save } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '@/lib/api-client';
import { useInstructorTypes } from '@/features/instructors/hooks/useInstructorTypes.js';
import { useInstructors } from '@/hooks/useOrgData.js';

const SAVE = { idle: 'idle', saving: 'saving', error: 'error' };

export default function ProfileEditorView({ session, orgId, canLoad }) {
  const { instructors, loadingInstructors, instructorsError, refetchInstructors } = useInstructors({
    includeInactive: true,
    orgId,
    session,
    enabled: canLoad,
  });
  const [saveState, setSaveState] = useState(SAVE.idle);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInstructor, setSelectedInstructor] = useState(null);
  const [formData, setFormData] = useState({ name: '', phone: '', notes: '' });
  const { types, loadTypes } = useInstructorTypes();

  useEffect(() => {
    if (canLoad) {
      void loadTypes();
    }
  }, [canLoad, loadTypes]);

  const handleSelectInstructor = (instructor) => {
    setSelectedInstructor(instructor);
    setFormData({
      name: instructor.name || '',
      phone: instructor.phone || '',
      notes: instructor.notes || '',
    });
  };

  const handleBack = () => {
    setSelectedInstructor(null);
    setFormData({ name: '', phone: '', notes: '' });
  };

  const handleSave = async () => {
    if (!selectedInstructor) return;
    setSaveState(SAVE.saving);
    try {
      const trimmedName = formData.name.trim() || null;
      const trimmedPhone = formData.phone.trim() || null;
      const trimmedNotes = formData.notes.trim() || null;
      
      const updates = {
        ...(trimmedName !== (selectedInstructor.name || null) && { name: trimmedName }),
        ...(trimmedPhone !== (selectedInstructor.phone || null) && { phone: trimmedPhone }),
        ...(trimmedNotes !== (selectedInstructor.notes || null) && { notes: trimmedNotes }),
      };

      if (Object.keys(updates).length === 0) {
        toast.info('לא בוצעו שינויים.');
        setSaveState(SAVE.idle);
        return;
      }

      await authenticatedFetch('instructors', {
        session,
        method: 'PUT',
        body: { org_id: orgId, instructor_id: selectedInstructor.id, ...updates },
      });
      toast.success('פרטי המדריך נשמרו בהצלחה.');
      await refetchInstructors();
      handleBack();
    } catch (err) {
      console.error('Failed to update instructor', err);
      toast.error('שמירת פרטי המדריך נכשלה.');
    } finally {
      setSaveState(SAVE.idle);
    }
  };

  const isLoading = loadingInstructors;
  const isSaving = saveState === SAVE.saving;

  // Create a Map of type IDs to type objects for quick lookup
  const instructorTypeMap = new Map(types.map(t => [t.id, t]));

  const filteredInstructors = instructors.filter((instructor) => {
    const query = searchQuery.toLowerCase();
    const name = (instructor.name || '').toLowerCase();
    const email = (instructor.email || '').toLowerCase();
    const phone = (instructor.phone || '').toLowerCase();
    const instructorTypes = Array.isArray(instructor.instructor_types) ? instructor.instructor_types : [];
    const typeNames = instructorTypes.map(id => instructorTypeMap.get(id)?.name || '').join(' ').toLowerCase();
    return name.includes(query) || email.includes(query) || phone.includes(query) || typeNames.includes(query);
  });

  const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="mr-3 text-sm text-slate-600">טוען נתונים...</span>
      </div>
    );
  }

  if (instructorsError) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        {instructorsError}
      </div>
    );
  }

  // Detail View
  if (selectedInstructor) {
    return (
      <div className="space-y-6" dir="rtl">
        <div className="flex items-center gap-3 mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="gap-2 h-10"
          >
            <ChevronLeft className="h-4 w-4" />
            חזרה לרשימה
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 p-3 sm:p-4 border rounded-lg bg-slate-50">
          <Avatar className="h-16 w-16 shrink-0">
            <AvatarFallback className="bg-blue-100 text-blue-700 text-xl">
              {getInitials(selectedInstructor.name || selectedInstructor.email)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-base sm:text-lg break-words">
              {selectedInstructor.name || selectedInstructor.email}
              {Array.isArray(selectedInstructor.instructor_types) && selectedInstructor.instructor_types.length > 0 && (() => {
                const typeNames = selectedInstructor.instructor_types
                  .map(typeId => types.find(t => t.id === typeId)?.name)
                  .filter(Boolean)
                  .join(', ');
                return typeNames ? <span className="text-muted-foreground font-normal text-sm sm:text-base"> ({typeNames})</span> : null;
              })()}
            </div>
            <div className="text-sm text-muted-foreground break-words">
              {selectedInstructor.email}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-name" className="block text-right mb-2">
              שם מלא
            </Label>
            <Input
              id="edit-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="שם המדריך"
              disabled={isSaving}
              dir="rtl"
            />
          </div>

          <div>
            <Label htmlFor="edit-phone" className="block text-right mb-2">
              מספר טלפון
            </Label>
            <Input
              id="edit-phone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="טלפון"
              disabled={isSaving}
              dir="ltr"
              className="text-right"
            />
          </div>

          <div>
            <Label htmlFor="edit-notes" className="block text-right mb-2">
              הערות
            </Label>
            <textarea
              id="edit-notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full resize-y rounded-md border p-3 text-sm"
              rows={4}
              placeholder="הערות על המדריך"
              disabled={isSaving}
              dir="rtl"
            />
          </div>

          <div className="flex justify-end pt-4">
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="gap-2 h-10 w-full sm:w-auto"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              שמור שינויים
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // List View
  return (
    <div className="space-y-4" dir="rtl">
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="חיפוש לפי שם, אימייל, טלפון או סוג..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pr-10"
          dir="rtl"
        />
      </div>

      {filteredInstructors.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">
          {searchQuery ? 'לא נמצאו תוצאות' : 'אין מדריכים להצגה'}
        </p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {filteredInstructors.map((instructor) => (
            <div
              key={instructor.id}
              className="flex items-center justify-between gap-3 sm:gap-4 p-3 sm:p-4 border rounded-lg bg-white hover:bg-slate-50 transition-colors cursor-pointer"
              onClick={() => handleSelectInstructor(instructor)}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Avatar className="h-10 w-10 shrink-0">
                  <AvatarFallback className="bg-blue-100 text-blue-700">
                    {getInitials(instructor.name || instructor.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">
                    {instructor.name || instructor.email || instructor.id}
                    {Array.isArray(instructor.instructor_types) && instructor.instructor_types.length > 0 && (() => {
                      const typeNames = instructor.instructor_types
                        .map(typeId => types.find(t => t.id === typeId)?.name)
                        .filter(Boolean)
                        .join(', ');
                      return typeNames ? <span className="text-muted-foreground font-normal"> ({typeNames})</span> : null;
                    })()}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {instructor.email || '—'}
                  </div>
                </div>
              </div>

              <ChevronLeft className="h-5 w-5 text-muted-foreground shrink-0" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
