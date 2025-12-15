import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { 
  FileText, 
  Upload, 
  Download, 
  Trash2, 
  Loader2, 
  AlertCircle, 
  Pencil,
  X,
  Check,
  Calendar,
  CalendarX,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Building2,
} from 'lucide-react';
import { format, parseISO, isBefore, startOfDay } from 'date-fns';
import { he } from 'date-fns/locale';
import { fetchSettingsValue, upsertSetting } from '@/features/settings/api/settings.js';
import { useDocuments } from '@/hooks/useDocuments';
import { checkDocumentDuplicate } from '@/features/students/api/documents-check.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

const REQUEST_STATE = {
  idle: 'idle',
  loading: 'loading',
  error: 'error',
};

const VISIBILITY_RESTRICTION_ERROR = 'members_cannot_view_org_documents';

function formatFileDate(dateString) {
  if (!dateString) return '';
  try {
    const parsed = parseISO(dateString);
    return format(parsed, 'dd/MM/yyyy', { locale: he });
  } catch {
    return dateString;
  }
}

function formatDateTime(dateString) {
  if (!dateString) return '';
  try {
    const parsed = parseISO(dateString);
    return format(parsed, 'dd/MM/yyyy HH:mm', { locale: he });
  } catch {
    return dateString;
  }
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0 || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = Math.round((bytes / Math.pow(k, i)) * 100) / 100;
  return `${size} ${sizes[i]}`;
}

/**
 * Check if a document is expired
 */
function isExpired(expirationDate) {
  if (!expirationDate) return false;
  try {
    const expDate = parseISO(expirationDate);
    const today = startOfDay(new Date());
    return isBefore(expDate, today);
  } catch {
    return false;
  }
}

/**
 * Pre-upload dialog for editing file metadata before uploading
 */
