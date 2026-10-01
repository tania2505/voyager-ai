const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = n => '$' + Math.round(n).toLocaleString();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let session = null;
// Talks to the backend. Gives a clear message when the page is not served by the Voyager server
// (the usual cause of "Unexpected end of JSON input").
const API = location.protocol === 'file:' ? 'http://localhost:3000' : (new URLSearchParams(location.search).get('api') || '');
async function call(path, opts) {
  let r, text = '';
  try { r = await fetch(API + path, opts); text = await r.text(); }
  catch { throw new Error('Cannot reach the Voyager backend. Start it with "npm start" and open http://localhost:3000'); }
  let j = null; try { j = text ? JSON.parse(text) : null; } catch {}
  if (!j) throw new Error(`The server did not return JSON (HTTP ${r.status}). This page must be served by the Voyager backend: run "npm start" and open http://localhost:3000`);
  if (!r.ok) throw new Error(j.error + (j.details ? ': ' + j.details.join('; ') : ''));
  return j;
}
const api = (path, payload) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });

// ---- nav drawer + side views ----
const asd = document.querySelector('aside'), ov = $('ov');
const tg = o => { asd.classList.toggle('open', o); ov.classList.toggle('on', o); };
$('ham').onclick = () => tg(!asd.classList.contains('open'));
ov.onclick = () => tg(false);
document.addEventListener('keydown', e => { if (e.key === 'Escape') tg(false); });
document.querySelectorAll('.nv').forEach(b => b.onclick = () => {
  document.querySelectorAll('.nv').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + b.dataset.v));
  tg(false);
});
call('/api/tools').then(t => { $('tl').innerHTML = t.map(x => `<div><code>${x.name}</code> ${x.description}</div>`).join(''); }).catch(() => { $('tl').innerHTML = '<div>Backend not reachable.</div>'; });

// ---- chat ----
const msgs = $('msgs');
const fd = n => { const x = new Date(); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
const EXAMPLES = [`Trip from Delhi to Lisbon, ${fd(45)} to ${fd(50)}, 2 people, $3200`, 'Beach holiday in Bali for 4 nights, 3 travelers, budget $4000', 'Weekend in Paris from London, nonstop, 4-star, food and museums'];
const scroll = () => { msgs.scrollTop = msgs.scrollHeight; };
function bubble(cls, html) { const m = document.createElement('div'); m.className = 'm ' + cls; m.innerHTML = `<div class="bub">${html}</div>`; msgs.appendChild(m); scroll(); return m; }
function stepCard(x) { const el = document.createElement('div'); el.className = 'step ' + x.kind; el.innerHTML = `<div class="tag">${x.tag}</div>${x.html}`; msgs.appendChild(el); scroll(); }
function setChips(list) {
  $('chips').innerHTML = '';
  list.forEach(t => { const b = document.createElement('button'); b.className = 'chip'; b.textContent = t; b.onclick = () => t === 'Plan a new trip' ? newTrip() : send(t); $('chips').appendChild(b); });
}
function renderDraft(d = {}) {
  const row = (k, v) => `<div class="row2"><span>${k}</span><span class="${v ? '' : 'no'}">${v || '—'}</span></div>`;
  $('draft').innerHTML = row('From', d.origin) + row('To', d.dest) + row('Dates', d.start && d.end ? `${d.start} → ${d.end}` : d.start) + row('Travelers', d.travelers) + row('Budget', d.budget && fmt(d.budget))
    + row('Min stars', d.stars) + row('Area', d.area) + row('Nonstop', d.nonstop ? 'yes' : 'no') + row('Interests', (d.interests || []).join(', '));
}
function newTrip() {
  session = null; msgs.innerHTML = ''; $('state').textContent = '{}'; renderDraft();
  bubble('a', 'Hi, I am Voyager. Tell me where you want to go, when, how many people and your budget, and I will search flights, hotels and transport, compare them and draft an itinerary. I only book after you confirm.');
  setChips(EXAMPLES);
}
async function send(text) {
  text = text.trim(); if (!text) return;
  bubble('u', esc(text)); $('msg').value = ''; setChips([]); $('send').disabled = true;
  const typing = bubble('a', '<span class="dots"><i></i><i></i><i></i></span>');
  try {
    const out = await api('/api/chat', { sessionId: session, message: text, mode: $('mode').value });
    session = out.sessionId; typing.remove();
    for (const e of out.events) { e.kind === 'say' ? bubble('a', e.html) : stepCard(e); await sleep(e.kind === 'say' ? 250 : 380); }
    if (out.plan) bubble('a plan', planHtml(out.plan));
    renderDraft(out.draft); $('state').textContent = JSON.stringify(out.state, null, 1);
    const st = out.state.status;
    setChips(st === 'awaiting confirmation' ? ['Confirm & book', 'Cancel', 'Make it 5-star', 'Nonstop only', 'Budget 5000'] : st === 'booked' ? ['Plan a new trip'] : out.draft.dest ? [] : EXAMPLES);
  } catch (err) { typing.remove(); bubble('a', 'Error: ' + esc(err.message)); }
  $('send').disabled = false; $('msg').focus();
}
$('send').onclick = () => send($('msg').value);
$('msg').addEventListener('keydown', e => { if (e.key === 'Enter') send($('msg').value); });
$('newtrip').onclick = newTrip;

function planHtml(p) {
  const b = p.best, r = p.request;
  return `<div class="sum"><span class="pill">${r.origin} → ${r.dest}</span><span class="pill">${r.start} – ${r.end} (${p.nights}n)</span><span class="pill">${r.travelers} traveler${r.travelers > 1 ? 's' : ''}</span><span class="pill ${b.fits ? 'pick' : 'out'}">${fmt(b.total)} / ${fmt(r.budget)}</span></div>
  <div class="scroll"><table><tr><th>Item</th><th>Choice</th><th>Details</th><th>Cost</th></tr>
  <tr><td>Flight</td><td>${b.f.airline}</td><td>${b.f.stops ? '1 stop' : 'nonstop'}, ${b.f.hours}h</td><td>${fmt(b.f.total)}</td></tr>
  <tr><td>Hotel</td><td>${b.h.name} ${'★'.repeat(b.h.stars)}</td><td>${b.h.area}, ${p.rooms} room(s) × ${p.nights}n</td><td>${fmt(b.h.total)}</td></tr>
  <tr><td>Transport</td><td>${b.t.name}</td><td>whole trip</td><td>${fmt(b.t.cost)}</td></tr></table></div>
  <h2 style="margin-top:14px">Itinerary</h2>${p.itinerary.map(x => `<div class="day"><b>Day ${x.day}</b><ul>${x.items.map(i => `<li>${i}</li>`).join('')}</ul></div>`).join('')}
  <h2>Alternatives considered</h2><div class="scroll"><table><tr><th>Flight</th><th>Hotel</th><th>Transport</th><th>Total</th><th>Fits</th></tr>
  ${p.top.map(c => `<tr><td>${c.f.airline}</td><td>${c.h.name}</td><td>${c.t.name}</td><td>${fmt(c.total)}</td><td class="${c.fits ? 'pick' : 'out'}">${c.fits ? 'yes' : 'no'}</td></tr>`).join('')}</table></div>`;
}
newTrip();
call('/api/health').catch(e => bubble('a', '⚠️ ' + esc(e.message)));
