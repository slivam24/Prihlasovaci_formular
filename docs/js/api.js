/* Komunikace s backendem (Google Apps Script). */
(function (global) {
  'use strict';

  let configPromise = null;

  function loadConfig() {
    if (!configPromise) {
      configPromise = fetch('config.json', { cache: 'no-cache' }).then((r) => {
        if (!r.ok) throw new Error('Nepodařilo se načíst config.json.');
        return r.json();
      });
    }
    return configPromise;
  }

  async function apiUrl() {
    const cfg = await loadConfig();
    if (!cfg.apiUrl) throw new Error('Aplikace zatím není propojená s Google tabulkou (v config.json chybí apiUrl).');
    return cfg.apiUrl;
  }

  async function handle(res) {
    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error('Server vrátil neplatnou odpověď.');
    }
    if (!data.ok) {
      const err = new Error(data.error || 'Neznámá chyba serveru.');
      err.code = data.code;
      throw err;
    }
    return data;
  }

  async function get(action, params) {
    const url = new URL(await apiUrl());
    url.searchParams.set('action', action);
    Object.keys(params || {}).forEach((k) => url.searchParams.set(k, params[k]));
    let res;
    try {
      res = await fetch(url.toString());
    } catch (e) {
      throw new Error('Nepodařilo se spojit se serverem. Zkontrolujte připojení k internetu.');
    }
    return handle(res);
  }

  async function post(action, body) {
    let res;
    try {
      res = await fetch(await apiUrl(), {
        method: 'POST',
        // text/plain = bez CORS preflightu, který Apps Script neumí
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action }, body || {})),
      });
    } catch (e) {
      throw new Error('Nepodařilo se spojit se serverem. Zkontrolujte připojení k internetu.');
    }
    return handle(res);
  }

  function param(name) {
    return new URLSearchParams(global.location.search).get(name);
  }

  // Lokální kopie posledních dat (akce) – stránka se ukáže hned a na pozadí se obnoví.
  function cacheRead(key, maxAgeMs) {
    try {
      const raw = global.localStorage.getItem('cache:' + key);
      if (!raw) return null;
      const item = JSON.parse(raw);
      if (maxAgeMs && Date.now() - item.at > maxAgeMs) return null;
      return item.data;
    } catch (e) {
      return null;
    }
  }

  function cacheWrite(key, data) {
    try {
      global.localStorage.setItem('cache:' + key, JSON.stringify({ at: Date.now(), data }));
    } catch (e) { /* plné úložiště / soukromé okno – nevadí */ }
  }

  global.Api = { loadConfig, get, post, param, cacheRead, cacheWrite };
})(window);
