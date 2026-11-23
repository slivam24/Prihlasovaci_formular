/**
 * Klubová sekce – termínový kalendář ÚKŠS 2026/2027 (data z podklady/klubovy_kalendar_2026_2027.json).
 * Každá soutěž je samostatná akce druhu „klubová sekce“ (přehled klub.html).
 *
 * Jednorázové kroky, spouští se samy při požadavku na backend a poznamenají se do vlastností skriptu:
 *  - SEED_KALENDAR_2026: založení akcí (nová instalace), menu Turnaje → Založit klubový kalendář 2026/2027
 *  - KALENDAR_2026_V2: úprava původní jedné akce (kategorie, uzávěrky 2 dny předem)
 *  - KALENDAR_2026_V3: rozdělení původní jedné akce se všemi soutěžemi na samostatné akce (i s přihláškami)
 */

const SEED_KALENDAR_PROP_ = 'SEED_KALENDAR_2026';
const MIGRATE_KALENDAR_PROP_ = 'KALENDAR_2026_V2';
const SPLIT_KALENDAR_PROP_ = 'KALENDAR_2026_V3';

function onceProp_(prop, fn) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(prop)) return null;
  try {
    const res = fn();
    props.setProperty(prop, new Date().toISOString());
    return res;
  } catch (err) {
    console.error('Jednorázový krok ' + prop + ' se nepovedl', err);
    return null;
  }
}

function maybeSeedClubCalendar_() { return onceProp_(SEED_KALENDAR_PROP_, seedClubCalendar_); }
function maybeMigrateClubCalendar_() { return onceProp_(MIGRATE_KALENDAR_PROP_, migrateClubCalendar_); }
function maybeSplitClubCalendar_() { return onceProp_(SPLIT_KALENDAR_PROP_, splitClubCalendar_); }

function clubOwner_() {
  return table_('users').rows.find((u) => u.role === 'superadmin' && u.active !== 'NE');
}

/** Adresa akce z data a názvu, jedinečná vůči existujícím. */
function clubSlug_(t, taken) {
  const base = (String(t.dateFrom || '').slice(0, 10) + '-' + slugify_(t.name)).slice(0, 60).replace(/-+$/, '');
  let slug = base;
  let i = 2;
  while (taken[slug]) slug = `${base}-${i++}`;
  taken[slug] = true;
  return slug;
}

/** Řádek akce pro jednu soutěž klubového kalendáře. */
function clubEventRow_(t, base, taken, now) {
  return {
    id: makeId_(new Date(), 8), slug: clubSlug_(t, taken), name: t.name, place: t.place || '',
    dateFrom: t.dateFrom, dateTo: t.dateTo || '', deadline: t.deadline || '', status: 'otevreno',
    infoUrl: t.infoUrl || '', intro: '', contactEmail: base.contactEmail || '', admins: base.admins || '',
    extras: base.extras || '[]', issuer: base.issuer || '{}', createdBy: base.createdBy || '', createdAt: now, updatedAt: now,
    kind: 'club', group: EVENT_GROUPS.indexOf(t.group) >= 0 ? t.group : 'ostatni',
  };
}

/** Nová instalace: každá soutěž z dat jako samostatná akce (hromadný zápis). */
function seedClubCalendar_() {
  const owner = clubOwner_();
  if (!owner) return 0;
  const events = loadEvents_();
  if (events.some((e) => e.slug === CLUB_CALENDAR_2026_.slug || e.kind === 'club')) return 0;
  const taken = {};
  events.forEach((e) => { taken[e.slug] = true; });
  const now = new Date().toISOString();
  const base = { extras: JSON.stringify(CLUB_CALENDAR_2026_.extras || []), issuer: '{}', createdBy: String(owner.email).toLowerCase() };
  const evRows = [];
  const tourRows = [];
  CLUB_CALENDAR_2026_.tournaments.forEach((t) => {
    const er = clubEventRow_(t, base, taken, now);
    evRows.push(er);
    tourRows.push(Object.assign({}, clubTournament_(t), { id: makeId_(new Date(), 8), eventId: er.id, order: 1 }));
  });
  insert_('events', evRows);
  insert_('tournaments', tourRows);
  clearPublicCache_();
  return evRows.length;
}

function clubTournament_(t) {
  const out = {};
  ['name', 'short', 'type', 'rating', 'dateFrom', 'dateTo', 'place', 'deadline', 'infoUrl', 'signup', 'note', 'categories',
    'minBirthYear', 'maxBirthYear', 'boards', 'reserves'].forEach((k) => { if (t[k] != null) out[k] = t[k]; });
  out.feeRules = '[]';
  return out;
}