function PreUploadDialog({ file, onConfirm, onCancel }) {
  const [name, setName] = useState(file?.name || '');
  const [relevantDate, setRelevantDate] = useState('');
  const [expirationDate, setExpirationDate] = useState('');

  useEffect(() => {
    if (file) {
      // Remove extension from default name
      const nameParts = file.name.split('.');
      if (nameParts.length > 1) {
        nameParts.pop();
      }
      setName(nameParts.join('.'));
    }
  }, [file]);

  const handleConfirm = () => {
    console.log('[ORG-DOCS-UI] PreUpload dialog confirm clicked', { 
      fileName: file?.name,
      name: name.trim() 
    });
    onConfirm({
      file: file,
      name: name.trim() || file.name,
      relevantDate: relevantDate || null,
      expirationDate: expirationDate || null,
    });
  };

  if (!file) return null;

  return (
    <Dialog open={!!file} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-[500px]" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">הגדרות מסמך</DialogTitle>
          <DialogDescription className="text-right">
            ערוך את פרטי המסמך לפני ההעלאה
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="doc-name" className="text-right block">
              שם המסמך <span className="text-red-500">*</span>
            </Label>
            <Input
              id="doc-name"
              dir="rtl"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="לדוגמה: רישיון עסק"
              className="text-right"
            />
            <p className="text-xs text-muted-foreground text-right">
              קובץ מקורי: {file.name}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="relevant-date" className="text-right flex items-center gap-2 justify-end">
              <span>תאריך רלוונטי</span>
              <Calendar className="h-4 w-4" />
            </Label>
            <Input
              id="relevant-date"
              type="date"
              dir="ltr"
              value={relevantDate}
              onChange={(e) => setRelevantDate(e.target.value)}
              className="text-right"
            />
            <p className="text-xs text-muted-foreground text-right">
              תאריך הנפקה, אישור וכדומה
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="expiration-date" className="text-right flex items-center gap-2 justify-end">
              <span>תאריך תפוגה</span>
              <CalendarX className="h-4 w-4" />
            </Label>
            <Input
              id="expiration-date"
              type="date"
              dir="ltr"
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
              className="text-right"
            />
            <p className="text-xs text-muted-foreground text-right">
              המסמך יסומן כפג תוקף לאחר תאריך זה
            </p>
          </div>
        </div>

        <div className="flex gap-2 flex-row-reverse">
          <Button onClick={handleConfirm} disabled={!name.trim()}>
            <Upload className="h-4 w-4 ml-2" />
            העלה
          </Button>
          <Button onClick={onCancel} variant="outline">
            ביטול
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Edit metadata dialog for existing documents
 */
function EditMetadataDialog({ document, onSave, onCancel }) {
  const [name, setName] = useState(document?.name || '');
  const [relevantDate, setRelevantDate] = useState(document?.relevant_date || '');
  const [expirationDate, setExpirationDate] = useState(document?.expiration_date || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        id: document.id,
        name: name.trim(),
        relevantDate: relevantDate || null,
        expirationDate: expirationDate || null,
      });
    } finally {
      setSaving(false);
    }
  };

  if (!document) return null;

  return (
    <Dialog open={!!document} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-[500px]" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">עריכת מסמך</DialogTitle>
          <DialogDescription className="text-right">
            ערוך את פרטי המסמך
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name" className="text-right block">
              שם המסמך <span className="text-red-500">*</span>
            </Label>
            <Input
              id="edit-name"
              dir="rtl"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-right"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-relevant-date" className="text-right flex items-center gap-2 justify-end">
              <span>תאריך רלוונטי</span>
              <Calendar className="h-4 w-4" />
            </Label>
            <Input
              id="edit-relevant-date"
              type="date"
              dir="ltr"
              value={relevantDate}
              onChange={(e) => setRelevantDate(e.target.value)}
              className="text-right"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-expiration-date" className="text-right flex items-center gap-2 justify-end">
              <span>תאריך תפוגה</span>
              <CalendarX className="h-4 w-4" />
            </Label>
            <Input
              id="edit-expiration-date"
              type="date"
              dir="ltr"
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
              className="text-right"
            />
          </div>
        </div>

        <div className="flex gap-2 flex-row-reverse">
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                שומר...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 ml-2" />
                שמור
              </>
            )}
          </Button>
          <Button onClick={onCancel} variant="outline" disabled={saving}>
            ביטול
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Multi-file pre-upload dialog - allows reviewing and configuring multiple files before upload
 */
