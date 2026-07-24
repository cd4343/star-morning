# StarHope Welcome and SMS Beta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将对外品牌更新为“星希望”，增加一次性移动欢迎页，接入阿里云真实短信注册/登录，并以隔离数据库验证约 100 名内测用户的容量。

**Architecture:** 保留现有认证 API、React 路由与 SQLite 数据模型。新增一个小型短信提供方模块封装阿里云 PNVS，`server.ts` 只负责业务校验和审计；欢迎页作为懒加载路由接入现有 `SmartEntry`。容量检查使用 Node 内置 `fetch` 和临时数据库，不请求真实短信。

**Tech Stack:** React 18、React Router、TypeScript、Vite、Tailwind CSS、Express、SQLite WAL、Vitest、Playwright、阿里云 PNVS Node.js SDK

---

## 文件结构

**新增**

- `backend/src/smsProvider.ts`：统一现有 mock/http 与阿里云 PNVS 的发送、核验和配置校验。
- `backend/src/smsProvider.test.ts`：不访问公网的提供方参数、成功和失败测试。
- `frontend/src/pages/auth/Welcome.tsx`：首次未登录访问的移动欢迎页。
- `frontend/tests/smoke/phase14-welcome-sms.spec.ts`：首次展示、再次分流、移动布局和认证页面 smoke。
- `scripts/verify_phase14_capacity.mjs`：只针对隔离后端实例运行的 100 用户容量验证。

**修改**

- `backend/package.json`、`backend/package-lock.json`：加入官方 PNVS SDK。
- `backend/src/database.ts`：为短信审计幂等追加 `provider`、`providerBizId` 字段。
- `backend/src/server.ts`：接入提供方、专用发送限流、小时/每日限额和云端核验。
- `backend/src/database.migrations.test.ts`：验证重复迁移与旧数据兼容。
- `frontend/src/App.tsx`：首次欢迎与现有智能分流。
- `frontend/src/i18n/locales/zh-CN.ts`：新增欢迎、品牌和短信文案 key。
- `frontend/src/pages/auth/Login.tsx`、`frontend/src/pages/auth/Register.tsx`、`frontend/src/components/IntroModal.tsx`：更新用户可见品牌，保留原流程。
- `frontend/index.html`、`frontend/public/manifest.json`：浏览器与 PWA 展示名更新。
- `frontend/public/assets/starhope-welcome.webp`：由用户提供图片生成的生产资源。
- `scripts/setup_server_production.bat`：安全写入阿里云配置且不覆盖已有密钥。
- `scripts/deploy_server_production.ps1`：生产配置完整性预检。
- `scripts/README.md`：部署和真实短信验证步骤。

## Task 1：建立阿里云短信提供方

**Files:**
- Create: `backend/src/smsProvider.ts`
- Create: `backend/src/smsProvider.test.ts`
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`

- [ ] **Step 1: 安装唯一需要的新依赖**

Run:

```powershell
Set-Location backend
npm install @alicloud/dypnsapi20170525@2.0.0
```

Expected: `package.json` 和 lockfile 只增加官方 SDK 及其传递依赖，`npm audit --omit=dev` 不出现 high/critical。

- [ ] **Step 2: 写失败测试，锁定云端生成与云端核验**

测试通过注入客户端工厂，断言发送参数包含系统占位符、6 位数字、300 秒有效期、60 秒间隔和覆盖旧码；核验只接受 `PASS`。

```ts
it('lets PNVS generate a six-digit code and rejects non-PASS verification', async () => {
  const calls: any[] = [];
  const provider = createSmsProvider({
    env: aliyunEnv,
    createAliyunClient: () => ({
      sendSmsVerifyCode: async (request: unknown) => {
        calls.push(request);
        return { body: { model: { code: 'OK', bizId: 'biz-1' } } };
      },
      checkSmsVerifyCode: async () => ({
        body: { model: { verifyResult: 'FAIL' } },
      }),
    }),
  });

  await expect(provider.send('13800138000', 'register', 'out-1'))
    .resolves.toMatchObject({ provider: 'aliyun-pnvs', bizId: 'biz-1' });
  expect(calls[0]).toMatchObject({
    codeLength: 6,
    validTime: 300,
    interval: 60,
    duplicatePolicy: 1,
    templateParam: JSON.stringify({ code: '##code##', min: '5' }),
  });
  await expect(provider.verify('13800138000', '123456')).resolves.toBe(false);
});
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```powershell
Set-Location backend
npx vitest run src/smsProvider.test.ts
```

