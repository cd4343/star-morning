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
const SOURCE_KEYWORD_RE = /(展览|展出|特展|演出|活动|亲子|讲座|工作坊|市集|研学|导览|绘本|手作|夏令营|冬令营|科技馆|博物馆|美术馆|节)/;
const SOURCE_LINK_RE = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

// --- 官方源增强：RSS/Atom 订阅解析（公众号可经 RSSHub 转 RSS 后接入） ---
const looksLikeFeed = (content: string): boolean => {
  const head = content.slice(0, 800).toLowerCase();
  return head.includes('<?xml') || head.includes('<rss') || /<feed[\s>]/.test(head) || head.includes('<item') || head.includes('<entry');
};

const stripXmlText = (raw: string): string =>
  decodeHtmlEntities(
    raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
  );

// 解析 RSS <item> / Atom <entry>：取标题+链接候选（已截断去重，最多 40 条）。
// 订阅源条目本身已是家长主动关注的活动，不再走关键词硬过滤，交由待审核环节把关。
const parseFeedItems = (content: string): { text: string; href: string }[] => {
  const out: { text: string; href: string }[] = [];
  const blockRe = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(content)) !== null && out.length < 40) {
    const chunk = block[0];
    const titleMatch = chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const text = titleMatch ? trimText(stripXmlText(titleMatch[1]), 80) : '';
    if (text.length < 6) continue;
    let href = '';
    const atomLink = chunk.match(/<link[^>]+href=["']([^"']+)["']/i);
    if (atomLink) href = atomLink[1].trim();
    if (!href) {
      const rssLink = chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
      if (rssLink) href = stripXmlText(rssLink[1]);
    }
    if (!href) {
      const guid = chunk.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
      if (guid) href = stripXmlText(guid[1]);
    }
    if (!isHttpUrl(href)) continue;
    if (out.some(item => item.text === text)) continue;
    out.push({ text, href });
  }
  return out;
};

// 官方源示例：家长一键填入输入框后自行核对再添加（本地场馆/科普机构，或用 RSSHub 接公众号）
const SEED_FEED_SOURCES: { label: string; urlTemplate: string; note: string }[] = [
  { label: '本地博物馆官网', urlTemplate: '', note: '把所在城市博物馆的“展览/活动”栏目页网址填进来，系统会定期抓取活动链接' },
  { label: '本地科技馆 / 少年宫', urlTemplate: '', note: '科技馆或少年宫官网的“活动/教育/报名”页面' },
  { label: '图书馆少儿活动', urlTemplate: '', note: '本地图书馆“少儿/亲子活动”页面' },
  { label: '公众号 → RSS（RSSHub）', urlTemplate: 'https://rsshub.app/wechat/', note: '公众号没有网页版，用 RSSHub 把它转成 RSS 订阅后把地址填这里（已支持 RSS/Atom）' },
];

