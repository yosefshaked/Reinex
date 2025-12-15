import { useState, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Users, UserPlus, X } from 'lucide-react';
import { useOrg } from '@/org/OrgContext.jsx';
import { useStudents, useInstructors } from '@/hooks/useOrgData.js';
import { useStudentTags } from '@/features/students/hooks/useStudentTags.js';
import { assignLooseSession, createAndAssignLooseSession } from '@/features/sessions/api/loose-sessions.js';
import { mapLooseSessionError } from '@/lib/error-mapping.js';
import AddStudentForm from '@/features/admin/components/AddStudentForm.jsx';
import { buildDisplayName } from '@/lib/person-name.js';

const DAY_NAMES = ['', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const RESOLUTION_MODE = Object.freeze({
  SELECT: 'select',
  ASSIGN_EXISTING: 'assign_existing',
  CREATE_NEW: 'create_new',
});

export default function BulkResolvePendingReportsDialog({ 
  open, 
  onClose, 
  reports = [], 
  onResolved 
}) {
  const { activeOrg } = useOrg();
  const activeOrgId = activeOrg?.id;
  
  const [mode, setMode] = useState(RESOLUTION_MODE.SELECT);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Filter states
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filterInstructor, setFilterInstructor] = useState('all');
  const [filterDay, setFilterDay] = useState('all');
  const [filterTag, setFilterTag] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all'); // 'all' | 'active' | 'inactive'

  // Fetch students for assignment dropdown (admin sees all, non-admin sees only their own)
  const { students = [], loadingStudents: studentsLoading } = useStudents({
    enabled: open && mode === RESOLUTION_MODE.ASSIGN_EXISTING,
    status: 'all',
  });

  // Fetch instructors and tags for filters
  const { instructors = [] } = useInstructors({
    enabled: open && mode === RESOLUTION_MODE.ASSIGN_EXISTING,
  });
  
  const { tagOptions: tags = [], loadTags } = useStudentTags({
    enabled: open && mode === RESOLUTION_MODE.ASSIGN_EXISTING,
  });

  // Load tags when dialog opens
  useEffect(() => {
    if (open && mode === RESOLUTION_MODE.ASSIGN_EXISTING) {
      void loadTags();
    }
  }, [open, mode, loadTags]);

  // Filter students by search query and filters
  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      // Search query filter (name, contact name, contact phone)
      const query = studentSearchQuery.trim().toLowerCase();
      if (query) {
        const name = String(s?.name || '').toLowerCase();
        const contactName = String(s?.contact_name || '').toLowerCase();
        const contactPhone = String(s?.contact_phone || '').toLowerCase();
        
        const matchesQuery = name.includes(query) || 
                            contactName.includes(query) || 
                            contactPhone.includes(query);
        if (!matchesQuery) return false;
      }
      
      // Instructor filter
      if (filterInstructor && filterInstructor !== 'all' && s.assigned_instructor_id !== filterInstructor) {
        return false;
      }
      
      // Day filter
      if (filterDay && filterDay !== 'all' && String(s.default_day_of_week) !== String(filterDay)) {
        return false;
      }
      
      // Tag filter
      if (filterTag && filterTag !== 'all') {
        const studentTags = s.tags || [];
        if (!studentTags.includes(filterTag)) {
          return false;
        }
      }
      
      // Status filter
      if (filterStatus === 'active' && s.is_active === false) {
        return false;
      }
      if (filterStatus === 'inactive' && s.is_active !== false) {
        return false;
      }
      
      return true;
    });
  }, [students, studentSearchQuery, filterInstructor, filterDay, filterTag, filterStatus]);

  const handleClose = () => {
    setMode(RESOLUTION_MODE.SELECT);
    setSelectedStudentId('');
    setStudentSearchQuery('');
    setShowAdvancedFilters(false);
    setFilterInstructor('all');
    setFilterDay('all');
    setFilterTag('all');
    setFilterStatus('all');
    setIsProcessing(false);
    onClose();
  };
  
  const handleClearFilters = () => {
    setStudentSearchQuery('');
    setFilterInstructor('all');
    setFilterDay('all');
    setFilterTag('all');
    setFilterStatus('all');
  };
  
  const hasActiveFilters = studentSearchQuery || (filterInstructor && filterInstructor !== 'all') || (filterDay && filterDay !== 'all') || (filterTag && filterTag !== 'all') || (filterStatus && filterStatus !== 'all');

  const handleModeSelect = (selectedMode) => {
    setMode(selectedMode);
  };

  const handleAssignExisting = async () => {
    if (!selectedStudentId) {
      toast.error('נא לבחור תלמיד.');
      return;
    }

    setIsProcessing(true);
    let successCount = 0;
    let failCount = 0;

    // Process assignments sequentially
    for (const report of reports) {
      try {
        await assignLooseSession({
          sessionId: report.id,
          studentId: selectedStudentId,
          orgId: activeOrgId,
        });
        successCount++;
      } catch (err) {
        console.error(`Failed to assign session ${report.id}`, err);
        failCount++;
      }
    }

    setIsProcessing(false);

    // Show summary toast
    if (failCount === 0) {
      toast.success(`${successCount} דיווחים שוייכו בהצלחה.`);
      onResolved();
      handleClose();
    } else if (successCount === 0) {
      toast.error(`שיוך ${failCount} דיווחים נכשל.`);
    } else {
      toast.warning(`${successCount} דיווחים שוייכו בהצלחה, ${failCount} נכשלו.`);
      onResolved();
      handleClose();
    }
  };

  const handleCreateAndAssign = async (studentData) => {
    setIsProcessing(true);
    let successCount = 0;
    let failCount = 0;
    let createdStudentId = null;

    // Create student first, then assign all reports to it
    for (const report of reports) {
      try {
        const result = await createAndAssignLooseSession({
          sessionId: report.id,
          name: studentData.name,
          nationalId: studentData.nationalId,
          assignedInstructorId: studentData.assignedInstructorId,
          defaultService: studentData.defaultService || null,
          orgId: activeOrgId,
        });
        
        // Capture the created student ID from first success
        if (!createdStudentId && result?.student_id) {
          createdStudentId = result.student_id;
        }
        
        successCount++;
      } catch (err) {
        console.error(`Failed to create/assign session ${report.id}`, err);
        const errorMessage = mapLooseSessionError(err?.message, 'create');
        if (errorMessage) {
          toast.error(errorMessage);
        }
        failCount++;
      }
    }

    setIsProcessing(false);

    // Show summary toast
    if (failCount === 0) {
      toast.success(`תלמיד חדש נוצר ו-${successCount} דיווחים שוייכו בהצלחה.`);
      onResolved();
      handleClose();
    } else if (successCount === 0) {
      toast.error(`יצירת תלמיד ושיוך ${failCount} דיווחים נכשלו.`);
    } else {
      toast.warning(`${successCount} דיווחים שוייכו בהצלחה, ${failCount} נכשלו.`);
      onResolved();
      handleClose();
    }
  };

  const reportNames = useMemo(() => {
    const names = new Set();
    reports.forEach((r) => {
      const name = r?.metadata?.unassigned_details?.name;
      if (name) names.add(name);
    });
    return Array.from(names);
  }, [reports]);

  const hasMultipleNames = reportNames.length > 1;

  // Extract instructor IDs from reports for auto-assignment
  const suggestedInstructorId = useMemo(() => {
    const instructorIds = new Set();
    reports.forEach((r) => {
      if (r?.instructor_id) {
        instructorIds.add(r.instructor_id);
      }
    });
    
    // If only one instructor, return it for auto-fill
    // If multiple instructors or none, return empty
    if (instructorIds.size === 1) {
      return Array.from(instructorIds)[0];
    }
    return '';
  }, [reports]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">שיוך מרובה - {reports.length} דיווחים</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Summary */}
          <div className="rounded-lg bg-neutral-50 p-3 space-y-2">
            <p className="text-sm font-medium text-foreground text-right">דיווחים נבחרים:</p>
            <div className="flex flex-wrap gap-2">
              {reportNames.map((name) => (
                <Badge key={name} variant="outline">
                  {name}
                </Badge>
              ))}
            </div>
            {hasMultipleNames && (
              <p className="text-xs text-neutral-600 text-right">
                ⚠️ שים לב: נבחרו דיווחים עם שמות שונים. כל הדיווחים ישוייכו לאותו תלמיד.
              </p>
            )}
          </div>

          {/* Mode Selection */}
          {mode === RESOLUTION_MODE.SELECT && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground text-right">
                בחר פעולה לביצוע עבור כל הדיווחים הנבחרים:
              </p>
              <div className="grid grid-cols-1 gap-3">
                <Button
                  variant="outline"
                  className="h-auto p-4 flex flex-col items-start gap-2"
                  onClick={() => handleModeSelect(RESOLUTION_MODE.ASSIGN_EXISTING)}
                  dir="rtl"
                >
                  <div className="flex items-center gap-2 w-full">
                    <Users className="h-5 w-5" />
                    <span className="font-semibold">שיוך לתלמיד קיים</span>
                  </div>
                  <p className="text-xs text-muted-foreground text-right">
                    שייך את כל הדיווחים לתלמיד אחד מהרשימה
                  </p>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto p-4 flex flex-col items-start gap-2"
                  onClick={() => handleModeSelect(RESOLUTION_MODE.CREATE_NEW)}
                  dir="rtl"
                >
                  <div className="flex items-center gap-2 w-full">
                    <UserPlus className="h-5 w-5" />
                    <span className="font-semibold">יצירת תלמיד חדש</span>
                  </div>
                  <p className="text-xs text-muted-foreground text-right">
                    צור תלמיד חדש ושייך אליו את כל הדיווחים
                  </p>
                </Button>
              </div>
            </div>
          )}

          {/* Assign to Existing Student */}
          {mode === RESOLUTION_MODE.ASSIGN_EXISTING && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="student-select" className="text-right block">
                    בחר תלמיד <span className="text-destructive">*</span>
                  </Label>
                  {!studentsLoading && (
                    <span className="text-xs text-muted-foreground">
                      {filteredStudents.length} תלמידים זמינים
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="relative">
                    <Input
                      id="student-search"
                      placeholder="חפש לפי שם תלמיד, שם איש קשר או מספר טלפון..."
                      value={studentSearchQuery}
                      onChange={(e) => setStudentSearchQuery(e.target.value)}
                      disabled={studentsLoading || isProcessing}
                      className="pr-10"
                    />
                    <svg className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <Select
                    value={selectedStudentId}
                    onValueChange={setSelectedStudentId}
                    disabled={studentsLoading || isProcessing || filteredStudents.length === 0}
                  >
                    <SelectTrigger id="student-select" className="w-full">
                      <SelectValue placeholder={studentsLoading ? 'טוען תלמידים...' : 'בחרו תלמיד מהרשימה'} />
                    </SelectTrigger>
                    <SelectContent className="max-h-[250px] sm:max-h-[300px]">
                      {filteredStudents.map((student) => (
                        <SelectItem key={student.id} value={student.id} className="text-right">
                          <span className="block truncate">
                            {buildDisplayName({ ...student, fallback: student.name }) || 'ללא שם'}
                          </span>
                          {student.contact_name && <span className="text-xs text-neutral-500"> ({student.contact_name})</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {filteredStudents.length === 0 && !studentsLoading && (
                    <p className="text-xs text-muted-foreground text-center">
                      {studentSearchQuery ? 'לא נמצאו תלמידים תואמים' : 'לא נמצאו תלמידים במערכת'}
                    </p>
                  )}
                </div>
              </div>

              {/* Advanced Filters Toggle */}
              <div className="border-t pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                  className="w-full justify-between h-8"
                >
                  <span className="flex items-center gap-2">
                    <span>סינון מתקדם</span>
                    {hasActiveFilters && (
                      <Badge variant="secondary" className="h-5 min-w-[1.25rem] px-1.5">
                        {[filterInstructor !== 'all', filterDay !== 'all', filterTag !== 'all', filterStatus !== 'all'].filter(Boolean).length}
                      </Badge>
                    )}
                  </span>
                  {showAdvancedFilters ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </Button>

                {showAdvancedFilters && (
                  <div className="space-y-3 mt-3 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">סינון תלמידים</Label>
                      {hasActiveFilters && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleClearFilters}
                          className="h-7 text-xs gap-1"
                        >
                          <X className="h-3 w-3" />
                          נקה סינון
                        </Button>
                      )}
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Instructor Filter */}
                  <div className="space-y-1">
                    <Label htmlFor="filter-instructor" className="text-xs">מדריך</Label>
                    <Select value={filterInstructor} onValueChange={setFilterInstructor}>
                      <SelectTrigger id="filter-instructor" className="h-9 w-full">
                        <SelectValue placeholder="כל המדריכים" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">כל המדריכים</SelectItem>
                        {instructors.map((inst) => (
                          <SelectItem key={inst.id} value={inst.id}>
                            {inst.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Day Filter */}
                  <div className="space-y-1">
                    <Label htmlFor="filter-day" className="text-xs">יום</Label>
                    <Select value={filterDay} onValueChange={setFilterDay}>
                      <SelectTrigger id="filter-day" className="h-9 w-full">
                        <SelectValue placeholder="כל הימים" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">כל הימים</SelectItem>
                        {DAY_NAMES.map((day, index) => {
                          if (index === 0) return null;
                          return (
                            <SelectItem key={index} value={String(index)}>
                              {day}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Tag Filter */}
                  <div className="space-y-1">
                    <Label htmlFor="filter-tag" className="text-xs">תגית</Label>
                    <Select value={filterTag} onValueChange={setFilterTag}>
                      <SelectTrigger id="filter-tag" className="h-9 w-full">
                        <SelectValue placeholder="כל התגיות" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">כל התגיות</SelectItem>
                        {tags.map((tag) => (
                          <SelectItem key={tag.id} value={tag.id}>
                            {tag.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Status Filter */}
                  <div className="space-y-1">
                    <Label htmlFor="filter-status" className="text-xs">סטטוס</Label>
                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                      <SelectTrigger id="filter-status" className="h-9 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">הכל</SelectItem>
                        <SelectItem value="active">פעילים</SelectItem>
                        <SelectItem value="inactive">לא פעילים</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row-reverse">
                <Button
                  onClick={handleAssignExisting}
                  disabled={!selectedStudentId || isProcessing}
                  className="w-full sm:w-auto"
                >
                  {isProcessing ? 'משייך...' : `שייך ${reports.length} דיווחים`}
                </Button>
                <Button variant="outline" onClick={() => setMode(RESOLUTION_MODE.SELECT)} disabled={isProcessing} className="w-full sm:w-auto">
                  חזור
                </Button>
              </div>
            </div>
          )}

          {/* Create New Student */}
          {mode === RESOLUTION_MODE.CREATE_NEW && (
            <div className="space-y-4">
              <div className="rounded-lg bg-neutral-50 p-3">
                <p className="text-sm text-neutral-600 text-right">
                  תלמיד חדש ייווצר ו-{reports.length} דיווחים ישוייכו אליו.
                </p>
              </div>

              <AddStudentForm
                onSubmit={handleCreateAndAssign}
                onCancel={() => setMode(RESOLUTION_MODE.SELECT)}
                submitLabel={`צור ושייך ${reports.length} דיווחים`}
                submitDisabled={isProcessing}
                renderFooterOutside={false}
                initialValues={suggestedInstructorId ? { assignedInstructorId: suggestedInstructorId } : {}}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
