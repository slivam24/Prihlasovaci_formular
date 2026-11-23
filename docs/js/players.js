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

  // Kategorie členů v LOK, které bereme jako aktivní: A dospělí, B senioři, C mládež,
  // D nejmladší, I individuální členové. (N = neaktivní – téměř nikdo z nich nemá partie.)
  const ACTIVE_STATUSES = ['A', 'B', 'C', 'D', 'I'];
  const isActive = (p) => ACTIVE_STATUSES.includes(p.status);

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
          rnr: ix.rr != null ? r[ix.rr] || 0 : 0,
          rfr: ix.rfr != null ? r[ix.rfr] || 0 : 0,
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

    /** Názvy všech klubů (pro našeptávání ve filtru). */
    clubNames() {
      if (!this._clubNames) {
        const set = new Set(this.players.map((p) => p.club).filter(Boolean));
        this._clubNames = Array.from(set).sort((a, b) => a.localeCompare(b, 'cs'));
      }
      return this._clubNames;
    }

    /**
     * Filtr pro hromadný výběr: část názvu klubu (bez diakritiky), ročník od–do,
     * pohlaví ('F' / 'M') a jen aktivní členové. Seřazeno podle ratingu.
     */
    filter(f, limit) {
      f = f || {};
      const club = norm(f.club);
      // přesný název klubu (vybraný ze seznamu) → jen ten klub, jinak část názvu
      const exact = club && this.clubNames().some((c) => norm(c) === club);
      const nameWords = norm(f.name).split(/\s+/).filter(Boolean);
      const clubCounts = {};
      const from = parseInt(f.yearFrom, 10) || 0;
      const to = parseInt(f.yearTo, 10) || 0;
      const clubMatch = {};
      const out = [];
      for (const p of this.players) {
        if (club) {
          const key = p.clubNo + '|' + p.club;
          if (!(key in clubMatch)) clubMatch[key] = exact ? norm(p.club) === club : norm(p.club).includes(club);
          if (!clubMatch[key]) continue;
        }
        if (from && p.year < from) continue;
        if (to && p.year > to) continue;
        const membership = f.membership || (f.activeOnly ? 'active' : '');
        if (membership === 'active' && !isActive(p)) continue;
        if (membership === 'inactive' && isActive(p)) continue;
        if (f.sex === 'F' && p.sex !== 'F') continue;
        if (f.sex === 'M' && p.sex === 'F') continue;
        if (nameWords.length) {
          const n = norm(p.name);
          if (!nameWords.every((w) => n.includes(w))) continue;
        }
        out.push(p);
        clubCounts[p.club] = (clubCounts[p.club] || 0) + 1;
      }
      out.sort((a, b) => Math.max(b.rn, b.rf) - Math.max(a.rn, a.rf) || a.name.localeCompare(b.name, 'cs'));
      const clubs = Object.keys(clubCounts).map((c) => ({ name: c, count: clubCounts[c] }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'cs'));
      return { total: out.length, players: limit ? out.slice(0, limit) : out, clubs };
    }

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

  const api = { PlayerDB, norm, splitName, ACTIVE_STATUSES, isActive };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Players = api;
})(typeof window !== 'undefined' ? window : globalThis);
