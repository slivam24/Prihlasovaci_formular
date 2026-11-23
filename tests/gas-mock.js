/* Simulace služeb Google Apps Script, ve které běží apps-script/Code.gs lokálně
 * (testy a vývojový server). Tabulka je v paměti, e-maily se jen zaznamenají.
 * Přihlášení: token ve tvaru "fake.<base64url JSON>.sig" s {email, exp, aud}. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const CLIENT_ID = 'dev-client-id';

class FakeRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.data[this.r - 1 + i] || [];
      const vals = [];
      for (let j = 0; j < this.nc; j++) {
        const v = row[this.c - 1 + j];
        vals.push(v == null ? '' : v);
      }
      out.push(vals);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.nr || values.some((v) => v.length !== this.nc)) throw new Error('Rozměry rozsahu nesedí.');
    if (this.r - 1 + this.nr > this.sheet.getMaxRows()) {
      throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    }
    values.forEach((row, i) => {
      const target = this.sheet.data[this.r - 1 + i] || (this.sheet.data[this.r - 1 + i] = []);
      row.forEach((v, j) => {
        // Sheets: úvodní apostrof vynutí text a neukládá se
        target[this.c - 1 + j] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v;
      });
    });
    for (let i = 0; i < this.sheet.data.length; i++) if (!this.sheet.data[i]) this.sheet.data[i] = [];
    return this;
  }
  setFontWeight() { return this; }
  setNumberFormat() { return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.data = []; this.maxRows = 1000; }
  getName() { return this.name; }
  getLastRow() {
    let n = this.data.length;
    while (n > 0 && this.data[n - 1].every((v) => v === '' || v == null)) n--;
    return n;
  }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return Math.max(this.maxRows, this.data.length); }
  insertRowsAfter(after, n) { this.maxRows += n; }
  getRange(r, c, nr, nc) { return new FakeRange(this, r, c, nr || 1, nc || 1); }
  setFrozenRows() {}
  deleteRow(r) { this.data.splice(r - 1, 1); }
}

function createGas(opts) {
  opts = opts || {};
  const sheets = {};
  // jednorázové založení klubového kalendáře v testech vypnuté (opts.seed = true ho zapne)
  const props = Object.assign({ GOOGLE_CLIENT_ID: CLIENT_ID, SITE_URL: 'http://localhost/' },
    opts.seed ? {} : { SEED_KALENDAR_2026: 'test' }, opts.props || {});
  const cache = {};
  const mails = [];
  const mailQuota = { left: opts.mailQuota == null ? 100 : opts.mailQuota };
  const owner = opts.owner || 'owner@example.cz';

  const spreadsheet = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = new FakeSheet(n)),
  };

  const globals = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, getActive: () => spreadsheet, flush() {} },
    Session: {
      getScriptTimeZone: () => 'Europe/Prague',
      getEffectiveUser: () => ({ getEmail: () => owner }),
    },
    Utilities: {
      formatDate: (d) => d.toISOString().slice(0, 10),
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s)).digest()),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes.map((b) => b & 255)).toString('base64url'),
      DigestAlgorithm: { SHA_256: 'sha256' },
      getUuid: () => crypto.randomUUID(),
    },
    CacheService: {
      getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } }),
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    UrlFetchApp: {
      fetch(url) {
        const m = String(url).match(/tokeninfo\?id_token=(.+)$/);
        if (!m) throw new Error('UrlFetchApp: neočekávaná adresa ' + url);
        let info = null;
        try {
          info = JSON.parse(Buffer.from(decodeURIComponent(m[1]).split('.')[1], 'base64url').toString());
        } catch (e) { /* neplatný token */ }
        const ok = info && info.exp * 1000 > Date.now();
        const body = ok ? { aud: info.aud || CLIENT_ID, email: info.email, email_verified: 'true', exp: String(info.exp) } : { error: 'invalid_token' };
        return { getResponseCode: () => (ok ? 200 : 400), getContentText: () => JSON.stringify(body) };
      },
    },
    ContentService: {
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }),
      MimeType: { JSON: 'json' },
    },
    MailApp: {
      sendEmail: (o) => { if (mailQuota.left <= 0) throw new Error('Service invoked too many times for one day: email.'); mailQuota.left--; mails.push(o); },
      getRemainingDailyQuota: () => mailQuota.left,
    },
  };

  const ctx = vm.createContext(globals);
  // všechny soubory projektu Apps Script (sdílí jeden globální prostor)
  const dir = path.join(__dirname, '../apps-script');
  fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort((a, b) => (a === 'Code.gs' ? -1 : b === 'Code.gs' ? 1 : a.localeCompare(b)))
    .forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
  const reset = () => vm.runInContext('Object.keys(DB_CACHE_).forEach((k) => delete DB_CACHE_[k])', ctx);

  // hlavní správce jako po spuštění menu Nastavení
  reset();
  vm.runInContext(`Object.keys(SHEETS).forEach(table_);
    insert_('users', [{ email: ${JSON.stringify(owner)}, role: 'superadmin', active: 'ANO', createdAt: new Date().toISOString() }]);`, ctx);

  return {
    sheets, mails, mailQuota, props, ctx,
    get(params) {
      reset();
      return JSON.parse(ctx.doGet({ parameter: params || {} }).content);
    },
    post(body) {
      reset();
      return JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).content);
    },
    run(code) {
      reset();
      return vm.runInContext(code, ctx);
    },
  };
}

function fakeToken(email, ttlSec) {
  const payload = { email, aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + (ttlSec || 3600) };
  return 'fake.' + Buffer.from(JSON.stringify(payload)).toString('base64url') + '.sig';
}

module.exports = { createGas, fakeToken, CLIENT_ID };
