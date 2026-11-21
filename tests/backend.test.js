// Celý backend (Code.gs) nad simulovanou Google tabulkou: akce, přihlášky, administrace.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas, fakeToken } = require('./gas-mock.js');

const OWNER = 'owner@example.cz';
const ORG = 'org@klub.cz';

function setup() {
  const gas = createGas({ owner: OWNER });
  const admin = (action, body, who) => gas.post(Object.assign({ action: 'admin.' + action, idToken: fakeToken(who || OWNER) }, body));
  return { gas, admin };
}

const player = (id, surname, year, extra) => Object.assign({
  registered: true, id, surname, firstName: 'Jan', year, rn: 1500 + id, rf: 1600 + id, fide: 1000 + id,
  clubNo: 16310, club: 'ŠK Spartak Ústí nad Labem', fed: 'CZE', status: 'A',
}, extra || {});

test('celý průběh: založení akce, přihlášky, seznam, úpravy, kopie', () => {
  const { gas, admin } = setup();

  // bez přihlášení / neznámý účet
  assert.equal(gas.post({ action: 'admin.events' }).code, 'auth');
  assert.equal(admin('events', {}, 'cizi@x.cz').code, 'forbidden');

  // založení akce
  let res = admin('saveEvent', { event: {
    name: 'Krajský přebor v rapidu 2027', dateFrom: '2027-03-14', deadline: '2027-03-10', status: 'otevreno',
    tournaments: [{ name: 'Rapid open', short: 'Rapid' }, { name: 'Žáci do 12 let', short: 'Žáci', minBirthYear: 2015, capacity: 2 }],
    extras: [{ label: 'Oběd', type: 'select', options: ['ano', 'ne'] }],
  } });
  assert.equal(res.ok, true, res.error);
  const ev = res.event;
  assert.equal(ev.slug, 'krajsky-prebor-v-rapidu-2027');
  assert.equal(ev.dateFrom, '2027-03-14');
  assert.deepEqual(ev.admins, [OWNER]);
  assert.equal(ev.tournaments.length, 2);
  const [rapid, zaci] = ev.tournaments;

  // veřejný přehled a detail
  assert.equal(gas.get({ action: 'events' }).events.length, 1);
  const pub = gas.get({ action: 'event', slug: ev.slug });
  assert.equal(pub.event.name, ev.name);
  assert.equal(pub.event.admins, undefined, 'správci nejsou veřejní');

  // přihlášky
  res = gas.post({ action: 'register', slug: ev.slug, mode: 'individual', email: 'hrac@example.cz',
    player: player(1, 'Novák', 2016), tournaments: [rapid.id, zaci.id], extras: { obed: 'ano' } });
  assert.equal(res.ok, true, res.error);
  assert.equal(gas.mails.length, 1);
  assert.match(gas.mails[0].body, /Krajský přebor/);
  assert.match(gas.mails[0].body, /Oběd: ano/);
  assert.equal(gas.post({ action: 'register', slug: ev.slug, mode: 'individual', email: 'a@b.cz',
    player: player(1, 'Novák', 2016), tournaments: [rapid.id] }).error, 'Novák Jan je do turnaje „Rapid“ už přihlášen(a).');
  assert.equal(gas.post({ action: 'register', slug: ev.slug, mode: 'individual', email: 'a@b.cz',
    player: player(2, 'Starý', 2010), tournaments: [zaci.id] }).ok, false, 'věk se vynucuje');
  assert.equal(gas.post({ action: 'register', slug: ev.slug, mode: 'individual', email: 'a@b.cz',
    player: player(3, 'Malý', 2017), tournaments: [zaci.id] }).ok, true);
  assert.match(gas.post({ action: 'register', slug: ev.slug, mode: 'individual', email: 'a@b.cz',
    player: player(4, 'Další', 2017), tournaments: [zaci.id] }).error, /naplněn/, 'kapacita 2');

  // veřejný seznam
  const list = gas.get({ action: 'list', slug: ev.slug });
  assert.equal(list.tournaments[zaci.id].length, 2);
  assert.ok(!JSON.stringify(list).includes('hrac@example.cz'));

  // administrace: detail, zrušení, ruční přidání přes kapacitu
  let detail = admin('event', { id: ev.id });
  assert.equal(detail.registrations.length, 3);
  assert.equal(detail.event.tournaments[1].count, 2);
  const novakZaci = detail.registrations.find((r) => r.surname === 'Novák' && r.tournamentId === zaci.id);
  res = admin('updateRegistration', { id: novakZaci.id, changes: { status: 'zrušeno', orgNote: 'odhlásil se' } });
  assert.equal(res.registration.status, 'zrušeno');
  assert.equal(gas.get({ action: 'list', slug: ev.slug }).tournaments[zaci.id].length, 1);
  res = admin('addRegistration', { eventId: ev.id, mode: 'individual', player: player(5, 'Pozdní', 2012), tournaments: [zaci.id] });
  assert.equal(res.ok, true, 'pořadatel smí přidat i mimo věk a kapacitu');
  assert.equal(gas.mails.length, 2, 'ruční přidání neposílá e-mail');

  // úprava akce: přejmenování turnaje zachová ID, smazání turnaje s přihláškami nejde
  detail = admin('event', { id: ev.id });
  const edited = Object.assign({}, detail.event, {
    tournaments: [Object.assign({}, detail.event.tournaments[0], { name: 'Rapid open – KP' })],
  });
  assert.match(admin('saveEvent', { event: edited }).error, /nelze smazat/);
  edited.tournaments = detail.event.tournaments.map((t, i) => (i === 0 ? Object.assign({}, t, { name: 'Rapid open – KP' }) : t))
    .concat([{ name: 'Blesk', type: 'individual' }]);
  res = admin('saveEvent', { event: edited });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.event.tournaments[0].id, rapid.id);
  assert.equal(res.event.tournaments[0].name, 'Rapid open – KP');
  assert.equal(res.event.tournaments.length, 3);

  // kopie na další rok
  res = admin('copyEvent', { id: ev.id, name: 'Krajský přebor v rapidu 2028', shiftYears: 1 });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.event.status, 'koncept');
  assert.equal(res.event.dateFrom, '2028-03-14');
  assert.equal(res.event.tournaments[1].minBirthYear, 2016);
  assert.equal(res.event.slug, 'krajsky-prebor-v-rapidu-2028');
  assert.equal(gas.get({ action: 'events' }).events.length, 1, 'rozpracovaná kopie není veřejná');
  assert.equal(gas.get({ action: 'event', slug: res.event.slug }).code, 'not_found');
  assert.equal(admin('deleteEvent', { id: res.event.id }).ok, true);
  assert.match(admin('deleteEvent', { id: ev.id }).error, /archivu/);
});

