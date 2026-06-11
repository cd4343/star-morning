import { Express } from 'express';
import { randomUUID } from 'crypto';
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

// --- 北京时间工具（与 exploreFeed.ts 同口径，模块内独立实现避免交叉依赖） ---
const BEIJING_OFFSET_MINUTES = 8 * 60;

const getBeijingDate = (date: Date = new Date()): Date => {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utc + BEIJING_OFFSET_MINUTES * 60000);
};

const ymdOf = (beijing: Date): string => {
  const year = beijing.getFullYear();
  const month = String(beijing.getMonth() + 1).padStart(2, '0');
  const day = String(beijing.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// YYYY-MM-DD 加减天数（UTC 锚定，结果与宿主时区无关）
const addDaysToYmd = (ymd: string, days: number): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

// 目标周（应生成报告的那一周）的周一：周日 20:00 起本周可收官，其余时间取上一个完整周（周一至周日）
export const getTargetWeekStart = (now: Date = new Date()): string => {
  const beijing = getBeijingDate(now);
  const dayOfWeek = beijing.getDay();
  const currentMonday = addDaysToYmd(ymdOf(beijing), -((dayOfWeek + 6) % 7));
  if (dayOfWeek === 0 && beijing.getHours() >= 20) return currentMonday;
  return addDaysToYmd(currentMonday, -7);
};

// ==================== A. 周统计（确定性整数口径，Rule 5：纯代码不依赖 AI） ====================

interface WeeklyStats {
  tasksCompleted: number;
  tasksCompletedPrev: number;
  tasksDelta: number;
  activeStarts: number;
  courageQuests: number;
  coinsEarned: number;
  punishments: number;
  calmSessions: number;
  totalEntries: number;
  completionRatePct: number | null;
  coinBalance: number;
  coinBalanceChange: number | null;
  coinBalancePrev2: number | null;
}

const toInt = (value: unknown): number => {
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) ? num : 0;
};

const collectStats = async (db: any, child: any, weekStart: string): Promise<WeeklyStats> => {
  const weekEnd = addDaysToYmd(weekStart, 6);
  const prevStart = addDaysToYmd(weekStart, -7);
  const prevEnd = addDaysToYmd(weekStart, -1);

  const sumRange = async (sql: string, start: string, end: string): Promise<number> => {
    const row = await db.get(sql, child.id, start, end);
    return toInt(row?.v ?? 0);
  };

  // 完成口径与 /api/child/dashboard 一致：审核通过(approved)、按提交日（北京时间）归属
  const completedSql = `SELECT COUNT(*) as v FROM task_entries WHERE childId = ? AND status = 'approved' AND date(submittedAt, '+8 hours') BETWEEN ? AND ?`;
  const tasksCompleted = await sumRange(completedSql, weekStart, weekEnd);
  const tasksCompletedPrev = await sumRange(completedSql, prevStart, prevEnd);

  // 主动启动次数 = 孩子点「开始挑战」产生的 task_sessions
  const activeStarts = await sumRange(
    `SELECT COUNT(*) as v FROM task_sessions WHERE childId = ? AND date(startedAt, '+8 hours') BETWEEN ? AND ?`,
    weekStart, weekEnd
  );

  // 勇气关 = feeling='afraid' 的学习闯关审核通过数
  const courageQuests = await sumRange(
    `SELECT COUNT(*) as v FROM learning_sessions ls
      JOIN learning_quests lq ON ls.questId = lq.id
     WHERE ls.childId = ? AND ls.status = 'approved' AND lq.feeling = 'afraid'
       AND date(COALESCE(ls.reviewedAt, ls.submittedAt, ls.startedAt), '+8 hours') BETWEEN ? AND ?`,
    weekStart, weekEnd
  );

  // 获得金币 = 任务 + 学习闯关 + 宝箱金币（全部整数）
  const taskCoins = await sumRange(
    `SELECT COALESCE(SUM(earnedCoins), 0) as v FROM task_entries WHERE childId = ? AND status = 'approved' AND date(submittedAt, '+8 hours') BETWEEN ? AND ?`,
    weekStart, weekEnd
  );
  const learningCoins = await sumRange(
    `SELECT COALESCE(SUM(earnedCoins), 0) as v FROM learning_sessions WHERE childId = ? AND status = 'approved' AND date(COALESCE(reviewedAt, submittedAt, startedAt), '+8 hours') BETWEEN ? AND ?`,
    weekStart, weekEnd
  );
  const chestCoins = await sumRange(
    `SELECT COALESCE(SUM(CASE WHEN rewardType = 'coins' THEN rewardValue ELSE 0 END), 0) as v FROM chest_records WHERE childId = ? AND date(createdAt, '+8 hours') BETWEEN ? AND ?`,
    weekStart, weekEnd
  );

  const punishments = await sumRange(
    `SELECT COUNT(*) as v FROM punishment_records WHERE childId = ? AND date(createdAt, '+8 hours') BETWEEN ? AND ?`,
    weekStart, weekEnd
  );

  // 冷静站 = 情绪急救打卡（emotion_checkins，孩子端「冷静练习」）
  const calmSessions = await sumRange(
    `SELECT COUNT(*) as v FROM emotion_checkins WHERE childId = ? AND date(createdAt, '+8 hours') BETWEEN ? AND ?`,
    weekStart, weekEnd
  );

  // 完成率分母 = 本周提交总数（含 pending/rejected）；提交不足 5 次不触发再平衡建议，避免小样本噪声
  const totalEntries = await sumRange(
    `SELECT COUNT(*) as v FROM task_entries WHERE childId = ? AND date(submittedAt, '+8 hours') BETWEEN ? AND ?`,
    weekStart, weekEnd
  );

  // 金币结余对比：读最近两份历史周报 statsJson 里的 coinBalance（前两周缺报告则不出信号）
  const prevReports = await db.all(
    'SELECT weekStart, statsJson FROM weekly_reports WHERE childId = ? AND weekStart IN (?, ?)',
    child.id, addDaysToYmd(weekStart, -7), addDaysToYmd(weekStart, -14)
  );
  const balanceAt = (ws: string): number | null => {
    const row = prevReports.find((item: any) => item.weekStart === ws);
    if (!row) return null;
    try {
      const parsed = JSON.parse(String(row.statsJson || ''));
      const balance = Math.trunc(Number(parsed?.coinBalance));
      return Number.isFinite(balance) ? balance : null;
    } catch {
      return null;
    }
  };

  const coinBalance = toInt(child.coins);
  const prevBalance = balanceAt(addDaysToYmd(weekStart, -7));
  const coinBalancePrev2 = balanceAt(addDaysToYmd(weekStart, -14));

  return {
    tasksCompleted,
    tasksCompletedPrev,
    tasksDelta: tasksCompleted - tasksCompletedPrev,
    activeStarts,
    courageQuests,
    coinsEarned: taskCoins + learningCoins + chestCoins,
    punishments,
    calmSessions,
    totalEntries,
    completionRatePct: totalEntries > 0 ? Math.trunc((tasksCompleted * 100) / totalEntries) : null,
    coinBalance,
    coinBalanceChange: prevBalance === null ? null : coinBalance - prevBalance,
    coinBalancePrev2,
  };
};

// ==================== B. 文案拼装（模板池 + 数字填充，只和自己比、不评判） ====================

type StoryTemplate = (s: WeeklyStats, courage: string) => string;

const ZERO_POOL: StoryTemplate[] = [
  (_s, c) => `这周休息了一下${c}。新的一周，挑一个最小的任务开始就好，小晨星等你 ⭐`,
  (_s, c) => `这周安静地充了充电${c}。下周我们从最容易的一步开始，小晨星陪你 ⭐`,
  (_s, c) => `休息够啦就出发！新的一周，先做成一件小事就算赢${c}，小晨星在你身边 ⭐`,
];

const POSITIVE_POOL: StoryTemplate[] = [
  (s, c) => `这周你完成了 ${s.tasksCompleted} 个任务，比上周多 ${s.tasksDelta} 个！主动开始了 ${s.activeStarts} 次${c}，小晨星为你骄傲 ⭐`,
  (s, c) => `又往前走了 ${s.tasksDelta} 步！这周完成 ${s.tasksCompleted} 个任务，主动开始 ${s.activeStarts} 次${c}，继续按自己的节奏来 ⭐`,
  (s, c) => `这周的星星更亮啦：完成 ${s.tasksCompleted} 个任务，比上周多 ${s.tasksDelta} 个${c}，小晨星一直在为你鼓掌 ⭐`,
  (s, c) => `主动开始 ${s.activeStarts} 次、完成 ${s.tasksCompleted} 个任务，比上周多 ${s.tasksDelta} 个${c}，这周的你又长大了一点 ⭐`,
];

const STEADY_POOL: StoryTemplate[] = [
  (s, c) => `这周你稳稳完成了 ${s.tasksCompleted} 个任务，和上周一样！主动开始了 ${s.activeStarts} 次${c}，稳住节奏就很棒 ⭐`,
  (s, c) => `节奏保持住啦：完成 ${s.tasksCompleted} 个任务，主动开始 ${s.activeStarts} 次${c}，小晨星喜欢这样的坚持 ⭐`,
  (s, c) => `这周完成了 ${s.tasksCompleted} 个任务，主动开始 ${s.activeStarts} 次${c}，一步一步走得很稳 ⭐`,
];

const REST_POOL: StoryTemplate[] = [
  (s, c) => `这周休整了一下，完成了 ${s.tasksCompleted} 个任务${c}。下周我们找回节奏，小晨星陪着你 ⭐`,
  (s, c) => `这周你完成了 ${s.tasksCompleted} 个任务，主动开始了 ${s.activeStarts} 次${c}。慢慢来，下周再一起出发 ⭐`,
  (s, c) => `休息也是成长的一部分。这周完成 ${s.tasksCompleted} 个任务${c}，下周我们一小步一小步来 ⭐`,
];

// 同孩子同周文案稳定、跨周有变化：childId+weekStart 做确定性选择（Rule 5：不引入真随机）
const pickIndex = (seed: string, poolSize: number): number => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 9973;
  return hash % poolSize;
};

