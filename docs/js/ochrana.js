/* Stránka o zpracování osobních údajů: doplní pořadatele akce (?akce=adresa) jako správce údajů. */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esc = window.escapeHtml;
  const R = window.Rules;

  function fill(ev) {
    if (!ev) return;
    $('#event-line').textContent = [ev.name, R.formatRange(ev.dateFrom, ev.dateTo)].filter(Boolean).join(' · ');
    $('#back').href = 'prihlaska.html?akce=' + encodeURIComponent(ev.slug);
    $('#back').textContent = '← Přihláška na akci';
    const o = ev.organizer || {};
    const lines = [
      o.name ? `<strong>${esc(o.name)}</strong>` : '',
      o.address ? esc(o.address) : '',
      o.ico ? 'IČO: ' + esc(o.ico) : '',
      o.email ? `e-mail: <a href="mailto:${esc(o.email)}">${esc(o.email)}</a>` : '',
    ].filter(Boolean);
    if (lines.length) $('#controller').innerHTML = lines.join('<br>');
  }

  async function init() {
    const slug = new URLSearchParams(location.search).get('akce');
    if (!slug) return;
    fill(window.Api.cacheRead('event:' + slug, 30 * 864e5));
    try {
      const data = await window.Api.get('event', { slug });
      window.Api.cacheWrite('event:' + slug, data.event);
      fill(data.event);
    } catch (e) { /* zůstane obecný text */ }
  }

  init();
})();
