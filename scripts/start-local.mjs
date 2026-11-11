// Starts LIFE RPG on this computer: the built server + web app, data in <repo>/data,
// listening only on 127.0.0.1. Usage: `npm start` (or `npm run local` to rebuild first).
// Pass --open to open the browser once the server answers.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const env = process.env;
env.LIFE_RPG_DATA_DIR ||= join(root, 'data');
env.LIFE_RPG_WEB_DIR ||= join(root, 'apps', 'web', 'dist');
env.LIFE_RPG_HOST ||= '127.0.0.1';
env.LIFE_RPG_PORT ||= '8787';

const url = `http://localhost:${env.LIFE_RPG_PORT}`;
const shouldOpen = process.argv.includes('--open');

function openBrowser() {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

async function isRunning() {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

if (await isRunning()) {
  console.log(`O LIFE RPG já está rodando em ${url}`);
  if (shouldOpen) openBrowser();
  process.exit(0);
}

const serverEntry = join(root, 'apps', 'server', 'dist', 'index.js');
if (!existsSync(serverEntry) || !existsSync(join(env.LIFE_RPG_WEB_DIR, 'index.html'))) {
  console.log('Primeira execução: construindo o app...');
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true });
  if (build.status !== 0) {
    console.error('Não consegui construir o app. Rode "npm install" e tente de novo.');
    process.exit(1);
  }
}

await import(pathToFileURL(serverEntry).href);

console.log('');
console.log(`LIFE RPG aberto em ${url}  (só neste computador)`);
console.log(`Dados: ${env.LIFE_RPG_DATA_DIR}`);
console.log(`Código de acesso (Ajustes > Sincronização): ${join(env.LIFE_RPG_DATA_DIR, 'token')}`);
console.log('Para parar, feche esta janela ou pressione Ctrl+C.');
if (shouldOpen) openBrowser();
