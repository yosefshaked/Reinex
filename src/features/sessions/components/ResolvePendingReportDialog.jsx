import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, UserCheck, UserPlus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOrg } from '@/org/OrgContext.jsx';
import { useStudents, useInstructors } from '@/hooks/useOrgData.js';
import { useStudentTags } from '@/features/students/hooks/useStudentTags.js';
import { assignLooseSession, createAndAssignLooseSession } from '@/features/sessions/api/loose-sessions.js';
import AddStudentForm from '@/features/admin/components/AddStudentForm.jsx';
import { mapLooseSessionError } from '@/lib/error-mapping.js';
import { DAY_NAMES } from '@/features/students/utils/schedule.js';
import { buildDisplayName } from '@/lib/person-name.js';

const REQUEST_STATE = Object.freeze({
  idle: 'idle',
  loading: 'loading',
  error: 'error',
});

export default function ResolvePendingReportDialog({ open, onClose, report, mode = 'assign', onResolved }) {
  const { activeOrg } = useOrg();
  const activeOrgId = activeOrg?.id || null;
  const [currentMode, setCurrentMode] = useState(mode); // 'assign' | 'create'
  const [state, setState] = useState(REQUEST_STATE.idle);
  const [error, setError] = useState('');
  
  // Assign existing mode
  const [studentQuery, setStudentQuery] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  
  // Filter states
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filterInstructor, setFilterInstructor] = useState('all');
  const [filterDay, setFilterDay] = useState('all');
  const [filterTag, setFilterTag] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  
  const { students, loadingStudents } = useStudents({
    status: 'all',
    enabled: open && currentMode === 'assign' && Boolean(activeOrgId),
    orgId: activeOrgId,
  });
  
  const { instructors = [] } = useInstructors({ enabled: open && currentMode === 'assign' });
  const { tagOptions: tags = [], loadTags } = useStudentTags({ enabled: open && currentMode === 'assign' });
  
  // Load tags when dialog opens in assign mode
  useEffect(() => {
    if (open && currentMode === 'assign') {
      void loadTags();
    }
  }, [open, currentMode, loadTags]);
  
  const unassignedName = report?.metadata?.unassigned_details?.name || '';
  const reportService = report?.service_context || '';
  const reportInstructorId = report?.instructor_id || '';
  const createInitialValues = useMemo(() => ({
    name: unassignedName || '',
    defaultService: reportService || '',
    ...(reportInstructorId && { assignedInstructorId: reportInstructorId }),
  }), [unassignedName, reportService, reportInstructorId]);

  // Data loading handled by shared hooks above based on open/mode/org

  // Reset state when dialog closes or mode prop changes
  useEffect(() => {
    if (!open) {
      setCurrentMode(mode);
      setState(REQUEST_STATE.idle);
      setError('');
      setStudentQuery('');
      setSelectedStudentId('');
      setShowAdvancedFilters(false);
      setFilterInstructor('all');
      setFilterDay('all');
      setFilterTag('all');
      setFilterStatus('all');
    } else {
      // Update to passed mode when dialog opens
      setCurrentMode(mode);
    }
  }, [open, mode]);
  
  const handleClearFilters = () => {
    setFilterInstructor('all');
    setFilterDay('all');
    setFilterTag('all');
    setFilterStatus('all');
  };
  
  const hasActiveFilters = (filterInstructor && filterInstructor !== 'all') || (filterDay && filterDay !== 'all') || (filterTag && filterTag !== 'all') || (filterStatus && filterStatus !== 'all');

  const filteredStudents = useMemo(() => {
    let filtered = students;
    
    // Text search filter
    const query = studentQuery.trim().toLowerCase();
    if (query) {
      filtered = filtered.filter((s) => {
        const name = String(s?.name || '').toLowerCase();
        const contactName = String(s?.contact_name || '').toLowerCase();
        const contactPhone = String(s?.contact_phone || '').toLowerCase();
        
        return name.includes(query) || contactName.includes(query) || contactPhone.includes(query);
      });
    }
    
    // Instructor filter
    if (filterInstructor && filterInstructor !== 'all') {
      filtered = filtered.filter((s) => s.assigned_instructor_id === filterInstructor);
    }
    
    // Day filter
    if (filterDay && filterDay !== 'all') {
      filtered = filtered.filter((s) => String(s.default_day_of_week) === String(filterDay));
    }
    
    // Tag filter
    if (filterTag && filterTag !== 'all') {
      filtered = filtered.filter((s) => {
        const studentTags = s.tags || [];
        return studentTags.includes(filterTag);
      });
    }
    
    // Status filter
    if (filterStatus === 'active') {
      filtered = filtered.filter((s) => s.is_active !== false);
    } else if (filterStatus === 'inactive') {
      filtered = filtered.filter((s) => s.is_active === false);
    }
    
    return filtered;
  }, [students, studentQuery, filterInstructor, filterDay, filterTag, filterStatus]);

  const handleAssignExisting = async () => {
    if (!selectedStudentId) {
      setError('נא לבחור תלמיד.');
      return;
    }

    setState(REQUEST_STATE.loading);
    setError('');

    try {
      await assignLooseSession({
        sessionId: report.id,
        studentId: selectedStudentId,
        orgId: activeOrgId,
      });
      
      setState(REQUEST_STATE.idle);
      onResolved?.();
    } catch (err) {
      console.error('Failed to assign loose session', err);
      setState(REQUEST_STATE.error);
      const serverMessage = err?.data?.message || err?.message || '';
      const friendly = mapLooseSessionError(serverMessage, 'assign', 'שיוך הדיווח נכשל.');
      setError(friendly);
    }
  };

  const handleCreateAndAssign = async (studentPayload) => {
    setState(REQUEST_STATE.loading);
    setError('');

    try {
      await createAndAssignLooseSession({
        sessionId: report.id,
        name: studentPayload.name,
        nationalId: studentPayload.nationalId,
        assignedInstructorId: studentPayload.assignedInstructorId,
        defaultService: studentPayload.defaultService,
        orgId: activeOrgId,
      });

      setState(REQUEST_STATE.idle);
      toast.success('תלמיד חדש נוצר והדיווח שוייך בהצלחה.');
      onResolved?.();
      onClose?.();
    } catch (err) {
      console.error('Failed to create and assign loose session', err);
      setState(REQUEST_STATE.error);

      const serverMessage = err?.data?.message || err?.message || '';
      const friendly = mapLooseSessionError(serverMessage, 'create', 'יצירת התלמיד ושיוך הדיווח נכשלו.');
      setError(friendly);
    } finally {
      setState(REQUEST_STATE.idle);
    }
  };

  const isSubmitting = state === REQUEST_STATE.loading;
  const showLoading = loadingStudents;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose?.(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>שיוך דיווח ממתין</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto max-h-[calc(90vh-8rem)]" dir="rtl">
          <div className="rounded-lg bg-neutral-50 p-3 text-sm">
            <p className="font-medium text-foreground">פרטי הדיווח:</p>
            <p className="text-neutral-600 mt-1 break-words">שם: {unassignedName}</p>
            {reportService && <p className="text-neutral-600 break-words">שירות: {reportService}</p>}
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              variant={currentMode === 'assign' ? 'default' : 'outline'}
              onClick={() => setCurrentMode('assign')}
              disabled={isSubmitting}
              className="flex-1 gap-2 justify-center"
            >
              <UserCheck className="h-4 w-4 shrink-0" />
              <span>שיוך לתלמיד קיים</span>
            </Button>
            <Button
              variant={currentMode === 'create' ? 'default' : 'outline'}
              onClick={() => setCurrentMode('create')}
              disabled={isSubmitting}
              className="flex-1 gap-2 justify-center"
            >
              <UserPlus className="h-4 w-4 shrink-0" />
              <span>יצירת תלמיד חדש</span>
            </Button>
          </div>

          {showLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-neutral-600">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>טוען נתונים...</span>
            </div>
          ) : currentMode === 'assign' ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="student-search" className="block text-right">חיפוש תלמיד</Label>
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                  <Input
                    id="student-search"
                    placeholder="חפשו לפי שם, איש קשר או טלפון..."
                    value={studentQuery}
                    onChange={(e) => setStudentQuery(e.target.value)}
                    disabled={isSubmitting}
                    className="pr-10"
                  />
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
                        {Object.entries(DAY_NAMES).map(([dayNum, dayName]) => (
                          <SelectItem key={dayNum} value={String(dayNum)}>
                            {dayName}
                          </SelectItem>
                        ))}
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

              <div className="space-y-2">
                <Label htmlFor="student-select" className="block text-right">בחרו תלמיד *</Label>
                <Select
                  value={selectedStudentId}
                  onValueChange={setSelectedStudentId}
                  disabled={isSubmitting || filteredStudents.length === 0}
                >
                  <SelectTrigger id="student-select" className="w-full">
                    <SelectValue placeholder="בחרו תלמיד מהרשימה" />
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
                {filteredStudents.length === 0 && (
                  <p className="text-xs text-neutral-500 text-right">
                    לא נמצאו תלמידים. נסו חיפוש אחר או צרו תלמיד חדש.
                  </p>
                )}
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 text-right">
                  {error}
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row-reverse sm:justify-end pt-4 border-t">
                <Button
                  onClick={handleAssignExisting}
                  disabled={isSubmitting || showLoading}
                  className="gap-2"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  שיוך קיים
                </Button>
                <Button
                  variant="outline"
                  onClick={onClose}
                  disabled={isSubmitting}
                >
                  ביטול
                </Button>
              </div>
            </div>
          ) : (
            <AddStudentForm
              onSubmit={handleCreateAndAssign}
              onCancel={onClose}
              isSubmitting={isSubmitting}
              error={error}
              initialValues={createInitialValues}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
