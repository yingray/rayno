import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

const phase = process.env.RAYNO_COMPILER_PHASE || 'profiled';
const port = Number(process.env.RAYNO_COMPILER_PORT || 5197);
export default defineConfig({
  ...base, testDir: '.', testMatch: 'paired.e2e.test.ts', workers: 1, fullyParallel: false,
  timeout: 600000, reporter: [['list']], outputDir: `../../.performance/compiler-test-${phase}`,
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}`, serviceWorkers: 'block', trace: 'off', screenshot: 'only-on-failure' },
  webServer: {
    command: `pnpm exec vite preview --outDir .performance/compiler-${phase} --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: new URL('../..', import.meta.url).pathname,
    url: `http://127.0.0.1:${port}`, reuseExistingServer: true,
  },
});
