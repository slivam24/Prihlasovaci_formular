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

test('družstva: víc družstev v jedné přihlášce, soupiska později, úprava soupisky odkazem', () => {
  const { gas, admin, ev } = setup({
    tournaments: [{ name: 'Družstva mládeže', short: 'Družstva', type: 'team', boards: 2, reserves: 1, minBirthYear: 2008, capacity: 3 }],
    extras: [],
  });
  const t = ev.tournaments[0];
  const kid = (id, surname, year) => player(id, surname, year || 2012);
  // dvě družstva: A s plnou soupiskou, B se soupiskou později
  let res = gas.post({ action: 'register', slug: ev.slug, mode: 'team', email: 'trener@klub.cz', teams: [
    { tournamentId: t.id, name: 'Spartak A', captain: 'Trenér', players: [kid(1, 'Alfa'), kid(2, 'Beta'), kid(3, 'Gama')] },
    { tournamentId: t.id, name: 'Spartak B', captain: 'Trenér', rosterLater: true, players: [] },
  ] });
  assert.equal(res.ok, true, res.error);
  assert.match(gas.mails[0].body, /Přihlášená družstva \(2\)[\s\S]*Spartak A[\s\S]*1\. Alfa Jan[\s\S]*N\. Gama Jan[\s\S]*Spartak B[\s\S]*soupiska bude doplněna/);
  let list = gas.get({ action: 'list', slug: ev.slug });
  assert.deepEqual(list.teams[t.id].map((x) => [x.team, x.players.length]), [['Spartak A', 3], ['Spartak B', 0]]);

  // chyby při registraci
  const bad = (teams) => gas.post({ action: 'register', slug: ev.slug, mode: 'team', email: 'x@y.cz', teams }).error;
  assert.match(bad([{ tournamentId: t.id, name: 'C', captain: 'X', players: [kid(9, 'Nový')] }]), /aspoň na 2 šachovnice/);
  assert.match(bad([{ tournamentId: t.id, name: 'C', captain: 'X', players: [kid(9, 'N1'), kid(10, 'N2'), kid(11, 'N3'), kid(12, 'N4')] }]), /nejvýše 3 hráčů/);
  assert.match(bad([{ tournamentId: t.id, name: 'C', captain: 'X', rosterLater: true }, { tournamentId: t.id, name: 'c', captain: 'X', rosterLater: true }]), /už je přihlášeno/);
  assert.match(bad([{ tournamentId: t.id, name: 'C', captain: 'X', players: [kid(1, 'Alfa'), kid(10, 'N2')] }]), /už hraje za družstvo „Spartak A“/);
  assert.match(bad([{ tournamentId: t.id, name: 'C', captain: 'X', players: [kid(9, 'N1'), kid(10, 'Starý', 1990)] }]), /2008 a mladší/);
  assert.match(bad([{ tournamentId: t.id, name: 'C', captain: 'X', rosterLater: true }, { tournamentId: t.id, name: 'D', captain: 'X', rosterLater: true }]), /naplněna/);

  // stránka změn: družstva se soupiskami
  const view = gas.get({ action: 'application', token: res.editToken });
  assert.deepEqual(view.application.teams.map((g) => [g.name, g.players.map((p) => p.board)]), [['Spartak A', [1, 2, 3]], ['Spartak B', []]]);
  const [A, B] = view.application.teams;

  // doplnit soupisku B, přeřadit A (Gama na 1., Beta pryč)
  gas.mails.length = 0;
  res = gas.post({ action: 'updateApplication', token: res.editToken, changes: { rosters: [
    { key: B.key, players: [kid(4, 'Delta'), kid(5, 'Epsilon')] },
    { key: A.key, players: [A.players[2], A.players[0]] },
  ] } });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(res.saved, ['Soupiska Spartak B: 1. Delta Jan, 2. Epsilon Jan', 'Soupiska Spartak A: 1. Gama Jan, 2. Alfa Jan']);
  assert.deepEqual(res.application.teams.map((g) => g.players.map((p) => `${p.board}. ${p.surname}`)),
    [['1. Gama', '2. Alfa'], ['1. Delta', '2. Epsilon']]);
  assert.match(gas.mails[0].body, /Spartak A \(Družstva\): 1\. Gama Jan, 2\. Alfa Jan/);
  // Beta je odhlášený a může hrát za jiné družstvo
  list = gas.get({ action: 'list', slug: ev.slug });
  assert.deepEqual(list.teams[t.id].map((x) => x.players.map((p) => p.name)), [['Gama Jan', 'Alfa Jan'], ['Delta Jan', 'Epsilon Jan']]);
  // hráč z jiného družstva nejde
  const token = view.application && admin('event', { id: ev.id }).registrations[0].editToken;
  assert.match(gas.post({ action: 'updateApplication', token, changes: { rosters: [{ key: B.key, players: [kid(1, 'Alfa'), kid(4, 'Delta')] }] } }).error,
    /už hraje za družstvo „Spartak A“/);

  // odhlášení a vrácení družstva
  res = gas.post({ action: 'updateApplication', token, changes: { cancelTeams: [B.key] } });
  assert.deepEqual(res.saved, ['Odhlášeno družstvo: Spartak B – Družstva']);
  assert.equal(res.application.teams[1].cancelled, true);
  res = gas.post({ action: 'updateApplication', token, changes: { restoreTeams: [B.key] } });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(res.application.teams[1].players.map((p) => p.surname), ['Delta', 'Epsilon']);

  // pořadatel: po termínu změny přes stejnou stránku bez omezení
  const changes = admin('event', { id: ev.id }).changes.map((c) => c.action);
  assert.deepEqual(changes, ['soupiska', 'soupiska', 'odhláška družstva', 'obnovení družstva']);
  const adm = admin('application', { token });
  assert.equal(adm.admin, true);
  const ar = admin('updateApplication', { token, changes: { rosters: [{ key: B.key, players: [kid(4, 'Delta'), kid(5, 'Epsilon'), kid(6, 'Starší', 1990)] }] } });
  assert.equal(ar.ok, true, ar.error);
  assert.equal(admin('event', { id: ev.id }).changes.at(-1).by, OWNER);
});
