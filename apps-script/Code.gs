/**
 * Přihlášky na šachový festival – Google Apps Script vázaný na Google Sheet.
 *
 *  - doPost: uloží přihlášku z formuláře (GitHub Pages) do listu „Přihlášky“
 *  - doGet?action=list: veřejný seznam přihlášených
 *  - menu „Šachový festival“: export pro Swiss-Manager, souhrn doprava/ubytování
 *
 * Nastavení (turnaje, ročníky, doplňky) se čte z config.json na webu,
 * adresa je ve vlastnosti skriptu CONFIG_URL (menu → Nastavit adresu konfigurace).
 */

const SHEET_NAME = 'Přihlášky';
const SUMMARY_SHEET_NAME = 'Souhrn';
const STATUS_COLUMN = 'Stav';
const CANCELLED_RE = /zru[sš]/i; // „zrušeno“ ve sloupci Stav = přihláška se nikde nepočítá
const YES = 'ANO';

const BASE_COLUMNS = [
  'Časová značka', 'ID přihlášky', 'Druh', 'E-mail',
  'Příjmení', 'Jméno', 'Rok narození', 'Pohlaví', 'Titul',
  'ID č.', 'FIDE ID', 'Rating nár', 'Rating FIDE', 'Fed', 'Č.klubu', 'Klub / město', 'Sk.', 'V LOK',
  'Družstvo', 'Šachovnice', 'Kapitán',
];

// Přesně podle exportu ze Swiss-Manageru (včetně mezery v „ Fed“).
const SM_HEADER = [
  'Č.', 'Jméno', 'Titul', 'ID č.', 'Rating nár', 'Rating FIDE', 'Narozen', ' Fed', 'Pohl.', 'Typ', 'Sk.',
  'Č.klubu', 'Klub', 'FIDE ID', 'Zdroj', 'body', 'tb1', 'tb2', 'tb3', 'tb4', 'tb5', 'tb6', 'poř.',
  'surname', 'first name', 'atitle',
];

