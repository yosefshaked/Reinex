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
import CurrencyInput from '@/components/ui/CurrencyInput.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { coerceAgorot, formatCurrency, isValidCurrencyInput, toAgorot, toShekel } from '@/lib/currency.js';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { useMedicalProviders } from '@/features/students/hooks/useMedicalProviders.js';

function buildEmptyAuthorizationForm() {
  return {
    id: '',
    providerTrackId: '',
    authorizationReference: '',
    authorizedLessons: '',
    contractedRateAmount: '',
    validFrom: '',
    expiresAt: '',
    reminderDate: '',
    status: 'active',
    notes: '',
  };
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

function resolveSelectedService(services, selectedTrack) {
  if (!selectedTrack?.service_id) return null;
  return services.find((service) => service.id === selectedTrack.service_id) || null;
}

function buildAuthorizationSplitPreview({ selectedTrack, selectedService, contractedRateAmount }) {
  const paymentMode = selectedTrack?.payment_mode || 'partially_paid_by_hmo';
  const serviceRate = coerceAgorot(selectedService?.default_customer_charge_amount);
  const hmoShare = isValidCurrencyInput(contractedRateAmount) ? toAgorot(contractedRateAmount) : 0;

  if (!serviceRate && paymentMode !== 'fully_paid_by_hmo') {
    return null;
  }
  if (!hmoShare && paymentMode !== 'fully_paid_by_customer') {
    return null;
  }

  let studentCopay = 0;
  let insurerClaim = 0;

  if (paymentMode === 'fully_paid_by_hmo') {
    studentCopay = 0;
    insurerClaim = hmoShare;
  } else if (paymentMode === 'fully_paid_by_customer') {
    studentCopay = coerceAgorot(selectedTrack?.default_customer_charge_amount) || serviceRate;
    insurerClaim = 0;
  } else {
    const configuredCopay = coerceAgorot(selectedTrack?.default_customer_charge_amount);
    studentCopay = configuredCopay > 0 ? configuredCopay : Math.max(serviceRate - hmoShare, 0);
    insurerClaim = hmoShare;
  }

  return {
    paymentMode,
    serviceRate,
    studentCopay,
    insurerClaim,
    hmoExceedsRate: paymentMode === 'partially_paid_by_hmo' && hmoShare > serviceRate,
    usesDerivedCopay: paymentMode === 'partially_paid_by_hmo' && coerceAgorot(selectedTrack?.default_customer_charge_amount) <= 0,
  };
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
  const [cancelTargetId, setCancelTargetId] = useState('');
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

  const selectedService = useMemo(
    () => resolveSelectedService(services, selectedTrack),
    [services, selectedTrack],
  );

  const splitPreview = useMemo(
    () => buildAuthorizationSplitPreview({
      selectedTrack,
      selectedService,
      contractedRateAmount: form.contractedRateAmount,
    }),
    [form.contractedRateAmount, selectedService, selectedTrack],
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
    const selected = authorizations.find((row) => row.id === selectedAuthorizationId);
    if (selected) {
      setForm({
        id: selected.id,
        providerTrackId: selected.provider_track_id || '',
        authorizationReference: selected.authorization_reference || '',
        authorizedLessons: selected.authorized_lessons ?? '',
        contractedRateAmount: selected.contracted_rate_amount != null ? toShekel(selected.contracted_rate_amount) : '',
        validFrom: selected.valid_from || '',
        expiresAt: selected.expires_at || '',
        reminderDate: selected.reminder_date || '',
        status: selected.status || 'active',
        notes: selected.notes || '',
      });
    }
  }, [authorizations, selectedAuthorizationId]);

  async function notifyChanged() {
    await loadAuthorizations();
    if (typeof onChanged === 'function') {
      await onChanged();
    }
  }

  async function handleSave() {
    if (!activeOrgId || !studentId || !canMutateBilling) return;
    if (!form.providerTrackId) {
      toast.error('יש לבחור מסלול גורם מממן.');
      return;
    }
    if (Number(form.authorizedLessons || 0) <= 0) {
      toast.error('יש להזין כמות מפגשים מאושרת.');
      return;
    }
    if (!isValidCurrencyInput(form.contractedRateAmount)) {
      toast.error('התעריף החוזי חובה ויחייב להיות גדול מאפס. ללא ערך זה, כל חיובי השיעורים ייחסמו לאישור זה.');
      return;
    }

    setSaving(true);
    try {
      await authenticatedFetch('hmo-authorizations', {
        session,
        method: form.id ? 'PUT' : 'POST',
        body: {
          id: form.id || undefined,
          org_id: activeOrgId,
          student_id: studentId,
          provider_id: selectedTrack?.provider?.id || '',
          provider_track_id: form.providerTrackId,
          authorization_reference: form.authorizationReference || null,
          authorized_lessons: Number(form.authorizedLessons),
          contracted_rate_amount: form.contractedRateAmount === '' ? null : toAgorot(form.contractedRateAmount),
          valid_from: form.validFrom || null,
          expires_at: form.expiresAt || null,
          reminder_date: form.reminderDate || null,
          status: form.status,
          notes: form.notes || null,
        },
      });

      setForm(buildEmptyAuthorizationForm());
      await notifyChanged();
      toast.success(form.id ? 'האישור עודכן וחיובי השיעורים הרלוונטיים עודכנו אוטומטית.' : 'האישור נוצר וחיובי השיעורים הרלוונטיים עודכנו אוטומטית.');
    } catch (error) {
      console.error('Failed to save HMO authorization', error);
      toast.error(error?.message || 'שמירת האישור נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelAuthorization(id) {
    if (!activeOrgId || !id || !canMutateBilling) return;
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
        setForm(buildEmptyAuthorizationForm());
      }
      await notifyChanged();
      toast.success('האישור בוטל וחיובי השיעורים הרלוונטיים עודכנו אוטומטית.');
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
        <section className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="h-1.5 bg-indigo-500" />
          <div className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-zinc-800">אישורי גורם מממן</h3>
                <p className="text-sm text-muted-foreground">האישור קובע את התעריף החוזי שמחייב את הגורם המממן עבור שיעורים עתידיים.</p>
              </div>
              {(loading || loadingProviders) ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            </div>

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
              {authorizations.map((row) => {
                const serviceName = services.find((service) => service.id === row.service_id)?.service_name
                  || services.find((service) => service.id === row.service_id)?.name
                  || 'שירות';
                return (
                  <div key={row.id} className="rounded-xl border border-border bg-slate-50/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-zinc-900">{serviceName} • {row.provider?.name || 'גורם מממן'}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{row.provider_track?.name || 'ללא מסלול'} • {getStatusLabel(row.status)}</div>
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
                        <div className="text-[11px] text-muted-foreground">תעריף חוזי</div>
                        <div className="mt-1 font-semibold">{formatCurrency(row.contracted_rate_amount)}</div>
                      </div>
                      <div className="rounded-lg bg-white p-3">
                        <div className="text-[11px] text-muted-foreground">תוקף</div>
                        <div className="mt-1 font-semibold">{formatDate(row.expires_at)}</div>
                      </div>
                      <div className="rounded-lg bg-white p-3">
                        <div className="text-[11px] text-muted-foreground">תזכורת</div>
                        <div className="mt-1 font-semibold">{formatDate(row.reminder_date)}</div>
                      </div>
                    </div>

                    {canMutateBilling ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => setForm({
                          id: row.id,
                          providerTrackId: row.provider_track_id || '',
                          authorizationReference: row.authorization_reference || '',
                          authorizedLessons: row.authorized_lessons ?? '',
                          contractedRateAmount: row.contracted_rate_amount != null ? toShekel(row.contracted_rate_amount) : '',
                          validFrom: row.valid_from || '',
                          expiresAt: row.expires_at || '',
                          reminderDate: row.reminder_date || '',
                          status: row.status || 'active',
                          notes: row.notes || '',
                        })} disabled={saving}>
                          ערוך אישור
                        </Button>
                        {row.status === 'active' ? (
                          <Button type="button" size="sm" variant="outline" onClick={() => setCancelTargetId(row.id)} disabled={saving}>
                            בטל אישור
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}

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
        <section className={embedded ? '' : 'rounded-xl border border-border bg-white shadow-sm overflow-hidden'}>
          {!embedded ? <div className="h-1.5 bg-indigo-600" /> : null}
          <div className={embedded ? 'space-y-4' : 'p-5 space-y-4'}>
            <div className="space-y-2">
              <Label className="text-xs text-slate-600">מסלול</Label>
              <Select
                value={form.providerTrackId || '__none__'}
                onValueChange={(value) => setForm((current) => ({ ...current, providerTrackId: value === '__none__' ? '' : value }))}
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

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="authorization-reference">מספר אישור</Label>
                <Input id="authorization-reference" value={form.authorizationReference} onChange={(event) => setForm((current) => ({ ...current, authorizationReference: event.target.value }))} disabled={saving} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="authorized-lessons">כמות מפגשים מאושרת</Label>
                <Input id="authorized-lessons" type="number" min="0" step="1" value={form.authorizedLessons} onChange={(event) => setForm((current) => ({ ...current, authorizedLessons: event.target.value }))} disabled={saving} />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contracted-rate-amount">
                  תעריף חוזי (גורם מממן משלם לשיעור)
                  <span className="ms-1 text-destructive">*</span>
                </Label>
                <CurrencyInput
                  id="contracted-rate-amount"
                  value={form.contractedRateAmount}
                  onChange={(value) => setForm((current) => ({ ...current, contractedRateAmount: value }))}
                  disabled={saving}
                />
              </div>
              <div className="rounded-lg border border-border bg-white p-3 text-sm">
                <div className="text-[11px] text-muted-foreground">ברירת מחדל מהמסלול</div>
                <div className="mt-1 font-semibold">{formatCurrency(selectedTrack?.default_insurer_claim_amount)}</div>
              </div>
            </div>

            {splitPreview ? (
              <div className={`rounded-lg border px-3 py-2 text-sm ${splitPreview.hmoExceedsRate ? 'border-amber-200 bg-amber-50' : 'border-blue-100 bg-blue-50'}`}>
                <div className="text-xs font-medium text-zinc-700">תצוגה מקדימה לחיוב לכל שיעור</div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs">
                  <span>שירות: <strong className="text-zinc-900">{selectedService ? formatCurrency(splitPreview.serviceRate) : 'לא נמצא תעריף שירות'}</strong></span>
                  <span>תלמיד: <strong className="text-zinc-900">{formatCurrency(splitPreview.studentCopay)}</strong></span>
                  <span>גורם מממן: <strong className="text-zinc-900">{formatCurrency(splitPreview.insurerClaim)}</strong></span>
                </div>
                {splitPreview.usesDerivedCopay ? (
                  <p className="mt-1 text-xs text-blue-700">השתתפות הלקוח תחושב אוטומטית: תעריף השירות פחות התעריף החוזי.</p>
                ) : null}
                {splitPreview.paymentMode === 'fully_paid_by_hmo' ? (
                  <p className="mt-1 text-xs text-blue-700">במסלול זה הלקוח לא מחויב. הגורם המממן מחויב לפי התעריף החוזי באישור.</p>
                ) : null}
                {splitPreview.paymentMode === 'fully_paid_by_customer' ? (
                  <p className="mt-1 text-xs text-blue-700">במסלול זה אין חיוב לגורם מממן. הלקוח יחויב לפי מחיר המסלול או תעריף השירות.</p>
                ) : null}
                {splitPreview.hmoExceedsRate ? (
                  <p className="mt-1 text-xs text-amber-700">התעריף החוזי עולה על תעריף השירות. ההשתתפות העצמית של התלמיד תהיה ₪0.00.</p>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="valid-from">תקף מ־</Label>
                <Input id="valid-from" type="date" value={form.validFrom} onChange={(event) => setForm((current) => ({ ...current, validFrom: event.target.value }))} disabled={saving} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expires-at">תוקף עד</Label>
                <Input id="expires-at" type="date" value={form.expiresAt} onChange={(event) => setForm((current) => ({ ...current, expiresAt: event.target.value }))} disabled={saving} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reminder-date">תזכורת פעולה</Label>
                <Input id="reminder-date" type="date" value={form.reminderDate} onChange={(event) => setForm((current) => ({ ...current, reminderDate: event.target.value }))} disabled={saving} />
              </div>
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
              <Button type="button" variant="outline" onClick={() => setForm(buildEmptyAuthorizationForm())} disabled={saving}>
                נקה
              </Button>
              {cancelTargetId ? (
                <Button type="button" variant="outline" onClick={() => { void handleCancelAuthorization(cancelTargetId); setCancelTargetId(''); }} disabled={saving}>
                  אשר ביטול
                </Button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
