import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Save } from 'lucide-react';

// Canonical fields per entity type
const TARGET_FIELDS_BY_ENTITY = {
  active_student: [
    { value: 'first_name',       label: 'שם פרטי',        required: true },
    { value: 'last_name',        label: 'שם משפחה',       required: true },
    { value: 'identity_number',  label: 'תעודת זהות',      required: true },
    { value: 'phone',            label: 'טלפון',           required: false },
    { value: 'email',            label: 'אימייל',          required: false },
    { value: 'date_of_birth',    label: 'תאריך לידה',      required: false },
  ],
  inactive_student: [
    { value: 'first_name',       label: 'שם פרטי',        required: true },
    { value: 'last_name',        label: 'שם משפחה',       required: true },
    { value: 'identity_number',  label: 'תעודת זהות',      required: true },
    { value: 'phone',            label: 'טלפון',           required: false },
    { value: 'email',            label: 'אימייל',          required: false },
    { value: 'date_of_birth',    label: 'תאריך לידה',      required: false },
  ],
  guardian: [
    { value: 'first_name',              label: 'שם פרטי',       required: true },
    { value: 'last_name',               label: 'שם משפחה',      required: true },
    { value: 'phone',                   label: 'טלפון',          required: false },
    { value: 'email',                   label: 'אימייל',         required: false },
    { value: 'student_identity_number', label: 'ת.ז. תלמיד/ה', required: false },
  ],
  guardian_link: [
    { value: 'student_identity_number', label: 'ת.ז. תלמיד/ה', required: true },
    { value: 'guardian_phone',           label: 'טלפון הורה',   required: true },
    { value: 'relationship',             label: 'קרבה',          required: false },
    { value: 'is_primary',               label: 'הורה ראשי',     required: false },
  ],
  service: [
    { value: 'name',        label: 'שם השירות',   required: true },
    { value: 'description', label: 'תיאור',        required: false },
  ],
  student_note: [
    { value: 'note_text',            label: 'טקסט הערה',    required: true },
    { value: 'student_identity_number', label: 'ת.ז. תלמיד/ה', required: true },
  ],
};

const ENTITY_TYPE_LABELS = {
  active_student:   'תלמיד/ה פעיל/ה',
  inactive_student: 'תלמיד/ה לא פעיל/ה',
  guardian:         'הורה / אפוטרופוס',
  guardian_link:    'קישור הורה-תלמיד',
  service:          'שירות',
  student_note:     'הערה',
};

const SKIP_VALUE = '__skip__';

/**
 * @param {{
 *   sourceColumns: string[],
 *   sampleRow?: Record<string,string>,
 *   entityType: string,
 *   initialFieldMap?: Record<string,string>,
 *   onEntityTypeChange?: (type:string)=>void,
 *   onSave?: (fieldMap: Record<string,string>) => void,
 *   saving?: boolean,
 * }} props
 */
export function MappingEditor({
  sourceColumns = [],
  sampleRow = {},
  entityType,
  initialFieldMap = {},
  onEntityTypeChange,
  onSave,
  saving = false,
}) {
  // fieldMap: targetField -> sourceColumn
  const [fieldMap, setFieldMap] = useState(() => initialFieldMap);

  const targetFields = useMemo(
    () => TARGET_FIELDS_BY_ENTITY[entityType] || [],
    [entityType],
  );

  // Reverse map: sourceColumn -> targetField (to detect conflicts)
  const usedColumns = useMemo(() => {
    const set = new Set(Object.values(fieldMap).filter(Boolean).filter(v => v !== SKIP_VALUE));
    return set;
  }, [fieldMap]);

  function handleFieldMapping(targetField, sourceColumn) {
    setFieldMap(prev => {
      const next = { ...prev };
      if (!sourceColumn || sourceColumn === SKIP_VALUE) {
        delete next[targetField];
      } else {
        next[targetField] = sourceColumn;
      }
      return next;
    });
  }

  function handleSave() {
    onSave?.(fieldMap);
  }

  const requiredMappedCount = targetFields
    .filter(f => f.required)
    .filter(f => fieldMap[f.value])
    .length;
  const requiredTotal = targetFields.filter(f => f.required).length;
  const canSave = requiredMappedCount === requiredTotal && requiredTotal > 0;

  return (
    <div className="space-y-4">
      {/* Entity type selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-muted-foreground">סוג ישות:</span>
        <Select value={entityType} onValueChange={onEntityTypeChange} dir="rtl">
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ENTITY_TYPE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground me-auto">
          {requiredMappedCount}/{requiredTotal} שדות חובה ממופים
        </span>
      </div>

      {/* Mapping table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 font-medium w-1/3">שדה מטרה</th>
              <th className="px-4 py-2 font-medium w-1/3">עמודת מקור</th>
              <th className="px-4 py-2 font-medium text-muted-foreground">דוגמה</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {targetFields.map(field => {
              const mapped = fieldMap[field.value] || '';
              const sampleValue = mapped ? sampleRow[mapped] ?? '' : '';
              return (
                <tr key={field.value} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2">
                    <span className={cn('font-medium', field.required && 'text-foreground')}>
                      {field.label}
                    </span>
                    {field.required && (
                      <span className="text-destructive ms-1" aria-label="חובה">*</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Select
                      value={mapped || SKIP_VALUE}
                      onValueChange={val => handleFieldMapping(field.value, val)}
                      dir="rtl"
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SKIP_VALUE}>
                          <span className="text-muted-foreground">— לא ממופה —</span>
                        </SelectItem>
                        {sourceColumns.map(col => (
                          <SelectItem
                            key={col}
                            value={col}
                            disabled={usedColumns.has(col) && fieldMap[field.value] !== col}
                          >
                            {col}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground truncate max-w-xs">
                    {sampleValue ? (
                      <Badge variant="secondary" className="font-mono text-xs max-w-full truncate">{sampleValue}</Badge>
                    ) : (
                      <span className="text-xs">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!canSave || saving} className="gap-2">
          <Save className="h-4 w-4" />
          {saving ? 'שומר…' : 'שמור מיפוי'}
        </Button>
      </div>
    </div>
  );
}