function BulkPreUploadDialog({ files, onConfirm, onCancel }) {
  const [fileMetadata, setFileMetadata] = useState([]);

  useEffect(() => {
    if (files && files.length > 0) {
      // Initialize metadata for each file
      const initialMetadata = files.map(file => {
        const nameParts = file.name.split('.');
        if (nameParts.length > 1) {
          nameParts.pop();
        }
        return {
          file,
          name: nameParts.join('.'),
          relevantDate: '',
          expirationDate: '',
        };
      });
      setFileMetadata(initialMetadata);
    }
  }, [files]);

  const updateMetadata = (index, field, value) => {
    setFileMetadata(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleConfirm = () => {
    const validFiles = fileMetadata.filter(meta => meta.name.trim());
    onConfirm(validFiles);
  };

  const allValid = fileMetadata.every(meta => meta.name.trim());

  if (!files || files.length === 0) return null;

  return (
    <Dialog open={files.length > 0} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh]" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">הגדרות מסמכים ({files.length})</DialogTitle>
          <DialogDescription className="text-right">
            ערוך את פרטי המסמכים לפני ההעלאה
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto max-h-[50vh] space-y-3 py-2">
          {fileMetadata.map((meta, idx) => (
            <Card key={idx} className="p-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  <span>קובץ {idx + 1} מתוך {files.length}</span>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`bulk-name-${idx}`} className="text-right block">
                    שם המסמך <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id={`bulk-name-${idx}`}
                    dir="rtl"
                    value={meta.name}
                    onChange={(e) => updateMetadata(idx, 'name', e.target.value)}
                    placeholder="לדוגמה: רישיון עסק"
                    className="text-right"
                  />
                  <p className="text-xs text-muted-foreground text-right">
                    קובץ מקורי: {meta.file.name}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor={`bulk-relevant-${idx}`} className="text-right block text-xs">
                      תאריך רלוונטי
                    </Label>
                    <Input
                      id={`bulk-relevant-${idx}`}
                      type="date"
                      dir="ltr"
                      value={meta.relevantDate}
                      onChange={(e) => updateMetadata(idx, 'relevantDate', e.target.value)}
                      className="text-right text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`bulk-expiration-${idx}`} className="text-right block text-xs">
                      תאריך תפוגה
                    </Label>
                    <Input
                      id={`bulk-expiration-${idx}`}
                      type="date"
                      dir="ltr"
                      value={meta.expirationDate}
                      onChange={(e) => updateMetadata(idx, 'expirationDate', e.target.value)}
                      className="text-right text-sm"
                    />
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="flex gap-2 flex-row-reverse border-t pt-4">
          <Button onClick={handleConfirm} disabled={!allValid}>
            <Upload className="h-4 w-4 ml-2" />
            העלה {files.length} קבצים
          </Button>
          <Button onClick={onCancel} variant="outline">
            ביטול
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Main component
 */
export default function OrgDocumentsManager({ session, orgId, membershipRole }) {
  // Use polymorphic Documents table hook
  const {
    documents,
    loading: documentsLoading,
    error: documentsError,
    fetchDocuments,
    uploadDocument,
    updateDocument,
    deleteDocument,
    getDownloadUrl
  } = useDocuments('organization', orgId);
  
  const [uploadState, setUploadState] = useState(REQUEST_STATE.idle);
  const [deleteState, setDeleteState] = useState(REQUEST_STATE.idle);
  const [pendingFiles, setPendingFiles] = useState([]); // Changed to array for bulk upload
  const [editingDocument, setEditingDocument] = useState(null);
  const [sortBy, setSortBy] = useState('uploaded_at'); // 'uploaded_at' | 'name' | 'expiration_date'
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc' | 'desc'
  const [visibilityRestricted, setVisibilityRestricted] = useState(false);
  const [memberVisibility, setMemberVisibility] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);

  const canManage = membershipRole === 'admin' || membershipRole === 'owner';
  
  // Handle document loading errors (visibility restriction)
  useEffect(() => {
    if (documentsError?.message === 'members_cannot_view_org_documents') {
      setVisibilityRestricted(true);
    }
  }, [documentsError]);

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const ALLOWED_TYPES = useMemo(() => [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ], []);

  const checkForDuplicates = useCallback(
    async (file) => {
      if (!session || !orgId) return { has_duplicates: false, duplicates: [] };

      const token = session.access_token;
      if (!token) {
        console.error('Session missing access_token', session);
        toast.error('שגיאת הרשאה. נא להתחבר מחדש');
        return { has_duplicates: false, duplicates: [] };
      }

      try {
        const result = await checkDocumentDuplicate({
          entityType: 'organization',
          entityId: orgId,
          file,
          orgId,
          sessionToken: token,
        });
        return result;
      } catch (error) {
        console.error('Duplicate check error:', error);
        
        const errorMessage = error?.message || '';
        if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
          toast.error('שגיאת הרשאה. נא להתחבר מחדש');
        } else if (errorMessage.includes('403') || errorMessage.includes('admin_only')) {
          toast.error('רק בעלי/ות הרשאות מנהל יכולים/ות להעלות מסמכים ארגוניים');
        } else if (errorMessage.includes('500')) {
          toast.error('שגיאת שרת בעת בדיקת כפליות');
        } else if (!errorMessage.includes('AbortError')) {
          console.warn('Duplicate check error details:', error);
        }
        return { has_duplicates: false, duplicates: [] };
      }
    },
    [session, orgId]
  );

  // Load member visibility setting
  const loadVisibilitySetting = useCallback(async () => {
    if (!session || !orgId || !canManage) return;

    try {
      const response = await fetchSettingsValue({ 
        session, 
        orgId, 
        key: 'org_documents_member_visibility' 
      });
      setMemberVisibility(response?.value === true || response?.value === 'true');
    } catch (error) {
      console.error('Failed to load visibility setting:', error);
      setMemberVisibility(false);
    }
  }, [session, orgId, canManage]);

  // Save member visibility setting
  const handleVisibilityToggle = useCallback(async (enabled) => {
    if (!session || !orgId) return;

    setSavingVisibility(true);
    setMemberVisibility(enabled);

    try {
      await upsertSetting({
        session,
        orgId,
        key: 'org_documents_member_visibility',
        value: enabled,
      });
      toast.success(enabled ? 'גישת חברים הופעלה' : 'גישת חברים הוסרה');
    } catch (error) {
      console.error('Failed to save visibility setting:', error);
      toast.error('שמירת ההגדרה נכשלה');
      // Revert on error
      setMemberVisibility(!enabled);
    } finally {
      setSavingVisibility(false);
    }
  }, [session, orgId]);

  useEffect(() => {
    loadVisibilitySetting();
  }, [loadVisibilitySetting]);

  // Handle file selection (bulk upload with duplicate detection)
  const handleFileSelect = useCallback(async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    console.log('[ORG-DOCS-UI] Files selected', { count: selectedFiles.length });
    if (selectedFiles.length === 0) return;

    // Validate all files
    const validFiles = [];
    for (const file of selectedFiles) {
      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name}: גדול מדי (מקסימום 10MB)`);
        continue;
      }

      // Validate file type
      if (!ALLOWED_TYPES.includes(file.type)) {
        toast.error(`${file.name}: סוג קובץ לא נתמך`);
        continue;
      }

      validFiles.push(file);
    }

    if (validFiles.length === 0) {
      event.target.value = '';
      return;
    }

    console.log('[ORG-DOCS-UI] Valid files:', validFiles.length);

    // Check for duplicates
    const duplicateResults = await Promise.all(
      validFiles.map(file => checkForDuplicates(file))
    );

    const filesWithDuplicates = duplicateResults.filter(r => r.has_duplicates);
    if (filesWithDuplicates.length > 0) {
      const totalDuplicates = filesWithDuplicates.reduce((sum, r) => sum + r.duplicates.length, 0);
      const duplicateFileNames = filesWithDuplicates
        .flatMap(r => r.duplicates.map(d => d.file_name))
        .slice(0, 3)
        .join(', ');
      
      const message = `נמצאו ${totalDuplicates} כפילויות קיימות (${duplicateFileNames}${totalDuplicates > 3 ? '...' : ''}). להמשיך בהעלאה?`;
      
      const confirmed = window.confirm(message);
      if (!confirmed) {
        event.target.value = '';
        return;
      }
    }

    console.log('[ORG-DOCS-UI] Files validated, showing bulk pre-upload dialog');
    setPendingFiles(validFiles);

    // Reset input
    event.target.value = '';
  }, [MAX_FILE_SIZE, ALLOWED_TYPES, checkForDuplicates]);

  // Handle upload with metadata (bulk upload support)
  const handleUploadConfirm = useCallback(async (filesData) => {
    console.log('[ORG-DOCS-UI] Upload confirm called', { 
      fileCount: filesData.length,
      hasSession: !!session,
      orgId 
    });
    
    if (!session || !orgId) {
      console.error('[ORG-DOCS-UI] Missing session or orgId', { hasSession: !!session, orgId });
      return;
    }

    setPendingFiles([]);
    setUploadState(REQUEST_STATE.loading);

    let successCount = 0;
    let failCount = 0;

    for (const fileData of filesData) {
      const toastId = toast.loading(`מעלה: ${fileData.name}...`);

      try {
        console.log('[ORG-DOCS-UI] Starting polymorphic upload via useDocuments hook', { fileName: fileData.name });
        
        // Use the uploadDocument function from useDocuments hook
        await uploadDocument(fileData.file, {
          name: fileData.name,
          relevant_date: fileData.relevantDate || null,
          expiration_date: fileData.expirationDate || null,
        });

        console.log('[ORG-DOCS-UI] Upload successful', { fileName: fileData.name });
        toast.success(`${fileData.name} הועלה בהצלחה`, { id: toastId });
        successCount++;
      } catch (error) {
        console.error('[ORG-DOCS-UI] Upload failed', { fileName: fileData.name, error });
        toast.error(`${fileData.name}: ${error.message}`, { id: toastId });
        failCount++;
      }
    }

    setUploadState(REQUEST_STATE.idle);

    // Refresh documents list after all uploads
    await fetchDocuments();

    // Summary toast for bulk uploads
    if (filesData.length > 1) {
      if (failCount === 0) {
        toast.success(`כל ${successCount} הקבצים הועלו בהצלחה`);
      } else if (successCount === 0) {
        toast.error(`כל ${failCount} הקבצים נכשלו`);
      } else {
        toast.info(`הועלו ${successCount} קבצים, ${failCount} נכשלו`);
      }
    }
  }, [session, orgId, uploadDocument, fetchDocuments]);

  // Handle upload cancel
  const handleUploadCancel = useCallback(() => {
    setPendingFiles([]);
  }, []);

  // Handle metadata update
  const handleUpdateMetadata = useCallback(async (updateData) => {
    if (!session || !orgId) return;

    try {
      // Use updateDocument from useDocuments hook
      await updateDocument(updateData.id, {
        name: updateData.name,
        relevant_date: updateData.relevantDate,
        expiration_date: updateData.expirationDate,
      });

      toast.success('המסמך עודכן בהצלחה');
      setEditingDocument(null);

      // Refresh documents list
      await fetchDocuments();
    } catch (error) {
      console.error('Update failed:', error);
      toast.error('עדכון המסמך נכשל');
    }
  }, [session, orgId, updateDocument, fetchDocuments]);

  // Handle delete
  const handleDelete = useCallback(async (documentId, documentName) => {
    if (!session || !orgId) return;
    if (!confirm(`האם למחוק את המסמך "${documentName}"? פעולה זו בלתי הפיכה.`)) return;

    setDeleteState(REQUEST_STATE.loading);
    const toastId = toast.loading('מוחק מסמך...');

    try {
      // Use deleteDocument from useDocuments hook
      await deleteDocument(documentId);

      toast.success('המסמך נמחק בהצלחה', { id: toastId });
      setDeleteState(REQUEST_STATE.idle);

      // Refresh documents list
      await fetchDocuments();
    } catch (error) {
      console.error('Delete failed:', error);
      toast.error('מחיקת המסמך נכשלה', { id: toastId });
      setDeleteState(REQUEST_STATE.error);
    }
  }, [session, orgId, deleteDocument, fetchDocuments]);

  // Handle download
  const handleDownload = useCallback(async (doc) => {
    if (!session || !orgId) return;

    const toastId = toast.loading('מכין להורדה...');

    try {
      // Use getDownloadUrl from useDocuments hook (attachment mode)
      const url = await getDownloadUrl(doc.id, false);
      window.location.href = url; // Navigate to presigned URL to trigger download
      
      toast.success('מסמך הורד בהצלחה', { id: toastId });
    } catch (error) {
      console.error('Download failed:', error);
      toast.error(`הורדת המסמך נכשלה: ${error?.message || 'שגיאה לא ידועה'}`, { id: toastId });
    }
  }, [session, orgId, getDownloadUrl]);

  // Handle file preview
  const handlePreview = useCallback(async (doc) => {
    if (!session || !orgId) return;

    const toastId = toast.loading('פותח תצוגה מקדימה...');

    try {
      // Use getDownloadUrl from useDocuments hook (inline/preview mode)
      const url = await getDownloadUrl(doc.id, true);
      toast.dismiss(toastId);
      window.open(url, '_blank');
    } catch (error) {
      console.error('Preview failed:', error);
      toast.error(`תצוגה מקדימה נכשלה: ${error?.message || 'שגיאה לא ידועה'}`, { id: toastId });
    }
  }, [session, orgId, getDownloadUrl]);

  // Sort documents
  const sortedDocuments = useMemo(() => {
    const sorted = [...documents];
    
    sorted.sort((a, b) => {
      let comparison = 0;
      
      if (sortBy === 'name') {
        comparison = (a.name || '').localeCompare(b.name || '', 'he');
      } else if (sortBy === 'uploaded_at') {
        const dateA = a.uploaded_at ? new Date(a.uploaded_at).getTime() : 0;
        const dateB = b.uploaded_at ? new Date(b.uploaded_at).getTime() : 0;
        comparison = dateA - dateB;
      } else if (sortBy === 'expiration_date') {
        const dateA = a.expiration_date ? new Date(a.expiration_date).getTime() : Infinity;
        const dateB = b.expiration_date ? new Date(b.expiration_date).getTime() : Infinity;
        comparison = dateA - dateB;
      }
      
      return sortOrder === 'asc' ? comparison : -comparison;
    });
    
    return sorted;
  }, [documents, sortBy, sortOrder]);

  // Toggle sort
  const toggleSort = useCallback((field) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  }, [sortBy]);

  // Separate expired and active documents
  const expiredDocs = sortedDocuments.filter(doc => isExpired(doc.expiration_date));
  const activeDocs = sortedDocuments.filter(doc => !isExpired(doc.expiration_date));

  return (
    <>
      <Card dir="rtl">
        <CardHeader className="pb-3">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <Building2 className="h-5 w-5 text-blue-600" />
                <CardTitle className="text-lg">מסמכי הארגון</CardTitle>
                {expiredDocs.length > 0 && (
                  <Badge variant="destructive" className="gap-1 text-xs">
                    <AlertCircle className="h-3 w-3" />
                    {expiredDocs.length} פג תוקף
                  </Badge>
                )}
              </div>
            </div>
            {canManage && documents.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={sortBy === 'name' ? 'default' : 'outline'}
                  onClick={() => toggleSort('name')}
                  className="gap-1 h-8 text-xs"
                >
                  {sortBy === 'name' && sortOrder === 'asc' && <ArrowUp className="h-3 w-3" />}
                  {sortBy === 'name' && sortOrder === 'desc' && <ArrowDown className="h-3 w-3" />}
                  {sortBy !== 'name' && <ArrowUpDown className="h-3 w-3" />}
                  שם
                </Button>
                <Button
                  size="sm"
                  variant={sortBy === 'uploaded_at' ? 'default' : 'outline'}
                  onClick={() => toggleSort('uploaded_at')}
                  className="gap-1 h-8 text-xs"
                >
                  {sortBy === 'uploaded_at' && sortOrder === 'asc' && <ArrowUp className="h-3 w-3" />}
                  {sortBy === 'uploaded_at' && sortOrder === 'desc' && <ArrowDown className="h-3 w-3" />}
                  {sortBy !== 'uploaded_at' && <ArrowUpDown className="h-3 w-3" />}
                  העלאה
                </Button>
                <Button
                  size="sm"
                  variant={sortBy === 'expiration_date' ? 'default' : 'outline'}
                  onClick={() => toggleSort('expiration_date')}
                  className="gap-1 h-8 text-xs"
                >
                  {sortBy === 'expiration_date' && sortOrder === 'asc' && <ArrowUp className="h-3 w-3" />}
                  {sortBy === 'expiration_date' && sortOrder === 'desc' && <ArrowDown className="h-3 w-3" />}
                  {sortBy !== 'expiration_date' && <ArrowUpDown className="h-3 w-3" />}
                  תפוגה
                </Button>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-3 sm:space-y-4">
          {/* Visibility Restriction Message for Non-Admin Members */}
          {visibilityRestricted && !canManage && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center">
              <div className="flex flex-col items-center gap-3">
                <Building2 className="h-12 w-12 text-amber-600" />
                <div className="space-y-2">
                  <p className="font-semibold text-amber-900">מסמכי הארגון אינם זמינים לצפייה</p>
                  <p className="text-sm text-amber-800">
                    מנהל הארגון הגביל את הגישה למסמכים אלה. נא לפנות למנהל לקבלת מידע נוסף.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Content shown when not restricted */}
          {!visibilityRestricted && (
            <>
              {/* Upload Guidelines */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4 text-sm">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-blue-700" />
                  <div className="space-y-1">
                    <p className="font-medium text-blue-900 text-xs sm:text-sm">הנחיות העלאה:</p>
                    <ul className="list-disc list-inside space-y-0.5 text-xs text-blue-800">
                      <li>גודל מקסימלי: 10MB</li>
                      <li>PDF, תמונות, Word, Excel</li>
                      <li>ניתן לערוך שם, תאריכים ופרטים לפני ואחרי ההעלאה</li>
                    </ul>
                  </div>
                </div>
              </div>

          {/* Member Visibility Toggle (Admin Only) */}
          {canManage && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 sm:p-4">
              <div className="flex items-start sm:items-center justify-between gap-3 sm:gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-slate-900">אפשר צפייה לכלל חברי הצוות</p>
                  <p className="text-xs text-slate-600 mt-0.5 leading-snug">
                    חברי צוות שאינם מנהלים יוכלו לצפות ולהוריד <span className="hidden sm:inline">(ללא העלאה/מחיקה)</span>
                  </p>
                </div>
                <Switch
                  checked={memberVisibility}
                  onCheckedChange={handleVisibilityToggle}
                  disabled={savingVisibility}
                  aria-label="החלפת אפשרות צפייה לכלל חברי הצוות"
                  className="shrink-0"
                />
              </div>
            </div>
          )}

          {/* Upload Button */}
          {canManage && (
            <div>
              <input
                type="file"
                id="org-doc-upload"
                className="sr-only"
                onChange={handleFileSelect}
                accept={ALLOWED_TYPES.join(',')}
                disabled={uploadState === REQUEST_STATE.loading}
                multiple
              />
              <Button
                onClick={() => document.getElementById('org-doc-upload')?.click()}
                disabled={uploadState === REQUEST_STATE.loading}
                className="w-full gap-2 h-11 sm:h-10 font-medium"
              >
                {uploadState === REQUEST_STATE.loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    מעלה...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    העלאת מסמך חדש
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Documents List */}
          {documentsLoading ? (
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-slate-400" />
              <p className="text-sm text-slate-600">טוען מסמכים...</p>
            </div>
          ) : documents.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-8">
              טרם הועלו מסמכים ארגוניים
            </p>
          ) : (
            <div className="space-y-4">
              {/* Expired Documents */}
              {expiredDocs.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs sm:text-sm font-semibold text-red-700 flex items-center gap-1.5 sm:gap-2 justify-end">
                    <span>מסמכים שפג תוקפם ({expiredDocs.length})</span>
                    <CalendarX className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </h4>
                  {expiredDocs.map(doc => (
                    <DocumentCard
                      key={doc.id}
                      document={doc}
                      expired={true}
                      canManage={canManage}
                      deleteState={deleteState}
                      onEdit={() => setEditingDocument(doc)}
                      onDelete={() => handleDelete(doc.id, doc.name)}
                      onDownload={() => handleDownload(doc)}
                      onPreview={() => handlePreview(doc)}
                    />
                  ))}
                </div>
              )}

              {/* Active Documents */}
              {activeDocs.length > 0 && (
                <div className="space-y-2">
                  {expiredDocs.length > 0 && (
                    <h4 className="text-xs sm:text-sm font-semibold text-slate-700 flex items-center gap-1.5 sm:gap-2 justify-end">
                      <span>מסמכים פעילים ({activeDocs.length})</span>
                      <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    </h4>
                  )}
                  {activeDocs.map(doc => (
                    <DocumentCard
                      key={doc.id}
                      document={doc}
                      expired={false}
                      canManage={canManage}
                      deleteState={deleteState}
                      onEdit={() => setEditingDocument(doc)}
                      onDelete={() => handleDelete(doc.id, doc.name)}
                      onDownload={() => handleDownload(doc)}
                      onPreview={() => handlePreview(doc)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          </>
          )}
        </CardContent>
      </Card>

      {/* Pre-upload Dialog (Bulk) */}
      <BulkPreUploadDialog
        files={pendingFiles}
        onConfirm={handleUploadConfirm}
        onCancel={handleUploadCancel}
      />

      {/* Edit Metadata Dialog */}
      {editingDocument && (
        <EditMetadataDialog
          document={editingDocument}
          onSave={handleUpdateMetadata}
          onCancel={() => setEditingDocument(null)}
        />
      )}
    </>
  );
}

/**
 * Document card component
 */
function DocumentCard({ document: doc, expired, canManage, deleteState, onEdit, onDelete, onDownload, onPreview }) {
  const [showFullOriginalName, setShowFullOriginalName] = React.useState(false);

  return (
    <div
      className={`p-3 sm:p-4 border rounded-lg ${
        expired ? 'border-red-300 bg-red-50/50' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-2 sm:gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2 mb-1 flex-wrap">
            <button
              onClick={onPreview}
              className="font-medium text-slate-900 text-sm sm:text-base leading-tight hover:text-primary underline-offset-2 hover:underline text-right"
              title="לחץ לתצוגה מקדימה"
            >
              {doc.name}
            </button>
            {expired && (
              <Badge variant="destructive" className="text-xs shrink-0">
                פג תוקף
              </Badge>
            )}
          </div>

          <div className="text-sm text-slate-600 space-y-1">
            {doc.original_name && doc.original_name !== doc.name && (
              <div className="relative">
                <button
                  onClick={() => setShowFullOriginalName(!showFullOriginalName)}
                  className="text-xs text-slate-500 hover:text-slate-700 underline-offset-2 hover:underline text-right w-full"
                  title={showFullOriginalName ? 'לחץ להסתרה' : 'לחץ לצפייה בשם המלא'}
                >
                  <span className={showFullOriginalName ? 'break-words' : 'truncate block'}>
                    קובץ: {doc.original_name}
                  </span>
                </button>
              </div>
            )}
            
            <div className="flex flex-wrap gap-x-2 sm:gap-x-3 gap-y-1 text-xs">
              <span dir="ltr" className="shrink-0">{formatFileSize(doc.size)}</span>
              <span className="hidden sm:inline">הועלה: {formatDateTime(doc.uploaded_at)}</span>
              <span className="sm:hidden">{formatFileDate(doc.uploaded_at.split('T')[0])}</span>
            </div>

            {doc.relevant_date && (
              <div className="flex items-center gap-1 text-xs">
                <Calendar className="h-3 w-3 shrink-0" />
                <span className="hidden sm:inline">תאריך רלוונטי: {formatFileDate(doc.relevant_date)}</span>
                <span className="sm:hidden">רלוונטי: {formatFileDate(doc.relevant_date)}</span>
              </div>
            )}

            {doc.expiration_date && (
              <div className={`flex items-center gap-1 text-xs ${expired ? 'text-red-700 font-medium' : ''}`}>
                <CalendarX className="h-3 w-3 shrink-0" />
                <span>תפוגה: {formatFileDate(doc.expiration_date)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={onDownload}
            title="הורדה"
            className="h-9 w-9 p-0"
          >
            <Download className="h-4 w-4" />
          </Button>
          {canManage && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={onEdit}
                title="עריכה"
                className="h-9 w-9 p-0"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onDelete}
                disabled={deleteState === REQUEST_STATE.loading}
                className="text-destructive hover:text-destructive h-9 w-9 p-0"
                title="מחיקה"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