Expected: FAIL，原因是 `smsProvider.ts` 尚不存在。

- [ ] **Step 4: 实现最小提供方模块**

公开接口固定为：

```ts
export type SmsPurpose = 'login' | 'register' | 'reset-password';
export type SmsSendResult = {
  provider: 'mock' | 'http' | 'aliyun-pnvs';
  bizId?: string;
  devCode?: string;
  localCode?: string;
};

export type SmsProvider = {
  name: SmsSendResult['provider'];
  send(phone: string, purpose: SmsPurpose, outId: string): Promise<SmsSendResult>;
  verify(phone: string, code: string): Promise<boolean | null>;
};

export const createSmsProvider = (deps: SmsProviderDeps = defaultDeps): SmsProvider => {
  const name = String(deps.env.SMS_PROVIDER || '').toLowerCase();
  if (name === 'aliyun-pnvs') return createAliyunProvider(deps);
  if (name === 'http') return createHttpProvider(deps);
  if (name === 'mock' && deps.env.NODE_ENV !== 'production') return createMockProvider(deps);
  throw Object.assign(new Error('SMS provider is not configured'), {
    code: 'SMS_PROVIDER_NOT_CONFIGURED',
  });
};
```

阿里云客户端只读取环境变量，endpoint 固定为 `dypnsapi.aliyuncs.com`；日志只允许出现掩码手机号、purpose、outId 和阿里云错误码。

- [ ] **Step 5: 运行提供方测试、构建和安全检查**

Run:

```powershell
npx vitest run src/smsProvider.test.ts
npm run build
npm audit --omit=dev
```

Expected: 测试与构建通过；无 high/critical。

- [ ] **Step 6: 提交**

```powershell
git add backend/package.json backend/package-lock.json backend/src/smsProvider.ts backend/src/smsProvider.test.ts
git commit -m "P14-1: add Aliyun PNVS SMS provider"
```

## Task 2：迁移短信审计并接入认证路由

**Files:**
- Modify: `backend/src/database.ts`
- Modify: `backend/src/database.migrations.test.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/src/smsProvider.test.ts`

- [ ] **Step 1: 写迁移失败测试**

```ts
it('adds provider audit columns without losing legacy SMS rows', async () => {
  await db.run(
    `INSERT INTO auth_sms_codes
      (id, phone, purpose, codeHash, attempts, expiresAt)
     VALUES ('legacy', '13800138000', 'register', 'hash', 0, '2099-01-01')`
  );
  await initializeDatabase();
  const columns = await db.all(`PRAGMA table_info(auth_sms_codes)`);
  expect(columns.map(column => column.name)).toEqual(
    expect.arrayContaining(['provider', 'providerBizId'])
  );
  expect(await db.get(`SELECT id FROM auth_sms_codes WHERE id = 'legacy'`))
    .toEqual({ id: 'legacy' });
});
```

- [ ] **Step 2: 运行迁移测试确认失败**

Run:

```powershell
Set-Location backend
npx vitest run src/database.migrations.test.ts
```

Expected: FAIL，缺少 `provider` 或 `providerBizId`。

- [ ] **Step 3: 增加幂等追加迁移**

复用项目现有安全加列模式：

```ts
for (const sql of [
  `ALTER TABLE auth_sms_codes ADD COLUMN provider TEXT NOT NULL DEFAULT 'local'`,
  `ALTER TABLE auth_sms_codes ADD COLUMN providerBizId TEXT`,
]) {
  try { await db.run(sql); } catch (error: any) {
    if (!String(error?.message).includes('duplicate column name')) throw error;
  }
}
```

不得删除、重建或复制 `auth_sms_codes`。

- [ ] **Step 4: 为发送接口增加独立 IP 限流**

