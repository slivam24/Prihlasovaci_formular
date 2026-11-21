// Testy čistých funkcí backendu (apps-script/Code.gs) – bez služeb Googlu.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'), ctx);
const run = (code, vars) => {
  Object.assign(ctx, vars || {});
  // výsledek převedeme přes JSON, aby se pole a objekty daly porovnávat mimo vm
  const out = vm.runInContext(`JSON.stringify((() => { try { return { v: ${code} }; } catch (e) { return { err: e.message }; } })())`, ctx);
  const parsed = JSON.parse(out);
  if ('err' in parsed) throw new Error(parsed.err);
  return parsed.v;
};

// Ukázková akce Chlumec jako testovací data (s doplněnými ID turnajů).
const clean = run('sanitizeEvent_(SAMPLE_EVENT_, [], null)');
const event = Object.assign({ id: 'EV1', admins: [], createdBy: 'a@b.cz' }, clean.event, {
  status: 'otevreno',
  deadline: '',
  tournaments: clean.tournaments.map((t, i) => Object.assign({}, t, { id: 'T' + (i + 1) })),
});
const T = Object.fromEntries(event.tournaments.map((t) => [t.short, t.id]));
const now = new Date('2026-04-10T10:00:00');

const register = (data, existing = [], opts = {}) =>
  run('processRegistration_(data, ev, existing, now, opts)', { data, ev: event, existing, now, opts });

const lokPlayer = {
  registered: true, id: 49382, surname: 'Mikulka', firstName: 'Martin Michael', year: 2011, sex: '',
  title: '', fide: 23730803, fed: 'CZE', rn: 2126, rf: 2192, clubNo: 16310, club: 'ŠK Spartak Ústí nad Labem', status: 'C',
};
const manualPlayer = { registered: false, surname: 'Spata', firstName: 'Miloš', year: 1966, club: 'Ústí nad Labem' };

test('ukázková akce projde validací', () => {
  assert.equal(clean.event.slug, 'chlumec-2026');
  assert.equal(clean.tournaments.length, 6);
  assert.equal(clean.tournaments[5].type, 'team');
  assert.equal(clean.tournaments[5].boards, 4);
  assert.equal(clean.tournaments[0].boards, null);
  assert.deepEqual(clean.event.extras.map((x) => x.id), ['doprava', 'ubytovani', 'sdeleni', 'poznamka']);
});

test('validace akce: povinné údaje a jedinečná adresa', () => {
  const base = { name: 'Turnaj', dateFrom: '2027-01-10', tournaments: [{ name: 'Rapid' }] };
  assert.throws(() => run('sanitizeEvent_(i, [], null)', { i: { ...base, name: '' } }), /název akce/);
  assert.throws(() => run('sanitizeEvent_(i, [], null)', { i: { ...base, dateFrom: '10.1.2027' } }), /datum začátku/);
  assert.throws(() => run('sanitizeEvent_(i, [], null)', { i: { ...base, tournaments: [] } }), /alespoň jeden turnaj/);
  assert.throws(() => run('sanitizeEvent_(i, [], null)', { i: { ...base, extras: [{ label: 'Strava', type: 'select', options: [] }] } }), /možnosti/);
  const existing = [{ id: 'X', slug: 'turnaj' }];
  assert.equal(run('sanitizeEvent_(i, ex, null).event.slug', { i: base, ex: existing }), 'turnaj-2');
  assert.equal(run('sanitizeEvent_(i, ex, "X").event.slug', { i: base, ex: existing }), 'turnaj');
  assert.throws(() => run('sanitizeEvent_(i, ex, null)', { i: { ...base, slug: 'turnaj' }, ex: existing }), /už patří jiné akci/);
  assert.equal(run('slugify_("Přebor Ústeckého kraje 2027")'), 'prebor-usteckeho-kraje-2027');
});

test('přihláška jednotlivce: řádek za každý turnaj, doplňky jako JSON', () => {
  const r = register({
    mode: 'individual', email: 'hrac@example.cz', player: lokPlayer, tournaments: [T['Open rapid'], T['Blesk'], 'XXX'],
    extras: { doprava: ['sobota zpět', 'podvrh'], ubytovani: '2lůžkový pokoj', sdeleni: 'spolu s tátou' },
  });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows.map((x) => x.tournamentId), [T['Open rapid'], T['Blesk']]);
  assert.equal(r.rows[0].applicationId, r.rows[1].applicationId);
  assert.notEqual(r.rows[0].id, r.rows[1].id);
  assert.equal(r.rows[0].inLok, 'ANO');
  assert.equal(r.rows[0].sk, 'C');
  assert.deepEqual(JSON.parse(r.rows[0].extras), { doprava: ['sobota zpět'], ubytovani: '2lůžkový pokoj', sdeleni: 'spolu s tátou', poznamka: '' });
});

