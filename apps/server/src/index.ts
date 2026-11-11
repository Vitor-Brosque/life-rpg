import { join } from 'node:path';
import { buildApp } from './app';
import { scheduleDailyBackup } from './backup';
import { loadConfig } from './config';
import { Hub } from './hub';
import { PushService } from './push';
import { RecordStore } from './store';

const cfg = loadConfig();
const store = new RecordStore(cfg.dbPath);
const hub = new Hub();
const push = new PushService(store, cfg.dataDir);
const stopPush = push.start();
const stopBackup = scheduleDailyBackup(store, cfg.dataDir);
const app = await buildApp(cfg, { store, hub, push });
await app.listen({ port: cfg.port, host: cfg.host });
console.log(`LIFE RPG server listening on http://${cfg.host}:${cfg.port}`);
console.log(`Access token file: ${join(cfg.dataDir, 'token')}`);

const shutdown = () => {
  stopPush();
  stopBackup();
  void app.close().then(() => {
    store.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