test('pořadatel z jiného klubu vidí jen své akce', () => {
  const { admin } = setup();
  assert.equal(admin('saveUser', { user: { email: ORG, name: 'Pořadatel', role: 'organizer' } }).ok, true);
  assert.equal(admin('users', {}, ORG).code, 'forbidden');

  const mine = admin('saveEvent', { event: { name: 'Akce hlavního správce', dateFrom: '2027-01-01', tournaments: [{ name: 'A' }] } }).event;
  const theirs = admin('saveEvent', { event: { name: 'Klubový turnaj', dateFrom: '2027-02-01', tournaments: [{ name: 'B' }] } }, ORG).event;
  assert.deepEqual(theirs.admins, [ORG]);

  assert.deepEqual(admin('events', {}, ORG).events.map((e) => e.name), ['Klubový turnaj']);
  assert.equal(admin('events', {}).events.length, 2, 'hlavní správce vidí vše');
  assert.equal(admin('event', { id: mine.id }, ORG).code, 'forbidden');

  // přidání spolusprávce
  const upd = Object.assign({}, mine, { admins: ORG });
  assert.equal(admin('saveEvent', { event: upd }).ok, true);
  assert.equal(admin('event', { id: mine.id }, ORG).ok, true);

  // deaktivovaný účet
  admin('saveUser', { user: { email: ORG, role: 'organizer', active: 'NE' } });
  assert.equal(admin('events', {}, ORG).code, 'forbidden');
});

