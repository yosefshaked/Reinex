// @ts-check
/* eslint-env node */
/**
 * Pay is computed from the facts each time it is shown. Nothing computed is stored.
 *
 * The facts are: the lesson in the calendar (instructor, service, date, length), what happened to
 * each participant, the dated rates, office hours, leave, and bonuses or deductions entered by hand.
 * Every screen that shows pay or lesson hours reads them through this file, so two screens can
 * never disagree and there is no copy to keep in step.
 */
import { normalizeString, withOrgScope } from './org-bff.js';
import { chunkArray, selectInChunks } from './query-chunks.js';
import { coerceAgorot } from './currency.js';
import { roundTo2 } from './round.js';
import { extractScheduleSlotFromIso } from './instructor-availability.js';
import {
  addDays,
  addMonths,
  dateKeyFromParts,
  enumerateDateKeys,
  firstDayOfMonth,
  lastDayOfMonth,
  localDateKey,
  localDateRangeUtc,
  parseDateKey,
  weekdayOfDateKey,
} from './local-time.js';
import {
  LEGAL_LEAVE_MAX_DEPTH,
  LEGAL_LEAVE_SEARCH_MONTHS,
  collectWorkedDates,
  combinePayComponents,
  countWorkingDaysInRange,
  createLeaveDayValuer,
  fetchApprovedLeaveDays,
  financePoliciesOnDate,
  fetchAttendanceRecords,
  legalLeaveHistoryStart,
  listFinanceCorrections,
  loadFinancePolicies,
  loadGraceCancellationParticipantIds,
  loadLeavePayMethodVersions,
  priceAttendanceRecords,
  resolveCompensationEligibleParticipants,
  resolveEmployeeWorkingDays,
  resolveLessonInstructorPayout,
} from './employee-finance.js';
import {
  LESSON_PAY_BASES,
  PAY_BASIS,
  hasRateKind,
  loadRateHistoryRows,
  resolveLessonRateOnDate,
  resolveRateOnDate,
} from './rate-history.js';

// The days an employee worked live next to the leave-day value that also counts them.
export { collectWorkedDates };

const PAGE_SIZE = 1000;
const ID_CHUNK_SIZE = 100;
const LESSON_COLUMNS = 'id, org_id, instructor_employee_id, service_id, datetime_start, duration_minutes, status';
const PARTICIPANT_COLUMNS = 'id, lesson_instance_id, student_id, participant_status, metadata';

/** Reads every row of a query, a page at a time; one request returns at most 1000 rows. */
async function fetchAllRows(buildQuery, { ignoreMissingTable = false } = {}) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) {
      if (ignoreMissingTable && error.code === '42P01') return rows;
      throw error;
    }
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

// Same calendar day `deltaMonths` away; a day the target month lacks rolls over, as before.
function shiftMonths(dateKey, deltaMonths) {
  const parsed = parseDateKey(localDateKey(dateKey));
  if (!parsed) return '';
  return dateKeyFromParts(parsed.year, parsed.month + deltaMonths, parsed.day);
}

/** A lesson has ended once its start time plus its length is behind us. */
export function hasLessonEnded(instance, now = new Date()) {
  const start = new Date(instance?.datetime_start).getTime();
  if (!Number.isFinite(start)) return false;
  const lengthMs = Math.max(0, Number(instance?.duration_minutes) || 0) * 60 * 1000;
  return start + lengthMs <= new Date(now).getTime();
}

/**
 * The participants as pay sees them. A participant nobody marked, in a lesson that has ended and
 * was not cancelled, is counted as having attended: most lessons do take place, and an instructor's
 * pay must not wait for a mark. The lesson stays flagged as unmarked so the office can see it.
 */
export function resolveParticipantsForPay(instance, participants = [], now = new Date()) {
  const assumeAttended = hasLessonEnded(instance, now)
    && normalizeString(instance?.status).toLowerCase() !== 'cancelled';
  const unmarkedIds = new Set();
  const resolved = (participants || []).map((participant) => {
    const status = normalizeString(participant?.participant_status).toLowerCase();
    if (!assumeAttended || status !== 'scheduled') return participant;
    unmarkedIds.add(participant?.id);
    return { ...participant, participant_status: 'attended' };
  });
  return { participants: resolved, unmarkedIds };
}

