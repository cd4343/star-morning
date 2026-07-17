param([int]$Port = 3199)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$TempRoot = Join-Path $ProjectRoot '.tmp\phase11-acceptance'
$DatabasePath = Join-Path $TempRoot 'stellar.db'
$BackendProcess = $null

function Invoke-Checked([string]$File, [string[]]$Arguments, [string]$WorkingDirectory) {
  Push-Location $WorkingDirectory
  try {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$File exited with code $LASTEXITCODE" }
  } finally { Pop-Location }
}

try {
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $Port is already in use."
  }
  Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null

  Write-Host '[STEP] Backend tests and production builds' -ForegroundColor Cyan
  Invoke-Checked 'npm.cmd' @('test') (Join-Path $ProjectRoot 'backend')
  Invoke-Checked 'npm.cmd' @('run', 'build') (Join-Path $ProjectRoot 'backend')
  Invoke-Checked 'npm.cmd' @('run', 'build') (Join-Path $ProjectRoot 'frontend')
  Invoke-Checked 'node.exe' @('--test', 'scripts/tests/verify-live-redirect.test.js') $ProjectRoot
  Invoke-Checked 'node.exe' @('scripts/verify_phase1_deployment.js') $ProjectRoot

  Write-Host '[STEP] Isolated API acceptance' -ForegroundColor Cyan
  $env:STARCOIN_DB_PATH = $DatabasePath
  $env:NODE_ENV = 'test'
  $env:PORT = [string]$Port
  $env:JWT_SECRET = 'phase11-local-acceptance-secret'
  $env:STARCOIN_API_BASE = "http://127.0.0.1:$Port/api"
  $BackendProcess = Start-Process -FilePath 'node.exe' -ArgumentList 'dist/server.js' `
    -WorkingDirectory (Join-Path $ProjectRoot 'backend') -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $TempRoot 'backend.out.log') `
    -RedirectStandardError (Join-Path $TempRoot 'backend.error.log') -PassThru

  $healthy = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    $BackendProcess.Refresh()
    if ($BackendProcess.HasExited) { throw "Temporary backend exited with code $($BackendProcess.ExitCode)." }
    try {
      $health = Invoke-RestMethod -Uri "$env:STARCOIN_API_BASE/health" -TimeoutSec 2
      if ($health.status -eq 'ok' -and $health.database -eq 'ok') { $healthy = $true; break }
    } catch { Start-Sleep -Milliseconds 250 }
  }
  if (-not $healthy) { throw 'Temporary backend did not become healthy.' }
  Invoke-Checked 'python.exe' @('scripts/tests/api-smoke.py') $ProjectRoot

  Stop-Process -Id $BackendProcess.Id -Force
  $BackendProcess = $null

  Write-Host '[STEP] 375px and production-page browser regression' -ForegroundColor Cyan
  Invoke-Checked 'npm.cmd' @('run', 'test:smoke') (Join-Path $ProjectRoot 'frontend')
  Invoke-Checked 'npm.cmd' @('run', 'test:production') (Join-Path $ProjectRoot 'frontend')
  Write-Host '[OK] Phase 11 acceptance passed without using the production database.' -ForegroundColor Green
} finally {
  if ($BackendProcess -and -not $BackendProcess.HasExited) { Stop-Process -Id $BackendProcess.Id -Force -ErrorAction SilentlyContinue }
  foreach ($name in @('STARCOIN_DB_PATH', 'NODE_ENV', 'PORT', 'JWT_SECRET', 'STARCOIN_API_BASE')) {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
