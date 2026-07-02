import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Download, FileJson, Loader2, ShieldCheck, Upload } from 'lucide-react';
import { toast } from '@/lib/toast.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';

const REQUEST = {
  idle: 'idle',
  loading: 'loading',
  error: 'error',
};

function formatDateForFile(date = new Date()) {
  return date.toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function downloadJson(payload, orgId) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reinex-local-export-${orgId}-${formatDateForFile()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return blob.size;
}

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result || '{}')));
      } catch {
        reject(new Error('invalid_json'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('file_read_failed'));
    reader.readAsText(file, 'utf-8');
  });
}

function CountsTable({ counts }) {
  const entries = Object.entries(counts || {}).filter(([, count]) => Number(count) > 0);
  if (!entries.length) {
    return <p className="text-sm text-slate-500">לא נמצאו רשומות לייבוא בחלק זה.</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2 text-right font-medium">טבלה</th>
            <th className="px-3 py-2 text-right font-medium">כמות</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([tableName, count]) => (
            <tr key={tableName} className="border-t border-slate-100">
              <td className="px-3 py-2 font-mono text-xs text-slate-700">{tableName}</td>
              <td className="px-3 py-2 text-slate-900">{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LocalExportImportManager({ session, orgId }) {
  const [exportState, setExportState] = useState(REQUEST.idle);
  const [importState, setImportState] = useState(REQUEST.idle);
  const [analysis, setAnalysis] = useState(null);
  const [pendingExport, setPendingExport] = useState(null);
  const [applyResult, setApplyResult] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const fileInputRef = useRef(null);

  const canAct = useMemo(() => Boolean(session && orgId), [session, orgId]);

  const handleExport = useCallback(async () => {
    if (!canAct) return;
    setExportState(REQUEST.loading);
    try {
      const payload = await authenticatedFetch('local-export', {
        method: 'POST',
        body: { org_id: orgId },
      });
      const localExport = payload?.export;
      if (!localExport?.format || !localExport?.tables) {
        throw new Error('invalid_export_response');
      }
      const size = downloadJson(localExport, orgId);
      const sizeKb = Math.max(1, Math.round(size / 1024));
      const failedTables = Object.keys(payload?.table_errors || {});
      if (failedTables.length) {
        toast.warning(`הייצוא המקומי נוצר, אך ${failedTables.length} טבלאות לא נכללו בגלל שגיאה.`);
      } else {
        toast.success(`קובץ ייצוא מקומי נוצר (${sizeKb}KB).`);
      }
      setExportState(REQUEST.idle);
    } catch (error) {
      console.error('Local export failed', error);
      toast.error(error?.message || 'יצירת הייצוא המקומי נכשלה');
      setExportState(REQUEST.error);
    }
  }, [canAct, orgId]);

  const handleAnalyze = useCallback(async () => {
    if (!canAct) return;
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toast.error('יש לבחור קובץ JSON לניתוח.');
      return;
    }

    setImportState(REQUEST.loading);
    setAnalysis(null);
    setPendingExport(null);
    setApplyResult(null);
    setConfirmed(false);

    try {
      const parsed = await readJsonFile(file);
      const payload = await authenticatedFetch('local-import', {
        method: 'POST',
        body: {
          org_id: orgId,
          mode: 'analyze',
          export: parsed,
        },
      });
      setAnalysis(payload?.analysis || null);
      setPendingExport(parsed);
      setImportState(REQUEST.idle);
      toast.success('הקובץ נבדק. אפשר לעבור על הספירה לפני ייבוא.');
    } catch (error) {
      console.error('Local import analyze failed', error);
      const message = error?.message === 'invalid_json' ? 'קובץ ה-JSON אינו תקין.' : (error?.message || 'ניתוח הקובץ נכשל');
      toast.error(message);
      setImportState(REQUEST.error);
    }
  }, [canAct, orgId]);

  const handleApply = useCallback(async () => {
    if (!canAct || !pendingExport || !confirmed) return;
    setImportState(REQUEST.loading);
    setApplyResult(null);

    try {
      const payload = await authenticatedFetch('local-import', {
        method: 'POST',
        body: {
          org_id: orgId,
          mode: 'apply',
          confirm: true,
          export: pendingExport,
        },
      });
      setApplyResult(payload?.result || null);
      setImportState(REQUEST.idle);
      const failedTables = Object.keys(payload?.result?.errors || {});
      if (failedTables.length) {
        toast.warning(`הייבוא הסתיים חלקית. ${failedTables.length} טבלאות נכשלו.`);
      } else {
        toast.success('הייבוא המקומי הושלם ללא מחיקת נתונים קיימים.');
      }
    } catch (error) {
      console.error('Local import apply failed', error);
      toast.error(error?.message || 'הייבוא המקומי נכשל');
      setImportState(REQUEST.error);
    }
  }, [canAct, confirmed, orgId, pendingExport]);

  return (
    <Card className="w-full border-0 bg-white/80 shadow-lg">
      <CardHeader className="space-y-xs border-b border-slate-200">
        <CardTitle className="flex items-center gap-xs text-base font-semibold text-slate-900 sm:text-lg md:text-xl">
          <ShieldCheck className="h-5 w-5 text-slate-700" />
          ייצוא מקומי וייבוא מקומי
        </CardTitle>
        <p className="text-sm leading-relaxed text-slate-600">
          כלי עזר לשמירת עותק JSON מקומי של נתוני הארגון או לייבוא לא הרסני. זה אינו גיבוי מלא ואינו תהליך שחזור מאסון.
        </p>
      </CardHeader>

      <CardContent className="space-y-md">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" />
            מגבלות חשובות בגרסה הנוכחית
          </div>
          <ul className="list-inside list-disc space-y-1 leading-relaxed">
            <li>הייצוא המקומי אינו מחליף גיבוי תשתיתי, גיבוי ספק או תהליך שחזור מלא.</li>
            <li>קבצים/מסמכים בינאריים אינם כלולים בגרסה זו; נשמרת מטא-דאטה בלבד.</li>
            <li>ייבוא אינו מוחק נתונים קיימים ואינו מחזיר את המערכת למצב קודם.</li>
            <li>קובץ הייצוא עשוי להכיל מידע אישי ורגיש. יש לשמור אותו במקום מאובטח ולא להעבירו ללא הרשאה.</li>
          </ul>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">ייצוא מקומי</h3>
              <p className="mt-1 text-sm text-slate-600">
                יוצר קובץ JSON מסונן לארגון הנוכחי בלבד. הייצוא אינו כולל סודות מערכת או קבצים בינאריים.
              </p>
            </div>
            <Badge variant="outline" className="shrink-0 border-slate-300 text-slate-700">מנהל/בעלים</Badge>
          </div>
          <Button onClick={handleExport} disabled={!canAct || exportState === REQUEST.loading} className="gap-xs">
            {exportState === REQUEST.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            צור/י ייצוא מקומי
          </Button>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">ייבוא מקומי</h3>
              <p className="mt-1 text-sm text-slate-600">
                הייבוא מתבצע בשני שלבים: קודם בדיקה וספירה, ורק לאחר אישור מפורש הכנסת רשומות חדשות לארגון הנוכחי.
              </p>
            </div>
            <Badge variant="outline" className="shrink-0 border-slate-300 text-slate-700">בדיקה לפני ייבוא</Badge>
          </div>

          <div className="grid gap-sm sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label className="text-slate-700">קובץ ייצוא מקומי JSON</Label>
              <Input ref={fileInputRef} type="file" accept="application/json,.json" />
            </div>
            <Button onClick={handleAnalyze} disabled={!canAct || importState === REQUEST.loading} variant="outline" className="gap-xs">
              {importState === REQUEST.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson className="h-4 w-4" />}
              בדוק קובץ
            </Button>
          </div>

          {analysis ? (
            <div className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                <div>מקור הקובץ: <span className="font-mono text-xs">{analysis.source_org_id || 'לא ידוע'}</span></div>
                <div>ייבוא יעד: <span className="font-mono text-xs">{orgId}</span></div>
                <div>פורמט: <span className="font-mono text-xs">{analysis.format} v{analysis.version}</span></div>
                <div>תאריך ייצוא: {analysis.exported_at ? new Date(analysis.exported_at).toLocaleString('he-IL') : 'לא ידוע'}</div>
              </div>

              <div>
                <h4 className="mb-2 font-semibold text-slate-900">רשומות שייכנסו כחדשות</h4>
                <CountsTable counts={analysis.importable_counts} />
              </div>

              {Object.keys(analysis.export_only_counts || {}).length > 0 ? (
                <div>
                  <h4 className="mb-2 font-semibold text-slate-900">נכלל לעיון בלבד ולא ייובא</h4>
                  <CountsTable counts={analysis.export_only_counts} />
                </div>
              ) : null}

              <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                <div className="mb-2 font-semibold text-slate-900">מה לא קורה בייבוא</div>
                <ul className="list-inside list-disc space-y-1">
                  <li>לא נמחקות רשומות קיימות.</li>
                  <li>לא נעשה שימוש ב-org_id מתוך הקובץ.</li>
                  <li>לא מיובאים קבצים בינאריים של מסמכים.</li>
                  <li>לא נוצרות הרשאות משתמשים או הזמנות לארגון.</li>
                </ul>
              </div>

              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                <Checkbox checked={confirmed} onCheckedChange={(checked) => setConfirmed(Boolean(checked))} />
                <span>
                  אני מאשר/ת שהייבוא ייצור רשומות חדשות בארגון הנוכחי בלבד, ללא מחיקת נתונים קיימים, ושקובץ המקור נשמר וטופל באופן מאובטח.
                </span>
              </label>

              <Button onClick={handleApply} disabled={!confirmed || !pendingExport || importState === REQUEST.loading} className="gap-xs">
                {importState === REQUEST.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                אשר/י וייבא רשומות חדשות
              </Button>
            </div>
          ) : null}

          {applyResult ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <div className="mb-2 font-semibold">תוצאת ייבוא</div>
              <CountsTable counts={applyResult.inserted} />
              {Object.keys(applyResult.errors || {}).length > 0 ? (
                <pre className="mt-3 max-h-40 overflow-auto rounded bg-white p-3 text-xs text-red-700">
                  {JSON.stringify(applyResult.errors, null, 2)}
                </pre>
              ) : null}
            </div>
          ) : null}
        </section>
      </CardContent>
    </Card>
  );
}
