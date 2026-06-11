import { Express } from 'express';
import axios from 'axios';
import { randomUUID, createHash } from 'crypto';
import { getDb } from './database';

const isDev = process.env.NODE_ENV !== 'production';
const logger = {
  info: (...args: any[]) => { if (isDev) console.log(...args); },
  warn: (...args: any[]) => console.warn(...args),
  error: (...args: any[]) => console.error(...args),
};

// JWT 类型定义（与 server.ts 保持一致）
interface AuthRequest {
  user?: {
    id: string;
    role: string;
    familyId: string;
  };
}

const HTTP_TIMEOUT_MS = 8000;
const HTTP_USER_AGENT = 'StarCoinFamilyBot/1.0';
const MAX_FETCH_BYTES = 2 * 1024 * 1024;
const MAX_ACTIVE_SOURCES = 10;

// --- 北京时间工具（与 server.ts 的 getLocalDateString 同口径，模块内独立实现避免交叉依赖） ---
const BEIJING_OFFSET_MINUTES = 8 * 60;

const getBeijingDate = (date: Date = new Date()): Date => {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utc + BEIJING_OFFSET_MINUTES * 60000);
};

const getBeijingDateString = (date: Date = new Date()): string => {
  const beijing = getBeijingDate(date);
  const year = beijing.getFullYear();
  const month = String(beijing.getMonth() + 1).padStart(2, '0');
  const day = String(beijing.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// --- 通用小工具 ---
const trimText = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max);

const clampDailyLimit = (value: unknown): number => {
  const num = Math.trunc(Number(value));
  if (!Number.isFinite(num)) return 3;
  return Math.min(5, Math.max(1, num));
};

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

// 服务端抓取家长提交的 URL，最小 SSRF 防护：仅公网域名，拒绝 IP 直连/本机
const isSafePublicUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return false;
    return true;
  } catch {
    return false;
  }
};

const hashText = (text: string) => createHash('sha256').update(text).digest('hex');

const decodeHtmlEntities = (text: string) => text
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#0?39;/g, "'")
  .replace(/&nbsp;/g, ' ');

const fetchHtml = async (url: string): Promise<string> => {
  const response = await axios.get(url, {
    timeout: HTTP_TIMEOUT_MS,
    headers: { 'User-Agent': HTTP_USER_AGENT },
    responseType: 'text',
    transformResponse: [(data: any) => data],
    maxContentLength: MAX_FETCH_BYTES,
    maxRedirects: 3,
  });
  return String(response.data || '');
};

// --- 分类轮换表：按北京时间星期几取当天 POI 搜索分类（0=周日） ---
const DEFAULT_CATEGORY_ROTATION: { label: string; keywords: string }[] = [
  { label: '展览馆', keywords: '展览馆' },
  { label: '博物馆', keywords: '博物馆' },
  { label: '公园', keywords: '公园' },
  { label: '科技馆', keywords: '科技馆' },
  { label: '图书馆/美术馆', keywords: '图书馆|美术馆' },
  { label: '动物园/植物园', keywords: '动物园|植物园' },
  { label: '周末户外', keywords: '郊野公园|露营|步道' },
];

const pickRotationCategory = (family: any, dayOfWeek: number): { label: string; keywords: string } => {
  try {
    const parsed = JSON.parse(String(family.exploreFeedCategories || ''));
    if (Array.isArray(parsed)) {
      const list = parsed.map((item: unknown) => trimText(item, 20)).filter(Boolean);
      if (list.length > 0) {
        const picked = list[dayOfWeek % list.length];
        return { label: picked, keywords: picked };
      }
    }
  } catch { /* 配置非法 JSON 时回退默认轮换表 */ }
  return DEFAULT_CATEGORY_ROTATION[dayOfWeek % DEFAULT_CATEGORY_ROTATION.length];
};

