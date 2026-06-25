import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, AlertTriangle, Check, Link2, Loader2, Pencil, Plus, PlusCircle, Search, X, XCircle, Zap } from 'lucide-react';
import { patchCandidate, runDryRunChunk, searchLinkTargets } from '../api/importWorkspacesApi.js';

const FIELD_LABELS = {
  first_name:               'שם פרטי',
  last_name:                'שם משפחה',
  identity_number:          'תעודת זהות',
  phone:                    'טלפון',
  guardian_first_name:      'שם פרטי של ההורה',
  guardian_last_name:       'שם משפחה של ההורה',
  guardian_phone:           'טלפון הורה',
  guardian_email:           'אימייל הורה',
  email:                    'אימייל',
  date_of_birth:            'תאריך לידה',
  guardian_identity_number: 'ת.ז. הורה',
  relationship:             'קרבה',
  is_primary:               'הורה ראשי',
  is_active:                'פעיל/ה',
  customer_type:            'סוג לקוח',
  note_text:                'טקסט הערה',
  service_name:             'שם השירות',
  name:                     'שם השירות',
  description:              'תיאור',
};

const CUSTOMER_TYPE_LABELS = {
  student:            'תלמיד/ה',
  one_time_customer:  'לקוח/ה חד-פעמי/ת',
};

const SELECT_FIELD_OPTIONS = {
  customer_type: [
    { value: 'student',           label: 'תלמיד/ה' },
    { value: 'one_time_customer', label: 'לקוח/ה חד-פעמי/ת' },
  ],
};

const BOOLEAN_FIELD_LABELS = {
  is_primary: 'הורה ראשי',
  is_active:  'פעיל/ה',
};

const ISSUE_MESSAGES = {
  missing_required_field: 'שדה חובה חסר.',
  missing_recommended_field: 'שדה מומלץ חסר.',
  invalid_field_format: 'פורמט השדה לא תקין.',
  duplicate_identity_number: 'קיימת כבר רשומה במערכת עם אותה תעודת זהות. אי אפשר ליצור שתי רשומות עם אותו מספר; יש לקשר לרשומה הקיימת, לתקן את המספר, או לדלג.',
  duplicate_identity_in_file: 'אותה תעודת זהות מופיעה יותר מפעם אחת בקובץ או במרחב הייבוא. יש לתקן או לדלג על הכפילות.',
  duplicate_email: 'קיימת כבר רשומה עם אותו אימייל. מומלץ לבדוק אם זו אותה רשומה.',
  missing_contact_path: 'נדרש טלפון תקין בתלמיד/ה או באפוטרופוס מקושר.',
};

const ENTITY_LABELS = {
  customer:         'לקוח/ה',
  guardian:         'הורה',
  guardian_link:    'קישור הורה-תלמיד',
  service:          'שירות',
};

const ENTITY_TAB_LABELS = {
  customer:      'לקוח/ה',
  guardian:      'הורה',
  guardian_link: 'קשר',
};

const ENTITY_TAB_ORDER = {
  customer: 0,
  guardian: 1,
  guardian_link: 2,
  service: 3,
};

const STATUS_LABELS = {
  needs_review:          'לבדיקה',
  ready:                 'מוכן',
  blocked:               'חסום',
  blocked_by_dependency: 'ממתין לתלות',
  skipped:               'מדולג',
  committed:             'בוצע',
  failed:                'נכשל',
};

const STATUS_VARIANT = {
  needs_review:          'default',
  ready:                 'default',
  blocked:               'destructive',
  blocked_by_dependency: 'secondary',
  skipped:               'secondary',
  committed:             'outline',
  failed:                'destructive',
};

const EDITABLE_FIELDS_BY_ENTITY = {
  customer: ['first_name', 'last_name', 'identity_number', 'customer_type', 'is_active', 'phone', 'email', 'date_of_birth', 'note_text'],
  guardian: ['guardian_first_name', 'guardian_last_name', 'guardian_phone', 'guardian_email'],
  guardian_link: ['identity_number', 'guardian_phone', 'relationship', 'is_primary'],
  service: ['service_name', 'description'],
};

