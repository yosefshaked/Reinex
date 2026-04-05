import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import { Loader2, ShieldCheck, FileCheck2, Info, UserRound, PhoneCall, CalendarClock, WalletCards, ClipboardList, CheckCircle2 } from 'lucide-react';
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

function RequiredLabel({ htmlFor, children, required = false }) {
  return (
    <Label htmlFor={htmlFor} className="text-sm font-medium text-slate-800">
      {children}
      {required ? <span className="ms-1 text-red-500">*</span> : null}
    </Label>
  );
}

function getPublicInputClass(hasError) {
  return `h-11 rounded-xl border bg-white px-3 text-sm shadow-sm transition-colors ${
    hasError ? 'border-red-300 focus-visible:ring-red-300' : 'border-slate-200 focus-visible:ring-primary/30'
  }`;
}

function PublicTextWidget(props) {
  const { id, value, onChange, placeholder, disabled, readonly, required, type = 'text', rawErrors } = props;
  return (
    <Input
      id={id}
      type={type}
      value={value ?? ''}
      required={required}
      disabled={disabled || readonly}
      placeholder={placeholder}
      className={getPublicInputClass(Boolean(rawErrors?.length))}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function PublicNumberWidget(props) {
  const { id, value, onChange, placeholder, disabled, readonly, required, rawErrors } = props;
  return (
    <Input
      id={id}
      type="number"
      value={value ?? ''}
      required={required}
      disabled={disabled || readonly}
      placeholder={placeholder}
      className={getPublicInputClass(Boolean(rawErrors?.length))}
      onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
    />
  );
}

function PublicTextareaWidget(props) {
  const { id, value, onChange, placeholder, disabled, readonly, required, rawErrors } = props;
  return (
    <Textarea
      id={id}
      value={value ?? ''}
      required={required}
      disabled={disabled || readonly}
      placeholder={placeholder}
      rows={4}
      className={`min-h-[120px] rounded-xl border bg-white px-3 py-2 text-sm shadow-sm ${rawErrors?.length ? 'border-red-300' : 'border-slate-200'}`}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function PublicSelectWidget(props) {
  const { id, value, onChange, disabled, readonly, required, options, rawErrors, placeholder } = props;
  return (
    <select
      id={id}
      value={value ?? ''}
      required={required}
      disabled={disabled || readonly}
      className={`h-11 w-full rounded-xl border bg-white px-3 text-sm shadow-sm ${rawErrors?.length ? 'border-red-300' : 'border-slate-200'}`}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{placeholder || 'בחרו אפשרות'}</option>
      {(options?.enumOptions || []).map((option) => (
        <option key={String(option.value)} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function PublicCheckboxWidget(props) {
  const { id, value, onChange, disabled, readonly, rawErrors } = props;
  const isLocked = disabled || readonly;
  const selectedValue = typeof value === 'boolean' ? value : null;
  return (
    <div className={`rounded-2xl border bg-white p-2 shadow-sm ${rawErrors?.length ? 'border-red-300' : 'border-slate-200'}`}>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={selectedValue === true ? 'default' : 'outline'}
          className="h-11 rounded-xl"
          disabled={isLocked}
          onClick={() => onChange(true)}
        >
          כן
        </Button>
        <Button
          type="button"
          variant={selectedValue === false ? 'default' : 'outline'}
          className="h-11 rounded-xl"
          disabled={isLocked}
          onClick={() => onChange(false)}
        >
          לא
        </Button>
      </div>
      <input id={id} type="hidden" value={selectedValue === null ? '' : String(selectedValue)} readOnly />
      {selectedValue === null ? (
        <p className="mt-2 text-xs text-slate-500">בחרו כן או לא.</p>
      ) : null}
    </div>
  );
}

function PublicFieldTemplate(props) {
  const { id, label, required, children, errors, help, hidden, displayLabel, description, rawErrors } = props;
  if (hidden) return <div className="hidden">{children}</div>;
  if (id === 'root') return children;
  return (
    <div className={`space-y-2 rounded-2xl border bg-slate-50/70 p-4 ${rawErrors?.length ? 'border-red-200' : 'border-slate-200'}`}>
      {displayLabel && label ? <RequiredLabel htmlFor={id} required={required}>{label}</RequiredLabel> : null}
      {description}
      {children}
      {errors}
      {help}
    </div>
  );
}

function PublicObjectFieldTemplate(props) {
  return <div className="space-y-4">{props.properties.map((property) => <div key={property.name}>{property.content}</div>)}</div>;
}

function PublicTitleFieldTemplate(props) {
  return <h3 id={props.id} className="text-base font-semibold text-slate-900">{props.title}</h3>;
}

function PublicDescriptionFieldTemplate(props) {
  if (!props.description) return null;
  return <p id={props.id} className="text-sm text-slate-600">{props.description}</p>;
}

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
    studentFirstName: '',
    studentLastName: '',
    contactName: '',
    contactRelationship: 'self',
    identityNumber: '',
    phone: '',
    email: '',
    additionalServiceIds: [],
    preferredDays: [],
    preferredTimesByDay: {},
    paymentPathIntent: 'unsure',
    hmoApprovalStatus: 'no_approval_yet',
    hmoProviderName: '',
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
          studentFirstName: String(payload?.prospect?.student_first_name || ''),
          studentLastName: String(payload?.prospect?.student_last_name || ''),
          contactName: String(payload?.prospect?.contact_name || ''),
          contactRelationship: String(payload?.prospect?.contact_relationship || 'self'),
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
      if (!intakeValues.studentFirstName.trim() || !intakeValues.studentLastName.trim()) {
        setError('יש למלא שם פרטי ושם משפחה של התלמיד/ה.');
        return;
      }
      if (!intakeValues.identityNumber.trim()) {
        setError('יש למלא מספר זהות.');
        return;
      }
      if (intakeValues.contactRelationship !== 'self' && !intakeValues.contactName.trim()) {
        setError('יש למלא שם איש קשר כאשר הקרבה אינה התלמיד/ה עצמו/ה.');
        return;
      }
      if (intakeValues.paymentPathIntent === 'hmo' && !intakeValues.hmoProviderName.trim()) {
        setError('יש למלא את שם קופת החולים / הגורם המממן.');
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
              student_first_name: intakeValues.studentFirstName,
              student_last_name: intakeValues.studentLastName,
              contact_name: intakeValues.contactRelationship === 'self' ? '' : intakeValues.contactName,
              contact_relationship: intakeValues.contactRelationship,
              identity_number: intakeValues.identityNumber,
              phone: intakeValues.phone,
              email: intakeValues.email,
              requested_additional_service_ids: inviteConfig.allowAdditionalServices ? intakeValues.additionalServiceIds : [],
              preferred_days: intakeValues.preferredDays,
              preferred_times: serializePreferredTimes(intakeValues.preferredTimesByDay),
              payment_path_intent: intakeValues.paymentPathIntent,
              hmo_approval_status: intakeValues.paymentPathIntent === 'hmo' ? intakeValues.hmoApprovalStatus : undefined,
              hmo_provider_name: intakeValues.paymentPathIntent === 'hmo' ? intakeValues.hmoProviderName : undefined,
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
              <form className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-5" onSubmit={handleVerify}>
                <div className="space-y-2">
                  <RequiredLabel htmlFor="identity-number" required>מזהה גישה</RequiredLabel>
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
                  <RequiredLabel htmlFor="otp" required>קוד אימות</RequiredLabel>
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
                  <div className="space-y-5">
                    <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-100 p-5 shadow-sm">
                      <div className="flex items-start gap-3">
                        <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                          <UserRound className="h-5 w-5" />
                        </div>
                        <div className="space-y-1">
                          <h3 className="text-base font-semibold text-slate-900">פרטי הצטרפות לרשימת ההמתנה</h3>
                          <p className="text-sm text-slate-600">נשמח להכיר את התלמיד/ה ולבדוק התאמה לשיבוץ.</p>
                        </div>
                      </div>
                      {primaryService ? (
                        <div className="mt-4 rounded-2xl border border-primary/10 bg-primary/5 px-4 py-3 text-sm text-slate-700">
                          שירות מבוקש: <strong>{primaryService.name}</strong>
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 flex items-center gap-3">
                        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                          <ClipboardList className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900">פרטי תלמיד/ה</h4>
                          <p className="text-xs text-slate-500">שדות החובה מסומנים בכוכבית.</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <RequiredLabel htmlFor="invite-student-first-name" required>שם פרטי של התלמיד/ה</RequiredLabel>
                          <Input
                            id="invite-student-first-name"
                            value={intakeValues.studentFirstName}
                            onChange={(e) => setIntakeValues((prev) => ({ ...prev, studentFirstName: e.target.value }))}
                            placeholder="שם פרטי"
                            className={getPublicInputClass(false)}
                          />
                        </div>
                        <div className="space-y-2">
                          <RequiredLabel htmlFor="invite-student-last-name" required>שם משפחה של התלמיד/ה</RequiredLabel>
                          <Input
                            id="invite-student-last-name"
                            value={intakeValues.studentLastName}
                            onChange={(e) => setIntakeValues((prev) => ({ ...prev, studentLastName: e.target.value }))}
                            placeholder="שם משפחה"
                            className={getPublicInputClass(false)}
                          />
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <RequiredLabel htmlFor="invite-identity-number" required>מספר זהות</RequiredLabel>
                          <Input
                            id="invite-identity-number"
                            inputMode="numeric"
                            value={intakeValues.identityNumber}
                            onChange={(e) => setIntakeValues((prev) => ({ ...prev, identityNumber: e.target.value.replace(/\D/g, '') }))}
                            placeholder="מספר זהות של התלמיד/ה"
                            className={getPublicInputClass(false)}
                          />
                        </div>
                        <div className="space-y-2">
                          <RequiredLabel htmlFor="invite-contact-relationship">קרבה לתלמיד/ה</RequiredLabel>
                          <select
                            id="invite-contact-relationship"
                            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm"
                            value={intakeValues.contactRelationship}
                            onChange={(e) => setIntakeValues((prev) => ({
                              ...prev,
                              contactRelationship: e.target.value,
                              contactName: e.target.value === 'self' ? '' : prev.contactName,
                            }))}
                          >
                            <option value="self">התלמיד/ה עצמו/ה</option>
                            <option value="mother">אם</option>
                            <option value="father">אב</option>
                            <option value="caretaker">מטפל/ת</option>
                            <option value="other">אחר</option>
                          </select>
                        </div>
                      </div>

                      {intakeValues.contactRelationship !== 'self' && (
                        <div className="mt-4 space-y-2">
                          <RequiredLabel htmlFor="invite-contact-name" required>שם איש קשר / אפוטרופוס</RequiredLabel>
                          <Input
                            id="invite-contact-name"
                            value={intakeValues.contactName}
                            onChange={(e) => setIntakeValues((prev) => ({ ...prev, contactName: e.target.value }))}
                            placeholder="שם איש קשר"
                            className={getPublicInputClass(false)}
                          />
                        </div>
                      )}
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 flex items-center gap-3">
                        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                          <PhoneCall className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900">פרטי התקשרות</h4>
                          <p className="text-xs text-slate-500">כדי שנוכל לחזור אליכם ולעדכן על המשך התהליך.</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <RequiredLabel htmlFor="invite-phone">טלפון</RequiredLabel>
                          <Input
                            id="invite-phone"
                            value={intakeValues.phone}
                            onChange={(e) => setIntakeValues((prev) => ({ ...prev, phone: e.target.value }))}
                            placeholder="05X-XXXXXXX"
                            className={getPublicInputClass(false)}
                          />
                        </div>
                        <div className="space-y-2">
                          <RequiredLabel htmlFor="invite-email">אימייל</RequiredLabel>
                          <Input
                            id="invite-email"
                            type="email"
                            value={intakeValues.email}
                            onChange={(e) => setIntakeValues((prev) => ({ ...prev, email: e.target.value }))}
                            placeholder="name@example.com"
                            className={getPublicInputClass(false)}
                          />
                        </div>
                      </div>
                    </div>

                    {inviteConfig.allowAdditionalServices && inviteConfig.serviceOptions.length > 1 && (
                      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="mb-4 flex items-center gap-3">
                          <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                            <CheckCircle2 className="h-5 w-5" />
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-slate-900">שירותים נוספים</h4>
                            <p className="text-xs text-slate-500">אפשר לסמן עוד שירותים שמעניינים אתכם, מעבר לשירות הראשי.</p>
                          </div>
                        </div>
                        <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                          {inviteConfig.serviceOptions
                            .filter((service) => service.id !== inviteConfig.primaryServiceId)
                            .map((service) => (
                              <label key={service.id} className="flex items-center gap-3 rounded-xl bg-white px-3 py-3 text-sm text-slate-700 shadow-sm">
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

                    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 flex items-center gap-3">
                        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                          <CalendarClock className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900">זמינות מועדפת</h4>
                          <p className="text-xs text-slate-500">כך יהיה לנו קל יותר למצוא עבורכם התאמה מתאימה.</p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <RequiredLabel>ימי זמינות מועדפים</RequiredLabel>
                        <div className="flex flex-wrap gap-2">
                          {DAYS_OF_WEEK.map((day) => {
                            const selected = intakeValues.preferredDays.includes(day.value);
                            return (
                              <button
                                key={day.value}
                                type="button"
                                onClick={() => togglePreferredDay(day.value)}
                                className={`rounded-xl border px-3 py-2 text-sm shadow-sm transition-colors ${selected ? 'border-primary bg-primary text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}
                              >
                                {day.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {intakeValues.preferredDays.length > 0 && (
                      <div className="space-y-3">
                        <RequiredLabel>טווחי שעות מועדפים</RequiredLabel>
                        {intakeValues.preferredDays.map((day) => {
                          const dayInfo = DAYS_OF_WEEK.find((entry) => entry.value === day);
                          const ranges = intakeValues.preferredTimesByDay[day] || [{ start: '', end: '' }];
                          return (
                            <div key={day} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                              <div className="mb-3 text-sm font-medium text-slate-700">{dayInfo?.label || day}</div>
                              <div className="space-y-2">
                                {ranges.map((range, index) => (
                                  <div key={`${day}-${index}`} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                    <Input
                                      type="time"
                                      value={range.start}
                                      className={getPublicInputClass(false)}
                                      onChange={(e) => updatePreferredRange(day, index, 'start', e.target.value)}
                                    />
                                    <span className="text-sm text-slate-500">עד</span>
                                    <Input
                                      type="time"
                                      value={range.end}
                                      className={getPublicInputClass(false)}
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
                              <div className="mt-3">
                                <Button type="button" variant="outline" onClick={() => addPreferredRange(day)}>
                                  הוסף טווח
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 flex items-center gap-3">
                        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                          <WalletCards className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900">פרטי מימון</h4>
                          <p className="text-xs text-slate-500">המידע יעזור לנו להבין איך להמשיך את התהליך מולכם.</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <RequiredLabel htmlFor="payment-path-intent">סוג תשלום מבוקש</RequiredLabel>
                          <select
                            id="payment-path-intent"
                            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm"
                            value={intakeValues.paymentPathIntent}
                            onChange={(e) => setIntakeValues((prev) => ({
                              ...prev,
                              paymentPathIntent: e.target.value,
                              hmoApprovalStatus: e.target.value === 'hmo' ? prev.hmoApprovalStatus : 'no_approval_yet',
                              hmoProviderName: e.target.value === 'hmo' ? prev.hmoProviderName : '',
                            }))}
                          >
                            <option value="unsure">לא בטוח/ה, צריך עזרה</option>
                            <option value="private">תשלום פרטי</option>
                            <option value="hmo">דרך קופת חולים / גורם מממן</option>
                          </select>
                        </div>
                        {intakeValues.paymentPathIntent === 'hmo' && (
                          <>
                            <div className="space-y-2">
                              <RequiredLabel htmlFor="hmo-provider-name" required>שם קופת החולים / הגורם המממן</RequiredLabel>
                              <Input
                                id="hmo-provider-name"
                                value={intakeValues.hmoProviderName}
                                onChange={(e) => setIntakeValues((prev) => ({ ...prev, hmoProviderName: e.target.value }))}
                                placeholder="למשל: כללית"
                                className={getPublicInputClass(false)}
                              />
                            </div>
                            <div className="space-y-2">
                              <RequiredLabel htmlFor="hmo-approval-status">סטטוס אישור קופת חולים</RequiredLabel>
                              <select
                                id="hmo-approval-status"
                                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm"
                                value={intakeValues.hmoApprovalStatus}
                                onChange={(e) => setIntakeValues((prev) => ({ ...prev, hmoApprovalStatus: e.target.value }))}
                              >
                                <option value="no_approval_yet">אין אישור עדיין</option>
                                <option value="send_separately">האישור יישלח בנפרד בוואטסאפ/אימייל</option>
                              </select>
                            </div>
                          </>
                        )}
                      </div>

                      <div className="mt-4 space-y-2">
                        <RequiredLabel htmlFor="invite-notes">הערות נוספות</RequiredLabel>
                        <Textarea
                          id="invite-notes"
                          value={intakeValues.notes}
                          onChange={(e) => setIntakeValues((prev) => ({ ...prev, notes: e.target.value }))}
                          rows={4}
                          placeholder="פרטים נוספים שחשוב שנדע"
                          className="min-h-[120px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                      <FileCheck2 className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">שאלות נוספות</h4>
                      <p className="text-xs text-slate-500">מלאו כל שאלה רלוונטית כדי שנוכל להמשיך את הטיפול מהר יותר.</p>
                    </div>
                  </div>

                  <Form
                    schema={formSchema}
                    validator={validator}
                    formData={answers}
                    widgets={{
                      TextWidget: PublicTextWidget,
                      EmailWidget: PublicTextWidget,
                      PasswordWidget: PublicTextWidget,
                      NumberWidget: PublicNumberWidget,
                      TextareaWidget: PublicTextareaWidget,
                      SelectWidget: PublicSelectWidget,
                      CheckboxWidget: PublicCheckboxWidget,
                    }}
                    templates={{
                      FieldTemplate: PublicFieldTemplate,
                      ObjectFieldTemplate: PublicObjectFieldTemplate,
                      TitleFieldTemplate: PublicTitleFieldTemplate,
                      DescriptionFieldTemplate: PublicDescriptionFieldTemplate,
                    }}
                    onChange={(event) => setAnswers(event.formData || {})}
                    onSubmit={handleSubmitForm}
                  >
                    <div className="pt-4">
                      <Button type="submit" className="h-11 w-full gap-2 rounded-xl" disabled={submitLoading}>
                        {submitLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        שלח טופס
                      </Button>
                    </div>
                  </Form>
                </div>
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
