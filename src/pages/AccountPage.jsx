import React from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { KeyRound, ShieldAlert, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  const [activeTab, setActiveTab] = React.useState('profile');
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-[linear-gradient(135deg,#f8fbff_0%,#eef4ff_55%,#f9fafb_100%)] px-6 py-6 md:px-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/80 px-3 py-1 text-xs font-medium text-slate-600">
                הגדרות חשבון
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-950 md:text-3xl">
                  ניהול הפרטים האישיים והגישה שלך
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-slate-600 md:text-base">
                  כאן מנהלים את המידע האישי, אבטחת הכניסה ופעולות הגישה של החשבון שלך במקום אחד מסודר.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 md:min-w-[320px]">
              <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3">
                <div className="text-xs font-medium text-slate-500">שם בחשבון</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {account?.displayName || 'טרם הושלם'}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3">
                <div className="text-xs font-medium text-slate-500">מצב גישה</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {account?.accountStatus === 'disabled' ? 'מושבת' : 'פעיל'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="grid gap-6 lg:grid-cols-[240px,minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 px-2">
              <h2 className="text-sm font-semibold text-slate-900">קטגוריות</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                בחר/י תחום אחד כדי להתמקד בו בלי עומס מיותר.
              </p>
            </div>
            <TabsList className="grid h-auto w-full gap-2 bg-transparent p-0">
              <TabsTrigger
                value="profile"
                className="h-auto justify-start rounded-2xl border border-transparent px-4 py-3 text-right data-[state=active]:border-blue-200 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-900"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 rounded-xl bg-slate-100 p-2 text-slate-600 data-[state=active]:bg-blue-100">
                    <UserRound className="h-4 w-4" />
                  </span>
                  <div className="space-y-1">
                    <div className="text-sm font-semibold">פרטים אישיים</div>
                    <div className="text-xs font-normal text-slate-500">שם, זהות וטלפון לחשבון</div>
                  </div>
                </div>
              </TabsTrigger>
              <TabsTrigger
                value="security"
                className="h-auto justify-start rounded-2xl border border-transparent px-4 py-3 text-right data-[state=active]:border-blue-200 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-900"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 rounded-xl bg-slate-100 p-2 text-slate-600">
                    <KeyRound className="h-4 w-4" />
                  </span>
                  <div className="space-y-1">
                    <div className="text-sm font-semibold">אבטחה</div>
                    <div className="text-xs font-normal text-slate-500">שינוי סיסמה ואימות זהות</div>
                  </div>
                </div>
              </TabsTrigger>
              <TabsTrigger
                value="access"
                className="h-auto justify-start rounded-2xl border border-transparent px-4 py-3 text-right data-[state=active]:border-red-200 data-[state=active]:bg-red-50 data-[state=active]:text-red-900"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 rounded-xl bg-red-50 p-2 text-red-600">
                    <ShieldAlert className="h-4 w-4" />
                  </span>
                  <div className="space-y-1">
                    <div className="text-sm font-semibold">גישה וחשבון</div>
                    <div className="text-xs font-normal text-slate-500">השבתה ושליטה בגישה למערכת</div>
                  </div>
                </div>
              </TabsTrigger>
            </TabsList>
          </div>
        </aside>

        <div className="min-w-0">
          <TabsContent value="profile" forceMount className={activeTab === 'profile' ? 'mt-0' : 'hidden'}>
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-5 space-y-1">
                <h2 className="text-xl font-semibold text-slate-950">פרטים אישיים</h2>
                <p className="text-sm text-slate-600">
                  הפרטים האלו משמשים לזיהוי האישי שלך בזרימות ההרשמה, ההזמנות והניהול השוטף.
                </p>
              </div>
              <AccountProfileForm
                account={account}
                onSubmit={handleProfileSubmit}
                heading=""
                description=""
              />
            </section>
          </TabsContent>

          <TabsContent value="security" forceMount className={activeTab === 'security' ? 'mt-0' : 'hidden'}>
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <form onSubmit={handlePasswordSubmit} className="space-y-5">
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold text-slate-950">אבטחת החשבון</h2>
                  <p className="text-sm text-slate-600">
                    שינוי הסיסמה דורש את הסיסמה הנוכחית כדי למנוע עדכונים לא רצויים ממכשיר פתוח.
                  </p>
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
                  <div className="space-y-2 md:col-span-2">
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
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                  מומלץ לבחור סיסמה חדשה ושונה מהסיסמה הנוכחית, ולא להשתמש בסיסמה שכבר שימשה בחשבונות אחרים.
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={isSavingPassword}>
                    {isSavingPassword ? 'שומר...' : 'עדכון סיסמה'}
                  </Button>
                </div>
              </form>
            </section>
          </TabsContent>

          <TabsContent value="access" forceMount className={activeTab === 'access' ? 'mt-0' : 'hidden'}>
            <section className="rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold text-red-700">גישה וחשבון</h2>
                <p className="text-sm text-slate-600">
                  השבתת החשבון חוסמת את הכניסה למערכת עד שתבחר/י להפעיל אותו מחדש. הסיבה נרשמת ביומן הביקורת בלבד.
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
              <div className="mt-5 rounded-2xl border border-red-100 bg-red-50/60 px-4 py-4 text-sm text-red-900">
                הפעולה מיועדת למקרים שבהם ברצונך לעצור את הגישה לחשבון שלך. היא אינה מוחקת מידע ארגוני קיים.
              </div>
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
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
