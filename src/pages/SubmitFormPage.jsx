import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import { Loader2, ShieldCheck, FileCheck2, Info } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';

const DAYS_OF_WEEK = [
  { value: 0, label: 'ראשון', short: 'א' },
  { value: 1, label: 'שני', short: 'ב' },
  { value: 2, label: 'שלישי', short: 'ג' },
  { value: 3, label: 'רביעי', short: 'ד' },
  { value: 4, label: 'חמישי', short: 'ה' },
  { value: 5, label: 'שישי', short: 'ו' },
  { value: 6, label: 'שבת', short: 'ש' },
];

function normalizeSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object', properties: {}, required: [] };
  }
  if (!schema.type) {
    return { ...schema, type: 'object' };
  }
  return schema;
}

function normalizePreferredTimesByDay(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result = {};
  Object.entries(value).forEach(([dayKey, ranges]) => {
    const day = Number(dayKey);
    if (!Number.isInteger(day) || day < 0 || day > 6 || !Array.isArray(ranges)) return;
    result[day] = ranges
      .map((range) => ({
        start: typeof range?.start === 'string' ? range.start : '',
        end: typeof range?.end === 'string' ? range.end : '',
      }))
      .filter((range) => range.start || range.end);
  });
  return result;
}

function serializePreferredTimes(preferredTimesByDay) {
  if (!preferredTimesByDay || typeof preferredTimesByDay !== 'object') return [];
  return Object.entries(preferredTimesByDay)
    .map(([dayKey, ranges]) => {
      const day = Number(dayKey);
      if (!Number.isInteger(day) || day < 0 || day > 6) return null;
      const normalizedRanges = Array.isArray(ranges)
        ? ranges
            .map((range) => ({
              start: typeof range?.start === 'string' ? range.start.trim() : '',
              end: typeof range?.end === 'string' ? range.end.trim() : '',
            }))
            .filter((range) => range.start && range.end)
        : [];
      return normalizedRanges.length ? { day, ranges: normalizedRanges } : null;
    })
    .filter(Boolean);
}

const LEGAL_NOTICE_DISMISSED_KEY = 'reinex_submit_legal_notice_dismissed';

