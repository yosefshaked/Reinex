import { useState, useCallback, useEffect, useMemo } from 'react';
import { Calendar, Clock, RotateCcw, Loader2, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOrg } from '@/org/OrgContext.jsx';
import { useAuth } from '@/auth/AuthContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { fetchSettingsValue } from '@/features/settings/api/settings.js';
import { parseSessionFormConfig } from '@/features/sessions/utils/form-config.js';

const REASON_OPTIONS = [
  { value: 'substitute', label: 'מחליף זמני' },
  { value: 'new_student', label: 'תלמיד חדש' },
  { value: 'other', label: 'אחר' },
];

function normalizeMaybeOptionText(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const label = typeof value.label === 'string' ? value.label : '';
    const optionValue = typeof value.value === 'string' ? value.value : '';
    return label || optionValue || fallback;
  }
  return fallback;
}

function normalizeLooseReasonValue(rawReason) {
  const allowed = new Set(REASON_OPTIONS.map((opt) => opt.value));
  const labelToValue = new Map(REASON_OPTIONS.map((opt) => [opt.label, opt.value]));

  const candidate = normalizeMaybeOptionText(rawReason, '').trim();
  if (!candidate) return '';
  if (allowed.has(candidate)) return candidate;
  if (labelToValue.has(candidate)) return labelToValue.get(candidate);
  return candidate;
}

function normalizeQuestionOptions(rawOptions) {
  if (!Array.isArray(rawOptions)) return [];
  return rawOptions
    .map((entry) => {
      if (typeof entry === 'string') {
        const trimmed = entry.trim();
        if (!trimmed) return null;
        return { value: trimmed, label: trimmed };
      }
      if (!entry || typeof entry !== 'object') return null;
      const value = typeof entry.value === 'string' ? entry.value.trim() : '';
      const label = typeof entry.label === 'string' ? entry.label.trim() : '';
      const resolvedValue = value || label;
      const resolvedLabel = label || value;
      if (!resolvedValue || !resolvedLabel) return null;
      return { value: resolvedValue, label: resolvedLabel };
    })
    .filter(Boolean);
}

function coerceAnswerToOptionValue(answer, options) {
  if (typeof answer !== 'string' || !answer.trim()) return '';
  const trimmed = answer.trim();
  if (!Array.isArray(options) || options.length === 0) return trimmed;
  if (options.some((opt) => opt.value === trimmed)) return trimmed;
  const matchByLabel = options.find((opt) => opt.label === trimmed);
  return matchByLabel ? matchByLabel.value : trimmed;
}