// 发现卡分类 → 探索地点分类（explore_places.category 白名单见 server.ts EXPLORE_CATEGORIES）
const PLACE_CATEGORIES = ['博物馆', '自然', '公园', '城市', '活动', '旅行', '运动体验', '公益体验', '其他'];
const FEED_TO_PLACE_CATEGORY: Record<string, string> = {
  '博物馆': '博物馆',
  '科技馆': '博物馆',
  '展览馆': '博物馆',
  '图书馆/美术馆': '博物馆',
  '公园': '公园',
  '动物园/植物园': '自然',
  '周末户外': '自然',
  '节日': '活动',
};

const mapFeedCategoryToPlaceCategory = (category: unknown): string => {
  const text = trimText(category, 20);
  if (FEED_TO_PLACE_CATEGORY[text]) return FEED_TO_PLACE_CATEGORY[text];
  return PLACE_CATEGORIES.includes(text) ? text : '其他';
};

// ==================== A. 每日生成器 ====================

// 高德 POI 推荐卡：评分高的优先；已推荐过的 amapPoiId、与地图同名地点排除
const generatePoiCards = async (db: any, family: any, today: string, dayOfWeek: number): Promise<number> => {
  const key = process.env.AMAP_WEB_SERVICE_KEY;
  if (!key || !trimText(family.exploreCity, 40)) return 0;
  const rotation = pickRotationCategory(family, dayOfWeek);
  const result = await axios.get('https://restapi.amap.com/v3/place/text', {
    params: {
      key,
      keywords: rotation.keywords,
      city: trimText(family.exploreCity, 40),
      citylimit: true,
      offset: 10,
      page: 1,
      extensions: 'all',
    },
    timeout: HTTP_TIMEOUT_MS,
    headers: { 'User-Agent': HTTP_USER_AGENT },
  });
  if (String(result.data?.status) !== '1') {
    logger.warn('[ExploreFeed] 高德搜索返回异常（跳过 POI 卡）:', result.data?.info || 'unknown');
    return 0;
  }
  const pois: any[] = Array.isArray(result.data?.pois) ? result.data.pois : [];
  const rated = pois
    .map(poi => {
      const rawRating = poi?.biz_ext?.rating;
      const rating = Number(Array.isArray(rawRating) ? rawRating[0] : rawRating);
      return { poi, rating: Number.isFinite(rating) ? rating : 0 };
    })
    .sort((a, b) => b.rating - a.rating);

  const limit = clampDailyLimit(family.exploreFeedDailyLimit ?? 3);
  // “立即生成”可重复触发：当天已有 POI 卡时只补足缺口，不超过每日上限
  const todayCountRow = await db.get(
    "SELECT COUNT(*) as c FROM explore_feed_items WHERE familyId = ? AND type = 'poi' AND recommendDate = ?",
    family.id, today
  );
  const remaining = limit - (todayCountRow?.c || 0);
  if (remaining <= 0) return 0;
  let inserted = 0;
  for (const { poi } of rated) {
    if (inserted >= remaining) break;
    const title = trimText(poi?.name, 80);
    if (!title) continue;
    const amapPoiId = trimText(poi?.id, 80);
    if (amapPoiId) {
      const dupFeed = await db.get(
        'SELECT id FROM explore_feed_items WHERE familyId = ? AND amapPoiId = ? LIMIT 1',
        family.id, amapPoiId
      );
      if (dupFeed) continue;
    }
    const dupPlace = await db.get(
      'SELECT id FROM explore_places WHERE familyId = ? AND title = ? AND deletedAt IS NULL LIMIT 1',
      family.id, title
    );
    if (dupPlace) continue;
    const [lngRaw, latRaw] = String(poi?.location || '').split(',');
    const longitude = Number(lngRaw);
    const latitude = Number(latRaw);
    const photos: any[] = Array.isArray(poi?.photos) ? poi.photos : [];
    const imageUrl = trimText(photos[0]?.url, 500);
    const address = Array.isArray(poi?.address) ? poi.address.join('') : trimText(poi?.address, 160);
    await db.run(
      `INSERT INTO explore_feed_items (id, familyId, type, title, summary, imageUrl, category, latitude, longitude, amapPoiId, status, recommendDate)
       VALUES (?, ?, 'poi', ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
      randomUUID(),
      family.id,
      title,
      trimText(address, 160) || null,
      imageUrl && isHttpUrl(imageUrl) ? imageUrl : null,
      rotation.label,
      Number.isFinite(latitude) ? latitude : null,
      Number.isFinite(longitude) ? longitude : null,
      amapPoiId || null,
      today
    );
    inserted++;
  }
  if (inserted > 0) logger.info(`[ExploreFeed] 家庭 ${family.id} 生成 ${inserted} 张 POI 卡（${rotation.label}）`);
  return inserted;
};

// 节日卡本地规则：固定节日 > 季节性周六 > 普通周六（每周末只插周六一张），首条命中生效
type FestivalRule = {
  match: (beijing: Date) => boolean;
  title: string;
  summary: string;
};

const FESTIVAL_RULES: FestivalRule[] = [
  { match: b => b.getMonth() === 0 && b.getDate() === 1, title: '元旦 · 新年第一走', summary: '新的一年开始啦！出门走一走，把新年的第一份好奇心装进口袋。' },
  { match: b => b.getMonth() === 5 && b.getDate() === 1, title: '六一儿童节', summary: '今天是你的节日！挑一个最想去的地方，让爸爸妈妈陪你去吧。' },
  { match: b => b.getMonth() === 9 && b.getDate() === 1, title: '国庆出游日', summary: '国庆假期开始啦，城市里到处都很热闹，找个喜欢的地方逛逛吧。' },
  { match: b => b.getMonth() === 4 && b.getDate() === 1, title: '劳动节小冒险', summary: '放假第一天，出门动一动，看看劳动中的人们都在做什么。' },
  { match: b => b.getMonth() === 3 && b.getDate() === 4, title: '春日踏青', summary: '春天来了，去公园找一找刚冒出来的新芽和花苞吧。' },
  { match: b => (b.getMonth() === 0 || b.getMonth() === 1) && b.getDay() === 6, title: '寒假探索季', summary: '寒假的周六最适合出门啦，裹暖和一点，去看看冬天的城市。' },
  { match: b => (b.getMonth() === 6 || b.getMonth() === 7) && b.getDay() === 6, title: '暑假探索季', summary: '暑假的周六，挑个凉快的时间出门，说不定有新发现。' },
  { match: b => b.getMonth() === 11 && b.getDay() === 6, title: '十二月冰雪季', summary: '十二月的周末，去找找冬天独有的风景，冰和雪都在等你。' },
  { match: b => b.getDay() === 6, title: '周末出门走走', summary: '今天是周六！离开沙发一小时，去外面找一件有意思的小事。' },
];

const generateFestivalCard = async (db: any, family: any, today: string, beijingNow: Date): Promise<number> => {
  const rule = FESTIVAL_RULES.find(item => item.match(beijingNow));
  if (!rule) return 0;
  // “立即生成”可重复触发：当天已有节日卡则不重复插
  const dup = await db.get(
    "SELECT id FROM explore_feed_items WHERE familyId = ? AND type = 'festival' AND recommendDate = ? LIMIT 1",
    family.id, today
  );
  if (dup) return 0;
  await db.run(
    `INSERT INTO explore_feed_items (id, familyId, type, title, summary, category, status, recommendDate)
     VALUES (?, ?, 'festival', ?, ?, '节日', 'new', ?)`,
    randomUUID(), family.id, rule.title, rule.summary, today
  );
  return 1;
};

// 关注源抓取：提取 <a> 链接，按活动关键词过滤，进家长待审核队列
const SOURCE_KEYWORD_RE = /(展览|演出|活动|亲子|讲座|市集|节)/;
const SOURCE_LINK_RE = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

const fetchSourceItems = async (db: any, family: any, source: any, today: string): Promise<number> => {
  try {
    const html = await fetchHtml(source.url);
    const candidates: { text: string; href: string }[] = [];
    let match: RegExpExecArray | null;
    SOURCE_LINK_RE.lastIndex = 0;
    while ((match = SOURCE_LINK_RE.exec(html)) !== null && candidates.length < 40) {
      const href = match[1].trim();
      const text = decodeHtmlEntities(match[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
      if (!href || href.startsWith('#') || /^javascript:/i.test(href)) continue;
      if (text.length < 6 || text.length > 40) continue;
      if (!SOURCE_KEYWORD_RE.test(text)) continue;
      if (candidates.some(item => item.text === text)) continue;
      candidates.push({ text, href });
    }
    if (candidates.length === 0) {
      await db.run('UPDATE explore_feed_sources SET lastFetchedAt = CURRENT_TIMESTAMP WHERE id = ?', source.id);
      return 0;
    }
    const firstHash = hashText(candidates[0].text);
    if (source.lastItemHash && source.lastItemHash === firstHash) {
      // 页面头条没变化，视为无新内容
      await db.run('UPDATE explore_feed_sources SET lastFetchedAt = CURRENT_TIMESTAMP WHERE id = ?', source.id);
      return 0;
    }
    let inserted = 0;
    for (const item of candidates) {
      if (inserted >= 5) break;
      if (source.lastItemHash && hashText(item.text) === source.lastItemHash) break;
      const dup = await db.get(
        'SELECT id FROM explore_feed_items WHERE familyId = ? AND title = ? LIMIT 1',
        family.id, item.text
      );
      if (dup) continue;
      let absoluteUrl = '';
      try {
        absoluteUrl = new URL(item.href, source.url).toString();
      } catch {
        continue;
      }
      if (!isHttpUrl(absoluteUrl)) continue;
      await db.run(
        `INSERT INTO explore_feed_items (id, familyId, type, title, summary, sourceUrl, category, status, recommendDate)
         VALUES (?, ?, 'source', ?, ?, ?, '活动', 'pending_review', ?)`,
        randomUUID(),
        family.id,
        item.text,
        source.label ? `来自「${trimText(source.label, 40)}」` : '来自家长关注的网站',
        trimText(absoluteUrl, 500),
        today
      );
      inserted++;
    }
    await db.run(
      'UPDATE explore_feed_sources SET lastFetchedAt = CURRENT_TIMESTAMP, lastItemHash = ? WHERE id = ?',
      firstHash, source.id
    );
    if (inserted > 0) logger.info(`[ExploreFeed] 家庭 ${family.id} 关注源新增 ${inserted} 条待审核`);
    return inserted;
  } catch (err: any) {
    // 抓取失败静默记日志，绝不影响主服务（Rule 12 例外：第三方站点不可控）
    logger.warn('[ExploreFeed] 关注源抓取失败（跳过）:', source.url, err?.message || err);
    return 0;
  }
};

// 单家庭生成流程：POI 卡 + 节日卡 + 关注源抓取，返回新增条数（每日定时与“立即生成”共用）
const generateFeedForFamily = async (db: any, family: any, today: string, beijingNow: Date, dayOfWeek: number): Promise<number> => {
  let insertedCount = 0;
  if (family.exploreCity) {
    try {
      insertedCount += await generatePoiCards(db, family, today, dayOfWeek);
    } catch (err: any) {
      logger.warn('[ExploreFeed] POI 卡生成失败（跳过）:', family.id, err?.message || err);
    }
  }
  try {
    insertedCount += await generateFestivalCard(db, family, today, beijingNow);
  } catch (err: any) {
    logger.warn('[ExploreFeed] 节日卡生成失败（跳过）:', family.id, err?.message || err);
  }
  const sources = await db.all(
    'SELECT * FROM explore_feed_sources WHERE familyId = ? AND isActive = 1 ORDER BY createdAt ASC',
    family.id
  );
  for (const source of sources) {
    insertedCount += await fetchSourceItems(db, family, source, today);
  }
  return insertedCount;
};

let generating = false;

export const generateDailyFeed = async (): Promise<void> => {
  if (generating) return;
  generating = true;
  try {
    const db = getDb();
    const now = new Date();
    const today = getBeijingDateString(now);
    const beijingNow = getBeijingDate(now);
    const dayOfWeek = beijingNow.getDay();
    const families = await db.all('SELECT id, exploreCity, exploreFeedDailyLimit, exploreFeedCategories FROM families');
    for (const family of families) {
      try {
        // 当天已生成过则跳过（家长手动推的卡不算生成记录）
        const existing = await db.get(
          "SELECT id FROM explore_feed_items WHERE familyId = ? AND recommendDate = ? AND type != 'parent' LIMIT 1",
          family.id, today
        );
        if (existing) continue;
        await generateFeedForFamily(db, family, today, beijingNow, dayOfWeek);
      } catch (err: any) {
        logger.error('[ExploreFeed] 单家庭资讯生成失败（不影响其他家庭）:', family.id, err?.message || err);
      }
    }
  } catch (err: any) {
    logger.error('[ExploreFeed] 每日资讯生成失败:', err?.message || err);
  } finally {
    generating = false;
  }
};

// 调度器：启动时补当天一次 + 每日北京时间 6:30（参照 backup.ts 的 setTimeout 链模式）
const msUntilNextBeijing630 = (): number => {
  const beijingNow = getBeijingDate();
  const next = new Date(beijingNow.getTime());
  next.setHours(6, 30, 0, 0);
  if (next.getTime() <= beijingNow.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - beijingNow.getTime();
};

export const startExploreFeedScheduler = () => {
  // 启动后延迟几秒补当天，避开启动高峰
  setTimeout(() => { void generateDailyFeed(); }, 5000);
  const scheduleNext = () => {
    const delay = msUntilNextBeijing630();
    console.log(`[ExploreFeed] 下次资讯生成：北京时间 6:30（约 ${Math.round(delay / 60000)} 分钟后）`);
    setTimeout(() => {
      void generateDailyFeed().then(scheduleNext, scheduleNext);
    }, delay);
  };
  scheduleNext();
};

// ==================== B. 路由 ====================

export const registerExploreFeedRoutes = (app: Express, protect: any, requireParent?: any, requireChild?: any) => {
  const childGuards = requireChild ? [protect, requireChild] : [protect];
  const parentGuards = requireParent ? [protect, requireParent] : [protect];

  // 孩子端：今日资讯流（家长推荐置顶，最新优先）
  app.get('/api/child/explore/feed', ...childGuards, async (req: any, res: any) => {
    const request = req as AuthRequest;
    const rows = await getDb().all(
      `SELECT id, type, title, summary, imageUrl, category, latitude, longitude, sourceUrl, status, recommendDate, createdAt
       FROM explore_feed_items
       WHERE familyId = ? AND status = 'new'
       ORDER BY CASE type WHEN 'parent' THEN 0 ELSE 1 END, recommendDate DESC, createdAt DESC
       LIMIT 20`,
      request.user!.familyId
    );
    res.json(rows);
  });

  // 孩子端：想去 → 一律创建 wishlist 地点（有坐标直接上图，无坐标等家长在探索管理里补定位）
  app.post('/api/child/explore/feed/:id/want', ...childGuards, async (req: any, res: any) => {
    const request = req as AuthRequest;
    const db = getDb();
    const item = await db.get(
      'SELECT * FROM explore_feed_items WHERE id = ? AND familyId = ?',
      req.params.id, request.user!.familyId
    );
    if (!item) return res.status(404).json({ message: '这条推荐不存在或已过期' });
    if (item.status !== 'new' && item.status !== 'wanted') {
      return res.status(400).json({ message: '这条推荐已经处理过啦' });
    }
    await db.run("UPDATE explore_feed_items SET status = 'wanted' WHERE id = ?", item.id);
    let placeId: string | null = null;
    const latitude = Number(item.latitude);
    const longitude = Number(item.longitude);
    const located = item.latitude !== null && item.longitude !== null && Number.isFinite(latitude) && Number.isFinite(longitude);
    const existingPlace = await db.get(
      'SELECT id FROM explore_places WHERE familyId = ? AND sourceFeedId = ? AND deletedAt IS NULL LIMIT 1',
      request.user!.familyId, item.id
    );
    if (existingPlace) {
      placeId = existingPlace.id;
    } else {
      placeId = randomUUID();
      await db.run(
        `INSERT INTO explore_places (id, familyId, title, category, latitude, longitude, summary, source, status, createdBy, sourceFeedId, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'feed', 'wishlist', ?, ?, ?)`,
        placeId,
        request.user!.familyId,
        trimText(item.title, 80),
        mapFeedCategoryToPlaceCategory(item.category),
        located ? latitude : null,
        located ? longitude : null,
        trimText(item.summary, 300),
        request.user!.id,
        item.id,
        new Date().toISOString()
      );
    }
    res.json({ message: located ? '已经放进你的地图啦' : '已加进想去清单啦', placeId, located });
  });

  // 孩子端：下次再说
  app.post('/api/child/explore/feed/:id/dismiss', ...childGuards, async (req: any, res: any) => {
    const request = req as AuthRequest;
    const db = getDb();
    const item = await db.get(
      'SELECT id, status FROM explore_feed_items WHERE id = ? AND familyId = ?',
      req.params.id, request.user!.familyId
    );
    if (!item) return res.status(404).json({ message: '这条推荐不存在或已过期' });
    if (item.status !== 'new') return res.status(400).json({ message: '这条推荐已经处理过啦' });
    await db.run("UPDATE explore_feed_items SET status = 'dismissed' WHERE id = ?", item.id);
    res.json({ message: '好的，下次再说' });
  });

  // 家长端：发现推送设置（城市/条数/分类 + 关注源 + 待审核队列）
  app.get('/api/parent/explore/feed-settings', ...parentGuards, async (req: any, res: any) => {
    const request = req as AuthRequest;
    const db = getDb();
    const family = await db.get(
      'SELECT exploreCity, exploreFeedDailyLimit, exploreFeedCategories FROM families WHERE id = ?',
      request.user!.familyId
    );
    const sources = await db.all(
      'SELECT id, url, label, lastFetchedAt, createdAt FROM explore_feed_sources WHERE familyId = ? AND isActive = 1 ORDER BY createdAt DESC',
      request.user!.familyId
    );
    const pendingReview = await db.all(
      `SELECT id, type, title, summary, sourceUrl, category, recommendDate, createdAt
       FROM explore_feed_items WHERE familyId = ? AND status = 'pending_review'
       ORDER BY createdAt DESC LIMIT 50`,
      request.user!.familyId
    );
    let categories: string[] | null = null;
    try {
      const parsed = JSON.parse(String(family?.exploreFeedCategories || ''));
      if (Array.isArray(parsed)) {
        const list = parsed.map((item: unknown) => trimText(item, 20)).filter(Boolean);
        if (list.length > 0) categories = list;
      }
    } catch { /* 未配置或非法 JSON 一律按 null 返回 */ }
    res.json({
      exploreCity: family?.exploreCity || '',
      exploreFeedDailyLimit: clampDailyLimit(family?.exploreFeedDailyLimit ?? 3),
      exploreFeedCategories: categories,
      poiEnabled: !!process.env.AMAP_WEB_SERVICE_KEY,
      sources,
      pendingReview,
    });
  });

  app.put('/api/parent/explore/feed-settings', ...parentGuards, async (req: any, res: any) => {
    const request = req as AuthRequest;
    const db = getDb();
    if (req.body?.exploreCity !== undefined) {
      await db.run('UPDATE families SET exploreCity = ? WHERE id = ?', trimText(req.body.exploreCity, 40) || null, request.user!.familyId);
    }
    if (req.body?.exploreFeedDailyLimit !== undefined) {
      await db.run('UPDATE families SET exploreFeedDailyLimit = ? WHERE id = ?', clampDailyLimit(req.body.exploreFeedDailyLimit), request.user!.familyId);
    }
    if (req.body?.exploreFeedCategories !== undefined) {
      const raw = req.body.exploreFeedCategories;
      let stored: string | null = null;
      if (Array.isArray(raw)) {
        const list = raw.map((item: unknown) => trimText(item, 20)).filter(Boolean).slice(0, 7);
        if (list.length > 0) stored = JSON.stringify(list);
      }
      await db.run('UPDATE families SET exploreFeedCategories = ? WHERE id = ?', stored, request.user!.familyId);
    }
    res.json({ message: '发现推送设置已更新' });
  });

  // 家长端：关注源增删（软删）
  app.post('/api/parent/explore/feed-sources', ...parentGuards, async (req: any, res: any) => {
    const request = req as AuthRequest;
    const db = getDb();
    const url = trimText(req.body?.url, 500);
    if (!isHttpUrl(url)) return res.status(400).json({ message: '请输入 http 或 https 开头的网址' });
    if (!isSafePublicUrl(url)) return res.status(400).json({ message: '这个网址不能添加，请使用公开网站地址' });
    const countRow = await db.get(
      'SELECT COUNT(*) as c FROM explore_feed_sources WHERE familyId = ? AND isActive = 1',
      request.user!.familyId
    );
    if ((countRow?.c || 0) >= MAX_ACTIVE_SOURCES) {
      return res.status(400).json({ message: `最多添加 ${MAX_ACTIVE_SOURCES} 个关注源，请先移除一些` });
    }
    const id = randomUUID();
    await db.run(
      'INSERT INTO explore_feed_sources (id, familyId, url, label) VALUES (?, ?, ?, ?)',
      id, request.user!.familyId, url, trimText(req.body?.label, 40) || null
    );
    res.json({ message: '关注源已添加', id });
  });

  app.delete('/api/parent/explore/feed-sources/:id', ...parentGuards, async (req: any, res: any) => {
    const request = req as AuthRequest;
    const db = getDb();
    const source = await db.get(
      'SELECT id FROM explore_feed_sources WHERE id = ? AND familyId = ? AND isActive = 1',
      req.params.id, request.user!.familyId
    );
    if (!source) return res.status(404).json({ message: '关注源不存在' });
    await db.run('UPDATE explore_feed_sources SET isActive = 0 WHERE id = ?', source.id);
    res.json({ message: '关注源已移除' });
  });

  // 家长端：待审核 → 通过 / 忽略
  app.post('/api/parent/explore/feed/:id/approve', ...parentGuards, async (req: any, res: any) => {
    const request = req as AuthRequest;
    const db = getDb();
    const item = await db.get(
      "SELECT id FROM explore_feed_items WHERE id = ? AND familyId = ? AND status = 'pending_review'",
      req.params.id, request.user!.familyId
    );
    if (!item) return res.status(404).json({ message: '待审核条目不存在' });
    await db.run("UPDATE explore_feed_items SET status = 'new', recommendDate = ? WHERE id = ?", getBeijingDateString(), item.id);
    res.json({ message: '已通过，孩子可以看到了' });
  });

  app.post('/api/parent/explore/feed/:id/reject', ...parentGuards, async (req: any, res: any) => {
    const request = req as AuthRequest;
    const db = getDb();
    const item = await db.get(
      "SELECT id FROM explore_feed_items WHERE id = ? AND familyId = ? AND status = 'pending_review'",
      req.params.id, request.user!.familyId
    );
    if (!item) return res.status(404).json({ message: '待审核条目不存在' });
    await db.run("UPDATE explore_feed_items SET status = 'dismissed' WHERE id = ?", item.id);
    res.json({ message: '已忽略' });
  });

  // 家长端：粘贴链接 → 抓 og 标签生成预览（退化用 <title>）
  app.post('/api/parent/explore/feed/push-link', ...parentGuards, async (req: any, res: any) => {
    const url = trimText(req.body?.url, 500);
    if (!isHttpUrl(url)) return res.status(400).json({ message: '请输入 http 或 https 开头的链接' });
    if (!isSafePublicUrl(url)) return res.status(400).json({ message: '这个链接不能解析，请使用公开网站地址' });
    try {
      const html = await fetchHtml(url);
      const pick = (re: RegExp) => {
        const matched = html.match(re);
        return matched ? matched[1].trim() : '';
      };
      const og = (prop: string) =>
        pick(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, 'i')) ||
        pick(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, 'i'));
      const title = decodeHtmlEntities(og('title') || pick(/<title[^>]*>([^<]+)<\/title>/i));
      const imageUrl = trimText(og('image'), 500);
      const summary = decodeHtmlEntities(og('description') || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i));
      res.json({
        title: trimText(title, 80),
        imageUrl: isHttpUrl(imageUrl) ? imageUrl : '',
        summary: trimText(summary, 200),
        sourceUrl: url,
      });
    } catch (err: any) {
      logger.warn('[ExploreFeed] 链接预览抓取失败:', url, err?.message || err);
      res.status(502).json({ message: '没能读取这个链接，可以手动填写标题和介绍' });
    }
  });

  // 家长端：直接推荐给孩子（type='parent'，孩子端置顶）
  app.post('/api/parent/explore/feed/push', ...parentGuards, async (req: any, res: any) => {
    const request = req as AuthRequest;
    const title = trimText(req.body?.title, 80);
    if (!title) return res.status(400).json({ message: '请填写推荐标题' });
    const summary = trimText(req.body?.summary, 200);
    const imageUrl = trimText(req.body?.imageUrl, 500);
    const sourceUrl = trimText(req.body?.sourceUrl, 500);
    if (imageUrl && !isHttpUrl(imageUrl)) return res.status(400).json({ message: '图片地址需要 http 或 https 开头' });
    if (sourceUrl && !isHttpUrl(sourceUrl)) return res.status(400).json({ message: '链接需要 http 或 https 开头' });
    const id = randomUUID();
    await getDb().run(
      `INSERT INTO explore_feed_items (id, familyId, type, title, summary, imageUrl, sourceUrl, status, recommendDate)
       VALUES (?, ?, 'parent', ?, ?, ?, ?, 'new', ?)`,
      id,
      request.user!.familyId,
      title,
      summary || null,
      imageUrl || null,
      sourceUrl || null,
      getBeijingDateString()
    );
    res.json({ message: '已经推荐给孩子啦', id });
  });

  // 家长端：立即生成今日推荐——跳过“当天已生成”短路，去重与每日上限内只补足缺口，幂等可重复点
  app.post('/api/parent/explore/feed/generate-now', ...parentGuards, async (req: any, res: any) => {
    const request = req as AuthRequest;
    const db = getDb();
    const family = await db.get(
      'SELECT id, exploreCity, exploreFeedDailyLimit, exploreFeedCategories FROM families WHERE id = ?',
      request.user!.familyId
    );
    if (!family) return res.status(404).json({ message: '家庭不存在' });
    const now = new Date();
    const beijingNow = getBeijingDate(now);
    const insertedCount = await generateFeedForFamily(db, family, getBeijingDateString(now), beijingNow, beijingNow.getDay());
    res.json({ message: '今日推荐已生成', insertedCount });
  });

  // 家长端：观察统计（月打卡数 / 点亮地点数 / 分类分布 / 本月新增想去）
  app.get('/api/parent/explore/stats', ...parentGuards, async (req: any, res: any) => {
    const request = req as AuthRequest;
    const db = getDb();
    const familyId = request.user!.familyId;
    const monthCheckins = await db.get(
      `SELECT COUNT(*) as c FROM explore_checkins
       WHERE familyId = ? AND date(checkedInAt, '+8 hours') >= date('now', '+8 hours', 'start of month')`,
      familyId
    );
    const litPlaces = await db.get(
      `SELECT COUNT(DISTINCT ec.placeId) as c
       FROM explore_checkins ec
       JOIN explore_places p ON ec.placeId = p.id
       WHERE ec.familyId = ? AND p.deletedAt IS NULL`,
      familyId
    );
    const categoryDistribution = await db.all(
      `SELECT p.category as category, COUNT(DISTINCT p.id) as count
       FROM explore_checkins ec
       JOIN explore_places p ON ec.placeId = p.id
       WHERE ec.familyId = ? AND p.deletedAt IS NULL
       GROUP BY p.category
       ORDER BY count DESC`,
      familyId
    );
    const monthWanted = await db.get(
      `SELECT COUNT(*) as c FROM explore_places
       WHERE familyId = ? AND status = 'wishlist' AND deletedAt IS NULL
         AND date(createdAt, '+8 hours') >= date('now', '+8 hours', 'start of month')`,
      familyId
    );
    res.json({
      monthCheckinCount: monthCheckins?.c || 0,
      visitedPlaceCount: litPlaces?.c || 0,
      categoryDistribution,
      monthWantedCount: monthWanted?.c || 0,
    });
  });
};
