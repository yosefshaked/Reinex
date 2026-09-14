/* State + interactions for the lesson-modal prototype. */
(() => {
  const M = window.MOCK;
  const R = window.RENDER;
  let S;

  function fresh(scenario, role = 'admin', notes = false, layout = 'list') {
    const sc = scenario === 'locked' ? M.lockedScenario() : M.groupScenario();
    return { scenario, role, notes, layout, open: true, lesson: sc.lesson, participants: sc.participants, history: sc.history, toasts: [], ...viewDefaults() };
  }
  function viewDefaults() {
    return { tab: 'lesson', mode: 'view', strip: null, absence: null, menu: null, pop: null, footMenu: false, add: null, highlight: [], dialog: null, edit: null, corr: null, focusK: null };
  }
  S = fresh('group');

  const P = (id) => S.participants.find((p) => p.id === id);
  const clock = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const stamp = () => `14.9 · ${clock()}`;
  const log = (type, text, extra = {}) => S.history.push({ day: '2026-09-14', t: clock(), type, who: S.role === 'admin' ? 'את/ה' : 'דנה לוי', text, fresh: true, ...extra });
  const bump = () => { S.lesson.version += 1; };
  const later = (ms, fn) => setTimeout(() => { fn(); render(); }, ms);

  function render() {
    const ae = document.activeElement;
    const activeK = ae && ae.dataset && ae.dataset.k ? ae.dataset.k : (ae && ae.id ? `#${ae.id}` : null);
    const oldBody = document.querySelector('.m-body');
    const top = oldBody ? oldBody.scrollTop : 0;
    document.body.classList.toggle('notes', S.notes);
    document.body.classList.toggle('closed', !S.open);
    document.getElementById('rail').innerHTML = R.rail(S);
    document.getElementById('stage').innerHTML = R.stage(S);
    const body = document.querySelector('.m-body');
    if (body) body.scrollTop = top;
    const want = S.focusK || activeK;
    S.focusK = null;
    if (want) {
      const el = want.startsWith('#') ? document.getElementById(want.slice(1)) : document.querySelector(`[data-k="${CSS.escape(want)}"]`);
      if (el && !el.disabled) el.focus({ preventScroll: false });
    }
  }
  function renderFoot() { const f = document.querySelector('.m-foot'); if (f) f.outerHTML = R.foot(S); }
  function renderToasts() { document.getElementById('toasts').innerHTML = R.toasts(S); }
  function toast(text, kind = 'ok') {
    const id = Math.random();
    S.toasts.push({ id, text, kind });
    renderToasts();
    setTimeout(() => { S.toasts = S.toasts.filter((t) => t.id !== id); renderToasts(); }, 3400);
  }
  const closePopovers = () => { S.menu = null; S.pop = null; S.footMenu = false; };

  function openStrip(pid, target, opts = {}) {
    closePopovers();
    S.absence = null;
    S.tab = 'lesson';
    const token = { pid, target, opts, phase: 'loading', res: null, details: false };
    S.strip = token;
    later(550, () => {
      if (S.strip !== token) return;
      token.res = M.statusImpact(S.lesson, P(pid), target, opts);
      token.phase = 'ready';
      S.focusK = token.res.block ? null : 'strip-ok';
    });
  }

  function editPreview() {
    const E = S.edit; const L = S.lesson;
    const svc = M.service(E.serviceId);
    const av = M.availability(E.instructorId, E.serviceId, E.date, E.time, svc.duration);
    const items = [];
    let canApply = true;
    const active = S.participants.filter((p) => !['cancelled_student', 'cancelled_clinic', 'no_show'].includes(p.status)).length;
    if (E.serviceId !== L.serviceId && active > svc.capacity) {
      items.push({ tone: 'bad', text: `לשירות "${svc.name}" יש ${svc.capacity === 1 ? 'מקום למשתתף/ת אחד/ת' : `${svc.capacity} מקומות`}, ובשיעור ${active} משתתפים פעילים. אי אפשר לשמור.` });
      canApply = false;
    }
    if (E.date !== L.date || E.time !== L.time) {
      const reminded = S.participants.filter((p) => p.status === 'scheduled' && p.reminder.state !== 'none').length;
      if (reminded) items.push({ text: `${reminded} תזכורות שכבר נשלחו מציינות את המועד הקודם — כדאי לשלוח שוב אחרי השמירה.` });
    }
    if (E.instructorId !== L.instructorId) items.push({ text: `השכר על השיעור יירשם ל${M.instructor(E.instructorId).name} במקום ${M.instructor(L.instructorId).name}.` });
    if (E.serviceId !== L.serviceId) items.push({ text: `משך השיעור ישתנה ל-${svc.duration} דקות לפי השירות, והחיובים יחושבו לפי מחיר השירות החדש.` });
    if (av.status === 'outside') {
      const reason = E.reason === 'custom' ? E.custom : M.OVERRIDE_REASONS.find((r) => r.value === E.reason)?.label;
      items.push({ tone: 'warn', text: `יישמר כחריגה חד-פעמית מחוץ לזמינות · ${reason}` });
    }
    if (!items.length) items.push({ text: 'אין השפעה על חיובים, שכר או תזכורות.' });
    return { items, canApply };
  }

  function corrPreview() {
    let billing = 0; let payroll = 0; const notes = [];
    S.participants.forEach((p) => {
      const next = S.corr.statuses[p.id];
      if (next === p.status) return;
      billing += (Number(M.isCharged(next)) - Number(M.isCharged(p.status, p.waived))) * M.chargeOf(p);
      payroll += (Number(M.isPaid(next, null)) - Number(M.isPaid(p.status, p.comp))) * M.RATE_PER_STUDENT;
      notes.push(`${p.name}: ${M.STATUS[p.status]} ← ${M.STATUS[next]}`);
      if (p.funding.type === 'hmo' && p.status === 'attended' && next !== 'attended') notes.push(`התביעה ל${p.funding.provider} כבר הוגשה — תיווצר משימת זיכוי מול הגורם המממן.`);
    });
    if (payroll) notes.push('הרצת השכר של אוגוסט כבר שולמה — ההפרש יתווסף כהתאמה להרצת השכר הבאה.');
    return { billing, payroll, notes };
  }

  const ACT = {
    scenario: (_, v) => { S = fresh(v, S.role, S.notes, S.layout); },
    role: (_, v) => { S.role = v; Object.assign(S, viewDefaults()); },
    layout: (_, v) => { S.layout = v; Object.assign(S, viewDefaults()); },
    notes: () => { S.notes = !S.notes; },
    reset: () => { S = fresh(S.scenario, S.role, S.notes, S.layout); toast('האב-טיפוס אופס לנתוני הדוגמה', 'info'); },
    close: () => {
      if (S.mode === 'edit' && R.editDiffs(S).length) { S.dialog = { type: 'discard', then: 'close' }; return; }
      S.open = false; S.focusK = 'reopen';
    },
    reopen: () => { Object.assign(S, viewDefaults()); S.open = true; S.focusK = 'tab-lesson'; },
    tab: (_, v) => { closePopovers(); S.tab = v; },
    focus: (_, v) => {
      S.tab = 'lesson'; closePopovers();
      const ids = S.participants.filter((p) => (v === 'scheduled' ? p.status === 'scheduled' : v === 'reminder' ? p.status === 'scheduled' && p.reminder.state === 'sent' : p.status === 'attended' && !p.report)).map((p) => p.id);
      S.highlight = ids;
      setTimeout(() => { document.querySelector(`[data-row="${ids[0]}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); S.highlight = []; }, 30);
    },
    mark: (id, v) => openStrip(id, v || 'attended'),
    restore: (id) => openStrip(id, 'scheduled'),
    'strip-cancel': () => { const pid = S.strip?.pid; S.strip = null; S.focusK = pid ? `mark-${pid}` : null; },
    'strip-details': () => { S.strip.details = !S.strip.details; },
    'strip-ok': () => {
      const T = S.strip;
      if (!T || T.phase !== 'ready' || T.res.block) return;
      T.phase = 'saving';
      later(420, () => {
        if (S.strip !== T) return;
        const p = P(T.pid);
        p.status = T.target;
        p.comp = T.target === 'no_show' ? T.opts.comp || null : null;
        p.waived = Boolean(T.opts.waive);
        if (T.target === 'scheduled') p.reminder = { state: 'none' };
        bump();
        const extraNote = [T.opts.comp === 'compensated' ? 'המדריכה תקבל שכר' : T.opts.comp === 'not_compensated' ? 'ללא שכר למדריכה' : '', T.opts.waive ? 'ויתור על חיוב' : '', T.opts.note || ''].filter(Boolean).join(' · ');
        log(T.target === 'scheduled' ? 'status' : T.target === 'attended' ? 'attendance' : 'absence', T.target === 'scheduled' ? `${p.name} הוחזר/ה למתוכנן` : `${p.name} סומן/ה "${M.STATUS[T.target]}"`, extraNote ? { note: extraNote } : {});
        toast(`${p.name}: ${M.STATUS[T.target]}`);
        S.strip = null;
        const next = S.participants.find((x) => x.status === 'scheduled');
        S.focusK = next ? `mark-${next.id}` : 'complete';
      });
    },
    absent: (id) => {
      closePopovers(); S.strip = null;
      const p = P(id);
      const status = ['no_show', 'cancelled_student', 'cancelled_clinic'].includes(p.status) ? p.status : 'no_show';
      const fromPolicy = M.needsCompDecision(status) ? M.policyComp(status) : null;
      S.absence = { pid: id, status, comp: p.comp || fromPolicy, compFromPolicy: !p.comp && Boolean(fromPolicy), waive: false, note: '', error: '' };
      S.focusK = `abs-status-${S.absence.status}`;
    },
    'abs-status': (_, v) => { const A = S.absence; A.status = v; A.error = ''; if (!M.needsCompDecision(v)) { A.comp = null; A.compFromPolicy = false; } else if (!A.comp) { A.comp = M.policyComp(v); A.compFromPolicy = Boolean(A.comp); } if (!M.waiverEligible(v)) A.waive = false; },
    'abs-comp': (_, v) => { S.absence.comp = v; S.absence.compFromPolicy = false; S.absence.error = ''; },
    'abs-cancel': () => { const pid = S.absence.pid; S.absence = null; S.focusK = `mark-${pid}`; },
    'abs-continue': () => {
      const A = S.absence;
      if (M.needsCompDecision(A.status) && !A.comp) { A.error = 'יש לבחור אם המדריך/ה תקבל שכר'; return; }
      openStrip(A.pid, A.status, { comp: A.comp, waive: A.waive, note: A.note.trim() });
    },
    menu: (id) => { const same = S.menu === id; closePopovers(); S.menu = same ? null : id; },
    pop: (id) => { const same = S.pop === id; closePopovers(); S.pop = same ? null : id; },
    'foot-menu': () => { const was = S.footMenu; closePopovers(); S.footMenu = !was; },
    remind: (id, v) => {
      const p = P(id);
      p.reminder = { state: 'sent', at: stamp() };
      log('reminder', `נשלחה תזכורת ב${v === 'wa' ? 'וואטסאפ' : 'מייל'} ל${p.name}`);
      closePopovers();
      toast(`${v === 'wa' ? 'WhatsApp' : 'המייל'} נפתח · התזכורת ל${p.name} סומנה כנשלחה`);
    },
    arrive: (id) => { const p = P(id); p.reminder = { state: 'confirmed', at: stamp() }; log('reminder', `${p.name} אישר/ה הגעה`); closePopovers(); toast(`${p.name} אישר/ה הגעה`); },
    decline: (id) => { ACT.absent(id); ACT['abs-status'](null, 'cancelled_student'); S.focusK = 'abs-status-cancelled_student'; },
    report: (id) => {
      const p = P(id);
      toast(`טופס דיווח המפגש של ${p.name} נפתח (הדמיה)`, 'info');
      later(900, () => { p.report = true; log('report', `תועד דיווח מפגש עבור ${p.name}`); toast(`דיווח המפגש של ${p.name} נשמר`); });
    },
    ext: (_, v) => { closePopovers(); toast(`מעבר אל ${v} — מחוץ לאב-טיפוס`, 'info'); },
    'add-toggle': () => { S.add = S.add ? null : { q: '', results: [], searching: false, pending: null, error: '' }; S.focusK = S.add ? 'add-q' : null; },
    'add-pick': (id) => {
      const A = S.add;
      if (!A || A.pending) return;
      const svc = M.service(S.lesson.serviceId);
      const active = S.participants.filter((p) => !['cancelled_student', 'cancelled_clinic', 'no_show'].includes(p.status)).length;
      if (active >= svc.capacity) { A.error = `השיעור מלא — כל ${svc.capacity} המקומות תפוסים. אפשר לפנות מקום אם משתתף/ת ביטל/ה.`; return; }
      A.pending = id;
      later(500, () => {
        const st = M.STUDENT_POOL.find((x) => x.id === id);
        S.participants.push({ id: `n-${id}`, name: st.name, contact: { phone: st.phone }, funding: { type: 'private', package: 'תשלום לפי מפגש' }, status: 'scheduled', reminder: { state: 'none' }, report: false, comp: null, waived: false });
        bump(); log('participant', `${st.name} נוסף/ה לשיעור`);
        toast(`${st.name} נוסף/ה לשיעור`);
        S.add = null;
        S.highlight = [`n-${id}`];
        setTimeout(() => { S.highlight = []; }, 30);
      });
    },
    complete: () => {
      if (S.participants.some((p) => p.status === 'scheduled')) return;
      S.lesson.status = 'completed'; bump(); log('status', 'השיעור סומן כהושלם'); toast('השיעור סומן כהושלם');
    },
    'cancel-open': () => {
      closePopovers();
      const G = { type: 'cancel', phase: 'loading', res: null };
      S.dialog = G;
      later(600, () => { if (S.dialog !== G) return; G.res = M.cancelImpact(S.participants); G.phase = 'ready'; S.focusK = G.res.blocked ? 'dlg-close' : 'cancel-confirm'; });
    },
    'cancel-goto': (id) => { S.dialog = null; openStrip(id, 'scheduled'); },
    'cancel-confirm': () => {
      const n = S.participants.filter((p) => p.status === 'scheduled').length;
      S.participants.forEach((p) => { if (p.status === 'scheduled') p.status = 'cancelled_clinic'; });
      S.lesson.status = 'cancelled'; bump(); log('status', 'השיעור בוטל', { note: `${n} משתתפים סומנו "ביטול ע״י המכון"` });
      S.dialog = null; toast(`השיעור בוטל · ${n} משתתפים עודכנו`);
    },
    'dlg-close': () => { S.dialog = null; },
    'edit-start': () => {
      closePopovers(); S.strip = null; S.absence = null; S.add = null;
      const L = S.lesson;
      S.edit = { date: L.date, time: L.time, serviceId: L.serviceId, instructorId: L.instructorId, reason: '', custom: '', phase: 'idle', preview: null };
      S.mode = 'edit'; S.focusK = null;
    },
    'edit-cancel': () => {
      if (R.editDiffs(S).length) { S.dialog = { type: 'discard', then: 'view' }; return; }
      S.mode = 'view'; S.edit = null;
    },
    'discard-confirm': () => {
      const then = S.dialog.then;
      S.dialog = null; S.mode = 'view'; S.edit = null;
      if (then === 'close') { S.open = false; S.focusK = 'reopen'; }
    },
    'edit-check': () => {
      const E = S.edit; E.phase = 'loading';
      later(700, () => { if (S.edit !== E) return; E.preview = editPreview(); E.phase = 'ready'; S.focusK = E.preview.canApply ? 'edit-save' : null; });
    },
    'edit-save': () => {
      const E = S.edit; E.phase = 'saving';
      later(500, () => {
        const L = S.lesson; const svc = M.service(E.serviceId);
        const av = M.availability(E.instructorId, E.serviceId, E.date, E.time, svc.duration);
        const diff = R.editDiffs(S);
        Object.assign(L, { date: E.date, time: E.time, serviceId: E.serviceId, instructorId: E.instructorId, duration: svc.duration });
        if (av.status === 'outside') L.exception = { reason: E.reason === 'custom' ? E.custom : M.OVERRIDE_REASONS.find((r) => r.value === E.reason).label, by: 'את/ה' };
        else L.exception = null;
        bump(); log('edit', 'מועד ושיבוץ עודכנו', { diff, note: L.exception ? `שיבוץ חריג · ${L.exception.reason}` : '' }); toast('השינויים נשמרו');
        S.mode = 'view'; S.edit = null;
      });
    },
    'corr-start': () => {
      closePopovers();
      S.corr = { reason: 'attendance_fix', text: '', statuses: Object.fromEntries(S.participants.map((p) => [p.id, p.status])), phase: 'idle', preview: null };
      S.mode = 'correction'; S.focusK = null;
    },
    'corr-cancel': () => { S.mode = 'view'; S.corr = null; },
    'corr-check': () => {
      const C = S.corr; C.phase = 'loading';
      later(700, () => { if (S.corr !== C) return; C.preview = corrPreview(); C.phase = 'ready'; S.focusK = 'corr-apply'; });
    },
    'corr-apply': () => { S.dialog = { type: 'corr-confirm' }; S.focusK = 'corr-confirm'; },
    'corr-confirm': () => {
      const C = S.corr;
      S.participants.forEach((p) => { if (C.statuses[p.id] !== p.status) { p.status = C.statuses[p.id]; p.comp = null; } });
      S.lesson.corrected = true; bump();
      log('correction', `נרשם תיקון · ${M.CORRECTION_REASONS.find((r) => r.value === C.reason).label}`, { note: C.text.trim() });
      toast('התיקון נרשם ביומן הביקורת');
      S.dialog = null; S.mode = 'view'; S.corr = null; S.tab = 'details';
    },
  };

  const CHANGE = {
    'abs-waive': (v, el) => { S.absence.waive = el.checked; },
    'edit-date': (v) => { S.edit.date = v || S.edit.date; S.edit.phase = 'idle'; },
    'edit-time': (v) => { S.edit.time = v || S.edit.time; S.edit.phase = 'idle'; },
    'edit-service': (v) => { S.edit.serviceId = v; S.edit.phase = 'idle'; },
    'edit-instructor': (v) => { S.edit.instructorId = v; S.edit.phase = 'idle'; },
    'edit-reason': (v) => { S.edit.reason = v; S.edit.phase = 'idle'; },
    'corr-reason': (v) => { S.corr.reason = v; S.corr.phase = 'idle'; },
    'corr-status': (v, el) => { S.corr.statuses[el.dataset.id] = v; S.corr.phase = 'idle'; },
  };

  let searchTimer = null;
  const INPUT = {
    'abs-note': (v) => { S.absence.note = v; },
    'edit-custom': (v) => { S.edit.custom = v; S.edit.phase = 'idle'; renderFoot(); },
    'corr-text': (v) => { S.corr.text = v; S.corr.phase = 'idle'; renderFoot(); },
    'add-q': (v) => {
      const A = S.add; A.q = v; A.error = ''; A.searching = v.trim().length >= 2;
      const box = () => { const el = document.getElementById('add-results'); if (el) el.innerHTML = R.addResults(S); };
      box();
      clearTimeout(searchTimer);
      if (!A.searching) return;
      searchTimer = setTimeout(() => {
        const q = A.q.trim();
        const taken = new Set(S.participants.map((p) => p.name));
        A.results = M.STUDENT_POOL.filter((st) => !taken.has(st.name) && (st.name.includes(q) || st.phone.replace(/-/g, '').includes(q.replace(/-/g, ''))));
        A.searching = false;
        box();
      }, 280);
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) {
      if ((S.menu || S.pop || S.footMenu) && !e.target.closest('.menu, .pop')) { closePopovers(); render(); }
      return;
    }
    if (el.disabled) return;
    const fn = ACT[el.dataset.act];
    if (!fn) return;
    fn(el.dataset.id, el.dataset.v, el);
    render();
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (!el || !CHANGE[el.dataset.change]) return;
    CHANGE[el.dataset.change](el.value, el);
    render();
  });
  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-input]');
    if (el && INPUT[el.dataset.input]) INPUT[el.dataset.input](el.value, el);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (S.dialog) S.dialog = null;
    else if (S.menu || S.pop || S.footMenu) closePopovers();
    else if (S.strip) ACT['strip-cancel']();
    else if (S.absence) ACT['abs-cancel']();
    else if (S.open) ACT.close();
    else return;
    e.preventDefault();
    render();
  });

  render();
})();
