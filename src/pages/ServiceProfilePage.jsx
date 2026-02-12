import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import PageLayout from '@/components/ui/PageLayout.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';

const REQUEST_STATE = Object.freeze({
  idle: 'idle',
  loading: 'loading',
  error: 'error',
});

export default function ServiceProfilePage() {
  const { id } = useParams();
  const serviceId = typeof id === 'string' ? id : '';
  const { activeOrgId, activeOrgHasConnection, tenantClientReady } = useOrg();
  const { session } = useSupabase();

  const [serviceState, setServiceState] = useState(REQUEST_STATE.idle);
  const [serviceError, setServiceError] = useState('');
  const [service, setService] = useState(null);

  const canFetch = Boolean(session && activeOrgId && tenantClientReady && activeOrgHasConnection);

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

  if (!activeOrgHasConnection) {
    return (
      <PageLayout title="שירות" description="פרופיל שירות">
        <Card>
          <CardContent className="p-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md">
            דרוש חיבור מאומת למסד הנתונים של הארגון כדי להציג שירות.
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
                <div>מודל תשלום: {service.payment_model || 'לא הוגדר'}</div>
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">שימושיות מתוכננת</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-neutral-600">
              <li>• תלמידים משויכים לשירות</li>
              <li>• עובדים/מדריכים שמספקים את השירות</li>
              <li>• היסטוריית שיעורים ושימושים</li>
              <li>• סטטיסטיקות וקיבולת עתידיות</li>
            </ul>
            <div className="mt-3 rounded-md border border-dashed border-neutral-200 p-3 text-xs text-neutral-500">
              אזור זה הוא מציין מקום. נרחיב את פרופיל השירות בהמשך.
            </div>
          </CardContent>
        </Card>

        <Link to="/services" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          חזרה לשירותים
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </PageLayout>
  );
}
