# Phase 2 Reward Economy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以 1 元约等于 10 金币为默认价值锚点，统一金币产出、商品定价和奖励展示，同时保留现有数据、支持家长预览与回滚。

**Architecture:** 将确定性经济公式从 `server.ts` 和页面常量收拢到纯函数 `economyPolicy.ts`，由独立 `economyRoutes.ts` 提供审计与写入接口。前端不增加一级导航，在快速配置和愿望管理中复用一个经济设置面板；所有生产数据调整必须先预览，再事务应用并记录批次。

**Tech Stack:** Node.js、Express、TypeScript、SQLite、Vitest、React 18、Tailwind CSS、Playwright。

---

## 文件结构

- Create `backend/src/economyPolicy.ts`：预设、整数校验、建议价、积累天数、偏差分类。
- Create `backend/src/economyPolicy.test.ts`：经济公式与边界测试。
- Create `backend/src/economyRoutes.ts`：设置、审计、预览、应用、回滚。
- Create `backend/src/economyRoutes.test.ts`：事务、家庭隔离与回滚测试。
- Modify `backend/src/database.ts`：幂等追加设置、参考价和变更批次表。
- Modify `backend/src/server.ts`：注册新路由并移除重复公式，保留原 URL。
- Modify `backend/src/productConfig.ts`：统一新家庭任务模板奖励。
- Create `frontend/src/types/economy.ts`：前后端经济数据结构。
- Create `frontend/src/components/EconomySettingsPanel.tsx`：家长配置与影响预览。
- Modify `frontend/src/pages/parent/ParentQuickSetup.tsx`：快速配置入口。
- Modify `frontend/src/pages/parent/ParentWishes.tsx`：商品参考价、积累天数与批量校准。
- Modify `frontend/src/pages/parent/ParentTasks.tsx`：任务预算提示与模板建议。
- Modify `frontend/src/pages/child/ChildLayout.tsx`：主指标只显示金币与今日游戏时间。
- Modify `frontend/src/pages/child/ChildMe.tsx`：承接成长经验和权益详情。
- Modify `frontend/src/pages/child/ChildChallenge.tsx`、`ChildToday.tsx`：统一预计/实际奖励文案。
- Modify `frontend/src/i18n/locales/zh-CN.ts`：新增所有用户可见文案 key。
- Modify `frontend/tests/smoke/product-phase1.spec.ts`：扩展 Phase 2 冒烟验证。
- Modify `frontend/tests/production/all-pages.spec.ts`：保持全页面无白屏。

### Task 1: 建立纯经济规则并冻结口径

**Files:**
- Create: `backend/src/economyPolicy.ts`
- Create: `backend/src/economyPolicy.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { normalizeEconomySettings, suggestShopCoins, daysToRedeem } from './economyPolicy';

describe('economy policy', () => {
  it('默认使用10金币每元，避免商品价值漂移', () => {
    expect(normalizeEconomySettings({})).toEqual({ coinPerRmb: 10, dailyCoinTarget: 30 });
    expect(suggestShopCoins(25, 10)).toBe(250);
  });
  it('所有金币计算保持整数且限制非法输入', () => {
    expect(suggestShopCoins(5.4, 10)).toBe(54);
    expect(() => suggestShopCoins(-1, 10)).toThrow('referenceRmb');
  });
  it('预计兑换天数至少为1天', () => {
    expect(daysToRedeem(50, 30)).toBe(2);
    expect(daysToRedeem(0, 30)).toBe(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && npm test -- economyPolicy.test.ts`  
Expected: FAIL，提示 `economyPolicy` 不存在。

- [ ] **Step 3: 实现最小纯函数**

```ts
export const ECONOMY_PRESETS = { fast: 5, standard: 10, longTerm: 20 } as const;

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

export const normalizeEconomySettings = (input: { coinPerRmb?: unknown; dailyCoinTarget?: unknown }) => ({
  coinPerRmb: clampInt(input.coinPerRmb, 1, 100, 10),
  dailyCoinTarget: clampInt(input.dailyCoinTarget, 1, 500, 30),
});

export const suggestShopCoins = (referenceRmb: number, coinPerRmb: number) => {
  if (!Number.isFinite(referenceRmb) || referenceRmb < 0) throw new Error('referenceRmb must be non-negative');
  return Math.max(0, Math.round(referenceRmb * clampInt(coinPerRmb, 1, 100, 10)));
};

export const daysToRedeem = (coins: number, dailyCoins: number) =>
  Math.max(1, Math.ceil(Math.max(0, Math.round(coins)) / Math.max(1, Math.round(dailyCoins))));
```

