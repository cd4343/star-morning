@echo off
REM ========================================
REM Quick Start - One Click Launch
REM ========================================
setlocal enabledelayedexpansion
cd /d "%~dp0"
chcp 65001 >nul 2>&1
title Quick Start - Star Morning
color 0A

echo.
echo   =============================
echo    Star Morning - Quick Start
echo   =============================
echo.

REM Kill existing processes
echo [1/3] Cleaning up...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3001 " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
timeout /t 1 /nobreak >nul
echo       Done!

REM Start Backend
echo [2/3] Starting Backend...
start "Backend" /MIN cmd /c "cd /d %CD%\backend && npm run dev"
timeout /t 3 /nobreak >nul

REM Start Frontend
echo [3/3] Starting Frontend...
start "Frontend" /MIN cmd /c "cd /d %CD%\frontend && npm run dev"

echo.
echo   Waiting for servers...
timeout /t 8 /nobreak >nul

REM Quick verify
set READY=0
netstat -ano 2>nul | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
if !errorlevel! equ 0 set /a READY+=1
netstat -ano 2>nul | findstr ":3001 " | findstr "LISTENING" >nul 2>&1
if !errorlevel! equ 0 set /a READY+=1

echo.
if !READY! equ 2 (
    color 0A
    echo   [SUCCESS] Both servers running!
    echo.
    echo   Frontend: http://localhost:3000
    echo   Backend:  http://localhost:3001
    start http://localhost:3000
) else (
    color 0E
    echo   [WARNING] Servers may not be fully ready
    echo.
    echo   Try these URLs:
    echo   - http://localhost:3000
    echo   - http://127.0.0.1:3000
    start http://127.0.0.1:3000
)

echo.
echo   Server windows minimized in taskbar.
echo   Press any key to close this window...
pause >nul
exit /b 0

