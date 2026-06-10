# Star Coin 增量修复方案

> **原则**：最小化、增量式、可独立回溯、不破坏已部署功能  
> **目标**：安卓+iOS 端上线，探索打卡支持全球覆盖，架构预留国际化扩展  
> **基准版本**：v1.1.3 + 家庭探索增量包  
> **编制日期**：2026-06-09

---

## 修复总览

按优先级分为 5 个迭代批次，每批次内的修改项可独立提交和回滚：

| 批次 | 名称 | 周期 | 修改项数 | 核心目标 |
|------|------|------|---------|---------|
| B1 | 安全止血 | 第1周 | 6 | 消除生产环境安全隐患，零功能变更 |
| B2 | 探索加固 | 第2周 | 8 | 补齐探索功能缺失项，为全球覆盖打基础 |
| B3 | 移动端适配 | 第3-4周 | 7 | 解决 iOS/Android 兼容性，PWA 就绪 |
| B4 | 代码减负 | 第5-8周 | 9 | 架构拆分、状态管理、测试引入 |
| B5 | 国际化与上线 | 第9-12周 | 6 | i18n 框架、移动端打包、上线准备 |

---

## B1：安全止血（第1周）

> **零功能变更，仅消除安全隐患和稳定性问题**

---

### B1-1 JWT Secret 强制校验

**问题**：生产环境 JWT Secret 硬编码为默认值，虽有启动警告但仍可运行  
**风险等级**：🔴 严重  
**改动范围**：`backend/src/server.ts` 第18-23行

**当前代码**：
```ts
const JWT_SECRET = process.env.JWT_SECRET || 'stellar-system-dev-secret-change-in-production';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.warn('⚠️ 生产环境未设置 JWT_SECRET...');
}
```

**修复方案**：
```ts
const JWT_SECRET = process.env.JWT_SECRET || 'stellar-system-dev-secret-change-in-production';
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.JWT_SECRET) {
  console.error('❌ 生产环境必须设置 JWT_SECRET 环境变量！服务拒绝启动。');
  process.exit(1);
}
```

**验证方式**：不设 `JWT_SECRET` 环境变量时生产模式应拒绝启动  
**回滚方式**：恢复原始 warn 逻辑  
**移动端影响**：无（后端变更）

---

### B1-2 uncaughtException 处理修正

**问题**：`uncaughtException` 只打印不退出，可能导致内存泄漏和不可预测行为  
**风险等级**：🟡 中  
**改动范围**：`backend/src/server.ts` 第7189行附近

**修复方案**：
```ts
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception - 进程将退出:', err);
  // 给日志输出 1 秒时间后退出，配合 PM2 自动重启
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  setTimeout(() => process.exit(1), 1000);
});
```

**验证方式**：故意抛出未捕获异常，确认进程退出且 PM2 重启  
**回滚方式**：恢复原始 `console.error` 不退出逻辑

---

### B1-3 CORS 收紧

**问题**：开发环境 `cors()` 无 origin 限制，生产环境仅依赖 `CORS_ORIGIN`  
**风险等级**：🟡 中  
**改动范围**：`backend/src/server.ts` 第29行

**修复方案**：
```ts
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors(corsOrigin
  ? { origin: corsOrigin.split(',').map(o => o.trim()), credentials: true }
  : isProduction
    ? { origin: false }  // 生产环境未配置则拒绝跨域
    : { origin: true, credentials: true }  // 开发环境允许
));
```

**验证方式**：生产环境未设 `CORS_ORIGIN` 时跨域请求应被拒绝  
**回滚方式**：恢复原始 `cors(corsOrigin ? ... : undefined)`

---

### B1-4 探索表添加索引

**问题**：`explore_places`、`explore_checkins`、`explore_media` 缺少关键索引  
**风险等级**：🟡 中（数据增长后查询变慢）  
**改动范围**：`backend/src/database.ts` 第115行后（explore_media 建表之后）

**修复方案**：在 `createTables()` 末尾追加索引创建：
```ts
// 探索表索引（幂等）
try { await db.run('CREATE INDEX IF NOT EXISTS idx_explore_places_family ON explore_places(familyId)'); } catch (e) {}
try { await db.run('CREATE INDEX IF NOT EXISTS idx_explore_places_status ON explore_places(familyId, status)'); } catch (e) {}
try { await db.run('CREATE INDEX IF NOT EXISTS idx_explore_checkins_family ON explore_checkins(familyId)'); } catch (e) {}
try { await db.run('CREATE INDEX IF NOT EXISTS idx_explore_checkins_child ON explore_checkins(familyId, childId)'); } catch (e) {}
try { await db.run('CREATE INDEX IF NOT EXISTS idx_explore_checkins_place ON explore_checkins(placeId)'); } catch (e) {}
try { await db.run('CREATE INDEX IF NOT EXISTS idx_explore_media_checkin ON explore_media(checkinId)'); } catch (e) {}
```

**验证方式**：`EXPLAIN QUERY PLAN` 确认查询使用索引  
**回滚方式**：删除索引创建行（索引存在不影响功能）

---

### B1-5 媒体上传路径校验

**问题**：探索媒体上传时 `familyId`/`childId` 来自请求参数，未与 JWT token 校验  
**风险等级**：🟡 中  
**改动范围**：`backend/src/server.ts` 中 `POST /api/child/explore/checkins` 和 `POST /api/child/explore/checkins/:id/media` 路由

**修复方案**：在路由处理器开头添加校验：
```ts
// 校验 childId 与当前用户一致
if (req.user?.id !== req.body.childId && req.user?.id !== req.params.childId) {
  return res.status(403).json({ message: '无权操作其他孩子的数据' });
}
// 校验 familyId 与用户家庭一致
const userFamily = await getDb().get('SELECT familyId FROM users WHERE id = ?', req.user.id);
if (userFamily?.familyId !== req.body.familyId) {
  return res.status(403).json({ message: '无权操作其他家庭的数据' });
}
```

