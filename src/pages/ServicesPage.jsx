import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, FileText, Sparkles, Loader2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageLayout from '@/components/ui/PageLayout.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SelectField, TextField } from '@/components/ui/forms-ui';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { normalizeMembershipRole, isAdminRole } from '@/features/students/utils/endpoints.js';
import { toShekel, toAgorot } from '@/lib/currency.js';
import { toast } from '@/lib/toast.jsx';
import { getQuestionsInOrder } from '@/features/forms/lib/form-schema.js';
import {
  buildDefaultReportFormSchema,
  DEFAULT_REPORT_FORM_DESCRIPTION,
  DEFAULT_REPORT_FORM_NAME,
} from '@/features/sessions/config/default-report-form.js';

const NO_REPORT_FORM_VALUE = '__none__';
const PREANSWERABLE_TYPES = new Set(['short_text', 'long_text']);

const PAYMENT_MODEL_OPTIONS = [
  { value: 'fixed_rate', label: 'תעריף קבוע' },
  { value: 'per_student', label: 'תעריף לתלמיד' },
];

function normalizePaymentModel(paymentModel) {
  return PAYMENT_MODEL_OPTIONS.some((option) => option.value === paymentModel) ? paymentModel : '';
}

function getPaymentModelLabel(paymentModel) {
  const match = PAYMENT_MODEL_OPTIONS.find((option) => option.value === paymentModel);
  return match?.label || '—';
}

const ENFORCEMENT_OPTIONS = [
  { value: 'warn', label: 'אזהרה בלבד' },
  { value: 'block', label: 'חסום יצירת שיעורים' },
];

const EMPTY_NEW_REQUIRED_FORM = { label: '', formId: '', enforcement: 'warn', allowResubmit: true };

function normalizeReportPreanswers(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized = {};
  for (const [key, entries] of Object.entries(value)) {
    if (Array.isArray(entries)) {
      normalized[key] = entries.filter((entry) => typeof entry === 'string' && entry.trim());
    }
  }
  return normalized;
}

function buildInitialForm(service) {
  return {
    id: service?.id || '',
    name: service?.name || '',
    durationMinutes: service?.duration_minutes ?? '',
    paymentModel: normalizePaymentModel(service?.payment_model || ''),
    defaultCustomerChargeAmount: service?.default_customer_charge_amount != null ? toShekel(service.default_customer_charge_amount) : '',
    color: service?.color || '#3b82f6',
    isActive: service?.is_active ?? true,
    requiredForms: Array.isArray(service?.required_forms) ? service.required_forms : [],
    reportFormId: service?.report_form_id || '',
    reportPreanswers: normalizeReportPreanswers(service?.metadata?.report_preanswers),
    metadata: service?.metadata && typeof service.metadata === 'object' ? service.metadata : {},
  };
}

