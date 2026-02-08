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
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { validateIsraeliPhone } from '@/components/ui/helpers/phone';
import StudentTagsField from './StudentTagsField.jsx';
import MedicalProviderField from './MedicalProviderField.jsx';
import { normalizeTagIdsForWrite } from '@/features/students/utils/tags.js';
import { createStudentFormState } from '@/features/students/utils/form-state.js';
import { useIdentityNumberGuard } from '@/features/admin/hooks/useStudentDeduplication.js';
import { useServices } from '@/hooks/useOrgData.js';

const IDENTITY_NUMBER_PATTERN = /^\d{5,12}$/;

export default function EditStudentForm({ 
  student, 
  onSubmit, 
  onCancel, 
  isSubmitting = false, 
  error = '', 
  renderFooterOutside = false,
  onSubmitDisabledChange = () => {},
}) {
  const [values, setValues] = useState(() => createStudentFormState(student));
  const [touched, setTouched] = useState({});
  const { services = [], loadingServices } = useServices();
  
  // Track the ID of the student currently being edited
  const currentStudentIdRef = useRef(student?.id);
  const excludeStudentId = student?.id; // Use stable reference for hook dependency

  const { duplicate, loading: checkingIdentityNumber, error: identityNumberError } = useIdentityNumberGuard(values.identityNumber, {
    excludeStudentId,
  });

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
      contactName: true,
      contactPhone: true,
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
        !values.defaultDayOfWeek || !values.defaultSessionTime) {
      return;
    }

    if (!IDENTITY_NUMBER_PATTERN.test(trimmedIdentityNumberInner)) {
      return;
    }

    if (!validateIsraeliPhone(trimmedContactPhone)) {
      return;
    }

    onSubmit({
      id: student?.id,
      firstName: trimmedFirstName,
      middleName: values.middleName.trim() || null,
      lastName: trimmedLastName,
      identityNumber: trimmedIdentityNumberInner,
      phone: values.phone.trim() || null,
      email: values.email.trim() || null,
      medicalProvider: values.medicalProvider?.trim() || null,
      contactName: trimmedContactName || null,
      contactPhone: trimmedContactPhone || null,
      defaultService: values.defaultService || null,
      defaultDayOfWeek: values.defaultDayOfWeek,
      defaultSessionTime: values.defaultSessionTime,
      notes: values.notes.trim() || null,
      tags: normalizeTagIdsForWrite(values.tags),
      isActive: values.isActive !== false,
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
  const showContactNameError = false;
  const showContactPhoneError = touched.contactPhone && values.contactPhone.trim() && !validateIsraeliPhone(values.contactPhone);
  const showDayError = touched.defaultDayOfWeek && !values.defaultDayOfWeek;
  const showTimeError = touched.defaultSessionTime && !values.defaultSessionTime;
  const isInactive = values.isActive === false;

  return (
    <form id="edit-student-form" onSubmit={handleSubmit} className="space-y-5" dir="rtl">
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

          <MedicalProviderField
            value={values.medicalProvider}
            onChange={(nextValue) => handleSelectChange('medicalProvider', nextValue)}
            disabled={isSubmitting}
            description="אופציונלי"
          />

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

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 text-right" role="alert">
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