function formatDateForDisplay(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

function parseSessionContent(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw;
  return {};
}

export default function ResubmitRejectedReportDialog({
  isOpen,
  onClose,
  report,
  onSuccess,
}) {
  const { activeOrg } = useOrg();
  const { session } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  
  const unassignedDetails = useMemo(() => report?.metadata?.unassigned_details || {}, [report]);
  const rejectionInfo = useMemo(() => report?.metadata?.rejection || {}, [report]);
  const originalContent = useMemo(() => parseSessionContent(report?.content), [report?.content]);

  const rejectionReasonText = useMemo(() => {
    const raw = rejectionInfo?.reason;
    const normalized = normalizeMaybeOptionText(raw, '').trim();
    return normalized || 'לא צוינה סיבה';
  }, [rejectionInfo?.reason]);
  
  const [formData, setFormData] = useState({
    name: '',
    reason: 'other',
    reasonOther: '',
    date: '',
    time: '',
    service: '',
    adminNotes: '',
  });
  
  const [answers, setAnswers] = useState({});

  // Load questions from settings
  useEffect(() => {
    if (!isOpen || !activeOrg?.id) return;

    const loadQuestions = async () => {
      setLoadingQuestions(true);
      try {
        const result = await fetchSettingsValue({ key: 'session_form_config', orgId: activeOrg.id, session });
        const config = result?.value || result; // Handle both wrapped and unwrapped responses
        const parsed = parseSessionFormConfig(config);
        setQuestions(parsed || []);
      } catch (error) {
        console.error('Failed to load questions', error);
        setQuestions([]);
      } finally {
        setLoadingQuestions(false);
      }
    };

    void loadQuestions();
  }, [isOpen, activeOrg?.id, session]);

  // Initialize form data when report changes
  useEffect(() => {
    if (!report) return;

    const normalizedLooseReason = normalizeLooseReasonValue(unassignedDetails.reason);
    const normalizedLooseReasonOther = normalizeMaybeOptionText(unassignedDetails.reason_other, '').trim();

    const allowedReasonValues = new Set(REASON_OPTIONS.map((opt) => opt.value));
    const initialReason = allowedReasonValues.has(normalizedLooseReason)
      ? normalizedLooseReason
      : normalizedLooseReason
        ? 'other'
        : 'other';

    const initialReasonOther = initialReason === 'other'
      ? (normalizedLooseReasonOther || (allowedReasonValues.has(normalizedLooseReason) ? '' : normalizedLooseReason))
      : '';

    setFormData({
      name: unassignedDetails.name || '',
      reason: initialReason,
      reasonOther: initialReasonOther,
      date: report.date || '',
      time: unassignedDetails.time || '',
      service: report.service_context || '',
      adminNotes: '',
    });

    // Initialize answers from original content
    setAnswers(originalContent || {});
  }, [report, unassignedDetails, originalContent]);

  const handleInputChange = useCallback((field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleAnswerChange = useCallback((questionKey, value) => {
    setAnswers(prev => ({ ...prev, [questionKey]: value }));
  }, []);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      toast.error('נא להזין שם');
      return;
    }
    
    if (!formData.date) {
      toast.error('נא לבחור תאריך');
      return;
    }
    
    if (!formData.time) {
      toast.error('נא להזין שעה');
      return;
    }

    setIsSubmitting(true);

    try {
      const body = {
        student_id: null,
        org_id: activeOrg?.id,
        date: formData.date,
        time: formData.time,
        service_context: formData.service || null,
        content: answers,
        unassigned_details: {
          name: formData.name.trim(),
          reason: formData.reason,
          ...(formData.reason === 'other' ? { reason_other: formData.reasonOther } : {}),
          time: formData.time,
        },
        metadata: {
          resubmitted_from: report?.id,
          original_rejection: rejectionInfo,
          instructor_notes: formData.adminNotes.trim() || undefined,
        },
      };

      await authenticatedFetch('sessions', {
        method: 'POST',
        body,
      });

      toast.success('הדיווח נשלח מחדש בהצלחה');
      onSuccess?.();
    } catch (error) {
      console.error('Failed to resubmit report', error);
      toast.error(error?.message || 'שליחת הדיווח נכשלה');
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, answers, report, activeOrg, rejectionInfo, onSuccess]);

  if (!report) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right flex items-center gap-2">
            <RotateCcw className="h-5 w-5" />
            שליחה מחדש של דיווח שנדחה
          </DialogTitle>
          <DialogDescription className="text-right">
            תוכל לערוך את כל פרטי הדיווח ותוכן המפגש לפני שליחה מחדש
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Rejection Info */}
          <div className="rounded-md bg-red-50 p-4 border border-red-200">
            <h3 className="font-semibold text-red-900 mb-2">סיבת הדחייה המקורית:</h3>
            <p className="text-red-800 text-sm">{rejectionReasonText}</p>
            {rejectionInfo.rejected_at && (
              <p className="text-xs text-red-600 mt-1">
                נדחה ב-{formatDateForDisplay(rejectionInfo.rejected_at.split('T')[0])}
              </p>
            )}
          </div>

          {/* Form Fields */}
          <div className="space-y-3">
            <div>
              <Label htmlFor="name" className="block text-right mb-1">
                שם התלמיד <span className="text-red-500">*</span>
              </Label>
              <Input
                id="name"
                dir="rtl"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                placeholder="הזן שם"
                required
              />
            </div>

            <div>
              <Label htmlFor="reason" className="block text-right mb-1">
                סיבה <span className="text-red-500">*</span>
              </Label>
              <Select
                value={formData.reason}
                onValueChange={(value) => handleInputChange('reason', value)}
              >
                <SelectTrigger id="reason" dir="rtl">
                  <SelectValue placeholder="בחר סיבה" />
                </SelectTrigger>
                <SelectContent>
                  {REASON_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {formData.reason === 'other' && (
              <div>
                <Label htmlFor="reasonOther" className="block text-right mb-1">
                  פירוט הסיבה
                </Label>
                <Textarea
                  id="reasonOther"
                  dir="rtl"
                  value={formData.reasonOther}
                  onChange={(e) => handleInputChange('reasonOther', e.target.value)}
                  placeholder="פרט את הסיבה"
                  rows={2}
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="date" className="block text-right mb-1 flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  תאריך <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="date"
                  type="date"
                  value={formData.date}
                  onChange={(e) => handleInputChange('date', e.target.value)}
                  required
                />
              </div>

              <div>
                <Label htmlFor="time" className="block text-right mb-1 flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  שעה <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="time"
                  type="time"
                  dir="ltr"
                  value={formData.time}
                  onChange={(e) => handleInputChange('time', e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <Label htmlFor="service" className="block text-right mb-1">
                שירות
              </Label>
              <Input
                id="service"
                dir="rtl"
                value={formData.service}
                onChange={(e) => handleInputChange('service', e.target.value)}
                placeholder="שם השירות (אופציונלי)"
              />
            </div>
          </div>

          {/* Session Content (Questions) */}
          {loadingQuestions ? (
            <div className="flex items-center justify-center gap-2 py-4 text-neutral-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">טוען שאלות...</span>
            </div>
          ) : questions.length > 0 ? (
            <div className="space-y-3 pt-4 border-t">
              <h3 className="font-semibold text-sm text-right">תוכן הדיווח</h3>
              {questions.map((question) => {
                const questionKey = question.key || question.id;
                const questionLabel = question.label || question.question || questionKey;
                const rawValue = answers[questionKey] || '';
                const options = normalizeQuestionOptions(question.options || []);
                const currentValue = coerceAnswerToOptionValue(rawValue, options);

                return (
                  <div key={questionKey}>
                    <Label htmlFor={`q-${questionKey}`} className="block text-right mb-1">
                      {questionLabel}
                    </Label>
                    {question.type === 'textarea' ? (
                      <Textarea
                        id={`q-${questionKey}`}
                        dir="rtl"
                        value={currentValue}
                        onChange={(e) => handleAnswerChange(questionKey, e.target.value)}
                        placeholder="הזן תשובה"
                        rows={3}
                      />
                    ) : question.type === 'select' || question.type === 'radio' || question.type === 'buttons' ? (
                      <Select
                        value={currentValue}
                        onValueChange={(value) => handleAnswerChange(questionKey, value)}
                      >
                        <SelectTrigger id={`q-${questionKey}`} dir="rtl">
                          <SelectValue placeholder="בחר תשובה" />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={`q-${questionKey}`}
                        type={question.type === 'number' ? 'number' : question.type === 'date' ? 'date' : 'text'}
                        dir="rtl"
                        value={currentValue}
                        onChange={(e) => handleAnswerChange(questionKey, e.target.value)}
                        placeholder="הזן תשובה"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Admin Notes */}
          <div className="space-y-2 pt-4 border-t">
            <Label htmlFor="adminNotes" className="block text-right flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              הערות למנהל
            </Label>
            <p className="text-xs text-muted-foreground text-right">
              הערות אלו יהיו נראות רק למנהל בדף הדיווחים הממתינים ולא יופיעו בפרופיל התלמיד
            </p>
            <Textarea
              id="adminNotes"
              dir="rtl"
              value={formData.adminNotes}
              onChange={(e) => handleInputChange('adminNotes', e.target.value)}
              placeholder="הוסף הערות למנהל (אופציונלי)"
              rows={3}
            />
          </div>

          {/* Footer */}
          <div className="flex gap-2 justify-end pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              ביטול
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  שולח...
                </>
              ) : (
                <>
                  <RotateCcw className="h-4 w-4" />
                  שלח מחדש
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
