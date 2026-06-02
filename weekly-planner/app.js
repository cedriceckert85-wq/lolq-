/* =========================================================
   Wochenplaner – App-Logik
   Lokal, offline, ohne Server. Daten liegen im localStorage.
   ========================================================= */

(() => {
  'use strict';

  // ---------- Konstanten ----------
  const STORAGE_KEY = 'wochenplaner.tasks.v1';
  const DAILY_CAPACITY = 300; // Minuten produktive Planzeit pro Tag (5 Std)
  const DOW = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const DOW_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  const IMPORTANCE_LABEL = { 1: 'Niedrig', 2: 'Normal', 3: 'Hoch', 4: 'Sehr hoch', 5: 'Kritisch' };

  // ---------- Hilfsfunktionen Datum ----------
  // Wochentag-Index mit Montag = 0 ... Sonntag = 6
  const isoDow = (d) => (d.getDay() + 6) % 7;

  function startOfWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - isoDow(d));
    return d;
  }
  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }
  // Lokaler ISO-Datumsschlüssel (YYYY-MM-DD), ohne Zeitzonen-Verschiebung
  function dateKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function parseKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function fmtDur(min) {
    if (min < 60) return `${min} Min`;
    const h = min / 60;
    return Number.isInteger(h) ? `${h} Std` : `${String(h).replace('.', ',')} Std`;
  }
  function fmtRange(weekStart) {
    const end = addDays(weekStart, 6);
    const opt = { day: 'numeric', month: 'short' };
    return `${weekStart.toLocaleDateString('de-DE', opt)} – ${end.toLocaleDateString('de-DE', opt)}`;
  }

  // ---------- Zustand ----------
  let tasks = load();
  let viewWeekStart = startOfWeek(new Date());
  let selectedView = 'all'; // 'all' oder 0..6
  let editingId = null;
  let draftImportance = 3;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (_) {
      toast('Speichern fehlgeschlagen');
    }
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- Der Planer ----------
  // Verteilt die automatischen Aufgaben einer Woche greedy über die verfügbaren
  // Tage: am wichtigsten/dringendsten zuerst, möglichst früh, Deadlines werden
  // respektiert und die Tageslast wird ausbalanciert.
  function plan(weekStart) {
    const weekKey = dateKey(weekStart);
    const weekTasks = tasks.filter((t) => t.weekKey === weekKey);

    // Ab welchem Wochentag darf geplant werden?
    const thisWeekKey = dateKey(startOfWeek(new Date()));
    let startIdx = 0;
    if (weekKey === thisWeekKey) startIdx = isoDow(new Date());
    else if (parseKey(weekKey) < parseKey(thisWeekKey)) startIdx = 0; // vergangene Woche

    // Deadline → Wochentag-Index relativ zur angezeigten Woche
    const deadlineIdx = (t) => {
      if (!t.deadline) return null;
      const diff = Math.round((parseKey(t.deadline) - weekStart) / 86400000);
      return diff;
    };

    // Last je Tag (Minuten)
    const load = [0, 0, 0, 0, 0, 0, 0];
    const byDay = [[], [], [], [], [], [], []];

    // 1) Feste Aufgaben zuerst verankern
    const fixed = weekTasks.filter((t) => t.fixedDay !== null && t.fixedDay !== undefined && t.fixedDay !== '');
    fixed.forEach((t) => {
      const d = Math.max(0, Math.min(6, Number(t.fixedDay)));
      t._day = d;
      load[d] += t.duration;
      byDay[d].push(t);
    });

    // 2) Automatische Aufgaben nach Wichtigkeit + Dringlichkeit sortieren
    const score = (t) => {
      let s = t.importance * 100;
      const dl = deadlineIdx(t);
      if (dl !== null) {
        const slack = dl - startIdx; // verbleibende Tage bis Deadline
        if (slack <= 0) s += 1000; // überfällig / heute fällig
        else s += Math.max(0, 320 - slack * 45);
      }
      return s;
    };
    const auto = weekTasks
      .filter((t) => !fixed.includes(t))
      .sort((a, b) => score(b) - score(a) || b.importance - a.importance || b.duration - a.duration);

    // 3) Greedy in Tage einsortieren
    auto.forEach((t) => {
      const dl = deadlineIdx(t);
      let latest = 6;
      if (dl !== null) latest = Math.min(6, Math.max(startIdx, dl));
      const lo = startIdx;
      const hi = Math.max(lo, latest);

      // a) frühester Tag im erlaubten Fenster, der noch Kapazität hat
      let target = -1;
      for (let d = lo; d <= hi; d++) {
        if (load[d] + t.duration <= DAILY_CAPACITY) { target = d; break; }
      }
      // b) sonst Tag mit geringster Last im Fenster (Überlast akzeptieren)
      if (target === -1) {
        target = lo;
        for (let d = lo; d <= hi; d++) if (load[d] < load[target]) target = d;
      }
      t._day = target;
      load[target] += t.duration;
      byDay[target].push(t);
    });

    // 4) Innerhalb jedes Tages: wichtig zuerst, erledigte ans Ende
    byDay.forEach((list) =>
      list.sort((a, b) => (a.done - b.done) || (b.importance - a.importance) || (a.duration - b.duration))
    );

    return { byDay, load, startIdx };
  }

  // ---------- Rendern ----------
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };

  function render() {
    const today = new Date();
    const thisWeekKey = dateKey(startOfWeek(today));
    const todayIdx = isoDow(today);
    const isThisWeek = dateKey(viewWeekStart) === thisWeekKey;

    $('#weekRange').textContent = isThisWeek ? 'Diese Woche' : fmtRange(viewWeekStart);
    $('#todayLabel').textContent = today.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

    const { byDay, load } = plan(viewWeekStart);

    // Kennzahlen
    const weekKey = dateKey(viewWeekStart);
    const weekTasks = tasks.filter((t) => t.weekKey === weekKey);
    const open = weekTasks.filter((t) => !t.done).length;
    const done = weekTasks.filter((t) => t.done).length;
    const totalMin = weekTasks.filter((t) => !t.done).reduce((s, t) => s + t.duration, 0);
    $('#statOpen').textContent = open;
    $('#statDone').textContent = done;
    $('#statLoad').textContent = totalMin >= 60 ? `${(totalMin / 60).toFixed(totalMin % 60 ? 1 : 0).replace('.', ',')}h` : `${totalMin}m`;

    renderDayNav(byDay, isThisWeek ? todayIdx : -1);
    renderContent(byDay, load, isThisWeek ? todayIdx : -1, weekTasks);
  }

  function renderDayNav(byDay, todayIdx) {
    const nav = $('#daynav');
    nav.innerHTML = '';

    const mkChip = (label, sub, value, opts = {}) => {
      const chip = el('button', 'daychip');
      chip.dataset.value = value;
      chip.dataset.has = opts.has ? '1' : '0';
      if (String(selectedView) === String(value)) chip.classList.add('is-active');
      if (opts.today) chip.classList.add('is-today');
      chip.innerHTML =
        `<div class="daychip__dow">${label}</div>` +
        `<div class="daychip__num">${sub}</div>` +
        `<div class="daychip__dot"></div>`;
      chip.addEventListener('click', () => {
        selectedView = value === 'all' ? 'all' : Number(value);
        render();
      });
      return chip;
    };

    nav.appendChild(mkChip('Woche', '7', 'all'));
    for (let i = 0; i < 7; i++) {
      const date = addDays(viewWeekStart, i);
      const hasTasks = byDay[i].some((t) => !t.done);
      nav.appendChild(mkChip(DOW[i], date.getDate(), i, { has: hasTasks, today: i === todayIdx }));
    }
  }

  function renderContent(byDay, load, todayIdx, weekTasks) {
    const root = $('#content');
    root.innerHTML = '';

    if (weekTasks.length === 0) {
      const empty = el('div', 'empty');
      empty.innerHTML =
        '<div class="empty__emoji">🗓️</div>' +
        '<div class="empty__text">Noch keine Aufgaben für diese Woche.<br>Tippe auf <b>+</b>, um zu starten.</div>';
      root.appendChild(empty);
      return;
    }

    // Wochen-Übersicht nur in der "Woche"-Ansicht
    if (selectedView === 'all') root.appendChild(buildBanner(byDay, load, todayIdx));

    const days = selectedView === 'all' ? [0, 1, 2, 3, 4, 5, 6] : [selectedView];
    days.forEach((i) => {
      const list = byDay[i];
      if (selectedView === 'all' && list.length === 0) return; // leere Tage in der Übersicht ausblenden

      const block = el('div', 'day-block');
      const head = el('div', 'day-block__head');
      const date = addDays(viewWeekStart, i);
      const isToday = i === todayIdx;
      head.innerHTML =
        `<span class="day-block__title">${DOW_LONG[i]}${isToday ? ' · heute' : ''} <span style="color:var(--text-faint);font-weight:600">${date.getDate()}.${date.getMonth() + 1}.</span></span>` +
        `<span class="day-block__meta">${list.length} ${list.length === 1 ? 'Aufgabe' : 'Aufgaben'} · ${fmtDur(load[i])}</span>`;
      block.appendChild(head);

      if (list.length === 0) {
        block.appendChild(el('div', 'empty', '<div class="empty__text">Frei – nichts geplant.</div>'));
      } else {
        list.forEach((t) => block.appendChild(buildTask(t, i)));
      }
      root.appendChild(block);
    });
  }

  function buildBanner(byDay, load, todayIdx) {
    const open = tasks.filter((t) => t.weekKey === dateKey(viewWeekStart) && !t.done);
    const totalMin = open.reduce((s, t) => s + t.duration, 0);
    // geschäftigster Tag
    let busiest = -1;
    for (let i = 0; i < 7; i++) if (busiest === -1 || load[i] > load[busiest]) busiest = i;
    const overloaded = load.filter((m) => m > DAILY_CAPACITY).length;
    const critical = open.filter((t) => t.importance >= 4).length;

    let txt = `<b>${open.length} offene Aufgaben</b> für insgesamt <b>${fmtDur(totalMin)}</b> verplant. `;
    if (critical > 0) txt += `${critical} davon hoch priorisiert. `;
    if (load[busiest] > 0) txt += `Vollster Tag: <b>${DOW_LONG[busiest]}</b> (${fmtDur(load[busiest])}). `;
    if (overloaded > 0) txt += `⚠️ ${overloaded} ${overloaded === 1 ? 'Tag' : 'Tage'} über der Tageskapazität – ggf. entzerren.`;
    else if (open.length > 0) txt += 'Last gut verteilt. ✅';

    return el('div', 'banner', txt);
  }

  function buildTask(t, dayIdx) {
    const card = el('div', 'task');
    card.dataset.p = t.importance;
    if (t.done) card.classList.add('is-done');

    // Checkbox
    const check = el('button', 'check');
    check.setAttribute('aria-label', t.done ? 'Als offen markieren' : 'Als erledigt markieren');
    check.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    check.addEventListener('click', (e) => {
      e.stopPropagation();
      t.done = !t.done;
      save();
      render();
    });

    // Körper
    const body = el('div', 'task__body');
    const title = el('div', 'task__title', escapeHtml(t.title));
    const tags = el('div', 'task__tags');

    const pTag = el('span', 'tag tag--p', IMPORTANCE_LABEL[t.importance]);
    pTag.dataset.p = t.importance;
    tags.appendChild(pTag);

    tags.appendChild(el('span', 'tag', `⏱ ${fmtDur(t.duration)}`));

    if (t.fixedDay !== null && t.fixedDay !== undefined && t.fixedDay !== '') {
      tags.appendChild(el('span', 'tag', '📌 fester Tag'));
    }
    if (t.deadline) {
      const dl = parseKey(t.deadline);
      const diff = Math.round((dl - addDays(viewWeekStart, dayIdx)) / 86400000);
      const label = `📅 bis ${dl.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}`;
      const tag = el('span', diff < 0 ? 'tag tag--warn' : 'tag', label);
      tags.appendChild(tag);
    }

    body.appendChild(title);
    body.appendChild(tags);

    const edit = el('button', 'task__edit', '✎');
    edit.setAttribute('aria-label', 'Bearbeiten');
    edit.addEventListener('click', (e) => { e.stopPropagation(); openSheet(t); });

    card.appendChild(check);
    card.appendChild(body);
    card.appendChild(edit);
    card.addEventListener('click', () => openSheet(t));
    return card;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- Eingabe-Dialog ----------
  function openSheet(task) {
    editingId = task ? task.id : null;
    $('#sheetTitle').textContent = task ? 'Aufgabe bearbeiten' : 'Neue Aufgabe';
    $('#fTitle').value = task ? task.title : '';
    $('#fDuration').value = task ? task.duration : '30';
    $('#fDeadline').value = task && task.deadline ? task.deadline : '';
    $('#fFixedDay').value = task && task.fixedDay !== null && task.fixedDay !== undefined ? String(task.fixedDay) : '';
    draftImportance = task ? task.importance : 3;
    setImportanceUI(draftImportance);
    $('#sheetDelete').hidden = !task;

    $('#sheetBackdrop').hidden = false;
    setTimeout(() => $('#fTitle').focus(), 150);
  }
  function closeSheet() {
    $('#sheetBackdrop').hidden = true;
    editingId = null;
  }
  function setImportanceUI(val) {
    document.querySelectorAll('#fImportance button').forEach((b) =>
      b.classList.toggle('is-active', Number(b.dataset.val) === Number(val)));
  }

  function saveFromSheet() {
    const title = $('#fTitle').value.trim();
    if (!title) { toast('Bitte einen Titel eingeben'); $('#fTitle').focus(); return; }

    const data = {
      title,
      importance: draftImportance,
      duration: Number($('#fDuration').value),
      deadline: $('#fDeadline').value || null,
      fixedDay: $('#fFixedDay').value === '' ? null : Number($('#fFixedDay').value),
    };

    if (editingId) {
      const t = tasks.find((x) => x.id === editingId);
      if (t) Object.assign(t, data);
      toast('Aktualisiert');
    } else {
      tasks.push({
        id: uid(),
        weekKey: dateKey(viewWeekStart),
        done: false,
        createdAt: Date.now(),
        ...data,
      });
      toast('Aufgabe geplant');
    }
    save();
    closeSheet();
    render();
  }

  function deleteCurrent() {
    if (!editingId) return;
    tasks = tasks.filter((t) => t.id !== editingId);
    save();
    closeSheet();
    render();
    toast('Gelöscht');
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => (t.hidden = true), 220);
    }, 1800);
  }

  // ---------- Ereignisse verdrahten ----------
  $('#addBtn').addEventListener('click', () => openSheet(null));
  $('#sheetCancel').addEventListener('click', closeSheet);
  $('#sheetSave').addEventListener('click', saveFromSheet);
  $('#sheetDelete').addEventListener('click', deleteCurrent);
  $('#sheetBackdrop').addEventListener('click', (e) => { if (e.target.id === 'sheetBackdrop') closeSheet(); });
  $('#fImportance').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    draftImportance = Number(btn.dataset.val);
    setImportanceUI(draftImportance);
  });
  $('#weekPrev').addEventListener('click', () => { viewWeekStart = addDays(viewWeekStart, -7); selectedView = 'all'; render(); });
  $('#weekNext').addEventListener('click', () => { viewWeekStart = addDays(viewWeekStart, 7); selectedView = 'all'; render(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheetBackdrop').hidden) closeSheet(); });

  // Erststart: Beispieldaten anlegen, damit die App nicht leer wirkt
  function seedIfEmpty() {
    if (tasks.length > 0) return;
    const wk = dateKey(viewWeekStart);
    const today = new Date();
    const samples = [
      { title: 'Projektabgabe fertigstellen', importance: 5, duration: 120, deadline: dateKey(addDays(today, 2)), fixedDay: null },
      { title: 'Wocheneinkauf', importance: 2, duration: 60, deadline: null, fixedDay: 5 },
      { title: 'Sport / Workout', importance: 3, duration: 45, deadline: null, fixedDay: null },
      { title: 'E-Mails & Orga', importance: 2, duration: 30, deadline: null, fixedDay: null },
      { title: 'Präsentation vorbereiten', importance: 4, duration: 90, deadline: dateKey(addDays(today, 3)), fixedDay: null },
    ];
    samples.forEach((s) => tasks.push({ id: uid(), weekKey: wk, done: false, createdAt: Date.now(), ...s }));
    save();
  }

  seedIfEmpty();
  render();

  // ---------- Service Worker für Offline-Betrieb ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline ohne SW weiterhin nutzbar */ });
    });
  }
})();
