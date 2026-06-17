import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { AlertCircle, AlertTriangle, Link2, PlusCircle, XCircle, Zap } from 'lucide-react';
import { patchCandidate, runDryRunChunk } from '../api/importWorkspacesApi.js';

const FIELD_LABELS = {
  first_name:               'שם פרטי',
  last_name:                'שם משפחה',
  identity_number:          'תעודת זהות',
  phone:                    'טלפון',
  guardian_phone:           'טלפון הורה',
  email:                    'אימייל',
  date_of_birth:            'תאריך לידה',
  student_identity_number:  'ת.ז. תלמיד/ה',
  guardian_identity_number: 'ת.ז. הורה',
  note_text:                'טקסט הערה',
  name:                     'שם',
  description:              'תיאור',
};

const ISSUE_MESSAGES = {
  missing_required_field: 'שדה חובה חסר.',
  missing_recommended_field: 'שדה מומלץ חסר.',
  invalid_field_format: 'פורמט השדה לא תקין.',
  duplicate_identity_number: 'קיימת כבר רשומה עם אותה תעודת זהות. יש לבחור איך לטפל בכפילות.',
  duplicate_email: 'קיימת כבר רשומה עם אותו אימייל. מומלץ לבדוק אם זו אותה רשומה.',
};

const ENTITY_LABELS = {
  active_student:   'תלמיד/ה פעיל/ה',
  inactive_student: 'תלמיד/ה לא פעיל/ה',
  guardian:         'הורה',
  guardian_link:    'קישור הורה-תלמיד',
  service:          'שירות',
  student_note:     'הערה',
};

const DRY_RUN_OUTCOME_LABELS = {
  create:         'יצירה חדשה',
  update:         'עדכון קיים',
  reuse_existing: 'שימוש חוזר',
  link:           'קישור',
  skip:           'דילוג',
  noop:           'ללא שינוי',
  blocked:        'חסום',
  error:          'שגיאה',
};

const DRY_RUN_OUTCOME_CLASSES = {
  create:         'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  update:         'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  reuse_existing: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  link:           'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  skip:           'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400',
  noop:           'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400',
  blocked:        'bg-destructive/10 text-destructive',
  error:          'bg-destructive/10 text-destructive',
};

const DECISION_LABELS = {
  link_to_existing: 'קישור לרשומה קיימת',
  create_as_new: 'יצירת רשומה חדשה',
  skip: 'דילוג על השורה',
};

function describeDecision(decisions) {
  if (!decisions?.action) return '';
  if (decisions.action === 'link_to_existing') {
    return decisions.linked_id
      ? 'הרשומה הזו תתחבר לאדם שכבר קיים במערכת.'
      : 'נבחר קישור לרשומה קיימת, אבל עדיין לא נבחרה רשומה קיימת. אם האדם עדיין לא קיים במערכת, צריך לבחור יצירת רשומה חדשה.';
  }
  if (decisions.action === 'create_as_new') {
    return 'הרשומה הזו תיצור אדם חדש במערכת, גם אם נמצא דמיון לפרטים קיימים.';
  }
  if (decisions.action === 'skip') {
    return 'השורה הזו לא תיובא למערכת.';
  }
  return '';
}

function DryRunOutcomeBadge({ outcome }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
      DRY_RUN_OUTCOME_CLASSES[outcome] ?? 'bg-gray-100 text-gray-600',
    )}>
      {DRY_RUN_OUTCOME_LABELS[outcome] ?? outcome}
    </span>
  );
}

function formatMatchedRecordSummary(summary) {
  if (!summary) return '';
  if (typeof summary !== 'object') return String(summary);
  return summary.name ??
    Object.values(summary)
      .filter(Boolean)
      .join(' · ');
}

function IssueItem({ issue }) {
  const isBlocker = issue.severity === 'blocker';
  const fieldPrefix = FIELD_LABELS[issue.field] ? `${FIELD_LABELS[issue.field]}: ` : '';
  const message = issue.message || ISSUE_MESSAGES[issue.code] || issue.code || 'נדרשת בדיקה.';
  return (
    <li className={cn(
      'flex items-start gap-2 text-sm rounded px-2.5 py-1.5',
      isBlocker ? 'bg-destructive/10 text-destructive' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    )}>
      {isBlocker
        ? <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      }
      <span>
        {fieldPrefix}
        {message}
      </span>
    </li>
  );
}

