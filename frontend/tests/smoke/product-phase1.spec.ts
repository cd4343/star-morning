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
