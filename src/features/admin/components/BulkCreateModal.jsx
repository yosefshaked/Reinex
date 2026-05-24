import React, { useState, useEffect } from 'react';
import { Upload, CheckCircle2, XCircle, Loader2, AlertTriangle, UserPlus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { authenticatedFetch } from '@/lib/api-client.js';

const TEMPLATE_CSV = `שם פרטי,שם משפחה,שם אמצעי (רשות),מספר זהות,טלפון,אימייל (רשות),הערות (רשות),תגיות (רשות),פעיל (רשות),שם פרטי אפוטרופוס,שם משפחה אפוטרופוס (רשות),טלפון אפוטרופוס,קשר לתלמיד
# ישראל (דוגמא - לא יהיה כלול ביצירה),ישראלי,,123456789,0501234567,,,,כן,,,
# רחל (דוגמא - לא יהיה כלול ביצירה),כהן,,987654321,,,,,כן,שרה,כהן,0527654321,אמא`;

const RELATIONSHIP_LABELS = {
  father: 'אבא',
  mother: 'אמא',
  self: 'עצמי',
  caretaker: 'מטפל/ת',
  other: 'אחר',
};

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('failed_to_read_file'));
    reader.readAsText(file, 'UTF-8');
  });
}

// Single conflict card shown in preview step
function GuardianConflictCard({ conflict, resolution, onChoose }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="text-sm">
          <p className="font-medium text-amber-800">
            התנגשות שם אפוטרופוס — שורה {conflict.line_number} ({conflict.student_name})
          </p>
          <p className="text-amber-700 text-xs mt-0.5">
            טלפון <span className="font-mono">{conflict.guardian_phone}</span> כבר רשום במערכת בשם אחר
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 ps-6">
        <button
          type="button"
          onClick={() => onChoose(conflict.line_number, 'use_existing')}
          className={`rounded border p-2 text-sm text-right transition-colors ${
            resolution === 'use_existing'
              ? 'border-blue-500 bg-blue-100 font-medium text-blue-900'
              : 'border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700'
          }`}
        >
          <p className="text-xs text-neutral-500 mb-0.5">השאר שם קיים:</p>
          <p className="font-medium">{conflict.existing_guardian_name}</p>
        </button>

        <button
          type="button"
          onClick={() => onChoose(conflict.line_number, 'use_csv')}
          className={`rounded border p-2 text-sm text-right transition-colors ${
            resolution === 'use_csv'
              ? 'border-green-500 bg-green-100 font-medium text-green-900'
              : 'border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700'
          }`}
        >
          <p className="text-xs text-neutral-500 mb-0.5">עדכן לשם מהקובץ:</p>
          <p className="font-medium">{conflict.csv_guardian_name}</p>
        </button>
      </div>
    </div>
  );
}

