# 开发日志 (CHANGELOG)

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
