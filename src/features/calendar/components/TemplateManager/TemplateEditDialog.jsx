import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useState, useEffect } from 'react';
import { useOrg } from '@/org/OrgContext';
import { useCalendarInstructors } from '../../hooks/useCalendar';
import { useTemplateMutations } from '../../hooks/useTemplates';
import { Loader2, AlertCircle, Trash2, Pencil, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
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

function formatTime(timeString) {
  if (!timeString) return '';
  const parts = String(timeString).split(':');
  return `${parts[0]}:${parts[1]}`;
}

function getPersonName(person) {
  if (!person) return '—';
  return [person.first_name, person.middle_name, person.last_name].filter(Boolean).join(' ');
}

/**
 * TemplateEditDialog — View / Edit / Delete an existing template
 * @param {{ template, open, onClose, onUpdate }} props
 */
export function TemplateEditDialog({ template, open, onClose, onUpdate }) {
  const { activeOrgId } = useOrg();
  const { session } = useAuth();
  const { instructors, isLoading: instructorsLoading } = useCalendarInstructors();
  const { updateTemplate, deleteTemplate, isSubmitting } = useTemplateMutations();

  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);

  const [formData, setFormData] = useState({
    instructor_employee_id: '',
    service_id: '',
    day_of_week: 0,
    time_of_day: '09:00',
    duration_minutes: 60,
    valid_from: '',
    valid_until: '',
  });

  const [error, setError] = useState(null);

  // Populate form from template
  useEffect(() => {
    if (template && open) {
      setFormData({
        instructor_employee_id: template.instructor_employee_id || '',
        service_id: template.service_id || '',
        day_of_week: template.day_of_week ?? 0,
        time_of_day: formatTime(template.time_of_day) || '09:00',
        duration_minutes: template.duration_minutes || 60,
        valid_from: template.valid_from || '',
        valid_until: template.valid_until || '',
      });
      setIsEditing(false);
      setShowDeleteConfirm(false);
      setError(null);
    }
  }, [template, open]);

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

  if (!template) return null;

  const studentName = getPersonName(template.student);
  const instructorName = getPersonName(template.instructor);
  const serviceName = template.service?.name || '—';
  const dayLabel = DAYS_OF_WEEK.find((d) => d.value === template.day_of_week)?.label || '—';
  const activeServices = (services || []).filter((s) => s?.is_active === true);

  async function handleSave() {
    setError(null);

    const updates = {};

    if (formData.instructor_employee_id !== template.instructor_employee_id) {
      updates.instructor_employee_id = formData.instructor_employee_id;
    }
    if (formData.service_id !== template.service_id) {
      updates.service_id = formData.service_id;
    }
    if (Number(formData.day_of_week) !== template.day_of_week) {
      updates.day_of_week = Number(formData.day_of_week);
    }
    if (formData.time_of_day !== formatTime(template.time_of_day)) {
      updates.time_of_day = formData.time_of_day;
    }
    if (Number(formData.duration_minutes) !== template.duration_minutes) {
      updates.duration_minutes = Number(formData.duration_minutes);
    }
    if (formData.valid_from !== (template.valid_from || '')) {
      updates.valid_from = formData.valid_from;
    }
    if (formData.valid_until !== (template.valid_until || '')) {
      updates.valid_until = formData.valid_until || null;
    }

    if (Object.keys(updates).length === 0) {
      setIsEditing(false);
      return;
    }

    const { error: apiError } = await updateTemplate(template.id, updates);

    if (apiError) {
      setError(apiError);
      return;
    }

    setIsEditing(false);
    onUpdate?.();
    onClose();
  }

  async function handleDelete() {
    setError(null);
    const { error: apiError } = await deleteTemplate(template.id);

    if (apiError) {
      setError(apiError);
      return;
    }

    onUpdate?.();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'עריכת תבנית' : 'פרטי תבנית'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isEditing ? 'ערוך את פרטי התבנית.' : 'צפה בפרטי התבנית.'}
          </DialogDescription>
        </DialogHeader>

        {/* View Mode */}
        {!isEditing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <span className="text-gray-500">תלמיד:</span>
              <span className="font-medium">{studentName}</span>

              <span className="text-gray-500">מדריך:</span>
              <span className="font-medium">{instructorName}</span>

              <span className="text-gray-500">שירות:</span>
              <span className="font-medium">{serviceName}</span>

              <span className="text-gray-500">יום:</span>
              <span className="font-medium">{dayLabel}</span>

              <span className="text-gray-500">שעה:</span>
              <span className="font-medium">{formatTime(template.time_of_day)}</span>

              <span className="text-gray-500">משך:</span>
              <span className="font-medium">{template.duration_minutes} דקות</span>

              <span className="text-gray-500">תוקף מ:</span>
              <span className="font-medium">{template.valid_from || '—'}</span>

              <span className="text-gray-500">תוקף עד:</span>
              <span className="font-medium">{template.valid_until || 'ללא הגבלה'}</span>

              <span className="text-gray-500">סטטוס:</span>
              <span className={template.is_active ? 'text-green-600 font-medium' : 'text-red-500 font-medium'}>
                {template.is_active ? 'פעיל' : 'לא פעיל'}
              </span>
            </div>

            {/* Delete confirmation */}
            {showDeleteConfirm && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="mb-2">האם לבטל תבנית זו? התבנית תסומן כלא פעילה.</div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" onClick={handleDelete} disabled={isSubmitting}>
                      {isSubmitting && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
                      אישור ביטול
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowDeleteConfirm(false)} disabled={isSubmitting}>
                      חזרה
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <div className="flex items-center gap-2 w-full justify-between">
                <div className="flex gap-2">
                  {template.is_active && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                        <Pencil className="h-4 w-4 ml-1" />
                        עריכה
                      </Button>
                      <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => setShowDeleteConfirm(true)}>
                        <Trash2 className="h-4 w-4 ml-1" />
                        ביטול תבנית
                      </Button>
                    </>
                  )}
                </div>
                <Button variant="outline" onClick={onClose}>
                  סגור
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}

        {/* Edit Mode */}
        {isEditing && (
          <div className="space-y-4">
            {/* Student (read-only in edit) */}
            <div>
              <Label>תלמיד</Label>
              <Input value={studentName} disabled className="bg-gray-50" />
            </div>

            {/* Instructor */}
            <div>
              <Label htmlFor="edit-instructor">מדריך *</Label>
              {instructorsLoading ? (
                <div className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                </div>
              ) : (
                <Select
                  value={formData.instructor_employee_id}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, instructor_employee_id: value }))}
                >
                  <SelectTrigger id="edit-instructor">
                    <SelectValue placeholder="בחר מדריך" />
                  </SelectTrigger>
                  <SelectContent>
                    {(instructors || []).map((inst) => (
                      <SelectItem key={inst.id} value={inst.id}>
                        {getPersonName(inst)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Service */}
            <div>
              <Label htmlFor="edit-service">שירות *</Label>
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
                  <SelectTrigger id="edit-service">
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
              <Label htmlFor="edit-day">יום בשבוע *</Label>
              <Select
                value={String(formData.day_of_week)}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, day_of_week: Number(value) }))}
              >
                <SelectTrigger id="edit-day">
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

            {/* Time + Duration */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-time">שעה *</Label>
                <Input
                  id="edit-time"
                  type="time"
                  value={formData.time_of_day}
                  onChange={(e) => setFormData((prev) => ({ ...prev, time_of_day: e.target.value }))}
                  required
                />
              </div>
              <div>
                <Label htmlFor="edit-duration">משך (דקות) *</Label>
                <Input
                  id="edit-duration"
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
                <Label htmlFor="edit-valid-from">תוקף מ-</Label>
                <Input
                  id="edit-valid-from"
                  type="date"
                  value={formData.valid_from}
                  onChange={(e) => setFormData((prev) => ({ ...prev, valid_from: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="edit-valid-until">תוקף עד</Label>
                <Input
                  id="edit-valid-until"
                  type="date"
                  value={formData.valid_until}
                  onChange={(e) => setFormData((prev) => ({ ...prev, valid_until: e.target.value }))}
                />
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditing(false)} disabled={isSubmitting}>
                <X className="h-4 w-4 ml-1" />
                ביטול עריכה
              </Button>
              <Button onClick={handleSave} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
                שמור שינויים
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
