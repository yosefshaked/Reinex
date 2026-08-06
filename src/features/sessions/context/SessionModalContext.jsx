import React, { createContext, useContext } from 'react';

/**
 * Session Reports Phase 3 — anchored report-drawer contract.
 *
 * openSessionReportModal takes a lesson-participant context, never a bare
 * student/date pair. Report creation is always anchored to exactly one
 * lesson_participants row (see implementations/session-reports/
 * implementation-plan.md, Invariants block) — there is no "loose report" /
 * unassigned-student entry point anymore.
 *
 * @typedef {Object} SessionReportModalContext
 * @property {string} lessonParticipantId - required anchor.
 * @property {string} [studentName] - optional display hint, the drawer also
 *   resolves this itself via the context GET.
 * @property {string} [serviceName] - optional display hint.
 * @property {string} [lessonDateTime] - optional display hint (ISO string).
 * @property {SessionReportModalContext[]} [continuationQueue] - optional
 *   caller-owned queue of already-anchored pending reports.
 */
export const SessionModalContext = createContext({
  openSessionReportModal: () => {},
  closeSessionReportModal: () => {},
  isSessionReportModalOpen: false,
  sessionReportModalContext: null,
});

export function useSessionModal() {
  return useContext(SessionModalContext);
}

export function buildSessionReportContinuationQueue(items, currentLessonParticipantId) {
  const pendingItems = Array.isArray(items) ? items : [];
  const currentIndex = pendingItems.findIndex(
    (item) => item?.lesson_participant_id === currentLessonParticipantId,
  );
  if (currentIndex < 0) return [];

  return pendingItems.slice(currentIndex + 1).flatMap((item) => {
    if (!item?.lesson_participant_id) return [];
    return [{
      lessonParticipantId: item.lesson_participant_id,
      studentName: item.student_name || '',
      serviceName: item.service_name || '',
      lessonDateTime: item.lesson_datetime_start || '',
    }];
  });
}
