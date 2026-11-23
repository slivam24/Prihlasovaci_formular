/**
 * Přihlášky na šachové turnaje – backend (Google Apps Script vázaný na Google Sheet).
 *
 * Tabulka slouží jako databáze, listy: Akce, Turnaje, Přihlášky, Správci.
 * Web (GitHub Pages) volá tento skript jako webovou aplikaci:
 *   GET  ?action=events | event&slug= | list&slug=        – veřejná data
 *   POST {action:'register', ...}                         – přihláška
 *   POST {action:'admin.*', idToken, ...}                 – administrace (Google přihlášení)
 *
 * Vlastnosti skriptu (menu Turnaje → Nastavení): GOOGLE_CLIENT_ID, SITE_URL.
 * Volitelně BREVO_API_KEY a BREVO_SENDER – e-maily přes Brevo (300/den zdarma) místo Gmailu (100/den).
 * Menu Turnaje → Zapnout zálohy a frontu e-mailů: denní záloha tabulky, odesílání fronty, anonymizace.
 */

// =====================================================================
// Datový model
// =====================================================================

const SHEETS = {
  events: {
    name: 'Akce',
    cols: ['id', 'slug', 'name', 'place', 'dateFrom', 'dateTo', 'deadline', 'status', 'infoUrl', 'intro',
      'contactEmail', 'admins', 'extras', 'issuer', 'createdBy', 'createdAt', 'updatedAt', 'kind', 'group'],
  },
  tournaments: {
    name: 'Turnaje',
    cols: ['id', 'eventId', 'order', 'name', 'short', 'day', 'type', 'minBirthYear', 'maxBirthYear',
      'warnMaxRating', 'capacity', 'boards', 'reserves', 'fee', 'feeRules', 'rating',
      'dateFrom', 'dateTo', 'place', 'deadline', 'infoUrl', 'signup', 'note', 'categories'],
  },
  registrations: {
    name: 'Přihlášky',
    cols: ['id', 'applicationId', 'eventId', 'tournamentId', 'createdAt', 'email', 'mode',
      'surname', 'firstName', 'year', 'sex', 'title', 'idCr', 'fideId', 'rn', 'rf', 'fed', 'clubNo', 'club', 'sk',
      'inLok', 'team', 'board', 'captain', 'extras', 'status', 'orgNote', 'updatedAt', 'updatedBy', 'editToken', 'category'],
  },
  receipts: {
    name: 'Doklady',
    cols: ['id', 'number', 'eventId', 'issuedAt', 'issuedBy', 'payer', 'payerClub', 'method', 'items', 'total',
      'issuer', 'note', 'status'],
  },
  changes: {
    name: 'Změny',
    cols: ['id', 'at', 'eventId', 'applicationId', 'registrationId', 'by', 'action', 'detail'],
  },
  users: {
    name: 'Správci',
    cols: ['email', 'name', 'club', 'role', 'active', 'createdAt'],
  },
  mails: {
    name: 'E-maily',
    cols: ['id', 'createdAt', 'to', 'subject', 'body', 'name', 'replyTo', 'status', 'sentAt', 'error'],
  },
};

const DATE_FIELDS = ['dateFrom', 'dateTo', 'deadline'];
const EVENT_STATUSES = ['koncept', 'otevreno', 'uzavreno', 'archiv'];
const TOURNAMENT_TYPES = ['individual', 'team'];
const EXTRA_TYPES = ['checkboxes', 'select', 'quantity', 'text', 'textarea'];
const CHOICE_TYPES = ['checkboxes', 'select', 'quantity'];
// superadmin = vše; organizer = pořadatelská sekce (své akce); clubadmin = celá klubová sekce + své akce
const ROLES = ['superadmin', 'organizer', 'clubadmin'];
const CANCELLED = 'zrušeno';
const RECEIPT_CANCELLED = 'stornováno';
const FEE_RULE_TYPES = ['women', 'youth', 'senior', 'titles', 'rating'];
// Který rating turnaj používá (ELO ČR / FIDE): klasická LOK, nebo rapid LOK.
const RATING_TYPES = ['standard', 'rapid'];
// Druh akce: běžná akce (turnaj / festival), nebo klubová sekce – hráči se hlásí klubu na turnaje
// z kalendáře, každý turnaj má vlastní datum, místo a klubovou uzávěrku; akce je dostupná jen přes odkaz.
const EVENT_KINDS = ['event', 'club'];
// Přihlašování na turnaj (hlavně v klubovém kalendáři): open = lze se přihlásit,
// none = klub výpravu nepořádá, league = dlouhodobá soutěž (jen v kalendáři).
const SIGNUP_TYPES = ['open', 'none', 'league'];
// Barva akce v přehledu (podle značení termínového kalendáře): krajské, republikové, mládež, mládež ŠSČR, ostatní.
const EVENT_GROUPS = ['ukss', 'sscr', 'mladez', 'sscrm', 'ostatni'];
const MAX_GROUP_PLAYERS = 60;
const MAX_GROUP_TEAMS = 20;
const YES = 'ANO';

// =====================================================================
// Web app
// =====================================================================

/** Jednorázové kroky (založení / úpravy klubového kalendáře) – po provedení je hlídá vlastnost skriptu. */
function runOneTimeSteps_() {
  maybeSeedClubCalendar_();
  maybeMigrateClubCalendar_();
  maybeSplitClubCalendar_();
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  return respond_(() => {
    runOneTimeSteps_();
    // klubové sekce nejsou v přehledu akcí – jsou dostupné jen přes odkaz
    // klubová sekce má vlastní přehled (klub.html, ?kind=club), v hlavním přehledu není
    if (p.action === 'events') {
      const club = p.kind === 'club';
      const all = cachedPublicEvents_();
      const covered = club ? coveredClubEvents_(all) : {};
      return { events: all.filter((e) => (e.kind === 'club') === club && !covered[e.id]) };
    }
    if (p.action === 'event') {
      const hit = cachedPublicEvents_().find((e) => e.slug === String(p.slug || ''));
      if (!hit) throw userError_('Akce nebyla nalezena.', 'not_found');
      return { event: hit };
    }
    if (p.action === 'list') return cached_('list:' + p.slug, 600, () => publicList_(loadEventBySlug_(p.slug, true)));
    if (p.action === 'application') {
      const app = findApplication_(p.token);
      return applicationView_(app.ev, app.rows, new Date());
    }
    return { message: 'API přihlášek běží.' };
  });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Neplatný požadavek.' });
  }
  runOneTimeSteps_();
  return respond_(() => {
    const action = String(body.action || '');
    if (action === 'register') return withLock_(() => register_(body, null));
    if (action === 'updateApplication') return withLock_(() => updateApplication_(body, null));
    if (action.indexOf('admin.') === 0) {
      const user = authenticate_(body.idToken);
      const handler = ADMIN_ACTIONS[action.slice(6)];
      if (!handler) throw userError_('Neznámá akce.');
      return handler(body, user);
    }
    throw userError_('Neznámá akce.');
  });
}

