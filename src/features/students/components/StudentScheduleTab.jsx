import React, { useState, useEffect } from 'react';
import { Loader2, BookOpen, Clock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/services/apiClient.js';

/**
 * Schedule tab showing student's lesson templates and upcoming lesson instances.
 * 
 * Displays:
 * 1. Lesson templates (recurring lesson definitions)
 * 2. 14-day lesson instances (scheduled occurrences)
 * 
 * @param {Object} props
 * @param {string} props.studentId - Student ID for fetching lesson instances
 * @param {Array} props.lessonTemplates - Student's active lesson templates
 * @param {boolean} props.isLoadingTemplates - Loading state for templates
 * @returns {JSX.Element}
 */
export default function StudentScheduleTab({
  studentId,
  lessonTemplates = [],
  isLoadingTemplates = false,
}) {
  const [lessonInstances, setLessonInstances] = useState([]);
  const [isLoadingInstances, setIsLoadingInstances] = useState(false);
  const [error, setError] = useState(null);

  // Fetch 14-day lesson instances for this student
  useEffect(() => {
    if (!studentId) return;

    const fetchLessonInstances = async () => {
      setIsLoadingInstances(true);
      setError(null);
      try {
        // Note: Will be extended to support optional student_id query parameter
        // Currently fetches by date; enhancement forthcoming
        const today = new Date().toISOString().split('T')[0];
        const response = await apiClient.get('/api/lesson-instances', {
          params: { date: today },
        });
        setLessonInstances(response?.data?.instances || []);
      } catch (err) {
        console.error('Error fetching lesson instances:', err);
        setError(err.message || 'Failed to load lesson instances');
      } finally {
        setIsLoadingInstances(false);
      }
    };

    fetchLessonInstances();
  }, [studentId]);

  return (
    <div className="space-y-6">
      {/* Lesson Templates Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-blue-600" />
            <CardTitle className="text-lg">קורסים בהרשמה</CardTitle>
          </div>
          <CardDescription>
            {lessonTemplates.length}
            {' '}
            קורס אחורי
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingTemplates ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
            </div>
          ) : lessonTemplates.length > 0 ? (
            <div className="space-y-2">
              {lessonTemplates.map((template) => (
                <div
                  key={template.id}
                  className="flex items-center justify-between rounded-md border px-4 py-3 hover:bg-neutral-50/50"
                >
                  <div className="flex-1 space-y-1">
                    <p className="font-semibold text-sm">{template.lesson_name}</p>
                    <div className="flex flex-wrap gap-2 items-center text-xs text-neutral-600">
                      {template.instructor_name && (
                        <span>מחנך: {template.instructor_name}</span>
                      )}
                      {template.frequency && (
                        <span>|</span>
                      )}
                      {template.frequency && (
                        <span>{template.frequency}</span>
                      )}
                    </div>
                  </div>
                  <Badge variant="secondary" className="ms-2">פעיל</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-neutral-500 py-2">אין קורסים פעילים</p>
          )}
        </CardContent>
      </Card>

      {/* Lesson Instances - 14 Day View */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-green-600" />
            <CardTitle className="text-lg">שיעורים בשבועות הקרובים</CardTitle>
          </div>
          <CardDescription>ל-14 ימים הקרובים</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingInstances ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
            </div>
          ) : error ? (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              שגיאה בטעינת שיעורים:
              {' '}
              {error}
            </div>
          ) : lessonInstances.length > 0 ? (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {lessonInstances.map((instance) => (
                <div
                  key={instance.id}
                  className="flex items-center justify-between rounded-md border px-4 py-3 hover:bg-neutral-50/50"
                >
                  <div className="flex-1 space-y-1">
                    <p className="font-semibold text-sm">{instance.lesson_name || 'שיעור'}</p>
                    <div className="flex flex-wrap gap-2 items-center text-xs text-neutral-600">
                      <span>{instance.lesson_date}</span>
                      <span>|</span>
                      <span>{instance.lesson_time}</span>
                      {instance.instructor_name && (
                        <>
                          <span>|</span>
                          <span>{instance.instructor_name}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {instance.status && (
                    <Badge
                      variant={instance.status === 'completed' ? 'secondary' : 'default'}
                      className="ms-2 text-xs"
                    >
                      {instance.status}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-neutral-500 py-2">אין שיעורים בעתיד הקרוב</p>
          )}
        </CardContent>
      </Card>

      {/* Future Enhancement Placeholder */}
      <Card className="opacity-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">התאמת לוח זמנים</CardTitle>
          <CardDescription>יוטמע בגרסה היומן</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-neutral-500">יוטמע כשלב הבא של פיתוח</p>
        </CardContent>
      </Card>
    </div>
  );
}