- [ ] **Step 4: 验证并提交**

Run: `cd backend && npm test -- economyPolicy.test.ts && npm run build`  
Expected: PASS，TypeScript 零错误。  
Commit: `git commit -m "P2-E1: freeze reward economy policy"`

### Task 2: 追加兼容数据结构

**Files:**
- Modify: `backend/src/database.ts`
- Test: `backend/src/economyRoutes.test.ts`

- [ ] **Step 1: 写迁移测试**：在临时 SQLite 中连续初始化两次，断言 `families.eco_daily_coin_target`、`wishes.reference_rmb` 只存在一次，两个变更表及索引存在。
- [ ] **Step 2: 运行测试确认失败**：`cd backend && npm test -- economyRoutes.test.ts`，Expected: FAIL，缺少列或表。
- [ ] **Step 3: 使用 `PRAGMA table_info` 幂等加列**，并创建：

```sql
CREATE TABLE IF NOT EXISTS economy_change_batches (
  id TEXT PRIMARY KEY, family_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  change_type TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
  rolled_back_at TEXT, FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS economy_change_items (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL, field_name TEXT NOT NULL,
  old_value INTEGER NOT NULL, new_value INTEGER NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES economy_change_batches(id) ON DELETE CASCADE
);
```

- [ ] **Step 4: 验证数据库兼容**：运行测试、后端构建，并在复制的临时数据库上执行初始化；禁止对根目录 `stellar.db` 运行写测试。
- [ ] **Step 5: 提交**：`git commit -m "P2-E2: add reversible economy migrations"`

### Task 3: 建立只读经济审计与配置接口

**Files:**
- Create: `backend/src/economyRoutes.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/src/economyRoutes.test.ts`

- [ ] **Step 1: 写接口测试**：覆盖默认 10/30、家庭隔离、近14天实际日均、无数据回退到 `eco_daily_coin_target`、商品偏差和非法比例 400。
- [ ] **Step 2: 运行测试确认失败**。
- [ ] **Step 3: 注册保持兼容的接口**：

```text
GET  /api/parent/economy-settings
PUT  /api/parent/economy-settings
GET  /api/parent/economy-audit
POST /api/parent/economy-recalibration-preview
POST /api/parent/economy-recalibration-apply
POST /api/parent/economy-recalibration/:batchId/rollback
```

审计响应固定为：

```ts
{ settings, production: { measuredDailyCoins, targetDailyCoins, sampleDays },
  catalog: { total, aligned, underpriced, overpriced, items }, warnings: string[] }
```

- [ ] **Step 4: 删除 `calculateSmartPricing` 对完成率涨价/降价的调用**，保留旧导出兼容但返回稳定锚点建议，并增加弃用测试。
- [ ] **Step 5: 验证并提交**：`npm test -- economyPolicy.test.ts economyRoutes.test.ts && npm run build`；提交 `P2-E3: add economy audit and settings APIs`。

### Task 4: 家长一键设置、预览与回滚

**Files:**
- Create: `frontend/src/types/economy.ts`
- Create: `frontend/src/components/EconomySettingsPanel.tsx`
- Modify: `frontend/src/pages/parent/ParentQuickSetup.tsx`
- Modify: `frontend/src/pages/parent/ParentWishes.tsx`
- Modify: `frontend/src/i18n/locales/zh-CN.ts`
- Test: `frontend/tests/smoke/product-phase1.spec.ts`

- [ ] **Step 1: 写 Playwright 失败测试**：模拟接口，选择标准模式后断言显示“10金币≈1元”；变更为长期模式后必须先看到逐项旧值/新值，未确认前不能发送 apply。
- [ ] **Step 2: 实现受控组件**：预设 5/10/20、自定义折叠、每日目标 20/30/50、审计警告、预览确认、回滚最近批次。
- [ ] **Step 3: 商品表单增加 API 字段 `referenceRmb`（数据库 `reference_rmb`）**，孩子端接口不得返回该字段；商品卡只显示金币和预计积累天数。
- [ ] **Step 4: 验证 375px 触控目标与失败态**：接口 500 时显示重试，不能显示“保存成功”。
- [ ] **Step 5: 运行 `npm run build && npm run test:smoke` 并提交 `P2-E4: add parent economy setup and preview`。

### Task 5: 校准任务产出并统一到账口径