function respond_(fn) {
  try {
    return json_(Object.assign({ ok: true }, fn()));
  } catch (err) {
    if (!err.userError) console.error(err);
    return json_({ ok: false, error: err.userError ? err.message : 'Chyba serveru: ' + (err.message || err), code: err.code });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function userError_(message, code) {
  const err = new Error(message);
  err.userError = true;
  if (code) err.code = code;
  return err;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw userError_('Server je právě vytížený, zkuste to prosím za chvíli znovu.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
// Databáze nad Google Sheetem
// =====================================================================

const DB_CACHE_ = {};

function table_(key) {
  if (DB_CACHE_[key]) return DB_CACHE_[key];
  const def = SHEETS[key];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(def.name);
  if (!sh) sh = ss.insertSheet(def.name);
  const lastCol = sh.getLastColumn();
  let headers = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  const missing = def.cols.filter((c) => headers.indexOf(c) < 0);
  if (missing.length) {
    sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    sh.setFrozenRows(1);
    headers = headers.concat(missing);
  }
  const lastRow = sh.getLastRow();
  const values = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, headers.length).getValues() : [];
  const rows = values.map((v, i) => {
    const o = { _row: i + 2 };
    headers.forEach((h, j) => { o[h] = readCell_(h, v[j]); });
    return o;
  }).filter((o) => def.cols.some((c) => o[c] !== ''));
  DB_CACHE_[key] = { sh, headers, rows };
  return DB_CACHE_[key];
}

function readCell_(key, v) {
  if (v instanceof Date) {
    const tz = Session.getScriptTimeZone();
    return DATE_FIELDS.indexOf(key) >= 0 ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v.toISOString();
  }
  return v;
}

function toCells_(t, obj) {
  return t.headers.map((h) => {
    const v = obj[h];
    if (v == null) return '';
    if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v; // nikdy ne vzorec
    // data jako text, aby je tabulka nepřeváděla
    if (DATE_FIELDS.indexOf(h) >= 0 && v) return "'" + v;
    return v;
  });
}

function insert_(key, objs) {
  if (!objs.length) return;
  const t = table_(key);
  const start = t.sh.getLastRow() + 1;
  const need = start + objs.length - 1 - t.sh.getMaxRows();
  if (need > 0) t.sh.insertRowsAfter(t.sh.getMaxRows(), need);
  t.sh.getRange(start, 1, objs.length, t.headers.length).setValues(objs.map((o) => toCells_(t, o)));
  objs.forEach((o, i) => t.rows.push(Object.assign({}, o, { _row: start + i })));
  bumpVersion_();
}

function update_(key, obj) {
  const t = table_(key);
  t.sh.getRange(obj._row, 1, 1, t.headers.length).setValues([toCells_(t, obj)]);
  bumpVersion_();
}

function remove_(key, objs) {
  const t = table_(key);
  objs.map((o) => o._row).sort((a, b) => b - a).forEach((r) => t.sh.deleteRow(r));
  delete DB_CACHE_[key];
  bumpVersion_();
}

// =====================================================================
// Akce a turnaje
// =====================================================================

function loadEvents_() {
  const tours = table_('tournaments').rows;
  return table_('events').rows.map((e) => buildEvent_(e, tours.filter((t) => t.eventId === e.id)));
}

function buildEvent_(row, tourRows) {
  return {
    _row: row._row,
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    place: String(row.place || ''),
    dateFrom: String(row.dateFrom || ''),
    dateTo: String(row.dateTo || ''),
    deadline: String(row.deadline || ''),
    status: EVENT_STATUSES.indexOf(row.status) >= 0 ? row.status : 'koncept',
    kind: EVENT_KINDS.indexOf(row.kind) >= 0 ? row.kind : 'event',
    group: EVENT_GROUPS.indexOf(row.group) >= 0 ? row.group : '',
    infoUrl: String(row.infoUrl || ''),
    intro: String(row.intro || ''),
    contactEmail: String(row.contactEmail || ''),
    admins: splitEmails_(row.admins),
    extras: parseJson_(row.extras, []),
    issuer: parseJson_(row.issuer, {}),
    createdBy: String(row.createdBy || ''),
    tournaments: tourRows.slice().sort((a, b) => toInt_(a.order) - toInt_(b.order)).map((t) => ({
      _row: t._row,
      id: String(t.id),
      name: String(t.name),
      short: String(t.short || ''),
      day: String(t.day || ''),
      type: TOURNAMENT_TYPES.indexOf(t.type) >= 0 ? t.type : 'individual',
      minBirthYear: toInt_(t.minBirthYear) || null,
      maxBirthYear: toInt_(t.maxBirthYear) || null,
      warnMaxRating: toInt_(t.warnMaxRating) || null,
      capacity: toInt_(t.capacity) || null,
      boards: toInt_(t.boards) || null,
      reserves: toInt_(t.reserves) || 0,
      fee: t.fee === '' || t.fee == null || isNaN(Number(t.fee)) ? null : Number(t.fee),
      feeRules: parseJson_(t.feeRules, []),
      rating: RATING_TYPES.indexOf(t.rating) >= 0 ? t.rating : 'standard',
      dateFrom: String(t.dateFrom || ''),
      dateTo: String(t.dateTo || ''),
      place: String(t.place || ''),
      deadline: String(t.deadline || ''),
      infoUrl: String(t.infoUrl || ''),
      signup: SIGNUP_TYPES.indexOf(t.signup) >= 0 ? t.signup : 'open',
      note: String(t.note || ''),
      categories: parseCategories_(t.categories),
    })),
  };
}

function loadEventBySlug_(slug, publicOnly) {
  const ev = loadEvents_().find((e) => e.slug === String(slug || ''));
  if (!ev || (publicOnly && (ev.status === 'koncept' || ev.status === 'archiv'))) {
    throw userError_('Akce nebyla nalezena.', 'not_found');
  }
  return ev;
}

function loadEventById_(id) {
  const ev = loadEvents_().find((e) => e.id === String(id || ''));
  if (!ev) throw userError_('Akce nebyla nalezena.', 'not_found');
  return ev;
}

/** Veřejná podoba akce – bez správců a interních údajů. */
function publicEvent_(ev) {
  const out = {};
  ['id', 'slug', 'name', 'place', 'dateFrom', 'dateTo', 'deadline', 'status', 'kind', 'group', 'infoUrl', 'intro', 'extras']
    .forEach((k) => { out[k] = ev[k]; });
  out.tournaments = ev.tournaments.map(stripRow_);
  // správce osobních údajů (pořadatel) – pro stránku o zpracování osobních údajů
  const iss = ev.issuer || {};
  out.organizer = { name: iss.name || '', address: iss.address || '', ico: iss.ico || '', email: ev.contactEmail || '' };
  return out;
}

// ---- mezipaměť odpovědí: platí do další změny dat (každý zápis zvýší verzi) ----

function dataVersion_() {
  const cache = CacheService.getScriptCache();
  let v = cache.get('data_ver');
  if (!v) {
    v = String(Date.now());
    cache.put('data_ver', v, 21600);
  }
  return v;
}

function bumpVersion_() {
  CacheService.getScriptCache().put('data_ver', Date.now() + '-' + Math.random().toString(36).slice(2, 7), 21600);
}

function cached_(key, ttl, fn) {
  const cache = CacheService.getScriptCache();
  const k = key + '@' + dataVersion_();
  const hit = cache.get(k);
  if (hit) return JSON.parse(hit);
  const value = fn();
  try {
    const text = JSON.stringify(value);
    if (text.length < 95000) cache.put(k, text, ttl);
  } catch (e) { /* příliš velké – nevadí */ }
  return value;
}

/** Veřejné akce z mezipaměti (rychlé načtení webu). */
function cachedPublicEvents_() {
  return cached_('events', 600, listPublicEvents_);
}

function clearPublicCache_() {
  bumpVersion_();
}

/**
 * Turnaj má být vidět jen v jedné sekci: akce klubové sekce, kterou klub sám pořádá (v pořadatelské sekci je
 * zveřejněná akce ve stejný den na stejném místě), se v klubové sekci nezobrazuje.
 * Vrací { id klubové akce: pořadatelská akce }.
 */
const GENERIC_PLACES_ = ['konkurz', 'neurceno', 'rozpisu', 'skupin', 'okresech', 'predb', 'zajem'];

function coveredClubEvents_(events) {
  const organized = events.filter((e) => e.kind !== 'club' && (e.status === 'otevreno' || e.status === 'uzavreno'));
  const out = {};
  if (!organized.length) return out;
  events.filter((e) => e.kind === 'club').forEach((c) => {
    const words = norm_(c.place).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && GENERIC_PLACES_.indexOf(w) < 0);
    if (!words.length || !c.dateFrom) return;
    const hit = organized.find((o) => {
      const end = o.dateTo || o.dateFrom;
      if (!o.dateFrom || c.dateFrom < o.dateFrom || c.dateFrom > end) return false;
      const where = norm_([o.place, o.name].join(' '));
      return words.some((w) => where.indexOf(w) >= 0);
    });
    if (hit) out[c.id] = hit;
  });
  return out;
}

function listPublicEvents_() {
  return loadEvents_()
    .filter((e) => e.status === 'otevreno' || e.status === 'uzavreno')
    .sort((a, b) => String(a.dateFrom).localeCompare(String(b.dateFrom)))
    .map(publicEvent_);
}

function stripRow_(o) {
  const c = Object.assign({}, o);
  delete c._row;
  return c;
}

// ---- úprava akce (čisté funkce) ----

/** Ověří a vyčistí akci z administrace. Vrací {event, tournaments} nebo vyhodí userError. */
function sanitizeEvent_(input, existingEvents, currentId) {
  const name = clean_(input.name, 150);
  if (!name) throw userError_('Vyplňte název akce.');
  const dateFrom = cleanDate_(input.dateFrom);
  if (!dateFrom) throw userError_('Vyplňte datum začátku akce (RRRR-MM-DD).');
  const dateTo = cleanDate_(input.dateTo);
  if (dateTo && dateTo < dateFrom) throw userError_('Konec akce je před jejím začátkem.');
  const deadline = cleanDate_(input.deadline);
  const status = EVENT_STATUSES.indexOf(input.status) >= 0 ? input.status : 'koncept';
  const kind = EVENT_KINDS.indexOf(input.kind) >= 0 ? input.kind : 'event';
  const group = EVENT_GROUPS.indexOf(input.group) >= 0 ? input.group : '';

  let slug = slugify_(input.slug || name);
  if (!slug) throw userError_('Adresa akce může obsahovat jen písmena bez diakritiky, číslice a pomlčky.');
  const taken = existingEvents.filter((e) => e.id !== currentId).map((e) => e.slug);
  if (taken.indexOf(slug) >= 0) {
    if (input.slug) throw userError_(`Adresa „${slug}“ už patří jiné akci, zvolte jinou.`);
    let i = 2;
    while (taken.indexOf(`${slug}-${i}`) >= 0) i++;
    slug = `${slug}-${i}`;
  }

  const tournaments = (Array.isArray(input.tournaments) ? input.tournaments : []).map((t, i) => {
    const tName = clean_(t.name, 150);
    if (!tName) throw userError_(`Turnaj č. ${i + 1}: vyplňte název.`);
    const type = TOURNAMENT_TYPES.indexOf(t.type) >= 0 ? t.type : 'individual';
    const minB = toInt_(t.minBirthYear) || null;
    const maxB = toInt_(t.maxBirthYear) || null;
    if (minB && maxB && minB > maxB) throw userError_(`Turnaj „${tName}“: ročníky se vylučují.`);
    let tDateFrom = cleanDate_(t.dateFrom);
    let tDateTo = tDateFrom ? cleanDate_(t.dateTo) : '';
    if (!tDateFrom && input.kind === 'club') { tDateFrom = cleanDate_(input.dateFrom); tDateTo = cleanDate_(input.dateTo); }
    if (tDateTo && tDateTo < tDateFrom) throw userError_(`Turnaj „${tName}“: konec je před začátkem.`);
    return {
      id: t.id ? String(t.id) : '',
      order: i + 1,
      name: tName,
      short: clean_(t.short, 40),
      day: clean_(t.day, 40),
      type,
      minBirthYear: minB,
      maxBirthYear: maxB,
      warnMaxRating: toInt_(t.warnMaxRating) || null,
      capacity: toInt_(t.capacity) || null,
      boards: type === 'team' ? Math.min(Math.max(toInt_(t.boards) || 4, 1), 12) : null,
      reserves: type === 'team' ? Math.min(Math.max(toInt_(t.reserves), 0), 6) : 0,
      fee: cleanPrice_(t.fee),
      rating: RATING_TYPES.indexOf(t.rating) >= 0 ? t.rating : 'standard',
      dateFrom: tDateFrom,
      dateTo: tDateTo,
      place: clean_(t.place, 150),
      // klubová sekce: nový turnaj bez uzávěrky → 2 dny před začátkem (dá se změnit i smazat)
      deadline: cleanDate_(t.deadline) || (input.kind === 'club' ? cleanDate_(input.deadline) || (!t.id && tDateFrom ? addDays_(tDateFrom, -2) : '') : ''),
      infoUrl: /^https?:\/\//.test(String(t.infoUrl || '')) ? clean_(t.infoUrl, 300) : '',
      signup: SIGNUP_TYPES.indexOf(t.signup) >= 0 ? t.signup : 'open',
      note: clean_(t.note, 300),
      categories: type === 'team' ? '' : parseCategories_(t.categories).join(', '),
      feeRules: type === 'team' ? [] : (Array.isArray(t.feeRules) ? t.feeRules : []).slice(0, 10).map((r) => {
        const rt = FEE_RULE_TYPES.indexOf(r && r.type) >= 0 ? r.type : '';
        const price = cleanPrice_(r && r.price);
        if (!rt || price == null) return null;
        let value = '';
        if (rt === 'titles') value = String(r.value || '').toUpperCase().split(/[\s,;]+/).filter(Boolean).slice(0, 10).join(', ');
        else if (rt !== 'women') value = toInt_(r.value) || '';
        if (rt !== 'women' && !value) return null;
        return { type: rt, value, price };
      }).filter(Boolean),
    };
  });
  if (!tournaments.length) throw userError_('Přidejte alespoň jeden turnaj.');

  const usedIds = {};
  const extras = (Array.isArray(input.extras) ? input.extras : []).map((x, i) => {
    const label = clean_(x.label, 200);
    if (!label) throw userError_(`Doplňující otázka č. ${i + 1}: vyplňte text otázky.`);
    const type = EXTRA_TYPES.indexOf(x.type) >= 0 ? x.type : 'text';
    const rawOptions = Array.isArray(x.options) ? x.options : String(x.options || '').split('\n');
    const rawPrices = Array.isArray(x.prices) ? x.prices : [];
    const options = [];
    const prices = [];
    rawOptions.forEach((o, j) => {
      const name = clean_(o, 100);
      if (!name || options.indexOf(name) >= 0) return;
      options.push(name);
      const p = parseFloat(String(rawPrices[j] == null ? '' : rawPrices[j]).replace(',', '.'));
      prices.push(isNaN(p) || p < 0 ? null : Math.round(p * 100) / 100);
    });
    const choice = CHOICE_TYPES.indexOf(type) >= 0;
    if (choice && !options.length) {
      throw userError_(`Otázka „${label}“: zadejte možnosti.`);
    }
    let id = x.id ? slugify_(x.id) : slugify_(label).slice(0, 30) || 'otazka';
    while (usedIds[id]) id += '-' + (i + 1);
    usedIds[id] = true;
    const modes = Array.isArray(x.modes) ? x.modes.filter((m) => TOURNAMENT_TYPES.indexOf(m) >= 0) : [];
    return {
      id, type, label,
      help: clean_(x.help, 500),
      options: choice ? options : [],
      prices: choice && prices.some((p) => p != null) ? prices : [],
      unit: type === 'quantity' ? clean_(x.unit, 20) : '',
      modes: modes.length ? modes : TOURNAMENT_TYPES.slice(),
    };
  });

  return {
    event: {
      name, slug, dateFrom, dateTo, deadline, status, kind, group,
      place: clean_(input.place, 150),
      infoUrl: /^https?:\/\//.test(String(input.infoUrl || '')) ? clean_(input.infoUrl, 300) : '',
      intro: clean_(input.intro, 2000),
      contactEmail: isEmail_(input.contactEmail) ? clean_(input.contactEmail, 200) : '',
      issuer: cleanIssuer_(input.issuer),
      admins: splitEmails_(input.admins),
      extras,
    },
    tournaments,
  };
}

function slugify_(s) {
  return norm_(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function addDays_(iso, n) {
  const d = new Date(Date.UTC(toInt_(iso.slice(0, 4)), toInt_(iso.slice(5, 7)) - 1, toInt_(iso.slice(8, 10)) + n));
  return d.toISOString().slice(0, 10);
}

function daysBetween_(a, b) {
  const t = (iso) => Date.UTC(toInt_(iso.slice(0, 4)), toInt_(iso.slice(5, 7)) - 1, toInt_(iso.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 864e5);
}

function cleanPrice_(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) || n < 0 ? null : Math.round(n * 100) / 100;
}

function cleanIssuer_(x) {
  x = x && typeof x === 'object' ? x : {};
  return {
    name: clean_(x.name, 150), ico: clean_(x.ico, 20), address: clean_(x.address, 200),
    place: clean_(x.place, 80), cashier: clean_(x.cashier, 80), prefix: clean_(x.prefix, 20), note: clean_(x.note, 300),
  };
}

function cleanDate_(s) {
  const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[0] : '';
}

// =====================================================================
// Přihlášky
// =====================================================================

function register_(body, adminUser) {
  const ev = adminUser ? loadEventById_(body.eventId) : loadEventBySlug_(body.slug, true);
  if (adminUser) assertCanEdit_(adminUser, ev);
  const regs = table_('registrations').rows.filter((r) => r.eventId === ev.id);
  const result = processRegistration_(body, ev, regs, new Date(),
    { admin: !!adminUser, adminEmail: adminUser ? adminUser.email : '' });
  if (!result.ok) throw userError_(result.error);
  insert_('registrations', result.rows);
  if (adminUser) {
    logChanges_(ev, result.applicationId, result.rows.map((r) => ({
      registrationId: r.id, action: 'přidáno pořadatelem', detail: `${r.surname} ${r.firstName} – ${tourShortById_(ev, r.tournamentId)}`,
    })), adminUser.email, new Date());
  }
  SpreadsheetApp.flush();
  const email = String(body.email || '').trim();
  let mailDelayed = false;
  if (!adminUser && email) {
    try {
      mailDelayed = !sendConfirmation_(ev, email, result);
    } catch (err) {
      console.error('Potvrzovací e-mail se nepodařilo připravit', err);
    }
  }
  return { id: result.applicationId, editToken: result.editToken, mailDelayed };
}

/**
 * Ověří přihlášku a připraví řádky (jeden řádek = jeden hráč v jednom turnaji).
 * Čistá funkce – testuje se i mimo Google.
 */
function processRegistration_(data, ev, existing, now, opts) {
  opts = opts || {};
  const admin = !!opts.admin;
  const fail = (error) => ({ ok: false, error });
  const year = eventYear_(ev);
  if (!data || typeof data !== 'object') return fail('Neplatná data přihlášky.');
  if (data.web) return fail('Přihlášku se nepodařilo zpracovat.'); // past na roboty
  if (!admin && isClosed_(ev, now)) return fail('Přihlašování na tuto akci je uzavřeno.');

  const email = clean_(data.email, 200);
  if (!admin && !isEmail_(email)) return fail('Vyplňte platný e-mail.');
  if (admin && email && !isEmail_(email)) return fail('E-mail není platný.');

  const mode = data.mode === 'team' ? 'team' : 'individual';
  const extras = cleanExtras_(ev.extras, data.extras || {}, mode);
  const active = existing.filter((r) => r.status !== CANCELLED);
  const applicationId = makeId_(now);
  const editToken = opts.editToken || makeToken_();
  const base = {
    applicationId, eventId: ev.id, createdAt: now.toISOString(), email, mode,
    extras: JSON.stringify(extras), status: '', orgNote: '', editToken,
    updatedBy: admin ? opts.adminEmail || 'pořadatel' : '',
  };
  const row = (p, t, more) => Object.assign({ id: makeId_(now, 8) }, base, playerToRow_(p, t), { tournamentId: t.id }, more || {});

  if (mode === 'individual') {
    // jeden hráč {player, tournaments}, nebo výprava {players: [{player, tournaments}, …]}
    const entries = Array.isArray(data.players) ? data.players : [{ player: data.player, tournaments: data.tournaments }];
    if (!entries.length) return fail('Přidejte alespoň jednoho hráče.');
    if (entries.length > MAX_GROUP_PLAYERS) return fail(`Najednou lze přihlásit nejvýše ${MAX_GROUP_PLAYERS} hráčů.`);
    const multi = entries.length > 1;
    const rows = [];
    const done = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i] || {};
      const p = cleanPlayer_(entry.player, year);
      if (p.error) return fail((multi ? `${i + 1}. hráč: ` : '') + p.error);
      if (done.some((d) => samePlayer_(d.p, p))) return fail(`${fullName_(p)} je v přihlášce uveden(a) dvakrát.`);
      const ids = Array.isArray(entry.tournaments) ? entry.tournaments.map(String) : [];
      const tours = ev.tournaments.filter((t) => t.type === 'individual' && ids.indexOf(t.id) >= 0);
      if (!tours.length) return fail(multi ? `${fullName_(p)}: vyberte alespoň jeden turnaj.` : 'Vyberte alespoň jeden turnaj.');
      const cats = {};
      for (const t of tours) {
        const label = t.short || t.name;
        if (!admin && t.signup !== 'open') return fail(`Na turnaj „${label}“ se přes klub nepřihlašuje.`);
        if (t.categories && t.categories.length) {
          const wanted = toInt_(entry.categories && entry.categories[t.id]) || bestCategory_(t.categories, p.year);
          if (t.categories.indexOf(wanted) < 0) return fail(`${fullName_(p)}: v turnaji „${label}“ vyberte kategorii.`);
          if (!admin && p.year && p.year < wanted) {
            return fail(`${fullName_(p)} (ročník ${p.year}) nemůže hrát v kategorii ročník ${wanted} a mladší turnaje „${label}“.`);
          }
          cats[t.id] = wanted;
        }
        if (!admin && tournamentClosed_(t, now)) return fail(`Přihlašování na turnaj „${label}“ je už uzavřené.`);
        const block = eligibility_(t, p);
        if (block && !admin) return fail(`${fullName_(p)}: turnaj „${label}“ je ${block}.`);
        const inTour = active.filter((r) => r.tournamentId === t.id);
        if (inTour.some((r) => samePlayer_(rowToPlayer_(r), p))) {
          return fail(`${fullName_(p)} je do turnaje „${label}“ už přihlášen(a).`);
        }
        const taken = inTour.length + rows.filter((r) => r.tournamentId === t.id).length;
        if (t.capacity && taken >= t.capacity && !admin) {
          return fail(`Turnaj „${label}“ je již naplněn` + (multi ? ` (volných míst: ${Math.max(0, t.capacity - inTour.length)}).` : '.'));
        }
      }
      tours.forEach((t) => rows.push(row(p, t, cats[t.id] ? { category: cats[t.id] } : null)));
      done.push({ p, tours, cats });
    }
    return {
      ok: true, applicationId, editToken, rows,
      summary: {
        entries: done.map((d) => ({ name: fullName_(d.p),
          tournaments: d.tours.map((t) => tourTitle_(t) + (d.cats[t.id] ? `, kategorie ročník ${d.cats[t.id]} a mladší` : '')) })),
        extras,
      },
    };
  }

  // ---- družstva: jedno i více v jedné přihlášce, soupiska může přijít později ----
  const teamsIn = Array.isArray(data.teams) ? data.teams : [data.team || {}];
  if (!teamsIn.length) return fail('Přidejte alespoň jedno družstvo.');
  if (teamsIn.length > MAX_GROUP_TEAMS) return fail(`Najednou lze přihlásit nejvýše ${MAX_GROUP_TEAMS} družstev.`);
  const rows = [];
  const done = [];
  for (let k = 0; k < teamsIn.length; k++) {
    const team = teamsIn[k] || {};
    const prefix = teamsIn.length > 1 ? `${k + 1}. družstvo: ` : '';
    const t = ev.tournaments.find((x) => x.type === 'team' && x.id === String(team.tournamentId));
    if (!t) return fail(prefix + 'Vyberte soutěž družstev.');
    if (!admin && tournamentClosed_(t, now)) return fail(prefix + `přihlašování na „${t.short || t.name}“ je už uzavřené.`);
    const teamName = clean_(team.name, 100);
    const captain = clean_(team.captain, 100);
    if (!teamName) return fail(prefix + 'Vyplňte název družstva.');
    if (!captain) return fail(prefix + 'Vyplňte kapitána / vedoucího družstva.');
    const roster = cleanRoster_(t, team.players, year, { admin, requireFull: !team.rosterLater, label: teamName });
    if (roster.error) return fail(prefix + roster.error);

    const inTour = active.filter((r) => r.tournamentId === t.id);
    const taken = uniq_(inTour.map((r) => norm_(r.team)).concat(done.filter((d) => d.t.id === t.id).map((d) => norm_(d.name))));
    if (taken.indexOf(norm_(teamName)) >= 0) return fail(`Družstvo „${teamName}“ už je přihlášeno.`);
    if (t.capacity && taken.length >= t.capacity && !admin) return fail(`Soutěž „${t.short || t.name}“ je již naplněna.`);
    for (const p of roster.players) {
      const clash = inTour.find((r) => !isTeamRow_(r) && samePlayer_(rowToPlayer_(r), p));
      if (clash) return fail(`${fullName_(p)} už hraje za družstvo „${clash.team}“.`);
      const other = done.find((d) => d.t.id === t.id && d.players.some((q) => samePlayer_(q, p)));
      if (other) return fail(`${fullName_(p)} je uveden(a) ve dvou družstvech („${other.name}“ a „${teamName}“).`);
    }
    rows.push(Object.assign({ id: makeId_(now, 8) }, base, EMPTY_PLAYER_ROW_, { tournamentId: t.id, team: teamName, board: 0, captain }));
    roster.players.forEach((p, i) => rows.push(row(p, t, { team: teamName, board: i + 1, captain })));
    done.push({ t, name: teamName, captain, players: roster.players });
  }
  return {
    ok: true, applicationId, editToken, rows,
    summary: {
      teams: done.map((d) => ({
        name: d.name, captain: d.captain, tournament: tourTitle_(d.t),
        players: d.players.map((p, i) => `${i + 1 > (d.t.boards || 4) ? 'N' : i + 1}. ${fullName_(p)}`),
      })),
      extras,
    },
  };
}

function receiptView_(r) {
  return {
    id: r.id, number: String(r.number), eventId: r.eventId, issuedAt: r.issuedAt, issuedBy: r.issuedBy,
    payer: r.payer, payerClub: r.payerClub, method: r.method, items: parseJson_(r.items, []),
    total: Number(r.total) || 0, issuer: parseJson_(r.issuer, {}), note: r.note, status: r.status || '',
  };
}

// Řádek „družstvo“ (bez hráče) – družstvo existuje i bez soupisky.
const EMPTY_PLAYER_ROW_ = {
  surname: '', firstName: '', year: '', sex: '', title: '', idCr: '', fideId: '', rn: '', rf: '',
  fed: '', clubNo: '', club: '', sk: '', inLok: '',
};

function isTeamRow_(r) {
  return r.mode === 'team' && !r.surname;
}

/** Soupiska: seřazení hráči (prvních „boards“ = šachovnice, zbytek náhradníci). */
function cleanRoster_(t, raw, year, opts) {
  const boards = t.boards || 4;
  const max = boards + (t.reserves || 0);
  const list = (Array.isArray(raw) ? raw : []).filter(Boolean);
  if (list.length > max) {
    return { error: `Soupiska může mít nejvýše ${max} hráčů (${boards} šachovnic + ${t.reserves || 0} náhradníků).` };
  }
  if (opts.requireFull && list.length < boards) {
    return { error: `${opts.label ? `Družstvo „${opts.label}“: ` : ''}vyplňte soupisku aspoň na ${boards} šachovnice, nebo zaškrtněte „soupisku doplním později“.` };
  }
  const players = [];
  for (let i = 0; i < list.length; i++) {
    const p = cleanPlayer_(list[i], year);
    if (p.error) return { error: `${i + 1}. hráč soupisky: ${p.error}` };
    const block = eligibility_(t, p);
    if (block && !opts.admin) return { error: `${fullName_(p)}: soutěž je ${block}.` };
    if (players.some((q) => samePlayer_(q, p))) return { error: `${fullName_(p)} je na soupisce dvakrát.` };
    players.push(p);
  }
  return { players };
}

function cleanPlayer_(raw, maxYear) {
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
    // rapid ratingy jen když je web poslal (listina s rapid LOK); jinak u rapid turnaje zůstane klasický
    rnr: raw.rnr == null ? undefined : toInt_(raw.rnr),
    rfr: raw.rfr == null ? undefined : toInt_(raw.rfr),
    clubNo: toInt_(raw.clubNo),
    club: clean_(raw.club, 100),
    status: clean_(raw.status, 3),
  };
  if (!p.registered) Object.assign(p, { id: 0, rn: 0, rf: 0, rnr: 0, rfr: 0, title: '', clubNo: 0, status: '' });
  if (!p.surname || !p.firstName) return { error: 'Vyplňte jméno a příjmení hráče.' };
  if (!(p.year >= 1900 && p.year <= maxYear)) return { error: `${fullName_(p)}: vyplňte platný rok narození.` };
  if (!p.club) return { error: `${fullName_(p)}: vyplňte klub, nebo u neregistrovaných město.` };
  return p;
}

function cleanExtras_(defs, raw, mode) {
  const out = {};
  (defs || []).forEach((x) => {
    if ((x.modes || TOURNAMENT_TYPES).indexOf(mode) < 0) return;
    const v = raw[x.id];
    if (x.type === 'checkboxes') {
      const arr = Array.isArray(v) ? v.map(String) : [];
      out[x.id] = (x.options || []).filter((o) => arr.indexOf(o) >= 0);
    } else if (x.type === 'select') {
      out[x.id] = (x.options || []).indexOf(String(v)) >= 0 ? String(v) : '';
    } else if (x.type === 'quantity') {
      const q = {};
      (x.options || []).forEach((o) => {
        const n = Math.min(999, Math.max(0, toInt_(v && typeof v === 'object' ? v[o] : 0)));
        if (n) q[o] = n;
      });
      out[x.id] = q;
    } else {
      out[x.id] = clean_(v, 2000);
    }
  });
  return out;
}

/** Hráč s ratingem podle turnaje: u rapid turnaje rapid ELO ČR a FIDE rapid (z rapid LOK). */
function ratedFor_(p, t) {
  if (!t || t.rating !== 'rapid' || (p.rnr == null && p.rfr == null)) return p;
  return Object.assign({}, p, { rn: toInt_(p.rnr), rf: toInt_(p.rfr) });
}

function playerToRow_(p, t) {
  p = ratedFor_(p, t);
  return {
    surname: p.surname, firstName: p.firstName, year: p.year, sex: p.sex, title: p.title,
    idCr: p.id || '', fideId: p.fide || '', rn: p.rn || '', rf: p.rf || '', fed: p.fed,
    clubNo: p.clubNo || '', club: p.club, sk: p.status, inLok: p.registered ? YES : 'NE',
  };
}

function rowToPlayer_(r) {
  return {
    registered: r.inLok === YES,
    id: toInt_(r.idCr),
    surname: String(r.surname || ''),
    firstName: String(r.firstName || ''),
    year: toInt_(r.year),
    sex: r.sex === 'F' ? 'F' : '',
    title: String(r.title || ''),
    fide: toInt_(r.fideId),
    fed: String(r.fed || 'CZE'),
    rn: toInt_(r.rn),
    rf: toInt_(r.rf),
    clubNo: toInt_(r.clubNo),
    club: String(r.club || ''),
    status: String(r.sk || ''),
  };
}

/** Kategorie turnaje (ročník „… a mladší“), od nejmladší: „2016, 2012, 2008“ → [2016, 2012, 2008]. */
function parseCategories_(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(/[^0-9]+/);
  const years = list.map(toInt_).filter((y) => y >= 1900 && y <= 2100);
  return years.filter((y, i) => years.indexOf(y) === i).sort((a, b) => b - a).slice(0, 8);
}

/** Nejmladší kategorie, do které hráč smí (ročník hráče ≥ ročník kategorie). */
function bestCategory_(cats, year) {
  if (!year) return cats[cats.length - 1];
  const ok = cats.filter((c) => year >= c);
  return ok.length ? ok[0] : 0;
}

function eligibility_(t, p) {
  if (t.categories && t.categories.length && p.year && p.year < t.categories[t.categories.length - 1]) {
    return `jen pro ročník ${t.categories[t.categories.length - 1]} a mladší`;
  }
  if (t.minBirthYear && p.year < t.minBirthYear) return `jen pro ročník ${t.minBirthYear} a mladší`;
  if (t.maxBirthYear && p.year > t.maxBirthYear) return `jen pro ročník ${t.maxBirthYear} a starší`;
  return '';
}

/**
 * Uzavřený turnaj: po jeho uzávěrce (do konce dne), bez uzávěrky od dne začátku turnaje.
 * Turnaje bez vlastního data (běžné akce) se řídí jen uzávěrkou akce.
 */
function tournamentClosed_(t, now) {
  if (t.signup && t.signup !== 'open') return true;
  if (t.deadline) {
    const end = new Date(t.deadline + 'T23:59:59');
    return !isNaN(end.getTime()) && now > end;
  }
  if (t.dateFrom) {
    const start = new Date(t.dateFrom + 'T00:00:00');
    return !isNaN(start.getTime()) && now >= start;
  }
  return false;
}

function isClosed_(ev, now) {
  if (ev.status !== 'otevreno') return true;
  if (!ev.deadline) return false;
  const end = new Date(ev.deadline + 'T23:59:59');
  return !isNaN(end.getTime()) && now > end;
}

function eventYear_(ev) {
  return toInt_(String(ev.dateFrom || '').slice(0, 4)) || new Date().getFullYear();
}

function samePlayer_(a, b) {
  if (a.id && b.id) return a.id === b.id;
  return norm_(a.surname + ' ' + a.firstName) === norm_(b.surname + ' ' + b.firstName) && a.year === b.year;
}

/** Veřejný seznam přihlášených (bez e-mailů a interních poznámek). */
function publicList_(ev) {
  const regs = table_('registrations').rows.filter((r) => r.eventId === ev.id && r.status !== CANCELLED);
  return buildPublicList_(ev, regs);
}

function buildPublicList_(ev, regs) {
  const pub = (r) => {
    const p = rowToPlayer_(r);
    return { name: fullName_(p), title: p.title, year: p.year, club: p.club, rn: p.rn, rf: p.rf, board: toInt_(r.board), category: toInt_(r.category) || '' };
  };
  const byRating = (a, b) => (b.rf - a.rf) || (b.rn - a.rn) || a.name.localeCompare(b.name, 'cs');
  const out = { event: publicEvent_(ev), updated: new Date().toISOString(), tournaments: {}, teams: {} };
  ev.tournaments.forEach((t) => {
    const sel = regs.filter((r) => r.tournamentId === t.id);
    if (t.type === 'team') {
      const byTeam = {};
      sel.forEach((r) => {
        if (!byTeam[r.team]) byTeam[r.team] = { team: r.team, captain: r.captain, players: [] };
        if (!isTeamRow_(r)) byTeam[r.team].players.push(pub(r));
      });
      out.teams[t.id] = Object.keys(byTeam).map((k) => {
        byTeam[k].players.sort((a, b) => a.board - b.board);
        return byTeam[k];
      });
    } else {
      out.tournaments[t.id] = sel.map(pub).sort(byRating);
    }
  });
  return out;
}

function sendConfirmation_(ev, email, result) {
  const s = result.summary;
  const lines = ['Dobrý den,', '', `potvrzujeme přijetí přihlášky na akci ${ev.name}.`, ''];
  if (s.teams) {
    lines.push(s.teams.length > 1 ? `Přihlášená družstva (${s.teams.length}):` : 'Přihlášené družstvo:');
    s.teams.forEach((t) => {
      lines.push('', `  ${t.name} – ${t.tournament} (kapitán: ${t.captain})`);
      if (t.players.length) t.players.forEach((p) => lines.push('    ' + p));
      else lines.push('    soupiska bude doplněna později (přes odkaz níže)');
    });
  } else {
    lines.push(s.entries.length > 1 ? `Přihlášení hráči (${s.entries.length}):` : 'Přihlášený hráč:');
    s.entries.forEach((e) => {
      lines.push('', '  ' + e.name);
      e.tournaments.forEach((t) => lines.push('    • ' + t));
    });
  }
  lines.push('');
  const extrasLinesList = extrasLines_(ev.extras, s.extras);
  extrasLinesList.forEach((l) => lines.push(l));
  const fees = result.rows.map((r) => rowFee_(ev, r)).filter((f) => f != null);
  const extrasSum = (ev.extras || []).reduce((sum, x) => sum + extraPrice_(x, s.extras[x.id]), 0);
  if (fees.length || extrasSum) {
    const feeSum = fees.reduce((a, b) => a + b, 0);
    lines.push('', `K úhradě na místě: ${money_(feeSum + extrasSum)}` +
      (fees.length && extrasSum ? ` (startovné ${money_(feeSum)}, doplňky ${money_(extrasSum)})` : ''));
  }
  lines.push('', `Číslo přihlášky: ${result.applicationId}`);
  const editUrl = editUrl_(result.editToken);
  if (editUrl) lines.push('', 'Odhlášení nebo změna ubytování a dalších údajů:', editUrl);
  const site = PropertiesService.getScriptProperties().getProperty('SITE_URL');
  if (site) lines.push(`Seznam přihlášených: ${site.replace(/\/$/, '')}/seznam.html?akce=${ev.slug}`);
  if (ev.infoUrl) lines.push(`Informace: ${ev.infoUrl}`);
  lines.push('', 'Pokud chcete přihlášku změnit nebo zrušit, odpovězte prosím na tento e-mail.');
  const opts = { to: email, subject: `Přihláška – ${ev.name}`, body: lines.join('\n'), name: ev.name };
  if (ev.contactEmail) opts.replyTo = ev.contactEmail;
  return sendMail_(opts);
}

// =====================================================================
// Změna přihlášky přes odkaz z e-mailu + záznam změn
// =====================================================================

function editUrl_(token) {
  const site = PropertiesService.getScriptProperties().getProperty('SITE_URL');
  return site && token ? `${site.replace(/\/$/, '')}/zmena.html?t=${token}` : '';
}

function makeToken_() {
  if (typeof Utilities !== 'undefined' && Utilities.getUuid) {
    return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 40);
  }
  let s = '';
  while (s.length < 40) s += Math.random().toString(36).slice(2);
  return s.slice(0, 40);
}

