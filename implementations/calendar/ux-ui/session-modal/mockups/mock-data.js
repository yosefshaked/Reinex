/* Sample data + a small "server" simulator for the lesson-modal prototype.
   Everything here is illustrative example data — no real customers. */
window.MOCK = (() => {
  const SERVICES = [
    { id: 's1', name: 'ריפוי בעיסוק קבוצתי', duration: 45, capacity: 5, color: '#0E9F9A' },
    { id: 's2', name: 'ריפוי בעיסוק פרטני', duration: 45, capacity: 1, color: '#5B5BD6' },
    { id: 's3', name: 'קלינאות תקשורת – קבוצה', duration: 60, capacity: 4, color: '#D9822B' },
  ];

  const INSTRUCTORS = [
    { id: 'i1', name: 'דנה לוי', services: { s1: { days: [0, 1, 2, 3, 4], from: '08:00', to: '16:00' }, s2: { days: [0, 1, 2, 3], from: '08:00', to: '14:00' } } },
    { id: 'i2', name: 'משה אזולאי', services: { s1: { days: [1, 3], from: '12:00', to: '19:00' }, s3: { days: [0, 1, 2, 3, 4], from: '09:00', to: '17:00' } } },
    { id: 'i3', name: 'שירה נחום', services: { s3: { days: [2, 4], from: '08:00', to: '13:00' } } },
  ];

  const PRICE = 18000; // agorot — private per-session price
  const RATE_PER_STUDENT = 6200; // agorot — instructor per-student rate

  // Org policy (billing_consumption_policy / instructor_earnings_policy)
  const POLICY = {
    billing: { attended: true, no_show: true, cancelled_student: false, cancelled_clinic: false },
    // instructor_earnings_policy — used to prefill the pay decision when configured
    payroll: { attended: true, no_show: true, cancelled_student: false, cancelled_clinic: false },
  };

  const STATUS = {
    scheduled: 'מתוכנן',
    attended: 'נכח/ה',
    no_show: 'לא הגיע/ה',
    cancelled_student: 'ביטול ע״י הלקוח',
    cancelled_clinic: 'ביטול ע״י המכון',
  };
  const STATUS_PILL = {
    scheduled: 'p-neutral', attended: 'p-ok', no_show: 'p-bad', cancelled_student: 'p-neutral', cancelled_clinic: 'p-neutral',
  };
  const LESSON_STATUS = { scheduled: 'מתוכנן', completed: 'הושלם', cancelled: 'בוטל' };
  const LESSON_PILL = { scheduled: 'p-primary', completed: 'p-ok', cancelled: 'p-neutral' };

  const OVERRIDE_REASONS = [
    { value: 'makeup', label: 'השלמת שיעור שבוטל' },
    { value: 'client_request', label: 'בקשת הלקוח' },
    { value: 'temp_instructor', label: 'החלפת מדריך/ה זמנית' },
    { value: 'custom', label: 'אחר (פירוט חופשי)' },
  ];

  const CORRECTION_REASONS = [
    { value: 'attendance_fix', label: 'תיקון נוכחות' },
    { value: 'status_fix', label: 'תיקון סטטוס שיעור' },
    { value: 'billing_fix', label: 'תיקון חיוב' },
    { value: 'documentation_fix', label: 'תיקון תיעוד' },
    { value: 'other', label: 'אחר' },
  ];

  const STUDENT_POOL = [
    { id: 'st5', name: 'מיכל אברהם', phone: '054-3321870' },
    { id: 'st6', name: 'מאיה פרידמן', phone: '052-9914402' },
    { id: 'st7', name: 'מתן שושן', phone: '050-7780012' },
    { id: 'st8', name: 'מיכאל רוזן', phone: '053-2210987' },
    { id: 'st9', name: 'מירב דהן', phone: '058-6610453' },
    { id: 'st10', name: 'אורי כץ', phone: '052-4439001' },
  ];

  const DAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

  function groupScenario() {
    return {
      lesson: {
        id: 'li_7c21f09e3f9a21c0', serviceId: 's1', instructorId: 'i1', date: '2026-09-14', time: '10:00', duration: 45,
        status: 'scheduled', source: 'תבנית שבועית · יום ב׳ 10:00', exception: null, lock: null, corrected: false, version: 7, started: true,
      },
      participants: [
        { id: 'p1', name: 'נועה כהן', contact: { name: 'רונית כהן', role: 'אם', phone: '050-4412398' }, funding: { type: 'hmo', provider: 'כללית', track: 'ריפוי בעיסוק · ילדים', authNumber: '4471-2209', remaining: 7, total: 12, validUntil: '31.12.2026', copay: 4500, claim: 13500 }, status: 'scheduled', reminder: { state: 'confirmed', at: '13.9 · 19:02' }, report: false, comp: null, waived: false },
        { id: 'p2', name: 'איתי ברק', contact: { phone: '052-7718034', email: 'itai.barak@example.com' }, funding: { type: 'private', package: 'חבילת 10 מפגשים · נותרו 6' }, status: 'scheduled', reminder: { state: 'sent', at: '13.9 · 18:40' }, report: false, comp: null, waived: false },
        { id: 'p3', name: 'יעל מזרחי', contact: { name: 'דוד מזרחי', role: 'אב', phone: '054-2208871' }, funding: { type: 'private', package: 'חבילת 10 מפגשים · נותרו 3' }, status: 'attended', reminder: { state: 'confirmed', at: '13.9 · 20:15' }, report: false, comp: null, waived: false },
        { id: 'p4', name: 'עומר חדד', contact: {}, funding: { type: 'private', package: 'תשלום לפי מפגש' }, status: 'scheduled', reminder: { state: 'none' }, report: false, comp: null, waived: false },
      ],
      history: [
        { day: '2026-09-01', t: '06:00', type: 'create', who: 'המערכת · תבנית שבועית', text: 'השיעור נוצר' },
        { day: '2026-09-13', t: '18:40', type: 'reminder', who: 'מיכל · משרד', text: 'נשלחה תזכורת בוואטסאפ לאיתי ברק' },
        { day: '2026-09-13', t: '19:02', type: 'reminder', who: 'מיכל · משרד', text: 'נועה כהן אישרה הגעה', note: 'דרך רונית כהן (אם)' },
        { day: '2026-09-14', t: '10:04', type: 'attendance', who: 'דנה לוי', text: 'יעל מזרחי סומנה כנוכחת' },
      ],
    };
  }

  function lockedScenario() {
    return {
      lesson: {
        id: 'li_2a90d41be6c7f318', serviceId: 's1', instructorId: 'i1', date: '2026-08-20', time: '16:30', duration: 45,
        status: 'completed', source: 'נוצר ידנית מהלוח', exception: { reason: 'השלמת שיעור שבוטל', by: 'מיכל (משרד)' },
        lock: { title: 'נכלל בהרצת שכר אוגוסט 2026', detail: 'ההרצה שולמה ב-1.9.2026' }, corrected: false, version: 12, started: true,
      },
      participants: [
        { id: 'q1', name: 'נועה כהן', contact: { name: 'רונית כהן', role: 'אם', phone: '050-4412398' }, funding: { type: 'hmo', provider: 'כללית', track: 'ריפוי בעיסוק · ילדים', authNumber: '4471-2209', remaining: 7, total: 12, validUntil: '31.12.2026', copay: 4500, claim: 13500 }, status: 'attended', reminder: { state: 'confirmed' }, report: true, comp: null, waived: false },
        { id: 'q2', name: 'איתי ברק', contact: { phone: '052-7718034' }, funding: { type: 'private', package: 'חבילת 10 מפגשים · נותרו 7' }, status: 'no_show', reminder: { state: 'sent' }, report: false, comp: 'compensated', waived: false },
        { id: 'q3', name: 'יעל מזרחי', contact: { name: 'דוד מזרחי', role: 'אב', phone: '054-2208871' }, funding: { type: 'private', package: 'חבילת 10 מפגשים · נותרו 4' }, status: 'attended', reminder: { state: 'confirmed' }, report: true, comp: null, waived: false },
      ],
      history: [
        { day: '2026-08-18', t: '12:10', type: 'create', who: 'מיכל · משרד', text: 'השיעור נוצר ידנית', note: 'שיבוץ חריג · השלמת שיעור שבוטל' },
        { day: '2026-08-20', t: '16:34', type: 'attendance', who: 'דנה לוי', text: 'נועה כהן סומנה כנוכחת' },
        { day: '2026-08-20', t: '16:35', type: 'absence', who: 'דנה לוי', text: 'איתי ברק סומן "לא הגיע"', note: 'המדריכה תקבל שכר' },
        { day: '2026-08-20', t: '16:36', type: 'attendance', who: 'דנה לוי', text: 'יעל מזרחי סומנה כנוכחת' },
        { day: '2026-08-20', t: '17:20', type: 'status', who: 'דנה לוי', text: 'השיעור סומן כהושלם' },
        { day: '2026-08-21', t: '09:15', type: 'report', who: 'דנה לוי', text: 'תועדו דיווחי מפגש לנועה וליעל' },
        { day: '2026-09-01', t: '09:30', type: 'payroll', who: 'המערכת', text: 'נכלל בהרצת שכר אוגוסט 2026', note: 'ההרצה שולמה — השיעור ננעל' },
      ],
    };
  }

  const service = (id) => SERVICES.find((s) => s.id === id);
  const instructor = (id) => INSTRUCTORS.find((i) => i.id === id);
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
  const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const money = (agorot) => `₪${new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 }).format(Math.abs(agorot) / 100)}`;
  const signedMoney = (agorot) => (agorot === 0 ? '₪0' : `${agorot > 0 ? '+' : '−'}${money(agorot)}`);
  const longDate = (iso) => new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${iso}T00:00`));
  const shortDate = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${d}.${m}`; };
  const endTime = (time, duration) => fromMin(toMin(time) + Number(duration || 0));
  const initials = (name) => { const parts = String(name).trim().split(/\s+/); return parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2); };

  function daysLabel(days) {
    const sorted = [...days].sort();
    const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
    return contiguous && sorted.length > 2 ? `${DAY_LETTERS[sorted[0]]}–${DAY_LETTERS[sorted[sorted.length - 1]]}` : sorted.map((d) => DAY_LETTERS[d]).join(', ');
  }

  function availability(instructorId, serviceId, date, time, duration) {
    const ins = instructor(instructorId);
    const svc = service(serviceId);
    const cap = ins?.services?.[serviceId];
    if (!cap) return { status: 'missing', text: `ל${ins.name} אין יכולת שירות עבור "${svc.name}". בחרו מדריך/ה אחר/ת או שירות אחר.` };
    const day = new Date(`${date}T00:00`).getDay();
    const start = toMin(time);
    const window = `${daysLabel(cap.days)} · ${cap.from}–${cap.to}`;
    if (!cap.days.includes(day) || start < toMin(cap.from) || start + duration > toMin(cap.to)) {
      return { status: 'outside', text: `מחוץ לזמינות של ${ins.name} לשירות הזה (${window})` };
    }
    return { status: 'ok', text: `בתוך הזמינות של ${ins.name} (${window})` };
  }

  const isCharged = (status, waived) => POLICY.billing[status] === true && !waived;
  const isPaid = (status, comp) => status === 'attended' || (status === 'no_show' && comp === 'compensated');
  const chargeOf = (p) => (p.funding.type === 'hmo' ? p.funding.copay : PRICE);
  const needsCompDecision = (status) => status === 'no_show' && POLICY.billing.no_show === true;
  const waiverEligible = (status) => status !== 'attended' && POLICY.billing[status] === true;
  const policyComp = (status) => (typeof POLICY.payroll[status] === 'boolean' ? (POLICY.payroll[status] ? 'compensated' : 'not_compensated') : null);

  /* Simulates POST calendar/attendance preview-participant-status-change */
  function statusImpact(lesson, p, target, opts = {}) {
    const ins = instructor(lesson.instructorId).name;
    const hmo = p.funding.type === 'hmo';
    const amount = money(chargeOf(p));
    const before = { charged: isCharged(p.status, p.waived), paid: isPaid(p.status, p.comp) };
    const after = { charged: isCharged(target, opts.waive), paid: isPaid(target, opts.comp) };
    const segs = [];
    const details = [];

    if (p.report && ['no_show', 'cancelled_student', 'cancelled_clinic'].includes(target)) {
      return { block: `ל${p.name} יש דיווח מפגש מתועד. יש לבטל את הדיווח לפני שינוי הסטטוס ל"${STATUS[target]}".` };
    }

    if (after.charged && !before.charged) {
      segs.push({ k: 'חיוב', html: hmo ? `השתתפות עצמית <span class="money">${amount}</span>` : `<span class="money">${amount}</span> מהחבילה` });
      details.push({ k: 'billing', title: 'חיוב לקוח', text: hmo ? `ייווצר חיוב השתתפות עצמית של ${amount} בכרטיס של ${p.name}.` : `ייווצר חיוב של ${amount} בכרטיס של ${p.name} (${p.funding.package}).` });
    } else if (!after.charged && before.charged) {
      segs.push({ k: 'חיוב', html: `החיוב של <span class="money">${amount}</span> יזוכה` });
      details.push({ k: 'billing', title: 'חיוב לקוח', text: `החיוב הקיים של ${amount} יזוכה בכרטיס של ${p.name}.` });
    } else if (after.charged) {
      segs.push({ k: 'חיוב', html: 'ללא שינוי בחיוב' });
    } else {
      segs.push({ k: 'חיוב', html: opts.waive ? 'ללא חיוב (ויתור)' : 'ללא חיוב' });
      if (opts.waive) details.push({ k: 'billing', title: 'חיוב לקוח', text: `לפי המדיניות היה נוצר חיוב של ${amount} — ויתרתם עליו. הוויתור יירשם ביומן הביקורת.` });
    }

    if (after.paid && !before.paid) {
      segs.push({ k: 'שכר', html: `<span class="money">+${money(RATE_PER_STUDENT)}</span> ל${ins}` });
      details.push({ k: 'payroll', title: 'שכר מדריך/ה', text: `${money(RATE_PER_STUDENT)} יתווספו לשכר של ${ins} בהרצת השכר הבאה (תעריף לפי משתתף).` });
    } else if (!after.paid && before.paid) {
      segs.push({ k: 'שכר', html: `<span class="money">−${money(RATE_PER_STUDENT)}</span> מ${ins}` });
      details.push({ k: 'payroll', title: 'שכר מדריך/ה', text: `${money(RATE_PER_STUDENT)} יוסרו מהשכר הפתוח של ${ins}.` });
    } else {
      segs.push({ k: 'שכר', html: after.paid ? 'ללא שינוי בשכר' : 'ללא שכר' });
    }

    if (hmo && target === 'attended' && p.status !== 'attended') {
      segs.push({ k: 'גורם מממן', html: `<span class="hmo">תביעה ל${p.funding.provider} ${money(p.funding.claim)}</span>` });
      details.push({ k: 'hmo', title: 'גורם מממן', text: `תיפתח משימת הגשת תביעה ל${p.funding.provider} על סך ${money(p.funding.claim)} (אישור בתוקף עד 31.12.2026).` });
    } else if (hmo && p.status === 'attended' && target !== 'attended') {
      segs.push({ k: 'גורם מממן', html: '<span class="hmo">משימת התביעה תבוטל</span>' });
      details.push({ k: 'hmo', title: 'גורם מממן', text: `משימת התביעה ל${p.funding.provider} תבוטל, והמפגש יחזור ליתרת האישור.` });
    }

    const quiet = !before.charged && !after.charged && !before.paid && !after.paid && segs.length === 2 && !opts.waive;
    return { segs, details, quiet };
  }

  /* Simulates PUT calendar/instances preview-cancel-instance */
  function cancelImpact(participants) {
    const blockedAttended = participants.filter((p) => p.status === 'attended');
    const blockedReports = participants.filter((p) => p.report);
    const scheduled = participants.filter((p) => p.status === 'scheduled');
    const resolved = participants.filter((p) => p.status !== 'scheduled');
    return {
      blocked: blockedAttended.length > 0 || blockedReports.length > 0,
      blockedAttended, blockedReports, scheduled, resolved,
      charges: POLICY.billing.cancelled_clinic === true,
    };
  }

  return {
    SERVICES, INSTRUCTORS, STUDENT_POOL, STATUS, STATUS_PILL, LESSON_STATUS, LESSON_PILL, OVERRIDE_REASONS, CORRECTION_REASONS, PRICE, RATE_PER_STUDENT,
    groupScenario, lockedScenario, service, instructor, toMin, fromMin, money, signedMoney, longDate, shortDate, endTime, initials,
    availability, statusImpact, cancelImpact, isCharged, isPaid, chargeOf, needsCompDecision, waiverEligible, policyComp, POLICY,
  };
})();
