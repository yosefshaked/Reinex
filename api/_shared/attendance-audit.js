import { coerceAgorot } from './currency.js';

export async function buildAttendanceTransitionAuditChanges(preview) {
  if (!preview) {
    return [];
  }

  const changes = [
    {
      field: 'participant_status',
      before: preview.participant_status_before,
      after: preview.participant_status_after,
    },
  ];

  if (preview.lesson_status_before !== preview.lesson_status_after) {
    changes.push({
      field: 'lesson_status',
      before: preview.lesson_status_before,
      after: preview.lesson_status_after,
    });
  }

  if (Number(preview.projected?.billing_amount_reversed || 0) > 0) {
    changes.push({
      field: 'billing_amount_reversed',
      before: 0,
      after: coerceAgorot(preview.projected.billing_amount_reversed),
    });
  }
  if (Number(preview.projected?.billing_amount_added || 0) > 0) {
    changes.push({
      field: 'billing_amount_added',
      before: 0,
      after: coerceAgorot(preview.projected.billing_amount_added),
    });
  }

  const instructorEarningBefore = coerceAgorot(preview.projected?.instructor_earning_before);
  const instructorEarningAfter = coerceAgorot(preview.projected?.instructor_earning_after);
  if (coerceAgorot(preview.projected?.instructor_earning_removed) > 0) {
    changes.push({
      field: 'instructor_earning_removed',
      before: 0,
      after: coerceAgorot(preview.projected.instructor_earning_removed),
    });
  }
  if (coerceAgorot(preview.projected?.instructor_earning_added) > 0) {
    changes.push({
      field: 'instructor_earning_added',
      before: 0,
      after: coerceAgorot(preview.projected.instructor_earning_added),
    });
  }
  if (
    instructorEarningBefore > 0
    && instructorEarningAfter > 0
    && instructorEarningBefore !== instructorEarningAfter
  ) {
    changes.push({
      field: 'instructor_earning_amount',
      before: instructorEarningBefore,
      after: instructorEarningAfter,
    });
  }

  const attendanceImpact = (preview.impacts || []).some((impact) => (
    impact?.type === 'instructor_attendance_remove'
      || impact?.type === 'instructor_attendance_update'
      || impact?.type === 'instructor_attendance_add'
  ));
  if (attendanceImpact) {
    changes.push({
      field: 'instructor_attendance_worked_minutes',
      before: preview.projected?.instructor_attendance_worked_minutes_before,
      after: preview.projected?.instructor_attendance_worked_minutes,
    });
  }

  if (preview.projected?.hmo_task_id_to_resolve) {
    changes.push({
      field: 'hmo_task_resolved',
      before: false,
      after: true,
    });
  }

  return changes;
}