**验证方式**：伪造不同 childId/familyId 的请求应返回 403  
**回滚方式**：移除校验代码

---

### B1-6 媒体上传配额限制

**问题**：无总存储配额，恶意上传可耗尽磁盘  
**风险等级**：🟡 中  
**改动范围**：`backend/src/server.ts` 中 `saveExploreMediaFile` 函数或其调用处

**修复方案**：上传前检查家庭配额：
```ts
const FAMILY_UPLOAD_QUOTA_MB = 500; // 每家庭 500MB

async function checkFamilyUploadQuota(familyId: string): Promise<boolean> {
  const row = await getDb().get(
    'SELECT COALESCE(SUM(sizeBytes), 0) as totalBytes FROM explore_media WHERE familyId = ?',
    familyId
  );
  const usedMB = (row?.totalBytes || 0) / (1024 * 1024);
  return usedMB < FAMILY_UPLOAD_QUOTA_MB;
}

// 在 POST /api/child/explore/checkins/:id/media 路由中
const quotaOk = await checkFamilyUploadQuota(familyId);
if (!quotaOk) {
  return res.status(429).json({ message: '家庭探索存储空间已满，请联系家长清理' });
}
```

**验证方式**：上传超过 500MB 后应返回 429  
**回滚方式**：移除配额检查

---

## B2：探索加固（第2周）

> **补齐探索功能产品缺失项，为全球覆盖和移动端打基础**

---

### B2-1 前端类型定义去重

**问题**：`ExplorePlace`/`ExploreCheckin` 在 `ChildExplore.tsx` 和 `ParentExplore.tsx` 中重复定义  
**风险等级**：🟢 低（代码质量）  
**改动范围**：新建 `frontend/src/types/explore.ts`，修改两个页面文件

**修复方案**：

1. 新建 `frontend/src/types/explore.ts`：
```ts
export type ExplorePlace = {
  id: string;
  title: string;
  category: string;
  city?: string;
  address?: string;
  summary?: string;
  whyGo?: string;
  observeTips?: string;
  questionPrompts?: string;
  tags?: string;
  status: string;
  checkinCount?: number;
  lastCheckedInAt?: string;
  latitude?: number;
  longitude?: number;
  source?: string;
  externalId?: string;
};

export type ExploreCheckin = {
  id: string;
  placeId: string;
  placeTitle: string;
  placeCategory: string;
  mood: string;
  note?: string;
  checkedInAt: string;
  parentConfirmed?: number;
  mediaCount?: number;
};

export type ExploreMedium = {
  id: string;
  checkinId: string;
  type: 'image' | 'audio';
  filePath: string;
  mimeType?: string;
  sizeBytes?: number;
  durationSeconds?: number;
};

export const EXPLORE_CATEGORIES = ['all', '博物馆', '自然', '公园', '城市', '活动', '旅行', '运动体验', '公益体验', '其他'] as const;
export const EXPLORE_MOODS = ['好奇', '开心', '勇敢', '惊喜', '有点累'] as const;
```

2. `ChildExplore.tsx` 和 `ParentExplore.tsx` 改为：
```ts
import { ExplorePlace, ExploreCheckin, EXPLORE_CATEGORIES, EXPLORE_MOODS } from '../../types/explore';
```
删除各文件内的重复类型定义和常量。

**验证方式**：`npm run build` 通过，探索页面功能不变  
**回滚方式**：恢复内联类型定义

---

### B2-2 探索功能：多孩子场景支持

**问题**：PRD 未明确多孩子场景，一个地点多个孩子都能打卡吗？  
**风险等级**：🔴 高（核心业务逻辑）  
**改动范围**：`backend/src/server.ts` 中探索路由，`frontend/src/pages/child/ChildExplore.tsx`

**修复方案**：

后端——确认 `explore_checkins` 已有 `childId` 字段，同一地点同一孩子可多次打卡（不同日期），同一地点不同孩子各自独立打卡。需在打卡接口增加同日重复检查：

```ts
// POST /api/child/explore/checkins 中
const existingToday = await getDb().get(
  `SELECT id FROM explore_checkins WHERE placeId = ? AND childId = ? AND date(checkedInAt) = date('now')`,
  [placeId, req.user.id]
);
if (existingToday) {
  return res.status(409).json({ message: '今天已经在这个地点打卡过了' });
}
```

前端——孩子端打卡记录显示该孩子自己的记录，不显示兄弟姐妹的。家长端确认页面列出每个孩子的打卡，支持逐个或批量确认。

**验证方式**：两个孩子对同一地点打卡，记录各自独立；同日重复打卡被拒绝  
**回滚方式**：移除同日检查逻辑

---

### B2-3 探索功能：地点软删除

**问题**：家长删除地点时已有打卡记录如何处理？当前是 CASCADE 删除  
**风险等级**：🟡 中  
**改动范围**：`backend/src/database.ts` 表定义 + `backend/src/server.ts` DELETE 路由

**修复方案**：

1. 为 `explore_places` 添加 `deletedAt` 字段（追加迁移）：
```ts
try { await db.run('ALTER TABLE explore_places ADD COLUMN deletedAt TEXT'); } catch (e) {}
```

2. 修改 DELETE 路由为软删除：
```ts
// DELETE /api/parent/explore/places/:id
app.delete('/api/parent/explore/places/:id', protect, async (req: AuthRequest, res) => {
  await getDb().run(
    'UPDATE explore_places SET deletedAt = datetime("now") WHERE id = ? AND familyId = ?',
    [req.params.id, req.user!.familyId]
  );
  res.json({ message: '地点已删除' });
});
```