const MULTILINE_FIELDS = new Set(['description', 'note_text']);
const BOOLEAN_FIELDS = new Set(['is_primary', 'is_active']);

const DRY_RUN_OUTCOME_LABELS = {
  create:         'יצירה חדשה',
  update:         'עדכון קיים',
  reuse_existing: 'שימוש חוזר',
  link:           'קישור',
  skip:           'דילוג',
  noop:           'ללא שינוי',
  blocked:        'חסום',
  error:          'שגיאה',
};

const DRY_RUN_OUTCOME_CLASSES = {
  create:         'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  update:         'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  reuse_existing: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  link:           'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  skip:           'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400',
  noop:           'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400',
  blocked:        'bg-destructive/10 text-destructive',
  error:          'bg-destructive/10 text-destructive',
};

const DECISION_LABELS = {
  link_to_existing: 'קישור לרשומה קיימת',
  create_as_new: 'יצירת רשומה חדשה',
  skip: 'דילוג על השורה',
};

function describeDecision(decisions) {
  if (!decisions?.action) return '';
  if (decisions.action === 'link_to_existing') {
    return decisions.linked_id
      ? 'הרשומה הזו תתחבר לאדם שכבר קיים במערכת.'
      : 'נבחר קישור לרשומה קיימת, אבל עדיין לא נבחרה רשומה קיימת. אם האדם עדיין לא קיים במערכת, צריך לבחור יצירת רשומה חדשה.';
  }
  if (decisions.action === 'create_as_new') {
    return 'הרשומה הזו תיצור אדם חדש רק אם אין חסימה כמו תעודת זהות שכבר קיימת. במקרה כזה צריך לתקן את המספר, לקשר לרשומה קיימת או לדלג.';
  }
  if (decisions.action === 'skip') {
    return 'השורה הזו לא תיובא למערכת.';
  }
  return '';
}

function getEditableFields(entityType, candidateData) {
  const canonical = EDITABLE_FIELDS_BY_ENTITY[entityType] || [];
  const extra = Object.keys(candidateData || {})
    .filter((field) => !['dry_run_summary', 'student_identity_number', 'name'].includes(field) && !canonical.includes(field));
  return [...canonical, ...extra];
}

function canonicalizeCandidateData(candidateData = {}) {
  const data = {
    ...candidateData,
    identity_number: candidateData.identity_number || candidateData.student_identity_number,
    service_name: candidateData.service_name || candidateData.name,
  };
  delete data.student_identity_number;
  delete data.name;
  return data;
}

function candidateTitle(candidate) {
  const data = canonicalizeCandidateData(candidate?.candidate_data || {});
  return [data.first_name, data.last_name].filter(Boolean).join(' ')
    || [data.guardian_first_name, data.guardian_last_name].filter(Boolean).join(' ')
    || data.service_name
    || 'רשומה';
}

function flattenRelatedCandidates(candidate) {
  if (!candidate) return [];
  const related = candidate.related_candidates || {};
  const rows = [
    candidate,
    ...(related.customer || []),
    ...(related.guardian || []),
    ...(related.guardian_link || []),
  ];
  const seen = new Set();
  return rows.filter((row) => {
    if (!row?.id || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  }).sort((a, b) => (
    (ENTITY_TAB_ORDER[a.entity_type] ?? 99) - (ENTITY_TAB_ORDER[b.entity_type] ?? 99)
  ));
}

function replaceCandidateInGroup(groupRoot, updated) {
  if (!groupRoot || !updated?.id) return groupRoot;
  if (updated.related_candidates) return updated;
  const nextRoot = groupRoot.id === updated.id
    ? {
      ...updated,
      related_candidates: updated.related_candidates || groupRoot.related_candidates,
    }
    : { ...groupRoot };
  const related = groupRoot.related_candidates;
  if (!related) return nextRoot;
  nextRoot.related_candidates = {
    ...related,
    customer: (related.customer || []).map((item) => item.id === updated.id ? updated : item),
    guardian: (related.guardian || []).map((item) => item.id === updated.id ? updated : item),
    guardian_link: (related.guardian_link || []).map((item) => item.id === updated.id ? updated : item),
  };
  return nextRoot;
}

// A field is "present" (shown as a value row) when it holds a meaningful value.
// Empty editable fields are offered under the "add missing field" menu instead.
function hasValue(field, data) {
  const v = data?.[field];
  if (BOOLEAN_FIELDS.has(field)) return v === true || v === false;
  return v !== null && v !== undefined && v !== '';
}

function displayValue(field, value) {
  if (field === 'customer_type') return CUSTOMER_TYPE_LABELS[value] || value || '—';
  if (field === 'is_active') return value === true ? 'פעיל/ה' : value === false ? 'לא פעיל/ה' : '—';
  if (BOOLEAN_FIELDS.has(field)) return value ? 'כן' : 'לא';
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function seedEditValue(field, value) {
  if (BOOLEAN_FIELDS.has(field)) return Boolean(value);
  if (value === null || value === undefined) return '';
  return String(value);
}

function DryRunOutcomeBadge({ outcome }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
      DRY_RUN_OUTCOME_CLASSES[outcome] ?? 'bg-gray-100 text-gray-600',
    )}>
      {DRY_RUN_OUTCOME_LABELS[outcome] ?? outcome}
    </span>
  );
}

