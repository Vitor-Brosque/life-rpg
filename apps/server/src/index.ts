import { join } from 'node:path';
import { buildApp } from './app';
import { scheduleDailyBackup } from './backup';
import { loadConfig } from './config';
import { Hub } from './hub';
import { MediaStore } from './media';
import { PushService } from './push';
import { RecordStore } from './store';
import { buildAssistApp } from './assist/http';
import { AssistService } from './assist/service';

const cfg = loadConfig();
const store = new RecordStore(cfg.dbPath);
const hub = new Hub();
const push = new PushService(store, cfg.dataDir);
const stopPush = push.start();
const stopBackup = scheduleDailyBackup(store, cfg.dataDir);
const media = new MediaStore(join(cfg.dataDir, 'media'));
const assist = new AssistService(store, hub, cfg.token, Date.now, media);
const app = await buildApp(cfg, { store, hub, push, media, assist });
await app.listen({ port: cfg.port, host: cfg.host });
const assistApp = (cfg.assistPort ?? 0) > 0 ? await buildAssistApp(assist) : undefined;
if (assistApp) {
  await assistApp.listen({ port: cfg.assistPort, host: cfg.host });
  console.log(`Assistentes (MCP): porta ${cfg.assistPort}, ${assist.ready ? 'ligados' : 'desligados (ligue em Ajustes → Assistentes)'}`);
}
console.log(`LIFE RPG server listening on http://${cfg.host}:${cfg.port}`);
console.log(`Access token file: ${join(cfg.dataDir, 'token')}`);
console.log(cfg.ai ? `IA: ligada (até ${cfg.ai.dailyLimit} pedidos por dia)` : 'IA: desligada (sem ANTHROPIC_API_KEY)');

const shutdown = () => {
  stopPush();
  stopBackup();
  void Promise.all([app.close(), assistApp?.close()]).then(() => {
    store.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