/** A lesson as it stands after the latest correction applied to it, if any. */
export function applyCorrectionOverlay(instance, participants = [], correction = null) {
  const state = correction?.effective_state;
  if (!state || typeof state !== 'object') {
    return { instance, participants };
  }
  const correctedParticipants = Array.isArray(state.participants) && state.participants.length > 0
    ? state.participants
    : participants;
  return {
    instance: state.instance && typeof state.instance === 'object' ? { ...instance, ...state.instance } : instance,
    participants: correctedParticipants,
  };
}

/**
 * How many participants of a lesson are in each state, as they were marked. A participant pay
 * assumed to have attended is counted as `unmarked`, not as `attended`, so a summary never shows an
 * assumption as a mark.
 */
export function summarizeParticipantStates(participants = [], unmarkedIds = new Set()) {
  const states = {};
  for (const participant of participants || []) {
    const state = unmarkedIds.has(participant?.id)
      ? 'unmarked'
      : (normalizeString(participant?.participant_status).toLowerCase() || 'scheduled');
    states[state] = (states[state] || 0) + 1;
  }
  return states;
}

/**
 * What one lesson pays its instructor, and why.
 *
 * `counted` says the lesson pays at all. `unmarked` says part of that rests on the assumption that
 * unmarked participants attended, and `unmarked_amount` is how much. `missing_rate` says the lesson
 * counts but the instructor has no rate for its service on its date, so it pays nothing until one
 * is added.
 */
export function resolveCountedLesson({
  instance,
  participants = [],
  policies = null,
  graceParticipantIds = new Set(),
  rateRows = [],
  servicePaymentModel = 'fixed_rate',
  now = new Date(),
} = {}) {
  const employeeId = normalizeString(instance?.instructor_employee_id);
  const lessonDate = localDateKey(instance?.datetime_start);
  const { participants: participantsForPay, unmarkedIds } = resolveParticipantsForPay(instance, participants, now);
  // The earnings policy in force on the lesson's own date, not today's.
  const lessonPolicies = financePoliciesOnDate(policies, lessonDate);
  const paidParticipants = employeeId
    ? resolveCompensationEligibleParticipants(participantsForPay, lessonPolicies, graceParticipantIds)
    : [];
  const markedPaidParticipants = paidParticipants.filter((participant) => !unmarkedIds.has(participant?.id));
  const counted = paidParticipants.length > 0;
  const lessonRate = counted
    ? resolveLessonRateOnDate(rateRows, { employeeId, serviceId: instance?.service_id, date: lessonDate })
    : null;

  const payoutFor = (compensationParticipants) => (lessonRate
    ? resolveLessonInstructorPayout({
      instance,
      rateUsed: lessonRate.rate,
      servicePaymentModel,
      compensationParticipants,
      payBasis: lessonRate.pay_basis,
    })
    : null);
  const payout = payoutFor(paidParticipants);
  const payoutAmount = payout?.payoutAmount || 0;
  const markedAmount = payoutFor(markedPaidParticipants)?.payoutAmount || 0;

  return {
    lesson_instance_id: instance?.id || null,
    employee_id: employeeId || null,
    service_id: instance?.service_id || null,
    datetime_start: instance?.datetime_start || null,
    lesson_date: lessonDate,
    start_time: extractScheduleSlotFromIso(instance?.datetime_start)?.startTime || null,
    participant_states: summarizeParticipantStates(participants, unmarkedIds),
    duration_minutes: Number(instance?.duration_minutes) || 0,
    status: instance?.status || null,
    counted,
    paid_participant_count: paidParticipants.length,
    unmarked: paidParticipants.length > markedPaidParticipants.length,
    unmarked_participant_count: paidParticipants.length - markedPaidParticipants.length,
    unmarked_amount: coerceAgorot(payoutAmount - markedAmount),
    missing_rate: counted && !lessonRate,
    rate_used: lessonRate?.rate ?? null,
    pay_basis: lessonRate?.pay_basis ?? null,
    rate_history_id: lessonRate?.id ?? null,
    rate_effective_date: lessonRate?.effective_date ?? null,
    service_payment_model: payout?.servicePaymentModel ?? servicePaymentModel,
    payout_amount: payoutAmount,
  };
}

