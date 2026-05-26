import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
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

function getDefaultTimeString() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(Math.floor(now.getMinutes() / 15) * 15).padStart(2, '0');
  return `${h}:${m}`;
}

export default function AddBreakDialog({ open, onClose, onSuccess, instructors = [], defaultDate = '' }) {
  const { activeOrgId } = useOrg();
  const [instructorId, setInstructorId] = useState('');
  const [date, setDate] = useState(defaultDate || '');
  const [startTime, setStartTime] = useState(getDefaultTimeString());
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [breakType, setBreakType] = useState('break');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setInstructorId('');
      setDate(defaultDate || '');
      setStartTime(getDefaultTimeString());
      setDurationMinutes('30');
      setBreakType('break');
      setNote('');
    }
  }, [open, defaultDate]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();

    if (!instructorId) {
      toast.error('יש לבחור מדריך/ה.');
      return;
    }
    if (!date) {
      toast.error('יש לבחור תאריך.');
      return;
    }
    if (!startTime) {
      toast.error('יש לבחור שעת התחלה.');
      return;
    }
    const durationNum = Number(durationMinutes);
    if (!Number.isFinite(durationNum) || durationNum < 1) {
      toast.error('יש להזין משך תקין (דקות).');
      return;
    }

    // Build ISO datetime from date + local time
    const datetimeStart = new Date(`${date}T${startTime}:00`).toISOString();

    setIsSubmitting(true);
    try {
      await authenticatedFetch('instructor-breaks', {
        method: 'POST',
        body: {
          org_id: activeOrgId,
          instructor_employee_id: instructorId,
          datetime_start: datetimeStart,
          duration_minutes: durationNum,
          break_type: breakType,
          note: note.trim() || null,
        },
      });

      toast.success('ההפסקה נוספה בהצלחה.');
      onSuccess?.();
      onClose?.();
    } catch (err) {
      toast.error(err?.message || 'שגיאה בשמירת ההפסקה.');
    } finally {
      setIsSubmitting(false);
    }
  }, [activeOrgId, instructorId, date, startTime, durationMinutes, breakType, note, onSuccess, onClose]);

  const activeInstructors = (instructors || []).filter((i) => i.is_active !== false);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose?.(); }}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>הוסף הפסקה</DialogTitle>
          <DialogDescription>
            הפסקה תחסום את הזמן של המדריך/ה בלוח ותמנע שיבוץ שיעורים.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Instructor */}
          <div className="space-y-1.5">
            <Label htmlFor="break-instructor">מדריך/ה *</Label>
            <Select value={instructorId} onValueChange={setInstructorId}>
              <SelectTrigger id="break-instructor">
                <SelectValue placeholder="בחר מדריך/ה" />
              </SelectTrigger>
              <SelectContent>
                {activeInstructors.map((instructor) => (
                  <SelectItem key={instructor.id} value={String(instructor.id)}>
                    {instructor.full_name || instructor.first_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date */}
          <div className="space-y-1.5">
            <Label htmlFor="break-date">תאריך *</Label>
            <Input
              id="break-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>

          {/* Start time + Duration */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="break-start-time">שעת התחלה *</Label>
              <Input
                id="break-start-time"
                type="time"
                step="900"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="break-duration">משך (דקות) *</Label>
              <Select value={String(durationMinutes)} onValueChange={setDurationMinutes}>
                <SelectTrigger id="break-duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEFAULT_DURATION_OPTIONS.map((d) => (
                    <SelectItem key={d} value={String(d)}>{d} דקות</SelectItem>
                  ))}
                  <SelectItem value="custom">אחר</SelectItem>
                </SelectContent>
              </Select>
              {!DEFAULT_DURATION_OPTIONS.map(String).includes(String(durationMinutes)) && durationMinutes !== 'custom' ? (
                <Input
                  type="number"
                  min="1"
                  max="720"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  placeholder="הזן דקות"
                  className="mt-1"
                />
              ) : null}
              {durationMinutes === 'custom' ? (
                <Input
                  type="number"
                  min="1"
                  max="720"
                  value=""
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  placeholder="הזן דקות"
                  className="mt-1"
                />
              ) : null}
            </div>
          </div>

          {/* Break type */}
          <div className="space-y-1.5">
            <Label htmlFor="break-type">סוג הפסקה</Label>
            <Select value={breakType} onValueChange={setBreakType}>
              <SelectTrigger id="break-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BREAK_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Note */}
          <div className="space-y-1.5">
            <Label htmlFor="break-note">הערה (אופציונלי)</Label>
            <Textarea
              id="break-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="למשל: ישיבת צוות שבועית"
              rows={2}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              ביטול
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'שומר...' : 'הוסף הפסקה'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
