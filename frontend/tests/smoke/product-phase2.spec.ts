import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 } });

test('parent controls the value anchor and confirms catalog recalibration before applying', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'phase-two-parent-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'parent-phase-two', name: '测试家长', role: 'parent', familyId: 'family-phase-two',
    }));
  });

  let settingsWrites = 0;
  let applyWrites = 0;
  let rollbackWrites = 0;
  const settings = {
    ecoCoinPerRmb: 10,
    ecoTasksPerDay: 3,
    dailyCoinTarget: 30,
    settings: { preset: 'standard', coinPerRmb: 10, dailyCoinTarget: 30 },
  };
  const audit = {
    settings,
    production: { measuredDailyCoins: 24, targetDailyCoins: 30, sampleDays: 14 },
    catalog: {
      total: 3, aligned: 1, underpriced: 1, overpriced: 1, missingReference: 0, invalidReference: 0,
      items: [
        { id: 'wish-aligned', title: '一本书', currentCoins: 120, referenceRmb: 12, suggestedCoins: 120, alignment: 'aligned', daysToRedeem: 5 },
        { id: 'wish-under', title: '小零食', currentCoins: 20, referenceRmb: 5, suggestedCoins: 50, alignment: 'underpriced', daysToRedeem: 1 },
        { id: 'wish-over', title: '小玩具', currentCoins: 150, referenceRmb: 10, suggestedCoins: 100, alignment: 'overpriced', daysToRedeem: 7 },
      ],
    },
    warnings: [],
    recentBatches: [{ id: 'batch-1', changeType: 'shop', status: 'applied', createdAt: '2026-07-12 16:00:00', rolledBackAt: null }],
  };

  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/auth/members') return route.fulfill({ json: [] });
    if (path === '/api/parent/wishes') return route.fulfill({ json: [
      { id: 'wish-aligned', type: 'shop', title: '一本书', icon: '📚', cost: 120, stock: 5, category: '学习', referenceRmb: 12 },
      { id: 'wish-under', type: 'shop', title: '小零食', icon: '🍪', cost: 20, stock: 10, category: '零食', referenceRmb: 5 },
      { id: 'wish-over', type: 'shop', title: '小玩具', icon: '🧸', cost: 150, stock: 3, category: '玩乐', referenceRmb: 10 },
    ] });
    if (path === '/api/parent/economy-settings' && request.method() === 'GET') return route.fulfill({ json: settings });
    if (path === '/api/parent/economy-settings' && request.method() === 'PUT') {
      settingsWrites += 1;
      return route.fulfill({ json: { message: 'ok', ...settings, settings: { preset: 'longTerm', coinPerRmb: 20, dailyCoinTarget: 30 } } });
    }
    if (path === '/api/parent/economy-audit') return route.fulfill({ json: audit });
    if (path === '/api/parent/economy-recalibration-preview') return route.fulfill({ json: {
      settings: settings.settings,
      changes: [{ id: 'wish-under', title: '小零食', referenceRmb: 5, oldValue: 20, newValue: 50, oldDaysToRedeem: 1, newDaysToRedeem: 2 }],
      unchangedCount: 0,
    } });
    if (path === '/api/parent/economy-recalibration-apply') {
      applyWrites += 1;
      return route.fulfill({ json: { batchId: 'batch-2', changes: [] } });
    }
    if (path === '/api/parent/economy-recalibration/batch-1/rollback') {
      rollbackWrites += 1;
      return route.fulfill({ json: { batchId: 'batch-1', restoredCount: 2 } });
    }
    if (path === '/api/parent/reward-pools') return route.fulfill({ json: [] });
    if (path === '/api/parent/chest-settings') return route.fulfill({ json: {} });
    if (path === '/api/parent/lottery-settings') return route.fulfill({ json: { enabled: true, dailyPaidLimit: 2 } });
    return route.fulfill({ json: [] });
  });

  await page.goto('/parent/wishes');
  const panel = page.getByTestId('economy-settings-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('10 金币≈1 元');
  await expect(panel).toContainText('每天约 30 金币');
  await expect(page.getByText('现实参考 12 元')).toBeVisible();

  await page.getByTestId('economy-preset-longTerm').click();
  expect(settingsWrites).toBe(0);
  await page.getByTestId('economy-save-settings').click();
  await expect.poll(() => settingsWrites).toBe(1);

  await page.getByTestId('economy-item-wish-under').check();
  await page.getByTestId('economy-preview').click();
  await expect(page.getByTestId('economy-preview-sheet')).toContainText('20 → 50 金币');
  expect(applyWrites).toBe(0);
  await page.getByTestId('economy-apply').click();
  await expect.poll(() => applyWrites).toBe(1);

  await page.getByTestId('economy-rollback-batch-1').click();
  expect(rollbackWrites).toBe(0);
  await page.getByRole('button', { name: '确认回滚' }).click();
  await expect.poll(() => rollbackWrites).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('task management previews daily output without rewriting existing rewards', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'phase-two-parent-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'parent-phase-two', name: '测试家长', role: 'parent', familyId: 'family-phase-two',
    }));
  });

  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/parent/tasks') return route.fulfill({ json: [
      { id: 'task-1', title: '晨间小行动', category: '早晨启动', coinReward: 8, xpReward: 8, durationMinutes: 5, taskType: 'daily', isEnabled: 1 },
      { id: 'task-2', title: '作业一小步', category: '学习', coinReward: 22, xpReward: 20, durationMinutes: 20, taskType: 'daily', isEnabled: 1 },
    ] });
    if (path === '/api/parent/economy-audit') return route.fulfill({ json: {
      settings: { settings: { preset: 'standard', coinPerRmb: 10, dailyCoinTarget: 30 } },
      catalog: { items: [{ id: 'wish-1', title: '一本书', currentCoins: 120, referenceRmb: 12, suggestedCoins: 120, alignment: 'aligned', daysToRedeem: 4 }] },
    } });
    if (path === '/api/parent/family-missions') return route.fulfill({ json: [] });
    return route.fulfill({ json: [] });
  });

  await page.goto('/parent/tasks');
  await expect(page.getByText('每日固定任务预计 30 金币 · 家庭目标 30 金币')).toBeVisible();
  await expect(page.getByText(/最近的商品约需积累 4 天/)).toBeVisible();
  await page.getByRole('button', { name: '📋 新建任务' }).click();
  await expect(page.getByRole('heading', { name: '📋 新建任务' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
