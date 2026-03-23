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
import { Briefcase, Calendar, Mail, Trash2, UserRound } from 'lucide-react';
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

function getSourceWorkingDays(employee) {
  if (deriveEmployeeType(employee) === 'instructor') {
    return Array.isArray(employee?.instructor_profile?.working_days) ? employee.instructor_profile.working_days : [];
  }
  return Array.isArray(employee?.working_days) ? employee.working_days : [];
}

function buildInitialState(employee) {
  const employeeType = deriveEmployeeType(employee);
  return {
    employeeId: employee?.employee_id || '',
    employeeType,
    sourceType: employeeType,
    firstName: employee?.first_name || '',
    middleName: employee?.middle_name || '',
    lastName: employee?.last_name || '',
    email: employee?.email || '',
    phone: employee?.phone || '',
    startDate: employee?.start_date || '',
    currentRate: employee?.current_rate ?? '',
    employmentScope: employee?.employment_scope || '',
    notes: employee?.notes || '',
    officeWorkingDays: employeeType === 'office' ? getSourceWorkingDays(employee) : [],
    conversionWorkingDays: employeeType === 'instructor' ? getSourceWorkingDays(employee) : [],
    conversionBreakTimeMinutes: employee?.instructor_profile?.break_time_minutes ?? '',
    conversionCapabilities: Array.isArray(employee?.service_capabilities)
      ? employee.service_capabilities.map((capability) => ({
          service_id: capability.service_id,
          max_students: capability.max_students ?? 1,
          base_rate: capability.base_rate ?? 0,
          metadata: capability.metadata || {},
        }))
      : [],
  };
}