把 `/api/auth/sms/send` 从当前 15 分钟通用 `authLimiter` 列表移除，并仅为该路由增加：

```ts
const smsSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: '验证码发送过于频繁，请稍后再试' },
});
```

路由声明为：

```ts
app.post('/api/auth/sms/send', smsSendLimiter, async (req, res) => {
  // existing phone/purpose checks remain
});
```

- [ ] **Step 5: 增加手机号小时/每日限额并在发送成功后写审计**

```ts
const recentCounts = await db.get(
  `SELECT
     SUM(CASE WHEN datetime(createdAt) >= datetime('now', '-1 hour') THEN 1 ELSE 0 END) AS hourly,
     SUM(CASE WHEN datetime(createdAt) >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS daily
   FROM auth_sms_codes
   WHERE phone = ?`,
  phone
);
if (Number(recentCounts?.hourly || 0) >= 5 || Number(recentCounts?.daily || 0) >= 10) {
  return res.status(429).json({ message: '该手机号获取验证码过于频繁，请稍后再试' });
}
```

发送顺序固定为：校验 → 频控 → 调用提供方 → 关闭旧记录 → 写入成功审计 → 返回成功。阿里云记录的 `codeHash` 写空字符串，`provider='aliyun-pnvs'`；mock/http 继续保存 bcrypt hash。

- [ ] **Step 6: 核验时按审计记录选择云端或本地方式**

```ts
const matched = record.provider === 'aliyun-pnvs'
  ? await smsProvider.verify(phone, code)
  : await bcrypt.compare(code, record.codeHash);

if (matched !== true) {
  // preserve current attempt increment and fifth-attempt consumption
}
```

云端异常返回 503，不把网络故障计作错误验证码；并发成功校验必须通过条件更新消费：

```sql
UPDATE auth_sms_codes
SET consumedAt = ?
WHERE id = ? AND consumedAt IS NULL
```

若 `changes !== 1`，返回“验证码已使用，请重新获取”。

- [ ] **Step 7: 增加路由级回归并运行后端全集**

覆盖：配置缺失 503、发送失败不写审计、小时/每日限额、非 PASS 不登录、第五次失败失效、同一码并发消费仅一次、生产无 `devCode`。

Run:

```powershell
Set-Location backend
npm test
npm run build
```

Expected: 全部测试通过且 TypeScript 零错误。

- [ ] **Step 8: 提交**

```powershell
git add backend/src/database.ts backend/src/database.migrations.test.ts backend/src/server.ts backend/src/smsProvider.test.ts
git commit -m "P14-2: secure SMS registration and audit"
```

## Task 3：增加“星希望”首次欢迎页

**Files:**
- Create: `frontend/src/pages/auth/Welcome.tsx`
- Create: `frontend/public/assets/starhope-welcome.webp`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/i18n/locales/zh-CN.ts`
- Test: `frontend/tests/smoke/phase14-welcome-sms.spec.ts`

- [ ] **Step 1: 生成移动端 WebP**

使用现有可用图像工具把用户提供的 PNG 转为 WebP，保持竖版构图，宽度 1080px，质量从 82 开始并调整到小于 500KB。不得写入 EXIF 或聊天临时路径。

Expected:

```text
frontend/public/assets/starhope-welcome.webp
size <= 512000 bytes
```

- [ ] **Step 2: 写欢迎页 smoke 测试并确认失败**

```ts
test('first visit shows welcome and later visits use smart entry', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '星希望' })).toBeVisible();
  await page.getByRole('button', { name: '开始使用' }).click();
  await expect(page).toHaveURL(/\/register$/);
  expect(await page.evaluate(() => localStorage.getItem('starhope_welcome_seen')))
    .toBe('1');

  await page.goto('/');
  await expect(page).toHaveURL(/\/register$/);
});
```

另加 375×812 viewport，断言两个按钮可见、最小高度 44px、无水平溢出；预置 JWT 时访问 `/` 应进入 `/select-user`。

Run:

```powershell
Set-Location frontend
npx playwright test tests/smoke/phase14-welcome-sms.spec.ts
```

Expected: FAIL，根路径仍直接跳注册或登录。

- [ ] **Step 3: 增加 i18n key**

```ts
'brand.name': '星希望',
'brand.subtitle': '陪孩子把每一步变成看得见的成长',
'welcome.start': '开始使用',
'welcome.login': '已有账号，直接登录',
'welcome.imageAlt': '家长和孩子沿着星光成长道路前行',
```

- [ ] **Step 4: 实现欢迎页**

```tsx
const markSeenAndGo = (path: '/register' | '/login') => {
  localStorage.setItem('starhope_welcome_seen', '1');
  navigate(path);
};
```

页面结构只包含背景图、渐变遮罩、标题、短说明和两个按钮；图片 `onError` 后隐藏但保留可操作内容。根容器使用 `min-h-[100dvh]`，底部 padding 包含 `env(safe-area-inset-bottom)`。

- [ ] **Step 5: 修改 SmartEntry**

```tsx
const welcomeSeen = localStorage.getItem('starhope_welcome_seen') === '1';
if (isAuthenticated) return <Navigate to="/select-user" replace />;
if (!welcomeSeen) return <Welcome />;
return <Navigate to={lastPhone ? '/login' : '/register'} replace />;
```

`Welcome` 使用现有 lazy/Suspense 模式，不改变 `/login` 和 `/register`。

- [ ] **Step 6: 运行前端定向验证**

Run:

```powershell
npx playwright test tests/smoke/phase14-welcome-sms.spec.ts
npm run build
```

Expected: smoke 与构建通过。

- [ ] **Step 7: 提交**

```powershell
git add frontend/src/pages/auth/Welcome.tsx frontend/public/assets/starhope-welcome.webp frontend/src/App.tsx frontend/src/i18n/locales/zh-CN.ts frontend/tests/smoke/phase14-welcome-sms.spec.ts
git commit -m "P14-3: add first-visit StarHope welcome"
```

## Task 4：统一主要用户可见品牌

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/public/manifest.json`
- Modify: `frontend/src/pages/auth/Login.tsx`
- Modify: `frontend/src/pages/auth/Register.tsx`
- Modify: `frontend/src/components/IntroModal.tsx`
- Modify: `frontend/src/i18n/locales/zh-CN.ts`
- Test: `frontend/tests/smoke/phase14-welcome-sms.spec.ts`

