/* eslint-env node */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { deriveEncryptionKey, normalizeString, resolveEncryptionSecret } from './org-bff.js';

const FORM_SCHEMA_VERSION = 3;
const SIGNATURE_PURPOSE = 'form-signature-v1';
const SIGNATURE_ALGORITHM = 'aes-256-gcm';

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

function normalizeObject(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }
  return value;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeQuestionType(type, fieldDef = {}) {
  const normalized = normalizeString(type).toLowerCase();
  if (normalized) {
    return normalized;
  }

  if (Array.isArray(fieldDef.enum)) return 'single_select';
  if (fieldDef.type === 'boolean') return 'yes_no';
  if (fieldDef.type === 'number' || fieldDef.type === 'integer') return 'number';
  if (fieldDef.type === 'string' && normalizeString(fieldDef.format) === 'email') return 'email';
  if (fieldDef.type === 'string' && normalizeString(fieldDef.format) === 'date') return 'date';
  if (fieldDef['x-ui-widget'] === 'textarea') return 'long_text';
  return 'short_text';
}

function normalizeOptionValue(value, index = 0) {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeString(String(value ?? ''));
  return normalized || `option_${index + 1}`;
}

function normalizeOptions(value, questionType = '') {
  if (!Array.isArray(value)) {
    if (questionType === 'yes_no') {
      return [
        { value: true, label: 'כן' },
        { value: false, label: 'לא' },
      ];
    }
    if (questionType === 'approval') {
      return [
        { value: true, label: 'אני מאשר/ת' },
      ];
    }
    return [];
  }

  return value
    .map((option, index) => {
      if (option && typeof option === 'object' && !Array.isArray(option)) {
        const label = normalizeString(option.label || option.value || `אפשרות ${index + 1}`);
        const optionValue = typeof option.value === 'boolean' ? option.value : normalizeOptionValue(option.value ?? label, index);
        return {
          value: optionValue,
          label: label || String(optionValue),
        };
      }

      const optionValue = normalizeOptionValue(option, index);
      return {
        value: optionValue,
        label: String(optionValue),
      };
    })
    .filter((option) => option.label);
}

function normalizeTextVariant(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'warning' || normalized === 'success') return normalized;
  return 'info';
}

function normalizeSharedBlockType(value, fallback = SHARED_BLOCK_TYPES.QUESTION) {
  return value === SHARED_BLOCK_TYPES.TEXT ? SHARED_BLOCK_TYPES.TEXT : fallback;
}

function normalizeLegacyQuestion(questionId, fieldDef = {}, requiredIds = []) {
  const questionType = normalizeQuestionType(fieldDef.type, fieldDef);
  return normalizeQuestionItem({
    id: questionId,
    type: FORM_ITEM_TYPES.LOCAL_QUESTION,
    question_type: questionType,
    label: normalizeString(fieldDef.title) || normalizeString(fieldDef.label) || questionId,
    description: normalizeString(fieldDef.description),
    required: requiredIds.includes(questionId),
    placeholder: normalizeString(fieldDef['x-placeholder'] || fieldDef.placeholder),
    options: normalizeOptions(fieldDef.options || fieldDef.enum, questionType),
    ui: normalizeObject(fieldDef.ui, {}),
  });
}

function normalizeQuestionItem(item = {}, { type = FORM_ITEM_TYPES.LOCAL_QUESTION } = {}) {
  const normalized = normalizeObject(item, {});
  const questionType = normalizeQuestionType(normalized.question_type || normalized.questionType || normalized.type, normalized);
  return {
    id: normalizeString(normalized.id),
    type,
    question_type: questionType,
    label: normalizeString(normalized.label || normalized.title) || 'שאלה',
    description: normalizeString(normalized.description),
    required: Boolean(normalized.required),
    placeholder: normalizeString(normalized.placeholder),
    options: normalizeOptions(normalized.options, questionType),
    ui: normalizeObject(normalized.ui, {}),
    metadata: normalizeObject(normalized.metadata, {}),
  };
}

function normalizeTextItem(item = {}, { type = FORM_ITEM_TYPES.LOCAL_TEXT } = {}) {
  const normalized = normalizeObject(item, {});
  return {
    id: normalizeString(normalized.id),
    type,
    title: normalizeString(normalized.title),
    content: normalizeString(normalized.content || normalized.body),
    variant: normalizeTextVariant(normalized.variant),
    metadata: normalizeObject(normalized.metadata, {}),
  };
}

