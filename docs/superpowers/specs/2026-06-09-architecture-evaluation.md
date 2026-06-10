# Star Coin 技术架构评估报告

**评估人**: 高见远（Gao），架构师
**评估日期**: 2026-06-09
**评估版本**: v1.1.3
**项目**: Star Coin（星辰早晨 - 家庭成长激励系统）

---

## 目录

1. [项目结构评估](#1-项目结构评估)
2. [技术架构健康度](#2-技术架构健康度)
3. [代码质量评估](#3-代码质量评估)
4. [家庭探索功能技术可行性评估](#4-家庭探索功能技术可行性评估)
5. [技术优化建议](#5-技术优化建议)

---

## 1. 项目结构评估

### 1.1 目录架构合理性

**当前结构概览**：
```
star-coin/
├── _archive/           # 归档（空）
├── 临时/               # 增量包 203MB
├── backend/src/        # 5个TS文件，9804行
├── backups/            # 数据库备份
├── docs/               # 29个文档
├── frontend/src/       # 22个页面 + 17个组件 + hooks/utils/contexts/services
├── scripts/            # 脚本
├── stellar.db          # SQLite 数据库
└── README.md
```

**评级**: ⚠️ 中等偏下

**优点**：
- 前后端分离的顶层目录划分清晰（`backend/`、`frontend/`）
- 前端内部结构合理：`pages/child/`、`pages/parent/`、`pages/auth/` 按角色分目录
- 通用组件独立于页面组件
- 文档集中在 `docs/` 目录
- 已有 `_archive/` 归档目录概念

**问题**：

| # | 问题 | 严重程度 | 说明 |
|---|------|----------|------|
| 1 | `临时/` 目录包含 203MB 增量包 | 🔴 高 | 增量更新包含完整的 node_modules 副本，严重浪费存储。且使用中文目录名，在跨平台场景有编码风险 |
| 2 | `_archive/` 完全为空 | 🟡 中 | 归档概念存在但未使用，旧版本代码散落在 `临时/` 中 |
| 3 | 后端仅 5 个源文件 | 🔴 高 | `server.ts` 7200行单文件、`database.ts` 883行、`rewardSystem.ts` 1454行，缺乏模块化拆分 |
| 4 | 缺少后端路由/中间件/控制器分层 | 🔴 高 | 无 `routes/`、`controllers/`、`middleware/`、`services/`、`models/` 目录 |
| 5 | 前端缺少 `types/` 目录 | 🟡 中 | 类型定义散落在各页面组件中（如 `ChildExplore.tsx` 和 `ParentExplore.tsx` 各自定义了重复的 `ExplorePlace` 类型） |
| 6 | 缺少测试目录 | 🟡 中 | 后端无测试文件，前端仅有 Playwright smoke test |
| 7 | `uploads/` 在项目根目录 | 🟢 低 | 探索媒体文件存储在项目根目录下，与代码混合 |

### 1.2 模块划分合理性

**后端模块划分**：❌ 极不合理

当前后端只有 5 个文件，职责严重不均衡：

| 文件 | 行数 | 职责 |
|------|------|------|
| server.ts | 7200 | 所有路由 + 中间件 + 工具函数 + 常量 + 业务逻辑 |
| database.ts | 883 | 表创建 + 迁移（含探索表） |
| rewardSystem.ts | 1454 | 奖励系统 + 抽奖 + 宝箱 + 注册路由 |
| taskRewards.ts | 146 | 任务奖励计算 |
| backup.ts | 121 | 数据库备份 |

`server.ts` 承担了至少 8 个业务域的全部路由和逻辑：
1. 认证与用户管理
2. 任务 CRUD + 挑战/会话
3. 审核 + 自动审批 + 惩罚
4. 心愿/商店/抽奖/宝箱
5. 背包/特权/成就
6. 学习闯关
7. 早餐系统
8. 探索系统
9. 游戏票/屏幕时间
10. 情绪打卡
11. 登录奖励

**前端模块划分**：⚠️ 中等

- ✅ 按角色分页面目录（`child/`、`parent/`、`auth/`）
- ✅ 通用组件独立
- ✅ Context 状态管理、API 服务层分离
- ❌ 页面组件过大（`ChildChallenge.tsx` 1570行、`ParentDashboard.tsx` 1841行、`ParentWishes.tsx` 1805行）
- ❌ 缺少按业务域的 hooks 抽取（如 `useExplore`、`useTask`）
- ❌ 类型定义重复

### 1.3 临时文件管理规范建议

**当前状况**：`临时/` 目录包含 19 个子目录，占用 203MB，包含大量 `node_modules` 副本和旧版完整包。

**建议**：

1. **立即清理**：删除 `临时/` 中所有旧增量包和完整包，仅保留最新一个增量包用于回滚参考
2. **版本管理迁移**：增量包应由 Git tag/release 管理，不再存放在项目目录内
3. **CI/CD 替代**：构建部署包应由 CI 流水线自动生成，而非手动存入 `临时/`
4. **目录重命名**：如需保留临时目录，改用 `temp/` 或 `deploy/` 等英文命名
5. **`.gitignore` 规则**：确保 `临时/`、`temp/`、`deploy/` 不被提交到版本控制

### 1.4 文档组织评估

**评级**: ✅ 良好

- 29 个文档覆盖了架构、部署、代码健康、功能、发布记录、产品分析
- `docs/superpowers/` 子目录用于新功能规格和实施计划，组织清晰
- 版本发布记录完整（v1.0.1 ~ v1.1.3）

**改进建议**：
- `CHANGELOG.md` 与多个 `RELEASE_v*.md` 有信息重叠，建议统一为 CHANGELOG
- 缺少 API 文档（如 OpenAPI/Swagger 规范）
- 缺少贡献指南（CONTRIBUTING.md）

---

## 2. 技术架构健康度

### 2.1 后端 server.ts 7200 行单文件问题

**评级**: 🔴 严重技术债

**影响分析**：

| 维度 | 影响 |
|------|------|
| 开发效率 | 编辑器卡顿、搜索定位困难、合并冲突频繁 |
| 代码审查 | 无法有效 review，改动影响范围不可控 |
| 错误定位 | 日志中的错误栈指向同一个文件，难以快速定位问题路由 |
| 新人上手 | 需要阅读 7200 行才能理解系统全貌 |
| 测试隔离 | 无法对单个路由/模块进行单元测试 |
| 安全审计 | 认证逻辑与业务逻辑混在一起，权限检查容易遗漏 |

**拆分建议**（按业务域）：

```
backend/src/
├── server.ts              # 入口：加载中间件、挂载路由
├── middleware/
│   ├── auth.ts            # JWT 认证 + 角色检查
│   ├── errorHandler.ts    # 全局错误处理
│   └── requestLogger.ts   # 请求日志
├── routes/
│   ├── auth.ts            # /api/auth/*
│   ├── parent.ts          # /api/parent/*
│   ├── child.ts           # /api/child/*
│   ├── explore.ts         # /api/parent/explore*, /api/child/explore*
│   ├── tasks.ts           # 任务 CRUD + 挑战/会话
│   ├── rewards.ts         # 抽奖/宝箱/背包/特权
│   ├── achievements.ts    # 成就系统
│   ├── learning.ts        # 学习闯关
│   ├── breakfast.ts       # 早餐系统
│   ├── punishment.ts      # 惩罚系统
│   └── screenTime.ts      # 游戏票/屏幕时间
├── services/              # 业务逻辑层
│   ├── taskService.ts
│   ├── rewardService.ts   # 已有 rewardSystem.ts，可拆分
│   ├── exploreService.ts
│   └── achievementService.ts
├── utils/
│   ├── beijingTime.ts     # 北京时间工具
│   ├── normalizers.ts     # 分类/状态标准化
│   └── dbHelpers.ts       # withTransaction, dbRunWithRetry
├── database.ts            # 保持，但迁移应版本化
└── backup.ts
```

**拆分策略**：渐进式，每次迁移一个业务域。优先迁移最独立的模块（探索、早餐、成就）。

### 2.2 数据库迁移策略评估

**评级**: ⚠️ 可用但有隐患

**当前策略**：
- 使用 `CREATE TABLE IF NOT EXISTS` 幂等建表
- 新增字段使用 `ALTER TABLE ADD COLUMN`，包裹 `try/catch` 忽略"字段已存在"错误
- 迁移在 `initializeDatabase()` 启动时顺序执行
- 无版本号追踪，无回滚能力

**优点**：
- ✅ 简单直接，适合单人开发
- ✅ 幂等性保证，重复启动安全
- ✅ 对 SQLite 小项目来说够用

**隐患**：

| # | 问题 | 风险 |
|---|------|------|
| 1 | 无迁移版本追踪 | 无法确认数据库当前处于哪个迁移状态，难以排查"迁移是否已执行" |
| 2 | 无回滚能力 | 错误迁移无法回退，只能手动修数据库 |
| 3 | ALTER TABLE 的 try/catch 掩盖真实错误 | 字段添加失败可能是因为权限、磁盘满等，而非"已存在" |
| 4 | 迁移代码顺序固定 | 新迁移必须追加到末尾，中间插入会破坏幂等性 |
| 5 | 数据迁移与结构迁移混合 | UPDATE 语句和 ALTER TABLE 混在一起（如 database.ts 第127-145行的批量 UPDATE） |
| 6 | 探索表在 database.ts 第54行创建 | 探索功能的表不应该出现在核心数据库初始化函数的中间位置，应独立管理 |

**建议**：
- 短期：引入 `schema_version` 表记录已执行的迁移
- 中期：将迁移拆分为独立文件（`migrations/001_initial.sql`、`migrations/002_explore.sql`）
- 长期：考虑使用 `knex` 或 `drizzle-orm` 的迁移工具

### 2.3 API 设计规范性和一致性

**评级**: ⚠️ 基本可用但不规范

**优点**：
- ✅ 统一使用 `/api/` 前缀
- ✅ 家长端和孩童端通过 `/api/parent/` 和 `/api/child/` 区分
- ✅ RESTful 风格（GET/POST/PUT/DELETE）
- ✅ 认证接口有速率限制

**问题**：

| # | 问题 | 示例 |
|---|------|------|
| 1 | 响应格式不统一 | 部分返回 `{message: '...'}`，部分返回 `{data: [...]}`，部分直接返回数组 |
| 2 | HTTP 状态码使用不规范 | 审核接口有时用 200 返回错误信息，而非 4xx |
| 3 | 缺少 API 版本控制 | `/api/` 无版本前缀，破坏性变更影响所有客户端 |
| 4 | 错误响应格式不统一 | 有些返回 `{message}`，有些返回 `{error}`，有些返回原始 SQLite 错误 |
| 5 | 认证路由混用 POST | `/api/auth/sms/login`、`/api/auth/mobile/one-click-login` 等登录接口命名风格不一致 |
| 6 | 部分 PUT 实际是 PATCH 语义 | `PUT /api/parent/explore/places/:id` 只更新部分字段 |

**建议**：
- 定义统一响应格式：`{ code: number, data: T, message: string }`
- 添加 API 版本前缀：`/api/v1/`
- 创建 API 文档（OpenAPI 规范）
- 统一错误码体系

### 2.4 前端状态管理评估

**评级**: ⚠️ 中等

**当前方案**：React Context + useState，无全局状态管理库

**优点**：
- ✅ AuthContext 管理认证状态，结构清晰
- ✅ 使用 `useAuth` hook 封装，API 友好
- ✅ API 拦截器统一处理 401 和重试

**问题**：

| # | 问题 | 说明 |
|---|------|------|
| 1 | 无全局数据缓存 | 每次进入页面都重新请求，无客户端缓存。如 ChildLayout 和子页面各自独立请求用户数据 |
| 2 | 跨组件状态传递困难 | 页面间通过 URL 参数和 localStorage 传数据，缺乏统一的跨页面状态 |
| 3 | API 拦截器与 AuthContext 不同步 | 401 时拦截器直接清 localStorage 并跳转，但 AuthContext 可能保持旧状态（已通过 `auth:logout` 事件修复部分） |
| 4 | 缺少乐观更新 | 审核操作后重新加载所有数据，而非本地更新状态 |
| 5 | 类型定义散落 | `ExplorePlace` 在 ChildExplore 和 ParentExplore 中重复定义 |

**建议**：
- 短期：抽取共享类型定义到 `types/` 目录
- 中期：引入 `TanStack Query`（React Query）替代手动 fetch+state 模式，自动缓存和重新验证
- 长期：如果跨页面状态复杂度继续增长，考虑轻量状态管理（Zustand）

### 2.5 认证和安全性评估

**评级**: 🔴 多项安全隐患

| # | 问题 | 严重程度 | 详情 |
|---|------|----------|------|
| 1 | JWT Secret 硬编码 | 🔴 严重 | 默认值 `'stellar-system-dev-secret-change-in-production'`，虽有启动警告但仍可被利用 |
| 2 | Token 存储在 localStorage | 🟡 中 | XSS 攻击可窃取 token。建议迁移到 httpOnly cookie |
| 3 | 无 Token 刷新机制 | 🔴 严重 | Token 过期后直接跳转登录页，用户体验差且不安全 |
| 4 | 401 拦截器直接跳转 | 🟡 中 | 可被恶意利用触发无限重定向（已通过 `redirectingToLogin` 标志部分修复） |
| 5 | 媒体上传缺少路径遍历防护 | 🟡 中 | `saveExploreMediaFile` 使用 `randomUUID()` 生成文件名，路径安全。但 `familyId` 和 `childId` 来自请求，理论上可被篡改 |
| 6 | base64 上传无病毒扫描 | 🟢 低 | 图片和音频通过 base64 上传后直接写磁盘，无内容安全扫描 |
| 7 | CORS 配置宽松 | 🟡 中 | 开发环境下 `cors()` 无 origin 限制 |
| 8 | 缺少请求体大小限制（部分） | 🟡 中 | 全局 JSON 限制 20MB，但探索媒体通过 base64 编码后可能超过 |

**关键修复优先级**：
1. 🔴 JWT Secret 必须在生产环境通过环境变量强制配置
2. 🔴 实现 Token 刷新机制（refresh token 或滑动过期）
3. 🟡 媒体上传路径校验：验证 familyId/childId 与 JWT 用户一致
4. 🟡 CORS 配置收紧到生产域名

### 2.6 性能瓶颈评估

**2.6.1 SQLite 并发**

**评级**: ⚠️ 当前可用但有上限

- ✅ 已启用 WAL 模式、busy_timeout=30s、64MB 缓存
- ✅ 使用 `dbRunWithRetry` 处理 SQLITE_BUSY
- ⚠️ SQLite 单写者模型：高并发写入时仍会阻塞
- ⚠️ 部分路由缺少事务包装（如探索打卡的 checkin + media 写入应在一个事务内）
- ❌ `withTransaction` 函数已定义但未在所有需要的地方使用

**当前规模评估**：家庭级应用（数十用户同时在线）SQLite 足够。如需支持数百并发，需考虑 PostgreSQL。

**2.6.2 前端包大小**

**评级**: ✅ 良好

- ✅ 使用 `React.lazy()` + `Suspense` 懒加载所有页面
- ✅ Vite 代码分割自动生效
- ⚠️ 未分析具体 bundle size，建议添加 `rollup-plugin-visualizer` 监控
- ⚠️ 部分页面组件较大（ParentDashboard 1841行），拆分子组件有助于 tree-shaking

**2.6.3 API 请求效率**

**评级**: ⚠️ 有优化空间

- ⚠️ 探索页面加载时并发请求 places + checkins，可合并
- ⚠️ 无 API 响应缓存机制
- ⚠️ 部分列表接口缺少分页（如成就列表、探索地点列表）
- ❌ `GET /api/parent/explore/places` 使用子查询计算 checkinCount，数据量大时性能差

---

## 3. 代码质量评估

### 3.1 基于已知问题清单的当前状态

**来源**：`CODE_HEALTH_REPORT.md`（2026-01-30）

| 原始编号 | 问题 | 原严重程度 | 当前状态 |
|----------|------|------------|----------|
| #1 | API 拦截器与 AuthContext 状态不同步 | 🔴 严重 | ✅ 已通过 `auth:logout` 事件机制修复 |
| #2 | 缺少 Token 刷新机制 | 🔴 严重 | ❌ 未修复 |
| #3 | 类型安全性不足 | 🔴 严重 | ⚠️ 部分改善，api.ts 已添加 `ApiErrorResponse` 类型，但后端仍大量使用 `any` |
| #4 | 缺少 404 路由 | 🟡 中等 | ✅ 已修复（App.tsx 有 NotFound 组件） |
| #5 | ProtectedRoute 未处理加载状态 | 🟡 中等 | ✅ 已修复（添加了 isLoading 检查） |
| #6 | Token 验证超时被忽略 | 🟡 中等 | ⚠️ 部分修复，超时时不清除 token，但仍无重试机制 |
| #7 | 缺少网络错误处理 | 🟡 中等 | ⚠️ 部分改善，添加了 `isNetworkError` 检测，但用户提示仍不够友好 |
| #8 | JSON.parse 缺少错误处理 | 🟡 中等 | ✅ 已修复 |
| #9 | updateUser 缺少空值检查 | 🟡 中等 | ⚠️ 未修复（静默返回） |
| #10 | 生产环境控制台日志 | 🟢 低 | ❌ 未修复 |
| #11 | 缺少请求取消机制 | 🟢 低 | ❌ 未修复 |
| #12 | 重试逻辑可能阻塞 | 🟢 低 | ⚠️ 部分改善，添加了重试次数限制 |
| #13 | SmartEntry 直接访问 localStorage | 🟢 低 | ❌ 未修复 |
| #14 | 缺少基于角色的路由保护 | 🟢 低 | ✅ 已修复（App.tsx 有 RoleRoute 组件） |
| #15 | Token 存储在 localStorage | 🟢 低 | ❌ 未修复（架构级变更） |

**统计**：15 个问题中，5 个已完全修复，5 个部分改善，5 个未修复。

**新增问题**（v1.1.3 代码审查发现）：

| # | 新问题 | 严重程度 |
|---|--------|----------|
| N1 | `useOutletContext<any>()` 使用 any，丢失类型安全 | 🟡 中等 |
| N2 | 探索页面 `ExplorePlace` 类型在两个页面重复定义 | 🟡 中等 |
| N3 | `error: any` 在多处 catch 块中出现 | 🟡 中等 |
| N4 | 后端 `AuthRequest` 接口在 server.ts 和 rewardSystem.ts 分别定义 | 🟡 中等 |
| N5 | `EXPLORE_CATEGORIES`、`EXPLORE_STATUSES` 等常量硬编码在 server.ts | 🟢 低 |

### 3.2 TypeScript 类型安全评估

**评级**: ⚠️ 中等

**前端**：
- ✅ 使用 TypeScript，接口定义覆盖了核心数据模型
- ✅ api.ts 有 `ApiErrorResponse` 类型
- ❌ 大量 `any` 使用：`useOutletContext<any>()`、`catch (e: any)`、`error.response?.data as any`
- ❌ 类型定义散落在各组件中，缺乏集中管理
- ❌ API 响应类型未定义（调用 `api.get()` 返回 `any`）

**后端**：
- ✅ Express Request 扩展了 `AuthRequest` 类型
- ❌ `req: any` 在多个路由处理器中出现（第7124行等）
- ❌ 数据库查询结果全部为 `any`（sqlite 库不支持行类型推断）
- ❌ `normalizeTaskCompletionSettings(body: any, ...)` 参数为 any
- ❌ `saveExploreMediaFile(payload: any, ...)` 参数为 any

**建议**：
1. 创建 `frontend/src/types/` 目录，集中管理类型定义
2. 为 API 响应创建泛型封装：`api.get<T>('/path')` 返回类型化结果
3. 后端创建 `src/types/` 定义请求/响应接口
4. 启用 `strict: true` 在 tsconfig 中，逐步消除 `any`

### 3.3 测试覆盖率评估

**评级**: 🔴 极低

**当前状态**：
- 前端：仅有 Playwright smoke test（`npm run test:smoke`），无单元测试
- 后端：零测试覆盖
- 无 CI/CD 自动运行测试
- 无测试覆盖率报告

**风险**：
- 后端 7200 行代码无任何自动化测试，重构风险极高
- 奖励计算逻辑（rewardSystem.ts 1454行）最需要单元测试保护
- 数据库迁移无测试验证
- 认证流程无安全测试

**建议**：
1. **最高优先级**：为 `rewardSystem.ts` 的计算逻辑添加单元测试（纯函数，最易测试）
2. 为 `database.ts` 迁移逻辑添加集成测试（验证幂等性）
3. 为 API 路由添加集成测试（使用 supertest）
4. 为前端关键组件添加单元测试（React Testing Library）
5. 引入测试覆盖率目标：核心逻辑 > 80%，路由 > 50%

### 3.4 错误处理和日志评估

**评级**: ⚠️ 中等

**优点**：
- ✅ 有全局错误处理中间件（server.ts 第7134行）
- ✅ 有 404 处理
- ✅ 有请求日志中间件（含耗时）
- ✅ 有健康检查端点
- ✅ 有定时健康检查（5分钟间隔）
- ✅ 有优雅关闭处理（SIGTERM）
- ✅ 有 `uncaughtException` / `unhandledRejection` 处理

**问题**：
- ❌ 生产环境 `console.error` 打印完整错误信息，可能泄露内部细节
- ❌ 缺少结构化日志（JSON 格式），不利于日志聚合分析
- ❌ 前端 `catch (e: any)` 模式吞掉错误细节
- ❌ `uncaughtException` 处理只打印不退出（第7189行），可能导致内存泄漏和不可预测行为
- ⚠️ 数据库迁移错误被静默忽略（`try { ALTER TABLE } catch (e) {}`）
- ⚠️ 探索媒体上传失败后，已创建的 checkin 记录不会回滚

---

## 4. 家庭探索功能技术可行性评估

### 4.1 与现有模块的集成风险评估

**评级**: ⚠️ 中等风险

| 风险点 | 详情 | 缓解措施 |
|--------|------|----------|
| 成就系统集成 | 新增 5 种 explore_* 条件类型，需修改成就检查逻辑 | ✅ 已在 `DEFAULT_ACHIEVEMENT_SEEDS` 中定义探索成就种子，条件类型以 `explore_` 前缀区分 |
| 孩子端导航变更 | 从 4 入口变 5 入口（新增探索），影响 ChildLayout | ⚠️ 导航布局改变可能影响现有页面在小屏设备上的展示 |
| 数据库新增 3 张表 | 在已有 20+ 表基础上继续增加 | ✅ 表结构独立，外键关联清晰，不修改现有表 |
| 认证复用 | 探索接口使用现有 JWT 认证 | ✅ 风险低，直接复用 `protect` 中间件 |

**核心风险**：成就系统的 `explore_*` 条件类型需要在任务审核、打卡确认等时机触发检查。当前成就检查逻辑分散在多个路由中，新增探索相关检查需要在 checkin 和 confirm 流程中添加，容易遗漏。

**建议**：将成就检查抽取为独立事件系统（`emit('checkin.created')` → `achievementChecker.handle()`），避免在每个路由中硬编码检查逻辑。

### 4.2 文件上传安全性评估

**评级**: ⚠️ 中等，需加固

**当前实现**（`saveExploreMediaFile`）：

| 安全措施 | 状态 | 说明 |
|----------|------|------|
| MIME 类型白名单 | ✅ 有 | 图片：jpeg/png/webp/gif；音频：webm/mpeg/mp4/wav/ogg |
| 文件大小限制 | ✅ 有 | 图片 2MB，音频 5MB |
| 文件名随机化 | ✅ 有 | 使用 `randomUUID()` + 扩展名 |
| 路径遍历防护 | ⚠️ 部分 | 文件名随机化可防路径遍历，但 `familyId`/`childId` 来自请求参数 |
| base64 解码校验 | ✅ 有 | 正则匹配 `data:([^;]+);base64,(.+)` |
| 内容验证 | ❌ 无 | 不验证图片/音频内容是否与 MIME 类型一致 |
| 病毒扫描 | ❌ 无 | 无内容安全扫描 |
| 上传频率限制 | ❌ 无 | 单次打卡最多 3 图片 + 1 音频，但无频率限制 |

**关键风险**：

1. **MIME 类型欺骗**：攻击者可构造 `data:image/png;base64,<malicious_content>`，绕过 MIME 白名单。实际内容可能是 HTML 或脚本。
2. **路径注入**：`familyId` 来自 JWT token，但如果 JWT 密钥泄露或校验不严，可能构造恶意路径。
3. **磁盘耗尽**：无总存储配额限制，恶意上传可耗尽服务器磁盘。
4. **base64 大小计算**：`Buffer.from(base64, 'base64')` 解码后的大小与编码前不同，需验证解码后大小。

**建议**：
1. 添加 `file-type` 库验证文件魔数（magic number）
2. 限制每个家庭的总上传配额
3. 添加探索媒体上传的频率限制
4. 验证 `familyId` 和 `childId` 与 JWT token 中的一致性

### 4.3 数据库扩展性评估

**评级**: ✅ 可接受

- 当前 20+ 表，新增 3 张探索表（explore_places、explore_checkins、explore_media）
- 新表结构独立，通过 familyId 外键关联，不修改现有表结构
- SQLite 对 30+ 表无性能问题
- 探索数据量预计较小（每个家庭几十个地点、几百次打卡）

**潜在问题**：
- ⚠️ `explore_places` 表缺少索引（familyId、status），查询性能随数据增长下降
- ⚠️ `explore_checkins` 缺少 (familyId, childId) 联合索引
- ⚠️ `explore_media` 缺少 checkinId 索引
- ⚠️ `getExplorePlaceSelect()` 使用子查询计算 checkinCount，大量数据时性能差

**建议**：
```sql
CREATE INDEX idx_explore_places_familyId ON explore_places(familyId);
CREATE INDEX idx_explore_places_status ON explore_places(familyId, status);
CREATE INDEX idx_explore_checkins_familyId ON explore_checkins(familyId);
CREATE INDEX idx_explore_checkins_childId ON explore_checkins(familyId, childId);
CREATE INDEX idx_explore_media_checkinId ON explore_media(checkinId);
```

### 4.4 后端路由膨胀评估

**评级**: ⚠️ 需要拆分

- 当前 124 个路由 + 新增 12 个探索路由 = 136 个路由
- 所有路由集中在 `server.ts` 一个文件中
- 探索路由（7 家长 + 5 孩子）相对独立，适合作为拆分的第一个模块

**路由分布估算**（基于代码结构）：

| 业务域 | 估算路由数 | 独立性 |
|--------|-----------|--------|
| 认证/用户 | ~15 | 高 |
| 任务/审核/惩罚 | ~25 | 中 |
| 心愿/商店/抽奖 | ~20 | 中 |
| 背包/特权 | ~10 | 中 |
| 成就 | ~8 | 中 |
| 学习闯关 | ~12 | 中 |
| 早餐 | ~10 | 高 |
| 探索 | ~12 | 高 |
| 游戏票/屏幕时间 | ~8 | 中 |
| 情绪/登录奖励/其他 | ~16 | 低 |

**建议**：探索模块独立性最高，优先拆分为独立路由文件，作为后续拆分的模板。

### 4.5 高德 API 依赖评估

**评级**: ✅ 设计合理

- ✅ 高德 Key 仅在后端环境变量 `AMAP_WEB_SERVICE_KEY`，前端不暴露
- ✅ 无 Key 时功能降级（搜索不可用，手动添加仍可用）
- ✅ 搜索失败有容错处理
- ⚠️ 无 API 调用频率限制和高德配额管理
- ⚠️ 无搜索结果缓存，同一关键词重复搜索

**建议**：
1. 添加搜索结果缓存（Redis 或内存 LRU，TTL 1小时）
2. 监控高德 API 调用量，避免超额
3. 考虑备用 POI 搜索源

### 4.6 成就系统扩展评估

**评级**: ⚠️ 需要架构改进

**当前实现**：
- 成就检查逻辑硬编码在各路由中（任务审核后检查 `task_count`/`category_count`/`streak_days`，打卡后检查 `explore_checkin_count` 等）
- 成就种子数据定义在 `server.ts` 中（519-584行），约 65 个种子

**扩展风险**：
- 每新增一种成就条件类型，需在对应路由中手动添加检查代码
- 检查逻辑分散，容易遗漏或重复
- 条件类型数量从 6 种增长到 11 种（+5 探索类型），未来会继续增长

**建议**：引入事件驱动的成就检查架构：
```typescript
// 成就检查器注册
achievementChecker.register('explore_checkin_count', async (childId, familyId) => {
  const count = await getDb().get('SELECT COUNT(*) as c FROM explore_checkins WHERE childId = ?', childId);
  return count.c;
});

// 触发点
eventBus.emit('checkin.created', { childId, familyId });
```

### 4.7 移动端语音录制和图片上传兼容性

**评级**: ⚠️ 需要测试验证

**语音录制**（`ChildExplore.tsx` 第98-124行）：
- 使用 `navigator.mediaDevices.getUserMedia({ audio: true })` + `MediaRecorder`
- ⚠️ iOS Safari 对 `MediaRecorder` 支持有限（iOS 14.5+ 才支持，且仅支持 `audio/mp4`）
- ⚠️ 部分安卓浏览器对 `audio/webm` 支持不一致
- ⚠️ 无录音权限被拒的友好降级（仅有 toast 提示）

**图片上传**：
- 使用 `<input type="file" accept="image/*" multiple>`
- ✅ 兼容性良好，移动端会弹出相机/相册选择
- ⚠️ 无图片压缩，2MB 限制可能导致高像素手机拍照后被拒
- ⚠️ 无 EXIF 信息处理，上传的照片可能包含位置隐私

**建议**：
1. 添加 `MediaRecorder.isTypeSupported()` 检测，动态选择支持的 MIME 类型
2. iOS 降级方案：不支持 MediaRecorder 时提供纯文字打卡
3. 前端图片压缩（使用 `canvas` 或 `browser-image-compression`）
4. 上传前清除 EXIF 信息（使用 `exif-js` 或 `piexifjs`）

---

## 5. 技术优化建议

### 5.1 短期可修复项（1-2 周）

| # | 问题 | 影响范围 | 建议方案 | 优先级理由 |
|---|------|----------|----------|-----------|
| S1 | JWT Secret 硬编码 | 安全 | 在 server.ts 启动时检测，生产环境未设置 JWT_SECRET 则拒绝启动 | 安全漏洞，修复成本极低 |
| S2 | 探索表缺少索引 | 性能 | 添加 familyId、status、childId、checkinId 索引 | 数据增长后查询变慢，越早加越好 |
| S3 | 清理临时目录 | 存储和规范 | 删除旧增量包，仅保留最新一个；添加 .gitignore 规则 | 203MB 冗余，影响项目整洁度 |
| S4 | 媒体上传添加家庭配额 | 安全 | 限制每个家庭 uploads/explore 总大小（如 500MB） | 防止磁盘耗尽攻击 |
| S5 | 前端类型定义去重 | 代码质量 | 创建 `types/explore.ts`，统一 ExplorePlace/ExploreCheckin 类型 | 重复定义易导致不一致 |
| S6 | uncaughtException 处理改进 | 稳定性 | 记录错误后 process.exit(1)，配合 PM2 自动重启 | 当前不退出可能造成内存泄漏 |

### 5.2 中期优化项（1-2 月）

| # | 问题 | 影响范围 | 建议方案 | 优先级理由 |
|---|------|----------|----------|-----------|
| M1 | 后端 server.ts 拆分 | 可维护性 | 按业务域拆分为独立路由文件，先拆探索和成就模块 | 7200行单文件是最大技术债 |
| M2 | Token 刷新机制 | 安全/体验 | 实现 refresh token 或滑动窗口 token 续期 | 用户体验和安全关键项 |
| M3 | 数据库迁移版本化 | 可靠性 | 引入 schema_version 表 + 独立迁移文件 | 当前迁移策略难以维护 |
| M4 | 成就检查事件化 | 可扩展性 | 引入事件总线，成就检查逻辑从路由中解耦 | 避免新增成就类型时遗漏检查 |
| M5 | 前端引入 React Query | 性能/代码质量 | 替代手动 fetch+useState 模式，自动缓存和重新验证 | 减少重复请求，提升用户体验 |
| M6 | API 响应格式统一化 | 规范性 | 统一 `{code, data, message}` 格式，添加响应拦截器 | 前端错误处理简化 |
| M7 | 媒体上传路径校验 | 安全 | 验证上传请求中的 familyId/childId 与 JWT 一致 | 防止越权上传 |
| M8 | 移动端兼容性补齐 | 用户体验 | 图片压缩、iOS 录音兼容、EXIF 清除 | 家庭场景主要在移动端 |

### 5.3 长期架构改进项

| # | 问题 | 影响范围 | 建议方案 | 优先级理由 |
|---|------|----------|----------|-----------|
| L1 | 后端全面分层 | 可维护性 | routes → services → models 三层架构 | 根本性解决代码组织问题 |
| L2 | API 版本控制 | 兼容性 | 引入 `/api/v1/` 前缀，支持多版本并存 | 客户端数量增长后必需 |
| L3 | Token 存储迁移到 httpOnly cookie | 安全 | 后端设置 httpOnly cookie，前端不再手动管理 token | 防御 XSS 窃取 token |
| L4 | 引入自动化测试体系 | 质量 | 单元测试 + 集成测试 + E2E 测试 + CI 流水线 | 支撑安全重构 |
| L5 | 前端组件库抽取 | 复用性 | 任务卡片、奖励卡片、筛选栏、统计面板等复用组件抽取 | 页面数量持续增长 |
| L6 | 部署流程自动化 | 运维 | CI/CD 流水线（GitHub Actions）自动构建+部署 | 减少手动操作错误 |
| L7 | 监控和告警体系 | 运维 | 日志聚合（结构化日志）+ 错误追踪（Sentry）+ 性能监控 | 生产环境稳定性保障 |
| L8 | 数据库升级评估 | 性能 | 当并发需求超过 SQLite 能力时，评估 PostgreSQL 迁移 | 提前准备，避免紧急迁移 |

---

## 附录

### A. 关键代码度量

| 指标 | 数值 |
|------|------|
| 后端代码总行数 | 9,804 行 |
| server.ts 行数 | 7,200 行 |
| database.ts 行数 | 883 行 |
| rewardSystem.ts 行数 | 1,454 行 |
| 前端页面代码行数 | ~20,103 行 |
| 最大前端页面 | ParentDashboard.tsx (1,841 行) |
| 数据库表数量 | 23+ 张 |
| 后端路由数量 | 136 个（含探索） |
| 前端页面数量 | 22 个（10 child + 12 parent） |
| 临时目录占用 | 203 MB |
| 已知技术问题 | 15 个（5 已修复，5 部分改善，5 未修复） |

### B. 技术栈版本

| 组件 | 版本 |
|------|------|
| React | ^18.2.0 |
| TypeScript (前端) | ^5.2.2 |
| Vite | ^5.0.0 |
| Express | ^4.18.2 |
| TypeScript (后端) | ^5.9.3 |
| SQLite (sqlite) | ^5.1.1 |
| Node.js sqlite3 | ^6.0.1 |
| Tailwind CSS | ^3.3.5 |
| Axios | ^1.6.2 (前端) / ^1.13.2 (后端) |
| React Router | ^6.20.0 |

### C. 评估方法论

本评估基于：
1. 全部后端源代码阅读（server.ts、database.ts、rewardSystem.ts、taskRewards.ts、backup.ts）
2. 关键前端源代码阅读（App.tsx、AuthContext.tsx、api.ts、ChildExplore.tsx、ParentExplore.tsx）
3. 项目文档分析（ARCHITECTURE.md、CODE_HEALTH_REPORT.md、DEPLOYMENT.md、family-explore-design.md）
4. 代码行数统计和目录结构分析
5. 已知问题清单跟踪