/** Lesson minutes and lesson count per day, for the days tab. */
export function summarizeLessonsByDate(lessons = []) {
  const byDate = new Map();
  for (const lesson of lessons || []) {
    if (!lesson?.counted || !lesson.lesson_date) continue;
    if (!byDate.has(lesson.lesson_date)) {
      byDate.set(lesson.lesson_date, { lesson_minutes: 0, lesson_count: 0, unmarked_lesson_count: 0, lesson_ids: [] });
    }
    const day = byDate.get(lesson.lesson_date);
    day.lesson_minutes += lesson.duration_minutes;
    day.lesson_count += 1;
    day.unmarked_lesson_count += lesson.unmarked ? 1 : 0;
    day.lesson_ids.push(lesson.lesson_instance_id);
  }
  return byDate;
}

/** Totals of a list of counted lessons. */
export function summarizeLessons(lessons = []) {
  const counted = (lessons || []).filter((lesson) => lesson?.counted);
  const unmarked = counted.filter((lesson) => lesson.unmarked);
  return {
    lesson_amount: coerceAgorot(counted.reduce((sum, lesson) => sum + coerceAgorot(lesson.payout_amount), 0)),
    lesson_count: counted.length,
    lesson_minutes: counted.reduce((sum, lesson) => sum + lesson.duration_minutes, 0),
    unmarked_lesson_count: unmarked.length,
    unmarked_lesson_amount: coerceAgorot(unmarked.reduce((sum, lesson) => sum + coerceAgorot(lesson.unmarked_amount), 0)),
    missing_rate_lesson_count: counted.filter((lesson) => lesson.missing_rate).length,
  };
}

async function loadLatestAppliedCorrections(client, orgId) {
  const rows = await fetchAllRows(() => withOrgScope(client, 'calendar_instance_corrections', orgId)
    .select('id, original_instance_id, effective_state, created_at')
    .eq('status', 'applied')
    .order('created_at', { ascending: false })
    .order('id', { ascending: true }), { ignoreMissingTable: true });
  const latest = new Map();
  for (const row of rows) {
    if (row?.original_instance_id && !latest.has(row.original_instance_id)) {
      latest.set(row.original_instance_id, row);
    }
  }
  return latest;
}

async function loadRowsByIds(client, orgId, table, columns, column, ids) {
  const { data, error } = await selectInChunks(
    () => withOrgScope(client, table, orgId).select(columns).order('id', { ascending: true }),
    column,
    ids,
    { size: ID_CHUNK_SIZE, pageSize: PAGE_SIZE },
  );
  if (error) throw error;
  return data;
}

/**
 * The lessons that count for pay between two dates (inclusive), for one instructor or for all.
 * Each lesson is read as it stands after its latest correction, so a corrected instructor, date or
 * outcome is what gets paid.
 */