**Files:**
- Modify: `backend/src/productConfig.ts`
- Modify: `backend/src/server.ts`（仅审核结算调用处）
- Modify: `frontend/src/pages/parent/ParentTasks.tsx`
- Modify: `frontend/src/pages/parent/ParentDashboard.tsx`
- Modify: `frontend/src/pages/child/ChildToday.tsx`
- Modify: `frontend/src/pages/child/ChildChallenge.tsx`
- Test: `backend/src/economyRoutes.test.ts`

- [x] **Step 1: 写测试**：同一 `taskEntryId` 只能结算一次；预告金币、批准金币、账本增量和余额差一致；生活任务不发游戏时间。
- [x] **Step 2: 新家庭模板以每日30金币目标校准**，存量任务只出预览，不自动改。
- [x] **Step 3: 家长任务编辑显示“预计每天产出/相当于商品积累天数”警告，不禁止家长覆盖。**
- [x] **Step 4: 审核响应统一返回**：

```ts
{ coinsAwarded, growthXpAwarded, privilegePointsAwarded, gameMinutesAwarded,
  reasons: string[], balanceAfter: { coins, privilegePoints } }
```

- [x] **Step 5: 前端只使用该响应生成到账提示，不在页面重复计算奖励。**
- [x] **Step 6: 全部测试、构建通过后提交 `P2-E5: unify task reward settlement`。**

### Task 6: 减少孩子端奖励认知负担

**Files:**
- Modify: `frontend/src/pages/child/ChildLayout.tsx`
- Modify: `frontend/src/pages/child/ChildMe.tsx`
- Modify: `frontend/src/pages/child/ChildWishes.tsx`
- Modify: `frontend/src/i18n/locales/zh-CN.ts`
- Test: `frontend/tests/smoke/product-phase1.spec.ts`

- [ ] **Step 1: 写失败测试**：顶部只能找到金币和今日剩余分钟；特权点、等级经验在“我的”可见；商店无人民币字样。
- [ ] **Step 2: ChildLayout 主指标改成金币和今日游戏时间**，使用 `/child/screen-time` 的基础、获得、使用、剩余字段。
- [ ] **Step 3: ChildMe 展示成长经验、权益来源说明和下一次权益进度，不把 `xp` 与 `rewardXpTotal` 合并。**
- [ ] **Step 4: ChildWishes 将实物商品与权益分区，金币商品不能使用特权点，权益不能使用金币。**
- [ ] **Step 5: 运行移动端及生产全页面测试，提交 `P2-E6: simplify child reward presentation`。**

### Task 7: 清除空奖并完成发布验证

**Files:**
- Modify: `backend/src/lotteryRules.ts`
- Modify: `backend/src/rewardSystem.ts`
- Modify: `backend/src/lotteryRules.test.ts`
- Modify: `frontend/tests/production/all-pages.spec.ts`
- Create: `docs/更新记录/2026-07-12-phase2-reward-economy.md`

- [ ] **Step 1: 测试禁止 `effectType=none`、标题含“谢谢参与”或数值型零奖励进入有效奖池；历史遗留空奖配置若仍被抽中，则转换为确定的最低金币补偿并记录真实到账值，不改写历史开奖记录。**
- [ ] **Step 2: 服务端校验奖池，不依赖前端；抽奖写入、API 响应和背包记录使用同一个归一化结果。**
- [ ] **Step 3: 运行完整验证**：

```powershell
cd backend; npm test; npm run build
cd ..\frontend; npm run build; npm run test:smoke; npm run test:production
node ..\scripts\verify_phase1_deployment.js
```

Expected: 所有测试零跳过、两个构建零错误、生产页面无白屏、关键分包完整。

- [ ] **Step 4: 新建时间戳增量包**：仅复制本阶段改动源码和完整 `backend/dist`、`frontend/dist`；包含 `REPLACE_FILES.md`、验证记录和回滚说明；排除 `stellar.db`、环境文件、上传、日志、备份和 `node_modules`。
- [ ] **Step 5: 验证 ZIP 根目录无额外外层目录，模拟安装后数据库哈希不变。**
- [ ] **Step 6: 提交 `P2-E7: release unified reward economy`，推送 `codex/product-phase-2-economy`；不合并 main。**

## 执行检查点

每个任务结束都必须报告：已修改文件、测试结果、数据库影响、回滚方式和下一批范围。Task 1–3 完成前不改生产商品与任务；Task 4–5 的批量修改默认关闭，必须由家长明确确认；任何测试失败都停止打包。
