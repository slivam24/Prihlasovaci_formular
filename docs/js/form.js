/* Přihláška na akci – stránka prihlaska.html?akce=<adresa akce>.
 * Jednotlivci: jeden nebo více hráčů (výprava) v jedné přihlášce, každý se svými turnaji.
 * Družstva: kapitán + hráči na šachovnicích. */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = window.escapeHtml;
  const R = window.Rules;

  const form = $('#form');
  const slug = window.Api.param('akce') || '';
  let ev = null;
  let db = null;
  let dbFailed = false;
  let mode = 'individual';
  let cards = []; // hráči v režimu jednotlivců: { el, picker }
  let teamPickers = [];

  const individualTournaments = () => ev.tournaments.filter((t) => t.type !== 'team');
  const teamTournaments = () => ev.tournaments.filter((t) => t.type === 'team');
  const tShort = (t) => t.short || t.name;

  // ---------- hlavička ----------

  function renderHeader() {
    document.title = 'Přihláška – ' + ev.name;
    $('#event-name').textContent = ev.name;
    const meta = [R.formatRange(ev.dateFrom, ev.dateTo), ev.place].filter(Boolean);
    if (ev.deadline) meta.push('přihlášky do ' + R.formatDate(ev.deadline));
    $('#event-meta').textContent = meta.join(' · ');
    $('#event-intro').textContent = ev.intro || '';
    $('#list-link').href = 'seznam.html?akce=' + encodeURIComponent(ev.slug);
    if (ev.infoUrl) {
      const a = $('#info-link');
      a.href = ev.infoUrl;
      a.hidden = false;
    }
  }

  // ---------- hráči (jednotlivci, i celá výprava) ----------

  function attachPickerDb(picker) {
    if (db) picker.setDB(db);
    else if (dbFailed) picker.setUnavailable();
  }

  function checkedIds(card) {
    return $$('.tournament input:checked', card.el).map((i) => i.value);
  }

  function addPlayerCard(copyFrom) {
    const el = document.createElement('div');
    el.className = 'player-card';
    el.innerHTML = `
      <button type="button" class="link danger remove-player">Odebrat</button>
      <div class="pc-picker"></div>
      <fieldset class="tournaments">
        <legend>Turnaje <span class="req">*</span></legend>
        ${individualTournaments().map((t) => `
          <label class="tournament" data-id="${esc(t.id)}">
            <input type="checkbox" value="${esc(t.id)}">
            <span class="t-body">
              <span class="t-name">${esc(R.tournamentLabel(t))}</span>
              ${R.ruleText(t) ? `<span class="t-rule">${esc(R.ruleText(t))}</span>` : ''}
              <span class="t-block" hidden></span>
              <span class="t-warn" hidden></span>
            </span>
          </label>`).join('')}
      </fieldset>`;
    $('#players').appendChild(el);

    const picker = window.createPicker($('.pc-picker', el), { label: 'Hráč', required: true });
    attachPickerDb(picker);
    const card = { el, picker };
    cards.push(card);

    const prev = copyFrom ? checkedIds(copyFrom) : [];
    const only = individualTournaments().length === 1;
    $$('.tournament input', el).forEach((i) => {
      i.checked = only || prev.includes(i.value);
      i.addEventListener('change', () => { updateCard(card); updateBulk(); });
    });
    picker.onChange(() => { updateCard(card); updateBulk(); refreshFinder(); });
    $('.remove-player', el).addEventListener('click', () => removeCard(card));

    renumber();
    updateCard(card);
    updateBulk();
    return card;
  }

  function removeCard(card) {
    if (cards.length < 2) return;
    const p = card.picker.getValue();
    if (p && !confirm(`Odebrat z přihlášky hráče ${p.name}?`)) return;
    card.el.remove();
    cards = cards.filter((c) => c !== card);
    renumber();
    updateBulk();
    refreshFinder();
  }

  function renumber() {
    const multi = cards.length > 1;
    cards.forEach((c, i) => {
      c.picker.setLabel(multi ? `${i + 1}. hráč` : 'Hráč');
      $('.remove-player', c.el).hidden = !multi;
    });
    updateSubmitLabel();
  }

  function updateCard(card) {
    const p = card.picker.getValue();
    individualTournaments().forEach((t) => {
      const label = $(`.tournament[data-id="${CSS.escape(t.id)}"]`, card.el);
      const input = label.querySelector('input');
      const block = R.eligibility(t, p);
      input.disabled = !!block;
      if (block) input.checked = false;
      label.classList.toggle('disabled', !!block);
      const b = label.querySelector('.t-block');
      b.hidden = !block;
      b.textContent = block ? `Nelze vybrat – turnaj je ${block}.` : '';
      const warn = input.checked ? R.ratingWarning(t, p) : '';
      const w = label.querySelector('.t-warn');
      w.hidden = !warn;
      w.textContent = warn;
    });
  }

  /** Hromadné zaškrtnutí turnaje všem hráčům (jen tam, kam ročníkem patří). */
  function updateBulk() {
    const box = $('#bulk');
    const tours = individualTournaments();
    box.hidden = cards.length < 2 || tours.length < 2;
    if (box.hidden) return;
    box.innerHTML = '<span class="bulk-label">Zaškrtnout všem hráčům:</span>' + tours.map((t) => {
      const inputs = cards.map((c) => $(`.tournament[data-id="${CSS.escape(t.id)}"] input`, c.el)).filter((i) => !i.disabled);
      const all = inputs.length > 0 && inputs.every((i) => i.checked);
      return `<button type="button" class="chip" data-bulk="${esc(t.id)}" aria-pressed="${all}" ${inputs.length ? '' : 'disabled'}>${all ? '✓ ' : ''}${esc(tShort(t))}</button>`;
    }).join('');
    $$('[data-bulk]', box).forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.bulk;
      const inputs = cards.map((c) => $(`.tournament[data-id="${CSS.escape(id)}"] input`, c.el)).filter((i) => !i.disabled);
      const check = !inputs.every((i) => i.checked);
      inputs.forEach((i) => { i.checked = check; });
      cards.forEach(updateCard);
      updateBulk();
    }));
  }

  function updateSubmitLabel() {
    const btn = $('#submit');
    if (mode === 'team') btn.textContent = 'Odeslat přihlášku družstva';
    else if (cards.length > 1) btn.textContent = `Odeslat přihlášku (${cards.length} hráčů)`;
    else btn.textContent = 'Odeslat přihlášku';
  }

  // ---------- panel „Vybrat hráče z listiny“ (hromadný výběr podle klubu a ročníku) ----------

  const FINDER_LIMIT = 300;
  const finderSel = new Set(); // ID ČR vybraných hráčů
  const finderTours = new Set();
  let finderTimer = null;
  let finderShown = [];

  function playerKey(p) {
    return p.id ? 'id:' + p.id : 'n:' + R.norm(p.surname + ' ' + p.firstName) + ':' + p.year;
  }

  function keysInForm() {
    return new Set(cards.map((c) => c.picker.getValue()).filter(Boolean).map(playerKey));
  }

  function setupFinder() {
    const wrap = $('#finder-wrap');
    wrap.hidden = !individualTournaments().length;
    if (wrap.hidden) return;
    $('#finder').open = window.matchMedia('(min-width: 1100px)').matches;
    ['#f-club', '#f-from', '#f-to'].forEach((s) => $(s).addEventListener('input', () => {
      clearTimeout(finderTimer);
      finderTimer = setTimeout(runFinder, 150);
    }));
    ['#f-sex', '#f-active'].forEach((s) => $(s).addEventListener('change', runFinder));
    $('#f-add').addEventListener('click', addFromFinder);
    const only = individualTournaments().length === 1;
    $('#f-tours').innerHTML = '<span class="small">Přihlásit do:</span>' + individualTournaments().map((t) => {
      if (only) finderTours.add(t.id);
      return `<button type="button" class="chip" data-ftour="${esc(t.id)}" aria-pressed="${only}">${only ? '✓ ' : ''}${esc(tShort(t))}</button>`;
    }).join('');
    $$('[data-ftour]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.ftour;
      if (finderTours.has(id)) finderTours.delete(id); else finderTours.add(id);
      const on = finderTours.has(id);
      b.setAttribute('aria-pressed', on);
      b.textContent = (on ? '✓ ' : '') + tShort(individualTournaments().find((t) => t.id === id));
    }));
    renderFinder();
  }

  function finderReady() {
    if (!db) {
      $('#f-status').textContent = dbFailed ? 'Seznam hráčů se nepodařilo načíst.' : 'Načítám seznam hráčů…';
      return false;
    }
    if (!$('#f-clubs').children.length) {
      $('#f-clubs').innerHTML = db.clubNames().map((c) => `<option value="${esc(c)}">`).join('');
    }
    return true;
  }

  function runFinder() {
    finderSel.clear();
    renderFinder();
  }

  function renderFinder() {
    if (!finderReady()) return;
    const club = $('#f-club').value.trim();
    const from = $('#f-from').value.trim();
    const to = $('#f-to').value.trim();
    const list = $('#f-list');
    if (club.length < 2 && !/^\d{4}$/.test(from) && !/^\d{4}$/.test(to)) {
      finderShown = [];
      list.innerHTML = '';
      $('#f-status').textContent = 'Zadejte klub nebo ročník.';
      $('#f-actions').hidden = true;
      return;
    }
    const res = db.filter({ club, yearFrom: from, yearTo: to, sex: $('#f-sex').value, activeOnly: $('#f-active').checked }, FINDER_LIMIT);
    finderShown = res.players;
    const inForm = keysInForm();
    $('#f-status').textContent = res.total
      ? `Nalezeno ${res.total} hráčů${res.total > FINDER_LIMIT ? `, zobrazeno prvních ${FINDER_LIMIT} – zužte filtr` : ''}.`
      : 'Nikdo neodpovídá filtru.';
    const free = finderShown.filter((p) => !inForm.has(playerKey(p)));
    list.innerHTML = finderShown.length ? `
      <label class="check finder-all"><input type="checkbox" id="f-all" ${free.length && free.every((p) => finderSel.has(p.id)) ? 'checked' : ''} ${free.length ? '' : 'disabled'}> vybrat všechny zobrazené</label>
      ${finderShown.map((p) => {
        const already = inForm.has(playerKey(p));
        return `<label class="finder-row${already ? ' in-form' : ''}">
          <input type="checkbox" data-fid="${esc(p.id)}" ${already || finderSel.has(p.id) ? 'checked' : ''} ${already ? 'disabled' : ''}>
          <span><strong>${esc(p.name)}</strong>${p.title ? ` <span class="badge">${esc(p.title)}</span>` : ''}
            <span class="opt-meta">${esc([p.year, p.club, p.rn ? 'ELO ČR ' + p.rn : '', p.rf ? 'FIDE ' + p.rf : ''].filter(Boolean).join(' · '))}${already ? ' · v přihlášce' : ''}</span></span>
        </label>`;
      }).join('')}` : '';
    const all = $('#f-all');
    if (all) {
      all.addEventListener('change', () => {
        free.forEach((p) => { if (all.checked) finderSel.add(p.id); else finderSel.delete(p.id); });
        renderFinder();
      });
    }
    $$('[data-fid]', list).forEach((i) => i.addEventListener('change', () => {
      const id = Number(i.dataset.fid);
      if (i.checked) finderSel.add(id); else finderSel.delete(id);
      updateFinderButton();
    }));
    $('#f-actions').hidden = !finderShown.length;
    updateFinderButton();
  }

  function refreshFinder() {
    if (!$('#finder-wrap').hidden && finderShown.length) renderFinder();
  }

  function updateFinderButton() {
    const n = finderSel.size;
    const btn = $('#f-add');
    btn.disabled = !n;
    btn.textContent = n ? `Přidat vybrané do přihlášky (${n})` : 'Přidat vybrané do přihlášky';
  }

  function addFromFinder() {
    const inForm = keysInForm();
    const chosen = finderShown.filter((p) => finderSel.has(p.id) && !inForm.has(playerKey(p)));
    if (!chosen.length) return;
    const tours = Array.from(finderTours);
    chosen.forEach((p) => {
      // prázdnou první kartu použijeme, jinak přidáme novou
      let card = cards.find((c) => c.picker.isEmpty());
      if (!card) card = addPlayerCard(cards[cards.length - 1]);
      card.picker.setPlayer(p);
      if (tours.length) {
        $$('.tournament input', card.el).forEach((i) => { i.checked = tours.includes(i.value); });
      }
      updateCard(card);
    });
    finderSel.clear();
    updateBulk();
    renumber();
    renderFinder();
    const msg = $('#f-msg');
    msg.textContent = `Přidáno ${chosen.length} hráčů. Turnaje u nich můžete upravit vlevo.`;
    setTimeout(() => { if (msg.textContent.startsWith('Přidáno')) msg.textContent = ''; }, 6000);
  }

  // ---------- družstva ----------

  function renderTeamSection() {
    const teams = teamTournaments();
    if (!teams.length) return;
    $('#mode-switch').hidden = !individualTournaments().length;
    if (!individualTournaments().length) form.querySelector('[name="mode"][value="team"]').checked = true;
    $('#team-tournament').hidden = teams.length < 2;
    $('#team-tournament-list').innerHTML = teams.map((t, i) => `
      <label class="tournament">
        <input type="radio" name="teamTournament" value="${esc(t.id)}" ${i === 0 ? 'checked' : ''}>
        <span class="t-body"><span class="t-name">${esc(R.tournamentLabel(t))}</span></span>
      </label>`).join('');
    $$('#team-tournament-list input').forEach((i) => i.addEventListener('change', renderTeamPlayers));
    renderTeamPlayers();
  }

  function currentTeamTournament() {
    const id = (form.querySelector('[name="teamTournament"]:checked') || {}).value;
    return teamTournaments().find((t) => t.id === id) || teamTournaments()[0];
  }

  function renderTeamPlayers() {
    const t = currentTeamTournament();
    const box = $('#team-players');
    const boards = t.boards || 4;
    const reserves = t.reserves || 0;
    box.innerHTML = '';
    teamPickers = [];
    const title = document.createElement('h2');
    title.className = 'section-title';
    title.textContent = R.tournamentLabel(t) + (R.ruleText(t) ? ` (${R.ruleText(t)})` : '');
    box.appendChild(title);
    for (let i = 0; i < boards + reserves; i++) {
      const el = document.createElement('div');
      el.className = 'board';
      box.appendChild(el);
      const isReserve = i >= boards;
      const label = isReserve
        ? (reserves > 1 ? `${i - boards + 1}. náhradník` : 'Náhradník') + ' (nepovinné)'
        : `${i + 1}. šachovnice`;
      const picker = window.createPicker(el, { label, required: !isReserve });
      picker.reserve = isReserve;
      attachPickerDb(picker);
      teamPickers.push(picker);
    }
  }

  // ---------- doplňující otázky a režim ----------

  function renderExtras() {
    $('#extras').innerHTML = (ev.extras || []).map((x) => {
      const modes = (x.modes || ['individual', 'team']).join(' ');
      const help = x.help ? `<span class="hint">${esc(x.help)}</span>` : '';
      const name = 'x_' + x.id;
      if (x.type === 'checkboxes') {
        return `<fieldset class="extra" data-modes="${esc(modes)}"><legend>${esc(x.label)}</legend>${help}
          ${(x.options || []).map((o) => `<label class="check"><input type="checkbox" name="${esc(name)}" value="${esc(o)}"> ${esc(o)}</label>`).join('')}
        </fieldset>`;
      }
      if (x.type === 'select') {
        return `<label class="block extra" data-modes="${esc(modes)}">${esc(x.label)}
          <select name="${esc(name)}"><option value="">—</option>
            ${(x.options || []).map((o) => `<option>${esc(o)}</option>`).join('')}</select>${help}
        </label>`;
      }
      if (x.type === 'text') {
        return `<label class="block extra" data-modes="${esc(modes)}">${esc(x.label)}
          <input name="${esc(name)}" maxlength="500">${help}</label>`;
      }
      return `<label class="block extra" data-modes="${esc(modes)}">${esc(x.label)}
        <textarea name="${esc(name)}" rows="3" maxlength="2000"></textarea>${help}
      </label>`;
    }).join('');
  }

  function applyMode() {
    mode = (form.querySelector('[name="mode"]:checked') || {}).value || 'individual';
    $('#individual').hidden = mode !== 'individual';
    $('#team').hidden = mode !== 'team';
    $('#finder-wrap').hidden = mode !== 'individual' || !individualTournaments().length;
    $('#layout').classList.toggle('with-finder', !$('#finder-wrap').hidden);
    $$('#extras .extra').forEach((el) => { el.hidden = !el.dataset.modes.split(' ').includes(mode); });
    updateSubmitLabel();
    hideErrors();
  }

  // ---------- validace a odeslání ----------

  function showErrors(list) {
    const box = $('#errors');
    box.innerHTML = '<strong>Přihlášku zatím nelze odeslat:</strong><ul>' +
      list.map((e) => `<li>${esc(e)}</li>`).join('') + '</ul>';
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function hideErrors() { $('#errors').hidden = true; }

  function validate() {
    const errors = [];
    const year = R.eventYear(ev);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.value.trim())) errors.push('Vyplňte platný e-mail.');

    if (mode === 'individual') {
      const seen = [];
      cards.forEach((c) => {
        const err = c.picker.validate(year);
        if (err) {
          errors.push(cards.length > 1 ? err.replace(/\.$/, '') + ', nebo hráče z přihlášky odeberte.' : err);
          return;
        }
        const p = c.picker.getValue();
        const ids = checkedIds(c);
        if (!ids.length) errors.push(`${p.name}: vyberte alespoň jeden turnaj.`);
        ids.forEach((id) => {
          const t = individualTournaments().find((x) => x.id === id);
          const block = R.eligibility(t, p);
          if (block) errors.push(`${p.name}: turnaj „${tShort(t)}“ je ${block}.`);
        });
        if (seen.some((s) => R.samePlayer(s, p))) errors.push(`${p.name} je v přihlášce uveden(a) dvakrát.`);
        seen.push(p);
      });
    } else {
      const t = currentTeamTournament();
      if (!form.teamName.value.trim()) errors.push('Vyplňte název družstva.');
      if (!form.teamCaptain.value.trim()) errors.push('Vyplňte kapitána / vedoucího družstva.');
      const seen = [];
      teamPickers.forEach((pk) => {
        if (pk.reserve && pk.isEmpty()) return;
        const err = pk.validate(year);
        if (err) { errors.push(err); return; }
        const p = pk.getValue();
        const block = R.eligibility(t, p);
        if (block) errors.push(`${p.name}: soutěž je ${block}.`);
        if (seen.some((s) => R.samePlayer(s, p))) errors.push(`${p.name} je v družstvu uveden dvakrát.`);
        seen.push(p);
      });
    }
    return errors;
  }

  function collectExtras() {
    const out = {};
    (ev.extras || []).forEach((x) => {
      if (!(x.modes || ['individual', 'team']).includes(mode)) return;
      const name = 'x_' + x.id;
      if (x.type === 'checkboxes') out[x.id] = $$(`[name="${name}"]:checked`, form).map((i) => i.value);
      else out[x.id] = (form.querySelector(`[name="${name}"]`).value || '').trim();
    });
    return out;
  }

  function collect() {
    const base = { slug: ev.slug, mode, email: form.email.value.trim(), extras: collectExtras(), web: form.web.value };
    if (mode === 'individual') {
      base.players = cards.map((c) => ({ player: c.picker.getValue(), tournaments: checkedIds(c) }));
    } else {
      base.team = {
        tournamentId: currentTeamTournament().id,
        name: form.teamName.value.trim(),
        captain: form.teamCaptain.value.trim(),
        players: teamPickers.map((pk) => (pk.reserve && pk.isEmpty() ? null : pk.getValue())),
      };
    }
    return base;
  }

  function showDone(res, payload) {
    const tName = (id) => {
      const t = ev.tournaments.find((x) => x.id === id);
      return t ? R.tournamentLabel(t) : id;
    };
    let what;
    if (payload.mode === 'team') {
      const players = payload.team.players.filter(Boolean).map((p) => esc(p.name)).join(', ');
      what = `<p>Družstvo <strong>${esc(payload.team.name)}</strong> (${players})<br>${esc(tName(payload.team.tournamentId))}</p>`;
    } else {
      what = payload.players.map((e) => `<p class="done-player"><strong>${esc(e.player.name)}</strong><br>
        <span class="small">${e.tournaments.map((id) => esc(tName(id))).join('<br>')}</span></p>`).join('');
    }
    const done = $('#done');
    done.innerHTML = `
      <h2>Přihláška byla odeslána ✓</h2>
      ${what}
      <p class="muted">Číslo přihlášky: <strong>${esc(res.id || '')}</strong>. Potvrzení jsme poslali na ${esc(payload.email)}.</p>
      <p class="actions">
        <button type="button" class="primary" id="another">${payload.mode === 'team' ? 'Přihlásit další družstvo' : 'Přihlásit další hráče'}</button>
        <a class="button" href="seznam.html?akce=${encodeURIComponent(ev.slug)}">Seznam přihlášených</a>
      </p>`;
    done.hidden = false;
    form.hidden = true;
    $('#finder-wrap').hidden = true;
    $('#layout').classList.remove('with-finder');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('#another').addEventListener('click', () => {
      resetForm();
      done.hidden = true;
      form.hidden = false;
      if (cards[0]) cards[0].picker.focus();
    });
  }

  function resetForm() {
    const email = form.email.value;
    const keepMode = mode;
    form.reset();
    form.email.value = email;
    const radio = form.querySelector(`[name="mode"][value="${keepMode}"]`);
    if (radio) radio.checked = true;
    $('#players').innerHTML = '';
    cards = [];
    finderSel.clear();
    if (individualTournaments().length) addPlayerCard(null);
    if (teamTournaments().length) renderTeamPlayers();
    applyMode();
  }

  async function onSubmit(e) {
    e.preventDefault();
    hideErrors();
    const errors = validate();
    if (errors.length) { showErrors(errors); return; }
    const payload = collect();
    const btn = $('#submit');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Odesílám…';
    try {
      const res = await window.Api.post('register', payload);
      showDone(res, payload);
    } catch (err) {
      showErrors([err.message]);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  // ---------- start ----------

  async function loadPlayers() {
    try {
      const res = await fetch('data/players.json');
      if (!res.ok) throw new Error(res.status);
      db = new window.Players.PlayerDB(await res.json());
      const when = db.generated ? new Date(db.generated).toLocaleDateString('cs-CZ') : '';
      $('#db-info').textContent = `Našeptávač: listina LOK (${db.size.toLocaleString('cs-CZ')} hráčů${when ? ', načteno ' + when : ''}).`;
    } catch (err) {
      dbFailed = true;
      $('#db-info').textContent = 'Seznam hráčů se nepodařilo načíst, údaje prosím vyplňte ručně.';
    }
    cards.forEach((c) => attachPickerDb(c.picker));
    teamPickers.forEach(attachPickerDb);
    renderFinder();
  }

  async function init() {
    if (!slug) { location.replace('./'); return; }
    try {
      ev = (await window.Api.get('event', { slug })).event;
    } catch (err) {
      $('#loading').hidden = true;
      $('#closed').textContent = err.message;
      $('#closed').hidden = false;
      return;
    }
    $('#loading').hidden = true;
    renderHeader();
    if (R.isClosed(ev)) {
      $('#closed').textContent = 'Přihlašování na tuto akci je uzavřeno.';
      $('#closed').hidden = false;
      return;
    }
    if (individualTournaments().length) addPlayerCard(null);
    $('#add-player').addEventListener('click', () => {
      const card = addPlayerCard(cards[cards.length - 1]);
      card.picker.focus();
      card.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    setupFinder();
    renderTeamSection();
    renderExtras();
    $$('[name="mode"]', form).forEach((r) => r.addEventListener('change', applyMode));
    form.addEventListener('submit', onSubmit);
    applyMode();
    form.hidden = false;
    loadPlayers();
  }

  init();
})();
