@echo off
REM ========================================
REM Local Development Environment Launcher
REM Ports: Frontend 3000, Backend 3001
REM With Auto-Retry and Port Verification
REM ========================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

chcp 65001 >nul 2>&1
title Star Morning - Local Development
color 0A

echo ========================================
echo Star Morning System - LOCAL DEVELOPMENT
echo ========================================
echo Environment: Local Development
echo Frontend Port: 3000
echo Backend Port: 3001
echo ========================================
echo Current Directory: %CD%
echo.

REM Check Node.js
echo [1/5] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    color 0E
    echo [ERROR] Node.js not found!
    echo Please install Node.js: https://nodejs.org/
    pause
    exit /b 1
)

set "NODE_VERSION=Unknown"
for /f "tokens=*" %%i in ('node --version 2^>^&1') do set NODE_VERSION=%%i
echo [OK] Node.js version: !NODE_VERSION!
echo.

REM Check npm
echo [2/5] Checking npm...
where npm >nul 2>&1
if %errorlevel% neq 0 (
    color 0E
    echo [ERROR] npm not found!
    pause
    exit /b 1
)

set "NPM_VERSION=Unknown"
for /f "tokens=*" %%i in ('npm --version 2^>^&1') do set NPM_VERSION=%%i
echo [OK] npm version: !NPM_VERSION!
echo.

REM Check project files
echo [3/5] Checking project files...
if not exist "backend\package.json" (
    echo [ERROR] backend\package.json not found!
    pause
    exit /b 1
)
if not exist "frontend\package.json" (
    echo [ERROR] frontend\package.json not found!
    pause
    exit /b 1
)
echo [OK] Project files found
echo.

REM Force close all existing node processes on ports
echo [4/5] Cleaning up ports...
call :ClosePort 3000
call :ClosePort 3001
timeout /t 2 /nobreak >nul
echo [Done] Port cleanup completed
echo.

REM Check dependencies
echo [5/5] Checking dependencies...
if not exist "backend\node_modules" (
    echo [INFO] Installing backend dependencies...
    cd backend
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install backend dependencies!
        cd ..
        pause
        exit /b 1
    )
    cd ..
) else (
    echo [OK] Backend dependencies found
)

if not exist "frontend\node_modules" (
    echo [INFO] Installing frontend dependencies...
    cd frontend
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install frontend dependencies!
        cd ..
        pause
        exit /b 1
    )
    cd ..
) else (
    echo [OK] Frontend dependencies found
)
echo.

REM Start servers
color 0A
echo ========================================
echo [SUCCESS] Starting Local Development Servers
echo ========================================
echo.

echo    - Starting Backend Server (Port 3001)...
start "Backend Server" /MIN cmd /c "cd /d %CD%\backend && npm run dev"

echo    - Starting Frontend Server (Port 3000)...
start "Frontend Server" /MIN cmd /c "cd /d %CD%\frontend && npm run dev"

echo.
echo [INFO] Waiting for services to initialize...

REM Wait and verify Backend (3001)
set BACKEND_READY=0
for /L %%i in (1,1,15) do (
    if !BACKEND_READY! equ 0 (
        timeout /t 1 /nobreak >nul
        netstat -ano 2>nul | findstr ":3001 " | findstr "LISTENING" >nul 2>&1
        if !errorlevel! equ 0 (
            echo [OK] Backend is ready on port 3001
            set BACKEND_READY=1
        ) else (
            echo        Waiting for Backend... (%%i/15)
        )
    )
)

if !BACKEND_READY! equ 0 (
    color 0E
    echo [WARNING] Backend may not have started properly!
)

REM Wait and verify Frontend (3000)
set FRONTEND_READY=0
for /L %%i in (1,1,15) do (
    if !FRONTEND_READY! equ 0 (
        timeout /t 1 /nobreak >nul
        netstat -ano 2>nul | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
        if !errorlevel! equ 0 (
            echo [OK] Frontend is ready on port 3000
            set FRONTEND_READY=1
        ) else (
            echo        Waiting for Frontend... (%%i/15)
        )
    )
)

if !FRONTEND_READY! equ 0 (
    color 0E
    echo [WARNING] Frontend may not have started properly!
    echo.
    echo [TIP] If localhost:3000 doesn't work, try:
    echo       - http://127.0.0.1:3000
    echo       - Check if VPN/Proxy is blocking localhost
    echo.
)

echo.
if !BACKEND_READY! equ 1 if !FRONTEND_READY! equ 1 (
    color 0A
    echo ========================================
    echo [SUCCESS] All Services Started!
    echo ========================================
) else (
    color 0E
    echo ========================================
    echo [WARNING] Some services may have issues
    echo ========================================
)

echo.
echo Access URLs:
echo   - Frontend: http://localhost:3000
echo   - Fallback: http://127.0.0.1:3000
echo   - Backend API: http://localhost:3001
echo.

REM Get local IP for mobile access
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4" ^| findstr "192.168"') do (
    set LOCAL_IP=%%a
    set LOCAL_IP=!LOCAL_IP: =!
    goto :gotip
)
:gotip
echo ========================================
echo MOBILE ACCESS:
if defined LOCAL_IP (
    echo   Phone Browser: http://!LOCAL_IP!:3000
) else (
    echo   Run 'ipconfig' to find your IP
)
echo ========================================
echo.

echo [INFO] Launching browser...
if !FRONTEND_READY! equ 1 (
    start http://localhost:3000
) else (
    start http://127.0.0.1:3000
)

echo.
echo [TIP] Server windows are minimized in taskbar.
echo      Press Ctrl+C in those windows to stop servers.
echo.
pause
exit /b 0

REM ========================================
REM Function: Close process on port
REM ========================================
:ClosePort
set PORT=%1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%PORT% " ^| findstr "LISTENING" 2^>nul') do (
    if not "%%a"=="" if not "%%a"=="0" (
        echo    Closing process on port %PORT%, PID: %%a
        taskkill /F /PID %%a >nul 2>&1
    )
)
exit /b 0
