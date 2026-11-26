import { describeError, resolveApiErrorMessage } from '../../../lib/error-support.js';

export const CORRECTION_ERROR_FALLBACK = 'יצירת תצוגת מקדימה נכשלה.';

/**
 * The text LockedCorrectionPanel shows when a correction preview or save fails
 * (docs/project-rules/20, "Showing an error").
 *
 * - Known codes keep their dedicated Hebrew text, with the names of the blocking participants.
 * - Anything else gets the shared title: a known Hebrew message, or the fallback with the public
 *   code (or HTTP status) in parentheses. When the server lists participants that need attention,
 *   their names (or their count) follow the title, so the useful business detail is kept.
 * - A saved support code is a separate field, appended as "קוד תמיכה: …" so the Alert lifts it into
 *   its code chip; it never replaces the title.
 *
 * The panel passes the same text, without the support code, to ErrorDetails, so the copied
 * message equals what the user reads.
 */
export function resolveCorrectionErrorMessage(error, participantsById = new Map()) {
  const code = resolveApiErrorMessage(error);
  const details = error?.data?.details || {};
  const participantIds = Array.isArray(details?.participant_ids) ? details.participant_ids : [];
  const blockingNames = participantIds
    .map((participantId) => participantsById.get(participantId))
    .filter(Boolean);
  const view = describeError(error, { fallback: CORRECTION_ERROR_FALLBACK });

  let text = '';
  if (code === 'cancelled_instance_has_attended_participants') {
    text = blockingNames.length > 0
      ? `לא ניתן לסמן את השיעור כמבוטל כל עוד יש משתתפים שסומנו כנוכחים: ${blockingNames.join(', ')}.`
      : 'לא ניתן לסמן את השיעור כמבוטל כל עוד יש משתתפים שסומנו כנוכחים. יש לעדכן קודם את סטטוס המשתתפים הרלוונטיים.';
  } else if (code === 'completed_instance_has_scheduled_participants') {
    text = blockingNames.length > 0
      ? `לא ניתן לסמן את השיעור כהושלם כל עוד המשתתפים הבאים עדיין במצב מתוכנן: ${blockingNames.join(', ')}.`
      : 'לא ניתן לסמן את השיעור כהושלם כל עוד יש משתתפים שעדיין במצב מתוכנן.';
  } else if (code === 'invalid_participant_patch_status') {
    text = 'אחד מסטטוסי המשתתפים שנבחרו אינו תקין.';
  } else if (code === 'failed_to_build_correction_preview') {
    text = 'יצירת תצוגת ההשפעה נכשלה. נסו לרענן את השיעור ולנסות שוב.';
  } else {
    text = view.message;
    if (blockingNames.length > 0) {
      text = `${text} משתתפים שדורשים טיפול: ${blockingNames.join(', ')}.`;
    } else if (participantIds.length > 0) {
      text = `${text} ${participantIds.length} משתתפים דורשים טיפול.`;
    }
  }

  return view.supportCode ? `${text} קוד תמיכה: ${view.supportCode}` : text;
}
