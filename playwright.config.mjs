import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/browser', timeout: 15000, workers: 1, use: { headless: true }, reporter: 'list' });