const fetchSourceItems = async (db: any, family: any, source: any, today: string): Promise<number> => {
  try {
    const content = await fetchHtml(source.url);
    let candidates: { text: string; href: string }[] = [];
    if (looksLikeFeed(content)) {
      // RSS/Atom 订阅：条目已是结构化活动，直接取标题+链接（审核环节再把关）
      candidates = parseFeedItems(content);
    } else {
      let match: RegExpExecArray | null;
      SOURCE_LINK_RE.lastIndex = 0;
      while ((match = SOURCE_LINK_RE.exec(content)) !== null && candidates.length < 40) {
        const href = match[1].trim();
        const text = decodeHtmlEntities(match[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
        if (!href || href.startsWith('#') || /^javascript:/i.test(href)) continue;
        if (text.length < 6 || text.length > 40) continue;
        if (!SOURCE_KEYWORD_RE.test(text)) continue;
        if (candidates.some(item => item.text === text)) continue;
        candidates.push({ text, href });
      }
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

export const getParentExploreFeedSettings = async (
  db: ReturnType<typeof getDb>,
  familyId: string,
  poiEnabled: boolean
) => {
  const family = await db.get(
    'SELECT exploreCity, exploreFeedDailyLimit, exploreFeedCategories FROM families WHERE id = ?',
    familyId
  );
  const sources = await db.all(
    'SELECT id, url, label, lastFetchedAt, createdAt FROM explore_feed_sources WHERE familyId = ? AND isActive = 1 ORDER BY createdAt DESC',
    familyId
  );
  const pendingReview = await db.all(
    `SELECT id, type, title, summary, imageUrl, sourceUrl, category, venue, district,
            feedCategory, ageMin, ageMax, activityStart, activityEnd, signupDeadline,
            price, bookingMethod, officialUrl, recommendReason, notes, verifyStatus,
            recommendScore, city, recommendDate, createdAt
       FROM explore_feed_items
      WHERE familyId = ? AND status = 'pending_review'
      ORDER BY createdAt DESC
      LIMIT 50`,
    familyId
  );
  let categories: string[] | null = null;
  try {
    const parsed = JSON.parse(String(family?.exploreFeedCategories || ''));
    if (Array.isArray(parsed)) {
      const list = parsed.map((item: unknown) => trimText(item, 20)).filter(Boolean);
      if (list.length > 0) categories = list;
    }
  } catch { /* 未配置或非法 JSON 一律按 null 返回 */ }
  return {
    exploreCity: family?.exploreCity || '',
    exploreFeedDailyLimit: clampDailyLimit(family?.exploreFeedDailyLimit ?? 3),
    exploreFeedCategories: categories,
    poiEnabled,
    sources,
    pendingReview,
  };
};

// ==================== B. 路由 ====================

export const registerExploreFeedRoutes = (app: Express, protect: any, requireParent?: any, requireChild?: any) => {
  const childGuards = requireChild ? [protect, requireChild] : [protect];
  const parentGuards = requireParent ? [protect, requireParent] : [protect];

  // 孩子端：今日资讯流（家长推荐置顶，最新优先）
  app.get('/api/child/explore/feed', ...childGuards, async (req: any, res: any) => {
    const request = req as AuthRequest;
    const db = getDb();
    // 探索发现 v2：按孩子年龄 + 推送有效期(按天) + 城市 过滤；过 validUntil 自动下架
    const child = await db.get('SELECT birthdate FROM users WHERE id = ?', request.user!.id);
    let age: number | null = null;
    if (child?.birthdate) {
      const bd = new Date(child.birthdate);
      if (!isNaN(bd.getTime())) {
        const now = getBeijingDate();
        age = now.getFullYear() - bd.getFullYear() - ((now.getMonth() < bd.getMonth() || (now.getMonth() === bd.getMonth() && now.getDate() < bd.getDate())) ? 1 : 0);
      }
    }
    const fam = await db.get('SELECT exploreCity, exploreCities FROM families WHERE id = ?', request.user!.familyId);
    const cities = [
      ...String(fam?.exploreCities || '').split(',').map((c: string) => c.trim()).filter(Boolean),
      ...(fam?.exploreCity ? [String(fam.exploreCity).trim()] : [])
    ];
    const today = getBeijingDateString();
    const conds: string[] = ['familyId = ?', "status = 'new'"];
    const params: any[] = [request.user!.familyId];
    conds.push("(validFrom IS NULL OR validFrom = '' OR date(validFrom) <= date(?))"); params.push(today);
    conds.push("(validUntil IS NULL OR validUntil = '' OR date(validUntil) >= date(?))"); params.push(today);
    if (age != null) {
      conds.push('(ageMin IS NULL OR ageMin <= ?)'); params.push(age);
      conds.push('(ageMax IS NULL OR ageMax >= ?)'); params.push(age);
    }
    if (cities.length > 0) {
      conds.push("(city IS NULL OR city = '' OR city IN (" + cities.map(() => '?').join(',') + '))');
      params.push(...cities);
    }
    const rows = await db.all(
      `SELECT id, type, title, summary, imageUrl, category, feedCategory, venue, district, latitude, longitude,
              sourceUrl, officialUrl, ageMin, ageMax, activityStart, activityEnd, signupDeadline, price, bookingMethod,
              recommendReason, notes, verifyStatus, recommendScore, status, recommendDate, createdAt
       FROM explore_feed_items
       WHERE ${conds.join(' AND ')}
       ORDER BY CASE type WHEN 'parent' THEN 0 ELSE 1 END, COALESCE(recommendScore, 0) DESC, recommendDate DESC, createdAt DESC
       LIMIT 20`,
      ...params
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
    const settings = await getParentExploreFeedSettings(
      getDb(),
      request.user!.familyId,
      !!process.env.AMAP_WEB_SERVICE_KEY
    );
    res.json(settings);
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

  // 家长端：官方源示例（一键填入输入框，家长核对后再添加；含 RSSHub 接公众号说明）
  app.get('/api/parent/explore/feed-sources/suggestions', ...parentGuards, async (_req: any, res: any) => {
    res.json({ suggestions: SEED_FEED_SOURCES });
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
    // 探索发现 v2：结构化字段（全部可选）
    const officialUrl = trimText(req.body?.officialUrl, 500);
    if (officialUrl && !isHttpUrl(officialUrl)) return res.status(400).json({ message: '官方链接需要 http 或 https 开头' });
    const toIntOrNull = (v: any) => { if (v === null || v === undefined || String(v).trim() === '') return null; const n = Math.round(Number(v)); return Number.isFinite(n) ? n : null; };
    const ageMin = toIntOrNull(req.body?.ageMin);
    const ageMax = toIntOrNull(req.body?.ageMax);
    const scoreRaw = toIntOrNull(req.body?.recommendScore);
    const recommendScore = scoreRaw == null ? null : Math.max(1, Math.min(5, scoreRaw));
    const id = randomUUID();
    await getDb().run(
      `INSERT INTO explore_feed_items (
        id, familyId, type, title, summary, imageUrl, sourceUrl, status, recommendDate,
        venue, district, feedCategory, ageMin, ageMax, activityStart, activityEnd, signupDeadline,
        price, bookingMethod, officialUrl, recommendReason, notes, verifyStatus, recommendScore, city, validFrom, validUntil
      ) VALUES (?, ?, 'parent', ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      request.user!.familyId,
      title,
      summary || null,
      imageUrl || null,
      sourceUrl || null,
      getBeijingDateString(),
      trimText(req.body?.venue, 80) || null,
      trimText(req.body?.district, 40) || null,
      trimText(req.body?.feedCategory, 20) || null,
      ageMin,
      ageMax,
      trimText(req.body?.activityStart, 20) || null,
      trimText(req.body?.activityEnd, 20) || null,
      trimText(req.body?.signupDeadline, 20) || null,
      trimText(req.body?.price, 40) || null,
      trimText(req.body?.bookingMethod, 120) || null,
      officialUrl || null,
      trimText(req.body?.recommendReason, 300) || null,
      trimText(req.body?.notes, 300) || null,
      trimText(req.body?.verifyStatus, 20) || '未核验',
      recommendScore,
      trimText(req.body?.city, 40) || null,
      trimText(req.body?.validFrom, 20) || null,
      trimText(req.body?.validUntil, 20) || null
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

  // 家长端：观察统计（月打卡数 / 点亮地点数 / 分类分布 / 本月新增想去 / 去过的地点清单）
  // P1b：支持 ?childId= 按孩子筛选（不传=全家）；新增 visitedPlaces 清单（名称/类型/次数/最近日期）
  app.get('/api/parent/explore/stats', ...parentGuards, async (req: any, res: any) => {
    const request = req as AuthRequest;
    const db = getDb();
    const familyId = request.user!.familyId;
    // P1b：按孩子筛选——校验该孩子属于本家庭（与家长成就接口一致）
    const childId = typeof req.query.childId === 'string' ? req.query.childId : '';
    if (childId) {
      const child = await db.get('SELECT id FROM users WHERE id = ? AND familyId = ? AND role = "child"', childId, familyId);
      if (!child) return res.status(404).json({ message: '孩子不存在' });
    }
    // 打卡类查询的孩子筛选片段与参数（explore_places 无 childId，故"本月新想去"保持家庭级）
    const ckFilter = childId ? ' AND ec.childId = ?' : '';
    const ckArgs = childId ? [childId] : [];

    const monthCheckins = await db.get(
      `SELECT COUNT(*) as c FROM explore_checkins ec
       WHERE ec.familyId = ? AND date(ec.checkedInAt, '+8 hours') >= date('now', '+8 hours', 'start of month')${ckFilter}`,
      familyId, ...ckArgs
    );
    const litPlaces = await db.get(
      `SELECT COUNT(DISTINCT ec.placeId) as c
       FROM explore_checkins ec
       JOIN explore_places p ON ec.placeId = p.id
       WHERE ec.familyId = ? AND p.deletedAt IS NULL${ckFilter}`,
      familyId, ...ckArgs
    );
    const categoryDistribution = await db.all(
      `SELECT p.category as category, COUNT(DISTINCT p.id) as count
       FROM explore_checkins ec
       JOIN explore_places p ON ec.placeId = p.id
       WHERE ec.familyId = ? AND p.deletedAt IS NULL${ckFilter}
       GROUP BY p.category
       ORDER BY count DESC`,
      familyId, ...ckArgs
    );
    // P1b：去过的地点清单——名称 + 类型 + 打卡次数 + 最近打卡日期（按最近优先）
    const visitedPlaces = await db.all(
      `SELECT p.id as placeId, p.title as title, p.category as category,
              COUNT(ec.id) as checkinCount, MAX(ec.checkedInAt) as lastVisitedAt
       FROM explore_checkins ec
       JOIN explore_places p ON ec.placeId = p.id
       WHERE ec.familyId = ? AND p.deletedAt IS NULL${ckFilter}
       GROUP BY p.id
       ORDER BY lastVisitedAt DESC`,
      familyId, ...ckArgs
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
      visitedPlaces,
      monthWantedCount: monthWanted?.c || 0,
    });
  });
};
