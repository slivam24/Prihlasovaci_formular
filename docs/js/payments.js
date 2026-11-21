/* Platby: položky k úhradě (startovné, obědy, ubytování…), částka slovy pro pokladní doklad.
 * Funguje v prohlížeči (window.Payments) i v Node kvůli testům. */
(function (global) {
  'use strict';

  const R = global.Rules || (typeof require !== 'undefined' ? require('./rules.js') : null);
  const CANCELLED = 'zrušeno';
  const toInt = (v) => { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; };

  function regPlayer(r) {
    return {
      surname: r.surname, firstName: r.firstName, year: toInt(r.year), sex: r.sex === 'F' ? 'F' : '',
      title: String(r.title || ''), rn: toInt(r.rn), rf: toInt(r.rf),
    };
  }

  function extrasOf(r) {
    try { return JSON.parse(r.extras || '{}'); } catch (e) { return {}; }
  }

  /**
   * Všechny položky k úhradě aktivních přihlášek.
   * Položka: { key, category, label, person, club, applicationId, email, amount }.
   * Startovné je za hráče a turnaj (u družstva za družstvo), doplňky za celou přihlášku.
   */
  function buildItems(ev, regs) {
    const items = [];
    const active = regs.filter((r) => r.status !== CANCELLED);
    const tour = (id) => ev.tournaments.find((t) => t.id === id);
    const tName = (t) => t.short || t.name;

    active.forEach((r) => {
      const t = tour(r.tournamentId);
      if (!t) return;
      if (t.type === 'team') {
        if (r.surname) return; // startovné je jen na řádku družstva
        const fee = R.entryFee(t, {});
        if (fee) {
          items.push({
            key: 'fee:' + r.id, category: 'Startovné', label: `Startovné ${tName(t)} – družstvo ${r.team}`,
            person: `družstvo ${r.team}`, club: r.team, applicationId: r.applicationId, email: r.email, amount: fee.amount,
          });
        }
        return;
      }
      const fee = R.entryFee(t, regPlayer(r));
      if (fee) {
        items.push({
          key: 'fee:' + r.id, category: 'Startovné', label: `Startovné ${tName(t)}${fee.reason ? ` (${fee.reason})` : ''}`,
          person: `${r.surname} ${r.firstName}`, club: r.club || '', applicationId: r.applicationId, email: r.email, amount: fee.amount,
        });
      }
    });

    // doplňky po přihláškách
    const apps = {};
    active.forEach((r) => {
      const a = apps[r.applicationId] || (apps[r.applicationId] = { r, names: [], clubs: {} });
      if (r.surname) {
        const n = `${r.surname} ${r.firstName}`;
        if (!a.names.includes(n)) a.names.push(n);
        if (r.club) a.clubs[r.club] = (a.clubs[r.club] || 0) + 1;
      } else if (r.team && !a.team) a.team = r.team;
    });
    Object.keys(apps).forEach((id) => {
      const a = apps[id];
      const club = Object.keys(a.clubs).sort((x, y) => a.clubs[y] - a.clubs[x])[0] || a.team || '';
      const who = a.names.length === 1 ? a.names[0]
        : `přihláška ${id}` + (a.names.length ? ` (${a.names[0]}${a.names.length > 1 ? ' + ' + (a.names.length - 1) : ''})` : a.team ? ` (${a.team})` : '');
      const values = extrasOf(a.r);
      (ev.extras || []).forEach((x) => {
        const v = values[x.id];
        (x.options || []).forEach((o, i) => {
          const price = R.optionPrice(x, i);
          if (price == null) return;
          let n = 0;
          if (x.type === 'quantity') n = toInt((v || {})[o]);
          else if (x.type === 'checkboxes') n = Array.isArray(v) && v.includes(o) ? 1 : 0;
          else if (x.type === 'select') n = v === o ? 1 : 0;
          if (!n) return;
          items.push({
            key: `x:${id}:${x.id}:${o}`, category: x.label,
            label: `${x.label}: ${o}${n > 1 || x.type === 'quantity' ? ` × ${n}${x.unit ? ' ' + x.unit : ''}` : ''}`,
            person: who, club, applicationId: id, email: a.r.email, amount: Math.round(price * n * 100) / 100,
          });
        });
      });
    });
    return items;
  }

  /** Klíč položky → doklad (jen platné doklady). */
  function paidMap(receipts) {
    const map = {};
    (receipts || []).filter((r) => r.status !== 'stornováno').forEach((r) => {
      (r.items || []).forEach((it) => { map[it.key] = r; });
    });
    return map;
  }

  // ---- částka slovy ----
  const ONES = ['', 'jedna', 'dva', 'tři', 'čtyři', 'pět', 'šest', 'sedm', 'osm', 'devět', 'deset', 'jedenáct', 'dvanáct',
    'třináct', 'čtrnáct', 'patnáct', 'šestnáct', 'sedmnáct', 'osmnáct', 'devatenáct'];
  const TENS = ['', '', 'dvacet', 'třicet', 'čtyřicet', 'padesát', 'šedesát', 'sedmdesát', 'osmdesát', 'devadesát'];
  const HUNDREDS = ['', 'sto', 'dvěstě', 'třista', 'čtyřista', 'pětset', 'šestset', 'sedmset', 'osmset', 'devětset'];

  function under1000(n) {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    let out = HUNDREDS[h];
    if (rest < 20) out += ONES[rest];
    else out += TENS[Math.floor(rest / 10)] + ONES[rest % 10];
    return out;
  }

  /** 1234 → „jedentisícdvěstětřicetčtyři“ (jak se píše na pokladní doklady). */
  function numberWords(n) {
    n = Math.floor(Math.abs(n));
    if (n === 0) return 'nula';
    const millions = Math.floor(n / 1e6);
    const thousands = Math.floor((n % 1e6) / 1000);
    const rest = n % 1000;
    let out = '';
    if (millions) {
      out += millions === 1 ? 'jedenmilion' : under1000(millions).replace(/^dva$/, 'dva') + (millions < 5 ? 'miliony' : 'milionů');
    }
    if (thousands) {
      if (thousands === 1) out += 'jedentisíc';
      else if (thousands < 5) out += under1000(thousands) + 'tisíce';
      else out += under1000(thousands) + 'tisíc';
    }
    out += under1000(rest);
    return out;
  }

  function amountWords(amount) {
    const kc = Math.floor(amount);
    const h = Math.round((amount - kc) * 100);
    let out = numberWords(kc) + ' Kč';
    if (h) out += ' ' + numberWords(h) + ' hal.';
    return out.charAt(0).toUpperCase() + out.slice(1);
  }

  const api = { buildItems, paidMap, numberWords, amountWords };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Payments = api;
})(typeof window !== 'undefined' ? window : globalThis);
