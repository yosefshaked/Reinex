import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Phone, MessageCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';

const DAY_NAMES_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function formatDayOfWeek(dayToken) {
  if (dayToken == null) return '';
  const idx = Number(dayToken);
  if (idx >= 0 && idx < DAY_NAMES_HE.length) return `יום ${DAY_NAMES_HE[idx]}`;
  return String(dayToken);
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

  const activeOrgId = activeOrg?.id;
  const studentId = student?.id;

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

        // Fetch next 7 days to find first upcoming lesson
        const today = new Date();
        let upcoming = null;
        for (let d = 0; d < 7 && !upcoming; d++) {
          const date = new Date(today);
          date.setDate(today.getDate() + d);
          const dateStr = date.toISOString().split('T')[0];
          const instances = await authenticatedFetch(
            `api/lesson-instances?date=${dateStr}&student_id=${studentId}&org_id=${activeOrgId}`,
            { session }
          );
          if (Array.isArray(instances)) {
            upcoming = instances.find((li) => new Date(li.datetime_start) > new Date());
          }
        }
        setNextLesson(upcoming || null);
      } catch (err) {
        console.error('Failed to load overview data', err);
        setError(err?.message || 'טעינת נתוני הסקירה נכשלה');
      } finally {
        setIsLoading(false);
      }
    };

    void fetchData();
  }, [studentId, activeOrgId, session]);

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
        <p>{error}</p>
      </div>
    );
  }

  const guardian = student?.guardian;
  const tags = Array.isArray(student?.tags) ? student.tags : [];
  const internalNotes = student?.metadata?.internal_notes || '';

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
                <p className="text-xl font-semibold">{nextLesson.service?.name || 'שיעור'}</p>
                <p className="text-sm text-muted-foreground mt-1">{formatDateTime(nextLesson.datetime_start)}</p>
                {nextLesson.instructor && (
                  <p className="text-sm text-muted-foreground">
                    מדריך/ה: {nextLesson.instructor.first_name} {nextLesson.instructor.last_name || ''}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">לא נמצאו שיעורים קרובים</p>
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
                {guardian.phone && (
                  <>
                    <a
                      href={`tel:${guardian.phone}`}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium hover:bg-accent transition"
                    >
                      <Phone className="h-3 w-3" /> התקשר
                    </a>
                    <a
                      href={`https://wa.me/${guardian.phone.replace(/[\s\-()]/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium hover:bg-accent transition"
                    >
                      <MessageCircle className="h-3 w-3" /> WhatsApp
                    </a>
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
                    <th className="pb-2.5 font-medium text-xs">סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {lessonTemplates.map((template) => (
                    <tr key={template.id} className="border-b border-border/60 hover:bg-gray-50/50 transition">
                      <td className="py-3 pe-2 font-medium">{formatDayOfWeek(template.day_of_week)}</td>
                      <td className="py-3">{template.time_of_day || '—'}</td>
                      <td className="py-3">{template.service?.name || '—'}</td>
                      <td className="py-3">
                        {template.instructor?.first_name
                          ? `${template.instructor.first_name} ${template.instructor.last_name || ''}`
                          : '—'}
                      </td>
                      <td className="py-3">
                        <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 text-xs">
                          קבוע
                        </Badge>
                      </td>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3 text-center">
              <p className="text-xl font-bold text-emerald-700">—</p>
              <p className="text-xs text-emerald-600 mt-0.5">יתרת זכות</p>
            </div>
            <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-center">
              <p className="text-xl font-bold text-amber-700">—</p>
              <p className="text-xs text-amber-600 mt-0.5">חוב פתוח</p>
            </div>
            <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-center">
              <p className="text-xl font-bold text-blue-700">{lessonTemplates.length * 4}</p>
              <p className="text-xs text-blue-600 mt-0.5">שיעורים/חודש (הערכה)</p>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-center">
              <p className="text-xl font-bold text-zinc-700">
                {student?.special_rate ? `₪${student.special_rate}` : '—'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">תעריף לשיעור</p>
            </div>
          </div>
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
