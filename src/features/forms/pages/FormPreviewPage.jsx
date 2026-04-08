import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Eye, Link2, Loader2 } from 'lucide-react';
import PageLayout from '@/components/ui/PageLayout.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import SectionedFormRenderer from '@/features/forms/components/SectionedFormRenderer.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import {
  buildInitialAnswers,
  collectSharedBlockIds,
  normalizeFormSchema,
  normalizeVisibilityRules,
  resolveSchemaWithSharedBlocks,
  buildSharedBlockMap,
} from '@/features/forms/lib/form-schema.js';

export default function FormPreviewPage() {
  const navigate = useNavigate();
  const { formId = '' } = useParams();
  const { session } = useSupabase();
  const { activeOrgId } = useOrg();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formName, setFormName] = useState('');
  const [formUsage, setFormUsage] = useState('general');
  const [schema, setSchema] = useState(normalizeFormSchema({}));
  const [visibilityRules, setVisibilityRules] = useState([]);
  const [answers, setAnswers] = useState({});
  const [sharedBlocks, setSharedBlocks] = useState([]);
  const [selectedSharedBlockId, setSelectedSharedBlockId] = useState('');
  const [selectedSharedBlockDetail, setSelectedSharedBlockDetail] = useState(null);

  const sharedBlockMap = useMemo(() => buildSharedBlockMap(sharedBlocks), [sharedBlocks]);
  const resolvedSchema = useMemo(() => resolveSchemaWithSharedBlocks(schema, sharedBlockMap), [schema, sharedBlockMap]);
  const usedSharedBlocks = useMemo(() => {
    const ids = collectSharedBlockIds(schema);
    return ids.map((id) => sharedBlockMap[id]).filter(Boolean);
  }, [schema, sharedBlockMap]);

  const loadPreview = useCallback(async () => {
    if (!session || !activeOrgId || !formId) return;
    setLoading(true);
    setError('');
    try {
      const data = await authenticatedFetch(`forms/${formId}`, { session, params: { org_id: activeOrgId } });
      const normalizedSchema = normalizeFormSchema(data?.form_schema || {});
      const sharedBlockRows = Array.isArray(data?.shared_blocks) ? data.shared_blocks : [];
      const resolved = resolveSchemaWithSharedBlocks(normalizedSchema, buildSharedBlockMap(sharedBlockRows));
      setFormName(String(data?.name || 'טופס'));
      setFormUsage(String(data?.form_usage || 'general'));
      setSchema(normalizedSchema);
      setSharedBlocks(sharedBlockRows);
      setVisibilityRules(normalizeVisibilityRules(data?.visibility_rules));
      setAnswers(buildInitialAnswers(resolved));
    } catch (loadError) {
      console.error('Failed to load form preview', loadError);
      setError(loadError?.message || 'טעינת התצוגה נכשלה');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, formId, session]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  useEffect(() => {
    if (!selectedSharedBlockId || !session || !activeOrgId) {
      setSelectedSharedBlockDetail(null);
      return;
    }

    let cancelled = false;
    const loadDetail = async () => {
      try {
        const data = await authenticatedFetch(`form-blocks/${selectedSharedBlockId}`, {
          session,
          params: { org_id: activeOrgId },
        });
        if (!cancelled) {
          setSelectedSharedBlockDetail(data);
        }
      } catch (loadError) {
        console.error('Failed to load shared block preview detail', loadError);
        if (!cancelled) {
          setSelectedSharedBlockDetail(null);
        }
      }
    };

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [activeOrgId, selectedSharedBlockId, session]);

  return (
    <PageLayout
      title="תצוגה מקדימה"
      description="תצוגת לקוח מלאה לטיוטה השמורה האחרונה"
      actions={<Button variant="outline" className="gap-2" onClick={() => navigate(`/forms/${formId}`)}><ArrowRight className="h-4 w-4" />חזרה לבונה</Button>}
    >
      {loading ? <Card><CardContent className="flex items-center justify-center gap-2 p-16"><Loader2 className="h-5 w-5 animate-spin" /><span>טוען תצוגה...</span></CardContent></Card> : null}
      {!loading && error ? <Alert><AlertDescription>{error}</AlertDescription></Alert> : null}
      {!loading && !error ? (
        <div className="mx-auto max-w-5xl space-y-4">
          <Card>
            <CardContent className="space-y-2 p-6">
              <div className="flex items-center gap-2">
                <Eye className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold text-slate-900">{formName}</h2>
                <Badge variant="outline">תצוגה בלבד</Badge>
              </div>
              <p className="text-sm text-slate-500">התצוגה משתמשת באותו רנדרר שמוצג ללקוחות, אך ללא שליחה בפועל.</p>
            </CardContent>
          </Card>

          {usedSharedBlocks.length ? (
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold text-slate-900">בלוקים משותפים בשימוש בטופס זה</h3>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {usedSharedBlocks.map((block) => (
                    <button
                      type="button"
                      key={block.id}
                      onClick={() => setSelectedSharedBlockId(block.id)}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-start shadow-sm hover:border-slate-300"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">{block.name}</span>
                        <Badge variant="outline">{block.block_type === 'text' ? 'טקסט משותף' : 'שאלה משותפת'}</Badge>
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {selectedSharedBlockDetail ? (
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">{selectedSharedBlockDetail.name}</h3>
                    <p className="text-xs text-slate-500">
                      {selectedSharedBlockDetail.block_type === 'text' ? 'טקסט משותף' : 'שאלה משותפת'} · בשימוש ב-{selectedSharedBlockDetail.usage_count || 0} טפסים
                    </p>
                  </div>
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate(`/forms/shared-blocks/${selectedSharedBlockDetail.id}`)}>
                    <Link2 className="h-4 w-4" />
                    פתח בספרייה
                  </Button>
                </div>
                {selectedSharedBlockDetail.usage?.length ? (
                  <div className="space-y-2">
                    {selectedSharedBlockDetail.usage.map((entry) => (
                      <button
                        key={entry.form_id}
                        type="button"
                        onClick={() => navigate(`/forms/${entry.form_id}/preview`)}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-start shadow-sm hover:border-slate-300"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-900">{entry.form?.name || 'טופס ללא שם'}</span>
                          <Badge variant="outline">
                            {entry.usage_scope === 'draft_and_published' ? 'טיוטה + פורסם' : entry.usage_scope === 'published' ? 'פורסם' : 'טיוטה'}
                          </Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">הבלוק עדיין לא שובץ באף טופס.</p>
                )}
              </CardContent>
            </Card>
          ) : null}

          {formUsage === 'waiting_list_intake' ? (
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">שם פרטי של התלמיד/ה</div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">שם משפחה של התלמיד/ה</div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">מספר זהות</div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">מי איש הקשר</div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">טלפון</div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">אימייל</div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 md:col-span-2">שירותים נוספים, זמינות ופרטי מימון מוצגים כאן לפי בחירות הלקוח/ה</div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <SectionedFormRenderer
            schema={resolvedSchema}
            sharedBlockMap={sharedBlockMap}
            visibilityRules={visibilityRules}
            answers={answers}
            onAnswersChange={setAnswers}
            onSharedItemSelect={(item) => setSelectedSharedBlockId(item.shared_block_id)}
          />
        </div>
      ) : null}
    </PageLayout>
  );
}
