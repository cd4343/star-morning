import { expect, Page, test } from '@playwright/test';

const samplePlace = {
  id: 'place-smoke-1',
  title: '上海自然博物馆',
  category: '博物馆',
  city: '上海',
  address: '静安区',
  summary: '观察自然、生命和城市的关系。',
  whyGo: '适合用真实展品连接课本知识。',
  observeTips: '找一个最想继续了解的展品。',
  questionPrompts: '你今天发现了什么新问题？',
  tags: '自然,博物馆',
  status: 'planned',
  checkinCount: 0,
};

const sampleWishlist = { ...samplePlace, id: 'place-smoke-2', title: '滨江自然步道', category: '自然户外', status: 'wishlist' };
const sampleCheckins = [
  { id: 'checkin-pending', placeTitle: '上海自然博物馆', childName: 'Smoke Child', checkedInAt: '2026-07-13T09:00:00+08:00', mood: '开心', note: '我发现恐龙的脚印很大。', parentConfirmed: false, mediaCount: 0 },
  { id: 'checkin-confirmed', placeTitle: '滨江自然步道', childName: 'Smoke Child', checkedInAt: '2026-07-12T09:00:00+08:00', mood: '平静', note: '风吹过树叶很好听。', parentConfirmed: true, mediaCount: 0 },
];

async function seedAuth(page: Page, role: 'child' | 'parent') {
  await page.addInitScript((userRole) => {
    localStorage.setItem('token', 'smoke-token');
    localStorage.setItem('user', JSON.stringify({
      id: `${userRole}-smoke`,
      name: userRole === 'child' ? 'Smoke Child' : 'Smoke Parent',
      role: userRole,
      familyId: 'family-smoke',
      coins: 100,
      xp: 300,
      level: 4,
      privilegePoints: 2,
    }));
    if (userRole === 'child') localStorage.setItem('explore.viewMode', 'list');
  }, role);
}

async function mockApi(page: Page) {
  await page.route('**/api/auth/members', route => route.fulfill({ json: [] }));
  await page.route('**/api/child/dashboard', route => route.fulfill({
    json: {
      child: {
        id: 'child-smoke',
        name: 'Smoke Child',
        coins: 100,
        xp: 300,
        level: 4,
        privilegePoints: 2,
      },
    },
  }));
  await page.route('**/api/child/task-session-reminders', route => route.fulfill({ json: [] }));
  await page.route('**/api/child/screen-time', route => route.fulfill({ json: {
    dailyBaseMinutes: 15, dailyMaxMinutes: 45, earnedMinutes: 0, todayUsed: 0, allowance: 15, balance: 15,
  } }));
  await page.route('**/api/child/explore/places', route => route.fulfill({ json: [samplePlace] }));
  await page.route('**/api/child/explore/checkins', route => route.fulfill({ json: [] }));
  await page.route('**/api/child/explore/map-places', route => route.fulfill({ json: [samplePlace] }));
  await page.route('**/api/child/explore/feed', route => route.fulfill({ json: { items: [], dailyLimit: 3 } }));
  await page.route('**/api/child/explore/settings', route => route.fulfill({ json: { requirePhoto: false, geoVerify: false } }));
  await page.route('**/api/child/all-achievements', route => route.fulfill({ json: [] }));
  await page.route('**/api/parent/explore/places', route => route.fulfill({ json: [samplePlace, sampleWishlist] }));
  await page.route('**/api/parent/explore/checkins', route => route.fulfill({ json: sampleCheckins }));
  await page.route('**/api/parent/explore/feed-settings', route => route.fulfill({ json: {
    exploreCity: '上海', exploreFeedDailyLimit: 3, exploreFeedCategories: null, poiEnabled: true, sources: [],
    pendingReview: [
      { id: 'feed-match', type: 'source', title: '周末森林观察活动', status: 'pending_review', city: '上海', feedCategory: '户外', ageMin: 6, ageMax: 10, price: '免费', verifyStatus: '已核验' },
      { id: 'feed-mismatch', type: 'source', title: '青少年夜间讲座', status: 'pending_review', city: '上海', feedCategory: '科普', ageMin: 13, ageMax: 16, price: '收费', verifyStatus: '未核验' },
    ],
  } }));
  await page.route('**/api/parent/explore/timeline', route => route.fulfill({ json: [] }));
  await page.route('**/api/parent/explore/search**', route => route.fulfill({
    json: { places: [samplePlace], provider: 'mock' },
  }));
}

test('child explore page renders and opens check-in panel', async ({ page }) => {
  await seedAuth(page, 'child');
  await mockApi(page);

  await page.goto('/child/explore');

  const mapListButton = page.getByRole('button', { name: '想去哪？按分类看' });
  const listTitle = page.getByText('家庭探索站');
  await expect(mapListButton.or(listTitle)).toBeVisible();
  if (await mapListButton.isVisible()) {
    await mapListButton.click();
    await expect(page.getByText('上海自然博物馆')).toBeVisible();
    await page.getByText('上海自然博物馆').click();
    await page.getByRole('button', { name: /我到啦，打卡/ }).click();
  } else {
    await expect(listTitle).toBeVisible();
    await page.getByText('上海自然博物馆').click();
  }
  await expect(page.getByText('记录这次探索')).toBeVisible();
});

test('parent explore workbench keeps discover, plan and records in one mobile flow', async ({ page }) => {
  await seedAuth(page, 'parent');
  await mockApi(page);

  await page.goto('/parent/explore');

  await expect(page.getByText('家庭探索')).toBeVisible();
  await expect(page.getByTestId('explore-summary')).toContainText('1');
  await expect(page.getByTestId('explore-summary')).toContainText('2');
  await page.getByTestId('explore-primary-action').click();
  await expect(page.getByTestId('explore-discover')).toBeVisible();
  await page.getByLabel('孩子年龄').fill('8');
  await page.getByLabel('兴趣方向').selectOption('户外');
  await expect(page.getByText('周末森林观察活动')).toBeVisible();
  await expect(page.getByText('青少年夜间讲座')).toBeHidden();

  await page.getByTestId('explore-stage-plan').click();
  await expect(page.getByText('上海自然博物馆')).toBeVisible();
  await page.getByRole('button', { name: /新建探索地点/ }).click();
  await expect(page.getByPlaceholder('地点名称')).toBeVisible();

  await page.getByTestId('explore-stage-records').click();
  await expect(page.getByText('我发现恐龙的脚印很大。').last()).toBeVisible();
  await page.getByRole('button', { name: '家庭回忆' }).click();
  await expect(page.getByText(/还没有可以回看的回忆/)).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('parent explore shows a retryable error instead of a false empty state', async ({ page }) => {
  await seedAuth(page, 'parent');
  await mockApi(page);
  let shouldFail = true;
  await page.route('**/api/parent/explore/places', route => route.fulfill(shouldFail ? { status: 500, json: { message: 'failed' } } : { json: [samplePlace] }));

  await page.goto('/parent/explore');
  await expect(page.getByTestId('explore-load-error')).toBeVisible();
  shouldFail = false;
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.getByTestId('explore-load-error')).toBeHidden();
  await expect(page.getByText('上海自然博物馆')).toBeVisible();
});
