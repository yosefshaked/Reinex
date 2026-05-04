# טיוטת הודעת Cookies ואחסון בדפדפן - Reinex

תאריך תחילה: `TODO owner/legal`  

חשוב: טיוטה לבדיקה משפטית וטכנית. Reinex משתמשת גם ב-cookies וגם ב-browser storage כגון localStorage ו-sessionStorage. אין לקרוא לכל אחסון בדפדפן "cookies".

## 1. כללי

Reinex משתמשת בטכנולוגיות אחסון בדפדפן לצורך התחברות, שמירת סשן, ארגון פעיל, העדפות תצוגה ונגישות, טיוטות עבודה, מצב יומן, פילטרים, שגיאות OAuth, זרימות אדמין ו-analytics/performance כאשר PostHog מופעל.

## 2. טבלת אחסון נוכחית

| קטגוריה | שם / דוגמה | מטרה | נדרש? | משך שמירה | סיכון מידע אישי/רגיש |
| --- | --- | --- | --- | --- | --- |
| חיוני | `app-main-auth-session` | Supabase Auth session, אימות והמשך התחברות | כן | עד logout/ניקוי דפדפן ובהתאם לתוקף session | גבוה: access token, refresh token, user id, email |
| חיוני | `active_org_id` | שמירת ארגון פעיל והעברת `x-org-id` לבקשות API | כן | עד החלפה/ניקוי | בינוני: organization ID |
| legacy | `employee-management:last-org`, `employee-management:last-org:<userId>` | מפתחות ארגון ישנים שעשויים להתקיים בדפדפן | לא | עד מיגרציה/ניקוי | user ID / org ID |
| פונקציונלי | `sidebar_state` | Cookie לשמירת מצב sidebar | לא | 7 ימים | לא |
| פונקציונלי | `app:sidebarHidden` | העדפת הסתרת sidebar | לא | עד שינוי/ניקוי | לא |
| פונקציונלי | `a11y:*` | העדפות נגישות כגון font scale, contrast, underline links, no animations | לא | עד שינוי/ניקוי | נמוך: עשוי לרמוז על העדפות נגישות |
| פונקציונלי | `onboarding_completed` | השלמת onboarding | לא | עד ניקוי | לא |
| פונקציונלי | `instructor_status_<orgId>_<userId>` | cache סטטוס מדריך | לא | ערך תקף 5 דקות, מפתח עשוי להישאר | user ID, org ID, role/status |
| פונקציונלי | `reinex_submit_legal_notice_dismissed` | הסתרת הודעת טופס ציבורי | לא | עד ניקוי | לא |
| session | `supabase-oauth-error` | שמירת שגיאת OAuth זמנית | כן במקרי שגיאה | session ונמחק לאחר טיפול | תיאור שגיאה בלבד |
| session | `reinex_calendar_date`, `reinex_calendar_view`, `reinex_calendar_last_day` | מצב יומן זמני | לא | session | נמוך |
| session רגיש | `reinex_calendar_generation_review_v1:<orgId>` | סקירת יצירת שיעורים | לא | session | גבוה: תלמידים, לקוחות, org ID, מידע תפעולי טיפולי |
| session רגיש | `reinex_sheet_draft_v1:<key>` | טיוטות פיננסיות/גיליונות | לא | session או עד ניקוי יזום | חיוב, לקוחות, תלמידים, הערות |
| session | `tuttiud:student-filters:<orgId>:<page>` | פילטרים וחיפוש תלמידים | לא | session | ייתכן מידע אישי במונחי חיפוש |
| אדמין רגיש | `reinex_impersonation_v1` | מצב התחזות אדמין | כן כאשר feature בשימוש | session | גבוה מאוד: access/refresh tokens, email, user ID, org ID |
| analytics / performance | `ph_*`, `ph_<project_api_key>_posthog` | PostHog product analytics, diagnostics, web vitals, feature flags, session/device identifiers. Session Replay כבוי ו-Web autocapture כבוי ל-MVP | לא | תלוי SDK/config | ייתכן user ID, email/name/role באדמין; אין לטעון לאנונימיות ללא אימות |

## 3. PostHog ו-Analytics

בשלב הבטא Reinex עשויה להשתמש ב-PostHog לצורך אנליטיקה מוצרית, אבחון, מדידת ביצועים ושיפור השירות. Session Replay כבוי ואינו מיועד לשימוש כל עוד המערכת עשויה להציג או לעבד מידע על תלמידים, לקוחות, מידע רפואי/טיפולי, חיוב, שכר, מסמכים, נוכחות, גורמי מימון או טפסים חופשיים.

Web autocapture כבוי לפי החלטת MVP. Web vitals עשויים להישאר פעילים לצורך מדידת ביצועים. Dead clicks autocapture הוא non-essential ויש לתעד אותו רק אם יימצא פעיל בפועל. אין לטעון שהאנליטיקה אנונימית או ש-PostHog אינו מעבד מידע אישי, אלא אם הדבר אומת בתצורה בפועל.

`TODO product/privacy: לפני production/customer launch לוודא ב-PostHog dashboard: Session Replay disabled; Web autocapture disabled או limited; autocapture לא אוסף שדות רגישים; retention period מוגדר; project region מתועד; אין health/therapy/billing/payroll/document/free-text data ב-custom events.`

## 4. שיווק

לא נמצאו בקוד הנוכחי כלי marketing, remarketing או פרסום. אם יתווספו כלים כאלה, יש לעדכן הודעה זו ולהוסיף מנגנון הסכמה/ניהול העדפות לפני הפעלה.

## 5. בחירות משתמש

ניתן למחוק או לחסום cookies/browser storage דרך הדפדפן. חסימת אחסון חיוני עשויה למנוע התחברות או שימוש תקין במערכת.

`TODO legal/product: לפני הרחבת השימוש ללקוחות חיצוניים לבחון consent/preferences, צמצום מזהים, masking, retention, region והגדרות פרטיות נוספות.`
