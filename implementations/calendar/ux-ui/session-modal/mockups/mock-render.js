/* Pure render functions: state → HTML strings. (v4 — list layout, footer closure line, history redesign) */
window.RENDER = (() => {
  const M = window.MOCK;
  const I = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    xc: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    undo: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    msg: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    filePen: '<path d="M12.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v9.5"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M13.4 15.6a1 1 0 1 0-3-3l-5 5a2 2 0 0 0-.5.85l-.84 2.87a.5.5 0 0 0 .62.62l2.87-.84a2 2 0 0 0 .85-.5z"/>',
    fileCheck: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/>',
    userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
    pencil: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    loader: '<path d="M21 12a9 9 0 1 1-6.22-8.56"/>',
    arrow: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  };
  const ic = (n, c = '') => `<svg class="ic ${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const attrs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== false && v !== '')
    .map(([k, v]) => (v === true ? k : `${k}="${esc(v)}"`)).join(' ');
  function B({ act, id, v, k, label = '', icon, cls = 'btn-outline', tip, aria, dis, pressed, style }) {
    const key = k || [act, id, v].filter(Boolean).join('-');
    return `<button type="button" class="btn ${cls}" ${attrs({ 'data-act': act, 'data-id': id, 'data-v': v, 'data-k': key, 'data-tip': tip, 'aria-label': aria || (label ? undefined : tip), 'aria-pressed': pressed, disabled: dis, style })}>${icon ? ic(icon) : ''}${label}</button>`;
  }
  const pin = (id, note) => `<span class="pin" tabindex="0" data-tip="${esc(note)}">${id}</span>`;
  const pill = (cls, text) => `<span class="pill ${cls}">${text}</span>`;
  const statusPill = (s) => pill(M.STATUS_PILL[s], M.STATUS[s]);
  const ABSENT = ['no_show', 'cancelled_student', 'cancelled_clinic'];
  const TODAY = '2026-09-14';

  function derive(S) {
    const P = S.participants;
    const L = S.lesson;
    const scheduled = P.filter((p) => p.status === 'scheduled');
    const locked = Boolean(L.lock);
    const cancelled = L.status === 'cancelled';
    const admin = S.role === 'admin';
    const attendanceDone = P.length > 0 && scheduled.length === 0;
    const needReport = P.filter((p) => p.status === 'attended' && !p.report);
    const paid = P.filter((p) => M.isPaid(p.status, p.comp));
    const hmoAttended = P.filter((p) => p.funding.type === 'hmo' && p.status === 'attended');
    const ins = M.instructor(L.instructorId);
    // What still keeps the lesson operationally open once attendance is done (shown as one footer line).
    const remaining = [];
    if (attendanceDone && !cancelled && !locked) {
      if (paid.length) remaining.push({ label: 'שכר מדריך/ה', detail: `${M.money(paid.length * M.RATE_PER_STUDENT)} ל${ins.name} — ייסגר כשהרצת השכר של ספטמבר תשולם` });
      if (hmoAttended.length) remaining.push({ label: `תביעה ל${hmoAttended[0].funding.provider}`, detail: `${M.money(hmoAttended[0].funding.claim)} — ממתין להגשה במסך התביעות` });
      if (needReport.length) remaining.push({ label: 'דיווחי מפגש', detail: `חסר דיווח עבור ${needReport.map((p) => p.name).join(', ')}` });
    }
    return { scheduled, locked, cancelled, admin, attendanceDone, remaining, canMark: !locked && !cancelled, canManage: admin && !locked && !cancelled, ins };
  }

  function editDiffs(S) {
    const L = S.lesson; const E = S.edit; if (!E) return [];
    const out = [];
    if (E.date !== L.date) out.push({ label: 'תאריך', before: M.shortDate(L.date), after: M.shortDate(E.date) });
    if (E.time !== L.time) out.push({ label: 'שעה', before: L.time, after: E.time });
    if (E.serviceId !== L.serviceId) out.push({ label: 'שירות', before: M.service(L.serviceId).name, after: M.service(E.serviceId).name });
    if (E.instructorId !== L.instructorId) out.push({ label: 'מדריך/ה', before: M.instructor(L.instructorId).name, after: M.instructor(E.instructorId).name });
    return out;
  }
  const diffChips = (diffs) => `<div class="diffs">${diffs.map((d) => `<span class="diff"><i>${d.label}</i><s>${esc(d.before)}</s>${ic('arrow', 'ic-sm')}<b>${esc(d.after)}</b></span>`).join('')}</div>`;

  /* ── Rail ─────────────────────────────────────────── */
  function rail(S) {
    const seg = (act, v, label, on) => `<button type="button" data-act="${act}" data-v="${v}" data-k="${act}-${v}" aria-pressed="${on}">${label}</button>`;
    return `<div class="rail-brand"><span class="rail-mark">R</span>חלון שיעור <small>אב-טיפוס · נתוני דוגמה</small></div>
      <div class="rail-group"><span class="rail-label">תרחיש</span><div class="seg-ctl">${seg('scenario', 'group', 'שיעור קבוצתי פעיל', S.scenario === 'group')}${seg('scenario', 'locked', 'שיעור נעול', S.scenario === 'locked')}</div></div>
      <div class="rail-group"><span class="rail-label">צפייה בתור</span><div class="seg-ctl">${seg('role', 'admin', 'מנהל/ת', S.role === 'admin')}${seg('role', 'instructor', 'מדריך/ה', S.role === 'instructor')}</div></div>
      <div class="rail-end">${B({ act: 'notes', label: 'הערות', icon: 'flag', cls: 'btn-sm ' + (S.notes ? 'btn-primary' : 'btn-outline'), pressed: String(S.notes) })}${B({ act: 'reset', label: 'איפוס', icon: 'undo', cls: 'btn-sm btn-ghost' })}</div>`;
  }

  /* ── Header (owner's sketch): service · date + time range · instructor ── */
  function header(S, D) {
    const L = S.lesson; const svc = M.service(L.serviceId);
    const flags = [];
    if (L.exception) flags.push(`<span class="flag warn" tabindex="0" data-tip="שיבוץ חריג מחוץ לזמינות\nסיבה: ${esc(L.exception.reason)}">${ic('flag', 'ic-sm')}</span>`);
    if (L.corrected) flags.push(`<span class="flag info" tabindex="0" data-tip="השיעור תוקן — הפירוט בלשונית היסטוריה">${ic('shield', 'ic-sm')}</span>`);
    const lockbar = L.lock && S.mode !== 'correction' ? `<div class="lockbar">${ic('lock')}<span><b>השיעור נעול לשינוי ישיר.</b> ${esc(L.lock.title)} · ${esc(L.lock.detail)}.${D.admin ? '' : ' לשינוי יש לפנות למשרד.'}</span>${D.admin ? B({ act: 'corr-start', label: 'פתיחת תיקון', cls: 'btn-sm btn-outline' }) : ''}${pin('A4', 'בכותרת נשארת שורה אחת בלבד.\nטופס התיקון נפתח בגוף החלון, והכפתורים קבועים בתחתית.')}</div>` : '';
    const modeChip = S.mode === 'edit' ? `${ic('pencil')}עריכת מועד ושיבוץ` : `${ic('shield')}תיקון שיעור נעול`;
    const t = (v, label) => `<button type="button" class="tab" role="tab" data-act="tab" data-v="${v}" data-k="tab-${v}" aria-selected="${S.tab === v}">${label}</button>`;
    return `<div class="m-head">
      <button type="button" class="x-edge" data-act="close" data-k="close" aria-label="סגירה (Esc)">${ic('x')}</button>
      <div class="hd">
        <div class="hd-cell"><span class="hd-cap">שירות</span><span class="hd-val"><span class="svc-dot" style="background:${svc.color}"></span><span id="m-title">${esc(svc.name)}</span>${L.status !== 'scheduled' ? pill(M.LESSON_PILL[L.status], M.LESSON_STATUS[L.status]) : ''}${flags.join('')}</span></div>
        <div class="hd-cell c"><span class="hd-cap">${M.longDate(L.date)}</span><span class="hd-time num">${L.time}–${M.endTime(L.time, L.duration)}</span></div>
        <div class="hd-cell e"><span class="hd-cap">מדריך/ה</span><span class="hd-val">${esc(D.ins.name)}</span></div>
      </div>
      ${lockbar}
      <div class="tabs">${S.mode === 'view' ? `<div class="tablist" role="tablist" aria-label="אזורי השיעור">${t('lesson', 'משתתפים')}${t('details', 'היסטוריה')}</div>` : `<span class="mode-chip">${modeChip}</span>`}</div>
    </div>`;
  }

  /* ── Participant pieces ───────────────────────────── */
  function hmoBadge(p) {
    if (p.funding.type !== 'hmo') return '';
    const f = p.funding;
    const tip = `${f.provider} · ${f.track}\nמספר אישור: ${f.authNumber}\nנותרו ${f.remaining} מתוך ${f.total} מפגשים\nבתוקף עד ${f.validUntil}`;
    return `<span class="fund" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(tip.replace(/\n/g, ', '))}">${esc(f.provider)}</span>`;
  }

  function statusChip(S, p, D) {
    if (p.status !== 'scheduled') return statusPill(p.status);
    return S.lesson.started && !D.cancelled ? pill('p-open', 'טרם סומן') : '';
  }

  function contactText(p) {
    const c = p.contact || {};
    if (!c.phone && !c.email) return 'אין פרטי קשר';
    return `${c.name ? `${esc(c.name)} (${esc(c.role)}) · ` : ''}<bdi dir="ltr">${esc(c.phone || c.email)}</bdi>`;
  }

  function reminderBell(S, p, D) {
    if (!D.admin || p.status !== 'scheduled' || D.cancelled || D.locked) return '';
    const st = p.reminder.state;
    const tip = st === 'confirmed' ? `אישר/ה הגעה${p.reminder.at ? ' · ' + p.reminder.at : ''}` : st === 'sent' ? `תזכורת נשלחה ${p.reminder.at}\nממתין לאישור הגעה` : 'לא נשלחה תזכורת';
    return `<span style="position:relative;display:inline-flex"><button type="button" class="bell ${st}" data-act="pop" data-id="${p.id}" data-k="pop-${p.id}" data-tip="${tip}" aria-label="תזכורת: ${tip}">${ic('bell', 'ic-sm')}</button>${S.pop === p.id ? reminderPop(p) : ''}</span>`;
  }

  function reminderPop(p) {
    const c = p.contact || {};
    const st = p.reminder.state;
    let body;
    if (st === 'sent') {
      body = `<div class="pop-sub">נשלחה ${p.reminder.at}. מה ענו?</div><div class="pop-actions">${B({ act: 'arrive', id: p.id, label: 'אישר/ה הגעה', icon: 'check', cls: 'btn-sm btn-outline' })}${B({ act: 'decline', id: p.id, label: 'לא יגיע/תגיע', icon: 'x', cls: 'btn-sm btn-outline' })}</div>${c.phone ? `<div class="pop-actions">${B({ act: 'remind', id: p.id, v: 'wa', label: 'שליחה חוזרת בוואטסאפ', icon: 'msg', cls: 'btn-sm btn-ghost' })}</div>` : ''}`;
    } else if (st === 'confirmed') {
      body = `<div class="pop-sub">${ic('check', 'ic-sm')} אישר/ה הגעה${p.reminder.at ? ' ב-' + p.reminder.at : ''}.</div>`;
    } else if (!c.phone && !c.email) {
      body = '<div class="pop-sub">אי אפשר לשלוח תזכורת — עדכנו פרטי קשר בכרטיס הלקוח.</div>';
    } else {
      body = `<div class="pop-actions">${c.phone ? B({ act: 'remind', id: p.id, v: 'wa', label: 'וואטסאפ', icon: 'msg', cls: 'btn-sm btn-outline' }) : ''}${c.email ? B({ act: 'remind', id: p.id, v: 'mail', label: 'מייל', icon: 'mail', cls: 'btn-sm btn-outline' }) : ''}</div><div class="pop-sub">ההודעה תיפתח מוכנה לשליחה, והתזכורת תסומן כנשלחה.</div>`;
    }
    return `<div class="pop" role="dialog" aria-label="תזכורת הגעה"><div class="pop-title">תזכורת · ${esc(p.name)}</div>${body}</div>`;
  }

  function reportIcon(S, p) {
    if (p.status !== 'attended') return '';
    if (p.report) return `<span class="flag ok" tabindex="0" data-tip="דיווח מפגש מתועד">${ic('fileCheck', 'ic-sm')}</span>`;
    return S.lesson.started ? B({ act: 'report', id: p.id, icon: 'filePen', cls: 'btn-icon btn-ghost', tip: 'תיעוד דיווח מפגש', style: 'color:var(--warn)' }) : '';
  }

  function rowMenu(p) {
    const c = p.contact || {};
    const items = [];
    if (p.status !== 'attended') items.push(`<button type="button" data-act="mark" data-id="${p.id}" data-v="attended">${ic('check', 'ic-sm')}סימון כנוכח/ת</button>`);
    if (p.status !== 'scheduled') {
      items.push(`<button type="button" data-act="absent" data-id="${p.id}">${ic('xc', 'ic-sm')}${p.status === 'attended' ? 'סימון היעדרות / ביטול' : 'שינוי סיבת ההיעדרות'}</button>`);
      items.push(`<button type="button" data-act="restore" data-id="${p.id}">${ic('undo', 'ic-sm')}החזרה למתוכנן</button>`);
    }
    if (c.phone) items.push(`<button type="button" data-act="ext" data-v="שיחה ל-${esc(c.phone)}">${ic('phone', 'ic-sm')}התקשרות · <bdi dir="ltr">${esc(c.phone)}</bdi></button>`);
    items.push('<hr>', `<button type="button" data-act="ext" data-v="כרטיס הלקוח של ${esc(p.name)}">${ic('ext', 'ic-sm')}פתיחת כרטיס לקוח</button>`);
    return `<div class="menu" role="menu">${items.join('')}</div>`;
  }

  const busyFor = (S, p) => Boolean(S.strip && S.strip.pid === p.id) || Boolean(S.absence && S.absence.pid === p.id);

  function row(S, p, D) {
    const busy = busyFor(S, p);
    const signals = `${reminderBell(S, p, D)}${reportIcon(S, p)}`;
    let acts = '';
    if (D.locked) acts = `<span class="locked-note">${ic('lock', 'ic-sm')}נעול</span>`;
    else if (!D.cancelled) acts = `${p.status === 'scheduled' ? B({ act: 'mark', id: p.id, v: 'attended', k: `mark-${p.id}`, icon: 'check', cls: 'btn-icon ok', tip: 'סימון כנוכח/ת', dis: busy }) + B({ act: 'absent', id: p.id, icon: 'xc', cls: 'btn-icon bad', tip: 'לא הגיע/ה או ביטול', dis: busy }) : ''}${B({ act: 'menu', id: p.id, icon: 'more', cls: 'btn-icon btn-ghost', tip: 'פעולות נוספות', dis: busy })}${S.menu === p.id ? rowMenu(p) : ''}`;
    const chip = statusChip(S, p, D);
    return `<div class="ra${S.highlight.includes(p.id) ? ' hl' : ''}" data-row="${p.id}">
      <div class="av ${p.status}" aria-hidden="true">${esc(M.initials(p.name))}</div>
      <div class="who"><div class="who-name">${esc(p.name)}${hmoBadge(p)}</div><div class="who-meta">${chip}${chip ? '<span class="dot" aria-hidden="true">·</span>' : ''}<span class="contact">${contactText(p)}</span>${p.waived ? '<span class="dot" aria-hidden="true">·</span><span>ויתור על חיוב</span>' : ''}</div></div>
      <div class="tools">${signals}${signals && acts ? '<span class="sep"></span>' : ''}${acts}</div>
    </div>${S.absence && S.absence.pid === p.id ? absenceForm(S, p, D) : ''}${S.strip && S.strip.pid === p.id ? strip(S, p) : ''}`;
  }

  function strip(S, p) {
    const T = S.strip;
    const r = T.res;
    let middle;
    if (T.phase === 'loading') middle = `<span class="strip-loading">${ic('loader', 'ic-sm spin')}בודקים את ההשפעה מול השרת…</span>`;
    else if (r.block) middle = '';
    else if (r.quiet) middle = `<span class="strip-quiet">${ic('check', 'ic-sm')}אין השפעה כספית — רק עדכון סטטוס</span>`;
    else middle = `<div class="strip-segs">${r.segs.map((s) => `<span><i>${s.k}</i>${s.html}</span>`).join('')}</div>`;
    const canOk = T.phase === 'ready' && !r.block;
    const detailsBtn = T.phase !== 'loading' && r && r.details && r.details.length ? B({ act: 'strip-details', label: T.details ? 'הסתרת פירוט' : 'פירוט', cls: 'btn-sm btn-ghost' }) : '';
    const okLabel = T.phase === 'saving' ? `${ic('loader', 'ic-sm spin')}שומרים…` : 'אישור <span class="kbd">Enter</span>';
    return `<div class="strip" role="group" aria-label="אישור שינוי סטטוס עבור ${esc(p.name)}">
      <div class="strip-line">
        <span class="strip-what">${statusPill(p.status)}${ic('arrow', 'ic-sm')}${statusPill(T.target)}</span>
        ${middle}
        <div class="strip-actions">${detailsBtn}${B({ act: 'strip-cancel', label: 'ביטול', cls: 'btn-sm btn-ghost' })}<button type="button" class="btn btn-sm btn-primary" data-act="strip-ok" data-k="strip-ok" ${canOk ? '' : 'disabled'}>${okLabel}</button></div>
      </div>
      ${r && r.block ? `<div class="strip-block">${ic('alert', 'ic-sm')}<span>${esc(r.block)}</span></div>` : ''}
      ${T.details && r && r.details ? `<div class="details">${r.details.map((d) => `<div class="detail ${d.k}"><h4>${d.title}</h4>${esc(d.text)}</div>`).join('')}</div>` : ''}
    </div>`;
  }

  function absenceForm(S, p, D) {
    const A = S.absence;
    const hints = { no_show: M.isCharged('no_show') ? 'יחויב לפי המדיניות' : 'ללא חיוב', cancelled_student: 'ללא חיוב', cancelled_clinic: 'ללא חיוב' };
    const opt = (act, v, label, on, hint) => `<button type="button" class="opt" role="radio" aria-checked="${on}" data-act="${act}" data-v="${v}" data-k="${act}-${v}">${label}${hint ? `<small>${hint}</small>` : ''}</button>`;
    const needComp = M.needsCompDecision(A.status);
    const waiver = M.waiverEligible(A.status);
    return `<div class="abs" role="group" aria-label="סימון היעדרות עבור ${esc(p.name)}">
      <div class="full field"><div class="lbl">מה קרה?</div><div class="opts" role="radiogroup">${ABSENT.map((s) => opt('abs-status', s, M.STATUS[s], A.status === s, hints[s])).join('')}</div></div>
      ${needComp ? `<div class="field"><div class="lbl" style="display:flex;align-items:center;gap:8px">שכר ל${esc(D.ins.name)} על המפגש${A.compFromPolicy ? '<span class="default-tag">לפי הגדרות השכר</span>' : ''}</div><div class="opts" role="radiogroup">${opt('abs-comp', 'compensated', 'לשלם', A.comp === 'compensated')}${opt('abs-comp', 'not_compensated', 'לא לשלם', A.comp === 'not_compensated')}</div></div>` : ''}
      ${waiver ? `<div class="field"><div class="lbl">חיוב הלקוח/ה</div><label class="check"><input type="checkbox" data-change="abs-waive" ${A.waive ? 'checked' : ''}> ויתור על החיוב של ${M.money(M.chargeOf(p))}</label></div>` : ''}
      <div class="full field"><label for="abs-note">הערה (לא חובה)</label><textarea id="abs-note" class="ctl" rows="2" data-input="abs-note" placeholder="לדוגמה: הודיעה בבוקר שהיא חולה">${esc(A.note)}</textarea></div>
      <div class="abs-actions">${A.error ? `<span class="foot-note warn">${ic('alert', 'ic-sm')}${esc(A.error)}</span>` : ''}${B({ act: 'abs-cancel', label: 'ביטול', cls: 'btn-sm btn-ghost' })}${B({ act: 'abs-continue', label: 'המשך', cls: 'btn-sm btn-primary', dis: needComp && !A.comp })}</div>
    </div>`;
  }

  function addResults(S) {
    const A = S.add;
    if (A.error) return `<div class="note bad">${ic('alert', 'ic-sm')}<span>${esc(A.error)}</span></div>`;
    if (A.q.trim().length < 2) return '<div class="add-hint">הקלידו לפחות 2 תווים.</div>';
    if (A.searching) return `<div class="add-hint">${ic('loader', 'ic-sm spin')} מחפשים…</div>`;
    if (!A.results.length) return '<div class="add-hint">לא נמצאו לקוחות שאינם רשומים כבר לשיעור.</div>';
    return `<div class="results">${A.results.map((st) => `<button type="button" class="result" data-act="add-pick" data-id="${st.id}" data-k="add-${st.id}" ${A.pending ? 'disabled' : ''}>${A.pending === st.id ? ic('loader', 'ic-sm spin') : ic('userPlus', 'ic-sm')}<b>${esc(st.name)}</b><span class="muted"><bdi dir="ltr">${esc(st.phone)}</bdi></span></button>`).join('')}</div>`;
  }

  function lessonTab(S, D) {
    const svc = M.service(S.lesson.serviceId);
    const active = S.participants.filter((p) => !ABSENT.includes(p.status)).length;
    const free = svc.capacity - active;
    const canAdd = D.canManage && S.lesson.status === 'scheduled';
    const cap = D.cancelled ? '' : free <= 0 ? ' · השיעור מלא' : free === 1 ? ' · מקום פנוי אחד' : ` · ${free} מקומות פנויים`;
    const head = `<div class="list-head"><span class="lh-count"><b>${S.participants.length} משתתפים</b>${cap}</span>${canAdd ? B({ act: 'add-toggle', label: S.add ? 'סגירת החיפוש' : 'הוספת משתתף/ת', icon: S.add ? 'x' : 'userPlus', cls: 'btn-sm btn-ghost' }) : ''}</div>`;
    const add = S.add ? `<div class="add"><div class="search">${ic('search')}<input class="ctl" data-input="add-q" data-k="add-q" placeholder="חיפוש לקוח/ה לפי שם או טלפון" value="${esc(S.add.q)}" aria-label="חיפוש לקוח/ה להוספה"></div><div id="add-results">${addResults(S)}</div></div>` : '';
    return `${D.cancelled ? `<div class="note bad">${ic('xc', 'ic-sm')}<span>השיעור בוטל. המשתתפים המתוכננים סומנו "ביטול ע״י המכון".</span></div>` : ''}
      ${head}${add}
      <div class="list">${S.participants.map((p) => row(S, p, D)).join('')}</div>`;
  }

  /* ── History (grouped by day, typed entries) ─────── */
  const HT = {
    create: { icon: 'plus', cls: 't-neutral' },
    reminder: { icon: 'bell', cls: 't-warn' },
    attendance: { icon: 'check', cls: 't-ok' },
    absence: { icon: 'xc', cls: 't-bad' },
    report: { icon: 'fileCheck', cls: 't-ok' },
    edit: { icon: 'pencil', cls: 't-primary' },
    participant: { icon: 'userPlus', cls: 't-primary' },
    status: { icon: 'flag', cls: 't-neutral' },
    payroll: { icon: 'wallet', cls: 't-hmo' },
    correction: { icon: 'shield', cls: 't-primary' },
  };
  const dayLabel = (iso) => (iso === TODAY ? 'היום' : iso === '2026-09-13' ? 'אתמול'
    : new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${iso}T00:00`)));

  function historyTab(S) {
    const L = S.lesson;
    const entries = S.history.map((h, i) => ({ ...h, i }))
      .sort((a, b) => (b.day + b.t).localeCompare(a.day + a.t) || b.i - a.i);
    const groups = [];
    entries.forEach((h) => { const g = groups[groups.length - 1]; if (g && g.day === h.day) g.items.push(h); else groups.push({ day: h.day, items: [h] }); });
    const item = (h) => {
      const t = HT[h.type] || HT.status;
      return `<li class="hi"><span class="hi-ic ${t.cls}">${ic(t.icon, 'ic-sm')}</span><div class="hi-body"><div class="hi-text">${esc(h.text)}${h.fresh ? pill('p-primary', 'חדש') : ''}</div>${h.note ? `<div class="hi-note">${esc(h.note)}</div>` : ''}${h.diff && h.diff.length ? diffChips(h.diff) : ''}<div class="hi-who">${esc(h.who)}</div></div><time class="hi-time num">${esc(h.t)}</time></li>`;
    };
    return `${L.exception ? `<div class="note warn">${ic('flag', 'ic-sm')}<span>שיבוץ חריג מחוץ לזמינות · ${esc(L.exception.reason)}</span></div>` : ''}
      <div class="hist">${groups.map((g) => `<section class="hist-day"><h4>${dayLabel(g.day)}</h4><ol>${g.items.map(item).join('')}</ol></section>`).join('')}</div>
      <details class="tech"><summary>פרטים טכניים</summary><dl class="kv"><div><dt>מקור</dt><dd>${esc(L.source)}</dd></div><div><dt>מזהה</dt><dd><bdi dir="ltr">…${L.id.slice(-8)}</bdi></dd></div><div><dt>גרסה</dt><dd class="num">${L.version}</dd></div></dl></details>`;
  }

  /* ── Edit mode ────────────────────────────────────── */
  function editBody(S) {
    const E = S.edit; const L = S.lesson;
    const svc = M.service(E.serviceId);
    const av = M.availability(E.instructorId, E.serviceId, E.date, E.time, svc.duration);
    const ch = (a, b) => (a !== b ? ' changed' : '');
    const tone = av.status === 'ok' ? 'ok' : av.status === 'missing' ? 'bad' : 'warn';
    return `<div class="card-block"><div class="form">
      <div class="field"><label for="e-date">תאריך</label><input id="e-date" type="date" class="ctl${ch(E.date, L.date)}" value="${E.date}" data-change="edit-date"></div>
      <div class="field"><label for="e-time">שעת התחלה</label><select id="e-time" class="ctl${ch(E.time, L.time)}" data-change="edit-time">${Array.from({ length: 52 }, (_, i) => M.fromMin(420 + i * 15)).map((t) => `<option value="${t}" ${t === E.time ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label for="e-svc">שירות</label><select id="e-svc" class="ctl${ch(E.serviceId, L.serviceId)}" data-change="edit-service">${M.SERVICES.map((s) => `<option value="${s.id}" ${s.id === E.serviceId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="e-ins">מדריך/ה</label><select id="e-ins" class="ctl${ch(E.instructorId, L.instructorId)}" data-change="edit-instructor">${M.INSTRUCTORS.map((i) => `<option value="${i.id}" ${i.id === E.instructorId ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></div>
      <div class="full note ${tone}">${ic(tone === 'ok' ? 'check' : 'alert', 'ic-sm')}<span><bdi dir="ltr">${E.time}–${M.endTime(E.time, svc.duration)}</bdi> · ${svc.duration} דקות לפי השירות · ${esc(av.text)}</span></div>
    </div></div>
    ${av.status === 'outside' ? `<div class="panel"><h3>${ic('flag')}שיבוץ חד-פעמי מחוץ לזמינות</h3>
      <div class="form"><div class="field"><label for="e-reason">סיבה</label><select id="e-reason" class="ctl" data-change="edit-reason"><option value="">בחרו סיבה</option>${M.OVERRIDE_REASONS.map((r) => `<option value="${r.value}" ${r.value === E.reason ? 'selected' : ''}>${r.label}</option>`).join('')}</select></div>
      ${E.reason === 'custom' ? `<div class="field"><label for="e-custom">פירוט</label><input id="e-custom" class="ctl" data-input="edit-custom" value="${esc(E.custom)}" placeholder="למה נדרש המועד הזה?"></div>` : ''}</div></div>` : ''}`;
  }

  function editFoot(S) {
    const E = S.edit;
    const diffs = editDiffs(S);
    const svc = M.service(E.serviceId);
    const av = M.availability(E.instructorId, E.serviceId, E.date, E.time, svc.duration);
    const reasonOk = av.status !== 'outside' || (E.reason && (E.reason !== 'custom' || E.custom.trim()));
    let blocker = '';
    if (!diffs.length) blocker = 'לא בוצעו שינויים';
    else if (av.status === 'missing') blocker = 'יש לבחור מדריך/ה שמעביר/ה את השירות';
    else if (!reasonOk) blocker = 'יש לבחור סיבה לשיבוץ מחוץ לזמינות';
    const pv = E.phase === 'ready' && E.preview ? `<div class="pv">${E.preview.items.map((it) => `<div class="pv-item ${it.tone || ''}">${ic(it.tone === 'bad' ? 'alert' : 'info', 'ic-sm')}<span>${esc(it.text)}</span></div>`).join('')}</div>` : '';
    const main = E.phase === 'ready' && E.preview?.canApply ? B({ act: 'edit-save', label: 'אישור ושמירה', icon: 'check', cls: 'btn-ok', k: 'edit-save' })
      : E.phase === 'saving' ? `<button class="btn btn-ok" disabled>${ic('loader', 'spin')}שומרים…</button>`
        : E.phase === 'loading' ? `<button class="btn btn-primary" disabled>${ic('loader', 'spin')}בודקים…</button>`
          : B({ act: 'edit-check', label: 'בדיקת השפעה', cls: 'btn-primary', dis: Boolean(blocker) || (E.phase === 'ready' && !E.preview?.canApply), k: 'edit-check' });
    return `<div class="m-foot">${diffs.length || pv ? `<div class="foot-extra">${diffs.length ? diffChips(diffs) : ''}${pv}</div>` : ''}<div class="foot-row">${blocker ? `<span class="foot-note">${esc(blocker)}</span>` : ''}<div class="foot-actions">${B({ act: 'edit-cancel', label: 'ביטול עריכה', cls: 'btn-ghost' })}${main}</div></div></div>`;
  }

  /* ── Correction mode (locked) ─────────────────────── */
  function corrBody(S) {
    const C = S.corr;
    const opts = ['attended', 'no_show', 'cancelled_student', 'cancelled_clinic'];
    return `<p class="lead">התיקון לא משנה את השיעור המקורי — הוא נרשם כרשומה נוספת עם ההשפעה הכספית המלאה, ונשמר ביומן הביקורת.</p>
      <div class="card-block"><div class="form">
        <div class="field"><label for="c-reason">סוג התיקון</label><select id="c-reason" class="ctl" data-change="corr-reason">${M.CORRECTION_REASONS.map((r) => `<option value="${r.value}" ${r.value === C.reason ? 'selected' : ''}>${r.label}</option>`).join('')}</select></div>
        <div class="full field"><label for="c-text">הסבר (חובה)</label><textarea id="c-text" class="ctl" rows="2" data-input="corr-text" placeholder="מה נדרש לתקן, ומה מקור המידע המעודכן?">${esc(C.text)}</textarea></div>
      </div></div>
      <div class="list">${S.participants.map((p) => `<div class="ra" style="grid-template-columns:40px minmax(0,1fr) 200px"><div class="av ${p.status}" aria-hidden="true">${esc(M.initials(p.name))}</div><div class="who"><div class="who-name">${esc(p.name)}</div><div class="who-meta">${statusPill(p.status)}</div></div><select class="ctl${C.statuses[p.id] !== p.status ? ' changed' : ''}" data-change="corr-status" data-id="${p.id}" aria-label="סטטוס מתוקן עבור ${esc(p.name)}">${opts.map((o) => `<option value="${o}" ${o === C.statuses[p.id] ? 'selected' : ''}>${o === p.status ? 'ללא שינוי' : M.STATUS[o]}</option>`).join('')}</select></div>`).join('')}</div>`;
  }

  function corrFoot(S) {
    const C = S.corr;
    const changed = S.participants.filter((p) => C.statuses[p.id] !== p.status);
    let blocker = '';
    if (!changed.length) blocker = 'בחרו משתתף/ת לתיקון';
    else if (!C.text.trim()) blocker = 'יש לכתוב הסבר לתיקון';
    const pv = C.phase === 'ready' && C.preview ? `<div class="deltas"><div class="delta"><span>חיוב לקוחות</span><b class="num">${M.signedMoney(C.preview.billing)}</b></div><div class="delta"><span>שכר מדריך/ה</span><b class="num">${M.signedMoney(C.preview.payroll)}</b></div><div class="delta"><span>דקות עבודה</span><b class="num">0</b></div></div>${C.preview.notes.map((n) => `<div class="pv-item">${ic('info', 'ic-sm')}<span>${esc(n)}</span></div>`).join('')}` : '';
    const main = C.phase === 'ready' ? B({ act: 'corr-apply', label: 'החלת תיקון', cls: 'btn-primary', k: 'corr-apply' })
      : C.phase === 'loading' ? `<button class="btn btn-primary" disabled>${ic('loader', 'spin')}מחשבים השפעה…</button>`
        : B({ act: 'corr-check', label: 'תצוגת השפעה', cls: 'btn-primary', dis: Boolean(blocker), k: 'corr-check' });
    return `<div class="m-foot">${pv ? `<div class="foot-extra">${pv}</div>` : ''}<div class="foot-row">${blocker ? `<span class="foot-note">${esc(blocker)}</span>` : ''}<div class="foot-actions">${B({ act: 'corr-cancel', label: 'חזרה לשיעור', cls: 'btn-ghost' })}${main}</div></div></div>`;
  }

  /* ── View footer (includes the one-line closure status) ── */
  function viewFoot(S, D) {
    const L = S.lesson;
    let note = '';
    if (D.locked) note = `<span class="foot-note">${ic('lock', 'ic-sm')}שינויים נעשים דרך תיקון בלבד.</span>`;
    else if (D.cancelled) note = '<span class="foot-note">השיעור בוטל.</span>';
    else if (D.scheduled.length) note = `<span class="foot-note warn">${ic('alert', 'ic-sm')}${D.scheduled.length} משתתפים טרם סומנו</span>`;
    else if (D.remaining.length) note = `<span class="foot-note" tabindex="0" data-tip="${esc(D.remaining.map((r) => `${r.label}: ${r.detail}`).join('\n'))}">${ic('clock', 'ic-sm')}נותר לסגירה: ${D.remaining.map((r) => esc(r.label)).join(' · ')}</span>`;
    else note = `<span class="foot-note ok">${ic('check', 'ic-sm')}השיעור סגור — אין משימות פתוחות.</span>`;
    const actions = [];
    if (!D.locked && !D.cancelled && L.status === 'scheduled') actions.push(B({ act: 'complete', label: 'סמן כהושלם', icon: 'check', cls: 'btn-ok', dis: D.scheduled.length > 0 }));
    if (D.canManage && L.status === 'scheduled') {
      actions.push(B({ act: 'edit-start', label: 'עריכה', icon: 'pencil', cls: 'btn-outline' }));
      actions.push(B({ act: 'foot-menu', icon: 'more', cls: 'btn-outline btn-icon', tip: 'פעולות נוספות' }));
      if (S.footMenu) actions.push(`<div class="menu up" role="menu"><button type="button" data-act="ext" data-v="סיכום יומי לדנה לוי בוואטסאפ">${ic('msg', 'ic-sm')}שליחת סיכום יום למדריך/ה</button><hr><button type="button" class="danger" data-act="cancel-open">${ic('xc', 'ic-sm')}ביטול השיעור…</button></div>`);
    }
    if (!actions.length) actions.push(B({ act: 'close', label: 'סגירה', cls: 'btn-outline', k: 'foot-close' }));
    return `<div class="m-foot"><div class="foot-row">${note}<div class="foot-actions">${actions.join('')}</div></div></div>`;
  }

  /* ── Dialogs ──────────────────────────────────────── */
  function dialog(S) {
    const G = S.dialog; if (!G) return '';
    let inner = '';
    if (G.type === 'cancel') {
      if (G.phase === 'loading') inner = `<h3>ביטול השיעור</h3><p>${ic('loader', 'ic-sm spin')} טוענים את ההשפעה מהשרת…</p>`;
      else if (G.res.blocked) {
        inner = `<h3>אי אפשר לבטל את השיעור כרגע</h3><p>יש משתתפים שכבר סומנו כנוכחים או שיש להם דיווח מתועד. החזירו אותם למתוכנן, ואז בטלו.</p>
          <div class="dlg-rows">${G.res.blockedAttended.map((p) => `<div class="dlg-row">${statusPill(p.status)}<b>${esc(p.name)}</b>${p.report ? '<span class="muted">יש דיווח מתועד</span>' : B({ act: 'cancel-goto', id: p.id, label: 'החזרה למתוכנן', cls: 'btn-sm btn-outline' })}</div>`).join('')}</div>
          <div class="dlg-foot">${B({ act: 'dlg-close', label: 'הבנתי', cls: 'btn-outline', k: 'dlg-close' })}</div>`;
      } else {
        inner = `<h3>ביטול השיעור</h3>
          <div class="dlg-rows"><div class="dlg-row">${ic('users', 'ic-sm')}<span>${G.res.scheduled.length} משתתפים יסומנו "ביטול ע״י המכון"</span><span class="muted">${G.res.resolved.length ? `${G.res.resolved.length} אחרים לא ישתנו` : ''}</span></div>
          <div class="dlg-row">${ic('check', 'ic-sm')}<span>ללא חיוב ללקוחות</span></div>
          <div class="dlg-row">${ic('check', 'ic-sm')}<span>ללא שכר ל${esc(M.instructor(S.lesson.instructorId).name)}</span></div></div>
          <div class="dlg-foot">${B({ act: 'dlg-close', label: 'חזרה', cls: 'btn-outline' })}${B({ act: 'cancel-confirm', label: 'ביטול השיעור', cls: 'btn-danger', k: 'cancel-confirm' })}</div>`;
      }
    } else if (G.type === 'discard') {
      inner = `<h3>לבטל את השינויים?</h3><p>השינויים (${editDiffs(S).map((d) => d.label).join(', ')}) לא נשמרו.</p><div class="dlg-foot">${B({ act: 'dlg-close', label: 'המשך עריכה', cls: 'btn-outline', k: 'dlg-keep' })}${B({ act: 'discard-confirm', label: 'ביטול השינויים', cls: 'btn-danger' })}</div>`;
    } else if (G.type === 'corr-confirm') {
      const pv = S.corr.preview;
      inner = `<h3>להחיל את התיקון?</h3><p>התיקון יירשם ביומן הביקורת ולא ניתן למחוק אותו — רק לתקן שוב.</p><div class="dlg-rows"><div class="dlg-row">חיוב לקוחות<span class="muted num">${M.signedMoney(pv.billing)}</span></div><div class="dlg-row">שכר מדריך/ה<span class="muted num">${M.signedMoney(pv.payroll)}</span></div></div><div class="dlg-foot">${B({ act: 'dlg-close', label: 'חזרה', cls: 'btn-outline' })}${B({ act: 'corr-confirm', label: 'החלת התיקון', cls: 'btn-primary', k: 'corr-confirm' })}</div>`;
    }
    return `<div class="dlg-ov"><div class="dlg" role="alertdialog" aria-modal="true">${inner}</div></div>`;
  }

  /* ── Stage ────────────────────────────────────────── */
  function stage(S) {
    if (!S.open) {
      return `<div class="reopen"><span>החלון נסגר. פתיחה מחדש תמיד מתחילה בלשונית "משתתפים", בלי מצב עריכה ובלי שגיאות ישנות.</span>${B({ act: 'reopen', label: 'פתיחה מחדש', cls: 'btn-primary btn-sm', k: 'reopen' })}</div>`;
    }
    const D = derive(S);
    let body; let foot;
    if (S.mode === 'edit') { body = editBody(S); foot = editFoot(S); }
    else if (S.mode === 'correction') { body = corrBody(S); foot = corrFoot(S); }
    else {
      body = S.tab === 'details' ? historyTab(S) : lessonTab(S, D);
      foot = viewFoot(S, D);
    }
    return `<section class="m" role="dialog" aria-modal="true" aria-labelledby="m-title">${header(S, D)}<div class="m-body">${body}</div>${foot}</section>${dialog(S)}`;
  }

  function toasts(S) {
    return S.toasts.map((t) => `<div class="toast ${t.kind}">${ic(t.kind === 'err' ? 'alert' : t.kind === 'info' ? 'info' : 'check')}<span>${esc(t.text)}</span></div>`).join('');
  }

  function foot(S) {
    return S.mode === 'edit' ? editFoot(S) : S.mode === 'correction' ? corrFoot(S) : viewFoot(S, derive(S));
  }

  return { rail, stage, toasts, addResults, foot, derive, editDiffs };
})();