test('družstvo a data v tabulce', () => {
  const { gas, admin } = setup();
  const ev = admin('saveEvent', { event: {
    name: 'Družstva mládeže', dateFrom: '2027-05-01', status: 'otevreno',
    tournaments: [{ name: 'Družstva', type: 'team', boards: 2, reserves: 1 }],
  } }).event;
  const res = gas.post({ action: 'register', slug: ev.slug, mode: 'team', email: 'k@x.cz',
    team: { tournamentId: ev.tournaments[0].id, name: 'Spartak', captain: 'Trenér', players: [player(1, 'A', 2012), player(2, 'B', 2013), null] } });
  assert.equal(res.ok, true, res.error);
  const sheet = gas.sheets['Přihlášky'];
  const header = sheet.data[0];
  assert.equal(sheet.getLastRow(), 4, 'družstvo + 2 hráči');
  assert.equal(sheet.data[1][header.indexOf('team')], 'Spartak');
  assert.equal(sheet.data[1][header.indexOf('board')], 0);
  assert.equal(sheet.data[3][header.indexOf('board')], 2);
  assert.equal(gas.sheets['Akce'].data[1][gas.sheets['Akce'].data[0].indexOf('dateFrom')], '2027-05-01');
  const list = gas.get({ action: 'list', slug: ev.slug });
  assert.equal(list.teams[ev.tournaments[0].id][0].players.length, 2);
});

test('vypršelé přihlášení', () => {
  const { gas } = setup();
  const r = gas.post({ action: 'admin.events', idToken: fakeToken(OWNER, -10) });
  assert.equal(r.code, 'auth');
});

test('výprava přes API: jeden e-mail se všemi hráči', () => {
  const { gas, admin } = setup();
  const ev = admin('saveEvent', { event: {
    name: 'Open 2027', dateFrom: '2027-06-01', status: 'otevreno',
    tournaments: [{ name: 'Rapid', short: 'Rapid' }, { name: 'Blesk', short: 'Blesk' }],
  } }).event;
  const [rapid, blesk] = ev.tournaments;
  const res = gas.post({ action: 'register', slug: ev.slug, mode: 'individual', email: 'vedouci@klub.cz', players: [
    { player: player(1, 'Alfa', 2000), tournaments: [rapid.id, blesk.id] },
    { player: player(2, 'Beta', 2001), tournaments: [blesk.id] },
  ] });
  assert.equal(res.ok, true, res.error);
  assert.equal(gas.mails.length, 1, 'jeden potvrzovací e-mail pro celou výpravu');
  assert.match(gas.mails[0].body, /Přihlášení hráči \(2\)/);
  assert.match(gas.mails[0].body, /Alfa Jan[\s\S]*Rapid[\s\S]*Blesk[\s\S]*Beta Jan[\s\S]*Blesk/);
  const list = gas.get({ action: 'list', slug: ev.slug });
  assert.equal(list.tournaments[rapid.id].length, 1);
  assert.equal(list.tournaments[blesk.id].length, 2);
});

test('kopie akce podle nového data začátku', () => {
  const { admin } = setup();
  const ev = admin('saveEvent', { event: {
    name: 'Festival 2026', dateFrom: '2026-05-08', dateTo: '2026-05-10', deadline: '2026-05-02', status: 'otevreno',
    tournaments: [{ name: 'Žáci', minBirthYear: 2014 }, { name: 'Neregistrovaní', maxBirthYear: 2013 }],
  } }).event;
  let c = admin('copyEvent', { id: ev.id, name: 'Festival 2027', dateFrom: '2027-05-07' }).event;
  assert.deepEqual([c.dateFrom, c.dateTo, c.deadline], ['2027-05-07', '2027-05-09', '2027-05-01']);
  assert.deepEqual(c.tournaments.map((t) => [t.minBirthYear, t.maxBirthYear]), [[2015, null], [null, 2014]]);
  assert.equal(c.status, 'koncept');
  c = admin('copyEvent', { id: ev.id, name: 'Festival 2027 b', dateFrom: '2027-05-07', shiftBirthYears: false }).event;
  assert.equal(c.tournaments[0].minBirthYear, 2014, 'ročníky beze změny');
  c = admin('copyEvent', { id: ev.id, name: 'Podzim 2026', dateFrom: '2026-10-02' }).event;
  assert.deepEqual([c.dateTo, c.deadline, c.tournaments[0].minBirthYear], ['2026-10-04', '2026-09-26', 2014]);
});
