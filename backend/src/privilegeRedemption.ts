import type { Database } from 'sqlite';
import { randomUUID } from 'crypto';

type Resolution = 'approve' | 'reject';

const fail = (message: string, statusCode = 400): never => {
  throw Object.assign(new Error(message), { statusCode });
};

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

export const listPendingGameTimePrivileges = (db: Database, familyId: string) => db.all(
  `SELECT ui.id, ui.childId AS child_id, u.name AS child_name, ui.title, ui.icon,
          ui.cost, ui.acquiredAt AS requested_at, p.game_minutes
     FROM user_inventory ui
     JOIN users u ON u.id = ui.childId
     JOIN privileges p ON p.id = ui.privilegeId
    WHERE u.familyId = ? AND p.familyId = ?
      AND ui.source = 'privilege' AND ui.status = 'pending'
      AND COALESCE(p.game_minutes, 0) > 0
    ORDER BY datetime(ui.acquiredAt) ASC`,
  familyId, familyId
);

export const resolveGameTimePrivilege = async (
  db: Database,
  input: { familyId: string; inventoryId: string; action: Resolution; reason?: unknown }
) => withImmediateTransaction(db, async () => {
  const reason = String(input.reason || '').trim().slice(0, 200);
  if (!['approve', 'reject'].includes(input.action)) fail('请选择确认使用或拒绝');
  if (input.action === 'reject' && !reason) fail('拒绝时请填写原因');

  const item = await db.get(
    `SELECT ui.*, p.game_minutes, p.familyId AS privilege_family_id, u.familyId AS child_family_id
       FROM user_inventory ui
       JOIN privileges p ON p.id = ui.privilegeId
       JOIN users u ON u.id = ui.childId
      WHERE ui.id = ? AND p.familyId = ? AND u.familyId = ?
        AND ui.source = 'privilege' AND COALESCE(p.game_minutes, 0) > 0`,
    input.inventoryId, input.familyId, input.familyId
  );
  if (!item) fail('待确认的游戏时长权益不存在', 404);
  const existingLedger = await db.get(
    'SELECT deltaMinutes FROM screen_time_ledger WHERE privilege_redemption_id = ?',
    input.inventoryId
  );
  if (existingLedger) {
    return { alreadyResolved: true, grantedMinutes: Number(existingLedger.deltaMinutes || 0), status: 'redeemed' };
  }
  if (item.status !== 'pending') fail('这项权益已经处理', 409);

  if (input.action === 'reject') {
    const updated = await db.run(
      `UPDATE user_inventory
          SET status = 'cancelled', resolution_note = ?
        WHERE id = ? AND status = 'pending'`,
      reason, input.inventoryId
    );
    if ((updated.changes || 0) !== 1) fail('这项权益已经处理', 409);
    await db.run('UPDATE users SET privilegePoints = privilegePoints + ? WHERE id = ?', item.cost, item.childId);
    return { alreadyResolved: false, grantedMinutes: 0, status: 'cancelled' };
  }

  await db.run('INSERT OR IGNORE INTO screen_time_rules (familyId, dailyBaseMinutes) VALUES (?, 15)', input.familyId);
  const rules = await db.get('SELECT * FROM screen_time_rules WHERE familyId = ?', input.familyId);
  if (!Boolean(rules?.isEnabled)) fail('家庭当前没有开启游戏时间功能', 409);
  const earned = await db.get(
    `SELECT COALESCE(SUM(deltaMinutes), 0) AS total
       FROM screen_time_ledger
      WHERE familyId = ? AND childId = ?
        AND date(createdAt, '+8 hours') = date('now', '+8 hours')`,
    input.familyId, item.childId
  );
  const dailyBase = Math.max(0, Number(rules.dailyBaseMinutes || 0));
  const dailyMax = Math.max(dailyBase, Number(rules.dailyMaxMinutes || dailyBase));
  const allowance = Math.max(0, Math.min(dailyMax, dailyBase + Number(earned?.total || 0)));
  const requested = Math.max(1, Math.trunc(Number(item.game_minutes || 0)));
  const headroom = Math.max(0, dailyMax - allowance);
  if (headroom < requested) {
    fail(`今天最多还能增加 ${headroom} 分钟，请明天再确认或先调整每日上限`, 409);
  }

  const updated = await db.run(
    `UPDATE user_inventory
        SET status = 'redeemed', redeemedAt = CURRENT_TIMESTAMP, resolution_note = ?
      WHERE id = ? AND status = 'pending'`,
    reason || '家长确认使用', input.inventoryId
  );
  if ((updated.changes || 0) !== 1) fail('这项权益已经处理', 409);
  await db.run(
    `INSERT INTO screen_time_ledger (
       id, familyId, childId, deltaMinutes, reason, source, privilege_redemption_id
     ) VALUES (?, ?, ?, ?, ?, 'privilege_redemption', ?)`,
    randomUUID(), input.familyId, item.childId, requested,
    `权益兑换：${String(item.title || '游戏时间').slice(0, 60)}`, input.inventoryId
  );
  return { alreadyResolved: false, grantedMinutes: requested, status: 'redeemed' };
});
