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
  const KEEP_PAST_DAYS = 5; // proběhlé akce zůstávají v seznamech ještě 5 dní po skončení
  const recentlyOver = () => new Date(today().getTime() - KEEP_PAST_DAYS * DAY);

  // klub.html (data-kind="club"): přehled klubové sekce – stavy přihlašování, filtry, i dlouhodobé soutěže
  const CLUB = document.body.dataset.kind === 'club';
  const state = { events: [], view: 'list', q: '', month: null, filter: 'all', past: false, group: '' };
  const clubState = (ev) => R.eventState(ev);
  const isOpen = (ev) => (CLUB ? clubState(ev).key === 'open' : !R.isClosed(ev));

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

  function stateBadge(ev) {
    const st = clubState(ev);
    const cls = { open: 'status-otevreno', closed: 'status-koncept', none: '', league: 'status-league', past: '' }[st.key];
    return `<span class="status ${cls}">${esc(st.text)}</span>`;
  }

  function row(ev) {
    const closed = !isOpen(ev);
    const dl = CLUB ? null : deadlineInfo(ev);
    const grp = ev.group ? ` grp-${ev.group}` : '';
    if (CLUB) {
      const st = clubState(ev).key;
      const t = ev.tournaments[0] || {};
      const note = ev.tournaments.map((x) => x.note).filter(Boolean).join(' · ');
      const rule = ev.tournaments.length === 1 ? R.ruleText(t) : '';
      return `<article class="ev-row cal-item state-${st}${grp}">
        ${dateBadge(ev)}
        <div class="ev-main">
          <h3>${st === 'open' ? `<a href="${formUrl(ev)}">${esc(ev.name)}</a>` : esc(ev.name)}</h3>
          <p class="ev-meta">${esc([R.formatRange(ev.dateFrom, ev.dateTo), ev.place].filter(Boolean).join(' · '))}
            ${ev.group ? ` · <span class="grp-label">${esc(R.GROUP_LABELS[ev.group])}</span>` : ''}</p>
          ${note ? `<p class="ev-meta ev-note">${esc(note)}</p>` : ''}
          ${R.categoriesOf(t).length ? `<p class="ev-meta">kategorie: ročník ${esc(R.categoriesOf(t).join(' / '))} a mladší</p>`
            : rule ? `<p class="ev-meta">${esc(rule)}</p>` : ''}
        </div>
        <div class="ev-actions">
          ${st === 'open' ? `<a class="button primary small-btn" href="${formUrl(ev)}">Přihlásit se</a>` : ''}
          ${stateBadge(ev)}
          <span class="ev-links">
            ${st === 'open' || st === 'closed' ? `<a href="${listUrl(ev)}">Přihlášení</a>` : ''}
            ${ev.infoUrl || t.infoUrl ? `<a href="${esc(ev.infoUrl || t.infoUrl)}" target="_blank" rel="noopener">Propozice</a>` : ''}
            ${st !== 'past' && ev.dateFrom ? `<button type="button" class="link" data-ics="${esc(ev.slug)}" title="Stáhnout událost do kalendáře">Do kalendáře</button>` : ''}
          </span>
        </div>
      </article>`;
    }
    const n = ev.tournaments.length;
    const tours = ev.tournaments.map((t) => `<li>${esc(R.tournamentLabel(t))}</li>`).join('');
    return `<article class="ev-row${closed ? ' closed' : ''}${grp}">
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
    const open = CLUB ? events : events.filter((e) => !R.isClosed(e));
    const closed = CLUB ? [] : events.filter((e) => R.isClosed(e));
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
    return (open.length ? byMonth(open) : `<p class="muted">${CLUB ? 'Filtru neodpovídá žádná akce.' : 'Žádná akce s otevřeným přihlašováním tomu neodpovídá.'}</p>`) +
      (closed.length ? `<details class="closed-list"${open.length ? '' : ' open'}><summary>Uzavřené přihlašování (${closed.length})</summary>${byMonth(closed)}</details>` : '');
  }

  // ---------- kalendář ----------

  /** Pruh akce v kalendáři (přes víc dní jeden souvislý pruh). */
  function calBar(ev, col, span, lane, cont) {
    const open = isOpen(ev);
    const cls = `cal-ev${ev.group ? ' grp-' + ev.group : ''}${CLUB ? ' cal-' + clubState(ev).key : open ? '' : ' closed'}` +
      `${cont.left ? ' cont-left' : ''}${cont.right ? ' cont-right' : ''}`;
    const name = CLUB && span === 1 ? (ev.tournaments[0] && ev.tournaments[0].short) || ev.name : ev.name;
    const style = `grid-column:${col + 1} / span ${span};grid-row:${lane + 2}`;
    const title = esc(ev.name) + (CLUB ? ' – ' + esc(clubState(ev).text) : '');
    if (CLUB && !open) return `<span class="${cls}" style="${style}" title="${title}">${esc(name)}</span>`;
    return `<a class="${cls}" style="${style}" href="${open ? formUrl(ev) : listUrl(ev)}" title="${title}">${esc(name)}</a>`;
  }

  function renderCalendar(events) {
    const upcoming = events.find((e) => (parse(e.dateTo) || parse(e.dateFrom) || today()) >= today());
    const first = parse((upcoming || events[0] || {}).dateFrom) || today();
    if (state.month == null) state.month = monthKey(first);
    const y = Math.floor(state.month / 12);
    const m = state.month % 12;
    const start = new Date(y, m, 1);
    const gridStart = new Date(y, m, 1 - ((start.getDay() + 6) % 7));
    const now = iso(today());
    const spans = events.map((ev) => {
      const from = parse(ev.dateFrom);
      return from ? { ev, from, to: parse(ev.dateTo) || from } : null;
    }).filter(Boolean);
    const weeks = [];
    for (let w = 0; w < 6; w++) {
      const wStart = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + w * 7);
      if (w === 5 && wStart.getMonth() !== m) break; // šestý týden jen když je potřeba
      const wEnd = new Date(wStart.getFullYear(), wStart.getMonth(), wStart.getDate() + 6);
      const days = [];
      for (let k = 0; k < 7; k++) {
        const d = new Date(wStart.getFullYear(), wStart.getMonth(), wStart.getDate() + k);
        days.push(`<div class="cal-day${d.getMonth() !== m ? ' other' : ''}${iso(d) === now ? ' today' : ''}${k === 5 ? ' sat' : k === 6 ? ' sun' : ''}"
          style="grid-column:${k + 1}"></div><span class="cal-num${d.getMonth() !== m ? ' other' : ''}" style="grid-column:${k + 1};grid-row:1">${d.getDate()}</span>`);
      }
      // akce v týdnu: delší a dřívější první, každá do prvního volného řádku (lane)
      const inWeek = spans.filter((x) => x.from <= wEnd && x.to >= wStart).map((x) => {
        const a = x.from < wStart ? 0 : Math.round((x.from - wStart) / DAY);
        const b = x.to > wEnd ? 6 : Math.round((x.to - wStart) / DAY);
        return { x, a, b, left: x.from < wStart, right: x.to > wEnd };
      }).sort((p, q) => p.a - q.a || (q.b - q.a) - (p.b - p.a));
      const lanes = [];
      const bars = inWeek.map((it) => {
        let lane = lanes.findIndex((end) => end < it.a);
        if (lane < 0) { lane = lanes.length; lanes.push(-1); }
        lanes[lane] = it.b;
        return calBar(it.x.ev, it.a, it.b - it.a + 1, lane, { left: it.left, right: it.right });
      });
      weeks.push(`<div class="cal-week" style="grid-template-rows:auto repeat(${Math.max(lanes.length, 1)}, auto)">${days.join('')}${bars.join('')}</div>`);
    }
    // seznam pod kalendářem: akce měsíce bez těch, které skončily před víc než 5 dny
    const inMonth = events.filter((ev) => {
      const from = parse(ev.dateFrom);
      const to = parse(ev.dateTo) || from;
      return from && monthKey(from) <= state.month && monthKey(to) >= state.month && to >= recentlyOver();
    });
    return `<div class="card cal">
        <div class="cal-head">
          <button type="button" class="button small-btn" data-cal="-1" aria-label="Předchozí měsíc">‹</button>
          <h2>${MONTHS[m]} ${y}</h2>
          <button type="button" class="button small-btn" data-cal="1" aria-label="Další měsíc">›</button>
        </div>
        <div class="cal-wds">${WEEKDAYS.map((w, k) => `<div class="cal-wd${k === 5 ? ' sat' : k === 6 ? ' sun' : ''}">${w}</div>`).join('')}</div>
        <div class="cal-weeks">${weeks.join('')}</div>
      </div>
      ${inMonth.length ? inMonth.map(row).join('') : '<p class="muted">V tomto měsíci není žádná akce.</p>'}`;
  }

  // ---------- vykreslení ----------

  function filtered() {
    return state.events.filter((ev) => {
      if (!matches(ev, state.q)) return false;
      if (state.group && ev.group !== state.group) return false;
      if (!CLUB) {
        // úvodní stránka: proběhlé akce ještě 5 dní po skončení, pak zmizí ze seznamu
        const over = parse(ev.dateTo) || parse(ev.dateFrom);
        return state.view !== 'list' || !over || over >= recentlyOver();
      }
      const st = clubState(ev).key;
      if (state.filter === 'open' && st !== 'open') return false;
      if (state.filter === 'tournaments' && st === 'league') return false;
      const end = parse(ev.dateTo) || parse(ev.dateFrom);
      if (!state.past && state.view === 'list' && end && end < recentlyOver()) return false;
      return true;
    });
  }

  function renderLegend() {
    const groups = Object.keys(R.GROUP_LABELS).filter((g) => state.events.some((ev) => ev.group === g));
    const box = $('#legend');
    if (!box) return;
    box.hidden = groups.length < 2;
    box.innerHTML = groups.map((g) => `<button type="button" class="legend-chip grp-${g}" data-group="${g}" aria-pressed="${state.group === g}">
      <span class="dot"></span>${esc(R.GROUP_LABELS[g])}</button>`).join('') +
      (state.group ? '<button type="button" class="link" data-group="">zrušit filtr barvy</button>' : '');
  }

  function render() {
    const events = filtered();
    renderLegend();
    document.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === state.filter)));
    $('#loader').hidden = true;
    $('#footer').hidden = false;
    if (!state.events.length) {
      $('#status').textContent = CLUB ? 'Klubová sekce zatím nemá žádné akce.' : 'Momentálně není otevřené přihlašování na žádnou akci.';
      $('#status').hidden = false;
      $('#toolbar').hidden = true;
      $('#events').innerHTML = '';
      return;
    }
    $('#status').hidden = true;
    $('#toolbar').hidden = false;
    $('#search-wrap').hidden = state.events.length < SEARCH_FROM;
    if ($('#past-wrap')) $('#past-wrap').hidden = state.view === 'calendar';
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
    store.set(CLUB ? 'clubView' : 'homeView', state.view);
    render();
  }));
  $('#search').addEventListener('input', (e) => { state.q = e.target.value; state.month = null; render(); });
  document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { state.filter = b.dataset.filter; render(); }));
  if ($('#show-past')) $('#show-past').addEventListener('change', (e) => { state.past = e.target.checked; render(); });
  if ($('#legend')) {
    $('#legend').addEventListener('click', (e) => {
      const b = e.target.closest('[data-group]');
      if (!b) return;
      state.group = state.group === b.dataset.group ? '' : b.dataset.group;
      render();
    });
  }

  // listinu hráčů (0,5 MB) stáhneme na pozadí, aby byl formulář po kliknutí hned připravený
  function prefetchPlayers() {
    const go = () => fetch('data/players.json').catch(() => {});
    if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 3000 });
    else setTimeout(go, 1500);
  }

  async function init() {
    state.view = store.get(CLUB ? 'clubView' : 'homeView') === 'calendar' ? 'calendar' : 'list';
    prefetchPlayers();
    const cacheKey = CLUB ? 'club-events' : 'events';
    const cached = window.Api.cacheRead(cacheKey, 7 * DAY);
    if (cached) setEvents(cached);
    try {
      const cfg = await window.Api.loadConfig();
      if (cfg.siteName && !CLUB) { $('#site-name').textContent = cfg.siteName; document.title = cfg.siteName; }
      const data = await window.Api.get('events', CLUB ? { kind: 'club' } : undefined);
      const events = data.events || [];
      window.Api.cacheWrite(cacheKey, events);
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
