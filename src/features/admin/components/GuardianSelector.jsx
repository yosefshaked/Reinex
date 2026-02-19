import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PhoneField } from '@/components/ui/forms-ui';
import { Plus, UserCircle } from 'lucide-react';
import CreateGuardianDialog from './CreateGuardianDialog';
import { validateIsraeliPhone } from '@/components/ui/helpers/phone';

/**
 * Guardian selector component for student forms
 * Allows selecting existing guardian or creating new one
 */
export default function GuardianSelector({
  value,
  onChange,
  guardians = [],
  isLoading = false,
  disabled = false,
  onCreateGuardian,
}) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [guardianPhone, setGuardianPhone] = useState('');
  const [showNotFound, setShowNotFound] = useState(false);

  const formatRelationship = (relationship) => {
    const normalized = (relationship || '').toLowerCase();
    switch (normalized) {
      case 'father':
        return 'אב';
      case 'mother':
        return 'אם';
      case 'self':
        return 'עצמי';
      case 'caretaker':
        return 'מטפל';
      case 'other':
        return 'אחר';
      default:
        return relationship || '';
    }
  };

  const buildGuardianLabel = (guardian) => {
    const fullName = `${guardian.first_name || ''} ${guardian.last_name || ''}`.trim();
    const links = guardian.linked_students || [];
    if (!links.length) {
      return fullName;
    }

    const relationshipSet = new Set(links.map(link => formatRelationship(link.relationship)).filter(Boolean));
    const relationshipText = Array.from(relationshipSet).join('/');
    const studentNames = links
      .map(link => link.student_name)
      .filter(Boolean)
      .slice(0, 2);
    const extraCount = Math.max(0, links.length - studentNames.length);

    const metaBits = [relationshipText, studentNames.join(', ')]
      .filter(Boolean)
      .join(' · ');
    const extraText = extraCount ? ` ועוד ${extraCount}` : '';

    return `${fullName}${metaBits || extraText ? ` (${metaBits}${extraText})` : ''}`;
  };

  const selectedGuardian = guardians.find(g => g.id === value);
  const normalizedPhone = useMemo(() => String(guardianPhone || '').replace(/[\s-]/g, ''), [guardianPhone]);

  const matchingGuardian = useMemo(() => {
    if (!normalizedPhone) return null;
    return guardians.find((guardian) => {
      const guardianPhoneValue = String(guardian.phone || '').replace(/[\s-]/g, '');
      return guardianPhoneValue && guardianPhoneValue === normalizedPhone;
    }) || null;
  }, [guardians, normalizedPhone]);

  useEffect(() => {
    if (selectedGuardian?.phone) {
      setGuardianPhone(selectedGuardian.phone);
      setShowNotFound(false);
    }
  }, [selectedGuardian]);

  useEffect(() => {
    if (!normalizedPhone) {
      setShowNotFound(false);
      if (value) {
        onChange('');
      }
      return;
    }

    if (!validateIsraeliPhone(guardianPhone)) {
      setShowNotFound(false);
      return;
    }

    if (matchingGuardian) {
      if (matchingGuardian.id !== value) {
        onChange(matchingGuardian.id);
      }
      setShowNotFound(false);
    } else {
      setShowNotFound(true);
      if (value) {
        onChange('');
      }
    }
  }, [guardianPhone, matchingGuardian, normalizedPhone, onChange, value]);

  const handleCreateSuccess = (newGuardian) => {
    setShowCreateDialog(false);
    onChange(newGuardian.id);
    if (newGuardian?.phone) {
      setGuardianPhone(newGuardian.phone);
    }
    setShowNotFound(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <PhoneField
            id="guardian-phone"
            name="guardianPhone"
            label="טלפון אפוטרופוס"
            value={guardianPhone}
            onChange={(event) => setGuardianPhone(event.target.value)}
            required={false}
            disabled={disabled || isLoading}
            description={isLoading ? 'טוען אפוטרופוסים...' : 'הקלידו טלפון כדי לאתר אפוטרופוס קיים'}
          />
        </div>

        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setShowCreateDialog(true)}
          disabled={disabled}
          title="צור אפוטרופוס חדש"
          className="h-10 w-10"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {showNotFound && !isLoading ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" dir="rtl">
          אפוטרופוס לא נמצא. ניתן ליצור פרופיל חדש.
        </div>
      ) : null}

      <p className="text-sm text-muted-foreground" dir="rtl">
        אם מחובר אפוטרופוס, לא חובה להזין טלפון תלמיד
      </p>

      {selectedGuardian && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800" dir="rtl">
          <div className="flex items-start gap-2">
            <UserCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">פרטי אפוטרופוס</p>
              <p>שם: {selectedGuardian.first_name} {selectedGuardian.last_name}</p>
              {selectedGuardian.phone && <p>טלפון: {selectedGuardian.phone}</p>}
              {selectedGuardian.email && <p>אימייל: {selectedGuardian.email}</p>}
              {Array.isArray(selectedGuardian.linked_students) && selectedGuardian.linked_students.length > 0 && (
                <div>
                  <p className="font-semibold">תלמידים מקושרים</p>
                  <ul className="list-disc pr-5 space-y-0.5">
                    {selectedGuardian.linked_students.slice(0, 2).map((link, index) => (
                      <li key={`${selectedGuardian.id}-${index}`}>
                        {link.student_name || 'ללא שם'}
                        {link.relationship ? ` (${formatRelationship(link.relationship)})` : ''}
                      </li>
                    ))}
                    {selectedGuardian.linked_students.length > 2 && (
                      <li>ועוד {selectedGuardian.linked_students.length - 2} תלמידים</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <CreateGuardianDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSuccess={handleCreateSuccess}
        onCreateGuardian={onCreateGuardian}
        initialPhone={guardianPhone}
      />
    </div>
  );
}
