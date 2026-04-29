import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet.jsx';
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
import { formatCurrency, isValidCurrencyInput, toAgorot, toShekel } from '@/lib/currency.js';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { useMedicalProviders } from '@/features/students/hooks/useMedicalProviders.js';
import { clearSheetDraft, readSheetDraft, writeSheetDraft } from '@/features/finance/utils/sheetDraftStorage.js';

function buildEmptyAuthorizationForm() {
  return {
    id: '',
    providerTrackId: '',
    authorizationReference: '',
    authorizedLessons: '',
    coveredCustomerChargeAmount: '',
    coveredInsurerClaimAmount: '',
    postCoveragePolicy: 'service_default',
    postCoverageCustomerChargeAmount: '',
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

function describePostCoverage(policy, amount) {
  if (policy === 'explicit_customer_charge') {
    return amount == null ? 'מחיר המשך חסר' : formatCurrency(amount);
  }
  if (policy === 'manual_block') {
    return 'חסימה להחלטה ידנית';
  }
  return 'מחיר שירות רגיל';
}

function getLessonCountDisplay(row) {
  const counts = row?.lesson_counts || null;
  return {
    consumed: Number(counts?.consumed_lessons || 0),
    reserved: Number(counts?.reserved_lessons || 0),
    available: Number(counts?.available_lessons_to_book || 0),
  };
}

function mapAuthorizationErrorMessage(code) {
  switch (String(code || '').trim()) {
    case 'missing_covered_customer_charge_amount':
      return 'לא ניתן לשמור אישור בלי מחיר לקוח מפורש בזמן כיסוי.';
    case 'missing_covered_insurer_claim_amount':
      return 'לא ניתן לשמור אישור בלי סכום מפורש לגורם המממן בזמן כיסוי.';
    case 'missing_post_coverage_customer_charge_amount':
      return 'לא ניתן לשמור מדיניות מחיר המשך מפורש בלי סכום המשך ללקוח.';
    case 'authorization_overlap_conflict':
      return 'קיים כבר אישור פעיל חופף לאותו תלמיד ולאותו שירות בטווח שבחרת.';
    case 'invalid_authorization_window':
      return 'טווח התאריכים של האישור אינו תקין: תאריך התחלה מאוחר מתאריך הסיום.';
    default:
      return String(code || '').trim() || 'שמירת האישור נכשלה.';
  }
}

function buildPreview(form) {
  const coveredCustomerAmount = isValidCurrencyInput(form.coveredCustomerChargeAmount)
    ? toAgorot(form.coveredCustomerChargeAmount)
    : null;
  const coveredInsurerAmount = isValidCurrencyInput(form.coveredInsurerClaimAmount)
    ? toAgorot(form.coveredInsurerClaimAmount)
    : null;
  const postCoverageCustomerAmount = isValidCurrencyInput(form.postCoverageCustomerChargeAmount)
    ? toAgorot(form.postCoverageCustomerChargeAmount)
    : null;

  let blockingReason = '';
  if (coveredCustomerAmount == null) {
    blockingReason = 'missing_covered_customer_charge_amount';
  } else if (coveredInsurerAmount == null) {
    blockingReason = 'missing_covered_insurer_claim_amount';
  } else if (form.postCoveragePolicy === 'explicit_customer_charge' && postCoverageCustomerAmount == null) {
    blockingReason = 'missing_post_coverage_customer_charge_amount';
  }

  return {
    coveredCustomerAmount,
    coveredInsurerAmount,
    postCoveragePolicy: form.postCoveragePolicy,
    postCoverageCustomerAmount,
    blockingReason,
  };
}

function buildFormFromAuthorization(selected) {
  return {
    id: selected.id,
    providerTrackId: selected.provider_track_id || '',
    authorizationReference: selected.authorization_reference || '',
    authorizedLessons: selected.authorized_lessons ?? '',
    coveredCustomerChargeAmount: selected.covered_customer_charge_amount != null ? toShekel(selected.covered_customer_charge_amount) : '',
    coveredInsurerClaimAmount: selected.covered_insurer_claim_amount != null ? toShekel(selected.covered_insurer_claim_amount) : '',
    postCoveragePolicy: selected.post_coverage_policy || 'service_default',
    postCoverageCustomerChargeAmount: selected.post_coverage_customer_charge_amount != null ? toShekel(selected.post_coverage_customer_charge_amount) : '',
    validFrom: selected.valid_from || '',
    expiresAt: selected.expires_at || '',
    reminderDate: selected.reminder_date || '',
    status: selected.status || 'active',
    notes: selected.notes || '',
  };
}

function normalizeAuthorizationDraft(value, fallback) {
  const base = { ...buildEmptyAuthorizationForm(), ...(fallback || {}) };
  if (!value || typeof value !== 'object') {
    return base;
  }

  return {
    ...base,
    id: typeof value.id === 'string' ? value.id : base.id,
    providerTrackId: typeof value.providerTrackId === 'string' ? value.providerTrackId : base.providerTrackId,
    authorizationReference: typeof value.authorizationReference === 'string' ? value.authorizationReference : base.authorizationReference,
    authorizedLessons: typeof value.authorizedLessons === 'string' || typeof value.authorizedLessons === 'number'
      ? String(value.authorizedLessons)
      : base.authorizedLessons,
    coveredCustomerChargeAmount: typeof value.coveredCustomerChargeAmount === 'string' ? value.coveredCustomerChargeAmount : base.coveredCustomerChargeAmount,
    coveredInsurerClaimAmount: typeof value.coveredInsurerClaimAmount === 'string' ? value.coveredInsurerClaimAmount : base.coveredInsurerClaimAmount,
    postCoveragePolicy: typeof value.postCoveragePolicy === 'string' ? value.postCoveragePolicy : base.postCoveragePolicy,
    postCoverageCustomerChargeAmount: typeof value.postCoverageCustomerChargeAmount === 'string' ? value.postCoverageCustomerChargeAmount : base.postCoverageCustomerChargeAmount,
    validFrom: typeof value.validFrom === 'string' ? value.validFrom : base.validFrom,
    expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : base.expiresAt,
    reminderDate: typeof value.reminderDate === 'string' ? value.reminderDate : base.reminderDate,
    status: typeof value.status === 'string' ? value.status : base.status,
    notes: typeof value.notes === 'string' ? value.notes : base.notes,
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cancelTargetId, setCancelTargetId] = useState('');
  const [form, setForm] = useState(() => buildEmptyAuthorizationForm());
  const [draftKey, setDraftKey] = useState('');
  const [draftReady, setDraftReady] = useState(false);

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

  const preview = useMemo(() => buildPreview(form), [form]);

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
      const nextDraftKey = activeOrgId && studentId ? `hmo-authorization:${activeOrgId}:${studentId}:${selected.id}` : '';
      setDraftKey(nextDraftKey);
      setForm(buildFormFromAuthorization(selected));
      setSheetOpen(true);
    }
  }, [activeOrgId, authorizations, selectedAuthorizationId, studentId]);

  useEffect(() => {
    if (!sheetOpen || !draftKey) {
      setDraftReady(false);
      return;
    }

    const draft = readSheetDraft(draftKey);
    if (draft) {
      setForm((current) => normalizeAuthorizationDraft(draft, current));
    }
    setDraftReady(true);
  }, [draftKey, sheetOpen]);

  useEffect(() => {
    if (!sheetOpen || !draftKey || !draftReady) {
      return;
    }
    writeSheetDraft(draftKey, form);
  }, [draftKey, draftReady, form, sheetOpen]);

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
    if (preview.blockingReason) {
      toast.error(mapAuthorizationErrorMessage(preview.blockingReason));
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
          covered_customer_charge_amount: toAgorot(form.coveredCustomerChargeAmount),
          covered_insurer_claim_amount: toAgorot(form.coveredInsurerClaimAmount),
          post_coverage_policy: form.postCoveragePolicy,
          post_coverage_customer_charge_amount: form.postCoveragePolicy === 'explicit_customer_charge'
            ? toAgorot(form.postCoverageCustomerChargeAmount)
            : null,
          valid_from: form.validFrom || null,
          expires_at: form.expiresAt || null,
          reminder_date: form.reminderDate || null,
          status: form.status,
          notes: form.notes || null,
        },
      });

      clearSheetDraft(draftKey);
      setForm(buildEmptyAuthorizationForm());
      await notifyChanged();
      setSheetOpen(false);
      setDraftKey('');
      toast.success(form.id ? 'האישור עודכן וחיובי השיעורים הרלוונטיים עודכנו אוטומטית.' : 'האישור נוצר וחיובי השיעורים הרלוונטיים עודכנו אוטומטית.');
    } catch (error) {
      console.error('Failed to save HMO authorization', error);
      toast.error(mapAuthorizationErrorMessage(error?.data?.message || error?.message));
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
        clearSheetDraft(draftKey);
        setForm(buildEmptyAuthorizationForm());
        setSheetOpen(false);
        setDraftKey('');
      }
      await notifyChanged();
      setCancelTargetId('');
      toast.success('האישור בוטל וחיובי השיעורים הרלוונטיים עודכנו אוטומטית.');
    } catch (error) {
      console.error('Failed to cancel HMO authorization', error);
      toast.error(error?.message || 'ביטול האישור נכשל.');
    } finally {
      setSaving(false);
    }
  }

  function handleTrackSelection(value) {
    const nextTrackId = value === '__none__' ? '' : value;
    const nextTrack = availableTracks.find((track) => track.id === nextTrackId) || null;
    setForm((current) => ({
      ...current,
      providerTrackId: nextTrackId,
      coveredCustomerChargeAmount: current.id
        ? current.coveredCustomerChargeAmount
        : (nextTrack ? toShekel(nextTrack.default_customer_charge_amount) : ''),
      coveredInsurerClaimAmount: current.id
        ? current.coveredInsurerClaimAmount
        : (nextTrack ? toShekel(nextTrack.default_insurer_claim_amount) : ''),
      postCoveragePolicy: current.id
        ? current.postCoveragePolicy
        : (nextTrack?.default_post_coverage_policy || 'service_default'),
      postCoverageCustomerChargeAmount: current.id
        ? current.postCoverageCustomerChargeAmount
        : (nextTrack?.default_post_coverage_customer_charge_amount != null
          ? toShekel(nextTrack.default_post_coverage_customer_charge_amount)
          : ''),
    }));
  }

  function handleCreateAuthorization() {
    setCancelTargetId('');
    setDraftKey(activeOrgId && studentId ? `hmo-authorization:${activeOrgId}:${studentId}:new` : '');
    setForm(buildEmptyAuthorizationForm());
    setSheetOpen(true);
  }

  function handleEditAuthorization(row) {
    setCancelTargetId('');
    setDraftKey(activeOrgId && studentId ? `hmo-authorization:${activeOrgId}:${studentId}:${row.id}` : '');
    setForm(buildFormFromAuthorization(row));
    setSheetOpen(true);
  }

  function handleCloseSheet(open) {
    if (saving) return;
    setSheetOpen(open);
    if (!open) {
      setCancelTargetId('');
      setDraftReady(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm shadow-slate-200/70 overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">אישורי גורם מממן</h3>
              <p className="text-sm text-slate-500">רשימת האישורים הפעילים וההיסטוריים, עם סיכום המכסה, מחירי הכיסוי ומדיניות ההמשך.</p>
            </div>
            <div className="flex items-center gap-2">
              {(loading || loadingProviders) ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
              {canMutateBilling ? (
                <Button type="button" size="sm" onClick={handleCreateAuthorization} className="gap-2">
                  <Plus className="h-4 w-4" />
                  <span>הוספת אישור</span>
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4 sm:p-6">
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
              const lessonCountDisplay = getLessonCountDisplay(row);
              const isPendingCancel = cancelTargetId === row.id;
              return (
                <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{serviceName} • {row.provider?.name || 'גורם מממן'}</div>
                        <div className="mt-1 text-xs text-slate-500">{row.provider_track?.name || 'ללא מסלול'} • {getStatusLabel(row.status)}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary" className="bg-white text-slate-700 hover:bg-white">
                          נוצלו: {lessonCountDisplay.consumed}
                        </Badge>
                        <Badge variant="secondary" className="bg-white text-slate-700 hover:bg-white">
                          מתוכננים: {lessonCountDisplay.reserved}
                        </Badge>
                        <Badge variant="secondary" className="border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50">
                          זמינים לקביעת תור: {lessonCountDisplay.available}
                        </Badge>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{row.authorization_reference || 'ללא מספר אישור'}</Badge>
                      <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-900">
                        {row.authorized_lessons} מפגשים
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4 text-sm">
                    <div className="rounded-lg bg-white p-3">
                      <div className="text-[11px] text-slate-500">לקוח בזמן כיסוי</div>
                      <div className="mt-1 font-semibold text-slate-900">{formatCurrency(row.covered_customer_charge_amount)}</div>
                    </div>
                    <div className="rounded-lg bg-white p-3">
                      <div className="text-[11px] text-slate-500">גורם מממן בזמן כיסוי</div>
                      <div className="mt-1 font-semibold text-slate-900">{formatCurrency(row.covered_insurer_claim_amount)}</div>
                    </div>
                    <div className="rounded-lg bg-white p-3">
                      <div className="text-[11px] text-slate-500">אחרי מיצוי זכאות</div>
                      <div className="mt-1 font-semibold text-slate-900">{describePostCoverage(row.post_coverage_policy, row.post_coverage_customer_charge_amount)}</div>
                    </div>
                    <div className="rounded-lg bg-white p-3">
                      <div className="text-[11px] text-slate-500">תוקף</div>
                      <div className="mt-1 font-semibold text-slate-900">{formatDate(row.expires_at)}</div>
                    </div>
                  </div>

                  <div className="mt-2 space-y-1 text-xs text-slate-500">
                    <div>תזכורת: {formatDate(row.reminder_date)}</div>
                    <div>שיעורים מתוכננים כבר שומרים מקום במכסה, גם לפני שהתקיימו בפועל.</div>
                  </div>

                  {canMutateBilling ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => handleEditAuthorization(row)} disabled={saving} className="gap-2">
                        <Pencil className="h-4 w-4" />
                        <span>ערוך אישור</span>
                      </Button>
                      {row.status === 'active' ? (
                        isPendingCancel ? (
                          <>
                            <Button type="button" size="sm" variant="outline" onClick={() => { void handleCancelAuthorization(row.id); }} disabled={saving}>
                              אשר ביטול
                            </Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setCancelTargetId('')} disabled={saving}>
                              חזור
                            </Button>
                          </>
                        ) : (
                          <Button type="button" size="sm" variant="outline" onClick={() => setCancelTargetId(row.id)} disabled={saving}>
                            בטל אישור
                          </Button>
                        )
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

      {canMutateBilling ? (
        <Sheet open={sheetOpen} modal={false} onOpenChange={handleCloseSheet}>
          <SheetContent side="left" showOverlay={false} className="w-[92vw] border-slate-200 p-0 sm:max-w-[520px]">
            <div className="flex h-full flex-col p-6">
              <SheetHeader className="text-right">
                <SheetTitle>{form.id ? 'עריכת אישור גורם מממן' : 'הוספת אישור גורם מממן'}</SheetTitle>
                <SheetDescription>
                  הגדירו את מסלול הכיסוי, המכסה והמחירים. לאחר השמירה החיובים הרלוונטיים יתעדכנו אוטומטית.
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 flex-1 space-y-4 overflow-y-auto pe-1">
                <div className="space-y-2">
                  <Label className="text-xs text-slate-600">מסלול</Label>
                  <Select
                    value={form.providerTrackId || '__none__'}
                    onValueChange={handleTrackSelection}
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
                    <Label htmlFor="covered-customer-charge-amount">חיוב לקוח בזמן כיסוי<span className="ms-1 text-destructive">*</span></Label>
                    <CurrencyInput
                      id="covered-customer-charge-amount"
                      value={form.coveredCustomerChargeAmount}
                      onChange={(value) => setForm((current) => ({ ...current, coveredCustomerChargeAmount: value }))}
                      disabled={saving}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="covered-insurer-claim-amount">חיוב גורם מממן בזמן כיסוי<span className="ms-1 text-destructive">*</span></Label>
                    <CurrencyInput
                      id="covered-insurer-claim-amount"
                      value={form.coveredInsurerClaimAmount}
                      onChange={(value) => setForm((current) => ({ ...current, coveredInsurerClaimAmount: value }))}
                      disabled={saving}
                    />
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-600">אחרי מיצוי זכאות</Label>
                    <Select value={form.postCoveragePolicy} onValueChange={(value) => setForm((current) => ({ ...current, postCoveragePolicy: value }))} disabled={saving}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="service_default">מחיר שירות רגיל</SelectItem>
                        <SelectItem value="explicit_customer_charge">מחיר המשך מפורש</SelectItem>
                        <SelectItem value="manual_block">חסימה להחלטה ידנית</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="post-coverage-customer-charge">מחיר המשך ללקוח</Label>
                    <CurrencyInput
                      id="post-coverage-customer-charge"
                      value={form.postCoverageCustomerChargeAmount}
                      onChange={(value) => setForm((current) => ({ ...current, postCoverageCustomerChargeAmount: value }))}
                      disabled={saving || form.postCoveragePolicy !== 'explicit_customer_charge'}
                    />
                  </div>
                </div>

                <section className={`rounded-2xl border px-4 py-3 text-sm ${preview.blockingReason ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="text-xs font-medium text-slate-700">תצוגה מקדימה לכל שיעור</div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg bg-white px-3 py-2">
                      <div className="text-[11px] text-slate-500">תלמיד בזמן כיסוי</div>
                      <div className="mt-1 font-semibold text-slate-900">{formatCurrency(preview.coveredCustomerAmount)}</div>
                    </div>
                    <div className="rounded-lg bg-white px-3 py-2">
                      <div className="text-[11px] text-slate-500">גורם מממן בזמן כיסוי</div>
                      <div className="mt-1 font-semibold text-slate-900">{formatCurrency(preview.coveredInsurerAmount)}</div>
                    </div>
                  </div>
                  <p className={`mt-3 text-xs ${preview.blockingReason ? 'text-amber-700' : 'text-slate-600'}`}>
                    {preview.postCoveragePolicy === 'service_default'
                      ? 'אחרי מיצוי הזכאות, השיעור הבא יחויב במחיר השירות הרגיל.'
                      : preview.postCoveragePolicy === 'explicit_customer_charge'
                        ? `אחרי מיצוי הזכאות, השיעור הבא יחויב ב-${formatCurrency(preview.postCoverageCustomerAmount)}.`
                        : 'אחרי מיצוי הזכאות, המערכת תחסום חיוב ותדרוש החלטה ידנית.'}
                  </p>
                  {preview.blockingReason ? (
                    <p className="mt-1 text-xs text-amber-700">{mapAuthorizationErrorMessage(preview.blockingReason)}</p>
                  ) : null}
                </section>

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
              </div>

              <div className="mt-5 flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-start">
                <Button type="button" variant="outline" onClick={() => handleCloseSheet(false)} disabled={saving}>
                  ביטול
                </Button>
                <Button type="button" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                  {form.id ? 'עדכן אישור' : 'צור אישור'}
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}