/** Verze 2 (původní jedna akce): kategorie u GP a KP mládeže, uzávěrky 2 dny předem – jen neupravené hodnoty. */
function migrateClubCalendar_() {
  const ev = loadEvents_().find((e) => e.slug === CLUB_CALENDAR_2026_.slug);
  if (!ev) return 0;
  const src = clubSourceIndex_();
  let n = 0;
  table_('tournaments').rows.filter((r) => r.eventId === ev.id).forEach((r) => {
    const from = String(readCell_('dateFrom', r.dateFrom) || '');
    const s = src[r.name + '|' + from];
    if (!s) return;
    let changed = false;
    if (s.categories && !String(r.categories || '').trim()) { r.categories = s.categories; changed = true; }
    const deadline = String(readCell_('deadline', r.deadline) || '');
    if (s.deadline && from && deadline === addDays_(from, -7) && deadline !== s.deadline) { r.deadline = s.deadline; changed = true; }
    if (changed) { update_('tournaments', r); n++; }
  });
  if (n) clearPublicCache_();
  return n;
}

function clubSourceIndex_() {
  const src = {};
  CLUB_CALENDAR_2026_.tournaments.forEach((t) => { src[t.name + '|' + t.dateFrom] = t; });
  return src;
}

/**
 * Verze 3: původní akce se všemi soutěžemi se rozdělí – každá soutěž dostane vlastní akci (klubová sekce),
 * turnaj se do ní přesune i s přihláškami a záznamy změn. Původní akce se pak smaže.
 */
function splitClubCalendar_() {
  const big = loadEvents_().find((e) => e.slug === CLUB_CALENDAR_2026_.slug);
  if (!big) return 0;
  const src = clubSourceIndex_();
  const taken = {};
  loadEvents_().forEach((e) => { if (e.id !== big.id) taken[e.slug] = true; });
  const bigRow = table_('events').rows.find((r) => r.id === big.id);
  const now = new Date().toISOString();
  const base = {
    contactEmail: bigRow.contactEmail, admins: bigRow.admins, extras: bigRow.extras, issuer: bigRow.issuer,
    createdBy: bigRow.createdBy,
  };
  const tours = table_('tournaments').rows.filter((r) => r.eventId === big.id);
  const evRows = [];
  const newEventOf = {};
  tours.forEach((r) => {
    const t = {
      name: String(r.name), place: String(r.place || ''), dateFrom: String(readCell_('dateFrom', r.dateFrom) || big.dateFrom),
      dateTo: String(readCell_('dateTo', r.dateTo) || ''), deadline: String(readCell_('deadline', r.deadline) || ''),
      infoUrl: String(r.infoUrl || ''),
    };
    const s = src[t.name + '|' + t.dateFrom];
    t.group = s ? s.group : 'ostatni';
    const er = clubEventRow_(t, base, taken, now);
    if (big.status !== 'otevreno') er.status = big.status;
    evRows.push(er);
    newEventOf[r.id] = er.id;
  });
  insert_('events', evRows);
  tours.forEach((r) => { r.eventId = newEventOf[r.id]; r.order = 1; update_('tournaments', r); });
  const regEvent = {};
  table_('registrations').rows.filter((r) => r.eventId === big.id).forEach((r) => {
    const target = newEventOf[r.tournamentId];
    if (!target) return;
    r.eventId = target;
    regEvent[r.id] = target;
    regEvent['app:' + r.applicationId] = regEvent['app:' + r.applicationId] || target;
    update_('registrations', r);
  });
  table_('changes').rows.filter((c) => c.eventId === big.id).forEach((c) => {
    const target = regEvent[c.registrationId] || regEvent['app:' + c.applicationId];
    if (!target) return;
    c.eventId = target;
    update_('changes', c);
  });
  remove_('events', table_('events').rows.filter((r) => r.id === big.id));
  Object.keys(DB_CACHE_).forEach((k) => delete DB_CACHE_[k]);
  clearPublicCache_();
  return evRows.length;
}

function createClubCalendar() {
  const n = seedClubCalendar_();
  PropertiesService.getScriptProperties().setProperty(SEED_KALENDAR_PROP_, new Date().toISOString());
  SpreadsheetApp.getUi().alert(n ? `Klubový kalendář založen: ${n} akcí.` : 'Klubová sekce už akce má, nic nového se nezaložilo.');
}

