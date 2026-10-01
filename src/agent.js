'use strict';
const crypto = require('crypto');
const { TOOLS, nightsBetween } = require('./tools');

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sessions = require('./store');

function newSession(request) {
  const s = { id: crypto.randomUUID(), createdAt: Date.now(), request, trace: [], results: {}, state: { request, toolCalls: [], status: 'running' } };
  sessions.set(s.id, s);
  return s;
}
const log = (s, kind, tag, html) => s.trace.push({ kind, tag, html });

// Run a tool, log it, keep results in session state.
function callTool(s, name, args) {
  log(s, 'tool', 'Tool call', `<code>${name}</code> <span class="empty">${esc(JSON.stringify(args).slice(0, 160))}</span>`);
  s.state.toolCalls.push(name);
  const out = TOOLS[name].run(args);
  s.results[name] = out;
  return out;
}

function makePlan(s) {
  const c = s.results.compare_options, it = s.results.build_itinerary;
  if (!c || c.error || !it) return null;
  const r = s.request;
  return { best: c.best, top: c.top, itinerary: it.itinerary, nights: nightsBetween(r.start, r.end), rooms: Math.ceil(r.travelers / 2), request: r };
}

// Deterministic workflow: validate -> search -> compare -> itinerary -> hold.
async function runRuleAgent(s, skip) {
  const r = s.request;
  if (!skip) {
  log(s, 'think', 'Plan', 'Steps: validate request, search flights/hotels/transport, filter by constraints, compare against budget, draft itinerary, hold booking and wait for confirmation.');
  const mi = callTool(s, 'check_missing', r);
  if (mi.missing.length) {
    log(s, 'warn', 'Missing information', `I cannot proceed without: <b>${esc(mi.missing.join(', '))}</b>. Fill these in and run me again.`);
    s.state.status = 'blocked: missing info'; return;
  }
  log(s, 'res', 'Result', 'Request is complete.');
  }
  const days = nightsBetween(r.start, r.end) + 1;

  const fl = callTool(s, 'search_flights', { origin: r.origin, dest: r.dest, start: r.start, travelers: r.travelers, nonstop: r.nonstop });
  log(s, 'res', 'Result', `${fl.options.length} flights kept${fl.excluded ? `, ${fl.excluded} dropped (nonstop only)` : ''}.`);
  const ho = callTool(s, 'search_hotels', { dest: r.dest, start: r.start, end: r.end, travelers: r.travelers, minStars: r.stars, area: r.area });
  log(s, 'res', 'Result', `${ho.options.length} hotels kept, ${ho.excluded} below ${r.stars} stars excluded. Area "${esc(r.area || 'none')}" is a ranking bonus.`);
  const tr = callTool(s, 'search_transport', { dest: r.dest, days, travelers: r.travelers });
  log(s, 'res', 'Result', `${tr.options.length} local transport options.`);

  log(s, 'think', 'Compare', `Scoring every combination against the $${r.budget} budget.`);
  const c = callTool(s, 'compare_options', { flights: fl.options, hotels: ho.options, transport: tr.options, budget: r.budget });
  if (c.error) { log(s, 'warn', 'No valid options', esc(c.error)); s.state.status = 'blocked: no options'; return; }
  if (c.best.fits) log(s, 'res', 'Decision', `${c.fitCount} of ${c.totalCombos} combinations fit. Best: <b>${esc(c.best.f.airline)}</b> + <b>${esc(c.best.h.name)}</b> + <b>${esc(c.best.t.name)}</b> at $${c.best.total}.`);
  else log(s, 'warn', 'Over budget', `Nothing fits $${r.budget}. Cheapest valid option is $${c.best.total}, which is $${c.overBy} over. Try raising the budget, shortening the trip or lowering the star minimum.`);
  s.state.selected = { flight: c.best.f.id, hotel: c.best.h.id, transport: c.best.t.id, total: c.best.total, withinBudget: c.best.fits };

  callTool(s, 'build_itinerary', { days, interests: r.interests, hotelName: c.best.h.name });
  log(s, 'res', 'Result', `${days}-day itinerary drafted.`);
  const h = callTool(s, 'prepare_booking', { total: c.best.total });
  s.state.hold = h.holdId; s.state.status = 'awaiting confirmation';
  log(s, 'warn', 'Awaiting confirmation', `Hold <code>${h.holdId}</code> created (${h.expiresIn}). I will not book until you press "Confirm & book".`);
}

async function plan(request, mode) {
  const s = newSession(request);
  try {
    if (mode === 'llm') await require('./llmAgent').runLlmAgent(s, { callTool, log });
    else await runRuleAgent(s);
  } catch (e) {
    log(s, 'warn', 'Error', esc(e.message)); s.state.status = 'error';
  }
  return s;
}

function book(id, confirmed) {
  const s = sessions.get(id);
  if (!s) throw Object.assign(new Error('Unknown session'), { status: 404 });
  if (s.state.status !== 'awaiting confirmation') throw Object.assign(new Error('Nothing is awaiting confirmation'), { status: 409 });
  log(s, 'think', 'User action', confirmed ? 'User explicitly confirmed the booking.' : 'User cancelled.');
  if (!confirmed) { s.state.status = 'cancelled'; log(s, 'warn', 'Cancelled', 'Hold released. Nothing was booked.'); return s; }
  const res = callTool(s, 'execute_booking', { holdId: s.state.hold, confirmed: true });
  s.state.status = 'booked'; s.state.reference = res.reference;
  log(s, 'res', 'Booked', `Reference <b>${res.reference}</b>`);
  return s;
}

module.exports = { plan, book, makePlan, sessions, newSession, runRuleAgent, callTool, log, esc };
