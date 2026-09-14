import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Save } from 'lucide-react';
import { getEntityMappedSources, inferEntityAnchorSource } from '../lib/importMapping.js';

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
      { value: 'source_system', label: 'מערכת מקור', required: false },
      { value: 'source_service_id', label: 'מזהה שירות במקור', required: false },
      { value: 'duration_minutes', label: 'משך בדקות', required: true },
      { value: 'description', label: 'תיאור', required: false },
    ],
  },
  {
    type: 'instructor',
    label: 'מדריך/ה',
    description: 'יוצר מדריך/ה ללא חשבון משתמש, או מקשר למדריך/ה קיים/ת.',
    fields: [
      { value: 'source_system', label: 'מערכת מקור', required: true },
      { value: 'source_instructor_id', label: 'מזהה מדריך במקור', required: true },
      { value: 'first_name', label: 'שם פרטי', required: true },
      { value: 'middle_name', label: 'שם אמצעי', required: false },
      { value: 'last_name', label: 'שם משפחה', required: false },
      { value: 'is_active', label: 'פעיל/לא פעיל', required: false },
    ],
  },
  {
    type: 'lesson',
    label: 'מפגש',
    description: 'יוצר מפגש מקושר למדריך ולשירות. מפגשי עבר מוחרגים מרשימת הדיווחים הממתינים.',
    fields: [
      { value: 'source_system', label: 'מערכת מקור', required: true },
      { value: 'source_lesson_id', label: 'מזהה מפגש במקור', required: true },
      { value: 'datetime_start', label: 'מועד מלא עם אזור זמן', required: true },
      { value: 'source_instructor_id', label: 'מזהה מדריך במקור', required: true },
      { value: 'service_name', label: 'שם השירות', required: true },
      { value: 'lesson_status', label: 'סטטוס מפגש', required: true },
      { value: 'duration_minutes', label: 'משך בדקות (אם חסר בשירות)', required: false },
      { value: 'legacy_note', label: 'הערת מקור', required: false },
    ],
  },
  {
    type: 'lesson_participant',
    label: 'משתתף/ת במפגש',
    description: 'מקשר לקוח/ה מזוהה למפגש באמצעות מזהה המפגש ותעודת הזהות.',
    fields: [
      { value: 'source_system', label: 'מערכת מקור', required: true },
      { value: 'source_lesson_id', label: 'מזהה מפגש במקור', required: true },
      { value: 'identity_number', label: 'תעודת זהות', required: true },
      { value: 'participant_status', label: 'סטטוס השתתפות', required: true },
      { value: 'legacy_attendance_note', label: 'הערת נוכחות במקור', required: false },
      { value: 'status_inference', label: 'מקור הצעת הסטטוס', required: false },
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
      fixed_values: configured?.fixed_values || {},
    };
  }
  if (legacyMapping?.entity_type && SECTION_DEFINITIONS.some((section) => section.type === legacyMapping.entity_type)) {
    normalized[legacyMapping.entity_type] = {
      enabled: true,
      field_map: migrateFieldMap(legacyMapping.entity_type, legacyMapping.field_map || {}),
      fixed_values: legacyMapping.fixed_values || {},
    };
  }
  return normalized;
}

function normalizeInitialJoin(initialJoin = {}) {
  return Object.fromEntries(
    Object.entries(initialJoin || {}).filter(([, column]) => column),
  );
}

function sectionUsesCrossSource(sectionType, entity) {
  const anchorSourceReference = inferEntityAnchorSource(sectionType, entity);
  if (!anchorSourceReference) return false;
  return getEntityMappedSources(entity).some((sourceReference) => sourceReference !== anchorSourceReference);
}

function requiredJoinSourcesForEntities(entities) {
  const required = new Set();
  for (const [entityType, entity] of Object.entries(entities || {})) {
    if (!entity?.enabled) continue;
    const anchorSourceReference = inferEntityAnchorSource(entityType, entity);
    if (!anchorSourceReference) continue;
    const mappedSources = getEntityMappedSources(entity);
    if (!mappedSources.some((sourceReference) => sourceReference !== anchorSourceReference)) continue;
    required.add(anchorSourceReference);
    mappedSources.forEach((sourceReference) => required.add(sourceReference));
  }
  return required;
}