test('věk se vynucuje, ELO jen upozorňuje (projde)', () => {
  const r = register({ mode: 'individual', email: 'a@b.cz', player: lokPlayer, tournaments: [T['Mladší žáci']] });
  assert.match(r.error, /2014 a mladší/);
  const r2 = register({ mode: 'individual', email: 'a@b.cz', player: { ...lokPlayer, id: 1, year: 2014 }, tournaments: [T['Neregistrovaní']] });
  assert.match(r2.error, /2013 a starší/);
  assert.equal(register({ mode: 'individual', email: 'a@b.cz', player: lokPlayer, tournaments: [T['Neregistrovaní']] }).ok, true);
});

test('pořadatel smí přidat i mimo podmínky a po uzávěrce', () => {
  const closedEv = { ...event, status: 'uzavreno' };
  const r = run('processRegistration_(data, ev, [], now, { admin: true, adminEmail: "org@x.cz" })', {
    data: { mode: 'individual', email: '', player: lokPlayer, tournaments: [T['Mladší žáci']] }, ev: closedEv, now,
  });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.rows[0].updatedBy, 'org@x.cz');
});

test('uzavřená akce a uzávěrka', () => {
  const data = { mode: 'individual', email: 'a@b.cz', player: lokPlayer, tournaments: [T['Open rapid']] };
  for (const ev of [{ ...event, status: 'uzavreno' }, { ...event, status: 'koncept' }, { ...event, deadline: '2026-04-09' }]) {
    assert.match(run('processRegistration_(data, ev, [], now, {})', { data, ev, now }).error, /uzavřeno/);
  }
  assert.equal(run('processRegistration_(data, ev, [], now, {})', { data, ev: { ...event, deadline: '2026-04-10' }, now }).ok, true);
});

test('duplicita a kapacita; zrušená přihláška se nepočítá', () => {
  const data = { mode: 'individual', email: 'a@b.cz', player: lokPlayer, tournaments: [T['Open rapid']] };
  const first = register(data);
  assert.match(register(data, first.rows).error, /už přihlášen/);
  assert.equal(register(data, first.rows.map((r) => ({ ...r, status: 'zrušeno' }))).ok, true);
  const full = run('processRegistration_(data, ev, existing, now, {})', {
    data: { ...data, player: { ...lokPlayer, id: 2 } }, existing: first.rows, now,
    ev: { ...event, tournaments: event.tournaments.map((t) => (t.id === T['Open rapid'] ? { ...t, capacity: 1 } : t)) },
  });
  assert.match(full.error, /naplněn/);
});

test('ruční hráč nemůže podstrčit rating ani ID', () => {
  const r = register({ mode: 'individual', email: 'a@b.cz', player: { ...manualPlayer, rn: 2500, id: 7 }, tournaments: [T['Veteráni']] });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.rows[0].rn, '');
  assert.equal(r.rows[0].idCr, '');
  assert.equal(r.rows[0].inLok, 'NE');
});

test('chybějící údaje a past na roboty', () => {
  assert.equal(register({ mode: 'individual', email: 'spatne', player: lokPlayer, tournaments: [T['Open rapid']] }).ok, false);
  assert.equal(register({ mode: 'individual', email: 'a@b.cz', player: null, tournaments: [T['Open rapid']] }).ok, false);
  assert.equal(register({ mode: 'individual', email: 'a@b.cz', player: lokPlayer, tournaments: [] }).ok, false);
  assert.equal(register({ mode: 'individual', email: 'a@b.cz', player: { ...manualPlayer, club: '' }, tournaments: [T['Open rapid']] }).ok, false);
  assert.equal(register({ mode: 'individual', email: 'a@b.cz', player: lokPlayer, tournaments: [T['Open rapid']], web: 'spam' }).ok, false);
});

test('družstvo: jedna přihláška, řádek za každého hráče', () => {
  const p = (id, year) => ({ ...lokPlayer, id, year, surname: 'Hráč' + id });
  const team = { tournamentId: T['Družstva'], name: 'Spartak A', captain: 'Jan Novák', players: [p(1, 2010), p(2, 2011), p(3, 2012), p(4, 2013), null] };
  const r = register({ mode: 'team', email: 'k@b.cz', team, extras: { doprava: ['sobota tam'], poznamka: 'ok' } });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.rows.map((x) => x.board), [1, 2, 3, 4]);
  assert.equal(r.rows[0].team, 'Spartak A');
  assert.equal(r.rows[0].captain, 'Jan Novák');
  assert.deepEqual(JSON.parse(r.rows[0].extras), { sdeleni: '', poznamka: 'ok' }, 'doprava není u družstev v nabídce');

  const other = [p(5, 2010), p(6, 2010), p(7, 2010), p(8, 2010)];
  assert.match(register({ mode: 'team', email: 'k@b.cz', team: { ...team, players: other } }, r.rows).error, /už je přihlášeno/);
  assert.match(register({ mode: 'team', email: 'k@b.cz', team: { ...team, name: 'B', players: [p(1, 2010)].concat(other.slice(1)) } }, r.rows).error, /už hraje za družstvo/);
  assert.match(register({ mode: 'team', email: 'k@b.cz', team: { ...team, name: 'C', players: [p(9, 2010), null] } }).error, /2\. šachovnice/);
  assert.match(register({ mode: 'team', email: 'k@b.cz', team: { ...team, name: 'D', players: [p(9, 2010), p(9, 2010), p(7, 2010), p(8, 2010)] } }).error, /dvakrát/);
});

