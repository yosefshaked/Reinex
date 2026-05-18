import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, Calendar, Shield, Smartphone, ListChecks, CreditCard, FileText, Loader2 } from 'lucide-react';
import { AccessibilityProvider } from '@/features/accessibility/AccessibilityProvider.jsx';
import AccessibilityButton from '@/features/accessibility/AccessibilityButton.jsx';

const features = [
  {
    icon: Calendar,
    title: 'תזמון לפי תבנית שבועית',
    description: 'הגדירו תבנית פעם אחת, והמערכת תייצר את כל המפגשים אוטומטית — שבוע אחרי שבוע.',
  },
  {
    icon: ListChecks,
    title: 'רישום נוכחות ומעקב',
    description: 'רישום מהיר של מי הגיע ומי לא, ומעקב ויזואלי על רצף ההתמדה של כל לקוח.',
  },
  {
    icon: CreditCard,
    title: 'חבילות תשלום וחיוב',
    description: 'מכירת חבילות שיעורים מראש, ניכוי אוטומטי עם כל מפגש, וכיסוי קופות חולים.',
  },
  {
    icon: Users,
    title: 'ניהול לקוחות ופרופילים',
    description: 'פרטי קשר, שיוך מדריך, לוח זמנים אישי וכל היסטוריית המפגשים — בפרופיל מרוכז אחד.',
  },
  {
    icon: Smartphone,
    title: 'גישה מכל מכשיר',
    description: 'ממשק מותאם לנייד ולדסקטופ. מדריכים רושמים נוכחות מהשטח, אדמין מנהל ממשרד.',
  },
  {
    icon: Shield,
    title: 'אבטחה ובקרות גישה',
    description: 'הפרדה מלאה בין ארגונים, הרשאות לפי תפקיד, וטפסים עם אימות OTP לאיסוף מידע מלקוחות.',
  },
];

const useCases = [
  {
    icon: Users,
    title: 'מרכזי רכיבה טיפולית',
    description: 'ניהול מטופלים, שיוך למדריכים, מעקב נוכחות, תיעוד מפגשים וכיסוי קופות חולים.',
  },
  {
    icon: FileText,
    title: 'קליניקות ומרפאות',
    description: 'תורים שבועיים קבועים, טפסים מותאמים, חבילות טיפול ורשימות המתנה מנוהלות.',
  },
  {
    icon: Calendar,
    title: 'חוגים וסטודיוס',
    description: 'תבניות שבועיות חוזרות, מעקב נוכחות לקבוצה, חיוב לפי חבילה ויצירת מפגשים אוטומטית.',
  },
];

const INPUT_CLASS =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50';

