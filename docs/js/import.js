/* Import akce z JSONu, který připraví AI (ChatGPT, Claude…) z propozic.
 * Obsahuje zadání pro AI a převod/kontrolu odpovědi. Funguje v prohlížeči (window.EventImport) i v Node. */
(function (global) {
  'use strict';

  const EXAMPLE = {
    name: '33. Šachový festival Chlumec 2027',
    place: 'Velký sál Domu kultury Chlumec, Muchova 267',
    dateFrom: '2027-05-08',
    dateTo: '2027-05-09',
    deadline: '2027-05-06',
    infoUrl: 'https://www.festival.sachyusti.cz',
    intro: 'Prezence do 9:30, start 1. kola v 10:00.',
    contactEmail: '',
    tournaments: [
      { name: 'Open rapid – Grand Prix ČR', short: 'Rapid', day: 'sobota', type: 'individual', rating: 'rapid', minBirthYear: null, maxBirthYear: null, warnMaxRating: null, capacity: null,
        fee: 250, feeRules: [{ type: 'women', value: '', price: 200 }, { type: 'youth', value: 2008, price: 150 }, { type: 'titles', value: 'GM, IM', price: 0 }] },
      { name: 'Turnaj mladších žáků', short: 'Žáci', day: 'sobota', type: 'individual', minBirthYear: 2015, maxBirthYear: null, warnMaxRating: null, capacity: null },
      { name: 'Turnaj neregistrovaných a hráčů do ELO 1100', short: 'Neregistrovaní', day: 'sobota', type: 'individual', minBirthYear: null, maxBirthYear: 2014, warnMaxRating: 1100, capacity: null },
      { name: 'Velká cena 4členných družstev', short: 'Družstva', day: 'pátek', type: 'team', boards: 4, reserves: 1, minBirthYear: 2007, maxBirthYear: null, warnMaxRating: null, capacity: 12 },
    ],
    extras: [
      { label: 'Doprava z nádraží', type: 'checkboxes', options: ['sobota tam', 'sobota zpět'], prices: [60, 60], help: 'Nepovinné', modes: ['individual'] },
      { label: 'Obědy', type: 'quantity', unit: 'porce', options: ['sobota – oběd', 'neděle – oběd'], prices: [130, 130], help: 'Počet porcí pro celou přihlášku.', modes: ['individual', 'team'] },
      { label: 'Ubytování', type: 'quantity', unit: 'lůžko', options: ['pátek–sobota, 2lůžkový pokoj', 'pátek–sobota, 1lůžkový pokoj'], prices: [450, 600], help: 'Počet lůžek pro celou přihlášku.', modes: ['individual', 'team'] },
      { label: 'Poznámka', type: 'textarea', options: [], prices: [], help: '', modes: ['individual', 'team'] },
    ],
  };

  const PROMPT = `Jsi asistent pořadatele šachových turnajů. Z přiložených propozic vytvoř JSON pro import akce do přihlašovacího systému.

Vrať POUZE platný JSON (žádný další text, žádné komentáře) v tomto formátu:

${JSON.stringify(EXAMPLE, null, 2)}

Pravidla:
- "name": název akce, jak je v propozicích.
- "place": místo konání (sál, adresa), "intro": krátký text pro hráče (prezence, start, důležité upozornění) – nejvýš 2–3 věty, jinak "".
- Data ve formátu RRRR-MM-DD. "dateFrom" a "dateTo" = první a poslední den akce, "deadline" = uzávěrka přihlášek. Neznámé datum = "".
- "infoUrl": odkaz na propozice/web akce, pokud je uveden, jinak "". "contactEmail": kontaktní e-mail pořadatele, jinak "".
- "tournaments": každý samostatný turnaj = jedna položka, v pořadí podle propozic.
  - "name": plný název turnaje, "short": krátký název do 20 znaků (např. "Rapid", "Blesk", "Žáci"), "day": den v týdnu malými písmeny česky ("pátek", "sobota", …) nebo "".
  - "type": "individual" pro turnaj jednotlivců, "team" pro soutěž družstev. U družstev "boards" = počet šachovnic, "reserves" = počet náhradníků.
  - "minBirthYear": nejstarší povolený ročník u turnajů pro mládež ("2015 a mladší" → 2015). "maxBirthYear": nejmladší povolený ročník ("2014 a starší" → 2014). Jinak null.
  - "rating": "rapid" pro rapid turnaje (rapid šach, Grand Prix v rapidu, zápočet na rapid LOK), jinak "standard" (klasický šach, bleskový šach).
  - "warnMaxRating": horní limit ELO, pokud turnaj je jen pro hráče do určitého ELO, jinak null.
  - "capacity": maximální počet hráčů (u družstev počet družstev), pokud je uveden, jinak null.
  - "fee": startovné v Kč (u družstev za družstvo), jinak null. "feeRules": slevy ze startovného jako [{ "type", "value", "price" }]:
    "women" (ženy, value ""), "youth" (value = ročník a mladší), "senior" (value = ročník a starší), "titles" (value = např. "GM, IM"), "rating" (value = ELO od). "price" = cena po slevě (zdarma = 0). Bez slev [].
- "extras": doplňující otázky, které se mají hráčů ptát (doprava, ubytování, strava…), jen pokud je propozice nabízejí. Vždy přidej na konec { "label": "Poznámka", "type": "textarea", "options": [], "prices": [], "help": "", "modes": ["individual", "team"] }.
  - "type": "quantity" = počet kusů (obědy v porcích, ubytování v lůžkách – každý oběd/den a každý typ pokoje a noc jako samostatná možnost), "checkboxes" (více možností), "select" (jedna z možností), "text" (krátký text), "textarea" (delší text).
  - U quantity, checkboxes a select vyplň "options" a "prices" = ceny v Kč ve stejném pořadí jako options (neznámá cena = null). U quantity vyplň "unit" (např. "porce", "lůžko").
  - "modes": ["individual"] = jen u jednotlivců, ["team"] = jen u družstev, ["individual", "team"] = u obou.
- Nic si nevymýšlej. Co v propozicích není, nech prázdné ("" nebo null).`;

  const TYPES = ['individual', 'team'];
  const EXTRA_TYPES = ['checkboxes', 'select', 'quantity', 'text', 'textarea'];
  const CHOICE = ['checkboxes', 'select', 'quantity'];
  const DAYS = ['pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota', 'neděle'];

  const str = (v, max) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, max || 500);

  function toDate(v, field, warnings) {
    const s = str(v, 40);
    if (!s) return '';
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) {
      const cz = s.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
      if (cz) m = [null, cz[3], cz[2], cz[1]];
    }
    if (!m) {
      warnings.push(`${field}: „${s}“ není platné datum, vyplňte ho ručně.`);
      return '';
    }
    const iso = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    if (isNaN(new Date(iso + 'T12:00:00'))) {
      warnings.push(`${field}: „${s}“ není platné datum, vyplňte ho ručně.`);
      return '';
    }
    return iso;
  }

  function toInt(v, min, max) {
    if (v === '' || v == null) return null;
    const n = parseInt(v, 10);
    if (isNaN(n) || (min != null && n < min) || (max != null && n > max)) return null;
    return n;
  }

  /** Najde JSON i v odpovědi obalené textem nebo ```json bloku. */
  function extractJson(text) {
    const s = String(text || '').trim();
    if (!s) throw new Error('Vložte odpověď od AI.');
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('V textu není žádný JSON (chybí složené závorky { }).');
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch (e) {
      throw new Error('Text není platný JSON: ' + e.message + '. Zkuste AI požádat, ať vrátí jen čistý JSON.');
    }
  }

  /**
   * Převede odpověď AI na akci pro editor. Vrací { event, warnings }.
   * Nevyhazuje kvůli drobnostem – ty jdou do warnings a pořadatel je opraví v editoru.
   */
  function parseImport(text) {
    let data = extractJson(text);
    if (data && typeof data.event === 'object' && !Array.isArray(data.event)) data = data.event;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('JSON musí být objekt s údaji o akci.');
    const warnings = [];

    const event = {
      status: 'koncept',
      kind: data.kind === 'club' ? 'club' : 'event',
      name: str(data.name, 150),
      place: str(data.place, 150),
      dateFrom: toDate(data.dateFrom, 'Začátek akce', warnings),
      dateTo: toDate(data.dateTo, 'Konec akce', warnings),
      deadline: toDate(data.deadline, 'Uzávěrka', warnings),
      infoUrl: /^https?:\/\//i.test(str(data.infoUrl)) ? str(data.infoUrl, 300) : '',
      intro: str(data.intro, 2000),
      contactEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(data.contactEmail)) ? str(data.contactEmail, 200) : '',
      admins: [],
      tournaments: [],
      extras: [],
    };
    if (!event.name) warnings.push('Chybí název akce.');
    if (!event.dateFrom) warnings.push('Chybí datum začátku akce.');
    if (data.infoUrl && !event.infoUrl) warnings.push(`Odkaz na propozice „${str(data.infoUrl, 80)}“ není platná adresa.`);

    const tours = Array.isArray(data.tournaments) ? data.tournaments : [];
    tours.forEach((t, i) => {
      if (!t || typeof t !== 'object') return;
      const name = str(t.name, 150);
      if (!name) { warnings.push(`Turnaj č. ${i + 1} nemá název, vynechán.`); return; }
      const rawType = str(t.type, 20).toLowerCase();
      const type = /team|druzst|družst/.test(rawType) ? 'team' : 'individual';
      if (rawType && !TYPES.includes(rawType) && type === 'individual' && !/jednot|indiv/.test(rawType)) {
        warnings.push(`Turnaj „${name}“: neznámý typ „${rawType}“, nastaveno na jednotlivce.`);
      }
      const day = str(t.day, 40).toLowerCase();
      const tour = {
        name,
        short: str(t.short, 40),
        day: DAYS.includes(day) ? day : str(t.day, 40),
        type,
        minBirthYear: toInt(t.minBirthYear, 1900, 2100),
        maxBirthYear: toInt(t.maxBirthYear, 1900, 2100),
        warnMaxRating: toInt(t.warnMaxRating, 1, 3500),
        capacity: toInt(t.capacity, 1, 10000),
        rating: t.rating === 'rapid' ? 'rapid' : 'standard',
      };
      // turnaje s vlastním datem (klubová sekce, kalendář)
      if (t.dateFrom) {
        tour.dateFrom = toDate(t.dateFrom, `Turnaj „${name}“ – začátek`, warnings);
        tour.dateTo = t.dateTo ? toDate(t.dateTo, `Turnaj „${name}“ – konec`, warnings) : '';
        tour.deadline = t.deadline ? toDate(t.deadline, `Turnaj „${name}“ – uzávěrka`, warnings) : '';
        tour.place = str(t.place, 150);
        tour.infoUrl = /^https?:\/\//.test(String(t.infoUrl || '')) ? str(t.infoUrl, 300) : '';
      }
      const fee = parseFloat(String(t.fee == null ? '' : t.fee).replace(/[^\d.,]/g, '').replace(',', '.'));
      tour.fee = isNaN(fee) ? null : fee;
      tour.feeRules = type === 'team' || !Array.isArray(t.feeRules) ? [] : t.feeRules
        .filter((r) => r && ['women', 'youth', 'senior', 'titles', 'rating'].includes(r.type))
        .map((r) => ({ type: r.type, value: r.value == null ? '' : r.value, price: Number(r.price) || 0 }));
      if (type === 'team') {
        tour.boards = toInt(t.boards, 1, 12) || 4;
        tour.reserves = toInt(t.reserves, 0, 6) || 0;
      }
      if (tour.minBirthYear && tour.maxBirthYear && tour.minBirthYear > tour.maxBirthYear) {
        warnings.push(`Turnaj „${name}“: ročníky ${tour.minBirthYear} a mladší / ${tour.maxBirthYear} a starší se vylučují, zkontrolujte je.`);
      }
      event.tournaments.push(tour);
    });
    if (!event.tournaments.length) {
      warnings.push('V importu nejsou žádné turnaje, přidejte je ručně.');
      event.tournaments.push({ type: 'individual' });
    }

    const extras = Array.isArray(data.extras) ? data.extras : [];
    extras.forEach((x, i) => {
      if (!x || typeof x !== 'object') return;
      const label = str(x.label, 200);
      if (!label) { warnings.push(`Doplňující otázka č. ${i + 1} nemá text, vynechána.`); return; }
      let type = str(x.type, 20).toLowerCase();
      if (!EXTRA_TYPES.includes(type)) type = 'text';
      const rawOpts = Array.isArray(x.options) ? x.options : String(x.options || '').split(/\n|;/);
      const rawPrices = Array.isArray(x.prices) ? x.prices : [];
      const options = [];
      const prices = [];
      rawOpts.forEach((o, j) => {
        const name = str(o, 100);
        if (!name) return;
        options.push(name);
        const p = parseFloat(String(rawPrices[j] == null ? '' : rawPrices[j]).replace(/[^\d.,]/g, '').replace(',', '.'));
        prices.push(isNaN(p) ? null : p);
      });
      if (CHOICE.includes(type) && !options.length) {
        warnings.push(`Otázka „${label}“ nemá možnosti, změněna na textovou odpověď.`);
        type = 'text';
      }
      let modes = Array.isArray(x.modes) ? x.modes.map((m) => str(m, 20).toLowerCase()).filter((m) => TYPES.includes(m)) : [];
      if (!modes.length) modes = TYPES.slice();
      const choice = CHOICE.includes(type);
      event.extras.push({
        label, type, options: choice ? options : [], prices: choice && prices.some((p) => p != null) ? prices : [],
        unit: type === 'quantity' ? str(x.unit, 20) : '', help: str(x.help, 500), modes,
      });
    });

    return { event, warnings };
  }

  const api = { PROMPT, EXAMPLE, parseImport, extractJson };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.EventImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