3. 修改查询路由过滤已删除项：
```ts
// 在所有 SELECT 查询中增加 WHERE deletedAt IS NULL
```

4. 修改外键约束：`explore_checkins` 和 `explore_media` 对 `explore_places` 的外键改为 `ON DELETE SET NULL`（但实际不再物理删除，所以无影响）

**验证方式**：删除地点后打卡记录仍可见，孩子端不再显示已删除地点  
**回滚方式**：恢复物理删除 + CASCADE

---

### B2-4 探索功能：打卡流程简化

**问题**：打卡流程可能超过"一屏半"，文字+心情+照片+语音四项操作太多  
**风险等级**：🟡 中（UX）  
**改动范围**：`frontend/src/pages/child/ChildExplore.tsx` 打卡弹窗区域

**修复方案**：分步打卡——第一步只需选心情即可提交，第二步为可选补充（照片/语音/文字）：

```tsx
// 简化后的提交逻辑
const submitCheckin = async () => {
  if (!selected || !mood) return;  // 仅心情为必填
  setSaving(true);
  try {
    const res = await api.post('/child/explore/checkins', {
      placeId: selected.id, mood, note
    });
    toast.success('探索打卡已保存！');
    // 可选补充在打卡成功后触发
    if (photos.length > 0 || audioDataUrl) {
      setShowSupplement(true);  // 显示补充弹窗
    } else {
      setSelected(null);
    }
    await loadData();
    refresh?.();
  } catch (e: any) {
    toast.error(e.response?.data?.message || '打卡保存失败');
  } finally {
    setSaving(false);
  }
};
```

**验证方式**：仅选心情即可打卡成功，照片/语音/文字为可选补充  
**回滚方式**：恢复原始必填校验

---

### B2-5 探索功能：家长确认体验优化

**问题**：家长需逐个确认打卡，多孩子时负担重  
**风险等级**：🟡 中  
**改动范围**：`backend/src/server.ts` 新增批量确认路由，`frontend/src/pages/parent/ParentExplore.tsx`

**修复方案**：

1. 后端新增批量确认路由：
```ts
app.post('/api/parent/explore/checkins/batch-confirm', protect, async (req: AuthRequest, res) => {
  const { checkinIds } = req.body as { checkinIds: string[] };
  if (!Array.isArray(checkinIds) || checkinIds.length === 0) {
    return res.status(400).json({ message: '请选择要确认的打卡记录' });
  }
  const placeholders = checkinIds.map(() => '?').join(',');
  await getDb().run(
    `UPDATE explore_checkins SET parentConfirmed = 1, confirmedAt = datetime('now'), updatedAt = datetime('now')
     WHERE id IN (${placeholders}) AND familyId = ?`,
    [...checkinIds, req.user!.familyId]
  );
  // 触发成就检查
  for (const id of checkinIds) {
    const checkin = await getDb().get('SELECT childId, familyId FROM explore_checkins WHERE id = ?', id);
    if (checkin) await checkAndAwardAchievements(checkin.childId, checkin.familyId);
  }
  res.json({ message: '批量确认成功', count: checkinIds.length });
});
```

2. 前端家长端增加多选 + 批量确认按钮

**验证方式**：选择多条打卡记录，一键确认  
**回滚方式**：移除批量路由和前端多选 UI

---

### B2-6 数据库迁移版本化（轻量版）

**问题**：无迁移版本追踪，无法确认数据库当前状态  
**风险等级**：🟡 中  
**改动范围**：`backend/src/database.ts` 追加 `schema_versions` 表

**修复方案**：
```ts
// 在 createTables() 开头添加
await db.exec(`
  CREATE TABLE IF NOT EXISTS schema_versions (
    version TEXT PRIMARY KEY,
    appliedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    description TEXT
  )
`);

// 已有的迁移标记为已完成（幂等，仅插入不存在的）
const existingMigrations = [
  { version: '001', description: '初始表结构' },
  { version: '002', description: '用户扩展字段' },
  { version: '003', description: '学习闯关表' },
  { version: '004', description: '情绪/游戏票表' },
  { version: '005', description: '早餐/早晨表' },
  { version: '006', description: '探索表' },
  { version: '007', description: '探索索引' },
  { version: '008', description: '地点软删除' },
];
for (const m of existingMigrations) {
  await db.run(
    'INSERT OR IGNORE INTO schema_versions (version, description) VALUES (?, ?)',
    [m.version, m.description]
  );
}
```

**验证方式**：`SELECT * FROM schema_versions` 显示已执行的迁移  
**回滚方式**：删除 `schema_versions` 表和相关代码

---

### B2-7 临时目录清理规范

**问题**：`临时/` 目录 203MB，中文目录名跨平台有编码风险  
**风险等级**：🟡 中  
**改动范围**：文件系统操作 + `.gitignore`

**修复方案**：

1. 保留最新一个增量包作为回滚参考，删除其余旧包
2. 在 `.gitignore` 中添加：
```
临时/
temp/
deploy/
uploads/
*.db-shm
*.db-wal
```
3. 创建 `scripts/cleanup-temp.sh` 清理脚本（供手动执行）：
```bash
#!/bin/bash
# 保留最新一个增量包，删除其余
cd "$(dirname "$0")/.." || exit 1
TEMP_DIR="临时"
if [ -d "$TEMP_DIR" ]; then
  # 保留最新的 patch 包
  ls -1dt "$TEMP_DIR"/starcoin-incremental-patch-* 2>/dev/null | tail -n +2 | xargs rm -rf
  echo "清理完成，保留最新增量包"
fi
```

