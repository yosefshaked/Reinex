import React, { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import SectionedFormRenderer from '@/features/forms/components/SectionedFormRenderer.jsx';
import { normalizeFormSchema } from '@/features/forms/lib/form-schema.js';

/**
 * Session Reports Phase 3 — read-only view of a saved report.
 *
 * A saved report must render forever against the schema it was filled with,
 * not the form's current (possibly since-edited) schema. api/session-reports
 * POST snapshots the resolved schema into metadata.form_schema_snapshot at
 * create time (Task 1); this component renders from that snapshot.
 *
 * Legacy reports (is_legacy=true, imported from TutTiud/Amir) may have no
 * snapshot and no form_id at all — the plan's Phase 6 spec says
 * "form_id null / legacy-render". In that case we fall back to whatever
 * schema is available, or a minimal raw-answers dump if none is.
 *
 * Exported standalone (not just used inside the fill drawer) so the student
 * profile history page (Phase 5) can render a saved report without pulling
 * in the whole fill flow.
 *
 * @param {Object} props
 * @param {Object} props.report - a form_submissions row as returned by
 *   GET /api/session-reports (id, answers, metadata, form_version, is_legacy, ...).
 * @param {Object} [props.currentFormSchema] - fallback schema (e.g. the
 *   service's current report form) used only when the report has no
 *   captured snapshot (legacy reports without one).
 * @param {boolean} [props.loading]
 */
export default function ReportView({ report, currentFormSchema = null, loading = false, className }) {
  const schema = useMemo(() => {
    const snapshot = report?.metadata && typeof report.metadata === 'object' && !Array.isArray(report.metadata)
      ? report.metadata.form_schema_snapshot
      : null;
    if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
      return normalizeFormSchema(snapshot);
    }
    if (currentFormSchema) {
      return normalizeFormSchema(currentFormSchema);
    }
    return null;
  }, [report, currentFormSchema]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-500" role="status">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        <span>טוען דיווח...</span>
      </div>
    );
  }

  if (!report) {
    return <p className="text-sm text-neutral-500 text-end">לא נמצא דיווח להצגה.</p>;
  }

  const answers = report.answers && typeof report.answers === 'object' && !Array.isArray(report.answers) ? report.answers : {};

  if (!schema) {
    // No schema available at all (legacy report with no snapshot and no
    // fallback provided) — show the raw answers so nothing is silently lost.
    const entries = Object.entries(answers);
    return (
      <div className={className}>
        <p className="mb-3 text-xs text-amber-700 text-end">
          לא נמצא שאלון מקורי לדיווח זה. מוצגות התשובות הגולמיות שנשמרו.
        </p>
        {entries.length === 0 ? (
          <p className="text-sm text-neutral-500 text-end">אין תשובות שמורות.</p>
        ) : (
          <dl className="space-y-3">
            {entries.map(([key, value]) => (
              <div key={key} className="rounded-xl border border-slate-200 bg-white p-3 text-end">
                <dt className="text-xs font-medium text-slate-500">{key}</dt>
                <dd className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      {report.is_legacy ? (
        <p className="mb-3 text-xs text-amber-700 text-end">דיווח זה יובא ממערכת קודמת (דיווח ישן).</p>
      ) : null}
      <SectionedFormRenderer schema={schema} answers={answers} readOnly />
    </div>
  );
}
