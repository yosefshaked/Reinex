import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from '@/lib/toast.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { resolveApiErrorMessage } from '@/lib/error-support.js';
import NewSessionForm, { NewSessionFormFooter } from './NewSessionForm.jsx';
import { buildInitialAnswers } from '@/features/forms/lib/form-schema.js';

const REQUEST_STATE = Object.freeze({
  idle: 'idle',
  loading: 'loading',
  error: 'error',
});

function formatLessonDateTime(isoString) {
  if (!isoString) return '';
  try {
    return new Intl.DateTimeFormat('he-IL', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(isoString));
  } catch {
    return '';
  }
}

/**
 * Session Reports Phase 3 — the report drawer (fill + submit).
 *
 * Anchored entry contract: the modal opens with a lesson-participant
 * context, never a bare student/date. See
 * src/features/sessions/context/SessionModalContext.jsx for the shared
 * `openSessionReportModal({ lessonParticipantId, studentName, serviceName,
 * lessonDateTime })` contract that Phase 5's pending-reports page will use
 * to open this same modal.
 *
 * On open, resolves the form to fill via
 * GET /api/session-reports?lesson_participant_id=X&mode=context (added in
 * Task 5), which carries the same permission/role guards as POST. Renders
 * the resolved schema with SectionedFormRenderer and submits via
 * POST /api/session-reports. There is no loose/unassigned-student flow
 * anymore (Decision #4 in the implementation plan) — every 409 the API can
 * return is mapped to a Hebrew message in src/lib/api-client.js.
 */
