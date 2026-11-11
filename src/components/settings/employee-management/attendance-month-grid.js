// Presentation only: lessons come from the calendar, other work from manual records.
function minutes(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

export function formatMinutes(value) {
  const total = minutes(value);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function attendanceTotals(days) {
  return days.reduce((totals, day) => {
    const lesson = minutes(day?.lessons?.lesson_minutes);
    const other = minutes(day?.record?.other_minutes);
    return {
      lessonMinutes: totals.lessonMinutes + lesson,
      otherMinutes: totals.otherMinutes + other,
      totalMinutes: totals.totalMinutes + lesson + other,
    };
  }, { lessonMinutes: 0, otherMinutes: 0, totalMinutes: 0 });
}

// Input is the panel's ordered, complete month; nulls represent adjacent months.
export function buildMonthWeeks(days) {
  if (!days.length) return [];
  const offset = new Date(`${days[0].date}T00:00:00Z`).getUTCDay();
  const cells = [...Array(offset).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
}
