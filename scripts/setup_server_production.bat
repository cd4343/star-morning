@echo off
REM ========================================
REM Star Coin production server setup
REM Run this once after deploying code to a Windows server.
REM It writes scripts\production_env.local.bat, backs up the database,
REM installs dependencies, builds backend/frontend, and verifies DB migration.
REM ========================================
setlocal enabledelayedexpansion
cd /d "%~dp0.."
chcp 65001 >nul 2>&1
title Star Coin - Production Setup
color 0B

echo ========================================
echo Star Coin Production Setup
echo ========================================
echo Project: %CD%
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] This console is not running as Administrator.
    echo [WARN] Starting the production HTTP server on port 80 may fail later.
    echo.
)

if "%~1"=="/?" goto :HELP
if /I "%~1"=="-h" goto :HELP
if /I "%~1"=="--help" goto :HELP

where node >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Node.js was not found in PATH.
    pause
    exit /b 1
)

where npm >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] npm was not found in PATH.
    pause
    exit /b 1
)

where python >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Python was not found in PATH.
    pause
    exit /b 1
)

REM Phase 1 package marker: fail here when the ZIP was extracted into a nested folder
REM instead of overlaying the real project root.
if not exist "frontend\src\pages\child\ChildToday.tsx" (
    color 0C
    echo [ERROR] Phase 1 source is not present in this project root:
    echo %CD%
    echo [HINT] The update ZIP must overlay backend, frontend and scripts in this directory.
    pause
    exit /b 1
)
if not exist "backend\src\productConfig.ts" (
    color 0C
    echo [ERROR] Phase 1 backend source is missing. The patch was not fully overlaid.
    pause
    exit /b 1
)
if not exist "frontend\src\components\EconomySettingsPanel.tsx" (
    color 0C
    echo [ERROR] Phase 2 economy panel source is missing. The P2-E4 patch was not fully overlaid.
    pause
    exit /b 1
)
if not exist "backend\src\wishEconomy.ts" (
    color 0C
    echo [ERROR] Phase 2 wish economy source is missing. The P2-E4 patch was not fully overlaid.
    pause
    exit /b 1
)

set "DEFAULT_DOMAIN=starcoin.h5-online.com"
set "DEFAULT_CORS=http://%DEFAULT_DOMAIN%"
set "DEFAULT_DB_PATH=%CD%\stellar.db"
set "DEFAULT_BACKUP_DIR=%CD%\backups"

echo Press Enter to accept the default shown in brackets.
echo.

set "DOMAIN="
set /p "DOMAIN=Domain [%DEFAULT_DOMAIN%]: "
if not defined DOMAIN set "DOMAIN=%DEFAULT_DOMAIN%"

set "CORS_ORIGIN="
set /p "CORS_ORIGIN=CORS origin [%DEFAULT_CORS%]: "
if not defined CORS_ORIGIN set "CORS_ORIGIN=%DEFAULT_CORS%"

REM Inherit existing config as defaults: press Enter at prompts to keep current values.
if exist "scripts\production_env.local.bat" (
    call "scripts\production_env.local.bat"
    echo [OK] Existing production_env.local.bat loaded. Press Enter at prompts to keep current values.
)
set "OLD_JWT_SECRET=%JWT_SECRET%"
set "OLD_AMAP_KEY=%AMAP_WEB_SERVICE_KEY%"

set "STARCOIN_DB_PATH="
set /p "STARCOIN_DB_PATH=Database path [%DEFAULT_DB_PATH%]: "
if not defined STARCOIN_DB_PATH set "STARCOIN_DB_PATH=%DEFAULT_DB_PATH%"

set "STARCOIN_BACKUP_DIR="
set /p "STARCOIN_BACKUP_DIR=Backup directory [%DEFAULT_BACKUP_DIR%]: "
if not defined STARCOIN_BACKUP_DIR set "STARCOIN_BACKUP_DIR=%DEFAULT_BACKUP_DIR%"

