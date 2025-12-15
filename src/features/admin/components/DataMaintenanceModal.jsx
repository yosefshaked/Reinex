import React, { useEffect, useMemo, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import { Download, FileWarning, UploadCloud, HelpCircle, ArrowRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { authenticatedFetch, authenticatedFetchBlob } from '@/lib/api-client.js';
import { useInstructors } from '@/hooks/useOrgData.js';
import DataMaintenancePreview from './DataMaintenancePreview.jsx';
import { DataMaintenanceHelpContent } from './DataMaintenanceHelpContent.jsx';

function buildErrorLabel(entry) {
  const lineLabel = entry.line_number ? `שורה ${entry.line_number}: ` : '';
  if (entry.name) {
    return `${lineLabel}${entry.name}`;
  }
  if (entry.student_id) {
    return `${lineLabel}${entry.student_id}`;
  }
  return lineLabel || 'שורה לא מזוהה';
}

export default function DataMaintenanceModal({ open, onClose, orgId, onRefresh }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [summary, setSummary] = useState(null);
  const [unmatchedTags, setUnmatchedTags] = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [tagMappings, setTagMappings] = useState({});
  const [csvText, setCsvText] = useState('');
  
  // Preview state
  const [previewData, setPreviewData] = useState(null);
  const [isApplying, setIsApplying] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const { instructors } = useInstructors({
    enabled: open && Boolean(orgId),
    orgId,
  });

  useEffect(() => {
    if (!open) {
      setIsDownloading(false);
      setIsImporting(false);
      setImportError('');
      setSelectedFile(null);
      setSummary(null);
      setUnmatchedTags([]);
      setAvailableTags([]);
      setTagMappings({});
      setCsvText('');
      setPreviewData(null);
      setIsApplying(false);
      setShowHelp(false);
    }
  }, [open]);

  const failureEntries = useMemo(() => {
    return Array.isArray(summary?.failed) ? summary.failed : [];
  }, [summary]);

  const handleDownload = async () => {
    if (!orgId) return;
    setIsDownloading(true);
    try {
      const blob = await authenticatedFetchBlob(`students-maintenance-export?org_id=${orgId}`);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'student-data-maintenance.csv';
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success('הקובץ ירד בהצלחה.');
    } catch (error) {
      console.error('Failed to download maintenance CSV', error);
      toast.error('הורדת הקובץ נכשלה.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleFileChange = (event) => {
    const file = event?.target?.files?.[0] || null;
    setSelectedFile(file);
  };

  const handleTagMapping = (unmatchedTagName, targetTagId) => {
    setTagMappings(prev => ({
      ...prev,
      [unmatchedTagName]: targetTagId,
    }));
  };

  const handleRetryImportWithMappings = (event) => {
    event.preventDefault();
    
    // Check if all unmatched tags are mapped
    const unmapped = unmatchedTags.filter(tag => !tagMappings[tag]);
    if (unmapped.length > 0) {
      toast.error('נא למפות את כל התוויות שלא נמצאו.');
      return;
    }

    // Create a fake event object for handleImport
    const fakeEvent = { preventDefault: () => {} };
    handleImport(fakeEvent, tagMappings);
  };

  const handleCancelTagMapping = () => {
    setUnmatchedTags([]);
    setAvailableTags([]);
    setTagMappings({});
  };

  const handleImport = async (event, retryMappings = null) => {
    event.preventDefault();
    if (!orgId || !selectedFile) {
      setImportError('נא לבחור קובץ CSV לעדכון.');
      return;
    }

    setIsImporting(true);
    setImportError('');

    try {
      const text = await selectedFile.text();
      setCsvText(text); // Store for later use when confirming
      
      const payload = await authenticatedFetch('students-maintenance-import', {
        method: 'POST',
        body: {
          org_id: orgId,
          csv_text: text,
          tag_mappings: retryMappings,
          dry_run: true, // Request preview first
        },
      });

      // If unmatched tags, show mapping dialog
      if (payload.code === 'unmatched_tags') {
        setUnmatchedTags(payload.unmatched_tags || []);
        setAvailableTags(payload.available_tags || []);
        setTagMappings({});
        return;
      }

      // If unrecognized columns, show detailed error
      if (payload.code === 'unrecognized_columns') {
        const errorMsg = `${payload.message}. ${payload.hint || ''}`;
        setImportError(errorMsg);
        toast.error(errorMsg, { duration: 8000 }); // Longer duration for detailed error
        return;
      }

      // Show preview
      if (payload.dry_run) {
        setPreviewData(payload);
        return;
      }

      // This shouldn't happen with dry_run: true, but handle it just in case
      setSummary(payload);
      toast.success('ייבוא העדכונים הושלם.');
      if (typeof onRefresh === 'function') {
        onRefresh();
      }
    } catch (error) {
      console.error('Failed to import maintenance CSV', error);
      setImportError(error?.message || 'ייבוא הקובץ נכשל.');
      toast.error(error?.message || 'ייבוא הקובץ נכשל.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleConfirmChanges = async (excludedIds) => {
    if (!orgId || !csvText) {
      toast.error('נתונים חסרים לביצוע העדכון.');
      return;
    }

    setIsApplying(true);
    setImportError('');

    try {
      const payload = await authenticatedFetch('students-maintenance-import', {
        method: 'POST',
        body: {
          org_id: orgId,
          csv_text: csvText,
          tag_mappings: tagMappings,
          dry_run: false, // Actually apply changes
          excluded_ids: excludedIds, // IDs user deselected
        },
      });

      // Handle unrecognized columns error (shouldn't happen in apply phase, but be safe)
      if (payload.code === 'unrecognized_columns') {
        const errorMsg = `${payload.message}. ${payload.hint || ''}`;
        setImportError(errorMsg);
        toast.error(errorMsg, { duration: 8000 });
        return;
      }

      setSummary(payload);
      setPreviewData(null); // Clear preview
      toast.success('ייבוא העדכונים הושלם.');
      if (typeof onRefresh === 'function') {
        onRefresh();
      }
    } catch (error) {
      console.error('Failed to apply maintenance CSV changes', error);
      setImportError(error?.message || 'ייבוא הקובץ נכשל.');
      toast.error(error?.message || 'ייבוא הקובץ נכשל.');
    } finally {
      setIsApplying(false);
    }
  };

  const handleCancelPreview = () => {
    setPreviewData(null);
    setCsvText('');
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose?.(); }}>
      <DialogContent className="sm:max-w-2xl" hideDefaultClose={showHelp}>
        <DialogHeader>
          <DialogTitle>
            {showHelp 
              ? 'מדריך תחזוקת נתונים'
              : unmatchedTags.length > 0 
              ? 'מיפוי תוויות' 
              : previewData 
              ? 'תצוגה מקדימה - אשר שינויים'
              : 'תחזוקת נתונים (CSV)'}
          </DialogTitle>
          {showHelp ? (
            <DialogPrimitive.Close
              className="absolute left-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">סגור</span>
            </DialogPrimitive.Close>
          ) : null}
        </DialogHeader>

        {showHelp ? (
          // Help content view
          <>
            <DataMaintenanceHelpContent />
            <div className="flex justify-end pt-2">
              <Button onClick={() => setShowHelp(false)} variant="outline" className="gap-2">
                <ArrowRight className="h-4 w-4" />
                חזור לייבוא
              </Button>
            </div>
          </>
        ) : previewData ? (
          // Preview mode
          <DataMaintenancePreview
            previews={previewData.previews || []}
            failures={previewData.failed || []}
            instructors={instructors}
            onConfirm={handleConfirmChanges}
            onCancel={handleCancelPreview}
            isApplying={isApplying}
          />
        ) : unmatchedTags.length > 0 ? (
          // Tag Mapping UI
          <div className="space-y-4 text-sm text-neutral-700 text-right" dir="rtl">
            <p className="text-neutral-600">
              התוויות הבאות בקובץ CSV לא נמצאו בקטלוג. אנא מפו אותן לתוויות קיימות:
            </p>

            <div className="space-y-3 max-h-96 overflow-y-auto">
              {unmatchedTags.map((unmatchedTag) => (
                <div key={unmatchedTag} className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="font-semibold text-neutral-900">תווית לא מצאה:</p>
                      <p className="text-neutral-700 break-words">{unmatchedTag}</p>
                    </div>
                  </div>
                  
                  <div className="space-y-1">
                    <p className="text-sm text-neutral-600">בחרו תווית קיימת:</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {availableTags.map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => handleTagMapping(unmatchedTag, tag.id)}
                          className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                            tagMappings[unmatchedTag] === tag.id
                              ? 'bg-primary text-white'
                              : 'bg-white border border-neutral-300 text-neutral-900 hover:bg-neutral-50'
                          }`}
                        >
                          {tag.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 justify-end pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancelTagMapping}
                disabled={isImporting}
              >
                ביטול
              </Button>
              <Button
                type="button"
                onClick={handleRetryImportWithMappings}
                disabled={isImporting || unmatchedTags.some(tag => !tagMappings[tag])}
              >
                {isImporting ? 'מייבא...' : 'המשך עם המיפוי'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-sm text-neutral-700 text-right" dir="rtl">
            <p className="text-neutral-600">
              הורידו את קובץ התחזוקה כדי למלא שדות חסרים (תעודת זהות, טלפון, מדריך, תוויות ועוד) ואז העלו את הקובץ המעודכן.
              מזהה המערכת (UUID) משמש להשוואת השורות, ולכן אין למחוק או לערוך אותו.
            </p>

            <div className="grid gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-2 sm:grid-flow-col sm:auto-cols-fr">
              <div className="space-y-2 sm:order-2">
                <p className="font-semibold text-neutral-900">2. העלאת CSV מעודכן</p>
                <form className="space-y-2" onSubmit={handleImport}>
                  <div className="space-y-1">
                    <Label htmlFor="maintenance-upload" className="block text-right">בחרו קובץ CSV</Label>
                  <Input
                    id="maintenance-upload"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleFileChange}
                  />
                  <p className="text-xs text-neutral-500">
                    צריכים עזרה? <button type="button" onClick={() => setShowHelp(true)} className="inline-flex items-center gap-1 text-primary hover:underline font-semibold">
                      <HelpCircle className="h-3.5 w-3.5" />
                      לחצו כאן לעזרה
                    </button>
                  </p>
                </div>
                {importError ? (
                  <p className="text-sm text-red-600" role="alert">{importError}</p>
                ) : null}
                <Button type="submit" disabled={isImporting || !selectedFile} className="gap-2">
                  <UploadCloud className="h-4 w-4" />
                  {isImporting ? 'מייבא...' : 'ייבוא עדכונים'}
                </Button>
              </form>
            </div>
            <div className="space-y-2 sm:order-1">
              <p className="font-semibold text-neutral-900">1. הורדת CSV</p>
              <p className="text-neutral-600">כולל כל התלמידים והעמודות הניתנות לעריכה.</p>
              <Button type="button" onClick={handleDownload} disabled={isDownloading} className="gap-2">
                <Download className="h-4 w-4" />
                {isDownloading ? 'מוריד...' : 'הורד קובץ תחזוקה'}
              </Button>
            </div>
          </div>

          {summary ? (
            <div className="space-y-3 rounded-lg border border-neutral-200 p-4">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-neutral-900">סה"כ שורות:</span>
                  <span>{summary.total_rows ?? 0}</span>
                </div>
                <div className="flex items-center gap-2 text-green-700">
                  <span className="font-semibold">עודכנו:</span>
                  <span>{summary.updated_count ?? 0}</span>
                </div>
                <div className="flex items-center gap-2 text-red-700">
                  <span className="font-semibold">כשלים:</span>
                  <span>{summary.failed_count ?? 0}</span>
                </div>
              </div>

              {failureEntries.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
                    <FileWarning className="h-4 w-4" />
                    שורות שנכשלו
                  </div>
                  <Separator />
                  <ul className="space-y-2 text-sm text-neutral-700" aria-live="polite">
                    {failureEntries.map((entry, index) => (
                      <li key={`${entry.student_id || index}-${entry.code || index}`} className="rounded-md bg-red-50 p-2">
                        <div className="font-semibold text-red-800">{buildErrorLabel(entry)}</div>
                        <div className="text-red-700">{entry.message || 'השורה נכשלה בעדכון.'}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
