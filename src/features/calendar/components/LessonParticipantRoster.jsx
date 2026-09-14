import { useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Check,
  ExternalLink,
  FileCheck,
  FileEdit,
  Loader2,
  Lock,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Phone,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import { getParticipantDisplayName } from '../utils/participantDisplay.js';
import { getParticipantCardHref, getParticipantStatusDisplay, shouldShowGraceWaiver } from '../utils/lessonDialogModel.js';
import { LessonImpactStrip, ParticipantStatusPill } from './LessonImpactStrip.jsx';

const ABSENCE_STATUSES = ['no_show', 'cancelled_student', 'cancelled_clinic'];

const AVATAR_CLASSES = {
  attended: 'bg-emerald-50 text-emerald-700',
  no_show: 'bg-red-50 text-red-700',
  cancelled_student: 'bg-slate-100 text-slate-500',
  cancelled_clinic: 'bg-slate-100 text-slate-500',
};

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return parts[0][0] + parts[parts.length - 1][0];
}

function formatShortDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function HintIcon({ label, children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-xs whitespace-pre-line text-start text-xs leading-relaxed">{label}</TooltipContent>
    </Tooltip>
  );
}

function IconButton({ label, className = '', ...props }) {
  return (
    <HintIcon label={label}>
      <Button type="button" size="sm" variant="ghost" aria-label={label} className={`h-8 w-8 p-0 ${className}`} {...props} />
    </HintIcon>
  );
}

function HmoBadge({ coverage }) {
  if (!coverage?.hmo_provider_name) return null;
  const lines = [
    [coverage.hmo_provider_name, coverage.hmo_provider_track_name].filter(Boolean).join(' · '),
    coverage.authorization_reference ? `מספר אישור: ${coverage.authorization_reference}` : null,
    coverage.remaining_authorized_lessons != null
      ? (coverage.authorized_lessons
        ? `נותרו ${coverage.remaining_authorized_lessons} מתוך ${coverage.authorized_lessons} מפגשים`
        : `נותרו ${coverage.remaining_authorized_lessons} מפגשים`)
      : null,
    coverage.expires_at ? `בתוקף עד ${formatShortDate(coverage.expires_at)}` : null,
    coverage.status === 'blocked' ? 'הכיסוי חסום — דורש בדיקה' : null,
  ].filter(Boolean);
  const tone = coverage.status === 'blocked'
    ? 'bg-amber-50 text-amber-800'
    : 'bg-violet-50 text-violet-700';

  return (
    <HintIcon label={lines.join('\n')}>
      <span
        tabIndex={0}
        aria-label={lines.join(', ')}
        className={`inline-flex h-5 cursor-help items-center rounded-md px-1.5 text-[11px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-primary ${tone}`}
      >
        {coverage.hmo_provider_name}
      </span>
    </HintIcon>
  );
}

function ContactText({ contact }) {
  if (!contact?.phone && !contact?.email) {
    return <span>אין פרטי קשר</span>;
  }
  return (
    <span>
      {contact.source === 'guardian' ? `${contact.name || 'הורה/אפוטרופוס'} (הורה) · ` : ''}
      <bdi dir="ltr">{contact.phone || contact.email}</bdi>
    </span>
  );
}

