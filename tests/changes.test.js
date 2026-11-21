// Změna přihlášky přes odkaz z e-mailu, záznam změn a úpravy pořadatelem.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas, fakeToken } = require('./gas-mock.js');

const OWNER = 'owner@example.cz';

function setup(eventOverrides) {
  const gas = createGas({ owner: OWNER, props: { SITE_URL: 'https://web.example/app/' } });
  const admin = (action, body) => gas.post(Object.assign({ action: 'admin.' + action, idToken: fakeToken(OWNER) }, body));
  const ev = admin('saveEvent', { event: Object.assign({
    name: 'Festival 2099', dateFrom: '2099-05-08', status: 'otevreno', contactEmail: 'poradatel@klub.cz',
    tournaments: [{ name: 'Rapid', short: 'Rapid', capacity: 2 }, { name: 'Blesk', short: 'Blesk' }],
    extras: [
      { label: 'Ubytování', type: 'select', options: ['1lůžkový', '2lůžkový'] },
      { label: 'Oběd', type: 'checkboxes', options: ['sobota', 'neděle'] },
    ],
  }, eventOverrides || {}) }).event;
  return { gas, admin, ev };
}

const player = (id, surname, year) => ({
  registered: true, id, surname, firstName: 'Jan', year: year || 1990, rn: 1500, rf: 1600, fide: 0,
  clubNo: 1, club: 'ŠK Test', fed: 'CZE', status: 'A',
});

function registerGroup(gas, ev) {
  const [rapid, blesk] = ev.tournaments;
  return gas.post({
    action: 'register', slug: ev.slug, mode: 'individual', email: 'vedouci@klub.cz',
    players: [
      { player: player(1, 'Alfa'), tournaments: [rapid.id, blesk.id] },
      { player: player(2, 'Beta'), tournaments: [rapid.id] },
    ],
    extras: { ubytovani: '1lůžkový', obed: ['sobota'] },
  });
}

test('potvrzovací e-mail obsahuje odkaz pro změny', () => {
  const { gas, ev } = setup();
  const res = registerGroup(gas, ev);
  assert.equal(res.ok, true, res.error);
  assert.equal(res.editToken.length, 40);
  assert.ok(gas.mails[0].body.includes(`https://web.example/app/zmena.html?t=${res.editToken}`));
});

test('stránka změn: načtení přihlášky přes odkaz', () => {
  const { gas, ev } = setup();
  const { editToken } = registerGroup(gas, ev);
  const view = gas.get({ action: 'application', token: editToken });
  assert.equal(view.ok, true, view.error);
  assert.equal(view.application.email, 'vedouci@klub.cz');
  assert.equal(view.application.entries.length, 3);
  assert.deepEqual(view.application.extras, { ubytovani: '1lůžkový', obed: ['sobota'] });
  assert.equal(view.canEdit, true);
  assert.equal(view.event.contactEmail, 'poradatel@klub.cz');
  assert.ok(!JSON.stringify(view).includes('orgNote'));
  assert.equal(gas.get({ action: 'application', token: 'x'.repeat(40) }).code, 'not_found');
  assert.equal(gas.get({ action: 'application', token: 'kratky' }).code, 'not_found');
});

