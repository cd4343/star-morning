@echo off
REM ========================================
REM Local Development Environment Launcher
REM Ports: Frontend 3000, Backend 3001
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
    echo Or run: winget install OpenJS.NodeJS.LTS
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

REM Check and close ports
echo [4/5] Checking ports...
netstat -ano 2>nul | findstr ":3001 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3001 " ^| findstr "LISTENING" 2^>nul') do (
        if not "%%a"=="" (
            echo [Found] Closing process on port 3001, PID: %%a
            taskkill /F /PID %%a >nul 2>&1
        )
    )
)

netstat -ano 2>nul | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING" 2^>nul') do (
        if not "%%a"=="" (
            echo [Found] Closing process on port 3000, PID: %%a
            taskkill /F /PID %%a >nul 2>&1
        )
    )
)
timeout /t 1 /nobreak >nul
echo [Done] Port check completed
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
start "Backend Server (Local)" cmd /k "cd /d %CD%\backend && npm run dev"

echo    - Starting Frontend Server (Port 3000)...
start "Frontend Server (Local)" cmd /k "cd /d %CD%\frontend && npm run dev"

echo.
echo [INFO] Waiting for services to start (8 seconds)...
timeout /t 8 >nul

echo.
echo ========================================
echo [SUCCESS] Local Development Servers Started!
echo ========================================
echo.
echo Access URLs:
echo   - Frontend: http://localhost:3000
echo   - Backend API: http://localhost:3001
echo.
echo ========================================
echo MOBILE ACCESS GUIDE:
echo   1. Ensure PC and Phone are on same WiFi
echo   2. Find PC IP address (run 'ipconfig')
echo   3. Phone Browser: http://YOUR_IP:3000
echo ========================================
echo.
echo [INFO] Launching browser...
start http://localhost:3000

echo.
echo [TIP] Do not close this window or the server windows.
echo      Press Ctrl+C in server windows to stop servers.
echo.
pause
exit /b 0

