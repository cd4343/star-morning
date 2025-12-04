@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo Starting Local Server
echo Domain: http://starcoin.h5-online.com/
echo Port: 80
echo ========================================
echo.

REM Check Python
echo [1/3] Checking Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found!
    echo Please install Python: https://www.python.org/downloads/
    pause
    exit /b 1
)

for /f "tokens=2" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
echo [OK] Python version: !PYTHON_VERSION!
echo.

REM Kill processes on port 80 and 8000
echo [1.5/3] Checking and closing previous processes...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":80 " ^| findstr "LISTENING" 2^>nul') do (
    if not "%%a"=="" (
        echo [Found] Closing process on port 80, PID: %%a
        taskkill /F /PID %%a >nul 2>&1
    )
)

for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8000 " ^| findstr "LISTENING" 2^>nul') do (
    if not "%%a"=="" (
        echo [Found] Closing process on port 8000, PID: %%a
        taskkill /F /PID %%a >nul 2>&1
    )
)

timeout /t 1 /nobreak >nul
echo [Done] Process check completed
echo.

REM Check server.py
echo [2/3] Checking server files...
if not exist "server.py" (
    echo [ERROR] server.py not found!
    pause
    exit /b 1
)
echo [OK] server.py found
echo.

REM Check index.html
if not exist "index.html" (
    echo [WARN] index.html not found, creating default...
    (
        echo ^<!DOCTYPE html^>
        echo ^<html^>
        echo ^<head^>
        echo     ^<meta charset="UTF-8"^>
        echo     ^<title^>Test Page^</title^>
        echo ^</head^>
        echo ^<body^>
        echo     ^<h1^>Welcome to starcoin.h5-online.com^</h1^>
        echo     ^<p^>Server is running!^</p^>
        echo ^</body^>
        echo ^</html^>
    ) > index.html
    echo [OK] Default index.html created
)
echo.

REM Start server
echo [3/3] Starting server...
echo.
echo ========================================
echo Server started!
echo Access: http://starcoin.h5-online.com/
echo Or: http://localhost/
echo.
echo Press Ctrl+C to stop server
echo ========================================
echo.

python server.py

pause