**验证方式**：`临时/` 目录只剩最新一个增量包  
**回滚方式**：从 Git 历史恢复（如已提交）

---

### B2-8 需求池同步更新

**问题**：需求池与代码多处不同步（导航口径、星图入口等）  
**风险等级**：🟢 低（文档）  
**改动范围**：`docs/REQUIREMENTS_BACKLOG.md`（如存在）或相关 PRD 文档

**修复方案**：更新以下条目：
- R-020：导航从 4 入口更新为 5 入口（挑战/早餐/探索/奖励/我的）
- P-010：星图入口已移除，挑战中心为主入口
- 标注所有 29 项功能为"待验证"状态
- 补充 P-018 家庭探索功能条目

**验证方式**：需求池与代码实现一致  
**回滚方式**：Git revert

---

## B3：移动端适配（第3-4周）

> **解决 iOS/Android 兼容性，为 App 上线做准备**

---

### B3-1 图片压缩和 EXIF 清除

**问题**：高像素手机拍照后可能超过 2MB 限制，EXIF 可能泄露位置隐私  
**风险等级**：🟡 中（移动端核心体验）  
**改动范围**：`frontend/src/pages/child/ChildExplore.tsx` + 新建 `frontend/src/utils/imageCompress.ts`

**修复方案**：

1. 新建 `frontend/src/utils/imageCompress.ts`：
```ts
interface CompressOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  maxSizeBytes?: number;
}

export async function compressImage(file: File, options: CompressOptions = {}): Promise<File> {
  const { maxWidth = 1920, maxHeight = 1920, quality = 0.8, maxSizeBytes = 2 * 1024 * 1024 } = options;
  
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      
      if (width > maxWidth) { height = (height * maxWidth) / width; width = maxWidth; }
      if (height > maxHeight) { width = (width * maxHeight) / height; height = maxHeight; }
      
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      
      canvas.toBlob(
        (blob) => {
          if (blob && blob.size <= maxSizeBytes) {
            resolve(new File([blob], file.name, { type: 'image/jpeg' }));
          } else if (quality > 0.3) {
            // 递归压缩
            compressImage(file, { ...options, quality: quality - 0.1 }).then(resolve);
          } else {
            resolve(new File([blob!], file.name, { type: 'image/jpeg' }));
          }
        },
        'image/jpeg',
        quality
      );
    };
    img.src = URL.createObjectURL(file);
  });
}
```

2. 在 `ChildExplore.tsx` 中使用：
```ts
import { compressImage } from '../../utils/imageCompress';

// onChange 处理
const handlePhotoSelect = async (files: FileList) => {
  const raw = Array.from(files).slice(0, 3);
  const compressed = await Promise.all(raw.map(f => compressImage(f)));
  setPhotos(compressed);
};
```

**验证方式**：拍照后图片自动压缩到 2MB 以内  
**回滚方式**：移除压缩逻辑，恢复直接使用原始文件

---

### B3-2 iOS 语音录制兼容

**问题**：iOS Safari 对 `MediaRecorder` 支持有限（14.5+，仅 `audio/mp4`）  
**风险等级**：🟡 中  
**改动范围**：`frontend/src/pages/child/ChildExplore.tsx` 录音逻辑

**修复方案**：

```ts
// 检测支持的 MIME 类型
function getSupportedMimeType(): string | null {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

const startRecording = async () => {
  try {
    const mimeType = getSupportedMimeType();
    if (!mimeType) {
      toast.warning('您的浏览器不支持录音功能，可以用文字或照片代替');
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType });
    // ... 其余逻辑不变
  } catch {
    toast.error('无法打开麦克风，请检查浏览器权限');
  }
};
```

**验证方式**：iOS Safari 上录音按钮点击后检测到 `audio/mp4` 并正常录制  
**回滚方式**：恢复原始硬编码 `audio/webm`

---

### B3-3 PWA 基础支持

**问题**：移动端 App 上线前需要 PWA 作为过渡方案  
**风险等级**：🟢 低（增量添加）  
**改动范围**：`frontend/public/` 添加 manifest + service worker + 图标

**修复方案**：

1. 新建 `frontend/public/manifest.json`：
```json
{
  "name": "星辰早晨",
  "short_name": "星辰",
  "description": "家庭成长激励系统",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#6366f1",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

2. `frontend/index.html` 添加：
```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#6366f1" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<link rel="apple-touch-icon" href="/icon-192.png" />
```

3. 后续在 `vite.config.ts` 中引入 `vite-plugin-pwa` 自动生成 service worker

**验证方式**：Chrome "添加到主屏幕" 出现星辰早晨图标  
**回滚方式**：删除 manifest 文件和 HTML 引用

---

### B3-4 安全区域和刘海屏适配

**问题**：部分页面在刘海屏/底部安全区域显示不完整  
**风险等级**：🟢 低  
**改动范围**：`frontend/src/components/Layout.tsx`，全局 CSS

**修复方案**：

在 `frontend/src/index.css` 或 Layout 组件中添加：
```css
/* 全局安全区域 */
:root {
  --safe-area-top: env(safe-area-inset-top, 0px);
  --safe-area-bottom: env(safe-area-inset-bottom, 0px);
  --safe-area-left: env(safe-area-inset-left, 0px);
  --safe-area-right: env(safe-area-inset-right, 0px);
}

