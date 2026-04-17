import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Pencil,
  Send,
  ExternalLink,
  Mail,
  MessageCircle,
  Clock3,
  UserRound,
  Sparkles,
  CalendarPlus2,
  ArrowLeft,
  AlertTriangle,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import PageLayout from '@/components/ui/PageLayout.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ComboBoxField, SelectField, TextAreaField, TextField } from '@/components/ui/forms-ui';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { normalizeMembershipRole, isAdminOrOffice, isAdminRole } from '@/features/students/utils/endpoints.js';
import AddStudentForm, { AddStudentFormFooter } from '@/features/admin/components/AddStudentForm.jsx';
import { toast } from 'sonner';
import { toAgorot } from '@/lib/currency.js';

const DAYS_OF_WEEK = [
  { value: 0, label: 'ראשון', labelShort: 'א' },
  { value: 1, label: 'שני', labelShort: 'ב' },
  { value: 2, label: 'שלישי', labelShort: 'ג' },
  { value: 3, label: 'רביעי', labelShort: 'ד' },
  { value: 4, label: 'חמישי', labelShort: 'ה' },
  { value: 5, label: 'שישי', labelShort: 'ו' },
  { value: 6, label: 'שבת', labelShort: 'ש' },
];

const STATUS_OPTIONS = [
  { value: 'new', label: 'חדש' },
  { value: 'open', label: 'פתוח' },
  { value: 'matched', label: 'שובץ' },
  { value: 'closed', label: 'בוטל' },
];

const STATUS_FILTER_OPTIONS = [
  { value: 'active', label: 'חדשים ופתוחים' },
  { value: 'new', label: 'חדשים בלבד' },
  { value: 'open', label: 'פתוחים בלבד' },
  { value: 'matched', label: 'שובצו בלבד' },
  { value: 'closed', label: 'בוטלו בלבד' },
  { value: 'all', label: 'כולל שובצו/בוטלו' },
];

const STATUS_BADGE_VARIANTS = {
  new: 'default',
  open: 'secondary',
  matched: 'default',
  closed: 'outline',
};
const SUGGESTION_MODE_OPTIONS = [
  { value: 'capacity', label: 'מקום פנוי בתבניות' },
  { value: 'empty_slots', label: 'חלונות פנויים בלו״ז' },
];

const EMPTY_RANGE = { start: '', end: '' };
const FORM_USAGE_WAITING_LIST = 'waiting_list_intake';

function buildInitialInviteForm() {
  return {
    formId: '',
    studentFirstName: '',
    studentLastName: '',
    identityNumber: '',
    phone: '',
    email: '',
    deliveryMethod: 'whatsapp',
    serviceId: '',
    allowAdditionalServices: false,
    internalNote: '',
  };
}

function formatInviteExpiry(expiresAt) {
  if (!expiresAt) return '';
  try {
    return new Intl.DateTimeFormat('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jerusalem',
    }).format(new Date(expiresAt));
  } catch {
    return String(expiresAt);
  }
}

function buildInviteWhatsappMessage({ inviteUrl, expiresAt, serviceName, studentName }) {
  const formattedExpiry = formatInviteExpiry(expiresAt);
  return [
    `שלום${studentName ? ` ${studentName}` : ''},`,
    '',
    'שמחים שיצרתם קשר איתנו.',
    serviceName
      ? `כדי שנוכל לקדם את הבקשה להצטרפות לשירות ${serviceName}, נשמח שתמלאו את טופס ההצטרפות לרשימת ההמתנה בקישור הבא:`
      : 'כדי שנוכל לקדם את הבקשה להצטרפות לרשימת ההמתנה, נשמח שתמלאו את הטופס בקישור הבא:',
    inviteUrl,
    '',
    formattedExpiry ? `הקישור זמין עד ${formattedExpiry}.` : '',
    'אם יש שאלות, אפשר לחזור אלינו בהודעה חוזרת.',
  ].filter(Boolean).join('\n');
}

function mapWaitingListInviteErrorMessage(code) {
  switch (String(code || '').trim()) {
    case 'missing_form_id':
    case 'missing_student_first_name':
    case 'missing_student_last_name':
    case 'missing_identity_number':
    case 'missing_delivery_destination':
    case 'missing_desired_service_id':
      return 'יש להשלים את כל שדות החובה לפני שליחת הטופס.';
    case 'form_not_found':
      return 'טופס ההמתנה שנבחר אינו זמין כרגע. אפשר לרענן את הרשימה ולנסות שוב.';
    case 'form_requires_publish_migration':
      return 'מבנה הפרסום של הטופס ישן ודורש מיגרציה. לחצו על "בצע מיגרציה" ואז נסו שוב.';
    case 'form_not_published':
      return 'טופס ההמתנה קיים אך לא פורסם למילוי. יש לפרסם אותו במסך הטפסים ואז לנסות שוב.';
    case 'form_unavailable':
      return 'טופס ההמתנה אינו זמין כרגע (רכיב משותף חסר). יש להשלים את הרכיב החסר ולנסות שוב.';
    case 'form_usage_not_waiting_list':
      return 'הטופס שנבחר אינו מוגדר כטופס רשימת המתנה.';
    case 'failed_to_create_student':
    case 'failed_to_update_student':
    case 'failed_to_prepare_submission':
    case 'failed_to_create_routing':
    case 'failed_to_send_email':
      return 'לא הצלחנו להכין את קישור ההצטרפות כרגע. אפשר לנסות שוב בעוד כמה דקות.';
    default:
      return 'שליחת טופס ההמתנה נכשלה. אפשר לנסות שוב בעוד כמה דקות.';
  }
}

function resolveEntryPerson(entry) {
  return entry?.client_profile || entry?.student || null;
}

function buildStudentName(student) {
  if (!student) return '';
  const name = [student.first_name, student.middle_name, student.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  return name || 'ללא שם';
}

function buildStudentOption(student) {
  const name = buildStudentName(student);
  if (student?.identity_number) {
    return `${name} • ${student.identity_number}`;
  }
  return name;
}

function formatPreferredDays(days = []) {
  if (!Array.isArray(days) || days.length === 0) {
    return '—';
  }
  return days
    .map((day) => DAYS_OF_WEEK.find((entry) => entry.value === day)?.labelShort)
    .filter(Boolean)
    .join(', ');
}

function buildPreferredTimesMap(preferredTimes) {
  const map = {};
  if (!Array.isArray(preferredTimes)) {
    return map;
  }
  preferredTimes.forEach((entry) => {
    const day = Number(entry?.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      return;
    }
    const ranges = Array.isArray(entry?.ranges) ? entry.ranges : [];
    const normalizedRanges = ranges
      .map((range) => ({
        start: typeof range?.start === 'string' ? range.start : '',
        end: typeof range?.end === 'string' ? range.end : '',
      }))
      .filter((range) => range.start || range.end);
    if (normalizedRanges.length) {
      map[day] = normalizedRanges;
    }
  });
  return map;
}

function serializePreferredTimes(preferredTimesByDay) {
  if (!preferredTimesByDay || typeof preferredTimesByDay !== 'object') {
    return [];
  }

  return Object.entries(preferredTimesByDay)
    .map(([dayKey, ranges]) => {
      const day = Number(dayKey);
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        return null;
      }
      const normalizedRanges = Array.isArray(ranges)
        ? ranges
            .map((range) => ({
              start: typeof range?.start === 'string' ? range.start.trim() : '',
              end: typeof range?.end === 'string' ? range.end.trim() : '',
            }))
            .filter((range) => range.start && range.end)
        : [];
      if (!normalizedRanges.length) {
        return null;
      }
      return { day, ranges: normalizedRanges };
    })
    .filter(Boolean);
}