function tourShortById_(ev, id) {
  const t = ev.tournaments.find((x) => x.id === id);
  return t ? t.short || t.name : '(smazaný turnaj)';
}

/** Online změny jdou do dne před začátkem akce. */
function canSelfEdit_(ev, now) {
  if (ev.status === 'archiv' || ev.status === 'koncept') return false;
  // klubová sekce: změny po celou sezónu (do jejího konce), jednotlivé turnaje hlídá jejich uzávěrka
  if (ev.kind === 'club') {
    const end = new Date((ev.dateTo || ev.dateFrom || '2100-01-01') + 'T23:59:59');
    return isNaN(end.getTime()) || now <= end;
  }
  const start = new Date((ev.dateFrom || '2100-01-01') + 'T00:00:00');
  return isNaN(start.getTime()) || now < start;
}

function findApplication_(token) {
  const t = String(token || '').trim();
  if (t.length < 20) throw userError_('Neplatný odkaz na přihlášku.', 'not_found');
  const all = table_('registrations').rows.filter((r) => r.editToken === t);
  if (!all.length) throw userError_('Přihláška nebyla nalezena – odkaz je neplatný, nebo byla přihláška smazána.', 'not_found');
  const rows = all.filter((r) => r.eventId === all[0].eventId);
  return { ev: loadEventById_(rows[0].eventId), rows };
}