function SectionMapping({ section, value, sources, onChange }) {
  const [expanded, setExpanded] = useState(value.enabled);
  const crossSource = sectionUsesCrossSource(section.type, value);

  function updateField(field, encodedValue) {
    const nextMap = { ...value.field_map };
    if (encodedValue === SKIP_VALUE) delete nextMap[field];
    else nextMap[field] = decodeSourceField(encodedValue);
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
            <Badge variant={requiredComplete ? 'default' : 'secondary'}>
              {requiredComplete ? (crossSource ? 'מוכן · חוצה קבצים' : 'מוכן') : 'דורש השלמה'}
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
                  const mapped = decodeSourceField(value.field_map?.[field.value]);
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
        </div>
      )}
    </details>
  );
}

function WorkspaceJoinSection({ sources, join, requiredSources, onChange }) {
  if (sources.length < 2) return null;
  const requiresJoin = requiredSources.size > 0;
  return (
    <div className={cn(
      'space-y-3 rounded-lg border p-4',
      requiresJoin && 'border-primary/40 bg-primary/5',
    )}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">חיבור בין הקבצים</p>
          <p className="text-xs text-muted-foreground">
            בחר בכל קובץ עמודה שמחזיקה את אותו מזהה משותף, למשל תעודת זהות תלמיד או מזהה תלמיד במערכת הקודמת.
          </p>
        </div>
        {requiresJoin && <Badge variant="secondary">נדרש</Badge>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {sources.map((source) => {
          const required = requiredSources.has(source.sourceReference);
          return (
            <div key={source.sourceReference} className="space-y-1">
              <span className="text-xs font-medium">
                {source.label || source.sheetName || source.filename || source.sourceReference}
                {required && <span className="ms-1 text-destructive">*</span>}
              </span>
              <Select
                value={join[source.sourceReference] || SKIP_VALUE}
                onValueChange={(selected) => onChange({
                  ...join,
                  [source.sourceReference]: selected === SKIP_VALUE ? '' : selected,
                })}
                dir="rtl"
              >
                <SelectTrigger className={cn('h-8', required && !join[source.sourceReference] && 'border-destructive')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SKIP_VALUE}>— בחר עמודת חיבור —</SelectItem>
                  {(source.headers || source.profile?.headers || []).map((column) => (
                    <SelectItem key={column} value={column}>{column}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MappingEditor({
  sources = [],
  initialEntities = {},
  initialJoin = {},
  legacyMapping = null,
  onSave,
  saving = false,
}) {
  const initialSignature = JSON.stringify({ initialEntities, initialJoin, legacyMapping });
  const [entities, setEntities] = useState(() => normalizeInitialEntities(initialEntities, legacyMapping));
  const [join, setJoin] = useState(() => normalizeInitialJoin(initialJoin));

  useEffect(() => {
    const parsed = JSON.parse(initialSignature);
    setEntities(normalizeInitialEntities(parsed.initialEntities, parsed.legacyMapping));
    setJoin(normalizeInitialJoin(parsed.initialJoin));
  }, [initialSignature]);

  const requiredJoinSources = useMemo(() => requiredJoinSourcesForEntities(entities), [entities]);

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
    }
    if (![...requiredJoinSources].every((reference) => join[reference])) {
      return { valid: false, message: 'צריך לבחור עמודות חיבור בין הקבצים.' };
    }
    return { valid: true, message: '' };
  }, [entities, join, requiredJoinSources]);

  return (
    <div className="space-y-4">
      <WorkspaceJoinSection
        sources={sources}
        join={join}
        requiredSources={requiredJoinSources}
        onChange={setJoin}
      />
      <div className="space-y-2">
        {SECTION_DEFINITIONS.map((section) => (
          <SectionMapping
            key={section.type}
            section={section}
            value={entities[section.type]}
            sources={sources}
            onChange={(next) => setEntities((current) => ({ ...current, [section.type]: next }))}
          />
        ))}
      </div>
      {!validation.valid && <p className="text-xs text-muted-foreground">{validation.message}</p>}
      <div className="flex justify-end">
        <Button onClick={() => onSave?.(entities, join)} disabled={!validation.valid || saving} className="gap-2">
          <Save className="h-4 w-4" />
          {saving ? 'שומר…' : 'שמור והמשך'}
        </Button>
      </div>
    </div>
  );
}
