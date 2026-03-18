import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, MoreVertical, Pencil, AlertCircle, Trash2 } from 'lucide-react';
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

/**
 * Student header with identity, medical flags, navigation, and action dropdown.
 * 
 * @param {Object} props
 * @param {Object} props.student - Student data
 * @param {boolean} props.canEdit - Whether user can edit this student
 * @param {boolean} props.isUpdating - Whether an async operation is in progress
 * @param {function} props.onEdit - Callback to open edit modal
 * @param {function} props.onSuspend - Callback after suspend succeeds
 * @param {function} props.onDelete - Callback after delete succeeds
 * @returns {JSX.Element}
 */
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
  const [isSuspendingOrDeleting, setIsSuspendingOrDeleting] = useState(false);

  if (!student) {
    return null;
  }

  const isSuspended = student?.is_active === false;
  const medicalFlags = Array.isArray(student?.medical_flags) ? student.medical_flags : [];
  const activeOrgId = activeOrg?.id;

  const handleBack = () => {
    navigate(-1);
  };

  const handleSuspend = async () => {
    if (!activeOrgId || isSuspendingOrDeleting) return;
    
    setIsSuspendingOrDeleting(true);
    try {
      const newStatus = !isSuspended; // Toggle status
      await authenticatedFetch(`students-list/${student.id}`, {
        method: 'PATCH',
        body: {
          org_id: activeOrgId,
          is_active: newStatus,
        },
        session,
      });
      
      toast.success(
        newStatus ? 'התלמיד הופעל בהצלחה' : 'התלמיד הושהה בהצלחה'
      );
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
      // Soft-delete: set is_active to false
      await authenticatedFetch(`students-list/${student.id}`, {
        method: 'PATCH',
        body: {
          org_id: activeOrgId,
          is_active: false,
        },
        session,
      });
      
      toast.success('התלמיד הוסר בהצלחה');
      onDelete?.();
      // Navigate back after deletion
      setTimeout(() => navigate(-1), 500);
    } catch (error) {
      console.error('Failed to delete student', error);
      toast.error(error?.message || 'שגיאה בהסרת התלמיד');
    } finally {
      setIsSuspendingOrDeleting(false);
    }
  };

  return (
    <>
      <div className="space-y-6">
        {/* Top Navigation Bar */}
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="gap-2"
          >
            <ArrowRight className="h-4 w-4" />
            <span className="text-sm">חזרה לרשימת תלמידים</span>
          </Button>

          {/* Action Dropdown - Admin Only */}
          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isUpdating || isSuspendingOrDeleting}
                >
                  <MoreVertical className="h-4 w-4" />
                  <span className="ms-2">פעולות</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" dir="rtl">
                <DropdownMenuItem onClick={onEdit} disabled={isUpdating || isSuspendingOrDeleting}>
                  <Pencil className="h-4 w-4 ms-2" />
                  <span>עריכת תלמיד</span>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem 
                  onClick={handleSuspend} 
                  disabled={isUpdating || isSuspendingOrDeleting}
                >
                  <AlertCircle className="h-4 w-4 ms-2" />
                  <span>{isSuspended ? 'ביטול השהיה' : 'השהיית תלמיד'}</span>
                  {isSuspendingOrDeleting && <Loader2 className="h-3 w-3 animate-spin ms-2" />}
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={isUpdating || isSuspendingOrDeleting}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 ms-2" />
                  <span>מחיקת תלמיד</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Student Identity & Badges */}
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2 flex-1">
              <h1 className="text-2xl font-semibold text-foreground">{formatStudentName(student)}</h1>
              <div className="flex flex-wrap gap-2 items-center">
                {student?.identity_number && (
                  <span className="text-sm text-neutral-600">
                    מ.ז:
                    {' '}
                    {student.identity_number}
                  </span>
                )}
                {isSuspended && (
                  <Badge variant="secondary">לא פעיל</Badge>
                )}
              </div>
            </div>
          </div>

          {/* Medical Flags - Safety Zone */}
          {medicalFlags.length > 0 && (
            <div className="rounded-lg border-l-4 border-destructive bg-destructive/10 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-destructive">דגלים רפואיים:</p>
                  <div className="flex flex-wrap gap-2">
                    {medicalFlags.map((flag, idx) => (
                      <Badge
                        key={idx}
                        variant="destructive"
                        className="text-xs"
                      >
                        {flag}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת תלמיד</AlertDialogTitle>
            <AlertDialogDescription>
              האם אתה בטוח שברצונך למחוק את
              {' '}
              <strong>{formatStudentName(student)}</strong>
              {' '}
              ?
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
    </>
  );
}