function applicationExtras_(rows) {
  const active = rows.find((r) => r.status !== CANCELLED) || rows[0];
  return parseJson_(active.extras, {});
}

/** Co uvidí přihlášený na stránce změn (bez interních poznámek pořadatele). */
function applicationView_(ev, rows, now) {
  const first = rows[0];
  const event = publicEvent_(ev);
  event.contactEmail = ev.contactEmail;
  return {
    event,
    application: {
      id: first.applicationId,
      email: first.email,
      mode: first.mode === 'team' ? 'team' : 'individual',
      createdAt: first.createdAt,
      team: first.team || '',
      captain: first.captain || '',
      extras: applicationExtras_(rows),
      teams: first.mode === 'team' ? groupTeams_(ev, rows) : [],
      entries: rows.filter((r) => !isTeamRow_(r)).map((r) => ({
        id: r.id,
        name: fullName_(rowToPlayer_(r)),
        year: toInt_(r.year),
        club: String(r.club || ''),
        tournamentId: r.tournamentId,
        tournament: tourShortById_(ev, r.tournamentId),
        board: toInt_(r.board) || null,
        cancelled: r.status === CANCELLED,
        fee: rowFee_(ev, r),
      })),
    },
    canEdit: canSelfEdit_(ev, now),
    canRestore: canSelfEdit_(ev, now) && !isClosed_(ev, now),
  };
}

/** Družstva přihlášky: řádek družstva + hráči seřazení podle šachovnic. */
function groupTeams_(ev, rows) {
  const map = {};
  const order = [];
  rows.forEach((r) => {
    const key = r.tournamentId + '|' + norm_(r.team);
    if (!map[key]) {
      const t = ev.tournaments.find((x) => x.id === r.tournamentId) || {};
      map[key] = {
        key, name: String(r.team || ''), captain: String(r.captain || ''), tournamentId: r.tournamentId,
        tournament: tourShortById_(ev, r.tournamentId), boards: t.boards || 4, reserves: t.reserves || 0,
        fee: t.fee != null ? entryFee_(t, {}) : null, cancelled: true, players: [],
      };
      order.push(key);
    }
    const g = map[key];
    if (r.status !== CANCELLED) g.cancelled = false;
    if (!isTeamRow_(r) && r.status !== CANCELLED) {
      const p = rowToPlayer_(r);
      g.players.push(Object.assign(p, { rowId: r.id, board: toInt_(r.board) }));
    }
  });
  return order.map((k) => {
    map[k].players.sort((a, b) => a.board - b.board);
    return map[k];
  });
}

function teamRows_(rows, key) {
  return rows.filter((r) => r.tournamentId + '|' + norm_(r.team) === key);
}

function extraText_(x, v) {
  let t;
  if (x.type === 'quantity') {
    t = (x.options || []).filter((o) => v && toInt_(v[o]) > 0).map((o) => `${o} × ${toInt_(v[o])}`).join(', ');
  } else {
    t = Array.isArray(v) ? v.join(', ') : String(v == null ? '' : v);
  }
  return t || '—';
}

/** Startovné řádku přihlášky (hráč v turnaji / družstvo). null = bez startovného. */
function entryFee_(t, p) {
  if (typeof t.fee !== 'number') return null;
  let best = t.fee;
  if (t.type === 'team') return best;
  (t.feeRules || []).forEach((r) => {
    let ok = false;
    if (r.type === 'women') ok = p.sex === 'F';
    else if (r.type === 'youth') ok = !!p.year && p.year >= Number(r.value);
    else if (r.type === 'senior') ok = !!p.year && p.year <= Number(r.value);
    else if (r.type === 'titles') ok = !!p.title && String(r.value).toUpperCase().split(/[\s,;]+/).indexOf(String(p.title).toUpperCase()) >= 0;
    else if (r.type === 'rating') ok = Math.max(p.rn || 0, p.rf || 0) >= Number(r.value);
    if (ok && r.price < best) best = r.price;
  });
  return best;
}

function rowFee_(ev, r) {
  const t = ev.tournaments.find((x) => x.id === r.tournamentId);
  if (!t) return null;
  if (t.type === 'team') return isTeamRow_(r) ? entryFee_(t, {}) : null;
  return entryFee_(t, rowToPlayer_(r));
}

function money_(n) {
  return String(Math.round(n * 100) / 100).replace('.', ',') + ' Kč';
}

/** Cena odpovědi (obědy, ubytování…). */
function extraPrice_(x, v) {
  const price = (i) => (x.prices && typeof x.prices[i] === 'number' ? x.prices[i] : 0);
  const opts = x.options || [];
  if (x.type === 'quantity') return opts.reduce((sum, o, i) => sum + price(i) * (v && toInt_(v[o]) || 0), 0);
  if (x.type === 'checkboxes') return opts.reduce((sum, o, i) => sum + (Array.isArray(v) && v.indexOf(o) >= 0 ? price(i) : 0), 0);
  if (x.type === 'select') return opts.indexOf(v) >= 0 ? price(opts.indexOf(v)) : 0;
  return 0;
}

