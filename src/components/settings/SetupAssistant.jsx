import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { SETUP_SQL_SCRIPT } from '@/lib/setup-sql.js';
import { asError } from '@/lib/error-utils.js';
import { useUserRole } from '@/features/onboarding/hooks/useUserRole.js';
import {
  applySchemaDestructive,
  applySchemaSafe,
  createSchemaPlan,
  runSchemaPreflight,
} from '@/features/admin/api/schema-migrations.js';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCopy,
  Loader2,
} from 'lucide-react';

const REQUIRED_DESTRUCTIVE_PHRASE = 'ALLOW DESTRUCTIVE CHANGES';

const VALIDATION_STATES = {
  idle: 'idle',
  validating: 'validating',
  success: 'success',
  error: 'error',
};

function CopyButton({ text, ariaLabel }) {
  const [state, setState] = useState('idle');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch (error) {
      console.error('Failed to copy text to clipboard', error);
      setState('error');
      setTimeout(() => setState('idle'), 2000);
    }
  };

  const label = state === 'copied' ? 'הועתק!' : state === 'error' ? 'שגיאה' : 'העתק';

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleCopy}
      aria-label={ariaLabel}
      className="gap-2"
    >
      {state === 'copied' ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
      ) : (
        <ClipboardCopy className="w-4 h-4" aria-hidden="true" />
      )}
      {label}
    </Button>
  );
}

function CodeBlock({ title, code, ariaLabel }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-medium text-slate-800">{title}</p>
        <CopyButton text={code} ariaLabel={ariaLabel} />
      </div>
      <pre
        dir="ltr"
        className="whitespace-pre overflow-x-auto text-xs leading-relaxed bg-slate-900 text-slate-100 rounded-lg p-4 border border-slate-800"
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function StepSection({ number, title, description, statusBadge, children }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center text-base font-semibold shadow-md">
            {number}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            {description ? <p className="text-sm text-slate-600 mt-1">{description}</p> : null}
          </div>
        </div>
        {statusBadge ? <div className="flex items-center gap-2">{statusBadge}</div> : null}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 md:p-6 shadow-sm">
        {children}
      </div>
    </section>
  );
}

function DiagnosticsList({ diagnostics }) {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3" role="status" aria-live="polite">
      {diagnostics.map((item) => {
        const key = `${item.check_name}-${item.details}`;
        return (
          <div
            key={key}
            className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-slate-50 p-3"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
              {item.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-600" aria-hidden="true" />
              )}
              <span>{item.check_name}</span>
            </div>
            <p className="text-xs text-slate-600">{item.details}</p>
          </div>
        );
      })}
    </div>
  );
}

function extractMissingPolicyTables(diagnostics) {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
    return [];
  }

  const tables = new Set();
  const policyRegex = /^Policy "Allow full access to authenticated users on (.+)" exists$/;

  for (const item of diagnostics) {
    if (!item || item.success === true) {
      continue;
    }

    const checkName = typeof item.check_name === 'string' ? item.check_name : '';
    const match = checkName.match(policyRegex);
    if (!match) {
      continue;
    }

    const tableName = match[1];
    if (tableName) {
      tables.add(tableName);
    }
  }

  return Array.from(tables);
}

function buildMissingPoliciesFixSql(tableNames) {
  if (!Array.isArray(tableNames) || tableNames.length === 0) {
    return '';
  }

  const sanitized = tableNames
    .map((name) => String(name).replaceAll("'", "''"))
    .filter(Boolean);

  return `DO $$
DECLARE
  tbl text;
  policy_name text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    ${sanitized.map((name) => `'${name}'`).join(',\n    ')}
  ]
  LOOP
    -- Postgres identifiers are limited to 63 bytes; long policy names are silently truncated.
    policy_name := left('Allow full access to authenticated users on ' || tbl, 63);

    -- Enable RLS (safe to rerun)
    EXECUTE 'ALTER TABLE public.' || quote_ident(tbl) || ' ENABLE ROW LEVEL SECURITY';

    -- Recreate the expected policy (idempotent)
    EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(policy_name) || ' ON public.' || quote_ident(tbl);
    EXECUTE 'CREATE POLICY ' || quote_ident(policy_name) || ' ON public.' || quote_ident(tbl)
         || ' FOR ALL TO authenticated, app_user USING (true) WITH CHECK (true)';
  END LOOP;
END $$;`;
}

