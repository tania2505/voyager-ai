'use strict';
// Tiny rule-based natural-language extractor: turns a chat message into trip fields.
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const MW = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
const FULLMON = /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/i;
const STOP = `(?=\\s+(?:(?:on|in|for|with|from|between|starting|budget|under|around|about|next|and|at|leaving|departing)\\b|${MW}\\s*\\d)|[,.;!?\\d$]|\\s*$)`;
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const title = s => s.replace(/\b\w/g, c => c.toUpperCase());
const place = s => { const t = (s || '').trim(); return t && t.length <= 30 && !FULLMON.test(t) && !/^(the|a|an|my|our)$/i.test(t) ? title(t) : null; };
const num = s => +String(s).replace(/,/g, '');

function mkDate(m, d, today) {
  let y = today.getUTCFullYear();
  if (Date.UTC(y, m, d) < Date.UTC(y, today.getUTCMonth(), today.getUTCDate())) y++;
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
}

function extract(text, today = new Date()) {
  const t = text, out = {};
  let m;
  const ft = new RegExp(`from\\s+([a-z][a-z .'-]*?)\\s+to\\s+([a-z][a-z .'-]*?)${STOP}`, 'i').exec(t);
  if (ft) { out.origin = place(ft[1]); out.dest = place(ft[2]); }
  else {
    if ((m = new RegExp(`\\b(?:to|visit|in)\\s+([a-z][a-z .'-]*?)${STOP}`, 'i').exec(t))) out.dest = place(m[1]);
    if ((m = new RegExp(`\\bfrom\\s+([a-z][a-z .'-]*?)${STOP}`, 'i').exec(t))) out.origin = place(m[1]);
  }
  // dates
  const ds = [], re = new RegExp(`(\\d{4}-\\d{2}-\\d{2})|\\b(${MW})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b|\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MW})\\b`, 'gi');
  while ((m = re.exec(t))) {
    if (m[1]) { ds.push(m[1]); continue; }
    const mon = MON[(m[2] || m[5]).slice(0, 3).toLowerCase()], day = +(m[3] || m[4]);
    ds.push(mkDate(mon, day, today));
    const r = /^\s*(?:-|–|to|until|through)\s*(\d{1,2})\b(?!\s*(?:people|nights?|days?|travel|adults|k\b))/i.exec(t.slice(re.lastIndex));
    if (r) { ds.push(mkDate(mon, +r[1], today)); re.lastIndex += r[0].length; }
  }
  if (ds[0]) out.start = ds[0];
  if (ds[1]) out.end = ds[1];
  if ((m = /(\d+)\s*nights?/i.exec(t))) out.nights = +m[1];
  else if ((m = /(\d+)\s*days?/i.exec(t))) out.nights = Math.max(1, +m[1] - 1);
  else if (/\b(?:a|one)\s+week\b/i.test(t)) out.nights = 7;
  else if (/\bweekend\b/i.test(t)) out.nights = 2;
  // travelers
  if ((m = /(\d+|one|two|three|four|five|six)\s*(?:people|persons|travell?ers|adults|guests|friends|of us|pax)\b/i.exec(t) || /family of (\d+)/i.exec(t)))
    out.travelers = WORDS[m[1].toLowerCase()] || +m[1];
  else if (/\bcouple\b|\bhoneymoon\b/i.test(t)) out.travelers = 2;
  else if (/\bsolo\b|\balone\b|\bjust me\b/i.test(t)) out.travelers = 1;
  // budget
  if ((m = /\$\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?/i.exec(t) || /(?:budget|under|around|about|max|up to)\s*(?:of|is|:)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/i.exec(t) || /(\d[\d,]*)\s*()(?:usd|dollars|bucks)/i.exec(t)))
    out.budget = num(m[1]) * (m[2] ? 1000 : 1);
  if ((m = /(\d)\s*-?\s*stars?\b/i.exec(t))) out.stars = Math.min(5, Math.max(3, +m[1]));
  if (/\bbeach|seaside\b/i.test(t)) out.area = 'Beach';
  else if (/\bcent(?:er|re|ral)\b|downtown/i.test(t)) out.area = 'Center';
  else if (/\bquiet|peaceful\b/i.test(t)) out.area = 'Quiet';
  if (/non-?stop|direct flights?/i.test(t)) out.nonstop = true;
  const it = []; const K = { food: /food|eat|restaurant|cuisine/i, museums: /museum|history|art\b|gallery/i, nature: /nature|hik|park|outdoor/i, nightlife: /nightlife|bars?\b|club/i, shopping: /shopping|markets?\b/i };
  for (const k in K) if (K[k].test(t)) it.push(k);
  if (it.length) out.interests = it;
  for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
  return out;
}
module.exports = { extract };
