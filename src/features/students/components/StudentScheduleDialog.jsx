import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TextField, SelectField, DayOfWeekField, TimeField } from '@/components/ui/forms-ui';

const DEFAULT_SERVICE_ID = '00000000-0000-0000-0000-000000000000';
const DEFAULT_DURATION_MINUTES = 45;

function formatEmployeeName(employee) {
  if (!employee) return '';
  if (employee.name) return employee.name;
  const parts = [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean);
  return parts.join(' ').trim() || employee.email || '';
}

function formatTimeValue(value) {
  if (!value) return '';
  const text = String(value);
  if (/^\d{2}:\d{2}:\d{2}$/.test(text)) return text;
  if (/^\d{1,2}:\d{2}$/.test(text)) return `${text}:00`;
  return '';
}

function buildInitialState(template, defaultServiceId) {
  const dayOfWeek = typeof template?.day_of_week === 'number' ? template.day_of_week + 1 : null;
  return {
    instructorEmployeeId: template?.instructor_employee_id || '',
    serviceId: template?.service_id || defaultServiceId || DEFAULT_SERVICE_ID,
    dayOfWeek,
    timeOfDay: formatTimeValue(template?.time_of_day),
    durationMinutes: template?.duration_minutes || DEFAULT_DURATION_MINUTES,
    validFrom: template?.valid_from || new Date().toISOString().slice(0, 10),
    validUntil: template?.valid_until || '',
  };
}

export default function StudentScheduleDialog({
  open,
  onOpenChange,
  template,
  instructors = [],
  services = [],
  servicesLoading = false,
  servicesError = '',
  isSubmitting = false,
  error = '',
  onSubmit,
}) {
  const initialState = useMemo(() => buildInitialState(template, services?.[0]?.id), [template, services]);
  const [values, setValues] = useState(initialState);
  const [touched, setTouched] = useState({});

  useEffect(() => {
    if (open) {
      setValues(initialState);
      setTouched({});
    }
  }, [open, initialState]);

  const instructorOptions = useMemo(() => {
    return (instructors || []).filter((inst) => inst?.id).map((inst) => ({
      value: inst.id,
      label: formatEmployeeName(inst) || inst.id,
    }));
  }, [instructors]);

  const serviceOptions = useMemo(() => {
    return (services || []).filter((svc) => svc?.id).map((svc) => ({
      value: svc.id,
      label: svc.name || svc.id,
    }));
  }, [services]);

  const resolvedServiceOptions = serviceOptions.length
    ? serviceOptions
    : [{ value: DEFAULT_SERVICE_ID, label: 'תעריף כללי' }];

  const handleChange = (event) => {
    const { name, value } = event.target;
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleBlur = (event) => {
    const { name } = event.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    const nextTouched = {
      instructorEmployeeId: true,
      serviceId: true,
      dayOfWeek: true,
      timeOfDay: true,
      durationMinutes: true,
      validFrom: true,
    };
    setTouched(nextTouched);

    if (!values.instructorEmployeeId || !values.dayOfWeek || !values.timeOfDay || !values.validFrom) {
      return;
    }

    const duration = Number(values.durationMinutes);
    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }

    const normalizedDay = Number(values.dayOfWeek) - 1;
    if (Number.isNaN(normalizedDay) || normalizedDay < 0 || normalizedDay > 6) {
      return;
    }

    onSubmit?.({
      templateId: template?.id || null,
      instructorEmployeeId: values.instructorEmployeeId,
      serviceId: values.serviceId || DEFAULT_SERVICE_ID,
      dayOfWeek: normalizedDay,
      timeOfDay: values.timeOfDay,
      durationMinutes: duration,
      validFrom: values.validFrom,
      validUntil: values.validUntil || null,
    });
  };

  const showInstructorError = touched.instructorEmployeeId && !values.instructorEmployeeId;
  const showDayError = touched.dayOfWeek && !values.dayOfWeek;
  const showTimeError = touched.timeOfDay && !values.timeOfDay;
  const showDurationError = touched.durationMinutes && (!values.durationMinutes || Number(values.durationMinutes) <= 0);
  const showValidFromError = touched.validFrom && !values.validFrom;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>הגדרת שיבוץ ולו״ז</DialogTitle>
          <DialogDescription className="text-right">
            הגדירו מדריך, שירות ושעת מפגש לתלמיד. הפעולה יוצרת תבנית מפגש פעילה.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4" dir="rtl">
          <SelectField
            id="schedule-instructor"
            name="instructorEmployeeId"
            label="מדריך"
            value={values.instructorEmployeeId}
            onChange={(value) => handleSelectChange('instructorEmployeeId', value)}
            options={instructorOptions}
            placeholder="בחר מדריך"
            required
            disabled={isSubmitting}
            error={showInstructorError ? 'יש לבחור מדריך.' : ''}
          />

          <SelectField
            id="schedule-service"
            name="serviceId"
            label="שירות"
            value={values.serviceId}
            onChange={(value) => handleSelectChange('serviceId', value)}
            options={resolvedServiceOptions}
            placeholder={servicesLoading ? 'טוען...' : 'בחר שירות'}
            required
            disabled={isSubmitting || servicesLoading}
            description={servicesError ? servicesError : 'אם אין שירותים, ייבחר השירות הכללי.'}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <DayOfWeekField
              id="schedule-day"
              label="יום בשבוע"
              value={values.dayOfWeek}
              onChange={(value) => handleSelectChange('dayOfWeek', value)}
              required
              disabled={isSubmitting}
              error={showDayError ? 'יש לבחור יום.' : ''}
            />

            <TimeField
              id="schedule-time"
              name="timeOfDay"
              label="שעה"
              value={values.timeOfDay}
              onChange={(value) => handleSelectChange('timeOfDay', value)}
              required
              disabled={isSubmitting}
              error={showTimeError ? 'יש לבחור שעה.' : ''}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="schedule-duration"
              name="durationMinutes"
              label="משך (דקות)"
              type="number"
              min="15"
              step="5"
              value={values.durationMinutes}
              onChange={handleChange}
              onBlur={handleBlur}
              required
              disabled={isSubmitting}
              error={showDurationError ? 'יש להזין משך תקין.' : ''}
            />

            <TextField
              id="schedule-valid-from"
              name="validFrom"
              label="בתוקף מתאריך"
              type="date"
              value={values.validFrom}
              onChange={handleChange}
              onBlur={handleBlur}
              required
              disabled={isSubmitting}
              error={showValidFromError ? 'יש לבחור תאריך התחלה.' : ''}
            />
          </div>

          <TextField
            id="schedule-valid-until"
            name="validUntil"
            label="בתוקף עד (אופציונלי)"
            type="date"
            value={values.validUntil}
            onChange={handleChange}
            onBlur={handleBlur}
            disabled={isSubmitting}
          />

          <div className="flex justify-between gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange?.(false)} disabled={isSubmitting}>
              ביטול
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'שומר...' : 'שמור שיבוץ'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