function normalizeSharedPlacement(item = {}, { blockType }) {
  const normalized = normalizeObject(item, {});
  return {
    id: normalizeString(normalized.id),
    type: blockType === SHARED_BLOCK_TYPES.TEXT ? FORM_ITEM_TYPES.SHARED_TEXT : FORM_ITEM_TYPES.SHARED_QUESTION,
    shared_block_id: normalizeString(normalized.shared_block_id || normalized.sharedBlockId),
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
      }, { type: FORM_ITEM_TYPES.SHARED_TEXT }),
      shared_block_id: sharedBlockId,
      missing_shared_block: true,
      unavailable_shared_item: true,
      shared_block: item?.shared_block || null,
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
    }, { type: FORM_ITEM_TYPES.SHARED_QUESTION }),
    shared_block_id: sharedBlockId,
    missing_shared_block: true,
    unavailable_shared_item: true,
    shared_block: item?.shared_block || null,
  };
}

function normalizeSectionItems(section) {
  const rawItems = Array.isArray(section.items)
    ? section.items
    : Array.isArray(section.questions)
      ? section.questions.map((question) => ({ ...question, type: FORM_ITEM_TYPES.LOCAL_QUESTION }))
      : [];

  return rawItems
    .map((item) => {
      const normalized = normalizeObject(item, {});
      const itemType = normalizeString(normalized.type).toLowerCase();
      if (itemType === FORM_ITEM_TYPES.LOCAL_TEXT) {
        return normalizeTextItem(normalized, { type: FORM_ITEM_TYPES.LOCAL_TEXT });
      }
      if (itemType === FORM_ITEM_TYPES.SHARED_TEXT) {
        return normalizeSharedPlacement(normalized, { blockType: SHARED_BLOCK_TYPES.TEXT });
      }
      if (itemType === FORM_ITEM_TYPES.SHARED_QUESTION) {
        return normalizeSharedPlacement(normalized, { blockType: SHARED_BLOCK_TYPES.QUESTION });
      }
      return normalizeQuestionItem(normalized, { type: FORM_ITEM_TYPES.LOCAL_QUESTION });
    })
    .filter(Boolean);
}

function attachCompatibilityQuestions(section) {
  return {
    ...section,
    questions: section.items
      .filter((item) => isQuestionItem(item))
      .map((item) => ({
        ...item,
        type: item.question_type,
        options: normalizeOptions(item.options, item.question_type),
      })),
  };
}

export function normalizeFormSchema(formSchema) {
  const schema = normalizeObject(formSchema, {});

  if (schema.kind === 'sectioned_form' && Array.isArray(schema.sections)) {
    return {
      version: FORM_SCHEMA_VERSION,
      kind: 'sectioned_form',
      sections: schema.sections
        .map((section, sectionIndex) => {
          const normalizedSection = normalizeObject(section, {});
          const sectionId = normalizeString(normalizedSection.id) || `section_${sectionIndex + 1}`;
          return attachCompatibilityQuestions({
            id: sectionId,
            title: normalizeString(normalizedSection.title) || `סעיף ${sectionIndex + 1}`,
            description: normalizeString(normalizedSection.description),
            items: normalizeSectionItems(normalizedSection),
          });
        })
        .filter((section) => section.items.length > 0 || section.title),
    };
  }

  const properties = normalizeObject(schema.properties, {});
  const requiredIds = normalizeArray(schema.required).map((value) => String(value));
  const order = Array.isArray(schema['x-field-order']) && schema['x-field-order'].length
    ? schema['x-field-order'].filter((key) => Object.prototype.hasOwnProperty.call(properties, key))
    : Object.keys(properties);

  const items = order.map((questionId) => normalizeLegacyQuestion(questionId, properties[questionId], requiredIds));

  return {
    version: FORM_SCHEMA_VERSION,
    kind: 'sectioned_form',
    sections: items.length
      ? [attachCompatibilityQuestions({
          id: 'section_1',
          title: 'שאלות כלליות',
          description: '',
          items,
        })]
      : [],
  };
}

