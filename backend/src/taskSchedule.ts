import type { Database } from 'sqlite';
import { getLocalDateString } from './beijingTime';

export type ScheduledTask = Record<string, any>;

export const shouldTaskAppearOnDate = (task: ScheduledTask, targetDate: Date): boolean => {
  const dayOfWeek = targetDate.getDay();
  const dateStr = getLocalDateString(targetDate);

  if (task.taskType) {
    switch (task.taskType) {
      case 'daily':
        return true;
      case 'once':
        return task.validDate === dateStr;
      case 'custom':
        try {
          const days = JSON.parse(task.customDays || '[]');
          return Array.isArray(days) && days.includes(dayOfWeek);
        } catch {
          return false;
        }
      default:
        return true;
    }
  }

  if (task.isRecurring === 1) {
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    if (task.recurringSchedule === 'daily') return true;
    if (task.recurringSchedule === 'weekday' && isWeekday) return true;
    if (task.recurringSchedule === 'weekend' && isWeekend) return true;
    return false;
  }

  return true;
};

export const getTasksForDate = async (
  db: Database,
  familyId: string,
  childId: string,
  targetDate: Date = new Date(),
) => {
  const dateStr = getLocalDateString(targetDate);
  const todayStr = getLocalDateString();
  const isToday = dateStr === todayStr;

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
    const tasksForToday = allTasks.filter(task => shouldTaskAppearOnDate(task, targetDate));

    return tasksForToday.map(task => {
      const entry = entries.find(item => item.taskId === task.id);
      const runningSession = runningSessions.find(session => session.taskId === task.id);
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
        canOperate: Boolean(runningSession) || !entry || entry.status === 'rejected',
      };
    });
  }

  return entries.map(entry => ({
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
    canOperate: false,
  }));
};
