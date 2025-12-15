import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

const FIELD_LABELS = {
  name: 'שם',
  national_id: 'תעודת זהות',
  contact_name: 'שם איש קשר',
  contact_phone: 'טלפון איש קשר',
  assigned_instructor_id: 'מדריך משויך',
  default_service: 'שירות ברירת מחדל',
  default_day_of_week: 'יום קבוע',
  default_session_time: 'שעה קבועה',
  notes: 'הערות',
  tags: 'תוויות',
  is_active: 'סטטוס',
};

const DAY_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function formatFieldValue(field, value, instructors = []) {
  if (value === null || value === undefined) {
    return <span className="text-neutral-400 italic">ריק</span>;
  }

  if (field === 'assigned_instructor_id') {
    const instructor = instructors.find(i => i.id === value);
    if (instructor) {
      return `${instructor.name || instructor.email}`;
    }
    return value;
  }

  if (field === 'default_day_of_week') {
    const dayNum = parseInt(value, 10);
    return !isNaN(dayNum) && dayNum >= 0 && dayNum <= 6 ? DAY_LABELS[dayNum] : value;
  }

  if (field === 'default_session_time') {
    // Normalize time display to HH:MM format (strip timezone if present)
    if (typeof value === 'string') {
      // Handle formats like "16:00", "16:00:00", "16:00:00+00", etc.
      const timeOnly = value.split('+')[0].split('Z')[0];
      const parts = timeOnly.split(':');
      return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : value;
    }
    return value;
  }

  if (field === 'is_active') {
    return value === true || value === 'true' ? 'פעיל' : 'לא פעיל';
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : <span className="text-neutral-400 italic">ריק</span>;
  }

  if (typeof value === 'string' && value.trim() === '') {
    return <span className="text-neutral-400 italic">ריק</span>;
  }

  return String(value);
}

function ChangeRow({ field, oldValue, newValue, instructors }) {
  const fieldLabel = FIELD_LABELS[field] || field;
  const formattedOld = formatFieldValue(field, oldValue, instructors);
  const formattedNew = formatFieldValue(field, newValue, instructors);

  return (
    <div className="grid grid-cols-[auto_1fr_1fr] gap-3 py-2 text-sm" dir="rtl">
      <div className="font-semibold text-neutral-700 min-w-[120px]">{fieldLabel}:</div>
      <div className="text-neutral-600">
        <div className="flex items-center gap-2">
          <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
          <span className="line-through">{formattedOld}</span>
        </div>
      </div>
      <div className="text-neutral-900">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
          <span className="font-medium">{formattedNew}</span>
        </div>
      </div>
    </div>
  );
}

function StudentPreviewCard({ preview, selected, onToggle, instructors }) {
  const [expanded, setExpanded] = useState(false);
  const changeCount = Object.keys(preview.changes || {}).length;
  const hasChanges = preview.has_changes !== false && changeCount > 0;

  if (!hasChanges) {
    return null; // Don't show students with no changes
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
      <div className="flex items-center gap-3 p-3 bg-neutral-50 hover:bg-neutral-100 transition-colors">
        <Checkbox
          id={`preview-${preview.student_id}`}
          checked={selected}
          onCheckedChange={onToggle}
          className="flex-shrink-0"
        />
        <Label
          htmlFor={`preview-${preview.student_id}`}
          className="flex-1 cursor-pointer text-right"
          dir="rtl"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1">
              <div className="font-semibold text-neutral-900">{preview.name}</div>
              <div className="text-xs text-neutral-500">שורה {preview.line_number}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-1 rounded">
                {changeCount} שינויים
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  setExpanded(!expanded);
                }}
                className="p-1 h-auto"
              >
                {expanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </Label>
      </div>

      {expanded && (
        <div className="p-3 border-t border-neutral-200 space-y-1">
          {Object.entries(preview.changes || {}).map(([field, { old: oldValue, new: newValue }]) => (
            <ChangeRow
              key={field}
              field={field}
              oldValue={oldValue}
              newValue={newValue}
              instructors={instructors}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DataMaintenancePreview({
  previews = [],
  failures = [],
  instructors = [],
  onConfirm,
  onCancel,
  isApplying = false,
}) {
  const [selectedIds, setSelectedIds] = useState(() => {
    return new Set(previews.filter(p => p.has_changes !== false).map(p => p.student_id));
  });

  const previewsWithChanges = useMemo(() => {
    return previews.filter(p => p.has_changes !== false && Object.keys(p.changes || {}).length > 0);
  }, [previews]);

  const selectedCount = selectedIds.size;
  const allSelected = selectedCount === previewsWithChanges.length && previewsWithChanges.length > 0;
  const someSelected = selectedCount > 0 && selectedCount < previewsWithChanges.length;

  const handleToggle = (studentId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  };

  const handleToggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(previewsWithChanges.map(p => p.student_id)));
    }
  };

  const handleConfirm = () => {
    const excludedIds = previewsWithChanges
      .filter(p => !selectedIds.has(p.student_id))
      .map(p => p.student_id);
    
    onConfirm(excludedIds);
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Summary Stats */}
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-neutral-900">סה"כ שורות:</span>
            <span>{previews.length}</span>
          </div>
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 className="h-4 w-4" />
            <span className="font-semibold">לעדכון:</span>
            <span>{previewsWithChanges.length}</span>
          </div>
          {failures.length > 0 && (
            <div className="flex items-center gap-2 text-red-700">
              <XCircle className="h-4 w-4" />
              <span className="font-semibold">כשלים:</span>
              <span>{failures.length}</span>
            </div>
          )}
        </div>
      </div>

      {/* Selection Controls */}
      {previewsWithChanges.length > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-neutral-200 bg-white">
          <Checkbox
            id="select-all"
            checked={allSelected}
            indeterminate={someSelected}
            onCheckedChange={handleToggleAll}
          />
          <Label htmlFor="select-all" className="flex-1 cursor-pointer text-right font-medium">
            בחר הכל ({selectedCount} מתוך {previewsWithChanges.length})
          </Label>
        </div>
      )}

      {/* Preview List */}
      {previewsWithChanges.length > 0 ? (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {previewsWithChanges.map((preview) => (
            <StudentPreviewCard
              key={preview.student_id}
              preview={preview}
              selected={selectedIds.has(preview.student_id)}
              onToggle={() => handleToggle(preview.student_id)}
              instructors={instructors}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-neutral-500">
          <AlertCircle className="h-12 w-12 mx-auto mb-2 text-neutral-400" />
          <p>לא נמצאו שינויים לעדכון</p>
        </div>
      )}

      {/* Failures */}
      {failures.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
            <XCircle className="h-4 w-4" />
            שורות שנכשלו ({failures.length})
          </div>
          <Separator className="bg-red-200" />
          <ul className="space-y-2 text-sm text-red-700 max-h-40 overflow-y-auto">
            {failures.map((entry, index) => (
              <li key={`${entry.student_id || index}-${entry.code || index}`} className="rounded-md bg-red-100 p-2">
                <div className="font-semibold">
                  {entry.name ? `${entry.name} (שורה ${entry.line_number})` : `שורה ${entry.line_number}`}
                </div>
                <div>{entry.message || 'השורה נכשלה בעדכון.'}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2 justify-end pt-4 border-t">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isApplying}
        >
          ביטול
        </Button>
        <Button
          type="button"
          onClick={handleConfirm}
          disabled={isApplying || selectedCount === 0}
          className="gap-2"
        >
          {isApplying ? 'מעדכן...' : `אשר ועדכן (${selectedCount})`}
        </Button>
      </div>
    </div>
  );
}
