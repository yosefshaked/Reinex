import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageLayout from '@/components/ui/PageLayout.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TextField } from '@/components/ui/forms-ui';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { normalizeMembershipRole, isAdminRole } from '@/features/students/utils/endpoints.js';

function buildInitialForm(service) {
  return {
    id: service?.id || '',
    name: service?.name || '',
    durationMinutes: service?.duration_minutes ?? '',
    paymentModel: service?.payment_model || '',
    color: service?.color || '#3b82f6',
  };
}

export default function ServicesPage() {
  const { activeOrg, activeOrgId, activeOrgHasConnection, tenantClientReady } = useOrg();
  const { session } = useSupabase();

  const membershipRole = normalizeMembershipRole(activeOrg?.membership?.role || null);
  const isAdmin = isAdminRole(membershipRole);

  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formValues, setFormValues] = useState(buildInitialForm());
  const [touched, setTouched] = useState({});

  const canFetch = Boolean(session && activeOrgId && tenantClientReady && activeOrgHasConnection);

  const loadServices = useCallback(async () => {
    if (!canFetch) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const payload = await authenticatedFetch('services', {
        session,
        params: { org_id: activeOrgId },
      });
      setServices(Array.isArray(payload) ? payload : []);
    } catch (err) {
      setServices([]);
      setError(err?.message || 'טעינת השירותים נכשלה.');
    } finally {
      setLoading(false);
    }
  }, [canFetch, session, activeOrgId]);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  const openCreateDialog = () => {
    setFormValues(buildInitialForm());
    setTouched({});
    setDialogOpen(true);
  };

  const openEditDialog = (service) => {
    setFormValues(buildInitialForm(service));
    setTouched({});
    setDialogOpen(true);
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleBlur = (event) => {
    const { name } = event.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const nextTouched = {
      name: true,
      durationMinutes: true,
    };
    setTouched(nextTouched);

    if (!formValues.name.trim()) {
      return;
    }

    const durationNumber = formValues.durationMinutes === '' ? null : Number(formValues.durationMinutes);
    if (formValues.durationMinutes !== '' && (!Number.isFinite(durationNumber) || durationNumber <= 0)) {
      return;
    }

    setIsSubmitting(true);
    setError('');

    const payload = {
      org_id: activeOrgId,
      name: formValues.name.trim(),
      duration_minutes: durationNumber,
      payment_model: formValues.paymentModel.trim() || null,
      color: formValues.color || null,
    };

    const endpoint = formValues.id ? `services/${formValues.id}` : 'services';
    const method = formValues.id ? 'PUT' : 'POST';

    try {
      await authenticatedFetch(endpoint, {
        method,
        session,
        body: payload,
      });
      setDialogOpen(false);
      await loadServices();
    } catch (err) {
      setError(err?.message || 'שמירת השירות נכשלה.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const nameError = touched.name && !formValues.name.trim() ? 'יש להזין שם שירות.' : '';
  const durationError = touched.durationMinutes && formValues.durationMinutes !== '' && (!Number.isFinite(Number(formValues.durationMinutes)) || Number(formValues.durationMinutes) <= 0)
    ? 'יש להזין משך תקין.'
    : '';

  const headerActions = useMemo(() => {
    if (!isAdmin) {
      return null;
    }
    return (
      <Button onClick={openCreateDialog} className="gap-2" size="sm">
        <Plus className="h-4 w-4" />
        הוספת שירות
      </Button>
    );
  }, [isAdmin]);

  if (!activeOrgId) {
    return (
      <PageLayout title="שירותים">
        <Card>
          <CardContent className="p-4 text-sm text-neutral-600">
            בחרו ארגון כדי לנהל שירותים.
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  if (!activeOrgHasConnection) {
    return (
      <PageLayout title="שירותים">
        <Card>
          <CardContent className="p-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md">
            דרוש חיבור מאומת למסד הנתונים של הארגון כדי לנהל שירותים.
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  if (!isAdmin) {
    return (
      <PageLayout title="שירותים">
        <Card>
          <CardContent className="p-4 text-sm text-neutral-600">
            אין לך הרשאה לנהל שירותים.
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="שירותים" description="ניהול שירותים זמינים במערכת" headerActions={headerActions}>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">רשימת שירותים</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-neutral-500">טוען שירותים...</div>
          ) : error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
          ) : services.length === 0 ? (
            <div className="text-sm text-neutral-500">לא נמצאו שירותים.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">שם</TableHead>
                    <TableHead className="text-right">משך</TableHead>
                    <TableHead className="text-right">מודל תשלום</TableHead>
                    <TableHead className="text-right">צבע</TableHead>
                    <TableHead className="text-right">פעולות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {services.map((service) => (
                    <TableRow key={service.id}>
                      <TableCell className="text-right font-medium">
                        <Link to={`/services/${service.id}`} className="text-primary hover:underline">
                          {service.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">
                        {service.duration_minutes ? `${service.duration_minutes} דק׳` : '—'}
                      </TableCell>
                      <TableCell className="text-right">{service.payment_model || '—'}</TableCell>
                      <TableCell className="text-right">
                        {service.color ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="h-4 w-4 rounded-full border" style={{ backgroundColor: service.color }} />
                            <span>{service.color}</span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(service)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{formValues.id ? 'עריכת שירות' : 'שירות חדש'}</DialogTitle>
            <DialogDescription className="text-right">
              עדכנו את פרטי השירות הזמין במערכת.
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4" dir="rtl">
            <TextField
              id="service-name"
              name="name"
              label="שם השירות"
              value={formValues.name}
              onChange={handleChange}
              onBlur={handleBlur}
              required
              disabled={isSubmitting}
              error={nameError}
            />

            <TextField
              id="service-duration"
              name="durationMinutes"
              label="משך (דקות)"
              type="number"
              min="15"
              step="5"
              value={formValues.durationMinutes}
              onChange={handleChange}
              onBlur={handleBlur}
              disabled={isSubmitting}
              error={durationError}
              description="אופציונלי"
            />

            <TextField
              id="service-payment-model"
              name="paymentModel"
              label="מודל תשלום"
              value={formValues.paymentModel}
              onChange={handleChange}
              onBlur={handleBlur}
              disabled={isSubmitting}
              description="אופציונלי"
            />

            <TextField
              id="service-color"
              name="color"
              label="צבע"
              type="color"
              value={formValues.color}
              onChange={handleChange}
              disabled={isSubmitting}
              description="אופציונלי"
            />

            <div className="flex justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)} disabled={isSubmitting}>
                ביטול
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'שומר...' : 'שמור'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
