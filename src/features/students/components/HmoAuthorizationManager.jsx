import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { useMedicalProviders } from '@/features/students/hooks/useMedicalProviders.js';

function buildEmptyAuthorizationForm() {
  return {
    id: '',
    serviceId: '',
    providerId: '',
    providerTrackId: '',
    authorizationReference: '',
    authorizedLessons: '',
    validFrom: '',
    expiresAt: '',
    reminderDate: '',
    customerChargeAmountOverride: '',
    insurerClaimAmountOverride: '',
    workflowNotesOverride: '',
    status: 'active',
    notes: '',
  };
}

function formatCurrency(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `₪${Number(value).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(value));
}

function getStatusLabel(status) {
  switch (status) {
    case 'active':
      return 'פעיל';
    case 'cancelled':
      return 'בוטל';
    case 'completed':
      return 'הושלם';
    case 'expired':
      return 'פג תוקף';
    default:
      return status || 'לא ידוע';
  }
}

export default function HmoAuthorizationManager({
  studentId,
  services,
  canMutateBilling,
  onChanged = null,
  embedded = false,
  selectedAuthorizationId = '',
  onRequestSetup = null,
}) {
  const { session } = useAuth();
  const { activeOrgId } = useOrg();
  const {
    providers,
    loadingProviders,
    providersError,
    providersNotice,
    loadProviders,
  } = useMedicalProviders();

  const [authorizations, setAuthorizations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => buildEmptyAuthorizationForm());

  const availableTracks = useMemo(
    () => providers.flatMap((provider) => (
      Array.isArray(provider?.tracks)
        ? provider.tracks
          .filter((track) => track.is_active !== false || track.id === form.providerTrackId)
          .map((track) => ({ ...track, provider }))
        : []
    )),
    [providers, form.providerTrackId],
  );

  const selectedTrack = useMemo(
    () => availableTracks.find((track) => track.id === form.providerTrackId) || null,
    [availableTracks, form.providerTrackId],
  );

  const selectedProvider = useMemo(
    () => selectedTrack?.provider || providers.find((provider) => provider.id === form.providerId) || null,
    [providers, selectedTrack, form.providerId],
  );

  const activeAuthorizations = useMemo(
    () => authorizations.filter((row) => row.status === 'active'),
    [authorizations],
  );

  const editingAuthorization = useMemo(
    () => authorizations.find((row) => row.id === form.id) || null,
    [authorizations, form.id],
  );

  const loadAuthorizations = useCallback(async () => {
    if (!studentId || !activeOrgId) {
      setAuthorizations([]);
      return;
    }

    setLoading(true);
    try {
      const payload = await authenticatedFetch('hmo-authorizations', {
        session,
        params: {
          org_id: activeOrgId,
          student_id: studentId,
        },
      });
      setAuthorizations(Array.isArray(payload?.authorizations) ? payload.authorizations : []);
    } catch (error) {
      console.error('Failed to load HMO authorizations', error);
      toast.error(error?.message || 'טעינת האישורים נכשלה.');
      setAuthorizations([]);
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, session, studentId]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    void loadAuthorizations();
  }, [loadAuthorizations]);

  useEffect(() => {
    if (!selectedAuthorizationId) return;
    const selected = authorizations.find((row) => row.id === selectedAuthorizationId || row.linked_commitment?.id === selectedAuthorizationId);
    if (selected) {
      startEditingAuthorization(selected);
    }
  }, [authorizations, selectedAuthorizationId]);

  async function notifyChanged() {
    await loadAuthorizations();
    if (typeof onChanged === 'function') {
      await onChanged();
    }
  }

  function resetForm() {
    setForm(buildEmptyAuthorizationForm());
  }

  function startEditingAuthorization(row) {
    setForm({
      id: row.id,
      serviceId: row.service_id || '',
      providerId: row.provider_id || '',
      providerTrackId: row.provider_track_id || '',
      authorizationReference: row.authorization_reference || '',
      authorizedLessons: row.authorized_lessons ?? '',
      validFrom: row.valid_from || '',
      expiresAt: row.expires_at || '',
      reminderDate: row.reminder_date || '',
      customerChargeAmountOverride: row.customer_charge_amount_override ?? '',
      insurerClaimAmountOverride: row.insurer_claim_amount_override ?? '',
      workflowNotesOverride: row.workflow_notes_override || '',
      status: row.status || 'active',
      notes: row.notes || '',
    });
  }

  async function handleSave() {
    if (!activeOrgId || !studentId || !canMutateBilling) {
      return;
    }
    if (providers.length === 0) {
      toast.error('לפני יצירת אישור צריך להגדיר גורם מממן ומסלול.');
      return;
    }
    if (!form.providerTrackId) {
      toast.error('יש לבחור מסלול גורם מממן.');
      return;
    }
    if (!selectedTrack?.service_id) {
      toast.error('למסלול שנבחר חייב להיות שירות משויך.');
      return;
    }
    if (Number(form.authorizedLessons || 0) <= 0) {
      toast.error('יש להזין כמות מפגשים מאושרת.');
      return;
    }

    setSaving(true);
    try {
      const payload = await authenticatedFetch('hmo-authorizations', {
        session,
        method: form.id ? 'PUT' : 'POST',
        body: {
          id: form.id || undefined,
          org_id: activeOrgId,
          student_id: studentId,
          service_id: selectedTrack.service_id,
          provider_id: selectedTrack.provider?.id || form.providerId,
          provider_track_id: form.providerTrackId,
          authorization_reference: form.authorizationReference || null,
          authorized_lessons: Number(form.authorizedLessons),
          valid_from: form.validFrom || null,
          expires_at: form.expiresAt || null,
          reminder_date: form.reminderDate || null,
          customer_charge_amount_override: form.customerChargeAmountOverride === '' ? null : Number(form.customerChargeAmountOverride),
          insurer_claim_amount_override: form.insurerClaimAmountOverride === '' ? null : Number(form.insurerClaimAmountOverride),
          workflow_notes_override: form.workflowNotesOverride || null,
          status: form.status,
          notes: form.notes || null,
        },
      });

      void payload;
      resetForm();
      await notifyChanged();
      toast.success(form.id ? 'האישור עודכן.' : 'האישור נוצר והתחייבות ה-HMO עודכנה.');
    } catch (error) {
      console.error('Failed to save HMO authorization', error);
      toast.error(error?.message || 'שמירת האישור נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelAuthorization(id) {
    if (!activeOrgId || !id || !canMutateBilling) {
      return;
    }
    setSaving(true);
    try {
      await authenticatedFetch('hmo-authorizations', {
        session,
        method: 'DELETE',
        body: {
          org_id: activeOrgId,
          id,
        },
      });
      if (form.id === id) {
        resetForm();
      }
      await notifyChanged();
      toast.success('האישור בוטל וההתחייבות קפאה.');
    } catch (error) {
      console.error('Failed to cancel HMO authorization', error);
      toast.error(error?.message || 'ביטול האישור נכשל.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={embedded ? 'space-y-4' : 'grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]'}>
      {!embedded ? (
      <section className={`${embedded ? 'rounded-xl border border-border bg-slate-50/70' : 'rounded-xl border border-border bg-white shadow-sm overflow-hidden'}`}>
        <div className="h-1.5 bg-indigo-500" />
        <div className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-zinc-800">{embedded ? 'הגדרת גורם מממן' : 'אישורי גורם מממן'}</h3>
              <p className="text-sm text-muted-foreground">
                כאן מנהלים את האישור התפעולי של התלמיד. ההתחייבות הכספית נוצרת ומתעדכנת אוטומטית ממנו.
              </p>
            </div>
            {(loading || loadingProviders) ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>

          {activeAuthorizations.length > 0 ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-sm font-semibold text-emerald-900">אישורים פעילים</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {activeAuthorizations.map((row) => (
                  <Badge key={row.id} variant="outline" className="border-emerald-200 bg-white text-emerald-900">
                    {(services.find((service) => service.id === row.service_id)?.service_name || services.find((service) => service.id === row.service_id)?.name || 'שירות')}
                    {' • '}
                    {row.provider?.name || 'גורם מממן'}
                    {' • '}
                    {row.authorized_lessons} מפגשים
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {!loadingProviders && providersError ? (
            <div className="rounded-xl border border-dashed border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {providersError}
            </div>
          ) : null}

          {!loadingProviders && !providersError && availableTracks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-slate-50 p-4 text-sm text-muted-foreground">
              <div>{providersNotice || 'עדיין לא הוגדרו מסלולי גורם מממן בארגון.'}</div>
              {typeof onRequestSetup === 'function' ? (
                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRequestSetup}>
                  פתח הגדרות גורמים מממנים
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-3">
            {authorizations.map((row) => (
              <div key={row.id} className="rounded-xl border border-border bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900">
                      {services.find((service) => service.id === row.service_id)?.service_name || services.find((service) => service.id === row.service_id)?.name || 'שירות'}
                      {' • '}
                      {row.provider?.name || 'גורם מממן'}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {row.provider_track?.name || 'ללא מסלול'} • {getStatusLabel(row.status)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{row.authorization_reference || 'ללא מספר אישור'}</Badge>
                    <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-900">
                      {row.authorized_lessons} מפגשים
                    </Badge>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-3 text-sm">
                  <div className="rounded-lg bg-white p-3">
                    <div className="text-[11px] text-muted-foreground">חיוב לקוח</div>
                    <div className="mt-1 font-semibold">{formatCurrency(row.resolved_customer_charge_amount)}</div>
                  </div>
                  <div className="rounded-lg bg-white p-3">
                    <div className="text-[11px] text-muted-foreground">תביעה לקופה</div>
                    <div className="mt-1 font-semibold">{formatCurrency(row.resolved_insurer_claim_amount)}</div>
                  </div>
                  <div className="rounded-lg bg-white p-3">
                    <div className="text-[11px] text-muted-foreground">תוקף</div>
                    <div className="mt-1 font-semibold">{formatDate(row.expires_at)}</div>
                  </div>
                </div>

                <div className="mt-3 rounded-lg border border-border bg-white p-3 text-sm">
                  <div className="text-[11px] text-muted-foreground">הערת זרימה</div>
                  <div className="mt-1 text-zinc-800">{row.resolved_workflow_notes || '—'}</div>
                </div>

                {row.linked_commitment ? (
                  <div className="mt-3 rounded-lg border border-border bg-white p-3 text-sm">
                    <div className="text-[11px] text-muted-foreground">התחייבות מערכת מקושרת</div>
                    <div className="mt-1 font-semibold text-zinc-900">
                      {formatCurrency(row.linked_commitment.total_amount)} • {row.linked_commitment.is_active === false ? 'לא פעילה' : 'פעילה'}
                    </div>
                  </div>
                ) : null}

                {canMutateBilling ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => startEditingAuthorization(row)} disabled={saving}>
                      ערוך אישור
                    </Button>
                    {row.status === 'active' ? (
                      <Button type="button" size="sm" variant="outline" onClick={() => handleCancelAuthorization(row.id)} disabled={saving}>
                        בטל אישור
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}

            {!loading && authorizations.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-muted-foreground">
                אין אישורי גורם מממן לתלמיד הזה עדיין.
              </div>
            ) : null}
          </div>
        </div>
      </section>
      ) : null}

      {canMutateBilling ? (
        <section className={`${embedded ? 'rounded-xl border border-border bg-slate-50' : 'rounded-xl border border-border bg-white shadow-sm overflow-hidden'}`}>
          <div className="h-1.5 bg-indigo-600" />
          <div className="p-5 space-y-4">
            {availableTracks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-slate-50 p-4 text-sm text-muted-foreground">
                <div>לפני יצירת אישור צריך להגדיר לפחות מסלול גורם מממן אחד במסך ההגדרות.</div>
                {typeof onRequestSetup === 'function' ? (
                  <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRequestSetup}>
                    פתח הגדרות גורמים מממנים
                  </Button>
                ) : null}
              </div>
            ) : (
              <>
                <div>
                  <h3 className="text-lg font-semibold text-zinc-800">{form.id ? 'עריכת אישור' : 'אישור חדש'}</h3>
                  <p className="text-sm text-muted-foreground">
                    בוחרים מסלול שכבר הוגדר במערכת, בודקים את התנאים שלו, ואז מוסיפים רק את פרטי האישור של התלמיד.
                  </p>
                </div>

                {embedded ? (
                  <div className="rounded-xl border border-border bg-white p-4 text-sm">
                    <div className="font-semibold text-zinc-900">איך זה עובד</div>
                    <div className="mt-2 text-muted-foreground">
                      בוחרים מסלול קיים, מוסיפים את פרטי האישור של התלמיד, והמערכת יוצרת או מעדכנת אוטומטית את התחייבות הגורם המממן ברשימת ההתחייבויות והיתרות.
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label className="text-xs text-slate-600">מסלול</Label>
                  <Select
                    value={form.providerTrackId || '__none__'}
                    onValueChange={(value) => {
                      if (value === '__none__') {
                        setForm((current) => ({ ...current, providerId: '', providerTrackId: '' }));
                        return;
                      }
                      const track = availableTracks.find((item) => item.id === value) || null;
                      setForm((current) => ({
                        ...current,
                        providerId: track?.provider?.id || '',
                        providerTrackId: value,
                      }));
                    }}
                    disabled={saving}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="בחר מסלול" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">בחר מסלול</SelectItem>
                      {availableTracks.map((track) => (
                        <SelectItem key={track.id} value={track.id}>
                          {track.provider?.name || 'גורם מממן'} • {track.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className={`grid gap-3 ${embedded ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-3'}`}>
                  <div className="rounded-lg border border-border bg-white p-3 text-sm">
                    <div className="text-[11px] text-muted-foreground">גורם מממן</div>
                    <div className="mt-1 font-semibold text-zinc-900">{selectedProvider?.name || 'ייבחר לפי המסלול'}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-white p-3 text-sm">
                    <div className="text-[11px] text-muted-foreground">שירות המסלול</div>
                    <div className="mt-1 font-semibold text-zinc-900">
                      {services.find((service) => service.id === selectedTrack?.service_id)?.service_name
                        || services.find((service) => service.id === selectedTrack?.service_id)?.name
                        || 'ייבחר לפי המסלול'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-white p-3 text-sm">
                    <div className="text-[11px] text-muted-foreground">אופן תשלום</div>
                    <div className="mt-1 font-semibold text-zinc-900">{selectedTrack?.payment_mode || '—'}</div>
                  </div>
                  {embedded ? (
                    <div className="rounded-lg border border-border bg-white p-3 text-sm">
                      <div className="text-[11px] text-muted-foreground">אישור קיים</div>
                      <div className="mt-1 font-semibold text-zinc-900">
                        {editingAuthorization?.authorization_reference || (form.id ? 'אישור קיים ללא מספר' : 'אישור חדש לתלמיד')}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className={`grid gap-3 ${embedded ? 'md:grid-cols-2 xl:grid-cols-3' : 'md:grid-cols-3'}`}>
                  <div className="rounded-lg border border-border bg-white p-3 text-sm">
                    <div className="text-[11px] text-muted-foreground">חיוב לקוח לפי המסלול</div>
                    <div className="mt-1 font-semibold">{formatCurrency(selectedTrack?.default_customer_charge_amount)}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-white p-3 text-sm">
                    <div className="text-[11px] text-muted-foreground">תביעה לקופה לפי המסלול</div>
                    <div className="mt-1 font-semibold">{formatCurrency(selectedTrack?.default_insurer_claim_amount)}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-white p-3 text-sm">
                    <div className="text-[11px] text-muted-foreground">הערת זרימה במסלול</div>
                    <div className="mt-1 text-zinc-800">{selectedTrack?.default_workflow_notes || '—'}</div>
                  </div>
                </div>

                <div className={`grid gap-3 ${embedded ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
                  <div className="space-y-2">
                    <Label htmlFor="authorization-reference">מספר אישור / טופס</Label>
                    <Input id="authorization-reference" value={form.authorizationReference} onChange={(event) => setForm((current) => ({ ...current, authorizationReference: event.target.value }))} disabled={saving} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="authorized-lessons">כמות מפגשים מאושרת</Label>
                    <Input id="authorized-lessons" type="number" min="0" step="1" value={form.authorizedLessons} onChange={(event) => setForm((current) => ({ ...current, authorizedLessons: event.target.value }))} disabled={saving} />
                  </div>
                  {embedded ? (
                    <div className="space-y-2">
                      <Label htmlFor="expires-at-embedded">תוקף עד</Label>
                      <Input id="expires-at-embedded" type="date" value={form.expiresAt} onChange={(event) => setForm((current) => ({ ...current, expiresAt: event.target.value }))} disabled={saving} />
                    </div>
                  ) : null}
                </div>

                <div className={`grid gap-3 ${embedded ? 'md:grid-cols-2 xl:grid-cols-3' : 'md:grid-cols-3'}`}>
                  <div className="space-y-2">
                    <Label htmlFor="valid-from">תקף מ־</Label>
                    <Input id="valid-from" type="date" value={form.validFrom} onChange={(event) => setForm((current) => ({ ...current, validFrom: event.target.value }))} disabled={saving} />
                  </div>
                  {!embedded ? (
                    <div className="space-y-2">
                      <Label htmlFor="expires-at">תוקף עד</Label>
                      <Input id="expires-at" type="date" value={form.expiresAt} onChange={(event) => setForm((current) => ({ ...current, expiresAt: event.target.value }))} disabled={saving} />
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <Label htmlFor="reminder-date">תזכורת פעולה</Label>
                    <Input id="reminder-date" type="date" value={form.reminderDate} onChange={(event) => setForm((current) => ({ ...current, reminderDate: event.target.value }))} disabled={saving} />
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="customer-charge-override">חיוב לקוח מותאם</Label>
                    <Input id="customer-charge-override" type="number" min="0" step="0.01" value={form.customerChargeAmountOverride} onChange={(event) => setForm((current) => ({ ...current, customerChargeAmountOverride: event.target.value }))} disabled={saving} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="insurer-claim-override">תביעה לקופה מותאמת</Label>
                    <Input id="insurer-claim-override" type="number" min="0" step="0.01" value={form.insurerClaimAmountOverride} onChange={(event) => setForm((current) => ({ ...current, insurerClaimAmountOverride: event.target.value }))} disabled={saving} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="workflow-notes-override">הערת זרימה מותאמת</Label>
                  <Input id="workflow-notes-override" value={form.workflowNotesOverride} onChange={(event) => setForm((current) => ({ ...current, workflowNotesOverride: event.target.value }))} disabled={saving} />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-600">סטטוס</Label>
                    <Select value={form.status} onValueChange={(value) => setForm((current) => ({ ...current, status: value }))} disabled={saving}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">פעיל</SelectItem>
                        <SelectItem value="completed">הושלם</SelectItem>
                        <SelectItem value="expired">פג תוקף</SelectItem>
                        <SelectItem value="cancelled">בוטל</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="authorization-notes">הערות</Label>
                    <Input id="authorization-notes" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} disabled={saving} />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                    {form.id ? 'עדכן אישור' : 'צור אישור'}
                  </Button>
                  <Button type="button" variant="outline" onClick={resetForm} disabled={saving}>
                    נקה
                  </Button>
                </div>
              </>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