/**
 * @param {{
 *   candidate: object | null,
 *   workspaceId?: string,
 *   open: boolean,
 *   onClose: () => void,
 *   onDecisionSaved?: (updated: object) => void,
 * }} props
 */
export function CandidateDetailSheet({ candidate, workspaceId, open, onClose, onDecisionSaved }) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [dryRunSummary, setDryRunSummary] = useState(null);
  const [runningDryRun, setRunningDryRun] = useState(false);
  const [dryRunError, setDryRunError] = useState(null);

  // Sync dry-run summary with the candidate prop (resets when a different candidate is opened).
  useEffect(() => {
    setDryRunSummary(candidate?.candidate_data?.dry_run_summary ?? null);
    setDryRunError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.id]);

  if (!candidate) return null;

  const { candidate_data = {}, issues = [], entity_type, status, decisions = {} } = candidate;
  const blockers = issues.filter(i => i.severity === 'blocker');
  const warnings = issues.filter(i => i.severity === 'warning');

  async function applyDecision(decisionsPatch, newStatus) {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await patchCandidate(candidate.id, {
        decisions_patch: decisionsPatch,
        status: newStatus,
      });
      onDecisionSaved?.(result.candidate);
      onClose();
    } catch (err) {
      setSaveError(err.message || 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  }

  function handleLinkToExisting() {
    // For a full implementation this would open an entity-search dialog.
    // For now we record intent and require the user to supply existing_client_profile_id separately.
    applyDecision({ action: 'link_to_existing' }, 'needs_review');
  }

  function handleCreateAsNew() {
    applyDecision({ action: 'create_as_new' }, 'ready');
  }

  function handleSkip() {
    applyDecision({ action: 'skip' }, 'skipped');
  }

  async function handleRunDryRun() {
    if (!workspaceId) return;
    setRunningDryRun(true);
    setDryRunError(null);
    try {
      const data = await runDryRunChunk(workspaceId, [candidate.id]);
      const firstResult = data.results?.[0];
      if (firstResult) {
        setDryRunSummary({
          outcome:                firstResult.outcome,
          action_description:     firstResult.action_description,
          matched_record_id:      firstResult.matched_record_id,
          matched_record_summary: firstResult.matched_record_summary,
          fields_that_would_change: firstResult.fields_that_would_change,
          simulated_at:           new Date().toISOString(),
        });
      }
    } catch (err) {
      setDryRunError(err.message || 'שגיאה בהרצת הבדיקה');
    } finally {
      setRunningDryRun(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="left" className="w-full sm:max-w-lg overflow-y-auto" dir="rtl">
        <SheetHeader>
          <SheetTitle>
            {[candidate_data.first_name, candidate_data.last_name].filter(Boolean).join(' ')
              || candidate_data.name
              || 'רשומה'}
          </SheetTitle>
          <SheetDescription>
            {ENTITY_LABELS[entity_type] ?? entity_type}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {/* Candidate data fields */}
          <section>
            <h3 className="text-sm font-semibold mb-2">נתוני רשומה</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {Object.entries(candidate_data).filter(([k]) => k !== 'dry_run_summary').map(([k, v]) => {
                if (!v) return null;
                return (
                  <div key={k}>
                    <dt className="text-xs text-muted-foreground">{FIELD_LABELS[k] || k}</dt>
                    <dd className="font-medium">{String(v)}</dd>
                  </div>
                );
              })}
            </dl>
          </section>

          {/* Dry-run simulation result */}
          {dryRunSummary && (
            <>
              <Separator />
              <section>
                <h3 className="text-sm font-semibold mb-2">תוצאת בדיקה ללא ייבוא</h3>
                <div className="rounded-lg border bg-muted/40 px-3 py-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">תוצאה</span>
                    <DryRunOutcomeBadge outcome={dryRunSummary.outcome} />
                  </div>
                  {dryRunSummary.action_description && (
                    <p>{dryRunSummary.action_description}</p>
                  )}
                  {dryRunSummary.matched_record_summary && (
                    <p className="text-xs text-muted-foreground">
                      רשומה תואמת: {formatMatchedRecordSummary(dryRunSummary.matched_record_summary)}
                    </p>
                  )}
                  {dryRunSummary.fields_that_would_change?.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      שדות לעדכון:{' '}
                      {dryRunSummary.fields_that_would_change
                        .map(f => FIELD_LABELS[f] || f)
                        .join(', ')}
                    </p>
                  )}
                </div>
              </section>
            </>
          )}

          {/* Issues */}
          {(blockers.length > 0 || warnings.length > 0) && (
            <>
              <Separator />
              <section>
                <h3 className="text-sm font-semibold mb-2">בעיות שזוהו</h3>
                <ul className="space-y-1.5">
                  {blockers.map((iss, i) => <IssueItem key={i} issue={iss} />)}
                  {warnings.map((iss, i) => <IssueItem key={i} issue={iss} />)}
                </ul>
              </section>
            </>
          )}

          {/* Current decision */}
          {decisions.action && (
            <>
              <Separator />
              <section>
                <h3 className="text-sm font-semibold mb-1">החלטה קיימת</h3>
                <Badge variant="outline">{DECISION_LABELS[decisions.action] || decisions.action}</Badge>
                {describeDecision(decisions) && (
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {describeDecision(decisions)}
                  </p>
                )}
              </section>
            </>
          )}

          {/* Save error */}
          {saveError && (
            <p className="text-xs text-destructive">{saveError}</p>
          )}

          <Separator />

          {/* Decision buttons */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">פעולה</h3>

            {/* Preflight check button */}
            {status !== 'committed' && workspaceId && (
              <>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={handleRunDryRun}
                  disabled={runningDryRun || saving}
                >
                  <Zap className="h-4 w-4" />
                  {runningDryRun ? 'בודק ללא ייבוא…' : dryRunSummary ? 'בדוק שוב ללא ייבוא' : 'בדוק ללא ייבוא'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  הבדיקה מראה מה יקרה בייבוא הסופי, בלי ליצור או לעדכן נתונים בפועל.
                </p>
                {dryRunError && (
                  <p className="text-xs text-destructive">{dryRunError}</p>
                )}
              </>
            )}

            {status !== 'committed' && status !== 'skipped' && (
              <>
                <p className="text-xs text-muted-foreground">
                  אם זו אותה רשומה שכבר קיימת במערכת, קשר אותה לרשומה הקיימת. אם זה אדם אחר עם פרט דומה, צור רשומה חדשה. אם לא רוצים לייבא את השורה, דלג עליה.
                </p>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={handleLinkToExisting}
                  disabled={saving}
                >
                  <Link2 className="h-4 w-4" />
                  קשר לאדם שכבר קיים במערכת
                </Button>
                <p className="text-[11px] leading-5 text-muted-foreground">
                  מתאים רק אם האדם כבר קיים במערכת ואפשר לבחור את הרשומה שלו. בלי בחירת רשומה קיימת, הייבוא יישאר חסום.
                </p>

                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={handleCreateAsNew}
                  disabled={saving}
                >
                  <PlusCircle className="h-4 w-4" />
                  צור אדם חדש למרות הדמיון
                </Button>
                <p className="text-[11px] leading-5 text-muted-foreground">
                  מתאים אם זו לא אותה רשומה קיימת, או אם האדם עדיין לא קיים במערכת.
                </p>

                <Button
                  variant="ghost"
                  className="w-full justify-start gap-2 text-muted-foreground"
                  onClick={handleSkip}
                  disabled={saving}
                >
                  <XCircle className="h-4 w-4" />
                  דלג על שורה זו
                </Button>
              </>
            )}

            {status === 'committed' && (
              <p className="text-sm text-muted-foreground">רשומה זו כבר בוצעה.</p>
            )}
            {status === 'skipped' && (
              <p className="text-sm text-muted-foreground">שורה זו מדולגת.</p>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
