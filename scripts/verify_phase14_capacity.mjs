import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandboxRoot = path.resolve(root, '.tmp', 'phase14-capacity');
const databasePath = path.resolve(sandboxRoot, 'stellar-capacity.db');
const durationArg = process.argv.find(arg => arg.startsWith('--duration-ms='));
const durationMs = Number(durationArg?.split('=')[1] || 300_000);
const port = 3314;
const baseUrl = `http://127.0.0.1:${port}`;

if (
  sandboxRoot !== path.resolve(root, '.tmp', 'phase14-capacity') ||
  !databasePath.startsWith(`${sandboxRoot}${path.sep}`)
) {
  throw new Error('Capacity test database must stay inside .tmp/phase14-capacity.');
}

const buildCommand = process.platform === 'win32'
  ? { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', 'npm run build'] }
  : { file: 'npm', args: ['run', 'build'] };
const build = spawnSync(buildCommand.file, buildCommand.args, {
  cwd: path.join(root, 'backend'),
  encoding: 'utf8',
  stdio: 'inherit',
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status || 1);

const portInUse = await new Promise(resolve => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});
if (portInUse) throw new Error(`Port ${port} is already in use.`);

rmSync(sandboxRoot, { recursive: true, force: true });
mkdirSync(sandboxRoot, { recursive: true });

const server = spawn(process.execPath, ['dist/server.js'], {
  cwd: path.join(root, 'backend'),
  windowsHide: true,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    JWT_SECRET: 'phase14-capacity-isolated-test-secret-2026',
    STARCOIN_DB_PATH: databasePath,
    ENABLE_DB_BACKUP: 'false',
    SMS_PROVIDER: 'mock',
    SMS_EXPOSE_DEV_CODE: 'true',
    TRUST_PROXY: '1',
    REQUEST_LOGS: 'false',
    CORS_ORIGIN: baseUrl,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLogs = '';
const capture = chunk => {
  serverLogs = `${serverLogs}${chunk}`.slice(-1_000_000);
};
server.stdout.on('data', capture);
server.stderr.on('data', capture);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitForHealth = async () => {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Backend exited early.\n${serverLogs}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok && (await response.json()).status === 'ok') return;
    } catch {
      // Startup is still in progress.
    }
    await sleep(500);
  }
  throw new Error(`Backend health check timed out.\n${serverLogs}`);
};

const request = async (route, { method = 'GET', token, body, ip } = {}) => {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(ip ? { 'X-Forwarded-For': ip } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: response.status, data, ms: performance.now() - started };
};

const mapLimit = async (items, limit, worker) => {
  let cursor = 0;
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
};

const requireFromBackend = createRequire(path.join(root, 'backend', 'package.json'));
const sqlite = requireFromBackend('sqlite');
const sqlite3 = requireFromBackend('sqlite3');
const users = Array.from({ length: 100 }, (_, index) => ({
  index,
  phone: `166${String(70_000_000 + index)}`,
  ip: `10.20.0.${index + 1}`,
}));

