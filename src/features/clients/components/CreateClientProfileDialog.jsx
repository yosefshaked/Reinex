import React, { useEffect, useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';

const INITIAL_FORM = {
  firstName: '',
  middleName: '',
  lastName: '',
  identityNumber: '',
  phone: '',
  email: '',
  defaultNotificationMethod: 'whatsapp',
};

export default function CreateClientProfileDialog({
  open,
  onOpenChange,
  session,
  orgId,
  onSuccess,
  createdFrom = 'ui',
  title = 'יצירת לקוח/ה חד-פעמי/ת',
  description = 'יוצרים כרטיס לקוח/ה שניתן לשייך לשיעורים חד-פעמיים, לטפסים ולהיסטוריה, בלי לפתוח כרטיס תלמיד/ה.',
}) {
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setFormData(INITIAL_FORM);
      setError('');
      setIsSubmitting(false);
    }
  }, [open]);

  const handleChange = (field) => (event) => {
    setFormData((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!orgId) {
      setError('ארגון לא זמין כרגע.');
      return;
    }
    if (!formData.firstName.trim()) {
      setError('יש להזין שם פרטי.');
      return;
    }
    if (!formData.lastName.trim()) {
      setError('יש להזין שם משפחה.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = await authenticatedFetch('client-profiles', {
        session,
        method: 'POST',
        body: {
          org_id: orgId,
          first_name: formData.firstName.trim(),
          middle_name: formData.middleName.trim() || null,
          last_name: formData.lastName.trim(),
          identity_number: formData.identityNumber.trim() || null,
          phone: formData.phone.trim() || null,
          email: formData.email.trim() || null,
          default_notification_method: formData.defaultNotificationMethod,
          created_from: createdFrom,
        },
      });

      toast.success(payload?.action === 'created' ? 'כרטיס הלקוח/ה נוצר.' : 'נמצא כרטיס קיים והשתמשנו בו.');
      onSuccess?.(payload);
      onOpenChange(false);
    } catch (submitError) {
      const message = submitError?.message || 'יצירת הלקוח/ה נכשלה.';
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="client-first-name">שם פרטי *</Label>
              <Input
                id="client-first-name"
                value={formData.firstName}
                onChange={handleChange('firstName')}
                disabled={isSubmitting}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-last-name">שם משפחה *</Label>
              <Input
                id="client-last-name"
                value={formData.lastName}
                onChange={handleChange('lastName')}
                disabled={isSubmitting}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-middle-name">שם אמצעי</Label>
              <Input
                id="client-middle-name"
                value={formData.middleName}
                onChange={handleChange('middleName')}
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-identity-number">תעודת זהות</Label>
              <Input
                id="client-identity-number"
                value={formData.identityNumber}
                onChange={handleChange('identityNumber')}
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-phone">טלפון</Label>
              <Input
                id="client-phone"
                value={formData.phone}
                onChange={handleChange('phone')}
                disabled={isSubmitting}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-email">אימייל</Label>
              <Input
                id="client-email"
                type="email"
                value={formData.email}
                onChange={handleChange('email')}
                disabled={isSubmitting}
                dir="ltr"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="client-notification-method">אמצעי קשר מועדף</Label>
              <Select
                value={formData.defaultNotificationMethod}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, defaultNotificationMethod: value }))}
                disabled={isSubmitting}
              >
                <SelectTrigger id="client-notification-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">וואטסאפ</SelectItem>
                  <SelectItem value="email">אימייל</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="sm:justify-start">
            <div className="flex w-full flex-row-reverse gap-2">
              <Button type="submit" disabled={isSubmitting} className="gap-2">
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                צור לקוח/ה
              </Button>
              <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
                ביטול
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
