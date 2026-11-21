// Startovné se slevami, částka k úhradě v e-mailu, pokladní doklady.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../docs/js/rules.js');
const { createGas, fakeToken } = require('./gas-mock.js');

const OWNER = 'owner@example.cz';
const rapid = {
  type: 'individual', fee: 300,
  feeRules: [
    { type: 'women', price: 200 },
    { type: 'youth', value: 2008, price: 150 },
    { type: 'senior', value: 1961, price: 250 },
    { type: 'titles', value: 'GM, IM, WGM', price: 0 },
    { type: 'rating', value: 2300, price: 0 },
  ],
};
const p = (o) => Object.assign({ year: 1990, sex: '', title: '', rn: 1500, rf: 1600 }, o);

test('startovné: nejnižší z vyhovujících slev', () => {
  assert.deepEqual(R.entryFee(rapid, p()), { amount: 300, reason: '' });
  assert.deepEqual(R.entryFee(rapid, p({ sex: 'F' })), { amount: 200, reason: 'ženy' });
  assert.deepEqual(R.entryFee(rapid, p({ sex: 'F', year: 2012 })), { amount: 150, reason: 'ročník 2008 a mladší' });
  assert.equal(R.entryFee(rapid, p({ year: 1955 })).amount, 250);
  assert.equal(R.entryFee(rapid, p({ title: 'im' })).amount, 0);
  assert.equal(R.entryFee(rapid, p({ rf: 2350 })).amount, 0);
  assert.equal(R.entryFee({ type: 'individual', fee: null }, p()), null);
  assert.equal(R.entryFee({ type: 'team', fee: 800, feeRules: rapid.feeRules }, p({ sex: 'F' })).amount, 800, 'družstvo bez slev');
});

function setup() {
  const gas = createGas({ owner: OWNER });
  const admin = (action, body) => gas.post(Object.assign({ action: 'admin.' + action, idToken: fakeToken(OWNER) }, body));
  const ev = admin('saveEvent', { event: {
    name: 'Open 2099', dateFrom: '2099-05-08', status: 'otevreno',
    issuer: { name: 'ŠK Chlumec', ico: '12345678', address: 'Muchova 267, Chlumec', place: 'Chlumec', cashier: 'Jan Pokladník', prefix: 'PPD99-' },
    tournaments: [
      Object.assign({ name: 'Rapid' }, rapid),
      { name: 'Družstva', type: 'team', boards: 2, reserves: 0, fee: '800' },
    ],
    extras: [{ label: 'Obědy', type: 'quantity', options: ['sobota'], prices: [130] }],
  } }).event;
  return { gas, admin, ev };
}

test('startovné se uloží s akcí a je v e-mailu', () => {
  const { gas, ev } = setup();
  assert.equal(ev.tournaments[0].fee, 300);
  assert.equal(ev.tournaments[0].feeRules.length, 5);
  assert.deepEqual(ev.tournaments[0].feeRules[3], { type: 'titles', value: 'GM, IM, WGM', price: 0 });
  assert.equal(ev.tournaments[1].fee, 800);
  assert.deepEqual(ev.tournaments[1].feeRules, []);
  assert.equal(ev.issuer.ico, '12345678');
  // veřejná akce ukazuje ceny, ne údaje pro doklady
  const pub = gas.get({ action: 'event', slug: ev.slug }).event;
  assert.equal(pub.tournaments[0].fee, 300);
  assert.equal(pub.issuer, undefined);

  const res = gas.post({ action: 'register', slug: ev.slug, mode: 'individual', email: 'a@b.cz', players: [
    { player: { registered: true, id: 1, surname: 'Muž', firstName: 'Jan', year: 1990, club: 'K' }, tournaments: [ev.tournaments[0].id] },
    { player: { registered: true, id: 2, surname: 'Žena', firstName: 'Eva', year: 1990, sex: 'F', club: 'K' }, tournaments: [ev.tournaments[0].id] },
  ], extras: { obedy: { sobota: 2 } } });
  assert.equal(res.ok, true, res.error);
  assert.match(gas.mails[0].body, /K úhradě na místě: 760 Kč \(startovné 500 Kč, doplňky 260 Kč\)/);
});

