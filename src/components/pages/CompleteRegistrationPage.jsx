import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import AuthLayout from '@/components/layouts/AuthLayout.jsx';
import { buildInvitationSearch, extractRegistrationTokens } from '@/lib/invite-tokens.js';
import { getInvitationByToken } from '@/api/invitations.js';

export default function CompleteRegistrationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { authClient } = useSupabase();

  const { tokenHash, invitationTokenKey, invitationTokenValue } = useMemo(
    () => extractRegistrationTokens(location.search),
    [location.search],
  );

  const [inviteStatus, setInviteStatus] = useState('loading');
  const [inviteError, setInviteError] = useState('');
  const [invitationEmail, setInvitationEmail] = useState('');
  const [invitationAuth, setInvitationAuth] = useState(null);
  const [verifyError, setVerifyError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    if (!tokenHash) {
      setInviteError('קישור ההזמנה שחצת אינו מכיל אסימון אימות תקין. בקש הזמנה חדשה ממנהל הארגון.');
      setInviteStatus('error');
      return;
    }

    if (!invitationTokenValue) {
      setInviteError('קישור זה חסר מזהה הזמנה ארגוני ולכן לא ניתן להשלים את התהליך. בקש הזמנה חדשה ממנהל הארגון.');
      setInviteStatus('error');
      return;
    }

    const controller = new AbortController();
    let isActive = true;
    setInviteStatus('loading');
    setInviteError('');
    setVerifyError('');
    setPassword('');
    setConfirmPassword('');
    setPasswordError('');

    getInvitationByToken(invitationTokenValue, { signal: controller.signal })
      .then((record) => {
        if (!isActive) {
          return;
        }
        if (record.status && record.status !== 'pending') {
          const statusMessage =
            record.status === 'accepted'
              ? 'ההזמנה כבר אושרה והחשבון פעיל. היכנס למערכת עם הסיסמה שלך.'
              : 'ההזמנה הזו כבר אינה זמינה. בקש מהמנהל לשלוח קישור חדש.';
          setInviteError(statusMessage);
          setInviteStatus('error');
          return;
        }
        setInvitationEmail(record.email || '');
        setInvitationAuth(record.auth || null);
        setInviteStatus('ready');
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }
        console.error('Failed to load invitation before verification', error);
        const message = error?.message || 'טעינת נתוני ההזמנה נכשלה. נסה שוב או בקש קישור חדש.';
        setInviteError(message);
        setInviteStatus('error');
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [tokenHash, invitationTokenValue]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (inviteStatus !== 'ready') {
      return;
    }
    if (!authClient) {
      setVerifyError('לקוח האימות עדיין נטען. רענן את הדף ונסה שוב.');
      return;
    }
    if (!tokenHash) {
      setVerifyError('אסימון ההרשמה חסר או פגום. בקש הזמנה חדשה מהמנהל.');
      return;
    }
    if (isSubmitting) {
      return;
    }
    if (!password || !confirmPassword) {
      setPasswordError('יש למלא סיסמה ולאשר אותה כדי להמשיך.');
      return;
    }
    if (password.length < 6) {
      setPasswordError('הסיסמה חייבת להכיל לפחות 6 תווים.');
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError('הסיסמאות אינן תואמות. ודא שהקלדת את אותה סיסמה פעמיים.');
      return;
    }

    setPasswordError('');
    setVerifyError('');
    setIsSubmitting(true);
    try {
      const { error: verifyOtpError } = await authClient.auth.verifyOtp({ token_hash: tokenHash, type: 'invite' });
      if (verifyOtpError) {
        throw { stage: 'verify', error: verifyOtpError };
      }

      const { error: updateError } = await authClient.auth.updateUser({ password });
      if (updateError) {
        throw { stage: 'update', error: updateError };
      }
      const search = buildInvitationSearch(invitationTokenValue, invitationTokenKey);
      navigate(`/accept-invite${search}`, { replace: true });
    } catch (caught) {
      const stage = caught?.stage || 'verify';
      const error = caught?.error || caught;

      if (stage === 'update') {
        console.error('Failed to set password after verifying invitation', error);
        const message =
          error?.message === 'Password should be at least 6 characters'
            ? 'הסיסמה חייבת להכיל לפחות 6 תווים.'
            : error?.message || 'שמירת הסיסמה נכשלה. נסה שוב או בחר סיסמה אחרת.';
        setPasswordError(message);
        return;
      }

      console.error('Failed to verify invitation token on demand', error);
      let message = 'אימות הקישור נכשל. ודא שהשתמשת בקישור העדכני ביותר או נסה שוב מאוחר יותר.';

      const rawMsg = String(error?.message || '').toLowerCase();
      const status = Number(error?.status || error?.code || 0);

      if (rawMsg.includes('invalid') || status === 403 || rawMsg.includes('used') || rawMsg.includes('already')) {
        const wasVerified = !!(invitationAuth?.exists && invitationAuth?.emailConfirmed);
        if (wasVerified) {
          message = 'הקישור כבר שומש. אם שכחת את הסיסמה, ניתן לאפס אותה באמצעות הכפתור מטה.';
        } else {
          message = 'ההזמנה פגה או שהקישור אינו תקף יותר. בקש מהמנהל לשלוח הזמנה חדשה.';
        }
      } else if (rawMsg.includes('expired')) {
        message = 'ההזמנה פגה. נא לבקש מהמנהל לשלוח הזמנה חדשה.';
      } else if (error?.message === 'Token has been expired or revoked') {
        message = 'קישור ההזמנה כבר לא פעיל. אם כבר יצרת חשבון, נסה להתחבר. אם ההזמנה פגה, בקש מהמנהל לשלוח קישור חדש.';
      }

      setVerifyError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderContent = () => {
    if (inviteStatus === 'loading') {
      return (
        <div className="p-8 space-y-6 text-right">
          <div className="flex items-center justify-end gap-3 text-blue-600">
            <div className="w-10 h-10 rounded-full border-2 border-blue-200 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm text-blue-400">מאחזר פרטי הזמנה</p>
              <p className="text-lg font-semibold text-blue-900">בודקים את הקישור המאובטח...</p>
            </div>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            אנו מאמתים את הקישור שקיבלת במייל כדי לוודא שהוא עדיין זמין עבורך.
          </p>
        </div>
      );
    }

    if (inviteStatus === 'error') {
      return (
        <div className="p-8 space-y-6 text-right">
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl px-4 py-3" role="alert">
            {inviteError}
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            אם ההזמנה אינה זמינה, פנה למנהל הארגון בבקשה לקבל קישור חדש.
          </p>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-blue-600 to-indigo-500 px-4 py-3 text-base font-semibold text-white shadow-lg transition hover:shadow-xl"
          >
            כניסה למערכת
          </button>
        </div>
      );
    }

    return (
      <form dir="rtl" className="p-8 space-y-6 text-right" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <label htmlFor="invite-email" className="block text-sm font-medium text-slate-600">
            ההזמנה נשלחה ל
          </label>
          <div className="relative">
            <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-400" aria-hidden="true" />
            <input
              id="invite-email"
              type="email"
              value={invitationEmail}
              readOnly
              className="w-full rounded-xl border border-slate-200 px-4 py-3 pr-4 text-right shadow-sm bg-slate-50 focus:outline-none"
            />
          </div>
        </div>

        <p className="text-sm text-slate-600 leading-relaxed">
          הזן כאן סיסמה חדשה כדי לאשר את בעלותך על הכתובת <span className="font-semibold">{invitationEmail}</span> ולהשלים את ההצטרפות לארגון.
        </p>

        {verifyError ? (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl px-4 py-3 space-y-2" role="alert">
            <p>{verifyError}</p>
            {verifyError.includes('שומש') ? (
              <button
                type="button"
                onClick={() => navigate('/forgot-password')}
                className="text-blue-600 hover:text-blue-800 underline text-sm font-medium"
              >
                לחץ כאן לאיפוס סיסמה
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-4">
          <div>
            <label htmlFor="invite-password" className="block text-sm font-medium text-slate-600 text-right">
              צור סיסמה
            </label>
            <div className="relative mt-1">
              <Lock className="w-4 h-4 absolute left-3 top-3 text-slate-400" aria-hidden="true" />
              <input
                id="invite-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 pr-4 text-right shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoComplete="new-password"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="invite-password-confirm" className="block text-sm font-medium text-slate-600 text-right">
              אימות סיסמה
            </label>
            <input
              id="invite-password-confirm"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-right shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoComplete="new-password"
              required
            />
          </div>

          {passwordError ? (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl px-4 py-3" role="alert">
              {passwordError}
            </div>
          ) : null}
        </div>

        <button
          type="submit"
          className="w-full bg-gradient-to-l from-blue-600 to-indigo-500 text-white py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-60"
          disabled={isSubmitting || !authClient || inviteStatus !== 'ready'}
        >
          {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : <ShieldCheck className="w-5 h-5" aria-hidden="true" />}
          <span>{isSubmitting ? 'שומר...' : 'אישור, אימות וסיום'}</span>
        </button>
      </form>
    );
  };

  return (
    <AuthLayout>
      <div className="bg-gradient-to-l from-blue-500 to-indigo-500 p-6 text-right text-white">
        <div className="flex items-center justify-center gap-3">
          <ShieldCheck className="w-10 h-10" />
          <div className="text-center">
            <h1 className="text-2xl font-bold">השלמת הרשמה מאובטחת</h1>
            <p className="text-sm text-blue-100 mt-1">צעד אחרון לפני הצטרפות לארגון</p>
          </div>
        </div>
      </div>
      {renderContent()}
    </AuthLayout>
  );
}
