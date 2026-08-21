// `vitest/config` rather than `vite`: it is the same defineConfig with the
// `test` key typed, so the config below type-checks.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
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
