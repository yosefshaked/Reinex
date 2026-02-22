import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { fetchSettings } from '@/features/settings/api/settings.js';
import { useInstructors } from '@/hooks/useOrgData.js';
import { isAdminRole, normalizeMembershipRole } from '@/features/students/utils/endpoints.js';
import { useStudentTags } from '@/features/students/hooks/useStudentTags.js';
import { buildTagDisplayList } from '@/features/students/utils/tags.js';
import { Trash2 } from 'lucide-react';
import { formatStudentName } from '@/features/students/utils/name-utils.js';

const APPROVAL_AGREEMENT_TEXT = 'אני מאשר/ת שקראתי את האינטייק של התלמיד/ה וביצעתי שיחת קליטה עם האפוטרופוס.';

function IntakeQueueWidget({
  unassignedCount,
  assignedCount,
  assignedToMeCount,
  adminAssignedToMeCount,
  totalCount,
  onOpen,
  isLoading = false,
  showAdminSplit = false,
  showAssignedToMe = false,
}) {
  const openLabel = 'פתח תור';
  const openAriaLabel = 'פתח את תור הקליטה';
  const buttonClasses =
    'flex w-full flex-col items-center justify-center gap-1 p-4 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-neutral-200 overflow-hidden flex flex-col h-full w-full max-w-xl">
      <div className="bg-neutral-50 px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
        <span className="font-bold text-neutral-700">תלמידים לקליטה</span>
        <button
          type="button"
          className="text-primary text-xs hover:underline"
          onClick={() => onOpen('all')}
          aria-label={openAriaLabel}
        >
          {openLabel}
        </button>
      </div>

      <div className="flex-1">
        {showAdminSplit ? (
          <div className="grid grid-cols-2 divide-x divide-x-reverse divide-neutral-100">
            <button
              type="button"
              className={`${buttonClasses} hover:bg-neutral-50`}
              onClick={() => onOpen('unassigned')}
              aria-label="פתח תור עבור תלמידים ללא שיוך מדריך"
            >
              <span
                className={`text-3xl font-extrabold text-neutral-800 ${isLoading ? 'animate-pulse' : ''}`}
                aria-live="polite"
              >
                {isLoading ? '—' : unassignedCount}
              </span>
              <span className="text-sm text-neutral-500 font-medium">ללא שיוך</span>
            </button>

            <button
              type="button"
              className={`${buttonClasses} hover:bg-neutral-50`}
              onClick={() => onOpen('assigned')}
              aria-label="פתח תור עבור תלמידים משויכים"
            >
              <span
                className={`text-3xl font-extrabold text-neutral-800 ${isLoading ? 'animate-pulse' : ''}`}
                aria-live="polite"
              >
                {isLoading ? '—' : assignedCount}
              </span>
              <span className="text-sm text-neutral-500 font-medium">משויכים</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={`${buttonClasses} hover:bg-neutral-50`}
            onClick={() => onOpen('all')}
            aria-label="פתח תור עבור כל הקליטות"
          >
            <span
              className={`text-3xl font-extrabold text-neutral-800 ${isLoading ? 'animate-pulse' : ''}`}
              aria-live="polite"
            >
              {isLoading ? '—' : totalCount}
            </span>
            <span className="text-sm text-neutral-500 font-medium">קליטות ממתינות</span>
          </button>
        )}
      </div>
      {showAssignedToMe ? (
        <div className="border-t border-neutral-100 bg-white px-4 py-3">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
            onClick={() => onOpen('mine')}
            aria-label="הצגת קליטות משויכות אלי"
          >
            <span>משויכים אלי</span>
            <span className="text-base font-semibold text-neutral-900">{isLoading ? '—' : assignedToMeCount}</span>
          </button>
        </div>
      ) : null}
      {showAdminSplit ? (
        <div className="border-t border-neutral-100 bg-white px-4 py-3">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
            onClick={() => onOpen('mine')}
            aria-label="הצגת קליטות משויכות אלי"
          >
            <span>משויכים אלי</span>
            <span className="text-base font-semibold">{isLoading ? '—' : adminAssignedToMeCount}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function normalizeString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return String(value).trim();
}

function normalizeDisplayLabels(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return raw;
}

function normalizeImportantFields(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function formatAnswerEntries(currentAnswers, labelMap, importantFields, { showAll = false } = {}) {
  if (!currentAnswers || typeof currentAnswers !== 'object') {
    return [];
  }

  const excludedKeys = new Set(['intake_html_source', 'intake_date', 'response_id']);
  const importantSet = new Set(importantFields);

  const allEntries = Object.entries(currentAnswers)
    .filter(([key]) => !excludedKeys.has(key))
    .map(([key, value]) => {
      if (value === null || value === undefined) {
        return null;
      }
      if (typeof value === 'object' && !Array.isArray(value)) {
        return null;
      }
      const textValue = Array.isArray(value)
        ? value.filter((entry) => entry !== null && entry !== undefined).join(', ')
        : String(value);
      const trimmedValue = normalizeString(textValue);
      if (!trimmedValue) {
        return null;
      }
      return {
        key,
        label: labelMap[key] || key,
        value: trimmedValue,
      };
    })
    .filter(Boolean);

  if (!importantFields.length) {
    return showAll ? allEntries : [];
  }

  const orderedImportant = importantFields
    .map((fieldKey) => allEntries.find((entry) => entry.key === fieldKey))
    .filter(Boolean);

  if (!showAll) {
    return orderedImportant;
  }

  const remaining = allEntries.filter((entry) => !importantSet.has(entry.key));
  return [...orderedImportant, ...remaining];
}

export default function IntakeReviewQueue() {
  const { session } = useAuth();
  const { activeOrg, activeOrgId, activeOrgHasConnection, tenantClientReady } = useOrg();
  const userId = session?.user?.id || '';
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingStudents, setPendingStudents] = useState([]);
  const [dismissedStudents, setDismissedStudents] = useState([]);
  const [allStudents, setAllStudents] = useState([]);
  const [displayLabels, setDisplayLabels] = useState({});
  const [importantFields, setImportantFields] = useState([]);
  const [approvingIds, setApprovingIds] = useState(() => new Set());
  const [openIds, setOpenIds] = useState(() => new Set());
  const [showAllIds, setShowAllIds] = useState(() => new Set());
  const [expandedAnswers, setExpandedAnswers] = useState(() => new Set());
  const [confirmingStudentId, setConfirmingStudentId] = useState('');
  const [agreementChecked, setAgreementChecked] = useState(false);
  const [instructorFilterId, setInstructorFilterId] = useState('');
  const [retryToken, setRetryToken] = useState(0);
  const [assignmentFilter, setAssignmentFilter] = useState('all');
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [assigningStudentId, setAssigningStudentId] = useState('');
  const [assignForm, setAssignForm] = useState({
    instructorId: '',
    contactName: '',
    contactPhone: '',
    intakeNotes: '',
  });
  const [assignError, setAssignError] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignSuccess, setAssignSuccess] = useState('');
  const [dismissStudentId, setDismissStudentId] = useState('');
  const [dismissError, setDismissError] = useState('');
  const [isDismissing, setIsDismissing] = useState(false);
  const [restoreStudentId, setRestoreStudentId] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeSearch, setMergeSearch] = useState('');
  const [mergeSelections, setMergeSelections] = useState({});
  const [mergeError, setMergeError] = useState('');
  const [mergeSuccess, setMergeSuccess] = useState('');
  const [isMerging, setIsMerging] = useState(false);
  const [mergeConfirmed, setMergeConfirmed] = useState(false);

  const membershipRole = normalizeMembershipRole(activeOrg?.membership?.role);
  const isAdmin = isAdminRole(membershipRole);
  const { instructors, loadingInstructors } = useInstructors({
    enabled: Boolean(session && activeOrgId && activeOrgHasConnection && tenantClientReady && isAdmin),
    orgId: activeOrgId,
    session,
    includeInactive: true,
  });
  const isAdminInstructor = useMemo(() => {
    if (!isAdmin || !userId) {
      return false;
    }
    if (!Array.isArray(instructors) || instructors.length === 0) {
      return false;
    }
    return instructors.some((instructor) => instructor?.id === userId);
  }, [isAdmin, instructors, userId]);
  const { tagOptions, loadTags } = useStudentTags();

  useEffect(() => {
    let cancelled = false;

    const loadQueue = async () => {
      if (!session || !activeOrgId || !activeOrgHasConnection || !tenantClientReady) {
        if (!cancelled) {
          setPendingStudents([]);
          setDismissedStudents([]);
          setError('');
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setError('');

      try {
        await loadTags();
        const [studentsResponse, dismissedResponse, settingsResponse] = await Promise.all([
          authenticatedFetch('students-list', {
            session,
            params: { org_id: activeOrgId, status: 'all' },
          }),
          isAdmin
            ? authenticatedFetch('intake/dismissed', {
              session,
              params: { org_id: activeOrgId },
            })
            : Promise.resolve([]),
          fetchSettings({ session, orgId: activeOrgId }),
        ]);

        if (cancelled) {
          return;
        }

        const roster = Array.isArray(studentsResponse) ? studentsResponse : [];
        const pending = roster.filter((student) => student?.needs_intake_approval === true);
        const dismissed = Array.isArray(dismissedResponse) ? dismissedResponse : [];
        setPendingStudents(pending);
        setDismissedStudents(dismissed);
        setAllStudents(roster);
        setDisplayLabels(normalizeDisplayLabels(settingsResponse?.intake_display_labels));
        setImportantFields(normalizeImportantFields(settingsResponse?.intake_important_fields));
      } catch (loadError) {
        console.error('Failed to load intake queue', loadError);
        if (!cancelled) {
          setError('טעינת תור קליטה נכשלה. נסו שוב.');
          setPendingStudents([]);
          setDismissedStudents([]);
          setAllStudents([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadQueue();

    return () => {
      cancelled = true;
    };
  }, [session, activeOrgId, activeOrgHasConnection, tenantClientReady, retryToken, isAdmin, loadTags]);

  const labelMap = useMemo(() => displayLabels, [displayLabels]);

  const summaryCounts = useMemo(() => {
    return pendingStudents.reduce(
      (accumulator, student) => {
        if (student?.assigned_instructor_id) {
          accumulator.assigned += 1;
        } else {
          accumulator.unassigned += 1;
        }
        if (userId && student?.assigned_instructor_id === userId) {
          accumulator.assignedToMe += 1;
        }
        return accumulator;
      },
      { unassigned: 0, assigned: 0, assignedToMe: 0 }
    );
  }, [pendingStudents, userId]);

  const handleRetry = () => {
    setRetryToken((value) => value + 1);
  };

  const handleApprove = async (studentId, agreement) => {
    if (!session || !activeOrgId) {
      return;
    }
    if (!agreement?.acknowledged) {
      setError('יש לאשר את הצהרת ההסכמה לפני האישור.');
      return;
    }

    setApprovingIds((prev) => new Set(prev).add(studentId));
    setError('');

    try {
      await authenticatedFetch('intake/approve', {
        method: 'POST',
        session,
        body: {
          org_id: activeOrgId,
          student_id: studentId,
          agreement,
        },
      });
      setPendingStudents((prev) => prev.filter((student) => student.id !== studentId));
    } catch (approveError) {
      console.error('Failed to approve intake', approveError);
      setError('אישור קליטה נכשל. נסו שוב.');
    } finally {
      setApprovingIds((prev) => {
        const next = new Set(prev);
        next.delete(studentId);
        return next;
      });
    }
  };

  const toggleSection = (studentId, isOpen) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (isOpen) {
        next.add(studentId);
      } else {
        next.delete(studentId);
      }
      return next;
    });
  };

  const toggleShowAll = (studentId) => {
    setShowAllIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  };

  const toggleAnswer = (answerKey) => {
    setExpandedAnswers((prev) => {
      const next = new Set(prev);
      if (next.has(answerKey)) {
        next.delete(answerKey);
      } else {
        next.add(answerKey);
      }
      return next;
    });
  };

  const handleAnswerKeyDown = (event, answerKey, canExpand) => {
    if (!canExpand) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleAnswer(answerKey);
    }
  };

  const openConfirmDialog = (studentId) => {
    setConfirmingStudentId(studentId);
    setAgreementChecked(false);
  };

  const closeConfirmDialog = (open) => {
    if (!open) {
      setConfirmingStudentId('');
      setAgreementChecked(false);
    }
  };

  const confirmStudent = pendingStudents.find((student) => student.id === confirmingStudentId);
  const isConfirmingApproval = confirmingStudentId ? approvingIds.has(confirmingStudentId) : false;

  const handleConfirmApprove = async () => {
    if (!confirmingStudentId || !agreementChecked) {
      return;
    }
    await handleApprove(confirmingStudentId, {
      acknowledged: true,
      acknowledged_at: new Date().toISOString(),
      statement: APPROVAL_AGREEMENT_TEXT,
    });
    setConfirmingStudentId('');
    setAgreementChecked(false);
  };

  const instructorMap = useMemo(() => {
    return new Map((instructors || []).filter((entry) => entry?.id).map((entry) => [entry.id, entry]));
  }, [instructors]);


  const filteredStudents = useMemo(() => {
    let filtered = pendingStudents;
    if (assignmentFilter === 'unassigned') {
      filtered = filtered.filter((student) => !student?.assigned_instructor_id);
    }
    if (assignmentFilter === 'assigned') {
      filtered = filtered.filter((student) => student?.assigned_instructor_id);
    }
    if (assignmentFilter === 'mine') {
      filtered = filtered.filter((student) => student?.assigned_instructor_id === userId);
    }
    if (!isAdmin || !instructorFilterId) {
      return filtered;
    }
    if (instructorFilterId === 'unassigned') {
      return filtered.filter((student) => !student?.assigned_instructor_id);
    }
    return filtered.filter((student) => student?.assigned_instructor_id === instructorFilterId);
  }, [pendingStudents, assignmentFilter, instructorFilterId, isAdmin, userId]);

  const summaryStatus = (() => {
    if (isLoading) {
      return 'טוען קליטות ממתינות...';
    }
    if (error) {
      return 'אירעה שגיאה בטעינת תור הקליטה.';
    }
    if (pendingStudents.length === 0) {
      return 'אין קליטות שממתינות לאישור.';
    }
    return `נמצאו ${pendingStudents.length} קליטות ממתינות לבדיקה.`;
  })();

  const handleOpenQueue = (filterType) => {
    const normalizedFilter = filterType === 'new' ? 'unassigned' : filterType === 'existing' ? 'assigned' : filterType;
    setIsQueueOpen(true);
    setAssignmentFilter(normalizedFilter);
    if (normalizedFilter !== 'all') {
      setInstructorFilterId('');
    }
  };

  const handleQueueOpenChange = (open) => {
    setIsQueueOpen(open);
    if (!open) {
      setAssignmentFilter('all');
    }
  };

  const openAssignDialog = (student) => {
    if (!student?.id) {
      return;
    }
    setAssigningStudentId(student.id);
    setAssignError('');
    setAssignSuccess('');
    setAssignForm({
      instructorId: student.assigned_instructor_id || '',
      contactName: student.contact_name || '',
      contactPhone: student.contact_phone || '',
      intakeNotes: student?.metadata?.intake_notes || '',
    });
  };

  const handleAssignDialogChange = (open) => {
    if (!open) {
      setAssigningStudentId('');
      setAssignError('');
      setAssignSuccess('');
      setAssignForm({
        instructorId: '',
        contactName: '',
        contactPhone: '',
        intakeNotes: '',
      });
    }
  };

  const handleAssignChange = (field, value) => {
    setAssignForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleAssignSave = async () => {
    if (!session || !activeOrgId || !assigningStudentId) {
      return;
    }
    if (!assignForm.instructorId) {
      setAssignError('יש לבחור מדריך לפני השמירה.');
      return;
    }

    setIsAssigning(true);
    setAssignError('');
    setAssignSuccess('');

    try {
      const updatedStudent = await authenticatedFetch('students-list', {
        method: 'PUT',
        session,
        body: {
          org_id: activeOrgId,
          student_id: assigningStudentId,
          assigned_instructor_id: assignForm.instructorId,
          contact_name: assignForm.contactName,
          contact_phone: assignForm.contactPhone,
          intake_notes: assignForm.intakeNotes,
        },
      });

      setPendingStudents((prev) =>
        prev.map((student) => (student.id === assigningStudentId ? { ...student, ...updatedStudent } : student))
      );

      setAssignSuccess('השמירה בוצעה והמדריך שויך לקליטה.');
      setAssignError('');
      handleRetry();
    } catch (saveError) {
      console.error('Failed to assign intake instructor', saveError);
      setAssignError('שיוך המדריך נכשל. נסו שוב.');
    } finally {
      setIsAssigning(false);
    }
  };

  const openDismissDialog = (studentId) => {
    setDismissStudentId(studentId);
    setDismissError('');
  };

  const handleDismissDialogChange = (open) => {
    if (!open) {
      setDismissStudentId('');
      setDismissError('');
    }
  };

  const handleDismissIntake = async () => {
    if (!session || !activeOrgId || !dismissStudentId) {
      return;
    }
    setIsDismissing(true);
    setDismissError('');

    try {
      const updatedStudent = await authenticatedFetch('intake/dismiss', {
        method: 'POST',
        session,
        body: {
          org_id: activeOrgId,
          student_id: dismissStudentId,
        },
      });

      setPendingStudents((prev) => prev.filter((student) => student.id !== dismissStudentId));
      if (updatedStudent?.id) {
        setDismissedStudents((prev) => {
          const next = prev.filter((student) => student.id !== updatedStudent.id);
          return [...next, updatedStudent];
        });
      }
      setDismissStudentId('');
      handleRetry();
    } catch (dismissErrorResponse) {
      console.error('Failed to dismiss intake submission', dismissErrorResponse);
      setDismissError('הסרת הקליטה נכשלה. נסו שוב.');
    } finally {
      setIsDismissing(false);
    }
  };

  const openRestoreDialog = (studentId) => {
    setRestoreStudentId(studentId);
    setRestoreError('');
  };

  const handleRestoreDialogChange = (open) => {
    if (!open) {
      setRestoreStudentId('');
      setRestoreError('');
    }
  };

  const handleRestoreIntake = async () => {
    if (!session || !activeOrgId || !restoreStudentId) {
      return;
    }

    setIsRestoring(true);
    setRestoreError('');

    try {
      const updatedStudent = await authenticatedFetch('intake/restore', {
        method: 'POST',
        session,
        body: {
          org_id: activeOrgId,
          student_id: restoreStudentId,
        },
      });

      setDismissedStudents((prev) => prev.filter((student) => student.id !== restoreStudentId));
      if (updatedStudent?.id) {
        setPendingStudents((prev) => {
          const next = prev.filter((student) => student.id !== updatedStudent.id);
          return [...next, updatedStudent];
        });
      }

      setRestoreStudentId('');
      handleRetry();
    } catch (restoreErrorResponse) {
      console.error('Failed to restore intake submission', restoreErrorResponse);
      setRestoreError('שחזור הקליטה נכשל. נסו שוב.');
    } finally {
      setIsRestoring(false);
    }
  };

  const openMergeDialog = (studentId) => {
    setMergeSourceId(studentId);
    setMergeTargetId('');
    setMergeSearch('');
    setMergeSelections({});
    setMergeError('');
    setMergeSuccess('');
  };

  const handleMergeDialogChange = (open) => {
    if (!open) {
      setMergeSourceId('');
      setMergeTargetId('');
      setMergeSearch('');
      setMergeSelections({});
      setMergeError('');
      setMergeSuccess('');
      setIsMerging(false);
      setMergeConfirmed(false);
    }
  };

  const mergeSource = useMemo(
    () => allStudents.find((student) => student.id === mergeSourceId),
    [allStudents, mergeSourceId]
  );

  const mergeTarget = useMemo(
    () => allStudents.find((student) => student.id === mergeTargetId),
    [allStudents, mergeTargetId]
  );

  const mergeCandidates = useMemo(() => {
    if (!mergeSource) {
      return [];
    }
    const query = mergeSearch.trim().toLowerCase();
    const candidates = allStudents.filter((student) => student.id !== mergeSource.id);
    if (!query) {
      return candidates.slice(0, 10);
    }
    return candidates.filter((student) => {
      const name = formatStudentName(student).toLowerCase();
      const identityNumber = (student.identity_number || student.national_id || '').toLowerCase();
      const phone = (student.contact_phone || '').toLowerCase();
      return name.includes(query) || identityNumber.includes(query) || phone.includes(query);
    }).slice(0, 10);
  }, [allStudents, mergeSearch, mergeSource]);

  const handleMergeSelectionChange = (field, value) => {
    setMergeSelections((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const buildMergedTags = (selection, sourceTags, targetTags) => {
    if (selection === 'combined') {
      const combined = new Set([...(sourceTags || []), ...(targetTags || [])]);
      return Array.from(combined);
    }
    return selection === 'source' ? (sourceTags || []) : (targetTags || []);
  };

  const resolveInstructorName = (id) => {
    if (!id) {
      return 'לא הוקצה מדריך';
    }
    const instructor = instructorMap.get(id);
    return instructor?.name || instructor?.email || 'מדריך לא זמין';
  };

  const resolveTagLabel = (tags) => {
    const displayList = buildTagDisplayList(tags, tagOptions);
    if (!displayList.length) {
      return '—';
    }
    return displayList.map((tag) => tag.name).join(', ');
  };

  const handleMergeSubmit = async () => {
    if (!session || !activeOrgId || !mergeSource || !mergeTarget) {
      return;
    }
    if (!mergeConfirmed) {
      setMergeError('יש לאשר את הודעת האזהרה לפני המיזוג.');
      return;
    }

    setIsMerging(true);
    setMergeError('');
    setMergeSuccess('');

    const selections = {
      name: mergeSelections.name || 'source',
      national_id: mergeSelections.national_id || 'source',
      contact_name: mergeSelections.contact_name || 'source',
      contact_phone: mergeSelections.contact_phone || 'source',
      assigned_instructor_id: mergeSelections.assigned_instructor_id || 'source',
      notes: mergeSelections.notes || 'source',
      tags: mergeSelections.tags || 'source',
    };

    const mergedPayload = {
      name: selections.name === 'source' ? mergeSource.name : mergeTarget.name,
      national_id: selections.national_id === 'source' ? mergeSource.national_id : mergeTarget.national_id,
      contact_name: selections.contact_name === 'source' ? mergeSource.contact_name : mergeTarget.contact_name,
      contact_phone: selections.contact_phone === 'source' ? mergeSource.contact_phone : mergeTarget.contact_phone,
      assigned_instructor_id: selections.assigned_instructor_id === 'source'
        ? mergeSource.assigned_instructor_id
        : mergeTarget.assigned_instructor_id,
      notes: selections.notes === 'source' ? mergeSource.notes : mergeTarget.notes,
      tags: buildMergedTags(selections.tags, mergeSource.tags, mergeTarget.tags),
    };

    try {
      const result = await authenticatedFetch('students-merge', {
        method: 'POST',
        session,
        body: {
          org_id: activeOrgId,
          source_student_id: mergeSource.id,
          target_student_id: mergeTarget.id,
          fields: mergedPayload,
        },
      });

      const updatedTarget = result?.target;
      const updatedSource = result?.source;

      if (updatedTarget?.id) {
        setPendingStudents((prev) => {
          const without = prev.filter((student) => student.id !== updatedTarget.id);
          return updatedTarget.needs_intake_approval ? [...without, updatedTarget] : without;
        });
      }

      if (updatedSource?.id) {
        setPendingStudents((prev) => prev.filter((student) => student.id !== updatedSource.id));
        setDismissedStudents((prev) => {
          const next = prev.filter((student) => student.id !== updatedSource.id);
          return [...next, updatedSource];
        });
      }

      setAllStudents((prev) => {
        const next = prev.filter((student) => student.id !== mergeSource.id && student.id !== mergeTarget.id);
        if (updatedTarget?.id) {
          next.push(updatedTarget);
        }
        if (updatedSource?.id) {
          next.push(updatedSource);
        }
        return next;
      });

      setMergeSuccess('המיזוג הושלם והרשומה עודכנה.');
      setMergeSourceId('');
      setMergeConfirmed(false);
      handleRetry();
    } catch (mergeErrorResponse) {
      console.error('Failed to merge intake student', mergeErrorResponse);
      setMergeError('המיזוג נכשל. נסו שוב.');
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <IntakeQueueWidget
        unassignedCount={summaryCounts.unassigned}
        assignedCount={summaryCounts.assigned}
        assignedToMeCount={summaryCounts.assignedToMe}
        adminAssignedToMeCount={summaryCounts.assignedToMe}
        totalCount={pendingStudents.length}
        onOpen={handleOpenQueue}
        isLoading={isLoading}
        showAdminSplit={isAdmin}
        showAssignedToMe={isAdminInstructor}
      />

      <div className="space-y-2 text-xs text-neutral-500">
        <p className="font-medium text-neutral-600">{summaryStatus}</p>
        {isAdmin ? <p>חלוקה לפי תלמידים ללא שיוך מדריך מול תלמידים משויכים.</p> : null}
      </div>

      {error ? (
        <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <Button type="button" size="sm" variant="outline" onClick={handleRetry}>
            נסו שוב
          </Button>
        </div>
      ) : null}

      <Dialog open={isQueueOpen} onOpenChange={handleQueueOpenChange}>
        <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>תור קליטת תלמידים</DialogTitle>
            <DialogDescription>סקירת קליטות ממתינות, סינון וביצוע פעולות מנהל.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {isAdmin ? (
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-semibold text-slate-900">תצוגת תור</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant={assignmentFilter === 'unassigned' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleOpenQueue('unassigned')}
                    >
                      ללא שיוך
                    </Button>
                    <Button
                      type="button"
                      variant={assignmentFilter === 'assigned' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleOpenQueue('assigned')}
                    >
                      משויכים
                    </Button>
                    <Button
                      type="button"
                      variant={assignmentFilter === 'all' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleOpenQueue('all')}
                    >
                      כל הקליטות
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
            {isAdmin ? (
              <div className="flex flex-col gap-2 rounded-lg border border-red-100 bg-white p-3 text-sm text-slate-700 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="font-semibold text-slate-900">סינון לפי מדריך</p>
                  <p className="text-xs text-slate-500">בחרו מדריך, לא משויך, או כל הקליטות.</p>
                </div>
                <div className="w-full sm:max-w-xs">
                  <label htmlFor="intake-instructor-filter" className="sr-only">סינון מדריך</label>
                  <Select
                    value={instructorFilterId || 'all'}
                    onValueChange={(value) => setInstructorFilterId(value === 'all' ? '' : value)}
                    disabled={loadingInstructors}
                  >
                    <SelectTrigger id="intake-instructor-filter">
                      <SelectValue placeholder={loadingInstructors ? 'טוען מדריכים...' : 'כל המדריכים'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">כל המדריכים</SelectItem>
                      <SelectItem value="unassigned">לא משויך</SelectItem>
                      {(instructors || []).map((instructor) => (
                        instructor?.id ? (
                          <SelectItem key={instructor.id} value={instructor.id}>
                            {instructor.name || instructor.email || 'מדריך ללא שם'}
                          </SelectItem>
                        ) : null
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}

            {filteredStudents.length === 0 && !isLoading ? (
              <div className="rounded-md border border-red-100 bg-white p-3 text-sm text-slate-600">
                אין קליטות תואמות למסנן שנבחר.
              </div>
            ) : null}
            {filteredStudents.map((student) => {
              const isSectionOpen = openIds.has(student.id);
              const showAll = showAllIds.has(student.id);
              const answers = formatAnswerEntries(
                student?.intake_responses?.current,
                labelMap,
                importantFields,
                { showAll }
              );
              const isApproving = approvingIds.has(student.id);
              const isAssignedToUser = Boolean(session?.user?.id) && student?.assigned_instructor_id === session.user.id;
              const canApprove = Boolean(student?.assigned_instructor_id) && isAssignedToUser;
              const needsAssignment = !student?.assigned_instructor_id;
              const instructor = isAdmin ? instructorMap.get(student?.assigned_instructor_id) : null;
              const instructorName = instructor?.name || instructor?.email || (student?.assigned_instructor_id ? 'מדריך לא זמין' : 'לא הוקצה מדריך');

              return (
                <div key={student.id} className="rounded-xl border border-red-200 bg-white p-4 shadow-sm">
                  <details
                    className="group"
                    open={isSectionOpen}
                    onToggle={(event) => toggleSection(student.id, event.currentTarget.open)}
                  >
                    <summary className="cursor-pointer list-none space-y-3 focus-visible:outline-none">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-semibold text-slate-900">{formatStudentName(student)}</p>
                            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                              {needsAssignment ? 'דורש שיוך מדריך' : 'מוכן לאישור מדריך'}
                            </span>
                          </div>
                          <dl className="flex flex-col gap-3 text-sm text-slate-700 sm:flex-row sm:flex-wrap sm:items-center">
                            <div className="flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1">
                              <dt className="font-medium text-slate-500">מספר זהות</dt>
                              <dd className="font-semibold text-slate-800">{student.identity_number || student.national_id || 'לא צוין'}</dd>
                            </div>
                            <div className="flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1">
                              <dt className="font-medium text-slate-500">שם איש קשר</dt>
                              <dd className="font-semibold text-slate-800">{student.contact_name || 'לא צוין'}</dd>
                            </div>
                            <div className="flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1">
                              <dt className="font-medium text-slate-500">טלפון איש קשר</dt>
                              <dd className="font-semibold text-slate-800">{student.contact_phone || 'לא צוין'}</dd>
                            </div>
                            {isAdmin ? (
                              <div className="flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-blue-800">
                                <dt className="font-medium text-blue-600">מדריך</dt>
                                <dd className="font-semibold">{instructorName}</dd>
                              </div>
                            ) : null}
                          </dl>
                        </div>
                        <span className="text-xs font-medium text-slate-500">
                          {isSectionOpen ? 'לחצו לסגירה' : 'לחצו לפתיחה'}
                        </span>
                      </div>
                    </summary>

                    <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-2">
                          <Link
                            to={`/students/${student.id}`}
                            className="text-sm font-semibold text-slate-900 hover:text-primary"
                          >
                            מעבר לכרטיס תלמיד
                          </Link>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {isAdmin ? (
                            <Button
                              type="button"
                              onClick={() => openAssignDialog(student)}
                            >
                              {needsAssignment ? 'שיוך מדריך' : 'עדכון שיוך'}
                            </Button>
                          ) : null}
                          {isAdmin ? (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => openMergeDialog(student.id)}
                            >
                              מיזוג/העברה
                            </Button>
                          ) : null}
                          {isAdmin ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => openDismissDialog(student.id)}
                              aria-label="הסרת קליטה"
                            >
                              <Trash2 className="h-4 w-4 text-red-600" aria-hidden="true" />
                            </Button>
                          ) : null}
                          {canApprove ? (
                            <Button
                              type="button"
                              onClick={() => openConfirmDialog(student.id)}
                              disabled={isApproving}
                            >
                              {isApproving ? 'מאשר...' : 'אישור קליטה'}
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      <div className="rounded-lg bg-slate-50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-slate-800">תשובות מהטופס</p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => toggleShowAll(student.id)}
                          >
                            {showAll ? 'הצג תצוגה מצומצמת' : 'הצג את כל הקליטה'}
                          </Button>
                        </div>
                        {answers.length ? (
                          <div className="mt-3 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
                            {answers.map((entry, index) => {
                              const answerKey = `${student.id}-${entry.label}-${index}`;
                              const isLongAnswer = entry.value.length > 120 || entry.value.includes('\n');
                              const isExpandedAnswer = expandedAnswers.has(answerKey);
                              return (
                                <div key={answerKey} className="rounded-md border border-slate-200 bg-white p-3">
                                  <p className="text-xs font-semibold text-slate-500">{entry.label}</p>
                                  <p
                                    className={`mt-1 text-sm text-slate-700 ${
                                      isLongAnswer ? 'cursor-pointer' : ''
                                    } ${isExpandedAnswer ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}
                                    onClick={isLongAnswer ? () => toggleAnswer(answerKey) : undefined}
                                    onKeyDown={(event) => handleAnswerKeyDown(event, answerKey, isLongAnswer)}
                                    role={isLongAnswer ? 'button' : undefined}
                                    tabIndex={isLongAnswer ? 0 : undefined}
                                  >
                                    {entry.value}
                                  </p>
                                  {isLongAnswer && !isExpandedAnswer ? (
                                    <p className="mt-1 text-xs text-slate-400">לחצו להצגה מלאה</p>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-slate-500">
                            {showAll ? 'אין תשובות זמינות להצגה.' : 'לא הוגדרו שדות חשובים להצגה.'}
                          </p>
                        )}
                      </div>
                    </div>
                  </details>
                </div>
              );
            })}

            {isAdmin ? (
              <div className="space-y-3 border-t border-slate-200 pt-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-slate-900">קליטות שהוסרו</h3>
                    <p className="text-xs text-slate-500">לחצו כדי להציג ולשחזר קליטות שהוסרו.</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowDismissed((prev) => !prev)}
                  >
                    {showDismissed ? 'הסתר קליטות שהוסרו' : 'הצג קליטות שהוסרו'}
                  </Button>
                </div>
                {showDismissed ? (
                  dismissedStudents.length === 0 ? (
                    <div className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-600">
                      אין קליטות שהוסרו להצגה.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {dismissedStudents.map((student) => {
                        const dismissalMeta = student?.metadata?.intake_dismissal;
                        const dismissedAt = dismissalMeta?.at
                          ? new Date(dismissalMeta.at).toLocaleString('he-IL')
                          : '';
                        return (
                          <div key={student.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="space-y-1">
                                <p className="text-sm font-semibold text-slate-900">{formatStudentName(student)}</p>
                                <p className="text-xs text-slate-600">
                                  {dismissedAt ? `הוסר בתאריך ${dismissedAt}` : 'הוסר מהתור'}
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => openRestoreDialog(student.id)}
                              >
                                שחזור קליטה
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : null}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(assigningStudentId)} onOpenChange={handleAssignDialogChange}>
        <DialogContent className="sm:max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>שיוך מדריך ופרטים לקליטה</DialogTitle>
            <DialogDescription>שיוך מדריך ועדכון פרטי קשר לפני אישור הקליטה.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              השיוך מאפשר למדריך לראות את הקליטה ולאשר אותה.
            </p>
            {assignError ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {assignError}
              </div>
            ) : null}
            {assignSuccess ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                {assignSuccess}
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="intake-assign-instructor">מדריך משויך</Label>
              <Select
                value={assignForm.instructorId}
                onValueChange={(value) => handleAssignChange('instructorId', value)}
                disabled={loadingInstructors}
              >
                <SelectTrigger id="intake-assign-instructor">
                  <SelectValue placeholder={loadingInstructors ? 'טוען מדריכים...' : 'בחרו מדריך'} />
                </SelectTrigger>
                <SelectContent>
                  {(instructors || []).map((instructor) => (
                    instructor?.id ? (
                      <SelectItem key={instructor.id} value={instructor.id}>
                        {instructor.name || instructor.email || 'מדריך ללא שם'}
                      </SelectItem>
                    ) : null
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="intake-assign-contact-name">שם איש קשר</Label>
                <Input
                  id="intake-assign-contact-name"
                  value={assignForm.contactName}
                  onChange={(event) => handleAssignChange('contactName', event.target.value)}
                  placeholder="שם איש קשר"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="intake-assign-contact-phone">טלפון איש קשר</Label>
                <Input
                  id="intake-assign-contact-phone"
                  value={assignForm.contactPhone}
                  onChange={(event) => handleAssignChange('contactPhone', event.target.value)}
                  placeholder="05X-XXXXXXX"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="intake-assign-notes">הערות למדריך</Label>
              <Textarea
                id="intake-assign-notes"
                value={assignForm.intakeNotes}
                onChange={(event) => handleAssignChange('intakeNotes', event.target.value)}
                rows={3}
                placeholder="הוסיפו הנחיות או הקשר לקליטה"
              />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleAssignDialogChange(false)}
                disabled={isAssigning}
              >
                ביטול
              </Button>
              <Button
                type="button"
                onClick={handleAssignSave}
                disabled={isAssigning || !assignForm.instructorId}
              >
                {isAssigning ? 'שומר...' : 'שמירה ושיוך'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(confirmingStudentId)} onOpenChange={closeConfirmDialog}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>אישור קליטה</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmStudent
                ? `לפני אישור קליטה עבור ${formatStudentName(confirmStudent)}, יש לאשר את הצהרת ההסכמה.`
                : 'לפני אישור קליטה יש לאשר את הצהרת ההסכמה.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <Checkbox
              id="intake-approval-agreement"
              checked={agreementChecked}
              onCheckedChange={(value) => setAgreementChecked(value === true)}
            />
            <Label htmlFor="intake-approval-agreement" className="text-sm text-slate-700">
              {APPROVAL_AGREEMENT_TEXT}
            </Label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>בטל</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmApprove}
              disabled={!agreementChecked || isConfirmingApproval}
            >
              {isConfirmingApproval ? 'מאשר...' : 'מאשר/ת קליטה'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(dismissStudentId)} onOpenChange={handleDismissDialogChange}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>הסרת קליטה</AlertDialogTitle>
            <AlertDialogDescription>
              הסרת הקליטה תוציא את הרשומה מתור הקליטה. ניתן להוסיף קליטה מחדש בעת הצורך.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dismissError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {dismissError}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleDismissIntake} disabled={isDismissing}>
              {isDismissing ? 'מסיר...' : 'הסרת קליטה'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(restoreStudentId)} onOpenChange={handleRestoreDialogChange}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>שחזור קליטה</AlertDialogTitle>
            <AlertDialogDescription>
              שחזור יחזיר את הקליטה לתור לבדיקה ואישור.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {restoreError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {restoreError}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestoreIntake} disabled={isRestoring}>
              {isRestoring ? 'משחזר...' : 'שחזור קליטה'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={Boolean(mergeSourceId)} onOpenChange={handleMergeDialogChange}>
        <DialogContent className="sm:max-w-4xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>מיזוג/העברת קליטה לתלמיד קיים</DialogTitle>
            <DialogDescription>בחרו תלמיד יעד והגדירו אילו ערכים לשמור במיזוג.</DialogDescription>
          </DialogHeader>
          {mergeError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {mergeError}
            </div>
          ) : null}
          {mergeSuccess ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              {mergeSuccess}
            </div>
          ) : null}
          {mergeSource ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="merge-student-search">חיפוש תלמיד יעד</Label>
                <Input
                  id="merge-student-search"
                  value={mergeSearch}
                  onChange={(event) => setMergeSearch(event.target.value)}
                  placeholder="חיפוש לפי שם / תעודת זהות / טלפון"
                />
                <div className="max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-white">
                  {mergeCandidates.length === 0 ? (
                    <p className="p-3 text-sm text-slate-500">לא נמצאו תלמידים תואמים.</p>
                  ) : (
                    mergeCandidates.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-slate-50 ${
                          mergeTargetId === candidate.id ? 'bg-slate-100' : ''
                        }`}
                        onClick={() => setMergeTargetId(candidate.id)}
                      >
                        <span>{candidate.name || 'תלמיד ללא שם'}</span>
                        <span className="text-xs text-slate-500">
                          {candidate.identity_number || candidate.national_id || 'ללא ת״ז'}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {mergeTarget ? (
                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold text-slate-500">קליטה חדשה</p>
                      <p className="text-sm font-semibold text-slate-900">{mergeSource.name || 'לא צוין'}</p>
                      <p className="text-xs text-slate-600">{mergeSource.identity_number || mergeSource.national_id || 'ללא ת״ז'}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="text-xs font-semibold text-slate-500">תלמיד יעד</p>
                      <p className="text-sm font-semibold text-slate-900">{mergeTarget.name || 'לא צוין'}</p>
                      <p className="text-xs text-slate-600">{mergeTarget.identity_number || mergeTarget.national_id || 'ללא ת״ז'}</p>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-sm font-semibold text-slate-900">בחירת שדות לשמירה</p>
                    {[
                      { key: 'name', label: 'שם', source: mergeSource.name, target: mergeTarget.name },
                      { key: 'national_id', label: 'תעודת זהות', source: mergeSource.national_id, target: mergeTarget.national_id },
                      { key: 'contact_name', label: 'שם איש קשר', source: mergeSource.contact_name, target: mergeTarget.contact_name },
                      { key: 'contact_phone', label: 'טלפון איש קשר', source: mergeSource.contact_phone, target: mergeTarget.contact_phone },
                      {
                        key: 'assigned_instructor_id',
                        label: 'מדריך משויך',
                        source: resolveInstructorName(mergeSource.assigned_instructor_id),
                        target: resolveInstructorName(mergeTarget.assigned_instructor_id),
                      },
                      { key: 'notes', label: 'הערות', source: mergeSource.notes, target: mergeTarget.notes },
                    ].map((field) => (
                      <div key={field.key} className="grid gap-2 border-b border-slate-100 pb-2 md:grid-cols-[160px_1fr_1fr]">
                        <p className="text-sm font-medium text-slate-700">{field.label}</p>
                        <button
                          type="button"
                          className={`rounded-md border px-2 py-1 text-sm text-slate-700 ${
                            (mergeSelections[field.key] || 'source') === 'source'
                              ? 'border-primary bg-primary/10'
                              : 'border-slate-200'
                          }`}
                          onClick={() => handleMergeSelectionChange(field.key, 'source')}
                        >
                          {field.source || '—'}
                        </button>
                        <button
                          type="button"
                          className={`rounded-md border px-2 py-1 text-sm text-slate-700 ${
                            mergeSelections[field.key] === 'target'
                              ? 'border-primary bg-primary/10'
                              : 'border-slate-200'
                          }`}
                          onClick={() => handleMergeSelectionChange(field.key, 'target')}
                        >
                          {field.target || '—'}
                        </button>
                      </div>
                    ))}

                    <div className="grid gap-2 md:grid-cols-[160px_1fr_1fr]">
                      <p className="text-sm font-medium text-slate-700">תגיות</p>
                      <button
                        type="button"
                        className={`rounded-md border px-2 py-1 text-sm text-slate-700 ${
                          (mergeSelections.tags || 'source') === 'source'
                            ? 'border-primary bg-primary/10'
                            : 'border-slate-200'
                        }`}
                        onClick={() => handleMergeSelectionChange('tags', 'source')}
                      >
                        {resolveTagLabel(mergeSource.tags)}
                      </button>
                      <button
                        type="button"
                        className={`rounded-md border px-2 py-1 text-sm text-slate-700 ${
                          mergeSelections.tags === 'target'
                            ? 'border-primary bg-primary/10'
                            : 'border-slate-200'
                        }`}
                        onClick={() => handleMergeSelectionChange('tags', 'target')}
                      >
                        {resolveTagLabel(mergeTarget.tags)}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleMergeSelectionChange('tags', 'combined')}
                      >
                        שילוב תגיות
                      </Button>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => handleMergeDialogChange(false)}>
                      ביטול
                    </Button>
                    <Button type="button" onClick={handleMergeSubmit} disabled={isMerging || !mergeConfirmed}>
                      {isMerging ? 'ממזג...' : 'ביצוע מיזוג'}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-500">טוען נתוני קליטה...</p>
          )}
          {mergeTarget ? (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p className="font-semibold">שימו לב:</p>
              <p>
                המיזוג מוחק את רשומת המקור ומעביר את הקליטה לתלמיד היעד. הפעולה אינה הפיכה,
                ולכן יש לוודא שהמיזוג מתבצע מהתלמיד הנכון אל התלמיד הנכון.
              </p>
              <div className="mt-3 flex items-start gap-2">
                <Checkbox
                  id="merge-confirmation"
                  checked={mergeConfirmed}
                  onCheckedChange={(value) => setMergeConfirmed(value === true)}
                />
                <Label htmlFor="merge-confirmation" className="text-sm">
                  אני מאשר/ת שהבנתי שהמיזוג מוחק את רשומת המקור ואינו ניתן לשחזור.
                </Label>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