export default function LandingPage() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '',
    orgName: '',
    email: '',
    phone: '',
    message: '',
    website: '', // honeypot
  });
  const [formStatus, setFormStatus] = useState('idle'); // 'idle' | 'submitting' | 'success' | 'error'
  const [formError, setFormError] = useState('');

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormStatus('submitting');
    setFormError('');
    try {
      const response = await fetch('/api/contact-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          org_name: formData.orgName,
          email: formData.email,
          phone: formData.phone,
          message: formData.message,
          website: formData.website,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (response.status === 429) {
          setFormError('כתובת האימייל הזאת כבר שלחה בקשה לאחרונה. נחזור אליכם בהקדם.');
        } else {
          setFormError(data.message || 'שגיאה בשליחה. אנא נסו שוב מאוחר יותר.');
        }
        setFormStatus('error');
        return;
      }
      setFormStatus('success');
    } catch {
      setFormError('שגיאה בשליחה. אנא נסו שוב מאוחר יותר.');
      setFormStatus('error');
    }
  };

  return (
    <AccessibilityProvider>
      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background">
        {/* Accessibility Button */}
        <div className="fixed bottom-4 start-4 z-50">
          <AccessibilityButton />
        </div>

        {/* Header */}
        <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-2">
              <img src="/icon.svg" alt="ריינקס" className="h-8 w-8" />
              <span className="text-xl font-bold text-primary">Reinex</span>
            </div>
            <Button onClick={() => navigate('/login')} className="gap-2">
              <span>כניסה למערכת</span>
            </Button>
          </div>
        </header>

        {/* Hero */}
        <section className="container mx-auto px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <div className="text-center">
            <Badge variant="outline" className="mb-6 px-4 py-1.5 text-sm font-medium">
              ניהול מפגשים | רישום נוכחות | חבילות וחיוב
            </Badge>
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl md:text-6xl">
              ניהול מסודר
              <br />
              <span className="text-primary">למרכזים עם לקוחות קבועים</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-neutral-600 sm:text-xl">
              ריינקס מרכזת את כל מה שקורה בין המפגש לחשבונית — לוחות זמנים שבועיים, רישום נוכחות, חבילות תשלום ורשימות המתנה — במקום אחד.
            </p>
            <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:justify-center">
              <Button size="lg" onClick={() => navigate('/login')} className="gap-2 text-lg">
                <span>כניסה למערכת</span>
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => document.getElementById('capabilities')?.scrollIntoView({ behavior: 'smooth' })}
                className="text-lg"
              >
                מה המערכת עושה?
              </Button>
            </div>
          </div>
        </section>

        {/* Who Is This For */}
        <section className="bg-muted/30 py-16">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                מתאים לכל ארגון שעובד עם לקוחות קבועים
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-neutral-600">
                מרכזי רכיבה טיפולית, קליניקות, חוגים — כולם עובדים לפי אותו מבנה: לקוחות קבועים, מפגשים חוזרים, תשלומים ומעקב.
              </p>
            </div>
            <div className="mt-12 grid gap-8 sm:grid-cols-3">
              {useCases.map((uc, i) => (
                <Card key={i} className="border-2 transition-all hover:border-primary/50 hover:shadow-lg">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="rounded-lg bg-primary/10 p-3">
                        <uc.icon className="h-6 w-6 text-primary" />
                      </div>
                      <div className="flex-1 text-end">
                        <h3 className="text-lg font-semibold text-foreground">{uc.title}</h3>
                        <p className="mt-2 text-sm text-neutral-600">{uc.description}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Core Capabilities */}
        <section id="capabilities" className="container mx-auto px-4 py-16 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              מה המערכת עושה בפועל
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-neutral-600">
              כלים שמכסים את המחזור המלא — מהזמנת מפגש ועד לתשלום
            </p>
          </div>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, index) => (
              <Card key={index} className="border-2 transition-all hover:border-primary/50 hover:shadow-lg">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="rounded-lg bg-primary/10 p-3">
                      <feature.icon className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-1 text-end">
                      <h3 className="text-lg font-semibold text-foreground">{feature.title}</h3>
                      <p className="mt-2 text-sm text-neutral-600">{feature.description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Contact Form */}
        <section className="bg-primary/5 py-16">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-2xl">
              <div className="rounded-2xl bg-background p-8 shadow-lg ring-1 ring-border">
                <h2 className="text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                  הגישה למערכת על פי הזמנה
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-center text-lg text-neutral-600">
                  ריינקס עובדת כרגע עם קבוצה נבחרת של ארגונים. אם אתם מרכז, קליניקה או חוג המחפשים כלי ניהול מסודר — מלאו את הטופס ונחזור אליכם.
                </p>

                {formStatus === 'success' ? (
                  <div className="mt-8 rounded-xl border border-green-200 bg-green-50 p-6 text-center">
                    <p className="text-lg font-semibold text-green-800">תודה! נחזור אליכם בהקדם.</p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="mt-8 space-y-4" noValidate>
                    {/* Honeypot — hidden from humans, bots fill it in */}
                    <input
                      name="website"
                      type="text"
                      value={formData.website}
                      onChange={handleFormChange}
                      tabIndex={-1}
                      autoComplete="off"
                      aria-hidden="true"
                      className="absolute h-0 w-0 overflow-hidden opacity-0 pointer-events-none"
                    />

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="contact-name" className="mb-1 block text-sm font-medium text-foreground">
                          שם מלא *
                        </label>
                        <input
                          id="contact-name"
                          name="name"
                          type="text"
                          required
                          value={formData.name}
                          onChange={handleFormChange}
                          className={INPUT_CLASS}
                          placeholder="ישראל ישראלי"
                        />
                      </div>
                      <div>
                        <label htmlFor="contact-org" className="mb-1 block text-sm font-medium text-foreground">
                          ארגון / מרכז *
                        </label>
                        <input
                          id="contact-org"
                          name="orgName"
                          type="text"
                          required
                          value={formData.orgName}
                          onChange={handleFormChange}
                          className={INPUT_CLASS}
                          placeholder="מרכז רכיבה טיפולית"
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="contact-email" className="mb-1 block text-sm font-medium text-foreground">
                          אימייל *
                        </label>
                        <input
                          id="contact-email"
                          name="email"
                          type="email"
                          required
                          value={formData.email}
                          onChange={handleFormChange}
                          className={INPUT_CLASS}
                          placeholder="israel@example.com"
                          dir="ltr"
                        />
                      </div>
                      <div>
                        <label htmlFor="contact-phone" className="mb-1 block text-sm font-medium text-foreground">
                          טלפון
                        </label>
                        <input
                          id="contact-phone"
                          name="phone"
                          type="tel"
                          value={formData.phone}
                          onChange={handleFormChange}
                          className={INPUT_CLASS}
                          placeholder="050-0000000"
                          dir="ltr"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="contact-message" className="mb-1 block text-sm font-medium text-foreground">
                        הודעה קצרה
                      </label>
                      <textarea
                        id="contact-message"
                        name="message"
                        rows={3}
                        value={formData.message}
                        onChange={handleFormChange}
                        className={`${INPUT_CLASS} resize-none`}
                        placeholder="ספרו לנו קצת על הארגון שלכם..."
                      />
                    </div>

                    {formStatus === 'error' && (
                      <p className="text-sm text-destructive">{formError}</p>
                    )}

                    <Button
                      type="submit"
                      size="lg"
                      className="w-full gap-2 text-lg"
                      disabled={formStatus === 'submitting'}
                    >
                      {formStatus === 'submitting' ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin" />
                          <span>שולח...</span>
                        </>
                      ) : (
                        <span>שלחו בקשה</span>
                      )}
                    </Button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t bg-neutral-50 py-8">
          <div className="container mx-auto px-4 text-center sm:px-6 lg:px-8">
            <div className="flex items-center justify-center gap-2 text-neutral-600">
              <img src="/icon.svg" alt="ריינקס" className="h-6 w-6" />
              <span className="font-semibold">Reinex</span>
              <span className="text-neutral-400">•</span>
              <span className="text-sm">מערכת ניהול מפגשים</span>
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-6">
              <a href="#/legal/privacy" aria-label="מדיניות הפרטיות" className="text-sm text-neutral-600 underline hover:text-neutral-800">
                מדיניות פרטיות
              </a>
              <a href="#/legal/terms" aria-label="תנאי השימוש" className="text-sm text-neutral-600 underline hover:text-neutral-800">
                תנאי שימוש
              </a>
              <a href="#/legal/accessibility" aria-label="מדיניות נגישות" className="text-sm text-neutral-600 underline hover:text-neutral-800">
                מדיניות נגישות
              </a>
            </div>
            <p className="mt-4 text-sm text-neutral-500">
              © {new Date().getFullYear()} ריינקס. כל הזכויות שמורות.
            </p>
          </div>
        </footer>
      </div>
    </AccessibilityProvider>
  );
}