test('odhláška, změna doplňků, e-maily a záznam změn', () => {
  const { gas, admin, ev } = setup();
  const { editToken } = registerGroup(gas, ev);
  const view = gas.get({ action: 'application', token: editToken });
  const betaRapid = view.application.entries.find((e) => e.name === 'Beta Jan');
  gas.mails.length = 0;

  const res = gas.post({ action: 'updateApplication', token: editToken, changes: {
    cancel: [betaRapid.id], extras: { ubytovani: '2lůžkový', obed: ['sobota', 'neděle'] },
  } });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(res.saved, ['Odhlášeno: Beta Jan – Rapid', 'Ubytování: 1lůžkový → 2lůžkový', 'Oběd: sobota → sobota, neděle']);
  assert.equal(res.application.entries.find((e) => e.id === betaRapid.id).cancelled, true);

  // e-mail přihlášenému i pořadateli
  assert.deepEqual(gas.mails.map((m) => m.to), ['vedouci@klub.cz', 'poradatel@klub.cz']);
  assert.match(gas.mails[0].body, /Odhlášeno: Beta Jan – Rapid[\s\S]*Aktuálně přihlášení:[\s\S]*Alfa Jan – Rapid/);
  assert.match(gas.mails[1].subject, /Změna přihlášky č\./);

  // veřejný seznam bez odhlášeného
  const list = gas.get({ action: 'list', slug: ev.slug });
  assert.equal(list.tournaments[ev.tournaments[0].id].length, 1);

  // pořadatel vidí změny
  const detail = admin('event', { id: ev.id });
  assert.deepEqual(detail.changes.map((c) => c.action), ['odhláška', 'změna údajů']);
  assert.ok(detail.changes.every((c) => c.by === 'přihlášený (odkaz z e-mailu)'));
  const row = detail.registrations.find((r) => r.id === betaRapid.id);
  assert.equal(row.status, 'zrušeno');
  assert.equal(row.updatedBy, 'přihlášený (odkaz z e-mailu)');
  assert.ok(detail.registrations.every((r) => JSON.parse(r.extras).ubytovani === '2lůžkový'));

  // nic se nezměnilo
  assert.match(gas.post({ action: 'updateApplication', token: editToken, changes: { extras: { ubytovani: '2lůžkový', obed: ['sobota', 'neděle'] } } }).error, /žádná změna/);
  // cizí položka
  assert.match(gas.post({ action: 'updateApplication', token: editToken, changes: { cancel: ['CIZI'] } }).error, /Neplatná položka/);
});

test('vrácení odhlášky hlídá kapacitu a uzavření', () => {
  const { gas, admin, ev } = setup();
  const { editToken } = registerGroup(gas, ev);
  const entries = gas.get({ action: 'application', token: editToken }).application.entries;
  const betaRapid = entries.find((e) => e.name === 'Beta Jan');
  gas.post({ action: 'updateApplication', token: editToken, changes: { cancel: [betaRapid.id] } });

  // mezitím se přihlásil někdo jiný – Rapid má kapacitu 2
  assert.equal(gas.post({ action: 'register', slug: ev.slug, mode: 'individual', email: 'x@y.cz',
    player: player(3, 'Gama'), tournaments: [ev.tournaments[0].id] }).ok, true);
  assert.match(gas.post({ action: 'updateApplication', token: editToken, changes: { restore: [betaRapid.id] } }).error, /naplněný/);

  // uvolní se místo → vrácení projde
  const gamaToken = admin('event', { id: ev.id }).registrations.find((r) => r.surname === 'Gama').editToken;
  const gama = gas.get({ action: 'application', token: gamaToken }).application.entries[0];
  gas.post({ action: 'updateApplication', token: gamaToken, changes: { cancel: [gama.id] } });
  const back = gas.post({ action: 'updateApplication', token: editToken, changes: { restore: [betaRapid.id] } });
  assert.equal(back.ok, true, back.error);
  assert.deepEqual(back.saved, ['Znovu přihlášeno: Beta Jan – Rapid']);

  // po uzavření přihlašování: odhlásit jde, vrátit ne
  const full = admin('event', { id: ev.id }).event;
  admin('saveEvent', { event: Object.assign({}, full, { status: 'uzavreno' }) });
  assert.equal(gas.post({ action: 'updateApplication', token: editToken, changes: { cancel: [betaRapid.id] } }).ok, true);
  assert.match(gas.post({ action: 'updateApplication', token: editToken, changes: { restore: [betaRapid.id] } }).error, /uzavřené/);
});

