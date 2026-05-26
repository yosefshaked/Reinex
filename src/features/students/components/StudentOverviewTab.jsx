import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertCircle, Phone, MessageCircle, Mail } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import ErrorMessageText from '@/components/ui/ErrorMessageText.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { coerceAgorot, formatCurrency } from '@/lib/currency.js';
import { isAdminOrOffice, normalizeMembershipRole } from '@/features/students/utils/endpoints.js';

const DAY_NAMES_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DAY_NAME_TO_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function formatDayOfWeek(dayToken) {
  if (dayToken == null) return '';
  const idx = Number(dayToken);
  if (idx >= 0 && idx < DAY_NAMES_HE.length) return `יום ${DAY_NAMES_HE[idx]}`;
  const lower = String(dayToken).toLowerCase();
  if (lower in DAY_NAME_TO_INDEX) {
    return `יום ${DAY_NAMES_HE[DAY_NAME_TO_INDEX[lower]]}`;
  }
  return String(dayToken);
}

function formatTemplateTime(timeValue) {
  if (!timeValue) return '—';
  const timeString = String(timeValue);
  return timeString.length >= 5 ? timeString.slice(0, 5) : timeString;
}

function getInstructorFullName(item) {
  const instructor = item?.instructor || item?.Employees;
  if (!instructor) return '—';
  if (instructor.full_name) return instructor.full_name;
  const fromParts = [instructor.first_name, instructor.last_name].filter(Boolean).join(' ').trim();
  if (fromParts) return fromParts;
  if (instructor.name) return instructor.name;
  return '—';
}

function getServiceName(item) {
  return item?.service?.service_name || item?.service?.name || item?.Services?.name || item?.lesson_name || 'שיעור';
}

function getRangeDates(daysForward) {
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + daysForward);

  return {
    startDate: today.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
  };
}

function resolvePreferredContact(student, guardian) {
  const preference = String(student?.notification_method || '').trim().toLowerCase();
  const guardianPhone = guardian?.phone ? guardian.phone.replace(/[\s\-()]/g, '') : '';
  const emailValue = student?.email || guardian?.email || '';

  if (preference === 'email' && emailValue) {
    return {
      href: `mailto:${emailValue}`,
      label: 'אימייל',
      icon: Mail,
    };
  }

  if (guardianPhone) {
    return {
      href: `https://wa.me/${guardianPhone}`,
      label: 'WhatsApp',
      icon: MessageCircle,
      external: true,
    };
  }

  if (emailValue) {
    return {
      href: `mailto:${emailValue}`,
      label: 'אימייל',
      icon: Mail,
    };
  }

  return null;
}

