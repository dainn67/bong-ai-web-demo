// `vitest/config` rather than `vite`: it is the same defineConfig with the
// `test` key typed, so the config below type-checks.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    // One route left, and it is not part of running the device.
    //
    // There used to be four — the CDN, the STT service and the story host all
    // needed proxying because the browser was fetching lesson content itself.
    // It does not any more: everything audible or visible arrives over the
    // WebSocket, and xiaozhi-server does the CDN fetching from a place where
    // CORS is not a concept. See `docs/plan-server-driven-modes.md`.
    //
    // What remains is `bind-by-phone`, which provisions the simulator against a
    // parent account. `bong-api` allows :3000 and :5173 but not :5180, so it
    // still has to come through here. `nginx.conf` in the Docker image mirrors
    // this one route; keep the two in step.
    proxy: {
      '/api': { target: 'https://bong-api.bcserver.xyz', changeOrigin: true },
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