let exitCode = 1;
try {
  await waitForHealth();
  console.log('[P14] Backend healthy; registering 100 isolated mock-SMS accounts...');

  const registered = await mapLimit(users, 10, async user => {
    const sent = await request('/api/auth/sms/send', {
      method: 'POST',
      ip: user.ip,
      body: { phone: user.phone, purpose: 'register' },
    });
    if (sent.status !== 200 || !sent.data.devCode) {
      throw new Error(`SMS setup failed for ${user.index}: ${sent.status} ${JSON.stringify(sent.data)}`);
    }
    const registration = await request('/api/auth/register', {
      method: 'POST',
      ip: user.ip,
      body: {
        phone: user.phone,
        password: 'Phase14-Test-2026',
        smsCode: sent.data.devCode,
      },
    });
    if (registration.status !== 200 || !registration.data.token) {
      throw new Error(`Registration failed for ${user.index}: ${registration.status} ${JSON.stringify(registration.data)}`);
    }
    const family = await request('/api/auth/create-family', {
      method: 'POST',
      ip: user.ip,
      token: registration.data.token,
      body: { familyName: `容量测试家庭${user.index + 1}`, parentName: '测试家长' },
    });
    if (family.status !== 200 || !family.data.token) {
      throw new Error(`Family setup failed for ${user.index}: ${family.status} ${JSON.stringify(family.data)}`);
    }
    return { ...user, token: family.data.token };
  });

  const readLatencies = [];
  const writeLatencies = [];
  let requests = 0;
  let errors = 0;
  let serverErrors = 0;
  let sqliteBusy = 0;
  const cycles = Math.max(1, Math.ceil(durationMs / 5_000));

  console.log(`[P14] Running ${cycles} mixed-load cycles (${durationMs / 1000}s, 100 virtual users)...`);
  for (let cycle = 0; cycle < cycles; cycle++) {
    const cycleStarted = Date.now();
    await mapLimit(registered, 20, async (user, index) => {
      const isWrite = (cycle + index) % 10 === 0;
      const result = isWrite
        ? await request('/api/parent/tasks', {
            method: 'POST',
            ip: user.ip,
            token: user.token,
            body: {
              title: `容量测试任务 ${cycle + 1}-${index + 1}`,
              durationMinutes: 10,
              category: 'study',
              taskType: 'once',
            },
          })
        : await request('/api/auth/members', {
            ip: user.ip,
            token: user.token,
          });
      requests++;
      (isWrite ? writeLatencies : readLatencies).push(result.ms);
      if (result.status < 200 || result.status >= 300) errors++;
      if (result.status >= 500) serverErrors++;
      if (JSON.stringify(result.data).includes('SQLITE_BUSY')) sqliteBusy++;
    });
    const remaining = 5_000 - (Date.now() - cycleStarted);
    if (remaining > 0 && cycle + 1 < cycles) await sleep(remaining);
  }

  server.kill();
  await Promise.race([
    new Promise(resolve => server.once('exit', resolve)),
    sleep(5_000),
  ]);

  const db = await sqlite.open({ filename: databasePath, driver: sqlite3.Database });
  const integrity = await db.get('PRAGMA integrity_check');
  const foreignKeys = await db.all('PRAGMA foreign_key_check');
  const counts = await db.get(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE role = 'parent') AS parents,
       (SELECT COUNT(*) FROM families WHERE name LIKE '容量测试家庭%') AS capacityFamilies,
       (SELECT COUNT(*) FROM families) AS totalFamilies`
  );
  await db.close();

  const percentile = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] || 0;
  };
  const readP95 = percentile(readLatencies, 0.95);
  const writeP95 = percentile(writeLatencies, 0.95);
  sqliteBusy += (serverLogs.match(/SQLITE_BUSY|database is locked/g) || []).length;
  const integrityOk = Object.values(integrity)[0] === 'ok' && foreignKeys.length === 0;
  const passed =
    counts.parents === 100 &&
    counts.capacityFamilies === 100 &&
    errors === 0 &&
    serverErrors === 0 &&
    sqliteBusy === 0 &&
    readP95 < 500 &&
    writeP95 < 800 &&
    integrityOk;

  console.log(JSON.stringify({
    passed,
    database: databasePath,
    accounts: counts,
    requests,
    errors,
    serverErrors,
    sqliteBusy,
    read: {
      count: readLatencies.length,
      p50Ms: Math.round(percentile(readLatencies, 0.50)),
      p95Ms: Math.round(readP95),
    },
    write: {
      count: writeLatencies.length,
      p50Ms: Math.round(percentile(writeLatencies, 0.50)),
      p95Ms: Math.round(writeP95),
    },
    integrity: Object.values(integrity)[0],
    foreignKeyErrors: foreignKeys.length,
  }, null, 2));
  exitCode = passed ? 0 : 1;
} catch (error) {
  console.error(error);
  console.error(serverLogs);
} finally {
  if (server.exitCode === null) server.kill();
}

process.exit(exitCode);
