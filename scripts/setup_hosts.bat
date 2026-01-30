@echo off
REM ========================================
REM Setup Hosts File for Local Domain
REM ========================================
setlocal enabledelayedexpansion

chcp 65001 >nul 2>&1
title Setup Hosts File
color 0A

echo ========================================
echo Setup Hosts File for starcoin.h5-online.com
echo ========================================
echo.
echo This script will add the following entry to your hosts file:
echo   127.0.0.1    starcoin.h5-online.com
echo.
echo [WARNING] This requires administrator privileges!
echo.

REM Check if running as administrator
net session >nul 2>&1
if %errorlevel% neq 0 (
    color 0E
    echo [ERROR] This script must be run as Administrator!
    echo.
    echo [ACTION] Please:
    echo   1. Right-click this file
    echo   2. Select "Run as administrator"
    echo.
    pause
    exit /b 1
)

echo [INFO] Administrator privileges confirmed.
echo.

REM Get hosts file path
set "HOSTS_FILE=%SystemRoot%\System32\drivers\etc\hosts"
set "DOMAIN=starcoin.h5-online.com"
set "IP=127.0.0.1"

REM Check if entry already exists
findstr /C:"%DOMAIN%" "%HOSTS_FILE%" >nul 2>&1
if %errorlevel% equ 0 (
    color 0E
    echo [INFO] Domain entry already exists in hosts file.
    echo.
    echo Current entry:
    findstr /C:"%DOMAIN%" "%HOSTS_FILE%"
    echo.
    echo [ACTION] Do you want to remove the existing entry? (Y/N)
    set /p "remove=Enter choice: "
    if /i "!remove!"=="Y" (
        echo [INFO] Removing existing entry...
        REM Create temporary file without the domain entry
        findstr /V /C:"%DOMAIN%" "%HOSTS_FILE%" > "%HOSTS_FILE%.tmp"
        move /Y "%HOSTS_FILE%.tmp" "%HOSTS_FILE%" >nul
        echo [OK] Entry removed.
        echo.
    ) else (
        echo [INFO] Keeping existing entry.
        echo.
        pause
        exit /b 0
    )
)

REM Add entry to hosts file
echo [INFO] Adding domain entry to hosts file...
echo %IP%    %DOMAIN% >> "%HOSTS_FILE%"

if %errorlevel% equ 0 (
    color 0A
    echo [SUCCESS] Domain entry added successfully!
    echo.
    echo Added entry:
    echo   %IP%    %DOMAIN%
    echo.
    echo [INFO] You can now access the site at:
    echo   http://starcoin.h5-online.com/
    echo.
) else (
    color 0C
    echo [ERROR] Failed to add entry to hosts file!
    echo.
    pause
    exit /b 1
)

echo [TIP] To remove this entry later, edit the hosts file:
echo   %HOSTS_FILE%
echo   And remove the line containing: %DOMAIN%
echo.
pause
exit /b 0

