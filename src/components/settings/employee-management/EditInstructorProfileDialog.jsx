import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Clock, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '@/lib/api-client';

const DAYS_OF_WEEK = [
  { value: 0, label: 'ראשון', labelShort: 'א' },
  { value: 1, label: 'שני', labelShort: 'ב' },
  { value: 2, label: 'שלישי', labelShort: 'ג' },
  { value: 3, label: 'רביעי', labelShort: 'ד' },
  { value: 4, label: 'חמישי', labelShort: 'ה' },
  { value: 5, label: 'שישי', labelShort: 'ו' },
  { value: 6, label: 'שבת', labelShort: 'ש' },
];

export default function EditInstructorProfileDialog({ open, onOpenChange, instructor, orgId, session, onSaved }) {
  const [workingDays, setWorkingDays] = useState(instructor?.instructor_profile?.working_days || []);
  const [breakTimeMinutes, setBreakTimeMinutes] = useState(instructor?.instructor_profile?.break_time_minutes || 0);
  const [isSaving, setIsSaving] = useState(false);

  const toggleDay = (dayValue) => {
    setWorkingDays((prev) =>
      prev.includes(dayValue) ? prev.filter((d) => d !== dayValue) : [...prev, dayValue].sort((a, b) => a - b)
    );
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!instructor?.id) return;

    setIsSaving(true);
    try {
      await authenticatedFetch('instructors', {
        session,
        method: 'PUT',
        body: {
          org_id: orgId,
          instructor_id: instructor.id,
          working_days: workingDays.length > 0 ? workingDays : null,
          break_time_minutes: breakTimeMinutes > 0 ? breakTimeMinutes : null,
        },
      });
      toast.success('פרופיל העובד עודכן בהצלחה.');
      onOpenChange(false);
      if (onSaved) {
        onSaved();
      }
    } catch (error) {
      console.error('Failed to update instructor profile', error);
      toast.error(error?.message || 'עדכון הפרופיל נכשל.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">עריכת פרופיל עובד</DialogTitle>
          <DialogDescription className="text-right">
            הגדר ימי עבודה ומשך הפסקה עבור {instructor?.first_name} {instructor?.last_name}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave}>
          <div className="space-y-6 py-4">
            {/* Working Days */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-slate-600" />
                <Label className="text-right">ימי עבודה</Label>
              </div>
              <div className="flex flex-wrap gap-2" dir="rtl">
                {DAYS_OF_WEEK.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleDay(day.value)}
                    className={`
                      flex flex-col items-center justify-center min-w-[3rem] h-[3rem] rounded-lg border-2 transition-colors
                      ${
                        workingDays.includes(day.value)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background hover:bg-muted border-muted-foreground/20'
                      }
                    `}
                  >
                    <span className="text-xs font-medium">{day.labelShort}</span>
                    <span className="text-[0.65rem] opacity-80">{day.label}</span>
                  </button>
                ))}
              </div>
              {workingDays.length === 0 && (
                <p className="text-xs text-amber-600">לא נבחרו ימי עבודה. המערכת תניח זמינות מלאה.</p>
              )}
              {workingDays.length > 0 && (
                <p className="text-xs text-slate-600">
                  נבחרו {workingDays.length} ימים: {workingDays.map((d) => DAYS_OF_WEEK[d].labelShort).join(', ')}
                </p>
              )}
            </div>

            {/* Break Time */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-slate-600" />
                <Label htmlFor="break_time" className="text-right">
                  משך הפסקה (דקות)
                </Label>
              </div>
              <Input
                id="break_time"
                type="number"
                min="0"
                max="240"
                step="5"
                value={breakTimeMinutes}
                onChange={(e) => setBreakTimeMinutes(parseInt(e.target.value, 10) || 0)}
                disabled={isSaving}
                className="text-right"
                dir="ltr"
              />
              <p className="text-xs text-slate-500">
                {breakTimeMinutes === 0
                  ? 'ללא הפסקה מוגדרת'
                  : `הפסקה של ${breakTimeMinutes} דקות תילקח בחשבון בתכנון המשמרות`}
              </p>
            </div>
          </div>

          <div className="flex flex-row-reverse gap-2 pt-4">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  שומר...
                </>
              ) : (
                'שמור שינויים'
              )}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              ביטול
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