// =====================================================================
// Web app
// =====================================================================

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  try {
    if (action === 'list') return json_(publicList_());
    return json_({ ok: true, message: 'API přihlášek běží.' });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Neplatná data přihlášky.' });
  }
  if (data && data.web) return json_({ ok: true, id: '-' }); // vyplněná past na roboty

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    return json_({ ok: false, error: 'Server je právě vytížený, zkuste to prosím za chvíli znovu.' });
  }
  let result;
  let config;
  try {
    config = getConfig_();
    const sheet = getSheet_(config);
    const existing = readRegistrations_(sheet);
    result = processRegistration_(data, config, existing, new Date());
    if (!result.ok) return json_(result);
    appendRows_(sheet, result.rows);
    SpreadsheetApp.flush();
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'Přihlášku se nepodařilo uložit: ' + ((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }

  if (config.confirmationEmail !== false) {
    try {
      sendConfirmation_(config, data.email, result);
    } catch (err) {
      console.error('E-mail se nepodařilo odeslat', err);
    }
  }
  return json_({ ok: true, id: result.id });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// =====================================================================
// Zpracování přihlášky (čisté funkce – testují se i mimo Google)
// =====================================================================

function processRegistration_(data, config, existing, now) {
  const festivalYear = Number(config.festival.year) || now.getFullYear();
  if (isClosed_(config, now)) return fail_('Přihlašování je již uzavřeno.');
  if (!data || typeof data !== 'object') return fail_('Neplatná data přihlášky.');

  const email = clean_(data.email, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail_('Vyplňte platný e-mail.');

  const mode = data.mode === 'team' ? 'team' : 'individual';
  const extras = cleanExtras_(config, data.extras || {}, mode);
  const active = activeRows_(existing);
  const id = makeId_(now);

  const common = { 'Časová značka': now, 'ID přihlášky': id, 'E-mail': email };
  Object.keys(extras).forEach((k) => { common[k] = extras[k]; });

  if (mode === 'individual') {
    const p = cleanPlayer_(data.player, festivalYear);
    if (p.error) return fail_(p.error);
    const codes = Array.isArray(data.tournaments) ? data.tournaments.map(String) : [];
    const tours = config.tournaments.filter((t) => t.type !== 'team' && codes.indexOf(t.code) >= 0);
    if (!tours.length) return fail_('Vyberte alespoň jeden turnaj.');

    for (const t of tours) {
      const block = eligibility_(t, p);
      if (block) return fail_(`${fullName_(p)}: turnaj „${tourCol_(t)}“ je ${block}.`);
      const col = tourCol_(t);
      const inTour = active.filter((r) => r[col] === YES);
      if (inTour.some((r) => samePlayer_(rowToPlayer_(r), p))) {
        return fail_(`${fullName_(p)} je do turnaje „${col}“ už přihlášen(a).`);
      }
      if (t.capacity && inTour.length >= t.capacity) return fail_(`Turnaj „${col}“ je již naplněn.`);
    }

    const row = Object.assign({}, common, playerToRow_(p), { 'Druh': 'jednotlivec' });
    tours.forEach((t) => { row[tourCol_(t)] = YES; });
    return {
      ok: true, id, rows: [row],
      summary: { players: [fullName_(p)], tournaments: tours.map(tourTitle_), extras },
    };
  }

  // ---- družstvo ----
  const team = data.team || {};
  const t = config.tournaments.find((x) => x.type === 'team' && x.code === String(team.tournament));
  if (!t) return fail_('Vyberte soutěž družstev.');
  const col = tourCol_(t);
  const teamName = clean_(team.name, 100);
  const captain = clean_(team.captain, 100);
  if (!teamName) return fail_('Vyplňte název družstva.');
  if (!captain) return fail_('Vyplňte kapitána / vedoucího družstva.');

  const boards = t.boards || 4;
  const reserves = t.reserves || 0;
  const raw = Array.isArray(team.players) ? team.players : [];
  const players = [];
  for (let i = 0; i < boards + reserves; i++) {
    const label = i < boards ? `${i + 1}. šachovnice` : 'Náhradník';
    if (!raw[i]) {
      if (i < boards) return fail_(`${label}: vyberte hráče.`);
      continue;
    }
    const p = cleanPlayer_(raw[i], festivalYear);
    if (p.error) return fail_(`${label}: ${p.error}`);
    const block = eligibility_(t, p);
    if (block) return fail_(`${fullName_(p)}: soutěž je ${block}.`);
    if (players.some((q) => samePlayer_(q.p, p))) return fail_(`${fullName_(p)} je v družstvu uveden dvakrát.`);
    players.push({ p, board: i + 1 });
  }

  const inTour = active.filter((r) => r[col] === YES);
  const teamNames = uniq_(inTour.map((r) => norm_(r['Družstvo'])));
  if (teamNames.indexOf(norm_(teamName)) >= 0) return fail_(`Družstvo „${teamName}“ už je přihlášeno.`);
  if (t.capacity && teamNames.length >= t.capacity) return fail_(`Soutěž „${col}“ je již naplněna.`);
  for (const { p } of players) {
    const clash = inTour.find((r) => samePlayer_(rowToPlayer_(r), p));
    if (clash) return fail_(`${fullName_(p)} už hraje za družstvo „${clash['Družstvo']}“.`);
  }

  const rows = players.map(({ p, board }) => {
    const row = Object.assign({}, common, playerToRow_(p), {
      'Druh': 'družstvo', 'Družstvo': teamName, 'Šachovnice': board, 'Kapitán': captain,
    });
    row[col] = YES;
    return row;
  });
  return {
    ok: true, id, rows,
    summary: {
      team: teamName, captain,
      players: players.map(({ p, board }) => `${board > boards ? 'N' : board}. ${fullName_(p)}`),
      tournaments: [tourTitle_(t)], extras,
    },
  };
}

function cleanPlayer_(raw, festivalYear) {
  if (!raw || typeof raw !== 'object') {
    return { error: 'Vyberte hráče ze seznamu, nebo zaškrtněte „Nejsem v seznamu LOK“ a vyplňte údaje.' };
  }
  const p = {
    registered: !!raw.registered && toInt_(raw.id) > 0,
    id: toInt_(raw.id),
    surname: clean_(raw.surname, 60),
    firstName: clean_(raw.firstName, 60),
    year: toInt_(raw.year),
    sex: raw.sex === 'F' ? 'F' : '',
    title: clean_(raw.title, 5),
    fide: toInt_(raw.fide),
    fed: (clean_(raw.fed, 3) || 'CZE').toUpperCase(),
    rn: toInt_(raw.rn),
    rf: toInt_(raw.rf),
    clubNo: toInt_(raw.clubNo),
    club: clean_(raw.club, 100),
    status: clean_(raw.status, 3),
  };
  if (!p.registered) Object.assign(p, { id: 0, rn: 0, rf: 0, title: '', clubNo: 0, status: '' });
  if (!p.surname || !p.firstName) return { error: 'Vyplňte jméno a příjmení hráče.' };
  if (!(p.year >= 1900 && p.year <= festivalYear)) return { error: `${fullName_(p)}: vyplňte platný rok narození.` };
  if (!p.club) return { error: `${fullName_(p)}: vyplňte klub, nebo u neregistrovaných město.` };
  return p;
}

function cleanExtras_(config, raw, mode) {
  const out = {};
  (config.extras || []).forEach((x) => {
    const modes = x.modes || ['individual', 'team'];
    if (modes.indexOf(mode) < 0) return;
    const col = extraCol_(x);
    const v = raw[x.id];
    if (x.type === 'checkboxes') {
      const arr = Array.isArray(v) ? v.map(String) : [];
      out[col] = (x.options || []).filter((o) => arr.indexOf(o) >= 0).join(', ');
    } else if (x.type === 'select') {
      out[col] = (x.options || []).indexOf(String(v)) >= 0 ? String(v) : '';
    } else {
      out[col] = clean_(v, 2000);
    }
  });
  return out;
}

function eligibility_(t, p) {
  if (t.minBirthYear && p.year < t.minBirthYear) return `jen pro ročník ${t.minBirthYear} a mladší`;
  if (t.maxBirthYear && p.year > t.maxBirthYear) return `jen pro ročník ${t.maxBirthYear} a starší`;
  return '';
}

function isClosed_(config, now) {
  const d = config.festival && config.festival.deadline;
  if (!d) return false;
  const end = new Date(String(d).indexOf('T') >= 0 ? d : d + 'T23:59:59');
  return !isNaN(end.getTime()) && now > end;
}

function samePlayer_(a, b) {
  if (a.id && b.id) return a.id === b.id;
  return norm_(a.surname + ' ' + a.firstName) === norm_(b.surname + ' ' + b.firstName) && a.year === b.year;
}

function playerToRow_(p) {
  return {
    'Příjmení': p.surname, 'Jméno': p.firstName, 'Rok narození': p.year, 'Pohlaví': p.sex,
    'Titul': p.title, 'ID č.': p.id || '', 'FIDE ID': p.fide || '', 'Rating nár': p.rn || '',
    'Rating FIDE': p.rf || '', 'Fed': p.fed, 'Č.klubu': p.clubNo || '', 'Klub / město': p.club,
    'Sk.': p.status, 'V LOK': p.registered ? YES : 'NE',
  };
}

function rowToPlayer_(r) {
  return {
    registered: r['V LOK'] === YES,
    id: toInt_(r['ID č.']),
    surname: String(r['Příjmení'] || ''),
    firstName: String(r['Jméno'] || ''),
    year: toInt_(r['Rok narození']),
    sex: r['Pohlaví'] === 'F' ? 'F' : '',
    title: String(r['Titul'] || ''),
    fide: toInt_(r['FIDE ID']),
    fed: String(r['Fed'] || 'CZE'),
    rn: toInt_(r['Rating nár']),
    rf: toInt_(r['Rating FIDE']),
    clubNo: toInt_(r['Č.klubu']),
    club: String(r['Klub / město'] || ''),
    status: String(r['Sk.'] || ''),
  };
}

// ---- drobnosti ----

function tourCol_(t) { return t.short || t.code; }
function tourTitle_(t) { return (t.day ? t.day + ' – ' : '') + t.name; }
function extraCol_(x) { return x.short || x.label || x.id; }
function fullName_(p) { return `${p.surname} ${p.firstName}`.trim(); }
function fail_(error) { return { ok: false, error }; }
function uniq_(arr) { return arr.filter((v, i) => v && arr.indexOf(v) === i); }
function toInt_(v) { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; }

function norm_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Ořízne text a zabrání tomu, aby se z něj v tabulce stal vzorec.
function clean_(v, max) {
  let s = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, (c) => (c === '\n' ? '\n' : ' ')).trim();
  if (max) s = s.slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function makeId_(now) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  const pad = (n) => (n < 10 ? '0' : '') + n;
  return `${pad(now.getMonth() + 1)}${pad(now.getDate())}-${suffix}`;
}

function activeRows_(rows) {
  return rows.filter((r) => r['Příjmení'] && !CANCELLED_RE.test(String(r[STATUS_COLUMN] || '')));
}

// =====================================================================
// Swiss-Manager (čisté funkce)
// =====================================================================

function ageCategory_(year, config) {
  if (!year) return '';
  const age = (Number(config.festival.year) || new Date().getFullYear()) - year;
  for (const c of config.ageCategories || []) {
    if (c.maxAge != null && age <= c.maxAge) return c.code;
    if (c.minAge != null && age >= c.minAge) return c.code;
  }
  return '';
}

function smType_(p, config) {
  return [ageCategory_(p.year, config), p.registered ? '' : (config.unregisteredCategory || '')]
    .filter(Boolean).join(', ');
}

function sortByRating_(a, b) {
  return (b.rf - a.rf) || (b.rn - a.rn) || fullName_(a).localeCompare(fullName_(b), 'cs');
}

function smRow_(p, no, config) {
  const row = {
    'Č.': no,
    'Jméno': fullName_(p),
    'Titul': p.title || '',
    'ID č.': p.id || '',
    'Rating nár': p.rn || 0,
    'Rating FIDE': p.rf || 0,
    'Narozen': '00.00.' + (p.year || '0000'),
    ' Fed': p.fed || 'CZE',
    'Pohl.': p.sex || '',
    'Typ': smType_(p, config),
    'Sk.': p.status || '',
    'Č.klubu': p.clubNo || 0,
    'Klub': p.club || '',
    'FIDE ID': p.fide || 0,
    'surname': p.surname,
    'first name': p.firstName,
  };
  return SM_HEADER.map((h) => (row[h] == null ? '' : row[h]));
}

/** Tabulka (pole polí) pro import jednotlivců do Swiss-Manageru, včetně hlavičky. */
function buildSmTable_(players, config) {
  const sorted = players.slice().sort(sortByRating_);
  return [SM_HEADER.slice()].concat(sorted.map((p, i) => smRow_(p, i + 1, config)));
}

/** Soupisky družstev: sloupce SM + družstvo, šachovnice a kapitán na konci. */
function buildTeamTable_(rows, config) {
  const sorted = rows.slice().sort((a, b) =>
    String(a['Družstvo']).localeCompare(String(b['Družstvo']), 'cs') || toInt_(a['Šachovnice']) - toInt_(b['Šachovnice']));
  const header = SM_HEADER.concat(['Družstvo', 'Šachovnice', 'Kapitán']);
  return [header].concat(sorted.map((r, i) =>
    smRow_(rowToPlayer_(r), i + 1, config).concat([r['Družstvo'], toInt_(r['Šachovnice']), r['Kapitán']])));
}

/** Text ve formátu exportu ze SM: UTF-8, středníky, řádky CRLF. */
function toSmText_(table) {
  return table.map((r) => r.map((v) => String(v).replace(/[;\r\n]/g, ' ')).join(';')).join('\r\n') + '\r\n';
}

// =====================================================================
// Veřejný seznam
// =====================================================================

function publicList_() {
  const config = getConfig_();
  if (config.publicList === false) return { ok: false, error: 'Seznam přihlášených není veřejný.' };
  const rows = activeRows_(readRegistrations_(getSheet_(config)));
  const pub = (p) => ({
    name: fullName_(p), title: p.title, year: p.year, club: p.club, rn: p.rn, rf: p.rf,
  });
  const out = { ok: true, updated: new Date().toISOString(), tournaments: {}, teams: {} };
  config.tournaments.forEach((t) => {
    const sel = rows.filter((r) => r[tourCol_(t)] === YES);
    if (t.type === 'team') {
      const byTeam = {};
      sel.forEach((r) => {
        const key = r['Družstvo'];
        if (!byTeam[key]) byTeam[key] = { team: key, captain: r['Kapitán'], players: [] };
        byTeam[key].players.push(Object.assign(pub(rowToPlayer_(r)), { board: toInt_(r['Šachovnice']) }));
      });
      out.teams[t.code] = Object.keys(byTeam).map((k) => {
        byTeam[k].players.sort((a, b) => a.board - b.board);
        return byTeam[k];
      });
    } else {
      out.tournaments[t.code] = sel.map(rowToPlayer_).sort(sortByRating_).map(pub);
    }
  });
  return out;
}

// =====================================================================
// Google Sheet
// =====================================================================

function getConfig_(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    const cached = cache.get('config');
    if (cached) return JSON.parse(cached);
  }
  const url = PropertiesService.getScriptProperties().getProperty('CONFIG_URL');
  if (!url) throw new Error('Není nastavena adresa config.json (menu Šachový festival → Nastavit adresu konfigurace).');
  const res = UrlFetchApp.fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error(`config.json se nepodařilo načíst (HTTP ${res.getResponseCode()}).`);
  const text = res.getContentText('UTF-8');
  const config = JSON.parse(text);
  cache.put('config', text, 300);
  return config;
}

function getSheet_(config) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME, 0);
  const wanted = BASE_COLUMNS
    .concat(config.tournaments.map(tourCol_))
    .concat((config.extras || []).map(extraCol_))
    .concat([STATUS_COLUMN]);
  const lastCol = sheet.getLastColumn();
  const headers = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  const missing = wanted.filter((h) => headers.indexOf(h) < 0);
  if (missing.length) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readRegistrations_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).map((row) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = row[i]; });
    return o;
  });
}

