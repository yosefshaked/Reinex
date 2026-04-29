import { Badge } from '../../../components/ui/badge';

export function LessonReminderSummary({
  participants,
  localReminderState,
  canManageAll,
  resolveReminderContact,
}) {
  if (!canManageAll) {
    return null;
  }

  const scheduledParticipants = (Array.isArray(participants) ? participants : []).filter(
    (participant) => participant?.participant_status === 'scheduled',
  );

  if (scheduledParticipants.length === 0) {
    return null;
  }

  let sentCount = 0;
  let confirmedCount = 0;
  let noContactCount = 0;

  for (const participant of scheduledParticipants) {
    const localState = localReminderState?.[participant.id] || {};
    const hasSent = localState.reminder_sent ?? participant?.reminder_sent ?? false;
    const hasConfirmed = localState.reminder_seen ?? participant?.reminder_seen ?? false;
    const contact = resolveReminderContact(participant);
    if (!contact?.phone && !contact?.email) {
      noContactCount += 1;
    }
    if (hasSent) {
      sentCount += 1;
    }
    if (hasConfirmed) {
      confirmedCount += 1;
    }
  }

  const totalCount = scheduledParticipants.length;
  const pendingCount = Math.max(0, sentCount - confirmedCount);
  const unsentCount = Math.max(0, totalCount - sentCount);

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-800">תזכורות</div>
          <div className="text-xs text-slate-600">סיכום מצב ההודעות למשתתפים שעדיין מתוכננים.</div>
        </div>
        <Badge variant="outline">{`${confirmedCount}/${totalCount} אישרו`}</Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-700 sm:grid-cols-4">
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">נשלח: {sentCount}/{totalCount}</div>
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">ממתינים: {pendingCount}</div>
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">לא נשלח: {unsentCount}</div>
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">ללא איש קשר: {noContactCount}</div>
      </div>
    </div>
  );
}
