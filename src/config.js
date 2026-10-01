'use strict';
const fs = require('fs'), path = require('path');
// Minimal .env loader (no dependencies). Real environment variables win.
try {
  for (const l of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && m[2] !== '' && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const e = process.env, int = (v, d) => (v !== undefined && v !== '' && Number.isFinite(+v) ? +v : d);
module.exports = {
  port: int(e.PORT, 3000),
  host: e.HOST || '0.0.0.0',
  dataDir: path.resolve(e.DATA_DIR || path.join(__dirname, '..', 'data')),
  persist: e.PERSIST !== 'false',
  sessionTtlMin: int(e.SESSION_TTL_MIN, 120),
  rateLimitPerMin: int(e.RATE_LIMIT_PER_MIN, 60),
  corsOrigin: e.CORS_ORIGIN || '',
  anthropicKey: e.ANTHROPIC_API_KEY || '',
  model: e.MODEL || 'claude-sonnet-4-6',
  logLevel: e.LOG || 'info',
};