const CLUB_CALENDAR_2026_ = {
 "name": "Termínový kalendář klubu 2026/2027",
 "slug": "kalendar-2026-2027",
 "kind": "club",
 "dateFrom": "2026-06-30",
 "dateTo": "2027-06-27",
 "place": "",
 "intro": "Termínový kalendář ÚKŠS 2026/2027. Na turnaje, kam klub pořádá výpravu, se přihlaste přes tlačítko „Přihlásit se“ – hromadnou přihlášku pak za klub pošle trenér.",
 "tournaments": [
  {
   "name": "Tábor – soustředění Spartak Ústí n. L.",
   "short": "Tábor – soustředění Spartak Ústí n. L.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-06-30",
   "dateTo": "2026-07-11",
   "place": "Doksy – Termit",
   "note": "otevřený pro žáky kraje 2011 a ml.",
   "signup": "none",
   "group": "ostatni"
  },
  {
   "name": "MČR čtyřčlenných družstev",
   "short": "MČR čtyřčlenných družstev",
   "type": "team",
   "rating": "standard",
   "dateFrom": "2026-07-16",
   "dateTo": "2026-07-19",
   "place": "Pardubice",
   "note": "součást festivalu CZECH OPEN",
   "signup": "none",
   "group": "sscr",
   "boards": 4,
   "reserves": 1
  },
  {
   "name": "Otevřené MČR v bughouse („holanďani“)",
   "short": "Otevřené MČR v bughouse („holanďani“)",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-07-18",
   "dateTo": "",
   "place": "Pardubice",
   "note": "součást festivalu CZECH OPEN",
   "signup": "none",
   "group": "sscr"
  },
  {
   "name": "Otevřené MČR v bleskovém maratónu",
   "short": "Otevřené MČR v bleskovém maratónu",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-07-20",
   "dateTo": "2026-07-21",
   "place": "Pardubice",
   "note": "součást festivalu CZECH OPEN",
   "signup": "none",
   "group": "sscr"
  },
  {
   "name": "MČR ve Fischerových šachách",
   "short": "MČR ve Fischerových šachách",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-07-21",
   "dateTo": "",
   "place": "Pardubice",
   "note": "součást festivalu CZECH OPEN",
   "signup": "none",
   "group": "sscr"
  },
  {
   "name": "Otevřené MČR v rapid šachu mužů",
   "short": "Otevřené MČR v rapid šachu mužů",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2026-07-22",
   "dateTo": "2026-07-23",
   "place": "Pardubice",
   "note": "součást festivalu CZECH OPEN",
   "signup": "none",
   "group": "sscr"
  },
  {
   "name": "Czech Open Pardubice – hlavní turnaje",
   "short": "Czech Open Pardubice – hlavní turnaje",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-07-24",
   "dateTo": "2026-08-01",
   "place": "Pardubice",
   "note": "víc turnajů podle výkonnosti",
   "signup": "none",
   "group": "ostatni"
  },
  {
   "name": "Mostecký šachový festival – rapid",
   "short": "Mostecký šachový festival – rapid",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2026-08-08",
   "dateTo": "",
   "place": "Most",
   "note": "",
   "signup": "none",
   "group": "ostatni"
  },
  {
   "name": "Mostecký šachový festival – blesk",
   "short": "Mostecký šachový festival – blesk",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-08-09",
   "dateTo": "",
   "place": "Most",
   "note": "",
   "signup": "none",
   "group": "ostatni"
  },
  {
   "name": "Krajské šachové soustředění",
   "short": "Krajské šachové soustředění",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-08-15",
   "dateTo": "2026-08-23",
   "place": "Tornův mlýn",
   "note": "2009 a mladší, KLT + pozvaní",
   "signup": "none",
   "group": "mladez"
  },
  {
   "name": "MČR seniorů",
   "short": "MČR seniorů",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-08-15",
   "dateTo": "2026-08-23",
   "place": "Olomouc",
   "note": "",
   "signup": "none",
   "group": "sscr"
  },
  {
   "name": "Open Chlumec = KP jednotlivců a žen, HD18+20, S50+65",
   "short": "Open Chlumec = KP jednotlivců a žen, HD1",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-08-26",
   "dateTo": "2026-08-30",
   "place": "Chlumec",
   "note": "",
   "signup": "none",
   "group": "ukss"
  },
  {
   "name": "Libědická šachovnice",
   "short": "Libědická šachovnice",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2026-09-05",
   "dateTo": "",
   "place": "Libědice",
   "note": "",
   "signup": "none",
   "group": "ostatni"
  },
  {
   "name": "MČR v rapid šachu družstev",
   "short": "MČR v rapid šachu družstev",
   "type": "team",
   "rating": "rapid",
   "dateFrom": "2026-09-05",
   "dateTo": "",
   "place": "Bystřice nad Pernštejnem",
   "note": "hotel Skalský Dvůr",
   "signup": "none",
   "group": "sscr",
   "boards": 4,
   "reserves": 1
  },
  {
   "name": "MČR v bleskovém šachu družstev",
   "short": "MČR v bleskovém šachu družstev",
   "type": "team",
   "rating": "standard",
   "dateFrom": "2026-09-06",
   "dateTo": "",
   "place": "Bystřice nad Pernštejnem",
   "note": "hotel Skalský Dvůr",
   "signup": "none",
   "group": "sscr",
   "boards": 4,
   "reserves": 1
  },
  {
   "name": "Memoriál Petra Ráliše – 3. ročník",
   "short": "Memoriál Petra Ráliše",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2026-09-12",
   "dateTo": "",
   "place": "Podbořany",
   "note": "",
   "signup": "none",
   "group": "ostatni"
  },
  {
   "name": "MČR juniorů a juniorek v rapid šachu",
   "short": "MČR juniorů a juniorek v rapid šachu",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2026-09-12",
   "dateTo": "2026-09-13",
   "place": "Česká Třebová",
   "note": "kategorie 2006, 2008 a 2010 a ml.; v kalendáři 12. i 13. 9.",
   "signup": "none",
   "group": "sscrm"
  },
  {
   "name": "MČR mládeže v rapid šachu",
   "short": "MČR mládeže v rapid šachu",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2026-09-12",
   "dateTo": "2026-09-13",
   "place": "Česká Třebová",
   "note": "kategorie 2012, 2014 a 2016 a ml.; v kalendáři 12. i 13. 9.",
   "signup": "none",
   "group": "sscrm"
  },
  {
   "name": "Kvalifikační turnaj mládeže o účast na ZODM",
   "short": "Kvalifikační turnaj mládeže o účast na Z",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-09-19",
   "dateTo": "",
   "place": "konkurz",
   "note": "kat. 2011, 2013, 2015 a ml., D 2011 a ml.; místo neurčeno",
   "signup": "none",
   "group": "mladez"
  },
  {
   "name": "Srbický rapid – 9. ročník",
   "short": "Srbický rapid",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2026-09-19",
   "dateTo": "",
   "place": "Srbice",
   "note": "",
   "signup": "none",
   "group": "ostatni"
  },
  {
   "name": "Krajský tréninkový kemp mládeže",
   "short": "Krajský tréninkový kemp mládeže",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-09-25",
   "dateTo": "2026-09-28",
   "place": "Svor",
   "note": "",
   "signup": "none",
   "group": "mladez"
  },
  {
   "name": "Extraliga mládeže a 1. liga mládeže – 1. termín",
   "short": "EL mládeže 1.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-10-03",
   "dateTo": "2026-10-04",
   "place": "dle skupin",
   "note": "",
   "signup": "league",
   "group": "sscrm"
  },
  {
   "name": "1. turnaj GP Ústeckého kraje",
   "short": "1. turnaj GP Ústeckého kraje",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2026-10-10",
   "dateTo": "",
   "place": "Chomutov",
   "note": "kategorie 2008, 2012 a 2016 a ml.",
   "signup": "none",
   "group": "mladez",
   "categories": "2016, 2012, 2008"
  },
  {
   "name": "2. liga – 1. kolo",
   "short": "2. liga 1. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-10-11",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor II – 1. kolo",
   "short": "KP II 1. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-10-11",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "VC Mostu – turnaj čtyřčlenných družstev",
   "short": "VC Mostu – družstva",
   "type": "team",
   "rating": "standard",
   "dateFrom": "2026-10-17",
   "dateTo": "",
   "place": "Most",
   "note": "1. turnaj seriálu podzimních VC, 2011 a ml.",
   "signup": "none",
   "group": "mladez",
   "boards": 4,
   "reserves": 1
  },
  {
   "name": "1. liga – 1. kolo",
   "short": "1. liga 1. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-10-18",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor I a III – 1. kolo",
   "short": "KP I a III 1. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-10-18",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "Mistrovství Čech mládeže HD12–HD16",
   "short": "M Čech mládeže HD12–HD16",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-10-24",
   "dateTo": "2026-10-31",
   "place": "Harrachov",
   "note": "kategorie 2011, 2013 a 2015 a ml.; podzimní prázdniny",
   "signup": "none",
   "group": "sscrm"
  },
  {
   "name": "Chomutovský král – podzimní (13. ročník)",
   "short": "Chomutovský král – podzimní (13. ročník)",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2026-10-28",
   "dateTo": "",
   "place": "Chomutov",
   "note": "termín jen navržený („obvyklý termín“)",
   "signup": "none",
   "group": "ostatni"
  },
  {
   "name": "Extraliga – 1. kolo",
   "short": "Extraliga 1. kolo",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-10-31",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "2. liga – 2. kolo",
   "short": "2. liga 2. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-11-01",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Extraliga – 2. kolo",
   "short": "Extraliga 2. kolo",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-11-01",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor II – 2. kolo",
   "short": "KP II 2. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-11-01",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "Okresní kola přeboru škol",
   "short": "Okresní kola přeboru škol",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-11-04",
   "dateTo": "2026-11-18",
   "place": "po bývalých okresech",
   "note": "Chomutov 4. 11., okres Litoměřice ve Štětí 18. 11.; jinak dle okresů",
   "signup": "none",
   "group": "mladez"
  },
  {
   "name": "VC Teplic – turnaj čtyřčlenných družstev",
   "short": "VC Teplic – družstva",
   "type": "team",
   "rating": "standard",
   "dateFrom": "2026-11-07",
   "dateTo": "",
   "place": "Teplice",
   "note": "2. turnaj seriálu podzimních VC, 2011 a ml.",
   "signup": "none",
   "group": "mladez",
   "boards": 4,
   "reserves": 1
  },
  {
   "name": "1. liga – 2. kolo",
   "short": "1. liga 2. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-11-08",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor I a III – 2. kolo",
   "short": "KP I a III 2. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-11-08",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "Mistrovství Čech HD8–HD10",
   "short": "M Čech HD8–HD10",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-11-11",
   "dateTo": "2026-11-15",
   "place": "Most",
   "note": "kategorie 2017 a 2019 a ml.",
   "signup": "none",
   "group": "sscrm"
  },
  {
   "name": "Polofinále MČR juniorek a dorostenek",
   "short": "Polofinále MČR juniorek a dorostenek",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-11-14",
   "dateTo": "2026-11-21",
   "place": "konkurz",
   "note": "kategorie 2007 a 2009 a ml.; místo neurčeno",
   "signup": "none",
   "group": "sscrm"
  },
  {
   "name": "Polofinále MČR juniorů a dorostenců",
   "short": "Polofinále MČR juniorů a dorostenců",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-11-14",
   "dateTo": "2026-11-21",
   "place": "konkurz",
   "note": "kategorie 2007 a 2009 a ml.; místo neurčeno",
   "signup": "none",
   "group": "sscrm"
  },
  {
   "name": "2. liga – 3. kolo",
   "short": "2. liga 3. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-11-15",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor II – 3. kolo",
   "short": "KP II 3. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-11-15",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "2. turnaj GP Ústeckého kraje",
   "short": "2. turnaj GP Ústeckého kraje",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2026-11-21",
   "dateTo": "",
   "place": "Litoměřice",
   "note": "kategorie 2008, 2012 a 2016 a ml.",
   "signup": "none",
   "group": "mladez",
   "categories": "2016, 2012, 2008"
  },
  {
   "name": "1. liga – 3. kolo",
   "short": "1. liga 3. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-11-22",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor I a III – 3. kolo",
   "short": "KP I a III 3. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-11-22",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "VC Ústí – turnaj čtyřčlenných družstev",
   "short": "VC Ústí – družstva",
   "type": "team",
   "rating": "standard",
   "dateFrom": "2026-11-28",
   "dateTo": "",
   "place": "Chlumec",
   "note": "3. turnaj seriálu podzimních VC, 2011 a ml., závěr",
   "signup": "open",
   "group": "mladez",
   "boards": 4,
   "reserves": 1,
   "minBirthYear": 2011,
   "deadline": "2026-11-26"
  },
  {
   "name": "2. liga – 4. kolo",
   "short": "2. liga 4. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-11-29",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor II – 4. kolo",
   "short": "KP II 4. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-11-29",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "Extraliga mládeže a 1. liga mládeže – 2. termín",
   "short": "EL mládeže 2.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-12-05",
   "dateTo": "",
   "place": "dle skupin",
   "note": "",
   "signup": "league",
   "group": "sscrm"
  },
  {
   "name": "1. liga – 4. kolo",
   "short": "1. liga 4. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-12-06",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor I a III – 4. kolo",
   "short": "KP I a III 4. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-12-06",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "Vánoční šachovnice",
   "short": "Vánoční šachovnice",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2026-12-12",
   "dateTo": "",
   "place": "Štětí",
   "note": "",
   "signup": "none",
   "group": "ostatni"
  },
  {
   "name": "Extraliga – 3. kolo",
   "short": "Extraliga 3. kolo",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-12-12",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "2. liga – 5. kolo",
   "short": "2. liga 5. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-12-13",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Extraliga – 4. kolo",
   "short": "Extraliga 4. kolo",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-12-13",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor II – 5. kolo",
   "short": "KP II 5. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-12-13",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "Memoriál Rudolfa Kotlana – 14. ročník",
   "short": "Memoriál Rudolfa Kotlana",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2026-12-19",
   "dateTo": "",
   "place": "Opočno u Loun",
   "note": "",
   "signup": "none",
   "group": "ostatni"
  },
  {
   "name": "MČR jednotlivců v bleskovém šachu a ples",
   "short": "MČR jednotlivců v bleskovém šachu a ples",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2026-12-19",
   "dateTo": "",
   "place": "neurčeno",
   "note": "místo zatím neurčeno",
   "signup": "none",
   "group": "sscr"
  },
  {
   "name": "Vánoční Teplice – turnaj dětí a mládeže",
   "short": "Vánoční Teplice – turnaj dětí a mládeže",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2026-12-28",
   "dateTo": "",
   "place": "Teplice",
   "note": "",
   "signup": "none",
   "group": "ostatni"
  },
  {
   "name": "Extraliga mládeže a 1. liga mládeže – 3. termín",
   "short": "EL mládeže 3.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-01-09",
   "dateTo": "",
   "place": "dle skupin",
   "note": "",
   "signup": "league",
   "group": "sscrm"
  },
  {
   "name": "1. liga – 5. kolo",
   "short": "1. liga 5. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-01-10",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor I a III – 5. kolo",
   "short": "KP I a III 5. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-01-10",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "Krajské kolo přeboru škol",
   "short": "Krajské kolo přeboru škol",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-01-14",
   "dateTo": "",
   "place": "Chlumec (předb.)",
   "note": "",
   "signup": "none",
   "group": "mladez"
  },
  {
   "name": "3. turnaj GP Ústeckého kraje",
   "short": "3. turnaj GP Ústeckého kraje",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2027-01-16",
   "dateTo": "",
   "place": "Štětí",
   "note": "kategorie 2008, 2012 a 2016 a ml.",
   "signup": "open",
   "group": "mladez",
   "minBirthYear": 2008,
   "deadline": "2027-01-14",
   "categories": "2016, 2012, 2008"
  },
  {
   "name": "Extraliga – 5. kolo",
   "short": "Extraliga 5. kolo",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-01-16",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "2. liga – 6. kolo",
   "short": "2. liga 6. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-01-17",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Extraliga – 6. kolo",
   "short": "Extraliga 6. kolo",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-01-17",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor II – 6. kolo",
   "short": "KP II 6. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-01-17",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "Krajský přebor družstev starších žáků – 1. termín",
   "short": "KP družstev starších žáků – 1. termín",
   "type": "team",
   "rating": "standard",
   "dateFrom": "2027-01-23",
   "dateTo": "",
   "place": "dle rozpisu",
   "note": "kategorie 2011 a 2014 a ml.; 2. termín 2. nebo 8. 5.",
   "signup": "none",
   "group": "mladez",
   "boards": 4,
   "reserves": 1
  },
  {
   "name": "Zimní olympiáda dětí a mládeže",
   "short": "Zimní olympiáda dětí a mládeže",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-01-24",
   "dateTo": "2027-01-28",
   "place": "Sušice",
   "note": "výběr kraje (kvalifikace 19. 9.)",
   "signup": "none",
   "group": "sscrm"
  },
  {
   "name": "1. liga – 6. kolo",
   "short": "1. liga 6. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-01-24",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor I a III – 6. kolo",
   "short": "KP I a III 6. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-01-24",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "Krajský tréninkový kemp mládeže",
   "short": "Krajský tréninkový kemp mládeže",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-01-29",
   "dateTo": "2027-01-30",
   "place": "Ústí nad Labem",
   "note": "",
   "signup": "none",
   "group": "mladez"
  },
  {
   "name": "2. liga – 7. kolo",
   "short": "2. liga 7. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-01-31",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor II – 7. kolo",
   "short": "KP II 7. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-01-31",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "1. liga – 7. kolo",
   "short": "1. liga 7. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-02-07",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor I a III – 7. kolo",
   "short": "KP I a III 7. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-02-07",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "2. liga – 8. kolo",
   "short": "2. liga 8. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-02-14",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor II – 8. kolo",
   "short": "KP II 8. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-02-14",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "Pražský šachový festival",
   "short": "Pražský šachový festival",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-02-16",
   "dateTo": "2027-02-26",
   "place": "Praha",
   "note": "",
   "signup": "none",
   "group": "ostatni"
  },
  {
   "name": "1. liga – 8. kolo",
   "short": "1. liga 8. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-02-21",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor I a III – 8. kolo",
   "short": "KP I a III 8. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-02-21",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "4. turnaj GP Ústeckého kraje",
   "short": "4. turnaj GP Ústeckého kraje",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2027-02-27",
   "dateTo": "",
   "place": "Most",
   "note": "kategorie 2008, 2012 a 2016 a ml.",
   "signup": "open",
   "group": "mladez",
   "minBirthYear": 2008,
   "deadline": "2027-02-25",
   "categories": "2016, 2012, 2008"
  },
  {
   "name": "2. liga – 9. kolo",
   "short": "2. liga 9. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-02-28",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor II – 9. kolo",
   "short": "KP II 9. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-02-28",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "Krajský přebor v bleskovém šachu družstev",
   "short": "KP v bleskovém šachu družstev",
   "type": "team",
   "rating": "standard",
   "dateFrom": "2027-03-06",
   "dateTo": "",
   "place": "konkurz",
   "note": "místo zatím neurčeno",
   "signup": "none",
   "group": "ukss",
   "boards": 4,
   "reserves": 1
  },
  {
   "name": "Mistrovství ČR HD10–HD16",
   "short": "M ČR HD10–HD16",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-03-06",
   "dateTo": "2027-03-13",
   "place": "neurčeno",
   "note": "místo neurčeno",
   "signup": "none",
   "group": "sscrm"
  },
  {
   "name": "Mistrovství ČR HD18–HD20",
   "short": "M ČR HD18–HD20",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-03-06",
   "dateTo": "2027-03-13",
   "place": "neurčeno",
   "note": "místo neurčeno",
   "signup": "none",
   "group": "sscrm"
  },
  {
   "name": "1. liga – 9. kolo",
   "short": "1. liga 9. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-03-14",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor I a III – 9. kolo",
   "short": "KP I a III 9. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-03-14",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "Krajský přebor družstev mladších žáků",
   "short": "KP družstev mladších žáků",
   "type": "team",
   "rating": "standard",
   "dateFrom": "2027-03-20",
   "dateTo": "",
   "place": "Litoměřice nebo konkurz",
   "note": "",
   "signup": "none",
   "group": "mladez",
   "boards": 4,
   "reserves": 1
  },
  {
   "name": "Krajský přebor družstev v rapid šachu",
   "short": "KP družstev v rapid šachu",
   "type": "team",
   "rating": "rapid",
   "dateFrom": "2027-03-20",
   "dateTo": "",
   "place": "Litoměřice nebo konkurz",
   "note": "",
   "signup": "none",
   "group": "ukss",
   "boards": 4,
   "reserves": 1
  },
  {
   "name": "Extraliga – 7. kolo",
   "short": "Extraliga 7. kolo",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-03-20",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "2. liga – 10. kolo",
   "short": "2. liga 10. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-03-21",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Extraliga – 8. kolo",
   "short": "Extraliga 8. kolo",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-03-21",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor II – 10. kolo",
   "short": "KP II 10. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-03-21",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "Velikonoční Teplice – turnaj dětí a mládeže",
   "short": "Velikonoční Teplice – turnaj dětí a mlád",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2027-03-25",
   "dateTo": "",
   "place": "Teplice",
   "note": "prázdninový čtvrtek před Velikonocemi",
   "signup": "none",
   "group": "ostatni"
  },
  {
   "name": "Velikonoční turnaj",
   "short": "Velikonoční turnaj",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2027-03-26",
   "dateTo": "",
   "place": "Štětí",
   "note": "",
   "signup": "none",
   "group": "ostatni"
  },
  {
   "name": "5. turnaj GP Ústeckého kraje",
   "short": "5. turnaj GP Ústeckého kraje",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2027-04-03",
   "dateTo": "",
   "place": "Teplice",
   "note": "kategorie 2008, 2012 a 2016 a ml.",
   "signup": "open",
   "group": "mladez",
   "minBirthYear": 2008,
   "deadline": "2027-04-01",
   "categories": "2016, 2012, 2008"
  },
  {
   "name": "MČR do 8 let",
   "short": "MČR do 8 let",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-04-03",
   "dateTo": "2027-04-04",
   "place": "konkurz",
   "note": "místo neurčeno",
   "signup": "none",
   "group": "sscrm"
  },
  {
   "name": "1. liga – 10. kolo",
   "short": "1. liga 10. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-04-04",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor I a III – 10. kolo",
   "short": "KP I a III 10. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-04-04",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "Extraliga – 9.–11. kolo",
   "short": "Extraliga 9.–11. kolo",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-04-09",
   "dateTo": "2027-04-11",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor v rapid šachu HD8–HD20",
   "short": "KP v rapid šachu HD8–HD20",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2027-04-10",
   "dateTo": "",
   "place": "Děčín (zájem)",
   "note": "kat. 2007 a ml., postupové jen 2013 a ml.",
   "signup": "open",
   "group": "mladez",
   "minBirthYear": 2007,
   "deadline": "2027-04-08"
  },
  {
   "name": "2. liga – 11. kolo",
   "short": "2. liga 11. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-04-11",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor II – 11. kolo",
   "short": "KP II 11. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-04-11",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "6. turnaj GP Ústeckého kraje + celkové vyhodnocení GP",
   "short": "6. turnaj GP Ústeckého kraje + celkové v",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2027-04-17",
   "dateTo": "",
   "place": "Chomutov",
   "note": "kategorie 2008, 2012 a 2016 a ml.",
   "signup": "open",
   "group": "mladez",
   "minBirthYear": 2008,
   "deadline": "2027-04-15",
   "categories": "2016, 2012, 2008"
  },
  {
   "name": "1. liga – 11. kolo",
   "short": "1. liga 11. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-04-18",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "sscr"
  },
  {
   "name": "Krajský přebor I a III – 11. kolo",
   "short": "KP I a III 11. k.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-04-18",
   "dateTo": "",
   "place": "",
   "note": "",
   "signup": "league",
   "group": "ukss"
  },
  {
   "name": "Extraliga mládeže a 1. liga mládeže – 4. termín",
   "short": "EL mládeže 4.",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-04-23",
   "dateTo": "2027-04-25",
   "place": "dle skupin",
   "note": "",
   "signup": "league",
   "group": "sscrm"
  },
  {
   "name": "Chomutovský král – jarní (13. ročník)",
   "short": "Chomutovský král – jarní (13. ročník)",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2027-05-01",
   "dateTo": "",
   "place": "Chomutov",
   "note": "termín jen navržený („obvyklý termín“)",
   "signup": "none",
   "group": "ostatni"
  },
  {
   "name": "Krajský přebor družstev starších žáků – 2. termín",
   "short": "KP družstev starších žáků – 2. termín",
   "type": "team",
   "rating": "standard",
   "dateFrom": "2027-05-02",
   "dateTo": "",
   "place": "dle rozpisu",
   "note": "kategorie 2011 a 2014 a ml.; termín 2. nebo 8. 5.",
   "signup": "none",
   "group": "mladez",
   "boards": 4,
   "reserves": 1
  },
  {
   "name": "Grand Prix ČR 2026/2027 v rapid šachu",
   "short": "Grand Prix ČR 2026/2027 v rapid šachu",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2027-05-08",
   "dateTo": "",
   "place": "Chlumec",
   "note": "",
   "signup": "none",
   "group": "ostatni"
  },
  {
   "name": "KP jednotlivců, žen, H+D 16, 18, 20 v blesku",
   "short": "KP jednotlivců, žen, H+D 16, 18, 20 v bl",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-05-09",
   "dateTo": "",
   "place": "Chlumec",
   "note": "",
   "signup": "none",
   "group": "ukss"
  },
  {
   "name": "36. ročník Memoriálu Antonína Drvoty",
   "short": "36. ročník Memoriálu Antonína Drvoty",
   "type": "individual",
   "rating": "rapid",
   "dateFrom": "2027-05-15",
   "dateTo": "",
   "place": "Teplice",
   "note": "uchází se o status krajského přeboru",
   "signup": "none",
   "group": "ukss"
  },
  {
   "name": "Krajský přebor mládeže HD10–HD16",
   "short": "KP mládeže HD10–HD16",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-05-22",
   "dateTo": "2027-05-23",
   "place": "Chomutov",
   "note": "kategorie 2012, 2014, 2016 a 2018 a ml.",
   "signup": "open",
   "group": "mladez",
   "minBirthYear": 2012,
   "deadline": "2027-05-20",
   "categories": "2018, 2016, 2014, 2012"
  },
  {
   "name": "MČR družstev starších žáků",
   "short": "MČR družstev starších žáků",
   "type": "team",
   "rating": "standard",
   "dateFrom": "2027-05-29",
   "dateTo": "2027-05-30",
   "place": "neurčeno",
   "note": "místo neurčeno",
   "signup": "none",
   "group": "sscrm",
   "boards": 4,
   "reserves": 1
  },
  {
   "name": "Krajský tréninkový kemp mládeže",
   "short": "Krajský tréninkový kemp mládeže",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-06-04",
   "dateTo": "2027-06-06",
   "place": "neurčeno",
   "note": "",
   "signup": "none",
   "group": "mladez"
  },
  {
   "name": "MČR družstev mladších žáků",
   "short": "MČR družstev mladších žáků",
   "type": "team",
   "rating": "standard",
   "dateFrom": "2027-06-11",
   "dateTo": "2027-06-13",
   "place": "neurčeno",
   "note": "místo neurčeno",
   "signup": "none",
   "group": "sscrm",
   "boards": 4,
   "reserves": 1
  },
  {
   "name": "TEPLICE OPEN – 20. ročník",
   "short": "TEPLICE OPEN",
   "type": "individual",
   "rating": "standard",
   "dateFrom": "2027-06-19",
   "dateTo": "2027-06-27",
   "place": "Teplice (předb.)",
   "note": "mezinárodní FIDE turnaj",
   "signup": "none",
   "group": "ostatni"
  }
 ],
 "extras": [
  {
   "label": "Poznámka",
   "type": "textarea",
   "options": [],
   "help": "Např. doprava, kdo dítě doprovází.",
   "modes": [
    "individual",
    "team"
   ]
  }
 ]
};
