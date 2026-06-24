import { useEffect } from 'react';

const LAUNCH_VERSION = {
  version: '0.0.1',
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
        'לייבא נתונים קיימים מקובצי אקסל/CSV דרך "סביבות ייבוא": מיפוי עמודות ללקוחות, הורים ושירותים, בדיקה וניקוי של הנתונים לפני שמירה, וייבוא מבוקר למערכת הפעילה.',
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
};

export default function ChangelogModal({ open, onClose }) {
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
          width: 'min(92vw, 760px)',
          maxHeight: 'min(86vh, 720px)',
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
            padding: '28px 28px 22px',
            borderBottom: '1px solid #e2e8f0',
            background: 'linear-gradient(135deg, #f8fafc 0%, #eef6ff 100%)',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 12,
            }}
          >
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
              גרסה {LAUNCH_VERSION.version}
            </span>
            <time dateTime={LAUNCH_VERSION.date} style={{ color: '#64748b', fontSize: 14 }}>
              {LAUNCH_VERSION.displayDate}
            </time>
          </div>

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
            {LAUNCH_VERSION.title}
          </h2>
          <p
            style={{
              margin: '10px 0 0',
              color: '#475569',
              fontSize: 15,
              lineHeight: 1.7,
              maxWidth: 640,
            }}
          >
            {LAUNCH_VERSION.description}
          </p>
        </header>

        <main style={{ padding: 28, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gap: 18 }}>
            {LAUNCH_VERSION.sections.map((section) => (
              <section
                key={section.title}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 16,
                  padding: 18,
                  background: '#ffffff',
                }}
              >
                <h3
                  style={{
                    margin: '0 0 10px',
                    color: '#1e293b',
                    fontSize: 17,
                    fontWeight: 750,
                  }}
                >
                  {section.title}
                </h3>
                <ul
                  style={{
                    margin: 0,
                    padding: 0,
                    listStyle: 'none',
                    display: 'grid',
                    gap: 9,
                    color: '#475569',
                    lineHeight: 1.65,
                  }}
                >
                  {section.items.map((item) => (
                    <li key={item} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                      <span style={{ color: '#2563eb', fontWeight: 900, lineHeight: 1.65 }}>•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
