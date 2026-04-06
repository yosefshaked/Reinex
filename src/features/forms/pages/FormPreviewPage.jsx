import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Eye, Loader2 } from 'lucide-react';
import PageLayout from '@/components/ui/PageLayout.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import SectionedFormRenderer from '@/features/forms/components/SectionedFormRenderer.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { buildInitialAnswers, normalizeFormSchema, normalizeVisibilityRules } from '@/features/forms/lib/form-schema.js';

const WAITING_LIST_SYSTEM_PREVIEW = ['פרטי תלמיד/ה', 'פרטי התקשרות', 'שירותים נוספים', 'זמינות מועדפת', 'פרטי מימון'];

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

  const loadPreview = useCallback(async () => {
    if (!session || !activeOrgId || !formId) return;
    setLoading(true);
    setError('');
    try {
      const data = await authenticatedFetch(`forms/${formId}`, { session, params: { org_id: activeOrgId } });
      const normalizedSchema = normalizeFormSchema(data?.form_schema || {});
      setFormName(String(data?.name || 'טופס'));
      setFormUsage(String(data?.form_usage || 'general'));
      setSchema(normalizedSchema);
      setVisibilityRules(normalizeVisibilityRules(data?.visibility_rules));
      setAnswers(buildInitialAnswers(normalizedSchema));
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

  return (
    <PageLayout
      title="תצוגה מקדימה"
      description="תצוגת לקוח מלאה לטיוטה השמורה האחרונה"
      actions={<Button variant="outline" className="gap-2" onClick={() => navigate(`/forms/${formId}`)}><ArrowRight className="h-4 w-4" />חזרה לבונה</Button>}
    >
      {loading ? <Card><CardContent className="flex items-center justify-center gap-2 p-16"><Loader2 className="h-5 w-5 animate-spin" /><span>טוען תצוגה...</span></CardContent></Card> : null}
      {!loading && error ? <Alert><AlertDescription>{error}</AlertDescription></Alert> : null}
      {!loading && !error ? (
        <div className="mx-auto max-w-4xl space-y-4">
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
          {formUsage === 'waiting_list_intake' ? (
            <Card>
              <CardContent className="grid grid-cols-1 gap-2 p-4 md:grid-cols-2">
                {WAITING_LIST_SYSTEM_PREVIEW.map((item) => (
                  <div key={item} className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">{item}</div>
                ))}
              </CardContent>
            </Card>
          ) : null}
          <SectionedFormRenderer schema={schema} visibilityRules={visibilityRules} answers={answers} onAnswersChange={setAnswers} />
        </div>
      ) : null}
    </PageLayout>
  );
}
