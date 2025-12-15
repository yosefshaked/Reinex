import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { LogIn, Mail, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  clearStoredSupabaseOAuthError,
  extractSupabaseParams,
  readStoredSupabaseOAuthError,
  removeSupabaseParams,
  splitHash,
} from '@/auth/bootstrapSupabaseCallback.js';
import { useAuth } from '@/auth/AuthContext.jsx';
import AuthLayout from '@/components/layouts/AuthLayout.jsx';

export default function Login() {
  const { status, session, signInWithEmail, signInWithOAuth } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [oauthInFlight, setOauthInFlight] = useState(null);
  const [loginError, setLoginError] = useState(null);
  const location = useLocation();

  // If already authenticated, send users to the dashboard instead of the landing page
  const redirectPath = location.state?.from?.pathname || '/dashboard';
  const redirectMessage = location.state?.message || null;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const {
      location: browserLocation,
      history,
    } = window;
    if (!browserLocation) {
      return;
    }

    const storedPayload = readStoredSupabaseOAuthError();
    const searchExtraction = extractSupabaseParams(browserLocation.search || '');
    const { query: hashQuery } = splitHash(browserLocation.hash || '');
    const hashExtraction = extractSupabaseParams(hashQuery);

    let supabasePayload = storedPayload;
    if (!supabasePayload && searchExtraction.hasSupabaseParams) {
      supabasePayload = searchExtraction.payload;
    }
    if (!supabasePayload && hashExtraction.hasSupabaseParams) {
      supabasePayload = hashExtraction.payload;
    }

    if (!supabasePayload) {
      return;
    }

    const sanitizedSearchParams = removeSupabaseParams(new URLSearchParams(searchExtraction.params));
    const sanitizedHashParams = removeSupabaseParams(new URLSearchParams(hashExtraction.params));

    const remainingParams = new URLSearchParams();
    sanitizedHashParams.forEach((value, key) => {
      remainingParams.append(key, value);
    });
    sanitizedSearchParams.forEach((value, key) => {
      remainingParams.append(key, value);
    });

    const remainingQuery = remainingParams.toString();
    const canonicalHash = `#/login/${remainingQuery ? `?${remainingQuery}` : ''}`;
    const canonicalUrl = browserLocation.origin
      ? `${browserLocation.origin}${browserLocation.pathname}${canonicalHash}`
      : null;

    const hasErrorDetails = Boolean(
      supabasePayload.error
      || supabasePayload.error_code
      || supabasePayload.error_description,
    );

    if (!hasErrorDetails) {
      if (canonicalUrl && typeof history?.replaceState === 'function') {
        history.replaceState({}, document.title, canonicalUrl);
      } else if (typeof browserLocation.hash === 'string') {
        browserLocation.hash = canonicalHash;
      }
      clearStoredSupabaseOAuthError();
      return;
    }

    const friendlyMessages = {
      signup_disabled: 'ארגון זה מאפשר כניסה רק למשתמשים שהוזמנו מראש. ודאו שקיבלתם הזמנה תקפה או פנו למנהל הארגון.',
      access_denied: 'הבקשה נדחתה על ידי ספק ההזדהות. נסו שוב עם משתמש אחר או פנו לתמיכה.',
    };

    const errorCode = supabasePayload.error_code || supabasePayload.error || '';
    const errorDescription = supabasePayload.error_description;
    const normalizedCode = errorCode.toLowerCase();
    const friendlyMessage = friendlyMessages[normalizedCode];
    const fallbackMessage = errorDescription
      || 'התחברות באמצעות ספק זהות חיצוני נכשלה. נסו שוב או פנו למנהל המערכת.';

    setLoginError(friendlyMessage || fallbackMessage);
    setOauthInFlight(null);

    if (canonicalUrl && typeof history?.replaceState === 'function') {
      history.replaceState({}, document.title, canonicalUrl);
    } else if (typeof browserLocation.hash === 'string') {
      browserLocation.hash = canonicalHash;
    }

    clearStoredSupabaseOAuthError();
  }, []);

  if (status === 'ready' && session) {
    return <Navigate to={redirectPath} replace />;
  }

  const handleEmailSignIn = async (event) => {
    event.preventDefault();
    setLoginError(null);
    setIsSubmitting(true);
    try {
      await signInWithEmail(email.trim(), password);
      toast.success('ברוך הבא! מתחבר למערכת...');
    } catch (error) {
      const fallbackMessage = 'פרטי ההתחברות אינם תקינים. בדקו את הדוא"ל והסיסמה ונסו שוב.';
      const message = error?.message?.trim();
      console.error('Email sign-in failed', message || error);
      setLoginError(fallbackMessage);
      toast.error('התחברות בדוא"ל נכשלה. בדקו את הפרטים ונסו שוב.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOAuth = async (provider) => {
    setLoginError(null);
    setOauthInFlight(provider);
    try {
      await signInWithOAuth(provider);
    } catch (error) {
      console.error('OAuth sign-in failed', error);
      toast.error('התחברות נכשלה. נסה שוב או פנה לתמיכה.');
      setOauthInFlight(null);
    }
  };
  return (
    <AuthLayout cardClassName="max-w-xl ">
      <div className="bg-gradient-to-l from-blue-500 to-indigo-500 p-6 text-white">
        <div className="flex items-center justify-center gap-3">
          <ShieldCheck className="w-10 h-10" />
          <div className="text-center">
            <p className="text-sm text-blue-100">תותיעוד • פלטפורמת ניהול עובדים</p>
            <h1 className="text-2xl font-bold">כניסה לחשבון</h1>
          </div>
        </div>
      </div>

      <div className="p-8 space-y-6">
          {redirectMessage ? (
            <div
              className="bg-blue-50 border border-blue-100 text-blue-900 text-right rounded-2xl px-4 py-3 shadow-sm"
              role="alert"
            >
              {redirectMessage}
            </div>
          ) : null}

          <p className="text-sm text-slate-600 text-right leading-relaxed">
            התחבר כדי להמשיך למערכת. ניתן להשתמש בחשבון גוגל, מיקרוסופט או בדוא"ל וסיסמה שסופקו לך על ידי הארגון.
          </p>

          <div className="space-y-3">
            <button
              type="button"
              onClick={() => handleOAuth('google')}
              className="w-full flex items-center justify-center gap-3 bg-white border border-slate-200 hover:border-blue-400 hover:shadow-sm transition-all rounded-xl py-3 font-medium text-slate-700"
              disabled={oauthInFlight !== null}
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
              <span>{oauthInFlight === 'google' ? 'מפנה לגוגל...' : 'התחברות עם Google'}</span>
            </button>

            <button
              type="button"
              onClick={() => handleOAuth('azure')}
              className="w-full flex items-center justify-center gap-3 bg-white border border-slate-200 hover:border-blue-400 hover:shadow-sm transition-all rounded-xl py-3 font-medium text-slate-700"
              disabled={oauthInFlight !== null}
            >
              <img src="https://upload.wikimedia.org/wikipedia/commons/4/44/Microsoft_logo.svg" alt="Microsoft" className="w-5 h-5" />
              <span>{oauthInFlight === 'azure' ? 'מפנה למיקרוסופט...' : 'התחברות עם Microsoft'}</span>
            </button>
          </div>

          <div className="relative flex items-center gap-3 text-slate-400 text-sm">
            <span className="flex-1 h-px bg-slate-200" aria-hidden="true" />
            <span>או</span>
            <span className="flex-1 h-px bg-slate-200" aria-hidden="true" />
          </div>

          <form onSubmit={handleEmailSignIn} className="space-y-4">
            <label className="block text-right">
              <span className="text-sm font-medium text-slate-600">דוא"ל</span>
              <div className="relative mt-1">
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-right shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="name@example.com"
                  autoComplete="email"
                />
                <Mail className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </label>

            <label className="block text-right">
              <span className="text-sm font-medium text-slate-600">סיסמה</span>
              <div className="relative mt-1">
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-right shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>
            </label>

            <div className="flex justify-end">
              <Link
                to="/forgot-password"
                className="text-sm font-semibold text-blue-600 hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 rounded-md px-1"
              >
                שכחת סיסמה?
              </Link>
            </div>

            {loginError ? (
              <div
                className="bg-rose-50 border border-rose-200 text-rose-700 text-right rounded-2xl px-4 py-3 shadow-sm"
                role="alert"
                aria-live="assertive"
              >
                {loginError}
              </div>
            ) : null}

            <button
              type="submit"
              className="w-full bg-gradient-to-l from-blue-600 to-indigo-500 text-white py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2"
              disabled={isSubmitting || oauthInFlight !== null}
            >
              <LogIn className="w-5 h-5" />
              <span>{isSubmitting ? 'מתחבר...' : 'כניסה'}</span>
            </button>
          </form>
      </div>
    </AuthLayout>
  );
}
