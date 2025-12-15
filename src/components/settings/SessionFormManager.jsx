import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, ListPlus, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import QuestionTypePreview from './QuestionTypePreview.jsx';
import { fetchSessionFormConfig } from '@/features/settings/api/index.js';
import { upsertSetting } from '@/features/settings/api/settings.js';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';

const REQUEST_STATE = Object.freeze({
  idle: 'idle',
  loading: 'loading',
  error: 'error',
});

const SAVE_STATE = Object.freeze({
  idle: 'idle',
  saving: 'saving',
  error: 'error',
});

const QUESTION_TYPE_OPTIONS = [
  { value: 'textarea', label: 'טקסט חופשי (פסקה)' },
  { value: 'text', label: 'טקסט קצר' },
  { value: 'number', label: 'מספר' },
  { value: 'date', label: 'תאריך' },
  { value: 'select', label: 'בחירה מרשימה' },
  { value: 'radio', label: 'כפתורי בחירה' },
  { value: 'buttons', label: 'בחירה באמצעות כפתורים' },
  { value: 'scale', label: 'סולם הערכה (טווח מספרי)' },
];

const OPTION_TYPES = new Set(['select', 'radio', 'buttons']);
const RANGE_TYPES = new Set(['scale']);

const DEFAULT_RANGE = Object.freeze({ min: 1, max: 5, step: 1 });

function generateId(prefix) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function createQuestionId(label, index) {
  const base = typeof label === 'string' && label.trim()
    ? label.trim().toLowerCase()
    : `question_${index + 1}`;
  return base
    .replace(/[^a-z0-9א-ת]+/gi, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '')
    || `question_${index + 1}`;
}

function createEmptyQuestion(index = 0) {
  return {
    id: generateId('question'),
    label: `שאלה ${index + 1}`,
    type: 'textarea',
    placeholder: '',
    required: false,
    options: [],
    range: { ...DEFAULT_RANGE },
  };
}

function createEmptyOption() {
  return {
    id: generateId('option'),
    label: '',
    value: '',
  };
}

function extractRawQuestions(settingsValue) {
  if (!settingsValue) {
    return [];
  }
  let payload = settingsValue;
  if (typeof settingsValue === 'string') {
    const trimmed = settingsValue.trim();
    if (!trimmed) {
      return [];
    }
    try {
      payload = JSON.parse(trimmed);
    } catch {
      return [
        {
          id: createQuestionId(trimmed, 0),
          label: trimmed,
          type: 'textarea',
        },
      ];
    }
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === 'object' && payload.current && Array.isArray(payload.current.questions)) {
    return payload.current.questions;
  }
  if (payload && typeof payload === 'object' && Array.isArray(payload.questions)) {
    return payload.questions;
  }
  return [];
}

function normalizeOptionForEditing(option, index) {
  if (!option) {
    return null;
  }
  if (typeof option === 'string') {
    const trimmed = option.trim();
    if (!trimmed) {
      return null;
    }
    return {
      id: generateId('option'),
      label: trimmed,
      value: createQuestionId(trimmed, index),
    };
  }
  if (typeof option !== 'object') {
    return null;
  }
  const label = typeof option.label === 'string' && option.label.trim()
    ? option.label.trim()
    : typeof option.title === 'string' && option.title.trim()
      ? option.title.trim()
      : typeof option.value === 'string' && option.value.trim()
        ? option.value.trim()
        : '';
  if (!label) {
    return null;
  }
  const valueCandidate = typeof option.value === 'string' && option.value.trim()
    ? option.value.trim()
    : typeof option.id === 'string' && option.id.trim()
      ? option.id.trim()
      : createQuestionId(label, index);
  const id = typeof option.id === 'string' && option.id.trim()
    ? option.id.trim()
    : generateId('option');
  return {
    id,
    label,
    value: valueCandidate,
  };
}

function ensureOptionsForType(type, rawOptions) {
  if (!OPTION_TYPES.has(type)) {
    return [];
  }
  const normalized = Array.isArray(rawOptions)
    ? rawOptions.map((entry, index) => normalizeOptionForEditing(entry, index)).filter(Boolean)
    : [];
  if (normalized.length) {
    return normalized;
  }
  return [createEmptyOption(), createEmptyOption()];
}

