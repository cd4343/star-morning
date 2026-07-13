import type { Express, NextFunction, Request, Response } from 'express';
import type { Database } from 'sqlite';
import { getDb } from './database';
import { getGrowthIdentity, GrowthIdentityError, updateProfileCustomization } from './growthIdentityService';

interface AuthRequest extends Request {
  user?: { id: string; familyId: string; role: 'parent' | 'child' };
}

const asyncRoute = (handler: (req: AuthRequest, res: Response) => Promise<void>) => (
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try { await handler(req, res); }
    catch (error) {
      if (error instanceof GrowthIdentityError) {
        res.status(error.statusCode).json({ code: error.code, message: error.message });
        return;
      }
      next(error);
    }
  }
);

export const registerGrowthIdentityRoutes = (
  app: Express,
  protect: any,
  requireChild: any,
  databaseProvider: () => Database = getDb,
) => {
  app.get('/api/child/growth-identity', protect, requireChild, asyncRoute(async (req, res) => {
    res.json(await getGrowthIdentity(databaseProvider(), req.user!.id, req.user!.familyId));
  }));
  app.put('/api/child/profile-customization', protect, requireChild, asyncRoute(async (req, res) => {
    res.json(await updateProfileCustomization(databaseProvider(), req.user!.id, req.user!.familyId, req.body || {}));
  }));
};
