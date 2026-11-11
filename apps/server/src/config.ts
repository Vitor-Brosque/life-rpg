import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ServerConfig {
  port: number;
  dataDir: string;
  token: string;
  webDir?: string;
  dbPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.LIFE_RPG_PORT ?? 8787);
  const dataDir = env.LIFE_RPG_DATA_DIR ?? './data';
  mkdirSync(dataDir, { recursive: true });

  let token = env.LIFE_RPG_TOKEN;
  if (!token) {
    const tokenFile = join(dataDir, 'token');
    if (existsSync(tokenFile)) {
      token = readFileSync(tokenFile, 'utf8').trim();
    }
    if (!token) {
      token = randomBytes(16).toString('hex');
      writeFileSync(tokenFile, token + '\n', { mode: 0o600 });
      console.log(`Access token created at ${tokenFile}`);
    }
  }

  return {
    port,
    dataDir,
    token,
    webDir: env.LIFE_RPG_WEB_DIR || undefined,
    dbPath: join(dataDir, 'life-rpg.sqlite'),
  };
}
