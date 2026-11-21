const test = require('node:test');
const assert = require('node:assert/strict');
const { PROMPT, EXAMPLE, parseImport } = require('../docs/js/import.js');
const { createGas, fakeToken } = require('./gas-mock.js');

test('zadání pro AI obsahuje ukázku formátu', () => {
  assert.ok(PROMPT.includes('"tournaments"'));
  assert.ok(PROMPT.includes('RRRR-MM-DD'));
  assert.ok(PROMPT.includes(JSON.stringify(EXAMPLE, null, 2)));
});

test('ukázka se načte beze změn a bez varování', () => {
  const { event, warnings } = parseImport(JSON.stringify(EXAMPLE));
  assert.deepEqual(warnings, []);
  assert.equal(event.status, 'koncept');
  assert.equal(event.name, EXAMPLE.name);
  assert.equal(event.tournaments.length, 4);
  assert.equal(event.tournaments[1].minBirthYear, 2015);
  assert.equal(event.tournaments[2].warnMaxRating, 1100);
  assert.equal(event.tournaments[3].type, 'team');
  assert.equal(event.tournaments[3].boards, 4);
  assert.deepEqual(event.extras[0].options, ['sobota tam', 'sobota zpět']);
  assert.deepEqual(event.extras[0].modes, ['individual']);
});

test('odpověď obalená textem a ```json blokem', () => {
  const text = 'Tady je výsledek:\n```json\n{"name":"Turnaj","dateFrom":"2027-01-10","tournaments":[{"name":"Rapid"}]}\n```\nHodně štěstí!';
  const { event } = parseImport(text);
  assert.equal(event.name, 'Turnaj');
  assert.equal(event.tournaments[0].type, 'individual');
});

test('české datum, neznámé hodnoty a varování', () => {
  const { event, warnings } = parseImport(JSON.stringify({
    event: {
      name: 'Přebor', dateFrom: '8. 5. 2027', deadline: 'brzy', infoUrl: 'www.neco.cz',
      tournaments: [
        { name: 'Družstva', type: 'družstva', boards: '6' },
        { name: '', type: 'individual' },
        { name: 'Mládež', minBirthYear: 2016, maxBirthYear: 2010 },
      ],
      extras: [{ label: 'Strava', type: 'select', options: [] }, { label: 'Tričko', type: 'checkboxes', options: 'S\nM\nL' }, { type: 'text' }],
    },
  }));
  assert.equal(event.dateFrom, '2027-05-08');
  assert.equal(event.deadline, '');
  assert.equal(event.infoUrl, '');
  assert.deepEqual(event.tournaments.map((t) => t.type), ['team', 'individual']);
  assert.equal(event.tournaments[0].boards, 6);
  assert.equal(event.extras[0].type, 'text', 'select bez možností → text');
  assert.deepEqual(event.extras[1].options, ['S', 'M', 'L']);
  assert.equal(event.extras.length, 2);
  const w = warnings.join(' | ');
  assert.match(w, /Uzávěrka: „brzy“/);
  assert.match(w, /Turnaj č\. 2 nemá název/);
  assert.match(w, /Mládež.*vylučují/);
  assert.match(w, /Strava.*nemá možnosti/);
  assert.match(w, /Odkaz na propozice/);
});

test('chybný vstup', () => {
  assert.throws(() => parseImport(''), /Vložte odpověď/);
  assert.throws(() => parseImport('žádný json'), /není žádný JSON/);
  assert.throws(() => parseImport('{"name": "x",}'), /není platný JSON/);
  const empty = parseImport('{"name":"Jen název"}');
  assert.equal(empty.event.tournaments.length, 1, 'prázdný turnaj k vyplnění');
  assert.match(empty.warnings.join(' '), /žádné turnaje/);
});

test('importovaná akce projde uložením na serveru', () => {
  const gas = createGas({ owner: 'owner@example.cz' });
  const { event } = parseImport(JSON.stringify(EXAMPLE));
  const res = gas.post({ action: 'admin.saveEvent', idToken: fakeToken('owner@example.cz'), event });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.event.status, 'koncept');
  assert.equal(res.event.tournaments.length, 4);
  assert.equal(res.event.tournaments[3].reserves, 1);
  assert.deepEqual(res.event.extras.map((x) => x.type), ['checkboxes', 'quantity', 'quantity', 'textarea']);
  assert.deepEqual(res.event.extras[1].prices, [130, 130]);
  assert.equal(res.event.extras[1].unit, 'porce');
});

test('import: startovné a slevy', () => {
  const { event } = parseImport(JSON.stringify(EXAMPLE));
  assert.equal(event.tournaments[0].fee, 250);
  assert.deepEqual(event.tournaments[0].feeRules.map((r) => r.type), ['women', 'youth', 'titles']);
  assert.equal(event.tournaments[1].fee, null);
  const gas = createGas({ owner: 'owner@example.cz' });
  const res = gas.post({ action: 'admin.saveEvent', idToken: fakeToken('owner@example.cz'), event });
  assert.equal(res.event.tournaments[0].feeRules[1].value, 2008);
});
