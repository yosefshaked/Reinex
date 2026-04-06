import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useState, useEffect } from 'react';
import { useOrg } from '@/org/OrgContext';
import { useCalendarInstructors } from '../../hooks/useCalendar';
import { useTemplateMutations, useTemplateOverrides } from '../../hooks/useTemplates';
import { Loader2, AlertCircle, Trash2, Pencil, X, RotateCcw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useAuth } from '@/auth/AuthContext.jsx';
import { DAY_OPTIONS, normalizeDayToken } from '@/lib/day-of-week.js';
import { hasConfiguredAvailability, isWithinAvailabilityWindows } from '@/lib/instructor-availability.js';

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
export function TemplateEditDialog({ template, open, onClose, onUpdate, onFixAvailability }) {
  const { activeOrgId } = useOrg();
  const { session } = useAuth();
  const { instructors, isLoading: instructorsLoading } = useCalendarInstructors();
  const {
    updateTemplate,
    deleteTemplate,
    createTemplateOverride,
    deleteTemplateOverride,
    isSubmitting,
  } = useTemplateMutations();
  const {
    overrides,
    isLoading: overridesLoading,
    error: overridesError,
    refetch: refetchOverrides,
  } = useTemplateOverrides(template?.id || null, {
    enabled: open && Boolean(template?.id),
  });

  const [isEditing, setIsEditing] = useState(false);
  const [isReactivating, setIsReactivating] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);

  const [formData, setFormData] = useState({
    instructor_employee_id: '',
    service_id: '',
    day_of_week: '',
    time_of_day: '09:00',
    duration_minutes: 60,
    valid_from: '',
    valid_until: '',
  });
  const [reactivationRange, setReactivationRange] = useState({
    valid_from: '',
    valid_until: '',
  });
  const [newOverrideDate, setNewOverrideDate] = useState('');

  const [error, setError] = useState(null);

  function formatDate(dateString) {
    if (!dateString) return '—';
    const date = new Date(`${dateString}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      return dateString;
    }
    return new Intl.DateTimeFormat('he-IL', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  // Populate form from template
  useEffect(() => {
    if (template && open) {
      setFormData({
        instructor_employee_id: template.instructor_employee_id || '',
        service_id: template.service_id || '',
        day_of_week: normalizeDayToken(template.day_of_week) || '',
        time_of_day: formatTime(template.time_of_day) || '09:00',
        duration_minutes: template.duration_minutes || 60,
        valid_from: template.valid_from || '',
        valid_until: template.valid_until || '',
      });
      setIsEditing(false);
      setIsReactivating(false);
      setShowDeleteConfirm(false);
      setReactivationRange({
        valid_from: '',
        valid_until: '',
      });
      setNewOverrideDate('');
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
  const dayLabel = DAY_OPTIONS.find((d) => d.value === normalizeDayToken(template.day_of_week))?.label || '—';
  const activeServices = (services || []).filter((s) => s?.is_active === true);
  const selectedInstructor = (instructors || []).find((instructor) => instructor.id === formData.instructor_employee_id) || null;
  const selectedCapability = (selectedInstructor?.service_capabilities || []).find((capability) => capability.service_id === formData.service_id) || null;
  const missingCapability = Boolean(formData.instructor_employee_id && formData.service_id && !selectedCapability);
  const missingAvailability = Boolean(selectedCapability && !hasConfiguredAvailability(selectedCapability.availability_windows));
  const outsideAvailability = Boolean(
    selectedCapability
    && hasConfiguredAvailability(selectedCapability.availability_windows)
    && formData.day_of_week
    && formData.time_of_day
    && Number(formData.duration_minutes) > 0
    && !isWithinAvailabilityWindows({
      availabilityWindows: selectedCapability.availability_windows,
      day: formData.day_of_week,
      startTime: formData.time_of_day,
      durationMinutes: Number(formData.duration_minutes),
    })
  );

  async function handleSave() {
    setError(null);

    if (missingCapability) {
      setError('לא ניתן לשמור בלי יכולת שירות פעילה למדריך/ה עבור השירות שנבחר.');
      return;
    }

    if (missingAvailability) {
      setError('לא ניתן לשמור בלי חלונות זמינות שהוגדרו למדריך/ה עבור השירות שנבחר.');
      return;
    }

    if (outsideAvailability) {
      setError('היום או השעה שנבחרו נמצאים מחוץ לחלונות הזמינות שהוגדרו למדריך/ה עבור השירות.');
      return;
    }

    const updates = {};

    if (formData.instructor_employee_id !== template.instructor_employee_id) {
      updates.instructor_employee_id = formData.instructor_employee_id;
    }
    if (formData.service_id !== template.service_id) {
      updates.service_id = formData.service_id;
    }
    if (normalizeDayToken(formData.day_of_week) !== normalizeDayToken(template.day_of_week)) {
      updates.day_of_week = formData.day_of_week;
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
      setError(
        apiError === 'duplicate_template_conflict'
          ? 'לא ניתן לשמור תבנית זהה וחופפת (תלמיד+מדריך+יום+שעה) כאשר כבר קיימת תבנית פעילה.'
          : apiError === 'missing_instructor_service_capability'
            ? 'לא ניתן לשמור בלי יכולת שירות פעילה למדריך/ה עבור השירות שנבחר.'
            : apiError === 'missing_instructor_service_availability'
              ? 'לא ניתן לשמור בלי חלונות זמינות שהוגדרו למדריך/ה עבור השירות שנבחר.'
              : apiError === 'outside_instructor_service_availability'
                ? 'היום או השעה שנבחרו נמצאים מחוץ לחלונות הזמינות שהוגדרו למדריך/ה עבור השירות.'
          : apiError,
      );
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

  async function handleReactivate() {
    setError(null);

    if (!reactivationRange.valid_from) {
      setError('כדי להפעיל מחדש יש לבחור טווח תוקף חדש (תוקף מ- הוא שדה חובה).');
      return;
    }

    if (reactivationRange.valid_until && reactivationRange.valid_until < reactivationRange.valid_from) {
      setError('תוקף עד לא יכול להיות מוקדם מתוקף מ-.');
      return;
    }

    const { error: apiError } = await updateTemplate(template.id, {
      is_active: true,
      valid_from: reactivationRange.valid_from,
      valid_until: reactivationRange.valid_until || null,
    });

    if (apiError) {
      setError(
        apiError === 'duplicate_template_conflict'
          ? 'לא ניתן להפעיל תבנית זהה וחופפת (תלמיד+מדריך+יום+שעה) כאשר כבר קיימת תבנית פעילה.'
          : apiError === 'reactivation_requires_new_valid_range'
            ? 'כדי להפעיל תבנית לא פעילה יש לבחור טווח תוקף חדש.'
            : apiError,
      );
      return;
    }

    setIsReactivating(false);
    onUpdate?.();
    onClose();
  }

  async function handleAddCancelOverride() {
    setError(null);

    if (!newOverrideDate) {
      setError('בחר תאריך לביטול חד-פעמי.');
      return;
    }

    const { error: apiError } = await createTemplateOverride({
      template_id: template.id,
      target_date: newOverrideDate,
      override_type: 'cancel',
    });

    if (apiError) {
      setError(
        apiError === 'template_override_already_exists'
          ? 'כבר קיימת חריגה לתאריך הזה.'
          : apiError === 'target_date_outside_template_range'
            ? 'התאריך הנבחר מחוץ לטווח התוקף של התבנית.'
            : apiError,
      );
      return;
    }

    setNewOverrideDate('');
    refetchOverrides();
  }

  async function handleDeleteOverride(overrideId) {
    setError(null);

    const { error: apiError } = await deleteTemplateOverride(overrideId);
    if (apiError) {
      setError(apiError);
      return;
    }

    refetchOverrides();
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
        {!isEditing && !isReactivating && (
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

            <div className="border rounded-md p-3 space-y-3 bg-gray-50/70">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">חריגות חד-פעמיות</p>
                  <p className="text-xs text-gray-500">ניהול ביטול לשיעור בתאריך ספציפי</p>
                </div>
              </div>

              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label htmlFor="add-cancel-override-date">תאריך לביטול</Label>
                  <Input
                    id="add-cancel-override-date"
                    type="date"
                    value={newOverrideDate}
                    onChange={(e) => setNewOverrideDate(e.target.value)}
                    disabled={isSubmitting || !template.is_active}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleAddCancelOverride}
                  disabled={isSubmitting || !template.is_active || !newOverrideDate}
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin ms-2" />}
                  הוסף ביטול
                </Button>
              </div>

              {!template.is_active && (
                <p className="text-xs text-amber-700">
                  לא ניתן להוסיף חריגות כאשר התבנית לא פעילה.
                </p>
              )}

              {overridesLoading && (
                <div className="text-sm text-gray-500 flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  טוען חריגות...
                </div>
              )}

              {!overridesLoading && overridesError && (
                <p className="text-sm text-red-600">שגיאה בטעינת חריגות: {overridesError}</p>
              )}

              {!overridesLoading && !overridesError && overrides.length === 0 && (
                <p className="text-sm text-gray-500">אין חריגות לתבנית זו.</p>
              )}

              {!overridesLoading && !overridesError && overrides.length > 0 && (
                <div className="space-y-2">
                  {overrides.map((override) => (
                    <div
                      key={override.id}
                      className="flex items-center justify-between gap-2 rounded border bg-white px-2 py-2"
                    >
                      <div className="text-sm">
                        <div className="font-medium">
                          {override.override_type === 'cancel' ? 'ביטול' : 'שינוי'} • {formatDate(override.target_date)}
                        </div>
                        {override.note && (
                          <div className="text-xs text-gray-500">{override.note}</div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteOverride(override.id)}
                        disabled={isSubmitting}
                        aria-label="מחק חריגה"
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Delete confirmation */}
            {showDeleteConfirm && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="mb-2">האם לבטל תבנית זו? התבנית תסומן כלא פעילה.</div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" onClick={handleDelete} disabled={isSubmitting}>
                      {isSubmitting && <Loader2 className="h-3 w-3 animate-spin ms-1" />}
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
                <AlertDescription className="space-y-3">
                  <div>{error}</div>
                  {(missingCapability || missingAvailability || outsideAvailability) && typeof onFixAvailability === 'function' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onFixAvailability({
                        instructorId: formData.instructor_employee_id,
                        serviceId: formData.service_id,
                        studentId: template.student_id,
                        waitingListContext: {
                          studentName,
                          serviceName,
                        },
                        fixType: missingCapability
                          ? 'missing_service_capability'
                          : missingAvailability
                            ? 'missing_instructor_service_availability'
                            : 'outside_instructor_service_availability',
                        source: 'edit',
                      })}
                    >
                      תקן זמינות
                    </Button>
                  ) : null}
                </AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <div className="flex items-center gap-2 w-full justify-between">
                <div className="flex gap-2">
                  {template.is_active && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                        <Pencil className="h-4 w-4 ms-1" />
                        עריכה
                      </Button>
                      <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => setShowDeleteConfirm(true)}>
                        <Trash2 className="h-4 w-4 ms-1" />
                        ביטול תבנית
                      </Button>
                    </>
                  )}
                  {!template.is_active && (
                    <Button variant="outline" size="sm" onClick={() => setIsReactivating(true)}>
                      <RotateCcw className="h-4 w-4 ms-1" />
                      הפעלה מחדש
                    </Button>
                  )}
                </div>
                <Button variant="outline" onClick={onClose}>
                  סגור
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}

        {/* Reactivation Mode */}
        {isReactivating && (
          <div className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                הפעלת תבנית מחייבת בחירת טווח תוקף חדש. שאר השדות יישארו ללא שינוי.
              </AlertDescription>
            </Alert>

            <div>
              <Label>תלמיד</Label>
              <Input value={studentName} disabled className="bg-gray-50" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="reactivate-valid-from">תוקף מ- *</Label>
                <Input
                  id="reactivate-valid-from"
                  type="date"
                  value={reactivationRange.valid_from}
                  onChange={(e) => setReactivationRange((prev) => ({ ...prev, valid_from: e.target.value }))}
                  required
                />
              </div>
              <div>
                <Label htmlFor="reactivate-valid-until">תוקף עד</Label>
                <Input
                  id="reactivate-valid-until"
                  type="date"
                  value={reactivationRange.valid_until}
                  onChange={(e) => setReactivationRange((prev) => ({ ...prev, valid_until: e.target.value }))}
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
              <Button type="button" variant="outline" onClick={() => setIsReactivating(false)} disabled={isSubmitting}>
                <X className="h-4 w-4 ms-1" />
                ביטול
              </Button>
              <Button onClick={handleReactivate} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin ms-2" />}
                הפעל תבנית
              </Button>
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
                value={formData.day_of_week || undefined}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, day_of_week: value }))}
              >
                <SelectTrigger id="edit-day">
                  <SelectValue placeholder="בחר יום" />
                </SelectTrigger>
                <SelectContent>
                  {DAY_OPTIONS.map((day) => (
                    <SelectItem key={day.value} value={day.value}>
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
                <X className="h-4 w-4 ms-1" />
                ביטול עריכה
              </Button>
              <Button onClick={handleSave} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin ms-2" />}
                שמור שינויים
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
