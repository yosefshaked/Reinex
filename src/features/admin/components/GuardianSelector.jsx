import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/forms-ui';
import { Plus, UserCircle } from 'lucide-react';
import CreateGuardianDialog from './CreateGuardianDialog';

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
  onSelectOpenChange,
}) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const guardianOptions = guardians.map(g => ({
    value: g.id,
    label: `${g.first_name} ${g.last_name}${g.phone ? ` (${g.phone})` : ''}`,
  }));

  const selectedGuardian = guardians.find(g => g.id === value);

  const handleCreateSuccess = (newGuardian) => {
    setShowCreateDialog(false);
    onChange(newGuardian.id);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <SelectField
            id="guardian-selector"
            name="guardianId"
            label="אפוטרופוס"
            value={value}
            onChange={onChange}
            onOpenChange={onSelectOpenChange}
            options={guardianOptions}
            placeholder={isLoading ? 'טוען אפוטרופוסים...' : 'בחר אפוטרופוס או השאר ריק לתלמיד עצמאי'}
            required={false}
            disabled={disabled || isLoading}
            description="אם מחוברים אפוטרופוס, לא חובה להזין טלפון תלמיד"
          />
        </div>
        
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setShowCreateDialog(true)}
          disabled={disabled}
          title="צור אפוטרופוס חדש"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {selectedGuardian && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800" dir="rtl">
          <div className="flex items-start gap-2">
            <UserCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">פרטי אפוטרופוס</p>
              <p>שם: {selectedGuardian.first_name} {selectedGuardian.last_name}</p>
              {selectedGuardian.phone && <p>טלפון: {selectedGuardian.phone}</p>}
              {selectedGuardian.email && <p>אימייל: {selectedGuardian.email}</p>}
            </div>
          </div>
        </div>
      )}

      <CreateGuardianDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSuccess={handleCreateSuccess}
        onCreateGuardian={onCreateGuardian}
      />
    </div>
  );
}
