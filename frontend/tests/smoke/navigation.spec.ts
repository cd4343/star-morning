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
  await page.route('**/api/child/explore/places', route => route.fulfill({ json: [samplePlace] }));
  await page.route('**/api/child/explore/checkins', route => route.fulfill({ json: [] }));
  await page.route('**/api/parent/explore/places', route => route.fulfill({ json: [samplePlace] }));
  await page.route('**/api/parent/explore/checkins', route => route.fulfill({ json: [] }));
  await page.route('**/api/parent/explore/search**', route => route.fulfill({
    json: { places: [samplePlace], provider: 'mock' },
  }));
}

test('child explore page renders and opens check-in panel', async ({ page }) => {
  await seedAuth(page, 'child');
  await mockApi(page);

  await page.goto('/child/explore');

  await expect(page.getByText('家庭探索站')).toBeVisible();
  await expect(page.getByText('上海自然博物馆')).toBeVisible();
  await page.getByText('上海自然博物馆').click();
  await expect(page.getByText('记录这次探索')).toBeVisible();
});

test('parent explore page renders and opens create form', async ({ page }) => {
  await seedAuth(page, 'parent');
  await mockApi(page);

  await page.goto('/parent/explore');

  await expect(page.getByText('家庭探索')).toBeVisible();
  await expect(page.getByText('上海自然博物馆')).toBeVisible();
  await page.getByRole('button', { name: /新建探索地点/ }).click();
  await expect(page.getByPlaceholder('地点名称')).toBeVisible();
});
