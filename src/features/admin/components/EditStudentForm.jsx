import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import {
  TextField,
  TextAreaField,
  SelectField,
  PhoneField,
} from '@/components/ui/forms-ui';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import StudentTagsField from './StudentTagsField.jsx';
import MedicalProviderField from './MedicalProviderField.jsx';
import GuardianSelector from './GuardianSelector.jsx';
import { useGuardians } from '@/hooks/useGuardians.js';
import { normalizeTagIdsForWrite } from '@/features/students/utils/tags.js';
import { createStudentFormState } from '@/features/students/utils/form-state.js';
import { useIdentityNumberGuard } from '@/features/admin/hooks/useStudentDeduplication.js';
import { validateIsraeliPhone } from '@/components/ui/helpers/phone.js';

const IDENTITY_NUMBER_PATTERN = /^\d{5,12}$/;

export default function EditStudentForm({ 
  student, 
  onSubmit, 
  onCancel, 
  isSubmitting = false, 
  error = '', 
  renderFooterOutside = false,
  onSelectOpenChange, // Mobile fix: callback for Select open/close tracking
  onSubmitDisabledChange = () => {},
}) {
  const [values, setValues] = useState(() => createStudentFormState(student));
  const [touched, setTouched] = useState({});
  
  // Track the ID of the student currently being edited
  const currentStudentIdRef = useRef(student?.id);
  const excludeStudentId = student?.id; // Use stable reference for hook dependency

  const { duplicate, loading: checkingIdentityNumber, error: identityNumberError } = useIdentityNumberGuard(values.identityNumber, {
    excludeStudentId,
  });

  const { guardians, isLoading: loadingGuardians, createGuardian } = useGuardians();

  const trimmedIdentityNumber = values.identityNumber.trim();
  const isIdentityNumberFormatValid = useMemo(() => {
    if (!trimmedIdentityNumber) return true;
    return IDENTITY_NUMBER_PATTERN.test(trimmedIdentityNumber);
  }, [trimmedIdentityNumber]);

  // Phone is required when no guardian is linked
  const isPhoneRequired = !values.guardianId;
  const phoneProvidedAndValid = useMemo(() => {
    const trimmed = (values.phone || '').trim();
    if (!trimmed) return false;
    return validateIsraeliPhone(trimmed);
  }, [values.phone]);

  const isGuardianRelationshipRequired = Boolean(values.guardianId);
  const guardianRelationshipProvided = Boolean(values.guardianRelationship);

  const preventSubmitReason = useMemo(() => {
    if (duplicate) return 'duplicate';
    if (identityNumberError) return 'error';
    if (!isIdentityNumberFormatValid) return 'invalid_identity_number';
    if (isPhoneRequired && !phoneProvidedAndValid) return 'phone_required';
    if (isGuardianRelationshipRequired && !guardianRelationshipProvided) return 'guardian_relationship_required';
    return '';
  }, [duplicate, identityNumberError, isIdentityNumberFormatValid, isPhoneRequired, phoneProvidedAndValid, isGuardianRelationshipRequired, guardianRelationshipProvided]);

  useEffect(() => {
    onSubmitDisabledChange(Boolean(preventSubmitReason) || isSubmitting);
  }, [preventSubmitReason, isSubmitting, onSubmitDisabledChange]);

  useEffect(() => {
    const incomingStudentId = student?.id;
    
    // Only reset the form if we're switching to a different student
    // If it's the same student (background refresh), preserve user's unsaved changes
    if (incomingStudentId !== currentStudentIdRef.current) {
      currentStudentIdRef.current = incomingStudentId;
      setValues(createStudentFormState(student));
      setTouched({});
    }
  }, [student]);

  const handleChange = useCallback((event) => {
    const { name, value } = event.target;
    setValues((previous) => ({ ...previous, [name]: value }));
  }, []);

  const handleSelectChange = useCallback((name, value) => {
    setValues((previous) => ({ ...previous, [name]: value }));
  }, []);

  const handleBlur = useCallback((event) => {
    const { name } = event.target;
    setTouched((previous) => ({ ...previous, [name]: true }));
  }, []);

  const handleTagChange = useCallback((nextTags) => {
    setValues((previous) => ({
      ...previous,
      tags: nextTags,
    }));
  }, []);

  const handleStatusChange = useCallback((nextValue) => {
    setValues((previous) => ({
      ...previous,
      isActive: Boolean(nextValue),
    }));
  }, []);

  const handleSubmit = (event) => {
    event.preventDefault();

    const newTouched = {
      firstName: true,
      lastName: true,
      identityNumber: true,
      phone: true,
      email: true,
      notificationMethod: true,
      guardianRelationship: true,
    };
    setTouched(newTouched);

    const trimmedFirstName = values.firstName.trim();
    const trimmedLastName = values.lastName.trim();
    const trimmedIdentityNumberInner = values.identityNumber.trim();

    if (duplicate || identityNumberError) {
      return;
    }

    if (!trimmedFirstName || !trimmedLastName || !trimmedIdentityNumberInner) {
      return;
    }

    if (!IDENTITY_NUMBER_PATTERN.test(trimmedIdentityNumberInner)) {
      return;
    }

    // Phone is required when no guardian is linked
    if (isPhoneRequired && !phoneProvidedAndValid) {
      return;
    }

    // Relationship is required when a guardian is selected
    if (isGuardianRelationshipRequired && !guardianRelationshipProvided) {
      return;
    }

    onSubmit({
      id: student?.id,
      firstName: trimmedFirstName,
      middleName: values.middleName.trim() || null,
      lastName: trimmedLastName,
      identityNumber: trimmedIdentityNumberInner,
      dateOfBirth: values.dateOfBirth || null,
      phone: values.phone.trim() || null,
      email: values.email.trim() || null,
      medicalProvider: values.medicalProvider?.trim() || null,
      notificationMethod: values.notificationMethod || 'whatsapp',
      specialRate: values.specialRate !== '' ? values.specialRate : null,
      notesInternal: values.notesInternal.trim() || null,
      tags: normalizeTagIdsForWrite(values.tags),
      isActive: values.isActive !== false,
      guardianId: values.guardianId || null,
      guardianRelationship: values.guardianRelationship || null,
    });
  };

  const showFirstNameError = touched.firstName && !values.firstName.trim();
  const showLastNameError = touched.lastName && !values.lastName.trim();
  const identityNumberErrorMessage = (() => {
    if (duplicate) return '';
    if (identityNumberError) return identityNumberError;
    if (error === 'duplicate_identity_number') return '';
    if (touched.identityNumber && !trimmedIdentityNumber) return 'יש להזין מספר זהות.';
    if (touched.identityNumber && trimmedIdentityNumber && !isIdentityNumberFormatValid) {
      return 'מספר זהות לא תקין. יש להזין 5–12 ספרות.';
    }
    return '';
  })();
  const showPhoneRequiredError = touched.phone && isPhoneRequired && !phoneProvidedAndValid;
  const showGuardianRelationshipError = touched.guardianRelationship && isGuardianRelationshipRequired && !guardianRelationshipProvided;
  const isInactive = values.isActive === false;

  return (
    <form id="edit-student-form" onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-5 divide-y divide-border">
        {/* ── Personal details ── */}
        <div className="space-y-5 py-1">
          <TextField
            id="student-first-name"
            name="firstName"
            label="שם פרטי"
            value={values.firstName}
            onChange={handleChange}
            onBlur={handleBlur}
            required
            placeholder="הקלד את השם הפרטי"
            disabled={isSubmitting}
            error={showFirstNameError ? 'יש להזין שם פרטי.' : ''}
          />

          <TextField
            id="student-middle-name"
            name="middleName"
            label="שם אמצעי"
            value={values.middleName}
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder="הקלד את השם האמצעי (אופציונלי)"
            disabled={isSubmitting}
          />

          <TextField
            id="student-last-name"
            name="lastName"
            label="שם משפחה"
            value={values.lastName}
            onChange={handleChange}
            onBlur={handleBlur}
            required
            placeholder="הקלד את שם המשפחה"
            disabled={isSubmitting}
            error={showLastNameError ? 'יש להזין שם משפחה.' : ''}
          />

          <TextField
            id="identity-number"
            name="identityNumber"
            label="מספר זהות"
            value={values.identityNumber}
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder="הקלד מספר זהות למניעת כפילויות"
            disabled={isSubmitting}
            required
            error={identityNumberErrorMessage}
            description={checkingIdentityNumber ? 'בודק כפילויות...' : ''}
          />

          {duplicate && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 space-y-2" role="alert">
              <p className="font-semibold">מספר זהות זה כבר קיים.</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span>כדי למנוע כפילויות, עברו לפרופיל של {duplicate.name}.</span>
                <Link
                  to={`/students/${duplicate.id}`}
                  className="inline-flex items-center justify-center rounded-md bg-red-600 px-3 py-1.5 text-white shadow hover:bg-red-700"
                >
                  מעבר לפרופיל
                </Link>
              </div>
            </div>
          )}

          <TextField
            id="date-of-birth"
            name="dateOfBirth"
            label="תאריך לידה"
            type="date"
            value={values.dateOfBirth}
            onChange={handleChange}
            onBlur={handleBlur}
            required={false}
            disabled={isSubmitting}
            description="אופציונלי – לצורך תכנון שירותים"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PhoneField
              id="phone"
              name="phone"
              label="טלפון (תלמיד)"
              value={values.phone}
              onChange={handleChange}
              onBlur={handleBlur}
              required={isPhoneRequired}
              disabled={isSubmitting}
              description={isPhoneRequired ? 'חובה כאשר לא מחובר אפוטרופוס' : 'אופציונלי'}
              error={showPhoneRequiredError ? 'יש להזין טלפון כאשר אין אפוטרופוס מקושר.' : ''}
            />

            <TextField
              id="email"
              name="email"
              label="אימייל (תלמיד)"
              type="email"
              value={values.email}
              onChange={handleChange}
              onBlur={handleBlur}
              required={false}
              disabled={isSubmitting}
              description="אופציונלי"
            />
          </div>

          {/* ── Guardian ── */}
          <div className="space-y-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            <h3 className="text-sm font-semibold text-neutral-800">אפוטרופוס</h3>

            <GuardianSelector
              value={values.guardianId}
              onChange={(value) => {
                handleSelectChange('guardianId', value);
                if (!value) handleSelectChange('guardianRelationship', '');
              }}
              guardians={guardians}
              isLoading={loadingGuardians}
              disabled={isSubmitting}
              onCreateGuardian={createGuardian}
            />

            {values.guardianId ? (
              <SelectField
                id="guardian-relationship"
                name="guardianRelationship"
                label="קרבה לאפוטרופוס"
                value={values.guardianRelationship}
                onChange={(value) => handleSelectChange('guardianRelationship', value)}
                onOpenChange={onSelectOpenChange}
                options={[
                  { value: 'father', label: 'אב' },
                  { value: 'mother', label: 'אם' },
                  { value: 'self', label: 'עצמי' },
                  { value: 'caretaker', label: 'מטפל' },
                  { value: 'other', label: 'אחר' },
                ]}
                placeholder="בחר קרבה"
                required
                disabled={isSubmitting}
                error={showGuardianRelationshipError ? 'יש לבחור קרבה לאפוטרופוס.' : ''}
              />
            ) : null}
          </div>

          <MedicalProviderField
            value={values.medicalProvider}
            onChange={(nextValue) => handleSelectChange('medicalProvider', nextValue)}
            disabled={isSubmitting}
            description="אופציונלי"
          />

          <SelectField
            id="notification-method"
            name="notificationMethod"
            label="שיטת התראה מועדפת"
            value={values.notificationMethod}
            onChange={(value) => handleSelectChange('notificationMethod', value)}
            onOpenChange={onSelectOpenChange}
            options={[
              { value: 'whatsapp', label: 'WhatsApp' },
              { value: 'email', label: 'דואר אלקטרוני' },
            ]}
            placeholder="בחר שיטת התראה"
            required
            disabled={isSubmitting}
            description="כיצד ישלח המערכת תזכורות ואישורים"
          />

          <TextField
            id="special-rate"
            name="specialRate"
            label="תעריף מיוחד"
            type="number"
            step="0.01"
            min="0"
            value={values.specialRate}
            onChange={handleChange}
            onBlur={handleBlur}
            required={false}
            disabled={isSubmitting}
            description="אופציונלי – תעריף מיוחד לתלמיד זה (במקום תעריף ברירת מחדל)"
            placeholder="0.00"
          />
        </div>

        {/* ── Status & organisation ── */}
        <div className="space-y-5 py-4">
          <div className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <Label htmlFor="student-status" className="text-sm font-medium text-neutral-800">
                  סטטוס תלמיד
                </Label>
                <p className="text-xs leading-relaxed text-neutral-600">
                  תלמידים לא פעילים יוסתרו כברירת מחדל מרשימות ומטפסים אך יישארו נגישים בדף התלמיד ובהיסטוריית המפגשים.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-sm font-medium ${isInactive ? 'text-amber-700' : 'text-emerald-600'}`}>
                  {isInactive ? 'לא פעיל' : 'פעיל'}
                </span>
                <Switch
                  id="student-status"
                  checked={!isInactive}
                  onCheckedChange={handleStatusChange}
                  disabled={isSubmitting}
                  aria-label="החלפת סטטוס פעיל של התלמיד"
                />
              </div>
            </div>
            {isInactive ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                התלמיד יוסתר מתצוגות ברירת המחדל אך ימשיך להופיע כאשר תבחרו להציג תלמידים לא פעילים.
              </div>
            ) : null}
          </div>

          <StudentTagsField
            value={values.tags}
            onChange={handleTagChange}
            disabled={isSubmitting}
            description="תגיות לסינון וארגון תלמידים."
          />

          <TextAreaField
            id="notes-internal"
            name="notesInternal"
            label="הערות פנימיות"
            value={values.notesInternal}
            onChange={handleChange}
            placeholder="הערות פנימיות על התלמיד (לא נראות לאפוטרופוסים)"
            rows={3}
            disabled={isSubmitting}
            description="הערות אלו מיועדות לצוות בלבד"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 text-end" role="alert">
          {error}
        </div>
      )}

      {!renderFooterOutside && (
        <div className="border-t -mx-4 sm:-mx-6 mt-6 pt-3 sm:pt-4 px-4 sm:px-6">
          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
            <Button
              type="submit"
              disabled={isSubmitting || Boolean(preventSubmitReason)}
              className="gap-2 shadow-md hover:shadow-lg transition-shadow"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              שמירת שינויים
            </Button>
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting} className="hover:shadow-sm">
              ביטול
            </Button>
          </div>
        </div>
      )}
    </form>
  );

}

export function EditStudentFormFooter({ onSubmit, onCancel, isSubmitting = false, disableSubmit = false }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
      <Button type="button" onClick={onSubmit} disabled={isSubmitting || disableSubmit} className="gap-2 shadow-md hover:shadow-lg transition-shadow">
        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        שמירת שינויים
      </Button>
      <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting} className="hover:shadow-sm">
        ביטול
      </Button>
    </div>
  );
}