export async function loadCountedLessons(client, orgId, {
  employeeId = '',
  startDate,
  endDate,
  policies = null,
  rateRows = null,
  now = new Date(),
} = {}) {
  const startKey = localDateKey(startDate);
  const endKey = localDateKey(endDate);
  const bounds = startKey && endKey && startKey <= endKey ? localDateRangeUtc(startKey, endKey) : null;
  if (!normalizeString(orgId) || !bounds) return [];
  const targetEmployeeId = normalizeString(employeeId);

  const [lessonRows, corrections] = await Promise.all([
    fetchAllRows(() => {
      let query = withOrgScope(client, 'lesson_instances', orgId)
        .select(LESSON_COLUMNS)
        .gte('datetime_start', bounds.startIso)
        .lt('datetime_start', bounds.endExclusiveIso);
      if (targetEmployeeId) {
        query = query.eq('instructor_employee_id', targetEmployeeId);
      }
      return query.order('id', { ascending: true });
    }),
    loadLatestAppliedCorrections(client, orgId),
  ]);

  // A correction can move a lesson to this instructor or into this period, so its original row
  // may be outside the first query.
  const lessonsById = new Map(lessonRows.map((row) => [row.id, row]));
  const missingOriginalIds = Array.from(corrections.keys()).filter((id) => !lessonsById.has(id));
  if (missingOriginalIds.length > 0) {
    const originals = await loadRowsByIds(client, orgId, 'lesson_instances', LESSON_COLUMNS, 'id', missingOriginalIds);
    for (const row of originals) lessonsById.set(row.id, row);
  }

  const inScope = (instance) => {
    const dateKey = localDateKey(instance?.datetime_start);
    return Boolean(dateKey) && dateKey >= startKey && dateKey <= endKey
      && (!targetEmployeeId || normalizeString(instance?.instructor_employee_id) === targetEmployeeId);
  };
  const lessonIds = Array.from(lessonsById.values())
    .filter((row) => inScope(applyCorrectionOverlay(row, [], corrections.get(row.id)).instance))
    .map((row) => row.id);
  if (lessonIds.length === 0) return [];

  const participantRows = await loadRowsByIds(client, orgId, 'lesson_participants', PARTICIPANT_COLUMNS, 'lesson_instance_id', lessonIds);
  const participantsByLesson = new Map();
  for (const row of participantRows) {
    if (!participantsByLesson.has(row.lesson_instance_id)) participantsByLesson.set(row.lesson_instance_id, []);
    participantsByLesson.get(row.lesson_instance_id).push(row);
  }

  const effectiveLessons = lessonIds.map((id) => applyCorrectionOverlay(
    lessonsById.get(id),
    participantsByLesson.get(id) || [],
    corrections.get(id),
  ));

  const participantIds = effectiveLessons.flatMap((lesson) => lesson.participants.map((row) => row?.id)).filter(Boolean);
  const graceParticipantIds = new Set();
  for (const idChunk of chunkArray(participantIds, ID_CHUNK_SIZE)) {
    for (const id of await loadGraceCancellationParticipantIds(client, orgId, idChunk)) graceParticipantIds.add(id);
  }

  const serviceIds = Array.from(new Set(effectiveLessons.map((lesson) => lesson.instance.service_id).filter(Boolean)));
  const instructorIds = Array.from(new Set(effectiveLessons.map((lesson) => lesson.instance.instructor_employee_id).filter(Boolean)));
  const [serviceRows, resolvedRateRows, resolvedPolicies] = await Promise.all([
    loadRowsByIds(client, orgId, 'Services', 'id, name, payment_model', 'id', serviceIds),
    rateRows || loadRateHistoryRows(client, orgId, { employeeIds: instructorIds, payBases: [...LESSON_PAY_BASES] }),
    policies || loadFinancePolicies(client, orgId, { asOf: endKey }),
  ]);
  const servicesById = new Map(serviceRows.map((row) => [row.id, row]));

  return effectiveLessons
    .map((lesson) => {
      const service = servicesById.get(lesson.instance.service_id) || null;
      return {
        ...resolveCountedLesson({
          instance: lesson.instance,
          participants: lesson.participants,
          policies: resolvedPolicies,
          graceParticipantIds,
          rateRows: resolvedRateRows,
          servicePaymentModel: service?.payment_model,
          now,
        }),
        service_name: service?.name || null,
      };
    })
    .filter((lesson) => lesson.counted)
    .sort((left, right) => String(left.datetime_start).localeCompare(String(right.datetime_start)));
}

/**
 * The paid leave days of a period as one line: how many (0.5 per half day) and what one day is worth
 * when all of them are worth the same (within 2 agorot, the rounding of a half day), otherwise null.
 */
export function summarizePaidLeave(leaveAmounts = []) {
  const paid = (leaveAmounts || []).filter((row) => Number(row?.pay_fraction) > 0);
  const days = roundTo2(paid.reduce((sum, row) => sum + Number(row.pay_fraction), 0));
  const values = paid.map((row) => Math.round(Number(row.amount) / Number(row.pay_fraction)));
  const same = values.length > 0 && Math.max(...values) - Math.min(...values) <= 2;
  return { days, dayValue: same ? values[0] : null };
}

/**
 * Reads the days an employee worked between two dates (inclusive) from the same sources pay uses.
 * Rates are not read: whether a lesson counts does not depend on them.
 */
export async function loadWorkedDates(client, orgId, { employeeId, startDate, endDate, policies = null } = {}) {
  const startKey = localDateKey(startDate);
  const endKey = localDateKey(endDate);
  if (!normalizeString(employeeId) || !startKey || !endKey || startKey > endKey) return [];
  const [lessons, attendanceRecords, leaveDays] = await Promise.all([
    loadCountedLessons(client, orgId, { employeeId, startDate: startKey, endDate: endKey, policies, rateRows: [] }),
    fetchAttendanceRecords(client, orgId, { employeeId, startDate: startKey, endDate: endKey }),
    fetchApprovedLeaveDays(client, orgId, { employeeId, startDate: startKey, endDate: endKey }),
  ]);
  return collectWorkedDates({ lessons, attendanceRecords, leaveDays });
}