/* 手机框内内容区 */
.phone-content {
  padding-top: var(--safe-area-top);
  padding-bottom: var(--safe-area-bottom);
  padding-left: var(--safe-area-left);
  padding-right: var(--safe-area-right);
}
```

**验证方式**：在 iPhone X+ 模拟器上验证内容不被刘海/底部遮挡  
**回滚方式**：移除 CSS 变量

---

### B3-5 审核后即时通知（前端轮询增强）

**问题**：审核等待是无反馈黑盒，ADHD 孩子不确定"做了什么会得到什么"  
**风险等级**：🟡 中（核心 UX）  
**改动范围**：`frontend/src/pages/child/ChildLayout.tsx`，`frontend/src/components/Toast.tsx`

**修复方案**：

1. 在 ChildLayout 中增加审核结果轮询（已有 30s 刷新机制的基础上）：
```ts
// 检测新审核结果
const lastCheckedReviewAt = useRef<string>('');

useEffect(() => {
  const checkReviewResults = async () => {
    try {
      const res = await api.get('/child/dashboard');
      const newApproved = res.data.recentReviews?.filter(
        (r: any) => r.status === 'approved' && r.reviewedAt > lastCheckedReviewAt.current
      );
      if (newApproved?.length > 0) {
        lastCheckedReviewAt.current = newApproved[0].reviewedAt;
        // 显示金币到账动画通知
        const totalCoins = newApproved.reduce((sum: number, r: any) => sum + (r.earnedCoins || 0), 0);
        toast.success(`🌟 审核通过！获得 ${totalCoins} 金币`, { duration: 5000 });
      }
    } catch {}
  };
  
  const interval = setInterval(checkReviewResults, 30000); // 30秒检查
  return () => clearInterval(interval);
}, []);
```

2. 后端 `/child/dashboard` 响应中增加 `recentReviews` 字段（最近24小时审核结果）

**验证方式**：家长审核通过后，孩子端30秒内弹出金币到账通知  
**回滚方式**：移除轮询逻辑

---

### B3-6 挑战中心"下一步"引导

**问题**：挑战中心展示分类列表，缺少"现在就做这个"的单一行动引导  
**风险等级**：🟡 中（ADHD UX）  
**改动范围**：`frontend/src/pages/child/ChildChallenge.tsx`

**修复方案**：在挑战中心顶部增加"推荐下一步"卡片，逻辑为：
1. 早晨时段（6-9点）→ 推荐早晨流程
2. 有未完成任务 → 推荐第一个未完成任务
3. 有未完成学习关卡 → 推荐下一个关卡
4. 默认 → 展示今日概览

```tsx
const getNextAction = useCallback(() => {
  if (!childData) return null;
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 9 && hasMorningSteps) {
    return { label: '开始早晨流程', path: '/child/challenge', tab: 'morning', icon: '🌅' };
  }
  if (pendingTasks.length > 0) {
    return { label: `完成 ${pendingTasks[0].title}`, path: '/child/challenge', tab: 'today', icon: '✅' };
  }
  if (pendingQuests.length > 0) {
    return { label: `学习 ${pendingQuests[0].title}`, path: '/child/challenge', tab: 'learning', icon: '📚' };
  }
  return null;
}, [childData, pendingTasks, pendingQuests]);
```

**验证方式**：不同时段进入挑战中心，顶部显示对应推荐行动  
**回滚方式**：移除"下一步"卡片

---

### B3-7 家长端批量审核（简化版）

**问题**：家长需逐个审核任务，效率低  
**风险等级**：🟡 中  
**改动范围**：`backend/src/server.ts` 新增路由，`frontend/src/pages/parent/ParentDashboard.tsx`

**修复方案**：

1. 后端新增批量审核路由：
```ts
app.post('/api/parent/task-entries/batch-review', protect, async (req: AuthRequest, res) => {
  const { entries } = req.body as { entries: Array<{ id: string; action: 'approve' | 'reject'; coins?: number; xp?: number }> };
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ message: '请选择要审核的任务' });
  }
  const results = [];
  for (const entry of entries) {
    // 复用现有审核逻辑，但不逐个发成就通知，批量结束后统一检查
    // ...
    results.push({ id: entry.id, status: 'ok' });
  }
  res.json({ message: `批量审核完成`, results });
});
```

2. 前端家长端待审核列表增加多选 + 批量通过按钮

**验证方式**：选择多个待审核任务，一键通过  
**回滚方式**：移除批量路由和前端多选 UI

---

## B4：代码减负（第5-8周）

> **架构拆分、状态管理优化、测试引入**

---

### B4-1 后端探索模块路由拆分

**问题**：server.ts 7200行单文件，探索路由约12个适合优先拆分  
**风险等级**：🟡 中  
**改动范围**：新建 `backend/src/routes/explore.ts`，修改 `backend/src/server.ts`

**修复方案**：

1. 新建 `backend/src/routes/explore.ts`：
```ts
import { Router, Request, Response } from 'express';
import { getDb } from '../database';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs/promises';

const router = Router();

// 将 server.ts 中所有 /api/parent/explore/* 和 /api/child/explore/* 路由
// 迁移到此文件，使用 router.get/post/put/delete 替代 app.get/post/put/delete
// protect 中间件作为参数传入

export function registerExploreRoutes(protect: any, JWT_SECRET: string) {
  // ... 迁移路由代码
  return router;
}
```

2. 在 `server.ts` 中：
```ts
import { registerExploreRoutes } from './routes/explore';
app.use('/api', registerExploreRoutes(protect, JWT_SECRET));
```

3. 从 `server.ts` 中删除迁移的探索路由代码

**验证方式**：`npm run build` 通过，探索功能 API 烟测通过  
**回滚方式**：将路由代码移回 server.ts

---

### B4-2 后端成就模块路由拆分

**问题**：成就逻辑分散，新增探索成就容易遗漏  
**风险等级**：🟡 中  
**改动范围**：新建 `backend/src/routes/achievements.ts`，`backend/src/services/achievementChecker.ts`

**修复方案**：

1. 新建 `backend/src/services/achievementChecker.ts`，将成就检查逻辑抽取为事件驱动：
```ts
type AchievementEvent = 
  | { type: 'task.approved'; childId: string; familyId: string }
  | { type: 'explore.checkin'; childId: string; familyId: string }
  | { type: 'explore.confirmed'; childId: string; familyId: string }
  | { type: 'emotion.calm'; childId: string; familyId: string }
  | { type: 'streak.updated'; childId: string; familyId: string; days: number };

