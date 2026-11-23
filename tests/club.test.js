const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas, fakeToken } = require('./gas-mock.js');
const R = require('../docs/js/rules.js');
const { parseImport } = require('../docs/js/import.js');

const OWNER = 'owner@example.cz';
const CLUBADMIN = 'trener@klub.cz';
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const player = (id, surname) => ({ registered: true, id, surname, firstName: 'Jan', year: 2012, rn: 1500, rf: 0, club: 'ŠK Klub', clubNo: 1, fed: 'CZE', status: 'C' });

function setup() {
  const gas = createGas({ owner: OWNER });
  const admin = (action, body, who) => gas.post(Object.assign({ action: 'admin.' + action, idToken: fakeToken(who || OWNER) }, body));
  admin('saveUser', { user: { email: CLUBADMIN, role: 'organizer', active: 'ANO' } });
  const ev = admin('saveEvent', { event: {
    name: 'Klub – turnaje 2026/2027', slug: 'klub', kind: 'club', status: 'otevreno', dateFrom: day(-30), dateTo: day(200),
    admins: CLUBADMIN, contactEmail: 'klub@klub.cz',
    tournaments: [
      { name: 'Vánoční rapid', type: 'individual', dateFrom: day(20), place: 'Štětí', deadline: day(10), infoUrl: 'https://example.cz/p' },
      { name: 'Uzavřený turnaj', type: 'individual', dateFrom: day(5), deadline: day(-1) },
      { name: 'Bez uzávěrky dnes', type: 'individual', dateFrom: day(0) },
      { name: 'Družstva mládeže', type: 'team', boards: 1, reserves: 0, dateFrom: day(40), dateTo: day(41) },
    ],
  } });
  return { gas, admin, ev: ev.event };
}

test('klubová sekce: uložení, není v přehledu akcí, dostupná přes odkaz', () => {
  const { gas, ev } = setup();
  assert.equal(ev.kind, 'club');
  const t = ev.tournaments[0];
  assert.deepEqual([t.place, t.deadline, t.infoUrl], ['Štětí', day(10), 'https://example.cz/p']);
  assert.equal(ev.tournaments[3].dateTo, day(41));
  assert.equal(gas.get({ action: 'events' }).events.length, 0, 'není v přehledu');
  assert.equal(gas.get({ action: 'event', slug: 'klub' }).event.kind, 'club', 'přes odkaz ano');
});

test('klubová sekce: uzávěrka jednotlivých turnajů', () => {
  const { gas, admin, ev } = setup();
  const [open, closed, today] = ev.tournaments;
  const reg = (tid) => gas.post({ action: 'register', slug: 'klub', mode: 'individual', email: 'a@b.cz', player: player(1, 'Novák'), tournaments: [tid] });
  assert.equal(reg(open.id).ok, true);
  assert.match(reg(closed.id).error, /Uzavřený turnaj.*uzavřené/);
  assert.match(reg(today.id).error, /uzavřené/, 'bez uzávěrky se zavírá dnem začátku');
  assert.match(gas.mails[0].body, /\d+\. \d+\. \d{4} – Vánoční rapid \(Štětí\)/, 'v e-mailu datum a místo');
  // pořadatel (správce klubové sekce) přihlásí i po uzávěrce
  const res = admin('addRegistration', { eventId: ev.id, mode: 'individual', email: 'a@b.cz', player: player(2, 'Pozdní'), tournaments: [closed.id] }, CLUBADMIN);
  assert.equal(res.ok, true, res.error);
});

test('klubová sekce: správce s plným přístupem, ostatní pořadatelé ne', () => {
  const { admin, ev } = setup();
  assert.equal(admin('event', { id: ev.id }, CLUBADMIN).ok, true);
  admin('saveUser', { user: { email: 'cizi@klub.cz', role: 'organizer', active: 'ANO' } });
  assert.equal(admin('event', { id: ev.id }, 'cizi@klub.cz').ok, false);
  assert.equal(admin('events', {}, CLUBADMIN).events.length, 1);
});

test('kopie klubové sekce posune i data turnajů', () => {
  const { admin, ev } = setup();
  const newFrom = (() => { const d = new Date(ev.dateFrom); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); })();
  const copy = admin('copyEvent', { id: ev.id, dateFrom: newFrom }).event;
  assert.equal(copy.kind, 'club');
  const shift = (d) => { const x = new Date(d); x.setDate(x.getDate() + Math.round((new Date(newFrom) - new Date(ev.dateFrom)) / 864e5)); return x.toISOString().slice(0, 10); };
  assert.equal(copy.tournaments[0].dateFrom, shift(ev.tournaments[0].dateFrom));
  assert.equal(copy.tournaments[0].deadline, shift(ev.tournaments[0].deadline));
});

