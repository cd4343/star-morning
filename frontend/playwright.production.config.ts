import { defineConfig, devices } from '@playwright/test';

const useExternalServer = process.env.PW_EXTERNAL_SERVER === '1';

export default defineConfig({
  testDir: './tests/production',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4180',
    trace: 'retain-on-failure',
  },
  webServer: useExternalServer ? undefined : {
    command: 'npm run preview -- --host 127.0.0.1 --port 4180',
    url: 'http://127.0.0.1:4180',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{
    name: 'chromium-production',
    use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
  }],
});
