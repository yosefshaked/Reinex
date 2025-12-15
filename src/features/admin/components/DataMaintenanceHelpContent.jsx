import { useState } from 'react';
import { Info, Download, Upload, AlertTriangle, Filter, FileText, CheckCircle, XCircle, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

export function DataMaintenanceHelpContent() {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Quick Start */}
      <Card className="bg-primary/5 border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Zap className="h-5 w-5 text-primary" />
            התחלה מהירה
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-right">
          <ol className="list-decimal list-inside space-y-1.5 text-sm pr-4">
            <li><strong>ייצאו</strong> - בחרו "ייצוא כל התלמידים" או סינון מסוים</li>
            <li><strong>ערכו באקסל</strong> - פתחו הקובץ ושנו מה שצריך (אל תגעו בעמודת UUID)</li>
            <li><strong>שמרו כ-CSV</strong> - File → Save As → CSV (UTF-8)</li>
            <li><strong>ייבאו</strong> - בחרו "ייבוא עדכונים" והעלו את הקובץ</li>
            <li><strong>אשרו שינויים</strong> - בדקו את התצוגה המקדימה, בטלו שינויים לא רצויים, ואשרו</li>
          </ol>
          <p className="text-xs text-green-600 font-medium mt-3 pr-4">
            ✅ תצוגה מקדימה - רואים בדיוק מה משתנה לפני האישור. בטוחים ושקופים!
          </p>
        </CardContent>
      </Card>

      {/* Export Options Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Download className="h-5 w-5 text-primary" />
            אפשרויות ייצוא
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-right text-sm">
          <div className="flex items-start gap-2">
            <FileText className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div>
              <strong>ייצוא כל התלמידים</strong> - לעדכונים רחבים
            </div>
          </div>
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <strong>תלמידים עם בעיות</strong> - חסר מזהה, מדריך לא פעיל, או התנגשויות בלוח זמנים
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Filter className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
            <div>
              <strong>ייצוא מסונן</strong> - לפי מדריך, יום, או תגית
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            💡 הקובץ כולל עמודת "סיבת ייצוא" (חוץ מ"ייצוא הכל") המסבירה למה כל תלמיד נכלל
          </p>
        </CardContent>
      </Card>

      {/* Excel Tips - Most Important */}
      <Card className="bg-blue-50 border-blue-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-blue-900">
            <FileText className="h-5 w-5" />
            טיפים חשובים לאקסל
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-right">
          <ul className="list-disc list-inside space-y-1.5 text-sm pr-4 text-blue-900">
            <li>
              <strong className="text-green-700">תאים ריקים = ללא שינוי!</strong>
              {' '}אם אתם לא רוצים לעדכן שדה מסוים, פשוט תשאירו את התא ריק.
              {' '}רק שדות עם ערכים חדשים יעודכנו.
            </li>
            <li>
              <strong className="text-amber-700">למחוק שדה אופציונלי?</strong>
              {' '}הקלידו <code className="bg-white px-1 rounded font-bold">CLEAR</code> או <code className="bg-white px-1 rounded font-bold">-</code> כדי למחוק את הערך (עובד בהערות, שירות ברירת מחדל, שם איש קשר).
            </li>
            <li>
              <strong className="text-green-700">מספרי טלפון מתוקנים אוטומטית!</strong>
              {' '}אפשר למחוק את הנוסחה {' '}<code className="bg-white px-1 rounded">="0546341150"</code> ולהקליד את המספר רגיל.
              עם 0 או בלי 0 - המערכת מוסיפה אותו אוטומטית (546341150 → 0546341150).
            </li>
            <li><strong>אל תשנו את עמודת UUID</strong> - זה המזהה שמחבר לתלמיד במערכת</li>
            <li><strong className="text-red-700">אל תשנו שמות עמודות!</strong> המערכת מזהה עמודות בשמות קבועים (עברית או אנגלית). שינוי שם עמודה יגרום לשגיאה.</li>
            <li><strong>שמרו תמיד כ-CSV</strong>, לא XLSX! File → Save As → CSV (UTF-8)</li>
            <li><strong>שמות מדריכים עובדים</strong> - לא צריך UUID, פשוט שם המדריך. <span className="text-amber-700">מדריכים לא פעילים יידחו.</span></li>
            <li><strong>ימים בשבוע:</strong> השתמשו בשמות העבריים (ראשון, שני, שלישי וכו')</li>
            <li><strong>סטטוס פעיל:</strong> השתמשו ב"כן" או "לא" (לא TRUE/FALSE)</li>
          </ul>
        </CardContent>
      </Card>

      {/* Preview Benefits */}
      <Card className="border-green-200 bg-green-50/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-green-900">
            <CheckCircle className="h-5 w-5" />
            תצוגה מקדימה חכמה
          </CardTitle>
        </CardHeader>
        <CardContent className="text-right">
          <ul className="list-disc list-inside space-y-1 text-sm pr-4 text-green-900">
            <li><strong>רואים הכל לפני השינוי</strong> - ערך נוכחי מול ערך חדש לכל שדה</li>
            <li><strong>בחירה סלקטיבית</strong> - תוכלו לבטל שינויים בודדים או תלמידים ספציפיים</li>
            <li><strong>הרחבה/כיווץ</strong> - לחצו על כל תלמיד לראות פירוט מלא של השינויים</li>
            <li><strong>תרגום חכם</strong> - שמות מדריכים, ימים בשבוע, וסטטוסים מוצגים בעברית</li>
            <li><strong>בטל לפני אישור</strong> - כל התלמידים נבחרים כברירת מחדל, אבל אפשר לבטל סימון בנפרד</li>
          </ul>
        </CardContent>
      </Card>

      {/* Restrictions */}
      <Card className="border-amber-200 bg-amber-50/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-amber-900">
            <XCircle className="h-5 w-5" />
            מגבלות חשובות
          </CardTitle>
        </CardHeader>
        <CardContent className="text-right">
          <ul className="list-disc list-inside space-y-1 text-sm pr-4 text-amber-900">
            <li><strong>מקסימום 2000 שורות</strong> בייבוא אחד</li>
            <li><strong>מספרי זהות ייחודיים</strong> - כפילויות נחסמות</li>
            <li><strong>מדריכים לא פעילים</strong> - לא ניתן לשבץ מדריך שהושבת במערכת</li>
            <li><strong>רק קובצי CSV</strong> - קובצי XLSX לא נתמכים, שמרו כ-CSV בלבד</li>
          </ul>
        </CardContent>
      </Card>

      {/* Advanced Details - Collapsible */}
      <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
        <Card className="border-muted">
          <CollapsibleTrigger className="w-full">
            <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <Info className="h-5 w-5 text-muted-foreground" />
                  פרטים נוספים ורקע
                </span>
                <span className="text-xs text-muted-foreground">
                  {showAdvanced ? '▲ הסתר' : '▼ הצג'}
                </span>
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4 text-right pt-0">
              <div>
                <p className="font-semibold text-sm mb-1">למה נוצרה התכונה?</p>
                <p className="text-sm text-muted-foreground">
                  מנהלים דיווחו שעדכון מדריכים, תגיות, וימי מפגש לעשרות תלמידים דרש פתיחת כל פרופיל בנפרד. 
                  אימות נתונים (מזהים, טלפונים) וזיהוי בעיות (מדריכים לא פעילים, התנגשויות) היה ידני וקשה.
                </p>
              </div>
              <div>
                <p className="font-semibold text-sm mb-1">תלמידים עם בעיות - מה מזוהה?</p>
                <ul className="list-disc list-inside space-y-0.5 text-sm pr-4 text-muted-foreground">
                  <li>חסר מספר תעודת זהות</li>
                  <li>חסר מדריך משובץ או מדריך לא פעיל</li>
                  <li>התנגשות בלוח זמנים (2+ תלמידים פעילים, אותו מדריך/יום/שעה)</li>
                </ul>
                <p className="text-xs text-muted-foreground mt-1">
                  💡 תלמידים לא פעילים לא נספרים כהתנגשות. התנגשויות עשויות להיות מכוונות (קבוצות).
                </p>
              </div>
              <div>
                <p className="font-semibold text-sm mb-1">תכונות ייבוא מתקדמות</p>
                <ul className="list-disc list-inside space-y-0.5 text-sm pr-4 text-muted-foreground">
                  <li><strong>תצוגה מקדימה אינטראקטיבית:</strong> רואים כל שינוי לפני שהוא קורה - ערך ישן (אדום) לעומת ערך חדש (ירוק)</li>
                  <li><strong>בחירה סלקטיבית:</strong> אפשר לבטל שינויים לתלמידים ספציפיים, רק מה שנבחר יעודכן</li>
                  <li>המערכת מזהה רק שדות ששונו ומעדכנת אותם בלבד</li>
                  <li><strong>תאים ריקים נשארים ללא שינוי</strong> - רק תאים עם ערכים חדשים מתעדכנים</li>
                  <li><strong>שדות אופציונליים:</strong> הקלידו <code className="bg-muted px-1 rounded text-xs">CLEAR</code> או <code className="bg-muted px-1 rounded text-xs">-</code> כדי למחוק הערות, שירות, או שם איש קשר</li>
                  <li>תמיכה מלאה בעברית (UTF-8)</li>
                  <li>הודעות שגיאה בעברית עם מספרי שורות מדויקים</li>
                  <li>עמודת "סיבת ייצוא" מתעלמת בייבוא (לא משפיעה)</li>
                </ul>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
