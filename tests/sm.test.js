const test = require('node:test');
const assert = require('node:assert/strict');
const SM = require('../docs/js/sm.js');
const R = require('../docs/js/rules.js');

const opts = { year: 2026, ageCategories: SM.DEFAULT_AGE_CATEGORIES, unregisteredCategory: 'N' };

test('hlavička exportu odpovídá souboru ze Swiss-Manageru', () => {
  assert.equal(SM.SM_HEADER.join(';'),
    'Č.;Jméno;Titul;ID č.;Rating nár;Rating FIDE;Narozen; Fed;Pohl.;Typ;Sk.;Č.klubu;Klub;FIDE ID;Zdroj;body;tb1;tb2;tb3;tb4;tb5;tb6;poř.;surname;first name;atitle');
});

test('řádky exportu jako v exportu ze SM, seřazeno podle ratingu', () => {
  const regs = [
    { surname: 'Spata', firstName: 'Miloš', year: 1966, club: 'Ústí nad Labem', inLok: 'NE', fed: 'CZE' },
    { surname: 'Mikulka', firstName: 'Martin Michael', year: 2011, club: 'ŠK Spartak Ústí nad Labem', inLok: 'ANO',
      idCr: 49382, fideId: 23730803, rn: 2126, rf: 2192, clubNo: 16310, sk: 'C', fed: 'CZE' },
    { surname: 'Bažantová', firstName: 'Marie', year: 1963, sex: 'F', title: 'WFM', club: 'ŠK Spartak Ústí nad Labem',
      inLok: 'ANO', idCr: 1517, fideId: 309354, rn: 1881, rf: 1905, clubNo: 16310, sk: 'A', fed: 'CZE' },
  ];
  const lines = SM.toSmText(SM.buildSmTable(regs.map(SM.regToPlayer), opts)).split('\r\n');
  assert.equal(lines.length, 5);
  assert.equal(lines[1], '1;Mikulka Martin Michael;;49382;2126;2192;00.00.2011;CZE;;U15;C;16310;ŠK Spartak Ústí nad Labem;23730803;;;;;;;;;;Mikulka;Martin Michael;');
  assert.equal(lines[2], '2;Bažantová Marie;WFM;1517;1881;1905;00.00.1963;CZE;F;S60;A;16310;ŠK Spartak Ústí nad Labem;309354;;;;;;;;;;Bažantová;Marie;');
  assert.equal(lines[3], '3;Spata Miloš;;;0;0;00.00.1966;CZE;;S60, N;;0;Ústí nad Labem;0;;;;;;;;;;Spata;Miloš;');
  lines.slice(0, 4).forEach((l) => assert.equal(l.split(';').length, 26));
});

test('družstva: dva soubory jako export ze SM', () => {
  // hlavičky přesně podle exportu ze SM (exp_test_3.TXT a exp_test_2.TXT)
  assert.equal(SM.SM_TEAM_HEADER.join(';'), 'Č.;Jméno;Zkratka;Č.kl.;Captain;FED;Group;Info');
  assert.equal(SM.SM_TEAM_PLAYER_HEADER.join(';'),
    'Č.;Jméno;Titul;ID č.;Rating nár;Rating FIDE;Narozen; Fed;Pohl.;Typ;Sk.;Č.klubu;Klub;FIDE ID;Zdroj;body;tb1;tb2;tb3;tb4;tb5;tb6;poř.;surname;first name;atitle;Šach.;Č.tým.');
  const regs = [
    { createdAt: '2027-01-01T10:00', mode: 'team', surname: '', team: 'Spartak', board: 0, captain: 'Novák' },
    { createdAt: '2027-01-01T10:00', surname: 'B', firstName: 'X', year: 2012, club: 'K', clubNo: 16310, inLok: 'ANO', team: 'Spartak', board: 2, captain: 'Novák' },
    { createdAt: '2027-01-01T10:00', surname: 'A', firstName: 'Y', year: 2012, club: 'K', clubNo: 16310, inLok: 'ANO', team: 'Spartak', board: 1, captain: 'Novák' },
    { createdAt: '2027-01-02T10:00', mode: 'team', surname: '', team: 'ZŠ Vážka', board: 0, captain: '' },
    { createdAt: '2027-01-03T10:00', mode: 'team', surname: '', team: 'Bez soupisky', board: 0, captain: '' },
    { createdAt: '2027-01-02T10:00', surname: 'Husák', firstName: 'Richard', year: 2015, club: 'Waldorfská ZŠ Vážka', inLok: 'NE', team: 'ZŠ Vážka', board: 1 },
  ];
  const { teams, players } = SM.buildTeamExport(regs, opts);
  assert.deepEqual(teams.slice(1), [
    [1, 'Spartak', 'Spartak', 16310, 'Novák', '', '', ''],
    [2, 'ZŠ Vážka', 'ZŠ Vážka', 0, '', '', '', ''],
    [3, 'Bez soupisky', 'Bez soupisky', 0, '', '', '', ''],
  ]);
  const col = (h) => SM.SM_TEAM_PLAYER_HEADER.indexOf(h);
  assert.deepEqual(players.slice(1).map((r) => [r[0], r[col('Jméno')], r[col('poř.')], r[col('Šach.')], r[col('Č.tým.')]]), [
    [1, 'A Y', 1, 1, 1], [2, 'B X', 2, 2, 1], [3, 'Husák Richard', 3, 1, 2],
  ]);
  const line = SM.toSmText(players).split('\r\n')[3];
  assert.equal(line.split(';').length, 28);
  assert.match(line, /^3;Husák Richard;;;0;0;00\.00\.2015;CZE;;U12, N;;0;Waldorfská ZŠ Vážka;0;;0;0;0;0;0;0;0;3;Husák;Richard;;1;2$/);
  assert.equal(SM.toSmText(teams).split('\r\n')[1], '1;Spartak;Spartak;16310;Novák;;;');
});