function normalizeRangeConfig(range) {
  if (!range || typeof range !== 'object') {
    return { ...DEFAULT_RANGE };
  }
  const min = toNumber(range.min, DEFAULT_RANGE.min);
  const max = toNumber(range.max, DEFAULT_RANGE.max);
  const step = toNumber(range.step, DEFAULT_RANGE.step);
  const safeStep = step <= 0 ? DEFAULT_RANGE.step : step;
  const safeMax = max <= min ? min + safeStep : max;
  return {
    min,
    max: safeMax,
    step: safeStep,
  };
}

function deserializeQuestions(rawQuestions) {
  if (!Array.isArray(rawQuestions) || !rawQuestions.length) {
    return [];
  }
  return rawQuestions.map((entry, index) => {
    if (!entry) {
      return createEmptyQuestion(index);
    }
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      return {
        ...createEmptyQuestion(index),
        id: generateId('question'),
        label: trimmed || `שאלה ${index + 1}`,
      };
    }
    if (typeof entry !== 'object') {
      return createEmptyQuestion(index);
    }
    const label = typeof entry.label === 'string' && entry.label.trim()
      ? entry.label.trim()
      : typeof entry.title === 'string' && entry.title.trim()
        ? entry.title.trim()
        : typeof entry.question === 'string' && entry.question.trim()
          ? entry.question.trim()
          : `שאלה ${index + 1}`;
    const type = typeof entry.type === 'string' && entry.type.trim()
      ? entry.type.trim().toLowerCase()
      : 'textarea';
    const id = typeof entry.id === 'string' && entry.id.trim()
      ? entry.id.trim()
      : typeof entry.key === 'string' && entry.key.trim()
        ? entry.key.trim()
        : createQuestionId(label, index);
    const placeholder = typeof entry.placeholder === 'string' ? entry.placeholder : '';
    const required = Boolean(entry.required);
    const options = ensureOptionsForType(type, entry.options);
    const range = normalizeRangeConfig(entry.range ?? entry.scale);
    return {
      id,
      label,
      type,
      placeholder,
      required,
      options,
      range,
    };
  });
}

