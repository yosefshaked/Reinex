import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../../components/ui/select';
import { Badge } from '../../../components/ui/badge';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Textarea } from '../../../components/ui/textarea';
import { Checkbox } from '../../../components/ui/checkbox';
import {
  Check,
  XCircle,
  Loader2,
  AlertTriangle,
  MessageCircle,
  Mail,
  ThumbsUp,
  ThumbsDown,
  RotateCcw,
  FileEdit,
  FileCheck,
} from 'lucide-react';
import { getParticipantDisplayName } from '../utils/participantDisplay.js';

function getStatusBadge(status, hasSent, hasConfirmed) {
  if (status === 'attended') {
    return { label: 'נכח', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
  }
  if (status === 'no_show') {
    return { label: 'לא הגיע', className: 'bg-red-100 text-red-800 border-red-200' };
  }
  if (status === 'cancelled_student') {
    return { label: 'בוטל ע"י תלמיד', className: 'bg-slate-100 text-slate-600 border-slate-200' };
  }
  if (status === 'cancelled_clinic') {
    return { label: 'בוטל ע"י המכון', className: 'bg-slate-100 text-slate-600 border-slate-200' };
  }
  // scheduled — refine based on reminder state
  if (hasConfirmed) return { label: 'אישר הגעה', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
  if (hasSent) return { label: 'ממתין לאישור', className: 'bg-amber-100 text-amber-700 border-amber-200' };
  return { label: 'מתוכנן', className: 'bg-amber-50 text-amber-700 border-amber-200' };
}

function getAvatarColors(status) {
  if (status === 'attended') return 'bg-emerald-100 text-emerald-700';
  if (status === 'no_show') return 'bg-red-100 text-red-700';
  if (status === 'cancelled_student' || status === 'cancelled_clinic') return 'bg-slate-100 text-slate-500';
  return 'bg-blue-100 text-blue-700';
}

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return parts[0][0] + parts[parts.length - 1][0];
}

function getReminderContextLabel(hasSent, hasConfirmed, hasContactInfo) {
  if (!hasContactInfo) return null;
  if (hasConfirmed) return null; // the confirmed badge is enough
  if (hasSent) return 'תזכורת נשלחה — ממתין לאישור הגעה';
  return 'שלחו תזכורת לפני השיעור';
}

export function LessonParticipantRoster({
  displayParticipants,
  localReminderState,
  absenceForm,
  setAbsenceForm,
  absenceFormError,
  absenceRequirements,
  absenceRequirementsLoading,
  restorePreview,
  restorePreviewLoading,
  restorePreviewError,
  setRestorePreview,
  setRestorePreviewError,
  billingPolicy,
  canQuickReport,
  hasUnsetParticipants,
  scheduledParticipantsCount,
  canMarkAttendance,
  canManageAll,
  reminderUpdating,
  isMarkingAttendance,
  isOperationallyOpen,
  openAttendancePreview,
  openAbsenceForm,
  handleAbsenceStatusChange,
  closeAbsenceForm,
  confirmAbsenceForm,
  openRestorePreview,
  handleMarkAttendance,
  handleSendWaReminder,
  handleSendEmailReminder,
  handleSetReminderConfirmation,
  showReminderActions = true,
  resolveReminderContact,
  formatPhoneForWhatsApp,
  deriveDisplayWorkflowDecisions,
  shouldShowGraceWaiver,
  getCancellationStatusLabel,
  getCompensationDecisionLabel,
  getParticipantStatusLabel,
  groupPreviewImpacts,
  shortId,
  formatAgorotPreview,
  sessionReportsEnabled = false,
  reportsByParticipant = {},
  lessonStarted = false,
  onOpenSessionReport,
}) {
  if (displayParticipants.length === 0) return null;

  return (
    <div className="space-y-3">
      {canQuickReport && hasUnsetParticipants && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-900 text-sm">
            {`יש לסמן נוכחות לפני השלמת השיעור (${scheduledParticipantsCount} ${scheduledParticipantsCount === 1 ? 'תלמיד ממתין' : 'תלמידים ממתינים'})`}
          </AlertDescription>
        </Alert>
      )}

      {displayParticipants.map((participant) => {
        const rs = localReminderState[participant.id] || {};
        const hasSent = rs.reminder_sent ?? participant.reminder_sent ?? false;
        const hasConfirmed = rs.reminder_seen ?? participant.reminder_seen ?? false;
        const reminderContact = resolveReminderContact(participant);
        const waPhone = formatPhoneForWhatsApp(reminderContact.phone);
        const emailAddress = reminderContact.email;
        const hasContactInfo = Boolean(waPhone || emailAddress);
        const isScheduled = participant.participant_status === 'scheduled';
        const isAbsenceFormOpen = absenceForm?.participantId === participant.id;
        const isRestorePreviewOpen = restorePreview?.participantId === participant.id;
        const participantNotes = participant.metadata?.notes || null;

        const { studentBillingDecision, hmoDecision } =
          deriveDisplayWorkflowDecisions(participant, billingPolicy);

        const absenceRequiresCompensationDecision =
          isAbsenceFormOpen && Boolean(absenceRequirements?.requires_instructor_compensation_decision);
        const absenceShowsCompensationDecision =
          isAbsenceFormOpen &&
          !absenceRequirementsLoading &&
          Boolean(absenceRequirements?.requires_instructor_compensation_decision) &&
          ['no_show', 'cancelled_student', 'cancelled_clinic'].includes(absenceForm.status);
        const graceWaiverEligible =
          isAbsenceFormOpen && shouldShowGraceWaiver(billingPolicy, absenceForm?.status);
        const waiveFeeDisabled = !isOperationallyOpen;

        const previewImpactGroups = isRestorePreviewOpen
          ? groupPreviewImpacts(restorePreview.preview?.impacts || [])
          : [];

        const name = getParticipantDisplayName(participant, 'לא ידוע');
        const initials = getInitials(name);
        const statusBadge = getStatusBadge(participant.participant_status, hasSent, hasConfirmed);
        const avatarColors = getAvatarColors(participant.participant_status);

        // Build contact display line
        const contactLine = (() => {
          if (reminderContact.source === 'guardian') {
            const parts = [reminderContact.name || 'הורה/אפוטרופוס', '(הורה)'];
            if (reminderContact.phone) parts.push(reminderContact.phone);
            if (reminderContact.email) parts.push(reminderContact.email);
            return parts.join(' · ');
          }
          const parts = [];
          if (reminderContact.phone) parts.push(reminderContact.phone);
          if (reminderContact.email) parts.push(reminderContact.email);
          return parts.length > 0 ? parts.join(' · ') : 'אין פרטי קשר';
        })();

        // Financial alerts — only shown for participants with resolved status and only when meaningful
        const isResolvedStatus = ['attended', 'no_show', 'cancelled_student', 'cancelled_clinic'].includes(
          participant.participant_status,
        );
        const financialAlerts = [];
        if (isResolvedStatus) {
          if (hmoDecision === 'blocked') {
            financialAlerts.push({
              key: 'hmo-blocked',
              label: 'גורם מממן חסום',
              className: 'bg-red-100 text-red-800 border-red-200',
            });
          } else if (hmoDecision === 'pending') {
            financialAlerts.push({
              key: 'hmo-pending',
              label: 'תביעה ממתינה',
              className: 'bg-amber-100 text-amber-800 border-amber-200',
            });
          }
          if (studentBillingDecision === 'pending') {
            financialAlerts.push({
              key: 'billing',
              label: 'חיוב ממתין',
              className: 'bg-amber-100 text-amber-800 border-amber-200',
            });
          }
        }

        const reminderContextLabel =
          showReminderActions && isScheduled && canManageAll
            ? getReminderContextLabel(hasSent, hasConfirmed, hasContactInfo)
            : null;

        // Show reminder zone only when appropriate: scheduled, has permission, not in a form
        const showReminderZone =
          showReminderActions && isScheduled && canManageAll && !isAbsenceFormOpen && !isRestorePreviewOpen;

        // ── Session report affordance ─────────────────────────────
        // A report can be filed once the lesson has started and the
        // participant is attended/scheduled (not a no-show/cancellation).
        // When one already exists we surface a "documented" marker instead.
        const participantHasReport = Boolean(reportsByParticipant?.[participant.id]);
        const reportEligible =
          lessonStarted && ['attended', 'scheduled'].includes(participant.participant_status);
        const showReportZone =
          sessionReportsEnabled &&
          (participantHasReport || reportEligible) &&
          !isAbsenceFormOpen &&
          !isRestorePreviewOpen;

        return (
          <article
            key={participant.id}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
          >
            {/* ── IDENTITY HEADER ─────────────────────────────────── */}
            <div className="flex items-start gap-3 p-4">
              {/* Avatar */}
              <div
                className={`h-10 w-10 shrink-0 rounded-xl grid place-items-center text-sm font-bold select-none ${avatarColors}`}
              >
                {initials}
              </div>

              {/* Name + status badge + contact */}
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-slate-950 leading-snug">{name}</span>
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${statusBadge.className}`}
                  >
                    {statusBadge.label}
                  </span>
                </div>
                <div className="text-xs text-slate-500">{contactLine}</div>
                {participantNotes && (
                  <div className="text-xs text-slate-400 italic">{participantNotes}</div>
                )}
              </div>

              {/* Quick attendance buttons — always visible in the header */}
              {canMarkAttendance && !isAbsenceFormOpen && !isRestorePreviewOpen && (
                <div className="flex items-center gap-0.5 shrink-0">
                  {isScheduled && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openAttendancePreview(participant, 'attended')}
                      disabled={isMarkingAttendance}
                      title="סמן כנכח"
                      className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openAbsenceForm(participant.id)}
                    disabled={isMarkingAttendance}
                    title="לא הגיע / ביטול"
                    className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                  {!isScheduled && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openRestorePreview(participant)}
                      disabled={isMarkingAttendance || restorePreviewLoading}
                      title="שחזר לתוכנן"
                      className="h-8 w-8 p-0 text-blue-500 hover:text-blue-600 hover:bg-blue-50"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* ── REMINDER ZONE ───────────────────────────────────── */}
            {showReminderZone && (
              <div className="border-t border-slate-100 bg-slate-50/60 px-4 pb-3 pt-2.5 space-y-2">
                {reminderContextLabel && (
                  <p className="text-xs font-medium text-slate-500">{reminderContextLabel}</p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Send/resend reminder buttons — hide once confirmed */}
                  {!hasConfirmed && (
                    <>
                      {waPhone && (
                        <Button
                          size="sm"
                          variant={hasSent ? 'outline' : 'secondary'}
                          onClick={() => handleSendWaReminder(participant)}
                          disabled={reminderUpdating}
                          className="h-8 gap-1.5 text-xs"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                          {hasSent ? 'שלח שוב WhatsApp' : 'WhatsApp'}
                        </Button>
                      )}
                      {emailAddress && (
                        <Button
                          size="sm"
                          variant={hasSent ? 'outline' : 'secondary'}
                          onClick={() => handleSendEmailReminder(participant)}
                          disabled={reminderUpdating}
                          className="h-8 gap-1.5 text-xs"
                        >
                          <Mail className="h-3.5 w-3.5" />
                          {hasSent ? 'שלח שוב מייל' : 'מייל'}
                        </Button>
                      )}
                    </>
                  )}

                  {/* Confirmation buttons — appear after reminder is sent */}
                  {hasSent && !hasConfirmed && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 text-xs text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                        onClick={() => handleSetReminderConfirmation(participant, true)}
                        disabled={reminderUpdating}
                        title="אישר הגעה"
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                        אישר הגעה
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 text-xs text-red-700 hover:bg-red-50 hover:text-red-800"
                        onClick={() => handleSetReminderConfirmation(participant, false)}
                        disabled={reminderUpdating}
                        title="לא יגיע — פותח תהליך ביטול"
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                        לא יגיע
                      </Button>
                    </>
                  )}

                  {/* Confirmed state */}
                  {hasConfirmed && (
                    <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200 font-medium text-xs">
                      ✓ אישר הגעה
                    </Badge>
                  )}

                  {/* No contact info */}
                  {!hasContactInfo && (
                    <span className="text-xs text-slate-400">
                      אין פרטי קשר — סמנו נוכחות בזמן השיעור
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* ── SESSION REPORT ZONE ─────────────────────────────── */}
            {showReportZone && (
              <div className="flex items-center justify-between gap-3 border-t border-indigo-100 bg-indigo-50/40 px-4 py-2.5">
                {participantHasReport ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                    <FileCheck className="h-4 w-4" />
                    דיווח מפגש מתועד
                  </span>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1.5 text-xs text-indigo-900/70">
                      <FileEdit className="h-3.5 w-3.5" />
                      טרם תועד דיווח מפגש
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 shrink-0 gap-1.5 text-xs"
                      onClick={() => onOpenSessionReport?.(participant)}
                    >
                      <FileEdit className="h-3.5 w-3.5" />
                      תעד דיווח
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* ── FINANCIAL ALERTS ────────────────────────────────── */}
            {financialAlerts.length > 0 && !isAbsenceFormOpen && !isRestorePreviewOpen && (
              <div className="border-t border-amber-100 bg-amber-50/50 px-4 py-2 flex flex-wrap gap-1.5">
                {financialAlerts.map((alert) => (
                  <span
                    key={alert.key}
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${alert.className}`}
                  >
                    {alert.label}
                  </span>
                ))}
              </div>
            )}

            {/* ── ABSENCE FORM ────────────────────────────────────── */}
            {isAbsenceFormOpen && (
              <div className="border-t border-red-200 bg-red-50/40 px-4 py-3 space-y-3">
                <div className="text-sm font-semibold text-slate-800">סיבת אי-הגעה</div>

                <div>
                  <Label className="text-xs text-slate-600">סוג אי-הגעה</Label>
                  <Select value={absenceForm.status} onValueChange={handleAbsenceStatusChange}>
                    <SelectTrigger className="h-8 text-sm mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no_show">לא הגיע</SelectItem>
                      <SelectItem value="cancelled_student">ביטול ע"י תלמיד</SelectItem>
                      <SelectItem value="cancelled_clinic">ביטול ע"י המכון</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs text-slate-600">הערה (אופציונלי)</Label>
                  <Textarea
                    className="mt-1 text-sm resize-none"
                    rows={2}
                    placeholder="הוסף הערה..."
                    value={absenceForm.notes}
                    onChange={(e) => setAbsenceForm((prev) => ({ ...prev, notes: e.target.value }))}
                  />
                </div>

                {graceWaiverEligible && (
                  <div
                    className={`flex items-center gap-2 rounded-md border px-2 py-2 ${
                      waiveFeeDisabled
                        ? 'bg-slate-100 border-slate-200 text-slate-500'
                        : 'bg-emerald-50 border-emerald-200'
                    }`}
                    title={waiveFeeDisabled ? 'לא ניתן לוותר על חיוב בשיעור נעול.' : ''}
                  >
                    <Checkbox
                      id={`waive-fee-${participant.id}`}
                      checked={absenceForm.waiveFee === true}
                      onCheckedChange={(checked) =>
                        setAbsenceForm((prev) => ({ ...prev, waiveFee: checked === true }))
                      }
                      disabled={waiveFeeDisabled}
                    />
                    <Label htmlFor={`waive-fee-${participant.id}`} className="text-xs font-medium">
                      ויתור על חיוב
                    </Label>
                  </div>
                )}

                {absenceRequirementsLoading && (
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    טוען דרישות...
                  </div>
                )}

                {absenceShowsCompensationDecision && (
                  <div>
                    <Label className="text-xs text-slate-600">האם לפצות את המדריך?</Label>
                    <Select
                      value={absenceForm.instructorCompensationDecision || ''}
                      onValueChange={(value) =>
                        setAbsenceForm((prev) => ({ ...prev, instructorCompensationDecision: value }))
                      }
                    >
                      <SelectTrigger className="h-8 text-sm mt-1">
                        <SelectValue placeholder="בחרו" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="compensated">
                          {getCompensationDecisionLabel('compensated')}
                        </SelectItem>
                        <SelectItem value="not_compensated">
                          {getCompensationDecisionLabel('not_compensated')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {absenceRequiresCompensationDecision
                        ? `לפי המדיניות, "${getCancellationStatusLabel(absenceForm.status)}" מחייב את התלמיד — יש להחליט בנפרד לגבי שכר המדריך.`
                        : `אם לא בוחרים, המדיניות הרגילה חלה.`}
                    </p>
                  </div>
                )}

                {absenceFormError && (
                  <Alert className="border-red-300 bg-red-50 text-red-950">
                    <AlertTriangle className="h-4 w-4 text-red-700" />
                    <AlertDescription>{absenceFormError}</AlertDescription>
                  </Alert>
                )}

                <div className="flex gap-2 justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={closeAbsenceForm}
                    disabled={isMarkingAttendance}
                  >
                    ביטול
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={confirmAbsenceForm}
                    disabled={
                      isMarkingAttendance ||
                      absenceRequirementsLoading ||
                      !absenceRequirements ||
                      (absenceRequiresCompensationDecision && !absenceForm.instructorCompensationDecision)
                    }
                  >
                    {isMarkingAttendance ? <Loader2 className="h-3 w-3 animate-spin" /> : 'אישור'}
                  </Button>
                </div>
              </div>
            )}

            {/* ── RESTORE / STATUS-CHANGE PREVIEW ─────────────────── */}
            {isRestorePreviewOpen && (
              <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-4 space-y-3">
                {/* Header */}
                <div className="flex items-center gap-2">
                  <RotateCcw className="h-3.5 w-3.5 text-slate-500" />
                  <span className="text-sm font-semibold text-slate-800">
                    {restorePreview?.targetStatus === 'scheduled'
                      ? 'השפעות שחזור לסטטוס מתוכנן'
                      : `השפעות שינוי ל-${getParticipantStatusLabel(restorePreview?.targetStatus)}`}
                  </span>
                </div>

                {/* Impact groups */}
                {previewImpactGroups.length > 0 ? (
                  <div className="space-y-2">
                    {previewImpactGroups.map((group) => (
                      <div
                        key={group.key}
                        className={`rounded-xl border overflow-hidden ${group.borderClass}`}
                      >
                        {/* Group header */}
                        <div className={`px-3 py-1.5 text-xs font-semibold ${group.bgClass}`}>
                          {group.label}
                        </div>
                        {/* Group rows */}
                        <div className="divide-y divide-slate-100 bg-white">
                          {group.impacts.map((impact, index) => (
                            <div
                              key={`${impact.type || group.key}-${index}`}
                              className="px-3 py-2.5"
                            >
                              <p className="text-sm text-slate-800">{impact.message}</p>
                              {impact.type === 'hmo_split_detail' && (
                                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-fuchsia-100 bg-fuchsia-50/60 px-3 py-2 text-xs text-slate-700">
                                  {(impact.hmo_provider_name || impact.hmo_provider_track_name) && (
                                    <div className="col-span-2 font-medium text-slate-800">
                                      {[impact.hmo_provider_name, impact.hmo_provider_track_name].filter(Boolean).join(' · ')}
                                    </div>
                                  )}
                                  {impact.hmo_authorization_id && (
                                    <div className="col-span-2 text-slate-500">אישור #{shortId(impact.hmo_authorization_id)}</div>
                                  )}
                                  <div>
                                    <span className="text-slate-500">השתתפות לקוח/ה</span>
                                    <div className="font-medium">{formatAgorotPreview(impact.hmo_student_copay_amount)}</div>
                                  </div>
                                  <div>
                                    <span className="text-slate-500">תביעה לגורם מממן</span>
                                    <div className="font-medium">{formatAgorotPreview(impact.hmo_insurer_claim_amount)}</div>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-500">
                    {restorePreview?.targetStatus === 'scheduled'
                      ? 'אין השפעות נוספות — התלמיד יחזור לסטטוס מתוכנן.'
                      : 'אין השפעות נוספות מעבר לעדכון הסטטוס.'}
                  </p>
                )}

                {restorePreviewError && (
                  <Alert className="border-red-300 bg-red-50 text-red-950">
                    <AlertTriangle className="h-4 w-4 text-red-700" />
                    <AlertDescription>{restorePreviewError}</AlertDescription>
                  </Alert>
                )}

                <div className="flex gap-2 justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setRestorePreview(null);
                      setRestorePreviewError('');
                    }}
                    disabled={isMarkingAttendance}
                  >
                    ביטול
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={async () => {
                      const result = await handleMarkAttendance(
                        participant.id,
                        restorePreview?.targetStatus || 'scheduled',
                        restorePreview?.notes || '',
                        {
                          instructorCompensationDecision:
                            restorePreview?.instructorCompensationDecision || null,
                          isExcused: restorePreview?.isExcused === true,
                        },
                      );
                      if (!result?.ok) {
                        setRestorePreviewError(result?.error || 'שחזור הסטטוס נכשל.');
                      }
                    }}
                    disabled={isMarkingAttendance}
                  >
                    {isMarkingAttendance ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : restorePreview?.targetStatus === 'scheduled' ? (
                      'אשר שחזור'
                    ) : (
                      'אשר שינוי'
                    )}
                  </Button>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
