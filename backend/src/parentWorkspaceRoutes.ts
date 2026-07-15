import type { NextFunction, Request, Response, Router } from 'express';
import type { Database } from 'sqlite';
import { getLocalDateString } from './beijingTime';
import {
  claimParentDailyWelcome,
  ParentDailyWelcomeError,
} from './parentDailyWelcome';
import { getTasksForDate } from './taskSchedule';

type AuthenticatedRequest = Request & {
  user?: { id: string; familyId: string; role: 'parent' | 'child' };
};

type DatabaseProvider = () => Database;

export const createClaimParentDailyWelcomeHandler = (
  databaseProvider: DatabaseProvider,
  dateProvider: () => string = getLocalDateString,
) => async (req: Request, res: Response, next: NextFunction) => {
  const request = req as AuthenticatedRequest;
  if (!request.user) return res.status(401).json({ message: '未登录' });
  if (request.user.role !== 'parent') return res.status(403).json({ message: '权限不足' });

  try {
    return res.json(await claimParentDailyWelcome(databaseProvider(), request.user.id, dateProvider()));
  } catch (error) {
    if (error instanceof ParentDailyWelcomeError) {
      return res.status(error.status).json({ message: error.message });
    }
    return next(error);
  }
};

export const createGetParentTodayTasksHandler = (
  databaseProvider: DatabaseProvider,
  nowProvider: () => Date = () => new Date(),
) => async (req: Request, res: Response, next: NextFunction) => {
  const request = req as AuthenticatedRequest;
  if (!request.user) return res.status(401).json({ message: '未登录' });
  if (request.user.role !== 'parent') return res.status(403).json({ message: '权限不足' });

  try {
    const db = databaseProvider();
    const requestedChildId = typeof req.query.childId === 'string' ? req.query.childId.trim() : '';
    const children = await db.all(
      `SELECT id, name FROM users
       WHERE familyId = ? AND role = 'child'
       ORDER BY createdAt ASC, name ASC`,
      request.user.familyId,
    );
    const selectedChildren = requestedChildId
      ? children.filter(child => child.id === requestedChildId)
      : children;

    if (requestedChildId && selectedChildren.length === 0) {
      return res.status(404).json({ message: '未找到该孩子' });
    }

    const now = nowProvider();
    const configuredTaskCount = Number((await db.get(
      `SELECT COUNT(*) AS count FROM tasks
       WHERE familyId = ? AND isEnabled = 1
         AND (recurringTaskTemplateId IS NULL OR recurringTaskTemplateId = '')`,
      request.user.familyId,
    ))?.count || 0);
    const schedules = await Promise.all(selectedChildren.map(async child => ({
      childId: child.id,
      childName: child.name,
      tasks: await getTasksForDate(db, request.user!.familyId, child.id, now),
    })));

    return res.json({
      date: getLocalDateString(now),
      configuredTaskCount,
      schedules,
    });
  } catch (error) {
    return next(error);
  }
};

export const registerParentWorkspaceRoutes = (
  app: Pick<Router, 'post' | 'get'>,
  databaseProvider: DatabaseProvider,
) => {
  app.post(
    '/api/parent/daily-welcome/claim',
    createClaimParentDailyWelcomeHandler(databaseProvider),
  );
  app.get(
    '/api/parent/tasks/today-preview',
    createGetParentTodayTasksHandler(databaseProvider),
  );
};
