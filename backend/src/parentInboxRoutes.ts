import type { Express, Request, Response } from 'express';
import { getDb } from './database';
import { getParentInbox } from './parentInbox';

interface ParentInboxRequest extends Request {
  user?: { id: string; familyId: string; role: 'parent' | 'child' };
}

export const registerParentInboxRoutes = (app: Express, protect: any): void => {
  app.get('/api/parent/inbox', protect, async (req: Request, res: Response) => {
    const request = req as ParentInboxRequest;
    if (request.user?.role !== 'parent') return res.status(403).json({ message: '权限不足' });

    return res.json(await getParentInbox(getDb(), request.user.familyId));
  });
};
