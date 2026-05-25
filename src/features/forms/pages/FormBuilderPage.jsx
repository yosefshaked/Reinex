import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertCircle, ArrowRight, Blocks, Eye, GripVertical, Layers3, Link2, Loader2, Plus, Save, Send, Trash2 } from 'lucide-react';
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/lib/toast.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import SectionedFormRenderer from '@/features/forms/components/SectionedFormRenderer.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { normalizeMembershipRole, isAdminRole } from '@/features/students/utils/endpoints.js';
import {
  buildInitialAnswers,
  buildSharedBlockMap,
  createBuiltInRequiredFormQuestion,
  createQuestion,
  createSection,
  createSharedPlacement,
  createTextBlock,
  findItemByIdRaw,
  getAvailableSourceQuestions,
  getRequiredFormBuiltInQuestions,
  getWaitingListBuiltInQuestions,
  isBuiltInRequiredFormQuestion,
  isQuestionItem,
  isSharedItem,
  normalizeAlertRules,
  normalizeFormSchema,
  validateNormalizedFormSchemaIntegrity,
  normalizeVisibilityRules,
  QUESTION_TYPE_DEFINITIONS,
  resolveSchemaWithSharedBlocks,
  SHARED_BLOCK_TYPES,
  TEXT_BLOCK_VARIANTS,
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

function SortableCard({ id, selected, onSelect, title, subtitle, badges, children, stopSelectionPropagation = false }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('rounded-3xl border bg-white p-4 shadow-sm', selected ? 'border-primary/40 ring-2 ring-primary/10' : 'border-slate-200')}
      onClick={(event) => {
        if (stopSelectionPropagation) event.stopPropagation();
        onSelect?.(event);
      }}
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

function RequiredFormBuiltInSection({ schema, sharedBlockMap, answers, evaluationAnswers, onAnswersChange, readOnly = false }) {
  const rfItems = useMemo(
    () => (schema?.sections ?? []).flatMap((s) => (s.items ?? []).filter(isBuiltInRequiredFormQuestion)),
    [schema],
  );
  const rfSchema = useMemo(
    () => ({ ...schema, sections: [{ id: 'rf_built_in_preview', title: '', description: '', items: rfItems }] }),
    [rfItems, schema],
  );
  if (rfItems.length === 0) return null;
  return (
    <Card className="border-violet-200 bg-violet-50/30">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <Badge className="border-violet-200 bg-violet-50 text-violet-700">קבוע</Badge>
          <span className="text-sm font-semibold text-slate-700">שדות חובה — ישמשו לעדכון פרופיל הלקוח</span>
        </div>
        {readOnly ? (
          <div className="space-y-2">
            {rfItems.map((item) => (
              <div key={item.id} className="rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm text-slate-700">{item.label}</div>
            ))}
          </div>
        ) : (
          <SectionedFormRenderer schema={rfSchema} sharedBlockMap={sharedBlockMap} visibilityRules={[]} answers={answers} evaluationAnswers={evaluationAnswers} onAnswersChange={onAnswersChange} />
        )}
      </CardContent>
    </Card>
  );
}

function createRule(questionId = '') {
  return { id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, source_question_id: questionId, operator: 'equals', value: '' };
}

function createRuleGroup(targetType, targetId) {
  return { id: `group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, target_type: targetType, target_id: targetId, mode: 'all', rules: [createRule()] };
}

function emptyPublishedVersion(metadata) {
  const publishedVersion = Number(metadata?.published_version);
  return Number.isFinite(publishedVersion) && publishedVersion > 0 ? publishedVersion : null;
}

function getQuestionOptions(question) {
  if (!question) return [];
  if ((question.question_type || question.type) === 'yes_no') return [{ value: true, label: 'כן' }, { value: false, label: 'לא' }];
  return Array.isArray(question.options) ? question.options : [];
}

function itemTypeLabel(item) {
  if (!item) return '';
  if (!isQuestionItem(item)) return 'טקסט';
  return QUESTION_TYPE_DEFINITIONS.find((entry) => entry.type === item.question_type)?.label || 'שאלה';
}

function usageScopeLabel(scope) {
  if (scope === 'draft_and_published') return 'טיוטה + פורסם';
  if (scope === 'published') return 'פורסם';
  return 'טיוטה';
}

function describeSchemaIssue(issue) {
  const [code, suffix = ''] = String(issue || '').split(':', 2);
  switch (code) {
    case 'missing_section_id':
      return 'יש סעיף בטופס ללא מזהה תקין.';
    case 'duplicate_section_id':
      return `יש שני סעיפים עם אותו מזהה: ${suffix}`;
    case 'missing_item_id':
      return 'יש פריט בטופס ללא מזהה תקין.';
    case 'duplicate_item_id':
      return `יש שני פריטים עם אותו מזהה: ${suffix}`;
    case 'missing_shared_block_id':
      return 'יש פריט משותף ללא קישור לבלוק המקור.';
    case 'invalid_visibility_target_section':
      return 'אחד מתנאי החשיפה מפנה לסעיף שלא קיים.';
    case 'invalid_visibility_target_item':
      return 'אחד מתנאי החשיפה מפנה לפריט שלא קיים.';
    case 'invalid_visibility_source_question':
      return 'אחד מתנאי החשיפה מפנה לשאלת מקור שלא קיימת.';
    case 'invalid_alert_question':
      return 'אחד מהדגלים האדומים מפנה לשאלה שלא קיימת.';
    default:
      return 'מבנה הטופס אינו תקין. יש לבדוק את הפריטים, תנאי החשיפה והדגלים האדומים.';
  }
}

function cloneSharedItemAsLocal(item) {
  if (!item || !isSharedItem(item)) return item;
  if (isQuestionItem(item)) {
    return {
      id: item.id,
      type: 'local_question',
      question_type: item.question_type,
      label: item.label,
      description: item.description,
      required: item.required,
      placeholder: item.placeholder,
      options: Array.isArray(item.options) ? item.options.map((option) => ({ ...option })) : [],
      ui: item.ui || {},
      metadata: item.metadata || {},
    };
  }
  return {
    id: item.id,
    type: 'local_text',
    title: item.title,
    content: item.content,
    variant: item.variant || 'info',
    metadata: item.metadata || {},
  };
}

function buildFormDraftSnapshot({
  formName,
  description,
  formUsage,
  schema,
  visibilityRules,
  alertRules,
}) {
  return JSON.stringify({
    formName: String(formName || ''),
    description: String(description || ''),
    formUsage: String(formUsage || 'general'),
    schema,
    visibilityRules,
    alertRules,
  });
}

function ItemEditor({
  selectedItem,
  selectedQuestion,
  selectedSharedBlockDetail,
  updateSelectedItem,
  deleteSelectedItem,
  detachSharedItem,
  navigate,
}) {
  return (
    <>
      {!isSharedItem(selectedItem) && isQuestionItem(selectedItem) ? (
        <>
          <div className="space-y-2"><Label>כותרת שאלה</Label><Input value={selectedQuestion?.label || ''} onChange={(event) => updateSelectedItem((item) => ({ ...item, label: event.target.value }))} /></div>
          <div className="space-y-2"><Label>תיאור / הסבר</Label><Textarea rows={3} value={selectedQuestion?.description || ''} onChange={(event) => updateSelectedItem((item) => ({ ...item, description: event.target.value }))} /></div>
          <div className="space-y-2"><Label>סוג שאלה</Label><Select value={selectedQuestion?.question_type || 'short_text'} onValueChange={(value) => updateSelectedItem((item) => ({ ...item, question_type: value, options: createQuestion(value).options }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{QUESTION_TYPE_DEFINITIONS.map((definition) => <SelectItem key={definition.type} value={definition.type}>{definition.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Placeholder</Label><Input value={selectedQuestion?.placeholder || ''} onChange={(event) => updateSelectedItem((item) => ({ ...item, placeholder: event.target.value }))} /></div>
          <div className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3"><div><p className="text-sm font-medium">שדה חובה</p><p className="text-xs text-slate-500">הלקוח לא יוכל לשלוח בלי לענות</p></div><Switch checked={Boolean(selectedQuestion?.required)} onCheckedChange={(checked) => updateSelectedItem((item) => ({ ...item, required: checked }))} /></div>
          {['single_select', 'multi_select', 'approval'].includes(selectedQuestion?.question_type) ? (
            <div className="space-y-2">
              <Label>אפשרויות</Label>
              {getQuestionOptions(selectedQuestion).map((option, index) => (
                <div key={`${selectedQuestion.id}_${index}`} className="flex items-center gap-2">
                  <Input value={option.label} onChange={(event) => updateSelectedItem((item) => ({ ...item, options: getQuestionOptions(item).map((currentOption, optionIndex) => optionIndex === index ? { ...currentOption, label: event.target.value, value: item.question_type === 'approval' ? true : event.target.value } : currentOption) }))} />
                  <Button variant="outline" size="icon" onClick={() => updateSelectedItem((item) => ({ ...item, options: getQuestionOptions(item).filter((_, optionIndex) => optionIndex !== index) }))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              {selectedQuestion?.question_type !== 'approval' ? <Button variant="outline" className="w-full" onClick={() => updateSelectedItem((item) => ({ ...item, options: [...getQuestionOptions(item), { value: `אפשרות ${getQuestionOptions(item).length + 1}`, label: `אפשרות ${getQuestionOptions(item).length + 1}` }] }))}>הוסף אפשרות</Button> : null}
            </div>
          ) : null}
        </>
      ) : null}

      {!isSharedItem(selectedItem) && !isQuestionItem(selectedItem) ? (
        <>
          <div className="space-y-2"><Label>כותרת</Label><Input value={selectedItem.title || ''} onChange={(event) => updateSelectedItem((item) => ({ ...item, title: event.target.value }))} /></div>
          <div className="space-y-2"><Label>טקסט הסבר</Label><Textarea rows={6} value={selectedItem.content || ''} onChange={(event) => updateSelectedItem((item) => ({ ...item, content: event.target.value }))} /></div>
          <div className="space-y-2"><Label>סגנון</Label><Select value={selectedItem.variant || 'info'} onValueChange={(value) => updateSelectedItem((item) => ({ ...item, variant: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TEXT_BLOCK_VARIANTS.map((variant) => <SelectItem key={variant.value} value={variant.value}>{variant.label}</SelectItem>)}</SelectContent></Select></div>
        </>
      ) : null}

      {isSharedItem(selectedItem) ? (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">משותף</Badge><Badge variant="secondary">{isQuestionItem(selectedItem) ? 'שאלה' : 'טקסט'}</Badge></div>
          <div className="space-y-1"><p className="text-sm font-semibold text-slate-900">{selectedSharedBlockDetail?.name || selectedItem.shared_block?.name || 'בלוק משותף'}</p><p className="text-xs text-slate-500">עדכון הבלוק יתעדכן בכל הטפסים, כולל טפסים שכבר פורסמו.</p></div>
          {selectedSharedBlockDetail ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-700">בשימוש בטפסים</p>
              {!selectedSharedBlockDetail.usage?.length ? <p className="text-xs text-slate-500">הבלוק עדיין לא שובץ באף טופס.</p> : <div className="space-y-2">{selectedSharedBlockDetail.usage.map((entry) => <button type="button" key={entry.form_id} onClick={() => navigate(`/forms/${entry.form_id}/preview`)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-start text-xs shadow-sm hover:border-slate-300"><div className="flex items-center gap-2"><span className="font-medium text-slate-900">{entry.form?.name || 'טופס ללא שם'}</span><Badge variant="outline">{usageScopeLabel(entry.usage_scope)}</Badge></div><div className="mt-1 text-slate-500">{entry.placement_count || 0} מופעים בטופס</div></button>)}</div>}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={() => navigate(`/forms/shared-blocks/${selectedItem.shared_block_id}`)}><Link2 className="h-4 w-4" />ערוך מקור משותף</Button>
            <Button variant="outline" onClick={detachSharedItem}>הפוך למקומי</Button>
          </div>
        </div>
      ) : <Button variant="destructive" className="w-full gap-2" onClick={deleteSelectedItem}><Trash2 className="h-4 w-4" />מחק פריט</Button>}
    </>
  );
}

function VisibilityEditor({ selected, selectedGroups, setVisibilityRules, updateVisibilityGroup, availableSources }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><div><h4 className="text-sm font-semibold text-slate-900">תנאי חשיפה</h4><p className="text-xs text-slate-500">הצג פריט זה רק כאשר תשובות קודמות עומדות בתנאים.</p></div><Button variant="outline" size="sm" onClick={() => setVisibilityRules((prev) => [...prev, createRuleGroup(selected.type, selected.id)])}>הוסף קבוצה</Button></div>
      {selectedGroups.length === 0 ? <p className="text-xs text-slate-500">אין תנאי חשיפה. הפריט יוצג תמיד.</p> : selectedGroups.map((group) => <div key={group.id} className="rounded-2xl border border-slate-200 p-3"><div className="mb-2 flex items-center justify-between"><Select value={group.mode} onValueChange={(value) => updateVisibilityGroup(group.id, (current) => ({ ...current, mode: value }))}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">כל התנאים</SelectItem><SelectItem value="any">לפחות תנאי אחד</SelectItem></SelectContent></Select><Button variant="ghost" size="icon" onClick={() => setVisibilityRules((prev) => prev.filter((item) => item.id !== group.id))}><Trash2 className="h-4 w-4" /></Button></div><div className="space-y-2">{group.rules.map((rule) => { const sourceQuestion = availableSources.find((question) => question.id === rule.source_question_id); const options = sourceQuestion ? getQuestionOptions(sourceQuestion) : []; const operatorNeedsValue = !['is_true', 'is_false', 'is_empty', 'is_not_empty'].includes(rule.operator); return <div key={rule.id} className="space-y-2 rounded-2xl bg-slate-50 p-3"><Select value={rule.source_question_id} onValueChange={(value) => updateVisibilityGroup(group.id, (current) => ({ ...current, rules: current.rules.map((item) => item.id === rule.id ? { ...item, source_question_id: value } : item) }))}><SelectTrigger><SelectValue placeholder="שאלת מקור" /></SelectTrigger><SelectContent>{availableSources.map((question) => <SelectItem key={question.id} value={question.id}>{question.label}</SelectItem>)}</SelectContent></Select><Select value={rule.operator} onValueChange={(value) => updateVisibilityGroup(group.id, (current) => ({ ...current, rules: current.rules.map((item) => item.id === rule.id ? { ...item, operator: value } : item) }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{RULE_OPERATORS.map((operator) => <SelectItem key={operator.value} value={operator.value}>{operator.label}</SelectItem>)}</SelectContent></Select>{operatorNeedsValue ? options.length > 0 ? <Select value={String(rule.value ?? '')} onValueChange={(value) => updateVisibilityGroup(group.id, (current) => ({ ...current, rules: current.rules.map((item) => item.id === rule.id ? { ...item, value: sourceQuestion?.type === 'yes_no' ? value === 'true' : value } : item) }))}><SelectTrigger><SelectValue placeholder="ערך" /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={String(option.value)} value={String(option.value)}>{option.label}</SelectItem>)}</SelectContent></Select> : <Input value={String(rule.value ?? '')} onChange={(event) => updateVisibilityGroup(group.id, (current) => ({ ...current, rules: current.rules.map((item) => item.id === rule.id ? { ...item, value: event.target.value } : item) }))} placeholder="ערך להשוואה" /> : null}<div className="flex justify-end"><Button variant="ghost" size="sm" onClick={() => updateVisibilityGroup(group.id, (current) => ({ ...current, rules: current.rules.filter((item) => item.id !== rule.id) }))}>מחק תנאי</Button></div></div>; })}</div><Button variant="outline" className="mt-2 w-full" onClick={() => updateVisibilityGroup(group.id, (current) => ({ ...current, rules: [...current.rules, createRule(availableSources[0]?.id || '')] }))}>הוסף תנאי</Button></div>)}
    </div>
  );
}

function AlertRulesEditor({ selectedQuestion, alertRules, updateAlertRule }) {
  return (
    <>
      <Separator />
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-900">דגלים אדומים</h4>
        {getQuestionOptions(selectedQuestion).map((option) => {
          const existingRule = alertRules.find((rule) => rule.question_id === selectedQuestion.id && String(rule.value) === String(option.value));
          return <div key={`${selectedQuestion.id}_${String(option.value)}`} className="space-y-2 rounded-2xl border border-slate-200 p-3"><div className="flex items-center justify-between"><div><p className="text-sm font-medium">{option.label}</p><p className="text-xs text-slate-500">סימון תשובה זו כרגישה קלינית / תפעולית.</p></div><Checkbox checked={Boolean(existingRule)} onCheckedChange={(checked) => updateAlertRule(selectedQuestion.id, option, checked === true, existingRule?.severity || 'medium', existingRule?.note || '')} /></div>{existingRule ? <div className="space-y-2"><Select value={existingRule.severity} onValueChange={(value) => updateAlertRule(selectedQuestion.id, option, true, value, existingRule.note || '')}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ALERT_SEVERITIES.map((severity) => <SelectItem key={severity} value={severity}>{severity}</SelectItem>)}</SelectContent></Select><Textarea rows={2} placeholder="הערה לצוות" value={existingRule.note || ''} onChange={(event) => updateAlertRule(selectedQuestion.id, option, true, existingRule.severity, event.target.value)} /></div> : null}</div>;
        })}
      </div>
    </>
  );
}

export default function FormBuilderPage() {
  const navigate = useNavigate();
  const { formId = '' } = useParams();
  const { session } = useSupabase();
  const { activeOrg, activeOrgId } = useOrg();
  const membershipRole = normalizeMembershipRole(activeOrg?.membership?.role || null);
  const isAdmin = isAdminRole(membershipRole);
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
  const [sharedBlocks, setSharedBlocks] = useState([]);
  const [selectedSharedQuestionId, setSelectedSharedQuestionId] = useState('');
  const [selectedSharedTextId, setSelectedSharedTextId] = useState('');
  const [selectedSharedBlockDetail, setSelectedSharedBlockDetail] = useState(null);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [navigationGuardOpen, setNavigationGuardOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const currentHashRef = useRef(typeof window !== 'undefined' ? window.location.hash : '');
  const ignoreHashSyncRef = useRef(false);

  const canLoad = Boolean(session && activeOrgId && formId && isAdmin);
  const sharedBlockMap = useMemo(() => buildSharedBlockMap(sharedBlocks), [sharedBlocks]);
  const resolvedSchema = useMemo(() => resolveSchemaWithSharedBlocks(schema, sharedBlockMap), [schema, sharedBlockMap]);
  const currentSnapshot = useMemo(() => buildFormDraftSnapshot({
    formName,
    description,
    formUsage,
    schema,
    visibilityRules,
    alertRules,
  }), [alertRules, description, formName, formUsage, schema, visibilityRules]);
  const hasUnsavedChanges = Boolean(canLoad && !loading && savedSnapshot && currentSnapshot !== savedSnapshot);

  // Keep in-progress editor text intact (including temporary trailing spaces) while typing.
  const updateSchema = (updater) => setSchema((prev) => (typeof updater === 'function' ? updater(prev) : updater));

  const selectedSection = useMemo(() => schema.sections.find((section) => section.id === selected.id) || null, [schema.sections, selected.id]);
  const selectedItem = useMemo(() => findItemByIdRaw(schema, selected.id), [schema, selected.id]);
  const selectedQuestion = useMemo(() => (selectedItem && isQuestionItem(selectedItem) ? selectedItem : null), [selectedItem]);
  const availableSources = useMemo(() => getAvailableSourceQuestions(schema, selected.type, selected.id, { formUsage, sharedBlockMap }), [formUsage, schema, selected, sharedBlockMap]);
  const selectedGroups = useMemo(() => visibilityRules.filter((group) => group.target_type === selected.type && group.target_id === selected.id), [selected, visibilityRules]);

  const sharedQuestionBlocks = useMemo(() => sharedBlocks.filter((block) => block.block_type === SHARED_BLOCK_TYPES.QUESTION && block.is_active !== false), [sharedBlocks]);
  const sharedTextBlocks = useMemo(() => sharedBlocks.filter((block) => block.block_type === SHARED_BLOCK_TYPES.TEXT && block.is_active !== false), [sharedBlocks]);

  const loadSharedBlocks = useCallback(async () => {
    if (!session || !activeOrgId) return;
    try {
      const data = await authenticatedFetch('form-blocks', {
        session,
        params: { org_id: activeOrgId, include_inactive: true },
      });
      setSharedBlocks(Array.isArray(data) ? data : []);
    } catch (loadError) {
      console.error('Failed to load shared form blocks', loadError);
    }
  }, [activeOrgId, session]);

  const loadForm = useCallback(async () => {
    if (!canLoad) return;
    setLoading(true);
    setError('');
    try {
      const data = await authenticatedFetch(`forms/${formId}`, { session, params: { org_id: activeOrgId } });
      const normalizedSchema = normalizeFormSchema(data?.form_schema || {});
      const sharedBlockRows = Array.isArray(data?.shared_blocks) ? data.shared_blocks : [];
      const resolved = resolveSchemaWithSharedBlocks(normalizedSchema, buildSharedBlockMap(sharedBlockRows));
      setFormName(String(data?.name || ''));
      setDescription(String(data?.description || ''));
      setFormUsage(String(data?.form_usage || 'general'));
      setSchema(normalizedSchema);
      setSharedBlocks((previous) => {
        const merged = [...sharedBlockRows, ...previous];
        const deduped = [];
        const seen = new Set();
        merged.forEach((block) => {
          if (!block?.id || seen.has(block.id)) return;
          seen.add(block.id);
          deduped.push(block);
        });
        return deduped;
      });
      setVisibilityRules(normalizeVisibilityRules(data?.visibility_rules));
      setAlertRules(normalizeAlertRules(data?.alert_rules));
      setVersion(Number(data?.version || 1));
      setPublishedVersion(emptyPublishedVersion(data?.metadata, Number(data?.version || 1)));
      setLastSavedAt(String(data?.metadata?.draft_saved_at || data?.updated_at || ''));
      setPublishedAt(String(data?.metadata?.published_at || data?.published_at || ''));
      setPreviewAnswers(buildInitialAnswers(resolved));
      setSelected({ type: 'section', id: normalizedSchema.sections[0]?.id || '' });
      setSavedSnapshot(buildFormDraftSnapshot({
        formName: String(data?.name || ''),
        description: String(data?.description || ''),
        formUsage: String(data?.form_usage || 'general'),
        schema: normalizedSchema,
        visibilityRules: normalizeVisibilityRules(data?.visibility_rules),
        alertRules: normalizeAlertRules(data?.alert_rules),
      }));
    } catch (loadError) {
      console.error('Failed to load form', loadError);
      setError(loadError?.message || 'טעינת הטופס נכשלה');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, canLoad, formId, session]);

  useEffect(() => {
    void loadForm();
    void loadSharedBlocks();
  }, [loadForm, loadSharedBlocks]);

  useEffect(() => {
    setPreviewAnswers((prev) => ({ ...buildInitialAnswers(resolvedSchema), ...prev }));
  }, [resolvedSchema]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      setNavigationGuardOpen(false);
      setPendingNavigation(null);
    }
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    currentHashRef.current = window.location.hash;
    const handleHashChange = () => {
      const nextHash = window.location.hash;
      if (ignoreHashSyncRef.current) {
        ignoreHashSyncRef.current = false;
        currentHashRef.current = nextHash;
        return;
      }
      const previousHash = currentHashRef.current;
      if (!hasUnsavedChanges || !previousHash || nextHash === previousHash) {
        currentHashRef.current = nextHash;
        return;
      }

      setPendingNavigation(() => () => {
        ignoreHashSyncRef.current = true;
        currentHashRef.current = nextHash;
        window.location.hash = nextHash;
        setNavigationGuardOpen(false);
        setPendingNavigation(null);
      });
      ignoreHashSyncRef.current = true;
      window.location.hash = previousHash;
      setNavigationGuardOpen(true);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [hasUnsavedChanges]);

  const previewEvaluationAnswers = useMemo(
    () => (formUsage === 'waiting_list_intake' ? buildWaitingListEvaluationAnswers(previewAnswers) : previewAnswers),
    [formUsage, previewAnswers],
  );

  const rfFilteredResolvedSchema = useMemo(() => {
    if (formUsage !== 'required_form') return resolvedSchema;
    return {
      ...resolvedSchema,
      sections: resolvedSchema.sections
        .map((s) => ({ ...s, items: s.items.filter((item) => !isBuiltInRequiredFormQuestion(item)) }))
        .filter((s) => s.items.length > 0),
    };
  }, [formUsage, resolvedSchema]);

  const usedBuiltInRfIds = useMemo(() => {
    const ids = new Set();
    for (const section of schema.sections) {
      for (const item of section.items || []) {
        if (isBuiltInRequiredFormQuestion(item)) ids.add(item.id);
      }
    }
    return ids;
  }, [schema]);

  useEffect(() => {
    const sharedBlockId = selectedItem?.shared_block_id;
    if (!sharedBlockId || !session || !activeOrgId) {
      setSelectedSharedBlockDetail(null);
      return;
    }
    let cancelled = false;
    const loadDetail = async () => {
      try {
        const data = await authenticatedFetch(`form-blocks/${sharedBlockId}`, {
          session,
          params: { org_id: activeOrgId },
        });
        if (!cancelled) setSelectedSharedBlockDetail(data);
      } catch (loadError) {
        if (!cancelled) {
          console.error('Failed to load selected shared block detail', loadError);
          setSelectedSharedBlockDetail(null);
        }
      }
    };
    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [activeOrgId, selectedItem?.shared_block_id, session]);

  const addSection = () => updateSchema((prev) => {
    const nextSection = createSection();
    setSelected({ type: 'section', id: nextSection.id });
    return { ...prev, sections: [...prev.sections, nextSection] };
  });

  const addItemToTargetSection = (nextItem) => updateSchema((prev) => {
    const targetSectionId = selected.type === 'section' ? selected.id : selectedItem?.section_id || prev.sections[0]?.id;
    if (!targetSectionId) return prev;
    setSelected({ type: 'item', id: nextItem.id });
    return {
      ...prev,
      sections: prev.sections.map((section) => (
        section.id === targetSectionId
          ? { ...section, items: [...(section.items || []), nextItem] }
          : section
      )),
    };
  });

  const addQuestion = (type) => addItemToTargetSection(createQuestion(type));
  const addText = () => addItemToTargetSection(createTextBlock());
  const addBuiltInQuestion = (builtInDef) => addItemToTargetSection(createBuiltInRequiredFormQuestion(builtInDef));
  const insertSharedBlock = (blockId) => {
    const block = sharedBlocks.find((entry) => entry.id === blockId);
    if (!block) return;
    addItemToTargetSection(createSharedPlacement(block, block.block_type));
  };

  const updateSelectedItem = (updater) => updateSchema((prev) => ({
    ...prev,
    sections: prev.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => item.id === selected.id ? updater(item) : item),
    })),
  }));

  const deleteSelectedItem = () => {
    updateSchema((prev) => ({
      ...prev,
      sections: prev.sections.map((section) => ({
        ...section,
        items: section.items.filter((item) => item.id !== selected.id),
      })),
    }));
    setSelected({ type: 'section', id: schema.sections[0]?.id || '' });
  };

  const detachSharedItem = () => {
    if (!selectedItem || !isSharedItem(selectedItem)) return;
    updateSelectedItem(() => cloneSharedItemAsLocal(selectedItem));
    setSelectedSharedBlockDetail(null);
  };

  const persistForm = async (publish = false) => {
    const normalizedSchemaForSave = normalizeFormSchema(schema);
    const schemaIssues = validateNormalizedFormSchemaIntegrity({
      formSchema: normalizedSchemaForSave,
      visibilityRules,
      alertRules,
    });
    if (schemaIssues.length) {
      toast.error(describeSchemaIssue(schemaIssues[0]));
      return false;
    }

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
          form_schema: normalizedSchemaForSave,
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
      setSavedSnapshot(currentSnapshot);
      toast.success(publish ? 'הטופס פורסם' : 'טיוטת הטופס נשמרה');
      await loadSharedBlocks();
      return true;
    } catch (saveError) {
      console.error('Failed to persist form', saveError);
      toast.error(saveError?.message || (publish ? 'פרסום הטופס נכשל' : 'שמירת הטיוטה נכשלה'));
      return false;
    } finally {
      if (publish) setPublishing(false); else setSaving(false);
    }
  };

  const stayOnBuilder = () => {
    setNavigationGuardOpen(false);
    setPendingNavigation(null);
  };

  const discardAndContinue = () => {
    if (pendingNavigation) {
      pendingNavigation();
      return;
    }
    setNavigationGuardOpen(false);
  };

  const saveDraftAndContinue = async () => {
    const didSave = await persistForm(false);
    if (!didSave) return;
    if (pendingNavigation) {
      pendingNavigation();
    } else {
      setNavigationGuardOpen(false);
    }
  };

  const guardedNavigate = useCallback((to) => {
    if (!hasUnsavedChanges) {
      navigate(to);
      return;
    }
    setPendingNavigation(() => () => {
      setNavigationGuardOpen(false);
      setPendingNavigation(null);
      navigate(to);
    });
    setNavigationGuardOpen(true);
  }, [hasUnsavedChanges, navigate]);

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    updateSchema((prev) => {
      const [activeKind, activeId] = String(active.id).split(':');
      const [overKind, overId] = String(over.id).split(':');
      if (activeKind === 'section' && overKind === 'section') {
        const ids = prev.sections.map((section) => section.id);
        return { ...prev, sections: arrayMove(prev.sections, ids.indexOf(activeId), ids.indexOf(overId)) };
      }
      if (activeKind === 'item' && overKind === 'item') {
        const nextSections = prev.sections.map((section) => ({ ...section, items: [...section.items] }));
        let sourceIndex = -1;
        let sourceSectionIndex = -1;
        let targetIndex = -1;
        let targetSectionIndex = -1;
        nextSections.forEach((section, index) => {
          const activeIndex = section.items.findIndex((item) => item.id === activeId);
          const overIndex = section.items.findIndex((item) => item.id === overId);
          if (activeIndex >= 0) { sourceSectionIndex = index; sourceIndex = activeIndex; }
          if (overIndex >= 0) { targetSectionIndex = index; targetIndex = overIndex; }
        });
        if (sourceSectionIndex < 0 || targetSectionIndex < 0) return prev;
        const [movedItem] = nextSections[sourceSectionIndex].items.splice(sourceIndex, 1);
        nextSections[targetSectionIndex].items.splice(targetIndex, 0, movedItem);
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

  if (!isAdmin) {
    return (
      <PageLayout
        title="בונה הטפסים"
        description="עריכת טפסים זמינה למנהלים בלבד"
        actions={<Button variant="outline" onClick={() => navigate('/forms')}>חזרה לטפסים</Button>}
      >
        <Alert>
          <AlertDescription>הגישה לעריכת טפסים מותרת רק למנהלים בארגון.</AlertDescription>
        </Alert>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="בונה הטפסים"
      description="עריכת סעיפים, שאלות, טקסטים, תנאי חשיפה, דגלים אדומים ופרסום טופס"
      actions={<div className="flex items-center gap-2"><Button variant="outline" className="gap-2" onClick={() => guardedNavigate('/forms')}><ArrowRight className="h-4 w-4" />חזרה לרשימה</Button><Button variant="outline" className="gap-2" onClick={() => guardedNavigate(`/forms/${formId}/preview`)}><Eye className="h-4 w-4" />תצוגה מלאה</Button><Button className="gap-2" variant="outline" disabled={saving || publishing} onClick={() => void persistForm(false)}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}שמור טיוטה</Button><Button className="gap-2" disabled={saving || publishing} onClick={() => void persistForm(true)}>{publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}פרסם</Button></div>}
    >
      <Dialog open={navigationGuardOpen} onOpenChange={(open) => { if (!open) stayOnBuilder(); }}>
        <DialogContent
          className="max-w-md"
          footer={(
            <div className="space-y-3">
              <Button className="w-full" disabled={saving || publishing} onClick={() => void saveDraftAndContinue()}>
                {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Save className="me-2 h-4 w-4" />}
                שמור/י טיוטה והמשך
              </Button>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button variant="outline" className="w-full" onClick={stayOnBuilder}>הישאר/י בעריכה</Button>
                <Button variant="outline" className="w-full" disabled={saving || publishing} onClick={discardAndContinue}>צא/י בלי לשמור</Button>
              </div>
            </div>
          )}
        >
          <DialogHeader>
            <DialogTitle>יש שינויים שלא נשמרו</DialogTitle>
            <DialogDescription>
              יש בטופס שינויים שעדיין לא נשמרו כטיוטה. אם תצא/י עכשיו, ההתקדמות האחרונה תאבד.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            מומלץ לשמור טיוטה לפני מעבר לעריכת בלוק משותף, לתצוגה המקדימה או לכל עמוד אחר.
          </div>
        </DialogContent>
      </Dialog>
      {error ? <Alert className="mb-4"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert> : null}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)_380px]">
        <Card className="xl:sticky xl:top-4 xl:h-fit">
          <CardContent className="space-y-4 p-4">
            <div className="space-y-2"><Label>מצב</Label><Tabs value={mode} onValueChange={setMode}><TabsList className="grid w-full grid-cols-2"><TabsTrigger value="edit">עריכה</TabsTrigger><TabsTrigger value="preview">תצוגה</TabsTrigger></TabsList></Tabs></div>
            <Separator />
            <div className="space-y-2"><Label>פרטי טופס</Label><Input value={formName} onChange={(event) => setFormName(event.target.value)} placeholder="שם הטופס" /><Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="תיאור קצר" rows={3} /><Select value={formUsage} onValueChange={setFormUsage}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="general">טופס כללי</SelectItem><SelectItem value="waiting_list_intake">טופס רשימת המתנה</SelectItem><SelectItem value="required_form">טופס חובה</SelectItem></SelectContent></Select><div className="flex flex-wrap gap-2 text-xs text-slate-500"><Badge variant="outline">טיוטה v{version}</Badge><Badge variant="outline">{publishedVersion ? `פורסם v${publishedVersion}` : 'לא פורסם'}</Badge>{lastSavedAt ? <Badge variant="outline">נשמר {new Date(lastSavedAt).toLocaleString('he-IL')}</Badge> : null}{publishedAt ? <Badge variant="outline">פורסם {new Date(publishedAt).toLocaleDateString('he-IL')}</Badge> : null}</div></div>
            <Separator />
            <div className="space-y-2"><Button className="w-full gap-2" variant="outline" onClick={addSection}><Layers3 className="h-4 w-4" />הוסף סעיף</Button><Button className="w-full gap-2" variant="outline" onClick={addText}><Plus className="h-4 w-4" />טקסט מקומי</Button><div className="grid grid-cols-1 gap-2">{QUESTION_TYPE_DEFINITIONS.map((definition) => <Button key={definition.type} variant="ghost" className="justify-start rounded-xl border border-slate-200" onClick={() => addQuestion(definition.type)}><Plus className="me-2 h-4 w-4" />{definition.label}</Button>)}</div>{formUsage === 'required_form' ? <><Separator /><div className="space-y-1"><Label className="text-xs text-violet-700">שדות מערכת לטופס חובה</Label>{getRequiredFormBuiltInQuestions().filter((def) => !usedBuiltInRfIds.has(def.id)).map((def) => <Button key={def.id} variant="ghost" className="w-full justify-start rounded-xl border border-violet-200 bg-violet-50/50 text-violet-800 hover:bg-violet-100" onClick={() => addBuiltInQuestion(def)}><Plus className="me-2 h-4 w-4" />{def.label}</Button>)}{getRequiredFormBuiltInQuestions().every((def) => usedBuiltInRfIds.has(def.id)) ? <p className="py-1 text-xs text-slate-400">כל שדות המערכת נוספו לטופס</p> : null}</div></> : null}</div>
            <Separator />
            <div className="space-y-3"><div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Blocks className="h-4 w-4" />בלוקים משותפים</div><Button variant="outline" className="w-full" onClick={() => guardedNavigate('/forms/shared-blocks')}>נהל ספריית בלוקים משותפים</Button><div className="space-y-2"><Label>הוסף שאלה משותפת</Label><Select value={selectedSharedQuestionId} onValueChange={setSelectedSharedQuestionId}><SelectTrigger><SelectValue placeholder="בחר/י שאלה משותפת" /></SelectTrigger><SelectContent>{sharedQuestionBlocks.map((block) => <SelectItem key={block.id} value={block.id}>{block.name}</SelectItem>)}</SelectContent></Select><Button className="w-full" variant="outline" disabled={!selectedSharedQuestionId} onClick={() => insertSharedBlock(selectedSharedQuestionId)}>הוסף לטופס</Button></div><div className="space-y-2"><Label>הוסף טקסט משותף</Label><Select value={selectedSharedTextId} onValueChange={setSelectedSharedTextId}><SelectTrigger><SelectValue placeholder="בחר/י טקסט משותף" /></SelectTrigger><SelectContent>{sharedTextBlocks.map((block) => <SelectItem key={block.id} value={block.id}>{block.name}</SelectItem>)}</SelectContent></Select><Button className="w-full" variant="outline" disabled={!selectedSharedTextId} onClick={() => insertSharedBlock(selectedSharedTextId)}>הוסף לטופס</Button></div></div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {formUsage === 'waiting_list_intake' ? <WaitingListBuiltInPreview answers={previewAnswers} onAnswersChange={setPreviewAnswers} readOnly={mode !== 'preview'} /> : null}
          {formUsage === 'required_form' ? <RequiredFormBuiltInSection schema={resolvedSchema} sharedBlockMap={sharedBlockMap} answers={previewAnswers} evaluationAnswers={previewEvaluationAnswers} onAnswersChange={setPreviewAnswers} readOnly={mode !== 'preview'} /> : null}
          {mode === 'preview' ? <SectionedFormRenderer schema={formUsage === 'required_form' ? rfFilteredResolvedSchema : resolvedSchema} sharedBlockMap={sharedBlockMap} visibilityRules={visibilityRules} answers={previewAnswers} evaluationAnswers={previewEvaluationAnswers} onAnswersChange={setPreviewAnswers} /> : <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}><SortableContext items={schema.sections.map((section) => `section:${section.id}`)} strategy={verticalListSortingStrategy}>{resolvedSchema.sections.map((section) => <SortableCard key={section.id} id={`section:${section.id}`} selected={selected.type === 'section' && selected.id === section.id} onSelect={() => setSelected({ type: 'section', id: section.id })} title={section.title} subtitle={section.description} badges={<Badge variant="outline">{section.items.length} פריטים</Badge>}><SortableContext items={section.items.map((item) => `item:${item.id}`)} strategy={verticalListSortingStrategy}><div className="space-y-3">{section.items.map((item) => <SortableCard key={item.id} id={`item:${item.id}`} selected={selected.type === 'item' && selected.id === item.id} onSelect={() => setSelected({ type: 'item', id: item.id })} stopSelectionPropagation title={isQuestionItem(item) ? item.label : (item.title || 'טקסט מידע')} subtitle={isQuestionItem(item) ? item.description : item.content} badges={<div className="flex flex-wrap gap-1"><Badge variant="secondary">{itemTypeLabel(item)}</Badge><Badge variant="outline">{isSharedItem(item) ? 'משותף' : 'מקומי'}</Badge>{visibilityRules.some((group) => group.target_type === 'item' && group.target_id === item.id) ? <Badge variant="outline">מותנה</Badge> : null}{isQuestionItem(item) && alertRules.some((rule) => rule.question_id === item.id) ? <Badge variant="outline">דגלים</Badge> : null}{isBuiltInRequiredFormQuestion(item) ? <Badge className="border-violet-200 bg-violet-50 text-violet-700">שדה מערכת</Badge> : null}</div>} />)}</div></SortableContext></SortableCard>)}</SortableContext></DndContext>}
        </div>

        <Card className="xl:sticky xl:top-4 xl:h-fit">
          <CardContent className="space-y-4 p-4">
            {selected.type === 'section' && selectedSection ? <><div className="space-y-2"><Label>שם הסעיף</Label><Input value={selectedSection.title} onChange={(event) => updateSchema((prev) => ({ ...prev, sections: prev.sections.map((section) => section.id === selectedSection.id ? { ...section, title: event.target.value } : section) }))} /></div><div className="space-y-2"><Label>תיאור</Label><Textarea rows={3} value={selectedSection.description} onChange={(event) => updateSchema((prev) => ({ ...prev, sections: prev.sections.map((section) => section.id === selectedSection.id ? { ...section, description: event.target.value } : section) }))} /></div><Button variant="destructive" className="w-full gap-2" disabled={schema.sections.length === 1} onClick={() => updateSchema((prev) => ({ ...prev, sections: prev.sections.filter((section) => section.id !== selectedSection.id) }))}><Trash2 className="h-4 w-4" />מחק סעיף</Button></> : null}
            {selected.type === 'item' && selectedItem && isBuiltInRequiredFormQuestion(selectedItem) ? <Alert className="border-violet-200 bg-violet-50"><AlertDescription className="text-xs text-violet-700">שדה מערכת — בעת הגשת הטופס, שדה זה ישמש לעדכון <strong>{getRequiredFormBuiltInQuestions().find((def) => def.id === selectedItem.id)?.fill_hint || selectedItem.label}</strong>.</AlertDescription></Alert> : null}{selected.type === 'item' && selectedItem ? <ItemEditor selectedItem={selectedItem} selectedQuestion={selectedQuestion} selectedSharedBlockDetail={selectedSharedBlockDetail} updateSelectedItem={updateSelectedItem} deleteSelectedItem={deleteSelectedItem} detachSharedItem={detachSharedItem} navigate={guardedNavigate} /> : null}
            <Separator />
            {selected.id ? <VisibilityEditor selected={selected} selectedGroups={selectedGroups} setVisibilityRules={setVisibilityRules} updateVisibilityGroup={updateVisibilityGroup} availableSources={availableSources} /> : null}
            {selectedQuestion && ['single_select', 'multi_select', 'yes_no'].includes(selectedQuestion.question_type) ? <AlertRulesEditor selectedQuestion={selectedQuestion} alertRules={alertRules} updateAlertRule={updateAlertRule} /> : null}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
