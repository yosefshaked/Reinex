import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import {
  TextField,
  TextAreaField,
  SelectField,
  PhoneField,
  DayOfWeekField,
  ComboBoxField,
  TimeField
} from '@/components/ui/forms-ui';
import { validateIsraeliPhone } from '@/components/ui/helpers/phone';
import StudentTagsField from './StudentTagsField.jsx';
import { normalizeTagIdsForWrite } from '@/features/students/utils/tags.js';
import { createStudentFormState } from '@/features/students/utils/form-state.js';
import { useStudentNameSuggestions, useIdentityNumberGuard } from '@/features/admin/hooks/useStudentDeduplication.js';
import { useInstructors, useServices } from '@/hooks/useOrgData.js';

const EMPTY_INITIAL_VALUES = Object.freeze({});
const IDENTITY_NUMBER_PATTERN = /^\d{5,12}$/;

function buildInitialValuesKey(initialValues) {
  const value = initialValues && typeof initialValues === 'object' ? initialValues : EMPTY_INITIAL_VALUES;
  return [
    value.firstName ?? '',
    value.middleName ?? '',
    value.lastName ?? '',
    value.identityNumber ?? value.identity_number ?? value.nationalId ?? '',
    value.phone ?? '',
    value.email ?? '',
    value.contactName ?? '',
    value.contactPhone ?? '',
    value.assignedInstructorId ?? '',
    value.defaultService ?? '',
    value.defaultDayOfWeek ?? '',
    value.defaultSessionTime ?? '',
    value.notes ?? '',
    value.tagId ?? '',
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
  }

  const initialState = initialStateRef.current;
  const [values, setValues] = useState(() => initialState);
  const [touched, setTouched] = useState({});
  
  const { services = [], loadingServices } = useServices();
  const { instructors = [], loadingInstructors } = useInstructors();

  // Normalize instructors to avoid runtime errors when the hook is still initializing
  const safeInstructors = useMemo(() => {
    return Array.isArray(instructors) ? instructors : [];
  }, [instructors]);

  const { duplicate, loading: checkingIdentityNumber, error: identityNumberError } = useIdentityNumberGuard(values.identityNumber);

  const trimmedIdentityNumber = values.identityNumber.trim();
  const isIdentityNumberFormatValid = useMemo(() => {
    if (!trimmedIdentityNumber) return true;
    return IDENTITY_NUMBER_PATTERN.test(trimmedIdentityNumber);
  }, [trimmedIdentityNumber]);

  const preventSubmitReason = useMemo(() => {
    if (duplicate) return 'duplicate';
    if (identityNumberError) return 'error';
    if (!isIdentityNumberFormatValid) return 'invalid_identity_number';
    return '';
  }, [duplicate, identityNumberError, isIdentityNumberFormatValid]);

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

  const handleTagChange = useCallback((nextTagId) => {
    setValues((previous) => ({
      ...previous,
      tagId: nextTagId,
    }));
  }, []);

  const handleSubmit = (event) => {
    event.preventDefault();

    const newTouched = {
      firstName: true,
      lastName: true,
      identityNumber: true,
      contactName: true,
      contactPhone: true,
      phone: true,
      email: true,
      assignedInstructorId: true,
      defaultDayOfWeek: true,
      defaultSessionTime: true,
    };
    setTouched(newTouched);

    const trimmedFirstName = values.firstName.trim();
    const trimmedLastName = values.lastName.trim();
    const trimmedContactName = values.contactName.trim();
    const trimmedContactPhone = values.contactPhone.trim();
    const trimmedIdentityNumberInner = values.identityNumber.trim();

    if (duplicate || identityNumberError) {
      return;
    }

    if (!trimmedFirstName || !trimmedLastName || !trimmedIdentityNumberInner ||
        !values.assignedInstructorId || !values.defaultDayOfWeek || !values.defaultSessionTime) {
      return;
    }

    if (!IDENTITY_NUMBER_PATTERN.test(trimmedIdentityNumberInner)) {
      return;
    }

    if (!validateIsraeliPhone(trimmedContactPhone)) {
      return;
    }

    onSubmit({
      firstName: trimmedFirstName,
      middleName: values.middleName.trim() || null,
      lastName: trimmedLastName,
      identityNumber: trimmedIdentityNumberInner,
      phone: values.phone.trim() || null,
      email: values.email.trim() || null,
      contactName: trimmedContactName || null,
      contactPhone: trimmedContactPhone || null,
      assignedInstructorId: values.assignedInstructorId,
      defaultService: values.defaultService || null,
      defaultDayOfWeek: values.defaultDayOfWeek,
      defaultSessionTime: values.defaultSessionTime,
      notes: values.notes.trim() || null,
      tags: normalizeTagIdsForWrite(values.tagId),
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
  const showContactNameError = false;
  const showContactPhoneError = touched.contactPhone && values.contactPhone.trim() && !validateIsraeliPhone(values.contactPhone);
  const showInstructorError = touched.assignedInstructorId && !values.assignedInstructorId;
  const showDayError = touched.defaultDayOfWeek && !values.defaultDayOfWeek;
  const showTimeError = touched.defaultSessionTime && !values.defaultSessionTime;
  const noInstructorsAvailable = !loadingInstructors && safeInstructors.length === 0;

  // Memoize instructor options to prevent re-render issues with Radix Select
  const instructorOptions = useMemo(() => {
    return safeInstructors.filter(inst => inst?.id).map((inst) => ({
      value: inst.id,
      label: inst.name?.trim() || inst.email?.trim() || inst.id,
    }));
  }, [safeInstructors]);

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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PhoneField
              id="phone"
              name="phone"
              label="טלפון (תלמיד)"
              value={values.phone}
              onChange={handleChange}
              onBlur={handleBlur}
              required={false}
              disabled={isSubmitting}
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
            />
          </div>

          {loadingInstructors ? (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700" role="status">
              טוען רשימת מדריכים...
            </div>
          ) : noInstructorsAvailable ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="alert">
              <p className="font-semibold">לא נמצאו מדריכים פעילים.</p>
              <p>יש ליצור מדריך חדש בלשונית צוות/מדריכים ואז לחזור להוספת תלמיד.</p>
            </div>
          ) : (
            <SelectField
              id="assigned-instructor"
              name="assignedInstructorId"
              label="מדריך משויך"
              value={values.assignedInstructorId}
              onChange={(value) => handleSelectChange('assignedInstructorId', value)}
              onOpenChange={onSelectOpenChange}
              options={instructorOptions}
              placeholder="בחר מדריך"
              required
              disabled={isSubmitting}
              description="מוצגים רק מדריכים פעילים."
              error={showInstructorError ? 'יש לבחור מדריך.' : ''}
            />
          )}

          <TextField
            id="contact-name"
            name="contactName"
            label="שם איש קשר"
            value={values.contactName}
            onChange={handleChange}
            onBlur={handleBlur}
            required={false}
            placeholder="שם הורה או אפוטרופוס (אופציונלי)"
            disabled={isSubmitting}
            error={showContactNameError ? 'יש להזין שם איש קשר.' : ''}
          />

          <PhoneField
            id="contact-phone"
            name="contactPhone"
            label="טלפון איש קשר"
            value={values.contactPhone}
            onChange={handleChange}
            onBlur={handleBlur}
            required={false}
            disabled={isSubmitting}
            error={showContactPhoneError ? 'יש להזין מספר טלפון ישראלי תקין.' : ''}
          />
        </div>

        <div className="space-y-5 py-4">

          <ComboBoxField
            id="default-service"
            name="defaultService"
            label="שירות ברירת מחדל"
            value={values.defaultService}
            onChange={(value) => handleSelectChange('defaultService', value)}
            options={services}
            placeholder={loadingServices ? 'טוען...' : 'בחרו מהרשימה או הקלידו שירות'}
            disabled={isSubmitting || loadingServices}
            dir="rtl"
            emptyMessage="לא נמצאו שירותים תואמים"
            description="ניתן להגדיר שירותים זמינים בעמוד ההגדרות."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DayOfWeekField
              id="default-day"
              name="defaultDayOfWeek"
              label="יום קבוע"
              value={values.defaultDayOfWeek}
              onChange={(value) => handleSelectChange('defaultDayOfWeek', value)}
              required
              disabled={isSubmitting}
              error={showDayError ? 'יש לבחור יום.' : ''}
            />

            <TimeField
              id="default-session-time"
              name="defaultSessionTime"
              label="שעה קבועה"
              value={values.defaultSessionTime}
              onChange={(value) => handleSelectChange('defaultSessionTime', value)}
              required
              disabled={isSubmitting}
              error={showTimeError ? 'יש לבחור שעה.' : ''}
              placeholder="HH:MM"
            />
          </div>

          <StudentTagsField
            value={values.tagId}
            onChange={handleTagChange}
            disabled={isSubmitting}
            description="תגיות לסינון וארגון תלמידים."
          />

          <TextAreaField
            id="notes"
            name="notes"
            label="הערות"
            value={values.notes}
            onChange={handleChange}
            placeholder="הערות נוספות על התלמיד"
            rows={3}
            disabled={isSubmitting}
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

