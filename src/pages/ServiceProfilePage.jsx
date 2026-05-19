import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowRight, CalendarClock, Clock, Users } from 'lucide-react';
import PageLayout from '@/components/ui/PageLayout.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { formatCurrency } from '@/lib/currency.js';
import { dayLabel, daySortValue } from '@/lib/day-of-week.js';
import { getAvailabilitySummary } from '@/lib/instructor-availability.js';
import { useCalendarInstructors } from '@/features/calendar/hooks/useCalendar.js';
import { useTemplates } from '@/features/calendar/hooks/useTemplates.js';

const REQUEST_STATE = Object.freeze({
  idle: 'idle',
  loading: 'loading',
  error: 'error',
});

function getPaymentModelLabel(paymentModel) {
  if (paymentModel === 'fixed_rate') {
    return 'תעריף קבוע';
  }
  if (paymentModel === 'per_student') {
    return 'תעריף לתלמיד';
  }
  return 'לא הוגדר';
}

function formatEmployeeName(employee) {
  const fullName = employee?.full_name
    || [employee?.first_name, employee?.middle_name, employee?.last_name].filter(Boolean).join(' ');
  return fullName || employee?.email || 'מדריך ללא שם';
}

function formatTemplateTime(template) {
  const day = dayLabel(template?.day_of_week) || 'יום לא ידוע';
  const time = String(template?.time_of_day || '').slice(0, 5) || 'שעה לא ידועה';
  const duration = Number(template?.duration_minutes) || 0;
  return duration > 0 ? `${day}, ${time} (${duration} דק׳)` : `${day}, ${time}`;
}

