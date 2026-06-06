param(
  [string]$OldDbPath,
  [string]$PackageRoot,
  [switch]$Help
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

if ($Help) {
  Write-Host 'Usage: scripts\prepare_server_package.bat'
  Write-Host ''
  Write-Host 'Creates a timestamped server-ready folder under 临时.'
  Write-Host 'It copies clean code, migrates old data into stellar.db, and does not modify the old version folder.'
  exit 0
}

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $ProjectRoot

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$defaultOldDb = Join-Path $ProjectRoot '临时\starcoin（原始）\starcoin\stellar.db'
$defaultPackageRoot = Join-Path $ProjectRoot "临时\starcoin-server-package-$stamp"

Write-Host '========================================'
Write-Host 'Star Coin Server Package Builder'
Write-Host '========================================'
Write-Host "Project: $ProjectRoot"
Write-Host ''
Write-Host 'Press Enter to accept the default shown in brackets.'
Write-Host ''

if (-not $OldDbPath) {
  $answer = Read-Host "Old database path [$defaultOldDb]"
  $OldDbPath = if ([string]::IsNullOrWhiteSpace($answer)) { $defaultOldDb } else { $answer }
}

if (-not (Test-Path -LiteralPath $OldDbPath)) {
  throw "Old database was not found: $OldDbPath"
}

if (-not $PackageRoot) {
  $answer = Read-Host "Output package folder [$defaultPackageRoot]"
  $PackageRoot = if ([string]::IsNullOrWhiteSpace($answer)) { $defaultPackageRoot } else { $answer }
}

$PackageApp = Join-Path $PackageRoot 'starcoin'
if (Test-Path -LiteralPath $PackageApp) {
  throw "Output folder already exists: $PackageApp"
}

New-Item -ItemType Directory -Path $PackageApp -Force | Out-Null

Write-Host ''
Write-Host '[1/4] Copying clean new-version files...'
$excludeDirs = @('.git', '临时', '.tmp', 'backups', '_archive', 'node_modules', '.next', 'build', '__pycache__', '.pytest_cache', '.venv', 'venv')
$excludeFileNames = @(
  'stellar.db',
  'stellar.db-shm',
  'stellar.db-wal',
  'database.sqlite',
  'production_env.local.bat',
  'prepare_server_package.bat',
  'prepare_server_package.ps1'
)
$excludeFilePatterns = @('*.sqlite', '*.db', '*.db-shm', '*.db-wal', '*.log')

function Test-ExcludedFile {
  param([IO.FileInfo]$File)
  if ($excludeFileNames -contains $File.Name) { return $true }
  foreach ($pattern in $excludeFilePatterns) {
    if ($File.Name -like $pattern) { return $true }
  }
  return $false
}

function Copy-CleanDirectory {
  param(
    [string]$Source,
    [string]$Destination
  )
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
    if ($item.PSIsContainer) {
      if ($excludeDirs -contains $item.Name) { continue }
      Copy-CleanDirectory -Source $item.FullName -Destination (Join-Path $Destination $item.Name)
    } else {
      if (Test-ExcludedFile -File $item) { continue }
      Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $Destination $item.Name) -Force
    }
  }
}

$topLevelItems = @('.cursorrules', '.gitignore', 'README.md', 'backend', 'docs', 'frontend', 'scripts')
foreach ($name in $topLevelItems) {
  $source = Join-Path $ProjectRoot $name
  if (-not (Test-Path -LiteralPath $source)) { continue }
  $item = Get-Item -LiteralPath $source -Force
  if ($item.PSIsContainer) {
    Copy-CleanDirectory -Source $item.FullName -Destination (Join-Path $PackageApp $item.Name)
  } else {
    if (-not (Test-ExcludedFile -File $item)) {
      Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $PackageApp $item.Name) -Force
    }
  }
}

Write-Host ''
Write-Host '[2/4] Ensuring local backend migration code is built...'
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'backend\dist\database.js'))) {
  Push-Location (Join-Path $ProjectRoot 'backend')
  try {
    & npm install
    if ($LASTEXITCODE -ne 0) { throw 'Backend npm install failed.' }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
  } finally {
    Pop-Location
  }
}

Write-Host ''
Write-Host '[3/4] Copying old database into the package...'
$packageDb = Join-Path $PackageApp 'stellar.db'
Copy-Item -LiteralPath $OldDbPath -Destination $packageDb -Force
if (Test-Path -LiteralPath "$OldDbPath-wal") {
  Copy-Item -LiteralPath "$OldDbPath-wal" -Destination "$packageDb-wal" -Force
}
if (Test-Path -LiteralPath "$OldDbPath-shm") {
  Copy-Item -LiteralPath "$OldDbPath-shm" -Destination "$packageDb-shm" -Force
}

Write-Host ''
Write-Host '[4/4] Migrating packaged database to the new version...'
$env:STARCOIN_DB_PATH = $packageDb
$migrationJs = @'
const d = require('./backend/dist/database');
const r = require('./backend/dist/rewardSystem');
(async () => {
  await d.initializeDatabase();
  await r.initRewardTables();
  await r.initLotteryTables();
  const db = d.getDb();
  await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const integrity = await db.get('PRAGMA integrity_check');
  const fk = await db.all('PRAGMA foreign_key_check');
  const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  console.log('[DB] integrity_check:', Object.values(integrity)[0]);
  console.log('[DB] foreign_key_check errors:', fk.length);
  console.log('[DB] table count:', tables.length);
  await db.close();
  process.exit(Object.values(integrity)[0] === 'ok' && fk.length === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
'@
$encodedMigrationJs = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($migrationJs))
& node -e "eval(Buffer.from(process.argv[1], 'base64').toString())" $encodedMigrationJs
if ($LASTEXITCODE -ne 0) {
  throw 'Database migration failed.'
}

Remove-Item -LiteralPath "$packageDb-wal" -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "$packageDb-shm" -ErrorAction SilentlyContinue

$readme = @"
Star Coin server-ready package

1. Copy the starcoin folder to the server.
2. On the server, open an Administrator cmd window.
3. Run scripts\setup_server_production.bat from inside the starcoin folder.
4. Accept the default database path unless you intentionally moved stellar.db.
5. Start with scripts\start_server_simple.bat.

The included stellar.db has already been migrated from:
$OldDbPath
"@
$readme | Set-Content -LiteralPath (Join-Path $PackageRoot 'README_SERVER_PACKAGE.txt') -Encoding UTF8

Write-Host ''
Write-Host '========================================'
Write-Host 'Server-ready package created'
Write-Host '========================================'
Write-Host 'Copy this folder to the server:'
Write-Host $PackageApp
Write-Host ''
Write-Host 'Then run on the server:'
Write-Host 'scripts\setup_server_production.bat'
Write-Host 'scripts\start_server_simple.bat'
Write-Host '========================================'
