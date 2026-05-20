const FORM_SCHEMA_VERSION = 3;

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

export const FORM_ITEM_TYPES = {
  LOCAL_QUESTION: 'local_question',
  SHARED_QUESTION: 'shared_question',
  LOCAL_TEXT: 'local_text',
  SHARED_TEXT: 'shared_text',
};

export const SHARED_BLOCK_TYPES = {
  QUESTION: 'question',
  TEXT: 'text',
};

export const TEXT_BLOCK_VARIANTS = [
  { value: 'info', label: 'מידע' },
  { value: 'warning', label: 'הדגשה' },
  { value: 'success', label: 'אישור' },
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
  { id: 'wl_contact_name', type: 'short_text', label: 'שם פרטי איש הקשר / האפוטרופוס' },
  { id: 'wl_contact_last_name', type: 'short_text', label: 'שם משפחה איש הקשר / האפוטרופוס' },
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

function normalizeSharedBlockType(value, fallback = SHARED_BLOCK_TYPES.QUESTION) {
  return value === SHARED_BLOCK_TYPES.TEXT ? SHARED_BLOCK_TYPES.TEXT : fallback;
}

export function generateBuilderId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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

function normalizeTextVariant(value) {
  const normalized = normalizeText(value).toLowerCase();
  return TEXT_BLOCK_VARIANTS.some((item) => item.value === normalized) ? normalized : 'info';
}

function normalizeSharedBlockReference(value, blockType) {
  const normalized = normalizeObject(value, {});
  return {
    id: normalizeText(normalized.id),
    block_type: normalizeSharedBlockType(normalized.block_type || normalized.blockType, blockType),
    name: normalizeText(normalized.name),
    content_schema: normalizeObject(normalized.content_schema || normalized.contentSchema, {}),
    is_active: normalized.is_active !== false,
    metadata: normalizeObject(normalized.metadata, {}),
  };
}

export function normalizeSharedBlockContent(blockType, contentSchema) {
  const normalized = normalizeObject(contentSchema, {});

  if (normalizeSharedBlockType(blockType) === SHARED_BLOCK_TYPES.TEXT) {
    return {
      title: normalizeText(normalized.title),
      content: normalizeText(normalized.content || normalized.body),
      variant: normalizeTextVariant(normalized.variant),
      metadata: normalizeObject(normalized.metadata, {}),
    };
  }

  const questionType = normalizeQuestionType(normalized.question_type || normalized.questionType || normalized.type, normalized);
  return {
    question_type: questionType,
    label: normalizeText(normalized.label || normalized.title) || 'שאלה משותפת',
    description: normalizeText(normalized.description),
    required: Boolean(normalized.required),
    placeholder: normalizeText(normalized.placeholder),
    options: normalizeOptions(normalized.options, questionType),
    ui: normalizeObject(normalized.ui, {}),
    metadata: normalizeObject(normalized.metadata, {}),
  };
}

function normalizeBaseItemId(value, prefix = 'item') {
  return normalizeText(value) || generateBuilderId(prefix);
}

function normalizeTextItem(item, { type = FORM_ITEM_TYPES.LOCAL_TEXT, fallbackIdPrefix = 'text_item' } = {}) {
  const normalized = normalizeObject(item, {});
  return {
    id: normalizeBaseItemId(normalized.id, fallbackIdPrefix),
    type,
    title: normalizeText(normalized.title),
    content: normalizeText(normalized.content || normalized.body),
    variant: normalizeTextVariant(normalized.variant),
    metadata: normalizeObject(normalized.metadata, {}),
  };
}

function normalizeQuestionItem(item, { type = FORM_ITEM_TYPES.LOCAL_QUESTION, fallbackIdPrefix = 'question_item' } = {}) {
  const normalized = normalizeObject(item, {});
  const questionType = normalizeQuestionType(normalized.question_type || normalized.questionType || normalized.type, normalized);
  return {
    id: normalizeBaseItemId(normalized.id, fallbackIdPrefix),
    type,
    question_type: questionType,
    label: normalizeText(normalized.label || normalized.title) || 'שאלה חדשה',
    description: normalizeText(normalized.description),
    required: Boolean(normalized.required),
    placeholder: normalizeText(normalized.placeholder),
    options: normalizeOptions(normalized.options, questionType),
    ui: normalizeObject(normalized.ui, {}),
    metadata: normalizeObject(normalized.metadata, {}),
  };
}

function normalizeLegacyQuestion(key, fieldDef, requiredFields) {
  return normalizeQuestionItem({
    id: key,
    type: FORM_ITEM_TYPES.LOCAL_QUESTION,
    question_type: normalizeQuestionType(fieldDef.type, fieldDef),
    label: normalizeText(fieldDef.title || fieldDef.label) || key,
    description: normalizeText(fieldDef.description),
    required: requiredFields.includes(key),
    placeholder: normalizeText(fieldDef['x-placeholder'] || fieldDef.placeholder),
    options: normalizeOptions(fieldDef.options || fieldDef.enum, normalizeQuestionType(fieldDef.type, fieldDef)),
    ui: normalizeObject(fieldDef.ui, {}),
  }, { type: FORM_ITEM_TYPES.LOCAL_QUESTION, fallbackIdPrefix: 'question_item' });
}

function normalizeSharedPlacement(item, { blockType, fallbackIdPrefix }) {
  const normalized = normalizeObject(item, {});
  return {
    id: normalizeBaseItemId(normalized.id, fallbackIdPrefix),
    type: blockType === SHARED_BLOCK_TYPES.TEXT ? FORM_ITEM_TYPES.SHARED_TEXT : FORM_ITEM_TYPES.SHARED_QUESTION,
    shared_block_id: normalizeText(normalized.shared_block_id || normalized.sharedBlockId),
    shared_block: normalized.shared_block ? normalizeSharedBlockReference(normalized.shared_block, blockType) : null,
    metadata: normalizeObject(normalized.metadata, {}),
  };
}

function buildMissingSharedPlaceholder(item, sharedBlockId, blockType) {
  if (blockType === SHARED_BLOCK_TYPES.TEXT) {
    return {
      ...normalizeTextItem({
        id: item.id,
        title: item?.shared_block?.name || 'טקסט משותף לא זמין',
        content: '',
        variant: 'warning',
        metadata: normalizeObject(item.metadata, {}),
      }, { type: FORM_ITEM_TYPES.SHARED_TEXT, fallbackIdPrefix: 'shared_text_item' }),
      shared_block_id: sharedBlockId,
      shared_block: item?.shared_block || null,
      missing_shared_block: true,
      unavailable_shared_item: true,
    };
  }

  return {
    ...normalizeQuestionItem({
      id: item.id,
      question_type: 'short_text',
      label: item?.shared_block?.name || 'שאלה משותפת לא זמינה',
      description: '',
      required: false,
      placeholder: '',
      options: [],
      metadata: normalizeObject(item.metadata, {}),
    }, { type: FORM_ITEM_TYPES.SHARED_QUESTION, fallbackIdPrefix: 'shared_question_item' }),
    shared_block_id: sharedBlockId,
    shared_block: item?.shared_block || null,
    missing_shared_block: true,
    unavailable_shared_item: true,
  };
}

function normalizeSectionItems(section) {
  const rawItems = Array.isArray(section.items)
    ? section.items
    : Array.isArray(section.questions)
      ? section.questions.map((question) => ({ ...question, type: FORM_ITEM_TYPES.LOCAL_QUESTION }))
      : [];

  return rawItems
    .map((item, itemIndex) => {
      const normalized = normalizeObject(item, {});
      const itemType = normalizeText(normalized.type).toLowerCase();
      if (itemType === FORM_ITEM_TYPES.LOCAL_TEXT) {
        return normalizeTextItem(normalized, { type: FORM_ITEM_TYPES.LOCAL_TEXT, fallbackIdPrefix: `text_item_${itemIndex + 1}` });
      }
      if (itemType === FORM_ITEM_TYPES.SHARED_TEXT) {
        return normalizeSharedPlacement(normalized, { blockType: SHARED_BLOCK_TYPES.TEXT, fallbackIdPrefix: `shared_text_item_${itemIndex + 1}` });
      }
      if (itemType === FORM_ITEM_TYPES.SHARED_QUESTION) {
        return normalizeSharedPlacement(normalized, { blockType: SHARED_BLOCK_TYPES.QUESTION, fallbackIdPrefix: `shared_question_item_${itemIndex + 1}` });
      }
      return normalizeQuestionItem(normalized, { type: FORM_ITEM_TYPES.LOCAL_QUESTION, fallbackIdPrefix: `question_item_${itemIndex + 1}` });
    })
    .filter(Boolean);
}

function attachCompatibilityQuestions(section) {
  return {
    ...section,
    questions: section.items.filter((item) => isQuestionItem(item)).map((item) => ({
      ...item,
      id: item.id,
      type: item.question_type,
      label: item.label,
      description: item.description,
      required: item.required,
      placeholder: item.placeholder,
      options: normalizeOptions(item.options, item.question_type),
      ui: normalizeObject(item.ui, {}),
    })),
  };
}

export function createEmptyFormSchema() {
  return {
    version: FORM_SCHEMA_VERSION,
    kind: 'sectioned_form',
    sections: [attachCompatibilityQuestions(createSection())],
  };
}

export function createSection() {
  return {
    id: generateBuilderId('section'),
    title: 'סעיף חדש',
    description: '',
    items: [],
  };
}

export function createQuestion(type = 'short_text') {
  const definition = QUESTION_TYPE_DEFINITIONS.find((item) => item.type === type);
  return normalizeQuestionItem({
    id: generateBuilderId('question'),
    type: FORM_ITEM_TYPES.LOCAL_QUESTION,
    question_type: type,
    label: definition?.label || 'שאלה חדשה',
    description: '',
    required: false,
    placeholder: '',
    options: DEFAULT_OPTIONS_BY_TYPE[type] ? DEFAULT_OPTIONS_BY_TYPE[type].map((option) => ({ ...option })) : [],
    ui: {},
  }, { type: FORM_ITEM_TYPES.LOCAL_QUESTION, fallbackIdPrefix: 'question' });
}

export function createTextBlock() {
  return normalizeTextItem({
    id: generateBuilderId('text'),
    type: FORM_ITEM_TYPES.LOCAL_TEXT,
    title: 'כותרת טקסט',
    content: 'הוסיפו כאן טקסט מידע ללקוח/ה.',
    variant: 'info',
  }, { type: FORM_ITEM_TYPES.LOCAL_TEXT, fallbackIdPrefix: 'text' });
}

export function createSharedPlacement(block, blockType) {
  return normalizeSharedPlacement({
    id: generateBuilderId(blockType === SHARED_BLOCK_TYPES.TEXT ? 'shared_text' : 'shared_question'),
    type: blockType === SHARED_BLOCK_TYPES.TEXT ? FORM_ITEM_TYPES.SHARED_TEXT : FORM_ITEM_TYPES.SHARED_QUESTION,
    shared_block_id: block?.id,
    shared_block: block,
  }, {
    blockType,
    fallbackIdPrefix: blockType === SHARED_BLOCK_TYPES.TEXT ? 'shared_text' : 'shared_question',
  });
}

export function isQuestionItem(item) {
  if (!item || typeof item !== 'object') return false;
  return item.type === FORM_ITEM_TYPES.LOCAL_QUESTION || item.type === FORM_ITEM_TYPES.SHARED_QUESTION;
}

export function isTextItem(item) {
  if (!item || typeof item !== 'object') return false;
  return item.type === FORM_ITEM_TYPES.LOCAL_TEXT || item.type === FORM_ITEM_TYPES.SHARED_TEXT;
}

export function isSharedItem(item) {
  if (!item || typeof item !== 'object') return false;
  return item.type === FORM_ITEM_TYPES.SHARED_QUESTION || item.type === FORM_ITEM_TYPES.SHARED_TEXT;
}

export function collectSharedBlockIds(schema) {
  const normalized = normalizeFormSchema(schema);
  return Array.from(new Set(
    normalized.sections.flatMap((section) =>
      section.items
        .filter((item) => isSharedItem(item))
        .map((item) => normalizeText(item.shared_block_id || item.shared_block?.id))
        .filter(Boolean),
    ),
  ));
}

export function validateNormalizedFormSchemaIntegrity({ formSchema, visibilityRules = [], alertRules = [] } = {}) {
  const normalized = normalizeFormSchema(formSchema);
  const issues = [];
  const sectionIds = new Set();
  const itemIds = new Set();
  const questionIds = new Set();

  normalized.sections.forEach((section, sectionIndex) => {
    const sectionId = normalizeText(section?.id);
    if (!sectionId) {
      issues.push(`missing_section_id:${sectionIndex + 1}`);
    } else if (sectionIds.has(sectionId)) {
      issues.push(`duplicate_section_id:${sectionId}`);
    } else {
      sectionIds.add(sectionId);
    }

    normalizeArray(section?.items).forEach((item, itemIndex) => {
      const itemId = normalizeText(item?.id);
      if (!itemId) {
        issues.push(`missing_item_id:${sectionId || sectionIndex + 1}:${itemIndex + 1}`);
      } else if (itemIds.has(itemId)) {
        issues.push(`duplicate_item_id:${itemId}`);
      } else {
        itemIds.add(itemId);
      }

      if (isQuestionItem(item) && itemId) {
        questionIds.add(itemId);
      }

      if (isSharedItem(item) && !normalizeText(item?.shared_block_id || item?.shared_block?.id)) {
        issues.push(`missing_shared_block_id:${itemId || `${sectionId || sectionIndex + 1}:${itemIndex + 1}`}`);
      }
    });
  });

  normalizeVisibilityRules(visibilityRules).forEach((group) => {
    if (group.target_type === 'section' && !sectionIds.has(group.target_id)) {
      issues.push(`invalid_visibility_target_section:${group.target_id}`);
    }
    if (group.target_type === 'item' && !itemIds.has(group.target_id)) {
      issues.push(`invalid_visibility_target_item:${group.target_id}`);
    }
    normalizeArray(group.rules).forEach((rule) => {
      if (!questionIds.has(rule.source_question_id)) {
        issues.push(`invalid_visibility_source_question:${rule.source_question_id}`);
      }
    });
  });

  normalizeAlertRules(alertRules).forEach((rule) => {
    if (!questionIds.has(rule.question_id)) {
      issues.push(`invalid_alert_question:${rule.question_id}`);
    }
  });

  return Array.from(new Set(issues));
}

export function buildSharedBlockMap(blocks) {
  const map = {};
  normalizeArray(blocks).forEach((block) => {
    const normalized = normalizeObject(block, {});
    const id = normalizeText(normalized.id);
    if (!id) return;
    const blockType = normalizeSharedBlockType(normalized.block_type || normalized.blockType);
    map[id] = {
      id,
      block_type: blockType,
      name: normalizeText(normalized.name),
      content_schema: normalizeSharedBlockContent(blockType, normalized.content_schema || normalized.contentSchema),
      is_active: normalized.is_active !== false,
      metadata: normalizeObject(normalized.metadata, {}),
    };
  });
  return map;
}

function resolveSharedItem(item, sharedBlockMap = {}) {
  if (!isSharedItem(item)) return item;
  const sharedBlockId = normalizeText(item.shared_block_id || item.shared_block?.id);
  const sharedBlock = sharedBlockMap[sharedBlockId] || item.shared_block || null;
  if (!sharedBlock || !sharedBlock.id) {
    return buildMissingSharedPlaceholder(item, sharedBlockId, item?.type === FORM_ITEM_TYPES.SHARED_TEXT ? SHARED_BLOCK_TYPES.TEXT : SHARED_BLOCK_TYPES.QUESTION);
  }

  const content = normalizeSharedBlockContent(sharedBlock.block_type, sharedBlock.content_schema);
  if (sharedBlock.block_type === SHARED_BLOCK_TYPES.TEXT) {
    return {
      ...normalizeTextItem({
        ...content,
        id: item.id,
        type: item.type,
        metadata: { ...content.metadata, ...normalizeObject(item.metadata, {}) },
      }, { type: FORM_ITEM_TYPES.SHARED_TEXT, fallbackIdPrefix: 'shared_text' }),
      shared_block_id: sharedBlock.id,
      shared_block: sharedBlock,
      resolved_from_shared: true,
    };
  }

  return {
    ...normalizeQuestionItem({
      ...content,
      id: item.id,
      type: item.type,
      metadata: { ...content.metadata, ...normalizeObject(item.metadata, {}) },
    }, { type: FORM_ITEM_TYPES.SHARED_QUESTION, fallbackIdPrefix: 'shared_question' }),
    shared_block_id: sharedBlock.id,
    shared_block: sharedBlock,
    resolved_from_shared: true,
  };
}

export function resolveSchemaWithSharedBlocks(schema, sharedBlockMap = {}) {
  const normalized = normalizeFormSchema(schema);
  return {
    ...normalized,
    sections: normalized.sections.map((section) => attachCompatibilityQuestions({
      ...section,
      items: section.items.map((item) => resolveSharedItem(item, sharedBlockMap)),
    })),
  };
}

export function normalizeFormSchema(schema) {
  const normalized = normalizeObject(schema, {});

  if (normalized.kind === 'sectioned_form' && Array.isArray(normalized.sections)) {
    const sections = normalized.sections.map((section, sectionIndex) => {
      const normalizedSection = normalizeObject(section, {});
      const sectionId = normalizeText(normalizedSection.id) || `section_${sectionIndex + 1}`;
      return attachCompatibilityQuestions({
        id: sectionId,
        title: normalizeText(normalizedSection.title) || `סעיף ${sectionIndex + 1}`,
        description: normalizeText(normalizedSection.description),
        items: normalizeSectionItems(normalizedSection),
      });
    });
    return {
      version: FORM_SCHEMA_VERSION,
      kind: 'sectioned_form',
      sections: sections.length ? sections : [attachCompatibilityQuestions(createSection())],
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
    sections: [attachCompatibilityQuestions({
      id: 'section_1',
      title: 'שאלות כלליות',
      description: '',
      items: order.map((key) => normalizeLegacyQuestion(key, properties[key], requiredFields)),
    })],
  };
}

function isIsraeliIdValid(value) {
  return /^\d{5,12}$/.test(String(value || '').trim());
}

export function normalizeVisibilityRules(rules) {
  return normalizeArray(rules).map((group, groupIndex) => {
    const normalizedGroup = normalizeObject(group, {});
    const rawTargetType = normalizeText(normalizedGroup.target_type || normalizedGroup.targetType).toLowerCase();
    const targetType = rawTargetType === 'question' ? 'item' : rawTargetType;
    const targetId = normalizeText(normalizedGroup.target_id || normalizedGroup.targetId);
    if (!targetId || (targetType !== 'section' && targetType !== 'item')) return null;
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

export function getItemsInOrder(schema, sharedBlockMap = {}) {
  const normalized = resolveSchemaWithSharedBlocks(schema, sharedBlockMap);
  return normalized.sections.flatMap((section) => section.items.map((item) => ({
    ...item,
    section_id: section.id,
    section_title: section.title,
  })));
}

export function getQuestionsInOrder(schema, sharedBlockMap = {}) {
  return getItemsInOrder(schema, sharedBlockMap)
    .filter((item) => isQuestionItem(item))
    .map((item) => ({
      ...item,
      id: item.id,
      type: item.question_type,
      label: item.label,
      description: item.description,
      required: item.required,
      placeholder: item.placeholder,
      options: normalizeOptions(item.options, item.question_type),
      ui: normalizeObject(item.ui, {}),
    }));
}

export function getWaitingListBuiltInQuestions() {
  return WAITING_LIST_BUILT_IN_QUESTIONS.map((question) => ({
    ...question,
    options: Array.isArray(question.options) ? question.options.map((option) => ({ ...option })) : [],
  }));
}

export function getAvailableSourceQuestions(schema, targetType, targetId, { formUsage = 'general', sharedBlockMap = {} } = {}) {
  const normalized = resolveSchemaWithSharedBlocks(schema, sharedBlockMap);
  const available = formUsage === 'waiting_list_intake' ? getWaitingListBuiltInQuestions() : [];

  for (const section of normalized.sections) {
    if (targetType === 'section' && section.id === targetId) {
      break;
    }

    for (const item of section.items) {
      if (targetType === 'item' && item.id === targetId) {
        return available;
      }
      if (isQuestionItem(item)) {
        available.push({
          ...item,
          id: item.id,
          type: item.question_type,
          label: item.label,
          description: item.description,
          required: item.required,
          placeholder: item.placeholder,
          options: normalizeOptions(item.options, item.question_type),
          ui: normalizeObject(item.ui, {}),
        });
      }
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
  const normalizedTargetType = targetType === 'question' ? 'item' : targetType;
  const groups = normalizeVisibilityRules(visibilityRules).filter((group) => group.target_type === normalizedTargetType && group.target_id === targetId);
  if (!groups.length) return true;
  return groups.every((group) => {
    const results = group.rules.map((rule) => evaluateRule(rule, answers));
    return group.mode === 'any' ? results.some(Boolean) : results.every(Boolean);
  });
}

export function getVisibleSections(schema, visibilityRules, answers, sharedBlockMap = {}) {
  const normalized = resolveSchemaWithSharedBlocks(schema, sharedBlockMap);
  return normalized.sections
    .filter((section) => isTargetVisible(visibilityRules, answers, 'section', section.id))
    .map((section) => attachCompatibilityQuestions({
      ...section,
      items: section.items.filter((item) => isTargetVisible(visibilityRules, answers, 'item', item.id)),
    }))
    .filter((section) => section.items.length > 0);
}

export function findItemById(schema, itemId, sharedBlockMap = {}) {
  return getItemsInOrder(schema, sharedBlockMap).find((item) => item.id === itemId) || null;
}

// Find item from raw schema without normalizing (important for form editing to preserve trailing spaces)
export function findItemByIdRaw(schema, itemId) {
  for (const section of schema.sections || []) {
    for (const item of section.items || []) {
      if (item.id === itemId) return item;
    }
  }
  return null;
}

export function findQuestionLabel(schema, questionId, sharedBlockMap = {}) {
  return getQuestionsInOrder(schema, sharedBlockMap).find((question) => question.id === questionId)?.label || questionId;
}

export function buildInitialAnswers(schema, sharedBlockMap = {}) {
  const answers = {};
  getQuestionsInOrder(schema, sharedBlockMap).forEach((question) => {
    if (question.type === 'multi_select') answers[question.id] = [];
    if (question.type === 'approval') answers[question.id] = false;
  });
  return answers;
}

export function validateVisibleAnswers(visibleSections, answers) {
  const errors = {};

  visibleSections.forEach((section) => {
    section.items.filter((item) => isQuestionItem(item)).forEach((question) => {
      const value = answers?.[question.id];
      const questionType = question.question_type || question.type;

      if (question.required) {
        if (questionType === 'multi_select' && (!Array.isArray(value) || value.length === 0)) {
          errors[question.id] = 'יש לבחור לפחות אפשרות אחת.';
          return;
        }
        if (questionType === 'approval' && value !== true) {
          errors[question.id] = 'יש לאשר כדי להמשיך.';
          return;
        }
        if (questionType === 'signature' && (!value?.strokes || !value.strokes.length) && (!value?.preview_strokes || !value.preview_strokes.length)) {
          errors[question.id] = 'יש לחתום לפני שליחת הטופס.';
          return;
        }
        if ((value === undefined || value === null || value === '') && questionType !== 'approval') {
          errors[question.id] = 'שדה חובה.';
          return;
        }
      }

      if (questionType === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
        errors[question.id] = 'יש להזין כתובת אימייל תקינה.';
      }
      if (questionType === 'israeli_id' && value && !isIsraeliIdValid(value)) {
        errors[question.id] = 'יש להזין מספר זהות תקין.';
      }
    });
  });

  return errors;
}