function RiskBadge({ riskLevel }) {
  if (riskLevel === 'SAFE') {
    return (
      <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200">
        בטוח
      </Badge>
    );
  }

  if (riskLevel === 'CAUTION') {
    return (
      <Badge className="bg-amber-100 text-amber-800 border border-amber-200">
        זהיר
      </Badge>
    );
  }

  return (
    <Badge className="bg-red-100 text-red-700 border border-red-200">
      מסוכן
    </Badge>
  );
}

export default function SetupAssistant() {
  const {
    activeOrg,
    activeOrgHasConnection,
    updateConnection,
    activeOrgConnection,
    recordVerification,
  } = useOrg();
  const { authClient, dataClient, loading, session } = useSupabase();
  const role = useUserRole();
  const membershipRole = activeOrg?.membership?.role ?? null;
  const isAdminMembership = membershipRole === 'admin' || membershipRole === 'owner';
  const isAdmin = isAdminMembership || role === 'admin' || role === 'owner';
  const [supabaseUrlInput, setSupabaseUrlInput] = useState('');
  const [supabaseAnonKeyInput, setSupabaseAnonKeyInput] = useState('');
  const [connectionSaving, setConnectionSaving] = useState(false);
  const [appKey, setAppKey] = useState('');
  const [isPasting, setIsPasting] = useState(false);
  const [validationState, setValidationState] = useState(VALIDATION_STATES.idle);
  const [validationError, setValidationError] = useState('');
  const [diagnostics, setDiagnostics] = useState([]);
  const [savingState, setSavingState] = useState('idle');
  const [savedAt, setSavedAt] = useState(activeOrg?.dedicated_key_saved_at || null);

  const [schemaSimpleMode, setSchemaSimpleMode] = useState(true);
  const [schemaPlan, setSchemaPlan] = useState(null);
  const [schemaPlanLoading, setSchemaPlanLoading] = useState(false);
  const [schemaPreflightLoading, setSchemaPreflightLoading] = useState(false);
  const [schemaApplySafeLoading, setSchemaApplySafeLoading] = useState(false);
  const [schemaApplyDangerLoading, setSchemaApplyDangerLoading] = useState(false);
  const [schemaDangerChecked, setSchemaDangerChecked] = useState(false);
  const [schemaDangerPhrase, setSchemaDangerPhrase] = useState('');

  useEffect(() => {
    setSavedAt(activeOrg?.dedicated_key_saved_at || null);
  }, [activeOrg?.dedicated_key_saved_at]);

  useEffect(() => {
    if (!activeOrgConnection) {
      return;
    }

    const nextUrl = typeof activeOrgConnection.supabaseUrl === 'string' ? activeOrgConnection.supabaseUrl : '';
    const nextKey = typeof activeOrgConnection.supabaseAnonKey === 'string' ? activeOrgConnection.supabaseAnonKey : '';

    setSupabaseUrlInput((current) => (current ? current : nextUrl));
    setSupabaseAnonKeyInput((current) => (current ? current : nextKey));
  }, [activeOrgConnection]);

  const supabaseReady = useMemo(() => !loading && Boolean(authClient) && Boolean(session), [authClient, loading, session]);

  const tenantId = activeOrg?.id || null;
  const schemaPlanId = schemaPlan?.plan_id || null;
  const schemaSafeCount = schemaPlan?.summary_counts?.SAFE ?? 0;
  const schemaCautionCount = schemaPlan?.summary_counts?.CAUTION ?? 0;
  const schemaDestructiveCount = schemaPlan?.summary_counts?.DESTRUCTIVE ?? 0;
  const schemaHasDrift = Boolean(schemaSafeCount || schemaCautionCount || schemaDestructiveCount);

  const missingPolicyTables = useMemo(() => extractMissingPolicyTables(diagnostics), [diagnostics]);
  const missingPoliciesFixSql = useMemo(
    () => buildMissingPoliciesFixSql(missingPolicyTables),
    [missingPolicyTables]
  );

  const handleGenerateSchemaPlan = useCallback(async () => {
    if (!tenantId) {
      toast.error('בחרו ארגון פעיל לפני יצירת תכנית שינויים.');
      return;
    }
    if (!isAdmin) {
      toast.error('אין הרשאה.');
      return;
    }
    if (!savedAt) {
      toast.error('לפני תיקוני סכימה יש להשלים שמירה של המפתח הייעודי (שלב 3).');
      return;
    }

    setSchemaPlanLoading(true);
    try {
      const res = await createSchemaPlan(tenantId);
      setSchemaPlan(res);
      toast.success('נוצרה תכנית שינויים לסכימה');
    } catch (error) {
      const message = error?.data?.message || error?.message || 'שגיאה ביצירת תכנית';
      const bootstrap = error?.data?.bootstrap_sql;
      if (bootstrap) {
        setSchemaPlan({
          error: message,
          bootstrap_sql: bootstrap,
          hint: error?.data?.hint,
        });
      }
      toast.error(message);
    } finally {
      setSchemaPlanLoading(false);
    }
  }, [tenantId, isAdmin, savedAt]);

  const handleRunSchemaPreflight = useCallback(async () => {
    if (!tenantId || !schemaPlanId) {
      toast.error('צרו תכנית שינויים לפני בדיקות מקדימות.');
      return;
    }

    setSchemaPreflightLoading(true);
    try {
      const res = await runSchemaPreflight(tenantId, schemaPlanId);
      setSchemaPlan((prev) => ({
        ...prev,
        preflight_results: res.preflight_results,
      }));
      toast.success('בדיקות מקדימות הושלמו');
    } catch (error) {
      const bootstrap = error?.data?.bootstrap_sql;
      if (bootstrap) {
        setSchemaPlan((prev) => ({
          ...prev,
          bootstrap_sql: bootstrap,
          hint: error?.data?.hint,
        }));
      }
      toast.error(error?.message || 'בדיקות מקדימות נכשלו');
    } finally {
      setSchemaPreflightLoading(false);
    }
  }, [tenantId, schemaPlanId]);

  const handleApplySchemaSafe = useCallback(async () => {
    if (!tenantId || !schemaPlanId) {
      toast.error('צרו תכנית שינויים לפני החלה.');
      return;
    }

    setSchemaApplySafeLoading(true);
    try {
      const res = await applySchemaSafe(tenantId, schemaPlanId);
      setSchemaPlan((prev) => ({ ...prev, apply_result: res }));
      toast.success('שינויים בטוחים הוחלו');
    } catch (error) {
      const bootstrap = error?.data?.bootstrap_sql;
      if (bootstrap) {
        setSchemaPlan((prev) => ({
          ...prev,
          bootstrap_sql: bootstrap,
          hint: error?.data?.hint,
        }));
      }
      toast.error(error?.message || 'החלת שינויים בטוחים נכשלה');
    } finally {
      setSchemaApplySafeLoading(false);
    }
  }, [tenantId, schemaPlanId]);

  const handleApplySchemaDestructive = useCallback(async () => {
    if (!tenantId || !schemaPlanId) {
      toast.error('צרו תכנית שינויים לפני החלה.');
      return;
    }

    setSchemaApplyDangerLoading(true);
    try {
      const res = await applySchemaDestructive(tenantId, schemaPlanId, schemaDangerPhrase);
      setSchemaPlan((prev) => ({ ...prev, apply_result: res }));
      toast.success('שינויים מסוכנים הוחלו');
    } catch (error) {
      toast.error(error?.message || 'החלת שינויים מסוכנים נכשלה');
    } finally {
      setSchemaApplyDangerLoading(false);
    }
  }, [tenantId, schemaPlanId, schemaDangerPhrase]);

  const handlePasteFromClipboard = async () => {
    try {
      setIsPasting(true);
      const text = await navigator.clipboard.readText();
      if (text) {
        setAppKey(text.trim());
      }
    } catch (error) {
      console.error('Failed to read clipboard contents', error);
      toast.error('לא הצלחנו לקרוא את הלוח. השתמשו ב-Ctrl+V/⌘+V כדי להדביק ידנית.');
    } finally {
      setIsPasting(false);
    }
  };

  const handleValidateAndSave = async () => {
    if (!activeOrg) {
      toast.error('בחרו ארגון פעיל לפני הפעלת האשף.');
      return;
    }
    if (!supabaseReady) {
      toast.error('חיבור Supabase עדיין נטען. נסו שוב בעוד רגע.');
      return;
    }
    if (!dataClient) {
      toast.error('חיבור הנתונים של הארגון אינו זמין. ודאו שפרטי Supabase נשמרו.');
      return;
    }

    const trimmedKey = appKey.trim();
    if (!trimmedKey) {
      setValidationError('הדביקו את המפתח הייעודי שנוצר בתום הסקריפט.');
      setValidationState(VALIDATION_STATES.error);
      return;
    }

    setValidationError('');
    setDiagnostics([]);
    setValidationState(VALIDATION_STATES.validating);
    setSavingState('saving');

    try {
      const { data, error } = await dataClient
        .schema('public')
        .rpc('setup_assistant_diagnostics');
      if (error) {
        throw error;
      }

      const normalizedDiagnostics = Array.isArray(data) ? data : [];
      setDiagnostics(normalizedDiagnostics);
      const allChecksPassed = normalizedDiagnostics.every((item) => item && item.success === true);

      if (!allChecksPassed) {
        setValidationState(VALIDATION_STATES.error);
        setValidationError('הבדיקה זיהתה רכיבים חסרים. הריצו מחדש את הסקריפט ונסו שוב.');
        return;
      }

      if (!authClient) {
        throw new Error('לקוח אימות של Supabase אינו זמין.');
      }

      const { data: authSession, error: sessionError } = await authClient.auth.getSession();
      if (sessionError) {
        throw sessionError;
      }

      const token = authSession?.session?.access_token ?? '';
      if (!token) {
        throw new Error('לא נמצא access token פעיל. התחברו מחדש ונסו שוב.');
      }

      const bearer = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
      const response = await fetch('/api/save-org-credentials', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: bearer,
          Authorization: bearer,
          'x-supabase-authorization': bearer,
          'X-Supabase-Authorization': bearer,
        },
        body: JSON.stringify({
          org_id: activeOrg.id,
          dedicated_key: trimmedKey,
        }),
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const message = typeof payload?.message === 'string' && payload.message
          ? payload.message
          : 'שמירת המפתח הייעודי נכשלה. בדקו את ההרשאות ונסו שוב.';
        throw new Error(message);
      }

      const savedTimestamp = typeof payload?.verified_at === 'string' && payload.verified_at
        ? payload.verified_at
        : typeof payload?.saved_at === 'string' && payload.saved_at
          ? payload.saved_at
          : new Date().toISOString();

      setSavedAt(savedTimestamp);
      setAppKey('');
      setValidationState(VALIDATION_STATES.success);
      toast.success('החיבור אומת והמפתח נשמר בהצלחה.');

      try {
        await recordVerification(activeOrg.id, savedTimestamp);
      } catch (recordError) {
        console.error('Failed to record verification timestamp', recordError);
      }
    } catch (error) {
      console.error('Setup assistant validation failed', error);
      const normalized = asError(error);
      const message = normalized?.message
        || 'האימות נכשל. ודאו שהסקריפט רץ בהצלחה ושהמפתח הייעודי תקין.';
      setValidationError(message);
      setValidationState(VALIDATION_STATES.error);
      toast.error(message);
    } finally {
      setSavingState('idle');
    }
  };

  const handleSaveSupabaseConnection = async () => {
    if (!activeOrg?.id) {
      toast.error('בחרו ארגון פעיל לפני שמירה.');
      return;
    }

    if (!isAdminMembership) {
      toast.error('אין הרשאה.');
      return;
    }

    const supabaseUrl = supabaseUrlInput.trim();
    const supabaseAnonKey = supabaseAnonKeyInput.trim();

    if (!supabaseUrl || !supabaseAnonKey) {
      toast.error('יש להזין Supabase URL ו-anon key.');
      return;
    }

    setConnectionSaving(true);
    try {
      await updateConnection(activeOrg.id, { supabaseUrl, supabaseAnonKey });
      toast.success('פרטי Supabase נשמרו.');
    } catch (error) {
      const normalized = asError(error);
      toast.error(normalized?.message || 'שמירת פרטי Supabase נכשלה.');
    } finally {
      setConnectionSaving(false);
    }
  };

  const renderValidationStatus = () => {
    if (validationState === VALIDATION_STATES.success) {
      return (
        <div className="flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
          <span>כל הבדיקות עברו בהצלחה. ניתן להתחיל להשתמש באפליקציה.</span>
        </div>
      );
    }

    if (validationState === VALIDATION_STATES.validating) {
      return (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span>מריץ בדיקות ומאחסן את המפתח...</span>
        </div>
      );
    }

    if (validationState === VALIDATION_STATES.error && validationError) {
      return (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5" aria-hidden="true" />
          <span>{validationError}</span>
        </div>
      );
    }

    return (
      <p className="text-sm text-slate-600">
        לאחר הרצת הסקריפט והדבקת המפתח, לחץ על "שמור ואמת" כדי להבטיח שהפונקציה public.setup_assistant_diagnostics() זמינה והמבנה תקין.
      </p>
    );
  };

  const validationBadge = validationState === VALIDATION_STATES.success
    ? (
        <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200">
          הארגון מוכן
        </Badge>
      )
    : validationState === VALIDATION_STATES.validating
      ? (
          <Badge className="bg-blue-100 text-blue-700 border border-blue-200">
            מבצע אימות
          </Badge>
        )
      : null;

  return (
    <Card className="border-0 shadow-xl bg-white/80" dir="rtl">
      <CardHeader className="border-b border-slate-200">
        <CardTitle className="text-2xl font-semibold text-slate-900 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>אשף הקמה לארגון חדש</span>
          {savedAt ? (
            <span className="text-sm font-normal text-slate-500">
              מפתח אחרון נשמר: {new Date(savedAt).toLocaleString('he-IL')}
            </span>
          ) : null}
        </CardTitle>
        <p className="text-sm text-slate-600">
          פעלו לפי השלבים כדי להכין את בסיס הנתונים של הארגון, להדביק את המפתח הייעודי ולוודא שהחיבור תקין.
        </p>
      </CardHeader>
      <CardContent className="space-y-8 p-6">
        <StepSection
          number={1}
          title="חיבור Supabase"
          description="הזינו את ה-URL וה-anon key של פרויקט Supabase שישמש את הנתונים של הארגון."
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reinex-supabase-url">Supabase URL</Label>
              <Input
                id="reinex-supabase-url"
                dir="ltr"
                value={supabaseUrlInput}
                onChange={(event) => setSupabaseUrlInput(event.target.value)}
                placeholder="https://xxxxx.supabase.co"
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reinex-supabase-anon-key">Supabase anon key</Label>
              <Input
                id="reinex-supabase-anon-key"
                dir="ltr"
                type="password"
                value={supabaseAnonKeyInput}
                onChange={(event) => setSupabaseAnonKeyInput(event.target.value)}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                autoComplete="off"
              />
              <p className="text-xs text-slate-500">
                הערכים נשמרים ב-control DB תחת org_settings ומשמשים ליצירת dataClient עבור הארגון.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={handleSaveSupabaseConnection}
                disabled={connectionSaving || !isAdminMembership}
                className="gap-2"
              >
                {connectionSaving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                {connectionSaving ? 'שומר…' : 'שמור פרטי Supabase'}
              </Button>
              <Badge className={activeOrgHasConnection ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-amber-100 text-amber-800 border border-amber-200'}>
                {activeOrgHasConnection ? 'חיבור פעיל' : 'אין חיבור'}
              </Badge>
            </div>
          </div>
        </StepSection>

        <StepSection
          number={2}
          title="הכנת בסיס הנתונים"
          description="הריצו את הסקריפט הקנוני ב-Supabase כדי ליצור את הסכימה והמדיניות עבור Reinex."
        >
          <div className="space-y-4 text-sm text-slate-600">
            <p>
              פתחו את ה-SQL Editor של פרויקט Supabase שלכם, הדביקו את הסקריפט המלא והפעילו אותו. הסקריפט ניתן להרצה חוזרת והוא דואג לניקוי מדיניות לפני יצירתן מחדש.
            </p>
            <CodeBlock
              title="סקריפט ההקמה הקנוני"
              code={SETUP_SQL_SCRIPT}
              ariaLabel="העתק את סקריפט ההקמה של Reinex"
            />
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
              בסוף ההרצה תופיע תוצאה בשם "APP_DEDICATED_KEY (COPY THIS BACK TO THE APP)". העתקו אותה – נשתמש בה בשלב הבא.
            </p>
          </div>
        </StepSection>

        <StepSection
          number={3}
          title="הדבקת המפתח הייעודי"
          description="הדביקו כאן את ה-JWT שנוצר בסוף הסקריפט ושמרו אותו בצורה מאובטחת."
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reinex-dedicated-key">המפתח הייעודי (APP_DEDICATED_KEY)</Label>
              <Textarea
                id="reinex-dedicated-key"
                value={appKey}
                onChange={(event) => setAppKey(event.target.value)}
                dir="ltr"
                rows={4}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              />
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span>השתמשו ב-Ctrl+V (או ⌘+V) כדי להדביק. ניתן גם להשתמש בכפתור ההדבקה.</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-2"
                  onClick={handlePasteFromClipboard}
                  disabled={isPasting}
                >
                  {isPasting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <ClipboardCopy className="w-4 h-4" aria-hidden="true" />}
                  הדבק מהלוח
                </Button>
              </div>
            </div>
          </div>
        </StepSection>

        <StepSection
          number={4}
          title="אימות ושמירה"
          description="נריץ את public.setup_assistant_diagnostics(), נשמור את המפתח ונאפשר גישה לאפליקציה."
          statusBadge={validationBadge}
        >
          <div className="space-y-4">
            {renderValidationStatus()}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={handleValidateAndSave}
                disabled={savingState === 'saving'}
                className="gap-2"
              >
                {savingState === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                {savingState === 'saving' ? 'שומר ומאמת...' : 'שמור ואמת'}
              </Button>
            </div>
            <DiagnosticsList diagnostics={diagnostics} />

            {missingPolicyTables.length > 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                <div className="text-sm font-medium text-amber-900">
                  נמצאו מדיניות RLS חסרות
                </div>
                <p className="text-xs text-amber-800">
                  העתיקו והריצו את ה-SQL הבא ב-Supabase SQL Editor של בסיס הנתונים של הארגון כדי ליצור את המדיניות החסרות בלבד.
                </p>
                <CodeBlock
                  title="SQL לתיקון מדיניות חסרות"
                  code={missingPoliciesFixSql}
                  ariaLabel="העתק SQL לתיקון מדיניות RLS חסרות"
                />
              </div>
            ) : null}
          </div>
        </StepSection>

        <StepSection
          number={5}
          title="תיקוני סכימה (Drift)"
          description="לאחר שהחיבור נשמר, ניתן לזהות סטייה מה-SSOT ולהחיל תיקונים בטוחים מתוך האפליקציה."
          statusBadge={schemaHasDrift ? <Badge className="bg-amber-100 text-amber-800 border border-amber-200">זוהתה סטייה</Badge> : <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200">מסונכרן</Badge>}
        >
          {!isAdmin ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              זמין למנהלים בלבד.
            </div>
          ) : null}

          {!savedAt ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              לפני תיקוני סכימה יש להשלים את שלב 3 (שמירת המפתח הייעודי).
            </div>
          ) : null}

          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-700">הסבר פשוט</span>
                <Switch
                  checked={schemaSimpleMode}
                  onCheckedChange={setSchemaSimpleMode}
                  aria-label="הסבר פשוט לתיקוני סכימה"
                />
              </div>
              {tenantId ? (
                <Button asChild variant="outline" size="sm">
                  <Link to={`/tenants/${tenantId}/settings/schema`}>פתח במסך מלא</Link>
                </Button>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={handleGenerateSchemaPlan}
                disabled={!isAdmin || !savedAt || schemaPlanLoading}
                className="gap-2"
              >
                {schemaPlanLoading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                {schemaPlanLoading ? 'בודק…' : 'צור תכנית שינויים'}
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={handleRunSchemaPreflight}
                disabled={!schemaPlanId || schemaPreflightLoading}
              >
                {schemaPreflightLoading ? 'בודק…' : 'בדיקות מקדימות'}
              </Button>

              <Button
                type="button"
                onClick={handleApplySchemaSafe}
                disabled={!schemaPlanId || schemaApplySafeLoading || schemaSafeCount === 0}
              >
                {schemaApplySafeLoading ? 'מחיל…' : 'החל שינויים בטוחים'}
              </Button>
            </div>

            {schemaPlan?.bootstrap_sql ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <p className="font-medium text-slate-900">נדרש Bootstrap</p>
                <p className="mt-1 text-sm text-slate-600">
                  {schemaPlan?.hint || 'יש להריץ את ה-SQL הבא פעם אחת ב-Supabase SQL Editor ואז לנסות שוב.'}
                </p>
                <div className="mt-3">
                  <CodeBlock
                    title="Bootstrap SQL"
                    code={schemaPlan.bootstrap_sql}
                    ariaLabel="העתק Bootstrap SQL"
                  />
                </div>
              </div>
            ) : null}

            {schemaPlan?.summary_counts ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200">בטוח: {schemaSafeCount}</Badge>
                <Badge className="bg-amber-100 text-amber-800 border border-amber-200">זהיר: {schemaCautionCount}</Badge>
                <Badge className="bg-red-100 text-red-700 border border-red-200">מסוכן: {schemaDestructiveCount}</Badge>
              </div>
            ) : null}

            {schemaPlan?.patch_sql_safe ? (
              <CodeBlock
                title="SQL לתיקונים בטוחים"
                code={schemaPlan.patch_sql_safe}
                ariaLabel="העתק SQL לתיקונים בטוחים"
              />
            ) : null}

            {Array.isArray(schemaPlan?.changes) && schemaPlan.changes.length ? (
              <div className="space-y-3">
                <p className="text-sm font-medium text-slate-800">שינויים שנמצאו</p>
                <div className="space-y-2">
                  {schemaPlan.changes.map((change) => (
                    <details key={change.change_id} className="rounded-xl border border-slate-200 bg-white p-3">
                      <summary className="cursor-pointer list-none">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-2">
                            <RiskBadge riskLevel={change.risk_level} />
                            <span className="text-sm font-medium text-slate-900">{change.title}</span>
                          </div>
                          <span className="text-xs text-slate-500">{change.category}/{change.action}</span>
                        </div>
                      </summary>
                      <div className="mt-2 space-y-2">
                        {schemaSimpleMode ? (
                          <p className="text-sm text-slate-700">{change.reason}</p>
                        ) : null}
                        {!schemaSimpleMode ? (
                          <CodeBlock
                            title="SQL Preview"
                            code={change.sql_preview || ''}
                            ariaLabel="העתק SQL preview"
                          />
                        ) : null}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            ) : null}

            {schemaPlan?.manual_steps ? (
              <CodeBlock
                title="שלבים ידניים (Markdown)"
                code={schemaPlan.manual_steps}
                ariaLabel="העתק שלבים ידניים"
              />
            ) : null}

            {(schemaCautionCount > 0 || schemaDestructiveCount > 0) ? (
              <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-medium text-red-900">שינויים מסוכנים</p>
                <p className="text-sm text-red-800">
                  החלה מסוכנת דורשת אישור מפורש. הקלידו בדיוק את הביטוי הבא.
                </p>

                <div className="flex items-center gap-2">
                  <input
                    id="schema-danger-check"
                    type="checkbox"
                    checked={schemaDangerChecked}
                    onChange={(e) => setSchemaDangerChecked(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <label htmlFor="schema-danger-check" className="text-sm text-red-900">
                    אני מבין/ה שזה עלול להשפיע על נתונים
                  </label>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="schema-danger-phrase">הקלידו בדיוק:</Label>
                  <Input
                    id="schema-danger-phrase"
                    dir="ltr"
                    value={schemaDangerPhrase}
                    onChange={(e) => setSchemaDangerPhrase(e.target.value)}
                    placeholder={REQUIRED_DESTRUCTIVE_PHRASE}
                  />
                </div>

                <Button
                  type="button"
                  variant="destructive"
                  disabled={
                    !schemaPlanId
                    || schemaApplyDangerLoading
                    || !schemaDangerChecked
                    || schemaDangerPhrase !== REQUIRED_DESTRUCTIVE_PHRASE
                  }
                  onClick={handleApplySchemaDestructive}
                >
                  {schemaApplyDangerLoading ? 'מחיל…' : 'החל שינויים מסוכנים'}
                </Button>
              </div>
            ) : null}
          </div>
        </StepSection>
      </CardContent>
    </Card>
  );
}
