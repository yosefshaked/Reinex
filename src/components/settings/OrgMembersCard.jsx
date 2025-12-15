import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Check, Clock, MailPlus, Pencil, RefreshCw, Trash2, UserMinus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useOrg } from '@/org/OrgContext.jsx';
import { useAuth } from '@/auth/AuthContext.jsx';
import { createInvitation, listPendingInvitations, revokeInvitation as revokeInvitationRequest } from '@/api/invitations.js';
import { checkAuthByEmail } from '@/api/check-auth.js';

function formatDate(isoString) {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('he-IL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return isoString;
  }
}

function isInvitationExpired(expiresAt) {
  if (!expiresAt) return false;
  try {
    const expiryDate = new Date(expiresAt);
    return expiryDate.getTime() <= Date.now();
  } catch {
    return false;
  }
}

export default function OrgMembersCard() {
  const { activeOrg, members, removeMember, updateMemberRole, updateMemberName } = useOrg();
  const { user, session } = useAuth();
  const [email, setEmail] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [isInvitesLoading, setIsInvitesLoading] = useState(false);
  const [invitesError, setInvitesError] = useState(null);
  const [revokingId, setRevokingId] = useState(null);
  const [reinvitingEmail, setReinvitingEmail] = useState(null);
  const [authStates, setAuthStates] = useState({});
  const [loadingAuthFor, setLoadingAuthFor] = useState(new Set());
  const [editingMemberId, setEditingMemberId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [savingMemberId, setSavingMemberId] = useState(null);
  const activeOrgId = activeOrg?.id || null;
  const role = activeOrg?.membership?.role || '';
  const canManageOrgMembers = useMemo(() => {
    if (typeof role !== 'string') {
      return false;
    }
    const normalizedRole = role.toLowerCase();
    return normalizedRole === 'admin' || normalizedRole === 'owner';
  }, [role]);

  const refreshInvitations = useCallback(
    async ({ signal, suppressToast } = {}) => {
      if (!canManageOrgMembers || !activeOrgId) {
        setPendingInvites([]);
        setInvitesError(null);
        return;
      }
      if (!session) {
        setInvitesError('נדרש חיבור כדי לטעון הזמנות.');
        return;
      }

      setIsInvitesLoading(true);
      setInvitesError(null);
      try {
        const invitations = await listPendingInvitations(activeOrgId, { session, signal });
        if (!signal?.aborted) {
          setPendingInvites(invitations);
        }
      } catch (error) {
        if (error?.name === 'AbortError') {
          return;
        }
        const message = error?.message || 'טעינת ההזמנות נכשלה. נסה שוב.';
        if (!signal?.aborted) {
          setInvitesError(message);
          if (!suppressToast) {
            toast.error(message);
          }
        }
      } finally {
        if (!signal?.aborted) {
          setIsInvitesLoading(false);
        }
      }
    },
    [activeOrgId, canManageOrgMembers, session],
  );

  useEffect(() => {
    const controller = new AbortController();
    refreshInvitations({ signal: controller.signal, suppressToast: true });
    return () => {
      controller.abort();
    };
  }, [refreshInvitations]);

  const expiredInvitesCount = useMemo(() => {
    return pendingInvites.filter((invite) => isInvitationExpired(invite.expiresAt || invite.expires_at)).length;
  }, [pendingInvites]);

  const handleInvite = async (event) => {
    event.preventDefault();
    if (!canManageOrgMembers || !email.trim()) return;
    if (!session) {
      toast.error('נדרש חיבור לחשבון כדי לשלוח הזמנה.');
      return;
    }

    setIsInviting(true);
    try {
      const result = await createInvitation(activeOrgId, email.trim(), { session });
      if (result?.userExists) {
        toast.success('ההזמנה נוצרה בהצלחה. למשתמש זה כבר קיים חשבון, והוא יכול להתחבר כדי לאשר את ההזמנה.');
      } else {
        toast.success('ההזמנה נשלחה בהצלחה.');
      }
      setEmail('');
      await refreshInvitations({ suppressToast: true });
    } catch (error) {
      console.error('Failed to send invitation', error);
      if (error?.code === 'user already a member') {
        toast.error('לא נשלחה הזמנה. המשתמש כבר חבר בארגון.');
      } else if (error?.code === 'invitation already pending') {
        toast.error('כבר קיימת הזמנה בתוקף למשתמש זה.');
      } else {
        toast.error(error?.message || 'שליחת ההזמנה נכשלה. ודא שהכתובת תקינה ונסה שוב.');
      }
    } finally {
      setIsInviting(false);
    }
  };

  const handleRevoke = async (inviteId) => {
    if (!inviteId || !session) {
      toast.error('לא ניתן לבטל הזמנה ללא התחברות.');
      return;
    }
    setRevokingId(inviteId);
    try {
      await revokeInvitationRequest(inviteId, { session });
      toast.success('ההזמנה בוטלה.');
      await refreshInvitations({ suppressToast: true });
    } catch (error) {
      console.error('Failed to revoke invite', error);
      toast.error(error?.message || 'לא ניתן לבטל את ההזמנה. נסה שוב.');
    } finally {
      setRevokingId(null);
    }
  };

  const handleReinvite = async (email) => {
    if (!email || !session) {
      toast.error('לא ניתן לשלוח הזמנה ללא התחברות.');
      return;
    }
    setReinvitingEmail(email);
    try {
      const result = await createInvitation(activeOrgId, email, { session });
      if (result?.userExists) {
        toast.success('הזמנה חדשה נוצרה בהצלחה. למשתמש זה כבר קיים חשבון.');
      } else {
        toast.success('הזמנה חדשה נשלחה בהצלחה.');
      }
      await refreshInvitations({ suppressToast: true });
    } catch (error) {
      console.error('Failed to resend invitation', error);
      if (error?.code === 'invitation already pending' || error?.data?.message === 'invitation already pending') {
        toast.error('ההזמנה עדיין תקפה. לא ניתן לשלוח הזמנה נוספת.');
      } else if (error?.code === 'user already a member' || error?.data?.message === 'user already a member') {
        toast.error('לא נשלחה הזמנה. המשתמש כבר חבר בארגון.');
      } else {
        toast.error(error?.message || 'שליחת ההזמנה החדשה נכשלה. נסה שוב.');
      }
    } finally {
      setReinvitingEmail(null);
    }
  };

  const loadAuthStateForEmail = useCallback(async (email) => {
    if (!email || !session || !canManageOrgMembers) return;
    if (authStates[email] || loadingAuthFor.has(email)) return;

    setLoadingAuthFor((prev) => new Set(prev).add(email));
    try {
      const result = await checkAuthByEmail(email, { session });
      setAuthStates((prev) => ({
        ...prev,
        [email]: result.auth,
      }));
    } catch (error) {
      console.error('Failed to load auth state for', email, error);
      // Silently fail - auth badges are optional enhancement
    } finally {
      setLoadingAuthFor((prev) => {
        const next = new Set(prev);
        next.delete(email);
        return next;
      });
    }
  }, [session, canManageOrgMembers, authStates, loadingAuthFor]);

  useEffect(() => {
    if (!canManageOrgMembers || !session || !pendingInvites.length) return;
    const controller = new AbortController();
    pendingInvites.forEach((invite) => {
      if (invite.email) {
        loadAuthStateForEmail(invite.email);
      }
    });
    return () => controller.abort();
  }, [pendingInvites, canManageOrgMembers, session, loadAuthStateForEmail]);

  useEffect(() => {
    if (!editingMemberId) return;
    const stillExists = (members || []).some((member) => member.id === editingMemberId);
    if (!stillExists) {
      setEditingMemberId(null);
      setEditingName('');
      setSavingMemberId(null);
    }
  }, [editingMemberId, members]);

  const handleRemoveMember = async (membershipId) => {
    try {
      await removeMember(membershipId);
      toast.success('החבר הוסר מהארגון.');
    } catch (error) {
      console.error('Failed to remove member', error);
      toast.error('הסרת החבר נכשלה.');
    }
  };

  const handleEditNameStart = useCallback(
    (member) => {
      setEditingMemberId(member.id);
      setEditingName(member.name || member.email || '');
    },
    [],
  );

  const handleEditNameCancel = useCallback(() => {
    setEditingMemberId(null);
    setEditingName('');
    setSavingMemberId(null);
  }, []);

  const handleEditNameSave = useCallback(
    async (member) => {
      if (!member?.id) return;
      const trimmed = editingName.replace(/\s+/g, ' ').trim();
      if (!trimmed) {
        toast.error('נא להזין שם מלא תקין.');
        return;
      }
      setSavingMemberId(member.id);
      try {
        await updateMemberName(member.id, trimmed);
        toast.success('שם החבר עודכן בהצלחה.');
        setEditingMemberId(null);
        setEditingName('');
      } catch (error) {
        console.error('Failed to update member name', error);
        toast.error(error?.message || 'עדכון השם נכשל.');
      } finally {
        setSavingMemberId(null);
      }
    },
    [editingName, updateMemberName],
  );

  if (!activeOrg) {
    return null;
  }

  return (
    <Card className="border-0 shadow-xl bg-white/90" dir="rtl">
      <CardHeader className="border-b border-slate-200">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <CardTitle className="text-xl font-semibold text-slate-900">חברי ארגון</CardTitle>
            <p className="text-sm text-slate-600 mt-2">
              כל המשתמשים בארגון חולקים את אותו חיבור Supabase. מנהלים יכולים להזמין ולנהל חברים נוספים.
            </p>
          </div>
          {canManageOrgMembers && expiredInvitesCount > 0 ? (
            <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-100 gap-1 whitespace-nowrap">
              <Clock className="w-3 h-3" />
              {expiredInvitesCount} הזמנות פגות
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">חברים פעילים</h3>
          <div className="space-y-3">
            {(members || []).map((member) => {
              const isCurrentUser = member.user_id === user?.id;
              const roleNorm = typeof member.role === 'string' ? member.role.toLowerCase() : '';
              const isOwner = roleNorm === 'owner';
              const roleLabel = roleNorm === 'owner' ? 'בעלים' : roleNorm === 'admin' ? 'מנהל' : 'מדריך';
              const isEditing = editingMemberId === member.id;
              const isSaving = savingMemberId === member.id;
              return (
                <div
                  key={member.id || member.user_id}
                  className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border border-slate-200 rounded-xl px-4 py-3"
                >
                  <div className="text-right space-y-2 flex-1">
                    {isEditing ? (
                      <div className="space-y-1">
                        <label htmlFor={`member-name-${member.id}`} className="sr-only">
                          שם החבר
                        </label>
                        <Input
                          id={`member-name-${member.id}`}
                          value={editingName}
                          onChange={(event) => setEditingName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void handleEditNameSave(member);
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              handleEditNameCancel();
                            }
                          }}
                          autoFocus
                        />
                        <p className="text-xs text-slate-500">יש להזין שם עם לפחות תו אחד.</p>
                      </div>
                    ) : (
                      <p className="text-sm font-medium text-slate-900">
                        {member.name || member.email || 'משתמש ללא שם'}
                      </p>
                    )}
                    <p className="text-xs text-slate-500" dir="ltr">
                      {member.email || member.user_id}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>הצטרף: {formatDate(member.joined_at)}</span>
                      {member.role ? (
                        <Badge variant="outline" className="text-blue-700 border-blue-200 bg-blue-50">
                          {roleLabel}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {canManageOrgMembers ? (
                    <div className="flex items-center gap-3">
                      {isEditing ? (
                        <>
                          <Button
                            type="button"
                            className="gap-2"
                            disabled={isSaving}
                            onClick={() => handleEditNameSave(member)}
                          >
                            {isSaving ? 'שומר...' : (
                              <>
                                <Check className="w-4 h-4" />
                                שמור
                              </>
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="text-slate-600 hover:bg-slate-100 gap-2"
                            onClick={handleEditNameCancel}
                            disabled={isSaving}
                          >
                            <X className="w-4 h-4" />
                            בטל
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          className="text-slate-600 hover:bg-slate-100 gap-2"
                          onClick={() => handleEditNameStart(member)}
                        >
                          <Pencil className="w-4 h-4" />
                          ערוך שם
                        </Button>
                      )}
                      <Select
                        value={roleNorm || 'member'}
                        disabled={isOwner || isCurrentUser || isSaving}
                        onValueChange={async (nextRole) => {
                          const nextLabel = nextRole === 'admin' ? 'מנהל' : 'מדריך';
                          const confirmed = window.confirm(`האם לשנות את התפקיד של ${member.name || member.email || 'המשתמש'} ל"${nextLabel}"?`);
                          if (!confirmed) {
                            return;
                          }
                          try {
                            await updateMemberRole(member.id, nextRole);
                            toast.success('תפקיד עודכן');
                          } catch (error) {
                            console.error('Failed to update role', error);
                            toast.error(error?.message || 'עדכון התפקיד נכשל');
                          }
                        }}
                      >
                        <SelectTrigger className="h-auto rounded-md px-2 py-1 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">מדריך</SelectItem>
                          <SelectItem value="admin">מנהל</SelectItem>
                        </SelectContent>
                      </Select>
                      {!isCurrentUser ? (
                        <Button
                          type="button"
                          variant="ghost"
                          className="text-red-600 hover:bg-red-50 gap-2"
                          disabled={isOwner || isSaving}
                          onClick={() => {
                            const confirmed = window.confirm(`האם להסיר את ${member.name || member.email || 'המשתמש'} מהארגון?`);
                            if (!confirmed) return;
                            void handleRemoveMember(member.id);
                          }}
                        >
                          <UserMinus className="w-4 h-4" />
                          הסר מהארגון
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!members?.length ? (
              <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" role="status">
                <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                <span>עדיין לא נוספו חברים נוספים לארגון.</span>
              </div>
            ) : null}
          </div>
        </section>

        {canManageOrgMembers ? (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">הזמן חבר חדש</h3>
            <form className="flex flex-col md:flex-row gap-3" onSubmit={handleInvite}>
              <div className="flex-1">
                <label htmlFor="invite-email" className="sr-only">אימייל להזמנה</label>
                <Input
                  id="invite-email"
                  type="email"
                  dir="ltr"
                  className="w-full"
                  placeholder="manager@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="gap-2" disabled={isInviting}>
                {isInviting ? 'שולח...' : (
                  <>
                    <MailPlus className="w-4 h-4" />
                    שלח הזמנה
                  </>
                )}
              </Button>
            </form>
          </section>
        ) : null}

        {canManageOrgMembers ? (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">הזמנות ממתינות</h3>
            <div className="space-y-3">
              {isInvitesLoading ? (
                <p className="text-xs text-slate-500" role="status">טוען הזמנות...</p>
              ) : invitesError ? (
                <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2" role="alert">
                  <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                  <span>{invitesError}</span>
                </div>
              ) : pendingInvites?.length ? (
                pendingInvites.map((invite) => {
                  const expired = isInvitationExpired(invite.expiresAt || invite.expires_at);
                  return (
                    <div
                      key={invite.id}
                      className={`flex flex-col md:flex-row md:items-center md:justify-between gap-3 border rounded-xl px-4 py-3 ${
                        expired ? 'border-amber-300 bg-amber-50' : 'border-slate-200'
                      }`}
                    >
                      <div className="text-right space-y-1">
                        <p className="text-sm font-medium text-slate-900" dir="ltr">{invite.email}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span>נשלח: {formatDate(invite.createdAt || invite.created_at)}</span>
                          {expired ? (
                            <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-100 gap-1">
                              <Clock className="w-3 h-3" />
                              פג תוקף
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-slate-600 border-slate-200 bg-slate-50">
                              {invite.status === 'pending' ? 'ממתין' : invite.status}
                            </Badge>
                          )}
                          {(() => {
                            const auth = authStates[invite.email];
                            if (!auth) return null;
                            if (auth.exists && auth.emailConfirmed) {
                              return (
                                <Badge variant="outline" className="text-emerald-700 border-emerald-200 bg-emerald-50">
                                  אומת
                                </Badge>
                              );
                            }
                            if (auth.exists && !auth.emailConfirmed) {
                              return (
                                <Badge variant="outline" className="text-blue-700 border-blue-200 bg-blue-50">
                                  ממתין לאימות
                                </Badge>
                              );
                            }
                            if (!auth.exists) {
                              return (
                                <Badge variant="outline" className="text-slate-600 border-slate-200 bg-slate-50">
                                  לא רשום
                                </Badge>
                              );
                            }
                            return null;
                          })()}
                        </div>
                        {expired ? (
                          <p className="text-xs text-amber-700">ההזמנה פגה. שלח הזמנה חדשה או בטל את ההזמנה הישנה.</p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        {expired ? (
                          <Button
                            type="button"
                            variant="default"
                            className="gap-2"
                            onClick={() => handleReinvite(invite.email)}
                            disabled={reinvitingEmail === invite.email}
                          >
                            <RefreshCw className="w-4 h-4" />
                            {reinvitingEmail === invite.email ? 'שולח...' : 'שלח הזמנה מחדש'}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          className="text-slate-600 hover:bg-slate-100 gap-2"
                          onClick={() => handleRevoke(invite.id)}
                          disabled={revokingId === invite.id}
                        >
                          <Trash2 className="w-4 h-4" />
                          {revokingId === invite.id ? 'מבטל...' : 'בטל הזמנה'}
                        </Button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-slate-500">אין הזמנות ממתינות.</p>
              )}
            </div>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