test('pokladní doklady: číslování, kontrola zaplacených položek, storno', () => {
  const { admin, ev } = setup();
  const item = (key, amount) => ({ key, label: 'Startovné Rapid', person: 'Muž Jan', amount });
  let res = admin('issueReceipts', { eventId: ev.id, receipts: [
    { payer: 'Muž Jan', payerClub: 'ŠK Teplice', items: [item('fee:A', 300), item('x:1:obedy:sobota', 260)] },
    { payer: 'Žena Eva', items: [item('fee:B', 200)] },
  ] });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(res.issued.map((r) => [r.number, r.total]), [['PPD99-0001', 560], ['PPD99-0002', 200]]);
  assert.equal(res.issued[0].issuer.name, 'ŠK Chlumec');
  assert.equal(res.issued[0].method, 'hotově');
  // stejná položka podruhé nejde
  assert.match(admin('issueReceipts', { eventId: ev.id, receipts: [{ payer: 'X', items: [item('fee:A', 300)] }] }).error, /už zaplacená dokladem PPD99-0001/);
  // storno uvolní položky, číslo pokračuje
  res = admin('cancelReceipt', { id: res.issued[0].id });
  assert.equal(res.receipts.find((r) => r.number === 'PPD99-0001').status, 'stornováno');
  res = admin('issueReceipts', { eventId: ev.id, receipts: [{ payer: 'Muž Jan', items: [item('fee:A', 300)] }] });
  assert.equal(res.issued[0].number, 'PPD99-0003');
  assert.equal(admin('event', { id: ev.id }).receipts.length, 3);
  // bez údajů klubu nejde
  const ev2 = admin('saveEvent', { event: { name: 'Bez klubu', dateFrom: '2099-01-01', tournaments: [{ name: 'A' }] } }).event;
  assert.match(admin('issueReceipts', { eventId: ev2.id, receipts: [{ payer: 'X', items: [item('k', 1)] }] }).error, /údaje pro doklady/);
  assert.match(admin('issueReceipts', { eventId: ev.id, receipts: [{ payer: '', items: [item('fee:Z', 1)] }] }).error, /od koho/);
});

test('kopie akce přebírá startovné i údaje pro doklady', () => {
  const { admin, ev } = setup();
  const c = admin('copyEvent', { id: ev.id, name: 'Open 2100', dateFrom: '2100-05-07' }).event;
  assert.equal(c.tournaments[0].fee, 300);
  assert.equal(c.tournaments[0].feeRules.length, 5);
  assert.equal(c.issuer.prefix, 'PPD99-');
});

test('položky k úhradě a částka slovy', () => {
  const P = require('../docs/js/payments.js');
  const ev = {
    tournaments: [
      Object.assign({ id: 'T1', name: 'Rapid', short: 'Rapid' }, rapid),
      { id: 'T2', name: 'Družstva', type: 'team', fee: 800 },
    ],
    extras: [
      { id: 'obedy', label: 'Obědy', type: 'quantity', unit: 'porce', options: ['sobota', 'neděle'], prices: [130, null] },
      { id: 'doprava', label: 'Doprava', type: 'checkboxes', options: ['tam'], prices: [60] },
    ],
  };
  const reg = (o) => Object.assign({ status: '', mode: 'individual', email: 'v@k.cz', extras: '{}' }, o);
  const regs = [
    reg({ id: 'r1', applicationId: 'A', tournamentId: 'T1', surname: 'Muž', firstName: 'Jan', year: 1990, club: 'ŠK X',
      extras: JSON.stringify({ obedy: { sobota: 2, 'neděle': 1 }, doprava: ['tam'] }) }),
    reg({ id: 'r2', applicationId: 'A', tournamentId: 'T1', surname: 'Žena', firstName: 'Eva', year: 2010, sex: 'F', club: 'ŠK X',
      extras: JSON.stringify({ obedy: { sobota: 2, 'neděle': 1 }, doprava: ['tam'] }) }),
    reg({ id: 'r3', applicationId: 'A', tournamentId: 'T1', surname: 'Pryč', firstName: 'Petr', year: 1990, status: 'zrušeno' }),
    reg({ id: 't1', applicationId: 'B', tournamentId: 'T2', mode: 'team', surname: '', team: 'Spartak' }),
    reg({ id: 't2', applicationId: 'B', tournamentId: 'T2', mode: 'team', surname: 'Hráč', firstName: 'Jan', year: 2012, team: 'Spartak', club: 'Spartak' }),
  ];
  const items = P.buildItems(ev, regs);
  assert.deepEqual(items.map((i) => [i.key, i.label, i.person, i.amount]), [
    ['fee:r1', 'Startovné Rapid', 'Muž Jan', 300],
    ['fee:r2', 'Startovné Rapid (ročník 2008 a mladší)', 'Žena Eva', 150],
    ['fee:t1', 'Startovné Družstva – družstvo Spartak', 'družstvo Spartak', 800],
    ['x:A:obedy:sobota', 'Obědy: sobota × 2 porce', 'přihláška A (Muž Jan + 1)', 260],
    ['x:A:doprava:tam', 'Doprava: tam', 'přihláška A (Muž Jan + 1)', 60],
  ]);
  assert.equal(items[3].club, 'ŠK X');
  const paid = P.paidMap([{ number: '1', status: '', items: [{ key: 'fee:r1' }] }, { number: '2', status: 'stornováno', items: [{ key: 'fee:r2' }] }]);
  assert.deepEqual(Object.keys(paid), ['fee:r1']);

  assert.equal(P.amountWords(1234), 'Jedentisícdvěstětřicetčtyři Kč');
  assert.equal(P.amountWords(560), 'Pětsetšedesát Kč');
  assert.equal(P.amountWords(2000), 'Dvatisíce Kč');
  assert.equal(P.amountWords(15000), 'Patnácttisíc Kč');
  assert.equal(P.amountWords(120.5), 'Stodvacet Kč padesát hal.');
  assert.equal(P.amountWords(0), 'Nula Kč');
});
