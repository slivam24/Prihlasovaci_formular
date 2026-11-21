/* Změna přihlášky přes odkaz z potvrzovacího e-mailu – zmena.html?t=<token>.
 * Odhlášení hráčů z turnajů, vrácení odhlášky, změna doplňujících údajů (ubytování, obědy…). */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = window.escapeHtml;
  const R = window.Rules;
  const token = window.Api.param('t') || '';
  const form = $('#form');
  let data = null;

  function showNotice(text) {
    const n = $('#notice');
    n.textContent = text;
    n.hidden = false;
  }

  function extraField(x, value) {
    const name = 'x_' + x.id;
    const help = x.help ? `<span class="hint">${esc(x.help)}</span>` : '';
    if (x.type === 'checkboxes') {
      const vals = Array.isArray(value) ? value : [];
      return `<fieldset class="extra"><legend>${esc(x.label)}</legend>${help}
        ${(x.options || []).map((o) => `<label class="check"><input type="checkbox" name="${esc(name)}" value="${esc(o)}" ${vals.includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('')}
      </fieldset>`;
    }
    if (x.type === 'select') {
      return `<label class="block extra">${esc(x.label)}
        <select name="${esc(name)}"><option value="">—</option>
          ${(x.options || []).map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>${help}
      </label>`;
    }
    if (x.type === 'text') {
      return `<label class="block extra">${esc(x.label)}<input name="${esc(name)}" maxlength="500" value="${esc(value || '')}">${help}</label>`;
    }
    return `<label class="block extra">${esc(x.label)}<textarea name="${esc(name)}" rows="3" maxlength="2000">${esc(value || '')}</textarea>${help}</label>`;
  }

  function render() {
    const ev = data.event;
    const app = data.application;
    document.title = 'Změna přihlášky – ' + ev.name;
    $('#event-name').textContent = ev.name;
    $('#event-meta').textContent = [R.formatRange(ev.dateFrom, ev.dateTo), ev.place].filter(Boolean).join(' · ');
    $('#app-meta').textContent = `Přihláška č. ${app.id} · ${app.email}` + (app.team ? ` · družstvo ${app.team}` : '');
    $('#list-link').href = 'seznam.html?akce=' + encodeURIComponent(ev.slug);

    const editable = data.canEdit;
    if (!editable) {
      showNotice('Změny už nejde provést online.' + (ev.contactEmail ? ` Kontaktujte prosím pořadatele: ${ev.contactEmail}.` : ' Kontaktujte prosím pořadatele.'));
    } else {
      $('#notice').hidden = true;
    }

    // hráči a turnaje
    if (app.mode === 'team') {
      const active = app.entries.filter((e) => !e.cancelled);
      const cancelled = !active.length;
      $('#entries-hint').textContent = 'Družstvo lze odhlásit jen celé.';
      $('#entries').innerHTML = `
        <p><strong>${esc(app.team)}</strong> <span class="muted small">kapitán: ${esc(app.captain)} · ${esc(app.entries[0] ? app.entries[0].tournament : '')}</span></p>
        <ul class="entry-list">${app.entries.map((e) => `<li>${e.board ? esc(e.board) + '. ' : ''}${esc(e.name)} <span class="muted small">${esc(e.year || '')}</span></li>`).join('')}</ul>
        ${cancelled
          ? `<p class="badge danger-badge">družstvo je odhlášené</p>
             ${editable && data.canRestore ? '<label class="check"><input type="checkbox" id="restore-team"> vrátit přihlášku družstva</label>' : ''}`
          : editable ? '<label class="check danger-check"><input type="checkbox" id="cancel-team"> odhlásit celé družstvo</label>' : ''}`;
    } else {
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
            : `<div class="entry-row"><span>${esc(e.tournament)}</span>
                ${editable ? `<label class="check danger-check"><input type="checkbox" data-cancel="${esc(e.id)}"> odhlásit</label>` : '<span class="badge">přihlášen</span>'}</div>`).join('')}
        </div>`;
      }).join('') + (editable && app.entries.filter((e) => !e.cancelled).length > 1
        ? '<p><button type="button" class="link danger" id="cancel-all">Označit všechny k odhlášení</button></p>' : '');
      const all = $('#cancel-all');
      if (all) all.addEventListener('click', () => $$('[data-cancel]').forEach((i) => { i.checked = true; }));
    }

    // doplňující údaje
    const extras = (ev.extras || []).filter((x) => (x.modes || ['individual', 'team']).includes(app.mode));
    $('#extras-card').hidden = !extras.length;
    $('#extras').innerHTML = extras.map((x) => extraField(x, app.extras[x.id])).join('');
    if (!editable) $$('#extras input, #extras select, #extras textarea').forEach((el) => { el.disabled = true; });

    $('#submit').hidden = !editable;
    form.hidden = false;
  }

  function collect() {
    const app = data.application;
    const changes = { cancel: [], restore: [], extras: {} };
    if (app.mode === 'team') {
      if ($('#cancel-team') && $('#cancel-team').checked) changes.cancel = app.entries.filter((e) => !e.cancelled).map((e) => e.id);
      if ($('#restore-team') && $('#restore-team').checked) changes.restore = app.entries.filter((e) => e.cancelled).map((e) => e.id);
    } else {
      changes.cancel = $$('[data-cancel]:checked').map((i) => i.dataset.cancel);
      changes.restore = $$('[data-restore]:checked').map((i) => i.dataset.restore);
    }
    (data.event.extras || []).filter((x) => (x.modes || ['individual', 'team']).includes(app.mode)).forEach((x) => {
      const name = 'x_' + x.id;
      if (x.type === 'checkboxes') changes.extras[x.id] = $$(`[name="${name}"]:checked`, form).map((i) => i.value);
      else changes.extras[x.id] = (form.querySelector(`[name="${name}"]`).value || '').trim();
    });
    return changes;
  }

  async function onSubmit(e) {
    e.preventDefault();
    $('#errors').hidden = true;
    const changes = collect();
    if (changes.cancel.length) {
      const names = data.application.entries.filter((x) => changes.cancel.includes(x.id)).map((x) => `${x.name} – ${x.tournament}`);
      if (!confirm('Opravdu odhlásit?\n\n' + names.join('\n'))) return;
    }
    const btn = $('#submit');
    btn.disabled = true;
    btn.textContent = 'Ukládám…';
    try {
      data = await window.Api.post('updateApplication', { token, changes });
      const saved = $('#saved');
      saved.innerHTML = `<strong>Změny jsou uložené ✓</strong><ul>${(data.saved || []).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        <p class="small muted">Potvrzení jsme poslali na ${esc(data.application.email)}.</p>`;
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
      data = await window.Api.get('application', { token });
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
