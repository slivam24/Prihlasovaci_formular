/* Export pro Swiss-Manager – stejné sloupce a formát jako export ze SM
 * (UTF-8, středníky, CRLF, Narozen jako 00.00.RRRR). */
(function (global) {
  'use strict';

  // Přesně podle exportu ze Swiss-Manageru (včetně mezery v „ Fed“).
  const SM_HEADER = [
    'Č.', 'Jméno', 'Titul', 'ID č.', 'Rating nár', 'Rating FIDE', 'Narozen', ' Fed', 'Pohl.', 'Typ', 'Sk.',
    'Č.klubu', 'Klub', 'FIDE ID', 'Zdroj', 'body', 'tb1', 'tb2', 'tb3', 'tb4', 'tb5', 'tb6', 'poř.',
    'surname', 'first name', 'atitle',
  ];

  const DEFAULT_AGE_CATEGORIES = [
    { code: 'U12', maxAge: 12 },
    { code: 'U15', maxAge: 15 },
    { code: 'U18', maxAge: 18 },
    { code: 'U20', maxAge: 20 },
    { code: 'S60', minAge: 60 },
  ];

  const toInt = (v) => { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; };
  const fullName = (p) => `${p.surname} ${p.firstName}`.trim();

  /** Řádek přihlášky (z API) → hráč. */
  function regToPlayer(r) {
    return {
      registered: r.inLok === 'ANO' || r.inLok === true,
      id: toInt(r.idCr),
      surname: String(r.surname || ''),
      firstName: String(r.firstName || ''),
      year: toInt(r.year),
      sex: r.sex === 'F' ? 'F' : '',
      title: String(r.title || ''),
      fide: toInt(r.fideId),
      fed: String(r.fed || 'CZE'),
      rn: toInt(r.rn),
      rf: toInt(r.rf),
      clubNo: toInt(r.clubNo),
      club: String(r.club || ''),
      status: String(r.sk || ''),
    };
  }

  function ageCategory(year, opts) {
    if (!year) return '';
    const age = opts.year - year;
    for (const c of opts.ageCategories || DEFAULT_AGE_CATEGORIES) {
      if (c.maxAge != null && age <= c.maxAge) return c.code;
      if (c.minAge != null && age >= c.minAge) return c.code;
    }
    return '';
  }

  function smType(p, opts) {
    const unreg = opts.unregisteredCategory == null ? 'N' : opts.unregisteredCategory;
    return [ageCategory(p.year, opts), p.registered ? '' : unreg].filter(Boolean).join(', ');
  }

  function byRating(a, b) {
    return (b.rf - a.rf) || (b.rn - a.rn) || fullName(a).localeCompare(fullName(b), 'cs');
  }

  function smRow(p, no, opts) {
    const row = {
      'Č.': no,
      'Jméno': fullName(p),
      'Titul': p.title || '',
      'ID č.': p.id || '',
      'Rating nár': p.rn || 0,
      'Rating FIDE': p.rf || 0,
      'Narozen': '00.00.' + (p.year || '0000'),
      ' Fed': p.fed || 'CZE',
      'Pohl.': p.sex || '',
      'Typ': smType(p, opts),
      'Sk.': p.status || '',
      'Č.klubu': p.clubNo || 0,
      'Klub': p.club || '',
      'FIDE ID': p.fide || 0,
      'surname': p.surname,
      'first name': p.firstName,
    };
    return SM_HEADER.map((h) => (row[h] == null ? '' : row[h]));
  }

  /** Jednotlivci: tabulka včetně hlavičky, seřazená podle ratingu. */
  function buildSmTable(players, opts) {
    const sorted = players.slice().sort(byRating);
    return [SM_HEADER.slice()].concat(sorted.map((p, i) => smRow(p, i + 1, opts)));
  }

  /** Družstva: sloupce SM + Družstvo, Šachovnice, Kapitán. Vstupem jsou řádky přihlášek. */
  function buildTeamTable(regs, opts) {
    const sorted = regs.filter((r) => r.surname).sort((a, b) =>
      String(a.team).localeCompare(String(b.team), 'cs') || toInt(a.board) - toInt(b.board));
    const header = SM_HEADER.concat(['Družstvo', 'Šachovnice', 'Kapitán']);
    return [header].concat(sorted.map((r, i) =>
      smRow(regToPlayer(r), i + 1, opts).concat([r.team || '', toInt(r.board), r.captain || ''])));
  }

  function toSmText(table) {
    return table.map((r) => r.map((v) => String(v).replace(/[;\r\n]/g, ' ')).join(';')).join('\r\n') + '\r\n';
  }

  const api = {
    SM_HEADER, DEFAULT_AGE_CATEGORIES, regToPlayer, ageCategory, smType, buildSmTable, buildTeamTable, toSmText, byRating,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SM = api;
})(typeof window !== 'undefined' ? window : globalThis);
