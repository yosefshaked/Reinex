import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { DAY_OPTIONS } from '@/lib/day-of-week.js';
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

export function EditBreakTemplateDialog({ open, onClose, breakTemplate, instructors = [], onSuccess }) {
  const [dayOfWeek, setDayOfWeek] = useState('sunday');
  const [timeOfDay, setTimeOfDay] = useState('09:00');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [breakType, setBreakType] = useState('break');
  const [note, setNote] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (open && breakTemplate) {
      setDayOfWeek(breakTemplate.day_of_week || 'sunday');
      // time_of_day comes as "HH:MM:SS" from postgres — slice to "HH:MM" for the input
      setTimeOfDay(String(breakTemplate.time_of_day || '09:00').slice(0, 5));
      setDurationMinutes(String(breakTemplate.duration_minutes || 30));
      setBreakType(breakTemplate.break_type || 'break');
      setNote(breakTemplate.note || '');
      setValidFrom(breakTemplate.valid_from || '');
      setValidUntil(breakTemplate.valid_until || '');
      setConfirmDelete(false);
    }
  }, [open, breakTemplate]);

  const handleSave = useCallback(async (e) => {
    e.preventDefault();
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

    setIsSaving(true);
    try {
      await authenticatedFetch('instructor-break-templates', {
        method: 'PUT',
        body: {
          id: breakTemplate.id,
          day_of_week: dayOfWeek,
          time_of_day: timeOfDay,
          duration_minutes: durationNum,
          break_type: breakType,
          note: note.trim() || null,
          valid_from: validFrom || null,
          valid_until: validUntil || null,
        },
      });
      toast.success('תבנית ההפסקה עודכנה בהצלחה.');
      onSuccess?.();
      onClose?.();
    } catch (err) {
      toast.error(err?.message || 'שגיאה בעדכון תבנית ההפסקה.');
    } finally {
      setIsSaving(false);
    }
  }, [breakTemplate, dayOfWeek, timeOfDay, durationMinutes, breakType, note, validFrom, validUntil, onSuccess, onClose]);

  const handleDeactivate = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setIsDeactivating(true);
    try {
      await authenticatedFetch(`instructor-break-templates?id=${encodeURIComponent(breakTemplate.id)}`, {
        method: 'DELETE',
      });
      toast.success('תבנית ההפסקה הושבתה.');
      onSuccess?.();
      onClose?.();
    } catch (err) {
      toast.error(err?.message || 'שגיאה בהשבתת תבנית ההפסקה.');
    } finally {
      setIsDeactivating(false);
      setConfirmDelete(false);
    }
  }, [breakTemplate, confirmDelete, onSuccess, onClose]);

  if (!breakTemplate) return null;

  const instructor = (instructors || []).find((i) => String(i.id) === String(breakTemplate.instructor_employee_id));
  const instructorName = instructor ? getPersonName(instructor) : null;
  const isCustomDuration = !DEFAULT_DURATION_OPTIONS.includes(Number(durationMinutes));

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) { setConfirmDelete(false); onClose?.(); } }}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>עריכת תבנית הפסקה</DialogTitle>
          {instructorName ? (
            <DialogDescription>{instructorName}</DialogDescription>
          ) : null}
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4">
          {/* Day of week */}
          <div className="space-y-1.5">
            <Label htmlFor="ebt-day">יום בשבוע *</Label>
            <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
              <SelectTrigger id="ebt-day">
                <SelectValue />
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
            <Label htmlFor="ebt-time">שעת התחלה *</Label>
            <Input
              id="ebt-time"
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
            <Label htmlFor="ebt-type">סוג</Label>
            <Select value={breakType} onValueChange={setBreakType}>
              <SelectTrigger id="ebt-type">
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
            <Label htmlFor="ebt-note">הערה</Label>
            <Textarea
              id="ebt-note"
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
              <Label htmlFor="ebt-valid-from">בתוקף מ-</Label>
              <Input
                id="ebt-valid-from"
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ebt-valid-until">בתוקף עד</Label>
              <Input
                id="ebt-valid-until"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="flex-col gap-2 pt-2 sm:flex-row-reverse sm:justify-between">
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => { setConfirmDelete(false); onClose?.(); }} disabled={isSaving || isDeactivating}>
                ביטול
              </Button>
              <Button type="submit" disabled={isSaving || isDeactivating}>
                {isSaving ? 'שומר...' : 'שמור שינויים'}
              </Button>
            </div>
            <Button
              type="button"
              variant={confirmDelete ? 'destructive' : 'outline'}
              className="w-full sm:w-auto"
              onClick={handleDeactivate}
              disabled={isSaving || isDeactivating}
            >
              {isDeactivating ? 'מושבת...' : confirmDelete ? 'אשר השבתה' : 'השבת תבנית'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
