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
  await page.route('**/api/parent/dashboard', route => route.fulfill({ json: {
    children: [], pendingTasks: [], recentActivities: [], stats: {},
  } }));
  await page.route('**/api/parent/task-session-reminders', route => route.fulfill({ json: [] }));
  await page.route('**/api/parent/inbox', route => route.fulfill({ json: [] }));
  await page.route('**/api/parent/stats', route => route.fulfill({ json: {
    overview: { todayTasks: 0, weekTasks: 0, monthTasks: 0, totalTasks: 0, streakDays: 0, maxStreakDays: 0 },
    coins: { todayEarned: 0, weekEarned: 0, monthEarned: 0, totalEarned: 0, todaySpent: 0, weekSpent: 0, monthSpent: 0, totalSpent: 0 },
    categoryStats: [], dailyAverage: 0, coinTrend: [], nearestAchievements: [], children: [],
  } }));
  await page.route('**/api/parent/punishment-tips', route => route.fulfill({ json: [] }));
  await page.route('**/api/parent/punishment-settings', route => route.fulfill({ json: {} }));
  await page.route('**/api/parent/weekly-reports**', route => route.fulfill({ json: [] }));
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
  await page.route('**/api/parent/economy-settings', async route => {
    if (route.request().method() === 'PUT') {
      return route.fulfill({ json: { settings: route.request().postDataJSON() } });
    }
    return route.fulfill({ json: {
      ecoCoinPerRmb: 10,
      ecoTasksPerDay: 3,
      dailyCoinTarget: 30,
      settings: { preset: 'standard', coinPerRmb: 10, dailyCoinTarget: 30 },
    } });
  });

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
  const allTools = page.getByTestId('parent-workspace-tab-tools');
  await expect(allTools).toBeVisible();
  await expect(page.getByRole('button', { name: /任务管理/ })).toHaveCount(0);
  await allTools.click();
  await expect(page.getByTestId('parent-tool-tasks')).toBeVisible();
  expect(postedBody).toMatchObject({
    childAgeBand: '9-10',
    focusAreas: ['morning', 'homework'],
    dailyCoreActions: 2,
    weeklyRewardBudgetRmb: 30,
    screenTimeCapMinutes: 45,
  });
});

