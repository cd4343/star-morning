@echo off
REM ========================================
REM Production Server Environment Launcher
REM Port: 80 (Static file server via Python)
REM ========================================
setlocal enabledelayedexpansion
REM Change to project root directory (parent of scripts folder)
cd /d "%~dp0.."

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

REM Check Node.js (needed for running backend)
echo [2/5] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Node.js not found!
    pause
    exit /b 1
)

set "NODE_VERSION=Unknown"
for /f "tokens=*" %%i in ('node --version 2^>^&1') do set NODE_VERSION=%%i
echo [OK] Node.js version: !NODE_VERSION!
echo.

REM Check compiled backend
echo [3/5] Checking compiled backend...
if not exist "backend\dist\server.js" (
    color 0E
    echo [ERROR] backend\dist\server.js not found!
    echo Please build backend first: cd backend && npm run build
    pause
    exit /b 1
)
echo [OK] backend\dist\server.js found

REM Check server files
echo [4/5] Checking server files...
if not exist "scripts\server.py" (
    color 0C
    echo [ERROR] scripts\server.py not found!
    pause
    exit /b 1
)
echo [OK] scripts\server.py found

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
echo [5/5] Checking and closing ports...

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

REM Set JWT_SECRET if not set
if not defined JWT_SECRET (
    set "JWT_SECRET=stellar-system-production-secret-change-me"
    echo [WARN] JWT_SECRET not set, using default. Please set your own in production!
)

REM Start backend server
echo [INFO] Starting Backend API Server (Port 3001)...
set "PROJECT_DIR=%~dp0.."
set "BACKEND_LOG=%PROJECT_DIR%\backend\backend.log"

REM 清理旧日志
del "!BACKEND_LOG!" >nul 2>&1

REM 将后端启动命令写入临时脚本（避免引号嵌套问题）
set "BACKEND_START_BAT=%TEMP%\stellar_backend_start.bat"
(
    echo @echo off
    echo chcp 65001 ^>nul 2^>^&1
    echo cd /d "%PROJECT_DIR%\backend"
    echo set "JWT_SECRET=%JWT_SECRET%"
    echo echo [Backend] JWT_SECRET is set
    echo echo [Backend] Working directory: %%CD%%
    echo npm start ^> "%BACKEND_LOG%" 2^>^&1
) > "%BACKEND_START_BAT%"

REM 验证临时脚本是否创建成功
if not exist "%BACKEND_START_BAT%" (
    color 0C
    echo [ERROR] Failed to create temporary startup script!
    echo [TIP] Path: %BACKEND_START_BAT%
    pause
    exit /b 1
)

start "Backend Server (Production)" cmd /k "%BACKEND_START_BAT%"

REM 等待后端启动并验证
echo [INFO] Waiting for backend to be ready...
set BACKEND_READY=0
for /L %%i in (1,1,20) do (
    if !BACKEND_READY! equ 0 (
        timeout /t 1 /nobreak >nul
        netstat -ano 2>nul | findstr ":3001 " | findstr "LISTENING" >nul 2>&1
        if !errorlevel! equ 0 (
            echo [OK] Backend is ready on port 3001
            set BACKEND_READY=1
        ) else (
            echo        Waiting for Backend... (%%i/20)
        )
    )
)

if !BACKEND_READY! equ 0 (
    color 0C
    echo.
    echo [ERROR] Backend failed to start on port 3001!
    echo.
    echo [DIAGNOSTIC] Backend log file contents:
    if exist "%BACKEND_LOG%" (
        type "%BACKEND_LOG%"
    ) else (
        echo [DIAGNOSTIC] No log file found at %BACKEND_LOG%
    )
    echo.
    echo [TIP] Common causes:
    echo   1. JWT_SECRET not set (currently: %JWT_SECRET%)
    echo   2. backend\dist\server.js missing or corrupted
    echo   3. Node.js not in PATH of new console window
    echo   4. Port 3001 already in use by another process
    echo.
    echo [TIP] You can also manually test by running:
    echo   cd backend ^&^& set JWT_SECRET=your-secret ^&^& npm start
    pause
    exit /b 1
)

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

REM Open browser after a short delay
echo [INFO] Opening browser...
timeout /t 2 /nobreak >nul
start http://starcoin.h5-online.com/

REM Start Python server pointing to frontend/dist directory
python scripts\server.py

pause
exit /b 0

