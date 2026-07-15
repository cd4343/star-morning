import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 } });

const installParentSession = async (page: Page) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'phase-eight-parent-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'parent-phase-eight',
      name: '测试家长',
      role: 'parent',
      familyId: 'family-phase-eight',
    }));
  });
};

test('parent workspace separates overview, approvals, reports and all existing tools', async ({ page }) => {
  await installParentSession(page);
  let welcomeClaims = 0;

  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/parent/daily-welcome/claim') {
      welcomeClaims += 1;
      return route.fulfill({ json: { shouldShow: welcomeClaims === 1, date: '2026-07-16' } });
    }
    if (path === '/api/parent/dashboard') return route.fulfill({ json: {
      pendingReviews: [{
        id: 'review-1', title: '整理书桌', childName: '小晨', submittedAt: '2026-07-16 08:00:00',
        coinReward: 10, xpReward: 10, actualDuration: 8, expectedDuration: 10,
        category: '生活', completionMode: 'timer', targetValue: 10, targetUnit: '分钟', reviewFocus: '认真整理',
      }],
      recentReviewed: [],
      lowEnergyChildren: [],
      stats: { weekTasks: 6, weekCompleted: 4, completionRate: '67%', punctualRate: '75%', totalCoinsEarned: 40 },
    } });
    if (path === '/api/parent/task-session-reminders') return route.fulfill({ json: [] });
    if (path === '/api/parent/inbox') return route.fulfill({ json: {
      items: [{ id: 'review', type: 'review', priority: 'must_handle', actionPath: '/parent/dashboard', count: 1 }],
      totalActionCount: 1,
    } });
    if (path === '/api/parent/punishment-tips') return route.fulfill({ json: {} });
    if (path === '/api/parent/punishment-settings') return route.fulfill({ json: {
      enabled: true, requireReason: true,
      mildMin: 1, mildMax: 5, mildRate: 0.1,
      moderateMin: 5, moderateMax: 10, moderateRate: 0.2,
      severeMax: 20, severeRate: 0.3, severeExtra: 2,
    } });
    if (path === '/api/parent/weekly-reports') return route.fulfill({ json: [{
      id: 'weekly-1', childName: '小晨', weekStart: '2026-07-13', parentNarrative: '这周更愿意主动开始。',
      suggestion: '继续保持小步开始。', stats: { tasksCompleted: 4, activeStarts: 3, coinsEarned: 40 },
    }] });
    if (path === '/api/parent/stats') return route.fulfill({ json: {
      overview: { todayTasks: 1, weekTasks: 4, monthTasks: 12, totalTasks: 30, streakDays: 3, maxStreakDays: 5 },
      coins: { todayEarned: 10, weekEarned: 40, monthEarned: 100, totalEarned: 300, todaySpent: 0, weekSpent: 10, monthSpent: 20, totalSpent: 80 },
      categoryStats: [], dailyAverage: 1, coinTrend: [], nearestAchievements: [], children: [],
    } });
    if (path === '/api/parent/review-history') return route.fulfill({ json: { records: [], datesWithRecords: [] } });
    if (path === '/api/parent/review/review-1/suggestion') return route.fulfill({ json: { category: '生活', completionMode: 'timer' } });
    return route.fulfill({ json: [] });
  });

  await page.goto('/parent/dashboard');
  await expect(page.getByTestId('parent-daily-welcome')).toBeVisible();
  await page.getByRole('button', { name: '关闭' }).click();
  await expect(page.getByTestId('parent-overview-tab')).toBeVisible();
  await expect(page.getByText('先看最重要的事')).toBeVisible();

  await page.getByRole('button', { name: /今日提醒/ }).click();
  await expect(page.getByTestId('parent-daily-welcome')).toBeVisible();
  await page.getByRole('button', { name: '关闭' }).click();
  expect(welcomeClaims).toBe(1);

  await page.getByTestId('parent-workspace-tab-approvals').click();
  await expect(page).toHaveURL(/tab=approvals/);
  await expect(page.getByTestId('parent-approvals-tab')).toContainText('整理书桌');
  await expect(page.getByRole('button', { name: /待审核/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /审核历史/ })).toBeVisible();

  await page.getByTestId('parent-workspace-tab-reports').click();
  await expect(page.getByTestId('parent-reports-tab')).toContainText('数据报告');
  await expect(page.getByText('成长数据')).toBeVisible();

  await page.getByTestId('parent-workspace-tab-tools').click();
  await expect(page.getByTestId('parent-tools-tab')).toBeVisible();
  for (const tool of ['tasks', 'learning', 'morning', 'wellbeing', 'rules-insights', 'explore', 'wishes', 'privileges', 'achievements', 'punishment', 'family']) {
    await expect(page.getByTestId(`parent-tool-${tool}`)).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
