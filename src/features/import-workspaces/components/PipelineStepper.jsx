import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

const STEPS = [
  { id: 'upload',  label: 'העלאה' },
  { id: 'map',     label: 'מיפוי' },
  { id: 'ingest',  label: 'קליטה' },
  { id: 'analyze', label: 'ניתוח' },
  { id: 'review',  label: 'סקירה' },
  { id: 'commit',  label: 'ביצוע' },
];

/**
 * @param {{ currentStep: string, completedSteps: string[], onStepClick?: (id:string)=>void }} props
 */
export function PipelineStepper({ currentStep, completedSteps = [], onStepClick }) {
  return (
    <nav aria-label="שלבי ייבוא" className="w-full">
      <ol className="flex items-center justify-between gap-0 overflow-x-auto">
        {STEPS.map((step, idx) => {
          const isDone    = completedSteps.includes(step.id);
          const isCurrent = currentStep === step.id;
          const isLast    = idx === STEPS.length - 1;

          return (
            <li key={step.id} className="flex items-center flex-1 min-w-0">
              {/* Step circle + label */}
              <button
                type="button"
                onClick={() => isDone && onStepClick?.(step.id)}
                disabled={!isDone && !isCurrent}
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1',
                  (isDone || isCurrent) ? 'cursor-pointer' : 'cursor-default opacity-50',
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-medium transition-colors',
                    isDone    && 'border-primary bg-primary text-primary-foreground',
                    isCurrent && !isDone && 'border-primary bg-background text-primary',
                    !isDone   && !isCurrent && 'border-muted bg-muted text-muted-foreground',
                  )}
                >
                  {isDone ? <Check className="h-4 w-4" aria-hidden /> : idx + 1}
                </span>
                <span
                  className={cn(
                    'text-xs font-medium whitespace-nowrap',
                    isCurrent ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
              </button>

              {/* Connector line between steps */}
              {!isLast && (
                <div
                  className={cn(
                    'h-0.5 flex-1 mx-1 mt-[-1rem]',
                    isDone ? 'bg-primary' : 'bg-muted',
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
