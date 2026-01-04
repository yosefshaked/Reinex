import React, { useEffect, useState } from 'react';

export default function ChangelogModal({ open, onClose }) {
  // הגרסה האחרונה נפתחת כברירת מחדל
  const [expandedVersions, setExpandedVersions] = useState({ '1.9.0': true });

  const toggleVersion = (version) => {
    setExpandedVersions(prev => ({
      ...prev,
      [version]: !prev[version]
    }));
  };

  // סגירה עם ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="changelog-title"
      onClick={(e) => {
        // סגירה בלחיצה מחוץ לקופסה
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(2,6,23,0.25)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: 16,
          boxShadow: '0 10px 30px rgba(2,6,23,0.2)',
          width: 'min(90vw, 860px)',
          height: 'min(85vh, 640px)',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 18,
            left: 18,
            background: 'transparent',
            border: 'none',
            fontSize: 22,
            color: '#64748b',
            cursor: 'pointer',
            zIndex: 10001,
          }}
          aria-label="סגור עדכונים"
        >
          ×
        </button>

        <h2
          id="changelog-title"
          style={{ 
            fontSize: 22, 
            fontWeight: 700, 
            color: '#5B5BD6', 
            padding: '24px 24px 12px',
            margin: 0,
            borderBottom: '1px solid #e2e8f0'
          }}
        >
          עדכוני גרסה
        </h2>

        <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, color: '#334155', fontSize: 15, lineHeight: 1.7 }}>

          {/* 1.9.0 - Intake Feature */}
          <li dir="rtl" style={{ marginBottom: 16, textAlign: 'right' }}>
            <article style={{ display: 'flex', flexDirection: 'column' }}>
              <header
                onClick={() => toggleVersion('1.9.0')}
                style={{
                  cursor: 'pointer',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: expandedVersions['1.9.0'] ? '#f8fafc' : 'transparent',
                  border: '1px solid #e2e8f0',
                  transition: 'all 0.2s ease',
                  marginBottom: expandedVersions['1.9.0'] ? '16px' : 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{
                      background: '#5B5BD6',
                      color: 'white',
                      padding: '4px 12px',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: 600
                    }}>
                      גרסה 1.9.0
                    </span>
                    <time dateTime="2025-12-22" style={{ color: '#64748b', fontSize: '14px' }}>
                      22 בדצמבר 2025
                    </time>
                  </div>
                  <span style={{
                    fontSize: '20px',
                    color: '#64748b',
                    transition: 'transform 0.2s ease',
                    transform: expandedVersions['1.9.0'] ? 'rotate(180deg)' : 'rotate(0deg)',
                    display: 'inline-block'
                  }}>
                    ▼
                  </span>
                </div>
                <h3 style={{
                  fontWeight: 700,
                  fontSize: 18,
                  margin: '8px 0 0 0',
                  color: '#1e293b',
                  lineHeight: 1.4
                }}>
                  🧩 קליטת תלמידים (Intake)
                </h3>
              </header>

              {expandedVersions['1.9.0'] && (
              <section style={{ paddingRight: '16px' }}>
                <ul style={{
                  listStyleType: 'disc',
                  paddingRight: '20px',
                  marginBottom: '16px',
                  color: '#475569',
                  lineHeight: 1.8
                }}>
                  <li>נוספה קליטה של טפסים חיצוניים ישירות למערכת עם שמירת התשובות.</li>
                  <li>תור אישורי קליטה חדש בדשבורד לניהול ואישור תלמידים שנכנסו דרך טפסים.</li>
                  <li>כרטיס הגדרות חדש למיפוי שדות ותחזוקת סוד משותף לאינטגרציה (למנהלים בלבד).</li>
                  <li>בעת קבלת אינטייק חדש, הוא מקושר אוטומטית לתלמיד קיים/מייצר תלמיד חדש ע"ב מספר הזהות</li>
                </ul>
              </section>
              )}
            </article>
          </li>

          {/* 1.8.2 - Student Filter Fix */}
          <li dir="rtl" style={{ marginBottom: 16, textAlign: 'right' }}>
            <article style={{ display: 'flex', flexDirection: 'column' }}>
              <header
                onClick={() => toggleVersion('1.8.2')}
                style={{
                  cursor: 'pointer',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: expandedVersions['1.8.2'] ? '#f8fafc' : 'transparent',
                  border: '1px solid #e2e8f0',
                  transition: 'all 0.2s ease',
                  marginBottom: expandedVersions['1.8.2'] ? '16px' : 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{
                      background: '#5B5BD6',
                      color: 'white',
                      padding: '4px 12px',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: 600
                    }}>
                      גרסה 1.8.2
                    </span>
                    <time dateTime="2025-12-18" style={{ color: '#64748b', fontSize: '14px' }}>
                      18 בדצמבר 2025
                    </time>
                  </div>
                  <span style={{
                    fontSize: '20px',
                    color: '#64748b',
                    transition: 'transform 0.2s ease',
                    transform: expandedVersions['1.8.2'] ? 'rotate(180deg)' : 'rotate(0deg)',
                    display: 'inline-block'
                  }}>
                    ▼
                  </span>
                </div>
                <h3 style={{
                  fontWeight: 700,
                  fontSize: 18,
                  margin: '8px 0 0 0',
                  color: '#1e293b',
                  lineHeight: 1.4
                }}>
                  🔍 תיקון סינון סטטוס תלמידים
                </h3>
              </header>

              {expandedVersions['1.8.2'] && (
              <section style={{ paddingRight: '16px' }}>
                <ul style={{
                  listStyleType: 'disc',
                  paddingRight: '20px',
                  marginBottom: '16px',
                  color: '#475569',
                  lineHeight: 1.8
                }}>
                  <li>תוקן מסנן סטטוס תלמידים (פעילים / לא פעילים / הכל) כך שהרשימה מתעדכנת עם התוצאות הנכונות.</li>
                </ul>
              </section>
              )}
            </article>
          </li>

          {/* 1.8.1 - Instructor Personal Preanswers */}
          <li dir="rtl" style={{ marginBottom: 16, textAlign: 'right' }}>
            <article style={{ display: 'flex', flexDirection: 'column' }}>
              <header
                onClick={() => toggleVersion('1.8.1')}
                style={{
                  cursor: 'pointer',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: expandedVersions['1.8.1'] ? '#f8fafc' : 'transparent',
                  border: '1px solid #e2e8f0',
                  transition: 'all 0.2s ease',
                  marginBottom: expandedVersions['1.8.1'] ? '16px' : 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{
                      background: '#5B5BD6',
                      color: 'white',
                      padding: '4px 12px',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: 600
                    }}>
                      גרסה 1.8.1
                    </span>
                    <time dateTime="2025-12-17" style={{ color: '#64748b', fontSize: '14px' }}>
                      17 בדצמבר 2025
                    </time>
                  </div>
                  <span style={{
                    fontSize: '20px',
                    color: '#64748b',
                    transition: 'transform 0.2s ease',
                    transform: expandedVersions['1.8.1'] ? 'rotate(180deg)' : 'rotate(0deg)',
                    display: 'inline-block'
                  }}>
                    ▼
                  </span>
                </div>
                <h3 style={{
                  fontWeight: 700,
                  fontSize: 18,
                  margin: '8px 0 0 0',
                  color: '#1e293b',
                  lineHeight: 1.4
                }}>
                  ✨ תשובות מוכנות אישיות למדריכים
                </h3>
              </header>

              {expandedVersions['1.8.1'] && (
              <section style={{ paddingRight: '16px' }}>
                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  למדריכים:
                </h4>
                <ul style={{
                  listStyleType: 'disc',
                  paddingRight: '20px',
                  marginBottom: '16px',
                  color: '#475569',
                  lineHeight: 1.8
                }}>
                  <li>כעת ניתן להגדיר <strong>תשובות מוכנות מראש אישיות</strong> לשאלות פתוחות בטופס דיווח מפגש</li>
                  <li>לחצו על אייקון הרשימה 📋 ליד שאלת טקסט לפתיחת חלונית בחירת תשובות</li>
                  <li>התשובות האישיות נשמרות אוטומטית ונגישות רק לכם בכל דיווח חדש</li>
                  <li>התכונה זמינה במקביל לתשובות הארגוניות שמוגדרות על ידי המנהלים</li>
                  <li>כעת ליד כל תשובה מוכנה מראש יופיע מספר סידורי להקלה במציאה חוזרת</li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  תיקוני באגים:
                </h4>
                <ul style={{
                  listStyleType: 'disc',
                  paddingRight: '20px',
                  marginBottom: '16px',
                  color: '#475569',
                  lineHeight: 1.8
                }}>
                  <li>תוקן באג שגרם לחוסר עדכון תצוגה אם נוצר דיווח דרך מעקב מצב התיעודים</li>
                </ul>

                <div style={{
                  background: '#f1f5f9',
                  borderRight: '3px solid #5B5BD6',
                  padding: '12px 16px',
                  borderRadius: '6px',
                  fontSize: '14px',
                  color: '#475569'
                }}>
                  <strong>💡 טיפ:</strong> התשובות האישיות נשמרות לכל מדריך בנפרד. מגבלת מספר התשובות לשאלה נקבעת על ידי מנהל המערכת.
                </div>
              </section>
              )}
            </article>
          </li>

          {/* 1.8.0 - Loose Reports (Unassigned Sessions), Resubmissions, Advanced Filtering */}
          <li dir="rtl" style={{ marginBottom: 16, textAlign: 'right' }}>
            <article style={{ display: 'flex', flexDirection: 'column' }}>
              <header
                onClick={() => toggleVersion('1.8.0')}
                style={{
                  cursor: 'pointer',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: expandedVersions['1.8.0'] ? '#f8fafc' : 'transparent',
                  border: '1px solid #e2e8f0',
                  transition: 'all 0.2s ease',
                  marginBottom: expandedVersions['1.8.0'] ? '16px' : 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{
                      background: '#5B5BD6',
                      color: 'white',
                      padding: '4px 12px',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: 600
                    }}>
                      גרסה 1.8.0
                    </span>
                    <time dateTime="2025-12-15" style={{ color: '#64748b', fontSize: '14px' }}>
                      15 בדצמבר 2025
                    </time>
                  </div>
                  <span style={{
                    fontSize: '20px',
                    color: '#64748b',
                    transition: 'transform 0.2s ease',
                    transform: expandedVersions['1.8.0'] ? 'rotate(180deg)' : 'rotate(0deg)',
                    display: 'inline-block'
                  }}>
                    ▼
                  </span>
                </div>
                <h3 style={{
                  fontWeight: 700,
                  fontSize: 18,
                  margin: '8px 0 0 0',
                  color: '#1e293b',
                  lineHeight: 1.4
                }}>
                  📋 דיווחים ממתינים, שליחה מחדש וסינון מתקדם
                </h3>
              </header>

              {expandedVersions['1.8.0'] && (
              <section style={{ paddingRight: '16px' }}>
                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  למדריכים:
                </h4>
                <ul style={{
                  listStyle: 'disc',
                  paddingRight: '24px',
                  margin: '0 0 12px 0',
                  color: '#475569',
                  fontSize: 15,
                  lineHeight: 1.8
                }}>
                  <li><strong>דיווח על תלמידים חדשים:</strong> אפשר כעת לדווח על מפגשים גם כאשר התלמיד טרם נוסף למערכת.</li>
                  <li><strong>ממשק ניהול דיווחים:</strong> תצוגה חדשה עם כרטיסיות המציגה את סטטוס כל הדיווחים שלכם (ממתינים, נדחו, אושרו).</li>
                  <li><strong>שליחה מחדש:</strong> דיווחים שנדחו ניתן לערוך ולשלוח מחדש, כולל אפשרות להוסיף הערה למנהל.</li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  למנהלים ובעלים:
                </h4>
                <ul style={{
                  listStyle: 'disc',
                  paddingRight: '24px',
                  margin: '0 0 12px 0',
                  color: '#475569',
                  fontSize: 15,
                  lineHeight: 1.8
                }}>
                  <li><strong>עמוד דיווחים ממתינים:</strong> ממשק ייעודי לטיפול בדיווחים ללא שיוך - שיוך לתלמיד קיים, יצירת תלמיד חדש, או דחייה עם הסבר.</li>
                  <li><strong>דיווח בשם מדריכים:</strong> מנהלים יכולים ליצור דיווחים ולבחור מדריך ספציפי כיוצר.</li>
                  <li><strong>סינון וחיפוש מתקדם:</strong> חיפוש דיווחים לפי טווח תאריכים, סטטוס, שם תלמיד וסיבת הדיווח.</li>
                  <li><strong>זיהוי כפילויות:</strong> התראה בזמן אמת בעת הזנת שם תלמיד חדש אם קיימים תלמידים בשמות דומים.</li>
                  <li><strong>סינון במפת החום:</strong> אפשרות לסינון הדיווחים במפת החום לפי מדריך ספציפי.</li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  שיפורים נוספים:
                </h4>
                <ul style={{
                  listStyle: 'disc',
                  paddingRight: '24px',
                  margin: '0 0 12px 0',
                  color: '#475569',
                  fontSize: 15,
                  lineHeight: 1.8
                }}>
                  <li>מדריכים-מנהלים רואים תחילה "התלמידים שלי" עם אפשרות מהירה למעבר לכל התלמידים.</li>
                  <li>תיקון בעיית טעינה כפולה ברשימת התלמידים.</li>
                  <li>שיפורי ביצועים ותיקוני באגים נוספים.</li>
                </ul>
              </section>
              )}
            </article>
          </li>

          {/* 1.7.0 - Student data management, CSV import/export, national ID, deduplication */}
          <li dir="rtl" style={{ marginBottom: 16, textAlign: 'right' }}>
            <article style={{ display: 'flex', flexDirection: 'column' }}>
              <header
                onClick={() => toggleVersion('1.7.0')}
                style={{
                  cursor: 'pointer',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: expandedVersions['1.7.0'] ? '#f8fafc' : 'transparent',
                  border: '1px solid #e2e8f0',
                  transition: 'all 0.2s ease',
                  marginBottom: expandedVersions['1.7.0'] ? '16px' : 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{
                      background: '#5B5BD6',
                      color: 'white',
                      padding: '4px 12px',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: 600
                    }}>
                      גרסה 1.7.0
                    </span>
                    <time dateTime="2025-12-08" style={{ color: '#64748b', fontSize: '14px' }}>
                      8 בדצמבר 2025
                    </time>
                  </div>
                  <span style={{
                    fontSize: '20px',
                    color: '#64748b',
                    transition: 'transform 0.2s ease',
                    transform: expandedVersions['1.7.0'] ? 'rotate(180deg)' : 'rotate(0deg)',
                    display: 'inline-block'
                  }}>
                    ▼
                  </span>
                </div>
                <h3 style={{
                  fontWeight: 700,
                  fontSize: 18,
                  margin: '8px 0 0 0',
                  color: '#1e293b',
                  lineHeight: 1.4
                }}>
                  🎯 ניהול נתוני תלמידים ומניעת כפילויות
                </h3>
              </header>

              {expandedVersions['1.7.0'] && (
              <section style={{ paddingRight: '16px' }}>
                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  תוספות:
                </h4>
                <ul style={{
                  listStyle: 'disc',
                  paddingRight: '24px',
                  margin: '8px 0 16px',
                  color: '#334155'
                }}>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>ייצוא ויבוא נתוני תלמידים (למנהלים בלבד):</strong> ייצוא לקובץ Excel של כל התלמידים, תלמידים בעייתיים בלבד (חסרי ת"ז, מדריך לא פעיל, התנגשויות בלו"ז), או לפי סינון. ניתן לערוך בקובץ ולייבא בחזרה לעדכון מהיר של מספר תלמידים בבת אחת
                  </li>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>התראה על שמות דומים (למנהלים בלבד):</strong> בעת יצירה או עריכה של תלמיד, המערכת מציגה תלמידים קיימים עם שמות דומים כדי למנוע כפילויות
                  </li>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>מספר זהות:</strong> שדה חובה וייחודי לכל תלמיד למניעת כפילויות
                  </li>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>סינון לפי תגיות:</strong> ניתן כעת לסנן תלמידים לפי תגיות שהוגדרו
                  </li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  שיפורים:
                </h4>
                <ul style={{
                  listStyle: 'disc',
                  paddingRight: '24px',
                  margin: '8px 0 16px',
                  color: '#334155'
                }}>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>דפי תלמידים משופרים:</strong> סינון מתקדם משופר, חיפוש מהיר יותר, וניווט נוח יותר
                  </li>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>תיעוד מפגש משופר:</strong> לאחר שמירת תיעוד, ניתן לבחור את התאריך הבא לתיעוד (אותו התאריך, היום, או תאריך אחר) - מקל על תיעוד מפגשים ברצף
                  </li>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>סינון לפי יום:</strong> הוספת אפשרות "כל הימים" לאיפוס סינון היום
                  </li>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>מדריכים-מנהלים:</strong> מדריכים שהם גם מנהלים רואים כעת את התלמידים שלהם כברירת מחדל, עם אפשרות לעבור לצפייה בכל התלמידים
                  </li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  תיקוני באגים:
                </h4>
                <ul style={{
                  listStyle: 'disc',
                  paddingRight: '24px',
                  margin: '8px 0',
                  color: '#334155'
                }}>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>הגנה על דף מנהל:</strong> משתמשים שאינם מנהלים מנותבים אוטומטית לדף התלמידים שלהם במקום להיתקע בדף ניהולי ללא הרשאות
                  </li>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>רענון לוח השנה:</strong> לוח החום בדף הראשי מתעדכן אוטומטית לאחר יצירת תיעוד חדש
                  </li>
                </ul>
              </section>
              )}
            </article>
          </li>

          {/* 1.6.1 - Organizational documents, session report UX, and document management improvements */}
          <li dir="rtl" style={{ marginBottom: 16, textAlign: 'right' }}>
            <article style={{ display: 'flex', flexDirection: 'column' }}>
              <header
                onClick={() => toggleVersion('1.6.1')}
                style={{
                  cursor: 'pointer',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: expandedVersions['1.6.1'] ? '#f8fafc' : 'transparent',
                  border: '1px solid #e2e8f0',
                  transition: 'all 0.2s ease',
                  marginBottom: expandedVersions['1.6.1'] ? '16px' : 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{
                      background: '#5B5BD6',
                      color: 'white',
                      padding: '4px 12px',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: 600
                    }}>
                      גרסה 1.6.1
                    </span>
                    <time dateTime="2025-11-27" style={{ color: '#64748b', fontSize: '14px' }}>
                      27 בנובמבר 2025
                    </time>
                  </div>
                  <span style={{
                    fontSize: '20px',
                    color: '#64748b',
                    transition: 'transform 0.2s ease',
                    transform: expandedVersions['1.6.1'] ? 'rotate(180deg)' : 'rotate(0deg)',
                    display: 'inline-block'
                  }}>
                    ▼
                  </span>
                </div>
                <h3 style={{
                  fontWeight: 700,
                  fontSize: 18,
                  margin: '8px 0 0 0',
                  color: '#1e293b',
                  lineHeight: 1.4
                }}>
                  📋 מסמכי ארגון ושיפורי חוויית משתמש
                </h3>
              </header>

              {expandedVersions['1.6.1'] && (
              <section style={{ paddingRight: '16px' }}>
                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  תוספות:
                </h4>
                <ul style={{
                  listStyle: 'disc',
                  paddingRight: '24px',
                  margin: '8px 0 16px',
                  color: '#334155'
                }}>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>מסמכי ארגון:</strong> אפשרות להעלות ולנהל מסמכים ארגוניים כלליים (רישיונות, אישורים, תעודות) שאינם קשורים לתלמיד או מדריך ספציפי. מנהלים יכולים לשלוט מי רואה את המסמכים
                  </li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  שיפורים:
                </h4>
                <ul style={{
                  listStyle: 'disc',
                  paddingRight: '24px',
                  margin: '8px 0 16px',
                  color: '#334155'
                }}>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>חלון הצלחה בתיעוד מפגש:</strong> לאחר שמירת מפגש, החלון נשאר פתוח עם אפשרות לתעד מפגש נוסף עם אותו תלמיד או תלמיד אחר - חוסך זמן ומקל על תיעוד מרוכז
                  </li>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>מיון מסמכים משופר:</strong> ניתן למיין מסמכים לפי שם, תאריך העלאה או תאריך תפוגה בסדר עולה או יורד
                  </li>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>סינון מתקדם בחלון תיעוד:</strong> הסינונים המתקדמים כעת מוסתרים כברירת מחדל לחווית משתמש נקייה יותר - לחצו על "סינון מתקדם" כדי להציג אותם
                  </li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  תיקוני באגים:
                </h4>
                <ul style={{
                  listStyle: 'disc',
                  paddingRight: '24px',
                  margin: '8px 0',
                  color: '#334155'
                }}>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>תיקון הורדת מסמכים:</strong> הורדת קבצים כעת מוריד את המסמך במקום לפתוח בתצוגה מקדימה
                  </li>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>תיקון סגירת חלונות:</strong> כאשר פותחים תיעוד מפגש מתוך רשימת מפגשים, לחיצה על X תסגור רק את חלון התיעוד ולא את הרשימה
                  </li>
                </ul>
              </section>
              )}
            </article>
          </li>

          {/* 1.6.0 - Documents management and audit logging */}
          <li dir="rtl" style={{ marginBottom: 16, textAlign: 'right' }}>
            <article style={{ display: 'flex', flexDirection: 'column' }}>
              <header
                onClick={() => toggleVersion('1.6.0')}
                style={{
                  cursor: 'pointer',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: expandedVersions['1.6.0'] ? '#f8fafc' : 'transparent',
                  border: '1px solid #e2e8f0',
                  transition: 'all 0.2s ease',
                  marginBottom: expandedVersions['1.6.0'] ? '16px' : 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{
                      background: '#5B5BD6',
                      color: 'white',
                      padding: '4px 12px',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: 600
                    }}>
                      גרסה 1.6.0
                    </span>
                    <time dateTime="2025-11-26" style={{ color: '#64748b', fontSize: '14px' }}>
                      26 בנובמבר 2025
                    </time>
                  </div>
                  <span style={{
                    fontSize: '20px',
                    color: '#64748b',
                    transition: 'transform 0.2s ease',
                    transform: expandedVersions['1.6.0'] ? 'rotate(180deg)' : 'rotate(0deg)',
                    display: 'inline-block'
                  }}>
                    ▼
                  </span>
                </div>
                <h3 style={{
                  fontWeight: 700,
                  fontSize: 18,
                  margin: '8px 0 0 0',
                  color: '#1e293b',
                  lineHeight: 1.4
                }}>
                  📁 ניהול מסמכים, סיווגי מדריכים ואבטחה משופרת
                </h3>
              </header>

              {expandedVersions['1.6.0'] && (
              <section style={{ paddingRight: '16px' }}>
                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  תוספות:
                </h4>
                <ul style={{
                  listStyle: 'disc',
                  paddingRight: '24px',
                  margin: '8px 0 16px',
                  color: '#334155'
                }}>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>ניהול מסמכים לתלמידים:</strong> מנהלים יכולים להגדיר מסמכים נדרשים לתלמידים, להעלות ולצפות בקבצים. תמיכה בהגדרת מסמכים לפי תגיות תלמידים
                  </li>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>ניהול מסמכים למדריכים:</strong> העלאת וניהול מסמכים למדריכים (תעודות רפואיות, הסמכות וכו'). מדריכים יכולים להעלות קבצים דרך ההגדרות
                  </li>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>הקצאת מסמכים לפי סיווג:</strong> ניתן להגדיר מסמכים ספציפיים לתגיות תלמידים או לסוגי מדריכים מסוימים
                  </li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  שיפורים:
                </h4>
                <ul style={{
                  listStyle: 'disc',
                  paddingRight: '24px',
                  margin: '8px 0 16px',
                  color: '#334155'
                }}>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>אבחון משופר:</strong> מידע ניפוי באגים כעת כולל בדיקת סטטוס מדריך ואפשרות לרענן הרשאות ארגון במקרה של שגיאה
                  </li>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>ביצועים:</strong> זמני טעינה משופרים באזורים שונים במערכת
                  </li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  שיפורי אבטחה:
                </h4>
                <ul style={{
                  listStyle: 'disc',
                  paddingRight: '24px',
                  margin: '8px 0 16px',
                  color: '#334155'
                }}>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>תיעוד פעולות:</strong> המערכת כעת מתעדת פעולות חשובות (הזמנות, שינוי תפקידים, העלאת קבצים ועוד) לצורך מעקב ותחקור
                  </li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  שינויים טכניים:
                </h4>
                <ul style={{
                  listStyle: 'disc',
                  paddingRight: '24px',
                  margin: '8px 0',
                  color: '#334155'
                }}>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>עיצוב מחודש:</strong> חלון ניהול מדריכים עבר שדרוג ושיפור במבנה (מנהלים בלבד)
                  </li>
                </ul>
              </section>
              )}
            </article>
          </li>

          {/* 1.5.0 - Safari improvements and visual hierarchy */}
          <li dir="rtl" style={{ marginBottom: 16, textAlign: 'right' }}>
            <article style={{ display: 'flex', flexDirection: 'column' }}>
              <header
                onClick={() => toggleVersion('1.5.0')}
                style={{
                  cursor: 'pointer',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: expandedVersions['1.5.0'] ? '#f8fafc' : 'transparent',
                  border: '1px solid #e2e8f0',
                  transition: 'all 0.2s ease',
                  marginBottom: expandedVersions['1.5.0'] ? '16px' : 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{
                      background: '#5B5BD6',
                      color: 'white',
                      padding: '4px 12px',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: 600
                    }}>
                      גרסה 1.5.0
                    </span>
                    <time dateTime="2025-11-21" style={{ color: '#64748b', fontSize: '14px' }}>
                      21 בנובמבר 2025
                    </time>
                  </div>
                  <span style={{
                    fontSize: '20px',
                    color: '#64748b',
                    transition: 'transform 0.2s ease',
                    transform: expandedVersions['1.5.0'] ? 'rotate(180deg)' : 'rotate(0deg)',
                    display: 'inline-block'
                  }}>
                    ▼
                  </span>
                </div>
                <h3 style={{
                  fontWeight: 700,
                  fontSize: 18,
                  margin: '8px 0 0 0',
                  color: '#1e293b',
                  lineHeight: 1.4
                }}>
                  🍎 ייבוא דוחות, שיפורי Apple ועיצוב משופר
                </h3>
              </header>

              {expandedVersions['1.5.0'] && (
              <section style={{ paddingRight: '16px' }}>
                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  תוספות:
                </h4>
                <ul style={{
                  listStyle: 'disc',
                  paddingRight: '24px',
                  margin: '8px 0 16px',
                  color: '#334155'
                }}>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>ייבוא דוחות קודמים (למנהלים בלבד):</strong> כעת ניתן להעלות דוחות היסטוריים דרך קובץ CSV
                  </li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  שיפורים:
                </h4>
                <ul style={{
                  listStyle: 'disc',
                  paddingRight: '24px',
                  margin: '8px 0 16px',
                  color: '#334155'
                }}>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>תמיכה בסאפרי ובמכשירי Apple:</strong> תיבות הבחירה ופעולות קטנות נוספות פועלות כעת בצורה משופרת במכשירי Apple
                  </li>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>עיצוב משופר לבחירת תלמיד:</strong> התיבה לבחירת תלמיד בדוח חדש בולטת יותר ונבדלת בבירור מהפילטרים
                  </li>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>תפריטים נפתחים עקביים:</strong> כל התפריטים הנפתחים בכל המערכת עובדים באותו אופן ונראים זהה
                  </li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  תיקוני באגים:
                </h4>
                <ul style={{
                  listStyle: 'disc',
                  paddingRight: '24px',
                  margin: '8px 0',
                  color: '#334155'
                }}>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>תיקון קריסה בנייד:</strong> החלונות הפנימיים לא קורסים יותר בלחיצה מחוץ לתפריט נפתח בנייד
                  </li>
                  <li style={{ marginBottom: '6px' }}>
                    <strong>תיקון מיקוד בתצוגת שבוע בנייד:</strong> המערכת מתמקדת כעת ביום הנוכחי במקום ביום הראשון של השבוע
                  </li>
                </ul>
              </section>
              )}
            </article>
          </li>

          {/* 1.4.0 - Weekly & daily compliance refresh */}
          <li dir="rtl" style={{ marginBottom: 16, textAlign: 'right' }}>
            <article style={{ display: 'flex', flexDirection: 'column' }}>
              <header
                onClick={() => toggleVersion('1.4.0')}
                style={{
                  cursor: 'pointer',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: expandedVersions['1.4.0'] ? '#f8fafc' : 'transparent',
                  border: '1px solid #e2e8f0',
                  transition: 'all 0.2s ease',
                  marginBottom: expandedVersions['1.4.0'] ? '16px' : 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{
                      background: '#5B5BD6',
                      color: 'white',
                      padding: '4px 12px',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: 600
                    }}>
                      גרסה 1.4.0
                    </span>
                    <time dateTime="2025-11-16" style={{ color: '#64748b', fontSize: '14px' }}>
                      16 בנובמבר 2025
                    </time>
                  </div>
                  <span style={{
                    fontSize: '20px',
                    color: '#64748b',
                    transition: 'transform 0.2s ease',
                    transform: expandedVersions['1.4.0'] ? 'rotate(180deg)' : 'rotate(0deg)',
                    display: 'inline-block'
                  }}>
                    ▼
                  </span>
                </div>
                <h3 style={{
                  fontWeight: 700,
                  fontSize: 18,
                  margin: '8px 0 0 0',
                  color: '#1e293b',
                  lineHeight: 1.4
                }}>
                  📊 תצוגות תאימות משודרגות וצבע מדריך חכם
                </h3>
              </header>

              {expandedVersions['1.4.0'] && (
              <section style={{ paddingRight: '16px' }}>
                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  שינויים עיקריים:
                </h4>
                <ul style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong>תצוגה שבועית, יומית ורחבה חדשה במסך הראשי:</strong> כל שלוש התצוגות מאוחדות למבנה מודרני שמדגיש סטטוס תיעוד עדכני כבר מהיום הנוכחי ומאפשר מעבר חלק ביניהן.
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong>התאמת צבע למדריך אוטומטי:</strong> מנגנון הצבעים מבטיח שלכל מדריך יוקצה צבע חדש שלא נעשה בו שימוש קודם כדי לשמור על קריאות ויזואלית מלאה.
                  </li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  תיקונים:
                </h4>
                <ul style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#10b981' }}>✓</span>
                    תיקוני באגים כלליים לשיפור יציבות המערכת.
                  </li>
                </ul>
              </section>
              )}
            </article>
          </li>

          {/* 1.3.2 - Mandatory manual date selection in session form */}
          <li dir="rtl" style={{ marginBottom: 16, textAlign: 'right' }}>
            <article style={{ display: 'flex', flexDirection: 'column' }}>
              <header
                onClick={() => toggleVersion('1.3.2')}
                style={{
                  cursor: 'pointer',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: expandedVersions['1.3.2'] ? '#f8fafc' : 'transparent',
                  border: '1px solid #e2e8f0',
                  transition: 'all 0.2s ease',
                  marginBottom: expandedVersions['1.3.2'] ? '16px' : 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{
                      background: '#5B5BD6',
                      color: 'white',
                      padding: '4px 12px',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: 600
                    }}>
                      גרסה 1.3.2
                    </span>
                    <time dateTime="2025-11-09" style={{ color: '#64748b', fontSize: '14px' }}>
                      9 בנובמבר 2025
                    </time>
                  </div>
                  <span style={{
                    fontSize: '20px',
                    color: '#64748b',
                    transition: 'transform 0.2s ease',
                    transform: expandedVersions['1.3.2'] ? 'rotate(180deg)' : 'rotate(0deg)',
                    display: 'inline-block'
                  }}>
                    ▼
                  </span>
                </div>
                <h3 style={{
                  fontWeight: 700,
                  fontSize: 18,
                  margin: '8px 0 0 0',
                  color: '#1e293b',
                  lineHeight: 1.4
                }}>
                  📆 בחירת תאריך מפגש ידנית + דיוק תיעוד
                </h3>
              </header>

              {expandedVersions['1.3.2'] && (
              <section style={{ paddingRight: '16px' }}>
                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  שינויים עיקריים:
                </h4>
                <ul style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong>דרישת בחירת תאריך מפגש ידנית:</strong> בטופס יצירת מפגש חדש חובה עכשיו לבחור תאריך באופן מפורש במקום הסתמכות על ערך ברירת מחדל. מונע טעויות רישום על תאריך שגוי ומקבע תשומת לב המשתמש לשדה
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong>הדגשת שדה חובה:</strong> כוכבית ושגיאת אימות ברורה אם נשלח טופס ללא תאריך, עם הודעת שגיאה עקבית לכלל טפסי המפגש
                  </li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  תיקונים:
                </h4>
                <ul style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#10b981' }}>✓</span>
                    תוקן הטקסט במסך הראשי מ"ברוכים הבא" ל"ברוכים הבאים"
                  </li>
                </ul>
              </section>
              )}
            </article>
          </li>

          {/* 1.3.1 - Student notes persistence */}
          <li dir="rtl" style={{ marginBottom: 16, textAlign: 'right' }}>
            <article style={{ display: 'flex', flexDirection: 'column' }}>
              <header
                onClick={() => toggleVersion('1.3.1')}
                style={{
                  cursor: 'pointer',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: expandedVersions['1.3.1'] ? '#f8fafc' : 'transparent',
                  border: '1px solid #e2e8f0',
                  transition: 'all 0.2s ease',
                  marginBottom: expandedVersions['1.3.1'] ? '16px' : 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{
                      background: '#5B5BD6',
                      color: 'white',
                      padding: '4px 12px',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: 600
                    }}>
                      גרסה 1.3.1
                    </span>
                    <time dateTime="2025-11-09" style={{ color: '#64748b', fontSize: '14px' }}>
                      9 בנובמבר 2025
                    </time>
                  </div>
                  <span style={{
                    fontSize: '20px',
                    color: '#64748b',
                    transition: 'transform 0.2s ease',
                    transform: expandedVersions['1.3.1'] ? 'rotate(180deg)' : 'rotate(0deg)',
                    display: 'inline-block'
                  }}>
                    ▼
                  </span>
                </div>
                <h3 style={{
                  fontWeight: 700,
                  fontSize: 18,
                  margin: '8px 0 0 0',
                  color: '#1e293b',
                  lineHeight: 1.4
                }}>
                  📝 שמירת הערות תלמידים ותיעוד ברור בטפסים
                </h3>
              </header>

              {expandedVersions['1.3.1'] && (
              <section style={{ paddingRight: '16px' }}>
                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  שיפורים:
                </h4>
                <ul style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong>שימור הערות תלמידים:</strong> הערות שנוספו לתלמיד נשמרות עכשיו גם אחרי יצירה או עריכה מחודשת.
                  </li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  תיקוני באגים:
                </h4>
                <ul style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#10b981' }}>✓</span>
                    תיקנו הודעות שגיאה כך שהמערכת תדריך בצורה ברורה כשיש בעיה עם הערות.
                  </li>
                </ul>
              </section>
              )}
            </article>
          </li>

          {/* 1.3.0 - Student lifecycle controls */}
          <li dir="rtl" style={{ marginBottom: 16, textAlign: 'right' }}>
            <article style={{ display: 'flex', flexDirection: 'column' }}>
              <header
                onClick={() => toggleVersion('1.3.0')}
                style={{
                  cursor: 'pointer',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: expandedVersions['1.3.0'] ? '#f8fafc' : 'transparent',
                  border: '1px solid #e2e8f0',
                  transition: 'all 0.2s ease',
                  marginBottom: expandedVersions['1.3.0'] ? '16px' : 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{
                      background: '#5B5BD6',
                      color: 'white',
                      padding: '4px 12px',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: 600
                    }}>
                      גרסה 1.3.0
                    </span>
                    <time dateTime="2025-11-08" style={{ color: '#64748b', fontSize: '14px' }}>
                      8 בנובמבר 2025
                    </time>
                  </div>
                  <span style={{
                    fontSize: '20px',
                    color: '#64748b',
                    transition: 'transform 0.2s ease',
                    transform: expandedVersions['1.3.0'] ? 'rotate(180deg)' : 'rotate(0deg)',
                    display: 'inline-block'
                  }}>
                    ▼
                  </span>
                </div>
                <h3 style={{
                  fontWeight: 700,
                  fontSize: 18,
                  margin: '8px 0 0 0',
                  color: '#1e293b',
                  lineHeight: 1.4
                }}>
                  🧭 ניהול מחזור חיים של תלמידים ושיפורי בחירת תלמידים
                </h3>
              </header>

              {expandedVersions['1.3.0'] && (
              <section style={{ paddingRight: '16px' }}>
                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  חידושים:
                </h4>
                <ul style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong>סימון תלמידים כלא פעילים (למנהלים בלבד):</strong> נוספה האפשרות להסתיר תלמידים לא פעילים, תוך שמירה על כל ההיסטוריה שלהם זמינה לצפייה וייצוא
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong>העדפת תצוגה למדריכים:</strong> מנהלים יכולים להחליט אם מדריכים יראו תלמידים לא פעילים דרך כרטיס ההגדרות החדש (הגדרה רחבה)
                  </li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  שיפורים:
                </h4>
                <ul style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong>מסנני תלמידים חכמים:</strong> רשימות תלמידים, טפסים וסינונים זוכרים את בחירתכם ומוודאים שהתוצאות מסונכרנות עם הנתונים שהוטענו מהשרת
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong>פתיחת תיעוד מתלמיד לא פעיל:</strong> ניתן לפתוח תיעוד חדש מתוך פרופיל של תלמיד לא פעיל במקרה הצורך
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong>חוויית מובייל טובה יותר (למנהלים בלבד):</strong> בקרת "הצג" ברשימת התלמידים קיבלה רוחב גמיש כך שהיא לא תגלוש מחוץ למסך במכשירים צרים
                  </li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  תיקוני באגים:
                </h4>
                <ul style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#10b981' }}>✓</span>
                    כפתור "נקה מסננים" מיושר עכשיו לצד שאר הבקרות כך שהטופס נשאר קומפקטי
                  </li>
                </ul>
              </section>
              )}
            </article>
          </li>

          {/* 1.2.0 - PDF Export & Registration */}
          <li dir="rtl" style={{ marginBottom: 16, textAlign: 'right' }}>
            <article style={{ display: 'flex', flexDirection: 'column' }}>
              <header 
                onClick={() => toggleVersion('1.2.0')}
                style={{ 
                  cursor: 'pointer',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: expandedVersions['1.2.0'] ? '#f8fafc' : 'transparent',
                  border: '1px solid #e2e8f0',
                  transition: 'all 0.2s ease',
                  marginBottom: expandedVersions['1.2.0'] ? '16px' : 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ 
                      background: '#5B5BD6', 
                      color: 'white', 
                      padding: '4px 12px', 
                      borderRadius: '6px', 
                      fontSize: '14px',
                      fontWeight: 600
                    }}>
                      גרסה 1.2.0
                    </span>
                    <time dateTime="2025-11-06" style={{ color: '#64748b', fontSize: '14px' }}>
                      6 בנובמבר 2025
                    </time>
                  </div>
                  <span style={{ 
                    fontSize: '20px', 
                    color: '#64748b',
                    transition: 'transform 0.2s ease',
                    transform: expandedVersions['1.2.0'] ? 'rotate(180deg)' : 'rotate(0deg)',
                    display: 'inline-block'
                  }}>
                    ▼
                  </span>
                </div>
                <h3 style={{ 
                  fontWeight: 700, 
                  fontSize: 18, 
                  margin: '8px 0 0 0',
                  color: '#1e293b',
                  lineHeight: 1.4
                }}>
                  📄 ייצוא PDF, הרשמה משופרת ותיקוני הזמנות
                </h3>
              </header>

              {expandedVersions['1.2.0'] && (
              <section style={{ paddingRight: '16px' }}>
                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  תוספות:
                </h4>
                <ul style={{ 
                  listStyle: 'none', 
                  padding: 0, 
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong>ייצוא PDF של היסטוריית המפגשים (מנהלים בלבד):</strong>. כולל תמיכה בעברית ומיתוג ארגוני בהתאם להרשאות
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong>עריכת שמות תצוגה (מנהלים בלבד):</strong> מנהלים יכולים לערוך את שם התצוגה של חברי הארגון
                  </li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  שיפורים:
                </h4>
                <ul style={{ 
                  listStyle: 'none', 
                  padding: 0, 
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong>שיפור תהליך ההרשמה:</strong> הודעות ברורות ותזרים משופר למשתמשים במהלך ההרשמה לארגון
                  </li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  תיקוני באגים:
                </h4>
                <ul style={{ 
                  listStyle: 'none', 
                  padding: 0, 
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#10b981' }}>✓</span>
                    שופרו הודעות ושומרי-סף בזרימת ההזמנות; טיפול טוב יותר בקישורים שפגו או שומשו
                  </li>
                </ul>
              </section>
              )}
            </article>
          </li>

          {/* 1.1.1 - Sorting & Layout */}
          <li dir="rtl" style={{ marginBottom: 16, textAlign: 'right' }}>
            <article style={{ display: 'flex', flexDirection: 'column' }}>
              <header 
                onClick={() => toggleVersion('1.1.1')}
                style={{ 
                  cursor: 'pointer',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: expandedVersions['1.1.1'] ? '#f8fafc' : 'transparent',
                  border: '1px solid #e2e8f0',
                  transition: 'all 0.2s ease',
                  marginBottom: expandedVersions['1.1.1'] ? '16px' : 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ 
                      background: '#5B5BD6', 
                      color: 'white', 
                      padding: '4px 12px', 
                      borderRadius: '6px', 
                      fontSize: '14px',
                      fontWeight: 600
                    }}>
                      גרסה 1.1.1
                    </span>
                    <time dateTime="2025-11-05" style={{ color: '#64748b', fontSize: '14px' }}>
                      5 בנובמבר 2025
                    </time>
                  </div>
                  <span style={{ 
                    fontSize: '20px', 
                    color: '#64748b',
                    transition: 'transform 0.2s ease',
                    transform: expandedVersions['1.1.1'] ? 'rotate(180deg)' : 'rotate(0deg)',
                    display: 'inline-block'
                  }}>
                    ▼
                  </span>
                </div>
                <h3 style={{ 
                  fontWeight: 700, 
                  fontSize: 18, 
                  margin: '8px 0 0 0',
                  color: '#1e293b',
                  lineHeight: 1.4
                }}>
                  🔀 מיון ושיפורי תצוגה
                </h3>
              </header>

              {expandedVersions['1.1.1'] && (
              <section style={{ paddingRight: '16px' }}>
                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  שינויים ושיפורים:
                </h4>
                <ul style={{ 
                  listStyle: 'none', 
                  padding: 0, 
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong>שינוי ברירת מחדל למיון:</strong> ברירת המחדל ברשימת התלמידים היא עכשיו לפי יום ושעה במקום לפי שם
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong>מיון מתקדם (מנהלים בלבד):</strong> עכשיו ניתן למיין את עמוד התלמידים לפי מדריך / שם / יום ושעה
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong>שיפור תצוגת פרופיל תלמיד:</strong> עיצוב ופריסה משופרים בדף פרופיל התלמיד
                  </li>
                </ul>
              </section>
              )}
            </article>
          </li>

          {/* 1.1.0 - Tags & Invitations */}
          <li dir="rtl" style={{ marginBottom: 16, textAlign: 'right' }}>
            <article style={{ display: 'flex', flexDirection: 'column' }}>
              <header 
                onClick={() => toggleVersion('1.1.0')}
                style={{ 
                  cursor: 'pointer',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: expandedVersions['1.1.0'] ? '#f8fafc' : 'transparent',
                  border: '1px solid #e2e8f0',
                  transition: 'all 0.2s ease',
                  marginBottom: expandedVersions['1.1.0'] ? '16px' : 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ 
                      background: '#5B5BD6', 
                      color: 'white', 
                      padding: '4px 12px', 
                      borderRadius: '6px', 
                      fontSize: '14px',
                      fontWeight: 600
                    }}>
                      גרסה 1.1.0
                    </span>
                    <time dateTime="2025-11-04" style={{ color: '#64748b', fontSize: '14px' }}>
                      4 בנובמבר 2025
                    </time>
                  </div>
                    <span style={{ 
                    fontSize: '20px', 
                    color: '#64748b',
                    transition: 'transform 0.2s ease',
                    transform: expandedVersions['1.1.0'] ? 'rotate(180deg)' : 'rotate(0deg)',
                    display: 'inline-block'
                  }}>
                    ▼
                  </span>
                </div>
                <h3 style={{ 
                  fontWeight: 700, 
                  fontSize: 18, 
                  margin: '8px 0 0 0',
                  color: '#1e293b',
                  lineHeight: 1.4
                }}>
                  ✨ שיפורי ניהול תלמידים והזמנות
                </h3>
              </header>

              {expandedVersions['1.1.0'] && (
              <section style={{ paddingRight: '16px' }}>
                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  שיפורים:
                </h4>
                <ul style={{ 
                  listStyle: 'none', 
                  padding: 0, 
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong>ניהול תגיות תלמידים:</strong> תגיות תלמידים עברו שדרוג - עכשיו ניתן לבחור מרשימה מוגדרת מראש במקום טקסט חופשי. מנהלים יכולים ליצור, לערוך ולמחוק תגיות מדף ההגדרות או מטופס עריכת התלמיד
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong>שליחת הזמנות מחדש:</strong> מנהלים יכולים כעת לשלוח הזמנה מחדש למשתמשים שקישור ההזמנה שלהם פג
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong>כפתור יציאה בבחירת ארגון:</strong> עמוד בחירת הארגון כולל כעת כפתור להתנתקות מהמערכת
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong>תהליך הרשמה משופר:</strong> תהליך ההרשמה מספק כעת משוב ברור יותר למשתמשים לגבי מצב החשבון שלהם
                  </li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  תיקונים:
                </h4>
                <ul style={{ 
                  listStyle: 'none', 
                  padding: 0, 
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#10b981' }}>✓</span>
                    תוקן באג שמנע שמירה נכונה של תגיות תלמידים (מנהלים בלבד)
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#10b981' }}>✓</span>
                    תוקן באג שמנע שמירת שינויים בפרופיל תלמיד כאשר לא עורכים את שעות ברירת המחדל (מנהלים בלבד)
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#10b981' }}>✓</span>
                    קישורי הזמנה כעת תקפים ל-24 שעות
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#10b981' }}>✓</span>
                    תוקן תהליך יצירת הסיסמה במהלך תהליך ההרשמה, עם הודעות שגיאה ברורות יותר
                  </li>
                </ul>
              </section>
              )}
            </article>
          </li>

          {/* 1.0.1 - Bug Fixes & UI Improvements */}
          <li dir="rtl" style={{ marginBottom: 16, textAlign: 'right' }}>
            <article style={{ display: 'flex', flexDirection: 'column' }}>
              <header 
                onClick={() => toggleVersion('1.0.1')}
                style={{ 
                  cursor: 'pointer',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: expandedVersions['1.0.1'] ? '#f8fafc' : 'transparent',
                  border: '1px solid #e2e8f0',
                  transition: 'all 0.2s ease',
                  marginBottom: expandedVersions['1.0.1'] ? '16px' : 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ 
                      background: '#5B5BD6', 
                      color: 'white', 
                      padding: '4px 12px', 
                      borderRadius: '6px', 
                      fontSize: '14px',
                      fontWeight: 600
                    }}>
                      גרסה 1.0.1
                    </span>
                    <time dateTime="2025-11-03" style={{ color: '#64748b', fontSize: '14px' }}>
                      3 בנובמבר 2025
                    </time>
                  </div>
                  <span style={{ 
                    fontSize: '20px', 
                    color: '#64748b',
                    transition: 'transform 0.2s ease',
                    transform: expandedVersions['1.0.1'] ? 'rotate(180deg)' : 'rotate(0deg)',
                    display: 'inline-block'
                  }}>
                    ▼
                  </span>
                </div>
                <h3 style={{ 
                  fontWeight: 700, 
                  fontSize: 18, 
                  margin: '8px 0 0 0',
                  color: '#1e293b',
                  lineHeight: 1.4
                }}>
                  🔧 תיקוני באגים ושיפורי ממשק
                </h3>
              </header>

              {expandedVersions['1.0.1'] && (
              <section style={{ paddingRight: '16px' }}>
                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  תוספות:
                </h4>
                <ul style={{ 
                  listStyle: 'none', 
                  padding: 0, 
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    נוסף כפתור לאיפוס מסננים בעמוד התלמידים ובטופס רישום מפגש
                  </li>
                </ul>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  תיקונים:
                </h4>
                <ul style={{ 
                  listStyle: 'none', 
                  padding: 0, 
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#10b981' }}>✓</span>
                    תוקן באג בתהליך ההזמנות לארגון
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#10b981' }}>✓</span>
                    תוקן באג ביצירת רישום דרך פרופיל התלמיד - כעת ניתן לשלוח את הטופס מיד ללא צורך להחליף תלמיד ידנית
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#10b981' }}>✓</span>
                    תוקן באג שבו התפריט הסתיר את כפתורי הטופס
                  </li>
                </ul>
              </section>
              )}
            </article>
          </li>

          {/* 1.0.0 - TutTiud Launch */}
          <li dir="rtl" style={{ marginBottom: 0, textAlign: 'right' }}>
            <article style={{ display: 'flex', flexDirection: 'column' }}>
              <header 
                onClick={() => toggleVersion('1.0.0')}
                style={{ 
                  cursor: 'pointer',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: expandedVersions['1.0.0'] ? '#f8fafc' : 'transparent',
                  border: '1px solid #e2e8f0',
                  transition: 'all 0.2s ease',
                  marginBottom: expandedVersions['1.0.0'] ? '16px' : 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ 
                      background: '#5B5BD6', 
                      color: 'white', 
                      padding: '4px 12px', 
                      borderRadius: '6px', 
                      fontSize: '14px',
                      fontWeight: 600
                    }}>
                      גרסה 1.0.0
                    </span>
                    <time dateTime="2025-10-26" style={{ color: '#64748b', fontSize: '14px' }}>
                      26 באוקטובר 2025
                    </time>
                  </div>
                  <span style={{ 
                    fontSize: '20px', 
                    color: '#64748b',
                    transition: 'transform 0.2s ease',
                    transform: expandedVersions['1.0.0'] ? 'rotate(180deg)' : 'rotate(0deg)',
                    display: 'inline-block'
                  }}>
                    ▼
                  </span>
                </div>
                <h3 style={{ 
                  fontWeight: 700, 
                  fontSize: 18, 
                  margin: '8px 0 0 0',
                  color: '#1e293b',
                  lineHeight: 1.4
                }}>
                  🎉 השקת תותיעוד - מערכת ניהול תלמידים ומפגשים
                </h3>
              </header>

              {expandedVersions['1.0.0'] && (
              <section style={{ paddingRight: '16px' }}>
                <p style={{ margin: '0 0 16px', color: '#475569', lineHeight: 1.6 }}>
                  ברוכים הבאים למערכת תותיעוד! פלטפורמה מקצועית לניהול תלמידים, תיעוד מפגשים ומעקב אחר התקדמות.
                </p>

                <h4 style={{ fontWeight: 600, fontSize: 16, margin: '16px 0 8px', color: '#334155' }}>
                  תכונות עיקריות:
                </h4>
                <ul style={{ 
                  listStyle: 'none', 
                  padding: 0, 
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong style={{ fontWeight: 600 }}>ניהול תלמידים:</strong> הוספה, עריכה וארגון תלמידים עם פרטי קשר מלאים
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong style={{ fontWeight: 600 }}>ניהול מדריכים:</strong> הקצאת תלמידים למדריכים והגדרת הרשאות
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong style={{ fontWeight: 600 }}>תיעוד מפגשים:</strong> רישום מפגשים עם טופס שאלות מותאם אישית
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong style={{ fontWeight: 600 }}>היסטוריית מפגשים:</strong> צפייה בכל המפגשים הקודמים לכל תלמיד
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong style={{ fontWeight: 600 }}>ניהול שירותים:</strong> הגדרת סוגי שירותים שונים לארגון
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong style={{ fontWeight: 600 }}>טופס מפגש מתקדם:</strong> יצירת שאלות מסוגים שונים (טקסט, מספר, בחירה, סולם ועוד)
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong style={{ fontWeight: 600 }}>ממשק מותאם נייד:</strong> עבודה נוחה ממכשירים ניידים וטאבלטים
                  </li>
                  <li style={{ paddingRight: '20px', position: 'relative' }}>
                    <span style={{ position: 'absolute', right: 0, color: '#5B5BD6' }}>•</span>
                    <strong style={{ fontWeight: 600 }}>ניהול ארגונים:</strong> תמיכה בריבוי ארגונים ומשתמשים
                  </li>
                </ul>

                <div style={{ 
                  marginTop: '20px', 
                  padding: '16px', 
                  background: '#f8fafc', 
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0'
                }}>
                  <p style={{ margin: 0, fontSize: '14px', color: '#475569' }}>
                    <strong style={{ color: '#334155' }}>💡 טיפ:</strong> התחילו בהגדרת הארגון בעמוד ההגדרות, הוסיפו מדריכים ושירותים, ולאחר מכן התחילו להוסיף תלמידים.
                  </p>
                </div>
              </section>
              )}
            </article>
          </li>
        </ul>
        </div>
      </div>
      </div>
    );
  }
