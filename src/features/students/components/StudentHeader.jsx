import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, MoreVertical, Pencil, AlertCircle, Trash2, Pause, Play, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatStudentName } from '@/features/students/utils/name-utils.js';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import SuspendStudentDialog from '@/features/students/components/SuspendStudentDialog.jsx';

function getInitials(student) {
  const first = student?.first_name?.[0] || '';
  const last = student?.last_name?.[0] || '';
  return (first + last) || '?';
}

export default function StudentHeader({
  student,
  canEdit = false,
  isUpdating = false,
  onEdit,
  onSuspend,
  onDelete,
}) {
  const navigate = useNavigate();
  const { session } = useSupabase();
  const { activeOrg } = useOrg();
  
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [isSuspendingOrDeleting, setIsSuspendingOrDeleting] = useState(false);

  if (!student) return null;

  const isSuspended = student?.is_active === false;
  const medicalFlags = Array.isArray(student?.medical_flags) ? student.medical_flags : [];
  const activeOrgId = activeOrg?.id;

  const handleBack = () => navigate(-1);

  const handleSuspend = async () => {
    if (!activeOrgId || isSuspendingOrDeleting) return;
    
    setIsSuspendingOrDeleting(true);
    try {
      const newStatus = !isSuspended;
      await authenticatedFetch(`students-list/${student.id}`, {
        method: 'PATCH',
        body: { org_id: activeOrgId, is_active: newStatus },
        session,
      });
      
      toast.success(newStatus ? 'התלמיד הופעל בהצלחה' : 'התלמיד הושהה בהצלחה');
      onSuspend?.();
    } catch (error) {
      console.error('Failed to update student status', error);
      toast.error(error?.message || 'שגיאה בעדכון סטטוס התלמיד');
    } finally {
      setIsSuspendingOrDeleting(false);
    }
  };

  const handleDelete = async () => {
    if (!activeOrgId || isSuspendingOrDeleting) return;
    
    setIsSuspendingOrDeleting(true);
    setDeleteDialogOpen(false);
    try {
      await authenticatedFetch(`students-list/${student.id}`, {
        method: 'PATCH',
        body: { org_id: activeOrgId, is_active: false },
        session,
      });
      
      toast.success('התלמיד הוסר בהצלחה');
      onDelete?.();
      setTimeout(() => navigate(-1), 500);
    } catch (error) {
      console.error('Failed to delete student', error);
      toast.error(error?.message || 'שגיאה בהסרת התלמיד');
    } finally {
      setIsSuspendingOrDeleting(false);
    }
  };

  const handleCopyId = () => {
    if (student?.id) {
      navigator.clipboard.writeText(student.id);
      toast.success('מזהה הועתק');
    }
  };

  // Compute age from date_of_birth
  const age = student?.date_of_birth
    ? Math.floor((Date.now() - new Date(student.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null;

  // Build subtitle parts
  const subtitleParts = [];
  if (student?.identity_number) subtitleParts.push(`ת.ז. ${student.identity_number}`);
  if (age != null && age > 0) subtitleParts.push(`גיל ${age}`);

  return (
    <>
      <div className="space-y-6">
        {/* Identity + KPI Strip */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          {/* Right side: Avatar + Name + Badges */}
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center text-2xl font-bold shrink-0 shadow-lg shadow-blue-200/40">
              {getInitials(student)}
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight">{formatStudentName(student)}</h1>
                {isSuspended ? (
                  <Badge variant="secondary" className="bg-red-50 text-red-700 border-red-200">לא פעיל</Badge>
                ) : (
                  <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200">פעיל</Badge>
                )}
              </div>
              {subtitleParts.length > 0 && (
                <p className="text-sm text-muted-foreground mt-1">{subtitleParts.join(' · ')}</p>
              )}
              {medicalFlags.length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  {medicalFlags.map((flag, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 rounded-lg bg-red-50 text-red-700 border border-red-200 px-2.5 py-1 text-xs font-semibold"
                    >
                      <AlertCircle className="h-3 w-3" />
                      {flag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Left side: KPI Strip (placeholder data for now) */}
          <div className="flex items-center gap-5 shrink-0 bg-white rounded-xl border border-border px-6 py-4 shadow-sm">
            <div className="text-center px-3">
              <p className="text-2xl font-bold text-zinc-900">—</p>
              <p className="text-xs text-muted-foreground mt-0.5">סה״כ שיעורים</p>
            </div>
            <div className="w-px h-10 bg-border" />
            <div className="text-center px-3">
              <p className="text-2xl font-bold text-emerald-600">—</p>
              <p className="text-xs text-muted-foreground mt-0.5">יתרה</p>
            </div>
            <div className="w-px h-10 bg-border" />
            <div className="text-center px-3">
              <p className="text-2xl font-bold text-amber-500">—</p>
              <p className="text-xs text-muted-foreground mt-0.5">חוב</p>
            </div>
          </div>
        </div>

        {/* Actions Row */}
        {canEdit && (
          <div className="flex items-center gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={handleBack} className="gap-2 me-auto">
              <ArrowRight className="h-4 w-4" />
              <span className="text-sm">חזרה</span>
            </Button>

            <Button variant="outline" size="sm" onClick={onEdit} disabled={isUpdating || isSuspendingOrDeleting} className="gap-2">
              <Pencil className="h-4 w-4" />
              עריכה
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={isUpdating || isSuspendingOrDeleting} className="gap-1">
                  פעולות
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" dir="rtl">
                <DropdownMenuItem onClick={handleCopyId}>
                  <Copy className="h-4 w-4 ms-2" />
                  <span>העתק מזהה</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => {
                  if (isSuspended) { handleSuspend(); } else { setSuspendDialogOpen(true); }
                }} disabled={isUpdating || isSuspendingOrDeleting} className="text-amber-600 focus:text-amber-600">
                  {isSuspended ? <Play className="h-4 w-4 ms-2" /> : <Pause className="h-4 w-4 ms-2" />}
                  <span>{isSuspended ? 'ביטול השהיה' : 'השהיה'}</span>
                  {isSuspendingOrDeleting && <Loader2 className="h-3 w-3 animate-spin ms-2" />}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={isUpdating || isSuspendingOrDeleting}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 ms-2" />
                  <span>מחיקה</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {!canEdit && (
          <Button variant="ghost" size="sm" onClick={handleBack} className="gap-2">
            <ArrowRight className="h-4 w-4" />
            <span className="text-sm">חזרה</span>
          </Button>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent dir="rtl" className="text-end">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת תלמיד</AlertDialogTitle>
            <AlertDialogDescription>
              האם אתה בטוח שברצונך למחוק את{' '}
              <strong>{formatStudentName(student)}</strong>?
              <br />
              לא ניתן לשחזר פעולה זו.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 sm:flex sm:gap-2 sm:space-y-0">
            <AlertDialogCancel>בטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isSuspendingOrDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isSuspendingOrDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin ms-2" />
                  מחיקה...
                </>
              ) : (
                'מחיקה סופית'
              )}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* Suspend Dialog with Immediately / From Date modes */}
      <SuspendStudentDialog
        open={suspendDialogOpen}
        onOpenChange={setSuspendDialogOpen}
        student={student}
        orgId={activeOrgId}
        session={session}
        onSuccess={onSuspend}
      />
    </>
  );
}