export default function NewSessionModal({
  open,
  onClose,
  lessonParticipantId = '',
  studentName = '',
  serviceName = '',
  lessonDateTime = '',
  onCreated,
}) {
  const { session } = useSupabase();
  const { activeOrgId } = useOrg();

  const [contextState, setContextState] = useState(REQUEST_STATE.idle);
  const [contextError, setContextError] = useState('');
  const [reportContext, setReportContext] = useState(null);
  const [answers, setAnswers] = useState({});
  const [submitState, setSubmitState] = useState(REQUEST_STATE.idle);
  const [submitError, setSubmitError] = useState('');
  const [validationErrors, setValidationErrors] = useState({});
  const [successReport, setSuccessReport] = useState(null);
  // Phase 4 — personal preanswers bank kept in local state so inline
  // save/delete (from the picker) reflects immediately without a re-fetch.
  const [personalPreanswers, setPersonalPreanswers] = useState({});

  const canFetchContext = Boolean(open && session && activeOrgId && lessonParticipantId);

  const loadContext = useCallback(async () => {
    if (!canFetchContext) return;
    setContextState(REQUEST_STATE.loading);
    setContextError('');
    try {
      const payload = await authenticatedFetch('session-reports', {
        session,
        params: {
          org_id: activeOrgId,
          lesson_participant_id: lessonParticipantId,
          mode: 'context',
        },
      });
      setReportContext(payload);
      setAnswers(payload?.form?.form_schema ? buildInitialAnswers(payload.form.form_schema) : {});
      setPersonalPreanswers(payload?.preanswers?.personal || {});
      setContextState(REQUEST_STATE.idle);
    } catch (error) {
      console.error('Failed to load session report context', error);
      setReportContext(null);
      setContextState(REQUEST_STATE.error);
      setContextError(resolveApiErrorMessage(error) || 'טעינת נתוני הדיווח נכשלה.');
    }
  }, [canFetchContext, session, activeOrgId, lessonParticipantId]);

  useEffect(() => {
    if (open) {
      void loadContext();
    } else {
      setContextState(REQUEST_STATE.idle);
      setContextError('');
      setReportContext(null);
      setAnswers({});
      setSubmitState(REQUEST_STATE.idle);
      setSubmitError('');
      setValidationErrors({});
      setSuccessReport(null);
      setPersonalPreanswers({});
    }
  }, [open, loadContext]);

  // Phase 4 — inline personal-bank save/delete from the picker. Writes the
  // caller's own Employees.metadata.report_preanswers via the narrow
  // POST /session-reports/preanswers endpoint, then mirrors the result into
  // local state so the picker reflects it immediately.
  const handleSavePersonalPreanswer = useCallback(async (fieldKey, nextEntries) => {
    const updated = await authenticatedFetch('session-reports/preanswers', {
      session,
      method: 'POST',
      body: {
        org_id: activeOrgId,
        field_key: fieldKey,
        answers: nextEntries,
      },
    });
    setPersonalPreanswers(updated?.report_preanswers || {});
  }, [session, activeOrgId]);

  const handleCopyFromLastReport = useCallback(() => {
    if (reportContext?.last_report_answers) {
      setAnswers(reportContext.last_report_answers);
    }
  }, [reportContext]);

  const handleSubmit = useCallback(async ({ answers: submittedAnswers, validationErrors: errors }) => {
    if (errors && Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }
    setValidationErrors({});
    setSubmitState(REQUEST_STATE.loading);
    setSubmitError('');
    try {
      const created = await authenticatedFetch('session-reports', {
        session,
        method: 'POST',
        body: {
          org_id: activeOrgId,
          lesson_participant_id: lessonParticipantId,
          answers: submittedAnswers,
        },
      });
      toast.success('הדיווח נשמר בהצלחה.', { duration: 2500, position: 'top-center' });
      setSuccessReport(created);
      setSubmitState(REQUEST_STATE.idle);
      await Promise.resolve(onCreated?.(created));
      window.dispatchEvent(new CustomEvent('session-report-created', { detail: { report: created } }));
    } catch (error) {
      console.error('Failed to save session report', error);
      setSubmitState(REQUEST_STATE.error);
      setSubmitError(resolveApiErrorMessage(error) || 'שמירת הדיווח נכשלה.');
    }
  }, [session, activeOrgId, lessonParticipantId, onCreated]);

  const resolvedStudentName = reportContext?.participant?.student_name || studentName;
  const resolvedServiceName = reportContext?.service?.name || serviceName;
  const resolvedLessonDateTime = reportContext?.lesson?.datetime_start || lessonDateTime;

  const dialogTitle = resolvedStudentName ? `דיווח מפגש — ${resolvedStudentName}` : 'דיווח מפגש';
  const dialogDescription = useMemo(() => {
    const parts = [];
    if (resolvedServiceName) parts.push(resolvedServiceName);
    const formattedDate = formatLessonDateTime(resolvedLessonDateTime);
    if (formattedDate) parts.push(formattedDate);
    return parts.join(' · ');
  }, [resolvedServiceName, resolvedLessonDateTime]);

  const isLoadingContext = contextState === REQUEST_STATE.loading;
  const hasContextError = contextState === REQUEST_STATE.error;
  const canRenderForm = !isLoadingContext && !hasContextError && Boolean(reportContext?.form) && !successReport;

  const footer = canRenderForm ? (
    <NewSessionFormFooter
      onSubmit={() => document.getElementById('new-session-report-form')?.requestSubmit()}
      onCancel={onClose}
      isSubmitting={submitState === REQUEST_STATE.loading}
    />
  ) : successReport ? (
    <div className="flex justify-end">
      <Button onClick={onClose}>סגור</Button>
    </div>
  ) : null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose?.(); }}>
      <DialogContent className="sm:max-w-xl" footer={footer}>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          {dialogDescription ? <DialogDescription>{dialogDescription}</DialogDescription> : null}
        </DialogHeader>

        {!lessonParticipantId ? (
          <div className="space-y-sm text-sm text-neutral-600">
            <p>לא נמצא מפגש לתיעוד.</p>
          </div>
        ) : isLoadingContext ? (
          <div className="flex items-center justify-center gap-sm py-lg text-neutral-600" role="status">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            <span>טוען נתוני מפגש...</span>
          </div>
        ) : hasContextError ? (
          <div className="rounded-lg bg-red-50 p-md text-sm text-red-700" role="alert">
            {contextError}
          </div>
        ) : successReport ? (
          <div className="flex flex-col items-center gap-sm py-lg text-center">
            <CheckCircle2 className="h-10 w-10 text-success-600" aria-hidden="true" />
            <p className="text-base font-semibold text-success-700">הדיווח נשמר בהצלחה</p>
          </div>
        ) : !reportContext?.service?.report_form_id ? (
          <div className="rounded-lg bg-amber-50 p-md text-sm text-amber-800" role="alert">
            לשירות זה לא הוגדר טופס דיווח. יש להגדיר טופס דיווח בהגדרות השירות לפני תיעוד מפגשים.
          </div>
        ) : !reportContext?.form ? (
          <div className="rounded-lg bg-amber-50 p-md text-sm text-amber-800" role="alert">
            טופס הדיווח של השירות עדיין לא פורסם.
          </div>
        ) : reportContext?.existing_report_id ? (
          <div className="rounded-lg bg-amber-50 p-md text-sm text-amber-800" role="alert">
            כבר קיים דיווח עבור מפגש זה.
          </div>
        ) : (
          <NewSessionForm
            formSchema={reportContext.form.form_schema}
            answers={answers}
            onAnswersChange={setAnswers}
            onSubmit={handleSubmit}
            onCancel={onClose}
            isSubmitting={submitState === REQUEST_STATE.loading}
            error={submitError}
            renderFooterOutside
            servicePreanswers={reportContext.preanswers?.service || null}
            personalPreanswers={personalPreanswers}
            preanswersCap={reportContext.preanswers?.cap}
            canEditPersonalPreanswers={Boolean(reportContext.preanswers)}
            onSavePersonalPreanswer={handleSavePersonalPreanswer}
            hasLastReportAnswers={Boolean(reportContext.last_report_answers)}
            onCopyFromLastReport={handleCopyFromLastReport}
          />
        )}

        {Object.keys(validationErrors).length > 0 ? (
          <p className="text-xs text-red-600 text-end">יש להשלים את כל השדות הנדרשים.</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
