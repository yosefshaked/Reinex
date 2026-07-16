import React, { useMemo, useState } from 'react';
import { Loader2, ListPlus, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SectionedFormRenderer from '@/features/forms/components/SectionedFormRenderer.jsx';
import { getQuestionsInOrder, getVisibleSections, validateVisibleAnswers } from '@/features/forms/lib/form-schema.js';
import ErrorMessageText from '@/components/ui/ErrorMessageText.jsx';
import PreanswersPickerDialog from './PreanswersPickerDialog.jsx';

const PREANSWERABLE_TYPES = new Set(['short_text', 'long_text']);

/**
 * Session Reports Phase 3/4 — the report fill body.
 *
 * Renders the resolved report form (Services.report_form_id -> forms) via
 * the shared Forms renderer, anchored to a single lesson_participant_id.
 * There is no student/date/service picker here anymore — the anchor and its
 * display context (student name, service, lesson time) are resolved by the
 * parent modal via GET /api/session-reports?mode=context and passed in as
 * props. No "loose report" / unassigned-student fields (Decision #4 in the
 * implementation plan).
 *
 * Phase 4 adds a "תשובות מוכנות" (preconfigured answers) affordance per
 * text/textarea field, sourced from the service-universal bank first and the
 * caller's personal bank second (see PreanswersPickerDialog), plus a
 * one-click "copy from my last report for this student/service" prefill.
 */
export default function NewSessionForm({
  formSchema,
  visibilityRules = [],
  answers,
  onAnswersChange,
  onSubmit,
  onCancel,
  isSubmitting = false,
  error = '',
  validationErrors = {},
  renderFooterOutside = false,
  servicePreanswers = null,
  personalPreanswers = {},
  preanswersCap,
  canEditPersonalPreanswers = false,
  onSavePersonalPreanswer,
  hasLastReportAnswers = false,
  onCopyFromLastReport,
}) {
  const [pickerFieldKey, setPickerFieldKey] = useState('');

  const visibleSections = useMemo(
    () => (formSchema ? getVisibleSections(formSchema, visibilityRules, answers) : []),
    [formSchema, visibilityRules, answers],
  );

  const preanswerableQuestions = useMemo(() => {
    if (!formSchema || !servicePreanswers) return [];
    return getQuestionsInOrder(formSchema).filter((question) => PREANSWERABLE_TYPES.has(question.type));
  }, [formSchema, servicePreanswers]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!formSchema) return;
    const validationErrors = validateVisibleAnswers(visibleSections, answers);
    if (Object.keys(validationErrors).length > 0) {
      onSubmit?.({ answers, validationErrors });
      return;
    }
    onSubmit?.({ answers, validationErrors: {} });
  };

  if (!formSchema) {
    return (
      <div className="py-6 text-sm text-neutral-500 text-end">
        לא נמצא טופס דיווח פעיל עבור השירות הזה.
      </div>
    );
  }

  const activeQuestion = preanswerableQuestions.find((question) => question.id === pickerFieldKey) || null;
  const activeServiceAnswers = activeQuestion ? (servicePreanswers?.[activeQuestion.id] || []) : [];
  const activePersonalAnswers = activeQuestion ? (personalPreanswers?.[activeQuestion.id] || []) : [];

  return (
    <form id="new-session-report-form" className="space-y-lg" onSubmit={handleSubmit}>
      {hasLastReportAnswers ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-xs"
            onClick={onCopyFromLastReport}
            disabled={isSubmitting}
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
            העתק מהדיווח האחרון
          </Button>
        </div>
      ) : null}

      {preanswerableQuestions.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-xs">
          {preanswerableQuestions.map((question) => (
            <Button
              key={question.id}
              type="button"
              variant="ghost"
              size="sm"
              className="gap-xs text-xs text-neutral-600"
              onClick={() => setPickerFieldKey(question.id)}
              disabled={isSubmitting}
            >
              <ListPlus className="h-3.5 w-3.5" aria-hidden="true" />
              תשובה מוכנה: {question.label}
            </Button>
          ))}
        </div>
      ) : null}

      <SectionedFormRenderer
        schema={formSchema}
        visibilityRules={visibilityRules}
        answers={answers}
        onAnswersChange={onAnswersChange}
        readOnly={isSubmitting}
        validationErrors={validationErrors}
      />

      {error ? (
        <div className="rounded-lg bg-red-50 p-md text-sm text-red-700 text-end" role="alert">
          <ErrorMessageText error={error} supportClassName="text-red-700" />
        </div>
      ) : null}

      {!renderFooterOutside && (
        <div className="border-t -mx-4 sm:-mx-6 mt-6 pt-3 sm:pt-4 px-4 sm:px-6">
          <div className="flex flex-col-reverse gap-sm sm:flex-row-reverse sm:justify-end">
            <Button type="submit" disabled={isSubmitting} className="gap-xs shadow-md hover:shadow-lg transition-shadow">
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              שמירת דיווח
            </Button>
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting} className="hover:shadow-sm">
              ביטול
            </Button>
          </div>
        </div>
      )}

      <PreanswersPickerDialog
        open={Boolean(activeQuestion)}
        onClose={() => setPickerFieldKey('')}
        answers={activeServiceAnswers}
        personalAnswers={activePersonalAnswers}
        questionLabel={activeQuestion?.label || ''}
        preanswersCapLimit={preanswersCap}
        canEditPersonal={canEditPersonalPreanswers}
        onSelect={(value) => {
          if (!activeQuestion) return;
          const current = answers?.[activeQuestion.id];
          const nextValue = current ? `${current}\n${value}` : value;
          onAnswersChange?.({ ...answers, [activeQuestion.id]: nextValue });
        }}
        onSavePersonal={(nextList) => onSavePersonalPreanswer?.(activeQuestion.id, nextList)}
      />
    </form>
  );
}

export function NewSessionFormFooter({ onSubmit, onCancel, isSubmitting = false }) {
  return (
    <div className="flex flex-col-reverse gap-sm sm:flex-row-reverse sm:justify-end">
      <Button type="button" disabled={isSubmitting} className="gap-xs shadow-md hover:shadow-lg transition-shadow" onClick={onSubmit}>
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        שמירת דיווח
      </Button>
      <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting} className="hover:shadow-sm">
        ביטול
      </Button>
    </div>
  );
}
