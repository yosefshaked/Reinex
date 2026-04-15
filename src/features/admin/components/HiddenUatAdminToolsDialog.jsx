import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Lock } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authenticatedFetch } from '@/lib/api-client.js';

function normalizeUuid(raw) {
  return typeof raw === 'string' ? raw.trim() : '';
}

export default function HiddenUatAdminToolsDialog({ open, onOpenChange, orgId, password }) {
  const [payrollInstanceId, setPayrollInstanceId] = useState('');
  const [paidClaimInstanceId, setPaidClaimInstanceId] = useState('');
  const [inspectInstanceId, setInspectInstanceId] = useState('');
  const [inspectParticipantId, setInspectParticipantId] = useState('');
  const [inspectResult, setInspectResult] = useState(null);
  const [isSubmittingKind, setIsSubmittingKind] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const canSubmit = useMemo(() => Boolean(password && orgId), [password, orgId]);

  async function handleLock(kind) {
    const lessonInstanceId = normalizeUuid(kind === 'payroll' ? payrollInstanceId : paidClaimInstanceId);
    if (!lessonInstanceId) {
      setError('יש להזין lesson_instance_id תקין לפני נעילה.');
      return;
    }

    if (!canSubmit) {
      setError('הכלי אינו מוכן. נסו לבצע אימות מחדש.');
      return;
    }

    setError('');
    setSuccessMessage('');
    setInspectResult(null);
    setIsSubmittingKind(kind);

    try {
      const payload = await authenticatedFetch('debug/uat-tools', {
        method: 'POST',
        body: {
          action: 'lock_lesson',
          org_id: orgId,
          password,
          lock_kind: kind,
          lesson_instance_id: lessonInstanceId,
        },
      });

      const sourceType = payload?.lock?.lock_source_type || (kind === 'payroll' ? 'payroll_run' : 'claim_batch');
      setSuccessMessage(`נוצרה נעילה בהצלחה (${sourceType}) עבור ${lessonInstanceId}.`);

      if (kind === 'payroll') {
        setPayrollInstanceId('');
      } else {
        setPaidClaimInstanceId('');
      }
    } catch (requestError) {
      setError(requestError?.data?.message || requestError?.message || 'יצירת הנעילה נכשלה.');
    } finally {
      setIsSubmittingKind('');
    }
  }

  async function handleInspectHmoChargeContext() {
    const lessonInstanceId = normalizeUuid(inspectInstanceId);
    const lessonParticipantId = normalizeUuid(inspectParticipantId);

    if (!lessonInstanceId) {
      setError('יש להזין lesson_instance_id תקין לפני בדיקה.');
      return;
    }

    if (!canSubmit) {
      setError('הכלי אינו מוכן. נסו לבצע אימות מחדש.');
      return;
    }

    setError('');
    setSuccessMessage('');
    setInspectResult(null);
    setIsSubmittingKind('inspect_hmo');

    try {
      const payload = await authenticatedFetch('debug/uat-tools', {
        method: 'POST',
        body: {
          action: 'inspect_hmo_charge_context',
          org_id: orgId,
          password,
          lesson_instance_id: lessonInstanceId,
          ...(lessonParticipantId ? { lesson_participant_id: lessonParticipantId } : {}),
        },
      });

      setInspectResult(payload?.inspection || null);
      setSuccessMessage('נטענו נתוני אבחון חיוב HMO.');
    } catch (requestError) {
      setError(requestError?.data?.message || requestError?.message || 'טעינת נתוני האבחון נכשלה.');
    } finally {
      setIsSubmittingKind('');
    }
  }

  function handleOpenChange(nextOpen) {
    if (!nextOpen) {
      setError('');
      setSuccessMessage('');
    }
    onOpenChange?.(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl" hideDefaultClose>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Debug & UAT Tools
          </DialogTitle>
          <DialogDescription>
            כלי בדיקות מוסתר לנעילות שיעורים לפני UAT. מיועד למנהלים בלבד.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {successMessage && (
            <Alert className="border-emerald-300 bg-emerald-50 text-emerald-950">
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          )}

          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Lock Lesson (Payroll)</h3>
              <p className="text-xs text-muted-foreground">יוצר שורת נעילה עם lock_source_type=payroll_run.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr,auto] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="debug-lock-payroll-instance-id">lesson_instance_id</Label>
                <Input
                  id="debug-lock-payroll-instance-id"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={payrollInstanceId}
                  onChange={(event) => setPayrollInstanceId(event.target.value)}
                />
              </div>
              <Button
                type="button"
                onClick={() => handleLock('payroll')}
                disabled={isSubmittingKind === 'payroll'}
              >
                {isSubmittingKind === 'payroll' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Lock Lesson (Payroll)'}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Lock Lesson (Paid Claim)</h3>
              <p className="text-xs text-muted-foreground">יוצר claim_batch במצב paid ונעילת claim_batch עבור השיעור.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr,auto] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="debug-lock-paid-claim-instance-id">lesson_instance_id</Label>
                <Input
                  id="debug-lock-paid-claim-instance-id"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={paidClaimInstanceId}
                  onChange={(event) => setPaidClaimInstanceId(event.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleLock('paid_claim')}
                disabled={isSubmittingKind === 'paid_claim'}
              >
                {isSubmittingKind === 'paid_claim' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Lock Lesson (Paid Claim)'}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Inspect HMO Charge Context</h3>
              <p className="text-xs text-muted-foreground">טוען את כל ההקשר הנדרש לאבחון שימוש במסלול HMO: משתתף, שירות, אישורים, החלטת חיוב ורשומות לדר.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="debug-inspect-hmo-instance-id">lesson_instance_id</Label>
                <Input
                  id="debug-inspect-hmo-instance-id"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={inspectInstanceId}
                  onChange={(event) => setInspectInstanceId(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="debug-inspect-hmo-participant-id">lesson_participant_id (optional)</Label>
                <Input
                  id="debug-inspect-hmo-participant-id"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={inspectParticipantId}
                  onChange={(event) => setInspectParticipantId(event.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={handleInspectHmoChargeContext}
                disabled={isSubmittingKind === 'inspect_hmo'}
              >
                {isSubmittingKind === 'inspect_hmo' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Inspect HMO Context'}
              </Button>
            </div>

            {inspectResult ? (
              <div className="rounded-md border border-border bg-slate-50 p-3 space-y-2">
                <div className="text-xs text-muted-foreground">
                  selected_participant: {inspectResult?.selected_participant?.id || 'none'}
                </div>
                <div className="text-xs text-muted-foreground">
                  active_authorization: {inspectResult?.authorization_resolution?.active_authorization_id || 'none'}
                </div>
                <pre className="max-h-80 overflow-auto rounded bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">
                  {JSON.stringify(inspectResult, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            סגור
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}