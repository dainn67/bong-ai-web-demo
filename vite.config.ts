// `vitest/config` rather than `vite`: it is the same defineConfig with the
// `test` key typed, so the config below type-checks.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const cdnProxyTarget = process.env.VITE_CDN_PROXY_TARGET || 'https://static-bongai.bcserver.xyz';
const isLocalBackend = cdnProxyTarget.includes('localhost') || cdnProxyTarget.includes('127.0.0.1');

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    // Upstream proxies matching production nginx.conf:
    proxy: {
      '/api': { target: process.env.VITE_API_URL || 'https://bong-api.bcserver.xyz', changeOrigin: true },
      '/cdn': {
        target: cdnProxyTarget,
        changeOrigin: true,
        rewrite: isLocalBackend ? undefined : (path) => path.replace(/^\/cdn/, ''),
      },
      '/stt': {
        target: 'https://mini-3000.bcserver.xyz',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/stt/, ''),
      },
      '/media': {
        target: process.env.VITE_MEDIA_TARGET || 'https://files.bcserver.xyz',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/media/, ''),
      },
    },
  },
  build: {
    // The mic worklet is small enough that Vite would inline it as a `data:`
    // URL, and `audioWorklet.addModule()` refuses those — it wants a real
    // same-origin URL. Dev serves a real path either way, so left alone this
    // breaks only in a built bundle, which is the worst place to find it.
    assetsInlineLimit: (filePath) => (filePath.includes('pcm-worklet') ? false : undefined),
  },
  test: {
    // Node, not jsdom: the protocol client and the face state machine are pure
    // logic. Components that need a DOM can opt in per-file later.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
