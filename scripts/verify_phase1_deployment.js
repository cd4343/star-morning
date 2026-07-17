const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const root = path.resolve(__dirname, '..');
const backendDistRoot = process.env.STARCOIN_VERIFY_BACKEND_DIST
  ? path.resolve(process.env.STARCOIN_VERIFY_BACKEND_DIST)
  : path.join(root, 'backend', 'dist');
const frontendDistRoot = process.env.STARCOIN_VERIFY_FRONTEND_DIST
  ? path.resolve(process.env.STARCOIN_VERIFY_FRONTEND_DIST)
  : path.join(root, 'frontend', 'dist');
const requiredFiles = [
  'backend/src/lotteryRules.ts',
  'backend/src/rewardSystem.ts',
  'backend/src/taskSettlement.ts',
  'backend/src/chestRewardGrant.ts',
  'backend/src/wishRequestRoutes.ts',
  'backend/src/privilegeRedemption.ts',
  'backend/src/exploreExperience.ts',
  'frontend/src/pages/child/ChildLayout.tsx',
  'frontend/src/pages/child/ChildToday.tsx',
  'frontend/src/pages/child/ChildChallenge.tsx',
  'frontend/src/pages/child/ChildWishes.tsx',
  'frontend/src/pages/child/ChildMe.tsx',
  'frontend/src/pages/child/ChildExplore.tsx',
  'frontend/src/pages/parent/ParentQuickSetup.tsx',
  'frontend/src/pages/parent/ParentWishes.tsx',
  'frontend/src/pages/parent/ParentTasks.tsx',
  'frontend/src/pages/parent/ParentExplore.tsx',
  'frontend/src/pages/parent/ParentPrivileges.tsx',
  'frontend/src/components/EconomySettingsPanel.tsx',
];
const requiredBackendBuildFiles = [
  'server.js', 'productConfig.js', 'parentInbox.js', 'economyRoutes.js',
  'economySchema.js', 'wishEconomy.js', 'taskSettlement.js', 'lotteryRules.js',
  'rewardSystem.js',
  'chestRewardGrant.js', 'wishRequestRoutes.js', 'privilegeRedemption.js',
  'exploreExperience.js', 'exploreFeed.js',
];

const fail = (message) => {
  console.error(`[FAIL] ${message}`);
  process.exitCode = 1;
};

for (const relative of requiredFiles) {
  if (!fs.existsSync(path.join(root, relative))) fail(`Missing required file: ${relative}`);
}
for (const relative of requiredBackendBuildFiles) {
  if (!fs.existsSync(path.join(backendDistRoot, relative))) fail(`Missing backend build file: ${relative}`);
}
if (!fs.existsSync(path.join(frontendDistRoot, 'index.html'))) fail('Missing frontend build file: index.html');

if (process.exitCode) process.exit(process.exitCode);

const distRoot = frontendDistRoot;
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
  if (!fs.existsSync(path.join(distRoot, relative))) fail(`Missing built asset: ${relative}`);
}

const assetNames = fs.existsSync(assetsRoot) ? fs.readdirSync(assetsRoot) : [];
for (const prefix of ['ChildLayout-', 'ChildToday-', 'ChildChallenge-', 'ChildWishes-', 'ChildMe-', 'ChildExplore-', 'ParentDashboard-', 'ParentQuickSetup-', 'ParentTasks-', 'ParentWishes-', 'ParentExplore-', 'ParentPrivileges-', 'EconomySettingsPanel-']) {
  if (!assetNames.some(name => name.startsWith(prefix) && name.endsWith('.js'))) {
    fail(`Missing required page chunk: frontend/dist/assets/${prefix}*.js`);
  }
}

const childWishesChunk = assetNames.find(name => name.startsWith('ChildWishes-') && name.endsWith('.js'));
if (childWishesChunk) {
  const source = fs.readFileSync(path.join(assetsRoot, childWishesChunk), 'utf8');
  if (source.includes('谢谢参与')) fail('Child lottery production chunk still contains empty-prize wording');
}

const requestText = (url, redirectsRemaining = 5) => new Promise((resolve, reject) => {
  const parsedUrl = new URL(url);
  const transport = parsedUrl.protocol === 'https:' ? https : http;
  const request = transport.get(parsedUrl, { headers: { 'Cache-Control': 'no-cache' } }, response => {
    const status = response.statusCode || 0;
    const location = response.headers.location;
    if ([301, 302, 303, 307, 308].includes(status) && location) {
      response.resume();
      if (redirectsRemaining === 0) {
        reject(new Error(`Too many redirects while requesting ${url}`));
        return;
      }
      resolve(requestText(new URL(location, parsedUrl).toString(), redirectsRemaining - 1));
      return;
    }
    let body = '';
    response.setEncoding('utf8');
    response.on('data', chunk => { body += chunk; });
    response.on('end', () => resolve({ status, body, url: parsedUrl.toString() }));
  });
  request.setTimeout(8000, () => request.destroy(new Error('request timeout')));
  request.on('error', reject);
});

const verifyLive = async () => {
  const entryAsset = entryMatch[1];
  const configuredOrigin = (process.env.STARCOIN_LIVE_URL || process.env.CORS_ORIGIN || 'http://127.0.0.1')
    .split(',')[0]
    .trim();
  const liveBaseUrl = new URL(configuredOrigin);
  if (!['http:', 'https:'].includes(liveBaseUrl.protocol)) throw new Error('Live URL must use HTTP or HTTPS');
  const page = await requestText(new URL('/', liveBaseUrl).toString());
  if (page.status !== 200) throw new Error(`Nginx returned HTTP ${page.status} for /`);
  if (!page.body.includes(`/assets/${entryAsset}`)) {
    throw new Error(`Nginx is serving another frontend directory. Expected entry asset: ${entryAsset}`);
  }
  const asset = await requestText(new URL(`/assets/${entryAsset}`, page.url).toString());
  if (asset.status !== 200 || asset.body.length < 1000) throw new Error(`Entry asset is unavailable: ${entryAsset}`);
  const health = await requestText(new URL('/api/health', page.url).toString());
  if (health.status !== 200) throw new Error(`Backend health check returned HTTP ${health.status}`);
  let healthBody;
  try { healthBody = JSON.parse(health.body); } catch { throw new Error('Backend health check returned invalid JSON'); }
  if (healthBody.status !== 'ok' || healthBody.database !== 'ok') {
    throw new Error('Backend health check did not confirm database readiness');
  }
  console.log(`[OK] Live origin: ${new URL(page.url).origin}`);
  console.log(`[OK] Nginx serves current entry asset: ${entryAsset}`);
  console.log('[OK] Backend health endpoint is reachable through Nginx');
};

if (!process.exitCode) {
  console.log(`[OK] Project root: ${root}`);
  console.log(`[OK] Backend build: ${backendDistRoot}`);
  console.log(`[OK] Frontend build: ${frontendDistRoot}`);
  console.log(`[OK] Entry asset: ${entryMatch[1]}`);
  console.log(`[OK] Checked ${referenced.size} referenced frontend assets`);
  console.log('[OK] Phase 1 and Phase 2 source/page chunks are complete');
}

if (process.argv.includes('--live') && !process.exitCode) {
  verifyLive().catch(error => {
    fail(error.message);
  });
}