- [ ] **Step 1: 扩展 smoke 测试**

登录、注册、介绍弹窗、HTML 标题和 manifest 必须显示“星希望”；技术路径、API 和域名不参与断言。

```ts
await page.goto('/login');
await expect(page.getByText('星希望').first()).toBeVisible();
await expect(page).toHaveTitle(/星希望/);
```

- [ ] **Step 2: 运行确认旧品牌导致失败**

Run:

```powershell
npx playwright test tests/smoke/phase14-welcome-sms.spec.ts
```

Expected: FAIL，仍发现“星辰早晨”。

- [ ] **Step 3: 仅替换主要用户可见品牌并使用 i18n**

组件使用 `t('brand.name')`；HTML 和 manifest 使用静态“星希望”。不得全局替换 `starcoin`、`Star Coin`、历史文档和部署标识。

- [ ] **Step 4: 搜索残留并人工分类**

Run:

```powershell
rg -n "星辰早晨|欢迎使用星辰" frontend/src frontend/index.html frontend/public/manifest.json
```

Expected: 主要用户界面零残留；若测试夹具或兼容说明保留，逐条记录原因。

- [ ] **Step 5: 运行测试并提交**

```powershell
npx playwright test tests/smoke/phase14-welcome-sms.spec.ts
npm run build
git add frontend/index.html frontend/public/manifest.json frontend/src/pages/auth/Login.tsx frontend/src/pages/auth/Register.tsx frontend/src/components/IntroModal.tsx frontend/src/i18n/locales/zh-CN.ts frontend/tests/smoke/phase14-welcome-sms.spec.ts
git commit -m "P14-4: rename public brand to StarHope"
```

## Task 5：安全配置生产短信

**Files:**
- Modify: `scripts/setup_server_production.bat`
- Modify: `scripts/deploy_server_production.ps1`
- Modify: `scripts/README.md`

- [ ] **Step 1: 扩展配置向导**

