'use strict';
// HTTP layer: routing, validation, rate limiting, CORS, security headers, static files, error handling.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const cfg = require('./config'), store = require('./store'), V = require('./validate');
const { plan, book, makePlan } = require('./agent');
const { chat } = require('./chat');
const { TOOLS } = require('./tools');

const PUB = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
class HttpError extends Error { constructor(status, msg, details) { super(msg); this.status = status; this.details = details; } }
const check = errs => { if (errs.length) throw new HttpError(422, 'Validation failed', errs); };
const view = s => ({ sessionId: s.id, trace: s.trace, state: s.state, plan: makePlan(s) });
const keep = id => { const s = store.get(id); if (s) store.touch(); };
const needKey = mode => { if (mode === 'llm' && !cfg.anthropicKey) throw new HttpError(400, 'llm mode requires ANTHROPIC_API_KEY on the server'); };

const routes = [
  ['GET', '/api/health', () => ({ status: 'ok', uptimeSec: Math.round(process.uptime()), sessions: store.size, llm: !!cfg.anthropicKey })],
  ['GET', '/api/tools', () => Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, input_schema: t.input_schema }))],
  ['POST', '/api/chat', async b => { check(V.chatBody(b)); needKey(b.mode); const o = await chat(b.sessionId, b.message, b.mode); keep(o.sessionId); return o; }],
  ['POST', '/api/plan', async b => { check(V.planBody(b)); needKey(b.mode); const s = await plan(b.request, b.mode); keep(s.id); return view(s); }],
  ['POST', '/api/book', b => { check(V.bookBody(b)); const s = book(b.sessionId, b.confirmed); keep(s.id); return view(s); }],
  ['GET', '/api/sessions/:id', (b, p) => { const s = store.get(p.id); if (!s) throw new HttpError(404, 'Unknown session'); return view(s); }],
  ['DELETE', '/api/sessions/:id', (b, p) => { if (!store.delete(p.id)) throw new HttpError(404, 'Unknown session'); return { deleted: true }; }],
].map(([method, p, fn]) => ({ method, fn, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$') }));

function readBody(req, limit = 1e5) {
  return new Promise((ok, no) => {
    let d = '', n = 0;
    req.on('data', c => { n += c.length; if (n <= limit) d += c; });
    req.on('end', () => { if (n > limit) return no(new HttpError(413, 'Payload too large')); if (!d) return ok({}); try { const j = JSON.parse(d); ok(j && typeof j === 'object' ? j : {}); } catch { no(new HttpError(400, 'Invalid JSON body')); } });
    req.on('error', no);
  });
}

// CORS: CORS_ORIGIN if set (use * for any); otherwise allow localhost origins so dev servers like Live Server work.
const allow = o => cfg.corsOrigin ? (cfg.corsOrigin === '*' ? '*' : cfg.corsOrigin) : (o && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) ? o : '');

function createApp(opts = {}) {
  const limit = opts.rateLimitPerMin ?? cfg.rateLimitPerMin, hits = new Map();
  const sweeper = setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (v.reset < n) hits.delete(k); }, 60000); sweeper.unref();
  const rate = ip => { const n = Date.now(); let h = hits.get(ip); if (!h || h.reset < n) hits.set(ip, h = { n: 0, reset: n + 60000 }); return ++h.n <= limit; };
  const log = o => { if (cfg.logLevel !== 'silent') console.log(JSON.stringify({ t: new Date().toISOString(), ...o })); };

  const server = http.createServer(async (req, res) => {
    const id = crypto.randomUUID(), t0 = Date.now(), ip = req.socket.remoteAddress || '?';
    let status = 200;
    const headers = (extra = {}) => ({ 'x-request-id': id, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
      ...(allow(req.headers.origin) ? { 'access-control-allow-origin': allow(req.headers.origin), vary: 'Origin', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type' } : {}), ...extra });
    const json = (code, obj) => { status = code; res.writeHead(code, headers({ 'content-type': 'application/json', 'cache-control': 'no-store' })); res.end(JSON.stringify(obj)); };
    res.on('finish', () => log({ id, method: req.method, url: req.url.split('?')[0], status, ms: Date.now() - t0 }));
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'OPTIONS') { status = 204; res.writeHead(204, headers()); return res.end(); }
      if (url.pathname.startsWith('/api/')) {
        if (!rate(ip)) { res.setHeader('retry-after', '60'); throw new HttpError(429, 'Too many requests'); }
        let matched = false;
        for (const r of routes) {
          const m = r.re.exec(url.pathname);
          if (!m) continue;
          matched = true;
          if (r.method !== req.method) continue;
          const b = req.method === 'POST' ? await readBody(req) : {};
          return json(200, await r.fn(b, { ...m.groups }));
        }
        throw new HttpError(matched ? 405 : 404, matched ? 'Method not allowed' : 'Not found');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      let rel; try { rel = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'Bad path'); }
      const f = path.resolve(PUB, '.' + (rel === '/' ? '/index.html' : rel));
      if (!f.startsWith(PUB + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) throw new HttpError(404, 'Not found');
      status = 200;
      res.writeHead(200, headers({ 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': f.endsWith('.html') ? 'no-cache' : 'public, max-age=3600' }));
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(f).pipe(res);
    } catch (e) {
      if (res.headersSent) return res.end();
      const code = e.status || (e instanceof SyntaxError ? 400 : 500);
      if (code === 500) log({ id, level: 'error', error: e.stack });
      json(code, { error: code === 500 ? 'Internal server error' : e.message, ...(e.details ? { details: e.details } : {}), requestId: id });
    }
  });
  return server;
}
module.exports = { createApp };
