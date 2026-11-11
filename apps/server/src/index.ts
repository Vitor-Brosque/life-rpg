import { buildApp } from './app';
import { loadConfig } from './config';

const cfg = loadConfig();
const app = await buildApp(cfg);
await app.listen({ port: cfg.port, host: '0.0.0.0' });
console.log(`LIFE RPG server listening on :${cfg.port}`);

const shutdown = () => {
  void app.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
