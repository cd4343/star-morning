@echo off
REM ========================================
REM 浏览器连接问题诊断和修复工具
REM ========================================
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion
cd /d "%~dp0"

color 0B
title 浏览器连接诊断工具

echo ========================================
echo 浏览器连接问题诊断工具
echo ========================================
echo.

REM 1. Check service status
echo [1/5] Checking service status...
netstat -ano | findstr ":3000" | findstr "LISTEN" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Frontend service running on port 3000
) else (
    echo [ERROR] Frontend service not running!
    echo Please run START.bat first
    pause
    exit /b 1
)

netstat -ano | findstr ":3001" | findstr "LISTEN" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Backend service running on port 3001
) else (
    echo [WARN] Backend service not running
)
echo.

REM 2. 测试连接
echo [2/5] 测试网络连接...
powershell -Command "Test-NetConnection -ComputerName localhost -Port 3000 -InformationLevel Quiet" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] localhost:3000 连接正常
) else (
    echo [ERROR] localhost:3000 连接失败
)
echo.

REM 3. 检查 hosts 文件
echo [3/5] 检查 hosts 文件...
findstr /C:"127.0.0.1" /C:"localhost" %WINDIR%\System32\drivers\etc\hosts >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] hosts 文件包含 localhost 配置
) else (
    echo [WARN] hosts 文件可能缺少 localhost 配置
    echo 建议检查: %WINDIR%\System32\drivers\etc\hosts
)
echo.

REM 4. 提供解决方案
echo [4/5] 解决方案建议...
echo.
echo ========================================
echo 如果浏览器无法访问，请尝试以下方法：
echo ========================================
echo.
echo 方法1: 使用 127.0.0.1 代替 localhost
echo   在浏览器输入: http://127.0.0.1:3000
echo.
echo 方法2: 检查浏览器代理设置
echo   Chrome: 设置 ^> 高级 ^> 系统 ^> 打开代理设置
echo   确保"使用代理服务器"未勾选
echo.
echo 方法3: 关闭 VPN/代理软件
echo   某些 VPN 会阻止 localhost 访问
echo.
echo 方法4: 使用无痕模式
echo   Chrome: Ctrl+Shift+N
echo   Edge: Ctrl+Shift+N
echo.
echo 方法5: 检查防火墙
echo   确保 Windows 防火墙未阻止浏览器
echo.
echo ========================================
echo.

REM 5. 尝试打开浏览器
echo [5/5] 尝试打开浏览器...
echo.
set /p "open=是否尝试打开浏览器? (Y/N): "
if /i "!open!"=="Y" (
    echo.
    echo 正在尝试打开 http://127.0.0.1:3000 ...
    start http://127.0.0.1:3000
    timeout /t 2 >nul
    echo.
    echo 正在尝试打开 http://localhost:3000 ...
    start http://localhost:3000
    echo.
    echo [INFO] 如果浏览器打开但显示错误，请检查：
    echo   1. 浏览器控制台 (F12) 的错误信息
    echo   2. 网络标签页中的请求状态
    echo   3. 是否有 CORS 或代理错误
)
echo.
echo ========================================
echo 诊断完成
echo ========================================
echo.
pause

