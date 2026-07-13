const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const backendDistRoot = process.env.STARCOIN_VERIFY_BACKEND_DIST
  ? path.resolve(process.env.STARCOIN_VERIFY_BACKEND_DIST)
  : path.join(root, 'backend', 'dist');
const frontendDistRoot = process.env.STARCOIN_VERIFY_FRONTEND_DIST
  ? path.resolve(process.env.STARCOIN_VERIFY_FRONTEND_DIST)
  : path.join(root, 'frontend', 'dist');

const fail = (message) => {
  console.error(`[FAIL] ${message}`);
  process.exitCode = 1;
};

const requiredBackendFiles = [
  'achievementDisplay.js',
  'growthIdentityCatalog.js',
  'growthIdentitySchema.js',
  'levelIdentity.js',
  'growthCosmeticCatalog.js',
  'growthCosmeticSchema.js',
  'growthIdentityService.js',
  'growthIdentityRoutes.js',
];

for (const filename of requiredBackendFiles) {
  if (!fs.existsSync(path.join(backendDistRoot, filename))) fail(`Missing backend Phase 4 build file: ${filename}`);
}

if (process.exitCode) process.exit(process.exitCode);

const { SYSTEM_ACHIEVEMENT_CATALOG } = require(path.join(backendDistRoot, 'growthIdentityCatalog.js'));
const { GROWTH_COSMETIC_CATALOG } = require(path.join(backendDistRoot, 'growthCosmeticCatalog.js'));

const assertUnique = (items, field, label) => {
  const values = items.map(item => item[field]);
  if (values.some(value => typeof value !== 'string' || value.length === 0)) fail(`Invalid ${label}`);
  if (new Set(values).size !== values.length) fail(`Duplicate ${label}`);
};

if (SYSTEM_ACHIEVEMENT_CATALOG.length !== 92) {
  fail(`Expected 92 system achievements, found ${SYSTEM_ACHIEVEMENT_CATALOG.length}`);
}
assertUnique(SYSTEM_ACHIEVEMENT_CATALOG, 'systemKey', 'system achievement key');
assertUnique(SYSTEM_ACHIEVEMENT_CATALOG, 'title', 'system achievement title');
assertUnique(SYSTEM_ACHIEVEMENT_CATALOG, 'iconKey', 'system achievement icon key');

const forbiddenCosmeticFields = ['coinCost', 'cost', 'probability', 'lottery', 'permission'];
for (const item of GROWTH_COSMETIC_CATALOG) {
  if (forbiddenCosmeticFields.some(field => Object.prototype.hasOwnProperty.call(item, field))) {
    fail(`Cosmetic ${item.key} contains an economy, chance or permission field`);
  }
}
assertUnique(GROWTH_COSMETIC_CATALOG, 'key', 'growth cosmetic key');

const assetsRoot = path.join(frontendDistRoot, 'assets');
if (!fs.existsSync(assetsRoot)) fail('Missing frontend asset directory');
const assetNames = fs.existsSync(assetsRoot) ? fs.readdirSync(assetsRoot) : [];
for (const prefix of ['ChildMe-', 'ParentAchievements-', 'GrowthIcon-']) {
  if (!assetNames.some(name => name.startsWith(prefix) && name.endsWith('.js'))) {
    fail(`Missing required Phase 4 page chunk: ${prefix}*.js`);
  }
}

const frontendSource = assetNames
  .filter(name => name.endsWith('.js'))
  .map(name => fs.readFileSync(path.join(assetsRoot, name), 'utf8'))
  .join('\n');
for (const marker of [
  '/child/growth-identity',
  '/child/profile-customization',
  'child-growth-account',
  'growth-cosmetic-closet',
]) {
  if (!frontendSource.includes(marker)) fail(`Missing Phase 4 frontend marker: ${marker}`);
}

const routeSource = fs.readFileSync(path.join(backendDistRoot, 'growthIdentityRoutes.js'), 'utf8');
for (const route of ['/api/child/growth-identity', '/api/child/profile-customization']) {
  if (!routeSource.includes(route)) fail(`Missing Phase 4 backend route: ${route}`);
}

if (!process.exitCode) {
  console.log(`[OK] System achievement identities: ${SYSTEM_ACHIEVEMENT_CATALOG.length}`);
  console.log(`[OK] Growth cosmetics: ${GROWTH_COSMETIC_CATALOG.length}`);
  console.log('[OK] No duplicate achievement keys, titles or icon keys');
  console.log('[OK] No cosmetic economy, chance or permission fields');
  console.log('[OK] Child and parent Phase 4 production chunks are complete');
  console.log('[OK] Growth identity read and profile customization routes are present');
}
