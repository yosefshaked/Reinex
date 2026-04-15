import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Send, RefreshCcw, ChevronDown, ChevronUp, Mail, MessageCircle } from 'lucide-react';
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
import ResendOtpDialog from '@/features/students/components/ResendOtpDialog.jsx';
import { toast } from 'sonner';
import { findQuestionLabel, normalizeFormSchema } from '@/features/forms/lib/form-schema.js';

function normalizeWaPhone(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return `972${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith('5')) return `972${digits}`;
  return digits;
}

function buildSubmissionLink({ accessIdentifier = '', otp = '' } = {}) {
  const origin = window?.location?.origin || '';
  const params = new URLSearchParams();
  const normalizedIdentifier = String(accessIdentifier || '').trim();
  const normalizedOtp = String(otp || '').trim();

  if (normalizedIdentifier) params.set('identity_number', normalizedIdentifier);
  if (normalizedOtp) params.set('otp', normalizedOtp);

  const query = params.toString();
  return `${origin}/#/submit${query ? `?${query}` : ''}`;
}

function buildWhatsAppLink(phone, otp, submitLink, accessIdentifier, formName, expiresAt) {
  const normalizedPhone = normalizeWaPhone(phone);
  const expiryText = formatDateTime(expiresAt);
  const message = [
    'שלום,',
    '',
    `שם הטופס למילוי: ${formName || 'טופס'}`,
    '',
    'מצורף קישור למילוי טופס:',
    submitLink,
    '',
    `מזהה גישה: ${accessIdentifier}`,
    `קוד אימות: ${otp}`,
    `תוקף הקישור עד: ${expiryText}`,
    '',
    'אפשר לפתוח את הקישור ולשלוח את הטופס.',
  ].join('\n');
  return {
    normalizedPhone,
    url: `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`,
  };
}

function formatDateTime(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('he-IL', {
      timeZone: 'Asia/Jerusalem',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
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

  if (otpStatus === 'expired') {
    return {
      label: 'פג תוקף',
      className: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-50',
    };
  }

  if (otpStatus === 'verified') {
    return {
      label: 'אומת',
      className: 'border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
    };
  }

  return {
    label: 'ממתין',
    className: 'border-border bg-background text-foreground hover:bg-background',
  };
}

function countAlerts(submission) {
  const hits = Array.isArray(submission?.alert_flags?.hits) ? submission.alert_flags.hits : [];
  if (hits.length) return hits.length;
  return submission?.alert_flags?.has_red_flags ? 1 : 0;
}

function buildAnswerEntries(submission) {
  const rawAnswers = submission?.answers;
  if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) return [];
  const customAnswers = rawAnswers?.custom_answers && typeof rawAnswers.custom_answers === 'object' && !Array.isArray(rawAnswers.custom_answers)
    ? rawAnswers.custom_answers
    : rawAnswers;
  return Object.entries(customAnswers).slice(0, 30);
}

function getSubmissionSchemaSnapshot(submission) {
  const snapshot = submission?.metadata?.schema_snapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return null;
  }
  return snapshot;
}

function resolveAnswerLabel(submission, fieldKey) {
  const schema = getSubmissionSchemaSnapshot(submission);
  if (!schema) return fieldKey;
  return findQuestionLabel(normalizeFormSchema(schema), fieldKey);
}

function SignaturePreview({ value }) {
  const canvasRef = React.useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const strokes = Array.isArray(value?.preview_strokes) ? value.preview_strokes : [];
    if (!canvas || !strokes.length) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const points = [];
    strokes.forEach((stroke) => {
      if (!Array.isArray(stroke)) return;
      stroke.forEach((point) => {
        const x = Number(point?.x);
        const y = Number(point?.y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          points.push({ x, y });
        }
      });
    });

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    if (!points.length) return;

    let minX = points[0].x;
    let maxX = points[0].x;
    let minY = points[0].y;
    let maxY = points[0].y;
    points.forEach((point) => {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    });

    const sourceWidth = Math.max(1, maxX - minX);
    const sourceHeight = Math.max(1, maxY - minY);
    const padding = 12;
    const availableWidth = Math.max(1, canvas.width - (padding * 2));
    const availableHeight = Math.max(1, canvas.height - (padding * 2));
    const scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const offsetX = (canvas.width - drawWidth) / 2;
    const offsetY = (canvas.height - drawHeight) / 2;

    const mapPoint = (point) => ({
      x: ((Number(point?.x || minX) - minX) * scale) + offsetX,
      y: ((Number(point?.y || minY) - minY) * scale) + offsetY,
    });

    context.strokeStyle = '#0f172a';
    context.fillStyle = '#0f172a';
    context.lineWidth = Math.max(1.6, Math.min(3, scale * 2));
    context.lineCap = 'round';
    context.lineJoin = 'round';

    strokes.forEach((stroke) => {
      if (!Array.isArray(stroke) || stroke.length === 0) return;

      const firstPoint = mapPoint(stroke[0]);
      if (stroke.length === 1) {
        context.beginPath();
        context.arc(firstPoint.x, firstPoint.y, context.lineWidth / 2, 0, Math.PI * 2);
        context.fill();
        return;
      }

      context.beginPath();
      context.moveTo(firstPoint.x, firstPoint.y);
      stroke.slice(1).forEach((point) => {
        const mapped = mapPoint(point);
        context.lineTo(mapped.x, mapped.y);
      });
      context.stroke();
    });
  }, [value]);

  if (!Array.isArray(value?.preview_strokes) || value.preview_strokes.length === 0) {
    return <p className="text-zinc-800 break-words whitespace-pre-wrap">{JSON.stringify(value)}</p>;
  }

  return <canvas ref={canvasRef} width={480} height={160} className="h-32 w-full rounded-lg border border-slate-200 bg-white" />;
}

