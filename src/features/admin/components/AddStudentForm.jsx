import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import {
  TextField,
  TextAreaField,
  SelectField,
  PhoneField
} from '@/components/ui/forms-ui';
import { validateIsraeliPhone } from '@/components/ui/helpers/phone';
import StudentTagsField from './StudentTagsField.jsx';
import { normalizeTagIdsForWrite } from '@/features/students/utils/tags.js';
import { createStudentFormState } from '@/features/students/utils/form-state.js';
import { useIdentityNumberGuard } from '@/features/admin/hooks/useStudentDeduplication.js';
import { useGuardians } from '@/hooks/useGuardians.js';
import GuardianSelector from './GuardianSelector.jsx';
import MedicalProviderField from './MedicalProviderField.jsx';

const EMPTY_INITIAL_VALUES = Object.freeze({});
const IDENTITY_NUMBER_PATTERN = /^\d{5,12}$/;

function buildInitialValuesKey(initialValues) {
  const value = initialValues && typeof initialValues === 'object' ? initialValues : EMPTY_INITIAL_VALUES;
  return [
    value.firstName ?? '',
    value.middleName ?? '',
    value.lastName ?? '',
    value.identityNumber ?? value.identity_number ?? value.nationalId ?? '',
    value.dateOfBirth ?? '',
    value.guardianId ?? '',
    value.guardianRelationship ?? '',
    value.phone ?? '',
    value.email ?? '',
    value.medicalProvider ?? '',
    value.notificationMethod ?? 'whatsapp',
    value.specialRate ?? '',
    value.medicalFlags ?? '',
    value.onboardingStatus ?? 'not_started',
    value.notesInternal ?? '',
    Array.isArray(value.tags) ? value.tags.join(',') : '',
    value.isActive === false ? '0' : '1',
  ].join('|');
}

