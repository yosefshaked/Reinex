const OPTION_TYPES = new Set(['select', 'radio', 'buttons']);
const RANGE_TYPES = new Set(['scale']);

export function parseSessionFormConfig(settingsValue) {
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
          key: 'question_1',
          label: trimmed,
          type: 'textarea',
          placeholder: '',
          required: false,
          options: [],
        },
      ];
    }
  }

  if (Array.isArray(payload)) {
    return payload.map((entry, index) => normalizeQuestion(entry, index));
  }

  if (payload && typeof payload === 'object' && payload.current && Array.isArray(payload.current.questions)) {
    return payload.current.questions.map((entry, index) => normalizeQuestion(entry, index));
  }

  if (payload && typeof payload === 'object' && Array.isArray(payload.questions)) {
    return payload.questions.map((entry, index) => normalizeQuestion(entry, index));
  }

  return [];
}

export function ensureSessionFormFallback(questions) {
  if (Array.isArray(questions) && questions.length) {
    return questions;
  }

  return [
    {
      key: 'session_summary',
      label: 'תיאור המפגש',
      type: 'textarea',
      placeholder: 'תארו בקצרה את מהלך המפגש',
      required: false,
      options: [],
    },
    {
      key: 'next_steps',
      label: 'משימות להמשך',
      type: 'textarea',
      placeholder: 'משימות או הערות להמשך התקדמות',
      required: false,
      options: [],
    },
  ];
}

function normalizeQuestion(entry, index) {
  if (!entry) {
    return {
      key: `question_${index + 1}`,
      label: `שאלה ${index + 1}`,
      type: 'textarea',
      placeholder: '',
      required: false,
      options: [],
    };
  }

  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    return {
      key: trimmed ? createQuestionKey(trimmed, index) : `question_${index + 1}`,
      label: trimmed || `שאלה ${index + 1}`,
      type: 'textarea',
      placeholder: '',
      required: false,
      options: [],
    };
  }

  const label = extractLabel(entry, index);
  const type = normalizeType(entry?.type);

  const keySource = typeof entry.key === 'string' && entry.key.trim()
    ? entry.key.trim()
    : typeof entry.id === 'string' && entry.id.trim()
      ? entry.id.trim()
      : label;
  const key = createQuestionKey(keySource, index);
  
  // Preserve id field if it exists (needed for preconfigured answers lookup)
  const id = typeof entry.id === 'string' && entry.id.trim()
    ? entry.id.trim()
    : null;

  const placeholder = typeof entry.placeholder === 'string' ? entry.placeholder : '';
  const required = Boolean(entry.required);
  const options = OPTION_TYPES.has(type)
    ? normalizeOptions(entry.options)
    : [];
  const range = RANGE_TYPES.has(type) ? normalizeRange(entry.range ?? entry.scale) : null;

  const question = {
    key,
    label,
    type,
    placeholder,
    required,
    options,
  };
  
  // Add id if present
  if (id) {
    question.id = id;
  }

  if (range) {
    question.range = range;
  }

  return question;
}

function extractLabel(entry, index) {
  if (typeof entry.label === 'string' && entry.label.trim()) {
    return entry.label.trim();
  }
  if (typeof entry.title === 'string' && entry.title.trim()) {
    return entry.title.trim();
  }
  if (typeof entry.question === 'string' && entry.question.trim()) {
    return entry.question.trim();
  }
  return `שאלה ${index + 1}`;
}

function normalizeType(type) {
  if (typeof type !== 'string') {
    return 'textarea';
  }
  const normalized = type.trim().toLowerCase();
  if (!normalized) {
    return 'textarea';
  }
  return normalized;
}

function normalizeOptions(options) {
  if (!Array.isArray(options)) {
    return [];
  }
  return options
    .map(normalizeOption)
    .filter(Boolean);
}

function normalizeOption(entry, index) {
  if (!entry) {
    return null;
  }

  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    if (!trimmed) {
      return null;
    }
    return {
      value: createQuestionKey(trimmed, index),
      label: trimmed,
    };
  }

  if (typeof entry !== 'object') {
    return null;
  }

  const label = typeof entry.label === 'string' && entry.label.trim()
    ? entry.label.trim()
    : typeof entry.title === 'string' && entry.title.trim()
      ? entry.title.trim()
      : typeof entry.value === 'string' && entry.value.trim()
        ? entry.value.trim()
        : '';
  if (!label) {
    return null;
  }

  const valueCandidate = typeof entry.value === 'string' && entry.value.trim()
    ? entry.value.trim()
    : typeof entry.id === 'string' && entry.id.trim()
      ? entry.id.trim()
      : createQuestionKey(label, index);

  return {
    value: valueCandidate,
    label,
  };
}

function normalizeRange(range) {
  if (!range || typeof range !== 'object') {
    return null;
  }

  const min = toNumber(range.min, null);
  const max = toNumber(range.max, null);
  const step = toNumber(range.step, null);

  if (min === null || max === null) {
    return null;
  }

  const resolvedStep = step === null || step <= 0 ? 1 : step;
  const resolvedMax = max <= min ? min + resolvedStep : max;

  return {
    min,
    max: resolvedMax,
    step: resolvedStep,
  };
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

function createQuestionKey(label, index) {
  const normalized = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9א-ת]+/gi, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '');
  return normalized || `question_${index + 1}`;
}
