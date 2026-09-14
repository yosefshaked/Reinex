/* eslint-env node */
/**
 * Lesson history mapping (pure: no DB access).
 *
 * Turns org-scoped `audit_log` rows (resource_type `lesson_instance` / `lesson_participant`)
 * and `calendar_instance_corrections` rows into the typed event list returned by
 * `GET /api/lesson-instances/{id}?view=history` for the lesson dialog history tab.
 *
 * Endpoint writes usually produce more than one audit row per user action:
 * - a control row from `logAuditEvent` (has `action_category` + `actor_email`, details only), and
 * - a tenant row from `logTenantAuditEvent` (no email, but `before_state` / `after_state`),
 * - plus, for attendance, a separate status-transition row.
 * Those duplicates are merged here so one user action becomes one history entry.
 */
import { normalizeLessonInstanceStatus } from './lesson-instance-status.js';

export const LESSON_HISTORY_EVENT_LIMIT = 200;

const MERGE_WINDOW_MS = 2 * 60 * 1000;
const TIME_ZONE = 'Asia/Jerusalem';
const EMPTY_VALUE = '—';
const FALLBACK_PARTICIPANT_NAME = 'משתתף/ת';
const SYSTEM_ACTOR_LABEL = 'מערכת';

export const PARTICIPANT_STATUS_LABELS = Object.freeze({
  scheduled: 'מתוכנן',
  attended: 'נכח/ה',
  no_show: 'לא הגיע/ה',
  cancelled_student: 'ביטול ע"י הלקוח',
  cancelled_clinic: 'ביטול ע"י המכון',
});

const ABSENCE_STATUSES = new Set(['no_show', 'cancelled_student', 'cancelled_clinic']);

const LESSON_STATUS_LABELS = Object.freeze({
  scheduled: 'מתוכנן',
  completed: 'הושלם',
  cancelled: 'בוטל',
});

const LESSON_STATUS_TEXT = Object.freeze({
  cancelled: 'השיעור בוטל',
  completed: 'השיעור הושלם',
  scheduled: 'השיעור הוחזר למצב מתוכנן',
});

const LESSON_FIELD_LABELS = Object.freeze({
  datetime_start: 'מועד',
  duration_minutes: 'משך',
  instructor_employee_id: 'מדריך/ה',
  service_id: 'שירות',
  status: 'סטטוס השיעור',
});

const LESSON_EDIT_FIELDS = ['datetime_start', 'duration_minutes', 'instructor_employee_id', 'service_id'];

const LESSON_CREATE_EVENTS = new Set([
  'calendar.instance_created',
  'calendar.instance.created',
  'calendar.lesson_instance.created',
]);

const LESSON_UPDATE_EVENTS = new Set([
  'calendar.instance_updated',
  'calendar.instance_cancelled',
  'calendar.instance.updated',
  'calendar.lesson_instance.updated',
]);

const CORRECTION_APPLIED_EVENTS = new Set(['locked_correction.applied', 'calendar.instance.corrected']);
const CORRECTION_BLOCKED_EVENTS = new Set([
  'locked_correction.blocked_paid_claim',
  'calendar.instance.correction_blocked_paid_claim',
]);
const CORRECTION_ATTEMPT_EVENTS = new Set([
  'locked_correction.blocked_attempt_task_created',
  'calendar.instance.blocked_attempt_task_created',
]);

const CORRECTION_APPLIED_TEXT = 'בוצע תיקון לשיעור';
const CORRECTION_BLOCKED_TEXT = 'תיקון לשיעור נחסם בגלל תביעה ששולמה';
const CORRECTION_ATTEMPT_TEXT = 'ניסיון תיקון חסום הועבר לבדיקה ידנית';

// Participant status events, mapped to the optional note that explains a cascaded change.
const PARTICIPANT_STATUS_EVENT_NOTES = Object.freeze({
  'calendar.lesson_participant.attendance_updated': null,
  'calendar.lesson_participant.status_transition_applied': null,
  'calendar.lesson_participant.restored_to_scheduled': null,
  'calendar.lesson_participant.cancelled_by_instance': 'בעקבות ביטול השיעור',
  'calendar.lesson_participant.attended_by_instance_completion': 'בעקבות סימון השיעור כהושלם',
  'calendar.lesson_participant.cancelled_student_bulk': 'במסגרת ביטול מרוכז של שיעורי הלקוח',
});