/** Řádky doplňujících údajů do e-mailu, včetně cen a součtu. */
function extrasLines_(defs, values) {
  const lines = [];
  let total = 0;
  (defs || []).forEach((x) => {
    const v = (values || {})[x.id];
    if (v == null) return;
    const text = extraText_(x, v);
    if (text === '—') return;
    const price = extraPrice_(x, v);
    total += price;
    lines.push(`${x.label}: ${text}${price ? ` (${money_(price)})` : ''}`);
  });
  if (total) lines.push(`Celkem za doplňky: ${money_(total)}`);
  return lines;
}

/**
 * Změny z odkazu: odhlášení, vrácení odhlášení, doplňující údaje.
 * Čistá funkce – mění předané řádky a vrací { ok, rows (změněné), logs, lines } nebo { ok: false, error }.
 */
function applyApplicationChanges_(ev, appRows, eventRows, changes, now, opts) {
  opts = opts || {};
  const admin = !!opts.admin;
  const fail = (error) => ({ ok: false, error });
  if (!admin && !canSelfEdit_(ev, now)) {
    return fail('Změny už nejde provést online.' + (ev.contactEmail ? ` Kontaktujte prosím pořadatele: ${ev.contactEmail}.` : ' Kontaktujte prosím pořadatele.'));
  }
  const byId = {};
  appRows.forEach((r) => { byId[r.id] = r; });
  const list = (v) => (Array.isArray(v) ? v.map(String) : []);
  const cancel = list(changes.cancel);
  const restore = list(changes.restore);
  if (cancel.concat(restore).some((id) => !byId[id])) return fail('Neplatná položka přihlášky.');

  const touched = [];
  const touch = (r) => { if (touched.indexOf(r) < 0) touched.push(r); };
  const logs = [];
  const lines = [];
  const label = (r) => `${fullName_(rowToPlayer_(r))} – ${tourShortById_(ev, r.tournamentId)}`;

  cancel.forEach((id) => {
    const r = byId[id];
    if (r.status === CANCELLED) return;
    r.status = CANCELLED;
    touch(r);
    logs.push({ registrationId: r.id, action: 'odhláška', detail: label(r) });
    lines.push('Odhlášeno: ' + label(r));
  });

  const toRestore = restore.map((id) => byId[id]).filter((r) => r.status === CANCELLED);
  if (toRestore.length) {
    if (!admin && isClosed_(ev, now)) return fail('Přihlašování je uzavřené, odhlášení už nejde vrátit. Kontaktujte prosím pořadatele.');
    for (const r of toRestore) {
      const t = ev.tournaments.find((x) => x.id === r.tournamentId);
      if (!t) return fail('Turnaj už neexistuje.');
      if (!admin && tournamentClosed_(t, now)) return fail(`Přihlašování na turnaj „${t.short || t.name}“ je už uzavřené, odhlášení nejde vrátit.`);
      const others = eventRows.filter((x) => x !== r && x.tournamentId === t.id && x.status !== CANCELLED);
      if (t.type !== 'team' && others.some((x) => samePlayer_(rowToPlayer_(x), rowToPlayer_(r)))) {
        return fail(`${fullName_(rowToPlayer_(r))} je do turnaje „${t.short || t.name}“ už přihlášen(a) jinou přihláškou.`);
      }
      if (t.capacity && !admin) {
        const taken = t.type === 'team' ? uniq_(others.map((x) => norm_(x.team))) : others;
        const teamBack = t.type === 'team' && taken.indexOf(norm_(r.team)) >= 0;
        if (!teamBack && taken.length >= t.capacity) return fail(`Turnaj „${t.short || t.name}“ je už naplněný.`);
      }
      r.status = '';
      touch(r);
      logs.push({ registrationId: r.id, action: 'obnovení', detail: label(r) });
      lines.push('Znovu přihlášeno: ' + label(r));
    }
  }

  const updatedBy = admin ? opts.adminEmail || 'pořadatel' : 'přihlášený (odkaz z e-mailu)';
  const newRows = [];
  const teams = appRows[0].mode === 'team' ? groupTeams_(ev, appRows) : [];
  const teamByKey = (key) => teams.find((g) => g.key === String(key));

  // odhlášení celého družstva
  list(changes.cancelTeams).forEach((key) => {
    const g = teamByKey(key);
    if (!g) return;
    const rs = teamRows_(appRows, g.key).filter((r) => r.status !== CANCELLED);
    if (!rs.length) return;
    rs.forEach((r) => { r.status = CANCELLED; touch(r); });
    logs.push({ registrationId: '', action: 'odhláška družstva', detail: `${g.name} – ${g.tournament}` });
    lines.push(`Odhlášeno družstvo: ${g.name} – ${g.tournament}`);
  });

  // vrácení odhlášeného družstva (vrátí se hráči odhlášení spolu s ním)
  for (const key of list(changes.restoreTeams)) {
    const g = teamByKey(key);
    if (!g || !g.cancelled) continue;
    if (!admin && isClosed_(ev, now)) return fail('Přihlašování je uzavřené, odhlášení už nejde vrátit. Kontaktujte prosím pořadatele.');
    const t = ev.tournaments.find((x) => x.id === g.tournamentId);
    const otherTeams = uniq_(eventRows.filter((x) => x.tournamentId === g.tournamentId && x.status !== CANCELLED).map((x) => norm_(x.team)));
    if (otherTeams.indexOf(norm_(g.name)) >= 0) return fail(`Družstvo „${g.name}“ je už přihlášené.`);
    if (!admin && t && t.capacity && otherTeams.length >= t.capacity) return fail(`Soutěž „${t.short || t.name}“ je už naplněná.`);
    const rs = teamRows_(appRows, g.key);
    const last = rs.map((r) => String(r.updatedAt || '')).sort().pop();
    rs.filter((r) => String(r.updatedAt || '') === last).forEach((r) => { r.status = ''; touch(r); });
    logs.push({ registrationId: '', action: 'obnovení družstva', detail: `${g.name} – ${g.tournament}` });
    lines.push(`Znovu přihlášeno družstvo: ${g.name} – ${g.tournament}`);
  }

  // nová soupiska družstva (přidání, odebrání, pořadí)
  for (const change of Array.isArray(changes.rosters) ? changes.rosters : []) {
    const g = teamByKey(change && change.key);
    if (!g) return fail('Neplatné družstvo.');
    if (g.cancelled) return fail(`Družstvo „${g.name}“ je odhlášené.`);
    const t = ev.tournaments.find((x) => x.id === g.tournamentId);
    if (!t) return fail('Soutěž družstva už neexistuje.');
    const roster = cleanRoster_(t, change.players, eventYear_(ev), { admin, requireFull: false, label: g.name });
    if (roster.error) return fail(`${g.name}: ${roster.error}`);
    const mine = teamRows_(appRows, g.key);
    const others = eventRows.filter((x) => x.tournamentId === t.id && x.status !== CANCELLED && !isTeamRow_(x) && mine.indexOf(x) < 0);
    for (const p of roster.players) {
      const clash = others.find((x) => samePlayer_(rowToPlayer_(x), p));
      if (clash) return fail(`${fullName_(p)} už hraje za družstvo „${clash.team}“.`);
    }
    const current = mine.filter((r) => !isTeamRow_(r) && r.status !== CANCELLED);
    const used = [];
    let changed = false;
    roster.players.forEach((p, i) => {
      const r = current.find((x) => used.indexOf(x) < 0 && samePlayer_(rowToPlayer_(x), p));
      if (r) {
        used.push(r);
        if (toInt_(r.board) !== i + 1) { r.board = i + 1; touch(r); changed = true; }
        return;
      }
      const src = mine.find(isTeamRow_) || mine[0];
      newRows.push(Object.assign({}, {
        applicationId: src.applicationId, eventId: src.eventId, tournamentId: t.id, email: src.email, mode: 'team',
        extras: src.extras, editToken: src.editToken, team: src.team, captain: src.captain, orgNote: '',
      }, playerToRow_(p, t), { id: makeId_(now, 8), createdAt: now.toISOString(), status: '', board: i + 1 }));
      changed = true;
    });
    current.filter((r) => used.indexOf(r) < 0).forEach((r) => { r.status = CANCELLED; touch(r); changed = true; });
    if (changed) {
      const text = roster.players.length
        ? roster.players.map((p, i) => `${i + 1 > (t.boards || 4) ? 'N' : i + 1}. ${fullName_(p)}`).join(', ')
        : 'prázdná';
      logs.push({ registrationId: '', action: 'soupiska', detail: `${g.name}: ${text}` });
      lines.push(`Soupiska ${g.name}: ${text}`);
    }
  }

  if (changes.extras && typeof changes.extras === 'object') {
    const mode = appRows[0].mode === 'team' ? 'team' : 'individual';
    const oldEx = applicationExtras_(appRows);
    const newEx = cleanExtras_(ev.extras, changes.extras, mode);
    const diffs = (ev.extras || [])
      .filter((x) => (x.modes || TOURNAMENT_TYPES).indexOf(mode) >= 0)
      .filter((x) => extraText_(x, oldEx[x.id]) !== extraText_(x, newEx[x.id]))
      .map((x) => `${x.label}: ${extraText_(x, oldEx[x.id])} → ${extraText_(x, newEx[x.id])}`);
    if (diffs.length) {
      appRows.forEach((r) => { r.extras = JSON.stringify(newEx); touch(r); });
      logs.push({ registrationId: '', action: 'změna údajů', detail: diffs.join('; ') });
      diffs.forEach((d) => lines.push(d));
    }
  }

  if (!logs.length) return fail('Nebyla provedena žádná změna.');
  touched.forEach((r) => { r.updatedAt = now.toISOString(); r.updatedBy = updatedBy; });
  newRows.forEach((r) => { r.updatedAt = now.toISOString(); r.updatedBy = updatedBy; });
  return { ok: true, rows: touched, newRows, logs, lines };
}

function updateApplication_(body, adminUser) {
  const app = findApplication_(body.token);
  const ev = app.ev;
  if (adminUser) assertCanEdit_(adminUser, ev);
  const now = new Date();
  const eventRows = table_('registrations').rows.filter((r) => r.eventId === ev.id);
  const res = applyApplicationChanges_(ev, app.rows, eventRows, body.changes || {}, now,
    { admin: !!adminUser, adminEmail: adminUser ? adminUser.email : '' });
  if (!res.ok) throw userError_(res.error);
  res.rows.forEach((r) => update_('registrations', r));
  insert_('registrations', res.newRows);
  logChanges_(ev, app.rows[0].applicationId, res.logs, adminUser ? adminUser.email : 'přihlášený (odkaz z e-mailu)', now);
  SpreadsheetApp.flush();
  const rows = table_('registrations').rows.filter((r) => r.editToken === app.rows[0].editToken);
  if (!adminUser) {
    try {
      sendChangeEmails_(ev, rows, res.lines);
    } catch (err) {
      console.error('E-mail o změně se nepodařilo odeslat', err);
    }
  }
  const view = applicationView_(ev, rows, now);
  if (adminUser) Object.assign(view, { canEdit: true, canRestore: true, admin: true });
  return Object.assign(view, { saved: res.lines });
}

function sendChangeEmails_(ev, rows, lines) {
  const first = rows[0];
  const active = rows.filter((r) => r.status !== CANCELLED);
  let state;
  if (!active.length) state = ['  (všichni hráči jsou odhlášeni)'];
  else if (first.mode === 'team') {
    state = groupTeams_(ev, rows).filter((g) => !g.cancelled).map((g) => `  • ${g.name} (${g.tournament}): ` +
      (g.players.length ? g.players.map((p) => `${p.board > g.boards ? 'N' : p.board}. ${fullName_(p)}`).join(', ') : 'soupiska zatím není'));
  } else {
    state = active.map((r) => `  • ${fullName_(rowToPlayer_(r))} – ${tourShortById_(ev, r.tournamentId)}`);
  }
  const url = editUrl_(first.editToken);
  if (first.email) {
    const body = ['Dobrý den,', '', `ve vaší přihlášce na akci ${ev.name} byly provedeny tyto změny:`, '']
      .concat(lines.map((l) => '  ' + l), ['', 'Aktuálně přihlášení:'], state,
        active.length ? [''].concat(extrasLines_(ev.extras, applicationExtras_(rows))) : [],
        ['', `Číslo přihlášky: ${first.applicationId}`], url ? ['', 'Další změny:', url] : []).join('\n');
    const opts = { to: first.email, subject: `Změna přihlášky – ${ev.name}`, body, name: ev.name };
    if (ev.contactEmail) opts.replyTo = ev.contactEmail;
    sendMail_(opts);
  }
  if (ev.contactEmail) {
    const body = [`Přihláška č. ${first.applicationId} (${first.email || 'bez e-mailu'}) byla změněna přes odkaz z e-mailu:`, '']
      .concat(lines.map((l) => '  ' + l), ['', 'Aktuálně přihlášení:'], state).join('\n');
    sendMail_({ to: ev.contactEmail, subject: `Změna přihlášky č. ${first.applicationId} – ${ev.name}`, body, name: 'Přihlášky' });
  }
}

