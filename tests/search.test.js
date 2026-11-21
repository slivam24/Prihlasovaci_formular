const test = require('node:test');
const assert = require('node:assert/strict');
const { PlayerDB, splitName, norm } = require('../docs/js/players.js');

const data = {
  generated: '2026-11-01T00:00:00+00:00',
  fields: ['id', 'name', 'year', 'sex', 'rn', 'rf', 'title', 'fide', 'fed', 'club', 'st'],
  clubs: { 16310: 'ŠK Spartak Ústí nad Labem', 12361: 'ŠK JOLY Lysá nad Labem, z.s.', 11050: 'Unichess' },
  players: [
    [49382, 'Mikulka Martin Michael', 2011, '', 2126, 2192, '', 23730803, 'CZE', 16310, 'C'],
    [51507, 'Mikulka Martin', 1977, '', 1381, 1605, '', 23738260, 'CZE', 16310, 'A'],
    [5099, 'Červený Martin', 1983, '', 2236, 2290, 'IM', 321141, 'CZE', 12361, 'A'],
    [41903, 'Červený Miroslav', 1978, '', 1253, 0, '', 23707941, 'CZE', 11050, 'N'],
    [1517, 'Bažantová Marie', 1963, 'F', 1881, 1905, 'WFM', 309354, 'CZE', 16310, 'A'],
    [12, 'Martin Jan', 1990, '', 1500, 0, '', 0, 'CZE', 11050, 'A'],
  ],
};
const db = new PlayerDB(data);

test('splitName dělí podle první mezery jako Swiss-Manager', () => {
  assert.deepEqual(splitName('Mikulka Martin Michael'), { surname: 'Mikulka', firstName: 'Martin Michael' });
  assert.deepEqual(splitName('Novák'), { surname: 'Novák', firstName: '' });
});

test('norm odstraní diakritiku', () => {
  assert.equal(norm('Červený Řehoř'), 'cerveny rehor');
});

test('hledání bez diakritiky a podle začátků slov', () => {
  const r = db.search('cerv mar');
  assert.equal(r[0].name, 'Červený Martin');
  assert.equal(r.length, 1);
  assert.equal(r[0].club, 'ŠK JOLY Lysá nad Labem, z.s.');
  assert.equal(r[0].surname, 'Červený');
});

test('příjmení má přednost před křestním jménem', () => {
  const r = db.search('martin');
  assert.equal(r[0].name, 'Martin Jan');
});

test('ročník a ID zúží výsledky', () => {
  assert.deepEqual(db.search('mikulka 2011').map((p) => p.id), [49382]);
  assert.deepEqual(db.search('1517').map((p) => p.id), [1517]);
});

test('vyšší rating je dřív', () => {
  assert.deepEqual(db.search('mikulka').map((p) => p.id), [49382, 51507]);
});

test('krátký nebo prázdný dotaz nic nevrací', () => {
  assert.deepEqual(db.search(''), []);
  assert.deepEqual(db.search('1'), []);
});

test('filtr pro hromadný výběr: klub, ročník, pohlaví, aktivní', () => {
  const names = (r) => r.players.map((p) => p.name);
  assert.deepEqual(names(db.filter({ club: 'spartak' })), ['Mikulka Martin Michael', 'Bažantová Marie', 'Mikulka Martin']);
  assert.deepEqual(names(db.filter({ club: 'spartak', yearFrom: 2000 })), ['Mikulka Martin Michael']);
  assert.deepEqual(names(db.filter({ club: 'spartak', yearTo: 1970 })), ['Bažantová Marie']);
  assert.deepEqual(names(db.filter({ club: 'SPARTAK ústí', sex: 'F' })), ['Bažantová Marie']);
  assert.deepEqual(names(db.filter({ club: 'unichess' })), ['Martin Jan', 'Červený Miroslav'], 'podle ratingu');
  assert.deepEqual(names(db.filter({ club: 'unichess', activeOnly: true })), ['Martin Jan'], 'N = neaktivní');
  assert.deepEqual(names(db.filter({ club: 'unichess', membership: 'active' })), ['Martin Jan']);
  assert.deepEqual(names(db.filter({ club: 'unichess', membership: 'inactive' })), ['Červený Miroslav']);
  assert.deepEqual(names(db.filter({ club: 'unichess', membership: '' })), ['Martin Jan', 'Červený Miroslav']);
  assert.equal(db.filter({ yearFrom: 1900 }, 2).players.length, 2);
  assert.equal(db.filter({ yearFrom: 1900 }, 2).total, 6);
  assert.ok(db.clubNames().includes('Unichess'));
});
