import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Blocks, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import PageLayout from '@/components/ui/PageLayout.jsx';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { toast } from '@/lib/toast.jsx';
import { QUESTION_TYPE_DEFINITIONS, SHARED_BLOCK_TYPES, TEXT_BLOCK_VARIANTS } from '@/features/forms/lib/form-schema.js';
import { normalizeMembershipRole, isAdminRole } from '@/features/students/utils/endpoints.js';

function createDraft(blockType = SHARED_BLOCK_TYPES.QUESTION) {
  if (blockType === SHARED_BLOCK_TYPES.TEXT) {
    return {
      id: '',
      block_type: SHARED_BLOCK_TYPES.TEXT,
      name: '',
      content_schema: {
        title: '',
        content: '',
        variant: 'info',
      },
      usage: [],
      usage_count: 0,
      is_active: true,
    };
  }

  return {
    id: '',
    block_type: SHARED_BLOCK_TYPES.QUESTION,
    name: '',
    content_schema: {
      question_type: 'short_text',
      label: '',
      description: '',
      required: false,
      placeholder: '',
      options: [],
    },
    usage: [],
    usage_count: 0,
    is_active: true,
  };
}

function createUnsavedDraftCache() {
  return {
    [SHARED_BLOCK_TYPES.QUESTION]: createDraft(SHARED_BLOCK_TYPES.QUESTION),
    [SHARED_BLOCK_TYPES.TEXT]: createDraft(SHARED_BLOCK_TYPES.TEXT),
  };
}

function blockTypeLabel(blockType) {
  return blockType === SHARED_BLOCK_TYPES.TEXT ? 'טקסט משותף' : 'שאלה משותפת';
}

function usageScopeLabel(scope) {
  if (scope === 'draft_and_published') return 'טיוטה + פורסם';
  if (scope === 'published') return 'פורסם';
  return 'טיוטה';
}

function validateDraft(draft) {
  if (!draft.name?.trim()) return 'יש למלא שם פנימי לבלוק המשותף';
  if (draft.block_type === SHARED_BLOCK_TYPES.TEXT) {
    if (!draft.content_schema?.content?.trim()) return 'יש למלא את טקסט ההסבר';
    return '';
  }

  if (!draft.content_schema?.label?.trim()) return 'יש למלא את טקסט השאלה';
  const questionType = String(draft.content_schema?.question_type || '').trim();
  const options = Array.isArray(draft.content_schema?.options) ? draft.content_schema.options.filter((option) => String(option?.label || '').trim()) : [];
  if (['single_select', 'multi_select'].includes(questionType) && options.length < 2) {
    return 'שאלה משותפת מרשימה צריכה לפחות שתי אפשרויות';
  }
  if (questionType === 'approval' && options.length < 1) {
    return 'שאלת אישור צריכה לפחות אפשרות אחת';
  }
  return '';
}

