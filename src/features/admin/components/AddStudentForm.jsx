import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useStudentNameSuggestions, useNationalIdGuard } from '@/features/admin/hooks/useStudentDeduplication.js';
import { useInstructors, useServices } from '@/hooks/useOrgData.js';

export default function AddStudentForm({ 
  onSubmit, 
  onCancel, 
  isSubmitting = false, 
  error = '', 
  renderFooterOutside = false,
  onSelectOpenChange, // Mobile fix: callback for Select open/close tracking
  onSubmitDisabledChange = () => {},
  initialValues = {},
}) {
  const initialState = useMemo(() => ({ ...createStudentFormState(), ...initialValues }), [initialValues]);
  const [values, setValues] = useState(() => initialState);
  const [touched, setTouched] = useState({});
  const { services, loadingServices } = useServices();
  const { instructors, loadingInstructors } = useInstructors();

  const { suggestions, loading: searchingNames } = useStudentNameSuggestions(values.name);
  const { duplicate, loading: checkingNationalId, error: nationalIdError } = useNationalIdGuard(values.nationalId);

  const preventSubmitReason = useMemo(() => {
    if (duplicate) return 'duplicate';
    if (nationalIdError) return 'error';
    return '';
  }, [duplicate, nationalIdError]);

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
      name: true,
      nationalId: true,
      contactName: true,
      contactPhone: true,
      assignedInstructorId: true,
      defaultDayOfWeek: true,
      defaultSessionTime: true,
    };
    setTouched(newTouched);

    const trimmedName = values.name.trim();
    const trimmedContactName = values.contactName.trim();
    const trimmedContactPhone = values.contactPhone.trim();
    const trimmedNationalId = values.nationalId.trim();

    if (duplicate || nationalIdError) {
      return;
    }

    if (!trimmedName || !trimmedNationalId || !trimmedContactName || !trimmedContactPhone ||
        !values.assignedInstructorId || !values.defaultDayOfWeek || !values.defaultSessionTime) {
      return;
    }

    if (!validateIsraeliPhone(trimmedContactPhone)) {
      return;
    }

    onSubmit({
      name: trimmedName,
      nationalId: trimmedNationalId,
      contactName: trimmedContactName,
      contactPhone: trimmedContactPhone,
      assignedInstructorId: values.assignedInstructorId,
      defaultService: values.defaultService || null,
      defaultDayOfWeek: values.defaultDayOfWeek,
      defaultSessionTime: values.defaultSessionTime,
      notes: values.notes.trim() || null,
      tags: normalizeTagIdsForWrite(values.tagId),
      isActive: values.isActive !== false,
    });
  };

  const trimmedNationalId = values.nationalId.trim();
  const showNameError = touched.name && !values.name.trim();
  const nationalIdErrorMessage = (() => {
    // Avoid double-surfacing duplicates; detailed banner handles it
    if (duplicate) return '';
    if (nationalIdError) return nationalIdError;
    if (error === 'duplicate_national_id') return '';
    if (touched.nationalId && !trimmedNationalId) return 'יש להזין מספר זהות.';
    return '';
  })();
  const showContactNameError = touched.contactName && !values.contactName.trim();
  const showContactPhoneError = touched.contactPhone && (!values.contactPhone.trim() || !validateIsraeliPhone(values.contactPhone));
  const showInstructorError = touched.assignedInstructorId && !values.assignedInstructorId;
  const showDayError = touched.defaultDayOfWeek && !values.defaultDayOfWeek;
  const showTimeError = touched.defaultSessionTime && !values.defaultSessionTime;

  return (
    <form id="add-student-form" onSubmit={handleSubmit} className="space-y-5" dir="rtl">
      {error && error !== 'duplicate_national_id' && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      <div className="space-y-5 divide-y divide-border">
        <div className="space-y-5 py-1">
          <TextField
            id="student-name"
            name="name"
            label="שם התלמיד"
            value={values.name}
            onChange={handleChange}
            onBlur={handleBlur}
            required
            placeholder="הקלד את שם התלמיד"
            disabled={isSubmitting}
            error={showNameError ? 'יש להזין שם תלמיד.' : ''}
          />

          {suggestions.length > 0 && (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-800 space-y-2" role="note">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">האם אחד מהם התלמיד שאתם מחפשים?</p>
                {searchingNames && <Loader2 className="h-4 w-4 animate-spin text-neutral-500" aria-hidden="true" />}
              </div>
              <ul className="space-y-1">
                {suggestions.map((match) => (
                  <li key={match.id} className="flex items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="font-semibold text-neutral-900">{match.name}</div>
                      <div className="text-xs text-neutral-600">מספר זהות: {match.national_id || '—'} | סטטוס: {match.is_active === false ? 'לא פעיל' : 'פעיל'}</div>
                    </div>
                    <Link
                      to={`/students/${match.id}`}
                      className="text-primary text-xs font-medium underline underline-offset-2 hover:text-primary/80"
                    >
                      מעבר לפרופיל
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <TextField
            id="national-id"
            name="nationalId"
            label="מספר זהות"
            value={values.nationalId}
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder="הקלד מספר זהות למניעת כפילויות"
            disabled={isSubmitting}
            required
            error={nationalIdErrorMessage}
            description={checkingNationalId ? 'בודק כפילויות...' : ''}
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

          <SelectField
            id="assigned-instructor"
            name="assignedInstructorId"
            label="מדריך משויך"
            value={values.assignedInstructorId}
            onChange={(value) => handleSelectChange('assignedInstructorId', value)}
            onOpenChange={onSelectOpenChange}
            options={instructors.map((inst) => ({
              value: inst.id,
              label: inst.name || inst.email || inst.id,
            }))}
            placeholder={loadingInstructors ? 'טוען...' : 'בחר מדריך'}
            required
            disabled={isSubmitting || loadingInstructors}
            description="מוצגים רק מדריכים פעילים."
            error={showInstructorError ? 'יש לבחור מדריך.' : ''}
          />

          <TextField
            id="contact-name"
            name="contactName"
            label="שם איש קשר"
            value={values.contactName}
            onChange={handleChange}
            onBlur={handleBlur}
            required
            placeholder="שם הורה או אפוטרופוס"
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
            required
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
              id="default-time"
              name="defaultSessionTime"
              label="שעת מפגש קבועה"
              value={values.defaultSessionTime}
              onChange={(value) => handleSelectChange('defaultSessionTime', value)}
              disabled={isSubmitting}
              required
              error={showTimeError ? 'יש לבחור שעה.' : ''}
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
      <Button onClick={onSubmit} disabled={isSubmitting || disableSubmit} className="gap-2 shadow-md hover:shadow-lg transition-shadow">
        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        שמירת תלמיד חדש
      </Button>
      <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting} className="hover:shadow-sm">
        ביטול
      </Button>
    </div>
  );
}

