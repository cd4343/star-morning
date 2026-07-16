import { Express } from 'express';
import axios from 'axios';
import { randomUUID, createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { getDb } from './database';
import {
  getChildExploreIntent,
  getEnrichmentRetryAt,
  isExploreFeedItemComplete,
  registerExploreExperienceRoutes,
  selectExploreRecommendations,
} from './exploreExperience';

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
const MAX_FEED_IMAGE_BYTES = 1024 * 1024;
const MAX_ACTIVE_SOURCES = 10;
const EXPLORE_FEED_UPLOAD_ROOT = path.resolve(__dirname, '../../uploads/explore');

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
const finiteNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

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

const isPrivateIpAddress = (address: string): boolean => {
  const normalized = address.toLowerCase();
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168);
  }
  if (isIP(normalized) === 6) {
    return normalized === '::' || normalized === '::1'
      || normalized.startsWith('fc') || normalized.startsWith('fd')
      || normalized.startsWith('fe8') || normalized.startsWith('fe9')
      || normalized.startsWith('fea') || normalized.startsWith('feb')
      || (normalized.startsWith('::ffff:') && isPrivateIpAddress(normalized.slice(7)));
  }
  return true;
};

const assertPublicNetworkUrl = async (value: string) => {
  if (!isSafePublicUrl(value)) throw new Error('网址不是公开地址');
  const host = new URL(value).hostname;
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(item => isPrivateIpAddress(item.address))) {
    throw new Error('网址解析到了非公开网络');
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
  let currentUrl = url;
  for (let redirect = 0; redirect <= 3; redirect++) {
    await assertPublicNetworkUrl(currentUrl);
    const response = await axios.get(currentUrl, {
      timeout: HTTP_TIMEOUT_MS,
      headers: { 'User-Agent': HTTP_USER_AGENT },
      responseType: 'text',
      transformResponse: [(data: any) => data],
      maxContentLength: MAX_FETCH_BYTES,
      maxRedirects: 0,
      validateStatus: status => status >= 200 && status < 400,
    });
    if (response.status >= 300) {
      const location = trimText(response.headers.location, 500);
      if (!location || redirect === 3) throw new Error('网址重定向次数过多');
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return String(response.data || '');
  }
  throw new Error('网址读取失败');
};

const getImageType = (buffer: Buffer, declaredType = ''): { mimeType: string; extension: string } | null => {
  const startsWith = (bytes: number[], offset = 0) =>
    buffer.length >= offset + bytes.length && bytes.every((byte, index) => buffer[offset + index] === byte);
  const ascii = (value: string, offset = 0) => buffer.toString('latin1', offset, offset + value.length) === value;
  if (startsWith([0xFF, 0xD8, 0xFF])) return { mimeType: 'image/jpeg', extension: 'jpg' };
  if (startsWith([0x89, 0x50, 0x4E, 0x47])) return { mimeType: 'image/png', extension: 'png' };
  if (ascii('RIFF') && ascii('WEBP', 8)) return { mimeType: 'image/webp', extension: 'webp' };
  if (declaredType && !['image/jpeg', 'image/png', 'image/webp'].includes(declaredType)) return null;
  return null;
};

const saveFeedImageBuffer = async (buffer: Buffer, declaredType: string, familyId: string) => {
  if (buffer.length === 0 || buffer.length > MAX_FEED_IMAGE_BYTES) throw new Error('推荐图片必须小于 1MB');
  const imageType = getImageType(buffer, declaredType.split(';')[0].trim().toLowerCase());
  if (!imageType) throw new Error('推荐图片只支持 JPG、PNG 或 WebP');
  const folder = path.join(EXPLORE_FEED_UPLOAD_ROOT, familyId, 'feed');
  await fs.mkdir(folder, { recursive: true });
  const filename = `${randomUUID()}.${imageType.extension}`;
  await fs.writeFile(path.join(folder, filename), buffer);
  return `/uploads/explore/${familyId}/feed/${filename}`;
};

const saveFeedImageDataUrl = async (dataUrl: string, familyId: string) => {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error('上传图片格式不正确');
  return saveFeedImageBuffer(Buffer.from(match[2], 'base64'), match[1], familyId);
};

const downloadFeedImage = async (sourceUrl: string, familyId: string) => {
  let currentUrl = sourceUrl;
  for (let redirect = 0; redirect <= 3; redirect++) {
    await assertPublicNetworkUrl(currentUrl);
    const response = await axios.get(currentUrl, {
      timeout: HTTP_TIMEOUT_MS,
      headers: { 'User-Agent': HTTP_USER_AGENT },
      responseType: 'arraybuffer',
      maxContentLength: MAX_FEED_IMAGE_BYTES,
      maxBodyLength: MAX_FEED_IMAGE_BYTES,
      maxRedirects: 0,
      validateStatus: status => status >= 200 && status < 400,
    });
    if (response.status >= 300) {
      const location = trimText(response.headers.location, 500);
      if (!location || redirect === 3) throw new Error('图片重定向次数过多');
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return saveFeedImageBuffer(Buffer.from(response.data), String(response.headers['content-type'] || ''), familyId);
  }
  throw new Error('图片下载失败');
};

const extractLinkPreview = (html: string, url: string) => {
  const pick = (re: RegExp) => {
    const matched = html.match(re);
    return matched ? matched[1].trim() : '';
  };
  const og = (prop: string) =>
    pick(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
    || pick(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, 'i'));
  const rawImageUrl = trimText(og('image'), 500);
  let structured: any = null;
  const jsonLdPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLdMatch: RegExpExecArray | null;
  while ((jsonLdMatch = jsonLdPattern.exec(html)) !== null && !structured) {
    try {
      const parsed = JSON.parse(decodeHtmlEntities(jsonLdMatch[1]).trim());
      const nodes = (Array.isArray(parsed) ? parsed : [parsed]).flatMap((node: any) => Array.isArray(node?.['@graph']) ? node['@graph'] : [node]);
      structured = nodes.find((node: any) => {
        const types = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
        return types.some((type: unknown) => ['Event', 'Place', 'TouristAttraction'].includes(String(type || '')));
      }) || null;
    } catch { /* 单条 JSON-LD 解析失败时继续查找下一条 */ }
  }
  const location = structured?.location || structured?.contentLocation || null;
  const address = location?.address || structured?.address || null;
  const structuredImage = Array.isArray(structured?.image)
    ? structured.image[0]
    : (typeof structured?.image === 'object' ? structured.image?.url : structured?.image);
  const rawStructuredImage = trimText(structuredImage, 500);
  let imageUrl = '';
  try { imageUrl = rawImageUrl || rawStructuredImage ? new URL(rawImageUrl || rawStructuredImage, url).toString() : ''; } catch { imageUrl = ''; }
  return {
    title: trimText(decodeHtmlEntities(og('title') || structured?.name || pick(/<title[^>]*>([^<]+)<\/title>/i)), 80),
    summary: trimText(decodeHtmlEntities(og('description') || structured?.description || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)), 200),
    imageUrl: isHttpUrl(imageUrl) ? imageUrl : '',
    sourceUrl: url,
    venue: trimText(location?.name || (typeof location === 'string' ? location : ''), 80),
    city: trimText(address?.addressLocality || address?.addressRegion, 40),
    district: trimText(address?.addressRegion, 40),
    activityStart: trimText(structured?.startDate, 20),
    activityEnd: trimText(structured?.endDate, 20),
  };
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
    const imageSourceUrl = trimText(photos[0]?.url, 500);
    const address = Array.isArray(poi?.address) ? poi.address.join('') : trimText(poi?.address, 160);
    const summary = trimText(address, 160) || trimText(poi?.type, 160);
    const city = trimText(Array.isArray(poi?.cityname) ? poi.cityname.join('') : poi?.cityname, 40);
    const district = trimText(Array.isArray(poi?.adname) ? poi.adname.join('') : poi?.adname, 40);
    const createdAt = new Date().toISOString();
    let imageUrl = '';
    let imageError = '';
    if (imageSourceUrl && isHttpUrl(imageSourceUrl)) {
      try { imageUrl = await downloadFeedImage(imageSourceUrl, family.id); }
      catch (error: any) { imageError = trimText(error?.message || '高德图片下载失败', 200); }
    }
    const candidate = { title, summary, imageUrl, latitude, longitude, city, district };
    const complete = isExploreFeedItemComplete(candidate);
    await db.run(
      `INSERT INTO explore_feed_items (
         id, familyId, type, title, summary, imageUrl, category, latitude, longitude, amapPoiId, status,
         recommendDate, city, district, enrichmentStatus, enrichmentAttempts, nextEnrichmentAt,
         lastEnrichmentError, imageSourceUrl, contentSourceType, experienceTags, createdAt
       ) VALUES (?, ?, 'poi', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'amap', ?, ?)`,
      randomUUID(),
      family.id,
      title,
      summary || null,
      imageUrl || null,
      rotation.label,
      Number.isFinite(latitude) ? latitude : null,
      Number.isFinite(longitude) ? longitude : null,
      amapPoiId || null,
      complete ? 'new' : 'pending_review',
      today,
      city || null,
      district || null,
      complete ? 'ready' : 'waiting',
      complete ? null : getEnrichmentRetryAt(createdAt, 0),
      complete ? null : (imageError || '缺少可用图片或地点说明'),
      imageSourceUrl || null,
      JSON.stringify([rotation.label, trimText(poi?.type, 40)].filter(Boolean)),
      createdAt
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
  const createdAt = new Date().toISOString();
  await db.run(
    `INSERT INTO explore_feed_items (
       id, familyId, type, title, summary, category, status, recommendDate, enrichmentStatus,
       enrichmentAttempts, nextEnrichmentAt, lastEnrichmentError, contentSourceType, experienceTags, createdAt
     ) VALUES (?, ?, 'festival', ?, ?, '节日', 'pending_review', ?, 'waiting', 0, ?, ?, 'system', ?, ?)`,
    randomUUID(), family.id, rule.title, rule.summary, today,
    getEnrichmentRetryAt(createdAt, 0),
    '节日灵感还需要真实活动地点和图片，暂不向孩子展示',
    JSON.stringify(['节庆', '亲子活动']),
    createdAt
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
      const feedItemId = randomUUID();
      const createdAt = new Date().toISOString();
      await db.run(
        `INSERT INTO explore_feed_items (
           id, familyId, type, title, summary, sourceUrl, category, status, recommendDate,
           enrichmentStatus, enrichmentAttempts, nextEnrichmentAt, lastEnrichmentError,
           contentSourceType, experienceTags, createdAt
         ) VALUES (?, ?, 'source', ?, ?, ?, '活动', 'pending_review', ?, 'waiting', 0, ?, ?, 'official', ?, ?)`,
        feedItemId,
        family.id,
        item.text,
        source.label ? `来自「${trimText(source.label, 40)}」` : '来自家长关注的网站',
        trimText(absoluteUrl, 500),
        today,
        getEnrichmentRetryAt(createdAt, 0),
        '正在从官方页面补全图片和活动信息',
        JSON.stringify(['亲子活动']),
        createdAt
      );
      await enrichExploreFeedItem(db, feedItemId, family.id, false);
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

const loadAmapPoiDetails = async (amapPoiId: string) => {
  const key = process.env.AMAP_WEB_SERVICE_KEY;
  if (!key || !amapPoiId) return null;
  const result = await axios.get('https://restapi.amap.com/v3/place/detail', {
    params: { key, id: amapPoiId, extensions: 'all' },
    timeout: HTTP_TIMEOUT_MS,
    headers: { 'User-Agent': HTTP_USER_AGENT },
  });
  if (String(result.data?.status) !== '1') return null;
  return Array.isArray(result.data?.pois) ? result.data.pois[0] || null : null;
};

const markEnrichmentFailure = async (db: any, item: any, reason: string, advanceAttempt = true) => {
  const attempts = Math.max(0, Number(item.enrichmentAttempts) || 0) + (advanceAttempt ? 1 : 0);
  const nextEnrichmentAt = getEnrichmentRetryAt(String(item.createdAt || new Date().toISOString()), attempts);
  await db.run(
    `UPDATE explore_feed_items
        SET enrichmentStatus = ?, enrichmentAttempts = ?, nextEnrichmentAt = ?, lastEnrichmentError = ?
      WHERE id = ?`,
    nextEnrichmentAt ? 'waiting' : 'failed',
    attempts,
    nextEnrichmentAt,
    trimText(reason, 300),
    item.id
  );
  return { ready: false, attempts, nextEnrichmentAt, error: trimText(reason, 300) };
};

export const enrichExploreFeedItem = async (db: any, itemId: string, familyId?: string, advanceAttempt = true) => {
  const item = await db.get(
    `SELECT * FROM explore_feed_items WHERE id = ?${familyId ? ' AND familyId = ?' : ''}`,
    ...(familyId ? [itemId, familyId] : [itemId])
  );
  if (!item) throw Object.assign(new Error('推荐内容不存在'), { statusCode: 404 });

  const candidate: any = { ...item };
  try {
    if (item.contentSourceType === 'amap' || item.type === 'poi') {
      const poi = await loadAmapPoiDetails(trimText(item.amapPoiId, 80));
      if (poi) {
        const [lngRaw, latRaw] = String(poi.location || '').split(',');
        const photos = Array.isArray(poi.photos) ? poi.photos : [];
        candidate.title = candidate.title || trimText(poi.name, 80);
        candidate.summary = candidate.summary || trimText(Array.isArray(poi.address) ? poi.address.join('') : poi.address, 200) || trimText(poi.type, 200);
        candidate.latitude = finiteNumberOrNull(latRaw) ?? candidate.latitude;
        candidate.longitude = finiteNumberOrNull(lngRaw) ?? candidate.longitude;
        candidate.city = candidate.city || trimText(Array.isArray(poi.cityname) ? poi.cityname.join('') : poi.cityname, 40);
        candidate.district = candidate.district || trimText(Array.isArray(poi.adname) ? poi.adname.join('') : poi.adname, 40);
        candidate.imageSourceUrl = candidate.imageSourceUrl || trimText(photos[0]?.url, 500);
      }
    } else if ((item.contentSourceType === 'official' || item.type === 'source' || item.type === 'parent') && (item.officialUrl || item.sourceUrl)) {
      const sourceUrl = trimText(item.officialUrl || item.sourceUrl, 500);
      if (isSafePublicUrl(sourceUrl)) {
        const preview = extractLinkPreview(await fetchHtml(sourceUrl), sourceUrl);
        candidate.title = candidate.title || preview.title;
        candidate.summary = !candidate.summary || /^来自[「家]/.test(String(candidate.summary)) ? preview.summary : candidate.summary;
        candidate.imageSourceUrl = candidate.imageSourceUrl || preview.imageUrl;
        candidate.venue = candidate.venue || preview.venue;
        candidate.city = candidate.city || preview.city;
        candidate.district = candidate.district || preview.district;
        candidate.activityStart = candidate.activityStart || preview.activityStart;
        candidate.activityEnd = candidate.activityEnd || preview.activityEnd;
      }
    }

    const currentImage = trimText(candidate.imageUrl, 500);
    const remoteImage = trimText(candidate.imageSourceUrl || currentImage, 500);
    if (!currentImage.startsWith('/uploads/explore/') && remoteImage) {
      candidate.imageUrl = await downloadFeedImage(remoteImage, item.familyId);
      candidate.imageSourceUrl = remoteImage;
    }

    if (!isExploreFeedItemComplete(candidate)) {
      return markEnrichmentFailure(db, item, '仍缺少真实图片、内容说明或地点/活动信息，请家长补充', advanceAttempt);
    }

    const nextStatus = item.status === 'wanted' || item.status === 'dismissed'
      ? item.status
      : item.type === 'source' ? 'pending_review' : 'new';
    await db.run(
      `UPDATE explore_feed_items SET
         title = ?, summary = ?, imageUrl = ?, imageSourceUrl = ?, latitude = ?, longitude = ?,
         city = ?, district = ?, venue = ?, activityStart = ?, activityEnd = ?, status = ?, enrichmentStatus = 'ready', nextEnrichmentAt = NULL,
         lastEnrichmentError = NULL
       WHERE id = ?`,
      trimText(candidate.title, 80),
      trimText(candidate.summary, 200) || null,
      trimText(candidate.imageUrl, 500) || null,
      trimText(candidate.imageSourceUrl, 500) || null,
      finiteNumberOrNull(candidate.latitude),
      finiteNumberOrNull(candidate.longitude),
      trimText(candidate.city, 40) || null,
      trimText(candidate.district, 40) || null,
      trimText(candidate.venue, 80) || null,
      trimText(candidate.activityStart, 20) || null,
      trimText(candidate.activityEnd, 20) || null,
      nextStatus,
      item.id
    );
    return { ready: true, status: nextStatus };
  } catch (error: any) {
    return markEnrichmentFailure(db, item, error?.message || '自动补全暂时失败', advanceAttempt);
  }
};

export const processExploreEnrichmentQueue = async () => {
  const db = getDb();
  const items = await db.all(
    `SELECT id FROM explore_feed_items
      WHERE enrichmentStatus = 'waiting'
        AND nextEnrichmentAt IS NOT NULL
        AND datetime(nextEnrichmentAt) <= datetime('now')
      ORDER BY nextEnrichmentAt ASC
      LIMIT 20`
  );
  for (const item of items) {
    await enrichExploreFeedItem(db, item.id);
  }
  return items.length;
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
  const runEnrichmentQueue = () => {
    void processExploreEnrichmentQueue().catch(error => logger.error('[ExploreFeed] 自动补全队列失败:', error));
  };
  setTimeout(runEnrichmentQueue, 12000);
  const enrichmentTimer = setInterval(runEnrichmentQueue, 15 * 60 * 1000);
  enrichmentTimer.unref?.();
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
            recommendScore, city, recommendDate, createdAt, enrichmentStatus,
            enrichmentAttempts, nextEnrichmentAt, lastEnrichmentError, contentSourceType
       FROM explore_feed_items
      WHERE familyId = ? AND (status = 'pending_review' OR enrichmentStatus IN ('waiting', 'failed'))
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
  registerExploreExperienceRoutes(app, getDb, protect, requireParent, requireChild);

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
              recommendReason, notes, verifyStatus, recommendScore, status, recommendDate, createdAt,
              enrichmentStatus, contentSourceType, experienceTags, city
       FROM explore_feed_items
       WHERE ${conds.join(' AND ')}
       ORDER BY CASE type WHEN 'parent' THEN 0 ELSE 1 END, COALESCE(recommendScore, 0) DESC, recommendDate DESC, createdAt DESC
       LIMIT 50`,
      ...params
    );
    const intent = await getChildExploreIntent(db, request.user!.familyId, request.user!.id);
    const recommendations = selectExploreRecommendations(
      rows.filter((item: any) => item.enrichmentStatus !== 'waiting' && item.enrichmentStatus !== 'failed'),
      intent.selections
    );
    res.json(recommendations);
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
    if (item.enrichmentStatus === 'waiting' || item.enrichmentStatus === 'failed' || !isExploreFeedItemComplete(item)) {
      return res.status(404).json({ message: '这条推荐还在补全中' });
    }
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
      'SELECT * FROM explore_feed_items WHERE id = ? AND familyId = ?',
      req.params.id, request.user!.familyId
    );
    if (!item) return res.status(404).json({ message: '这条推荐不存在或已过期' });
    if (item.enrichmentStatus === 'waiting' || item.enrichmentStatus === 'failed' || !isExploreFeedItemComplete(item)) {
      return res.status(404).json({ message: '这条推荐还在补全中' });
    }
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
      "SELECT * FROM explore_feed_items WHERE id = ? AND familyId = ? AND status = 'pending_review'",
      req.params.id, request.user!.familyId
    );
    if (!item) return res.status(404).json({ message: '待审核条目不存在' });
    if (!isExploreFeedItemComplete(item)) {
      return res.status(400).json({ message: '名称、图片、说明和地点/活动信息补全后才能给孩子展示' });
    }
    await db.run(
      "UPDATE explore_feed_items SET status = 'new', enrichmentStatus = 'ready', nextEnrichmentAt = NULL, lastEnrichmentError = NULL, recommendDate = ? WHERE id = ?",
      getBeijingDateString(), item.id
    );
    res.json({ message: '已通过，孩子可以看到了' });
  });

  app.post('/api/parent/explore/feed/:id/reject', ...parentGuards, async (req: any, res: any) => {
    const request = req as AuthRequest;
    const db = getDb();
    const item = await db.get(
      "SELECT id FROM explore_feed_items WHERE id = ? AND familyId = ? AND (status = 'pending_review' OR enrichmentStatus IN ('waiting', 'failed'))",
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
      res.json(extractLinkPreview(await fetchHtml(url), url));
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
    const remoteImageUrl = trimText(req.body?.imageUrl, 500);
    const imageDataUrl = trimText(req.body?.imageDataUrl, 1_500_000);
    const sourceUrl = trimText(req.body?.sourceUrl, 500);
    if (remoteImageUrl && !isHttpUrl(remoteImageUrl)) return res.status(400).json({ message: '图片地址需要 http 或 https 开头' });
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
    const createdAt = new Date().toISOString();
    let imageUrl = '';
    let imageError = '';
    try {
      if (imageDataUrl) {
        imageUrl = await saveFeedImageDataUrl(imageDataUrl, request.user!.familyId);
      } else if (remoteImageUrl && (sourceUrl || officialUrl)) {
        imageUrl = await downloadFeedImage(remoteImageUrl, request.user!.familyId);
      }
    } catch (error: any) {
      if (imageDataUrl) return res.status(400).json({ message: error?.message || '图片上传失败' });
      imageError = trimText(error?.message || '图片下载失败', 200);
    }
    const candidate = {
      title,
      summary,
      imageUrl,
      venue: trimText(req.body?.venue, 80),
      district: trimText(req.body?.district, 40),
      city: trimText(req.body?.city, 40),
      activityStart: trimText(req.body?.activityStart, 20),
      activityEnd: trimText(req.body?.activityEnd, 20),
      signupDeadline: trimText(req.body?.signupDeadline, 20),
    };
    const complete = isExploreFeedItemComplete(candidate);
    const status = complete ? 'new' : 'pending_review';
    const enrichmentStatus = complete ? 'ready' : 'waiting';
    const nextEnrichmentAt = complete ? null : getEnrichmentRetryAt(createdAt, 0);
    const experienceTags = Array.isArray(req.body?.experienceTags)
      ? JSON.stringify(req.body.experienceTags.map((item: unknown) => trimText(item, 40)).filter(Boolean).slice(0, 8))
      : null;
    await getDb().run(
      `INSERT INTO explore_feed_items (
        id, familyId, type, title, summary, imageUrl, sourceUrl, status, recommendDate,
        venue, district, feedCategory, ageMin, ageMax, activityStart, activityEnd, signupDeadline,
        price, bookingMethod, officialUrl, recommendReason, notes, verifyStatus, recommendScore, city, validFrom, validUntil,
        enrichmentStatus, enrichmentAttempts, nextEnrichmentAt, lastEnrichmentError, imageSourceUrl, contentSourceType,
        experienceTags, createdAt
      ) VALUES (?, ?, 'parent', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      id,
      request.user!.familyId,
      title,
      summary || null,
      imageUrl || null,
      sourceUrl || null,
      status,
      getBeijingDateString(),
      candidate.venue || null,
      candidate.district || null,
      trimText(req.body?.feedCategory, 20) || null,
      ageMin,
      ageMax,
      candidate.activityStart || null,
      candidate.activityEnd || null,
      candidate.signupDeadline || null,
      trimText(req.body?.price, 40) || null,
      trimText(req.body?.bookingMethod, 120) || null,
      officialUrl || null,
      trimText(req.body?.recommendReason, 300) || null,
      trimText(req.body?.notes, 300) || null,
      trimText(req.body?.verifyStatus, 20) || '未核验',
      recommendScore,
      candidate.city || null,
      trimText(req.body?.validFrom, 20) || null,
      trimText(req.body?.validUntil, 20) || null,
      enrichmentStatus,
      nextEnrichmentAt,
      complete ? null : (imageError || '还需要补全图片、说明或地点/活动信息'),
      remoteImageUrl || null,
      imageDataUrl ? 'parent_upload' : (sourceUrl || officialUrl ? 'official' : 'parent'),
      experienceTags,
      createdAt
    );
    res.json({
      message: complete ? '已经推荐给孩子啦' : '已保存为待补全，资料完整后再给孩子展示',
      id,
      visibleToChild: complete,
      enrichmentStatus,
    });
  });

  app.post('/api/parent/explore/feed/:id/enrich-now', ...parentGuards, async (req: any, res: any) => {
    const request = req as AuthRequest;
    try {
      const result = await enrichExploreFeedItem(getDb(), req.params.id, request.user!.familyId);
      res.json({
        ...result,
        message: result.ready ? '内容已补全，可以进入推荐流程' : '暂时未补全，请稍后重试或上传图片并补充信息',
      });
    } catch (error: any) {
      res.status(error?.statusCode || 500).json({ message: error?.message || '自动补全失败' });
    }
  });

  app.put('/api/parent/explore/feed/:id', ...parentGuards, async (req: any, res: any) => {
    const request = req as AuthRequest;
    const db = getDb();
    const item = await db.get('SELECT * FROM explore_feed_items WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
    if (!item) return res.status(404).json({ message: '推荐内容不存在' });
    let imageUrl = trimText(item.imageUrl, 500);
    const imageDataUrl = trimText(req.body?.imageDataUrl, 1_500_000);
    if (imageDataUrl) {
      try { imageUrl = await saveFeedImageDataUrl(imageDataUrl, request.user!.familyId); }
      catch (error: any) { return res.status(400).json({ message: error?.message || '图片上传失败' }); }
    }
    const candidate: any = {
      ...item,
      title: trimText(req.body?.title ?? item.title, 80),
      summary: trimText(req.body?.summary ?? item.summary, 200),
      imageUrl,
      city: trimText(req.body?.city ?? item.city, 40),
      district: trimText(req.body?.district ?? item.district, 40),
      venue: trimText(req.body?.venue ?? item.venue, 80),
      feedCategory: trimText(req.body?.feedCategory ?? item.feedCategory, 20),
      activityStart: trimText(req.body?.activityStart ?? item.activityStart, 20),
      activityEnd: trimText(req.body?.activityEnd ?? item.activityEnd, 20),
      signupDeadline: trimText(req.body?.signupDeadline ?? item.signupDeadline, 20),
      price: trimText(req.body?.price ?? item.price, 40),
      bookingMethod: trimText(req.body?.bookingMethod ?? item.bookingMethod, 120),
      officialUrl: trimText(req.body?.officialUrl ?? item.officialUrl, 500),
      recommendReason: trimText(req.body?.recommendReason ?? item.recommendReason, 300),
      notes: trimText(req.body?.notes ?? item.notes, 300),
    };
    if (!candidate.title) return res.status(400).json({ message: '请填写推荐标题' });
    if (candidate.officialUrl && !isHttpUrl(candidate.officialUrl)) return res.status(400).json({ message: '官方链接需要 http 或 https 开头' });
    const complete = isExploreFeedItemComplete(candidate);
    const publish = req.body?.publish === true;
    const nextStatus = complete && publish ? 'new' : 'pending_review';
    const nextEnrichmentAt = complete ? null : getEnrichmentRetryAt(new Date().toISOString(), 0);
    const experienceTags = Array.isArray(req.body?.experienceTags)
      ? JSON.stringify(req.body.experienceTags.map((value: unknown) => trimText(value, 40)).filter(Boolean).slice(0, 8))
      : item.experienceTags;
    await db.run(
      `UPDATE explore_feed_items SET
         title = ?, summary = ?, imageUrl = ?, city = ?, district = ?, venue = ?, feedCategory = ?,
         activityStart = ?, activityEnd = ?, signupDeadline = ?, price = ?, bookingMethod = ?, officialUrl = ?,
         recommendReason = ?, notes = ?, status = ?, enrichmentStatus = ?, enrichmentAttempts = 0, nextEnrichmentAt = ?,
         lastEnrichmentError = ?, contentSourceType = ?, experienceTags = ?, recommendDate = ?
       WHERE id = ? AND familyId = ?`,
      candidate.title,
      candidate.summary || null,
      candidate.imageUrl || null,
      candidate.city || null,
      candidate.district || null,
      candidate.venue || null,
      candidate.feedCategory || null,
      candidate.activityStart || null,
      candidate.activityEnd || null,
      candidate.signupDeadline || null,
      candidate.price || null,
      candidate.bookingMethod || null,
      candidate.officialUrl || null,
      candidate.recommendReason || null,
      candidate.notes || null,
      nextStatus,
      complete ? 'ready' : 'waiting',
      nextEnrichmentAt,
      complete ? null : '还需要补全图片、说明或地点/活动信息',
      imageDataUrl ? 'parent_upload' : (item.contentSourceType || 'parent'),
      experienceTags,
      getBeijingDateString(),
      item.id,
      request.user!.familyId
    );
    res.json({
      message: complete ? (publish ? '资料已补全并推荐给孩子' : '资料已补全，可以审核发布') : '已保存，资料仍不完整，不会向孩子展示',
      ready: complete,
      visibleToChild: complete && publish,
    });
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
