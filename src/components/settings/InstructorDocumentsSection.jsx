import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { FileText, Upload, Download, Trash2, Loader2, AlertCircle, CheckCircle, CheckCircle2, ArrowUpDown, ArrowUp, ArrowDown, Calendar, CalendarX, Edit } from 'lucide-react';
import { fetchSettingsValue } from '@/features/settings/api/settings.js';
import { format, parseISO, isBefore, startOfDay } from 'date-fns';
import { he } from 'date-fns/locale';
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
function _isExpired(expirationDate) {
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
              תאריך תפוגת המסמך (אופציונלי)
            </p>
          </div>
        </div>

        <div className="flex gap-2 justify-end" dir="rtl">
          <Button variant="outline" onClick={onCancel}>
            ביטול
          </Button>
          <Button onClick={handleConfirm} disabled={!name.trim()}>
            אישור והעלאה
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function InstructorDocumentsSection({ instructor, session, orgId, onRefresh, isOwnDocuments = false }) {
  // Trust boundary: Non-admin users can only view their own documents
  // When isOwnDocuments=true, enforce that instructor.id matches authenticated user
  const { session: authSession } = useAuth();
  const { activeOrg } = useOrg();
  const isAdmin = ['admin', 'owner'].includes(activeOrg?.membership?.role);
  
  // Security check: If not admin and isOwnDocuments=true, verify instructor.id matches user.id
  const effectiveInstructorId = React.useMemo(() => {
    if (isOwnDocuments && !isAdmin && authSession?.user?.id) {
      // Force use of authenticated user's ID for non-admin self-service
      return authSession.user.id;
    }
    return instructor.id;
  }, [isOwnDocuments, isAdmin, authSession?.user?.id, instructor.id]);
  
  // Use polymorphic Documents table hook for fetching documents
  const {
    documents,
    fetchDocuments
  } = useDocuments('instructor', effectiveInstructorId);

  const [definitions, setDefinitions] = useState([]);
  const [uploadingDefId] = useState(null);
  const [uploadingAdhoc] = useState(false);
  const [deleteState, setDeleteState] = useState(REQUEST_STATE.idle);
  const [backgroundUploads, setBackgroundUploads] = useState([]);
  const [sortBy, setSortBy] = useState('date'); // 'date' | 'name'
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc' | 'desc'
  const [pendingFiles, setPendingFiles] = useState([]); // Changed to array for bulk upload
  const [pendingDefinitionId, setPendingDefinitionId] = useState(null)
  const [editingFile, setEditingFile] = useState(null); // File being edited post-upload

  // Use documents from hook instead of instructor.files prop
  const instructorFiles = documents;
  const instructorTypes = Array.isArray(instructor?.instructor_types) ? instructor.instructor_types : [];
  
  // Filter definitions to show only those relevant to this instructor's types
  const relevantDefinitions = definitions.filter(def => {
    // If definition has no target_instructor_types, it applies to all instructors
    if (!def.target_instructor_types || def.target_instructor_types.length === 0) return true;
    
    // If instructor has no types, only show definitions with no target_instructor_types
    if (instructorTypes.length === 0) return false;
    
    // Show definition if instructor has ANY matching type
    return def.target_instructor_types.some(targetType => instructorTypes.includes(targetType));
  });

  // File upload restrictions
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
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
      try {
        const { value } = await fetchSettingsValue({
          session,
          orgId,
          key: 'instructor_document_definitions',
        });

        const parsed = Array.isArray(value) ? value : [];
        setDefinitions(parsed);
      } catch (error) {
        console.error('Failed to load instructor document definitions:', error);
        toast.error('טעינת הגדרות מסמכים נכשלה');
      }
    };

    loadDefinitions();
  }, [session, orgId]);

  const checkForDuplicates = useCallback(
    async (file) => {
      if (!session || !orgId || !instructor) return { has_duplicates: false, duplicates: [] };

      const token = session.access_token;
      if (!token) {
        console.error('Session missing access_token', session);
        toast.error('שגיאת הרשאה. נא להתחבר מחדש');
        return { has_duplicates: false, duplicates: [] };
      }

      try {
        const result = await checkDocumentDuplicate({
          entityType: 'instructor',
          entityId: instructor.id,
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
        } else if (errorMessage.includes('403') || errorMessage.includes('can_only_check_own')) {
          toast.error('ניתן לבדוק רק קבצים ששייכים לך');
        } else if (errorMessage.includes('500')) {
          toast.error('שגיאת שרת בעת בדיקת כפליות');
        } else if (!errorMessage.includes('AbortError')) {
          console.warn('Duplicate check error details:', error);
        }
        return { has_duplicates: false, duplicates: [] };
      }
    },
    [session, orgId, instructor]
  );

  const handleFileUpload = useCallback(async (file, definitionId = null, customName = null, relevantDate = null, expirationDate = null) => {
    if (!file) return;

    const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
    const ALLOWED_MIME_TYPES = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    // Validate file
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error(`הקובץ גדול מדי. גודל מקסימלי: ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`);
      return;
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      toast.error('סוג קובץ לא נתמך. קבצים מותרים: PDF, תמונות, Word, Excel');
      return;
    }

    const uploadId = crypto.randomUUID();
    
    // Use custom name or definition name for display
    const displayName = customName || file.name;
    
    // Add to background uploads
    setBackgroundUploads(prev => [...prev, {
              id: uploadId,
              filename: displayName,
              definitionName: null,
              progress: 0,
            }]);

            // Show loading toast
            const toastId = toast.loading(`מעלה ${file.name}...`, {
              description: '0%',
            });

            try {
              // Get fresh session token right before upload
              let token;
              try {
                const authClient = getAuthClient();
                const { data, error } = await authClient.auth.getSession();
                
                if (error || !data?.session?.access_token) {
                  console.error('Failed to get fresh session:', error);
                  toast.error('ההרשאה פגה. נא לרענן את הדף ולהתחבר מחדש', {
                    id: toastId,
                    duration: 5000,
                    action: {
                      label: 'רענן',
                      onClick: () => window.location.reload(),
                    },
                  });
                  setBackgroundUploads(prev => prev.filter(u => u.id !== uploadId));
                  return;
                }
                
                token = data.session.access_token;
              } catch (error) {
                console.error('Session refresh error:', error);
                toast.error('שגיאה בקבלת הרשאה. נא לרענן את הדף', {
                  id: toastId,
                  duration: 5000,
                  action: {
                    label: 'רענן',
                    onClick: () => window.location.reload(),
                  },
                });
                setBackgroundUploads(prev => prev.filter(u => u.id !== uploadId));
                return;
              }

              const formData = new FormData();
              formData.append('file', file);
              formData.append('org_id', orgId);
              formData.append('entity_type', 'instructor');
              formData.append('entity_id', instructor.id);
              if (definitionId) {
                formData.append('definition_id', definitionId);
                formData.append('definition_name', customName);
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

              // Use XMLHttpRequest for upload progress
              await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();

                xhr.upload.addEventListener('progress', (e) => {
                  if (e.lengthComputable) {
                    const percentComplete = Math.round((e.loaded / e.total) * 100);
                    setBackgroundUploads(prev => prev.map(u => 
                      u.id === uploadId ? { ...u, progress: percentComplete } : u
                    ));
                    toast.loading(`מעלה ${file.name}...`, {
                      id: toastId,
                      description: `${percentComplete}%`,
                    });
                  }
                });        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            let errorMessage = xhr.statusText || 'Upload failed';
            try {
              const errorData = JSON.parse(xhr.responseText);
              if (errorData.message) {
                errorMessage = errorData.message;
              }
              if (errorData.details) {
                errorMessage += `: ${errorData.details}`;
              }
              
              // Check for auth errors
              if (xhr.status === 401 || errorData.message === 'invalid_or_expired_token' || errorData.message === 'missing_bearer') {
                errorMessage = 'ההרשאה פגה במהלך ההעלאה';
              }
            } catch {
              // Use default error message
              if (xhr.status === 401) {
                errorMessage = 'ההרשאה פגה במהלך ההעלאה';
              }
            }
            console.error('Upload error response:', xhr.status, xhr.responseText);
            reject(new Error(errorMessage));
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Network error')));
        xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

        xhr.open('POST', '/api/documents');
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('X-Supabase-Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('x-supabase-authorization', `Bearer ${token}`);
        xhr.setRequestHeader('x-supabase-auth', `Bearer ${token}`);

        xhr.send(formData);
      });

      toast.success('הקובץ הועלה בהצלחה', { id: toastId });
      
      // Remove from background uploads
      setBackgroundUploads(prev => prev.filter(u => u.id !== uploadId));

      // Refresh documents from hook
      await fetchDocuments();

      if (onRefresh) {
        await onRefresh();
      }
    } catch (error) {
      console.error('File upload failed:', error);
      const errorMessage = error.message || 'העלאת הקובץ נכשלה';
      toast.error(errorMessage, { id: toastId });
      
      // Remove from background uploads on error
      setBackgroundUploads(prev => prev.filter(u => u.id !== uploadId));
    }
  }, [instructor, orgId, onRefresh, fetchDocuments]);

  const handleDeleteFile = useCallback(async (fileId) => {
    if (!confirm('האם למחוק את הקובץ? פעולה זו בלתי הפיכה.')) {
      return;
    }

    setDeleteState(REQUEST_STATE.loading);
    const toastId = toast.loading('מוחק קובץ...');

    try {
      const token = session.access_token;
      if (!token) {
        throw new Error('Missing auth token');
      }

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

      toast.success('הקובץ נמחק בהצלחה', { id: toastId });
      setDeleteState(REQUEST_STATE.idle);

      // Refresh documents from hook
      await fetchDocuments();

      if (onRefresh) {
        await onRefresh();
      }
    } catch (error) {
      console.error('File delete failed:', error);
      toast.error('מחיקת הקובץ נכשלה', { id: toastId });
      setDeleteState(REQUEST_STATE.idle);
    }
  }, [session, orgId, onRefresh, fetchDocuments]);

  const handleDownloadFile = useCallback(async (file) => {
    const toastId = toast.loading('מכין קובץ להורדה...');

    try {
      const token = session.access_token;
      if (!token) {
        throw new Error('Missing auth token');
      }

      const response = await fetch(
        `/api/documents-download?document_id=${encodeURIComponent(file.id)}&org_id=${encodeURIComponent(orgId)}`,
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
      window.location.href = url;
      toast.success('קובץ הורד בהצלחה', { id: toastId });
    } catch (error) {
      console.error('File download failed:', error);
      toast.error('הורדת הקובץ נכשלה', { id: toastId });
    }
  }, [session, orgId]);

  const handleToggleResolved = useCallback(async (fileId, currentResolved) => {
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
      
      // Refresh instructor data
      if (onRefresh) {
        await onRefresh();
      }
    } catch (error) {
      console.error('Toggle resolved failed', error);
      toast.error(`עדכון המסמך נכשל: ${error?.message || 'שגיאה לא ידועה'}`, { id: toastId });
    }
  }, [session, orgId, onRefresh, fetchDocuments]);

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
        
        // Refresh instructor data
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

  // Group files by definition
  const filesByDefinition = useMemo(() => {
    const grouped = {};
    instructorFiles.forEach(file => {
      if (file.definition_id) {
        if (!grouped[file.definition_id]) {
          grouped[file.definition_id] = [];
        }
        grouped[file.definition_id].push(file);
      }
    });
    return grouped;
  }, [instructorFiles]);

  const adhocFiles = useMemo(() => {
    const files = [];
    instructorFiles.forEach(file => {
      if (!file.definition_id) {
        files.push(file);
      }
    });
    return files;
  }, [instructorFiles]);

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
        // Sort by file name
        const nameA = a.name || '';
        const nameB = b.name || '';
        comparison = nameA.localeCompare(nameB, 'he');
      }
      
      return sortOrder === 'asc' ? comparison : -comparison;
    });
    
    return sorted;
  }, [adhocFiles, sortBy, sortOrder]);

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

  // Check if definition still exists
  const getDefinitionById = (defId) => {
    return definitions.find(d => d.id === defId);
  };

  // Handler for file input change - shows dialog before uploading
  const handleFileInputChange = useCallback(async (files, definitionId = null) => {
    if (!files || files.length === 0) return;
    
    // Validate all files
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`הקובץ "${file.name}" גדול מדי. גודל מקסימלי: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
        return;
      }
      
      if (!ALLOWED_TYPES.includes(file.type)) {
        toast.error(`סוג הקובץ "${file.name}" לא נתמך. קבצים מותרים: PDF, תמונות, Word, Excel`);
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
        const instructorNames = r.duplicates
          .map(d => `${d.instructor_name} (${new Date(d.uploaded_at).toLocaleDateString('he-IL')})`)
          .join(', ');
        return `${r.file.name}: ${instructorNames}`;
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
        return;
      }
    }
    
    // Show dialog for metadata input
    const filesWithMetadata = files.map(file => ({
      file,
      name: definitionId ? file.name.replace(/\.[^.]+$/, '') : file.name.replace(/\.[^.]+$/, ''),
      relevantDate: '',
      expirationDate: ''
    }));
    setPendingFiles(filesWithMetadata);
    setPendingDefinitionId(definitionId);
  }, [MAX_FILE_SIZE, ALLOWED_TYPES, checkForDuplicates]);

  // Handler for upload confirmation from dialog
  const handleUploadConfirm = useCallback(async (filesData) => {
    const definitionId = pendingDefinitionId;
    setPendingFiles([]);
    setPendingDefinitionId(null);
    
    // Upload each file sequentially (can be parallelized if needed)
    for (const fileData of filesData) {
      await handleFileUpload(fileData.file, definitionId, fileData.name, fileData.relevantDate, fileData.expirationDate);
    }
  }, [pendingDefinitionId, handleFileUpload]);

  // Handler for upload cancellation
  const handleUploadCancel = useCallback(() => {
    setPendingFiles([]);
    setPendingDefinitionId(null);
  }, []);

  // Get definition name for pending upload
  const pendingDefinitionName = useMemo(() => {
    if (!pendingDefinitionId) return null;
    const def = definitions.find(d => d.id === pendingDefinitionId);
    return def?.name || null;
  }, [pendingDefinitionId, definitions]);

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
      
      <div className="space-y-4" dir="rtl">
      {/* Upload progress indicator */}
      {backgroundUploads.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2 text-blue-700 font-medium">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>העלאת קבצים בתהליך...</span>
          </div>
          {backgroundUploads.map(upload => (
            <div key={upload.id} className="text-sm">
              <div className="flex justify-between items-center mb-1">
                <span className="text-slate-700">
                  {upload.definitionName || upload.filename}
                </span>
                <span className="text-blue-600 font-medium">{upload.progress}%</span>
              </div>
              <div className="w-full bg-blue-100 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${upload.progress}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* File restrictions info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">הנחיות העלאת קבצים:</p>
            <ul className="list-disc list-inside space-y-0.5 text-xs">
              <li>גודל מקסימלי: 10MB</li>
              <li>סוגי קבצים מותרים: PDF, תמונות (JPG, PNG, GIF), Word, Excel</li>
              <li>שמות קבצים בעברית נתמכים</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Required Documents */}
      {relevantDefinitions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 justify-end">
              <span>מסמכים נדרשים</span>
              <FileText className="h-5 w-5" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {relevantDefinitions.map(def => {
              const defFiles = filesByDefinition[def.id] || [];
              const hasFile = defFiles.length > 0;

              return (
                <div key={def.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {hasFile ? (
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-amber-600" />
                      )}
                      <span className="font-medium">{def.name}</span>
                      {def.is_mandatory && (
                        <Badge variant="destructive" className="text-xs">חובה</Badge>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {uploadingDefId === def.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.multiple = true;
                            input.accept = ALLOWED_TYPES.join(',');
                            input.onchange = (e) => {
                              const files = Array.from(e.target.files || []);
                              handleFileInputChange(files, def.id);
                            };
                            input.click();
                          }}
                          disabled={uploadingDefId !== null}
                          className="gap-2"
                        >
                          <Upload className="h-4 w-4" />
                          העלאה
                        </Button>
                      )}
                    </div>
                  </div>

                  {def.description && (
                    <p className="text-sm text-muted-foreground text-right">
                      {def.description}
                    </p>
                  )}

                  {/* Uploaded files for this definition */}
                  {defFiles.length > 0 && (
                    <div className="space-y-2 mt-3 pt-3 border-t">
                      {defFiles.map(file => (
                        <div
                          key={file.id}
                          className="flex items-center justify-between p-2 bg-slate-50 rounded"
                        >
                          <div className="flex-1 min-w-0 text-right">
                            <p className="text-sm font-medium truncate">{file.name}</p>
                            <p className="text-xs text-muted-foreground" dir="ltr">
                              {formatFileSize(file.size)} • {formatFileDate(file.uploaded_at)}
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
                                    _isExpired(file.expiration_date) ? 'text-red-600 font-medium' : ''
                                  }`}>
                                    <CalendarX className="h-3 w-3" />
                                    {format(parseISO(file.expiration_date), 'dd/MM/yyyy')}
                                    {file.resolved ? (
                                      <Badge variant="outline" className="text-xs mr-1 bg-green-50 text-green-700 border-green-300">
                                        <CheckCircle className="h-3 w-3 ml-1" />
                                        טופל
                                      </Badge>
                                    ) : _isExpired(file.expiration_date) ? (
                                      <Badge variant="destructive" className="text-xs mr-1">
                                        פג תוקף
                                      </Badge>
                                    ) : null}
                                  </span>
                                </>
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 mr-3">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDownloadFile(file)}
                              title="הורדה"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            {file.expiration_date && (
                              <Button
                                size="sm"
                                variant={file.resolved ? "outline" : "default"}
                                onClick={() => handleToggleResolved(file.id, file.resolved)}
                                className={file.resolved ? "" : "bg-green-600 hover:bg-green-700 text-white"}
                                title={file.resolved ? "בטל סימון" : "סמן כטופל"}
                              >
                                <CheckCircle2 className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingFile(file)}
                              title="עריכה"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeleteFile(file.id)}
                              disabled={deleteState === REQUEST_STATE.loading}
                              className="text-destructive hover:text-destructive"
                              title="מחיקה"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Additional Files */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              <CardTitle>קבצים נוספים</CardTitle>
            </div>
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
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.multiple = true;
                input.accept = ALLOWED_TYPES.join(',');
                input.onchange = (e) => {
                  const files = Array.from(e.target.files || []);
                  handleFileInputChange(files, null);
                };
                input.click();
              }}
              disabled={uploadingAdhoc}
              className="gap-2 flex-1"
            >
              {uploadingAdhoc ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              העלאת קבצים חופשיים
            </Button>
          </div>

          {adhocFiles.length > 0 ? (
            <div className="space-y-2">
              {sortedAdhocFiles.map(file => {
                // Check if file references a deleted definition
                const isOrphaned = file.definition_id && !getDefinitionById(file.definition_id);

                return (
                  <div
                    key={file.id}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      isOrphaned ? 'bg-amber-50 border-amber-200' : 'bg-slate-50'
                    }`}
                  >
                    <div className="flex-1 min-w-0 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        {isOrphaned && (
                          <Badge variant="outline" className="bg-amber-100 text-amber-800 text-xs">
                            הגדרה ישנה
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground" dir="ltr">
                        {formatFileSize(file.size)} • {formatFileDate(file.uploaded_at)}
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
                              _isExpired(file.expiration_date) ? 'text-red-600 font-medium' : ''
                            }`}>
                              <CalendarX className="h-3 w-3" />
                              {format(parseISO(file.expiration_date), 'dd/MM/yyyy')}
                              {file.resolved ? (
                                <Badge variant="outline" className="text-xs mr-1 bg-green-50 text-green-700 border-green-300">
                                  <CheckCircle className="h-3 w-3 ml-1" />
                                  טופל
                                </Badge>
                              ) : _isExpired(file.expiration_date) ? (
                                <Badge variant="destructive" className="text-xs mr-1">
                                  פג תוקף
                                </Badge>
                              ) : null}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 mr-3">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDownloadFile(file)}
                        title="הורדה"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      {file.expiration_date && (
                        <Button
                          size="sm"
                          variant={file.resolved ? "outline" : "default"}
                          onClick={() => handleToggleResolved(file.id, file.resolved)}
                          className={file.resolved ? "" : "bg-green-600 hover:bg-green-700 text-white"}
                          title={file.resolved ? "בטל סימון" : "סמן כטופל"}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingFile(file)}
                        title="עריכה"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteFile(file.id)}
                        disabled={deleteState === REQUEST_STATE.loading}
                        className="text-destructive hover:text-destructive"
                        title="מחיקה"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground py-8">
              לא הועלו קבצים נוספים
            </p>
          )}
        </CardContent>
      </Card>
    </div>
    </>
  );
}
