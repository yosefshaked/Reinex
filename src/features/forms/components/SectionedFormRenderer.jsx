import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getVisibleSections, isQuestionItem } from '@/features/forms/lib/form-schema.js';

function RequiredLabel({ htmlFor, children, required = false }) {
  return (
    <Label htmlFor={htmlFor} className="text-sm font-medium text-slate-800">
      {children}
      {required ? <span className="ms-1 text-red-500">*</span> : null}
    </Label>
  );
}

function getInputClass(hasError) {
  return cn(
    'h-11 rounded-xl border bg-white px-3 text-sm shadow-sm transition-colors',
    hasError ? 'border-red-300 focus-visible:ring-red-300' : 'border-slate-200 focus-visible:ring-primary/30',
  );
}

function normalizePoints(points) {
  return Array.isArray(points)
    ? points
        .map((point) => ({
          x: Number(point?.x),
          y: Number(point?.y),
        }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    : [];
}

function SignatureCanvas({ id, value, onChange, required, readOnly = false, error = '' }) {
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const [drawing, setDrawing] = useState(false);

  const strokes = useMemo(() => {
    if (value?.preview_strokes) return value.preview_strokes;
    return Array.isArray(value?.strokes) ? value.strokes : [];
  }, [value]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#0f172a';
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    strokes.forEach((stroke) => {
      const points = normalizePoints(stroke);
      if (!points.length) return;
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => {
        context.lineTo(point.x, point.y);
      });
      context.stroke();
    });
  }, [strokes]);

  const readPoint = (event) => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return null;
    const rect = canvas.getBoundingClientRect();
    const clientX = event.touches?.[0]?.clientX ?? event.clientX;
    const clientY = event.touches?.[0]?.clientY ?? event.clientY;
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const beginStroke = (event) => {
    if (readOnly) return;
    const point = readPoint(event);
    if (!point) return;
    setDrawing(true);
    onChange?.({
      _type: 'signature',
      format: 'stroke_json',
      signed_at: new Date().toISOString(),
      strokes: [...(Array.isArray(value?.strokes) ? value.strokes : []), [point]],
    });
  };

  const extendStroke = (event) => {
    if (readOnly || !drawing) return;
    const point = readPoint(event);
    if (!point) return;
    onChange?.((previousValue) => {
      const previous = typeof previousValue === 'function' ? previousValue(value) : previousValue;
      const current = previous && typeof previous === 'object' ? previous : value;
      const existing = Array.isArray(current?.strokes) ? [...current.strokes] : [];
      if (!existing.length) {
        existing.push([point]);
      } else {
        existing[existing.length - 1] = [...normalizePoints(existing[existing.length - 1]), point];
      }
      return {
        _type: 'signature',
        format: 'stroke_json',
        signed_at: current?.signed_at || new Date().toISOString(),
        strokes: existing,
      };
    });
  };

  const endStroke = () => {
    setDrawing(false);
  };

  const clear = () => {
    if (readOnly) return;
    onChange?.({
      _type: 'signature',
      format: 'stroke_json',
      signed_at: null,
      strokes: [],
    });
  };

  return (
    <div className="space-y-2">
      <div
        ref={wrapperRef}
        className={cn(
          'rounded-2xl border bg-white p-3 shadow-sm',
          error ? 'border-red-300' : 'border-slate-200',
          readOnly ? 'opacity-90' : '',
        )}
      >
        <canvas
          id={id}
          ref={canvasRef}
          width={640}
          height={220}
          className="h-[220px] w-full rounded-xl border border-dashed border-slate-200 bg-white touch-none"
          onMouseDown={beginStroke}
          onMouseMove={extendStroke}
          onMouseUp={endStroke}
          onMouseLeave={endStroke}
          onTouchStart={beginStroke}
          onTouchMove={extendStroke}
          onTouchEnd={endStroke}
        />
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            {required ? 'שדה חובה. יש לחתום ישירות בתוך האזור.' : 'אפשר לחתום בעזרת עכבר או אצבע.'}
          </p>
          {!readOnly ? (
            <Button type="button" variant="outline" size="sm" onClick={clear}>
              נקה חתימה
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function SingleSelectField({ question, value, onChange, readOnly, error }) {
  return (
    <div className="space-y-2">
      <select
        id={question.id}
        value={value ?? ''}
        disabled={readOnly}
        className={cn(
          'h-11 w-full rounded-xl border bg-white px-3 text-sm shadow-sm',
          error ? 'border-red-300' : 'border-slate-200',
        )}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{question.placeholder || 'בחרו אפשרות'}</option>
        {(question.options || []).map((option) => (
          <option key={String(option.value)} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function MultiSelectField({ question, value, onChange, readOnly, error }) {
  const selectedValues = Array.isArray(value) ? value : [];
  return (
    <div className="space-y-2">
      <div className={cn('rounded-2xl border bg-white p-3 shadow-sm', error ? 'border-red-300' : 'border-slate-200')}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {(question.options || []).map((option) => (
            <label key={String(option.value)} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
              <Checkbox
                checked={selectedValues.includes(option.value)}
                disabled={readOnly}
                onCheckedChange={(checked) => {
                  if (readOnly) return;
                  const nextValues = checked
                    ? Array.from(new Set([...selectedValues, option.value]))
                    : selectedValues.filter((item) => item !== option.value);
                  onChange(nextValues);
                }}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function YesNoField({ question, value, onChange, readOnly, error }) {
  return (
    <div className="space-y-2">
      <div className={cn('rounded-2xl border bg-white p-3 shadow-sm', error ? 'border-red-300' : 'border-slate-200')}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            { value: true, label: 'כן' },
            { value: false, label: 'לא' },
          ].map((option) => {
            const checked = value === option.value;
            return (
              <label
                key={String(option.value)}
                className={cn(
                  'flex items-center justify-between rounded-xl border px-4 py-3 text-sm transition-colors',
                  checked ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 bg-slate-50 text-slate-700',
                  readOnly ? 'opacity-70' : 'cursor-pointer hover:border-slate-300 hover:bg-white',
                )}
              >
                <span className="font-medium">{option.label}</span>
                <input
                  type="radio"
                  name={question.id}
                  checked={checked}
                  disabled={readOnly}
                  className="h-4 w-4 accent-primary"
                  onChange={() => onChange(option.value)}
                />
              </label>
            );
          })}
        </div>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function ApprovalField({ question, value, onChange, readOnly, error }) {
  return (
    <div className="space-y-2">
      <label className={cn('flex items-start gap-3 rounded-2xl border bg-white p-4 shadow-sm', error ? 'border-red-300' : 'border-slate-200')}>
        <Checkbox
          checked={value === true}
          disabled={readOnly}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
        <div className="space-y-1">
          <span className="text-sm font-medium text-slate-800">{question.options?.[0]?.label || 'אני מאשר/ת'}</span>
          {question.description ? <p className="text-xs text-slate-500">{question.description}</p> : null}
        </div>
      </label>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function QuestionField({ question, value, onChange, readOnly, error }) {
  switch (question.type) {
    case 'long_text':
      return (
        <div className="space-y-2">
          <Textarea
            id={question.id}
            rows={4}
            value={value ?? ''}
            disabled={readOnly}
            placeholder={question.placeholder}
            className={cn('min-h-[120px] rounded-xl border bg-white px-3 py-2 text-sm shadow-sm', error ? 'border-red-300' : 'border-slate-200')}
            onChange={(event) => onChange(event.target.value)}
          />
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>
      );
    case 'number':
      return (
        <div className="space-y-2">
          <Input id={question.id} type="number" value={value ?? ''} disabled={readOnly} placeholder={question.placeholder} className={getInputClass(Boolean(error))} onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))} />
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>
      );
    case 'date':
      return (
        <div className="space-y-2">
          <Input id={question.id} type="date" value={value ?? ''} disabled={readOnly} className={getInputClass(Boolean(error))} onChange={(event) => onChange(event.target.value)} />
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>
      );
    case 'phone':
      return (
        <div className="space-y-2">
          <Input id={question.id} type="tel" value={value ?? ''} disabled={readOnly} placeholder={question.placeholder || '05X-XXXXXXX'} className={getInputClass(Boolean(error))} onChange={(event) => onChange(event.target.value)} />
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>
      );
    case 'email':
      return (
        <div className="space-y-2">
          <Input id={question.id} type="email" value={value ?? ''} disabled={readOnly} placeholder={question.placeholder || 'name@example.com'} className={getInputClass(Boolean(error))} onChange={(event) => onChange(event.target.value)} />
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>
      );
    case 'israeli_id':
      return (
        <div className="space-y-2">
          <Input id={question.id} inputMode="numeric" value={value ?? ''} disabled={readOnly} placeholder={question.placeholder || 'מספר זהות'} className={getInputClass(Boolean(error))} onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))} />
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>
      );
    case 'single_select':
      return <SingleSelectField question={question} value={value} onChange={onChange} readOnly={readOnly} error={error} />;
    case 'multi_select':
      return <MultiSelectField question={question} value={value} onChange={onChange} readOnly={readOnly} error={error} />;
    case 'yes_no':
      return <YesNoField question={question} value={value} onChange={onChange} readOnly={readOnly} error={error} />;
    case 'approval':
      return <ApprovalField question={question} value={value} onChange={onChange} readOnly={readOnly} error={error} />;
    case 'signature':
      return <SignatureCanvas id={question.id} value={value} onChange={onChange} required={question.required} readOnly={readOnly} error={error} />;
    case 'short_text':
    default:
      return (
        <div className="space-y-2">
          <Input id={question.id} value={value ?? ''} disabled={readOnly} placeholder={question.placeholder} className={getInputClass(Boolean(error))} onChange={(event) => onChange(event.target.value)} />
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>
      );
  }
}

function SharedBadge({ item }) {
  if (!item?.resolved_from_shared) return null;
  return <Badge variant="outline">משותף</Badge>;
}

function TextBlock({ item, onSharedItemSelect }) {
  const variantClass = item.variant === 'warning'
    ? 'border-amber-200 bg-amber-50/80'
    : item.variant === 'success'
      ? 'border-emerald-200 bg-emerald-50/80'
      : 'border-slate-200 bg-slate-50/80';

  return (
    <div className={cn('rounded-2xl border px-4 py-4 shadow-sm', variantClass)}>
      <div className="mb-2 flex items-center gap-2">
        <p className="text-sm font-semibold text-slate-900">{item.title || 'מידע חשוב'}</p>
        <SharedBadge item={item} />
        {item?.shared_block_id && onSharedItemSelect ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onSharedItemSelect(item)}>
            פרטי מקור
          </Button>
        ) : null}
      </div>
      {item.content ? <p className="text-sm leading-6 text-slate-700 whitespace-pre-wrap">{item.content}</p> : null}
      {item.missing_shared_block ? <p className="text-xs text-red-600">הבלוק המשותף הזה כבר לא זמין.</p> : null}
    </div>
  );
}

export default function SectionedFormRenderer({
  schema,
  visibilityRules = [],
  sharedBlockMap = {},
  answers = {},
  evaluationAnswers,
  onAnswersChange,
  onSharedItemSelect,
  readOnly = false,
  validationErrors = {},
  className,
}) {
  const effectiveAnswers = evaluationAnswers && typeof evaluationAnswers === 'object' ? evaluationAnswers : answers;
  const visibleSections = useMemo(
    () => getVisibleSections(schema, visibilityRules, effectiveAnswers, sharedBlockMap),
    [schema, visibilityRules, effectiveAnswers, sharedBlockMap],
  );

  const updateAnswer = (questionId, nextValue) => {
    const resolvedValue = typeof nextValue === 'function' ? nextValue(answers[questionId]) : nextValue;
    onAnswersChange?.({
      ...answers,
      [questionId]: resolvedValue,
    });
  };

  return (
    <div className={cn('space-y-5', className)}>
      {visibleSections.map((section) => (
        <div key={section.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 space-y-1">
            <h4 className="text-sm font-semibold text-slate-900">{section.title}</h4>
            {section.description ? <p className="text-xs text-slate-500">{section.description}</p> : null}
          </div>
          <div className="space-y-4">
            {section.items.map((item) => {
              if (!isQuestionItem(item)) {
                return <TextBlock key={item.id} item={item} onSharedItemSelect={onSharedItemSelect} />;
              }

              const question = {
                ...item,
                type: item.question_type,
              };

              return (
                <div key={question.id} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <RequiredLabel htmlFor={question.id} required={question.required}>{question.label}</RequiredLabel>
                    <SharedBadge item={item} />
                    {item?.shared_block_id && onSharedItemSelect ? (
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onSharedItemSelect(item)}>
                        פרטי מקור
                      </Button>
                    ) : null}
                  </div>
                  {question.description && question.type !== 'approval' ? (
                    <p className="text-xs text-slate-500">{question.description}</p>
                  ) : null}
                  {item.missing_shared_block ? (
                    <p className="text-xs text-red-600">השאלה המשותפת הזו כבר לא זמינה.</p>
                  ) : null}
                  <QuestionField
                    question={question}
                    value={answers?.[question.id]}
                    onChange={(nextValue) => updateAnswer(question.id, nextValue)}
                    readOnly={readOnly}
                    error={validationErrors?.[question.id] || ''}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
