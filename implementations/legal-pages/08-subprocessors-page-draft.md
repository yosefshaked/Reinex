# טיוטת עמוד ספקי משנה - Reinex

תאריך תחילה: `TODO owner/legal`

חשוב: טיוטה לבדיקה משפטית ותשתיתית. יש לוודא אזורי ספקים, הסכמי ספקים והגדרות production בפועל לפני פרסום חיצוני.

## 1. כללי

Reinex משתמשת או עשויה להשתמש בספקי משנה לצורך אימות, מסד נתונים, אירוח, Functions/API, דוא"ל תפעולי, domain/DNS, אחסון, logging, analytics ושירותים נלווים.

## 2. רשימת ספקי משנה ידועים / מתוכננים

| ספק משנה | מטרה | קטגוריות מידע | אזור / מיקום | הערות |
| --- | --- | --- | --- | --- |
| Supabase | Auth, database, backend, possible file storage | משתמשים, ארגונים, תלמידים/לקוחות, אנשי קשר, עובדים, שיעורים, נוכחות, מידע רגיש/רפואי/טיפולי, logs | TODO verify actual Supabase project region | ספק מרכזי לאימות ומסד נתונים |
| Azure | Hosting, Azure Functions/API, logs | נתונים טכניים, API requests, logs, מידע תפעולי שמעובד בפונקציות | TODO verify actual Azure region | יש לוודא האם Application Insights או logging אחר פעיל |
| Cloudflare | Domain, DNS, Workers, storage/R2 אם בשימוש | נתוני בקשה טכניים, network data, קבצים אם storage פעיל | Global / TODO verify | יש לאמת שימוש בפועל ב-R2/Workers |
| Brevo | Operational email | כתובות דוא"ל, שמות, תוכן הודעות, הזמנות, איפוס סיסמה, הודעות מערכת ומטא-דאטה | TODO verify | ספק דוא"ל תפעולי |
| PostHog | Product analytics, diagnostics, performance metrics, product logging, feature flags | אירועי שימוש, device/browser data, web vitals, user identifiers, ובאדמין ייתכן email/name/role | TODO verify | Session Replay כבוי; Web autocapture כבוי ל-MVP; אין לטעון לאנונימיות או לאי-עיבוד מידע אישי ללא אימות |
| Meta / WhatsApp Business API | Future operational WhatsApp messages | טלפונים, שמות, תוכן הודעות, delivery metadata | לא מחובר כיום / TODO future | לפי הקוד הנוכחי אין חיבור direct provider/API; תוכנית עתידית בלבד |

## 3. WhatsApp

בשלב הנוכחי לא זוהה בקוד חיבור ישיר ל-WhatsApp/SMS API. המערכת עשויה ליצור קישורים ידניים או להלחין הודעות. אם בעתיד תחובר Meta WhatsApp Business API או ספק הודעות אחר, יש לעדכן את מדיניות הפרטיות, עמוד ספקי המשנה והודעות התקשורת.

## 4. TODO לפני פרסום

- TODO providers: לוודא אזורי project / region בפועל.
- TODO legal: לוודא DPA/terms של כל ספק משנה.
- TODO product: לפני production/customer launch לוודא ב-PostHog dashboard ש-Session Replay disabled.
- TODO product: לוודא ש-Web autocapture disabled או limited ושאינו אוסף שדות רגישים.
- TODO product: לוודא retention period, project region, sensitive data masking ושאין health/therapy/billing/payroll/document/free-text data ב-custom events.
- TODO infra: לוודא production frontend hosting וספקי storage בפועל.