set "JWT_SECRET="
set /p "JWT_SECRET=JWT secret [keep existing / auto-generate]: "
if not defined JWT_SECRET if defined OLD_JWT_SECRET set "JWT_SECRET=%OLD_JWT_SECRET%"
if not defined JWT_SECRET (
    for /f "usebackq delims=" %%s in (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`) do set "JWT_SECRET=%%s"
)

if not defined JWT_SECRET (
    color 0C
    echo [ERROR] Failed to generate JWT_SECRET.
    pause
    exit /b 1
)

set "AMAP_WEB_SERVICE_KEY="
set /p "AMAP_WEB_SERVICE_KEY=AMap Web Service key [keep existing / optional]: "
if not defined AMAP_WEB_SERVICE_KEY if defined OLD_AMAP_KEY set "AMAP_WEB_SERVICE_KEY=%OLD_AMAP_KEY%"

echo.
echo SMS setup:
echo   Leave SMS provider empty if you do not have a real SMS gateway yet.
echo   Use provider "http" when you have an HTTP endpoint that accepts JSON:
echo   { "phone": "...", "code": "...", "purpose": "login" }
echo.
set "SMS_PROVIDER="
set /p "SMS_PROVIDER=SMS provider [none/http/mock]: "

set "SMS_HTTP_URL="
if /I "%SMS_PROVIDER%"=="http" (
    set /p "SMS_HTTP_URL=SMS HTTP URL: "
    if not defined SMS_HTTP_URL (
        color 0C
        echo [ERROR] SMS_HTTP_URL is required when SMS_PROVIDER=http.
        pause
        exit /b 1
    )
)

set "SMS_HTTP_TOKEN="
if /I "%SMS_PROVIDER%"=="http" (
    set /p "SMS_HTTP_TOKEN=SMS HTTP token [optional]: "
)

set "SMS_EXPOSE_DEV_CODE="
if /I "%SMS_PROVIDER%"=="mock" (
    set /p "SMS_EXPOSE_DEV_CODE=Show mock code in production UI? [false]: "
    if not defined SMS_EXPOSE_DEV_CODE set "SMS_EXPOSE_DEV_CODE=false"
)

if not exist "%STARCOIN_BACKUP_DIR%" (
    mkdir "%STARCOIN_BACKUP_DIR%"
    if errorlevel 1 (
        color 0C
        echo [ERROR] Failed to create backup directory:
        echo %STARCOIN_BACKUP_DIR%
        pause
        exit /b 1
    )
)

for /f "usebackq delims=" %%t in (`node -e "const d=new Date();const p=n=>String(n).padStart(2,'0');console.log(d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds()))"`) do set "STAMP=%%t"

if exist "%STARCOIN_DB_PATH%" (
    echo [INFO] Backing up database before setup...
    copy /Y "%STARCOIN_DB_PATH%" "%STARCOIN_BACKUP_DIR%\stellar-before-setup-%STAMP%.db" >nul
    if exist "%STARCOIN_DB_PATH%-wal" copy /Y "%STARCOIN_DB_PATH%-wal" "%STARCOIN_BACKUP_DIR%\stellar-before-setup-%STAMP%.db-wal" >nul
    if exist "%STARCOIN_DB_PATH%-shm" copy /Y "%STARCOIN_DB_PATH%-shm" "%STARCOIN_BACKUP_DIR%\stellar-before-setup-%STAMP%.db-shm" >nul
    echo [OK] Database backup written to:
    echo %STARCOIN_BACKUP_DIR%
) else (
    echo [WARN] Database file does not exist yet:
    echo %STARCOIN_DB_PATH%
    echo [WARN] The backend will create it on first migration/start.
)
echo.

set "ENV_FILE=%CD%\scripts\production_env.local.bat"
(
    echo @echo off
    echo REM Generated by scripts\setup_server_production.bat on %DATE% %TIME%
    echo set "NODE_ENV=production"
    echo set "PORT=3001"
    echo set "JWT_SECRET=%JWT_SECRET%"
    echo set "STARCOIN_DB_PATH=%STARCOIN_DB_PATH%"
    echo set "ENABLE_DB_BACKUP=true"
    echo set "STARCOIN_BACKUP_DIR=%STARCOIN_BACKUP_DIR%"
    echo set "CORS_ORIGIN=%CORS_ORIGIN%"
    echo set "REQUEST_LOGS=false"
    echo set "TRUST_PROXY=1"
    if defined AMAP_WEB_SERVICE_KEY echo set "AMAP_WEB_SERVICE_KEY=%AMAP_WEB_SERVICE_KEY%"
    if defined SMS_PROVIDER echo set "SMS_PROVIDER=%SMS_PROVIDER%"
    if defined SMS_HTTP_URL echo set "SMS_HTTP_URL=%SMS_HTTP_URL%"
    if defined SMS_HTTP_TOKEN echo set "SMS_HTTP_TOKEN=%SMS_HTTP_TOKEN%"
    if defined SMS_EXPOSE_DEV_CODE echo set "SMS_EXPOSE_DEV_CODE=%SMS_EXPOSE_DEV_CODE%"
) > "%ENV_FILE%"

if not exist "%ENV_FILE%" (
    color 0C
    echo [ERROR] Failed to write production environment file.
    pause
    exit /b 1
)

echo [OK] Wrote production environment:
echo %ENV_FILE%
echo.

call "%ENV_FILE%"

echo [1/4] Installing backend dependencies...
pushd backend
call npm install --include=dev
if %errorlevel% neq 0 (
    popd
    color 0C
    echo [ERROR] Backend npm install failed.
    pause
    exit /b 1
)

echo [2/4] Building backend...
call npm run build
if %errorlevel% neq 0 (
    popd
    color 0C
    echo [ERROR] Backend build failed.
    pause
    exit /b 1
)
popd

echo [3/4] Installing frontend dependencies...
pushd frontend
call npm install --include=dev
if %errorlevel% neq 0 (
    popd
    color 0C
    echo [ERROR] Frontend npm install failed.
    pause
    exit /b 1
)

echo [4/4] Building frontend...
call npm run build
if %errorlevel% neq 0 (
    popd
    color 0C
    echo [ERROR] Frontend build failed.
    pause
    exit /b 1
)
popd

echo [INFO] Verifying Phase 1 and Phase 2 build assets...
node scripts\verify_phase1_deployment.js
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Frontend/backend build output is incomplete.
    pause
    exit /b 1
)

echo.
echo [INFO] Running database migration check...
node -e "const d=require('./backend/dist/database');const r=require('./backend/dist/rewardSystem');(async()=>{await d.initializeDatabase();await r.initRewardTables();await r.initLotteryTables();const db=d.getDb();const i=await db.get('PRAGMA integrity_check');const f=await db.all('PRAGMA foreign_key_check');console.log('[DB] integrity_check:',Object.values(i)[0]);console.log('[DB] foreign_key_check errors:',f.length);await db.close();process.exit(f.length?1:0);})().catch(e=>{console.error(e);process.exit(1);});"
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Database migration check failed.
    echo [INFO] Your original database backup is in:
    echo %STARCOIN_BACKUP_DIR%
    pause
    exit /b 1
)

color 0A
echo.
echo ========================================
echo Setup completed
echo ========================================
echo Domain: http://%DOMAIN%/
echo Frontend port: 80
echo Backend API: http://localhost:3001/api
echo Database: %STARCOIN_DB_PATH%
echo Backups: %STARCOIN_BACKUP_DIR%
echo.
echo Next step:
echo   scripts\start_backend_only.bat
echo Then verify Nginx is serving this exact build:
echo   scripts\verify_live_frontend.bat
echo.
echo For later code updates, use the safe one-click workflow:
echo   scripts\deploy_server_production.bat
echo ========================================
pause
exit /b 0

:HELP
echo Usage:
echo   scripts\setup_server_production.bat
echo.
echo This script should be run from the deployed project on the server.
echo It does not delete old code or overwrite your database.
echo It writes scripts\production_env.local.bat for start_server_simple.bat.
exit /b 0
