import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Loader2, ListChecks, RotateCcw, ChevronDown, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ComboBoxField, TimeField } from '@/components/ui/forms-ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { describeSchedule, dayMatches, includesDayQuery } from '@/features/students/utils/schedule.js';
import { sortStudentsBySchedule } from '@/features/students/utils/sorting.js';
import { formatStudentName } from '@/features/students/utils/name-utils.js';
import { cn } from '@/lib/utils.js';
import DayOfWeekSelect from '@/components/ui/DayOfWeekSelect.jsx';
import PreanswersPickerDialog from './PreanswersPickerDialog.jsx';
import { useLooseReportNameSuggestions } from '@/features/sessions/hooks/useLooseReportNameSuggestions.js';

export default function NewSessionForm({
  students = [],
  questions = [],
  suggestions = {},
  services = [],
  instructors = [],
  personalPreanswers = {},
  onSavePersonalPreanswers,
  canEditPersonalPreanswers = false,
  preanswersCapLimit,
  canFilterByInstructor = false,
  userIsInstructor = false, // Whether the logged-in user is an instructor
  studentScope = 'all', // 'all' | 'mine' | `inst:<id>`
  onScopeChange,
  statusFilter = 'active',
  onStatusFilterChange,
  canViewInactive = false,
  visibilityLoaded = false,
  initialStudentId = '',
  initialDate = '', // YYYY-MM-DD format
  isLoadingStudents = false,
  onSubmit,
  onCancel,
  isSubmitting = false,
  error = '',
  renderFooterOutside = false, // New prop to control footer rendering
  onSelectedStudentChange, // Callback to notify parent of selection changes
  onFormValidityChange, // Callback to inform parent when form validity changes
  onSelectOpenChange, // Mobile fix: callback for Select open/close tracking
  formResetRef, // Ref to expose reset function to parent
  successState, // Success state from parent { studentId, studentName, date }
  showAdvancedFilters: externalShowAdvancedFilters, // Controlled from parent
  onShowAdvancedFiltersChange, // Callback to update parent state
}) {
  const [selectedStudentId, setSelectedStudentId] = useState(initialStudentId || '');
  const [studentQuery, setStudentQuery] = useState('');
  const [studentDayFilter, setStudentDayFilter] = useState(null);
  const [sessionDate, setSessionDate] = useState(initialDate || '');
  const [serviceContext, setServiceContext] = useState('');
  const [serviceTouched, setServiceTouched] = useState(false);
  const [sessionTime, setSessionTime] = useState('');
  const [looseMode, setLooseMode] = useState(false);
  const [unassignedName, setUnassignedName] = useState('');
  const [unassignedReason, setUnassignedReason] = useState('');
  const [unassignedReasonOther, setUnassignedReasonOther] = useState('');
  const [looseInstructorId, setLooseInstructorId] = useState(''); // For admin selecting which instructor submits loose report
  const [preanswersDialogOpen, setPreanswersDialogOpen] = useState(false);
  const [activeQuestionKey, setActiveQuestionKey] = useState(null);
  const [isFormValid, setIsFormValid] = useState(false);
  const formRef = useRef(null);
  
  // Loose report name duplicate checker
  const { suggestions: nameSuggestions, loading: loadingNameSuggestions } = useLooseReportNameSuggestions(
    unassignedName,
    looseMode // Only enabled when in loose mode
  );
  
  // Use controlled state from parent, or local state as fallback
  const showAdvancedFilters = externalShowAdvancedFilters ?? false;
  const setShowAdvancedFilters = onShowAdvancedFiltersChange ?? (() => {});
  const [answers, setAnswers] = useState(() => {
    const initial = {};
    for (const question of questions) {
      if (question?.key) {
        if (question.type === 'scale' && typeof question?.range?.min === 'number') {
          initial[question.key] = String(question.range.min);
        } else {
          initial[question.key] = '';
        }
      }
    }
    return initial;
  });

  useEffect(() => {
    setAnswers((previous) => {
      const next = { ...previous };
      const keys = new Set();
      for (const question of questions) {
        if (!question?.key) {
          continue;
        }
        keys.add(question.key);
        if (!Object.prototype.hasOwnProperty.call(next, question.key)) {
          if (question.type === 'scale' && typeof question?.range?.min === 'number') {
            next[question.key] = String(question.range.min);
          } else {
            next[question.key] = '';
          }
        }
      }
      for (const existingKey of Object.keys(next)) {
        if (!keys.has(existingKey)) {
          delete next[existingKey];
        }
      }
      return next;
    });
  }, [questions]);

  useEffect(() => {
    if (!initialStudentId) {
      return;
    }
    setSelectedStudentId(initialStudentId);
    onSelectedStudentChange?.(initialStudentId);
  }, [initialStudentId, onSelectedStudentChange]);

  const selectedStudent = useMemo(() => {
    return students.find((student) => student?.id === selectedStudentId) || null;
  }, [students, selectedStudentId]);

  // Build instructor map for sorting
  const instructorMap = useMemo(() => {
    return instructors.reduce((map, instructor) => {
      if (instructor?.id) {
        map.set(instructor.id, instructor);
      }
      return map;
    }, new Map());
  }, [instructors]);

  const filteredStudents = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();

    // Server already filtered by scope (admin). For non-admin, list is already scoped to 'mine'.
    // We still apply day filter and text query locally for responsiveness.
    const byDay = students.filter((s) => dayMatches(s?.default_day_of_week, studentDayFilter));

    let filtered = byDay;
    if ((statusFilter === 'active' || (!canViewInactive && statusFilter !== 'active'))) {
      filtered = filtered.filter((s) => s?.is_active !== false);
    } else if (statusFilter === 'inactive') {
      filtered = filtered.filter((s) => s?.is_active === false);
    }
    if (q) {
      // Apply text query over the day-filtered list
      filtered = byDay.filter((s) => {
        try {
          const name = String(s?.name || '').toLowerCase();
          if (name.includes(q)) return true;

          const contactName = String(s?.contact_name || '').toLowerCase();
          if (contactName.includes(q)) return true;

          const contactPhone = String(s?.contact_phone || '').toLowerCase();
          if (contactPhone.includes(q)) return true;

          const contactInfo = String(s?.contact_info || '').toLowerCase();
          if (contactInfo.includes(q)) return true;

          if (includesDayQuery(s?.default_day_of_week, q)) return true;

          const timeStr = String(describeSchedule(null, s?.default_session_time) || '').toLowerCase();
          if (timeStr.includes(q)) return true;

          const fullSchedule = String(describeSchedule(s?.default_day_of_week, s?.default_session_time) || '').toLowerCase();
          if (fullSchedule.includes(q)) return true;

          return false;
        } catch {
          return false;
        }
      });
    }

    // Apply default sorting by schedule (day → hour → instructor → name)
    return sortStudentsBySchedule(filtered, instructorMap);
  }, [students, studentQuery, studentDayFilter, instructorMap, statusFilter, canViewInactive]);

  useEffect(() => {
    // If the currently selected student is filtered out, clear the selection
    // EXCEPTION: Don't clear if the student was pre-selected via initialStudentId
    // or while the students list is still loading to avoid clearing prematurely.
    if (!selectedStudentId) return;
    if (String(selectedStudentId) === String(initialStudentId)) return;
    if (isLoadingStudents) return;
    const stillVisible = filteredStudents.some((s) => s?.id === selectedStudentId);
    if (!stillVisible) {
      setSelectedStudentId('');
    }
  }, [filteredStudents, selectedStudentId, initialStudentId, isLoadingStudents]);

  useEffect(() => {
    if (!selectedStudent || serviceTouched) {
      return;
    }
    if (selectedStudent.default_service) {
      setServiceContext(selectedStudent.default_service);
    }
  }, [selectedStudent, serviceTouched]);

  const handleStudentChange = (value) => {
    setSelectedStudentId(value);
    setLooseMode(false);
    onSelectedStudentChange?.(value); // Notify parent
    setServiceTouched(false);
    const nextStudent = students.find((student) => student?.id === value);
    if (nextStudent?.default_service) {
      setServiceContext(nextStudent.default_service);
    } else {
      setServiceContext('');
    }
  };

  const handleResetFilters = () => {
    setStudentQuery('');
    setStudentDayFilter(null);
    if (canViewInactive) {
      onStatusFilterChange?.('active');
    }
  };

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return studentQuery.trim() !== '' || studentDayFilter !== null || statusFilter !== 'active';
  }, [studentQuery, studentDayFilter, statusFilter]);

  const updateAnswer = useCallback((questionKey, value) => {
    setAnswers((previous) => ({
      ...previous,
      [questionKey]: value,
    }));
  }, []);

  const handleAnswerChange = useCallback((questionKey, event) => {
    const value = event.target.value;
    updateAnswer(questionKey, value);
  }, [updateAnswer]);

  // Handler to switch from loose mode to regular mode when selecting an existing student
  const handleSelectExistingStudent = useCallback((student) => {
    // Switch to regular mode
    setLooseMode(false);
    // Select the student
    setSelectedStudentId(student.id);
    // Clear loose mode fields
    setUnassignedName('');
    setUnassignedReason('');
    setUnassignedReasonOther('');
    // Keep service, time, answers, and date - they're preserved automatically
  }, []);

  const handleSubmit = (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    if (!selectedStudentId && !looseMode) {
      return;
    }

    if (looseMode && !unassignedName.trim()) return;
    if (looseMode && !sessionTime.trim()) return;
    // Non-instructor admins must specify which instructor is submitting
    if (looseMode && canFilterByInstructor && !userIsInstructor && !looseInstructorId.trim()) {
      alert('נדרש לבחור מדריך מגיש. כמנהל ללא הרשאות מדריך, עליך לציין איזה מדריך מגיש את הדיווח.');
      return;
    }

    const trimmedService = serviceContext.trim();
    const answerEntries = Object.entries(answers)
      .map(([key, value]) => {
        if (typeof value === 'string') {
          return [key, value.trim()];
        }
        return [key, value];
      })
      .filter(([, value]) => {
        if (typeof value === 'string') {
          return value !== '';
        }
        return value !== null && typeof value !== 'undefined';
      });

    const payload = {
      studentId: looseMode ? null : selectedStudentId,
      date: sessionDate,
      time: looseMode ? sessionTime : sessionTime || null,
      serviceContext: trimmedService || null,
      answers: Object.fromEntries(answerEntries),
      instructorId: looseMode && looseInstructorId ? looseInstructorId : undefined,
      unassignedDetails: looseMode
        ? {
            name: unassignedName.trim(),
            reason: unassignedReason,
            ...(unassignedReason === 'other' ? { reason_other: unassignedReasonOther.trim() } : {}),
          }
        : null,
    };

    onSubmit?.(payload);
  };

  // Expose reset function to parent via ref
  useImperativeHandle(formResetRef, () => (options = {}) => {
    const { 
      keepStudent = false, 
      studentId = null, 
      date = null,
      // Loose report metadata to preserve across follow-up reports
      looseName = null,
      looseReason = null,
      looseReasonOther = null,
      looseService = null,
    } = options;
    
    // Reset all form fields
    const initialAnswers = {};
    for (const question of questions) {
      if (question?.key) {
        if (question.type === 'scale' && typeof question?.range?.min === 'number') {
          initialAnswers[question.key] = String(question.range.min);
        } else {
          initialAnswers[question.key] = '';
        }
      }
    }
    setAnswers(initialAnswers);
    
    // Set date from options if provided, otherwise reset
    if (date) {
      setSessionDate(date);
    } else {
      setSessionDate('');
    }
    setSessionTime('');
    
    // Preserve loose report metadata if provided (for follow-up reports of same loose report)
    if (looseName) {
      setLooseMode(true);
      setUnassignedName(looseName);
      setUnassignedReason(looseReason || '');
      setUnassignedReasonOther(looseReasonOther || '');
      // Pre-fill service context for loose reports
      if (looseService) {
        setServiceContext(looseService);
        setServiceTouched(true);
      }
    } else {
      setLooseMode(false);
      setUnassignedName('');
      setUnassignedReason('');
      setUnassignedReasonOther('');
      
      // Preserve service context when keeping same student (assigned reports)
      if (!keepStudent) {
        setServiceContext('');
        setServiceTouched(false);
      }
    }
    
    setLooseInstructorId('');
    setStudentQuery('');
    setStudentDayFilter(null);
    // Keep advanced filters state when creating additional reports (don't reset showAdvancedFilters)
    
    // Conditionally reset student selection
    if (keepStudent && studentId) {
      setSelectedStudentId(studentId);
      onSelectedStudentChange?.(studentId);
    } else {
      setSelectedStudentId('');
      onSelectedStudentChange?.('');
    }
  }, [questions, onSelectedStudentChange]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) {
      return;
    }
    const nextIsValid = form.checkValidity();
    if (isFormValid !== nextIsValid) {
      setIsFormValid(nextIsValid);
    }
    onFormValidityChange?.(nextIsValid);
  }, [selectedStudentId, sessionDate, sessionTime, serviceContext, looseMode, unassignedName, unassignedReason, unassignedReasonOther, looseInstructorId, answers, questions, onFormValidityChange, isFormValid]);

  return (
    <form
      id="new-session-form"
      ref={formRef}
      className="space-y-lg"
      onSubmit={handleSubmit}
     
    >
      {successState && (
        <div className="rounded-lg bg-success-50 border-2 border-success-200 p-md text-center animate-in fade-in duration-300">
          <p className="text-base font-semibold text-success-700">
            ✓ מפגש עבור {successState.studentName} נשמר בהצלחה!
          </p>
          <p className="text-sm text-success-600 mt-1">
            בחרו פעולה מהתפריט מטה
          </p>
        </div>
      )}
      {!successState && (
      <>
      <div className="space-y-sm">
        <div className="flex items-center justify-between gap-2">
          <div>
            <Label htmlFor="session-student" className="block text-end text-base font-semibold">בחרו תלמיד *</Label>
            <p className="text-xs text-neutral-500 text-end mb-3">השתמשו במסננים למטה כדי לצמצם את הרשימה</p>
          </div>
          <Button
            type="button"
            variant={looseMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setLooseMode((prev) => {
                const next = !prev;
                if (next) {
                  setSelectedStudentId('');
                  onSelectedStudentChange?.('');
                  setServiceContext('');
                  setServiceTouched(true);
                } else {
                  setServiceTouched(false);
                }
                return next;
              });
            }}
            disabled={isSubmitting}
            className="whitespace-nowrap"
          >
            תלמיד לא ברשימה?
          </Button>
        </div>
        
        {/* Search Box with Collapsible Advanced Filters */}
        <div className="mb-3 space-y-2 p-3 bg-neutral-50 rounded-lg border border-neutral-200">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-medium text-neutral-600 text-end">🔍 חיפוש</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="gap-2 text-sm"
              disabled={isSubmitting}
            >
              <span>סינון מתקדם</span>
              <ChevronDown 
                className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  showAdvancedFilters && "rotate-180"
                )}
              />
              {hasActiveFilters && !showAdvancedFilters && (
                <span className="inline-flex h-2 w-2 rounded-full bg-primary" title="יש מסננים פעילים" />
              )}
            </Button>
          </div>
          <div className="relative">
            <Input
              type="text"
              placeholder="חיפוש לפי שם, יום או שעה..."
              value={studentQuery}
              onChange={(e) => setStudentQuery(e.target.value)}
              className="w-full pe-3 text-sm"
              disabled={isSubmitting || students.length === 0}
              aria-label="חיפוש תלמיד"
            />
          </div>

          {/* Advanced Filters - Collapsible within search box */}
          {showAdvancedFilters && (
            <div className="pt-2 border-t border-neutral-200 animate-in fade-in slide-in-from-top-2 duration-200">
              <p className="text-xs font-medium text-neutral-600 text-end mb-2">⚙️ מסננים מתקדמים</p>
              <div className="flex flex-wrap items-end gap-2">
                {canFilterByInstructor ? (
                  <div className="min-w-[200px] flex-1 sm:flex-none">
                    <Select
                      value={studentScope}
                      onValueChange={(v) => onScopeChange?.(v)}
                      onOpenChange={onSelectOpenChange}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="כל התלמידים" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">כל התלמידים</SelectItem>
                        {/* 'mine' option is still useful for admins who are also instructors */}
                        <SelectItem value="mine">התלמידים שלי</SelectItem>
                        {instructors.filter(inst => inst?.id).map((inst) => (
                          <SelectItem key={inst.id} value={`inst:${inst.id}`}>
                            התלמידים של {inst.name?.trim() || inst.email?.trim() || inst.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="min-w-[160px] flex-1 sm:flex-none">
                  <DayOfWeekSelect
                    value={studentDayFilter}
                    onChange={setStudentDayFilter}
                    disabled={isSubmitting || students.length === 0}
                    placeholder="סינון לפי יום"
                  />
                </div>
                {canViewInactive ? (
                  <div className="flex items-center gap-2">
                    <Label htmlFor="session-status-filter" className="text-sm text-neutral-600">
                      מצב:
                    </Label>
                    <Select
                      value={statusFilter}
                      onValueChange={(value) => onStatusFilterChange?.(value)}
                      onOpenChange={onSelectOpenChange}
                      disabled={isSubmitting || !visibilityLoaded}
                    >
                      <SelectTrigger id="session-status-filter" className="w-auto min-w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">תלמידים פעילים</SelectItem>
                        <SelectItem value="inactive">תלמידים לא פעילים</SelectItem>
                        <SelectItem value="all">הצג הכל</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                {hasActiveFilters ? (
                  <div className="flex-shrink-0 ltr:ms-auto rtl:me-auto">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleResetFilters}
                      className="gap-xs"
                      disabled={isSubmitting}
                      title="נקה מסנני תלמיד"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      <span className="hidden sm:inline">נקה מסננים</span>
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
        
        <div className="pt-2">
          <Label htmlFor="session-student-select" className="block text-end text-sm font-medium text-primary mb-2">
            ✓ בחירת תלמיד
          </Label>
          <Select
            value={selectedStudentId}
            onValueChange={handleStudentChange}
            onOpenChange={onSelectOpenChange}
            disabled={isSubmitting || filteredStudents.length === 0 || looseMode}
            required={!looseMode}
          >
            <SelectTrigger id="session-student" className="w-full border-2 border-primary/30 bg-white shadow-sm hover:border-primary/50 focus:border-primary">
              <SelectValue placeholder={looseMode ? 'דיווח לא משויך' : 'בחרו תלמיד מהרשימה'} />
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              {filteredStudents.map((student) => {
                const schedule = describeSchedule(student?.default_day_of_week, student?.default_session_time);
                return (
                  <SelectItem key={student.id} value={student.id}>
                    {formatStudentName(student) || 'ללא שם'} — {schedule}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        {looseMode ? (
          <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-end text-sm text-amber-800">
            <p className="font-semibold">דיווח לא משויך</p>
            <p>הדיווח יישלח לאישור מנהל לפני שיוצמד לתלמיד קיים או חדש.</p>
          </div>
        ) : students.length === 0 ? (
          <p className="text-xs text-neutral-500 text-end">אין תלמידים זמינים לשיוך מפגש חדש.</p>
        ) : filteredStudents.length === 0 ? (
          <p className="text-xs text-neutral-500 text-end">לא נמצאו תלמידים התואמים את החיפוש.</p>
        ) : null}

        {looseMode && (
          <div className="space-y-md">
            <div className="grid gap-md sm:grid-cols-2">
              <div className="space-y-sm">
                <Label htmlFor="unassigned-name" className="block text-end">שם התלמיד *</Label>
                <div className="relative">
                  <Input
                    id="unassigned-name"
                    value={unassignedName}
                    onChange={(e) => setUnassignedName(e.target.value)}
                    required={looseMode}
                    disabled={isSubmitting}
                    placeholder="הקלידו שם"
                  />
                  {loadingNameSuggestions && (
                    <div className="absolute start-3 top-1/2 -translate-y-1/2">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
                {nameSuggestions && nameSuggestions.length > 0 && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/50 overflow-hidden">
                    <div className="px-3 py-2 bg-amber-100/50 border-b border-amber-200">
                      <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
                        <UserCheck className="h-4 w-4" />
                        <span>תלמידים קיימים נמצאו במערכת</span>
                      </div>
                    </div>
                    <div className="p-2 space-y-1">
                      {nameSuggestions.map((student) => (
                        <button
                          key={student.id}
                          type="button"
                          onClick={() => handleSelectExistingStudent(student)}
                          className="w-full flex items-center justify-between px-3 py-2.5 text-sm rounded-md bg-white hover:bg-muted border border-transparent hover:border-border transition-all text-end group"
                          disabled={isSubmitting}
                        >
                          <span className="font-medium text-foreground group-hover:text-primary">{formatStudentName(student)}</span>
                          <div className="flex items-center gap-2">
                            {student.is_active ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-success/10 text-success border border-success/20">
                                פעיל
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
                                לא פעיל
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="px-3 py-2 bg-amber-50/30 border-t border-amber-200 text-xs text-amber-800 text-end">
                      💡 לחיצה על תלמיד תעביר לדיווח רגיל תוך שמירת כל התשובות
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-sm">
                <Label htmlFor="unassigned-reason" className="block text-end">סיבת הדיווח *</Label>
                <Select
                  value={unassignedReason}
                  onValueChange={setUnassignedReason}
                  onOpenChange={onSelectOpenChange}
                  disabled={isSubmitting}
                  required={looseMode}
                >
                  <SelectTrigger id="unassigned-reason" className="w-full">
                    <SelectValue placeholder="בחרו סיבה" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="substitute">מחליף זמני</SelectItem>
                    <SelectItem value="new_student">תלמיד חדש</SelectItem>
                    <SelectItem value="other">אחר</SelectItem>
                  </SelectContent>
                </Select>
                {unassignedReason === 'other' ? (
                  <Input
                    id="unassigned-reason-other"
                    className="mt-2"
                    placeholder="פרטו את הסיבה"
                    value={unassignedReasonOther}
                    onChange={(e) => setUnassignedReasonOther(e.target.value)}
                    required={looseMode}
                    disabled={isSubmitting}
                  />
                ) : null}
              </div>
            </div>
            {canFilterByInstructor && instructors.length > 0 && (
              <div className="space-y-sm">
                <Label htmlFor="loose-instructor" className="block text-end">
                  מדריך מגיש {!userIsInstructor && '*'}
                </Label>
                <Select
                  value={looseInstructorId}
                  onValueChange={setLooseInstructorId}
                  onOpenChange={onSelectOpenChange}
                  disabled={isSubmitting}
                  required={!userIsInstructor}
                >
                  <SelectTrigger id="loose-instructor" className="w-full">
                    <SelectValue placeholder={userIsInstructor ? "בחרו מדריך (אופציונלי)" : "בחרו מדריך *"} />
                  </SelectTrigger>
                  <SelectContent>
                    {instructors.map((inst) => (
                      <SelectItem key={inst.id} value={inst.id}>
                        {inst.name || inst.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-neutral-500 text-end">
                  {userIsInstructor 
                    ? "ללא בחירה, הדיווח יוצמד אליך כמגיש"
                    : "נדרש לבחור מדריך - אין לך הרשאות מדריך"}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-md sm:grid-cols-2">
        <div className="space-y-sm">
          <Label htmlFor="session-date" className="block text-end">תאריך המפגש *</Label>
          <Input
            id="session-date"
            type="date"
            value={sessionDate}
            onChange={(event) => setSessionDate(event.target.value)}
            required
            disabled={isSubmitting}
          />
        </div>
        {looseMode && (
          <div className="space-y-sm">
            <Label htmlFor="session-time" className="block text-end">שעת המפגש *</Label>
            <TimeField
              id="session-time"
              value={sessionTime}
              onChange={setSessionTime}
              disabled={isSubmitting}
              required
              placeholder="HH:MM"
            />
          </div>
        )}
        <ComboBoxField
          id="session-service"
          name="service"
          label="שירות"
          value={serviceContext}
          onChange={setServiceContext}
          options={services}
          placeholder="בחרו מהרשימה או הקלידו שירות"
          disabled={isSubmitting}
         
          emptyMessage="לא נמצאו שירותים תואמים"
          description={looseMode ? 'חובה לבחור שירות לדיווח לא משויך.' : 'הערך מוצע לפי ברירת המחדל של התלמיד אך ניתן לעריכה.'}
          required={looseMode}
        />
      </div>

      {questions.length ? (
        <div className="space-y-md">
          <h3 className="text-base font-semibold text-foreground text-end">שאלות המפגש</h3>
          <div className="space-y-md">
            {questions.map((question) => {
              const questionId = `question-${question.key}`;
              const questionOptions = Array.isArray(question.options)
                ? question.options
                  .map((option) => {
                    const value = typeof option?.value === 'string' ? option.value.trim() : '';
                    const label = typeof option?.label === 'string' ? option.label.trim() : value;
                    if (!value || !label) {
                      return null;
                    }
                    return { value, label };
                  })
                  .filter(Boolean)
                : [];
              const required = Boolean(question.required);
              const placeholder = typeof question.placeholder === 'string' ? question.placeholder : '';
              const answerValue = answers[question.key];

              const orgPreanswers = (() => {
                const byKey = Array.isArray(suggestions?.[question.key]) ? suggestions[question.key] : [];
                const byId = Array.isArray(suggestions?.[question.id]) ? suggestions[question.id] : [];
                return byKey.length > 0 ? byKey : byId;
              })();
              // Show button if user is an instructor (can add personal answers) OR there are org answers to pick from
              const showButton = canEditPersonalPreanswers || orgPreanswers.length > 0;
              const showHelpMessage = !canEditPersonalPreanswers && orgPreanswers.length === 0;

              if (question.type === 'textarea') {
                
                return (
                  <div key={question.key} className="space-y-xs">
                    <Label htmlFor={questionId} className="block text-end">
                      {question.label}
                      {required ? ' *' : ''}
                    </Label>
                    <div className="relative">
                      <Textarea
                        id={questionId}
                        rows={4}
                        value={answerValue ?? ''}
                        onChange={(e) => handleAnswerChange(question.key, e)}
                        disabled={isSubmitting}
                        placeholder={placeholder}
                        required={required}
                        className={showButton ? 'ps-12' : ''}
                      />
                      {showButton && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute start-1 top-1 h-8 px-2"
                          onClick={() => {
                            setActiveQuestionKey(question.key);
                            setPreanswersDialogOpen(true);
                          }}
                          disabled={isSubmitting}
                          title="בחר תשובה מוכנה"
                        >
                          <ListChecks className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    {showHelpMessage && (
                      <p className="text-xs text-neutral-500 text-end">
                        אין תשובות מוכנות לשאלה זו. בקשו ממנהלי המערכת להגדיר תשובות מוכנות.
                      </p>
                    )}
                  </div>
                );
              }

              if (question.type === 'text') {
                return (
                  <div key={question.key} className="space-y-xs">
                    <Label htmlFor={questionId} className="block text-end">
                      {question.label}
                      {required ? ' *' : ''}
                    </Label>
                    <div className="relative">
                      <Input
                        id={questionId}
                        value={answerValue ?? ''}
                        onChange={(e) => handleAnswerChange(question.key, e)}
                        disabled={isSubmitting}
                        placeholder={placeholder}
                        required={required}
                        className={showButton ? 'ps-12' : ''}
                      />
                      {showButton && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute start-1 top-1/2 -translate-y-1/2 h-8 px-2"
                          onClick={() => {
                            setActiveQuestionKey(question.key);
                            setPreanswersDialogOpen(true);
                          }}
                          disabled={isSubmitting}
                          title="בחר תשובה מוכנה"
                        >
                          <ListChecks className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    {showHelpMessage && (
                      <p className="text-xs text-neutral-500 text-end">
                        אין תשובות מוכנות לשאלה זו. בקשו ממנהלי המערכת להגדיר תשובות מוכנות.
                      </p>
                    )}
                  </div>
                );
              }

              if (question.type === 'number') {
                return (
                  <div key={question.key} className="space-y-xs">
                    <Label htmlFor={questionId} className="block text-end">
                      {question.label}
                      {required ? ' *' : ''}
                    </Label>
                    <Input
                      id={questionId}
                      type="number"
                      value={answerValue ?? ''}
                      onChange={(e) => handleAnswerChange(question.key, e)}
                      disabled={isSubmitting}
                      placeholder={placeholder}
                      required={required}
                    />
                  </div>
                );
              }

              if (question.type === 'date') {
                return (
                  <div key={question.key} className="space-y-xs">
                    <Label htmlFor={questionId} className="block text-end">
                      {question.label}
                      {required ? ' *' : ''}
                    </Label>
                    <Input
                      id={questionId}
                      type="date"
                      value={answerValue ?? ''}
                      onChange={(e) => handleAnswerChange(question.key, e)}
                      disabled={isSubmitting}
                      required={required}
                    />
                  </div>
                );
              }

              if (question.type === 'select') {
                return (
                  <div key={question.key} className="space-y-xs">
                    <Label htmlFor={questionId} className="block text-end">
                      {question.label}
                      {required ? ' *' : ''}
                    </Label>
                    <Select
                      value={answerValue ?? ''}
                      onValueChange={(value) => updateAnswer(question.key, value)}
                      onOpenChange={onSelectOpenChange}
                      disabled={isSubmitting || questionOptions.length === 0}
                      required={required}
                    >
                      <SelectTrigger id={questionId} className="w-full">
                        <SelectValue placeholder="בחרו אפשרות" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
                        {questionOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {questionOptions.length === 0 ? (
                      <p className="text-xs text-neutral-500">אין אפשרויות זמינות לשאלה זו.</p>
                    ) : null}
                  </div>
                );
              }

              if (question.type === 'radio' || question.type === 'buttons') {
                const isButtonStyle = question.type === 'buttons';
                return (
                  <div key={question.key} className="space-y-xs">
                    <Label>
                      {question.label}
                      {required ? ' *' : ''}
                    </Label>
                    <div 
                      className={cn(
                        'gap-2',
                        isButtonStyle ? 'flex flex-wrap' : 'space-y-2'
                      )} 
                      role="radiogroup" 
                      aria-required={required}
                    >
                      {questionOptions.length === 0 ? (
                        <p className="text-xs text-neutral-500">אין אפשרויות זמינות לשאלה זו.</p>
                      ) : null}
                      {questionOptions.map((option, optionIndex) => {
                        const checked = answerValue === option.value;
                        const labelClass = cn(
                          'flex items-center gap-xs text-sm transition-all',
                          isButtonStyle
                            ? cn(
                                // Button style: hide radio, make whole area clickable
                                'cursor-pointer rounded-lg border-2 px-md py-sm font-medium shadow-sm hover:shadow-md',
                                checked
                                  ? 'border-primary bg-primary text-white shadow-md'
                                  : 'border-neutral-300 bg-white text-foreground hover:border-primary/50 hover:bg-primary/5'
                              )
                            : cn(
                                // Traditional radio style: visible radio button
                                'cursor-pointer rounded-lg border px-sm py-xs',
                                checked
                                  ? 'border-primary bg-primary/10 text-primary'
                                  : 'border-border bg-white text-foreground hover:bg-neutral-50'
                              )
                        );
                        return (
                          <label key={option.value} className={labelClass}>
                            <input
                              type="radio"
                              name={question.key}
                              value={option.value}
                              checked={checked}
                              onChange={() => updateAnswer(question.key, option.value)}
                              required={required && optionIndex === 0}
                              disabled={isSubmitting}
                              className={cn(
                                'h-4 w-4',
                                isButtonStyle && 'sr-only' // Hide radio button for button style
                              )}
                            />
                            <span>{option.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              if (question.type === 'scale') {
                const min = typeof question?.range?.min === 'number' ? question.range.min : 0;
                const max = typeof question?.range?.max === 'number' ? question.range.max : 5;
                const step = typeof question?.range?.step === 'number' && question.range.step > 0 ? question.range.step : 1;
                const sliderValue = answerValue !== undefined && answerValue !== ''
                  ? Number(answerValue)
                  : min;
                return (
                  <div key={question.key} className="space-y-2">
                    <Label htmlFor={questionId} className="block text-end">
                      {question.label}
                      {required ? ' *' : ''}
                    </Label>
                    <div className="flex items-center gap-sm">
                      <span className="text-xs text-neutral-500">{min}</span>
                      <input
                        id={questionId}
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={sliderValue}
                        onChange={(event) => updateAnswer(question.key, event.target.value)}
                        disabled={isSubmitting}
                        className="flex-1"
                      />
                      <span className="text-xs text-neutral-500">{max}</span>
                    </div>
                    <div className="text-xs text-neutral-600">ערך שנבחר: {sliderValue}</div>
                  </div>
                );
              }

              return (
                <div key={question.key} className="space-y-xs">
                  <Label htmlFor={questionId} className="block text-end">
                    {question.label}
                    {required ? ' *' : ''}
                  </Label>
                  <Input
                    id={questionId}
                    value={answerValue ?? ''}
                    onChange={(e) => handleAnswerChange(question.key, e)}
                    disabled={isSubmitting}
                    placeholder={placeholder}
                    required={required}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg bg-red-50 p-md text-sm text-red-700 text-end" role="alert">
          {error}
        </div>
      ) : null}

      {!renderFooterOutside && (
        <div className="border-t -mx-4 sm:-mx-6 mt-6 pt-3 sm:pt-4 px-4 sm:px-6">
          <div className="flex flex-col-reverse gap-sm sm:flex-row-reverse sm:justify-end">
            <Button type="submit" disabled={isSubmitting || !isFormValid} className="gap-xs shadow-md hover:shadow-lg transition-shadow">
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              שמירת מפגש
            </Button>
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting} className="hover:shadow-sm">
              ביטול
            </Button>
          </div>
        </div>
      )}
      </>
      )}

      {/* Preconfigured Answers Picker Dialog */}
      <PreanswersPickerDialog
        open={preanswersDialogOpen}
        onClose={() => {
          setPreanswersDialogOpen(false);
          setActiveQuestionKey(null);
        }}
        answers={(() => {
          if (!activeQuestionKey) return [];
          const question = questions.find((q) => q.key === activeQuestionKey);
          if (!question) return [];
          const byKey = Array.isArray(suggestions?.[question.key]) ? suggestions[question.key] : [];
          const byId = Array.isArray(suggestions?.[question.id]) ? suggestions[question.id] : [];
          return byKey.length > 0 ? byKey : byId;
        })()}
        personalAnswers={(() => {
          if (!activeQuestionKey) return [];
          const question = questions.find((q) => q.key === activeQuestionKey);
          if (!question) return [];
          const byKey = Array.isArray(personalPreanswers?.[question.key]) ? personalPreanswers[question.key] : [];
          const byId = Array.isArray(personalPreanswers?.[question.id]) ? personalPreanswers[question.id] : [];
          return byKey.length > 0 ? byKey : byId;
        })()}
        onSavePersonal={(list) => {
          if (!activeQuestionKey) return;
          onSavePersonalPreanswers?.(activeQuestionKey, list);
        }}
        canEditPersonal={canEditPersonalPreanswers}
        preanswersCapLimit={preanswersCapLimit}
        onSelect={(answer) => {
          if (activeQuestionKey) {
            updateAnswer(activeQuestionKey, answer);
          }
        }}
        questionLabel={
          activeQuestionKey
            ? questions.find((q) => q.key === activeQuestionKey)?.label || 'שאלה'
            : 'שאלה'
        }
      />
    </form>
  );
}

// Export footer component for external rendering
export function NewSessionFormFooter({ onSubmit, onCancel, isSubmitting = false, isFormValid = false }) {
  return (
    <div className="flex flex-col-reverse gap-sm sm:flex-row-reverse sm:justify-end">
      <Button type="button" disabled={isSubmitting || !isFormValid} className="gap-xs shadow-md hover:shadow-lg transition-shadow" onClick={onSubmit}>
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        שמירת מפגש
      </Button>
      <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting} className="hover:shadow-sm">
        ביטול
      </Button>
    </div>
  );
}

