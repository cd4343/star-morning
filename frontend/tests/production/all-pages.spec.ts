import { expect, test, type Page } from '@playwright/test';

const installApiFallbacks = async (page: Page) => {
  await page.route('**/api/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/members') return route.fulfill({ json: [] });
    if (pathname === '/api/child/dashboard') {
      return route.fulfill({
        json: {
          child: { id: 'child-production', name: '测试孩子', role: 'child', familyId: 'family-production', coins: 80, xp: 120, level: 2, privilegePoints: 1 },
          tasks: [],
          recentReviews: [],
        },
      });
    }
    if (pathname === '/api/child/all-achievements' || pathname === '/api/child/task-session-reminders') {
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ status: 500, json: { message: 'production smoke fallback' } });
  });
};

test('all child lazy pages render from production chunks without a blank screen', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'production-child-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'child-production', name: '测试孩子', role: 'child', familyId: 'family-production', coins: 80, xp: 120, level: 2, privilegePoints: 1,
    }));
  });
  await installApiFallbacks(page);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const failures: string[] = [];

  for (const route of ['/child/today', '/child/challenge', '/child/calm', '/child/morning', '/child/explore', '/child/wishes', '/child/me']) {
    pageErrors.length = 0;
    await page.goto(route);
    await page.waitForTimeout(200);
    if (pageErrors.length > 0) failures.push(`${route}: ${pageErrors.join(' | ')}`);
    const content = await page.locator('#root').innerText();
    if (content.trim().length <= 5) failures.push(`${route}: rendered an empty root`);
  }
  expect(failures).toEqual([]);
});

test('all parent lazy pages render from production chunks without a blank screen', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'production-parent-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'parent-production', name: '测试家长', role: 'parent', familyId: 'family-production',
    }));
  });
  await installApiFallbacks(page);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const failures: string[] = [];

  for (const route of [
    '/parent/dashboard', '/parent/quick-setup', '/parent/tasks', '/parent/learning',
    '/parent/wellbeing', '/parent/morning', '/parent/rules-insights', '/parent/wishes',
    '/parent/privileges', '/parent/family', '/parent/achievements', '/parent/punishment', '/parent/explore',
  ]) {
    pageErrors.length = 0;
    await page.goto(route);
    await page.waitForTimeout(200);
    if (pageErrors.length > 0) failures.push(`${route}: ${pageErrors.join(' | ')}`);
    const content = await page.locator('#root').innerText();
    if (content.trim().length <= 5) failures.push(`${route}: rendered an empty root`);
  }
  expect(failures).toEqual([]);
});

test('missing lazy page chunk shows recovery UI instead of a white screen', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'production-child-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'child-production', name: '测试孩子', role: 'child', familyId: 'family-production', coins: 80, xp: 120, level: 2, privilegePoints: 1,
    }));
  });
  await installApiFallbacks(page);
  await page.route('**/assets/ChildMe-*.js', route => route.abort());

  await page.goto('/child/me');

  await expect(page.getByRole('heading', { name: '页面没有加载完整' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible();
  const content = await page.locator('#root').innerText();
  expect(content.trim().length).toBeGreaterThan(20);
});
