# Scripts

保留的脚本都围绕“本地打包、服务器设置、服务器启动”三件事：

| 脚本 | 用途 |
| --- | --- |
| `prepare_server_package.bat` | 本机生成可上传服务器的干净 `starcoin` 文件夹 |
| `prepare_server_package.ps1` | 打包脚本的实际 PowerShell 实现 |
| `setup_server_production.bat` | 服务器首次部署/升级后运行，安装依赖、构建并检查数据库 |
| `start_server_simple.bat` | 服务器生产启动脚本 |
| `server.py` | 前端静态服务和 `/api` 代理 |

推荐流程：

1. 本机运行 `scripts\prepare_server_package.bat`。
2. 把生成的 `starcoin` 文件夹整体复制到服务器。
3. 服务器运行 `scripts\setup_server_production.bat`。
4. 服务器运行 `scripts\start_server_simple.bat`。
