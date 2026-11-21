/* Veřejný seznam přihlášených – seznam.html?akce=<adresa akce>. */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const esc = window.escapeHtml;
  const R = window.Rules;

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

  function render(data) {
    const ev = data.event;
    document.title = 'Přihlášení – ' + ev.name;
    $('#event-name').textContent = ev.name;
    const formLink = $('#form-link');
    if (R.isClosed(ev)) formLink.hidden = true;
    else formLink.href = 'prihlaska.html?akce=' + encodeURIComponent(ev.slug);

    const out = [];
    const toc = [];
    ev.tournaments.forEach((t) => {
      const anchor = 't-' + t.id;
      const cap = t.capacity ? ' / ' + t.capacity : '';
      if (t.type === 'team') {
        const teams = data.teams[t.id] || [];
        toc.push(`<a href="#${esc(anchor)}">${esc(t.short || t.name)} (${teams.length})</a>`);
        out.push(`<section class="card" id="${esc(anchor)}"><h2>${esc(R.tournamentLabel(t))}</h2>
          <p class="muted">Přihlášených družstev: ${teams.length}${cap}</p>
          ${teams.map((tm) => `<h3>${esc(tm.team)} <span class="muted small">kapitán: ${esc(tm.captain)}</span></h3>
            <div class="table-wrap"><table>${head}<tbody>${tm.players.map(playerRow).join('')}</tbody></table></div>`).join('')}
        </section>`);
      } else {
        const players = data.tournaments[t.id] || [];
        toc.push(`<a href="#${esc(anchor)}">${esc(t.short || t.name)} (${players.length})</a>`);
        out.push(`<section class="card" id="${esc(anchor)}"><h2>${esc(R.tournamentLabel(t))}</h2>
          <p class="muted">Přihlášených hráčů: ${players.length}${cap}</p>
          ${players.length ? `<div class="table-wrap"><table>${head}<tbody>${players.map(playerRow).join('')}</tbody></table></div>` : ''}
        </section>`);
      }
    });
    if (ev.tournaments.length > 1) {
      $('#toc').innerHTML = toc.join('');
      $('#toc').hidden = false;
    }
    $('#lists').innerHTML = out.join('');
    $('#status').textContent = 'Stav k ' + new Date(data.updated).toLocaleString('cs-CZ') + '. Seřazeno podle ratingu.';
  }

  async function init() {
    const slug = window.Api.param('akce');
    if (!slug) { location.replace('./'); return; }
    try {
      render(await window.Api.get('list', { slug }));
    } catch (e) {
      $('#status').textContent = 'Seznam se nepodařilo načíst: ' + e.message;
    }
  }

  init();
})();
