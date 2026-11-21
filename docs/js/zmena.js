/* Změna přihlášky přes odkaz z potvrzovacího e-mailu – zmena.html?t=<token>.
 * Jednotlivci: odhlášení z turnajů, vrácení odhlášky. Družstva: úprava soupisky, odhlášení/vrácení družstva.
 * Obojí: změna doplňujících údajů (ubytování, obědy…).
 * S parametrem admin=1 a přihlášením v administraci upravuje pořadatel bez časového omezení. */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = window.escapeHtml;
  const R = window.Rules;
  const token = window.Api.param('t') || '';
  const form = $('#form');
  let data = null;
  let rosters = []; // { key, roster, initial }
  let db = null;
  let dbPromise = null;

  function adminToken() {
    if (window.Api.param('admin') !== '1') return null;
    try { return localStorage.getItem('adminIdToken'); } catch (e) { return null; }
  }

  function publicApi(action, body) {
    if (action === 'application') return window.Api.get('application', { token });
    return window.Api.post(action, Object.assign({ token }, body || {}));
  }

  async function api(action, body) {
    const idToken = adminToken();
    if (!idToken) return publicApi(action, body);
    try {
      return await window.Api.post('admin.' + action, Object.assign({ idToken, token }, body || {}));
    } catch (err) {
      // vypršelé přihlášení pořadatele → stránka funguje jako pro hráče
      if (err.code === 'auth' || err.code === 'forbidden') {
        try { localStorage.removeItem('adminIdToken'); } catch (e) { /* nic */ }
        return publicApi(action, body);
      }
      throw err;
    }
  }

  function loadDb() {
    if (!dbPromise) {
      dbPromise = fetch('data/players.json').then((r) => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      }).then((json) => { db = new window.Players.PlayerDB(json); return db; });
    }
    return dbPromise;
  }

  function showNotice(text) {
    const n = $('#notice');
    n.textContent = text;
    n.hidden = false;
  }

  function renderTeams(app, editable) {
    $('#entries-hint').textContent = editable
      ? 'Soupisku upravíte šipkami (pořadí = šachovnice), hráče přidáte našeptávačem. Změny se uloží až tlačítkem dole.'
      : '';
    rosters = [];
    const box = $('#entries');
    box.innerHTML = app.teams.map((g, i) => `
      <div class="team-block" data-i="${i}">
        <h3>${esc(g.name)} <span class="muted small">${esc(g.tournament)} · kapitán ${esc(g.captain)} · ${esc(R.teamSize(g))}</span></h3>
        ${g.cancelled
          ? `<p><span class="badge danger-badge">družstvo je odhlášené</span></p>
             ${editable && data.canRestore ? `<label class="check"><input type="checkbox" data-restore-team="${esc(g.key)}"> vrátit přihlášku družstva</label>` : ''}`
          : editable
            ? `<div class="roster-box"></div>
               <label class="check danger-check"><input type="checkbox" data-cancel-team="${esc(g.key)}"> odhlásit celé družstvo</label>`
            : (g.players.length
              ? `<ol class="entry-list">${g.players.map((p) => `<li>${esc(p.surname)} ${esc(p.firstName)} <span class="muted small">${esc(p.year || '')}</span></li>`).join('')}</ol>`
              : '<p class="muted">Soupiska zatím není.</p>')}
      </div>`).join('');
    if (!editable) return;
    app.teams.forEach((g, i) => {
      if (g.cancelled) return;
      const el = $(`.team-block[data-i="${i}"] .roster-box`, box);
      const tour = data.event.tournaments.find((t) => t.id === g.tournamentId);
      const roster = window.createRoster(el, {
        boards: g.boards, reserves: g.reserves, tournament: data.admin ? null : tour, event: data.event,
        moveTargets: () => rosters.filter((r) => r.key !== g.key && r.tournamentId === g.tournamentId).map((r) => ({ id: r.key, label: r.name })),
        onMove: (p, key) => {
          const target = rosters.find((r) => r.key === key);
          if (!target || !target.roster.add(p)) roster.add(p);
        },
      });
      roster.setPlayers(g.players);
      rosters.push({ key: g.key, name: g.name, tournamentId: g.tournamentId, roster, initial: roster.keys().join(',') });
      if (db) roster.setDB(db);
    });
    loadDb().then((d) => rosters.forEach((r) => r.roster.setDB(d)))
      .catch(() => rosters.forEach((r) => r.roster.setUnavailable()));
  }

  function renderIndividual(app, editable) {
    $('#entries-hint').hidden = !editable;
    const byPlayer = {};
    app.entries.forEach((e) => { (byPlayer[e.name] = byPlayer[e.name] || []).push(e); });
    $('#entries').innerHTML = Object.keys(byPlayer).map((name) => {
      const list = byPlayer[name];
      return `<div class="entry-player">
        <div class="entry-name"><strong>${esc(name)}</strong> <span class="muted small">${esc([list[0].year, list[0].club].filter(Boolean).join(' · '))}</span></div>
        ${list.map((e) => e.cancelled
          ? `<div class="entry-row cancelled-row"><span>${esc(e.tournament)}</span> <span class="badge danger-badge">odhlášeno</span>
              ${editable && data.canRestore ? `<label class="check"><input type="checkbox" data-restore="${esc(e.id)}"> vrátit</label>` : ''}</div>`
          : `<div class="entry-row"><span>${esc(e.tournament)}${e.fee != null ? ` <span class="price">${esc(R.formatMoney(e.fee))}</span>` : ''}</span>
              ${editable ? `<label class="check danger-check"><input type="checkbox" data-cancel="${esc(e.id)}"> odhlásit</label>` : '<span class="badge">přihlášen</span>'}</div>`).join('')}
      </div>`;
    }).join('') + (editable && app.entries.filter((e) => !e.cancelled).length > 1
      ? '<p><button type="button" class="link danger" id="cancel-all">Označit všechny k odhlášení</button></p>' : '');
    const all = $('#cancel-all');
    if (all) all.addEventListener('click', () => $$('[data-cancel]').forEach((i) => { i.checked = true; }));
  }

  function render() {
    const ev = data.event;
    const app = data.application;
    document.title = 'Změna přihlášky – ' + ev.name;
    $('#event-name').textContent = ev.name;
    $('#event-meta').textContent = [R.formatRange(ev.dateFrom, ev.dateTo), ev.place].filter(Boolean).join(' · ');
    $('#app-meta').textContent = `Přihláška č. ${app.id} · ${app.email}` + (data.admin ? ' · úprava pořadatelem' : '');
    $('#list-link').href = 'seznam.html?akce=' + encodeURIComponent(ev.slug);

    const editable = data.canEdit;
    if (!editable) {
      showNotice('Změny už nejde provést online.' + (ev.contactEmail ? ` Kontaktujte prosím pořadatele: ${ev.contactEmail}.` : ' Kontaktujte prosím pořadatele.'));
    } else {
      $('#notice').hidden = true;
    }
    $('#entries-title').textContent = app.mode === 'team' ? (app.teams.length > 1 ? 'Družstva a soupisky' : 'Družstvo a soupiska') : 'Přihlášení hráči';
    if (app.mode === 'team') renderTeams(app, editable);
    else renderIndividual(app, editable);

    const extras = (ev.extras || []).filter((x) => (x.modes || ['individual', 'team']).includes(app.mode));
    $('#extras-card').hidden = !extras.length;
    $('#extras').innerHTML = extras.map((x) => window.Extras.field(x, app.extras[x.id])).join('');
    window.Extras.bindTotal(form, () => extras, $('#extras-total'), feesTotal);
    if (!editable) $$('#extras input, #extras select, #extras textarea').forEach((el) => { el.disabled = true; });

    $('#submit').hidden = !editable;
    form.hidden = false;
  }

  /** Startovné po zamýšlených změnách (bez odhlašovaných, s vracenými). */
  function feesTotal() {
    const app = data.application;
    if (app.mode === 'team') {
      return app.teams.reduce((sum, g) => {
        const active = g.cancelled ? !!$(`[data-restore-team="${CSS.escape(g.key)}"]:checked`) : !$(`[data-cancel-team="${CSS.escape(g.key)}"]:checked`);
        return sum + (active && g.fee ? g.fee : 0);
      }, 0);
    }
    return app.entries.reduce((sum, e) => {
      const active = e.cancelled ? !!$(`[data-restore="${CSS.escape(e.id)}"]:checked`) : !$(`[data-cancel="${CSS.escape(e.id)}"]:checked`);
      return sum + (active && e.fee ? e.fee : 0);
    }, 0);
  }

  function collect() {
    const app = data.application;
    const changes = { extras: {} };
    if (app.mode === 'team') {
      changes.cancelTeams = $$('[data-cancel-team]:checked').map((i) => i.dataset.cancelTeam);
      changes.restoreTeams = $$('[data-restore-team]:checked').map((i) => i.dataset.restoreTeam);
      changes.rosters = rosters
        .filter((r) => !changes.cancelTeams.includes(r.key) && r.roster.keys().join(',') !== r.initial)
        .map((r) => ({ key: r.key, players: r.roster.getPlayers() }));
    } else {
      changes.cancel = $$('[data-cancel]:checked').map((i) => i.dataset.cancel);
      changes.restore = $$('[data-restore]:checked').map((i) => i.dataset.restore);
    }
    changes.extras = window.Extras.read(form, (data.event.extras || []).filter((x) => (x.modes || ['individual', 'team']).includes(app.mode)));
    return changes;
  }

  async function onSubmit(e) {
    e.preventDefault();
    $('#errors').hidden = true;
    const changes = collect();
    const app = data.application;
    const toCancel = app.mode === 'team'
      ? app.teams.filter((g) => (changes.cancelTeams || []).includes(g.key)).map((g) => `družstvo ${g.name}`)
      : app.entries.filter((x) => (changes.cancel || []).includes(x.id)).map((x) => `${x.name} – ${x.tournament}`);
    if (toCancel.length && !confirm('Opravdu odhlásit?\n\n' + toCancel.join('\n'))) return;
    const btn = $('#submit');
    btn.disabled = true;
    btn.textContent = 'Ukládám…';
    try {
      data = await api('updateApplication', { changes });
      const saved = $('#saved');
      saved.innerHTML = `<strong>Změny jsou uložené ✓</strong><ul>${(data.saved || []).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        ${data.admin ? '' : `<p class="small muted">Potvrzení jsme poslali na ${esc(data.application.email)}.</p>`}`;
      saved.hidden = false;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      $('#errors').textContent = err.message;
      $('#errors').hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Uložit změny';
    }
  }

  async function init() {
    if (!token) {
      $('#loading').hidden = true;
      showNotice('Chybí odkaz na přihlášku. Použijte odkaz z potvrzovacího e-mailu.');
      return;
    }
    try {
      data = await api('application');
    } catch (err) {
      $('#loading').hidden = true;
      showNotice(err.message);
      return;
    }
    $('#loading').hidden = true;
    form.addEventListener('submit', onSubmit);
    render();
  }

  init();
})();
