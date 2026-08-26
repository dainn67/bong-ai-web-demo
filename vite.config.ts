// `vitest/config` rather than `vite`: it is the same defineConfig with the
// `test` key typed, so the config below type-checks.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const cdnProxyTarget = process.env.VITE_CDN_PROXY_TARGET || 'http://localhost:8000';
const isLocalBackend = cdnProxyTarget.includes('localhost') || cdnProxyTarget.includes('127.0.0.1');

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    // Four upstreams, four different CORS answers — measured, not assumed:
    //
    //   pub-*.r2.dev (lesson mp3s)  Access-Control-Allow-Origin: *  → NOT proxied
    //   local backend / CDN         local DB on local / CDN on prod → proxied
    //   files.bcserver (story mp3)  no CORS headers at all          → proxied
    //   bong-api (auth + lessons)   allows :3000/:5173, not :5180   → proxied
    //   mini-3000 (FunASR STT)      no CORS for :5180               → proxied
    //
    // The clips being open is load-bearing: they are the bulk of the bytes and
    // they stream straight into decodeAudioData without passing through here.
    //
    // These four routes are load-bearing in production too: `nginx.conf` in the
    // Docker image mirrors them one for one. Change a target here and change it
    // there, or the built bundle starts answering lesson fetches with
    // `index.html` and every `response.json()` fails on the doctype.
    proxy: {
      '/api': { target: process.env.VITE_API_URL || 'http://localhost:8000', changeOrigin: true },
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
        target: 'http://localhost:8003',
        changeOrigin: true,
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