function formatPreferredTimes(preferredTimes = []) {
  if (!Array.isArray(preferredTimes) || preferredTimes.length === 0) {
    return '—';
  }
  return preferredTimes
    .map((entry) => {
      const dayLabel = DAYS_OF_WEEK.find((day) => day.value === entry.day)?.labelShort;
      if (!dayLabel || !Array.isArray(entry.ranges) || entry.ranges.length === 0) {
        return null;
      }
      const ranges = entry.ranges
        .map((range) => `${range.start}-${range.end}`)
        .filter(Boolean)
        .join(', ');
      return ranges ? `${dayLabel}: ${ranges}` : null;
    })
    .filter(Boolean)
    .join(' · ');
}

function buildInitialForm(entry, studentMap) {
  const profileOption = entry?.client_profile_id && studentMap?.get(entry.client_profile_id)
    ? studentMap.get(entry.client_profile_id)
    : buildStudentOption(resolveEntryPerson(entry));

  return {
    id: entry?.id || '',
    clientProfileId: entry?.client_profile_id || entry?.student?.client_profile_id || '',
    studentId: entry?.student_id || '',
    studentSearch: profileOption || '',
    serviceId: entry?.desired_service_id || '',
    preferredDays: Array.isArray(entry?.preferred_days) ? entry.preferred_days : [],
    preferredTimesByDay: buildPreferredTimesMap(entry?.preferred_times),
    priorityFlag: Boolean(entry?.priority_flag),
    notes: entry?.notes || '',
    status: entry?.status || 'open',
  };
}

function formatEntryCreatedAt(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('he-IL', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Jerusalem',
    }).format(new Date(value));
  } catch {
    return '—';
  }
}

function compareWaitingListEntries(left, right) {
  const leftPriority = Number(Boolean(left?.priority_flag));
  const rightPriority = Number(Boolean(right?.priority_flag));
  if (leftPriority !== rightPriority) {
    return rightPriority - leftPriority;
  }

  const leftCreated = new Date(left?.created_at || 0).getTime();
  const rightCreated = new Date(right?.created_at || 0).getTime();
  return leftCreated - rightCreated;
}

function getStatusLabel(status) {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label || '—';
}

function getEntryIntakeMeta(entry) {
  return entry?.metadata && typeof entry.metadata === 'object' ? entry.metadata : {};
}

function getPaymentPathLabel(meta) {
  if (meta.payment_path_intent === 'hmo') return 'קופת חולים';
  if (meta.payment_path_intent === 'private') return 'פרטי';
  if (meta.payment_path_intent === 'unsure') return 'צריך עזרה';
  return '';
}

function getContactRelationshipLabel(meta) {
  switch (meta.contact_relationship) {
    case 'mother':
      return 'אם';
    case 'father':
      return 'אב';
    case 'caretaker':
      return 'מטפל/ת';
    case 'other':
      return 'אחר';
    case 'self':
      return 'התלמיד/ה עצמו/ה';
    default:
      return '';
  }
}

function getHmoApprovalLabel(meta) {
  if (meta.payment_path_intent !== 'hmo') return '';
  if (meta.hmo_approval_status === 'send_separately') return 'יישלח בנפרד';
  if (meta.hmo_approval_status === 'no_approval_yet') return 'ללא אישור';
  return '';
}

function mapWaitingListSuggestionsErrorMessage(code) {
  switch (String(code || '').trim()) {
    case 'waiting_list_entry_not_found':
      return 'רשומת ההמתנה כבר אינה זמינה. אפשר לרענן את התור ולבחור רשומה אחרת.';
    case 'failed_to_load_instructors':
    case 'failed_to_load_instructor_capabilities':
    case 'failed_to_load_instructor_profiles':
    case 'failed_to_load_lesson_templates':
    case 'failed_to_load_waiting_list_entry':
      return 'לא הצלחנו לחשב הצעות שיבוץ כרגע. אפשר לנסות שוב בעוד כמה רגעים.';
    default:
      return 'טעינת הצעות השיבוץ נכשלה. אפשר לנסות שוב.';
  }
}

function mapWaitingListSuggestionsBlockingReason(code) {
  switch (String(code || '').trim()) {
    case 'missing_service_availability':
      return 'לא נמצאה זמינות שירות מוגדרת עבור המדריכים/ות שיכולים לספק את השירות הזה.';
    case 'missing_service_capability':
      return 'כרגע אין מדריך/ה עם יכולת שירות פעילה עבור השירות המבוקש.';
    case 'no_matching_slots':
      return 'כרגע אין חלונות פנויים שתואמים לרשומת ההמתנה במצב ההצעות הנוכחי.';
    default:
      return 'לא נמצאו כרגע הצעות מתאימות במצב זה.';
  }
}

