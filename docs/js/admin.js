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
    try { t = sessionStorage.getItem(TOKEN_KEY); } catch (e) { /* soukromé okno */ }
    if (!t) return null;
    const p = tokenPayload(t);
    if (!p || p.exp * 1000 < Date.now() + 30000) {
      clearToken();
      return null;
    }
    return t;
  }

  function setToken(t) { try { sessionStorage.setItem(TOKEN_KEY, t); } catch (e) { /* nic */ } }
  function clearToken() { try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* nic */ } }

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
    loading('Načítám akce…');
    const data = await call('events');
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
    const nextName = ev.name.replace(/\b(20\d\d)\b/, (y) => String(+y + 1));
    openDialog(`<form method="dialog" class="dialog-form">
      <h2>Kopírovat akci</h2>
      <p class="muted small">Zkopírují se údaje, turnaje i doplňující otázky. Přihlášky ne. Kopie bude ve stavu „rozpracovaná“.</p>
      <label class="block">Název nové akce<input name="name" value="${esc(nextName)}"></label>
      <label class="block">Posunout data a ročníky o
        <select name="shift"><option value="0">0 let</option><option value="1" selected>1 rok</option><option value="2">2 roky</option></select>
        <span class="hint">Např. „ročník 2014 a mladší“ se změní na 2015.</span></label>
      <div class="errors" hidden></div>
      <p class="actions"><button class="primary" value="ok">Kopírovat</button><button type="button" data-close>Zrušit</button></p>
    </form>`, (d) => {
      $('form', d).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        try {
          const res = await call('copyEvent', { id: ev.id, name: f.name.value, shiftYears: +f.shift.value });
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
        ${numInput('minBirthYear', 'Jen ročník … a mladší', t.minBirthYear, 'vynucuje se')}
        ${numInput('maxBirthYear', 'Jen ročník … a starší', t.maxBirthYear, 'vynucuje se')}
        ${numInput('warnMaxRating', 'Upozornit nad ELO', t.warnMaxRating, 'jen upozornění')}
        ${numInput('capacity', 'Kapacita', t.capacity, 'hráčů / družstev, prázdné = bez omezení')}
        <span class="team-only">${numInput('boards', 'Počet šachovnic', t.boards || 4)}</span>
        <span class="team-only">${numInput('reserves', 'Počet náhradníků', t.reserves || 0)}</span>
      </div>
    </div>`;
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
        <label class="wide options-field">Možnosti (každá na nový řádek)<textarea data-f="options" rows="3">${esc((x.options || []).join('\n'))}</textarea></label>
      </div>
    </div>`;
  }

  function bindCard(card) {
    const typeSel = $('[data-f="type"]', card);
    const sync = () => {
      if (card.classList.contains('tour-card')) {
        $$('.team-only', card).forEach((el) => { el.hidden = typeSel.value !== 'team'; });
      } else {
        $('.options-field', card).hidden = !(typeSel.value === 'checkboxes' || typeSel.value === 'select');
      }
    };
    typeSel.addEventListener('change', sync);
    sync();
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
    const statusOpts = {};
    Object.keys(R.STATUS_LABELS).forEach((k) => { statusOpts[k] = R.STATUS_LABELS[k]; });

    app.innerHTML = `
      <p class="small"><a href="${id ? '#/akce/' + esc(id) : '#/'}">← Zpět</a></p>
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
          <button type="button" class="button" id="add-extra">+ Přidat otázku</button>
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
        tournaments: $$('.tour-card', tours).map((c) => ({
          id: c.dataset.id || undefined,
          name: val(c, 'name'), short: val(c, 'short'), day: val(c, 'day'), type: val(c, 'type'),
          minBirthYear: val(c, 'minBirthYear'), maxBirthYear: val(c, 'maxBirthYear'),
          warnMaxRating: val(c, 'warnMaxRating'), capacity: val(c, 'capacity'),
          boards: val(c, 'boards'), reserves: val(c, 'reserves'),
        })),
        extras: $$('.extra-card', extras).map((c) => {
          const m = val(c, 'modes');
          return {
            id: c.dataset.id || undefined,
            label: val(c, 'label'), type: val(c, 'type'), help: val(c, 'help'),
            options: val(c, 'options').split('\n').map((s) => s.trim()).filter(Boolean),
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

  async function viewEvent(id) {
    loading('Načítám přihlášky…');
    current = await call('event', { id });
    renderEvent();
  }

  function extrasText(r) {
    let data = {};
    try { data = JSON.parse(r.extras || '{}'); } catch (e) { /* nic */ }
    return (current.event.extras || []).map((x) => {
      const v = data[x.id];
      const t = Array.isArray(v) ? v.join(', ') : v;
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
      const teams = {};
      shown.forEach((r) => { (teams[r.team] = teams[r.team] || []).push(r); });
      const names = Object.keys(teams).sort((a, b) => a.localeCompare(b, 'cs'));
      return names.length ? names.map((n) => {
        const rows = teams[n].sort((a, b) => a.board - b.board);
        return `<h3>${esc(n)} <span class="small muted">kapitán: ${esc(rows[0].captain || '')}</span></h3>
          <div class="table-wrap"><table class="admin-table">${regHead}<tbody>${rows.map(regRow).join('')}</tbody></table></div>`;
      }).join('') : '<p class="muted">Zatím žádné přihlášky.</p>';
    }
    const sorted = shown.slice().sort((a, b) => window.SM.byRating(window.SM.regToPlayer(a), window.SM.regToPlayer(b)));
    return sorted.length
      ? `<div class="table-wrap"><table class="admin-table">${regHead}<tbody>${sorted.map(regRow).join('')}</tbody></table></div>`
      : '<p class="muted">Zatím žádné přihlášky.</p>';
  }

  function extrasSummary() {
    const ev = current.event;
    // počítají se osoby (hráč může mít v přihlášce víc turnajů = víc řádků; výprava = víc hráčů)
    const persons = {};
    current.registrations.filter((r) => r.status !== 'zrušeno').forEach((r) => {
      const key = `${r.applicationId}|${R.norm(r.surname + ' ' + r.firstName)}|${r.year}`;
      if (!persons[key]) persons[key] = r;
    });
    const list = Object.keys(persons).map((k) => persons[k]);
    const parts = (ev.extras || []).filter((x) => x.type === 'checkboxes' || x.type === 'select').map((x) => {
      const counts = x.options.map((o) => {
        const who = list.filter((r) => {
          let d = {};
          try { d = JSON.parse(r.extras || '{}'); } catch (e) { /* nic */ }
          const v = d[x.id];
          return Array.isArray(v) ? v.includes(o) : v === o;
        }).map((r) => `${r.surname} ${r.firstName}`);
        return `<li><strong>${esc(o)}: ${who.length}</strong>${who.length ? ` <span class="small muted">(${esc(who.join(', '))})</span>` : ''}</li>`;
      }).join('');
      return `<div><h3>${esc(x.label)}</h3><ul>${counts}</ul></div>`;
    });
    return parts.length ? `<section class="card"><h2>Souhrn doplňujících otázek <span class="small muted">(počty osob)</span></h2><div class="summary-grid">${parts.join('')}</div></section>` : '';
  }

  function renderEvent() {
    const ev = current.event;
    const publicUrl = `prihlaska.html?akce=${encodeURIComponent(ev.slug)}`;
    const listUrl = `seznam.html?akce=${encodeURIComponent(ev.slug)}`;
    const canOpen = ev.status !== 'otevreno';
    app.innerHTML = `
      <p class="small"><a href="#/">← Všechny akce</a></p>
      <div class="page-head">
        <div>
          <h1>${esc(ev.name)}</h1>
          <p class="muted">${esc([R.formatRange(ev.dateFrom, ev.dateTo), ev.place, ev.deadline ? 'uzávěrka ' + R.formatDate(ev.deadline) : ''].filter(Boolean).join(' · '))}
            · ${statusBadge(ev.status)}</p>
        </div>
        <div class="actions">
          <button type="button" class="button ${canOpen ? 'primary' : ''}" id="toggle-status">${canOpen ? 'Otevřít přihlašování' : 'Uzavřít přihlašování'}</button>
          <a class="button" href="#/akce/${esc(ev.id)}/upravit">Upravit akci</a>
        </div>
      </div>
      <p class="links">
        <a href="${publicUrl}" target="_blank">Formulář ↗</a>
        <a href="${listUrl}" target="_blank">Veřejný seznam ↗</a>
        <button type="button" class="link" id="copy-link">Zkopírovat odkaz na formulář</button>
      </p>
      ${ev.status === 'koncept' ? '<p class="notice-inline">Akce je rozpracovaná – formulář ani seznam zatím nejsou veřejné.</p>' : ''}

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
              <button type="button" class="button small-btn" data-export-txt="${esc(t.id)}">.TXT</button>
              <button type="button" class="button small-btn" data-export-xlsx="${esc(t.id)}">.xlsx</button>
            </div>
          </div>
          ${tournamentTable(t)}
        </section>`;
      }).join('')}
      ${extrasSummary()}
      ${changesSection()}`;

    $('#show-cancelled').addEventListener('change', (e) => { showCancelled = e.target.checked; renderEvent(); });
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
    $('#export-all').addEventListener('click', exportAll);
    $$('[data-export-txt]').forEach((b) => b.addEventListener('click', () => exportTournament(b.dataset.exportTxt, 'txt')));
    $$('[data-export-xlsx]').forEach((b) => b.addEventListener('click', () => exportTournament(b.dataset.exportXlsx, 'xlsx')));
    $$('[data-toggle]').forEach((b) => b.addEventListener('click', () => toggleRegistration(b.dataset.toggle)));
    $$('[data-edit]').forEach((b) => b.addEventListener('click', () => editRegistrationDialog(b.dataset.edit)));
  }

  function smTableFor(t) {
    const regs = current.registrations.filter((r) => r.tournamentId === t.id && r.status !== 'zrušeno');
    return t.type === 'team'
      ? window.SM.buildTeamTable(regs, smOpts())
      : window.SM.buildSmTable(regs.map(window.SM.regToPlayer), smOpts());
  }

  async function exportTournament(id, kind) {
    const t = current.event.tournaments.find((x) => x.id === id);
    const table = smTableFor(t);
    const name = `${fileSafe(current.event.slug)}_${fileSafe(t.short || t.name)}${t.type === 'team' ? '_soupisky' : ''}`;
    try {
      if (kind === 'txt') download(name + '.TXT', window.SM.toSmText(table));
      else await downloadXlsx(name + '.xlsx', [{ name: t.short || t.name, rows: table }]);
    } catch (e) { alert(e.message); }
  }

  async function exportAll() {
    const ev = current.event;
    const tName = (id) => { const t = ev.tournaments.find((x) => x.id === id); return t ? t.short || t.name : id; };
    const extrasOf = (r) => { try { return JSON.parse(r.extras || '{}'); } catch (e) { return {}; } };
    const extraVal = (d, x) => (Array.isArray(d[x.id]) ? d[x.id].join(', ') : d[x.id] || '');
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
    current.registrations.forEach((r) => {
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

    const cHeader = ['Kdy', 'Kdo', 'Co', 'Podrobnosti', 'Č. přihlášky'];
    const cRows = (current.changes || []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)))
      .map((c) => [when(c.at), c.by, c.action, c.detail, c.applicationId]);
    try {
      await downloadXlsx(`${fileSafe(ev.slug)}_prihlasky.xlsx`, [
        { name: 'Přihlášky', rows: [header].concat(rows) },
        { name: 'Osoby a doplňky', rows: [pHeader].concat(pRows) },
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
    try {
      if (!me && h !== '/') {
        me = (await call('me')).user;
        updateBar();
      }
      let m;
      if (h === '/') await viewEvents();
      else if (h === '/akce/nova') await viewEditor(null);
      else if ((m = h.match(/^\/akce\/([^/]+)\/upravit$/))) await viewEditor(m[1]);
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