const buildChildStory = (stats: WeeklyStats, seed: string): string => {
  const courage = stats.courageQuests > 0 ? `，勇气关过了 ${stats.courageQuests} 次` : '';
  const pool = stats.tasksCompleted === 0
    ? ZERO_POOL
    : stats.tasksDelta > 0
      ? POSITIVE_POOL
      : stats.tasksDelta === 0
        ? STEADY_POOL
        : REST_POOL;
  return pool[pickIndex(seed, pool.length)](stats, courage);
};

const buildParentNarrative = (childName: string, stats: WeeklyStats): string => {
  const first = `本周${childName}完成任务 ${stats.tasksCompleted} 个（上周 ${stats.tasksCompletedPrev} 个），主动启动 ${stats.activeStarts} 次，获得金币 ${stats.coinsEarned} 枚。`;
  const middleParts: string[] = [];
  if (stats.courageQuests > 0) middleParts.push(`勇气关完成 ${stats.courageQuests} 次`);
  if (stats.calmSessions > 0) middleParts.push(`冷静站使用 ${stats.calmSessions} 次`);
  if (stats.punishments > 0) middleParts.push(`惩罚 ${stats.punishments} 次`);
  const middle = middleParts.length > 0 ? `${middleParts.join('，')}。` : '情绪与惩罚记录平稳。';
  const tail = stats.tasksDelta > 0
    ? '整体比上周更主动，按当前节奏继续即可。'
    : stats.tasksDelta === 0
      ? '节奏与上周持平，保持稳定即可。'
      : '节奏比上周缓一些，可留意任务难度与情绪状态，先从小任务找回启动感。';
  return `${first}${middle}${tail}`;
};

