# המלצות לעמודים משפטיים עבור Reinex

סטטוס: רשימת עבודה ל-MVP / הערכה תפעולית  
עודכן: 2026-05-03  

חשוב: זה אינו ייעוץ משפטי. אין לפרסם את המסמכים כמאושרים משפטית ללא בדיקה ואישור של עורך דין מתאים. Reinex היא שם מערכת בשלב MVP / הערכה תפעולית, ואינה כיום חברה ייעודית נפרדת.

## מיצוב נדרש בכל המסמכים

Reinex היא מערכת תוכנה הנמצאת בשלב MVP / הערכה תפעולית. בשלב זה Reinex אינה מופעלת על ידי חברה ייעודית נפרדת. אם וכאשר המערכת תעבור לשימוש מסחרי רחב יותר, ייתכן שהפעילות תועבר לישות משפטית ייעודית, לרבות חברה עתידית בשם ThePCRunners או ישות אחרת. במקרה כזה יעודכנו מסמכי השירות ופרטי בעל השליטה/המפעיל.

Reinex נמצאת בשלב MVP ואינה מהווה בשלב זה מערכת רשומה/מאושרת לניהול רשומה רפואית מלאה או מקור בלעדי לתיעוד טיפולי, רפואי, חשבונאי או משפטי. השימוש בה בשלב זה נועד לניהול תפעולי, בדיקת התאמה ושיפור תהליכי עבודה, לצד שמירת תיעוד וגיבויים נדרשים במערכות או אמצעים נוספים לפי שיקול הארגון.

## עדיפות MVP

1. תנאי שימוש - `01-terms-of-service-draft.md`
2. מדיניות פרטיות - `02-privacy-policy-draft.md`
3. הודעת Cookies ואחסון בדפדפן - `03-cookie-notice-draft.md`
4. מדיניות אבטחת מידע - `05-security-policy-draft.md`
5. ספקי משנה - `08-subprocessors-page-draft.md`
6. שמירת מידע ומחיקה - `09-data-retention-and-deletion-policy-draft.md`
7. שימוש מקובל - `06-acceptable-use-policy-draft.md`

## עמודים משניים

8. הצהרת נגישות - `10-accessibility-statement-draft.md`
9. תמיכה ו-SLA - `07-support-and-sla-policy-draft.md`
10. זכויות יוצרים וקניין רוחני - `11-copyright-and-ip-notice-draft.md`
11. דיווח אחראי על חולשות - `12-responsible-disclosure-policy-draft.md`
12. DPA / הסכם עיבוד מידע - `04-data-processing-agreement-draft.md`

## עמודים ציבוריים שנוצרו באפליקציה

- `/legal`
- `/legal/terms`
- `/legal/privacy`
- `/legal/cookies`
- `/legal/security`
- `/legal/subprocessors`
- `/legal/data-retention`
- `/legal/acceptable-use`
- `/legal/accessibility`
- `/legal/support`
- `/legal/ip`
- `/legal/responsible-disclosure`
- `/legal/dpa`

התוכן הציבורי באפליקציה מנוהל בקובץ `src/legal/legalContent.js`, והטיוטות בתיקייה זו הן מקור תיעוד/בדיקה משפטית מקביל. יש לשמור על התאמה ביניהם לפני פרסום חיצוני.

## נקודות שחייבות בדיקת בעלים / משפטית

- TODO owner: להשלים שם מפעיל/בעל שליטה במידע, כתובת ופרטי קשר ציבוריים אמיתיים.
- TODO legal: לקבוע דין חל, סמכות שיפוט, הגבלת אחריות, שיפוי, תנאי תשלום ותהליך מחיקה.
- TODO privacy: לבדוק תחולת חוק הגנת הפרטיות הישראלי, לרבות תיקון 13, חובות מאגר, מידע בעל רגישות מיוחדת וקטינים.
- TODO providers: לוודא אזורי Supabase, Azure, Cloudflare, Brevo ו-PostHog.
- TODO product/security: לוודא backup בפועל, retention בפועל, PostHog consent/preferences לפני השקה חיצונית, PostHog project region, retention, masking ו-Application Insights/Azure logging.
- TODO product: אם WhatsApp/Meta API יחובר בעתיד, לעדכן פרטיות, ספקי משנה והודעת תקשורת.

## סיכונים טכניים שחייבים להופיע במסמכים

- Supabase tokens נשמרים ב-localStorage תחת `app-main-auth-session`.
- Admin impersonation tokens נשמרים ב-sessionStorage תחת `reinex_impersonation_v1`.
- sessionStorage עשוי להכיל מידע אישי/רגיש בטיוטות, סקירות יומן ופילטרים.
- PostHog עשוי לשמש ל-product analytics, diagnostics, performance monitoring ושיפור מוצר אם מוגדר key. Session Replay כבוי וחייב להישאר כבוי כל עוד Reinex עשויה לעבד או להציג מידע אישי/רגיש. Web autocapture כבוי לפי החלטת MVP.

## TODO טכני ל-PostHog לפני production/customer launch

- לוודא ב-PostHog dashboard ש-Session Replay disabled.
- לוודא ש-Web autocapture disabled או מוגבל.
- לוודא ש-autocapture אינו אוסף שדות רגישים.
- לוודא ש-retention period מוגדר ומתועד.
- לוודא ש-project region מתועד.
- לוודא שלא נשלח health/therapy/billing/payroll/document/free-text data ב-custom events.
- גיבויים ו-retention עדיין דורשים אימות ואסור לתאר אותם כמובטחים.