const CREATED_SOURCE_NOTES = Object.freeze({
  weekly_generation: 'נוצר ביצירה שבועית מתבניות',
  manual_reschedule: 'נוצר במסגרת הזזת שיעור',
  migration: 'יובא ממערכת קודמת',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function text(value) {
  if (value == null) return '';
  return String(value).trim();
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function createLookup(source) {
  const map = new Map();
  const entries = source instanceof Map ? source.entries() : Object.entries(plainObject(source));
  for (const [key, value] of entries) {
    const normalizedKey = text(key);
    const normalizedValue = text(value);
    if (normalizedKey && normalizedValue) {
      map.set(normalizedKey, normalizedValue);
    }
  }
  return map;
}

function joinPersonName(person) {
  const row = plainObject(person);
  return [row.first_name, row.last_name].map(text).filter(Boolean).join(' ');
}

export function resolveParticipantDisplayName(participant) {
  const row = plainObject(participant);
  return joinPersonName(row.client_profile)
    || joinPersonName(row.student)
    || text(row.display_name)
    || text(row.full_name)
    || text(row.name);
}

function formatDateTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const parts = Object.fromEntries(
    dateTimeFormatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

function normalizeLessonStatusValue(value) {
  return normalizeLessonInstanceStatus(text(value));
}

function normalizeParticipantStatus(value) {
  return text(value).toLowerCase();
}

function readOverrideReason(metadata) {
  return text(plainObject(plainObject(metadata).scheduling_override).reason);
}

function sameLessonFieldValue(field, left, right) {
  if (field === 'datetime_start') {
    const leftTime = Date.parse(left);
    const rightTime = Date.parse(right);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      return leftTime === rightTime;
    }
  }
  if (field === 'duration_minutes') {
    return Number(left) === Number(right);
  }
  if (field === 'status') {
    return normalizeLessonStatusValue(left) === normalizeLessonStatusValue(right);
  }
  return text(left) === text(right);
}

function formatLessonFieldValue(field, value, ctx) {
  if (value == null || text(value) === '') return EMPTY_VALUE;
  switch (field) {
    case 'datetime_start':
      return formatDateTime(value) || EMPTY_VALUE;
    case 'duration_minutes': {
      const minutes = Math.round(Number(value));
      return Number.isFinite(minutes) && minutes > 0 ? `${minutes} דק'` : EMPTY_VALUE;
    }
    case 'instructor_employee_id':
      return ctx.instructorNames.get(text(value)) || 'מדריך/ה לא מזוהה';
    case 'service_id':
      return ctx.serviceNames.get(text(value)) || 'שירות לא מזוהה';
    case 'status':
      return LESSON_STATUS_LABELS[normalizeLessonStatusValue(value)] || EMPTY_VALUE;
    default:
      return EMPTY_VALUE;
  }
}

// Changes keep an internal `field` key for headline selection; it is stripped from the response.
function diffLessonFields(before, after, fields, ctx) {
  const changes = [];
  for (const field of fields) {
    if (!hasOwn(after, field)) continue;
    if (sameLessonFieldValue(field, before[field], after[field])) continue;
    changes.push({
      field,
      label: LESSON_FIELD_LABELS[field],
      before: formatLessonFieldValue(field, before[field], ctx),
      after: formatLessonFieldValue(field, after[field], ctx),
    });
  }
  return changes;
}

function describeLessonEdit(fields) {
  const changed = new Set(fields);
  if (changed.has('service_id') && [...changed].every((field) => field === 'service_id' || field === 'duration_minutes')) {
    return 'השירות בשיעור עודכן';
  }
  if (changed.size === 1) {
    if (changed.has('datetime_start')) return 'מועד השיעור עודכן';
    if (changed.has('instructor_employee_id')) return 'המדריך/ה בשיעור הוחלף/ה';
    if (changed.has('duration_minutes')) return 'משך השיעור עודכן';
  }
  return 'פרטי השיעור עודכנו';
}

function describeReminder(before, after, name) {
  const wasSeen = before.reminder_seen === true;
  const isSeen = after.reminder_seen === true;
  const wasSent = before.reminder_sent === true;
  const isSent = after.reminder_sent === true;
  if (!wasSeen && isSeen) return `${name} אישר/ה את התזכורת`;
  if (!wasSent && isSent) return `נשלחה תזכורת ל${name}`;
  if (wasSeen && hasOwn(after, 'reminder_seen') && !isSeen) return `סימון אישור התזכורת של ${name} בוטל`;
  if (wasSent && hasOwn(after, 'reminder_sent') && !isSent) return `סימון שליחת התזכורת ל${name} בוטל`;
  return `סטטוס התזכורת של ${name} עודכן`;
}

function describeParticipantStatus(status, name) {
  switch (status) {
    case 'attended':
      return { type: 'attendance', text: `${name} סומן/ה כנוכח/ת` };
    case 'no_show':
      return { type: 'absence', text: `${name} סומן/ה כלא הגיע/ה` };
    case 'cancelled_student':
      return { type: 'absence', text: `נרשם ביטול ע"י הלקוח עבור ${name}` };
    case 'cancelled_clinic':
      return { type: 'absence', text: `נרשם ביטול ע"י המכון עבור ${name}` };
    case 'scheduled':
      return { type: 'status', text: `ההשתתפות של ${name} הוחזרה למצב מתוכנן` };
    default:
      return null;
  }
}

function createActorResolver({ actorNamesByUserId, actorEmailsByUserId }) {
  const names = createLookup(actorNamesByUserId);
  const emails = createLookup(actorEmailsByUserId);
  return {
    forRow(row) {
      if (text(row?.actor_role).toLowerCase() === 'system') return SYSTEM_ACTOR_LABEL;
      const userId = text(row?.actor_user_id);
      return names.get(userId) || text(row?.actor_email) || emails.get(userId) || null;
    },
    forUserId(userId) {
      const normalizedUserId = text(userId);
      return names.get(normalizedUserId) || emails.get(normalizedUserId) || null;
    },
  };
}

function buildContext({
  instance,
  participants,
  corrections,
  actorNamesByUserId,
  actorEmailsByUserId,
  instructorNamesById,
  serviceNamesById,
}) {
  const lesson = plainObject(instance);
  const participantRows = asArray(participants).length > 0 ? asArray(participants) : asArray(lesson.participants);

  const participantNames = new Map();
  const participantStatuses = new Map();
  for (const participant of participantRows) {
    const participantId = text(participant?.id);
    if (!participantId) continue;
    const name = resolveParticipantDisplayName(participant);
    if (name) participantNames.set(participantId, name);
    participantStatuses.set(participantId, normalizeParticipantStatus(participant?.participant_status));
  }

  const instructorNames = createLookup(instructorNamesById);
  const lessonInstructor = plainObject(lesson.instructor);
  if (text(lessonInstructor.id) && joinPersonName(lessonInstructor) && !instructorNames.has(text(lessonInstructor.id))) {
    instructorNames.set(text(lessonInstructor.id), joinPersonName(lessonInstructor));
  }

  const serviceNames = createLookup(serviceNamesById);
  const lessonService = plainObject(lesson.service);
  if (text(lessonService.id) && text(lessonService.name) && !serviceNames.has(text(lessonService.id))) {
    serviceNames.set(text(lessonService.id), text(lessonService.name));
  }

  return {
    instance: lesson,
    participantNames,
    participantStatuses,
    participantName: (participantId) => participantNames.get(text(participantId)) || FALLBACK_PARTICIPANT_NAME,
    instructorNames,
    serviceNames,
    correctionIds: new Set(asArray(corrections).map((row) => text(row?.id)).filter(Boolean)),
    actors: createActorResolver({ actorNamesByUserId, actorEmailsByUserId }),
  };
}

function mapLessonUpdateRow(eventType, base, { details, before, after }, ctx) {
  const hasStates = Object.keys(before).length > 0 && Object.keys(after).length > 0;
  const beforeStatus = normalizeLessonStatusValue(hasStates ? before.status : details.previous_status);
  const afterStatus = eventType === 'calendar.instance_cancelled'
    ? 'cancelled'
    : normalizeLessonStatusValue(hasStates ? after.status : details.status);
  const statusChanged = Boolean(afterStatus) && afterStatus !== beforeStatus;
  const isBulkCancel = text(details.action) === 'bulk-cancel';

  // A student bulk-cancel that leaves the lesson running is fully described by the participant rows.
  if (isBulkCancel && !statusChanged) return null;

  const changes = hasStates ? diffLessonFields(before, after, LESSON_EDIT_FIELDS, ctx) : [];
  const overrideReasonAfter = hasStates ? readOverrideReason(after.metadata) : '';
  const overrideReasonChanged = overrideReasonAfter && overrideReasonAfter !== readOverrideReason(before.metadata);

  let note = null;
  if (isBulkCancel) {
    note = PARTICIPANT_STATUS_EVENT_NOTES['calendar.lesson_participant.cancelled_student_bulk'];
  } else if (overrideReasonChanged) {
    note = `סיבת החריגה: ${overrideReasonAfter}`;
  }

  return {
    ...base,
    type: statusChanged ? 'status' : 'edit',
    text: statusChanged
      ? (LESSON_STATUS_TEXT[afterStatus] || 'סטטוס השיעור עודכן')
      : describeLessonEdit(changes.map((change) => change.field)),
    note,
    changes,
    dedupe: { key: 'lesson:update', crossOrigin: true },
  };
}

function mapLessonAuditRow(eventType, base, payload, ctx) {
  const { details, after } = payload;

  if (LESSON_CREATE_EVENTS.has(eventType)) {
    const reason = text(details.scheduling_override_reason) || readOverrideReason(after.metadata);
    return {
      ...base,
      type: 'create',
      text: 'השיעור נוצר',
      note: reason ? `סיבת החריגה: ${reason}` : null,
      changes: [],
      // A lesson is created once; every create row describes the same action.
      dedupe: { key: 'lesson:create', windowMs: Number.POSITIVE_INFINITY },
    };
  }

  if (LESSON_UPDATE_EVENTS.has(eventType)) {
    return mapLessonUpdateRow(eventType, base, payload, ctx);
  }

  if (CORRECTION_APPLIED_EVENTS.has(eventType) || CORRECTION_BLOCKED_EVENTS.has(eventType)) {
    const correctionId = text(details.correction_id) || text(after.id);
    // The corrections table row is the richer source (reason + patch diff); skip its audit echo.
    if (correctionId && ctx.correctionIds.has(correctionId)) return null;
    return {
      ...base,
      type: 'correction',
      text: CORRECTION_BLOCKED_EVENTS.has(eventType) ? CORRECTION_BLOCKED_TEXT : CORRECTION_APPLIED_TEXT,
      note: text(after.reason_text) || null,
      changes: [],
      dedupe: { key: `correction:${correctionId || base.id}`, crossOrigin: true },
    };
  }

  if (CORRECTION_ATTEMPT_EVENTS.has(eventType)) {
    return {
      ...base,
      type: 'correction',
      text: CORRECTION_ATTEMPT_TEXT,
      note: null,
      changes: [],
      dedupe: { key: `correction-attempt:${text(details.dashboard_task_id) || base.id}`, crossOrigin: true },
    };
  }

  return { ...base, type: 'other', text: 'בוצעה פעולה בשיעור', note: null, changes: [] };
}

function mapParticipantAuditRow(eventType, base, { details, before, after }, participantId, ctx) {
  const name = ctx.participantName(participantId);
  const participantBase = {
    ...base,
    participant_id: participantId || null,
    participant_name: ctx.participantNames.get(participantId) || null,
  };

  if (eventType === 'calendar.lesson_participant.added') {
    return { ...participantBase, type: 'participant', text: `${name} נוסף/ה לשיעור`, note: null, changes: [] };
  }

  if (eventType === 'calendar.lesson_participant.reminder_updated') {
    return { ...participantBase, type: 'reminder', text: describeReminder(before, after, name), note: null, changes: [] };
  }

  if (hasOwn(PARTICIPANT_STATUS_EVENT_NOTES, eventType)) {
    const note = PARTICIPANT_STATUS_EVENT_NOTES[eventType];
    const beforeStatus = normalizeParticipantStatus(before.participant_status || details.previous_status);
    let afterStatus = normalizeParticipantStatus(after.participant_status || details.next_status);
    if (!afterStatus && eventType === 'calendar.lesson_participant.restored_to_scheduled') {
      afterStatus = 'scheduled';
    }

    const headline = afterStatus !== beforeStatus ? describeParticipantStatus(afterStatus, name) : null;
    if (!headline) {
      return { ...participantBase, type: 'other', text: `פרטי ההשתתפות של ${name} עודכנו`, note, changes: [] };
    }

    const changes = PARTICIPANT_STATUS_LABELS[beforeStatus]
      ? [{ label: 'סטטוס השתתפות', before: PARTICIPANT_STATUS_LABELS[beforeStatus], after: PARTICIPANT_STATUS_LABELS[afterStatus] }]
      : [];

    return {
      ...participantBase,
      ...headline,
      note,
      changes,
      // attendance_updated + status_transition_applied/restored_to_scheduled describe one transition.
      dedupe: { key: `participant:${participantId}:status:${beforeStatus}:${afterStatus}` },
    };
  }

  return { ...participantBase, type: 'other', text: `בוצעה פעולה עבור ${name}`, note: null, changes: [] };
}

function mapAuditRow(row, ctx) {
  const eventType = text(row?.event_type);
  // UAT/debug tooling rows are diagnostics, not lesson history.
  if (!eventType || eventType.startsWith('debug_uat.') || eventType.endsWith('_debug_uat')) return null;

  const time = Date.parse(row?.created_at);
  if (!Number.isFinite(time)) return null;

  const base = {
    id: `audit:${text(row.id) || time}`,
    time,
    occurred_at: new Date(time).toISOString(),
    origin: text(row.action_category) ? 'control' : 'tenant',
    actor: ctx.actors.forRow(row),
    participant_id: null,
    participant_name: null,
  };
  const payload = {
    details: plainObject(row.details),
    before: plainObject(row.before_state),
    after: plainObject(row.after_state),
  };

  if (text(row.resource_type) === 'lesson_participant') {
    return mapParticipantAuditRow(eventType, base, payload, text(row.resource_id), ctx);
  }
  return mapLessonAuditRow(eventType, base, payload, ctx);
}

function buildCorrectionEvents(corrections, ctx) {
  const rows = asArray(corrections)
    .filter((row) => text(row?.id) && Number.isFinite(Date.parse(row?.created_at)))
    .filter((row) => text(row.status).toLowerCase() !== 'previewed')
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));

  // Corrections never mutate the base lesson rows; each applied correction layers on the previous one.
  let currentInstance = { ...ctx.instance };
  const currentStatuses = new Map(ctx.participantStatuses);
  const events = [];

  for (const row of rows) {
    const blocked = text(row.status).toLowerCase() === 'blocked';
    const instancePatch = plainObject(row.instance_patch);
    const nextInstance = { ...currentInstance, ...instancePatch };
    const changes = diffLessonFields(currentInstance, nextInstance, [...LESSON_EDIT_FIELDS, 'status'], ctx)
      .filter((change) => hasOwn(instancePatch, change.field));

    const patchedParticipantIds = [];
    for (const patch of asArray(row.participant_patches)) {
      const participantId = text(patch?.participant_id || patch?.participantId || patch?.id);
      if (!participantId || !hasOwn(plainObject(patch), 'participant_status')) continue;
      const nextStatus = normalizeParticipantStatus(patch.participant_status);
      const previousStatus = currentStatuses.get(participantId) || '';
      if (!PARTICIPANT_STATUS_LABELS[nextStatus] || nextStatus === previousStatus) continue;
      patchedParticipantIds.push(participantId);
      changes.push({
        label: `סטטוס ${ctx.participantName(participantId)}`,
        before: PARTICIPANT_STATUS_LABELS[previousStatus] || EMPTY_VALUE,
        after: PARTICIPANT_STATUS_LABELS[nextStatus],
      });
      if (!blocked) currentStatuses.set(participantId, nextStatus);
    }

    const singleParticipantId = patchedParticipantIds.length === 1 && changes.length === 1
      ? patchedParticipantIds[0]
      : null;
    const time = Date.parse(row.created_at);
    events.push({
      id: `correction:${text(row.id)}`,
      time,
      occurred_at: new Date(time).toISOString(),
      origin: 'correction',
      actor: ctx.actors.forUserId(row.created_by),
      participant_id: singleParticipantId,
      participant_name: singleParticipantId ? ctx.participantNames.get(singleParticipantId) || null : null,
      type: 'correction',
      text: blocked ? CORRECTION_BLOCKED_TEXT : CORRECTION_APPLIED_TEXT,
      note: text(row.reason_text) || null,
      changes,
    });

    if (!blocked) currentInstance = nextInstance;
  }

  return events;
}

function canMerge(candidate, event) {
  if (!candidate.dedupe || candidate.dedupe.key !== event.dedupe.key) return false;
  const windowMs = event.dedupe.windowMs ?? MERGE_WINDOW_MS;
  if (Math.abs(event.time - candidate.time) > windowMs) return false;
  // Lesson-level pairs are one control row + one tenant row; two tenant rows are two real actions.
  if (event.dedupe.crossOrigin && candidate.origins.has(event.origin)) return false;
  return true;
}

function absorb(target, event) {
  target.origins.add(event.origin);
  const eventIsRicher = event.changes.length > target.changes.length;
  const eventIsStatus = event.type === 'status' && target.type !== 'status';
  const targetKeepsStatus = target.type === 'status' && event.type !== 'status';
  if (eventIsStatus || (eventIsRicher && !targetKeepsStatus)) {
    target.type = event.type;
    target.text = event.text;
  }
  if (eventIsRicher) target.changes = event.changes;
  if (!target.actor && event.actor) target.actor = event.actor;
  if (!target.note && event.note) target.note = event.note;
}

function mergeDuplicateEvents(events) {
  const merged = [];
  for (const event of [...events].sort((left, right) => left.time - right.time)) {
    const target = event.dedupe ? merged.find((candidate) => canMerge(candidate, event)) : null;
    if (target) {
      absorb(target, event);
    } else {
      merged.push({ ...event, origins: new Set([event.origin]) });
    }
  }
  return merged;
}

function buildSyntheticCreateEvent(ctx) {
  const lesson = ctx.instance;
  const time = Date.parse(lesson.created_at);
  if (!text(lesson.id) || !Number.isFinite(time)) return null;
  return {
    id: `lesson-created:${text(lesson.id)}`,
    time,
    occurred_at: new Date(time).toISOString(),
    actor: ctx.actors.forUserId(lesson.created_by),
    participant_id: null,
    participant_name: null,
    type: 'create',
    text: 'השיעור נוצר',
    note: CREATED_SOURCE_NOTES[text(lesson.created_source)] || null,
    changes: [],
  };
}

function toResponseEvent(event) {
  return {
    id: event.id,
    occurred_at: event.occurred_at,
    type: event.type,
    actor: event.actor || null,
    participant_id: event.participant_id || null,
    participant_name: event.participant_name || null,
    text: event.text,
    note: event.note || null,
    changes: asArray(event.changes).map(({ label, before, after }) => ({ label, before, after })),
  };
}

/**
 * Collect instructor/service ids referenced by audit states and correction patches,
 * so the endpoint can resolve display names before calling buildLessonHistoryEvents.
 */
export function collectLessonHistoryReferenceIds({ auditRows = [], corrections = [] } = {}) {
  const instructorIds = new Set();
  const serviceIds = new Set();
  const collect = (source) => {
    const row = plainObject(source);
    if (text(row.instructor_employee_id)) instructorIds.add(text(row.instructor_employee_id));
    if (text(row.service_id)) serviceIds.add(text(row.service_id));
  };

  for (const row of asArray(auditRows)) {
    collect(row?.before_state);
    collect(row?.after_state);
    collect(row?.details);
  }
  for (const row of asArray(corrections)) {
    collect(row?.instance_patch);
    collect(plainObject(row?.effective_state).instance);
  }

  return { instructorIds: [...instructorIds], serviceIds: [...serviceIds] };
}

/**
 * Build the lesson history response events (newest first, capped).
 *
 * @param {object} params
 * @param {object} [params.instance] lesson_instances row (used for the synthetic create entry and correction baselines)
 * @param {object[]} [params.participants] lesson participants with `client_profile` names (defaults to instance.participants)
 * @param {object[]} [params.auditRows] audit_log rows for the lesson and its participants
 * @param {object[]} [params.corrections] calendar_instance_corrections rows for the lesson
 * @param {Map|object} [params.actorNamesByUserId] user id -> display name
 * @param {Map|object} [params.actorEmailsByUserId] user id -> email (fallback when no name)
 * @param {Map|object} [params.instructorNamesById] employee id -> display name
 * @param {Map|object} [params.serviceNamesById] service id -> name
 * @param {number} [params.limit]
 */
export function buildLessonHistoryEvents({
  instance = null,
  participants = [],
  auditRows = [],
  corrections = [],
  actorNamesByUserId = null,
  actorEmailsByUserId = null,
  instructorNamesById = null,
  serviceNamesById = null,
  limit = LESSON_HISTORY_EVENT_LIMIT,
} = {}) {
  const ctx = buildContext({
    instance,
    participants,
    corrections,
    actorNamesByUserId,
    actorEmailsByUserId,
    instructorNamesById,
    serviceNamesById,
  });

  const auditEvents = asArray(auditRows).map((row) => mapAuditRow(row, ctx)).filter(Boolean);
  const events = [
    ...mergeDuplicateEvents(auditEvents),
    ...buildCorrectionEvents(corrections, ctx),
  ];

  if (!events.some((event) => event.type === 'create')) {
    const createEvent = buildSyntheticCreateEvent(ctx);
    if (createEvent) events.push(createEvent);
  }

  return events
    .sort((left, right) => (right.time - left.time) || right.id.localeCompare(left.id))
    .slice(0, Math.max(0, Number(limit) || LESSON_HISTORY_EVENT_LIMIT))
    .map(toResponseEvent);
}
