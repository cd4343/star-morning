import type { Express, Request, Response } from 'express';
import { getDb } from './database';
import {
  applyQuickSetup,
  buildQuickStartPlan,
  DEFAULT_QUICK_SETUP_INPUT,
  getProductSetup,
  normalizeQuickSetupInput,
  QuickSetupValidationError,
} from './productConfig';

interface ProductConfigRequest extends Request {
  user?: { id: string; familyId: string; role: 'parent' | 'child' };
}

export const registerProductConfigRoutes = (app: Express, protect: any): void => {
  app.get('/api/parent/product-setup', protect, async (req: Request, res: Response) => {
    const request = req as ProductConfigRequest;
    if (request.user?.role !== 'parent') return res.status(403).json({ message: '权限不足' });

    const state = await getProductSetup(getDb(), request.user.familyId);
    return res.json({
      ...state,
      defaults: DEFAULT_QUICK_SETUP_INPUT,
      preview: buildQuickStartPlan(state.settings || DEFAULT_QUICK_SETUP_INPUT),
    });
  });

  app.post('/api/parent/product-setup/quick', protect, async (req: Request, res: Response) => {
    const request = req as ProductConfigRequest;
    if (request.user?.role !== 'parent') return res.status(403).json({ message: '权限不足' });

    try {
      const input = normalizeQuickSetupInput(req.body);
      const state = await applyQuickSetup(getDb(), request.user.familyId, input);
      return res.json({ ...state, preview: buildQuickStartPlan(input) });
    } catch (error) {
      const message = error instanceof Error ? error.message : '配置无效';
      if (message === 'family not found') return res.status(404).json({ message: '家庭不存在' });
      if (error instanceof QuickSetupValidationError) {
        return res.status(400).json({ message: '配置无效', fieldError: message });
      }
      throw error;
    }
  });
};
