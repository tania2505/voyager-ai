'use strict';
process.env.PERSIST = 'false';
process.env.LOG = 'silent';
process.env.ANTHROPIC_API_KEY = '';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createApp } = require('../src/httpApp');

const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)));
const close = s => new Promise(r => { s.closeAllConnections?.(); s.close(r); });
const post = (base, p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
let server, base;
before(async () => { server = createApp({ rateLimitPerMin: 1000 }); base = await listen(server); });
after(() => close(server));

test('health and tools', async () => {
  const h = await (await fetch(base + '/api/health')).json();
  assert.equal(h.status, 'ok'); assert.equal(h.llm, false);
  const t = await (await fetch(base + '/api/tools')).json();
  assert.ok(t.some(x => x.name === 'search_flights'));
});

test('chat flow: missing info -> plan -> confirm -> booked', async () => {
  let r = await (await post(base, '/api/chat', { message: 'Beach holiday in Bali for 4 nights, 3 travelers' })).json();
  assert.equal(r.state.status, 'collecting');
  r = await (await post(base, '/api/chat', { sessionId: r.sessionId, message: 'from Delhi, Dec 1, budget $4000' })).json();
  assert.equal(r.state.status, 'awaiting confirmation'); assert.ok(r.plan);
  r = await (await post(base, '/api/chat', { sessionId: r.sessionId, message: 'confirm' })).json();
  assert.equal(r.state.status, 'booked'); assert.match(r.state.reference, /^VYG-/);
  const g = await (await fetch(`${base}/api/sessions/${r.sessionId}`)).json();
  assert.equal(g.state.status, 'booked');
});

test('structured plan + explicit booking gate', async () => {
  const request = { origin: 'Delhi', dest: 'Lisbon', start: '2026-12-01', end: '2026-12-06', travelers: 2, budget: 3200, stars: 4, interests: ['food'] };
  const p = await (await post(base, '/api/plan', { request })).json();
  assert.equal(p.state.status, 'awaiting confirmation');
  const no = await (await post(base, '/api/book', { sessionId: p.sessionId, confirmed: false })).json();
  assert.equal(no.state.status, 'cancelled');
  const again = await post(base, '/api/book', { sessionId: p.sessionId, confirmed: true });
  assert.equal(again.status, 409);
});

test('validation and errors', async () => {
  let r = await post(base, '/api/chat', { message: '' }); assert.equal(r.status, 422);
  r = await post(base, '/api/plan', { request: { travelers: 99 } }); assert.equal(r.status, 422);
  r = await post(base, '/api/book', { sessionId: 'nope', confirmed: true }); assert.equal(r.status, 404);
  r = await fetch(base + '/api/chat', { method: 'POST', body: '{bad' }); assert.equal(r.status, 400);
  r = await fetch(base + '/api/nothing'); assert.equal(r.status, 404);
  r = await fetch(base + '/api/health', { method: 'POST' }); assert.equal(r.status, 405);
  r = await post(base, '/api/chat', { message: 'hi', mode: 'llm' }); assert.equal(r.status, 400);
  r = await fetch(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'x'.repeat(200000) }) });
  assert.equal(r.status, 413); assert.ok((await r.json()).error);
  r = await fetch(base + '/api/chat', { method: 'POST' }); assert.equal(r.status, 422); assert.ok((await r.json()).details); // empty body still returns JSON
});

test('static files and traversal protection', async () => {
  const idx = await fetch(base + '/'); assert.equal(idx.status, 200);
  assert.match(await idx.text(), /id="msgs"/);
  assert.equal(idx.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(base + '/%2e%2e%2fserver.js')).status, 404);
  assert.equal((await fetch(base + '/bg.svg')).headers.get('content-type'), 'image/svg+xml');
});

test('rate limiting', async () => {
  const s = createApp({ rateLimitPerMin: 2 }), b = await listen(s);
  const codes = []; for (let i = 0; i < 3; i++) codes.push((await fetch(b + '/api/health')).status);
  assert.deepEqual(codes, [200, 200, 429]);
  await close(s);
});

test('CORS for local dev servers', async () => {
  const ok = await fetch(base + '/api/health', { headers: { origin: 'http://localhost:5500' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5500');
  const pre = await fetch(base + '/api/chat', { method: 'OPTIONS', headers: { origin: 'http://127.0.0.1:5500' } });
  assert.equal(pre.status, 204);
  const bad = await fetch(base + '/api/health', { headers: { origin: 'https://evil.example' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});