function ReminderBell({ participant, contact, waPhone, hasSent, hasConfirmed, disabled, onSendWhatsApp, onSendEmail, onConfirmArrival, onDeclineArrival }) {
  const [open, setOpen] = useState(false);
  const name = getParticipantDisplayName(participant, 'לקוח/ה');
  const stateLabel = hasConfirmed ? 'אישר/ה הגעה' : hasSent ? 'תזכורת נשלחה — ממתין לאישור הגעה' : 'לא נשלחה תזכורת';
  const colorClass = hasConfirmed ? 'text-emerald-600' : hasSent ? 'text-amber-500' : 'text-slate-400';
  const run = (action) => {
    setOpen(false);
    action();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button type="button" size="sm" variant="ghost" className={`h-8 w-8 p-0 ${colorClass}`} aria-label={`תזכורת: ${stateLabel}`} disabled={disabled}>
              <Bell className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent className="text-xs">{stateLabel}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72 space-y-2.5 p-3 text-start" dir="rtl">
        <div className="text-sm font-bold text-slate-900">תזכורת · {name}</div>
        <div className="text-xs text-slate-500"><ContactText contact={contact} /></div>
        {hasConfirmed ? (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
            <Check className="h-3.5 w-3.5" /> אישר/ה הגעה
          </div>
        ) : hasSent ? (
          <>
            <div className="text-xs text-slate-600">התזכורת נשלחה. מה ענו?</div>
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => run(() => onConfirmArrival(participant))}>
                <ThumbsUp className="h-3.5 w-3.5" /> אישר/ה הגעה
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => run(() => onDeclineArrival(participant))}>
                <ThumbsDown className="h-3.5 w-3.5" /> לא יגיע/תגיע
              </Button>
            </div>
            {waPhone ? (
              <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={() => run(() => onSendWhatsApp(participant))}>
                <MessageCircle className="h-3.5 w-3.5" /> שליחה חוזרת בוואטסאפ
              </Button>
            ) : null}
          </>
        ) : waPhone || contact?.email ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {waPhone ? (
                <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => run(() => onSendWhatsApp(participant))}>
                  <MessageCircle className="h-3.5 w-3.5" /> וואטסאפ
                </Button>
              ) : null}
              {contact?.email ? (
                <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => run(() => onSendEmail(participant))}>
                  <Mail className="h-3.5 w-3.5" /> מייל
                </Button>
              ) : null}
            </div>
            <div className="text-xs text-slate-500">ההודעה תיפתח מוכנה לשליחה, והתזכורת תסומן כנשלחה.</div>
          </>
        ) : (
          <div className="text-xs text-slate-500">אי אפשר לשלוח תזכורת — עדכנו פרטי קשר בכרטיס הלקוח.</div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ReportSignal({ participant, hasReport, loading, loadFailed, onOpen, onRetry }) {
  if (hasReport) {
    return (
      <HintIcon label="דיווח מפגש מתועד">
        <span tabIndex={0} className="grid h-8 w-8 place-items-center rounded-md text-emerald-600 outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <FileCheck className="h-4 w-4" />
        </span>
      </HintIcon>
    );
  }
  if (loading) {
    return (
      <span className="grid h-8 w-8 place-items-center text-slate-400" aria-label="בודקים את סטטוס הדיווח">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </span>
    );
  }
  if (loadFailed) {
    return <IconButton label="לא ניתן היה לבדוק את סטטוס הדיווח — נסו שוב" className="text-red-500" onClick={onRetry}><RotateCcw className="h-4 w-4" /></IconButton>;
  }
  return <IconButton label="תיעוד דיווח מפגש" className="text-amber-500 hover:text-amber-600" onClick={() => onOpen(participant)}><FileEdit className="h-4 w-4" /></IconButton>;
}

function AbsenceForm({
  participant,
  absenceForm,
  setAbsenceForm,
  error,
  requirements,
  requirementsLoading,
  billingPolicy,
  instructorName,
  canWaive,
  busy,
  onStatusChange,
  onClose,
  onContinue,
}) {
  const needsCompensation = Boolean(requirements?.requires_instructor_compensation_decision)
    && ABSENCE_STATUSES.includes(absenceForm.status);
  const waiverEligible = shouldShowGraceWaiver(billingPolicy, absenceForm.status);
  const chip = (selected) => `inline-flex flex-col items-start rounded-lg border px-3 py-1.5 text-start text-xs font-bold transition ${
    selected ? 'border-primary bg-primary/10 text-slate-900' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
  }`;

  return (
    <div className="grid gap-3 border-t border-dashed border-slate-200 bg-slate-50 px-3.5 py-3 sm:grid-cols-2" role="group" aria-label={`סימון היעדרות עבור ${getParticipantDisplayName(participant, 'לקוח/ה')}`}>
      <div className="sm:col-span-2">
        <div className="mb-1.5 text-xs font-bold text-slate-600">מה קרה?</div>
        <div className="flex flex-wrap gap-1.5" role="radiogroup">
          {ABSENCE_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              role="radio"
              aria-checked={absenceForm.status === status}
              className={chip(absenceForm.status === status)}
              onClick={() => onStatusChange(status)}
            >
              {getParticipantStatusDisplay(status).label}
              <span className={`text-[11px] font-semibold ${absenceForm.status === status ? 'text-primary' : 'text-slate-400'}`}>
                {billingPolicy?.[status] ? 'יחויב לפי המדיניות' : 'ללא חיוב'}
              </span>
            </button>
          ))}
        </div>
      </div>

      {requirementsLoading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500 sm:col-span-2">
          <Loader2 className="h-3 w-3 animate-spin" /> בודקים את דרישות הסטטוס...
        </div>
      ) : null}

      {needsCompensation ? (
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-xs font-bold text-slate-600">
            שכר ל{instructorName || 'מדריך/ה'} על המפגש
            {absenceForm.compensationFromPolicy ? (
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold text-primary">לפי הגדרות השכר</span>
            ) : null}
          </div>
          <div className="flex gap-1.5" role="radiogroup">
            {[['compensated', 'לשלם'], ['not_compensated', 'לא לשלם']].map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={absenceForm.instructorCompensationDecision === value}
                className={chip(absenceForm.instructorCompensationDecision === value)}
                onClick={() => setAbsenceForm((prev) => ({ ...prev, instructorCompensationDecision: value, compensationFromPolicy: false }))}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {waiverEligible ? (
        <div>
          <div className="mb-1.5 text-xs font-bold text-slate-600">חיוב הלקוח/ה</div>
          <div className="flex items-center gap-2" title={canWaive ? '' : 'לא ניתן לוותר על חיוב בשיעור נעול.'}>
            <Checkbox
              id={`waive-fee-${participant.id}`}
              checked={absenceForm.waiveFee === true}
              onCheckedChange={(checked) => setAbsenceForm((prev) => ({ ...prev, waiveFee: checked === true }))}
              disabled={!canWaive}
            />
            <Label htmlFor={`waive-fee-${participant.id}`} className="text-xs font-semibold">ויתור על החיוב</Label>
          </div>
        </div>
      ) : null}

      <div className="sm:col-span-2">
        <Label htmlFor={`absence-note-${participant.id}`} className="text-xs font-bold text-slate-600">הערה (לא חובה)</Label>
        <Textarea
          id={`absence-note-${participant.id}`}
          className="mt-1 resize-none bg-white text-sm"
          rows={2}
          placeholder="לדוגמה: הודיעה בבוקר שהיא חולה"
          value={absenceForm.notes}
          onChange={(event) => setAbsenceForm((prev) => ({ ...prev, notes: event.target.value }))}
        />
      </div>

      <div className="flex items-center justify-end gap-1.5 sm:col-span-2">
        {error ? (
          <span className="me-auto inline-flex items-center gap-1.5 text-xs font-medium text-red-700">
            <AlertTriangle className="h-3.5 w-3.5" /> {error}
          </span>
        ) : null}
        <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={onClose} disabled={busy}>ביטול</Button>
        <Button
          type="button"
          size="sm"
          className="h-8 bg-primary text-xs text-primary-foreground hover:bg-primary/90"
          onClick={() => onContinue()}
          disabled={busy || requirementsLoading || !requirements || (needsCompensation && !absenceForm.instructorCompensationDecision)}
        >
          המשך
        </Button>
      </div>
    </div>
  );
}

function ParticipantRow(props) {
  const {
    participant,
    localReminderState,
    lessonStarted,
    canMarkAttendance,
    canManageAll,
    isLocked,
    isMarkingAttendance,
    reminderUpdating,
    sessionReportsEnabled,
    reportsByParticipant,
    sessionReportsLoading,
    sessionReportsLoadFailed,
    onOpenSessionReport,
    onRetrySessionReports,
    resolveReminderContact,
    formatPhoneForWhatsApp,
    onMarkAttended,
    onOpenAbsence,
    onRestore,
    onSendWhatsApp,
    onSendEmail,
    onConfirmArrival,
    onDeclineArrival,
    absenceForm,
    statusStrip,
  } = props;

  const status = participant.participant_status || 'scheduled';
  const isScheduled = status === 'scheduled';
  const name = getParticipantDisplayName(participant, 'לא ידוע');
  const reminder = localReminderState[participant.id] || {};
  const hasSent = reminder.reminder_sent ?? participant.reminder_sent ?? false;
  const hasConfirmed = reminder.reminder_seen ?? participant.reminder_seen ?? false;
  const contact = resolveReminderContact(participant);
  const waPhone = formatPhoneForWhatsApp(contact.phone);
  const isAbsenceOpen = absenceForm?.participantId === participant.id;
  const isStripOpen = statusStrip?.participantId === participant.id;
  const busy = isAbsenceOpen || isStripOpen || isMarkingAttendance;
  const cardHref = getParticipantCardHref(participant);

  const showBell = canManageAll && isScheduled && !isLocked;
  const showReport = sessionReportsEnabled && lessonStarted && ['attended', 'scheduled'].includes(status);
  const hasSignals = showBell || showReport;

  return (
    <>
      <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-3" data-participant-row={participant.id}>
        <div className={`grid h-10 w-10 select-none place-items-center rounded-xl text-[13px] font-bold ${AVATAR_CLASSES[status] || 'bg-primary/10 text-primary'}`} aria-hidden="true">
          {getInitials(name)}
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-slate-900">
            {name}
            <HmoBadge coverage={participant.hmo_coverage} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            {!isScheduled ? <ParticipantStatusPill status={status} /> : null}
            {isScheduled && lessonStarted ? <ParticipantStatusPill label="טרם סומן" tone="open" /> : null}
            {(!isScheduled || lessonStarted) ? <span aria-hidden="true" className="text-slate-300">·</span> : null}
            <ContactText contact={contact} />
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          {showBell ? (
            <ReminderBell
              participant={participant}
              contact={contact}
              waPhone={waPhone}
              hasSent={hasSent}
              hasConfirmed={hasConfirmed}
              disabled={reminderUpdating}
              onSendWhatsApp={onSendWhatsApp}
              onSendEmail={onSendEmail}
              onConfirmArrival={onConfirmArrival}
              onDeclineArrival={onDeclineArrival}
            />
          ) : null}
          {showReport ? (
            <ReportSignal
              participant={participant}
              hasReport={Boolean(reportsByParticipant?.[participant.id])}
              loading={sessionReportsLoading}
              loadFailed={sessionReportsLoadFailed}
              onOpen={onOpenSessionReport}
              onRetry={onRetrySessionReports}
            />
          ) : null}
          {hasSignals ? <span className="mx-1.5 h-5 w-px bg-slate-200" aria-hidden="true" /> : null}

          {isLocked ? (
            <span className="inline-flex items-center gap-1 px-1 text-xs text-slate-400"><Lock className="h-3.5 w-3.5" /> נעול</span>
          ) : (
            <>
              {canMarkAttendance && isScheduled ? (
                <>
                  <IconButton label="סימון כנוכח/ת" className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700" onClick={() => onMarkAttended(participant)} disabled={busy} data-mark-attended={participant.id}>
                    <Check className="h-4 w-4" />
                  </IconButton>
                  <IconButton label="לא הגיע/ה או ביטול" className="text-red-500 hover:bg-red-50 hover:text-red-600" onClick={() => onOpenAbsence(participant.id)} disabled={busy}>
                    <XCircle className="h-4 w-4" />
                  </IconButton>
                </>
              ) : null}
              {/* No tooltip here: focus returns to this trigger when the menu closes, and an open tooltip
                  would swallow the next Escape instead of letting it close the dialog. */}
              <DropdownMenu dir="rtl">
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-500" aria-label="פעולות נוספות" disabled={busy}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  {canMarkAttendance && status !== 'attended' && !isScheduled ? (
                    <DropdownMenuItem onSelect={() => onMarkAttended(participant)} className="gap-2"><Check className="h-3.5 w-3.5" /> סימון כנוכח/ת</DropdownMenuItem>
                  ) : null}
                  {canMarkAttendance && !isScheduled ? (
                    <>
                      <DropdownMenuItem onSelect={() => onOpenAbsence(participant.id, ABSENCE_STATUSES.includes(status) ? { status } : {})} className="gap-2">
                        <XCircle className="h-3.5 w-3.5" /> {status === 'attended' ? 'סימון היעדרות / ביטול' : 'שינוי סיבת ההיעדרות'}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onRestore(participant)} className="gap-2"><RotateCcw className="h-3.5 w-3.5" /> החזרה למתוכנן</DropdownMenuItem>
                    </>
                  ) : null}
                  {contact.phone ? (
                    <DropdownMenuItem asChild className="gap-2">
                      <a href={`tel:${contact.phone}`}><Phone className="h-3.5 w-3.5" /> התקשרות · <bdi dir="ltr">{contact.phone}</bdi></a>
                    </DropdownMenuItem>
                  ) : null}
                  {cardHref ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild className="gap-2">
                        <a href={cardHref} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /> פתיחת כרטיס לקוח</a>
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {isAbsenceOpen ? (
        <AbsenceForm
          participant={participant}
          absenceForm={absenceForm}
          setAbsenceForm={props.setAbsenceForm}
          error={props.absenceFormError}
          requirements={props.absenceRequirements}
          requirementsLoading={props.absenceRequirementsLoading}
          billingPolicy={props.billingPolicy}
          instructorName={props.instructorName}
          canWaive={props.isOperationallyOpen}
          busy={isMarkingAttendance}
          onStatusChange={props.onAbsenceStatusChange}
          onClose={props.onCloseAbsence}
          onContinue={props.onContinueAbsence}
        />
      ) : null}

      {isStripOpen ? (
        <LessonImpactStrip
          fromStatus={status}
          toStatus={statusStrip.targetStatus}
          loading={statusStrip.loading}
          preview={statusStrip.preview}
          error={statusStrip.error}
          note={statusStrip.note}
          saving={isMarkingAttendance}
          onConfirm={props.onConfirmStrip}
          onCancel={props.onCancelStrip}
        />
      ) : null}
    </>
  );
}

/**
 * Participant list for the lesson dialog: one aligned row per participant (identity, status, small
 * contact line; reminder/report signals and actions grouped at the row end). The absence form and
 * the one-line confirm strip expand under the row they belong to.
 */
export function LessonParticipantRoster({ participants, ...rowProps }) {
  if (!participants.length) return null;
  return (
    <div className="divide-y divide-slate-100 overflow-visible rounded-2xl border border-slate-200 bg-white">
      {participants.map((participant) => (
        <ParticipantRow key={participant.id} participant={participant} {...rowProps} />
      ))}
    </div>
  );
}
