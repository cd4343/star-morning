@echo off
REM ========================================
REM One-Click Start (PowerShell Version)
REM ========================================
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo.
echo ========================================
echo Star Morning - PowerShell Launcher
echo ========================================
echo.

REM Check PowerShell
where powershell >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] PowerShell not found!
    echo.
    pause
    exit /b 1
)

echo [INFO] Starting via PowerShell...
echo.

REM Execute PowerShell with error handling
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& { try { & '%~dp0start_dev.ps1' } catch { Write-Host '[ERROR]' $_.Exception.Message -ForegroundColor Red; Read-Host 'Press Enter to exit' } }"

REM If PowerShell fails, show error
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo [ERROR] PowerShell script failed!
    echo.
    pause
)
