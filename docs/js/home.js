/* Úvodní stránka: přehled akcí s otevřeným (nebo nedávno uzavřeným) přihlašováním.
 * Akce se ukážou hned z poslední uložené kopie a na pozadí se načtou aktuální. */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esc = window.escapeHtml;
  const R = window.Rules;
  const DAY = 864e5;

  function card(ev) {
    const closed = R.isClosed(ev);
    const when = R.formatRange(ev.dateFrom, ev.dateTo);
    const tours = ev.tournaments.map((t) => `<li>${esc(R.tournamentLabel(t))}</li>`).join('');
    return `<article class="card event-card">
      <h2>${esc(ev.name)}</h2>
      <p class="muted">${esc([when, ev.place].filter(Boolean).join(' · '))}</p>
      ${ev.deadline ? `<p class="small">Přihlášky do ${esc(R.formatDate(ev.deadline))}</p>` : ''}
      <ul class="small">${tours}</ul>
      <p class="actions">
        ${closed ? '<span class="badge muted-badge">přihlašování uzavřeno</span>'
          : `<a class="button primary" href="prihlaska.html?akce=${encodeURIComponent(ev.slug)}">Přihlásit se</a>`}
        <a class="button" href="seznam.html?akce=${encodeURIComponent(ev.slug)}">Seznam přihlášených</a>
        ${ev.infoUrl ? `<a href="${esc(ev.infoUrl)}" target="_blank" rel="noopener">Propozice</a>` : ''}
      </p>
    </article>`;
  }

  function render(events) {
    const open = events.filter((e) => !R.isClosed(e));
    const closed = events.filter((e) => R.isClosed(e));
    $('#loader').hidden = true;
    $('#footer').hidden = false;
    if (!events.length) {
      $('#status').textContent = 'Momentálně není otevřené přihlašování na žádnou akci.';
      $('#status').hidden = false;
      $('#events').innerHTML = '';
      return;
    }
    $('#status').hidden = true;
    $('#events').innerHTML = open.map(card).join('') +
      (closed.length ? '<h2 class="section-title">Uzavřené přihlašování</h2>' + closed.map(card).join('') : '');
  }

  async function init() {
    const cached = window.Api.cacheRead('events', 7 * DAY);
    if (cached) render(cached);
    try {
      const cfg = await window.Api.loadConfig();
      if (cfg.siteName) { $('#site-name').textContent = cfg.siteName; document.title = cfg.siteName; }
      const data = await window.Api.get('events');
      const events = data.events || [];
      window.Api.cacheWrite('events', events);
      events.forEach((ev) => window.Api.cacheWrite('event:' + ev.slug, ev));
      render(events);
    } catch (e) {
      if (!cached) {
        $('#loader').hidden = true;
        $('#status').textContent = e.message;
        $('#status').hidden = false;
        $('#footer').hidden = false;
      }
    }
  }

  init();
})();
