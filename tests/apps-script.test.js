// Testy čistých funkcí z apps-script/Code.gs (bez služeb Googlu).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'), ctx);
const gs = (code) => vm.runInContext(code, ctx);
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/config.json'), 'utf8'));
config.festival.deadline = '';
ctx.config = config;

const now = new Date('2026-04-10T10:00:00');
const process = (data, existing = []) => {
  ctx.args = [data, existing, now];
  return gs('processRegistration_(args[0], config, args[1], args[2])');
};

const lokPlayer = {
  registered: true, id: 49382, surname: 'Mikulka', firstName: 'Martin Michael', year: 2011, sex: '',
  title: '', fide: 23730803, fed: 'CZE', rn: 2126, rf: 2192, clubNo: 16310, club: 'ŠK Spartak Ústí nad Labem', status: 'C',
};
const manualPlayer = {
  registered: false, surname: 'Spata', firstName: 'Miloš', year: 1966, sex: '', club: 'Ústí nad Labem', fed: 'CZE',
};

test('hlavička exportu odpovídá souboru ze Swiss-Manageru', () => {
  const expected = 'Č.;Jméno;Titul;ID č.;Rating nár;Rating FIDE;Narozen; Fed;Pohl.;Typ;Sk.;Č.klubu;Klub;FIDE ID;Zdroj;body;tb1;tb2;tb3;tb4;tb5;tb6;poř.;surname;first name;atitle';
  assert.equal(gs('SM_HEADER.join(";")'), expected);
});

test('přihláška jednotlivce vytvoří řádek s turnaji a doplňky', () => {
  const r = process({
    mode: 'individual', email: 'hrac@example.cz', player: lokPlayer, tournaments: ['rapid', 'blesk', 'neexistuje'],
    extras: { doprava: ['sobota zpět', 'podvrh'], ubytovani: '2lůžkový pokoj', sdeleni: 'spolu s tátou' },
  });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.rows.length, 1);
  const row = r.rows[0];
  assert.equal(row['Open rapid'], 'ANO');
  assert.equal(row['Blesk'], 'ANO');
  assert.equal(row['Veteráni'], undefined);
  assert.equal(row['Doprava'], 'sobota zpět');
  assert.equal(row['Ubytování'], '2lůžkový pokoj');
  assert.equal(row['V LOK'], 'ANO');
  assert.equal(row['Sk.'], 'C');
});

test('věkové omezení se vynucuje', () => {
  const r = process({ mode: 'individual', email: 'a@b.cz', player: lokPlayer, tournaments: ['zaci'] });
  assert.equal(r.ok, false);
  assert.match(r.error, /2014 a mladší/);
  const r2 = process({ mode: 'individual', email: 'a@b.cz', player: { ...lokPlayer, id: 1, year: 2014 }, tournaments: ['neregistrovani'] });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /2013 a starší/);
});

test('ELO nad limit u turnaje neregistrovaných projde (jen upozornění ve formuláři)', () => {
  const r = process({ mode: 'individual', email: 'a@b.cz', player: lokPlayer, tournaments: ['neregistrovani'] });
  assert.equal(r.ok, true, r.error);
});

test('duplicitní přihláška do stejného turnaje se odmítne, zrušená se nepočítá', () => {
  const first = process({ mode: 'individual', email: 'a@b.cz', player: lokPlayer, tournaments: ['rapid'] });
  const again = process({ mode: 'individual', email: 'a@b.cz', player: lokPlayer, tournaments: ['rapid'] }, first.rows);
  assert.equal(again.ok, false);
  assert.match(again.error, /už přihlášen/);
  const cancelled = first.rows.map((r) => ({ ...r, Stav: 'zrušeno' }));
  assert.equal(process({ mode: 'individual', email: 'a@b.cz', player: lokPlayer, tournaments: ['rapid'] }, cancelled).ok, true);
  const otherTour = process({ mode: 'individual', email: 'a@b.cz', player: lokPlayer, tournaments: ['blesk'] }, first.rows);
  assert.equal(otherTour.ok, true);
});

test('ruční hráč nemůže podstrčit rating ani ID', () => {
  const r = process({ mode: 'individual', email: 'a@b.cz', player: { ...manualPlayer, rn: 2500, id: 0 }, tournaments: ['veterani'] });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.rows[0]['Rating nár'], '');
  assert.equal(r.rows[0]['V LOK'], 'NE');
});

