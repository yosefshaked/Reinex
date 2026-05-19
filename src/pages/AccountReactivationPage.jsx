import React from 'react';
import { useNavigate } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAccount } from '@/account/AccountContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';

function resolveDestination(activeOrgId, needsSetup) {
  if (needsSetup) {
    return '/account/setup';
  }
  return activeOrgId ? '/dashboard' : '/select-org';
}

export default function AccountReactivationPage() {
  const navigate = useNavigate();
  const { account, isDisabled, reactivateAccount } = useAccount();
  const { activeOrgId } = useOrg();
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!isDisabled) {
      navigate(resolveDestination(activeOrgId, Boolean(account?.needsSetup)), { replace: true });
    }
  }, [isDisabled, navigate, activeOrgId, account?.needsSetup]);

  const handleReactivate = async () => {
    setIsSubmitting(true);
    setError('');
    try {
      const nextAccount = await reactivateAccount();
      toast.success('החשבון הופעל מחדש');
      navigate(resolveDestination(activeOrgId, Boolean(nextAccount?.needsSetup)), { replace: true });
    } catch (reactivationError) {
      console.error('Failed to reactivate account', reactivationError);
      setError(reactivationError?.message || 'הפעלה מחדש נכשלה.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-xl text-end space-y-5">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-slate-900">החשבון מושבת</h1>
          <p className="text-sm text-slate-600 leading-7">
            החשבון שלך הושבת על ידך. כדי לחזור למערכת אפשר להפעיל אותו מחדש בלחיצה אחת.
          </p>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {error}
          </div>
        ) : null}

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
          <div>משתמש: <span className="font-medium">{account?.displayName || account?.email || '—'}</span></div>
          <div className="mt-1">אימייל: <span dir="ltr">{account?.email || '—'}</span></div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleReactivate} disabled={isSubmitting} className="gap-2">
            <RotateCcw className="h-4 w-4" />
            {isSubmitting ? 'מפעיל...' : 'הפעלת החשבון מחדש'}
          </Button>
        </div>
      </div>
    </div>
  );
}
