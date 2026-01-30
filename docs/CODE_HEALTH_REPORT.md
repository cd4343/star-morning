# 前端代码健康检查报告

**检查日期**: 2026-01-30  
**检查文件**:
1. `frontend/src/App.tsx` - 路由配置
2. `frontend/src/contexts/AuthContext.tsx` - 认证上下文
3. `frontend/src/services/api.ts` - API 服务

---

## 🔴 严重问题 (Critical)

### 1. API 拦截器与 AuthContext 状态不同步
**文件**: `frontend/src/services/api.ts`  
**行号**: 41-46  
**问题描述**: 当 API 返回 401 时，拦截器直接清除 localStorage 并跳转登录页，但没有通知 AuthContext 更新状态。这可能导致：
- React 组件状态与 localStorage 不一致
- 用户界面可能仍显示已登录状态
- 可能导致内存泄漏（组件未正确卸载）

**建议修复**:
```typescript
// 在 api.ts 中，需要通知 AuthContext 更新状态
// 或者使用事件机制通知 AuthContext
```

**严重程度**: 🔴 Critical

---

### 2. 缺少 Token 刷新机制
**文件**: `frontend/src/contexts/AuthContext.tsx`, `frontend/src/services/api.ts`  
**行号**: AuthContext.tsx:40-73, api.ts:41-46  
**问题描述**: 
- Token 过期后直接要求用户重新登录，没有自动刷新机制
- 用户体验差，需要频繁登录
- 没有处理 token 即将过期的情况

**建议修复**: 实现 refresh token 机制或 token 自动续期

**严重程度**: 🔴 Critical

---

### 3. 类型安全性不足
**文件**: `frontend/src/services/api.ts`  
**行号**: 27, 31  
**问题描述**: 
- 使用 `any` 类型 (`config as any`, `error.response?.data as any`)
- 缺少错误响应的类型定义
- 可能导致运行时错误

**建议修复**: 定义明确的类型接口

**严重程度**: 🔴 Critical

---

## 🟡 中等问题 (High)

### 4. 缺少 404 路由处理
**文件**: `frontend/src/App.tsx`  
**行号**: 64-87  
**问题描述**: 路由配置中没有 404 页面或 catch-all 路由，用户访问不存在的路径时可能看到空白页面

**建议修复**: 添加 `<Route path="*" element={<NotFound />} />`

**严重程度**: 🟡 High

---

### 5. ProtectedRoute 未处理加载状态
**文件**: `frontend/src/App.tsx`  
**行号**: 32-36  
**问题描述**: `ProtectedRoute` 组件没有考虑 `isLoading` 状态，在 token 验证期间可能显示错误的页面

**建议修复**:
```typescript
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <PageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
};
```

**严重程度**: 🟡 High

---

### 6. Token 验证超时错误被忽略
**文件**: `frontend/src/contexts/AuthContext.tsx`  
**行号**: 60-68  
**问题描述**: Token 验证时，如果请求超时（8秒），错误被忽略，可能导致无效 token 继续使用

**建议修复**: 区分网络错误和认证错误，对超时进行适当处理

**严重程度**: 🟡 High

---

### 7. 缺少网络错误处理
**文件**: `frontend/src/services/api.ts`  
**行号**: 24-72  
**问题描述**: 
- 没有检测离线状态
- 网络错误时没有用户友好的提示
- 重试逻辑只针对特定状态码，网络错误可能被忽略

**建议修复**: 添加网络状态检测和统一的错误处理

**严重程度**: 🟡 High

---

### 8. JSON.parse 缺少错误处理
**文件**: `frontend/src/contexts/AuthContext.tsx`  
**行号**: 32  
**问题描述**: `localStorage.getItem('user')` 的 JSON.parse 没有 try-catch，如果存储的数据损坏可能导致应用崩溃

**建议修复**:
```typescript
const storedUser = localStorage.getItem('user');
try {
  return storedUser ? JSON.parse(storedUser) : null;
} catch {
  localStorage.removeItem('user');
  return null;
}
```

**严重程度**: 🟡 High

---

### 9. updateUser 缺少空值检查
**文件**: `frontend/src/contexts/AuthContext.tsx`  
**行号**: 91-96  
**问题描述**: `updateUser` 函数虽然检查了 `user` 是否存在，但如果 `user` 为 null，函数静默返回，没有错误提示

**建议修复**: 添加错误提示或日志

**严重程度**: 🟡 High

---

## 🟢 低优先级问题 (Medium)

### 10. 生产环境控制台日志
**文件**: `frontend/src/services/api.ts`  
**行号**: 34-38, 42  
**问题描述**: 错误信息直接打印到 console，生产环境应该移除或使用日志服务

