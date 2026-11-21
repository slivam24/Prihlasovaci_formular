const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas, fakeToken } = require('./gas-mock.js');

const OWNER = 'owner@example.cz';
const player = (id, surname, year) => ({
  registered: true, id, surname, firstName: 'Jan', year, rn: 1500 + id, rf: 1600 + id, fide: 1000 + id,
  clubNo: 16310, club: 'ŠK Spartak', fed: 'CZE', status: 'A',
});

function setup(opts) {
  const gas = createGas(Object.assign({ owner: OWNER }, opts || {}));
  const admin = (action, body) => gas.post(Object.assign({ action: 'admin.' + action, idToken: fakeToken(OWNER) }, body));
  const ev = admin('saveEvent', { event: {
    name: 'Turnaj', slug: 'turnaj', dateFrom: '2099-05-01', dateTo: '2099-05-02', status: 'otevreno', contactEmail: 'org@klub.cz',
    tournaments: [{ name: 'Rapid', type: 'individual' }],
    extras: [{ id: 'pozn', type: 'textarea', label: 'Poznámka' }, { id: 'obed', type: 'select', label: 'Oběd', options: ['ano'] }],
  } }).event;
  const reg = (id, email) => gas.post({ action: 'register', slug: ev.slug, mode: 'individual', email: email || `h${id}@x.cz`,
    player: player(id, 'Hráč' + id, 2000), tournaments: [ev.tournaments[0].id], extras: { pozn: 'pokoj s Petrem', obed: 'ano' } });
  return { gas, admin, ev, reg };
}

test('e-maily nad denní limit čekají ve frontě a odešlou se později', () => {
  const { gas, admin, reg } = setup({ mailQuota: 2 });
  assert.equal(reg(1).mailDelayed, false);
  assert.equal(reg(2).mailDelayed, false);
  const r3 = reg(3);
  assert.equal(r3.ok, true, 'přihláška se uloží i bez e-mailu');
  assert.equal(r3.mailDelayed, true);
  assert.equal(reg(4).mailDelayed, true);
  assert.equal(gas.mails.length, 2);
  const queue = gas.sheets['E-maily'];
  assert.equal(queue.getLastRow(), 3, 'dva e-maily ve frontě');
  const st = admin('events', {}).system;
  assert.deepEqual([st.mail.provider, st.mail.queued, st.mail.remaining], ['gmail', 2, 0]);

  // limit se obnoví → spouštěč odešle frontu v pořadí, v jakém vznikla
  gas.mailQuota.left = 1;
  assert.equal(gas.run('processMailQueue_()'), 1);
  assert.equal(gas.mails[2].to, 'h3@x.cz');
  gas.mailQuota.left = 100;
  assert.equal(gas.run('processMailQueue_()'), 1);
  assert.equal(gas.mails[3].to, 'h4@x.cz');
  assert.equal(admin('events', {}).system.mail.queued, 0);
  assert.equal(gas.run('processMailQueue_()'), 0);
});

test('dokud fronta není prázdná, nový e-mail se zařadí za ni', () => {
  const { gas, reg } = setup({ mailQuota: 0 });
  assert.equal(reg(1).mailDelayed, true);
  gas.mailQuota.left = 100;
  assert.equal(reg(2).mailDelayed, true, 'nepředbíhá starší e-mail');
  gas.run('processMailQueue_()');
  assert.deepEqual(gas.mails.map((m) => m.to), ['h1@x.cz', 'h2@x.cz']);
});

test('Brevo místo Gmailu, když je nastavený klíč', () => {
  const { gas, reg } = setup({ props: { BREVO_API_KEY: 'k', BREVO_SENDER: 'prihlasky@klub.cz' } });
  const sent = [];
  gas.ctx.UrlFetchApp.fetch = (url, o) => { sent.push({ url, o }); return { getResponseCode: () => 201, getContentText: () => '{}' }; };
  assert.equal(reg(1).mailDelayed, false);
  assert.equal(gas.mails.length, 0, 'Gmail se nepoužil');
  assert.equal(sent[0].url, 'https://api.brevo.com/v3/smtp/email');
  const body = JSON.parse(sent[0].o.payload);
  assert.deepEqual(body.to, [{ email: 'h1@x.cz' }]);
  assert.equal(body.sender.email, 'prihlasky@klub.cz');
  assert.equal(body.replyTo.email, 'org@klub.cz');
  assert.equal(sent[0].o.headers['api-key'], 'k');
});

test('rotace záloh: posledních 14 a jedna za měsíc', () => {
  const { gas } = setup();
  const names = [];
  for (let d = new Date(2026, 0, 1); d <= new Date(2026, 10, 21); d.setDate(d.getDate() + 1)) {
    names.push(`Přihlášky – záloha ${d.toISOString().slice(0, 10)} 03-00`);
  }
  names.push('jiný soubor');
  const del = gas.run(`backupsToDelete_(${JSON.stringify(names)}, new Date(2026, 10, 21), 14, 12)`);
  const kept = names.filter((n) => !del.includes(n));
  assert.ok(kept.includes('jiný soubor'), 'cizí soubory nemaže');
  const backups = kept.filter((n) => n.includes('záloha'));
  assert.equal(backups.length, 14 + 11, '14 posledních + první záloha z každého měsíce leden–listopad');
  assert.ok(kept.includes('Přihlášky – záloha 2026-01-01 03-00'));
  assert.ok(!kept.includes('Přihlášky – záloha 2026-01-02 03-00'));
});

test('anonymizace po 12 měsících: e-maily a poznámky pryč, jména zůstanou', () => {
  const { gas, admin, ev, reg } = setup();
  reg(1);
  admin('saveEvent', { event: Object.assign({}, ev, { dateFrom: '2025-05-01', dateTo: '2025-05-02' }) });
  assert.equal(gas.run("anonymizeOldApplications_(new Date('2026-04-20'))"), 0, 'ještě ne');
  assert.equal(gas.run("anonymizeOldApplications_(new Date('2026-06-10'))"), 1);
  const r = admin('event', { id: ev.id }).registrations[0];
  assert.equal(r.email, '');
  assert.equal(r.editToken, '');
  assert.equal(r.surname, 'Hráč1');
  assert.deepEqual(JSON.parse(r.extras), { obed: 'ano' }, 'volný text smazán, objednávka zůstává');
  assert.equal(gas.run("anonymizeOldApplications_(new Date('2026-06-11'))"), 0, 'podruhé už nic');
});
