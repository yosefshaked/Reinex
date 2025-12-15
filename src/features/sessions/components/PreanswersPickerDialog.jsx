import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, CheckCircle2 } from 'lucide-react';

/**
 * PreanswersPickerDialog - Dialog for searching and selecting preconfigured answers
 * 
 * @param {boolean} open - Whether dialog is open
 * @param {function} onClose - Callback when dialog closes
 * @param {Array<string>} answers - List of preconfigured answer strings
 * @param {function} onSelect - Callback when user selects an answer (receives string)
 * @param {string} questionLabel - Label of the question being answered
 */
export default function PreanswersPickerDialog({
  open,
  onClose,
  answers = [],
  onSelect,
  questionLabel = 'שאלה',
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAnswer, setSelectedAnswer] = useState(null);

  // Reset selection when dialog opens
  React.useEffect(() => {
    if (open) {
      setSelectedAnswer(null);
      setSearchQuery('');
    }
  }, [open]);

  const filteredAnswers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return answers;
    return answers.filter((ans) => String(ans).toLowerCase().includes(q));
  }, [answers, searchQuery]);

  const handleInsert = () => {
    if (selectedAnswer) {
      onSelect?.(selectedAnswer);
      onClose?.();
    }
  };

  const handleAnswerClick = (answer) => {
    setSelectedAnswer(answer);
  };

  const handleAnswerDoubleClick = (answer) => {
    onSelect?.(answer);
    onClose?.();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-right">בחירת תשובה מוכנה</DialogTitle>
          <p className="text-sm text-neutral-600 text-right mt-2">
            {questionLabel}
          </p>
        </DialogHeader>

        <div className="space-y-4" dir="rtl">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
            <Input
              type="text"
              placeholder="חיפוש תשובות..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-10"
              autoFocus
            />
          </div>

          {/* Answers List */}
          <div className="border rounded-lg max-h-[300px] overflow-y-auto">
            {filteredAnswers.length === 0 ? (
              <div className="p-8 text-center text-sm text-neutral-500">
                {answers.length === 0
                  ? 'אין תשובות מוכנות זמינות. בקשו ממנהלי המערכת להוסיף תשובות מוכנות.'
                  : 'לא נמצאו תשובות התואמות את החיפוש.'}
              </div>
            ) : (
              <ul className="divide-y" role="listbox">
                {filteredAnswers.map((answer, index) => (
                  <li
                    key={index}
                    role="option"
                    aria-selected={selectedAnswer === answer}
                    className={`p-3 cursor-pointer transition-colors hover:bg-primary/5 ${
                      selectedAnswer === answer
                        ? 'bg-primary/10 border-r-4 border-primary'
                        : ''
                    }`}
                    onClick={() => handleAnswerClick(answer)}
                    onDoubleClick={() => handleAnswerDoubleClick(answer)}
                  >
                    <div className="flex items-start gap-2 text-right">
                      {selectedAnswer === answer && (
                        <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      )}
                      <span className="text-sm flex-1">{answer}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex flex-col-reverse gap-2 sm:flex-row-reverse sm:justify-start">
            <Button
              onClick={handleInsert}
              disabled={!selectedAnswer}
              className="gap-2"
            >
              הכנס תשובה
            </Button>
            <Button variant="outline" onClick={onClose}>
              ביטול
            </Button>
          </div>

          {filteredAnswers.length > 0 && (
            <p className="text-xs text-neutral-500 text-center hidden sm:block">
              לחצו פעמיים על תשובה להכנסה מהירה
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
