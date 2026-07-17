@echo off
setlocal
cd /d "%~dp0.."
title Star Coin - Read-only Operations Report

if exist "scripts\production_env.local.bat" call "scripts\production_env.local.bat"
if not defined STARCOIN_DB_PATH (
    echo [ERROR] STARCOIN_DB_PATH is not set. Run setup_server_production.bat first.
    pause
    exit /b 1
)
if not exist "backend\dist\operationsReport.js" (
    echo [ERROR] backend\dist\operationsReport.js is missing. Deploy the latest build first.
    pause
    exit /b 1
)

set "DAYS=%~1"
if not defined DAYS set "DAYS=7"
if not exist "logs" mkdir "logs"
set "REPORT=logs\operations-report-latest.json"
set "TEMP_REPORT=%REPORT%.tmp"

node "backend\dist\operationsReport.js" --db "%STARCOIN_DB_PATH%" --days "%DAYS%" > "%TEMP_REPORT%"
if errorlevel 1 (
    if exist "%TEMP_REPORT%" del /q "%TEMP_REPORT%"
    echo [ERROR] Report generation failed. The database was not modified.
    pause
    exit /b 1
)

move /y "%TEMP_REPORT%" "%REPORT%" >nul
if errorlevel 1 (
    echo [ERROR] Report file could not be replaced. Close it and try again.
    pause
    exit /b 1
)
echo [OK] Read-only privacy-safe report created:
echo %CD%\%REPORT%
pause
