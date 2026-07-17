const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { test } = require('node:test');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, '..', '..');

test('live verification follows the production HTTP redirect before checking assets and health', async (context) => {
  const indexHtml = fs.readFileSync(path.join(root, 'frontend', 'dist', 'index.html'), 'utf8');
  const entryAsset = indexHtml.match(/<script[^>]+src="\/assets\/([^"?]+)"/i)[1];
  const entrySource = fs.readFileSync(path.join(root, 'frontend', 'dist', 'assets', entryAsset), 'utf8');

  let databaseReady = true;
  const server = http.createServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(301, { Location: '/app' });
      response.end();
      return;
    }
    if (request.url === '/app') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(indexHtml);
      return;
    }
    if (request.url === `/assets/${entryAsset}`) {
      response.writeHead(200, { 'Content-Type': 'application/javascript' });
      response.end(entrySource);
      return;
    }
    if (request.url === '/api/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: databaseReady ? 'ok' : 'error', database: databaseReady ? 'ok' : 'unavailable' }));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  const { stdout } = await execFileAsync(
    process.execPath,
    ['scripts/verify_phase1_deployment.js', '--live'],
    {
      cwd: root,
      env: { ...process.env, STARCOIN_LIVE_URL: `http://127.0.0.1:${address.port}` },
    },
  );

  assert.match(stdout, /Live origin:/);
  assert.match(stdout, /Backend health endpoint is reachable through Nginx/);

  databaseReady = false;
  await assert.rejects(
    execFileAsync(process.execPath, ['scripts/verify_phase1_deployment.js', '--live'], {
      cwd: root,
      env: { ...process.env, STARCOIN_LIVE_URL: `http://127.0.0.1:${address.port}` },
    }),
    error => String(error.stderr || '').includes('did not confirm database readiness'),
  );
});
