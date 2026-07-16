import { expect, Page, test } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 } });

async function seed(page: Page, role: 'child' | 'parent') {
  await page.addInitScript((userRole) => {
    localStorage.setItem('token', `phase9-${userRole}`);
    localStorage.setItem('user', JSON.stringify({
      id: `${userRole}-phase9`, name: userRole === 'child' ? '小星' : '星爸', role: userRole,
      familyId: 'family-phase9', coins: 80, privilegePoints: 6,
    }));
  }, role);
}

test('child keeps the original shop default and can open one personal wish at 375px', async ({ page }) => {
  await seed(page, 'child');
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/child/dashboard') return route.fulfill({ json: { child: { id: 'child-phase9', name: '小星', coins: 80, privilegePoints: 6 }, tasks: [] } });
    if (path === '/api/child/wishes') return route.fulfill({ json: [{ id: 'shop-1', title: '观察工具包', icon: '🔭', type: 'shop', cost: 50, stock: 2 }] });
    if (path === '/api/child/lottery/info') return route.fulfill({ json: { lotteryEnabled: false, prizes: [] } });
    if (path === '/api/child/wish-requests') return route.fulfill({ json: { active: null, history: [] } });
    if (path === '/api/child/screen-time') return route.fulfill({ json: { balance: 15 } });
    return route.fulfill({ json: [] });
  });

  await page.goto('/child/wishes');
  await expect(page.getByText('观察工具包')).toBeVisible();
  const wishTab = page.getByRole('button', { name: '我的愿望', exact: true });
  await wishTab.click();
  await expect(wishTab).toHaveClass(/bg-violet-500/);
  await expect(wishTab).toHaveCSS('background-color', 'rgb(139, 92, 246)');
  await expect(page.getByText('我现在最想实现的愿望')).toBeVisible();
  await expect(page.getByRole('button', { name: '提交这个愿望' })).toBeVisible();
  await expect(page.getByText('想去一个地方或体验活动？')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('parent can review a child wish without hiding the existing reward tabs at 375px', async ({ page }) => {
  await seed(page, 'parent');
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/parent/wish-requests') return route.fulfill({ json: [{
      id: 'wish-request-1', child_name: '小星', title: '天文望远镜体验', icon: '🔭',
      description: '想看看月亮', status: 'pending',
    }] });
    if (path === '/api/parent/wishes' || path === '/api/parent/reward-pools') return route.fulfill({ json: [] });
    if (path === '/api/parent/chest-settings') return route.fulfill({ json: {} });
    if (path === '/api/parent/economy-settings') return route.fulfill({ json: { settings: { coinPerRmb: 10, dailyCoinTarget: 30 } } });
    if (path === '/api/parent/economy-audit') return route.fulfill({ json: {
      settings: { ecoCoinPerRmb: 10, ecoTasksPerDay: 3, dailyCoinTarget: 30, settings: { preset: 'standard', coinPerRmb: 10, dailyCoinTarget: 30 } },
      production: { measuredDailyCoins: 0, targetDailyCoins: 30, sampleDays: 0 },
      catalog: { total: 0, aligned: 0, underpriced: 0, overpriced: 0, missingReference: 0, invalidReference: 0, items: [] },
      warnings: [], recentBatches: [],
    } });
    if (path === '/api/parent/lottery-settings') return route.fulfill({ json: { enabled: true, dailyPaidLimit: 5, dailyTicketLimit: 1 } });
    return route.fulfill({ json: [] });
  });

  await page.goto('/parent/wishes');
  await expect(page.getByText('天文望远镜体验')).toBeVisible();
  await expect(page.getByRole('button', { name: '批准愿望' })).toBeVisible();
  await expect(page.getByTestId('wishes-tab-shop')).toBeVisible();
  await expect(page.getByTestId('wishes-tab-lottery')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