test('chybějící údaje se odmítnou', () => {
  assert.equal(process({ mode: 'individual', email: 'spatne', player: lokPlayer, tournaments: ['rapid'] }).ok, false);
  assert.equal(process({ mode: 'individual', email: 'a@b.cz', player: null, tournaments: ['rapid'] }).ok, false);
  assert.equal(process({ mode: 'individual', email: 'a@b.cz', player: lokPlayer, tournaments: [] }).ok, false);
  assert.equal(process({ mode: 'individual', email: 'a@b.cz', player: { ...manualPlayer, club: '' }, tournaments: ['rapid'] }).ok, false);
});

test('uzávěrka', () => {
  config.festival.deadline = '2026-04-09';
  const r = process({ mode: 'individual', email: 'a@b.cz', player: lokPlayer, tournaments: ['rapid'] });
  config.festival.deadline = '';
  assert.equal(r.ok, false);
  assert.match(r.error, /uzavřeno/);
});

test('družstvo: jedna přihláška, řádek za každého hráče', () => {
  const p = (id, year) => ({ ...lokPlayer, id, year, surname: 'Hráč' + id });
  const team = { tournament: 'druzstva', name: 'Spartak A', captain: 'Jan Novák', players: [p(1, 2010), p(2, 2011), p(3, 2012), p(4, 2013), null] };
  const r = process({ mode: 'team', email: 'k@b.cz', team, extras: { doprava: ['sobota tam'], poznamka: 'ok' } });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.rows.length, 4);
  assert.deepEqual(Array.from(r.rows, (x) => x['Šachovnice']), [1, 2, 3, 4]);
  assert.equal(r.rows[0]['Družstvo'], 'Spartak A');
  assert.equal(r.rows[0]['Družstva'], 'ANO');
  assert.equal(r.rows[0]['Doprava'], undefined, 'doprava není u družstev v nabídce');
  assert.equal(r.rows[0]['Poznámka'], 'ok');

  const dupName = process({ mode: 'team', email: 'k@b.cz', team: { ...team, players: [p(5, 2010), p(6, 2010), p(7, 2010), p(8, 2010)] } }, r.rows);
  assert.match(dupName.error, /už je přihlášeno/);
  const dupPlayer = process({ mode: 'team', email: 'k@b.cz', team: { ...team, name: 'Spartak B', players: [p(1, 2010), p(6, 2010), p(7, 2010), p(8, 2010)] } }, r.rows);
  assert.match(dupPlayer.error, /už hraje za družstvo/);
  const missing = process({ mode: 'team', email: 'k@b.cz', team: { ...team, name: 'X', players: [p(9, 2010), null] } });
  assert.match(missing.error, /2\. šachovnice/);
  const twice = process({ mode: 'team', email: 'k@b.cz', team: { ...team, name: 'Y', players: [p(9, 2010), p(9, 2010), p(7, 2010), p(8, 2010)] } });
  assert.match(twice.error, /dvakrát/);
});

test('export pro Swiss-Manager: formát řádků jako v exportu ze SM', () => {
  ctx.players = [
    { ...manualPlayer, registered: false, id: 0, title: '', fide: 0, rn: 0, rf: 0, clubNo: 0, status: '' },
    { ...lokPlayer },
    { ...lokPlayer, id: 1517, surname: 'Bažantová', firstName: 'Marie', year: 1963, sex: 'F', title: 'WFM', rn: 1881, rf: 1905, fide: 309354, status: 'A' },
  ];
  const text = gs('toSmText_(buildSmTable_(players, config))');
  const lines = text.split('\r\n');
  assert.equal(lines.length, 5); // hlavička + 3 hráči + prázdný konec
  assert.equal(lines[1], '1;Mikulka Martin Michael;;49382;2126;2192;00.00.2011;CZE;;U15;C;16310;ŠK Spartak Ústí nad Labem;23730803;;;;;;;;;;Mikulka;Martin Michael;');
  assert.equal(lines[2], '2;Bažantová Marie;WFM;1517;1881;1905;00.00.1963;CZE;F;S60;A;16310;ŠK Spartak Ústí nad Labem;309354;;;;;;;;;;Bažantová;Marie;');
  assert.equal(lines[3], '3;Spata Miloš;;;0;0;00.00.1966;CZE;;S60, N;;0;Ústí nad Labem;0;;;;;;;;;;Spata;Miloš;');
  lines.slice(0, 4).forEach((l) => assert.equal(l.split(';').length, 26));
});

test('věkové kategorie podle ročníku festivalu', () => {
  const cat = (y) => gs(`ageCategory_(${y}, config)`);
  assert.equal(cat(2014), 'U12');
  assert.equal(cat(2013), 'U15');
  assert.equal(cat(2008), 'U18');
  assert.equal(cat(2006), 'U20');
  assert.equal(cat(1990), '');
  assert.equal(cat(1966), 'S60');
});
