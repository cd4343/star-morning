# 生产部署说明

Star Coin 当前采用 Windows Nginx（80 端口）提供前端与 API 代理，Node.js 后端监听 3001 端口。生产数据库始终使用服务器已有的 `stellar.db`，更新包不得携带或覆盖该文件。

## 首次部署

1. 将完整项目复制到服务器项目根目录。
2. 运行 `scripts\setup_server_production.bat`，完成环境配置、依赖安装、构建和数据库检查。
3. 按 `scripts\nginx\README.md` 配置 Nginx，确认 `root` 指向当前项目的 `frontend/dist`。
4. 运行 `scripts\start_backend_only.bat`，再运行 `scripts\verify_live_frontend.bat`。

`scripts/production_env.local.bat` 包含服务器密钥与路径，只保留在服务器，不上传 GitHub 或更新包。

## 后续安全更新

上传并覆盖最新的累积增量包后，以管理员身份运行：

```bat
scripts\deploy_server_production.bat
```

该脚本会按顺序执行：

1. 检查生产配置、Node.js、npm 和必要源码。
2. 在 `.tmp/` 隔离目录安装、构建并验证前后端，不触碰当前运行产物。
3. 停止 3001 端口旧后端。
4. 将数据库及当前 `backend/dist`、`frontend/dist` 备份到 `backups/releases/<时间戳>/`。
5. 发布新后端；前端先复制带哈希资源，最后替换 `index.html`，降低资源版本不一致造成的白屏风险。
6. 执行幂等数据库迁移、`integrity_check` 和外键检查。
7. 启动后端，并验证后端健康接口、构建资源和 Nginx 实际服务目录。

任何发布后检查失败，脚本会自动恢复上一个前后端构建并重启旧后端。数据库备份只用于人工灾难恢复，脚本不会自动覆盖真实数据库。

## 无破坏预检

在本地或服务器上只验证部署脚本、构建与产物完整性，不停止服务、不读取或修改数据库：

```bat
scripts\deploy_server_production.bat -ValidateOnly -SkipInstall
```

只有依赖已经安装时才能使用 `-SkipInstall`。正式部署默认不应跳过依赖安装和 Nginx 检查。

## 验收与回滚

部署成功后至少验证：

- 家长端、孩子端均可登录，刷新深层页面不会白屏。
- “今天”、任务提交与审核、金币结算、商店、抽奖记录正常。
- `http://127.0.0.1/api/health` 返回 `status: ok`。
- 浏览器加载的入口资源名称与 `frontend/dist/index.html` 一致。

若自动回滚也失败，控制台会明确输出错误。此时不要替换 `stellar.db`；先查看 `logs/backend-*.error.log`，再从本次 `backups/releases/<时间戳>/` 恢复运行产物。数据库恢复必须在确认后端已停止后人工执行。

## Nginx 缓存规则

- `/assets/` 是带内容哈希的构建资源，可长期缓存并标记 `immutable`。
- `/index.html` 必须使用 `no-store, no-cache, must-revalidate`。
- Nginx `root` 必须指向当前项目的 `frontend/dist`，否则线上可能继续展示旧版本。
