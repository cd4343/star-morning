import type { Express } from 'express';
import type { Database } from 'sqlite';
import { randomUUID } from 'crypto';
import { getDb } from './database';
import { listPendingGameTimePrivileges, resolveGameTimePrivilege } from './privilegeRedemption';

type WishMode = 'coins_direct' | 'coins_savings' | 'privilege_points';
type ServiceError = Error & { statusCode?: number };

const fail = (message: string, statusCode = 400): never => {
  throw Object.assign(new Error(message), { statusCode }) as ServiceError;
};

const hasColumn = async (db: Database, table: string, column: string) => {
  const columns = await db.all(`PRAGMA table_info(${table})`);
  return columns.some((item: any) => item.name === column);
};

const cleanText = (value: unknown, maxLength: number) => String(value || '').trim().slice(0, maxLength);

const withImmediateTransaction = async <T>(db: Database, work: () => Promise<T>): Promise<T> => {
  await db.exec('BEGIN IMMEDIATE');
  try {
    const result = await work();
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
};

export const ensurePhase9CRewardSchema = async (db: Database) => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS child_wish_requests (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      child_id TEXT NOT NULL,
      title TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '⭐',
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'approved', 'change_requested', 'completed', 'rejected', 'cancelled')),
      approval_mode TEXT CHECK(approval_mode IN ('coins_direct', 'coins_savings', 'privilege_points')),
      target_cost INTEGER,
      saved_amount INTEGER NOT NULL DEFAULT 0,
      parent_reason TEXT,
      inventory_id TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      completed_at DATETIME,
      FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
      FOREIGN KEY (child_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_child_wish_one_active
      ON child_wish_requests(child_id)
      WHERE status IN ('pending', 'approved', 'change_requested');
    CREATE INDEX IF NOT EXISTS idx_child_wish_family_status
      ON child_wish_requests(family_id, status);
    CREATE INDEX IF NOT EXISTS idx_child_wish_child_created
      ON child_wish_requests(child_id, created_at DESC);
  `);

  if (!(await hasColumn(db, 'user_inventory', 'wish_request_id'))) {
    await db.run('ALTER TABLE user_inventory ADD COLUMN wish_request_id TEXT');
  }
  if (!(await hasColumn(db, 'user_inventory', 'resolution_note'))) {
    await db.run('ALTER TABLE user_inventory ADD COLUMN resolution_note TEXT');
  }
  if (!(await hasColumn(db, 'privileges', 'is_enabled'))) {
    await db.run('ALTER TABLE privileges ADD COLUMN is_enabled INTEGER DEFAULT 1');
  }
  if (!(await hasColumn(db, 'privileges', 'is_preset'))) {
    await db.run('ALTER TABLE privileges ADD COLUMN is_preset INTEGER DEFAULT 0');
  }
  if (!(await hasColumn(db, 'privileges', 'game_minutes'))) {
    await db.run('ALTER TABLE privileges ADD COLUMN game_minutes INTEGER DEFAULT 0');
  }
  if (!(await hasColumn(db, 'screen_time_ledger', 'privilege_redemption_id'))) {
    await db.run('ALTER TABLE screen_time_ledger ADD COLUMN privilege_redemption_id TEXT');
  }
  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_wish_request
      ON user_inventory(wish_request_id) WHERE wish_request_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_screen_time_privilege_redemption
      ON screen_time_ledger(privilege_redemption_id) WHERE privilege_redemption_id IS NOT NULL;
  `);

  await db.run(
    `UPDATE privileges
        SET game_minutes = 30, is_preset = 1
      WHERE game_minutes = 0 AND title LIKE '%游戏加场%30%分钟%'`
  );
};

