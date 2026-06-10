@echo off
REM 本地开发启动后端（B2-4 之后：未设置 JWT_SECRET 时必须声明开发环境，否则拒绝启动）
set NODE_ENV=development
cd /d %~dp0..\backend
npm run dev
