import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function normalizeErrorMessage(error) {
  const message = error?.message || '';
  switch (message) {
    case 'missing_first_name':
      return 'יש להזין שם פרטי.';
    case 'missing_last_name':
      return 'יש להזין שם משפחה.';
    case 'missing_identity_number':
      return 'יש להזין תעודת זהות.';
    case 'invalid_identity_number':
      return 'תעודת הזהות אינה תקינה.';
    case 'duplicate_identity_number':
      return 'תעודת הזהות כבר קיימת במערכת.';
    case 'missing_phone':
      return 'יש להזין מספר טלפון.';
    case 'invalid_phone':
      return 'מספר הטלפון אינו תקין.';
    default:
      return message || 'שמירת הפרטים נכשלה.';
  }
}

export default function AccountProfileForm({
  account,
  onSubmit,
  submitLabel = 'שמירה',
  heading = 'פרטים אישיים',
  description = '',
  disabled = false,
}) {
  const accountSnapshot = React.useMemo(() => JSON.stringify({
    firstName: account?.firstName || '',
    lastName: account?.lastName || '',
    identityNumber: account?.identityNumber || '',
    phone: account?.phone || '',
  }), [
    account?.firstName,
    account?.lastName,
    account?.identityNumber,
    account?.phone,
  ]);
  const [form, setForm] = React.useState({
    firstName: '',
    lastName: '',
    identityNumber: '',
    phone: '',
  });
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [isDirty, setIsDirty] = React.useState(false);
  const lastAppliedSnapshotRef = React.useRef('');

  React.useEffect(() => {
    if (isDirty || accountSnapshot === lastAppliedSnapshotRef.current) {
      return;
    }
    const nextForm = JSON.parse(accountSnapshot);
    setForm(nextForm);
    lastAppliedSnapshotRef.current = accountSnapshot;
  }, [accountSnapshot, isDirty]);

  const updateField = (field, value) => {
    setIsDirty(true);
    if (error) {
      setError('');
    }
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (disabled || isSaving) {
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      await onSubmit({
        first_name: form.firstName,
        last_name: form.lastName,
        identity_number: form.identityNumber,
        phone: form.phone,
      });
      setIsDirty(false);
    } catch (submitError) {
      console.error('Failed to save account profile', submitError);
      setError(normalizeErrorMessage(submitError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {heading || description ? (
        <div className="space-y-1">
          {heading ? <h2 className="text-lg font-semibold text-slate-900">{heading}</h2> : null}
          {description ? <p className="text-sm text-slate-600">{description}</p> : null}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="account-first-name">שם פרטי</Label>
          <Input
            id="account-first-name"
            value={form.firstName}
            onChange={(event) => updateField('firstName', event.target.value)}
            disabled={disabled || isSaving}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="account-last-name">שם משפחה</Label>
          <Input
            id="account-last-name"
            value={form.lastName}
            onChange={(event) => updateField('lastName', event.target.value)}
            disabled={disabled || isSaving}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="account-identity-number">תעודת זהות</Label>
          <Input
            id="account-identity-number"
            value={form.identityNumber}
            onChange={(event) => updateField('identityNumber', event.target.value)}
            disabled={disabled || isSaving}
            dir="ltr"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="account-phone">טלפון</Label>
          <Input
            id="account-phone"
            value={form.phone}
            onChange={(event) => updateField('phone', event.target.value)}
            disabled={disabled || isSaving}
            dir="ltr"
          />
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={disabled || isSaving}>
          {isSaving ? 'שומר...' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
