import { expect, Page, test } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 } });

const intent = {
  hardConditions: {
    city: '上海',
    districtScope: ['浦东新区'],
    dateFrom: '2026-07-18',
    dateTo: '2026-07-19',
    budgetMax: 100,
    indoorPreference: 'any',
  },
  preferences: {
    queryText: '周末想找人少、车程近的动手体验',
    objective: 'hands-on',
    experienceKeys: ['handcraft'],
  },
  unsupported: ['crowd', 'route_time'],
};

const reliableResults = [
  {
    id: 'trusted-primary',
    externalId: 'amap-primary',
    type: 'poi',
    title: '上海自然博物馆',
    summary: '通过真实展品观察自然与生命，地点和图片来自地图地点核验。',
    imageUrl: '/icon-192.svg',
    category: '科普',
    city: '上海',
    district: '静安区',
    address: '北京西路 510 号',
    verifiedAt: '2026-07-17T08:00:00+08:00',
    freshUntil: '2026-07-24T08:00:00+08:00',
    trustLabel: 'A',
    matchedReasons: ['experience', 'objective'],
    recommendationRole: 'primary',
  },
  {
    id: 'trusted-alternative',
    externalId: 'amap-alternative',
    type: 'poi',
    title: '浦东美术馆亲子工坊',
    summary: '适合亲子共同动手体验，名称、地址和图片均已完成地点核验。',
    imageUrl: '/icon-192.svg',
    category: '美术',
    city: '上海',
    district: '浦东新区',
    address: '滨江大道 2777 号',
    verifiedAt: '2026-07-17T08:00:00+08:00',
    freshUntil: '2026-07-24T08:00:00+08:00',
    trustLabel: 'A',
    matchedReasons: ['district', 'budget'],
    recommendationRole: 'alternative',
  },
];

async function seedParent(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'phase12-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'parent-phase12',
      name: '测试家长',
      role: 'parent',
      familyId: 'family-phase12',
    }));
  });
}

async function mockPlannerApi(page: Page, state: { mode: 'results' | 'empty' | 'error'; addRequests: number }) {
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (path === '/api/parent/explore/places' && method === 'POST') {
      state.addRequests += 1;
      await new Promise(resolve => setTimeout(resolve, 120));
      await route.fulfill({ json: { id: 'planned-place', message: '已经加入家庭计划' } });
      return;
    }
    if (path === '/api/parent/explore/places') {
      await route.fulfill({ json: [] });
      return;
    }
    if (path === '/api/parent/explore/checkins') {
      await route.fulfill({ json: [] });
      return;
    }
    if (path === '/api/parent/explore/feed-settings') {
      await route.fulfill({ json: {
        exploreCity: '上海',
        exploreFeedDailyLimit: 3,
        exploreFeedCategories: null,
        poiEnabled: true,
        sources: [],
        pendingReview: [],
      } });
      return;
    }
    if (path === '/api/parent/explore/intent-settings') {
      await route.fulfill({ json: {
        groups: [{
          key: 'create',
          label: '动手创造',
          icon: '🎨',
          options: [{ key: 'handcraft', label: '手作体验', adultCategory: '动手', keywords: ['手作'] }],
        }],
        disabledKeys: [],
        children: [{ id: 'child-phase12', name: '小星', selections: ['handcraft'] }],
      } });
      return;
    }
    if (path === '/api/parent/explore/discovery/preview-intent') {
      await route.fulfill({ json: intent });
      return;
    }
    if (path === '/api/parent/explore/discovery/search') {
      if (state.mode === 'error') {
        await route.fulfill({ status: 503, json: { message: 'trusted_sources_unavailable' } });
        return;
      }
      await route.fulfill({ json: {
        intent,
        results: state.mode === 'empty' ? [] : reliableResults,
        adjustments: state.mode === 'empty' ? ['remove_budget'] : [],
        partial: state.mode === 'results',
        messageCode: state.mode === 'empty' ? 'no_reliable_results' : 'reliable_results_found',
      } });
      return;
    }
    if (/^\/api\/parent\/explore\/feed\/[^/]+\/approve$/.test(path)) {
      await route.fulfill({ json: { message: '已给孩子看' } });
      return;
    }
    await route.fulfill({ json: [] });
  });
}

test('parent planner preserves intent, shows only reliable results and prevents duplicate add', async ({ page }, testInfo) => {
  const state: { mode: 'results' | 'empty' | 'error'; addRequests: number } = { mode: 'results', addRequests: 0 };
  await seedParent(page);
  await mockPlannerApi(page, state);

  await page.goto('/parent/explore');
  await expect(page.getByText('说说这次想怎么安排')).toBeVisible();
  await expect(page.getByLabel('城市')).toHaveValue('上海');

  const customIdea = '周末想在浦东找一个人少、车程近的动手体验，预算 100 元以内';
  await page.getByLabel('有具体想法可以直接说（可选）').fill(customIdea);
  await page.getByRole('button', { name: '自选日期' }).click();
  await page.getByLabel('开始日期').fill('2026-07-18');
  await page.getByLabel('结束日期').fill('2026-07-19');
  await page.getByRole('button', { name: '先看看系统识别了什么' }).click();
  await expect(page.getByLabel('有具体想法可以直接说（可选）')).toHaveValue(customIdea);
  await expect(page.getByText('“人少”暂不能可靠验证')).toBeVisible();
  await expect(page.getByText('车程暂不能可靠验证')).toBeVisible();

  await page.getByTestId('explore-planner-search').click();
  const results = page.getByTestId('explore-planner-results');
  await expect(results.locator('article')).toHaveCount(2);
  await expect(results.getByText('首选方案')).toHaveCount(1);
  await expect(results.getByText('备选方案')).toHaveCount(1);
  await expect(page.getByText(/部分信源暂时不可用/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('phase12-parent-explore-planner.png'), fullPage: true });

  await results.getByRole('button', { name: '加入家庭计划' }).first().click({ clickCount: 2, delay: 10 });
  await expect.poll(() => state.addRequests).toBe(1);
  await expect(page.getByTestId('explore-stage-plan')).toHaveClass(/bg-slate-900/);

  state.mode = 'empty';
  await page.getByTestId('explore-stage-discover').click();
  await expect(page.getByLabel('城市')).toHaveValue('上海');
  await page.getByTestId('explore-planner-search').click();
  await expect(page.getByTestId('explore-planner-empty')).toBeVisible();
  await expect(page.getByRole('button', { name: '先取消预算限制再查' })).toHaveCount(1);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('parent planner reports trusted-source failure without inventing fallback cards', async ({ page }) => {
  const state: { mode: 'results' | 'empty' | 'error'; addRequests: number } = { mode: 'error', addRequests: 0 };
  await seedParent(page);
  await mockPlannerApi(page, state);

  await page.goto('/parent/explore');
  await expect(page.getByLabel('城市')).toHaveValue('上海');
  await page.getByTestId('explore-planner-search').click();

  await expect(page.getByRole('alert')).toContainText('系统不会用猜测内容凑结果');
  await expect(page.getByTestId('explore-planner-results')).toHaveCount(0);
});