test('změny online končí dnem před začátkem akce', () => {
  const { gas, ev } = setup({ dateFrom: '2020-01-01', deadline: '' });
  // akce v minulosti: přihlásit nejde (začala), přihláška vznikne jen přes pořadatele
  assert.equal(registerGroup(gas, ev).ok, true, 'uzávěrka není, status otevřeno');
  const token = gas.sheets['Přihlášky'].data[1][gas.sheets['Přihlášky'].data[0].indexOf('editToken')];
  const view = gas.get({ action: 'application', token });
  assert.equal(view.canEdit, false);
  assert.match(gas.post({ action: 'updateApplication', token, changes: { cancel: [view.application.entries[0].id] } }).error,
    /nejde provést online.*poradatel@klub\.cz/);
});

test('úpravy pořadatelem se zaznamenají', () => {
  const { gas, admin, ev } = setup();
  registerGroup(gas, ev);
  const reg = admin('event', { id: ev.id }).registrations.find((r) => r.surname === 'Alfa');
  let res = admin('updateRegistration', { id: reg.id, changes: { year: 1991, orgNote: 'platí na místě' } });
  assert.equal(res.ok, true, res.error);
  res = admin('updateRegistration', { id: reg.id, changes: { status: 'zrušeno' } });
  res = admin('updateRegistration', { id: reg.id, changes: { status: '' } });
  const changes = admin('event', { id: ev.id }).changes;
  assert.deepEqual(changes.map((c) => c.action), ['úprava', 'odhláška', 'obnovení']);
  assert.match(changes[0].detail, /Ročník: 1990 → 1991; Poznámka pořadatele: — → platí na místě/);
  assert.ok(changes.every((c) => c.by === OWNER));
  // beze změny se nic nezapíše
  admin('updateRegistration', { id: reg.id, changes: { year: 1991 } });
  assert.equal(admin('event', { id: ev.id }).changes.length, 3);
  // ručně přidaný hráč
  admin('addRegistration', { eventId: ev.id, mode: 'individual', player: player(9, 'Ručně'), tournaments: [ev.tournaments[1].id] });
  assert.equal(admin('event', { id: ev.id }).changes.at(-1).action, 'přidáno pořadatelem');
});

test('obědy a ubytování: počty kusů s cenou', () => {
  const { gas, admin, ev } = setup({
    extras: [
      { label: 'Obědy', type: 'quantity', unit: 'porce', options: ['sobota', 'neděle'], prices: [130, '120,50'] },
      { label: 'Doprava', type: 'checkboxes', options: ['tam', 'zpět'], prices: [60, null] },
      { label: 'Poznámka', type: 'textarea' },
    ],
  });
  assert.deepEqual(ev.extras[0].prices, [130, 120.5]);
  assert.deepEqual(ev.extras[1].prices, [60, null]);
  assert.equal(ev.extras[0].unit, 'porce');
  const res = gas.post({ action: 'register', slug: ev.slug, mode: 'individual', email: 'a@b.cz',
    players: [{ player: player(1, 'Alfa'), tournaments: [ev.tournaments[0].id] }],
    extras: { obedy: { sobota: 3, 'neděle': '2', podvrh: 5 }, doprava: ['tam'] } });
  assert.equal(res.ok, true, res.error);
  const row = admin('event', { id: ev.id }).registrations[0];
  assert.deepEqual(JSON.parse(row.extras).obedy, { sobota: 3, 'neděle': 2 });
  assert.match(gas.mails[0].body, /Obědy: sobota × 3, neděle × 2 \(631 Kč\)/);
  assert.match(gas.mails[0].body, /Doprava: tam \(60 Kč\)/);
  assert.match(gas.mails[0].body, /Celkem za doplňky: 691 Kč/);
  // změna přes odkaz
  const upd = gas.post({ action: 'updateApplication', token: res.editToken, changes: { extras: { obedy: { sobota: 1 }, doprava: ['tam'] } } });
  assert.equal(upd.ok, true, upd.error);
  assert.deepEqual(upd.saved, ['Obědy: sobota × 3, neděle × 2 → sobota × 1']);
  // bez možností nejde
  assert.match(admin('saveEvent', { event: { name: 'X', dateFrom: '2099-01-01', tournaments: [{ name: 'A' }],
    extras: [{ label: 'Obědy', type: 'quantity', options: [] }] } }).error, /zadejte možnosti/);
});
