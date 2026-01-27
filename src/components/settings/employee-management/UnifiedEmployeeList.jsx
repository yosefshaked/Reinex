import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar.jsx';
import { 
  Loader2, UserPlus, Eye, EyeOff, Settings, FileText, 
  MailPlus, UserX, RotateCcw, Users 
} from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '@/lib/api-client';
import { useInstructors } from '@/hooks/useOrgData.js';
import { cn } from '@/lib/utils';
import EmployeeWizardDialog from './EmployeeWizardDialog.jsx';
import EditEmployeeDialog from './EditEmployeeDialog.jsx';
import EmployeeDiagnosticsDialog from './EmployeeDiagnosticsDialog.jsx';

const REQUEST = { idle: 'idle', loading: 'loading', error: 'error' };

export default function UnifiedEmployeeList({ session, orgId, canLoad, viewMode = 'employees', onViewModeChange }) {
  const [showWizard, setShowWizard] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const [actionState, setActionState] = useState(REQUEST.idle);
  const [assignSelections, setAssignSelections] = useState({});

  const { instructors, unlinkedMembers, loadingInstructors, instructorsError, refetchInstructors } = useInstructors({
    includeInactive: true,
    includeUnlinked: viewMode === 'unlinked',
    orgId,
    session,
    enabled: canLoad,
  });

  useEffect(() => {
    if (canLoad) {
      void refetchInstructors();
    }
  }, [canLoad, refetchInstructors]);

  const handleEditEmployee = (employee) => {
    setSelectedEmployee(employee);
    setShowEditDialog(true);
  };

  const handleViewDiagnostics = (employee) => {
    setSelectedEmployee(employee);
    setShowDiagnostics(true);
  };

  const handleLinkUser = async (employee) => {
    if (!employee?.id || employee.user_id) return;
    
    const email = prompt('הזן כתובת דוא"ל להזמנת משתמש:', employee.email || '');
    if (!email?.trim()) return;

    setActionState(REQUEST.loading);
    try {
      await authenticatedFetch('instructors-link-user', {
        session,
        method: 'POST',
        body: {
          org_id: orgId,
          instructor_id: employee.id,
          email: email.trim(),
        },
      });
      toast.success('ההזמנה נשלחה בהצלחה. העובד יקושר למשתמש לאחר אישור ההזמנה.');
      await refetchInstructors();
    } catch (error) {
      console.error('Failed to link user', error);
      toast.error('שליחת ההזמנה נכשלה.');
    } finally {
      setActionState(REQUEST.idle);
    }
  };

  const handleDeactivate = async (employee) => {
    if (!employee?.id) return;
    setActionState(REQUEST.loading);
    try {
      await authenticatedFetch('instructors', {
        session,
        method: 'DELETE',
        body: { org_id: orgId, instructor_id: employee.id },
      });
      toast.success('העובד הושבת.');
      await refetchInstructors();
    } catch (error) {
      console.error('Failed to disable employee', error);
      toast.error('ההשבתה נכשלה.');
    } finally {
      setActionState(REQUEST.idle);
    }
  };

  const handleReactivate = async (employee) => {
    if (!employee?.id) return;
    setActionState(REQUEST.loading);
    try {
      await authenticatedFetch('instructors', {
        session,
        method: 'PUT',
        body: { org_id: orgId, instructor_id: employee.id, is_active: true },
      });
      toast.success('העובד הופעל מחדש.');
      await refetchInstructors();
    } catch (error) {
      console.error('Failed to enable employee', error);
      toast.error('ההפעלה נכשלה.');
    } finally {
      setActionState(REQUEST.idle);
    }
  };

  const getInitials = (first, last, email) => {
    if (first && last) {
      return (first[0] + last[0]).toUpperCase();
    }
    if (first) return first.slice(0, 2).toUpperCase();
    if (email) return email.slice(0, 2).toUpperCase();
    return '?';
  };

  const isLoading = loadingInstructors || actionState === REQUEST.loading;
  const displayedEmployees = instructors.filter(emp => showInactive || emp.is_active);

  if (loadingInstructors && instructors.length === 0 && viewMode === 'employees') {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="mr-3 text-sm text-slate-600">טוען עובדים...</span>
      </div>
    );
  }

  if (instructorsError) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        {instructorsError}
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-slate-900">רשימת עובדים</h3>
          <p className="text-sm text-slate-600">
            {displayedEmployees.length} עובדים {showInactive ? '(כולל מושבתים)' : '(פעילים)'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setShowInactive(!showInactive)}
            size="sm"
            variant="outline"
            disabled={viewMode === 'unlinked'}
          >
            {showInactive ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
            {showInactive ? 'הסתר מושבתים' : 'הצג מושבתים'}
          </Button>
          <Button onClick={() => setShowWizard(true)} size="sm" disabled={viewMode === 'unlinked'}>
            <UserPlus className="mr-2 h-4 w-4" />
            עובד חדש
          </Button>
          <Button
            onClick={() => onViewModeChange?.('unlinked')}
            size="sm"
            variant={viewMode === 'unlinked' ? 'default' : 'outline'}
          >
            <Users className="mr-2 h-4 w-4" />
            חברי ארגון ללא עובד
          </Button>
          {viewMode === 'unlinked' && (
            <Button
              onClick={() => onViewModeChange?.('employees')}
              size="sm"
              variant="outline"
            >
              חזרה לרשימת עובדים
            </Button>
          )}
        </div>
      </div>

      {/* Employee List (hidden when in unlinked view) */}
      {viewMode === 'employees' && (
        displayedEmployees.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            אין עובדים להצגה.
          </p>
        ) : (
          <div className="space-y-2">
            {displayedEmployees.map((employee) => (
              <div
                key={employee.id}
                className={cn(
                  "flex items-center justify-between gap-4 p-4 border rounded-lg bg-white transition-colors",
                  !employee.is_active && "bg-slate-50 opacity-75",
                  "hover:bg-slate-50 cursor-pointer"
                )}
                onClick={() => handleViewDiagnostics(employee)}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarFallback className={cn(
                      employee.is_active ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-600"
                    )}>
                      {getInitials(employee.first_name, employee.last_name, employee.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">
                        {`${employee.first_name || ''} ${employee.last_name || ''}`.trim() || employee.email || employee.id}
                      </span>
                      {!employee.is_active && (
                        <Badge variant="secondary" className="text-xs">מושבת</Badge>
                      )}
                      {!employee.user_id && (
                        <Badge variant="outline" className="text-xs">ידני</Badge>
                      )}
                      {employee.metadata?.invitation_pending && (
                        <Badge variant="outline" className="text-xs text-amber-600">הזמנה תלויה</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {employee.email || '—'}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                  {!employee.user_id && employee.is_active && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleLinkUser(employee)}
                      disabled={isLoading}
                      title="שלח הזמנה למשתמש"
                    >
                      <MailPlus className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEditEmployee(employee)}
                    disabled={isLoading}
                    title="עריכת פרטים"
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleViewDiagnostics(employee)}
                    disabled={isLoading}
                    title="אבחון ופעילות"
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                  {employee.is_active ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDeactivate(employee)}
                      disabled={isLoading}
                      title="השבת עובד"
                    >
                      <UserX className="h-4 w-4 text-red-600" />
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleReactivate(employee)}
                      disabled={isLoading}
                      title="הפעל מחדש"
                    >
                      <RotateCcw className="h-4 w-4 text-green-600" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Unlinked org members */}
      {viewMode === 'unlinked' && (
        <div className="space-y-3 border rounded-lg p-4 bg-slate-50">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="font-semibold text-slate-900">חברי ארגון ללא רישום עובד</h4>
              <p className="text-sm text-muted-foreground">צור עובד חדש או שייך לעובד קיים. ניתן להשאיר ללא שיוך אם זה מכוון.</p>
            </div>
          </div>

          {loadingInstructors && unlinkedMembers.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              טוען חברי ארגון...
            </div>
          ) : unlinkedMembers.length === 0 ? (
            <div className="text-sm text-muted-foreground">כל חברי הארגון משויכים לעובדים.</div>
          ) : (
            <div className="space-y-2">
              {unlinkedMembers.map(member => {
                const profile = member.profile || {};
                const candidateEmployees = instructors.filter(e => !e.user_id);
                const selectedAssign = assignSelections[member.user_id] || '';
                return (
                  <div key={member.user_id} className="border rounded-lg bg-white p-3 flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="font-medium text-sm">{profile.full_name || profile.email || member.user_id}</div>
                        <div className="text-xs text-muted-foreground">{profile.email || 'ללא דוא"ל'} • תפקיד: {member.role || 'חבר ארגון'}</div>
                      </div>
                      <Badge variant="outline" className="text-xs">לא משויך</Badge>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={async () => {
                            setActionState(REQUEST.loading);
                            try {
                              const fullName = profile.full_name || '';
                              const parts = fullName.split(' ').filter(Boolean);
                              const firstName = parts[0] || profile.email || 'משתמש';
                              const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
                              await authenticatedFetch('instructors', {
                                session,
                                method: 'POST',
                                body: {
                                  org_id: orgId,
                                  user_id: member.user_id,
                                  first_name: firstName,
                                  last_name: lastName,
                                  email: profile.email || undefined,
                                },
                              });
                              toast.success('העובד נוצר ונקשר למשתמש.');
                              await refetchInstructors();
                            } catch (error) {
                              console.error('Failed to create employee for member', error);
                              toast.error('יצירת עובד עבור חבר הארגון נכשלה.');
                            } finally {
                              setActionState(REQUEST.idle);
                            }
                          }}
                          disabled={isLoading}
                        >
                          <UserPlus className="h-4 w-4 mr-2" /> צור עובד חדש
                        </Button>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
                        <select
                          className="border rounded-md px-2 py-1 text-sm"
                          value={selectedAssign}
                          onChange={(e) => setAssignSelections(prev => ({ ...prev, [member.user_id]: e.target.value }))}
                        >
                          <option value="">בחר עובד קיים לשיוך</option>
                          {candidateEmployees.map(emp => (
                            <option key={emp.id} value={emp.id}>
                              {`${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.email || emp.id}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!selectedAssign || isLoading}
                          onClick={async () => {
                            if (!selectedAssign) return;
                            setActionState(REQUEST.loading);
                            try {
                              await authenticatedFetch('instructors-link-user', {
                                session,
                                method: 'POST',
                                body: {
                                  org_id: orgId,
                                  instructor_id: selectedAssign,
                                  email: profile.email || '',
                                },
                              });
                              toast.success('נשלחה הזמנה לשיוך המשתמש לעובד הקיים.');
                              await refetchInstructors();
                            } catch (error) {
                              console.error('Failed to link member to existing employee', error);
                              toast.error('שיוך לעובד קיים נכשל.');
                            } finally {
                              setActionState(REQUEST.idle);
                            }
                          }}
                        >
                          שייך לעובד קיים
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Dialogs */}
      <EmployeeWizardDialog
        open={showWizard}
        onOpenChange={setShowWizard}
        orgId={orgId}
        session={session}
        onSuccess={() => {
          void refetchInstructors();
        }}
      />

      <EditEmployeeDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        employee={selectedEmployee}
        orgId={orgId}
        session={session}
        onSaved={() => {
          void refetchInstructors();
        }}
      />

      <EmployeeDiagnosticsDialog
        open={showDiagnostics}
        onOpenChange={setShowDiagnostics}
        employee={selectedEmployee}
        orgId={orgId}
        session={session}
      />
    </div>
  );
}