const FIELD_LABELS_ = {
  surname: 'Příjmení', firstName: 'Jméno', year: 'Ročník', club: 'Klub', rn: 'ELO ČR', rf: 'FIDE', idCr: 'ID ČR',
  fideId: 'FIDE ID', email: 'E-mail', team: 'Družstvo', board: 'Šachovnice', captain: 'Kapitán', orgNote: 'Poznámka pořadatele',
};

/** Záznamy změn po úpravě řádku pořadatelem. */
function registrationDiff_(ev, before, after) {
  const name = `${after.surname} ${after.firstName}`;
  const logs = [];
  if (before.status !== after.status) {
    logs.push({
      registrationId: after.id,
      action: after.status === CANCELLED ? 'odhláška' : 'obnovení',
      detail: `${name} – ${tourShortById_(ev, after.tournamentId)}`,
    });
  }
  const diffs = Object.keys(FIELD_LABELS_)
    .filter((k) => String(before[k] == null ? '' : before[k]) !== String(after[k] == null ? '' : after[k]))
    .map((k) => `${FIELD_LABELS_[k]}: ${before[k] === '' || before[k] == null ? '—' : before[k]} → ${after[k] === '' || after[k] == null ? '—' : after[k]}`);
  if (before.tournamentId !== after.tournamentId) {
    diffs.push(`Turnaj: ${tourShortById_(ev, before.tournamentId)} → ${tourShortById_(ev, after.tournamentId)}`);
  }
  if (diffs.length) logs.push({ registrationId: after.id, action: 'úprava', detail: `${name}: ${diffs.join('; ')}` });
  return logs;
}

function logChanges_(ev, applicationId, logs, by, now) {
  if (!logs.length) return;
  insert_('changes', logs.map((l) => ({
    id: makeId_(now, 8), at: now.toISOString(), eventId: ev.id, applicationId,
    registrationId: l.registrationId || '', by, action: l.action, detail: clean_(l.detail, 2000),
  })));
}

// =====================================================================
// Administrace
// =====================================================================

/** Ověří Google ID token z přihlášení na webu a najde správce. */
function authenticate_(idToken) {
  if (!idToken) throw userError_('Přihlaste se prosím.', 'auth');
  const clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  if (!clientId) throw userError_('Na serveru chybí GOOGLE_CLIENT_ID (menu Turnaje → Nastavení).');
  const cache = CacheService.getScriptCache();
  const key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)).slice(0, 40);
  let email = cache.get(key);
  if (!email) {
    const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw userError_('Přihlášení vypršelo, přihlaste se znovu.', 'auth');
    const info = JSON.parse(res.getContentText());
    if (info.aud !== clientId) throw userError_('Neplatné přihlášení.', 'auth');
    if (String(info.email_verified) !== 'true') throw userError_('E-mail Google účtu není ověřený.', 'auth');
    if (Number(info.exp) * 1000 < Date.now()) throw userError_('Přihlášení vypršelo, přihlaste se znovu.', 'auth');
    email = String(info.email).toLowerCase();
    const ttl = Math.min(21600, Math.max(60, Math.floor(Number(info.exp) - Date.now() / 1000)));
    cache.put(key, email, ttl);
  }
  const user = table_('users').rows.find((u) => String(u.email).toLowerCase() === email && u.active !== 'NE');
  if (!user) throw userError_(`Účet ${email} nemá přístup do administrace. Požádejte správce o přidání.`, 'forbidden');
  return { email, name: String(user.name || ''), club: String(user.club || ''), role: ROLES.indexOf(user.role) >= 0 ? user.role : 'organizer' };
}

function canEdit_(user, ev) {
  if (user.role === 'clubadmin' && ev.kind === 'club') return true;
  return user.role === 'superadmin' || ev.admins.indexOf(user.email) >= 0 || ev.createdBy === user.email;
}

function assertCanEdit_(user, ev) {
  if (!canEdit_(user, ev)) throw userError_('K této akci nemáte oprávnění.', 'forbidden');
}

function assertSuperadmin_(user) {
  if (user.role !== 'superadmin') throw userError_('Tuto část může upravovat jen hlavní správce.', 'forbidden');
}

function adminEventView_(ev, regs) {
  const out = stripRow_(ev);
  out.tournaments = ev.tournaments.map((t) => {
    const active = regs.filter((r) => r.tournamentId === t.id && r.status !== CANCELLED);
    return Object.assign(stripRow_(t), {
      count: t.type === 'team' ? uniq_(active.map((r) => norm_(r.team))).length : active.length,
    });
  });
  out.registrations = uniq_(regs.filter((r) => r.status !== CANCELLED).map((r) => r.applicationId)).length;
  return out;
}