export default function FormBlocksPage() {
  const navigate = useNavigate();
  const { blockId = '' } = useParams();
  const { session } = useSupabase();
  const { activeOrg, activeOrgId } = useOrg();
  const membershipRole = normalizeMembershipRole(activeOrg?.membership?.role || null);
  const isAdmin = isAdminRole(membershipRole);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [blocks, setBlocks] = useState([]);
  const [selectedBlockId, setSelectedBlockId] = useState(blockId || '');
  const [draft, setDraft] = useState(createDraft());
  const [unsavedDraftsByType, setUnsavedDraftsByType] = useState(() => createUnsavedDraftCache());
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  const canLoad = Boolean(session && activeOrgId && isAdmin);

  const loadBlocks = useCallback(async () => {
    if (!canLoad) return;
    setLoading(true);
    setError('');
    try {
      const data = await authenticatedFetch('form-blocks', {
        session,
        params: { org_id: activeOrgId, include_inactive: true },
      });
      setBlocks(Array.isArray(data) ? data : []);
    } catch (loadError) {
      console.error('Failed to load form blocks', loadError);
      setError(loadError?.message || 'טעינת הבלוקים המשותפים נכשלה');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, canLoad, session]);

  const loadBlockDetail = useCallback(async (id) => {
    if (!id || !canLoad) return;
    try {
      const data = await authenticatedFetch(`form-blocks/${id}`, {
        session,
        params: { org_id: activeOrgId },
      });
      setUnsavedDraftsByType(createUnsavedDraftCache());
      setDraft(data);
    } catch (loadError) {
      console.error('Failed to load form block detail', loadError);
      toast.error(loadError?.message || 'טעינת פרטי הבלוק נכשלה');
    }
  }, [activeOrgId, canLoad, session]);

  const syncUnsavedDrafts = useCallback((nextDraft) => {
    const sharedName = String(nextDraft?.name || '').trim();
    const sharedMetadata = nextDraft?.metadata || {};
    const sharedActive = nextDraft?.is_active ?? true;
    setUnsavedDraftsByType((prev) => ({
      [SHARED_BLOCK_TYPES.QUESTION]: {
        ...(prev[SHARED_BLOCK_TYPES.QUESTION] || createDraft(SHARED_BLOCK_TYPES.QUESTION)),
        name: sharedName,
        metadata: sharedMetadata,
        is_active: sharedActive,
      },
      [SHARED_BLOCK_TYPES.TEXT]: {
        ...(prev[SHARED_BLOCK_TYPES.TEXT] || createDraft(SHARED_BLOCK_TYPES.TEXT)),
        name: sharedName,
        metadata: sharedMetadata,
        is_active: sharedActive,
      },
      [nextDraft.block_type]: nextDraft,
    }));
  }, []);

  const updateDraft = useCallback((updater) => {
    setDraft((prev) => {
      const nextDraft = typeof updater === 'function' ? updater(prev) : updater;
      if (nextDraft && !nextDraft.id) {
        syncUnsavedDrafts(nextDraft);
      }
      return nextDraft;
    });
  }, [syncUnsavedDrafts]);

  useEffect(() => {
    if (canLoad) {
      void loadBlocks();
    }
  }, [canLoad, loadBlocks]);

  useEffect(() => {
    if (!blockId) return;
    setSelectedBlockId(blockId);
    void loadBlockDetail(blockId);
  }, [blockId, loadBlockDetail]);

  const selectedListBlock = useMemo(
    () => blocks.find((block) => block.id === selectedBlockId) || null,
    [blocks, selectedBlockId],
  );
  const filteredBlocks = useMemo(() => {
    const normalizedSearch = searchTerm.trim();
    return blocks.filter((block) => {
      if (typeFilter !== 'all' && block.block_type !== typeFilter) return false;
      if (!normalizedSearch) return true;
      return `${block.name || ''} ${block.content_schema?.label || ''} ${block.content_schema?.title || ''} ${block.content_schema?.content || ''}`
        .toLowerCase()
        .includes(normalizedSearch.toLowerCase());
    });
  }, [blocks, searchTerm, typeFilter]);

  useEffect(() => {
    if (selectedListBlock && !draft.id) {
      setDraft((prev) => ({ ...prev, ...selectedListBlock }));
    }
  }, [draft.id, selectedListBlock]);

  const handleCreate = () => {
    const nextUnsavedDrafts = createUnsavedDraftCache();
    const nextDraft = nextUnsavedDrafts[SHARED_BLOCK_TYPES.QUESTION];
    setSelectedBlockId('');
    setUnsavedDraftsByType(nextUnsavedDrafts);
    setDraft(nextDraft);
    navigate('/forms/shared-blocks');
  };

  const handleDraftTypeChange = (blockType) => {
    if (draft.id || blockType === draft.block_type) return;
    const sharedName = String(draft.name || unsavedDraftsByType[blockType]?.name || '').trim();
    const nextDraft = {
      ...(unsavedDraftsByType[blockType] || createDraft(blockType)),
      block_type: blockType,
      name: sharedName,
      metadata: draft.metadata || unsavedDraftsByType[blockType]?.metadata || {},
      is_active: true,
    };
    setUnsavedDraftsByType((prev) => ({
      ...prev,
      [draft.block_type]: {
        ...(prev[draft.block_type] || createDraft(draft.block_type)),
        ...draft,
        name: sharedName,
      },
      [blockType]: nextDraft,
    }));
    setDraft(nextDraft);
  };

  const updateContent = (patch) => {
    updateDraft((prev) => ({
      ...prev,
      content_schema: {
        ...prev.content_schema,
        ...patch,
      },
    }));
  };

  const saveDraft = async () => {
    const validationError = validateDraft(draft);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);
    try {
      const path = draft.id ? `form-blocks/${draft.id}` : 'form-blocks';
      const method = draft.id ? 'PUT' : 'POST';
      const payload = await authenticatedFetch(path, {
        session,
        method,
        body: {
          org_id: activeOrgId,
          name: draft.name,
          block_type: draft.block_type,
          content_schema: draft.content_schema,
          metadata: draft.metadata || {},
        },
      });
      setUnsavedDraftsByType(createUnsavedDraftCache());
      setDraft(payload);
      setSelectedBlockId(payload.id);
      navigate(`/forms/shared-blocks/${payload.id}`);
      toast.success(draft.id ? 'הבלוק המשותף עודכן' : 'הבלוק המשותף נוצר');
      await loadBlocks();
    } catch (saveError) {
      console.error('Failed to save form block', saveError);
      toast.error(saveError?.message || 'שמירת הבלוק נכשלה');
    } finally {
      setSaving(false);
    }
  };

  const deactivateDraft = async () => {
    if (!draft.id) return;
    setSaving(true);
    try {
      const payload = await authenticatedFetch(`form-blocks/${draft.id}`, {
        session,
        method: 'DELETE',
        body: { org_id: activeOrgId },
      });
      setDraft(payload);
      toast.success('הבלוק המשותף הושבת');
      await loadBlocks();
    } catch (deleteError) {
      console.error('Failed to deactivate form block', deleteError);
      if (deleteError?.message === 'shared_block_in_use') {
        toast.error('לא ניתן להשבית בלוק משותף שעדיין נמצא בשימוש בטפסים.');
      } else {
        toast.error(deleteError?.message || 'השבתת הבלוק נכשלה');
      }
    } finally {
      setSaving(false);
    }
  };

  const questionOptions = Array.isArray(draft.content_schema?.options) ? draft.content_schema.options : [];
  const blockIsInUse = Number(draft.usage_count || 0) > 0;

  if (!isAdmin) {
    return (
      <PageLayout
        title="ספריית בלוקים משותפים"
        description="ניהול בלוקים משותפים זמין למנהלים בלבד"
        actions={<Button variant="outline" onClick={() => navigate('/forms')}>חזרה לטפסים</Button>}
      >
        <Alert>
          <AlertDescription>הגישה לספריית הבלוקים המשותפים מותרת רק למנהלים בארגון.</AlertDescription>
        </Alert>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="ספריית בלוקים משותפים"
      description="ניהול שאלות וטקסטים משותפים שמתעדכנים אוטומטית בכל הטפסים המשתמשים בהם"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={() => navigate('/forms')}>
            <ArrowRight className="h-4 w-4" />
            חזרה לטפסים
          </Button>
          <Button className="gap-2" onClick={handleCreate}>
            <Plus className="h-4 w-4" />
            צור בלוק משותף
          </Button>
        </div>
      }
    >
      {error ? (
        <Alert className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="xl:sticky xl:top-4 xl:h-fit">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Blocks className="h-4 w-4" />
              בלוקים קיימים
            </div>
            <div className="space-y-2">
              <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="חיפוש לפי שם או תוכן" />
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל הבלוקים</SelectItem>
                  <SelectItem value={SHARED_BLOCK_TYPES.QUESTION}>שאלות משותפות</SelectItem>
                  <SelectItem value={SHARED_BLOCK_TYPES.TEXT}>טקסטים משותפים</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                טוען ספרייה...
              </div>
            ) : null}
            {!loading && filteredBlocks.length === 0 ? (
              <p className="text-sm text-slate-500">{blocks.length === 0 ? 'עדיין לא נוצרו בלוקים משותפים.' : 'לא נמצאו בלוקים התואמים לסינון.'}</p>
            ) : null}
            {!loading ? filteredBlocks.map((block) => (
              <button
                type="button"
                key={block.id}
                onClick={() => {
                  setSelectedBlockId(block.id);
                  navigate(`/forms/shared-blocks/${block.id}`);
                  void loadBlockDetail(block.id);
                }}
                className={`w-full rounded-2xl border px-4 py-3 text-start shadow-sm transition-colors ${
                  selectedBlockId === block.id ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{block.name}</span>
                  <Badge variant="outline">{blockTypeLabel(block.block_type)}</Badge>
                  {!block.is_active ? <Badge variant="destructive">מושבת</Badge> : null}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  בשימוש ב-{block.usage_count || 0} טפסים
                </p>
              </button>
            )) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-slate-900">
                {draft.id ? draft.name || 'עריכת בלוק משותף' : 'בלוק משותף חדש'}
              </h3>
              <Badge variant="outline">{blockTypeLabel(draft.block_type)}</Badge>
              {draft.id ? <Badge variant="outline">בשימוש ב-{draft.usage_count || 0} טפסים</Badge> : null}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>שם פנימי</Label>
                <Input value={draft.name || ''} onChange={(event) => updateDraft((prev) => ({ ...prev, name: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>סוג בלוק</Label>
                <Select
                  value={draft.block_type}
                  disabled={Boolean(draft.id)}
                  onValueChange={handleDraftTypeChange}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SHARED_BLOCK_TYPES.QUESTION}>שאלה משותפת</SelectItem>
                    <SelectItem value={SHARED_BLOCK_TYPES.TEXT}>טקסט משותף</SelectItem>
                  </SelectContent>
                </Select>
                {!draft.id ? (
                  <p className="text-xs text-slate-500">אפשר לשנות את סוג הבלוק עד השמירה הראשונה.</p>
                ) : (
                  <p className="text-xs text-slate-500">אחרי יצירה סוג הבלוק נשאר קבוע כדי לשמור על עקביות בכל הטפסים שמשתמשים בו.</p>
                )}
              </div>
            </div>

            {draft.block_type === SHARED_BLOCK_TYPES.TEXT ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>כותרת</Label>
                  <Input value={draft.content_schema?.title || ''} onChange={(event) => updateContent({ title: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>טקסט הסבר</Label>
                  <Textarea rows={6} value={draft.content_schema?.content || ''} onChange={(event) => updateContent({ content: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>סגנון</Label>
                  <Select value={draft.content_schema?.variant || 'info'} onValueChange={(value) => updateContent({ variant: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEXT_BLOCK_VARIANTS.map((variant) => (
                        <SelectItem key={variant.value} value={variant.value}>{variant.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>טקסט שאלה</Label>
                  <Input value={draft.content_schema?.label || ''} onChange={(event) => updateContent({ label: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>הסבר</Label>
                  <Textarea rows={3} value={draft.content_schema?.description || ''} onChange={(event) => updateContent({ description: event.target.value })} />
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>סוג שאלה</Label>
                    <Select value={draft.content_schema?.question_type || 'short_text'} onValueChange={(value) => updateContent({ question_type: value, options: ['single_select', 'multi_select', 'approval', 'yes_no'].includes(value) ? questionOptions : [] })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {QUESTION_TYPE_DEFINITIONS.map((definition) => (
                          <SelectItem key={definition.type} value={definition.type}>{definition.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Placeholder</Label>
                    <Input value={draft.content_schema?.placeholder || ''} onChange={(event) => updateContent({ placeholder: event.target.value })} />
                  </div>
                </div>
                <label className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3">
                  <span className="text-sm font-medium text-slate-800">שדה חובה</span>
                  <input
                    type="checkbox"
                    checked={Boolean(draft.content_schema?.required)}
                    onChange={(event) => updateContent({ required: event.target.checked })}
                  />
                </label>
                {['single_select', 'multi_select', 'approval'].includes(draft.content_schema?.question_type) ? (
                  <div className="space-y-2">
                    <Label>אפשרויות</Label>
                    {questionOptions.map((option, index) => (
                      <div key={`${draft.id || 'draft'}_option_${index}`} className="flex items-center gap-2">
                        <Input
                          value={option.label || ''}
                          onChange={(event) => {
                            const nextOptions = questionOptions.map((currentOption, optionIndex) => (
                              optionIndex === index
                                ? { ...currentOption, label: event.target.value, value: draft.content_schema?.question_type === 'approval' ? true : event.target.value }
                                : currentOption
                            ));
                            updateContent({ options: nextOptions });
                          }}
                        />
                        {draft.content_schema?.question_type !== 'approval' ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => updateContent({ options: questionOptions.filter((_, optionIndex) => optionIndex !== index) })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    ))}
                    {draft.content_schema?.question_type !== 'approval' ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={() => updateContent({ options: [...questionOptions, { value: `אפשרות ${questionOptions.length + 1}`, label: `אפשרות ${questionOptions.length + 1}` }] })}
                      >
                        הוסף אפשרות
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button className="gap-2" onClick={saveDraft} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {draft.id ? 'שמור שינויים' : 'צור בלוק משותף'}
              </Button>
              {draft.id ? (
                <Button variant="outline" className="gap-2" onClick={deactivateDraft} disabled={saving || !draft.is_active || blockIsInUse}>
                  <Trash2 className="h-4 w-4" />
                  השבת בלוק
                </Button>
              ) : null}
            </div>

            {draft.id && blockIsInUse ? (
              <Alert>
                <AlertDescription>אי אפשר להשבית בלוק משותף כל עוד הוא עדיין בשימוש בטפסים. יש לנתק אותו מהטפסים או להפוך את המופעים למקומיים קודם.</AlertDescription>
              </Alert>
            ) : null}

            {draft.id ? (
              <div className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-900">בשימוש בטפסים</h4>
                  <Badge variant="outline">{draft.usage_count || 0}</Badge>
                </div>
                {!draft.usage?.length ? (
                  <p className="text-sm text-slate-500">הבלוק עדיין לא שובץ באף טופס.</p>
                ) : (
                  <div className="space-y-2">
                    {draft.usage.map((entry) => (
                      <button
                        type="button"
                        key={entry.form_id}
                        onClick={() => navigate(`/forms/${entry.form_id}/preview`)}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-start shadow-sm hover:border-slate-300"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-900">{entry.form?.name || 'טופס ללא שם'}</span>
                          <Badge variant="outline">{usageScopeLabel(entry.usage_scope)}</Badge>
                          {!entry.form?.is_active ? <Badge variant="destructive">מושבת</Badge> : null}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          גרסה {entry.form?.version || '—'} · {entry.placement_count || 0} מופעים בטופס
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
