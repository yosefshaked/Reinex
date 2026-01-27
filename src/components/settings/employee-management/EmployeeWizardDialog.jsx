import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/forms-ui';
import { UserPlus, Mail, ArrowRight, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '@/lib/api-client';

const STEPS = {
  DETAILS: 'details',
  INVITE_OPTION: 'invite_option',
  EMAIL: 'email',
};

export default function EmployeeWizardDialog({ open, onOpenChange, orgId, session, onSuccess }) {
  const [step, setStep] = useState(STEPS.DETAILS);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  });
  const [inviteEmail, setInviteEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdEmployeeId, setCreatedEmployeeId] = useState(null);

  const handleReset = () => {
    setStep(STEPS.DETAILS);
    setFormData({ firstName: '', lastName: '', email: '', phone: '' });
    setInviteEmail('');
    setCreatedEmployeeId(null);
  };

  const handleChange = (field) => (e) => {
    setFormData(prev => ({ ...prev, [field]: e.target.value }));
  };

  const handleCreateEmployee = async () => {
    if (!formData.firstName.trim()) {
      toast.error('שם פרטי הוא שדה חובה.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await authenticatedFetch('instructors', {
        session,
        method: 'POST',
        body: {
          org_id: orgId,
          first_name: formData.firstName.trim(),
          last_name: formData.lastName.trim() || undefined,
          email: formData.email.trim() || undefined,
          phone: formData.phone.trim() || undefined,
        },
      });

      setCreatedEmployeeId(result.id);
      setInviteEmail(formData.email.trim());
      toast.success('העובד נוצר בהצלחה.');
      setStep(STEPS.INVITE_OPTION);
    } catch (error) {
      console.error('Failed to create employee', error);
      toast.error('יצירת העובד נכשלה.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendInvitation = async () => {
    if (!inviteEmail.trim()) {
      toast.error('נא להזין כתובת דוא"ל.');
      return;
    }

    setIsSubmitting(true);
    try {
      await authenticatedFetch('instructors-link-user', {
        session,
        method: 'POST',
        body: {
          org_id: orgId,
          instructor_id: createdEmployeeId,
          email: inviteEmail.trim(),
        },
      });
      toast.success('ההזמנה נשלחה בהצלחה.');
      onOpenChange(false);
      handleReset();
      if (onSuccess) onSuccess();
    } catch (error) {
      console.error('Failed to send invitation', error);
      toast.error('שליחת ההזמנה נכשלה.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkipInvitation = () => {
    onOpenChange(false);
    handleReset();
    if (onSuccess) onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      if (!newOpen) handleReset();
      onOpenChange(newOpen);
    }}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        {step === STEPS.DETAILS && (
          <>
            <DialogHeader>
              <DialogTitle className="text-right">יצירת עובד חדש</DialogTitle>
              <DialogDescription className="text-right">
                הזן את הפרטים הבסיסיים של העובד. תוכל להזמין אותו למערכת בשלב הבא.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); handleCreateEmployee(); }} className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <TextField
                  id="firstName"
                  label="שם פרטי"
                  value={formData.firstName}
                  onChange={handleChange('firstName')}
                  required
                  disabled={isSubmitting}
                />
                <TextField
                  id="lastName"
                  label="שם משפחה"
                  value={formData.lastName}
                  onChange={handleChange('lastName')}
                  disabled={isSubmitting}
                />
              </div>
              
              <TextField
                id="email"
                label='דוא"ל (אופציונלי)'
                type="email"
                value={formData.email}
                onChange={handleChange('email')}
                disabled={isSubmitting}
                dir="ltr"
              />
              
              <TextField
                id="phone"
                label="טלפון (אופציונלי)"
                type="tel"
                value={formData.phone}
                onChange={handleChange('phone')}
                disabled={isSubmitting}
                dir="ltr"
              />

              <DialogFooter className="sm:justify-start">
                <div className="flex flex-row-reverse gap-2 w-full">
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <span className="animate-spin mr-2">⏳</span>
                        יוצר...
                      </>
                    ) : (
                      <>
                        הבא
                        <ArrowLeft className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                    ביטול
                  </Button>
                </div>
              </DialogFooter>
            </form>
          </>
        )}

        {step === STEPS.INVITE_OPTION && (
          <>
            <DialogHeader>
              <DialogTitle className="text-right">האם להזמין את העובד למערכת?</DialogTitle>
              <DialogDescription className="text-right">
                העובד נוצר בהצלחה. כעת תוכל לשלוח לו הזמנה להצטרף למערכת או להמשיך ללא הזמנה.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-6">
              <Button
                onClick={() => setStep(STEPS.EMAIL)}
                className="w-full h-auto py-4 flex items-center justify-between"
                variant="outline"
              >
                <div className="flex items-center gap-3">
                  <Mail className="h-5 w-5" />
                  <div className="text-right">
                    <div className="font-semibold">שלח הזמנה למשתמש</div>
                    <div className="text-xs text-muted-foreground">העובד יוכל להתחבר למערכת</div>
                  </div>
                </div>
                <ArrowLeft className="h-4 w-4" />
              </Button>

              <Button
                onClick={handleSkipInvitation}
                className="w-full h-auto py-4 flex items-center justify-between"
                variant="outline"
              >
                <div className="flex items-center gap-3">
                  <UserPlus className="h-5 w-5" />
                  <div className="text-right">
                    <div className="font-semibold">המשך ללא הזמנה</div>
                    <div className="text-xs text-muted-foreground">ניהול עובד ידני בלבד</div>
                  </div>
                </div>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </div>
            <DialogFooter className="sm:justify-start">
              <Button variant="ghost" onClick={() => setStep(STEPS.DETAILS)}>
                <ArrowRight className="ml-2 h-4 w-4" />
                חזור
              </Button>
            </DialogFooter>
          </>
        )}

        {step === STEPS.EMAIL && (
          <>
            <DialogHeader>
              <DialogTitle className="text-right">שליחת הזמנה למשתמש</DialogTitle>
              <DialogDescription className="text-right">
                הזן את כתובת הדוא"ל של העובד. הוא יקבל הזמנה להצטרף לארגון במערכת.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); handleSendInvitation(); }} className="space-y-4 py-4">
              <TextField
                id="inviteEmail"
                label='כתובת דוא"ל'
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                disabled={isSubmitting}
                dir="ltr"
              />

              <DialogFooter className="sm:justify-start">
                <div className="flex flex-row-reverse gap-2 w-full">
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <span className="animate-spin mr-2">⏳</span>
                        שולח...
                      </>
                    ) : (
                      <>
                        <Mail className="mr-2 h-4 w-4" />
                        שלח הזמנה
                      </>
                    )}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setStep(STEPS.INVITE_OPTION)} disabled={isSubmitting}>
                    <ArrowRight className="ml-2 h-4 w-4" />
                    חזור
                  </Button>
                </div>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