function appendRows_(sheet, rows) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const values = rows.map((r) => headers.map((h) => (r[h] == null ? '' : r[h])));
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
}

function sendConfirmation_(config, email, result) {
  const f = config.festival || {};
  const s = result.summary;
  const lines = ['Dobrý den,', '', `potvrzujeme přijetí přihlášky na ${f.name}.`, ''];
  if (s.team) {
    lines.push(`Družstvo: ${s.team} (kapitán: ${s.captain})`);
    s.players.forEach((p) => lines.push('  ' + p));
  } else {
    lines.push(`Hráč: ${s.players[0]}`);
  }
  lines.push('', 'Turnaje:');
  s.tournaments.forEach((t) => lines.push('  • ' + t));
  Object.keys(s.extras).forEach((k) => { if (s.extras[k]) lines.push(`${k}: ${s.extras[k]}`); });
  lines.push('', `Číslo přihlášky: ${result.id}`);
  if (f.infoUrl) lines.push(`Informace: ${f.infoUrl}`);
  lines.push('', 'Pokud jste se přihlásili omylem nebo chcete přihlášku změnit, odpovězte prosím na tento e-mail.');
  const opts = { to: email, subject: `Přihláška – ${f.name}`, body: lines.join('\n'), name: f.name };
  if (f.contactEmail) opts.replyTo = f.contactEmail;
  MailApp.sendEmail(opts);
}

