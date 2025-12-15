function extractFirstString(candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return '';
}

function createOptionFallback(option) {
  if (!option) {
    return '';
  }

  if (typeof option === 'string') {
    const trimmed = option.trim();
    return trimmed ? trimmed : '';
  }

  if (typeof option !== 'object') {
    const normalized = String(option).trim();
    return normalized ? normalized : '';
  }

  if (typeof option.toString === 'function' && option.toString !== Object.prototype.toString) {
    const custom = option.toString();
    if (typeof custom === 'string' && custom.trim()) {
      return custom.trim();
    }
  }

  try {
    const serialized = JSON.stringify(option);
    if (serialized && serialized !== '{}') {
      return serialized;
    }
  } catch {
    // ignore
  }

  return '';
}

function normalizeSessionFormOption(option) {
  if (option === null || option === undefined) {
    return null;
  }

  if (typeof option === 'string') {
    const trimmed = option.trim();
    if (!trimmed) {
      return null;
    }
    return { value: trimmed, label: trimmed };
  }

  if (typeof option !== 'object') {
    const normalized = String(option).trim();
    if (!normalized) {
      return null;
    }
    return { value: normalized, label: normalized };
  }

  const label = extractFirstString([
    option.label,
    option.title,
    option.name,
    option.text,
    option.value,
  ]);

  const value = extractFirstString([
    option.value,
    option.id,
    option.key,
    option.code,
    option.slug,
  ]);

  const normalized = {};

  const idCandidate = extractFirstString([option.id, option.key]);
  if (idCandidate) {
    normalized.id = idCandidate;
  }

  const safeValue = value || label;
  const safeLabel = label || value;

  if (!safeValue && !safeLabel) {
    const fallback = createOptionFallback(option);
    if (!fallback) {
      return null;
    }
    normalized.value = fallback;
    normalized.label = fallback;
    return normalized;
  }

  normalized.value = safeValue || safeLabel;
  normalized.label = safeLabel || normalized.value;

  return normalized;
}

function normalizeSessionFormQuestion(entry, index) {
  const fallbackId = `question_${index + 1}`;

  if (!entry || typeof entry !== 'object') {
    return {
      id: fallbackId,
      label: `שאלה ${index + 1}`,
      type: 'text',
      options: [],
      required: false,
    };
  }

  const idCandidates = [entry.id, entry.key, entry.name];
  let id = '';
  for (const candidate of idCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      id = candidate.trim();
      break;
    }
  }
  if (!id) {
    id = fallbackId;
  }

  const labelCandidates = [entry.label, entry.title, entry.question];
  let label = '';
  for (const candidate of labelCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      label = candidate.trim();
      break;
    }
  }
  if (!label) {
    label = id;
  }

  const type = typeof entry.type === 'string' && entry.type.trim()
    ? entry.type.trim()
    : 'text';

  const options = Array.isArray(entry.options)
    ? entry.options
        .map((option) => normalizeSessionFormOption(option))
        .filter(Boolean)
    : [];

  const normalized = {
    id,
    label,
    type,
    options,
    required: Boolean(entry.required),
  };

  if (typeof entry.placeholder === 'string' && entry.placeholder.trim()) {
    normalized.placeholder = entry.placeholder.trim();
  }

  if (typeof entry.helpText === 'string' && entry.helpText.trim()) {
    normalized.helpText = entry.helpText.trim();
  }

  return normalized;
}

function normalizeSessionFormConfigValue(raw) {
  if (raw === null || raw === undefined) {
    return { error: 'invalid_session_form_config' };
  }

  let payload = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { error: 'invalid_session_form_config' };
    }
    try {
      payload = JSON.parse(trimmed);
    } catch {
      return { error: 'invalid_session_form_config' };
    }
  }

  if (Array.isArray(payload)) {
    return {
      questions: payload.map((entry, index) => normalizeSessionFormQuestion(entry, index)),
    };
  }

  if (payload && typeof payload === 'object') {
    const questionsSource = Array.isArray(payload.questions) ? payload.questions : [];
    return {
      questions: questionsSource.map((entry, index) => normalizeSessionFormQuestion(entry, index)),
    };
  }

  return { error: 'invalid_session_form_config' };
}

export { normalizeSessionFormConfigValue, normalizeSessionFormQuestion };
