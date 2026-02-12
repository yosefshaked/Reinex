import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useState, useEffect, useCallback } from 'react';
import { useOrg } from '@/org/OrgContext';
import { useServices } from '@/hooks/useOrgData';
import { useCalendarInstructors } from '../hooks/useCalendar';
import { Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ComboBoxField } from '@/components/ui/forms-ui';

/**
 * AddLessonDialog - Create new lesson instance
 */
export function AddLessonDialog({ open, onClose, onSuccess, defaultDate }) {
  const { currentOrg } = useOrg();
  const { services, isLoading: servicesLoading } = useServices();
  const { instructors, isLoading: instructorsLoading } = useCalendarInstructors();
  
  const [students, setStudents] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  
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

  // Check conflicts when form data changes
  const checkConflicts = useCallback(async () => {
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
  }, [formData, currentOrg.id]);

  useEffect(() => {
    if (!formData.instructor_employee_id || !formData.date || !formData.time || formData.student_ids.length === 0) {
      setConflicts([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      await checkConflicts();
    }, 500); // Debounce

    return () => clearTimeout(timeoutId);
  }, [formData, currentOrg.id, checkConflicts]);

  async function handleSubmit(e) {
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
          {/* Service */}
          <div>
            <Label htmlFor="service">שירות *</Label>
            <Select
              value={formData.service_id}
              onValueChange={(value) => setFormData({ ...formData, service_id: value })}
              disabled={servicesLoading}
            >
              <SelectTrigger id="service">
                <SelectValue placeholder="בחר שירות" />
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

          {/* Instructor */}
          <div>
            <Label htmlFor="instructor">מדריך *</Label>
            <Select
              value={formData.instructor_employee_id}
              onValueChange={(value) => setFormData({ ...formData, instructor_employee_id: value })}
              disabled={instructorsLoading}
            >
              <SelectTrigger id="instructor">
                <SelectValue placeholder="בחר מדריך" />
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

          {/* Students */}
          <div>
            <Label htmlFor="students">תלמידים *</Label>
            <ComboBoxField
              id="students"
              options={studentOptions}
              value={formData.student_ids}
              onChange={(value) => setFormData({ ...formData, student_ids: value })}
              placeholder="בחר תלמידים"
              multiple
              disabled={studentsLoading}
            />
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
