import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TextField, PhoneField } from '@/components/ui/forms-ui';
import { validateIsraeliPhone } from '@/components/ui/helpers/phone';
import { Loader2 } from 'lucide-react';

/**
 * Dialog for creating a new guardian
 */
export default function CreateGuardianDialog({
  open,
  onOpenChange,
  onSuccess,
  onCreateGuardian,
}) {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    relationship: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      setError('יש להזין שם פרטי ושם משפחה');
      return;
    }

    if (!formData.phone.trim()) {
      setError('יש להזין מספר טלפון');
      return;
    }

    if (!validateIsraeliPhone(formData.phone)) {
      setError('יש להזין מספר טלפון ישראלי תקין');
      return;
    }

    setIsSubmitting(true);

    try {
      const guardian = await onCreateGuardian({
        first_name: formData.firstName.trim(),
        last_name: formData.lastName.trim(),
        phone: formData.phone.trim(),
        email: formData.email.trim() || null,
        relationship: formData.relationship.trim() || null,
      });

      // Reset form
      setFormData({
        firstName: '',
        lastName: '',
        phone: '',
        email: '',
        relationship: '',
      });

      onSuccess(guardian);
    } catch (err) {
      setError(err.message || 'שגיאה ביצירת אפוטרופוס');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setFormData({
      firstName: '',
      lastName: '',
      phone: '',
      email: '',
      relationship: '',
    });
    setError('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>יצירת אפוטרופוס חדש</DialogTitle>
          <DialogDescription>
            הזן את פרטי האפוטרופוס. מספר טלפון הוא שדה חובה.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" dir="rtl">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
              {error}
            </div>
          )}

          <TextField
            id="guardian-first-name"
            name="firstName"
            label="שם פרטי"
            value={formData.firstName}
            onChange={handleChange}
            required
            disabled={isSubmitting}
            placeholder="הקלד שם פרטי"
          />

          <TextField
            id="guardian-last-name"
            name="lastName"
            label="שם משפחה"
            value={formData.lastName}
            onChange={handleChange}
            required
            disabled={isSubmitting}
            placeholder="הקלד שם משפחה"
          />

          <PhoneField
            id="guardian-phone"
            name="phone"
            label="טלפון"
            value={formData.phone}
            onChange={handleChange}
            required
            disabled={isSubmitting}
            description="מספר טלפון ישראלי (חובה)"
          />

          <TextField
            id="guardian-email"
            name="email"
            type="email"
            label="אימייל"
            value={formData.email}
            onChange={handleChange}
            required={false}
            disabled={isSubmitting}
            placeholder="אופציונלי"
          />

          <TextField
            id="guardian-relationship"
            name="relationship"
            label="קרבה משפחתית"
            value={formData.relationship}
            onChange={handleChange}
            required={false}
            disabled={isSubmitting}
            placeholder="למשל: הורה, סבא/סבתא, אפוטרופוס חוקי"
            description="אופציונלי"
          />

          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end pt-4">
            <Button type="submit" disabled={isSubmitting} className="gap-2">
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              יצירת אפוטרופוס
            </Button>
            <Button type="button" variant="outline" onClick={handleCancel} disabled={isSubmitting}>
              ביטול
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