// 再平衡信号（蓝图第 1 节）：只提示不动价。整数比较避免浮点。
const buildSuggestion = (stats: WeeklyStats): string => {
  // 金币结余两周增长 > 50%（current > prev2 * 1.5，等价 current*2 > prev2*3），小余额(<20)不触发
  if (
    stats.coinBalancePrev2 !== null &&
    stats.coinBalancePrev2 >= 20 &&
    stats.coinBalance * 2 > stats.coinBalancePrev2 * 3
  ) {
    return '商店奖品可能需要上新或调价';
  }
  // 完成率 < 40%（approved/total < 2/5，等价 approved*5 < total*2），提交不足 5 次不触发
  if (
    stats.completionRatePct !== null &&
    stats.totalEntries >= 5 &&
    stats.tasksCompleted * 5 < stats.totalEntries * 2
  ) {
    return '任务定价或难度可能偏高，可在创建页参考建议价';
  }
  return '';
};

// ==================== C. 生成主流程 ====================

let generating = false;

export const generateWeeklyReports = async (db?: any, now: Date = new Date()): Promise<void> => {
  if (generating) return;
  generating = true;
  try {
    const database = db || getDb();
    const weekStart = getTargetWeekStart(now);
    const children = await database.all(
      `SELECT id, familyId, name, coins FROM users WHERE role = 'child' AND familyId != 'TEMP'`
    );
    for (const child of children) {
      try {
        const existing = await database.get(
          'SELECT id FROM weekly_reports WHERE childId = ? AND weekStart = ?',
          child.id, weekStart
        );
        if (existing) continue;
        const stats = await collectStats(database, child, weekStart);
        await database.run(
          `INSERT OR IGNORE INTO weekly_reports (id, familyId, childId, weekStart, childStory, parentNarrative, statsJson, suggestion)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          randomUUID(),
          child.familyId,
          child.id,
          weekStart,
          buildChildStory(stats, `${child.id}:${weekStart}`),
          buildParentNarrative(String(child.name || '孩子'), stats),
          JSON.stringify(stats),
          buildSuggestion(stats)
        );
        logger.info(`[WeeklyReport] 已生成周报：${child.name || child.id}（周一 ${weekStart}）`);
      } catch (err: any) {
        logger.error('[WeeklyReport] 单孩子周报生成失败（不影响其他孩子）:', child.id, err?.message || err);
      }
    }
  } catch (err: any) {
    logger.error('[WeeklyReport] 周报生成失败:', err?.message || err);
  } finally {
    generating = false;
  }
};

// 调度器：启动时补上周缺失报告 + 每周日北京时间 20:00（setTimeout 链，参照 exploreFeed 调度写法）
const msUntilNextBeijingSunday20 = (): number => {
  const beijingNow = getBeijingDate();
  const next = new Date(beijingNow.getTime());
  next.setHours(20, 0, 0, 0);
  next.setDate(next.getDate() + ((7 - next.getDay()) % 7));
  if (next.getTime() <= beijingNow.getTime()) next.setDate(next.getDate() + 7);
  return next.getTime() - beijingNow.getTime();
};

export const startWeeklyReportScheduler = () => {
  // 启动后延迟几秒补生成（上周报告缺失时立即补齐），避开启动高峰
  setTimeout(() => { void generateWeeklyReports(); }, 8000);
  const scheduleNext = () => {
    const delay = msUntilNextBeijingSunday20();
    console.log(`[WeeklyReport] 下次周报生成：北京时间周日 20:00（约 ${Math.round(delay / 60000)} 分钟后）`);
    setTimeout(() => {
      void generateWeeklyReports().then(scheduleNext, scheduleNext);
    }, delay);
  };
  scheduleNext();
};

// ==================== D. 路由 ====================

export const registerWeeklyReportRoutes = (app: Express, protect: any, requireParent?: any, requireChild?: any) => {
  const parentGuards = requireParent ? [protect, requireParent] : [protect];
  const childGuards = requireChild ? [protect, requireChild] : [protect];

  // 家长端：周报列表（按周倒序，可选按孩子过滤）
  app.get('/api/parent/weekly-reports', ...parentGuards, async (req: any, res: any) => {
    const request = req as AuthRequest;
    const db = getDb();
    const limitRaw = Math.trunc(Number(req.query?.limit));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(26, limitRaw) : 8;
    const childId = String(req.query?.childId || '').trim();
    const params: any[] = [request.user!.familyId];
    let where = 'wr.familyId = ?';
    if (childId) {
      where += ' AND wr.childId = ?';
      params.push(childId);
    }
    const rows = await db.all(
      `SELECT wr.id, wr.childId, u.name as childName, wr.weekStart, wr.parentNarrative, wr.suggestion, wr.statsJson, wr.createdAt
         FROM weekly_reports wr
         JOIN users u ON wr.childId = u.id
        WHERE ${where}
        ORDER BY wr.weekStart DESC, wr.createdAt DESC
        LIMIT ?`,
      ...params, limit
    );
    res.json(rows.map((row: any) => {
      let stats: any = null;
      try { stats = JSON.parse(String(row.statsJson || '')); } catch { stats = null; }
      return {
        id: row.id,
        childId: row.childId,
        childName: row.childName,
        weekStart: row.weekStart,
        parentNarrative: row.parentNarrative,
        suggestion: row.suggestion || '',
        stats,
        createdAt: row.createdAt,
      };
    }));
  });

  // 孩子端：本孩子最新一条周报（成长故事卡）
  app.get('/api/child/weekly-report/latest', ...childGuards, async (req: any, res: any) => {
    const request = req as AuthRequest;
    const row = await getDb().get(
      'SELECT weekStart, childStory FROM weekly_reports WHERE childId = ? ORDER BY weekStart DESC LIMIT 1',
      request.user!.id
    );
    res.json(row || null);
  });
};
