import { expect, test, type Page } from '@playwright/test';
import type { GrowthIdentity, GrowthProfileUpdate } from '../../src/types/growthIdentity';

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

const growthIdentity: GrowthIdentity = {
  child: { id: 'child-1', name: '孩子', familyAvatar: '👦' },
  levelIdentity: {
    totalXp: 320, level: 4, currentXp: 20, nextLevelXp: 100, remainingXp: 80,
    stage: {
      key: 'steady-doer', minLevel: 4, maxLevel: 7, title: '稳步行动家',
      meaning: '把小行动慢慢变成自己的节奏', defaultFrameKey: 'frame.stage.steady-doer',
    },
  },
  selected: {
    avatarKey: 'avatar.current', frameKey: 'frame.stage.steady-doer', themeKey: null,
    titleKey: 'title.stage.steady-doer', featuredAchievementIds: ['system-life-three'],
  },
  cosmetics: [
    { key: 'avatar.current', type: 'avatar', displayName: '家庭头像', sourceType: 'default', unlocked: true },
    { key: 'avatar.star-yellow', type: 'avatar', displayName: '黄色星星', sourceType: 'default', unlocked: true },
    { key: 'frame.stage.steady-doer', type: 'frame', displayName: '稳步行动家头像框', sourceType: 'level', requiredLevel: 4, unlocked: true },
    { key: 'frame.stage.navigator', type: 'frame', displayName: '成长领航员头像框', sourceType: 'level', requiredLevel: 19, unlocked: false },
    { key: 'theme.life', type: 'theme', displayName: '生活绿意', sourceType: 'achievement', unlocked: true },
    { key: 'theme.study', type: 'theme', displayName: '学习书海', sourceType: 'achievement', unlocked: false },
    { key: 'title.stage.steady-doer', type: 'title', displayName: '稳步行动家', sourceType: 'level', unlocked: true },
    { key: 'title.achievement.life.streak.three', type: 'title', displayName: '三日小当家', sourceType: 'achievement', unlocked: true },
  ],
  unlockedAchievements: achievements.map(item => ({
    id: item.id, systemKey: item.systemKey, isSystem: item.isSystem,
    displayTitle: item.displayTitle, displayDescription: item.displayDescription,
    displayIcon: item.displayIcon, iconKey: item.iconKey, category: item.category,
  })),
};

const mockChildMe = async (page: Page, options: {
  identity?: GrowthIdentity;
  identityStatus?: number;
  identityDelayMs?: number;
  onSave?: (body: GrowthProfileUpdate) => void;
  saveStatus?: number;
} = {}) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'growth-child-token');
    localStorage.setItem('user', JSON.stringify({ id: 'child-1', name: '孩子', role: 'child', familyId: 'family-1' }));
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/child/dashboard') return route.fulfill({ json: { child: { id: 'child-1', name: '孩子', avatar: '👦', coins: 30, xp: 320, level: 4, maxXp: 100, privilegePoints: 2, rewardXpTotal: 220 }, tasks: [], recentReviews: [] } });
    if (path === '/api/child/screen-time') return route.fulfill({ json: {} });
    if (path === '/api/child/all-achievements') return route.fulfill({ json: achievements });
    if (path === '/api/child/growth-identity') {
      if (options.identityDelayMs) await new Promise(resolve => setTimeout(resolve, options.identityDelayMs));
      if (options.identityStatus) return route.fulfill({ status: options.identityStatus, json: { message: 'load failed' } });
      return route.fulfill({ json: options.identity || growthIdentity });
    }
    if (path === '/api/child/profile-customization' && request.method() === 'PUT') {
      const body = request.postDataJSON() as GrowthProfileUpdate;
      options.onSave?.(body);
      if (options.saveStatus) return route.fulfill({ status: options.saveStatus, json: { message: 'save failed' } });
      return route.fulfill({ json: { ...(options.identity || growthIdentity), selected: body } });
    }
    return route.fulfill({ json: [] });
  });
};

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

test('level-up feedback records growth without claiming feature permissions', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'growth-child-token');
    localStorage.setItem('user', JSON.stringify({ id: 'child-1', name: '孩子', role: 'child', familyId: 'family-1' }));
    localStorage.setItem('starcoin:lastLevel:child-1', '3');
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/members') return route.fulfill({ json: [] });
    if (path === '/api/child/dashboard') return route.fulfill({ json: { child: { id: 'child-1', name: '孩子', xp: 300, level: 4 }, tasks: [], recentReviews: [] } });
    if (path === '/api/child/screen-time') return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });

  await page.goto('/child/today');
  const dialog = page.getByRole('dialog', { name: '成长等级提升' });
  await expect(dialog).toContainText('稳步行动家');
  await expect(dialog).toContainText('再积累 100 点成长经验到下一级');
  await expect(dialog).not.toContainText(/抽奖|转赠|自主任务|权限|资格/);
  const closeButton = page.getByRole('button', { name: '记住这次成长' });
  expect((await closeButton.boundingBox())?.height).toBeGreaterThanOrEqual(56);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('child identity card shows a non-blocking loading state', async ({ page }) => {
  await mockChildMe(page, { identityDelayMs: 500 });
  await page.goto('/child/me');
  await expect(page.getByTestId('child-growth-account')).toBeVisible();
  await expect(page.getByText('正在整理你的成长身份，其他记录仍可正常查看。')).toBeVisible();
  await expect(page.getByRole('button', { name: '调整我的展示' })).toBeVisible();
});

