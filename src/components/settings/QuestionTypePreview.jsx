import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { InfoIcon } from 'lucide-react';
import QuestionFieldPreview from '@/features/sessions/components/QuestionFieldPreview.jsx';

/**
 * QuestionTypePreview - Shows a preview of how a question type will appear in the form
 */
export default function QuestionTypePreview({ questionType }) {
  const sample = {
    type: questionType,
    label: 'שאלת דוגמה',
    required: false,
    placeholder: questionType === 'text' || questionType === 'textarea' ? 'טקסט עזר לדוגמה' : '',
    options: [
      { value: 'opt_1', label: 'אופציה 1' },
      { value: 'opt_2', label: 'אופציה 2' },
      { value: 'opt_3', label: 'אופציה 3' },
    ],
    range: { min: 1, max: 5, step: 1 },
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-full p-1 hover:bg-slate-100 transition-colors"
          title="הצג תצוגה מקדימה"
        >
          <InfoIcon className="h-4 w-4 text-slate-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-80 p-4" 
        align="start" 
        side="left"
        data-scroll-lock-ignore
        data-rs-scroll
      >
        <div className="space-y-2">
          <h4 className="font-semibold text-sm text-right">תצוגה מקדימה</h4>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <QuestionFieldPreview {...sample} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
