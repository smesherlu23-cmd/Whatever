import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [react()],
  // Версия из package.json попадает в сборку: её видно в меню пользователя.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    // Сервер сверяет Origin с Host, поэтому прокси передаёт Host браузера без изменений,
    // как nginx в рабочей сборке.
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: false },
      '/ws': { target: 'ws://localhost:8000', ws: true, changeOrigin: false },
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // Библиотеки обновляются реже приложения. В отдельных файлах они остаются в кэше
        // браузера, когда выходит новая версия приложения, и каждый файл меньше.
        codeSplitting: {
          groups: [
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            {
              name: 'yjs',
              test: /[\\/]node_modules[\\/](yjs|y-websocket|y-indexeddb|y-protocols|lib0)[\\/]/,
            },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    // Сквозные тесты (e2e/) запускает Playwright, а не Vitest.
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/testing/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.bench.ts',
        'src/testing/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
      thresholds: { lines: 85, branches: 70, functions: 85, statements: 85 },
    },
  },
});
