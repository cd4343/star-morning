import express, { Request, Response, NextFunction } from 'express';
// 让 async 路由抛出的错误自动转交全局错误中间件（Express4 默认不转发，否则请求会挂到 30s 超时）
import 'express-async-errors';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import axios from 'axios';
import { initializeDatabase, getDb } from './database';
import { startBackupScheduler } from './backup';
import { initRewardTables, initLotteryTables, registerRewardSystemRoutes, calculateReviewSuggestion, drawChestReward, getChestTriggerResult, recordChestReward, calculateAdjustedPunishment, drawPrizeCoreV2, getLotteryPityInfo } from './rewardSystem';
import { registerProductConfigRoutes } from './productConfigRoutes';
import { registerParentInboxRoutes } from './parentInboxRoutes';
import { registerEconomyRoutes } from './economyRoutes';
import {
  assertPaidLotteryDrawAllowed,
  getLotterySafetySettings,
  isLotteryInventoryVisible,
  normalizeLotteryPrize,
  normalizeLotteryPrizeInput,
  setLotteryEnabled,
  validateLotteryActivationIds,
} from './lotteryRules';
import { getTaskRewardSuggestion, normalizeRewardCategory } from './taskRewards';
import { registerExploreFeedRoutes, startExploreFeedScheduler } from './exploreFeed';
import { registerWeeklyReportRoutes, startWeeklyReportScheduler } from './weeklyReport';
import { normalizeShopReferenceRmb, toChildWish, toParentWish } from './wishEconomy';
import { settleTaskEntry, syncTaskSettlementCoinAdjustment, TaskSettlementError } from './taskSettlement';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'stellar-system-dev-secret-change-in-production';
// Token 有效期：单设备家庭场景，默认 30 天；过期后前端 401 拦截器引导重新登录
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '30d') as jwt.SignOptions['expiresIn'];
const isProduction = process.env.NODE_ENV === 'production';
const verboseRequestLogs = process.env.REQUEST_LOGS === 'true' || !isProduction;
// 安全守卫：未设置 JWT_SECRET 时，仅显式声明 NODE_ENV=development/test 才允许默认密钥启动。
// NODE_ENV 未设置一律按生产对待，防止生产服务器漏配 NODE_ENV 绕过校验（Rule 12：失败要大声）。
const KNOWN_WEAK_SECRETS = [
  'stellar-system-dev-secret-change-in-production',
  'stellar-system-production-secret-change-me', // 旧版 start_server_simple.bat 的兜底值
];
const isDevLike = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
if (!isDevLike && (!process.env.JWT_SECRET || KNOWN_WEAK_SECRETS.includes(process.env.JWT_SECRET))) {
  console.error('❌ JWT_SECRET 未设置或使用了公开的默认值！服务拒绝启动（Rule 12：失败要大声）。');
  console.error('   请运行 scripts\\setup_server_production.bat 生成真实密钥，本地开发请设置 NODE_ENV=development。');
  process.exit(1);
}

// 启动时打印日志，便于调试
console.log('🔧 Initializing Express app...');

// 反向代理场景需设置 TRUST_PROXY（如 1），否则限流按代理 IP 计数会失效；
// 当前部署（前端 Python:80 + API 直连:3001）无代理，默认关闭。
if (process.env.TRUST_PROXY) {
  const tp = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isNaN(tp) ? process.env.TRUST_PROXY : tp);
}

const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors(corsOrigin
  ? { origin: corsOrigin.split(',').map(origin => origin.trim()), credentials: true }
  : isProduction
    ? { origin: false }
    : { origin: true, credentials: true }
));
app.use(helmet());
app.use(compression()); // P0(f): gzip 压缩 JSON/文本响应，减小传输体积
app.use(express.json({ limit: '20mb' }));

const exploreUploadRoot = path.resolve(__dirname, '../../uploads/explore');
app.use('/uploads/explore', express.static(exploreUploadRoot));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: '尝试次数过多，请稍后再试' }
});

app.use([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/reset-password',
  '/api/auth/sms/send',
  '/api/auth/sms/login',
  '/api/auth/mobile/one-click-login',
  '/api/auth/switch-user',
  '/api/child/switch-to-parent'
], authLimiter);

// 请求日志中间件 - 用于调试
app.use((req, res, next) => {
  const start = Date.now();
  if (verboseRequestLogs) {
    console.log(`📥 [${new Date().toISOString()}] ${req.method} ${req.path} - Started`);
  }

  res.on('finish', () => {
    const duration = Date.now() - start;
    if (verboseRequestLogs || res.statusCode >= 500) {
      console.log(`📤 [${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    }
  });

  next();
});

type UserRole = 'parent' | 'child';
interface AuthRequest extends Request { user?: { id: string; familyId: string; role: UserRole; }; }

const requireRole = (role: UserRole) => (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== role) {
    return res.status(403).json({ message: '权限不足' });
  }
  next();
};

const requireParent = requireRole('parent');
const requireChild = requireRole('child');

const decodeQueryText = (value: unknown) => {
  const text = String(value || '');
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

const TASK_CATEGORY_ALIASES: Record<string, string[]> = {
  '生活': ['生活', '劳动', '生活习惯', '日常', '家务'],
  '学习': ['学习', '学业', '阅读'],
  '早晨启动': ['早晨启动', '晨间启动', '晨读', '早晨复习', '起床复习'],
  '运动': ['运动', '锻炼', '体育'],
  '活动': ['活动', '兴趣', '艺术', '亲子', '项目'],
  '情绪调节': ['情绪调节', '情绪', '冷静', '冷静练习', '情绪自助'],
  '其他': ['其他', '协作', '合作', '未分类'],
};

const normalizeTaskCategoryInput = (value: unknown) => {
  const text = decodeQueryText(value).trim();
  if (TASK_CATEGORY_ALIASES[text]) return text;
  const hit = Object.entries(TASK_CATEGORY_ALIASES).find(([, aliases]) => aliases.includes(text));
  return hit?.[0] || '其他';
};

type TaskCompletionMode = 'timer' | 'participation' | 'count' | 'checklist';

const getDefaultTaskCompletionMode = (category: string): TaskCompletionMode => {
  if (category === '运动' || category === '活动' || category === '情绪调节') return 'participation';
  return 'timer';
};

const normalizeTaskCompletionMode = (mode: unknown, category: string): TaskCompletionMode => {
  const raw = String(mode || '').trim();
  if (['timer', 'participation', 'count', 'checklist'].includes(raw)) return raw as TaskCompletionMode;
  return getDefaultTaskCompletionMode(category);
};

const getDefaultTaskTargetUnit = (mode: TaskCompletionMode, category: string) => {
  if (mode === 'count') return category === '运动' ? '个/组' : '项';
  if (mode === 'checklist') return '项';
  if (category === '情绪调节') return '次/步骤';
  if (mode === 'participation') return category === '运动' ? '分钟/组' : '分钟/次';
  return '分钟';
};

const normalizeTaskCompletionSettings = (body: any, category: string, fallback?: any) => {
  const completionMode = normalizeTaskCompletionMode(body.completionMode ?? fallback?.completionMode, category);
  const rawTarget = body.targetValue ?? fallback?.targetValue;
  const targetValue = rawTarget === undefined || rawTarget === null || rawTarget === ''
    ? null
    : Math.max(0, Math.round(Number(rawTarget) || 0));
  const targetUnit = String(body.targetUnit ?? fallback?.targetUnit ?? getDefaultTaskTargetUnit(completionMode, category)).trim();
  const reviewFocus = String(body.reviewFocus ?? fallback?.reviewFocus ?? '').trim().slice(0, 120);
  return { completionMode, targetValue, targetUnit, reviewFocus };
};

const getTaskCategoryFilterValues = (value: unknown) => {
  const text = decodeQueryText(value).trim();
  if (!text || text === 'all' || text === '全部') return [];
  return TASK_CATEGORY_ALIASES[text] || [text];
};

const EXPLORE_CATEGORIES = ['博物馆', '科技馆', '自然', '公园', '城市', '活动', '旅行', '运动体验', '公益体验', '其他'];
const EXPLORE_STATUSES = ['wishlist', 'planned', 'visited', 'archived'];
const EXPLORE_MOODS = ['开心', '好奇', '勇敢', '惊喜', '有点累'];

const normalizeExploreCategory = (value: unknown) => {
  const text = String(value || '').trim();
  return EXPLORE_CATEGORIES.includes(text) ? text : '其他';
};

const normalizeExploreStatus = (value: unknown) => {
  const text = String(value || '').trim();
  return EXPLORE_STATUSES.includes(text) ? text : 'wishlist';
};

const normalizeExploreMood = (value: unknown) => {
  const text = String(value || '').trim();
  return EXPLORE_MOODS.includes(text) ? text : '好奇';
};

const trimText = (value: unknown, max = 500) => String(value || '').trim().slice(0, max);

function inferExploreCategoryFromText(text: string) {
  if (/(科技馆|科学馆|天文馆|海洋馆|科学中心)/.test(text)) return '科技馆';
  if (/(博物馆|纪念馆|美术馆|展览馆|文化馆)/.test(text)) return '博物馆';
  if (/(公园|湿地|植物园|动物园)/.test(text)) return '公园';
  if (/(山|湖|海|自然|森林|河|地质)/.test(text)) return '自然';
  if (/(剧场|剧院|活动|演出|展览|营地|体验)/.test(text)) return '活动';
  if (/(体育|运动|球馆|滑冰|攀岩|游泳)/.test(text)) return '运动体验';
  if (/(志愿|公益|社区)/.test(text)) return '公益体验';
  if (/(景区|旅游|度假|古镇|乐园)/.test(text)) return '旅行';
  if (/(广场|地标|城市|街区|商圈)/.test(text)) return '城市';
  return '其他';
}

const mapAmapPoi = (poi: any) => {
  const [longitude, latitude] = String(poi.location || '').split(',').map((part) => Number(part));
  return {
    externalId: poi.id || '',
    title: poi.name || '',
    category: inferExploreCategoryFromText(`${poi.type || ''} ${poi.name || ''}`),
    city: poi.cityname || poi.adname || '',
    address: Array.isArray(poi.address) ? poi.address.join('') : (poi.address || ''),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    summary: poi.type || '',
    source: 'amap'
  };
};

const FAMILY_UPLOAD_QUOTA_MB = 500;

const checkFamilyUploadQuota = async (familyId: string): Promise<boolean> => {
  const row = await getDb().get(
    'SELECT COALESCE(SUM(sizeBytes), 0) as totalBytes FROM explore_media WHERE familyId = ?',
    familyId
  );
  const usedMB = (row?.totalBytes || 0) / (1024 * 1024);
  return usedMB < FAMILY_UPLOAD_QUOTA_MB;
};

const getExplorePlaceSelect = () => `
  SELECT p.*,
    (SELECT COUNT(*) FROM explore_checkins ec WHERE ec.placeId = p.id) as checkinCount,
    (SELECT checkedInAt FROM explore_checkins ec WHERE ec.placeId = p.id ORDER BY checkedInAt DESC LIMIT 1) as lastCheckedInAt
  FROM explore_places p
`;

// 探索地图一期：haversine 距离计算（纯代码，返回整数米）
const haversineMeters = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * earthRadiusMeters * Math.asin(Math.sqrt(a)));
};

const saveExploreMediaFile = async (payload: any, familyId: string, childId: string) => {
  const type = payload?.type === 'audio' ? 'audio' : 'image';
  const dataUrl = String(payload?.dataUrl || '');
  // B2-2 修复：MediaRecorder 常产出带编解码参数的 MIME（如 audio/webm;codecs=opus），容忍参数段
  const match = dataUrl.match(/^data:([^;,]+)(?:;[^;,]*)*;base64,(.+)$/);
  if (!match) {
    const error: any = new Error('媒体格式不正确');
    error.status = 400;
    throw error;
  }

  const mimeType = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, 'base64');
  const allowedImage = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const allowedAudio = ['audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg'];
  const allowed = type === 'image' ? allowedImage : allowedAudio;
  const maxSize = type === 'image' ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
  if (!allowed.includes(mimeType)) {
    const error: any = new Error(type === 'image' ? '只支持 jpg/png/webp/gif 图片' : '只支持 webm/mp3/mp4/wav/ogg 语音');
    error.status = 400;
    throw error;
  }
  if (buffer.length > maxSize) {
    const error: any = new Error(type === 'image' ? '单张图片不能超过 2MB' : '语音不能超过 5MB');
    error.status = 400;
    throw error;
  }
  // M3: magic bytes 校验——不信任客户端声明的 MIME，校验真实文件头
  const matchesMagic = (() => {
    const startsWith = (bytes: number[], offset = 0) =>
      buffer.length >= offset + bytes.length && bytes.every((b, i) => buffer[offset + i] === b);
    const ascii = (str: string, offset = 0) =>
      buffer.length >= offset + str.length && buffer.toString('latin1', offset, offset + str.length) === str;
    switch (mimeType) {
      case 'image/jpeg': return startsWith([0xFF, 0xD8, 0xFF]);
      case 'image/png': return startsWith([0x89, 0x50, 0x4E, 0x47]);
      case 'image/webp': return ascii('RIFF') && ascii('WEBP', 8);
      case 'image/gif': return ascii('GIF8');
      case 'audio/webm': return startsWith([0x1A, 0x45, 0xDF, 0xA3]);
      case 'audio/mp4': return ascii('ftyp', 4);
      case 'audio/mpeg': return ascii('ID3') || (buffer.length > 1 && buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0);
      case 'audio/wav': return ascii('RIFF') && ascii('WAVE', 8);
      case 'audio/ogg': return ascii('OggS');
      default: return false;
    }
  })();
  if (!matchesMagic) {
    const error: any = new Error('文件内容与声明的格式不一致，请重新选择文件');
    error.status = 400;
    throw error;
  }

  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg'
  };
  const folder = path.join(exploreUploadRoot, familyId, childId);
  await fs.mkdir(folder, { recursive: true });
  const filename = `${randomUUID()}.${extMap[mimeType] || 'bin'}`;
  await fs.writeFile(path.join(folder, filename), buffer);
  return {
    type,
    mimeType,
    sizeBytes: buffer.length,
    durationSeconds: Math.max(0, Math.min(60, Math.round(Number(payload?.durationSeconds || 0)))),
    filePath: `/uploads/explore/${familyId}/${childId}/${filename}`
  };
};

const ACHIEVEMENT_DISPLAY_CATEGORIES = ['启动', '坚持', '生活', '学习', '运动', '活动', '情绪', '金币', '成长', '探索', '品格', '家庭', '其他'];

const inferAchievementCategory = (achievement: any) => {
  const stored = String(achievement?.category || '').trim();
  const conditionType = String(achievement?.conditionType || '').trim();
  const conditionCategory = achievement?.conditionCategory ? normalizeTaskCategoryInput(achievement.conditionCategory) : '';
  const text = `${achievement?.title || ''}${achievement?.description || ''}`;

  // Older seed data used the default "成长" category for everything. Reclassify those
  // legacy rows at response time without mutating user data.
  const shouldInfer = !stored || !ACHIEVEMENT_DISPLAY_CATEGORIES.includes(stored) ||
    (stored === '成长' && !['xp_count', 'level_reach'].includes(conditionType));
  if (!shouldInfer) return stored;

  if (conditionType.startsWith('explore_')) return '探索';
  if (conditionType === 'task_count') return '启动';
  if (conditionType === 'coin_count') return '金币';
  if (conditionType === 'xp_count' || conditionType === 'level_reach') return '成长';
  if (conditionType === 'category_count') return ACHIEVEMENT_DISPLAY_CATEGORIES.includes(conditionCategory) ? conditionCategory : '启动';
  if (conditionType === 'streak_days') return conditionCategory && conditionCategory !== '其他' ? conditionCategory : '坚持';
  if (/(感受|冷静|求助|情绪|生气|着急)/.test(text)) return '情绪';
  if (/(早晨|晨读|晨间|起床复习|早读)/.test(text)) return '生活';
  if (/(学习|阅读|作业|背诵|课文|口算)/.test(text)) return '学习';
  if (/(运动|锻炼|跑|跳|体能)/.test(text)) return '运动';
  if (/(生活|家务|劳动|整理|自理|刷牙|洗|睡|喝水|饮食|干净)/.test(text)) return '生活';
  if (/(活动|兴趣|艺术|钢琴|画|唱|舞)/.test(text)) return '活动';
  if (/(礼貌|助人|感谢|感恩|勇敢|诚实|守信)/.test(text)) return '品格';
  if (/(家庭|家人|合作|约定|分担)/.test(text)) return '家庭';
  return '其他';
};

const normalizeAchievementRow = (achievement: any) => ({
  ...achievement,
  category: inferAchievementCategory(achievement)
});

const ACHIEVEMENT_RANKS = [
  { label: '青铜', icon: '🥉', order: 1 },
  { label: '白银', icon: '🥈', order: 2 },
  { label: '黄金', icon: '🥇', order: 3 },
  { label: '铂金', icon: '💠', order: 4 },
  { label: '钻石', icon: '💎', order: 5 },
  { label: '王者', icon: '👑', order: 6 },
];

const ACHIEVEMENT_DISPLAY_THEMES: Record<string, Array<{ title: string; icon: string }>> = {
  task_count: [
    { title: '启程有光', icon: '🌱' },
    { title: '小步成章', icon: '🧭' },
    { title: '稳步前行', icon: '🚩' },
    { title: '百炼成章', icon: '🏆' },
    { title: '星路领航', icon: '🌟' },
    { title: '一路繁星', icon: '✨' },
  ],
  coin_count: [
    { title: '积少成多', icon: '🪙' },
    { title: '聚沙成塔', icon: '💰' },
    { title: '家财万贯', icon: '🏦' },
    { title: '富足有方', icon: '💎' },
    { title: '星河宝藏', icon: '🎁' },
    { title: '丰盈之库', icon: '👑' },
  ],
  growth: [
    { title: '初露锋芒', icon: '⭐' },
    { title: '渐入佳境', icon: '📈' },
    { title: '步步高升', icon: '🚀' },
    { title: '独当一面', icon: '🏅' },
    { title: '光芒万丈', icon: '🌟' },
    { title: '登峰造极', icon: '👑' },
  ],
  streak: [
    { title: '三日成习', icon: '📅' },
    { title: '一周有恒', icon: '🗓️' },
    { title: '习惯成风', icon: '💯' },
    { title: '月满常新', icon: '⚡' },
    { title: '久久为功', icon: '🔥' },
    { title: '百日如一', icon: '🎊' },
  ],
  生活: [
    { title: '井井有条', icon: '🧹' },
    { title: '自理有方', icon: '🛏️' },
    { title: '家务能手', icon: '🧺' },
    { title: '生活掌舵', icon: '🍽️' },
    { title: '日常小管家', icon: '🏠' },
    { title: '烟火小主人', icon: '🌤️' },
  ],
  学习: [
    { title: '开卷有益', icon: '📖' },
    { title: '勤学不倦', icon: '✏️' },
    { title: '学海拾贝', icon: '📚' },
    { title: '思路清亮', icon: '🔢' },
    { title: '博学笃行', icon: '🔬' },
    { title: '文思泉涌', icon: '🎓' },
  ],
  运动: [
    { title: '动若晨光', icon: '🏃' },
    { title: '活力满格', icon: '⚽' },
    { title: '身轻如燕', icon: '🏸' },
    { title: '元气奔跑', icon: '🚴' },
    { title: '风驰少年', icon: '🏅' },
    { title: '强健之星', icon: '💪' },
  ],
  活动: [
    { title: '妙趣初探', icon: '🎹' },
    { title: '灵感小匠', icon: '🎨' },
    { title: '兴味盎然', icon: '🎸' },
    { title: '艺海拾光', icon: '🎤' },
    { title: '创意满格', icon: '✨' },
    { title: '小小策展人', icon: '🌈' },
  ],
  情绪: [
    { title: '心声可见', icon: '💝' },
    { title: '冷静有方', icon: '🤫' },
    { title: '情绪复原', icon: '🍀' },
    { title: '表达清亮', icon: '🗣️' },
    { title: '内心有光', icon: '🌤️' },
    { title: '从容自如', icon: '🌈' },
  ],
  品格: [
    { title: '温言有礼', icon: '😊' },
    { title: '乐于相助', icon: '🤝' },
    { title: '心怀感谢', icon: '🙏' },
    { title: '诚实有信', icon: '🦁' },
    { title: '勇敢担当', icon: '🦸' },
    { title: '品格闪光', icon: '🌟' },
  ],
  家庭: [
    { title: '家中小手', icon: '🏠' },
    { title: '分担有心', icon: '🧺' },
    { title: '合作同心', icon: '🤝' },
    { title: '约定守护', icon: '🎯' },
    { title: '家庭星光', icon: '✨' },
    { title: '温暖同行', icon: '💝' },
  ],
  探索: [
    { title: '初次出发', icon: '🧭' },
    { title: '博物初见', icon: '🏛️' },
    { title: '自然观察员', icon: '🌿' },
    { title: '城市小旅人', icon: '🗺️' },
    { title: '勇敢表达', icon: '🎙️' },
    { title: '行路少年', icon: '🎒' },
  ],
  default: [
    { title: '小有收获', icon: '🏅' },
    { title: '渐有章法', icon: '🎯' },
    { title: '稳稳向前', icon: '🚩' },
    { title: '光芒初现', icon: '🌟' },
    { title: '一路闪耀', icon: '✨' },
    { title: '星河在握', icon: '👑' },
  ],
};

const pickAchievementRank = (achievement: any) => {
  const type = String(achievement?.conditionType || '');
  const value = Number(achievement?.conditionValue || 0);
  if (type === 'manual') return { label: '专属', icon: achievement?.icon || '🎖️', order: 99 };

  const thresholds = type === 'streak_days'
    ? [3, 7, 21, 30, 60, 100]
    : type === 'coin_count'
      ? [100, 500, 1000, 3000, 5000, 10000]
      : type === 'level_reach'
        ? [2, 5, 10, 15, 20, 30]
        : [1, 10, 20, 50, 100, 300];

  let index = 0;
  thresholds.forEach((threshold, i) => {
    if (value >= threshold) index = i;
  });
  return ACHIEVEMENT_RANKS[index] || ACHIEVEMENT_RANKS[0];
};

const getAchievementThemeKey = (achievement: any, category: string, conditionCategory: string) => {
  if (achievement?.conditionType === 'task_count') return 'task_count';
  if (achievement?.conditionType === 'coin_count') return 'coin_count';
  if (achievement?.conditionType === 'xp_count' || achievement?.conditionType === 'level_reach') return 'growth';
  if (achievement?.conditionType === 'streak_days') return 'streak';
  if (String(achievement?.conditionType || '').startsWith('explore_')) return '探索';
  if (achievement?.conditionType === 'category_count') return conditionCategory || category || 'default';
  return category || 'default';
};

const getAchievementConditionDescription = (achievement: any) => {
  const value = Number(achievement?.conditionValue || 0);
  const conditionCategory = achievement?.conditionCategory ? normalizeTaskCategoryInput(achievement.conditionCategory) : '';
  switch (achievement?.conditionType) {
    case 'task_count':
      return `完成 ${value} 个任务`;
    case 'coin_count':
      return `获得 ${value} 金币`;
    case 'xp_count':
      return `获得 ${value} 经验`;
    case 'level_reach':
      return `达到 Lv.${value}`;
    case 'category_count':
      return `完成 ${value} 个${conditionCategory || '指定'}任务`;
    case 'streak_days':
      return conditionCategory && conditionCategory !== '其他' ? `连续 ${value} 天${conditionCategory}` : `连续 ${value} 天`;
    default:
      return achievement?.description || '家长确认解锁';
  }
};

const buildAchievementDisplay = (achievement: any) => {
  const category = inferAchievementCategory(achievement);
  const rank = pickAchievementRank(achievement);
  const conditionCategory = achievement?.conditionCategory ? normalizeTaskCategoryInput(achievement.conditionCategory) : '';

  if (achievement?.conditionType === 'manual') {
    return {
      ...achievement,
      category,
      rankLabel: rank.label,
      rankIcon: rank.icon,
      rankOrder: rank.order,
      displayTitle: achievement?.title,
      displayDescription: achievement?.description || '由家长确认后解锁',
      displayIcon: achievement?.icon || rank.icon,
    };
  }

  // 探索成就是多维独立成就（地点类型 / 打卡次数 / 表达形式），不是等级递进关系。
  // 若走下面的 rankIndex→主题数组映射，value<10 的探索成就会全部落到 THEMES['探索'][0]「初次出发」🧭，
  // 导致名称、图标全部重复。直接沿用数据库原始标题与图标（与前端 achievementDisplay.ts 保持一致）。
  if (String(achievement?.conditionType || '').startsWith('explore_')) {
    return {
      ...achievement,
      category,
      rankLabel: rank.label,
      rankIcon: rank.icon,
      rankOrder: rank.order,
      displayTitle: achievement?.title,
      displayDescription: achievement?.description || getAchievementConditionDescription(achievement),
      displayIcon: achievement?.icon,
    };
  }

  const rankIndex = Math.max(0, Math.min(5, Number(rank.order || 1) - 1));
  const theme = ACHIEVEMENT_DISPLAY_THEMES[getAchievementThemeKey(achievement, category, conditionCategory)]
    || ACHIEVEMENT_DISPLAY_THEMES.default;
  const display = theme[rankIndex] || theme[0] || ACHIEVEMENT_DISPLAY_THEMES.default[0];

  return {
    ...achievement,
    category,
    rankLabel: rank.label,
    rankIcon: rank.icon,
    rankOrder: rank.order,
    displayTitle: display.title,
    displayDescription: getAchievementConditionDescription(achievement),
    displayIcon: display.icon,
  };
};

const sortAchievementRows = (rows: any[]) => rows
  .map(normalizeAchievementRow)
  .map(buildAchievementDisplay)
  .sort((a, b) => {
    const ai = ACHIEVEMENT_DISPLAY_CATEGORIES.indexOf(a.category);
    const bi = ACHIEVEMENT_DISPLAY_CATEGORIES.indexOf(b.category);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) ||
      Number(a.rankOrder || 99) - Number(b.rankOrder || 99) ||
      Number(a.conditionValue || 0) - Number(b.conditionValue || 0) ||
      String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN');
  });

type AchievementSeed = {
  title: string;
  desc: string;
  icon: string;
  type: string;
  value: number;
  category: string;
  conditionCategory?: string;
  rewardCoins?: number;
  rewardXp?: number;
  rewardPrivilegePoints?: number;
};

const DEFAULT_ACHIEVEMENT_SEEDS: AchievementSeed[] = [
  { title: '初次出发', desc: '完成 1 次探索打卡', icon: '🧭', type: 'explore_checkin_count', value: 1, category: '探索', rewardCoins: 0, rewardXp: 5 },
  { title: '见识在路上', desc: '完成 5 次探索打卡', icon: '🗺️', type: 'explore_checkin_count', value: 5, category: '探索', rewardCoins: 0, rewardXp: 10 },
  { title: '行路少年', desc: '完成 10 次探索打卡', icon: '🚶', type: 'explore_checkin_count', value: 10, category: '探索', rewardCoins: 0, rewardXp: 15 },
  { title: '博物初见', desc: '打卡 1 个博物馆', icon: '🏛️', type: 'explore_category_count', value: 1, conditionCategory: '博物馆', category: '探索', rewardCoins: 0, rewardXp: 5 },
  { title: '自然观察员', desc: '打卡 3 个自然或公园地点', icon: '🌿', type: 'explore_category_count', value: 3, conditionCategory: '自然,公园', category: '探索', rewardCoins: 0, rewardXp: 8 },
  { title: '城市小旅人', desc: '打卡 3 个城市地点', icon: '🏙️', type: 'explore_category_count', value: 3, conditionCategory: '城市', category: '探索', rewardCoins: 0, rewardXp: 8 },
  { title: '勇敢表达', desc: '留下 1 条语音留言', icon: '🎙️', type: 'explore_voice_count', value: 1, category: '探索', rewardCoins: 0, rewardXp: 5 },
  { title: '小小记录家', desc: '上传 3 次照片纪念', icon: '📷', type: 'explore_media_count', value: 3, category: '探索', rewardCoins: 0, rewardXp: 8 },
  { title: '亲子探索家', desc: '完成 3 次家长确认的探索', icon: '🎒', type: 'explore_confirmed_count', value: 3, category: '探索', rewardCoins: 0, rewardXp: 10 },
  // P3：探索成就扩充（按 DESIGN_v2 C）——数量/场地类型/记录/家长确认/全能/高光时刻
  { title: '探索老手', desc: '完成 25 次探索打卡', icon: '🧗', type: 'explore_checkin_count', value: 25, category: '探索', rewardCoins: 0, rewardXp: 25 },
  { title: '探索大师', desc: '完成 50 次探索打卡', icon: '🏔️', type: 'explore_checkin_count', value: 50, category: '探索', rewardCoins: 0, rewardXp: 50 },
  { title: '博物常客', desc: '打卡 3 个博物馆', icon: '🏛️', type: 'explore_category_count', value: 3, conditionCategory: '博物馆', category: '探索', rewardCoins: 0, rewardXp: 10 },
  { title: '博物达人', desc: '打卡 5 个博物馆', icon: '🏛️', type: 'explore_category_count', value: 5, conditionCategory: '博物馆', category: '探索', rewardCoins: 0, rewardXp: 15 },
  { title: '科技初探', desc: '打卡 1 个科技馆', icon: '🔬', type: 'explore_category_count', value: 1, conditionCategory: '科技馆', category: '探索', rewardCoins: 0, rewardXp: 5 },
  { title: '科技小达人', desc: '打卡 3 个科技馆', icon: '🛰️', type: 'explore_category_count', value: 3, conditionCategory: '科技馆', category: '探索', rewardCoins: 0, rewardXp: 10 },
  { title: '旅行小达人', desc: '打卡 3 个旅行景点', icon: '🧳', type: 'explore_category_count', value: 3, conditionCategory: '旅行', category: '探索', rewardCoins: 0, rewardXp: 10 },
  { title: '记录小能手', desc: '上传 10 次照片纪念', icon: '📸', type: 'explore_media_count', value: 10, category: '探索', rewardCoins: 0, rewardXp: 15 },
  { title: '小小播音员', desc: '留下 5 条语音留言', icon: '🎤', type: 'explore_voice_count', value: 5, category: '探索', rewardCoins: 0, rewardXp: 12 },
  { title: '亲子探索家·进阶', desc: '完成 10 次家长确认的探索', icon: '👨‍👩‍👧', type: 'explore_confirmed_count', value: 10, category: '探索', rewardCoins: 0, rewardXp: 20 },
  { title: '全能探索家', desc: '集齐 5 种不同类型场地各 1 次', icon: '🌟', type: 'explore_distinct_categories', value: 5, category: '探索', rewardCoins: 0, rewardXp: 30 },
  { title: '我的第一次出行计划', desc: '自己规划并完成一次出行', icon: '🗺️', type: 'manual', value: 0, category: '探索', rewardCoins: 10, rewardXp: 20 },
  { title: '小讲解员', desc: '把探索学到的讲给家人听', icon: '🎙️', type: 'manual', value: 0, category: '探索', rewardCoins: 10, rewardXp: 15 },
  { title: '公益小天使', desc: '参与一次公益体验', icon: '🤝', type: 'manual', value: 0, category: '探索', rewardCoins: 10, rewardXp: 20 },
  { title: '户外勇士', desc: '完成一次有挑战的户外探索', icon: '🏕️', type: 'manual', value: 0, category: '探索', rewardCoins: 10, rewardXp: 20 },
  { title: '启程有光', desc: '完成 1 个任务', icon: '🌱', type: 'task_count', value: 1, category: '启动', rewardCoins: 5, rewardXp: 5 },
  { title: '小步成章', desc: '完成 10 个任务', icon: '🧭', type: 'task_count', value: 10, category: '启动', rewardCoins: 8, rewardXp: 10 },
  { title: '百炼成章', desc: '完成 50 个任务', icon: '🏆', type: 'task_count', value: 50, category: '启动', rewardCoins: 25, rewardXp: 50 },
  { title: '星路领航', desc: '完成 100 个任务', icon: '🌟', type: 'task_count', value: 100, category: '启动', rewardCoins: 40, rewardXp: 80, rewardPrivilegePoints: 1 },
  { title: '一路繁星', desc: '完成 300 个任务', icon: '✨', type: 'task_count', value: 300, category: '启动', rewardCoins: 80, rewardXp: 120, rewardPrivilegePoints: 2 },
  { title: '三天不断线', desc: '连续 3 天完成任务', icon: '📅', type: 'streak_days', value: 3, category: '坚持', rewardCoins: 10, rewardXp: 10 },
  { title: '一周节奏', desc: '连续 7 天完成任务', icon: '🗓️', type: 'streak_days', value: 7, category: '坚持', rewardCoins: 21, rewardXp: 21 },
  { title: '习惯成风', desc: '连续 21 天完成任务', icon: '💯', type: 'streak_days', value: 21, category: '坚持', rewardCoins: 63, rewardXp: 63 },
  { title: '月满常新', desc: '连续 30 天完成任务', icon: '⚡', type: 'streak_days', value: 30, category: '坚持', rewardCoins: 90, rewardXp: 90, rewardPrivilegePoints: 1 },
  { title: '久久为功', desc: '连续 60 天完成任务', icon: '🔥', type: 'streak_days', value: 60, category: '坚持', rewardCoins: 100, rewardXp: 120, rewardPrivilegePoints: 2 },
  { title: '百日如一', desc: '连续 100 天完成任务', icon: '🎊', type: 'streak_days', value: 100, category: '坚持', rewardCoins: 120, rewardXp: 150, rewardPrivilegePoints: 3 },
  { title: '生活小帮手', desc: '完成 1 个生活任务', icon: '🧹', type: 'category_count', value: 1, conditionCategory: '生活', category: '生活', rewardCoins: 5, rewardXp: 5 },
  { title: '自理有方', desc: '完成 10 个生活任务', icon: '🛏️', type: 'category_count', value: 10, conditionCategory: '生活', category: '生活', rewardCoins: 8, rewardXp: 10 },
  { title: '井井有条', desc: '完成 30 个生活任务', icon: '🍽️', type: 'category_count', value: 30, conditionCategory: '生活', category: '生活', rewardCoins: 15, rewardXp: 30 },
  { title: '家务担当', desc: '完成 60 个生活任务', icon: '🧺', type: 'category_count', value: 60, conditionCategory: '生活', category: '生活', rewardCoins: 30, rewardXp: 60 },
  { title: '生活小管家', desc: '完成 100 个生活任务', icon: '🏠', type: 'category_count', value: 100, conditionCategory: '生活', category: '生活', rewardCoins: 50, rewardXp: 100, rewardPrivilegePoints: 1 },
  { title: '三日小当家', desc: '连续 3 天完成生活任务', icon: '🧹', type: 'streak_days', value: 3, conditionCategory: '生活', category: '生活', rewardCoins: 10, rewardXp: 10 },
  { title: '整洁一周', desc: '连续 7 天完成生活任务', icon: '🍽️', type: 'streak_days', value: 7, conditionCategory: '生活', category: '生活', rewardCoins: 21, rewardXp: 21 },
  { title: '日常有序', desc: '连续 21 天完成生活任务', icon: '🧺', type: 'streak_days', value: 21, conditionCategory: '生活', category: '生活', rewardCoins: 63, rewardXp: 63 },
  { title: '学习启动', desc: '完成 1 个学习任务', icon: '📚', type: 'category_count', value: 1, conditionCategory: '学习', category: '学习', rewardCoins: 5, rewardXp: 5 },
  { title: '专注小苗', desc: '完成 10 个学习任务', icon: '✏️', type: 'category_count', value: 10, conditionCategory: '学习', category: '学习', rewardCoins: 8, rewardXp: 10 },
  { title: '作业小闯将', desc: '完成 30 个学习任务', icon: '📖', type: 'category_count', value: 30, conditionCategory: '学习', category: '学习', rewardCoins: 15, rewardXp: 30 },
  { title: '学海拾贝', desc: '完成 60 个学习任务', icon: '📚', type: 'category_count', value: 60, conditionCategory: '学习', category: '学习', rewardCoins: 30, rewardXp: 60 },
  { title: '求知小灯塔', desc: '完成 100 个学习任务', icon: '🎓', type: 'category_count', value: 100, conditionCategory: '学习', category: '学习', rewardCoins: 50, rewardXp: 100, rewardPrivilegePoints: 1 },
  { title: '三日书声', desc: '连续 3 天完成学习任务', icon: '📅', type: 'streak_days', value: 3, conditionCategory: '学习', category: '学习', rewardCoins: 10, rewardXp: 10 },
  { title: '学习一周星', desc: '连续 7 天完成学习任务', icon: '🎓', type: 'streak_days', value: 7, conditionCategory: '学习', category: '学习', rewardCoins: 21, rewardXp: 21 },
  { title: '书声不断', desc: '连续 21 天完成学习任务', icon: '📖', type: 'streak_days', value: 21, conditionCategory: '学习', category: '学习', rewardCoins: 63, rewardXp: 63 },
  { title: '动起来', desc: '完成 1 个运动任务', icon: '🏃', type: 'category_count', value: 1, conditionCategory: '运动', category: '运动', rewardCoins: 5, rewardXp: 5 },
  { title: '活力小步', desc: '完成 10 个运动任务', icon: '⚽', type: 'category_count', value: 10, conditionCategory: '运动', category: '运动', rewardCoins: 8, rewardXp: 10 },
  { title: '运动小将', desc: '完成 30 个运动任务', icon: '🏸', type: 'category_count', value: 30, conditionCategory: '运动', category: '运动', rewardCoins: 15, rewardXp: 30 },
  { title: '体能守护者', desc: '完成 60 个运动任务', icon: '🚴', type: 'category_count', value: 60, conditionCategory: '运动', category: '运动', rewardCoins: 30, rewardXp: 60 },
  { title: '强健之星', desc: '完成 100 个运动任务', icon: '💪', type: 'category_count', value: 100, conditionCategory: '运动', category: '运动', rewardCoins: 50, rewardXp: 100, rewardPrivilegePoints: 1 },
  { title: '连动三天', desc: '连续 3 天完成运动任务', icon: '🔥', type: 'streak_days', value: 3, conditionCategory: '运动', category: '运动', rewardCoins: 10, rewardXp: 10 },
  { title: '活力一周', desc: '连续 7 天完成运动任务', icon: '🔥', type: 'streak_days', value: 7, conditionCategory: '运动', category: '运动', rewardCoins: 21, rewardXp: 21 },
  { title: '元气常在', desc: '连续 21 天完成运动任务', icon: '🏅', type: 'streak_days', value: 21, conditionCategory: '运动', category: '运动', rewardCoins: 63, rewardXp: 63 },
  { title: '探索新事物', desc: '完成 1 个活动任务', icon: '🎹', type: 'category_count', value: 1, conditionCategory: '活动', category: '活动', rewardCoins: 5, rewardXp: 5 },
  { title: '兴趣练习者', desc: '完成 10 个活动任务', icon: '🎨', type: 'category_count', value: 10, conditionCategory: '活动', category: '活动', rewardCoins: 8, rewardXp: 10 },
  { title: '灵感小匠', desc: '完成 30 个活动任务', icon: '🎸', type: 'category_count', value: 30, conditionCategory: '活动', category: '活动', rewardCoins: 15, rewardXp: 30 },
  { title: '小小创作者', desc: '完成 60 个活动任务', icon: '🎤', type: 'category_count', value: 60, conditionCategory: '活动', category: '活动', rewardCoins: 30, rewardXp: 60 },
  { title: '创意满格', desc: '完成 100 个活动任务', icon: '🌈', type: 'category_count', value: 100, conditionCategory: '活动', category: '活动', rewardCoins: 50, rewardXp: 100, rewardPrivilegePoints: 1 },
  { title: '活动坚持星', desc: '连续 7 天完成活动任务', icon: '🎸', type: 'streak_days', value: 7, conditionCategory: '活动', category: '活动', rewardCoins: 21, rewardXp: 21 },
  { title: '艺海拾光', desc: '连续 21 天完成活动任务', icon: '🎤', type: 'streak_days', value: 21, conditionCategory: '活动', category: '活动', rewardCoins: 63, rewardXp: 63 },
  { title: '会说感受', desc: '能说出自己现在的感受', icon: '💝', type: 'manual', value: 0, category: '情绪', rewardCoins: 10, rewardXp: 10 },
  { title: '冷静有方', desc: '尝试一次冷静动作', icon: '🤫', type: 'manual', value: 0, category: '情绪', rewardCoins: 10, rewardXp: 10 },
  { title: '求助很勇敢', desc: '卡住时能主动求助', icon: '🦸', type: 'manual', value: 0, category: '情绪', rewardCoins: 10, rewardXp: 10 },
  { title: '积少成多', desc: '获得 100 金币', icon: '🪙', type: 'coin_count', value: 100, category: '金币', rewardCoins: 0, rewardXp: 10 },
  { title: '聚沙成塔', desc: '获得 500 金币', icon: '💰', type: 'coin_count', value: 500, category: '金币', rewardCoins: 0, rewardXp: 25 },
  { title: '家财万贯', desc: '获得 1000 金币', icon: '🏦', type: 'coin_count', value: 1000, category: '金币', rewardCoins: 0, rewardXp: 50, rewardPrivilegePoints: 1 },
  { title: '富足有方', desc: '获得 3000 金币', icon: '💎', type: 'coin_count', value: 3000, category: '金币', rewardCoins: 0, rewardXp: 80, rewardPrivilegePoints: 1 },
  { title: '星河宝藏', desc: '获得 5000 金币', icon: '🎁', type: 'coin_count', value: 5000, category: '金币', rewardCoins: 0, rewardXp: 100, rewardPrivilegePoints: 2 },
  { title: '丰盈之库', desc: '获得 10000 金币', icon: '👑', type: 'coin_count', value: 10000, category: '金币', rewardCoins: 0, rewardXp: 120, rewardPrivilegePoints: 3 },
  { title: '初露锋芒', desc: '达到 2 级', icon: '⭐', type: 'level_reach', value: 2, category: '成长', rewardCoins: 20, rewardXp: 0 },
  { title: '成长之路', desc: '达到 5 级', icon: '📈', type: 'level_reach', value: 5, category: '成长', rewardCoins: 50, rewardXp: 0, rewardPrivilegePoints: 1 },
  { title: '进阶高手', desc: '达到 10 级', icon: '🚀', type: 'level_reach', value: 10, category: '成长', rewardCoins: 80, rewardXp: 0, rewardPrivilegePoints: 1 },
  { title: '闪耀成长', desc: '达到 20 级', icon: '🌟', type: 'level_reach', value: 20, category: '成长', rewardCoins: 120, rewardXp: 0, rewardPrivilegePoints: 2 },
  { title: '登峰造极', desc: '达到 30 级', icon: '👑', type: 'level_reach', value: 30, category: '成长', rewardCoins: 150, rewardXp: 0, rewardPrivilegePoints: 3 },
  { title: '礼貌小天使', desc: '能用礼貌的话表达需要', icon: '😊', type: 'manual', value: 0, category: '品格', rewardCoins: 10, rewardXp: 10 },
  { title: '乐于助人', desc: '主动帮助别人一次', icon: '🤝', type: 'manual', value: 0, category: '品格', rewardCoins: 10, rewardXp: 10 },
  { title: '诚实守信', desc: '遇到问题能诚实说明', icon: '🦁', type: 'manual', value: 0, category: '品格', rewardCoins: 10, rewardXp: 10 },
  { title: '家庭小帮手', desc: '主动为家里做一件小事', icon: '🏠', type: 'manual', value: 0, category: '家庭', rewardCoins: 10, rewardXp: 10 },
  { title: '合作之星', desc: '和家人合作完成一件事', icon: '🤝', type: 'manual', value: 0, category: '家庭', rewardCoins: 10, rewardXp: 10 },
  { title: '约定守护者', desc: '遵守一次家庭约定', icon: '🎯', type: 'manual', value: 0, category: '家庭', rewardCoins: 10, rewardXp: 10 },
  { title: '第一次独立完成', desc: '不用任何帮助独立完成一件家务', icon: '🧽', type: 'manual', value: 0, category: '生活', rewardCoins: 8, rewardXp: 15 },
  { title: '主动多做一件', desc: '没人要求，主动帮家里做了额外的事', icon: '🤝', type: 'manual', value: 0, category: '生活', rewardCoins: 10, rewardXp: 15 },
  { title: '自己发现错误', desc: '检查作业时自己找出并改正了错误', icon: '🔍', type: 'manual', value: 0, category: '学习', rewardCoins: 10, rewardXp: 15 },
  { title: '教会别人一次', desc: '把学会的东西讲给家人听懂', icon: '🎓', type: 'manual', value: 0, category: '学习', rewardCoins: 10, rewardXp: 20 },
  { title: '坚持到最后', desc: '很累但坚持完成了整场运动', icon: '🏁', type: 'manual', value: 0, category: '运动', rewardCoins: 10, rewardXp: 15 },
  { title: '勇敢再试一次', desc: '失败后没放弃，重新尝试', icon: '🌈', type: 'manual', value: 0, category: '成长', rewardCoins: 12, rewardXp: 20 },
];

// 数据库操作包装器 - 带重试机制
const dbRunWithRetry = async (sql: string, ...params: any[]) => {
  const maxRetries = 3;
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await getDb().run(sql, ...params);
    } catch (error: any) {
      lastError = error;

      // SQLite BUSY 错误 - 数据库被锁
      if (error.code === 'SQLITE_BUSY' || error.message?.includes('database is locked')) {
        console.log(`⏳ 数据库繁忙，重试 ${attempt}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, 100 * attempt)); // 延迟重试
        continue;
      }

      // 其他错误直接抛出
      throw error;
    }
  }

  throw lastError;
};

// 事务封装：自动处理 BEGIN/COMMIT/ROLLBACK。
// 全应用共享单条 SQLite 连接，并发事务的语句会交错进入彼此的事务
// （嵌套 BEGIN 直接报错、A 回滚连带 B），因此用队列串行化所有事务。
let txQueue: Promise<unknown> = Promise.resolve();
const withTransaction = async <T>(fn: () => Promise<T>): Promise<T> => {
  const exec = async (): Promise<T> => {
    const db = getDb();
    await db.run('BEGIN');
    try {
      const result = await fn();
      await db.run('COMMIT');
      return result;
    } catch (err) {
      try { await db.run('ROLLBACK'); } catch { /* 连接上可能已无活动事务 */ }
      throw err;
    }
  };
  const next = txQueue.then(exec, exec);
  txQueue = next.then(() => undefined, () => undefined);
  return next;
};


// 健康检查端点 - 用于测试服务器是否正常运行
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// --- 北京时间工具函数 ---
// 强制使用北京时间 (UTC+8)，不依赖服务器本地时区设置
const BEIJING_OFFSET = 8 * 60; // 北京时间 UTC+8，单位：分钟

/**
 * 获取北京时间的 Date 对象
 */
const getBeijingDate = (date: Date = new Date()): Date => {
  // 获取 UTC 时间戳，然后加上北京时间偏移
  const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
  return new Date(utc + (BEIJING_OFFSET * 60000));
};

/**
 * 获取北京时间日期字符串 (YYYY-MM-DD)
 * 强制使用 UTC+8，确保任务在北京时间午夜00:00重置
 */
const getLocalDateString = (date: Date = new Date()): string => {
  const beijingDate = getBeijingDate(date);
  const year = beijingDate.getFullYear();
  const month = String(beijingDate.getMonth() + 1).padStart(2, '0');
  const day = String(beijingDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * 获取北京时间完整时间字符串 (YYYY-MM-DD HH:MM:SS)
 */
const getBeijingTimeString = (date: Date = new Date()): string => {
  const beijingDate = getBeijingDate(date);
  const year = beijingDate.getFullYear();
  const month = String(beijingDate.getMonth() + 1).padStart(2, '0');
  const day = String(beijingDate.getDate()).padStart(2, '0');
  const hours = String(beijingDate.getHours()).padStart(2, '0');
  const minutes = String(beijingDate.getMinutes()).padStart(2, '0');
  const seconds = String(beijingDate.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

// --- 任务生成函数 ---
/**
 * 判断任务是否应该在指定日期出现
 * @param task 任务对象
 * @param targetDate 目标日期
 */
const TASK_AUTO_COMPLETE_REASON = '孩子已开始任务但跨过北京时间当天未手动结束，系统按常规时长自动提交。';

const getBeijingDayEndIso = (dateStr: string): string => {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return new Date().toISOString();
  return new Date(Date.UTC(year, month - 1, day, 15, 59, 59, 999)).toISOString();
};

const ensureTaskEntryForSession = async (db: any, session: any) => {
  const sessionDate = getLocalDateString(new Date(session.startedAt));
  const submittedAt = getBeijingDayEndIso(sessionDate);
  const duration = Math.max(1, Number(session.durationMinutes || 1));
  let entryId = session.taskEntryId;

  const existingEntry = await db.get(
    `SELECT id, status FROM task_entries
     WHERE taskId = ? AND childId = ?
     AND date(submittedAt, '+8 hours') = ?
     ORDER BY submittedAt DESC
     LIMIT 1`,
    session.taskId, session.childId, sessionDate
  );

  if (existingEntry && existingEntry.status !== 'rejected') {
    entryId = existingEntry.id;
  } else if (existingEntry) {
    entryId = existingEntry.id;
    await db.run(
      `UPDATE task_entries
       SET status = 'pending', submittedAt = ?, actualDurationMinutes = ?, isOverdue = 0,
           autoCompleted = 1, autoCompleteReason = ?
       WHERE id = ?`,
      submittedAt, duration, TASK_AUTO_COMPLETE_REASON, entryId
    );
  } else {
    entryId = randomUUID();
    await db.run(
      `INSERT INTO task_entries (
        id, taskId, childId, status, submittedAt, actualDurationMinutes, isOverdue,
        autoCompleted, autoCompleteReason
      ) VALUES (?, ?, ?, 'pending', ?, ?, 0, 1, ?)`,
      entryId, session.taskId, session.childId, submittedAt, duration, TASK_AUTO_COMPLETE_REASON
    );
  }

  return { entryId, submittedAt };
};

const finalizeOverdueTaskSessions = async (
  db: any,
  filters: { familyId?: string; childId?: string } = {}
) => {
  const today = getLocalDateString();
  let query = `
    SELECT ts.*, t.title, t.durationMinutes, t.isEnabled, u.name as childName
    FROM task_sessions ts
    JOIN tasks t ON ts.taskId = t.id
    JOIN users u ON ts.childId = u.id
    WHERE ts.status = 'running'
      AND date(ts.startedAt, '+8 hours') < ?
  `;
  const params: any[] = [today];
  if (filters.familyId) {
    query += ' AND ts.familyId = ?';
    params.push(filters.familyId);
  }
  if (filters.childId) {
    query += ' AND ts.childId = ?';
    params.push(filters.childId);
  }
  query += ' ORDER BY ts.startedAt ASC LIMIT 100';

  const sessions = await db.all(query, ...params);
  const completed: any[] = [];

  for (const session of sessions) {
    try {
      await db.run('BEGIN');
      const current = await db.get('SELECT status FROM task_sessions WHERE id = ?', session.id);
      if (!current || current.status !== 'running') {
        await db.run('ROLLBACK');
        continue;
      }

      const { entryId, submittedAt } = await ensureTaskEntryForSession(db, session);
      const autoCompletedAt = new Date().toISOString();
      await db.run(
        `UPDATE task_sessions
         SET status = 'auto_completed', endedAt = ?, autoCompletedAt = ?, taskEntryId = ?
         WHERE id = ? AND status = 'running'`,
        submittedAt, autoCompletedAt, entryId, session.id
      );
      await db.run('COMMIT');
      completed.push({ ...session, taskEntryId: entryId, endedAt: submittedAt, autoCompletedAt });
    } catch (err) {
      try { await db.run('ROLLBACK'); } catch {}
      console.error('Auto-complete task session failed:', err);
    }
  }

  return completed;
};

const startTaskSessionFinalizer = () => {
  const run = async () => {
    try {
      const completed = await finalizeOverdueTaskSessions(getDb());
      if (completed.length > 0) {
        console.log(`[TaskSession] Auto-completed ${completed.length} overdue running task(s).`);
      }
    } catch (error) {
      console.error('[TaskSession] Overdue finalizer failed:', error);
    }
  };

  setTimeout(() => void run(), 30 * 1000);
  setInterval(() => void run(), 10 * 60 * 1000);
};

const shouldTaskAppearOnDate = (task: any, targetDate: Date): boolean => {
  const dayOfWeek = targetDate.getDay(); // 0=周日, 1=周一, ..., 6=周六
  const dateStr = getLocalDateString(targetDate);

  // 新版逻辑：根据 taskType 判断
  if (task.taskType) {
    switch (task.taskType) {
      case 'daily':
        return true; // 每日任务，每天都出现
      case 'once':
        return task.validDate === dateStr; // 单次任务，只在指定日期出现
      case 'custom':
        // 自定义周期，检查今天是否在 customDays 中
        try {
          const days = JSON.parse(task.customDays || '[]');
          return days.includes(dayOfWeek);
        } catch { return false; }
      default:
        return true;
    }
  }

  // 旧版兼容：根据 isRecurring + recurringSchedule 判断
  if (task.isRecurring === 1) {
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    if (task.recurringSchedule === 'daily') return true;
    if (task.recurringSchedule === 'weekday' && isWeekday) return true;
    if (task.recurringSchedule === 'weekend' && isWeekend) return true;
    return false;
  }

  // 默认：普通任务每天都出现
  return true;
};

/**
 * 获取指定日期的任务列表
 * @param db 数据库连接
 * @param familyId 家庭ID
 * @param childId 孩子ID
 * @param targetDate 目标日期（默认今天）
 *
 * 逻辑说明：
 * - 今天：显示所有符合当前规则的任务（可操作）
 * - 历史日期：只显示有 task_entries 记录的任务（只读回顾）
 *   这样避免任务"穿越"到创建之前的日期，也避免修改任务类型后历史显示不准确
 */
const getTasksForDate = async (db: any, familyId: string, childId: string, targetDate: Date = new Date()) => {
  const dateStr = getLocalDateString(targetDate);
  const todayStr = getLocalDateString();
  const isToday = dateStr === todayStr;

  // 获取该日期的任务完成记录（无论今天还是历史都需要）
  const entries = await db.all(`
    SELECT te.*, t.id as taskId, t.title, t.icon, t.coinReward, t.xpReward,
           t.durationMinutes, t.category, t.taskType, t.customDays, t.isParallel,
           t.completionMode, t.targetValue, t.targetUnit, t.reviewFocus,
           (SELECT SUM(pr.deductedCoins) FROM punishment_records pr WHERE pr.taskEntryId = te.id) as punishmentDeduction
    FROM task_entries te
    JOIN tasks t ON te.taskId = t.id
    WHERE te.childId = ? AND date(te.submittedAt, '+8 hours') = ?
  `, childId, dateStr);

  if (isToday) {
    // === 今天：显示所有符合规则的任务 ===
    const allTasks = await db.all(`
      SELECT * FROM tasks
      WHERE familyId = ? AND isEnabled = 1
      AND (recurringTaskTemplateId IS NULL OR recurringTaskTemplateId = '')
    `, familyId);

    const runningSessions = await db.all(`
      SELECT id, taskId, startedAt
      FROM task_sessions
      WHERE familyId = ? AND childId = ? AND status = 'running'
        AND date(startedAt, '+8 hours') = ?
    `, familyId, childId, dateStr);

    // 过滤出应该在今天出现的任务
    const tasksForToday = allTasks.filter((task: any) => shouldTaskAppearOnDate(task, targetDate));

    // 合并任务和完成状态
    return tasksForToday.map((task: any) => {
      const entry = entries.find((e: any) => e.taskId === task.id);
      const runningSession = runningSessions.find((session: any) => session.taskId === task.id);
      // 被退回的任务应该显示为"待做"状态，让孩子可以重新开始
      const displayStatus = runningSession
        ? 'running'
        : (entry?.status === 'rejected' ? 'todo' : (entry?.status || 'todo'));
      return {
        ...task,
        status: displayStatus,
        sessionId: runningSession?.id,
        sessionStartedAt: runningSession?.startedAt,
        entryId: entry?.id,
        earnedCoins: entry?.earnedCoins,
        earnedXp: entry?.earnedXp,
        actualDurationMinutes: entry?.actualDurationMinutes,
        autoCompleted: entry?.autoCompleted || 0,
        autoCompleteReason: entry?.autoCompleteReason,
        submittedAt: entry?.submittedAt,
        reviewedAt: entry?.reviewedAt,
        punishmentDeduction: entry?.punishmentDeduction || 0,
        canOperate: Boolean(runningSession) || !entry || entry.status === 'rejected'
      };
    });
  } else {
    // === 历史日期：只显示有记录的任务 ===
    // 这样避免任务"穿越"到它创建之前，也避免任务类型修改后历史显示错误
    return entries.map((entry: any) => ({
      id: entry.taskId,
      title: entry.title,
      icon: entry.icon,
      coinReward: entry.coinReward,
      xpReward: entry.xpReward,
      durationMinutes: entry.durationMinutes,
      category: entry.category,
      taskType: entry.taskType,
      customDays: entry.customDays,
      isParallel: entry.isParallel,
      completionMode: entry.completionMode,
      targetValue: entry.targetValue,
      targetUnit: entry.targetUnit,
      reviewFocus: entry.reviewFocus,
      status: entry.status,
      entryId: entry.id,
      earnedCoins: entry.earnedCoins,
      earnedXp: entry.earnedXp,
      actualDurationMinutes: entry.actualDurationMinutes,
      autoCompleted: entry.autoCompleted || 0,
      autoCompleteReason: entry.autoCompleteReason,
      submittedAt: entry.submittedAt,
      reviewedAt: entry.reviewedAt,
      punishmentDeduction: entry.punishmentDeduction || 0,
      canOperate: false // 历史任务不可操作
    }));
  }
};

// --- MIDDLEWARE ---
const protect = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ message: '未授权' });
  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET) as any;
    // 验证用户是否真实存在于数据库
    const user = await getDb().get('SELECT id, role, familyId FROM users WHERE id = ?', decoded.id);
    if (!user) return res.status(401).json({ message: '用户不存在，请重新登录' });
    req.user = { ...decoded, ...user };
    next();
  } catch { return res.status(401).json({ message: '无效Token' }); }
};

const checkAchievements = async (childId: string, db: any) => {
  const child = await db.get('SELECT * FROM users WHERE id = ?', childId);
  if (!child) return [];
  const unlockedAchievements: any[] = [];
  const defs = await db.all(`SELECT * FROM achievement_defs WHERE familyId = ? AND conditionType != 'manual'`, child.familyId);

  // 基础统计
  const taskCount = (await db.get('SELECT COUNT(*) as count FROM task_entries WHERE childId = ? AND status = "approved"', childId))?.count || 0;

  // 分类任务统计
  const categoryStats = await db.all(`
    SELECT t.category, COUNT(*) as count
    FROM task_entries te
    JOIN tasks t ON te.taskId = t.id
    WHERE te.childId = ? AND te.status = 'approved'
    GROUP BY t.category
  `, childId);
  const categoryCountMap: Record<string, number> = {};
  categoryStats.forEach((s: any) => { categoryCountMap[s.category] = s.count; });
  const getCategoryCount = (category?: string) => {
    const values = getTaskCategoryFilterValues(category);
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + (categoryCountMap[value] || 0), 0);
  };

  const exploreCheckinCount = (await db.get('SELECT COUNT(*) as count FROM explore_checkins WHERE childId = ?', childId))?.count || 0;
  const exploreMediaCount = (await db.get("SELECT COUNT(*) as count FROM explore_media WHERE childId = ? AND type = 'image'", childId))?.count || 0;
  const exploreVoiceCount = (await db.get("SELECT COUNT(*) as count FROM explore_media WHERE childId = ? AND type = 'audio' AND senderRole = 'child'", childId))?.count || 0;
  const exploreConfirmedCount = (await db.get('SELECT COUNT(*) as count FROM explore_checkins WHERE childId = ? AND parentConfirmed = 1', childId))?.count || 0;
  const exploreCategoryStats = await db.all(`
    SELECT p.category, COUNT(*) as count
    FROM explore_checkins ec
    JOIN explore_places p ON ec.placeId = p.id
    WHERE ec.childId = ?
    GROUP BY p.category
  `, childId);
  const exploreCategoryCountMap: Record<string, number> = {};
  exploreCategoryStats.forEach((s: any) => { exploreCategoryCountMap[s.category] = s.count; });
  // P3：全能探索家——去过的不同场地类型数（排除"其他"）
  const exploreDistinctCategories = Object.keys(exploreCategoryCountMap).filter(c => c && c !== '其他').length;

  // 连续天数统计（按类别）- 使用北京时间
  const getStreakDays = async (category?: string): Promise<number> => {
    // 获取所有已完成任务的提交时间
    const categoryValues = getTaskCategoryFilterValues(category);
    const query = categoryValues.length > 0
      ? `SELECT DISTINCT te.submittedAt FROM task_entries te JOIN tasks t ON te.taskId = t.id WHERE te.childId = ? AND te.status = 'approved' AND t.category IN (${categoryValues.map(() => '?').join(', ')}) ORDER BY te.submittedAt DESC`
      : `SELECT DISTINCT submittedAt FROM task_entries WHERE childId = ? AND status = 'approved' ORDER BY submittedAt DESC`;
    const entries = categoryValues.length > 0
      ? await db.all(query, childId, ...categoryValues)
      : await db.all(query, childId);

    if (entries.length === 0) return 0;

    // 转换为北京时间日期字符串并去重
    const daysSet = new Set<string>();
    for (const entry of entries) {
      const submitDate = new Date(entry.submittedAt);
      const beijingDateStr = getLocalDateString(submitDate);
      daysSet.add(beijingDateStr);
    }
    const days = Array.from(daysSet).sort((a, b) => b.localeCompare(a));

    if (days.length === 0) return 0;

    const todayStr = getLocalDateString();
    let streak = 0;

    // 检查今天是否有任务
    const hasTaskToday = days[0] === todayStr;
    const startOffset = hasTaskToday ? 0 : 1;

    for (let i = 0; i < days.length; i++) {
      const dayStr = days[i];
      // 计算期望日期（北京时间）- 使用时间戳计算，避免跨年问题
      const beijingNow = getBeijingDate();
      // 使用时间戳减去天数（毫秒），避免 setDate 跨年问题
      const daysToSubtract = i + startOffset;
      const expectedTimestamp = beijingNow.getTime() - (daysToSubtract * 24 * 60 * 60 * 1000);
      const expectedDate = getBeijingDate(new Date(expectedTimestamp));
      // 使用 getLocalDateString 确保格式一致
      const expectedStr = getLocalDateString(expectedDate);

      if (dayStr === expectedStr) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  };

  for (const def of defs) {
      let unlocked = false;

      switch (def.conditionType) {
        case 'task_count':
          unlocked = taskCount >= def.conditionValue;
          break;
        case 'coin_count':
          unlocked = child.coins >= def.conditionValue;
          break;
        case 'xp_count':
          unlocked = child.xp >= def.conditionValue;
          break;
        case 'level_reach':
          const level = Math.floor(child.xp / 100) + 1;
          unlocked = level >= def.conditionValue;
          break;
        case 'category_count':
          const catCount = getCategoryCount(def.conditionCategory);
          unlocked = catCount >= def.conditionValue;
          break;
        case 'streak_days':
          const streak = await getStreakDays(def.conditionCategory || undefined);
          unlocked = streak >= def.conditionValue;
          break;
        case 'explore_checkin_count':
          unlocked = exploreCheckinCount >= def.conditionValue;
          break;
        case 'explore_category_count': {
          // B4-01: 支持逗号分隔的多分类 OR 统计（如"自然,公园"）
          const cats = String(def.conditionCategory || '').split(',').map(c => c.trim()).filter(Boolean);
          const totalCatCount = cats.length > 0
            ? cats.reduce((sum, cat) => sum + (exploreCategoryCountMap[cat] || 0), 0)
            : 0;
          unlocked = totalCatCount >= def.conditionValue;
          break;
        }
        case 'explore_media_count':
          unlocked = exploreMediaCount >= def.conditionValue;
          break;
        case 'explore_voice_count':
          unlocked = exploreVoiceCount >= def.conditionValue;
          break;
        case 'explore_confirmed_count':
          unlocked = exploreConfirmedCount >= def.conditionValue;
          break;
        case 'explore_distinct_categories':
          unlocked = exploreDistinctCategories >= def.conditionValue;
          break;
      }

      if (unlocked) {
          const existing = await db.get('SELECT id FROM user_achievements WHERE childId = ? AND achievementId = ?', childId, def.id);
          if (!existing) {
              const userAchievementId = randomUUID();
              await db.run('INSERT INTO user_achievements (id, childId, achievementId, unlockedAt) VALUES (?, ?, ?, ?)', userAchievementId, childId, def.id, new Date().toISOString());
              const rewardCoins = Math.max(0, Number(def.rewardCoins || 0));
              const rewardXp = Math.max(0, Number(def.rewardXp || 0));
              const rewardPrivilegePoints = Math.max(0, Number(def.rewardPrivilegePoints || 0));
              const rewardDelivery = def.rewardDelivery === 'backpack' ? 'backpack' : 'instant';
              // F5: 解锁即自动发放，孩子无需手动领取。
              // checkAchievements 各调用点均在事务外，发放部分自包 withTransaction（含串行化）。
              // 守卫式 UPDATE（rewardClaimedAt IS NULL 且 changes===1 才发放）防止重复入账。
              const hasReward = rewardCoins > 0 || rewardXp > 0 || rewardPrivilegePoints > 0;
              let autoInventoryId: string | null = null;
              try {
                await withTransaction(async () => {
                  const claimGuard = await db.run(
                    'UPDATE user_achievements SET rewardClaimedAt = ? WHERE id = ? AND rewardClaimedAt IS NULL',
                    new Date().toISOString(),
                    userAchievementId
                  );
                  if ((claimGuard.changes || 0) !== 1) return; // 已被其它路径领取，跳过发放
                  if (!hasReward) return; // 无奖励：仅标记已领取
                  if (rewardDelivery === 'backpack') {
                    autoInventoryId = randomUUID();
                    await db.run(
                      `INSERT INTO user_inventory (
                         id, childId, title, icon, cost, costType, source, status,
                         rewardCoins, rewardXp, rewardPrivilegePoints, acquiredAt
                       ) VALUES (?, ?, ?, ?, 0, 'coins', 'achievement_reward', 'pending', ?, ?, ?, ?)`,
                      autoInventoryId,
                      childId,
                      `${def.title}成就礼包`,
                      def.icon || '🏆',
                      rewardCoins,
                      rewardXp,
                      rewardPrivilegePoints,
                      new Date().toISOString()
                    );
                    await db.run('UPDATE user_achievements SET rewardInventoryId = ? WHERE id = ?', autoInventoryId, userAchievementId);
                  } else {
                    await db.run(
                      'UPDATE users SET coins = coins + ?, xp = xp + ?, privilegePoints = privilegePoints + ? WHERE id = ?',
                      rewardCoins,
                      rewardXp,
                      rewardPrivilegePoints,
                      childId
                    );
                  }
                });
              } catch (autoClaimErr) {
                console.error('成就奖励自动发放失败:', def.id, autoClaimErr);
              }
              const display = buildAchievementDisplay(def);
              unlockedAchievements.push({
                  id: def.id,
                  title: def.title,
                  description: def.description,
                  icon: def.icon,
                  category: display.category,
                  displayTitle: display.displayTitle,
                  displayDescription: display.displayDescription,
                  displayIcon: display.displayIcon,
                  rankLabel: display.rankLabel,
                  rankIcon: display.rankIcon,
                  rewardCoins,
                  rewardXp,
                  rewardPrivilegePoints,
                  rewardDelivery,
                  rewardClaimed: true,
                  rewardInventoryId: autoInventoryId
              });
          }
      }
  }
  return unlockedAchievements;
};

const seedFamilyData = async (familyId: string, db: any) => {
    // 新家庭只预设成就定义，任务、商品、抽奖奖品等都需要家长手动添加。
    // 成就按成长维度预置，避免所有默认成就堆在“成长”一类里。
    for (const ach of DEFAULT_ACHIEVEMENT_SEEDS) {
        await db.run(
            `INSERT INTO achievement_defs (
                id, familyId, title, description, icon, conditionType, conditionValue,
                conditionCategory, category, rewardCoins, rewardXp, rewardPrivilegePoints, rewardDelivery
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            randomUUID(),
            familyId,
            ach.title,
            ach.desc,
            ach.icon,
            ach.type,
            ach.value,
            ach.conditionCategory || null,
            ach.category,
            Math.max(0, Number(ach.rewardCoins || 0)),
            Math.max(0, Number(ach.rewardXp || 0)),
            Math.max(0, Number(ach.rewardPrivilegePoints || 0)),
            'instant'
        );
    }
};

// 探索模块晚于部分老家庭上线，老家庭缺少默认探索成就定义；按需幂等补齐
const ensureExploreAchievementDefs = async (db: any, familyId: string) => {
  // P3：改为逐条存在性校验（append-only），让老家庭也能增量获得后续新增的探索成就/高光时刻；不动已有
  const isExploreSeed = (ach: any) => String(ach.type).startsWith('explore_') || (ach.type === 'manual' && ach.category === '探索');
  let added = 0;
  for (const ach of DEFAULT_ACHIEVEMENT_SEEDS) {
    if (!isExploreSeed(ach)) continue;
    const exists = ach.type === 'manual'
      ? await db.get(`SELECT id FROM achievement_defs WHERE familyId = ? AND conditionType = 'manual' AND title = ?`, familyId, ach.title)
      : await db.get(`SELECT id FROM achievement_defs WHERE familyId = ? AND conditionType = ? AND conditionValue = ? AND COALESCE(conditionCategory, '') = COALESCE(?, '')`, familyId, ach.type, ach.value, ach.conditionCategory || null);
    if (exists) continue;
    await db.run(
      `INSERT INTO achievement_defs (
          id, familyId, title, description, icon, conditionType, conditionValue,
          conditionCategory, category, rewardCoins, rewardXp, rewardPrivilegePoints, rewardDelivery
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(), familyId, ach.title, ach.desc, ach.icon, ach.type, ach.value,
      ach.conditionCategory || null, ach.category,
      Math.max(0, Number(ach.rewardCoins || 0)),
      Math.max(0, Number(ach.rewardXp || 0)),
      Math.max(0, Number((ach as any).rewardPrivilegePoints || 0)),
      'instant'
    );
    added++;
  }
  if (added > 0) console.log(`✅ 已为家庭 ${familyId} 补齐 ${added} 个探索相关默认成就`);
};

const SMS_CODE_TTL_MINUTES = 5;
const SMS_CODE_RESEND_SECONDS = 60;
const SMS_CODE_MAX_ATTEMPTS = 5;
const SMS_PURPOSES = ['login', 'register', 'reset-password'] as const;
type SmsPurpose = typeof SMS_PURPOSES[number];

const normalizePhone = (phone: unknown) => String(phone || '').trim();
const isValidPhone = (phone: string) => /^1[3-9]\d{9}$/.test(phone);
const maskPhone = (phone: string) => phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
const generateSmsCode = () => String(Math.floor(100000 + Math.random() * 900000));

const findParentByPhone = async (db: any, phone: string) => {
  return db.get(
    `SELECT * FROM users
     WHERE (phone = ? OR email = ?) AND role = 'parent'
     ORDER BY datetime(createdAt) ASC
     LIMIT 1`,
    phone,
    phone
  );
};

const isHashedPin = (pin: unknown) => typeof pin === 'string' && /^\$2[aby]\$\d{2}\$/.test(pin);

const hashPin = async (pin: string) => bcrypt.hash(pin, 10);

const verifyPinValue = async (storedPin: unknown, inputPin: unknown) => {
  const pinText = String(inputPin || '').trim();
  if (!pinText || typeof storedPin !== 'string' || !storedPin) return false;
  if (isHashedPin(storedPin)) {
    return bcrypt.compare(pinText, storedPin);
  }
  return storedPin === pinText;
};

const verifyAndUpgradePin = async (db: any, user: any, inputPin: unknown) => {
  const ok = await verifyPinValue(user?.pin, inputPin);
  if (ok && user?.id && !isHashedPin(user.pin)) {
    await db.run('UPDATE users SET pin = ? WHERE id = ?', await hashPin(String(inputPin).trim()), user.id);
  }
  return ok;
};

const serializeAuthMember = (member: any) => {
  const { pin, password, ...safeMember } = member;
  return {
    ...safeMember,
    hasPin: Boolean(pin),
  };
};

const sendSmsCode = async (phone: string, code: string, purpose: SmsPurpose) => {
  const provider = String(process.env.SMS_PROVIDER || (process.env.NODE_ENV === 'production' ? '' : 'mock')).toLowerCase();

  if (provider === 'mock') {
    console.log('[sms:mock]', { phone: maskPhone(phone), purpose, code });
    return {
      provider: 'mock',
      devCode: process.env.NODE_ENV !== 'production' || process.env.SMS_EXPOSE_DEV_CODE === 'true' ? code : undefined,
    };
  }

  if (provider === 'http') {
    const url = process.env.SMS_HTTP_URL;
    if (!url) {
      const error: any = new Error('SMS_HTTP_URL is not configured');
      error.code = 'SMS_PROVIDER_NOT_CONFIGURED';
      throw error;
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.SMS_HTTP_TOKEN) {
      headers.Authorization = `Bearer ${process.env.SMS_HTTP_TOKEN}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ phone, code, purpose }),
    });

    if (!response.ok) {
      const error: any = new Error(`SMS HTTP provider failed with ${response.status}`);
      error.code = 'SMS_PROVIDER_SEND_FAILED';
      throw error;
    }

    return { provider: 'http' };
  }

  const error: any = new Error('SMS provider is not configured');
  error.code = 'SMS_PROVIDER_NOT_CONFIGURED';
  throw error;
};

const verifySmsCode = async (db: any, phone: string, code: string, purpose: SmsPurpose) => {
  const record = await db.get(
    `SELECT * FROM auth_sms_codes
     WHERE phone = ? AND purpose = ? AND consumedAt IS NULL
     ORDER BY datetime(createdAt) DESC
     LIMIT 1`,
    phone,
    purpose
  );

  if (!record) {
    return { ok: false, status: 400, message: '验证码不存在或已失效' };
  }

  if (new Date(record.expiresAt).getTime() < Date.now()) {
    await db.run('UPDATE auth_sms_codes SET consumedAt = ? WHERE id = ?', new Date().toISOString(), record.id);
    return { ok: false, status: 400, message: '验证码已过期，请重新获取' };
  }

  if ((record.attempts || 0) >= SMS_CODE_MAX_ATTEMPTS) {
    await db.run('UPDATE auth_sms_codes SET consumedAt = ? WHERE id = ?', new Date().toISOString(), record.id);
    return { ok: false, status: 429, message: '验证码尝试次数过多，请重新获取' };
  }

  const matched = await bcrypt.compare(code, record.codeHash);
  if (!matched) {
    const nextAttempts = (record.attempts || 0) + 1;
    const consumedAt = nextAttempts >= SMS_CODE_MAX_ATTEMPTS ? new Date().toISOString() : null;
    await db.run(
      'UPDATE auth_sms_codes SET attempts = ?, consumedAt = COALESCE(?, consumedAt) WHERE id = ?',
      nextAttempts,
      consumedAt,
      record.id
    );
    return { ok: false, status: 400, message: nextAttempts >= SMS_CODE_MAX_ATTEMPTS ? '验证码尝试次数过多，请重新获取' : '验证码错误' };
  }

  await db.run('UPDATE auth_sms_codes SET consumedAt = ? WHERE id = ?', new Date().toISOString(), record.id);
  return { ok: true };
};

// --- ROUTES ---

// Auth
app.post('/api/auth/sms/send', async (req, res) => {
    const db = getDb();
    const phone = normalizePhone(req.body.phone);
    const rawPurpose = String(req.body.purpose || 'login');
    const purpose = SMS_PURPOSES.includes(rawPurpose as SmsPurpose) ? (rawPurpose as SmsPurpose) : null;

    if (!phone || !isValidPhone(phone)) {
      return res.status(400).json({ message: '请输入正确的手机号' });
    }
    if (!purpose) {
      return res.status(400).json({ message: '验证码用途不正确' });
    }

    try {
      const user = await findParentByPhone(db, phone);
      if ((purpose === 'login' || purpose === 'reset-password') && !user) {
        return res.status(404).json({ message: '手机号未注册，请先注册账号' });
      }
      if (purpose === 'register' && user) {
        return res.status(400).json({ message: '该手机号已注册，请直接登录' });
      }

      const latest = await db.get(
        `SELECT createdAt FROM auth_sms_codes
         WHERE phone = ? AND purpose = ? AND consumedAt IS NULL
         ORDER BY datetime(createdAt) DESC
         LIMIT 1`,
        phone,
        purpose
      );
      if (latest?.createdAt) {
        const ageSeconds = (Date.now() - new Date(latest.createdAt).getTime()) / 1000;
        if (ageSeconds >= 0 && ageSeconds < SMS_CODE_RESEND_SECONDS) {
          return res.status(429).json({ message: `请 ${Math.ceil(SMS_CODE_RESEND_SECONDS - ageSeconds)} 秒后再获取验证码` });
        }
      }

      const code = generateSmsCode();
      const sendResult = await sendSmsCode(phone, code, purpose);
      const id = randomUUID();
      const codeHash = await bcrypt.hash(code, 10);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + SMS_CODE_TTL_MINUTES * 60 * 1000).toISOString();

      await db.run('UPDATE auth_sms_codes SET consumedAt = ? WHERE phone = ? AND purpose = ? AND consumedAt IS NULL', now.toISOString(), phone, purpose);
      await db.run(
        `INSERT INTO auth_sms_codes (id, phone, purpose, codeHash, attempts, expiresAt)
         VALUES (?, ?, ?, ?, 0, ?)`,
        id,
        phone,
        purpose,
        codeHash,
        expiresAt
      );

      res.json({
        message: '验证码已发送',
        expiresIn: SMS_CODE_TTL_MINUTES * 60,
        ...(sendResult.devCode ? { devCode: sendResult.devCode } : {})
      });
    } catch (error: any) {
      if (error.code === 'SMS_PROVIDER_NOT_CONFIGURED') {
        return res.status(503).json({ message: '短信服务尚未配置，服务器需要先接入短信服务商密钥' });
      }
      console.error('send sms code failed:', error);
      return res.status(500).json({ message: '验证码发送失败，请稍后重试' });
    }
});

app.post('/api/auth/sms/login', async (req, res) => {
    const db = getDb();
    const phone = normalizePhone(req.body.phone);
    const code = String(req.body.code || '').trim();

    if (!phone || !isValidPhone(phone)) {
      return res.status(400).json({ message: '请输入正确的手机号' });
    }
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ message: '请输入 6 位验证码' });
    }

    try {
      const verification = await verifySmsCode(db, phone, code, 'login');
      if (!verification.ok) {
        return res.status(verification.status || 400).json({ message: verification.message || '验证码校验失败' });
      }

      const user = await findParentByPhone(db, phone);
      if (!user) {
        return res.status(404).json({ message: '手机号未注册，请先注册账号' });
      }

      const today = getLocalDateString();
      await db.run(
        `UPDATE users
         SET lastLoginDate = ?, phone = COALESCE(phone, ?), phoneVerifiedAt = ?, authProvider = 'sms'
         WHERE id = ?`,
        today,
        phone,
        new Date().toISOString(),
        user.id
      );

      res.json({
        token: jwt.sign({ id: user.id, role: user.role, familyId: user.familyId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }),
        user: { id: user.id, name: user.name, role: user.role, familyId: user.familyId }
      });
    } catch (error) {
      console.error('sms login failed:', error);
      return res.status(500).json({ message: '验证码登录失败，请稍后重试' });
    }
});

app.post('/api/auth/mobile/one-click-login', async (_req, res) => {
    if (!process.env.ONE_CLICK_LOGIN_PROVIDER) {
      return res.status(501).json({ message: '一键登录服务尚未接入，当前请使用密码或验证码登录' });
    }
    return res.status(501).json({ message: '一键登录服务商校验逻辑待接入' });
});

app.post('/api/auth/login', async (req, res) => {
    const db = getDb();
    const phone = normalizePhone(req.body.phone);

    if (verboseRequestLogs) {
      console.log('🔐 登录请求:', { phone: phone ? maskPhone(phone) : 'null' });
    }

    if (!phone) {
      return res.status(400).json({ message: '请输入手机号' });
    }

    const user = await findParentByPhone(db, phone);

    if (!user) {
      if (verboseRequestLogs) console.log('❌ 用户不存在:', maskPhone(phone));
      return res.status(400).json({ message: '账号或密码错误' });
    }

    const passwordMatch = await bcrypt.compare(req.body.password, user.password);
    if (!passwordMatch) {
      if (verboseRequestLogs) console.log('❌ 密码错误:', maskPhone(phone));
      return res.status(400).json({ message: '账号或密码错误' });
    }

    if (verboseRequestLogs) console.log('✅ 登录成功:', { userId: user.id, name: user.name, role: user.role });

    // 更新最后登录日期
    const today = getLocalDateString();
    await db.run('UPDATE users SET lastLoginDate = ? WHERE id = ?', today, user.id);

    res.json({ token: jwt.sign({ id: user.id, role: user.role, familyId: user.familyId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }), user: { id: user.id, name: user.name, role: user.role, familyId: user.familyId } });
});

app.post('/api/auth/reset-password', async (req, res) => {
    const phone = normalizePhone(req.body.phone);
    const { pin, newPassword } = req.body;
    const db = getDb();

    if (!phone || !pin || !newPassword) {
        return res.status(400).json({ message: '请填写所有必要信息' });
    }

    const user = await findParentByPhone(db, phone);
    if (!user) {
        return res.status(404).json({ message: '账号不存在' });
    }

    if (!user.pin) {
        return res.status(403).json({ message: '该账号尚未设置 PIN，请先登录后到家庭管理中设置' });
    }

    if (!(await verifyAndUpgradePin(db, user, pin))) {
        return res.status(400).json({ message: 'PIN 码错误，验证失败' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.run('UPDATE users SET password = ? WHERE id = ?', hashedPassword, user.id);

    res.json({ message: '密码重置成功' });
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const email = normalizePhone(req.body.email || req.body.phone);
        const { password } = req.body;

        // 验证输入
        if (!email || !password) {
            return res.status(400).json({ message: '手机号和密码不能为空' });
        }

        // 验证手机号格式（简单验证）
        if (!/^1[3-9]\d{9}$/.test(email)) {
            return res.status(400).json({ message: '请输入正确的手机号格式' });
        }

        // 验证密码长度
        if (password.length < 6) {
            return res.status(400).json({ message: '密码至少需要6位' });
        }

        const db = getDb();
        const smsCode = String(req.body.smsCode || req.body.code || '').trim();

        // 检查手机号是否已注册
        const existingUser = await db.get('SELECT id FROM users WHERE email = ? OR phone = ?', email, email);
        if (existingUser) {
            return res.status(400).json({ message: '该手机号已注册，请直接登录' });
        }

        if (!/^\d{6}$/.test(smsCode)) {
            return res.status(400).json({ message: '请输入 6 位短信验证码' });
        }

        const verification = await verifySmsCode(db, email, smsCode, 'register');
        if (!verification.ok) {
            return res.status(verification.status || 400).json({ message: verification.message || '短信验证码校验失败' });
        }

        const id = randomUUID();
        const hashedPassword = await bcrypt.hash(password, 10);

        // 使用用户 ID 作为初始临时 familyId，确保数据隔离
        const tempFamilyId = id;

        // 使用带重试的数据库操作
        await dbRunWithRetry(
            `INSERT INTO users (id, familyId, email, phone, phoneVerifiedAt, authProvider, password, name, role)
             VALUES (?, ?, ?, ?, ?, 'password', ?, '家长', 'parent')`,
            id, tempFamilyId, email, email, new Date().toISOString(), hashedPassword
        );

        const token = jwt.sign({ id, role: 'parent', familyId: tempFamilyId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        res.json({
          token,
          user: { id, name: '家长', role: 'parent', familyId: tempFamilyId }
        });
    } catch (error: any) {
        console.error('注册错误:', error);

        // SQLite UNIQUE 约束违反
        if (error.code === 'SQLITE_CONSTRAINT' && error.message.includes('UNIQUE')) {
            return res.status(400).json({ message: '该手机号已注册，请直接登录' });
        }

        // 外键约束错误
        if (error.code === 'SQLITE_CONSTRAINT' && error.message.includes('FOREIGN KEY')) {
            console.error('外键约束错误 - TEMP 家庭可能不存在');
            return res.status(500).json({ message: '系统初始化错误，请稍后重试' });
        }

        // 数据库繁忙 - 返回 503 让前端重试
        if (error.code === 'SQLITE_BUSY' || error.message?.includes('database is locked')) {
            return res.status(503).json({ message: '服务器繁忙，请稍后重试' });
        }

        // 其他错误
        return res.status(500).json({ message: '注册失败，请稍后重试' });
    }
});

app.post('/api/auth/create-family', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    if (request.user?.role !== 'parent') return res.status(403).json({ message: '权限不足' });
    const fid = randomUUID();
    const { familyName, name, parentName, parentRole, childName, childGender, childBirthdate } = request.body;
    const actualFamilyName = familyName || name || '我的家庭'; // 兼容不同参数名

    try {
        await getDb().run('BEGIN');
        await getDb().run('INSERT INTO families (id, name) VALUES (?, ?)', fid, actualFamilyName);

        // Update Parent with role/gender
        await getDb().run('UPDATE users SET familyId = ?, name = ?, gender = ? WHERE id = ?', fid, parentName || '家长', parentRole || 'dad', request.user!.id);

        // Create Child only if childName is provided
        if (childName && childName.trim()) {
            await getDb().run(
                `INSERT INTO users (id, familyId, name, role, gender, birthdate, coins, xp, level, maxXp) VALUES (?, ?, ?, 'child', ?, ?, 0, 0, 1, 100)`,
                randomUUID(), fid, childName, childGender || 'boy', childBirthdate || null
            );
        }

        await seedFamilyData(fid, getDb());
        await getDb().run('COMMIT');

        res.json({message:'ok', token: jwt.sign({id:request.user!.id, role:'parent', familyId:fid}, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })});
    } catch (err) {
        await getDb().run('ROLLBACK');
        console.error('创建家庭失败:', err);
        return res.status(500).json({ message: '创建家庭失败，请重试' });
    }
});

app.get('/api/auth/members', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const members = await getDb().all(
      'SELECT id, name, role, avatar, pin, birthdate, gender FROM users WHERE familyId = ?',
      request.user!.familyId
    );
    // 单设备场景：切换用户页向家长卡片展示待审数量，孩子交回手机时家长第一眼就能看到
    const pendingRow = await getDb().get(
      `SELECT COUNT(*) as c FROM task_entries te JOIN tasks t ON te.taskId = t.id
       WHERE t.familyId = ? AND te.status = 'pending'`,
      request.user!.familyId
    );
    const pendingReviewCount = pendingRow?.c || 0;
    res.json(members.map((m: any) => ({
      ...serializeAuthMember(m),
      ...(m.role === 'parent' ? { pendingReviewCount } : {})
    })));
});

app.post('/api/auth/switch-user', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const u = await getDb().get('SELECT * FROM users WHERE id = ? AND familyId = ?', req.body.targetUserId, request.user!.familyId);
    if (!u) return res.status(404).json({ message: '用户不存在' });
    if (u.role === 'parent' && u.id !== request.user!.id) {
        if (!u.pin && process.env.ALLOW_DEFAULT_PARENT_PIN !== 'true') {
            return res.status(403).json({ message: '家长尚未设置PIN，请先由家长登录后设置' });
        }
        const pinOk = u.pin
          ? await verifyAndUpgradePin(getDb(), u, req.body.pin)
          : req.body.pin === '1234';
        if (!pinOk) {
            return res.status(403).json({ message: 'PIN错误' });
        }
    }
    // 更新最后登录日期
    const today = getLocalDateString();
    await getDb().run('UPDATE users SET lastLoginDate = ? WHERE id = ?', today, u.id);

    // 字段白名单：绝不把 password/pin 哈希返回给前端（单设备场景下孩子可接触到响应数据）
    res.json({token:jwt.sign({id:u.id, role:u.role, familyId:u.familyId}, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }), user:serializeAuthMember(u)});
});

// Child switch to parent via PIN
// 默认 PIN 仅在明确配置 ALLOW_DEFAULT_PARENT_PIN=true 时保留兼容。
app.post('/api/child/switch-to-parent', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    if (request.user?.role !== 'child') return res.status(403).json({ message: '权限不足' });
    const { pin } = request.body;
    const db = getDb();
    const parent = await db.get("SELECT * FROM users WHERE familyId = ? AND role = 'parent' LIMIT 1", request.user!.familyId);

    if (!parent) return res.status(404).json({ message: '未找到家长账号' });

    if (!parent.pin && process.env.ALLOW_DEFAULT_PARENT_PIN !== 'true') {
        return res.status(403).json({ message: '家长尚未设置PIN，请先由家长登录后设置' });
    }

    const isDefaultPin = !parent.pin;
    const pinOk = parent.pin
        ? await verifyAndUpgradePin(db, parent, pin)
        : pin === '1234';

    if (!pinOk) {
        return res.status(403).json({ message: 'PIN码错误' });
    }

    res.json({
        token: jwt.sign({ id: parent.id, role: parent.role, familyId: parent.familyId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }),
        user: { id: parent.id, name: parent.name, role: parent.role, familyId: parent.familyId },
        isDefaultPin // 告诉前端是否使用的是默认PIN
    });
});

app.use('/api/parent', protect, requireParent);
app.use('/api/child', protect, requireChild);
registerRewardSystemRoutes(app, protect);
registerProductConfigRoutes(app, protect);
registerParentInboxRoutes(app, protect);
registerEconomyRoutes(app, protect, requireParent);
registerExploreFeedRoutes(app, protect, requireParent, requireChild);
registerWeeklyReportRoutes(app, protect, requireParent, requireChild);

// Parent Family Management
app.post('/api/parent/set-pin', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const pin = String(request.body?.pin || '').trim();
    if (!/^\d{4,6}$/.test(pin)) {
        return res.status(400).json({ message: 'PIN 必须是 4-6 位数字' });
    }
    await getDb().run('UPDATE users SET pin = ? WHERE id = ?', await hashPin(pin), request.user!.id);
    res.json({message:'ok'});
});

app.delete('/api/parent/family/members/:id', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    if (request.user?.role !== 'parent') return res.status(403).json({message: '权限不足'});

    // 防止删除自己
    if (req.params.id === request.user!.id) return res.status(400).json({message: '不能删除自己'});

    await getDb().run('DELETE FROM users WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
    res.json({message:'ok'});
});

app.post('/api/parent/family/members', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    if (request.user?.role !== 'parent') return res.status(403).json({message: '权限不足'});
    const { name, role, birthdate, gender } = request.body;
    const id = randomUUID();
    await getDb().run(`INSERT INTO users (id, familyId, name, role, coins, xp, level, maxXp, birthdate, gender) VALUES (?, ?, ?, ?, 0, 0, 1, 100, ?, ?)`,
        id, request.user!.familyId, name, role || 'child', birthdate, gender || 'boy');
    res.json({ message: 'ok', member: { id, name, role, birthdate, gender } });
});

app.put('/api/parent/family/members/:id', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    if (request.user?.role !== 'parent') return res.status(403).json({message: '权限不足'});
    const { name, birthdate, gender } = request.body;

    if (!name) return res.status(400).json({message: '名字不能为空'});

    await getDb().run('UPDATE users SET name = ?, birthdate = ?, gender = ? WHERE id = ? AND familyId = ?',
        name, birthdate, gender, req.params.id, request.user!.familyId);
    res.json({ message: 'ok' });
});

// P0(h): dashboard 自动审批节流。家长多标签页/频繁刷新会反复触发全量扫描，
// 进程级 Map 记录每个家庭上次运行时刻，5 分钟内已跑过则跳过（仅影响自动审批，dashboard 其余查询照常）。
const AUTO_APPROVE_THROTTLE_MS = 5 * 60 * 1000;
const autoApproveLastRunByFamily = new Map<string, number>();

// --- 自动审批过期任务（当天00:00:00-23:59:59未审批的任务，按中间档自动审批）---
// 注意：只自动审批昨天及之前提交的任务（按北京时间），今天的任务需要家长手动审批
const autoApproveExpiredTasks = async (db: any, familyId: string) => {
  // 获取今天的日期（强制使用北京时间 UTC+8）
  const todayBeijing = getLocalDateString();
  const beijingTimeStr = getBeijingTimeString();
  console.log(`🔄 自动审批检查，北京时间：${beijingTimeStr}，今天日期：${todayBeijing}`);

  // 获取所有待审核任务，然后在 Node.js 中判断是否过期
  // 这样可以避免依赖 SQLite 的 localtime 设置
  const allPendingEntries = await db.all(`
    SELECT te.id, te.childId, t.coinReward, t.xpReward, t.taskType, te.submittedAt, t.title
    FROM task_entries te
    JOIN tasks t ON te.taskId = t.id
    WHERE t.familyId = ? AND te.status = 'pending' AND COALESCE(te.autoCompleted, 0) = 0
  `, familyId);

  console.log(`📊 当前所有 pending 任务 (${allPendingEntries.length} 个):`);

  // 筛选出需要自动审批的过期任务（提交日期在今天之前的）
  const expiredEntries = allPendingEntries.filter((p: any) => {
    // 解析 ISO 时间字符串，获取北京时间日期
    const submitDate = new Date(p.submittedAt);
    const submitDateBeijing = getLocalDateString(submitDate);
    const isExpired = submitDateBeijing < todayBeijing;
    console.log(`  - ID:${p.id.substring(0,8)}，标题:${p.title}，提交时间(UTC):${p.submittedAt}，北京日期:${submitDateBeijing}，${isExpired ? '【过期-将自动审批】' : '【今天-保留待审】'}`);
    return isExpired;
  });

  if (expiredEntries.length > 0) {
    console.log(`🔄 发现 ${expiredEntries.length} 个过期待审批任务，开始自动审批...`);
  } else {
    console.log(`✅ 没有过期任务需要自动审批`);
  }

  for (const entry of expiredEntries) {
    const submitDateBeijing = getLocalDateString(new Date(entry.submittedAt));

    try {
      const outcome = await settleTaskEntry(db, {
        entryId: entry.id,
        familyId,
        grantGameMinutes: settlementEntry => grantTaskSettlementGameMinutes(db, familyId, settlementEntry),
      }, withTransaction);
      console.log(`  ✅ 自动审批任务 ${entry.id}，提交日期(北京时间)：${submitDateBeijing}，奖励：${outcome.result.coinsAwarded}金币，${outcome.result.growthXpAwarded}经验`);
    } catch (error) {
      console.error(`  ❌ 自动审批任务 ${entry.id} 失败（已回滚，下次 dashboard 加载时重试）:`, error);
    }
  }

  if (expiredEntries.length > 0) {
    console.log(`✅ 自动审批完成，共处理 ${expiredEntries.length} 个任务`);
  }

  return expiredEntries.length;
};

// Parent Dashboard & Features
app.get('/api/parent/dashboard', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb(); const familyId = request.user!.familyId;
  await finalizeOverdueTaskSessions(db, { familyId });

  // 调试：输出当前时间信息
  const serverNow = new Date();
  const localDateStr = getLocalDateString();
  console.log(`🕐 服务器时间：${serverNow.toISOString()}，本地日期：${localDateStr}，familyId：${familyId}`);

  // 自动审批过期任务（超过24小时未审批的任务）。P0(h): 5 分钟内已跑过则跳过，避免频繁刷新重复扫描。
  const autoApproveNow = Date.now();
  const autoApproveLastRun = autoApproveLastRunByFamily.get(familyId) || 0;
  if (autoApproveNow - autoApproveLastRun >= AUTO_APPROVE_THROTTLE_MS) {
    autoApproveLastRunByFamily.set(familyId, autoApproveNow);
    await autoApproveExpiredTasks(db, familyId);
  }

  // R1 性能：以下三个互不依赖的只读查询并行执行（上方写操作保持串行）
  const [pendingReviews, weekEntries, recentReviewed, lowEnergyChildren] = await Promise.all([
    // 获取待审核任务，包含金币和经验信息（只显示启用任务的待审核记录）
    db.all(`
    SELECT te.id, t.title, t.coinReward, t.xpReward, t.durationMinutes as expectedDuration,
           t.category, t.taskType, t.completionMode, t.targetValue, t.targetUnit, t.reviewFocus,
           u.name as childName, te.submittedAt, te.proof, te.actualDurationMinutes as actualDuration,
           te.autoCompleted, te.autoCompleteReason,
           date(te.submittedAt, '+8 hours') as submitDate
    FROM task_entries te
    JOIN tasks t ON te.taskId = t.id
    JOIN users u ON te.childId = u.id
    WHERE t.familyId = ? AND te.status = 'pending' AND t.isEnabled = 1
    ORDER BY te.submittedAt DESC`, familyId),
    // 本周统计 - 使用 LEFT JOIN 确保包含已删除任务的完成记录
    // 这样即使任务被删除（isEnabled = 0），历史统计数据也会保留
    db.all(`
    SELECT te.submittedAt, te.status, te.earnedCoins, te.actualDurationMinutes,
           COALESCE(t.durationMinutes, 30) as expectedDuration
    FROM task_entries te
    LEFT JOIN tasks t ON te.taskId = t.id
    WHERE (t.familyId = ? OR t.familyId IS NULL) AND date(te.submittedAt, '+8 hours') >= date('now', '+8 hours', '-7 days')
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = te.childId AND u.familyId = ?)`, familyId, familyId),
    // 获取最近已审核的任务（最近7天，最多20条）
    db.all(`
    SELECT te.id, t.title, t.category,
           te.earnedCoins, te.earnedXp, te.status,
           u.name as childName, te.submittedAt, te.reviewedAt, te.actualDurationMinutes as actualDuration
    FROM task_entries te
    JOIN tasks t ON te.taskId = t.id
    JOIN users u ON te.childId = u.id
    WHERE t.familyId = ? AND te.status IN ('approved', 'rejected')
    AND date(te.submittedAt, '+8 hours') >= date('now', '+8 hours', '-7 days')
    ORDER BY te.submittedAt DESC
    LIMIT 20`, familyId),
    // 低电量模式：今天（北京时间）开启的孩子，家长知情但无需操作
    db.all(`SELECT id as childId, name FROM users WHERE familyId = ? AND role = 'child' AND lowEnergyDate = ?`, familyId, getLocalDateString()),
  ]);

  console.log(`📋 家长端查询待审核任务，找到 ${pendingReviews.length} 条记录`);
  if (pendingReviews.length > 0) {
    pendingReviews.forEach((r: any) => {
      console.log(`  - 任务：${r.title}，提交日期：${r.submitDate}，提交时间：${r.submittedAt}`);
    });
  }

  // 调试日志：如果查询结果为空，检查是否有 pending 状态的记录
  if (pendingReviews.length === 0) {
    const allPending = await db.all(`
      SELECT te.id, te.taskId, te.status, t.title, t.isEnabled, t.familyId, date(te.submittedAt, '+8 hours') as submitDate
      FROM task_entries te
      LEFT JOIN tasks t ON te.taskId = t.id
      WHERE te.status = 'pending'
      AND EXISTS (SELECT 1 FROM users u WHERE u.id = te.childId AND u.familyId = ?)
    `, familyId);
    if (allPending.length > 0) {
      console.log(`⚠️ 发现 ${allPending.length} 个pending任务但未显示在待审核列表中:`);
      allPending.forEach((p: any) => {
        console.log(`  - 任务ID：${p.taskId}，标题：${p.title}，isEnabled：${p.isEnabled}，familyId：${p.familyId}，提交日期：${p.submitDate}`);
      });
    } else {
      console.log('ℹ️ 当前没有待审核任务');
    }
  }

  const total = weekEntries.length; // 本周提交总数
  const completed = weekEntries.filter(e => e.status === 'approved').length; // 已通过数
  const rate = total === 0 ? 0 : Math.round((completed / total) * 100);

  // 准时率：实际用时 <= 预计用时 的任务占比
  // 只计算已通过审核的任务
  const approvedEntries = weekEntries.filter(e => e.status === 'approved');
  const punctualCount = approvedEntries.filter(e => {
    // 如果没有记录实际时长，默认视为准时
    if (!e.actualDurationMinutes) return true;
    // 实际用时 <= 预计用时 * 1.2 (允许20%的容差)
    return e.actualDurationMinutes <= (e.expectedDuration * 1.2);
  }).length;
  // 准时率：如果没有已审核的任务，显示 0% 而非 100%
  const punctualRate = approvedEntries.length === 0 ? 0 : Math.round((punctualCount / approvedEntries.length) * 100);

  // 本周获得的总金币
  const totalCoinsEarned = weekEntries
    .filter(e => e.status === 'approved')
    .reduce((sum, e) => sum + (e.earnedCoins || 0), 0);

  res.json({
    pendingReviews,
    recentReviewed,
    lowEnergyChildren,
    stats: {
      weekTasks: total,
      weekCompleted: completed,
      completionRate: `${rate}%`,
      punctualRate: `${punctualRate}%`,
      totalCoinsEarned
    }
  });
});

// 审核历史查询 API - 支持按日期查询
app.get('/api/parent/review-history', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const familyId = request.user!.familyId;
  await finalizeOverdueTaskSessions(db, { familyId });
  const { date, startDate, endDate, dateFrom, dateTo, status, category, childId } = req.query; // date 格式: YYYY-MM-DD

  let query = `
    SELECT te.id, t.title, t.category,
           te.earnedCoins, te.earnedXp, te.status,
           u.name as childName, te.submittedAt, te.reviewedAt,
           te.actualDurationMinutes as actualDuration,
           date(te.submittedAt, '+8 hours') as submitDate,
           (SELECT SUM(pr.deductedCoins) FROM punishment_records pr WHERE pr.taskEntryId = te.id) as punishmentDeduction
    FROM task_entries te
    JOIN tasks t ON te.taskId = t.id
    JOIN users u ON te.childId = u.id
    WHERE t.familyId = ? AND te.status IN ('approved', 'rejected')
    AND NOT (
      te.status = 'rejected'
      AND EXISTS (
        SELECT 1 FROM task_entries te2
        WHERE te2.taskId = te.taskId
          AND te2.childId = te.childId
          AND te2.status = 'approved'
          AND date(te2.submittedAt, '+8 hours') = date(te.submittedAt, '+8 hours')
      )
    )
  `;

  const params: any[] = [familyId];
  const categoryValues = getTaskCategoryFilterValues(category);
  const childIdFilter = decodeQueryText(childId);

  const fromDate = startDate || dateFrom;
  const toDate = endDate || dateTo;

  if (date) {
    // 查询指定日期的记录
    query += ` AND date(te.submittedAt, '+8 hours') = ?`;
    params.push(date);
  } else if (fromDate || toDate) {
    if (fromDate) {
      query += ` AND date(te.submittedAt, '+8 hours') >= ?`;
      params.push(fromDate);
    }
    if (toDate) {
      query += ` AND date(te.submittedAt, '+8 hours') <= ?`;
      params.push(toDate);
    }
  } else {
    // 默认返回最近7天
    query += ` AND date(te.submittedAt, '+8 hours') >= date('now', '+8 hours', '-7 days')`;
  }
  if (status && ['approved', 'rejected'].includes(String(status))) {
    query += ` AND te.status = ?`;
    params.push(status);
  }
  if (categoryValues.length > 0) {
    query += ` AND t.category IN (${categoryValues.map(() => '?').join(', ')})`;
    params.push(...categoryValues);
  }
  if (childIdFilter && childIdFilter !== 'all') {
    query += ` AND te.childId = ?`;
    params.push(childIdFilter);
  }

  query += ` ORDER BY te.submittedAt DESC LIMIT 50`;

  const records = await db.all(query, ...params);

  // 获取有审核记录的日期列表（最近30天）
  const datesWithRecords = await db.all(`
    SELECT DISTINCT date(te.submittedAt, '+8 hours') as date, COUNT(*) as count
    FROM task_entries te
    JOIN tasks t ON te.taskId = t.id
    WHERE t.familyId = ? AND te.status IN ('approved', 'rejected')
    AND NOT (
      te.status = 'rejected'
      AND EXISTS (
        SELECT 1 FROM task_entries te2
        WHERE te2.taskId = te.taskId
          AND te2.childId = te.childId
          AND te2.status = 'approved'
          AND date(te2.submittedAt, '+8 hours') = date(te.submittedAt, '+8 hours')
      )
    )
    AND date(te.submittedAt, '+8 hours') >= date('now', '+8 hours', '-30 days')
    GROUP BY date(te.submittedAt, '+8 hours')
    ORDER BY date DESC
  `, familyId);

  res.json({ records, datesWithRecords });
});

// 详细统计数据 API
app.get('/api/parent/stats', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const familyId = request.user!.familyId;

  // 使用北京时间计算日期（不依赖服务器本地时区）
  const todayBeijing = getLocalDateString();

  // 获取家庭中的所有孩子
  const children = await db.all('SELECT id, name, coins, xp FROM users WHERE familyId = ? AND role = "child"', familyId);

  if (children.length === 0) {
    return res.json({
      overview: { todayTasks: 0, weekTasks: 0, monthTasks: 0, totalTasks: 0, streakDays: 0, maxStreakDays: 0 },
      coins: { todayEarned: 0, weekEarned: 0, monthEarned: 0, totalEarned: 0, todaySpent: 0, weekSpent: 0, monthSpent: 0, totalSpent: 0 },
      categoryStats: [],
      dailyAverage: 0,
      coinTrend: [],
      nearestAchievements: [],
      children: [],
      wellbeing: {
        punishmentCount: 0,
        autoCompletedCount: 0,
        emotionCheckins: 0,
        helpfulEmotionRate: null,
        screenMinutes: 0,
        screenSessions: 0,
        chestCount: 0,
        achievementCount: 0
      },
      dimensionScores: [],
      recommendations: ['先添加孩子并完成几条任务，成长总览会自动出现。']
    });
  }

  const childIds = children.map(c => c.id);
  const childIdPlaceholders = childIds.map(() => '?').join(',');

  // === 1. 任务完成数统计 ===
  // 使用 Node.js 计算的北京时间日期作为参数，避免依赖 SQLite localtime
  const allApprovedEntries = await db.all(`
    SELECT submittedAt FROM task_entries
    WHERE childId IN (${childIdPlaceholders}) AND status = 'approved'
  `, ...childIds);

  // 在 Node.js 中计算各时间段的任务数
  let todayTasks = 0, weekTasks = 0, monthTasks = 0;
  const totalTasks = allApprovedEntries.length;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  for (const entry of allApprovedEntries) {
    const submitDate = new Date(entry.submittedAt);
    const submitDateBeijing = getLocalDateString(submitDate);

    if (submitDateBeijing === todayBeijing) {
      todayTasks++;
    }
    if (submitDate >= weekAgo) {
      weekTasks++;
    }
    if (submitDate >= monthAgo) {
      monthTasks++;
    }
  }

  // === 2. 连续打卡天数 ===
  // 使用 Node.js 计算北京时间日期，避免依赖 SQLite localtime
  const allApprovedEntriesForStreak = await db.all(`
    SELECT submittedAt FROM task_entries
    WHERE childId IN (${childIdPlaceholders}) AND status = 'approved'
  `, ...childIds);

  // 在 Node.js 中计算每个任务的北京时间日期
  const taskDaysSet = new Set<string>();
  for (const entry of allApprovedEntriesForStreak) {
    const submitDate = new Date(entry.submittedAt);
    const submitDateBeijing = getLocalDateString(submitDate);
    taskDaysSet.add(submitDateBeijing);
  }
  // 转换为数组并排序（降序）
  const taskDays = Array.from(taskDaysSet).sort((a, b) => b.localeCompare(a));

  let streakDays = 0;
  const todayStr = todayBeijing;

  if (taskDays.length > 0) {
    // 检查今天是否有完成任务
    const hasTaskToday = taskDays[0] === todayStr;
    // 如果今天没完成任务，从昨天开始算（允许当天还未完成的情况）
    const startOffset = hasTaskToday ? 0 : 1;

    for (let i = 0; i < taskDays.length; i++) {
      const dayStr = taskDays[i];
      // 计算期望日期（北京时间）- 使用时间戳计算，避免跨年问题
      const beijingNow = getBeijingDate();
      // 使用时间戳减去天数（毫秒），避免 setDate 跨年问题
      const daysToSubtract = i + startOffset;
      const expectedTimestamp = beijingNow.getTime() - (daysToSubtract * 24 * 60 * 60 * 1000);
      const expectedDate = getBeijingDate(new Date(expectedTimestamp));
      // 使用 getLocalDateString 确保格式一致
      const expectedStr = getLocalDateString(expectedDate);

      if (dayStr === expectedStr) {
        streakDays++;
      } else {
        break;
      }
    }
  }

  // 计算历史最长连续天数
  let maxStreakDays = 0;
  let currentStreak = 0;
  let prevDateStr: string | null = null;

  for (const dayStr of taskDays) {
    if (prevDateStr === null) {
      currentStreak = 1;
    } else {
      // 解析日期字符串，计算天数差
      const prevDate = new Date(prevDateStr + 'T00:00:00');
      const currDate = new Date(dayStr + 'T00:00:00');
      const diff = (prevDate.getTime() - currDate.getTime()) / 86400000;
      if (diff === 1) {
        currentStreak++;
      } else {
        maxStreakDays = Math.max(maxStreakDays, currentStreak);
        currentStreak = 1;
      }
    }
    prevDateStr = dayStr;
  }
  maxStreakDays = Math.max(maxStreakDays, currentStreak);

  // === 3. 金币获得/消耗统计 ===
  // 使用已经获取的任务数据计算金币统计
  const allApprovedEntriesWithCoins = await db.all(`
    SELECT submittedAt, earnedCoins FROM task_entries
    WHERE childId IN (${childIdPlaceholders}) AND status = 'approved'
  `, ...childIds);

  let todayEarned = 0, weekEarned = 0, monthEarned = 0, totalEarned = 0;
  for (const entry of allApprovedEntriesWithCoins) {
    const coins = entry.earnedCoins || 0;
    const submitDate = new Date(entry.submittedAt);
    const submitDateBeijing = getLocalDateString(submitDate);

    totalEarned += coins;
    if (submitDateBeijing === todayBeijing) {
      todayEarned += coins;
    }
    if (submitDate >= weekAgo) {
      weekEarned += coins;
    }
    if (submitDate >= monthAgo) {
      monthEarned += coins;
    }
  }

  // 消耗金币统计（使用 Node.js 处理日期）
  const allInventory = await db.all(`
    SELECT acquiredAt, cost FROM user_inventory
    WHERE childId IN (${childIdPlaceholders}) AND costType = 'coins' AND status != 'cancelled'
  `, ...childIds);

  let todaySpent = 0, weekSpent = 0, monthSpent = 0, totalSpent = 0;
  for (const item of allInventory) {
    const cost = item.cost || 0;
    const acquiredDate = new Date(item.acquiredAt);
    const acquiredDateBeijing = getLocalDateString(acquiredDate);

    totalSpent += cost;
    if (acquiredDateBeijing === todayBeijing) {
      todaySpent += cost;
    }
    if (acquiredDate >= weekAgo) {
      weekSpent += cost;
    }
    if (acquiredDate >= monthAgo) {
      monthSpent += cost;
    }
  }

  // === 4. 分类任务完成比例 ===
  const categoryStats = await db.all(`
    SELECT t.category, COUNT(*) as count
    FROM task_entries te
    JOIN tasks t ON te.taskId = t.id
    WHERE te.childId IN (${childIdPlaceholders}) AND te.status = 'approved'
    GROUP BY t.category
  `, ...childIds);

  const normalizedCategoryCounts = new Map<string, number>();
  for (const row of categoryStats) {
    const categoryName = normalizeTaskCategoryInput(row.category);
    normalizedCategoryCounts.set(categoryName, (normalizedCategoryCounts.get(categoryName) || 0) + Number(row.count || 0));
  }
  const totalCategoryCount = Array.from(normalizedCategoryCounts.values()).reduce((sum, count) => sum + count, 0);
  const categoryWithPercent = Array.from(normalizedCategoryCounts.entries())
    .map(([category, count]) => ({
      category,
      count,
      percent: totalCategoryCount > 0 ? Math.round((count / totalCategoryCount) * 100) : 0
    }))
    .sort((a, b) => b.count - a.count);

  // === 5. 每日平均任务完成数（最近30天）===
  const activeDays = (await db.get(`
    SELECT COUNT(DISTINCT date(submittedAt, '+8 hours')) as days
    FROM task_entries
    WHERE childId IN (${childIdPlaceholders}) AND status = 'approved'
    AND date(submittedAt, '+8 hours') >= date('now', '+8 hours', '-30 days')
  `, ...childIds))?.days || 0;

  const dailyAverage = activeDays > 0 ? Math.round((monthTasks / activeDays) * 10) / 10 : 0;

  // === 6. 金币趋势（最近7天）===
  const coinTrend = await db.all(`
    SELECT date(submittedAt, '+8 hours') as date, COALESCE(SUM(earnedCoins), 0) as earned
    FROM task_entries
    WHERE childId IN (${childIdPlaceholders}) AND status = 'approved'
    AND date(submittedAt, '+8 hours') >= date('now', '+8 hours', '-7 days')
    GROUP BY date(submittedAt, '+8 hours')
    ORDER BY date ASC
  `, ...childIds);

  // 补全最近7天的数据
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = getLocalDateString(d);
    const existing = coinTrend.find(t => t.date === dateStr);
    last7Days.push({
      date: dateStr,
      dayOfWeek: ['日', '一', '二', '三', '四', '五', '六'][d.getDay()],
      earned: existing?.earned || 0
    });
  }

  // === 7. 最接近解锁的成就 ===
  const allDefs = await db.all('SELECT * FROM achievement_defs WHERE familyId = ?', familyId);
  const unlocked = await db.all(`
    SELECT achievementId FROM user_achievements
    WHERE childId IN (${childIdPlaceholders})
  `, ...childIds);
  const unlockedIds = new Set(unlocked.map(u => u.achievementId));

  // 计算每个未解锁成就的进度
  const nearestAchievements: any[] = [];

  for (const def of allDefs) {
    if (unlockedIds.has(def.id)) continue;
    if (def.conditionType === 'manual') continue;

    let progress = 0;
    switch (def.conditionType) {
      case 'task_count': progress = totalTasks; break;
      case 'coin_count': progress = children.reduce((sum, c) => sum + (c.coins || 0), 0); break;
      case 'xp_count': progress = children.reduce((sum, c) => sum + (c.xp || 0), 0); break;
      case 'level_reach': progress = Math.floor(children.reduce((sum, c) => sum + (c.xp || 0), 0) / 100) + 1; break;
      case 'streak_days': progress = streakDays; break;
      case 'category_count':
        const catStat = categoryStats.find(c => c.category === def.conditionCategory);
        progress = catStat?.count || 0;
        break;
    }

    const percent = def.conditionValue > 0 ? Math.min(Math.round((progress / def.conditionValue) * 100), 99) : 0;

    nearestAchievements.push({
      id: def.id,
      title: def.title,
      description: def.description,
      icon: def.icon,
      conditionType: def.conditionType,
      conditionValue: def.conditionValue,
      progress,
      percent
    });
  }

  // 按进度百分比排序，取最接近的3个
  nearestAchievements.sort((a, b) => b.percent - a.percent);
  const top3Achievements = nearestAchievements.slice(0, 3);

  // === 8. 每个孩子的简要统计 ===
  const childrenStats = await Promise.all(children.map(async (child) => {
    const childTasks = (await db.get(`
      SELECT COUNT(*) as count FROM task_entries
      WHERE childId = ? AND status = 'approved'
    `, child.id))?.count || 0;

    return {
      id: child.id,
      name: child.name,
      coins: child.coins,
      xp: child.xp,
      level: Math.floor((child.xp || 0) / 100) + 1,
      totalTasks: childTasks
    };
  }));

  // === 9. 体验质量维度（最近7天）===
  const recentPunishments = (await db.get(`
    SELECT COUNT(*) as count
    FROM punishment_records
    WHERE familyId = ? AND date(createdAt, '+8 hours') >= date('now', '+8 hours', '-7 days')
  `, familyId))?.count || 0;
  const recentAutoCompleted = (await db.get(`
    SELECT COUNT(*) as count
    FROM task_sessions
    WHERE familyId = ? AND status = 'auto_completed' AND date(autoCompletedAt, '+8 hours') >= date('now', '+8 hours', '-7 days')
  `, familyId))?.count || 0;
  const recentEmotion = await db.get(`
    SELECT COUNT(*) as count,
           SUM(CASE WHEN helped = 1 THEN 1 ELSE 0 END) as helpedCount
    FROM emotion_checkins
    WHERE familyId = ? AND date(createdAt, '+8 hours') >= date('now', '+8 hours', '-7 days')
  `, familyId);
  const recentScreen = await db.get(`
    SELECT COUNT(*) as sessions,
           COALESCE(SUM(CASE WHEN status IN ('running', 'completed', 'cancelled') THEN plannedMinutes ELSE 0 END), 0) as minutes
    FROM screen_time_sessions
    WHERE familyId = ? AND date(startedAt, '+8 hours') >= date('now', '+8 hours', '-7 days')
  `, familyId);
  const recentChest = (await db.get(`
    SELECT COUNT(*) as count
    FROM chest_records
    WHERE familyId = ? AND date(createdAt, '+8 hours') >= date('now', '+8 hours', '-7 days')
  `, familyId))?.count || 0;
  const recentAchievements = (await db.get(`
    SELECT COUNT(*) as count
    FROM user_achievements ua
    JOIN users u ON ua.childId = u.id
    WHERE u.familyId = ? AND date(ua.unlockedAt, '+8 hours') >= date('now', '+8 hours', '-7 days')
  `, familyId))?.count || 0;

  const recentEmotionCount = Number(recentEmotion?.count || 0);
  const helpfulEmotionRate = recentEmotionCount > 0
    ? Math.round((Number(recentEmotion?.helpedCount || 0) / recentEmotionCount) * 100)
    : null;
  const screenMinutes = Number(recentScreen?.minutes || 0);
  const screenSessions = Number(recentScreen?.sessions || 0);
  const avgDailyScreen = Math.round(screenMinutes / 7);
  const categoryCoverage = Math.min(7, categoryWithPercent.length);
  const punishmentPressure = weekTasks > 0 ? recentPunishments / weekTasks : (recentPunishments > 0 ? 1 : 0);
  const immediateFeedbackRatio = weekTasks > 0 ? recentChest / weekTasks : 0;
  const clampScore = (score: number) => Math.max(0, Math.min(100, Math.round(score)));
  const dimensionScores = [
    {
      key: 'activation',
      label: '启动稳定',
      value: `${activeDays}/30天`,
      score: clampScore((Math.min(activeDays, 14) / 14) * 100),
      tone: activeDays >= 7 ? 'green' : activeDays >= 3 ? 'blue' : 'orange',
      hint: activeDays >= 7 ? '近期启动节奏不错' : '先追求多天启动，不急着堆任务量'
    },
    {
      key: 'balance',
      label: '能力均衡',
      value: `${categoryCoverage}/7类`,
      score: clampScore((categoryCoverage / 7) * 100),
      tone: categoryCoverage >= 4 ? 'green' : categoryCoverage >= 2 ? 'blue' : 'orange',
      hint: categoryCoverage >= 4 ? '任务类型比较均衡' : '可补充生活、学习、早晨启动、运动、活动或情绪中的空白'
    },
    {
      key: 'feedback',
      label: '即时反馈',
      value: `${recentChest}次`,
      score: clampScore(weekTasks === 0 ? 60 : Math.min(1, immediateFeedbackRatio) * 100),
      tone: immediateFeedbackRatio >= 0.8 || weekTasks === 0 ? 'green' : immediateFeedbackRatio >= 0.4 ? 'blue' : 'orange',
      hint: weekTasks === 0 ? '有任务后会看宝箱反馈覆盖率' : '完成任务后的宝箱反馈越及时，越容易形成闭环'
    },
    {
      key: 'pressure',
      label: '规则压力',
      value: `${recentPunishments}次`,
      score: clampScore(100 - Math.min(1, punishmentPressure) * 100),
      tone: punishmentPressure > 0.35 ? 'red' : recentPunishments > 0 ? 'orange' : 'green',
      hint: punishmentPressure > 0.35 ? '惩罚偏高，建议复盘规则是否过细' : '近期惩罚压力可控'
    },
    {
      key: 'screen',
      label: '游戏票节制',
      value: `${screenMinutes}分钟`,
      score: clampScore(avgDailyScreen <= 25 ? 95 : avgDailyScreen <= 40 ? 75 : avgDailyScreen <= 60 ? 55 : 30),
      tone: avgDailyScreen <= 25 ? 'green' : avgDailyScreen <= 45 ? 'blue' : 'orange',
      hint: screenSessions === 0 ? '近期没有游戏票使用' : `日均约 ${avgDailyScreen} 分钟`
    },
    {
      key: 'emotion',
      label: '情绪自助',
      value: recentEmotionCount > 0 ? `${helpfulEmotionRate}%` : '暂无',
      score: helpfulEmotionRate === null ? 60 : clampScore(helpfulEmotionRate),
      tone: helpfulEmotionRate === null ? 'blue' : helpfulEmotionRate >= 70 ? 'green' : helpfulEmotionRate >= 40 ? 'orange' : 'red',
      hint: recentEmotionCount > 0 ? `记录 ${recentEmotionCount} 次，看看哪些动作真的有帮助` : '孩子开始记录后，会显示有效安抚率'
    }
  ];

  const recommendations: string[] = [];
  if (activeDays <= 2) recommendations.push('最近启动天数偏少，建议首页只保留少量低阻力任务，让孩子先重新获得“我能开始”的体验。');
  if (categoryCoverage <= 2 && weekTasks >= 3) recommendations.push('任务完成集中在少数类别，可以补一点早晨启动、运动、活动或情绪调节类任务，避免奖励体系只奖励效率。');
  if (weekTasks > 0 && immediateFeedbackRatio < 0.8) recommendations.push('近期宝箱反馈没有覆盖大多数完成任务，建议保持“完成任务即抽奖”的即时反馈。');
  if (punishmentPressure > 0.35) recommendations.push('惩罚次数相对完成任务偏高，建议把高频违规改成提醒、替代动作或更短任务。');
  if (avgDailyScreen > 45) recommendations.push('游戏票日均使用偏高，建议收紧每日上限、冷却时间或允许时段。');
  if (helpfulEmotionRate !== null && helpfulEmotionRate < 50) recommendations.push('情绪急救的有效率偏低，可以和孩子一起换一个更容易执行的安抚动作。');
  if (recentAutoCompleted > 0) recommendations.push(`最近有 ${recentAutoCompleted} 个任务由系统跨日自动完成，建议家长和孩子一起确认是否需要更明显的结束提醒。`);
  if (recommendations.length === 0) recommendations.push('近期成长数据比较平稳，可以继续保持当前规则，并观察孩子最有获得感的任务类型。');

  res.json({
    overview: {
      todayTasks,
      weekTasks,
      monthTasks,
      totalTasks,
      streakDays,
      maxStreakDays
    },
    coins: {
      todayEarned,
      weekEarned,
      monthEarned,
      totalEarned,
      todaySpent,
      weekSpent,
      monthSpent,
      totalSpent
    },
    categoryStats: categoryWithPercent,
    dailyAverage,
    coinTrend: last7Days,
    nearestAchievements: top3Achievements,
    children: childrenStats,
    wellbeing: {
      punishmentCount: recentPunishments,
      autoCompletedCount: recentAutoCompleted,
      emotionCheckins: recentEmotionCount,
      helpfulEmotionRate,
      screenMinutes,
      screenSessions,
      chestCount: recentChest,
      achievementCount: recentAchievements
    },
    dimensionScores,
    recommendations
  });
});

app.post('/api/parent/review/:entryId', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const { action, qualityScore } = req.body;
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ message: '无效的审核操作' });
    const entry = await getDb().get(`
      SELECT te.*, t.title as taskTitle, t.coinReward, t.xpReward, t.durationMinutes as expectedDuration,
             t.category, t.completionMode, t.targetValue, t.targetUnit, t.taskType, t.familyId
      FROM task_entries te
      JOIN tasks t ON te.taskId = t.id
      WHERE te.id = ?
    `, req.params.entryId);
    if (!entry) return res.status(404).json({ message: '不存在' });
    if (entry.familyId !== request.user!.familyId) return res.status(403).json({ message: '无权操作' });
    if (entry.status !== 'pending' && !(action === 'approve' && entry.status === 'approved')) {
        return res.status(409).json({ message: '该任务已处理，请勿重复审核' });
    }

    if (action === 'reject') {
        // P3：打回必须告诉孩子原因，否则孩子"做了但不知道为什么没通过"
        const reason = String(req.body.reason || '').trim();
        if (!reason) return res.status(400).json({ message: '请填写打回原因，让孩子知道哪里可以改进' });
        await getDb().run("UPDATE task_entries SET status = 'rejected', reviewedAt = ?, reviewNote = ? WHERE id = ? AND status = 'pending'", new Date().toISOString(), reason.slice(0, 200), req.params.entryId);
        return res.json({ message: '已打回，孩子会看到你的说明' });
    }

    // 评分只用于给家长提供过程反馈；实际到账始终按任务上已确认的基础奖励结算。
    const suggestion = calculateReviewSuggestion(entry.coinReward, entry.xpReward, entry.actualDurationMinutes, entry.expectedDuration, qualityScore);
    try {
        const outcome = await settleTaskEntry(getDb(), {
          entryId: req.params.entryId,
          familyId: request.user!.familyId,
          grantGameMinutes: settlementEntry => grantTaskSettlementGameMinutes(getDb(), request.user!.familyId, settlementEntry),
        }, withTransaction);
        const unlockedAchievements = outcome.alreadySettled ? [] : await checkAchievements(outcome.childId, getDb());
        return res.json({
          message: outcome.alreadySettled ? '该任务已通过' : '已通过',
          alreadyReviewed: outcome.alreadySettled,
          ...outcome.result,
          unlockedAchievements,
          suggestion,
        });
    } catch (err: any) {
        if (err instanceof TaskSettlementError) return res.status(err.statusCode).json({ message: err.message });
        console.error('审核任务失败:', err);
        return res.status(500).json({ message: '审核失败，请重试' });
    }
});


// ============================================================
// 学习闯关系统 API
// ============================================================

const normalizeLearningQuestTitle = (value: unknown) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

const findDuplicateLearningQuest = async (db: any, familyId: string, title: unknown, excludeId = '') => {
  const normalizedTitle = normalizeLearningQuestTitle(title);
  if (!normalizedTitle) return null;
  const rows = await db.all(
    `SELECT id, title
       FROM learning_quests
      WHERE familyId = ? AND COALESCE(isActive, 1) != 0`,
    familyId
  );
  return rows.find((row: any) =>
    row.id !== excludeId && normalizeLearningQuestTitle(row.title) === normalizedTitle
  ) || null;
};

const normalizeLearningSteps = (rawSteps: any[] | undefined, fallbackMinutes: number) => {
  const source = Array.isArray(rawSteps) && rawSteps.length > 0
    ? rawSteps
    : [
        { title: '准备学习用品', minutes: 2, coins: 1, xp: 2, prompt: '先把书、本子和笔放到桌面上。' },
        { title: '完成第一小步', minutes: Math.max(3, Math.min(10, fallbackMinutes || 5)), coins: 3, xp: 5, prompt: '只做当前这一小步，不用想全部。' },
      ];

  return source.slice(0, 12).map((step, index) => ({
    id: step.id || randomUUID(),
    title: String(step.title || `第 ${index + 1} 关`).trim().slice(0, 80),
    minutes: Math.max(1, Math.min(60, Number(step.minutes || 5))),
    coins: Math.max(0, Math.min(999, Number(step.coins || 0))),
    xp: Math.max(0, Math.min(999, Number(step.xp || 0))),
    prompt: String(step.prompt || '').trim().slice(0, 240),
    stepOrder: index,
  }));
};

const getLearningQuestWithSteps = async (db: any, questId: string, familyId: string) => {
  const quest = await db.get('SELECT * FROM learning_quests WHERE id = ? AND familyId = ?', questId, familyId);
  if (!quest) return null;
  const steps = await db.all('SELECT * FROM learning_steps WHERE questId = ? ORDER BY stepOrder ASC', questId);
  return { ...quest, steps };
};

const clampMinutes = (value: any, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
};

const normalizeTimeText = (value: any, fallback: string) => {
  const text = String(value || '').trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
};

const MORNING_STARTUP_CATEGORY = '早晨启动';
const SCREEN_TIME_SOURCES = {
  STUDY_SAVED_TIME: 'study_saved_time',
  MORNING_STARTUP: 'morning_startup',
  MORNING_STARTUP_STREAK_3: 'morning_startup_streak_3',
  PARENT: 'parent',
  MANUAL: 'manual',
} as const;

const getOrCreateScreenTimeRules = async (db: any, familyId: string) => {
  await db.run('INSERT OR IGNORE INTO screen_time_rules (familyId, dailyBaseMinutes) VALUES (?, 15)', familyId);
  return db.get('SELECT * FROM screen_time_rules WHERE familyId = ?', familyId);
};

const getCurrentScreenTimeWindow = (rules: any) => {
  const now = getBeijingDate();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  const startText = isWeekend ? rules.weekendAllowedStart : rules.weekdayAllowedStart;
  const endText = isWeekend ? rules.weekendAllowedEnd : rules.weekdayAllowedEnd;
  const parse = (text: string) => {
    const [h, m] = String(text || '00:00').split(':').map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  const start = parse(startText);
  const end = parse(endText);
  const isAllowed = start <= end
    ? minutesNow >= start && minutesNow <= end
    : minutesNow >= start || minutesNow <= end;
  return {
    isWeekend,
    start: startText,
    end: endText,
    isAllowed: Boolean(rules.isEnabled) && isAllowed,
    beijingTime: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
  };
};

const getChildScreenTimeSummary = async (db: any, familyId: string, childId: string) => {
  const rules = await getOrCreateScreenTimeRules(db, familyId);
  const ledger = await db.get(
    `SELECT COALESCE(SUM(deltaMinutes), 0) as total
       FROM screen_time_ledger
      WHERE familyId = ? AND childId = ?
        AND date(createdAt, '+8 hours') = date('now', '+8 hours')`,
    familyId,
    childId
  );
  const ledgerBreakdownRows = await db.all(
    `SELECT COALESCE(NULLIF(source, ''), 'manual') as source,
            COALESCE(SUM(deltaMinutes), 0) as total
       FROM screen_time_ledger
      WHERE familyId = ? AND childId = ?
        AND date(createdAt, '+8 hours') = date('now', '+8 hours')
      GROUP BY COALESCE(NULLIF(source, ''), 'manual')`,
    familyId,
    childId
  );
  const used = await db.get(
    `SELECT COALESCE(SUM(plannedMinutes), 0) as total
       FROM screen_time_sessions
      WHERE familyId = ? AND childId = ?
        AND status IN ('running', 'completed', 'cancelled')
        AND date(startedAt, '+8 hours') = date('now', '+8 hours')`,
    familyId,
    childId
  );
  const activeSession = await db.get(
    `SELECT *
       FROM screen_time_sessions
      WHERE familyId = ? AND childId = ? AND status = 'running'
      ORDER BY datetime(startedAt) DESC
      LIMIT 1`,
    familyId,
    childId
  );
  const cooldownMinutes = Math.max(0, Number(rules.cooldownMinutes || 0));
  const lastEndedSession = await db.get(
    `SELECT endedAt,
            (julianday('now') - julianday(endedAt)) * 1440 as minutesAgo
       FROM screen_time_sessions
      WHERE familyId = ? AND childId = ?
        AND status IN ('completed', 'cancelled')
        AND endedAt IS NOT NULL
        AND date(endedAt, '+8 hours') = date('now', '+8 hours')
      ORDER BY datetime(endedAt) DESC
      LIMIT 1`,
    familyId,
    childId
  );
  const dailyBaseMinutes = Boolean(rules.isEnabled) ? Number(rules.dailyBaseMinutes || 0) : 0;
  const dailyMaxMinutes = Math.max(dailyBaseMinutes, Number(rules.dailyMaxMinutes || dailyBaseMinutes));
  const earnedMinutes = Number(ledger?.total || 0);
  const sourceTotals = (ledgerBreakdownRows || []).reduce((acc: Record<string, number>, row: any) => {
    acc[String(row.source || SCREEN_TIME_SOURCES.MANUAL)] = Number(row.total || 0);
    return acc;
  }, {});
  const studySavedMinutes = Number(sourceTotals[SCREEN_TIME_SOURCES.STUDY_SAVED_TIME] || 0);
  const morningStartupMinutes = Number(sourceTotals[SCREEN_TIME_SOURCES.MORNING_STARTUP] || 0);
  const morningStreakMinutes = Number(sourceTotals[SCREEN_TIME_SOURCES.MORNING_STARTUP_STREAK_3] || 0);
  const manualMinutes = Number(sourceTotals[SCREEN_TIME_SOURCES.PARENT] || 0) + Number(sourceTotals[SCREEN_TIME_SOURCES.MANUAL] || 0);
  const otherEarnedMinutes = earnedMinutes - studySavedMinutes - morningStartupMinutes - morningStreakMinutes - manualMinutes;
  const todayUsed = Number(used?.total || 0);
  const allowance = Boolean(rules.isEnabled) ? Math.max(0, Math.min(dailyMaxMinutes, dailyBaseMinutes + earnedMinutes)) : 0;
  const balance = Math.max(0, allowance - todayUsed);
  const minutesAgo = Number(lastEndedSession?.minutesAgo || 0);
  const isCoolingDown = Boolean(cooldownMinutes > 0 && lastEndedSession && minutesAgo < cooldownMinutes);
  return {
    rules,
    dailyBaseMinutes,
    dailyMaxMinutes,
    earnedMinutes,
    todayUsed,
    allowance,
    balance,
    breakdown: {
      base: dailyBaseMinutes,
      earned: earnedMinutes,
      studySaved: studySavedMinutes,
      morningStartup: morningStartupMinutes,
      morningStreak: morningStreakMinutes,
      manual: manualMinutes,
      other: otherEarnedMinutes,
      used: todayUsed,
      allowance,
      balance,
      sources: sourceTotals,
    },
    activeSession,
    cooldown: {
      cooldownMinutes,
      isCoolingDown,
      minutesUntilNext: isCoolingDown ? Math.max(1, Math.ceil(cooldownMinutes - minutesAgo)) : 0,
      lastEndedAt: lastEndedSession?.endedAt || null,
    },
    window: getCurrentScreenTimeWindow(rules),
  };
};

type ScreenTimeGrantResult = {
  requestedMinutes: number;
  grantedMinutes: number;
  cappedMinutes: number;
  dailyMaxMinutes: number;
  allowanceBefore: number;
  earnedMinutesBefore: number;
  balanceBefore: number;
  source: string;
  reason: string;
};

const emptyScreenTimeGrantResult = (
  source: string,
  reason = '',
  overrides: Partial<ScreenTimeGrantResult> = {}
): ScreenTimeGrantResult => ({
  requestedMinutes: 0,
  grantedMinutes: 0,
  cappedMinutes: 0,
  dailyMaxMinutes: 0,
  allowanceBefore: 0,
  earnedMinutesBefore: 0,
  balanceBefore: 0,
  source,
  reason,
  ...overrides,
});

const getScreenTimeGrantResult = async (
  db: any,
  familyId: string,
  childId: string,
  requestedMinutes: number,
  source: string,
  reason = ''
): Promise<ScreenTimeGrantResult> => {
  const requested = Math.max(0, Math.floor(Number(requestedMinutes || 0)));
  if (requested <= 0) return emptyScreenTimeGrantResult(source, reason);
  const summary = await getChildScreenTimeSummary(db, familyId, childId);
  const headroom = Math.max(0, Number(summary.dailyMaxMinutes || 0) - Number(summary.allowance || 0));
  const granted = Math.min(requested, headroom);
  return {
    requestedMinutes: requested,
    grantedMinutes: granted,
    cappedMinutes: Math.max(0, requested - granted),
    dailyMaxMinutes: Number(summary.dailyMaxMinutes || 0),
    allowanceBefore: Number(summary.allowance || 0),
    earnedMinutesBefore: Number(summary.earnedMinutes || 0),
    balanceBefore: Number(summary.balance || 0),
    source,
    reason,
  };
};

const getScreenTimeGrantMinutes = async (db: any, familyId: string, childId: string, requestedMinutes: number) => {
  const result = await getScreenTimeGrantResult(db, familyId, childId, requestedMinutes, SCREEN_TIME_SOURCES.MANUAL);
  return result.grantedMinutes;
};

const shiftDateString = (dateStr: string, deltaDays: number) => {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  if (!year || !month || !day) return dateStr;
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

const getMorningStartupStreakDays = async (db: any, childId: string) => {
  const categoryValues = getTaskCategoryFilterValues(MORNING_STARTUP_CATEGORY);
  const rows = await db.all(
    `SELECT DISTINCT date(te.submittedAt, '+8 hours') as day
       FROM task_entries te
       JOIN tasks t ON te.taskId = t.id
      WHERE te.childId = ?
        AND te.status = 'approved'
        AND t.category IN (${categoryValues.map(() => '?').join(', ')})
      ORDER BY day DESC`,
    childId,
    ...categoryValues
  );
  const approvedDays = new Set((rows || []).map((row: any) => String(row.day || '')).filter(Boolean));
  let cursor = getLocalDateString();
  let streak = 0;
  while (approvedDays.has(cursor)) {
    streak += 1;
    cursor = shiftDateString(cursor, -1);
  }
  return streak;
};

const grantStudySavedGameTickets = async (
  db: any,
  input: {
    familyId: string;
    childId: string;
    title: string;
    expectedMinutes: any;
    actualMinutes: any;
    taskEntryId?: string | null;
    learningSessionId?: string | null;
  }
) => {
  const rules = await getOrCreateScreenTimeRules(db, input.familyId);
  if (!Boolean(rules?.isEnabled) || Number(rules?.studySavedTimeEnabled ?? 1) !== 1) {
    return emptyScreenTimeGrantResult(SCREEN_TIME_SOURCES.STUDY_SAVED_TIME, 'disabled');
  }

  const expected = Math.max(0, Math.round(Number(input.expectedMinutes || 0)));
  const actual = Math.max(0, Math.ceil(Number(input.actualMinutes || 0)));
  if (expected <= 0 || actual <= 0) {
    return emptyScreenTimeGrantResult(SCREEN_TIME_SOURCES.STUDY_SAVED_TIME, 'missing_duration');
  }

  const savedMinutes = Math.max(0, Math.floor(expected - actual));
  if (savedMinutes <= 0) {
    return emptyScreenTimeGrantResult(SCREEN_TIME_SOURCES.STUDY_SAVED_TIME, 'no_saved_time');
  }

  if (input.taskEntryId) {
    const existing = await db.get(
      "SELECT id FROM screen_time_ledger WHERE taskEntryId = ? AND source = ? LIMIT 1",
      input.taskEntryId,
      SCREEN_TIME_SOURCES.STUDY_SAVED_TIME
    );
    if (existing) return emptyScreenTimeGrantResult(SCREEN_TIME_SOURCES.STUDY_SAVED_TIME, 'duplicate');
  }
  if (input.learningSessionId) {
    const existing = await db.get(
      "SELECT id FROM screen_time_ledger WHERE learningSessionId = ? AND source = ? LIMIT 1",
      input.learningSessionId,
      SCREEN_TIME_SOURCES.STUDY_SAVED_TIME
    );
    if (existing) return emptyScreenTimeGrantResult(SCREEN_TIME_SOURCES.STUDY_SAVED_TIME, 'duplicate');
  }

  const ratio = Math.max(0, Math.min(2, Number(rules.studySavedTimeRatio ?? 1) || 1));
  const requestedMinutes = Math.max(0, Math.floor(savedMinutes * ratio));
  const grant = await getScreenTimeGrantResult(
    db,
    input.familyId,
    input.childId,
    requestedMinutes,
    SCREEN_TIME_SOURCES.STUDY_SAVED_TIME,
    'study_saved_time'
  );
  if (grant.grantedMinutes <= 0) return grant;

  await db.run(
    `INSERT INTO screen_time_ledger (id, familyId, childId, deltaMinutes, reason, source, taskEntryId, learningSessionId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    input.familyId,
    input.childId,
    grant.grantedMinutes,
    `学习节省时间：${String(input.title || '学习任务').slice(0, 60)}`,
    SCREEN_TIME_SOURCES.STUDY_SAVED_TIME,
    input.taskEntryId || null,
    input.learningSessionId || null
  );

  return grant;
};

const grantMorningStartupGameTickets = async (
  db: any,
  input: {
    familyId: string;
    childId: string;
    title: string;
    taskEntryId: string;
  }
) => {
  const rules = await getOrCreateScreenTimeRules(db, input.familyId);
  if (!Boolean(rules?.isEnabled)) {
    return { total: 0, startupMinutes: 0, streakBonusMinutes: 0, streakDays: 0, requestedMinutes: 0, cappedMinutes: 0, grants: [] as ScreenTimeGrantResult[] };
  }

  let startupMinutes = 0;
  const grants: ScreenTimeGrantResult[] = [];
  const existingForTask = await db.get(
    'SELECT id FROM screen_time_ledger WHERE taskEntryId = ? AND source = ? LIMIT 1',
    input.taskEntryId,
    SCREEN_TIME_SOURCES.MORNING_STARTUP
  );
  const existingToday = await db.get(
    `SELECT id
       FROM screen_time_ledger
      WHERE familyId = ? AND childId = ? AND source = ?
        AND date(createdAt, '+8 hours') = date('now', '+8 hours')
      LIMIT 1`,
    input.familyId,
    input.childId,
    SCREEN_TIME_SOURCES.MORNING_STARTUP
  );

  if (!existingForTask && !existingToday) {
    const startupGrant = await getScreenTimeGrantResult(
      db,
      input.familyId,
      input.childId,
      1,
      SCREEN_TIME_SOURCES.MORNING_STARTUP,
      'morning_startup'
    );
    grants.push(startupGrant);
    startupMinutes = startupGrant.grantedMinutes;
    if (startupMinutes > 0) {
      await db.run(
        `INSERT INTO screen_time_ledger (id, familyId, childId, deltaMinutes, reason, source, taskEntryId)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(),
        input.familyId,
        input.childId,
        startupMinutes,
        `早晨启动：${String(input.title || '小启动').slice(0, 60)}`,
        SCREEN_TIME_SOURCES.MORNING_STARTUP,
        input.taskEntryId
      );
    }
  }

  const streakDays = await getMorningStartupStreakDays(db, input.childId);
  let streakBonusMinutes = 0;
  if (streakDays === 3) {
    const existingStreakBonus = await db.get(
      `SELECT id
         FROM screen_time_ledger
        WHERE familyId = ? AND childId = ? AND source = ?
          AND date(createdAt, '+8 hours') = date('now', '+8 hours')
        LIMIT 1`,
      input.familyId,
      input.childId,
      SCREEN_TIME_SOURCES.MORNING_STARTUP_STREAK_3
    );
    if (!existingStreakBonus) {
      const streakGrant = await getScreenTimeGrantResult(
        db,
        input.familyId,
        input.childId,
        3,
        SCREEN_TIME_SOURCES.MORNING_STARTUP_STREAK_3,
        'morning_startup_streak_3'
      );
      grants.push(streakGrant);
      streakBonusMinutes = streakGrant.grantedMinutes;
      if (streakBonusMinutes > 0) {
        await db.run(
          `INSERT INTO screen_time_ledger (id, familyId, childId, deltaMinutes, reason, source)
           VALUES (?, ?, ?, ?, ?, ?)`,
          randomUUID(),
          input.familyId,
          input.childId,
          streakBonusMinutes,
          '连续3天早晨启动',
          SCREEN_TIME_SOURCES.MORNING_STARTUP_STREAK_3
        );
      }
    }
  }

  return {
    total: startupMinutes + streakBonusMinutes,
    startupMinutes,
    streakBonusMinutes,
    streakDays,
    requestedMinutes: grants.reduce((sum, grant) => sum + grant.requestedMinutes, 0),
    cappedMinutes: grants.reduce((sum, grant) => sum + grant.cappedMinutes, 0),
    grants,
  };
};

const grantTaskSettlementGameMinutes = async (db: any, familyId: string, entry: any) => {
  const category = normalizeRewardCategory(entry.category);
  if (category === '学习') {
    const grant = await grantStudySavedGameTickets(db, {
      familyId,
      childId: entry.childId,
      title: entry.taskTitle,
      expectedMinutes: entry.expectedDuration,
      actualMinutes: entry.actualDurationMinutes,
      taskEntryId: entry.id,
    });
    return {
      gameMinutesAwarded: grant.grantedMinutes,
      gameTicketAwardLabel: '学习节省游戏票',
      gameTicketMinutesRequested: grant.requestedMinutes,
      gameTicketMinutesCapped: grant.cappedMinutes,
      gameTicketGrant: grant,
      reasons: grant.grantedMinutes > 0
        ? [`比预计时间节省，获得${grant.grantedMinutes}分钟游戏时间`]
        : [],
    };
  }

  const morning = await grantMorningStartupGameTickets(db, {
    familyId,
    childId: entry.childId,
    title: entry.taskTitle,
    taskEntryId: entry.id,
  });
  return {
    gameMinutesAwarded: morning.total,
    gameTicketAwardLabel: morning.streakBonusMinutes > 0 ? '早晨启动与连续奖励游戏票' : '早晨启动游戏票',
    gameTicketMinutesRequested: morning.requestedMinutes,
    gameTicketMinutesCapped: morning.cappedMinutes,
    morningStartupTicketMinutesAwarded: morning.startupMinutes,
    morningStartupStreakBonusAwarded: morning.streakBonusMinutes,
    morningStartupStreakDays: morning.streakDays,
    gameTicketGrant: morning.grants[0] || null,
    reasons: morning.total > 0 ? [`早晨启动获得${morning.total}分钟游戏时间`] : [],
  };
};

const DEFAULT_BREAKFAST_ITEMS = [
  { title: '白粥鸡蛋', icon: '🥣', category: '主食', costCoins: 0, description: '基础早餐，永远免费。', isDefault: 1 },
  { title: '牛奶麦片', icon: '🥛', category: '饮品', costCoins: 0, description: '温和、稳定、容易准备。', isDefault: 1 },
  { title: '水果杯', icon: '🍓', category: '水果', costCoins: 3, description: '用少量金币换一个清爽升级。', isDefault: 0 },
  { title: '三明治', icon: '🥪', category: '蛋白', costCoins: 5, description: '更有饱腹感的升级早餐。', isDefault: 0 },
  { title: '周末特别早餐', icon: '🥞', category: '套餐', costCoins: 12, description: '适合周末或提前约定的惊喜。', isDefault: 0 },
];

const seedBreakfastItemsIfEmpty = async (db: any, familyId: string) => {
  const row = await db.get('SELECT COUNT(*) as count FROM breakfast_items WHERE familyId = ?', familyId);
  if (Number(row?.count || 0) > 0) return;
  for (const item of DEFAULT_BREAKFAST_ITEMS) {
    await db.run(
      `INSERT INTO breakfast_items (id, familyId, title, description, icon, category, costCoins, isDefault)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(), familyId, item.title, item.description, item.icon, item.category, item.costCoins, item.isDefault
    );
  }
};

const getBreakfastItems = async (db: any, familyId: string, onlyActive = false) => {
  await seedBreakfastItemsIfEmpty(db, familyId);
  return db.all(
    `SELECT * FROM breakfast_items
      WHERE familyId = ? ${onlyActive ? 'AND COALESCE(isActive, 1) != 0' : ''}
      ORDER BY isActive DESC, costCoins ASC, category ASC, createdAt ASC`,
    familyId
  );
};

const normalizeBreakfastDate = (value: unknown) => {
  const text = String(value || getLocalDateString()).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : getLocalDateString();
};

const parseBreakfastOptionIds = (value: unknown): string[] => {
  const clean = (items: unknown[]) => items
    .map(item => String(item || '').trim())
    .filter(item => item && item !== 'undefined' && item !== 'null');
  if (Array.isArray(value)) return clean(value);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? clean(parsed) : [];
  } catch {
    return [];
  }
};

const uniqueBreakfastIds = (value: unknown): string[] => Array.from(new Set(parseBreakfastOptionIds(value)));

const summarizeBreakfastItems = (items: any[]) => {
  const safeItems = items.filter(Boolean);
  if (safeItems.length === 0) {
    return { title: '早餐组合', icon: '🍽️', costCoins: 0 };
  }
  const title = safeItems.length === 1
    ? safeItems[0].title
    : safeItems.map(item => item.title).join(' + ').slice(0, 80);
  const icon = safeItems.length === 1 ? (safeItems[0].icon || '🍽️') : '🍽️';
  const costCoins = safeItems.reduce((sum, item) => sum + Math.max(0, Number(item.costCoins || 0)), 0);
  return { title, icon, costCoins };
};

const hydrateBreakfastOrder = (order: any) => {
  if (!order) return null;
  let items: any[] = [];
  try {
    const parsed = order.itemsSnapshot ? JSON.parse(order.itemsSnapshot) : [];
    items = Array.isArray(parsed) ? parsed : [];
  } catch {
    items = [];
  }
  const itemIds = uniqueBreakfastIds(order.itemIds);
  if (items.length === 0 && order.itemId) {
    items = [{
      id: order.itemId,
      title: order.title,
      icon: order.icon,
      category: order.category || '早餐',
      costCoins: Number(order.costCoins || 0),
    }];
  }
  return {
    ...order,
    itemIds: itemIds.length ? itemIds : items.map(item => item.id).filter(Boolean),
    items,
  };
};

const hydrateBreakfastPlan = async (db: any, familyId: string, plan: any) => {
  if (!plan) return null;
  const optionIds = parseBreakfastOptionIds(plan.optionItemIds);
  const ids = Array.from(new Set([plan.defaultItemId, ...optionIds].filter(Boolean)));
  const items = ids.length
    ? await db.all(
      `SELECT * FROM breakfast_items WHERE familyId = ? AND id IN (${ids.map(() => '?').join(',')})`,
      familyId,
      ...ids
    )
    : [];
  const byId = new Map(items.map((item: any) => [item.id, item]));
  const defaultItem = plan.defaultItemId ? byId.get(plan.defaultItemId) || null : null;
  const optionItems = optionIds.map(id => byId.get(id)).filter(Boolean);
  return {
    ...plan,
    optionItemIds: optionIds,
    defaultItem,
    optionItems,
  };
};

const getBreakfastPlanForChild = async (db: any, familyId: string, childId: string, date: string) => {
  const plan = await db.get(
    `SELECT * FROM breakfast_plans
      WHERE familyId = ? AND planDate = ? AND (childId = ? OR childId IS NULL)
      ORDER BY CASE WHEN childId = ? THEN 0 ELSE 1 END, datetime(updatedAt) DESC
      LIMIT 1`,
    familyId,
    date,
    childId,
    childId
  );
  return hydrateBreakfastPlan(db, familyId, plan);
};

const awardChildRewards = async (db: any, childId: string, coins: number, xp: number) => {
  const safeCoins = Math.max(0, Math.round(Number(coins || 0)));
  const safeXp = Math.max(0, Math.round(Number(xp || 0)));
  if (safeCoins === 0 && safeXp === 0) return 0;

  await db.run('UPDATE users SET coins = coins + ?, xp = xp + ? WHERE id = ?', safeCoins, safeXp, childId);
  if (safeXp <= 0) return 0;

  const user = await db.get('SELECT rewardXpTotal FROM users WHERE id = ?', childId);
  const oldRewardXpTotal = Number(user?.rewardXpTotal || 0);
  const newRewardXpTotal = oldRewardXpTotal + safeXp;
  const privilegePointsAwarded = Math.floor(newRewardXpTotal / 100) - Math.floor(oldRewardXpTotal / 100);
  await db.run(
    'UPDATE users SET rewardXpTotal = ?, privilegePoints = privilegePoints + ? WHERE id = ?',
    newRewardXpTotal,
    Math.max(0, privilegePointsAwarded),
    childId
  );
  return Math.max(0, privilegePointsAwarded);
};

const REWARD_RULE_CATEGORIES: Record<string, any> = {
  学习: {
    icon: '📚',
    baseCoins: 10,
    xpRate: 1.5,
    privilegeThreshold: 30,
    focus: '启动、拆小步、求助和质量',
    advice: '学习类金币适中，经验更高；结算时不鼓励“越快越好”，重点看认真和坚持。',
  },
  早晨启动: {
    icon: '🌤️',
    baseCoins: 3,
    xpRate: 2,
    privilegeThreshold: 999,
    focus: '愿意开始、情绪平稳、完成一小步',
    advice: '早晨启动只做3到6分钟，奖励轻量但即时；审核通过后每天最多给1分钟游戏票。',
  },
  生活: {
    icon: '🌱',
    baseCoins: 5,
    xpRate: 1.15,
    privilegeThreshold: 80,
    focus: '稳定、少提醒、结果可用、逐步独立',
    advice: '生活类单次金币要小，连续稳定比一次高额奖励更重要；速度只作拖延提醒。',
  },
  运动: {
    icon: '🏃',
    baseCoins: 8,
    xpRate: 1.35,
    privilegeThreshold: 45,
    mode: 'activity',
    unitLabel: '参与量/组数',
    focus: '参与完整、动作安全、强度适合、连续性',
    advice: '运动不要按效率快慢奖励，先奖励愿意动起来，再看动作安全和连续性。',
  },
  活动: {
    icon: '🎨',
    baseCoins: 9,
    xpRate: 1.35,
    privilegeThreshold: 60,
    mode: 'activity',
    unitLabel: '活动段数',
    focus: '投入过程、约定成果、合作表达',
    advice: '活动类更像探索和兴趣练习，经验可以高一点，金币保持中等，不按速度结算。',
  },
  情绪调节: {
    icon: '💗',
    baseCoins: 3,
    xpRate: 2,
    privilegeThreshold: 90,
    focus: '识别情绪、使用替代动作、恢复速度',
    advice: '情绪调节更适合给经验和认可，不建议高频给大量金币。',
  },
  早餐选择: {
    icon: '🍽️',
    baseCoins: 0,
    xpRate: 0.5,
    privilegeThreshold: 999,
    focus: '选择权、真实生活消费',
    advice: '早餐基础项免费，金币只用于升级选择权。',
  },
  其他: {
    icon: '✨',
    baseCoins: 5,
    xpRate: 1.1,
    privilegeThreshold: 70,
    focus: '明确目标和可观察结果',
    advice: '先确认这件事主要训练什么，再决定金币和经验。',
  },
};

const coefficientFromLevel = (value: string, map: Record<string, number>, fallback = 1) => map[value] ?? fallback;

const calculateRuleSuggestion = (input: any) => {
  const rawCategory = String(input?.category || '').trim();
  const normalizedTaskCategory = normalizeRewardCategory(rawCategory);
  const category = REWARD_RULE_CATEGORIES[rawCategory]
    ? rawCategory
    : REWARD_RULE_CATEGORIES[normalizedTaskCategory]
      ? normalizedTaskCategory
      : '其他';
  const rule = REWARD_RULE_CATEGORIES[category];
  const isActivityMode = rule.mode === 'activity';
  const isBreakfastMode = category === '早餐选择';
  const minutes = Math.max(1, Math.min(180, Math.round(Number(input?.minutes || 10))));
  const activityCount = Math.max(1, Math.min(12, Math.round(Number(input?.activityCount || input?.minutes || 1))));
  const unitFactor = isActivityMode
    ? Math.max(0.9, Math.min(1.8, Math.sqrt(activityCount / 2)))
    : Math.max(0.8, Math.min(2.2, Math.sqrt(minutes / 10)));
  const difficultyFactor = coefficientFromLevel(input?.difficulty, { easy: 0.8, normal: 1, hard: 1.25, challenge: 1.45 }, 1);
  const resistanceFactor = coefficientFromLevel(input?.resistance, { low: 0.9, medium: 1, high: 1.25, crisis: 1.45 }, 1);
  const independenceFactor = coefficientFromLevel(input?.independence, { assisted: 0.9, reminded: 1, independent: 1.15, proactive: 1.3 }, 1);
  const qualityFactor = coefficientFromLevel(input?.quality, { try: 0.9, complete: 1, good: 1.15, excellent: 1.3 }, 1);

  let coins = Math.round(rule.baseCoins * unitFactor * difficultyFactor * resistanceFactor * independenceFactor * qualityFactor);
  if (isBreakfastMode) coins = 0;
  coins = Math.max(0, Math.min(180, coins));

  const xp = Math.max(1, Math.round(Math.max(coins, rule.baseCoins || 2) * rule.xpRate * qualityFactor));
  const privilegePoints = !isBreakfastMode && (isActivityMode ? activityCount >= 4 : minutes >= rule.privilegeThreshold) && resistanceFactor >= 1.25 ? 1 : 0;
  const breakfastCost = isBreakfastMode
    ? Math.max(0, Math.round(Number(input?.estimatedRmb || 0) * 10))
    : null;

  return {
    category,
    rule,
    coins,
    xp,
    privilegePoints,
      breakfastCost,
      coefficients: {
      unitFactor: Number(unitFactor.toFixed(2)),
      difficultyFactor,
      resistanceFactor,
      independenceFactor,
      qualityFactor,
    },
    explanation: [
      `${category}的核心是：${rule.focus}`,
      isBreakfastMode
        ? `基础早餐建议免费，升级早餐可参考 ${breakfastCost} 金币，最终仍建议在「早餐小厨房」里按家庭实际设置。`
        : isActivityMode
        ? `本次按 ${activityCount} 组活动、参与阻力、独立度和完成质量综合估算，不按时长堆奖励。`
        : `本次按 ${minutes} 分钟、难度/抗拒/独立度/质量综合估算。`,
      privilegePoints > 0 ? '建议给 1 个特权点，因为这是高阻力或高自控任务。' : '本次不建议额外给特权点，保持特权点稀缺性。',
      rule.advice,
    ],
  };
};

app.get('/api/parent/learning-quests', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const rows = await db.all(
    `SELECT lq.*,
            (SELECT COUNT(*) FROM learning_steps ls WHERE ls.questId = lq.id) as stepCount,
            (SELECT COUNT(*) FROM learning_sessions s WHERE s.questId = lq.id AND s.status = 'pending') as pendingCount
       FROM learning_quests lq
      WHERE lq.familyId = ?
      ORDER BY lq.isActive DESC, datetime(lq.createdAt) DESC`,
    request.user!.familyId
  );
  const quests = await Promise.all(rows.map(async (quest: any) => ({
    ...quest,
    steps: await db.all('SELECT * FROM learning_steps WHERE questId = ? ORDER BY stepOrder ASC', quest.id),
  })));
  res.json(quests);
});

app.post('/api/parent/learning-quests', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const { title, description, subject, questType, feeling, resistanceLevel, icon, estimatedMinutes, steps } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ message: '请输入学习关卡名称' });
  const cleanTitle = String(title).trim().replace(/\s+/g, ' ').slice(0, 80);
  const duplicateQuest = await findDuplicateLearningQuest(db, request.user!.familyId, cleanTitle);
  if (duplicateQuest) return res.status(409).json({ message: `「${duplicateQuest.title}」已经在学习关卡中，不能重复添加` });

  const normalizedSteps = normalizeLearningSteps(steps, Number(estimatedMinutes || 10));
  const totalCoins = normalizedSteps.reduce((sum, step) => sum + step.coins, 0);
  const totalXp = normalizedSteps.reduce((sum, step) => sum + step.xp, 0);
  const totalMinutes = Number(estimatedMinutes || normalizedSteps.reduce((sum, step) => sum + step.minutes, 0));
  const questId = randomUUID();

  await withTransaction(async () => {
    await db.run(
      `INSERT INTO learning_quests (
        id, familyId, title, description, subject, questType, feeling,
        resistanceLevel, icon, estimatedMinutes, totalCoins, totalXp, privilegePoints
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      questId,
      request.user!.familyId,
      cleanTitle,
      String(description || '').trim().slice(0, 300),
      subject || '综合',
      questType || 'written',
      feeling || 'normal',
      resistanceLevel || 'medium',
      icon || '📚',
      Math.max(1, Math.min(240, totalMinutes)),
      totalCoins,
      totalXp,
      totalMinutes >= 45 && resistanceLevel === 'hard' ? 1 : 0
    );

    for (const step of normalizedSteps) {
      await db.run(
        `INSERT INTO learning_steps (id, questId, title, stepOrder, minutes, coins, xp, prompt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        step.id, questId, step.title, step.stepOrder, step.minutes, step.coins, step.xp, step.prompt
      );
    }
  });

  res.json(await getLearningQuestWithSteps(db, questId, request.user!.familyId));
});

app.put('/api/parent/learning-quests/:id', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const existing = await db.get('SELECT * FROM learning_quests WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
  if (!existing) return res.status(404).json({ message: '学习关卡不存在' });
  const cleanTitle = String(req.body?.title || existing.title).trim().replace(/\s+/g, ' ').slice(0, 80);
  const duplicateQuest = await findDuplicateLearningQuest(db, request.user!.familyId, cleanTitle, req.params.id);
  if (duplicateQuest) return res.status(409).json({ message: `「${duplicateQuest.title}」已经在学习关卡中，不能重复添加` });

  const normalizedSteps = normalizeLearningSteps(req.body?.steps, Number(req.body?.estimatedMinutes || existing.estimatedMinutes || 10));
  const totalCoins = normalizedSteps.reduce((sum, step) => sum + step.coins, 0);
  const totalXp = normalizedSteps.reduce((sum, step) => sum + step.xp, 0);
  const totalMinutes = Number(req.body?.estimatedMinutes || normalizedSteps.reduce((sum, step) => sum + step.minutes, 0));
  const level = req.body?.resistanceLevel || existing.resistanceLevel || 'medium';

  await withTransaction(async () => {
    await db.run(
      `UPDATE learning_quests
          SET title = ?, description = ?, subject = ?, questType = ?, feeling = ?,
              resistanceLevel = ?, icon = ?, estimatedMinutes = ?, totalCoins = ?, totalXp = ?, privilegePoints = ?
        WHERE id = ? AND familyId = ?`,
      cleanTitle,
      String(req.body?.description || '').trim().slice(0, 300),
      req.body?.subject || existing.subject || '综合',
      req.body?.questType || existing.questType || 'written',
      req.body?.feeling || existing.feeling || 'normal',
      level,
      req.body?.icon || existing.icon || '📚',
      Math.max(1, Math.min(240, totalMinutes)),
      totalCoins,
      totalXp,
      totalMinutes >= 45 && level === 'hard' ? 1 : 0,
      req.params.id,
      request.user!.familyId
    );
    await db.run('DELETE FROM learning_steps WHERE questId = ?', req.params.id);
    for (const step of normalizedSteps) {
      await db.run(
        `INSERT INTO learning_steps (id, questId, title, stepOrder, minutes, coins, xp, prompt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        step.id, req.params.id, step.title, step.stepOrder, step.minutes, step.coins, step.xp, step.prompt
      );
    }
  });

  res.json(await getLearningQuestWithSteps(db, req.params.id, request.user!.familyId));
});

app.delete('/api/parent/learning-quests/:id', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const quest = await getDb().get('SELECT id FROM learning_quests WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
  if (!quest) return res.status(404).json({ message: '学习关卡不存在' });
  await getDb().run('UPDATE learning_quests SET isActive = 0 WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
  res.json({ message: '已停用' });
});

app.get('/api/parent/learning-sessions', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const status = req.query.status || 'pending';
  const rows = await getDb().all(
    `SELECT s.*, q.title, q.icon, q.subject, q.questType, q.totalCoins, q.totalXp, u.name as childName
       FROM learning_sessions s
       JOIN learning_quests q ON s.questId = q.id
       JOIN users u ON s.childId = u.id
      WHERE q.familyId = ? AND s.status = ?
      ORDER BY datetime(COALESCE(s.submittedAt, s.startedAt)) DESC
      LIMIT 80`,
    request.user!.familyId,
    status
  );
  res.json(rows);
});

app.post('/api/parent/learning-sessions/:id/review', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const { action, finalCoins, finalXp } = req.body || {};
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ message: '无效的审核操作' });

  const session = await db.get(
    `SELECT s.*, q.familyId, q.title as questTitle, q.estimatedMinutes, q.totalCoins, q.totalXp, q.privilegePoints
       FROM learning_sessions s
       JOIN learning_quests q ON s.questId = q.id
      WHERE s.id = ?`,
    req.params.id
  );
  if (!session) return res.status(404).json({ message: '学习提交不存在' });
  if (session.familyId !== request.user!.familyId) return res.status(403).json({ message: '无权操作' });
  if (session.status !== 'pending') return res.status(409).json({ message: '该学习提交已处理' });

  if (action === 'reject') {
    await db.run("UPDATE learning_sessions SET status = 'rejected', reviewedAt = ? WHERE id = ? AND status = 'pending'", new Date().toISOString(), req.params.id);
    return res.json({ message: '已打回' });
  }

  const coinsToAward = Math.max(0, Math.round(Number(finalCoins ?? session.totalCoins ?? session.earnedCoins ?? 0)));
  const xpToAward = Math.max(0, Math.round(Number(finalXp ?? session.totalXp ?? session.earnedXp ?? 0)));
  let privilegePointsAwarded = Math.max(0, Number(session.privilegePoints || 0));
  let gameTicketMinutesAwarded = 0;
  let gameTicketMinutesRequested = 0;
  let gameTicketMinutesCapped = 0;
  let gameTicketGrant: ScreenTimeGrantResult | null = null;

  await withTransaction(async () => {
    const updateResult = await db.run(
      "UPDATE learning_sessions SET status = 'approved', reviewedAt = ?, earnedCoins = ?, earnedXp = ? WHERE id = ? AND status = 'pending'",
      new Date().toISOString(), coinsToAward, xpToAward, req.params.id
    );
    if ((updateResult.changes || 0) !== 1) {
      const err = new Error('该学习提交已处理，请刷新后重试');
      err.name = 'ConflictError';
      throw err;
    }

    await db.run('UPDATE users SET coins = coins + ?, xp = xp + ? WHERE id = ?', coinsToAward, xpToAward, session.childId);
    if (xpToAward > 0) {
      const user = await db.get('SELECT rewardXpTotal FROM users WHERE id = ?', session.childId);
      const oldRewardXpTotal = user?.rewardXpTotal || 0;
      const newRewardXpTotal = oldRewardXpTotal + xpToAward;
      privilegePointsAwarded += Math.floor(newRewardXpTotal / 100) - Math.floor(oldRewardXpTotal / 100);
      await db.run('UPDATE users SET rewardXpTotal = ?, privilegePoints = privilegePoints + ? WHERE id = ?', newRewardXpTotal, privilegePointsAwarded, session.childId);
    } else if (privilegePointsAwarded > 0) {
      await db.run('UPDATE users SET privilegePoints = privilegePoints + ? WHERE id = ?', privilegePointsAwarded, session.childId);
    }

    const startTime = new Date(session.startedAt).getTime();
    const submitTime = new Date(session.submittedAt || new Date().toISOString()).getTime();
    const actualMinutes = Number.isFinite(startTime) && Number.isFinite(submitTime)
      ? Math.max(1, Math.ceil((submitTime - startTime) / 60000))
      : 0;
    gameTicketGrant = await grantStudySavedGameTickets(db, {
      familyId: request.user!.familyId,
      childId: session.childId,
      title: session.questTitle,
      expectedMinutes: session.estimatedMinutes,
      actualMinutes,
      learningSessionId: req.params.id,
    });
    gameTicketMinutesAwarded = gameTicketGrant.grantedMinutes;
    gameTicketMinutesRequested = gameTicketGrant.requestedMinutes;
    gameTicketMinutesCapped = gameTicketGrant.cappedMinutes;
  });

  const unlockedAchievements = await checkAchievements(session.childId, db);
  res.json({
    message: '已通过',
    coinsAwarded: coinsToAward,
    xpAwarded: xpToAward,
    privilegePointsAwarded,
    gameTicketMinutesAwarded,
    gameTicketMinutesRequested,
    gameTicketMinutesCapped,
    gameTicketGrant,
    unlockedAchievements
  });
});

app.get('/api/child/learning-quests', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const quests = await db.all(
    `SELECT q.*,
            (SELECT COUNT(*) FROM learning_steps ls WHERE ls.questId = q.id) as stepCount,
            s.id as sessionId,
            s.status as sessionStatus,
            s.currentStepIndex,
            s.stuckReason,
            s.submittedAt
       FROM learning_quests q
       LEFT JOIN learning_sessions s
         ON s.questId = q.id
        AND s.childId = ?
        AND date(s.startedAt, '+8 hours') = date('now', '+8 hours')
        AND s.status IN ('in_progress', 'pending', 'approved', 'rejected')
      WHERE q.familyId = ? AND q.isActive = 1
      ORDER BY CASE q.resistanceLevel WHEN 'hard' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, datetime(q.createdAt) DESC`,
    request.user!.id,
    request.user!.familyId
  );
  const withSteps = await Promise.all(quests.map(async (quest: any) => ({
    ...quest,
    steps: await db.all('SELECT * FROM learning_steps WHERE questId = ? ORDER BY stepOrder ASC', quest.id),
  })));
  res.json(withSteps);
});

app.post('/api/child/learning-quests/:id/start', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const quest = await db.get('SELECT * FROM learning_quests WHERE id = ? AND familyId = ? AND isActive = 1', req.params.id, request.user!.familyId);
  if (!quest) return res.status(404).json({ message: '学习关卡不存在' });

  const existing = await db.get(
    `SELECT * FROM learning_sessions
      WHERE questId = ? AND childId = ?
        AND date(startedAt, '+8 hours') = date('now', '+8 hours')
        AND status IN ('in_progress', 'pending', 'approved')`,
    req.params.id,
    request.user!.id
  );
  if (existing) return res.json(existing);

  const sessionId = randomUUID();
  await db.run(`INSERT INTO learning_sessions (id, questId, childId, status, currentStepIndex) VALUES (?, ?, ?, 'in_progress', 0)`, sessionId, req.params.id, request.user!.id);
  res.json(await db.get('SELECT * FROM learning_sessions WHERE id = ?', sessionId));
});

app.post('/api/child/learning-sessions/:id/progress', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const session = await db.get(
    `SELECT s.*, q.familyId
       FROM learning_sessions s
       JOIN learning_quests q ON s.questId = q.id
      WHERE s.id = ? AND s.childId = ?`,
    req.params.id,
    request.user!.id
  );
  if (!session) return res.status(404).json({ message: '学习记录不存在' });
  if (session.familyId !== request.user!.familyId) return res.status(403).json({ message: '无权操作' });
  if (session.status !== 'in_progress') return res.status(409).json({ message: '当前学习记录不能继续修改' });

  const nextIndex = Math.max(0, Math.min(99, Number(req.body?.currentStepIndex ?? session.currentStepIndex ?? 0)));
  const stuckReason = req.body?.stuckReason ? String(req.body.stuckReason).slice(0, 120) : session.stuckReason;
  await db.run('UPDATE learning_sessions SET currentStepIndex = ?, stuckReason = ? WHERE id = ?', nextIndex, stuckReason || null, req.params.id);
  res.json(await db.get('SELECT * FROM learning_sessions WHERE id = ?', req.params.id));
});

app.post('/api/child/learning-sessions/:id/submit', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const session = await db.get(
    `SELECT s.*, q.familyId, q.totalCoins, q.totalXp
       FROM learning_sessions s
       JOIN learning_quests q ON s.questId = q.id
      WHERE s.id = ? AND s.childId = ?`,
    req.params.id,
    request.user!.id
  );
  if (!session) return res.status(404).json({ message: '学习记录不存在' });
  if (session.familyId !== request.user!.familyId) return res.status(403).json({ message: '无权操作' });
  if (session.status !== 'in_progress' && session.status !== 'rejected') return res.status(409).json({ message: '当前学习记录不能提交' });

  await db.run(
    `UPDATE learning_sessions
        SET status = 'pending', submittedAt = ?, proof = ?, stuckReason = ?, earnedCoins = ?, earnedXp = ?
      WHERE id = ?`,
    new Date().toISOString(),
    String(req.body?.proof || '').slice(0, 1000),
    req.body?.stuckReason ? String(req.body.stuckReason).slice(0, 120) : session.stuckReason,
    session.totalCoins || 0,
    session.totalXp || 0,
    req.params.id
  );
  res.json({ message: '学习关卡已提交，等待家长确认' });
});

// ============================================================
// 情绪急救与游戏票 API
// ============================================================

app.get('/api/parent/emotion-checkins', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const { scene, intensity, childId, date, startDate, endDate, helped } = req.query;
  let query = `
    SELECT ec.*, u.name as childName
       FROM emotion_checkins ec
       JOIN users u ON ec.childId = u.id
      WHERE ec.familyId = ?`;
  const params: any[] = [request.user!.familyId];
  if (scene && scene !== 'all') {
    query += ' AND ec.scene = ?';
    params.push(scene);
  }
  if (intensity && intensity !== 'all') {
    query += ' AND ec.intensity = ?';
    params.push(intensity);
  }
  if (childId && childId !== 'all') {
    query += ' AND ec.childId = ?';
    params.push(childId);
  }
  if (date) {
    query += " AND date(ec.createdAt, '+8 hours') = ?";
    params.push(date);
  } else {
    if (startDate) {
      query += " AND date(ec.createdAt, '+8 hours') >= ?";
      params.push(startDate);
    }
    if (endDate) {
      query += " AND date(ec.createdAt, '+8 hours') <= ?";
      params.push(endDate);
    }
  }
  if (helped === 'true' || helped === 'false') {
    query += ' AND ec.helped = ?';
    params.push(helped === 'true' ? 1 : 0);
  }
  query += ' ORDER BY datetime(ec.createdAt) DESC LIMIT 100';
  const rows = await getDb().all(query, ...params);
  res.json(rows);
});

app.get('/api/parent/screen-time-rules', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  res.json(await getOrCreateScreenTimeRules(db, request.user!.familyId));
});

app.put('/api/parent/screen-time-rules', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const current = await getOrCreateScreenTimeRules(db, request.user!.familyId);
  const next = {
    isEnabled: req.body?.isEnabled === false || req.body?.isEnabled === 0 ? 0 : 1,
    dailyBaseMinutes: clampMinutes(req.body?.dailyBaseMinutes, current.dailyBaseMinutes, 0, 180),
    dailyMaxMinutes: clampMinutes(req.body?.dailyMaxMinutes, current.dailyMaxMinutes, 0, 240),
    ticketMinutes: clampMinutes(req.body?.ticketMinutes, current.ticketMinutes, 1, 60),
    cooldownMinutes: clampMinutes(req.body?.cooldownMinutes, current.cooldownMinutes, 0, 60),
    studySavedTimeEnabled: req.body?.studySavedTimeEnabled === false || req.body?.studySavedTimeEnabled === 0 ? 0 : 1,
    studySavedTimeRatio: Math.max(0, Math.min(2, Number(req.body?.studySavedTimeRatio ?? current.studySavedTimeRatio ?? 1) || 1)),
    weekdayAllowedStart: normalizeTimeText(req.body?.weekdayAllowedStart, current.weekdayAllowedStart),
    weekdayAllowedEnd: normalizeTimeText(req.body?.weekdayAllowedEnd, current.weekdayAllowedEnd),
    weekendAllowedStart: normalizeTimeText(req.body?.weekendAllowedStart, current.weekendAllowedStart),
    weekendAllowedEnd: normalizeTimeText(req.body?.weekendAllowedEnd, current.weekendAllowedEnd),
  };
  next.dailyMaxMinutes = Math.max(next.dailyBaseMinutes, next.dailyMaxMinutes);

  await db.run(
    `UPDATE screen_time_rules
        SET isEnabled = ?, dailyBaseMinutes = ?, dailyMaxMinutes = ?, ticketMinutes = ?,
            cooldownMinutes = ?, studySavedTimeEnabled = ?, studySavedTimeRatio = ?,
            weekdayAllowedStart = ?, weekdayAllowedEnd = ?,
            weekendAllowedStart = ?, weekendAllowedEnd = ?, updatedAt = ?
      WHERE familyId = ?`,
    next.isEnabled,
    next.dailyBaseMinutes,
    next.dailyMaxMinutes,
    next.ticketMinutes,
    next.cooldownMinutes,
    next.studySavedTimeEnabled,
    next.studySavedTimeRatio,
    next.weekdayAllowedStart,
    next.weekdayAllowedEnd,
    next.weekendAllowedStart,
    next.weekendAllowedEnd,
    new Date().toISOString(),
    request.user!.familyId
  );
  res.json(await getOrCreateScreenTimeRules(db, request.user!.familyId));
});

app.get('/api/parent/screen-time/overview', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const children = await db.all(
    "SELECT id, name, avatar FROM users WHERE familyId = ? AND role = 'child' ORDER BY createdAt ASC",
    request.user!.familyId
  );
  const overview = await Promise.all(children.map(async (child: any) => ({
    ...child,
    ...(await getChildScreenTimeSummary(db, request.user!.familyId, child.id)),
  })));
  res.json(overview);
});

app.get('/api/parent/screen-time-records', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const familyId = request.user!.familyId;
  const {
    childId,
    type = 'all',
    date,
    startDate,
    endDate,
    dateFrom,
    dateTo,
    timeFilter = 'week',
    limit = 80,
  } = req.query;

  const addDateFilter = (query: string, params: any[], column: string) => {
    const fromDate = startDate || dateFrom;
    const toDate = endDate || dateTo;
    if (date) {
      params.push(date);
      return `${query} AND date(${column}, '+8 hours') = ?`;
    }
    if (fromDate || toDate) {
      if (fromDate) {
        query += ` AND date(${column}, '+8 hours') >= ?`;
        params.push(fromDate);
      }
      if (toDate) {
        query += ` AND date(${column}, '+8 hours') <= ?`;
        params.push(toDate);
      }
      return query;
    }
    if (timeFilter === 'today') return `${query} AND date(${column}, '+8 hours') = date('now', '+8 hours')`;
    if (timeFilter === 'month') return `${query} AND datetime(${column}, '+8 hours') >= datetime('now', '+8 hours', '-30 days')`;
    if (timeFilter === 'all') return query;
    return `${query} AND datetime(${column}, '+8 hours') >= datetime('now', '+8 hours', '-7 days')`;
  };

  const normalizedType = String(type || 'all');
  const childFilter = decodeQueryText(childId);
  const includeLedger = ['all', 'adjustment', 'grant', 'deduct', 'study_saved_time', 'morning_startup'].includes(normalizedType);
  const includeSessions = ['all', 'session', 'running', 'completed', 'cancelled'].includes(normalizedType);
  const maxRows = Math.max(1, Math.min(200, parseInt(String(limit), 10) || 80));
  const records: any[] = [];

  if (includeLedger) {
    let query = `
      SELECT l.id,
             'adjustment' as type,
             CASE WHEN l.deltaMinutes >= 0 THEN 'grant' ELSE 'deduct' END as subtype,
             l.childId,
             u.name as childName,
             l.deltaMinutes as minutes,
             l.reason,
             l.source,
             l.createdAt,
             NULL as endedAt,
             NULL as status
        FROM screen_time_ledger l
        JOIN users u ON l.childId = u.id
       WHERE l.familyId = ?`;
    const params: any[] = [familyId];
    if (childFilter && childFilter !== 'all') {
      query += ' AND l.childId = ?';
      params.push(childFilter);
    }
    if (normalizedType === 'grant') query += ' AND l.deltaMinutes > 0';
    if (normalizedType === 'deduct') query += ' AND l.deltaMinutes < 0';
    if (normalizedType === 'study_saved_time') query += " AND l.source = 'study_saved_time'";
    if (normalizedType === 'morning_startup') query += " AND l.source IN ('morning_startup', 'morning_startup_streak_3')";
    query = addDateFilter(query, params, 'l.createdAt');
    const rows = await db.all(`${query} ORDER BY datetime(l.createdAt) DESC LIMIT ?`, ...params, maxRows);
    records.push(...rows);
  }

  if (includeSessions) {
    let query = `
      SELECT s.id,
             'session' as type,
             s.status as subtype,
             s.childId,
             u.name as childName,
             s.plannedMinutes as minutes,
             NULL as reason,
             'child' as source,
             s.startedAt as createdAt,
             s.endedAt,
             s.status
        FROM screen_time_sessions s
        JOIN users u ON s.childId = u.id
       WHERE s.familyId = ?`;
    const params: any[] = [familyId];
    if (childFilter && childFilter !== 'all') {
      query += ' AND s.childId = ?';
      params.push(childFilter);
    }
    if (['running', 'completed', 'cancelled'].includes(normalizedType)) {
      query += ' AND s.status = ?';
      params.push(normalizedType);
    }
    query = addDateFilter(query, params, 's.startedAt');
    const rows = await db.all(`${query} ORDER BY datetime(s.startedAt) DESC LIMIT ?`, ...params, maxRows);
    records.push(...rows);
  }

  records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(records.slice(0, maxRows));
});

app.post('/api/parent/screen-time/grant', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const childId = String(req.body?.childId || '');
  const minutes = clampMinutes(req.body?.minutes, 0, -240, 240);
  if (!childId) return res.status(400).json({ message: '请选择孩子' });
  if (minutes === 0) return res.status(400).json({ message: '分钟数不能为 0' });

  const child = await db.get(
    "SELECT id FROM users WHERE id = ? AND familyId = ? AND role = 'child'",
    childId,
    request.user!.familyId
  );
  if (!child) return res.status(404).json({ message: '孩子不存在' });

  await db.run(
    `INSERT INTO screen_time_ledger (id, familyId, childId, deltaMinutes, reason, source)
     VALUES (?, ?, ?, ?, ?, 'parent')`,
    randomUUID(),
    request.user!.familyId,
    childId,
    minutes,
    String(req.body?.reason || '家长调整').slice(0, 120)
  );
  res.json(await getChildScreenTimeSummary(db, request.user!.familyId, childId));
});

app.post('/api/child/emotion-checkins', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const allowedScenes = ['itch', 'angry', 'study', 'wake', 'game', 'tired', 'other'];
  const allowedIntensities = ['low', 'medium', 'high'];
  const scene = allowedScenes.includes(req.body?.scene) ? req.body.scene : 'other';
  const intensity = allowedIntensities.includes(req.body?.intensity) ? req.body.intensity : 'medium';
  const action = String(req.body?.action || '').trim().slice(0, 120);
  const note = String(req.body?.note || '').trim().slice(0, 240);
  const helped = req.body?.helped ? 1 : 0;
  const dailyLimit = 3;
  const cooldownMinutes = 10;
  const dailyRewarded = await db.get(
    `SELECT COUNT(*) as count
       FROM emotion_checkins
      WHERE familyId = ? AND childId = ? AND xpAwarded > 0
        AND date(createdAt, '+8 hours') = date('now', '+8 hours')`,
    request.user!.familyId,
    request.user!.id
  );
  const lastRewarded = await db.get(
    `SELECT createdAt, (julianday('now') - julianday(createdAt)) * 1440 as minutesAgo
       FROM emotion_checkins
      WHERE familyId = ? AND childId = ? AND xpAwarded > 0
      ORDER BY datetime(createdAt) DESC
      LIMIT 1`,
    request.user!.familyId,
    request.user!.id
  );

  let antiFarmReason: 'missing-action' | 'daily-limit' | 'cooldown' | null = null;
  let xpAwarded = 0;
  if (!action) {
    antiFarmReason = 'missing-action';
  } else if (Number(dailyRewarded?.count || 0) >= dailyLimit) {
    antiFarmReason = 'daily-limit';
  } else if (lastRewarded && Number(lastRewarded.minutesAgo || 0) < cooldownMinutes) {
    antiFarmReason = 'cooldown';
  } else {
    xpAwarded = helped ? 3 : 1;
  }

  await withTransaction(async () => {
    await db.run(
      `INSERT INTO emotion_checkins (id, familyId, childId, scene, intensity, action, note, helped, xpAwarded)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(),
      request.user!.familyId,
      request.user!.id,
      scene,
      intensity,
      action,
      note,
      helped,
      xpAwarded
    );
    if (xpAwarded > 0) {
      await db.run('UPDATE users SET xp = xp + ? WHERE id = ?', xpAwarded, request.user!.id);
    }
  });

  const minutesUntilNext = antiFarmReason === 'cooldown'
    ? Math.max(1, Math.ceil(cooldownMinutes - Number(lastRewarded?.minutesAgo || 0)))
    : 0;
  const message = xpAwarded > 0
    ? `已记录一次冷静练习，经验 +${xpAwarded}`
    : antiFarmReason === 'daily-limit'
      ? '已记录，本次不重复加经验：今天的冷静经验已达到上限'
      : antiFarmReason === 'cooldown'
        ? `已记录，本次不重复加经验：还需要等待约 ${minutesUntilNext} 分钟`
        : '已记录，本次不加经验：请先选择一个具体动作';
  res.json({
    message,
    xpAwarded,
    antiFarmReason,
    dailyRewarded: Number(dailyRewarded?.count || 0),
    dailyLimit,
    cooldownMinutes,
    minutesUntilNext,
  });
});

app.get('/api/child/screen-time', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  res.json(await getChildScreenTimeSummary(getDb(), request.user!.familyId, request.user!.id));
});

app.post('/api/child/screen-time/start', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const summary = await getChildScreenTimeSummary(db, request.user!.familyId, request.user!.id);
  if (!summary.rules.isEnabled) return res.status(400).json({ message: '今天的游戏票暂未开启' });
  if (!summary.window.isAllowed) {
    return res.status(400).json({ message: `现在不在可用时间内（${summary.window.start}-${summary.window.end}）` });
  }
  if (summary.activeSession) return res.json({ ...summary, activeSession: summary.activeSession });
  if (summary.cooldown?.isCoolingDown) {
    return res.status(400).json({
      message: `游戏票冷却中，还需要等待约 ${summary.cooldown.minutesUntilNext} 分钟`,
      cooldown: summary.cooldown,
    });
  }

  const minutes = clampMinutes(req.body?.minutes, summary.rules.ticketMinutes || 10, 1, 60);
  if (minutes > summary.balance) return res.status(400).json({ message: '游戏票余额不足' });

  const sessionId = randomUUID();
  await db.run(
    `INSERT INTO screen_time_sessions (id, familyId, childId, plannedMinutes, status)
     VALUES (?, ?, ?, ?, 'running')`,
    sessionId,
    request.user!.familyId,
    request.user!.id,
    minutes
  );
  res.json(await getChildScreenTimeSummary(db, request.user!.familyId, request.user!.id));
});

app.post('/api/child/screen-time/sessions/:id/finish', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const status = req.body?.status === 'cancelled' ? 'cancelled' : 'completed';
  const session = await db.get(
    `SELECT * FROM screen_time_sessions
      WHERE id = ? AND familyId = ? AND childId = ? AND status = 'running'`,
    req.params.id,
    request.user!.familyId,
    request.user!.id
  );
  if (!session) return res.status(404).json({ message: '没有正在进行的游戏票' });
  await db.run(
    `UPDATE screen_time_sessions SET status = ?, endedAt = ? WHERE id = ?`,
    status,
    new Date().toISOString(),
    req.params.id
  );
  res.json(await getChildScreenTimeSummary(db, request.user!.familyId, request.user!.id));
});

// ============================================================
// 早餐小厨房 API
// ============================================================

app.get('/api/parent/breakfast-items', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  res.json(await getBreakfastItems(getDb(), request.user!.familyId));
});

app.post('/api/parent/breakfast-items', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ message: '请输入早餐名称' });

  await db.run(
    `INSERT INTO breakfast_items (id, familyId, title, description, icon, category, costCoins, isDefault)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    randomUUID(),
    request.user!.familyId,
    title.slice(0, 60),
    String(req.body?.description || '').trim().slice(0, 180),
    String(req.body?.icon || '🍽️').slice(0, 8),
    String(req.body?.category || '主食').slice(0, 20),
    Math.max(0, Math.min(999, Math.round(Number(req.body?.costCoins || 0))))
  );
  res.json(await getBreakfastItems(db, request.user!.familyId));
});

app.put('/api/parent/breakfast-items/:id', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const item = await db.get('SELECT * FROM breakfast_items WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
  if (!item) return res.status(404).json({ message: '早餐项不存在' });
  const title = String(req.body?.title || item.title).trim();
  if (!title) return res.status(400).json({ message: '请输入早餐名称' });

  await db.run(
    `UPDATE breakfast_items
        SET title = ?, description = ?, icon = ?, category = ?, costCoins = ?, isActive = ?
      WHERE id = ? AND familyId = ?`,
    title.slice(0, 60),
    String(req.body?.description ?? item.description ?? '').trim().slice(0, 180),
    String(req.body?.icon || item.icon || '🍽️').slice(0, 8),
    String(req.body?.category || item.category || '主食').slice(0, 20),
    Math.max(0, Math.min(999, Math.round(Number(req.body?.costCoins ?? item.costCoins ?? 0)))),
    req.body?.isActive === false || req.body?.isActive === 0 ? 0 : 1,
    req.params.id,
    request.user!.familyId
  );
  res.json(await getBreakfastItems(db, request.user!.familyId));
});

app.delete('/api/parent/breakfast-items/:id', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const itemId = String(req.params.id || '');
  const item = await db.get('SELECT id FROM breakfast_items WHERE id = ? AND familyId = ?', itemId, request.user!.familyId);
  if (!item) return res.status(404).json({ message: '早餐项不存在' });

  const plans = await db.all(
    'SELECT id, optionItemIds FROM breakfast_plans WHERE familyId = ? AND optionItemIds LIKE ?',
    request.user!.familyId,
    `%${itemId}%`
  );
  for (const plan of plans) {
    const nextOptionIds = parseBreakfastOptionIds(plan.optionItemIds).filter(id => id !== itemId);
    await db.run(
      'UPDATE breakfast_plans SET optionItemIds = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND familyId = ?',
      JSON.stringify(nextOptionIds),
      plan.id,
      request.user!.familyId
    );
  }

  await db.run(
    'UPDATE breakfast_plans SET defaultItemId = NULL, updatedAt = CURRENT_TIMESTAMP WHERE defaultItemId = ? AND familyId = ?',
    itemId,
    request.user!.familyId
  );
  await db.run('UPDATE breakfast_orders SET itemId = NULL WHERE itemId = ? AND familyId = ?', itemId, request.user!.familyId);
  await db.run('DELETE FROM breakfast_items WHERE id = ? AND familyId = ?', itemId, request.user!.familyId);
  res.json({ message: '已删除早餐项' });
});

app.get('/api/parent/breakfast-plans', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const startDate = normalizeBreakfastDate(req.query.startDate || req.query.date);
  const endDate = normalizeBreakfastDate(req.query.endDate || startDate);
  const childId = req.query.childId ? String(req.query.childId) : '';
  await seedBreakfastItemsIfEmpty(db, request.user!.familyId);

  const params: any[] = [request.user!.familyId, startDate, endDate];
  let childClause = '';
  if (childId) {
    childClause = 'AND childId = ?';
    params.push(childId);
  }

  const plans = await db.all(
    `SELECT * FROM breakfast_plans
      WHERE familyId = ? AND planDate BETWEEN ? AND ? ${childClause}
      ORDER BY planDate ASC, datetime(updatedAt) DESC`,
    ...params
  );
  const hydrated = await Promise.all(plans.map((plan: any) => hydrateBreakfastPlan(db, request.user!.familyId, plan)));
  res.json({ startDate, endDate, plans: hydrated });
});

app.post('/api/parent/breakfast-plans', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const planDate = normalizeBreakfastDate(req.body?.planDate || req.body?.date);
  const childId = String(req.body?.childId || '').trim();
  const defaultItemId = String(req.body?.defaultItemId || '').trim();
  const optionItemIds = Array.from(new Set(parseBreakfastOptionIds(req.body?.optionItemIds).filter(id => id !== defaultItemId)));
  const note = String(req.body?.note || '').trim().slice(0, 240);

  if (!childId) return res.status(400).json({ message: '请选择孩子' });
  if (!defaultItemId && optionItemIds.length === 0) return res.status(400).json({ message: '请至少提供一个早餐选项' });

  const child = await db.get("SELECT id FROM users WHERE id = ? AND familyId = ? AND role = 'child'", childId, request.user!.familyId);
  if (!child) return res.status(404).json({ message: '孩子不存在' });

  const itemIds = [defaultItemId, ...optionItemIds].filter(Boolean);
  const validItems = await db.all(
    `SELECT id FROM breakfast_items WHERE familyId = ? AND COALESCE(isActive, 1) != 0 AND id IN (${itemIds.map(() => '?').join(',')})`,
    request.user!.familyId,
    ...itemIds
  );
  if (validItems.length !== itemIds.length) return res.status(400).json({ message: '包含不可用早餐选项' });

  const existing = await db.get(
    'SELECT id FROM breakfast_plans WHERE familyId = ? AND childId = ? AND planDate = ?',
    request.user!.familyId,
    childId,
    planDate
  );
  const id = existing?.id || randomUUID();

  if (existing) {
    await db.run(
      `UPDATE breakfast_plans
          SET defaultItemId = ?, optionItemIds = ?, note = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ? AND familyId = ?`,
      defaultItemId,
      JSON.stringify(optionItemIds),
      note,
      id,
      request.user!.familyId
    );
  } else {
    await db.run(
      `INSERT INTO breakfast_plans (id, familyId, childId, planDate, defaultItemId, optionItemIds, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      request.user!.familyId,
      childId,
      planDate,
      defaultItemId,
      JSON.stringify(optionItemIds),
      note
    );
  }

  const plan = await db.get('SELECT * FROM breakfast_plans WHERE id = ? AND familyId = ?', id, request.user!.familyId);
  res.json(await hydrateBreakfastPlan(db, request.user!.familyId, plan));
});

app.delete('/api/parent/breakfast-plans/:id', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  await getDb().run('DELETE FROM breakfast_plans WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
  res.json({ message: '已删除早餐计划' });
});

app.get('/api/parent/morning-overview', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const date = String(req.query.date || getLocalDateString()).slice(0, 10);
  await seedBreakfastItemsIfEmpty(db, request.user!.familyId);
  const children = await db.all("SELECT id, name, avatar FROM users WHERE familyId = ? AND role = 'child' ORDER BY createdAt ASC", request.user!.familyId);
  const rows = await Promise.all(children.map(async (child: any) => {
    const order = await db.get(
      `SELECT * FROM breakfast_orders
        WHERE familyId = ? AND childId = ? AND orderDate = ? AND status != 'cancelled'
        ORDER BY datetime(createdAt) DESC LIMIT 1`,
      request.user!.familyId,
      child.id,
      date
    );
    return { ...child, plan: null, order: hydrateBreakfastOrder(order) };
  }));
  res.json({ date, rows });
});

app.post('/api/parent/breakfast-orders/:id/status', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const status = req.body?.status === 'cancelled' ? 'cancelled' : 'served';
  const order = await db.get('SELECT * FROM breakfast_orders WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
  if (!order) return res.status(404).json({ message: '早餐订单不存在' });
  if (order.status === 'served') return res.status(409).json({ message: '早餐已完成，不能再修改' });
  await withTransaction(async () => {
    const refund = status === 'cancelled' ? Math.max(0, Number(order.costCoins || 0)) : 0;
    if (refund > 0) await db.run('UPDATE users SET coins = coins + ? WHERE id = ?', refund, order.childId);
    await db.run(
      'UPDATE breakfast_orders SET status = ?, servedAt = ?, refundCoins = refundCoins + ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND familyId = ?',
      status,
      status === 'served' ? new Date().toISOString() : null,
      refund,
      req.params.id,
      request.user!.familyId
    );
  });
  res.json({ message: '已更新' });
});

app.get('/api/child/morning', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const today = normalizeBreakfastDate(req.query.date);
  const allItems = await getBreakfastItems(db, request.user!.familyId, true);
  const order = await db.get(
    `SELECT * FROM breakfast_orders
      WHERE familyId = ? AND childId = ? AND orderDate = ? AND status != 'cancelled'
      ORDER BY datetime(createdAt) DESC LIMIT 1`,
    request.user!.familyId,
    request.user!.id,
    today
  );
  res.json({
    date: today,
    plan: null,
    plannedItems: [],
    allItems,
    items: allItems,
    order: hydrateBreakfastOrder(order),
  });
});

app.post('/api/child/breakfast-orders', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const today = normalizeBreakfastDate(req.body?.date);
  const existing = await db.get(
    `SELECT * FROM breakfast_orders
      WHERE familyId = ? AND childId = ? AND orderDate = ? AND status != 'cancelled'
      ORDER BY datetime(createdAt) DESC LIMIT 1`,
    request.user!.familyId,
    request.user!.id,
    today
  );
  if (existing?.status === 'served') return res.status(409).json({ message: '早餐已经完成，今天不能再修改' });

  const requestedIds = req.body?.itemIds !== undefined
    ? uniqueBreakfastIds(req.body.itemIds)
    : uniqueBreakfastIds([req.body?.itemId]);
  if (requestedIds.length === 0) return res.status(400).json({ message: '请至少选择一个早餐内容' });

  const selectedItems = await db.all(
    `SELECT * FROM breakfast_items
      WHERE familyId = ? AND COALESCE(isActive, 1) != 0 AND id IN (${requestedIds.map(() => '?').join(',')})`,
    request.user!.familyId,
    ...requestedIds
  );
  if (selectedItems.length !== requestedIds.length) return res.status(404).json({ message: '包含不存在或已停用的早餐内容' });
  const byId = new Map(selectedItems.map((item: any) => [item.id, item]));
  const items = requestedIds.map(id => byId.get(id)).filter(Boolean);
  const summary = summarizeBreakfastItems(items);
  const itemIdsJson = JSON.stringify(requestedIds);
  const itemsSnapshot = JSON.stringify(items.map((item: any) => ({
    id: item.id,
    title: item.title,
    icon: item.icon,
    category: item.category,
    costCoins: Math.max(0, Number(item.costCoins || 0)),
  })));

  const child = await db.get('SELECT coins FROM users WHERE id = ?', request.user!.id);
  const cost = summary.costCoins;
  const oldCost = Math.max(0, Number(existing?.costCoins || 0));
  const costDelta = cost - oldCost;
  if (costDelta > 0 && Number(child?.coins || 0) < costDelta) return res.status(400).json({ message: '金币不够，先减少升级项或完成任务再来调整吧' });

  const existingIds = uniqueBreakfastIds(existing?.itemIds || (existing?.itemId ? [existing.itemId] : []));
  if (existing && JSON.stringify(existingIds) === JSON.stringify(requestedIds)) {
    return res.json({ message: '今天已经保存这个早餐组合', order: hydrateBreakfastOrder(existing), costDelta: 0 });
  }

  if (existing) {
    await withTransaction(async () => {
      if (costDelta > 0) await db.run('UPDATE users SET coins = coins - ? WHERE id = ?', costDelta, request.user!.id);
      if (costDelta < 0) await db.run('UPDATE users SET coins = coins + ? WHERE id = ?', Math.abs(costDelta), request.user!.id);
      await db.run(
        `UPDATE breakfast_orders
            SET itemId = ?, itemIds = ?, itemsSnapshot = ?, planId = ?, title = ?, icon = ?, costCoins = ?,
                selectedBy = 'child', refundCoins = refundCoins + ?, changeCount = changeCount + 1,
                updatedAt = CURRENT_TIMESTAMP
          WHERE id = ? AND familyId = ?`,
        requestedIds[0],
        itemIdsJson,
        itemsSnapshot,
        null,
        summary.title,
        summary.icon,
        cost,
        costDelta < 0 ? Math.abs(costDelta) : 0,
        existing.id,
        request.user!.familyId
      );
    });
    const order = await db.get('SELECT * FROM breakfast_orders WHERE id = ?', existing.id);
    return res.json({
      message: costDelta > 0 ? `早餐组合已保存，补扣 ${costDelta} 金币` : costDelta < 0 ? `早餐组合已保存，退回 ${Math.abs(costDelta)} 金币` : '早餐组合已保存',
      order: hydrateBreakfastOrder(order),
      costDelta,
    });
  }

  const orderId = randomUUID();
  await withTransaction(async () => {
    if (cost > 0) await db.run('UPDATE users SET coins = coins - ? WHERE id = ?', cost, request.user!.id);
    await db.run(
      `INSERT INTO breakfast_orders (id, familyId, childId, itemId, itemIds, itemsSnapshot, planId, title, icon, costCoins, orderDate, selectedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'child')`,
      orderId,
      request.user!.familyId,
      request.user!.id,
      requestedIds[0],
      itemIdsJson,
      itemsSnapshot,
      null,
      summary.title,
      summary.icon,
      cost,
      today
    );
  });
  const order = await db.get('SELECT * FROM breakfast_orders WHERE id = ?', orderId);
  res.json({
    message: cost > 0 ? `早餐组合已保存，消耗 ${cost} 金币` : '早餐组合已保存',
    order: hydrateBreakfastOrder(order),
    costDelta: cost,
  });
});

// ============================================================
// 规则助手 v2 与家长洞察 API
// ============================================================

app.get('/api/parent/rules-assistant-v2', protect, async (req: any, res) => {
  res.json({
    categories: Object.entries(REWARD_RULE_CATEGORIES).map(([name, rule]) => ({
      name,
      ...rule,
    })),
    options: {
      difficulty: [
        { value: 'easy', label: '简单', factor: 0.8 },
        { value: 'normal', label: '普通', factor: 1 },
        { value: 'hard', label: '困难', factor: 1.25 },
        { value: 'challenge', label: '挑战', factor: 1.45 },
      ],
      resistance: [
        { value: 'low', label: '低抗拒', factor: 0.9 },
        { value: 'medium', label: '普通', factor: 1 },
        { value: 'high', label: '高抗拒', factor: 1.25 },
        { value: 'crisis', label: '情绪阻力高', factor: 1.45 },
      ],
      independence: [
        { value: 'assisted', label: '需要陪伴', factor: 0.9 },
        { value: 'reminded', label: '提醒后做', factor: 1 },
        { value: 'independent', label: '独立完成', factor: 1.15 },
        { value: 'proactive', label: '主动完成', factor: 1.3 },
      ],
      quality: [
        { value: 'try', label: '愿意尝试', factor: 0.9 },
        { value: 'complete', label: '完成要求', factor: 1 },
        { value: 'good', label: '认真完成', factor: 1.15 },
        { value: 'excellent', label: '超预期', factor: 1.3 },
      ],
    },
    note: '分类规则助手只给推荐值，家长仍可根据家庭情况调整。早餐基础项不建议收费，金币只用于升级选择权。',
  });
});

app.post('/api/parent/rules-assistant-v2/suggest', protect, async (req: any, res) => {
  res.json(calculateRuleSuggestion(req.body || {}));
});

app.get('/api/parent/growth-insights', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const familyId = request.user!.familyId;
  const days = Math.max(7, Math.min(60, Number(req.query.days || 14)));
  const children = await db.all("SELECT id, name, avatar, coins, xp FROM users WHERE familyId = ? AND role = 'child' ORDER BY createdAt ASC", familyId);

  if (children.length === 0) {
    return res.json({
      days,
      children: [],
      recommendations: ['先到家庭管理添加孩子，再开始观察趋势。'],
      learning: { statusStats: [], stuckReasons: [], frictionQuests: [] },
      emotions: { sceneStats: [], actionStats: [] },
      breakfast: { stats: [] },
      screenTime: { childStats: [] },
      tasks: { summary: {}, categoryStats: [], childStats: [] },
      rewards: { chest: {}, achievements: {}, privileges: {}, savings: {} },
      punishments: { summary: {}, reasons: [] },
      overview: {
        purpose: '总览主要看四件事：孩子有没有启动、规则是否过重、即时反馈是否足够、奖励经济是否健康。',
        summaryCards: [],
      },
      economy: { earnedCoins: 0, spentCoins: 0, breakfastSpent: 0, netCoins: 0 },
    });
  }

  const learningStatus = await db.all(
    `SELECT s.status, COUNT(*) as count
       FROM learning_sessions s
       JOIN learning_quests q ON s.questId = q.id
      WHERE q.familyId = ? AND date(s.createdAt, '+8 hours') >= date('now', '+8 hours', ?)
      GROUP BY s.status`,
    familyId,
    `-${days} days`
  );
  const stuckReasons = await db.all(
    `SELECT s.stuckReason, COUNT(*) as count
       FROM learning_sessions s
       JOIN learning_quests q ON s.questId = q.id
      WHERE q.familyId = ? AND s.stuckReason IS NOT NULL AND TRIM(s.stuckReason) != ''
        AND date(s.createdAt, '+8 hours') >= date('now', '+8 hours', ?)
      GROUP BY s.stuckReason
      ORDER BY count DESC
      LIMIT 8`,
    familyId,
    `-${days} days`
  );
  const frictionQuests = await db.all(
    `SELECT q.id, q.title, q.subject, q.icon, q.resistanceLevel,
            COUNT(s.id) as attempts,
            SUM(CASE WHEN s.status = 'rejected' THEN 1 ELSE 0 END) as rejectedCount,
            SUM(CASE WHEN s.stuckReason IS NOT NULL AND TRIM(s.stuckReason) != '' THEN 1 ELSE 0 END) as stuckCount
       FROM learning_quests q
       LEFT JOIN learning_sessions s ON s.questId = q.id AND date(s.createdAt, '+8 hours') >= date('now', '+8 hours', ?)
      WHERE q.familyId = ?
      GROUP BY q.id
      HAVING attempts > 0
      ORDER BY stuckCount DESC, rejectedCount DESC, attempts DESC
      LIMIT 6`,
    `-${days} days`,
    familyId
  );

  const emotionScenes = await db.all(
    `SELECT scene, intensity, COUNT(*) as count,
            SUM(CASE WHEN helped = 1 THEN 1 ELSE 0 END) as helpedCount
       FROM emotion_checkins
      WHERE familyId = ? AND date(createdAt, '+8 hours') >= date('now', '+8 hours', ?)
      GROUP BY scene, intensity
      ORDER BY count DESC`,
    familyId,
    `-${days} days`
  );
  const actionStats = await db.all(
    `SELECT action, COUNT(*) as count,
            SUM(CASE WHEN helped = 1 THEN 1 ELSE 0 END) as helpedCount
       FROM emotion_checkins
      WHERE familyId = ? AND action IS NOT NULL AND TRIM(action) != ''
        AND date(createdAt, '+8 hours') >= date('now', '+8 hours', ?)
      GROUP BY action
      ORDER BY helpedCount DESC, count DESC
      LIMIT 8`,
    familyId,
    `-${days} days`
  );

  const breakfastStats = await db.all(
    `SELECT title, icon, COUNT(*) as count, COALESCE(SUM(costCoins), 0) as spentCoins
       FROM breakfast_orders
      WHERE familyId = ? AND status != 'cancelled' AND date(createdAt, '+8 hours') >= date('now', '+8 hours', ?)
      GROUP BY title, icon
      ORDER BY count DESC
      LIMIT 8`,
    familyId,
    `-${days} days`
  );

  const screenStats = await db.all(
    `SELECT u.id as childId, u.name as childName,
            COUNT(s.id) as sessionCount,
            COALESCE(SUM(CASE WHEN s.status IN ('running', 'completed', 'cancelled') THEN s.plannedMinutes ELSE 0 END), 0) as usedMinutes
       FROM users u
       LEFT JOIN screen_time_sessions s
         ON s.childId = u.id
        AND s.familyId = ?
        AND date(s.startedAt, '+8 hours') >= date('now', '+8 hours', ?)
      WHERE u.familyId = ? AND u.role = 'child'
      GROUP BY u.id
      ORDER BY usedMinutes DESC`,
    familyId,
    `-${days} days`,
    familyId
  );

  const earned = await db.get(
    `SELECT COALESCE(SUM(te.earnedCoins), 0) as total
       FROM task_entries te
       JOIN tasks t ON te.taskId = t.id
      WHERE t.familyId = ? AND te.status = 'approved' AND date(te.reviewedAt, '+8 hours') >= date('now', '+8 hours', ?)`,
    familyId,
    `-${days} days`
  );
  const spentInventory = await db.get(
    `SELECT COALESCE(SUM(ui.cost), 0) as total
       FROM user_inventory ui
       JOIN users u ON ui.childId = u.id
      WHERE u.familyId = ? AND ui.costType = 'coins' AND ui.status != 'cancelled'
        AND date(ui.acquiredAt, '+8 hours') >= date('now', '+8 hours', ?)`,
    familyId,
    `-${days} days`
  );
  const spentBreakfast = await db.get(
    `SELECT COALESCE(SUM(costCoins), 0) as total
       FROM breakfast_orders
      WHERE familyId = ? AND status != 'cancelled' AND date(createdAt, '+8 hours') >= date('now', '+8 hours', ?)`,
    familyId,
    `-${days} days`
  );
  const taskSummary = await db.get(
    `SELECT COUNT(te.id) as submittedCount,
            SUM(CASE WHEN te.status = 'approved' THEN 1 ELSE 0 END) as approvedCount,
            SUM(CASE WHEN te.status = 'rejected' THEN 1 ELSE 0 END) as rejectedCount,
            SUM(CASE WHEN te.status = 'pending' THEN 1 ELSE 0 END) as pendingCount,
            SUM(CASE WHEN COALESCE(te.isOverdue, 0) = 1 THEN 1 ELSE 0 END) as overdueCount,
            COUNT(DISTINCT date(te.submittedAt, '+8 hours')) as activeDays,
            COALESCE(AVG(CASE WHEN te.actualDurationMinutes IS NOT NULL THEN te.actualDurationMinutes END), 0) as avgActualMinutes,
            COALESCE(SUM(CASE WHEN te.status = 'approved' THEN te.earnedCoins ELSE 0 END), 0) as earnedCoins,
            COALESCE(SUM(CASE WHEN te.status = 'approved' THEN te.earnedXp ELSE 0 END), 0) as earnedXp
       FROM task_entries te
       JOIN tasks t ON te.taskId = t.id
      WHERE t.familyId = ? AND date(te.submittedAt, '+8 hours') >= date('now', '+8 hours', ?)`,
    familyId,
    `-${days} days`
  );
  const taskCategoryStats = await db.all(
    `SELECT t.category,
            COUNT(te.id) as submittedCount,
            SUM(CASE WHEN te.status = 'approved' THEN 1 ELSE 0 END) as approvedCount,
            SUM(CASE WHEN te.status = 'rejected' THEN 1 ELSE 0 END) as rejectedCount,
            COALESCE(SUM(CASE WHEN te.status = 'approved' THEN te.earnedCoins ELSE 0 END), 0) as earnedCoins
       FROM task_entries te
       JOIN tasks t ON te.taskId = t.id
      WHERE t.familyId = ? AND date(te.submittedAt, '+8 hours') >= date('now', '+8 hours', ?)
      GROUP BY t.category
      ORDER BY submittedCount DESC`,
    familyId,
    `-${days} days`
  );
  const taskChildStats = await db.all(
    `SELECT u.id as childId, u.name as childName,
            COUNT(te.id) as submittedCount,
            SUM(CASE WHEN te.status = 'approved' THEN 1 ELSE 0 END) as approvedCount,
            SUM(CASE WHEN te.status = 'rejected' THEN 1 ELSE 0 END) as rejectedCount,
            COUNT(DISTINCT date(te.submittedAt, '+8 hours')) as activeDays,
            COALESCE(SUM(CASE WHEN te.status = 'approved' THEN te.earnedCoins ELSE 0 END), 0) as earnedCoins
       FROM users u
       LEFT JOIN task_entries te
         ON te.childId = u.id
        AND date(te.submittedAt, '+8 hours') >= date('now', '+8 hours', ?)
       LEFT JOIN tasks t ON te.taskId = t.id AND t.familyId = ?
      WHERE u.familyId = ? AND u.role = 'child'
      GROUP BY u.id
      ORDER BY approvedCount DESC, activeDays DESC`,
    `-${days} days`,
    familyId,
    familyId
  );
  const punishmentSummary = await db.get(
    `SELECT COUNT(*) as totalCount,
            COALESCE(SUM(deductedCoins), 0) as deductedCoins,
            SUM(CASE WHEN level IN ('severe', 'custom') THEN 1 ELSE 0 END) as highCount,
            COUNT(DISTINCT childId) as affectedChildren
       FROM punishment_records
      WHERE familyId = ? AND date(createdAt, '+8 hours') >= date('now', '+8 hours', ?)`,
    familyId,
    `-${days} days`
  );
  const punishmentReasons = await db.all(
    `SELECT reason, level, COUNT(*) as count, COALESCE(SUM(deductedCoins), 0) as deductedCoins
       FROM punishment_records
      WHERE familyId = ? AND date(createdAt, '+8 hours') >= date('now', '+8 hours', ?)
      GROUP BY reason, level
      ORDER BY count DESC, deductedCoins DESC
      LIMIT 8`,
    familyId,
    `-${days} days`
  );
  const chestSummary = await db.get(
    `SELECT COUNT(*) as totalCount,
            COALESCE(SUM(CASE WHEN rewardType = 'coins' THEN rewardValue ELSE 0 END), 0) as coins,
            COALESCE(SUM(CASE WHEN rewardType = 'xp' THEN rewardValue ELSE 0 END), 0) as xp,
            COALESCE(SUM(CASE WHEN rewardType = 'privilegePoints' THEN rewardValue ELSE 0 END), 0) as privilegePoints
       FROM chest_records
      WHERE familyId = ? AND date(createdAt, '+8 hours') >= date('now', '+8 hours', ?)`,
    familyId,
    `-${days} days`
  );
  const chestRarityStats = await db.all(
    `SELECT rewardRarity as rarity, COUNT(*) as count
       FROM chest_records
      WHERE familyId = ? AND date(createdAt, '+8 hours') >= date('now', '+8 hours', ?)
      GROUP BY rewardRarity
      ORDER BY count DESC`,
    familyId,
    `-${days} days`
  );
  const achievementSummary = await db.get(
    `SELECT COUNT(ua.id) as unlockedCount,
            COUNT(DISTINCT ua.achievementId) as uniqueAchievements
       FROM user_achievements ua
       JOIN users u ON ua.childId = u.id
      WHERE u.familyId = ? AND date(ua.unlockedAt, '+8 hours') >= date('now', '+8 hours', ?)`,
    familyId,
    `-${days} days`
  );
  const privilegeSummary = await db.get(
    `SELECT COUNT(ui.id) as redeemedCount,
            COALESCE(SUM(ui.cost), 0) as spentPrivilegePoints
       FROM user_inventory ui
       JOIN users u ON ui.childId = u.id
      WHERE u.familyId = ?
        AND ui.costType = 'privilegePoints'
        AND ui.status != 'cancelled'
        AND date(ui.acquiredAt, '+8 hours') >= date('now', '+8 hours', ?)`,
    familyId,
    `-${days} days`
  );
  const savingsSummary = await db.get(
    `SELECT COUNT(*) as totalGoals,
            SUM(CASE WHEN targetAmount > 0 AND currentAmount >= targetAmount THEN 1 ELSE 0 END) as completedGoals,
            SUM(CASE WHEN targetAmount <= 0 OR currentAmount < targetAmount THEN 1 ELSE 0 END) as activeGoals,
            COALESCE(SUM(currentAmount), 0) as currentAmount,
            COALESCE(SUM(targetAmount), 0) as targetAmount
       FROM wishes
      WHERE familyId = ? AND type = 'savings'`,
    familyId
  );

  const earnedCoins = Number(earned?.total || 0);
  const spentCoins = Number(spentInventory?.total || 0);
  const breakfastSpent = Number(spentBreakfast?.total || 0);
  const netCoins = earnedCoins - spentCoins - breakfastSpent;
  const approvedCount = Number(taskSummary?.approvedCount || 0);
  const punishmentCount = Number(punishmentSummary?.totalCount || 0);
  const chestCount = Number(chestSummary?.totalCount || 0);
  const activeDays = Number(taskSummary?.activeDays || 0);
  const balanceScore = Math.max(0, Math.min(100, Math.round(
    55
    + Math.min(20, (activeDays / days) * 20)
    + Math.min(15, approvedCount * 2)
    + Math.min(10, chestCount)
    - Math.min(30, punishmentCount * 4)
  )));
  const overview = {
    purpose: '总览主要看四件事：孩子有没有启动、规则是否过重、即时反馈是否足够、奖励经济是否健康。',
    focus: [
      '启动：最近有没有形成稳定的完成记录。',
      '平衡：惩罚是否明显高于正反馈。',
      '获得感：宝箱、成就、储蓄目标是否能让孩子看到进步。',
      '经济：金币收入、消费和早餐/商店价格是否匹配。',
    ],
    balanceScore,
    summaryCards: [
      { key: 'activeDays', label: '启动天数', value: activeDays, suffix: `/${days}天`, tone: 'green' },
      { key: 'approvedTasks', label: '完成任务', value: approvedCount, suffix: '次', tone: 'blue' },
      { key: 'chestRewards', label: '宝箱反馈', value: chestCount, suffix: '次', tone: 'purple' },
      { key: 'punishments', label: '违规压力', value: punishmentCount, suffix: '次', tone: punishmentCount > approvedCount * 0.35 ? 'red' : 'orange' },
      { key: 'netCoins', label: '金币净变化', value: netCoins, suffix: '枚', tone: netCoins >= 0 ? 'yellow' : 'red' },
    ],
  };

  const recommendations: string[] = [];
  if (activeDays <= Math.max(1, Math.floor(days / 4))) recommendations.push(`最近 ${days} 天任务启动天数偏少，建议先保留 2-3 个低阻力任务，让孩子重新建立“我能开始”的感觉。`);
  if (approvedCount > 0 && punishmentCount / approvedCount > 0.35) recommendations.push('违规/惩罚频率相对完成记录偏高，建议检查规则是否过细，优先把高频违规改成替代动作或提醒流程。');
  const topCategory = taskCategoryStats[0];
  if (topCategory && approvedCount > 0 && Number(topCategory.approvedCount || 0) / approvedCount > 0.7) recommendations.push(`任务完成集中在“${topCategory.category}”，可以补一点运动、兴趣或生活自理类任务，让成长画像更均衡。`);
  if (chestCount < Math.max(1, Math.floor(approvedCount * 0.5))) recommendations.push('宝箱反馈次数少于完成任务数，若是旧数据可忽略；后续建议保持“完成任务即开宝箱”的即时反馈。');
  if (netCoins < 0) recommendations.push('金币近期净流出为负，可能是商店/早餐价格偏低或奖励过少，建议检查兑换价格和任务奖励比例。');
  const topStuck = stuckReasons[0];
  if (topStuck) recommendations.push(`学习卡住点最多的是“${topStuck.stuckReason}”，建议把相关任务再拆成更短的小关。`);
  const topEmotion = emotionScenes[0];
  if (topEmotion) recommendations.push(`近期高频情绪场景是“${topEmotion.scene}”，建议在孩子端先练对应替代动作，再谈规则。`);
  const highScreen = screenStats.find((row: any) => Number(row.usedMinutes || 0) >= days * 25);
  if (highScreen) recommendations.push(`${highScreen.childName} 近期游戏票使用较多，建议检查是否需要调低每日上限或增加冷却流程。`);
  if (recommendations.length === 0) recommendations.push('近期数据比较平稳，可以继续保持当前规则，并观察孩子最有获得感的模块。');

  res.json({
    days,
    children,
    recommendations,
    overview,
    tasks: {
      summary: taskSummary,
      categoryStats: taskCategoryStats,
      childStats: taskChildStats,
    },
    learning: {
      statusStats: learningStatus,
      stuckReasons,
      frictionQuests,
    },
    emotions: {
      sceneStats: emotionScenes,
      actionStats,
    },
    breakfast: {
      stats: breakfastStats,
    },
    screenTime: {
      childStats: screenStats,
    },
    punishments: {
      summary: punishmentSummary,
      reasons: punishmentReasons,
    },
    rewards: {
      chest: {
        ...chestSummary,
        rarityStats: chestRarityStats,
      },
      achievements: achievementSummary,
      privileges: privilegeSummary,
      savings: savingsSummary,
    },
    economy: {
      earnedCoins,
      spentCoins,
      breakfastSpent,
      netCoins,
    },
  });
});

// ============================================================
// Family Explore routes
// Places are prepared by parents and checked in by children.
// ============================================================
// 探索：地址/名称 → 坐标（高德地理编码，复用 POI 搜索同一把 Web 服务 Key）
// 尽力而为：无 key / 无查询 / 失败 一律返回 null，绝不抛错、绝不阻塞地点创建
async function geocodeExploreAddress(address: string, city: string): Promise<{ latitude: number; longitude: number } | null> {
  const key = process.env.AMAP_WEB_SERVICE_KEY;
  const query = trimText(address, 160);
  if (!key || !query) return null;
  try {
    const result = await axios.get('https://restapi.amap.com/v3/geocode/geo', {
      params: { key, address: query, city: trimText(city, 40) },
      timeout: 8000
    });
    if (String(result.data?.status) !== '1') return null;
    const loc = result.data?.geocodes?.[0]?.location;
    if (typeof loc !== 'string' || !loc.includes(',')) return null;
    const [lngStr, latStr] = loc.split(',');
    const longitude = Number(lngStr);
    const latitude = Number(latStr);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
    return { latitude, longitude };
  } catch (error: any) {
    console.error('Amap geocode failed:', error?.message || error);
    return null;
  }
}

app.get('/api/parent/explore/search', protect, requireParent, async (req: any, res) => {
  try {
    const key = process.env.AMAP_WEB_SERVICE_KEY;
    if (!key) return res.status(400).json({ message: '尚未配置高德 Web 服务 Key，可先手动添加地点。', configured: false });
    const keywords = trimText(req.query.keywords, 80);
    const city = trimText(req.query.city, 40);
    if (!keywords) return res.status(400).json({ message: '请输入想搜索的地点或活动' });

    const result = await axios.get('https://restapi.amap.com/v3/place/text', {
      params: {
        key,
        keywords,
        city,
        offset: 12,
        page: 1,
        extensions: 'base'
      },
      timeout: 8000
    });

    if (String(result.data?.status) !== '1') {
      return res.status(502).json({ message: result.data?.info || '高德搜索暂时不可用' });
    }

    res.json({
      configured: true,
      places: (result.data?.pois || []).map(mapAmapPoi).filter((poi: any) => poi.title)
    });
  } catch (error: any) {
    console.error('Amap explore search failed:', error?.message || error);
    res.status(502).json({ message: '地点搜索失败，请稍后再试或手动添加。' });
  }
});

// 探索：给"未定位"的地点批量补坐标（家长一键；单次最多 50 个，避免超时/限流）
app.post('/api/parent/explore/geocode-missing', protect, requireParent, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const familyId = request.user!.familyId;
  if (!process.env.AMAP_WEB_SERVICE_KEY) {
    return res.status(400).json({ message: '尚未配置高德 Web 服务 Key，无法自动补坐标。', configured: false });
  }
  const missing = await db.all(
    `SELECT id, title, address, city FROM explore_places
     WHERE familyId = ? AND deletedAt IS NULL AND status != 'archived'
       AND (latitude IS NULL OR longitude IS NULL)`,
    familyId
  );
  let filled = 0;
  for (const row of missing.slice(0, 50)) {
    const geo = await geocodeExploreAddress(row.address || row.title, row.city);
    if (geo) {
      await db.run(
        'UPDATE explore_places SET latitude = ?, longitude = ?, updatedAt = ? WHERE id = ? AND familyId = ?',
        geo.latitude, geo.longitude, new Date().toISOString(), row.id, familyId
      );
      filled++;
    }
  }
  const remainingRow = await db.get(
    `SELECT COUNT(*) as c FROM explore_places
     WHERE familyId = ? AND deletedAt IS NULL AND status != 'archived'
       AND (latitude IS NULL OR longitude IS NULL)`,
    familyId
  );
  res.json({ configured: true, total: missing.length, filled, remaining: remainingRow?.c || 0 });
});

app.get('/api/parent/explore/places', protect, requireParent, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const status = String(req.query.status || '').trim();
  const category = String(req.query.category || '').trim();
  const params: any[] = [request.user!.familyId];
  let where = 'WHERE p.familyId = ? AND p.deletedAt IS NULL';
  if (status && status !== 'all') {
    where += ' AND p.status = ?';
    params.push(normalizeExploreStatus(status));
  } else {
    where += " AND p.status != 'archived'";
  }
  if (category && category !== 'all') {
    where += ' AND p.category = ?';
    params.push(normalizeExploreCategory(decodeQueryText(category)));
  }
  const rows = await db.all(`${getExplorePlaceSelect()} ${where} ORDER BY p.createdAt DESC`, ...params);
  res.json(rows);
});

app.post('/api/parent/explore/places', protect, requireParent, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const title = trimText(req.body.title, 80);
  if (!title) return res.status(400).json({ message: '地点名称不能为空' });
  const city = trimText(req.body.city, 40);
  const address = trimText(req.body.address, 160);
  let latitude = req.body.latitude === null || req.body.latitude === undefined || req.body.latitude === '' ? null : Number(req.body.latitude);
  let longitude = req.body.longitude === null || req.body.longitude === undefined || req.body.longitude === '' ? null : Number(req.body.longitude);
  // 自动补坐标：没给坐标时用地址或名称做地理编码（尽力而为，失败保持无坐标、不阻塞创建）
  if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    const geo = await geocodeExploreAddress(address || title, city);
    if (geo) { latitude = geo.latitude; longitude = geo.longitude; }
  }
  const id = randomUUID();
  await db.run(
    `INSERT INTO explore_places (
      id, familyId, title, category, city, address, latitude, longitude, source, externalId,
      summary, whyGo, observeTips, questionPrompts, tags, status, createdBy, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    request.user!.familyId,
    title,
    normalizeExploreCategory(req.body.category),
    city,
    address,
    latitude,
    longitude,
    req.body.source === 'amap' ? 'amap' : 'manual',
    trimText(req.body.externalId, 80),
    trimText(req.body.summary, 300),
    trimText(req.body.whyGo, 500),
    trimText(req.body.observeTips, 500),
    trimText(req.body.questionPrompts, 500),
    trimText(req.body.tags, 200),
    normalizeExploreStatus(req.body.status),
    request.user!.id,
    new Date().toISOString()
  );
  res.json({ message: '探索地点已加入', id });
});

app.put('/api/parent/explore/places/:id', protect, requireParent, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const place = await db.get('SELECT * FROM explore_places WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
  if (!place) return res.status(404).json({ message: '探索地点不存在' });
  const title = trimText(req.body.title ?? place.title, 80);
  if (!title) return res.status(400).json({ message: '地点名称不能为空' });
  const nextCity = trimText(req.body.city ?? place.city, 40);
  const nextAddress = trimText(req.body.address ?? place.address, 160);
  // 坐标：显式传 null/'' 清空；传了值用值；没传沿用原值（保留 null，不再误变成 0）
  let latitude = (req.body.latitude === null || req.body.latitude === '') ? null
    : (req.body.latitude !== undefined ? Number(req.body.latitude) : (place.latitude == null ? null : Number(place.latitude)));
  let longitude = (req.body.longitude === null || req.body.longitude === '') ? null
    : (req.body.longitude !== undefined ? Number(req.body.longitude) : (place.longitude == null ? null : Number(place.longitude)));
  // 自动补坐标：更新后仍无坐标且有地址/名称时地理编码（尽力而为）
  if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    const geo = await geocodeExploreAddress(nextAddress || title, nextCity);
    if (geo) { latitude = geo.latitude; longitude = geo.longitude; }
  }
  await db.run(
    `UPDATE explore_places SET
      title = ?, category = ?, city = ?, address = ?, latitude = ?, longitude = ?,
      summary = ?, whyGo = ?, observeTips = ?, questionPrompts = ?, tags = ?, status = ?, updatedAt = ?
     WHERE id = ? AND familyId = ?`,
    title,
    normalizeExploreCategory(req.body.category ?? place.category),
    nextCity,
    nextAddress,
    latitude,
    longitude,
    trimText(req.body.summary ?? place.summary, 300),
    trimText(req.body.whyGo ?? place.whyGo, 500),
    trimText(req.body.observeTips ?? place.observeTips, 500),
    trimText(req.body.questionPrompts ?? place.questionPrompts, 500),
    trimText(req.body.tags ?? place.tags, 200),
    normalizeExploreStatus(req.body.status ?? place.status),
    new Date().toISOString(),
    req.params.id,
    request.user!.familyId
  );
  res.json({ message: '探索地点已更新' });
});

app.delete('/api/parent/explore/places/:id', protect, requireParent, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const place = await db.get('SELECT * FROM explore_places WHERE id = ? AND familyId = ? AND deletedAt IS NULL', req.params.id, request.user!.familyId);
  if (!place) return res.status(404).json({ message: '探索地点不存在' });
  // B2-3: 软删除——标记 deletedAt，保留打卡记录
  await db.run('UPDATE explore_places SET deletedAt = ?, updatedAt = ? WHERE id = ? AND familyId = ?', new Date().toISOString(), new Date().toISOString(), req.params.id, request.user!.familyId);
  res.json({ message: '探索地点已删除' });
});

app.get('/api/parent/explore/checkins', protect, requireParent, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const rows = await db.all(`
    SELECT ec.*, p.title as placeTitle, p.category as placeCategory, p.address, u.name as childName,
      (SELECT COUNT(*) FROM explore_media em WHERE em.checkinId = ec.id) as mediaCount
    FROM explore_checkins ec
    LEFT JOIN explore_places p ON ec.placeId = p.id
    JOIN users u ON ec.childId = u.id
    WHERE ec.familyId = ?
    ORDER BY ec.checkedInAt DESC
    LIMIT 100
  `, request.user!.familyId);
  res.json(rows);
});

// B4-06: 家长查看打卡媒体（照片/语音）
app.get('/api/parent/explore/checkins/:id/media', protect, requireParent, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const checkin = await db.get('SELECT * FROM explore_checkins WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
  if (!checkin) return res.status(404).json({ message: '打卡记录不存在' });
  const media = await db.all('SELECT * FROM explore_media WHERE checkinId = ? ORDER BY createdAt ASC', req.params.id);
  res.json(media);
});

app.post('/api/parent/explore/checkins/batch-confirm', protect, requireParent, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const { checkinIds } = req.body as { checkinIds: string[] };
  if (!Array.isArray(checkinIds) || checkinIds.length === 0) {
    return res.status(400).json({ message: '请选择要确认的打卡记录' });
  }
  const placeholders = checkinIds.map(() => '?').join(',');
  await db.run(
    `UPDATE explore_checkins SET parentConfirmed = 1, confirmedAt = datetime('now'), updatedAt = datetime('now')
     WHERE id IN (${placeholders}) AND familyId = ?`,
    [...checkinIds, request.user!.familyId]
  );
  // 触发成就检查
  for (const id of checkinIds) {
    const checkin = await db.get('SELECT childId, familyId FROM explore_checkins WHERE id = ?', id);
    if (checkin) await checkAchievements(checkin.childId, db);
  }
  res.json({ message: '批量确认成功', count: checkinIds.length });
});

app.post('/api/parent/explore/checkins/:id/confirm', protect, requireParent, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const checkin = await db.get('SELECT * FROM explore_checkins WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
  if (!checkin) return res.status(404).json({ message: '打卡记录不存在' });
  await db.run(
    'UPDATE explore_checkins SET parentConfirmed = 1, parentNote = ?, confirmedAt = ?, updatedAt = ? WHERE id = ? AND familyId = ?',
    trimText(req.body.parentNote, 500),
    new Date().toISOString(),
    new Date().toISOString(),
    req.params.id,
    request.user!.familyId
  );
  const unlockedAchievements = await checkAchievements(checkin.childId, db);
  res.json({ message: '探索记录已确认', unlockedAchievements });
});

// 探索改版①：家长语音回应——随确认上传，senderRole='parent'，childId 保持打卡孩子（外键语义）
app.post('/api/parent/explore/checkins/:id/reply-voice', protect, requireParent, async (req: any, res) => {
  try {
    const request = req as AuthRequest;
    const db = getDb();
    const checkin = await db.get('SELECT * FROM explore_checkins WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
    if (!checkin) return res.status(404).json({ message: '打卡记录不存在' });
    const quotaOk = await checkFamilyUploadQuota(request.user!.familyId);
    if (!quotaOk) return res.status(429).json({ message: '家庭探索存储空间已满，请先清理旧记录' });
    const existing = (await db.get("SELECT COUNT(*) as count FROM explore_media WHERE checkinId = ? AND type = 'audio' AND senderRole = 'parent'", req.params.id))?.count || 0;
    if (existing >= 1) return res.status(400).json({ message: '每次打卡只能保留 1 条语音回应' });
    const saved = await saveExploreMediaFile({ ...req.body, type: 'audio' }, request.user!.familyId, checkin.childId);
    const id = randomUUID();
    await db.run(
      `INSERT INTO explore_media (id, familyId, checkinId, childId, type, filePath, mimeType, sizeBytes, durationSeconds, senderRole)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'parent')`,
      id,
      request.user!.familyId,
      req.params.id,
      checkin.childId,
      saved.type,
      saved.filePath,
      saved.mimeType,
      saved.sizeBytes,
      saved.durationSeconds
    );
    res.json({ message: '语音回应已发送', media: { id, ...saved, senderRole: 'parent' } });
  } catch (error: any) {
    console.error('explore reply voice failed:', error);
    res.status(error.status || 500).json({ message: error.message || '语音回应发送失败' });
  }
});

// 探索改版②：家庭媒体配额可视化
app.get('/api/parent/explore/quota', protect, requireParent, async (req: any, res) => {
  const request = req as AuthRequest;
  const row = await getDb().get(
    'SELECT COALESCE(SUM(sizeBytes), 0) as usedBytes FROM explore_media WHERE familyId = ?',
    request.user!.familyId
  );
  res.json({ usedBytes: row?.usedBytes || 0, totalBytes: FAMILY_UPLOAD_QUOTA_MB * 1024 * 1024 });
});

// 探索改版②：探索设置读写（照片要求开关 + 地图一期的打卡位置核对开关）
app.get('/api/parent/explore/settings', protect, requireParent, async (req: any, res) => {
  const request = req as AuthRequest;
  const family = await getDb().get('SELECT exploreRequirePhoto, exploreGeoVerify FROM families WHERE id = ?', request.user!.familyId);
  res.json({
    exploreRequirePhoto: family?.exploreRequirePhoto ? 1 : 0,
    exploreGeoVerify: family?.exploreGeoVerify ? 1 : 0
  });
});

app.put('/api/parent/explore/settings', protect, requireParent, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  // 只更新请求中携带的开关，避免单开关提交互相覆盖
  if (req.body?.exploreRequirePhoto !== undefined) {
    await db.run('UPDATE families SET exploreRequirePhoto = ? WHERE id = ?', req.body.exploreRequirePhoto ? 1 : 0, request.user!.familyId);
  }
  if (req.body?.exploreGeoVerify !== undefined) {
    await db.run('UPDATE families SET exploreGeoVerify = ? WHERE id = ?', req.body.exploreGeoVerify ? 1 : 0, request.user!.familyId);
  }
  const family = await db.get('SELECT exploreRequirePhoto, exploreGeoVerify FROM families WHERE id = ?', request.user!.familyId);
  res.json({
    message: '探索设置已更新',
    exploreRequirePhoto: family?.exploreRequirePhoto ? 1 : 0,
    exploreGeoVerify: family?.exploreGeoVerify ? 1 : 0
  });
});

// 探索改版③：回忆时间线——最近 6 个月已确认打卡，按北京时间月份分组
app.get('/api/parent/explore/timeline', protect, requireParent, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const rows = await db.all(`
    SELECT ec.id, ec.placeId, ec.mood, ec.note, ec.parentNote, ec.checkedInAt,
      strftime('%Y-%m', ec.checkedInAt, '+8 hours') as month,
      p.title as placeTitle, p.category as placeCategory, u.name as childName
    FROM explore_checkins ec
    LEFT JOIN explore_places p ON ec.placeId = p.id
    JOIN users u ON ec.childId = u.id
    WHERE ec.familyId = ? AND ec.parentConfirmed = 1
      AND date(ec.checkedInAt, '+8 hours') >= date('now', '+8 hours', 'start of month', '-5 months')
    ORDER BY ec.checkedInAt DESC
  `, request.user!.familyId);
  const mediaByCheckin: Record<string, any[]> = {};
  if (rows.length) {
    const placeholders = rows.map(() => '?').join(',');
    const media = await db.all(
      `SELECT id, checkinId, type, filePath, durationSeconds, senderRole
       FROM explore_media WHERE checkinId IN (${placeholders}) ORDER BY createdAt ASC`,
      ...rows.map((row: any) => row.id)
    );
    media.forEach((m: any) => {
      (mediaByCheckin[m.checkinId] = mediaByCheckin[m.checkinId] || []).push(m);
    });
  }
  const monthMap = new Map<string, { month: string; placeIds: Set<string>; checkins: any[] }>();
  for (const row of rows) {
    let group = monthMap.get(row.month);
    if (!group) {
      group = { month: row.month, placeIds: new Set<string>(), checkins: [] };
      monthMap.set(row.month, group);
    }
    if (row.placeId) group.placeIds.add(row.placeId);
    group.checkins.push({ ...row, media: mediaByCheckin[row.id] || [] });
  }
  res.json(Array.from(monthMap.values()).map(group => ({
    month: group.month,
    newPlaceCount: group.placeIds.size,
    checkins: group.checkins
  })));
});

app.get('/api/child/explore/places', protect, requireChild, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const category = String(req.query.category || '').trim();
  const params: any[] = [request.user!.familyId];
  let where = "WHERE p.familyId = ? AND p.status != 'archived' AND p.deletedAt IS NULL";
  if (category && category !== 'all') {
    where += ' AND p.category = ?';
    params.push(normalizeExploreCategory(decodeQueryText(category)));
  }
  const rows = await db.all(`${getExplorePlaceSelect()} ${where} ORDER BY CASE p.status WHEN 'planned' THEN 0 WHEN 'wishlist' THEN 1 WHEN 'visited' THEN 2 ELSE 3 END, p.createdAt DESC`, ...params);
  res.json(rows);
});

// 探索地图一期：地图标记数据（无坐标的地点也返回，供列表模式兜底展示）
// 探索三期：LEFT JOIN 来源发现卡，带出配图与推荐语供地图抽屉展示
app.get('/api/child/explore/map-places', protect, requireChild, async (req: any, res) => {
  const request = req as AuthRequest;
  const rows = await getDb().all(`
    SELECT p.id, p.title, p.category, p.status, p.latitude, p.longitude,
      COALESCE(NULLIF(p.summary, ''), f.summary) as summary, p.whyGo, p.observeTips, p.questionPrompts,
      f.imageUrl as imageUrl,
      (SELECT COUNT(*) FROM explore_checkins ec WHERE ec.placeId = p.id) as checkinCount,
      (SELECT checkedInAt FROM explore_checkins ec WHERE ec.placeId = p.id ORDER BY checkedInAt DESC LIMIT 1) as lastCheckedInAt
    FROM explore_places p
    LEFT JOIN explore_feed_items f ON p.sourceFeedId = f.id
    WHERE p.familyId = ? AND p.status != 'archived' AND p.deletedAt IS NULL
    ORDER BY p.createdAt DESC
  `, request.user!.familyId);
  res.json(rows);
});

app.get('/api/child/explore/places/:id', protect, requireChild, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const place = await db.get(`${getExplorePlaceSelect()} WHERE p.id = ? AND p.familyId = ? AND p.deletedAt IS NULL`, req.params.id, request.user!.familyId);
  if (!place) return res.status(404).json({ message: '探索地点不存在' });
  const checkins = await db.all('SELECT * FROM explore_checkins WHERE placeId = ? AND childId = ? ORDER BY checkedInAt DESC', req.params.id, request.user!.id);
  const media = checkins.length
    ? await db.all(`SELECT em.* FROM explore_media em JOIN explore_checkins ec ON em.checkinId = ec.id WHERE ec.placeId = ? AND ec.childId = ? ORDER BY em.createdAt DESC`, req.params.id, request.user!.id)
    : [];
  res.json({ place, checkins, media });
});

app.get('/api/child/explore/checkins', protect, requireChild, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const rows = await db.all(`
    SELECT ec.*, p.title as placeTitle, p.category as placeCategory, p.address,
      (SELECT COUNT(*) FROM explore_media em WHERE em.checkinId = ec.id) as mediaCount,
      (SELECT COUNT(*) FROM explore_media em WHERE em.checkinId = ec.id AND em.type = 'audio' AND em.senderRole = 'parent') as parentVoiceCount
    FROM explore_checkins ec
    LEFT JOIN explore_places p ON ec.placeId = p.id
    WHERE ec.familyId = ? AND ec.childId = ?
    ORDER BY ec.checkedInAt DESC
    LIMIT 100
  `, request.user!.familyId, request.user!.id);
  res.json(rows);
});

// 探索改版①：孩子查看自己打卡的媒体（含家长语音回应，senderRole 区分）
app.get('/api/child/explore/checkins/:id/media', protect, requireChild, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const checkin = await db.get('SELECT id FROM explore_checkins WHERE id = ? AND familyId = ? AND childId = ?', req.params.id, request.user!.familyId, request.user!.id);
  if (!checkin) return res.status(404).json({ message: '打卡记录不存在' });
  const media = await db.all('SELECT * FROM explore_media WHERE checkinId = ? ORDER BY createdAt ASC', req.params.id);
  res.json(media);
});

// 探索改版②：孩子端读取探索开关（照片要求 + 打卡位置核对，提交前的前端引导用）
app.get('/api/child/explore/settings', protect, requireChild, async (req: any, res) => {
  const request = req as AuthRequest;
  const family = await getDb().get('SELECT exploreRequirePhoto, exploreGeoVerify FROM families WHERE id = ?', request.user!.familyId);
  res.json({
    exploreRequirePhoto: family?.exploreRequirePhoto ? 1 : 0,
    exploreGeoVerify: family?.exploreGeoVerify ? 1 : 0
  });
});

// B4-07: 探索成就进度接口 — 返回当前孩子的探索类成就完成进度
app.get('/api/child/explore/achievement-progress', protect, requireChild, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const childId = request.user!.id;
  const familyId = request.user!.familyId;
  await ensureExploreAchievementDefs(db, familyId);

  // R1 性能：7 个互不依赖的只读查询并行执行
  const [exploreDefs, unlocked, checkinCountRow, mediaCountRow, voiceCountRow, confirmedCountRow, exploreCategoryStats] = await Promise.all([
    db.all(
      `SELECT * FROM achievement_defs WHERE familyId = ? AND conditionType LIKE 'explore_%'`,
      familyId
    ),
    db.all(
      'SELECT achievementId FROM user_achievements WHERE childId = ?',
      childId
    ),
    db.get('SELECT COUNT(*) as count FROM explore_checkins WHERE childId = ?', childId),
    db.get("SELECT COUNT(*) as count FROM explore_media WHERE childId = ? AND type = 'image'", childId),
    db.get("SELECT COUNT(*) as count FROM explore_media WHERE childId = ? AND type = 'audio' AND senderRole = 'child'", childId),
    db.get('SELECT COUNT(*) as count FROM explore_checkins WHERE childId = ? AND parentConfirmed = 1', childId),
    db.all(
      `SELECT p.category, COUNT(*) as count FROM explore_checkins ec JOIN explore_places p ON ec.placeId = p.id WHERE ec.childId = ? GROUP BY p.category`,
      childId
    ),
  ]);
  const unlockedSet = new Set(unlocked.map((u: any) => u.achievementId));

  // 基础统计（与 checkAchievements 一致）
  const exploreCheckinCount = checkinCountRow?.count || 0;
  const exploreMediaCount = mediaCountRow?.count || 0;
  const exploreVoiceCount = voiceCountRow?.count || 0;
  const exploreConfirmedCount = confirmedCountRow?.count || 0;
  const exploreCategoryCountMap: Record<string, number> = {};
  exploreCategoryStats.forEach((s: any) => { exploreCategoryCountMap[s.category] = s.count; });
  const exploreDistinctCategories = Object.keys(exploreCategoryCountMap).filter(c => c && c !== '其他').length;

  const progress = exploreDefs.map((def: any) => {
    let current = 0;
    switch (def.conditionType) {
      case 'explore_checkin_count':
        current = exploreCheckinCount;
        break;
      case 'explore_category_count': {
        const cats = String(def.conditionCategory || '').split(',').map((c: string) => c.trim()).filter(Boolean);
        current = cats.reduce((sum, cat) => sum + (exploreCategoryCountMap[cat] || 0), 0);
        break;
      }
      case 'explore_media_count':
        current = exploreMediaCount;
        break;
      case 'explore_voice_count':
        current = exploreVoiceCount;
        break;
      case 'explore_confirmed_count':
        current = exploreConfirmedCount;
        break;
      case 'explore_distinct_categories':
        current = exploreDistinctCategories;
        break;
    }
    return {
      id: def.id,
      title: def.title,
      icon: def.icon,
      conditionType: def.conditionType,
      target: def.conditionValue,
      current: Math.min(current, def.conditionValue),
      unlocked: unlockedSet.has(def.id),
    };
  });

  res.json(progress);
});

app.post('/api/child/explore/checkins', protect, requireChild, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  await ensureExploreAchievementDefs(db, request.user!.familyId);
  const place = await db.get("SELECT * FROM explore_places WHERE id = ? AND familyId = ? AND status != 'archived' AND deletedAt IS NULL", req.body.placeId, request.user!.familyId);
  if (!place) return res.status(404).json({ message: '探索地点不存在' });
  // B2-2: 同日重复打卡检查（多孩子场景下，同一孩子同日同地点只能打卡一次）
  const existingToday = await db.get(
    "SELECT id FROM explore_checkins WHERE placeId = ? AND childId = ? AND date(checkedInAt, '+8 hours') = date('now', '+8 hours')",
    req.body.placeId, request.user!.id
  );
  if (existingToday) return res.status(409).json({ message: '今天已经在这个地点打卡过了' });
  const id = randomUUID();
  const checkedInAt = new Date().toISOString();
  // 探索地图一期：单次打卡定位（可选）——只记录距离，距离远也不阻止打卡
  let checkinLat: number | null = null;
  let checkinLng: number | null = null;
  let distanceMeters: number | null = null;
  const rawLat = Number(req.body.latitude);
  const rawLng = Number(req.body.longitude);
  if (req.body.latitude != null && req.body.longitude != null &&
      Number.isFinite(rawLat) && Number.isFinite(rawLng) &&
      Math.abs(rawLat) <= 90 && Math.abs(rawLng) <= 180) {
    checkinLat = rawLat;
    checkinLng = rawLng;
    if (place.latitude != null && place.longitude != null) {
      distanceMeters = haversineMeters(rawLat, rawLng, Number(place.latitude), Number(place.longitude));
    }
  }
  await db.run(
    `INSERT INTO explore_checkins (id, familyId, placeId, childId, mood, note, checkedInAt, updatedAt, latitude, longitude, distanceMeters)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    request.user!.familyId,
    place.id,
    request.user!.id,
    normalizeExploreMood(req.body.mood),
    trimText(req.body.note, 800),
    checkedInAt,
    checkedInAt,
    checkinLat,
    checkinLng,
    distanceMeters
  );
  await db.run("UPDATE explore_places SET status = CASE WHEN status = 'wishlist' THEN 'visited' ELSE status END, updatedAt = ? WHERE id = ?", checkedInAt, place.id);
  const unlockedAchievements = await checkAchievements(request.user!.id, db);
  res.json({ message: '探索打卡已保存', id, unlockedAchievements });
});

app.post('/api/child/explore/checkins/:id/media', protect, requireChild, async (req: any, res) => {
  try {
    const request = req as AuthRequest;
    const db = getDb();
    const checkin = await db.get('SELECT * FROM explore_checkins WHERE id = ? AND familyId = ? AND childId = ?', req.params.id, request.user!.familyId, request.user!.id);
    if (!checkin) return res.status(404).json({ message: '打卡记录不存在' });
    const quotaOk = await checkFamilyUploadQuota(request.user!.familyId);
    if (!quotaOk) return res.status(429).json({ message: '家庭探索存储空间已满，请联系家长清理' });
    const type = req.body?.type === 'audio' ? 'audio' : 'image';
    const existing = (await db.get("SELECT COUNT(*) as count FROM explore_media WHERE checkinId = ? AND type = ? AND senderRole = 'child'", req.params.id, type))?.count || 0;
    if (type === 'image' && existing >= 3) return res.status(400).json({ message: '每次打卡最多上传 3 张照片' });
    if (type === 'audio' && existing >= 1) return res.status(400).json({ message: '每次打卡最多保留 1 条语音' });
    const saved = await saveExploreMediaFile(req.body, request.user!.familyId, request.user!.id);
    const id = randomUUID();
    await db.run(
      `INSERT INTO explore_media (id, familyId, checkinId, childId, type, filePath, mimeType, sizeBytes, durationSeconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      request.user!.familyId,
      req.params.id,
      request.user!.id,
      saved.type,
      saved.filePath,
      saved.mimeType,
      saved.sizeBytes,
      saved.durationSeconds
    );
    const unlockedAchievements = await checkAchievements(request.user!.id, db);
    res.json({ message: saved.type === 'audio' ? '语音留言已保存' : '照片纪念已保存', media: { id, ...saved }, unlockedAchievements });
  } catch (error: any) {
    console.error('explore media upload failed:', error);
    res.status(error.status || 500).json({ message: error.message || '媒体上传失败' });
  }
});

// ============================================================
// 全家任务（Family Mission）专用接口
// 与普通任务使用同一 tasks 表，通过 taskType = 'family' 区分
// ============================================================

// 查询全家任务列表（家长端）
app.get('/api/parent/family-missions', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const familyId = request.user!.familyId;
    const missions = await db.all(
        `SELECT t.*,
          (SELECT COUNT(*) FROM task_entries te WHERE te.taskId = t.id AND te.status = 'approved') as completedCount,
          (SELECT COUNT(*) FROM task_entries te WHERE te.taskId = t.id AND te.status = 'pending') as pendingCount,
          (SELECT COUNT(*) FROM users u WHERE u.familyId = ? AND u.role = 'child') as childCount
         FROM tasks t
         WHERE t.familyId = ? AND t.taskType = 'family' AND t.isEnabled = 1
         ORDER BY t.createdAt DESC`,
        familyId, familyId
    );
    res.json(missions);
});

// 创建全家任务（家长端）
app.post('/api/parent/family-missions', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    if (request.user?.role !== 'parent') return res.status(403).json({ message: '权限不足' });
    const db = getDb();
    const familyId = request.user!.familyId;
    const { title, icon, coinReward, xpReward, durationMinutes, description } = req.body;

    if (!title?.trim()) return res.status(400).json({ message: '任务标题不能为空' });
    if (!coinReward || coinReward < 1) return res.status(400).json({ message: '金币奖励不能为空' });

    const id = randomUUID();
    await db.run(
        `INSERT INTO tasks (id, familyId, title, coinReward, xpReward, durationMinutes, category, icon, isEnabled, taskType, customDays, validDate, isParallel)
         VALUES (?, ?, ?, ?, ?, ?, '协作', ?, 1, 'family', NULL, NULL, 0)`,
        id, familyId, title.trim(), coinReward, xpReward || Math.round(coinReward * 0.5), durationMinutes || 30, icon || '🏆'
    );
    res.json({ message: '全家任务创建成功', id });
});

// 编辑全家任务（家长端）
app.put('/api/parent/family-missions/:id', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    if (request.user?.role !== 'parent') return res.status(403).json({ message: '权限不足' });
    const db = getDb();
    const mission = await db.get('SELECT * FROM tasks WHERE id = ? AND familyId = ? AND taskType = ?', req.params.id, request.user!.familyId, 'family');
    if (!mission) return res.status(404).json({ message: '全家任务不存在' });

    const { title, icon, coinReward, xpReward, durationMinutes } = req.body;
    await db.run(
        `UPDATE tasks SET title = ?, icon = ?, coinReward = ?, xpReward = ?, durationMinutes = ? WHERE id = ?`,
        title || mission.title, icon || mission.icon, coinReward ?? mission.coinReward, xpReward ?? mission.xpReward, durationMinutes ?? mission.durationMinutes, req.params.id
    );
    res.json({ message: '更新成功' });
});

// 删除全家任务（软删除）
app.delete('/api/parent/family-missions/:id', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    if (request.user?.role !== 'parent') return res.status(403).json({ message: '权限不足' });
    const db = getDb();
    const mission = await db.get('SELECT * FROM tasks WHERE id = ? AND familyId = ? AND taskType = ?', req.params.id, request.user!.familyId, 'family');
    if (!mission) return res.status(404).json({ message: '全家任务不存在' });
    await db.run('UPDATE tasks SET isEnabled = 0 WHERE id = ?', req.params.id);
    res.json({ message: '全家任务已删除' });
});

const inferWishCategory = (wish: any) => {
    const stored = String(wish?.category || '').trim();
    if (stored) return stored.slice(0, 20);
    const text = `${wish?.title || ''} ${wish?.description || ''}`;
    if (/(手机|电视|游戏|屏幕|平板)/.test(text)) return '屏幕';
    if (/(早餐|晚餐|午餐|零食|饼干|糖|奶|水果|披萨|小吃)/.test(text)) return '餐饮';
    if (/(公园|外出|游乐|电影)/.test(text)) return '外出';
    if (/(书|学习|文具|画画|课程)/.test(text)) return '学习';
    if (/(玩具|贴纸|乐高)/.test(text)) return '玩乐';
    return '其他';
};

const withWishCategory = (wish: any) => ({ ...wish, category: inferWishCategory(wish) });
const withParentWishCategory = (wish: any) => withWishCategory(toParentWish(wish));
const withChildWishCategory = (wish: any) => withWishCategory(toChildWish(wish));

const ensureSingleDrawAgainPrize = async (db: any, familyId: string) => {
    let systemDrawAgain = await db.get(
        "SELECT id FROM wishes WHERE familyId = ? AND type = 'lottery' AND isSystemDefault = 1",
        familyId
    );

    if (!systemDrawAgain) {
        const id = randomUUID();
        await db.run(
            `INSERT INTO wishes (id, familyId, type, title, cost, icon, stock, isActive, weight, rarity, effectType, isSystemDefault)
             VALUES (?, ?, 'lottery', '再抽一次', 0, '🔄', -1, 0, 25, 'uncommon', 'draw_again', 1)`,
            id, familyId
        );
        systemDrawAgain = { id };
    }

    await db.run(
        `UPDATE wishes
         SET effectType = NULL
         WHERE familyId = ?
           AND type = 'lottery'
           AND effectType = 'draw_again'
           AND id <> ?`,
        familyId,
        systemDrawAgain.id
    );

    await db.run(
        `UPDATE wishes
         SET title = '再抽一次', icon = '🔄', effectType = 'draw_again'
         WHERE id = ?`,
        systemDrawAgain.id
    );
};

app.get('/api/parent/wishes', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const familyId = request.user!.familyId;

    await ensureSingleDrawAgainPrize(db, familyId);

    const wishes = await db.all('SELECT * FROM wishes WHERE familyId = ?', familyId);
    res.json(wishes.map(withParentWishCategory));
});
app.post('/api/parent/wishes', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    let wishInput = req.body;
    try {
        if (wishInput.type === 'lottery') wishInput = normalizeLotteryPrizeInput(wishInput);
        if (wishInput.type === 'shop') {
            wishInput = { ...wishInput, referenceRmb: normalizeShopReferenceRmb(wishInput.referenceRmb) };
        }
    } catch (err: any) {
        return res.status(400).json({ message: err.message });
    }
    const weight = wishInput.weight || 10;
    const rarity = wishInput.rarity || null;
    const category = wishInput.type === 'shop' ? inferWishCategory(wishInput) : null;
    await getDb().run(
        `INSERT INTO wishes (id, familyId, type, title, cost, targetAmount, icon, stock, isActive, weight, rarity, effectType, category, reference_rmb) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        randomUUID(), request.user!.familyId, wishInput.type, wishInput.title, wishInput.cost, wishInput.targetAmount, wishInput.icon, wishInput.stock, weight, rarity, wishInput.effectType || null, category, wishInput.type === 'shop' ? wishInput.referenceRmb : null
    );
    res.json({message:'ok'});
});

// 任务管理接口（普通任务）
app.get('/api/parent/tasks', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    res.json(await getDb().all('SELECT * FROM tasks WHERE familyId = ? AND isEnabled = 1 AND taskType != ? ORDER BY createdAt DESC', request.user!.familyId, 'family'));
});
app.post('/api/parent/tasks', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const { title, coinReward, xpReward, durationMinutes, category, icon, taskType, customDays, isParallel } = req.body;
    const normalizedCategory = normalizeTaskCategoryInput(category);
    const normalizedDuration = Math.max(1, Math.round(Number(durationMinutes || 15) || 15));
    const completion = normalizeTaskCompletionSettings(req.body, normalizedCategory);
    const rewardSuggestion = getTaskRewardSuggestion({
      minutes: normalizedDuration,
      category: normalizedCategory,
      completionMode: completion.completionMode,
      targetValue: completion.targetValue,
    });
    const normalizedCoins = coinReward === undefined || coinReward === null || coinReward === ''
      ? rewardSuggestion.coins
      : Math.max(0, Math.round(Number(coinReward) || 0));
    const normalizedXp = xpReward === undefined || xpReward === null || xpReward === ''
      ? rewardSuggestion.xp
      : Math.max(0, Math.round(Number(xpReward) || 0));
    const todayStr = getLocalDateString();
    const id = randomUUID();
    await getDb().run(
        `INSERT INTO tasks (id, familyId, title, coinReward, xpReward, durationMinutes, category, icon, isEnabled, taskType, customDays, validDate, isParallel, completionMode, targetValue, targetUnit, reviewFocus)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, request.user!.familyId, title, normalizedCoins, normalizedXp, normalizedDuration, normalizedCategory, icon || '📋',
        taskType || 'daily', customDays ? JSON.stringify(customDays) : null, taskType === 'once' ? todayStr : null, isParallel ? 1 : 0,
        completion.completionMode, completion.targetValue, completion.targetUnit, completion.reviewFocus
    );
    res.json({ id });
});

// 更新任务
app.put('/api/parent/tasks/:id', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const task = await db.get('SELECT * FROM tasks WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
    if (!task) return res.status(404).json({ message: '任务不存在' });

    const { title, coinReward, xpReward, durationMinutes, category, icon, taskType, customDays, isParallel } = req.body;
    const newTaskType = taskType ?? task.taskType ?? 'daily';
    const normalizedCategory = category !== undefined ? normalizeTaskCategoryInput(category) : task.category;
    const normalizedDuration = durationMinutes !== undefined
      ? Math.max(1, Math.round(Number(durationMinutes || 15) || 15))
      : task.durationMinutes;
    const completion = normalizeTaskCompletionSettings(req.body, normalizedCategory, task);
    const rewardSuggestion = getTaskRewardSuggestion({
      minutes: normalizedDuration,
      category: normalizedCategory,
      completionMode: completion.completionMode,
      targetValue: completion.targetValue,
    });

    await db.run(
        `UPDATE tasks SET title = ?, coinReward = ?, xpReward = ?, durationMinutes = ?, category = ?, icon = ?,
         taskType = ?, customDays = ?, isParallel = ?, completionMode = ?, targetValue = ?, targetUnit = ?, reviewFocus = ? WHERE id = ?`,
        title || task.title,
        coinReward !== undefined ? Math.max(0, Math.round(Number(coinReward) || 0)) : task.coinReward ?? rewardSuggestion.coins,
        xpReward !== undefined ? Math.max(0, Math.round(Number(xpReward) || 0)) : task.xpReward ?? rewardSuggestion.xp,
        normalizedDuration,
        normalizedCategory,
        icon || task.icon || '📋',
        newTaskType,
        newTaskType === 'custom' ? JSON.stringify(customDays || JSON.parse(task.customDays || '[]')) : null,
        isParallel !== undefined ? (isParallel ? 1 : 0) : task.isParallel,
        completion.completionMode,
        completion.targetValue,
        completion.targetUnit,
        completion.reviewFocus,
        req.params.id
    );
    res.json({ message: '更新成功' });
});

// 删除任务（软删除）
app.delete('/api/parent/tasks/:id', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const task = await db.get('SELECT * FROM tasks WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
    if (!task) return res.status(404).json({ message: '任务不存在' });
    await db.run('UPDATE tasks SET isEnabled = 0 WHERE id = ?', req.params.id);
    const completedCount = await db.get('SELECT COUNT(*) as count FROM task_entries WHERE taskId = ? AND status = ?', req.params.id, 'approved');
    res.json({
        message: '任务已删除',
        preservedRecords: completedCount?.count || 0,
        note: completedCount?.count > 0 ? `已保留 ${completedCount.count} 条完成记录` : undefined
    });
});

// 恢复已删除的任务
app.post('/api/parent/tasks/:id/restore', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const task = await db.get('SELECT * FROM tasks WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
    if (!task) return res.status(404).json({ message: '任务不存在' });
    await db.run('UPDATE tasks SET isEnabled = 1 WHERE id = ?', req.params.id);
    res.json({ message: '任务已恢复' });
});
// 更新奖品（包括权重、稀有度、效果类型）
app.put('/api/parent/wishes/:id', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const wish = await db.get('SELECT * FROM wishes WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
    if (!wish) return res.status(404).json({ message: '奖品不存在' });

    // 系统默认奖项只能修改权重和稀有度
    if (wish.isSystemDefault === 1) {
        const { weight, rarity } = req.body;
        await db.run(
            'UPDATE wishes SET weight = ?, rarity = ? WHERE id = ? AND familyId = ?',
            weight || 25, rarity || 'uncommon', req.params.id, request.user!.familyId
        );
    } else {
        const { title, cost, icon, stock, weight, rarity, targetAmount, effectType, category, referenceRmb } = req.body;
        let wishInput = { title, cost, icon, stock, weight, rarity, targetAmount, effectType, category, referenceRmb };
        try {
            if (wish.type === 'lottery') wishInput = normalizeLotteryPrizeInput(wishInput);
            if (wish.type === 'shop') {
                wishInput = {
                    ...wishInput,
                    referenceRmb: referenceRmb === undefined
                        ? normalizeShopReferenceRmb(wish.reference_rmb)
                        : normalizeShopReferenceRmb(referenceRmb)
                };
            }
        } catch (err: any) {
            return res.status(400).json({ message: err.message });
        }
        const nextCategory = wish.type === 'shop' ? inferWishCategory(wishInput) : null;
        await db.run(
            'UPDATE wishes SET title = ?, cost = ?, icon = ?, stock = ?, weight = ?, rarity = ?, targetAmount = ?, effectType = ?, category = ?, reference_rmb = ? WHERE id = ? AND familyId = ?',
            wishInput.title, wishInput.cost, wishInput.icon, wishInput.stock, wishInput.weight || 10, wishInput.rarity || null, wishInput.targetAmount || 0, wishInput.effectType || null, nextCategory, wish.type === 'shop' ? wishInput.referenceRmb : null, req.params.id, request.user!.familyId
        );
    }
    res.json({message:'ok'});
});

app.delete('/api/parent/wishes/:id', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    // 检查是否是系统默认奖项，不允许删除
    const wish = await db.get('SELECT isSystemDefault FROM wishes WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
    if (!wish) return res.status(404).json({ message: '奖品不存在' });
    if (wish?.isSystemDefault === 1) {
        return res.status(400).json({ message: '「再抽一次」是系统默认奖项，不能删除' });
    }
    await db.run('DELETE FROM wishes WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
    res.json({message:'ok'});
});

// 抽奖奖池上架管理
app.post('/api/parent/wishes/lottery/activate', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    let activeIds: string[];
    try {
        activeIds = validateLotteryActivationIds(request.body.activeIds);
    } catch (err: any) {
        return res.status(400).json({ message: err.message });
    }

    const db = getDb();
    const familyId = request.user!.familyId;
    const placeholders = activeIds.map(() => '?').join(', ');
    const selectedPrizes = await db.all(
        `SELECT * FROM wishes WHERE familyId = ? AND type = 'lottery' AND id IN (${placeholders})`,
        familyId, ...activeIds
    );
    if (selectedPrizes.length !== 8) {
        return res.status(400).json({ message: '所选奖品不存在或不属于当前家庭，请刷新后重新选择' });
    }
    try {
        selectedPrizes.forEach(normalizeLotteryPrize);
    } catch (err: any) {
        return res.status(400).json({ message: err.message });
    }

    await withTransaction(async () => {
        await db.run('UPDATE wishes SET isActive = 0 WHERE familyId = ? AND type = ?', familyId, 'lottery');
        await db.run(
            `UPDATE wishes SET isActive = 1 WHERE familyId = ? AND type = 'lottery' AND id IN (${placeholders})`,
            familyId, ...activeIds
        );
    });

    res.json({ message: 'ok' });
});
app.get('/api/parent/privileges', protect, async (req: any, res) => { const request = req as AuthRequest; res.json(await getDb().all('SELECT * FROM privileges WHERE familyId = ?', request.user!.familyId)); });
app.post('/api/parent/privileges', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const { title, description, cost, icon, level, timeWindow, category } = request.body;
    await getDb().run(
        `INSERT INTO privileges (id, familyId, title, description, cost, icon, level, timeWindow, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(), request.user!.familyId, title, description, cost, icon || '👑', level || 'bronze', timeWindow || null, category || '其他'
    );
    res.json({message:'ok'});
});
app.put('/api/parent/privileges/:id', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const { title, description, cost, icon, level, timeWindow, category } = req.body;
    await getDb().run(
        'UPDATE privileges SET title = ?, description = ?, cost = ?, icon = ?, level = ?, timeWindow = ?, category = ? WHERE id = ? AND familyId = ?',
        title, description, cost, icon || '👑', level || 'bronze', timeWindow || null, category || '其他', req.params.id, request.user!.familyId
    );
    res.json({ message: '更新成功' });
});
app.delete('/api/parent/privileges/:id', protect, async (req: any, res) => { const request = req as AuthRequest; await getDb().run('DELETE FROM privileges WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId); res.json({message:'ok'}); });

app.get('/api/parent/achievements', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    await ensureExploreAchievementDefs(db, request.user!.familyId); // P3：按需补齐新增探索/高光成就，老家庭也能看到并颁发
    // 传 childId：按该孩子返回三态（已解锁/已领取/进行中+进度），用于家长端正确显示完成状态
    const childId = typeof req.query.childId === 'string' ? req.query.childId : '';
    if (childId) {
        const child = await db.get('SELECT id FROM users WHERE id = ? AND familyId = ? AND role = "child"', childId, request.user!.familyId);
        if (!child) return res.status(404).json({ message: '孩子不存在' });
        return res.json(await computeChildAchievements(db, childId, request.user!.familyId));
    }
    // 不传 childId：保持原行为（家庭成就定义列表）
    const rows = await db.all('SELECT * FROM achievement_defs WHERE familyId = ?', request.user!.familyId);
    res.json(sortAchievementRows(rows));
});
app.post('/api/parent/achievements', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const { title, description, icon, conditionType, conditionValue, conditionCategory, category, rewardCoins, rewardXp, rewardPrivilegePoints, rewardDelivery } = request.body;

    // 检查是否已存在同名成就
    const existing = await getDb().get(
        'SELECT id FROM achievement_defs WHERE familyId = ? AND title = ?',
        request.user!.familyId, title
    );
    if (existing) {
        return res.status(400).json({ message: '已存在同名成就，请使用其他名称' });
    }

    const id = randomUUID();
    const displayCategory = category || inferAchievementCategory({ title, description, conditionType, conditionCategory });
    await getDb().run(
        `INSERT INTO achievement_defs (id, familyId, title, description, icon, conditionType, conditionValue, conditionCategory, category, rewardCoins, rewardXp, rewardPrivilegePoints, rewardDelivery) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, request.user!.familyId, title, description, icon,
        conditionType, conditionValue, conditionCategory || null, displayCategory,
        Math.max(0, Number(rewardCoins || 0)), Math.max(0, Number(rewardXp || 0)), Math.max(0, Number(rewardPrivilegePoints || 0)),
        rewardDelivery === 'backpack' ? 'backpack' : 'instant'
    );
    res.json({message:'ok', id});
});
app.put('/api/parent/achievements/:id', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const { title, description, icon, conditionType, conditionValue, conditionCategory, category, rewardCoins, rewardXp, rewardPrivilegePoints, rewardDelivery } = request.body;
    const displayCategory = category || inferAchievementCategory({ title, description, conditionType, conditionCategory });
    await getDb().run(
        `UPDATE achievement_defs SET title = ?, description = ?, icon = ?, conditionType = ?, conditionValue = ?, conditionCategory = ?, category = ?, rewardCoins = ?, rewardXp = ?, rewardPrivilegePoints = ?, rewardDelivery = ? WHERE id = ? AND familyId = ?`,
        title, description, icon, conditionType, conditionValue, conditionCategory || null, displayCategory,
        Math.max(0, Number(rewardCoins || 0)), Math.max(0, Number(rewardXp || 0)), Math.max(0, Number(rewardPrivilegePoints || 0)),
        rewardDelivery === 'backpack' ? 'backpack' : 'instant',
        req.params.id, request.user!.familyId
    );
    res.json({message:'ok'});
});
app.delete('/api/parent/achievements/:id', protect, async (req: any, res) => { const request = req as AuthRequest; await getDb().run('DELETE FROM achievement_defs WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId); res.json({message:'ok'}); });
app.post('/api/parent/achievements/:id/award', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const { childId } = request.body;
    const familyId = request.user!.familyId;
    const achievement = await db.get('SELECT * FROM achievement_defs WHERE id = ?', req.params.id);
    if (!achievement) return res.status(404).json({ message: '成就不存在' });
    if (achievement.familyId !== familyId) return res.status(403).json({ message: '无权颁发此成就' });

    const child = await db.get('SELECT id FROM users WHERE id = ? AND familyId = ? AND role = ?', childId, familyId, 'child');
    if (!child) return res.status(400).json({ message: '孩子成员不存在' });

    const existing = await db.get('SELECT id FROM user_achievements WHERE childId = ? AND achievementId = ?', childId, achievement.id);
    if (existing) return res.status(400).json({ message: '该孩子已获得此成就' });

    const rewardCoins = Math.max(0, Number(achievement.rewardCoins || 0));
    const rewardXp = Math.max(0, Number(achievement.rewardXp || 0));
    const rewardPrivilegePoints = Math.max(0, Number(achievement.rewardPrivilegePoints || 0));

    try {
        await db.run('BEGIN');
        await db.run(
            'INSERT INTO user_achievements (id, childId, achievementId, unlockedAt) VALUES (?, ?, ?, ?)',
            randomUUID(), childId, achievement.id, new Date().toISOString()
        );
        await db.run('COMMIT');
        res.json({ message: '颁发成功，奖励等待孩子领取', rewardCoins, rewardXp, rewardPrivilegePoints });
    } catch (error) {
        await db.run('ROLLBACK');
        console.error('颁发成就失败:', error);
        res.status(500).json({ message: '颁发失败，请重试' });
    }
});

// Child
app.get('/api/child/dashboard', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb(); const childId = request.user!.id;
    await finalizeOverdueTaskSessions(db, { familyId: request.user!.familyId, childId });

    // 支持日期参数，用于历史回看
    const dateParam = req.query.date as string;
    const targetDate = dateParam ? new Date(dateParam + 'T00:00:00') : new Date();

    // R1 性能：先构造 7 天日期，再把全部只读查询合并为一批并行执行（原 7天×3 查询串行）
    const today = new Date(); const last7Dates: string[] = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        last7Dates.push(getLocalDateString(d));
    }

    const [tasks, childInfoRaw, recentReviews, dayStatRows] = await Promise.all([
        // 获取指定日期的任务（使用新函数）
        getTasksForDate(db, request.user!.familyId, childId, targetDate),
        // 获取孩子数据（字段白名单：剥离 password/pin 哈希）
        db.get('SELECT * FROM users WHERE id = ?', childId),
        // B3-5: 最近24小时审核结果（用于即时通知）
        db.all(
          `SELECT te.id, te.status, te.earnedCoins, te.earnedXp, te.reviewedAt, te.reviewNote, t.title as taskTitle, t.category
           FROM task_entries te JOIN tasks t ON te.taskId = t.id
           WHERE te.childId = ? AND te.status IN ('approved', 'rejected') AND te.reviewedAt IS NOT NULL
             AND te.reviewedAt > datetime('now', '-24 hours')
           ORDER BY te.reviewedAt DESC LIMIT 10`,
          childId
        ),
        // 每天 3 个统计（当日收入 / 商店消耗（只统计金币购买） / 惩罚扣款）× 7 天，21 个查询一次并行
        Promise.all(last7Dates.map((dateStr) => Promise.all([
            db.get(`SELECT COALESCE(sum(earnedCoins), 0) as s FROM task_entries WHERE childId = ? AND status = 'approved' AND date(submittedAt, '+8 hours') = ?`, childId, dateStr),
            db.get(`SELECT COALESCE(sum(cost), 0) as s FROM user_inventory WHERE childId = ? AND costType = 'coins' AND status != 'cancelled' AND date(acquiredAt, '+8 hours') = ?`, childId, dateStr),
            db.get(`SELECT COALESCE(sum(deductedCoins), 0) as s FROM punishment_records WHERE childId = ? AND date(createdAt, '+8 hours') = ?`, childId, dateStr),
        ]))),
    ]);

    // 统计过去7天数据（组装并行查询结果，结构与原串行版本完全一致）
    const last7Days = last7Dates.map((dateStr, i) => {
        const [dayEarnedRow, dayShopSpentRow, dayPunishmentRow] = dayStatRows[i];
        const dayEarned = dayEarnedRow?.s || 0;
        const dayShopSpent = dayShopSpentRow?.s || 0;
        const dayPunishment = dayPunishmentRow?.s || 0;
        const daySpent = dayShopSpent + dayPunishment;
        return { date: dateStr, earned: dayEarned, spent: daySpent, coins: dayEarned - daySpent };
    });

    const isToday = getLocalDateString(targetDate) === getLocalDateString(today);

    // 游戏票预告（gameTicketPreviewMinutes，仅展示、不发放）：口径与审核发放 grantMorningStartupGameTickets 一致——
    // 早晨启动类任务审核通过后每天首次固定 +1 分钟（基础档，不含连续3天达成的额外奖励），
    // 同样经 getScreenTimeGrantResult 按当日上限收口；当天已发过则预告为 0。
    // 学习类「节省时间换票」取决于实际用时（节省分钟 × 系数），最低保证档为 0，故不做数字预告，
    // 仅按发放口径（grantStudySavedGameTickets：规则开启 + studySavedTimeEnabled + 有预计时长）用 gameTicketEarnBySpeed 标记资格。
    let morningTicketPreviewMinutes = 0;
    if (isToday && tasks.some((task: any) => normalizeRewardCategory(task.category) === MORNING_STARTUP_CATEGORY)) {
        try {
            const screenRules = await getOrCreateScreenTimeRules(db, request.user!.familyId);
            if (Boolean(screenRules?.isEnabled)) {
                const morningGrantedToday = await db.get(
                    `SELECT id
                       FROM screen_time_ledger
                      WHERE familyId = ? AND childId = ? AND source = ?
                        AND date(createdAt, '+8 hours') = date('now', '+8 hours')
                      LIMIT 1`,
                    request.user!.familyId,
                    childId,
                    SCREEN_TIME_SOURCES.MORNING_STARTUP
                );
                if (!morningGrantedToday) {
                    const previewGrant = await getScreenTimeGrantResult(db, request.user!.familyId, childId, 1, SCREEN_TIME_SOURCES.MORNING_STARTUP, 'morning_startup_list_preview');
                    morningTicketPreviewMinutes = previewGrant.grantedMinutes;
                }
            }
        } catch (err) {
            console.error('游戏票预告计算失败:', err);
        }
    }
    let studySavedTicketEnabled = false;
    if (tasks.some((task: any) => normalizeRewardCategory(task.category) === '学习')) {
        try {
            const screenRules = await getOrCreateScreenTimeRules(db, request.user!.familyId);
            studySavedTicketEnabled = Boolean(screenRules?.isEnabled) && Number(screenRules?.studySavedTimeEnabled ?? 1) === 1;
        } catch (err) {
            console.error('学习省时游戏票资格计算失败:', err);
        }
    }
    const tasksWithTicketPreview = tasks.map((task: any) => ({
        ...task,
        gameTicketPreviewMinutes: normalizeRewardCategory(task.category) === MORNING_STARTUP_CATEGORY ? morningTicketPreviewMinutes : 0,
        gameTicketEarnBySpeed: studySavedTicketEnabled && normalizeRewardCategory(task.category) === '学习' && Math.round(Number(task.durationMinutes || 0)) > 0,
    }));

    const childInfo = childInfoRaw ? serializeAuthMember(childInfoRaw) : childInfoRaw;
    if (childInfo) {
        // 等级根据XP实时计算：每100XP升一级
        childInfo.level = Math.floor((childInfo.xp || 0) / 100) + 1;
        // maxXp为下一级所需经验 (当前级别 * 100)
        childInfo.maxXp = childInfo.level * 100;
    }

    res.json({
        child: childInfo,
        tasks: tasksWithTicketPreview,
        weeklyStats: last7Days,
        viewingDate: getLocalDateString(targetDate),
        isToday,
        recentReviews,
        // 低电量模式：始终按真实“今天”（北京时间）判断，与历史回看的 viewingDate 无关
        lowEnergyToday: Boolean(childInfoRaw?.lowEnergyDate && childInfoRaw.lowEnergyDate === getLocalDateString())
    });
});

// 专注可视化卡：本周（周一起，北京时间）与上周专注分钟对比。
// 数据源只取 task_sessions：完成流程会同步生成 task_entries（taskEntryId 回链），两表完全重叠，叠加会重复计数。
// completed 取真实起止差值；auto_completed 是系统按任务常规时长代提交、endedAt 被写成当天结束，差值失真，按常规时长计。
app.get('/api/child/focus-stats', protect, requireChild, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const childId = request.user!.id;

    const now = new Date();
    const daysSinceMonday = (getBeijingDate(now).getDay() + 6) % 7;
    const thisWeekStart = getLocalDateString(new Date(now.getTime() - daysSinceMonday * 86400000));
    const lastWeekStart = getLocalDateString(new Date(now.getTime() - (daysSinceMonday + 7) * 86400000));

    const rows = await db.all(
        `SELECT ts.status, ts.startedAt, ts.endedAt, COALESCE(t.durationMinutes, 1) as plannedMinutes,
                date(ts.startedAt, '+8 hours') as beijingDay
         FROM task_sessions ts
         LEFT JOIN tasks t ON ts.taskId = t.id
         WHERE ts.childId = ? AND ts.status IN ('completed', 'auto_completed') AND ts.endedAt IS NOT NULL
           AND date(ts.startedAt, '+8 hours') >= ?`,
        childId, lastWeekStart
    );

    let thisWeekMinutes = 0;
    let lastWeekMinutes = 0;
    let longestSessionMinutes = 0;
    let sessionsCount = 0;
    for (const row of rows) {
        let minutes: number;
        if (row.status === 'completed') {
            const elapsedMs = new Date(row.endedAt).getTime() - new Date(row.startedAt).getTime();
            minutes = Number.isFinite(elapsedMs) ? Math.max(1, Math.round(elapsedMs / 60000)) : 1;
        } else {
            minutes = Math.max(1, Math.round(Number(row.plannedMinutes) || 1));
        }
        if (row.beijingDay >= thisWeekStart) {
            thisWeekMinutes += minutes;
            sessionsCount += 1;
            if (minutes > longestSessionMinutes) longestSessionMinutes = minutes;
        } else {
            lastWeekMinutes += minutes;
        }
    }

    res.json({ thisWeekMinutes, lastWeekMinutes, longestSessionMinutes, sessionsCount });
});

// 低电量模式：当天一键开关，写入/清空 users.lowEnergyDate；不扣任何东西，次日自动恢复
app.post('/api/child/low-energy/toggle', protect, requireChild, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const childId = request.user!.id;
    const today = getLocalDateString();
    const user = await db.get('SELECT lowEnergyDate FROM users WHERE id = ?', childId);
    if (!user) return res.status(404).json({ message: '用户不存在' });
    const active = user.lowEnergyDate !== today;
    await db.run('UPDATE users SET lowEnergyDate = ? WHERE id = ?', active ? today : null, childId);
    res.json({ active });
});
app.post('/api/child/tasks/:taskId/start', protect, requireChild, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const taskId = req.params.taskId;
    const childId = request.user!.id;
    const familyId = request.user!.familyId;

    await finalizeOverdueTaskSessions(db, { familyId, childId });
    const today = getLocalDateString();

    const task = await db.get(
        'SELECT * FROM tasks WHERE id = ? AND familyId = ? AND isEnabled = 1',
        taskId, familyId
    );
    if (!task) return res.status(404).json({ message: '任务不存在或已停用' });

    const existingEntry = await db.get(
        `SELECT id, status FROM task_entries
         WHERE taskId = ? AND childId = ?
         AND date(submittedAt, '+8 hours') = ?
         ORDER BY submittedAt DESC
         LIMIT 1`,
        taskId, childId, today
    );
    if (existingEntry && existingEntry.status !== 'rejected') {
        return res.status(409).json({ message: '今天已经提交过这个任务，请明天再挑战', entryId: existingEntry.id, status: existingEntry.status });
    }

    const runningSessions = await db.all(
        `SELECT ts.*, t.title, t.isParallel
         FROM task_sessions ts
         JOIN tasks t ON ts.taskId = t.id
         WHERE ts.familyId = ? AND ts.childId = ? AND ts.status = 'running'
         AND date(ts.startedAt, '+8 hours') = ?`,
        familyId, childId, today
    );
    const existingSession = runningSessions.find((s: any) => s.taskId === taskId);
    if (existingSession) return res.json({ session: existingSession });

    const blockingSession = runningSessions.find((s: any) => !Boolean(s.isParallel) || !Boolean(task.isParallel));
    if (blockingSession) {
        return res.status(409).json({ message: `请先完成正在进行的任务「${blockingSession.title}」` });
    }

    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();
    await db.run(
        `INSERT INTO task_sessions (id, familyId, taskId, childId, status, startedAt)
         VALUES (?, ?, ?, ?, 'running', ?)`,
        sessionId, familyId, taskId, childId, startedAt
    );
    res.json({ session: { id: sessionId, familyId, taskId, childId, status: 'running', startedAt } });
});

app.post('/api/child/tasks/:taskId/abandon', protect, requireChild, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const taskId = req.params.taskId;
    const childId = request.user!.id;
    const familyId = request.user!.familyId;
    const today = getLocalDateString();
    await finalizeOverdueTaskSessions(db, { familyId, childId });

    const runningSession = await db.get(
        `SELECT * FROM task_sessions
         WHERE familyId = ? AND taskId = ? AND childId = ? AND status = 'running'
         AND date(startedAt, '+8 hours') = ?
         ORDER BY startedAt DESC
         LIMIT 1`,
        familyId, taskId, childId, today
    );
    if (!runningSession) return res.status(409).json({ message: '没有找到今天正在进行的任务。' });

    await db.run(
        `UPDATE task_sessions
         SET status = 'abandoned', endedAt = ?
         WHERE id = ? AND taskId = ? AND childId = ? AND status = 'running'
         AND date(startedAt, '+8 hours') = ?`,
        new Date().toISOString(), runningSession.id, taskId, childId, today
    );
    res.json({ message: 'abandoned' });
});

app.post('/api/child/tasks/:taskId/complete', protect, requireChild, async (req: any, res) => {
    const request = req as AuthRequest;
    const { duration, isOverdue } = req.body;
    const db = getDb();
    const taskId = req.params.taskId;
    const childId = request.user!.id;
    const familyId = request.user!.familyId;
    const now = new Date().toISOString();
    const today = getLocalDateString();
    await finalizeOverdueTaskSessions(db, { familyId, childId });

    const runningSession = await db.get(
        `SELECT * FROM task_sessions
         WHERE familyId = ? AND taskId = ? AND childId = ? AND status = 'running'
         AND date(startedAt, '+8 hours') = ?
         ORDER BY startedAt DESC
         LIMIT 1`,
        familyId, taskId, childId, today
    );
    if (!runningSession) {
        return res.status(409).json({ message: '没有找到今天正在进行的任务，请重新开始后再提交。' });
    }

    const task = await db.get(
        'SELECT * FROM tasks WHERE id = ? AND familyId = ? AND isEnabled = 1',
        taskId, familyId
    );
    if (!task) return res.status(404).json({ message: '任务不存在或已停用' });

    // 检查今天是否已有记录，避免重复提交/重复触发奖励
    const existingEntry = await db.get(
        `SELECT id, status FROM task_entries
         WHERE taskId = ? AND childId = ?
         AND date(submittedAt, '+8 hours') = ?
         ORDER BY submittedAt DESC
         LIMIT 1`,
        taskId, childId, today
    );

    let entryId: string;

    if (existingEntry && existingEntry.status !== 'rejected') {
        return res.status(409).json({ message: '今天已经提交过该任务，请勿重复提交', entryId: existingEntry.id, status: existingEntry.status });
    }

    if (existingEntry) {
        // 更新被退回的记录
        entryId = existingEntry.id;
        await db.run(
            `UPDATE task_entries SET status = 'pending', submittedAt = ?, actualDurationMinutes = ?, isOverdue = ?, autoCompleted = 0, autoCompleteReason = NULL WHERE id = ?`,
            now, duration || 0, isOverdue ? 1 : 0, entryId
        );
        console.log(`📝 孩子 ${childId} 重新提交任务 ${taskId}，更新记录 ${entryId}，超时状态：${isOverdue}`);
    } else {
        // 创建新记录
        entryId = randomUUID();
        await db.run(
            `INSERT INTO task_entries (id, taskId, childId, status, submittedAt, actualDurationMinutes, isOverdue, autoCompleted) VALUES (?, ?, ?, 'pending', ?, ?, ?, 0)`,
            entryId, taskId, childId, now, duration || 0, isOverdue ? 1 : 0
        );
        console.log(`📝 孩子 ${childId} 提交任务 ${taskId}，创建记录 ${entryId}，状态：pending，超时状态：${isOverdue}`);
    }

    // 验证记录已创建
    await db.run(
        `UPDATE task_sessions
         SET status = 'completed', endedAt = ?, taskEntryId = ?
         WHERE id = ? AND childId = ? AND taskId = ? AND status = 'running'
         AND date(startedAt, '+8 hours') = ?`,
        now, entryId, runningSession.id, childId, taskId, today
    );

    const verifyEntry = await db.get('SELECT id, status, submittedAt, isOverdue FROM task_entries WHERE id = ?', entryId);
    if (verifyEntry) {
        console.log(`✅ 任务提交成功，记录ID：${verifyEntry.id}，状态：${verifyEntry.status}，超时：${verifyEntry.isOverdue}`);
    } else {
        console.error(`❌ 任务提交失败，记录未找到！`);
    }

    // 宝箱触发逻辑：完成任务即时反馈，奖品价值按任务难度分层
    let chestReward: any = null;
    try {
      let difficulty: 'easy' | 'medium' | 'hard' = 'easy';
      if (task.durationMinutes > 45) difficulty = 'hard';
      else if (task.durationMinutes > 20) difficulty = 'medium';

      const trigger = await getChestTriggerResult(db, request.user!.familyId, childId, difficulty);
      if (trigger.triggered) {
        const reward = await drawChestReward(db, request.user!.familyId, difficulty);
        if (reward) {
          chestReward = reward;
          if (reward.type === 'coins') await db.run('UPDATE users SET coins = coins + ? WHERE id = ?', reward.value, childId);
          else if (reward.type === 'xp') await db.run('UPDATE users SET xp = xp + ? WHERE id = ?', reward.value, childId);
          else if (reward.type === 'privilegePoints') await db.run('UPDATE users SET privilegePoints = privilegePoints + ? WHERE id = ?', reward.value, childId);
          else if (reward.type === 'lotteryTicket') {
            await db.run(`INSERT INTO user_inventory (id, childId, title, icon, cost, costType, source, status) VALUES (?, ?, ?, ?, ?, 'coins', 'lottery_ticket', 'pending')`, randomUUID(), childId, `抽奖券(${reward.value}张)`, reward.icon || '🎫', reward.value);
          }
          await recordChestReward(db, {
            childId,
            familyId: request.user!.familyId,
            taskEntryId: entryId,
            reward,
            status: 'granted'
          });
        }
      }
    } catch (err) { console.error('宝箱触发出错:', err); }

    let gameTicketPreview: any = null;
    try {
      const reviewCategory = normalizeRewardCategory(task.category);
      const rules = await getOrCreateScreenTimeRules(db, familyId);
      if (Boolean(rules?.isEnabled) && reviewCategory === '学习' && Number(rules?.studySavedTimeEnabled ?? 1) === 1) {
        const expected = Math.max(0, Math.round(Number(task.durationMinutes || 0)));
        const actual = Math.max(0, Math.ceil(Number(duration || 0)));
        const savedMinutes = Math.max(0, Math.floor(expected - actual));
        const ratio = Math.max(0, Math.min(2, Number(rules.studySavedTimeRatio ?? 1) || 1));
        const requestedMinutes = Math.max(0, Math.floor(savedMinutes * ratio));
        if (requestedMinutes > 0) {
          gameTicketPreview = await getScreenTimeGrantResult(
            db,
            familyId,
            childId,
            requestedMinutes,
            SCREEN_TIME_SOURCES.STUDY_SAVED_TIME,
            'study_saved_time_preview'
          );
          gameTicketPreview.label = '学习节省游戏票';
          gameTicketPreview.awardTiming = 'after_parent_approval';
        }
      } else if (Boolean(rules?.isEnabled) && reviewCategory === MORNING_STARTUP_CATEGORY) {
        const existingToday = await db.get(
          `SELECT id
             FROM screen_time_ledger
            WHERE familyId = ? AND childId = ? AND source = ?
              AND date(createdAt, '+8 hours') = date('now', '+8 hours')
            LIMIT 1`,
          familyId,
          childId,
          SCREEN_TIME_SOURCES.MORNING_STARTUP
        );
        if (!existingToday) {
          gameTicketPreview = await getScreenTimeGrantResult(
            db,
            familyId,
            childId,
            1,
            SCREEN_TIME_SOURCES.MORNING_STARTUP,
            'morning_startup_preview'
          );
          gameTicketPreview.label = '早晨启动游戏票';
          gameTicketPreview.awardTiming = 'after_parent_approval';
        }
      }
    } catch (err) {
      console.error('游戏票预估失败:', err);
    }

    res.json({ message: 'submitted', entryId, chest: chestReward, gameTicketPreview });
});

app.get('/api/child/task-session-reminders', protect, requireChild, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    await finalizeOverdueTaskSessions(db, { familyId: request.user!.familyId, childId: request.user!.id });
    const rows = await db.all(
        `SELECT ts.id, ts.taskId, ts.startedAt, ts.endedAt, ts.autoCompletedAt, ts.taskEntryId,
                t.title, t.icon, t.durationMinutes, te.submittedAt, te.autoCompleteReason
         FROM task_sessions ts
         JOIN tasks t ON ts.taskId = t.id
         LEFT JOIN task_entries te ON ts.taskEntryId = te.id
         WHERE ts.childId = ? AND ts.status = 'auto_completed' AND ts.reminderReadAt IS NULL
         ORDER BY ts.autoCompletedAt DESC
         LIMIT 5`,
        request.user!.id
    );
    res.json(rows);
});

app.post('/api/child/task-session-reminders/:id/read', protect, requireChild, async (req: any, res) => {
    const request = req as AuthRequest;
    await getDb().run(
        `UPDATE task_sessions SET reminderReadAt = ?
         WHERE id = ? AND childId = ? AND status = 'auto_completed'`,
        new Date().toISOString(), req.params.id, request.user!.id
    );
    res.json({ message: 'ok' });
});

app.get('/api/parent/task-session-reminders', protect, requireParent, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    await finalizeOverdueTaskSessions(db, { familyId: request.user!.familyId });
    const rows = await db.all(
        `SELECT ts.id, ts.taskId, ts.childId, ts.startedAt, ts.endedAt, ts.autoCompletedAt, ts.taskEntryId,
                t.title, t.icon, t.durationMinutes, u.name as childName, te.submittedAt, te.autoCompleteReason
         FROM task_sessions ts
         JOIN tasks t ON ts.taskId = t.id
         JOIN users u ON ts.childId = u.id
         LEFT JOIN task_entries te ON ts.taskEntryId = te.id
         WHERE ts.familyId = ? AND ts.status = 'auto_completed' AND ts.parentReminderReadAt IS NULL
         ORDER BY ts.autoCompletedAt DESC
         LIMIT 20`,
        request.user!.familyId
    );
    res.json(rows);
});

app.post('/api/parent/task-session-reminders/:id/read', protect, requireParent, async (req: any, res) => {
    const request = req as AuthRequest;
    await getDb().run(
        `UPDATE task_sessions SET parentReminderReadAt = ?
         WHERE id = ? AND familyId = ? AND status = 'auto_completed'`,
        new Date().toISOString(), req.params.id, request.user!.familyId
    );
    res.json({ message: 'ok' });
});

app.post('/api/child/wishes/:id/redeem', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const wish = await db.get('SELECT * FROM wishes WHERE id = ? AND familyId = ? AND type = ?', req.params.id, request.user!.familyId, 'shop');
    if (!wish) return res.status(404).json({message:'商品不存在'});
    // stock: null/undefined/负数 表示无限库存，0 表示无库存
    if (wish.stock === 0) return res.status(400).json({message:'库存不足'});

    const user = await db.get('SELECT coins FROM users WHERE id = ?', request.user!.id);
    if(user.coins < wish.cost) return res.status(400).json({message:'金币不足'});

    try {
        await withTransaction(async () => {
            // 守卫式扣减：余额不足时不生效，防止并发连点扣成负数
            const deduct = await db.run('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?', wish.cost, request.user!.id, wish.cost);
            if ((deduct.changes || 0) !== 1) throw Object.assign(new Error('金币不足'), { statusCode: 400 });
            // 只有 stock > 0 时才减库存（null/-1 表示无限库存）；SQL 内守卫防止减到负数
            if(wish.stock !== null && wish.stock !== -1 && wish.stock > 0) {
                const st = await db.run('UPDATE wishes SET stock = stock - 1 WHERE id = ? AND stock > 0', wish.id);
                if ((st.changes || 0) !== 1) throw Object.assign(new Error('库存不足'), { statusCode: 400 });
            }
            // 商店商品添加到背包，记录是用金币兑换的，来源为shop
            await db.run(`INSERT INTO user_inventory (id, childId, wishId, title, icon, cost, costType, source, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
                randomUUID(), request.user!.id, wish.id, wish.title, wish.icon, wish.cost, 'coins', 'shop');
        });
        res.json({message:'兑换成功！已放入背包'});
    } catch (err: any) {
        const sc = err.statusCode || 500;
        if (sc === 500) console.error('兑换失败:', err);
        return res.status(sc).json({message: err.message || '兑换失败，请重试'});
    }
});
// 背包列表（联表 wishes 返回 effectType，用于过滤即时结算流水）
app.get('/api/child/inventory', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const rows = await db.all(`
      SELECT ui.*, w.effectType
      FROM user_inventory ui
      LEFT JOIN wishes w ON ui.wishId = w.id
      WHERE ui.childId = ?
        AND NOT (ui.status = 'used' AND w.effectType = 'draw_again')
      ORDER BY ui.acquiredAt DESC
    `, request.user!.id);
    res.json(rows.filter(isLotteryInventoryVisible));
});
// 撤销兑换（退还金币或特权点）- 抽奖物品和储蓄达成物品不可撤销，每类商品最多撤销一次
app.post('/api/child/inventory/:id/cancel', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const item = await db.get('SELECT * FROM user_inventory WHERE id = ? AND childId = ?', req.params.id, request.user!.id);
    if (!item) return res.status(404).json({message: '物品不存在'});
    if (item.status === 'cancelled' || item.status === 'returned') return res.status(400).json({message: '已撤销'});
    if (item.status === 'redeemed' || item.status === 'used') return res.status(400).json({message: '已兑现的物品无法撤销'});
    if (item.status === 'transferring') return res.status(400).json({message: '转赠中的物品无法撤销'});
    // 仅允许孩子撤销金币商店购买的物品，避免对抽奖、储蓄、成就、特权等奖励反复反悔
    if (item.source !== 'shop' || item.costType !== 'coins') {
      return res.status(400).json({message: '只有金币购买的商店商品可以撤销'});
    }
    if (Number(item.cancelCount || 0) >= 1) {
      return res.status(400).json({message: '这个物品已经用过一次撤销机会'});
    }

    // 检查同类商品是否已撤销过（每类商品最多只能撤销一次）
    if (item.wishId) {
        const cancelledSameItem = await db.get(
            `SELECT id FROM user_inventory WHERE childId = ? AND wishId = ? AND status = 'cancelled'`,
            request.user!.id, item.wishId
        );
        if (cancelledSameItem) {
            return res.status(400).json({message: '该商品已撤销过一次，不能重复撤销'});
        }
    }
    if (item.privilegeId) {
        const cancelledSamePriv = await db.get(
            `SELECT id FROM user_inventory WHERE childId = ? AND privilegeId = ? AND status = 'cancelled'`,
            request.user!.id, item.privilegeId
        );
        if (cancelledSamePriv) {
            return res.status(400).json({message: '该特权已撤销过一次，不能重复撤销'});
        }
    }

    const costType = item.costType || 'coins'; // 兼容旧数据，默认为金币
    try {
        await withTransaction(async () => {
            // 状态守卫：防止双击并发导致重复退款
            const upd = await db.run(
                "UPDATE user_inventory SET status = 'cancelled', cancelCount = COALESCE(cancelCount, 0) + 1 WHERE id = ? AND status = ?",
                req.params.id, item.status
            );
            if ((upd.changes || 0) !== 1) throw Object.assign(new Error('物品状态已变化，请刷新后重试'), { statusCode: 409 });

            if (costType === 'privilegePoints') {
                // 退还特权点
                await db.run('UPDATE users SET privilegePoints = privilegePoints + ? WHERE id = ?', item.cost, request.user!.id);
            } else {
                // 退还金币
                await db.run('UPDATE users SET coins = coins + ? WHERE id = ?', item.cost, request.user!.id);
                // 恢复库存（只有商店商品需要恢复库存）
                if (item.wishId) {
                    await db.run('UPDATE wishes SET stock = stock + 1 WHERE id = ? AND stock >= 0', item.wishId);
                }
            }
        });
        res.json({
            message: costType === 'privilegePoints' ? '已撤销，特权点已退回' : '已撤销，金币已退回'
        });
    } catch (err: any) {
        const sc = err.statusCode || 500;
        if (sc === 500) console.error('撤销失败:', err);
        return res.status(sc).json({ message: err.message || '撤销失败，请重试' });
    }
});

// 兑现物品/服务
app.post('/api/child/inventory/:id/redeem', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const item = await db.get('SELECT * FROM user_inventory WHERE id = ? AND childId = ?', req.params.id, request.user!.id);
    if (!item) return res.status(404).json({message: '物品不存在'});
    if (item.status === 'redeemed' || item.status === 'used') return res.status(400).json({message: '已兑现'});
    if (item.status === 'cancelled' || item.status === 'returned') return res.status(400).json({message: '已撤销的物品无法兑现'});

    // 抽奖券/免费抽奖/双倍卡在抽奖时自动使用，禁止手动兑现（防止白白消耗）
    if (item.source === 'lottery_ticket') {
        return res.status(400).json({ message: '这是抽奖券，去抽奖时会自动使用，不用手动兑现哦' });
    }
    if (item.wishId) {
        const effRow = await db.get('SELECT effectType FROM wishes WHERE id = ?', item.wishId);
        if (effRow && (effRow.effectType === 'free_spin' || effRow.effectType === 'double_next')) {
            return res.status(400).json({ message: effRow.effectType === 'free_spin'
                ? '这是免费抽奖机会，去抽奖时会自动使用哦'
                : '这是双倍卡，下次抽中金币/经验/特权点奖励时会自动翻倍哦' });
        }
    }

    if (item.source === 'achievement_reward') {
        const rewardCoins = Math.max(0, Number(item.rewardCoins || 0));
        const rewardXp = Math.max(0, Number(item.rewardXp || 0));
        const rewardPrivilegePoints = Math.max(0, Number(item.rewardPrivilegePoints || 0));
        try {
            await withTransaction(async () => {
                // 状态守卫：防止双击并发重复领取奖励
                const upd = await db.run("UPDATE user_inventory SET status = 'redeemed', redeemedAt = ? WHERE id = ? AND status NOT IN ('redeemed','used','cancelled','returned')", new Date().toISOString(), req.params.id);
                if ((upd.changes || 0) !== 1) throw Object.assign(new Error('已兑现'), { statusCode: 400 });
                await db.run(
                    'UPDATE users SET coins = coins + ?, xp = xp + ?, privilegePoints = privilegePoints + ? WHERE id = ?',
                    rewardCoins, rewardXp, rewardPrivilegePoints, request.user!.id
                );
            });
        } catch (err: any) {
            const sc = err.statusCode || 500;
            if (sc === 500) console.error('成就礼包领取失败:', err);
            return res.status(sc).json({ message: err.message || '领取失败，请重试' });
        }
        return res.json({ message: '成就礼包已打开！', rewardCoins, rewardXp, rewardPrivilegePoints });
    }

    await db.run("UPDATE user_inventory SET status = 'redeemed', redeemedAt = ? WHERE id = ?", new Date().toISOString(), req.params.id);
    res.json({message:'兑现成功！'});
});

// 储蓄存入
app.post('/api/child/savings/deposit', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const { amount, goalId, wishId } = req.body;
    const db = getDb();

    const requestedAmount = Math.round(Number(amount || 0));
    if (!requestedAmount || requestedAmount <= 0) return res.status(400).json({ message: '存入金额无效' });

    const targetId = goalId || wishId || null;
    const savings = targetId
      ? await db.get("SELECT * FROM wishes WHERE id = ? AND familyId = ? AND type = 'savings'", targetId, request.user!.familyId)
      : await db.get(
          `SELECT * FROM wishes
            WHERE familyId = ? AND type = 'savings'
            ORDER BY CASE WHEN COALESCE(currentAmount, 0) >= COALESCE(targetAmount, 0) AND COALESCE(targetAmount, 0) > 0 THEN 1 ELSE 0 END ASC,
                     datetime(createdAt) ASC
            LIMIT 1`,
          request.user!.familyId
        );
    if (!savings) return res.status(404).json({ message: '没有储蓄目标' });

    const currentAmount = Number(savings.currentAmount || 0);
    const targetAmount = Number(savings.targetAmount || 0);
    if (targetAmount > 0 && currentAmount >= targetAmount) {
        return res.status(400).json({ message: '这个储蓄目标已经完成，请选择其他目标' });
    }

    const remainingAmount = targetAmount > 0 ? Math.max(0, targetAmount - currentAmount) : requestedAmount;
    const depositAmount = Math.min(requestedAmount, remainingAmount || requestedAmount);
    const user = await db.get('SELECT coins FROM users WHERE id = ?', request.user!.id);
    if (user.coins < depositAmount) return res.status(400).json({ message: '金币不足' });

    try {
        let goalAchieved = false;
        let newAmount = currentAmount;
        await withTransaction(async () => {
            // 守卫式扣减，防止并发把余额扣成负数
            const deduct = await db.run('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?', depositAmount, request.user!.id, depositAmount);
            if ((deduct.changes || 0) !== 1) throw Object.assign(new Error('金币不足'), { statusCode: 400 });
            // 相对增量更新，避免并发存入互相覆盖
            await db.run('UPDATE wishes SET currentAmount = COALESCE(currentAmount, 0) + ? WHERE id = ?', depositAmount, savings.id);
            newAmount = Number((await db.get('SELECT currentAmount FROM wishes WHERE id = ?', savings.id))?.currentAmount || 0);

            // 仅在本次存入跨过目标线时入包，防止重复发放
            if (targetAmount > 0 && newAmount >= targetAmount && newAmount - depositAmount < targetAmount) {
                goalAchieved = true;
                // 储蓄目标达成，免费获得，cost=0，source='savings'
                await db.run(`INSERT INTO user_inventory (id, childId, wishId, title, icon, cost, costType, source, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
                    randomUUID(), request.user!.id, savings.id, savings.title, savings.icon, 0, 'coins', 'savings');
            }
        });
        res.json({ message: goalAchieved ? '🎉 目标达成！已放入背包' : '存入成功', goalId: savings.id, newAmount, deposited: depositAmount, goalAchieved });
    } catch (err: any) {
        const sc = err.statusCode || 500;
        if (sc === 500) console.error('储蓄存入失败:', err);
        return res.status(sc).json({ message: err.message || '存入失败，请重试' });
    }
});

// --- 抽奖规则 ---
// 固定价格能降低孩子预期负担；每日次数限制避免屏幕/抽奖刺激过量。
const LOTTERY_FIXED_COST = 15;
const getLotteryCost = (): number => LOTTERY_FIXED_COST;

const getTodayPaidLotteryDrawCount = async (db: any, childId: string, date: string): Promise<number> => {
    const row = await db.get(
        `SELECT COUNT(*) as count FROM user_inventory
         WHERE childId = ? AND source = 'lottery' AND cost > 0 AND date(acquiredAt, '+8 hours') = ?`,
        childId, date
    );
    return Number(row?.count || 0);
};

app.get('/api/parent/lottery-settings', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    res.json(await getLotterySafetySettings(getDb(), request.user!.familyId));
});

app.put('/api/parent/lottery-settings', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    if (typeof req.body?.enabled !== 'boolean') {
        return res.status(400).json({ message: 'enabled 必须是布尔值' });
    }
    res.json(await setLotteryEnabled(getDb(), request.user!.familyId, req.body.enabled));
});

// 获取抽奖信息（当前费用、今日次数）
app.get('/api/child/lottery/info', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const today = getLocalDateString();
    await ensureSingleDrawAgainPrize(db, request.user!.familyId);

    const settings = await getLotterySafetySettings(db, request.user!.familyId);
    const todayCount = await getTodayPaidLotteryDrawCount(db, request.user!.id, today);

    const currentCost = getLotteryCost();
    const nextCost = currentCost;
    const remainingDraws = settings.enabled ? Math.max(0, settings.dailyPaidLimit - todayCount) : 0;

    const pityInfo = await getLotteryPityInfo(db, request.user!.id, request.user!.familyId);

    // 获取奖池奖品
    const prizes = await db.all(
        "SELECT * FROM wishes WHERE familyId = ? AND type = 'lottery' AND isActive = 1 AND (stock IS NULL OR stock = -1 OR stock > 0)",
        request.user!.familyId
    );

    let displayPrizes;
    try {
        displayPrizes = prizes.map(normalizeLotteryPrize);
    } catch (err: any) {
        return res.status(400).json({ message: err.message });
    }

    res.json({
        todayDrawCount: todayCount,
        todayPaidDrawCount: todayCount,
        currentCost,
        nextCost,
        lotteryEnabled: settings.enabled,
        dailyLimit: settings.dailyPaidLimit,
        remainingDraws,
        pity: pityInfo,
        prizes: displayPrizes
    });
});


// 愿望/商店 接口 (Child - 支持 type 筛选)
app.get('/api/child/wishes', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const type = req.query.type;
    const db = getDb();
    const familyId = request.user!.familyId;
    if (type === 'lottery' || !type) {
      await ensureSingleDrawAgainPrize(db, familyId);
    }

    if (type) {
        const rows = await db.all(
          `SELECT * FROM wishes WHERE familyId = ? AND type = ?
           ORDER BY CASE WHEN type = 'savings' AND COALESCE(currentAmount, 0) >= COALESCE(targetAmount, 0) AND COALESCE(targetAmount, 0) > 0 THEN 1 ELSE 0 END ASC,
                    datetime(createdAt) DESC`,
          familyId,
          type
        );
        return res.json(rows.map(withChildWishCategory));
    }

    res.json({
        savings: (await db.all("SELECT * FROM wishes WHERE familyId = ? AND type='savings' ORDER BY datetime(createdAt) DESC", familyId)).map(toChildWish),
        shop: (await db.all("SELECT * FROM wishes WHERE familyId = ? AND type='shop'", familyId)).map(withChildWishCategory),
        lottery: (await db.all("SELECT * FROM wishes WHERE familyId = ? AND type='lottery' AND isActive = 1", familyId)).map(withChildWishCategory)
    });
});

app.post('/api/child/lottery/play', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const today = getLocalDateString();
    await ensureSingleDrawAgainPrize(db, request.user!.familyId);

    const cost = getLotteryCost();
    // 余额校验移入事务内守卫式扣减；且持抽奖券时本次免费（券自动消费），不在此预检

    try {
        const result = await withTransaction(async () => {
            const settings = await getLotterySafetySettings(db, request.user!.familyId);
            if (!settings.enabled) assertPaidLotteryDrawAllowed(0, settings);
            const txPaidCount = await getTodayPaidLotteryDrawCount(db, request.user!.id, today);
            // 自动消费背包中的抽奖券/免费抽奖机会（M6：让宝箱抽奖券真正可用）
            const ticket = await db.get(`
                SELECT ui.id, ui.cost, ui.source, w.effectType
                FROM user_inventory ui
                LEFT JOIN wishes w ON ui.wishId = w.id
                WHERE ui.childId = ? AND ui.status = 'pending'
                  AND (w.effectType = 'free_spin' OR ui.source = 'lottery_ticket')
                ORDER BY ui.acquiredAt ASC LIMIT 1
            `, request.user!.id);
            let usedTicket = false;
            if (ticket) {
                if (ticket.source === 'lottery_ticket' && Number(ticket.cost || 1) > 1) {
                    // 多张合一的抽奖券：扣一张，同步标题
                    const remaining = Number(ticket.cost) - 1;
                    const upd = await db.run("UPDATE user_inventory SET cost = ?, title = ? WHERE id = ? AND status = 'pending' AND cost = ?",
                        remaining, `抽奖券(${remaining}张)`, ticket.id, ticket.cost);
                    usedTicket = (upd.changes || 0) === 1;
                } else {
                    const upd = await db.run("UPDATE user_inventory SET status = 'redeemed', redeemedAt = ? WHERE id = ? AND status = 'pending'",
                        new Date().toISOString(), ticket.id);
                    usedTicket = (upd.changes || 0) === 1;
                }
            }
            if (!usedTicket) {
                // 每日付费上限必须在事务开始后、扣币前检查，防止并发连点突破限制。
                assertPaidLotteryDrawAllowed(txPaidCount, settings);
                // 守卫式扣减：余额不足时 changes=0，防止并发连点扣成负数
                const deduct = await db.run('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?', cost, request.user!.id, cost);
                if ((deduct.changes || 0) !== 1) {
                    throw Object.assign(new Error(`金币不足，本次抽奖需要 ${cost} 金币`), { statusCode: 400 });
                }
            }
            // 抽奖 V2
            const drawRes = await drawPrizeCoreV2(db, request.user!.familyId, request.user!.id, usedTicket ? 0 : cost, 'lottery');
            return { ...drawRes, usedTicket };
        });

        const settings = await getLotterySafetySettings(db, request.user!.familyId);
        const actualCount = await getTodayPaidLotteryDrawCount(db, request.user!.id, today);
        const nextCost = getLotteryCost();
        const remainingDraws = settings.enabled ? Math.max(0, settings.dailyPaidLimit - actualCount) : 0;
        const pityInfo = await getLotteryPityInfo(db, request.user!.id, request.user!.familyId);

        res.json({
            winner: result.prize,
            cost: result.usedTicket ? 0 : cost,
            usedTicket: !!result.usedTicket,
            nextCost,
            todayDrawCount: actualCount,
            todayPaidDrawCount: actualCount,
            currentCost: cost,
            lotteryEnabled: settings.enabled,
            dailyLimit: settings.dailyPaidLimit,
            remainingDraws,
            isDrawAgain: result.isDrawAgain,
            isBonusCoins: result.isBonusCoins,
            bonusCoins: result.bonusCoins,
            isBonusXp: result.isBonusXp,
            bonusXp: result.bonusXp,
            isBonusPrivilegePoints: result.isBonusPrivilegePoints,
            bonusPrivilegePoints: result.bonusPrivilegePoints,
            isFreeSpin: result.isFreeSpin,
            isDoubleNext: result.isDoubleNext,
            isNothing: result.isNothing,
            pityTriggered: result.pityTriggered,
            pity: pityInfo
        });
    } catch (err: any) {
        const sc = err.statusCode || 500;
        if (sc === 500) console.error('抽奖失败:', err);
        return res.status(sc).json({ message: err.message || '抽奖失败，请重试' });
    }
});

// 「再抽一次」免费抽奖
app.post('/api/child/lottery/redraw', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const settings = await getLotterySafetySettings(db, request.user!.familyId);
    if (!settings.enabled) return res.status(400).json({ message: '家长已关闭抽奖' });
    await ensureSingleDrawAgainPrize(db, request.user!.familyId);

    // 验证用户最近一次抽奖确实是"再抽一次"奖品（status='used' 且 source='lottery' 或 'free_draw'）
    // 并且在5分钟内（防止滥用）
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const recentDrawAgain = await db.get(`
        SELECT ui.id, w.effectType
        FROM user_inventory ui
        JOIN wishes w ON ui.wishId = w.id
        WHERE ui.childId = ?
          AND ui.status = 'used'
          AND w.effectType = 'draw_again'
          AND ui.redeemedAt > ?
        ORDER BY ui.redeemedAt DESC
        LIMIT 1
    `, request.user!.id, fiveMinutesAgo);

    if (!recentDrawAgain) {
        return res.status(400).json({ message: '没有可用的再抽一次机会' });
    }

    try {
        // 消费与抽奖同事务：状态守卫防并发复用；抽奖失败回滚，机会不丢失
        const result = await withTransaction(async () => {
            const consume = await db.run("UPDATE user_inventory SET status = 'redeemed' WHERE id = ? AND status = 'used'", recentDrawAgain.id);
            if ((consume.changes || 0) !== 1) {
                throw Object.assign(new Error('没有可用的再抽一次机会'), { statusCode: 400 });
            }
            return await drawPrizeCoreV2(db, request.user!.familyId, request.user!.id, 0, 'free_draw');
        });
        const pityInfo = await getLotteryPityInfo(db, request.user!.id, request.user!.familyId);

        res.json({
            winner: result.prize,
            isDrawAgain: result.isDrawAgain,
            isBonusCoins: result.isBonusCoins,
            bonusCoins: result.bonusCoins,
            isBonusXp: result.isBonusXp,
            bonusXp: result.bonusXp,
            isBonusPrivilegePoints: result.isBonusPrivilegePoints,
            bonusPrivilegePoints: result.bonusPrivilegePoints,
            isFreeSpin: result.isFreeSpin,
            isDoubleNext: result.isDoubleNext,
            isNothing: result.isNothing,
            pityTriggered: result.pityTriggered,
            pity: pityInfo,
            message: '再抽一次成功！'
        });
    } catch (err: any) {
        const sc = err.statusCode || 500;
        if (sc === 500) console.error('再抽一次失败:', err);
        return res.status(sc).json({ message: err.message || '再抽一次失败，请重试' });
    }
});

app.get('/api/child/achievements', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const rows = await getDb().all(
      `SELECT ua.unlockedAt, ad.title, ad.description, ad.icon, ad.category, ad.conditionType, ad.conditionValue, ad.conditionCategory, ad.rewardCoins, ad.rewardXp, ad.rewardPrivilegePoints
       FROM user_achievements ua
       JOIN achievement_defs ad ON ua.achievementId = ad.id
       WHERE ua.childId = ?`,
      request.user!.id
    );
    res.json(sortAchievementRows(rows));
});

app.get('/api/child/chest-records', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '10'), 10) || 10, 1), 50);
    const { rewardType, rarity, startDate, endDate, dateFrom, dateTo } = req.query;
    let query = `
        SELECT cr.id, cr.rewardName, cr.rewardType, cr.rewardValue, cr.rewardRarity, cr.rewardIcon,
               cr.status, cr.createdAt, t.title as taskTitle
        FROM chest_records cr
        LEFT JOIN task_entries te ON cr.taskEntryId = te.id
        LEFT JOIN tasks t ON te.taskId = t.id
        WHERE cr.childId = ?
    `;
    const params: any[] = [request.user!.id];
    if (rewardType) {
        query += ' AND cr.rewardType = ?';
        params.push(rewardType);
    }
    if (rarity) {
        query += ' AND cr.rewardRarity = ?';
        params.push(rarity);
    }
    const fromDate = startDate || dateFrom;
    const toDate = endDate || dateTo;
    if (fromDate) {
        query += ' AND date(cr.createdAt, \'+8 hours\') >= ?';
        params.push(fromDate);
    }
    if (toDate) {
        query += ' AND date(cr.createdAt, \'+8 hours\') <= ?';
        params.push(toDate);
    }
    query += ' ORDER BY datetime(cr.createdAt) DESC LIMIT ?';
    params.push(limit);
    const rows = await getDb().all(
        query,
        ...params
    );
    res.json(rows);
});

// Child All Achievements (包含未解锁的，显示进度)
// 计算某个孩子的全部成就三态（解锁/领取/进度），家长端与孩子端共用
async function computeChildAchievements(db: ReturnType<typeof getDb>, childId: string, familyId: string) {

    // 获取所有成就定义
    const allDefs = await db.all('SELECT * FROM achievement_defs WHERE familyId = ?', familyId);

    // 获取已解锁的成就
    const unlocked = await db.all('SELECT achievementId, unlockedAt, rewardClaimedAt, rewardInventoryId FROM user_achievements WHERE childId = ?', childId);
    const unlockedMap = new Map(unlocked.map(u => [u.achievementId, u]));

    // 获取进度数据
    const taskCount = (await db.get('SELECT COUNT(*) as count FROM task_entries WHERE childId = ? AND status = "approved"', childId))?.count || 0;
    const child = await db.get('SELECT coins, xp FROM users WHERE id = ?', childId);
    const totalCoins = child?.coins || 0;
    const totalXp = child?.xp || 0;
    const level = Math.floor(totalXp / 100) + 1;

    // 探索进度（与 explore/achievement-progress、checkAchievements 口径一致）
    const [exploreCheckinRow, exploreImageRow, exploreVoiceRow, exploreConfirmedRow, exploreCatStats] = await Promise.all([
      db.get('SELECT COUNT(*) as count FROM explore_checkins WHERE childId = ?', childId),
      db.get("SELECT COUNT(*) as count FROM explore_media WHERE childId = ? AND type = 'image'", childId),
      db.get("SELECT COUNT(*) as count FROM explore_media WHERE childId = ? AND type = 'audio' AND senderRole = 'child'", childId),
      db.get('SELECT COUNT(*) as count FROM explore_checkins WHERE childId = ? AND parentConfirmed = 1', childId),
      db.all('SELECT p.category, COUNT(*) as count FROM explore_checkins ec JOIN explore_places p ON ec.placeId = p.id WHERE ec.childId = ? GROUP BY p.category', childId),
    ]);
    const exploreCheckinCount = exploreCheckinRow?.count || 0;
    const exploreMediaCount = exploreImageRow?.count || 0;
    const exploreVoiceCount = exploreVoiceRow?.count || 0;
    const exploreConfirmedCount = exploreConfirmedRow?.count || 0;
    const exploreCategoryCountMap: Record<string, number> = {};
    exploreCatStats.forEach((row: any) => { exploreCategoryCountMap[row.category] = row.count; });
    const exploreDistinctCategories = Object.keys(exploreCategoryCountMap).filter(c => c && c !== '其他').length;

    // 分类任务统计
    const categoryStats = await db.all(`
      SELECT t.category, COUNT(*) as count
      FROM task_entries te
      JOIN tasks t ON te.taskId = t.id
      WHERE te.childId = ? AND te.status = 'approved'
      GROUP BY t.category
    `, childId);
    const categoryCountMap: Record<string, number> = {};
    categoryStats.forEach((s: any) => { categoryCountMap[s.category] = s.count; });
    const getCategoryCount = (category?: string) => {
      const values = getTaskCategoryFilterValues(category);
      if (values.length === 0) return 0;
      return values.reduce((sum, value) => sum + (categoryCountMap[value] || 0), 0);
    };

    // 连续天数计算函数 - 使用北京时间
    const getStreakDays = async (category?: string): Promise<number> => {
      // 获取所有已完成任务的提交时间
      const categoryValues = getTaskCategoryFilterValues(category);
      const query = categoryValues.length > 0
        ? `SELECT DISTINCT te.submittedAt FROM task_entries te JOIN tasks t ON te.taskId = t.id WHERE te.childId = ? AND te.status = 'approved' AND t.category IN (${categoryValues.map(() => '?').join(', ')}) ORDER BY te.submittedAt DESC`
        : `SELECT DISTINCT submittedAt FROM task_entries WHERE childId = ? AND status = 'approved' ORDER BY submittedAt DESC`;
      const entries = categoryValues.length > 0
        ? await db.all(query, childId, ...categoryValues)
        : await db.all(query, childId);

      if (entries.length === 0) return 0;

      // 转换为北京时间日期字符串并去重
      const daysSet = new Set<string>();
      for (const entry of entries) {
        const submitDate = new Date(entry.submittedAt);
        const beijingDateStr = getLocalDateString(submitDate);
        daysSet.add(beijingDateStr);
      }
      const days = Array.from(daysSet).sort((a, b) => b.localeCompare(a));

      if (days.length === 0) return 0;

      const todayStr = getLocalDateString();
      let streak = 0;

      // 检查今天是否有任务
      const hasTaskToday = days[0] === todayStr;
      const startOffset = hasTaskToday ? 0 : 1;

      for (let i = 0; i < days.length; i++) {
        const dayStr = days[i];
        // 计算期望日期（北京时间）- 使用时间戳计算，避免跨年问题
        const beijingNow = getBeijingDate();
        // 使用时间戳减去天数（毫秒），避免 setDate 跨年问题
        const daysToSubtract = i + startOffset;
        const expectedTimestamp = beijingNow.getTime() - (daysToSubtract * 24 * 60 * 60 * 1000);
        const expectedDate = getBeijingDate(new Date(expectedTimestamp));
        // 使用 getLocalDateString 确保格式一致
        const expectedStr = getLocalDateString(expectedDate);

        if (dayStr === expectedStr) {
          streak++;
        } else {
          break;
        }
      }
      return streak;
    };

    // 预先计算所有需要的连续天数
    const streakCache: Record<string, number> = {};
    streakCache['__all__'] = await getStreakDays();
    for (const cat of ['生活', '学习', '早晨启动', '运动', '活动', '其他', '劳动', '兴趣']) {
      streakCache[cat] = await getStreakDays(cat);
    }

    // 组装结果
    const result = allDefs.map(def => {
        const display = buildAchievementDisplay(def);
        const unlockedState = unlockedMap.get(def.id);
        const isUnlocked = Boolean(unlockedState);
        let progress = 0;

        if (!isUnlocked) {
            switch (def.conditionType) {
              case 'task_count': progress = taskCount; break;
              case 'coin_count': progress = totalCoins; break;
              case 'xp_count': progress = totalXp; break;
              case 'level_reach': progress = level; break;
              case 'category_count': progress = getCategoryCount(def.conditionCategory); break;
              case 'streak_days': progress = def.conditionCategory ? (streakCache[def.conditionCategory] || 0) : streakCache['__all__']; break;
              case 'explore_checkin_count': progress = exploreCheckinCount; break;
              case 'explore_category_count': { const cats = String(def.conditionCategory || '').split(',').map((c: string) => c.trim()).filter(Boolean); progress = cats.reduce((sum: number, c: string) => sum + (exploreCategoryCountMap[c] || 0), 0); break; }
              case 'explore_media_count': progress = exploreMediaCount; break;
              case 'explore_voice_count': progress = exploreVoiceCount; break;
              case 'explore_confirmed_count': progress = exploreConfirmedCount; break;
              case 'explore_distinct_categories': progress = exploreDistinctCategories; break;
            }
        }

        return {
            id: def.id,
            title: def.title,
            description: def.description,
            icon: def.icon,
            conditionType: def.conditionType,
            conditionValue: def.conditionValue,
            conditionCategory: def.conditionCategory,
            category: display.category,
            displayTitle: display.displayTitle,
            displayDescription: display.displayDescription,
            displayIcon: display.displayIcon,
            rankLabel: display.rankLabel,
            rankIcon: display.rankIcon,
            rankOrder: display.rankOrder,
            rewardCoins: def.rewardCoins || 0,
            rewardXp: def.rewardXp || 0,
            rewardPrivilegePoints: def.rewardPrivilegePoints || 0,
            rewardDelivery: def.rewardDelivery || 'instant',
            unlocked: isUnlocked,
            unlockedAt: unlockedState?.unlockedAt || null,
            rewardClaimedAt: unlockedState?.rewardClaimedAt || null,
            rewardInventoryId: unlockedState?.rewardInventoryId || null,
            rewardClaimable: isUnlocked && !unlockedState?.rewardClaimedAt && (
              Number(def.rewardCoins || 0) > 0 ||
              Number(def.rewardXp || 0) > 0 ||
              Number(def.rewardPrivilegePoints || 0) > 0
            ),
            progress
        };
    });

    // 已解锁的排前面
    result.sort((a, b) => {
      const unlockedDiff = (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0);
      if (unlockedDiff) return unlockedDiff;
      const ai = ACHIEVEMENT_DISPLAY_CATEGORIES.indexOf(a.category);
      const bi = ACHIEVEMENT_DISPLAY_CATEGORIES.indexOf(b.category);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) ||
        Number(a.rankOrder || 99) - Number(b.rankOrder || 99) ||
        Number(a.conditionValue || 0) - Number(b.conditionValue || 0);
    });

    return result;
}

app.get('/api/child/all-achievements', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    await ensureExploreAchievementDefs(getDb(), request.user!.familyId); // P3：按需补齐新增探索成就，孩子端进度可见
    res.json(await computeChildAchievements(getDb(), request.user!.id, request.user!.familyId));
});

app.post('/api/child/achievements/:achievementId/claim', protect, requireChild, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const childId = request.user!.id;
    const familyId = request.user!.familyId;
    const achievementId = req.params.achievementId;

    const achievement = await db.get(
      `SELECT ua.id as userAchievementId, ua.rewardClaimedAt, ad.*
       FROM user_achievements ua
       JOIN achievement_defs ad ON ua.achievementId = ad.id
       WHERE ua.childId = ? AND ua.achievementId = ? AND ad.familyId = ?`,
      childId,
      achievementId,
      familyId
    );

    if (!achievement) return res.status(404).json({ message: '成就尚未解锁' });
    // F5: 奖励已在解锁瞬间自动发放，端点保留并幂等（兼容旧前端/重复请求）。
    if (achievement.rewardClaimedAt) return res.json({ message: '该成就奖励已领取', already: true });

    const rewardCoins = Math.max(0, Number(achievement.rewardCoins || 0));
    const rewardXp = Math.max(0, Number(achievement.rewardXp || 0));
    const rewardPrivilegePoints = Math.max(0, Number(achievement.rewardPrivilegePoints || 0));
    if (rewardCoins <= 0 && rewardXp <= 0 && rewardPrivilegePoints <= 0) {
      await db.run('UPDATE user_achievements SET rewardClaimedAt = ? WHERE id = ?', new Date().toISOString(), achievement.userAchievementId);
      return res.json({ message: '该成就没有额外奖励', rewardCoins: 0, rewardXp: 0, rewardPrivilegePoints: 0 });
    }

    const rewardDelivery = achievement.rewardDelivery === 'backpack' ? 'backpack' : 'instant';
    const now = new Date().toISOString();
    try {
      await db.run('BEGIN');
      let inventoryId: string | null = null;
      if (rewardDelivery === 'backpack') {
        inventoryId = randomUUID();
        await db.run(
          `INSERT INTO user_inventory (
             id, childId, title, icon, cost, costType, source, status,
             rewardCoins, rewardXp, rewardPrivilegePoints, acquiredAt
           ) VALUES (?, ?, ?, ?, 0, 'coins', 'achievement_reward', 'pending', ?, ?, ?, ?)`,
          inventoryId,
          childId,
          `${achievement.title}成就礼包`,
          achievement.icon || '🏆',
          rewardCoins,
          rewardXp,
          rewardPrivilegePoints,
          now
        );
      } else {
        await db.run(
          'UPDATE users SET coins = coins + ?, xp = xp + ?, privilegePoints = privilegePoints + ? WHERE id = ?',
          rewardCoins,
          rewardXp,
          rewardPrivilegePoints,
          childId
        );
      }

      await db.run(
        'UPDATE user_achievements SET rewardClaimedAt = ?, rewardInventoryId = ? WHERE id = ? AND rewardClaimedAt IS NULL',
        now,
        inventoryId,
        achievement.userAchievementId
      );
      await db.run('COMMIT');
      res.json({
        message: rewardDelivery === 'backpack' ? '成就礼包已放入背包' : '成就奖励已领取',
        rewardCoins,
        rewardXp,
        rewardPrivilegePoints,
        rewardDelivery,
        inventoryId
      });
    } catch (error) {
      try { await db.run('ROLLBACK'); } catch {}
      console.error('领取成就奖励失败:', error);
      res.status(500).json({ message: '领取失败，请重试' });
    }
});

// Child Privileges (read-only list)
app.get('/api/child/privileges', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    res.json(await getDb().all('SELECT * FROM privileges WHERE familyId = ?', request.user!.familyId));
});

// Child Redeem Privilege
app.post('/api/child/privileges/:id/redeem', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const priv = await db.get('SELECT * FROM privileges WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
    if (!priv) return res.status(404).json({ message: '特权不存在' });

    const user = await db.get('SELECT privilegePoints FROM users WHERE id = ?', request.user!.id);
    if ((user.privilegePoints || 0) < priv.cost) return res.status(400).json({ message: '权益点不足' });

    try {
        await withTransaction(async () => {
            // 守卫式扣减：特权点是最稀缺货币，绝不允许并发扣成负数
            const deduct = await db.run('UPDATE users SET privilegePoints = privilegePoints - ? WHERE id = ? AND privilegePoints >= ?', priv.cost, request.user!.id, priv.cost);
            if ((deduct.changes || 0) !== 1) throw Object.assign(new Error('权益点不足'), { statusCode: 400 });
            // 特权添加到背包，记录是用特权点兑换的，来源为privilege
            await db.run(`INSERT INTO user_inventory (id, childId, privilegeId, title, icon, cost, costType, source, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
                randomUUID(), request.user!.id, priv.id, priv.title, priv.icon || '👑', priv.cost, 'privilegePoints', 'privilege');
        });
        res.json({ message: '兑换成功！已放入背包' });
    } catch (err: any) {
        const sc = err.statusCode || 500;
        if (sc === 500) console.error('特权兑换失败:', err);
        return res.status(sc).json({ message: err.message || '兑换失败，请重试' });
    }
});

// ==================== 惩罚系统 API ====================

// 获取家庭的惩罚设置
app.get('/api/parent/punishment-settings', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const familyId = request.user!.familyId;

    let settings = await db.get('SELECT * FROM punishment_settings WHERE familyId = ?', familyId);

    // 如果不存在，创建默认设置
    if (!settings) {
        const id = randomUUID();
        await db.run(`
            INSERT INTO punishment_settings (
                id, familyId, enabled,
                mildName, mildRate, mildMin, mildMax,
                moderateName, moderateRate, moderateMin, moderateMax,
                severeName, severeRate, severeExtra, severeMax,
                customName, customMin, customMax,
                allowNegative, negativeLimit, notifyChild, requireReason
            ) VALUES (?, ?, 0,
                '轻度警告', 0.3, 2, 10,
                '中度惩罚', 0.5, 5, 20,
                '严重惩罚', 1.0, 5, 50,
                '自定义扣除', 1, 100,
                1, -10, 1, 1)
        `, id, familyId);
        settings = await db.get('SELECT * FROM punishment_settings WHERE id = ?', id);
    }

    res.json(settings);
});

// 更新惩罚设置
app.put('/api/parent/punishment-settings', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const familyId = request.user!.familyId;

    const {
        enabled, mildName, mildRate, mildMin, mildMax,
        moderateName, moderateRate, moderateMin, moderateMax,
        severeName, severeRate, severeExtra, severeMax,
        customName, customMin, customMax,
        allowNegative, negativeLimit, notifyChild, requireReason
    } = req.body;

    const existing = await db.get('SELECT id FROM punishment_settings WHERE familyId = ?', familyId);

    if (existing) {
        await db.run(`
            UPDATE punishment_settings SET
                enabled = ?, mildName = ?, mildRate = ?, mildMin = ?, mildMax = ?,
                moderateName = ?, moderateRate = ?, moderateMin = ?, moderateMax = ?,
                severeName = ?, severeRate = ?, severeExtra = ?, severeMax = ?,
                customName = ?, customMin = ?, customMax = ?,
                allowNegative = ?, negativeLimit = ?, notifyChild = ?, requireReason = ?,
                updatedAt = CURRENT_TIMESTAMP
            WHERE familyId = ?
        `,
            enabled, mildName, mildRate, mildMin, mildMax,
            moderateName, moderateRate, moderateMin, moderateMax,
            severeName, severeRate, severeExtra, severeMax,
            customName ?? '自定义扣除', customMin ?? 1, customMax ?? 100,
            allowNegative, negativeLimit, notifyChild, requireReason,
            familyId
        );
    } else {
        await db.run(`
            INSERT INTO punishment_settings (
                id, familyId, enabled,
                mildName, mildRate, mildMin, mildMax,
                moderateName, moderateRate, moderateMin, moderateMax,
                severeName, severeRate, severeExtra, severeMax,
                customName, customMin, customMax,
                allowNegative, negativeLimit, notifyChild, requireReason
            ) VALUES (?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?, ?)
        `,
            randomUUID(), familyId, enabled,
            mildName, mildRate, mildMin, mildMax,
            moderateName, moderateRate, moderateMin, moderateMax,
            severeName, severeRate, severeExtra, severeMax,
            customName ?? '自定义扣除', customMin ?? 1, customMax ?? 100,
            allowNegative, negativeLimit, notifyChild, requireReason
        );
    }

    res.json({ message: '设置已保存' });
});

// 惩罚计算辅助函数（custom 时由调用方传入 customAmount）
const calculatePunishment = (taskReward: number, level: string, settings: any, customAmount?: number): number => {
    let deduction = 0;

    switch (level) {
        case 'mild':
            deduction = Math.round(taskReward * settings.mildRate);
            deduction = Math.max(settings.mildMin, Math.min(settings.mildMax, deduction));
            break;
        case 'moderate':
            deduction = Math.round(taskReward * settings.moderateRate);
            deduction = Math.max(settings.moderateMin, Math.min(settings.moderateMax, deduction));
            break;
        case 'severe':
            deduction = Math.round(taskReward * settings.severeRate) + settings.severeExtra;
            deduction = Math.min(settings.severeMax, deduction);
            break;
        case 'custom':
            if (customAmount == null || customAmount < 0) return 0;
            const min = settings.customMin ?? 1;
            const max = settings.customMax ?? 100;
            deduction = Math.max(min, Math.min(max, Math.round(customAmount)));
            break;
    }

    return deduction;
};

// 获取任务详情（包含惩罚信息）
app.get('/api/task-entries/:id', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const entryId = req.params.id;

  // 获取任务条目详情
  const entry = await db.get(`
    SELECT te.*, t.title, t.coinReward, t.xpReward, t.durationMinutes, t.familyId,
           u.name as childName, u.id as childId
    FROM task_entries te
    JOIN tasks t ON te.taskId = t.id
    JOIN users u ON te.childId = u.id
    WHERE te.id = ?
  `, entryId);

  if (!entry) {
    return res.status(404).json({ message: '任务记录不存在' });
  }

  // 检查权限（家长可以看所有家庭成员的任务，孩子只能看自己的）
  if (request.user!.role === 'child' && entry.childId !== request.user!.id) {
    return res.status(403).json({ message: '无权访问' });
  }

  if (request.user!.role === 'parent' && entry.familyId !== request.user!.familyId) {
    return res.status(403).json({ message: '无权访问' });
  }

  // 获取惩罚记录
  const punishment = await db.get(`
    SELECT pr.*, p.name as parentName
    FROM punishment_records pr
    JOIN users p ON pr.parentId = p.id
    WHERE pr.taskEntryId = ?
  `, entryId);

  res.json({
    ...entry,
    punishment: punishment || null
  });
});

// 审批后再次调整奖励/惩罚（仅限已通过的任务）
// - 会按“新净值(最终奖励-惩罚) - 旧净值(已发放奖励-历史惩罚)”计算差值并修正孩子金币
// - 惩罚记录会被“整体替换”为一条 custom 记录（或清空）
app.put('/api/parent/task-entries/:id/adjust', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb();
  const entryId = req.params.id;
  const { finalCoins, punishmentDeduction, punishmentReason } = req.body;

  if (typeof finalCoins !== 'number' || Number.isNaN(finalCoins)) {
    return res.status(400).json({ message: '请提供最终金币数 finalCoins（数字）' });
  }

  const entry = await db.get(
    `
    SELECT te.*, t.coinReward, t.familyId
    FROM task_entries te
    JOIN tasks t ON te.taskId = t.id
    WHERE te.id = ?
  `,
    entryId
  );

  if (!entry) return res.status(404).json({ message: '任务记录不存在' });
  if (entry.familyId !== request.user!.familyId) return res.status(403).json({ message: '无权操作' });
  if (entry.status !== 'approved') return res.status(400).json({ message: '只能调整已通过的任务' });

  const oldEarnedCoins = entry.earnedCoins ?? 0;
  const oldPunishmentRow = await db.get(
    'SELECT COALESCE(SUM(deductedCoins), 0) as s FROM punishment_records WHERE taskEntryId = ?',
    entryId
  );
  const oldPunishmentSum = oldPunishmentRow?.s ?? 0;
  const oldNet = oldEarnedCoins - oldPunishmentSum;

  const newFinalCoins = Math.min(100000, Math.max(0, Math.round(finalCoins)));
  const newPunishmentDeduction = Math.max(0, Math.round(Number(punishmentDeduction) || 0));
  const newNet = newFinalCoins - newPunishmentDeduction;
  const delta = newNet - oldNet;

  // 按惩罚设置的“负数保护”规则校验（避免静默截断导致账目不一致）
  const settings = await db.get(
    'SELECT allowNegative, negativeLimit FROM punishment_settings WHERE familyId = ?',
    entry.familyId
  );
  const allowNegative = (settings?.allowNegative ?? 0) === 1;
  const negativeLimit = settings?.negativeLimit ?? 0;
  const minBalance = allowNegative ? negativeLimit : 0;

  let balanceBefore = 0;
  let balanceAfter = 0;

  try {
    await withTransaction(async () => {
    // 余额读取/校验/更新同事务，且用相对增量，避免覆盖并发到账的奖励
    const child = await db.get('SELECT coins FROM users WHERE id = ?', entry.childId);
    balanceBefore = child?.coins ?? 0;
    balanceAfter = balanceBefore + delta;
    if (balanceAfter < minBalance) {
      throw Object.assign(
        new Error(allowNegative ? `调整后金币不能低于 ${negativeLimit}` : '调整后金币不能为负数'),
        { statusCode: 400 }
      );
    }

    await db.run('UPDATE users SET coins = coins + ? WHERE id = ?', delta, entry.childId);
    await db.run('UPDATE task_entries SET earnedCoins = ? WHERE id = ?', newFinalCoins, entryId);
    await syncTaskSettlementCoinAdjustment(db, entryId, newFinalCoins, balanceAfter);

    // 用新的惩罚结果整体替换（0 则清空）
    await db.run('DELETE FROM punishment_records WHERE taskEntryId = ?', entryId);
    if (newPunishmentDeduction > 0) {
      await db.run(
        `
        INSERT INTO punishment_records (
          id, taskEntryId, taskId, childId, parentId, familyId,
          level, reason, taskReward, deductedCoins, balanceBefore, balanceAfter
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        randomUUID(),
        entryId,
        entry.taskId,
        entry.childId,
        request.user!.id,
        entry.familyId,
        'custom',
        (punishmentReason && String(punishmentReason).trim()) || '家长调整',
        entry.coinReward,
        newPunishmentDeduction,
        balanceBefore,
        balanceAfter
      );
    }

    });
    res.json({
      message: '已调整',
      finalCoins: newFinalCoins,
      punishmentDeduction: newPunishmentDeduction,
      coinsDelta: delta,
      balanceAfter
    });
  } catch (err: any) {
    const sc = err.statusCode || 500;
    if (sc === 500) console.error('调整奖励/惩罚失败:', err);
    return res.status(sc).json({ message: err.message || '调整失败，请重试' });
  }
});

// B3-7: 批量审核通过（按基础奖励发放，不加评分、不惩罚）
app.post('/api/parent/task-entries/batch-review', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const { entryIds, action } = req.body as { entryIds: string[]; action: 'approve' | 'reject' };
    if (!Array.isArray(entryIds) || entryIds.length === 0) {
        return res.status(400).json({ message: '请选择要审核的任务' });
    }
    if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ message: '无效的审核操作' });
    }
    const batchReason = String((req.body as any).reason || '').trim();
    if (action === 'reject' && !batchReason) {
        return res.status(400).json({ message: '请填写打回原因，让孩子知道哪里可以改进' });
    }
    if (entryIds.length > 20) {
        return res.status(400).json({ message: '单次批量审核不能超过20条' });
    }

    const results: Array<{ id: string; status: string; [key: string]: unknown }> = [];
    const childIdsToCheck = new Set<string>();

    for (const entryId of entryIds) {
        try {
            const entry = await db.get(`
                SELECT te.*, t.coinReward, t.xpReward, t.taskType, t.category, t.familyId as taskFamilyId
                FROM task_entries te
                JOIN tasks t ON te.taskId = t.id
                WHERE te.id = ?
            `, entryId);

            if (!entry) { results.push({ id: entryId, status: 'not_found' }); continue; }
            if (entry.taskFamilyId !== request.user!.familyId) { results.push({ id: entryId, status: 'forbidden' }); continue; }
            if (entry.status !== 'pending') { results.push({ id: entryId, status: 'already_processed' }); continue; }

            if (action === 'reject') {
                await db.run("UPDATE task_entries SET status = 'rejected', reviewedAt = ?, reviewNote = ? WHERE id = ? AND status = 'pending'",
                    new Date().toISOString(), batchReason.slice(0, 200), entryId);
                results.push({ id: entryId, status: 'rejected' });
                continue;
            }

            const outcome = await settleTaskEntry(db, {
              entryId,
              familyId: request.user!.familyId,
              grantGameMinutes: settlementEntry => grantTaskSettlementGameMinutes(db, request.user!.familyId, settlementEntry),
            }, withTransaction);
            childIdsToCheck.add(outcome.childId);
            results.push({ id: entryId, status: 'approved', ...outcome.result });
        } catch (err) {
            console.error(`批量审核单项失败 [${entryId}]:`, err);
            results.push({ id: entryId, status: 'error' });
        }
    }

    // 批量结束后统一触发成就检查
    for (const childId of childIdsToCheck) {
        try { await checkAchievements(childId, db); } catch (e) { console.error('批量审核成就检查失败:', e); }
    }

    res.json({
        message: `批量审核完成`,
        results,
        approved: results.filter(r => r.status === 'approved').length,
        rejected: results.filter(r => r.status === 'rejected').length,
        failed: results.filter(r => !['approved', 'rejected'].includes(r.status)).length,
    });
});

// 执行惩罚（任务审核时调用）
app.post('/api/parent/task-entries/:id/punish', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const entryId = req.params.id;
    const { level, reason, customAmount } = req.body; // level: 'mild' | 'moderate' | 'severe' | 'custom'

    if (!level || !reason) {
        return res.status(400).json({ message: '缺少惩罚等级或原因' });
    }

    if (!['mild', 'moderate', 'severe', 'custom'].includes(level)) {
        return res.status(400).json({ message: '无效的惩罚等级' });
    }
    if (level === 'custom') {
        const amount = Number(customAmount);
        if (isNaN(amount) || amount < 0) return res.status(400).json({ message: '自定义扣除金额无效' });
        // 获取设置中的范围限制
        const tempSettings = await db.get('SELECT customMin, customMax FROM punishment_settings WHERE familyId = ?', request.user!.familyId);
        const min = tempSettings?.customMin ?? 1;
        const max = tempSettings?.customMax ?? 100;
        if (amount < min || amount > max) {
            return res.status(400).json({ message: `自定义扣除金额应在 ${min}～${max} 之间` });
        }
    }

    // 获取任务条目
    const entry = await db.get(`
        SELECT te.*, t.coinReward, t.familyId
        FROM task_entries te
        JOIN tasks t ON te.taskId = t.id
        WHERE te.id = ?
    `, entryId);

    if (!entry) {
        return res.status(404).json({ message: '任务记录不存在' });
    }

    if (entry.familyId !== request.user!.familyId) {
        return res.status(403).json({ message: '无权操作' });
    }

    const existingPunishment = await db.get(
        'SELECT COALESCE(SUM(deductedCoins), 0) as deducted FROM punishment_records WHERE taskEntryId = ?',
        entryId
    );
    if ((existingPunishment?.deducted || 0) > 0) {
        return res.json({
            message: '惩罚已执行',
            alreadyPunished: true,
            deducted: existingPunishment.deducted,
            notified: false
        });
    }

    // 获取惩罚设置
    const settings = await db.get('SELECT * FROM punishment_settings WHERE familyId = ?', entry.familyId);

    if (!settings || !settings.enabled) {
        return res.status(400).json({ message: '惩罚功能未启用' });
    }

    if (settings.requireReason && !reason.trim()) {
        return res.status(400).json({ message: '必须填写惩罚原因' });
    }

    // 计算基础扣除金币数（custom 时使用 customAmount）
    const baseDeduction = level === 'custom'
        ? calculatePunishment(entry.coinReward, level, settings, Number(req.body.customAmount))
        : calculatePunishment(entry.coinReward, level, settings);

    // 动态调整惩罚力度
    const adjustment = await calculateAdjustedPunishment(db, baseDeduction, entry.taskId, entry.childId);
    const deduction = adjustment.adjustedDeduction;

    let balanceBefore = 0;
    let balanceAfter = 0;
    let actualDeduction = 0;

    try {
        await withTransaction(async () => {
        // 余额读取/保护限制/扣除同事务，且用相对增量，避免覆盖并发到账的奖励
        const child = await db.get('SELECT coins FROM users WHERE id = ?', entry.childId);
        balanceBefore = child.coins;
        balanceAfter = balanceBefore - deduction;
        if (settings.allowNegative) {
            balanceAfter = Math.max(settings.negativeLimit, balanceAfter);
        } else {
            balanceAfter = Math.max(0, balanceAfter);
        }
        actualDeduction = balanceBefore - balanceAfter;

        // 扣除金币（相对增量）
        await db.run('UPDATE users SET coins = coins - ? WHERE id = ?', actualDeduction, entry.childId);

        // 记录惩罚
        await db.run(`
            INSERT INTO punishment_records (
                id, taskEntryId, taskId, childId, parentId, familyId,
                level, reason, taskReward, deductedCoins, balanceBefore, balanceAfter
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
            randomUUID(), entry.id, entry.taskId, entry.childId, request.user!.id, entry.familyId,
            level, reason, entry.coinReward, actualDeduction, balanceBefore, balanceAfter
        );

        });

        res.json({
            message: '惩罚已执行',
            deducted: actualDeduction,
            originalDeduction: adjustment.originalDeduction,
            adjustmentFactor: adjustment.adjustmentFactor,
            messages: adjustment.messages,
            suggestTaskReview: adjustment.suggestTaskReview,
            suggestTalk: adjustment.suggestTalk,
            balanceAfter,
            notified: settings.notifyChild
        });
    } catch (err: any) {
        const sc = err.statusCode || 500;
        if (sc === 500) console.error('执行惩罚失败:', err);
        return res.status(sc).json({ message: err.message || '执行惩罚失败，请重试' });
    }
});

// 查询惩罚记录（家长端）
app.get('/api/parent/punishment-records', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const familyId = request.user!.familyId;
    const {
      childId,
      startDate,
      endDate,
      dateFrom,
      dateTo,
      timeFilter,
      level,
      taskCategory,
      reason,
      limit = 50,
    } = req.query;

    let query = `
        SELECT pr.*,
               u.name as childName,
               p.name as parentName,
               t.title as taskTitle,
               t.category as taskCategory
        FROM punishment_records pr
        JOIN users u ON pr.childId = u.id
        JOIN users p ON pr.parentId = p.id
        JOIN tasks t ON pr.taskId = t.id
        WHERE pr.familyId = ?
    `;

    const params: any[] = [familyId];

    if (childId) {
        query += ' AND pr.childId = ?';
        params.push(childId);
    }

    if (timeFilter === 'today') {
        query += ` AND date(pr.createdAt, '+8 hours') = date('now', '+8 hours')`;
    } else if (timeFilter === 'week') {
        query += ` AND datetime(pr.createdAt, '+8 hours') >= datetime('now', '+8 hours', '-7 days')`;
    } else if (timeFilter === 'month') {
        query += ` AND datetime(pr.createdAt, '+8 hours') >= datetime('now', '+8 hours', '-30 days')`;
    }

    const fromDate = startDate || dateFrom;
    const toDate = endDate || dateTo;

    if (fromDate) {
        query += ` AND date(pr.createdAt, '+8 hours') >= ?`;
        params.push(fromDate);
    }

    if (toDate) {
        query += ` AND date(pr.createdAt, '+8 hours') <= ?`;
        params.push(toDate);
    }

    if (level) {
        query += ' AND pr.level = ?';
        params.push(level);
    }

    if (taskCategory) {
        const categoryValues = getTaskCategoryFilterValues(taskCategory);
        if (categoryValues.length > 0) {
            query += ` AND t.category IN (${categoryValues.map(() => '?').join(', ')})`;
            params.push(...categoryValues);
        }
    }

    if (reason) {
        query += ' AND pr.reason LIKE ?';
        params.push(`%${reason}%`);
    }

    query += ' ORDER BY pr.createdAt DESC LIMIT ?';
    params.push(parseInt(limit as string, 10));

    const records = await db.all(query, ...params);
    res.json(records);
});

// 查询惩罚记录（孩子端，只能看自己的）
app.get('/api/child/punishment-records', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const childId = request.user!.id;
    const { limit = 20, timeFilter, startDate, endDate, dateFrom, dateTo, level, taskCategory, reason } = req.query; // timeFilter: 'today' | 'week' | 'month' | 'all'

    let query = `
        SELECT pr.*,
               p.name as parentName,
               t.title as taskTitle,
               t.category as taskCategory
        FROM punishment_records pr
        JOIN users p ON pr.parentId = p.id
        JOIN tasks t ON pr.taskId = t.id
        WHERE pr.childId = ?
    `;

    const params: any[] = [childId];

    // 时间筛选
    if (timeFilter === 'today') {
        query += ` AND date(pr.createdAt, '+8 hours') = date('now', '+8 hours')`;
    } else if (timeFilter === 'week') {
        query += ` AND datetime(pr.createdAt, '+8 hours') >= datetime('now', '+8 hours', '-7 days')`;
    } else if (timeFilter === 'month') {
        query += ` AND datetime(pr.createdAt, '+8 hours') >= datetime('now', '+8 hours', '-30 days')`;
    }
    // 'all' 不添加时间限制

    const fromDate = startDate || dateFrom;
    const toDate = endDate || dateTo;
    if (fromDate) {
        query += ` AND date(pr.createdAt, '+8 hours') >= ?`;
        params.push(fromDate);
    }
    if (toDate) {
        query += ` AND date(pr.createdAt, '+8 hours') <= ?`;
        params.push(toDate);
    }
    if (level) {
        query += ' AND pr.level = ?';
        params.push(level);
    }
    if (taskCategory) {
        const categoryValues = getTaskCategoryFilterValues(taskCategory);
        if (categoryValues.length > 0) {
            query += ` AND t.category IN (${categoryValues.map(() => '?').join(', ')})`;
            params.push(...categoryValues);
        }
    }
    if (reason) {
        query += ' AND pr.reason LIKE ?';
        params.push(`%${reason}%`);
    }

    query += ` ORDER BY pr.createdAt DESC LIMIT ?`;
    params.push(parseInt(limit as string, 10));

    const records = await db.all(query, ...params);
    res.json(records);
});

// 惩罚统计（孩子端）
app.get('/api/child/punishment-stats', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const childId = request.user!.id;

    // 总惩罚次数
    const totalCount = (await db.get(
        'SELECT COUNT(*) as count FROM punishment_records WHERE childId = ?',
        childId
    ))?.count || 0;

    // 总扣除金币
    const totalDeducted = (await db.get(
        'SELECT SUM(deductedCoins) as total FROM punishment_records WHERE childId = ?',
        childId
    ))?.total || 0;

    // 最近7天惩罚次数
    const weekCount = (await db.get(
        'SELECT COUNT(*) as count FROM punishment_records WHERE childId = ? AND date(createdAt, \'+8 hours\') >= date(\'now\', \'+8 hours\', \'-7 days\')',
        childId
    ))?.count || 0;

    // 前7天（8-14天前）惩罚次数（用于趋势对比）
    const prevWeekCount = (await db.get(
        'SELECT COUNT(*) as count FROM punishment_records WHERE childId = ? AND date(createdAt, \'+8 hours\') >= date(\'now\', \'+8 hours\', \'-14 days\') AND date(createdAt, \'+8 hours\') < date(\'now\', \'+8 hours\', \'-7 days\')',
        childId
    ))?.count || 0;

    // 按等级统计
    const byLevel = await db.all(`
        SELECT level, COUNT(*) as count, SUM(deductedCoins) as totalDeducted
        FROM punishment_records
        WHERE childId = ?
        GROUP BY level
    `, childId);

    // 最近一次惩罚时间
    const lastPunishment = await db.get(`
        SELECT createdAt FROM punishment_records
        WHERE childId = ?
        ORDER BY createdAt DESC
        LIMIT 1
    `, childId);

    // 计算距离上次惩罚的天数
    let daysSinceLastPunishment = null;
    if (lastPunishment) {
        const lastDate = new Date(lastPunishment.createdAt);
        const today = new Date();
        const diffTime = today.getTime() - lastDate.getTime();
        daysSinceLastPunishment = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    }

    res.json({
        totalCount,
        totalDeducted,
        weekCount,
        prevWeekCount,
        byLevel,
        lastPunishmentDate: lastPunishment?.createdAt || null,
        daysSinceLastPunishment
    });
});

// 获取家庭成员列表（孩子端）- 只返回其他孩子
app.get('/api/child/family-members', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const members = await db.all(
        'SELECT id, name, role, gender FROM users WHERE familyId = ? AND id != ? AND role = "child"',
        request.user!.familyId, request.user!.id
    );
    res.json(members);
});

// 全局错误处理中间件
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('❌ Express Error:', err.message || err);
  res.status(500).json({ message: '服务器内部错误，请稍后重试' });
});

// 404 处理
app.use((req: Request, res: Response) => {
  res.status(404).json({ message: '接口不存在' });
});

// 启动服务器
console.log('🚀 Starting server initialization...');
initializeDatabase()
  .then(async () => {
    console.log('✅ Database initialized successfully');
    await initRewardTables();
    await initLotteryTables();
    console.log('✅ Reward system routes registered');
    startTaskSessionFinalizer();
    if (process.env.ENABLE_DB_BACKUP === 'true' || process.env.NODE_ENV === 'production') {
      startBackupScheduler();
    }
    startExploreFeedScheduler();
    startWeeklyReportScheduler();
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
      console.log(`📡 API ready at http://localhost:${PORT}/api`);
      console.log(`📊 Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
    });

    // 设置服务器级别的超时
    server.timeout = 30000; // 30秒
    server.keepAliveTimeout = 65000; // 65秒
    server.headersTimeout = 66000; // 66秒

    // 定期健康检查和内存监控（每5分钟）
    setInterval(async () => {
      try {
        await getDb().get('SELECT 1');
        const memUsage = process.memoryUsage();
        console.log(`💚 [${new Date().toISOString()}] Health OK - Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
      } catch (error) {
        console.error('❌ Health check failed:', error);
      }
    }, 5 * 60 * 1000);

    // 优雅关闭处理
    process.on('SIGTERM', () => {
      console.log('📴 SIGTERM received, closing server...');
      server.close(() => {
        console.log('👋 Server closed');
        process.exit(0);
      });
    });

    // 未捕获异常处理：记录后退出，由进程管理器负责重启
    // （注：此尾部于 2026-06-10 因文件同步事故按审计记录重建，功能与原版一致）
    process.on('uncaughtException', (error) => {
      console.error('💥 Uncaught Exception:', error);
      process.exit(1);
    });

    // 单次未捕获的 Promise 拒绝（如某路由一次 SQLITE_BUSY）不应导致整个服务重启，
    // 记录详细日志即可；真正不可恢复的同步异常仍由 uncaughtException 退出重启。
    process.on('unhandledRejection', (reason, promise) => {
      console.error('💥 Unhandled Rejection:', reason);
    });
  })
  .catch((error) => {
    console.error('❌ Failed to initialize database:', error);
    process.exit(1);
  });