export default function AddStudentForm({ 
  onSubmit, 
  onCancel, 
  isSubmitting = false, 
  error = '', 
  renderFooterOutside = false,
  onSelectOpenChange, // Mobile fix: callback for Select open/close tracking
  onSubmitDisabledChange = () => {},
  initialValues = EMPTY_INITIAL_VALUES,
}) {
  // Fetch guardians for selection
  const { guardians, isLoading: loadingGuardians, createGuardian } = useGuardians();

  // Avoid infinite rerenders when callers pass a new object literal each render (or when defaulting to `{}`)
  const initialValuesKey = useMemo(() => buildInitialValuesKey(initialValues), [initialValues]);

  const stableInitialValuesRef = useRef(EMPTY_INITIAL_VALUES);
  const stableInitialValuesKeyRef = useRef('');
  if (stableInitialValuesKeyRef.current !== initialValuesKey) {
    stableInitialValuesKeyRef.current = initialValuesKey;
    stableInitialValuesRef.current = initialValues && typeof initialValues === 'object'
      ? initialValues
      : EMPTY_INITIAL_VALUES;
  }

  const initialStateRef = useRef(null);
  const initialStateKeyRef = useRef('');
  if (initialStateKeyRef.current !== initialValuesKey) {
    initialStateKeyRef.current = initialValuesKey;
    initialStateRef.current = { ...createStudentFormState(), ...stableInitialValuesRef.current };
    if (!Array.isArray(initialStateRef.current.tags)) {
      initialStateRef.current.tags = [];
    }
  }

  const initialState = initialStateRef.current;
  const [values, setValues] = useState(() => initialState);
  const [touched, setTouched] = useState({});

  const { duplicate, loading: checkingIdentityNumber, error: identityNumberError } = useIdentityNumberGuard(values.identityNumber);

  const trimmedIdentityNumber = values.identityNumber.trim();
  const isIdentityNumberFormatValid = useMemo(() => {
    if (!trimmedIdentityNumber) return true;
    return IDENTITY_NUMBER_PATTERN.test(trimmedIdentityNumber);
  }, [trimmedIdentityNumber]);

  // Phone validation: required if no guardian connected
  const isPhoneRequired = !values.guardianId;
  const phoneProvidedAndValid = values.phone.trim() && validateIsraeliPhone(values.phone);
  const isGuardianRelationshipRequired = Boolean(values.guardianId);
  const guardianRelationshipProvided = Boolean(values.guardianRelationship);

  const preventSubmitReason = useMemo(() => {
    if (duplicate) return 'duplicate';
    if (identityNumberError) return 'error';
    if (!isIdentityNumberFormatValid) return 'invalid_identity_number';
    // Phone required if no guardian
    if (isPhoneRequired && !phoneProvidedAndValid) return 'phone_required';
    if (isGuardianRelationshipRequired && !guardianRelationshipProvided) return 'guardian_relationship_required';
    return '';
  }, [
    duplicate,
    identityNumberError,
    isIdentityNumberFormatValid,
    isPhoneRequired,
    phoneProvidedAndValid,
    isGuardianRelationshipRequired,
    guardianRelationshipProvided,
  ]);

  useEffect(() => {
    onSubmitDisabledChange(Boolean(preventSubmitReason) || isSubmitting);
  }, [preventSubmitReason, isSubmitting, onSubmitDisabledChange]);

  useEffect(() => {
    setValues(initialState);
    setTouched({});
  }, [initialState]);

  useEffect(() => {
    if (!isSubmitting && !error) {
      setValues(initialState);
      setTouched({});
    }
  }, [isSubmitting, error, initialState]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setValues((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const handleSelectChange = (name, value) => {
    setValues((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const handleBlur = (event) => {
    const { name } = event.target;
    setTouched((previous) => ({
      ...previous,
      [name]: true,
    }));
  };

  const handleTagChange = useCallback((nextTags) => {
    setValues((previous) => ({
      ...previous,
      tags: nextTags,
    }));
  }, []);

  const handleSubmit = (event) => {
    event.preventDefault();

    const newTouched = {
      firstName: true,
      lastName: true,
      identityNumber: true,
      guardianId: true,
      guardianRelationship: true,
      phone: true,
      email: true,
      notificationMethod: true,
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

    // Phone required if no guardian
    if (!values.guardianId && !values.phone.trim()) {
      return;
    }

    if (values.guardianId && !values.guardianRelationship) {
      return;
    }

    // Validate phone if provided
    if (values.phone.trim() && !validateIsraeliPhone(values.phone)) {
      return;
    }

    onSubmit({
      firstName: trimmedFirstName,
      middleName: values.middleName.trim() || null,
      lastName: trimmedLastName,
      identityNumber: trimmedIdentityNumberInner,
      dateOfBirth: values.dateOfBirth || null,
      guardianId: values.guardianId || null,
      guardianRelationship: values.guardianRelationship || null,
      phone: values.phone.trim() || null,
      email: values.email.trim() || null,
      medicalProvider: values.medicalProvider.trim() || null,
      notificationMethod: values.notificationMethod || 'whatsapp',
      specialRate: values.specialRate ? parseFloat(values.specialRate) : null,
      medicalFlags: values.medicalFlags || null,
      onboardingStatus: values.onboardingStatus || 'not_started',
      notesInternal: values.notesInternal.trim() || null,
      tags: normalizeTagIdsForWrite(values.tags),
      isActive: values.isActive !== false,
    });
  };

  const showFirstNameError = touched.firstName && !values.firstName.trim();
  const showLastNameError = touched.lastName && !values.lastName.trim();
  const identityNumberErrorMessage = (() => {
    // Avoid double-surfacing duplicates; detailed banner handles it
    if (duplicate) return '';
    if (identityNumberError) return identityNumberError;
    if (error === 'duplicate_identity_number') return '';
    if (touched.identityNumber && !trimmedIdentityNumber) return 'יש להזין מספר זהות.';
    if (touched.identityNumber && trimmedIdentityNumber && !isIdentityNumberFormatValid) {
      return 'מספר זהות לא תקין. יש להזין 5–12 ספרות.';
    }
    return '';
  })();

  // Phone error: required if no guardian, or invalid format if provided
  const showPhoneError = touched.phone && (
    (!values.guardianId && !values.phone.trim()) || 
    (values.phone.trim() && !validateIsraeliPhone(values.phone))
  );
  const showGuardianRelationshipError = touched.guardianRelationship && values.guardianId && !values.guardianRelationship;
  const phoneErrorMessage = (() => {
    if (!values.guardianId && !values.phone.trim()) {
      return 'יש להזין מספר טלפון או לשייך אפוטרופוס';
    }
    if (values.phone.trim() && !validateIsraeliPhone(values.phone)) {
      return 'יש להזין מספר טלפון ישראלי תקין';
    }
    return '';
  })();

  return (
    <form id="add-student-form" onSubmit={handleSubmit} className="space-y-5" dir="rtl">
      {error && error !== 'duplicate_identity_number' && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      <div className="space-y-5 divide-y divide-border">
        <div className="space-y-5 py-1">
          <TextField
            id="student-first-name"
            name="firstName"
            label="שם פרטי"
            value={values.firstName}
            onChange={handleChange}
            onBlur={handleBlur}
            required
            placeholder="הקלד שם פרטי"
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
            placeholder="הקלד שם אמצעי (אופציונלי)"
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
            placeholder="הקלד שם משפחה"
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
            description="אופציונלי - לצורך תכנון שירותים"
          />

          <GuardianSelector
            value={values.guardianId}
            onChange={(value) => {
              handleSelectChange('guardianId', value);
              if (!value) {
                handleSelectChange('guardianRelationship', '');
              }
            }}
            guardians={guardians}
            isLoading={loadingGuardians}
            disabled={isSubmitting}
            onCreateGuardian={createGuardian}
            onSelectOpenChange={onSelectOpenChange}
          />

          {values.guardianId && (
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
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PhoneField
              id="phone"
              name="phone"
              label="טלפון (תלמיד)"
              value={values.phone}
              onChange={handleChange}
              onBlur={handleBlur}
              required={!values.guardianId}
              disabled={isSubmitting}
              error={showPhoneError ? phoneErrorMessage : ''}
              description={values.guardianId 
                ? "אופציונלי רק במידה ואפוטרופוס מחובר"
                : "חובה - אין אפוטרופוס מחובר"
              }
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
            description="אופציונלי - תעריף מיוחד לתלמיד זה (במקום תעריף ברירת מחדל)"
            placeholder="0.00"
          />
        </div>

        <div className="space-y-5 py-4">
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            <p className="font-semibold mb-1">הערה: שיבוץ שיעורים</p>
            <p>אפשר לשבץ תלמיד לשיעורים קבועים דרך עמוד התלמיד לאחר היצירה, או דרך לוח השנה.</p>
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

      {!renderFooterOutside && (
        <div className="border-t -mx-4 sm:-mx-6 mt-6 pt-3 sm:pt-4 px-4 sm:px-6">
          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
            <Button
              type="submit"
              disabled={isSubmitting || Boolean(preventSubmitReason)}
              className="gap-2 shadow-md hover:shadow-lg transition-shadow"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              שמירת תלמיד חדש
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

export function AddStudentFormFooter({ onSubmit, onCancel, isSubmitting = false, disableSubmit = false }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
      <Button type="button" onClick={onSubmit} disabled={isSubmitting || disableSubmit} className="gap-2 shadow-md hover:shadow-lg transition-shadow">
        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        שמירת תלמיד חדש
      </Button>
      <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting} className="hover:shadow-sm">
        ביטול
      </Button>
    </div>
  );
}