function buildDisplayName(employee) {
  return [employee?.first_name, employee?.last_name].filter(Boolean).join(' ').trim() || employee?.employee_id || employee?.id;
}

function inRange(dateKey, startDate, endDate) {
  return Boolean(dateKey) && dateKey >= startDate && dateKey <= endDate;
}

/**
 * What an employee is owed for a period, with the parts that make it up.
 *
 * Lessons, office hours, salary, paid leave and hand-entered corrections are each computed from
 * their own facts and added. `includeDetails` adds the rows behind every part.
 */
export async function computeEmployeePay(client, orgId, {
  employee,
  startDate,
  endDate,
  policies = null,
  rateRows = null,
  now = new Date(),
  includeDetails = false,
} = {}) {
  const employeeId = employee?.id;
  const [resolvedPolicies, resolvedRateRows, leaveDays, corrections, leavePayMethodVersions] = await Promise.all([
    policies || loadFinancePolicies(client, orgId, { asOf: localDateKey(endDate) }),
    rateRows || loadRateHistoryRows(client, orgId, { employeeIds: [employeeId] }),
    fetchApprovedLeaveDays(client, orgId, { employeeId, startDate, endDate }),
    listFinanceCorrections(client, orgId, { employeeId, startDate, endDate }),
    employee?.leave_pay_method_versions || loadLeavePayMethodVersions(client, orgId, [employeeId]),
  ]);
  // The leave pay method is the employee's own dated setting: each leave day uses the one in force on it.
  const employeeWithMethod = { ...employee, leave_pay_method_versions: leavePayMethodVersions };

  // A leave day can be valued by the pay of the months before it, so history is read only when the
  // period has leave in it. The "legal" value reaches back through the leave inside its window (see
  // LEGAL_LEAVE_MAX_DEPTH), so the earlier leave days are read first and decide how far back to go.
  const startKey = localDateKey(startDate);
  const historyLeaveDays = leaveDays.length > 0
    ? await fetchApprovedLeaveDays(client, orgId, {
      employeeId,
      startDate: addMonths(firstDayOfMonth(startKey), -LEGAL_LEAVE_SEARCH_MONTHS * (LEGAL_LEAVE_MAX_DEPTH + 1)),
      endDate: addDays(startKey, -1),
    })
    : [];
  const legalStart = legalLeaveHistoryStart(leaveDays.map((row) => row.leave_date), historyLeaveDays);
  const averageStart = shiftMonths(startDate, -12);
  const historyStart = leaveDays.length > 0
    ? [legalStart, averageStart].filter(Boolean).sort()[0]
    : startDate;
  const [attendanceHistory, lessonHistory] = await Promise.all([
    fetchAttendanceRecords(client, orgId, { employeeId, startDate: historyStart, endDate }),
    loadCountedLessons(client, orgId, {
      employeeId,
      startDate: historyStart,
      endDate,
      policies: resolvedPolicies,
      rateRows: resolvedRateRows,
      now,
    }),
  ]);

  const lessons = lessonHistory.filter((lesson) => inRange(lesson.lesson_date, startDate, endDate));
  const attendance = attendanceHistory.filter((row) => inRange(localDateKey(row?.attendance_date), startDate, endDate));
  const lessonTotals = summarizeLessons(lessons);

  const leaveValuer = createLeaveDayValuer({
    employee: employeeWithMethod,
    lessonHistory,
    attendanceRecords: attendanceHistory,
    leaveDays: [...historyLeaveDays, ...leaveDays],
    // The leave-pay policy in force on each leave day.
    leavePayPolicyOn: (dateKey) => financePoliciesOnDate(resolvedPolicies, dateKey)?.leavePayPolicy,
    rateRows: resolvedRateRows,
  });
  const leaveAmounts = leaveDays.map((leaveDay) => {
    const detail = leaveValuer.detailOf(leaveDay.leave_date);
    return {
      ...leaveDay,
      day_value: detail.value,
      method: detail.method || null,
      lookback_months: detail.lookback_months || null,
      basis: detail.basis,
      amount: coerceAgorot(detail.value * Number(leaveDay.pay_fraction || 0)),
    };
  });
  const paidLeaveTotal = coerceAgorot(leaveAmounts.reduce((sum, row) => sum + row.amount, 0));
  const paidLeaveSummary = summarizePaidLeave(leaveAmounts);
  const correctionTotal = coerceAgorot((corrections || []).reduce((sum, row) => sum + coerceAgorot(row.amount), 0));

  const paysMonthlySalary = hasRateKind(resolvedRateRows, {
    employeeId,
    payBasis: PAY_BASIS.MONTHLY_SALARY,
    onOrBefore: endDate,
  });

  const attendanceRows = priceAttendanceRecords(attendance, resolvedRateRows, employeeId);
  const attendanceAmount = coerceAgorot(attendanceRows.reduce((sum, row) => sum + row.amount, 0));

  const workingDays = resolveEmployeeWorkingDays(employee);
  const workingDaySet = new Set(workingDays);
  const leaveByDate = new Map(leaveAmounts.map((row) => [row.leave_date, row]));
  const monthlySalaryAmount = paysMonthlySalary
    ? coerceAgorot(enumerateDateKeys(localDateKey(startDate), localDateKey(endDate))
      .filter((dateKey) => workingDaySet.has(weekdayOfDateKey(dateKey)))
      .reduce((sum, dateKey) => {
        const monthWorkingDays = Math.max(1, countWorkingDaysInRange(workingDays, firstDayOfMonth(dateKey), lastDayOfMonth(dateKey)));
        const monthlySalary = resolveRateOnDate(resolvedRateRows, {
          employeeId,
          payBasis: PAY_BASIS.MONTHLY_SALARY,
          date: dateKey,
        })?.rate ?? 0;
        const dailyRate = monthlySalary / monthWorkingDays;
        const leaveDay = leaveByDate.get(dateKey);
        return sum + (leaveDay ? dailyRate * Number(leaveDay.pay_fraction || 0) : dailyRate);
      }, 0))
    : 0;

  const { baseAmount, paidLeaveAmount, totalAmount } = combinePayComponents({
    lessonAmount: lessonTotals.lesson_amount,
    attendanceAmount,
    monthlySalaryAmount,
    paidLeaveTotal,
    correctionTotal,
    paysMonthlySalary,
  });

  const result = {
    employee_id: employeeId,
    employee_name: buildDisplayName(employee),
    employee_type: employee?.employee_type || null,
    period_start: startDate,
    period_end: endDate,
    base_amount: baseAmount,
    attendance_amount: attendanceAmount,
    attendance_minutes: attendanceRows.reduce((sum, row) => sum + row.other_minutes, 0),
    ...lessonTotals,
    monthly_salary_amount: monthlySalaryAmount,
    paid_leave_amount: paidLeaveAmount,
    correction_amount: correctionTotal,
    total_amount: totalAmount,
    leave_breakdown: {
      employee_paid_days: leaveDays.filter((row) => row.leave_type === 'employee_paid').length,
      system_paid_days: leaveDays.filter((row) => row.leave_type === 'system_paid').length,
      unpaid_days: leaveDays.filter((row) => row.leave_type === 'unpaid').length,
      half_days: leaveDays.filter((row) => row.leave_type === 'half_day').length,
      paid_leave_total: paidLeaveTotal,
      // The leave line of the monthly summary: days counted (a half day is 0.5) and the value of one
      // day when every paid day has the same one (null when it varies).
      paid_days: paidLeaveSummary.days,
      day_value: paidLeaveSummary.dayValue,
    },
    corrections,
  };

  if (includeDetails) {
    result.details = {
      lessons,
      attendance: attendanceRows.map((row) => ({ ...row, amount: coerceAgorot(row.amount) })),
      leave: leaveAmounts.map((row) => ({
        leave_date: row.leave_date,
        leave_type: row.leave_type,
        day_portion: row.day_portion,
        pay_fraction: row.pay_fraction,
        day_value: row.day_value,
        // For "ממוצע מומלץ": the months the day value comes from, their pay and what it is divided by.
        basis: row.basis || null,
        // How the day value was chosen, for the "איך חושב" note: the method and, for the average, its months.
        method: row.method || null,
        lookback_months: row.lookback_months || null,
        amount: row.amount,
      })),
    };
  }

  return result;
}