test('věkové kategorie podle roku akce', () => {
  const cat = (y) => SM.ageCategory(y, opts);
  assert.deepEqual([2014, 2013, 2008, 2006, 1990, 1966].map(cat), ['U12', 'U15', 'U18', 'U20', '', 'S60']);
});

test('pravidla turnajů', () => {
  const t = { minBirthYear: 2014 };
  assert.equal(R.eligibility(t, { year: 2013 }), 'jen pro ročník 2014 a mladší');
  assert.equal(R.eligibility(t, { year: 2014 }), '');
  assert.match(R.ratingWarning({ warnMaxRating: 1100 }, { rn: 1200, rf: 0 }), /ELO ČR 1200/);
  assert.equal(R.ratingWarning({ warnMaxRating: 1100 }, { rn: 1100 }), '');
  assert.equal(R.isClosed({ status: 'otevreno', deadline: '2026-05-02' }, new Date('2026-05-02T20:00:00')), false);
  assert.equal(R.isClosed({ status: 'otevreno', deadline: '2026-05-02' }, new Date('2026-05-03T00:01:00')), true);
  assert.equal(R.isClosed({ status: 'koncept' }), true);
  assert.equal(R.formatRange('2026-05-08', '2026-05-10'), '8.–10. 5. 2026');
  assert.equal(R.eventYear({ dateFrom: '2027-01-01' }), 2027);
});

test('ceny doplňků', () => {
  const obedy = { id: 'o', type: 'quantity', options: ['so', 'ne'], prices: [130, 120] };
  const doprava = { id: 'd', type: 'checkboxes', options: ['tam', 'zpět'], prices: [60, null] };
  const pokoj = { id: 'p', type: 'select', options: ['1l', '2l'], prices: [600, 450] };
  assert.equal(R.extraPrice(obedy, { so: 2, ne: 1 }), 380);
  assert.equal(R.extraPrice(doprava, ['tam', 'zpět']), 60);
  assert.equal(R.extraPrice(pokoj, '2l'), 450);
  assert.equal(R.extrasTotal([obedy, doprava, pokoj], { o: { so: 1 }, d: ['tam'], p: '1l' }), 790);
  assert.equal(R.extraText(obedy, { ne: 2, so: 1 }), 'so × 1, ne × 2');
  assert.equal(R.formatMoney(1234.5).replace(/\s/g, ' '), '1 234,5 Kč');
});

test('skloňování velikosti družstva', () => {
  assert.equal(R.teamSize({ boards: 4, reserves: 1 }), '4 šachovnice + 1 náhradník');
  assert.equal(R.teamSize({ boards: 6, reserves: 2 }), '6 šachovnic + 2 náhradníci');
  assert.equal(R.teamSize({ boards: 4, reserves: 0 }), '4 šachovnice');
});
