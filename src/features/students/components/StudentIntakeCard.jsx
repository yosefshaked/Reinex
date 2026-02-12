import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const EXCLUDED_KEYS = new Set(['intake_html_source', 'intake_date', 'response_id']);

function normalizeString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return String(value).trim();
}

function normalizeImportantFields(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function buildIntakeEntries(payload, importantFields) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return [];
  }

  const importantSet = new Set(importantFields);
  const allEntries = Object.entries(payload)
    .filter(([key]) => !EXCLUDED_KEYS.has(key))
    .map(([key, value]) => {
      if (value === null || value === undefined) {
        return null;
      }
      if (typeof value === 'object' && !Array.isArray(value)) {
        return null;
      }
      const textValue = Array.isArray(value)
        ? value.filter((entry) => entry !== null && entry !== undefined).join(', ')
        : String(value);
      const trimmedValue = normalizeString(textValue);
      if (!trimmedValue) {
        return null;
      }
      return { key, label: key, value: trimmedValue };
    })
    .filter(Boolean);

  if (!importantFields.length) {
    return allEntries;
  }

  const orderedImportant = importantFields
    .map((fieldKey) => allEntries.find((entry) => entry.key === fieldKey))
    .filter(Boolean);
  const remaining = allEntries.filter((entry) => !importantSet.has(entry.key));
  return [...orderedImportant, ...remaining];
}

export default function StudentIntakeCard({ intakeResponses, importantFields }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [expandedAnswers, setExpandedAnswers] = useState(() => new Set());
  const currentPayload = intakeResponses?.current && typeof intakeResponses.current === 'object'
    ? intakeResponses.current
    : null;

  const htmlSource = normalizeString(currentPayload?.intake_html_source);
  const normalizedImportantFields = useMemo(
    () => normalizeImportantFields(importantFields),
    [importantFields],
  );
  const entries = useMemo(
    () => buildIntakeEntries(currentPayload, normalizedImportantFields),
    [currentPayload, normalizedImportantFields],
  );

  const toggleAnswer = (answerKey) => {
    setExpandedAnswers((prev) => {
      const next = new Set(prev);
      if (next.has(answerKey)) {
        next.delete(answerKey);
      } else {
        next.add(answerKey);
      }
      return next;
    });
  };

  const handleAnswerKeyDown = (event, answerKey, canExpand) => {
    if (!canExpand) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleAnswer(answerKey);
    }
  };

  if (!currentPayload) {
    return null;
  }

  return (
    <Card>
      <details
        className="group"
        open={isExpanded}
        onToggle={(event) => setIsExpanded(event.currentTarget.open)}
      >
        <summary className="list-none cursor-pointer focus-visible:outline-none">
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base font-semibold text-foreground sm:text-lg">נתוני קליטה</CardTitle>
              <p className="text-xs text-muted-foreground">לחצו להצגת פרטי קליטה</p>
            </div>
            <Button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setIsDialogOpen(true);
              }}
              disabled={!htmlSource}
            >
              צפה בטופס המקורי
            </Button>
          </CardHeader>
        </summary>
        <CardContent>
          {entries.length ? (
            <div className="grid gap-3 text-sm text-slate-700 md:grid-cols-2" dir="rtl">
              {entries.map((entry, index) => {
                const answerKey = `${entry.label}-${index}`;
                const isLongAnswer = entry.value.length > 120 || entry.value.includes('\n');
                const isExpandedAnswer = expandedAnswers.has(answerKey);
                return (
                  <div key={answerKey} className="rounded-md border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold text-slate-500">{entry.label}</p>
                    <p
                      className={`mt-1 text-sm text-slate-700 ${
                        isLongAnswer ? 'cursor-pointer' : ''
                      } ${isExpandedAnswer ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}
                      onClick={isLongAnswer ? () => toggleAnswer(answerKey) : undefined}
                      onKeyDown={(event) => handleAnswerKeyDown(event, answerKey, isLongAnswer)}
                      role={isLongAnswer ? 'button' : undefined}
                      tabIndex={isLongAnswer ? 0 : undefined}
                    >
                      {entry.value}
                    </p>
                    {isLongAnswer && !isExpandedAnswer ? (
                      <p className="mt-1 text-xs text-slate-400">לחצו להצגה מלאה</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-500" dir="rtl">לא נמצאו נתוני קליטה להצגה.</p>
          )}
        </CardContent>
      </details>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-4xl overflow-y-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="text-right">טופס קליטה מקורי</DialogTitle>
          </DialogHeader>
          {htmlSource ? (
            <div
              className="rounded-md border border-slate-200 bg-white p-4"
              dangerouslySetInnerHTML={{ __html: htmlSource }}
            />
          ) : (
            <p className="text-sm text-slate-500" dir="rtl">לא נמצא טופס HTML לתצוגה.</p>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