export default function ServicesPage() {
  const { activeOrg, activeOrgId, orgSettings } = useOrg();
  const { session } = useSupabase();

  const membershipRole = normalizeMembershipRole(activeOrg?.membership?.role || null);
  const isAdmin = isAdminRole(membershipRole);

  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toggleId, setToggleId] = useState('');
  const [formValues, setFormValues] = useState(buildInitialForm());
  const [touched, setTouched] = useState({});
  const [availableRequiredForms, setAvailableRequiredForms] = useState([]);
  const [addingRequiredForm, setAddingRequiredForm] = useState(false);
  const [newRequiredFormEntry, setNewRequiredFormEntry] = useState(EMPTY_NEW_REQUIRED_FORM);
  const [editingRFIndex, setEditingRFIndex] = useState(null);
  const [editRFEntry, setEditRFEntry] = useState(EMPTY_NEW_REQUIRED_FORM);
  const [availableReportForms, setAvailableReportForms] = useState([]);
  const [loadingReportForms, setLoadingReportForms] = useState(false);
  const [creatingDefaultReportForm, setCreatingDefaultReportForm] = useState(false);
  const [reportFormQuestions, setReportFormQuestions] = useState([]);
  const [loadingReportFormQuestions, setLoadingReportFormQuestions] = useState(false);
  const [newPreanswerDrafts, setNewPreanswerDrafts] = useState({});

  // Gated specifically by session_form_preanswers_enabled (not the broader
  // session_reports_enabled) — see Phase 4 in implementations/session-reports/
  // implementation-plan.md.
  const preanswersFeatureEnabled = orgSettings?.permissions?.session_form_preanswers_enabled === true;

  const canFetch = Boolean(session && activeOrgId);

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

  const loadAvailableRequiredForms = useCallback(async () => {
    if (!canFetch) return;
    try {
      const payload = await authenticatedFetch('forms', {
        session,
        params: { org_id: activeOrgId, form_usage: 'required_form', is_active: true },
      });
      setAvailableRequiredForms(Array.isArray(payload) ? payload : []);
    } catch {
      setAvailableRequiredForms([]);
    }
  }, [canFetch, session, activeOrgId]);

  const loadAvailableReportForms = useCallback(async () => {
    if (!canFetch) return;
    setLoadingReportForms(true);
    try {
      const payload = await authenticatedFetch('forms', {
        session,
        params: { org_id: activeOrgId, form_usage: 'session_report', is_active: true },
      });
      const rows = Array.isArray(payload) ? payload : [];
      // Only published forms can back a live report drawer (see api/session-reports
      // POST: report_form_not_published). Draft session_report forms still show in
      // the main Forms list, but shouldn't be selectable here.
      setAvailableReportForms(rows.filter((form) => Boolean(form?.published_at)));
    } catch {
      setAvailableReportForms([]);
    } finally {
      setLoadingReportForms(false);
    }
  }, [canFetch, session, activeOrgId]);

  const loadReportFormQuestions = useCallback(async (formId) => {
    if (!canFetch || !formId) {
      setReportFormQuestions([]);
      return;
    }
    setLoadingReportFormQuestions(true);
    try {
      const payload = await authenticatedFetch(`forms/${formId}`, {
        session,
        params: { org_id: activeOrgId },
      });
      const questions = payload?.form_schema
        ? getQuestionsInOrder(payload.form_schema).filter((q) => PREANSWERABLE_TYPES.has(q.type))
        : [];
      setReportFormQuestions(questions);
    } catch {
      setReportFormQuestions([]);
    } finally {
      setLoadingReportFormQuestions(false);
    }
  }, [canFetch, session, activeOrgId]);

  const openCreateDialog = useCallback(() => {
    setFormValues(buildInitialForm());
    setTouched({});
    setAddingRequiredForm(false);
    setNewRequiredFormEntry(EMPTY_NEW_REQUIRED_FORM);
    setEditingRFIndex(null);
    setEditRFEntry(EMPTY_NEW_REQUIRED_FORM);
    setNewPreanswerDrafts({});
    setReportFormQuestions([]);
    setDialogOpen(true);
    void loadAvailableRequiredForms();
    void loadAvailableReportForms();
  }, [loadAvailableRequiredForms, loadAvailableReportForms]);

  const openEditDialog = (service) => {
    setFormValues(buildInitialForm(service));
    setTouched({});
    setAddingRequiredForm(false);
    setNewRequiredFormEntry(EMPTY_NEW_REQUIRED_FORM);
    setEditingRFIndex(null);
    setEditRFEntry(EMPTY_NEW_REQUIRED_FORM);
    setNewPreanswerDrafts({});
    setDialogOpen(true);
    void loadAvailableRequiredForms();
    void loadAvailableReportForms();
    void loadReportFormQuestions(service?.report_form_id || '');
  };

  useEffect(() => {
    if (!dialogOpen) return;
    void loadReportFormQuestions(formValues.reportFormId);
    // Only re-run when the selected report form actually changes while the
    // dialog is open (e.g. via the picker or the "create default form" button).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen, formValues.reportFormId]);

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
      defaultCustomerChargeAmount: true,
    };
    setTouched(nextTouched);

    if (!formValues.name.trim()) {
      return;
    }

    const durationNumber = formValues.durationMinutes === '' ? null : Number(formValues.durationMinutes);
    if (formValues.durationMinutes !== '' && (!Number.isFinite(durationNumber) || durationNumber <= 0)) {
      return;
    }
    const defaultCustomerChargeAmount = formValues.defaultCustomerChargeAmount === '' ? null : toAgorot(formValues.defaultCustomerChargeAmount);
    if (formValues.defaultCustomerChargeAmount !== '' && (!Number.isFinite(defaultCustomerChargeAmount) || defaultCustomerChargeAmount < 0)) {
      return;
    }

    setIsSubmitting(true);
    setError('');

    const nextMetadata = {
      ...formValues.metadata,
      report_preanswers: formValues.reportPreanswers,
    };

    const payload = {
      org_id: activeOrgId,
      name: formValues.name.trim(),
      duration_minutes: durationNumber,
      payment_model: formValues.paymentModel || null,
      default_customer_charge_amount: defaultCustomerChargeAmount,
      color: formValues.color || null,
      is_active: formValues.isActive,
      required_forms: formValues.requiredForms,
      report_form_id: formValues.reportFormId || null,
      metadata: nextMetadata,
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

  const handleCreateDefaultReportForm = async () => {
    setCreatingDefaultReportForm(true);
    try {
      const created = await authenticatedFetch('forms', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          name: DEFAULT_REPORT_FORM_NAME,
          description: DEFAULT_REPORT_FORM_DESCRIPTION,
          form_usage: 'session_report',
          form_schema: buildDefaultReportFormSchema(),
        },
      });
      if (!created?.id) {
        throw new Error('missing_form_id');
      }
      // Publish immediately so it's usable right away — the picker only
      // lists published session_report forms (report drawer requires a
      // published form, see api/session-reports POST).
      const published = await authenticatedFetch(`forms/${created.id}`, {
        session,
        method: 'PUT',
        body: {
          org_id: activeOrgId,
          form_schema: created.form_schema,
          action: 'publish',
          publish: true,
        },
      });
      toast.success('טופס דיווח ברירת המחדל נוצר ופורסם בהצלחה');
      await loadAvailableReportForms();
      setFormValues((prev) => ({ ...prev, reportFormId: published?.id || created.id }));
    } catch (err) {
      toast.error(err?.message || 'יצירת טופס דיווח ברירת המחדל נכשלה.');
    } finally {
      setCreatingDefaultReportForm(false);
    }
  };

  const handleAddPreanswer = (questionId) => {
    const draft = (newPreanswerDrafts[questionId] || '').trim();
    if (!draft) return;
    setFormValues((prev) => {
      const existing = Array.isArray(prev.reportPreanswers[questionId]) ? prev.reportPreanswers[questionId] : [];
      if (existing.includes(draft)) return prev;
      return {
        ...prev,
        reportPreanswers: {
          ...prev.reportPreanswers,
          [questionId]: [...existing, draft],
        },
      };
    });
    setNewPreanswerDrafts((prev) => ({ ...prev, [questionId]: '' }));
  };

  const handleRemovePreanswer = (questionId, value) => {
    setFormValues((prev) => {
      const existing = Array.isArray(prev.reportPreanswers[questionId]) ? prev.reportPreanswers[questionId] : [];
      return {
        ...prev,
        reportPreanswers: {
          ...prev.reportPreanswers,
          [questionId]: existing.filter((entry) => entry !== value),
        },
      };
    });
  };

  const nameError = touched.name && !formValues.name.trim() ? 'יש להזין שם שירות.' : '';
  const durationError = touched.durationMinutes && formValues.durationMinutes !== '' && (!Number.isFinite(Number(formValues.durationMinutes)) || Number(formValues.durationMinutes) <= 0)
    ? 'יש להזין משך תקין.'
    : '';
  const defaultCustomerChargeAmountError = touched.defaultCustomerChargeAmount
    && formValues.defaultCustomerChargeAmount !== ''
    && (!Number.isFinite(Number(formValues.defaultCustomerChargeAmount)) || Number(formValues.defaultCustomerChargeAmount) < 0)
    ? 'יש להזין מחיר תקין.'
    : '';

  const handleToggleActive = async (service) => {
    if (!service?.id) return;
    setToggleId(service.id);
    setError('');
    try {
      await authenticatedFetch(`services/${service.id}`, {
        method: 'PUT',
        session,
        body: {
          org_id: activeOrgId,
          is_active: !service.is_active,
        },
      });
      await loadServices();
    } catch (err) {
      setError(err?.message || 'עדכון סטטוס השירות נכשל.');
    } finally {
      setToggleId('');
    }
  };

  const pageActions = useMemo(() => {
    if (!isAdmin) {
      return null;
    }
    return (
      <Button onClick={openCreateDialog} className="gap-2" size="sm">
        <Plus className="h-4 w-4" />
        הוספת שירות
      </Button>
    );
  }, [isAdmin, openCreateDialog]);

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
    <PageLayout title="שירותים" description="ניהול שירותים זמינים במערכת" actions={pageActions}>
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
                    <TableHead>שם</TableHead>
                    <TableHead>משך</TableHead>
                    <TableHead>מודל תשלום</TableHead>
                    <TableHead>מחיר לקוח חד-פעמי</TableHead>
                    <TableHead>צבע</TableHead>
                    <TableHead>סטטוס</TableHead>
                    <TableHead>פעולות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {services.map((service) => (
                    <TableRow key={service.id}>
                      <TableCell className="font-medium">
                        <Link to={`/services/${service.id}`} className="text-primary hover:underline">
                          {service.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {service.duration_minutes ? `${service.duration_minutes} דק׳` : '—'}
                      </TableCell>
                      <TableCell>{getPaymentModelLabel(service.payment_model)}</TableCell>
                      <TableCell>
                        {service.default_customer_charge_amount == null ? '—' : `${toShekel(service.default_customer_charge_amount).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₪`}
                      </TableCell>
                      <TableCell>
                        {service.color ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="h-4 w-4 rounded-full border" style={{ backgroundColor: service.color }} />
                            <span>{service.color}</span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        {service.is_active === false ? 'מושהה' : 'פעיל'}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(service)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ms-2"
                          onClick={() => handleToggleActive(service)}
                          disabled={toggleId === service.id}
                        >
                          {service.is_active === false ? 'הפעל' : 'השבת'}
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
            <DialogDescription>
              עדכנו את פרטי השירות הזמין במערכת.
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
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

            <SelectField
              id="service-payment-model"
              label="מודל תשלום"
              value={formValues.paymentModel}
              onChange={(value) => setFormValues((prev) => ({ ...prev, paymentModel: value }))}
              options={PAYMENT_MODEL_OPTIONS}
              placeholder="בחר מודל תשלום"
              disabled={isSubmitting}
              error={error === 'invalid_payment_model' ? 'יש לבחור מודל תשלום תקין.' : ''}
              description="אופציונלי"
            />

            <TextField
              id="service-default-customer-charge"
              name="defaultCustomerChargeAmount"
              label="מחיר לקוח חד-פעמי"
              type="number"
              min="0"
              step="0.01"
              value={formValues.defaultCustomerChargeAmount}
              onChange={handleChange}
              onBlur={handleBlur}
              disabled={isSubmitting}
              error={defaultCustomerChargeAmountError}
              description="משמש לחיוב אוטומטי של לקוח חד-פעמי אחרי הגעה."
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

            {/* Required Forms Section */}
            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">טפסי חובה</span>
                {!addingRequiredForm && editingRFIndex === null && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1 text-xs"
                    onClick={() => setAddingRequiredForm(true)}
                    disabled={isSubmitting}
                  >
                    <Plus className="h-3 w-3" />
                    הוסף טופס חובה
                  </Button>
                )}
              </div>

              {formValues.requiredForms.length === 0 && !addingRequiredForm && (
                <p className="text-xs text-neutral-500">אין טפסי חובה מוגדרים לשירות זה.</p>
              )}

              {formValues.requiredForms.map((rf, index) => {
                const formName = availableRequiredForms.find((f) => f.id === rf.form_id)?.name || rf.form_id;
                const isEditing = editingRFIndex === index;
                return (
                  <div key={index}>
                    <div className="flex items-center justify-between rounded-md border border-border bg-muted/10 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{rf.label}</span>
                        <span className="block truncate text-xs text-neutral-500">{formName}</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge variant={rf.enforcement === 'block' ? 'destructive' : 'secondary'} className="text-xs">
                            {rf.enforcement === 'block' ? 'חסום' : 'אזהרה'}
                          </Badge>
                          {rf.allow_resubmit && (
                            <Badge variant="outline" className="text-xs">ניתן להגיש מחדש</Badge>
                          )}
                        </div>
                      </div>
                      <div className="ms-2 flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setEditingRFIndex(index);
                            setEditRFEntry({
                              label: rf.label,
                              formId: rf.form_id,
                              enforcement: rf.enforcement,
                              allowResubmit: rf.allow_resubmit,
                            });
                            setAddingRequiredForm(false);
                          }}
                          disabled={isSubmitting}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            setFormValues((prev) => ({
                              ...prev,
                              requiredForms: prev.requiredForms.filter((_, i) => i !== index),
                            }));
                            if (editingRFIndex === index) setEditingRFIndex(null);
                          }}
                          disabled={isSubmitting}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {isEditing && (
                      <div className="mt-1 space-y-3 rounded-md border border-dashed border-primary/40 p-3">
                        <TextField
                          id={`edit-rf-label-${index}`}
                          label="תווית"
                          value={editRFEntry.label}
                          onChange={(e) => setEditRFEntry((prev) => ({ ...prev, label: e.target.value }))}
                          disabled={isSubmitting}
                        />
                        <SelectField
                          id={`edit-rf-form-${index}`}
                          label="טופס"
                          value={editRFEntry.formId}
                          onChange={(value) => setEditRFEntry((prev) => ({ ...prev, formId: value }))}
                          options={availableRequiredForms.map((f) => ({ value: f.id, label: f.name }))}
                          placeholder="בחר טופס"
                          disabled={isSubmitting}
                        />
                        <SelectField
                          id={`edit-rf-enforcement-${index}`}
                          label="אכיפה"
                          value={editRFEntry.enforcement}
                          onChange={(value) => setEditRFEntry((prev) => ({ ...prev, enforcement: value }))}
                          options={ENFORCEMENT_OPTIONS}
                          disabled={isSubmitting}
                        />
                        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
                          <span className="text-sm text-foreground">אפשר הגשה מחדש</span>
                          <Switch
                            checked={editRFEntry.allowResubmit}
                            onCheckedChange={(checked) => setEditRFEntry((prev) => ({ ...prev, allowResubmit: checked }))}
                            disabled={isSubmitting}
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingRFIndex(null)}
                            disabled={isSubmitting}
                          >
                            ביטול
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={isSubmitting || !editRFEntry.label.trim() || !editRFEntry.formId}
                            onClick={() => {
                              setFormValues((prev) => {
                                const next = [...prev.requiredForms];
                                next[index] = {
                                  form_id: editRFEntry.formId,
                                  label: editRFEntry.label.trim(),
                                  enforcement: editRFEntry.enforcement,
                                  allow_resubmit: editRFEntry.allowResubmit,
                                };
                                return { ...prev, requiredForms: next };
                              });
                              setEditingRFIndex(null);
                            }}
                          >
                            שמור
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {addingRequiredForm && (
                <div className="space-y-3 rounded-md border border-dashed border-primary/40 p-3">
                  <TextField
                    id="new-rf-label"
                    label="תווית (למשל: טופס קבלה)"
                    value={newRequiredFormEntry.label}
                    onChange={(e) => setNewRequiredFormEntry((prev) => ({ ...prev, label: e.target.value }))}
                    disabled={isSubmitting}
                  />
                  <SelectField
                    id="new-rf-form"
                    label="טופס"
                    value={newRequiredFormEntry.formId}
                    onChange={(value) => setNewRequiredFormEntry((prev) => ({ ...prev, formId: value }))}
                    options={availableRequiredForms.map((f) => ({ value: f.id, label: f.name }))}
                    placeholder="בחר טופס"
                    disabled={isSubmitting}
                  />
                  <SelectField
                    id="new-rf-enforcement"
                    label="אכיפה"
                    value={newRequiredFormEntry.enforcement}
                    onChange={(value) => setNewRequiredFormEntry((prev) => ({ ...prev, enforcement: value }))}
                    options={ENFORCEMENT_OPTIONS}
                    disabled={isSubmitting}
                  />
                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
                    <span className="text-sm text-foreground">אפשר הגשה מחדש</span>
                    <Switch
                      checked={newRequiredFormEntry.allowResubmit}
                      onCheckedChange={(checked) => setNewRequiredFormEntry((prev) => ({ ...prev, allowResubmit: checked }))}
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => { setAddingRequiredForm(false); setNewRequiredFormEntry(EMPTY_NEW_REQUIRED_FORM); }}
                      disabled={isSubmitting}
                    >
                      ביטול
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={isSubmitting || !newRequiredFormEntry.label.trim() || !newRequiredFormEntry.formId}
                      onClick={() => {
                        setFormValues((prev) => ({
                          ...prev,
                          requiredForms: [
                            ...prev.requiredForms,
                            {
                              form_id: newRequiredFormEntry.formId,
                              label: newRequiredFormEntry.label.trim(),
                              enforcement: newRequiredFormEntry.enforcement,
                              allow_resubmit: newRequiredFormEntry.allowResubmit,
                            },
                          ],
                        }));
                        setAddingRequiredForm(false);
                        setNewRequiredFormEntry(EMPTY_NEW_REQUIRED_FORM);
                      }}
                    >
                      הוסף
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Report Form Section */}
            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-neutral-500" />
                <span className="text-sm font-medium text-foreground">טופס דיווח</span>
              </div>

              {availableReportForms.length > 0 ? (
                <SelectField
                  id="service-report-form"
                  label="טופס דיווח"
                  value={formValues.reportFormId || NO_REPORT_FORM_VALUE}
                  onChange={(value) => setFormValues((prev) => ({
                    ...prev,
                    reportFormId: value === NO_REPORT_FORM_VALUE ? '' : value,
                  }))}
                  options={[
                    { value: NO_REPORT_FORM_VALUE, label: 'ללא טופס דיווח' },
                    ...availableReportForms.map((form) => ({ value: form.id, label: form.name })),
                  ]}
                  disabled={isSubmitting || loadingReportForms}
                />
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-neutral-500">
                    {loadingReportForms
                      ? 'טוען טפסי דיווח...'
                      : 'אין טפסי דיווח מפורסמים בארגון. אפשר ליצור טופס דיווח ברירת מחדל (זהה לשאלון המקורי) כדי להתחיל.'}
                  </p>
                  {!loadingReportForms && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={handleCreateDefaultReportForm}
                      disabled={isSubmitting || creatingDefaultReportForm}
                    >
                      {creatingDefaultReportForm ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      צור טופס דיווח ברירת מחדל
                    </Button>
                  )}
                </div>
              )}

              <p className="text-xs text-neutral-500">
                ניתן לתעד מפגשים של שירות זה רק אם יוגדר לו טופס דיווח.
              </p>
            </div>

            {/* Preanswers Bank Section (Phase 4 — service-universal bank) */}
            {preanswersFeatureEnabled && formValues.reportFormId ? (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-neutral-500" />
                  <span className="text-sm font-medium text-foreground">תשובות מוכנות ארגוניות</span>
                </div>
                <p className="text-xs text-neutral-500">
                  תשובות אלה יוצעו לכל המדריכים בעת מילוי דוח מפגש לשירות זה.
                </p>
                {loadingReportFormQuestions ? (
                  <div className="flex items-center gap-2 text-xs text-neutral-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    טוען שאלות מהטופס...
                  </div>
                ) : reportFormQuestions.length === 0 ? (
                  <p className="text-xs text-neutral-500">לטופס הדיווח שנבחר אין שדות טקסט חופשי שניתן להגדיר עבורם תשובות מוכנות.</p>
                ) : (
                  reportFormQuestions.map((question) => {
                    const entries = formValues.reportPreanswers[question.id] || [];
                    return (
                      <div key={question.id} className="space-y-2 rounded-md border border-border bg-muted/10 p-3">
                        <span className="block text-sm font-medium text-foreground">{question.label}</span>
                        {entries.length > 0 ? (
                          <ul className="space-y-1">
                            {entries.map((entry) => (
                              <li key={entry} className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1 text-sm">
                                <span className="flex-1 break-words">{entry}</span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-destructive hover:text-destructive"
                                  onClick={() => handleRemovePreanswer(question.id, entry)}
                                  disabled={isSubmitting}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-neutral-500">אין תשובות מוכנות לשדה זה.</p>
                        )}
                        <div className="flex gap-2">
                          <Input
                            value={newPreanswerDrafts[question.id] || ''}
                            onChange={(e) => setNewPreanswerDrafts((prev) => ({ ...prev, [question.id]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddPreanswer(question.id);
                              }
                            }}
                            placeholder="הוספת תשובה מוכנה"
                            disabled={isSubmitting}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleAddPreanswer(question.id)}
                            disabled={isSubmitting || !(newPreanswerDrafts[question.id] || '').trim()}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : null}

            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
              <div>
                <span className="block text-sm font-medium text-foreground">שירות פעיל</span>
                <span className="text-xs text-neutral-500">אפשר להשבית שירות בלי למחוק אותו.</span>
              </div>
              <Switch
                checked={formValues.isActive}
                onCheckedChange={(checked) => setFormValues((prev) => ({ ...prev, isActive: checked }))}
                disabled={isSubmitting}
              />
            </div>

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
