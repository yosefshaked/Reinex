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

function normalizeSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object', properties: {}, required: [] };
  }
  if (!schema.type) {
    return { ...schema, type: 'object' };
  }
  return schema;
}

const LEGAL_NOTICE_DISMISSED_KEY = 'reinex_submit_legal_notice_dismissed';

export default function SubmitFormPage() {
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState('login');
  const [identityNumber, setIdentityNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [submissionId, setSubmissionId] = useState('');
  const [formSchema, setFormSchema] = useState({ type: 'object', properties: {}, required: [] });
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showLegalNotice, setShowLegalNotice] = useState(false);

  const canVerify = Boolean(identityNumber.trim() && otp.trim().length === 6);

  const title = useMemo(() => {
    if (step === 'done') return 'הטופס נשלח בהצלחה';
    if (step === 'form') return 'מילוי טופס';
    return 'אימות פרטי תלמיד';
  }, [step]);

  const description = useMemo(() => {
    if (step === 'done') return 'תודה רבה, הטופס התקבל במערכת.';
    if (step === 'form') return 'נא למלא את כל הפרטים הנדרשים ולשלוח.';
    return 'הזן מזהה גישה וקוד אימות כדי להמשיך.';
  }, [step]);

  useEffect(() => {
    try {
      const dismissed = window?.localStorage?.getItem(LEGAL_NOTICE_DISMISSED_KEY) === '1';
      setShowLegalNotice(!dismissed);
    } catch {
      setShowLegalNotice(true);
    }
  }, []);

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

            {step === 'login' && (
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
