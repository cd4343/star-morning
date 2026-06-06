@echo off
REM Thin launcher for the PowerShell package builder.
setlocal
cd /d "%~dp0.."
chcp 65001 >nul 2>&1

where powershell >nul 2>&1
if errorlevel 1 (
    echo [ERROR] PowerShell was not found in PATH.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0prepare_server_package.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
    echo.
    echo [ERROR] Package preparation failed. Exit code: %EXIT_CODE%
    pause
    exit /b %EXIT_CODE%
)

echo.
pause
exit /b 0
