// Session Reports Phase 3 — default report-form template ("TutTiud parity").
//
// When an org has no published 'session_report' forms yet, the report-form
// picker (Services settings) offers a one-click "create a default report
// form" action. This module is the single source of truth for that
// template's shape, so it stays in sync with the Forms builder's schema
// contract (src/features/forms/lib/form-schema.js).
//
// The two questions mirror TutTiud's original default questionnaire:
// "session_summary" (סיכום המפגש) and "next_steps" (המשך טיפול / צעדים הבאים).
import { createEmptyFormSchema, createQuestion, createSection, normalizeFormSchema } from '@/features/forms/lib/form-schema.js';

export const DEFAULT_REPORT_FORM_NAME = 'דוח מפגש';
export const DEFAULT_REPORT_FORM_DESCRIPTION = 'טופס שממלא המדריך לתיעוד מפגש.';

/**
 * Builds a fresh, normalised sectioned form_schema for the default report
 * form. Starts from createEmptyFormSchema()/createSection()/createQuestion()
 * — the builder's own helpers — so the shape (version stamp, ids,
 * question_type, options, etc.) always matches whatever SectionedFormRenderer
 * / FormBuilderPage expect, rather than hand-rolling a schema object that
 * could drift from the real contract.
 */
export function buildDefaultReportFormSchema() {
  const summaryQuestion = {
    ...createQuestion('long_text'),
    id: 'session_summary',
    label: 'סיכום המפגש',
    description: '',
    required: true,
    placeholder: '',
  };

  const nextStepsQuestion = {
    ...createQuestion('long_text'),
    id: 'next_steps',
    label: 'המשך טיפול / צעדים הבאים',
    description: '',
    required: false,
    placeholder: '',
  };

  const section = {
    ...createSection(),
    title: 'דיווח המפגש',
    description: '',
    items: [summaryQuestion, nextStepsQuestion],
  };

  const base = createEmptyFormSchema();
  return normalizeFormSchema({
    ...base,
    sections: [section],
  });
}
