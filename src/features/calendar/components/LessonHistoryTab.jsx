import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  Check,
  FileCheck,
  Flag,
  Info,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  UserPlus,
  Wallet,
  XCircle,
} from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { authenticatedFetch } from '@/lib/api-client.js';
import { resolveMutationError } from '../utils/lessonDialogModel.js';

const EVENT_META = {
  create: { Icon: Plus, className: 'bg-slate-100 text-slate-500' },
  reminder: { Icon: Bell, className: 'bg-amber-50 text-amber-700' },
  attendance: { Icon: Check, className: 'bg-emerald-50 text-emerald-700' },
  absence: { Icon: XCircle, className: 'bg-red-50 text-red-700' },
  report: { Icon: FileCheck, className: 'bg-emerald-50 text-emerald-700' },
  edit: { Icon: Pencil, className: 'bg-primary/10 text-primary' },
  participant: { Icon: UserPlus, className: 'bg-primary/10 text-primary' },
  status: { Icon: Flag, className: 'bg-slate-100 text-slate-500' },
  payroll: { Icon: Wallet, className: 'bg-violet-50 text-violet-700' },
  correction: { Icon: ShieldCheck, className: 'bg-sky-50 text-sky-700' },
  other: { Icon: Info, className: 'bg-slate-100 text-slate-500' },
};

const SOURCE_LABELS = {
  template: 'נוצר מתבנית שבועית',
  generation: 'נוצר מתבנית שבועית',
  template_generation: 'נוצר מתבנית שבועית',
  manual: 'נוצר ידנית מהלוח',
  calendar: 'נוצר ידנית מהלוח',
  migration: 'ייבוא נתונים',
  import: 'ייבוא נתונים',
};

function localDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dayLabel(dayKey) {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (dayKey === localDayKey(today)) return 'היום';
  if (dayKey === localDayKey(yesterday)) return 'אתמול';
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, day));
}

function formatTime(date) {
  return new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function groupEventsByDay(events) {
  const groups = [];
  for (const event of events) {
    const date = new Date(event?.occurred_at);
    if (Number.isNaN(date.getTime())) continue;
    const key = localDayKey(date);
    const last = groups[groups.length - 1];
    const entry = { ...event, date };
    if (last && last.key === key) last.items.push(entry);
    else groups.push({ key, items: [entry] });
  }
  return groups;
}

/**
 * Lesson history — typed audit events for this lesson and its participants, grouped by day.
 * Data: GET lesson-instances/{id}?view=history (admin / owner / office only).
 */
export function LessonHistoryTab({ orgId, instanceId, version, exceptionReason, createdSource, lessonId }) {
  const [state, setState] = useState({ status: 'loading', events: [], error: '' });
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!orgId || !instanceId) return;
    const requestId = ++requestIdRef.current;
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const payload = await authenticatedFetch(`lesson-instances/${instanceId}`, {
        params: { org_id: orgId, view: 'history' },
      });
      if (requestId !== requestIdRef.current) return;
      setState({ status: 'ready', events: Array.isArray(payload?.events) ? payload.events : [], error: '' });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.error('Failed to load lesson history', err);
      setState({ status: 'error', events: [], error: resolveMutationError(err) || 'טעינת ההיסטוריה נכשלה.' });
    }
  }, [instanceId, orgId]);

  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [load, version]);

  const groups = groupEventsByDay(state.events);

  return (
    <div className="flex flex-col gap-4">
      {exceptionReason ? (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[13px] font-semibold text-amber-800">
          <Flag className="mt-0.5 h-4 w-4 shrink-0" />
          <span>שיבוץ חריג מחוץ לזמינות · {exceptionReason}</span>
        </div>
      ) : null}

      {state.status === 'loading' && state.events.length === 0 ? (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> טוענים את ההיסטוריה...
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span>{state.error}</span>
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 bg-white text-xs" onClick={() => void load()}>
            <RotateCcw className="h-3.5 w-3.5" /> נסו שוב
          </Button>
        </div>
      ) : null}

      {state.status === 'ready' && groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
          עדיין אין פעולות מתועדות לשיעור הזה.
        </div>
      ) : null}

      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-2">
          <h4 className="px-1 text-[12.5px] font-bold text-slate-500">{dayLabel(group.key)}</h4>
          <ol className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {group.items.map((event) => {
              const meta = EVENT_META[event.type] || EVENT_META.other;
              const changes = Array.isArray(event.changes) ? event.changes : [];
              return (
                <li key={event.id} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-3 px-3.5 py-3">
                  <span className={`grid h-8 w-8 place-items-center rounded-[10px] ${meta.className}`} aria-hidden="true">
                    <meta.Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="text-[13.5px] font-bold text-slate-900">{event.text}</div>
                    {event.note ? <div className="text-[12.5px] text-slate-600">{event.note}</div> : null}
                    {changes.length ? (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {changes.map((change, index) => (
                          <span key={`${change.label}-${index}`} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2 py-1 text-[12px]">
                            <span className="font-bold text-primary">{change.label}</span>
                            <span className="text-slate-500 line-through">{change.before}</span>
                            <ArrowLeft className="h-3 w-3 text-slate-400" aria-hidden="true" />
                            <span className="font-bold text-slate-900">{change.after}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {event.actor ? <div className="text-xs text-slate-500">{event.actor}</div> : null}
                  </div>
                  <time className="pt-1.5 text-[13px] font-bold text-slate-500 tabular-nums" dateTime={event.occurred_at}>
                    {formatTime(event.date)}
                  </time>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      <details className="px-1 text-[12.5px] text-slate-500">
        <summary className="cursor-pointer font-bold">פרטים טכניים</summary>
        <dl className="mt-2.5 grid grid-cols-3 gap-4">
          <div>
            <dt className="text-xs font-bold text-slate-400">מקור</dt>
            <dd className="mt-0.5 font-bold text-slate-700">{SOURCE_LABELS[String(createdSource || '').toLowerCase()] || 'לא ידוע'}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-slate-400">מזהה</dt>
            <dd className="mt-0.5 font-bold text-slate-700"><bdi dir="ltr">…{String(lessonId || '').slice(-8)}</bdi></dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-slate-400">גרסה</dt>
            <dd className="mt-0.5 font-bold text-slate-700 tabular-nums">{version ?? '—'}</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
