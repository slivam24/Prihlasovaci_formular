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

  /** Nevynucované podmínky (ELO) – jen text upozornění. */
  function ratingWarning(t, p) {
    if (!t.warnMaxRating || !p) return '';
    const r = Math.max(p.rn || 0, p.rf || 0);
    if (r <= t.warnMaxRating) return '';
    const has = [p.rn ? 'ELO ČR ' + p.rn : '', p.rf ? 'FIDE ' + p.rf : ''].filter(Boolean).join(' / ');
    return `Pozor: hráč má ${has}, turnaj je určen pro hráče do ELO ${t.warnMaxRating}. Přihlášku posoudí pořadatel.`;
  }

  function samePlayer(a, b) {
    if (a.id && b.id) return a.id === b.id;
    return norm(a.surname + ' ' + a.firstName) === norm(b.surname + ' ' + b.firstName) && a.year === b.year;
  }

  function tournamentLabel(t) {
    return (t.day ? t.day + ' – ' : '') + t.name;
  }

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

  const api = {
    norm, eventYear, isClosed, ruleText, eligibility, ratingWarning, samePlayer,
    tournamentLabel, STATUS_LABELS, formatDate, formatRange,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Rules = api;
})(typeof window !== 'undefined' ? window : globalThis);
