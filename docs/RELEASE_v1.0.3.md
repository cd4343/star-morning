# Star Coin v1.0.3 发布说明

日期：2026-05-13

## 本次修复

- 惩罚设置页默认进入“惩罚规则”，增加顶部返回，保存后不再自动跳走。
- 家庭管理进入页面会主动加载成员；无成员时显示空状态，不再一直显示加载中。
- 特权管理后端保存 `level`、`timeWindow` 和 `category`，前端支持按分类展示与编辑。
- 成就管理支持分类、达成奖励（金币/经验/特权点）和手动颁发。
- 移动端布局支持左缘滑动返回。
- 规则文档补充人民币 1:10 的金币参考、经验/特权点规划、成就奖励和 ADHD 使用建议。

## 数据库兼容

本版本只补充字段，不覆盖线上数据：

- `privileges.category`
- `achievement_defs.category`
- `achievement_defs.rewardCoins`
- `achievement_defs.rewardXp`
- `achievement_defs.rewardPrivilegePoints`

已有字段会自动跳过。现有特权默认归类为“其他”，现有成就默认归类为“成长”。

## 上线提醒

- 发布前备份线上 SQLite 数据库。
- 只替换前后端程序包，不要用本地 `database.sqlite` 覆盖服务器数据库。
- 成就奖励只对新解锁或手动颁发的成就生效，历史已解锁成就不会自动补发。

## 已验证

- `frontend` 执行 `npm run build` 通过。
- `backend` 执行 `npm run build` 通过。
- 本地 API 烟测通过：特权编辑可保存层级/分类，成就手动颁发可发放金币、经验和特权点。
