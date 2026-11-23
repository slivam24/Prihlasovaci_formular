/* Administrace: akce, turnaje, přihlášky, export pro Swiss-Manager, správci. */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = window.escapeHtml;
  const R = window.Rules;
  const app = $('#app');
  const dialog = $('#dialog');
  const TOKEN_KEY = 'adminIdToken';

  let cfg = {};
  // Data už jednou načtená v této záložce: stránka se ukáže hned a na pozadí se obnoví.
  const memo = { events: null, event: {} };
  let pendingImport = null; // akce načtená z importu, čeká na otevření v editoru
  let me = null;
  let playerDb = null;

  // =====================================================================
  // Přihlášení (Google) a volání API
  // =====================================================================

  function tokenPayload(t) {
    try {
      return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch (e) {
      return null;
    }
  }

  function getToken() {
    let t = null;
    try { t = localStorage.getItem(TOKEN_KEY); } catch (e) { /* soukromé okno */ }
    if (!t) return null;
    const p = tokenPayload(t);
    if (!p || p.exp * 1000 < Date.now() + 30000) {
      clearToken();
      return null;
    }
    return t;
  }

  function setToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* nic */ } }
  function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* nic */ } }

  async function call(action, body) {
    const idToken = getToken();
    if (!idToken) {
      showLogin();
      throw new Error('Přihlaste se prosím.');
    }
    try {
      return await window.Api.post('admin.' + action, Object.assign({ idToken }, body || {}));
    } catch (e) {
      if (e.code === 'auth' || (e.code === 'forbidden' && (action === 'events' || action === 'me'))) {
        clearToken();
        showLogin(e.message);
      }
      throw e;
    }
  }

  function waitForGsi() {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function poll() {
        if (window.google && window.google.accounts && window.google.accounts.id) resolve();
        else if (Date.now() - start > 10000) reject(new Error('Nepodařilo se načíst přihlášení Google.'));
        else setTimeout(poll, 100);
      })();
    });
  }

  function showLogin(message) {
    me = null;
    updateBar();
    app.innerHTML = `<div class="card login">
      <h1>Správa turnajů</h1>
      ${message ? `<p class="errors">${esc(message)}</p>` : ''}
      <p>Přihlaste se Google účtem, který vám správce přidal do administrace.</p>
      <div id="gsi-btn"></div>
    </div>`;
    if (cfg.devLogin) {
      // jen pro lokální vývojový server (tests/dev-server.js) – skutečný backend takový token odmítne
      $('#gsi-btn').innerHTML = `<form class="actions" id="dev-login">
        <input name="email" type="email" value="owner@example.cz" aria-label="E-mail">
        <button class="primary">Přihlásit (vývoj)</button></form>`;
      $('#dev-login').addEventListener('submit', (e) => {
        e.preventDefault();
        const payload = { email: e.target.email.value, aud: cfg.googleClientId, exp: Math.floor(Date.now() / 1000) + 3600 };
        setToken('fake.' + btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.sig');
        route();
      });
      return;
    }
    if (!cfg.googleClientId) {
      $('#gsi-btn').innerHTML = '<p class="errors">V config.json chybí googleClientId – viz README.</p>';
      return;
    }
    waitForGsi().then(() => {
      window.google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        callback: (resp) => { setToken(resp.credential); route(); },
      });
      window.google.accounts.id.renderButton($('#gsi-btn'), { theme: 'outline', size: 'large', locale: 'cs' });
    }).catch((e) => { $('#gsi-btn').textContent = e.message; });
  }

  function updateBar() {
    $('#nav').hidden = !me;
    $('#nav-users').hidden = !me || me.role !== 'superadmin';
    $('#who').textContent = me ? me.email : '';
    $('#logout').hidden = !me;
  }

  $('#logout').addEventListener('click', () => {
    clearToken();
    if (window.google && window.google.accounts) window.google.accounts.id.disableAutoSelect();
    showLogin('Byli jste odhlášeni.');
  });

  // =====================================================================
  // Pomocné funkce
  // =====================================================================

  function statusBadge(s) {
    return `<span class="status status-${esc(s)}">${esc(R.STATUS_LABELS[s] || s)}</span>`;
  }

  /** Upozornění na denní limit e-mailů, frontu a vypnuté zálohy. */
  function systemNotice(sys) {
    if (!sys) return '';
    const out = [];
    const m = sys.mail || {};
    if (m.queued) {
      out.push(`<p class="notice-inline">${R.plural(m.queued, 'e-mail čeká', 'e-maily čekají', 'e-mailů čeká')} na odeslání – denní limit
        Google účtu je vyčerpaný. Odešlou se automaticky, jakmile se limit obnoví (do 24 hodin)${sys.jobs === false ? ', <strong>ale nejdřív je potřeba zapnout automatické odesílání</strong> (viz níže)' : ''}.
        Přihlášky se ukládají normálně.</p>`);
    } else if (m.provider === 'gmail' && m.remaining != null && m.remaining < 20) {
      out.push(`<p class="notice-inline">Dnes lze odeslat už jen ${R.plural(m.remaining, 'e-mail', 'e-maily', 'e-mailů')}
        (limit Google účtu je 100 denně). Další potvrzení se uloží a odešlou později automaticky.</p>`);
    }
    if (sys.jobs === false) {
      out.push(`<p class="notice-inline">Automatické zálohy a odesílání čekajících e-mailů nejsou zapnuté. V tabulce s daty
        spusťte menu <strong>Turnaje → Zapnout zálohy a frontu e-mailů</strong> a potvrďte oprávnění.</p>`);
    }
    return out.join('');
  }

  function errorBox(e) {
    return `<div class="errors" role="alert">${esc(e.message || e)}</div>`;
  }

  function loading(text) {
    app.innerHTML = `<p class="muted">${esc(text || 'Načítám…')}</p>`;
  }

  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  let xlsxPromise = null;
  function loadXlsx() {
    if (!xlsxPromise) {
      xlsxPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
        s.onload = () => resolve(window.XLSX);
        s.onerror = () => { xlsxPromise = null; reject(new Error('Knihovnu pro Excel se nepodařilo načíst.')); };
        document.head.appendChild(s);
      });
    }
    return xlsxPromise;
  }

  async function downloadXlsx(name, sheets) {
    const XLSX = await loadXlsx();
    const wb = XLSX.utils.book_new();
    sheets.forEach((s) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name.slice(0, 31)));
    XLSX.writeFile(wb, name);
  }

  function fileSafe(s) {
    return R.norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
  }

  function openDialog(html, onReady) {
    dialog.innerHTML = html;
    dialog.showModal();
    $$('[data-close]', dialog).forEach((b) => b.addEventListener('click', () => dialog.close()));
    if (onReady) onReady(dialog);
  }

  async function getPlayerDb() {
    if (!playerDb) {
      const res = await fetch('data/players.json');
      if (!res.ok) throw new Error('Seznam hráčů se nepodařilo načíst.');
      playerDb = new window.Players.PlayerDB(await res.json());
    }
    return playerDb;
  }

  // =====================================================================
  // Přehled akcí
  // =====================================================================

  async function viewEvents() {
    const here = location.hash || '#/';
    if (memo.events) renderEvents(memo.events);
    else loading('Načítám akce…');
    const data = await call('events');
    const changed = !memo.events || JSON.stringify(data.events) !== JSON.stringify(memo.events.events);
    memo.events = data;
    if (changed && (location.hash || '#/') === here && !dialog.open) renderEvents(data);
  }

  function renderEvents(data) {
    me = data.user;
    updateBar();
    const rows = data.events.map((ev) => `<tr>
      <td><a href="#/akce/${esc(ev.id)}"><strong>${esc(ev.name)}</strong></a>
        <div class="small muted">${esc(ev.tournaments.map((t) => `${t.short || t.name} (${t.count})`).join(' · '))}</div></td>
      <td>${esc(R.formatRange(ev.dateFrom, ev.dateTo))}</td>
      <td>${statusBadge(ev.status)}</td>
      <td class="num">${ev.registrations}</td>
      <td class="row-actions">
        <a href="#/akce/${esc(ev.id)}">Přihlášky</a>
        <a href="#/akce/${esc(ev.id)}/upravit">Upravit</a>
        <button type="button" class="link" data-copy="${esc(ev.id)}">Kopírovat</button>
        ${ev.registrations ? '' : `<button type="button" class="link danger" data-delete="${esc(ev.id)}">Smazat</button>`}
      </td>
    </tr>`).join('');
    app.innerHTML = `
      <div class="page-head">
        <h1>Akce</h1>
        <div class="actions">
          <button type="button" class="button" id="import-event">Importovat z propozic (AI)</button>
          <a class="button primary" href="#/akce/nova">+ Nová akce</a>
        </div>
      </div>
      ${systemNotice(data.system)}
      ${data.events.length ? `<div class="card table-wrap"><table class="admin-table">
        <thead><tr><th>Akce</th><th>Termín</th><th>Stav</th><th>Přihlášek</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
        : '<div class="card"><p>Zatím tu nejsou žádné akce. Začněte tlačítkem „Nová akce“.</p></div>'}`;

    $('#import-event').addEventListener('click', importDialog);
    $$('[data-copy]').forEach((b) => b.addEventListener('click', () => copyEventDialog(data.events.find((e) => e.id === b.dataset.copy))));
    $$('[data-delete]').forEach((b) => b.addEventListener('click', async () => {
      const ev = data.events.find((e) => e.id === b.dataset.delete);
      if (!confirm(`Opravdu smazat akci „${ev.name}“?`)) return;
      try {
        await call('deleteEvent', { id: ev.id });
        viewEvents();
      } catch (e) { alert(e.message); }
    }));
  }

  function importDialog() {
    const EI = window.EventImport;
    openDialog(`<form class="dialog-form import-form" novalidate>
      <h2>Import akce z propozic</h2>
      <ol class="steps">
        <li>Zkopírujte zadání a vložte ho do ChatGPT, Clauda nebo jiné AI. Přiložte propozice (PDF, nebo jejich text).
          <p class="actions"><button type="button" class="button" id="copy-prompt">Zkopírovat zadání pro AI</button>
          <span class="small muted" id="copy-state"></span></p>
          <details><summary class="small">Zobrazit zadání</summary><textarea id="prompt-text" rows="8" readonly>${esc(EI.PROMPT)}</textarea></details>
        </li>
        <li>Odpověď AI (JSON) vložte sem:
          <textarea name="json" rows="10" placeholder='{ "name": "…", "dateFrom": "…", "tournaments": [ … ] }' spellcheck="false"></textarea>
        </li>
        <li>Akce se otevře v editoru. <strong>Zkontrolujete údaje</strong> a teprve pak ji uložíte.</li>
      </ol>
      <div class="errors" hidden></div>
      <p class="actions"><button class="primary">Načíst do editoru</button><button type="button" data-close>Zrušit</button></p>
    </form>`, (d) => {
      $('#copy-prompt', d).addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(EI.PROMPT);
        } catch (e) {
          const ta = $('#prompt-text', d);
          ta.closest('details').open = true;
          ta.select();
          document.execCommand('copy');
        }
        $('#copy-state', d).textContent = 'Zkopírováno ✓';
      });
      $('form', d).addEventListener('submit', (e) => {
        e.preventDefault();
        const box = $('.errors', d);
        try {
          pendingImport = EI.parseImport(e.target.json.value);
        } catch (err) {
          box.textContent = err.message;
          box.hidden = false;
          return;
        }
        dialog.close();
        if (location.hash === '#/akce/nova') route();
        else location.hash = '#/akce/nova';
      });
    });
  }

  function copyEventDialog(ev) {
    const addDays = (iso, n) => {
      const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n));
      return d.toISOString().slice(0, 10);
    };
    const daysBetween = (x, y) => Math.round((Date.parse(y + 'T00:00:00Z') - Date.parse(x + 'T00:00:00Z')) / 864e5);
    const nextName = ev.name.replace(/\b(20\d\d)\b/, (y) => String(+y + 1));
    // stejný den v týdnu o rok později (52 týdnů)
    const nextFrom = ev.dateFrom ? addDays(ev.dateFrom, 364) : '';
    const hasYears = (ev.tournaments || []).some((t) => t.minBirthYear || t.maxBirthYear);
    openDialog(`<form method="dialog" class="dialog-form">
      <h2>Kopírovat akci</h2>
      <p class="muted small">Zkopíruje se vše kromě přihlášek: turnaje, ročníky, doplňující otázky s cenami, texty a správci.
        Kopie bude rozpracovaná a hned se otevře k úpravám.</p>
      <label class="block">Název nové akce<input name="name" value="${esc(nextName)}"></label>
      <label class="block">Začátek nové akce<input type="date" name="dateFrom" value="${esc(nextFrom)}">
        <span class="hint" id="copy-preview"></span></label>
      ${hasYears ? '<label class="check"><input type="checkbox" name="shiftBirthYears" checked> posunout ročníky u turnajů podle roku akce</label>' : ''}
      <div class="errors" hidden></div>
      <p class="actions"><button class="primary" value="ok">Kopírovat a upravit</button><button type="button" data-close>Zrušit</button></p>
    </form>`, (d) => {
      const f = $('form', d);
      const preview = () => {
        const from = f.dateFrom.value;
        if (!from || !ev.dateFrom) { $('#copy-preview', d).textContent = ''; return; }
        const n = daysBetween(ev.dateFrom, from);
        const parts = [`posun o ${n} dní`];
        if (ev.dateTo) parts.push('konec ' + R.formatDate(addDays(ev.dateTo, n)));
        if (ev.deadline) parts.push('uzávěrka ' + R.formatDate(addDays(ev.deadline, n)));
        const years = +from.slice(0, 4) - +ev.dateFrom.slice(0, 4);
        if (hasYears && years && f.shiftBirthYears && f.shiftBirthYears.checked) parts.push(`ročníky o ${years > 0 ? '+' : ''}${years}`);
        $('#copy-preview', d).textContent = parts.join(' · ');
      };
      f.addEventListener('input', preview);
      f.addEventListener('change', preview);
      preview();
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const res = await call('copyEvent', {
            id: ev.id, name: f.name.value, dateFrom: f.dateFrom.value,
            shiftBirthYears: f.shiftBirthYears ? f.shiftBirthYears.checked : true,
          });
          dialog.close();
          location.hash = `#/akce/${res.event.id}/upravit`;
        } catch (err) {
          const box = $('.errors', d);
          box.textContent = err.message;
          box.hidden = false;
        }
      });
    });
  }

  // =====================================================================
  // Editor akce
  // =====================================================================

  const TYPE_LABELS = { individual: 'jednotlivci', team: 'družstva' };
  const EXTRA_TYPE_LABELS = {
    checkboxes: 'zaškrtávací políčka (více možností)',
    select: 'výběr jedné možnosti',
    quantity: 'počet kusů s cenou (obědy, lůžka…)',
    text: 'krátký text',
    textarea: 'delší text',
  };

  function options(map, selected) {
    return Object.keys(map).map((k) => `<option value="${esc(k)}"${k === selected ? ' selected' : ''}>${esc(map[k])}</option>`).join('');
  }

  function numInput(field, label, value, hint) {
    return `<label>${esc(label)}<input data-f="${field}" type="number" inputmode="numeric" value="${value == null ? '' : esc(value)}">${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</label>`;
  }

  function tourCard(t) {
    t = t || { type: 'individual' };
    return `<div class="sub-card tour-card" data-id="${esc(t.id || '')}">
      <div class="sub-card-head">
        <strong class="tour-title">${esc(t.name || 'Nový turnaj')}</strong>
        <span class="spacer"></span>
        <button type="button" class="link" data-move="-1" title="Posunout nahoru">↑</button>
        <button type="button" class="link" data-move="1" title="Posunout dolů">↓</button>
        <button type="button" class="link danger" data-remove>Odebrat</button>
      </div>
      <div class="grid grid-3">
        <label class="wide">Název turnaje <span class="req">*</span><input data-f="name" value="${esc(t.name || '')}" placeholder="např. Open rapid – Grand Prix ČR"></label>
        <label>Krátký název<input data-f="short" value="${esc(t.short || '')}" placeholder="např. Rapid"><span class="hint">do přehledů a exportů</span></label>
        <label>Den<input data-f="day" value="${esc(t.day || '')}" placeholder="např. sobota"></label>
        <label>Typ<select data-f="type">${options(TYPE_LABELS, t.type)}</select></label>
        <label>Rating<select data-f="rating">${options(R.RATING_LABELS, t.rating || 'standard')}</select>
          <span class="hint">ELO ČR a FIDE pro nasazení, export a slevy</span></label>
        ${numInput('minBirthYear', 'Jen ročník … a mladší', t.minBirthYear, 'vynucuje se')}
        ${numInput('maxBirthYear', 'Jen ročník … a starší', t.maxBirthYear, 'vynucuje se')}
        ${numInput('warnMaxRating', 'Upozornit nad ELO', t.warnMaxRating, 'jen upozornění')}
        ${numInput('capacity', 'Kapacita', t.capacity, 'hráčů / družstev, prázdné = bez omezení')}
        <span class="team-only">${numInput('boards', 'Počet šachovnic', t.boards || 4)}</span>
        <span class="team-only">${numInput('reserves', 'Počet náhradníků', t.reserves || 0)}</span>
        ${numInput('fee', 'Startovné (Kč)', t.fee, 'u družstev za celé družstvo; prázdné = neuvádět')}
      </div>
      <div class="fee-rules-box individual-only">
        <div class="small"><strong>Slevy ze startovného</strong> <span class="muted">– platí nejnižší cena, kterou hráč splní</span></div>
        <div class="fee-rules">${(t.feeRules || []).map(feeRuleRow).join('')}</div>
        <button type="button" class="link" data-add-rule>+ přidat slevu</button>
      </div>
    </div>`;
  }

  function feeRuleRow(r) {
    r = r || { type: 'women', value: '', price: '' };
    return `<div class="fee-rule">
      <select data-r="type">${options(R.FEE_RULE_TYPES, r.type)}</select>
      <input data-r="value" value="${esc(r.value == null ? '' : r.value)}" placeholder="${r.type === 'titles' ? 'GM, IM' : 'hodnota'}">
      <label class="inline">cena <input data-r="price" type="number" min="0" value="${r.price == null ? '' : esc(r.price)}"> Kč</label>
      <button type="button" class="link danger" data-del-rule title="Odebrat slevu">✕</button>
    </div>`;
  }

  function bindFeeRule(row) {
    const type = $('[data-r="type"]', row);
    const value = $('[data-r="value"]', row);
    const sync = () => {
      value.hidden = type.value === 'women';
      value.placeholder = { youth: 'např. 2008', senior: 'např. 1961', titles: 'např. GM, IM, WGM', rating: 'např. 2300' }[type.value] || '';
      value.inputMode = type.value === 'titles' ? 'text' : 'numeric';
    };
    type.addEventListener('change', sync);
    sync();
    $('[data-del-rule]', row).addEventListener('click', () => row.remove());
  }

  // Předvolby pro editor akce – pořadatel jen upraví názvy, ceny a termíny.
  const EXTRA_PRESETS = {
    meals: {
      type: 'quantity', label: 'Obědy', unit: 'porce',
      options: ['sobota – oběd', 'neděle – oběd'], prices: [130, 130],
      help: 'Počet porcí pro celou přihlášku (u výpravy za všechny dohromady).', modes: ['individual', 'team'],
    },
    lodging: {
      type: 'quantity', label: 'Ubytování', unit: 'lůžko',
      options: ['pátek–sobota, 2lůžkový pokoj', 'pátek–sobota, 1lůžkový pokoj', 'sobota–neděle, 2lůžkový pokoj', 'sobota–neděle, 1lůžkový pokoj'],
      prices: [450, 600, 450, 600],
      help: 'Počet lůžek za noc pro celou přihlášku. Se kým chcete být na pokoji, napište do poznámky.', modes: ['individual', 'team'],
    },
  };

  function optionsText(x) {
    return (x.options || []).map((o, i) => {
      const p = x.prices && x.prices[i];
      return typeof p === 'number' ? `${o} | ${p}` : o;
    }).join('\n');
  }

  function parseOptionsText(text) {
    const options = [];
    const prices = [];
    text.split('\n').map((l) => l.trim()).filter(Boolean).forEach((l) => {
      const m = l.match(/^(.*?)\s*\|\s*([\d\s]+(?:[.,]\d+)?)\s*(?:kč)?\s*$/i);
      if (m) {
        options.push(m[1].trim());
        prices.push(parseFloat(m[2].replace(/\s/g, '').replace(',', '.')));
      } else {
        options.push(l);
        prices.push(null);
      }
    });
    return { options, prices };
  }

  function extraCard(x) {
    x = x || { type: 'checkboxes', modes: ['individual', 'team'] };
    const modes = (x.modes || []).length === 1 ? x.modes[0] : 'both';
    return `<div class="sub-card extra-card" data-id="${esc(x.id || '')}">
      <div class="sub-card-head">
        <strong>${esc(x.label || 'Nová otázka')}</strong>
        <span class="spacer"></span>
        <button type="button" class="link" data-move="-1">↑</button>
        <button type="button" class="link" data-move="1">↓</button>
        <button type="button" class="link danger" data-remove>Odebrat</button>
      </div>
      <div class="grid">
        <label class="wide">Otázka <span class="req">*</span><input data-f="label" value="${esc(x.label || '')}" placeholder="např. Ubytování"></label>
        <label>Typ odpovědi<select data-f="type">${options(EXTRA_TYPE_LABELS, x.type)}</select></label>
        <label>Zobrazit u<select data-f="modes">${options({ both: 'jednotlivců i družstev', individual: 'jen jednotlivců', team: 'jen družstev' }, modes)}</select></label>
        <label class="wide">Nápověda<input data-f="help" value="${esc(x.help || '')}" placeholder="nepovinné vysvětlení pod otázkou"></label>
        <label class="wide options-field">Možnosti – každá na nový řádek, cena za svislou čarou (nepovinné)
          <textarea data-f="options" rows="4" placeholder="sobota – oběd | 130&#10;neděle – oběd | 130">${esc(optionsText(x))}</textarea>
          <span class="hint">Např. „pátek–sobota, 2lůžkový pokoj | 450“. Bez ceny stačí jen název.</span></label>
        <label class="unit-field">Jednotka<input data-f="unit" value="${esc(x.unit || '')}" placeholder="např. porce, lůžko"></label>
      </div>
    </div>`;
  }

  function bindCard(card) {
    const typeSel = $('[data-f="type"]', card);
    const sync = () => {
      if (card.classList.contains('tour-card')) {
        $$('.team-only', card).forEach((el) => { el.hidden = typeSel.value !== 'team'; });
        $$('.individual-only', card).forEach((el) => { el.hidden = typeSel.value === 'team'; });
      } else {
        $('.options-field', card).hidden = !['checkboxes', 'select', 'quantity'].includes(typeSel.value);
        $('.unit-field', card).hidden = typeSel.value !== 'quantity';
      }
    };
    typeSel.addEventListener('change', sync);
    sync();
    $$('.fee-rule', card).forEach(bindFeeRule);
    const addRule = $('[data-add-rule]', card);
    if (addRule) {
      addRule.addEventListener('click', () => {
        $('.fee-rules', card).insertAdjacentHTML('beforeend', feeRuleRow());
        bindFeeRule($('.fee-rules', card).lastElementChild);
      });
    }
    $('[data-remove]', card).addEventListener('click', () => {
      if (card.dataset.id && !confirm('Odebrat? Turnaj s přihláškami odebrat nejde.')) return;
      card.remove();
    });
    $$('[data-move]', card).forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.move === '-1' && card.previousElementSibling) card.parentNode.insertBefore(card, card.previousElementSibling);
      if (b.dataset.move === '1' && card.nextElementSibling) card.parentNode.insertBefore(card.nextElementSibling, card);
    }));
    const name = $('[data-f="name"], [data-f="label"]', card);
    name.addEventListener('input', () => { $('.sub-card-head strong', card).textContent = name.value || '…'; });
  }

  async function viewEditor(id) {
    loading();
    let ev = {
      status: 'koncept', tournaments: [{ type: 'individual' }],
      extras: [{ type: 'textarea', label: 'Poznámka', modes: ['individual', 'team'] }],
      admins: [],
    };
    if (id) ev = (await call('event', { id })).event;
    let imported = null;
    if (!id && pendingImport) {
      imported = pendingImport;
      ev = imported.event;
      pendingImport = null;
    }
    const isOwner = !id || me.role === 'superadmin' || ev.createdBy === me.email;
    const iss = ev.issuer || {};
    const statusOpts = {};
    Object.keys(R.STATUS_LABELS).forEach((k) => { statusOpts[k] = R.STATUS_LABELS[k]; });

    app.innerHTML = `
      <p class="back small"><a href="${id ? '#/akce/' + esc(id) : '#/'}">← Zpět</a></p>
      <h1>${id ? 'Upravit akci' : imported ? 'Nová akce z importu' : 'Nová akce'}</h1>
      ${imported ? `<div class="card import-note">
        <strong>Údaje načtené z importu – před uložením je zkontrolujte</strong>, hlavně data, ročníky a limity ELO.
        Akce se uloží jako rozpracovaná, veřejná bude až po otevření přihlašování.
        ${imported.warnings.length ? `<ul>${imported.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      </div>` : ''}
      <form id="event-form" novalidate>
        <section class="card">
          <h2>Základní údaje</h2>
          <div class="grid">
            <label class="wide">Název akce <span class="req">*</span><input name="name" value="${esc(ev.name || '')}" placeholder="např. Šachový festival Chlumec 2027"></label>
            <label>Místo<input name="place" value="${esc(ev.place || '')}"></label>
            <label>Stav<select name="status">${options(statusOpts, ev.status)}</select>
              <span class="hint">Formulář je dostupný jen ve stavu „přihlašování otevřeno“.</span></label>
            <label>Začátek <span class="req">*</span><input type="date" name="dateFrom" value="${esc(ev.dateFrom || '')}"></label>
            <label>Konec<input type="date" name="dateTo" value="${esc(ev.dateTo || '')}"></label>
            <label>Uzávěrka přihlášek<input type="date" name="deadline" value="${esc(ev.deadline || '')}">
              <span class="hint">Po tomto dni se formulář zavře.</span></label>
            <label>Adresa (v odkazu)<input name="slug" value="${esc(ev.slug || '')}" placeholder="vytvoří se z názvu">
              <span class="hint">prihlaska.html?akce=<b>…</b></span></label>
            <label class="wide">Odkaz na propozice<input name="infoUrl" type="url" value="${esc(ev.infoUrl || '')}" placeholder="https://"></label>
            <label class="wide">Text pod nadpisem formuláře<textarea name="intro" rows="2">${esc(ev.intro || '')}</textarea></label>
            <label>Kontaktní e-mail<input name="contactEmail" type="email" value="${esc(ev.contactEmail || '')}">
              <span class="hint">Sem půjdou odpovědi na potvrzovací e-maily.</span></label>
            <label>Další správci akce<textarea name="admins" rows="2" ${isOwner ? '' : 'disabled'}>${esc((ev.admins || []).join(', '))}</textarea>
              <span class="hint">Google účty oddělené čárkou. Musí být zároveň v seznamu správců.</span></label>
          </div>
        </section>

        <section class="card">
          <h2>Turnaje</h2>
          <div id="tours"></div>
          <button type="button" class="button" id="add-tour">+ Přidat turnaj</button>
        </section>

        <section class="card">
          <h2>Doplňující otázky</h2>
          <p class="muted small">Např. doprava, ubytování, strava, poznámka. Jméno, ročník, klub a e-mail se ptá vždy.</p>
          <div id="extras-edit"></div>
          <p class="actions">
            <button type="button" class="button" id="add-extra">+ Přidat otázku</button>
            <button type="button" class="button" data-preset="meals">+ Obědy (s cenou)</button>
            <button type="button" class="button" data-preset="lodging">+ Ubytování (s cenou)</button>
          </p>
        </section>

        <section class="card">
          <h2>Startovné a doklady o zaplacení</h2>
          <p class="muted small">Startovné a slevy se nastavují u turnajů výše. Údaje níže se tisknou na příjmové pokladní doklady.</p>
          <div class="grid">
            <label class="wide">Příjemce – název klubu / spolku<input name="issuerName" value="${esc(iss.name || '')}" placeholder="např. Šachový klub Chlumec, z.s."></label>
            <label>IČO<input name="issuerIco" value="${esc(iss.ico || '')}"></label>
            <label>Místo vystavení<input name="issuerPlace" value="${esc(iss.place || '')}" placeholder="např. Chlumec"></label>
            <label class="wide">Adresa (sídlo)<input name="issuerAddress" value="${esc(iss.address || '')}"></label>
            <label>Vystavuje (pokladník)<input name="issuerCashier" value="${esc(iss.cashier || '')}"></label>
            <label>Řada čísel dokladů<input name="issuerPrefix" value="${esc(iss.prefix || '')}" placeholder="${esc(R.eventYear(ev) + '-')}">
              <span class="hint">Doklady se číslují ${esc((iss.prefix || R.eventYear(ev) + '-') + '0001')}, …</span></label>
            <label class="wide">Poznámka na dokladu<input name="issuerNote" value="${esc(iss.note || '')}" placeholder="např. Nejsme plátci DPH."></label>
          </div>
        </section>

        <div id="form-errors"></div>
        <p class="actions sticky-actions">
          <button type="submit" class="primary">Uložit akci</button>
          <a class="button" href="${id ? '#/akce/' + esc(id) : '#/'}">Zrušit</a>
        </p>
      </form>`;

    const tours = $('#tours');
    const extras = $('#extras-edit');
    const addCard = (box, html) => {
      box.insertAdjacentHTML('beforeend', html);
      bindCard(box.lastElementChild);
    };
    ev.tournaments.forEach((t) => addCard(tours, tourCard(t)));
    (ev.extras || []).forEach((x) => addCard(extras, extraCard(x)));
    $('#add-tour').addEventListener('click', () => { addCard(tours, tourCard()); $('[data-f="name"]', tours.lastElementChild).focus(); });
    $('#add-extra').addEventListener('click', () => { addCard(extras, extraCard()); $('[data-f="label"]', extras.lastElementChild).focus(); });
    $$('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      addCard(extras, extraCard(JSON.parse(JSON.stringify(EXTRA_PRESETS[b.dataset.preset]))));
      extras.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('[data-f="options"]', extras.lastElementChild).focus();
    }));

    $('#event-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const val = (card, field) => { const el = $(`[data-f="${field}"]`, card); return el ? el.value.trim() : ''; };
      const event = {
        id: id || undefined,
        name: f.name.value, place: f.place.value, status: f.status.value,
        dateFrom: f.dateFrom.value, dateTo: f.dateTo.value, deadline: f.deadline.value,
        slug: f.slug.value, infoUrl: f.infoUrl.value, intro: f.intro.value,
        contactEmail: f.contactEmail.value, admins: f.admins.value,
        issuer: {
          name: f.issuerName.value, ico: f.issuerIco.value, address: f.issuerAddress.value, place: f.issuerPlace.value,
          cashier: f.issuerCashier.value, prefix: f.issuerPrefix.value, note: f.issuerNote.value,
        },
        tournaments: $$('.tour-card', tours).map((c) => ({
          id: c.dataset.id || undefined,
          name: val(c, 'name'), short: val(c, 'short'), day: val(c, 'day'), type: val(c, 'type'), rating: val(c, 'rating'),
          minBirthYear: val(c, 'minBirthYear'), maxBirthYear: val(c, 'maxBirthYear'),
          warnMaxRating: val(c, 'warnMaxRating'), capacity: val(c, 'capacity'),
          boards: val(c, 'boards'), reserves: val(c, 'reserves'), fee: val(c, 'fee'),
          feeRules: $$('.fee-rule', c).map((r) => ({
            type: $('[data-r="type"]', r).value, value: $('[data-r="value"]', r).value.trim(), price: $('[data-r="price"]', r).value,
          })),
        })),
        extras: $$('.extra-card', extras).map((c) => {
          const m = val(c, 'modes');
          return {
            id: c.dataset.id || undefined,
            label: val(c, 'label'), type: val(c, 'type'), help: val(c, 'help'),
            ...parseOptionsText(val(c, 'options')),
            unit: val(c, 'unit'),
            modes: m === 'both' ? ['individual', 'team'] : [m],
          };
        }),
      };
      const btn = $('button[type="submit"]', f);
      btn.disabled = true;
      $('#form-errors').innerHTML = '';
      try {
        const res = await call('saveEvent', { event });
        location.hash = '#/akce/' + res.event.id;
      } catch (err) {
        $('#form-errors').innerHTML = errorBox(err);
      } finally {
        btn.disabled = false;
      }
    });
  }

  // =====================================================================
  // Detail akce – přihlášky
  // =====================================================================

  let current = null; // { event, registrations }
  let showCancelled = false;
  let showAllChanges = false;

  /** Detail akce z paměti hned, čerstvá data z serveru po jejich příchodu. */
  async function loadEventData(id, render) {
    const here = location.hash;
    const cached = memo.event[id];
    if (cached) render(cached, true);
    const data = await call('event', { id });
    const changed = !cached || JSON.stringify(data) !== JSON.stringify(cached);
    memo.event[id] = data;
    if (changed && location.hash === here && !dialog.open) render(data, false);
  }

  async function viewEvent(id) {
    if (!memo.event[id]) loading('Načítám přihlášky…');
    await loadEventData(id, (data) => { current = data; renderEvent(); });
  }

  function extrasText(r) {
    let data = {};
    try { data = JSON.parse(r.extras || '{}'); } catch (e) { /* nic */ }
    return (current.event.extras || []).map((x) => {
      const t = data[x.id] == null ? '' : R.extraText(x, data[x.id]);
      return t ? `${x.label}: ${t}` : '';
    }).filter(Boolean).join(' · ');
  }

  function changesSection() {
    const list = (current.changes || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (!list.length) return '';
    const shown = showAllChanges ? list : list.slice(0, 15);
    return `<section class="card" id="changes">
      <div class="page-head"><h2>Změny přihlášek</h2><span class="muted small">${list.length} záznamů</span></div>
      <div class="table-wrap"><table class="admin-table">
        <thead><tr><th>Kdy</th><th>Kdo</th><th>Co</th><th>Podrobnosti</th><th>Přihláška</th></tr></thead>
        <tbody>${shown.map((c) => `<tr>
          <td class="small">${esc(c.at ? new Date(c.at).toLocaleString('cs-CZ') : '')}</td>
          <td class="small">${esc(c.by)}</td>
          <td><span class="badge ${c.action === 'odhláška' ? 'danger-badge' : ''}">${esc(c.action)}</span></td>
          <td class="small">${esc(c.detail)}</td>
          <td class="small">${esc(c.applicationId)}</td>
        </tr>`).join('')}</tbody></table></div>
      ${list.length > shown.length ? '<p><button type="button" class="link" id="all-changes">Zobrazit všechny změny</button></p>' : ''}
    </section>`;
  }

  function regRow(r, i) {
    const p = window.SM.regToPlayer(r);
    const cancelled = r.status === 'zrušeno';
    return `<tr class="${cancelled ? 'cancelled' : ''}">
      <td class="num">${r.board ? esc(r.board) : i + 1}.</td>
      <td><strong>${esc(p.surname)} ${esc(p.firstName)}</strong>${p.title ? ` <span class="badge">${esc(p.title)}</span>` : ''}
        ${p.registered ? '' : ' <span class="badge muted-badge" title="Hráč není v listině LOK">mimo LOK</span>'}
        ${cancelled ? ' <span class="badge danger-badge">zrušeno</span>' : ''}
        ${cancelled && r.updatedAt ? `<div class="small muted">odhlášeno ${esc(new Date(r.updatedAt).toLocaleDateString('cs-CZ'))} · ${esc(r.updatedBy || '')}</div>` : ''}</td>
      <td class="num">${esc(p.year || '')}</td>
      <td>${esc(p.club)}</td>
      <td class="num">${p.rn || ''}</td>
      <td class="num">${p.rf || ''}</td>
      <td class="small">${esc(r.email || '')}</td>
      <td class="small">${esc(extrasText(r))}${r.orgNote ? `<div class="org-note">${esc(r.orgNote)}</div>` : ''}</td>
      <td class="small">${r.createdAt ? esc(new Date(r.createdAt).toLocaleDateString('cs-CZ')) : ''}</td>
      <td class="row-actions">
        <button type="button" class="link" data-edit="${esc(r.id)}">Upravit</button>
        <button type="button" class="link ${cancelled ? '' : 'danger'}" data-toggle="${esc(r.id)}">${cancelled ? 'Obnovit' : 'Zrušit'}</button>
      </td>
    </tr>`;
  }

  const regHead = '<thead><tr><th></th><th>Jméno</th><th>Ročník</th><th>Klub</th><th>ELO ČR</th><th>FIDE</th><th>E-mail</th><th>Doplňky / poznámka</th><th>Přihlášen</th><th></th></tr></thead>';

  function smOpts() {
    return {
      year: R.eventYear(current.event),
      ageCategories: cfg.ageCategories || window.SM.DEFAULT_AGE_CATEGORIES,
      unregisteredCategory: cfg.unregisteredCategory == null ? 'N' : cfg.unregisteredCategory,
    };
  }

  function tournamentTable(t) {
    const all = current.registrations.filter((r) => r.tournamentId === t.id);
    const active = all.filter((r) => r.status !== 'zrušeno');
    const shown = showCancelled ? all : active;
    if (t.type === 'team') {
      // družstvo = řádek družstva (bez hráče) + hráči soupisky
      const teams = {};
      shown.forEach((r) => { (teams[r.team] = teams[r.team] || []).push(r); });
      const names = Object.keys(teams).sort((a, b) => a.localeCompare(b, 'cs'));
      return names.length ? names.map((n) => {
        const rows = teams[n];
        const players = rows.filter((r) => r.surname).sort((a, b) => a.board - b.board);
        const first = rows.find((r) => !r.surname) || rows[0];
        const cancelled = rows.every((r) => r.status === 'zrušeno');
        const link = first.editToken ? `zmena.html?t=${encodeURIComponent(first.editToken)}&admin=1` : '';
        return `<div class="team-head">
            <h3>${esc(n)} ${cancelled ? '<span class="badge danger-badge">odhlášeno</span>' : ''}</h3>
            <span class="small muted">kapitán: ${esc(first.captain || '')} · ${esc(first.email || '')} · soupiska ${players.filter((r) => r.status !== 'zrušeno').length}/${t.boards || 4}${t.reserves ? ' + ' + t.reserves : ''}</span>
            ${link ? `<a class="small" href="${link}" target="_blank">Upravit soupisku / odhlásit ↗</a>` : ''}
          </div>
          ${players.length ? `<div class="table-wrap"><table class="admin-table">${regHead}<tbody>${players.map(regRow).join('')}</tbody></table></div>`
            : '<p class="muted small">Soupiska zatím není.</p>'}`;
      }).join('') : '<p class="muted">Zatím žádné přihlášky.</p>';
    }
    const sorted = shown.slice().sort((a, b) => window.SM.byRating(window.SM.regToPlayer(a), window.SM.regToPlayer(b)));
    return sorted.length
      ? `<div class="table-wrap"><table class="admin-table">${regHead}<tbody>${sorted.map(regRow).join('')}</tbody></table></div>`
      : '<p class="muted">Zatím žádné přihlášky.</p>';
  }

  function extrasSummary() {
    const ev = current.event;
    // jedna odpověď za přihlášku (doplňky platí pro celou přihlášku, u výpravy za všechny)
    const apps = {};
    current.registrations.filter((r) => r.status !== 'zrušeno').forEach((r) => {
      const a = apps[r.applicationId] || (apps[r.applicationId] = { r, names: [], persons: 0 });
      const n = r.surname ? `${r.surname} ${r.firstName}` : r.team;
      if (n && !a.names.includes(n)) { a.names.push(n); if (r.surname) a.persons += 1; }
    });
    const list = Object.keys(apps).map((k) => apps[k]);
    const extrasOf = (r) => { try { return JSON.parse(r.extras || '{}'); } catch (e) { return {}; } };
    const who = (a) => (a.names.length > 2 ? `${a.names[0]} + ${a.names.length - 1}` : a.names.join(', '));
    let grand = 0;
    const parts = (ev.extras || []).filter((x) => ['checkboxes', 'select', 'quantity'].includes(x.type)).map((x) => {
      let sum = 0;
      const rows = x.options.map((o, i) => {
        const price = R.optionPrice(x, i);
        let count = 0;
        const names = [];
        list.forEach((a) => {
          const v = extrasOf(a.r)[x.id];
          const n = x.type === 'quantity' ? parseInt((v || {})[o], 10) || 0
            : (Array.isArray(v) ? v.includes(o) : v === o) ? Math.max(1, a.persons) : 0;
          if (n) { count += n; names.push(n > 1 ? `${who(a)} (${n})` : who(a)); }
        });
        if (price != null) sum += price * count;
        return `<li><strong>${esc(o)}: ${count}${x.type === 'quantity' && x.unit ? ' ' + esc(x.unit) : ''}</strong>
          ${price != null && count ? ` <span class="price">${esc(R.formatMoney(price * count))}</span>` : ''}
          ${names.length ? ` <span class="small muted">(${esc(names.join(', '))})</span>` : ''}</li>`;
      }).join('');
      grand += sum;
      return `<div><h3>${esc(x.label)}</h3><ul>${rows}</ul>${sum ? `<p class="small">Celkem: <strong>${esc(R.formatMoney(sum))}</strong></p>` : ''}</div>`;
    });
    return parts.length ? `<section class="card"><h2>Souhrn doplňujících otázek</h2>
      <div class="summary-grid">${parts.join('')}</div>
      ${grand ? `<p>Celkem za všechny doplňky: <strong>${esc(R.formatMoney(grand))}</strong></p>` : ''}</section>` : '';
  }

  function renderEvent() {
    const ev = current.event;
    const publicUrl = `prihlaska.html?akce=${encodeURIComponent(ev.slug)}`;
    const listUrl = `seznam.html?akce=${encodeURIComponent(ev.slug)}`;
    const canOpen = ev.status !== 'otevreno';
    app.innerHTML = `
      <p class="back small"><a href="#/">← Všechny akce</a></p>
      <div class="page-head">
        <div>
          <h1>${esc(ev.name)}</h1>
          <p class="muted">${esc([R.formatRange(ev.dateFrom, ev.dateTo), ev.place, ev.deadline ? 'uzávěrka ' + R.formatDate(ev.deadline) : ''].filter(Boolean).join(' · '))}
            · ${statusBadge(ev.status)}</p>
        </div>
        <div class="actions">
          <button type="button" class="button ${canOpen ? 'primary' : ''}" id="toggle-status">${canOpen ? 'Otevřít přihlašování' : 'Uzavřít přihlašování'}</button>
          <a class="button" href="#/akce/${esc(ev.id)}/upravit">Upravit akci</a>
          <button type="button" class="button" id="copy-event">Kopírovat akci</button>
          <a class="button" href="#/akce/${esc(ev.id)}/platby">Platby a doklady</a>
          <a class="button" href="#/akce/${esc(ev.id)}/prezence">Seznam k prezenci</a>
        </div>
      </div>
      <p class="links">
        <a href="${publicUrl}" target="_blank">Formulář ↗</a>
        <a href="${listUrl}" target="_blank">Veřejný seznam ↗</a>
        <button type="button" class="link" id="copy-link">Zkopírovat odkaz na formulář</button>
      </p>
      ${ev.status === 'koncept' ? '<p class="notice-inline">Akce je rozpracovaná – formulář ani seznam zatím nejsou veřejné.</p>' : ''}
      ${systemNotice(current.system)}

      ${ev.tournaments.length > 1 ? `<nav class="jump" aria-label="Turnaje akce"><span class="small muted">Přejít na:</span>${ev.tournaments.map((t) =>
        `<button type="button" class="chip" data-jump="t-${esc(t.id)}">${esc(t.short || t.name)} <strong>${t.count}</strong></button>`).join('')}</nav>` : ''}

      <div class="toolbar">
        <button type="button" class="button primary" id="add-reg">+ Přidat hráče</button>
        <button type="button" class="button" id="export-all">Přihlášky, doplňky a změny (.xlsx)</button>
        <label class="check"><input type="checkbox" id="show-cancelled" ${showCancelled ? 'checked' : ''}> zobrazit zrušené</label>
      </div>

      ${ev.tournaments.map((t) => {
        const cap = t.capacity ? ` / ${t.capacity}` : '';
        return `<section class="card" id="t-${esc(t.id)}">
          <div class="page-head">
            <div><h2>${esc(R.tournamentLabel(t))}</h2>
              <p class="muted small">${t.type === 'team' ? 'Družstev' : 'Hráčů'}: <strong>${t.count}${cap}</strong>${R.ruleText(t) ? ' · ' + esc(R.ruleText(t)) : ''}</p></div>
            <div class="actions">
              <span class="small muted">Swiss-Manager:</span>
              ${t.type === 'team' ? `
              <button type="button" class="button small-btn" data-export-txt="${esc(t.id)}" data-part="teams" title="1. krok importu do SM">Družstva .TXT</button>
              <button type="button" class="button small-btn" data-export-txt="${esc(t.id)}" data-part="players" title="2. krok importu do SM">Hráči .TXT</button>
              <button type="button" class="button small-btn" data-export-xlsx="${esc(t.id)}" title="Oba seznamy jako dva listy">.xlsx</button>` : `
              <button type="button" class="button small-btn" data-export-txt="${esc(t.id)}">.TXT</button>
              <button type="button" class="button small-btn" data-export-xlsx="${esc(t.id)}">.xlsx</button>`}
            </div>
          </div>
          ${tournamentTable(t)}
        </section>`;
      }).join('')}
      ${extrasSummary()}
      ${changesSection()}`;

    $('#show-cancelled').addEventListener('change', (e) => { showCancelled = e.target.checked; renderEvent(); });
    document.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => {
      const el = document.getElementById(b.dataset.jump);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    const allChanges = $('#all-changes');
    if (allChanges) allChanges.addEventListener('click', () => { showAllChanges = true; renderEvent(); });
    $('#copy-link').addEventListener('click', () => {
      const url = new URL(publicUrl, location.href).toString();
      navigator.clipboard.writeText(url).then(() => { $('#copy-link').textContent = 'Zkopírováno ✓'; });
    });
    $('#toggle-status').addEventListener('click', async () => {
      const status = canOpen ? 'otevreno' : 'uzavreno';
      try {
        const res = await call('saveEvent', { event: Object.assign({}, ev, { status }) });
        current.event = Object.assign(current.event, { status: res.event.status });
        renderEvent();
      } catch (e) { alert(e.message); }
    });
    $('#add-reg').addEventListener('click', addRegistrationDialog);
    $('#copy-event').addEventListener('click', () => copyEventDialog(ev));
    $('#export-all').addEventListener('click', exportAll);
    $$('[data-export-txt]').forEach((b) => b.addEventListener('click', () => exportTournament(b.dataset.exportTxt, 'txt', b.dataset.part)));
    $$('[data-export-xlsx]').forEach((b) => b.addEventListener('click', () => exportTournament(b.dataset.exportXlsx, 'xlsx')));
    $$('[data-toggle]').forEach((b) => b.addEventListener('click', () => toggleRegistration(b.dataset.toggle)));
    $$('[data-edit]').forEach((b) => b.addEventListener('click', () => editRegistrationDialog(b.dataset.edit)));
  }

  async function exportTournament(id, kind, part) {
    const t = current.event.tournaments.find((x) => x.id === id);
    const regs = current.registrations.filter((r) => r.tournamentId === t.id && r.status !== 'zrušeno');
    const name = `${fileSafe(current.event.slug)}_${fileSafe(t.short || t.name)}`;
    try {
      if (t.type === 'team') {
        // SM importuje družstva dvěma soubory: nejdřív seznam družstev, pak hráče s číslem družstva
        const exp = window.SM.buildTeamExport(regs, smOpts());
        if (kind === 'txt') download(`${name}_${part === 'teams' ? 'druzstva' : 'hraci'}.TXT`, window.SM.toSmText(part === 'teams' ? exp.teams : exp.players));
        else await downloadXlsx(name + '.xlsx', [{ name: 'Družstva', rows: exp.teams }, { name: 'Hráči', rows: exp.players }]);
        return;
      }
      const table = window.SM.buildSmTable(regs.map(window.SM.regToPlayer), smOpts());
      if (kind === 'txt') download(name + '.TXT', window.SM.toSmText(table));
      else await downloadXlsx(name + '.xlsx', [{ name: t.short || t.name, rows: table }]);
    } catch (e) { alert(e.message); }
  }

  async function exportAll() {
    const ev = current.event;
    const tName = (id) => { const t = ev.tournaments.find((x) => x.id === id); return t ? t.short || t.name : id; };
    const extrasOf = (r) => { try { return JSON.parse(r.extras || '{}'); } catch (e) { return {}; } };
    const extraVal = (d, x) => R.extraText(x, d[x.id]);
    const qtyCols = [];
    (ev.extras || []).forEach((x) => { if (x.type === 'quantity') x.options.forEach((o) => qtyCols.push({ x, o })); });
    const hasPrices = (ev.extras || []).some((x) => (x.prices || []).some((p) => typeof p === 'number'));
    const when = (s) => (s ? new Date(s).toLocaleString('cs-CZ') : '');
    const header = ['Turnaj', 'Příjmení', 'Jméno', 'Ročník', 'Klub', 'ELO ČR', 'FIDE', 'ID ČR', 'FIDE ID', 'V LOK',
      'Družstvo', 'Šachovnice', 'Kapitán', 'E-mail', 'Přihlášeno', 'Č. přihlášky', 'Stav', 'Změněno', 'Změnil', 'Poznámka pořadatele']
      .concat((ev.extras || []).map((x) => x.label));
    const rows = current.registrations.map((r) => {
      const d = extrasOf(r);
      return [tName(r.tournamentId), r.surname, r.firstName, r.year, r.club, r.rn, r.rf, r.idCr, r.fideId, r.inLok,
        r.team, r.board, r.captain, r.email, when(r.createdAt), r.applicationId, r.status, when(r.updatedAt), r.updatedBy, r.orgNote]
        .concat((ev.extras || []).map((x) => extraVal(d, x)));
    });

    // osoby a doplňky: jeden řádek na hráče v přihlášce (aktuální stav ubytování, obědů…)
    const persons = {};
    current.registrations.filter((r) => r.surname).forEach((r) => {
      const key = `${r.applicationId}|${R.norm(r.surname + ' ' + r.firstName)}|${r.year}`;
      const p = persons[key] || (persons[key] = { r, active: [], cancelled: [], last: '', lastBy: '' });
      (r.status === 'zrušeno' ? p.cancelled : p.active).push(tName(r.tournamentId));
      if (String(r.updatedAt || '') > p.last) { p.last = String(r.updatedAt); p.lastBy = r.updatedBy; }
    });
    const pHeader = ['Příjmení', 'Jméno', 'Ročník', 'Klub', 'E-mail', 'Č. přihlášky', 'Stav', 'Přihlášen do', 'Odhlášen z']
      .concat((ev.extras || []).map((x) => x.label), ['Poslední změna', 'Změnil']);
    const pRows = Object.keys(persons).map((k) => persons[k])
      .sort((a, b) => (a.active.length ? 0 : 1) - (b.active.length ? 0 : 1) || `${a.r.surname} ${a.r.firstName}`.localeCompare(`${b.r.surname} ${b.r.firstName}`, 'cs'))
      .map((p) => {
        const d = extrasOf(p.r);
        return [p.r.surname, p.r.firstName, p.r.year, p.r.club, p.r.email, p.r.applicationId,
          p.active.length ? 'přihlášen' : 'odhlášen', p.active.join(', '), p.cancelled.join(', ')]
          .concat((ev.extras || []).map((x) => (p.active.length ? extraVal(d, x) : '')), [when(p.last), p.lastBy || '']);
      });

    // doplňky po přihláškách: počty kusů (obědy, lůžka) a cena za celou přihlášku
    const apps = {};
    current.registrations.forEach((r) => {
      const a = apps[r.applicationId] || (apps[r.applicationId] = { r, names: [], active: false });
      if (r.status !== 'zrušeno') {
        a.active = true;
        a.r = r;
        const n = r.surname ? `${r.surname} ${r.firstName}` : '';
        if (n && !a.names.includes(n)) a.names.push(n);
      }
    });
    const aHeader = ['Č. přihlášky', 'E-mail', 'Družstvo', 'Hráči', 'Počet hráčů', 'Stav']
      .concat((ev.extras || []).filter((x) => x.type !== 'quantity').map((x) => x.label),
        qtyCols.map((c) => `${c.x.label}: ${c.o}`), hasPrices ? ['Cena celkem (Kč)'] : []);
    const aRows = Object.keys(apps).map((k) => apps[k]).map((a) => {
      const d = a.active ? extrasOf(a.r) : {};
      return [a.r.applicationId, a.r.email, a.r.team || '', a.names.join(', '), a.names.length, a.active ? 'přihlášena' : 'zrušena']
        .concat((ev.extras || []).filter((x) => x.type !== 'quantity').map((x) => extraVal(d, x)),
          qtyCols.map((c) => parseInt((d[c.x.id] || {})[c.o], 10) || 0),
          hasPrices ? [R.extrasTotal(ev.extras, d)] : []);
    });
    if (aRows.length) {
      const sums = aHeader.map((h, i) => (i >= aHeader.length - qtyCols.length - (hasPrices ? 1 : 0)
        ? aRows.reduce((t, r) => t + (Number(r[i]) || 0), 0) : ''));
      sums[0] = 'Celkem';
      aRows.push(sums);
    }

    const cHeader = ['Kdy', 'Kdo', 'Co', 'Podrobnosti', 'Č. přihlášky'];
    const cRows = (current.changes || []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)))
      .map((c) => [when(c.at), c.by, c.action, c.detail, c.applicationId]);
    try {
      await downloadXlsx(`${fileSafe(ev.slug)}_prihlasky.xlsx`, [
        { name: 'Přihlášky', rows: [header].concat(rows) },
        { name: 'Osoby a doplňky', rows: [pHeader].concat(pRows) },
        { name: 'Doplňky po přihláškách', rows: [aHeader].concat(aRows) },
        { name: 'Změny', rows: [cHeader].concat(cRows) },
      ]);
    } catch (e) { alert(e.message); }
  }

  async function toggleRegistration(id) {
    const r = current.registrations.find((x) => x.id === id);
    const cancel = r.status !== 'zrušeno';
    if (cancel && !confirm(`Zrušit přihlášku: ${r.surname} ${r.firstName}?`)) return;
    try {
      const res = await call('updateRegistration', { id, changes: { status: cancel ? 'zrušeno' : '' } });
      Object.assign(r, res.registration);
      if (res.changes) current.changes = res.changes;
      recount();
      renderEvent();
    } catch (e) { alert(e.message); }
  }

  function recount() {
    current.event.tournaments.forEach((t) => {
      const active = current.registrations.filter((r) => r.tournamentId === t.id && r.status !== 'zrušeno');
      t.count = t.type === 'team' ? new Set(active.map((r) => R.norm(r.team))).size : active.length;
    });
  }

  function editRegistrationDialog(id) {
    const r = current.registrations.find((x) => x.id === id);
    const t = current.event.tournaments.find((x) => x.id === r.tournamentId) || {};
    const sameType = current.event.tournaments.filter((x) => x.type === t.type);
    const field = (name, label, value, type) => `<label>${esc(label)}<input name="${name}" ${type ? `type="${type}"` : ''} value="${esc(value == null ? '' : value)}"></label>`;
    openDialog(`<form class="dialog-form">
      <h2>Upravit přihlášku</h2>
      <div class="grid">
        ${field('surname', 'Příjmení', r.surname)}
        ${field('firstName', 'Jméno', r.firstName)}
        ${field('year', 'Ročník', r.year, 'number')}
        ${field('club', 'Klub / město', r.club)}
        ${field('rn', 'ELO ČR', r.rn, 'number')}
        ${field('rf', 'FIDE', r.rf, 'number')}
        ${field('idCr', 'ID ČR', r.idCr, 'number')}
        ${field('fideId', 'FIDE ID', r.fideId, 'number')}
        ${field('email', 'E-mail', r.email, 'email')}
        <label>Turnaj<select name="tournamentId">${sameType.map((x) => `<option value="${esc(x.id)}"${x.id === r.tournamentId ? ' selected' : ''}>${esc(x.short || x.name)}</option>`).join('')}</select></label>
        ${t.type === 'team' ? field('team', 'Družstvo', r.team) + field('board', 'Šachovnice', r.board, 'number') + field('captain', 'Kapitán', r.captain) : ''}
        <label class="wide">Poznámka pořadatele<textarea name="orgNote" rows="2">${esc(r.orgNote || '')}</textarea></label>
        ${r.editToken ? `<div class="wide small">Odkaz pro změny (pro hráče):
          <button type="button" class="link" id="copy-edit-link">zkopírovat</button></div>` : ''}
      </div>
      <div class="errors" hidden></div>
      <p class="actions"><button class="primary">Uložit</button><button type="button" data-close>Zrušit</button></p>
    </form>`, (d) => {
      const copyLink = $('#copy-edit-link', d);
      if (copyLink) {
        copyLink.addEventListener('click', () => {
          const url = new URL('zmena.html?t=' + r.editToken, location.href).toString();
          navigator.clipboard.writeText(url).then(() => { copyLink.textContent = 'zkopírováno ✓'; }, () => prompt('Odkaz pro změny:', url));
        });
      }
      $('form', d).addEventListener('submit', async (e) => {
        e.preventDefault();
        const changes = {};
        $$('input, select, textarea', e.target).forEach((el) => { changes[el.name] = el.value; });
        try {
          const res = await call('updateRegistration', { id, changes });
          Object.assign(r, res.registration);
          if (res.changes) current.changes = res.changes;
          recount();
          dialog.close();
          renderEvent();
        } catch (err) {
          const box = $('.errors', d);
          box.textContent = err.message;
          box.hidden = false;
        }
      });
    });
  }

  function addRegistrationDialog() {
    const tours = current.event.tournaments.filter((t) => t.type === 'individual');
    if (!tours.length) { alert('Akce nemá turnaj jednotlivců. Družstva přihlaste přes veřejný formulář.'); return; }
    openDialog(`<form class="dialog-form" novalidate>
      <h2>Přidat hráče</h2>
      <p class="muted small">Pořadatel může přidat hráče i po uzávěrce a bez ohledu na kapacitu a ročník. Potvrzovací e-mail se neposílá.</p>
      <div id="admin-picker"></div>
      <fieldset class="tournaments"><legend>Turnaje</legend>
        ${tours.map((t) => `<label class="check"><input type="checkbox" name="t" value="${esc(t.id)}" ${tours.length === 1 ? 'checked' : ''}> ${esc(R.tournamentLabel(t))}</label>`).join('')}
      </fieldset>
      <label class="block">E-mail (nepovinné)<input type="email" name="email"></label>
      <div class="errors" hidden></div>
      <p class="actions"><button class="primary">Přidat</button><button type="button" data-close>Zavřít</button></p>
    </form>`, (d) => {
      const picker = window.createPicker($('#admin-picker', d), { label: 'Hráč', required: true });
      getPlayerDb().then((db) => picker.setDB(db)).catch(() => picker.setUnavailable());
      $('form', d).addEventListener('submit', async (e) => {
        e.preventDefault();
        const box = $('.errors', d);
        box.hidden = true;
        const err = picker.validate(R.eventYear(current.event));
        const ids = $$('[name="t"]:checked', d).map((i) => i.value);
        if (err || !ids.length) {
          box.textContent = err || 'Vyberte turnaj.';
          box.hidden = false;
          return;
        }
        try {
          await call('addRegistration', {
            eventId: current.event.id, mode: 'individual', email: e.target.email.value.trim(),
            player: picker.getValue(), tournaments: ids, extras: {},
          });
          dialog.close();
          viewEvent(current.event.id);
        } catch (er) {
          box.textContent = er.message;
          box.hidden = false;
        }
      });
    });
  }


  // =====================================================================
  // Platby a doklady
  // =====================================================================

  let pay = null; // { event, registrations, receipts, items, filter, selected:Set }

  async function viewPayments(id) {
    if (!memo.event[id]) loading('Načítám platby…');
    const keep = pay && pay.event.id === id ? { filter: pay.filter, selected: pay.selected } : null;
    await loadEventData(id, (data) => {
      const prev = pay && pay.event.id === id ? pay : keep;
      pay = {
        event: data.event, registrations: data.registrations, receipts: data.receipts || [],
        filter: prev ? prev.filter : { club: '', q: '', category: '', state: 'unpaid' },
        selected: prev ? prev.selected : new Set(),
      };
      pay.items = window.Payments.buildItems(pay.event, pay.registrations);
      if (/\/platby$/.test(location.hash)) renderPayments();
    });
  }

  function payFiltered() {
    const paid = window.Payments.paidMap(pay.receipts);
    const f = pay.filter;
    const q = R.norm(f.q);
    return pay.items.filter((it) => {
      if (f.club && it.club !== f.club) return false;
      if (f.category && it.category !== f.category) return false;
      if (f.state === 'unpaid' && paid[it.key]) return false;
      if (f.state === 'paid' && !paid[it.key]) return false;
      if (q && !R.norm([it.person, it.label, it.club, it.applicationId, it.email].join(' ')).includes(q)) return false;
      return true;
    }).sort((a, b) => String(a.club).localeCompare(String(b.club), 'cs')
      || String(a.applicationId).localeCompare(String(b.applicationId)) || String(a.person).localeCompare(String(b.person), 'cs'));
  }

  function renderPayments() {
    const ev = pay.event;
    const paid = window.Payments.paidMap(pay.receipts);
    const items = payFiltered();
    const sum = (list) => list.reduce((a, it) => a + it.amount, 0);
    const allPaid = pay.items.filter((it) => paid[it.key]);
    const clubs = Array.from(new Set(pay.items.map((it) => it.club).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'cs'));
    const cats = Array.from(new Set(pay.items.map((it) => it.category)));
    const sel = (opts, value) => opts.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('');
    const iss = ev.issuer || {};

    app.innerHTML = `
      <p class="back small"><a href="#/akce/${esc(ev.id)}">← ${esc(ev.name)}</a></p>
      <div class="page-head"><h1>Platby a doklady</h1>
        <div class="actions">
          <a class="button" href="#/akce/${esc(ev.id)}/prezence">Seznam k prezenci</a>
          <button type="button" class="button" id="pay-blank">Prázdné doklady k tisku</button>
          <button type="button" class="button" id="pay-export">Export plateb (.xlsx)</button>
        </div></div>
      ${iss.name ? '' : `<p class="notice-inline">Pro vystavování dokladů nejdřív vyplňte údaje klubu v <a href="#/akce/${esc(ev.id)}/upravit">nastavení akce</a> (sekce Startovné a doklady).</p>`}
      ${pay.items.length ? '' : '<p class="notice-inline">Akce nemá žádné placené položky – nastavte startovné u turnajů nebo ceny u doplňujících otázek.</p>'}
      <div class="stats">
        <div><span class="muted small">K úhradě celkem</span><strong>${esc(R.formatMoney(sum(pay.items)))}</strong></div>
        <div class="${sum(allPaid) > 0 ? 'stat-ok' : ''}"><span class="muted small">Zaplaceno</span><strong>${esc(R.formatMoney(sum(allPaid)))}</strong></div>
        <div class="${sum(pay.items) - sum(allPaid) > 0 ? 'stat-warn' : 'stat-ok'}"><span class="muted small">Zbývá</span><strong>${esc(R.formatMoney(sum(pay.items) - sum(allPaid)))}</strong></div>
      </div>

      <section class="card">
        <div class="filters">
          <label>Klub<select id="pf-club">${sel([['', 'všechny kluby']].concat(clubs.map((c) => [c, c])), pay.filter.club)}</select></label>
          <label>Položky<select id="pf-cat">${sel([['', 'všechny']].concat(cats.map((c) => [c, c])), pay.filter.category)}</select></label>
          <label>Stav<select id="pf-state">${sel([['unpaid', 'nezaplacené'], ['paid', 'zaplacené'], ['', 'vše']], pay.filter.state)}</select></label>
          <label class="grow">Hledat<input id="pf-q" value="${esc(pay.filter.q)}" placeholder="jméno, číslo přihlášky, e-mail"></label>
        </div>
        <p class="small muted">Zobrazeno ${items.length} položek za ${esc(R.formatMoney(sum(items)))}.</p>
        ${items.length ? `<div class="table-wrap"><table class="admin-table pay-table">
          <thead><tr><th><input type="checkbox" id="pf-all" title="Vybrat všechny nezaplacené zobrazené"></th>
            <th>Za koho</th><th>Klub</th><th>Položka</th><th class="num">Kč</th><th>Přihláška</th><th>Stav</th></tr></thead>
          <tbody>${items.map((it) => {
            const rc = paid[it.key];
            return `<tr class="${rc ? 'paid' : ''}">
              <td>${rc ? '' : `<input type="checkbox" data-item="${esc(it.key)}" ${pay.selected.has(it.key) ? 'checked' : ''}>`}</td>
              <td>${esc(it.person)}</td><td class="small">${esc(it.club)}</td><td>${esc(it.label)}</td>
              <td class="num">${esc(R.formatMoney(it.amount))}</td>
              <td class="small">${esc(it.applicationId)}<br><span class="muted">${esc(it.email || '')}</span></td>
              <td class="small">${rc ? `<a href="#/akce/${esc(ev.id)}/doklady/${esc(rc.id)}">✓ ${esc(rc.number)}</a>` : '<span class="muted">nezaplaceno</span>'}</td>
            </tr>`;
          }).join('')}</tbody></table></div>` : '<p class="muted">Žádné položky neodpovídají filtru.</p>'}
      </section>

      <div class="pay-bar" id="pay-bar" hidden>
        <span id="pay-sel"></span>
        <button type="button" class="primary" data-issue="one">Vystavit jeden doklad</button>
        <button type="button" class="button" data-issue="person">Doklady po hráčích</button>
        <button type="button" class="button" data-issue="app">Doklady po přihláškách</button>
        <button type="button" class="link" id="pay-clear">zrušit výběr</button>
      </div>

      <section class="card">
        <h2>Vystavené doklady</h2>
        ${pay.receipts.length ? `<div class="table-wrap"><table class="admin-table">
          <thead><tr><th>Číslo</th><th>Datum</th><th>Přijato od</th><th class="num">Kč</th><th>Vystavil</th><th></th></tr></thead>
          <tbody>${pay.receipts.slice().sort((a, b) => String(b.number).localeCompare(String(a.number))).map((r) => `
            <tr class="${r.status ? 'cancelled' : ''}">
              <td><a href="#/akce/${esc(ev.id)}/doklady/${esc(r.id)}">${esc(r.number)}</a> ${r.status ? '<span class="badge danger-badge">stornováno</span>' : ''}</td>
              <td class="small">${esc(new Date(r.issuedAt).toLocaleString('cs-CZ'))}</td>
              <td>${esc(r.payer)}${r.payerClub ? `<div class="small muted">${esc(r.payerClub)}</div>` : ''}</td>
              <td class="num">${esc(R.formatMoney(r.total))}</td>
              <td class="small">${esc(r.issuedBy)}</td>
              <td class="row-actions"><a href="#/akce/${esc(ev.id)}/doklady/${esc(r.id)}">Tisk</a>
                ${r.status ? '' : `<button type="button" class="link danger" data-storno="${esc(r.id)}">Storno</button>`}</td>
            </tr>`).join('')}</tbody></table></div>` : '<p class="muted">Zatím žádné doklady.</p>'}
      </section>`;

    const setF = (k, v) => { pay.filter[k] = v; pay.selected.clear(); renderPayments(); };
    $('#pf-club').addEventListener('change', (e) => setF('club', e.target.value));
    $('#pf-cat').addEventListener('change', (e) => setF('category', e.target.value));
    $('#pf-state').addEventListener('change', (e) => setF('state', e.target.value));
    let timer = null;
    $('#pf-q').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => { pay.filter.q = e.target.value; renderPayments(); const q = $('#pf-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 300);
    });
    const all = $('#pf-all');
    if (all) {
      const unpaid = items.filter((it) => !paid[it.key]);
      all.checked = unpaid.length > 0 && unpaid.every((it) => pay.selected.has(it.key));
      all.addEventListener('change', () => {
        unpaid.forEach((it) => { if (all.checked) pay.selected.add(it.key); else pay.selected.delete(it.key); });
        renderPayments();
      });
    }
    $$('[data-item]').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) pay.selected.add(c.dataset.item); else pay.selected.delete(c.dataset.item);
      updatePayBar();
    }));
    $$('[data-issue]').forEach((b) => b.addEventListener('click', () => issueDialog(b.dataset.issue)));
    $('#pay-clear').addEventListener('click', () => { pay.selected.clear(); renderPayments(); });
    $$('[data-storno]').forEach((b) => b.addEventListener('click', async () => {
      const r = pay.receipts.find((x) => x.id === b.dataset.storno);
      if (!confirm(`Stornovat doklad ${r.number} (${r.payer}, ${R.formatMoney(r.total)})? Položky budou znovu nezaplacené.`)) return;
      try {
        pay.receipts = (await call('cancelReceipt', { id: r.id })).receipts;
        if (memo.event[pay.event.id]) memo.event[pay.event.id].receipts = pay.receipts;
        renderPayments();
      } catch (e) { alert(e.message); }
    }));
    $('#pay-export').addEventListener('click', exportPayments);
    $('#pay-blank').addEventListener('click', blankDialog);
    updatePayBar();
  }

  function updatePayBar() {
    const chosen = pay.items.filter((it) => pay.selected.has(it.key));
    $('#pay-bar').hidden = !chosen.length;
    $('#pay-sel').innerHTML = `Vybráno <strong>${chosen.length}</strong> položek za <strong>${esc(R.formatMoney(chosen.reduce((a, it) => a + it.amount, 0)))}</strong>`;
  }

  /** Návrh, od koho platba je: jeden hráč → hráč; jinak společný klub. */
  function suggestPayer(list) {
    const persons = Array.from(new Set(list.map((it) => it.person)));
    const clubs = Array.from(new Set(list.map((it) => it.club).filter(Boolean)));
    return {
      payer: persons.length === 1 && !/^přihláška /.test(persons[0]) ? persons[0] : (clubs.length === 1 ? clubs[0] : ''),
      payerClub: clubs.length === 1 ? clubs[0] : '',
    };
  }

  function issueDialog(kind) {
    const chosen = pay.items.filter((it) => pay.selected.has(it.key));
    if (!chosen.length) return;
    let groups;
    if (kind === 'one') groups = [chosen];
    else {
      const by = {};
      chosen.forEach((it) => { const k = kind === 'person' ? it.person : it.applicationId; (by[k] = by[k] || []).push(it); });
      groups = Object.keys(by).map((k) => by[k]);
    }
    const total = (list) => list.reduce((a, it) => a + it.amount, 0);
    openDialog(`<form class="dialog-form" novalidate>
      <h2>${groups.length > 1 ? `Vystavit ${groups.length} dokladů` : 'Vystavit doklad'}</h2>
      <p class="muted small">Příjmový pokladní doklad, platba hotově. Položky se označí jako zaplacené.</p>
      <div class="issue-list">${groups.map((g, i) => {
        const sug = suggestPayer(g);
        return `<fieldset class="issue-group">
          <legend>${groups.length > 1 ? `${i + 1}. doklad – ` : ''}${esc(R.formatMoney(total(g)))}</legend>
          <ul class="small">${g.map((it) => `<li>${esc(it.label)} – ${esc(it.person)}: ${esc(R.formatMoney(it.amount))}</li>`).join('')}</ul>
          <div class="grid">
            <label>Přijato od <span class="req">*</span><input name="payer${i}" value="${esc(sug.payer)}"></label>
            <label>Klub / organizace<input name="club${i}" value="${esc(sug.payerClub)}"></label>
          </div>
        </fieldset>`;
      }).join('')}</div>
      <label class="block">Poznámka na doklad (nepovinné)<input name="note"></label>
      <div class="errors" hidden></div>
      <p class="actions"><button class="primary">Vystavit a vytisknout</button><button type="button" data-close>Zrušit</button></p>
    </form>`, (d) => {
      $('form', d).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        const box = $('.errors', d);
        const receipts = groups.map((g, i) => ({
          payer: f['payer' + i].value.trim(), payerClub: f['club' + i].value.trim(), note: f.note.value.trim(),
          items: g.map((it) => ({ key: it.key, label: it.label, person: it.person, amount: it.amount })),
        }));
        if (receipts.some((r) => !r.payer)) { box.textContent = 'Vyplňte u každého dokladu, od koho byla platba přijata.'; box.hidden = false; return; }
        try {
          const res = await call('issueReceipts', { eventId: pay.event.id, receipts });
          pay.receipts = res.receipts;
          if (memo.event[pay.event.id]) memo.event[pay.event.id].receipts = res.receipts;
          pay.selected.clear();
          dialog.close();
          location.hash = `#/akce/${pay.event.id}/doklady/${res.issued.map((r) => r.id).join(',')}`;
        } catch (err) {
          box.textContent = err.message;
          box.hidden = false;
        }
      });
    });
  }

  function receiptHtml(r) {
    const iss = r.issuer || {};
    const P = window.Payments;
    const date = new Date(r.issuedAt);
    return `<article class="receipt${r.status ? ' storno' : ''}">
      ${r.status ? '<div class="storno-mark">STORNOVÁNO</div>' : ''}
      <header class="rc-head"><h2>PŘÍJMOVÝ POKLADNÍ DOKLAD</h2><div>č. <strong>${esc(r.number)}</strong></div></header>
      <div class="rc-parties">
        <div><span class="rc-label">Příjemce</span><strong>${esc(iss.name || '')}</strong><br>${esc(iss.address || '')}${iss.ico ? `<br>IČO: ${esc(iss.ico)}` : ''}</div>
        <div><span class="rc-label">Přijato od</span><strong>${esc(r.payer)}</strong>${r.payerClub ? `<br>${esc(r.payerClub)}` : ''}</div>
      </div>
      <table class="rc-items"><thead><tr><th>Účel platby</th><th>Za koho</th><th class="num">Částka</th></tr></thead>
        <tbody>${r.items.map((it) => `<tr><td>${esc(it.label)}</td><td>${esc(it.person)}</td><td class="num">${esc(R.formatMoney(it.amount))}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">Celkem</td><td class="num">${esc(R.formatMoney(r.total))}</td></tr></tfoot></table>
      <p><span class="rc-label">Slovy</span>${esc(P.amountWords(r.total))}</p>
      <p class="rc-meta">Způsob úhrady: ${esc(r.method || 'hotově')} · Datum: ${esc(date.toLocaleDateString('cs-CZ'))}${iss.place ? ` · Místo: ${esc(iss.place)}` : ''}</p>
      ${r.note ? `<p class="small">${esc(r.note)}</p>` : ''}
      ${iss.note ? `<p class="small">${esc(iss.note)}</p>` : ''}
      <div class="rc-sign">
        <div>Vystavil: ${esc(iss.cashier || '')}<span>podpis</span></div>
        <div>Přijal (pokladník)<span>podpis</span></div>
        <div>Zaplatil<span>podpis</span></div>
      </div>
    </article>`;
  }

  function blankDialog() {
    const ev = pay.event;
    openDialog(`<form class="dialog-form">
      <h2>Prázdné doklady k tisku</h2>
      <p class="muted small">Příjmové pokladní doklady bez vyplněných údajů – pro ruční vyplnění u prezence.
        Neevidují se v aplikaci, číslo dokladu napíšete ručně.</p>
      <label class="block">Počet dokladů<input type="number" name="count" min="1" max="100" value="10"></label>
      <label class="check"><input type="checkbox" name="issuer" ${ev.issuer && ev.issuer.name ? 'checked' : 'disabled'}> předvyplnit příjemce (údaje klubu z nastavení akce)</label>
      <label class="check"><input type="checkbox" name="half" checked> dva doklady na jednu stránku A4</label>
      <p class="actions"><button class="primary">Zobrazit k tisku</button><button type="button" data-close>Zrušit</button></p>
    </form>`, (d) => {
      $('form', d).addEventListener('submit', (e) => {
        e.preventDefault();
        const f = e.target;
        const n = Math.min(100, Math.max(1, parseInt(f.count.value, 10) || 1));
        dialog.close();
        location.hash = `#/akce/${ev.id}/prazdne-doklady/${n}/${f.issuer.checked ? 1 : 0}${f.half.checked ? 1 : 0}`;
      });
    });
  }

  function blankReceiptHtml(iss, half) {
    const lines = Array.from({ length: half ? 4 : 7 }, () => '<tr><td>&nbsp;</td><td></td><td></td></tr>').join('');
    const fill = (v) => (v ? esc(v) : '<span class="blank-line"></span>');
    return `<article class="receipt blank${half ? ' half' : ''}">
      <header class="rc-head"><h2>PŘÍJMOVÝ POKLADNÍ DOKLAD</h2><div>č. <span class="blank-line short"></span></div></header>
      <div class="rc-parties">
        <div><span class="rc-label">Příjemce</span>${iss ? `<strong>${esc(iss.name)}</strong><br>${esc(iss.address || '')}${iss.ico ? `<br>IČO: ${esc(iss.ico)}` : ''}`
          : '<span class="blank-line"></span><span class="blank-line"></span><span class="blank-line"></span>'}</div>
        <div><span class="rc-label">Přijato od</span><span class="blank-line"></span><span class="blank-line"></span></div>
      </div>
      <table class="rc-items"><thead><tr><th>Účel platby</th><th>Za koho</th><th class="num">Částka</th></tr></thead>
        <tbody>${lines}</tbody>
        <tfoot><tr><td colspan="2">Celkem</td><td class="num"></td></tr></tfoot></table>
      <p><span class="rc-label">Slovy</span><span class="blank-line"></span></p>
      <p class="rc-meta">Způsob úhrady: hotově · Datum: <span class="blank-line short"></span> · Místo: ${fill(iss && iss.place)}</p>
      ${iss && iss.note ? `<p class="small">${esc(iss.note)}</p>` : ''}
      <div class="rc-sign">
        <div>Vystavil: ${iss && iss.cashier ? esc(iss.cashier) : ''}<span>podpis</span></div>
        <div>Přijal (pokladník)<span>podpis</span></div>
        <div>Zaplatil<span>podpis</span></div>
      </div>
    </article>`;
  }

  async function viewBlankReceipts(eventId, count, flags) {
    loading('Připravuji doklady…');
    if (!pay || pay.event.id !== eventId) await viewPayments(eventId);
    const iss = flags[0] === '1' ? pay.event.issuer : null;
    const half = flags[1] === '1';
    document.body.classList.add('print-receipts');
    const n = Math.min(100, Math.max(1, parseInt(count, 10) || 1));
    app.innerHTML = `
      <div class="no-print actions print-bar">
        <a href="#/akce/${esc(eventId)}/platby">← Platby a doklady</a>
        <button type="button" class="primary" id="print">Vytisknout / uložit jako PDF</button>
        <span class="small muted">${n} prázdných dokladů${half ? ', dva na stránku' : ''}.</span>
      </div>
      <div class="${half ? 'half-pages' : ''}">${Array.from({ length: n }, () => blankReceiptHtml(iss, half)).join('')}</div>`;
    $('#print').addEventListener('click', () => window.print());
  }

  const PRESENCE_MODES = [
    { id: 'jmena', label: 'Po jménech', hint: 'Abecední seznam hráčů; výpravy a družstva platí dohromady (písmeno odkazuje na souhrn na konci)' },
    { id: 'prihlasky', label: 'Po přihláškách', hint: 'Každá přihláška zvlášť s hráči, doplňky a celkovou částkou' },
    { id: 'kluby', label: 'Po klubech', hint: 'Hráči a přihlášky seskupené podle klubu s částkou za klub' },
  ];

  async function viewPresence(eventId, mode) {
    mode = PRESENCE_MODES.some((m) => m.id === mode) ? mode : 'jmena';
    loading('Připravuji seznam…');
    await loadEventData(eventId, (data) => { current = data; });
    const ev = current.event;
    const list = window.Payments.presenceList(ev, current.registrations, current.receipts || []);
    const money = (n) => (n ? esc(R.formatMoney(n)) : '');
    const due = (n, paidSomething) => (n ? money(n) : (paidSomething ? 'zaplaceno' : '–'));
    const nameCell = (p) => `<strong>${esc(p.surname)}</strong> ${esc(p.firstName)}${p.title ? ` <small>${esc(p.title)}</small>` : ''}`;

    // tabulka hráčů uvnitř bloku (přihláška / klub)
    const personsTable = (persons, opts) => `<table class="pr-table pr-inner"><thead><tr><th class="pr-box-h">Přít.</th><th>Hráč</th>
        <th class="num">Ročník</th>${opts.club ? '<th>Klub</th>' : ''}${opts.app ? '<th>Přihláška</th>' : ''}<th>Turnaje</th><th class="num">Startovné</th></tr></thead>
      <tbody>${persons.map((p) => `<tr><td class="pr-box"></td><td>${nameCell(p)}</td><td class="num">${esc(p.year)}</td>
        ${opts.club ? `<td>${esc(p.club)}</td>` : ''}${opts.app ? `<td class="pr-group">${esc(p.applicationId)}</td>` : ''}
        <td>${esc(p.tournaments.join(', '))}</td><td class="num">${money(p.ownFee) || '–'}</td></tr>`).join('')}</tbody></table>`;
    const itemsTable = (rows) => (rows.length ? `<table class="pr-items"><tbody>${rows.map((it) =>
      `<tr><td>${esc(it.label)}</td><td class="num">${money(it.amount)}</td></tr>`).join('')}</tbody></table>` : '');
    const card = (o) => `<div class="pr-group-card">
      <div class="pr-group-head">${o.letter ? `<span class="pr-letter-badge">${esc(o.letter)}</span>` : ''}
        <div class="pr-title"><strong>${esc(o.title)}</strong><div class="small">${o.sub}</div></div>
        <div class="pr-total">${due(o.total, o.paidSomething)}</div>
        <div class="pr-box big" title="zaplaceno"></div>
      </div>${o.body}</div>`;
    const appSub = (a) => [`přihláška ${esc(a.applicationId)}`, a.email ? esc(a.email) : '', R.plural(a.persons.length, 'hráč', 'hráči', 'hráčů'),
      a.teams.length ? 'družstva: ' + esc(a.teams.join(', ')) : ''].filter(Boolean).join(' · ');
    const teamOnlyNote = (a) => (a.teams.length && !a.persons.length ? '<p class="small">Soupiska zatím není vyplněná.</p>' : '');

    let body = '';
    let count = list.people.length;
    if (mode === 'jmena') {
      let lastLetter = '';
      const rows = list.people.map((p) => {
        const letter = p.surname.charAt(0).toLocaleUpperCase('cs');
        const head = letter !== lastLetter ? `<tr class="pr-letter"><td colspan="8">${esc(letter)}</td></tr>` : '';
        lastLetter = letter;
        const amount = p.group ? `<span class="pr-sub">${money(p.fee) || '–'}</span>` : (p.fee ? `<strong>${money(p.fee)}</strong>` : (p.paidSomething ? 'zaplaceno' : '–'));
        return `${head}<tr>
          <td class="pr-box"></td><td>${nameCell(p)}</td><td class="num">${esc(p.year)}</td><td>${esc(p.club)}</td>
          <td>${esc(p.tournaments.join(', '))}${p.extras && p.extras.length ? `<div class="pr-extras">${esc(p.extras.join(', '))}</div>` : ''}</td>
          <td class="num">${amount}</td>
          <td class="pr-group">${p.group ? `výprava <strong>${esc(p.group)}</strong>` : ''}</td>
          <td class="pr-box"></td></tr>`;
      }).join('');
      const groups = list.groups.map((g) => card({
        letter: g.letter, title: g.club || g.teams.join(', ') || 'přihláška ' + g.applicationId, sub: appSub(g),
        total: g.total, paidSomething: g.paidSomething,
        body: teamOnlyNote(g) + itemsTable((g.playersFee ? [{ label: `Startovné hráčů (${g.persons.filter((p) => p.ownFee).length})`, amount: g.playersFee }] : []).concat(g.items)),
      })).join('');
      body = `<table class="pr-table">
          <thead><tr><th class="pr-box-h">Přít.</th><th>Hráč</th><th class="num">Ročník</th><th>Klub</th><th>Turnaje / doplňky</th>
            <th class="num">K úhradě</th><th>Platí</th><th class="pr-box-h">Zapl.</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="8">Zatím nikdo není přihlášený.</td></tr>'}</tbody>
        </table>
        ${groups ? `<section class="pr-groups"><h2>Výpravy a družstva – platí vedoucí za celou přihlášku</h2>
          <p class="small">U hráčů výpravy je v seznamu jen jejich startovné (šedě). Celková částka výpravy vč. obědů a ubytování je tady.</p>
          ${groups}</section>` : ''}`;
    } else if (mode === 'prihlasky') {
      count = list.applications.length;
      body = list.applications.map((a) => card({
        title: a.single ? a.persons[0].name : (a.club || a.teams.join(', ') || 'přihláška ' + a.applicationId),
        sub: appSub(a), total: a.total, paidSomething: a.paidSomething,
        body: (a.persons.length ? personsTable(a.persons, { club: !a.single }) : teamOnlyNote(a)) + itemsTable(a.items),
      })).join('') || '<p>Zatím nikdo není přihlášený.</p>';
    } else {
      count = list.clubs.length;
      body = list.clubs.map((c) => {
        const multi = c.applications.length > 1;
        const items = [];
        c.applications.forEach((a) => a.items.forEach((it) => items.push({ label: (multi ? `přihl. ${a.applicationId}: ` : '') + it.label, amount: it.amount })));
        const subtotals = multi ? c.applications.filter((a) => a.total).map((a) => `${esc(a.applicationId)}${a.email ? ' (' + esc(a.email) + ')' : ''}: ${money(a.total)}`).join(' · ') : '';
        return card({
          title: c.club || 'bez klubu', total: c.total, paidSomething: c.paidSomething,
          sub: [R.plural(c.persons.length, 'hráč', 'hráči', 'hráčů'), R.plural(c.applications.length, 'přihláška', 'přihlášky', 'přihlášek'),
            c.applications.some((a) => a.teams.length) ? 'družstva: ' + esc([].concat(...c.applications.map((a) => a.teams)).join(', ')) : ''].filter(Boolean).join(' · '),
          body: (c.persons.length ? personsTable(c.persons, { app: multi, club: c.persons.some((p) => p.club !== c.club) }) : '')
            + itemsTable(items) + (subtotals ? `<p class="small pr-subtotals">Po přihláškách: ${subtotals}</p>` : ''),
        });
      }).join('') || '<p>Zatím nikdo není přihlášený.</p>';
    }

    const m = PRESENCE_MODES.find((x) => x.id === mode);
    document.body.classList.add('print-receipts');
    app.innerHTML = `
      <div class="no-print print-bar">
        <p class="back small"><a href="#/akce/${esc(eventId)}">← ${esc(ev.name)}</a></p>
        <div class="actions">
          <span class="small muted">Seznam:</span>
          ${PRESENCE_MODES.map((x) => `<a class="chip${x.id === mode ? ' active' : ''}" href="#/akce/${esc(eventId)}/prezence/${x.id}"
            ${x.id === mode ? 'aria-current="page"' : ''}>${esc(x.label)}</a>`).join('')}
          <button type="button" class="primary" id="print">Vytisknout / uložit jako PDF</button>
        </div>
        <p class="small muted">${esc(m.hint)}. Částky jsou bez položek, na které už byl vystaven doklad – vytiskněte těsně před prezencí.</p>
      </div>
      <article class="presence">
        <header class="pr-head">
          <h1>${esc(ev.name)} – prezence (${esc(m.label.toLowerCase())})</h1>
          <p>${esc([R.formatRange(ev.dateFrom, ev.dateTo), ev.place].filter(Boolean).join(' · '))} ·
            ${R.plural(list.people.length, 'hráč', 'hráči', 'hráčů')}${mode === 'prihlasky' ? ' · ' + R.plural(count, 'přihláška', 'přihlášky', 'přihlášek') : ''}${mode === 'kluby' ? ' · ' + R.plural(count, 'klub', 'kluby', 'klubů') : ''}
            · k úhradě celkem ${money(list.total) || '0 Kč'} · stav k ${esc(new Date().toLocaleString('cs-CZ'))}</p>
        </header>
        ${body}
      </article>`;
    $('#print').addEventListener('click', () => window.print());
  }

  async function viewReceipts(eventId, ids) {
    loading('Připravuji doklady…');
    if (!pay || pay.event.id !== eventId) await viewPayments(eventId);
    const list = ids.split(',').map((id) => pay.receipts.find((r) => r.id === id)).filter(Boolean);
    document.body.classList.add('print-receipts');
    app.innerHTML = `
      <div class="no-print actions print-bar">
        <a href="#/akce/${esc(eventId)}/platby">← Platby a doklady</a>
        <button type="button" class="primary" id="print">Vytisknout / uložit jako PDF</button>
        <span class="small muted">${list.length > 1 ? `${list.length} dokladů – každý vyjde na samostatné stránce.` : ''}</span>
      </div>
      ${list.map(receiptHtml).join('')}`;
    $('#print').addEventListener('click', () => window.print());
  }

  async function exportPayments() {
    const paid = window.Payments.paidMap(pay.receipts);
    const head = ['Za koho', 'Klub', 'Kategorie', 'Položka', 'Kč', 'Přihláška', 'E-mail', 'Zaplaceno dokladem'];
    const rows = payFiltered().map((it) => [it.person, it.club, it.category, it.label, it.amount, it.applicationId, it.email, paid[it.key] ? paid[it.key].number : '']);
    const rHead = ['Číslo', 'Datum', 'Přijato od', 'Klub', 'Kč', 'Stav', 'Vystavil', 'Položky'];
    const rRows = pay.receipts.map((r) => [r.number, new Date(r.issuedAt).toLocaleString('cs-CZ'), r.payer, r.payerClub, r.total, r.status || 'platný', r.issuedBy,
      r.items.map((it) => `${it.label} (${it.person}) ${it.amount}`).join('; ')]);
    try {
      await downloadXlsx(`${fileSafe(pay.event.slug)}_platby.xlsx`, [
        { name: 'Položky', rows: [head].concat(rows) }, { name: 'Doklady', rows: [rHead].concat(rRows) },
      ]);
    } catch (e) { alert(e.message); }
  }

  // =====================================================================
  // Správci
  // =====================================================================

  async function viewUsers() {
    loading();
    if (!me) me = (await call('me')).user;
    updateBar();
    const data = await call('users');
    renderUsers(data.users);
  }

  function renderUsers(users) {
    const roleOpts = { organizer: 'pořadatel (jen své akce)', superadmin: 'hlavní správce (vše)' };
    app.innerHTML = `
      <h1>Správci</h1>
      <p class="muted">Kdo se může přihlásit do administrace. Pořadatel vidí jen akce, které založil nebo u kterých je uveden jako správce.</p>
      <div class="card table-wrap"><table class="admin-table">
        <thead><tr><th>E-mail (Google účet)</th><th>Jméno</th><th>Klub</th><th>Role</th><th>Aktivní</th><th></th></tr></thead>
        <tbody>${users.map((u) => `<tr data-email="${esc(u.email)}">
          <td>${esc(u.email)}</td>
          <td><input data-f="name" value="${esc(u.name || '')}"></td>
          <td><input data-f="club" value="${esc(u.club || '')}"></td>
          <td><select data-f="role">${options(roleOpts, u.role)}</select></td>
          <td><select data-f="active">${options({ ANO: 'ano', NE: 'ne' }, u.active === 'NE' ? 'NE' : 'ANO')}</select></td>
          <td><button type="button" class="link" data-save>Uložit</button></td>
        </tr>`).join('')}</tbody></table></div>
      <form class="card" id="add-user">
        <h2>Přidat správce</h2>
        <div class="grid grid-3">
          <label>E-mail (Google účet) <span class="req">*</span><input name="email" type="email"></label>
          <label>Jméno<input name="name"></label>
          <label>Klub<input name="club"></label>
          <label>Role<select name="role">${options(roleOpts, 'organizer')}</select></label>
        </div>
        <div id="user-errors"></div>
        <p class="actions"><button class="primary">Přidat</button></p>
      </form>`;

    const save = async (user) => {
      $('#user-errors').innerHTML = '';
      try {
        renderUsers((await call('saveUser', { user })).users);
      } catch (e) {
        $('#user-errors').innerHTML = errorBox(e);
      }
    };
    $$('[data-save]').forEach((b) => b.addEventListener('click', () => {
      const tr = b.closest('tr');
      save({
        email: tr.dataset.email,
        name: $('[data-f="name"]', tr).value, club: $('[data-f="club"]', tr).value,
        role: $('[data-f="role"]', tr).value, active: $('[data-f="active"]', tr).value,
      });
    }));
    $('#add-user').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      save({ email: f.email.value, name: f.name.value, club: f.club.value, role: f.role.value, active: 'ANO' });
    });
  }

  // =====================================================================
  // Směrování
  // =====================================================================

  async function route() {
    if (!getToken()) { showLogin(); return; }
    const h = location.hash.replace(/^#/, '') || '/';
    if (dialog.open) dialog.close();
    document.querySelectorAll('#nav a[href^="#"]').forEach((a) => {
      const target = a.getAttribute('href').slice(1);
      const on = target === '/' ? !h.startsWith('/spravci') : h.startsWith(target);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.body.classList.remove('print-receipts');
    try {
      if (!me && h !== '/') {
        me = (await call('me')).user;
        updateBar();
      }
      let m;
      if (h === '/') await viewEvents();
      else if (h === '/akce/nova') await viewEditor(null);
      else if ((m = h.match(/^\/akce\/([^/]+)\/upravit$/))) await viewEditor(m[1]);
      else if ((m = h.match(/^\/akce\/([^/]+)\/platby$/))) await viewPayments(m[1]);
      else if ((m = h.match(/^\/akce\/([^/]+)\/prezence(?:\/([a-z]+))?$/))) await viewPresence(m[1], m[2]);
      else if ((m = h.match(/^\/akce\/([^/]+)\/doklady\/([^/]+)$/))) await viewReceipts(m[1], m[2]);
      else if ((m = h.match(/^\/akce\/([^/]+)\/prazdne-doklady\/(\d+)\/([01]{2})$/))) await viewBlankReceipts(m[1], m[2], m[3]);
      else if ((m = h.match(/^\/akce\/([^/]+)$/))) await viewEvent(m[1]);
      else if (h === '/spravci') await viewUsers();
      else location.hash = '#/';
      window.scrollTo(0, 0);
    } catch (e) {
      if (e.code !== 'auth') app.innerHTML = errorBox(e) + '<p><a href="#/">← Zpět na přehled</a></p>';
    }
  }

  window.addEventListener('hashchange', route);
  window.Api.loadConfig().then((c) => { cfg = c; route(); }).catch((e) => { app.innerHTML = errorBox(e); });
})();
