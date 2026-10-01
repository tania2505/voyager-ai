'use strict';
// Request validation. Each function returns a list of error strings (empty = valid).
const isStr = v => typeof v === 'string';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const mode = m => (m === undefined || m === 'rules' || m === 'llm') ? [] : ['mode must be "rules" or "llm"'];

exports.chatBody = b => {
  const e = [...mode(b.mode)];
  if (!isStr(b.message) || !b.message.trim()) e.push('message must be a non-empty string');
  else if (b.message.length > 500) e.push('message must be at most 500 characters');
  if (b.sessionId != null && !isStr(b.sessionId)) e.push('sessionId must be a string');
  return e;
};
exports.planBody = b => {
  const r = b.request, e = [...mode(b.mode)];
  if (!r || typeof r !== 'object' || Array.isArray(r)) return ['request must be an object', ...e];
  for (const k of ['origin', 'dest', 'area']) if (r[k] != null && (!isStr(r[k]) || r[k].length > 60)) e.push(`${k} must be a string up to 60 characters`);
  for (const k of ['start', 'end']) if (r[k] && !(isStr(r[k]) && DATE.test(r[k]))) e.push(`${k} must be YYYY-MM-DD`);
  if (r.travelers != null && !(Number.isInteger(r.travelers) && r.travelers >= 1 && r.travelers <= 9)) e.push('travelers must be an integer 1-9');
  if (r.budget != null && !(typeof r.budget === 'number' && r.budget > 0 && r.budget <= 1e7)) e.push('budget must be a number between 1 and 10,000,000');
  if (r.stars != null && !(Number.isInteger(r.stars) && r.stars >= 3 && r.stars <= 5)) e.push('stars must be 3, 4 or 5');
  if (r.interests != null && !(Array.isArray(r.interests) && r.interests.length <= 10 && r.interests.every(isStr))) e.push('interests must be an array of up to 10 strings');
  return e;
};
exports.bookBody = b => {
  const e = [];
  if (!isStr(b.sessionId) || !b.sessionId) e.push('sessionId is required');
  if (typeof b.confirmed !== 'boolean') e.push('confirmed must be true or false');
  return e;
};