export async function checkAndAwardAchievements(
  childId: string, familyId: string, event?: AchievementEvent
): Promise<string[]> {
  const db = getDb();
  const unlocked: string[] = [];
  // 统一成就检查逻辑，不再分散在各路由
  // ...
  return unlocked;
}
```

2. 在各路由中替换为 `checkAndAwardAchievements(childId, familyId, { type: '...' })`

**验证方式**：成就解锁行为与拆分前一致  
**回滚方式**：恢复内联检查逻辑

---

### B4-3 前端 React Query 引入

**问题**：每次进页面重新请求，无客户端缓存  
**风险等级**：🟢 低（代码质量）  
**改动范围**：`frontend/package.json`，`frontend/src/App.tsx`，逐步改造页面

**修复方案**：

1. 安装依赖：
```bash
npm install @tanstack/react-query
```

2. 在 `App.tsx` 中包裹 `QueryClientProvider`：
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000, // 30秒内不重新请求
      retry: 1,
      refetchOnWindowFocus: false,
    }
  }
});
```

3. 先改造探索页面作为模板：
```tsx
const { data: places = [] } = useQuery({
  queryKey: ['explore-places'],
  queryFn: () => api.get('/child/explore/places').then(r => r.data),
});
```

**验证方式**：页面切换后 30 秒内返回不重新请求  
**回滚方式**：移除 QueryClientProvider，恢复 useState+useEffect

---

### B4-4 API 响应格式统一化

**问题**：响应格式不统一，部分返回 `{message}`，部分返回数组  
**风险等级**：🟢 低  
**改动范围**：`backend/src/server.ts` 全局中间件

**修复方案**：添加响应包装中间件（新路由优先使用，旧路由渐进迁移）：
```ts
// 响应包装中间件（仅对 JSON 响应生效）
app.use((req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    // 已包装的响应不再重复包装
    if (body && typeof body === 'object' && 'code' in body && 'data' in body) {
      return originalJson(body);
    }
    // 错误响应
    if (res.statusCode >= 400) {
      return originalJson({ code: res.statusCode, data: null, message: body?.message || body });
    }
    // 成功响应
    return originalJson({ code: 0, data: body, message: 'ok' });
  };
  next();
});
```

> ⚠️ 此改动会影响前端所有 API 调用，建议在 B4-3 React Query 引入后，配合前端 api.ts 拦截器统一解包。**先仅在新增路由中启用**，旧路由通过 feature flag 控制。

**验证方式**：新路由返回 `{code, data, message}` 格式  
**回滚方式**：移除中间件

---

### B4-5 奖励系统单元测试

**问题**：后端零测试覆盖，rewardSystem.ts 1454行最需要保护  
**风险等级**：🟡 中  
**改动范围**：新建 `backend/tests/rewardSystem.test.ts`

**修复方案**：

1. 安装测试依赖：
```bash
cd backend && npm install -D jest ts-jest @types/jest
```

2. 创建 `backend/jest.config.js`：
```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
};
```

3. 首批测试用例覆盖：
```ts
// backend/tests/rewardSystem.test.ts
describe('奖励计算', () => {
  test('完成度 >= 1.0 时系数为 1.0', () => { /* ... */ });
  test('完成度 0.8 时系数为 0.9', () => { /* ... */ });
  test('质量系数 = 0.5 + qualityScore * 0.2', () => { /* ... */ });
  test('最终系数最高不超过 1.5', () => { /* ... */ });
  test('抽奖阶梯费用递增', () => { /* ... */ });
  test('稀有度保底 10 次触发', () => { /* ... */ });
});
```

**验证方式**：`npm test` 通过  
**回滚方式**：删除 tests 目录和 jest 配置

---

### B4-6 Token 刷新机制

**问题**：Token 过期后直接跳转登录，无刷新  
**风险等级**：🟡 中  
**改动范围**：`backend/src/server.ts` 认证路由，`frontend/src/services/api.ts`

**修复方案**：

1. 后端：登录时同时签发 refreshToken（7天有效期），accessToken 缩短为 2小时：
```ts
const accessToken = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '2h' });
const refreshToken = jwt.sign({ userId: user.id, type: 'refresh' }, JWT_SECRET, { expiresIn: '7d' });
```

2. 新增 `POST /api/auth/refresh` 路由

3. 前端 api.ts 拦截器：401 时尝试用 refreshToken 刷新，成功后重试原请求

**验证方式**：accessToken 过期后自动刷新，用户无感知  
**回滚方式**：移除 refresh 路由，恢复直接跳转登录

---

### B4-7 前端组件抽取

**问题**：`ChildChallenge.tsx` 1570行、`ParentDashboard.tsx` 1841行过大  
**风险等级**：🟢 低  
**改动范围**：逐步拆分大页面为子组件

**修复方案**：优先抽取高频复用组件：

| 组件 | 来源 | 目标文件 |
|------|------|---------|
| `TaskCard` | ChildChallenge, ChildTasks | `components/TaskCard.tsx` |
| `RewardCard` | ChildWishes, ParentWishes | `components/RewardCard.tsx` |
| `CategoryFilter` | ChildExplore, ChildChallenge | `components/CategoryFilter.tsx` |
| `StatPanel` | ParentDashboard | `components/StatPanel.tsx` |

每个组件的抽取独立提交，确保构建通过后再继续下一个。

