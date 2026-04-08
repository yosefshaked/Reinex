import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { activateConfig, getRuntimeConfigDiagnostics } from './config.js';

function maskToken(token) {
  if (!token) {
    return '—';
  }
  const trimmed = token.trim();
  if (trimmed.length <= 8) {
    return trimmed;
  }
  return `${trimmed.slice(0, 4)}•••${trimmed.slice(-4)}`;
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return 'לפני רגע';
  }

  try {
    return new Date(timestamp).toLocaleString('he-IL');
  } catch {
    return 'לפני רגע';
  }
}

function formatScope(scope) {
  return scope === 'org' ? 'הגדרות ארגון' : 'הגדרות מערכת';
}

function escapeDoubleQuotes(value) {
  return String(value || '').replace(/"/g, '\\"');
}

function isLikelyOwnerContext() {
  if (typeof window === 'undefined') {
    return false;
  }

  const hostname = window.location.hostname || '';
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function summarizeFailure(error, diagnostics) {
  const rawMessage = error?.message || '';
  const code = diagnostics.error || '';
  const status = diagnostics.status;

  if (code === 'network-failure') {
    return {
      title: 'המערכת לא הצליחה להתחבר לשרת',
      message: 'האתר נטען, אבל כרגע אין אפשרות למשוך את הגדרות ההפעלה שלו. בדרך כלל זו תקלה זמנית של שרת, רשת או פריסה.',
      badge: 'בעיית חיבור',
      tone: 'warning',
      actions: [
        'רעננו את העמוד בעוד כמה שניות.',
        'אם התקלה נמשכת, פנו לבעל/ת האתר או למי שמנהל/ת את המערכת.',
      ],
    };
  }

  if (code === 'missing-keys' || rawMessage.includes('supabase_url') || rawMessage.includes('anon_key')) {
    return {
      title: 'המערכת עדיין לא הוגדרה עד הסוף',
      message: 'האתר חסר כרגע הגדרות חיבור בסיסיות ולכן אי אפשר להפעיל אותו. זו תקלה ברמת ההגדרות, לא פעולה שבמשתמש הקצה יכול/ה לפתור.',
      badge: 'חסרות הגדרות',
      tone: 'danger',
      actions: [
        'אין צורך לנסות שוב שוב אם זה קורה מיד בכל טעינה.',
        'העבירו לבעל/ת האתר את קוד התקלה והזמן שמופיעים למטה.',
      ],
    };
  }

  if (status === 401 || status === 403) {
    return {
      title: 'אין הרשאה לטעון את המערכת כרגע',
      message: 'נראה שהבקשה להגדרות נדחתה. ייתכן שתוקף ההתחברות פג או שיש בעיית הרשאות זמנית.',
      badge: 'בעיית הרשאה',
      tone: 'warning',
      actions: [
        'נסו לרענן את העמוד ולהתחבר מחדש.',
        'אם זה ממשיך, פנו לבעל/ת האתר עם קוד התקלה.',
      ],
    };
  }

  if (status && status >= 500) {
    return {
      title: 'יש כרגע תקלה פנימית במערכת',
      message: 'האתר נפתח, אבל שירות פנימי שאחראי על ההפעלה שלו נכשל. בדרך כלל זו תקלה בצד השרת או בפריסה האחרונה.',
      badge: 'שגיאת שרת',
      tone: 'danger',
      actions: [
        'נסו לרענן את העמוד פעם אחת.',
        'אם זה לא משתפר, שלחו לבעל/ת האתר את קוד התקלה והזמן.',
      ],
    };
  }

  return {
    title: 'המערכת לא הצליחה לעלות',
    message: 'האתר לא הצליח להשלים את טעינת ההגדרות הדרושות להפעלה. נדרשת בדיקה של מי שמנהל/ת את המערכת.',
    badge: 'טעינה נכשלה',
    tone: 'neutral',
    actions: [
      'נסו לרענן את העמוד.',
      'אם התקלה נשארת, העבירו לבעל/ת האתר את פרטי התקלה שמופיעים כאן.',
    ],
  };
}

function buildOwnerChecklist(diagnostics) {
  const code = diagnostics.error || '';
  const status = diagnostics.status;
  const items = [];

  if (code === 'network-failure') {
    items.push('בדוק/י שהפונקציות זמינות ושהפריסה של Azure Static Web Apps עלתה תקין.');
    items.push('בדוק/י שאין חסימה של רשת, VPN או proxy על ‎/api/config‎.');
  } else if (code === 'response-not-json' || code === 'invalid-json') {
    items.push('בדוק/י שהפונקציה מחזירה JSON תקין עם כותרת Content-Type מתאימה.');
    items.push('בדוק/י שאין HTML של שגיאת שרת או פלט debug מודפס לפני ה-JSON.');
  } else if (code === 'missing-keys') {
    items.push('בדוק/י את ערכי החיבור הציבוריים של Supabase בסביבת הפריסה.');
  } else if (status === 401 || status === 403) {
    items.push('בדוק/י את כותרות ה-Bearer ואת אימות ההרשאות של בקשת הארגון.');
  } else if (status && status >= 500) {
    items.push('פתח/י את לוגי הפונקציה שנכשלה ובדוק/י את החריגה המלאה.');
  }

  items.push('אם עדכנת משתני סביבה לאחרונה, ודא/י שהם זמינים בפועל בזמן הריצה של הפונקציה.');
  items.push('השתמש/י בבדיקה הידנית למטה רק אם צריך לאמת שהפונקציה עצמה חזרה לעבוד.');

  return Array.from(new Set(items));
}

function getFailureCode(diagnostics) {
  if (!diagnostics) {
    return 'runtime-config-bootstrap-failed';
  }

  const parts = [
    'runtime-config',
    diagnostics.scope || 'app',
    diagnostics.status ?? 'no-status',
    diagnostics.error || 'unknown',
  ];

  return parts.join(':');
}

function InfoRow({ label, value, mono = false }) {
  return (
    <div style={styles.infoRow}>
      <span style={styles.infoLabel}>{label}</span>
      <span style={{ ...styles.infoValue, ...(mono ? styles.mono : null) }}>{value || '—'}</span>
    </div>
  );
}

function OwnerPanel({ diagnostics }) {
  const [manualOrgId, setManualOrgId] = useState(diagnostics.orgId || '');
  const [manualToken, setManualToken] = useState(diagnostics.accessToken || '');
  const [showToken, setShowToken] = useState(false);
  const [copyCurlState, setCopyCurlState] = useState('idle');
  const [testState, setTestState] = useState({
    status: 'idle',
    httpStatus: null,
    error: '',
    output: '',
    lastConfig: null,
  });

  const trimmedToken = manualToken.trim();
  const trimmedOrgId = manualOrgId.trim();
  const endpoint = trimmedOrgId ? `/api/org/${encodeURIComponent(trimmedOrgId)}/keys` : '/api/config';
  const tokenPreview = trimmedToken ? (showToken ? trimmedToken : maskToken(trimmedToken)) : 'לא הוזן';
  const checklist = useMemo(() => buildOwnerChecklist(diagnostics), [diagnostics]);

  const curlCommand = useMemo(() => {
    const baseUrl = `${window.location.origin}${endpoint}`;
    const parts = ['curl', '-i', '-H "Accept: application/json"'];
    if (trimmedToken) {
      parts.push(`-H "X-Supabase-Authorization: Bearer ${escapeDoubleQuotes(trimmedToken)}"`);
    }
    parts.push(`"${baseUrl}"`);
    return parts.join(' ');
  }, [endpoint, trimmedToken]);

  const resetCopyLater = (setter) => {
    setTimeout(() => setter('idle'), 1600);
  };

  const handleCopyCurl = async () => {
    try {
      await navigator.clipboard.writeText(curlCommand);
      setCopyCurlState('copied');
    } catch {
      setCopyCurlState('failed');
    }
    resetCopyLater(setCopyCurlState);
  };

  const handleTestRequest = async () => {
    setTestState({
      status: 'loading',
      httpStatus: null,
      error: '',
      output: '',
      lastConfig: null,
    });

    try {
      const headers = { Accept: 'application/json' };
      if (trimmedToken) {
        headers['X-Supabase-Authorization'] = `Bearer ${trimmedToken}`;
      }

      const response = await fetch(endpoint, {
        method: 'GET',
        headers,
        cache: 'no-store',
      });

      const text = await response.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }

      if (!response.ok) {
        const errorText = typeof parsed === 'string'
          ? parsed || `HTTP ${response.status}`
          : parsed?.error || parsed?.message || JSON.stringify(parsed, null, 2);

        setTestState({
          status: 'error',
          httpStatus: response.status,
          error: errorText,
          output: '',
          lastConfig: null,
        });
        return;
      }

      const supabaseUrl = typeof parsed?.supabaseUrl === 'string'
        ? parsed.supabaseUrl
        : typeof parsed?.supabase_url === 'string'
          ? parsed.supabase_url
          : '';
      const anonKey = typeof parsed?.supabaseAnonKey === 'string'
        ? parsed.supabaseAnonKey
        : typeof parsed?.supabase_anon_key === 'string'
          ? parsed.supabase_anon_key
          : typeof parsed?.anon_key === 'string'
            ? parsed.anon_key
            : '';

      setTestState({
        status: 'success',
        httpStatus: response.status,
        error: '',
        output: typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2),
        lastConfig: supabaseUrl && anonKey
          ? { supabaseUrl: supabaseUrl.trim(), supabaseAnonKey: anonKey.trim() }
          : null,
      });
    } catch (error) {
      setTestState({
        status: 'error',
        httpStatus: null,
        error: error?.message || 'הבדיקה נכשלה.',
        output: '',
        lastConfig: null,
      });
    }
  };

  const handleLaunchWithConfig = async () => {
    if (!testState.lastConfig) {
      return;
    }

    try {
      await activateConfig(testState.lastConfig, { source: 'manual' });
      const { renderApp } = await import('../main.jsx');
      renderApp(testState.lastConfig);
    } catch (error) {
      setTestState((current) => ({
        ...current,
        status: 'error',
        error: error?.message || 'טעינת האפליקציה עם ההגדרות שנבדקו נכשלה.',
      }));
    }
  };

  return (
    <details style={styles.ownerPanel} open={isLikelyOwnerContext()}>
      <summary style={styles.ownerSummary}>מידע טכני לבעל/ת האתר</summary>

      <div style={styles.ownerSection}>
        <p style={styles.ownerLead}>
          זה החלק הטכני. משתמשים רגילים לא צריכים אותו. כאן מרוכזים הסימנים הכי חשובים כדי להבין מה נשבר באמת.
        </p>

        <div style={styles.infoGrid}>
          <InfoRow label="מקור הבקשה" value={formatScope(diagnostics.scope)} />
          <InfoRow label="Endpoint" value={diagnostics.endpoint || '/api/config'} mono />
          <InfoRow label="סטטוס HTTP" value={diagnostics.status !== null ? String(diagnostics.status) : '—'} />
          <InfoRow label="קוד אבחון" value={diagnostics.error || '—'} mono />
          <InfoRow label="ארגון" value={diagnostics.orgId || '—'} mono />
          <InfoRow label="זמן אחרון" value={formatTimestamp(diagnostics.timestamp)} />
        </div>
      </div>

      <div style={styles.ownerSection}>
        <h3 style={styles.subTitle}>פירוש מהיר לבעל/ת האתר</h3>
        <ul style={styles.checklist}>
          {checklist.map((item) => (
            <li key={item} style={styles.checklistItem}>{item}</li>
          ))}
        </ul>
      </div>

      <div style={styles.ownerSection}>
        <h3 style={styles.subTitle}>בדיקה ידנית</h3>
        <div style={styles.fieldGrid}>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>מזהה ארגון לבדיקה</span>
            <input
              style={styles.input}
              value={manualOrgId}
              onChange={(event) => setManualOrgId(event.target.value)}
              placeholder="אפשר להשאיר ריק כדי לבדוק /api/config"
            />
          </label>

          <label style={styles.field}>
            <span style={styles.fieldLabel}>Bearer token אופציונלי</span>
            <textarea
              style={styles.textarea}
              value={manualToken}
              onChange={(event) => setManualToken(event.target.value)}
              placeholder="נדרש רק לבדיקת /api/org/:id/keys"
              rows={3}
            />
          </label>
        </div>

        <div style={styles.tokenRow}>
          <span style={styles.tokenPreview}>{tokenPreview}</span>
          <button type="button" style={styles.ghostButton} onClick={() => setShowToken((value) => !value)}>
            {showToken ? 'הסתר טוקן' : 'הצג טוקן'}
          </button>
        </div>

        <label style={styles.field}>
          <span style={styles.fieldLabel}>פקודת בדיקה</span>
          <textarea style={styles.codeBlock} readOnly value={curlCommand} rows={3} />
        </label>

        <div style={styles.buttonRow}>
          <button type="button" style={styles.secondaryButton} onClick={handleCopyCurl}>
            {copyCurlState === 'copied' ? 'הועתק' : copyCurlState === 'failed' ? 'העתקה נכשלה' : 'העתק פקודת curl'}
          </button>
          <button
            type="button"
            style={styles.primaryButton}
            onClick={handleTestRequest}
            disabled={testState.status === 'loading'}
          >
            {testState.status === 'loading' ? 'בודק…' : 'בדוק עכשיו'}
          </button>
        </div>

        {testState.status === 'error' ? (
          <div style={styles.errorBox}>
            <strong>הבדיקה נכשלה</strong>
            <span>{testState.error}</span>
            {testState.httpStatus !== null ? <span>HTTP {testState.httpStatus}</span> : null}
          </div>
        ) : null}

        {testState.status === 'success' ? (
          <div style={styles.successBox}>
            <strong>התגובה שהתקבלה</strong>
            <pre style={styles.pre}>{testState.output}</pre>
            {testState.lastConfig ? (
              <button type="button" style={styles.primaryButton} onClick={handleLaunchWithConfig}>
                נסה לטעון את האתר עם התגובה הזאת
              </button>
            ) : (
              <span style={styles.noteText}>התגובה תקינה לבדיקה, אבל לא כללה מפתחות חיבור לשיגור טעינה אוטומטית.</span>
            )}
          </div>
        ) : null}

        {diagnostics.bodyText ? (
          <div style={styles.rawBodyBox}>
            <strong style={styles.rawBodyTitle}>תוכן תשובה גולמי</strong>
            <pre style={styles.pre}>{diagnostics.bodyText}</pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function renderConfigError(error) {
  const container = document.getElementById('root');
  if (!container) {
    return;
  }

  const root = ReactDOM.createRoot(container);
  root.render(<ConfigErrorScreen error={error} />);
}

function ConfigErrorScreen({ error }) {
  const diagnostics = useMemo(() => getRuntimeConfigDiagnostics(), []);
  const summary = useMemo(() => summarizeFailure(error, diagnostics), [error, diagnostics]);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState('');

  const failureCode = getFailureCode(diagnostics);

  const handleReload = () => {
    setIsRetrying(true);
    window.location.reload();
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(
        [
          `Failure Code: ${failureCode}`,
          `Time: ${formatTimestamp(diagnostics.timestamp)}`,
          `Endpoint: ${diagnostics.endpoint || '/api/config'}`,
          `HTTP: ${diagnostics.status ?? '—'}`,
        ].join('\n'),
      );
      setRetryMessage('פרטי התקלה הועתקו.');
    } catch {
      setRetryMessage('לא הצלחנו להעתיק. אפשר לצלם מסך ולהעביר לבעל/ת האתר.');
    }

    setTimeout(() => setRetryMessage(''), 1800);
  };

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <section style={styles.heroCard}>
          <div style={styles.heroTopRow}>
            <span style={{ ...styles.badge, ...(summary.tone === 'danger' ? styles.badgeDanger : summary.tone === 'warning' ? styles.badgeWarning : styles.badgeNeutral) }}>
              {summary.badge}
            </span>
            <span style={styles.timestamp}>עודכן: {formatTimestamp(diagnostics.timestamp)}</span>
          </div>

          <h1 style={styles.title}>{summary.title}</h1>
          <p style={styles.message}>{summary.message}</p>

          <div style={styles.userActionsBox}>
            <h2 style={styles.sectionTitle}>מה אפשר לעשות עכשיו</h2>
            <ul style={styles.userActionList}>
              {summary.actions.map((item) => (
                <li key={item} style={styles.userActionItem}>{item}</li>
              ))}
            </ul>

            <div style={styles.buttonRow}>
              <button type="button" style={styles.primaryButton} onClick={handleReload} disabled={isRetrying}>
                {isRetrying ? 'מרענן…' : 'נסה שוב'}
              </button>
              <button type="button" style={styles.secondaryButton} onClick={handleCopyCode}>
                העתק פרטי תקלה
              </button>
            </div>

            {retryMessage ? <p style={styles.feedbackText}>{retryMessage}</p> : null}
          </div>
        </section>

        <section style={styles.metaCard}>
          <h2 style={styles.sectionTitle}>פרטים שאפשר להעביר לבעל/ת האתר</h2>
          <div style={styles.infoGrid}>
            <InfoRow label="קוד תקלה" value={failureCode} mono />
            <InfoRow label="סוג תקלה" value={formatScope(diagnostics.scope)} />
            <InfoRow label="Endpoint" value={diagnostics.endpoint || '/api/config'} mono />
            <InfoRow label="סטטוס HTTP" value={diagnostics.status !== null ? String(diagnostics.status) : '—'} />
          </div>
        </section>

        <OwnerPanel diagnostics={diagnostics} />
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: 'radial-gradient(circle at top right, #fef3c7 0%, #f8fafc 38%, #e0f2fe 100%)',
    padding: '32px 20px',
    display: 'flex',
    justifyContent: 'center',
  },
  shell: {
    width: '100%',
    maxWidth: '920px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  heroCard: {
    backgroundColor: '#ffffff',
    borderRadius: '28px',
    boxShadow: '0 28px 80px rgba(15, 23, 42, 0.14)',
    padding: '32px',
    border: '1px solid rgba(148, 163, 184, 0.22)',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  metaCard: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    backdropFilter: 'blur(10px)',
    borderRadius: '24px',
    padding: '24px',
    border: '1px solid rgba(148, 163, 184, 0.24)',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  heroTopRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: '999px',
    padding: '8px 14px',
    fontSize: '13px',
    fontWeight: 700,
  },
  badgeDanger: {
    backgroundColor: '#fee2e2',
    color: '#b91c1c',
  },
  badgeWarning: {
    backgroundColor: '#fef3c7',
    color: '#92400e',
  },
  badgeNeutral: {
    backgroundColor: '#e2e8f0',
    color: '#334155',
  },
  timestamp: {
    color: '#64748b',
    fontSize: '13px',
  },
  title: {
    margin: 0,
    color: '#0f172a',
    fontSize: '32px',
    lineHeight: 1.2,
    fontWeight: 800,
  },
  message: {
    margin: 0,
    color: '#475569',
    fontSize: '18px',
    lineHeight: 1.75,
  },
  userActionsBox: {
    background: 'linear-gradient(180deg, #fff7ed 0%, #ffffff 100%)',
    border: '1px solid #fed7aa',
    borderRadius: '22px',
    padding: '22px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  sectionTitle: {
    margin: 0,
    color: '#0f172a',
    fontSize: '18px',
    fontWeight: 700,
  },
  subTitle: {
    margin: 0,
    color: '#0f172a',
    fontSize: '16px',
    fontWeight: 700,
  },
  userActionList: {
    margin: 0,
    paddingInlineStart: '18px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  userActionItem: {
    color: '#334155',
    lineHeight: 1.6,
  },
  buttonRow: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  primaryButton: {
    border: 'none',
    borderRadius: '999px',
    background: 'linear-gradient(90deg, #1d4ed8 0%, #2563eb 100%)',
    color: '#ffffff',
    fontWeight: 700,
    fontSize: '14px',
    padding: '12px 18px',
    cursor: 'pointer',
    boxShadow: '0 16px 36px rgba(37, 99, 235, 0.28)',
  },
  secondaryButton: {
    border: '1px solid #cbd5e1',
    borderRadius: '999px',
    backgroundColor: '#ffffff',
    color: '#0f172a',
    fontWeight: 700,
    fontSize: '14px',
    padding: '12px 18px',
    cursor: 'pointer',
  },
  ghostButton: {
    border: 'none',
    background: 'none',
    color: '#2563eb',
    fontWeight: 700,
    fontSize: '13px',
    cursor: 'pointer',
    padding: 0,
  },
  feedbackText: {
    margin: 0,
    color: '#1d4ed8',
    fontSize: '13px',
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '12px',
  },
  infoRow: {
    backgroundColor: '#f8fafc',
    borderRadius: '16px',
    border: '1px solid #e2e8f0',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  infoLabel: {
    color: '#64748b',
    fontSize: '12px',
    fontWeight: 600,
  },
  infoValue: {
    color: '#0f172a',
    fontSize: '15px',
    fontWeight: 700,
    wordBreak: 'break-word',
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: '13px',
  },
  ownerPanel: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    border: '1px solid rgba(148, 163, 184, 0.24)',
    borderRadius: '24px',
    padding: '22px 24px',
  },
  ownerSummary: {
    cursor: 'pointer',
    color: '#0f172a',
    fontSize: '16px',
    fontWeight: 800,
    outline: 'none',
  },
  ownerLead: {
    margin: 0,
    color: '#475569',
    lineHeight: 1.7,
    fontSize: '14px',
  },
  ownerSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    marginTop: '18px',
  },
  checklist: {
    margin: 0,
    paddingInlineStart: '18px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  checklistItem: {
    color: '#334155',
    lineHeight: 1.6,
  },
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '14px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  fieldLabel: {
    color: '#334155',
    fontSize: '13px',
    fontWeight: 700,
  },
  input: {
    borderRadius: '12px',
    border: '1px solid #cbd5e1',
    padding: '11px 12px',
    fontSize: '14px',
    direction: 'ltr',
    backgroundColor: '#ffffff',
  },
  textarea: {
    borderRadius: '12px',
    border: '1px solid #cbd5e1',
    padding: '11px 12px',
    fontSize: '14px',
    direction: 'ltr',
    resize: 'vertical',
    backgroundColor: '#ffffff',
  },
  tokenRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
  },
  tokenPreview: {
    color: '#334155',
    fontFamily: 'monospace',
    fontSize: '13px',
    wordBreak: 'break-all',
  },
  codeBlock: {
    borderRadius: '14px',
    border: '1px solid #cbd5e1',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    padding: '14px',
    fontFamily: 'monospace',
    fontSize: '13px',
    resize: 'none',
    direction: 'ltr',
  },
  errorBox: {
    borderRadius: '16px',
    border: '1px solid #fecaca',
    backgroundColor: '#fef2f2',
    color: '#b91c1c',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  successBox: {
    borderRadius: '16px',
    border: '1px solid #a7f3d0',
    backgroundColor: '#ecfdf5',
    color: '#047857',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  rawBodyBox: {
    borderRadius: '16px',
    border: '1px solid #e2e8f0',
    backgroundColor: '#f8fafc',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  rawBodyTitle: {
    color: '#0f172a',
  },
  pre: {
    margin: 0,
    maxHeight: '220px',
    overflow: 'auto',
    borderRadius: '12px',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    padding: '12px',
    fontSize: '12px',
    direction: 'ltr',
  },
  noteText: {
    fontSize: '13px',
    lineHeight: 1.6,
  },
};

export default ConfigErrorScreen;
