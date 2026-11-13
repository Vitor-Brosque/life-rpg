import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_LIMITS } from '@life/shared';

/** Optional AI (Marco 7): present only when ANTHROPIC_API_KEY is set. The key never leaves the server. */
export interface AiConfig {
  apiKey: string;
  dailyLimit: number;
}

export interface ServerConfig {
  port: number;
  /** Interface to listen on: '0.0.0.0' in Docker, '127.0.0.1' for local-only use. */
  host: string;
  dataDir: string;
  token: string;
  webDir?: string;
  dbPath: string;
  ai?: AiConfig;
}

function aiConfig(env: NodeJS.ProcessEnv): AiConfig | undefined {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return undefined;
  const limit = Number(env.LIFE_RPG_AI_DAILY_LIMIT);
  return {
    apiKey,
    dailyLimit: Number.isInteger(limit) && limit >= 1 && limit <= 1000 ? limit : AI_LIMITS.dailyDefault,
  };
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
    host: env.LIFE_RPG_HOST || '0.0.0.0',
    dataDir,
    token,
    webDir: env.LIFE_RPG_WEB_DIR || undefined,
    dbPath: join(dataDir, 'life-rpg.sqlite'),
    ai: aiConfig(env),
  };
}
