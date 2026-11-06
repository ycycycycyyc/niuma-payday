import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:4184', channel: 'chrome', headless: true, timezoneId: 'Asia/Shanghai', viewport: { width: 1240, height: 840 } },
  globalSetup: './tests/ui/global-setup.ts',
});

