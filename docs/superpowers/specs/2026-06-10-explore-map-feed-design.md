# 探索 2.0 设计方案：地图打卡 + 发现资讯

> 状态：待用户确认关键决策（见文末）。确认后分三期实施。
> 原则继承 P5：不发金币、不派任务、记录体验和成长；孩子主导，家长观察。

---

## 一、产品形态总览

探索模块从"地点清单"升级为两个 Tab：

**「地图」**——真实地图（高德），地点以标记呈现。点标记弹出卡片：照片、介绍、这里有什么、观察提示。孩子到了现场就打卡：拍照/语音/文字/短视频。去过的地方变成绿色徽章，地图逐渐被"点亮"——这本身就是 ADHD 友好的进度可视化：我的城市探索版图。

**「发现」**——每日更新的资讯流（每天最多 3 条，防选择过载）：推荐地点卡、节日活动卡、家长推荐卡。孩子点"想去"，地点自动落到地图上变成蓝色标记。

家长端角色转变：从"管理地点"退到"观察统计 + 资讯源配置"。已有的回忆时间线、确认回应保留；地点管理保留但弱化（孩子也能从发现页自己加"想去"）。

---

## 二、孩子端 UI 设计

### 地图 Tab（默认）
- 全屏地图（高德 JS SDK），底部留出导航栏安全区
- 标记三色体系：🔵 想去（wishlist/planned）｜🟢 去过（visited，显示打卡次数角标）｜🟠 本周推荐（来自发现页，7 天后自动消失）
- 右下角悬浮按钮「回到我的城市」（定位到家庭城市中心，非孩子实时位置）
- 点标记 → 底部抽屉（BottomSheet，复用现有组件）：
  - 照片轮播（历史打卡照片 + 介绍图）
  - 名称/分类/简介/为什么值得去（现有字段）
  - 「我到啦，打卡！」大按钮（单一主行动，P3）
  - 折叠区：观察提示、问题引导、历史打卡记录
- 打卡流程（一屏完成）：选 1-3 张照片（自动压缩）→ 可选语音（≤60s）或短视频（≤30s）→ 可选一句话留言 → 提交 → 彩带 + 成就进度即时反馈
- 顶部小入口「列表模式」保留现有清单视图（弱网/老设备兜底）

### 发现 Tab
- 信息流卡片，每日 7:00 更新，最多 3 张新卡（家长可调 1-5）
- 卡片类型：
  - 📍 推荐地点：图 + 名称 + 距离（"离家约 3km"）+ 一句话推荐语 + 分类标签
  - 🎈 节日主题：基于日历的本地规则（周末/寒暑假/儿童节/中秋…）推荐应景分类
  - ❤️ 爸爸妈妈推荐：家长在后台手动推的卡（置顶，带"爸爸说：…"）
- 卡片操作仅两个：「想去」（落地图）｜「下次再说」（划走，不再出现）
- 空状态："今天的推荐看完啦，去地图看看哪里还没点亮？"

---

## 三、资讯系统设计（你问的核心问题）

### 资讯类型怎么选
v1 做**确定可行**的三类：
1. **景区/场馆类 POI**（博物馆、公园、科技馆、动物园、植物园、图书馆、美术馆）——高德 POI 搜索 API 有稳定数据，免费配额个人版足够（每日 5000 次，我们每天每家庭只需几次）
2. **节日/季节主题**——不依赖外部 API，本地规则表（节气、节假日、周末）+ 分类映射（"清明→踏青公园"），零成本零风险
3. **家长推荐**——家长手动推送，补"演出/活动"的缺口

**演出/活动类（大麦、猫眼那种）v1 不做**，原因要跟你说透：国内没有免费开放的演出/活动 API，爬虫方案违反平台条款且极易失效，不适合一个家庭应用的可维护性。v2 可选方案：家长粘贴活动链接 → 后端抓取标题/图片生成卡片（仅解析公开 meta 信息，工作量小且稳定）。

### 每日更新机制
- 后端定时任务，每天北京时间 6:30 跑一次（复用现有 backup 调度器模式，无需新依赖）
- 流程：对每个配置了城市的家庭 → 按"分类轮换表"取当天分类（周一博物馆、周二公园…可配）→ 调高德 POI 搜索（城市 + 分类 + 按评分排序）→ 去重（排除已在地图上的、已推荐过的、已"下次再说"的）→ 取前 N 条写入 feed 表
- 不实时、不推送通知（单设备场景，孩子打开应用自然看到；红点提示新卡片数即可）
- 高德 key 用现有的 `AMAP_WEB_SERVICE_KEY`（服务端调用，不暴露）；未配置 key 的家庭只出节日卡和家长卡，功能降级不报错

---

## 四、后端设计

### 数据库（全部幂等迁移，只增不改）

