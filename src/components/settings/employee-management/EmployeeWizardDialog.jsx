import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/forms-ui';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
    employeeId: '',
    employeeType: 'instructor',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    startDate: '',
  });
  const [inviteEmail, setInviteEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdEmployeeId, setCreatedEmployeeId] = useState(null);

  const handleReset = () => {
    setStep(STEPS.DETAILS);
    setFormData({ employeeId: '', employeeType: 'instructor', firstName: '', lastName: '', email: '', phone: '', startDate: '' });
    setInviteEmail('');
    setCreatedEmployeeId(null);
  };

  const handleChange = (field) => (e) => {
    setFormData(prev => ({ ...prev, [field]: e.target.value }));
  };

  const handleCreateEmployee = async () => {
    if (!formData.employeeId.trim()) {
      toast.error('מספר מזהה (ת"ז / מספר עובד) הוא שדה חובה.');
      return;
    }
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
          employee_id: formData.employeeId.trim(),
          employee_type: formData.employeeType,
          first_name: formData.firstName.trim(),
          last_name: formData.lastName.trim() || undefined,
          email: formData.email.trim() || undefined,
          phone: formData.phone.trim() || undefined,
          start_date: formData.startDate || undefined,
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
      const result = await authenticatedFetch('instructors-link-user', {
        session,
        method: 'POST',
        body: {
          org_id: orgId,
          instructor_id: createdEmployeeId,
          email: inviteEmail.trim(),
        },
      });
      if (result?.user_exists) {
        toast.success('ההזמנה נוצרה. למשתמש כבר יש חשבון והוא יכול להתחבר כדי לאשר אותה.');
      } else {
        toast.success('ההזמנה נשלחה בהצלחה.');
      }
      onOpenChange(false);
      handleReset();
      if (onSuccess) onSuccess();
    } catch (error) {
      console.error('Failed to send invitation', error);
      toast.error(error?.message || 'שליחת ההזמנה נכשלה.');
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
      <DialogContent className="sm:max-w-md">
        {step === STEPS.DETAILS && (
          <>
            <DialogHeader>
              <DialogTitle className="text-end">יצירת עובד חדש</DialogTitle>
              <DialogDescription className="text-end">
                הזן את הפרטים הבסיסיים של העובד. תוכל להזמין אותו למערכת בשלב הבא.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); handleCreateEmployee(); }} className="space-y-4 py-2">
              <TextField
                id="employeeId"
                label='מספר מזהה (ת"ז / מספר עובד)'
                value={formData.employeeId}
                onChange={handleChange('employeeId')}
                required
                disabled={isSubmitting}
                description='הזן תעודת זהות או מספר עובד'
              />

              <div className="space-y-2">
                <Label className="text-end">סוג עובד</Label>
                <Select
                  value={formData.employeeType}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, employeeType: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="בחר סוג עובד" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="instructor">מדריך/ה</SelectItem>
                    <SelectItem value="office">עובד/ת משרד</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
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

              <div className="space-y-2 text-end">
                <Label htmlFor="startDate">תאריך התחלה (אופציונלי)</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
                  disabled={isSubmitting}
                />
              </div>

              <DialogFooter className="sm:justify-start">
                <div className="flex flex-row-reverse gap-2 w-full">
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <span className="animate-spin me-2">⏳</span>
                        יוצר...
                      </>
                    ) : (
                      <>
                        הבא
                        <ArrowLeft className="ms-2 h-4 w-4" />
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
              <DialogTitle className="text-end">האם להזמין את העובד למערכת?</DialogTitle>
              <DialogDescription className="text-end">
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
                  <div className="text-end">
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
                  <div className="text-end">
                    <div className="font-semibold">המשך ללא הזמנה</div>
                    <div className="text-xs text-muted-foreground">ניהול עובד ידני בלבד</div>
                  </div>
                </div>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </div>
            <DialogFooter className="sm:justify-start">
              <Button variant="ghost" onClick={() => setStep(STEPS.DETAILS)}>
                <ArrowRight className="ms-2 h-4 w-4" />
                חזור
              </Button>
            </DialogFooter>
          </>
        )}

        {step === STEPS.EMAIL && (
          <>
            <DialogHeader>
              <DialogTitle className="text-end">שליחת הזמנה למשתמש</DialogTitle>
              <DialogDescription className="text-end">
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
                        <span className="animate-spin me-2">⏳</span>
                        שולח...
                      </>
                    ) : (
                      <>
                        <Mail className="me-2 h-4 w-4" />
                        שלח הזמנה
                      </>
                    )}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setStep(STEPS.INVITE_OPTION)} disabled={isSubmitting}>
                    <ArrowRight className="ms-2 h-4 w-4" />
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
