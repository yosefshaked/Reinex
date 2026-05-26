import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSessionFormConfigValue, normalizeSessionFormQuestion } from '../api/_shared/settings-utils.js';

describe('normalizeSessionFormConfigValue — invalid inputs', () => {
  it('null returns error object', () => {
    const result = normalizeSessionFormConfigValue(null);
    assert.equal(result.error, 'invalid_session_form_config');
  });

  it('undefined returns error object', () => {
    const result = normalizeSessionFormConfigValue(undefined);
    assert.equal(result.error, 'invalid_session_form_config');
  });

  it('number returns error object', () => {
    const result = normalizeSessionFormConfigValue(42);
    assert.equal(result.error, 'invalid_session_form_config');
  });

  it('boolean returns error object', () => {
    const result = normalizeSessionFormConfigValue(true);
    assert.equal(result.error, 'invalid_session_form_config');
  });

  it('empty string returns error object', () => {
    const result = normalizeSessionFormConfigValue('');
    assert.equal(result.error, 'invalid_session_form_config');
  });

  it('whitespace-only string returns error object', () => {
    const result = normalizeSessionFormConfigValue('   ');
    assert.equal(result.error, 'invalid_session_form_config');
  });

  it('invalid JSON string returns error object', () => {
    const result = normalizeSessionFormConfigValue('{not json}');
    assert.equal(result.error, 'invalid_session_form_config');
  });
});

describe('normalizeSessionFormConfigValue — string input', () => {
  it('parses valid JSON array string', () => {
    const raw = JSON.stringify([{ id: 'q1', label: 'Q1', type: 'text' }]);
    const result = normalizeSessionFormConfigValue(raw);
    assert.ok(!result.error);
    assert.equal(result.questions.length, 1);
    assert.equal(result.questions[0].id, 'q1');
  });

  it('parses valid JSON object string with questions array', () => {
    const raw = JSON.stringify({ questions: [{ id: 'q1', label: 'Q1', type: 'text' }] });
    const result = normalizeSessionFormConfigValue(raw);
    assert.ok(!result.error);
    assert.equal(result.questions.length, 1);
  });

  it('parses JSON string with leading/trailing whitespace', () => {
    const raw = '  [{"id":"q1","label":"Q1","type":"text"}]  ';
    const result = normalizeSessionFormConfigValue(raw);
    assert.ok(!result.error);
    assert.equal(result.questions.length, 1);
  });
});

describe('normalizeSessionFormConfigValue — object input', () => {
  it('preserves option objects when provided', () => {
    const raw = {
      questions: [
        {
          id: 'q1',
          label: 'Question 1',
          type: 'select',
          required: true,
          options: [
            { id: 'opt-1', value: 'value_1', label: 'Label 1' },
            { id: 'opt-2', value: 'value_2', label: 'Label 2' },
          ],
        },
      ],
    };

    const result = normalizeSessionFormConfigValue(raw);
    assert.ok(!result.error);
    assert.equal(result.questions.length, 1);
    assert.equal(result.questions[0].options.length, 2);
    assert.deepEqual(result.questions[0].options, [
      { id: 'opt-1', value: 'value_1', label: 'Label 1' },
      { id: 'opt-2', value: 'value_2', label: 'Label 2' },
    ]);
    assert.equal(result.questions[0].required, true);
  });

  it('object without questions key yields empty questions array', () => {
    const result = normalizeSessionFormConfigValue({ other: 'stuff' });
    assert.ok(!result.error);
    assert.deepEqual(result.questions, []);
  });

  it('object with non-array questions key yields empty questions array', () => {
    const result = normalizeSessionFormConfigValue({ questions: 'not-an-array' });
    assert.ok(!result.error);
    assert.deepEqual(result.questions, []);
  });
});

describe('normalizeSessionFormConfigValue — array input', () => {
  it('normalizes primitive options into objects, filters null', () => {
    const raw = [
      {
        id: 'q2',
        label: 'Question 2',
        type: 'radio',
        options: [' First ', 2, null, { label: 'Third', value: 'third' }],
      },
    ];

    const result = normalizeSessionFormConfigValue(raw);
    assert.ok(!result.error);
    const [question] = result.questions;
    assert.equal(question.id, 'q2');
    assert.deepEqual(question.options, [
      { value: 'First', label: 'First' },
      { value: '2', label: '2' },
      { value: 'third', label: 'Third' },
    ]);
  });

  it('empty array yields empty questions array', () => {
    const result = normalizeSessionFormConfigValue([]);
    assert.ok(!result.error);
    assert.deepEqual(result.questions, []);
  });
});

describe('normalizeSessionFormQuestion — question normalization', () => {
  it('uses fallback id when question has no id', () => {
    const result = normalizeSessionFormQuestion({ label: 'No ID Question', type: 'text' }, 2);
    assert.equal(result.id, 'question_3');
  });

  it('uses fallback label equal to id when label is missing', () => {
    const result = normalizeSessionFormQuestion({ id: 'my-id' }, 0);
    assert.equal(result.label, 'my-id');
  });

  it('defaults type to text when type is missing', () => {
    const result = normalizeSessionFormQuestion({ id: 'q', label: 'Q' }, 0);
    assert.equal(result.type, 'text');
  });

  it('required defaults to false when not set', () => {
    const result = normalizeSessionFormQuestion({ id: 'q', label: 'Q' }, 0);
    assert.equal(result.required, false);
  });

  it('filters empty-string options', () => {
    const result = normalizeSessionFormQuestion(
      { id: 'q', label: 'Q', options: ['', '  ', 'valid'] },
      0,
    );
    assert.equal(result.options.length, 1);
    assert.equal(result.options[0].value, 'valid');
  });

  it('preserves placeholder when set', () => {
    const result = normalizeSessionFormQuestion(
      { id: 'q', label: 'Q', placeholder: '  Enter text  ' },
      0,
    );
    assert.equal(result.placeholder, 'Enter text');
  });

  it('omits placeholder when not set', () => {
    const result = normalizeSessionFormQuestion({ id: 'q', label: 'Q' }, 0);
    assert.equal('placeholder' in result, false);
  });

  it('preserves helpText when set', () => {
    const result = normalizeSessionFormQuestion(
      { id: 'q', label: 'Q', helpText: ' Some help ' },
      0,
    );
    assert.equal(result.helpText, 'Some help');
  });

  it('handles a completely non-object entry with safe fallbacks', () => {
    const result = normalizeSessionFormQuestion(null, 4);
    assert.equal(result.id, 'question_5');
    assert.equal(result.type, 'text');
    assert.equal(result.required, false);
    assert.deepEqual(result.options, []);
  });
});
