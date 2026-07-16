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
