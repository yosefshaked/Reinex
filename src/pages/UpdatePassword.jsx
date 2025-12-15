import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/auth/AuthContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import AuthLayout from '@/components/layouts/AuthLayout.jsx';
import Button from '@/components/ui/CustomButton.jsx';
import Input from '@/components/ui/CustomInput.jsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.jsx';

const REQUEST_STATUS = Object.freeze({
  idle: 'idle',
  loading: 'loading',
  success: 'success',
  error: 'error',
});

export default function UpdatePassword() {
  const location = useLocation();
  const navigate = useNavigate();
  const { authClient } = useSupabase();
  const { updatePassword } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [requestStatus, setRequestStatus] = useState(REQUEST_STATUS.idle);
  const [errorMessage, setErrorMessage] = useState('');
  const [verificationStatus, setVerificationStatus] = useState('waiting-client');
  const [verificationError, setVerificationError] = useState('');

  const tokenHash = useMemo(() => {
    const params = new URLSearchParams(location.search ?? '');
    const value = params.get('token_hash') ?? params.get('tokenHash');
    return value ? value.trim() : '';
  }, [location.search]);

  useEffect(() => {
    if (!authClient) {
      setVerificationStatus('waiting-client');
      return undefined;
    }

    if (!tokenHash) {
      setVerificationError('קישור האיפוס אינו תקף עוד.');
      setVerificationStatus('error');
      return undefined;
    }

    let isActive = true;
    setVerificationError('');
    setVerificationStatus('verifying');

    authClient.auth
      .verifyOtp({ token_hash: tokenHash, type: 'recovery' })
      .then(({ error }) => {
        if (!isActive) {
          return;
        }
        if (error) {
          throw error;
        }
        setVerificationStatus('ready');
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }
        console.error('Failed to verify password recovery token', error);
        let message = 'אימות קישור האיפוס נכשל. נסו לרענן את הדף או לשלוח בקשה חדשה.';
        
        if (error?.message?.toLowerCase().includes('expired')) {
          message = 'הקישור לאיפוס פג תוקף. נסו לשלוח בקשה חדשה דרך עמוד איפוס הסיסמה.';
        } else if (error?.message?.toLowerCase().includes('used') || error?.message?.toLowerCase().includes('already')) {
          message = 'הקישור כבר שומש. אם סיימת לעדכן את הסיסמה, התחבר במסך הכניסה. אחרת, שלח בקשה חדשה לאיפוס.';
        } else if (error?.message === 'Token has been expired or revoked') {
          message = 'הקישור לאיפוס אינו פעיל או שפג תוקפו. נסו לשלוח בקשה חדשה דרך עמוד איפוס הסיסמה.';
        }
        
        setVerificationError(message);
        setVerificationStatus('error');
      });

    return () => {
      isActive = false;
    };
  }, [authClient, tokenHash]);

  const isWaitingForClient = verificationStatus === 'waiting-client';
  const isVerifying = verificationStatus === 'verifying';
  const isVerificationReady = verificationStatus === 'ready';
  const isVerificationError = verificationStatus === 'error';

  const isLoading = requestStatus === REQUEST_STATUS.loading;
  const isSuccess = requestStatus === REQUEST_STATUS.success;
  const isError = requestStatus === REQUEST_STATUS.error;

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!isVerificationReady) {
      setErrorMessage('קישור האיפוס אינו תקף עוד.');
      setRequestStatus(REQUEST_STATUS.error);
      return;
    }

    const trimmedPassword = password.trim();
    const trimmedConfirmPassword = confirmPassword.trim();

    if (!trimmedPassword || !trimmedConfirmPassword) {
      setErrorMessage('נא למלא את שני שדות הסיסמה.');
      setRequestStatus(REQUEST_STATUS.error);
      return;
    }

    if (trimmedPassword !== trimmedConfirmPassword) {
      setErrorMessage('הסיסמאות אינן תואמות.');
      setRequestStatus(REQUEST_STATUS.error);
      return;
    }

    if (trimmedPassword.length < 8) {
      setErrorMessage('הסיסמה צריכה להכיל לפחות 8 תווים.');
      setRequestStatus(REQUEST_STATUS.error);
      return;
    }

    setRequestStatus(REQUEST_STATUS.loading);
    setErrorMessage('');

    try {
      await updatePassword(trimmedPassword);
      setRequestStatus(REQUEST_STATUS.success);
      toast.success('הסיסמה עודכנה בהצלחה! מפנה ללוח הבקרה...');
      navigate('/', { replace: true });
    } catch (error) {
      console.error('Failed to update password', error);
      setErrorMessage(error?.message || 'עדכון הסיסמה נכשל. נסו שוב מאוחר יותר.');
      setRequestStatus(REQUEST_STATUS.error);
    }
  };

  return (
    <AuthLayout>
      <div className="bg-gradient-to-l from-blue-500 to-indigo-500 px-6 py-6 text-right text-white">
        <div className="flex items-center justify-end gap-2 text-2xl font-bold">
          <span>עדכון סיסמה</span>
          <Lock className="h-7 w-7" aria-hidden="true" />
        </div>
        <p className="mt-2 text-sm text-blue-100 leading-relaxed">
          הזינו סיסמה חדשה כדי להשלים את תהליך האיפוס ולהיכנס למערכת.
        </p>
      </div>
      <div className="space-y-6 px-6 pb-8 pt-6">
        {isWaitingForClient || isVerifying ? (
          <div className="flex items-center justify-center gap-2 rounded-xl bg-white/60 p-4 text-slate-600" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>טוען את החיבור המאובטח...</span>
          </div>
        ) : null}

        {isVerificationError ? (
          <Alert className="bg-amber-50 border-amber-200 text-amber-800" role="alert">
            <AlertTitle>קישור לא תקף</AlertTitle>
            <AlertDescription>
              {verificationError || 'הקישור לאיפוס אינו פעיל או שפג תוקפו. נסו לשלוח בקשה חדשה דרך '}
              <Link to="/forgot-password" className="text-blue-600 hover:underline">
                עמוד איפוס הסיסמה
              </Link>
              .
            </AlertDescription>
          </Alert>
        ) : null}

        {isError && errorMessage ? (
          <Alert className="bg-red-50 border-red-200 text-red-700" role="alert">
            <AlertTitle>אירעה שגיאה</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        {isSuccess ? (
          <Alert className="bg-emerald-50 border-emerald-200 text-emerald-800" role="status">
            <AlertTitle>הסיסמה עודכנה</AlertTitle>
            <AlertDescription className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              מפנה אתכם ללוח הבקרה...
            </AlertDescription>
          </Alert>
        ) : null}

        {isVerificationReady ? (
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <Input
              type="password"
              label="סיסמה חדשה"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
              disabled={isLoading}
            />

            <Input
              type="password"
              label="אימות סיסמה"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
              disabled={isLoading}
            />

            <div className="flex flex-col gap-3 text-sm text-right">
              <Button type="submit" disabled={isLoading} className="w-full">
                {isLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    מעדכן סיסמה...
                  </span>
                ) : (
                  'עדכנו את הסיסמה'
                )}
              </Button>
              <Link
                to="/login"
                className="text-sm font-medium text-blue-600 hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 rounded-md px-1 self-end"
              >
                חזרה למסך ההתחברות
              </Link>
            </div>
          </form>
        ) : null}
      </div>
    </AuthLayout>
  );
}
