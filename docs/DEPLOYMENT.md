# 生产部署说明

Star Coin 当前采用 Windows Nginx（80 端口）提供前端与 API 代理，Node.js 后端监听 3001 端口。生产数据库始终使用服务器已有的 `stellar.db`，更新包不得携带或覆盖该文件。

## 首次部署

1. 将完整项目复制到服务器项目根目录。
2. 运行 `scripts\setup_server_production.bat`，完成环境配置、依赖安装、构建和数据库检查。
3. 按 `scripts\nginx\README.md` 配置 Nginx，确认 `root` 指向当前项目的 `frontend/dist`。
4. 运行 `scripts\start_backend_only.bat`，再运行 `scripts\verify_live_frontend.bat`。

`scripts/production_env.local.bat` 包含服务器密钥与路径，只保留在服务器，不上传 GitHub 或更新包。

### 阿里云短信注册

个人认证内测使用号码认证服务（PNVS）的短信验证码能力。首次运行
`scripts\setup_server_production.bat` 时：

1. `SMS provider` 选择 `aliyun-pnvs`（直接回车也是此默认值）。
2. 输入具有号码认证服务权限的 AccessKey ID 和 AccessKey Secret。
3. 签名使用已审核通过的 `恒创联众`，模板使用 `100001`。

脚本会把以下配置写入被 Git 忽略的 `scripts\production_env.local.bat`：

```bat
set "SMS_PROVIDER=aliyun-pnvs"
set "ALIBABA_CLOUD_ACCESS_KEY_ID=服务器上的AccessKey ID"
set "ALIBABA_CLOUD_ACCESS_KEY_SECRET=服务器上的AccessKey Secret"
set "ALIYUN_PNVS_SIGN_NAME=恒创联众"
set "ALIYUN_PNVS_TEMPLATE_CODE=100001"
```

不要把该文件截图、打包或提交到 GitHub。部署完成后使用 1—2 个真实手机号分别验证
“获取验证码 → 注册”和“获取验证码 → 登录”；只有阿里云返回 `PASS` 才会通过校验。

### 100 人内测容量自检

发布前可在项目根目录运行：

```bat
node scripts\verify_phase14_capacity.mjs
```

脚本固定使用模拟短信和 `.tmp\phase14-capacity\stellar-capacity.db`，创建 100 个隔离测试账号，
持续执行 5 分钟混合读写，并检查错误率、P95 延迟、`SQLITE_BUSY`、数据库完整性与外键。
它不会读取或覆盖生产 `stellar.db`，也不会发送真实短信。

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
