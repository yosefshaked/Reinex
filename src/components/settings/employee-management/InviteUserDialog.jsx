import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { MailPlus } from 'lucide-react';
import { toast } from 'sonner';
import { createInvitation } from '@/api/invitations.js';

export default function InviteUserDialog({ open, onOpenChange, activeOrgId, session, onInviteSent }) {
  const [email, setEmail] = useState('');
  const [isInviting, setIsInviting] = useState(false);

  const handleInvite = async (event) => {
    event.preventDefault();
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
      const result = await createInvitation(activeOrgId, email.trim(), { session });
      if (result?.userExists) {
        toast.success('ההזמנה נוצרה בהצלחה. למשתמש זה כבר קיים חשבון, והוא יכול להתחבר כדי לאשר את ההזמנה.');
      } else {
        toast.success('ההזמנה נשלחה בהצלחה.');
      }
      setEmail('');
      onOpenChange(false);
      if (onInviteSent) {
        onInviteSent();
      }
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">הזמן משתמש חדש לארגון</DialogTitle>
          <DialogDescription className="text-right">
            הזן כתובת דוא"ל. המשתמש יקבל הזמנה להצטרף לארגון.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleInvite}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="block text-right">
                כתובת דוא"ל
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isInviting}
                required
                className="text-right"
                dir="ltr"
              />
            </div>
          </div>
          <DialogFooter className="sm:justify-start">
            <div className="flex flex-row-reverse gap-2 w-full">
              <Button type="submit" disabled={isInviting || !email.trim()}>
                {isInviting ? (
                  <>
                    <span className="animate-spin mr-2">⏳</span>
                    שולח...
                  </>
                ) : (
                  <>
                    <MailPlus className="mr-2 h-4 w-4" />
                    שלח הזמנה
                  </>
                )}
              </Button>
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
