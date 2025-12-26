import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { initializeDatabase, getDb } from './database';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'stellar-system-dev-secret-change-in-production';

// 启动时打印日志，便于调试
console.log('🔧 Initializing Express app...');

app.use(cors());
app.use(helmet());
app.use(express.json({ limit: '10mb' }));

// 请求日志中间件 - 用于调试
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`📥 [${new Date().toISOString()}] ${req.method} ${req.path} - Started`);
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`📤 [${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
});

interface AuthRequest extends Request { user?: { id: string; familyId: string; role: 'parent' | 'child'; }; }

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
           t.durationMinutes, t.category, t.taskType, t.customDays,
           (SELECT SUM(pr.deductedCoins) FROM punishment_records pr WHERE pr.taskEntryId = te.id) as punishmentDeduction
    FROM task_entries te 
    JOIN tasks t ON te.taskId = t.id
    WHERE te.childId = ? AND date(te.submittedAt, 'localtime') = ?
  `, childId, dateStr);
  
  if (isToday) {
    // === 今天：显示所有符合规则的任务 ===
    const allTasks = await db.all(`
      SELECT * FROM tasks 
      WHERE familyId = ? AND isEnabled = 1 
      AND (recurringTaskTemplateId IS NULL OR recurringTaskTemplateId = '')
    `, familyId);
    
    // 过滤出应该在今天出现的任务
    const tasksForToday = allTasks.filter((task: any) => shouldTaskAppearOnDate(task, targetDate));
    
    // 合并任务和完成状态
    return tasksForToday.map((task: any) => {
      const entry = entries.find((e: any) => e.taskId === task.id);
      // 被退回的任务应该显示为"待做"状态，让孩子可以重新开始
      const displayStatus = entry?.status === 'rejected' ? 'todo' : (entry?.status || 'todo');
      return {
        ...task,
        status: displayStatus,
        entryId: entry?.id,
        earnedCoins: entry?.earnedCoins,
        earnedXp: entry?.earnedXp,
        actualDurationMinutes: entry?.actualDurationMinutes,
        submittedAt: entry?.submittedAt,
        reviewedAt: entry?.reviewedAt,
        punishmentDeduction: entry?.punishmentDeduction || 0,
        canOperate: !entry || entry.status === 'rejected'
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
      status: entry.status,
      entryId: entry.id,
      earnedCoins: entry.earnedCoins,
      earnedXp: entry.earnedXp,
      actualDurationMinutes: entry.actualDurationMinutes,
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
  if (!child) return;
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
  
  // 连续天数统计（按类别）- 使用北京时间
  const getStreakDays = async (category?: string): Promise<number> => {
    // 获取所有已完成任务的提交时间
    const query = category 
      ? `SELECT DISTINCT te.submittedAt FROM task_entries te JOIN tasks t ON te.taskId = t.id WHERE te.childId = ? AND te.status = 'approved' AND t.category = ? ORDER BY te.submittedAt DESC`
      : `SELECT DISTINCT submittedAt FROM task_entries WHERE childId = ? AND status = 'approved' ORDER BY submittedAt DESC`;
    const entries = category 
      ? await db.all(query, childId, category)
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
      // 计算期望日期（北京时间）
      const beijingNow = getBeijingDate();
      const expectedDate = new Date(beijingNow.getTime());
      expectedDate.setDate(beijingNow.getDate() - i - startOffset);
      const expectedStr = `${expectedDate.getFullYear()}-${String(expectedDate.getMonth() + 1).padStart(2, '0')}-${String(expectedDate.getDate()).padStart(2, '0')}`;
      
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
          const catCount = categoryCountMap[def.conditionCategory] || 0;
          unlocked = catCount >= def.conditionValue;
          break;
        case 'streak_days':
          const streak = await getStreakDays(def.conditionCategory || undefined);
          unlocked = streak >= def.conditionValue;
          break;
      }
      
      if (unlocked) {
          const existing = await db.get('SELECT id FROM user_achievements WHERE childId = ? AND achievementId = ?', childId, def.id);
          if (!existing) await db.run('INSERT INTO user_achievements (id, childId, achievementId, unlockedAt) VALUES (?, ?, ?, ?)', randomUUID(), childId, def.id, new Date().toISOString());
      }
  }
};

const seedFamilyData = async (familyId: string, db: any) => {
    // 新家庭只预设成就定义，任务、商品、抽奖奖品等都需要家长手动添加
    // 预设成就 (10个) - 这些是系统默认成就，家长可以后续添加更多
    const achievements = [
        { title: '初来乍到', desc: '完成第1个任务', icon: '🌱', type: 'task_count', value: 1 },
        { title: '小小勤劳者', desc: '完成10个任务', icon: '🐝', type: 'task_count', value: 10 },
        { title: '任务达人', desc: '完成50个任务', icon: '🏆', type: 'task_count', value: 50 },
        { title: '任务大师', desc: '完成100个任务', icon: '👑', type: 'task_count', value: 100 },
        { title: '小小存钱罐', desc: '累计获得100金币', icon: '🐷', type: 'coin_count', value: 100 },
        { title: '财富小能手', desc: '累计获得500金币', icon: '💰', type: 'coin_count', value: 500 },
        { title: '金币大亨', desc: '累计获得1000金币', icon: '🏦', type: 'coin_count', value: 1000 },
        { title: '学习之星', desc: '在学习上表现出色', icon: '⭐', type: 'manual', value: 0 },
        { title: '劳动小蜜蜂', desc: '热爱劳动的好孩子', icon: '🧹', type: 'manual', value: 0 },
        { title: '运动健将', desc: '坚持运动锻炼身体', icon: '🏃', type: 'manual', value: 0 },
    ];
    for (const ach of achievements) {
        await db.run(`INSERT INTO achievement_defs (id, familyId, title, description, icon, conditionType, conditionValue) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
            randomUUID(), familyId, ach.title, ach.desc, ach.icon, ach.type, ach.value);
    }
};

// --- ROUTES ---

// Auth
app.post('/api/auth/login', async (req, res) => { 
    const db = getDb(); 
    const phone = req.body.phone;
    
    // 调试日志
    console.log('🔐 登录请求:', { phone: phone ? `${phone.substring(0, 3)}****${phone.substring(7)}` : 'null' });
    
    if (!phone) {
      return res.status(400).json({ message: '请输入手机号' });
    }
    
    const user = await db.get('SELECT * FROM users WHERE email = ?', phone); 
    
    if (!user) {
      console.log('❌ 用户不存在:', phone);
      return res.status(400).json({ message: '账号或密码错误' });
    }
    
    const passwordMatch = await bcrypt.compare(req.body.password, user.password);
    if (!passwordMatch) {
      console.log('❌ 密码错误:', phone);
      return res.status(400).json({ message: '账号或密码错误' });
    }
    
    console.log('✅ 登录成功:', { userId: user.id, name: user.name, role: user.role });
    res.json({ token: jwt.sign({ id: user.id, role: user.role, familyId: user.familyId }, JWT_SECRET), user: { id: user.id, name: user.name, role: user.role, familyId: user.familyId } }); 
});

app.post('/api/auth/register', async (req, res) => { 
    try {
        const { email, password } = req.body;
        
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
        
        // 检查手机号是否已注册
        const existingUser = await db.get('SELECT id FROM users WHERE email = ?', email);
        if (existingUser) {
            return res.status(400).json({ message: '该手机号已注册，请直接登录' });
        }
        
        const id = randomUUID();
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // 使用带重试的数据库操作
        await dbRunWithRetry(
            `INSERT INTO users (id, familyId, email, password, name, role) VALUES (?, 'TEMP', ?, ?, '家长', 'parent')`, 
            id, email, hashedPassword
        );
        
        res.json({ token: jwt.sign({ id, role: 'parent', familyId: 'TEMP' }, JWT_SECRET) });
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
    const fid = randomUUID(); 
    const { familyName, name, parentName, parentRole, childName, childGender, childBirthdate } = request.body;
    const actualFamilyName = familyName || name || '我的家庭'; // 兼容不同参数名

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
    
    res.json({message:'ok', token: jwt.sign({id:request.user!.id, role:'parent', familyId:fid}, JWT_SECRET)}); 
});

app.get('/api/auth/members', protect, async (req: any, res) => { 
    const request = req as AuthRequest;
    res.json(await getDb().all('SELECT id, name, role, avatar, pin, birthdate, gender FROM users WHERE familyId = ?', request.user!.familyId)); 
});

app.post('/api/auth/switch-user', protect, async (req, res) => { 
    const u = await getDb().get('SELECT * FROM users WHERE id = ?', req.body.targetUserId); 
    if (!u) return res.status(404).json({ message: '用户不存在' });
    // 只有家长设置了 PIN 且 PIN 不匹配时才拒绝
    if (u.role === 'parent' && u.pin && req.body.pin !== u.pin) {
        return res.status(403).json({ message: 'PIN错误' }); 
    }
    res.json({token:jwt.sign({id:u.id, role:u.role, familyId:u.familyId}, JWT_SECRET), user:u}); 
});

// Child switch to parent via PIN
// 如果家长没有设置PIN，使用默认PIN "1234"
app.post('/api/child/switch-to-parent', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const { pin } = request.body;
    const db = getDb();
    const parent = await db.get("SELECT * FROM users WHERE familyId = ? AND role = 'parent' LIMIT 1", request.user!.familyId);
    
    if (!parent) return res.status(404).json({ message: '未找到家长账号' });
    
    // 使用家长设置的PIN，如果没有设置则使用默认PIN "1234"
    const effectivePin = parent.pin || '1234';
    const isDefaultPin = !parent.pin;
    
    if (effectivePin !== pin) {
        return res.status(403).json({ message: 'PIN码错误' });
    }
    
    res.json({
        token: jwt.sign({ id: parent.id, role: parent.role, familyId: parent.familyId }, JWT_SECRET),
        user: { id: parent.id, name: parent.name, role: parent.role, familyId: parent.familyId },
        isDefaultPin // 告诉前端是否使用的是默认PIN
    });
});

// Parent Family Management
app.post('/api/parent/set-pin', protect, async (req: any, res) => { const request = req as AuthRequest; await getDb().run('UPDATE users SET pin = ? WHERE id = ?', request.body.pin, request.user!.id); res.json({message:'ok'}); });

app.delete('/api/parent/family/members/:id', protect, async (req: any, res) => { 
    const request = req as AuthRequest;
    if (request.user?.role !== 'parent') return res.status(403).json({message: '权限不足'});
    
    // 防止删除自己
    if (req.params.id === request.user!.id) return res.status(400).json({message: '不能删除自己'});
    
    await getDb().run('DELETE FROM users WHERE id = ?', req.params.id); 
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
    SELECT te.id, te.childId, t.coinReward, t.xpReward, te.submittedAt, t.title
    FROM task_entries te 
    JOIN tasks t ON te.taskId = t.id 
    WHERE t.familyId = ? AND te.status = 'pending'
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
    // 自动按中间档审批（综合评分加成 = 0%，即基础奖励）
    const coinsToAward = entry.coinReward;
    const xpToAward = entry.xpReward;
    const submitDateBeijing = getLocalDateString(new Date(entry.submittedAt));
    
    console.log(`  ✅ 自动审批任务 ${entry.id}，提交日期(北京时间)：${submitDateBeijing}，奖励：${coinsToAward}金币，${xpToAward}经验`);
    
    try {
      await db.run(
        "UPDATE task_entries SET status = 'approved', earnedCoins = ?, earnedXp = ?, rewardXp = ? WHERE id = ?",
        coinsToAward, xpToAward, xpToAward, entry.id
      );
      
      // 更新孩子的金币和经验
      await db.run('UPDATE users SET coins = coins + ?, xp = xp + ? WHERE id = ?', 
        coinsToAward, xpToAward, entry.childId);
      
      // 更新累计奖励经验并计算特权点（如果列存在）
      if (xpToAward > 0) {
        try {
          const child = await db.get('SELECT rewardXpTotal, privilegePoints FROM users WHERE id = ?', entry.childId);
          if (child && child.rewardXpTotal !== undefined) {
            const newAccumulatedXp = (child.rewardXpTotal || 0) + xpToAward;
            const newPrivilegePoints = Math.floor(newAccumulatedXp / 100);
            const oldPrivilegePoints = Math.floor((child.rewardXpTotal || 0) / 100);
            const pointsGained = newPrivilegePoints - oldPrivilegePoints;
            if (pointsGained > 0) {
              await db.run('UPDATE users SET rewardXpTotal = ?, privilegePoints = privilegePoints + ? WHERE id = ?',
                newAccumulatedXp, pointsGained, entry.childId);
            } else {
              await db.run('UPDATE users SET rewardXpTotal = ? WHERE id = ?', newAccumulatedXp, entry.childId);
            }
          }
        } catch (e) {
          // rewardXpTotal 列可能不存在，忽略错误
          console.log(`  ⚠️ 跳过累计经验更新（列可能不存在）`);
        }
      }
    } catch (error) {
      console.error(`  ❌ 自动审批任务 ${entry.id} 失败:`, error);
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
  
  // 调试：输出当前时间信息
  const serverNow = new Date();
  const localDateStr = getLocalDateString();
  console.log(`🕐 服务器时间：${serverNow.toISOString()}，本地日期：${localDateStr}，familyId：${familyId}`);
  
  // 自动审批过期任务（超过24小时未审批的任务）
  await autoApproveExpiredTasks(db, familyId);
  
  // 获取待审核任务，包含金币和经验信息（只显示启用任务的待审核记录）
  const pendingReviews = await db.all(`
    SELECT te.id, t.title, t.coinReward, t.xpReward, t.durationMinutes as expectedDuration,
           u.name as childName, te.submittedAt, te.proof, te.actualDurationMinutes as actualDuration,
           date(te.submittedAt, 'localtime') as submitDate
    FROM task_entries te 
    JOIN tasks t ON te.taskId = t.id 
    JOIN users u ON te.childId = u.id 
    WHERE t.familyId = ? AND te.status = 'pending' AND t.isEnabled = 1
    ORDER BY te.submittedAt DESC`, familyId);
  
  console.log(`📋 家长端查询待审核任务，找到 ${pendingReviews.length} 条记录`);
  if (pendingReviews.length > 0) {
    pendingReviews.forEach((r: any) => {
      console.log(`  - 任务：${r.title}，提交日期：${r.submitDate}，提交时间：${r.submittedAt}`);
    });
  }
  
  // 调试日志：如果查询结果为空，检查是否有 pending 状态的记录
  if (pendingReviews.length === 0) {
    const allPending = await db.all(`
      SELECT te.id, te.taskId, te.status, t.title, t.isEnabled, t.familyId, date(te.submittedAt, 'localtime') as submitDate
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
  
  // 本周统计 - 使用 LEFT JOIN 确保包含已删除任务的完成记录
  // 这样即使任务被删除（isEnabled = 0），历史统计数据也会保留
  const weekEntries = await db.all(`
    SELECT te.submittedAt, te.status, te.earnedCoins, te.actualDurationMinutes, 
           COALESCE(t.durationMinutes, 30) as expectedDuration
    FROM task_entries te 
    LEFT JOIN tasks t ON te.taskId = t.id 
    WHERE (t.familyId = ? OR t.familyId IS NULL) AND te.submittedAt >= date('now', '-7 days')
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = te.childId AND u.familyId = ?)`, familyId, familyId);
  
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
  
  // 获取最近已审核的任务（最近7天，最多20条）
  const recentReviewed = await db.all(`
    SELECT te.id, t.title, te.earnedCoins, te.earnedXp, te.status,
           u.name as childName, te.submittedAt, te.reviewedAt, te.actualDurationMinutes as actualDuration
    FROM task_entries te 
    JOIN tasks t ON te.taskId = t.id 
    JOIN users u ON te.childId = u.id 
    WHERE t.familyId = ? AND te.status IN ('approved', 'rejected') 
    AND te.submittedAt >= date('now', '-7 days')
    ORDER BY te.submittedAt DESC
    LIMIT 20`, familyId);
  
  res.json({ 
    pendingReviews,
    recentReviewed,
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
  const { date } = req.query; // 格式: YYYY-MM-DD
  
  let query = `
    SELECT te.id, t.title, te.earnedCoins, te.earnedXp, te.status,
           u.name as childName, te.submittedAt, te.reviewedAt, 
           te.actualDurationMinutes as actualDuration,
           date(te.submittedAt, 'localtime') as submitDate,
           (SELECT SUM(pr.deductedCoins) FROM punishment_records pr WHERE pr.taskEntryId = te.id) as punishmentDeduction
    FROM task_entries te 
    JOIN tasks t ON te.taskId = t.id 
    JOIN users u ON te.childId = u.id 
    WHERE t.familyId = ? AND te.status IN ('approved', 'rejected')
  `;
  
  const params: any[] = [familyId];
  
  if (date) {
    // 查询指定日期的记录
    query += ` AND date(te.submittedAt, 'localtime') = ?`;
    params.push(date);
  } else {
    // 默认返回最近7天
    query += ` AND te.submittedAt >= date('now', '-7 days', 'localtime')`;
  }
  
  query += ` ORDER BY te.submittedAt DESC LIMIT 50`;
  
  const records = await db.all(query, ...params);
  
  // 获取有审核记录的日期列表（最近30天）
  const datesWithRecords = await db.all(`
    SELECT DISTINCT date(te.submittedAt) as date, COUNT(*) as count
    FROM task_entries te 
    JOIN tasks t ON te.taskId = t.id 
    WHERE t.familyId = ? AND te.status IN ('approved', 'rejected')
    AND te.submittedAt >= date('now', '-30 days')
    GROUP BY date(te.submittedAt)
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
      children: []
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
      // 计算期望日期（北京时间）- 直接从北京时间计算，不需要二次转换
      const beijingNow = getBeijingDate();
      const expectedDate = new Date(beijingNow.getTime());
      expectedDate.setDate(beijingNow.getDate() - i - startOffset);
      // 直接提取年月日，因为 expectedDate 已经是北京时间
      const expectedStr = `${expectedDate.getFullYear()}-${String(expectedDate.getMonth() + 1).padStart(2, '0')}-${String(expectedDate.getDate()).padStart(2, '0')}`;
      
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
  
  const totalCategoryCount = categoryStats.reduce((sum, c) => sum + c.count, 0);
  const categoryWithPercent = categoryStats.map(c => ({
    category: c.category,
    count: c.count,
    percent: totalCategoryCount > 0 ? Math.round((c.count / totalCategoryCount) * 100) : 0
  }));
  
  // === 5. 每日平均任务完成数（最近30天）===
  const activeDays = (await db.get(`
    SELECT COUNT(DISTINCT date(submittedAt, 'localtime')) as days 
    FROM task_entries 
    WHERE childId IN (${childIdPlaceholders}) AND status = 'approved' 
    AND submittedAt >= DATE('now', '-30 days')
  `, ...childIds))?.days || 0;
  
  const dailyAverage = activeDays > 0 ? Math.round((monthTasks / activeDays) * 10) / 10 : 0;
  
  // === 6. 金币趋势（最近7天）===
  const coinTrend = await db.all(`
    SELECT date(submittedAt, 'localtime') as date, COALESCE(SUM(earnedCoins), 0) as earned
    FROM task_entries 
    WHERE childId IN (${childIdPlaceholders}) AND status = 'approved' 
    AND submittedAt >= date('now', '-7 days', 'localtime')
    GROUP BY date(submittedAt, 'localtime')
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
    children: childrenStats
  });
});

app.post('/api/parent/review/:entryId', protect, async (req: any, res) => {
    const { action, timeScore, qualityScore, initiativeScore, finalCoins } = req.body; 
    const entry = await getDb().get(`SELECT te.*, t.coinReward, t.xpReward FROM task_entries te JOIN tasks t ON te.taskId = t.id WHERE te.id = ?`, req.params.entryId);
    if (!entry) return res.status(404).json({ message: '不存在' });
    
    if (action === 'reject') { 
        await getDb().run("UPDATE task_entries SET status = 'rejected' WHERE id = ?", req.params.entryId); 
        return res.json({ message: '已打回' }); 
    }
    
    // 计算最终金币（如果前端传了 finalCoins 就用，否则用基础值）
    // 金币受评分影响（可以增加或减少）
    const coinsToAward = finalCoins !== undefined ? Math.round(finalCoins) : entry.coinReward;
    
    // 经验值（xp）不受评分影响，固定值，用于升级
    const xpToAward = entry.xpReward;
    
    // 奖励经验（rewardXp）不受评分影响，固定值，用于计算特权点
    // 奖励经验 = 基础经验值（固定，不受评分影响）
    const rewardXpToAward = entry.xpReward;
    
    // 更新任务记录，保存评分信息
    await getDb().run(
        "UPDATE task_entries SET status = 'approved', earnedCoins = ?, earnedXp = ?, rewardXp = ? WHERE id = ?", 
        coinsToAward, xpToAward, rewardXpToAward, req.params.entryId
    );
    
    // 更新孩子的金币、经验、奖励经验和特权点
    await getDb().run('BEGIN');
    await getDb().run('UPDATE users SET coins = coins + ?, xp = xp + ? WHERE id = ?', coinsToAward, xpToAward, entry.childId);
    
    // 更新累计奖励经验并计算特权点
    let privilegePointsAwarded = 0;
    if (rewardXpToAward > 0) {
        // 获取当前用户的累计奖励经验
        const user = await getDb().get('SELECT rewardXpTotal, privilegePoints FROM users WHERE id = ?', entry.childId);
        const oldRewardXpTotal = user.rewardXpTotal || 0;
        const newRewardXpTotal = oldRewardXpTotal + rewardXpToAward;
        
        // 计算应该获得的特权点：新累计值 / 100 - 旧累计值 / 100
        const oldPrivilegePoints = Math.floor(oldRewardXpTotal / 100);
        const newPrivilegePoints = Math.floor(newRewardXpTotal / 100);
        privilegePointsAwarded = newPrivilegePoints - oldPrivilegePoints;
        
        // 更新累计奖励经验和特权点
        await getDb().run('UPDATE users SET rewardXpTotal = ?, privilegePoints = privilegePoints + ? WHERE id = ?', 
            newRewardXpTotal, privilegePointsAwarded, entry.childId);
    }
    
    await getDb().run('COMMIT');
    
    await checkAchievements(entry.childId, getDb());
    res.json({ 
        message: '已通过', 
        coinsAwarded: coinsToAward, 
        xpAwarded: xpToAward,
        rewardXpAwarded: rewardXpToAward,
        privilegePointsAwarded: privilegePointsAwarded
    });
});

// 家长端查询任务：显示所有启用的任务（isEnabled = 1），排除实例任务（只显示普通任务和常用任务模板）
app.get('/api/parent/tasks', protect, async (req: any, res) => { 
    const request = req as AuthRequest; 
    // recurringTaskTemplateId 为 NULL 表示是普通任务或模板，不是自动生成的实例
    res.json(await getDb().all('SELECT * FROM tasks WHERE familyId = ? AND isEnabled = 1 AND recurringTaskTemplateId IS NULL', request.user!.familyId)); 
});

// 创建任务（支持三种任务类型：daily/once/custom）
app.post('/api/parent/tasks', protect, async (req: any, res) => { 
    const request = req as AuthRequest; 
    const { title, coinReward, xpReward, durationMinutes, category, icon, taskType, customDays } = request.body;
    
    // 获取今天日期（用于单次任务）
    const todayStr = getLocalDateString();
    
    await getDb().run(
        `INSERT INTO tasks (id, familyId, title, coinReward, xpReward, durationMinutes, category, icon, isEnabled, taskType, customDays, validDate) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`, 
        randomUUID(), 
        request.user!.familyId, 
        title, 
        coinReward, 
        xpReward, 
        durationMinutes, 
        category, 
        icon || '📋',
        taskType || 'daily',
        taskType === 'custom' ? JSON.stringify(customDays || []) : null,
        taskType === 'once' ? todayStr : null
    ); 
    res.json({message:'ok'}); 
});

// 更新任务（支持三种任务类型）
app.put('/api/parent/tasks/:id', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const task = await db.get('SELECT * FROM tasks WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
    if (!task) {
        return res.status(404).json({ message: '任务不存在' });
    }
    const { title, coinReward, xpReward, durationMinutes, category, icon, taskType, customDays } = req.body;
    
    const newTaskType = taskType ?? task.taskType ?? 'daily';
    
    await db.run(
        `UPDATE tasks SET title = ?, coinReward = ?, xpReward = ?, durationMinutes = ?, category = ?, icon = ?, 
         taskType = ?, customDays = ? WHERE id = ?`,
        title || task.title,
        coinReward ?? task.coinReward,
        xpReward ?? task.xpReward,
        durationMinutes ?? task.durationMinutes,
        category || task.category,
        icon || task.icon || '📋',
        newTaskType,
        newTaskType === 'custom' ? JSON.stringify(customDays || JSON.parse(task.customDays || '[]')) : null,
        req.params.id
    );
    res.json({ message: '更新成功' });
});

// 软删除任务：设置 isEnabled = 0，保留历史记录
app.delete('/api/parent/tasks/:id', protect, async (req: any, res) => { 
    const request = req as AuthRequest;
    const db = getDb();
    // 检查任务是否属于当前家庭
    const task = await db.get('SELECT * FROM tasks WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
    if (!task) {
        return res.status(404).json({ message: '任务不存在' });
    }
    // 软删除：设置 isEnabled = 0
    await db.run('UPDATE tasks SET isEnabled = 0 WHERE id = ?', req.params.id);
    // 返回已完成记录数，让家长知道这些记录被保留
    const completedCount = await db.get('SELECT COUNT(*) as count FROM task_entries WHERE taskId = ? AND status = ?', req.params.id, 'approved');
    res.json({ 
        message: '任务已删除', 
        preservedRecords: completedCount?.count || 0,
        note: completedCount?.count > 0 ? `已保留 ${completedCount.count} 条完成记录，统计数据不受影响` : undefined
    }); 
});
// 恢复已删除的任务
app.post('/api/parent/tasks/:id/restore', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const task = await db.get('SELECT * FROM tasks WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
    if (!task) {
        return res.status(404).json({ message: '任务不存在' });
    }
    await db.run('UPDATE tasks SET isEnabled = 1 WHERE id = ?', req.params.id);
    res.json({ message: '任务已恢复' });
});
// 查询已删除的任务（可选，供家长查看）
app.get('/api/parent/tasks/deleted', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    res.json(await getDb().all('SELECT * FROM tasks WHERE familyId = ? AND isEnabled = 0', request.user!.familyId));
});
app.get('/api/parent/wishes', protect, async (req: any, res) => { const request = req as AuthRequest; res.json(await getDb().all('SELECT * FROM wishes WHERE familyId = ?', request.user!.familyId)); });
app.post('/api/parent/wishes', protect, async (req: any, res) => { 
    const request = req as AuthRequest; 
    const weight = req.body.weight || 10;
    const rarity = req.body.rarity || null;
    await getDb().run(
        `INSERT INTO wishes (id, familyId, type, title, cost, targetAmount, icon, stock, isActive, weight, rarity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`, 
        randomUUID(), request.user!.familyId, req.body.type, req.body.title, req.body.cost, req.body.targetAmount, req.body.icon, req.body.stock, weight, rarity
    ); 
    res.json({message:'ok'}); 
});

// 更新奖品（包括权重和稀有度）
app.put('/api/parent/wishes/:id', protect, async (req: any, res) => {
    const { title, cost, icon, stock, weight, rarity, targetAmount } = req.body;
    await getDb().run(
        'UPDATE wishes SET title = ?, cost = ?, icon = ?, stock = ?, weight = ?, rarity = ?, targetAmount = ? WHERE id = ?',
        title, cost, icon, stock, weight || 10, rarity || null, targetAmount || 0, req.params.id
    );
    res.json({message:'ok'});
});

app.delete('/api/parent/wishes/:id', protect, async (req, res) => { await getDb().run('DELETE FROM wishes WHERE id = ?', req.params.id); res.json({message:'ok'}); });

// 抽奖奖池上架管理
app.post('/api/parent/wishes/lottery/activate', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const { activeIds } = request.body;
    
    if (!activeIds || activeIds.length !== 8) {
        return res.status(400).json({ message: '必须选择恰好8个奖品上架' });
    }
    
    const db = getDb();
    const familyId = request.user!.familyId;
    
    // 先将该家庭所有抽奖奖品设为未上架
    await db.run('UPDATE wishes SET isActive = 0 WHERE familyId = ? AND type = ?', familyId, 'lottery');
    
    // 然后将选中的奖品设为上架
    for (const id of activeIds) {
        await db.run('UPDATE wishes SET isActive = 1 WHERE id = ? AND familyId = ? AND type = ?', id, familyId, 'lottery');
    }
    
    res.json({ message: 'ok' });
});
app.get('/api/parent/privileges', protect, async (req: any, res) => { const request = req as AuthRequest; res.json(await getDb().all('SELECT * FROM privileges WHERE familyId = ?', request.user!.familyId)); });
app.post('/api/parent/privileges', protect, async (req: any, res) => { 
    const request = req as AuthRequest; 
    const { title, description, cost, icon } = request.body;
    await getDb().run(
        `INSERT INTO privileges (id, familyId, title, description, cost, icon) VALUES (?, ?, ?, ?, ?, ?)`, 
        randomUUID(), request.user!.familyId, title, description, cost, icon || '👑'
    ); 
    res.json({message:'ok'}); 
});
app.put('/api/parent/privileges/:id', protect, async (req: any, res) => {
    const { title, description, cost, icon } = req.body;
    await getDb().run('UPDATE privileges SET title = ?, description = ?, cost = ?, icon = ? WHERE id = ?', title, description, cost, icon, req.params.id);
    res.json({ message: '更新成功' });
});
app.delete('/api/parent/privileges/:id', protect, async (req, res) => { await getDb().run('DELETE FROM privileges WHERE id = ?', req.params.id); res.json({message:'ok'}); });
app.get('/api/parent/achievements', protect, async (req: any, res) => { const request = req as AuthRequest; res.json(await getDb().all('SELECT * FROM achievement_defs WHERE familyId = ?', request.user!.familyId)); });
app.post('/api/parent/achievements', protect, async (req: any, res) => { 
    const request = req as AuthRequest; 
    const { title, description, icon, conditionType, conditionValue, conditionCategory } = request.body;
    
    // 检查是否已存在同名成就
    const existing = await getDb().get(
        'SELECT id FROM achievement_defs WHERE familyId = ? AND title = ?', 
        request.user!.familyId, title
    );
    if (existing) {
        return res.status(400).json({ message: '已存在同名成就，请使用其他名称' });
    }
    
    await getDb().run(
        `INSERT INTO achievement_defs (id, familyId, title, description, icon, conditionType, conditionValue, conditionCategory) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
        randomUUID(), request.user!.familyId, title, description, icon, 
        conditionType, conditionValue, conditionCategory || null
    ); 
    res.json({message:'ok'}); 
});
app.put('/api/parent/achievements/:id', protect, async (req: any, res) => { 
    const request = req as AuthRequest; 
    const { title, description, icon, conditionType, conditionValue, conditionCategory } = request.body;
    await getDb().run(
        `UPDATE achievement_defs SET title = ?, description = ?, icon = ?, conditionType = ?, conditionValue = ?, conditionCategory = ? WHERE id = ? AND familyId = ?`, 
        title, description, icon, conditionType, conditionValue, conditionCategory || null, req.params.id, request.user!.familyId
    ); 
    res.json({message:'ok'}); 
});
app.delete('/api/parent/achievements/:id', protect, async (req, res) => { await getDb().run('DELETE FROM achievement_defs WHERE id = ?', req.params.id); res.json({message:'ok'}); });

// Child
app.get('/api/child/dashboard', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb(); const childId = request.user!.id;
    
    // 支持日期参数，用于历史回看
    const dateParam = req.query.date as string;
    const targetDate = dateParam ? new Date(dateParam + 'T00:00:00') : new Date();
    
    // 获取指定日期的任务（使用新函数）
    const tasks = await getTasksForDate(db, request.user!.familyId, childId, targetDate);
    
    // 统计过去7天数据
    const today = new Date(); const last7Days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        const dateStr = getLocalDateString(d);
        // 统计当日收入（任务奖励）
        const dayEarned = (await db.get(`SELECT COALESCE(sum(earnedCoins), 0) as s FROM task_entries WHERE childId = ? AND status = 'approved' AND date(submittedAt) = ?`, childId, dateStr)).s || 0;
        // 统计当日消耗（商店购买，只统计金币购买的）
        const daySpent = (await db.get(`SELECT COALESCE(sum(cost), 0) as s FROM user_inventory WHERE childId = ? AND costType = 'coins' AND status != 'cancelled' AND date(acquiredAt) = ?`, childId, dateStr)).s || 0;
        last7Days.push({ date: dateStr, earned: dayEarned, spent: daySpent, coins: dayEarned - daySpent });
    }
    
    const isToday = getLocalDateString(targetDate) === getLocalDateString(today);
    
    // 获取孩子数据并计算真实等级
    const childInfo = await db.get('SELECT * FROM users WHERE id = ?', childId);
    if (childInfo) {
        // 等级根据XP实时计算：每100XP升一级
        childInfo.level = Math.floor((childInfo.xp || 0) / 100) + 1;
        // maxXp为下一级所需经验 (当前级别 * 100)
        childInfo.maxXp = childInfo.level * 100;
    }
    
    res.json({ 
        child: childInfo, 
        tasks,
        weeklyStats: last7Days,
        viewingDate: getLocalDateString(targetDate),
        isToday
    });
});
app.post('/api/child/tasks/:taskId/complete', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const { duration } = request.body;
    const db = getDb();
    const taskId = req.params.taskId;
    const childId = request.user!.id;
    const now = new Date().toISOString();
    
    // 检查是否有被退回的记录（今天的），如果有则更新而不是新建
    const today = getLocalDateString();
    const existingEntry = await db.get(
        `SELECT id FROM task_entries 
         WHERE taskId = ? AND childId = ? AND status = 'rejected' 
         AND date(submittedAt, 'localtime') = ?`,
        taskId, childId, today
    );
    
    let entryId: string;
    
    if (existingEntry) {
        // 更新被退回的记录
        entryId = existingEntry.id;
        await db.run(
            `UPDATE task_entries SET status = 'pending', submittedAt = ?, actualDurationMinutes = ? WHERE id = ?`,
            now, duration || 0, entryId
        );
        console.log(`📝 孩子 ${childId} 重新提交任务 ${taskId}，更新记录 ${entryId}`);
    } else {
        // 创建新记录
        entryId = randomUUID();
        await db.run(
            `INSERT INTO task_entries (id, taskId, childId, status, submittedAt, actualDurationMinutes) VALUES (?, ?, ?, 'pending', ?, ?)`,
            entryId, taskId, childId, now, duration || 0
        );
        console.log(`📝 孩子 ${childId} 提交任务 ${taskId}，创建记录 ${entryId}，状态：pending`);
    }
    
    // 验证记录已创建
    const verifyEntry = await db.get('SELECT id, status, submittedAt FROM task_entries WHERE id = ?', entryId);
    if (verifyEntry) {
        console.log(`✅ 任务提交成功，记录ID：${verifyEntry.id}，状态：${verifyEntry.status}，提交时间：${verifyEntry.submittedAt}`);
    } else {
        console.error(`❌ 任务提交失败，记录未找到！`);
    }
    
    res.json({ message: 'submitted', entryId });
});
app.get('/api/child/wishes', protect, async (req: any, res) => { 
    const request = req as AuthRequest;
    res.json({ 
        savings: await getDb().get("SELECT * FROM wishes WHERE familyId = ? AND type='savings'", request.user!.familyId), 
        shop: await getDb().all("SELECT * FROM wishes WHERE familyId = ? AND type='shop'", request.user!.familyId), 
        // 抽奖奖池只返回已上架且有库存的奖品 (stock = -1 或 NULL 表示无限库存)
        lottery: await getDb().all("SELECT * FROM wishes WHERE familyId = ? AND type='lottery' AND isActive = 1 AND (stock IS NULL OR stock = -1 OR stock > 0)", request.user!.familyId) 
    }); 
});
app.post('/api/child/wishes/:id/redeem', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb(); 
    const wish = await db.get('SELECT * FROM wishes WHERE id = ?', req.params.id);
    if (!wish) return res.status(404).json({message:'商品不存在'});
    // stock: null/undefined/负数 表示无限库存，0 表示无库存
    if (wish.stock === 0) return res.status(400).json({message:'库存不足'});
    
    const user = await db.get('SELECT coins FROM users WHERE id = ?', request.user!.id); 
    if(user.coins < wish.cost) return res.status(400).json({message:'金币不足'});
    
    try {
        await db.run('BEGIN'); 
        await db.run('UPDATE users SET coins = coins - ? WHERE id = ?', wish.cost, request.user!.id); 
        // 只有 stock > 0 时才减库存（null/-1 表示无限库存）
        if(wish.stock !== null && wish.stock !== -1 && wish.stock > 0) {
            await db.run('UPDATE wishes SET stock = stock - 1 WHERE id = ?', wish.id);
        }
        // 商店商品添加到背包，记录是用金币兑换的，来源为shop
        await db.run(`INSERT INTO user_inventory (id, childId, wishId, title, icon, cost, costType, source, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`, 
            randomUUID(), request.user!.id, wish.id, wish.title, wish.icon, wish.cost, 'coins', 'shop');
        await db.run('COMMIT'); 
        res.json({message:'兑换成功！已放入背包'});
    } catch (err) {
        await db.run('ROLLBACK');
        console.error('兑换失败:', err);
        return res.status(500).json({message: '兑换失败，请重试'});
    }
});
app.get('/api/child/inventory', protect, async (req: any, res) => { const request = req as AuthRequest; res.json(await getDb().all('SELECT * FROM user_inventory WHERE childId = ? ORDER BY acquiredAt DESC', request.user!.id)); });
// 撤销兑换（退还金币或特权点）- 抽奖物品和储蓄达成物品不可撤销，每类商品最多撤销一次
app.post('/api/child/inventory/:id/cancel', protect, async (req: any, res) => { 
    const request = req as AuthRequest;
    const db = getDb();
    const item = await db.get('SELECT * FROM user_inventory WHERE id = ? AND childId = ?', req.params.id, request.user!.id);
    if (!item) return res.status(404).json({message: '物品不存在'});
    if (item.status === 'cancelled' || item.status === 'returned') return res.status(400).json({message: '已撤销'});
    if (item.status === 'redeemed' || item.status === 'used') return res.status(400).json({message: '已兑现的物品无法撤销'});
    // 抽奖物品和储蓄达成物品不可撤销
    if (item.source === 'lottery') return res.status(400).json({message: '抽奖获得的物品无法撤销'});
    if (item.source === 'savings') return res.status(400).json({message: '储蓄达成的物品无法撤销'});
    
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
    
    await db.run('BEGIN');
    await db.run("UPDATE user_inventory SET status = 'cancelled', cancelCount = COALESCE(cancelCount, 0) + 1 WHERE id = ?", req.params.id);
    
    // 根据 costType 退还金币或特权点
    const costType = item.costType || 'coins'; // 兼容旧数据，默认为金币
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
    
    await db.run('COMMIT');
    res.json({
        message: costType === 'privilegePoints' ? '已撤销，特权点已退回' : '已撤销，金币已退回'
    }); 
});

// 兑现物品/服务
app.post('/api/child/inventory/:id/redeem', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const item = await db.get('SELECT * FROM user_inventory WHERE id = ? AND childId = ?', req.params.id, request.user!.id);
    if (!item) return res.status(404).json({message: '物品不存在'});
    if (item.status === 'redeemed' || item.status === 'used') return res.status(400).json({message: '已兑现'});
    if (item.status === 'cancelled' || item.status === 'returned') return res.status(400).json({message: '已撤销的物品无法兑现'});
    
    await db.run("UPDATE user_inventory SET status = 'redeemed', redeemedAt = ? WHERE id = ?", new Date().toISOString(), req.params.id);
    res.json({message:'兑现成功！'});
});

// 储蓄存入
app.post('/api/child/savings/deposit', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const { amount } = req.body;
    const db = getDb();
    
    if (!amount || amount <= 0) return res.status(400).json({ message: '存入金额无效' });
    
    const user = await db.get('SELECT coins FROM users WHERE id = ?', request.user!.id);
    if (user.coins < amount) return res.status(400).json({ message: '金币不足' });
    
    const savings = await db.get("SELECT * FROM wishes WHERE familyId = ? AND type = 'savings'", request.user!.familyId);
    if (!savings) return res.status(404).json({ message: '没有储蓄目标' });
    
    await db.run('BEGIN');
    await db.run('UPDATE users SET coins = coins - ? WHERE id = ?', amount, request.user!.id);
    const newAmount = (savings.currentAmount || 0) + amount;
    await db.run('UPDATE wishes SET currentAmount = ? WHERE id = ?', newAmount, savings.id);
    
    // 如果达成目标，自动添加到背包
    let goalAchieved = false;
    if (newAmount >= savings.targetAmount && (savings.currentAmount || 0) < savings.targetAmount) {
        goalAchieved = true;
        // 储蓄目标达成，免费获得，cost=0，source='savings'
        await db.run(`INSERT INTO user_inventory (id, childId, wishId, title, icon, cost, costType, source, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`, 
            randomUUID(), request.user!.id, savings.id, savings.title, savings.icon, 0, 'coins', 'savings');
    }
    
    await db.run('COMMIT');
    res.json({ message: goalAchieved ? '🎉 目标达成！已放入背包' : '存入成功', newAmount, goalAchieved });
});

// --- 抽奖费用计算 ---
// 规则：第1次5金币，第2次10金币，第3次20金币，第4次35金币...
// 公式：cost(n) = 5 * (1 + n*(n+1)/2)，其中 n = 今日已抽奖次数（从0开始）
const getLotteryCost = (todayDrawCount: number): number => {
    const n = todayDrawCount;
    return 5 * (1 + (n * (n + 1)) / 2);
};

// 获取抽奖信息（当前费用、今日次数）
app.get('/api/child/lottery/info', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const today = getLocalDateString();
    
    // 统计今日抽奖次数（通过背包中今日获得的抽奖物品数量）
    // 使用本地时区进行日期比较
    const todayCount = (await db.get(
        `SELECT COUNT(*) as count FROM user_inventory 
         WHERE childId = ? AND source = 'lottery' AND date(acquiredAt, 'localtime') = ?`,
        request.user!.id, today
    ))?.count || 0;
    
    const currentCost = getLotteryCost(todayCount);
    const nextCost = getLotteryCost(todayCount + 1);
    
    res.json({
        todayDrawCount: todayCount,
        currentCost,
        nextCost
    });
});

app.post('/api/child/lottery/play', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const today = getLocalDateString();
    
    // 统计今日抽奖次数（使用本地时区进行日期比较）
    const todayCount = (await db.get(
        `SELECT COUNT(*) as count FROM user_inventory 
         WHERE childId = ? AND source = 'lottery' AND date(acquiredAt, 'localtime') = ?`,
        request.user!.id, today
    ))?.count || 0;
    
    const cost = getLotteryCost(todayCount);
    
    const user = await db.get('SELECT coins FROM users WHERE id = ?', request.user!.id); 
    if(user.coins < cost) return res.status(400).json({message: `金币不足，本次抽奖需要 ${cost} 金币`});
    
    // 只获取已上架且有库存的奖品 (stock = -1 或 NULL 表示无限库存，0 表示无库存)
    const prizes = await db.all("SELECT * FROM wishes WHERE familyId = ? AND type = 'lottery' AND isActive = 1 AND (stock IS NULL OR stock = -1 OR stock > 0)", request.user!.familyId);
    if(prizes.length === 0) return res.status(400).json({message:'奖池空或奖品已抽完'});
    
    // 加权随机算法
    const totalWeight = prizes.reduce((sum: number, p: any) => sum + (p.weight || 10), 0);
    let random = Math.random() * totalWeight;
    let prize = prizes[0];
    for (const p of prizes) {
        random -= (p.weight || 10);
        if (random <= 0) { prize = p; break; }
    }
    
    try {
        await db.run('BEGIN'); 
        await db.run('UPDATE users SET coins = coins - ? WHERE id = ?', cost, request.user!.id); 
        
        // 库存 -1 或 NULL 表示无限，不扣减；stock > 0 时扣减
        if (prize.stock !== null && prize.stock !== -1 && prize.stock > 0) {
            await db.run('UPDATE wishes SET stock = stock - 1 WHERE id = ?', prize.id);
        }
        
        // 抽奖奖品添加到背包，记录实际消耗的金币
        await db.run(`INSERT INTO user_inventory (id, childId, wishId, title, icon, cost, costType, source, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`, 
            randomUUID(), request.user!.id, prize.id, prize.title, prize.icon, cost, 'coins', 'lottery');
        await db.run('COMMIT');
        
        // 返回中奖信息和下次抽奖费用
        const nextCost = getLotteryCost(todayCount + 1);
        res.json({ winner: prize, cost, nextCost, todayDrawCount: todayCount + 1 });
    } catch (err) {
        await db.run('ROLLBACK');
        console.error('抽奖失败:', err);
        return res.status(500).json({message: '抽奖失败，请重试'});
    }
});
app.get('/api/child/achievements', protect, async (req: any, res) => { const request = req as AuthRequest; res.json(await getDb().all(`SELECT ua.unlockedAt, ad.title, ad.description, ad.icon FROM user_achievements ua JOIN achievement_defs ad ON ua.achievementId = ad.id WHERE ua.childId = ?`, request.user!.id)); });

// Child All Achievements (包含未解锁的，显示进度)
app.get('/api/child/all-achievements', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const childId = request.user!.id;
    const familyId = request.user!.familyId;
    
    // 获取所有成就定义
    const allDefs = await db.all('SELECT * FROM achievement_defs WHERE familyId = ?', familyId);
    
    // 获取已解锁的成就
    const unlocked = await db.all('SELECT achievementId, unlockedAt FROM user_achievements WHERE childId = ?', childId);
    const unlockedMap = new Map(unlocked.map(u => [u.achievementId, u.unlockedAt]));
    
    // 获取进度数据
    const taskCount = (await db.get('SELECT COUNT(*) as count FROM task_entries WHERE childId = ? AND status = "approved"', childId))?.count || 0;
    const child = await db.get('SELECT coins, xp FROM users WHERE id = ?', childId);
    const totalCoins = child?.coins || 0;
    const totalXp = child?.xp || 0;
    const level = Math.floor(totalXp / 100) + 1;
    
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
    
    // 连续天数计算函数 - 使用北京时间
    const getStreakDays = async (category?: string): Promise<number> => {
      // 获取所有已完成任务的提交时间
      const query = category 
        ? `SELECT DISTINCT te.submittedAt FROM task_entries te JOIN tasks t ON te.taskId = t.id WHERE te.childId = ? AND te.status = 'approved' AND t.category = ? ORDER BY te.submittedAt DESC`
        : `SELECT DISTINCT submittedAt FROM task_entries WHERE childId = ? AND status = 'approved' ORDER BY submittedAt DESC`;
      const entries = category 
        ? await db.all(query, childId, category)
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
        // 计算期望日期（北京时间）
        const beijingNow = getBeijingDate();
        const expectedDate = new Date(beijingNow.getTime());
        expectedDate.setDate(beijingNow.getDate() - i - startOffset);
        const expectedStr = `${expectedDate.getFullYear()}-${String(expectedDate.getMonth() + 1).padStart(2, '0')}-${String(expectedDate.getDate()).padStart(2, '0')}`;
        
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
    for (const cat of ['劳动', '学习', '兴趣', '运动']) {
      streakCache[cat] = await getStreakDays(cat);
    }
    
    // 组装结果
    const result = allDefs.map(def => {
        const isUnlocked = unlockedMap.has(def.id);
        let progress = 0;
        
        if (!isUnlocked) {
            switch (def.conditionType) {
              case 'task_count': progress = taskCount; break;
              case 'coin_count': progress = totalCoins; break;
              case 'xp_count': progress = totalXp; break;
              case 'level_reach': progress = level; break;
              case 'category_count': progress = categoryCountMap[def.conditionCategory] || 0; break;
              case 'streak_days': progress = def.conditionCategory ? (streakCache[def.conditionCategory] || 0) : streakCache['__all__']; break;
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
            unlocked: isUnlocked,
            unlockedAt: unlockedMap.get(def.id) || null,
            progress
        };
    });
    
    // 已解锁的排前面
    result.sort((a, b) => (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0));
    
    res.json(result);
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
    const priv = await db.get('SELECT * FROM privileges WHERE id = ?', req.params.id);
    if (!priv) return res.status(404).json({ message: '特权不存在' });
    
    const user = await db.get('SELECT privilegePoints FROM users WHERE id = ?', request.user!.id);
    if ((user.privilegePoints || 0) < priv.cost) return res.status(400).json({ message: '特权点不足' });
    
    await db.run('BEGIN');
    await db.run('UPDATE users SET privilegePoints = privilegePoints - ? WHERE id = ?', priv.cost, request.user!.id);
    // 特权添加到背包，记录是用特权点兑换的，来源为privilege
    await db.run(`INSERT INTO user_inventory (id, childId, privilegeId, title, icon, cost, costType, source, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`, 
        randomUUID(), request.user!.id, priv.id, priv.title, '👑', priv.cost, 'privilegePoints', 'privilege');
    await db.run('COMMIT');
    res.json({ message: '兑换成功！已放入背包' });
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
                allowNegative, negativeLimit, notifyChild, requireReason
            ) VALUES (?, ?, 0,
                '轻度警告', 0.3, 2, 10,
                '中度惩罚', 0.5, 5, 20,
                '严重惩罚', 1.0, 5, 50,
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
        allowNegative, negativeLimit, notifyChild, requireReason
    } = req.body;
    
    // 检查设置是否存在
    const existing = await db.get('SELECT id FROM punishment_settings WHERE familyId = ?', familyId);
    
    if (existing) {
        // 更新现有设置
        await db.run(`
            UPDATE punishment_settings SET
                enabled = ?, mildName = ?, mildRate = ?, mildMin = ?, mildMax = ?,
                moderateName = ?, moderateRate = ?, moderateMin = ?, moderateMax = ?,
                severeName = ?, severeRate = ?, severeExtra = ?, severeMax = ?,
                allowNegative = ?, negativeLimit = ?, notifyChild = ?, requireReason = ?,
                updatedAt = CURRENT_TIMESTAMP
            WHERE familyId = ?
        `, 
            enabled, mildName, mildRate, mildMin, mildMax,
            moderateName, moderateRate, moderateMin, moderateMax,
            severeName, severeRate, severeExtra, severeMax,
            allowNegative, negativeLimit, notifyChild, requireReason,
            familyId
        );
    } else {
        // 创建新设置
        await db.run(`
            INSERT INTO punishment_settings (
                id, familyId, enabled,
                mildName, mildRate, mildMin, mildMax,
                moderateName, moderateRate, moderateMin, moderateMax,
                severeName, severeRate, severeExtra, severeMax,
                allowNegative, negativeLimit, notifyChild, requireReason
            ) VALUES (?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?)
        `,
            randomUUID(), familyId, enabled,
            mildName, mildRate, mildMin, mildMax,
            moderateName, moderateRate, moderateMin, moderateMax,
            severeName, severeRate, severeExtra, severeMax,
            allowNegative, negativeLimit, notifyChild, requireReason
        );
    }
    
    res.json({ message: '设置已保存' });
});

// 惩罚计算辅助函数
const calculatePunishment = (taskReward: number, level: string, settings: any): number => {
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

// 执行惩罚（任务审核时调用）
app.post('/api/parent/task-entries/:id/punish', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const entryId = req.params.id;
    const { level, reason } = req.body; // level: 'mild' | 'moderate' | 'severe'
    
    if (!level || !reason) {
        return res.status(400).json({ message: '缺少惩罚等级或原因' });
    }
    
    if (!['mild', 'moderate', 'severe'].includes(level)) {
        return res.status(400).json({ message: '无效的惩罚等级' });
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
    
    // 获取惩罚设置
    const settings = await db.get('SELECT * FROM punishment_settings WHERE familyId = ?', entry.familyId);
    
    if (!settings || !settings.enabled) {
        return res.status(400).json({ message: '惩罚功能未启用' });
    }
    
    if (settings.requireReason && !reason.trim()) {
        return res.status(400).json({ message: '必须填写惩罚原因' });
    }
    
    // 计算扣除金币数
    const deduction = calculatePunishment(entry.coinReward, level, settings);
    
    // 获取孩子当前金币
    const child = await db.get('SELECT coins FROM users WHERE id = ?', entry.childId);
    const balanceBefore = child.coins;
    
    // 计算扣除后的余额（考虑保护限制）
    let balanceAfter = balanceBefore - deduction;
    if (settings.allowNegative) {
        balanceAfter = Math.max(settings.negativeLimit, balanceAfter);
    } else {
        balanceAfter = Math.max(0, balanceAfter);
    }
    
    const actualDeduction = balanceBefore - balanceAfter;
    
    try {
        await db.run('BEGIN');
        
        // 扣除金币
        await db.run('UPDATE users SET coins = ? WHERE id = ?', balanceAfter, entry.childId);
        
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
        
        await db.run('COMMIT');
        
        res.json({
            message: '惩罚已执行',
            deducted: actualDeduction,
            balanceAfter,
            notified: settings.notifyChild
        });
    } catch (err) {
        await db.run('ROLLBACK');
        console.error('执行惩罚失败:', err);
        return res.status(500).json({ message: '执行惩罚失败，请重试' });
    }
});

// 查询惩罚记录（家长端）
app.get('/api/parent/punishment-records', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const familyId = request.user!.familyId;
    const { childId, startDate, endDate, limit = 50 } = req.query;
    
    let query = `
        SELECT pr.*, 
               u.name as childName, 
               p.name as parentName,
               t.title as taskTitle
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
    
    if (startDate) {
        query += ' AND date(pr.createdAt) >= ?';
        params.push(startDate);
    }
    
    if (endDate) {
        query += ' AND date(pr.createdAt) <= ?';
        params.push(endDate);
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
    const { limit = 20, timeFilter } = req.query; // timeFilter: 'today' | 'week' | 'month' | 'all'
    
    let query = `
        SELECT pr.*, 
               p.name as parentName,
               t.title as taskTitle
        FROM punishment_records pr
        JOIN users p ON pr.parentId = p.id
        JOIN tasks t ON pr.taskId = t.id
        WHERE pr.childId = ?
    `;
    
    const params: any[] = [childId];
    
    // 时间筛选
    if (timeFilter === 'today') {
        query += ` AND date(pr.createdAt, 'localtime') = date('now', 'localtime')`;
    } else if (timeFilter === 'week') {
        query += ` AND pr.createdAt >= date('now', '-7 days', 'localtime')`;
    } else if (timeFilter === 'month') {
        query += ` AND pr.createdAt >= date('now', '-30 days', 'localtime')`;
    }
    // 'all' 不添加时间限制
    
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
        'SELECT COUNT(*) as count FROM punishment_records WHERE childId = ? AND createdAt >= date(\'now\', \'-7 days\', \'localtime\')', 
        childId
    ))?.count || 0;
    
    // 前7天（8-14天前）惩罚次数（用于趋势对比）
    const prevWeekCount = (await db.get(
        'SELECT COUNT(*) as count FROM punishment_records WHERE childId = ? AND createdAt >= date(\'now\', \'-14 days\', \'localtime\') AND createdAt < date(\'now\', \'-7 days\', \'localtime\')', 
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

// 惩罚统计（家长端）
app.get('/api/parent/punishment-stats', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const familyId = request.user!.familyId;
    
    // 总惩罚次数
    const totalCount = (await db.get(
        'SELECT COUNT(*) as count FROM punishment_records WHERE familyId = ?', 
        familyId
    ))?.count || 0;
    
    // 本周惩罚次数
    const weekCount = (await db.get(
        'SELECT COUNT(*) as count FROM punishment_records WHERE familyId = ? AND createdAt >= date(\'now\', \'-7 days\')', 
        familyId
    ))?.count || 0;
    
    // 按等级统计
    const byLevel = await db.all(`
        SELECT level, COUNT(*) as count, SUM(deductedCoins) as totalDeducted
        FROM punishment_records
        WHERE familyId = ?
        GROUP BY level
    `, familyId);
    
    // 按孩子统计
    const byChild = await db.all(`
        SELECT pr.childId, u.name as childName, 
               COUNT(*) as count, 
               SUM(pr.deductedCoins) as totalDeducted
        FROM punishment_records pr
        JOIN users u ON pr.childId = u.id
        WHERE pr.familyId = ?
        GROUP BY pr.childId
    `, familyId);
    
    res.json({
        totalCount,
        weekCount,
        byLevel,
        byChild
    });
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
  .then(() => {
    console.log('✅ Database initialized successfully');
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
    
    // 未捕获异常处理 - 记录但不退出
    process.on('uncaughtException', (error) => {
      console.error('💥 Uncaught Exception:', error);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('💥 Unhandled Rejection:', reason);
    });
  })
  .catch((error) => {
    console.error('❌ Failed to initialize database:', error);
    process.exit(1);
  });
