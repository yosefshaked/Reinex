import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { DAY_OPTIONS } from '@/lib/day-of-week.js';
import { useOrg } from '@/org/OrgContext';
import { authenticatedFetch } from '@/lib/api-client.js';
import { toast } from '@/lib/toast.jsx';

const BREAK_TYPE_OPTIONS = [
  { value: 'break', label: 'הפסקה' },
  { value: 'meeting', label: 'פגישה' },
  { value: 'unavailable', label: 'לא זמין' },
  { value: 'personal', label: 'אישי' },
];

const DEFAULT_DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];

function getPersonName(person) {
  if (!person) return '—';
  return person.full_name || [person.first_name, person.middle_name, person.last_name].filter(Boolean).join(' ').trim() || person.email || '—';
}

export function AddBreakTemplateDialog({
  open,
  onClose,
  onSuccess,
  instructors = [],
  defaultInstructorId = null,
  defaultDayOfWeek = null,
  defaultTimeOfDay = '09:00',
  defaultDurationMinutes = 30,
}) {
  const { activeOrgId } = useOrg();
  const [instructorId, setInstructorId] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState('sunday');
  const [timeOfDay, setTimeOfDay] = useState('09:00');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [breakType, setBreakType] = useState('break');
  const [note, setNote] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setInstructorId(defaultInstructorId || '');
      setDayOfWeek(defaultDayOfWeek || 'sunday');
      setTimeOfDay(defaultTimeOfDay || '09:00');
      setDurationMinutes(String(defaultDurationMinutes || 30));
      setBreakType('break');
      setNote('');
      setValidFrom('');
      setValidUntil('');
    }
  }, [open, defaultInstructorId, defaultDayOfWeek, defaultTimeOfDay, defaultDurationMinutes]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();

    if (!instructorId) {
      toast.error('יש לבחור מדריך/ה.');
      return;
    }
    if (!dayOfWeek) {
      toast.error('יש לבחור יום בשבוע.');
      return;
    }
    if (!timeOfDay) {
      toast.error('יש להזין שעת התחלה.');
      return;
    }
    const durationNum = Number(durationMinutes);
    if (!Number.isFinite(durationNum) || durationNum < 1) {
      toast.error('יש להזין משך תקין (דקות).');
      return;
    }

    setIsSubmitting(true);
    try {
      await authenticatedFetch('instructor-break-templates', {
        method: 'POST',
        body: {
          org_id: activeOrgId,
          instructor_employee_id: instructorId,
          day_of_week: dayOfWeek,
          time_of_day: timeOfDay,
          duration_minutes: durationNum,
          break_type: breakType,
          note: note.trim() || null,
          valid_from: validFrom || null,
          valid_until: validUntil || null,
        },
      });

      toast.success('תבנית ההפסקה נוספה בהצלחה.');
      onSuccess?.();
      onClose?.();
    } catch (err) {
      toast.error(err?.message || 'שגיאה בשמירת תבנית ההפסקה.');
    } finally {
      setIsSubmitting(false);
    }
  }, [activeOrgId, instructorId, dayOfWeek, timeOfDay, durationMinutes, breakType, note, validFrom, validUntil, onSuccess, onClose]);

  const activeInstructors = (instructors || []).filter((i) => i.is_active !== false);
  const isCustomDuration = !DEFAULT_DURATION_OPTIONS.includes(Number(durationMinutes));

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose?.(); }}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>הוסף תבנית הפסקה</DialogTitle>
          <DialogDescription>
            תבנית הפסקה חוזרת — תיצור הפסקה אוטומטית בכל פעם שמייצרים לוח שבועי.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Instructor */}
          <div className="space-y-1.5">
            <Label htmlFor="brt-instructor">מדריך/ה *</Label>
            <Select value={instructorId} onValueChange={setInstructorId}>
              <SelectTrigger id="brt-instructor">
                <SelectValue placeholder="בחר מדריך/ה" />
              </SelectTrigger>
              <SelectContent>
                {activeInstructors.map((instructor) => (
                  <SelectItem key={instructor.id} value={String(instructor.id)}>
                    {getPersonName(instructor)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Day of week */}
          <div className="space-y-1.5">
            <Label htmlFor="brt-day">יום בשבוע *</Label>
            <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
              <SelectTrigger id="brt-day">
                <SelectValue placeholder="בחר יום" />
              </SelectTrigger>
              <SelectContent>
                {DAY_OPTIONS.map((day) => (
                  <SelectItem key={day.value} value={day.value}>
                    {day.fullLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Time of day */}
          <div className="space-y-1.5">
            <Label htmlFor="brt-time">שעת התחלה *</Label>
            <Input
              id="brt-time"
              type="time"
              value={timeOfDay}
              onChange={(e) => setTimeOfDay(e.target.value)}
              required
            />
          </div>

          {/* Duration */}
          <div className="space-y-1.5">
            <Label>משך (דקות) *</Label>
            <div className="flex flex-wrap items-center gap-2">
              {DEFAULT_DURATION_OPTIONS.map((mins) => (
                <Button
                  key={mins}
                  type="button"
                  size="sm"
                  variant={String(durationMinutes) === String(mins) ? 'default' : 'outline'}
                  className="h-8 min-w-[3.2rem]"
                  onClick={() => setDurationMinutes(String(mins))}
                >
                  {mins}
                </Button>
              ))}
              <Input
                type="number"
                min={1}
                max={720}
                placeholder="אחר"
                className="h-8 w-20"
                value={isCustomDuration ? durationMinutes : ''}
                onChange={(e) => setDurationMinutes(e.target.value)}
              />
            </div>
          </div>

          {/* Break type */}
          <div className="space-y-1.5">
            <Label htmlFor="brt-type">סוג</Label>
            <Select value={breakType} onValueChange={setBreakType}>
              <SelectTrigger id="brt-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BREAK_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Note */}
          <div className="space-y-1.5">
            <Label htmlFor="brt-note">הערה</Label>
            <Textarea
              id="brt-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="הערה אופציונלית..."
              rows={2}
              className="resize-none"
            />
          </div>

          {/* Valid from / until */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="brt-valid-from">בתוקף מ-</Label>
              <Input
                id="brt-valid-from"
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brt-valid-until">בתוקף עד</Label>
              <Input
                id="brt-valid-until"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              ביטול
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'שומר...' : 'הוסף תבנית'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
