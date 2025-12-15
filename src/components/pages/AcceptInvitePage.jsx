import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  Home,
  Loader2,
  LogOut,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthContext.jsx';
import { acceptInvitation, declineInvitation, getInvitationByToken } from '@/api/invitations.js';
import { buildInvitationSearch, extractRegistrationTokens } from '@/lib/invite-tokens.js';
import { useOrg } from '@/org/OrgContext.jsx';

const STATUS_LOADING = 'loading';
const STATUS_ERROR = 'error';
const STATUS_READY = 'ready';

const FINALIZED_STATUSES = new Set(['revoked', 'declined', 'expired', 'failed']);

export default function AcceptInvitePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { status: authStatus, session, user, signOut } = useAuth();
  const { refreshOrganizations, selectOrg } = useOrg();

  const { invitationTokenKey, invitationTokenValue } = useMemo(
    () => extractRegistrationTokens(location.search),
    [location.search],
  );

  const [status, setStatus] = useState(STATUS_LOADING);
  const [invitation, setInvitation] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionState, setActionState] = useState('idle');
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!invitationTokenValue) {
      setStatus(STATUS_ERROR);
      setLoadError('קישור ההזמנה חסר אסימון זיהוי. בקש הזמנה חדשה מהארגון.');
      return;
    }

    const controller = new AbortController();
    let isActive = true;

    setStatus(STATUS_LOADING);
    setLoadError('');

    getInvitationByToken(invitationTokenValue, { signal: controller.signal })
      .then((record) => {
        if (!isActive) {
          return;
        }
        setInvitation(record);
        setStatus(STATUS_READY);
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }
        console.error('Failed to load invitation by token', error);
        const message = error?.message || 'טעינת ההזמנה נכשלה. נסה שוב מאוחר יותר.';
        setLoadError(message);
        setStatus(STATUS_ERROR);
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [invitationTokenValue]);

  useEffect(() => {
    if (authStatus !== 'ready') {
      return;
    }
    if (session) {
      return;
    }
    const search = buildInvitationSearch(invitationTokenValue, invitationTokenKey);
    navigate(`/login${search}`, {
      replace: true,
      state: {
        from: { pathname: '/accept-invite', search },
        message: 'התחבר כדי לאשר את ההזמנה לארגון.',
      },
    });
  }, [authStatus, session, invitationTokenKey, invitationTokenValue, navigate]);

  const invitationEmail = invitation?.email || '';
  const normalizedInvitationEmail = invitationEmail.toLowerCase();
  const activeEmail = session?.user?.email ? session.user.email.toLowerCase() : '';
  const emailMatches = Boolean(session && normalizedInvitationEmail && normalizedInvitationEmail === activeEmail);
  const organizationName = invitation?.orgName || 'ארגון חדש';

  const handleAccept = async () => {
    if (!session || !invitation || invitation.status !== 'pending') {
      setActionError('ההזמנה אינה זמינה לאישור. רענן את הדף או בקש הזמנה חדשה.');
      return;
    }

    setActionError('');
    setActionState('accepting');
    try {
      await acceptInvitation(invitation.id, { session });
      const newOrgId = invitation?.orgId || null;
      try {
        await refreshOrganizations();
        if (newOrgId) {
          await selectOrg(newOrgId);
        }
      } catch (refreshError) {
        console.error('Failed to refresh organizations after accepting invite', refreshError);
      }
      setInvitation((previous) => (previous ? { ...previous, status: 'accepted' } : previous));
    } catch (error) {
      console.error('Failed to accept invitation', error);
      setActionError(error?.message || 'אישור ההזמנה נכשל. נסה שוב מאוחר יותר.');
    } finally {
      setActionState('idle');
    }
  };

  const handleDecline = async () => {
    if (!session || !invitation || invitation.status !== 'pending') {
      setActionError('ההזמנה אינה זמינה לדחייה. רענן את הדף או בקש הזמנה חדשה.');
      return;
    }

    setActionError('');
    setActionState('declining');
    try {
      await declineInvitation(invitation.id, { session });
      setInvitation((previous) => (previous ? { ...previous, status: 'declined' } : previous));
    } catch (error) {
      console.error('Failed to decline invitation', error);
      setActionError(error?.message || 'דחיית ההזמנה נכשלה. נסה שוב מאוחר יותר.');
    } finally {
      setActionState('idle');
    }
  };

  const handleSignOut = async () => {
    setActionError('');
    setSigningOut(true);
    try {
      await signOut();
      const search = buildInvitationSearch(invitationTokenValue, invitationTokenKey);
      navigate(`/login${search}`, {
        replace: true,
        state: {
          from: { pathname: '/accept-invite', search },
          message: 'התנתקת בהצלחה. התחבר עם החשבון המתאים להזמנה.',
        },
      });
    } catch (error) {
      console.error('Failed to sign out for invitation mismatch', error);
      setActionError('התנתקות נכשלה. נסה שוב או רענן את הדף.');
    } finally {
      setSigningOut(false);
    }
  };

  const handleGoToDashboard = () => {
    navigate('/dashboard', { replace: true });
  };

  const renderLoading = () => (
    <div className="p-8 space-y-6 text-right">
      <div className="flex items-center justify-end gap-3 text-blue-600">
        <div className="w-10 h-10 rounded-full border-2 border-blue-200 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm text-blue-400">טוען את פרטי ההזמנה</p>
          <p className="text-lg font-semibold text-blue-900">בודקים את החיבור...</p>
        </div>
      </div>
      <p className="text-sm text-slate-600 leading-relaxed">
        אנו מאמתים שהקישור שקיבלת עדיין פעיל ומציגים את פרטי הארגון שאליו הוזמנת.
      </p>
    </div>
  );

  const renderError = () => (
    <div className="p-8 space-y-6 text-right">
      <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl px-4 py-3" role="alert">
        {loadError}
      </div>
      <p className="text-sm text-slate-600 leading-relaxed">
        אם הבעיה נמשכת, פנה למנהל הארגון כדי לקבל קישור הזמנה חדש.
      </p>
    </div>
  );

  const renderMismatch = () => (
    <div className="p-8 space-y-6 text-right">
      <div className="bg-yellow-50 border border-yellow-200 text-yellow-900 rounded-2xl px-4 py-3 flex items-start gap-3" role="alert">
        <AlertCircle className="w-5 h-5 mt-0.5" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-semibold">כתובת האימייל אינה תואמת להזמנה</p>
          <p className="text-sm leading-relaxed">
            ההזמנה נשלחה לכתובת <span className="font-medium">{invitation?.email}</span>, אך את/ה מחובר/ת כעת עם {session?.user?.email}. התנתק/י והתחבר/י עם החשבון המתאים כדי להמשיך.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={handleSignOut}
        className="w-full bg-white border border-slate-200 text-slate-700 py-3 rounded-xl font-semibold shadow-sm hover:shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-60"
        disabled={signingOut}
      >
        <LogOut className="w-5 h-5" />
        <span>{signingOut ? 'מתנתק...' : 'התנתקות והחלפת חשבון'}</span>
      </button>
    </div>
  );

  const renderPending = () => (
    <div className="p-8 space-y-6 text-right">
      <div className="space-y-2">
        <p className="text-sm text-blue-500 font-medium">{organizationName}</p>
        <h2 className="text-2xl font-bold text-slate-900">ברוך הבא{user?.name ? `, ${user.name}` : ''}!</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          באמצעות אישור ההזמנה תזכה לגישה מלאה למשאבי הארגון. אם אינך מצפה להזמנה הזו, ניתן לדחות אותה.
        </p>
      </div>
      {actionError ? (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl px-4 py-3" role="alert">
          {actionError}
        </div>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={handleAccept}
          className="w-full bg-gradient-to-l from-blue-600 to-indigo-500 text-white py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-60"
          disabled={actionState !== 'idle'}
        >
          <Check className="w-5 h-5" />
          <span>{actionState === 'accepting' ? 'מאשר...' : 'אישור הצטרפות'}</span>
        </button>
        <button
          type="button"
          onClick={handleDecline}
          className="w-full bg-white border border-slate-200 text-slate-700 py-3 rounded-xl font-semibold shadow-sm hover:shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-60"
          disabled={actionState !== 'idle'}
        >
          <XCircle className="w-5 h-5" />
          <span>{actionState === 'declining' ? 'דוחה...' : 'דחיית הזמנה'}</span>
        </button>
      </div>
    </div>
  );

  const renderAccepted = () => (
    <div className="p-8 space-y-6 text-right">
      <div className="flex items-center justify-end gap-3 text-green-600">
        <CheckCircle2 className="w-8 h-8" aria-hidden="true" />
        <div>
          <p className="text-lg font-bold text-slate-900">את/ה כבר חבר/ה בארגון</p>
          <p className="text-sm text-slate-600 leading-relaxed">
            סיימנו לעדכן את החברות שלך. תוכל להמשיך ללוח הבקרה כדי להתחיל לעבוד.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={handleGoToDashboard}
        className="w-full bg-gradient-to-l from-blue-600 to-indigo-500 text-white py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2"
      >
        <Home className="w-5 h-5" />
        <span>מעבר ללוח הבקרה</span>
      </button>
    </div>
  );

  const renderInvalid = () => (
    <div className="p-8 space-y-6 text-right">
      <div className="bg-slate-100 border border-slate-200 text-slate-700 rounded-2xl px-4 py-3 flex items-start gap-3" role="status">
        <AlertCircle className="w-5 h-5 mt-0.5" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-semibold">ההזמנה אינה זמינה</p>
          <p className="text-sm leading-relaxed">
            ההזמנה הזו כבר עובדה או בוטלה ולכן לא ניתן להשתמש בה. בקש מהמנהל לשלוח קישור חדש במידת הצורך.
          </p>
        </div>
      </div>
    </div>
  );

  const renderContent = () => {
    if (status === STATUS_LOADING || authStatus !== 'ready') {
      return renderLoading();
    }

    if (status === STATUS_ERROR) {
      return renderError();
    }

    if (!session) {
      return renderLoading();
    }

    if (!invitation) {
      return renderError();
    }

    if (invitation.status === 'accepted') {
      return renderAccepted();
    }

    if (FINALIZED_STATUSES.has(invitation.status) && invitation.status !== 'pending' && invitation.status !== 'accepted') {
      return renderInvalid();
    }

    if (!emailMatches) {
      return renderMismatch();
    }

    return renderPending();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-50 to-slate-200 flex items-center justify-center px-4 py-12" dir="rtl">
      <div className="max-w-2xl w-full bg-white shadow-xl rounded-3xl overflow-hidden border border-slate-100">
        <div className="bg-gradient-to-l from-blue-500 to-indigo-500 p-6 text-right text-white">
          <div className="flex items-center justify-center gap-3">
            <ShieldCheck className="w-10 h-10" />
            <div className="text-center">
              <h1 className="text-2xl font-bold">אישור הצטרפות לארגון</h1>
              <p className="text-sm text-blue-100 mt-1 flex items-center gap-1 justify-end">
                <Building2 className="w-4 h-4" />
                <span>{organizationName}</span>
              </p>
            </div>
          </div>
        </div>
        {renderContent()}
      </div>
    </div>
  );
}