test('pravidla: popisek, uzávěrka a řazení turnajů s datem', () => {
  const t = { name: 'GP', dateFrom: '2027-05-08', dateTo: '2027-05-09' };
  assert.equal(R.tournamentLabel(t), '8.–9. 5. 2027 – GP');
  assert.equal(R.tournamentLabel({ name: 'Rapid', day: 'sobota' }), 'sobota – Rapid');
  const now = new Date('2027-05-01T12:00:00');
  assert.equal(R.tournamentClosed({ dateFrom: '2027-05-08', deadline: '2027-05-01' }, now), false, 'do konce dne uzávěrky');
  assert.equal(R.tournamentClosed({ dateFrom: '2027-05-08', deadline: '2027-04-30' }, now), true);
  assert.equal(R.tournamentClosed({ dateFrom: '2027-05-01' }, now), true);
  assert.equal(R.tournamentPast({ dateFrom: '2027-04-30' }, now), true);
  assert.deepEqual(R.byDate([{ name: 'b', dateFrom: '2027-05-08' }, { name: 'x' }, { name: 'a', dateFrom: '2027-01-01' }]).map((x) => x.name), ['a', 'b', 'x']);
});

test('import: klubová sekce s turnaji z kalendáře', () => {
  const { event, warnings } = parseImport(JSON.stringify({ name: 'Klub 2026/27', kind: 'club', dateFrom: '2026-09-01', dateTo: '2027-06-30',
    tournaments: [{ name: 'Srbický rapid', dateFrom: '19. 9. 2026', place: 'Srbice', deadline: '2026-09-12', rating: 'rapid' }] }));
  assert.equal(event.kind, 'club');
  assert.deepEqual([event.tournaments[0].dateFrom, event.tournaments[0].place, event.tournaments[0].deadline], ['2026-09-19', 'Srbice', '2026-09-12']);
  assert.deepEqual(warnings, []);
});

test('klubový kalendář 2026/2027 (podklady) projde importem a uložením', () => {
  const fs = require('fs');
  const path = require('path');
  const text = fs.readFileSync(path.join(__dirname, '../podklady/klubovy_kalendar_2026_2027.json'), 'utf8');
  const { event, warnings } = parseImport(text);
  assert.deepEqual(warnings, []);
  assert.equal(event.kind, 'club');
  const gas = createGas({ owner: OWNER });
  const res = gas.post({ action: 'admin.saveEvent', idToken: fakeToken(OWNER), event: Object.assign(event, { status: 'otevreno' }) });
  assert.equal(res.ok, true, res.error);
  const tours = res.event.tournaments;
  assert.equal(tours.length, 121);
  const count = (k) => tours.filter((t) => t.signup === k).length;
  assert.deepEqual([count('open'), count('none'), count('league')], [7, 57, 57]);
  const gp = tours.find((t) => t.name === '3. turnaj GP Ústeckého kraje');
  assert.deepEqual([gp.rating, gp.minBirthYear, gp.place, gp.signup], ['rapid', 2008, 'Štětí', 'open']);
  // přihláška na turnaj bez výpravy neprojde, na otevřený ano
  const p = { registered: true, id: 1, surname: 'Malý', firstName: 'Jan', year: 2014, rn: 1200, rf: 0, club: 'K', fed: 'CZE' };
  const none = tours.find((t) => t.signup === 'none' && t.dateFrom > '2027-01-01');
  assert.match(gas.post({ action: 'register', slug: res.event.slug, mode: 'individual', email: 'a@b.cz', player: p, tournaments: [none.id] }).error, /nepřihlašuje/);
  assert.equal(gas.post({ action: 'register', slug: res.event.slug, mode: 'individual', email: 'a@b.cz', player: p, tournaments: [gp.id] }).ok, true);
  // správce otevře přihlašování
  const opened = gas.post({ action: 'admin.setTournamentSignup', idToken: fakeToken(OWNER), eventId: res.event.id, tournamentId: none.id, signup: 'open', deadline: none.dateFrom });
  assert.equal(opened.ok, true, opened.error);
  assert.equal(opened.event.tournaments.find((t) => t.id === none.id).signup, 'open');
  assert.equal(gas.post({ action: 'register', slug: res.event.slug, mode: 'individual', email: 'a@b.cz', player: Object.assign({}, p, { id: 2, surname: 'Velký' }), tournaments: [none.id] }).ok, true);
  assert.match(gas.post({ action: 'admin.setTournamentSignup', idToken: fakeToken(OWNER), eventId: res.event.id, tournamentId: none.id, signup: 'open', deadline: '2099-01-01' }).error, /po začátku/);
});

test('jednorázové založení klubového kalendáře při prvním požadavku', () => {
  const gas = createGas({ owner: OWNER, seed: true });
  assert.equal(gas.get({ action: 'events' }).ok, true);
  const ev = gas.get({ action: 'event', slug: 'kalendar-2026-2027' }).event;
  assert.equal(ev.kind, 'club');
  assert.equal(ev.status, 'otevreno');
  assert.equal(ev.tournaments.length, 121);
  assert.ok(gas.props.SEED_KALENDAR_2026, 'poznamenáno');
  // podruhé už nic nezakládá
  gas.props.SEED_KALENDAR_2026 = '';
  gas.get({ action: 'events' });
  const list = gas.post({ action: 'admin.events', idToken: fakeToken(OWNER) }).events;
  assert.equal(list.filter((e) => e.slug.startsWith('kalendar-2026-2027')).length, 1);
});
