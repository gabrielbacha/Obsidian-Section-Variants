import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/browser', timeout: 15000, workers: 1, use: { headless: true,launchOptions:process.env.SECTION_VARIANTS_CHROMIUM_EXECUTABLE?{executablePath:process.env.SECTION_VARIANTS_CHROMIUM_EXECUTABLE}:{} }, reporter: 'list' });
