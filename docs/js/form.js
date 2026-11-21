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
  let updateTotal = null; // přepočet částky k úhradě
  let teamCards = []; // družstva: { el, roster, uid }
  let teamSeq = 0;

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
              <span class="t-fee small" hidden></span>
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
      const fee = R.entryFee(t, p || {});
      const f = label.querySelector('.t-fee');
      f.hidden = !fee || !!block;
      if (fee) f.textContent = `startovné ${R.formatMoney(fee.amount)}${p && fee.reason ? ' (' + fee.reason + ')' : ''}`;
    });
    if (updateTotal) updateTotal();
  }

  /** Startovné celé přihlášky (jednotlivci: za hráče a turnaj, družstva: za družstvo). */
  function feesTotal() {
    if (!ev) return 0;
    if (mode === 'team') {
      return teamCards.reduce((sum, c) => {
        const fee = R.entryFee(teamTournamentOf(c), {});
        return sum + (fee ? fee.amount : 0);
      }, 0);
    }
    return cards.reduce((sum, c) => {
      const p = c.picker.getValue();
      return sum + checkedIds(c).reduce((s2, id) => {
        const fee = R.entryFee(individualTournaments().find((t) => t.id === id), p || {});
        return s2 + (fee ? fee.amount : 0);
      }, 0);
    }, 0);
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
    if (updateTotal) updateTotal();
    const btn = $('#submit');
    if (mode === 'team') btn.textContent = teamCards.length > 1 ? `Odeslat přihlášku (${teamCards.length} družstev)` : 'Odeslat přihlášku družstva';
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
    if (mode === 'team') return new Set([].concat(...teamCards.map((c) => c.roster.keys())));
    return new Set(cards.map((c) => c.picker.getValue()).filter(Boolean).map(playerKey));
  }

  function setupFinder() {
    const wrap = $('#finder-wrap');
    wrap.hidden = !ev.tournaments.length;
    if (wrap.hidden) return;
    $('#finder').open = window.matchMedia('(min-width: 1100px)').matches;
    ['#f-club', '#f-from', '#f-to'].forEach((s) => $(s).addEventListener('input', () => {
      clearTimeout(finderTimer);
      finderTimer = setTimeout(runFinder, 150);
    }));
    ['#f-sex', '#f-member'].forEach((s) => $(s).addEventListener('change', runFinder));
    $('#f-add').addEventListener('click', addFromFinder);
    const only = individualTournaments().length === 1;
    $('#f-team').addEventListener('change', updateFinderButton);
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
    const res = db.filter({ club, yearFrom: from, yearTo: to, sex: $('#f-sex').value, membership: $('#f-member').value }, FINDER_LIMIT);
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
          <span><span><strong>${esc(p.name)}</strong>${p.title ? ` <span class="badge">${esc(p.title)}</span>` : ''}${window.Players.isActive(p) ? '' : ' <span class="badge muted-badge">neaktivní</span>'}</span>
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
    const where = mode === 'team' ? 'do družstva' : 'do přihlášky';
    btn.textContent = n ? `Přidat vybrané ${where} (${n})` : `Přidat vybrané ${where}`;
  }

  /** Výběr cílového družstva v panelu (v režimu družstev). */
  function updateFinderTargets() {
    const sel = $('#f-team');
    const prev = sel.value;
    sel.innerHTML = teamCards.map((c, i) => `<option value="${c.uid}">${esc(teamLabel(c, i))} (volno ${c.roster.free()})</option>`).join('');
    if (teamCards.some((c) => String(c.uid) === prev)) sel.value = prev;
    $('#f-tours').hidden = mode === 'team';
    $('#f-team-wrap').hidden = mode !== 'team';
  }

  function addFromFinder() {
    const inForm = keysInForm();
    const chosen = finderShown.filter((p) => finderSel.has(p.id) && !inForm.has(playerKey(p)));
    if (!chosen.length) return;
    if (mode === 'team') {
      const card = teamCards.find((c) => String(c.uid) === $('#f-team').value) || teamCards[0];
      const fit = chosen.slice(0, card.roster.free());
      fit.forEach((p) => card.roster.add(p));
      finderSel.clear();
      renderFinder();
      updateFinderTargets();
      const msg = $('#f-msg');
      msg.textContent = fit.length < chosen.length
        ? `Do družstva se vešlo jen ${fit.length} z ${chosen.length} hráčů – zbytek přidejte do dalšího družstva.`
        : `Přidáno ${fit.length} hráčů do družstva. Pořadí upravíte šipkami vlevo.`;
      setTimeout(() => { if (msg.textContent.startsWith('P') || msg.textContent.startsWith('D')) msg.textContent = ''; }, 7000);
      return;
    }
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

  // ---------- družstva (víc družstev v jedné přihlášce, soupiska i později) ----------

  function teamLabel(c, i) {
    const name = $('[data-f="name"]', c.el).value.trim();
    return name || `${i + 1}. družstvo`;
  }

  function teamTournamentOf(c) {
    const id = $('[data-f="tournament"]', c.el).value;
    return teamTournaments().find((t) => t.id === id) || teamTournaments()[0];
  }

  function renderTeamSection() {
    const teams = teamTournaments();
    if (!teams.length) return;
    $('#mode-switch').hidden = !individualTournaments().length;
    if (!individualTournaments().length) form.querySelector('[name="mode"][value="team"]').checked = true;
    addTeamCard(null);
    $('#add-team').addEventListener('click', () => {
      const c = addTeamCard(teamCards[teamCards.length - 1]);
      $('[data-f="name"]', c.el).focus();
      c.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function addTeamCard(prev) {
    const uid = ++teamSeq;
    const tours = teamTournaments();
    const el = document.createElement('div');
    el.className = 'team-card';
    el.innerHTML = `
      <button type="button" class="link danger remove-team">Odebrat družstvo</button>
      <h3 class="team-title"></h3>
      <label class="block"${tours.length < 2 ? ' hidden' : ''}>Soutěž <span class="req">*</span>
        <select data-f="tournament">${tours.map((t) => `<option value="${esc(t.id)}">${esc(R.tournamentLabel(t))}</option>`).join('')}</select></label>
      <div class="grid">
        <label>Název družstva <span class="req">*</span><input data-f="name" placeholder="např. ŠK Teplice A"></label>
        <label>Kapitán / vedoucí <span class="req">*</span><input data-f="captain"></label>
      </div>
      <p class="t-rule team-rule"></p>
      <div class="roster-box"></div>
      <label class="check"><input type="checkbox" data-f="later"> Soupisku doplním později (přes odkaz z potvrzovacího e-mailu)</label>`;
    $('#teams').appendChild(el);
    const card = { el, uid };
    if (prev) {
      $('[data-f="tournament"]', el).value = $('[data-f="tournament"]', prev.el).value;
      $('[data-f="captain"]', el).value = $('[data-f="captain"]', prev.el).value;
    }
    const t = teamTournamentOf(card);
    card.roster = window.createRoster($('.roster-box', el), {
      boards: t.boards || 4, reserves: t.reserves || 0, tournament: t, event: ev,
      moveTargets: () => teamCards.filter((c) => c !== card).map((c) => ({ id: String(c.uid), label: teamLabel(c, teamCards.indexOf(c)) })),
      onMove: (p, targetId) => {
        const target = teamCards.find((c) => String(c.uid) === targetId);
        if (!target || !target.roster.add(p)) card.roster.add(p);
      },
      onChange: () => { refreshFinder(); updateFinderTargets(); },
    });
    if (db) card.roster.setDB(db);
    else if (dbFailed) card.roster.setUnavailable();
    teamCards.push(card);

    const syncTournament = () => {
      const tt = teamTournamentOf(card);
      card.roster.setLimits(tt.boards || 4, tt.reserves || 0, tt);
      const tf = R.entryFee(tt, {});
      $('.team-rule', el).textContent = [R.teamSize(tt), R.ruleText(tt), tf ? 'startovné ' + R.formatMoney(tf.amount) + ' za družstvo' : ''].filter(Boolean).join(' · ');
      if (updateTotal) updateTotal();
    };
    $('[data-f="tournament"]', el).addEventListener('change', syncTournament);
    $('[data-f="name"]', el).addEventListener('input', () => { renumberTeams(); teamCards.forEach((c) => c.roster.refresh()); });
    $('.remove-team', el).addEventListener('click', () => {
      if (teamCards.length < 2) return;
      if (card.roster.getPlayers().length && !confirm(`Odebrat družstvo ${teamLabel(card, teamCards.indexOf(card))} i se soupiskou?`)) return;
      el.remove();
      teamCards = teamCards.filter((c) => c !== card);
      renumberTeams();
      teamCards.forEach((c) => c.roster.refresh());
      refreshFinder();
    });
    syncTournament();
    renumberTeams();
    return card;
  }

  function renumberTeams() {
    teamCards.forEach((c, i) => {
      $('.team-title', c.el).textContent = teamCards.length > 1 ? `${i + 1}. družstvo` : 'Družstvo';
      $('.remove-team', c.el).hidden = teamCards.length < 2;
    });
    updateFinderTargets();
    updateSubmitLabel();
  }

  // ---------- doplňující otázky a režim ----------

  function renderExtras() {
    $('#extras').innerHTML = (ev.extras || []).map((x) =>
      window.Extras.field(x, null, (x.modes || ['individual', 'team']).join(' '))).join('');
    updateTotal = window.Extras.bindTotal($('#extras'), visibleExtras, $('#extras-total'), feesTotal);
  }

  function visibleExtras() {
    return (ev.extras || []).filter((x) => (x.modes || ['individual', 'team']).includes(mode));
  }

  function applyMode() {
    mode = (form.querySelector('[name="mode"]:checked') || {}).value || 'individual';
    $('#individual').hidden = mode !== 'individual';
    $('#team').hidden = mode !== 'team';
    $('#finder-wrap').hidden = !(mode === 'team' ? teamTournaments() : individualTournaments()).length;
    finderSel.clear();
    updateFinderTargets();
    refreshFinder();
    $('#layout').classList.toggle('with-finder', !$('#finder-wrap').hidden);
    $$('#extras .extra').forEach((el) => { el.hidden = !el.dataset.modes.split(' ').includes(mode); });
    $('#extras').dispatchEvent(new Event('change'));
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
      const names = [];
      const seen = [];
      teamCards.forEach((c, i) => {
        const label = teamCards.length > 1 ? `${i + 1}. družstvo` : 'Družstvo';
        const t = teamTournamentOf(c);
        const name = $('[data-f="name"]', c.el).value.trim();
        if (!name) errors.push(`${label}: vyplňte název družstva.`);
        if (!$('[data-f="captain"]', c.el).value.trim()) errors.push(`${label}: vyplňte kapitána / vedoucího.`);
        if (name && names.includes(t.id + '|' + R.norm(name))) errors.push(`Družstvo „${name}“ je v přihlášce dvakrát.`);
        names.push(t.id + '|' + R.norm(name));
        const players = c.roster.getPlayers();
        const later = $('[data-f="later"]', c.el).checked;
        if (!later && players.length < (t.boards || 4)) {
          errors.push(`${name || label}: soupiska musí mít aspoň ${t.boards || 4} hráčů, nebo zaškrtněte „Soupisku doplním později“.`);
        }
        players.forEach((p) => {
          const block = R.eligibility(t, p);
          if (block) errors.push(`${p.surname} ${p.firstName}: soutěž je ${block}.`);
          const other = seen.find((sx) => sx.t === t.id && R.samePlayer(sx.p, p));
          if (other) errors.push(`${p.surname} ${p.firstName} je ve dvou družstvech (${other.name} a ${name || label}).`);
          seen.push({ t: t.id, p, name: name || label });
        });
      });
    }
    return errors;
  }

  function collectExtras() {
    return window.Extras.read(form, visibleExtras());
  }

  function collect() {
    const base = { slug: ev.slug, mode, email: form.email.value.trim(), extras: collectExtras(), web: form.web.value };
    if (mode === 'individual') {
      base.players = cards.map((c) => ({ player: c.picker.getValue(), tournaments: checkedIds(c) }));
    } else {
      base.teams = teamCards.map((c) => ({
        tournamentId: teamTournamentOf(c).id,
        name: $('[data-f="name"]', c.el).value.trim(),
        captain: $('[data-f="captain"]', c.el).value.trim(),
        rosterLater: $('[data-f="later"]', c.el).checked,
        players: c.roster.getPlayers(),
      }));
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
      what = payload.teams.map((tm) => `<p class="done-player"><strong>${esc(tm.name)}</strong> – ${esc(tName(tm.tournamentId))}<br>
        <span class="small">${tm.players.length ? tm.players.map((p, i) => `${i + 1}. ${esc(p.surname)} ${esc(p.firstName)}`).join(', ') : 'soupiska bude doplněna'}</span></p>`).join('');
    } else {
      what = payload.players.map((e) => `<p class="done-player"><strong>${esc(e.player.name)}</strong><br>
        <span class="small">${e.tournaments.map((id) => esc(tName(id))).join('<br>')}</span></p>`).join('');
    }
    const done = $('#done');
    done.innerHTML = `
      <h2>Přihláška byla odeslána ✓</h2>
      ${what}
      <p class="muted">Číslo přihlášky: <strong>${esc(res.id || '')}</strong>. Potvrzení jsme poslali na ${esc(payload.email)}.</p>
      ${res.editToken ? `<p class="small">Odhlásit se nebo změnit ubytování a další údaje půjde přes odkaz v e-mailu, nebo
        <a href="zmena.html?t=${encodeURIComponent(res.editToken)}">tady</a> (odkaz si můžete uložit).</p>` : ''}
      <p class="actions">
        <button type="button" class="primary" id="another">${payload.mode === 'team' ? 'Přihlásit další družstva' : 'Přihlásit další hráče'}</button>
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
    $('#teams').innerHTML = '';
    teamCards = [];
    if (teamTournaments().length) addTeamCard(null);
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
    teamCards.forEach((c) => { if (db) c.roster.setDB(db); else c.roster.setUnavailable(); });
    renderFinder();
  }

  function start() {
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
    form.addEventListener('input', () => { pristine = false; }, { once: true });
    applyMode();
    form.hidden = false;
  }

  let pristine = true;

  async function init() {
    if (!slug) { location.replace('./'); return; }
    loadPlayers(); // listina hráčů se stahuje souběžně s akcí
    const cached = window.Api.cacheRead('event:' + slug, 7 * 864e5);
    const fresh = window.Api.get('event', { slug }).then((r) => {
      window.Api.cacheWrite('event:' + slug, r.event);
      return r.event;
    });
    if (cached) {
      ev = cached;
      start();
      fresh.then((f) => {
        if (JSON.stringify(f) === JSON.stringify(cached)) return;
        if (pristine) { location.reload(); return; }
        const box = $('#updated');
        box.innerHTML = 'Pořadatel mezitím upravil údaje o akci. <button type="button" class="link">Načíst znovu</button>';
        box.querySelector('button').addEventListener('click', () => location.reload());
        box.hidden = false;
      }).catch((err) => {
        if (err.code === 'not_found') {
          form.hidden = true;
          $('#closed').textContent = err.message;
          $('#closed').hidden = false;
        }
      });
      return;
    }
    try {
      ev = await fresh;
    } catch (err) {
      $('#loading').hidden = true;
      $('#closed').textContent = err.message;
      $('#closed').hidden = false;
      return;
    }
    start();
  }

  init();
})();