export default function WaitingListPage() {
  const navigate = useNavigate();
  const { activeOrg, activeOrgId } = useOrg();
  const { session } = useSupabase();

  const membershipRole = normalizeMembershipRole(activeOrg?.membership?.role || null);
  const canManage = isAdminOrOffice(membershipRole);

  const [entries, setEntries] = useState([]);
  const [clientProfiles, setClientProfiles] = useState([]);
  const [services, setServices] = useState([]);
  const [waitingListForms, setWaitingListForms] = useState([]);
  const [loadingWaitingListForms, setLoadingWaitingListForms] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active');
  const [loading, setLoading] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [listError, setListError] = useState('');
  const [formError, setFormError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formValues, setFormValues] = useState(buildInitialForm());
  const [touched, setTouched] = useState({});
  const [timeEditorDay, setTimeEditorDay] = useState(null);
  const [timeEditorOpen, setTimeEditorOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteFormValues, setInviteFormValues] = useState(buildInitialInviteForm());
  const [inviteError, setInviteError] = useState('');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteMigrating, setInviteMigrating] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const [suggestionMode, setSuggestionMode] = useState('capacity');
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');
  const [suggestionsMeta, setSuggestionsMeta] = useState({
    blockingReason: '',
    fixTargets: [],
  });
  const [isAddStudentOpen, setIsAddStudentOpen] = useState(false);
  const [isCreatingStudent, setIsCreatingStudent] = useState(false);
  const [createError, setCreateError] = useState('');
  const [addSubmitDisabled, setAddSubmitDisabled] = useState(false);

  const openSelectCountRef = useRef(0);
  const isClosingSelectRef = useRef(false);

  const canFetch = Boolean(session && activeOrgId && canManage);
  const canCreateStudent = isAdminRole(membershipRole);

  const studentOptionMap = useMemo(() => {
    const map = new Map();
    clientProfiles.forEach((profile) => {
      map.set(profile.id, buildStudentOption(profile));
    });
    return map;
  }, [clientProfiles]);

  const studentLabelToId = useMemo(() => {
    const map = new Map();
    clientProfiles.forEach((profile) => {
      const label = buildStudentOption(profile);
      map.set(label.toLowerCase(), {
        clientProfileId: profile.id,
        studentId: profile.student_id || '',
      });
    });
    return map;
  }, [clientProfiles]);

  const studentOptions = useMemo(() => clientProfiles.map(buildStudentOption), [clientProfiles]);

  const serviceOptions = useMemo(
    () => (services || []).map((service) => ({ value: service.id, label: service.name })),
    [services]
  );
  const waitingListFormOptions = useMemo(
    () => (waitingListForms || []).map((form) => ({ value: form.id, label: form.name })),
    [waitingListForms]
  );
  const selectedInviteForm = useMemo(
    () => (waitingListForms || []).find((form) => form.id === inviteFormValues.formId) || null,
    [waitingListForms, inviteFormValues.formId]
  );
  const sortedEntries = useMemo(
    () => [...entries].sort(compareWaitingListEntries),
    [entries]
  );
  const selectedEntry = useMemo(
    () => sortedEntries.find((entry) => entry.id === selectedEntryId) || null,
    [sortedEntries, selectedEntryId]
  );

  const loadWaitingListForms = useCallback(async () => {
    if (!canFetch) return;

    setLoadingWaitingListForms(true);
    try {
      const formsPayload = await authenticatedFetch('forms', {
        session,
        params: { org_id: activeOrgId, usage: FORM_USAGE_WAITING_LIST, selection_mode: 'waiting_list_invite' },
      });
      setWaitingListForms(Array.isArray(formsPayload) ? formsPayload : []);
    } catch (err) {
      setListError(err?.message || 'טעינת הנתונים נכשלה.');
    } finally {
      setLoadingWaitingListForms(false);
    }
  }, [canFetch, session, activeOrgId]);

  const loadReferenceData = useCallback(async () => {
    if (!canFetch) return;

    setLoadingMeta(true);
    setListError('');

    try {
      const [servicesPayload, clientProfilesPayload] = await Promise.all([
        authenticatedFetch('services', {
          session,
          params: { org_id: activeOrgId },
        }),
        authenticatedFetch('client-profiles', {
          session,
          params: { org_id: activeOrgId, status: 'all' },
        }),
      ]);

      setServices(Array.isArray(servicesPayload) ? servicesPayload : []);
      setClientProfiles(Array.isArray(clientProfilesPayload) ? clientProfilesPayload : []);
    } catch (err) {
      setListError(err?.message || 'טעינת הנתונים נכשלה.');
    } finally {
      setLoadingMeta(false);
    }
  }, [canFetch, session, activeOrgId]);

  const loadEntries = useCallback(async () => {
    if (!canFetch) return;

    setLoading(true);
    setListError('');

    try {
      const payload = await authenticatedFetch('waiting-list', {
        session,
        params: { org_id: activeOrgId, status: statusFilter },
      });
      setEntries(Array.isArray(payload) ? payload : []);
    } catch (err) {
      setEntries([]);
      setListError(err?.message || 'טעינת רשימת ההמתנה נכשלה.');
    } finally {
      setLoading(false);
    }
  }, [canFetch, session, activeOrgId, statusFilter]);

  useEffect(() => {
    void loadReferenceData();
  }, [loadReferenceData]);

  useEffect(() => {
    void loadWaitingListForms();
  }, [loadWaitingListForms]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    if (!sortedEntries.length) {
      setSelectedEntryId('');
      return;
    }

    setSelectedEntryId((current) => (
      current && sortedEntries.some((entry) => entry.id === current)
        ? current
        : sortedEntries[0].id
    ));
  }, [sortedEntries]);

  useEffect(() => {
    if (!canFetch || !selectedEntry?.id) {
      setSuggestions([]);
      setSuggestionsError('');
      setSuggestionsMeta({ blockingReason: '', fixTargets: [] });
      setLoadingSuggestions(false);
      return;
    }

    if (!['new', 'open'].includes(String(selectedEntry.status || '').toLowerCase())) {
      setSuggestions([]);
      setSuggestionsError('');
      setSuggestionsMeta({ blockingReason: '', fixTargets: [] });
      setLoadingSuggestions(false);
      return;
    }

    let cancelled = false;

    async function fetchSuggestions() {
      setLoadingSuggestions(true);
      setSuggestionsError('');
      try {
        const payload = await authenticatedFetch('waiting-list-suggestions', {
          session,
          params: {
            org_id: activeOrgId,
            entry_id: selectedEntry.id,
            mode: suggestionMode,
          },
        });

        if (!cancelled) {
          setSuggestions(Array.isArray(payload?.suggestions) ? payload.suggestions : []);
          setSuggestionsMeta({
            blockingReason: String(payload?.blocking_reason || ''),
            fixTargets: Array.isArray(payload?.fix_availability_targets) ? payload.fix_availability_targets : [],
          });
        }
      } catch (error) {
        if (!cancelled) {
          setSuggestions([]);
          setSuggestionsError(mapWaitingListSuggestionsErrorMessage(error?.data?.message || error?.message));
          setSuggestionsMeta({ blockingReason: '', fixTargets: [] });
        }
      } finally {
        if (!cancelled) {
          setLoadingSuggestions(false);
        }
      }
    }

    void fetchSuggestions();
    return () => {
      cancelled = true;
    };
  }, [canFetch, selectedEntry?.id, selectedEntry?.status, suggestionMode, session, activeOrgId]);

  const openCreateDialog = () => {
    setFormValues(buildInitialForm(null, studentOptionMap));
    setTouched({});
    setFormError('');
    setDialogOpen(true);
  };

  const openEditDialog = (entry) => {
    setFormValues(buildInitialForm(entry, studentOptionMap));
    setTouched({});
    setFormError('');
    setDialogOpen(true);
  };

  const handleStudentChange = (value) => {
    const normalized = String(value || '').trim();
    const match = studentLabelToId.get(normalized.toLowerCase()) || null;
    setFormValues((prev) => ({
      ...prev,
      studentSearch: normalized,
      clientProfileId: match?.clientProfileId || '',
      studentId: match?.studentId || '',
    }));
  };

  const handleServiceChange = (value) => {
    setFormValues((prev) => ({ ...prev, serviceId: value }));
  };

  const togglePreferredDay = (dayValue) => {
    setFormValues((prev) => {
      const isSelected = prev.preferredDays.includes(dayValue);
      const nextDays = isSelected
        ? prev.preferredDays.filter((day) => day !== dayValue)
        : [...prev.preferredDays, dayValue].sort((a, b) => a - b);
      const nextPreferredTimes = { ...prev.preferredTimesByDay };
      if (isSelected) {
        delete nextPreferredTimes[dayValue];
      }
      return { ...prev, preferredDays: nextDays, preferredTimesByDay: nextPreferredTimes };
    });

    const currentlySelected = formValues.preferredDays.includes(dayValue);
    if (!currentlySelected) {
      const ranges = formValues.preferredTimesByDay?.[dayValue] || [];
      if (ranges.length === 0) {
        setTimeEditorDay(dayValue);
        setTimeEditorOpen(true);
      }
    }
  };

  const openTimeEditor = (dayValue) => {
    setTimeEditorDay(dayValue);
    setTimeEditorOpen(true);
  };

  const closeTimeEditor = () => {
    setTimeEditorOpen(false);
    setTimeEditorDay(null);
  };

  const handleOpenAddStudentDialog = () => {
    setCreateError('');
    setIsAddStudentOpen(true);
  };

  const resetInviteComposer = useCallback(() => {
    const defaultFormId = waitingListForms.length === 1 ? waitingListForms[0].id : '';
    setInviteFormValues({
      ...buildInitialInviteForm(),
      formId: defaultFormId,
    });
    setInviteError('');
    setInviteResult(null);
  }, [waitingListForms]);

  const openInviteDialog = () => {
    resetInviteComposer();
    setInviteDialogOpen(true);
    if (!waitingListForms.length) {
      void loadWaitingListForms();
    }
  };

  useEffect(() => {
    if (!inviteDialogOpen) return;
    if (waitingListForms.length !== 1) return;
    setInviteFormValues((prev) => (
      prev.formId ? prev : { ...prev, formId: waitingListForms[0].id }
    ));
  }, [inviteDialogOpen, waitingListForms]);

  const handleInviteSubmit = async (event) => {
    event.preventDefault();

    if (selectedInviteForm?.requires_publish_migration) {
      setInviteError('הטופס דורש מיגרציית פרסום לפני שליחה.');
      return;
    }

    if (!inviteFormValues.formId || !inviteFormValues.studentFirstName.trim() || !inviteFormValues.studentLastName.trim() || !inviteFormValues.identityNumber.trim() || !inviteFormValues.serviceId) {
      setInviteError('יש לבחור טופס, למלא שם פרטי, שם משפחה ומספר זהות של התלמיד/ה ולבחור שירות.');
      return;
    }

    if (inviteFormValues.deliveryMethod === 'whatsapp' && !inviteFormValues.phone.trim()) {
      setInviteError('יש להזין מספר טלפון לשליחת WhatsApp.');
      return;
    }

    if (inviteFormValues.deliveryMethod === 'email' && !inviteFormValues.email.trim()) {
      setInviteError('יש להזין כתובת אימייל לשליחה.');
      return;
    }

    setInviteSubmitting(true);
    setInviteError('');
    setInviteResult(null);

    try {
      const payload = await authenticatedFetch('waiting-list-intake/send', {
        method: 'POST',
        session,
        body: {
          org_id: activeOrgId,
          form_id: inviteFormValues.formId,
          student_first_name: inviteFormValues.studentFirstName,
          student_last_name: inviteFormValues.studentLastName,
          identity_number: inviteFormValues.identityNumber || null,
          phone: inviteFormValues.phone || null,
          email: inviteFormValues.email || null,
          delivery_method: inviteFormValues.deliveryMethod,
          desired_service_id: inviteFormValues.serviceId,
          allow_additional_services: inviteFormValues.allowAdditionalServices,
          internal_note: inviteFormValues.internalNote || null,
        },
      });

      setInviteResult(payload);
      if (payload?.delivery_status === 'email_failed') {
        toast.warning('שליחת האימייל נכשלה. אפשר להשתמש בקישור הידני.');
      } else if (inviteFormValues.deliveryMethod === 'email') {
        toast.success('קישור הטופס נשלח באימייל.');
      } else {
        toast.success('קישור הטופס מוכן לשליחה בוואטסאפ.');
      }
      await loadEntries();
    } catch (error) {
      const errorCode = error?.data?.message || error?.message;
      setInviteError(mapWaitingListInviteErrorMessage(errorCode));
    } finally {
      setInviteSubmitting(false);
    }
  };

  const handleMigrateInviteForm = useCallback(async () => {
    const formId = inviteFormValues.formId;
    if (!formId || !activeOrgId || !session) {
      setInviteError('חסרים נתונים לביצוע מיגרציה.');
      return;
    }

    setInviteMigrating(true);
    setInviteError('');
    try {
      await authenticatedFetch(`forms/${formId}`, {
        method: 'PUT',
        session,
        body: {
          org_id: activeOrgId,
          action: 'migrate_publish_structure',
        },
      });
      toast.success('מיגרציית מבנה הפרסום הושלמה');
      await loadWaitingListForms();
    } catch (error) {
      const errorCode = error?.data?.message || error?.message;
      setInviteError(mapWaitingListInviteErrorMessage(errorCode));
    } finally {
      setInviteMigrating(false);
    }
  }, [activeOrgId, inviteFormValues.formId, loadWaitingListForms, session]);

  const handlePrepareAdditionalInvite = () => {
    resetInviteComposer();
  };

  const handleOpenSuggestionInTemplateManager = useCallback((suggestion) => {
    if (!selectedEntry) return;
    const selectedService = services.find((service) => service.id === selectedEntry.desired_service_id);

    const params = new URLSearchParams({
      waiting_list_entry_id: selectedEntry.id,
      suggestion_mode: suggestion.mode || suggestionMode,
      student_id: selectedEntry.student_id || '',
      client_profile_id: selectedEntry.client_profile_id || '',
      student_name: buildStudentName(resolveEntryPerson(selectedEntry)),
      service_id: selectedEntry.desired_service_id || '',
      service_name: selectedEntry.service?.name || '',
      instructor_id: suggestion.instructor_id || '',
      day_of_week: String(suggestion.day_of_week ?? ''),
      time_of_day: suggestion.time_of_day || '',
      duration_minutes: String(suggestion.duration_minutes || selectedService?.duration_minutes || 60),
    });

    if (suggestion.source_template_id) {
      params.set('source_template_id', suggestion.source_template_id);
    }

    navigate(`/calendar/templates?${params.toString()}`);
  }, [navigate, selectedEntry, suggestionMode, services]);

  const handleFixAvailabilityTarget = useCallback((target) => {
    if (!selectedEntry || !target?.instructor_id || !target?.service_id) return;

    const params = new URLSearchParams({
      fix_availability: '1',
      fix_type: target.fix_type || suggestionsMeta.blockingReason || '',
      waiting_list_entry_id: selectedEntry.id,
      student_id: selectedEntry.student_id || '',
      client_profile_id: selectedEntry.client_profile_id || '',
      student_name: buildStudentName(resolveEntryPerson(selectedEntry)),
      service_id: target.service_id || selectedEntry.desired_service_id || '',
      service_name: selectedEntry.service?.name || '',
      instructor_id: target.instructor_id,
    });

    navigate(`/calendar/templates?${params.toString()}`);
  }, [navigate, selectedEntry, suggestionsMeta.blockingReason]);

  const inviteWhatsappLink = useMemo(() => {
    if (!inviteResult?.invite_url || !inviteResult?.phone) return '';
    const digits = String(inviteResult.phone).replace(/[^\d]/g, '');
    const normalizedPhone = digits.startsWith('972')
      ? digits
      : digits.startsWith('0')
        ? `972${digits.slice(1)}`
        : digits;
    const serviceName = inviteResult?.desired_service?.name || '';
    const studentName = [inviteResult?.student_first_name, inviteResult?.student_last_name].filter(Boolean).join(' ').trim();
    const message = buildInviteWhatsappMessage({
      inviteUrl: inviteResult.invite_url,
      expiresAt: inviteResult?.expires_at,
      serviceName,
      studentName,
    });
    return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
  }, [inviteResult]);

  const handleAddStudentDialogOpenChange = (open) => {
    if (!open) {
      openSelectCountRef.current = 0;
      isClosingSelectRef.current = false;
      setIsAddStudentOpen(false);
      setCreateError('');
    } else {
      setIsAddStudentOpen(true);
    }
  };

  const handleAddStudentSubmit = async (formData) => {
    if (!session || !activeOrgId) {
      setCreateError('חיבור לא זמין. ודא את החיבור וניסיון מחדש.');
      return;
    }

    setIsCreatingStudent(true);
    setCreateError('');

    const body = {
      org_id: activeOrgId,
      first_name: formData.firstName,
      middle_name: formData.middleName,
      last_name: formData.lastName,
      identity_number: formData.identityNumber,
      date_of_birth: formData.dateOfBirth,
      guardian_id: formData.guardianId,
      guardian_relationship: formData.guardianRelationship,
      phone: formData.phone,
      email: formData.email,
      medical_provider: formData.medicalProvider,
      default_notification_method: formData.notificationMethod,
      special_rate: formData.specialRate === '' ? null : toAgorot(formData.specialRate),
      medical_flags: formData.medicalFlags,
      onboarding_status: formData.onboardingStatus,
      notes_internal: formData.notesInternal,
      tags: formData.tags,
      is_active: formData.isActive,
    };

    try {
      const createdStudent = await authenticatedFetch('students-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        session,
      });
      toast.success('התלמיד נוסף בהצלחה');
      setClientProfiles((prev) => prev.map((profile) => (
        profile.id === createdStudent?.client_profile_id
          ? { ...profile, student_id: createdStudent.id, is_student: true }
          : profile
      )));
      if (createdStudent?.id) {
        setFormValues((prev) => ({
          ...prev,
          clientProfileId: createdStudent.client_profile_id || prev.clientProfileId,
          studentId: createdStudent.id,
          studentSearch: buildStudentOption(createdStudent),
        }));
      }
      setIsAddStudentOpen(false);
    } catch (error) {
      const apiMessage = error?.data?.message || error?.message;
      const apiCode = error?.data?.error || error?.data?.code || error?.code;
      let message = 'הוספת תלמיד נכשלה.';
      if (apiCode === 'identity_number_duplicate' || apiMessage === 'duplicate_identity_number') {
        message = 'תעודת זהות קיימת כבר במערכת.';
      } else if (apiMessage === 'missing national id') {
        message = 'יש להזין מספר זהות.';
      } else if (apiMessage === 'invalid national id') {
        message = 'מספר זהות לא תקין. יש להזין 5–12 ספרות.';
      } else if (apiCode === 'schema_upgrade_required') {
        message = 'נדרשת שדרוג לסכמת מסד הנתונים.';
      }
      setCreateError(message);
      toast.error(message);
    } finally {
      setIsCreatingStudent(false);
    }
  };

  const addPreferredTime = (dayValue) => {
    setFormValues((prev) => {
      const currentRanges = prev.preferredTimesByDay?.[dayValue] || [];
      const nextRanges = [...currentRanges, { ...EMPTY_RANGE }];
      return {
        ...prev,
        preferredTimesByDay: {
          ...prev.preferredTimesByDay,
          [dayValue]: nextRanges,
        },
      };
    });
  };

  const updatePreferredTime = (dayValue, index, field, value) => {
    setFormValues((prev) => {
      const currentRanges = prev.preferredTimesByDay?.[dayValue] || [];
      const nextRanges = currentRanges.map((range, idx) => (
        idx === index ? { ...range, [field]: value } : range
      ));
      return {
        ...prev,
        preferredTimesByDay: {
          ...prev.preferredTimesByDay,
          [dayValue]: nextRanges,
        },
      };
    });
  };

  const removePreferredTime = (dayValue, index) => {
    setFormValues((prev) => {
      const currentRanges = prev.preferredTimesByDay?.[dayValue] || [];
      const nextRanges = currentRanges.filter((_, idx) => idx !== index);
      const nextPreferredTimes = { ...prev.preferredTimesByDay };
      if (nextRanges.length) {
        nextPreferredTimes[dayValue] = nextRanges;
      } else {
        delete nextPreferredTimes[dayValue];
      }
      return {
        ...prev,
        preferredTimesByDay: nextPreferredTimes,
      };
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const nextTouched = {
      studentId: true,
      serviceId: true,
    };
    setTouched(nextTouched);

    if (!formValues.clientProfileId || !formValues.serviceId) {
      return;
    }

    setIsSubmitting(true);
    setFormError('');

    const payload = {
      org_id: activeOrgId,
      client_profile_id: formValues.clientProfileId,
      student_id: formValues.studentId,
      desired_service_id: formValues.serviceId,
      preferred_days: formValues.preferredDays.length ? formValues.preferredDays : [],
      preferred_times: serializePreferredTimes(formValues.preferredTimesByDay),
      priority_flag: formValues.priorityFlag,
      notes: formValues.notes.trim() || null,
      status: formValues.status,
    };

    const endpoint = formValues.id ? `waiting-list/${formValues.id}` : 'waiting-list';
    const method = formValues.id ? 'PUT' : 'POST';

    try {
      await authenticatedFetch(endpoint, {
        method,
        session,
        body: payload,
      });
      setDialogOpen(false);
      await loadEntries();
    } catch (err) {
      setFormError(err?.message || 'שמירת רשומת ההמתנה נכשלה.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const studentError = touched.studentId && !formValues.clientProfileId ? 'בחרו לקוח/ה מהרשימה.' : '';
  const serviceError = touched.serviceId && !formValues.serviceId ? 'בחרו שירות.' : '';

  const pageActions = canManage ? (
    <div className="flex items-center gap-2">
      <Button onClick={openInviteDialog} className="gap-2" size="sm" variant="outline">
        <Send className="h-4 w-4" />
        {inviteResult ? 'שלח טופס נוסף' : 'שלח טופס המתנה'}
      </Button>
      <Button onClick={openCreateDialog} className="gap-2" size="sm">
        <Plus className="h-4 w-4" />
        רשומה חדשה
      </Button>
    </div>
  ) : null;

  if (!activeOrgId) {
    return (
      <PageLayout title="רשימת המתנה">
        <Card>
          <CardContent className="p-4 text-sm text-neutral-600">
            בחרו ארגון כדי לצפות ברשימת ההמתנה.
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  if (!canManage) {
    return (
      <PageLayout title="רשימת המתנה">
        <Card>
          <CardContent className="p-4 text-sm text-neutral-600">
            אין לך הרשאה לנהל את רשימת ההמתנה.
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="רשימת המתנה" description="מרחב עבודה לשיבוץ וניהול מתעניינים" actions={pageActions}>
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="max-w-xs">
              <SelectField
                id="waiting-list-status-filter"
                label="תצוגת תור"
                value={statusFilter}
                onChange={setStatusFilter}
                options={STATUS_FILTER_OPTIONS}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>סה״כ רשומות: {sortedEntries.length}</span>
              <span>•</span>
              <span>חדשות: {entries.filter((entry) => entry.status === 'new').length}</span>
              <span>•</span>
              <span>דחופות: {entries.filter((entry) => entry.priority_flag).length}</span>
              {loadingMeta ? <span>• טוען נתוני עזר...</span> : null}
            </div>
          </div>
        </CardContent>
      </Card>

      {listError ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{listError}</div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_380px]">
        <Card className="min-h-[70vh]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">תור טיפול</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="text-sm text-neutral-500">טוען רשומות...</div>
            ) : sortedEntries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-sm text-neutral-500">
                לא נמצאו רשומות בתצוגה הנוכחית.
              </div>
            ) : (
              sortedEntries.map((entry) => {
                const intakeMeta = getEntryIntakeMeta(entry);
                const isSelected = selectedEntryId === entry.id;
                const person = resolveEntryPerson(entry);

                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setSelectedEntryId(entry.id)}
                    className={cn(
                      'w-full rounded-2xl border p-4 text-right transition-colors',
                      isSelected
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-border/70 bg-background hover:border-primary/30 hover:bg-muted/30',
                      entry.priority_flag && 'border-red-300',
                    )}
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="font-medium text-foreground">{buildStudentName(person)}</div>
                        <div className="text-sm text-muted-foreground">{entry.service?.name || 'ללא שירות'}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant={STATUS_BADGE_VARIANTS[entry.status] || 'outline'}>
                          {getStatusLabel(entry.status)}
                        </Badge>
                        {entry.priority_flag ? <Badge variant="destructive">דחוף</Badge> : null}
                      </div>
                    </div>

                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div>נוצר: {formatEntryCreatedAt(entry.created_at)}</div>
                      <div>ימי זמינות: {formatPreferredDays(entry.preferred_days)}</div>
                      <div>טווחים: {formatPreferredTimes(entry.preferred_times)}</div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {!entry?.student_id ? <Badge variant="outline">טרם הומר/ה לתלמיד/ה</Badge> : null}
                      {intakeMeta.source === 'waiting_list_intake' ? <Badge variant="secondary">נוצר מטופס</Badge> : null}
                    </div>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="min-h-[70vh]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">פרטי רשומה</CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedEntry ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                בחרו רשומה מהתור כדי לראות את פרטי המתעניין/ת ולפתוח הצעות שיבוץ.
              </div>
            ) : (
              (() => {
                const intakeMeta = getEntryIntakeMeta(selectedEntry);
                const person = resolveEntryPerson(selectedEntry);
                const paymentPathLabel = getPaymentPathLabel(intakeMeta);
                const contactRelationshipLabel = getContactRelationshipLabel(intakeMeta);
                const hmoApprovalLabel = getHmoApprovalLabel(intakeMeta);

                return (
                  <div className="space-y-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <UserRound className="h-4 w-4 text-muted-foreground" />
                          <h2 className="text-lg font-semibold text-foreground">{buildStudentName(person)}</h2>
                        </div>
                        <div className="text-sm text-muted-foreground">{selectedEntry.service?.name || 'ללא שירות מוגדר'}</div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={STATUS_BADGE_VARIANTS[selectedEntry.status] || 'outline'}>
                            {getStatusLabel(selectedEntry.status)}
                          </Badge>
                          {selectedEntry.priority_flag ? <Badge variant="destructive">עדיפות גבוהה</Badge> : null}
                          {!selectedEntry?.student_id ? <Badge variant="outline">טרם הומר/ה לתלמיד/ה</Badge> : null}
                          {intakeMeta.source === 'waiting_list_intake' ? <Badge variant="secondary">נוצר מטופס</Badge> : null}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEditDialog(selectedEntry)} className="gap-2">
                          <Pencil className="h-4 w-4" />
                          עריכת רשומה
                        </Button>
                        <Button asChild variant="outline" size="sm" className="gap-2">
                      <Link to={selectedEntry.student_id ? `/students/${selectedEntry.student_id}` : `/one-time-customers/${selectedEntry.client_profile_id}`}>
                        <ArrowLeft className="h-4 w-4" />
                        {selectedEntry.student_id ? 'פתח כרטיס תלמיד' : 'פתח כרטיס לקוח/ה'}
                      </Link>
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl border border-border/70 bg-background p-4">
                        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                          <Clock3 className="h-4 w-4 text-muted-foreground" />
                          זמינות והעדפות
                        </div>
                        <div className="space-y-2 text-sm text-muted-foreground">
                          <div>ימי זמינות: <span className="font-medium text-foreground">{formatPreferredDays(selectedEntry.preferred_days)}</span></div>
                          <div>טווחי זמן: <span className="font-medium text-foreground">{formatPreferredTimes(selectedEntry.preferred_times)}</span></div>
                          <div>נוצר: <span className="font-medium text-foreground">{formatEntryCreatedAt(selectedEntry.created_at)}</span></div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-border/70 bg-background p-4">
                        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                          <Sparkles className="h-4 w-4 text-muted-foreground" />
                          פרטי קליטה
                        </div>
                        <div className="space-y-2 text-sm text-muted-foreground">
                          <div>טלפון: <span className="font-medium text-foreground">{person?.phone || '—'}</span></div>
                          <div>אימייל: <span className="font-medium text-foreground">{person?.email || '—'}</span></div>
                          {intakeMeta.contact_relationship && intakeMeta.contact_relationship !== 'self' && intakeMeta.contact_name ? (
                            <div>איש קשר: <span className="font-medium text-foreground">{intakeMeta.contact_name}</span></div>
                          ) : null}
                          {intakeMeta.contact_relationship && intakeMeta.contact_relationship !== 'self' && contactRelationshipLabel ? (
                            <div>קשר למתעניין/ת: <span className="font-medium text-foreground">{contactRelationshipLabel}</span></div>
                          ) : null}
                          {paymentPathLabel ? (
                            <div>מסלול תשלום: <span className="font-medium text-foreground">{paymentPathLabel}</span></div>
                          ) : null}
                          {intakeMeta.hmo_provider_name ? (
                            <div>גורם מממן: <span className="font-medium text-foreground">{intakeMeta.hmo_provider_name}</span></div>
                          ) : null}
                          {hmoApprovalLabel ? (
                            <div>סטטוס אישור: <span className="font-medium text-foreground">{hmoApprovalLabel}</span></div>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border/70 bg-background p-4">
                      <div className="mb-2 text-sm font-medium text-foreground">הערות ודגשים</div>
                      <div className="text-sm text-muted-foreground">
                        {selectedEntry.notes?.trim() ? selectedEntry.notes : 'אין הערות נוספות ברשומה זו.'}
                      </div>
                    </div>
                  </div>
                );
              })()
            )}
          </CardContent>
        </Card>

        <Card className="min-h-[70vh]">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">הצעות שיבוץ</CardTitle>
              <div className="flex items-center gap-2 rounded-full bg-muted p-1">
                {SUGGESTION_MODE_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    size="sm"
                    variant={suggestionMode === option.value ? 'default' : 'ghost'}
                    className="h-8 rounded-full px-3 text-xs"
                    onClick={() => setSuggestionMode(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {!selectedEntry ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                בחרו רשומה מהתור כדי לראות הצעות שיבוץ.
              </div>
            ) : !['new', 'open'].includes(String(selectedEntry.status || '').toLowerCase()) ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                הצעות שיבוץ מוצגות רק לרשומות חדשות או פתוחות.
              </div>
            ) : loadingSuggestions ? (
              <div className="text-sm text-muted-foreground">מחשב הצעות שיבוץ...</div>
            ) : suggestionsError ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{suggestionsError}</div>
            ) : suggestions.length === 0 ? (
              <div className="space-y-3 rounded-xl border border-dashed border-border p-6">
                <div className="text-sm text-muted-foreground">
                  {mapWaitingListSuggestionsBlockingReason(suggestionsMeta.blockingReason)}
                </div>
                {suggestionsMeta.fixTargets.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-foreground">מדריכים/ות שדורשים השלמת זמינות לשירות:</div>
                    {suggestionsMeta.fixTargets.map((target) => (
                      <div
                        key={`${target.instructor_id}-${target.service_id}`}
                        className="flex flex-col gap-2 rounded-xl border border-border/70 bg-background p-3 md:flex-row md:items-center md:justify-between"
                      >
                        <div className="text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">{target.instructor_name || 'מדריך/ה'}</span>
                          {' '}
                          {target.fix_type === 'missing_service_capability'
                            ? 'עדיין ללא יכולת שירות וזמינות עבור השירות הזה.'
                            : 'עדיין ללא חלונות זמינות לשירות הזה.'}
                        </div>
                        <Button type="button" variant="outline" className="gap-2" onClick={() => handleFixAvailabilityTarget(target)}>
                          <CalendarPlus2 className="h-4 w-4" />
                          {target.fix_type === 'missing_service_capability' ? 'הגדר שירות וזמינות' : 'תקן זמינות'}
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              suggestions.map((suggestion, index) => (
                <div key={`${suggestion.mode}-${suggestion.instructor_id}-${suggestion.day_of_week}-${suggestion.time_of_day}-${index}`} className="rounded-2xl border border-border/70 bg-background p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-medium text-foreground">{suggestion.instructor_name || 'ללא מדריך/ה'}</div>
                      <div className="text-sm text-muted-foreground">
                        {suggestion.day_label} · {suggestion.time_of_day} · {suggestion.duration_minutes} דק׳
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={suggestion.mode === 'capacity' ? 'default' : 'secondary'}>
                        {suggestion.mode === 'capacity' ? 'מקום פנוי' : 'חלון פנוי'}
                      </Badge>
                      {suggestion.mode === 'capacity' ? (
                        <span className="text-xs text-muted-foreground">
                          {suggestion.current_students}/{suggestion.capacity} תלמידים
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="mb-4 flex items-start gap-2 rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{suggestion.match_reason}</span>
                  </div>

                  <Button type="button" className="w-full gap-2" onClick={() => handleOpenSuggestionInTemplateManager(suggestion)}>
                    <CalendarPlus2 className="h-4 w-4" />
                    פתח בניהול תבניות
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>שליחת טופס הצטרפות לרשימת המתנה</DialogTitle>
            <DialogDescription>
              יוצרים או מקשרים מתעניין קיים, ושולחים קישור ציבורי קצר וברור למילוי הפרטים הראשוניים.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInviteSubmit}>
            <div className="space-y-5 py-4">
              <div className="rounded-2xl border border-border/70 bg-gradient-to-br from-primary/5 via-background to-background p-4">
                <div className="mb-4 space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">פרטי שליחה בסיסיים</h3>
                  <p className="text-xs text-muted-foreground">מספיקים כמה פרטים כדי ליצור מתעניין ולהכין עבורו קישור מסודר.</p>
                </div>

                <div className="space-y-4">
                  <SelectField
                    id="waiting-list-intake-form"
                    label="טופס"
                    value={inviteFormValues.formId}
                    onChange={(value) => setInviteFormValues((prev) => ({ ...prev, formId: value }))}
                    options={waitingListFormOptions}
                    placeholder="בחרו טופס רשימת המתנה"
                    required
                    disabled={loadingWaitingListForms || inviteSubmitting || inviteMigrating}
                  />
                  {loadingWaitingListForms ? (
                    <p className="text-xs text-neutral-500">טוען טפסי רשימת המתנה...</p>
                  ) : null}
                  {selectedInviteForm?.requires_publish_migration ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
                      <p>הטופס שנבחר דורש מיגרציה למבנה הפרסום החדש לפני שליחה.</p>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleMigrateInviteForm}
                        disabled={inviteSubmitting || inviteMigrating}
                      >
                        {inviteMigrating ? 'מבצע מיגרציה...' : 'בצע מיגרציה למבנה הפרסום'}
                      </Button>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <TextField
                      id="waiting-list-student-first-name"
                      name="studentFirstName"
                      label="שם פרטי של התלמיד/ה"
                      value={inviteFormValues.studentFirstName}
                      onChange={(event) => setInviteFormValues((prev) => ({ ...prev, studentFirstName: event.target.value }))}
                      required
                    />
                    <TextField
                      id="waiting-list-student-last-name"
                      name="studentLastName"
                      label="שם משפחה של התלמיד/ה"
                      value={inviteFormValues.studentLastName}
                      onChange={(event) => setInviteFormValues((prev) => ({ ...prev, studentLastName: event.target.value }))}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <TextField
                      id="waiting-list-identity"
                      name="identityNumber"
                      label="מספר זהות"
                      value={inviteFormValues.identityNumber}
                      onChange={(event) => setInviteFormValues((prev) => ({ ...prev, identityNumber: event.target.value.replace(/\D/g, '') }))}
                      required
                    />
                    <SelectField
                      id="waiting-list-primary-service"
                      label="שירות ראשי"
                      value={inviteFormValues.serviceId}
                      onChange={(value) => setInviteFormValues((prev) => ({ ...prev, serviceId: value }))}
                      options={serviceOptions}
                      placeholder="בחרו שירות"
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-background p-4">
                <div className="mb-4 space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">פרטי מסירה</h3>
                  <p className="text-xs text-muted-foreground">הקישור יכול להישלח בוואטסאפ או באימייל, בהתאם לפרטי הקשר הזמינים.</p>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <SelectField
                    id="waiting-list-delivery-method"
                    label="אופן שליחה"
                    value={inviteFormValues.deliveryMethod}
                    onChange={(value) => setInviteFormValues((prev) => ({ ...prev, deliveryMethod: value }))}
                    options={[
                      { value: 'whatsapp', label: 'וואטסאפ' },
                      { value: 'email', label: 'אימייל' },
                    ]}
                  />
                  <TextField
                    id="waiting-list-phone"
                    name="phone"
                    label={inviteFormValues.deliveryMethod === 'whatsapp' ? 'טלפון *' : 'טלפון'}
                    value={inviteFormValues.phone}
                    onChange={(event) => setInviteFormValues((prev) => ({ ...prev, phone: event.target.value }))}
                    required={inviteFormValues.deliveryMethod === 'whatsapp'}
                  />
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <TextField
                    id="waiting-list-email"
                    name="email"
                    label={inviteFormValues.deliveryMethod === 'email' ? 'אימייל *' : 'אימייל'}
                    value={inviteFormValues.email}
                    onChange={(event) => setInviteFormValues((prev) => ({ ...prev, email: event.target.value }))}
                    required={inviteFormValues.deliveryMethod === 'email'}
                  />
                  <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-3 py-3">
                    <div>
                      <Label className="block">לאפשר בקשה לשירותים נוספים</Label>
                      <p className="text-xs text-neutral-500">המתעניין יוכל לציין בטופס שירותים נוספים שמעניינים אותו.</p>
                    </div>
                    <Switch
                      checked={inviteFormValues.allowAdditionalServices}
                      onCheckedChange={(checked) => setInviteFormValues((prev) => ({ ...prev, allowAdditionalServices: checked }))}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-background p-4">
                <TextAreaField
                  id="waiting-list-internal-note"
                  name="internalNote"
                  label="הערה פנימית"
                  value={inviteFormValues.internalNote}
                  onChange={(event) => setInviteFormValues((prev) => ({ ...prev, internalNote: event.target.value }))}
                  rows={3}
                  placeholder="מידע פנימי לצוות: רגישות בשעות, פרטי פנייה קודמים, דגשים לשיחה ראשונה"
                />
              </div>

              {inviteError ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
                  {inviteError}
                </div>
              ) : null}

              {inviteResult ? (
                <div className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  <div className="space-y-1">
                    <div className="font-semibold">הקישור נוצר בהצלחה</div>
                    <p className="text-emerald-800/90">
                      הקישור מוכן לשיתוף ויישאר זמין
                      {inviteResult?.expires_at ? ` עד ${formatInviteExpiry(inviteResult.expires_at)}` : ''}.
                    </p>
                  </div>
                  <a
                    href={inviteResult.invite_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-primary underline"
                  >
                    <ExternalLink className="h-4 w-4" />
                    פתח קישור
                  </a>
                  {inviteWhatsappLink ? (
                    <a
                      href={inviteWhatsappLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 text-primary underline"
                    >
                      <MessageCircle className="h-4 w-4" />
                      שלח בוואטסאפ
                    </a>
                  ) : null}
                  {inviteResult?.email ? (
                    <div className="flex items-center gap-2 text-neutral-700">
                      <Mail className="h-4 w-4" />
                      <span>{inviteResult.email}</span>
                    </div>
                  ) : null}
                  {inviteResult?.reused_existing_invite ? (
                    <p className="text-xs text-emerald-800/80">כבר היה קישור פעיל לבקשה הזאת, ולכן נעשה שימוש בקישור הקיים.</p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex flex-row-reverse gap-2 pt-4">
              <Button
                type={inviteResult ? 'button' : 'submit'}
                onClick={inviteResult ? handlePrepareAdditionalInvite : undefined}
                disabled={inviteSubmitting || inviteMigrating || waitingListFormOptions.length === 0 || Boolean(selectedInviteForm?.requires_publish_migration)}
              >
                {inviteSubmitting ? 'שולח...' : inviteResult ? 'שלח טופס נוסף' : 'שלח טופס'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setInviteDialogOpen(false)} disabled={inviteSubmitting || inviteMigrating}>
                ביטול
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{formValues.id ? 'עריכת רשומה' : 'רשומה חדשה'}</DialogTitle>
            <DialogDescription>
              הגדירו את צרכי התלמיד כדי שנוכל לשבץ אותו בשיעור קבוע.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <ComboBoxField
                id="waiting-student"
                name="student"
                label="לקוח/ה / תלמיד/ה"
                value={formValues.studentSearch}
                onChange={handleStudentChange}
                options={studentOptions}
                placeholder="בחרו לקוח/ה מהרשימה"
                required
                error={studentError}
              />
              {canCreateStudent ? (
                <div className="flex justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={handleOpenAddStudentDialog}>
                    + תלמיד חדש
                  </Button>
                </div>
              ) : null}

              <SelectField
                id="waiting-service"
                label="שירות מבוקש"
                value={formValues.serviceId}
                onChange={handleServiceChange}
                options={serviceOptions}
                placeholder="בחרו שירות"
                required
                error={serviceError}
              />

              <div className="space-y-3">
                <Label className="block">ימי זמינות</Label>
                <div className="flex items-start gap-4 overflow-x-auto pb-2">
                  {DAYS_OF_WEEK.map((day) => {
                    const ranges = formValues.preferredTimesByDay?.[day.value] || [];
                    const isSelected = formValues.preferredDays.includes(day.value);
                    return (
                      <div key={day.value} className="flex min-w-[120px] flex-col items-center gap-2">
                        <button
                          type="button"
                          onClick={() => togglePreferredDay(day.value)}
                          className={cn(
                            'flex flex-col items-center justify-center min-w-[3rem] h-[3rem] rounded-lg border-2 transition-colors',
                            isSelected
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background hover:bg-muted border-muted-foreground/20'
                          )}
                        >
                          <span className="text-xs font-medium">{day.labelShort}</span>
                          <span className="text-[0.65rem] opacity-80">{day.label}</span>
                        </button>
                        {isSelected ? (
                          <button
                            type="button"
                            onClick={() => openTimeEditor(day.value)}
                            className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs text-primary hover:bg-primary/10"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            עריכה
                          </button>
                        ) : null}
                        {ranges.length > 0 ? (
                          <span className="text-[0.65rem] text-neutral-500">טווחים: {ranges.length}</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-neutral-600">
                  {formValues.preferredDays.length === 0
                    ? 'לא נבחרו ימים.'
                    : `נבחרו ${formValues.preferredDays.length} ימים: ${formatPreferredDays(formValues.preferredDays)}`}
                </p>
                <p className="text-xs text-neutral-500">אפשר להוסיף כמה טווחים לכל יום (לדוגמה: 14:00-16:00, 17:00-18:00).</p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
                <div>
                  <Label className="block">עדיפות גבוהה</Label>
                  <p className="text-xs text-neutral-500">סמנו אם נדרש שיבוץ דחוף.</p>
                </div>
                <Switch
                  checked={formValues.priorityFlag}
                  onCheckedChange={(checked) => setFormValues((prev) => ({ ...prev, priorityFlag: checked }))}
                />
              </div>

              <SelectField
                id="waiting-status"
                label="סטטוס"
                value={formValues.status}
                onChange={(value) => setFormValues((prev) => ({ ...prev, status: value }))}
                options={STATUS_OPTIONS}
              />

              <TextAreaField
                id="waiting-notes"
                name="notes"
                label="הערות"
                value={formValues.notes}
                onChange={(event) => setFormValues((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="דוגמה: מדריכה אישה בלבד, 30 דקות"
                rows={3}
              />
            </div>

            {formError ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
                {formError}
              </div>
            ) : null}

            <div className="flex flex-row-reverse gap-2 pt-4">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'שומר...' : 'שמירה'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={isSubmitting}>
                ביטול
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={timeEditorOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeTimeEditor();
            return;
          }
          setTimeEditorOpen(true);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>עריכת זמינות</DialogTitle>
            <DialogDescription>
              {timeEditorDay !== null
                ? `הגדירו טווחי זמן ליום ${DAYS_OF_WEEK.find((day) => day.value === timeEditorDay)?.label || ''}`
                : 'בחרו יום כדי לערוך זמינות.'}
            </DialogDescription>
          </DialogHeader>

          {timeEditorDay !== null ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">טווחים זמינים</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => addPreferredTime(timeEditorDay)}>
                  הוספת טווח
                </Button>
              </div>
              {(formValues.preferredTimesByDay?.[timeEditorDay] || []).length === 0 ? (
                <p className="text-xs text-neutral-500">לא הוגדרו טווחים.</p>
              ) : (
                <div className="space-y-2">
                  {(formValues.preferredTimesByDay?.[timeEditorDay] || []).map((range, index) => (
                    <div key={`${timeEditorDay}-${index}`} className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-neutral-500">התחלה</span>
                      <input
                        type="time"
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={range.start}
                        onChange={(event) => updatePreferredTime(timeEditorDay, index, 'start', event.target.value)}
                      />
                      <span className="text-sm text-neutral-500">–</span>
                      <span className="text-xs text-neutral-500">סיום</span>
                      <input
                        type="time"
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={range.end}
                        onChange={(event) => updatePreferredTime(timeEditorDay, index, 'end', event.target.value)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removePreferredTime(timeEditorDay, index)}
                      >
                        הסר
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <div className="flex flex-row-reverse gap-2 pt-4">
            <Button type="button" onClick={closeTimeEditor}>
              שמירה
            </Button>
            <Button type="button" variant="outline" onClick={closeTimeEditor}>
              דלג
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {canCreateStudent && (
        <Dialog open={isAddStudentOpen} onOpenChange={handleAddStudentDialogOpenChange}>
          <DialogContent
            className="sm:max-w-2xl"
            onInteractOutside={(event) => {
              if (openSelectCountRef.current > 0 || isClosingSelectRef.current) {
                event.preventDefault();
              }
            }}
            footer={
              <AddStudentFormFooter
                isSubmitting={isCreatingStudent}
                disableSubmit={addSubmitDisabled}
                onCancel={() => setIsAddStudentOpen(false)}
                onSubmit={() => {
                  document.getElementById('add-student-form')?.requestSubmit();
                }}
              />
            }
          >
            <DialogHeader>
              <DialogTitle>הוספת תלמיד חדש</DialogTitle>
              <DialogDescription>
                הזן את פרטי התלמיד. מספר זהות וטלפון (או אפוטרופוס) הם שדות חובה.
              </DialogDescription>
            </DialogHeader>
            <AddStudentForm
              onSubmit={handleAddStudentSubmit}
              onCancel={() => setIsAddStudentOpen(false)}
              isSubmitting={isCreatingStudent}
              error={createError}
              onSubmitDisabledChange={setAddSubmitDisabled}
              renderFooterOutside
              onSelectOpenChange={(open) => {
                if (open) {
                  openSelectCountRef.current++;
                } else {
                  isClosingSelectRef.current = true;
                  setTimeout(() => {
                    openSelectCountRef.current = Math.max(0, openSelectCountRef.current - 1);
                    isClosingSelectRef.current = false;
                  }, 100);
                }
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </PageLayout>
  );
}
