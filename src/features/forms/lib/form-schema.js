const FORM_SCHEMA_VERSION = 2;

const DEFAULT_OPTIONS_BY_TYPE = {
  yes_no: [
    { value: true, label: 'כן' },
    { value: false, label: 'לא' },
  ],
  approval: [
    { value: true, label: 'אני מאשר/ת' },
  ],
  single_select: [
    { value: 'אפשרות 1', label: 'אפשרות 1' },
    { value: 'אפשרות 2', label: 'אפשרות 2' },
  ],
  multi_select: [
    { value: 'אפשרות 1', label: 'אפשרות 1' },
    { value: 'אפשרות 2', label: 'אפשרות 2' },
  ],
};

export const QUESTION_TYPE_DEFINITIONS = [
  { type: 'short_text', label: 'שדה טקסט' },
  { type: 'long_text', label: 'טקסט ארוך' },
  { type: 'number', label: 'מספר' },
  { type: 'date', label: 'תאריך' },
  { type: 'phone', label: 'טלפון' },
  { type: 'email', label: 'אימייל' },
  { type: 'israeli_id', label: 'מספר זהות' },
  { type: 'single_select', label: 'בחירה מרשימה' },
  { type: 'multi_select', label: 'בחירה מרובה' },
  { type: 'yes_no', label: 'שאלת כן / לא' },
  { type: 'approval', label: 'שאלת אישור' },
  { type: 'signature', label: 'חתימה' },
];

export const WAITING_LIST_BUILT_IN_QUESTIONS = [
  { id: 'wl_student_first_name', type: 'short_text', label: 'שם פרטי של התלמיד/ה' },
  { id: 'wl_student_last_name', type: 'short_text', label: 'שם משפחה של התלמיד/ה' },
  { id: 'wl_identity_number', type: 'israeli_id', label: 'מספר זהות' },
  {
    id: 'wl_contact_relationship',
    type: 'single_select',
    label: 'מי איש הקשר',
    options: [
      { value: 'self', label: 'התלמיד/ה עצמו/ה' },
      { value: 'mother', label: 'אם' },
      { value: 'father', label: 'אב' },
      { value: 'caretaker', label: 'מטפל/ת' },
      { value: 'other', label: 'אחר' },
    ],
  },
  { id: 'wl_contact_name', type: 'short_text', label: 'שם איש הקשר / האפוטרופוס' },
  { id: 'wl_phone', type: 'phone', label: 'טלפון' },
  { id: 'wl_email', type: 'email', label: 'אימייל' },
  { id: 'wl_additional_service_ids', type: 'multi_select', label: 'שירותים נוספים' },
  { id: 'wl_preferred_days', type: 'multi_select', label: 'ימים מועדפים' },
  {
    id: 'wl_payment_path_intent',
    type: 'single_select',
    label: 'מסלול מימון',
    options: [
      { value: 'unsure', label: 'לא בטוח/ה, צריך עזרה' },
      { value: 'private', label: 'תשלום פרטי' },
      { value: 'hmo', label: 'דרך קופת חולים / גורם מממן' },
    ],
  },
  { id: 'wl_hmo_provider_name', type: 'short_text', label: 'שם קופת חולים / גורם מממן' },
  {
    id: 'wl_hmo_approval_status',
    type: 'single_select',
    label: 'סטטוס אישור קופת חולים',
    options: [
      { value: 'no_approval_yet', label: 'אין אישור עדיין' },
      { value: 'send_separately', label: 'האישור יישלח בנפרד בוואטסאפ/אימייל' },
    ],
  },
  { id: 'wl_notes', type: 'long_text', label: 'הערות נוספות' },
];

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeObject(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }
  return value;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function generateBuilderId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createEmptyFormSchema() {
  return {
    version: FORM_SCHEMA_VERSION,
    kind: 'sectioned_form',
    sections: [
      {
        id: generateBuilderId('section'),
        title: 'סעיף חדש',
        description: '',
        questions: [],
      },
    ],
  };
}

export function createSection() {
  return {
    id: generateBuilderId('section'),
    title: 'סעיף חדש',
    description: '',
    questions: [],
  };
}

export function createQuestion(type = 'short_text') {
  const definition = QUESTION_TYPE_DEFINITIONS.find((item) => item.type === type);
  return {
    id: generateBuilderId('question'),
    type,
    label: definition?.label || 'שאלה חדשה',
    description: '',
    required: false,
    placeholder: '',
    options: DEFAULT_OPTIONS_BY_TYPE[type] ? DEFAULT_OPTIONS_BY_TYPE[type].map((option) => ({ ...option })) : [],
    ui: {},
  };
}

