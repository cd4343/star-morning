# Star Coin v1.0.4 发布说明

日期：2026-05-13

## 本次修复

- 孩子端倒计时弹窗改为按孩子端真实可见区域定位，不再按整个浏览器窗口居中。
- 正在进行任务悬浮窗改为 portal 渲染，避免被下拉刷新容器的 `transform` 影响。
- 行为警示弹窗改为按孩子端可见区域居中显示。
- 任务详情、宝箱、行为警示、倒计时弹窗统一避开滚动容器裁剪问题。
- 悬浮任务面板的默认位置、拖动边界和宽度按孩子端内容区计算，避免跑出屏幕或遮挡底部导航。

## 技术原因

孩子端任务页被 `PullToRefresh` 包裹，内容层始终带有 `transform: translateY(...)`。浏览器会让 `position: fixed` 的子元素以这个 transformed ancestor 作为参照，导致弹窗和悬浮窗不再真正固定在可见屏幕上。

本版本把关键弹层渲染到 `document.body`，并通过 `data-child-main-viewport` / `data-child-app-frame` 计算孩子端实际可见区域。

## 上线影响

- 仅前端变更。
- 不需要数据库迁移。
- 不会影响服务器已有数据。

## 已验证

- `frontend` 执行 `npm run build` 通过。
