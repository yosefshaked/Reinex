import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Users, Calendar, BarChart3, Shield, Sparkles, CheckCircle2 } from 'lucide-react';
import { AccessibilityProvider } from '@/features/accessibility/AccessibilityProvider.jsx';
import AccessibilityButton from '@/features/accessibility/AccessibilityButton.jsx';

export default function LandingPage() {
  const navigate = useNavigate();

  const features = [
    {
      icon: Users,
      title: 'ניהול תלמידים',
      description: 'מעקב מלא אחר כל תלמיד ותלמידה, כולל פרטי קשר, מדריך מקצועי ותזמון המפגשים האישי',
    },
    {
      icon: Calendar,
      title: 'תיעוד מפגשים',
      description: 'רישום מהיר ונוח של מפגשי הדרכה עם טפסים מותאמים אישית לצרכים שלכם',
    },
    {
      icon: BarChart3,
      title: 'דוחות ותובנות - בשלבי פיתוח',
      description: 'ניתוח נתונים מתקדם, דוחות מפורטים ומעקב אחר התקדמות לאורך זמן',
    },
    {
      icon: Shield,
      title: 'אבטחה ופרטיות',
      description: 'הגנה מלאה על מידע רגיש עם הצפנה, גיבויים ובקרת גישה נוחה',
    },
    {
      icon: Sparkles,
      title: 'ממשק נוח וידידותי',
      description: 'עיצוב מודרני ואינטואיטיבי המותאם לעברית ולשימוש יומיומי',
    },
    {
      icon: CheckCircle2,
      title: 'פיתוח מתמשך',
      description: 'חסר לכם משהו במערכת? זה הזמן לשתף אותנו ולהשפיע על הכיוונים העתידיים',
    },
  ];

  const benefits = [
    'חיסכון משמעותי בזמן ניהול',
    'מעקב אחר כל מפגש והתקדמות',
    'עמידה בתנאים מקצועיים ורגולטוריים',
    'גישה מכל מקום ומכל מכשיר',
    'התאמה אישית לצרכי הארגון',
    'עדכונים ושיפורים רציפים',
  ];

  return (
    <AccessibilityProvider>
      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background" dir="rtl">
        {/* Accessibility Button */}
        <div className="fixed bottom-4 left-4 z-50">
          <AccessibilityButton />
        </div>

        {/* Header */}
        <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-2">
              <img src="/icon.svg" alt="TutTiud" className="h-8 w-8" />
              <span className="text-xl font-bold text-primary">TutTiud</span>
            </div>
            <Button onClick={() => navigate('/login')} className="gap-2">
              <span>כניסה למערכת</span>
            </Button>
          </div>
        </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl md:text-6xl">
            מערכת ניהול הדרכה
            <br />
            <span className="text-primary">חכמה ויעילה</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-neutral-600 sm:text-xl">
            TutTiud היא הפלטפורמה המתקדמת לניהול תלמידים, תיעוד מפגשים ומעקב אחר התקדמות.
            כל מה שצוות ההדרכה שלכם צריך, במקום אחד.
          </p>
          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:justify-center">
            <Button size="lg" onClick={() => navigate('/login')} className="gap-2 text-lg">
              <span>התחילו עכשיו</span>
            </Button>
            <Button size="lg" variant="outline" onClick={() => {
              document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
            }} className="text-lg">
              למידע נוסף
            </Button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="container mx-auto px-4 py-16 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            כל מה שצריך לניהול מוצלח
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-neutral-600">
            מערכת מקיפה עם כלים מתקדמים לכל היבט של המפגשים
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
                  <div className="flex-1 text-right">
                    <h3 className="text-lg font-semibold text-foreground">{feature.title}</h3>
                    <p className="mt-2 text-sm text-neutral-600">{feature.description}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Screenshots Section */}
      <section className="container mx-auto px-4 py-16 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            הצצה למערכת
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-neutral-600">
            המערכת שלנו נמצאת כרגע בשלבי בדיקות מוקדמים עם ארגונים נבחרים
          </p>
        </div>

        <div className="mt-12 space-y-16">
          {/* Dashboard Preview */}
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
            <div className="order-2 text-right lg:order-1">
              <h3 className="text-2xl font-bold text-foreground">לוח בקרה ראשי</h3>
              <p className="mt-4 text-lg text-neutral-600">
                נגישות נוחה לחלקיה המרכזיים של המערכת - מבט על התלמידים ותיעוד מפגש חדש.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-neutral-600">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                  <span>גישה מהירה לפונקציות הנפוצות ביותר</span>
                </li>
              </ul>
            </div>
            <div className="order-1 lg:order-2">
              <div className="overflow-hidden rounded-lg border-2 border-primary/20 bg-neutral-100 shadow-2xl">
                <div className="aspect-video flex items-center justify-center bg-gradient-to-br from-primary/5 to-primary/10">
                  <div className="text-center">
                    <BarChart3 className="mx-auto h-16 w-16 text-primary/40" />
                    <p className="mt-4 text-sm text-neutral-500">תמונת מסך: לוח הבקרה הראשי</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Student Management Preview */}
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
            <div className="order-2 text-right lg:order-2">
              <h3 className="text-2xl font-bold text-foreground">ניהול תלמידים מתקדם</h3>
              <p className="mt-4 text-lg text-neutral-600">
                ממשק ניהול תלמידים אינטואיטיבי עם חיפוש מהיר, סינון לפי מדריך או יום בשבוע,
                ותצוגה ברורה עם כל הפרטים החשובים.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-neutral-600">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                  <span>חיפוש וסינון מתקדמים לאיתור מהיר</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                  <span>עריכה והוספה פשוטה של תלמידים חדשים</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                  <span>שיוך מדריכים ולוחות זמנים מותאמים אישית</span>
                </li>
              </ul>
            </div>
            <div className="order-1 lg:order-1">
              <div className="overflow-hidden rounded-lg border-2 border-primary/20 bg-neutral-100 shadow-2xl">
                <div className="aspect-video flex items-center justify-center bg-gradient-to-br from-primary/5 to-primary/10">
                  <div className="text-center">
                    <Users className="mx-auto h-16 w-16 text-primary/40" />
                    <p className="mt-4 text-sm text-neutral-500">תמונת מסך: ניהול תלמידים</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Session Recording Preview */}
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
            <div className="order-2 text-right lg:order-1">
              <h3 className="text-2xl font-bold text-foreground">תיעוד מפגשים מהיר ונוח</h3>
              <p className="mt-4 text-lg text-neutral-600">
                תיעוד מפגש בכמה קליקים - בחירת תלמיד, מילוי שאלות מותאמות אישית, ושמירה מיידית.
                כל המידע במקום אחד ונגיש.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-neutral-600">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                  <span>טפסים מותאמים אישית לפי צרכי הארגון</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                  <span>שאלות מגוונות: טקסט חופשי, בחירה מרובה, דירוג ועוד</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                  <span>הכינו תשובות מוכנות מראש לחיסכון בזמן</span>
                </li>
              </ul>
            </div>
            <div className="order-1 lg:order-2">
              <div className="overflow-hidden rounded-lg border-2 border-primary/20 bg-neutral-100 shadow-2xl">
                <div className="aspect-video flex items-center justify-center bg-gradient-to-br from-primary/5 to-primary/10">
                  <div className="text-center">
                    <Calendar className="mx-auto h-16 w-16 text-primary/40" />
                    <p className="mt-4 text-sm text-neutral-500">תמונת מסך: רישום מפגש חדש</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Beta Notice */}
        <div className="mt-16 rounded-lg border border-primary/30 bg-primary/5 p-6 text-center">
          <Shield className="mx-auto h-12 w-12 text-primary" />
          <h3 className="mt-4 text-xl font-bold text-foreground">בדיקות מוקדמות בסביבה אמיתית</h3>
          <p className="mx-auto mt-2 max-w-2xl text-neutral-600">
            המערכת שלנו נמצאת כעת בשלבי פיילוט עם ארגונים נבחרים. אנחנו אוספים משוב, משפרים ומוסיפים תכונות חדשות באופן שוטף.
            תמונות המסך הן הדמיות - הממשק האמיתי זמין עם כניסה למערכת.
          </p>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="bg-primary/5 py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              למה לבחור ב-TutTiud?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-neutral-600">
              הצטרפו לארגונים שכבר משתמשים במערכת שלנו
            </p>
          </div>

          <div className="mx-auto mt-12 max-w-3xl">
            <div className="grid gap-4 sm:grid-cols-2">
              {benefits.map((benefit, index) => (
                <div key={index} className="flex items-center gap-3 rounded-lg bg-background p-4 shadow-sm">
                  <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-primary" />
                  <span className="text-sm font-medium text-foreground">{benefit}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="rounded-2xl bg-primary px-6 py-16 text-center shadow-xl sm:px-12">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            מוכנים להתחיל?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-primary-foreground/90">
            הצטרפו למערכת עוד היום והתחילו לנהל את ההדרכה שלכם בצורה החכמה ביותר
          </p>
          <div className="mt-8">
            <Button
              size="lg"
              variant="secondary"
              onClick={() => navigate('/login')}
              className="gap-2 text-lg shadow-lg hover:shadow-xl"
            >
              <span>כניסה למערכת</span>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-neutral-50 py-8">
        <div className="container mx-auto px-4 text-center sm:px-6 lg:px-8">
          <div className="flex items-center justify-center gap-2 text-neutral-600">
            <img src="/icon.svg" alt="TutTiud" className="h-6 w-6" />
            <span className="font-semibold">TutTiud</span>
            <span className="text-neutral-400">•</span>
            <span className="text-sm">מערכת ניהול מפגשים מתקדמת</span>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-6">
            <a href="https://thepcrunners.com/he/privacy-policy" aria-label='מדיניות הפרטיות' className="text-sm text-neutral-600 underline hover:text-neutral-800">
              מדיניות פרטיות
            </a>
            <a href="https://thepcrunners.com/he/usage-policy" aria-label='תנאי השימוש' className="text-sm text-neutral-600 underline hover:text-neutral-800">
              תנאי שימוש
            </a>
            <a href="https://thepcrunners.com/he/accessibility-policy" aria-label='מדיניות נגישות' className="text-sm text-neutral-600 underline hover:text-neutral-800">
              מדיניות נגישות
            </a>
          </div>
          <p className="mt-4 text-sm text-neutral-500">
            © {new Date().getFullYear()} TutTiud ThePCRunners. כל הזכויות שמורות.
          </p>
        </div>
      </footer>
      </div>
    </AccessibilityProvider>
  );
}
