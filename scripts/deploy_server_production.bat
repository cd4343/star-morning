@echo off
setlocal
cd /d "%~dp0.."
chcp 65001 >nul 2>&1
title Star Coin - Safe Production Deploy

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CD%\scripts\deploy_server_production.ps1" %*
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" (
    color 0C
    echo.
    echo [ERROR] Safe production deployment failed. Review the messages above.
) else (
    color 0A
)
pause
exit /b %RESULT%