test('child Today shows every task, clickable status filters, and the breakfast tab', async ({ page }) => {
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
  let dashboardRequests = 0;
  let runningTaskCompleted = false;
  await page.route('**/api/child/dashboard', route => {
    dashboardRequests += 1;
    return route.fulfill({
      json: {
      child: { id: 'child-phase-one', name: '测试孩子', coins: 80, xp: 120, level: 2, privilegePoints: 1 },
      tasks: [
        { id: 'task-later', title: '整理书包', category: '生活', status: 'todo', icon: '🎒', coinReward: 8, durationMinutes: 8 },
        { id: 'task-morning', title: '晨间小行动', category: '早晨启动', status: 'todo', icon: '🌤️', coinReward: 4, durationMinutes: 5 },
        { id: 'task-pending', title: '等待家长确认', category: '生活', status: 'pending', icon: '⏳', coinReward: 6, durationMinutes: 5 },
        { id: 'task-completed', title: '已经完成的阅读', category: '学习', status: 'approved', icon: '✅', coinReward: 10, durationMinutes: 10 },
        { id: 'task-rejected', title: '需要调整后再试', category: '生活', status: 'rejected', icon: '🔁', coinReward: 5, durationMinutes: 5 },
        ...(!runningTaskCompleted ? [{
          id: 'task-running', title: '正在完成的作业', category: '学习', status: 'running', icon: '📚',
          coinReward: 15, xpReward: 12, durationMinutes: 20, completionMode: 'timer', targetValue: 20,
          targetUnit: '分钟', reviewFocus: '专注投入、认真完成', gameTicketPreviewMinutes: 5,
        }] : []),
      ],
      recentReviews: [],
      },
    });
  });
  await page.route('**/api/child/all-achievements', route => route.fulfill({ json: [] }));
  await page.route('**/api/child/task-session-reminders', route => route.fulfill({ json: [] }));
  await page.route('**/api/child/learning-quests', route => route.fulfill({ json: [] }));
  await page.route('**/api/child/weekly-report/latest', route => route.fulfill({ json: {} }));
  await page.route('**/api/child/screen-time', route => route.fulfill({ json: {
    dailyBaseMinutes: 15, dailyMaxMinutes: 45, earnedMinutes: 7, todayUsed: 5, allowance: 22, balance: 17,
  } }));
  await page.route('**/api/child/morning**', route => route.fulfill({ json: { date: '2026-07-12', items: [], order: null } }));

  await page.goto('/child/today');

  await expect(page.getByTestId('today-tab-tasks')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid^="today-task-task-"]')).toHaveCount(6);
  await expect(page.getByTestId('today-task-task-running')).toBeVisible();
  await expect(page.getByTestId('today-task-task-pending')).toBeVisible();
  await expect(page.getByTestId('today-task-task-completed')).toBeVisible();
  await page.getByTestId('today-filter-todo').click();
  await expect(page.locator('[data-testid^="today-task-task-"]')).toHaveCount(4);
  await expect(page.getByTestId('today-task-task-running')).toBeVisible();
  await page.getByTestId('today-filter-completed').click();
  await expect(page.locator('[data-testid^="today-task-task-"]')).toHaveCount(1);
  await expect(page.getByTestId('today-task-task-completed')).toBeVisible();
  await page.getByTestId('today-filter-pending').click();
  await expect(page.locator('[data-testid^="today-task-task-"]')).toHaveCount(1);
  await expect(page.getByTestId('today-task-task-pending')).toBeVisible();
  await page.getByTestId('today-tab-breakfast').click();
  await expect(page.getByTestId('breakfast-kitchen')).toBeVisible();
  await expect(page.getByTestId('breakfast-kitchen')).not.toContainText('今天早餐怎么搭');
  await page.goto('/child/morning');
  await expect(page).toHaveURL(/\/child\/today\?tab=breakfast$/);
  await expect(page.getByTestId('breakfast-kitchen')).toBeVisible();
  await page.getByTestId('today-tab-tasks').click();
  await expect(page.getByTestId('today-filter-all')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid^="today-task-task-"]')).toHaveCount(6);
  const rewardHeader = page.getByTestId('child-reward-header');
  await expect(rewardHeader.getByTestId('child-header-coins')).toContainText('80');
  await expect(rewardHeader.getByTestId('child-header-screen-time')).toContainText('17');
  await expect(rewardHeader).not.toContainText('特权点');
  await expect(rewardHeader).not.toContainText('经验');
  await expect(rewardHeader).not.toContainText('Lv.');
  await rewardHeader.getByTestId('child-header-screen-time').click();
  await expect(rewardHeader).toContainText(/基础\s*15/);
  await expect(rewardHeader).toContainText(/获得\s*7/);
  await expect(rewardHeader).toContainText(/已用\s*5/);
  await expect(rewardHeader).toContainText(/上限\s*45/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const nav = page.getByTestId('child-bottom-nav');
  await expect(nav).toContainText('今天');
  await expect(nav).toContainText('探索');
  await expect(nav).toContainText('奖励');
  await expect(nav).toContainText('成长');
  await expect(nav).not.toContainText('早餐');
  expect(await nav.locator('button').count()).toBe(4);

  const requestsBeforeDetails = dashboardRequests;
  await page.getByTestId('today-task-task-running').click();
  await expect(page).toHaveURL(/\/child\/today$/);
  const taskDetails = page.getByRole('dialog');
  await expect(taskDetails).toContainText('正在完成的作业');
  await expect(taskDetails).toContainText('20分钟');
  await expect(taskDetails).toContainText('+15');
  await expect(taskDetails).toContainText('+12');
  await expect(taskDetails).toContainText('5 分钟游戏票');

  await taskDetails.getByRole('button', { name: /继续计时/ }).click();
  await expect(page).toHaveURL(/\/child\/challenge\?tab=today&taskId=task-running&from=today$/);
  await expect(page.getByTestId('challenge-back-today')).toBeVisible();
  const runningTimer = page.getByRole('dialog');
  await expect(runningTimer).toContainText('正在挑战：正在完成的作业');

  runningTaskCompleted = true;
  await runningTimer.getByRole('button', { name: '关闭' }).click();
  await page.getByTestId('challenge-back-today-floating').click();
  await expect(page).toHaveURL(/\/child\/today$/);
  await expect(page.getByTestId('today-task-task-running')).toHaveCount(0);
  await expect(page.locator('[data-testid^="today-task-task-"]')).toHaveCount(5);
  expect(dashboardRequests).toBeGreaterThan(requestsBeforeDetails);
});

test('child challenge rejects a stale Today task id instead of opening another task', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'phase-five-child-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'child-phase-five', name: '测试孩子', role: 'child', familyId: 'family-phase-five', coins: 20,
    }));
  });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/child/dashboard') return route.fulfill({ json: {
      child: { id: 'child-phase-five', name: '测试孩子', coins: 20 },
      tasks: [{ id: 'task-safe', title: '真正可做的任务', category: '生活', status: 'todo', coinReward: 5, durationMinutes: 5 }],
      recentReviews: [],
    } });
    if (path === '/api/child/screen-time') return route.fulfill({ json: { balance: 10 } });
    return route.fulfill({ json: [] });
  });

  await page.goto('/child/challenge?tab=today&taskId=task-stale&from=today');

  await expect(page.getByText('这个任务已经完成、过期或不存在，请从“今天”重新选择。')).toBeVisible();
  await expect(page).toHaveURL(/\/child\/challenge\?tab=today&from=today$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('真正可做的任务').first()).toBeVisible();
});

