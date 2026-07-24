import { expect, test } from '@playwright/test';

test('first mobile visit shows the StarHope welcome and does not block registration', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');

  const start = page.getByRole('button', { name: '开始体验' });
  const login = page.getByRole('button', { name: '已有账号，直接登录' });
  await expect(start).toBeVisible();
  await expect(login).toBeVisible();
  await expect(page.getByAltText('星希望——家长牵着孩子沿着星光成长之路前行')).toBeVisible();

  const startBox = await start.boundingBox();
  const loginBox = await login.boundingBox();
  expect(startBox?.height).toBeGreaterThanOrEqual(44);
  expect(loginBox?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true);

  await start.click();
  await expect(page).toHaveURL(/\/register$/);
  expect(await page.evaluate(() => localStorage.getItem('starhope_welcome_seen'))).toBe('1');

  await page.goto('/');
  await expect(page).toHaveURL(/\/register$/);
});

test('existing account action enters login immediately', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/welcome');
  await page.getByRole('button', { name: '已有账号，直接登录' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
