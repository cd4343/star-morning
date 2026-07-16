import { expect, test } from '@playwright/test';

const groups = [
  {
    key: 'create', label: '动手创造', icon: '🛠️', options: [
      { key: 'handcraft', label: '做手工', adultCategory: '科学与创造', keywords: ['手工'] },
    ],
  },
  {
    key: 'nature', label: '走进自然', icon: '🌿', options: [
      { key: 'animals', label: '观察动物', adultCategory: '自然与户外', keywords: ['动物'] },
    ],
  },
  {
    key: 'culture', label: '文化发现', icon: '🏛️', options: [
      { key: 'museum', label: '逛博物馆', adultCategory: '文化与艺术', keywords: ['博物馆'] },
    ],
  },
  {
    key: 'any', label: '随便看看', icon: '✨', options: [
      { key: 'any', label: '给我一点惊喜', adultCategory: '不限', keywords: [] },
    ],
  },
];

const recommendations = [
  {
    id: 'primary-place', type: 'poi', title: '自然博物馆', summary: '观察真实标本，找到最感兴趣的动物。',
    imageUrl: '/icon-192.svg', city: '上海', venue: '自然博物馆', status: 'approved',
    recommendationRole: 'primary', recommendationKind: 'place', category: '博物馆', matchedExperienceKeys: ['museum'],
  },
  {
    id: 'activity-choice', type: 'source', title: '周末昆虫观察活动', summary: '和老师一起观察昆虫的生活方式。',
    imageUrl: '/icon-192.svg', city: '上海', venue: '城市公园', activityStart: '2026-07-18', status: 'approved',
    recommendationRole: 'alternative', recommendationKind: 'activity', category: '活动', matchedExperienceKeys: ['animals'],
  },
  {
    id: 'place-choice', type: 'poi', title: '滨江自然步道', summary: '沿着步道寻找植物、鸟类和水边风景。',
    imageUrl: '/icon-192.svg', city: '上海', district: '浦东新区', status: 'approved',
    recommendationRole: 'alternative', recommendationKind: 'place', category: '自然', matchedExperienceKeys: ['animals'],
  },
];

test.use({ viewport: { width: 375, height: 812 } });

test('child can choose at most two experiences and receives one primary plus two alternatives', async ({ page }) => {
  let savedSelections: string[] | null = null;
  await page.addInitScript(() => {
    localStorage.setItem('token', 'phase10-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'child-phase10', name: '体验孩子', role: 'child', familyId: 'family-phase10',
      coins: 20, xp: 10, level: 2, privilegePoints: 0,
    }));
    localStorage.setItem('explore.viewMode', 'feed');
  });

  await page.route('**/api/auth/members', route => route.fulfill({ json: [] }));
  await page.route('**/api/child/dashboard', route => route.fulfill({ json: {
    child: { id: 'child-phase10', name: '体验孩子', coins: 20, xp: 10, level: 2, privilegePoints: 0 },
  } }));
  await page.route('**/api/child/task-session-reminders', route => route.fulfill({ json: [] }));
  await page.route('**/api/child/screen-time', route => route.fulfill({ json: {
    dailyBaseMinutes: 15, dailyMaxMinutes: 45, earnedMinutes: 0, todayUsed: 0, allowance: 15, balance: 15,
  } }));
  await page.route('**/api/child/explore/places', route => route.fulfill({ json: [] }));
  await page.route('**/api/child/explore/checkins', route => route.fulfill({ json: [] }));
  await page.route('**/api/child/explore/map-places', route => route.fulfill({ json: [] }));
  await page.route('**/api/child/explore/feed', route => route.fulfill({ json: recommendations }));
  await page.route('**/api/child/explore/settings', route => route.fulfill({ json: { requirePhoto: false, geoVerify: false } }));
  await page.route('**/api/child/all-achievements', route => route.fulfill({ json: [] }));
  await page.route('**/api/child/explore/intents', async route => {
    if (route.request().method() === 'PUT') {
      savedSelections = (await route.request().postDataJSON()).selections;
      await route.fulfill({ json: { selections: savedSelections } });
      return;
    }
    await route.fulfill({ json: { selections: ['any'], groups } });
  });

  await page.goto('/child/explore');

  await expect(page.getByTestId('explore-intent-picker')).toBeVisible();
  await page.getByRole('button', { name: /文化发现/ }).click();
  await page.getByTestId('explore-intent-museum').click();
  await page.getByRole('button', { name: /走进自然/ }).click();
  await page.getByTestId('explore-intent-animals').click();
  await expect(page.getByText('已选 2/2')).toBeVisible();

  await page.getByRole('button', { name: /动手创造/ }).click();
  await page.getByTestId('explore-intent-handcraft').click();
  await expect(page.getByTestId('explore-intent-handcraft')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('explore-intent-limit')).toContainText('每次最多选 2 项');
  await expect(page.getByRole('button', { name: '取消选择逛博物馆' })).toBeVisible();
  await expect(page.getByRole('button', { name: '取消选择观察动物' })).toBeVisible();

  await page.getByRole('button', { name: '按这个推荐' }).click();
  await expect.poll(() => savedSelections).toEqual(['museum', 'animals']);
  await expect(page.getByTestId('explore-recommendation-primary')).toHaveCount(1);
  await expect(page.getByTestId('explore-recommendation-alternative')).toHaveCount(2);
  await expect(page.getByText('最适合先看')).toBeVisible();
  await expect(page.getByText('限时活动')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
