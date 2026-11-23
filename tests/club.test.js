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

test('nová instalace: klubový kalendář jako samostatné akce', () => {
  const gas = createGas({ owner: OWNER, seed: true });
  assert.equal(gas.get({ action: 'events' }).events.length, 0, 'v hlavním přehledu nejsou');
  const club = gas.get({ action: 'events', kind: 'club' }).events;
  assert.equal(club.length, 121);
  assert.ok(club.every((e) => e.kind === 'club' && e.tournaments.length === 1 && e.status === 'otevreno'));
  assert.equal(club.filter((e) => e.tournaments[0].signup === 'open').length, 7);
  const gp = club.find((e) => e.name === '3. turnaj GP Ústeckého kraje');
  assert.deepEqual([gp.slug, gp.group, gp.dateFrom, gp.tournaments[0].categories], ['2027-01-16-3-turnaj-gp-usteckeho-kraje', 'mladez', '2027-01-16', [2016, 2012, 2008]]);
  assert.ok(gas.props.SEED_KALENDAR_2026);
  gas.props.SEED_KALENDAR_2026 = '';
  assert.equal(gas.get({ action: 'events', kind: 'club' }).events.length, 121, 'podruhé nic nepřidá');
});

test('věkové kategorie GP: do mladší ne, do starší ano, výchozí podle ročníku', () => {
  const gas = createGas({ owner: OWNER });
  const admin = (action, body) => gas.post(Object.assign({ action: 'admin.' + action, idToken: fakeToken(OWNER) }, body));
  const ev = admin('saveEvent', { event: { name: 'Klub', slug: 'klub', kind: 'club', status: 'otevreno', dateFrom: day(-10), dateTo: day(100),
    tournaments: [{ name: 'GP', type: 'individual', dateFrom: day(30), deadline: day(28), categories: '2008, 2016,2012' }] } }).event;
  const gp = ev.tournaments[0];
  assert.deepEqual(gp.categories, [2016, 2012, 2008]);
  const reg = (id, year, cat) => gas.post({ action: 'register', slug: 'klub', mode: 'individual', email: 'a@b.cz',
    player: Object.assign(player(id, 'H' + id), { year }), tournaments: [gp.id], categories: cat ? { [gp.id]: cat } : undefined });
  const withCat = (id, year, cat) => gas.post({ action: 'register', slug: 'klub', mode: 'individual', email: 'a@b.cz',
    players: [{ player: Object.assign(player(id, 'H' + id), { year }), tournaments: [gp.id], categories: cat ? { [gp.id]: cat } : {} }] });
  assert.match(withCat(1, 2013, 2016).error, /ročník 2013\) nemůže hrát v kategorii ročník 2016/);
  assert.equal(withCat(2, 2013, 2008).ok, true, 'starší kategorie povolena');
  assert.equal(reg(3, 2014).ok, true, 'bez volby = podle ročníku');
  assert.match(withCat(4, 2005, 2008).error, /jen pro ročník 2008 a mladší|nemůže hrát/);
  const regs = admin('event', { id: ev.id }).registrations;
  assert.deepEqual(regs.map((r) => [r.surname, r.category]).sort(), [['H2', 2008], ['H3', 2012]]);
  assert.match(gas.mails[0].body, /kategorie ročník 2008 a mladší/);
  const list = gas.get({ action: 'list', slug: 'klub' }).tournaments[gp.id];
  assert.deepEqual(list.map((p) => p.category).sort(), [2008, 2012]);
  // rules (web)
  assert.equal(R.bestCategory(gp, { year: 2013 }), 2012);
  assert.ok(R.categoryCheck(gp, { year: 2013 }, 2008).warn);
  assert.ok(R.categoryCheck(gp, { year: 2013 }, 2016).block);
  assert.deepEqual(R.categoryCheck(gp, { year: 2013 }, 2012), {});
  // úprava poznámky a uzávěrky správcem
  const ed = admin('setTournamentSignup', { eventId: ev.id, tournamentId: gp.id, deadline: day(25), note: 'sraz 8:00 u nádraží', categories: '2016, 2012' });
  const t2 = ed.event.tournaments[0];
  assert.deepEqual([t2.signup, t2.deadline, t2.note, t2.categories], ['open', day(25), 'sraz 8:00 u nádraží', [2016, 2012]]);
});

/** Stav jako v provozu: jedna akce se všemi soutěžemi (před rozdělením). */
function bigCalendar(props) {
  const fs = require('fs');
  const path = require('path');
  const gas = createGas({ owner: OWNER, props: Object.assign({ KALENDAR_2026_V2: 'later', KALENDAR_2026_V3: 'later' }, props || {}) });
  const { event } = parseImport(fs.readFileSync(path.join(__dirname, '../podklady/klubovy_kalendar_2026_2027.json'), 'utf8'));
  event.status = 'otevreno';
  event.slug = 'kalendar-2026-2027'; // adresa jako u akce založené v provozu
  const res = gas.post({ action: 'admin.saveEvent', idToken: fakeToken(OWNER), event });
  assert.equal(res.ok, true, res.error);
  return { gas, ev: res.event };
}

