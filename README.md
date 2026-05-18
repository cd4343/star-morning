# 星辰早晨 - 家庭成长激励系统

一个基于 React + TypeScript + Node.js 的家庭任务管理和奖励系统，帮助家长通过游戏化的方式激励孩子完成任务。

## ✨ 功能特性

### 孩子端
- 📋 **任务管理**：查看任务、完成任务、提交审核
- 🎁 **心愿系统**：兑换商店、储蓄目标、幸运抽奖
- 🎒 **我的背包**：查看已兑换物品、撤销兑换
- 👑 **特权系统**：使用特权点兑换服务性奖励
- 🏆 **成就系统**：解锁各种成就徽章

### 家长端
- ✅ **任务审核**：多维度评分（时间、质量、主动性）
- 📊 **数据统计**：本周任务完成率、准时率、金币统计
- 🎯 **任务管理**：创建任务、使用预设模板快速添加
- 🎁 **心愿管理**：管理商店商品、储蓄目标、抽奖奖品
- 👑 **特权管理**：设置特权模板、管理特权列表
- 🏆 **成就管理**：自定义成就规则
- 👨‍👩‍👧 **家庭管理**：添加孩子、设置PIN码

## 🛠️ 技术栈

- **前端**：React 18 + TypeScript + Vite + Tailwind CSS
- **后端**：Node.js + Express + TypeScript
- **数据库**：SQLite
- **认证**：JWT Token

## 📦 安装与运行

### 前置要求
- Node.js >= 16
- npm 或 yarn

### 快速启动

1. **克隆项目**
```bash
git clone <your-repo-url>
cd star-coin
```

2. **安装依赖**
```bash
# 后端
cd backend
npm install

# 前端
cd ../frontend
npm install
```

3. **启动服务**

**Windows 用户 - 智能启动（推荐）**：
双击 `scripts/start_app.bat`，然后选择环境：
- **选项 1**：本地开发环境（端口 3000/3001）
- **选项 2**：生产服务器环境（端口 80）

**直接启动（跳过选择）**：
- 本地开发：双击 `scripts/start_app_local.bat`
- 生产服务器：双击 `scripts/start_app_production.bat`

**手动启动**：
```bash
# 终端1 - 启动后端 (端口 3001)
cd backend
npm run dev

# 终端2 - 启动前端 (端口 3000)
cd frontend
npm run dev
```

4. **访问应用**

**本地开发环境**：
- 前端：http://localhost:3000
- 后端API：http://localhost:3001
- 手机访问：http://你的IP:3000（需在同一WiFi）

**生产服务器环境**：
- 访问：http://starcoin.h5-online.com/ 或 http://localhost/
- 需要管理员权限（使用80端口）

## 📁 项目结构

```
star-coin/
├── backend/                   # 后端服务
│   ├── src/
│   │   ├── server.ts          # Express 服务器
│   │   └── database.ts        # 数据库初始化
│   └── package.json
├── frontend/                  # 前端应用
│   ├── src/
│   │   ├── pages/             # 页面组件
│   │   ├── components/        # 通用组件
│   │   └── contexts/          # React Context
│   └── package.json
├── scripts/                   # 脚本工具
│   ├── start_app.bat          # 智能启动脚本（选择环境）
│   ├── start_app_local.bat    # 本地开发环境启动脚本
│   ├── start_app_production.bat # 生产服务器启动脚本
│   ├── start_dev.ps1          # PowerShell 开发启动脚本
│   ├── server.py              # Python HTTP 服务器（生产环境）
│   └── db-tools/              # 数据库工具脚本
├── docs/                      # 项目文档
└── README.md
```

## 🔐 默认设置

- **默认PIN码**：1234（建议首次登录后立即修改）
- **抽奖消耗**：按当天抽奖次数递增，前 10 次为 5、8、12、18、25、35、48、65、85、108 金币，之后每次继续递增 25 金币
- **任务审核**：支持时间、质量、主动性三维度评分

## 📝 开发说明

### 数据库
- 数据库文件：`stellar.db`（项目根目录，首次运行自动创建）
- 使用 SQLite，无需额外配置

### API 端点
- 后端服务：`http://localhost:3001/api`
- 前端代理：通过 Vite 代理到后端

## 📄 许可证

MIT License

## 👨‍💻 作者

星辰早晨开发团队

---

**注意**：首次使用请先注册账号，然后创建家庭并添加孩子。建议立即修改默认PIN码以确保安全。
