/**
 * Runs the end-to-end game against a worker this script starts and stops itself.
 *
 * `test:e2e` expects a worker already running (fast to re-run while you iterate).
 * CI has no such worker, so this wrapper boots one, waits for it to answer
 * /api/health, runs the same suite against it, and tears it down. SPEC 7.5.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.REBUS_E2E_PORT ?? 8787);
const BASE = `http://127.0.0.1:${PORT}`;
const BOOT_TIMEOUT_MS = 90_000;

// wrangler refuses to boot when assets.directory is missing, and the failure
// mode ("directory does not exist") reads nothing like "you forgot to build".
if (!existsSync(join(root, 'client/dist/index.html'))) {
  console.error('client/dist is missing — run `npm run build` first.');
  process.exit(1);
}

const worker = spawn(
  'npx',
  ['wrangler', 'dev', '--port', String(PORT), '--config', 'server/wrangler.toml'],
  // detached so the whole npx -> wrangler -> workerd group can be signalled at once.
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
);

let log = '';
worker.stdout.on('data', (d) => (log += d));
worker.stderr.on('data', (d) => (log += d));

let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  // The tree is npx -> wrangler -> workerd; kill the group, not just the parent.
  try {
    process.kill(-worker.pid, 'SIGTERM');
  } catch {
    worker.kill('SIGTERM');
  }
};
process.on('exit', stop);
process.on('SIGINT', () => (stop(), process.exit(130)));

const fail = (msg) => {
  console.error(`${msg}\n--- wrangler output ---\n${log}`);
  stop();
  process.exit(1);
};

worker.on('exit', (code) => {
  if (!stopped) fail(`wrangler exited early with code ${code}`);
});

const deadline = Date.now() + BOOT_TIMEOUT_MS;
let ready = false;
while (Date.now() < deadline) {
  try {
    const res = await fetch(`${BASE}/api/health`);
    if (res.ok) {
      ready = true;
      break;
    }
  } catch {
    // not listening yet
  }
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) fail(`worker did not answer ${BASE}/api/health within ${BOOT_TIMEOUT_MS}ms`);

console.log(`worker ready on ${BASE}\n`);

const e2e = spawn(
  process.execPath,
  ['--experimental-strip-types', join(root, 'test/e2e.mjs')],
  { cwd: root, stdio: 'inherit', env: { ...process.env, REBUS_URL: BASE } },
);
const [code] = await once(e2e, 'exit');
stop();
process.exit(code ?? 1);
