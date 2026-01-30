# ========================================
# Star Morning - PowerShell Development Launcher
# More reliable than batch scripts
# ========================================

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "Star Morning - Dev Launcher"

Write-Host ""
Write-Host "  =================================" -ForegroundColor Cyan
Write-Host "   Star Morning - Development Mode" -ForegroundColor Cyan
Write-Host "  =================================" -ForegroundColor Cyan
Write-Host ""

# Change to project root directory (parent of scripts folder)
Set-Location (Join-Path $PSScriptRoot "..")

# Function to kill process on port
function Stop-PortProcess {
    param([int]$Port)
    $connections = netstat -ano | Select-String ":$Port " | Select-String "LISTENING"
    foreach ($conn in $connections) {
        $processId = ($conn -split '\s+')[-1]
        if ($processId -and $processId -ne "0") {
            Write-Host "  Stopping process on port $Port (PID: $processId)" -ForegroundColor Yellow
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
    }
}

# Clean up ports
Write-Host "[1/4] Cleaning up ports..." -ForegroundColor White
Stop-PortProcess -Port 3000
Stop-PortProcess -Port 3001
Start-Sleep -Seconds 2
Write-Host "      Done!" -ForegroundColor Green

# Check dependencies
Write-Host "[2/4] Checking dependencies..." -ForegroundColor White
if (-not (Test-Path "backend\node_modules")) {
    Write-Host "      Installing backend dependencies..." -ForegroundColor Yellow
    Push-Location backend
    npm install
    Pop-Location
}
if (-not (Test-Path "frontend\node_modules")) {
    Write-Host "      Installing frontend dependencies..." -ForegroundColor Yellow
    Push-Location frontend
    npm install
    Pop-Location
}
Write-Host "      Done!" -ForegroundColor Green

# Start Backend
Write-Host "[3/4] Starting Backend (Port 3001)..." -ForegroundColor White
$projectRoot = Join-Path $PSScriptRoot ".."
$backendJob = Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "cd /d `"$projectRoot\backend`" & npm run dev" -WindowStyle Minimized -PassThru

# Start Frontend  
Write-Host "[4/4] Starting Frontend (Port 3000)..." -ForegroundColor White
$frontendJob = Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "cd /d `"$projectRoot\frontend`" & npm run dev" -WindowStyle Minimized -PassThru

Write-Host ""
Write-Host "  Waiting for servers to be ready..." -ForegroundColor Gray

# Wait and verify
$maxWait = 20
$backendReady = $false
$frontendReady = $false

for ($i = 1; $i -le $maxWait; $i++) {
    Start-Sleep -Seconds 1
    
    if (-not $backendReady) {
        $check = netstat -ano | Select-String ":3001 " | Select-String "LISTENING"
        if ($check) {
            Write-Host "  [OK] Backend is ready!" -ForegroundColor Green
            $backendReady = $true
        }
    }
    
    if (-not $frontendReady) {
        $check = netstat -ano | Select-String ":3000 " | Select-String "LISTENING"
        if ($check) {
            Write-Host "  [OK] Frontend is ready!" -ForegroundColor Green
            $frontendReady = $true
        }
    }
    
    if ($backendReady -and $frontendReady) {
        break
    }
    
    Write-Host "       Waiting... ($i/$maxWait)" -ForegroundColor Gray
}

Write-Host ""

if ($backendReady -and $frontendReady) {
    Write-Host "  =================================" -ForegroundColor Green
    Write-Host "   All Services Started!" -ForegroundColor Green
    Write-Host "  =================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Frontend: " -NoNewline; Write-Host "http://localhost:3000" -ForegroundColor Cyan
    Write-Host "  Backend:  " -NoNewline; Write-Host "http://localhost:3001" -ForegroundColor Cyan
    Write-Host ""
    
    # Get local IP
    $localIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.*" }).IPAddress | Select-Object -First 1
    if ($localIP) {
        Write-Host "  Mobile:   " -NoNewline; Write-Host "http://${localIP}:3000" -ForegroundColor Cyan
    }
    
    Write-Host ""
    Start-Process "http://localhost:3000"
} else {
    Write-Host "  =================================" -ForegroundColor Yellow
    Write-Host "   Warning: Some services may have issues" -ForegroundColor Yellow
    Write-Host "  =================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Try: http://127.0.0.1:3000" -ForegroundColor White
    Write-Host ""
    if (-not $backendReady) {
        Write-Host "  [!] Backend not ready - check backend window" -ForegroundColor Red
    }
    if (-not $frontendReady) {
        Write-Host "  [!] Frontend not ready - check frontend window" -ForegroundColor Red
        Write-Host "      Tip: VPN/Proxy might be blocking localhost" -ForegroundColor Yellow
    }
    Start-Process "http://127.0.0.1:3000"
}

Write-Host ""
Write-Host "  Server windows are minimized in taskbar." -ForegroundColor Gray
Write-Host "  Press any key to close this launcher..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

