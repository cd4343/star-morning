@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."
chcp 65001 >nul 2>&1
title Star Coin - Simple Production Start

echo ========================================
echo Star Coin Simple Production Start
echo ========================================
echo Project: %CD%
echo.

if exist "scripts\production_env.local.bat" (
    call "scripts\production_env.local.bat"
    echo [OK] Loaded scripts\production_env.local.bat
) else (
    echo [WARN] scripts\production_env.local.bat not found. Using defaults.
)

if not defined NODE_ENV set "NODE_ENV=production"
if not defined PORT set "PORT=3001"
if not defined JWT_SECRET set "JWT_SECRET=stellar-system-production-secret-change-me"
if not defined STARCOIN_DB_PATH set "STARCOIN_DB_PATH=%CD%\stellar.db"
if not defined ENABLE_DB_BACKUP set "ENABLE_DB_BACKUP=true"
if not defined STARCOIN_BACKUP_DIR set "STARCOIN_BACKUP_DIR=%CD%\backups"
if not defined REQUEST_LOGS set "REQUEST_LOGS=false"

if not exist "backend\dist\server.js" (
    echo [ERROR] backend\dist\server.js not found.
    echo Please run scripts\setup_server_production.bat first.
    pause
    exit /b 1
)

if not exist "frontend\dist\index.html" (
    echo [ERROR] frontend\dist\index.html not found.
    echo Please run scripts\setup_server_production.bat first.
    pause
    exit /b 1
)

if not exist "scripts\server.py" (
    echo [ERROR] scripts\server.py not found.
    pause
    exit /b 1
)

if not exist "%STARCOIN_BACKUP_DIR%" mkdir "%STARCOIN_BACKUP_DIR%" >nul 2>&1
if not exist "logs" mkdir "logs" >nul 2>&1

echo [INFO] Closing existing listeners on ports 80 and %PORT%...
for %%P in (80 %PORT%) do (
    for /f "tokens=5" %%A in ('netstat -ano 2^>nul ^| findstr ":%%P " ^| findstr "LISTENING"') do (
        if not "%%A"=="" (
            echo [INFO] Killing PID %%A on port %%P
            taskkill /F /PID %%A >nul 2>&1
        )
    )
)

set "BACKEND_LOG=%CD%\logs\backend.log"
set "BACKEND_START=%TEMP%\starcoin_backend_start_simple.bat"
(
    echo @echo off
    echo chcp 65001 ^>nul 2^>^&1
    echo cd /d "%CD%\backend"
    echo set "NODE_ENV=%NODE_ENV%"
    echo set "PORT=%PORT%"
    echo set "JWT_SECRET=%JWT_SECRET%"
    echo set "STARCOIN_DB_PATH=%STARCOIN_DB_PATH%"
    echo set "ENABLE_DB_BACKUP=%ENABLE_DB_BACKUP%"
    echo set "STARCOIN_BACKUP_DIR=%STARCOIN_BACKUP_DIR%"
    echo set "CORS_ORIGIN=%CORS_ORIGIN%"
    echo set "REQUEST_LOGS=%REQUEST_LOGS%"
    if defined SMS_PROVIDER echo set "SMS_PROVIDER=%SMS_PROVIDER%"
    if defined SMS_HTTP_URL echo set "SMS_HTTP_URL=%SMS_HTTP_URL%"
    if defined SMS_HTTP_TOKEN echo set "SMS_HTTP_TOKEN=%SMS_HTTP_TOKEN%"
    if defined SMS_EXPOSE_DEV_CODE echo set "SMS_EXPOSE_DEV_CODE=%SMS_EXPOSE_DEV_CODE%"
    echo npm start ^> "%BACKEND_LOG%" 2^>^&1
) > "%BACKEND_START%"

echo [INFO] Starting backend on port %PORT%...
start "Star Coin Backend" cmd /k "%BACKEND_START%"

echo [INFO] Waiting for backend...
set "BACKEND_READY=0"
for /L %%I in (1,1,30) do (
    if "!BACKEND_READY!"=="0" (
        timeout /t 1 /nobreak >nul
        netstat -ano 2>nul | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
        if !errorlevel! equ 0 (
            set "BACKEND_READY=1"
            echo [OK] Backend is listening on port %PORT%.
        ) else (
            echo Waiting... %%I/30
        )
    )
)

if not "!BACKEND_READY!"=="1" (
    echo.
    echo [ERROR] Backend did not start.
    echo Backend log:
    if exist "%BACKEND_LOG%" type "%BACKEND_LOG%"
    pause
    exit /b 1
)

echo.
echo ========================================
echo Frontend proxy starting on port 80
echo ========================================
echo Frontend: http://starcoin.h5-online.com/ or http://localhost/
echo Backend:  http://localhost:%PORT%/api
echo.
echo Keep this window open.
echo Press Ctrl+C to stop the frontend proxy.
echo ========================================
echo.

python scripts\server.py

echo.
echo [INFO] Frontend proxy stopped.
pause
exit /b 0
