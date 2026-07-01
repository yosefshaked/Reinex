import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { authenticatedFetch } from '@/lib/api-client.js';
import { toast } from '@/lib/toast.jsx';
import { toLocalDateString } from '../utils/localDate.js';

const BREAK_TYPE_OPTIONS = [
  { value: 'break', label: 'הפסקה' },
  { value: 'meeting', label: 'פגישה' },
  { value: 'unavailable', label: 'לא זמין' },
  { value: 'personal', label: 'אישי' },
];

const DURATION_PRESETS = [15, 30, 45, 60, 90, 120];

function parseDatetimeStart(datetimeStart) {
  const dt = new Date(datetimeStart);
  if (Number.isNaN(dt.getTime())) return { date: '', startTime: '' };
  const date = toLocalDateString(dt);
  const hours = String(dt.getHours()).padStart(2, '0');
  const minutes = String(dt.getMinutes()).padStart(2, '0');
  return { date, startTime: `${hours}:${minutes}` };
}

export default function EditBreakDialog({ open, onClose, breakItem, instructorName = '', onSuccess }) {
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [breakType, setBreakType] = useState('break');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (open && breakItem) {
      const { date: parsedDate, startTime: parsedTime } = parseDatetimeStart(breakItem.datetime_start);
      setDate(parsedDate);
      setStartTime(parsedTime);
      setDurationMinutes(String(breakItem.duration_minutes));
      setBreakType(breakItem.break_type || 'break');
      setNote(breakItem.note || '');
      setConfirmDelete(false);
    }
  }, [open, breakItem]);

  const handleSave = useCallback(async (e) => {
    e.preventDefault();
    if (!date || !startTime) {
      toast.error('יש למלא תאריך ושעה.');
      return;
    }
    const durationNum = Number(durationMinutes);
    if (!Number.isFinite(durationNum) || durationNum < 1) {
      toast.error('יש להזין משך תקין (דקות).');
      return;
    }
    const datetimeStart = new Date(`${date}T${startTime}:00`).toISOString();
    setIsSaving(true);
    try {
      await authenticatedFetch('instructor-breaks', {
        method: 'PUT',
        body: {
          id: breakItem.id,
          datetime_start: datetimeStart,
          duration_minutes: durationNum,
          break_type: breakType,
          note: note.trim() || null,
        },
      });
      toast.success('ההפסקה עודכנה בהצלחה.');
      onSuccess?.();
      onClose?.();
    } catch (err) {
      toast.error(err?.message || 'שגיאה בעדכון ההפסקה.');
    } finally {
      setIsSaving(false);
    }
  }, [breakItem, date, startTime, durationMinutes, breakType, note, onSuccess, onClose]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setIsDeleting(true);
    try {
      await authenticatedFetch(`instructor-breaks?id=${encodeURIComponent(breakItem.id)}`, {
        method: 'DELETE',
      });
      toast.success('ההפסקה נמחקה.');
      onSuccess?.();
      onClose?.();
    } catch (err) {
      toast.error(err?.message || 'שגיאה במחיקת ההפסקה.');
    } finally {
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  }, [breakItem, confirmDelete, onSuccess, onClose]);

  if (!breakItem) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose?.(); }}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>עריכת הפסקה</DialogTitle>
          {instructorName ? (
            <DialogDescription>{instructorName}</DialogDescription>
          ) : null}
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4">
          {/* Date */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-break-date">תאריך *</Label>
            <Input
              id="edit-break-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>

          {/* Start time + Duration */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-break-start-time">שעת התחלה *</Label>
              <Input
                id="edit-break-start-time"
                type="time"
                step="900"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-break-duration">משך (דקות) *</Label>
              <Select value={String(durationMinutes)} onValueChange={setDurationMinutes}>
                <SelectTrigger id="edit-break-duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_PRESETS.map((d) => (
                    <SelectItem key={d} value={String(d)}>{d} דקות</SelectItem>
                  ))}
                  <SelectItem value="custom">אחר</SelectItem>
                </SelectContent>
              </Select>
              {!DURATION_PRESETS.map(String).includes(String(durationMinutes)) && durationMinutes !== 'custom' ? (
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
            <Label htmlFor="edit-break-type">סוג הפסקה</Label>
            <Select value={breakType} onValueChange={setBreakType}>
              <SelectTrigger id="edit-break-type">
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
            <Label htmlFor="edit-break-note">הערה (אופציונלי)</Label>
            <Textarea
              id="edit-break-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="הערה אופציונלית"
              rows={2}
            />
          </div>

          <DialogFooter className="flex-row-reverse justify-between gap-2 pt-2">
            {/* Delete side */}
            <Button
              type="button"
              variant={confirmDelete ? 'destructive' : 'ghost'}
              onClick={handleDelete}
              disabled={isDeleting || isSaving}
            >
              {isDeleting ? 'מוחק...' : confirmDelete ? 'אישור מחיקה' : 'מחק'}
            </Button>

            {/* Save + Cancel */}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSaving || isDeleting}>
                ביטול
              </Button>
              <Button type="submit" disabled={isSaving || isDeleting}>
                {isSaving ? 'שומר...' : 'שמור'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
