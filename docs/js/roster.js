/* Soupiska družstva: seřazení hráči (šachovnice + náhradníci), přidání přes našeptávač,
 * pořadí šipkami, přesun do jiného družstva, odebrání. Používá formulář i stránka změn. */
(function (global) {
  'use strict';

  const esc = global.escapeHtml;
  const R = global.Rules;
  const key = (p) => (p.id ? 'id:' + p.id : 'n:' + R.norm(p.surname + ' ' + p.firstName) + ':' + p.year);

  /**
   * @param {HTMLElement} root
   * @param {{boards:number, reserves:number, tournament?:object,
   *          moveTargets?:()=>Array<{id:string,label:string}>, onMove?:(p,id)=>void, onChange?:()=>void}} opts
   */
  function createRoster(root, opts) {
    let players = [];
    let db = null;
    let dbFailed = false;

    root.classList.add('roster');
    root.innerHTML = `
      <ol class="roster-list"></ol>
      <p class="roster-empty muted small">Soupiska je zatím prázdná.</p>
      <div class="roster-add">
        <div class="roster-picker"></div>
        <button type="button" class="button small-btn roster-add-manual" hidden>Přidat na soupisku</button>
      </div>`;
    const list = root.querySelector('.roster-list');
    const pickerBox = root.querySelector('.roster-picker');
    const manualBtn = root.querySelector('.roster-add-manual');
    const picker = global.createPicker(pickerBox, { label: 'Přidat hráče na soupisku', required: false });

    const max = () => opts.boards + opts.reserves;
    const changed = () => { render(); if (opts.onChange) opts.onChange(); };

    picker.onChange((v) => {
      // hráč vybraný z listiny se přidá hned, ručně zadaného přidá tlačítko
      if (v && v.registered) {
        if (add(v)) picker.reset();
      }
      manualBtn.hidden = !(v && !v.registered);
    });
    manualBtn.addEventListener('click', () => {
      const err = picker.validate(R.eventYear(opts.event || {}));
      if (err) { alert(err); return; }
      if (add(picker.getValue())) { picker.reset(); manualBtn.hidden = true; }
    });

    function warning(p) {
      if (!opts.tournament) return '';
      const block = R.eligibility(opts.tournament, p);
      return block ? `soutěž je ${block}` : '';
    }

    function render() {
      const targets = opts.moveTargets ? opts.moveTargets() : [];
      list.innerHTML = players.map((p, i) => {
        const reserve = i >= opts.boards;
        const warn = warning(p);
        return `<li class="roster-row${reserve ? ' reserve' : ''}${warn ? ' invalid' : ''}" data-i="${i}">
          <span class="board-no">${reserve ? 'N' + (i - opts.boards + 1) : (i + 1) + '.'}</span>
          <span class="rr-name"><strong>${esc(p.surname)} ${esc(p.firstName)}</strong>
            <span class="opt-meta">${esc([p.year, p.club, p.rn ? 'ELO ČR ' + p.rn : '', p.rf ? 'FIDE ' + p.rf : ''].filter(Boolean).join(' · '))}</span>
            ${warn ? `<span class="t-block">Nelze – ${esc(warn)}</span>` : ''}</span>
          <span class="rr-actions">
            <button type="button" class="link" data-up title="Posunout výš" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="link" data-down title="Posunout níž" ${i === players.length - 1 ? 'disabled' : ''}>↓</button>
            ${targets.length ? `<select data-move aria-label="Přesunout do družstva"><option value="">přesunout…</option>
              ${targets.map((t) => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('')}</select>` : ''}
            <button type="button" class="link danger" data-remove title="Odebrat ze soupisky">✕</button>
          </span>
        </li>`;
      }).join('');
      root.querySelector('.roster-empty').hidden = players.length > 0;
      root.querySelector('.roster-add').hidden = players.length >= max();
      list.querySelectorAll('.roster-row').forEach((li) => {
        const i = Number(li.dataset.i);
        li.querySelector('[data-up]').addEventListener('click', () => { swap(i, i - 1); });
        li.querySelector('[data-down]').addEventListener('click', () => { swap(i, i + 1); });
        li.querySelector('[data-remove]').addEventListener('click', () => { players.splice(i, 1); changed(); });
        const mv = li.querySelector('[data-move]');
        if (mv) {
          mv.addEventListener('change', () => {
            if (!mv.value) return;
            const p = players[i];
            players.splice(i, 1);
            changed();
            opts.onMove(p, mv.value);
          });
        }
      });
    }

    function swap(i, j) {
      if (j < 0 || j >= players.length) return;
      [players[i], players[j]] = [players[j], players[i]];
      changed();
    }

    /** Přidá hráče na konec soupisky. Vrací false, když je plná nebo hráč už na ní je. */
    function add(p) {
      if (players.length >= max()) {
        alert(`Soupiska je plná (${R.teamSize(opts)}).`);
        return false;
      }
      if (players.some((q) => key(q) === key(p))) return false;
      players.push(p);
      changed();
      return true;
    }

    render();
    return {
      add,
      has: (p) => players.some((q) => key(q) === key(p)),
      getPlayers: () => players.slice(),
      setPlayers(list2) { players = list2.slice(); render(); },
      setLimits(boards, reserves, tournament) {
        opts.boards = boards; opts.reserves = reserves; opts.tournament = tournament;
        if (players.length > max()) players = players.slice(0, max());
        render();
      },
      refresh: render,
      free: () => max() - players.length,
      setDB(d) { db = d; picker.setDB(d); },
      setUnavailable() { dbFailed = true; picker.setUnavailable(); },
      keys: () => players.map(key),
      get hasDB() { return !!db || dbFailed; },
    };
  }

  global.createRoster = createRoster;
  global.playerKey = key;
})(window);