export function normalizeSharedBlockContent(blockType, contentSchema) {
  const normalized = normalizeObject(contentSchema, {});
  if (normalizeSharedBlockType(blockType) === SHARED_BLOCK_TYPES.TEXT) {
    return {
      title: normalizeString(normalized.title),
      content: normalizeString(normalized.content || normalized.body),
      variant: normalizeTextVariant(normalized.variant),
      metadata: normalizeObject(normalized.metadata, {}),
    };
  }

  const questionType = normalizeQuestionType(normalized.question_type || normalized.questionType || normalized.type, normalized);
  return {
    question_type: questionType,
    label: normalizeString(normalized.label || normalized.title) || 'שאלה משותפת',
    description: normalizeString(normalized.description),
    required: Boolean(normalized.required),
    placeholder: normalizeString(normalized.placeholder),
    options: normalizeOptions(normalized.options, questionType),
    ui: normalizeObject(normalized.ui, {}),
    metadata: normalizeObject(normalized.metadata, {}),
  };
}

function normalizeSharedBlockReference(block = {}, fallbackType = SHARED_BLOCK_TYPES.QUESTION) {
  const normalized = normalizeObject(block, {});
  const blockType = normalizeSharedBlockType(normalized.block_type || normalized.blockType, fallbackType);
  return {
    id: normalizeString(normalized.id),
    block_type: blockType,
    name: normalizeString(normalized.name),
    content_schema: normalizeSharedBlockContent(blockType, normalized.content_schema || normalized.contentSchema),
    is_active: normalized.is_active !== false,
    metadata: normalizeObject(normalized.metadata, {}),
  };
}

export function buildSharedBlockMap(rows) {
  const map = {};
  normalizeArray(rows).forEach((row) => {
    const normalized = normalizeSharedBlockReference(row, row?.block_type || row?.blockType);
    if (!normalized.id) return;
    map[normalized.id] = normalized;
  });
  return map;
}

export function collectSharedBlockIds(formSchema) {
  const schema = normalizeFormSchema(formSchema);
  return Array.from(new Set(
    schema.sections.flatMap((section) => section.items
      .filter((item) => isSharedItem(item))
      .map((item) => normalizeString(item.shared_block_id || item.shared_block?.id))
      .filter(Boolean)),
  ));
}

export function isQuestionItem(item) {
  return item?.type === FORM_ITEM_TYPES.LOCAL_QUESTION || item?.type === FORM_ITEM_TYPES.SHARED_QUESTION;
}

export function isSharedItem(item) {
  return item?.type === FORM_ITEM_TYPES.SHARED_QUESTION || item?.type === FORM_ITEM_TYPES.SHARED_TEXT;
}

