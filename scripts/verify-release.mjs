import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Runs without provider credentials against a disposable production database.
// Passing this suite never asserts live PayPal or submission eligibility.
const results = [];
const env = { ...process.env, GEMINI_API_KEY: '', PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '', PAYPAL_MERCHANT_ID: '', PAYPAL_WEBHOOK_ID: '', APP_URL: '' };
async function run(name, args, extraEnv = env) {
  const startedAt = new Date().toISOString();
  const code = await new Promise((resolveCode, reject) => {
    const child = spawn(process.execPath, args, { env: extraEnv, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => resolveCode(code ?? 1));
  });
  results.push({ name, startedAt, passed: code === 0 });
  if (code !== 0) throw new Error(`${name} failed`);
}
let server;
try {
  await run('lint', ['node_modules/@biomejs/biome/bin/biome', 'lint', 'src', 'tests', 'scripts']);
  await run('unit and service tests', ['--test', 'tests/*.test.mjs']);
  await run('production build and type validation', ['node_modules/next/dist/bin/next', 'build']);
  const databaseDirectory = await mkdtemp(join(tmpdir(), 'buywise-release-'));
  const port = Number(process.env.RELEASE_TEST_PORT || 3107);
  const base = `http://127.0.0.1:${port}`;
  const testEnv = { ...env, DATABASE_PATH: join(databaseDirectory, 'test.db'), TEST_BASE_URL: base };
  // Refuse an occupied port rather than accidentally testing another application.
  const net = await import('node:net');
  await new Promise((ok, fail) => {
    const probe = net.createServer();
    probe.once('error', fail);
    probe.listen(port, '127.0.0.1', () => probe.close(ok));
  });
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env: testEnv, stdio: 'inherit' });
  let startError;
  server.on('error', error => { startError = error; });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (startError || server.exitCode !== null) throw startError || new Error('Production server stopped');
    try { ready = (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Startup polling only. */ }
    if (ready) break;
    await new Promise(r => setTimeout(r, 500));
  }
  if (!ready) throw new Error('Production server did not become ready');
  await run('production HTTP boundaries', ['scripts/http-smoke.mjs'], testEnv);
  await run('production browser workflow and exports', ['scripts/browser-acceptance.mjs'], testEnv);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) {
    const stopped = new Promise(r => server.once('exit', r));
    server.kill();
    await stopped;
  }
  await mkdir('artifacts', { recursive: true });
  await writeFile(resolve('artifacts/release-verification.json'), JSON.stringify({
    checkedAt: new Date().toISOString(), passed: process.exitCode !== 1,
    scope: 'Offline production acceptance only. No live provider or public submission verification.', results,
  }, null, 2));
}
