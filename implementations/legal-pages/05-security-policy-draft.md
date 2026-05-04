# טיוטת מדיניות אבטחת מידע - Reinex

תאריך תחילה: `TODO owner/legal`  

חשוב: טיוטה לבדיקה אבטחתית ומשפטית. אין במסמך זה טענה לעמידה ב-ISO, SOC2, HIPAA, GDPR או תקן אחר שלא אומת ואושר.

## 1. גישת אבטחה

Reinex נועדה להגן על מידע תפעולי ורגיש של ארגונים, לרבות מידע על תלמידים/לקוחות, עובדים, שיעורים, נוכחות, תיעוד, חיוב, שכר וגורמים מממנים. בקרות האבטחה מתבססות על הפרדת ארגונים, הרשאות לפי תפקיד, בדיקות צד שרת, לוגים ונהלי פיתוח זהירים.

## 2. בקרות ידועות לפי הקוד

- Supabase Auth משמש לאימות משתמשים, כולל email/password, Google ו-Microsoft.
- Auth flow משתמש ב-PKCE ו-session persisted.
- נתוני tenant נמצאים במסד נתונים יחיד, עם `org_id` בטבלאות tenant.
- RLS מתועד כמנגנון בידוד מרכזי.
- Backend APIs משתמשים ב-service_role ולכן נדרשת אכיפה תוכנתית של `ensureMembership()` וסינון `.eq('org_id', orgId)` או helper מקביל.
- frontend שולח `x-org-id` דרך `authenticatedFetch`.
- הרשאות מבוססות תפקידים, כגון owner/admin/office/member, ומדריכים עשויים להיות self-scoped.
- system admin ו-organization admin הם אזורי גישה נפרדים.
- secrets נקראים ממשתני סביבה.
- BYOS credentials encryption משתמש ב-AES-256-GCM לפי מסמכי הפרויקט.
- קיימים או עשויים להתקיים audit logs, email logs ו-impersonation sessions.
- HTTPS/TLS צפוי להינתן דרך ספקי הענן והתצורה בפועל.

## 3. סיכונים ידועים

- Supabase tokens נשמרים ב-localStorage תחת `app-main-auth-session`; XSS עלול להיות סיכון גבוה.
- Admin impersonation שומר access/refresh tokens ב-sessionStorage תחת `reinex_impersonation_v1`.
- sessionStorage עשוי להכיל מידע אישי/רגיש בסקירות יומן, טיוטות פיננסיות ופילטרים.
- PostHog עשוי לשמש ל-product analytics, diagnostics, performance monitoring ושיפור השירות אם מוגדר key. Session Replay כבוי וחייב להישאר כבוי כל עוד Reinex עשויה לעבד או להציג מידע אישי/רגיש. Web autocapture כבוי לפי החלטת MVP.
- גיבויים/שחזור לא אומתו כמנגנון מובטח ואין לתארם כך בשלב MVP.

## 4. אחריות הלקוח

- כל משתמש צריך חשבון אישי.
- אסור לשתף סיסמאות או לעקוף הרשאות.
- הארגון אחראי להקצות ולהסיר הרשאות.
- הארגון אחראי לוודא שהמידע מוזן כדין ושנשמרים תיעוד וגיבויים נוספים לפי הצורך.
- יש לדווח במהירות על חשד לגישה לא מורשית או אירוע אבטחה.

## 5. TODO לפני השקה חיצונית

- TODO security: לאמת MFA ל-system admin ולתעד דרישה.
- TODO security: לבחון הפחתת סיכון tokens ב-browser storage.
- TODO security: לאמת audit coverage ל-impersonation, permissions, billing, payroll ו-health/therapy data.
- TODO infra: לוודא Azure/Application Insights/logging בפועל.
- TODO infra: לוודא backup content, storage location, restore test ו-retention.
- TODO privacy: לפני production/customer launch לוודא ב-PostHog dashboard ש-Session Replay disabled.
- TODO privacy: לוודא ש-Web autocapture disabled או limited וש-autocapture אינו אוסף שדות רגישים.
- TODO privacy: לוודא retention period, project region, sensitive data masking ושאין health/therapy/billing/payroll/document/free-text data ב-custom events.
- TODO privacy/legal: לבחון consent/preferences לפני הרחבת שימוש ללקוחות חיצוניים.

## 6. יצירת קשר

אבטחה: `TODO owner: להשלים כתובת אמיתית`
