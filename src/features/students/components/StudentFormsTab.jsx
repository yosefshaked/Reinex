import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Send, RefreshCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import SendFormDialog from '@/features/students/components/SendFormDialog.jsx';

function formatDateTime(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('he-IL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(value);
  }
}

function getWorkflowStatus(submission) {
  const status = String(submission?.metadata?.workflow_status || '').toLowerCase();
  if (status === 'submitted') return { label: 'נשלח', variant: 'secondary' };
  return { label: 'ממתין למילוי', variant: 'default' };
}

function getOtpStatus(submission) {
  const otpStatus = String(submission?.otp_metadata?.otp_status || '').toLowerCase();
  if (otpStatus === 'verified') return { label: 'אומת', variant: 'secondary' };
  if (otpStatus === 'expired') return { label: 'פג תוקף', variant: 'destructive' };
  return { label: 'ממתין', variant: 'outline' };
}

function countAlerts(submission) {
  const flags = submission?.alert_flags;
  if (Array.isArray(flags)) return flags.length;
  if (flags && typeof flags === 'object') return Object.keys(flags).length;
  return 0;
}

function buildAnswerEntries(submission) {
  const answers = submission?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return [];
  return Object.entries(answers).slice(0, 30);
}

export default function StudentFormsTab({ studentId, student, canEdit = false }) {
  const { session } = useSupabase();
  const { activeOrg } = useOrg();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submissions, setSubmissions] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [sendOpen, setSendOpen] = useState(false);

  const activeOrgId = activeOrg?.id || null;

  const canFetch = Boolean(studentId && activeOrgId && session);

  const loadSubmissions = useCallback(async () => {
    if (!canFetch) return;

    setLoading(true);
    setError('');

    try {
      const data = await authenticatedFetch('form-submissions', {
        session,
        params: {
          org_id: activeOrgId,
          student_id: studentId,
          limit: 100,
        },
      });

      setSubmissions(Array.isArray(data) ? data : []);
    } catch (loadError) {
      console.error('Failed to load student form submissions', loadError);
      setError(loadError?.message || 'טעינת הטפסים נכשלה');
      setSubmissions([]);
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, canFetch, session, studentId]);

  useEffect(() => {
    if (canFetch) {
      void loadSubmissions();
    }
  }, [canFetch, loadSubmissions]);

  const submissionsWithMeta = useMemo(() => submissions.map((submission) => ({
    ...submission,
    workflow: getWorkflowStatus(submission),
    otp: getOtpStatus(submission),
    alertsCount: countAlerts(submission),
    answersEntries: buildAnswerEntries(submission),
  })), [submissions]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="h-1.5 bg-blue-500" />
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center text-lg">📋</div>
            <h3 className="font-semibold text-zinc-800">טפסים</h3>
            <span className="me-auto text-sm text-muted-foreground">
              {loading ? 'טוען...' : `${submissionsWithMeta.length} שליחות`}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadSubmissions()} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              רענן
            </Button>
            {canEdit && (
              <Button type="button" size="sm" className="gap-2" onClick={() => setSendOpen(true)}>
                <Send className="h-4 w-4" />
                שלח טופס
              </Button>
            )}
          </div>

          {error && (
            <Alert>
              <AlertDescription className="text-red-700">{error}</AlertDescription>
            </Alert>
          )}

          {loading && (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {!loading && !error && submissionsWithMeta.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              עדיין לא נשלחו טפסים לתלמיד זה.
            </div>
          )}

          {!loading && !error && submissionsWithMeta.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>טופס</TableHead>
                    <TableHead>נשלח בתאריך</TableHead>
                    <TableHead>סטטוס</TableHead>
                    <TableHead>OTP</TableHead>
                    <TableHead>דגלים</TableHead>
                    <TableHead className="text-end">פרטים</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissionsWithMeta.map((submission) => {
                    const isExpanded = expandedId === submission.id;
                    return (
                      <React.Fragment key={submission.id}>
                        <TableRow>
                          <TableCell className="font-medium">{submission.form_name || 'טופס ללא שם'}</TableCell>
                          <TableCell>{formatDateTime(submission.submitted_at)}</TableCell>
                          <TableCell>
                            <Badge variant={submission.workflow.variant}>{submission.workflow.label}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={submission.otp.variant}>{submission.otp.label}</Badge>
                          </TableCell>
                          <TableCell>
                            {submission.alertsCount > 0 ? (
                              <Badge variant="destructive">{submission.alertsCount}</Badge>
                            ) : (
                              <Badge variant="outline">0</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="gap-1"
                              onClick={() => setExpandedId((prev) => (prev === submission.id ? null : submission.id))}
                            >
                              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              {isExpanded ? 'הסתר' : 'הצג'}
                            </Button>
                          </TableCell>
                        </TableRow>

                        {isExpanded && (
                          <TableRow>
                            <TableCell colSpan={6}>
                              <div className="rounded-md border bg-neutral-50 p-3 space-y-2">
                                <p className="text-xs text-muted-foreground">
                                  תשובות ({submission.answersEntries.length})
                                </p>
                                {submission.answersEntries.length === 0 ? (
                                  <p className="text-sm text-muted-foreground">עדיין לא מולאו תשובות.</p>
                                ) : (
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                                    {submission.answersEntries.map(([key, value]) => (
                                      <div key={`${submission.id}-${key}`} className="rounded-md border bg-white p-2">
                                        <p className="text-xs font-semibold text-zinc-600 mb-1">{key}</p>
                                        <p className="text-zinc-800 break-words whitespace-pre-wrap">{typeof value === 'string' ? value : JSON.stringify(value)}</p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      <SendFormDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        student={student}
        onSent={() => {
          void loadSubmissions();
        }}
      />
    </div>
  );
}
