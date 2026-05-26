import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { MailPlus } from 'lucide-react';
import { toast } from '@/lib/toast.jsx';
import { createInvitation } from '@/api/invitations.js';

export default function InviteUserDialog({ open, onOpenChange, activeOrgId, session, onInviteSent }) {
  const [email, setEmail] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [pendingConflict, setPendingConflict] = useState(null);

  const handleInvite = async (event, { resendPending = false } = {}) => {
    event?.preventDefault?.();
    if (!email.trim()) {
      toast.error('נא להזין כתובת דוא"ל.');
      return;
    }
    if (!session) {
      toast.error('נדרש חיבור לחשבון כדי לשלוח הזמנה.');
      return;
    }

    setIsInviting(true);
    try {
      const result = await createInvitation(activeOrgId, email.trim(), { session, resendPending });
      if (result?.userExists) {
        toast.success(resendPending
          ? 'ההזמנה חודשה. למשתמש זה כבר קיים חשבון, והוא יכול להתחבר כדי לאשר את ההזמנה.'
          : 'ההזמנה נוצרה בהצלחה. למשתמש זה כבר קיים חשבון, והוא יכול להתחבר כדי לאשר את ההזמנה.');
      } else {
        toast.success(resendPending ? 'ההזמנה נשלחה מחדש בהצלחה.' : 'ההזמנה נשלחה בהצלחה.');
      }
      setPendingConflict(null);
      setEmail('');
      onOpenChange(false);
      if (onInviteSent) {
        onInviteSent();
      }
    } catch (error) {
      console.error('Failed to send invitation', error);
      if (error?.code === 'user_already_a_member') {
        toast.error('לא נשלחה הזמנה. המשתמש כבר חבר בארגון.');
      } else if (error?.code === 'invitation_already_pending') {
        setPendingConflict({
          email: email.trim(),
          expiresAt: error?.data?.expiresAt || null,
        });
      } else {
        toast.error(error?.message || 'שליחת ההזמנה נכשלה. ודא שהכתובת תקינה ונסה שוב.');
      }
    } finally {
      setIsInviting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setPendingConflict(null);
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-end">הזמן משתמש חדש לארגון</DialogTitle>
          <DialogDescription className="text-end">
            הזן כתובת דוא"ל. המשתמש יקבל הזמנה להצטרף לארגון.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleInvite}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="block text-end">
                כתובת דוא"ל
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setPendingConflict(null);
                }}
                disabled={isInviting}
                required
                className="text-end"
                dir="ltr"
              />
            </div>
            {pendingConflict ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 text-end space-y-2">
                <p className="font-medium">כבר קיימת הזמנה פעילה לכתובת הזו.</p>
                <p>אם המשתמש לא קיבל את המייל או שהקישור אבד, אפשר לשלוח הזמנה חדשה שתבטל את הקודמת.</p>
              </div>
            ) : null}
          </div>
          <DialogFooter className="sm:justify-start">
            <div className="flex flex-row-reverse gap-2 w-full">
              <Button type="submit" disabled={isInviting || !email.trim()}>
                {isInviting ? (
                  <>
                    <span className="animate-spin me-2">⏳</span>
                    שולח...
                  </>
                ) : (
                  <>
                    <MailPlus className="me-2 h-4 w-4" />
                    שלח הזמנה
                  </>
                )}
              </Button>
              {pendingConflict ? (
                <Button type="button" variant="secondary" disabled={isInviting} onClick={(event) => handleInvite(event, { resendPending: true })}>
                  שלח מחדש
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isInviting}>
                ביטול
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