test('child growth page separates level xp from reward progress', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'phase-two-child-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'child-phase-two', name: '测试孩子', role: 'child', familyId: 'family-phase-two',
    }));
  });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/child/dashboard') return route.fulfill({ json: {
      child: { id: 'child-phase-two', name: '测试孩子', coins: 80, xp: 240, maxXp: 300, level: 3, privilegePoints: 2, rewardXpTotal: 165 },
      tasks: [], recentReviews: [],
    } });
    if (path === '/api/child/screen-time') return route.fulfill({ json: { dailyBaseMinutes: 15, dailyMaxMinutes: 45, earnedMinutes: 5, todayUsed: 3, allowance: 20, balance: 17 } });
    if (path === '/api/child/punishment-stats') return route.fulfill({ json: { totalCount: 0, totalDeducted: 0, weekCount: 0, prevWeekCount: 0, byLevel: [], lastPunishmentDate: null, daysSinceLastPunishment: null } });
    if (path === '/api/child/focus-stats') return route.fulfill({ json: { thisWeekMinutes: 20, lastWeekMinutes: 10, longestSessionMinutes: 15, sessionsCount: 2 } });
    return route.fulfill({ json: [] });
  });

  await page.goto('/child/me');
  const growth = page.getByTestId('child-growth-account');
  await expect(growth).toContainText('成长经验');
  await expect(growth).toContainText('240 / 300');
  await expect(growth).toContainText('权益成长进度');
  await expect(growth).toContainText('65 / 100');
  await expect(growth).toContainText('还差 35');
  await expect(growth).toContainText('2 点可用');
});

test('child rewards keeps coin goods and growth rights in separate wallets', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'phase-two-child-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'child-phase-two', name: '测试孩子', role: 'child', familyId: 'family-phase-two',
    }));
  });
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const path = `${url.pathname}${url.search}`;
    if (path === '/api/child/dashboard') return route.fulfill({ json: {
      child: { id: 'child-phase-two', name: '测试孩子', coins: 80, xp: 240, maxXp: 300, level: 3, privilegePoints: 2, rewardXpTotal: 165 },
      tasks: [], recentReviews: [],
    } });
    if (path === '/api/child/wishes?type=shop') return route.fulfill({ json: [
      { id: 'wish-1', type: 'shop', title: '一本书', icon: '📚', cost: 50, stock: 2, category: '学习', referenceRmb: 12 },
    ] });
    if (path === '/api/child/privileges') return route.fulfill({ json: [
      { id: 'right-1', title: '决定家庭电影', icon: '🎬', cost: 2, level: 'bronze', description: '从家长允许的范围中选择' },
    ] });
    if (path === '/api/child/lottery/info') return route.fulfill({ json: { lotteryEnabled: false, prizes: [] } });
    if (path === '/api/child/screen-time') return route.fulfill({ json: { balance: 17, dailyBaseMinutes: 15, dailyMaxMinutes: 45, earnedMinutes: 5, todayUsed: 3 } });
    return route.fulfill({ json: [] });
  });

  await page.goto('/child/wishes');
  const wallet = page.getByTestId('child-reward-wallet');
  await expect(wallet).toContainText('我的金币');
  await expect(wallet).not.toContainText('权益点');
  await expect(page.getByText('一本书')).toBeVisible();
  await expect(page.locator('#root')).not.toContainText('12 元');

  await page.getByRole('button', { name: '权益' }).click();
  await expect(wallet).toContainText('成长权益点');
  await expect(wallet).not.toContainText('我的金币');
  await expect(page.getByText('决定家庭电影')).toBeVisible();
  await expect(page.getByText('2 权益点')).toBeVisible();
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
