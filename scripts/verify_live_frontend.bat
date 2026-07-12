@echo off
setlocal
cd /d "%~dp0.."
chcp 65001 >nul 2>&1
echo [INFO] Verifying files under: %CD%
node scripts\verify_phase1_deployment.js --live
if errorlevel 1 (
    echo.
    echo [ERROR] The live site is not serving this project directory completely.
    echo [HINT] Check the Nginx root. It must point to: %CD:\=/%/frontend/dist
    pause
    exit /b 1
)
echo.
echo [OK] Live frontend, lazy page chunks, and backend health all match.
pause
exit /b 0