function normalizeQuestionType(type, fieldDef = {}) {
  const normalized = normalizeText(type).toLowerCase();
  if (normalized) {
    if (QUESTION_TYPE_DEFINITIONS.some((item) => item.type === normalized)) return normalized;
    if (normalized === 'string') return fieldDef['x-ui-widget'] === 'textarea' ? 'long_text' : 'short_text';
    if (normalized === 'boolean') return 'yes_no';
    if (normalized === 'integer' || normalized === 'float' || normalized === 'decimal') return 'number';
  }

  if (Array.isArray(fieldDef.enum)) return 'single_select';
  if (fieldDef.type === 'boolean') return 'yes_no';
  if (fieldDef.type === 'number' || fieldDef.type === 'integer') return 'number';
  if (normalizeText(fieldDef.format) === 'date') return 'date';
  if (normalizeText(fieldDef.format) === 'email') return 'email';
  if (fieldDef['x-ui-widget'] === 'textarea') return 'long_text';
  return 'short_text';
}

function normalizeOptions(value, questionType = '') {
  if (!Array.isArray(value)) {
    return DEFAULT_OPTIONS_BY_TYPE[questionType]
      ? DEFAULT_OPTIONS_BY_TYPE[questionType].map((option) => ({ ...option }))
      : [];
  }

  return value.map((option, index) => {
    if (option && typeof option === 'object' && !Array.isArray(option)) {
      const label = normalizeText(option.label || option.value || `אפשרות ${index + 1}`);
      const optionValue = typeof option.value === 'boolean' ? option.value : normalizeText(option.value || label);
      return { value: optionValue, label: label || String(optionValue) };
    }

    const label = normalizeText(String(option ?? '')) || `אפשרות ${index + 1}`;
    return { value: label, label };
  });
}

function legacyFieldToQuestion(key, fieldDef, requiredFields) {
  const questionType = normalizeQuestionType(fieldDef.type, fieldDef);
  return {
    id: key,
    type: questionType,
    label: normalizeText(fieldDef.title || fieldDef.label) || key,
    description: normalizeText(fieldDef.description),
    required: requiredFields.includes(key),
    placeholder: normalizeText(fieldDef['x-placeholder'] || fieldDef.placeholder),
    options: normalizeOptions(fieldDef.options || fieldDef.enum, questionType),
    ui: normalizeObject(fieldDef.ui, {}),
  };
}

export function normalizeFormSchema(schema) {
  const normalized = normalizeObject(schema, {});

  if (normalized.kind === 'sectioned_form' && Array.isArray(normalized.sections)) {
    return {
      version: FORM_SCHEMA_VERSION,
      kind: 'sectioned_form',
      sections: normalized.sections.map((section, sectionIndex) => {
        const normalizedSection = normalizeObject(section, {});
        const sectionId = normalizeText(normalizedSection.id) || `section_${sectionIndex + 1}`;
        return {
          id: sectionId,
          title: normalizeText(normalizedSection.title) || `סעיף ${sectionIndex + 1}`,
          description: normalizeText(normalizedSection.description),
          questions: normalizeArray(normalizedSection.questions).map((question, questionIndex) => {
            const normalizedQuestion = normalizeObject(question, {});
            const questionType = normalizeQuestionType(normalizedQuestion.type, normalizedQuestion);
            return {
              id: normalizeText(normalizedQuestion.id) || `${sectionId}_question_${questionIndex + 1}`,
              type: questionType,
              label: normalizeText(normalizedQuestion.label || normalizedQuestion.title) || `שאלה ${questionIndex + 1}`,
              description: normalizeText(normalizedQuestion.description),
              required: Boolean(normalizedQuestion.required),
              placeholder: normalizeText(normalizedQuestion.placeholder),
              options: normalizeOptions(normalizedQuestion.options, questionType),
              ui: normalizeObject(normalizedQuestion.ui, {}),
            };
          }),
        };
      }),
    };
  }

  const properties = normalizeObject(normalized.properties, {});
  const requiredFields = normalizeArray(normalized.required).map((value) => String(value));
  const order = Array.isArray(normalized['x-field-order']) && normalized['x-field-order'].length
    ? normalized['x-field-order'].filter((key) => Object.prototype.hasOwnProperty.call(properties, key))
    : Object.keys(properties);

  return {
    version: FORM_SCHEMA_VERSION,
    kind: 'sectioned_form',
    sections: [{
      id: 'section_1',
      title: 'שאלות כלליות',
      description: '',
      questions: order.map((key) => legacyFieldToQuestion(key, properties[key], requiredFields)),
    }],
  };
}

