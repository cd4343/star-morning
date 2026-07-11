import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 } });

test('parent completes five-step quick setup at 375px', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'phase-one-smoke-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'parent-phase-one',
      name: '测试家长',
      role: 'parent',
      familyId: 'family-phase-one',
    }));
  });

  await page.route('**/api/auth/members', route => route.fulfill({ json: [] }));
  await page.route('**/api/parent/product-setup', route => route.fulfill({
    json: {
      setupStatus: 'not_started',
      settings: null,
      defaults: {
        childAgeBand: '9-10',
        focusAreas: ['morning', 'homework'],
        dailyCoreActions: 2,
        weeklyRewardBudgetRmb: 30,
        screenTimeCapMinutes: 45,
      },
      preview: { tasks: [], wishes: [], privileges: [] },
    },
  }));

  let postedBody: Record<string, unknown> | null = null;
  await page.route('**/api/parent/product-setup/quick', async route => {
    postedBody = route.request().postDataJSON();
    await route.fulfill({
      json: { setupStatus: 'completed', settings: postedBody, preview: { tasks: [], wishes: [], privileges: [] } },
    });
  });

  await page.goto('/parent/quick-setup');
  await expect(page.getByTestId('parent-quick-setup')).toBeVisible();
  await expect(page.getByText('第 1/5 步')).toBeVisible();

  for (let index = 0; index < 4; index += 1) {
    await page.getByTestId('quick-setup-next').click();
  }

  await expect(page.getByTestId('quick-setup-summary')).toContainText('每天最多 2 个推荐核心行动');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByTestId('quick-setup-submit').click();
  await expect(page).toHaveURL(/\/parent\/dashboard$/);
  expect(postedBody).toMatchObject({
    childAgeBand: '9-10',
    focusAreas: ['morning', 'homework'],
    dailyCoreActions: 2,
    weeklyRewardBudgetRmb: 30,
    screenTimeCapMinutes: 45,
  });
});

test('child today prioritizes a running task and shows four primary destinations', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'phase-one-child-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'child-phase-one',
      name: '测试孩子',
      role: 'child',
      familyId: 'family-phase-one',
      coins: 80,
      xp: 120,
      level: 2,
      privilegePoints: 1,
    }));
  });

  await page.route('**/api/auth/members', route => route.fulfill({ json: [] }));
  await page.route('**/api/child/dashboard', route => route.fulfill({
    json: {
      child: { id: 'child-phase-one', name: '测试孩子', coins: 80, xp: 120, level: 2, privilegePoints: 1 },
      tasks: [
        { id: 'task-later', title: '整理书包', category: '生活', status: 'todo', icon: '🎒', coinReward: 8, durationMinutes: 8 },
        { id: 'task-morning', title: '晨间小行动', category: '早晨启动', status: 'todo', icon: '🌤️', coinReward: 4, durationMinutes: 5 },
        { id: 'task-running', title: '正在完成的作业', category: '学习', status: 'running', icon: '📚', coinReward: 15, durationMinutes: 20 },
      ],
      recentReviews: [],
    },
  }));
  await page.route('**/api/child/all-achievements', route => route.fulfill({ json: [] }));
  await page.route('**/api/child/task-session-reminders', route => route.fulfill({ json: [] }));
  await page.route('**/api/child/morning**', route => route.fulfill({ json: { date: '2026-07-12', items: [], order: null } }));

  await page.goto('/child/today');

  await expect(page.getByTestId('today-primary-action')).toContainText('正在完成的作业');
  const nav = page.getByTestId('child-bottom-nav');
  await expect(nav).toContainText('今天');
  await expect(nav).toContainText('探索');
  await expect(nav).toContainText('奖励');
  await expect(nav).toContainText('成长');
  await expect(nav).not.toContainText('早餐');
  expect(await nav.locator('button').count()).toBe(4);

  await page.getByRole('button', { name: /继续完成/ }).click();
  await expect(page).toHaveURL(/\/child\/challenge$/);
});

test('child lottery shows the parent-closed state at 375px', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'phase-one-child-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'child-phase-one', name: '测试孩子', role: 'child', familyId: 'family-phase-one',
      coins: 80, xp: 120, level: 2, privilegePoints: 1,
    }));
  });

  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const path = `${url.pathname}${url.search}`;
    if (path === '/api/child/dashboard') {
      return route.fulfill({ json: { child: { id: 'child-phase-one', name: '测试孩子', coins: 80, xp: 120, level: 2, privilegePoints: 1 }, tasks: [], recentReviews: [] } });
    }
    if (path === '/api/child/lottery/info') {
      return route.fulfill({ json: { lotteryEnabled: false, todayDrawCount: 0, dailyLimit: 0, remainingDraws: 0, currentCost: 15, nextCost: 15, prizes: [] } });
    }
    if (path === '/api/child/screen-time') return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });

  await page.goto('/child/wishes');
  await page.getByRole('button', { name: '抽奖' }).click();

  await expect(page.getByText('家长暂时关闭了抽奖，任务和其他奖励仍可正常使用。')).toBeVisible();
  await expect(page.getByRole('button', { name: '已关闭' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
