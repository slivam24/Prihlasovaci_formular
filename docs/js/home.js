/* Úvodní stránka: akce s otevřeným (nebo nedávno uzavřeným) přihlašováním.
 * Kompaktní seznam po měsících, nebo kalendář; vyhledávání při větším počtu akcí; uložení akce do kalendáře (.ics).
 * Akce se ukážou hned z poslední uložené kopie a na pozadí se načtou aktuální. */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esc = window.escapeHtml;
  const R = window.Rules;
  const DAY = 864e5;
  const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
  const MONTHS_SHORT = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'];
  const WEEKDAYS = ['po', 'út', 'st', 'čt', 'pá', 'so', 'ne'];
  const SEARCH_FROM = 5; // vyhledávání se ukáže od tohoto počtu akcí

  const state = { events: [], view: 'list', q: '', month: null };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* nic */ } },
  };

  // ---------- data a pomocné funkce ----------

  const parse = (s) => {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const monthKey = (d) => d.getFullYear() * 12 + d.getMonth();
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const formUrl = (ev) => `prihlaska.html?akce=${encodeURIComponent(ev.slug)}`;
  const listUrl = (ev) => `seznam.html?akce=${encodeURIComponent(ev.slug)}`;

  function deadlineInfo(ev) {
    if (!ev.deadline || R.isClosed(ev)) return null;
    const days = Math.round((parse(ev.deadline) - today()) / DAY);
    if (days < 0) return null;
    if (days === 0) return { text: 'uzávěrka dnes', soon: true };
    if (days === 1) return { text: 'uzávěrka zítra', soon: true };
    return { text: `přihlášky do ${R.formatDate(ev.deadline).replace(/ \d{4}$/, '')}`, soon: days <= 3 };
  }

  function matches(ev, q) {
    if (!q) return true;
    const hay = R.norm([ev.name, ev.place, ...ev.tournaments.map((t) => t.name + ' ' + (t.short || ''))].join(' '));
    return R.norm(q).split(/\s+/).every((w) => hay.includes(w));
  }

  // ---------- .ics (uložení do kalendáře) ----------

  function icsFor(ev) {
    const from = parse(ev.dateFrom);
    if (!from) return null;
    const to = parse(ev.dateTo) || from;
    const end = new Date(to.getTime() + DAY);
    const d = (x) => iso(x).replace(/-/g, '');
    const text = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const url = new URL(formUrl(ev), location.href).toString();
    const desc = ev.tournaments.map((t) => '• ' + R.tournamentLabel(t)).join('\n') +
      (ev.deadline ? `\nPřihlášky do ${R.formatDate(ev.deadline)}` : '') + `\nPřihláška: ${url}` + (ev.infoUrl ? `\nPropozice: ${ev.infoUrl}` : '');
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Prihlasky na sachove turnaje//CS', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      `UID:${ev.slug}@prihlasky`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`,
      `DTSTART;VALUE=DATE:${d(from)}`, `DTEND;VALUE=DATE:${d(end)}`, `SUMMARY:${text(ev.name)}`,
      ev.place ? `LOCATION:${text(ev.place)}` : '', `DESCRIPTION:${text(desc)}`, `URL:${url}`, 'END:VEVENT', 'END:VCALENDAR',
    ].filter(Boolean);
    // řádky delší než 75 bajtů se podle RFC 5545 zalamují (pokračování začíná mezerou)
    const fold = (line) => {
      const out = [];
      let cur = '';
      for (const ch of line) {
        if (new TextEncoder().encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ''; }
        cur += ch;
      }
      out.push(cur);
      return out.join('\r\n ');
    };
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  function downloadIcs(ev) {
    const ics = icsFor(ev);
    if (!ics) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    a.download = (ev.slug || 'akce') + '.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------- seznam ----------

  function dateBadge(ev) {
    const from = parse(ev.dateFrom);
    if (!from) return '<div class="ev-date"><span class="ev-day">?</span></div>';
    const to = parse(ev.dateTo) || from;
    const sameMonth = from.getMonth() === to.getMonth();
    const day = +to === +from ? from.getDate() : sameMonth ? `${from.getDate()}–${to.getDate()}` : `${from.getDate()}.`;
    const wd = WEEKDAYS[(from.getDay() + 6) % 7] + (+to !== +from ? '–' + WEEKDAYS[(to.getDay() + 6) % 7] : '');
    return `<div class="ev-date" aria-hidden="true"><span class="ev-month">${MONTHS_SHORT[from.getMonth()]}</span>
      <span class="ev-day${String(day).length > 3 ? ' long' : ''}">${day}</span><span class="ev-wd">${wd}</span></div>`;
  }

  function row(ev) {
    const closed = R.isClosed(ev);
    const dl = deadlineInfo(ev);
    const n = ev.tournaments.length;
    const tours = ev.tournaments.map((t) => `<li>${esc(R.tournamentLabel(t))}</li>`).join('');
    return `<article class="ev-row${closed ? ' closed' : ''}">
      ${dateBadge(ev)}
      <div class="ev-main">
        <h3><a href="${closed ? listUrl(ev) : formUrl(ev)}">${esc(ev.name)}</a></h3>
        <p class="ev-meta">${esc(R.formatRange(ev.dateFrom, ev.dateTo))}${ev.place ? ' · ' + esc(ev.place) : ''}
          ${dl ? ` · <span class="${dl.soon ? 'ev-soon' : ''}">${esc(dl.text)}</span>` : ''}</p>
        ${n ? `<details class="ev-tours"><summary>${R.plural(n, 'turnaj', 'turnaje', 'turnajů')}${n <= 3 ? ': ' + esc(ev.tournaments.map((t) => t.short || t.name).join(', ')) : ''}</summary>
          <ul>${tours}</ul></details>` : ''}
      </div>
      <div class="ev-actions">
        ${closed ? '<span class="badge muted-badge">přihlašování uzavřeno</span>'
          : `<a class="button primary small-btn" href="${formUrl(ev)}">Přihlásit se</a>`}
        <span class="ev-links">
          <a href="${listUrl(ev)}">Přihlášení</a>
          ${ev.infoUrl ? `<a href="${esc(ev.infoUrl)}" target="_blank" rel="noopener">Propozice</a>` : ''}
          ${ev.dateFrom ? `<button type="button" class="link" data-ics="${esc(ev.slug)}" title="Stáhnout událost do kalendáře (Google, Outlook, telefon)">Do kalendáře</button>` : ''}
        </span>
      </div>
    </article>`;
  }

  function renderList(events) {
    const open = events.filter((e) => !R.isClosed(e));
    const closed = events.filter((e) => R.isClosed(e));
    const byMonth = (list) => {
      let last = null;
      return list.map((ev) => {
        const d = parse(ev.dateFrom);
        const key = d ? monthKey(d) : -1;
        const head = key !== last ? `<h2 class="month-title">${d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : 'bez termínu'}</h2>` : '';
        last = key;
        return head + row(ev);
      }).join('');
    };
    return (open.length ? byMonth(open) : '<p class="muted">Žádná akce s otevřeným přihlašováním tomu neodpovídá.</p>') +
      (closed.length ? `<details class="closed-list"${open.length ? '' : ' open'}><summary>Uzavřené přihlašování (${closed.length})</summary>${byMonth(closed)}</details>` : '');
  }

  // ---------- kalendář ----------

  function renderCalendar(events) {
    const first = parse((events.find((e) => !R.isClosed(e)) || events[0] || {}).dateFrom) || today();
    if (state.month == null) state.month = monthKey(first);
    const y = Math.floor(state.month / 12);
    const m = state.month % 12;
    const start = new Date(y, m, 1);
    const gridStart = new Date(y, m, 1 - ((start.getDay() + 6) % 7));
    const byDay = {};
    events.forEach((ev) => {
      const from = parse(ev.dateFrom);
      if (!from) return;
      const to = parse(ev.dateTo) || from;
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) (byDay[iso(d)] = byDay[iso(d)] || []).push(ev);
    });
    const now = iso(today());
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      if (i === 35 && d.getMonth() !== m) break; // šestý týden jen když je potřeba
      const list = byDay[iso(d)] || [];
      cells.push(`<div class="cal-cell${d.getMonth() !== m ? ' other' : ''}${iso(d) === now ? ' today' : ''}${list.length ? ' has' : ''}${list.length === 1 ? ' single' : ''}">
        <span class="cal-num">${d.getDate()}</span>
        ${list.map((ev) => `<a class="cal-ev${R.isClosed(ev) ? ' closed' : ''}" href="${R.isClosed(ev) ? listUrl(ev) : formUrl(ev)}" title="${esc(ev.name)}">${esc(ev.name)}</a>`).join('')}
      </div>`);
    }
    const inMonth = events.filter((ev) => {
      const from = parse(ev.dateFrom);
      const to = parse(ev.dateTo) || from;
      return from && monthKey(from) <= state.month && monthKey(to) >= state.month;
    });
    return `<div class="card cal">
        <div class="cal-head">
          <button type="button" class="button small-btn" data-cal="-1" aria-label="Předchozí měsíc">‹</button>
          <h2>${MONTHS[m]} ${y}</h2>
          <button type="button" class="button small-btn" data-cal="1" aria-label="Další měsíc">›</button>
        </div>
        <div class="cal-grid">${WEEKDAYS.map((w) => `<div class="cal-wd">${w}</div>`).join('')}${cells.join('')}</div>
      </div>
      ${inMonth.length ? inMonth.map(row).join('') : '<p class="muted">V tomto měsíci není žádná akce.</p>'}`;
  }

  // ---------- vykreslení ----------

  function render() {
    const events = state.events.filter((ev) => matches(ev, state.q));
    $('#loader').hidden = true;
    $('#footer').hidden = false;
    if (!state.events.length) {
      $('#status').textContent = 'Momentálně není otevřené přihlašování na žádnou akci.';
      $('#status').hidden = false;
      $('#toolbar').hidden = true;
      $('#events').innerHTML = '';
      return;
    }
    $('#status').hidden = true;
    $('#toolbar').hidden = false;
    $('#search-wrap').hidden = state.events.length < SEARCH_FROM;
    document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
    $('#events').innerHTML = state.view === 'calendar' ? renderCalendar(events) : renderList(events);
  }

  function setEvents(events) {
    state.events = events.slice().sort((a, b) => String(a.dateFrom || '9999').localeCompare(String(b.dateFrom || '9999')));
    render();
  }

  $('#events').addEventListener('click', (e) => {
    const ics = e.target.closest('[data-ics]');
    if (ics) downloadIcs(state.events.find((ev) => ev.slug === ics.dataset.ics));
    const nav = e.target.closest('[data-cal]');
    if (nav) { state.month += +nav.dataset.cal; render(); }
  });
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    state.view = b.dataset.view;
    store.set('homeView', state.view);
    render();
  }));
  $('#search').addEventListener('input', (e) => { state.q = e.target.value; state.month = null; render(); });

  // listinu hráčů (0,5 MB) stáhneme na pozadí, aby byl formulář po kliknutí hned připravený
  function prefetchPlayers() {
    const go = () => fetch('data/players.json').catch(() => {});
    if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 3000 });
    else setTimeout(go, 1500);
  }

  async function init() {
    state.view = store.get('homeView') === 'calendar' ? 'calendar' : 'list';
    prefetchPlayers();
    const cached = window.Api.cacheRead('events', 7 * DAY);
    if (cached) setEvents(cached);
    try {
      const cfg = await window.Api.loadConfig();
      if (cfg.siteName) { $('#site-name').textContent = cfg.siteName; document.title = cfg.siteName; }
      const data = await window.Api.get('events');
      const events = data.events || [];
      window.Api.cacheWrite('events', events);
      events.forEach((ev) => window.Api.cacheWrite('event:' + ev.slug, ev));
      setEvents(events);
    } catch (e) {
      if (!cached) {
        $('#loader').hidden = true;
        $('#status').textContent = e.message;
        $('#status').hidden = false;
        $('#footer').hidden = false;
      }
    }
  }

  // pro testy
  window.Home = { icsFor };
  init();
})();
