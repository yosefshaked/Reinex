import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Building2, LogOut, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { mapSupabaseError } from '@/org/errors.js';
import { buildInvitationSearch } from '@/lib/invite-tokens.js';

function LoadingState() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-4 text-slate-600">
        <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin" aria-hidden="true" />
        <p className="text-sm font-medium">טוען ארגונים...</p>
      </div>
    </div>
  );
}

function EmptyState({ canCreate, onCreate }) {
  return (
    <Card className="max-w-2xl w-full">
      <CardHeader className="space-y-2">
        <CardTitle className="text-2xl font-bold text-slate-900">ברוך הבא!</CardTitle>
        {canCreate ? (
          <p className="text-slate-600 text-sm">
            עדיין אין ארגון המשויך לחשבון שלך. צור ארגון חדש או בקש ממנהל להזמין אותך.
          </p>
        ) : (
          <p className="text-slate-600 text-sm">
            עדיין אין ארגון המשויך לחשבון שלך ואין הזמנה ממתינה. בקש ממנהל ארגון לשלוח לך הזמנה.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {canCreate ? (
          <>
            <Button onClick={onCreate} className="w-full" size="lg">
              <Building2 className="w-4 h-4 ms-2" />
              צור ארגון חדש
            </Button>
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-start gap-3 text-sm text-blue-900" role="status">
              <AlertCircle className="w-4 h-4 mt-0.5" aria-hidden="true" />
              <p>
                לאחר יצירת הארגון ניתן יהיה להגדיר את חיבור ה-Supabase ולצרף מנהלים נוספים מתוך מסך ההגדרות.
              </p>
            </div>
          </>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 text-sm text-amber-900" role="status">
            <AlertCircle className="w-4 h-4 mt-0.5" aria-hidden="true" />
            <p>
              אין לך הרשאה ליצור ארגון חדש. פנה למנהל ארגון ובקש הזמנה לחשבון שלך דרך מסך הניהול.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InviteList({ invites, onAccept }) {
  if (!invites.length) return null;
  return (
    <Card className="w-full max-w-3xl">
      <CardHeader>
        <CardTitle className="text-lg font-semibold text-slate-900">הזמנות ממתינות</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {invites.map((invite) => (
          <div key={invite.id} className="border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <p className="font-medium text-slate-900">{invite.organization?.name || 'ארגון ללא שם'}</p>
              <p className="text-sm text-slate-500">{invite.email}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-blue-700 border-blue-200 bg-blue-50">מוזמן</Badge>
              <Button onClick={() => onAccept(invite)} className="gap-2" size="sm">
                <Users className="w-4 h-4" />
                הצטרף
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function OrganizationList({ organizations, onSelect }) {
  if (!organizations.length) return null;
  return (
    <Card className="w-full max-w-3xl">
      <CardHeader>
        <CardTitle className="text-lg font-semibold text-slate-900">בחר ארגון</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {organizations.map((organization) => (
          <button
            key={organization.id}
            type="button"
            onClick={() => onSelect(organization.id)}
            className="w-full border border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition rounded-xl p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">{organization.name}</p>
                {organization.membership?.role === 'admin' ? (
                  <p className="text-xs text-blue-600 mt-1">מנהל ארגון</p>
                ) : (
                  <p className="text-xs text-slate-500 mt-1">חבר צוות</p>
                )}
              </div>
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

function CreateOrgDialog({ open, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    setError('');
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('יש להזין שם ארגון.');
      return;
    }
    setIsSubmitting(true);
    try {
      await onCreate({ name: trimmedName });
      setName('');
      onClose();
    } catch (submitError) {
      console.error('Failed to create organization', submitError);
      const message = mapSupabaseError(submitError);
      toast.error(message);
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-lg">
        <div className="px-6 py-5 border-b border-slate-200">
          <h2 className="text-xl font-semibold text-slate-900">יצירת ארגון חדש</h2>
          <p className="text-sm text-slate-500 mt-1">
            ניתן להגדיר את חיבור ה-Supabase וההגדרות הנוספות לאחר הכניסה למערכת.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">שם הארגון</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="למשל: מרכז הספורט העירוני"
              autoFocus
            />
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
              ביטול
            </Button>
            <Button type="submit" disabled={isSubmitting || !name.trim()} className="gap-2">
              {isSubmitting ? 'יוצר...' : 'צור ארגון'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function OrgSelection() {
  const {
    organizations,
    incomingInvites,
    status,
    selectOrg,
    createOrganization,
    canCreateOrganizations,
  } = useOrg();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const hasOrganizations = organizations.length > 0;
  const hasInvites = incomingInvites.length > 0;

  const handleSelect = async (orgId) => {
    try {
      await selectOrg(orgId);
      // Always go to dashboard; AuthGuard will redirect to Settings if needed
      navigate('/dashboard', { replace: true });
    } catch (error) {
      console.error('Failed to select organization', error);
      toast.error('בחירת הארגון נכשלה. נסה שוב.');
    }
  };

  const handleAcceptInvite = async (invite) => {
    try {
      const token = invite?.token || '';
      if (!token) {
        toast.error('קישור ההזמנה חסר אסימון. בקש הזמנה חדשה מהארגון.');
        return;
      }
      const search = buildInvitationSearch(token);
      navigate(`/accept-invite${search}`, { replace: true });
    } catch (error) {
      console.error('Failed to open accept invite page', error);
      toast.error('לא ניתן לפתוח את דף ההצטרפות.');
    }
  };

  const handleCreate = async ({ name }) => {
    await createOrganization({ name });
    navigate('/dashboard', { replace: true });
  };

  const handleLogout = async () => {
    try {
      await signOut();
      toast.success('התנתקת בהצלחה');
      navigate('/login', { replace: true });
    } catch (error) {
      console.error('Failed to sign out', error);
      toast.error('התנתקות נכשלה. נסה שוב.');
    }
  };

  if (status === 'loading' || status === 'idle') {
    return <LoadingState />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center px-4 py-10">
      <div className="absolute top-4 start-4">
        <Button variant="ghost" onClick={handleLogout} className="gap-2 text-slate-600 hover:text-slate-900">
          <LogOut className="w-4 h-4" />
          התנתק
        </Button>
      </div>
      <div className="flex flex-col items-center gap-6 w-full">
        <InviteList invites={incomingInvites} onAccept={handleAcceptInvite} />
        <OrganizationList organizations={organizations} onSelect={handleSelect} />
        {!hasOrganizations && !hasInvites ? (
          <EmptyState canCreate={canCreateOrganizations} onCreate={() => setIsCreateOpen(true)} />
        ) : canCreateOrganizations ? (
          <Button variant="outline" onClick={() => setIsCreateOpen(true)} className="gap-2">
            <Building2 className="w-4 h-4" />
            צור ארגון חדש
          </Button>
        ) : null}
      </div>
      <CreateOrgDialog
        open={isCreateOpen && canCreateOrganizations}
        onClose={() => setIsCreateOpen(false)}
        onCreate={handleCreate}
      />
    </div>
  );
}
