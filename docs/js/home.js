/* Úvodní stránka: přehled akcí s otevřeným (nebo nedávno uzavřeným) přihlašováním. */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esc = window.escapeHtml;
  const R = window.Rules;

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

  async function init() {
    try {
      const cfg = await window.Api.loadConfig();
      if (cfg.siteName) { $('#site-name').textContent = cfg.siteName; document.title = cfg.siteName; }
      const data = await window.Api.get('events');
      const events = data.events || [];
      const open = events.filter((e) => !R.isClosed(e));
      const closed = events.filter((e) => R.isClosed(e));
      if (!events.length) { $('#status').textContent = 'Momentálně není otevřené přihlašování na žádnou akci.'; return; }
      $('#status').hidden = true;
      $('#events').innerHTML = open.map(card).join('') +
        (closed.length ? '<h2 class="section-title">Uzavřené přihlašování</h2>' + closed.map(card).join('') : '');
    } catch (e) {
      $('#status').textContent = e.message;
    }
  }

  init();
})();