function toNumber(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function questionRequiresOptions(type) {
  return OPTION_TYPES.has(type);
}

function questionSupportsPlaceholder(type) {
  return type === 'text' || type === 'textarea' || type === 'number';
}

function questionSupportsRange(type) {
  return RANGE_TYPES.has(type);
}

function normalizeOptionForSave(option, index) {
  if (!option) {
    return null;
  }
  const label = typeof option.label === 'string' ? option.label.trim() : '';
  if (!label) {
    return null;
  }
  const valueCandidate = typeof option.value === 'string' && option.value.trim()
    ? option.value.trim()
    : createQuestionId(label, index);
  const id = typeof option.id === 'string' && option.id.trim()
    ? option.id.trim()
    : valueCandidate;
  return {
    id,
    value: valueCandidate,
    label,
  };
}

function normalizeRangeForSave(range) {
  if (!range || typeof range !== 'object') {
    return { ...DEFAULT_RANGE };
  }
  const min = toNumber(range.min, DEFAULT_RANGE.min);
  const max = toNumber(range.max, DEFAULT_RANGE.max);
  const step = toNumber(range.step, DEFAULT_RANGE.step);
  const safeStep = step <= 0 ? DEFAULT_RANGE.step : step;
  const safeMax = max <= min ? min + safeStep : max;
  return {
    min,
    max: safeMax,
    step: safeStep,
  };
}

function buildPayloadFromQuestions(questions) {
  return questions.map((question, index) => {
    const label = typeof question.label === 'string' && question.label.trim()
      ? question.label.trim()
      : `שאלה ${index + 1}`;
    const type = typeof question.type === 'string' && question.type.trim()
      ? question.type.trim().toLowerCase()
      : 'textarea';
    const id = typeof question.id === 'string' && question.id.trim()
      ? question.id.trim()
      : createQuestionId(label, index);
    const base = {
      id,
      label,
      type,
      required: Boolean(question.required),
    };
    if (questionSupportsPlaceholder(type)) {
      const placeholder = typeof question.placeholder === 'string'
        ? question.placeholder.trim()
        : '';
      if (placeholder) {
        base.placeholder = placeholder;
      }
    }
    if (questionRequiresOptions(type)) {
      const options = Array.isArray(question.options)
        ? question.options.map((option, optionIndex) => normalizeOptionForSave(option, optionIndex)).filter(Boolean)
        : [];
      if (options.length) {
        base.options = options;
      }
    }
    if (questionSupportsRange(type)) {
      base.range = normalizeRangeForSave(question.range);
    }
    return base;
  });
}

function validateQuestions(questions) {
  const errors = [];
  const ids = new Set();
  questions.forEach((question, index) => {
    const label = typeof question.label === 'string' ? question.label.trim() : '';
    if (!label) {
      errors.push(`שאלה ${index + 1} חייבת לכלול טקסט.`);
    }
    const id = typeof question.id === 'string' ? question.id.trim() : '';
    if (!id) {
      errors.push(`שאלה ${index + 1} חייבת לכלול מזהה ייחודי.`);
    } else if (ids.has(id)) {
      errors.push(`המזהה ${id} מופיע ביותר משאלה אחת.`);
    } else {
      ids.add(id);
    }
    if (questionRequiresOptions(question.type)) {
      const options = Array.isArray(question.options)
        ? question.options.map((option) => ({
          label: typeof option?.label === 'string' ? option.label.trim() : '',
          value: typeof option?.value === 'string' ? option.value.trim() : '',
        })).filter((option) => option.label && option.value)
        : [];
      if (options.length < 2) {
        errors.push(`שאלה ${index + 1} חייבת לכלול לפחות שתי אפשרויות בחירה.`);
      }
      const values = new Set();
      const reportedDuplicates = new Set();
      options.forEach((option) => {
        if (values.has(option.value)) {
          if (!reportedDuplicates.has(option.value)) {
            errors.push(`לשאלה ${index + 1} קיימות אפשרויות עם ערך כפול (${option.value}).`);
            reportedDuplicates.add(option.value);
          }
        } else {
          values.add(option.value);
        }
      });
    }
    if (questionSupportsRange(question.type)) {
      const range = normalizeRangeForSave(question.range);
      if (range.min >= range.max) {
        errors.push(`לשאלה ${index + 1} יש טווח לא חוקי: הערך המקסימלי חייב להיות גדול מהמינימום.`);
      }
      if (range.step <= 0) {
        errors.push(`לשאלה ${index + 1} יש ערך צעד לא חוקי.`);
      }
    }
  });
  return errors;
}

function questionLabel(question, index) {
  const label = typeof question.label === 'string' && question.label.trim()
    ? question.label.trim()
    : `שאלה ${index + 1}`;
  return label;
}

export default function SessionFormManager({
  session,
  orgId,
  activeOrgHasConnection,
  tenantClientReady,
}) {
  const [questions, setQuestions] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [loadState, setLoadState] = useState(REQUEST_STATE.idle);
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState(SAVE_STATE.idle);
  const [saveError, setSaveError] = useState('');
  const [validationErrors, setValidationErrors] = useState([]);
  const lastSavedSignatureRef = useRef('[]');
  const lastSavedPayloadRef = useRef([]);
  const [preanswersMap, setPreanswersMap] = useState({}); // { [questionId]: string[] }
  const lastSavedPreanswersRef = useRef({});
  const { authClient } = useSupabase();
  const { activeOrgId } = useOrg();
  const [cap, setCap] = useState(50);

  const canLoad = Boolean(session && orgId && activeOrgHasConnection && tenantClientReady);

  const currentSignature = useMemo(() => {
    const payload = buildPayloadFromQuestions(questions);
    return JSON.stringify(payload);
  }, [questions]);

  const currentPreanswersSignature = useMemo(() => {
    return JSON.stringify(preanswersMap);
  }, [preanswersMap]);

  const questionsChanged = currentSignature !== lastSavedSignatureRef.current;
  const preanswersChanged = currentPreanswersSignature !== JSON.stringify(lastSavedPreanswersRef.current);
  const isDirty = questionsChanged || preanswersChanged;
  const isSaving = saveState === SAVE_STATE.saving;
  const isLoading = loadState === REQUEST_STATE.loading;

  const applyLoadedQuestions = useCallback((rawValue, metadata = null) => {
    const rawQuestions = extractRawQuestions(rawValue);
    const normalized = deserializeQuestions(rawQuestions);
    setQuestions(normalized);
    // Collapse all by default on load for compact view
    const collapsed = {};
    normalized.forEach((q) => { collapsed[q.id] = false; });
    setExpanded(collapsed);
    const payload = buildPayloadFromQuestions(normalized);
    lastSavedPayloadRef.current = payload;
    lastSavedSignatureRef.current = JSON.stringify(payload);
    // load preconfigured answers from metadata
    const incomingMap = metadata && typeof metadata === 'object' && metadata.preconfigured_answers && typeof metadata.preconfigured_answers === 'object'
      ? metadata.preconfigured_answers
      : {};
    setPreanswersMap(incomingMap);
    lastSavedPreanswersRef.current = incomingMap;
  }, []);

  const loadQuestions = useCallback(async () => {
    if (!canLoad) {
      setQuestions([]);
      lastSavedPayloadRef.current = [];
      lastSavedSignatureRef.current = '[]';
      return;
    }
    setLoadState(REQUEST_STATE.loading);
    setLoadError('');
    try {
      const { value, metadata } = await fetchSessionFormConfig({ session, orgId });
      applyLoadedQuestions(value, metadata);
      setValidationErrors([]);
      setSaveError('');
      setLoadState(REQUEST_STATE.idle);
    } catch (error) {
      console.error('Failed to load session form configuration', error);
      setQuestions([]);
      lastSavedPayloadRef.current = [];
      lastSavedSignatureRef.current = '[]';
      setLoadState(REQUEST_STATE.error);
      setLoadError(error?.message || 'טעינת שאלות המפגש נכשלה.');
    }
  }, [applyLoadedQuestions, canLoad, orgId, session]);

  // Load cap from control DB org permissions (fallback 50)
  useEffect(() => {
    const run = async () => {
      try {
        if (!authClient || !activeOrgId) return;
        const { data: orgSettings, error } = await authClient
          .from('org_settings')
          .select('permissions')
          .eq('org_id', activeOrgId)
          .single();
        if (error) return;
        const perms = orgSettings?.permissions || {};
        const capRaw = perms.session_form_preanswers_cap;
        const parsed = Number.parseInt(String(capRaw ?? '50'), 10);
        setCap(Number.isFinite(parsed) && parsed > 0 ? parsed : 50);
      } catch {
        setCap(50);
      }
    };
    run();
  }, [authClient, activeOrgId]);

  useEffect(() => {
    if (!canLoad) {
      setQuestions([]);
      lastSavedPayloadRef.current = [];
      lastSavedSignatureRef.current = '[]';
      return;
    }
    void loadQuestions();
  }, [canLoad, loadQuestions]);

  const handleAddQuestion = () => {
    setQuestions((prev) => {
      const next = [...prev, createEmptyQuestion(prev.length)];
      // Expand the newly added question for immediate editing
      const last = next[next.length - 1];
      setExpanded((e) => ({ ...e, [last.id]: true }));
      return next;
    });
  };

  const handleRemoveQuestion = (id) => {
    setQuestions((prev) => prev.filter((question) => question.id !== id));
  };

  const handleQuestionChange = (id, updates) => {
    setQuestions((prev) => prev.map((question) => {
      if (question.id !== id) {
        return question;
      }
      const nextQuestion = { ...question, ...updates };
      if (!questionSupportsPlaceholder(nextQuestion.type)) {
        nextQuestion.placeholder = '';
      }
      if (!questionRequiresOptions(nextQuestion.type)) {
        nextQuestion.options = [];
      }
      if (!questionSupportsRange(nextQuestion.type)) {
        nextQuestion.range = { ...DEFAULT_RANGE };
      }
      if (questionRequiresOptions(nextQuestion.type) && !Array.isArray(nextQuestion.options)) {
        nextQuestion.options = [createEmptyOption(), createEmptyOption()];
      }
      if (questionSupportsRange(nextQuestion.type) && !nextQuestion.range) {
        nextQuestion.range = { ...DEFAULT_RANGE };
      }
      return nextQuestion;
    }));
  };

  const handleAddPreanswer = (questionId) => {
    setPreanswersMap((prev) => {
      const current = Array.isArray(prev[questionId]) ? prev[questionId] : [];
      if (current.length >= cap) {
        toast.error(`לא ניתן להוסיף יותר מ-${cap} תשובות מוכנות לשאלה זו.`);
        return prev;
      }
      return { ...prev, [questionId]: [...current, ''] };
    });
  };

  const handlePreanswerChange = (questionId, index, value) => {
    setPreanswersMap((prev) => {
      const current = Array.isArray(prev[questionId]) ? [...prev[questionId]] : [];
      if (!current[index] && value.trim() === '') return prev;
      current[index] = value;
      return { ...prev, [questionId]: current };
    });
  };

  const handleRemovePreanswer = (questionId, index) => {
    setPreanswersMap((prev) => {
      const current = Array.isArray(prev[questionId]) ? [...prev[questionId]] : [];
      current.splice(index, 1);
      return { ...prev, [questionId]: current };
    });
  };

  const toggleExpanded = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleMoveQuestion = (id, direction) => {
    setQuestions((prev) => {
      const index = prev.findIndex((question) => question.id === id);
      if (index === -1) {
        return prev;
      }
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  };

  const handleOptionChange = (questionId, optionId, updates) => {
    setQuestions((prev) => prev.map((question) => {
      if (question.id !== questionId) {
        return question;
      }
      const options = Array.isArray(question.options) ? [...question.options] : [];
      const index = options.findIndex((option) => option.id === optionId);
      if (index === -1) {
        return question;
      }
      options[index] = { ...options[index], ...updates };
      return { ...question, options };
    }));
  };

  const handleAddOption = (questionId) => {
    setQuestions((prev) => prev.map((question) => {
      if (question.id !== questionId) {
        return question;
      }
      const options = Array.isArray(question.options) ? [...question.options, createEmptyOption()] : [createEmptyOption()];
      return { ...question, options };
    }));
  };

  const handleRemoveOption = (questionId, optionId) => {
    setQuestions((prev) => prev.map((question) => {
      if (question.id !== questionId) {
        return question;
      }
      const options = Array.isArray(question.options)
        ? question.options.filter((option) => option.id !== optionId)
        : [];
      return { ...question, options };
    }));
  };

  const handleMoveOption = (questionId, optionIndex, direction) => {
    setQuestions((prev) => prev.map((question) => {
      if (question.id !== questionId) return question;
      const options = Array.isArray(question.options) ? [...question.options] : [];
      const targetIndex = direction === 'up' ? optionIndex - 1 : optionIndex + 1;
      if (optionIndex < 0 || optionIndex >= options.length) return question;
      if (targetIndex < 0 || targetIndex >= options.length) return question;
      const [item] = options.splice(optionIndex, 1);
      options.splice(targetIndex, 0, item);
      return { ...question, options };
    }));
  };

  const handleRangeChange = (questionId, field, value) => {
    setQuestions((prev) => prev.map((question) => {
      if (question.id !== questionId) {
        return question;
      }
      const range = questionSupportsRange(question.type)
        ? { ...question.range, [field]: value }
        : { ...DEFAULT_RANGE };
      return { ...question, range };
    }));
  };

  const handleReset = () => {
    setValidationErrors([]);
    setSaveError('');
    const payload = lastSavedPayloadRef.current;
    const normalized = deserializeQuestions(payload);
    setQuestions(normalized);
    setPreanswersMap(lastSavedPreanswersRef.current || {});
  };

  const handleSave = async () => {
    if (!canLoad) {
      toast.error('לא ניתן לשמור בלי חיבור ארגוני פעיל.');
      return;
    }
    setSaveError('');
    const errors = validateQuestions(questions);
    // Validate preanswers cap
    for (const q of questions) {
      if (q.type === 'text' || q.type === 'textarea') {
        const list = Array.isArray(preanswersMap[q.id]) ? preanswersMap[q.id] : [];
        if (list.length > cap) {
          errors.push(`לשאלה "${q.label}" יש יותר מ-${cap} תשובות מוכנות. נא להסיר חלק מהן.`);
        }
      }
    }
    setValidationErrors(errors);
    if (errors.length) {
      toast.error('נא להשלים את הערכים החסרים לפני שמירה.');
      return;
    }
    setSaveState(SAVE_STATE.saving);
    try {
      const payload = buildPayloadFromQuestions(questions);
      // Build metadata: only include text/textarea preanswers, trim/unique up to cap
      const preconfigured = {};
      for (const q of questions) {
        if (q.type !== 'text' && q.type !== 'textarea') continue;
        const list = Array.isArray(preanswersMap[q.id]) ? preanswersMap[q.id] : [];
        const unique = [];
        const seen = new Set();
        for (const raw of list) {
          if (typeof raw !== 'string') continue;
          const t = raw.trim();
          if (!t || seen.has(t)) continue;
          seen.add(t);
          unique.push(t);
          if (unique.length >= cap) break;
        }
        if (unique.length) {
          preconfigured[q.id] = unique;
        }
      }

      await upsertSetting({
        session,
        orgId,
        key: 'session_form_config',
        value: { value: payload, metadata: { preconfigured_answers: preconfigured } },
      });
      lastSavedPayloadRef.current = payload;
      lastSavedSignatureRef.current = JSON.stringify(payload);
      lastSavedPreanswersRef.current = preanswersMap;
      setSaveState(SAVE_STATE.idle);
      toast.success('שאלות המפגש נשמרו בהצלחה.');
    } catch (error) {
      console.error('Failed to save session form configuration', error);
      setSaveError(error?.message || 'שמירת ההגדרות נכשלה.');
      setSaveState(SAVE_STATE.error);
      toast.error('שמירת ההגדרות נכשלה.');
    }
  };

  if (!activeOrgHasConnection || !tenantClientReady) {
    return (
      <Card className="w-full border-0 shadow-lg bg-white/80">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-slate-900 sm:text-lg">ניהול שאלות המפגש</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-sm text-xs text-amber-800 sm:p-md sm:text-sm" role="status">
            חברו את הארגון ל-Supabase באמצעות האשף לפני ניהול שאלות המפגש.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full border-0 shadow-lg bg-white/80" dir="rtl">
      <CardHeader className="border-b border-slate-200 space-y-xs sm:space-y-sm">
        <CardTitle className="text-base font-semibold text-slate-900 sm:text-lg md:text-xl">ניהול טופס שאלות למפגש</CardTitle>
        <p className="text-xs text-slate-600 sm:text-sm">
          הגדירו את השאלות שיופיעו בטופס רישום המפגש. ניתן להוסיף, להסיר, לסדר ולדרוש שדות חובה.
        </p>
        <Badge variant="outline" className="w-fit text-xs text-slate-600">
          שמירה יוצרת גרסה חדשה שנשלטת בצד השרת
        </Badge>
      </CardHeader>
      <CardContent className="space-y-md sm:space-y-lg">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : loadState === REQUEST_STATE.error ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
              {loadError || 'טעינת השאלות נכשלה. נסו שוב.'}
            </div>
            <Button onClick={loadQuestions} variant="outline" className="gap-2" disabled={isLoading}>
              <Loader2 className="h-4 w-4" aria-hidden="true" />
              נסה שוב
            </Button>
          </div>
        ) : (
          <>
            {questions.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                לא הוגדרו שאלות. הוסיפו שאלה חדשה כדי להתחיל.
              </div>
            ) : (
              <div className="space-y-4">
                {questions.map((question, index) => {
                  const label = questionLabel(question, index);
                  const options = Array.isArray(question.options) ? question.options : [];
                  const supportsPlaceholder = questionSupportsPlaceholder(question.type);
                  const requiresOptions = questionRequiresOptions(question.type);
                  const supportsRange = questionSupportsRange(question.type);
                  return (
                    <div key={question.id} className="rounded-2xl border border-slate-200 bg-white/60 p-2 sm:p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(question.id)}
                          className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-slate-50"
                          aria-expanded={Boolean(expanded[question.id])}
                          aria-controls={`q-editor-${question.id}`}
                        >
                          <span className="text-sm font-semibold text-slate-900">{label}</span>
                          {expanded[question.id] ? (
                            <ChevronUp className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <ChevronDown className="h-4 w-4" aria-hidden="true" />
                          )}
                        </button>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleMoveQuestion(question.id, 'up')}
                            disabled={index === 0}
                            aria-label="העבר מעלה"
                          >
                            <ArrowUp className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant={question.required ? 'default' : 'ghost'}
                            size="sm"
                            aria-pressed={Boolean(question.required)}
                            onClick={() => handleQuestionChange(question.id, { required: !question.required })}
                            className="h-8 px-3"
                            aria-label="שדה חובה"
                          >
                            חובה
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleMoveQuestion(question.id, 'down')}
                            disabled={index === questions.length - 1}
                            aria-label="העבר מטה"
                          >
                            <ArrowDown className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveQuestion(question.id)}
                            aria-label="מחק שאלה"
                            className="text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                      <div id={`q-editor-${question.id}`} hidden={!expanded[question.id]} className="mt-3 space-y-4">
                        <div className="text-xs text-slate-500">מזהה: {question.id}</div>
                        <div className="grid w-full gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor={`question-label-${question.id}`} className="text-xs sm:text-sm">טקסט השאלה</Label>
                          <Input
                            id={`question-label-${question.id}`}
                            value={question.label}
                            onChange={(event) => handleQuestionChange(question.id, { label: event.target.value })}
                            placeholder="לדוגמה: מה היו יעדי המפגש?"
                            className="text-sm"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`question-id-${question.id}`} className="text-xs sm:text-sm">מזהה ייחודי</Label>
                          <Input
                            id={`question-id-${question.id}`}
                            value={question.id}
                            onChange={(event) => handleQuestionChange(question.id, { id: event.target.value })}
                            placeholder="לדוגמה: session_summary"
                            className="text-sm"
                          />
                          <p className="text-[10px] text-slate-500 sm:text-xs">השתמשו במזהה קבוע כדי לשמור על עקביות בין גרסאות.</p>
                        </div>
                        </div>

                        <div className="grid w-full gap-4 sm:grid-cols-3">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Label htmlFor={`question-type-${question.id}`} className="text-xs sm:text-sm">סוג השאלה</Label>
                            <QuestionTypePreview questionType={question.type} />
                          </div>
                          <Select
                            value={question.type}
                            onValueChange={(value) => handleQuestionChange(question.id, { type: value })}
                          >
                            <SelectTrigger id={`question-type-${question.id}`} className="w-full text-xs sm:text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="max-h-[300px]">
                              {QUESTION_TYPE_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {supportsPlaceholder ? (
                          <div className="space-y-2 sm:col-span-2">
                            <Label htmlFor={`question-placeholder-${question.id}`} className="text-xs sm:text-sm">טקסט עזר</Label>
                            <Input
                              id={`question-placeholder-${question.id}`}
                              value={question.placeholder}
                              onChange={(event) => handleQuestionChange(question.id, { placeholder: event.target.value })}
                              placeholder="לדוגמה: תארו בקצרה את מהלך המפגש"
                              className="text-sm"
                            />
                          </div>
                        ) : (
                          <div className="sm:col-span-2" />
                        )}
                        </div>

                        {/* Required toggle moved to header actions */}

                          {(question.type === 'text' || question.type === 'textarea') ? (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold text-slate-800">תשובות מוכנות (עד {cap})</h4>
                                <Button type="button" variant="outline" size="sm" onClick={() => handleAddPreanswer(question.id)} className="gap-2">
                                  <Plus className="h-4 w-4" aria-hidden="true" /> הוסף תשובה
                                </Button>
                              </div>
                              <div className="space-y-2">
                                {(Array.isArray(preanswersMap[question.id]) ? preanswersMap[question.id] : []).map((ans, idx) => (
                                  <div key={`${question.id}-pa-${idx}`} className="grid w-full gap-2 sm:grid-cols-[1fr,auto] sm:items-center">
                                    <Input
                                      value={ans}
                                      onChange={(e) => handlePreanswerChange(question.id, idx, e.target.value)}
                                      placeholder="תשובה מוכנה"
                                      className="text-sm"
                                    />
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleRemovePreanswer(question.id, idx)}
                                      className="text-red-600 hover:bg-red-50"
                                      aria-label="מחק תשובה"
                                    >
                                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                                    </Button>
                                  </div>
                                ))}
                                {(!Array.isArray(preanswersMap[question.id]) || preanswersMap[question.id].length === 0) ? (
                                  <p className="text-xs text-slate-500">לא הוגדרו תשובות מוכנות לשאלה זו.</p>
                                ) : null}
                              </div>
                            </div>
                          ) : null}

                        {requiresOptions ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-semibold text-slate-800">אפשרויות בחירה</h4>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleAddOption(question.id)}
                                className="gap-2"
                              >
                                <ListPlus className="h-4 w-4" aria-hidden="true" />
                                הוסף אפשרות
                              </Button>
                            </div>
                            <div className="space-y-3">
                              {options.map((option, optIndex) => (
                                <div key={option.id} className="grid w-full gap-3 sm:grid-cols-[2fr,2fr,auto,auto,auto] sm:items-start">
                                  <div className="space-y-2">
                                    <Label htmlFor={`option-label-${option.id}`} className="text-xs sm:text-sm">תווית להצגה</Label>
                                    <Input
                                      id={`option-label-${option.id}`}
                                      value={option.label}
                                      onChange={(event) => handleOptionChange(question.id, option.id, { label: event.target.value })}
                                      placeholder="לדוגמה: הושלם במלואו"
                                      className="text-sm h-9"
                                    />
                                    <p className="text-[10px] text-slate-400 sm:text-xs invisible">יופיע בתוצאות ולוגים.</p>
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor={`option-value-${option.id}`} className="text-xs sm:text-sm">ערך לשמירה</Label>
                                    <Input
                                      id={`option-value-${option.id}`}
                                      value={option.value}
                                      onChange={(event) => handleOptionChange(question.id, option.id, { value: event.target.value })}
                                      placeholder="לדוגמה: completed"
                                      className="text-sm h-9"
                                    />
                                    <p className="text-[10px] text-slate-400 sm:text-xs">יופיע בתוצאות ולוגים.</p>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleMoveOption(question.id, optIndex, 'up')}
                                    disabled={optIndex === 0}
                                    className="self-center h-9 w-9"
                                    aria-label="העבר אפשרות מעלה"
                                  >
                                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleMoveOption(question.id, optIndex, 'down')}
                                    disabled={optIndex === options.length - 1}
                                    className="self-center h-9 w-9"
                                    aria-label="העבר אפשרות מטה"
                                  >
                                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleRemoveOption(question.id, option.id)}
                                    className="self-center text-red-600 hover:bg-red-50 h-9 w-9"
                                    aria-label="מחק אפשרות"
                                  >
                                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {supportsRange ? (
                          <div className="grid w-full gap-4 sm:grid-cols-3">
                            <div className="space-y-2">
                              <Label htmlFor={`range-min-${question.id}`} className="text-xs sm:text-sm">ערך מינימלי</Label>
                              <Input
                                id={`range-min-${question.id}`}
                                type="number"
                                value={question.range?.min ?? DEFAULT_RANGE.min}
                                onChange={(event) => handleRangeChange(question.id, 'min', Number(event.target.value))}
                                className="text-sm"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`range-max-${question.id}`} className="text-xs sm:text-sm">ערך מקסימלי</Label>
                              <Input
                                id={`range-max-${question.id}`}
                                type="number"
                                value={question.range?.max ?? DEFAULT_RANGE.max}
                                onChange={(event) => handleRangeChange(question.id, 'max', Number(event.target.value))}
                                className="text-sm"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`range-step-${question.id}`} className="text-xs sm:text-sm">גודל צעד</Label>
                              <Input
                                id={`range-step-${question.id}`}
                                type="number"
                                value={question.range?.step ?? DEFAULT_RANGE.step}
                                onChange={(event) => handleRangeChange(question.id, 'step', Number(event.target.value))}
                                className="text-sm"
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button type="button" variant="outline" onClick={handleAddQuestion} className="gap-2">
                <Plus className="h-4 w-4" aria-hidden="true" />
                הוסף שאלה חדשה
              </Button>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>שינויים שמורים: {isDirty ? 'לא' : 'כן'}</span>
                <span>•</span>
                <span>שאלות בסך הכל: {questions.length}</span>
              </div>
            </div>

            {validationErrors.length ? (
              <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
                <p className="font-semibold">נא לטפל בשגיאות הבאות:</p>
                <ul className="list-disc space-y-1 pr-5">
                  {validationErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {saveError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
                {saveError}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleReset}
                disabled={!isDirty || isSaving}
              >
                שחזר שינויים
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={!isDirty || isSaving}
                className="gap-2"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    שומר...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" aria-hidden="true" />
                    שמור שינויים
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
