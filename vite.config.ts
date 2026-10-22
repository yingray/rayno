import { execSync } from 'node:child_process';
import { loadEnv } from 'vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Cloudflare Pages sets CF_PAGES_COMMIT_SHA. A local build reads the commit from git.
function buildCommit(): string {
  const commit = process.env.CF_PAGES_COMMIT_SHA;
  if (commit) return commit.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'dev';
  }
}

// The page compares its own build with /version.json to find a new release.
function versionFile(build: { commit: string; builtAt: string }): Plugin {
  return {
    name: 'rayno-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify(build)}\n` });
    },
  };
}

export default defineConfig(({ mode }) => {
  const build = { commit: buildCommit(), builtAt: new Date().toISOString() };
  // Extra host names for `pnpm dev` and `pnpm preview`, such as a Tailscale name.
  // Set RAYNO_ALLOWED_HOSTS in `.env.local` as a comma-separated list.
  const allowedHosts = (loadEnv(mode, '.', 'RAYNO_').RAYNO_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  return {
    define: { __RAYNO_BUILD__: JSON.stringify(build) },
    server: { allowedHosts },
    preview: { allowedHosts },
    plugins: [
      react(),
      versionFile(build),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['fonts/*', 'icons/*'],
        manifest: {
          id: '/rayno',
          name: 'Rayno',
          short_name: 'Rayno',
          description: 'An independent, encrypted client for your Happy agents.',
          start_url: '/sessions',
          scope: '/',
          display: 'standalone',
          background_color: '#09090b',
          theme_color: '#09090b',
          icons: [192, 512].map((size) => ({
            src: `/icons/icon-${size}.png`,
            sizes: `${size}x${size}`,
            type: 'image/png',
            purpose: 'any',
          })),
        },
        workbox: {
          cacheId: 'rayno',
          // Activate the new shell cache without a reload or a missing update prompt.
          // The open page stays intact; its next navigation uses the current release.
          skipWaiting: true,
          clientsClaim: true,
          navigateFallback: '/index.html',
          globPatterns: ['**/*.{js,css,html,svg,png,ttf}'],
          globIgnores: ['**/mermaid.worker-*.js'],
          runtimeCaching: [{
            urlPattern: /\/assets\/mermaid\.worker-[\w-]+\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'rayno-diagrams',
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 60 },
            },
          }],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    test: { include: ['src/**/*.test.ts'], testTimeout: 1000 },
  };
});