export default function BulkCreateModal({ open, onClose, orgId, onRefresh }) {
  const [step, setStep] = useState('upload'); // 'upload' | 'preview' | 'done'
  const [csvText, setCsvText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [error, setError] = useState('');
  // Map of line_number → 'use_existing' | 'use_csv'
  const [guardianResolutions, setGuardianResolutions] = useState({});

  useEffect(() => {
    if (!open) {
      setStep('upload');
      setCsvText('');
      setSelectedFile(null);
      setIsLoading(false);
      setPreviewData(null);
      setError('');
      setGuardianResolutions({});
    }
  }, [open]);

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setError('');
    try {
      const text = await readFileAsText(file);
      setCsvText(text);
    } catch {
      setError('שגיאה בקריאת הקובץ. וודא שמדובר בקובץ CSV.');
    }
  }

  async function handlePreview() {
    if (!csvText) {
      setError('נא לבחור קובץ CSV.');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const result = await authenticatedFetch('students-bulk-create', {
        method: 'POST',
        body: { org_id: orgId, csv_text: csvText, dry_run: true },
      });
      setPreviewData(result);
      setGuardianResolutions({});
      setStep('preview');
    } catch (err) {
      const msg = err?.response?.message || err?.message || 'שגיאה בעיבוד הקובץ';
      const hint = err?.response?.hint ? ` — ${err.response.hint}` : '';
      setError(`${msg}${hint}`);
    } finally {
      setIsLoading(false);
    }
  }

  function handleChooseResolution(lineNumber, choice) {
    setGuardianResolutions((prev) => ({ ...prev, [lineNumber]: choice }));
  }

  const conflicts = previewData?.guardian_name_conflicts || [];
  const unresolvedCount = conflicts.filter((c) => !guardianResolutions[c.line_number]).length;
  const canConfirm = (previewData?.will_create_count ?? 0) > 0 && unresolvedCount === 0;

  async function handleConfirm() {
    setIsLoading(true);
    setError('');
    try {
      const resolutions = Object.entries(guardianResolutions).map(([lineNumber, choice]) => ({
        line_number: Number(lineNumber),
        choice,
      }));
      const result = await authenticatedFetch('students-bulk-create', {
        method: 'POST',
        body: {
          org_id: orgId,
          csv_text: csvText,
          dry_run: false,
          guardian_name_resolutions: resolutions,
        },
      });
      setPreviewData(result);
      setStep('done');
      if (result.created_count > 0) {
        onRefresh?.();
      }
    } catch (err) {
      const msg = err?.response?.message || err?.message || 'שגיאה בייבוא';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }

  function downloadTemplate() {
    const blob = new Blob(['\uFEFF' + TEMPLATE_CSV], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'תלמידים-חדשים-תבנית.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  const willCreate = previewData?.will_create_count ?? previewData?.created_count ?? 0;
  const failedCount = previewData?.failed_count ?? 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-green-600" />
            ייבוא תלמידים חדשים מ-CSV
          </DialogTitle>
        </DialogHeader>

        {/* STEP: UPLOAD */}
        {step === 'upload' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm space-y-3">
              <div>
                <p className="font-medium text-neutral-700 mb-1">עמודות חובה</p>
                <div className="flex flex-wrap gap-1.5">
                  {['שם פרטי', 'שם משפחה', 'מספר זהות'].map((col) => (
                    <span key={col} className="rounded bg-red-100 text-red-700 px-2 py-0.5 text-xs font-medium">{col}</span>
                  ))}
                  <span className="rounded bg-red-100 text-red-700 px-2 py-0.5 text-xs font-medium">טלפון <span className="font-normal opacity-70">(או אפוטרופוס)</span></span>
                </div>
              </div>
              <div>
                <p className="font-medium text-neutral-700 mb-1">עמודות אפוטרופוס (חובה יחד אם כוללים, שם משפחה אפוטרופוס רשות)</p>
                <div className="flex flex-wrap gap-1.5">
                  {['שם פרטי אפוטרופוס', 'טלפון אפוטרופוס', 'קשר לתלמיד'].map((col) => (
                    <span key={col} className="rounded bg-blue-100 text-blue-700 px-2 py-0.5 text-xs font-medium">{col}</span>
                  ))}
                  <span className="rounded bg-neutral-200 text-neutral-600 px-2 py-0.5 text-xs">שם משפחה אפוטרופוס</span>
                </div>
                <p className="text-xs text-neutral-500 mt-1">
                  ערכי קשר לתלמיד: אבא, אמא, מטפל, מטפלת, עצמי, אחר
                </p>
              </div>
              <div>
                <p className="font-medium text-neutral-700 mb-1">עמודות רשות</p>
                <div className="flex flex-wrap gap-1.5">
                  {['שם אמצעי', 'אימייל', 'הערות', 'תגיות', 'פעיל'].map((col) => (
                    <span key={col} className="rounded bg-neutral-200 text-neutral-600 px-2 py-0.5 text-xs">{col}</span>
                  ))}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-2 mt-1">
                <Upload className="h-4 w-4" />
                הורד תבנית CSV
              </Button>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-neutral-700" htmlFor="bulk-create-file">
                בחר קובץ CSV
              </label>
              <input
                id="bulk-create-file"
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="block w-full text-sm text-neutral-700 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-neutral-100 file:text-neutral-700 hover:file:bg-neutral-200 cursor-pointer"
              />
              {selectedFile && (
                <p className="text-xs text-neutral-500">{selectedFile.name} — {(selectedFile.size / 1024).toFixed(1)} KB</p>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-between gap-2 pt-2">
              <Button variant="outline" onClick={onClose} disabled={isLoading}>ביטול</Button>
              <Button onClick={handlePreview} disabled={!csvText || isLoading} className="gap-2">
                {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                בדוק קובץ ותצוגה מקדימה
              </Button>
            </div>
          </div>
        )}

        {/* STEP: PREVIEW */}
        {step === 'preview' && previewData && (
          <div className="space-y-4">
            {/* Summary counters */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-center">
                <p className="text-2xl font-bold text-green-700">{willCreate}</p>
                <p className="text-xs text-green-600 mt-1">תלמידים ייווצרו</p>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center">
                <p className="text-2xl font-bold text-red-700">{failedCount}</p>
                <p className="text-xs text-red-600 mt-1">שגיאות</p>
              </div>
            </div>

            {/* Guardian name conflicts */}
            {conflicts.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-amber-800 flex items-center gap-1.5">
                  <Users className="h-4 w-4" />
                  התנגשויות שמות אפוטרופוס — נדרשת בחירה ({conflicts.length})
                </p>
                {conflicts.map((conflict) => (
                  <GuardianConflictCard
                    key={conflict.line_number}
                    conflict={conflict}
                    resolution={guardianResolutions[conflict.line_number]}
                    onChoose={handleChooseResolution}
                  />
                ))}
                {unresolvedCount > 0 && (
                  <p className="text-xs text-amber-700 font-medium">
                    נותרו {unresolvedCount} התנגשויות שלא נפתרו — יש לבחור לפני האישור
                  </p>
                )}
              </div>
            )}

            {/* Preview table */}
            {willCreate > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-neutral-200">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-right font-medium text-neutral-600">שם</th>
                      <th className="px-3 py-2 text-right font-medium text-neutral-600">מספר זהות</th>
                      <th className="px-3 py-2 text-right font-medium text-neutral-600">אפוטרופוס</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(previewData.previews || []).map((row, i) => (
                      <tr key={i} className="border-t border-neutral-100">
                        <td className="px-3 py-2">{row.name}</td>
                        <td className="px-3 py-2 font-mono text-xs">{row.identity_number}</td>
                        <td className="px-3 py-2 text-xs text-neutral-600">
                          {row.guardian_first_name
                            ? `${[row.guardian_first_name, row.guardian_last_name].filter(Boolean).join(' ')} (${RELATIONSHIP_LABELS[row.guardian_relationship] || row.guardian_relationship})`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Row errors */}
            {failedCount > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-3 space-y-1">
                <p className="text-sm font-medium text-red-700 mb-2">שגיאות ({failedCount}):</p>
                {(previewData.failed || []).map((f, i) => (
                  <div key={i} className="text-xs text-red-700 flex gap-2">
                    <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>שורה {f.line_number}: {f.name} — {f.message}</span>
                  </div>
                ))}
              </div>
            )}

            {willCreate === 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                אין תלמידים שניתן לייצר. בדוק את השגיאות ותקן את הקובץ.
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-between gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep('upload')} disabled={isLoading}>חזור</Button>
              <Button
                onClick={handleConfirm}
                disabled={!canConfirm || isLoading}
                className="gap-2 bg-green-600 hover:bg-green-700"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                צור {willCreate} תלמידים
                {unresolvedCount > 0 && ` (${unresolvedCount} התנגשויות פתוחות)`}
              </Button>
            </div>
          </div>
        )}

        {/* STEP: DONE */}
        {step === 'done' && previewData && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="text-lg font-medium text-neutral-800">
                {previewData.created_count > 0
                  ? `נוצרו ${previewData.created_count} תלמידים בהצלחה!`
                  : 'הייבוא הסתיים'}
              </p>
            </div>

            {(previewData.failed_count ?? 0) > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-3 space-y-1">
                <p className="text-sm font-medium text-red-700 mb-2">שגיאות שנדחו ({previewData.failed_count}):</p>
                {(previewData.failed || []).map((f, i) => (
                  <div key={i} className="text-xs text-red-700 flex gap-2">
                    <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>שורה {f.line_number}: {f.name} — {f.message}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={onClose}>סגור</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