function formatMatchedRecordSummary(summary) {
  if (!summary) return '';
  if (typeof summary !== 'object') return String(summary);
  return summary.name ??
    Object.values(summary)
      .filter(Boolean)
      .join(' · ');
}

function IssueItem({ issue }) {
  const isBlocker = issue.severity === 'blocker';
  const fieldPrefix = FIELD_LABELS[issue.field] ? `${FIELD_LABELS[issue.field]}: ` : '';
  const duplicateName = String(issue.duplicate_name || '').trim();
  const duplicateNames = Array.isArray(issue.duplicate_names)
    ? issue.duplicate_names.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  const duplicateText = duplicateName
    ? ` (${duplicateName})`
    : duplicateNames.length > 0
      ? ` (${duplicateNames.join(', ')})`
      : '';
  const baseMessage = issue.message || ISSUE_MESSAGES[issue.code] || issue.code || 'נדרשת בדיקה.';
  const message = !issue.message && ['duplicate_identity_number', 'duplicate_identity_in_file'].includes(issue.code)
    ? baseMessage.replace('.', `${duplicateText}.`)
    : baseMessage;
  return (
    <li className={cn(
      'flex items-start gap-2 text-sm rounded px-2.5 py-1.5',
      isBlocker ? 'bg-destructive/10 text-destructive' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    )}>
      {isBlocker
        ? <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      }
      <span>
        {fieldPrefix}
        {message}
      </span>
    </li>
  );
}

function guardianSummary(guardians) {
  if (!Array.isArray(guardians) || guardians.length === 0) return '';
  return guardians
    .map((g) => [`${g.first_name || ''} ${g.last_name || ''}`.trim(), g.phone].filter(Boolean).join(' · '))
    .filter(Boolean)
    .join(' | ');
}

function ProfileResultCard({ profile, onLink, disabled }) {
  const name = [profile.first_name, profile.middle_name, profile.last_name].filter(Boolean).join(' ') || 'ללא שם';
  const parents = guardianSummary(profile.guardians);
  return (
    <div className="rounded-md border px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{name}</span>
        {!profile.is_active && (
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">לא פעיל</Badge>
        )}
      </div>
      <div className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
        {profile.identity_number && <div>ת״ז: {profile.identity_number}</div>}
        {profile.phone && <div>טלפון: {profile.phone}</div>}
        {parents && <div>הורה: {parents}</div>}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="mt-2 w-full gap-1.5"
        onClick={() => onLink(profile.client_profile_id)}
        disabled={disabled}
      >
        <Link2 className="h-3.5 w-3.5" />
        קשר לרשומה זו
      </Button>
    </div>
  );
}

/**
 * @param {{
 *   candidate: object | null,
 *   workspaceId?: string,
 *   open: boolean,
 *   onClose: () => void,
 *   onDecisionSaved?: (updated: object) => void,
 *   onCandidateUpdated?: (updated: object) => void,
 * }} props
 */
