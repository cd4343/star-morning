import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { initializeDatabase, getDb } from './database';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const JWT_SECRET = 'your-super-secret-key-change-it';

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
  const taskCount = (await db.get('SELECT COUNT(*) as count FROM task_entries WHERE childId = ? AND status = "approved"', childId)).count;
  for (const def of defs) {
      let unlocked = false;
      if (def.conditionType === 'task_count' && taskCount >= def.conditionValue) unlocked = true;
      if (def.conditionType === 'coin_count' && child.coins >= def.conditionValue) unlocked = true;
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
    const user = await db.get('SELECT * FROM users WHERE email = ?', req.body.phone); 
    if (!user || !(await bcrypt.compare(req.body.password, user.password))) return res.status(400).json({ message: '账号或密码错误' }); 
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

// Parent Dashboard & Features
app.get('/api/parent/dashboard', protect, async (req: any, res) => {
  const request = req as AuthRequest;
  const db = getDb(); const familyId = request.user!.familyId;
  // 注意：不再自动种子数据，种子数据只在创建家庭时执行一次
  
  // 获取待审核任务，包含金币和经验信息（只显示启用任务的待审核记录）
  const pendingReviews = await db.all(`
    SELECT te.id, t.title, t.coinReward, t.xpReward, t.durationMinutes as expectedDuration,
           u.name as childName, te.submittedAt, te.proof, te.actualDurationMinutes as actualDuration
    FROM task_entries te 
    JOIN tasks t ON te.taskId = t.id 
    JOIN users u ON te.childId = u.id 
    WHERE t.familyId = ? AND te.status = 'pending' AND t.isEnabled = 1`, familyId);
  
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
  
  res.json({ 
    pendingReviews, 
    stats: { 
      weekTasks: total, 
      weekCompleted: completed,
      completionRate: `${rate}%`, 
      punctualRate: `${punctualRate}%`,
      totalCoinsEarned
    } 
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

// 家长端查询任务：显示所有启用的任务（isEnabled = 1）
app.get('/api/parent/tasks', protect, async (req: any, res) => { 
    const request = req as AuthRequest; 
    res.json(await getDb().all('SELECT * FROM tasks WHERE familyId = ? AND isEnabled = 1', request.user!.familyId)); 
});
app.post('/api/parent/tasks', protect, async (req: any, res) => { const request = req as AuthRequest; await getDb().run(`INSERT INTO tasks (id, familyId, title, coinReward, xpReward, durationMinutes, category, icon, isEnabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`, randomUUID(), request.user!.familyId, request.body.title, request.body.coinReward, request.body.xpReward, request.body.durationMinutes, request.body.category, request.body.icon || '📋'); res.json({message:'ok'}); });

// 更新任务
app.put('/api/parent/tasks/:id', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const task = await db.get('SELECT * FROM tasks WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
    if (!task) {
        return res.status(404).json({ message: '任务不存在' });
    }
    const { title, coinReward, xpReward, durationMinutes, category, icon } = req.body;
    await db.run(
        'UPDATE tasks SET title = ?, coinReward = ?, xpReward = ?, durationMinutes = ?, category = ?, icon = ? WHERE id = ?',
        title || task.title,
        coinReward ?? task.coinReward,
        xpReward ?? task.xpReward,
        durationMinutes ?? task.durationMinutes,
        category || task.category,
        icon || task.icon || '📋',
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
app.post('/api/parent/privileges', protect, async (req: any, res) => { const request = req as AuthRequest; await getDb().run(`INSERT INTO privileges (id, familyId, title, description, cost) VALUES (?, ?, ?, ?, ?)`, randomUUID(), request.user!.familyId, request.body.title, request.body.description, request.body.cost); res.json({message:'ok'}); });
app.put('/api/parent/privileges/:id', protect, async (req: any, res) => {
    const { title, description, cost } = req.body;
    await getDb().run('UPDATE privileges SET title = ?, description = ?, cost = ? WHERE id = ?', title, description, cost, req.params.id);
    res.json({ message: '更新成功' });
});
app.delete('/api/parent/privileges/:id', protect, async (req, res) => { await getDb().run('DELETE FROM privileges WHERE id = ?', req.params.id); res.json({message:'ok'}); });
app.get('/api/parent/achievements', protect, async (req: any, res) => { const request = req as AuthRequest; res.json(await getDb().all('SELECT * FROM achievement_defs WHERE familyId = ?', request.user!.familyId)); });
app.post('/api/parent/achievements', protect, async (req: any, res) => { const request = req as AuthRequest; await getDb().run(`INSERT INTO achievement_defs (id, familyId, title, description, icon, conditionType, conditionValue) VALUES (?, ?, ?, ?, ?, ?, ?)`, randomUUID(), request.user!.familyId, request.body.title, request.body.description, request.body.icon, request.body.conditionType, request.body.conditionValue); res.json({message:'ok'}); });
app.delete('/api/parent/achievements/:id', protect, async (req, res) => { await getDb().run('DELETE FROM achievement_defs WHERE id = ?', req.params.id); res.json({message:'ok'}); });

// Child
app.get('/api/child/dashboard', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb(); const childId = request.user!.id;
    // 只显示启用的任务（isEnabled = 1），已删除的任务不显示给孩子
    const tasks = await db.all('SELECT * FROM tasks WHERE familyId = ? AND isEnabled = 1', request.user!.familyId);
    const entries = await db.all(`SELECT taskId, status FROM task_entries WHERE childId = ?`, childId);
    const today = new Date(); const last7Days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        // 统计包含所有任务记录（包括已删除任务的完成记录）
        const dayCoins = (await db.get(`SELECT sum(earnedCoins) as s FROM task_entries WHERE childId = ? AND status = 'approved' AND date(submittedAt) = ?`, childId, dateStr)).s || 0;
        last7Days.push({ date: dateStr, coins: dayCoins });
    }
    res.json({ child: await db.get('SELECT * FROM users WHERE id = ?', childId), tasks: tasks.map(t => ({...t, status: entries.find(e => e.taskId === t.id)?.status || 'todo'})), weeklyStats: last7Days });
});
app.post('/api/child/tasks/:taskId/complete', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const { duration } = request.body; await getDb().run(`INSERT INTO task_entries (id, taskId, childId, status, submittedAt, actualDurationMinutes) VALUES (?, ?, ?, 'pending', ?, ?)`, randomUUID(), req.params.taskId, request.user!.id, new Date().toISOString(), duration || 0); res.json({ message: 'submitted' });
});
app.get('/api/child/wishes', protect, async (req: any, res) => { 
    const request = req as AuthRequest;
    res.json({ 
        savings: await getDb().get("SELECT * FROM wishes WHERE familyId = ? AND type='savings'", request.user!.familyId), 
        shop: await getDb().all("SELECT * FROM wishes WHERE familyId = ? AND type='shop'", request.user!.familyId), 
        lottery: await getDb().all("SELECT * FROM wishes WHERE familyId = ? AND type='lottery'", request.user!.familyId) 
    }); 
});
app.post('/api/child/wishes/:id/redeem', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb(); const wish = await db.get('SELECT * FROM wishes WHERE id = ?', req.params.id);
    if (!wish || (wish.stock===0)) return res.status(400).json({message:'库存不足'});
    const user = await db.get('SELECT coins FROM users WHERE id = ?', request.user!.id); if(user.coins<wish.cost) return res.status(400).json({message:'金币不足'});
    await db.run('BEGIN'); 
    await db.run('UPDATE users SET coins = coins - ? WHERE id = ?', wish.cost, request.user!.id); 
    if(wish.stock>0) await db.run('UPDATE wishes SET stock = stock - 1 WHERE id = ?', wish.id);
    // 商店商品添加到背包，记录是用金币兑换的
    await db.run(`INSERT INTO user_inventory (id, childId, wishId, title, icon, cost, costType, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`, 
        randomUUID(), request.user!.id, wish.id, wish.title, wish.icon, wish.cost, 'coins');
    await db.run('COMMIT'); 
    res.json({message:'兑换成功！已放入背包'});
});
app.get('/api/child/inventory', protect, async (req: any, res) => { const request = req as AuthRequest; res.json(await getDb().all('SELECT * FROM user_inventory WHERE childId = ? ORDER BY acquiredAt DESC', request.user!.id)); });
// 撤销兑换（退还金币或特权点）
app.post('/api/child/inventory/:id/cancel', protect, async (req: any, res) => { 
    const request = req as AuthRequest;
    const db = getDb();
    const item = await db.get('SELECT * FROM user_inventory WHERE id = ? AND childId = ?', req.params.id, request.user!.id);
    if (!item) return res.status(404).json({message: '物品不存在'});
    if (item.status === 'cancelled' || item.status === 'returned') return res.status(400).json({message: '已撤销'});
    if (item.status === 'redeemed' || item.status === 'used') return res.status(400).json({message: '已兑现的物品无法撤销'});
    
    await db.run('BEGIN');
    await db.run("UPDATE user_inventory SET status = 'cancelled' WHERE id = ?", req.params.id);
    
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
        // 储蓄目标达成，免费获得，cost=0，costType=coins（但实际是免费）
        await db.run(`INSERT INTO user_inventory (id, childId, wishId, title, icon, cost, costType, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`, 
            randomUUID(), request.user!.id, savings.id, savings.title, savings.icon, 0, 'coins');
    }
    
    await db.run('COMMIT');
    res.json({ message: goalAchieved ? '🎉 目标达成！已放入背包' : '存入成功', newAmount, goalAchieved });
});

app.post('/api/child/lottery/play', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb(); 
    const user = await db.get('SELECT coins FROM users WHERE id = ?', request.user!.id); 
    if(user.coins < 10) return res.status(400).json({message:'金币不足'});
    
    // 只获取已上架且有库存的奖品 (stock = -1 表示无限库存)
    const prizes = await db.all("SELECT * FROM wishes WHERE familyId = ? AND type = 'lottery' AND isActive = 1 AND (stock = -1 OR stock > 0)", request.user!.familyId);
    if(prizes.length === 0) return res.status(400).json({message:'奖池空或奖品已抽完'});
    
    // 加权随机算法
    const totalWeight = prizes.reduce((sum: number, p: any) => sum + (p.weight || 10), 0);
    let random = Math.random() * totalWeight;
    let prize = prizes[0];
    for (const p of prizes) {
        random -= (p.weight || 10);
        if (random <= 0) { prize = p; break; }
    }
    
    await db.run('BEGIN'); 
    await db.run('UPDATE users SET coins = coins - 10 WHERE id = ?', request.user!.id); 
    
    // 库存 -1 表示无限，不扣减
    if (prize.stock !== -1) {
        await db.run('UPDATE wishes SET stock = stock - 1 WHERE id = ?', prize.id);
    }
    
    // 抽奖奖品添加到背包，cost=0（免费获得），costType=coins（但实际是免费）
    await db.run(`INSERT INTO user_inventory (id, childId, wishId, title, icon, cost, costType, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`, 
        randomUUID(), request.user!.id, prize.id, prize.title, prize.icon, 0, 'coins');
    await db.run('COMMIT'); 
    res.json({winner: prize});
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
    const child = await db.get('SELECT coins FROM users WHERE id = ?', childId);
    const totalCoins = child?.coins || 0;
    
    // 组装结果
    const result = allDefs.map(def => {
        const isUnlocked = unlockedMap.has(def.id);
        let progress = 0;
        
        if (!isUnlocked) {
            if (def.conditionType === 'task_count') progress = taskCount;
            else if (def.conditionType === 'coin_count') progress = totalCoins;
        }
        
        return {
            id: def.id,
            title: def.title,
            description: def.description,
            icon: def.icon,
            conditionType: def.conditionType,
            conditionValue: def.conditionValue,
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
    // 特权添加到背包，记录是用特权点兑换的
    await db.run(`INSERT INTO user_inventory (id, childId, privilegeId, title, icon, cost, costType, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`, 
        randomUUID(), request.user!.id, priv.id, priv.title, '👑', priv.cost, 'privilegePoints');
    await db.run('COMMIT');
    res.json({ message: '兑换成功！已放入背包' });
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
