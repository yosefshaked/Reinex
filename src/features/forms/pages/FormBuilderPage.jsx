import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowRight,
  Loader2,
  AlertCircle,
  Save,
  Type,
  Hash,
  ToggleLeft,
  List,
  AlignLeft,
  Trash2,
  ChevronRight,
  GripVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { cn } from '@/lib/utils';

// ── Field type definitions ──────────────────────────────────────
const FIELD_TYPES = [
  { type: 'text', label: 'שדה טקסט', icon: Type, schema: { type: 'string' } },
  { type: 'textarea', label: 'טקסט ארוך', icon: AlignLeft, schema: { type: 'string' }, uiWidget: 'textarea' },
  { type: 'number', label: 'מספר', icon: Hash, schema: { type: 'number' } },
  { type: 'boolean', label: 'כן / לא', icon: ToggleLeft, schema: { type: 'boolean', default: false } },
  {
    type: 'select',
    label: 'בחירה מרשימה',
    icon: List,
    schema: { type: 'string', enum: ['אפשרות 1', 'אפשרות 2'] },
  },
];

const WAITING_LIST_SYSTEM_FIELDS = [
  { key: 'student_first_name', label: 'שם פרטי של התלמיד/ה', placeholder: 'שם פרטי', type: 'text', required: true },
  { key: 'student_last_name', label: 'שם משפחה של התלמיד/ה', placeholder: 'שם משפחה', type: 'text', required: true },
  { key: 'contact_name', label: 'שם איש קשר / אפוטרופוס', placeholder: 'שם איש קשר', type: 'text', conditionalRequired: true },
  { key: 'contact_relationship', label: 'קרבה לתלמיד/ה', type: 'select', required: true, options: ['בחרו קרבה לתלמיד/ה', 'התלמיד/ה עצמו/ה', 'אם', 'אב', 'מטפל/ת', 'אחר'] },
  { key: 'identity_number', label: 'מספר זהות', placeholder: 'מספר זהות של התלמיד/ה', type: 'text', required: true },
  { key: 'phone', label: 'טלפון', placeholder: '05X-XXXXXXX', type: 'text' },
  { key: 'email', label: 'אימייל', placeholder: 'name@example.com', type: 'text' },
  { key: 'additional_services', label: 'שירותים נוספים שמעניינים אותך', type: 'multi-select-note' },
  { key: 'preferred_days', label: 'ימי זמינות מועדפים', type: 'day-selector', required: true },
  { key: 'preferred_times', label: 'טווחי שעות מועדפים', type: 'time-ranges', required: true },
  { key: 'payment_path_intent', label: 'סוג תשלום מבוקש', type: 'select', options: ['לא בטוח/ה, צריך עזרה', 'תשלום פרטי', 'דרך קופת חולים / גורם מממן'] },
  { key: 'hmo_provider_name', label: 'שם קופת החולים / הגורם המממן', placeholder: 'למשל: כללית', type: 'text', conditionalRequired: true },
  { key: 'hmo_approval_status', label: 'סטטוס אישור קופת חולים', type: 'select', conditionalRequired: true, options: ['בחרו סטטוס אישור', 'אין אישור עדיין', 'האישור יישלח בנפרד בוואטסאפ/אימייל'] },
  { key: 'notes', label: 'הערות נוספות', placeholder: 'פרטים נוספים שחשוב שנדע', type: 'textarea' },
];

// ── Helpers ──────────────────────────────────────────────────────

