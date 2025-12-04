@echo off
REM ========================================
REM Smart Launcher - Auto-detect Environment
REM ========================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

chcp 65001 >nul 2>&1
title Star Morning System - Smart Launcher
color 0A

echo ========================================
echo Star Morning System - Smart Launcher
echo ========================================
echo.
echo Please select environment:
echo.
echo   1. Local Development (Ports 3000/3001)
echo      - Frontend: http://localhost:3000
echo      - Backend: http://localhost:3001
echo      - Uses Node.js + Vite
echo.
echo   2. Production Server (Port 80)
echo      - Access: http://starcoin.h5-online.com/
echo      - Uses Python HTTP Server
echo.
set /p "choice=Enter your choice (1 or 2): "

if "!choice!"=="1" (
    echo.
    echo [INFO] Starting Local Development Environment...
    echo.
    call "%~dp0start_app_local.bat"
    exit /b %errorlevel%
) else if "!choice!"=="2" (
    echo.
    echo [INFO] Starting Production Server Environment...
    echo.
    call "%~dp0start_app_production.bat"
    exit /b %errorlevel%
) else (
    color 0C
    echo.
    echo [ERROR] Invalid choice! Please run the script again.
    echo.
    pause
    exit /b 1
)
