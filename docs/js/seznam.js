/* Veřejný seznam přihlášených (data z Apps Scriptu, akce list). */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const esc = window.escapeHtml;

  function playerRow(p, i) {
    return `<tr>
      <td class="num">${i + 1}.</td>
      <td>${esc(p.name)}${p.title ? ` <span class="badge">${esc(p.title)}</span>` : ''}</td>
      <td class="num">${esc(p.year || '')}</td>
      <td>${esc(p.club)}</td>
      <td class="num">${p.rn || ''}</td>
      <td class="num">${p.rf || ''}</td>
    </tr>`;
  }

  const head = '<thead><tr><th></th><th>Jméno</th><th>Ročník</th><th>Klub</th><th>ELO ČR</th><th>FIDE</th></tr></thead>';

  function render(cfg, data) {
    const out = [];
    const toc = [];
    cfg.tournaments.forEach((t) => {
      const title = (t.day ? t.day + ' – ' : '') + t.name;
      const anchor = 't-' + t.code;
      if (t.type === 'team') {
        const teams = (data.teams && data.teams[t.code]) || [];
        toc.push(`<a href="#${esc(anchor)}">${esc(t.short || t.name)} (${teams.length})</a>`);
        out.push(`<section class="card" id="${esc(anchor)}"><h2>${esc(title)}</h2>
          <p class="muted">Přihlášených družstev: ${teams.length}${t.capacity ? ' / ' + t.capacity : ''}</p>
          ${teams.map((tm) => `<h3>${esc(tm.team)} <span class="muted small">kapitán: ${esc(tm.captain)}</span></h3>
            <div class="table-wrap"><table>${head}<tbody>${tm.players.map(playerRow).join('')}</tbody></table></div>`).join('')}
        </section>`);
      } else {
        const players = (data.tournaments && data.tournaments[t.code]) || [];
        toc.push(`<a href="#${esc(anchor)}">${esc(t.short || t.name)} (${players.length})</a>`);
        out.push(`<section class="card" id="${esc(anchor)}"><h2>${esc(title)}</h2>
          <p class="muted">Přihlášených hráčů: ${players.length}${t.capacity ? ' / ' + t.capacity : ''}</p>
          ${players.length ? `<div class="table-wrap"><table>${head}<tbody>${players.map(playerRow).join('')}</tbody></table></div>` : ''}
        </section>`);
      }
    });
    $('#toc').innerHTML = toc.join('');
    $('#toc').hidden = false;
    $('#lists').innerHTML = out.join('');
    $('#status').textContent = data.updated
      ? 'Stav k ' + new Date(data.updated).toLocaleString('cs-CZ') + '. Seřazeno podle ratingu.'
      : '';
  }

  async function init() {
    let cfg;
    try {
      cfg = await (await fetch('config.json', { cache: 'no-cache' })).json();
    } catch (e) {
      $('#status').textContent = 'Nepodařilo se načíst nastavení (config.json).';
      return;
    }
    if (cfg.festival && cfg.festival.name) {
      $('#festival-name').textContent = 'Přihlášení – ' + cfg.festival.name;
      document.title = 'Přihlášení – ' + cfg.festival.name;
    }
    if (cfg.publicList === false) { $('#status').textContent = 'Seznam přihlášených není veřejný.'; return; }
    if (!cfg.appsScriptUrl) { $('#status').textContent = 'Seznam zatím není k dispozici.'; return; }
    try {
      const data = await (await fetch(cfg.appsScriptUrl + '?action=list')).json();
      if (!data.ok) throw new Error(data.error);
      render(cfg, data);
    } catch (e) {
      $('#status').textContent = 'Seznam se nepodařilo načíst' + (e && e.message ? ': ' + e.message : '.');
    }
  }

  init();
})();
