# v1.0.1 线上升级说明

发布日期：2026-05-13

## 升级影响

- 需要重启后端服务，前端需要重新构建并发布 `frontend/dist`。
- 启动后端时会自动执行一次兼容迁移，扩展 `user_inventory.status` 允许的状态值；该迁移保留现有库存数据。
- 已登录用户的旧 JWT 仍可继续使用，除非服务器同时更换了 `JWT_SECRET`。
- 前端会清除浏览器中旧的明文 `last_password`，用户之后需要手动输入密码登录。
- 如果家长账号没有设置 PIN，孩子端切换到家长端会被拒绝；如需临时保留旧行为，可在后端环境变量中设置 `ALLOW_DEFAULT_PARENT_PIN=true`，但建议上线后尽快让家长设置 PIN。

## 建议上线步骤

1. 备份服务器上的 `stellar.db`、`stellar.db-wal`、`stellar.db-shm`。
2. 停止后端服务，发布 `backend` 代码，执行 `npm install` 和 `npm run build`。
3. 设置生产环境变量：
   - `JWT_SECRET`：强随机字符串。
   - `CORS_ORIGIN`：线上域名，例如 `https://starcoin.h5-online.com`。
   - `ALLOW_DEFAULT_PARENT_PIN`：默认不要设置；只在临时兼容旧流程时设为 `true`。
4. 启动后端，确认 `/api/health` 返回 `ok`。
5. 发布前端：进入 `frontend` 执行 `npm install && npm run build`，替换线上静态目录。
6. 验证登录、切换孩子、提交任务、家长审核、兑换/抽奖、库存转赠。

## 回滚说明

- 代码可回滚到上一版本。
- 本版本数据库迁移只扩展库存状态约束，正常情况下不需要回滚数据库。
- 若必须完全回滚数据库，请使用升级前备份的 `stellar.db` 以及对应 WAL/SHM 文件。