const ADMIN_ACTIONS = {
  me(body, user) {
    return { user };
  },

  events(body, user) {
    const regs = table_('registrations').rows;
    const all = loadEvents_();
    const covered = coveredClubEvents_(all);
    const events = all.filter((e) => canEdit_(user, e))
      .sort((a, b) => String(b.dateFrom).localeCompare(String(a.dateFrom)))
      .map((e) => {
        const v = adminEventView_(e, regs.filter((r) => r.eventId === e.id));
        if (covered[e.id]) v.coveredBy = { id: covered[e.id].id, name: covered[e.id].name };
        return v;
      });
    return { user, events, system: systemStatus_(user) };
  },

  event(body, user) {
    const ev = loadEventById_(body.id);
    assertCanEdit_(user, ev);
    const regs = table_('registrations').rows.filter((r) => r.eventId === ev.id);
    const changes = table_('changes').rows.filter((c) => c.eventId === ev.id).map(stripRow_);
    const receipts = table_('receipts').rows.filter((r) => r.eventId === ev.id).map(receiptView_);
    return { event: adminEventView_(ev, regs), registrations: regs.map(stripRow_), changes, receipts, system: systemStatus_(user) };
  },

  saveEvent(body, user) {
    return withLock_(() => {
      const input = body.event || {};
      const events = loadEvents_();
      const existing = input.id ? events.find((e) => e.id === String(input.id)) : null;
      if (input.id && !existing) throw userError_('Akce nebyla nalezena.');
      if (existing) assertCanEdit_(user, existing);
      const clean = sanitizeEvent_(input, events, existing ? existing.id : null);
      // klubovou sekci spravuje klubový admin (a hlavní správce); pořadatel ji zakládat nesmí
      const mayClub = user.role === 'superadmin' || user.role === 'clubadmin' || (existing && existing.kind === 'club');
      if (clean.event.kind === 'club' && !mayClub) {
        throw userError_('Akce klubové sekce zakládá klubový admin nebo hlavní správce.', 'forbidden');
      }
      const now = new Date().toISOString();

      let evRow;
      if (existing) {
        const fullClub = user.role === 'clubadmin' && existing.kind === 'club';
        if (user.role !== 'superadmin' && existing.createdBy !== user.email && !fullClub) {
          clean.event.admins = existing.admins; // správce akce smí měnit jen zakladatel a hlavní správce
        }
        evRow = table_('events').rows.find((r) => r._row === existing._row);
        Object.assign(evRow, clean.event, { admins: clean.event.admins.join(', '), extras: JSON.stringify(clean.event.extras), issuer: JSON.stringify(clean.event.issuer), updatedAt: now });
        update_('events', evRow);
      } else {
        evRow = Object.assign({}, clean.event, {
          id: makeId_(new Date(), 8),
          admins: uniq_([user.email].concat(clean.event.admins)).join(', '),
          extras: JSON.stringify(clean.event.extras),
          issuer: JSON.stringify(clean.event.issuer),
          createdBy: user.email, createdAt: now, updatedAt: now,
        });
        insert_('events', [evRow]);
      }

      // turnaje: aktualizovat, přidat, smazat (jen bez přihlášek)
      const oldTours = existing ? existing.tournaments : [];
      const keepIds = clean.tournaments.map((t) => t.id).filter(Boolean);
      const removed = oldTours.filter((t) => keepIds.indexOf(t.id) < 0);
      if (removed.length) {
        const regs = table_('registrations').rows;
        const used = removed.filter((t) => regs.some((r) => r.tournamentId === t.id));
        if (used.length) {
          throw userError_(`Turnaj „${used[0].name}“ nelze smazat, už má přihlášky. Nejdřív je zrušte nebo smažte v tabulce.`);
        }
      }
      const tourRows = table_('tournaments').rows;
      const toInsert = [];
      clean.tournaments.forEach((t) => {
        const old = t.id && tourRows.find((r) => r.id === t.id && r.eventId === evRow.id);
        if (old) {
          Object.assign(old, t, { feeRules: JSON.stringify(t.feeRules) });
          update_('tournaments', old);
        } else {
          toInsert.push(Object.assign({}, t, { feeRules: JSON.stringify(t.feeRules), id: makeId_(new Date(), 8), eventId: evRow.id }));
        }
      });
      if (removed.length) remove_('tournaments', tourRows.filter((r) => removed.some((t) => t.id === r.id)));
      insert_('tournaments', toInsert);
      SpreadsheetApp.flush();
      Object.keys(DB_CACHE_).forEach((k) => delete DB_CACHE_[k]);
      clearPublicCache_();
      return { event: stripRow_(loadEventById_(evRow.id)) };
    });
  },

  copyEvent(body, user) {
    const src = loadEventById_(body.id);
    assertCanEdit_(user, src);
    // nový začátek → posun všech dat o stejný počet dní; ročníky o rozdíl let (nebo podle shiftYears)
    const newFrom = cleanDate_(body.dateFrom);
    const days = newFrom && src.dateFrom ? daysBetween_(src.dateFrom, newFrom) : 0;
    let years = toInt_(body.shiftYears);
    if (newFrom && body.shiftBirthYears !== false && body.shiftYears == null) {
      years = toInt_(newFrom.slice(0, 4)) - toInt_(String(src.dateFrom).slice(0, 4));
    }
    if (newFrom && body.shiftBirthYears === false) years = 0;
    const shiftDate = (d) => {
      if (!d) return d;
      if (newFrom) return addDays_(d, days);
      return years ? String(toInt_(d.slice(0, 4)) + years) + d.slice(4) : d;
    };
    const shiftYear = (y) => (y && years ? y + years : y);
    const copy = {
      name: clean_(body.name, 150) || src.name + ' (kopie)',
      place: src.place, dateFrom: shiftDate(src.dateFrom), dateTo: shiftDate(src.dateTo),
      deadline: shiftDate(src.deadline), status: 'koncept', infoUrl: src.infoUrl, intro: src.intro,
      contactEmail: src.contactEmail, admins: src.admins, extras: src.extras, issuer: src.issuer,
      kind: src.kind, group: src.group,
      tournaments: src.tournaments.map((t) => Object.assign(stripRow_(t), {
        id: '', minBirthYear: shiftYear(t.minBirthYear), maxBirthYear: shiftYear(t.maxBirthYear),
        dateFrom: shiftDate(t.dateFrom), dateTo: shiftDate(t.dateTo), deadline: shiftDate(t.deadline),
      })),
    };
    return ADMIN_ACTIONS.saveEvent({ event: copy }, user);
  },

  deleteEvent(body, user) {
    return withLock_(() => {
      const ev = loadEventById_(body.id);
      assertCanEdit_(user, ev);
      if (table_('registrations').rows.some((r) => r.eventId === ev.id)) {
        throw userError_('Akce už má přihlášky – místo smazání ji přepněte do archivu.');
      }
      remove_('tournaments', table_('tournaments').rows.filter((r) => r.eventId === ev.id));
      remove_('events', table_('events').rows.filter((r) => r.id === ev.id));
      clearPublicCache_();
      return {};
    });
  },

  application(body, user) {
    const app = findApplication_(body.token);
    assertCanEdit_(user, app.ev);
    return Object.assign(applicationView_(app.ev, app.rows, new Date()), { canEdit: true, canRestore: true, admin: true });
  },

  updateApplication(body, user) {
    return withLock_(() => updateApplication_(body, user));
  },

  receipts(body, user) {
    const ev = loadEventById_(body.eventId);
    assertCanEdit_(user, ev);
    return { receipts: table_('receipts').rows.filter((r) => r.eventId === ev.id).map(receiptView_) };
  },

  /** Vystaví jeden nebo více dokladů; položky musí být dosud nezaplacené. */
  issueReceipts(body, user) {
    return withLock_(() => {
      const ev = loadEventById_(body.eventId);
      assertCanEdit_(user, ev);
      const list = Array.isArray(body.receipts) ? body.receipts : [];
      if (!list.length) throw userError_('Vyberte položky k zaplacení.');
      const all = table_('receipts').rows;
      const paid = {};
      all.filter((r) => r.eventId === ev.id && r.status !== RECEIPT_CANCELLED)
        .forEach((r) => parseJson_(r.items, []).forEach((it) => { paid[it.key] = r.number; }));
      const issuer = Object.assign({}, cleanIssuer_(ev.issuer));
      if (!issuer.name) throw userError_('V nastavení akce vyplňte údaje pro doklady (název klubu, IČO, adresa).');
      const prefix = issuer.prefix || `${eventYear_(ev)}-`;
      let seq = all.filter((r) => String(r.number).indexOf(prefix) === 0)
        .reduce((m, r) => Math.max(m, toInt_(String(r.number).slice(prefix.length))), 0);
      const now = new Date();
      const out = list.map((rc) => {
        const items = (Array.isArray(rc.items) ? rc.items : []).map((it) => ({
          key: clean_(it.key, 120), label: clean_(it.label, 200), person: clean_(it.person, 120),
          amount: cleanPrice_(it.amount) || 0,
        })).filter((it) => it.key && it.label);
        if (!items.length) throw userError_('Doklad musí mít aspoň jednu položku.');
        const dup = items.find((it) => paid[it.key]);
        if (dup) throw userError_(`Položka „${dup.label}“ (${dup.person}) je už zaplacená dokladem ${paid[dup.key]}.`);
        items.forEach((it) => { paid[it.key] = 'tento'; });
        const payer = clean_(rc.payer, 150);
        if (!payer) throw userError_('Vyplňte, od koho byla platba přijata.');
        seq += 1;
        return {
          id: makeId_(now, 8), number: prefix + String(seq).padStart(4, '0'), eventId: ev.id,
          issuedAt: now.toISOString(), issuedBy: user.email, payer, payerClub: clean_(rc.payerClub, 150),
          method: 'hotově', items: JSON.stringify(items), total: Math.round(items.reduce((a, it) => a + it.amount, 0) * 100) / 100,
          issuer: JSON.stringify(issuer), note: clean_(rc.note, 300), status: '',
        };
      });
      insert_('receipts', out);
      logChanges_(ev, '', out.map((r) => ({ registrationId: '', action: 'doklad', detail: `${r.number}: ${r.payer} – ${money_(r.total)}` })), user.email, now);
      return { issued: out.map(receiptView_), receipts: table_('receipts').rows.filter((r) => r.eventId === ev.id).map(receiptView_) };
    });
  },

  cancelReceipt(body, user) {
    return withLock_(() => {
      const r = table_('receipts').rows.find((x) => x.id === String(body.id));
      if (!r) throw userError_('Doklad nebyl nalezen.');
      const ev = loadEventById_(r.eventId);
      assertCanEdit_(user, ev);
      if (r.status === RECEIPT_CANCELLED) throw userError_('Doklad už je stornovaný.');
      r.status = RECEIPT_CANCELLED;
      update_('receipts', r);
      logChanges_(ev, '', [{ registrationId: '', action: 'storno dokladu', detail: `${r.number}: ${r.payer} – ${money_(Number(r.total) || 0)}` }], user.email, new Date());
      return { receipts: table_('receipts').rows.filter((x) => x.eventId === ev.id).map(receiptView_) };
    });
  },

  addRegistration(body, user) {
    return withLock_(() => register_(body, user));
  },

  updateRegistration(body, user) {
    return withLock_(() => {
      const row = table_('registrations').rows.find((r) => r.id === String(body.id));
      if (!row) throw userError_('Přihláška nebyla nalezena.');
      assertCanEdit_(user, loadEventById_(row.eventId));
      const ch = body.changes || {};
      const ev = loadEventById_(row.eventId);
      const before = Object.assign({}, row);
      if ('status' in ch) row.status = ch.status === CANCELLED ? CANCELLED : '';
      if ('orgNote' in ch) row.orgNote = clean_(ch.orgNote, 1000);
      ['surname', 'firstName', 'club', 'email', 'team', 'captain'].forEach((k) => {
        if (k in ch) row[k] = clean_(ch[k], k === 'email' ? 200 : 100);
      });
      ['year', 'rn', 'rf', 'idCr', 'fideId', 'board'].forEach((k) => {
        if (k in ch) row[k] = toInt_(ch[k]) || '';
      });
      if ('tournamentId' in ch) {
        const t = ev.tournaments.find((x) => x.id === String(ch.tournamentId));
        if (!t) throw userError_('Turnaj nebyl nalezen.');
        row.tournamentId = t.id;
      }
      if (!row.surname || !row.firstName) throw userError_('Jméno a příjmení nesmí být prázdné.');
      const now = new Date();
      const logs = registrationDiff_(ev, before, row);
      if (!logs.length) return { registration: stripRow_(row) };
      row.updatedAt = now.toISOString();
      row.updatedBy = user.email;
      update_('registrations', row);
      logChanges_(ev, row.applicationId, logs, user.email, now);
      return { registration: stripRow_(row), changes: table_('changes').rows.filter((c) => c.eventId === ev.id).map(stripRow_) };
    });
  },

  /** Klubový kalendář: otevřít / zavřít přihlašování na turnaj, případně změnit klubovou uzávěrku. */
  setTournamentSignup(body, user) {
    const ev = loadEventById_(body.eventId);
    assertCanEdit_(user, ev);
    return withLock_(() => {
      const row = table_('tournaments').rows.find((r) => r.id === String(body.tournamentId) && r.eventId === ev.id);
      if (!row) throw userError_('Turnaj nebyl nalezen.');
      const signup = SIGNUP_TYPES.indexOf(body.signup) >= 0 ? body.signup : (SIGNUP_TYPES.indexOf(row.signup) >= 0 ? row.signup : 'open');
      const before = SIGNUP_TYPES.indexOf(row.signup) >= 0 ? row.signup : 'open';
      row.signup = signup;
      if ('deadline' in body) {
        const d = cleanDate_(body.deadline);
        if (body.deadline && !d) throw userError_('Uzávěrka musí být datum.');
        if (d && row.dateFrom && d > String(row.dateFrom)) throw userError_('Uzávěrka je až po začátku turnaje.');
        row.deadline = d;
      }
      if ('note' in body) row.note = clean_(body.note, 300);
      if ('infoUrl' in body) row.infoUrl = /^https?:\/\//.test(String(body.infoUrl || '')) ? clean_(body.infoUrl, 300) : '';
      if ('categories' in body && row.type !== 'team') row.categories = parseCategories_(body.categories).join(', ');
      update_('tournaments', row);
      const labels = { open: 'přihlašování otevřeno', none: 'výpravu nepořádáme', league: 'dlouhodobá soutěž' };
      logChanges_(ev, '', [{
        action: before === signup ? 'úprava turnaje' : 'stav turnaje',
        detail: `${row.short || row.name}: ${before === signup ? labels[signup] : labels[before] + ' → ' + labels[signup]}` +
          `${row.deadline ? ', uzávěrka ' + fmtDate_(row.deadline) : ''}${row.note ? ', poznámka: ' + row.note : ''}`,
      }], user.email, new Date());
      clearPublicCache_();
      return { event: adminEventView_(loadEventById_(ev.id), table_('registrations').rows.filter((r) => r.eventId === ev.id)) };
    });
  },

  /** Přepočet ratingu z aktuální LOK / rapid LOK: updates = [{ id, rn, rf }] (spočítá web z listiny). */
  updateRatings(body, user) {
    const ev = loadEventById_(body.eventId);
    assertCanEdit_(user, ev);
    const updates = Array.isArray(body.updates) ? body.updates.slice(0, 2000) : [];
    return withLock_(() => {
      const byId = {};
      table_('registrations').rows.forEach((r) => { if (r.eventId === ev.id) byId[r.id] = r; });
      const now = new Date();
      const logs = {};
      let changed = 0;
      updates.forEach((u) => {
        const row = byId[String(u && u.id)];
        if (!row || !row.surname || row.inLok !== YES) return;
        const rn = toInt_(u.rn);
        const rf = toInt_(u.rf);
        if (toInt_(row.rn) === rn && toInt_(row.rf) === rf) return;
        const t = ev.tournaments.find((x) => x.id === row.tournamentId);
        const parts = [];
        if (toInt_(row.rn) !== rn) parts.push(`ELO ČR ${toInt_(row.rn) || '—'} → ${rn || '—'}`);
        if (toInt_(row.rf) !== rf) parts.push(`FIDE ${toInt_(row.rf) || '—'} → ${rf || '—'}`);
        (logs[row.applicationId] = logs[row.applicationId] || []).push({
          registrationId: row.id, action: 'přepočet ratingu',
          detail: `${row.surname} ${row.firstName} – ${t ? t.short || t.name : ''}${t && t.rating === 'rapid' ? ' (rapid)' : ''}: ${parts.join('; ')}`,
        });
        row.rn = rn || '';
        row.rf = rf || '';
        row.updatedAt = now.toISOString();
        row.updatedBy = user.email;
        update_('registrations', row);
        changed++;
      });
      Object.keys(logs).forEach((appId) => logChanges_(ev, appId, logs[appId], user.email, now));
      return { changed };
    });
  },

  users(body, user) {
    assertSuperadmin_(user);
    return { users: table_('users').rows.map(stripRow_) };
  },

  saveUser(body, user) {
    assertSuperadmin_(user);
    return withLock_(() => {
      const u = body.user || {};
      const email = String(u.email || '').trim().toLowerCase();
      if (!isEmail_(email)) throw userError_('Zadejte platný e-mail (Google účet).');
      const data = {
        email, name: clean_(u.name, 100), club: clean_(u.club, 100),
        role: ROLES.indexOf(u.role) >= 0 ? u.role : 'organizer', active: u.active === 'NE' ? 'NE' : YES,
      };
      if (email === user.email && data.role !== 'superadmin') throw userError_('Sami sobě nemůžete odebrat roli hlavního správce.');
      const existing = table_('users').rows.find((r) => String(r.email).toLowerCase() === email);
      if (existing) {
        Object.assign(existing, data);
        update_('users', existing);
      } else {
        insert_('users', [Object.assign(data, { createdAt: new Date().toISOString() })]);
      }
      return { users: table_('users').rows.map(stripRow_) };
    });
  },
};

// =====================================================================
// Drobnosti
// =====================================================================

