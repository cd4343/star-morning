# 星辰动力 / Star Coin - 架构与数据流

## 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端 (React + Vite)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │
│  │ 家长端      │  │ 孩子端      │  │ 登录/注册   │               │
│  │ Dashboard   │  │ Tasks/Wishes │  │ Auth        │               │
│  │ Punishment │  │ Me           │  │             │               │
│  │ Wishes/Tasks│  │             │  │             │               │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘               │
│         │                │                │                       │
│         └────────────────┼────────────────┘                       │
│                          │ axios + JWT                            │
└──────────────────────────┼───────────────────────────────────────┘
                           │
┌──────────────────────────┼───────────────────────────────────────┐
│                          ▼                                        │
│              后端 (Node.js + Express)                              │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ server.ts                                                     │ │
│  │  - 认证 protect / JWT                                        │ │
│  │  - 时间工具 getBeijingDate, getLocalDateString               │ │
│  │  - 任务/审核/自动审批、抽奖、惩罚、心愿/背包/特权/成就        │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                          │                                        │
│  ┌──────────────────────┼──────────────────────────────────────┐ │
│  │ database.ts           ▼                                       │ │
│  │  - 表结构、迁移、getDb()                                      │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────┼───────────────────────────────────────┘
                           │
                           ▼
                  SQLite (stellar.db)
```

## 核心数据表关系

- **users**：家庭成员，`role` = parent/child，`familyId` 关联家庭
- **families**：家庭
- **tasks**：任务定义（按家庭）
- **task_entries**：任务实例（孩子提交、状态 pending/approved/rejected/completed）
- **punishment_settings**：家庭惩罚配置（轻度/中度/严重/自定义 min-max）
- **punishment_records**：惩罚记录，关联 taskEntryId、childId、parentId、level、deductedCoins
- **wishes**：心愿/商品/抽奖奖品，`type` = shop/savings/lottery，`effectType` = null 或 draw_again
- **user_inventory**：背包，来源 source = shop/lottery/privilege/savings，联表 wishes 得 effectType
- **achievement_defs / user_achievements**：成就定义与解锁

## 关键 API 分组

| 模块       | 典型接口 |
|------------|----------|
| 认证       | POST /api/login, /api/register, /api/create-family |
| 家长任务   | GET/POST /api/parent/tasks, /api/parent/dashboard, /api/parent/review-history |
| 审核与惩罚 | POST /api/parent/task-entries/:id/approve, POST .../punish |
| 孩子任务   | GET /api/child/tasks, POST /api/child/task-entries/:id/submit |
| 心愿/抽奖  | GET /api/child/wishes, POST /api/child/lottery/play, POST /api/child/lottery/redraw |
| 背包       | GET /api/child/inventory, POST .../inventory/:id/redeem, .../cancel |
| 惩罚设置   | GET/PUT /api/parent/punishment-settings |
| 惩罚记录   | GET /api/parent/punishment-records, GET /api/child/punishment-records |

## 时间与状态流（任务）

1. 孩子提交任务 → `task_entries.status = pending`，`submittedAt` 存 UTC，业务按北京时间判断“当天”。
2. 家长审核 → 可选综合评分（时间/质量/主动性）、可选惩罚（mild/moderate/severe/custom），更新 `task_entries` 与用户金币/经验，写入 `punishment_records`。
3. 自动审批：仅对**提交日期早于“今天”（北京时间）**的 pending 任务执行，避免把“今天”的任务误判为过期。

## 抽奖与「再抽一次」流

1. 孩子抽奖：`POST /api/child/lottery/play`，扣金币，随机奖品，写入 `user_inventory`（source=lottery）。
2. 若奖品 `effectType = 'draw_again'`：
   - **不放入背包**，而是记录为 `status='used'`（用于统计次数）
   - 前端立即弹窗提示"恭喜抽到再抽一次！"
   - 用户点击确认后调用 `POST /api/child/lottery/redraw` 免费再抽
   - 可连续抽到"再抽一次"，循环直到抽到普通奖品
