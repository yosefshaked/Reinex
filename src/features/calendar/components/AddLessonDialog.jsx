import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useState, useEffect, useCallback } from 'react';
import { useOrg } from '@/org/OrgContext';
import { useServices } from '@/hooks/useOrgData';
import { useCalendarInstructors } from '../hooks/useCalendar';
import { Loader2, AlertCircle, Users } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ComboBoxField } from '@/components/ui/forms-ui';

/**
 * AddLessonDialog - Create new lesson instance
 * Flow: Select student → Auto-fetch their service/instructor → Add more students if group session → Set date/time
 */
export function AddLessonDialog({ open, onClose, onSuccess, defaultDate }) {
  const { currentOrg } = useOrg();
  const { services, isLoading: servicesLoading } = useServices();
  const { instructors, isLoading: instructorsLoading } = useCalendarInstructors();
  
  const [students, setStudents] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
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

  // Fetch students
  useEffect(() => {
    if (!currentOrg?.id || !open) return;

    async function fetchStudents() {
      setStudentsLoading(true);
      try {
        const response = await fetch(`/api/students-list?org_id=${currentOrg.id}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch students');
        }

        const data = await response.json();
        setStudents(data.students || []);
      } catch (err) {
        console.error('Error fetching students:', err);
      } finally {
        setStudentsLoading(false);
      }
    }

    fetchStudents();
  }, [currentOrg?.id, open]);

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
    if (!currentOrg?.id) return;
    setIsCheckingConflicts(true);
    try {
      const datetime_start = `${formData.date}T${formData.time}:00`;
      
      const response = await fetch('/api/calendar/conflicts/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        },
        body: JSON.stringify({
          org_id: currentOrg.id,
          datetime_start,
          duration_minutes: formData.duration_minutes,
          instructor_employee_id: formData.instructor_employee_id,
          student_ids: formData.student_ids,
          service_id: formData.service_id,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setConflicts(data.conflicts || []);
      }
    } catch (err) {
      console.error('Error checking conflicts:', err);
    } finally {
      setIsCheckingConflicts(false);
    }
  }, [formData, currentOrg?.id]);

  useEffect(() => {
    if (!formData.instructor_employee_id || !formData.date || !formData.time || formData.student_ids.length === 0) {
      setConflicts([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      await checkConflicts();
    }, 500); // Debounce

    return () => clearTimeout(timeoutId);
  }, [formData, currentOrg?.id, checkConflicts]);

  async function handleSubmit(e) {
    if (!currentOrg?.id) {
      setError('Organization not found');
      return;
    }
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const datetime_start = `${formData.date}T${formData.time}:00`;
      
      const response = await fetch('/api/calendar/instances', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        },
        body: JSON.stringify({
          org_id: currentOrg.id,
          datetime_start,
          duration_minutes: formData.duration_minutes,
          instructor_employee_id: formData.instructor_employee_id,
          service_id: formData.service_id,
          student_ids: formData.student_ids,
          created_source: 'manual',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to create lesson');
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('Error creating lesson:', err);
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  const studentOptions = students.map(s => ({
    value: s.id,
    label: `${s.first_name || ''} ${s.middle_name || ''} ${s.last_name || ''}`.trim() || 'ללא שם',
    searchText: `${s.first_name || ''} ${s.middle_name || ''} ${s.last_name || ''} ${s.identity_number || ''}`.toLowerCase(),
  }));

  const activeServices = services?.filter(s => s.is_active) || [];

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>שיעור חדש</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Student - FIRST FIELD */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor="students">תלמיד *</Label>
              {formData.student_ids.length > 0 && (
                <Button
                  type="button"
                  variant={isGroupSession ? "default" : "outline"}
                  size="sm"
                  onClick={() => setIsGroupSession(!isGroupSession)}
                  className="gap-1"
                >
                  <Users className="h-4 w-4" />
                  {isGroupSession ? 'שיעור קבוצתי' : 'להוסיף תלמידים'}
                </Button>
              )}
            </div>
            <ComboBoxField
              id="students"
              options={studentOptions}
              value={isGroupSession ? formData.student_ids : formData.student_ids.slice(0, 1)}
              onChange={(value) => {
                const newStudentIds = isGroupSession ? value : value.slice(0, 1);
                setFormData({ ...formData, student_ids: newStudentIds });
              }}
              placeholder="בחר תלמיד"
              multiple={isGroupSession}
              disabled={studentsLoading}
            />
            {!isGroupSession && formData.student_ids.length > 0 && studentDetails && (
              <div className="mt-2 p-2 bg-blue-50 rounded text-sm">
                <p className="font-medium">{studentDetails.first_name} {studentDetails.last_name}</p>
              </div>
            )}
          </div>

          {/* Service - AUTO-POPULATED */}
          <div>
            <Label htmlFor="service">שירות *</Label>
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
                    {service.service_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Instructor - AUTO-POPULATED */}
          <div>
            <Label htmlFor="instructor">מדריך *</Label>
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
