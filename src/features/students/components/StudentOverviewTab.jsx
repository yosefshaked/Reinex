import React, { useEffect, useState } from 'react';
import { Loader2, Calendar, BookOpen, DollarSign, Notebook, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';

/**
 * Overview tab showing student dashboard: next lesson, templates, financials, and notes.
 * 
 * Displays high-level information organized in a grid layout with
 * color-coded sections (green for action-ready, amber for information, base for neutral).
 * 
 * @param {Object} props
 * @param {Object} props.student - Student data
 * @returns {JSX.Element}
 */
export default function StudentOverviewTab({ student }) {
  const { session } = useSupabase();
  const { activeOrg } = useOrg();
  
  const [lessonTemplates, setLessonTemplates] = useState([]);
  const [nextLesson, setNextLesson] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const activeOrgId = activeOrg?.id;
  const studentId = student?.id;

  // Fetch lesson templates on mount
  useEffect(() => {
    if (!studentId || !activeOrgId) return;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Fetch lesson templates
        const params = new URLSearchParams({ student_id: studentId, org_id: activeOrgId });
        const templates = await authenticatedFetch(
          `api/lesson-templates?${params}`,
          { session }
        );

        const activeTemplates = Array.isArray(templates)
          ? templates.filter((t) => t?.is_active !== false)
          : [];

        setLessonTemplates(activeTemplates);

        // Fetch next lesson instance
        const today = new Date().toISOString().split('T')[0];
        const instances = await authenticatedFetch(
          `api/lesson-instances?date=${today}&student_id=${studentId}&org_id=${activeOrgId}`,
          { session }
        );

        if (Array.isArray(instances) && instances.length > 0) {
          // Find first upcoming lesson
          const upcoming = instances.find((li) => {
            const startTime = new Date(li.datetime_start);
            return startTime > new Date();
          });
          setNextLesson(upcoming || instances[0]);
        }
      } catch (err) {
        console.error('Failed to load overview data', err);
        setError(err?.message || 'טעינת נתוני הסקירה נכשלה');
      } finally {
        setIsLoading(false);
      }
    };

    void fetchData();
  }, [studentId, activeOrgId, session]);

  if (!student) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-neutral-500">לא ניתן לטעון הנתונים</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800 flex items-start gap-2">
        <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
        <p>{error}</p>
      </div>
    );
  }

  const formatDateTime = (isoString) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toLocaleString('he-IL', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {/* Next Lesson Card - Green (Action-Ready) */}
      <Card className="border-t-4 border-t-green-500 md:col-span-1 lg:col-span-1">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-green-600" />
            <CardTitle className="text-lg">השיעור הקרוב</CardTitle>
          </div>
          <CardDescription>שיעור בעתיד הקרוב</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
            </div>
          ) : nextLesson ? (
            <>
              <div>
                <p className="text-xs text-neutral-500">קורס</p>
                <p className="font-semibold">{nextLesson.service?.name || 'לא זוהה'}</p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">מחנך</p>
                <p className="font-semibold">{nextLesson.instructor?.name || 'לא הוקצה'}</p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">תאריך ושעה</p>
                <p className="font-semibold">{formatDateTime(nextLesson.datetime_start)}</p>
              </div>
            </>
          ) : (
            <p className="text-sm text-neutral-500 py-2">לא קיימים שיעורים בעתיד הקרוב</p>
          )}
        </CardContent>
      </Card>

      {/* Lesson Templates Card */}
      <Card className="md:col-span-1 lg:col-span-1">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-blue-600" />
            <CardTitle className="text-lg">קורסים פעילים</CardTitle>
          </div>
          <CardDescription>
            {lessonTemplates.length}
            {' '}
            קורס
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lessonTemplates.length > 0 ? (
            <div className="space-y-2">
              {lessonTemplates.map((template) => (
                <div
                  key={template.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-neutral-50/50"
                >
                  <div>
                    <p className="font-medium text-sm">{template.lesson_name}</p>
                    {template.instructor?.name && (
                      <p className="text-xs text-neutral-500 ms-0">{template.instructor.name}</p>
                    )}
                  </div>
                  <Badge variant="secondary" className="text-xs">פעיל</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-neutral-500 py-2">אין קורסים פעילים</p>
          )}
        </CardContent>
      </Card>

      {/* Financial Summary Card - Placeholder */}
      <Card className="opacity-50 md:col-span-1 lg:col-span-1">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-amber-600" />
            <CardTitle className="text-lg">סיכום כספי</CardTitle>
          </div>
          <CardDescription>לא זמין בגרסה זו</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-neutral-500">יוטמע בחדשים הקרובים</p>
        </CardContent>
      </Card>

      {/* Internal Notes Card - Amber Tinted (Spans full width on mobile) */}
      <Card className="border-t-4 border-t-amber-400 md:col-span-2 lg:col-span-3">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Notebook className="h-5 w-5 text-amber-600" />
            <CardTitle className="text-lg">הערות פנימיות</CardTitle>
          </div>
          <CardDescription>מידע סוחף עבור צוות</CardDescription>
        </CardHeader>
        <CardContent>
          {student?.metadata?.internal_notes ? (
            <p className="text-sm whitespace-pre-wrap text-neutral-700">
              {student.metadata.internal_notes}
            </p>
          ) : (
            <p className="text-sm text-neutral-500">אין הערות פנימיות</p>
          )}
        </CardContent>
      </Card>

      {/* Student Status Card */}
      <Card className="md:col-span-2 lg:col-span-3">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">סטטוס תלמיד</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-neutral-500 mb-1">סטטוס</p>
              <Badge variant={student?.is_active ? 'secondary' : 'destructive'}>
                {student?.is_active ? 'פעיל' : 'לא פעיל'}
              </Badge>
            </div>
            {student?.identity_number && (
              <div>
                <p className="text-xs text-neutral-500 mb-1">מ.ז</p>
                <p className="font-semibold text-sm">{student.identity_number}</p>
              </div>
            )}
            {student?.phone && (
              <div>
                <p className="text-xs text-neutral-500 mb-1">טלפון</p>
                <a
                  href={`tel:${student.phone}`}
                  className="text-primary hover:underline text-sm font-semibold"
                >
                  {student.phone}
                </a>
              </div>
            )}
            {student?.email && (
              <div>
                <p className="text-xs text-neutral-500 mb-1">אימייל</p>
                <a
                  href={`mailto:${student.email}`}
                  className="text-primary hover:underline text-sm font-semibold break-all"
                >
                  {student.email}
                </a>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