function generateFieldId() {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function buildEmptySchema() {
  return {
    type: 'object',
    properties: {},
    required: [],
  };
}

/** Get ordered field keys from the schema */
function getFieldOrder(schema) {
  const properties = schema?.properties || {};
  const propertyKeys = Object.keys(properties);

  if (Array.isArray(schema?.['x-field-order']) && schema['x-field-order'].length > 0) {
    const orderedExisting = schema['x-field-order'].filter((key) => propertyKeys.includes(key));
    const missing = propertyKeys.filter((key) => !orderedExisting.includes(key));
    return [...orderedExisting, ...missing];
  }

  return propertyKeys;
}

/** Build rjsf uiSchema from our formSchema metadata */
function buildUiSchema(formSchema) {
  const ui = { 'ui:order': getFieldOrder(formSchema) };
  const props = formSchema?.properties || {};
  for (const [key, fieldDef] of Object.entries(props)) {
    if (fieldDef['x-ui-widget']) {
      ui[key] = { 'ui:widget': fieldDef['x-ui-widget'] };
    }
    if (fieldDef['x-placeholder']) {
      ui[key] = { ...(ui[key] || {}), 'ui:placeholder': fieldDef['x-placeholder'] };
    }
  }
  return ui;
}

// ── Toolbox (add field buttons) ─────────────────────────────────

function Toolbox({ onAddField }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-neutral-700 mb-3">הוספת שדה</h3>
      <div className="grid grid-cols-1 gap-2">
        {FIELD_TYPES.map((ft) => (
          <Button
            key={ft.type}
            variant="outline"
            className="justify-start gap-2 h-auto py-2.5"
            onClick={() => onAddField(ft)}
          >
            <ft.icon className="h-4 w-4 text-primary shrink-0" />
            <span>{ft.label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

// ── Field Inspector (edit properties of selected field) ─────────

function FieldInspector({ fieldDef, required, onUpdate, onToggleRequired, onDelete, onDeselect }) {
  const title = fieldDef?.title || '';
  const placeholder = fieldDef?.['x-placeholder'] || '';
  const enumValues = fieldDef?.enum || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onDeselect}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <h3 className="text-sm font-semibold text-neutral-700 truncate">עריכת שדה</h3>
      </div>

      <Separator />

      <div className="space-y-2">
        <Label htmlFor="field-title">שאלה / כותרת</Label>
        <Input
          id="field-title"
          value={title}
          onChange={(e) => onUpdate({ ...fieldDef, title: e.target.value })}
          placeholder="הזן את השאלה לתלמיד"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="field-placeholder">טקסט עזר (Placeholder)</Label>
        <Input
          id="field-placeholder"
          value={placeholder}
          onChange={(e) => onUpdate({ ...fieldDef, 'x-placeholder': e.target.value || undefined })}
          placeholder="טקסט שיופיע בתוך השדה"
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="field-required">שדה חובה</Label>
        <Switch id="field-required" checked={required} onCheckedChange={onToggleRequired} />
      </div>

      {/* Enum editor for select fields */}
      {Array.isArray(fieldDef?.enum) && (
        <div className="space-y-2">
          <Label>אפשרויות בחירה</Label>
          {enumValues.map((opt, idx) => (
            <div key={idx} className="flex gap-2 items-center">
              <GripVertical className="h-4 w-4 text-neutral-300 shrink-0" />
              <Input
                value={opt}
                onChange={(e) => {
                  const updated = [...enumValues];
                  updated[idx] = e.target.value;
                  onUpdate({ ...fieldDef, enum: updated });
                }}
                placeholder={`אפשרות ${idx + 1}`}
              />
              {enumValues.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-red-500 hover:text-red-600"
                  onClick={() => {
                    const updated = enumValues.filter((_, i) => i !== idx);
                    onUpdate({ ...fieldDef, enum: updated });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => onUpdate({ ...fieldDef, enum: [...enumValues, `אפשרות ${enumValues.length + 1}`] })}
          >
            + הוסף אפשרות
          </Button>
        </div>
      )}

      <Separator />

      <Button
        variant="destructive"
        size="sm"
        className="w-full gap-2"
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4" />
        מחק שדה
      </Button>
    </div>
  );
}

// ── Canvas field wrapper (clickable overlay on each field) ───────

function CanvasFieldTemplate(props) {
  const {
    id,
    children,
    classNames,
    label,
    required,
    displayLabel,
    description,
    errors,
    help,
    hidden,
    selectedField,
    onSelectField,
  } = props;

  if (hidden) {
    return <div className="hidden">{children}</div>;
  }

  // The root-level object template has id "root" — skip wrapping it
  if (id === 'root') return children;

  // rjsf ids are like "root_field_123..." — extract the field key
  const fieldKey = id.replace(/^root_/, '');
  const isSelected = selectedField === fieldKey;

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'relative rounded-md border-2 border-transparent p-2 -m-2 transition-colors cursor-pointer',
        isSelected ? 'border-primary bg-primary/5' : 'hover:border-neutral-300 hover:bg-neutral-50',
        classNames,
      )}
      onClick={(e) => {
        e.stopPropagation();
        onSelectField(fieldKey);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectField(fieldKey);
        }
      }}
    >
      <div className="space-y-1">
        {displayLabel && label ? (
          <label htmlFor={id} className="text-sm font-medium text-neutral-900">
            {label}
            {required ? <span className="ms-1 text-red-500">*</span> : null}
          </label>
        ) : null}
        {description}
        {children}
        {errors}
        {help}
      </div>
    </div>
  );
}

function SortableCanvasField({ property }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: property.name,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'relative rounded-md transition-shadow',
        isDragging ? 'bg-white shadow-md' : 'bg-transparent',
      )}
    >
      <button
        type="button"
        aria-label="גרור שדה לשינוי סדר"
        className="absolute start-1 top-1 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="ps-8">{property.content}</div>
    </div>
  );
}

function CanvasObjectFieldTemplate(props) {
  const { properties } = props;
  const sortableIds = properties.filter((property) => !property.hidden).map((property) => property.name);

  return (
    <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
      <div className="space-y-3">
        {properties.map((property) => {
          if (property.hidden) {
            return (
              <div key={property.name} className="hidden">
                {property.content}
              </div>
            );
          }

          return <SortableCanvasField key={property.name} property={property} />;
        })}
      </div>
    </SortableContext>
  );
}

function WaitingListIntakePreview() {
  const renderFieldLabel = (field) => (
    <>
      {field.label}
      {field.required ? <span className="ms-1 text-red-500">*</span> : null}
      {field.conditionalRequired ? <span className="ms-1 text-amber-500">*</span> : null}
    </>
  );

  const findField = (key) => WAITING_LIST_SYSTEM_FIELDS.find((field) => field.key === key);
  const studentFields = ['student_first_name', 'student_last_name', 'identity_number', 'contact_relationship', 'contact_name'].map(findField).filter(Boolean);
  const contactFields = ['phone', 'email'].map(findField).filter(Boolean);
  const fundingFields = ['payment_path_intent', 'hmo_provider_name', 'hmo_approval_status', 'notes'].map(findField).filter(Boolean);
  const additionalServicesField = findField('additional_services');
  const preferredDaysField = findField('preferred_days');
  const preferredTimesField = findField('preferred_times');

  const renderBasicField = (field, options = {}) => {
    if (!field) return null;

    if (field.type === 'select') {
      return (
        <div key={field.key} className="space-y-2">
          <Label className="text-slate-700">{renderFieldLabel(field)}</Label>
          <Select disabled value="">
            <SelectTrigger className="bg-white/80 text-slate-400">
              <SelectValue placeholder={field.options?.[0] || 'בחרו אפשרות'} />
            </SelectTrigger>
            <SelectContent>
              {(field.options || []).slice(1).map((option) => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {options.helpText ? <p className="text-xs text-slate-400">{options.helpText}</p> : null}
        </div>
      );
    }

    if (field.type === 'textarea') {
      return (
        <div key={field.key} className="space-y-2">
          <Label className="text-slate-700">{renderFieldLabel(field)}</Label>
          <Textarea disabled rows={4} placeholder={field.placeholder} className="bg-white/80 text-slate-500 placeholder:text-slate-400" />
        </div>
      );
    }

    return (
      <div key={field.key} className="space-y-2">
        <Label className="text-slate-700">{renderFieldLabel(field)}</Label>
        <Input disabled placeholder={field.placeholder} className="bg-white/80 text-slate-500 placeholder:text-slate-400" />
      </div>
    );
  };

  return (
    <div className="mb-6 rounded-xl border border-dashed border-slate-300 bg-slate-100/70 p-4 opacity-70">
      <div className="mb-4 space-y-1">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-slate-300 text-slate-600">מערכת</Badge>
          <h3 className="text-sm font-semibold text-slate-700">שאלות קבועות לטופס רשימת המתנה</h3>
        </div>
        <p className="text-xs text-slate-500">
          השדות האלה מוצגים תמיד בטופס הציבורי וממופים אוטומטית לפרופיל המתעניין ולרשומת ההמתנה. אי אפשר לערוך אותם דרך הבונה.
        </p>
        <p className="text-xs text-slate-400">
          <span className="text-red-500">*</span> שדה חובה קבוע, <span className="text-amber-500">*</span> שדה חובה מותנה בהתאם לבחירה בטופס.
        </p>
      </div>

      <div className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-white/80 p-3">
          <p className="text-sm font-medium text-slate-700">שירות מבוקש</p>
          <p className="mt-1 text-xs text-slate-500">מוצג מהשירות שנבחר בזמן שליחת הקישור, לא מהבונה.</p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 space-y-1">
            <h4 className="text-sm font-semibold text-slate-900">פרטי תלמיד/ה</h4>
            <p className="text-xs text-slate-500">אותו מבנה שיופיע ללקוח/ה בטופס הציבורי.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {studentFields
              .filter((field) => field.key !== 'contact_name')
              .map((field) => renderBasicField(field, field.key === 'contact_relationship'
                ? { helpText: 'שם איש הקשר מוצג רק אחרי בחירת קרבה שאינה "התלמיד/ה עצמו/ה".' }
                : {}))}
          </div>
          <div className="mt-4 opacity-75">
            {renderBasicField(findField('contact_name'))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 space-y-1">
            <h4 className="text-sm font-semibold text-slate-900">פרטי התקשרות</h4>
            <p className="text-xs text-slate-500">פרטים ליצירת קשר לאחר שליחת הטופס.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {contactFields.map((field) => renderBasicField(field))}
          </div>
        </div>

        {additionalServicesField ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 space-y-1">
              <h4 className="text-sm font-semibold text-slate-900">שירותים נוספים</h4>
              <p className="text-xs text-slate-500">החלק הזה מופיע רק אם השולח מאפשר לבקש שירותים נוספים.</p>
            </div>
            <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              {['שירות נוסף א׳', 'שירות נוסף ב׳'].map((label) => (
                <label key={label} className="flex items-center gap-3 rounded-xl bg-white px-3 py-3 text-sm text-slate-500 shadow-sm">
                  <Checkbox disabled />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 space-y-1">
            <h4 className="text-sm font-semibold text-slate-900">זמינות מועדפת</h4>
            <p className="text-xs text-slate-500">נדרש לבחור לפחות יום אחד ולהגדיר עבורו טווח שעות מלא.</p>
          </div>
          {preferredDaysField ? (
            <div className="space-y-2">
              <Label className="text-slate-700">{renderFieldLabel(preferredDaysField)}</Label>
              <div className="flex flex-wrap gap-2">
                {['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'].map((day) => (
                  <Button key={day} type="button" variant="outline" disabled className="border-slate-300 bg-white text-slate-500">
                    {day}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          {preferredTimesField ? (
            <div className="mt-4 space-y-2">
              <Label className="text-slate-700">{renderFieldLabel(preferredTimesField)}</Label>
              <div className="rounded-lg border border-slate-200 bg-white/80 p-3">
                <div className="mb-2 text-sm font-medium text-slate-600">יום לדוגמה</div>
                <div className="flex items-center gap-2">
                  <Input type="time" disabled value="09:00" className="bg-slate-50 text-slate-500" />
                  <span className="text-sm text-slate-400">עד</span>
                  <Input type="time" disabled value="12:00" className="bg-slate-50 text-slate-500" />
                  <Button type="button" variant="outline" disabled>הסר</Button>
                </div>
                <div className="mt-2">
                  <Button type="button" variant="outline" disabled>הוסף טווח</Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 space-y-1">
            <h4 className="text-sm font-semibold text-slate-900">פרטי מימון</h4>
            <p className="text-xs text-slate-500">שדות ה-HMO מופיעים רק אם נבחר מסלול תשלום דרך קופת חולים / גורם מממן.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {fundingFields
              .filter((field) => !['hmo_provider_name', 'hmo_approval_status', 'notes'].includes(field.key))
              .map((field) => renderBasicField(field, field.key === 'payment_path_intent'
                ? { helpText: 'בחירת HMO תציג גם את שם הקופה וגם את סטטוס האישור.' }
                : {}))}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 opacity-75">
            {renderBasicField(findField('hmo_provider_name'))}
            {renderBasicField(findField('hmo_approval_status'))}
          </div>
          <div className="mt-4">
            {renderBasicField(findField('notes'))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page Component ─────────────────────────────────────────

export default function FormBuilderPage() {
  const { formId } = useParams();
  const navigate = useNavigate();
  const { activeOrgId, activeOrgHasConnection, tenantClientReady } = useOrg();
  const { session } = useSupabase();

  const [formData, setFormData] = useState(null);
  const [formSchema, setFormSchema] = useState(buildEmptySchema);
  const [selectedField, setSelectedField] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [formUsage, setFormUsage] = useState('general');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const canFetch = Boolean(session && activeOrgId && tenantClientReady && activeOrgHasConnection);

  // ── Load form ───────────────────────────────────────────────
  const loadForm = useCallback(async () => {
    if (!canFetch || !formId) return;
    setLoading(true);
    setError('');
    try {
      const data = await authenticatedFetch(`forms/${formId}`, {
        session,
        params: { org_id: activeOrgId },
      });
      setFormData(data);
      setFormUsage(data?.form_usage === 'waiting_list_intake' ? 'waiting_list_intake' : 'general');
      const schema = data?.form_schema && typeof data.form_schema === 'object' && data.form_schema.type
        ? data.form_schema
        : buildEmptySchema();
      setFormSchema(schema);
    } catch (err) {
      console.error('Failed to load form', err);
      setError(err?.message || 'שגיאה בטעינת הטופס');
    } finally {
      setLoading(false);
    }
  }, [canFetch, formId, session, activeOrgId]);

  useEffect(() => {
    if (canFetch) void loadForm();
  }, [canFetch, loadForm]);

  // ── Schema mutation helpers ─────────────────────────────────
  const updateSchema = useCallback((updater) => {
    setFormSchema((prev) => {
      const next = updater(prev);
      return next;
    });
    setDirty(true);
  }, []);

  const addField = useCallback((fieldType) => {
    const key = generateFieldId();
    updateSchema((prev) => {
      const properties = { ...prev.properties };
      const schemaDef = { ...fieldType.schema, title: fieldType.label };
      if (fieldType.uiWidget) schemaDef['x-ui-widget'] = fieldType.uiWidget;
      properties[key] = schemaDef;
      const order = [...getFieldOrder(prev), key];
      return { ...prev, properties, 'x-field-order': order };
    });
    setSelectedField(key);
  }, [updateSchema]);

  const updateField = useCallback((key, fieldDef) => {
    updateSchema((prev) => ({
      ...prev,
      properties: { ...prev.properties, [key]: fieldDef },
    }));
  }, [updateSchema]);

  const toggleFieldRequired = useCallback((key) => {
    updateSchema((prev) => {
      const required = Array.isArray(prev.required) ? [...prev.required] : [];
      const idx = required.indexOf(key);
      if (idx >= 0) required.splice(idx, 1);
      else required.push(key);
      return { ...prev, required };
    });
  }, [updateSchema]);

  const deleteField = useCallback((key) => {
    updateSchema((prev) => {
      const properties = { ...prev.properties };
      delete properties[key];
      const required = (prev.required || []).filter((r) => r !== key);
      const order = getFieldOrder(prev).filter((k) => k !== key);
      return { ...prev, properties, required, 'x-field-order': order };
    });
    setSelectedField(null);
  }, [updateSchema]);

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    updateSchema((prev) => {
      const currentOrder = getFieldOrder(prev);
      if (currentOrder.length < 2) return prev;

      const oldIndex = currentOrder.indexOf(String(active.id));
      const newIndex = currentOrder.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return prev;

      return {
        ...prev,
        'x-field-order': arrayMove(currentOrder, oldIndex, newIndex),
      };
    });
  }, [updateSchema]);

  // ── Save ────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!canFetch || !formId) return;
    setSaving(true);
    try {
      const resp = await authenticatedFetch(`forms/${formId}`, {
        session,
        method: 'PUT',
        body: {
          org_id: activeOrgId,
          form_usage: formUsage,
          form_schema: formSchema,
        },
      });
      setFormData(resp);
      setDirty(false);
      toast.success('הטופס נשמר בהצלחה');
    } catch (err) {
      console.error('Failed to save form', err);
      toast.error(err?.message || 'שגיאה בשמירת הטופס');
    } finally {
      setSaving(false);
    }
  }, [canFetch, formId, session, activeOrgId, formSchema, formUsage]);

  // ── Build rjsf props ───────────────────────────────────────
  const uiSchema = useMemo(() => buildUiSchema(formSchema), [formSchema]);
  const fieldOrder = useMemo(() => getFieldOrder(formSchema), [formSchema]);
  const hasFields = fieldOrder.length > 0;
  const selectedDef = selectedField ? formSchema?.properties?.[selectedField] : null;
  const selectedRequired = selectedField ? (formSchema?.required || []).includes(selectedField) : false;

  // Custom FieldTemplate that wraps each field with click handling
  const fieldTemplateProps = useMemo(
    () => ({ selectedField, onSelectField: setSelectedField }),
    [selectedField],
  );
  const CustomFieldTemplate = useCallback(
    (props) => <CanvasFieldTemplate {...props} {...fieldTemplateProps} />,
    [fieldTemplateProps],
  );

  // ── Render ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        <span className="ms-2 text-sm text-neutral-500">טוען טופס...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <AlertCircle className="h-8 w-8 text-red-500" />
        <p className="text-sm text-red-600">{error}</p>
        <Button variant="outline" size="sm" onClick={loadForm}>נסה שוב</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-neutral-50">
      {/* ── Header bar ── */}
      <div className="flex items-center justify-between border-b border-border bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/forms')}>
            <ArrowRight className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-base font-semibold leading-tight">{formData?.name || 'עורך טופס'}</h1>
            <div className="mt-0.5 flex items-center gap-2">
              {formData?.version && (
                <Badge variant="outline" className="text-xs">v{formData.version}</Badge>
              )}
              <Badge variant={formUsage === 'waiting_list_intake' ? 'default' : 'secondary'} className="text-xs">
                {formUsage === 'waiting_list_intake' ? 'רשימת המתנה' : 'כללי'}
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="min-w-48">
            <Select
              value={formUsage}
              onValueChange={(value) => {
                setFormUsage(value);
                setDirty(true);
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="general">טופס כללי</SelectItem>
                <SelectItem value="waiting_list_intake">טופס רשימת המתנה</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            className="gap-2"
            disabled={saving || !dirty}
            onClick={handleSave}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            שמור שינויים
          </Button>
        </div>
      </div>

      {/* ── Two-pane layout ── */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar (Inspector / Toolbox) — appears on start side (right in RTL) */}
        <aside className="w-72 shrink-0 overflow-y-auto border-s border-border bg-white p-4">
          {selectedField && selectedDef ? (
            <FieldInspector
              fieldKey={selectedField}
              fieldDef={selectedDef}
              required={selectedRequired}
              onUpdate={(def) => updateField(selectedField, def)}
              onToggleRequired={() => toggleFieldRequired(selectedField)}
              onDelete={() => deleteField(selectedField)}
              onDeselect={() => setSelectedField(null)}
            />
          ) : (
            <Toolbox onAddField={addField} />
          )}
        </aside>

        {/* Canvas (live preview) */}
        <main
          className="flex-1 overflow-y-auto bg-neutral-50 p-6"
          onClick={() => setSelectedField(null)}
        >
          <div className="mx-auto max-w-2xl">
            <Card className="overflow-hidden border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100 bg-white">
                <CardTitle className="text-lg">{formData?.name || 'טופס חדש'}</CardTitle>
                {formData?.description && (
                  <p className="text-sm text-neutral-500">{formData.description}</p>
                )}
              </CardHeader>
              <CardContent className="bg-slate-50/50 pt-6">
                {formUsage === 'waiting_list_intake' && <WaitingListIntakePreview />}
                {hasFields ? (
                  <Form
                    schema={formSchema}
                    uiSchema={uiSchema}
                    validator={validator}
                    templates={{
                      FieldTemplate: CustomFieldTemplate,
                      ObjectFieldTemplate: CanvasObjectFieldTemplate,
                    }}
                    // Prevent actual submissions — this is a builder preview
                    onSubmit={(e) => e.preventDefault?.()}
                    // Suppress the default submit button
                    children={<span />}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Type className="h-10 w-10 text-neutral-300 mb-3" />
                    <p className="text-sm text-neutral-500 mb-1">הטופס ריק</p>
                    <p className="text-xs text-neutral-400">בחר סוג שדה מהתפריט כדי להתחיל לבנות את הטופס</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
      </DndContext>
    </div>
  );
}
