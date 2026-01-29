import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/forms-ui';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '@/lib/api-client';

export default function CreateManualInstructorDialog({ open, onOpenChange, orgId, session, onSuccess }) {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.firstName.trim()) {
      toast.error('שם פרטי הוא שדה חובה.');
      return;
    }

    setIsSubmitting(true);
    try {
      await authenticatedFetch('instructors', {
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
      toast.success('העובד הוסף בהצלחה.');
      setFormData({ firstName: '', lastName: '', email: '', phone: '' });
      onOpenChange(false);
      if (onSuccess) onSuccess();
    } catch (error) {
      console.error('Failed to create manual instructor', error);
      toast.error('הוספת העובד נכשלה.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (field) => (e) => {
    setFormData(prev => ({ ...prev, [field]: e.target.value }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">הוספת עובד ידני</DialogTitle>
          <DialogDescription className="text-right">
            יצירת כרטיס עובד ללא שיוך למשתמש מערכת (לצורך ניהול שכר ושיבוצים בלבד).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} id="manual-instructor-form" className="space-y-4 py-2">
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
                    שומר...
                  </>
                ) : (
                  <>
                    <UserPlus className="mr-2 h-4 w-4" />
                    צור עובד
                  </>
                )}
              </Button>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                ביטול
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
