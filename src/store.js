'use strict';
// Session store: in-memory Map with TTL expiry and atomic JSON-file persistence.
const fs = require('fs'), path = require('path');
const cfg = require('./config');
const { holds } = require('./tools');
const map = new Map();
let timer = null;
const file = () => path.join(cfg.dataDir, 'state.json');

function load() {
  if (!cfg.persist) return;
  try {
    const j = JSON.parse(fs.readFileSync(file(), 'utf8'));
    for (const s of j.sessions || []) map.set(s.id, s);
    for (const [k, v] of j.holds || []) holds.set(k, v);
  } catch {}
}
function flush() {
  if (!cfg.persist) return;
  try {
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ sessions: [...map.values()], holds: [...holds] }));
    fs.renameSync(tmp, file()); // atomic replace
  } catch (e) { console.error('persist failed:', e.message); }
}
function touch() { if (timer) return; timer = setTimeout(() => { timer = null; flush(); }, 500); timer.unref(); }
function sweep() {
  const cut = Date.now() - cfg.sessionTtlMin * 60000;
  for (const [id, s] of map) if ((s.updatedAt || 0) < cut) map.delete(id);
}
setInterval(() => { sweep(); touch(); }, 60000).unref();
load();

module.exports = {
  get(id) { const s = map.get(id); if (s) s.updatedAt = Date.now(); return s; },
  set(id, s) { s.updatedAt = Date.now(); map.set(id, s); touch(); return this; },
  has: id => map.has(id),
  delete(id) { const r = map.delete(id); touch(); return r; },
  get size() { return map.size; },
  touch, flush,
};