// =====================================================================
// Menu pro pořadatele
// =====================================================================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Šachový festival')
    .addItem('Export pro Swiss-Manager', 'exportSwissManager')
    .addItem('Souhrn turnajů, dopravy a ubytování', 'refreshSummary')
    .addSeparator()
    .addItem('Nastavit adresu konfigurace', 'setConfigUrl')
    .addItem('Znovu načíst konfiguraci', 'reloadConfig')
    .addToUi();
}

function setConfigUrl() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const res = ui.prompt('Adresa config.json',
    'Např. https://UZIVATEL.github.io/Prihlasovaci_formular/config.json\nAktuálně: ' + (props.getProperty('CONFIG_URL') || '(nenastaveno)'),
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  props.setProperty('CONFIG_URL', res.getResponseText().trim());
  reloadConfig();
}

function reloadConfig() {
  const config = getConfig_(true);
  getSheet_(config);
  SpreadsheetApp.getActive().toast(`Načteno: ${config.festival.name}, turnajů: ${config.tournaments.length}.`, 'Konfigurace');
}

function exportSwissManager() {
  const config = getConfig_(true);
  const rows = activeRows_(readRegistrations_(getSheet_(config)));
  const folder = getExportFolder_(config);
  const links = config.tournaments.map((t) => {
    const sel = rows.filter((r) => r[tourCol_(t)] === YES);
    const table = t.type === 'team' ? buildTeamTable_(sel, config) : buildSmTable_(sel.map(rowToPlayer_), config);
    const base = `${t.code}${t.type === 'team' ? '_soupisky' : ''}`;
    const txt = upsertTextFile_(folder, base + '.TXT', toSmText_(table));
    const ssId = upsertSpreadsheet_(folder, base, table);
    return {
      name: tourTitle_(t),
      count: t.type === 'team' ? `${uniq_(sel.map((r) => r['Družstvo'])).length} družstev` : `${sel.length} hráčů`,
      txt: `https://drive.google.com/uc?export=download&id=${txt.getId()}`,
      xlsx: `https://docs.google.com/spreadsheets/d/${ssId}/export?format=xlsx`,
    };
  });
  const html = '<style>body{font:14px system-ui,sans-serif}td{padding:4px 8px}</style>' +
    `<p>Soubory jsou ve složce <a target="_blank" href="${folder.getUrl()}">${escHtml_(folder.getName())}</a>.</p><table>` +
    links.map((l) => `<tr><td><b>${escHtml_(l.name)}</b><br>${l.count}</td>` +
      `<td><a target="_blank" href="${l.txt}">.TXT</a></td><td><a target="_blank" href="${l.xlsx}">.xlsx</a></td></tr>`).join('') +
    '</table>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(560).setHeight(420), 'Export pro Swiss-Manager');
}