允许 `SMS_PROVIDER=aliyun-pnvs`，并仅在该值下提示输入 AK、SK、签名和模板。已有 `production_env.local.bat` 时先读取现有值；空输入代表保留旧值，禁止回显 Secret。

写入逻辑使用向导中已经读取的批处理变量：

```bat
echo set "SMS_PROVIDER=%SMS_PROVIDER%"
echo set "ALIBABA_CLOUD_ACCESS_KEY_ID=%ALIYUN_ACCESS_KEY_ID%"
echo set "ALIBABA_CLOUD_ACCESS_KEY_SECRET=%ALIYUN_ACCESS_KEY_SECRET%"
echo set "ALIYUN_PNVS_SIGN_NAME=%ALIYUN_PNVS_SIGN_NAME%"
echo set "ALIYUN_PNVS_TEMPLATE_CODE=%ALIYUN_PNVS_TEMPLATE_CODE%"
```

- [ ] **Step 2: 增加部署前配置校验**

```powershell
if ($env:SMS_PROVIDER -eq 'aliyun-pnvs') {
  foreach ($name in @(
    'ALIBABA_CLOUD_ACCESS_KEY_ID',
    'ALIBABA_CLOUD_ACCESS_KEY_SECRET',
    'ALIYUN_PNVS_SIGN_NAME',
    'ALIYUN_PNVS_TEMPLATE_CODE'
  )) {
    if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
      throw "Required Aliyun SMS setting is missing: $name"
    }
  }
}
```

- [ ] **Step 3: 验证脚本不泄密**

Run:

```powershell
rg -n "ACCESS_KEY_SECRET|ACCESS_KEY_ID" backend/src frontend/src scripts
git diff --check
```

Expected: 只出现环境变量名称和文档占位，不出现真实值。

- [ ] **Step 4: 更新部署说明并提交**

说明 RAM 最小权限、服务器配置、受控真实号码测试、失败排查和回滚；明确普通重启仍使用 `start_backend_only.bat`。

```powershell
git add scripts/setup_server_production.bat scripts/deploy_server_production.ps1 scripts/README.md
git commit -m "P14-5: validate production SMS configuration"
```

## Task 6：验证 100 人内测容量

**Files:**
- Create: `scripts/verify_phase14_capacity.mjs`
- Modify: `scripts/README.md`

- [ ] **Step 1: 实现隔离容量脚本**

脚本必须拒绝生产数据库：

```js
const dbPath = process.env.STARCOIN_DB_PATH || '';
if (!dbPath || /stellar\.db$/i.test(dbPath)) {
  throw new Error('Capacity test requires a disposable STARCOIN_DB_PATH');
}
if (process.env.SMS_PROVIDER !== 'mock') {
  throw new Error('Capacity test requires SMS_PROVIDER=mock');
}
```

使用内置 `fetch`：

1. 为 100 个测试手机号依次请求 mock 验证码并注册；
2. 每个账号使用独立的 `X-Forwarded-For` 测试地址，并保存 token；
3. 调用 `/api/auth/create-family` 建立最小家庭；
4. 20 个 worker 持续 5 分钟混合调用 `/api/health`、`/api/auth/members`、`GET /api/parent/tasks`，并向临时数据库执行少量 `POST /api/parent/tasks`；
5. 记录总数、状态码、p50、p95、最大值；
6. 失败退出码为 1。

测试任务写入使用固定最小载荷，并且只存在于临时数据库：

```js
{
  title: `容量测试任务 ${sequence}`,
  coinReward: 1,
  xpReward: 0,
  durationMinutes: 5,
  category: '生活',
  icon: 'check',
  taskType: 'daily',
  isParallel: false
}
```

- [ ] **Step 2: 在临时数据库和独立端口启动后端**

```powershell
$root = (Resolve-Path '.').Path
$capacityDir = Join-Path $root '.tmp\phase14-capacity'
New-Item -ItemType Directory -Force -Path $capacityDir | Out-Null
$env:NODE_ENV='test'
$env:PORT='3101'
$env:SMS_PROVIDER='mock'
$env:SMS_EXPOSE_DEV_CODE='true'
$env:TRUST_PROXY='1'
$env:STARCOIN_DB_PATH=(Join-Path $capacityDir 'capacity.db')
$env:JWT_SECRET='phase14-capacity-test-only-secret'
Set-Location backend
npm run build
node dist/server.js
```

