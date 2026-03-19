import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import { DragDropContext, Draggable, Droppable } from 'react-beautiful-dnd';
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

function CanvasObjectFieldTemplate(props) {
  const { properties } = props;

  return (
    <Droppable droppableId="form-builder-fields">
      {(droppableProvided) => (
        <div
          ref={droppableProvided.innerRef}
          {...droppableProvided.droppableProps}
          className="space-y-3"
        >
          {properties.map((property, index) => {
            if (property.hidden) {
              return (
                <div key={property.name} className="hidden">
                  {property.content}
                </div>
              );
            }

            return (
              <Draggable key={property.name} draggableId={property.name} index={index}>
                {(draggableProvided, snapshot) => (
                  <div
                    ref={draggableProvided.innerRef}
                    {...draggableProvided.draggableProps}
                    className={cn(
                      'relative rounded-md transition-shadow',
                      snapshot.isDragging ? 'bg-white shadow-md' : 'bg-transparent',
                    )}
                  >
                    <button
                      type="button"
                      aria-label="גרור שדה לשינוי סדר"
                      className="absolute start-1 top-1 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                      {...draggableProvided.dragHandleProps}
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>
                    <div className="ps-8">{property.content}</div>
                  </div>
                )}
              </Draggable>
            );
          })}
          {droppableProvided.placeholder}
        </div>
      )}
    </Droppable>
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

  const handleDragEnd = useCallback((result) => {
    const { source, destination } = result;
    if (!destination) return;
    if (source.index === destination.index) return;

    updateSchema((prev) => {
      const currentOrder = getFieldOrder(prev);
      if (currentOrder.length < 2) return prev;

      const nextOrder = [...currentOrder];
      const [moved] = nextOrder.splice(source.index, 1);
      if (!moved) return prev;
      nextOrder.splice(destination.index, 0, moved);

      return {
        ...prev,
        'x-field-order': nextOrder,
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
  }, [canFetch, formId, session, activeOrgId, formSchema]);

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
    <div className="flex flex-col h-full">
      {/* ── Header bar ── */}
      <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/forms')}>
            <ArrowRight className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-base font-semibold leading-tight">{formData?.name || 'עורך טופס'}</h1>
            {formData?.version && (
              <Badge variant="outline" className="mt-0.5 text-xs">v{formData.version}</Badge>
            )}
          </div>
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

      {/* ── Two-pane layout ── */}
      <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar (Inspector / Toolbox) — appears on start side (right in RTL) */}
        <aside className="w-72 shrink-0 border-s border-border bg-surface overflow-y-auto p-4">
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
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{formData?.name || 'טופס חדש'}</CardTitle>
                {formData?.description && (
                  <p className="text-sm text-neutral-500">{formData.description}</p>
                )}
              </CardHeader>
              <CardContent>
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
      </DragDropContext>
    </div>
  );
}