test('child identity card survives unavailable identity data without blanking the page', async ({ page }) => {
  await mockChildMe(page, { identityStatus: 500 });
  await page.goto('/child/me');
  await expect(page.getByTestId('child-growth-account')).toBeVisible();
  await expect(page.getByText('成长身份暂时无法加载')).toBeVisible();
  await expect(page.getByText('我的记录中心')).toBeVisible();
});

test('empty cosmetic and badge lists render useful empty states', async ({ page }) => {
  await mockChildMe(page, { identity: { ...growthIdentity, cosmetics: [], unlockedAchievements: [] } });
  await page.goto('/child/me');
  await page.getByRole('button', { name: '调整我的展示' }).click();
  await expect(page.getByText('这一类暂时没有可选装扮。').first()).toBeVisible();
  await expect(page.getByText('解锁成就后，就能把它展示在这里。')).toBeVisible();
});

test('closet limits the first choice set but keeps every earned title and badge reachable', async ({ page }) => {
  const extraTitles = Array.from({ length: 6 }, (_, index) => ({
    key: `title.achievement.extra.${index + 1}`,
    type: 'title' as const,
    displayName: `额外称号 ${index + 1}`,
    sourceType: 'achievement' as const,
    unlocked: true,
  }));
  const extraBadges = Array.from({ length: 4 }, (_, index) => ({
    ...growthIdentity.unlockedAchievements[0],
    id: `extra-badge-${index + 1}`,
    displayTitle: `额外成就 ${index + 1}`,
  }));
  await mockChildMe(page, { identity: {
    ...growthIdentity,
    cosmetics: [...growthIdentity.cosmetics, ...extraTitles],
    unlockedAchievements: [...growthIdentity.unlockedAchievements, ...extraBadges],
  } });
  await page.goto('/child/me');
  await page.getByRole('button', { name: '调整我的展示' }).click();
  await expect(page.getByTestId('cosmetic-title.achievement.extra.6')).toHaveCount(0);
  await page.getByRole('button', { name: '查看全部 8 个可用称号' }).click();
  await expect(page.getByTestId('cosmetic-title.achievement.extra.6')).toBeVisible();
  await expect(page.getByTestId('achievement-badge-extra-badge-4')).toHaveCount(0);
  await page.getByRole('button', { name: '查看全部 7 个已解锁成就' }).click();
  await expect(page.getByTestId('achievement-badge-extra-badge-4')).toBeVisible();
});

test('child can confirm unlocked cosmetics while locked choices and a fourth badge stay unavailable', async ({ page }) => {
  let savedBody: GrowthProfileUpdate | null = null;
  const identityWithFourAchievements = {
    ...growthIdentity,
    unlockedAchievements: [
      ...growthIdentity.unlockedAchievements,
      { ...growthIdentity.unlockedAchievements[0], id: 'achievement-four', displayTitle: '第四枚成就' },
    ],
  };
  await mockChildMe(page, { identity: identityWithFourAchievements, onSave: body => { savedBody = body; } });
  await page.goto('/child/me');
  await page.getByRole('button', { name: '调整我的展示' }).click();
  await expect(page.getByTestId('cosmetic-theme.study')).toBeDisabled();
  await page.getByTestId('cosmetic-avatar.star-yellow').click();
  await page.getByTestId('achievement-badge-system-study-three').click();
  await page.getByTestId('achievement-badge-system-sport-three').click();
  await expect(page.getByTestId('achievement-badge-achievement-four')).toBeDisabled();
  await page.getByRole('button', { name: '保存我的展示' }).click();
  expect(savedBody).toBeNull();
  await page.getByRole('button', { name: '确认保存' }).click();
  await expect.poll(() => savedBody?.avatarKey).toBe('avatar.star-yellow');
  await expect(page.getByTestId('child-growth-account')).toHaveAttribute('data-avatar-key', 'avatar.star-yellow');
});

test('failed cosmetic save keeps the last server identity and shows a translated error', async ({ page }) => {
  await mockChildMe(page, { saveStatus: 500 });
  await page.goto('/child/me');
  await page.getByRole('button', { name: '调整我的展示' }).click();
  await page.getByTestId('cosmetic-avatar.star-yellow').click();
  await page.getByRole('button', { name: '保存我的展示' }).click();
  await page.getByRole('button', { name: '确认保存' }).click();
  await expect(page.getByText('展示保存失败，已保留原来的样子')).toBeVisible();
  await expect(page.getByTestId('child-growth-account')).toHaveAttribute('data-avatar-key', 'avatar.current');
});