function getExportFolder_(config) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('EXPORT_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* smazaná složka – založíme novou */ }
  }
  const folder = DriveApp.createFolder('Swiss-Manager export – ' + config.festival.name);
  props.setProperty('EXPORT_FOLDER_ID', folder.getId());
  return folder;
}

function upsertTextFile_(folder, name, text) {
  const files = folder.getFilesByName(name);
  if (files.hasNext()) {
    const file = files.next();
    file.setContent(text);
    return file;
  }
  return folder.createFile(name, text, MimeType.PLAIN_TEXT);
}

function upsertSpreadsheet_(folder, name, table) {
  const props = PropertiesService.getScriptProperties();
  const key = 'EXPORT_SS_' + name;
  let ss = null;
  const id = props.getProperty(key);
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(name);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    props.setProperty(key, ss.getId());
  }
  const sheet = ss.getSheets()[0];
  sheet.clear();
  sheet.setName(name.slice(0, 30));
  // Narozen (00.00.RRRR) musí zůstat textem, jinak by ho tabulka převáděla.
  sheet.getRange(1, SM_HEADER.indexOf('Narozen') + 1, table.length, 1).setNumberFormat('@');
  sheet.getRange(1, 1, table.length, table[0].length).setValues(table);
  return ss.getId();
}

