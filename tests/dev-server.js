#!/usr/bin/env node
/* Lokální vývojový server: web z docs/ + backend Code.gs nad simulovanou tabulkou v paměti.
 *   node tests/dev-server.js [port]      → http://localhost:8000
 * Administrace se přihlašuje bez Googlu (jen zadáním e-mailu), hlavní správce je owner@example.cz.
 * Pro našeptávač je potřeba docs/data/players.json (viz README). */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createGas, CLIENT_ID } = require('./gas-mock.js');

const port = Number(process.argv[2]) || 8000;
const root = path.join(__dirname, '..', 'docs');
const gas = createGas({ owner: 'owner@example.cz', props: { SITE_URL: `http://localhost:${port}/` } });

if (process.env.SEED !== '0') {
  // ukázková akce, rovnou otevřená a s termínem za dva měsíce
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  gas.run(`ADMIN_ACTIONS.saveEvent({ event: Object.assign({}, SAMPLE_EVENT_, {
      status: 'otevreno', deadline: '', dateFrom: '${day(60)}', dateTo: '${day(61)}', contactEmail: 'poradatel@example.cz',
      issuer: { name: 'Šachový klub Chlumec, z.s.', ico: '12345678', address: 'Muchova 267, 403 39 Chlumec', place: 'Chlumec', cashier: 'Jan Pokladník', note: 'Nejsme plátci DPH.' },
      tournaments: SAMPLE_EVENT_.tournaments.map((t) => Object.assign({}, t, { fee: t.type === 'team' ? 600 : 250,
        feeRules: t.type === 'team' ? [] : [{ type: 'women', price: 200 }, { type: 'youth', value: 2008, price: 150 }, { type: 'titles', value: 'GM, IM', price: 0 }] })),
      extras: SAMPLE_EVENT_.extras.concat([{ label: 'Obědy', type: 'quantity', unit: 'porce', options: ['sobota', 'neděle'], prices: [130, 130] }]) }) },
    { email: 'owner@example.cz', role: 'superadmin' })`);
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8' };

  if (url.pathname === '/exec') {
    if (req.method === 'GET') {
      res.writeHead(200, cors);
      res.end(JSON.stringify(gas.get(Object.fromEntries(url.searchParams))));
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(200, cors);
      res.end(JSON.stringify(gas.post(body)));
    });
    return;
  }

  if (url.pathname === '/config.json') {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    Object.assign(cfg, { apiUrl: `http://localhost:${port}/exec`, googleClientId: CLIENT_ID, devLogin: true });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(cfg));
    return;
  }

  const file = path.join(root, path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));
  const target = file.endsWith(path.sep) ? path.join(file, 'index.html') : file;
  if (!target.startsWith(root) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    res.writeHead(404);
    res.end('Nenalezeno');
    return;
  }
  res.writeHead(200, { 'Content-Type': (types[path.extname(target)] || 'application/octet-stream') + '; charset=utf-8' });
  fs.createReadStream(target).pipe(res);
}).listen(port, () => {
  console.log(`Vývojový server: http://localhost:${port}/  (administrace: /admin.html, účet owner@example.cz)`);
});
