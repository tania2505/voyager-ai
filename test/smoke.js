'use strict';
process.env.PERSIST = 'false';
const assert = require('assert');
const { plan, book } = require('../src/agent');
(async () => {
  const req = { origin: 'Delhi', dest: 'Lisbon', start: '2026-12-01', end: '2026-12-06', travelers: 2, budget: 3200, area: 'Center', stars: 4, nonstop: false, interests: ['food'] };
  const s = await plan({ ...req, start: '' });
  assert.equal(s.state.status, 'blocked: missing info');
  const ok = await plan(req);
  assert.equal(ok.state.status, 'awaiting confirmation');
  assert.throws(() => require('../src/tools').TOOLS.execute_booking.run({ holdId: ok.state.hold, confirmed: false }));
  assert.equal(book(ok.id, true).state.status, 'booked');
  assert.throws(() => book(ok.id, true));
  console.log('smoke tests passed');
})();
(async () => {
  const { chat } = require('../src/chat');
  let r = await chat(null, 'Beach holiday in Bali for 4 nights, 3 travelers');
  assert.equal(r.state.status, 'collecting');
  r = await chat(r.sessionId, 'from Delhi, Dec 1, budget $4000');
  assert.equal(r.state.status, 'awaiting confirmation'); assert.ok(r.plan);
  r = await chat(r.sessionId, 'confirm');
  assert.equal(r.state.status, 'booked');
  console.log('chat tests passed');
})();