export default function SubmitFormPage() {
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState('login');
  const [submissionMode, setSubmissionMode] = useState('otp');
  const [identityNumber, setIdentityNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [submissionId, setSubmissionId] = useState('');
  const [formSchema, setFormSchema] = useState({ type: 'object', properties: {}, required: [] });
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [answers, setAnswers] = useState({});
  const [inviteToken, setInviteToken] = useState('');
  const [inviteConfig, setInviteConfig] = useState({
    primaryServiceId: '',
    allowAdditionalServices: false,
    serviceOptions: [],
  });
  const [intakeValues, setIntakeValues] = useState({
    contactName: '',
    identityNumber: '',
    phone: '',
    email: '',
    additionalServiceIds: [],
    preferredDays: [],
    preferredTimesByDay: {},
    paymentPathIntent: 'unsure',
    hmoApprovalStatus: 'no_approval_yet',
    notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showLegalNotice, setShowLegalNotice] = useState(false);

  const canVerify = Boolean(identityNumber.trim() && otp.trim().length === 6);

  const title = useMemo(() => {
    if (step === 'done') return 'הטופס נשלח בהצלחה';
    if (step === 'form') return submissionMode === 'invite' ? (formName || 'טופס הצטרפות לרשימת המתנה') : 'מילוי טופס';
    return 'אימות פרטי תלמיד';
  }, [formName, step, submissionMode]);

  const description = useMemo(() => {
    if (step === 'done') return 'תודה רבה, הטופס התקבל במערכת.';
    if (step === 'form') return submissionMode === 'invite' ? (formDescription || 'נא למלא את פרטי ההמתנה ולשלוח.') : 'נא למלא את כל הפרטים הנדרשים ולשלוח.';
    return 'הזן מזהה גישה וקוד אימות כדי להמשיך.';
  }, [formDescription, step, submissionMode]);

  useEffect(() => {
    try {
      const dismissed = window?.localStorage?.getItem(LEGAL_NOTICE_DISMISSED_KEY) === '1';
      setShowLegalNotice(!dismissed);
    } catch {
      setShowLegalNotice(true);
    }
  }, []);

  useEffect(() => {
    const invite = String(searchParams.get('invite') || searchParams.get('invite_token') || '').trim();
    if (!invite) {
      return;
    }

    let cancelled = false;

    const loadInvite = async () => {
      setLoading(true);
      setError('');
      setSubmissionMode('invite');
      try {
        const response = await fetch(`/api/waiting-list-intake/load?invite=${encodeURIComponent(invite)}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.message || 'טעינת הקישור נכשלה');
        }
        if (cancelled) return;

        setInviteToken(String(payload?.invite_token || invite));
        setSubmissionId(String(payload?.submission_id || ''));
        setFormSchema(normalizeSchema(payload?.form_schema));
        setFormName(String(payload?.form_name || ''));
        setFormDescription(String(payload?.form_description || ''));
        setInviteConfig({
          primaryServiceId: String(payload?.intake_config?.primary_service_id || ''),
          allowAdditionalServices: Boolean(payload?.intake_config?.allow_additional_services),
          serviceOptions: Array.isArray(payload?.intake_config?.service_options) ? payload.intake_config.service_options : [],
        });
        setIntakeValues((prev) => ({
          ...prev,
          contactName: String(payload?.prospect?.contact_name || ''),
          identityNumber: String(payload?.prospect?.identity_number || ''),
          phone: String(payload?.prospect?.phone || ''),
          email: String(payload?.prospect?.email || ''),
        }));
        setStep('form');
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError?.message || 'טעינת הקישור נכשלה');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadInvite();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  useEffect(() => {
    const prefilledIdentity = String(
      searchParams.get('identity_number') ||
      searchParams.get('identityNumber') ||
      searchParams.get('access_identifier') ||
      '',
    ).replace(/\D/g, '');

    const prefilledOtp = String(searchParams.get('otp') || '').replace(/\D/g, '').slice(0, 6);

    if (prefilledIdentity) {
      setIdentityNumber((prev) => prev || prefilledIdentity);
    }

    if (prefilledOtp) {
      setOtp((prev) => prev || prefilledOtp);
    }
  }, [searchParams]);

  const dismissLegalNotice = () => {
    setShowLegalNotice(false);
    try {
      window?.localStorage?.setItem(LEGAL_NOTICE_DISMISSED_KEY, '1');
    } catch {
      // no-op
    }
  };

  const handleVerify = async (event) => {
    event.preventDefault();
    if (!canVerify) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/form-submissions/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity_number: identityNumber,
          otp,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || 'אימות נכשל');
      }

      setSubmissionId(String(payload?.submission_id || submissionId || ''));
      setFormSchema(normalizeSchema(payload?.form_schema));
      setStep('form');
    } catch (verifyError) {
      console.error('Verify failed', verifyError);
      setError(verifyError?.message || 'אימות נכשל, נסה שוב');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitForm = async ({ formData }) => {
    if (submissionMode === 'invite') {
      if (!inviteToken) {
        setError('חסר מזהה קישור, נא לפתוח את הקישור מחדש.');
        return;
      }

      setSubmitLoading(true);
      setError('');

      try {
        const response = await fetch('/api/waiting-list-intake/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invite_token: inviteToken,
            intake: {
              contact_name: intakeValues.contactName,
              identity_number: intakeValues.identityNumber,
              phone: intakeValues.phone,
              email: intakeValues.email,
              requested_additional_service_ids: inviteConfig.allowAdditionalServices ? intakeValues.additionalServiceIds : [],
              preferred_days: intakeValues.preferredDays,
              preferred_times: serializePreferredTimes(intakeValues.preferredTimesByDay),
              payment_path_intent: intakeValues.paymentPathIntent,
              hmo_approval_status: intakeValues.hmoApprovalStatus,
              notes: intakeValues.notes,
            },
            custom_answers: formData || {},
          }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.message || 'שליחת הטופס נכשלה');
        }

        setSuccessMessage('הטופס נקלט בהצלחה. נציג יחזור אליך בהקדם.');
        setStep('done');
        return;
      } catch (submitError) {
        console.error('Waiting-list intake submit failed', submitError);
        setError(submitError?.message || 'שליחת הטופס נכשלה');
      } finally {
        setSubmitLoading(false);
      }
      return;
    }

    if (!submissionId) {
      setError('חסר מזהה שליחה, נא לחזור למסך האימות.');
      return;
    }

    setSubmitLoading(true);
    setError('');

    try {
      const response = await fetch('/api/form-submissions/submit', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submission_id: submissionId,
          otp,
          answers: formData || {},
          form_schema: formSchema,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || 'שליחת הטופס נכשלה');
      }

      setSuccessMessage('הטופס נקלט בהצלחה. אפשר לסגור את החלון.');
      setStep('done');
    } catch (submitError) {
      console.error('Submit failed', submitError);
      setError(submitError?.message || 'שליחת הטופס נכשלה');
    } finally {
      setSubmitLoading(false);
    }
  };

  const toggleAdditionalService = (serviceId, checked) => {
    setIntakeValues((prev) => ({
      ...prev,
      additionalServiceIds: checked
        ? Array.from(new Set([...prev.additionalServiceIds, serviceId]))
        : prev.additionalServiceIds.filter((value) => value !== serviceId),
    }));
  };

  const togglePreferredDay = (day) => {
    setIntakeValues((prev) => {
      const currentlySelected = prev.preferredDays.includes(day);
      const preferredDays = currentlySelected
        ? prev.preferredDays.filter((value) => value !== day)
        : [...prev.preferredDays, day].sort((a, b) => a - b);

      const preferredTimesByDay = { ...prev.preferredTimesByDay };
      if (currentlySelected) {
        delete preferredTimesByDay[day];
      } else if (!preferredTimesByDay[day]) {
        preferredTimesByDay[day] = [{ start: '', end: '' }];
      }

      return {
        ...prev,
        preferredDays,
        preferredTimesByDay,
      };
    });
  };

  const addPreferredRange = (day) => {
    setIntakeValues((prev) => ({
      ...prev,
      preferredTimesByDay: {
        ...prev.preferredTimesByDay,
        [day]: [...(prev.preferredTimesByDay[day] || []), { start: '', end: '' }],
      },
    }));
  };

  const updatePreferredRange = (day, index, field, value) => {
    setIntakeValues((prev) => ({
      ...prev,
      preferredTimesByDay: {
        ...prev.preferredTimesByDay,
        [day]: (prev.preferredTimesByDay[day] || []).map((range, rangeIndex) => (
          rangeIndex === index ? { ...range, [field]: value } : range
        )),
      },
    }));
  };

  const removePreferredRange = (day, index) => {
    setIntakeValues((prev) => {
      const nextRanges = (prev.preferredTimesByDay[day] || []).filter((_, rangeIndex) => rangeIndex !== index);
      const preferredTimesByDay = { ...prev.preferredTimesByDay };
      if (nextRanges.length) {
        preferredTimesByDay[day] = nextRanges;
      } else {
        preferredTimesByDay[day] = [{ start: '', end: '' }];
      }
      return { ...prev, preferredTimesByDay };
    });
  };

  const primaryService = inviteConfig.serviceOptions.find((service) => service.id === inviteConfig.primaryServiceId) || null;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 pb-28" dir="rtl">
      <div className="mx-auto w-full max-w-2xl">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              {step === 'form' ? <FileCheck2 className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {error && (
              <Alert>
                <AlertDescription className="text-red-700">{error}</AlertDescription>
              </Alert>
            )}

            {step === 'login' && submissionMode === 'invite' && (
              <div className="space-y-4">
                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    טוען את קישור ההצטרפות...
                  </div>
                ) : (
                  <Alert>
                    <AlertDescription className="text-slate-700">
                      {error || 'לא ניתן לפתוח את קישור ההצטרפות. אפשר לבקש קישור חדש מהארגון.'}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            {step === 'login' && submissionMode !== 'invite' && (
              <form className="space-y-4" onSubmit={handleVerify}>
                <div className="space-y-2">
                  <Label htmlFor="identity-number">מזהה גישה</Label>
                  <Input
                    id="identity-number"
                    dir="rtl"
                    inputMode="numeric"
                    value={identityNumber}
                    onChange={(e) => setIdentityNumber(e.target.value.replace(/\D/g, ''))}
                    placeholder="12345678910"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="otp">קוד אימות</Label>
                  <Input
                    id="otp"
                    dir="rtl"
                    inputMode="numeric"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                  />
                </div>

                <Button type="submit" className="w-full gap-2" disabled={loading || !canVerify}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  כניסה לטופס
                </Button>
              </form>
            )}

            {step === 'form' && (
              <div className="space-y-5">
                {submissionMode === 'invite' && (
                  <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-slate-900">פרטי הצטרפות לרשימת המתנה</h3>
                      {primaryService ? (
                        <p className="text-sm text-slate-600">שירות מבוקש: <strong>{primaryService.name}</strong></p>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="invite-contact-name">שם מלא</Label>
                      <Input
                        id="invite-contact-name"
                        value={intakeValues.contactName}
                        onChange={(e) => setIntakeValues((prev) => ({ ...prev, contactName: e.target.value }))}
                        placeholder="שם מלא"
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="invite-identity-number">מספר זהות</Label>
                        <Input
                          id="invite-identity-number"
                          inputMode="numeric"
                          value={intakeValues.identityNumber}
                          onChange={(e) => setIntakeValues((prev) => ({ ...prev, identityNumber: e.target.value.replace(/\D/g, '') }))}
                          placeholder="אופציונלי"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="invite-phone">טלפון</Label>
                        <Input
                          id="invite-phone"
                          value={intakeValues.phone}
                          onChange={(e) => setIntakeValues((prev) => ({ ...prev, phone: e.target.value }))}
                          placeholder="05X-XXXXXXX"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="invite-email">אימייל</Label>
                      <Input
                        id="invite-email"
                        type="email"
                        value={intakeValues.email}
                        onChange={(e) => setIntakeValues((prev) => ({ ...prev, email: e.target.value }))}
                        placeholder="name@example.com"
                      />
                    </div>

                    {inviteConfig.allowAdditionalServices && inviteConfig.serviceOptions.length > 1 && (
                      <div className="space-y-2">
                        <Label>שירותים נוספים שמעניינים אותך</Label>
                        <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
                          {inviteConfig.serviceOptions
                            .filter((service) => service.id !== inviteConfig.primaryServiceId)
                            .map((service) => (
                              <label key={service.id} className="flex items-center gap-3 text-sm text-slate-700">
                                <Checkbox
                                  checked={intakeValues.additionalServiceIds.includes(service.id)}
                                  onCheckedChange={(checked) => toggleAdditionalService(service.id, checked === true)}
                                />
                                <span>{service.name}</span>
                              </label>
                            ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>ימי זמינות מועדפים</Label>
                      <div className="flex flex-wrap gap-2">
                        {DAYS_OF_WEEK.map((day) => {
                          const selected = intakeValues.preferredDays.includes(day.value);
                          return (
                            <button
                              key={day.value}
                              type="button"
                              onClick={() => togglePreferredDay(day.value)}
                              className={`rounded-md border px-3 py-2 text-sm ${selected ? 'border-primary bg-primary text-white' : 'border-slate-300 bg-white text-slate-700'}`}
                            >
                              {day.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {intakeValues.preferredDays.length > 0 && (
                      <div className="space-y-3">
                        <Label>טווחי שעות מועדפים</Label>
                        {intakeValues.preferredDays.map((day) => {
                          const dayInfo = DAYS_OF_WEEK.find((entry) => entry.value === day);
                          const ranges = intakeValues.preferredTimesByDay[day] || [{ start: '', end: '' }];
                          return (
                            <div key={day} className="rounded-md border border-slate-200 bg-white p-3">
                              <div className="mb-2 text-sm font-medium text-slate-700">{dayInfo?.label || day}</div>
                              <div className="space-y-2">
                                {ranges.map((range, index) => (
                                  <div key={`${day}-${index}`} className="flex items-center gap-2">
                                    <Input
                                      type="time"
                                      value={range.start}
                                      onChange={(e) => updatePreferredRange(day, index, 'start', e.target.value)}
                                    />
                                    <span className="text-sm text-slate-500">עד</span>
                                    <Input
                                      type="time"
                                      value={range.end}
                                      onChange={(e) => updatePreferredRange(day, index, 'end', e.target.value)}
                                    />
                                    {ranges.length > 1 && (
                                      <Button type="button" variant="outline" onClick={() => removePreferredRange(day, index)}>
                                        הסר
                                      </Button>
                                    )}
                                  </div>
                                ))}
                              </div>
                              <div className="mt-2">
                                <Button type="button" variant="outline" onClick={() => addPreferredRange(day)}>
                                  הוסף טווח
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="payment-path-intent">סוג תשלום מבוקש</Label>
                        <select
                          id="payment-path-intent"
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                          value={intakeValues.paymentPathIntent}
                          onChange={(e) => setIntakeValues((prev) => ({ ...prev, paymentPathIntent: e.target.value }))}
                        >
                          <option value="unsure">לא בטוח/ה, צריך עזרה</option>
                          <option value="private">תשלום פרטי</option>
                          <option value="hmo">דרך קופת חולים / גורם מממן</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="hmo-approval-status">סטטוס אישור קופת חולים</Label>
                        <select
                          id="hmo-approval-status"
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                          value={intakeValues.hmoApprovalStatus}
                          onChange={(e) => setIntakeValues((prev) => ({ ...prev, hmoApprovalStatus: e.target.value }))}
                        >
                          <option value="no_approval_yet">אין אישור עדיין</option>
                          <option value="has_approval">יש אישור קיים</option>
                          <option value="send_separately">נשלח בנפרד בוואטסאפ/אימייל</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="invite-notes">הערות נוספות</Label>
                      <Textarea
                        id="invite-notes"
                        value={intakeValues.notes}
                        onChange={(e) => setIntakeValues((prev) => ({ ...prev, notes: e.target.value }))}
                        rows={4}
                        placeholder="פרטים נוספים שחשוב שנדע"
                      />
                    </div>
                  </div>
                )}

                <Form
                  schema={formSchema}
                  validator={validator}
                  formData={answers}
                  onChange={(event) => setAnswers(event.formData || {})}
                  onSubmit={handleSubmitForm}
                >
                  <div className="pt-2">
                    <Button type="submit" className="w-full gap-2" disabled={submitLoading}>
                      {submitLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      שלח טופס
                    </Button>
                  </div>
                </Form>
              </div>
            )}

            {step === 'done' && (
              <Alert>
                <AlertDescription className="text-emerald-700">{successMessage}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>

      {showLegalNotice && (
        <div className="fixed inset-x-0 bottom-3 z-20 px-4">
          <div className="mx-auto w-full max-w-2xl rounded-lg border border-slate-200 bg-white/95 px-3 py-2 shadow-md backdrop-blur">
            <div className="flex items-start gap-2 text-xs text-slate-700">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500" />
              <p className="flex-1">
                בהמשך השימוש באתר ושליחת הטופס, הנך מאשר/ת את תנאי השימוש ומדיניות הפרטיות של הארגון,
                לרבות שימוש במידע הנמסר לצורך טיפול מנהלתי, רפואי ותפעולי.
              </p>
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={dismissLegalNotice}>
                הבנתי
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
