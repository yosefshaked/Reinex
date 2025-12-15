import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { FileText, Upload, Download, Trash2, ChevronDown, ChevronUp, Loader2, AlertCircle, CheckCircle2, Eye, ArrowUpDown, ArrowUp, ArrowDown, Calendar, CalendarX, CheckCircle, Edit } from 'lucide-react';
import { fetchSettingsValue } from '@/features/settings/api/settings.js';
import { format, parseISO, isBefore, startOfDay } from 'date-fns';
import { he } from 'date-fns/locale';
import { useOrg } from '@/org/OrgContext.jsx';
import { getAuthClient } from '@/lib/supabase-manager.js';
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

function formatFileDate(dateString) {
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
 * Post-upload dialog for editing file metadata after upload
 */
function EditFileDialog({ file, onConfirm, onCancel }) {
  const [name, setName] = useState('');
  const [relevantDate, setRelevantDate] = useState('');
  const [expirationDate, setExpirationDate] = useState('');

  useEffect(() => {
    if (file) {
      setName(file.name || '');
      setRelevantDate(file.relevant_date || '');
      setExpirationDate(file.expiration_date || '');
    }
  }, [file]);

  const handleConfirm = () => {
    onConfirm({
      fileId: file.id,
      name: name.trim(),
      relevantDate: relevantDate || null,
      expirationDate: expirationDate || null,
    });
  };

  if (!file) return null;

  return (
    <Dialog open={!!file} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-[500px]" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">עריכת מסמך</DialogTitle>
          <DialogDescription className="text-right">
            ערוך את פרטי המסמך
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-doc-name" className="text-right block">
              שם המסמך <span className="text-red-500">*</span>
            </Label>
            <Input
              id="edit-doc-name"
              dir="rtl"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="שם המסמך"
              className="text-right"
            />
            {file.original_name && (
              <p className="text-xs text-muted-foreground text-right">
                קובץ מקורי: {file.original_name}
              </p>
            )}
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
          <Button onClick={handleConfirm} disabled={!name.trim()}>
            שמור שינויים
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
 * Pre-upload dialog for editing file metadata before uploading
 */
/**
 * Multi-file pre-upload dialog - allows reviewing and configuring multiple files before upload
 */
function BulkPreUploadDialog({ files, definitionName, onConfirm, onCancel }) {
  const [filesData, setFilesData] = useState([]);

  useEffect(() => {
    if (files && files.length > 0) {
      setFilesData(files.map(fileData => ({
        ...fileData,
        id: crypto.randomUUID()
      })));
    }
  }, [files]);

  const handleFileChange = (id, field, value) => {
    setFilesData(prev => prev.map(f => 
      f.id === id ? { ...f, [field]: value } : f
    ));
  };

  const handleConfirm = () => {
    onConfirm(filesData);
  };

  if (!files || files.length === 0) return null;

  const allNamesValid = filesData.every(f => f.name && f.name.trim());

  return (
    <Dialog open={files.length > 0} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh]" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">
            הגדרות {filesData.length} קבצים
          </DialogTitle>
          <DialogDescription className="text-right">
            ערוך את פרטי המסמכים לפני ההעלאה. שדות שאינם מסומנים ב-* הם אופציונליים
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 overflow-y-auto max-h-[50vh]">
          {filesData.map((fileData, index) => (
            <Card key={fileData.id} className="p-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium mb-2">
                  <FileText className="h-4 w-4" />
                  <span>קובץ {index + 1}</span>
                  <Badge variant="outline" className="mr-auto">
                    {fileData.file.name}
                  </Badge>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`name-${fileData.id}`} className="text-right block">
                    שם המסמך <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id={`name-${fileData.id}`}
                    dir="rtl"
                    value={fileData.name}
                    onChange={(e) => handleFileChange(fileData.id, 'name', e.target.value)}
                    placeholder="לדוגמה: אישור רפואי"
                    className="text-right"
                    disabled={!!definitionName}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label htmlFor={`relevant-${fileData.id}`} className="text-right flex items-center gap-1 justify-end text-xs">
                      <span>תאריך רלוונטי</span>
                      <Calendar className="h-3 w-3" />
                    </Label>
                    <Input
                      id={`relevant-${fileData.id}`}
                      type="date"
                      dir="ltr"
                      value={fileData.relevantDate}
                      onChange={(e) => handleFileChange(fileData.id, 'relevantDate', e.target.value)}
                      className="text-right text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`expiration-${fileData.id}`} className="text-right flex items-center gap-1 justify-end text-xs">
                      <span>תאריך תפוגה</span>
                      <CalendarX className="h-3 w-3" />
                    </Label>
                    <Input
                      id={`expiration-${fileData.id}`}
                      type="date"
                      dir="ltr"
                      value={fileData.expirationDate}
                      onChange={(e) => handleFileChange(fileData.id, 'expirationDate', e.target.value)}
                      className="text-right text-sm"
                    />
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="flex gap-2 flex-row-reverse border-t pt-4">
          <Button onClick={handleConfirm} disabled={!allNamesValid}>
            <Upload className="h-4 w-4 ml-2" />
            העלה {filesData.length} קבצים
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
 * Single-file pre-upload dialog (kept for backward compatibility)
 */
function PreUploadDialog({ file, definitionName, onConfirm, onCancel }) {
  const [name, setName] = useState(file?.name || '');
  const [relevantDate, setRelevantDate] = useState('');
  const [expirationDate, setExpirationDate] = useState('');

  useEffect(() => {
    if (file) {
      // For files with definition, use definition name; otherwise remove extension
      if (definitionName) {
        setName(definitionName);
      } else {
        const nameParts = file.name.split('.');
        if (nameParts.length > 1) {
          nameParts.pop();
        }
        setName(nameParts.join('.'));
      }
    }
  }, [file, definitionName]);

  const handleConfirm = () => {
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
              placeholder="לדוגמה: אישור רפואי"
              className="text-right"
              disabled={!!definitionName}
            />
            <p className="text-xs text-muted-foreground text-right">
              {definitionName ? `שם מוגדר מראש: ${definitionName}` : `קובץ מקורי: ${file.name}`}
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

export default function StudentDocumentsSection({ student, session, orgId, onRefresh }) {
  const { activeOrg } = useOrg();
  
  // Use polymorphic Documents table hook for fetching documents
  const {
    documents,
    loading: _documentsLoading,
    error: _documentsError,
    fetchDocuments
  } = useDocuments('student', student?.id);
  
  const [loadState, setLoadState] = useState(REQUEST_STATE.idle);
  const [deleteState, setDeleteState] = useState(REQUEST_STATE.idle);
  const [definitions, setDefinitions] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [uploadingDefId, setUploadingDefId] = useState(null);
  const [uploadingAdhoc, setUploadingAdhoc] = useState(false);
  const [backgroundUploads, setBackgroundUploads] = useState([]); // Active background uploads
  const [sortBy, setSortBy] = useState('date'); // 'date' | 'name'
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc' | 'desc'
  const [pendingFiles, setPendingFiles] = useState([]); // Files awaiting metadata input
  const [pendingDefinitionId, setPendingDefinitionId] = useState(null); // Associated definition for pending files
  const [editingFile, setEditingFile] = useState(null); // File being edited post-upload

  // Use documents from hook instead of student.files prop
  const studentFiles = documents;
  const studentTags = Array.isArray(student?.tags) ? student.tags : [];
  
  // Permission check: member role can only preview files (no download/delete)
  const membershipRole = activeOrg?.membership?.role || 'member';
  const canDownloadFiles = membershipRole === 'admin' || membershipRole === 'owner';
  const canDeleteFiles = membershipRole === 'admin' || membershipRole === 'owner';
  
  // Filter definitions to show only those relevant to this student's tags
  const relevantDefinitions = definitions.filter(def => {
    // If definition has no target_tags, it applies to all students
    if (!def.target_tags || def.target_tags.length === 0) return true;
    
    // If student has no tags, only show definitions with no target_tags
    if (studentTags.length === 0) return false;
    
    // Show definition if student has at least one matching tag
    return def.target_tags.some(targetTag => studentTags.includes(targetTag));
  });
  
  // For mandatory check: only check definitions that are both relevant AND have matching files
  const hasMissingMandatory = relevantDefinitions.some(
    (def) => def.is_mandatory && !studentFiles.find((f) => f.definition_id === def.id)
  );

  // File upload restrictions (memoized to avoid recreating on every render)
  const MAX_FILE_SIZE = useMemo(() => 10 * 1024 * 1024, []); // 10MB
  const ALLOWED_TYPES = useMemo(() => [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ], []);

  // Load document definitions
  useEffect(() => {
    if (!session || !orgId) return;

    const loadDefinitions = async () => {
      setLoadState(REQUEST_STATE.loading);
      try {
        const { value } = await fetchSettingsValue({
          session,
          orgId,
          key: 'document_definitions',
        });

        const parsed = Array.isArray(value) ? value : [];
        setDefinitions(parsed);
        setLoadState(REQUEST_STATE.idle);
        
        // Note: Auto-open logic will run via hasMissingMandatory which uses relevantDefinitions
        // No need to duplicate filtering here
      } catch (error) {
        console.error('Error loading document definitions:', error);
        setLoadState(REQUEST_STATE.error);
      }
    };

    loadDefinitions();
  }, [session, orgId, student?.id]);

  // Auto-open section if there are missing mandatory files (runs when definitions or tags change)
  useEffect(() => {
    if (hasMissingMandatory) {
      setIsOpen(true);
    }
  }, [hasMissingMandatory]);

  const checkForDuplicates = useCallback(
    async (file) => {
      if (!session || !orgId || !student?.id) return { has_duplicates: false, duplicates: [] };

      const token = session.access_token;
      if (!token) {
        console.error('Session missing access_token', session);
        toast.error('שגיאת הרשאה. נא להתחבר מחדש');
        return { has_duplicates: false, duplicates: [] };
      }

      try {
        const result = await checkDocumentDuplicate({
          entityType: 'student',
          entityId: student.id,
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
        } else if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
          toast.error('אין לך הרשאה לבצע בדיקה זו');
        } else if (errorMessage.includes('500')) {
          toast.error('שגיאת שרת בעת בדיקת כפליות');
        } else if (!errorMessage.includes('AbortError')) {
          console.warn('Duplicate check error details:', error);
        }
        return { has_duplicates: false, duplicates: [] };
      }
    },
    [session, orgId, student?.id]
  );

  // DEPRECATED: handleFileUpload - replaced by handleBulkFileUpload for efficiency
  // Kept commented out for reference during migration
  /*
  const handleFileUpload = useCallback(
    async (file, definitionId = null, customName = null, relevantDate = null, expirationDate = null) => {
      if (!orgId || !student?.id) return;

      // Get fresh session token right before upload
      let token;
      try {
        const authClient = getAuthClient();
        const { data, error } = await authClient.auth.getSession();
        
        if (error || !data?.session?.access_token) {
          console.error('Failed to get fresh session:', error);
          toast.error('ההרשאה פגה. נא לרענן את הדף ולהתחבר מחדש', {
            duration: 5000,
            action: {
              label: 'רענן',
              onClick: () => window.location.reload(),
            },
          });
          return;
        }
        
        token = data.session.access_token;
      } catch (error) {
        console.error('Session refresh error:', error);
        toast.error('שגיאה בקבלת הרשאה. נא לרענן את הדף', {
          duration: 5000,
          action: {
            label: 'רענן',
            onClick: () => window.location.reload(),
          },
        });
        return;
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`הקובץ גדול מדי. הגודל המקסימלי הוא 10MB`);
        return;
      }

      // Validate file type
      if (!ALLOWED_TYPES.includes(file.type)) {
        toast.error(`סוג קובץ לא נתמך. אנא העלה PDF, תמונה, או מסמך Word/Excel`);
        return;
      }

      // Check for duplicates BEFORE uploading
      const duplicateCheck = await checkForDuplicates(file);
      if (duplicateCheck.has_duplicates) {
        const duplicateList = duplicateCheck.duplicates
          .map(d => `• ${d.file_name} (${d.student_name})`)
          .join('\n');
        
        const confirmMessage = `הקובץ "${file.name}" כבר קיים במערכת:\n\n${duplicateList}\n\nהאם להעלות בכל זאת?`;
        
        if (!confirm(confirmMessage)) {
          toast.info('העלאת הקובץ בוטלה');
          return;
        }
      }

      // Generate upload ID for tracking
      const uploadId = crypto.randomUUID();
      const uploadInfo = {
        id: uploadId,
        fileName: file.name,
        definitionId,
        progress: 0,
        status: 'uploading',
      };

      // Add to background uploads
      setBackgroundUploads(prev => [...prev, uploadInfo]);

      // Show toast with upload starting
      const toastId = toast.loading(`מעלה: ${file.name}...`, {
        description: '0%',
      });

      // Start upload immediately (background)
      if (definitionId) {
        setUploadingDefId(definitionId);
      } else {
        setUploadingAdhoc(true);
      }

      return new Promise((resolve) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('entity_type', 'student');
        formData.append('entity_id', student.id);
        formData.append('org_id', orgId);
        if (definitionId) {
          formData.append('definition_id', definitionId);
        }
        if (customName) {
          formData.append('custom_name', customName);
        }
        if (relevantDate) {
          formData.append('relevant_date', relevantDate);
        }
        if (expirationDate) {
          formData.append('expiration_date', expirationDate);
        }

        const xhr = new XMLHttpRequest();

        // Track upload progress
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100);
            setBackgroundUploads(prev => 
              prev.map(u => u.id === uploadId ? { ...u, progress: percentComplete } : u)
            );
            toast.loading(`מעלה: ${file.name}...`, {
              id: toastId,
              description: `${percentComplete}%`,
            });
          }
        });

        // Handle completion
        xhr.addEventListener('load', async () => {
          setUploadingDefId(null);
          setUploadingAdhoc(false);
          setBackgroundUploads(prev => prev.filter(u => u.id !== uploadId));

          if (xhr.status >= 200 && xhr.status < 300) {
            toast.success(`הקובץ ${file.name} הועלה בהצלחה!`, {
              id: toastId,
            });

            // Refresh documents from hook only if student still exists
            if (student?.id) {
              await fetchDocuments();
            }
            
            // Also refresh parent if callback provided
            if (onRefresh) {
              await onRefresh();
            }
            resolve(true);
          } else {
            try {
              const errorData = JSON.parse(xhr.responseText);
              let errorMsg = 'העלאת הקובץ נכשלה';
              
              if (xhr.status === 401 || errorData.message === 'invalid_or_expired_token' || errorData.message === 'missing_bearer') {
                errorMsg = 'ההרשאה פגה במהלך ההעלאה';
                toast.error(errorMsg, { 
                  id: toastId,
                  duration: 5000,
                  action: {
                    label: 'רענן',
                    onClick: () => window.location.reload(),
                  },
                });
              } else if (errorData.message === 'file_too_large') {
                errorMsg = 'הקובץ גדול מדי (מקסימום 10MB)';
                toast.error(errorMsg, { id: toastId });
              } else if (errorData.message === 'invalid_file_type') {
                errorMsg = 'סוג קובץ לא נתמך';
                toast.error(errorMsg, { id: toastId });
              } else if (errorData.details) {
                errorMsg = errorData.details;
                toast.error(errorMsg, { id: toastId });
              } else {
                toast.error(errorMsg, { id: toastId });
              }
            } catch {
              if (xhr.status === 401) {
                toast.error('ההרשאה פגה במהלך ההעלאה', { 
                  id: toastId,
                  duration: 5000,
                  action: {
                    label: 'רענן',
                    onClick: () => window.location.reload(),
                  },
                });
              } else {
                toast.error(`העלאת הקובץ נכשלה (שגיאה ${xhr.status})`, { id: toastId });
              }
            }
            resolve(false);
          }
        });

        // Handle errors
        xhr.addEventListener('error', () => {
          setUploadingDefId(null);
          setUploadingAdhoc(false);
          setBackgroundUploads(prev => prev.filter(u => u.id !== uploadId));
          toast.error(`שגיאת רשת בהעלאת ${file.name}`, { id: toastId });
          resolve(false);
        });

        // Handle abort
        xhr.addEventListener('abort', () => {
          setUploadingDefId(null);
          setUploadingAdhoc(false);
          setBackgroundUploads(prev => prev.filter(u => u.id !== uploadId));
          toast.info(`העלאת ${file.name} בוטלה`, { id: toastId });
          resolve(false);
        });

        // Send request
        xhr.open('POST', '/api/documents');
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('X-Supabase-Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('x-supabase-authorization', `Bearer ${token}`);
        xhr.setRequestHeader('x-supabase-auth', `Bearer ${token}`);
        xhr.send(formData);
      });
    },
    [orgId, student?.id, onRefresh, checkForDuplicates, ALLOWED_TYPES, MAX_FILE_SIZE, fetchDocuments]
  );
  */

  /**
   * Bulk upload multiple files in a single HTTP request
   */
  const handleBulkFileUpload = useCallback(
    async (filesData, definitionId = null) => {
      if (!orgId || !student?.id || !filesData || filesData.length === 0) return;

      // Get fresh session token
      let token = session?.access_token;
      if (!token) {
        const authClient = getAuthClient();
        const { data, error } = await authClient.auth.getSession();
        if (error || !data?.session?.access_token) {
          toast.error('ההרשאה פגה. נא לרענן את הדף');
          return;
        }
        token = data.session.access_token;
      }

      // Generate upload ID for tracking
      const uploadId = crypto.randomUUID();
      const uploadInfo = {
        id: uploadId,
        fileName: `${filesData.length} קבצים`,
        definitionId,
        progress: 0,
        status: 'uploading',
      };

      setBackgroundUploads(prev => [...prev, uploadInfo]);

      const toastId = toast.loading(`מעלה ${filesData.length} קבצים...`, {
        description: '0%',
      });

      if (definitionId) {
        setUploadingDefId(definitionId);
      } else {
        setUploadingAdhoc(true);
      }

      return new Promise((resolve) => {
        const formData = new FormData();

        // Append all files and their metadata
        filesData.forEach(fileData => {
          formData.append('file', fileData.file);
          formData.append('custom_name', fileData.name);
          if (fileData.relevantDate) {
            formData.append('relevant_date', fileData.relevantDate);
          }
          if (fileData.expirationDate) {
            formData.append('expiration_date', fileData.expirationDate);
          }
        });

        // Append common metadata
        formData.append('entity_type', 'student');
        formData.append('entity_id', student.id);
        formData.append('org_id', orgId);
        if (definitionId) {
          formData.append('definition_id', definitionId);
        }

        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100);
            setBackgroundUploads(prev =>
              prev.map(u => u.id === uploadId ? { ...u, progress: percentComplete } : u)
            );
            toast.loading(`מעלה ${filesData.length} קבצים...`, {
              id: toastId,
              description: `${percentComplete}%`,
            });
          }
        });

        xhr.addEventListener('load', async () => {
          setUploadingDefId(null);
          setUploadingAdhoc(false);
          setBackgroundUploads(prev => prev.filter(u => u.id !== uploadId));

          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const result = JSON.parse(xhr.responseText);
              const summary = result.summary || { uploaded: result.file ? 1 : 0, failed: 0, total: 1 };

              if (summary.failed > 0) {
                toast.warning(`הועלו ${summary.uploaded} מתוך ${summary.total} קבצים`, {
                  id: toastId,
                  duration: 5000,
                  description: `${summary.failed} קבצים נכשלו`
                });
              } else {
                toast.success(`${summary.uploaded} קבצים הועלו בהצלחה!`, {
                  id: toastId,
                });
              }
            } catch {
              toast.success(`${filesData.length} קבצים הועלו בהצלחה!`, {
                id: toastId,
              });
            }

            if (student?.id) {
              await fetchDocuments();
            }
            if (onRefresh) {
              await onRefresh();
            }
            resolve(true);
          } else {
            try {
              const errorData = JSON.parse(xhr.responseText);
              toast.error(errorData.error || 'העלאת הקבצים נכשלה', { id: toastId });
            } catch {
              toast.error(`העלאת הקבצים נכשלה (שגיאה ${xhr.status})`, { id: toastId });
            }
            resolve(false);
          }
        });

        xhr.addEventListener('error', () => {
          setUploadingDefId(null);
          setUploadingAdhoc(false);
          setBackgroundUploads(prev => prev.filter(u => u.id !== uploadId));
          toast.error('שגיאת רשת בהעלאת הקבצים', { id: toastId });
          resolve(false);
        });

        xhr.addEventListener('abort', () => {
          setUploadingDefId(null);
          setUploadingAdhoc(false);
          setBackgroundUploads(prev => prev.filter(u => u.id !== uploadId));
          toast.info('העלאת הקבצים בוטלה', { id: toastId });
          resolve(false);
        });

        xhr.open('POST', '/api/documents');
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('X-Supabase-Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('x-supabase-authorization', `Bearer ${token}`);
        xhr.setRequestHeader('x-supabase-auth', `Bearer ${token}`);
        xhr.send(formData);
      });
    },
    [orgId, student?.id, session, onRefresh, fetchDocuments]
  );

  const handleFileDelete = useCallback(
    async (fileId) => {
      if (!session || !orgId) return;
      if (!confirm('האם למחוק קובץ זה? פעולה זו אינה ניתנת לביטול.')) return;

      const token = session.access_token;
      if (!token) {
        console.error('Session missing access_token');
        toast.error('שגיאת הרשאה. נא להתחבר מחדש');
        return;
      }

      setDeleteState(REQUEST_STATE.loading);

      try {
        const response = await fetch(`/api/documents/${fileId}?org_id=${orgId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Supabase-Authorization': `Bearer ${token}`,
            'x-supabase-authorization': `Bearer ${token}`,
            'x-supabase-auth': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Delete failed' }));
          throw new Error(errorData.error || 'Delete failed');
        }

        toast.success('הקובץ נמחק בהצלחה!');
        setDeleteState(REQUEST_STATE.idle);
        
        // Refresh documents from hook
        await fetchDocuments();
        
        // Also refresh parent if callback provided
        if (onRefresh) {
          await onRefresh();
        }
      } catch (error) {
        console.error('File delete failed', error);
        toast.error(`מחיקת הקובץ נכשלה: ${error?.message || 'שגיאה לא ידועה'}`);
        setDeleteState(REQUEST_STATE.error);
      }
    },
    [session, orgId, onRefresh, fetchDocuments]
  );

  const handleToggleResolved = useCallback(
    async (fileId, currentResolved) => {
      if (!session || !orgId) return;

      const token = session.access_token;
      if (!token) {
        console.error('Session missing access_token');
        toast.error('שגיאת הרשאה. נא להתחבר מחדש');
        return;
      }

      const newResolved = !currentResolved;
      const toastId = toast.loading(newResolved ? 'מסמן כטופל...' : 'מבטל סימון...');

      try {
        const response = await fetch(`/api/documents/${fileId}?org_id=${orgId}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Supabase-Authorization': `Bearer ${token}`,
            'x-supabase-authorization': `Bearer ${token}`,
            'x-supabase-auth': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            resolved: newResolved,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Update failed' }));
          throw new Error(errorData.error || 'Update failed');
        }

        toast.success(newResolved ? 'המסמך סומן כטופל!' : 'הסימון בוטל!', { id: toastId });
        
        // Refresh documents from hook
        await fetchDocuments();
        
        // Also refresh parent if callback provided
        if (onRefresh) {
          await onRefresh();
        }
      } catch (error) {
        console.error('Toggle resolved failed', error);
        toast.error(`עדכון המסמך נכשל: ${error?.message || 'שגיאה לא ידועה'}`, { id: toastId });
      }
    },
    [session, orgId, onRefresh, fetchDocuments]
  );

  const handleEditFile = useCallback(
    async ({ fileId, name, relevantDate, expirationDate }) => {
      if (!session || !orgId) return;

      const token = session.access_token;
      if (!token) {
        console.error('Session missing access_token');
        toast.error('שגיאת הרשאה. נא להתחבר מחדש');
        return;
      }

      const toastId = toast.loading('מעדכן מסמך...');

      try {
        const response = await fetch(`/api/documents/${fileId}?org_id=${orgId}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Supabase-Authorization': `Bearer ${token}`,
            'x-supabase-authorization': `Bearer ${token}`,
            'x-supabase-auth': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: name,
            relevant_date: relevantDate,
            expiration_date: expirationDate,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Update failed' }));
          throw new Error(errorData.error || 'Update failed');
        }

        toast.success('המסמך עודכן בהצלחה!', { id: toastId });
        setEditingFile(null);
        
        // Refresh documents from hook
        await fetchDocuments();
        
        // Also refresh parent if callback provided
        if (onRefresh) {
          await onRefresh();
        }
      } catch (error) {
        console.error('Edit file failed', error);
        toast.error(`עדכון המסמך נכשל: ${error?.message || 'שגיאה לא ידועה'}`, { id: toastId });
      }
    },
    [session, orgId, onRefresh, fetchDocuments]
  );

  const handleFileDownload = useCallback(
    async (fileId) => {
      if (!session || !orgId) return;

      const token = session.access_token;
      if (!token) {
        toast.error('שגיאת הרשאה. נא להתחבר מחדש');
        return;
      }

      const toastId = toast.loading('מכין להורדה...');

      try {
        // Get download URL
        const response = await fetch(
          `/api/documents-download?document_id=${encodeURIComponent(fileId)}&org_id=${encodeURIComponent(orgId)}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'X-Supabase-Authorization': `Bearer ${token}`,
              'x-supabase-authorization': `Bearer ${token}`,
              'x-supabase-auth': `Bearer ${token}`,
            },
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to get download URL');
        }

        const { url } = await response.json();
        window.location.href = url; // Navigate to URL to trigger download
        
        toast.success('קובץ הורד בהצלחה', { id: toastId });
      } catch (error) {
        console.error('File download failed', error);
        toast.error(`הורדת הקובץ נכשלה: ${error?.message || 'שגיאה לא ידועה'}`, { id: toastId });
      }
    },
    [session, orgId]
  );

  const handleFilePreview = useCallback(
    async (fileId) => {
      if (!session || !orgId) return;

      const token = session.access_token;
      if (!token) {
        toast.error('שגיאת הרשאה. נא להתחבר מחדש');
        return;
      }

      try {
        // Get presigned preview URL from polymorphic documents endpoint
        const response = await fetch(
          `/api/documents-download?document_id=${encodeURIComponent(fileId)}&org_id=${encodeURIComponent(orgId)}&preview=true`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'X-Supabase-Authorization': `Bearer ${token}`,
              'x-supabase-authorization': `Bearer ${token}`,
              'x-supabase-auth': `Bearer ${token}`,
            },
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || errorData.message || 'Failed to get preview URL');
        }

        const { url, contentType } = await response.json();
        
        // For supported preview types, open in iframe or new tab
        const previewableTypes = [
          'application/pdf',
          'image/jpeg',
          'image/jpg', 
          'image/png',
          'image/gif',
        ];

        if (previewableTypes.some(type => contentType?.includes(type))) {
          // Open in new window for preview (browser will render it)
          const previewWindow = window.open(url, '_blank');
          if (!previewWindow) {
            toast.error('נא לאפשר חלונות קופצים כדי לצפות בקובץ');
          }
        } else {
          // For non-previewable types, show message
          toast.info('תצוגה מקדימה זמינה רק עבור PDF ותמונות');
        }
      } catch (error) {
        console.error('File preview failed', error);
        toast.error(`תצוגה מקדימה נכשלה: ${error?.message || 'שגיאה לא ידועה'}`);
      }
    },
    [session, orgId]
  );

  const handleFileInputChange = useCallback(
    async (event, definitionId = null) => {
      const files = Array.from(event.target.files || []);
      if (files.length === 0) return;

      // Validate all files
      for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
          toast.error(`הקובץ "${file.name}" גדול מדי. גודל מקסימלי: 10MB`);
          event.target.value = '';
          return;
        }
        if (!ALLOWED_TYPES.includes(file.type)) {
          toast.error(`סוג הקובץ "${file.name}" לא נתמך. קבצים מותרים: PDF, תמונות, Word, Excel`);
          event.target.value = '';
          return;
        }
      }

      // Check each file for duplicates
      const duplicateResults = await Promise.all(
        files.map(async (file) => {
          const result = await checkForDuplicates(file);
          return {
            file,
            hasDuplicates: result.has_duplicates,
            duplicates: result.duplicates || []
          };
        })
      );

      // Find files with duplicates
      const filesWithDuplicates = duplicateResults.filter(r => r.hasDuplicates);

      // If any files have duplicates, show confirmation
      if (filesWithDuplicates.length > 0) {
        const duplicateInfo = filesWithDuplicates.map(r => {
          const studentNames = r.duplicates
            .map(d => `${d.student_name} (${new Date(d.uploaded_at).toLocaleDateString('he-IL')})`)
            .join(', ');
          return `${r.file.name}: ${studentNames}`;
        }).join('\n');

        const confirmed = await new Promise((resolve) => {
          toast.warning(
            `${filesWithDuplicates.length} קבצים כבר קיימים במערכת`,
            {
              description: duplicateInfo,
              action: {
                label: 'כן, העלה בכל זאת',
                onClick: () => resolve(true),
              },
              cancel: {
                label: 'ביטול',
                onClick: () => resolve(false),
              },
              duration: 15000,
            }
          );
        });

        if (!confirmed) {
          event.target.value = '';
          return;
        }
      }

      // Show pre-upload dialog with all files
      const filesWithMetadata = files.map(file => ({
        file,
        name: definitionId ? file.name.replace(/\.[^.]+$/, '') : file.name.replace(/\.[^.]+$/, ''),
        relevantDate: '',
        expirationDate: ''
      }));
      setPendingFiles(filesWithMetadata);
      setPendingDefinitionId(definitionId);

      // Reset input
      event.target.value = '';
    },
    [MAX_FILE_SIZE, ALLOWED_TYPES, checkForDuplicates]
  );

  // Handle upload confirmation from pre-upload dialog
  const handleUploadConfirm = useCallback(
    async (filesData) => {
      if (!filesData || filesData.length === 0) return;

      setPendingFiles([]);
      setPendingDefinitionId(null);

      // Upload all files in a single request
      await handleBulkFileUpload(filesData, pendingDefinitionId);
    },
    [handleBulkFileUpload, pendingDefinitionId]
  );

  // Handle dialog cancel
  const handleUploadCancel = useCallback(() => {
    setPendingFiles([]);
    setPendingDefinitionId(null);
  }, []);

  // Get definition name for pending file
  const pendingDefinitionName = useMemo(() => {
    if (!pendingDefinitionId) return null;
    const def = definitions.find(d => d.id === pendingDefinitionId);
    return def?.name || null;
  }, [pendingDefinitionId, definitions]);

  // Get file for definition
  const getFileForDef = (defId) => {
    return studentFiles.find((f) => f.definition_id === defId);
  };

  // Get adhoc files (no definition_id OR orphaned - definition was deleted)
  const adhocFiles = studentFiles.filter((f) => {
    if (!f.definition_id) return true;
    // Include files whose definition no longer exists in ANY definitions list (truly deleted)
    return !definitions.find(def => def.id === f.definition_id);
  });

  // Sort adhoc files based on current sort settings
  const sortedAdhocFiles = useMemo(() => {
    const sorted = [...adhocFiles];
    
    sorted.sort((a, b) => {
      let comparison = 0;
      
      if (sortBy === 'date') {
        // Sort by uploaded_at date
        const dateA = a.uploaded_at ? new Date(a.uploaded_at).getTime() : 0;
        const dateB = b.uploaded_at ? new Date(b.uploaded_at).getTime() : 0;
        comparison = dateA - dateB;
      } else if (sortBy === 'name') {
        // Sort by file name (handle orphaned files with definition_name)
        const nameA = (a.definition_name && !definitions.find(def => def.id === a.definition_id))
          ? `${a.definition_name} - ${student?.name || ''}`
          : (a.name || '');
        const nameB = (b.definition_name && !definitions.find(def => def.id === b.definition_id))
          ? `${b.definition_name} - ${student?.name || ''}`
          : (b.name || '');
        comparison = nameA.localeCompare(nameB, 'he');
      }
      
      return sortOrder === 'asc' ? comparison : -comparison;
    });
    
    return sorted;
  }, [adhocFiles, sortBy, sortOrder, definitions, student?.name]);

  // Toggle sort order
  const toggleSortOrder = useCallback(() => {
    setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
  }, []);

  // Change sort field
  const changeSortBy = useCallback((newSortBy) => {
    if (newSortBy === sortBy) {
      toggleSortOrder();
    } else {
      setSortBy(newSortBy);
      setSortOrder('desc'); // Default to descending when changing sort field
    }
  }, [sortBy, toggleSortOrder]);

  // Helper to check if a file is orphaned (definition was truly deleted)
  const isOrphanedFile = (file) => {
    return file.definition_id && !definitions.find(def => def.id === file.definition_id);
  };

  // Get definition name for a file (current name if definition exists, stored name if orphaned)
  const _getDefinitionNameForFile = (file) => {
    if (!file.definition_id) return null;
    const currentDef = definitions.find(def => def.id === file.definition_id);
    return currentDef?.name || file.definition_name || null;
  };
  void _getDefinitionNameForFile; // Mark as intentionally unused

  return (
    <>
      <BulkPreUploadDialog
        files={pendingFiles}
        definitionName={pendingDefinitionName}
        onConfirm={handleUploadConfirm}
        onCancel={handleUploadCancel}
      />

      <EditFileDialog
        file={editingFile}
        onConfirm={handleEditFile}
        onCancel={() => setEditingFile(null)}
      />

      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card dir="rtl" className="border-slate-200">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-slate-50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-amber-600" />
                <CardTitle className="text-lg font-semibold">מסמכים וקבצים</CardTitle>
                {hasMissingMandatory && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertCircle className="h-3 w-3" />
                    חסרים מסמכים
                  </Badge>
                )}
              </div>
              <Button variant="ghost" size="sm">
                {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-6 pt-4">
            {/* Background Upload Indicator */}
            {backgroundUploads.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2" dir="rtl">
                <div className="flex items-center gap-2 text-sm font-medium text-blue-900">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  מעלה {backgroundUploads.length} קבצים ברקע
                </div>
                {backgroundUploads.map(upload => (
                  <div key={upload.id} className="text-xs text-blue-800">
                    <div className="flex items-center justify-between mb-1">
                      <span>{upload.fileName}</span>
                      <span>{upload.progress}%</span>
                    </div>
                    <div className="w-full bg-blue-200 rounded-full h-1.5">
                      <div 
                        className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${upload.progress}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {loadState === REQUEST_STATE.loading && (
              <div className="text-center py-8">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-slate-400" />
                <p className="text-sm text-slate-600">טוען מסמכים...</p>
              </div>
            )}

            {loadState === REQUEST_STATE.idle && (
              <>
                {/* Upload Guidelines */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-right" dir="rtl">
                  <h4 className="font-semibold text-blue-900 mb-2">הנחיות העלאת קבצים</h4>
                  <ul className="space-y-1 text-blue-800">
                    <li>• גודל מקסימלי: 10MB</li>
                    <li>• סוגי קבצים מותרים: PDF, תמונות (JPG, PNG, GIF), Word, Excel</li>
                    <li>• שמות קבצים בעברית נתמכים</li>
                  </ul>
                </div>

                {/* Required Documents */}
                {relevantDefinitions.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="font-semibold text-slate-900">מסמכים נדרשים</h3>
                    <div className="space-y-2">
                      {relevantDefinitions.map((def) => {
                        const file = getFileForDef(def.id);
                        const isUploading = uploadingDefId === def.id;

                        return (
                          <div
                            key={def.id}
                            className={`p-4 border rounded-lg ${
                              file ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/30'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  {file && canDownloadFiles ? (
                                    <button
                                      onClick={() => handleFilePreview(file.id)}
                                      className="font-medium text-blue-600 hover:text-blue-800 hover:underline cursor-pointer text-right"
                                    >
                                      {def.name}
                                    </button>
                                  ) : (
                                    <span className="font-medium">{def.name}</span>
                                  )}
                                  {def.is_mandatory && (
                                    <Badge variant="destructive" className="text-xs">
                                      חובה
                                    </Badge>
                                  )}
                                  {file && (
                                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                  )}
                                </div>
                                {file && (
                                  <div className="text-sm text-slate-600">
                                    הועלה: {formatFileDate(file.uploaded_at)} • <span dir="ltr">{formatFileSize(file.size)}</span>
                                    {file.relevant_date && (
                                      <>
                                        {' • '}
                                        <span className="inline-flex items-center gap-1">
                                          <Calendar className="h-3 w-3" />
                                          {format(parseISO(file.relevant_date), 'dd/MM/yyyy')}
                                        </span>
                                      </>
                                    )}
                                    {file.expiration_date && (
                                      <>
                                        {' • '}
                                        <span className={`inline-flex items-center gap-1 ${
                                          file.resolved ? 'text-green-600 font-medium' : 
                                          isExpired(file.expiration_date) ? 'text-red-600 font-medium' : ''
                                        }`}>
                                          <CalendarX className="h-3 w-3" />
                                          {format(parseISO(file.expiration_date), 'dd/MM/yyyy')}
                                          {file.resolved ? (
                                            <Badge variant="outline" className="text-xs mr-1 bg-green-50 text-green-700 border-green-300">
                                              <CheckCircle className="h-3 w-3 ml-1" />
                                              טופל
                                            </Badge>
                                          ) : isExpired(file.expiration_date) ? (
                                            <Badge variant="destructive" className="text-xs mr-1">
                                              פג תוקף
                                            </Badge>
                                          ) : null}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="flex gap-2">
                                {file ? (
                                  <>
                                    {canDownloadFiles ? (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleFileDownload(file.id)}
                                      >
                                        <Download className="h-4 w-4" />
                                        הורד
                                      </Button>
                                    ) : (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleFilePreview(file.id)}
                                      >
                                        <Eye className="h-4 w-4" />
                                        תצוגה מקדימה
                                      </Button>
                                    )}
                                    {file.expiration_date && (
                                      <Button
                                        size="sm"
                                        variant={file.resolved ? "outline" : "default"}
                                        onClick={() => handleToggleResolved(file.id, file.resolved)}
                                        className={file.resolved ? "" : "bg-green-600 hover:bg-green-700 text-white"}
                                      >
                                        {file.resolved ? (
                                          <>
                                            <CheckCircle2 className="h-4 w-4" />
                                            בטל סימון
                                          </>
                                        ) : (
                                          <>
                                            <CheckCircle2 className="h-4 w-4" />
                                            סמן כטופל
                                          </>
                                        )}
                                      </Button>
                                    )}
                                    {canDeleteFiles && (
                                      <>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => setEditingFile(file)}
                                        >
                                          <Edit className="h-4 w-4" />
                                          ערוך
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => handleFileDelete(file.id)}
                                          disabled={deleteState === REQUEST_STATE.loading}
                                        >
                                          <Trash2 className="h-4 w-4 text-red-500" />
                                        </Button>
                                      </>
                                    )}
                                  </>
                                ) : (
                                  <div className="relative">
                                    <input
                                      type="file"
                                      id={`upload-${def.id}`}
                                      className="sr-only"
                                      multiple
                                      onChange={(e) => handleFileInputChange(e, def.id)}
                                      disabled={isUploading}
                                    />
                                    <Button
                                      size="sm"
                                      onClick={() => document.getElementById(`upload-${def.id}`)?.click()}
                                      disabled={isUploading}
                                      className="gap-2"
                                    >
                                      {isUploading ? (
                                        <>
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                          מעלה...
                                        </>
                                      ) : (
                                        <>
                                          <Upload className="h-4 w-4" />
                                          העלאה
                                        </>
                                      )}
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Adhoc Files */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-slate-900">קבצים נוספים</h3>
                    {adhocFiles.length > 0 && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant={sortBy === 'name' ? 'default' : 'outline'}
                          onClick={() => changeSortBy('name')}
                          className="gap-1"
                        >
                          {sortBy === 'name' && sortOrder === 'asc' && <ArrowUp className="h-3 w-3" />}
                          {sortBy === 'name' && sortOrder === 'desc' && <ArrowDown className="h-3 w-3" />}
                          {sortBy !== 'name' && <ArrowUpDown className="h-3 w-3" />}
                          שם
                        </Button>
                        <Button
                          size="sm"
                          variant={sortBy === 'date' ? 'default' : 'outline'}
                          onClick={() => changeSortBy('date')}
                          className="gap-1"
                        >
                          {sortBy === 'date' && sortOrder === 'asc' && <ArrowUp className="h-3 w-3" />}
                          {sortBy === 'date' && sortOrder === 'desc' && <ArrowDown className="h-3 w-3" />}
                          {sortBy !== 'date' && <ArrowUpDown className="h-3 w-3" />}
                          תאריך
                        </Button>
                      </div>
                    )}
                  </div>
                  {adhocFiles.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4 text-center">אין קבצים נוספים</p>
                  ) : (
                    <div className="space-y-2">
                      {sortedAdhocFiles.map((file) => {
                        const isOrphaned = isOrphanedFile(file);
                        // For orphaned files, use stored definition_name; otherwise use current file name
                        const displayName = isOrphaned && file.definition_name 
                          ? `${file.definition_name} - ${student?.name || 'תלמיד'}`
                          : file.name;
                        
                        return (
                          <div key={file.id} className={`p-4 border rounded-lg ${isOrphaned ? 'border-amber-300 bg-amber-50/30' : 'border-slate-200 bg-white'}`}>
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  {canDownloadFiles ? (
                                    <button
                                      onClick={() => handleFilePreview(file.id)}
                                      className="font-medium text-blue-600 hover:text-blue-800 hover:underline cursor-pointer text-right"
                                    >
                                      {displayName}
                                    </button>
                                  ) : (
                                    <span className="font-medium">{displayName}</span>
                                  )}
                                  {isOrphaned && (
                                    <Badge variant="outline" className="text-xs text-amber-700 border-amber-400">
                                      הגדרה ישנה
                                    </Badge>
                                  )}
                                </div>
                                {isOrphaned && file.original_name && (
                                  <div className="text-xs text-amber-700 mb-1">
                                    קובץ מקורי: {file.original_name}
                                  </div>
                                )}
                                <div className="text-sm text-slate-600">
                                  הועלה: {formatFileDate(file.uploaded_at)} • <span dir="ltr">{formatFileSize(file.size)}</span>
                                  {file.relevant_date && (
                                    <>
                                      {' • '}
                                      <span className="inline-flex items-center gap-1">
                                        <Calendar className="h-3 w-3" />
                                        {format(parseISO(file.relevant_date), 'dd/MM/yyyy')}
                                      </span>
                                    </>
                                  )}
                                  {file.expiration_date && (
                                    <>
                                      {' • '}
                                      <span className={`inline-flex items-center gap-1 ${
                                        file.resolved ? 'text-green-600 font-medium' : 
                                        isExpired(file.expiration_date) ? 'text-red-600 font-medium' : ''
                                      }`}>
                                        <CalendarX className="h-3 w-3" />
                                        {format(parseISO(file.expiration_date), 'dd/MM/yyyy')}
                                        {file.resolved ? (
                                          <Badge variant="outline" className="text-xs mr-1 bg-green-50 text-green-700 border-green-300">
                                            <CheckCircle className="h-3 w-3 ml-1" />
                                            טופל
                                          </Badge>
                                        ) : isExpired(file.expiration_date) ? (
                                          <Badge variant="destructive" className="text-xs mr-1">
                                            פג תוקף
                                          </Badge>
                                        ) : null}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            <div className="flex gap-2">
                              {canDownloadFiles ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleFileDownload(file.id)}
                                >
                                  <Download className="h-4 w-4" />
                                  הורד
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleFilePreview(file.id)}
                                >
                                  <Eye className="h-4 w-4" />
                                  תצוגה מקדימה
                                </Button>
                              )}
                              {file.expiration_date && (
                                <Button
                                  size="sm"
                                  variant={file.resolved ? "outline" : "default"}
                                  onClick={() => handleToggleResolved(file.id, file.resolved)}
                                  className={file.resolved ? "" : "bg-green-600 hover:bg-green-700 text-white"}
                                >
                                  {file.resolved ? (
                                    <>
                                      <CheckCircle2 className="h-4 w-4" />
                                      בטל סימון
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle2 className="h-4 w-4" />
                                      סמן כטופל
                                    </>
                                  )}
                                </Button>
                              )}
                              {canDeleteFiles && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setEditingFile(file)}
                                  >
                                    <Edit className="h-4 w-4" />
                                    ערוך
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleFileDelete(file.id)}
                                    disabled={deleteState === REQUEST_STATE.loading}
                                  >
                                    <Trash2 className="h-4 w-4 text-red-500" />
                                  </Button>
                                </>
                              )}
                            </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Upload Adhoc Files */}
                  <div className="pt-2">
                    <div className="relative">
                      <input
                        type="file"
                        id="upload-adhoc"
                        className="sr-only"
                        multiple
                        onChange={(e) => handleFileInputChange(e)}
                        disabled={uploadingAdhoc}
                      />
                      <Button
                        variant="outline"
                        onClick={() => document.getElementById('upload-adhoc')?.click()}
                        disabled={uploadingAdhoc}
                        className="w-full gap-2"
                      >
                        {uploadingAdhoc ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            מעלה קבצים...
                          </>
                        ) : (
                          <>
                            <Upload className="h-4 w-4" />
                            העלאת קבצים נוספים
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
    </>
  );
}
