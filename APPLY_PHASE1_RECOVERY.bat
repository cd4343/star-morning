@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title Star Coin - Apply Phase 1 Recovery

for %%I in ("%~dp0.") do set "PATCH_DIR=%%~fI"
set "TARGET=%~1"

if not defined TARGET (
    if exist "%PATCH_DIR%\stellar.db" (
        set "TARGET=%PATCH_DIR%"
    ) else (
        for %%I in ("%PATCH_DIR%\..") do set "PARENT_DIR=%%~fI"
        if exist "!PARENT_DIR!\stellar.db" set "TARGET=!PARENT_DIR!"
    )
)

if not defined TARGET (
    echo Enter the server project root that contains backend, frontend, scripts and stellar.db.
    set /p "TARGET=Project root: "
)

for %%I in ("%TARGET%") do set "TARGET=%%~fI"
if not exist "%TARGET%\stellar.db" goto :BAD_ROOT
if not exist "%TARGET%\backend\src" goto :BAD_ROOT
if not exist "%TARGET%\frontend\src" goto :BAD_ROOT
if not exist "%TARGET%\scripts" goto :BAD_ROOT
if not exist "%PATCH_DIR%\backend\src\productConfig.ts" goto :BAD_PATCH
if not exist "%PATCH_DIR%\frontend\src\pages\child\ChildToday.tsx" goto :BAD_PATCH

echo.
echo Patch source: %PATCH_DIR%
echo Server root: %TARGET%
echo Database will NOT be copied, replaced or deleted.
echo.
if /I "%PATCH_DIR%"=="%TARGET%" set "SELF_OVERLAY=1"

for /f "usebackq delims=" %%t in (`node -e "const d=new Date();const p=n=>String(n).padStart(2,'0');console.log(d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds()))"`) do set "STAMP=%%t"
set "CODE_BACKUP=%TARGET%\backups\code-before-phase1-recovery-%STAMP%"
mkdir "%CODE_BACKUP%" >nul 2>&1

echo [1/5] Backing up current code and build output...
robocopy "%TARGET%\backend\src" "%CODE_BACKUP%\backend\src" /E /R:1 /W:1 /NFL /NDL /NJH /NJS >nul
robocopy "%TARGET%\backend\dist" "%CODE_BACKUP%\backend\dist" /E /R:1 /W:1 /NFL /NDL /NJH /NJS >nul
robocopy "%TARGET%\frontend\src" "%CODE_BACKUP%\frontend\src" /E /R:1 /W:1 /NFL /NDL /NJH /NJS >nul
robocopy "%TARGET%\frontend\dist" "%CODE_BACKUP%\frontend\dist" /E /R:1 /W:1 /NFL /NDL /NJH /NJS >nul
mkdir "%CODE_BACKUP%\backend" >nul 2>&1
mkdir "%CODE_BACKUP%\frontend" >nul 2>&1
mkdir "%CODE_BACKUP%\scripts" >nul 2>&1
if exist "%TARGET%\backend\package.json" copy /Y "%TARGET%\backend\package.json" "%CODE_BACKUP%\backend\package.json" >nul
if exist "%TARGET%\backend\package-lock.json" copy /Y "%TARGET%\backend\package-lock.json" "%CODE_BACKUP%\backend\package-lock.json" >nul
if exist "%TARGET%\frontend\package.json" copy /Y "%TARGET%\frontend\package.json" "%CODE_BACKUP%\frontend\package.json" >nul
if exist "%TARGET%\frontend\package-lock.json" copy /Y "%TARGET%\frontend\package-lock.json" "%CODE_BACKUP%\frontend\package-lock.json" >nul
if exist "%TARGET%\frontend\index.html" copy /Y "%TARGET%\frontend\index.html" "%CODE_BACKUP%\frontend\index.html" >nul
for %%F in (setup_server_production.bat start_backend_only.bat verify_phase1_deployment.js verify_live_frontend.bat) do (
    if exist "%TARGET%\scripts\%%F" copy /Y "%TARGET%\scripts\%%F" "%CODE_BACKUP%\scripts\%%F" >nul
)
if defined SELF_OVERLAY goto :VERIFY_COPY

echo [2/5] Overlaying Phase 1 source files...
robocopy "%PATCH_DIR%\backend\src" "%TARGET%\backend\src" /E /R:2 /W:1 /NFL /NDL /NJH /NJS >nul
if errorlevel 8 goto :COPY_FAILED
robocopy "%PATCH_DIR%\frontend\src" "%TARGET%\frontend\src" /E /R:2 /W:1 /NFL /NDL /NJH /NJS >nul
if errorlevel 8 goto :COPY_FAILED
copy /Y "%PATCH_DIR%\frontend\index.html" "%TARGET%\frontend\index.html" >nul
copy /Y "%PATCH_DIR%\frontend\package.json" "%TARGET%\frontend\package.json" >nul
copy /Y "%PATCH_DIR%\frontend\package-lock.json" "%TARGET%\frontend\package-lock.json" >nul
copy /Y "%PATCH_DIR%\backend\package.json" "%TARGET%\backend\package.json" >nul
copy /Y "%PATCH_DIR%\backend\package-lock.json" "%TARGET%\backend\package-lock.json" >nul

echo [3/5] Replacing build folders exactly to remove stale or missing chunks...
robocopy "%PATCH_DIR%\backend\dist" "%TARGET%\backend\dist" /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS >nul
if errorlevel 8 goto :COPY_FAILED
robocopy "%PATCH_DIR%\frontend\dist" "%TARGET%\frontend\dist" /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS >nul
if errorlevel 8 goto :COPY_FAILED

echo [4/5] Updating deployment verification scripts...
copy /Y "%PATCH_DIR%\scripts\setup_server_production.bat" "%TARGET%\scripts\setup_server_production.bat" >nul
copy /Y "%PATCH_DIR%\scripts\start_backend_only.bat" "%TARGET%\scripts\start_backend_only.bat" >nul
copy /Y "%PATCH_DIR%\scripts\verify_phase1_deployment.js" "%TARGET%\scripts\verify_phase1_deployment.js" >nul
copy /Y "%PATCH_DIR%\scripts\verify_live_frontend.bat" "%TARGET%\scripts\verify_live_frontend.bat" >nul

:VERIFY_COPY
echo [5/5] Verifying copied source and every referenced frontend asset...
pushd "%TARGET%"
node scripts\verify_phase1_deployment.js
set "VERIFY_RESULT=%errorlevel%"
popd
if not "%VERIFY_RESULT%"=="0" goto :VERIFY_FAILED

color 0A
echo.
echo Recovery files were applied successfully.
echo Code backup: %CODE_BACKUP%
echo.
echo Now run from the REAL server project root:
echo   scripts\setup_server_production.bat
echo   scripts\start_backend_only.bat
echo Then open another console and run:
echo   scripts\verify_live_frontend.bat
echo.
pause
exit /b 0

:BAD_ROOT
color 0C
echo [ERROR] Invalid server project root: %TARGET%
echo It must contain backend, frontend, scripts and stellar.db.
pause
exit /b 1

:BAD_PATCH
color 0C
echo [ERROR] This recovery package is incomplete. Download or extract it again.
pause
exit /b 1

:COPY_FAILED
color 0C
echo [ERROR] File copy failed. Existing code backup: %CODE_BACKUP%
pause
exit /b 1

:VERIFY_FAILED
color 0C
echo [ERROR] Copied files are incomplete. Existing code backup: %CODE_BACKUP%
pause
exit /b 1
