import { expect, test } from '@playwright/test';

const achievements = [
  {
    id: 'system-life-three', title: '旧标题', description: '旧描述', icon: '📅',
    systemKey: 'life.streak.three', isSystem: true, iconKey: 'life.streak-three',
    displayTitle: '三日小当家', displayDescription: '连续 3 天完成生活任务', displayIcon: '🏠',
    conditionType: 'streak_days', conditionValue: 3, conditionCategory: '生活', category: '生活',
    rewardCoins: 10, rewardXp: 10, rewardPrivilegePoints: 0, rewardDelivery: 'instant', progress: 3, unlocked: true,
  },
  {
    id: 'system-study-three', title: '旧标题', description: '旧描述', icon: '📅',
    systemKey: 'study.streak.three', isSystem: true, iconKey: 'study.streak-three',
    displayTitle: '三日书声', displayDescription: '连续 3 天完成学习任务', displayIcon: '📖',
    conditionType: 'streak_days', conditionValue: 3, conditionCategory: '学习', category: '学习',
    rewardCoins: 10, rewardXp: 10, rewardPrivilegePoints: 0, rewardDelivery: 'instant', progress: 3, unlocked: true,
  },
  {
    id: 'system-sport-three', title: '旧标题', description: '旧描述', icon: '📅',
    systemKey: 'sport.streak.3', isSystem: true, iconKey: 'sport.streak-three',
    displayTitle: '连动三天', displayDescription: '连续 3 天完成运动任务', displayIcon: '🏃',
    conditionType: 'streak_days', conditionValue: 3, conditionCategory: '运动', category: '运动',
    rewardCoins: 10, rewardXp: 10, rewardPrivilegePoints: 0, rewardDelivery: 'instant', progress: 3, unlocked: true,
  },
];

test.use({ viewport: { width: 375, height: 812 } });

test('parent sees stable system identities and can edit rewards only', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'growth-parent-token');
    localStorage.setItem('user', JSON.stringify({ id: 'parent-1', name: '家长', role: 'parent', familyId: 'family-1' }));
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/members') return route.fulfill({ json: [{ id: 'child-1', name: '孩子', role: 'child' }] });
    if (path === '/api/parent/achievements') return route.fulfill({ json: achievements });
    return route.fulfill({ json: [] });
  });

  await page.goto('/parent/achievements');
  await expect(page.getByText('三日小当家')).toBeVisible();
  await page.getByText('学习成就').click();
  await expect(page.getByText('三日书声')).toBeVisible();
  await page.getByText('运动成就').click();
  await expect(page.getByText('连动三天')).toBeVisible();
  await expect(page.getByRole('img', { name: '三日小当家' })).toBeVisible();
  const parentIconMarkup = await Promise.all(['三日小当家', '三日书声', '连动三天'].map(name => page.getByRole('img', { name }).innerHTML()));
  expect(new Set(parentIconMarkup).size).toBe(3);
  await expect(page.getByRole('button', { name: '删除成就：三日小当家' })).toHaveCount(0);
  await page.getByRole('button', { name: '编辑成就：三日小当家' }).click();
  await expect(page.getByText('系统成就的名称、条件和图标保持统一；这里仍可按家庭规则调整奖励。')).toBeVisible();
  await expect(page.locator('input[value="三日小当家"]')).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('child sees the same stable system names and icons', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'growth-child-token');
    localStorage.setItem('user', JSON.stringify({ id: 'child-1', name: '孩子', role: 'child', familyId: 'family-1' }));
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/members') return route.fulfill({ json: [] });
    if (path === '/api/child/dashboard') return route.fulfill({ json: { child: { id: 'child-1', name: '孩子', coins: 30, xp: 20, level: 1, privilegePoints: 0, rewardXpTotal: 20 }, tasks: [], recentReviews: [] } });
    if (path === '/api/child/screen-time') return route.fulfill({ json: { dailyBaseMinutes: 0, dailyMaxMinutes: 0, earnedMinutes: 0, todayUsed: 0, balance: 0 } });
    if (path === '/api/child/all-achievements') return route.fulfill({ json: achievements });
    return route.fulfill({ json: [] });
  });

  await page.goto('/child/me');
  await expect(page.getByText('三日小当家').first()).toBeVisible();
  await expect(page.getByText('三日书声').first()).toBeVisible();
  await expect(page.getByText('连动三天').first()).toBeVisible();
  await expect(page.getByRole('img', { name: '三日小当家' }).first()).toBeVisible();
  const childIconMarkup = await Promise.all(['三日小当家', '三日书声', '连动三天'].map(name => page.getByRole('img', { name }).first().innerHTML()));
  expect(new Set(childIconMarkup).size).toBe(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
