/* Přihlašovací formulář – logika stránky index.html. */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = window.escapeHtml;

  const form = $('#form');
  let cfg = null;
  let db = null;
  let dbFailed = false;
  let mode = 'individual';
  let playerPicker = null;
  let teamPickers = [];

  // ---------- pomocné funkce ----------

  function isClosed(config) {
    const d = config.festival && config.festival.deadline;
    if (!d) return false;
    const end = new Date(d.includes('T') ? d : d + 'T23:59:59');
    return !isNaN(end) && new Date() > end;
  }

  function ruleText(t) {
    const parts = [];
    if (t.minBirthYear) parts.push(`ročník ${t.minBirthYear} a mladší`);
    if (t.maxBirthYear) parts.push(`ročník ${t.maxBirthYear} a starší`);
    if (t.warnMaxRating) parts.push(`ELO do ${t.warnMaxRating}`);
    return parts.join(', ');
  }

  function eligibility(t, p) {
    if (!p || !p.year) return '';
    if (t.minBirthYear && p.year < t.minBirthYear) return `jen pro ročník ${t.minBirthYear} a mladší`;
    if (t.maxBirthYear && p.year > t.maxBirthYear) return `jen pro ročník ${t.maxBirthYear} a starší`;
    return '';
  }

  function ratingWarning(t, p) {
    if (!t.warnMaxRating || !p) return '';
    const r = Math.max(p.rn || 0, p.rf || 0);
    if (r <= t.warnMaxRating) return '';
    return `Pozor: hráč má ${p.rn ? 'ELO ČR ' + p.rn : ''}${p.rn && p.rf ? ' / ' : ''}${p.rf ? 'FIDE ' + p.rf : ''}, ` +
      `turnaj je určen pro hráče do ELO ${t.warnMaxRating}. Přihlášku posoudí pořadatel.`;
  }

  function samePlayer(a, b) {
    if (a.id && b.id) return a.id === b.id;
    return window.Players.norm(a.surname + ' ' + a.firstName) === window.Players.norm(b.surname + ' ' + b.firstName) &&
      a.year === b.year;
  }

  const individualTournaments = () => cfg.tournaments.filter((t) => t.type !== 'team');
  const teamTournaments = () => cfg.tournaments.filter((t) => t.type === 'team');
  const tournamentLabel = (t) => (t.day ? `${t.day} – ` : '') + t.name;

  // ---------- vykreslení ----------

  function renderHeader() {
    const f = cfg.festival || {};
    document.title = 'Přihláška – ' + (f.name || 'turnaj');
    $('#festival-name').textContent = f.name || 'Přihláška na turnaj';
    $('#festival-intro').textContent = f.intro || '';
    if (f.infoUrl) {
      const a = $('#info-link');
      a.href = f.infoUrl;
      a.textContent = 'Informace: ' + f.infoUrl.replace(/^https?:\/\//, '');
      a.hidden = false;
    }
  }

  function renderTournaments() {
    $('#tournament-list').innerHTML = individualTournaments().map((t) => `
      <label class="tournament" data-code="${esc(t.code)}">
        <input type="checkbox" name="t" value="${esc(t.code)}">
        <span class="t-body">
          <span class="t-name">${esc(tournamentLabel(t))}</span>
          ${ruleText(t) ? `<span class="t-rule">${esc(ruleText(t))}</span>` : ''}
          <span class="t-block" hidden></span>
          <span class="t-warn" hidden></span>
        </span>
      </label>`).join('');
    $$('#tournament-list input').forEach((i) => i.addEventListener('change', updateEligibility));

    const teams = teamTournaments();
    if (!teams.length) return;
    $('#mode-switch').hidden = false;
    $('#team-tournament').hidden = teams.length < 2;
    $('#team-tournament-list').innerHTML = teams.map((t, i) => `
      <label class="tournament">
        <input type="radio" name="teamTournament" value="${esc(t.code)}" ${i === 0 ? 'checked' : ''}>
        <span class="t-body"><span class="t-name">${esc(tournamentLabel(t))}</span></span>
      </label>`).join('');
    $$('#team-tournament-list input').forEach((i) => i.addEventListener('change', renderTeamPlayers));
    renderTeamPlayers();
  }

  function currentTeamTournament() {
    const code = (form.querySelector('[name="teamTournament"]:checked') || {}).value;
    return teamTournaments().find((t) => t.code === code) || teamTournaments()[0];
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
    title.textContent = `${tournamentLabel(t)}${ruleText(t) ? ' (' + ruleText(t) + ')' : ''}`;
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
    $('#extras').innerHTML = (cfg.extras || []).map((x) => {
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
          <select name="${esc(name)}"><option value="">${esc(x.emptyLabel || '—')}</option>
            ${(x.options || []).map((o) => `<option>${esc(o)}</option>`).join('')}</select>${help}
        </label>`;
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
      const label = $(`.tournament[data-code="${CSS.escape(t.code)}"]`);
      const input = label.querySelector('input');
      const block = eligibility(t, p);
      input.disabled = !!block;
      if (block) input.checked = false;
      label.classList.toggle('disabled', !!block);
      const b = label.querySelector('.t-block');
      b.hidden = !block;
      b.textContent = block ? `Nelze vybrat – turnaj je ${block}.` : '';
      const warn = input.checked ? ratingWarning(t, p) : '';
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
    const year = Number(cfg.festival.year) || new Date().getFullYear();
    const email = form.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Vyplňte platný e-mail.');

    if (mode === 'individual') {
      const err = playerPicker.validate(year);
      if (err) errors.push(err);
      const chosen = $$('#tournament-list input:checked');
      if (!chosen.length) errors.push('Vyberte alespoň jeden turnaj.');
      const p = playerPicker.getValue();
      if (p) {
        chosen.forEach((i) => {
          const t = individualTournaments().find((x) => x.code === i.value);
          const block = eligibility(t, p);
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
        const block = eligibility(t, p);
        if (block) errors.push(`${p.name}: soutěž je ${block}.`);
        if (seen.some((s) => samePlayer(s, p))) errors.push(`${p.name} je v družstvu uveden dvakrát.`);
        seen.push(p);
      });
    }
    return errors;
  }

  function collectExtras() {
    const out = {};
    (cfg.extras || []).forEach((x) => {
      const modes = x.modes || ['individual', 'team'];
      if (!modes.includes(mode)) return;
      const name = 'x_' + x.id;
      if (x.type === 'checkboxes') out[x.id] = $$(`[name="${name}"]:checked`, form).map((i) => i.value);
      else out[x.id] = (form.querySelector(`[name="${name}"]`).value || '').trim();
    });
    return out;
  }

  function collect() {
    const base = { mode, email: form.email.value.trim(), extras: collectExtras(), web: form.web.value };
    if (mode === 'individual') {
      base.player = playerPicker.getValue();
      base.tournaments = $$('#tournament-list input:checked').map((i) => i.value);
    } else {
      base.team = {
        tournament: currentTeamTournament().code,
        name: form.teamName.value.trim(),
        captain: form.teamCaptain.value.trim(),
        players: teamPickers.map((pk) => (pk.reserve && pk.isEmpty() ? null : pk.getValue())),
      };
    }
    return base;
  }

  function showDone(res, payload) {
    const done = $('#done');
    const tName = (code) => {
      const t = cfg.tournaments.find((x) => x.code === code);
      return t ? tournamentLabel(t) : code;
    };
    let what;
    if (payload.mode === 'team') {
      const players = payload.team.players.filter(Boolean).map((p) => esc(p.name)).join(', ');
      what = `<p>Družstvo <strong>${esc(payload.team.name)}</strong> (${players})<br>${esc(tName(payload.team.tournament))}</p>`;
    } else {
      what = `<p><strong>${esc(payload.player.name)}</strong></p><ul>${payload.tournaments.map((c) => `<li>${esc(tName(c))}</li>`).join('')}</ul>`;
    }
    done.innerHTML = `
      <h2>Přihláška byla odeslána ✓</h2>
      ${what}
      <p class="muted">Číslo přihlášky: <strong>${esc(res.id || '')}</strong>.
        ${cfg.confirmationEmail !== false ? `Potvrzení jsme poslali na ${esc(payload.email)}.` : ''}</p>
      <p class="actions">
        <button type="button" class="primary" id="another">Přihlásit dalšího ${payload.mode === 'team' ? 'účastníka' : 'hráče'}</button>
        <a class="button" href="seznam.html">Seznam přihlášených</a>
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
    form.querySelector(`[name="mode"][value="${keepMode}"]`).checked = true;
    playerPicker.reset();
    if (teamTournaments().length) renderTeamPlayers();
    applyMode();
    updateEligibility();
  }

  async function onSubmit(e) {
    e.preventDefault();
    hideErrors();
    const errors = validate();
    if (errors.length) { showErrors(errors); return; }
    if (!cfg.appsScriptUrl) {
      showErrors(['Formulář zatím není propojený s tabulkou přihlášek (v config.json chybí appsScriptUrl).']);
      return;
    }
    const payload = collect();
    const btn = $('#submit');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Odesílám…';
    try {
      const res = await fetch(cfg.appsScriptUrl, {
        method: 'POST',
        // text/plain = bez CORS preflightu, který Apps Script neumí
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) showErrors([data.error || 'Přihlášku se nepodařilo uložit.']);
      else showDone(data, payload);
    } catch (err) {
      showErrors(['Přihlášku se nepodařilo odeslat. Zkontrolujte připojení k internetu a zkuste to znovu.']);
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
    try {
      const res = await fetch('config.json', { cache: 'no-cache' });
      cfg = await res.json();
    } catch (err) {
      $('#closed').textContent = 'Formulář se nepodařilo načíst (chyba v config.json).';
      $('#closed').hidden = false;
      return;
    }
    renderHeader();
    if (isClosed(cfg)) {
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