export const createChildWishRequest = async (
  db: Database,
  input: { familyId: string; childId: string; title: unknown; icon?: unknown; description?: unknown }
) => {
  const title = cleanText(input.title, 50);
  const description = cleanText(input.description, 200);
  const icon = Array.from(cleanText(input.icon, 8) || '⭐').slice(0, 2).join('');
  if (!title) fail('请写下你现在最想实现的愿望');
  const child = await db.get(
    "SELECT id FROM users WHERE id = ? AND familyId = ? AND role = 'child'",
    input.childId, input.familyId
  );
  if (!child) fail('孩子不存在或不属于当前家庭', 404);
  const id = randomUUID();
  try {
    await db.run(
      `INSERT INTO child_wish_requests (id, family_id, child_id, title, icon, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id, input.familyId, input.childId, title, icon, description || null
    );
  } catch (error: any) {
    if (String(error?.message || '').includes('UNIQUE')) fail('先完成或更换当前愿望，再提交下一个愿望', 409);
    throw error;
  }
  return db.get('SELECT * FROM child_wish_requests WHERE id = ?', id);
};

export const reviewChildWishRequest = async (
  db: Database,
  input: { familyId: string; requestId: string; action: 'approve' | 'reject'; mode?: WishMode; cost?: unknown; reason?: unknown }
) => {
  const reason = cleanText(input.reason, 200);
  if (input.action === 'reject' && !reason) fail('拒绝愿望时请告诉孩子原因');
  const request = await db.get(
    "SELECT * FROM child_wish_requests WHERE id = ? AND family_id = ? AND status = 'pending'",
    input.requestId, input.familyId
  );
  if (!request) fail('愿望不存在、已处理或不属于当前家庭', 404);
  if (input.action === 'reject') {
    await db.run(
      `UPDATE child_wish_requests
          SET status = 'rejected', parent_reason = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND family_id = ? AND status = 'pending'`,
      reason, input.requestId, input.familyId
    );
  } else {
    if (!['coins_direct', 'coins_savings', 'privilege_points'].includes(String(input.mode || ''))) {
      fail('请选择金币直兑、金币储蓄或权益点兑换');
    }
    const cost = Math.trunc(Number(input.cost));
    if (!Number.isFinite(cost) || cost < 1 || cost > 999999) fail('兑换目标必须是 1-999999 的整数');
    await db.run(
      `UPDATE child_wish_requests
          SET status = 'approved', approval_mode = ?, target_cost = ?, parent_reason = ?,
              reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND family_id = ? AND status = 'pending'`,
      input.mode, cost, reason || null, input.requestId, input.familyId
    );
  }
  return db.get('SELECT * FROM child_wish_requests WHERE id = ?', input.requestId);
};

const createWishInventory = async (db: Database, request: any, costType: 'coins' | 'privilegePoints') => {
  const inventoryId = randomUUID();
  await db.run(
    `INSERT INTO user_inventory (
       id, childId, title, icon, cost, costType, source, status, wish_request_id
     ) VALUES (?, ?, ?, ?, ?, ?, 'child_wish', 'pending', ?)`,
    inventoryId, request.child_id, request.title, request.icon || '⭐',
    Number(request.target_cost || 0), costType, request.id
  );
  const updated = await db.run(
    `UPDATE child_wish_requests
        SET status = 'completed', inventory_id = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'approved'`,
    inventoryId, request.id
  );
  if ((updated.changes || 0) !== 1) fail('愿望状态已经变化，请刷新后重试', 409);
  return inventoryId;
};

export const redeemApprovedWishRequest = async (db: Database, familyId: string, childId: string, requestId: string) => (
  withImmediateTransaction(db, async () => {
    const request = await db.get(
      `SELECT * FROM child_wish_requests
        WHERE id = ? AND family_id = ? AND child_id = ? AND status = 'approved'`,
      requestId, familyId, childId
    );
    if (!request) fail('当前愿望不可兑换', 404);
    if (request.approval_mode === 'coins_savings') fail('储蓄愿望请先存入金币');
    const costType = request.approval_mode === 'privilege_points' ? 'privilegePoints' : 'coins';
    const column = costType === 'privilegePoints' ? 'privilegePoints' : 'coins';
    const deducted = await db.run(
      `UPDATE users SET ${column} = ${column} - ? WHERE id = ? AND familyId = ? AND ${column} >= ?`,
      request.target_cost, childId, familyId, request.target_cost
    );
    if ((deducted.changes || 0) !== 1) fail(costType === 'privilegePoints' ? '权益点还不够' : '金币还不够');
    const inventoryId = await createWishInventory(db, request, costType);
    return { inventoryId, requestId, costType, cost: Number(request.target_cost || 0) };
  })
);

export const depositToWishRequest = async (
  db: Database,
  familyId: string,
  childId: string,
  requestId: string,
  rawAmount: unknown
) => withImmediateTransaction(db, async () => {
  const request = await db.get(
    `SELECT * FROM child_wish_requests
      WHERE id = ? AND family_id = ? AND child_id = ?
        AND status = 'approved' AND approval_mode = 'coins_savings'`,
    requestId, familyId, childId
  );
  if (!request) fail('当前愿望不是可储蓄状态', 404);
  const remaining = Math.max(0, Number(request.target_cost || 0) - Number(request.saved_amount || 0));
  const amount = Math.min(remaining, Math.trunc(Number(rawAmount)));
  if (!Number.isFinite(amount) || amount < 1) fail('请输入有效的存入金币数');
  const deducted = await db.run(
    'UPDATE users SET coins = coins - ? WHERE id = ? AND familyId = ? AND coins >= ?',
    amount, childId, familyId, amount
  );
  if ((deducted.changes || 0) !== 1) fail('金币还不够');
  const savedAmount = Number(request.saved_amount || 0) + amount;
  await db.run(
    'UPDATE child_wish_requests SET saved_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = ?',
    savedAmount, requestId, 'approved'
  );
  let inventoryId: string | null = null;
  if (savedAmount >= Number(request.target_cost || 0)) {
    inventoryId = await createWishInventory(db, { ...request, saved_amount: savedAmount }, 'coins');
  }
  return { requestId, deposited: amount, savedAmount, targetCost: Number(request.target_cost || 0), inventoryId };
});

const handleError = (res: any, error: any, fallback: string) => {
  const status = Number(error?.statusCode || 500);
  if (status === 500) console.error(fallback, error);
  res.status(status).json({ message: error?.message || fallback });
};

export const registerWishRequestRoutes = (
  app: Express,
  protect: any,
  requireParent: any,
  requireChild: any
) => {
  app.get('/api/child/wish-requests', protect, requireChild, async (req: any, res) => {
    const user = req.user!;
    const rows = await getDb().all(
      `SELECT * FROM child_wish_requests
        WHERE family_id = ? AND child_id = ?
        ORDER BY datetime(created_at) DESC`,
      user.familyId, user.id
    );
    res.json({
      active: rows.find((row: any) => ['pending', 'approved', 'change_requested'].includes(row.status)) || null,
      history: rows.filter((row: any) => !['pending', 'approved', 'change_requested'].includes(row.status)),
    });
  });

  app.post('/api/child/wish-requests', protect, requireChild, async (req: any, res) => {
    try {
      const user = req.user!;
      res.status(201).json(await createChildWishRequest(getDb(), { familyId: user.familyId, childId: user.id, ...req.body }));
    } catch (error) { handleError(res, error, '提交愿望失败'); }
  });

  app.post('/api/child/wish-requests/:id/request-change', protect, requireChild, async (req: any, res) => {
    const user = req.user!;
    const reason = cleanText(req.body?.reason, 200);
    if (!reason) return res.status(400).json({ message: '请告诉家长为什么想更换愿望' });
    const updated = await getDb().run(
      `UPDATE child_wish_requests
          SET status = 'change_requested', parent_reason = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND family_id = ? AND child_id = ? AND status = 'approved'`,
      reason, req.params.id, user.familyId, user.id
    );
    if ((updated.changes || 0) !== 1) return res.status(409).json({ message: '当前愿望不能申请更换' });
    res.json({ message: '已请家长确认更换' });
  });

  app.post('/api/child/wish-requests/:id/redeem', protect, requireChild, async (req: any, res) => {
    try {
      const user = req.user!;
      res.json(await redeemApprovedWishRequest(getDb(), user.familyId, user.id, req.params.id));
    } catch (error) { handleError(res, error, '兑换愿望失败'); }
  });

  app.post('/api/child/wish-requests/:id/deposit', protect, requireChild, async (req: any, res) => {
    try {
      const user = req.user!;
      res.json(await depositToWishRequest(getDb(), user.familyId, user.id, req.params.id, req.body?.amount));
    } catch (error) { handleError(res, error, '存入愿望失败'); }
  });

  app.get('/api/parent/wish-requests', protect, requireParent, async (req: any, res) => {
    const familyId = req.user!.familyId;
    const rows = await getDb().all(
      `SELECT wr.*, u.name AS child_name
         FROM child_wish_requests wr
         JOIN users u ON u.id = wr.child_id
        WHERE wr.family_id = ?
        ORDER BY
          CASE wr.status WHEN 'pending' THEN 1 WHEN 'change_requested' THEN 2 WHEN 'approved' THEN 3 ELSE 4 END,
          datetime(wr.updated_at) DESC`,
      familyId
    );
    res.json(rows);
  });

  app.post('/api/parent/wish-requests/:id/review', protect, requireParent, async (req: any, res) => {
    try {
      res.json(await reviewChildWishRequest(getDb(), {
        familyId: req.user!.familyId,
        requestId: req.params.id,
        action: req.body?.action,
        mode: req.body?.mode,
        cost: req.body?.cost,
        reason: req.body?.reason,
      }));
    } catch (error) { handleError(res, error, '处理愿望失败'); }
  });

  app.post('/api/parent/wish-requests/:id/change-review', protect, requireParent, async (req: any, res) => {
    const familyId = req.user!.familyId;
    const action = req.body?.action;
    const reason = cleanText(req.body?.reason, 200);
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ message: '请选择同意或保留原愿望' });
    if (action === 'reject' && !reason) return res.status(400).json({ message: '保留原愿望时请告诉孩子原因' });
    const updated = await getDb().run(
      `UPDATE child_wish_requests
          SET status = ?, parent_reason = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND family_id = ? AND status = 'change_requested'`,
      action === 'approve' ? 'cancelled' : 'approved', reason || null, req.params.id, familyId
    );
    if ((updated.changes || 0) !== 1) return res.status(409).json({ message: '愿望状态已经变化' });
    res.json({ message: action === 'approve' ? '孩子现在可以提交新愿望' : '已保留原愿望' });
  });

  app.get('/api/parent/privilege-redemptions', protect, requireParent, async (req: any, res) => {
    res.json(await listPendingGameTimePrivileges(getDb(), req.user!.familyId));
  });

  app.post('/api/parent/privilege-redemptions/:id/resolve', protect, requireParent, async (req: any, res) => {
    try {
      res.json(await resolveGameTimePrivilege(getDb(), {
        familyId: req.user!.familyId,
        inventoryId: req.params.id,
        action: req.body?.action,
        reason: req.body?.reason,
      }));
    } catch (error) { handleError(res, error, '处理游戏时长权益失败'); }
  });
};
