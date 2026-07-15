import type { NextFunction, Request, Response, Router } from 'express';
import type { Database } from 'sqlite';
import { getLocalDateString } from './beijingTime';
import {
  claimParentDailyWelcome,
  ParentDailyWelcomeError,
} from './parentDailyWelcome';

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

export const registerParentWorkspaceRoutes = (
  app: Pick<Router, 'post' | 'get'>,
  databaseProvider: DatabaseProvider,
) => {
  app.post(
    '/api/parent/daily-welcome/claim',
    createClaimParentDailyWelcomeHandler(databaseProvider),
  );
};
