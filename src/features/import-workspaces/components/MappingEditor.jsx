import { useEffect, useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Save } from 'lucide-react';

// Canonical fields per entity type
const TARGET_FIELDS_BY_ENTITY = {
  customer: [
    { value: 'first_name',      label: 'שם פרטי',        required: true },
    { value: 'last_name',       label: 'שם משפחה',       required: true },
    { value: 'identity_number', label: 'תעודת זהות',     required: true },
    { value: 'customer_type',   label: 'סוג לקוח',       required: true },
    { value: 'is_active',       label: 'פעיל/לא פעיל',   required: false },
    { value: 'phone',           label: 'טלפון',           required: false },
    { value: 'email',           label: 'אימייל',          required: false },
    { value: 'date_of_birth',   label: 'תאריך לידה',      required: false },
  ],
  active_student: [
    { value: 'first_name',       label: 'שם פרטי',        required: true },
    { value: 'last_name',        label: 'שם משפחה',       required: true },
    { value: 'identity_number',  label: 'תעודת זהות התלמיד', required: true },
    { value: 'phone',            label: 'טלפון',           required: false },
    { value: 'email',            label: 'אימייל',          required: false },
    { value: 'date_of_birth',    label: 'תאריך לידה',      required: false },
  ],
  inactive_student: [
    { value: 'first_name',       label: 'שם פרטי',        required: true },
    { value: 'last_name',        label: 'שם משפחה',       required: true },
    { value: 'identity_number',  label: 'תעודת זהות התלמיד', required: true },
    { value: 'phone',            label: 'טלפון',           required: false },
    { value: 'email',            label: 'אימייל',          required: false },
    { value: 'date_of_birth',    label: 'תאריך לידה',      required: false },
  ],
  guardian: [
    { value: 'first_name',              label: 'שם פרטי',       required: true },
    { value: 'last_name',               label: 'שם משפחה',      required: true },
    { value: 'phone',                   label: 'טלפון',          required: false },
    { value: 'email',                   label: 'אימייל',         required: false },
  ],
  guardian_link: [
    { value: 'identity_number',         label: 'תעודת זהות התלמיד', required: true },
    { value: 'guardian_phone',           label: 'טלפון הורה',   required: true },
    { value: 'relationship',             label: 'קרבה',          required: false },
    { value: 'is_primary',               label: 'הורה ראשי',     required: false },
  ],
  service: [
    { value: 'service_name', label: 'שם השירות',   required: true },
    { value: 'description', label: 'תיאור',        required: false },
  ],
  student_note: [
    { value: 'note_text',            label: 'טקסט הערה',    required: true },
    { value: 'identity_number',      label: 'תעודת זהות התלמיד', required: true },
  ],
};

const ENTITY_TYPE_LABELS = {
  customer:         'לקוח/ה',
  active_student:   'תלמיד/ה פעיל/ה',
  inactive_student: 'תלמיד/ה לא פעיל/ה',
  guardian:         'הורה / אפוטרופוס',
  guardian_link:    'קישור הורה-תלמיד',
  service:          'שירות',
  student_note:     'הערה',
};

const ENTITY_TYPE_ORDER = [
  'customer',
  'active_student',
  'inactive_student',
  'guardian',
  'guardian_link',
  'service',
  'student_note',
];

const SKIP_VALUE = '__skip__';

function encodeSourceField(sourceReference, column) {
  return JSON.stringify([sourceReference, column]);
}

function decodeSourceField(value, fallbackSourceReference) {
  if (!value) return null;
  if (typeof value === 'object' && value.source_reference && value.column) return value;
  if (typeof value === 'string' && value.startsWith('[')) {
    try {
      const [sourceReference, column] = JSON.parse(value);
      if (sourceReference && column) return { source_reference: sourceReference, column };
    } catch {
      return null;
    }
  }
  return fallbackSourceReference && typeof value === 'string'
    ? { source_reference: fallbackSourceReference, column: value }
    : null;
}

function normalizeFieldMapForEntity(entityType, fieldMap = {}) {
  const next = { ...fieldMap };
  if ((entityType === 'guardian_link' || entityType === 'student_note') && !next.identity_number && next.student_identity_number) {
    next.identity_number = next.student_identity_number;
  }
  if (entityType === 'service' && !next.service_name && next.name) {
    next.service_name = next.name;
  }
  delete next.student_identity_number;
  delete next.name;
  return next;
}

