import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertCircle, ArrowRight, Eye, GripVertical, Layers3, Loader2, Plus, Save, Send, Trash2 } from 'lucide-react';
import PageLayout from '@/components/ui/PageLayout.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import SectionedFormRenderer from '@/features/forms/components/SectionedFormRenderer.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import {
  buildInitialAnswers,
  createQuestion,
  createSection,
  getAvailableSourceQuestions,
  getQuestionsInOrder,
  getWaitingListBuiltInQuestions,
  normalizeAlertRules,
  normalizeFormSchema,
  normalizeVisibilityRules,
  QUESTION_TYPE_DEFINITIONS,
} from '@/features/forms/lib/form-schema.js';
import { cn } from '@/lib/utils';

const RULE_OPERATORS = [
  { value: 'equals', label: 'שווה ל' },
  { value: 'not_equals', label: 'לא שווה ל' },
  { value: 'includes', label: 'מכיל' },
  { value: 'not_includes', label: 'לא מכיל' },
  { value: 'is_true', label: 'מסומן ככן' },
  { value: 'is_false', label: 'מסומן כלא' },
  { value: 'is_empty', label: 'ריק' },
  { value: 'is_not_empty', label: 'לא ריק' },
];
const ALERT_SEVERITIES = ['low', 'medium', 'high'];

function buildWaitingListEvaluationAnswers(previewAnswers) {
  return {
    ...previewAnswers,
    wl_student_first_name: previewAnswers.wl_student_first_name ?? '',
    wl_student_last_name: previewAnswers.wl_student_last_name ?? '',
    wl_identity_number: previewAnswers.wl_identity_number ?? '',
    wl_contact_relationship: previewAnswers.wl_contact_relationship ?? '',
    wl_contact_name: previewAnswers.wl_contact_name ?? '',
    wl_phone: previewAnswers.wl_phone ?? '',
    wl_email: previewAnswers.wl_email ?? '',
    wl_additional_service_ids: Array.isArray(previewAnswers.wl_additional_service_ids) ? previewAnswers.wl_additional_service_ids : [],
    wl_preferred_days: Array.isArray(previewAnswers.wl_preferred_days) ? previewAnswers.wl_preferred_days : [],
    wl_payment_path_intent: previewAnswers.wl_payment_path_intent ?? '',
    wl_hmo_provider_name: previewAnswers.wl_hmo_provider_name ?? '',
    wl_hmo_approval_status: previewAnswers.wl_hmo_approval_status ?? '',
    wl_notes: previewAnswers.wl_notes ?? '',
  };
}

