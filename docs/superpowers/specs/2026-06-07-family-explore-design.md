# 家庭探索功能设计

## 目标

家庭探索用于记录孩子去过、想去和计划去的地点或活动，帮助孩子增长见识、练习表达、建立勇气和自信。它不是任务系统，也不是金币系统；核心价值是把“读万卷书，行万里路”的经历沉淀成成长足迹。

第一版采用“家长发现地点，孩子自主打卡，家长确认补充”的模式。不做实时定位，不追踪孩子位置，不给金币。

## 非目标

- 不做实时定位或后台轨迹记录。
- 不强制到达地点才能打卡。
- 不自动抓取复杂的活动排期。
- 不把探索打卡转成普通任务审核。
- 不用探索行为发金币或游戏票。

## 信息来源

第一版支持两种来源：

1. 家长手动添加地点。
2. 家长端通过高德 Web 服务 POI 搜索地点，一键加入本地探索清单。

高德 Key 只放在后端环境变量 `AMAP_WEB_SERVICE_KEY` 中。前端不直接暴露 Web 服务 Key。没有 Key 时，搜索入口显示配置提示，但手动添加仍可使用。

## 导航影响

孩子端底部导航调整为五个入口：

- 挑战
- 早餐
- 探索
- 奖励
- 我的

新增 `/child/explore`。探索成为独立入口，因为它是独立成长场景，不适合只藏在“我的”里。

家长端首页新增“家庭探索”入口，路由为 `/parent/explore`。

“我的”页面只展示探索足迹摘要和最近记录，不做主操作入口，避免和探索页重复。

## 家长端功能

家长端页面：`ParentExplore`

功能：

- 搜索地点：城市、关键词、分类。
- 查看高德搜索结果。
- 一键加入探索清单。
- 手动添加地点。
- 编辑地点内容。
- 归档或删除未打卡地点。
- 查看孩子打卡记录。
- 家长确认打卡，补充一句观察或鼓励。

地点字段：

- 名称
- 分类：博物馆、自然、公园、城市、活动、旅行、运动体验、公益体验、其他
- 地址
- 城市
- 经纬度，可为空
- 来源：手动、高德
- 外部 POI ID，可为空
- 简介
- 为什么值得去
- 可以观察什么
- 可以问什么问题
- 推荐年龄或标签
- 状态：想去、计划中、已去过、归档

## 孩子端功能

孩子端页面：`ChildExplore`

功能：

- 查看探索清单。
- 按分类筛选。
- 打开地点详情。
- 自主打卡。
- 填写文字留言。
- 录制语音留言，最多 60 秒。
- 上传照片纪念，最多 3 张。
- 选择心情：开心、好奇、勇敢、惊喜、有点累。
- 查看自己的探索足迹。

地点详情展示：

- 地点名称和分类
- 地址
- 简短介绍
- 为什么值得去
- 可以观察什么
- 可以问什么问题
- 家长备注
- 已打卡状态

## 上传和存储

第一版新增本地上传能力，文件保存在服务器项目下：

`uploads/explore`

限制：

- 图片最多 3 张。
- 单张图片最大 2 MB。
- 语音最多 60 秒。
- 单条语音最大 5 MB。
- 数据库只保存文件路径、类型和元信息。

部署注意：

- `uploads/explore` 需要加入服务器备份范围。
- 增量代码包不包含上传文件。

## 数据库设计

新增表：`explore_places`

- `id`
- `familyId`
- `title`
- `category`
- `city`
- `address`
- `latitude`
- `longitude`
- `source`
- `externalId`
- `summary`
- `whyGo`
- `observeTips`
- `questionPrompts`
- `tags`
- `status`
- `createdBy`
- `createdAt`
- `updatedAt`

新增表：`explore_checkins`

- `id`
- `familyId`
- `placeId`
- `childId`
- `mood`
- `note`
- `checkedInAt`
- `parentConfirmed`
- `parentNote`
- `confirmedAt`
- `createdAt`
- `updatedAt`

新增表：`explore_media`

- `id`
- `familyId`
- `checkinId`
- `childId`
- `type`
- `filePath`
- `mimeType`
- `sizeBytes`
- `durationSeconds`
- `createdAt`

迁移必须幂等，不影响旧数据库启动。

## 后端接口

家长端：

- `GET /api/parent/explore/search`
- `GET /api/parent/explore/places`
- `POST /api/parent/explore/places`
- `PUT /api/parent/explore/places/:id`
- `DELETE /api/parent/explore/places/:id`
- `GET /api/parent/explore/checkins`
- `POST /api/parent/explore/checkins/:id/confirm`

孩子端：

- `GET /api/child/explore/places`
- `GET /api/child/explore/places/:id`
- `GET /api/child/explore/checkins`
- `POST /api/child/explore/checkins`
- `POST /api/child/explore/checkins/:id/media`

所有接口必须使用现有鉴权。孩子只能访问自己家庭的数据；上传接口必须校验文件类型、大小和归属。

## 成就设计

新增成就分类：探索。

新增条件类型：

- `explore_checkin_count`
- `explore_category_count`
- `explore_media_count`
- `explore_voice_count`
- `explore_confirmed_count`

默认模板：

- 初次出发：完成 1 次探索打卡。
- 博物初见：打卡 1 个博物馆。
- 自然观察员：打卡 3 个自然或公园地点。
- 城市小旅人：打卡 3 个城市地点。
- 勇敢表达：留下 1 条语音留言。
- 小小记录家：上传 3 次照片纪念。
- 见识在路上：完成 5 次探索。
- 行路少年：完成 10 次探索。
- 好奇提问者：家长确认一次主动提问或认真观察。
- 亲子探索家：完成 3 次家长确认的探索。

探索成就默认不发金币。奖励建议使用成就徽章、称号、成长记录或少量经验。

## UI 原则

- 孩子端要轻，打卡流程控制在一屏半以内。
- 家长端要清楚，搜索、添加、编辑、查看打卡分区明确。
- 不使用地图作为第一屏核心，先以列表和详情为主。
- 文字要鼓励探索，不制造压力。
- 打卡是记录经历，不是完成作业。

## 错误处理

- 未配置高德 Key：显示“可手动添加地点”，搜索按钮不可用或提示配置。
- 高德搜索失败：保留手动添加入口。
- 上传失败：不丢失文字留言，提示重新上传媒体。
- 文件超限：提示大小或数量限制。
- 重复打卡：允许同一地点多次打卡，但列表要显示最近一次记录。

## 验证计划

- 后端 `npm run build`
- 前端 `npm run lint`
- 前端 `npm run build`
- 新库初始化迁移验证
- 旧库迁移验证
- 无高德 Key 时手动添加可用
- 有高德 Key 时搜索接口可用
- 孩子端打卡、文字、照片、语音保存验证
- 家长端确认记录验证
- 探索成就触发验证
- 上传文件大小和路径安全检查

## 第一版完成标准

- 家长能手动添加探索地点。
- 配置高德 Key 后，家长能搜索并导入地点。
- 孩子能看到探索入口和地点列表。
- 孩子能查看详情并提交打卡。
- 打卡支持文字、心情、照片和语音。
- 家长能查看并确认打卡。
- 探索成就能自动计算并在现有成就系统中展示。
- 不影响现有挑战、早餐、奖励、我的、金币、游戏票和宝箱流程。