function formatDateTime(isoString) {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    return date.toLocaleString('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

function formatRelativeTime(isoString) {
  if (!isoString) return null;
  const now = new Date();
  const target = new Date(isoString);
  const diffMs = target - now;
  if (diffMs < 0) return null;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return 'בקרוב';
  if (hours < 24) return `בעוד ${hours} שעות`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'מחר';
  return `בעוד ${days} ימים`;
}

function getGuardianInitials(guardian) {
  const first = guardian?.first_name?.[0] || '';
  const last = guardian?.last_name?.[0] || '';
  return (first + last) || '?';
}

function getGuardianName(guardian) {
  if (!guardian) return '';
  return [guardian.first_name, guardian.last_name].filter(Boolean).join(' ');
}

const RELATIONSHIP_HE = {
  father: 'אב', mother: 'אם', guardian: 'אפוטרופוס',
  grandparent: 'סב/סבתא', other: 'אחר',
};

export default function StudentOverviewTab({ student }) {
  const { session } = useSupabase();
  const { activeOrg } = useOrg();
  
  const [lessonTemplates, setLessonTemplates] = useState([]);
  const [nextLesson, setNextLesson] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [billingSnapshot, setBillingSnapshot] = useState(null);
  const [isBillingLoading, setIsBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState('');

  const activeOrgId = activeOrg?.id;
  const membershipRole = normalizeMembershipRole(activeOrg?.membership?.role);
  const canViewBilling = isAdminOrOffice(membershipRole);
  const studentId = student?.id;
  const guardian = student?.guardian;
  const preferredContact = useMemo(() => resolvePreferredContact(student, guardian), [student, guardian]);

  useEffect(() => {
    if (!studentId || !activeOrgId) return;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ student_id: studentId, org_id: activeOrgId });
        const templates = await authenticatedFetch(
          `api/lesson-templates?${params}`,
          { session }
        );

        const activeTemplates = Array.isArray(templates)
          ? templates.filter((t) => t?.is_active !== false)
          : [];
        setLessonTemplates(activeTemplates);

        // Use the same canonical source as the calendar feature.
        const now = new Date();
        const { startDate, endDate } = getRangeDates(14);
        const allInstances = await authenticatedFetch('calendar/instances', {
          session,
          params: {
            org_id: activeOrgId,
            student_id: studentId,
            start_date: startDate,
            end_date: endDate,
          },
        });

        const upcoming = (Array.isArray(allInstances) ? allInstances : [])
          .filter((item) => {
            const dateValue = new Date(item?.datetime_start);
            return !Number.isNaN(dateValue.getTime()) && dateValue > now;
          })
          .sort((a, b) => new Date(a.datetime_start).getTime() - new Date(b.datetime_start).getTime());

        setNextLesson(upcoming[0] || null);
      } catch (err) {
        console.error('Failed to load overview data', err);
        setError(err?.message || 'טעינת נתוני הסקירה נכשלה');
      } finally {
        setIsLoading(false);
      }
    };

    void fetchData();
  }, [studentId, activeOrgId, session]);

  useEffect(() => {
    if (!studentId || !activeOrgId || !canViewBilling) {
      setBillingSnapshot(null);
      setBillingError('');
      setIsBillingLoading(false);
      return;
    }

    let isMounted = true;

    const fetchBillingSummary = async () => {
      setIsBillingLoading(true);
      setBillingError('');

      try {
        const payload = await authenticatedFetch('billing', {
          session,
          params: {
            org_id: activeOrgId,
            student_id: studentId,
          },
        });

        if (!isMounted) return;
        setBillingSnapshot(payload || null);
      } catch (err) {
        if (!isMounted) return;
        console.error('Failed to load student financial summary', err);
        setBillingSnapshot(null);
        setBillingError(err?.message || 'טעינת הסיכום הכספי נכשלה');
      } finally {
        if (isMounted) {
          setIsBillingLoading(false);
        }
      }
    };

    void fetchBillingSummary();

    return () => {
      isMounted = false;
    };
  }, [activeOrgId, canViewBilling, session, studentId]);

  if (!student) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-neutral-500">לא ניתן לטעון הנתונים</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800 flex items-start gap-2">
        <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
        <div>
          <ErrorMessageText error={error} className="text-sm text-amber-800" supportClassName="text-amber-800" />
        </div>
      </div>
    );
  }

  const tags = Array.isArray(student?.tags) ? student.tags : [];
  const internalNotes = student?.metadata?.internal_notes || '';
  const PreferredContactIcon = preferredContact?.icon || MessageCircle;
  const financialSummary = billingSnapshot?.summary || {};
  const balanceAgorot = coerceAgorot(financialSummary.balance);
  const balanceTone = balanceAgorot > 0
    ? {
      cardClassName: 'bg-emerald-50 border-emerald-100',
      valueClassName: 'text-emerald-700',
      labelClassName: 'text-emerald-600',
      badgeClassName: 'border-emerald-200 bg-emerald-100 text-emerald-800',
      badgeLabel: 'זיכוי',
    }
    : balanceAgorot < 0
      ? {
        cardClassName: 'bg-amber-50 border-amber-100',
        valueClassName: 'text-amber-700',
        labelClassName: 'text-amber-600',
        badgeClassName: 'border-amber-200 bg-amber-100 text-amber-800',
        badgeLabel: 'חוב',
      }
      : {
        cardClassName: 'bg-slate-50 border-slate-200',
        valueClassName: 'text-slate-700',
        labelClassName: 'text-slate-600',
        badgeClassName: 'border-slate-200 bg-slate-100 text-slate-700',
        badgeLabel: 'מאוזן',
      };

  // Compute age
  const age = student?.date_of_birth
    ? Math.floor((Date.now() - new Date(student.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null;

  const relativeTime = nextLesson ? formatRelativeTime(nextLesson.datetime_start) : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">

      {/* ── CARD: Next Lesson (Hero) ── */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden md:col-span-2 xl:col-span-2">
        <div className="h-1.5 bg-green-500" />
        <div className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-lg bg-green-100 text-green-600 flex items-center justify-center text-lg">📅</div>
            <h3 className="font-semibold text-zinc-800">השיעור הבא</h3>
            {relativeTime && (
              <span className="me-auto inline-flex items-center rounded-full bg-green-50 text-green-700 border border-green-200 px-2.5 py-0.5 text-xs font-medium">
                {relativeTime}
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
            </div>
          ) : nextLesson ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-5">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-green-400 to-emerald-500 text-white flex items-center justify-center text-3xl shadow-md shadow-green-200/50 shrink-0">
                📋
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xl font-semibold">{getServiceName(nextLesson)}</p>
                <p className="text-sm text-muted-foreground mt-1">{formatDateTime(nextLesson.datetime_start)}</p>
                <p className="text-sm text-muted-foreground">
                  מדריך/ה: {getInstructorFullName(nextLesson)}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">אין שיעורים קרובים</p>
          )}
        </div>
      </div>

      {/* ── CARD: Guardian ── */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="h-1.5 bg-violet-500" />
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-violet-100 text-violet-600 flex items-center justify-center text-lg">👨‍👩‍👦</div>
            <h3 className="font-semibold text-zinc-800">אפוטרופוס ראשי</h3>
          </div>

          {guardian ? (
            <>
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center font-bold text-sm">
                  {getGuardianInitials(guardian)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{getGuardianName(guardian)}</p>
                  <p className="text-xs text-muted-foreground">
                    {RELATIONSHIP_HE[guardian.relationship] || guardian.relationship || ''}
                  </p>
                </div>
              </div>
              <dl className="text-sm space-y-2">
                {guardian.phone && (
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground text-xs">טלפון</dt>
                    <dd className="font-medium" dir="ltr">{guardian.phone}</dd>
                  </div>
                )}
                {guardian.email && (
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground text-xs">אימייל</dt>
                    <dd className="font-medium text-xs" dir="ltr">{guardian.email}</dd>
                  </div>
                )}
              </dl>
              <div className="flex gap-2 pt-1">
                {(guardian.phone || preferredContact) && (
                  <>
                    {guardian.phone && (
                      <a
                        href={`tel:${guardian.phone}`}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium hover:bg-accent transition"
                      >
                        <Phone className="h-3 w-3" /> התקשר
                      </a>
                    )}
                    {preferredContact && (
                      <a
                        href={preferredContact.href}
                        target={preferredContact.external ? '_blank' : undefined}
                        rel={preferredContact.external ? 'noopener noreferrer' : undefined}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium hover:bg-accent transition"
                      >
                        <PreferredContactIcon className="h-3 w-3" /> {preferredContact.label}
                      </a>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">לא משויך אפוטרופוס</p>
          )}
        </div>
      </div>

      {/* ── CARD: Weekly Schedule ── */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden md:col-span-2">
        <div className="h-1.5 bg-blue-500" />
        <div className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center text-lg">🗓</div>
            <h3 className="font-semibold text-zinc-800">לוח שבועי קבוע</h3>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
            </div>
          ) : lessonTemplates.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="pb-2.5 pe-2 font-medium text-xs">יום</th>
                    <th className="pb-2.5 font-medium text-xs">שעה</th>
                    <th className="pb-2.5 font-medium text-xs">שירות</th>
                    <th className="pb-2.5 font-medium text-xs">מדריך/ה</th>
                  </tr>
                </thead>
                <tbody>
                  {lessonTemplates.map((template) => (
                    <tr key={template.id} className="border-b border-border/60 hover:bg-gray-50/50 transition">
                      <td className="py-3 pe-2 font-medium">{formatDayOfWeek(template.day_of_week)}</td>
                      <td className="py-3">{formatTemplateTime(template.time_of_day)}</td>
                      <td className="py-3">{getServiceName(template)}</td>
                      <td className="py-3">{getInstructorFullName(template)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-2">אין שיעורים קבועים</p>
          )}
        </div>
      </div>

      {/* ── CARD: Financial Summary ── */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="h-1.5 bg-amber-500" />
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center text-lg">💰</div>
            <h3 className="font-semibold text-zinc-800">סיכום כספי</h3>
          </div>
          {!canViewBilling ? (
            <div className="rounded-lg border border-dashed border-border bg-slate-50 p-4 text-sm text-muted-foreground">
              אין הרשאה לצפייה בנתונים כספיים.
            </div>
          ) : isBillingLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
            </div>
          ) : billingError ? (
            <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800 flex items-start gap-2">
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <p>{billingError}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className={`rounded-lg border p-3 text-center ${balanceTone.cardClassName}`}>
                  <p className={`text-xl font-bold ${balanceTone.valueClassName}`}>{formatCurrency(balanceAgorot)}</p>
                  <p className={`text-xs mt-0.5 ${balanceTone.labelClassName}`}>יתרה נוכחית</p>
                </div>
                <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-center">
                  <p className="text-xl font-bold text-blue-700">{formatCurrency(financialSummary.lesson_charge_total)}</p>
                  <p className="text-xs text-blue-600 mt-0.5">חיובי שיעורים</p>
                </div>
                <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-3 text-center">
                  <p className="text-xl font-bold text-indigo-700">{formatCurrency(financialSummary.hmo_charge_total)}</p>
                  <p className="text-xs text-indigo-600 mt-0.5">חיובי גורם מממן</p>
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-center">
                  <p className="text-xl font-bold text-amber-700">{formatCurrency(financialSummary.payment_total)}</p>
                  <p className="text-xs text-amber-600 mt-0.5">תשלומים ידניים</p>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/70 bg-slate-50 px-3 py-2">
                <span className="text-xs text-muted-foreground">הכרטיס מבוסס על נתוני הלדר של התלמיד.</span>
                <Badge variant="outline" className={balanceTone.badgeClassName}>{balanceTone.badgeLabel}</Badge>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── CARD: Internal Notes ── */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden md:col-span-2 xl:col-span-2">
        <div className="h-1.5 bg-yellow-400" />
        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-lg bg-yellow-100 text-yellow-600 flex items-center justify-center text-lg">📝</div>
            <h3 className="font-semibold text-zinc-800">הערות פנימיות</h3>
          </div>
          {internalNotes ? (
            <div className="rounded-lg bg-yellow-50 border border-yellow-100 p-4">
              <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap">{internalNotes}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">אין הערות פנימיות</p>
          )}
        </div>
      </div>

      {/* ── CARD: Personal Details ── */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="h-1.5 bg-gray-400" />
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center text-lg">👤</div>
            <h3 className="font-semibold text-zinc-800">פרטים אישיים</h3>
          </div>
          <dl className="text-sm space-y-3">
            <DetailRow label="שם מלא" value={[student.first_name, student.middle_name, student.last_name].filter(Boolean).join(' ')} />
            {student.identity_number && <DetailRow label="תעודת זהות" value={student.identity_number} />}
            {student.date_of_birth && (
              <DetailRow
                label="תאריך לידה"
                value={`${new Date(student.date_of_birth).toLocaleDateString('he-IL')}${age != null ? ` (גיל ${age})` : ''}`}
              />
            )}
            {student.phone && <DetailRow label="טלפון" value={student.phone} dir="ltr" />}
            {student.email && <DetailRow label="אימייל" value={student.email} dir="ltr" small />}
            {student.notification_method && <DetailRow label="שיטת התראה" value={student.notification_method} />}
          </dl>
        </div>
      </div>

      {/* ── CARD: Tags ── */}
      {tags.length > 0 && (
        <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden xl:col-span-3 md:col-span-2">
          <div className="h-1.5 bg-teal-500" />
          <div className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-lg bg-teal-100 text-teal-600 flex items-center justify-center text-lg">🏷</div>
              <h3 className="font-semibold text-zinc-800">תגיות</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center rounded-full bg-teal-50 text-teal-700 border border-teal-200 px-3 py-1.5 text-xs font-medium"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, dir, small }) {
  return (
    <>
      <div className="flex items-center justify-between">
        <dt className="text-muted-foreground text-xs">{label}</dt>
        <dd className={`font-medium ${small ? 'text-xs' : ''}`} dir={dir}>
          {value || '—'}
        </dd>
      </div>
      <hr className="border-border/50" />
    </>
  );
}