test('veřejný seznam neobsahuje e-maily a zrušené', () => {
  const a = register({ mode: 'individual', email: 'tajny@example.cz', player: lokPlayer, tournaments: [T['Open rapid']] });
  const b = register({ mode: 'individual', email: 'x@example.cz', player: { ...manualPlayer }, tournaments: [T['Open rapid']] });
  const list = run('buildPublicList_(ev, regs)', { ev: event, regs: a.rows.concat(b.rows) });
  assert.equal(list.tournaments[T['Open rapid']].length, 2);
  assert.equal(list.tournaments[T['Open rapid']][0].name, 'Mikulka Martin Michael', 'seřazeno podle ratingu');
  assert.ok(!JSON.stringify(list).includes('tajny@'));
  assert.ok(!('admins' in list.event));
});

test('výprava: více hráčů v jedné přihlášce, každý se svými turnaji', () => {
  const p = (id, year, surname) => ({ ...lokPlayer, id, year, surname: surname || 'Hráč' + id });
  const r = register({
    mode: 'individual', email: 'vedouci@klub.cz',
    players: [
      { player: p(1, 1990), tournaments: [T['Open rapid'], T['Blesk']] },
      { player: p(2, 2015), tournaments: [T['Open rapid'], T['Mladší žáci']] },
      { player: { ...manualPlayer }, tournaments: [T['Veteráni']] },
    ],
    extras: { doprava: ['sobota tam'] },
  });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.rows.length, 5);
  assert.equal(new Set(r.rows.map((x) => x.applicationId)).size, 1, 'jedna přihláška');
  assert.ok(r.rows.every((x) => x.email === 'vedouci@klub.cz'));
  assert.deepEqual(r.summary.entries.map((e) => e.tournaments.length), [2, 2, 1]);

  // chyby jsou u konkrétního hráče
  const bad = (players) => register({ mode: 'individual', email: 'v@k.cz', players });
  assert.match(bad([{ player: p(1, 1990), tournaments: [T['Blesk']] }, { player: null, tournaments: [T['Blesk']] }]).error, /^2\. hráč:/);
  assert.match(bad([{ player: p(1, 1990), tournaments: [T['Blesk']] }, { player: p(2, 1990, 'Bez'), tournaments: [] }]).error, /Bez Jan|Bez .*vyberte alespoň jeden turnaj/);
  assert.match(bad([{ player: p(1, 1990), tournaments: [T['Blesk']] }, { player: p(1, 1990), tournaments: [T['Rapid'] || T['Open rapid']] }]).error, /dvakrát/);
  assert.match(bad([{ player: p(1, 1990), tournaments: [T['Mladší žáci']] }]).error, /2014 a mladší/);
  // duplicita proti už přihlášeným
  assert.match(register({ mode: 'individual', email: 'v@k.cz', players: [{ player: p(1, 1990), tournaments: [T['Blesk']] }] }, r.rows).error, /už přihlášen/);
});

test('výprava: kapacita se počítá včetně hráčů z téže přihlášky', () => {
  const ev2 = { ...event, tournaments: event.tournaments.map((t) => (t.id === T['Blesk'] ? { ...t, capacity: 2 } : t)) };
  const p = (id) => ({ ...lokPlayer, id, year: 1990, surname: 'H' + id });
  const res = run('processRegistration_(data, ev, [], now, {})', {
    ev: ev2, now,
    data: { mode: 'individual', email: 'v@k.cz', players: [1, 2, 3].map((id) => ({ player: p(id), tournaments: [T['Blesk']] })) },
  });
  assert.match(res.error, /naplněn.*volných míst: 2/);
  const ok = run('processRegistration_(data, ev, [], now, {})', {
    ev: ev2, now,
    data: { mode: 'individual', email: 'v@k.cz', players: [1, 2].map((id) => ({ player: p(id), tournaments: [T['Blesk']] })) },
  });
  assert.equal(ok.ok, true, ok.error);
});
