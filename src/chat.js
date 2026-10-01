'use strict';
// Conversational layer: keeps a trip draft across messages, asks for what is missing,
// runs the planning workflow, and gates booking behind an explicit "confirm".
const { sessions, newSession, runRuleAgent, callTool, log, book, makePlan, esc } = require('./agent');
const { extract } = require('./nlu');

const ASK = { 'origin city': 'where you are flying from', destination: 'where you want to go', 'start date': 'your departure date', 'end date': 'your return date (or how many nights)', 'valid dates (end must be after start)': 'valid dates (return must be after departure)', 'number of travelers': 'how many people are travelling', budget: 'your total budget' };
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

async function chat(id, message, mode) {
  const s = (id && sessions.get(id)) || newSession({ interests: [], stars: 3, nonstop: false });
  const d = s.request, mark = s.trace.length;
  const say = t => log(s, 'say', 'Voyager', esc(t).replace(/\n/g, '<br>'));
  const out = () => {
    const events = s.trace.slice(mark);
    const planned = events.some(e => e.html.includes('compare_options'));
    return { sessionId: s.id, events, plan: planned ? makePlan(s) : null, state: s.state, draft: d };
  };
  const text = String(message || '').trim().slice(0, 500);
  try {
    if (s.state.status === 'booked') { say('That trip is already booked. Press "New trip" to plan another.'); return out(); }
    if (s.state.status === 'awaiting confirmation') {
      if (/^(?:yes|yep|yeah|confirm(?:\s*&\s*book)?|book(?: it)?|go ahead|do it|sure|ok|okay)[\s.!]*$/i.test(text)) {
        book(s.id, true); say(`Booked! Your confirmation reference is ${s.state.reference}. Have a great trip.`); return out();
      }
      if (/^(?:no|cancel|stop|never ?mind)[\s.!]*$/i.test(text)) {
        book(s.id, false); say('Okay, I released the hold. Tell me what to change and I will plan again.'); return out();
      }
    }
    const f = extract(text);
    if (!Object.keys(f).length) {
      say(d.dest ? 'I did not catch a change there. You can adjust things like budget, dates, travelers, hotel stars, area or interests.'
        : 'Hi! Tell me about your trip: where from and to, dates, how many people and your budget. For example: "Delhi to Lisbon, Dec 1 to Dec 6, 2 people, $3200".');
      return out();
    }
    const { interests, nights, ...rest } = f;
    Object.assign(d, rest);
    if (interests) d.interests = [...new Set([...(d.interests || []), ...interests])];
    if (nights) d.nights = nights;
    if (d.start && d.nights && !rest.end && (!d.end || rest.start || nights)) d.end = addDays(d.start, d.nights);

    const mi = callTool(s, 'check_missing', d);
    if (mi.missing.length) {
      s.state.status = 'collecting';
      say(`Got it. To plan this I still need ${mi.missing.map(m => ASK[m] || m).join(', ')}.`);
      return out();
    }
    say(`Great, I have what I need. Planning ${d.origin} to ${d.dest} for ${d.travelers} traveler(s) on a $${d.budget} budget.`);
    s.results = {}; s.state.status = 'running';
    if (mode === 'llm') await require('./llmAgent').runLlmAgent(s, { callTool, log });
    else await runRuleAgent(s, true);
    const p = makePlan(s);
    if (s.state.status === 'awaiting confirmation' && p) {
      const b = p.best;
      say(`My recommendation: ${b.f.airline}, ${b.h.name} (${b.h.stars} stars) and ${b.t.name} for $${b.total}${b.fits ? ', within your budget' : `, which is $${b.total - d.budget} over budget`}. I have placed a hold. Reply "confirm" to book, or tell me what to change.`);
    } else say('I could not build a valid plan with these constraints. Try relaxing the nonstop or star requirement, or changing the budget.');
  } catch (e) { say('Something went wrong: ' + e.message); s.state.status = 'error'; }
  return out();
}
module.exports = { chat };
