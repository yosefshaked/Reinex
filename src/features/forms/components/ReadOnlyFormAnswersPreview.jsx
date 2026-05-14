import React, { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import SectionedFormRenderer from '@/features/forms/components/SectionedFormRenderer.jsx';
import {
  getVisibleSections,
  isQuestionItem,
  normalizeFormSchema,
  normalizeVisibilityRules,
} from '@/features/forms/lib/form-schema.js';

function hasAnswer(value) {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    if (value._type === 'signature') {
      return Boolean(
        (Array.isArray(value.preview_strokes) && value.preview_strokes.length > 0)
        || (Array.isArray(value.strokes) && value.strokes.length > 0)
      );
    }
    return Object.keys(value).length > 0;
  }
  return true;
}

function getAlertHits(alertFlags) {
  return Array.isArray(alertFlags?.hits) ? alertFlags.hits : [];
}

export default function ReadOnlyFormAnswersPreview({
  schema,
  visibilityRules = [],
  answers = {},
  alertFlags = {},
  className = '',
  emptyMessage = 'לא מולאו תשובות נוספות בטופס.',
}) {
  const normalizedSchema = useMemo(() => normalizeFormSchema(schema || {}), [schema]);
  const normalizedVisibilityRules = useMemo(() => normalizeVisibilityRules(visibilityRules), [visibilityRules]);
  const alertHits = getAlertHits(alertFlags);

  const answeredSchema = useMemo(() => {
    const visibleSections = getVisibleSections(normalizedSchema, normalizedVisibilityRules, answers, {});
    return {
      ...normalizedSchema,
      sections: visibleSections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => isQuestionItem(item) && hasAnswer(answers?.[item.id])),
        }))
        .filter((section) => section.items.length > 0),
    };
  }, [answers, normalizedSchema, normalizedVisibilityRules]);

  if (!answeredSchema.sections.length) {
    return (
      <div className={cn('rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground', className)}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {alertHits.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-900">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            דגלים שזוהו בטופס
          </div>
          <div className="space-y-2">
            {alertHits.map((hit, index) => (
              <div key={`${hit?.question_id || 'alert'}-${index}`} className="rounded-xl border border-amber-200 bg-white p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{String(hit?.severity || 'medium')}</Badge>
                  <span className="font-medium text-foreground">{String(hit?.question_label || hit?.question_id || 'שאלה')}</span>
                </div>
                {hit?.note ? <p className="mt-1 text-xs text-muted-foreground">{hit.note}</p> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <SectionedFormRenderer
        schema={answeredSchema}
        visibilityRules={[]}
        answers={answers}
        evaluationAnswers={answers}
        onAnswersChange={() => {}}
        readOnly
        className="space-y-3"
      />
    </div>
  );
}
