const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'backend/dist/server.js',
  'backend/dist/productConfig.js',
  'backend/dist/parentInbox.js',
  'backend/dist/economyRoutes.js',
  'backend/dist/economySchema.js',
  'backend/dist/wishEconomy.js',
  'backend/dist/taskSettlement.js',
  'backend/src/taskSettlement.ts',
  'frontend/src/pages/child/ChildToday.tsx',
  'frontend/src/pages/parent/ParentQuickSetup.tsx',
  'frontend/src/pages/parent/ParentWishes.tsx',
  'frontend/src/pages/parent/ParentTasks.tsx',
  'frontend/src/components/EconomySettingsPanel.tsx',
  'frontend/dist/index.html',
];

const fail = (message) => {
  console.error(`[FAIL] ${message}`);
  process.exitCode = 1;
};

for (const relative of requiredFiles) {
  if (!fs.existsSync(path.join(root, relative))) fail(`Missing required file: ${relative}`);
}

if (process.exitCode) process.exit(process.exitCode);

const distRoot = path.join(root, 'frontend', 'dist');
const assetsRoot = path.join(distRoot, 'assets');
const indexHtml = fs.readFileSync(path.join(distRoot, 'index.html'), 'utf8');
const entryMatch = indexHtml.match(/<script[^>]+src="\/assets\/([^"?]+)"/i);
if (!entryMatch) fail('frontend/dist/index.html does not reference a Vite entry asset');

const referenced = new Set();
for (const match of indexHtml.matchAll(/(?:src|href)="\/([^"?]+)"/g)) referenced.add(match[1]);

if (fs.existsSync(assetsRoot)) {
  for (const filename of fs.readdirSync(assetsRoot).filter(name => name.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(assetsRoot, filename), 'utf8');
    for (const match of source.matchAll(/(?:\.\/|\/assets\/)([A-Za-z0-9_.-]+\.(?:js|css))/g)) {
      referenced.add(`assets/${match[1]}`);
    }
  }
} else {
  fail('frontend/dist/assets is missing');
}

for (const relative of referenced) {
  if (!fs.existsSync(path.join(distRoot, relative))) fail(`Missing built asset: frontend/dist/${relative}`);
}

const assetNames = fs.existsSync(assetsRoot) ? fs.readdirSync(assetsRoot) : [];
for (const prefix of ['ChildToday-', 'ChildMe-', 'ParentDashboard-', 'ParentQuickSetup-', 'ParentTasks-', 'ParentWishes-', 'EconomySettingsPanel-']) {
  if (!assetNames.some(name => name.startsWith(prefix) && name.endsWith('.js'))) {
    fail(`Missing required page chunk: frontend/dist/assets/${prefix}*.js`);
  }
}

const requestText = (url) => new Promise((resolve, reject) => {
  const request = http.get(url, { headers: { 'Cache-Control': 'no-cache' } }, response => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', chunk => { body += chunk; });
    response.on('end', () => resolve({ status: response.statusCode || 0, body }));
  });
  request.setTimeout(8000, () => request.destroy(new Error('request timeout')));
  request.on('error', reject);
});

const verifyLive = async () => {
  const entryAsset = entryMatch[1];
  const page = await requestText('http://127.0.0.1/');
  if (page.status !== 200) throw new Error(`Nginx returned HTTP ${page.status} for /`);
  if (!page.body.includes(`/assets/${entryAsset}`)) {
    throw new Error(`Nginx is serving another frontend directory. Expected entry asset: ${entryAsset}`);
  }
  const asset = await requestText(`http://127.0.0.1/assets/${entryAsset}`);
  if (asset.status !== 200 || asset.body.length < 1000) throw new Error(`Entry asset is unavailable: ${entryAsset}`);
  const health = await requestText('http://127.0.0.1/api/health');
  if (health.status !== 200) throw new Error(`Backend health check returned HTTP ${health.status}`);
  console.log(`[OK] Nginx serves current entry asset: ${entryAsset}`);
  console.log('[OK] Backend health endpoint is reachable through Nginx');
};

if (!process.exitCode) {
  console.log(`[OK] Project root: ${root}`);
  console.log(`[OK] Entry asset: ${entryMatch[1]}`);
  console.log(`[OK] Checked ${referenced.size} referenced frontend assets`);
  console.log('[OK] Phase 1 and Phase 2 source/page chunks are complete');
}

if (process.argv.includes('--live') && !process.exitCode) {
  verifyLive().catch(error => {
    fail(error.message);
  });
}
