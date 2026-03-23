import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Calendar, Clock, Mail, Phone, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '@/lib/api-client';

const DAYS_OF_WEEK = [
  { value: 0, label: 'ראשון', short: 'א' },
  { value: 1, label: 'שני', short: 'ב' },
  { value: 2, label: 'שלישי', short: 'ג' },
  { value: 3, label: 'רביעי', short: 'ד' },
  { value: 4, label: 'חמישי', short: 'ה' },
  { value: 5, label: 'שישי', short: 'ו' },
  { value: 6, label: 'שבת', short: 'ש' },
];

function deriveEmployeeType(employee) {
  if (employee?.employee_type) {
    return employee.employee_type;
  }
  if (employee?.instructor_profile || (employee?.service_capabilities || []).length > 0) {
    return 'instructor';
  }
  return 'office';
}

function buildInitialState(employee) {
  return {
    employeeId: employee?.employee_id || '',
    employeeType: deriveEmployeeType(employee),
    firstName: employee?.first_name || '',
    middleName: employee?.middle_name || '',
    lastName: employee?.last_name || '',
    email: employee?.email || '',
    phone: employee?.phone || '',
    startDate: employee?.start_date || '',
    currentRate: employee?.current_rate ?? '',
    annualLeaveDays: employee?.annual_leave_days ?? '',
    leavePayMethod: employee?.leave_pay_method || '',
    leaveFixedDayRate: employee?.leave_fixed_day_rate ?? '',
    employmentScope: employee?.employment_scope || '',
    notes: employee?.notes || '',
    workingDays: Array.isArray(employee?.instructor_profile?.working_days) ? employee.instructor_profile.working_days : [],
    breakTimeMinutes: employee?.instructor_profile?.break_time_minutes ?? '',
  };
}

