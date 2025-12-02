@echo off
cd /d "%~dp0"
title Star Morning Launcher
color 0A

echo =======================================================
echo        Star Morning System - Auto Launcher
echo =======================================================
echo Current Directory: %CD%

:: 1. Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b
)

echo.
echo [1/4] Checking environment...

:: 2. Check Backend Dependencies
if exist "backend\node_modules" goto :CHECK_FRONTEND
echo [INFO] Backend dependencies not found. Installing...
echo        (This may take a few minutes, please wait)
cd backend
call npm install
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Failed to install backend dependencies!
    cd ..
    pause
    exit /b
)
cd ..
echo [OK] Backend dependencies installed.

:CHECK_FRONTEND
:: 3. Check Frontend Dependencies
if exist "frontend\node_modules" goto :START_SERVERS
echo [INFO] Frontend dependencies not found. Installing...
echo        (This may take a few minutes, please wait)
cd frontend
call npm install
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Failed to install frontend dependencies!
    cd ..
    pause
    exit /b
)
cd ..
echo [OK] Frontend dependencies installed.

:START_SERVERS
echo.
echo [2/4] Cleaning up old processes...
taskkill /F /IM node.exe >nul 2>&1

echo.
echo [3/4] Starting Servers...

echo    - Starting Backend (Port 3001)...
start "Backend Server" cmd /k "cd backend && npm run dev"

echo    - Starting Frontend (Port 3000)...
start "Frontend Server" cmd /k "cd frontend && npm run dev"

echo.
echo [4/4] Waiting for services (8 seconds)...
timeout /t 8 >nul

echo.
echo [SUCCESS] Launching Browser...
start http://localhost:3000

echo.
echo =======================================================
echo  MOBILE ACCESS GUIDE:
echo  1. Ensure PC and Phone are on the same WiFi
echo  2. Find PC IP address (run 'ipconfig')
echo  3. Phone Browser: http://YOUR_IP:3000
echo =======================================================
echo.
echo Do not close this window or the black server windows.
pause