function renderAnswerValue(value) {
  if (value && typeof value === 'object' && value._type === 'signature') {
    return <SignaturePreview value={value} />;
  }
  if (Array.isArray(value)) {
    return <p className="text-zinc-800 break-words whitespace-pre-wrap">{value.join(', ')}</p>;
  }
  return <p className="text-zinc-800 break-words whitespace-pre-wrap">{typeof value === 'string' ? value : JSON.stringify(value)}</p>;
}

export default function StudentFormsTab({ studentId, student, canEdit = false }) {
  const { session } = useSupabase();
  const { activeOrg } = useOrg();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submissions, setSubmissions] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [resendState, setResendState] = useState({ submissionId: '', deliveryMethod: '' });
  const [resendDialog, setResendDialog] = useState({ open: false, submission: null, deliveryMethod: '' });

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

  const handleResend = useCallback(async (submission, deliveryMethod, expiresInMinutes = 10080) => {
    if (!activeOrgId || !session || !submission?.id) return;

    setResendState({ submissionId: submission.id, deliveryMethod });

    try {
      const response = await authenticatedFetch('form-submissions/resend', {
        method: 'POST',
        session,
        body: {
          org_id: activeOrgId,
          submission_id: submission.id,
          delivery_method: deliveryMethod,
          expires_in_minutes: expiresInMinutes,
        },
      });

      if (deliveryMethod === 'email') {
        toast.success('OTP נשלח מחדש במייל');
      } else {
        const otp = String(response?.otp || '');
        const phone = String(response?.phone || '');
        const expiresAt = String(response?.expires_at || '');
        const accessIdentifier = String(response?.access_identifier || student?.identity_number || student?.national_id || '');
        if (!otp || !phone) {
          throw new Error('response_missing_whatsapp_payload');
        }

        const submitLink = buildSubmissionLink({ accessIdentifier, otp });
        const wa = buildWhatsAppLink(phone, otp, submitLink, accessIdentifier, submission?.form_name || 'טופס', expiresAt);
        window.open(wa.url, '_blank', 'noopener,noreferrer');
        toast.success('OTP נוצר מחדש ונפתחה הודעת וואטסאפ');
      }

      await loadSubmissions();
    } catch (resendError) {
      const isExpectedBusinessError = resendError?.message === 'submission_already_completed';
      if (!isExpectedBusinessError) {
        console.error('Failed to resend form submission OTP', resendError);
      }
      const message = resendError?.message === 'submission_already_completed'
        ? 'לא ניתן לשלוח שוב OTP לטופס שכבר הושלם'
        : resendError?.message || 'שליחה חוזרת נכשלה';
      toast.error(message);
    } finally {
      setResendState({ submissionId: '', deliveryMethod: '' });
    }
  }, [activeOrgId, loadSubmissions, session, student?.identity_number, student?.national_id]);

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
                    <TableHead>תוקף עד</TableHead>
                    <TableHead>סטטוס</TableHead>
                    <TableHead>OTP</TableHead>
                    <TableHead>דגלים</TableHead>
                    <TableHead className="text-end">פרטים</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissionsWithMeta.map((submission) => {
                    const isExpanded = expandedId === submission.id;
                    const isSubmitted = String(submission?.metadata?.workflow_status || '').toLowerCase() === 'submitted';
                    const isResending = resendState.submissionId === submission.id;
                    return (
                      <React.Fragment key={submission.id}>
                        <TableRow>
                          <TableCell className="font-medium">{submission.form_name || 'טופס ללא שם'}</TableCell>
                          <TableCell>{formatDateTime(submission.submitted_at || submission?.metadata?.initiated_at)}</TableCell>
                          <TableCell>{formatDateTime(submission?.otp_metadata?.expires_at || submission?.metadata?.otp_expires_at)}</TableCell>
                          <TableCell>
                            <Badge variant={submission.workflow.variant}>{submission.workflow.label}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={submission.otp.className} variant="outline">{submission.otp.label}</Badge>
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
                            <TableCell colSpan={7}>
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
                                        <p className="text-xs font-semibold text-zinc-600 mb-1">{resolveAnswerLabel(submission, key)}</p>
                                        {renderAnswerValue(value)}
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {submission.alertsCount > 0 && Array.isArray(submission?.alert_flags?.hits) ? (
                                  <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
                                    <p className="text-xs font-semibold text-amber-800">דגלים אדומים שזוהו בטופס</p>
                                    <div className="space-y-2">
                                      {submission.alert_flags.hits.map((hit, index) => (
                                        <div key={`${submission.id}_hit_${index}`} className="rounded-md border border-amber-200 bg-white p-2 text-sm">
                                          <div className="flex items-center gap-2">
                                            <Badge variant="outline">{String(hit?.severity || 'medium')}</Badge>
                                            <span className="font-medium text-zinc-800">{String(hit?.question_label || hit?.question_id || 'דגל')}</span>
                                          </div>
                                          <p className="mt-1 text-zinc-700">תשובה: {typeof hit?.answer_value === 'string' ? hit.answer_value : JSON.stringify(hit?.answer_value)}</p>
                                          {hit?.note ? <p className="mt-1 text-xs text-zinc-500">{hit.note}</p> : null}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}

                                {canEdit && !isSubmitted && (
                                  <div className="pt-2 border-t border-border">
                                    <p className="text-xs text-muted-foreground mb-1.5">שליחה חוזרת של OTP</p>
                                    <div className="flex flex-wrap gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="gap-2"
                                        disabled={isResending}
                                        onClick={() => setResendDialog({ open: true, submission, deliveryMethod: 'whatsapp' })}
                                      >
                                        {isResending && resendState.deliveryMethod === 'whatsapp' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                                        שלח שוב בוואטסאפ
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="gap-2"
                                        disabled={isResending}
                                        onClick={() => setResendDialog({ open: true, submission, deliveryMethod: 'email' })}
                                      >
                                        {isResending && resendState.deliveryMethod === 'email' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                                        שלח שוב במייל
                                      </Button>
                                    </div>
                                  </div>
                                )}

                                <div className="pt-2 border-t border-border">
                                  <p className="text-xs text-muted-foreground mb-1.5">מעקב גישה (IP)</p>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                                    {submission.metadata?.verify_ip && (
                                      <div className="flex flex-col gap-0.5">
                                        <span className="font-medium text-zinc-500">IP אימות</span>
                                        <span className="font-mono text-zinc-700">{submission.metadata.verify_ip}</span>
                                        {submission.metadata.verify_ip_at && (
                                          <span className="text-muted-foreground">{formatDateTime(submission.metadata.verify_ip_at)}</span>
                                        )}
                                      </div>
                                    )}
                                    {submission.metadata?.submit_ip && (
                                      <div className="flex flex-col gap-0.5">
                                        <span className="font-medium text-zinc-500">IP שליחה</span>
                                        <span className="font-mono text-zinc-700">{submission.metadata.submit_ip}</span>
                                        {submission.metadata.submit_ip_at && (
                                          <span className="text-muted-foreground">{formatDateTime(submission.metadata.submit_ip_at)}</span>
                                        )}
                                      </div>
                                    )}
                                    {!submission.metadata?.verify_ip && !submission.metadata?.submit_ip && (
                                      <span className="text-muted-foreground">לא נרשמו כתובות IP</span>
                                    )}
                                  </div>
                                </div>
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

      <ResendOtpDialog
        open={resendDialog.open}
        onOpenChange={(open) => setResendDialog((prev) => ({ ...prev, open }))}
        submission={resendDialog.submission}
        deliveryMethod={resendDialog.deliveryMethod}
        loading={Boolean(resendState.submissionId)}
        onConfirm={(expiresInMinutes) => {
          const { submission, deliveryMethod } = resendDialog;
          setResendDialog({ open: false, submission: null, deliveryMethod: '' });
          void handleResend(submission, deliveryMethod, expiresInMinutes);
        }}
      />
    </div>
  );
}
