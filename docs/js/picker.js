/* Výběr hráče: našeptávač z LOK + ruční zadání pro hráče, kteří v listině nejsou. */
(function (global) {
  'use strict';

  let uid = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function ratingText(p) {
    const parts = [];
    parts.push(p.rn ? 'ELO ČR ' + p.rn : 'bez ELO ČR');
    if (p.rf) parts.push('FIDE ' + p.rf);
    if (p.rnr || p.rfr) parts.push('rapid ' + [p.rnr || '–', p.rfr ? 'FIDE ' + p.rfr : ''].filter(Boolean).join(' / '));
    return parts.join(' · ');
  }

  function playerLine(p) {
    return [p.year || '', p.club, ratingText(p)].filter(Boolean).join(' · ');
  }

  /**
   * @param {HTMLElement} root
   * @param {{label: string, required?: boolean, hint?: string}} opts
   */
  function createPicker(root, opts) {
    const id = 'pk' + (++uid);
    const required = opts.required !== false;
    let db = null;
    let selected = null;
    let results = [];
    let active = -1;
    let timer = null;
    const listeners = [];

    root.classList.add('picker');
    root.innerHTML = `
      <div class="field-label" id="${id}-label">${esc(opts.label)}${required ? ' <span class="req">*</span>' : ''}</div>
      <div class="search-wrap">
        <input id="${id}-q" class="search" type="text" autocomplete="off" spellcheck="false"
          placeholder="Načítám seznam hráčů…" disabled
          role="combobox" aria-labelledby="${id}-label" aria-expanded="false"
          aria-controls="${id}-list" aria-autocomplete="list">
        <ul id="${id}-list" class="suggestions" role="listbox" hidden></ul>
      </div>
      <div class="picked" hidden></div>
      <label class="check manual-check">
        <input type="checkbox" class="manual-toggle">
        Nejsem v seznamu LOK (neregistrovaný nebo zahraniční hráč)
      </label>
      <div class="manual grid" hidden>
        <label>Jméno <span class="req">*</span><input name="firstName" autocomplete="given-name"></label>
        <label>Příjmení <span class="req">*</span><input name="surname" autocomplete="family-name"></label>
        <label>Rok narození <span class="req">*</span><input name="year" inputmode="numeric" maxlength="4" placeholder="např. 2012"></label>
        <label>Pohlaví
          <select name="sex"><option value="">muž</option><option value="F">žena</option></select>
        </label>
        <label class="wide">Klub, nebo u neregistrovaných město <span class="req">*</span><input name="club"></label>
        <label>Federace<input name="fed" value="CZE" maxlength="3"></label>
        <label>FIDE ID <span class="muted">(nepovinné)</span><input name="fide" inputmode="numeric"></label>
      </div>`;

    const input = root.querySelector('.search');
    const list = root.querySelector('.suggestions');
    const wrap = root.querySelector('.search-wrap');
    const picked = root.querySelector('.picked');
    const toggle = root.querySelector('.manual-toggle');
    const manual = root.querySelector('.manual');
    const field = (name) => manual.querySelector(`[name="${name}"]`);

    function emit() { listeners.forEach((fn) => fn(getValue())); }

    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    }

    function render() {
      const q = input.value.trim();
      if (!db || q.length < 2) { close(); return; }
      results = db.search(q, 8);
      active = results.length ? 0 : -1;
      if (!results.length) {
        list.innerHTML = '<li class="empty">Nikoho jsme nenašli. Zkontrolujte jméno, nebo zaškrtněte „Nejsem v seznamu LOK“.</li>';
      } else {
        list.innerHTML = results.map((p, i) => `
          <li id="${id}-o${i}" role="option" data-i="${i}" aria-selected="${i === active}">
            <span class="opt-name">${esc(p.name)}${p.title ? ` <span class="badge">${esc(p.title)}</span>` : ''}</span>
            <span class="opt-meta">${esc(playerLine(p))}</span>
          </li>`).join('');
      }
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      highlight();
    }

    function highlight() {
      list.querySelectorAll('[role="option"]').forEach((li) => {
        const on = Number(li.dataset.i) === active;
        li.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) {
          input.setAttribute('aria-activedescendant', li.id);
          li.scrollIntoView({ block: 'nearest' });
        }
      });
    }

    function select(p) {
      selected = p;
      close();
      wrap.hidden = true;
      root.querySelector('.manual-check').hidden = true;
      picked.hidden = false;
      picked.innerHTML = `
        <div class="picked-main">
          <strong>${esc(p.name)}</strong>${p.title ? ` <span class="badge">${esc(p.title)}</span>` : ''}
          <div class="opt-meta">${esc(playerLine(p))}${p.id ? ' · ID ČR ' + esc(p.id) : ''}${p.fide ? ' · FIDE ID ' + esc(p.fide) : ''}</div>
        </div>
        <button type="button" class="link change">Změnit</button>`;
      picked.querySelector('.change').addEventListener('click', () => {
        clearSelection();
        input.focus();
      });
      emit();
    }

    function clearSelection() {
      selected = null;
      picked.hidden = true;
      wrap.hidden = false;
      root.querySelector('.manual-check').hidden = false;
      input.value = '';
      emit();
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(render, 60);
    });
    input.addEventListener('keydown', (e) => {
      if (list.hidden) {
        if (e.key === 'ArrowDown') render();
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (results.length) { active = (active + 1) % results.length; highlight(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (results.length) { active = (active - 1 + results.length) % results.length; highlight(); } }
      else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) select(results[active]); }
      else if (e.key === 'Escape') { close(); }
    });
    input.addEventListener('blur', () => setTimeout(close, 150));
    list.addEventListener('mousedown', (e) => {
      const li = e.target.closest('[role="option"]');
      if (!li) return;
      e.preventDefault();
      select(results[Number(li.dataset.i)]);
    });

    toggle.addEventListener('change', () => {
      manual.hidden = !toggle.checked;
      wrap.hidden = toggle.checked;
      if (toggle.checked) {
        // co hráč napsal do vyhledávání, předvyplníme
        const parts = global.Players.splitName(input.value);
        if (parts.surname && !field('surname').value) field('surname').value = parts.surname;
        if (parts.firstName && !field('firstName').value) field('firstName').value = parts.firstName;
        close();
        field('firstName').focus();
      }
      emit();
    });
    manual.addEventListener('input', emit);

    function getValue() {
      if (selected) return Object.assign({}, selected);
      if (!toggle.checked) return null;
      const year = parseInt(field('year').value, 10) || 0;
      return {
        registered: false,
        id: 0,
        name: (field('surname').value.trim() + ' ' + field('firstName').value.trim()).trim(),
        surname: field('surname').value.trim(),
        firstName: field('firstName').value.trim(),
        year: year,
        sex: field('sex').value,
        rn: 0,
        rf: 0,
        title: '',
        fide: parseInt(field('fide').value, 10) || 0,
        fed: (field('fed').value.trim() || 'CZE').toUpperCase(),
        clubNo: 0,
        club: field('club').value.trim(),
        status: '',
      };
    }

    function validate(festivalYear) {
      const v = getValue();
      if (!v) return `${opts.label}: vyberte hráče ze seznamu, nebo zaškrtněte „Nejsem v seznamu LOK“ a vyplňte údaje.`;
      if (v.registered) return '';
      if (!v.firstName || !v.surname) return `${opts.label}: vyplňte jméno a příjmení.`;
      if (!(v.year >= 1900 && v.year <= festivalYear)) return `${opts.label}: vyplňte platný rok narození (čtyři číslice).`;
      if (!v.club) return `${opts.label}: vyplňte klub, nebo u neregistrovaných město.`;
      return '';
    }

    return {
      setDB(newDb) {
        db = newDb;
        input.disabled = false;
        input.placeholder = 'Začněte psát příjmení, např. „novák jan“, nebo ID ČR';
      },
      setUnavailable() {
        input.placeholder = 'Seznam hráčů se nepodařilo načíst – zadejte údaje ručně';
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));
      },
      getValue,
      validate,
      /** Vybere hráče z listiny (hromadné přidání z filtru). */
      setPlayer(p) {
        toggle.checked = false;
        manual.hidden = true;
        select(p);
      },
      setLabel(label) {
        opts.label = label;
        root.querySelector('.field-label').innerHTML = esc(label) + (required ? ' <span class="req">*</span>' : '');
      },
      isEmpty() { return !selected && !toggle.checked; },
      onChange(fn) { listeners.push(fn); },
      reset() {
        toggle.checked = false;
        manual.hidden = true;
        manual.querySelectorAll('input').forEach((i) => { i.value = i.name === 'fed' ? 'CZE' : ''; });
        field('sex').value = '';
        clearSelection();
      },
      focus() { (wrap.hidden ? field('firstName') : input).focus(); },
    };
  }

  global.createPicker = createPicker;
  global.escapeHtml = esc;
})(window);