```
explore_feed_items（新表）
  id TEXT PK, familyId TEXT, type TEXT(poi/festival/parent),
  title, summary, imageUrl, category,
  lat REAL, lng REAL, amapPoiId TEXT,
  status TEXT(new/wanted/dismissed) DEFAULT 'new',
  recommendDate TEXT,  -- 北京时间日期，每日去重用
  createdAt DATETIME
  索引：(familyId, status), (familyId, recommendDate), (familyId, amapPoiId)

explore_places 增列：
  lat REAL, lng REAL（已有则跳过）, sourceFeedId TEXT（从哪条资讯来）

explore_checkins 增列：
  lat REAL, lng REAL, distanceMeters INTEGER（单次定位验证用，可空）

families 增列：
  exploreCity TEXT, exploreFeedDailyLimit INTEGER DEFAULT 3,
  exploreFeedCategories TEXT（JSON数组）, exploreGeoVerify INTEGER DEFAULT 0
```

### 新端点（kebab-case，全部 protect + family 隔离）
```
GET  /api/child/explore/feed              今日+未处理的资讯卡
POST /api/child/explore/feed/:id/want     想去 → 创建 explore_place(wishlist) 并关联
POST /api/child/explore/feed/:id/dismiss  下次再说
GET  /api/child/explore/map-places        地图标记数据（含状态色、打卡数）
POST /api/parent/explore/feed/push        家长推荐卡
GET/PUT /api/parent/explore/feed-settings 城市/每日条数/分类轮换
GET  /api/parent/explore/stats            观察统计（月打卡数、分类分布、点亮地点数）
```

### 定时任务
`startExploreFeedScheduler()`：启动时 + 每日 6:30（北京时间，用现有 getBeijingDate 工具计算下次触发），逐家庭生成。失败记日志不退出（Rule 12：错误要响，但单家庭失败不影响其他家庭）。

### 地图 Provider 抽象（P4 国际化预留）
```ts
interface MapSearchProvider {
  searchPoi(city, category, page): Promise<PoiResult[]>
}
// AmapProvider 实现；环境变量 MAP_PROVIDER 切换，Google Places 留接口
```
前端地图组件同样包一层 `<ExploreMap>`，内部按 env 加载高德 JS SDK（v2 可换 Google Maps JS）。高德 JS key（前端用）与 Web 服务 key（后端用）是两个 key，都要在高德控制台申请，前端 key 配安全域名。

---

## 五、媒体：短视频方案

- 录制：MediaRecorder（探索模块已有语音录制兼容性处理，视频同路径），前端硬限制 30 秒自动停
- 上传：**改用 multipart**（新增 multer 依赖）而非 base64——30s 视频约 5-15MB，base64 膨胀 33% 会顶到 20MB body 上限，且这也是移动端化路上迟早要做的改造。语音/图片暂保持 base64 不动（向后兼容），视频走新端点
- 限制：单视频 ≤ 20MB，MIME 白名单 video/mp4、video/webm + magic bytes 校验（ftyp/EBML，复用现有校验函数扩展）
- 配额：家庭总配额从 500MB 提到 1GB（视频很占空间），配额面板已有可视化
- iOS 注意：Safari 的 MediaRecorder 视频输出是 mp4（需探测 mimeType，复用现有探测逻辑）

---

## 六、与现有规则的冲突裁决（Rule 7：暴露不平均）

**P5 写明"不做实时定位、不获取 GPS 权限"，而地图打卡天然涉及位置。** 裁决建议：

- 保持"**不追踪**"底线不变：绝不后台定位、绝不记录轨迹
- 新增概念"**单次打卡定位**"：仅在孩子按下打卡按钮那一刻取一次坐标，算出与地点的距离存档（distanceMeters），立即丢弃原始坐标外的信息
- 默认**关闭**，家长设置里可开「打卡时核对位置」开关（exploreGeoVerify）；开了之后距离 >500m 仍允许打卡，只是标记"远程打卡"——不阻止，避免孩子在信号差的景区里挫败
- P5 规则文本需要你确认后更新为："不做实时定位与轨迹追踪；可选的单次打卡定位由家长开关控制"

---

## 七、分期实施

| 期 | 内容 | 规模 |
|---|---|---|
| **一期：地图** | 高德 JS 地图 Tab、三色标记、地点抽屉、打卡流程接现有接口、列表模式保留 | 前端为主，后端只加 lat/lng 列和 map-places 端点 |
| **二期：发现** | feed 表+定时任务+POI 推荐+节日规则+家长推荐+发现 Tab UI+家长统计页 | 前后端各半 |
| **三期：视频** | multer multipart、视频录制/播放、配额扩容 | 后端为主 |

一期不依赖二三期，先让"地图被点亮"的感觉跑起来。每期照旧：独立提交、tsc+构建+端到端验证、出增量包。

## 八、待你确认的决策

1. 单次打卡定位：按"默认关、家长可开、不阻止打卡"做？
2. 资讯 v1 范围：POI 推荐 + 节日卡 + 家长推荐（演出活动放 v2 链接解析）？
3. 短视频放三期还是提前？
4. 高德 key：需要你在高德开放平台申请两个 key（JS API + Web服务），免费个人版即可——还是先用"无 key 降级模式"开发？
