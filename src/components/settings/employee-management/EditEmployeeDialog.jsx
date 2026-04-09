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
import { toShekel, toAgorot } from '@/lib/currency.js';

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
  const employeeType = deriveEmployeeType(employee);
  const payrollModel = employee?.payroll_model || (employeeType === 'instructor' ? 'lesson_based' : 'hourly');
  return {
    employeeId: employee?.employee_id || '',
    employeeType,
    payrollModel,
    sourceType: employeeType,
    firstName: employee?.first_name || '',
    middleName: employee?.middle_name || '',
    lastName: employee?.last_name || '',
    email: employee?.email || '',
    phone: employee?.phone || '',
    startDate: employee?.start_date || '',
    currentRate: employee?.current_rate != null ? toShekel(employee.current_rate) : '',
    monthlySalaryAmount: employee?.monthly_salary_amount != null ? toShekel(employee.monthly_salary_amount) : '',
    annualLeaveDays: employee?.annual_leave_days ?? '',
    leavePayMethod: employee?.leave_pay_method || '',
    leaveFixedDayRate: employee?.leave_fixed_day_rate != null ? toShekel(employee.leave_fixed_day_rate) : '',
    employmentScope: employee?.employment_scope || '',
    notes: employee?.notes || '',
    officeWorkingDays: employeeType === 'office' && Array.isArray(employee?.working_days) ? employee.working_days : [],
    conversionBreakTimeMinutes: employee?.instructor_profile?.break_time_minutes ?? '',
    conversionCapabilities: Array.isArray(employee?.service_capabilities)
      ? employee.service_capabilities.map((capability) => ({
          service_id: capability.service_id,
          max_students: capability.max_students ?? 1,
          base_rate: capability.base_rate != null ? toShekel(capability.base_rate) : '',
          availability_windows: Array.isArray(capability?.availability_windows) ? capability.availability_windows : [],
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

function getSelectableServices(services, capabilities, index) {
  const currentServiceId = capabilities[index]?.service_id || '';
  return services.filter((service) => {
    if (!service?.id) {
      return false;
    }
    const isCurrentSelection = service.id === currentServiceId;
    const assignedElsewhere = capabilities.some(
      (capability, capabilityIndex) => capabilityIndex !== index && capability.service_id === service.id
    );
    if (assignedElsewhere) {
      return false;
    }
    if (service?.is_active === false && !isCurrentSelection) {
      return false;
    }
    return true;
  });
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

  const addConversionCapability = () => {
    const existingIds = new Set(form.conversionCapabilities.map((capability) => capability.service_id).filter(Boolean));
    const hasUnselectedRow = form.conversionCapabilities.some((capability) => !capability.service_id);
    const remainingServices = availableServices.filter((service) => !existingIds.has(service.id));

    if (hasUnselectedRow) {
      toast.error('בחר שירות בשורה הפתוחה לפני הוספת שורה נוספת.');
      return;
    }

    if (remainingServices.length === 0) {
      toast.error('כל השירותים הזמינים כבר הוגדרו.');
      return;
    }

    setForm((prev) => ({
      ...prev,
      conversionCapabilities: [
        ...prev.conversionCapabilities,
        {
          service_id: '',
          max_students: 1,
          base_rate: 0,
          availability_windows: [],
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
        payroll_model: form.payrollModel,
        first_name: form.firstName,
        middle_name: form.middleName || null,
        last_name: form.lastName || null,
        email: form.email || null,
        phone: form.phone || null,
        start_date: form.startDate || null,
        current_rate: form.currentRate === '' ? null : toAgorot(form.currentRate),
        monthly_salary_amount: form.monthlySalaryAmount === '' ? null : toAgorot(form.monthlySalaryAmount),
        annual_leave_days: form.annualLeaveDays === '' ? null : Number(form.annualLeaveDays),
        leave_pay_method: form.leavePayMethod || null,
        leave_fixed_day_rate: form.leaveFixedDayRate === '' ? null : toAgorot(form.leaveFixedDayRate),
        employment_scope: form.employmentScope || null,
        notes: form.notes || null,
      };

      if (isOfficeEditing) {
        payload.working_days = form.officeWorkingDays;
      }

      if (isRoleConversion) {
        payload.break_time_minutes = form.conversionBreakTimeMinutes === '' ? null : Number(form.conversionBreakTimeMinutes);
        payload.service_capabilities = form.conversionCapabilities.map((capability) => ({
          service_id: capability.service_id,
          max_students: capability.max_students === '' ? 1 : Number(capability.max_students),
          base_rate: capability.base_rate === '' ? 0 : toAgorot(capability.base_rate),
          availability_windows: Array.isArray(capability.availability_windows) ? capability.availability_windows : [],
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
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="employee_id" className="text-xs text-slate-600">מספר עובד / תעודה</Label>
                <Input id="employee_id" value={form.employeeId} onChange={(e) => updateField('employeeId', e.target.value)} disabled={isSaving} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-slate-600">סוג עובד</Label>
                <Select
                  value={form.employeeType}
                  onValueChange={(value) => {
                    updateField('employeeType', value);
                    if (value === 'instructor') {
                      updateField('payrollModel', 'lesson_based');
                    } else if (form.payrollModel === 'lesson_based') {
                      updateField('payrollModel', 'hourly');
                    }
                  }}
                >
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
                <Label className="text-xs text-slate-600">מודל שכר</Label>
                <Select
                  value={form.employeeType === 'instructor' ? 'lesson_based' : form.payrollModel}
                  onValueChange={(value) => updateField('payrollModel', value)}
                  disabled={isSaving || form.employeeType === 'instructor'}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="בחר מודל שכר" />
                  </SelectTrigger>
                  <SelectContent>
                    {form.employeeType === 'instructor' ? (
                      <SelectItem value="lesson_based">מבוסס שיעורים</SelectItem>
                    ) : (
                      <>
                        <SelectItem value="hourly">שעתי</SelectItem>
                        <SelectItem value="monthly_salary">שכר חודשי</SelectItem>
                      </>
                    )}
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
                שינוי התפקיד למדריך יישמר רק לאחר השלמת השירותים הבסיסיים בחלק ההמרה שלמטה. את חלונות הזמינות לשירות מגדירים מיד לאחר מכן במסך השירותים והזמינות.
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

          {isOfficeEditing ? (
          <Section
            title="פרטי העסקה"
            icon={Calendar}
            description="פרטי העסקה בסיסיים וזמינות שבועית לעובדי משרד"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs text-slate-600">היקף העסקה</Label>
                <Select value={form.employmentScope || ''} onValueChange={(value) => updateField('employmentScope', value)} disabled={isSaving}>
                  <SelectTrigger id="employment_scope">
                    <SelectValue placeholder="בחר היקף" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="משרה מלאה">משרה מלאה</SelectItem>
                    <SelectItem value="75% משרה">75% משרה</SelectItem>
                    <SelectItem value="חצי משרה">חצי משרה</SelectItem>
                    <SelectItem value="25% משרה">25% משרה</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.payrollModel === 'monthly_salary' ? (
                <div className="space-y-2">
                  <Label htmlFor="monthly_salary_amount" className="text-xs text-slate-600">שכר חודשי</Label>
                  <Input id="monthly_salary_amount" type="number" min="0" step="0.01" value={form.monthlySalaryAmount} onChange={(e) => updateField('monthlySalaryAmount', e.target.value)} disabled={isSaving} />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="current_rate" className="text-xs text-slate-600">תעריף שעתי</Label>
                  <Input id="current_rate" type="number" min="0" step="0.01" value={form.currentRate} onChange={(e) => updateField('currentRate', e.target.value)} disabled={isSaving} />
                </div>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="annual_leave_days" className="text-xs text-slate-600">מכסת חופשה שנתית</Label>
                <Input id="annual_leave_days" type="number" min="0" step="0.5" value={form.annualLeaveDays} onChange={(e) => updateField('annualLeaveDays', e.target.value)} disabled={isSaving} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-slate-600">שיטת תשלום חופשה</Label>
                <Select value={form.leavePayMethod || '__default__'} onValueChange={(value) => updateField('leavePayMethod', value === '__default__' ? '' : value)} disabled={isSaving}>
                  <SelectTrigger>
                    <SelectValue placeholder="ברירת מחדל ארגונית" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">ברירת מחדל ארגונית</SelectItem>
                    <SelectItem value="legal">ממוצע חוקי</SelectItem>
                    <SelectItem value="avg_hourly_x_avg_day_hours">ממוצע היסטורי</SelectItem>
                    <SelectItem value="fixed_rate">ערך קבוע</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="leave_fixed_day_rate" className="text-xs text-slate-600">ערך חופשה קבוע</Label>
                <Input id="leave_fixed_day_rate" type="number" min="0" step="0.01" value={form.leaveFixedDayRate} onChange={(e) => updateField('leaveFixedDayRate', e.target.value)} disabled={isSaving} />
              </div>
            </div>

            {isOfficeEditing ? (
              <div className="space-y-3">
                <div className="text-xs font-medium text-slate-600">ימי עבודה שבועיים</div>
                <WorkingDaysPicker value={form.officeWorkingDays} onToggle={toggleOfficeWorkingDay} disabled={isSaving} />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">
                לעובדי הדרכה זמינות תפעולית מנוהלת ברמת השירות, ולא דרך כרטיס העובד הכללי.
              </div>
            )}
          </Section>
          ) : null}

          {isRoleConversion ? (
            <Section
              title="המרה למדריך"
              icon={Briefcase}
              description="השלם שירותים למדריך. זמינות לפי שירות מוגדרת לאחר ההמרה במסך השירותים והזמינות."
            >
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
                    נדרש לפחות שירות אחד כדי להשלים את ההמרה למדריך. לאחר השמירה יש להגדיר זמינות לפי שירות.
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
                            value={capability.service_id || undefined}
                            onValueChange={(value) => updateConversionCapability(index, 'service_id', value)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="בחר שירות" />
                            </SelectTrigger>
                            <SelectContent>
                              {getSelectableServices(availableServices, form.conversionCapabilities, index).map((service) => (
                                <SelectItem key={service.id} value={service.id}>
                                  {service.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="text-[11px] text-slate-500">
                            `Services` מגדיר את התקן הארגוני. כאן מגדירים את ההחרגה לעובד: כמה תלמידים יוכל ללמד ומה יהיה התעריף שלו.
                          </div>
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
