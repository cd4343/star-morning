@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."
chcp 65001 >nul 2>&1
title Star Coin - Backend Only (Nginx mode)

if exist "scripts\production_env.local.bat" (
    call "scripts\production_env.local.bat"
    echo [OK] Loaded production_env.local.bat
) else (
    echo [ERROR] production_env.local.bat not found.
    pause
    exit /b 1
)

if not defined JWT_SECRET (
    echo [ERROR] JWT_SECRET is not set.
    pause
    exit /b 1
)

REM Free port 3001 only. NEVER touch port 80 (nginx owns it).
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3001 " ^| findstr "LISTENING"') do (
    echo [INFO] Killing old backend PID %%p
    taskkill /f /pid %%p >nul 2>&1
)

if not exist "backend\dist\server.js" (
    echo [ERROR] backend\dist\server.js not found. Run setup_server_production.bat first.
    pause
    exit /b 1
)

node scripts\verify_phase1_deployment.js
if %errorlevel% neq 0 (
    echo [ERROR] Phase 1 or Phase 2 deployment files are incomplete or in the wrong project root.
    pause
    exit /b 1
)

echo [INFO] Starting backend on port %PORT% ...
cd backend
node dist\server.js
pause