export function CandidateDetailSheet({ candidate, workspaceId, open, onClose, onDecisionSaved, onCandidateUpdated }) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [dryRunSummaries, setDryRunSummaries] = useState({});
  const [runningDryRun, setRunningDryRun] = useState(false);
  const [dryRunError, setDryRunError] = useState(null);

  // Live copy of the candidate so a per-field edit can update the drawer in
  // place (issues/blockers recompute server-side) without closing it.
  const [liveCandidate, setLiveCandidate] = useState(candidate);
  const [activeCandidateId, setActiveCandidateId] = useState(candidate?.id || null);
  const [editingField, setEditingField] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  const [savingField, setSavingField] = useState(null);
  const [addOpen, setAddOpen] = useState(false);

  // Link-to-existing flow state.
  const [linkMode, setLinkMode] = useState(false);
  const [linkStep, setLinkStep] = useState('search'); // 'auto' | 'search'
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState(null);
  const [linkResults, setLinkResults] = useState([]);
  const [linkQuery, setLinkQuery] = useState('');
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    setLiveCandidate(candidate);
    setActiveCandidateId(candidate?.id || null);
    setDryRunSummaries(candidate?.id ? { [candidate.id]: candidate?.candidate_data?.dry_run_summary ?? null } : {});
    setDryRunError(null);
    setSaveError(null);
    setEditingField(null);
    setEditingValue('');
    setAddOpen(false);
    setLinkMode(false);
    setLinkStep('search');
    setLinkLoading(false);
    setLinkError(null);
    setLinkResults([]);
    setLinkQuery('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.id]);

  // Debounced free-text search while the link panel is in search mode.
  useEffect(() => {
    if (!linkMode || linkStep !== 'search') return undefined;
    const q = linkQuery.trim();
    if (q.length < 2) {
      setLinkResults([]);
      setLinkLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLinkLoading(true);
    setLinkError(null);
    const handle = setTimeout(async () => {
      try {
        const data = await searchLinkTargets({ query: q });
        if (!cancelled) setLinkResults(data?.results || []);
      } catch (err) {
        if (!cancelled) setLinkError(err.message || 'שגיאה בחיפוש');
      } finally {
        if (!cancelled) setLinkLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [linkMode, linkStep, linkQuery]);

  // Prefer the live connected group once it matches the opened candidate.
  const groupRoot = liveCandidate && liveCandidate.id === candidate?.id ? liveCandidate : candidate;
  const candidateTabs = flattenRelatedCandidates(groupRoot);
  const active = candidateTabs.find((item) => item.id === activeCandidateId) || candidateTabs[0];
  if (!active) return null;

  const candidate_data = canonicalizeCandidateData(active.candidate_data || {});
  const { issues = [], entity_type, status, decisions = {} } = active;
  const activeDryRunSummary = Object.prototype.hasOwnProperty.call(dryRunSummaries, active.id)
    ? dryRunSummaries[active.id]
    : active.candidate_data?.dry_run_summary ?? null;
  const relatedGroupKey = groupRoot?.related_candidates?.group_key || {};
  const showEntityTabs = candidateTabs.length > 1;
  const blockers = issues.filter(i => i.severity === 'blocker');
  const warnings = issues.filter(i => i.severity === 'warning');
  const hasIdentityBlocker = blockers.some(b => b.code === 'duplicate_identity_number');
  const editableFields = getEditableFields(entity_type, candidate_data);
  const fieldChanges = decisions.field_changes && typeof decisions.field_changes === 'object'
    ? decisions.field_changes
    : {};
  const editable = status !== 'committed';
  const busy = saving || savingField !== null;

  // Rows shown with a value (plus whatever field is currently being edited).
  const valueFields = editableFields.filter((f) => hasValue(f, candidate_data));
  const shownFields = editingField && !valueFields.includes(editingField)
    ? [...valueFields, editingField]
    : valueFields;
  const missingFields = editableFields.filter((f) => !hasValue(f, candidate_data) && f !== editingField);

  function switchActiveCandidate(candidateId) {
    if (candidateId === active.id) return;
    setActiveCandidateId(candidateId);
    setSaveError(null);
    setDryRunError(null);
    setEditingField(null);
    setEditingValue('');
    setAddOpen(false);
    setLinkMode(false);
    setLinkError(null);
    setLinkResults([]);
    setLinkQuery('');
  }

  function updateLiveCandidate(updated) {
    const nextGroup = replaceCandidateInGroup(groupRoot, updated);
    setLiveCandidate(nextGroup);
    onCandidateUpdated?.(nextGroup);
  }

  async function applyDecision(decisionsPatch, newStatus) {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await patchCandidate(active.id, {
        decisions_patch: decisionsPatch,
        status: newStatus,
      });
      onDecisionSaved?.(result.candidate);
      onClose();
    } catch (err) {
      setSaveError(err.message || 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  }

  async function runIdentityLookup(identity) {
    setLinkStep('auto');
    setLinkLoading(true);
    setLinkError(null);
    try {
      const data = await searchLinkTargets({ identityNumber: identity });
      const results = data?.results || [];
      setLinkResults(results);
      // No identity match → fall straight through to manual search.
      if (results.length === 0) {
        setLinkStep('search');
      }
    } catch (err) {
      setLinkError(err.message || 'שגיאה בחיפוש לפי תעודת זהות');
      setLinkStep('search');
    } finally {
      setLinkLoading(false);
    }
  }

  function openLinkPanel() {
    setLinkMode(true);
    setLinkError(null);
    setLinkResults([]);
    setLinkQuery('');
    const identity = candidate_data.identity_number;
    if (identity) {
      runIdentityLookup(identity);
    } else {
      setLinkStep('search');
    }
  }

  function closeLinkPanel() {
    setLinkMode(false);
    setLinkError(null);
    setLinkResults([]);
    setLinkQuery('');
  }

  async function confirmLink(profileId) {
    setLinking(true);
    setLinkError(null);
    try {
      const result = await patchCandidate(active.id, {
        decisions_patch: { action: 'link_to_existing', linked_id: profileId },
        status: 'ready',
      });
      onDecisionSaved?.(result.candidate);
      onClose();
    } catch (err) {
      setLinkError(err.message || 'שגיאה בקישור הרשומה');
    } finally {
      setLinking(false);
    }
  }

  function handleCreateAsNew() {
    applyDecision({ action: 'create_as_new' }, 'ready');
  }

  function handleSkip() {
    applyDecision({ action: 'skip' }, 'skipped');
  }

  function startEdit(field) {
    setSaveError(null);
    setEditingField(field);
    setEditingValue(seedEditValue(field, candidate_data[field]));
    setAddOpen(false);
  }

  function cancelEdit() {
    setEditingField(null);
    setEditingValue('');
  }

  async function confirmEdit() {
    if (!editingField) return;
    const field = editingField;
    const raw = editingValue;
    const value = typeof raw === 'boolean'
      ? raw
      : (String(raw ?? '').trim() === '' ? null : raw);

    setSavingField(field);
    setSaveError(null);
    try {
      const result = await patchCandidate(active.id, {
        candidate_data_patch: { [field]: value },
      });
      updateLiveCandidate(result.candidate);
      setEditingField(null);
      setEditingValue('');
    } catch (err) {
      setSaveError(err.message || 'שגיאה בשמירת השדה');
    } finally {
      setSavingField(null);
    }
  }

  async function handleRunDryRun() {
    if (!workspaceId) return;
    setRunningDryRun(true);
    setDryRunError(null);
    try {
      const data = await runDryRunChunk(workspaceId, [active.id]);
      const firstResult = data.results?.[0];
      if (firstResult) {
        setDryRunSummaries((current) => ({
          ...current,
          [active.id]: {
            outcome:                  firstResult.outcome,
            action_description:       firstResult.action_description,
            matched_record_id:        firstResult.matched_record_id,
            matched_record_summary:   firstResult.matched_record_summary,
            fields_that_would_change: firstResult.fields_that_would_change,
            simulated_at:             new Date().toISOString(),
          },
        }));
      }
    } catch (err) {
      setDryRunError(err.message || 'שגיאה בהרצת הבדיקה');
    } finally {
      setRunningDryRun(false);
    }
  }

  function renderEditor(field) {
    const editorId = `candidate-edit-${active.id}-${field}`;
    if (SELECT_FIELD_OPTIONS[field]) {
      return (
        <Select
          value={editingValue || ''}
          onValueChange={(v) => setEditingValue(v)}
          dir="rtl"
          disabled={savingField !== null}
        >
          <SelectTrigger id={editorId} className="h-8 text-sm">
            <SelectValue placeholder="— בחר —" />
          </SelectTrigger>
          <SelectContent>
            {SELECT_FIELD_OPTIONS[field].map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (BOOLEAN_FIELDS.has(field)) {
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            id={editorId}
            type="checkbox"
            checked={Boolean(editingValue)}
            onChange={(e) => setEditingValue(e.target.checked)}
            disabled={savingField !== null}
          />
          {BOOLEAN_FIELD_LABELS[field] || field}
        </label>
      );
    }
    if (MULTILINE_FIELDS.has(field)) {
      return (
        <Textarea
          id={editorId}
          value={editingValue ?? ''}
          onChange={(e) => setEditingValue(e.target.value)}
          disabled={savingField !== null}
          rows={3}
          autoFocus
        />
      );
    }
    return (
      <Input
        id={editorId}
        type={field === 'date_of_birth' ? 'date' : 'text'}
        value={editingValue ?? ''}
        onChange={(e) => setEditingValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); confirmEdit(); }
          if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
        }}
        disabled={savingField !== null}
        autoFocus
      />
    );
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="left" className="w-full sm:max-w-lg overflow-y-auto" dir="rtl">
        <SheetHeader>
          <SheetTitle>
            {candidateTitle(active)}
          </SheetTitle>
          <SheetDescription>
            {ENTITY_LABELS[entity_type] ?? entity_type}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {showEntityTabs && (
            <section className="space-y-2">
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="רשומות מחוברות">
                {candidateTabs.map((tabCandidate) => {
                  const activeTab = tabCandidate.id === active.id;
                  const blockerCount = Number(tabCandidate.blocking_issues_count || 0);
                  const warningCount = (tabCandidate.issues || []).filter((item) => item?.severity === 'warning').length;
                  return (
                    <button
                      key={tabCandidate.id}
                      type="button"
                      role="tab"
                      aria-selected={activeTab}
                      onClick={() => switchActiveCandidate(tabCandidate.id)}
                      className={cn(
                        'inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                        activeTab ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted',
                      )}
                    >
                      <span>{ENTITY_TAB_LABELS[tabCandidate.entity_type] || ENTITY_LABELS[tabCandidate.entity_type] || tabCandidate.entity_type}</span>
                      <Badge variant={STATUS_VARIANT[tabCandidate.status] || 'secondary'} className="px-1.5 py-0 text-[10px]">
                        {STATUS_LABELS[tabCandidate.status] || tabCandidate.status}
                      </Badge>
                      {blockerCount > 0 && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-destructive/10 px-1 py-0.5 text-[10px] text-destructive">
                          <AlertCircle className="h-3 w-3" />
                          {blockerCount}
                        </span>
                      )}
                      {blockerCount === 0 && warningCount > 0 && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-yellow-100 px-1 py-0.5 text-[10px] text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                          <AlertTriangle className="h-3 w-3" />
                          {warningCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {(relatedGroupKey.identity_number || relatedGroupKey.guardian_phone) && (
                <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                  {relatedGroupKey.identity_number && (
                    <span className="rounded-md bg-muted px-2 py-1">
                      ת״ז: {relatedGroupKey.identity_number}
                    </span>
                  )}
                  {relatedGroupKey.guardian_phone && (
                    <span className="rounded-md bg-muted px-2 py-1">
                      טלפון הורה: {relatedGroupKey.guardian_phone}
                    </span>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Candidate data — read-only rows with per-field inline editing */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">נתוני רשומה</h3>
              {editable && (
                <span className="text-[11px] text-muted-foreground">לחצו על העיפרון כדי לערוך שדה</span>
              )}
            </div>

            <div className="space-y-1.5">
              {shownFields.map((field) => {
                const isEditing = editingField === field;
                const changed = fieldChanges[field];
                return (
                  <div key={field} className="rounded-md border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {FIELD_LABELS[field] || field}
                        {changed ? (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">נערך ידנית</Badge>
                        ) : null}
                      </span>
                      {editable && !isEditing && (
                        <button
                          type="button"
                          onClick={() => startEdit(field)}
                          disabled={busy}
                          aria-label={`ערוך ${FIELD_LABELS[field] || field}`}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="mt-1.5 flex items-start gap-1.5">
                        <div className="flex-1">{renderEditor(field)}</div>
                        <button
                          type="button"
                          onClick={confirmEdit}
                          disabled={savingField !== null}
                          aria-label="אשר"
                          className="mt-0.5 rounded-md border border-green-600/40 p-1.5 text-green-700 hover:bg-green-50 disabled:opacity-50 dark:text-green-400 dark:hover:bg-green-900/20"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={savingField !== null}
                          aria-label="בטל"
                          className="mt-0.5 rounded-md border p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="text-sm font-medium">{displayValue(field, candidate_data[field])}</div>
                    )}

                    {!isEditing && changed?.from !== undefined && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        ערך קודם: {displayValue(field, changed.from)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Add missing field */}
            {editable && missingFields.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setAddOpen((o) => !o)}
                  disabled={busy}
                  className="flex items-center gap-1.5 text-xs text-primary hover:underline disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  הוסף שדה חסר
                </button>
                {addOpen && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {missingFields.map((field) => (
                      <button
                        key={field}
                        type="button"
                        onClick={() => startEdit(field)}
                        className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
                      >
                        {FIELD_LABELS[field] || field}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {saveError && (
              <p className="text-xs text-destructive">{saveError}</p>
            )}
          </section>

          {/* Dry-run simulation result */}
          {activeDryRunSummary && (
            <>
              <Separator />
              <section>
                <h3 className="text-sm font-semibold mb-2">תוצאת בדיקה ללא ייבוא</h3>
                <div className="rounded-lg border bg-muted/40 px-3 py-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">תוצאה</span>
                    <DryRunOutcomeBadge outcome={activeDryRunSummary.outcome} />
                  </div>
                  {activeDryRunSummary.action_description && (
                    <p>{activeDryRunSummary.action_description}</p>
                  )}
                  {activeDryRunSummary.matched_record_summary && (
                    <p className="text-xs text-muted-foreground">
                      רשומה תואמת: {formatMatchedRecordSummary(activeDryRunSummary.matched_record_summary)}
                    </p>
                  )}
                  {activeDryRunSummary.fields_that_would_change?.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      שדות לעדכון:{' '}
                      {activeDryRunSummary.fields_that_would_change
                        .map(f => FIELD_LABELS[f] || f)
                        .join(', ')}
                    </p>
                  )}
                </div>
              </section>
            </>
          )}

          {/* Issues */}
          {(blockers.length > 0 || warnings.length > 0) && (
            <>
              <Separator />
              <section>
                <h3 className="text-sm font-semibold mb-2">בעיות שזוהו</h3>
                <ul className="space-y-1.5">
                  {blockers.map((iss, i) => <IssueItem key={i} issue={iss} />)}
                  {warnings.map((iss, i) => <IssueItem key={i} issue={iss} />)}
                </ul>
              </section>
            </>
          )}

          {/* Current decision */}
          {decisions.action && (
            <>
              <Separator />
              <section>
                <h3 className="text-sm font-semibold mb-1">החלטה קיימת</h3>
                <Badge variant="outline">{DECISION_LABELS[decisions.action] || decisions.action}</Badge>
                {describeDecision(decisions) && (
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {describeDecision(decisions)}
                  </p>
                )}
              </section>
            </>
          )}

          <Separator />

          {/* Decision buttons */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">פעולה</h3>

            {/* Preflight check button */}
            {status !== 'committed' && workspaceId && (
              <>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={handleRunDryRun}
                  disabled={runningDryRun || busy}
                >
                  <Zap className="h-4 w-4" />
                  {runningDryRun ? 'בודק ללא ייבוא…' : activeDryRunSummary ? 'בדוק שוב ללא ייבוא' : 'בדוק ללא ייבוא'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  הבדיקה מראה מה יקרה בייבוא הסופי, בלי ליצור או לעדכן נתונים בפועל.
                </p>
                {dryRunError && (
                  <p className="text-xs text-destructive">{dryRunError}</p>
                )}
              </>
            )}

            {status !== 'committed' && status !== 'skipped' && !linkMode && (
              <>
                <p className="text-xs text-muted-foreground">
                  אם זו אותה רשומה שכבר קיימת במערכת, קשר אותה לרשומה הקיימת. אם זה אדם אחר עם פרט דומה, צור רשומה חדשה. אם לא רוצים לייבא את השורה, דלג עליה.
                </p>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={openLinkPanel}
                  disabled={busy}
                >
                  <Link2 className="h-4 w-4" />
                  קשר לאדם שכבר קיים במערכת
                </Button>
                <p className="text-[11px] leading-5 text-muted-foreground">
                  המערכת תחפש קודם רשומה קיימת לפי תעודת זהות. אם לא תימצא התאמה, אפשר לחפש לפי שם, טלפון, ת״ז או פרטי הורה.
                </p>

                {!hasIdentityBlocker && (
                  <>
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2"
                      onClick={handleCreateAsNew}
                      disabled={busy}
                    >
                      <PlusCircle className="h-4 w-4" />
                      צור אדם חדש אפילו אם זוהה כקיים
                    </Button>
                    <p className="text-[11px] leading-5 text-muted-foreground">
                      מתאים אם זו לא אותה רשומה קיימת, או אם האדם עדיין לא קיים במערכת.
                    </p>
                  </>
                )}

                <Button
                  variant="ghost"
                  className="w-full justify-start gap-2 text-muted-foreground"
                  onClick={handleSkip}
                  disabled={busy}
                >
                  <XCircle className="h-4 w-4" />
                  דלג על שורה זו
                </Button>
              </>
            )}

            {status !== 'committed' && status !== 'skipped' && linkMode && (
              <div className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">קישור לרשומה קיימת</h4>
                  <button
                    type="button"
                    onClick={closeLinkPanel}
                    aria-label="סגור קישור"
                    className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                    disabled={linking}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {linkLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    מחפש…
                  </div>
                )}

                {linkStep === 'auto' && !linkLoading && linkResults.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">נמצאה רשומה תואמת לפי תעודת זהות:</p>
                    {linkResults.map((profile) => (
                      <ProfileResultCard
                        key={profile.client_profile_id}
                        profile={profile}
                        onLink={confirmLink}
                        disabled={linking}
                      />
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full gap-1.5"
                      onClick={() => { setLinkStep('search'); setLinkResults([]); setLinkQuery(''); }}
                      disabled={linking}
                    >
                      <Search className="h-3.5 w-3.5" />
                      שנה רשומה לקישור (חיפוש)
                    </Button>
                  </div>
                )}

                {linkStep === 'search' && (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={linkQuery}
                        onChange={(e) => setLinkQuery(e.target.value)}
                        placeholder="חיפוש לפי שם, טלפון, ת״ז או הורה"
                        className="ps-8"
                        autoFocus
                        disabled={linking}
                      />
                    </div>
                    {!linkLoading && linkQuery.trim().length >= 2 && linkResults.length === 0 && (
                      <p className="text-xs text-muted-foreground">לא נמצאו רשומות מתאימות.</p>
                    )}
                    {linkResults.map((profile) => (
                      <ProfileResultCard
                        key={profile.client_profile_id}
                        profile={profile}
                        onLink={confirmLink}
                        disabled={linking}
                      />
                    ))}
                  </div>
                )}

                {linkError && <p className="text-xs text-destructive">{linkError}</p>}

                {/* Prefer-file placeholder — future feature */}
                <div className="rounded-md border border-dashed px-3 py-2 opacity-60 select-none">
                  <p className="text-xs font-medium text-muted-foreground">
                    העדפת פרטי הקובץ על הקיים
                    <span className="ms-1.5 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px]">בקרוב</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    כרגע רק שדות ריקים מתמלאים. שדות קיימים אינם משתנים עד שהתכונה תהיה זמינה.
                  </p>
                </div>
              </div>
            )}

            {status === 'committed' && (
              <p className="text-sm text-muted-foreground">רשומה זו כבר בוצעה.</p>
            )}
            {status === 'skipped' && (
              <p className="text-sm text-muted-foreground">שורה זו מדולגת.</p>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
