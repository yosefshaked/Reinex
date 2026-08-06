import { useEffect, useState } from 'react';

const RELEASES = [
  {
    version: '0.2.0',
    date: '2026-08-06',
    displayDate: '6 באוגוסט 2026',
    title: 'דיווחים ותהליכי עבודה חכמים יותר',
    description:
      'הגרסה החדשה מוסיפה תהליך מלא לדיווח מפגשים, משפרת את קליטת הנתונים וניהול רשימת ההמתנה, ומביאה שיפורים ללוח השנה ולניהול זמינות הצוות.',
    sections: [
      {
        title: 'דוחות מפגשים',
        groups: [
          {
            type: 'תוספות',
            items: [
              'נוסף תהליך מלא לדיווח מתוך המפגש בלוח השנה, עם שיוך אוטומטי למשתתף, לשירות ולמדריך.',
              'נוסף מסך „דוחות ממתינים”, המרכז את המפגשים שדורשים תיעוד ומאפשר להמשיך ברצף מדוח לדוח.',
              'נוספו תשובות מוכנות ארגוניות ואישיות למילוי מהיר של ניסוחים חוזרים.',
              'היסטוריית דוחות המפגשים זמינה כעת מתוך כרטיס התלמיד.',
            ],
          },
          {
            type: 'שינויים',
            items: [
              'דוחות נשמרים לפי מבנה הטופס שהיה בתוקף בזמן הדיווח, כך ששינויים עתידיים בטופס לא ישפיעו על דוחות קודמים.',
              'שינוי נוכחות או ביטול מפגש נחסמים כאשר כבר קיים עבורו תיעוד.',
              'האפשרות להעתיק מהדיווח הקודם הוסרה לטובת כתיבה מותאמת לכל מפגש ושימוש בתשובות מוכנות.',
            ],
          },
          {
            type: 'תיקוני באגים',
            items: [
              'תוקנו מצבי טעינה, שגיאה וספירה לא מדויקת ברשימת הדוחות הממתינים.',
            ],
          },
        ],
      },
      {
        title: 'ייבוא וקליטת נתונים',
        groups: [
          {
            type: 'תוספות',
            items: [
              'נוסף תהליך לייבוא לקוחות, תלמידים, הורים ושירותים מקובצי Excel ו־CSV.',
              'נוספו מסכי מיפוי, בדיקה וטיפול ברשומות שדורשות החלטה לפני השמירה.',
              'נוספה אפשרות לקשר בין נתונים המגיעים מגיליונות או מקבצים שונים.',
            ],
          },
          {
            type: 'שינויים',
            items: [
              'נתוני הייבוא וההתקדמות נשמרים אוטומטית, כך שניתן לצאת ולחזור לתהליך בלי לאבד עבודה.',
              'נתונים חסרים או שגויים נשמרים לבדיקה ולתיקון, ושגיאה ברשומה אחת אינה עוצרת את שאר הייבוא.',
            ],
          },
          {
            type: 'תיקוני באגים',
            items: [
              'תוקנו בעיות בקריאת כותרות, עמודות, נוסחאות ותאים מורכבים מקובצי Excel.',
              'תוקנו זיהוי הכפילויות ותצוגת הבדיקה, כדי למנוע קישור לאדם הלא נכון ולהציג מראש את מה שיישמר בפועל.',
            ],
          },
        ],
      },
      {
        title: 'רשימת המתנה',
        groups: [
          {
            type: 'תוספות',
            items: [
              'נוסף סינון „ממתין למילוי” עבור טפסי רשימת המתנה שנשלחו לתלמידים או ללקוחות חד־פעמיים ועדיין לא מולאו.',
            ],
          },
          {
            type: 'שינויים',
            items: [
              'טופס ממתין מוצג למעקב בלבד; לאחר מילויו נוצרת רשומת רשימת המתנה רגילה שניתן לטפל בה ולשבץ אותה.',
            ],
          },
          {
            type: 'תיקוני באגים',
            items: [
              'תוקן הסינון כך שרק טפסים ייעודיים לרשימת המתנה מוצגים כ„ממתינים למילוי”.',
            ],
          },
        ],
      },
      {
        title: 'לוח שנה וזמינות צוות',
        groups: [
          {
            type: 'תוספות',
            items: [
              'נוספה אפשרות לנהל הפסקות, פגישות וחסימות זמינות חד־פעמיות או חוזרות למדריכים.',
            ],
          },
          {
            type: 'שינויים',
            items: [
              'הודעות לוח הזמנים למדריכים כוללות כעת הפסקות וחסימות ומציגות את המשתתפים בצורה מסודרת לפי שירות.',
              'ממשק לוח השנה פושט כדי לפנות יותר מקום לעבודה המרכזית.',
            ],
          },
          {
            type: 'תיקוני באגים',
            items: [
              'תוקנה פריסת תצוגות החודש והשבוע, כולל יישור כותרות הימים והתאמה טובה יותר למסכים בגדלים שונים.',
              'תוקנה תקלה שבה העברת מפגש הייתה עלולה להישאר במצב טעינה.',
            ],
          },
        ],
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-06-24',
    displayDate: '24 ביוני 2026',
    title: 'השקת Reinex',
    description:
      'Reinex יוצאת לדרך כמערכת תפעולית לניהול ארגונים טיפוליים וחינוכיים: מקום אחד לקליטת נתונים, תיאום שיעורים, ניהול משתתפים וזמינות מדריכים, תיעוד נוכחות, תהליכי חיוב ושכר, ומעקב אחר חריגים תפעוליים.',
    sections: [
      {
        title: 'מה אפשר לעשות במערכת',
        items: [
          'לנהל תלמידים, לקוחות, אנשי קשר ומדריכים תחת סביבת עבודה ארגונית אחת.',
          'לייבא נתונים קיימים מקובצי אקסל/CSV דרך „סביבות ייבוא”: מיפוי עמודות ללקוחות, הורים ושירותים, בדיקה וניקוי של הנתונים לפני שמירה, וייבוא מבוקר למערכת הפעילה.',
          'לתכנן ולנהל שיעורים בלוח שנה תפעולי עם משתתפים, נוכחות, תזכורות וסטטוס סגירה.',
          'לנהל את זמינות המדריכים — הפסקות, פגישות, חסימות אישיות ותבניות חוזרות — ולראות אותן גם בהודעות הוואטסאפ של המדריך.',
          'להפעיל תהליכי חיוב, גורם מממן ושכר מדריכים מתוך נתוני השיעור והנוכחות.',
          'לעבוד עם הרשאות ותפקידים כדי שכל משתמש יראה ויבצע רק את מה שרלוונטי אליו.',
        ],
      },
      {
        title: 'עקרונות ההשקה',
        items: [
          'שלמות נתונים לפני מהירות: פעולות רגישות נבדקות מול מצב השרת לפני שמירה.',
          'בהירות תפעולית: כל שיעור מציג מה פתוח, מה חסום ומה כבר טופל.',
          'עבודה הדרגתית: המערכת בנויה להתרחב לפי תהליכי הארגון בלי לשבור תהליכים קיימים.',
        ],
      },
      {
        title: 'מה הלאה',
        items: [
          'נמשיך לשפר את זרימת הייבוא, חוויית לוח השנה, תהליכי הסגירה והמסכים הפיננסיים לפי שימוש אמיתי ומשוב מהשטח.',
          'שינויים עתידיים יתועדו כאן בצורה קצרה וברורה כדי שיהיה קל להבין מה השתנה ולמה.',
        ],
      },
    ],
  },
];

const LATEST_VERSION = RELEASES[0].version;

function UpdateItems({ items }) {
  return (
    <ul
      style={{
        margin: 0,
        padding: 0,
        listStyle: 'none',
        display: 'grid',
        gap: 8,
        color: '#475569',
        lineHeight: 1.65,
      }}
    >
      {items.map((item) => (
        <li key={item} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <span aria-hidden="true" style={{ color: '#2563eb', fontWeight: 900, lineHeight: 1.65 }}>
            •
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ChangelogModal({ open, onClose }) {
  const [expandedVersions, setExpandedVersions] = useState({ [LATEST_VERSION]: true });

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const toggleVersion = (version) => {
    setExpandedVersions((current) => ({
      ...current,
      [version]: !current[version],
    }));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="changelog-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose?.();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(15, 23, 42, 0.42)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        direction: 'rtl',
      }}
    >
      <div
        style={{
          width: 'min(94vw, 820px)',
          maxHeight: '88vh',
          background: 'white',
          borderRadius: 20,
          boxShadow: '0 24px 70px rgba(15, 23, 42, 0.22)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="סגור עדכונים"
          style={{
            position: 'absolute',
            top: 18,
            left: 18,
            width: 34,
            height: 34,
            borderRadius: 999,
            border: '1px solid #e2e8f0',
            background: '#ffffff',
            color: '#475569',
            fontSize: 22,
            lineHeight: 1,
            cursor: 'pointer',
            zIndex: 1,
          }}
        >
          ×
        </button>

        <header
          style={{
            padding: '26px clamp(18px, 4vw, 28px) 20px',
            borderBottom: '1px solid #e2e8f0',
            background: 'linear-gradient(135deg, #f8fafc 0%, #eef6ff 100%)',
          }}
        >
          <h2
            id="changelog-title"
            style={{
              margin: 0,
              color: '#0f172a',
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: '-0.02em',
            }}
          >
            עדכוני גרסה
          </h2>
          <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: 14 }}>
            הגרסה האחרונה פתוחה כברירת מחדל. ניתן לפתוח גרסאות קודמות כדי לצפות בהיסטוריית העדכונים.
          </p>
        </header>

        <main style={{ padding: 'clamp(16px, 4vw, 28px)', overflowY: 'auto' }}>
          <div style={{ display: 'grid', gap: 14 }}>
            {RELEASES.map((release) => {
              const isExpanded = Boolean(expandedVersions[release.version]);
              const panelId = `changelog-version-${release.version.replaceAll('.', '-')}`;

              return (
                <article
                  key={release.version}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: 16,
                    background: '#ffffff',
                    overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={panelId}
                    onClick={() => toggleVersion(release.version)}
                    style={{
                      width: '100%',
                      border: 0,
                      background: isExpanded ? '#f8fafc' : '#ffffff',
                      padding: '16px clamp(14px, 3vw, 20px)',
                      cursor: 'pointer',
                      textAlign: 'right',
                      color: 'inherit',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                        <span
                          style={{
                            background: '#1e40af',
                            color: 'white',
                            padding: '5px 12px',
                            borderRadius: 999,
                            fontSize: 13,
                            fontWeight: 700,
                          }}
                        >
                          גרסה {release.version}
                        </span>
                        <time dateTime={release.date} style={{ color: '#64748b', fontSize: 14 }}>
                          {release.displayDate}
                        </time>
                      </div>
                      <span
                        aria-hidden="true"
                        style={{
                          color: '#64748b',
                          fontSize: 18,
                          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s ease',
                        }}
                      >
                        ▼
                      </span>
                    </div>
                    <h3
                      style={{
                        margin: '10px 0 0',
                        color: '#1e293b',
                        fontSize: 19,
                        fontWeight: 750,
                        lineHeight: 1.4,
                      }}
                    >
                      {release.title}
                    </h3>
                  </button>

                  {isExpanded ? (
                    <div id={panelId} style={{ padding: '0 clamp(14px, 3vw, 20px) 20px' }}>
                      <p style={{ margin: '16px 0', color: '#475569', fontSize: 15, lineHeight: 1.7 }}>
                        {release.description}
                      </p>
                      <div style={{ display: 'grid', gap: 14 }}>
                        {release.sections.map((section) => (
                          <section
                            key={section.title}
                            style={{
                              border: '1px solid #e2e8f0',
                              borderRadius: 14,
                              padding: '16px clamp(14px, 3vw, 18px)',
                            }}
                          >
                            <h4
                              style={{
                                margin: '0 0 12px',
                                color: '#1e293b',
                                fontSize: 17,
                                fontWeight: 750,
                              }}
                            >
                              {section.title}
                            </h4>

                            {section.groups ? (
                              <div style={{ display: 'grid', gap: 14 }}>
                                {section.groups.map((group) => (
                                  <div key={group.type}>
                                    <h5
                                      style={{
                                        display: 'inline-flex',
                                        margin: '0 0 8px',
                                        padding: '3px 9px',
                                        borderRadius: 999,
                                        background: '#eff6ff',
                                        color: '#1d4ed8',
                                        fontSize: 13,
                                        fontWeight: 750,
                                      }}
                                    >
                                      {group.type}
                                    </h5>
                                    <UpdateItems items={group.items} />
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <UpdateItems items={section.items} />
                            )}
                          </section>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </main>
      </div>
    </div>
  );
}
