# 开发日志 (CHANGELOG)

## [0.4.0] - 2025-12-08

### 成就系统增强
- [FEAT] 新增解锁条件类型：`streak_days`（连续天数）、`category_count`（分类任务数）、`xp_count`（经验值）、`level_reach`（等级）
- [FEAT] 成就支持编辑功能（PUT API）
- [FEAT] 扩充成就图标库（80+ emoji，按类别分组）
- [FEAT] 扩充预设成就模板（45+ 模板，覆盖运动/学习/劳动/兴趣/好习惯等场景）

### 家长统计面板
- [FEAT] 新增详细统计 API (`/api/parent/stats`)
- [FEAT] 新增 `StatsPanel` 组件，支持展开/收起
- [FEAT] 统计指标：连续打卡天数、今日/本周/本月任务完成数、日均任务数
- [FEAT] 金币统计：获得/消耗/净流入趋势
- [FEAT] 分类任务完成比例可视化（进度条 + 百分比）
- [FEAT] 最接近解锁的成就进度显示

### 代码优化
- [FIX] 修复已弃用的 `apple-mobile-web-app-capable` meta 标签
- [FIX] 添加 React Router v7 future flags，消除控制台警告
- [REFACTOR] 清理 ParentDashboard 冗余状态变量
- [REFACTOR] 移除调试用 console.log 语句
- [CLEANUP] 删除调试文件和重复启动脚本

## [0.3.0] - 2025-12-07

### UI/UX 改进
- [FEAT] 新增 `BottomSheet` 组件，用于新建表单
- [FEAT] 新增 `IconPicker` 组件，统一图标选择体验
- [FIX] 修复手机端 UI 元素超出手机框边界问题
- [FIX] 将弹窗从 `fixed` 改为 `absolute` 定位，配合 `Layout` 的 `isolate`

### 抽奖系统修复
- [FIX] 修复抽奖失败问题（SQLite CHECK 约束）
- [FIX] 修复抽奖动画无限旋转问题
- [FIX] 添加数据库事务回滚机制

### 启动脚本优化
- [FEAT] 新增 `start_dev.ps1` PowerShell 启动脚本
- [FIX] 修复端口占用检测和进程清理逻辑

## [0.2.0] - 2025-11-24

### 架构变更
- [REFACTOR] 重构项目为前后端分离架构 (`frontend/` 和 `backend/`)
- [BACKEND] 引入 Node.js + Express + TypeScript 后端技术栈 (替代原计划的 Python/Flask)
- [DB] 实现 SQLite 数据库层，包含自动建表逻辑 (`database.ts`)

### 后端功能
- [FEAT] 实现用户认证系统 (JWT, 注册, 登录, 家庭创建)
- [FEAT] 实现家长端 API (仪表盘, 任务审核, 任务管理, 心愿/特权管理)
- [FEAT] 实现孩子端 API (首页聚合, 任务提交, 积分系统, 商品/特权兑换)
- [FEAT] 数据库表结构设计 (Users, Families, Tasks, TaskEntries, Wishes, Privileges)

## [0.1.0] - 2025-11-24

### 初始化
- [INIT] 项目初始化，建立基本文件结构
- [FEAT] 移植 React 原型到原生 HTML/CSS/JS 架构
- [DOCS] 创建开发规则文件 .cursorrules

### 新增
- 核心数据结构 `data.js` (移植自 React INITIAL_DATA)
- 基础样式系统 `style.css` (实现 BEM 规范)
- 单页应用入口 `index.html`
- 核心应用逻辑 `app.js` (包含路由、状态管理、视图渲染)
