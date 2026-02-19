import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useState, useEffect } from 'react';
import { useOrg } from '@/org/OrgContext';
import { useStudents } from '@/hooks/useOrgData';
import { useCalendarInstructors } from '../../hooks/useCalendar';
import { useTemplateMutations } from '../../hooks/useTemplates';
import { Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ComboBoxField } from '@/components/ui/forms-ui';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useAuth } from '@/auth/AuthContext.jsx';

const DAYS_OF_WEEK = [
  { value: 0, label: 'ראשון' },
  { value: 1, label: 'שני' },
  { value: 2, label: 'שלישי' },
  { value: 3, label: 'רביעי' },
  { value: 4, label: 'חמישי' },
  { value: 5, label: 'שישי' },
  { value: 6, label: 'שבת' },
];

/**
 * AddTemplateDialog — Create a new lesson template
 * @param {{ open, onClose, onSuccess, defaultInstructorId?, defaultDayOfWeek? }} props
 */
export function AddTemplateDialog({ open, onClose, onSuccess, defaultInstructorId, defaultDayOfWeek }) {
  const { activeOrgId } = useOrg();
  const { session } = useAuth();
  const { instructors, isLoading: instructorsLoading } = useCalendarInstructors();
  const { createTemplate, isSubmitting } = useTemplateMutations();

  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);

  const { students, loadingStudents: studentsLoading } = useStudents({
    status: 'active',
    enabled: open && !!activeOrgId,
    orgId: activeOrgId,
  });

  const [formData, setFormData] = useState({
    student_id: '',
    instructor_employee_id: defaultInstructorId || '',
    service_id: '',
    day_of_week: defaultDayOfWeek ?? '',
    time_of_day: '09:00',
    duration_minutes: 60,
    valid_from: new Date().toISOString().split('T')[0],
    valid_until: '',
  });

  const [error, setError] = useState(null);

  // Reset form when dialog opens with defaults
  useEffect(() => {
    if (open) {
      setFormData({
        student_id: '',
        instructor_employee_id: defaultInstructorId || '',
        service_id: '',
        day_of_week: defaultDayOfWeek ?? '',
        time_of_day: '09:00',
        duration_minutes: 60,
        valid_from: new Date().toISOString().split('T')[0],
        valid_until: '',
      });
      setError(null);
    }
  }, [open, defaultInstructorId, defaultDayOfWeek]);

  // Fetch services
  useEffect(() => {
    if (!open || !activeOrgId || !session) return;
    let isMounted = true;

    async function fetchServices() {
      setServicesLoading(true);
      try {
        const payload = await authenticatedFetch('services', {
          session,
          params: { org_id: activeOrgId },
        });
        if (isMounted) setServices(Array.isArray(payload) ? payload : []);
      } catch {
        if (isMounted) setServices([]);
      } finally {
        if (isMounted) setServicesLoading(false);
      }
    }

    fetchServices();
    return () => { isMounted = false; };
  }, [open, activeOrgId, session]);

  // Auto-fill service/instructor from student defaults
  useEffect(() => {
    if (!formData.student_id) return;
    const student = students.find((s) => s.id === formData.student_id);
    if (!student) return;

    const serviceIds = new Set((services || []).map((s) => String(s?.id || '')));
    const instructorIds = new Set((instructors || []).map((i) => String(i?.id || '')));

    setFormData((prev) => ({
      ...prev,
      service_id:
        student.service_id && serviceIds.has(String(student.service_id))
          ? String(student.service_id)
          : prev.service_id,
      instructor_employee_id:
        !prev.instructor_employee_id && student.assigned_instructor_id && instructorIds.has(String(student.assigned_instructor_id))
          ? String(student.assigned_instructor_id)
          : prev.instructor_employee_id,
    }));
  }, [formData.student_id, students, services, instructors]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!formData.student_id) {
      setError('יש לבחור תלמיד');
      return;
    }
    if (!formData.instructor_employee_id) {
      setError('יש לבחור מדריך');
      return;
    }
    if (!formData.service_id) {
      setError('יש לבחור שירות');
      return;
    }
    if (formData.day_of_week === '' || formData.day_of_week === null) {
      setError('יש לבחור יום');
      return;
    }

    const { error: apiError } = await createTemplate({
      student_id: formData.student_id,
      instructor_employee_id: formData.instructor_employee_id,
      service_id: formData.service_id,
      day_of_week: Number(formData.day_of_week),
      time_of_day: formData.time_of_day,
      duration_minutes: Number(formData.duration_minutes),
      valid_from: formData.valid_from,
      valid_until: formData.valid_until || null,
    });

    if (apiError) {
      setError(apiError);
      return;
    }

    onSuccess?.();
    onClose();
  }

  const studentOptions = (students || []).map((s) => ({
    value: s.id,
    label: `${s.first_name || ''} ${s.middle_name || ''} ${s.last_name || ''}`.trim() || 'ללא שם',
    searchText: `${s.first_name || ''} ${s.middle_name || ''} ${s.last_name || ''} ${s.identity_number || ''}`.toLowerCase(),
  }));

  const activeServices = (services || []).filter((s) => s?.is_active === true);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>תבנית חדשה</DialogTitle>
          <DialogDescription className="sr-only">יצירת תבנית שיעור שבועית קבועה.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Student */}
          <div>
            <Label htmlFor="template-student">תלמיד *</Label>
            {studentsLoading ? (
              <div className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                טוען תלמידים...
              </div>
            ) : (
              <ComboBoxField
                id="template-student"
                options={studentOptions}
                value={formData.student_id}
                onChange={(value) => setFormData((prev) => ({ ...prev, student_id: value }))}
                placeholder="חפש תלמיד..."
                emptyText="לא נמצאו תלמידים"
              />
            )}
          </div>

          {/* Instructor */}
          <div>
            <Label htmlFor="template-instructor">מדריך *</Label>
            {instructorsLoading ? (
              <div className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                <Loader2 className="h-3 w-3 animate-spin" />
              </div>
            ) : (
              <Select
                value={formData.instructor_employee_id}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, instructor_employee_id: value }))}
              >
                <SelectTrigger id="template-instructor">
                  <SelectValue placeholder="בחר מדריך" />
                </SelectTrigger>
                <SelectContent>
                  {(instructors || []).map((inst) => (
                    <SelectItem key={inst.id} value={inst.id}>
                      {[inst.first_name, inst.middle_name, inst.last_name].filter(Boolean).join(' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Service */}
          <div>
            <Label htmlFor="template-service">שירות *</Label>
            {servicesLoading ? (
              <div className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                <Loader2 className="h-3 w-3 animate-spin" />
              </div>
            ) : (
              <Select
                value={formData.service_id}
                onValueChange={(value) => {
                  const svc = activeServices.find((s) => s.id === value);
                  setFormData((prev) => ({
                    ...prev,
                    service_id: value,
                    duration_minutes: svc?.duration_minutes || prev.duration_minutes,
                  }));
                }}
              >
                <SelectTrigger id="template-service">
                  <SelectValue placeholder="בחר שירות" />
                </SelectTrigger>
                <SelectContent>
                  {activeServices.map((svc) => (
                    <SelectItem key={svc.id} value={svc.id}>
                      {svc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Day of week */}
          <div>
            <Label htmlFor="template-day">יום בשבוע *</Label>
            <Select
              value={formData.day_of_week !== '' && formData.day_of_week !== null ? String(formData.day_of_week) : undefined}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, day_of_week: Number(value) }))}
            >
              <SelectTrigger id="template-day">
                <SelectValue placeholder="בחר יום" />
              </SelectTrigger>
              <SelectContent>
                {DAYS_OF_WEEK.map((day) => (
                  <SelectItem key={day.value} value={String(day.value)}>
                    {day.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="template-time">שעה *</Label>
              <Input
                id="template-time"
                type="time"
                value={formData.time_of_day}
                onChange={(e) => setFormData((prev) => ({ ...prev, time_of_day: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label htmlFor="template-duration">משך (דקות) *</Label>
              <Input
                id="template-duration"
                type="number"
                min={15}
                max={480}
                step={15}
                value={formData.duration_minutes}
                onChange={(e) => setFormData((prev) => ({ ...prev, duration_minutes: Number(e.target.value) || 60 }))}
                required
              />
            </div>
          </div>

          {/* Validity range */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="template-valid-from">תוקף מ- *</Label>
              <Input
                id="template-valid-from"
                type="date"
                value={formData.valid_from}
                onChange={(e) => setFormData((prev) => ({ ...prev, valid_from: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label htmlFor="template-valid-until">תוקף עד (אופציונלי)</Label>
              <Input
                id="template-valid-until"
                type="date"
                value={formData.valid_until}
                onChange={(e) => setFormData((prev) => ({ ...prev, valid_until: e.target.value }))}
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              ביטול
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
              צור תבנית
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
