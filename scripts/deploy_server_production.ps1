param(
  [switch]$SkipInstall,
  [switch]$SkipNginxCheck,
  [switch]$ValidateOnly,
  [int]$HealthTimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$StageRoot = Join-Path $ProjectRoot ".tmp\production-deploy-$Stamp"
$BackendStage = Join-Path $StageRoot 'backend-dist'
$FrontendStage = Join-Path $StageRoot 'frontend-dist'
$ReleaseBackup = Join-Path $ProjectRoot "backups\releases\$Stamp"
$BackendLive = Join-Path $ProjectRoot 'backend\dist'
$FrontendLive = Join-Path $ProjectRoot 'frontend\dist'
$EnvironmentFile = Join-Path $ProjectRoot 'scripts\production_env.local.bat'
$LogsDirectory = Join-Path $ProjectRoot 'logs'
$Switched = $false
$BackendWasRunning = $false
$NewBackendProcess = $null

function Write-Step([string]$Message) {
  Write-Host "`n[STEP] $Message" -ForegroundColor Cyan
}

function Invoke-External([string]$File, [string[]]$Arguments, [string]$WorkingDirectory) {
  Push-Location $WorkingDirectory
  try {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$File exited with code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Import-ProductionEnvironment {
  if (-not (Test-Path -LiteralPath $EnvironmentFile)) {
    throw 'scripts\production_env.local.bat is missing. Run setup_server_production.bat once first.'
  }
  foreach ($line in Get-Content -LiteralPath $EnvironmentFile) {
    if ($line -match '^\s*set\s+"([A-Za-z_][A-Za-z0-9_]*)=(.*)"\s*$') {
      [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
  }
  foreach ($name in @('JWT_SECRET', 'STARCOIN_DB_PATH', 'STARCOIN_BACKUP_DIR')) {
    if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
      throw "Required production setting is missing: $name"
    }
  }
}

function Get-BackendProcessIds {
  $port = if ($env:PORT) { [int]$env:PORT } else { 3001 }
  try {
    return @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess -Unique)
  } catch {
    $ids = @()
    foreach ($line in & netstat.exe -ano -p tcp) {
      if ($line -match "^\s*TCP\s+\S+:$port\s+\S+\s+LISTENING\s+(\d+)\s*$") {
        $ids += [int]$Matches[1]
      }
    }
    return @($ids | Select-Object -Unique)
  }
}

function Stop-Backend {
  foreach ($processId in Get-BackendProcessIds) {
    Write-Host "[INFO] Stopping backend PID $processId"
    Stop-Process -Id $processId -Force -ErrorAction Stop
  }
  Start-Sleep -Milliseconds 600
  if (@(Get-BackendProcessIds).Count -gt 0) {
    throw 'The old backend is still listening after the stop attempt.'
  }
}

function Start-Backend([string]$LogSuffix) {
  New-Item -ItemType Directory -Force -Path $LogsDirectory | Out-Null
  $stdout = Join-Path $LogsDirectory "backend-$LogSuffix.out.log"
  $stderr = Join-Path $LogsDirectory "backend-$LogSuffix.error.log"
  return Start-Process -FilePath 'node.exe' -ArgumentList 'dist/server.js' `
    -WorkingDirectory (Join-Path $ProjectRoot 'backend') -WindowStyle Hidden `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
}

function Wait-ForHealth([System.Diagnostics.Process]$BackendProcess) {
  $port = if ($env:PORT) { [int]$env:PORT } else { 3001 }
  $deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
  do {
    $BackendProcess.Refresh()
    if ($BackendProcess.HasExited) {
      throw "The new backend exited before becoming healthy. Exit code: $($BackendProcess.ExitCode)"
    }
    try {
      $response = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 3
      if ($response.status -eq 'ok') { return }
    } catch {
      Start-Sleep -Seconds 1
    }
  } while ((Get-Date) -lt $deadline)
  throw "Backend health check did not pass within $HealthTimeoutSeconds seconds."
}

function Backup-Database {
  $databasePath = $env:STARCOIN_DB_PATH
  if (-not (Test-Path -LiteralPath $databasePath)) {
    Write-Host "[WARN] Database does not exist yet: $databasePath" -ForegroundColor Yellow
    return
  }
  New-Item -ItemType Directory -Force -Path $ReleaseBackup | Out-Null
  Copy-Item -LiteralPath $databasePath -Destination (Join-Path $ReleaseBackup 'stellar.db') -Force
  foreach ($suffix in @('-wal', '-shm')) {
    if (Test-Path -LiteralPath "$databasePath$suffix") {
      Copy-Item -LiteralPath "$databasePath$suffix" -Destination (Join-Path $ReleaseBackup "stellar.db$suffix") -Force
    }
  }
}

function Backup-RuntimeArtifacts {
  New-Item -ItemType Directory -Force -Path $ReleaseBackup | Out-Null
  if (Test-Path -LiteralPath $BackendLive) {
    Copy-Item -LiteralPath $BackendLive -Destination (Join-Path $ReleaseBackup 'backend-dist') -Recurse -Force
  }
  if (Test-Path -LiteralPath $FrontendLive) {
    Copy-Item -LiteralPath $FrontendLive -Destination (Join-Path $ReleaseBackup 'frontend-dist') -Recurse -Force
  }
}

function Publish-StagedBuilds {
  if (Test-Path -LiteralPath $BackendLive) { Remove-Item -LiteralPath $BackendLive -Recurse -Force }
  Move-Item -LiteralPath $BackendStage -Destination $BackendLive

  New-Item -ItemType Directory -Force -Path $FrontendLive | Out-Null
  foreach ($item in Get-ChildItem -LiteralPath $FrontendStage) {
    if ($item.Name -ne 'index.html') {
      Copy-Item -LiteralPath $item.FullName -Destination $FrontendLive -Recurse -Force
    }
  }
  $nextIndex = Join-Path $FrontendLive 'index.html.next'
  Copy-Item -LiteralPath (Join-Path $FrontendStage 'index.html') -Destination $nextIndex -Force
  Move-Item -LiteralPath $nextIndex -Destination (Join-Path $FrontendLive 'index.html') -Force
}

function Restore-PreviousRuntime {
  Write-Host '[ROLLBACK] Restoring the previous frontend and backend builds.' -ForegroundColor Yellow
  Stop-Backend
  $oldBackend = Join-Path $ReleaseBackup 'backend-dist'
  $oldFrontend = Join-Path $ReleaseBackup 'frontend-dist'
  if (Test-Path -LiteralPath $oldBackend) {
    if (Test-Path -LiteralPath $BackendLive) { Remove-Item -LiteralPath $BackendLive -Recurse -Force }
    Copy-Item -LiteralPath $oldBackend -Destination $BackendLive -Recurse -Force
  }
  if (Test-Path -LiteralPath $oldFrontend) {
    if (Test-Path -LiteralPath $FrontendLive) { Remove-Item -LiteralPath $FrontendLive -Recurse -Force }
    Copy-Item -LiteralPath $oldFrontend -Destination $FrontendLive -Recurse -Force
  }
  if ($BackendWasRunning -and (Test-Path -LiteralPath (Join-Path $BackendLive 'server.js'))) {
    Start-Backend "rollback-$Stamp" | Out-Null
  }
}

try {
  Set-Location $ProjectRoot
  Write-Step 'Preflight checks'
  if (-not $ValidateOnly) { Import-ProductionEnvironment }
  foreach ($command in @('node.exe', 'npm.cmd', 'npx.cmd')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command was not found in PATH." }
  }
  foreach ($file in @('backend\src\server.ts', 'frontend\src\App.tsx', 'scripts\verify_phase1_deployment.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $file))) { throw "Required source file is missing: $file" }
  }
  New-Item -ItemType Directory -Force -Path $BackendStage, $FrontendStage | Out-Null

  if (-not $SkipInstall) {
    Write-Step 'Install locked project dependencies'
    Invoke-External 'npm.cmd' @('ci', '--include=dev') (Join-Path $ProjectRoot 'backend')
    Invoke-External 'npm.cmd' @('ci', '--include=dev') (Join-Path $ProjectRoot 'frontend')
  }

  Write-Step 'Build backend and frontend in isolation'
  Invoke-External 'npx.cmd' @('tsc', '--outDir', $BackendStage) (Join-Path $ProjectRoot 'backend')
  Invoke-External 'npm.cmd' @('run', 'build', '--', '--outDir', $FrontendStage, '--emptyOutDir') (Join-Path $ProjectRoot 'frontend')

  Write-Step 'Verify staged build before touching production'
  $env:STARCOIN_VERIFY_BACKEND_DIST = $BackendStage
  $env:STARCOIN_VERIFY_FRONTEND_DIST = $FrontendStage
  Invoke-External 'node.exe' @('scripts\verify_phase1_deployment.js') $ProjectRoot
  Remove-Item Env:STARCOIN_VERIFY_BACKEND_DIST, Env:STARCOIN_VERIFY_FRONTEND_DIST -ErrorAction SilentlyContinue

  if ($ValidateOnly) {
    Write-Host "`n[OK] Validation completed without touching the running service or database." -ForegroundColor Green
    return
  }

  Write-Step 'Stop backend and create release backup'
  $BackendWasRunning = @(Get-BackendProcessIds).Count -gt 0
  Stop-Backend
  Backup-RuntimeArtifacts
  Backup-Database

  Write-Step 'Publish verified builds'
  Publish-StagedBuilds
  $Switched = $true

  Write-Step 'Run idempotent database migrations and integrity checks'
  $migration = "const d=require('./backend/dist/database');const r=require('./backend/dist/rewardSystem');(async()=>{await d.initializeDatabase();await r.initRewardTables();await r.initLotteryTables();const db=d.getDb();const i=await db.get('PRAGMA integrity_check');const f=await db.all('PRAGMA foreign_key_check');if(Object.values(i)[0]!=='ok'||f.length)throw new Error('database integrity check failed');await db.close()})().catch(e=>{console.error(e);process.exit(1)})"
  Invoke-External 'node.exe' @('-e', $migration) $ProjectRoot

  Write-Step 'Start backend and verify health'
  $NewBackendProcess = Start-Backend $Stamp
  Wait-ForHealth $NewBackendProcess
  Invoke-External 'node.exe' @('scripts\verify_phase1_deployment.js') $ProjectRoot
  if (-not $SkipNginxCheck) {
    Invoke-External 'node.exe' @('scripts\verify_phase1_deployment.js', '--live') $ProjectRoot
  }

  Write-Host "`n[OK] Production deployment completed." -ForegroundColor Green
  Write-Host "[OK] Rollback snapshot: $ReleaseBackup"
} catch {
  Write-Host "`n[ERROR] $($_.Exception.Message)" -ForegroundColor Red
  if ($Switched) {
    try { Restore-PreviousRuntime } catch { Write-Host "[ROLLBACK ERROR] $($_.Exception.Message)" -ForegroundColor Red }
  }
  exit 1
} finally {
  if (Test-Path -LiteralPath $StageRoot) { Remove-Item -LiteralPath $StageRoot -Recurse -Force -ErrorAction SilentlyContinue }
}

exit 0
