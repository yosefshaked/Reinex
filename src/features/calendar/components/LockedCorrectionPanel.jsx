import { useEffect, useMemo, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { authenticatedFetch } from '@/lib/api-client.js'
import { extractSupportCode, resolveApiErrorMessage } from '@/lib/error-support.js'
import { AlertTriangle, Loader2, Lock, ShieldAlert } from 'lucide-react'
import { getParticipantDisplayName } from '../utils/participantDisplay.js'

function getDisplayInstance(instance) {
  const resolved = instance?.latest_correction?.effective_state?.instance
    ? { ...instance, ...instance.latest_correction.effective_state.instance }
    : instance

  if (!resolved || typeof resolved !== 'object') {
    return resolved
  }

  const normalizedStatus = String(resolved.status || '').trim().toLowerCase()
  const status = ['cancelled_student', 'cancelled_clinic', 'no_show'].includes(normalizedStatus)
    ? 'cancelled'
    : normalizedStatus

  return {
    ...resolved,
    status: status || resolved.status,
  }
}

function getDisplayParticipants(instance) {
  const baseParticipants = Array.isArray(instance?.participants) ? instance.participants : []
  const effectiveParticipants = Array.isArray(instance?.latest_correction?.effective_state?.participants)
    ? instance.latest_correction.effective_state.participants
    : []
  const effectiveById = new Map(effectiveParticipants.map((participant) => [participant.id, participant]))
  return baseParticipants.map((participant) => ({
    ...participant,
    ...(effectiveById.get(participant.id) || {}),
  }))
}

function formatCurrencyDelta(amount) {
  const numericAmount = Number(amount || 0)
  const prefix = numericAmount > 0 ? '+' : ''
  return `${prefix}${numericAmount.toFixed(2)} ₪`
}

function resolveCorrectionErrorMessage(error, participantsById = new Map()) {
  const code = resolveApiErrorMessage(error)
  const details = error?.data?.details || {}
  if (extractSupportCode(code)) {
    return code
  }
  const blockingNames = Array.isArray(details?.participant_ids)
    ? details.participant_ids
      .map((participantId) => participantsById.get(participantId))
      .filter(Boolean)
    : []

  if (code === 'cancelled_instance_has_attended_participants') {
    return blockingNames.length > 0
      ? `לא ניתן לסמן את השיעור כמבוטל כל עוד יש משתתפים שסומנו כנוכחים: ${blockingNames.join(', ')}.`
      : 'לא ניתן לסמן את השיעור כמבוטל כל עוד יש משתתפים שסומנו כנוכחים. יש לעדכן קודם את סטטוס המשתתפים הרלוונטיים.'
  }

  if (code === 'completed_instance_has_scheduled_participants') {
    return blockingNames.length > 0
      ? `לא ניתן לסמן את השיעור כהושלם כל עוד המשתתפים הבאים עדיין במצב מתוכנן: ${blockingNames.join(', ')}.`
      : 'לא ניתן לסמן את השיעור כהושלם כל עוד יש משתתפים שעדיין במצב מתוכנן.'
  }

  if (code === 'invalid_participant_patch_status') {
    return 'אחד מסטטוסי המשתתפים שנבחרו אינו תקין.'
  }

  if (code === 'failed_to_build_correction_preview') {
    return 'יצירת תצוגת ההשפעה נכשלה. נסו לרענן את השיעור ולנסות שוב.'
  }

  if (blockingNames.length > 0) {
    return `${code}: ${blockingNames.join(', ')}`
  }

  if (details?.participant_ids?.length) {
    return `${code}: ${details.participant_ids.length} משתתפים דורשים טיפול.`
  }

  return resolveApiErrorMessage(error, 'יצירת תצוגת מקדימה נכשלה.')
}

export function LockedCorrectionPanel({ instance, orgId, forceOpen = false, onApplied }) {
  const displayInstance = useMemo(() => getDisplayInstance(instance), [instance])
  const displayParticipants = useMemo(() => getDisplayParticipants(instance), [instance])
  const participantNamesById = useMemo(
    () => new Map(displayParticipants.map((participant) => [participant.id, getParticipantDisplayName(participant, 'לקוח/ה')])),
    [displayParticipants],
  )

  const [isOpen, setIsOpen] = useState(forceOpen)
  const [reasonCode, setReasonCode] = useState('status_fix')
  const [reasonText, setReasonText] = useState('')
  const [correctionMode, setCorrectionMode] = useState('participant_adjustment')
  const [status, setStatus] = useState(displayInstance?.status || 'scheduled')
  const [participantStatuses, setParticipantStatuses] = useState(() => (
    Object.fromEntries(displayParticipants.map((participant) => [participant.id, participant.participant_status || 'scheduled']))
  ))
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [isApplyLoading, setIsApplyLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const hasLatestCorrection = Boolean(instance?.latest_correction)
  const lockRows = [
    ...(Array.isArray(instance?.locks?.instance) ? instance.locks.instance : []),
    ...(Array.isArray(instance?.locks?.participants) ? instance.locks.participants : []),
  ]

  useEffect(() => {
    setIsOpen(forceOpen)
  }, [forceOpen, instance?.id])

  useEffect(() => {
    setStatus(displayInstance?.status || 'scheduled')
    setParticipantStatuses(Object.fromEntries(displayParticipants.map((participant) => [participant.id, participant.participant_status || 'scheduled'])))
    setPreview(null)
    setError(null)
  }, [displayInstance, displayParticipants, instance?.id])

  const requestBody = useMemo(() => {
    const instancePatch = {}
    if (status !== displayInstance?.status) {
      instancePatch.status = status
    }

    const participantPatches = displayParticipants
      .filter((participant) => participantStatuses[participant.id] && participantStatuses[participant.id] !== participant.participant_status)
      .map((participant) => ({
        participant_id: participant.id,
        participant_status: participantStatuses[participant.id],
      }))

    return {
      action: 'preview',
      org_id: orgId,
      original_instance_id: instance?.id,
      correction_mode: correctionMode,
      reason_code: reasonCode,
      reason_text: reasonText,
      expected_version: instance?.version,
      instance_patch: instancePatch,
      participant_patches: participantPatches,
    }
  }, [correctionMode, displayInstance?.status, displayParticipants, instance?.id, instance?.version, orgId, participantStatuses, reasonCode, reasonText, status])

  async function handlePreview() {
    setIsPreviewLoading(true)
    setError(null)
    try {
      const payload = await authenticatedFetch('calendar/corrections', {
        method: 'POST',
        body: requestBody,
      })
      setPreview(payload)
    } catch (err) {
      setError(resolveCorrectionErrorMessage(err, participantNamesById))
    } finally {
      setIsPreviewLoading(false)
    }
  }

  async function handleApply() {
    setIsApplyLoading(true)
    setError(null)
    try {
      const payload = await authenticatedFetch('calendar/corrections', {
        method: 'POST',
        body: {
          ...requestBody,
          action: 'apply',
          impact_warning_acknowledged: true,
        },
      })
      setPreview(payload.preview || preview)
      setConfirmOpen(false)
      onApplied?.(payload)
    } catch (err) {
      if (err?.status === 423 && err?.data?.preview) {
        setPreview(err.data.preview)
      }
      setError(resolveCorrectionErrorMessage(err, participantNamesById))
      setConfirmOpen(false)
    } finally {
      setIsApplyLoading(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-amber-900">
            <Lock className="h-4 w-4" />
            <span className="font-semibold">תיקון שיעור נעול</span>
            {instance?.is_locked && <Badge variant="outline">נעול</Badge>}
            {hasLatestCorrection && <Badge className="bg-sky-100 text-sky-800 border-sky-200">תוקן בעבר</Badge>}
          </div>
          <p className="text-sm text-amber-900/80">
            עריכה ישירה חסומה. השתמשו בתיקון append-only כדי לשמור השפעה תפעולית ופיננסית מלאה.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setIsOpen((prev) => !prev)}>
          {isOpen ? 'סגור' : 'צור תיקון'}
        </Button>
      </div>

      {lockRows.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {lockRows.map((lock) => (
            <Badge key={lock.id} variant="outline" className="border-amber-300 bg-white text-amber-900">
              {lock.lock_source_type}: {lock.lock_reason}
            </Badge>
          ))}
        </div>
      )}

      {hasLatestCorrection && (
        <Alert className="border-sky-300 bg-sky-50 text-sky-950">
          <ShieldAlert className="h-4 w-4 text-sky-700" />
          <AlertDescription>
            התיקון האחרון: {instance.latest_correction.reason_text}
          </AlertDescription>
        </Alert>
      )}

      {isOpen && (
        <div className="space-y-4 rounded-lg border border-amber-200 bg-white p-4">
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>סוג תיקון</Label>
              <Select value={correctionMode} onValueChange={setCorrectionMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="participant_adjustment">תיקון משתתפים</SelectItem>
                  <SelectItem value="value_only">תיקון ערכים</SelectItem>
                  <SelectItem value="replacement_instance">החלפת מופע</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>קוד סיבה</Label>
              <Select value={reasonCode} onValueChange={setReasonCode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="status_fix">תיקון סטטוס</SelectItem>
                  <SelectItem value="attendance_fix">תיקון נוכחות</SelectItem>
                  <SelectItem value="billing_fix">תיקון חיוב</SelectItem>
                  <SelectItem value="documentation_fix">תיקון תיעוד</SelectItem>
                  <SelectItem value="other">אחר</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>הסבר</Label>
            <Textarea
              rows={3}
              placeholder="למה נדרש התיקון ומה מקור המידע המעודכן?"
              value={reasonText}
              onChange={(event) => setReasonText(event.target.value)}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>סטטוס שיעור מתוקן</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="scheduled">מתוכנן</SelectItem>
                  <SelectItem value="completed">הושלם</SelectItem>
                  <SelectItem value="cancelled">בוטל</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <Label>סטטוס משתתפים מתוקן</Label>
            <div className="space-y-2">
              {displayParticipants.map((participant) => (
                <div key={participant.id} className="grid gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-[1fr,220px] md:items-center">
                  <div>
                    <div className="font-medium text-slate-900">{getParticipantDisplayName(participant, 'לקוח/ה')}</div>
                    <div className="text-xs text-slate-500">מצב נוכחי: {participant.participant_status || '—'}</div>
                  </div>
                  <Select
                    value={participantStatuses[participant.id] || participant.participant_status || 'scheduled'}
                    onValueChange={(value) => setParticipantStatuses((prev) => ({ ...prev, [participant.id]: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="scheduled">מתוכנן</SelectItem>
                      <SelectItem value="attended">נכח</SelectItem>
                      <SelectItem value="no_show">אי הגעה</SelectItem>
                      <SelectItem value="cancelled_student">בוטל ע"י תלמיד</SelectItem>
                      <SelectItem value="cancelled_clinic">בוטל ע"י המרפאה</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={handlePreview} disabled={isPreviewLoading || !reasonText.trim()}>
              {isPreviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'תצוגת השפעה'}
            </Button>
            <Button onClick={() => setConfirmOpen(true)} disabled={!preview || isApplyLoading || preview?.blocked_by_paid_claim}>
              {isApplyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'החל תיקון'}
            </Button>
          </div>

          {preview && (
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-900">סיכום השפעה</span>
                {preview.blocked_by_paid_claim && <Badge variant="destructive">חסום בגלל תביעה ששולמה</Badge>}
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-md bg-white p-3">
                  <div className="text-xs text-slate-500">השפעת שכר</div>
                  <div className="mt-1 font-semibold text-slate-900">{formatCurrencyDelta(preview.impact_snapshot?.payroll?.delta_amount)}</div>
                </div>
                <div className="rounded-md bg-white p-3">
                  <div className="text-xs text-slate-500">השפעת חיוב</div>
                  <div className="mt-1 font-semibold text-slate-900">{formatCurrencyDelta(preview.impact_snapshot?.billing?.total_delta_amount)}</div>
                </div>
                <div className="rounded-md bg-white p-3">
                  <div className="text-xs text-slate-500">השפעה תפעולית</div>
                  <div className="mt-1 font-semibold text-slate-900">{preview.impact_snapshot?.operational?.delta_minutes || 0} דקות</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>אזהרת השפעה</AlertDialogTitle>
            <AlertDialogDescription>
              פעולה זו תיצור תיקון append-only עם השפעה פיננסית ותפעולית ותישמר ביומן הביקורת.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {preview && (
            <div className="space-y-2 text-sm text-slate-700">
              <div>שינוי שכר: {formatCurrencyDelta(preview.impact_snapshot?.payroll?.delta_amount)}</div>
              <div>שינוי חיוב: {formatCurrencyDelta(preview.impact_snapshot?.billing?.total_delta_amount)}</div>
              <div>שינוי דקות עבודה: {preview.impact_snapshot?.operational?.delta_minutes || 0}</div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isApplyLoading}>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleApply} disabled={isApplyLoading || !preview}>
              {isApplyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'אני מבין, החל תיקון'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
