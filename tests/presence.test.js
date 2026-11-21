const test = require('node:test');
const assert = require('node:assert/strict');
global.Rules = require('../docs/js/rules.js');
const P = require('../docs/js/payments.js');

const ev = {
  dateFrom: '2027-05-01',
  tournaments: [
    { id: 'R', name: 'Rapid', short: 'Rapid', type: 'individual', fee: 200, feeRules: [] },
    { id: 'B', name: 'Blesk', short: 'Blesk', type: 'individual', fee: 100, feeRules: [] },
    { id: 'D', name: 'Družstva', short: 'Družstva', type: 'team', fee: 500, feeRules: [] },
  ],
  extras: [{ id: 'obed', type: 'quantity', label: 'Obědy', options: ['sobota'], prices: [130], unit: 'porce' }],
};
const row = (id, app, tid, surname, extra) => Object.assign({
  id, applicationId: app, tournamentId: tid, surname, firstName: 'Jan', year: 2010, club: 'ŠK Alfa', email: app + '@x.cz', status: '', extras: '{}',
}, extra || {});

test('seznam k prezenci: abecedně, samostatný hráč vč. doplňků, výprava zvlášť', () => {
  const regs = [
    row('1', 'A1', 'R', 'Šafránek', { extras: '{"obed":{"sobota":2}}' }),
    row('2', 'A1', 'B', 'Šafránek', { extras: '{"obed":{"sobota":2}}' }),
    row('3', 'V1', 'R', 'Adam', { club: 'TJ Beta', extras: '{"obed":{"sobota":3}}' }),
    row('4', 'V1', 'R', 'Čech', { club: 'TJ Beta', extras: '{"obed":{"sobota":3}}' }),
    row('5', 'V1', 'B', 'Čech', { club: 'TJ Beta', extras: '{"obed":{"sobota":3}}' }),
    row('6', 'Z1', 'R', 'Zrušený', { status: 'zrušeno' }),
    row('7', 'T1', 'D', '', { mode: 'team', team: 'Gama', board: 0 }),
    row('8', 'T1', 'D', 'Bárta', { mode: 'team', team: 'Gama', board: 1, club: 'Gama' }),
  ];
  const list = P.presenceList(ev, regs, []);
  assert.deepEqual(list.people.map((p) => p.surname), ['Adam', 'Bárta', 'Čech', 'Šafránek'], 'česká abeceda, bez zrušených');
  const saf = list.people.find((p) => p.surname === 'Šafránek');
  assert.equal(saf.fee, 200 + 100 + 260, 'startovné + obědy');
  assert.deepEqual(saf.tournaments, ['Rapid', 'Blesk']);
  assert.equal(saf.group, '');
  const cech = list.people.find((p) => p.surname === 'Čech');
  assert.equal(cech.fee, 300, 'u člena výpravy jen jeho startovné');
  const bart = list.people.find((p) => p.surname === 'Bárta');
  assert.deepEqual(bart.tournaments, ['Družstva (Gama, 1.)']);
  assert.equal(list.groups.length, 2);
  const [gama, beta] = list.groups; // podle klubu: Gama, TJ Beta
  assert.equal(gama.club, 'Gama');
  assert.equal(gama.total, 500, 'startovné družstva');
  assert.equal(beta.club, 'TJ Beta');
  assert.equal(beta.letter, 'B');
  assert.equal(cech.group, 'B');
  assert.equal(beta.playersFee, 500);
  assert.equal(beta.total, 500 + 390);
  assert.equal(list.total, 560 + 500 + 890);
});

test('seznam k prezenci: zaplacené položky se nepočítají', () => {
  const regs = [row('1', 'A1', 'R', 'Novák', { extras: '{"obed":{"sobota":1}}' })];
  const receipts = [{ status: '', items: [{ key: 'fee:1' }] }];
  const p = P.presenceList(ev, regs, receipts).people[0];
  assert.equal(p.fee, 130, 'zbývá jen oběd');
  assert.equal(p.paidSomething, true);
  const storno = P.presenceList(ev, regs, [{ status: 'stornováno', items: [{ key: 'fee:1' }] }]).people[0];
  assert.equal(storno.fee, 330, 'stornovaný doklad neplatí');
});

test('seznam k prezenci: po přihláškách a po klubech', () => {
  const regs = [
    row('1', 'A1', 'R', 'Šafránek', { extras: '{"obed":{"sobota":2}}' }),
    row('3', 'V1', 'R', 'Adam', { club: 'TJ Beta', extras: '{"obed":{"sobota":3}}' }),
    row('4', 'V1', 'R', 'Čech', { club: 'TJ Beta', extras: '{"obed":{"sobota":3}}' }),
    row('9', 'V2', 'B', 'Hostující', { club: 'Jiný klub', extras: '{}' }),
    row('10', 'V2', 'B', 'Domácí', { club: 'TJ Beta', extras: '{}' }),
    row('11', 'V2', 'B', 'Další', { club: 'TJ Beta', extras: '{}' }),
  ];
  const list = P.presenceList(ev, regs, []);
  assert.deepEqual(list.applications.map((a) => [a.applicationId, a.club, a.single, a.total]), [
    ['A1', 'ŠK Alfa', true, 460], ['V1', 'TJ Beta', false, 790], ['V2', 'TJ Beta', false, 300],
  ]);
  const a1 = list.applications[0];
  assert.equal(a1.persons[0].ownFee, 200, 'v přihlášce zvlášť startovné…');
  assert.deepEqual(a1.items, [{ label: 'Obědy: sobota × 2 porce', amount: 260 }], '…a doplňky');
  assert.deepEqual(list.clubs.map((c) => [c.club, c.persons.length, c.applications.length, c.total]), [
    ['ŠK Alfa', 1, 1, 460], ['TJ Beta', 5, 2, 1090],
  ], 'přihláška patří klubu většiny hráčů, i hostující hráč');
  assert.deepEqual(list.clubs[1].persons.map((p) => p.surname), ['Adam', 'Čech', 'Další', 'Domácí', 'Hostující']);
  assert.equal(list.total, 460 + 790 + 300);
});
