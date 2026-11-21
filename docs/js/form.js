/* Přihláška na akci – stránka prihlaska.html?akce=<adresa akce>. */
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
  let playerPicker = null;
  let teamPickers = [];

  const individualTournaments = () => ev.tournaments.filter((t) => t.type !== 'team');
  const teamTournaments = () => ev.tournaments.filter((t) => t.type === 'team');

  // ---------- vykreslení ----------

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

  function renderTournaments() {
    $('#tournament-list').innerHTML = individualTournaments().map((t) => `
      <label class="tournament" data-id="${esc(t.id)}">
        <input type="checkbox" name="t" value="${esc(t.id)}">
        <span class="t-body">
          <span class="t-name">${esc(R.tournamentLabel(t))}</span>
          ${R.ruleText(t) ? `<span class="t-rule">${esc(R.ruleText(t))}</span>` : ''}
          <span class="t-block" hidden></span>
          <span class="t-warn" hidden></span>
        </span>
      </label>`).join('');
    $$('#tournament-list input').forEach((i) => i.addEventListener('change', updateEligibility));
    // jen jeden turnaj = rovnou zaškrtnout
    if (individualTournaments().length === 1) $('#tournament-list input').checked = true;

    const teams = teamTournaments();
    $('#individual').dataset.available = individualTournaments().length ? '1' : '';
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
      if (db) picker.setDB(db);
      else if (dbFailed) picker.setUnavailable();
      teamPickers.push(picker);
    }
  }

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
    $$('#extras .extra').forEach((el) => { el.hidden = !el.dataset.modes.split(' ').includes(mode); });
    $('#submit').textContent = mode === 'team' ? 'Odeslat přihlášku družstva' : 'Odeslat přihlášku';
    hideErrors();
  }

  function updateEligibility() {
    const p = playerPicker.getValue();
    individualTournaments().forEach((t) => {
      const label = $(`.tournament[data-id="${CSS.escape(t.id)}"]`);
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
      const err = playerPicker.validate(year);
      if (err) errors.push(err);
      const chosen = $$('#tournament-list input:checked');
      if (!chosen.length) errors.push('Vyberte alespoň jeden turnaj.');
      const p = playerPicker.getValue();
      if (p) {
        chosen.forEach((i) => {
          const t = individualTournaments().find((x) => x.id === i.value);
          const block = R.eligibility(t, p);
          if (block) errors.push(`Turnaj „${t.short || t.name}“ je ${block}.`);
        });
      }
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
      base.player = playerPicker.getValue();
      base.tournaments = $$('#tournament-list input:checked').map((i) => i.value);
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
      what = `<p><strong>${esc(payload.player.name)}</strong></p><ul>${payload.tournaments.map((id) => `<li>${esc(tName(id))}</li>`).join('')}</ul>`;
    }
    const done = $('#done');
    done.innerHTML = `
      <h2>Přihláška byla odeslána ✓</h2>
      ${what}
      <p class="muted">Číslo přihlášky: <strong>${esc(res.id || '')}</strong>. Potvrzení jsme poslali na ${esc(payload.email)}.</p>
      <p class="actions">
        <button type="button" class="primary" id="another">Přihlásit dalšího ${payload.mode === 'team' ? 'účastníka' : 'hráče'}</button>
        <a class="button" href="seznam.html?akce=${encodeURIComponent(ev.slug)}">Seznam přihlášených</a>
      </p>`;
    done.hidden = false;
    form.hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('#another').addEventListener('click', () => {
      resetForm();
      done.hidden = true;
      form.hidden = false;
      playerPicker.focus();
    });
  }

  function resetForm() {
    const email = form.email.value;
    const keepMode = mode;
    form.reset();
    form.email.value = email;
    const radio = form.querySelector(`[name="mode"][value="${keepMode}"]`);
    if (radio) radio.checked = true;
    playerPicker.reset();
    if (individualTournaments().length === 1) $('#tournament-list input').checked = true;
    if (teamTournaments().length) renderTeamPlayers();
    applyMode();
    updateEligibility();
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
      playerPicker.setDB(db);
      teamPickers.forEach((pk) => pk.setDB(db));
      const when = db.generated ? new Date(db.generated).toLocaleDateString('cs-CZ') : '';
      $('#db-info').textContent = `Našeptávač: listina LOK (${db.size.toLocaleString('cs-CZ')} hráčů${when ? ', načteno ' + when : ''}).`;
    } catch (err) {
      dbFailed = true;
      playerPicker.setUnavailable();
      teamPickers.forEach((pk) => pk.setUnavailable());
      $('#db-info').textContent = 'Seznam hráčů se nepodařilo načíst, údaje prosím vyplňte ručně.';
    }
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
    playerPicker = window.createPicker($('#player-picker'), { label: 'Hráč', required: true });
    playerPicker.onChange(updateEligibility);
    renderTournaments();
    renderExtras();
    $$('[name="mode"]', form).forEach((r) => r.addEventListener('change', applyMode));
    form.addEventListener('submit', onSubmit);
    applyMode();
    form.hidden = false;
    loadPlayers();
  }

  init();
})();
