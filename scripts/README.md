# Scripts 目录说明

本目录包含项目的各种脚本工具。

## 启动脚本

| 脚本 | 用途 |
|------|------|
| `start_app.bat` | 智能启动器，可选择开发或生产环境 |
| `start_app_local.bat` | 本地开发环境启动（端口 3000/3001） |
| `start_app_production.bat` | 生产环境启动（端口 80） |
| `start_dev.ps1` | PowerShell 版本开发启动器 |

### 启动脚本使用方法

直接双击 `scripts/start_app.bat` 即可，脚本会自动切换到项目根目录。

```bash
# 或者在命令行中运行
cd "项目根目录/scripts"
start_app.bat
```

## 配置脚本

| 脚本 | 用途 |
|------|------|
| `setup_hosts.bat` | 配置本地 hosts 文件（需要管理员权限） |
| `server.py` | Python HTTP 代理服务器（生产环境使用） |

## 数据库工具 (db-tools/)

| 脚本 | 用途 |
|------|------|
| `fix-auto-approved.js` | 修复被错误自动审批的任务 |
| `fix-db.js` | 修复 user_inventory 表结构 |

### 数据库工具使用方法

这些脚本会自动找到项目根目录的 `stellar.db` 数据库文件，可以在任意位置运行：

```bash
# 方法1：在 scripts/db-tools 目录下运行
cd scripts/db-tools
node fix-auto-approved.js

# 方法2：使用完整路径
node scripts/db-tools/fix-auto-approved.js
```

## 注意事项

- 所有 `.bat` 脚本需要在 Windows 环境下运行
- `server.py` 需要 Python 3.x
- 数据库工具脚本需要 Node.js 和 `sqlite3` 模块
- **重要**: 脚本会自动切换到项目根目录，无需手动 cd
