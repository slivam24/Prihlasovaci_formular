/* Databáze hráčů z LOK a vyhledávání pro našeptávač.
 * Funguje v prohlížeči (window.Players) i v Node (require) kvůli testům. */
(function (global) {
  'use strict';

  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  }

  // LOK má jméno ve tvaru „Příjmení Jméno [Další jméno]“ – stejně ho dělí Swiss-Manager.
  function splitName(name) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    const i = clean.indexOf(' ');
    return i < 0
      ? { surname: clean, firstName: '' }
      : { surname: clean.slice(0, i), firstName: clean.slice(i + 1) };
  }

  class PlayerDB {
    constructor(data) {
      const f = data.fields;
      const ix = {};
      f.forEach((name, i) => { ix[name] = i; });
      const clubs = data.clubs || {};
      this.generated = data.generated || '';
      this.players = [];
      this.words = [];
      for (const r of data.players) {
        const name = r[ix.name];
        const parts = splitName(name);
        const clubNo = r[ix.club] || 0;
        this.players.push({
          registered: true,
          id: r[ix.id] || 0,
          name: name,
          surname: parts.surname,
          firstName: parts.firstName,
          year: r[ix.year] || 0,
          sex: r[ix.sex] || '',
          rn: r[ix.rn] || 0,
          rf: r[ix.rf] || 0,
          title: r[ix.title] || '',
          fide: r[ix.fide] || 0,
          fed: r[ix.fed] || 'CZE',
          clubNo: clubNo,
          club: clubs[String(clubNo)] || '',
          status: r[ix.st] || '',
        });
        this.words.push(norm(name).split(/[\s-]+/));
      }
    }

    get size() { return this.players.length; }

    /* Hledá podle začátků slov jména bez ohledu na diakritiku a pořadí
     * („novak j“, „jan novak“), číslo bere jako ID ČR, ročník nebo začátek FIDE ID. */
    search(query, limit) {
      limit = limit || 10;
      const tokens = norm(query).split(/[\s,.;]+/).filter(Boolean);
      if (!tokens.length) return [];
      const text = tokens.filter((t) => !/^\d+$/.test(t));
      const nums = tokens.filter((t) => /^\d+$/.test(t));
      if (!text.length && nums.every((t) => t.length < 2)) return [];

      const hits = [];
      for (let i = 0; i < this.players.length; i++) {
        const words = this.words[i];
        let score = 0;
        let ok = true;
        for (let k = 0; k < text.length && ok; k++) {
          const t = text[k];
          let found = -1;
          for (let j = 0; j < words.length; j++) {
            if (words[j].startsWith(t)) { found = j; break; }
          }
          if (found < 0) { ok = false; break; }
          if (words[found] === t) score += 1;
          if (found === 0 && k === 0) score += 3; // první slovo dotazu = příjmení
        }
        if (!ok) continue;
        const p = this.players[i];
        for (const t of nums) {
          const n = Number(t);
          if (p.id === n) score += 10;
          else if (p.year === n) score += 1;
          else if (t.length >= 4 && String(p.fide).startsWith(t)) score += 2;
          else { ok = false; break; }
        }
        if (!ok) continue;
        hits.push([score, Math.max(p.rn, p.rf), p]);
      }
      hits.sort((a, b) => b[0] - a[0] || b[1] - a[1] || a[2].name.localeCompare(b[2].name, 'cs'));
      return hits.slice(0, limit).map((h) => h[2]);
    }
  }

  const api = { PlayerDB, norm, splitName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Players = api;
})(typeof window !== 'undefined' ? window : globalThis);