**验证方式**：`npm run build` 通过，页面功能不变  
**回滚方式**：Git revert 对应提交

---

### B4-8 数据库迁移文件化

**问题**：迁移逻辑全部在 `database.ts` 中，无独立管理  
**风险等级**：🟢 低  
**改动范围**：新建 `backend/src/migrations/` 目录

**修复方案**：

```
backend/src/migrations/
├── 001_initial.ts          # 核心表（families, users, tasks, task_entries, wishes, privileges, achievements）
├── 002_learning.ts         # 学习闯关表
├── 003_emotion_screentime.ts # 情绪/游戏票表
├── 004_breakfast.ts        # 早餐/早晨表
├── 005_explore.ts          # 探索表
└── 006_explore_indexes.ts  # 探索索引
```

每个迁移文件导出 `up()` 和 `down()` 函数，由 `database.ts` 按版本号顺序执行。

**验证方式**：新数据库执行迁移后结构与旧库一致  
**回滚方式**：恢复 `database.ts` 内联迁移

---

### B4-9 错误处理统一化

**问题**：错误响应格式不统一，前端 `catch (e: any)` 吞掉错误细节  
**风险等级**：🟢 低  
**改动范围**：后端全局错误中间件，前端错误处理

**修复方案**：

1. 后端全局错误中间件改进：
```ts
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  const statusCode = err.statusCode || 500;
  const message = isProduction 
    ? (statusCode < 500 ? err.message : '服务器内部错误')
    : err.message;
  
  console.error(`[${new Date().toISOString()}] Error ${statusCode}:`, err.message);
  
  res.status(statusCode).json({ 
    code: statusCode, 
    message,
    ...(isProduction ? {} : { stack: err.stack })
  });
});
```

2. 前端统一错误类型：
```ts
// frontend/src/types/api.ts
export interface ApiError {
  code: number;
  message: string;
}
```

**验证方式**：所有 API 错误返回统一格式  
**回滚方式**：恢复原始错误处理

---

## B5：国际化与上线（第9-12周）

> **i18n 框架、全球覆盖、移动端打包、上线准备**

---

### B5-1 前端 i18n 框架引入

**问题**：所有文案硬编码为中文，需支持国际化  
**风险等级**：🟢 低（增量引入）  
**改动范围**：`frontend/package.json`，新建 `frontend/src/i18n/` 目录

**修复方案**：

1. 安装 `react-i18next` + `i18next`：
```bash
npm install i18next react-i18next i18next-browser-languagedetector
```

2. 新建 `frontend/src/i18n/index.ts`：
```ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import zh from './locales/zh.json';
import en from './locales/en.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { zh: { translation: zh }, en: { translation: en } },
    fallbackLng: 'zh',
    interpolation: { escapeValue: false },
  });

export default i18n;
```

3. 先对探索页面做国际化模板，其余页面渐进迁移：
```tsx
const { t } = useTranslation();
<h2>{t('explore.title')}</h2>
```

4. 文案 JSON 结构：
```json
// zh.json
{
  "explore": {
    "title": "家庭探索站",
    "subtitle": "读万卷书，也走进真实世界",
    "checkin": "提交打卡",
    "mood": { "curious": "好奇", "happy": "开心", "brave": "勇敢" }
  }
}
```

**验证方式**：切换浏览器语言后探索页面文案切换  
**回滚方式**：移除 i18n 配置，恢复硬编码中文

---

### B5-2 探索功能全球覆盖——地理编码解耦

**问题**：探索功能依赖高德 POI 搜索，仅支持中国地区  
**风险等级**：🟡 中（核心目标）  
**改动范围**：`backend/src/server.ts` 或 `backend/src/routes/explore.ts` 中 POI 搜索逻辑

**修复方案**：

1. 抽象 POI 搜索接口：
```ts
// backend/src/services/poiSearch.ts
interface POIResult {
  id: string;
  title: string;
  category: string;
  address: string;
  latitude: number;
  longitude: number;
  source: string;
}

async function searchPOI(keyword: string, city?: string): Promise<POIResult[]> {
  // 优先使用已配置的搜索服务
  if (process.env.AMAP_WEB_SERVICE_KEY) {
    return searchAmapPOI(keyword, city);
  }
  if (process.env.GOOGLE_PLACES_API_KEY) {
    return searchGooglePOI(keyword);
  }
  return []; // 无搜索服务时降级为手动添加
}
```

2. 环境变量配置（按地区选择搜索服务）：
```
# 中国地区
AMAP_WEB_SERVICE_KEY=xxx

# 海外地区
GOOGLE_PLACES_API_KEY=xxx
```

3. `explore_places` 表的 `latitude`/`longitude` 字段已存在，无需修改

**验证方式**：配置 Google API Key 后搜索海外 POI 返回结果  
**回滚方式**：移除 Google POI 搜索逻辑

---

### B5-3 探索分类国际化

**问题**：探索分类硬编码为中文，需支持多语言  
**风险等级**：🟡 中  
**改动范围**：`frontend/src/types/explore.ts`，前端展示逻辑

**修复方案**：

1. 分类使用 i18n key 而非中文硬编码：
```ts
export const EXPLORE_CATEGORIES = [
  { key: 'museum', icon: '🏛️' },
  { key: 'nature', icon: '🌿' },
  { key: 'park', icon: '🌳' },
  { key: 'city', icon: '🏙️' },
  { key: 'activity', icon: '🎪' },
  { key: 'travel', icon: '🧳' },
  { key: 'sports', icon: '🏃' },
  { key: 'charity', icon: '🤝' },
  { key: 'other', icon: '📍' },
] as const;
```

2. 数据库中 `explore_places.category` 存储 key（如 `museum`），前端根据语言显示翻译