export function validateNormalizedFormSchemaIntegrity({ formSchema, visibilityRules = [], alertRules = [] } = {}) {
  const schema = normalizeFormSchema(formSchema);
  const issues = [];
  const sectionIds = new Set();
  const itemIds = new Set();
  const questionIds = new Set();

  schema.sections.forEach((section, sectionIndex) => {
    const sectionId = normalizeString(section?.id);
    if (!sectionId) {
      issues.push(`missing_section_id:${sectionIndex + 1}`);
    } else if (sectionIds.has(sectionId)) {
      issues.push(`duplicate_section_id:${sectionId}`);
    } else {
      sectionIds.add(sectionId);
    }

    normalizeArray(section?.items).forEach((item, itemIndex) => {
      const itemId = normalizeString(item?.id);
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

      if (isSharedItem(item) && !normalizeString(item?.shared_block_id || item?.shared_block?.id)) {
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

export function findMissingSharedBlockIds(formSchema, sharedBlocksById = {}) {
  return collectSharedBlockIds(formSchema).filter((id) => !sharedBlocksById[id]);
}

function resolveSharedItem(item, sharedBlocksById = {}) {
  if (!isSharedItem(item)) return item;

  const sharedBlockId = normalizeString(item.shared_block_id || item.shared_block?.id);
  const sharedBlock = sharedBlocksById[sharedBlockId] || item.shared_block || null;
  if (!sharedBlock || !sharedBlock.id) {
    return buildMissingSharedPlaceholder(item, sharedBlockId, item?.type === FORM_ITEM_TYPES.SHARED_TEXT ? SHARED_BLOCK_TYPES.TEXT : SHARED_BLOCK_TYPES.QUESTION);
  }

  const content = normalizeSharedBlockContent(sharedBlock.block_type, sharedBlock.content_schema);
  if (sharedBlock.block_type === SHARED_BLOCK_TYPES.TEXT) {
    return {
      ...normalizeTextItem({
        ...content,
        id: item.id,
        metadata: { ...content.metadata, ...normalizeObject(item.metadata, {}) },
      }, { type: FORM_ITEM_TYPES.SHARED_TEXT }),
      shared_block_id: sharedBlock.id,
      shared_block: sharedBlock,
      resolved_from_shared: true,
    };
  }

  return {
    ...normalizeQuestionItem({
      ...content,
      id: item.id,
      metadata: { ...content.metadata, ...normalizeObject(item.metadata, {}) },
    }, { type: FORM_ITEM_TYPES.SHARED_QUESTION }),
    shared_block_id: sharedBlock.id,
    shared_block: sharedBlock,
    resolved_from_shared: true,
  };
}

export function resolveSchemaWithSharedBlocks(formSchema, sharedBlocksById = {}) {
  const schema = normalizeFormSchema(formSchema);
  return {
    ...schema,
    sections: schema.sections.map((section) => attachCompatibilityQuestions({
      ...section,
      items: section.items.map((item) => resolveSharedItem(item, sharedBlocksById)),
    })),
  };
}

export function materializeSchemaForSnapshot(formSchema) {
  const schema = resolveSchemaWithSharedBlocks(formSchema, {});
  return {
    ...schema,
    sections: schema.sections.map((section) => attachCompatibilityQuestions({
      ...section,
      items: section.items.map((item) => {
        if (item.type === FORM_ITEM_TYPES.SHARED_QUESTION) {
          return normalizeQuestionItem({
            ...item,
            type: FORM_ITEM_TYPES.LOCAL_QUESTION,
            question_type: item.question_type,
          }, { type: FORM_ITEM_TYPES.LOCAL_QUESTION });
        }
        if (item.type === FORM_ITEM_TYPES.SHARED_TEXT) {
          return normalizeTextItem({
            ...item,
            type: FORM_ITEM_TYPES.LOCAL_TEXT,
          }, { type: FORM_ITEM_TYPES.LOCAL_TEXT });
        }
        return item;
      }),
    })),
  };
}

export function normalizeVisibilityRules(value) {
  return normalizeArray(value)
    .map((group, groupIndex) => {
      const normalizedGroup = normalizeObject(group, {});
      const targetTypeRaw = normalizeString(normalizedGroup.target_type || normalizedGroup.targetType).toLowerCase();
      const targetType = targetTypeRaw === 'question' ? 'item' : targetTypeRaw;
      const targetId = normalizeString(normalizedGroup.target_id || normalizedGroup.targetId);
      if ((targetType !== 'section' && targetType !== 'item') || !targetId) return null;
      const mode = normalizeString(normalizedGroup.mode).toLowerCase() === 'any' ? 'any' : 'all';
      const rules = normalizeArray(normalizedGroup.rules)
        .map((rule, ruleIndex) => {
          const normalizedRule = normalizeObject(rule, {});
          const sourceQuestionId = normalizeString(normalizedRule.source_question_id || normalizedRule.sourceQuestionId);
          const operator = normalizeString(normalizedRule.operator).toLowerCase();
          if (!sourceQuestionId || !operator) return null;
          return {
            id: normalizeString(normalizedRule.id) || `rule_${groupIndex + 1}_${ruleIndex + 1}`,
            source_question_id: sourceQuestionId,
            operator,
            value: normalizedRule.value,
          };
        })
        .filter(Boolean);

      return {
        id: normalizeString(normalizedGroup.id) || `group_${groupIndex + 1}`,
        target_type: targetType,
        target_id: targetId,
        mode,
        rules,
      };
    })
    .filter((group) => group && group.rules.length > 0);
}

export function normalizeAlertRules(value) {
  return normalizeArray(value)
    .map((rule, index) => {
      const normalizedRule = normalizeObject(rule, {});
      const questionId = normalizeString(normalizedRule.question_id || normalizedRule.questionId);
      if (!questionId) return null;
      const severity = (() => {
        const normalized = normalizeString(normalizedRule.severity).toLowerCase();
        if (normalized === 'high' || normalized === 'medium' || normalized === 'low') return normalized;
        return 'medium';
      })();

      return {
        id: normalizeString(normalizedRule.id) || `alert_${index + 1}`,
        question_id: questionId,
        value: normalizedRule.value,
        severity,
        note: normalizeString(normalizedRule.note),
      };
    })
    .filter(Boolean);
}

export function getItemsInOrder(formSchema, sharedBlocksById = {}) {
  const schema = resolveSchemaWithSharedBlocks(formSchema, sharedBlocksById);
  return schema.sections.flatMap((section) => section.items.map((item) => ({
    ...item,
    section_id: section.id,
    section_title: section.title,
  })));
}

export function getQuestionsInOrder(formSchema, sharedBlocksById = {}) {
  return getItemsInOrder(formSchema, sharedBlocksById)
    .filter((item) => isQuestionItem(item))
    .map((item) => ({
      ...item,
      type: item.question_type,
      options: normalizeOptions(item.options, item.question_type),
    }));
}

export function findQuestionById(formSchema, questionId, sharedBlocksById = {}) {
  return getQuestionsInOrder(formSchema, sharedBlocksById).find((question) => question.id === questionId) || null;
}

function matchRuleValue(sourceValue, operator, expectedValue) {
  switch (operator) {
    case 'equals':
      return sourceValue === expectedValue;
    case 'not_equals':
      return sourceValue !== expectedValue;
    case 'includes':
      return Array.isArray(sourceValue) ? sourceValue.includes(expectedValue) : false;
    case 'not_includes':
      return Array.isArray(sourceValue) ? !sourceValue.includes(expectedValue) : true;
    case 'is_true':
      return sourceValue === true;
    case 'is_false':
      return sourceValue === false;
    case 'is_empty':
      return sourceValue === undefined || sourceValue === null || sourceValue === '' || (Array.isArray(sourceValue) && sourceValue.length === 0);
    case 'is_not_empty':
      return !(sourceValue === undefined || sourceValue === null || sourceValue === '' || (Array.isArray(sourceValue) && sourceValue.length === 0));
    default:
      return true;
  }
}

export function evaluateVisibility({ visibilityRules, answers, targetType, targetId }) {
  const normalizedTargetType = targetType === 'question' ? 'item' : targetType;
  const matchingGroups = normalizeVisibilityRules(visibilityRules).filter((group) => group.target_type === normalizedTargetType && group.target_id === targetId);
  if (!matchingGroups.length) return true;

  return matchingGroups.every((group) => {
    const results = group.rules.map((rule) => matchRuleValue(answers?.[rule.source_question_id], rule.operator, rule.value));
    return group.mode === 'any' ? results.some(Boolean) : results.every(Boolean);
  });
}

export function buildVisibleFormState({ formSchema, visibilityRules, answers, sharedBlocksById = {} }) {
  const schema = resolveSchemaWithSharedBlocks(formSchema, sharedBlocksById);
  const sections = schema.sections
    .filter((section) => evaluateVisibility({ visibilityRules, answers, targetType: 'section', targetId: section.id }))
    .map((section) => attachCompatibilityQuestions({
      ...section,
      items: section.items.filter((item) => evaluateVisibility({
        visibilityRules,
        answers,
        targetType: 'item',
        targetId: item.id,
      })),
    }))
    .filter((section) => section.items.length > 0);

  return {
    ...schema,
    sections,
  };
}

export function resolvePublicFormState(formRecord, { allowDraftFallback = true, sharedBlocksById = {} } = {}) {
  const form = normalizeObject(formRecord, {});
  const metadata = normalizeObject(form.metadata, {});

  const publishedSchema = metadata.published_form_schema;
  const publishedVisibilityRules = metadata.published_visibility_rules;
  const publishedAlertRules = metadata.published_alert_rules;
  const hasPublishedContent = Boolean(publishedSchema && typeof publishedSchema === 'object');

  const rawSchema = normalizeFormSchema(
    hasPublishedContent
      ? publishedSchema
      : allowDraftFallback
        ? form.form_schema
        : {},
  );

  return {
    raw_form_schema: rawSchema,
    form_schema: resolveSchemaWithSharedBlocks(rawSchema, sharedBlocksById),
    visibility_rules: normalizeVisibilityRules(
      publishedVisibilityRules && Array.isArray(publishedVisibilityRules)
        ? publishedVisibilityRules
        : allowDraftFallback
          ? form.visibility_rules
          : [],
    ),
    alert_rules: normalizeAlertRules(
      publishedAlertRules && Array.isArray(publishedAlertRules)
        ? publishedAlertRules
        : allowDraftFallback
          ? form.alert_rules
          : [],
    ),
    is_published: hasPublishedContent,
    published_version: Number.isFinite(Number(metadata.published_version)) ? Number(metadata.published_version) : null,
  };
}

export function evaluateAlertFlags({ formSchema, alertRules, answers, sharedBlocksById = {} }) {
  const normalizedRules = normalizeAlertRules(alertRules);
  const hits = normalizedRules.flatMap((rule) => {
    const question = findQuestionById(formSchema, rule.question_id, sharedBlocksById);
    const answerValue = answers?.[rule.question_id];
    let matched = false;

    if (Array.isArray(answerValue)) {
      matched = answerValue.includes(rule.value);
    } else {
      matched = answerValue === rule.value;
    }

    if (!matched) return [];

    return [{
      question_id: rule.question_id,
      question_label: question?.label || rule.question_id,
      answer_value: rule.value,
      severity: rule.severity,
      note: rule.note || '',
    }];
  });

  const severityRank = { low: 1, medium: 2, high: 3 };
  const highest = hits.reduce((max, hit) => (severityRank[hit.severity] > severityRank[max] ? hit.severity : max), 'low');

  return {
    has_red_flags: hits.length > 0,
    highest_severity: hits.length > 0 ? highest : null,
    hits,
  };
}

function deriveSignatureEncryptionKey(env) {
  const secret = resolveEncryptionSecret(env);
  const baseKey = deriveEncryptionKey(secret);
  if (!baseKey) {
    throw new Error('signature_encryption_not_configured');
  }

  return createHash('sha256')
    .update(baseKey)
    .update(SIGNATURE_PURPOSE)
    .digest();
}

function encryptSignaturePayload(payload, env) {
  const key = deriveSignatureEncryptionKey(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv(SIGNATURE_ALGORITHM, key, iv);
  const plain = JSON.stringify(payload);
  const cipherText = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    'v1',
    'gcm',
    iv.toString('base64'),
    authTag.toString('base64'),
    cipherText.toString('base64'),
  ].join(':');
}

function decryptSignaturePayload(payload, env) {
  const segments = String(payload || '').split(':');
  if (segments.length !== 5 || segments[0] !== 'v1' || segments[1] !== 'gcm') {
    throw new Error('invalid_signature_payload');
  }
  const key = deriveSignatureEncryptionKey(env);
  const [, , ivBase64, authTagBase64, cipherTextBase64] = segments;
  const decipher = createDecipheriv(SIGNATURE_ALGORITHM, key, Buffer.from(ivBase64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagBase64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherTextBase64, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8'));
}

export function prepareAnswersForStorage({ formSchema, answers, env, sharedBlocksById = {} }) {
  const questions = getQuestionsInOrder(formSchema, sharedBlocksById);
  const nextAnswers = { ...normalizeObject(answers, {}) };

  questions.forEach((question) => {
    if (question.type !== 'signature') return;
    const answer = normalizeObject(nextAnswers[question.id], null);
    if (!answer || answer.encrypted_payload) return;
    const strokes = normalizeArray(answer.strokes);
    if (!strokes.length) return;

    const signedAt = normalizeString(answer.signed_at) || new Date().toISOString();
    nextAnswers[question.id] = {
      _type: 'signature',
      format: 'stroke_json',
      signed_at: signedAt,
      encrypted_payload: encryptSignaturePayload({
        strokes,
        signed_at: signedAt,
        question_id: question.id,
      }, env),
    };
  });

  return nextAnswers;
}

export function hydrateAnswersForReview({ formSchema, answers, env, sharedBlocksById = {} }) {
  const questions = getQuestionsInOrder(formSchema, sharedBlocksById);
  const nextAnswers = { ...normalizeObject(answers, {}) };

  questions.forEach((question) => {
    if (question.type !== 'signature') return;
    const answer = normalizeObject(nextAnswers[question.id], null);
    if (!answer?.encrypted_payload) return;

    try {
      const decrypted = decryptSignaturePayload(answer.encrypted_payload, env);
      nextAnswers[question.id] = {
        _type: 'signature',
        format: 'stroke_json',
        signed_at: answer.signed_at || decrypted.signed_at || null,
        preview_strokes: normalizeArray(decrypted.strokes),
      };
    } catch {
      nextAnswers[question.id] = {
        _type: 'signature',
        format: 'stroke_json',
        signed_at: answer.signed_at || null,
        preview_strokes: [],
        preview_error: true,
      };
    }
  });

  return nextAnswers;
}