function refreshSummary() {
  const config = getConfig_(true);
  const rows = activeRows_(readRegistrations_(getSheet_(config)));
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SUMMARY_SHEET_NAME) || ss.insertSheet(SUMMARY_SHEET_NAME);
  sheet.clear();

  const out = [['Turnaj', 'Počet', '']];
  config.tournaments.forEach((t) => {
    const sel = rows.filter((r) => r[tourCol_(t)] === YES);
    const n = t.type === 'team' ? uniq_(sel.map((r) => norm_(r['Družstvo']))).length + ' družstev' : sel.length;
    out.push([tourTitle_(t), n, '']);
  });

  // doplňky počítáme po přihláškách (u družstva jednou za celé družstvo)
  const apps = {};
  rows.forEach((r) => { if (!apps[r['ID přihlášky']]) apps[r['ID přihlášky']] = r; });
  const appRows = Object.keys(apps).map((k) => apps[k]);
  (config.extras || []).filter((x) => x.type === 'checkboxes' || x.type === 'select').forEach((x) => {
    const col = extraCol_(x);
    out.push(['', '', ''], [x.label, 'Počet', 'Kdo']);
    (x.options || []).forEach((o) => {
      const who = appRows.filter((r) => String(r[col] || '').split(', ').indexOf(o) >= 0)
        .map((r) => (r['Druh'] === 'družstvo' ? r['Družstvo'] : `${r['Příjmení']} ${r['Jméno']}`));
      out.push([o, who.length, who.join(', ')]);
    });
  });
  sheet.getRange(1, 1, out.length, 3).setValues(out);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  sheet.autoResizeColumns(1, 2);
  ss.setActiveSheet(sheet);
}

function escHtml_(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
