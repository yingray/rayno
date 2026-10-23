import { defineConfig } from '@playwright/test';
import base from '../playwright.config';
import { fileURLToPath } from 'node:url';

const variant = process.env.RAYNO_BENCH_VARIANT || 'full';
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: '*.e2e.test.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 300000,
  reporter: [['list']],
  outputDir: `../.performance/results-${variant}`,
  use: { ...base.use, baseURL: 'http://127.0.0.1:5196', trace: 'off', screenshot: 'off' },
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: `pnpm exec vite preview --outDir .performance/${variant} --host 127.0.0.1 --port 5196 --strictPort`,
    url: 'http://127.0.0.1:5196',
    reuseExistingServer: false,
  },
});
