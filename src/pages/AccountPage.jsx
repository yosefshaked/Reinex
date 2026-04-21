import React from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import AccountProfileForm from '@/features/account/components/AccountProfileForm.jsx';
import { useAccount } from '@/account/AccountContext.jsx';
import { useAuth } from '@/auth/AuthContext.jsx';

const REASON_OPTIONS = [
  { value: 'privacy_concern', label: 'שיקולי פרטיות' },
  { value: 'no_longer_using', label: 'כבר לא משתמש/ת במערכת' },
  { value: 'duplicate_account', label: 'יש לי חשבון כפול' },
  { value: 'temporary_break', label: 'הפסקה זמנית' },
  { value: 'other', label: 'אחר' },
];

export default function AccountPage() {
  const navigate = useNavigate();
  const { account, saveAccount, deactivateAccount } = useAccount();
  const { updatePassword, signOut } = useAuth();
  const [passwordForm, setPasswordForm] = React.useState({
    currentPassword: '',
    password: '',
    confirmPassword: '',
  });
  const [passwordError, setPasswordError] = React.useState('');
  const [isSavingPassword, setIsSavingPassword] = React.useState(false);
  const [reasonCode, setReasonCode] = React.useState(REASON_OPTIONS[0].value);
  const [reasonText, setReasonText] = React.useState('');
  const [isDeactivating, setIsDeactivating] = React.useState(false);
  const [deactivationError, setDeactivationError] = React.useState('');

  const handleProfileSubmit = async (payload) => {
    await saveAccount(payload);
    toast.success('הפרטים נשמרו');
  };

  const handlePasswordSubmit = async (event) => {
    event.preventDefault();
    setPasswordError('');
    if (!passwordForm.currentPassword) {
      setPasswordError('יש להזין את הסיסמה הנוכחית.');
      return;
    }
    if (passwordForm.password.length < 6) {
      setPasswordError('הסיסמה חייבת להכיל לפחות 6 תווים.');
      return;
    }
    if (passwordForm.password !== passwordForm.confirmPassword) {
      setPasswordError('הסיסמאות אינן תואמות.');
      return;
    }

    setIsSavingPassword(true);
    try {
      await updatePassword(passwordForm.password, {
        currentPassword: passwordForm.currentPassword,
      });
      setPasswordForm({ currentPassword: '', password: '', confirmPassword: '' });
      toast.success('הסיסמה עודכנה');
    } catch (error) {
      console.error('Failed to update password', error);
      const message = error?.message === 'same_password'
        ? 'הסיסמה החדשה חייבת להיות שונה מהסיסמה הנוכחית.'
        : error?.message === 'invalid_credentials'
          ? 'הסיסמה הנוכחית שגויה.'
          : error?.message || 'עדכון הסיסמה נכשל.';
      setPasswordError(message);
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleDeactivate = async () => {
    setDeactivationError('');
    setIsDeactivating(true);
    try {
      await deactivateAccount({
        reason_code: reasonCode,
        reason_text: reasonCode === 'other' ? reasonText : '',
      });
      await signOut();
      navigate('/login', {
        replace: true,
        state: {
          message: 'החשבון הושבת. אפשר להתחבר שוב בכל עת כדי להפעיל אותו מחדש.',
        },
      });
    } catch (error) {
      console.error('Failed to deactivate account', error);
      const message = error?.message === 'last_owner_cannot_self_deactivate'
        ? 'לא ניתן להשבית את החשבון כל עוד זהו הבעלים האחרון של אחד הארגונים.'
        : error?.message === 'system_admin_cannot_self_deactivate'
          ? 'חשבון מערכת אינו יכול להשבית את עצמו.'
          : error?.message || 'השבתת החשבון נכשלה.';
      setDeactivationError(message);
    } finally {
      setIsDeactivating(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <AccountProfileForm
          account={account}
          onSubmit={handleProfileSubmit}
          heading="הגדרות אישיות"
          description="הפרטים נשמרים בחשבון המשתמש שלך ומשמשים בכל זרימות המערכת שדורשות זיהוי אישי."
        />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <form onSubmit={handlePasswordSubmit} className="space-y-5">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-900">שינוי סיסמה</h2>
            <p className="text-sm text-slate-600">אפשר לעדכן את סיסמת הכניסה שלך בכל רגע.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="account-password-current">סיסמה נוכחית</Label>
              <Input
                id="account-password-current"
                type="password"
                value={passwordForm.currentPassword}
                onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-password">סיסמה חדשה</Label>
              <Input
                id="account-password"
                type="password"
                value={passwordForm.password}
                onChange={(event) => setPasswordForm((current) => ({ ...current, password: event.target.value }))}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-password-confirm">אימות סיסמה</Label>
              <Input
                id="account-password-confirm"
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                dir="ltr"
              />
            </div>
          </div>
          {passwordError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {passwordError}
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={isSavingPassword}>
              {isSavingPassword ? 'שומר...' : 'עדכון סיסמה'}
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-red-700">השבתת חשבון</h2>
          <p className="text-sm text-slate-600">
            ההשבתה חוסמת את הגישה למערכת עד שתבחר/י להפעיל את החשבון מחדש.
          </p>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-[240px,1fr]">
          <div className="space-y-2">
            <Label htmlFor="account-deactivation-reason">סיבת השבתה</Label>
            <select
              id="account-deactivation-reason"
              value={reasonCode}
              onChange={(event) => setReasonCode(event.target.value)}
              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
            >
              {REASON_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-deactivation-note">פירוט נוסף</Label>
            <textarea
              id="account-deactivation-note"
              value={reasonText}
              onChange={(event) => setReasonText(event.target.value)}
              className="min-h-[96px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="אפשר להוסיף הסבר קצר, במיוחד אם בחרת 'אחר'."
              disabled={reasonCode !== 'other'}
            />
          </div>
        </div>
        {deactivationError ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {deactivationError}
          </div>
        ) : null}
        <div className="mt-5 flex justify-end">
          <Button
            type="button"
            variant="destructive"
            disabled={isDeactivating || (reasonCode === 'other' && !reasonText.trim())}
            onClick={handleDeactivate}
          >
            {isDeactivating ? 'משבית...' : 'השבתת החשבון'}
          </Button>
        </div>
      </section>
    </div>
  );
}
