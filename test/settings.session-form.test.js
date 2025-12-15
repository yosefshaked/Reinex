import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSessionFormConfigValue } from '../api/_shared/settings-utils.js';

describe('session form normalization', () => {
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

  it('normalizes primitive options into objects', () => {
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
});