function tourTitle_(t) {
  const when = t.dateFrom ? fmtDate_(t.dateFrom) + (t.dateTo && t.dateTo !== t.dateFrom ? '–' + fmtDate_(t.dateTo) : '') : '';
  return [when || t.day, t.name].filter(Boolean).join(' – ') + (t.place ? ` (${t.place})` : '');
}
function fmtDate_(d) {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${+m[3]}. ${+m[2]}. ${m[1]}` : String(d || '');
}
function fullName_(p) { return `${p.surname} ${p.firstName}`.trim(); }
function uniq_(arr) { return arr.filter((v, i) => v && arr.indexOf(v) === i); }
function toInt_(v) { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function isEmail_(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim()); }

function splitEmails_(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/);
  return uniq_(list.map((s) => String(s).trim().toLowerCase()).filter(isEmail_));
}

function parseJson_(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

function norm_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function clean_(v, max) {
  let s = String(v == null ? '' : v).replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').trim();
  if (max) s = s.slice(0, max);
  return s;
}

function makeId_(now, len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < (len || 4); i++) s += chars[Math.floor(Math.random() * chars.length)];
  if (len) return s;
  const pad = (n) => (n < 10 ? '0' : '') + n;
  return `${pad(now.getMonth() + 1)}${pad(now.getDate())}-${s}`;
}

// =====================================================================
// E-maily: denní limit, fronta neodeslaných, volitelně Brevo
// =====================================================================
// Gmail účet smí ze skriptu poslat jen ~100 e-mailů denně (Workspace 1500). Co se nevejde,
// uloží se do listu „E-maily“ a odešle se automaticky, jakmile se limit obnoví (spouštěč každou hodinu).

const MAIL_QUEUED = 'čeká';
const MAIL_SENT = 'odesláno';
const MAIL_LOW = 20;

function mailProvider_() {
  return PropertiesService.getScriptProperties().getProperty('BREVO_API_KEY') ? 'brevo' : 'gmail';
}

function mailRecipients_(m) {
  return String(m.to || '').split(',').filter((x) => x.trim()).length || 1;
}

/** Odešle hned, nebo vyhodí chybu (limit, výpadek služby). */
function deliverMail_(m) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('BREVO_API_KEY');
  if (key) {
    const payload = {
      sender: { name: m.name || 'Přihlášky', email: props.getProperty('BREVO_SENDER') || '' },
      to: String(m.to).split(',').map((x) => ({ email: x.trim() })).filter((x) => x.email),
      subject: m.subject,
      textContent: m.body,
    };
    if (m.replyTo) payload.replyTo = { email: m.replyTo };
    const res = UrlFetchApp.fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'post', contentType: 'application/json', headers: { 'api-key': key, accept: 'application/json' },
      payload: JSON.stringify(payload), muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code < 200 || code >= 300) throw new Error(`Brevo ${code}: ${String(res.getContentText()).slice(0, 200)}`);
    return;
  }
  if (MailApp.getRemainingDailyQuota() < mailRecipients_(m)) throw userError_('Denní limit e-mailů je vyčerpaný.', 'mail_quota');
  MailApp.sendEmail(m);
}

/** Odešle e-mail; když to nejde, uloží ho do fronty. Vrací true, pokud odešel hned. */
function sendMail_(m) {
  const pending = table_('mails').rows.some((r) => r.status === MAIL_QUEUED);
  if (!pending) {
    try {
      deliverMail_(m);
      return true;
    } catch (err) {
      console.warn('E-mail jde do fronty: ' + (err.message || err));
      return queueMail_(m, err);
    }
  }
  return queueMail_(m, null); // starší e-maily mají přednost
}

function queueMail_(m, err) {
  insert_('mails', [{
    id: makeId_(new Date(), 8), createdAt: new Date().toISOString(), to: m.to, subject: m.subject, body: m.body,
    name: m.name || '', replyTo: m.replyTo || '', status: MAIL_QUEUED, sentAt: '',
    error: err ? String(err.message || err).slice(0, 300) : '',
  }]);
  return false;
}

/** Odešle čekající e-maily, dokud to limit dovolí. Vrací počet odeslaných. */
function processMailQueue_() {
  const queue = table_('mails').rows.filter((r) => r.status === MAIL_QUEUED)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  let sent = 0;
  for (const r of queue) {
    try {
      const m = { to: r.to, subject: r.subject, body: r.body, name: r.name || undefined };
      if (r.replyTo) m.replyTo = r.replyTo;
      deliverMail_(m);
    } catch (err) {
      r.error = String(err.message || err).slice(0, 300);
      update_('mails', r);
      if (err.code === 'mail_quota') break;
      continue;
    }
    r.status = MAIL_SENT;
    r.sentAt = new Date().toISOString();
    r.error = '';
    update_('mails', r);
    sent++;
  }
  return sent;
}

function systemStatus_(user) {
  const out = { mail: { provider: mailProvider_(), queued: 0, remaining: null } };
  try {
    out.mail.queued = table_('mails').rows.filter((r) => r.status === MAIL_QUEUED).length;
    if (out.mail.provider === 'gmail') out.mail.remaining = MailApp.getRemainingDailyQuota();
  } catch (e) { /* bez oprávnění */ }
  if (user && user.role === 'superadmin') {
    try {
      out.jobs = jobsInstalled_();
      out.lastBackup = PropertiesService.getScriptProperties().getProperty('LAST_BACKUP') || '';
    } catch (e) { out.jobs = false; }
  }
  return out;
}

// =====================================================================
// Zálohy tabulky, anonymizace a automatické spouštěče
// =====================================================================
// Záloha = kopie celé tabulky do složky „Přihlášky – zálohy“ na Disku, jen když se od poslední zálohy
// něco změnilo. Ponechá se posledních 14 záloh a jedna za každý z posledních 12 měsíců, starší jdou do koše.

const BACKUP_FOLDER_NAME = 'Přihlášky – zálohy';
const BACKUP_KEEP_RECENT = 14;
const BACKUP_KEEP_MONTHS = 12;
const ANONYMIZE_AFTER_MONTHS = 12;
const JOB_HANDLERS = ['hourlyJobs', 'dailyJobs'];

function hourlyJobs() {
  processMailQueue_();
}

function dailyJobs() {
  try { backupSpreadsheet_(false); } catch (e) { console.error('Záloha selhala', e); }
  try { anonymizeOldApplications_(new Date()); } catch (e) { console.error('Anonymizace selhala', e); }
  processMailQueue_();
}

function jobsInstalled_() {
  const names = ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction());
  return JOB_HANDLERS.every((h) => names.indexOf(h) >= 0);
}

function installJobs_() {
  ScriptApp.getProjectTriggers().filter((t) => JOB_HANDLERS.indexOf(t.getHandlerFunction()) >= 0)
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('hourlyJobs').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('dailyJobs').timeBased().everyDays(1).atHour(3).create();
}

function backupFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('BACKUP_FOLDER_ID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* složka smazaná – založíme novou */ }
  }
  const f = DriveApp.createFolder(BACKUP_FOLDER_NAME);
  props.setProperty('BACKUP_FOLDER_ID', f.getId());
  return f;
}

/** Vytvoří zálohu (když se tabulka od poslední zálohy změnila, nebo force) a promaže staré. */
function backupSpreadsheet_(force) {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const file = DriveApp.getFileById(ss.getId());
  const last = props.getProperty('LAST_BACKUP');
  if (!force && last && file.getLastUpdated().getTime() <= new Date(last).getTime()) return null;
  const folder = backupFolder_();
  const tz = Session.getScriptTimeZone();
  const stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH-mm');
  const copy = file.makeCopy(`${ss.getName()} – záloha ${stamp}`, folder);
  props.setProperty('LAST_BACKUP', new Date().toISOString());
  pruneBackups_(folder, new Date());
  return copy.getName();
}

/** Které zálohy smazat: ponechá posledních N a nejstarší zálohu z každého z posledních M měsíců. */
function backupsToDelete_(names, now, keepRecent, keepMonths) {
  const dated = names.map((n) => {
    const m = String(n).match(/záloha (\d{4})-(\d{2})-(\d{2})/);
    return m ? { name: n, key: n.slice(n.indexOf('záloha')), month: m[1] + '-' + m[2] } : null;
  }).filter(Boolean).sort((a, b) => b.key.localeCompare(a.key));
  const keep = {};
  dated.slice(0, keepRecent).forEach((d) => { keep[d.name] = true; });
  const months = [];
  for (let i = 0; i < keepMonths; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }
  months.forEach((mo) => {
    const inMonth = dated.filter((d) => d.month === mo);
    if (inMonth.length) keep[inMonth[inMonth.length - 1].name] = true;
  });
  return dated.filter((d) => !keep[d.name]).map((d) => d.name);
}

function pruneBackups_(folder, now) {
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  const del = backupsToDelete_(files.map((f) => f.getName()), now, BACKUP_KEEP_RECENT, BACKUP_KEEP_MONTHS);
  files.filter((f) => del.indexOf(f.getName()) >= 0).forEach((f) => f.setTrashed(true));
}

/**
 * Ochrana osobních údajů: 12 měsíců po skončení akce smaže kontaktní e-maily, odkazy pro změnu
 * a volné texty (poznámky, sdělení). Jméno, ročník, klub a turnaj zůstávají (startovní listina, výsledky),
 * pokladní doklady se nemění (účetní záznam). Vrací počet upravených řádků.
 */
function anonymizeOldApplications_(now) {
  const limit = new Date(now.getFullYear(), now.getMonth() - ANONYMIZE_AFTER_MONTHS, now.getDate());
  const limitStr = Utilities.formatDate(limit, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const old = {};
  loadEvents_().forEach((ev) => {
    const end = ev.dateTo || ev.dateFrom;
    if (end && end < limitStr) old[ev.id] = ev;
  });
  if (!Object.keys(old).length) return 0;
  const admins = {};
  table_('users').rows.forEach((u) => { admins[String(u.email).toLowerCase()] = true; });
  let n = 0;
  table_('registrations').rows.forEach((r) => {
    const ev = old[r.eventId];
    if (!ev || (!r.email && !r.editToken && !r.orgNote && !hasFreeText_(ev, r))) return;
    r.email = '';
    r.editToken = '';
    r.orgNote = '';
    r.extras = JSON.stringify(stripFreeText_(ev, parseJson_(r.extras, {})));
    if (r.updatedBy && !admins[String(r.updatedBy).toLowerCase()]) r.updatedBy = '';
    update_('registrations', r);
    n++;
  });
  table_('changes').rows.forEach((c) => {
    if (!old[c.eventId] || !c.by || admins[String(c.by).toLowerCase()]) return;
    c.by = '';
    update_('changes', c);
  });
  table_('mails').rows.forEach((m) => {
    if (m.status === MAIL_SENT && m.sentAt && String(m.sentAt).slice(0, 10) < limitStr) {
      m.to = ''; m.body = ''; m.replyTo = '';
      update_('mails', m);
    }
  });
  return n;
}

function freeTextIds_(ev) {
  return (ev.extras || []).filter((x) => x.type === 'text' || x.type === 'textarea').map((x) => x.id);
}

function hasFreeText_(ev, r) {
  const v = parseJson_(r.extras, {});
  return freeTextIds_(ev).some((id) => v[id]);
}

function stripFreeText_(ev, values) {
  const out = Object.assign({}, values);
  freeTextIds_(ev).forEach((id) => { delete out[id]; });
  return out;
}

function enableJobs() {
  const ui = SpreadsheetApp.getUi();
  installJobs_();
  const name = backupSpreadsheet_(true);
  const sent = processMailQueue_();
  ui.alert('Zapnuto.\n\n• Záloha tabulky se dělá každou noc (jen když se něco změnilo) do složky „' + BACKUP_FOLDER_NAME +
    '“ na Disku. Ponechá se posledních ' + BACKUP_KEEP_RECENT + ' záloh a jedna za každý měsíc, starší jdou do koše.\n' +
    '• E-maily, které se kvůli dennímu limitu neodeslaly, se odešlou automaticky (kontrola každou hodinu).\n' +
    '• U akcí starších než ' + ANONYMIZE_AFTER_MONTHS + ' měsíců se mažou e-maily a poznámky přihlášených.\n\n' +
    'První záloha: ' + name + (sent ? '\nOdeslané e-maily z fronty: ' + sent : ''));
}

function backupNow() {
  const name = backupSpreadsheet_(true);
  SpreadsheetApp.getUi().alert('Záloha vytvořena: ' + name);
}

// =====================================================================
// Menu v tabulce (nastavení)
// =====================================================================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Turnaje')
    .addItem('Nastavení', 'setup')
    .addItem('Zapnout zálohy a frontu e-mailů', 'enableJobs')
    .addItem('Zálohovat teď', 'backupNow')
    .addItem('Založit klubový kalendář 2026/2027', 'createClubCalendar')
    .addItem('Založit ukázkovou akci (Chlumec 2026)', 'createSampleEvent')
    .addToUi();
}

/** Připraví listy, zapíše vlastníka jako hlavního správce a uloží nastavení. */
function setup() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  Object.keys(SHEETS).forEach(table_);
  const owner = Session.getEffectiveUser().getEmail().toLowerCase();
  if (owner && !table_('users').rows.some((u) => String(u.email).toLowerCase() === owner)) {
    insert_('users', [{ email: owner, name: '', club: '', role: 'superadmin', active: YES, createdAt: new Date().toISOString() }]);
  }
  const ask = (key, title, hint) => {
    const res = ui.prompt(title, hint + '\nAktuálně: ' + (props.getProperty(key) || '(nenastaveno)') +
      '\n(Prázdné = beze změny)', ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return false;
    const v = res.getResponseText().trim();
    if (v) props.setProperty(key, v);
    return true;
  };
  if (!ask('GOOGLE_CLIENT_ID', 'Google Client ID', 'ID klienta OAuth z Google Cloud Console (končí .apps.googleusercontent.com).')) return;
  ask('SITE_URL', 'Adresa webu', 'Např. https://UZIVATEL.github.io/Prihlasovaci_formular/');
  ui.alert(`Hotovo. Hlavní správce: ${owner}.`);
}

function createSampleEvent() {
  const user = table_('users').rows.find((u) => u.role === 'superadmin');
  if (!user) throw new Error('Nejdřív spusťte Turnaje → Nastavení.');
  ADMIN_ACTIONS.saveEvent({ event: SAMPLE_EVENT_ }, { email: String(user.email).toLowerCase(), role: 'superadmin' });
  SpreadsheetApp.getUi().alert('Ukázková akce byla založena (stav: rozpracovaná).');
}

const SAMPLE_EVENT_ = {
  name: 'Šachový festival Chlumec okr. Ústí n. L. 2026',
  slug: 'chlumec-2026',
  place: 'Chlumec',
  dateFrom: '2026-05-08',
  dateTo: '2026-05-10',
  deadline: '2026-05-02',
  status: 'koncept',
  infoUrl: 'https://www.festival.sachyusti.cz',
  intro: 'Přihlášku vyplňte do 2. 5.',
  tournaments: [
    { name: 'Open rapid – Grand Prix ČR i KP rapid ÚKŠS', short: 'Open rapid', day: 'sobota', type: 'individual' },
    { name: 'Otevřený bleskový turnaj – zároveň jako KP blesk ÚKŠS', short: 'Blesk', day: 'neděle', type: 'individual' },
    { name: 'Turnaj mladších žáků (registrovaných i neregistrovaných)', short: 'Mladší žáci', day: 'sobota', type: 'individual', minBirthYear: 2014 },
    { name: 'Turnaj neregistrovaných a hráčů do ELO 1100', short: 'Neregistrovaní', day: 'sobota', type: 'individual', maxBirthYear: 2013, warnMaxRating: 1100 },
    { name: 'Turnaj veteránů', short: 'Veteráni', day: 'pátek', type: 'individual' },
    { name: 'Velká cena 4členných juniorských družstev', short: 'Družstva', day: 'pátek', type: 'team', boards: 4, reserves: 1 },
  ],
  extras: [
    { id: 'doprava', type: 'checkboxes', label: 'Doprava z hlavního vlakového nádraží (60 Kč na den)', help: 'Nepovinné – jen pro zájemce.', options: ['sobota tam', 'sobota zpět'], modes: ['individual'] },
    { id: 'ubytovani', type: 'select', label: 'Ubytování', help: 'Nepovinné – jen pro zájemce. Bude vám odpovězeno.', options: ['1lůžkový pokoj', '2lůžkový pokoj'], modes: ['individual'] },
    { id: 'sdeleni', type: 'textarea', label: 'Další sdělení', help: 'U 2lůžkového pokoje napište jméno druhé osoby (z turnaje, nebo „nehrající“), případně „je mi jedno s kým“.' },
    { id: 'poznamka', type: 'textarea', label: 'Poznámka' },
  ],
};