Expected: 后端仅使用 `%TEMP%` 下数据库，不连接生产文件。

- [ ] **Step 3: 运行容量测试**

Run in a second terminal:

```powershell
$root = (Resolve-Path '.').Path
$env:BASE_URL='http://127.0.0.1:3101'
$env:STARCOIN_DB_PATH=(Join-Path $root '.tmp\phase14-capacity\capacity.db')
$env:SMS_PROVIDER='mock'
node scripts/verify_phase14_capacity.mjs
```

Expected:

```text
accounts=100
concurrency=20
5xx=0
SQLITE_BUSY=0
read_p95_ms<500
write_p95_ms<800
integrity_check=ok
```

- [ ] **Step 4: 提交**

```powershell
git add scripts/verify_phase14_capacity.mjs scripts/README.md
git commit -m "P14-6: add isolated beta capacity verification"
```

## Task 7：全量回归、真实短信验收与累计包

**Files:**
- Modify: `docs/CHANGELOG.md`
- Create: `临时/starcoin-incremental-patch-YYYYMMDD-HHMMSS-P14星希望欢迎页与短信内测累计-code-only/`
- Modify: `临时/LATEST_PATCH_PATH.txt`

- [ ] **Step 1: 运行全量自动验证**

```powershell
Set-Location backend
npm test
npm run build

Set-Location ../frontend
npm run build
npm run test:smoke
npm run test:production

Set-Location ..
powershell -ExecutionPolicy Bypass -File scripts/deploy_server_production.ps1 -ValidateOnly -SkipInstall
```

Expected: 无跳过、无构建错误、无白屏；记录实际测试数量。

- [ ] **Step 2: 检查资源和秘密**

```powershell
Get-Item frontend/public/assets/starhope-welcome.webp | Select-Object Length
rg -n "ALIBABA_CLOUD_ACCESS_KEY_SECRET=.+" backend frontend scripts docs
git diff --check
git status --short
```

Expected: 图片不超过 500KB；无真实密钥；仅本阶段文件发生预期修改。

- [ ] **Step 3: 受控真实短信验收**

在服务器配置 RAM 密钥后，仅使用已获授权的测试手机号：

1. 请求注册验证码并收到短信；
2. 完成一次新注册；
3. 退出后完成一次短信登录；
4. 确认生产响应不含 `devCode`；
5. 控制台发送记录显示成功。

不得在自动容量测试中调用真实短信。

- [ ] **Step 4: 生成最新累计 code-only 包**

以最新已验证 P13 累计包为基线，叠加 P14 本阶段文件；目录时间戳由 `Get-Date -Format 'yyyyMMdd-HHmmss'` 生成。包内只允许 `backend`、`frontend`、`scripts`、`docs` 和说明文件。生成：

- `REPLACE_FILES.md`
- `ROLLBACK.md`
- `VERIFICATION.md`
- `SHA256SUMS.txt`

不得包含 `stellar.db`、`*-wal`、`*-shm`、`uploads`、`backups`、`logs`、`.tmp`、`node_modules`、`production_env.local.bat` 或任何 AccessKey。

- [ ] **Step 5: 验证包并更新唯一指针**

```powershell
$name = Get-Content '临时/LATEST_PATCH_PATH.txt' -Raw
$path = Join-Path '临时' $name.Trim()
Test-Path $path
Get-FileHash "$path.zip" -Algorithm SHA256
```

Expected: 指针只指向最新 P14 累计包，ZIP hash 与 `SHA256SUMS.txt` 一致。

- [ ] **Step 6: 提交并推送**

```powershell
git add backend frontend scripts docs '临时/LATEST_PATCH_PATH.txt'
git commit -m "P14-7: release StarHope SMS beta"
git push origin codex/phase9-10-reward-explore
```

只提交本阶段涉及文件；历史临时包、既有未跟踪文件和本地环境文件保持不动。