function WaitingListBuiltInPreview({ answers, onAnswersChange, readOnly = false }) {
  const update = (key, value) => onAnswersChange?.({ ...answers, [key]: value });
  const builtInQuestions = getWaitingListBuiltInQuestions();
  const relationshipQuestion = builtInQuestions.find((item) => item.id === 'wl_contact_relationship');
  const paymentQuestion = builtInQuestions.find((item) => item.id === 'wl_payment_path_intent');
  const approvalQuestion = builtInQuestions.find((item) => item.id === 'wl_hmo_approval_status');
  const selectedRelationship = answers?.wl_contact_relationship || '';
  const selectedPaymentPath = answers?.wl_payment_path_intent || '';

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        <div className="flex items-center gap-2">
          <Badge variant="outline">קבוע</Badge>
          <span className="text-sm font-semibold text-slate-700">חלק מערכת לטופס רשימת המתנה</span>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
          <h4 className="mb-3 text-sm font-semibold text-slate-900">פרטי תלמיד/ה</h4>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input disabled={readOnly} value={answers?.wl_student_first_name || ''} onChange={(event) => update('wl_student_first_name', event.target.value)} placeholder="שם פרטי של התלמיד/ה" />
            <Input disabled={readOnly} value={answers?.wl_student_last_name || ''} onChange={(event) => update('wl_student_last_name', event.target.value)} placeholder="שם משפחה של התלמיד/ה" />
            <Input disabled={readOnly} value={answers?.wl_identity_number || ''} onChange={(event) => update('wl_identity_number', event.target.value)} placeholder="מספר זהות" />
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
          <h4 className="mb-3 text-sm font-semibold text-slate-900">פרטי התקשרות</h4>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Select value={selectedRelationship} onValueChange={(value) => update('wl_contact_relationship', value)} disabled={readOnly}>
              <SelectTrigger><SelectValue placeholder={relationshipQuestion?.label || 'מי איש הקשר'} /></SelectTrigger>
              <SelectContent>{(relationshipQuestion?.options || []).map((option) => <SelectItem key={String(option.value)} value={String(option.value)}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
            {selectedRelationship && selectedRelationship !== 'self' ? (
              <Input disabled={readOnly} value={answers?.wl_contact_name || ''} onChange={(event) => update('wl_contact_name', event.target.value)} placeholder="שם איש הקשר / האפוטרופוס" />
            ) : <div className="rounded-2xl border border-dashed border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-400">שם איש קשר יוצג אם נבחרת קרבה שאינה התלמיד/ה עצמו/ה</div>}
            <Input disabled={readOnly} value={answers?.wl_phone || ''} onChange={(event) => update('wl_phone', event.target.value)} placeholder="טלפון" />
            <Input disabled={readOnly} value={answers?.wl_email || ''} onChange={(event) => update('wl_email', event.target.value)} placeholder="אימייל" />
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
          <h4 className="mb-3 text-sm font-semibold text-slate-900">שירותים נוספים וזמינות</h4>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input disabled={readOnly} value={Array.isArray(answers?.wl_additional_service_ids) ? answers.wl_additional_service_ids.join(', ') : ''} onChange={(event) => update('wl_additional_service_ids', event.target.value ? event.target.value.split(',').map((item) => item.trim()).filter(Boolean) : [])} placeholder="שירותים נוספים (להדמיה)" />
            <Input disabled={readOnly} value={Array.isArray(answers?.wl_preferred_days) ? answers.wl_preferred_days.join(', ') : ''} onChange={(event) => update('wl_preferred_days', event.target.value ? event.target.value.split(',').map((item) => item.trim()).filter(Boolean) : [])} placeholder="ימים מועדפים (להדמיה)" />
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
          <h4 className="mb-3 text-sm font-semibold text-slate-900">פרטי מימון</h4>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Select value={selectedPaymentPath} onValueChange={(value) => update('wl_payment_path_intent', value)} disabled={readOnly}>
              <SelectTrigger><SelectValue placeholder={paymentQuestion?.label || 'מסלול מימון'} /></SelectTrigger>
              <SelectContent>{(paymentQuestion?.options || []).map((option) => <SelectItem key={String(option.value)} value={String(option.value)}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
            {selectedPaymentPath === 'hmo' ? (
              <>
                <Input disabled={readOnly} value={answers?.wl_hmo_provider_name || ''} onChange={(event) => update('wl_hmo_provider_name', event.target.value)} placeholder="שם קופת חולים / גורם מממן" />
                <Select value={answers?.wl_hmo_approval_status || ''} onValueChange={(value) => update('wl_hmo_approval_status', value)} disabled={readOnly}>
                  <SelectTrigger><SelectValue placeholder={approvalQuestion?.label || 'סטטוס אישור'} /></SelectTrigger>
                  <SelectContent>{(approvalQuestion?.options || []).map((option) => <SelectItem key={String(option.value)} value={String(option.value)}>{option.label}</SelectItem>)}</SelectContent>
                </Select>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-400 md:col-span-2">שדות קופת חולים יוצגו רק כאשר מסלול המימון הוא דרך קופת חולים / גורם מממן</div>
            )}
            <Textarea disabled={readOnly} rows={3} value={answers?.wl_notes || ''} onChange={(event) => update('wl_notes', event.target.value)} placeholder="הערות נוספות" className="md:col-span-2" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SortableCard({ id, selected, onSelect, title, subtitle, badges, children }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('rounded-3xl border bg-white p-4 shadow-sm', selected ? 'border-primary/40 ring-2 ring-primary/10' : 'border-slate-200')}
      onClick={onSelect}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:text-slate-700" {...attributes} {...listeners}>
              <GripVertical className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold text-slate-900">{title}</span>
            {badges}
          </div>
          {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

function createRule(questionId = '') {
  return { id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, source_question_id: questionId, operator: 'equals', value: '' };
}

function createRuleGroup(targetType, targetId) {
  return { id: `group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, target_type: targetType, target_id: targetId, mode: 'all', rules: [createRule()] };
}

function emptyPublishedVersion(metadata, fallbackVersion) {
  const publishedVersion = Number(metadata?.published_version);
  return Number.isFinite(publishedVersion) && publishedVersion > 0 ? publishedVersion : fallbackVersion;
}

function getQuestionOptions(question) {
  if (question.type === 'yes_no') {
    return [{ value: true, label: 'כן' }, { value: false, label: 'לא' }];
  }
  return Array.isArray(question.options) ? question.options : [];
}

export default function FormBuilderPage() {
  const navigate = useNavigate();
  const { formId = '' } = useParams();
  const { session } = useSupabase();
  const { activeOrgId } = useOrg();
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('edit');
  const [formName, setFormName] = useState('');
  const [description, setDescription] = useState('');
  const [formUsage, setFormUsage] = useState('general');
  const [schema, setSchema] = useState(normalizeFormSchema({}));
  const [visibilityRules, setVisibilityRules] = useState([]);
  const [alertRules, setAlertRules] = useState([]);
  const [selected, setSelected] = useState({ type: 'section', id: '' });
  const [previewAnswers, setPreviewAnswers] = useState({});
  const [version, setVersion] = useState(1);
  const [publishedVersion, setPublishedVersion] = useState(1);
  const [lastSavedAt, setLastSavedAt] = useState('');
  const [publishedAt, setPublishedAt] = useState('');

  const canLoad = Boolean(session && activeOrgId && formId);

  const loadForm = useCallback(async () => {
    if (!canLoad) return;
    setLoading(true);
    setError('');
    try {
      const data = await authenticatedFetch(`forms/${formId}`, { session, params: { org_id: activeOrgId } });
      const normalizedSchema = normalizeFormSchema(data?.form_schema || {});
      setFormName(String(data?.name || ''));
      setDescription(String(data?.description || ''));
      setFormUsage(String(data?.form_usage || 'general'));
      setSchema(normalizedSchema);
      setVisibilityRules(normalizeVisibilityRules(data?.visibility_rules));
      setAlertRules(normalizeAlertRules(data?.alert_rules));
      setVersion(Number(data?.version || 1));
      setPublishedVersion(emptyPublishedVersion(data?.metadata, Number(data?.version || 1)));
      setLastSavedAt(String(data?.metadata?.draft_saved_at || data?.updated_at || ''));
      setPublishedAt(String(data?.metadata?.published_at || data?.published_at || ''));
      setPreviewAnswers(buildInitialAnswers(normalizedSchema));
      setSelected({ type: 'section', id: normalizedSchema.sections[0]?.id || '' });
    } catch (loadError) {
      console.error('Failed to load form', loadError);
      setError(loadError?.message || 'טעינת הטופס נכשלה');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, canLoad, formId, session]);

  useEffect(() => {
    void loadForm();
  }, [loadForm]);

  const selectedSection = useMemo(() => schema.sections.find((section) => section.id === selected.id) || null, [schema.sections, selected.id]);
  const selectedQuestion = useMemo(() => getQuestionsInOrder(schema).find((question) => question.id === selected.id) || null, [schema, selected.id]);
  const availableSources = useMemo(
    () => getAvailableSourceQuestions(schema, selected.type, selected.id, { formUsage }),
    [formUsage, schema, selected],
  );
  const selectedGroups = useMemo(
    () => visibilityRules.filter((group) => group.target_type === selected.type && group.target_id === selected.id),
    [selected, visibilityRules],
  );

  const updateSchema = (updater) => setSchema((prev) => normalizeFormSchema(typeof updater === 'function' ? updater(prev) : updater));
  const addSection = () => updateSchema((prev) => {
    const nextSection = createSection();
    setSelected({ type: 'section', id: nextSection.id });
    return { ...prev, sections: [...prev.sections, nextSection] };
  });
  const addQuestion = (type) => updateSchema((prev) => {
    const targetSectionId = selected.type === 'section' ? selected.id : selectedQuestion?.section_id || prev.sections[0]?.id;
    const nextQuestion = createQuestion(type);
    setSelected({ type: 'question', id: nextQuestion.id });
    return { ...prev, sections: prev.sections.map((section) => section.id === targetSectionId ? { ...section, questions: [...section.questions, nextQuestion] } : section) };
  });

  useEffect(() => {
    setPreviewAnswers((prev) => ({ ...buildInitialAnswers(schema), ...prev }));
  }, [schema]);
  const previewEvaluationAnswers = useMemo(
    () => (formUsage === 'waiting_list_intake' ? buildWaitingListEvaluationAnswers(previewAnswers) : previewAnswers),
    [formUsage, previewAnswers],
  );

  const persistForm = async (publish = false) => {
    const actionLabel = publish ? 'publishing' : 'saving';
    if (publish) setPublishing(true); else setSaving(true);
    try {
      const payload = await authenticatedFetch(`forms/${formId}`, {
        method: 'PUT',
        session,
        body: {
          org_id: activeOrgId,
          name: formName,
          description,
          form_usage: formUsage,
          form_schema: schema,
          visibility_rules: visibilityRules,
          alert_rules: alertRules,
          action: publish ? 'publish' : 'save_draft',
          publish,
        },
      });
      setVersion(Number(payload?.version || version));
      setPublishedVersion(emptyPublishedVersion(payload?.metadata, Number(payload?.version || version)));
      setLastSavedAt(String(payload?.metadata?.draft_saved_at || payload?.updated_at || new Date().toISOString()));
      setPublishedAt(String(payload?.metadata?.published_at || payload?.published_at || publishedAt));
      toast.success(publish ? 'הטופס פורסם' : 'טיוטת הטופס נשמרה');
    } catch (saveError) {
      console.error(`Failed ${actionLabel} form`, saveError);
      toast.error(saveError?.message || (publish ? 'פרסום הטופס נכשל' : 'שמירת הטופס נכשלה'));
    } finally {
      if (publish) setPublishing(false); else setSaving(false);
    }
  };

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    updateSchema((prev) => {
      const [activeKind, activeId] = String(active.id).split(':');
      const [overKind, overId] = String(over.id).split(':');
      if (activeKind === 'section' && overKind === 'section') {
        const ids = prev.sections.map((section) => section.id);
        return { ...prev, sections: arrayMove(prev.sections, ids.indexOf(activeId), ids.indexOf(overId)) };
      }
      if (activeKind === 'question' && overKind === 'question') {
        const nextSections = prev.sections.map((section) => ({ ...section, questions: [...section.questions] }));
        let sourceIndex = -1;
        let sourceSectionIndex = -1;
        let targetIndex = -1;
        let targetSectionIndex = -1;
        nextSections.forEach((section, index) => {
          const activeIndex = section.questions.findIndex((question) => question.id === activeId);
          const overIndex = section.questions.findIndex((question) => question.id === overId);
          if (activeIndex >= 0) { sourceSectionIndex = index; sourceIndex = activeIndex; }
          if (overIndex >= 0) { targetSectionIndex = index; targetIndex = overIndex; }
        });
        if (sourceSectionIndex < 0 || targetSectionIndex < 0) return prev;
        const [movedQuestion] = nextSections[sourceSectionIndex].questions.splice(sourceIndex, 1);
        nextSections[targetSectionIndex].questions.splice(targetIndex, 0, movedQuestion);
        return { ...prev, sections: nextSections };
      }
      return prev;
    });
  };

  const updateVisibilityGroup = (groupId, updater) => setVisibilityRules((prev) => prev.map((group) => group.id === groupId ? updater(group) : group));
  const updateAlertRule = (questionId, option, enabled, severity = 'medium', note = '') => setAlertRules((prev) => {
    const existing = prev.find((rule) => rule.question_id === questionId && String(rule.value) === String(option.value));
    if (enabled && existing) return prev.map((rule) => rule.id === existing.id ? { ...rule, severity, note } : rule);
    if (enabled) return [...prev, { id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, question_id: questionId, value: option.value, severity, note }];
    return prev.filter((rule) => !(rule.question_id === questionId && String(rule.value) === String(option.value)));
  });

  if (loading) {
    return <PageLayout title="בונה הטפסים"><Card><CardContent className="flex items-center justify-center gap-2 p-16"><Loader2 className="h-5 w-5 animate-spin" /><span>טוען טופס...</span></CardContent></Card></PageLayout>;
  }

  return (
    <PageLayout
      title="בונה הטפסים"
      description="עריכת סעיפים, שאלות, תנאי חשיפה, דגלים אדומים ופרסום טופס"
      actions={<div className="flex items-center gap-2"><Button variant="outline" className="gap-2" onClick={() => navigate('/forms')}><ArrowRight className="h-4 w-4" />חזרה לרשימה</Button><Button variant="outline" className="gap-2" onClick={() => navigate(`/forms/${formId}/preview`)}><Eye className="h-4 w-4" />תצוגה מלאה</Button><Button className="gap-2" variant="outline" disabled={saving || publishing} onClick={() => void persistForm(false)}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}שמור טיוטה</Button><Button className="gap-2" disabled={saving || publishing} onClick={() => void persistForm(true)}>{publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}פרסם</Button></div>}
    >
      {error ? <Alert className="mb-4"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert> : null}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
        <Card className="xl:sticky xl:top-4 xl:h-fit"><CardContent className="space-y-4 p-4"><div className="space-y-2"><Label>מצב</Label><Tabs value={mode} onValueChange={setMode}><TabsList className="grid w-full grid-cols-2"><TabsTrigger value="edit">עריכה</TabsTrigger><TabsTrigger value="preview">תצוגה</TabsTrigger></TabsList></Tabs></div><Separator /><div className="space-y-2"><Label>פרטי טופס</Label><Input value={formName} onChange={(event) => setFormName(event.target.value)} placeholder="שם הטופס" /><Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="תיאור קצר" rows={3} /><Select value={formUsage} onValueChange={setFormUsage}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="general">טופס כללי</SelectItem><SelectItem value="waiting_list_intake">טופס רשימת המתנה</SelectItem></SelectContent></Select><div className="flex flex-wrap gap-2 text-xs text-slate-500"><Badge variant="outline">טיוטה v{version}</Badge><Badge variant="outline">פורסם v{publishedVersion}</Badge>{lastSavedAt ? <Badge variant="outline">נשמר {new Date(lastSavedAt).toLocaleString('he-IL')}</Badge> : null}{publishedAt ? <Badge variant="outline">פורסם {new Date(publishedAt).toLocaleDateString('he-IL')}</Badge> : null}</div></div><Separator /><div className="space-y-2"><Button className="w-full gap-2" variant="outline" onClick={addSection}><Layers3 className="h-4 w-4" />הוסף סעיף</Button><div className="grid grid-cols-1 gap-2">{QUESTION_TYPE_DEFINITIONS.map((definition) => <Button key={definition.type} variant="ghost" className="justify-start rounded-xl border border-slate-200" onClick={() => addQuestion(definition.type)}><Plus className="me-2 h-4 w-4" />{definition.label}</Button>)}</div></div></CardContent></Card>
        <div className="space-y-4">
          {formUsage === 'waiting_list_intake' ? <WaitingListBuiltInPreview answers={previewAnswers} onAnswersChange={setPreviewAnswers} readOnly={mode !== 'preview'} /> : null}
          {mode === 'preview' ? (
            <SectionedFormRenderer
              schema={schema}
              visibilityRules={visibilityRules}
              answers={previewAnswers}
              evaluationAnswers={previewEvaluationAnswers}
              onAnswersChange={setPreviewAnswers}
            />
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={schema.sections.map((section) => `section:${section.id}`)} strategy={verticalListSortingStrategy}>
                {schema.sections.map((section) => (
                  <SortableCard key={section.id} id={`section:${section.id}`} selected={selected.type === 'section' && selected.id === section.id} onSelect={() => setSelected({ type: 'section', id: section.id })} title={section.title} subtitle={section.description} badges={<Badge variant="outline">{section.questions.length} שאלות</Badge>}>
                    <SortableContext items={section.questions.map((question) => `question:${question.id}`)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-3">
                        {section.questions.map((question) => (
                          <SortableCard
                            key={question.id}
                            id={`question:${question.id}`}
                            selected={selected.type === 'question' && selected.id === question.id}
                            onSelect={() => setSelected({ type: 'question', id: question.id })}
                            title={question.label}
                            subtitle={question.description}
                            badges={<div className="flex flex-wrap gap-1"><Badge variant="secondary">{QUESTION_TYPE_DEFINITIONS.find((item) => item.type === question.type)?.label || 'שאלה'}</Badge>{question.required ? <Badge variant="outline" className="text-red-600">חובה</Badge> : null}{visibilityRules.some((group) => group.target_type === 'question' && group.target_id === question.id) ? <Badge variant="outline">מותנה</Badge> : null}{alertRules.some((rule) => rule.question_id === question.id) ? <Badge variant="outline">דגלים</Badge> : null}</div>}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </SortableCard>
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>
        <Card className="xl:sticky xl:top-4 xl:h-fit"><CardContent className="space-y-4 p-4">{selected.type === 'section' && selectedSection ? <><div className="space-y-2"><Label>שם הסעיף</Label><Input value={selectedSection.title} onChange={(event) => updateSchema((prev) => ({ ...prev, sections: prev.sections.map((section) => section.id === selectedSection.id ? { ...section, title: event.target.value } : section) }))} /></div><div className="space-y-2"><Label>תיאור</Label><Textarea rows={3} value={selectedSection.description} onChange={(event) => updateSchema((prev) => ({ ...prev, sections: prev.sections.map((section) => section.id === selectedSection.id ? { ...section, description: event.target.value } : section) }))} /></div><Button variant="destructive" className="w-full gap-2" disabled={schema.sections.length === 1} onClick={() => updateSchema((prev) => ({ ...prev, sections: prev.sections.filter((section) => section.id !== selectedSection.id) }))}><Trash2 className="h-4 w-4" />מחק סעיף</Button></> : null}
          {selected.type === 'question' && selectedQuestion ? <><div className="space-y-2"><Label>כותרת שאלה</Label><Input value={selectedQuestion.label} onChange={(event) => updateSchema((prev) => ({ ...prev, sections: prev.sections.map((section) => ({ ...section, questions: section.questions.map((question) => question.id === selectedQuestion.id ? { ...question, label: event.target.value } : question) })) }))} /></div><div className="space-y-2"><Label>תיאור / הסבר</Label><Textarea rows={3} value={selectedQuestion.description || ''} onChange={(event) => updateSchema((prev) => ({ ...prev, sections: prev.sections.map((section) => ({ ...section, questions: section.questions.map((question) => question.id === selectedQuestion.id ? { ...question, description: event.target.value } : question) })) }))} /></div><div className="space-y-2"><Label>סוג שאלה</Label><Select value={selectedQuestion.type} onValueChange={(value) => updateSchema((prev) => ({ ...prev, sections: prev.sections.map((section) => ({ ...section, questions: section.questions.map((question) => question.id === selectedQuestion.id ? { ...question, type: value, options: createQuestion(value).options } : question) })) }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{QUESTION_TYPE_DEFINITIONS.map((definition) => <SelectItem key={definition.type} value={definition.type}>{definition.label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Placeholder</Label><Input value={selectedQuestion.placeholder || ''} onChange={(event) => updateSchema((prev) => ({ ...prev, sections: prev.sections.map((section) => ({ ...section, questions: section.questions.map((question) => question.id === selectedQuestion.id ? { ...question, placeholder: event.target.value } : question) })) }))} /></div><div className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3"><div><p className="text-sm font-medium">שדה חובה</p><p className="text-xs text-slate-500">הלקוח לא יוכל לשלוח בלי לענות</p></div><Switch checked={selectedQuestion.required} onCheckedChange={(checked) => updateSchema((prev) => ({ ...prev, sections: prev.sections.map((section) => ({ ...section, questions: section.questions.map((question) => question.id === selectedQuestion.id ? { ...question, required: checked } : question) })) }))} /></div>{['single_select', 'multi_select', 'approval'].includes(selectedQuestion.type) ? <div className="space-y-2"><Label>אפשרויות</Label>{getQuestionOptions(selectedQuestion).map((option, index) => <div key={`${selectedQuestion.id}_${index}`} className="flex items-center gap-2"><Input value={option.label} onChange={(event) => updateSchema((prev) => ({ ...prev, sections: prev.sections.map((section) => ({ ...section, questions: section.questions.map((question) => question.id === selectedQuestion.id ? { ...question, options: getQuestionOptions(question).map((currentOption, optionIndex) => optionIndex === index ? { ...currentOption, label: event.target.value, value: question.type === 'approval' ? true : event.target.value } : currentOption) } : question) })) }))} /><Button variant="outline" size="icon" onClick={() => updateSchema((prev) => ({ ...prev, sections: prev.sections.map((section) => ({ ...section, questions: section.questions.map((question) => question.id === selectedQuestion.id ? { ...question, options: getQuestionOptions(question).filter((_, optionIndex) => optionIndex !== index) } : question) })) }))}><Trash2 className="h-4 w-4" /></Button></div>)}{selectedQuestion.type !== 'approval' ? <Button variant="outline" className="w-full" onClick={() => updateSchema((prev) => ({ ...prev, sections: prev.sections.map((section) => ({ ...section, questions: section.questions.map((question) => question.id === selectedQuestion.id ? { ...question, options: [...getQuestionOptions(question), { value: `אפשרות ${getQuestionOptions(question).length + 1}`, label: `אפשרות ${getQuestionOptions(question).length + 1}` }] } : question) })) }))}>הוסף אפשרות</Button> : null}</div> : null}<Button variant="destructive" className="w-full gap-2" onClick={() => updateSchema((prev) => ({ ...prev, sections: prev.sections.map((section) => ({ ...section, questions: section.questions.filter((question) => question.id !== selectedQuestion.id) })) }))}><Trash2 className="h-4 w-4" />מחק שאלה</Button></> : null}
          <Separator />
          {selected.id ? <div className="space-y-3"><div className="flex items-center justify-between"><div><h4 className="text-sm font-semibold text-slate-900">תנאי חשיפה</h4><p className="text-xs text-slate-500">הצג פריט זה רק כאשר תשובות קודמות עומדות בתנאים.</p></div><Button variant="outline" size="sm" onClick={() => setVisibilityRules((prev) => [...prev, createRuleGroup(selected.type, selected.id)])}>הוסף קבוצה</Button></div>{selectedGroups.length === 0 ? <p className="text-xs text-slate-500">אין תנאי חשיפה. הפריט יוצג תמיד.</p> : selectedGroups.map((group) => <div key={group.id} className="rounded-2xl border border-slate-200 p-3"><div className="mb-2 flex items-center justify-between"><Select value={group.mode} onValueChange={(value) => updateVisibilityGroup(group.id, (current) => ({ ...current, mode: value }))}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">כל התנאים</SelectItem><SelectItem value="any">לפחות תנאי אחד</SelectItem></SelectContent></Select><Button variant="ghost" size="icon" onClick={() => setVisibilityRules((prev) => prev.filter((item) => item.id !== group.id))}><Trash2 className="h-4 w-4" /></Button></div><div className="space-y-2">{group.rules.map((rule) => { const sourceQuestion = availableSources.find((question) => question.id === rule.source_question_id); const options = sourceQuestion ? getQuestionOptions(sourceQuestion) : []; const operatorNeedsValue = !['is_true', 'is_false', 'is_empty', 'is_not_empty'].includes(rule.operator); return <div key={rule.id} className="space-y-2 rounded-2xl bg-slate-50 p-3"><Select value={rule.source_question_id} onValueChange={(value) => updateVisibilityGroup(group.id, (current) => ({ ...current, rules: current.rules.map((item) => item.id === rule.id ? { ...item, source_question_id: value } : item) }))}><SelectTrigger><SelectValue placeholder="שאלת מקור" /></SelectTrigger><SelectContent>{availableSources.map((question) => <SelectItem key={question.id} value={question.id}>{question.label}</SelectItem>)}</SelectContent></Select><Select value={rule.operator} onValueChange={(value) => updateVisibilityGroup(group.id, (current) => ({ ...current, rules: current.rules.map((item) => item.id === rule.id ? { ...item, operator: value } : item) }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{RULE_OPERATORS.map((operator) => <SelectItem key={operator.value} value={operator.value}>{operator.label}</SelectItem>)}</SelectContent></Select>{operatorNeedsValue ? options.length > 0 ? <Select value={String(rule.value ?? '')} onValueChange={(value) => updateVisibilityGroup(group.id, (current) => ({ ...current, rules: current.rules.map((item) => item.id === rule.id ? { ...item, value: sourceQuestion?.type === 'yes_no' ? value === 'true' : value } : item) }))}><SelectTrigger><SelectValue placeholder="ערך" /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={String(option.value)} value={String(option.value)}>{option.label}</SelectItem>)}</SelectContent></Select> : <Input value={String(rule.value ?? '')} onChange={(event) => updateVisibilityGroup(group.id, (current) => ({ ...current, rules: current.rules.map((item) => item.id === rule.id ? { ...item, value: event.target.value } : item) }))} placeholder="ערך להשוואה" /> : null}<div className="flex justify-end"><Button variant="ghost" size="sm" onClick={() => updateVisibilityGroup(group.id, (current) => ({ ...current, rules: current.rules.filter((item) => item.id !== rule.id) }))}>מחק תנאי</Button></div></div>; })}</div><Button variant="outline" className="mt-2 w-full" onClick={() => updateVisibilityGroup(group.id, (current) => ({ ...current, rules: [...current.rules, createRule(availableSources[0]?.id || '')] }))}>הוסף תנאי</Button></div>)}</div> : null}
          {selectedQuestion && ['single_select', 'multi_select', 'yes_no'].includes(selectedQuestion.type) ? <><Separator /><div className="space-y-3"><h4 className="text-sm font-semibold text-slate-900">דגלים אדומים</h4>{getQuestionOptions(selectedQuestion).map((option) => { const existingRule = alertRules.find((rule) => rule.question_id === selectedQuestion.id && String(rule.value) === String(option.value)); return <div key={`${selectedQuestion.id}_${String(option.value)}`} className="space-y-2 rounded-2xl border border-slate-200 p-3"><div className="flex items-center justify-between"><div><p className="text-sm font-medium">{option.label}</p><p className="text-xs text-slate-500">סימון תשובה זו כרגישה קלינית / תפעולית.</p></div><Checkbox checked={Boolean(existingRule)} onCheckedChange={(checked) => updateAlertRule(selectedQuestion.id, option, checked === true, existingRule?.severity || 'medium', existingRule?.note || '')} /></div>{existingRule ? <div className="space-y-2"><Select value={existingRule.severity} onValueChange={(value) => updateAlertRule(selectedQuestion.id, option, true, value, existingRule.note || '')}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ALERT_SEVERITIES.map((severity) => <SelectItem key={severity} value={severity}>{severity}</SelectItem>)}</SelectContent></Select><Textarea rows={2} placeholder="הערה לצוות" value={existingRule.note || ''} onChange={(event) => updateAlertRule(selectedQuestion.id, option, true, existingRule.severity, event.target.value)} /></div> : null}</div>; })}</div></> : null}</CardContent></Card>
      </div>
    </PageLayout>
  );
}
