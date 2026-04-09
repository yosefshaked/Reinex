import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { useServices } from '@/hooks/useOrgData.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useMedicalProviders } from '@/features/students/hooks/useMedicalProviders.js';
import {
  HMO_PAYMENT_MODE_OPTIONS,
  HMO_SUGGESTION_OPTIONS,
} from '@/features/students/components/student-billing-helpers.js';
import { coerceAgorot } from '@/lib/currency.js';

function buildEmptyProviderForm() {
  return {
    id: '',
    name: '',
    is_active: true,
  };
}

function buildEmptyTrackForm(providerId = '') {
  return {
    id: '',
    providerId,
    serviceId: '',
    name: '',
    paymentMode: 'partially_paid_by_hmo',
    defaultCustomerChargeAmount: '',
    defaultInsurerClaimAmount: '',
    defaultWorkflowNotes: '',
    is_active: true,
    suggestionId: 'custom',
  };
}

function formatCurrency(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `₪${Number(value).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function HmoSetupWorkspace({ onChanged = null }) {
  const { session } = useAuth();
  const { activeOrgId } = useOrg();
  const { services } = useServices({ enabled: Boolean(activeOrgId), orgId: activeOrgId, session });
  const {
    providers,
    loadingProviders,
    providersError,
    providersNotice,
    loadProviders,
    createProvider,
    updateProvider,
    deleteProvider,
    createTrack,
    updateTrack,
    deleteTrack,
    canManageProviders,
  } = useMedicalProviders();

  const [providerForm, setProviderForm] = useState(() => buildEmptyProviderForm());
  const [trackForm, setTrackForm] = useState(() => buildEmptyTrackForm());
  const [saving, setSaving] = useState(false);
  const [deleteProviderTargetId, setDeleteProviderTargetId] = useState('');
  const [deleteTrackTargetId, setDeleteTrackTargetId] = useState('');

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  async function refreshAfterChange() {
    await loadProviders();
    if (typeof onChanged === 'function') {
      await onChanged();
    }
  }

  function startProviderEdit(provider) {
    setProviderForm({
      id: provider.id,
      name: provider.name || '',
      is_active: provider.is_active !== false,
    });
  }

  function startTrackEdit(provider, track) {
    setTrackForm({
      id: track.id,
      providerId: provider.id,
      serviceId: track.service_id || '',
      name: track.name || '',
      paymentMode: track.payment_mode || 'partially_paid_by_hmo',
      defaultCustomerChargeAmount: track.default_customer_charge_amount ?? '',
      defaultInsurerClaimAmount: track.default_insurer_claim_amount ?? '',
      defaultWorkflowNotes: track.default_workflow_notes || '',
      is_active: track.is_active !== false,
      suggestionId: 'custom',
    });
  }

  function startTrackCreate(providerId = '') {
    setTrackForm(buildEmptyTrackForm(providerId));
  }

  function applySuggestion(suggestionId) {
    const suggestion = HMO_SUGGESTION_OPTIONS.find((option) => option.value === suggestionId);
    setTrackForm((current) => ({
      ...current,
      suggestionId,
      name: current.name || (suggestion ? `מסלול ${suggestion.label}` : current.name),
      paymentMode: suggestion?.paymentMode || current.paymentMode,
      defaultWorkflowNotes: suggestion?.workflowNotes || current.defaultWorkflowNotes,
    }));
  }

  async function handleSaveProvider() {
    if (!providerForm.name.trim()) {
      toast.error('יש להזין שם גורם מממן.');
      return;
    }

    setSaving(true);
    try {
      if (providerForm.id) {
        await updateProvider(providerForm);
        toast.success('הגורם המממן עודכן.');
      } else {
        await createProvider(providerForm);
        toast.success('הגורם המממן נוצר.');
      }
      setProviderForm(buildEmptyProviderForm());
      await refreshAfterChange();
    } catch (error) {
      console.error('Failed to save provider', error);
      toast.error(error?.message || 'שמירת הגורם המממן נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteProvider(providerId) {
    setSaving(true);
    try {
      await deleteProvider(providerId);
      if (providerForm.id === providerId) {
        setProviderForm(buildEmptyProviderForm());
      }
      await refreshAfterChange();
      toast.success('הגורם המממן נמחק.');
    } catch (error) {
      console.error('Failed to delete provider', error);
      toast.error(error?.message || 'מחיקת הגורם המממן נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveTrack() {
    if (!trackForm.providerId) {
      toast.error('יש לבחור גורם מממן למסלול.');
      return;
    }
    if (!trackForm.name.trim()) {
      toast.error('יש להזין שם מסלול.');
      return;
    }
    if (!trackForm.serviceId) {
      toast.error('יש לבחור שירות למסלול.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        id: trackForm.id || undefined,
        provider_id: trackForm.providerId,
        service_id: trackForm.serviceId,
        name: trackForm.name.trim(),
        payment_mode: trackForm.paymentMode,
        default_customer_charge_amount: coerceAgorot(trackForm.defaultCustomerChargeAmount),
        default_insurer_claim_amount: coerceAgorot(trackForm.defaultInsurerClaimAmount),
        default_workflow_notes: trackForm.defaultWorkflowNotes || '',
        is_active: trackForm.is_active,
        metadata: {
          suggestion_id: trackForm.suggestionId || 'custom',
        },
      };

      if (trackForm.id) {
        await updateTrack(payload);
        toast.success('המסלול עודכן.');
      } else {
        await createTrack(payload);
        toast.success('המסלול נוצר.');
      }
      setTrackForm(buildEmptyTrackForm(trackForm.providerId));
      await refreshAfterChange();
    } catch (error) {
      console.error('Failed to save provider track', error);
      toast.error(error?.message || 'שמירת המסלול נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTrack(trackId) {
    setSaving(true);
    try {
      await deleteTrack(trackId);
      if (trackForm.id === trackId) {
        setTrackForm(buildEmptyTrackForm(trackForm.providerId));
      }
      await refreshAfterChange();
      toast.success('המסלול נמחק.');
    } catch (error) {
      console.error('Failed to delete provider track', error);
      toast.error(error?.message || 'מחיקת המסלול נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDisableTrack(track) {
    setSaving(true);
    try {
      await updateTrack({
        id: track.id,
        provider_id: track.provider_id,
        service_id: track.service_id,
        name: track.name,
        payment_mode: track.payment_mode,
        default_customer_charge_amount: track.default_customer_charge_amount,
        default_insurer_claim_amount: track.default_insurer_claim_amount,
        default_workflow_notes: track.default_workflow_notes,
        is_active: false,
        metadata: track.metadata,
      });
      await refreshAfterChange();
      toast.success('המסלול הושבת.');
    } catch (error) {
      console.error('Failed to disable provider track', error);
      toast.error(error?.message || 'השבתת המסלול נכשלה.');
    } finally {
      setSaving(false);
    }
  }

  const activeProviders = useMemo(
    () => providers.filter((provider) => provider.is_active !== false),
    [providers],
  );

  return (
    <>
    <AlertDialog open={Boolean(deleteProviderTargetId)} onOpenChange={(open) => { if (!open) setDeleteProviderTargetId(''); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>מחיקת גורם מממן</AlertDialogTitle>
          <AlertDialogDescription>
            פעולה זו תמחק את הגורם המממן לצמיתות. לא ניתן לשחזר. האם להמשיך?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ביטול</AlertDialogCancel>
          <AlertDialogAction onClick={() => { handleDeleteProvider(deleteProviderTargetId); setDeleteProviderTargetId(''); }}>
            מחק
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={Boolean(deleteTrackTargetId)} onOpenChange={(open) => { if (!open) setDeleteTrackTargetId(''); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>מחיקת מסלול</AlertDialogTitle>
          <AlertDialogDescription>
            פעולה זו תמחק את המסלול לצמיתות. כל האישורים שמשתמשים במסלול זה יאבדו את ההגדרות שלו. האם להמשיך?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ביטול</AlertDialogCancel>
          <AlertDialogAction onClick={() => { handleDeleteTrack(deleteTrackTargetId); setDeleteTrackTargetId(''); }}>
            מחק
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-slate-50 p-4">
        <h3 className="text-base font-semibold text-zinc-900">תשתית גורמים מממנים</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          כאן מגדירים את הגורמים המממנים ברמת הארגון ואת המסלולים הקבועים שכל אישור תלמיד יבחר מתוכם.
        </p>
      </div>

      {providersError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {providersError}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-lg font-semibold text-zinc-900">גורמים מממנים ומסלולים</h4>
              <p className="text-sm text-muted-foreground">ההגדרות כאן ישמשו בכל מסכי החיוב והאישורים.</p>
            </div>
            {loadingProviders ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>

          <div className="mt-4 space-y-3">
            {providers.map((provider) => (
              <div key={provider.id} className="rounded-xl border border-border bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900">{provider.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {provider.tracks.length} מסלולים • {provider.is_active === false ? 'לא פעיל' : 'פעיל'}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {provider.is_active === false ? (
                      <Badge variant="outline" className="border-slate-300 bg-slate-100 text-slate-700">לא פעיל</Badge>
                    ) : null}
                    {canManageProviders ? (
                      <>
                        <Button type="button" size="sm" variant="outline" onClick={() => startProviderEdit(provider)} disabled={saving}>
                          ערוך
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => startTrackCreate(provider.id)} disabled={saving}>
                          מסלול חדש
                        </Button>
                        {provider.tracks.length === 0 ? (
                          <Button type="button" size="sm" variant="outline" onClick={() => setDeleteProviderTargetId(provider.id)} disabled={saving}>
                            מחק
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {provider.tracks.map((track) => (
                    <div key={track.id} className="rounded-lg border border-border bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-zinc-900">{track.name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {HMO_PAYMENT_MODE_OPTIONS.find((option) => option.value === track.payment_mode)?.label || track.payment_mode}
                            {track.service_id ? ` • ${(services.find((service) => service.id === track.service_id)?.service_name || services.find((service) => service.id === track.service_id)?.name || 'שירות')}` : ''}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {track.is_active === false ? (
                            <Badge variant="outline" className="border-slate-300 bg-slate-100 text-slate-700">לא פעיל</Badge>
                          ) : null}
                          {canManageProviders ? (
                            <>
                              <Button type="button" size="sm" variant="outline" onClick={() => startTrackEdit(provider, track)} disabled={saving}>
                                ערוך
                              </Button>
                              {track.in_use ? (
                                <Button type="button" size="sm" variant="outline" onClick={() => handleDisableTrack(track)} disabled={saving || track.is_active === false}>
                                  השבת
                                </Button>
                              ) : (
                                <Button type="button" size="sm" variant="outline" onClick={() => setDeleteTrackTargetId(track.id)} disabled={saving}>
                                  מחק
                                </Button>
                              )}
                            </>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-3 text-sm">
                        <div className="rounded-lg bg-slate-50 p-3">
                          <div className="text-[11px] text-muted-foreground">חיוב לקוח ברירת מחדל</div>
                          <div className="mt-1 font-semibold">{formatCurrency(track.default_customer_charge_amount)}</div>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <div className="text-[11px] text-muted-foreground">תביעה ברירת מחדל</div>
                          <div className="mt-1 font-semibold">{formatCurrency(track.default_insurer_claim_amount)}</div>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <div className="text-[11px] text-muted-foreground">הערת זרימה</div>
                          <div className="mt-1 font-semibold text-zinc-700">{track.default_workflow_notes || '—'}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {provider.tracks.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border bg-white p-4 text-sm text-muted-foreground">
                      עדיין אין מסלולים לגורם הזה.
                    </div>
                  ) : null}
                </div>
              </div>
            ))}

            {!loadingProviders && providers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-muted-foreground">
                {providersNotice || 'עדיין לא הוגדרו גורמים מממנים. התחילו ביצירת גורם מממן חדש ואז הוסיפו לו מסלול מתאים.'}
              </div>
            ) : null}
          </div>
        </section>

        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <h4 className="text-lg font-semibold text-zinc-900">{providerForm.id ? 'עריכת גורם מממן' : 'גורם מממן חדש'}</h4>
            <div className="mt-4 space-y-3">
              <div className="space-y-2">
                <Label htmlFor="hmo-provider-name">שם הגורם המממן</Label>
                <Input
                  id="hmo-provider-name"
                  value={providerForm.name}
                  onChange={(event) => setProviderForm((current) => ({ ...current, name: event.target.value }))}
                  disabled={!canManageProviders || saving}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-slate-600">סטטוס</Label>
                <Select
                  value={providerForm.is_active ? 'active' : 'inactive'}
                  onValueChange={(value) => setProviderForm((current) => ({ ...current, is_active: value === 'active' }))}
                  disabled={!canManageProviders || saving}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">פעיל</SelectItem>
                    <SelectItem value="inactive">לא פעיל</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {canManageProviders ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={handleSaveProvider} disabled={saving}>
                    {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                    {providerForm.id ? 'עדכן גורם מממן' : 'צור גורם מממן'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setProviderForm(buildEmptyProviderForm())} disabled={saving}>
                    נקה
                  </Button>
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <h4 className="text-lg font-semibold text-zinc-900">{trackForm.id ? 'עריכת מסלול' : 'מסלול חדש'}</h4>
            <div className="mt-4 space-y-3">
              <div className="space-y-2">
                <Label className="text-xs text-slate-600">גורם מממן</Label>
                <Select
                  value={trackForm.providerId || '__none__'}
                  onValueChange={(value) => setTrackForm((current) => ({ ...current, providerId: value === '__none__' ? '' : value }))}
                  disabled={!canManageProviders || saving}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="בחר גורם מממן" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">בחר גורם מממן</SelectItem>
                    {activeProviders.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-slate-600">שירות המסלול</Label>
                <Select
                  value={trackForm.serviceId || '__none__'}
                  onValueChange={(value) => setTrackForm((current) => ({ ...current, serviceId: value === '__none__' ? '' : value }))}
                  disabled={!canManageProviders || saving}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="בחר שירות" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">בחר שירות</SelectItem>
                    {services.map((service) => (
                      <SelectItem key={service.id} value={service.id}>{service.service_name || service.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-slate-600">הצעה להתחלה</Label>
                <Select value={trackForm.suggestionId} onValueChange={applySuggestion} disabled={!canManageProviders || saving}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HMO_SUGGESTION_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="hmo-track-name">שם המסלול</Label>
                <Input
                  id="hmo-track-name"
                  value={trackForm.name}
                  onChange={(event) => setTrackForm((current) => ({ ...current, name: event.target.value }))}
                  disabled={!canManageProviders || saving}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-slate-600">מודל תשלום</Label>
                <Select
                  value={trackForm.paymentMode}
                  onValueChange={(value) => setTrackForm((current) => ({ ...current, paymentMode: value }))}
                  disabled={!canManageProviders || saving}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HMO_PAYMENT_MODE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="track-customer-charge">חיוב לקוח ברירת מחדל</Label>
                  <Input
                    id="track-customer-charge"
                    type="number"
                    min="0"
                    step="0.01"
                    value={trackForm.defaultCustomerChargeAmount}
                    onChange={(event) => setTrackForm((current) => ({ ...current, defaultCustomerChargeAmount: event.target.value }))}
                    disabled={!canManageProviders || saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="track-insurer-claim">תביעה ברירת מחדל</Label>
                  <Input
                    id="track-insurer-claim"
                    type="number"
                    min="0"
                    step="0.01"
                    value={trackForm.defaultInsurerClaimAmount}
                    onChange={(event) => setTrackForm((current) => ({ ...current, defaultInsurerClaimAmount: event.target.value }))}
                    disabled={!canManageProviders || saving}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="track-workflow-notes">הסבר ועוגן תפעולי</Label>
                <Input
                  id="track-workflow-notes"
                  value={trackForm.defaultWorkflowNotes}
                  onChange={(event) => setTrackForm((current) => ({ ...current, defaultWorkflowNotes: event.target.value }))}
                  disabled={!canManageProviders || saving}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-slate-600">סטטוס</Label>
                <Select
                  value={trackForm.is_active ? 'active' : 'inactive'}
                  onValueChange={(value) => setTrackForm((current) => ({ ...current, is_active: value === 'active' }))}
                  disabled={!canManageProviders || saving}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">פעיל</SelectItem>
                    <SelectItem value="inactive">לא פעיל</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {canManageProviders ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={handleSaveTrack} disabled={saving}>
                    {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                    {trackForm.id ? 'עדכן מסלול' : 'צור מסלול'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setTrackForm(buildEmptyTrackForm(trackForm.providerId))} disabled={saving}>
                    נקה
                  </Button>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
    </>
  );
}
