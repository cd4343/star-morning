import type { Database } from 'sqlite';

export type ParentInboxType = 'review' | 'overdue_session' | 'reward_debt' | 'setup_hint';
export type ParentInboxPriority = 'must_handle' | 'suggested' | 'info';

export interface ParentInboxItem {
  id: string;
  type: ParentInboxType;
  priority: ParentInboxPriority;
  title: string;
  summary: string;
  actionPath: string;
  createdAt: string | null;
  count: number;
}

export interface ParentInboxResult {
  totalActionCount: number;
  items: ParentInboxItem[];
}

const PRIORITY_ORDER: Record<ParentInboxPriority, number> = {
  must_handle: 0,
  suggested: 1,
  info: 2,
};

export async function getParentInbox(db: Database, familyId: string): Promise<ParentInboxResult> {
  const [review, overdue, rewardDebt, setup] = await Promise.all([
    db.get(
      `SELECT COUNT(*) AS count, MAX(te.submittedAt) AS createdAt
       FROM task_entries te
       JOIN tasks t ON t.id = te.taskId
       JOIN users u ON u.id = te.childId
       WHERE t.familyId = ? AND u.familyId = ? AND te.status = 'pending' AND t.isEnabled = 1
         AND NOT EXISTS (
           SELECT 1 FROM task_sessions ts
           WHERE ts.taskEntryId = te.id AND ts.familyId = ?
             AND ts.status = 'auto_completed' AND ts.parentReminderReadAt IS NULL
         )`,
      familyId, familyId, familyId,
    ),
    db.get(
      `SELECT COUNT(*) AS count, MAX(autoCompletedAt) AS createdAt
       FROM task_sessions
       WHERE familyId = ? AND status = 'auto_completed' AND parentReminderReadAt IS NULL`,
      familyId,
    ),
    db.get(
      `SELECT COUNT(*) AS count, MAX(ui.acquiredAt) AS createdAt
       FROM user_inventory ui
       JOIN users u ON u.id = ui.childId
       WHERE u.familyId = ? AND ui.status = 'pending'
         AND (ui.wishId IS NOT NULL OR ui.privilegeId IS NOT NULL)`,
      familyId,
    ),
    db.get('SELECT setup_completed_at FROM family_product_settings WHERE family_id = ?', familyId),
  ]);

  const items: ParentInboxItem[] = [];
  const reviewCount = Number(review?.count || 0);
  const overdueCount = Number(overdue?.count || 0);
  const rewardDebtCount = Number(rewardDebt?.count || 0);

  if (reviewCount > 0) {
    items.push({
      id: 'review', type: 'review', priority: 'must_handle', count: reviewCount,
      title: '任务待审核', summary: `${reviewCount} 个任务等待确认`,
      actionPath: '/parent/dashboard?focus=reviews', createdAt: review?.createdAt || null,
    });
  }
  if (overdueCount > 0) {
    items.push({
      id: 'overdue_session', type: 'overdue_session', priority: 'must_handle', count: overdueCount,
      title: '跨天任务待确认', summary: `${overdueCount} 个任务由系统按常规时长结束`,
      actionPath: '/parent/dashboard?focus=reviews', createdAt: overdue?.createdAt || null,
    });
  }
  if (rewardDebtCount > 0) {
    items.push({
      id: 'reward_debt', type: 'reward_debt', priority: 'suggested', count: rewardDebtCount,
      title: '奖励待兑现', summary: `${rewardDebtCount} 个愿望或特权等待履约`,
      actionPath: '/parent/wishes', createdAt: rewardDebt?.createdAt || null,
    });
  }
  if (!setup?.setup_completed_at) {
    items.push({
      id: 'setup_hint', type: 'setup_hint', priority: 'info', count: 0,
      title: '完成家庭快速配置', summary: '用 5 步生成第一组任务和奖励',
      actionPath: '/parent/quick-setup', createdAt: null,
    });
  }

  items.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  const cappedItems = (['must_handle', 'suggested', 'info'] as const)
    .flatMap(priority => items.filter(item => item.priority === priority).slice(0, 5));

  return {
    totalActionCount: reviewCount + overdueCount + rewardDebtCount,
    items: cappedItems,
  };
}
