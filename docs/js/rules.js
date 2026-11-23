/* Pravidla turnajů sdílená formulářem a administrací (v Node kvůli testům). */
(function (global) {
  'use strict';

  function norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /** Rok akce – podle něj se počítají věkové kategorie. */
  function eventYear(event) {
    const y = parseInt(String((event && event.dateFrom) || '').slice(0, 4), 10);
    return y || new Date().getFullYear();
  }

  function isClosed(event, now) {
    if (!event) return true;
    if (event.status && event.status !== 'otevreno') return true;
    if (!event.deadline) return false;
    const end = new Date(String(event.deadline).includes('T') ? event.deadline : event.deadline + 'T23:59:59');
    return !isNaN(end) && (now || new Date()) > end;
  }

  function ruleText(t) {
    const parts = [];
    if (t.minBirthYear) parts.push(`ročník ${t.minBirthYear} a mladší`);
    if (t.maxBirthYear) parts.push(`ročník ${t.maxBirthYear} a starší`);
    if (t.warnMaxRating) parts.push(`ELO do ${t.warnMaxRating}`);
    return parts.join(', ');
  }

  /** Vynucované podmínky (ročník). Vrací důvod, nebo ''. */
  function eligibility(t, p) {
    if (!p || !p.year) return '';
    if (t.minBirthYear && p.year < t.minBirthYear) return `jen pro ročník ${t.minBirthYear} a mladší`;
    if (t.maxBirthYear && p.year > t.maxBirthYear) return `jen pro ročník ${t.maxBirthYear} a starší`;
    return '';
  }

  /**
   * Hráč s ratingem, který turnaj používá: u rapid turnaje rapid ELO ČR a FIDE rapid (rnr / rfr z rapid LOK).
   * Uložené řádky přihlášek už mají rating podle turnaje (rnr / rfr nemají), ty se nemění.
   */
  function rated(t, p) {
    if (!p || !t || t.rating !== 'rapid' || (p.rnr == null && p.rfr == null)) return p;
    return Object.assign({}, p, { rn: p.rnr || 0, rf: p.rfr || 0 });
  }

  const RATING_LABELS = { standard: 'klasický (LOK)', rapid: 'rapid (rapid LOK)' };

  /** Nevynucované podmínky (ELO) – jen text upozornění. */
  function ratingWarning(t, p) {
    p = rated(t, p);
    if (!t.warnMaxRating || !p) return '';
    const r = Math.max(p.rn || 0, p.rf || 0);
    if (r <= t.warnMaxRating) return '';
    const pre = t.rating === 'rapid' ? 'rapid ' : '';
    const has = [p.rn ? pre + 'ELO ČR ' + p.rn : '', p.rf ? 'FIDE ' + pre + p.rf : ''].filter(Boolean).join(' / ');
    return `Pozor: hráč má ${has}, turnaj je určen pro hráče do ELO ${t.warnMaxRating}. Přihlášku posoudí pořadatel.`;
  }

  function samePlayer(a, b) {
    if (a.id && b.id) return a.id === b.id;
    return norm(a.surname + ' ' + a.firstName) === norm(b.surname + ' ' + b.firstName) && a.year === b.year;
  }

  function tournamentLabel(t) {
    // turnaj s vlastním datem (klubová sekce): „8. 5. 2027 – Grand Prix…“, jinak „sobota – …“
    if (t.dateFrom) return formatRange(t.dateFrom, t.dateTo) + ' – ' + t.name;
    return (t.day ? t.day + ' – ' : '') + t.name;
  }

  /** Uzavřený turnaj: po vlastní uzávěrce (do konce dne), bez uzávěrky od dne začátku. */
  function tournamentClosed(t, now) {
    now = now || new Date();
    if (t.deadline) return now > new Date(t.deadline + 'T23:59:59');
    if (t.dateFrom) return now >= new Date(t.dateFrom + 'T00:00:00');
    return false;
  }

  /** Turnaj už skončil (klubová sekce ho ve formuláři nenabízí). */
  function tournamentPast(t, now) {
    const end = t.dateTo || t.dateFrom;
    return !!end && (now || new Date()) > new Date(end + 'T23:59:59');
  }

  /** Turnaje seřazené podle data (turnaje bez data na konci, v původním pořadí). */
  function byDate(list) {
    return list.map((t, i) => ({ t, i })).sort((a, b) =>
      String(a.t.dateFrom || '9999').localeCompare(String(b.t.dateFrom || '9999')) || a.i - b.i).map((x) => x.t);
  }

  const EVENT_KINDS = { event: 'turnaj nebo festival', club: 'klubová sekce (přihlášky do klubu, jen přes odkaz)' };

  const STATUS_LABELS = {
    koncept: 'rozpracovaná',
    otevreno: 'přihlašování otevřeno',
    uzavreno: 'přihlašování uzavřeno',
    archiv: 'archiv',
  };

  function formatDate(d) {
    if (!d) return '';
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${+m[3]}. ${+m[2]}. ${m[1]}` : String(d);
  }

  function formatRange(from, to) {
    if (!from) return '';
    if (!to || to === from) return formatDate(from);
    const a = from.split('-');
    const b = to.split('-');
    if (a[0] === b[0] && a[1] === b[1]) return `${+a[2]}.–${formatDate(to)}`;
    if (a[0] === b[0]) return `${+a[2]}. ${+a[1]}. – ${formatDate(to)}`;
    return `${formatDate(from)} – ${formatDate(to)}`;
  }

  // ---- doplňující otázky s cenou (obědy, ubytování…) ----

  function formatMoney(n) {
    return (Math.round(n * 100) / 100).toLocaleString('cs-CZ') + ' Kč';
  }

  function optionPrice(x, i) {
    const p = x.prices && x.prices[i];
    return typeof p === 'number' && !isNaN(p) ? p : null;
  }

  /** Cena odpovědi na otázku (0, když otázka nemá ceny). */
  function extraPrice(x, v) {
    const opts = x.options || [];
    if (x.type === 'quantity') {
      return opts.reduce((sum, o, i) => sum + (optionPrice(x, i) || 0) * (parseInt((v || {})[o], 10) || 0), 0);
    }
    if (x.type === 'checkboxes') {
      return opts.reduce((sum, o, i) => sum + ((Array.isArray(v) && v.includes(o)) ? optionPrice(x, i) || 0 : 0), 0);
    }
    if (x.type === 'select') {
      const i = opts.indexOf(v);
      return i >= 0 ? optionPrice(x, i) || 0 : 0;
    }
    return 0;
  }

  /** Text odpovědi, např. „sobota × 3, neděle × 2“. */
  function extraText(x, v) {
    if (x.type === 'quantity') {
      return (x.options || []).filter((o) => parseInt((v || {})[o], 10) > 0)
        .map((o) => `${o} × ${parseInt(v[o], 10)}`).join(', ');
    }
    return Array.isArray(v) ? v.join(', ') : String(v == null ? '' : v);
  }

  function extrasTotal(extras, values) {
    return (extras || []).reduce((sum, x) => sum + extraPrice(x, (values || {})[x.id]), 0);
  }

  // ---- startovné ----

  const FEE_RULE_TYPES = {
    women: 'ženy a dívky',
    youth: 'ročník … a mladší',
    senior: 'ročník … a starší',
    titles: 'tituly',
    rating: 'ELO od',
  };

  function feeRuleText(r) {
    if (r.type === 'women') return 'ženy';
    if (r.type === 'youth') return `ročník ${r.value} a mladší`;
    if (r.type === 'senior') return `ročník ${r.value} a starší`;
    if (r.type === 'titles') return String(r.value || '');
    if (r.type === 'rating') return `ELO ${r.value}+`;
    return '';
  }

  function feeRuleMatches(r, p) {
    if (!p) return false;
    if (r.type === 'women') return p.sex === 'F';
    if (r.type === 'youth') return !!p.year && p.year >= Number(r.value);
    if (r.type === 'senior') return !!p.year && p.year <= Number(r.value);
    if (r.type === 'titles') {
      const list = String(r.value || '').toUpperCase().split(/[\s,;]+/).filter(Boolean);
      return !!p.title && list.includes(String(p.title).toUpperCase());
    }
    if (r.type === 'rating') return Math.max(p.rn || 0, p.rf || 0) >= Number(r.value);
    return false;
  }

  /**
   * Startovné hráče v turnaji: nejnižší z ceny základní a cen slev, které hráč splňuje.
   * Vrací { amount, reason } nebo null, když turnaj startovné nemá. U družstev = za družstvo.
   */
  function entryFee(t, p) {
    if (typeof t.fee !== 'number') return null;
    p = rated(t, p);
    let best = { amount: t.fee, reason: '' };
    if (t.type !== 'team') {
      (t.feeRules || []).forEach((r) => {
        if (typeof r.price === 'number' && r.price < best.amount && feeRuleMatches(r, p)) {
          best = { amount: r.price, reason: feeRuleText(r) };
        }
      });
    }
    return best;
  }

  /** Skloňování: plural(4, 'šachovnice', 'šachovnice', 'šachovnic'). */
  function plural(n, one, few, many) {
    return `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
  }

  function teamSize(t) {
    const r = t.reserves || 0;
    return plural(t.boards || 4, 'šachovnice', 'šachovnice', 'šachovnic') +
      (r ? ' + ' + plural(r, 'náhradník', 'náhradníci', 'náhradníků') : '');
  }

  const api = {
    rated, RATING_LABELS,
    FEE_RULE_TYPES, feeRuleText, feeRuleMatches, entryFee,
    plural, teamSize,
    formatMoney, optionPrice, extraPrice, extraText, extrasTotal,
    norm, eventYear, isClosed, ruleText, eligibility, ratingWarning, samePlayer,
    tournamentLabel, tournamentClosed, tournamentPast, byDate, EVENT_KINDS, STATUS_LABELS, formatDate, formatRange,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Rules = api;
})(typeof window !== 'undefined' ? window : globalThis);