function Section({ title, icon: Icon, description, children }) {
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-end">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {description ? <p className="text-xs text-slate-500">{description}</p> : null}
        </div>
        {Icon ? (
          <div className="rounded-xl bg-white p-2 text-slate-600 shadow-sm">
            <Icon className="h-4 w-4" />
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export default function EditEmployeeDialog({ open, onOpenChange, employee, orgId, session, onSaved }) {
  const [form, setForm] = useState(() => buildInitialState(employee));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(buildInitialState(employee));
    }
  }, [employee, open]);

  const isInstructor = useMemo(() => form.employeeType === 'instructor', [form.employeeType]);

  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const toggleWorkingDay = (dayValue) => {
    setForm((prev) => {
      const workingDays = Array.isArray(prev.workingDays) ? prev.workingDays : [];
      const next = workingDays.includes(dayValue)
        ? workingDays.filter((item) => item !== dayValue)
        : [...workingDays, dayValue].sort((a, b) => a - b);
      return { ...prev, workingDays: next };
    });
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!employee?.id) {
      return;
    }

    setIsSaving(true);
    try {
      await authenticatedFetch('instructors', {
        session,
        method: 'PUT',
        body: {
          org_id: orgId,
          instructor_id: employee.id,
          employee_id: form.employeeId,
          employee_type: form.employeeType,
          first_name: form.firstName,
          middle_name: form.middleName || null,
          last_name: form.lastName || null,
          email: form.email || null,
          phone: form.phone || null,
          start_date: form.startDate || null,
          current_rate: form.currentRate === '' ? null : Number(form.currentRate),
          annual_leave_days: form.annualLeaveDays === '' ? null : Number(form.annualLeaveDays),
          leave_pay_method: form.leavePayMethod || null,
          leave_fixed_day_rate: form.leaveFixedDayRate === '' ? null : Number(form.leaveFixedDayRate),
          employment_scope: form.employmentScope || null,
          notes: form.notes || null,
          working_days: isInstructor ? form.workingDays : null,
          break_time_minutes: isInstructor && form.breakTimeMinutes !== '' ? Number(form.breakTimeMinutes) : null,
        },
      });

      toast.success('פרטי העובד עודכנו.');
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      console.error('Failed to update employee', error);
      toast.error(error?.message || 'עדכון פרטי העובד נכשל.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader className="text-end">
          <DialogTitle>עריכת עובד</DialogTitle>
          <DialogDescription>
            ניהול פרטי בסיס, סטטוס העסקה, תקשורת והגדרות מדריך מתוך חלון אחד.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 py-2">
          <Section
            title="כרטיס עובד"
            icon={UserRound}
            description="שדות זהות, סוג העובד ותיעוד בסיסי"
          >
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="employee_id" className="text-xs text-slate-600">מספר עובד / תעודה</Label>
                <Input id="employee_id" value={form.employeeId} onChange={(e) => updateField('employeeId', e.target.value)} disabled={isSaving} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-slate-600">סוג עובד</Label>
                <Select value={form.employeeType} onValueChange={(value) => updateField('employeeType', value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="בחר סוג עובד" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="instructor">מדריך/ה</SelectItem>
                    <SelectItem value="office">עובד/ת משרד</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="start_date" className="text-xs text-slate-600">תאריך התחלה</Label>
                <Input id="start_date" type="date" value={form.startDate} onChange={(e) => updateField('startDate', e.target.value)} disabled={isSaving} />
              </div>
            </div>
          </Section>

          <Section
            title="פרטים אישיים"
            icon={Mail}
            description="המידע שיופיע במערכת ובערוצי התקשורת"
          >
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="first_name" className="text-xs text-slate-600">שם פרטי</Label>
                <Input id="first_name" value={form.firstName} onChange={(e) => updateField('firstName', e.target.value)} disabled={isSaving} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="middle_name" className="text-xs text-slate-600">שם אמצעי</Label>
                <Input id="middle_name" value={form.middleName} onChange={(e) => updateField('middleName', e.target.value)} disabled={isSaving} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name" className="text-xs text-slate-600">שם משפחה</Label>
                <Input id="last_name" value={form.lastName} onChange={(e) => updateField('lastName', e.target.value)} disabled={isSaving} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-xs text-slate-600">דוא״ל</Label>
                <Input id="email" dir="ltr" value={form.email} onChange={(e) => updateField('email', e.target.value)} disabled={isSaving} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-xs text-slate-600">טלפון</Label>
                <Input id="phone" dir="ltr" value={form.phone} onChange={(e) => updateField('phone', e.target.value)} disabled={isSaving} />
              </div>
            </div>
          </Section>

          <Section
            title="העסקה וחופשות"
            icon={Calendar}
            description="תשתית לשכר וחופשות. בהמשך תתווסף שכבת דוחות וחישובים."
          >
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="employment_scope" className="text-xs text-slate-600">היקף העסקה</Label>
                <Input id="employment_scope" value={form.employmentScope} onChange={(e) => updateField('employmentScope', e.target.value)} disabled={isSaving} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="current_rate" className="text-xs text-slate-600">תעריף נוכחי</Label>
                <Input id="current_rate" type="number" min="0" step="0.01" value={form.currentRate} onChange={(e) => updateField('currentRate', e.target.value)} disabled={isSaving} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="annual_leave_days" className="text-xs text-slate-600">ימי חופשה שנתיים</Label>
                <Input id="annual_leave_days" type="number" min="0" step="0.5" value={form.annualLeaveDays} onChange={(e) => updateField('annualLeaveDays', e.target.value)} disabled={isSaving} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="leave_fixed_day_rate" className="text-xs text-slate-600">ערך יום חופשה</Label>
                <Input id="leave_fixed_day_rate" type="number" min="0" step="0.01" value={form.leaveFixedDayRate} onChange={(e) => updateField('leaveFixedDayRate', e.target.value)} disabled={isSaving} />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-slate-600">אופן תשלום חופשה</Label>
              <Select value={form.leavePayMethod || 'none'} onValueChange={(value) => updateField('leavePayMethod', value === 'none' ? '' : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="בחר שיטת תשלום" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">לא הוגדר</SelectItem>
                  <SelectItem value="monthly">חודשי</SelectItem>
                  <SelectItem value="hourly">שעתי</SelectItem>
                  <SelectItem value="daily">יומי</SelectItem>
                  <SelectItem value="fixed_day_rate">לפי ערך יום קבוע</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Section>

          <Section
            title="פרופיל מדריך"
            icon={Clock}
            description="הגדרות זמינות ותפעול שנוגעות למדריכים בלבד"
          >
            <div className="flex flex-wrap gap-2">
              {DAYS_OF_WEEK.map((day) => {
                const active = form.workingDays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleWorkingDay(day.value)}
                    disabled={!isInstructor || isSaving}
                    className={`min-w-[3rem] rounded-xl border px-3 py-2 text-sm transition ${
                      active
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-slate-200 bg-white text-slate-700'
                    } ${!isInstructor ? 'cursor-not-allowed opacity-50' : 'hover:border-blue-300'}`}
                  >
                    <div className="font-semibold">{day.short}</div>
                    <div className="text-[11px] opacity-80">{day.label}</div>
                  </button>
                );
              })}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="break_time_minutes" className="text-xs text-slate-600">משך הפסקה בדקות</Label>
                <Input
                  id="break_time_minutes"
                  type="number"
                  min="0"
                  step="5"
                  value={form.breakTimeMinutes}
                  onChange={(e) => updateField('breakTimeMinutes', e.target.value)}
                  disabled={!isInstructor || isSaving}
                />
              </div>
              <div className="flex items-end justify-end">
                <Badge variant={isInstructor ? 'default' : 'outline'} className="rounded-full px-3 py-1 text-xs">
                  {isInstructor ? 'מוגדר כמדריך/ה' : 'עובד/ת משרד - פרופיל מדריך כבוי'}
                </Badge>
              </div>
            </div>
          </Section>

          <Section title="הערות פנימיות" icon={Phone} description="מידע תפעולי פנימי עבור הארגון">
            <Textarea
              value={form.notes}
              onChange={(e) => updateField('notes', e.target.value)}
              disabled={isSaving}
              className="min-h-[110px]"
            />
          </Section>

          <div className="flex flex-row-reverse gap-2 border-t pt-4">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'שומר...' : 'שמור שינויים'}
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
