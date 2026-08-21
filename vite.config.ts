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
  test: {
    // Node, not jsdom: the protocol client and the face state machine are pure
    // logic. Components that need a DOM can opt in per-file later.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