3. 数据库迁移：将已有中文分类值映射到 key
```sql
UPDATE explore_places SET category = 'museum' WHERE category = '博物馆';
UPDATE explore_places SET category = 'nature' WHERE category = '自然';
-- ...
```

**验证方式**：切换语言后分类标签显示对应语言  
**回滚方式**：恢复中文硬编码分类

---

### B5-4 Capacitor 移动端封装

**问题**：需要在安卓和 iOS 端上线  
**风险等级**：🟡 中  
**改动范围**：新增 Capacitor 配置

**修复方案**：

1. 安装 Capacitor：
```bash
cd frontend
npm install @capacitor/core @capacitor/cli
npx cap init "星辰早晨" "com.starcoin.morning"
npm install @capacitor/android @capacitor/ios
```

2. `capacitor.config.ts`：
```ts
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.starcoin.morning',
  appName: '星辰早晨',
  webDir: 'dist',
  server: {
    url: 'https://starcoin.h5-online.com',
    // 开发时使用本地服务器：
    // url: 'http://192.168.x.x:3000',
  },
  plugins: {
    Camera: { presentationStyle: 'fullscreen' },
    Geolocation: { permissions: ['location'] },
  },
};

export default config;
```

3. 添加平台：
```bash
npx cap add android
npx cap add ios
```

4. 在 `frontend/` 中添加 Capacitor 相关权限配置（相机、麦克风、定位）

**验证方式**：`npx cap open android` 在模拟器中运行  
**回滚方式**：删除 capacitor 配置和 android/ios 目录

---

### B5-5 移动端权限声明

**问题**：移动端需要相机、麦克风、定位权限  
**风险等级**：🟡 中  
**改动范围**：`frontend/android/app/src/main/AndroidManifest.xml`，`frontend/ios/App/Info.plist`

**修复方案**：

Android (`AndroidManifest.xml`)：
```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.INTERNET" />
```

iOS (`Info.plist`)：
```xml
<key>NSCameraUsageDescription</key>
<string>星辰早晨需要使用相机来拍摄探索打卡照片</string>
<key>NSMicrophoneUsageDescription</key>
<string>星辰早晨需要使用麦克风来录制探索语音留言</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>星辰早晨需要获取位置来推荐附近的探索地点</string>
```

**验证方式**：安装后首次使用拍照/录音/定位时弹出权限请求  
**回滚方式**：移除权限声明

---

### B5-6 上线检查清单与自动化

**问题**：当前验证全靠手动，上线流程无自动化  
**风险等级**：🟢 低  
**改动范围**：新建 `scripts/pre-release-check.sh`，CI 配置（可选）

**修复方案**：

```bash
#!/bin/bash
# scripts/pre-release-check.sh
set -e

echo "=== 1. 后端构建 ==="
cd backend && npm run build && cd ..

echo "=== 2. 前端 lint ==="
cd frontend && npm run lint && cd ..

echo "=== 3. 前端构建 ==="
cd frontend && npm run build && cd ..

echo "=== 4. 数据库完整性 ==="
sqlite3 stellar.db "PRAGMA integrity_check;"

echo "=== 5. 孤儿数据检查 ==="
sqlite3 stellar.db "SELECT COUNT(*) as orphan_entries FROM task_entries te LEFT JOIN users u ON te.childId = u.id WHERE u.id IS NULL;"

echo "=== 6. 环境变量检查 ==="
[ -n "$JWT_SECRET" ] || echo "⚠️ JWT_SECRET 未设置"

echo "=== 全部检查通过 ==="
```

**验证方式**：运行脚本，全部输出 OK  
**回滚方式**：删除脚本

---

## 修改范围汇总

### 按文件统计

| 文件 | B1 | B2 | B3 | B4 | B5 | 总改动项 |
|------|----|----|----|----|----|---------|
| `backend/src/server.ts` | 4 | 3 | 1 | 4 | 1 | 13 |
| `backend/src/database.ts` | 1 | 2 | - | 1 | - | 4 |
| `frontend/src/pages/child/ChildExplore.tsx` | - | 2 | 2 | - | - | 4 |
| `frontend/src/pages/parent/ParentExplore.tsx` | - | 1 | - | - | - | 1 |
| `frontend/src/pages/child/ChildLayout.tsx` | - | - | 1 | - | - | 1 |
| `frontend/src/pages/child/ChildChallenge.tsx` | - | - | 1 | - | - | 1 |
| `frontend/src/services/api.ts` | - | - | - | 2 | - | 2 |
| 新建文件 | - | 2 | 3 | 5 | 5 | 15 |

### 按批次风险

| 批次 | 最高风险项 | 回滚难度 |
|------|-----------|---------|
| B1 | JWT 强制退出（需确保服务器有 JWT_SECRET） | 低 |
| B2 | 多孩子打卡逻辑（核心业务） | 中 |
| B3 | iOS 录音兼容（平台特性） | 低 |
| B4 | 后端路由拆分（代码重组） | 中 |
| B5 | Capacitor 封装（架构级变更） | 低（新增） |

---

## 每批次部署验证清单

每批次修改完成后，必须通过以下验证才能部署到服务器：

1. **本地构建**：`backend: npm run build` ✅ + `frontend: npm run lint && npm run build` ✅
2. **本地冒烟测试**：启动本地服务，登录 → 创建任务 → 完成 → 审核 → 宝箱 → 探索打卡
3. **数据库一致性**：`sqlite3 stellar.db "PRAGMA integrity_check;"`
4. **服务器备份**：上传前执行数据库快照
5. **灰度验证**：先在本地用生产数据库副本验证，再上传到服务器
6. **上线后验证**：`/api/health` 检查 + 手动跑一次核心流程