test('jednorázová úprava kalendáře: kategorie a uzávěrka 2 dny před (jen neupravené)', () => {
  const { gas } = bigCalendar();
  const sheet = gas.sheets['Turnaje'];
  const h = sheet.data[0];
  const row = (name) => sheet.data.find((r) => r[h.indexOf('name')] === name);
  const gp = row('3. turnaj GP Ústeckého kraje');
  const kp = row('Krajský přebor v rapid šachu HD8–HD20');
  gp[h.indexOf('deadline')] = '2027-01-09'; gp[h.indexOf('categories')] = '';
  kp[h.indexOf('deadline')] = '2027-04-05';
  gas.props.KALENDAR_2026_V2 = '';
  gas.get({ action: 'events' });
  const ev = gas.get({ action: 'event', slug: 'kalendar-2026-2027' }).event;
  const t = (name) => ev.tournaments.find((x) => x.name === name);
  assert.equal(t('3. turnaj GP Ústeckého kraje').deadline, '2027-01-14');
  assert.deepEqual(t('3. turnaj GP Ústeckého kraje').categories, [2016, 2012, 2008]);
  assert.equal(t('Krajský přebor v rapid šachu HD8–HD20').deadline, '2027-04-05', 'ručně změněnou uzávěrku nechá');
  assert.ok(gas.props.KALENDAR_2026_V2);
});

test('rozdělení kalendáře na samostatné akce i s přihláškami', () => {
  const { gas, ev } = bigCalendar();
  const gp = ev.tournaments.find((t) => t.name === '3. turnaj GP Ústeckého kraje');
  const kp = ev.tournaments.find((t) => t.name === 'Krajský přebor v rapid šachu HD8–HD20');
  const p = Object.assign(player(5, 'Malý'), { year: 2013 });
  const reg = gas.post({ action: 'register', slug: 'kalendar-2026-2027', mode: 'individual', email: 'r@x.cz', player: p, tournaments: [gp.id, kp.id] });
  assert.equal(reg.ok, true, reg.error);
  gas.props.KALENDAR_2026_V3 = '';
  const club = gas.get({ action: 'events', kind: 'club' }).events;
  assert.equal(club.length, 121);
  assert.equal(gas.get({ action: 'event', slug: 'kalendar-2026-2027' }).ok, false, 'původní akce zmizela');
  const gpEv = club.find((e) => e.tournaments[0].id === gp.id);
  assert.deepEqual([gpEv.name, gpEv.group, gpEv.dateFrom, gpEv.deadline], ['3. turnaj GP Ústeckého kraje', 'mladez', '2027-01-16', gp.deadline]);
  const list = gas.get({ action: 'list', slug: gpEv.slug }).tournaments[gp.id];
  assert.deepEqual(list.map((x) => x.name), ['Malý Jan'], 'přihláška se přesunula');
  const app = gas.get({ action: 'application', token: reg.editToken });
  assert.equal(app.ok, true, app.error);
  assert.equal(app.application.entries.length, 1, 'odkaz na změnu ukáže řádky jedné akce');
  const detail = gas.post({ action: 'admin.event', idToken: fakeToken(OWNER), id: gpEv.id });
  assert.equal(detail.registrations.length, 1);
});

test('role klubový admin: celá klubová sekce, z pořadatelské jen své akce', () => {
  const gas = createGas({ owner: OWNER });
  const as = (who) => (action, body) => gas.post(Object.assign({ action: 'admin.' + action, idToken: fakeToken(who) }, body));
  const owner = as(OWNER);
  assert.equal(owner('saveUser', { user: { email: 'klub@k.cz', role: 'clubadmin' } }).ok, true);
  assert.equal(owner('saveUser', { user: { email: 'porad@k.cz', role: 'organizer' } }).ok, true);
  const club = owner('saveEvent', { event: { name: 'GP', kind: 'club', status: 'otevreno', dateFrom: day(30), tournaments: [{ name: 'GP' }] } }).event;
  const fest = owner('saveEvent', { event: { name: 'Festival', status: 'otevreno', dateFrom: day(60), tournaments: [{ name: 'Open' }] } }).event;
  const ca = as('klub@k.cz');
  assert.deepEqual(ca('events', {}).events.map((e) => e.name), ['GP'], 'klubový admin vidí klubovou sekci, cizí festival ne');
  assert.equal(ca('event', { id: club.id }).ok, true);
  assert.equal(ca('event', { id: fest.id }).ok, false);
  assert.equal(ca('setTournamentSignup', { eventId: club.id, tournamentId: club.tournaments[0].id, signup: 'none' }).ok, true);
  const own = ca('saveEvent', { event: { name: 'Klubový turnaj', kind: 'club', dateFrom: day(10), tournaments: [{ name: 'T' }] } });
  assert.equal(own.ok, true, 'zakládá akce klubové sekce');
  assert.equal(ca('saveEvent', { event: { name: 'Vlastní open', dateFrom: day(90), tournaments: [{ name: 'O' }] } }).ok, true, 'i vlastní turnaj');
  const po = as('porad@k.cz');
  assert.equal(po('event', { id: club.id }).ok, false, 'pořadatel klubovou sekci nevidí');
  assert.match(po('saveEvent', { event: { name: 'X', kind: 'club', dateFrom: day(10), tournaments: [{ name: 'T' }] } }).error, /klubový admin/);
  // klubový admin smí měnit správce akce klubové sekce, kterou nezaložil
  const upd = ca('saveEvent', { event: Object.assign({}, club, { admins: 'trener@k.cz' }) });
  assert.deepEqual(upd.event.admins, ['trener@k.cz']);
});
