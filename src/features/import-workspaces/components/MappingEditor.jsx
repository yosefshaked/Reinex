import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Save } from 'lucide-react';

const SECTION_DEFINITIONS = [
  {
    type: 'customer',
    label: 'לקוח/ה',
    description: 'יוצר לקוח/ה, ובמקרה של תלמיד/ה גם רשומת תלמיד. אפשר לצרף הערה פנימית.',
    fields: [
      { value: 'first_name', label: 'שם פרטי', required: true },
      { value: 'last_name', label: 'שם משפחה', required: true },
      { value: 'identity_number', label: 'תעודת זהות', required: true },
      { value: 'customer_type', label: 'סוג לקוח', required: true },
      { value: 'is_active', label: 'פעיל/לא פעיל', required: false },
      { value: 'phone', label: 'טלפון', required: false },
      { value: 'email', label: 'אימייל', required: false },
      { value: 'date_of_birth', label: 'תאריך לידה', required: false },
      { value: 'note_text', label: 'הערה פנימית לתלמיד/ה', required: false },
    ],
  },
  {
    type: 'guardian',
    label: 'הורה / אפוטרופוס',
    description: 'יוצר או מאתר את רשומת ההורה.',
    fields: [
      { value: 'guardian_first_name', label: 'שם פרטי של ההורה', required: true },
      { value: 'guardian_last_name', label: 'שם משפחה של ההורה', required: true },
      { value: 'guardian_phone', label: 'טלפון הורה', required: false },
      { value: 'guardian_email', label: 'אימייל הורה', required: false },
    ],
  },
  {
    type: 'guardian_link',
    label: 'חיבור הורה ללקוח/ה',
    description: 'מחבר את ההורה ללקוח/ה באמצעות תעודת זהות וטלפון ההורה.',
    fields: [
      { value: 'identity_number', label: 'תעודת זהות הלקוח/ה', required: true },
      { value: 'guardian_phone', label: 'טלפון הורה', required: true },
      { value: 'relationship', label: 'קרבה', required: false },
      { value: 'is_primary', label: 'הורה ראשי', required: false },
    ],
  },
  {
    type: 'service',
    label: 'שירות',
    description: 'יוצר או מאתר שירות לפי שמו.',
    fields: [
      { value: 'service_name', label: 'שם השירות', required: true },
      { value: 'description', label: 'תיאור', required: false },
    ],
  },
];

const SKIP_VALUE = '__skip__';

function encodeSourceField(sourceReference, column) {
  return JSON.stringify([sourceReference, column]);
}

