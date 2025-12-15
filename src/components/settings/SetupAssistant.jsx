import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { SETUP_SQL_SCRIPT } from '@/lib/setup-sql.js';
import { asError } from '@/lib/error-utils.js';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCopy,
  Loader2,
} from 'lucide-react';

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

export default function SetupAssistant() {
  const { activeOrg, recordVerification } = useOrg();
  const { authClient, dataClient, loading, session } = useSupabase();
  const [appKey, setAppKey] = useState('');
  const [isPasting, setIsPasting] = useState(false);
  const [validationState, setValidationState] = useState(VALIDATION_STATES.idle);
  const [validationError, setValidationError] = useState('');
  const [diagnostics, setDiagnostics] = useState([]);
  const [savingState, setSavingState] = useState('idle');
  const [savedAt, setSavedAt] = useState(activeOrg?.dedicated_key_saved_at || null);

  useEffect(() => {
    setSavedAt(activeOrg?.dedicated_key_saved_at || null);
  }, [activeOrg?.dedicated_key_saved_at]);

  const supabaseReady = useMemo(() => !loading && Boolean(authClient) && Boolean(session), [authClient, loading, session]);

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
      const { data, error } = await dataClient.rpc('tuttiud.setup_assistant_diagnostics');
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
        לאחר הרצת הסקריפט והדבקת המפתח, לחץ על "שמור ואמת" כדי להבטיח שהפונקציה tuttiud.setup_assistant_diagnostics() זמינה והמבנה תקין.
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
          title="הכנת בסיס הנתונים"
          description="הריצו את הסקריפט הקנוני ב-Supabase כדי ליצור את הסכימה והמדיניות עבור תותיעוד."
        >
          <div className="space-y-4 text-sm text-slate-600">
            <p>
              פתחו את ה-SQL Editor של פרויקט Supabase שלכם, הדביקו את הסקריפט המלא והפעילו אותו. הסקריפט ניתן להרצה חוזרת והוא דואג לניקוי מדיניות לפני יצירתן מחדש.
            </p>
            <CodeBlock
              title="סקריפט ההקמה הקנוני"
              code={SETUP_SQL_SCRIPT}
              ariaLabel="העתק את סקריפט ההקמה של תותיעוד"
            />
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
              בסוף ההרצה תופיע תוצאה בשם "APP_DEDICATED_KEY (COPY THIS BACK TO THE APP)". העתקו אותה – נשתמש בה בשלב הבא.
            </p>
          </div>
        </StepSection>

        <StepSection
          number={2}
          title="הדבקת המפתח הייעודי"
          description="הדביקו כאן את ה-JWT שנוצר בסוף הסקריפט ושמרו אותו בצורה מאובטחת."
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tuttiud-dedicated-key">המפתח הייעודי (APP_DEDICATED_KEY)</Label>
              <Textarea
                id="tuttiud-dedicated-key"
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
          number={3}
          title="אימות ושמירה"
          description="נריץ את tuttiud.setup_assistant_diagnostics(), נשמור את המפתח ונאפשר גישה לאפליקציה."
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
          </div>
        </StepSection>
      </CardContent>
    </Card>
  );
}
