import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../../components/ui/select';
import { Badge } from '../../../components/ui/badge';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Textarea } from '../../../components/ui/textarea';
import { Checkbox } from '../../../components/ui/checkbox';
import { Check, XCircle, Loader2, AlertTriangle, MessageCircle, Mail, ThumbsUp, ThumbsDown, RotateCcw } from 'lucide-react';
import { getParticipantDisplayName } from '../utils/participantDisplay.js';

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
  getWorkflowDecisionLabel,
  shouldShowGraceWaiver,
  getCancellationStatusLabel,
  getCompensationDecisionLabel,
  getParticipantStatusLabel,
  groupPreviewImpacts,
  shortId,
  formatAgorotPreview,
}) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-700">
        משתתפים ({displayParticipants.length || 0})
      </label>
      {canQuickReport && hasUnsetParticipants && (
        <Alert className="mt-2 border-amber-400 bg-amber-50">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-900 text-sm">
            {'יש לסמן נוכחות לכל התלמידים לפני השלמת השיעור'}
            {` (${scheduledParticipantsCount} ${scheduledParticipantsCount === 1 ? 'תלמיד ממתין' : 'תלמידים ממתינים'})`}
          </AlertDescription>
        </Alert>
      )}
      <div className="mt-2 space-y-2">
        {displayParticipants.map((participant) => {
          const rs = localReminderState[participant.id] || {};
          const hasSent = rs.reminder_sent ?? participant.reminder_sent ?? false;
          const hasConfirmed = rs.reminder_seen ?? participant.reminder_seen ?? false;
          const reminderContact = resolveReminderContact(participant);
          const waPhone = formatPhoneForWhatsApp(reminderContact.phone);
          const emailAddress = reminderContact.email;
          const isScheduled = participant.participant_status === 'scheduled';
          const isAbsenceFormOpen = absenceForm?.participantId === participant.id;
          const isRestorePreviewOpen = restorePreview?.participantId === participant.id;
          const participantNotes = participant.metadata?.notes || null;
          const {
            studentBillingDecision,
            compensationDecision,
            hmoDecision,
          } = deriveDisplayWorkflowDecisions(participant, billingPolicy);
          const absenceRequiresCompensationDecision = isAbsenceFormOpen && Boolean(absenceRequirements?.requires_instructor_compensation_decision);
          const absenceShowsCompensationDecision = isAbsenceFormOpen
            && !absenceRequirementsLoading
            && Boolean(absenceRequirements?.requires_instructor_compensation_decision)
            && ['no_show', 'cancelled_student', 'cancelled_clinic'].includes(absenceForm.status);
          const graceWaiverEligible = isAbsenceFormOpen
            && shouldShowGraceWaiver(billingPolicy, absenceForm?.status);
          const waiveFeeDisabled = !isOperationallyOpen;
          const previewImpactGroups = isRestorePreviewOpen
            ? groupPreviewImpacts(restorePreview.preview?.impacts || [])
            : [];
          const previewProjected = restorePreview?.preview?.projected || null;
          const showProjectedHmoSplit = previewProjected?.hmo_split_applied === true;

          return (
            <div key={participant.id} className="p-3 bg-gray-50 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="font-medium">{getParticipantDisplayName(participant, 'לא ידוע')}</p>
                  <div className="text-sm text-gray-600">
                    {participant.participant_status === 'attended' && '✓ נכח'}
                    {participant.participant_status === 'no_show' && '✗ לא הגיע'}
                    {participant.participant_status === 'scheduled' && 'מתוכנן'}
                    {participant.participant_status === 'cancelled_student' && 'בוטל ע"י תלמיד'}
                    {participant.participant_status === 'cancelled_clinic' && 'בוטל ע"י המכון'}
                  </div>
                  {participantNotes && (
                    <p className="text-xs text-gray-500 mt-0.5 italic">{participantNotes}</p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                    <Badge variant="outline">{getWorkflowDecisionLabel(studentBillingDecision, 'student_billing')}</Badge>
                    <Badge variant="outline">{getWorkflowDecisionLabel(compensationDecision, 'instructor_compensation')}</Badge>
                    <Badge variant="outline">{getWorkflowDecisionLabel(hmoDecision, 'hmo_claim')}</Badge>
                  </div>
                </div>
                {canMarkAttendance && !isAbsenceFormOpen && (
                  <div className="flex gap-1 ms-2">
                    {isScheduled && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openAttendancePreview(participant, 'attended')}
                        disabled={isMarkingAttendance}
                        title="נכח"
                      >
                        <Check className="h-4 w-4 text-green-600" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openAbsenceForm(participant.id)}
                      disabled={isMarkingAttendance}
                      title="לא הגיע / ביטול"
                    >
                      <XCircle className="h-4 w-4 text-red-600" />
                    </Button>
                    {!isScheduled && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openRestorePreview(participant)}
                        disabled={isMarkingAttendance || restorePreviewLoading}
                        title="שחזר לתוכנן"
                      >
                        <RotateCcw className="h-4 w-4 text-blue-600" />
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {isAbsenceFormOpen && (
                <div className="pt-2 border-t border-red-200 space-y-2">
                  <div>
                    <Label className="text-xs text-gray-600">סוג אי-הגעה</Label>
                    <Select
                      value={absenceForm.status}
                      onValueChange={handleAbsenceStatusChange}
                    >
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
                    <Label className="text-xs text-gray-600">הערה (אופציונלי)</Label>
                    <Textarea
                      className="mt-1 text-sm resize-none"
                      rows={2}
                      placeholder="הוסף הערה..."
                      value={absenceForm.notes}
                      onChange={(event) => setAbsenceForm((prev) => ({ ...prev, notes: event.target.value }))}
                    />
                  </div>
                  {graceWaiverEligible && (
                    <div
                      className={`flex items-center gap-2 rounded-md border px-2 py-2 ${waiveFeeDisabled ? 'bg-slate-100 border-slate-200 text-slate-500' : 'bg-emerald-50 border-emerald-200'}`}
                      title={waiveFeeDisabled ? 'Cannot waive fee for a locked/closed session.' : ''}
                    >
                      <Checkbox
                        id={`waive-fee-${participant.id}`}
                        checked={absenceForm.waiveFee === true}
                        onCheckedChange={(checked) => setAbsenceForm((prev) => ({
                          ...prev,
                          waiveFee: checked === true,
                        }))}
                        disabled={waiveFeeDisabled}
                      />
                      <Label htmlFor={`waive-fee-${participant.id}`} className="text-xs font-medium">
                        ויתור חיוב (Grace)
                      </Label>
                    </div>
                  )}
                  {absenceRequirementsLoading && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      טוען את דרישות הסטטוס...
                    </div>
                  )}
                  {absenceShowsCompensationDecision && (
                    <div>
                      <Label className="text-xs text-gray-600">פיצוי למדריך עבור אי-הגעה מחויבת</Label>
                      <Select
                        value={absenceForm.instructorCompensationDecision || ''}
                        onValueChange={(value) => setAbsenceForm((prev) => ({
                          ...prev,
                          instructorCompensationDecision: value,
                        }))}
                      >
                        <SelectTrigger className="h-8 text-sm mt-1">
                          <SelectValue placeholder="בחרו אם המדריך אמור לקבל פיצוי" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="compensated">{getCompensationDecisionLabel('compensated')}</SelectItem>
                          <SelectItem value="not_compensated">{getCompensationDecisionLabel('not_compensated')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="mt-1 text-[11px] text-gray-500">
                        {absenceRequiresCompensationDecision
                          ? `הסטודנט מחויב לפי המדיניות עבור "${getCancellationStatusLabel(absenceForm.status)}", ולכן צריך להחליט בנפרד אם המדריך מקבל פיצוי.`
                          : `אפשר לבחור מראש אם המדריך יקבל פיצוי עבור "${getCancellationStatusLabel(absenceForm.status)}". אם אין צורך, אפשר להשאיר ללא בחירה.`}
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
                        isMarkingAttendance
                        || absenceRequirementsLoading
                        || !absenceRequirements
                        || (absenceRequiresCompensationDecision && !absenceForm.instructorCompensationDecision)
                      }
                    >
                      {isMarkingAttendance ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        'אישור'
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {isRestorePreviewOpen && (
                <div className="pt-2 border-t border-blue-200 space-y-2">
                  <div className="text-sm font-medium text-slate-800">
                    {restorePreview?.targetStatus === 'scheduled'
                      ? 'השפעות השחזור לתוכנן'
                      : `השפעות שינוי הסטטוס ל-${getParticipantStatusLabel(restorePreview?.targetStatus)}`}
                  </div>
                  {previewImpactGroups.length > 0 ? (
                    <div className="space-y-2">
                      {previewImpactGroups.map((group) => (
                        <div key={group.key} className={`rounded-md border p-2 ${group.borderClass} ${group.bgClass}`}>
                          <div className="text-xs font-medium text-slate-800">{group.label}</div>
                          <ul className="mt-1 list-disc pe-5 text-sm text-slate-700 space-y-1">
                            {group.impacts.map((impact, index) => (
                              <li key={`${impact.type || group.key}-${index}`}>
                                {impact.message}
                                {impact.type === 'hmo_split_detail' && (
                                  <div className="mt-1 text-xs text-slate-700 space-y-0.5">
                                    {impact.hmo_authorization_id && (
                                      <div>אישור: #{shortId(impact.hmo_authorization_id)}</div>
                                    )}
                                    {impact.hmo_provider_name && (
                                      <div>גורם מממן: {impact.hmo_provider_name}</div>
                                    )}
                                    {impact.hmo_provider_track_name && (
                                      <div>מסלול: {impact.hmo_provider_track_name}</div>
                                    )}
                                    <div>השתתפות לקוח/ה: {formatAgorotPreview(impact.hmo_student_copay_amount)}</div>
                                    <div>סכום תביעה לגורם מממן: {formatAgorotPreview(impact.hmo_insurer_claim_amount)}</div>
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <ul className="list-disc pe-5 text-sm text-slate-700 space-y-1">
                      <li>
                        {restorePreview?.targetStatus === 'scheduled'
                          ? 'לא זוהו השפעות נוספות מעבר להחזרת התלמיד לסטטוס "מתוכנן".'
                          : 'לא זוהו השפעות נוספות מעבר לעדכון הסטטוס המבוקש.'}
                      </li>
                    </ul>
                  )}
                  {showProjectedHmoSplit && (
                    <div className="rounded-md border border-fuchsia-200 bg-fuchsia-50/70 p-2">
                      <div className="text-xs font-medium text-slate-800">פירוט פיצול גורם מממן</div>
                      <div className="mt-1 grid grid-cols-1 gap-1 text-xs text-slate-700 sm:grid-cols-2">
                        <div>אישור: #{shortId(previewProjected?.hmo_authorization_id)}</div>
                        <div>גורם מממן: {previewProjected?.hmo_provider_name || 'לא ידוע'}</div>
                        <div>מסלול: {previewProjected?.hmo_provider_track_name || 'לא ידוע'}</div>
                        <div>השתתפות לקוח/ה: {formatAgorotPreview(previewProjected?.hmo_student_copay_amount)}</div>
                        <div>סכום תביעה לגורם מממן: {formatAgorotPreview(previewProjected?.hmo_insurer_claim_amount)}</div>
                      </div>
                    </div>
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
                      variant="outline"
                      onClick={async () => {
                        const attendanceResult = await handleMarkAttendance(
                          participant.id,
                          restorePreview?.targetStatus || 'scheduled',
                          restorePreview?.notes || '',
                          {
                            instructorCompensationDecision: restorePreview?.instructorCompensationDecision || null,
                            isExcused: restorePreview?.isExcused === true,
                          },
                        );
                        if (!attendanceResult?.ok) {
                          setRestorePreviewError(attendanceResult?.error || 'שחזור הסטטוס נכשל.');
                        }
                      }}
                      disabled={isMarkingAttendance}
                    >
                      {isMarkingAttendance ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        restorePreview?.targetStatus === 'scheduled' ? 'אשר שחזור' : 'אשר שינוי'
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {showReminderActions && isScheduled && canManageAll && (
                <div className="flex items-center gap-2 pt-1.5 border-t border-gray-200 flex-wrap">
                  <span className="text-[11px] text-gray-500">
                    {reminderContact.source === 'guardian' ? 'איש קשר: הורה' : 'איש קשר: לקוח/ה'}
                  </span>
                  {waPhone && (
                    <Button
                      size="sm"
                      variant={hasSent ? 'outline' : 'secondary'}
                      onClick={() => handleSendWaReminder(participant)}
                      disabled={reminderUpdating}
                      title="שלח תזכורת ב-WhatsApp"
                      className="h-7 text-xs gap-1"
                    >
                      <MessageCircle className="h-3 w-3" />
                      {hasSent ? 'שלח שוב WA' : 'תזכורת WA'}
                    </Button>
                  )}
                  {emailAddress && (
                    <Button
                      size="sm"
                      variant={hasSent ? 'outline' : 'secondary'}
                      onClick={() => handleSendEmailReminder(participant)}
                      disabled={reminderUpdating}
                      title="שלח תזכורת באימייל"
                      className="h-7 text-xs gap-1"
                    >
                      <Mail className="h-3 w-3" />
                      {hasSent ? 'שלח שוב מייל' : 'תזכורת מייל'}
                    </Button>
                  )}
                  {hasSent && !hasConfirmed && (
                    <>
                      <span className="text-xs text-gray-500">ממתין לאישור</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs gap-1 text-green-700 hover:text-green-800 hover:bg-green-50"
                        onClick={() => handleSetReminderConfirmation(participant, true)}
                        disabled={reminderUpdating}
                        title="אישר הגעה"
                      >
                        <ThumbsUp className="h-3 w-3" />
                        אישר
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs gap-1 text-red-700 hover:text-red-800 hover:bg-red-50"
                        onClick={() => handleSetReminderConfirmation(participant, false)}
                        disabled={reminderUpdating}
                        title="לא יגיע — יבטל השתתפות"
                      >
                        <ThumbsDown className="h-3 w-3" />
                        לא יגיע
                      </Button>
                    </>
                  )}
                  {hasSent && hasConfirmed && (
                    <Badge className="text-xs bg-green-100 text-green-800 border-green-200 font-normal">
                      ✓ אישר הגעה
                    </Badge>
                  )}
                  {!waPhone && !emailAddress && (
                    <span className="text-xs text-gray-400">אין פרטי קשר</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
