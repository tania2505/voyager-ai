'use strict';
// Claude tool-use loop. The model picks tools itself. execute_booking is NOT exposed:
// booking can only happen through the user-confirmed /api/book route.
const { TOOLS, LLM_TOOLS } = require('./tools');

const SYSTEM = `You are Voyager, a travel coordination agent. Use the tools to plan the trip described by the user.
Workflow: call check_missing first; if anything is missing, stop and ask for it. Otherwise search flights, hotels and transport (pass the user's constraints), call compare_options with the "options" arrays from the searches, call build_itinerary for the chosen hotel, then call prepare_booking with the total.
Never claim anything is booked. After prepare_booking, summarise the plan briefly and tell the user to confirm. If over budget, say by how much and suggest changes.`;

async function runLlmAgent(s, { callTool, log }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set. Use rule-based mode or add a key to .env');
  const tools = LLM_TOOLS.map(n => ({ name: n, description: TOOLS[n].description, input_schema: TOOLS[n].input_schema }));
  const r = s.request;
  const messages = [{ role: 'user', content: `Plan this trip: ${JSON.stringify(r)}` }];
  log(s, 'think', 'Plan', 'Claude is choosing tools autonomously.');
  for (let i = 0; i < 12; i++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.MODEL || 'claude-sonnet-4-6', max_tokens: 1500, system: SYSTEM, tools, messages }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || 'Anthropic API error');
    messages.push({ role: 'assistant', content: data.content });
    const uses = data.content.filter(b => b.type === 'tool_use');
    for (const b of data.content) if (b.type === 'text' && b.text.trim()) log(s, 'think', 'Claude', b.text.replace(/</g, '&lt;'));
    if (!uses.length) break;
    const results = [];
    for (const u of uses) {
      let out;
      try { out = callTool(s, u.name, u.input); } catch (e) { out = { error: e.message }; }
      results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 12000) });
    }
    messages.push({ role: 'user', content: results });
  }
  const c = s.results.compare_options, h = s.results.prepare_booking;
  if (c && !c.error) s.state.selected = { flight: c.best.f.id, hotel: c.best.h.id, transport: c.best.t.id, total: c.best.total, withinBudget: c.best.fits };
  if (h) { s.state.hold = h.holdId; s.state.status = 'awaiting confirmation'; }
  else s.state.status = 'blocked: needs more info';
}
module.exports = { runLlmAgent };
