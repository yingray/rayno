import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  // Extra host names for `pnpm dev` and `pnpm preview`, such as a Tailscale name.
  // Set RAYNO_ALLOWED_HOSTS in `.env.local` as a comma-separated list.
  const allowedHosts = (loadEnv(mode, '.', 'RAYNO_').RAYNO_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  return {
    server: { allowedHosts },
    preview: { allowedHosts },
    plugins: [
      react(),
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
          cacheId: 'rayno-v2',
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
              cacheName: 'rayno-v2-diagrams',
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