**建议修复**: 使用环境变量控制日志输出，或集成日志服务

**严重程度**: 🟢 Medium

---

### 11. 缺少请求取消机制
**文件**: `frontend/src/services/api.ts`  
**行号**: 3-9  
**问题描述**: 没有使用 AbortController 实现请求取消，组件卸载时可能继续处理响应

**建议修复**: 在组件中使用 AbortController 取消请求

**严重程度**: 🟢 Medium

---

### 12. 重试逻辑可能阻塞
**文件**: `frontend/src/services/api.ts`  
**行号**: 64-65  
**问题描述**: 重试延迟使用同步 `setTimeout`，虽然不会阻塞事件循环，但可能影响用户体验

**建议修复**: 考虑使用指数退避和最大重试限制

**严重程度**: 🟢 Medium

---

### 13. SmartEntry 直接访问 localStorage
**文件**: `frontend/src/App.tsx`  
**行号**: 47  
**问题描述**: 组件直接访问 localStorage，没有错误处理，如果 localStorage 不可用（某些隐私模式）可能导致错误

**建议修复**: 添加 try-catch 或使用工具函数

**严重程度**: 🟢 Medium

---

### 14. 缺少基于角色的路由保护
**文件**: `frontend/src/App.tsx`  
**行号**: 72-86  
**问题描述**: 没有检查用户角色（parent/child），parent 用户可以访问 child 路由，反之亦然

**建议修复**: 添加角色检查的路由保护组件

**严重程度**: 🟢 Medium

---

### 15. Token 存储在 localStorage 的安全风险
**文件**: `frontend/src/contexts/AuthContext.tsx`  
**行号**: 29, 76  
**问题描述**: Token 存储在 localStorage，存在 XSS 攻击风险。虽然这是常见做法，但应该考虑使用 httpOnly cookie（需要后端支持）

**建议修复**: 考虑使用更安全的存储方式，或加强 XSS 防护

**严重程度**: 🟢 Medium (安全最佳实践)

---

## 📊 问题统计

- 🔴 **严重问题**: 3 个
- 🟡 **中等问题**: 6 个
- 🟢 **低优先级问题**: 6 个
- **总计**: 15 个问题

---

## 🎯 优先修复建议

### 立即修复（本周内）:
1. API 拦截器与 AuthContext 状态同步问题
2. 添加类型定义，移除 any
3. 添加 404 路由处理
4. ProtectedRoute 加载状态处理

### 短期修复（本月内）:
5. Token 刷新机制
6. 网络错误处理
7. JSON.parse 错误处理
8. updateUser 空值检查

### 长期优化:
9. 请求取消机制
10. 基于角色的路由保护
11. 生产环境日志管理
12. Token 存储安全优化

---

## ✅ 代码优点

1. ✅ 使用了懒加载减少首屏体积
2. ✅ 有基本的错误重试机制
3. ✅ 使用了 TypeScript（虽然类型定义不够完善）
4. ✅ 有基本的 token 验证逻辑
5. ✅ 路由结构清晰，有保护路由机制

---

## 📋 更新记录 (2026-01-30)

### 已修复的问题

| 编号 | 问题 | 状态 |
|------|------|------|
| #4 | 缺少 404 路由处理 | ✅ 已修复 - 添加 NotFound 组件 |
| #8 | JSON.parse 缺少错误处理 | ✅ 已修复 - AuthContext.tsx |
| - | useEffect 依赖数组不完整 | ✅ 已修复 - ChildTasks/Wishes/Me/Layout |
| - | 错误处理使用 alert 而非 Toast | ✅ 已修复 - 改用 useToast |
| - | ChildLayout 递归调用无限制 | ✅ 已修复 - 添加 MAX_RETRIES |

### 新增优化

| 项目 | 说明 |
|------|------|
| 数据库索引 | 20+ 高频查询字段添加索引 |
| 抽奖逻辑重构 | 抽取 `drawPrizeCore` 函数 |
| 事务封装 | 新增 `withTransaction` 函数 |
| Modal 可访问性 | 添加 ARIA 属性、ESC 关闭 |
| Toast 优化 | ID 唯一性、最大数量限制 |
| BottomSheet 可访问性 | ARIA 属性、焦点管理 |
| ConfirmDialog 可访问性 | alertdialog 角色、ESC 关闭 |
| API 服务 | 类型定义、网络错误检测 |

### 目录整理

- 文档移入 `docs/` 目录
- 脚本移入 `scripts/` 目录
- 数据库工具移入 `scripts/db-tools/` 目录
- 创建 `_archive/` 归档目录
