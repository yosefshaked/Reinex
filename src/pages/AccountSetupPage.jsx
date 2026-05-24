import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from '@/lib/toast.jsx';
import { useAccount } from '@/account/AccountContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import AccountProfileForm from '@/features/account/components/AccountProfileForm.jsx';

function resolveFallbackPath(activeOrgId) {
  return activeOrgId ? '/dashboard' : '/select-org';
}

export default function AccountSetupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { account, saveAccount, needsSetup, status } = useAccount();
  const { activeOrgId } = useOrg();

  const returnTo = searchParams.get('returnTo') || resolveFallbackPath(activeOrgId);

  React.useEffect(() => {
    if (status === 'ready' && !needsSetup) {
      navigate(returnTo, { replace: true });
    }
  }, [status, needsSetup, navigate, returnTo]);

  const handleSubmit = async (payload) => {
    await saveAccount(payload);
    toast.success('הפרטים נשמרו בהצלחה');
    navigate(returnTo, { replace: true });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
        <AccountProfileForm
          account={account}
          onSubmit={handleSubmit}
          submitLabel="שמירה והמשך"
          heading="השלמת פרטים אישיים"
          description="לפני שממשיכים, יש להשלים את פרטי המשתמש האישיים שלך. המידע נשמר בחשבון ומשמש את המערכת בכל הארגונים שלך."
          disabled={status === 'loading'}
        />
      </div>
    </div>
  );
}