/**
 * @param {{
 *   sources?: { sourceReference:string, label?:string, headers?:string[], profile?:object }[],
 *   anchorSourceReference?: string,
 *   sampleRow?: Record<string,string>,
 *   entityType: string,
 *   initialFieldMap?: Record<string,string|{source_reference:string,column:string}>,
 *   initialJoinColumns?: Record<string,string>,
 *   onEntityTypeChange?: (type:string)=>void,
 *   onSave?: (fieldMap: Record<string,object>, joinColumns: Record<string,string>, fixedValues: Record<string,any>) => void,
 *   saving?: boolean,
 * }} props
 */
export function MappingEditor({
  sourceColumns = [],
  sources = [],
  anchorSourceReference,
  sampleRow = {},
  entityType,
  initialFieldMap = {},
  initialJoinColumns = {},
  initialFixedValues = {},
  onEntityTypeChange,
  onSave,
  saving = false,
}) {
  // fieldMap: targetField -> sourceColumn
  const [fieldMap, setFieldMap] = useState(() => normalizeFieldMapForEntity(entityType, initialFieldMap));
  const [joinColumns, setJoinColumns] = useState(initialJoinColumns);
  const [fixedValues, setFixedValues] = useState(initialFixedValues);
  const initialFieldMapSignature = JSON.stringify(initialFieldMap || {});
  const initialJoinColumnsSignature = JSON.stringify(initialJoinColumns || {});
  const initialFixedValuesSignature = JSON.stringify(initialFixedValues || {});

  const availableSources = useMemo(() => (
    sources.length > 0
      ? sources
      : [{
          sourceReference: anchorSourceReference,
          label: 'הקובץ הנוכחי',
          headers: sourceColumns,
          profile: { sampleRow },
        }]
  ), [anchorSourceReference, sampleRow, sourceColumns, sources]);

  const targetFields = useMemo(
    () => TARGET_FIELDS_BY_ENTITY[entityType] || [],
    [entityType],
  );

  useEffect(() => {
    setFieldMap(normalizeFieldMapForEntity(entityType, JSON.parse(initialFieldMapSignature)));
  }, [entityType, initialFieldMapSignature]);

  useEffect(() => {
    setJoinColumns(JSON.parse(initialJoinColumnsSignature));
  }, [initialJoinColumnsSignature]);

  useEffect(() => {
    setFixedValues(JSON.parse(initialFixedValuesSignature));
  }, [entityType, initialFixedValuesSignature]);

  function handleFieldMapping(targetField, encodedSourceField) {
    setFieldMap(prev => {
      const next = { ...prev };
      if (!encodedSourceField || encodedSourceField === SKIP_VALUE) {
        delete next[targetField];
      } else {
        next[targetField] = decodeSourceField(encodedSourceField, anchorSourceReference);
      }
      return next;
    });
  }

  function handleSave() {
    const canonicalFieldMap = {};
    for (const field of targetFields) {
      if (fieldMap[field.value]) {
        canonicalFieldMap[field.value] = fieldMap[field.value];
      }
    }
    onSave?.(canonicalFieldMap, joinColumns, fixedValues);
  }

  const mappedSourceReferences = [...new Set(Object.values(fieldMap)
    .map((value) => decodeSourceField(value, anchorSourceReference)?.source_reference)
    .filter(Boolean))];
  const isCrossSource = mappedSourceReferences.some((sourceReference) => sourceReference !== anchorSourceReference);
  const requiredJoinSources = isCrossSource
    ? [...new Set([anchorSourceReference, ...mappedSourceReferences].filter(Boolean))]
    : [];

  const requiredMappedCount = targetFields
    .filter(f => f.required)
    .filter(f => {
      if (fieldMap[f.value]) return true;
      const fv = fixedValues[f.value];
      return fv !== undefined && fv !== null && fv !== '';
    })
    .length;
  const requiredTotal = targetFields.filter(f => f.required).length;
  const joinsComplete = requiredJoinSources.every((sourceReference) => joinColumns[sourceReference]);
  const canSave = requiredMappedCount === requiredTotal && requiredTotal > 0 && joinsComplete;

  return (
    <div className="space-y-4">
      {/* Entity type selector */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <span className="text-sm font-medium">איזה חלק בקובץ ממפים עכשיו?</span>
            <p className="text-xs text-muted-foreground mt-1">
              תעודת זהות התלמיד היא אותו שדה בכל החלקים: אצל תלמיד זו הזהות שלו, ובקישור הורה או הערה היא אומרת לאיזה תלמיד לחבר את המידע.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {requiredMappedCount}/{requiredTotal} שדות חובה ממופים
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ENTITY_TYPE_ORDER.map((type) => (
            <Button
              key={type}
              type="button"
              variant={entityType === type ? 'default' : 'outline'}
              className="justify-start h-auto py-2 text-start"
              onClick={() => onEntityTypeChange?.(type)}
            >
              {ENTITY_TYPE_LABELS[type]}
            </Button>
          ))}
        </div>
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
              const mapped = decodeSourceField(fieldMap[field.value], anchorSourceReference);
              const mappedSource = availableSources.find((source) => source.sourceReference === mapped?.source_reference);
              const mappedValue = mapped ? encodeSourceField(mapped.source_reference, mapped.column) : SKIP_VALUE;
              const sampleValue = mapped ? mappedSource?.profile?.sampleRow?.[mapped.column] ?? '' : '';
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
                      value={mappedValue}
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
                        {availableSources.flatMap((source) => (
                          (source.headers || source.profile?.headers || []).map((column) => (
                            <SelectItem
                              key={encodeSourceField(source.sourceReference, column)}
                              value={encodeSourceField(source.sourceReference, column)}
                            >
                              {source.label || source.sheetName || source.filename || 'מקור'} · {column}
                            </SelectItem>
                          ))
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

      {/* Fixed values — "set all as X" (customer entity only) */}
      {entityType === 'customer' && (
        <div className="rounded-lg border p-4 space-y-3">
          <div>
            <p className="text-sm font-medium">ערכים קבועים לכל השורות</p>
            <p className="text-xs text-muted-foreground mt-1">
              שדה שאין לו עמודת מקור ייקח ערך זה. אם עמודה ממופה — הערך הממופה ינצח.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm w-24 shrink-0">
              סוג לקוח
              <span className="text-destructive ms-0.5" aria-label="חובה">*</span>
            </span>
            <Select
              value={fixedValues.customer_type || SKIP_VALUE}
              onValueChange={(v) => setFixedValues((prev) => {
                const next = { ...prev };
                if (!v || v === SKIP_VALUE) { delete next.customer_type; } else { next.customer_type = v; }
                return next;
              })}
              dir="rtl"
            >
              <SelectTrigger className="h-8 text-sm flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SKIP_VALUE}>
                  <span className="text-muted-foreground">— לא מוגדר —</span>
                </SelectItem>
                <SelectItem value="student">תלמיד/ה</SelectItem>
                <SelectItem value="one_time_customer">לקוח/ה חד-פעמי/ת</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {isCrossSource && (
        <div className="space-y-3 rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">איך מחברים בין המקורות?</p>
            <p className="mt-1 text-xs text-muted-foreground">
              בחר בכל מקור עמודה שמכילה את אותו מזהה, למשל תעודת הזהות של התלמיד. החיבור נעשה לפי הערך הזה, לעולם לא לפי מספר השורה.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {requiredJoinSources.map((sourceReference) => {
              const source = availableSources.find((item) => item.sourceReference === sourceReference);
              const headers = source?.headers || source?.profile?.headers || [];
              return (
                <div key={sourceReference} className="space-y-1.5">
                  <span className="text-xs font-medium">{source?.label || sourceReference}</span>
                  <Select
                    value={joinColumns[sourceReference] || SKIP_VALUE}
                    onValueChange={(value) => setJoinColumns((current) => ({
                      ...current,
                      [sourceReference]: value === SKIP_VALUE ? '' : value,
                    }))}
                    dir="rtl"
                  >
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SKIP_VALUE}>— בחר עמודת קישור —</SelectItem>
                      {headers.map((column) => (
                        <SelectItem key={column} value={column}>{column}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!canSave || saving} className="gap-2">
          <Save className="h-4 w-4" />
          {saving ? 'שומר…' : 'שמור מיפוי'}
        </Button>
      </div>
    </div>
  );
}
