/* Veřejný seznam přihlášených – seznam.html?akce=<adresa akce>. */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const esc = window.escapeHtml;
  const R = window.Rules;

  function playerRow(p, i) {
    return `<tr>
      <td class="num">${i + 1}.</td>
      <td>${esc(p.name)}${p.title ? ` <span class="badge">${esc(p.title)}</span>` : ''}${p.category ? ` <span class="badge muted-badge" title="${esc(R.categoryLabel(p.category))}">kat. ${esc(p.category)}</span>` : ''}</td>
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
    $('#privacy-link').href = 'ochrana-udaju.html?akce=' + encodeURIComponent(ev.slug);
    const formLink = $('#form-link');
    if (R.isClosed(ev)) formLink.hidden = true;
    else formLink.href = 'prihlaska.html?akce=' + encodeURIComponent(ev.slug);

    const out = [];
    const toc = [];
    // klubový kalendář: jen turnaje, kam se přes klub přihlašuje, nebo kde už někdo je; podle data
    const count = (t) => (t.type === 'team' ? (data.teams[t.id] || []).length : (data.tournaments[t.id] || []).length);
    const tours = ev.kind === 'club'
      ? R.byDate(ev.tournaments.filter((t) => count(t) || ((t.signup || 'open') === 'open' && !R.tournamentPast(t))))
      : ev.tournaments;
    if (ev.kind === 'club' && !$('#calendar-link')) {
      const cal = $('#form-link');
      cal.insertAdjacentHTML('afterend', ` <a id="calendar-link" href="kalendar.html?akce=${encodeURIComponent(ev.slug)}">Termínový kalendář klubu</a>`);
    }
    tours.forEach((t) => {
      const anchor = 't-' + t.id;
      const cap = t.capacity ? ' / ' + t.capacity : '';
      if (t.type === 'team') {
        const teams = data.teams[t.id] || [];
        toc.push(`<a href="#${esc(anchor)}">${esc(t.short || t.name)} (${teams.length})</a>`);
        out.push(`<section class="card" id="${esc(anchor)}"><h2>${esc(R.tournamentLabel(t))}</h2>
          <p class="muted">Přihlášených družstev: ${teams.length}${cap}</p>
          ${teams.map((tm) => `<h3>${esc(tm.team)} <span class="muted small">kapitán: ${esc(tm.captain)}</span></h3>
            ${tm.players.length ? `<div class="table-wrap"><table>${head}<tbody>${tm.players.map(playerRow).join('')}</tbody></table></div>`
              : '<p class="muted small">Soupiska bude doplněna.</p>'}`).join('')}
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
    if (tours.length > 1) {
      $('#toc').innerHTML = toc.join('');
      $('#toc').hidden = false;
    }
    $('#lists').innerHTML = out.join('');
    $('#status').textContent = 'Stav k ' + new Date(data.updated).toLocaleString('cs-CZ') + '. Seřazeno podle ratingu.';
  }

  async function init() {
    const slug = window.Api.param('akce');
    if (!slug) { location.replace('./'); return; }
    // poslední známý seznam hned, aktuální po načtení
    const cached = window.Api.cacheRead('list:' + slug, 7 * 864e5);
    if (cached) {
      render(cached);
      document.getElementById('loading').hidden = true;
      $('#status').textContent += ' Aktualizuji…';
    }
    try {
      const data = await window.Api.get('list', { slug });
      window.Api.cacheWrite('list:' + slug, data);
      render(data);
      document.getElementById('loading').hidden = true;
    } catch (e) {
      document.getElementById('loading').hidden = true;
      if (!cached) $('#status').textContent = 'Seznam se nepodařilo načíst: ' + e.message;
    }
  }

  init();
})();
