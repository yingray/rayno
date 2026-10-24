import { defineConfig } from '@playwright/test';
import base from '../playwright.config';
import { fileURLToPath } from 'node:url';

const variant = process.env.RAYNO_BENCH_VARIANT || 'full';
const port = Number(process.env.RAYNO_BENCH_PORT || 5196);
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: '*.e2e.test.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 300000,
  reporter: [['list']],
  outputDir: `../.performance/results-${variant}`,
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}`, trace: 'off', screenshot: 'off' },
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: `pnpm exec vite preview --outDir .performance/${variant} --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
