import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/testing/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/testing/**', 'src/main.tsx', 'src/vite-env.d.ts'],
      thresholds: { lines: 85, branches: 70, functions: 85, statements: 85 },
    },
  },
});
