'use strict';
const cfg = require('./src/config');
const store = require('./src/store');
const { createApp } = require('./src/httpApp');

const server = createApp();
server.listen(cfg.port, cfg.host, () => console.log(`Voyager listening on http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port} (llm: ${cfg.anthropicKey ? 'on' : 'off'}, persist: ${cfg.persist})`));

function shutdown(sig) {
  console.log(`${sig} received, shutting down`);
  store.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', e => console.error('unhandledRejection:', e));
process.on('uncaughtException', e => console.error('uncaughtException:', e));