export default function ServiceProfilePage() {
  const { id } = useParams();
  const serviceId = typeof id === 'string' ? id : '';
  const { activeOrgId } = useOrg();
  const { session } = useSupabase();

  const [serviceState, setServiceState] = useState(REQUEST_STATE.idle);
  const [serviceError, setServiceError] = useState('');
  const [service, setService] = useState(null);

  const {
    instructors,
    isLoading: instructorsLoading,
    error: instructorsError,
  } = useCalendarInstructors(false);
  const {
    templates,
    isLoading: templatesLoading,
    error: templatesError,
  } = useTemplates({ showInactive: false });

  const canFetch = Boolean(session && activeOrgId);

  const loadService = useCallback(async () => {
    if (!canFetch || !serviceId) {
      return;
    }

    setServiceState(REQUEST_STATE.loading);
    setServiceError('');

    try {
      const payload = await authenticatedFetch('services', {
        session,
        params: { org_id: activeOrgId },
      });
      const list = Array.isArray(payload) ? payload : [];
      const match = list.find((entry) => entry?.id === serviceId) || null;

      if (!match) {
        setService(null);
        setServiceState(REQUEST_STATE.error);
        setServiceError('השירות לא נמצא.');
        return;
      }

      setService(match);
      setServiceState(REQUEST_STATE.idle);
    } catch (error) {
      setService(null);
      setServiceState(REQUEST_STATE.error);
      setServiceError(error?.message || 'טעינת השירות נכשלה.');
    }
  }, [canFetch, serviceId, session, activeOrgId]);

  useEffect(() => {
    void loadService();
  }, [loadService]);

  const headerDescription = useMemo(() => {
    if (!service) {
      return 'פרופיל שירות';
    }
    return `פרופיל השירות ${service.name}`;
  }, [service]);

  const serviceInstructors = useMemo(() => {
    if (!serviceId) {
      return [];
    }

    return (Array.isArray(instructors) ? instructors : [])
      .map((instructor) => {
        const capability = (instructor?.service_capabilities || [])
          .find((entry) => String(entry?.service_id || '') === String(serviceId));
        return capability ? { instructor, capability } : null;
      })
      .filter(Boolean)
      .sort((left, right) => formatEmployeeName(left.instructor).localeCompare(formatEmployeeName(right.instructor), 'he'));
  }, [instructors, serviceId]);

  const serviceTemplates = useMemo(() => {
    if (!serviceId) {
      return [];
    }

    return (Array.isArray(templates) ? templates : [])
      .filter((template) => String(template?.service_id || '') === String(serviceId))
      .sort((left, right) => {
        const dayDiff = daySortValue(left?.day_of_week) - daySortValue(right?.day_of_week);
        if (dayDiff !== 0) return dayDiff;
        return String(left?.time_of_day || '').localeCompare(String(right?.time_of_day || ''));
      });
  }, [templates, serviceId]);

  const activeStudentCount = useMemo(() => {
    const ids = new Set(
      serviceTemplates
        .map((template) => template?.student_id)
        .filter(Boolean),
    );
    return ids.size;
  }, [serviceTemplates]);

  const relatedLoading = instructorsLoading || templatesLoading;
  const relatedError = instructorsError || templatesError || '';

  if (!serviceId) {
    return (
      <PageLayout title="שירות" description="פרופיל שירות">
        <Card>
          <CardContent className="p-4 text-sm text-neutral-600">
            לא נבחר שירות להצגה.
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  if (!activeOrgId) {
    return (
      <PageLayout title="שירות" description="פרופיל שירות">
        <Card>
          <CardContent className="p-4 text-sm text-neutral-600">
            בחרו ארגון כדי להציג שירות.
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="שירות" description={headerDescription}>
      <div className="space-y-lg">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">מידע בסיסי</CardTitle>
          </CardHeader>
          <CardContent>
            {serviceState === REQUEST_STATE.loading ? (
              <div className="text-sm text-neutral-500">טוען שירות...</div>
            ) : serviceState === REQUEST_STATE.error ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {serviceError}
              </div>
            ) : service ? (
              <div className="flex flex-col gap-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground">{service.name}</span>
                  <Badge variant="secondary">מזהה: {service.id}</Badge>
                </div>
                <div>משך: {service.duration_minutes ? `${service.duration_minutes} דק׳` : 'לא הוגדר'}</div>
                <div>מודל תשלום: {getPaymentModelLabel(service.payment_model)}</div>
                <div>מחיר לקוח חד-פעמי: {service.default_customer_charge_amount == null ? 'לא הוגדר' : formatCurrency(service.default_customer_charge_amount)}</div>
                <div className="flex items-center gap-2">
                  <span>צבע:</span>
                  {service.color ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 rounded-full border" style={{ backgroundColor: service.color }} />
                      {service.color}
                    </span>
                  ) : (
                    'לא הוגדר'
                  )}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-3 md:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <span className="rounded-lg bg-primary/10 p-2 text-primary">
                <Users className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <div className="text-xs text-neutral-500">מדריכים שמספקים</div>
                <div className="text-xl font-semibold">{serviceInstructors.length}</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <span className="rounded-lg bg-primary/10 p-2 text-primary">
                <CalendarClock className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <div className="text-xs text-neutral-500">תבניות פעילות</div>
                <div className="text-xl font-semibold">{serviceTemplates.length}</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <span className="rounded-lg bg-primary/10 p-2 text-primary">
                <Clock className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <div className="text-xs text-neutral-500">תלמידים בתבניות</div>
                <div className="text-xl font-semibold">{activeStudentCount}</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {relatedError ? (
          <Card>
            <CardContent className="p-4">
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                חלק מנתוני השימוש של השירות לא נטענו: {relatedError}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">מדריכים וזמינות</CardTitle>
            </CardHeader>
            <CardContent>
              {relatedLoading ? (
                <div className="text-sm text-neutral-500">טוען מדריכים...</div>
              ) : serviceInstructors.length === 0 ? (
                <div className="rounded-md border border-dashed border-neutral-200 p-4 text-sm text-neutral-500">
                  לא נמצאו מדריכים פעילים שמוגדרים לתת את השירות הזה.
                </div>
              ) : (
                <div className="space-y-3">
                  {serviceInstructors.map(({ instructor, capability }) => (
                    <div key={instructor.id} className="rounded-md border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium text-foreground">{formatEmployeeName(instructor)}</div>
                        <Badge variant={capability.setup_incomplete ? 'destructive' : 'secondary'}>
                          {capability.setup_incomplete ? 'הגדרה חסרה' : 'זמינות מוגדרת'}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-600">
                        <Badge variant="outline">
                          קיבולת: {capability.max_students || 'לא הוגדרה'}
                        </Badge>
                        <Badge variant="outline">
                          {getAvailabilitySummary(capability.availability_windows)}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">תבניות פעילות לשירות</CardTitle>
            </CardHeader>
            <CardContent>
              {relatedLoading ? (
                <div className="text-sm text-neutral-500">טוען תבניות...</div>
              ) : serviceTemplates.length === 0 ? (
                <div className="rounded-md border border-dashed border-neutral-200 p-4 text-sm text-neutral-500">
                  אין כרגע תבניות פעילות שמשתמשות בשירות הזה.
                </div>
              ) : (
                <div className="space-y-3">
                  {serviceTemplates.slice(0, 8).map((template) => (
                    <div key={template.id} className="rounded-md border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium text-foreground">{formatTemplateTime(template)}</div>
                        <Badge variant="secondary">
                          {template.student?.first_name || template.student?.last_name
                            ? [template.student.first_name, template.student.last_name].filter(Boolean).join(' ')
                            : 'ללא תלמיד'}
                        </Badge>
                      </div>
                      <div className="mt-2 text-xs text-neutral-600">
                        מדריך: {formatEmployeeName(template.instructor)}
                      </div>
                    </div>
                  ))}
                  {serviceTemplates.length > 8 ? (
                    <div className="text-xs text-neutral-500">
                      מוצגות 8 תבניות מתוך {serviceTemplates.length}. לניהול מלא עברו לעמוד התבניות.
                    </div>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Link to="/services" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          חזרה לשירותים
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </PageLayout>
  );
}
