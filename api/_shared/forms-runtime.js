/* eslint-env node */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { deriveEncryptionKey, normalizeString, resolveEncryptionSecret } from './org-bff.js';

const FORM_SCHEMA_VERSION = 2;
const SIGNATURE_PURPOSE = 'form-signature-v1';
const SIGNATURE_ALGORITHM = 'aes-256-gcm';

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

function normalizeLegacyQuestion(questionId, fieldDef = {}, requiredIds = []) {
  const questionType = normalizeQuestionType(fieldDef.type, fieldDef);
  return {
    id: questionId,
    type: questionType,
    label: normalizeString(fieldDef.title) || normalizeString(fieldDef.label) || questionId,
    description: normalizeString(fieldDef.description),
    required: requiredIds.includes(questionId),
    placeholder: normalizeString(fieldDef['x-placeholder'] || fieldDef.placeholder),
    options: normalizeOptions(fieldDef.options || fieldDef.enum, questionType),
    ui: normalizeObject(fieldDef.ui, {}),
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
          return {
            id: sectionId,
            title: normalizeString(normalizedSection.title) || `סעיף ${sectionIndex + 1}`,
            description: normalizeString(normalizedSection.description),
            questions: normalizeArray(normalizedSection.questions).map((question, questionIndex) => {
              const normalizedQuestion = normalizeObject(question, {});
              const questionType = normalizeQuestionType(normalizedQuestion.type, normalizedQuestion);
              return {
                id: normalizeString(normalizedQuestion.id) || `${sectionId}_question_${questionIndex + 1}`,
                type: questionType,
                label: normalizeString(normalizedQuestion.label) || normalizeString(normalizedQuestion.title) || `שאלה ${questionIndex + 1}`,
                description: normalizeString(normalizedQuestion.description),
                required: Boolean(normalizedQuestion.required),
                placeholder: normalizeString(normalizedQuestion.placeholder),
                options: normalizeOptions(normalizedQuestion.options, questionType),
                ui: normalizeObject(normalizedQuestion.ui, {}),
              };
            }),
          };
        })
        .filter((section) => section.questions.length > 0 || section.title),
    };
  }

  const properties = normalizeObject(schema.properties, {});
  const requiredIds = normalizeArray(schema.required).map((value) => String(value));
  const order = Array.isArray(schema['x-field-order']) && schema['x-field-order'].length
    ? schema['x-field-order'].filter((key) => Object.prototype.hasOwnProperty.call(properties, key))
    : Object.keys(properties);

  const questions = order.map((questionId) => normalizeLegacyQuestion(questionId, properties[questionId], requiredIds));

  return {
    version: FORM_SCHEMA_VERSION,
    kind: 'sectioned_form',
    sections: questions.length
      ? [{
          id: 'section_1',
          title: 'שאלות כלליות',
          description: '',
          questions,
        }]
      : [],
  };
}

export function normalizeVisibilityRules(value) {
  return normalizeArray(value)
    .map((group, groupIndex) => {
      const normalizedGroup = normalizeObject(group, {});
      const targetType = normalizeString(normalizedGroup.target_type || normalizedGroup.targetType).toLowerCase();
      const targetId = normalizeString(normalizedGroup.target_id || normalizedGroup.targetId);
      if ((targetType !== 'section' && targetType !== 'question') || !targetId) return null;
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

export function getQuestionsInOrder(formSchema) {
  const schema = normalizeFormSchema(formSchema);
  return schema.sections.flatMap((section) => section.questions.map((question) => ({
    ...question,
    section_id: section.id,
    section_title: section.title,
  })));
}

export function findQuestionById(formSchema, questionId) {
  return getQuestionsInOrder(formSchema).find((question) => question.id === questionId) || null;
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
  const matchingGroups = normalizeVisibilityRules(visibilityRules).filter((group) => group.target_type === targetType && group.target_id === targetId);
  if (!matchingGroups.length) return true;

  return matchingGroups.every((group) => {
    const results = group.rules.map((rule) => matchRuleValue(answers?.[rule.source_question_id], rule.operator, rule.value));
    return group.mode === 'any' ? results.some(Boolean) : results.every(Boolean);
  });
}

export function buildVisibleFormState({ formSchema, visibilityRules, answers }) {
  const schema = normalizeFormSchema(formSchema);
  const sections = schema.sections
    .filter((section) => evaluateVisibility({ visibilityRules, answers, targetType: 'section', targetId: section.id }))
    .map((section) => ({
      ...section,
      questions: section.questions.filter((question) => evaluateVisibility({
        visibilityRules,
        answers,
        targetType: 'question',
        targetId: question.id,
      })),
    }))
    .filter((section) => section.questions.length > 0);

  return {
    ...schema,
    sections,
  };
}

export function resolvePublicFormState(formRecord, { allowDraftFallback = true } = {}) {
  const form = normalizeObject(formRecord, {});
  const metadata = normalizeObject(form.metadata, {});

  const publishedSchema = metadata.published_form_schema;
  const publishedVisibilityRules = metadata.published_visibility_rules;
  const publishedAlertRules = metadata.published_alert_rules;

  return {
    form_schema: normalizeFormSchema(
      publishedSchema && typeof publishedSchema === 'object'
        ? publishedSchema
        : allowDraftFallback
          ? form.form_schema
          : {},
    ),
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
    published_version: Number.isFinite(Number(metadata.published_version)) ? Number(metadata.published_version) : null,
  };
}

export function evaluateAlertFlags({ formSchema, alertRules, answers }) {
  const normalizedRules = normalizeAlertRules(alertRules);
  const hits = normalizedRules.flatMap((rule) => {
    const question = findQuestionById(formSchema, rule.question_id);
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

export function prepareAnswersForStorage({ formSchema, answers, env }) {
  const schema = normalizeFormSchema(formSchema);
  const nextAnswers = { ...normalizeObject(answers, {}) };

  schema.sections.forEach((section) => {
    section.questions.forEach((question) => {
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
  });

  return nextAnswers;
}

export function hydrateAnswersForReview({ formSchema, answers, env }) {
  const schema = normalizeFormSchema(formSchema);
  const nextAnswers = { ...normalizeObject(answers, {}) };

  schema.sections.forEach((section) => {
    section.questions.forEach((question) => {
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
  });

  return nextAnswers;
}
