const test = require('node:test');
const assert = require('node:assert/strict');
const { PlayerDB } = require('../docs/js/players.js');
const R = require('../docs/js/rules.js');
const { createGas, fakeToken } = require('./gas-mock.js');

const data = {
  fields: ['id', 'name', 'year', 'sex', 'rn', 'rf', 'title', 'fide', 'fed', 'club', 'st', 'rr', 'rfr'],
  clubs: { 1: 'ŠK Spartak Ústí nad Labem', 2: 'Šachový klub Ústí nad Orlicí', 3: 'TJ Sokol Ústí', 4: 'ŠK Teplice' },
  players: [
    [10, 'Novák Petr', 2010, '', 1800, 1850, '', 0, 'CZE', 1, 'C', 1700, 1750],
    [11, 'Dvořák Jan', 2011, '', 1500, 0, '', 0, 'CZE', 1, 'C', 0, 0],
    [12, 'Novák Karel', 2009, '', 1600, 0, '', 0, 'CZE', 2, 'C', 1650, 0],
    [13, 'Malý Ondřej', 2012, '', 1400, 0, '', 0, 'CZE', 3, 'C', 0, 0],
    [14, 'Velký Ivan', 2012, '', 1400, 0, '', 0, 'CZE', 4, 'C', 0, 0],
  ],
};

test('listina: rapid ratingy z rapid LOK', () => {
  const db = new PlayerDB(data);
  const p = db.players.find((x) => x.id === 10);
  assert.deepEqual([p.rn, p.rf, p.rnr, p.rfr], [1800, 1850, 1700, 1750]);
  // starší players.json bez rapid sloupců
  const old = new PlayerDB({ fields: data.fields.slice(0, 11), clubs: data.clubs, players: data.players.map((r) => r.slice(0, 11)) });
  assert.equal(old.players[0].rnr, 0);
});

test('výběr z listiny: víc klubů s „Ústí“, přesný klub, jméno', () => {
  const db = new PlayerDB(data);
  const usti = db.filter({ club: 'usti' });
  assert.equal(usti.total, 4);
  assert.deepEqual(usti.clubs.map((c) => [c.name, c.count]), [
    ['ŠK Spartak Ústí nad Labem', 2], ['Šachový klub Ústí nad Orlicí', 1], ['TJ Sokol Ústí', 1],
  ]);
  const exact = db.filter({ club: 'TJ Sokol Ústí' });
  assert.deepEqual(exact.players.map((p) => p.id), [13], 'přesný název = jen ten klub');
  assert.deepEqual(db.filter({ club: 'Ústí', name: 'novak' }).players.map((p) => p.id).sort(), [10, 12]);
});

test('pravidla: rating podle turnaje (rapid)', () => {
  const p = { rn: 1800, rf: 1850, rnr: 1700, rfr: 1750 };
  const rapid = { rating: 'rapid', warnMaxRating: 1720, fee: 200, feeRules: [{ type: 'rating', value: 1800, price: 0 }] };
  const std = Object.assign({}, rapid, { rating: 'standard' });
  assert.deepEqual([R.rated(rapid, p).rn, R.rated(rapid, p).rf], [1700, 1750]);
  assert.equal(R.rated(std, p).rn, 1800);
  assert.match(R.ratingWarning(rapid, p), /rapid ELO ČR 1700 \/ FIDE rapid 1750/);
  assert.equal(R.entryFee(rapid, p).amount, 200, 'rapid 1750 < 1800 → bez slevy');
  assert.equal(R.entryFee(std, p).amount, 0, 'klasický 1850 ≥ 1800 → zdarma');
  // uložený řádek přihlášky (bez rnr/rfr) už má rating turnaje
  assert.equal(R.rated(rapid, { rn: 1700, rf: 1750 }).rn, 1700);
});

test('backend: u rapid turnaje se uloží rapid rating, u klasického klasický', () => {
  const gas = createGas({ owner: 'owner@example.cz' });
  const admin = (action, body) => gas.post(Object.assign({ action: 'admin.' + action, idToken: fakeToken('owner@example.cz') }, body));
  const ev = admin('saveEvent', { event: { name: 'Festival', slug: 'festival', dateFrom: '2099-05-01', status: 'otevreno', tournaments: [
    { name: 'Rapid', type: 'individual', rating: 'rapid' }, { name: 'Vážný', type: 'individual' },
    { name: 'Družstva', type: 'team', boards: 1, reserves: 0, rating: 'rapid' },
  ] } }).event;
  assert.deepEqual(ev.tournaments.map((t) => t.rating), ['rapid', 'standard', 'rapid']);
  const player = { registered: true, id: 10, surname: 'Novák', firstName: 'Petr', year: 2010, rn: 1800, rf: 1850, rnr: 1700, rfr: 1750,
    club: 'ŠK Spartak Ústí nad Labem', clubNo: 1, fed: 'CZE', status: 'C' };
  let res = gas.post({ action: 'register', slug: 'festival', mode: 'individual', email: 'a@b.cz', player, tournaments: [ev.tournaments[0].id, ev.tournaments[1].id] });
  assert.equal(res.ok, true, res.error);
  res = gas.post({ action: 'register', slug: 'festival', mode: 'team', email: 'k@b.cz',
    teams: [{ tournamentId: ev.tournaments[2].id, name: 'Spartak', captain: 'X', players: [player] }] });
  assert.equal(res.ok, true, res.error);
  const regs = admin('event', { id: ev.id }).registrations.filter((r) => r.surname);
  const by = (tid) => regs.find((r) => r.tournamentId === tid);
  assert.deepEqual([by(ev.tournaments[0].id).rn, by(ev.tournaments[0].id).rf], [1700, 1750]);
  assert.deepEqual([by(ev.tournaments[1].id).rn, by(ev.tournaments[1].id).rf], [1800, 1850]);
  assert.equal(by(ev.tournaments[2].id).rn, 1700, 'soupiska rapid družstev');
});