function decodeSourceField(value, fallbackSourceReference) {
  if (!value) return null;
  if (typeof value === 'object' && value.source_reference && value.column) return value;
  // Select values are produced by encodeSourceField → JSON.stringify([sourceRef, column]).
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

function migrateFieldMap(entityType, fieldMap = {}) {
  const next = { ...fieldMap };
  if (entityType === 'guardian') {
    if (!next.guardian_first_name && next.first_name) next.guardian_first_name = next.first_name;
    if (!next.guardian_last_name && next.last_name) next.guardian_last_name = next.last_name;
    if (!next.guardian_phone && next.phone) next.guardian_phone = next.phone;
    if (!next.guardian_email && next.email) next.guardian_email = next.email;
    delete next.first_name;
    delete next.last_name;
    delete next.phone;
    delete next.email;
  }
  if (entityType === 'service' && !next.service_name && next.name) next.service_name = next.name;
  delete next.name;
  delete next.student_identity_number;
  return next;
}

function normalizeInitialEntities(initialEntities, legacyMapping) {
  const normalized = {};
  for (const section of SECTION_DEFINITIONS) {
    const configured = initialEntities?.[section.type];
    normalized[section.type] = {
      enabled: Boolean(configured?.enabled),
      field_map: migrateFieldMap(section.type, configured?.field_map || {}),
      join_columns: configured?.join_columns || {},
      fixed_values: configured?.fixed_values || {},
    };
  }
  if (legacyMapping?.entity_type && SECTION_DEFINITIONS.some((section) => section.type === legacyMapping.entity_type)) {
    normalized[legacyMapping.entity_type] = {
      enabled: true,
      field_map: migrateFieldMap(legacyMapping.entity_type, legacyMapping.field_map || {}),
      join_columns: legacyMapping.join_columns || {},
      fixed_values: legacyMapping.fixed_values || {},
    };
  }
  return normalized;
}

function SectionMapping({ section, value, sources, anchorSourceReference, onChange }) {
  const [expanded, setExpanded] = useState(value.enabled);
  const mappedSources = [...new Set(Object.values(value.field_map || {})
    .map((fieldSource) => decodeSourceField(fieldSource, anchorSourceReference)?.source_reference)
    .filter(Boolean))];
  const crossSource = mappedSources.some((sourceReference) => sourceReference !== anchorSourceReference);
  const joinSources = crossSource
    ? [...new Set([anchorSourceReference, ...mappedSources].filter(Boolean))]
    : [];

  function updateField(field, encodedValue) {
    const nextMap = { ...value.field_map };
    if (encodedValue === SKIP_VALUE) delete nextMap[field];
    else nextMap[field] = decodeSourceField(encodedValue, anchorSourceReference);
    onChange({ ...value, field_map: nextMap });
  }

  function updateFixed(field, fixedValue) {
    const next = { ...value.fixed_values };
    if (fixedValue === SKIP_VALUE) delete next[field];
    else next[field] = fixedValue;
    onChange({ ...value, fixed_values: next });
  }

  const requiredComplete = section.fields.filter((field) => field.required).every((field) => (
    value.field_map?.[field.value]
    || (value.fixed_values?.[field.value] !== undefined && value.fixed_values?.[field.value] !== '')
  ));
  const joinsComplete = joinSources.every((sourceReference) => value.join_columns?.[sourceReference]);

  return (
    <details
      className="rounded-lg border bg-background"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="cursor-pointer list-none px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Checkbox
              checked={value.enabled}
              onCheckedChange={(checked) => {
                const enabled = checked === true;
                if (enabled) setExpanded(true);
                onChange({ ...value, enabled });
              }}
              onClick={(event) => event.stopPropagation()}
              aria-label={`הפעלת מיפוי ${section.label}`}
            />
            <div>
              <p className="text-sm font-medium">{section.label}</p>
              <p className="text-xs text-muted-foreground">{section.description}</p>
            </div>
          </div>
          {value.enabled && (
            <Badge variant={requiredComplete && joinsComplete ? 'default' : 'secondary'}>
              {requiredComplete && joinsComplete ? 'מוכן' : 'דורש השלמה'}
            </Badge>
          )}
        </div>
      </summary>

      {value.enabled && (
        <div className="space-y-4 border-t p-4">
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="w-1/3 px-4 py-2 font-medium">שדה במערכת</th>
                  <th className="w-1/3 px-4 py-2 font-medium">עמודת מקור</th>
                  <th className="px-4 py-2 font-medium text-muted-foreground">דוגמה</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {section.fields.map((field) => {
                  const mapped = decodeSourceField(value.field_map?.[field.value], anchorSourceReference);
                  const mappedSource = sources.find((source) => source.sourceReference === mapped?.source_reference);
                  const sample = mapped ? mappedSource?.profile?.sampleRow?.[mapped.column] : null;
                  return (
                    <tr key={field.value}>
                      <td className="px-4 py-2">
                        <span className={cn('font-medium', field.required && 'text-foreground')}>{field.label}</span>
                        {field.required && <span className="ms-1 text-destructive">*</span>}
                      </td>
                      <td className="px-4 py-2">
                        <Select
                          value={mapped ? encodeSourceField(mapped.source_reference, mapped.column) : SKIP_VALUE}
                          onValueChange={(selected) => updateField(field.value, selected)}
                          dir="rtl"
                        >
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={SKIP_VALUE}>— לא ממופה —</SelectItem>
                            {sources.flatMap((source) => (
                              (source.headers || source.profile?.headers || []).map((column) => (
                                <SelectItem
                                  key={encodeSourceField(source.sourceReference, column)}
                                  value={encodeSourceField(source.sourceReference, column)}
                                >
                                  {source.label || source.filename || source.sourceReference} · {column}
                                </SelectItem>
                              ))
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="max-w-xs truncate px-4 py-2 text-muted-foreground">
                        {sample !== null && sample !== undefined && sample !== ''
                          ? <Badge variant="secondary" className="max-w-full truncate font-mono text-xs">{String(sample)}</Badge>
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {section.type === 'customer' && (
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">ערך קבוע לכל השורות</p>
              <div className="flex items-center gap-3">
                <span className="w-28 text-sm">סוג לקוח *</span>
                <Select value={value.fixed_values?.customer_type || SKIP_VALUE} onValueChange={(selected) => updateFixed('customer_type', selected)} dir="rtl">
                  <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SKIP_VALUE}>— נלקח מעמודה —</SelectItem>
                    <SelectItem value="student">תלמיד/ה</SelectItem>
                    <SelectItem value="one_time_customer">לקוח/ה חד-פעמי/ת</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-28 text-sm">פעיל/לא פעיל</span>
                <Select
                  value={
                    value.fixed_values?.is_active === true ? 'true'
                      : value.fixed_values?.is_active === false ? 'false'
                      : SKIP_VALUE
                  }
                  onValueChange={(selected) => updateFixed(
                    'is_active',
                    selected === SKIP_VALUE ? SKIP_VALUE : selected === 'true',
                  )}
                  dir="rtl"
                >
                  <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SKIP_VALUE}>— ברירת מחדל: פעיל —</SelectItem>
                    <SelectItem value="true">כולם פעילים</SelectItem>
                    <SelectItem value="false">כולם לא פעילים (ארכיון)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {crossSource && (
            <div className="space-y-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">חיבור בין המקורות</p>
                <p className="text-xs text-muted-foreground">בחר בכל מקור עמודה עם אותו מזהה. החיבור אינו מתבצע לפי מספר שורה.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {joinSources.map((sourceReference) => {
                  const source = sources.find((item) => item.sourceReference === sourceReference);
                  return (
                    <div key={sourceReference} className="space-y-1">
                      <span className="text-xs font-medium">{source?.label || sourceReference}</span>
                      <Select
                        value={value.join_columns?.[sourceReference] || SKIP_VALUE}
                        onValueChange={(selected) => onChange({
                          ...value,
                          join_columns: {
                            ...value.join_columns,
                            [sourceReference]: selected === SKIP_VALUE ? '' : selected,
                          },
                        })}
                        dir="rtl"
                      >
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SKIP_VALUE}>— בחר עמודת קישור —</SelectItem>
                          {(source?.headers || source?.profile?.headers || []).map((column) => (
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
        </div>
      )}
    </details>
  );
}

export function MappingEditor({
  sources = [],
  anchorSourceReference,
  initialEntities = {},
  legacyMapping = null,
  onSave,
  saving = false,
}) {
  const initialSignature = JSON.stringify({ initialEntities, legacyMapping });
  const [entities, setEntities] = useState(() => normalizeInitialEntities(initialEntities, legacyMapping));

  useEffect(() => {
    const parsed = JSON.parse(initialSignature);
    setEntities(normalizeInitialEntities(parsed.initialEntities, parsed.legacyMapping));
  }, [initialSignature]);

  const validation = useMemo(() => {
    const enabled = SECTION_DEFINITIONS.filter((section) => entities[section.type]?.enabled);
    if (enabled.length === 0) return { valid: false, message: 'יש להפעיל לפחות אזור אחד.' };
    for (const section of enabled) {
      const entity = entities[section.type];
      const requiredComplete = section.fields.filter((field) => field.required).every((field) => (
        entity.field_map?.[field.value]
        || (entity.fixed_values?.[field.value] !== undefined && entity.fixed_values?.[field.value] !== '')
      ));
      if (!requiredComplete) return { valid: false, message: `חסרים שדות חובה באזור ${section.label}.` };
      const mappedSources = [...new Set(Object.values(entity.field_map || {})
        .map((fieldSource) => decodeSourceField(fieldSource, anchorSourceReference)?.source_reference)
        .filter(Boolean))];
      const joinSources = mappedSources.some((reference) => reference !== anchorSourceReference)
        ? [...new Set([anchorSourceReference, ...mappedSources])]
        : [];
      if (!joinSources.every((reference) => entity.join_columns?.[reference])) {
        return { valid: false, message: `צריך לבחור עמודות חיבור באזור ${section.label}.` };
      }
    }
    return { valid: true, message: '' };
  }, [anchorSourceReference, entities]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {SECTION_DEFINITIONS.map((section) => (
          <SectionMapping
            key={section.type}
            section={section}
            value={entities[section.type]}
            sources={sources}
            anchorSourceReference={anchorSourceReference}
            onChange={(next) => setEntities((current) => ({ ...current, [section.type]: next }))}
          />
        ))}
      </div>
      {!validation.valid && <p className="text-xs text-muted-foreground">{validation.message}</p>}
      <div className="flex justify-end">
        <Button onClick={() => onSave?.(entities)} disabled={!validation.valid || saving} className="gap-2">
          <Save className="h-4 w-4" />
          {saving ? 'שומר…' : 'שמור והמשך'}
        </Button>
      </div>
    </div>
  );
}