export function normalizeVisibilityRules(rules) {
  return normalizeArray(rules).map((group, groupIndex) => {
    const normalizedGroup = normalizeObject(group, {});
    const targetType = normalizeText(normalizedGroup.target_type || normalizedGroup.targetType).toLowerCase();
    const targetId = normalizeText(normalizedGroup.target_id || normalizedGroup.targetId);
    if (!targetId || (targetType !== 'section' && targetType !== 'question')) return null;
    const mode = normalizeText(normalizedGroup.mode).toLowerCase() === 'any' ? 'any' : 'all';
    const normalizedRules = normalizeArray(normalizedGroup.rules).map((rule, ruleIndex) => {
      const normalizedRule = normalizeObject(rule, {});
      const sourceQuestionId = normalizeText(normalizedRule.source_question_id || normalizedRule.sourceQuestionId);
      const operator = normalizeText(normalizedRule.operator).toLowerCase();
      if (!sourceQuestionId || !operator) return null;
      return {
        id: normalizeText(normalizedRule.id) || `rule_${groupIndex + 1}_${ruleIndex + 1}`,
        source_question_id: sourceQuestionId,
        operator,
        value: normalizedRule.value,
      };
    }).filter(Boolean);

    return {
      id: normalizeText(normalizedGroup.id) || `group_${groupIndex + 1}`,
      target_type: targetType,
      target_id: targetId,
      mode,
      rules: normalizedRules,
    };
  }).filter((group) => group && group.rules.length > 0);
}

export function normalizeAlertRules(rules) {
  return normalizeArray(rules).map((rule, index) => {
    const normalizedRule = normalizeObject(rule, {});
    const questionId = normalizeText(normalizedRule.question_id || normalizedRule.questionId);
    if (!questionId) return null;
    const severity = ['low', 'medium', 'high'].includes(normalizeText(normalizedRule.severity).toLowerCase())
      ? normalizeText(normalizedRule.severity).toLowerCase()
      : 'medium';
    return {
      id: normalizeText(normalizedRule.id) || `alert_${index + 1}`,
      question_id: questionId,
      value: normalizedRule.value,
      severity,
      note: normalizeText(normalizedRule.note),
    };
  }).filter(Boolean);
}

export function getQuestionsInOrder(schema) {
  const normalized = normalizeFormSchema(schema);
  return normalized.sections.flatMap((section) => section.questions.map((question) => ({
    ...question,
    section_id: section.id,
    section_title: section.title,
  })));
}

export function getWaitingListBuiltInQuestions() {
  return WAITING_LIST_BUILT_IN_QUESTIONS.map((question) => ({
    ...question,
    options: Array.isArray(question.options) ? question.options.map((option) => ({ ...option })) : [],
  }));
}

export function getAvailableSourceQuestions(schema, targetType, targetId, { formUsage = 'general' } = {}) {
  const normalized = normalizeFormSchema(schema);
  const available = formUsage === 'waiting_list_intake' ? getWaitingListBuiltInQuestions() : [];

  for (const section of normalized.sections) {
    if (targetType === 'section' && section.id === targetId) {
      break;
    }

    for (const question of section.questions) {
      if (targetType === 'question' && question.id === targetId) {
        return available;
      }
      available.push(question);
    }
  }

  return available;
}

function evaluateRule(rule, answers) {
  const answerValue = answers?.[rule.source_question_id];
  switch (rule.operator) {
    case 'equals':
      return answerValue === rule.value;
    case 'not_equals':
      return answerValue !== rule.value;
    case 'includes':
      return Array.isArray(answerValue) ? answerValue.includes(rule.value) : false;
    case 'not_includes':
      return Array.isArray(answerValue) ? !answerValue.includes(rule.value) : true;
    case 'is_true':
      return answerValue === true;
    case 'is_false':
      return answerValue === false;
    case 'is_empty':
      return answerValue === undefined || answerValue === null || answerValue === '' || (Array.isArray(answerValue) && answerValue.length === 0);
    case 'is_not_empty':
      return !(answerValue === undefined || answerValue === null || answerValue === '' || (Array.isArray(answerValue) && answerValue.length === 0));
    default:
      return true;
  }
}

export function isTargetVisible(visibilityRules, answers, targetType, targetId) {
  const groups = normalizeVisibilityRules(visibilityRules).filter((group) => group.target_type === targetType && group.target_id === targetId);
  if (!groups.length) return true;
  return groups.every((group) => {
    const results = group.rules.map((rule) => evaluateRule(rule, answers));
    return group.mode === 'any' ? results.some(Boolean) : results.every(Boolean);
  });
}

export function getVisibleSections(schema, visibilityRules, answers) {
  const normalized = normalizeFormSchema(schema);
  return normalized.sections
    .filter((section) => isTargetVisible(visibilityRules, answers, 'section', section.id))
    .map((section) => ({
      ...section,
      questions: section.questions.filter((question) => isTargetVisible(visibilityRules, answers, 'question', question.id)),
    }))
    .filter((section) => section.questions.length > 0);
}

export function findQuestionLabel(schema, questionId) {
  return getQuestionsInOrder(schema).find((question) => question.id === questionId)?.label || questionId;
}

export function buildInitialAnswers(schema) {
  const answers = {};
  getQuestionsInOrder(schema).forEach((question) => {
    if (question.type === 'multi_select') answers[question.id] = [];
    if (question.type === 'approval') answers[question.id] = false;
  });
  return answers;
}
