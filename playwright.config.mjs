import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: '*.spec.mjs', workers: 1, timeout: 30000, use: { headless: true, viewport: { width: 1680, height: 1050 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' }, reporter: 'list' });
