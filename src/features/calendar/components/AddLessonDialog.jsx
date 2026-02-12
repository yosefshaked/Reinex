import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useState, useEffect, useCallback } from 'react';
import { useOrg } from '@/org/OrgContext';
import { useStudents } from '@/hooks/useOrgData';
import { useCalendarInstructors } from '../hooks/useCalendar';
import { Loader2, AlertCircle, Users, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ComboBoxField } from '@/components/ui/forms-ui';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useAuth } from '@/auth/AuthContext.jsx';

/**
 * AddLessonDialog - Create new lesson instance
 * Flow: Select student → Auto-fetch their service/instructor → Add more students if group session → Set date/time
 */
export function AddLessonDialog({ open, onClose, onSuccess, defaultDate }) {
  const { activeOrgId } = useOrg();
  const { session } = useAuth();
  const { instructors, isLoading: instructorsLoading, error: instructorsError } = useCalendarInstructors();

  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesError, setServicesError] = useState('');

  const { students, loadingStudents: studentsLoading, studentsError } = useStudents({
    status: 'active',
    enabled: open && !!activeOrgId,
    orgId: activeOrgId,
  });
  const [isGroupSession, setIsGroupSession] = useState(false);
  
  const [formData, setFormData] = useState({
    student_ids: [],
    instructor_employee_id: '',
    service_id: '',
    date: defaultDate || new Date().toISOString().split('T')[0],
    time: '09:00',
    duration_minutes: 60,
  });

  const [conflicts, setConflicts] = useState([]);
  const [isCheckingConflicts, setIsCheckingConflicts] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [studentDetails, setStudentDetails] = useState(null); // Cache first student details

  useEffect(() => {
    if (!open || !activeOrgId || !session) return;

    let isMounted = true;
    async function fetchServices() {
      setServicesLoading(true);
      setServicesError('');
      try {
        const payload = await authenticatedFetch('services', {
          session,
          params: { org_id: activeOrgId },
        });
        if (!isMounted) return;
        setServices(Array.isArray(payload) ? payload : []);
      } catch (err) {
        if (!isMounted) return;
        setServices([]);
        setServicesError(err?.message || 'טעינת השירותים נכשלה.');
      } finally {
        if (isMounted) setServicesLoading(false);
      }
    }

    fetchServices();
    return () => {
      isMounted = false;
    };
  }, [open, activeOrgId, session]);

  useEffect(() => {
    if (studentsError) {
      console.error('Error fetching students:', studentsError);
    }
  }, [studentsError]);

  // When first student is selected, auto-populate service and instructor
  useEffect(() => {
    if (formData.student_ids.length === 0) {
      setStudentDetails(null);
      setFormData(prev => ({ ...prev, instructor_employee_id: '', service_id: '' }));
      return;
    }

    const firstStudentId = formData.student_ids[0];
    const student = students.find(s => s.id === firstStudentId);
    
    if (student) {
      setStudentDetails(student);
      // Auto-populate service if student has a service assigned
      if (student.service_id) {
        setFormData(prev => ({ ...prev, service_id: student.service_id }));
      }
      // Auto-populate instructor if student has an assigned instructor
      if (student.assigned_instructor_id) {
        setFormData(prev => ({ ...prev, instructor_employee_id: student.assigned_instructor_id }));
      }
    }
  }, [formData.student_ids, students]);

  // Check conflicts when form data changes
  const checkConflicts = useCallback(async () => {
    if (!activeOrgId) return;
    setIsCheckingConflicts(true);
    try {
      const datetime_start = `${formData.date}T${formData.time}:00`;
      const data = await authenticatedFetch('calendar/conflicts/check', {
        method: 'POST',
        session,
        body: {
          org_id: activeOrgId,
          datetime_start,
          duration_minutes: formData.duration_minutes,
          instructor_employee_id: formData.instructor_employee_id,
          student_ids: formData.student_ids,
          service_id: formData.service_id,
        },
      });

      setConflicts(data?.conflicts || []);
    } catch (err) {
      console.error('Error checking conflicts:', err);
    } finally {
      setIsCheckingConflicts(false);
    }
  }, [formData, activeOrgId, session]);

  useEffect(() => {
    if (!formData.instructor_employee_id || !formData.date || !formData.time || formData.student_ids.length === 0) {
      setConflicts([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      await checkConflicts();
    }, 500); // Debounce

    return () => clearTimeout(timeoutId);
  }, [formData, activeOrgId, checkConflicts]);

  async function handleSubmit(e) {
    if (!activeOrgId) {
      setError('Organization not found');
      return;
    }
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const datetime_start = `${formData.date}T${formData.time}:00`;

      await authenticatedFetch('calendar/instances', {
        method: 'POST',
        session,
        body: {
          org_id: activeOrgId,
          datetime_start,
          duration_minutes: formData.duration_minutes,
          instructor_employee_id: formData.instructor_employee_id,
          service_id: formData.service_id,
          student_ids: formData.student_ids,
          created_source: 'manual',
        },
      });

      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('Error creating lesson:', err);
      setError(err?.message || 'Failed to create lesson');
    } finally {
      setIsSubmitting(false);
    }
  }

  const studentOptions = students.map(s => ({
    value: s.id,
    label: `${s.first_name || ''} ${s.middle_name || ''} ${s.last_name || ''}`.trim() || 'ללא שם',
    searchText: `${s.first_name || ''} ${s.middle_name || ''} ${s.last_name || ''} ${s.identity_number || ''}`.toLowerCase(),
  }));

  const activeServices = services?.filter((s) => s?.is_active !== false) || [];

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>שיעור חדש</DialogTitle>
          <DialogDescription className="sr-only">יצירת שיעור חדש עבור תלמידים נבחרים.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Student - FIRST FIELD */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor="students">תלמיד *</Label>
              {formData.student_ids.length > 0 && !isGroupSession && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsGroupSession(true)}
                  className="gap-1 ml-auto"
                >
                  <Users className="h-4 w-4" />
                  להוסיף תלמידים נוספים
                </Button>
              )}
            </div>
            {studentsLoading && (
              <div className="text-sm text-gray-500 mb-2 flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                טוען תלמידים...
              </div>
            )}
            {studentsError && !studentsLoading && (
              <div className="text-sm text-red-600 mb-2">
                {studentsError}
              </div>
            )}
            {!studentsLoading && !studentsError && studentOptions.length === 0 && (
              <div className="text-sm text-amber-600 mb-2">
                לא נמצאו תלמידים
              </div>
            )}
            
            {/* Primary student selection */}
            <ComboBoxField
              id="primary-student"
              name="primary-student"
              options={studentOptions}
              value={formData.student_ids[0] ? students.find(s => s.id === formData.student_ids[0])?.label || '' : ''}
              onChange={(value) => {
                const student = students.find(s => 
                  `${s.first_name || ''} ${s.middle_name || ''} ${s.last_name || ''}`.trim() === value.trim()
                );
                const newIds = student ? [student.id] : [];
                if (isGroupSession) {
                  // Keep existing secondary students
                  const otherIds = formData.student_ids.slice(1);
                  setFormData({ ...formData, student_ids: [...newIds, ...otherIds] });
                } else {
                  setFormData({ ...formData, student_ids: newIds });
                }
              }}
              placeholder={studentsLoading ? "טוען..." : "בחר תלמיד"}
              disabled={studentsLoading || studentOptions.length === 0}
              emptyMessage="לא נמצאו תלמידים"
            />

            {/* Additional students for group sessions */}
            {isGroupSession && (
              <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <Label>תלמידים נוספים</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsGroupSession(false)}
                  >
                    סגור
                  </Button>
                </div>
                <Select
                  value=""
                  onValueChange={(studentId) => {
                    if (!formData.student_ids.includes(studentId)) {
                      setFormData({ ...formData, student_ids: [...formData.student_ids, studentId] });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="הוסף תלמיד נוסף" />
                  </SelectTrigger>
                  <SelectContent>
                    {students
                      .filter(s => !formData.student_ids.includes(s.id))
                      .map((student) => (
                        <SelectItem key={student.id} value={student.id}>
                          {student.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>

                {/* List of added students */}
                {formData.student_ids.length > 1 && (
                  <div className="mt-3 space-y-2">
                    {formData.student_ids.slice(1).map((studentId) => {
                      const student = students.find(s => s.id === studentId);
                      return (
                        <div key={studentId} className="flex items-center justify-between p-2 bg-white rounded border">
                          <span>{student?.label}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setFormData({
                                ...formData,
                                student_ids: formData.student_ids.filter(id => id !== studentId)
                              });
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {!isGroupSession && formData.student_ids.length > 0 && studentDetails && (
              <div className="mt-2 p-2 bg-blue-50 rounded text-sm">
                <p className="font-medium">{studentDetails.first_name} {studentDetails.last_name}</p>
              </div>
            )}
          </div>

          {/* Service - AUTO-POPULATED */}
          <div>
            <Label htmlFor="service">שירות *</Label>
            {servicesError && (
              <div className="text-sm text-red-600 mb-2">{servicesError}</div>
            )}
            <Select
              value={formData.service_id}
              onValueChange={(value) => setFormData({ ...formData, service_id: value })}
              disabled={servicesLoading || !formData.student_ids.length}
            >
              <SelectTrigger id="service">
                <SelectValue placeholder={formData.student_ids.length ? "בחר שירות" : "בחר תלמיד תחילה"} />
              </SelectTrigger>
              <SelectContent>
                {activeServices.map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.name || service.service_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Instructor - AUTO-POPULATED */}
          <div>
            <Label htmlFor="instructor">מדריך *</Label>
            {instructorsError && (
              <div className="text-sm text-red-600 mb-2">{instructorsError}</div>
            )}
            <Select
              value={formData.instructor_employee_id}
              onValueChange={(value) => setFormData({ ...formData, instructor_employee_id: value })}
              disabled={instructorsLoading || !formData.student_ids.length}
            >
              <SelectTrigger id="instructor">
                <SelectValue placeholder={formData.student_ids.length ? "בחר מדריך" : "בחר תלמיד תחילה"} />
              </SelectTrigger>
              <SelectContent>
                {instructors.map((instructor) => (
                  <SelectItem key={instructor.id} value={instructor.id}>
                    {instructor.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date */}
          <div>
            <Label htmlFor="date">תאריך *</Label>
            <Input
              id="date"
              type="date"
              value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              required
            />
          </div>

          {/* Time */}
          <div>
            <Label htmlFor="time">שעה *</Label>
            <Input
              id="time"
              type="time"
              value={formData.time}
              onChange={(e) => setFormData({ ...formData, time: e.target.value })}
              required
            />
          </div>

          {/* Duration */}
          <div>
            <Label htmlFor="duration">משך (דקות) *</Label>
            <Input
              id="duration"
              type="number"
              min="15"
              step="15"
              value={formData.duration_minutes}
              onChange={(e) => setFormData({ ...formData, duration_minutes: parseInt(e.target.value) })}
              required
            />
          </div>

          {/* Conflicts Warning */}
          {isCheckingConflicts && (
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertDescription>בודק התנגשויות...</AlertDescription>
            </Alert>
          )}

          {conflicts.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="font-medium mb-2">נמצאו התנגשויות:</div>
                <ul className="list-disc list-inside space-y-1">
                  {conflicts.map((conflict, index) => (
                    <li key={index} className="text-sm">{conflict.message}</li>
                  ))}
                </ul>
                <div className="mt-2 text-sm">ניתן להמשיך ולשמור בכל זאת.</div>
              </AlertDescription>
            </Alert>
          )}

          {/* Error Message */}
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
            <Button type="submit" disabled={isSubmitting || !formData.service_id || !formData.instructor_employee_id || formData.student_ids.length === 0}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  שומר...
                </>
              ) : (
                'צור שיעור'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