function Section({ title, icon: Icon, description, children }) {
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
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

function WorkingDaysPicker({ value, onToggle, disabled }) {
  return (
    <div className="flex flex-wrap gap-2">
      {DAYS_OF_WEEK.map((day) => {
        const active = value.includes(day.value);
        return (
          <button
            key={day.value}
            type="button"
            onClick={() => onToggle(day.value)}
            disabled={disabled}
            className={`min-w-[3rem] rounded-xl border px-3 py-2 text-sm transition ${
              active
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-slate-200 bg-white text-slate-700'
            } ${disabled ? 'cursor-not-allowed opacity-50' : 'hover:border-blue-300'}`}
          >
            <div className="font-semibold">{day.short}</div>
            <div className="text-[11px] opacity-80">{day.label}</div>
          </button>
        );
      })}
    </div>
  );
}

function getServiceName(services, serviceId) {
  return services.find((service) => service.id === serviceId)?.name || 'שירות';
}

export default function EditEmployeeDialog({
  open,
  onOpenChange,
  employee,
  orgId,
  session,
  availableServices = [],
  onSaved,
}) {
  const [form, setForm] = useState(() => buildInitialState(employee));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(buildInitialState(employee));
    }
  }, [employee, open]);

  const isRoleConversion = useMemo(
    () => form.sourceType !== 'instructor' && form.employeeType === 'instructor',
    [form.employeeType, form.sourceType],
  );
  const isOfficeEditing = useMemo(() => form.employeeType === 'office', [form.employeeType]);

  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const toggleOfficeWorkingDay = (dayValue) => {
    setForm((prev) => {
      const current = Array.isArray(prev.officeWorkingDays) ? prev.officeWorkingDays : [];
      const next = current.includes(dayValue)
        ? current.filter((item) => item !== dayValue)
        : [...current, dayValue].sort((a, b) => a - b);
      return { ...prev, officeWorkingDays: next };
    });
  };

  const toggleConversionWorkingDay = (dayValue) => {
    setForm((prev) => {
      const current = Array.isArray(prev.conversionWorkingDays) ? prev.conversionWorkingDays : [];
      const next = current.includes(dayValue)
        ? current.filter((item) => item !== dayValue)
        : [...current, dayValue].sort((a, b) => a - b);
      return { ...prev, conversionWorkingDays: next };
    });
  };

  const addConversionCapability = () => {
    const existingIds = new Set(form.conversionCapabilities.map((capability) => capability.service_id));
    const nextService = availableServices.find((service) => !existingIds.has(service.id));
    if (!nextService) {
      toast.error('כל השירותים הזמינים כבר הוגדרו.');
      return;
    }

    setForm((prev) => ({
      ...prev,
      conversionCapabilities: [
        ...prev.conversionCapabilities,
        {
          service_id: nextService.id,
          max_students: 1,
          base_rate: 0,
          metadata: {},
        },
      ],
    }));
  };

  const updateConversionCapability = (index, field, value) => {
    setForm((prev) => {
      const next = [...prev.conversionCapabilities];
      next[index] = { ...next[index], [field]: value };
      return { ...prev, conversionCapabilities: next };
    });
  };

  const removeConversionCapability = (index) => {
    setForm((prev) => ({
      ...prev,
      conversionCapabilities: prev.conversionCapabilities.filter((_, capabilityIndex) => capabilityIndex !== index),
    }));
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!employee?.id) {
      return;
    }

    if (isRoleConversion) {
      if (form.conversionWorkingDays.length === 0) {
        toast.error('נדרש להגדיר ימי עבודה למדריך לפני שינוי התפקיד.');
        return;
      }
      if (form.conversionCapabilities.length === 0) {
        toast.error('נדרש להגדיר לפחות שירות אחד לפני שינוי התפקיד.');
        return;
      }
      const hasDuplicateService = new Set(form.conversionCapabilities.map((capability) => capability.service_id)).size !== form.conversionCapabilities.length;
      if (hasDuplicateService || form.conversionCapabilities.some((capability) => !capability.service_id)) {
        toast.error('יש להשלים שירותים ייחודיים למדריך.');
        return;
      }
    }

    setIsSaving(true);
    try {
      const payload = {
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
        employment_scope: form.employmentScope || null,
        notes: form.notes || null,
      };

      if (isOfficeEditing) {
        payload.working_days = form.officeWorkingDays;
      }

      if (isRoleConversion) {
        payload.working_days = form.conversionWorkingDays;
        payload.break_time_minutes = form.conversionBreakTimeMinutes === '' ? null : Number(form.conversionBreakTimeMinutes);
        payload.service_capabilities = form.conversionCapabilities.map((capability) => ({
          service_id: capability.service_id,
          max_students: capability.max_students === '' ? 1 : Number(capability.max_students),
          base_rate: capability.base_rate === '' ? 0 : Number(capability.base_rate),
          metadata: capability.metadata || {},
        }));
      }

      await authenticatedFetch('instructors', {
        session,
        method: 'PUT',
        body: payload,
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

  const canAddMoreServices = form.conversionCapabilities.length < availableServices.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>עריכת עובד</DialogTitle>
          <DialogDescription>
            ניהול פרטי בסיס וזמינות שבועית. שירותים וזמינות מדריך מנוהלים בנפרד, למעט המרה מודרכת ממשרד למדריך.
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
            {isRoleConversion ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">
                שינוי התפקיד למדריך יישמר רק לאחר השלמת ימי העבודה והשירותים בחלק ההמרה שלמטה.
              </div>
            ) : null}
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
            title="העסקה"
            icon={Calendar}
            description="פרטי העסקה בסיסיים וזמינות שבועית לעובדי משרד"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="employment_scope" className="text-xs text-slate-600">היקף העסקה</Label>
                <Input id="employment_scope" value={form.employmentScope} onChange={(e) => updateField('employmentScope', e.target.value)} disabled={isSaving} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="current_rate" className="text-xs text-slate-600">תעריף נוכחי</Label>
                <Input id="current_rate" type="number" min="0" step="0.01" value={form.currentRate} onChange={(e) => updateField('currentRate', e.target.value)} disabled={isSaving} />
              </div>
            </div>

            {isOfficeEditing ? (
              <div className="space-y-3">
                <div className="text-xs font-medium text-slate-600">ימי עבודה שבועיים</div>
                <WorkingDaysPicker value={form.officeWorkingDays} onToggle={toggleOfficeWorkingDay} disabled={isSaving} />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">
                ימי העבודה למדריכים מנוהלים דרך פרופיל המדריך, למעט בהמרה ממשרד למדריך.
              </div>
            )}
          </Section>

          {isRoleConversion ? (
            <Section
              title="המרה למדריך"
              icon={Briefcase}
              description="השלם זמינות מדריך ושירותים באותו תהליך לפני שינוי התפקיד"
            >
              <div className="space-y-3">
                <div className="text-xs font-medium text-slate-600">ימי עבודה למדריך</div>
                <WorkingDaysPicker value={form.conversionWorkingDays} onToggle={toggleConversionWorkingDay} disabled={isSaving} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="break_time_minutes" className="text-xs text-slate-600">משך הפסקה בין שיעורים (דקות)</Label>
                <Input
                  id="break_time_minutes"
                  type="number"
                  min="0"
                  step="5"
                  value={form.conversionBreakTimeMinutes}
                  onChange={(e) => updateField('conversionBreakTimeMinutes', e.target.value)}
                  disabled={isSaving}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-slate-600">שירותים שהמדריך יכול לספק</div>
                  <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
                    {form.conversionCapabilities.length} שירותים
                  </Badge>
                </div>

                {form.conversionCapabilities.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">
                    נדרש לפחות שירות אחד כדי להשלים את ההמרה למדריך.
                  </div>
                ) : null}

                <div className="space-y-3">
                  {form.conversionCapabilities.map((capability, index) => (
                    <div key={`${capability.service_id || 'new'}-${index}`} className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <div className="min-w-0 text-sm font-semibold text-slate-900">
                          {capability.service_id ? getServiceName(availableServices, capability.service_id) : 'שירות חדש'}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeConversionCapability(index)}
                          disabled={isSaving}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="space-y-2">
                          <Label className="text-xs text-slate-600">שירות</Label>
                          <Select
                            value={capability.service_id}
                            onValueChange={(value) => updateConversionCapability(index, 'service_id', value)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="בחר שירות" />
                            </SelectTrigger>
                            <SelectContent>
                              {availableServices.map((service) => (
                                <SelectItem key={service.id} value={service.id}>
                                  {service.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-slate-600">מספר תלמידים מקסימלי</Label>
                          <Input
                            type="number"
                            min="1"
                            value={capability.max_students}
                            onChange={(e) => updateConversionCapability(index, 'max_students', e.target.value)}
                            disabled={isSaving}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-slate-600">תעריף בסיס</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={capability.base_rate}
                            onChange={(e) => updateConversionCapability(index, 'base_rate', e.target.value)}
                            disabled={isSaving}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {canAddMoreServices ? (
                  <Button type="button" variant="outline" onClick={addConversionCapability} disabled={isSaving}>
                    הוסף שירות
                  </Button>
                ) : null}
              </div>
            </Section>
          ) : null}

          <Section title="הערות פנימיות" icon={Mail} description="מידע תפעולי פנימי עבור הארגון">
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
