@echo off
REM ========================================
REM Production Server Environment Launcher
REM Port: 80 (Static file server via Python)
REM ========================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

chcp 65001 >nul 2>&1
title Star Morning - Production Server
color 0B

echo ========================================
echo Star Morning System - PRODUCTION SERVER
echo ========================================
echo Environment: Production Server
echo Port: 80
echo Domain: http://starcoin.h5-online.com/
echo ========================================
echo Current Directory: %CD%
echo.

REM Check Python
echo [1/3] Checking Python...
where python >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Python not found!
    echo Please install Python: https://www.python.org/downloads/
    pause
    exit /b 1
)

set "PYTHON_VERSION=Unknown"
for /f "tokens=*" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
echo [OK] Python version: !PYTHON_VERSION!
echo.

REM Check Node.js (needed for building frontend and running backend)
echo [2/4] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Node.js not found!
    echo Node.js is required for building frontend and running backend.
    pause
    exit /b 1
)

set "NODE_VERSION=Unknown"
for /f "tokens=*" %%i in ('node --version 2^>^&1') do set NODE_VERSION=%%i
echo [OK] Node.js version: !NODE_VERSION!
echo.

REM Check server files
echo [3/4] Checking server files...
if not exist "server.py" (
    color 0C
    echo [ERROR] server.py not found!
    pause
    exit /b 1
)
echo [OK] server.py found

REM Check built frontend files (no need to build, use pre-built files)
if not exist "frontend\dist\index.html" (
    color 0E
    echo [WARN] frontend\dist\index.html not found!
    echo [INFO] Frontend files should be built in local development environment.
    echo [ACTION] Please build frontend first:
    echo   1. Go to frontend directory
    echo   2. Run: npm run build
    echo   3. Copy the dist folder to production server
    echo.
    pause
    exit /b 1
)
echo [OK] Built frontend files found (frontend\dist\index.html)

if not exist "backend\package.json" (
    color 0C
    echo [ERROR] backend\package.json not found!
    pause
    exit /b 1
)
echo [OK] Backend project found
echo.

REM Check and close ports
echo [4/4] Checking and closing ports...

REM Close port 80 (Frontend static server)
netstat -ano 2>nul | findstr ":80 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":80 " ^| findstr "LISTENING" 2^>nul') do (
        if not "%%a"=="" (
            echo [Found] Closing process on port 80, PID: %%a
            taskkill /F /PID %%a >nul 2>&1
        )
    )
)

REM Close port 3001 (Backend API server)
netstat -ano 2>nul | findstr ":3001 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3001 " ^| findstr "LISTENING" 2^>nul') do (
        if not "%%a"=="" (
            echo [Found] Closing process on port 3001, PID: %%a
            taskkill /F /PID %%a >nul 2>&1
        )
    )
)

timeout /t 1 /nobreak >nul
echo [Done] Port check completed
echo.

REM Start servers
color 0B
echo ========================================
echo [SUCCESS] Starting Production Servers
echo ========================================
echo.

REM Check backend dependencies
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
)

REM Start backend server
echo [INFO] Starting Backend API Server (Port 3001)...
start "Backend Server (Production)" cmd /k "cd /d %CD%\backend && npm run dev"

REM Wait a bit for backend to start
timeout /t 3 /nobreak >nul

REM Start frontend static server
echo [INFO] Starting Frontend Static Server (Port 80)...
echo.
echo ========================================
echo Production Servers Starting...
echo ========================================
echo.
echo Frontend: http://starcoin.h5-online.com/ or http://localhost/
echo Backend API: http://localhost:3001/api
echo.
echo [WARNING] Using port 80 requires administrator privileges!
echo.
echo Press Ctrl+C in server windows to stop servers
echo ========================================
echo.

REM Start Python server pointing to frontend/dist directory
python server.py

pause
exit /b 0

