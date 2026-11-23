/* Termínový kalendář klubu (akce druhu „klubová sekce“): všechny soutěže sezóny po měsících nebo v mřížce.
 * U turnajů s otevřeným přihlašováním přes klub je tlačítko Přihlásit se (formulář s předvybraným turnajem),
 * u ostatních stav: výpravu nepořádáme, dlouhodobá soutěž, proběhlo, uzavřeno. */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esc = window.escapeHtml;
  const R = window.Rules;
  const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
  const MONTHS_SHORT = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'];
  const WEEKDAYS = ['po', 'út', 'st', 'čt', 'pá', 'so', 'ne'];
  const slug = new URLSearchParams(location.search).get('akce');
  const state = { ev: null, view: 'list', filter: 'all', past: false, q: '', month: null };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* nic */ } },
  };
  const parse = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const monthKey = (d) => d.getFullYear() * 12 + d.getMonth();
  const formUrl = (t) => `prihlaska.html?akce=${encodeURIComponent(slug)}&turnaj=${encodeURIComponent(t.id)}`;

  function items() {
    const q = R.norm(state.q);
    return R.byDate(state.ev.tournaments).filter((t) => {
      const st = R.signupState(t);
      if (!state.past && st.key === 'past' && state.filter !== 'open') return false;
      if (state.filter === 'open' && st.key !== 'open') return false;
      if (state.filter === 'tournaments' && t.signup === 'league') return false;
      if (q && !R.norm([t.name, t.short, t.place, t.note].join(' ')).split(/\s+/).join(' ').includes(q)) return false;
      return true;
    });
  }

  function badge(t) {
    const st = R.signupState(t);
    const cls = { open: 'status-otevreno', closed: 'status-koncept', none: '', league: 'status-league', past: '' }[st.key];
    return `<span class="status ${cls}">${esc(st.text)}</span>`;
  }

  function dateBadge(t) {
    const from = parse(t.dateFrom);
    if (!from) return '<div class="ev-date"><span class="ev-day">?</span></div>';
    const to = parse(t.dateTo) || from;
    const day = +to === +from ? from.getDate() : from.getMonth() === to.getMonth() ? `${from.getDate()}–${to.getDate()}` : `${from.getDate()}.`;
    const wd = WEEKDAYS[(from.getDay() + 6) % 7] + (+to !== +from ? '–' + WEEKDAYS[(to.getDay() + 6) % 7] : '');
    return `<div class="ev-date" aria-hidden="true"><span class="ev-month">${MONTHS_SHORT[from.getMonth()]}</span>
      <span class="ev-day${String(day).length > 3 ? ' long' : ''}">${day}</span><span class="ev-wd">${wd}</span></div>`;
  }

  function row(t) {
    const st = R.signupState(t);
    const meta = [R.formatRange(t.dateFrom, t.dateTo), t.place, t.note].filter(Boolean).map(esc).join(' · ');
    return `<article class="ev-row cal-item state-${st.key}">
      ${dateBadge(t)}
      <div class="ev-main">
        <h3>${st.key === 'open' ? `<a href="${formUrl(t)}">${esc(t.name)}</a>` : esc(t.name)}</h3>
        <p class="ev-meta">${meta}</p>
        ${R.ruleText(t) ? `<p class="ev-meta">${esc(R.ruleText(t))}</p>` : ''}
      </div>
      <div class="ev-actions">
        ${st.key === 'open' ? `<a class="button primary small-btn" href="${formUrl(t)}">Přihlásit se</a>` : ''}
        ${badge(t)}
        ${t.infoUrl ? `<span class="ev-links"><a href="${esc(t.infoUrl)}" target="_blank" rel="noopener">Propozice</a></span>` : ''}
      </div>
    </article>`;
  }

  function renderList(list) {
    if (!list.length) return '<p class="muted">Filtru neodpovídá žádná soutěž.</p>';
    let last = null;
    return list.map((t) => {
      const d = parse(t.dateFrom);
      const key = d ? monthKey(d) : -1;
      const head = key !== last ? `<h2 class="month-title">${d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : 'bez termínu'}</h2>` : '';
      last = key;
      return head + row(t);
    }).join('');
  }

  function renderCalendar(list) {
    if (state.month == null) {
      const now = new Date();
      const next = list.find((t) => parse(t.dateTo || t.dateFrom) >= new Date(now.getFullYear(), now.getMonth(), now.getDate()));
      state.month = monthKey(parse((next || list[0] || {}).dateFrom) || now);
    }
    const y = Math.floor(state.month / 12);
    const m = state.month % 12;
    const start = new Date(y, m, 1);
    const gridStart = new Date(y, m, 1 - ((start.getDay() + 6) % 7));
    const byDay = {};
    list.forEach((t) => {
      const from = parse(t.dateFrom);
      if (!from) return;
      const to = parse(t.dateTo) || from;
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) (byDay[iso(d)] = byDay[iso(d)] || []).push(t);
    });
    const today = iso(new Date());
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      if (i === 35 && d.getMonth() !== m) break;
      const its = byDay[iso(d)] || [];
      cells.push(`<div class="cal-cell${d.getMonth() !== m ? ' other' : ''}${iso(d) === today ? ' today' : ''}${its.length === 1 ? ' single' : ''}">
        <span class="cal-num">${d.getDate()}</span>
        ${its.map((t) => {
          const st = R.signupState(t).key;
          const inner = esc(t.short || t.name);
          return st === 'open'
            ? `<a class="cal-ev" href="${formUrl(t)}" title="${esc(t.name)} – přihlásit se">${inner}</a>`
            : `<span class="cal-ev cal-${st}" title="${esc(t.name)} – ${esc(R.signupState(t).text)}">${inner}</span>`;
        }).join('')}
      </div>`);
    }
    const inMonth = list.filter((t) => {
      const from = parse(t.dateFrom);
      const to = parse(t.dateTo) || from;
      return from && monthKey(from) <= state.month && monthKey(to) >= state.month;
    });
    return `<div class="card cal">
        <div class="cal-head">
          <button type="button" class="button small-btn" data-cal="-1" aria-label="Předchozí měsíc">‹</button>
          <h2>${MONTHS[m]} ${y}</h2>
          <button type="button" class="button small-btn" data-cal="1" aria-label="Další měsíc">›</button>
        </div>
        <div class="cal-grid">${WEEKDAYS.map((w) => `<div class="cal-wd">${w}</div>`).join('')}${cells.join('')}</div>
        <p class="cal-legend small"><span class="cal-ev">přihlašování otevřeno</span> <span class="cal-ev cal-none">výpravu nepořádáme</span>
          <span class="cal-ev cal-league">dlouhodobá soutěž</span></p>
      </div>
      ${inMonth.length ? inMonth.map(row).join('') : '<p class="muted">V tomto měsíci není žádná soutěž.</p>'}`;
  }

  function render() {
    document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
    document.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === state.filter)));
    // v kalendáři se proběhlé ukazují vždy (listuje se po měsících)
    const list = state.view === 'calendar' ? (() => { const p = state.past; state.past = true; const l = items(); state.past = p; return l; })() : items();
    $('#events').innerHTML = state.view === 'calendar' ? renderCalendar(list) : renderList(list);
  }

  function show(ev) {
    state.ev = ev;
    $('#loading').hidden = true;
    document.title = 'Termínový kalendář – ' + ev.name;
    $('#event-name').textContent = ev.name;
    $('#event-intro').textContent = ev.intro || '';
    $('#form-link').href = 'prihlaska.html?akce=' + encodeURIComponent(ev.slug);
    $('#form-link').hidden = R.isClosed(ev) || !ev.tournaments.some((t) => R.signupState(t).key === 'open');
    $('#list-link').href = 'seznam.html?akce=' + encodeURIComponent(ev.slug);
    $('#privacy-link').href = 'ochrana-udaju.html?akce=' + encodeURIComponent(ev.slug);
    $('#toolbar').hidden = false;
    render();
  }

  $('#events').addEventListener('click', (e) => {
    const nav = e.target.closest('[data-cal]');
    if (nav) { state.month += +nav.dataset.cal; render(); }
  });
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    state.view = b.dataset.view; store.set('calView', state.view); render();
  }));
  document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { state.filter = b.dataset.filter; render(); }));
  $('#show-past').addEventListener('change', (e) => { state.past = e.target.checked; render(); });
  $('#search').addEventListener('input', (e) => { state.q = e.target.value; render(); });

  async function init() {
    if (!slug) { location.replace('./'); return; }
    state.view = store.get('calView') === 'calendar' ? 'calendar' : 'list';
    const cached = window.Api.cacheRead('event:' + slug, 7 * 864e5);
    if (cached) show(cached);
    try {
      const data = await window.Api.get('event', { slug });
      window.Api.cacheWrite('event:' + slug, data.event);
      show(data.event);
    } catch (err) {
      if (!cached) {
        $('#loading').hidden = true;
        $('#status').textContent = err.message;
        $('#status').hidden = false;
      }
    }
  }

  init();
})();
